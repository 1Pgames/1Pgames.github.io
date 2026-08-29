import Phaser from 'phaser';
import { CSS, PALETTE, TEXT, VIEW } from '../config';
import { HUD_DEPTH, SCRIM } from './duskChrome';
import { Bar } from './bars';

/**
 * In-run readout for the extraction survivor-like: the §14.1 HUD band, exactly
 * the widgets §14.1 authorises and no others.
 *
 * The owning `GameScene` calls `set(model)` once per frame with the latest
 * snapshot. Every field is diffed against the last rendered value before any
 * `setText`/`setValue` call runs — with up to 220 live enemies the frame
 * budget has nothing to spare for redundant text layout or bar tweens.
 *
 * WHAT THIS COMPONENT OWNS (§14.1 rows 1, 3 and 6, plus the §14.3 banner
 * band): the run clock + phase label, the HP bar, the XP bar and the transient
 * phase/COLLAPSE banner. The bag pips and the shard counter are `ui/bagPips.ts`
 * (§14.1 rows 4 and 5) and the pause button is the slice's (row 2). Nothing
 * else is in the band: the Step 5.5 audit found this component still carrying
 * the template's level badge, kill counter and a SECOND shard counter, which
 * put four unauthorised readouts over the arena — the level badge fouling the
 * pause disc, the counters unscrimmed in the top-left, and the clock centred
 * at y=186 straight through the XP bar. Level is announced by the draft and
 * reported in results; kills are a `ResultStat`. §14.1's hierarchy note is
 * explicit that the XP bar is "ambient, thinnest, bottom of the band; never
 * competes", which a 56px level badge next to it did not honour.
 *
 * Use for: the always-on in-run HUD.
 * Do NOT use for: modal overlays (draft cards, pause menu) — those are their
 * own containers built on demand, not part of this always-visible layer.
 */

/** §14.1 row 1: run clock + phase label, left-aligned at (336, 16), 240x40. */
const CLOCK = { x: 336, y: 16, width: 240, height: 40 } as const;

/** §14.1 row 3: HP bar at (40, 84), 300x28 — top edge 9px clear of the shell corner. */
const HP_BAR = { x: 40, y: 84, width: 300, height: 28 } as const;

/** §14.1 row 6: XP bar at (40, 124), 640x12 — band C, inside the 140 line. */
const XP_BAR = { x: 40, y: 124, width: 640, height: 12 } as const;

/**
 * §14.3 banner band: x 40-680, y 300-400, one at a time, queued, SCRIMMED.
 * The template put this at y=260, which is outside the band and inside the
 * floater rect.
 */
const BANNER = { y: 350, width: 640, height: 64 } as const;

/** Snapshot handed to `Hud.set` every frame. */
export interface HudModel {
  hp: number;
  hpMax: number;
  level: number;
  xp: number;
  xpNeeded: number;
  timeMs: number;
  runSeconds: number;
  /**
   * Phase label. A change floats the §14.3 banner; the value itself is never
   * a permanent widget (§14.1 folds the phase into the clock row).
   */
  phase: string | null;
  /** True once the Collapse has ignited: the clock reads COLLAPSE in `warn`. */
  collapsing: boolean;
}

/** mm:ss clock, floored to the second so the label only changes once a second. */
function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Sentinel cache — every field starts at a value no real model can produce. */
interface Cache {
  hp: number;
  hpMax: number;
  level: number;
  xp: number;
  xpNeeded: number;
  clockLabel: string;
  clockTone: string;
  phase: string | null;
}

export class Hud extends Phaser.GameObjects.Container {
  private readonly hpBar: Bar;
  private readonly xpBar: Bar;
  private readonly hpFlash: Phaser.GameObjects.Graphics;
  private readonly clockText: Phaser.GameObjects.Text;
  private readonly banner: Phaser.GameObjects.Text;
  private readonly bannerScrim: Phaser.GameObjects.Graphics;
  private bannerTween: Phaser.Tweens.Tween | null = null;

  private readonly cache: Cache = {
    hp: -1,
    hpMax: -1,
    level: -1,
    xp: -1,
    xpNeeded: -1,
    clockLabel: '',
    clockTone: '',
    phase: null,
  };

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.setDepth(HUD_DEPTH.hud).setScrollFactor(0);

    // §14.4: the HUD band draws over the zone's generated floor, so the clock
    // — the one HUD widget that is bare text rather than a housing — sits on
    // the authored scrim. `paintScrim` is not reused here because the band is
    // a fixed strip drawn once, not a text-block-sized veil.
    const clockScrim = scene.add.graphics();
    clockScrim.fillStyle(SCRIM.fill, SCRIM.alpha);
    clockScrim.fillRoundedRect(
      CLOCK.x - SCRIM.pad,
      CLOCK.y - 4,
      CLOCK.width + SCRIM.pad * 2,
      CLOCK.height + 8,
      SCRIM.radius,
    );

    // Left-aligned at the authored x so the block can never creep back under
    // the shell corner as the label grows from "0:00 / 8:00" to "COLLAPSE".
    this.clockText = scene.add
      .text(CLOCK.x, CLOCK.y + CLOCK.height / 2, '0:00 / 8:00', { ...TEXT.label, color: CSS.ink })
      .setOrigin(0, 0.5);

    // §14.4: HP fill `primary`, lerping to `bad` below 30%. The template built
    // this bar with `color: PALETTE.bad`, so a full-health bar rendered red.
    this.hpBar = new Bar(
      scene,
      HP_BAR.x + HP_BAR.width / 2,
      HP_BAR.y + HP_BAR.height / 2,
      HP_BAR.width,
      HP_BAR.height,
      { color: PALETTE.primary, lowColor: PALETTE.bad, lowAt: 0.3 },
    );
    this.hpFlash = scene.add.graphics();
    this.hpFlash
      .fillStyle(0xffffff, 1)
      .fillRoundedRect(HP_BAR.x, HP_BAR.y, HP_BAR.width, HP_BAR.height, 6);
    this.hpFlash.setAlpha(0);

    // §14.4: XP fill `secondary`. It is a FILL, not text, so §11's measured
    // text restriction on `#ad6eef` does not apply.
    this.xpBar = new Bar(
      scene,
      XP_BAR.x + XP_BAR.width / 2,
      XP_BAR.y + XP_BAR.height / 2,
      XP_BAR.width,
      XP_BAR.height,
      { color: PALETTE.secondary },
    );

    // §14.3 banner band, scrimmed. Both objects live at alpha 0 until a beat
    // fires, and one tween drives the pair — a banner is never two animations.
    this.bannerScrim = scene.add.graphics();
    this.bannerScrim.fillStyle(SCRIM.fill, SCRIM.alpha);
    this.bannerScrim.fillRoundedRect(
      VIEW.centerX - BANNER.width / 2,
      BANNER.y - BANNER.height / 2,
      BANNER.width,
      BANNER.height,
      SCRIM.radius,
    );
    this.bannerScrim.setAlpha(0);
    this.banner = scene.add
      .text(VIEW.centerX, BANNER.y, '', { ...TEXT.heading, color: CSS.accent })
      .setOrigin(0.5)
      .setAlpha(0);

    this.add([
      clockScrim,
      this.clockText,
      this.hpBar,
      this.hpFlash,
      this.xpBar,
      this.bannerScrim,
      this.banner,
    ]);

    scene.add.existing(this);
  }

  /** Called every frame; a no-op for every field that has not changed. */
  set(model: HudModel): void {
    if (model.hp !== this.cache.hp || model.hpMax !== this.cache.hpMax) {
      this.cache.hp = model.hp;
      this.cache.hpMax = model.hpMax;
      this.hpBar.setValue(model.hp, model.hpMax);
    }

    if (model.xp !== this.cache.xp || model.xpNeeded !== this.cache.xpNeeded) {
      this.cache.xp = model.xp;
      this.cache.xpNeeded = model.xpNeeded;
      this.xpBar.setValue(model.xp, model.xpNeeded);
    }
    this.cache.level = model.level;

    // §14.1: the clock "turns `warn #f7a446` and reads COLLAPSE during
    // Collapse". Label and tone are diffed separately so the once-a-second
    // text change does not also re-set an unchanged colour.
    const label = model.collapsing
      ? 'COLLAPSE'
      : `${formatClock(model.timeMs)} / ${formatClock(model.runSeconds * 1000)}`;
    if (label !== this.cache.clockLabel) {
      this.cache.clockLabel = label;
      this.clockText.setText(label);
    }
    const tone = model.collapsing ? CSS.warn : CSS.ink;
    if (tone !== this.cache.clockTone) {
      this.cache.clockTone = tone;
      this.clockText.setColor(tone);
    }

    if (model.phase !== this.cache.phase) {
      const isFirst = this.cache.phase === null;
      this.cache.phase = model.phase;
      if (!isFirst && model.phase) this.showBanner(model.phase);
    }
  }

  /** Brief white pulse + squash on the HP bar for a hit; call from `onPlayerHit`. */
  flashDamage(): void {
    this.hpFlash.setAlpha(0);
    this.scene.tweens.add({
      targets: this.hpFlash,
      alpha: { from: 0.7, to: 0 },
      duration: 220,
      ease: 'Quad.easeOut',
    });
  }

  /**
   * §14.3 banner band: one at a time. A second beat arriving mid-flight
   * REPLACES the first rather than stacking a second tween on the same two
   * objects — two tweens fighting over one alpha is how a banner sticks at
   * half opacity forever.
   */
  private showBanner(label: string): void {
    this.bannerTween?.remove();
    this.banner.setText(label.toUpperCase());
    this.banner.setAlpha(0).setScale(0.9);
    this.bannerScrim.setAlpha(0);
    this.bannerTween = this.scene.tweens.add({
      targets: [this.banner, this.bannerScrim],
      alpha: { from: 0, to: 1 },
      duration: 220,
      hold: 1200,
      yoyo: true,
      ease: 'Quad.easeOut',
      onStart: () => {
        this.scene.tweens.add({
          targets: this.banner,
          scale: { from: 0.9, to: 1 },
          duration: 220,
          ease: 'Quad.easeOut',
        });
      },
      onComplete: () => {
        this.bannerTween = null;
      },
    });
  }
}
