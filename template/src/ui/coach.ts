import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../config';
import { load, save } from '../core/storage';
import { sfx } from '../core/audio';
import { drawPanel } from './primitives';

/**
 * Coach marks: the one teaching surface in the game.
 *
 * A beat is always the same three things — DIM everything that is not the
 * thing being taught, POINT at that thing, and say ONE line about it. That
 * shape is what lets the first level, the jar debut, the vine debut, the
 * booster picker and the tray all be taught by the same 300 lines instead of
 * five bespoke overlays, and it is why nothing in here knows what a board is:
 * the caller hands over a rectangle in design px.
 *
 * The dim is FOUR rectangles around the spotlight rather than a mask, on
 * purpose. A mask (or a hole punched with a blend mode) costs a render target
 * and — the part that actually matters — cannot be hit-tested, whereas four
 * plain rectangles ARE the input gate: what they cover is unreachable and what
 * they leave uncovered still belongs to whatever sits underneath. That is the
 * whole implementation of `swap-gate`.
 *
 * Every beat shows ONCE EVER per save (`tut:<id>` through `core/storage`), and
 * the flag is written the moment it appears — a tutorial the player reloaded
 * out of the middle of must not greet them again on every visit.
 */

/** A rectangle in design px, `x`/`y` being its TOP-LEFT corner. */
export interface CoachRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CoachOptions {
  /**
   * Storage id, stored as `tut:<id>`. A beat whose flag is set never shows
   * again — `showCoach` returns `null` for it, which the caller reads as
   * "already taught, carry on".
   */
  id: string;
  /**
   * What to spotlight. Callers with cells rather than pixels (the board) turn
   * them into one rect themselves — this module deliberately has no idea what
   * a cell is.
   */
  target: CoachRect;
  /** One line of copy, two at the very most. The card wraps it. */
  text: string;
  /**
   * `tap` (default) dismisses on a tap ANYWHERE: the beat is pure reading, so
   * every pixel is the button.
   *
   * `swap-gate` dismisses on nothing at all — the caller ends it with
   * `finish()` once the taught action actually happened — and leaves the
   * spotlight open as the ONLY reachable input on screen.
   */
  mode?: 'tap' | 'swap-gate';
  /**
   * Px added around `target` before the dim is cut. Generous by default (the
   * spotlight should breathe); pass 0 when the rect IS the input gate and a
   * fat pad would hand taps to the wrong neighbour.
   */
  pad?: number;
  /**
   * Makes the pointer hand travel between two points instead of tapping in
   * place — "swap THESE two", drawn rather than written.
   */
  nudge?: { from: { x: number; y: number }; to: { x: number; y: number } };
  /** Fired once, after the beat is torn down by a tap or by `finish()`. */
  onDone?: () => void;
}

export interface CoachHandle {
  readonly id: string;
  /** Ends the beat as a SUCCESS: tears down, then fires `onDone`. */
  finish(): void;
  /** Tears down without firing `onDone` — shutdown, level abandon, defeat. */
  destroy(): void;
}

/**
 * Has this beat already been taught? The flag lives under `tut:<id>` in the
 * game's own `core/storage` namespace, so wiping a save wipes the tutorial too
 * — which is the only way to ever test one of these a second time.
 */
export function hasSeenCoach(id: string): boolean {
  return load<boolean>(`tut:${id}`, false);
}

/** Card geometry. The card is the contrast surface, so the copy strips its armour. */
const CARD_WIDTH = VIEW.width - SAFE.side * 2;
const CARD_PAD_X = 30;
const CARD_GAP = 26;
/** Dim opacity: dark enough to kill the backdrop, light enough to keep context. */
const DIM_ALPHA = 0.55;
/** Beats that can be tapped away ignore taps for this long after appearing. */
const TAP_ARM_MS = 260;

/**
 * The pointer hand, drawn with primitives and NOT generated: a hand is the one
 * glyph that has to sit at an exact pixel with an exact tip, and art with its
 * own padding cannot promise that. Its TIP is the container origin, so placing
 * it is `setPosition(pointAt)`.
 */
function drawHand(scene: Phaser.Scene): Phaser.GameObjects.Container {
  const g = scene.add.graphics();

  // Soft glow first (container order is z order): the hand has to stay legible
  // on top of a spotlighted piece as well as on top of a dark panel.
  g.fillStyle(PALETTE.accent, 0.22);
  g.fillCircle(10, 44, 44);

  g.fillStyle(PALETTE.ink, 1);
  g.lineStyle(5, PALETTE.bgDeep, 0.92);
  // Palm, index finger, thumb — three rounded boxes read as a chunky pointing
  // hand at any scale, where a traced outline turns to mush below 0.6.
  g.fillRoundedRect(-8, 28, 54, 56, 18);
  g.strokeRoundedRect(-8, 28, 54, 56, 18);
  g.fillRoundedRect(0, 0, 26, 46, 13);
  g.strokeRoundedRect(0, 0, 26, 46, 13);
  g.fillRoundedRect(-24, 44, 24, 32, 12);
  g.strokeRoundedRect(-24, 44, 24, 32, 12);

  return scene.add.container(0, 0, [g]);
}

/**
 * Shows one coach beat, or returns `null` when its flag is already set (and
 * therefore without ever firing `onDone` — the caller owns the "skip" branch).
 *
 * The scene is NOT paused here. Pausing a director, blocking a button and
 * resuming afterwards is the caller's business; this module's contract is the
 * dim, the pointer, the card, and the input gate.
 */
export function showCoach(scene: Phaser.Scene, opts: CoachOptions): CoachHandle | null {
  if (hasSeenCoach(opts.id)) return null;
  // Written on SHOW, not on dismiss: a reload out of the middle of a beat is a
  // beat the player has seen.
  save(`tut:${opts.id}`, true);

  const mode = opts.mode ?? 'tap';
  const pad = opts.pad ?? 12;
  const root = scene.add.container(0, 0).setDepth(2600).setScrollFactor(0);
  const loops: Phaser.Tweens.Tween[] = [];
  let done = false;

  // Spotlight, clamped to the view: a rect that hangs off the screen would
  // otherwise leave a dim panel with negative width, which draws as nothing
  // and silently opens the whole side of the screen to input.
  const left = Math.max(0, opts.target.x - pad);
  const top = Math.max(0, opts.target.y - pad);
  const right = Math.min(VIEW.width, opts.target.x + opts.target.w + pad);
  const bottom = Math.min(VIEW.height, opts.target.y + opts.target.h + pad);
  const holeWidth = Math.max(0, right - left);
  const holeHeight = Math.max(0, bottom - top);

  // Four dim panels around the hole. In `swap-gate` they are interactive, and
  // that is the entire gate: they swallow every pointer that is not inside the
  // spotlight, and the spotlight passes straight through to the board below.
  const swallow = mode === 'swap-gate';
  const dim = (x: number, y: number, w: number, h: number): void => {
    if (w <= 0 || h <= 0) return;
    const rect = scene.add
      .rectangle(x + w / 2, y + h / 2, w, h, PALETTE.bgDeep, DIM_ALPHA)
      .setScrollFactor(0);
    if (swallow) rect.setInteractive();
    root.add(rect);
  };
  dim(0, 0, VIEW.width, top);
  dim(0, bottom, VIEW.width, VIEW.height - bottom);
  dim(0, top, left, holeHeight);
  dim(right, top, VIEW.width - right, holeHeight);

  // The ring is what makes the hole read as a spotlight rather than as a bug in
  // the dim. Graphics are never interactive, so it costs the gate nothing.
  const ring = drawPanel(scene, holeWidth, holeHeight, {
    fill: PALETTE.accent,
    fillAlpha: 0.06,
    stroke: PALETTE.accent,
    strokeAlpha: 0.9,
    strokeWidth: 5,
    radius: Math.min(28, Math.max(10, Math.min(holeWidth, holeHeight) * 0.24)),
  })
    .setPosition(left + holeWidth / 2, top + holeHeight / 2)
    .setScrollFactor(0);
  root.add(ring);
  loops.push(
    scene.tweens.add({
      targets: ring,
      alpha: 0.45,
      duration: 720,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    }),
  );

  // ------------------------------------------------------------------ the card
  const card = scene.add.container(0, 0).setScrollFactor(0);
  const body = scene.add
    .text(0, 0, opts.text, {
      ...TEXT.body,
      fontSize: '32px',
      color: CSS.ink,
      align: 'center',
      wordWrap: { width: CARD_WIDTH - CARD_PAD_X * 2 },
      // The card IS the contrast surface: the global backdrop armour reads as
      // grime on top of it (same rule as `ui/button.ts`).
      stroke: undefined,
      strokeThickness: 0,
      shadow: undefined,
    })
    .setOrigin(0.5, 0.5);
  const hint =
    mode === 'tap'
      ? scene.add
          .text(0, 0, 'TAP TO CONTINUE', {
            ...TEXT.label,
            fontSize: '24px',
            color: CSS.accent,
            stroke: undefined,
            strokeThickness: 0,
            shadow: undefined,
          })
          .setOrigin(0.5, 0.5)
      : null;

  const hintHeight = hint === null ? 0 : 34;
  const cardHeight = Math.round(body.height + 44 + hintHeight);
  const plate = drawPanel(scene, CARD_WIDTH, cardHeight, {
    fill: PALETTE.bgTop,
    fillAlpha: 0.97,
    stroke: PALETTE.accent,
    strokeAlpha: 0.55,
    strokeWidth: 4,
    radius: 26,
  }).setScrollFactor(0);
  body.setY(hint === null ? 0 : -hintHeight / 2);
  if (hint !== null) hint.setY(cardHeight / 2 - 26);
  card.add(hint === null ? [plate, body] : [plate, body, hint]);

  // Above the spotlight when it fits inside SAFE, below when it does not, and
  // clamped into the safe band when neither side has room (a spotlight that
  // owns the middle of the screen).
  const safeTop = SAFE.top;
  const safeBottom = VIEW.height - SAFE.bottom;
  const above = top - CARD_GAP - cardHeight / 2;
  const below = bottom + CARD_GAP + cardHeight / 2;
  let cardY: number;
  if (above - cardHeight / 2 >= safeTop) cardY = above;
  else if (below + cardHeight / 2 <= safeBottom) cardY = below;
  else cardY = Math.min(Math.max(VIEW.centerY, safeTop + cardHeight / 2), safeBottom - cardHeight / 2);
  card.setPosition(VIEW.centerX, cardY);
  root.add(card);

  card.setAlpha(0).setScale(0.94);
  scene.tweens.add({ targets: card, alpha: 1, scale: 1, duration: 220, ease: 'Back.easeOut' });

  // ------------------------------------------------------------- pointer hand
  const hand = drawHand(scene);
  const handScale = Math.min(1, Math.max(0.52, Math.min(holeWidth, holeHeight) / 150));
  hand.setScale(handScale).setScrollFactor(0);
  root.add(hand);

  const nudge = opts.nudge;
  if (nudge === undefined) {
    // Tapping in place, tip on the spotlight's centre.
    hand.setPosition(left + holeWidth / 2, top + holeHeight * 0.52);
    loops.push(
      scene.tweens.add({
        targets: hand,
        y: hand.y + 18 * handScale,
        scale: handScale * 0.94,
        duration: 620,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }),
    );
  } else {
    hand.setPosition(nudge.from.x, nudge.from.y);
    loops.push(
      scene.tweens.add({
        targets: hand,
        x: nudge.to.x,
        y: nudge.to.y,
        duration: 780,
        hold: 140,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }),
    );
  }

  sfx('ui', { volume: 0.35 });

  // ----------------------------------------------------------------- teardown
  const teardown = (): void => {
    if (done) return;
    done = true;
    // Loops FIRST: an infinite tween is not stopped by its target being
    // destroyed, and it will keep ticking against a dead scene (AGENTS.md
    // shutdown trap).
    for (const loop of loops) loop.remove();
    loops.length = 0;
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, teardown);
    root.destroy(true);
  };

  const handle: CoachHandle = {
    id: opts.id,
    finish(): void {
      if (done) return;
      teardown();
      sfx('pickup', { volume: 0.4, rate: 1.15 });
      opts.onDone?.();
    },
    destroy(): void {
      teardown();
    },
  };

  // A beat that outlives its scene is the black-screen trap: leave with it.
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown);

  if (mode === 'tap') {
    // Full-screen catcher ABOVE the dim: the whole screen is the button, so
    // the spotlight is decoration here rather than a gate.
    const catcher = scene.add
      .zone(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height)
      .setScrollFactor(0);
    root.add(catcher);
    // Armed late: a beat opened BY a tap must not be closed by the same tap's
    // stray follow-up, which is exactly what happens on a touch screen.
    scene.time.delayedCall(TAP_ARM_MS, () => {
      if (done) return;
      catcher.setInteractive();
      catcher.on(Phaser.Input.Events.POINTER_DOWN, () => handle.finish());
    });
  }

  return handle;
}
