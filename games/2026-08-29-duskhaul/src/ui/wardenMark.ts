import Phaser from 'phaser';
import { CSS, TEXT, VIEW, bareText } from '../config';
import { paintPill } from './primitives';
import { HUD_DEPTH, IDENTITY, PANEL, drawDuskPanel, paintBar } from './duskChrome';

/**
 * The Warden marker: a screen-space HP plate plus an off-screen direction
 * arrow, live for exactly as long as the Gate Warden is.
 *
 * WHY THIS EXISTS. The Warden takes station at Gate C `warden.spawnOffsetPx`
 * off the arch (`slices/arena/game.ts:spawnWarden`), which is almost always
 * OFF CAMERA at 420s, and the only readout it carried was `objects/enemy.ts`'s
 * world-space `Bar` — a bar drawn on top of a body the camera cannot see. The
 * playtest read of that frame was "the lanes switched off", not "a boss
 * arrived": with the Climax lanes stopping at `warden.beatFromS` the Warden IS
 * that window's tension, so it needs a marker that survives the 620ms
 * entrance banner.
 *
 * Two channels, both persistent, both about a body rather than about a place:
 * the PLATE says how much boss is left, the ARROW says which way it is. The
 * arrow drops the instant the Warden is comfortably inside the frame — at that
 * point the 120px generated sheet with its own HP bar is the "where", and a
 * triangle on top of it is a third widget on one band (the rule
 * `ui/gateCompass.ts` arrived at for the gate arrows, kept here deliberately so
 * the two edge cues behave identically).
 *
 * Use for: a single named body whose position the player must be able to find
 * while it is off camera.
 * Do NOT use for: gates (that is `ui/gateCompass.ts`, which owns three arrows,
 * their countdown chips and their declutter pass) or for ordinary elites, whose
 * world-space bars are enough because they walk in on screen.
 */

/**
 * Plate geometry. §14.1's HUD band ends at 140 and §14.2's compass ring starts
 * at 200, so a 60px plate centred at 172 lands in the one clear strip between
 * them — the boss bar never covers the HP/XP rows and never covers a gate
 * countdown chip.
 */
const PLATE = { x: VIEW.centerX, y: 172, width: 460, height: 60 } as const;

/** Bar inside the plate: full width less the panel's own padding. */
const BAR = { width: 404, height: 16, offsetY: 13 } as const;

/** The name line sits above the bar, inside the same plate. */
const NAME_OFFSET_Y = -13;

/**
 * Arrow ring. Same left/right/bottom band §14.2 authors for the gate arrows,
 * with the TOP pushed below the plate (202) plus the arrow's own half-height,
 * so the marker's two halves can never draw over each other.
 */
const RING = { left: 40, right: 680, top: 234, bottom: 1000 } as const;

const ARROW_SIZE = 44;

/**
 * Chip beside the arrow — fixed label, so its width is fixed and never
 * measured. `inset` is how far INBOARD of its own arrow the chip is pushed;
 * see `update` for why "below the arrow" is the one place it cannot go.
 */
const CHIP = { width: 128, height: 24, inset: 88 } as const;

/**
 * How far inside the frame the Warden must be before the arrow is dropped.
 * Matches the compass's own inset: a pointer to something you can already see
 * is noise.
 */
const ONSCREEN_INSET = 120;

/** The bar is REDRAWN, never scaled, so it repaints only on a real change. */
const HP_EPSILON = 0.004;

export interface WardenMarkModel {
  playerX: number;
  playerY: number;
  wardenX: number;
  wardenY: number;
  /** 0..1 of the Warden's own max HP. */
  hpRatio: number;
}

export class WardenMark {
  private readonly plate: Phaser.GameObjects.Container;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly head: Phaser.GameObjects.Graphics;
  private readonly chip: Phaser.GameObjects.Graphics;
  private readonly chipText: Phaser.GameObjects.Text;
  /** The entrance tween, held so `destroy` can kill it mid-slide. */
  private readonly entrance: Phaser.Tweens.Tween;
  /**
   * The arrow's breathing loop. ONE tween, created when the arrow appears and
   * killed the moment it goes away or the marker dies — a `repeat: -1` tween
   * outliving its view is the leak class AGENTS.md calls out.
   */
  private pulse: Phaser.Tweens.Tween | null = null;
  private pointing = false;
  private drawnHp = -1;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    const panel = drawDuskPanel(scene, PLATE.width, PLATE.height, {
      fill: PANEL.fill,
      stroke: IDENTITY.threat,
      strokeAlpha: 0.85,
    });
    this.bar = scene.add.graphics().setPosition(0, BAR.offsetY);
    paintBar(this.bar, BAR.width, BAR.height, 1, IDENTITY.threat);
    // `warn` amber on its own panel: §11 bars `bad` as a text tone, and the
    // panel is the contrast surface, so the label goes bare.
    const name = scene.add
      .text(0, NAME_OFFSET_Y, 'THE WARDEN — BLEAK ARCH', {
        ...TEXT.label,
        fontSize: '22px',
        color: CSS.warn,
        ...bareText(),
      })
      .setOrigin(0.5);

    this.plate = scene.add
      .container(PLATE.x, PLATE.y, [panel, this.bar, name])
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH.warden)
      .setAlpha(0);
    // A launch curve dropping into the band — 220ms, inside the core-loop
    // tempo band, so the plate is readable well before the banner clears.
    this.entrance = scene.tweens.add({
      targets: this.plate,
      alpha: 1,
      y: { from: PLATE.y - 34, to: PLATE.y },
      duration: 220,
      ease: 'Back.easeOut',
    });

    this.head = scene.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH.warden)
      .setVisible(false);
    // A triangle pointing along +x from its origin; rotation aims it, so a
    // clamped arrow still points at the real body.
    const h = ARROW_SIZE / 2;
    this.head.fillStyle(IDENTITY.threat, 1);
    this.head.beginPath();
    this.head.moveTo(h, 0);
    this.head.lineTo(-h * 0.7, -h * 0.85);
    this.head.lineTo(-h * 0.7, h * 0.85);
    this.head.closePath();
    this.head.fillPath();

    this.chip = scene.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH.warden)
      .setVisible(false);
    paintPill(this.chip, CHIP.width, CHIP.height, {
      fill: PANEL.fill,
      fillAlpha: 0.95,
      stroke: IDENTITY.threat,
      strokeAlpha: 0.85,
      strokeWidth: 2,
    });
    this.chipText = scene.add
      .text(0, 0, 'WARDEN', { ...TEXT.label, fontSize: '18px', color: CSS.ink, ...bareText() })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH.warden + 1)
      .setVisible(false);
  }

  update(model: WardenMarkModel): void {
    if (this.destroyed) return;

    if (Math.abs(model.hpRatio - this.drawnHp) > HP_EPSILON) {
      this.drawnHp = model.hpRatio;
      paintBar(this.bar, BAR.width, BAR.height, model.hpRatio, IDENTITY.threat);
    }

    const view = this.scene.cameras.main.worldView;
    // A camera that has not rendered yet reports a zero-size view; projecting
    // through it would park the arrow in a corner for one frame.
    const projecting = view.width > 0 && view.height > 0;
    if (!projecting) {
      this.setPointing(false);
      return;
    }
    const screenX = model.wardenX - view.x;
    const screenY = model.wardenY - view.y;
    if (
      screenX > ONSCREEN_INSET &&
      screenX < view.width - ONSCREEN_INSET &&
      screenY > ONSCREEN_INSET &&
      screenY < view.height - ONSCREEN_INSET
    ) {
      this.setPointing(false);
      return;
    }

    // Rotation comes from the UNCLAMPED target, so the clamped arrow points at
    // the Warden rather than at its own clamped position.
    const angle = Math.atan2(screenY - (model.playerY - view.y), screenX - (model.playerX - view.x));
    const x = Phaser.Math.Clamp(screenX, RING.left + ARROW_SIZE / 2, RING.right - ARROW_SIZE / 2);
    const y = Phaser.Math.Clamp(screenY, RING.top, RING.bottom);
    // The chip goes INBOARD of its own arrow, never under it. §14.2's gate
    // chips sit directly below their arrows on this same ring, and the Warden
    // stands ON Gate C by design (`TUNING.warden.gate`), so the space under the
    // arrow is the one whose occupant is guaranteed: measured in a driven 420s
    // run, the WARDEN chip landed 4px off Gate C's own chip and the two labels
    // read as one word. Shifting toward screen centre — on whichever axis the
    // arrow is actually clamped — separates the boss marker from the gate
    // marker by construction, with no cross-module declutter pass to keep in
    // sync.
    const clampedX = x <= RING.left + ARROW_SIZE || x >= RING.right - ARROW_SIZE;
    const chipX = clampedX
      ? Phaser.Math.Clamp(
          x < VIEW.centerX ? x + CHIP.inset : x - CHIP.inset,
          RING.left + CHIP.width / 2,
          RING.right - CHIP.width / 2,
        )
      : Phaser.Math.Clamp(x, RING.left + CHIP.width / 2, RING.right - CHIP.width / 2);
    const chipY = clampedX ? y : y >= RING.bottom - CHIP.inset ? y - CHIP.inset : y + CHIP.inset;
    this.head.setPosition(x, y).setRotation(angle);
    this.chip.setPosition(chipX, chipY);
    this.chipText.setPosition(chipX, chipY);
    this.setPointing(true);
  }

  /** Visibility and the pulse move together — a hidden head must not tween. */
  private setPointing(on: boolean): void {
    if (on === this.pointing) return;
    this.pointing = on;
    this.head.setVisible(on);
    this.chip.setVisible(on);
    this.chipText.setVisible(on);
    if (on) {
      this.pulse = this.scene.tweens.add({
        targets: this.head,
        scale: 1.16,
        duration: 340,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      return;
    }
    this.pulse?.remove();
    this.pulse = null;
    this.head.setScale(1);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pulse?.remove();
    this.pulse = null;
    this.entrance.remove();
    this.plate.destroy();
    this.head.destroy();
    this.chip.destroy();
    this.chipText.destroy();
  }
}
