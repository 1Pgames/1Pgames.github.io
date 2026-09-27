import Phaser from 'phaser';

/**
 * Entrance animations that move a control's PIXELS but never its HIT AREA.
 *
 * `core/juice.ts`'s `enterFromBottom` tweens the object's own `x`/`y`, and for a
 * decorative heading that is exactly right. For an INTERACTIVE object it is a
 * defect: Phaser hit-tests against the object's LIVE transform, so an 80px
 * slide drags the tap target along with the pixels and a `delayMs` on top of it
 * leaves the control missing from the input map entirely until the tween
 * starts. Measured cost on the 2026-08-29 build: 1-3 dead taps on the primary
 * CTA across four cold starts, and one automated attempt that tapped PLAY's
 * final rest position and then sat on the menu for 300s.
 *
 * The fix keeps the animation and fixes the input. The object still slides, but
 * every hit area in its tree is offset by the inverse of the current slide, so
 * from the FIRST frame the control accepts taps at the rect it will END on.
 * Input acknowledgement is therefore <=1 frame (the §Quality-budgets
 * "ack <=100ms" row) for the whole entrance, delay included.
 *
 * Why the whole tree and not just the root: a control is often a Container
 * whose interactive part is a child `Zone` or `Rectangle`. Translating the root
 * shifts every descendant's local space, so every descendant's hit area needs
 * the same correction — expressed in that descendant's own local units, which
 * is why each area records the accumulated scale between it and the root.
 *
 * THIS IS THE ONLY ENTRANCE HELPER PERMITTED FOR INTERACTIVE OBJECTS.
 */

/** Anything with a position and an alpha — sprites, text, containers, zones. */
type Movable = Phaser.GameObjects.GameObject & { x: number; y: number; alpha: number };

interface PinnedArea {
  /** The live hit-area geometry (Rectangle / Circle / Ellipse). Mutated in place. */
  readonly area: { x: number; y: number };
  /** Its resting local origin — restored verbatim when the slide lands. */
  readonly baseX: number;
  readonly baseY: number;
  /**
   * Accumulated scale from the animated root (inclusive) down to this area's
   * owner (inclusive). A world-space translation of T shifts this area's local
   * geometry by T / scale, so a control nested inside a scaled container is
   * corrected by the right amount instead of by the root's amount.
   */
  readonly scaleX: number;
  readonly scaleY: number;
}

/** Duck-typed because a hit area may be any Geom with an origin, or a custom shape. */
function isOffsettableArea(value: unknown): value is { x: number; y: number } {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { x?: unknown; y?: unknown };
  return typeof candidate.x === 'number' && typeof candidate.y === 'number';
}

function scaleOf(obj: Phaser.GameObjects.GameObject, axis: 'scaleX' | 'scaleY'): number {
  const value = (obj as Partial<Record<'scaleX' | 'scaleY', number>>)[axis];
  return typeof value === 'number' && value !== 0 ? value : 1;
}

function collectHitAreas(
  obj: Phaser.GameObjects.GameObject,
  scaleX: number,
  scaleY: number,
  out: PinnedArea[],
): void {
  const ownScaleX = scaleX * scaleOf(obj, 'scaleX');
  const ownScaleY = scaleY * scaleOf(obj, 'scaleY');
  const area: unknown = obj.input?.hitArea;
  if (isOffsettableArea(area)) {
    out.push({ area, baseX: area.x, baseY: area.y, scaleX: ownScaleX, scaleY: ownScaleY });
  }
  const children = (obj as Partial<Phaser.GameObjects.Container>).list;
  if (Array.isArray(children)) {
    for (const child of children) collectHitAreas(child, ownScaleX, ownScaleY, out);
  }
}

/**
 * The alpha an entering control STARTS at, instead of 0.
 *
 * This is the second half of the same defect and it is invisible in the source:
 * Phaser skips input hit-testing for any object whose `willRender` is false,
 * and `alpha === 0` clears that flag. A control pinned at its final rect but
 * held at alpha 0 through the entrance delay is therefore STILL absent from the
 * hit map — measured directly: `willRender: false`, tap ignored, and the same
 * tap 60ms later (once the tween had nudged alpha off zero) started the scene.
 * `0.001 * 255` rounds to 0 on an 8-bit channel, so this is visually identical
 * to fully transparent and behaviourally the opposite.
 */
const MIN_ALPHA = 0.001;

export interface EnterOptions {
  /** Stagger, ms. The control is tappable during the delay, not after it. */
  delayMs?: number;
  /** Slide distance in px along `from`. Default 80. */
  distance?: number;
  /** Which edge the control flies in from. Default `bottom`. */
  from?: 'bottom' | 'top' | 'left' | 'right';
  /** Flight time, ms. Default 380 — keep it under the 400ms transition budget. */
  durationMs?: number;
  /** Tween ease. Default `Back.easeOut`. */
  ease?: string;
  /** Fade in over the flight. Default true. */
  fade?: boolean;
  /**
   * The alpha the control LANDS on. Default 1 — pass the control's own resting
   * alpha when it arrives already disabled/dimmed, or the entrance would fade a
   * greyed-out control up to full strength and erase the state it is in.
   */
  fadeTo?: number;
  /** Fired once the control has landed. */
  onComplete?: () => void;
}

const AXIS: Record<NonNullable<EnterOptions['from']>, { x: number; y: number }> = {
  bottom: { x: 0, y: 1 },
  top: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * Slides `obj` in to the position it is currently at, with every hit area in its
 * tree pinned to that final rest position and the object kept renderable for
 * the entire flight — so the control is tappable from frame one, delay
 * included. Returns the tween so callers can chain or cancel.
 *
 * Call it AFTER the object is fully built and interactive: hit areas are
 * collected once, at call time, and an area added later is not pinned.
 *
 * Does not tween scale — the correction is computed from the scale the tree has
 * when the entrance starts. Tween scale separately if you need it, or pair the
 * slide with `core/juice.ts`'s `pop` after `onComplete`.
 *
 * Use for: buttons, cards, chips, tappable rows, anything the player can hit.
 * Do NOT use for: inert chrome (`enterFromBottom` is fine there).
 */
export function enterPinningHitArea(
  scene: Phaser.Scene,
  obj: Movable,
  opts: EnterOptions = {},
): Phaser.Tweens.Tween {
  const delay = opts.delayMs ?? 0;
  const distance = opts.distance ?? 80;
  const duration = opts.durationMs ?? 380;
  const axis = AXIS[opts.from ?? 'bottom'];
  const fade = opts.fade ?? true;
  const fadeTo = opts.fadeTo ?? 1;

  const endX = obj.x;
  const endY = obj.y;
  const areas: PinnedArea[] = [];
  collectHitAreas(obj, 1, 1, areas);

  obj.x = endX + axis.x * distance;
  obj.y = endY + axis.y * distance;
  if (fade) obj.alpha = MIN_ALPHA;

  // The slide is a pure translation, so the correction is two scalars.
  const pin = (): void => {
    const shiftX = endX - obj.x;
    const shiftY = endY - obj.y;
    for (const entry of areas) {
      entry.area.x = entry.baseX + shiftX / entry.scaleX;
      entry.area.y = entry.baseY + shiftY / entry.scaleY;
    }
  };
  const unpin = (): void => {
    for (const entry of areas) {
      entry.area.x = entry.baseX;
      entry.area.y = entry.baseY;
    }
  };
  pin();

  return scene.tweens.add({
    targets: obj,
    x: endX,
    y: endY,
    ...(fade ? { alpha: fadeTo } : {}),
    duration,
    delay,
    ease: opts.ease ?? 'Back.easeOut',
    onUpdate: pin,
    onComplete: () => {
      unpin();
      opts.onComplete?.();
    },
    onStop: unpin,
  });
}
