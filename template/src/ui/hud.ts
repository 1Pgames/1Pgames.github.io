import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../config';
import { TEX } from '../core/keys';
import { pop } from '../core/juice';
import { ICON } from '../data/art';
import { Bar } from './bars';

/**
 * In-run readout for the survivor-like slice: HP + XP bars, level badge, run
 * clock, meta currency and kill count, plus a transient phase banner.
 *
 * The owning `GameScene` calls `set(model)` once per frame with the latest
 * snapshot. Every field is diffed against the last rendered value before any
 * `setText`/`setValue` call runs — with up to 220 live enemies the frame
 * budget has nothing to spare for redundant text layout or bar tweens.
 *
 * Use for: the always-on survivor-like HUD (HP/XP/level/timer/economy).
 * Do NOT use for: modal overlays (draft cards, pause menu) — those are their
 * own containers built on demand, not part of this always-visible layer.
 */

const HP_BAR_WIDTH = 240;
const HP_BAR_HEIGHT = 30;
const XP_BAR_HEIGHT = 24;
const BADGE_SIZE = 56;

/**
 * The generated bar chrome carries a transparent margin, so a bar's footprint
 * is ~3x its visible height (see `NINE_SLICE.bar` / `inflate`). Rows are spaced
 * for that footprint, not for the visible capsule, or the top row clips.
 */
const ROW_Y = 64;
const BADGE_X = SAFE.side + BADGE_SIZE / 2;
const HP_BAR_X = BADGE_X + BADGE_SIZE / 2 + 18 + HP_BAR_WIDTH / 2;
const XP_BAR_Y = ROW_Y + 76;
const XP_BAR_WIDTH = VIEW.width - SAFE.side * 2;
const SIDE_TEXT_X = VIEW.width - SAFE.side;
const CURRENCY_Y = ROW_Y - 20;
const KILLS_Y = ROW_Y + 20;
const PHASE_BANNER_Y = SAFE.top + 120;

/** Snapshot handed to `Hud.set` every frame. */
export interface HudModel {
  hp: number;
  hpMax: number;
  level: number;
  xp: number;
  xpNeeded: number;
  timeMs: number;
  runSeconds: number;
  currency: number;
  kills: number;
  phase: string;
}

/** mm:ss clock, floored to the second so the label only changes once a second. */
function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Sentinel cache — every field starts at a value no real model can produce. */
interface Cache {
  hp: number;
  hpMax: number;
  level: number;
  xp: number;
  xpNeeded: number;
  currency: number;
  kills: number;
  timerLabel: string;
  phase: string | null;
}

export class Hud extends Phaser.GameObjects.Container {
  private readonly hpBar: Bar;
  private readonly xpBar: Bar;
  private readonly hpFlash: Phaser.GameObjects.Image;
  private readonly levelBadge: Phaser.GameObjects.Image;
  private readonly levelText: Phaser.GameObjects.Text;
  private readonly timerText: Phaser.GameObjects.Text;
  private readonly currencyText: Phaser.GameObjects.Text;
  private readonly killsText: Phaser.GameObjects.Text;
  private readonly phaseBanner: Phaser.GameObjects.Text;

  private readonly cache: Cache = {
    hp: -1,
    hpMax: -1,
    level: -1,
    xp: -1,
    xpNeeded: -1,
    currency: -1,
    kills: -1,
    timerLabel: '',
    phase: null,
  };

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.setDepth(1000).setScrollFactor(0);

    this.hpBar = new Bar(scene, HP_BAR_X, ROW_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT, {
      color: PALETTE.bad,
      bgColor: PALETTE.bgTop,
    });
    this.hpFlash = scene.add
      .image(HP_BAR_X, ROW_Y, TEX.square)
      .setDisplaySize(HP_BAR_WIDTH, HP_BAR_HEIGHT)
      .setTint(0xffffff)
      .setAlpha(0);

    this.levelBadge = scene.add
      .image(BADGE_X, ROW_Y, TEX.disc)
      .setDisplaySize(BADGE_SIZE, BADGE_SIZE)
      .setTint(PALETTE.primary);
    this.levelText = scene.add
      .text(BADGE_X, ROW_Y, '1', { ...TEXT.button, fontSize: '32px', color: '#05070d' })
      .setOrigin(0.5);

    this.xpBar = new Bar(scene, VIEW.centerX, XP_BAR_Y, XP_BAR_WIDTH, XP_BAR_HEIGHT, {
      color: PALETTE.accent,
      bgColor: PALETTE.bgTop,
    });

    this.timerText = scene.add
      .text(VIEW.centerX, XP_BAR_Y + 26, '0:00 / 0:00', { ...TEXT.label, color: CSS.ink })
      .setOrigin(0.5);

    // Generated icon glyphs instead of text symbols: one sheet, one frame each.
    const coinIcon = scene.add
      .image(SIDE_TEXT_X - 74, CURRENCY_Y, ICON.coin.key, ICON.coin.frame)
      .setDisplaySize(34, 34)
      .setOrigin(1, 0.5);
    const skullIcon = scene.add
      .image(SIDE_TEXT_X - 74, KILLS_Y, ICON.skull.key, ICON.skull.frame)
      .setDisplaySize(34, 34)
      .setOrigin(1, 0.5);
    const heartIcon = scene.add
      .image(HP_BAR_X - HP_BAR_WIDTH / 2 - 22, ROW_Y, ICON.heart.key, ICON.heart.frame)
      .setDisplaySize(34, 34)
      .setOrigin(1, 0.5);

    this.currencyText = scene.add
      .text(SIDE_TEXT_X, CURRENCY_Y, '0', { ...TEXT.label, color: CSS.accent })
      .setOrigin(1, 0.5);
    this.killsText = scene.add
      .text(SIDE_TEXT_X, KILLS_Y, '0', { ...TEXT.label, color: CSS.inkSoft })
      .setOrigin(1, 0.5);

    this.phaseBanner = scene.add
      .text(VIEW.centerX, PHASE_BANNER_Y, '', { ...TEXT.heading, color: CSS.accent })
      .setOrigin(0.5)
      .setAlpha(0);

    this.add([
      this.hpBar,
      this.hpFlash,
      heartIcon,
      this.levelBadge,
      this.levelText,
      this.xpBar,
      this.timerText,
      coinIcon,
      skullIcon,
      this.currencyText,
      this.killsText,
      this.phaseBanner,
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

    if (model.level !== this.cache.level) {
      this.cache.level = model.level;
      this.levelText.setText(`${model.level}`);
    }

    const timerLabel = `${formatClock(model.timeMs)} / ${formatClock(model.runSeconds * 1000)}`;
    if (timerLabel !== this.cache.timerLabel) {
      this.cache.timerLabel = timerLabel;
      this.timerText.setText(timerLabel);
    }

    if (model.currency !== this.cache.currency) {
      this.cache.currency = model.currency;
      this.currencyText.setText(`${model.currency}`);
    }

    if (model.kills !== this.cache.kills) {
      this.cache.kills = model.kills;
      this.killsText.setText(`${model.kills}`);
    }

    if (model.phase !== this.cache.phase) {
      const isFirst = this.cache.phase === null;
      this.cache.phase = model.phase;
      if (!isFirst && model.phase) this.showPhaseBanner(model.phase);
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
    pop(this.scene, this.hpBar, 0.22, 160);
  }

  private showPhaseBanner(label: string): void {
    this.phaseBanner.setText(label.toUpperCase());
    this.phaseBanner.setAlpha(0);
    this.phaseBanner.setScale(0.9);
    this.scene.tweens.add({
      targets: this.phaseBanner,
      alpha: { from: 0, to: 1 },
      scale: { from: 0.9, to: 1 },
      duration: 220,
      hold: 1200,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }
}
