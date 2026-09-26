import Phaser from 'phaser';
import { PALETTE, PLAYER_BASE_STATS, TUNING } from '../config';
import { TEX } from '../core/keys';
import { ANIM, artFacesRight } from '../data/art';
import { Health } from '../core/damage';
import { StatBlock, type Modifier } from '../core/stats';
import { outlineKey, shadowTexture } from '../core/outline';
import { actionScale, displaySizeFor } from '../data/enemies';
import type { ClassId } from '../data/types-v2';
import { xpNeeded } from '../data/upgrades';

/**
 * The hero (PRD-V2 §5.1, §13.1): a stat-driven body sized so its silhouette is
 * `player.visiblePx` tall (cell `displaySizeFor('hero-idle', 112)` = 162),
 * a `player.bodyRadius` 34 px hitbox, the baked GREEN outline on every
 * animation, an `fx-shadow` at 0.45 under the feet and an HP ring under the
 * feet below 50% HP. Combat lives in `systems/combat.ts`.
 *
 * Class passives (§5.3) that live on the body: Gravewarden's knockback ×2
 * (`knockbackMul`), Widowblade's crit heal (`onCrit`, 1 hp, max 5/s). The
 * rest are stat mods from `runLoadout` (Meta) or read elsewhere by
 * `classId` (Ashwitch burn duration → weapons; Duskhauler vein shards → POI).
 */

/** External drift is clamped to this share of the hero's current speed (critic B3 anti-pin). */
const DRIFT_CAP = 0.5;
/** Widowblade Grief Edge: crits restore 1 hp, at most 5 per second. */
const CRIT_HEAL_PER_S = 5;
/** HP ring under the feet shows below this ratio (§13.1). */
const HP_RING_BELOW = 0.5;
/** Feet line of the hero sheets (sprite-metadata `anchorYMean`). */
const FEET_Y = 0.846;

export class Player extends Phaser.Physics.Arcade.Sprite {
  readonly stats: StatBlock;
  readonly health: Health;
  readonly classId: ClassId;
  /** Contact knockback multiplier applied by combat (Gravewarden ×2). */
  readonly knockbackMul: number;
  /** Display size of the loop cell (world px). */
  readonly displaySize: number;
  level = 1;
  xp = 0;

  private targetX: number | null = null;
  private targetY: number | null = null;
  private axisX = 0;
  private axisY = 0;
  private regenCarry = 0;
  private action: string | null = null;
  private channelling = false;
  /** External drift this frame (magnetic affix, gust), px/s; cleared after each tick. */
  private driftX = 0;
  private driftY = 0;
  /** Forced displacement (hook pull): px/s for `shoveMs`. */
  private shoveVx = 0;
  private shoveVy = 0;
  private shoveMs = 0;
  private critHealWindowMs = 0;
  private critHealed = 0;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly hpRing: Phaser.GameObjects.Graphics;
  private hpRingDrawn = -1;

  constructor(scene: Phaser.Scene, x: number, y: number, mods: readonly Modifier[] = [], classId: ClassId = 'duskhauler') {
    super(scene, x, y, ANIM.heroIdle);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.classId = classId;
    this.knockbackMul = classId === 'gravewarden' ? 2 : 1;

    this.stats = new StatBlock(PLAYER_BASE_STATS);
    for (const mod of mods) this.stats.addModifier(mod);

    this.health = new Health(this.stats.get('maxHp'));
    this.health.invulnMs = TUNING.player.invulnMs;

    this.displaySize = displaySizeFor(ANIM.heroIdle, TUNING.player.visiblePx);
    this.setDisplaySize(this.displaySize, this.displaySize).setDepth(20);
    // Hitbox: `player.bodyRadius` WORLD px centred on the sprite (x, y).
    const rs = TUNING.player.bodyRadius / (this.displaySize / 256);
    this.body?.setCircle(rs, 128 - rs, 128 - rs);
    this.setCollideWorldBounds(true);

    this.shadow = scene.add.image(x, y, shadowTexture(scene)).setDepth(8).setAlpha(0.45);
    const sw = TUNING.player.visiblePx * 0.8;
    this.shadow.setDisplaySize(sw, sw * 0.4);
    this.hpRing = scene.add.graphics().setDepth(8.5);
    this.playArt(ANIM.heroIdle);
  }

  setMoveTarget(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  clearMoveTarget(): void {
    this.targetX = null;
    this.targetY = null;
  }

  /** Stick/keyboard intent; magnitude is the throttle (0..1). */
  setAxis(ax: number, ay: number): void {
    this.axisX = ax;
    this.axisY = ay;
  }

  applyModifier(mod: Modifier): void {
    this.stats.addModifier(mod);
    if (mod.stat === 'maxHp') this.health.setMax(this.stats.get('maxHp'), true);
    if (mod.stat === 'pickupRadius') this.pulsePickupRadius();
  }

  xpNeeded(): number {
    return xpNeeded(this.level);
  }

  /** Adds XP (× `xpMul`) and returns the levels gained. */
  addXp(amount: number): number {
    this.xp += amount * this.stats.get('xpMul');
    let gained = 0;
    let needed = this.xpNeeded();
    while (this.xp >= needed) {
      this.xp -= needed;
      this.level += 1;
      gained += 1;
      needed = this.xpNeeded();
    }
    return gained;
  }

  /** Adds external drift for this frame (summed; cleared after `tick`). */
  drift(vx: number, vy: number): void {
    this.driftX += vx;
    this.driftY += vy;
  }

  /** Ignores external drift for `ms` (anti-pin breakout). */
  freeFromDrift(ms: number): void {
    this.driftFreeMs = Math.max(this.driftFreeMs, ms);
  }

  /** Base-speed px/s the input asked for on the last tick (0 while shoved or idle). */
  intentSpeed = 0;
  private driftFreeMs = 0;

  /** Forced move of (dx, dy) px over `ms` (hook pull, §5.4 Gibbet Wight). */
  shove(dx: number, dy: number, ms: number): void {
    this.shoveMs = ms;
    this.shoveVx = (dx / ms) * 1000;
    this.shoveVy = (dy / ms) * 1000;
  }

  /** Widowblade Grief Edge (§5.3): a crit heals 1 hp, capped 5/s. */
  onCrit(): void {
    if (this.classId !== 'widowblade' || this.critHealed >= CRIT_HEAL_PER_S) return;
    this.critHealed += 1;
    this.health.heal(1);
  }

  tick(deltaMs: number): void {
    const speed = this.stats.get('moveSpeed');
    let vx = 0;
    let vy = 0;
    if (this.axisX !== 0 || this.axisY !== 0) {
      const len = Math.hypot(this.axisX, this.axisY);
      const throttle = Math.min(1, len);
      vx = (this.axisX / len) * speed * throttle;
      vy = (this.axisY / len) * speed * throttle;
    } else if (this.targetX !== null && this.targetY !== null) {
      const dx = this.targetX - this.x;
      const dy = this.targetY - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= 4) {
        const magnitude = Math.min(speed, (dist * TUNING.player.followLerp) / 0.016);
        vx = (dx / dist) * magnitude;
        vy = (dy / dist) * magnitude;
      }
    }
    // Speed the player ASKED for this frame (unslowed base × throttle): the anti-pin
    // detector in combat compares real displacement against it (critic B3).
    this.intentSpeed = this.shoveMs > 0 ? 0 : (Math.hypot(vx, vy) / Math.max(1, speed)) * PLAYER_BASE_STATS.moveSpeed;
    if (this.shoveMs > 0) {
      this.shoveMs -= deltaMs;
      vx = this.shoveVx;
      vy = this.shoveVy;
    }
    // External drift (magnetic elites, gust) sums across sources; clamp it to half the
    // hero's speed so stacked pulls can slow the hero but never hold it (critic B3).
    const drift = Math.hypot(this.driftX, this.driftY);
    const driftCap = speed * DRIFT_CAP;
    const k = this.driftFreeMs > 0 ? 0 : drift > driftCap ? driftCap / drift : 1;
    if (this.driftFreeMs > 0) this.driftFreeMs -= deltaMs;
    this.setVelocity(vx + this.driftX * k, vy + this.driftY * k);
    this.driftX = 0;
    this.driftY = 0;

    const regen = this.stats.get('regenPerS');
    if (regen > 0 && this.health.hp < this.health.max && this.health.hp > 0) {
      this.regenCarry += (regen * deltaMs) / 1000;
      if (this.regenCarry >= 1) {
        const whole = Math.floor(this.regenCarry);
        this.regenCarry -= whole;
        this.health.heal(whole);
      }
    }
    this.critHealWindowMs += deltaMs;
    if (this.critHealWindowMs >= 1000) {
      this.critHealWindowMs = 0;
      this.critHealed = 0;
    }

    this.syncLocomotion();
    this.syncFeet();
  }

  /** Shadow + HP ring under the feet (§13.1). */
  private syncFeet(): void {
    const feet = this.y + (FEET_Y * 256 - 128) * (this.displaySize / 256);
    this.shadow.setPosition(this.x, feet);
    const ratio = this.health.ratio;
    const show = ratio < HP_RING_BELOW && ratio > 0;
    const bucket = show ? Math.round(ratio * 40) : -1;
    if (bucket !== this.hpRingDrawn) {
      this.hpRingDrawn = bucket;
      this.hpRing.clear();
      if (show) {
        const r = TUNING.player.visiblePx * 0.42;
        this.hpRing.lineStyle(5, 0x03040b, 0.7);
        this.hpRing.strokeEllipse(0, 0, r * 2, r * 0.8);
        this.hpRing.lineStyle(4, ratio < 0.3 ? PALETTE.bad : PALETTE.good, 0.95);
        this.hpRing.beginPath();
        const steps = 40;
        const end = Math.max(1, Math.round(steps * ratio * 2));
        for (let i = 0; i <= Math.min(steps, end); i += 1) {
          const a = -Math.PI / 2 + (i / steps) * Math.PI * 2;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r * 0.4;
          if (i === 0) this.hpRing.moveTo(px, py);
          else this.hpRing.lineTo(px, py);
        }
        this.hpRing.strokePath();
      }
    }
    this.hpRing.setPosition(this.x, feet);
  }

  setChannelling(on: boolean): void {
    if (this.channelling === on) return;
    this.channelling = on;
    if (on) {
      this.action = null;
      this.playArt(ANIM.heroChannel);
      return;
    }
    this.syncLocomotion(true);
  }

  /** One-shot action (hurt, extract, death), then back to locomotion. */
  playAction(key: string): void {
    if (this.channelling || this.action === key) return;
    this.action = key;
    this.playArt(key);
    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.action !== key) return;
      this.action = null;
      this.syncLocomotion(true);
    });
  }

  private syncLocomotion(force = false): void {
    if (this.channelling) return;
    if (this.action !== null && !force) return;
    const vx = this.body?.velocity.x ?? 0;
    const moving = Math.abs(vx) + Math.abs(this.body?.velocity.y ?? 0) > 24;
    const want = moving ? ANIM.heroRun : ANIM.heroIdle;
    if (this.currentBase() !== want) this.playArt(want);
    if (moving) this.faceVelocity(vx);
  }

  private currentBase(): string | undefined {
    const key = this.anims.currentAnim?.key;
    return key?.endsWith('-ol') === true ? key.slice(0, -3) : key;
  }

  /** Plays the GREEN-outlined variant (§13.1) when baked; re-applies per-action scale. */
  private playArt(key: string): void {
    const size = this.displaySize * actionScale(ANIM.heroIdle, key);
    const ol = outlineKey(key, TUNING.outline.heroPx as 3);
    this.play(this.scene.anims.exists(ol) ? ol : key, true);
    this.setDisplaySize(size, size);
    this.faceVelocity(this.body?.velocity.x ?? 0);
  }

  private faceVelocity(vx: number): void {
    if (vx === 0) return;
    const key = this.currentBase() ?? ANIM.heroIdle;
    this.setFlipX(artFacesRight(key) ? vx < 0 : vx > 0);
  }

  destroyAll(): void {
    this.shadow.destroy();
    this.hpRing.destroy();
    this.destroy();
  }

  private pulsePickupRadius(): void {
    const radius = this.stats.get('pickupRadius');
    const ring = this.scene.add
      .image(this.x, this.y, TEX.ring)
      .setTint(PALETTE.good)
      .setDisplaySize(radius * 0.6, radius * 0.6)
      .setAlpha(0.5)
      .setDepth(6);
    this.scene.tweens.add({
      targets: ring,
      displayWidth: radius * 2,
      displayHeight: radius * 2,
      alpha: 0,
      duration: 520,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }
}
