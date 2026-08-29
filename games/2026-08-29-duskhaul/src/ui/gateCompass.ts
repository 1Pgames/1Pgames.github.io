import Phaser from 'phaser';
import { CSS, TEXT, TUNING, bareText } from '../config';
import { paintPill } from './primitives';
import { DEEP_INK, DEEP_INK_CSS, HUD_DEPTH, IDENTITY, PANEL } from './duskChrome';

/**
 * The gate compass (§14.2): up to three screen-edge arrows pointing at the
 * extraction gates, each with a countdown chip.
 *
 * This exists because the arena is 1440x2160 seen through a 720x1280 window,
 * so an open gate is OFF SCREEN most of the time and the world-space ring only
 * helps once you are already standing on it. Without the compass the only way
 * to find Gate B is to read coordinates out of `data/zones.ts` — which is
 * exactly what a playtester had to do. The compass is therefore load-bearing
 * for the whole extraction axis, not decoration.
 *
 * It RENDERS ONLY. It never reads game state, never touches the director and
 * never owns a timer: the slice feeds it a plain data object every frame and
 * this class decides what that looks like. That is what keeps the same
 * component honest in the sim, in a screenshot harness and in the live game.
 *
 * Five visually DISTINCT states, because "GATE A OPEN 90s" was measured as
 * ambiguous — it reads as "has been open 90s" as readily as "closes in 90s":
 *
 * | State | Arrow | Chip |
 * | --- | --- | --- |
 * | opening within `previewS` | amber, 0.75 alpha, steady | `OPENS 0:35` |
 * | open | violet `#8546dd`, full | `CLOSES 1:12` |
 * | closing (inside the warn window) | amber, PULSING | `CLOSES 0:11` |
 * | just closed | cooled grey, 2s flash then drops | `CLOSED` |
 * | spent | threat red, 0.45 alpha, permanent | `SPENT` |
 *
 * The spent arrow staying on screen is deliberate: it is a standing reminder
 * of the door you refused, which is the whole tension of a greed run.
 */

/** One gate, as the slice sees it. World px — the compass projects them. */
export interface GateCompassGate {
  id: 'a' | 'b' | 'c';
  x: number;
  y: number;
  state: 'closed' | 'open' | 'closing' | 'spent';
  opensS: number;
  /** `null` for Gate C, which never closes — the Collapse is its clock. */
  closesS: number | null;
}

export interface GateCompassModel {
  playerX: number;
  playerY: number;
  elapsedS: number;
  /**
   * Every gate, every frame, EXCEPT retired spent ones — `closed` and live
   * gates are always fed and the compass owns their visibility rules, because
   * filtering those upstream would kill the opens-soon preview and the closed
   * flash. The one filter the slice does own is dropping a `spent` gate once
   * another gate is live: a door you already used stops being news the moment
   * a usable one exists. OMISSION MEANS RETIRE — an id absent from this array
   * is hidden the same frame, so the slice can drop a gate without leaving a
   * frozen arrow behind.
   */
  gates: readonly GateCompassGate[];
}

/** §14.2: arrows are clamped to this ring, in screen px. */
const RING = { left: 40, right: 680, top: 200, bottom: 1000 } as const;

/** §14.2: 48px arrow sprites. Chrome primitives — an arrow is UI geometry. */
const ARROW_SIZE = 48;

/**
 * §14.2 authors the chip at 60x24. The height is kept verbatim; the WIDTH
 * grows to fit the disambiguated verb ("CLOSES 0:47" rather than a bare
 * number), because a 60px chip cannot carry the word that removes the
 * ambiguity. 60 remains the floor.
 */
const CHIP = { minWidth: 60, height: 24, padX: 20, fontSize: '18px' } as const;

/** How long a gate's arrow lingers, greyed and reading CLOSED, after it shuts. */
const CLOSED_FLASH_MS = 2000;

/** Chip sits below its arrow, or above it near the bottom of the ring. */
const CHIP_OFFSET = 38;

/**
 * How far inside the camera frame a gate must be before its ARROW is dropped
 * (the chip stays). The gate ring is r=120 world px and the arch art is wider
 * still, so 150 means "the whole gate, not just its centre, is in frame with
 * room to spare" — a gate hugging an edge keeps its arrow, because at that
 * distance the arrow is still the thing that finds it.
 */
const ONSCREEN_INSET = 150;

/** Minimum clear space between two chips before one is pushed off the other. */
const CHIP_GAP = 6;

/** Everything one arrow needs for one frame, resolved before anything is drawn. */
interface Placement {
  arrow: Arrow;
  x: number;
  y: number;
  angle: number;
  /** False when the gate is on screen: chip only, no arrow head. */
  showHead: boolean;
  chipWidth: number;
  chipX: number;
  chipY: number;
}

/**
 * Pushes overlapping chips apart vertically.
 *
 * Three gates project independently, and two gates in roughly the same
 * direction clamp to roughly the same ring point — which is how "B SPENT" and
 * "C OPEN" ended up rendered on top of each other at the bottom-right corner,
 * both illegible. Widgets that can collide must resolve it, not hope.
 *
 * Resolved in ascending y with downward pushes only, so the pass terminates
 * and the topmost chip keeps its authored position: the chip that moves is the
 * one further from the read the player is already tracking. At most three
 * chips exist, so this is a handful of comparisons per frame.
 */
function declutterChips(shown: readonly Placement[]): void {
  if (shown.length < 2) return;
  const order = [...shown].sort((a, b) => a.chipY - b.chipY);
  for (let i = 1; i < order.length; i += 1) {
    const chip = order[i];
    if (chip === undefined) continue;
    for (let j = 0; j < i; j += 1) {
      const other = order[j];
      if (other === undefined) continue;
      const overlapX =
        Math.abs(chip.chipX - other.chipX) < (chip.chipWidth + other.chipWidth) / 2 + CHIP_GAP;
      const overlapY = Math.abs(chip.chipY - other.chipY) < CHIP.height + CHIP_GAP;
      if (overlapX && overlapY) chip.chipY = other.chipY + CHIP.height + CHIP_GAP;
    }
    chip.chipY = Phaser.Math.Clamp(chip.chipY, RING.top, RING.bottom);
  }
}

/** mm:ss, the format §14b's edge-state table writes countdowns in. */
function clock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type ArrowLook = 'preview' | 'open' | 'closing' | 'closed' | 'spent';

const LOOK: Record<ArrowLook, { tone: number; alpha: number; pulse: boolean }> = {
  preview: { tone: IDENTITY.hazardAmber, alpha: 0.75, pulse: false },
  open: { tone: IDENTITY.gateOpen, alpha: 1, pulse: false },
  closing: { tone: IDENTITY.hazardAmber, alpha: 1, pulse: true },
  closed: { tone: IDENTITY.cooled, alpha: 0.85, pulse: false },
  spent: { tone: IDENTITY.threat, alpha: 0.45, pulse: false },
};

/**
 * One gate's arrow + chip. A field bag rather than a Container per arrow so
 * the pulse tween has exactly one owner and one kill site.
 */
class Arrow {
  private readonly head: Phaser.GameObjects.Graphics;
  private readonly letter: Phaser.GameObjects.Text;
  private readonly chipBg: Phaser.GameObjects.Graphics;
  private readonly chipText: Phaser.GameObjects.Text;

  /** Last painted look, so a repaint only happens on a real state change. */
  private look: ArrowLook | null = null;
  private chipWidth = 0;
  private chipLabel = '';
  private pulse: Phaser.Tweens.Tween | null = null;
  /**
   * Whether this arrow is on screen at all. Tracked separately from
   * `head.visible` because the head is now independently suppressible: an
   * on-screen gate keeps its chip and loses its arrow, and `hide()` reading
   * `head.visible` in that state would decide the widget was already hidden
   * and leave the chip stranded forever.
   */
  private visible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    id: 'a' | 'b' | 'c',
  ) {
    // `setScrollFactor(0)` pins these to the camera; it does NOT lift them out
    // of the world's draw order. Without the depth the arrows render UNDER the
    // props, the pickups and the horde they are steering the player past.
    this.head = scene.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH.compass)
      .setVisible(false);
    // The letter sits ON the arrow fill, which §11 signs off as a fill
    // carrying a deep-ink label (6.09:1 on violet) — so it goes BARE: the
    // fill is already the contrast surface, and armour on 20px type over it
    // reads as grime.
    this.letter = scene.add
      .text(0, 0, id.toUpperCase(), {
        ...TEXT.button,
        fontSize: '20px',
        color: DEEP_INK_CSS,
        ...bareText(),
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH.compass + 1)
      .setVisible(false);
    this.chipBg = scene.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH.compass)
      .setVisible(false);
    this.chipText = scene.add
      .text(0, 0, '', { ...TEXT.label, fontSize: CHIP.fontSize, color: CSS.ink, ...bareText() })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH.compass + 1)
      .setVisible(false);
  }

  /**
   * Repaints geometry only when the look changed — never per frame. It does NOT
   * touch the pulse: whether the closing pulse should run depends on the look
   * AND on whether the head is drawn at all, and only `place` knows the second
   * half. Deciding it here (on a look CHANGE) once left an arrow permanently
   * un-pulsing: the head was suppressed while the gate was on screen, which
   * killed the pulse, and when the gate went back off screen the look had never
   * changed, so nothing restarted it.
   */
  private applyLook(look: ArrowLook): void {
    if (this.look === look) return;
    this.look = look;
    const { tone, alpha } = LOOK[look];

    // A triangle pointing along +x from the object's origin; rotation aims it,
    // so the arrow points at its gate even when clamped to the ring.
    const h = ARROW_SIZE / 2;
    this.head.clear();
    this.head.fillStyle(tone, 1);
    this.head.beginPath();
    this.head.moveTo(h, 0);
    this.head.lineTo(-h * 0.7, -h * 0.85);
    this.head.lineTo(-h * 0.7, h * 0.85);
    this.head.closePath();
    this.head.fillPath();
    this.head.lineStyle(2, DEEP_INK, 0.9);
    this.head.strokePath();

    this.head.setAlpha(alpha);
    this.letter.setAlpha(alpha);
    this.chipBg.setAlpha(alpha);
    this.chipText.setAlpha(alpha);

    // The chip's stroke carries the state tone too, so a glance at either
    // half of the widget tells the same story. Force a chip repaint.
    this.chipWidth = 0;
    this.repaintChip();
  }

  /**
   * The closing pulse. ONE tween per arrow, killed the instant the state
   * leaves `closing` and again in `destroy` — a loop tween outliving its view
   * is the classic leak in a recycled HUD.
   */
  private setPulsing(on: boolean): void {
    if (on === (this.pulse !== null)) return;
    if (!on) {
      this.pulse?.remove();
      this.pulse = null;
      this.head.setScale(1);
      return;
    }
    this.pulse = this.scene.tweens.add({
      targets: this.head,
      scale: 1.18,
      duration: 320,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private repaintChip(): void {
    const width = Math.max(CHIP.minWidth, Math.ceil(this.chipText.width) + CHIP.padX);
    if (width === this.chipWidth) return;
    this.chipWidth = width;
    paintPill(this.chipBg, width, CHIP.height, {
      fill: PANEL.fill,
      fillAlpha: 0.95,
      stroke: LOOK[this.look ?? 'open'].tone,
      strokeAlpha: 0.85,
      strokeWidth: 2,
    });
  }

  private setChip(label: string): void {
    if (label === this.chipLabel) return;
    this.chipLabel = label;
    this.chipText.setText(label);
    this.repaintChip();
  }

  /**
   * First half of a two-pass frame: adopt the look and the label, and report
   * the chip's resulting WIDTH. The compass needs every chip's width before it
   * can resolve chip-against-chip collisions, and only the arrow can measure
   * its own text — so measuring and placing are separate calls.
   */
  prepare(look: ArrowLook, label: string): number {
    this.applyLook(look);
    this.setChip(label);
    return this.chipWidth;
  }

  /**
   * Second half: commit the resolved geometry. `showHead` false keeps the chip
   * and drops the arrow — the case where the gate is already on screen and the
   * countdown is the only part of the widget still carrying information.
   *
   * This call OWNS the closing pulse, because the pulse scales the head and a
   * suppressed head must not keep a tween running. `setPulsing` is idempotent,
   * so driving it from the desired state every frame costs nothing and — unlike
   * deciding it on a look CHANGE — correctly restarts the pulse when a gate
   * leaves the frame again.
   */
  place(x: number, y: number, angle: number, chipX: number, chipY: number, showHead: boolean): void {
    this.head.setPosition(x, y).setRotation(angle).setVisible(showHead);
    this.letter.setPosition(x, y).setVisible(showHead);
    this.setPulsing(showHead && this.look !== null && LOOK[this.look].pulse);
    this.chipBg.setPosition(chipX, chipY).setVisible(true);
    this.chipText.setPosition(chipX, chipY).setVisible(true);
    this.visible = true;
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.setPulsing(false);
    this.head.setVisible(false);
    this.letter.setVisible(false);
    this.chipBg.setVisible(false);
    this.chipText.setVisible(false);
  }

  destroy(): void {
    this.setPulsing(false);
    this.head.destroy();
    this.letter.destroy();
    this.chipBg.destroy();
    this.chipText.destroy();
  }
}

export class GateCompass {
  private readonly arrows = new Map<string, Arrow>();
  /** Run-seconds a gate was last seen live — drives the 2s CLOSED flash. */
  private readonly lastLiveS = new Map<string, number>();
  /** Ids fed this frame — reused, never reallocated (§15: no per-frame garbage). */
  private readonly seen = new Set<string>();
  private destroyed = false;

  /**
   * @param x - The point the arrows orbit, x. §14 anchors this at 360.
   * @param y - Same, y: 600, the midpoint of the playfield band (140-1060),
   * so the ring clamp sits symmetrically around the camera-followed player.
   */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly x: number,
    private readonly y: number,
  ) {}

  update(model: GateCompassModel): void {
    if (this.destroyed) return;
    const view = this.scene.cameras.main.worldView;
    // A camera that has not rendered yet reports a zero-size view; projecting
    // through it would stack every arrow in the corner for one frame.
    const projecting = view.width > 0 && view.height > 0;
    const playerScreenX = projecting ? model.playerX - view.x : this.x;
    const playerScreenY = projecting ? model.playerY - view.y : this.y;

    const shown: Placement[] = [];
    this.seen.clear();

    for (const gate of model.gates) {
      this.seen.add(gate.id);
      const arrow = this.arrowFor(gate.id);
      const look = this.lookFor(gate, model.elapsedS);
      if (look === null) {
        arrow.hide();
        continue;
      }

      const gateScreenX = projecting ? gate.x - view.x : this.x;
      const gateScreenY = projecting ? gate.y - view.y : this.y;
      // Rotation comes from the UNCLAMPED target, so a clamped arrow still
      // points at the real gate rather than at its own clamped position.
      const angle = Math.atan2(gateScreenY - playerScreenY, gateScreenX - playerScreenX);

      // AN ARROW IS A POINTER TO SOMETHING YOU CANNOT SEE. Once the gate is
      // comfortably inside the frame it is a 240px lit arch with its own
      // world-space ring, and a 48px triangle drawn on top of it is a third
      // widget stacked on one 100px band — measured at 2:07 as the violet 'A'
      // arrow, the gate arch and the channel bar all on the same rows. So the
      // HEAD drops and the CHIP stays: the arch is the "where", the chip is
      // the countdown, which no world-space art carries.
      const onScreen =
        projecting &&
        gateScreenX > ONSCREEN_INSET &&
        gateScreenX < view.width - ONSCREEN_INSET &&
        gateScreenY > ONSCREEN_INSET &&
        gateScreenY < view.height - ONSCREEN_INSET;

      const chipWidth = arrow.prepare(look, this.labelFor(gate, model.elapsedS, look));
      const x = onScreen
        ? gateScreenX
        : Phaser.Math.Clamp(gateScreenX, RING.left + ARROW_SIZE / 2, RING.right - ARROW_SIZE / 2);
      const y = onScreen ? gateScreenY : Phaser.Math.Clamp(gateScreenY, RING.top, RING.bottom);
      // Flip the chip above the arrow near the ring's floor so it never leaves
      // the authored band and never drifts under the joystick thumb.
      const chipY = y > RING.bottom - CHIP_OFFSET * 2 ? y - CHIP_OFFSET : y + CHIP_OFFSET;
      // The CHIP is clamped on its own half-width, not on the arrow's: an arrow
      // clamped to x=656 put a 150px-wide "CLOSES 0:07" chip 50px past the
      // x=680 safe edge. The arrow stays where it points; the chip slides in.
      const half = chipWidth / 2;
      shown.push({
        arrow,
        x,
        y,
        angle,
        showHead: !onScreen,
        chipWidth,
        chipX: Phaser.Math.Clamp(x, RING.left + half, RING.right - half),
        chipY,
      });
    }

    // A gate the slice stopped feeding is RETIRED: omission means "gone", and
    // without this the arrow froze at its last screen position for the rest of
    // the run. (The slice drops spent gates from the feed once another gate is
    // live, so this path runs in normal play, not only at teardown.)
    for (const [id, arrow] of this.arrows) {
      if (!this.seen.has(id)) arrow.hide();
    }

    declutterChips(shown);
    for (const p of shown) p.arrow.place(p.x, p.y, p.angle, p.chipX, p.chipY, p.showHead);
  }

  private arrowFor(id: 'a' | 'b' | 'c'): Arrow {
    let arrow = this.arrows.get(id);
    if (arrow === undefined) {
      arrow = new Arrow(this.scene, id);
      this.arrows.set(id, arrow);
    }
    return arrow;
  }

  /** `null` means "no arrow for this gate right now". */
  private lookFor(gate: GateCompassGate, elapsedS: number): ArrowLook | null {
    if (gate.state === 'open' || gate.state === 'closing') {
      this.lastLiveS.set(gate.id, elapsedS);
      const secondsLeft = gate.closesS === null ? Number.POSITIVE_INFINITY : gate.closesS - elapsedS;
      return gate.state === 'closing' || secondsLeft <= TUNING.gate.closingWarnS
        ? 'closing'
        : 'open';
    }

    if (gate.state === 'spent') return 'spent';

    // Still shut. Two reasons to draw it: it opens soon, or it JUST closed.
    // `previewS` (60s) is read from TUNING, never as a literal: it was raised
    // from §14.2's 30 precisely because the first two minutes of a run had no
    // extraction signal at all.
    const untilOpen = gate.opensS - elapsedS;
    if (untilOpen > 0 && untilOpen <= TUNING.gate.previewS) return 'preview';

    const lastLive = this.lastLiveS.get(gate.id);
    if (lastLive !== undefined && (elapsedS - lastLive) * 1000 <= CLOSED_FLASH_MS) return 'closed';

    return null;
  }

  private labelFor(gate: GateCompassGate, elapsedS: number, look: ArrowLook): string {
    switch (look) {
      case 'preview':
        return `OPENS ${clock(gate.opensS - elapsedS)}`;
      case 'open':
      case 'closing':
        // Gate C never closes, so a countdown there would be a lie: it is
        // simply OPEN until the Collapse takes the arena.
        return gate.closesS === null ? 'OPEN' : `CLOSES ${clock(gate.closesS - elapsedS)}`;
      case 'closed':
        return 'CLOSED';
      case 'spent':
        return 'SPENT';
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const arrow of this.arrows.values()) arrow.destroy();
    this.arrows.clear();
    this.lastLiveS.clear();
  }
}
