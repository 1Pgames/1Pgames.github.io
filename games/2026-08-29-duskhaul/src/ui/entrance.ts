import Phaser from 'phaser';

/**
 * Entrance animations that move a control's PIXELS but never its HIT AREA.
 *
 * `core/juice.ts`'s `enterFromBottom` tweens the object's own `y`, and for a
 * decorative label that is exactly right. For an INTERACTIVE object it is a
 * defect: Phaser hit-tests against the object's live transform, so an 80px
 * slide drags the tap target with the pixels and a 220ms delay leaves the
 * control absent from the input map entirely. The measured cost on this build
 * was 1-3 taps to start a run from a cold menu, and one automated attempt
 * tapping PLAY's final position and sitting on the menu for 300s.
 *
 * The fix keeps the animation and fixes the input: the object still slides,
 * but every `Phaser.Geom.Rectangle` hit area in its tree is offset by the
 * inverse of the current slide, so from the first frame the target accepts
 * taps at the rect it will END on. Input acknowledgment is therefore ≤1 frame
 * (the §Quality-budgets "≤100ms, ideally next frame" row) for the whole
 * entrance, delay included.
 *
 * Why the whole tree and not just the root: a control can be a container whose
 * interactive part is a child `Zone` (`ui/cards.ts`'s reroll chip), and the
 * root's translation shifts every descendant's local space by the same amount
 * — the slide is pure y translation at scale 1, so one offset is correct at
 * every depth.
 */

type Movable = Phaser.GameObjects.GameObject & { x: number; y: number; alpha: number };

interface PinnedArea {
  area: Phaser.Geom.Rectangle;
  /** The hit area's resting local y — restored verbatim when the slide lands. */
  baseY: number;
}

function collectHitAreas(obj: Phaser.GameObjects.GameObject, out: PinnedArea[]): void {
  const area: unknown = obj.input?.hitArea;
  if (area instanceof Phaser.Geom.Rectangle) out.push({ area, baseY: area.y });
  const children = (obj as Partial<Phaser.GameObjects.Container>).list;
  if (Array.isArray(children)) {
    for (const child of children) collectHitAreas(child, out);
  }
}

/**
 * The alpha an entering control STARTS at, instead of 0.
 *
 * This is the second half of the same defect and it is invisible in the source:
 * Phaser skips input hit-testing for any object whose `willRender` is false,
 * and `alpha === 0` clears the render flag. So a control pinned at its final
 * rect but held at alpha 0 through a 240ms entrance delay is STILL absent from
 * the hit map — measured directly: `willRender: false`, tap ignored, and the
 * same tap 60ms later (once the tween had nudged alpha off zero) started the
 * scene. 0.001 * 255 rounds to 0 on an 8-bit channel, so this is visually
 * identical to fully transparent and behaviourally the opposite.
 */
const MIN_ALPHA = 0.001;

/**
 * Same slide, tempo and easing as `enterFromBottom`, with the hit areas pinned
 * at their final rects and the object kept renderable for the entire flight —
 * so the control is tappable from frame one, delay included. Use it for
 * anything tappable; keep `enterFromBottom` for headings, labels and other
 * inert chrome.
 */
export function enterPinningHitArea(
  scene: Phaser.Scene,
  target: Movable,
  delayMs = 0,
  distance = 80,
): void {
  const endY = target.y;
  const areas: PinnedArea[] = [];
  collectHitAreas(target, areas);

  target.y = endY + distance;
  target.alpha = MIN_ALPHA;

  // The slide is a pure y translation, so the compensation is one scalar.
  const pin = (): void => {
    const shift = endY - target.y;
    for (const entry of areas) entry.area.y = entry.baseY + shift;
  };
  pin();

  scene.tweens.add({
    targets: target,
    y: endY,
    alpha: 1,
    duration: 380,
    delay: delayMs,
    ease: 'Back.easeOut',
    onUpdate: pin,
    onComplete: () => {
      for (const entry of areas) entry.area.y = entry.baseY;
    },
  });
}
