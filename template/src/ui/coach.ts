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
 *
 * A beat also has to be able to STOP. The thing being taught can stop being
 * actionable while the beat is still up — the spotlighted door closes, the
 * pickup despawns, the timer the arrow points at expires — and an infinite
 * attention loop pulsing over a dead rect then competes with the live thing
 * for the player's eye for the rest of the session (measured: two SPENT
 * extraction arrows still pulsing at 7:03 while the one open gate fought them
 * for the same screen corner). Pass `isLive` and the beat retires itself, or
 * call `handle.spend()` when the caller already knows. Retiring kills every
 * loop; it is not a success, so `onDone` does not fire.
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
  /**
   * Polled while the beat is up (every `POLL_MS`). Return false once the thing
   * being taught is no longer actionable and the beat retires itself — same
   * teardown as `spend()`, `onExpire` instead of `onDone`. MANDATORY for any
   * beat whose target can expire on its own clock.
   */
  isLive?: () => boolean;
  /** Fired once, after the beat is retired by `isLive` or by `spend()`. */
  onExpire?: () => void;
  /** Fired once, after the beat is torn down by a tap or by `finish()`. */
  onDone?: () => void;
}

export interface CoachHandle {
  readonly id: string;
  /** Ends the beat as a SUCCESS: tears down, then fires `onDone`. */
  finish(): void;
  /**
   * Ends the beat because its target stopped being actionable: tears down,
   * stops every attention loop, then fires `onExpire`. NOT a success.
   */
  spend(): void;
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

/** Poll interval for `isLive`. Scene-time, so it pauses with the scene. */
const POLL_MS = 120;
/**
 * The hand's occupied box in unscaled local px, tip at the origin: the glow
 * circle is the widest part (centre 10,44 radius 44) and the palm the lowest.
 * `drawHand` below and this box MUST change together — the placement search
 * uses it to keep the hand off the spotlight.
 */
const HAND_BOX = { left: -34, right: 54, bottom: 88 } as const;
/** Bob travel, downward, as a multiple of the hand scale. Counts as extent. */
const HAND_BOB = 18;
/** Px between the hand's nearest pixel and the spotlight it points at. */
const TIP_GAP = 8;

interface HandSpot {
  x: number;
  y: number;
  /** Mirror the hand so its body extends AWAY from the spotlight. */
  flip: boolean;
}

/**
 * Where to put the pointer hand so it points AT the spotlight without covering
 * it. The hand's body always hangs below and to the right of its tip, so the
 * placements with ZERO overlap are: below the hole (the body falls away from
 * it), right of the hole, or left of it mirrored. Each is allowed to slide
 * along the edge it sits on to stay on screen — but only within the hole's own
 * span, or it would stop pointing at anything — and is rejected outright if its
 * occupied box, bob travel included, still leaves the view.
 *
 * Previously the tip sat at the hole's CENTRE, which parked 88x88 scaled px of
 * hand on the very piece the beat was teaching.
 */
function placeHand(
  left: number,
  top: number,
  width: number,
  height: number,
  scale: number,
): HandSpot {
  const right = left + width;
  const bottom = top + height;
  // Body extents measured from the tip, unflipped. Flipping mirrors them.
  const leftExtent = -HAND_BOX.left * scale;
  const rightExtent = HAND_BOX.right * scale;
  const extentY = (HAND_BOX.bottom + HAND_BOB) * scale;
  const maxY = VIEW.height - extentY;

  if (bottom + TIP_GAP <= maxY) {
    const x = Phaser.Math.Clamp(left + width / 2, leftExtent, VIEW.width - rightExtent);
    if (x >= left && x <= right) return { x, y: bottom + TIP_GAP, flip: false };
  }

  // Beside: the tip clears the hole by the body's own width, and rides up the
  // hole's height by as much as the bottom of the screen demands.
  const y = Phaser.Math.Clamp(top + height / 2, top, Math.min(bottom, maxY));
  if (y >= top && y <= maxY) {
    const rightTip = right + TIP_GAP + leftExtent;
    if (rightTip + rightExtent <= VIEW.width) return { x: rightTip, y, flip: false };
    const leftTip = left - TIP_GAP - leftExtent;
    if (leftTip - rightExtent >= 0) return { x: leftTip, y, flip: true };
  }

  // Nothing clears: keep the hand on screen and accept the overlap. Only
  // reachable for a spotlight that owns nearly the whole view, where there is
  // no "beside" left to stand in.
  return {
    x: Phaser.Math.Clamp(left + width / 2, leftExtent, VIEW.width - rightExtent),
    y: Phaser.Math.Clamp(bottom + TIP_GAP, 0, Math.max(0, maxY)),
    flip: false,
  };
}

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
  let poll: Phaser.Time.TimerEvent | null = null;

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
  hand.setScrollFactor(0);
  root.add(hand);

  const nudge = opts.nudge;
  if (nudge === undefined) {
    // Beside the spotlight, never on it (`placeHand`).
    const spot = placeHand(left, top, holeWidth, holeHeight, handScale);
    const signedScale = spot.flip ? -handScale : handScale;
    hand.setPosition(spot.x, spot.y).setScale(signedScale, handScale);
    loops.push(
      scene.tweens.add({
        targets: hand,
        // Bobs DOWNWARD, i.e. further from the spotlight: an entrance or idle
        // offset counts as overlap, so the loop may not travel onto the target.
        y: spot.y + HAND_BOB * handScale,
        // Signed, or the yoyo would unflip a mirrored hand mid-loop.
        scaleX: signedScale * 0.94,
        scaleY: handScale * 0.94,
        duration: 620,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }),
    );
  } else {
    // Authored travel: the caller owns both points, including their clearance.
    hand.setScale(handScale);
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
    poll?.remove();
    poll = null;
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
    spend(): void {
      if (done) return;
      teardown();
      opts.onExpire?.();
    },
    destroy(): void {
      teardown();
    },
  };

  // The target can die on its own clock, so the beat checks instead of waiting
  // to be told: a spotlight and a pulsing hand on something that is over is a
  // permanent misdirection.
  const isLive = opts.isLive;
  if (isLive !== undefined) {
    poll = scene.time.addEvent({
      delay: POLL_MS,
      loop: true,
      callback: () => {
        if (done || isLive()) return;
        handle.spend();
      },
    });
  }

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
