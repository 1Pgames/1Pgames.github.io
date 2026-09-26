import Phaser from 'phaser';
import { PALETTE, PLAYER_BASE_STATS, TUNING } from '../config';
import { TEX } from '../core/keys';
import { safePlay } from '../core/anim';
import { ANIM, artFacesRight, artScale } from '../data/art';
import { displaySizeFor } from '../data/enemies';
import { OUTLINE, baseKeyOf, outlineKey } from '../core/outline';
import { Health } from '../core/damage';
import { StatBlock, type Modifier } from '../core/stats';

/** Hero hitbox radius in world px, centred on this source-cell point (the chibi body). */
const HERO_BODY_PX = 26;
const HERO_BODY_CENTER_X = 128;
const HERO_BODY_CENTER_Y = 136;

/**
 * The player avatar for a survivor-like: a stat-driven body that moves toward a
 * drag target (or a keyboard axis), regenerates, holds i-frames, and tracks XP
 * and level. Combat itself lives in `systems/combat.ts` — this class never
 * spawns projectiles, so a different game can reuse it with another weapon
 * system.
 *
 * Use for: the single controllable entity of a run.
 * Do NOT use for: pooled entities (see `objects/enemy.ts`) or anything spawned
 * in bulk — this object is constructed once per run.
 */
export class Player extends Phaser.Physics.Arcade.Sprite {
  readonly stats: StatBlock;
  readonly health: Health;
  level = 1;
  xp = 0;

  private targetX: number | null = null;
  private targetY: number | null = null;
  private axisX = 0;
  private axisY = 0;
  private regenCarry = 0;
  /** Non-null while a one-shot action animation (attack, hurt) is playing. */
  private action: string | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, mods: readonly Modifier[] = []) {
    super(scene, x, y, ANIM.heroIdle);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.stats = new StatBlock(PLAYER_BASE_STATS);
    for (const mod of mods) this.stats.addModifier(mod);

    this.health = new Health(this.stats.get('maxHp'));
    this.health.invulnMs = TUNING.player.invulnMs;

    this.setDepth(20);
    this.playArt(ANIM.heroIdle);
    // The arena sets the physics world bounds; the body keeps the player inside
    // them, so no screen-space clamping (the camera scrolls now).
    this.setCollideWorldBounds(true);

  }

  setMoveTarget(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  clearMoveTarget(): void {
    this.targetX = null;
    this.targetY = null;
  }

  /**
   * Movement intent from a stick or the keyboard. The vector's magnitude is the
   * throttle (0..1), so a half-pushed stick walks — never normalise it here.
   */
  setAxis(ax: number, ay: number): void {
    this.axisX = ax;
    this.axisY = ay;
  }

  /** Upgrade cards and meta upgrades go through here so caps stay in sync. */
  applyModifier(mod: Modifier): void {
    this.stats.addModifier(mod);
    if (mod.stat === 'maxHp') this.health.setMax(this.stats.get('maxHp'), true);
    if (mod.stat === 'pickupRadius') this.pulsePickupRadius();
  }

  xpNeeded(): number {
    return Math.round(TUNING.xp.base * Math.pow(TUNING.xp.growth, this.level - 1));
  }

  /** Adds XP (scaled by the `xpGain` stat) and returns how many levels it gained. */
  addXp(amount: number): number {
    this.xp += amount * this.stats.get('xpGain');
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

  /** Movement, regen and animation state. Called by `CombatSystem`, not the scene. */
  tick(deltaMs: number): void {
    const speed = this.stats.get('moveSpeed');

    if (this.axisX !== 0 || this.axisY !== 0) {
      const len = Math.hypot(this.axisX, this.axisY);
      const throttle = Math.min(1, len);
      this.setVelocity((this.axisX / len) * speed * throttle, (this.axisY / len) * speed * throttle);
    } else if (this.targetX !== null && this.targetY !== null) {
      const dx = this.targetX - this.x;
      const dy = this.targetY - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 4) {
        this.setVelocity(0, 0);
      } else {
        // followLerp is "fraction of the remaining distance per 16ms frame";
        // converting it to a velocity keeps the feel framerate-independent.
        const magnitude = Math.min(speed, (dist * TUNING.player.followLerp) / 0.016);
        this.setVelocity((dx / dist) * magnitude, (dy / dist) * magnitude);
      }
    } else {
      this.setVelocity(0, 0);
    }

    const regen = this.stats.get('regenPerSecond');
    if (regen > 0 && this.health.hp < this.health.max) {
      this.regenCarry += (regen * deltaMs) / 1000;
      if (this.regenCarry >= 1) {
        const whole = Math.floor(this.regenCarry);
        this.regenCarry -= whole;
        this.health.heal(whole);
      }
    }

    this.syncLocomotion();
  }

  /**
   * Plays a one-shot action animation and returns to locomotion afterwards.
   * Called by the combat system on attack and on damage.
   */
  playAction(key: string): void {
    if (this.action === key) return;
    this.action = key;
    this.playArt(key);
    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.action = null;
      this.syncLocomotion(true);
    });
  }

  /** Switches between idle and run without restarting the current animation. */
  private syncLocomotion(force = false): void {
    if (this.action !== null && !force) return;
    const vx = this.body?.velocity.x ?? 0;
    const moving = Math.abs(vx) + Math.abs(this.body?.velocity.y ?? 0) > 24;
    const want = moving ? ANIM.heroRun : ANIM.heroIdle;
    if (baseKeyOf(this.anims.currentAnim?.key ?? '') !== want) this.playArt(want);
    if (moving) this.faceVelocity(vx);
  }

  /**
   * Plays an animation and re-applies its display size. Generated actions do
   * not fill their cell to the same height, so without the per-asset factor the
   * character visibly shrinks or grows when its state changes.
   */
  private playArt(key: string): void {
    // Hero silhouette = `player.visiblePx` (idle), each action sheet scaled by its
    // registry factor so the body never grows or shrinks between states.
    const size = displaySizeFor(ANIM.heroIdle, TUNING.player.visiblePx) * artScale(key);
    this.setDisplaySize(size, size);
    // Hitbox: `HERO_BODY_PX` world px whatever the display size (source px =
    // world × 256 / size), deliberately smaller than the art so grazes feel fair.
    const radius = (HERO_BODY_PX * 256) / size;
    this.body?.setCircle(radius, HERO_BODY_CENTER_X - radius, HERO_BODY_CENTER_Y - radius);
    // The baked GREEN team outline (`core/outline.ts`, declared by the slice); plain sheet if missing.
    const outlined = outlineKey(key, OUTLINE.px.trash);
    if (!safePlay(this, outlined, true)) safePlay(this, key, true);
    this.faceVelocity(this.body?.velocity.x ?? 0);
  }

  /** Mirrors the sprite so it moves face-first, whichever way the art was drawn. */
  private faceVelocity(vx: number): void {
    if (vx === 0) return;
    const key = baseKeyOf(this.anims.currentAnim?.key ?? ANIM.heroIdle);
    this.setFlipX(artFacesRight(key) ? vx < 0 : vx > 0);
  }

  destroyAll(): void {
    this.destroy();
  }

  /**
   * One-shot ring that expands to the new pickup radius when the stat changes.
   * A permanent aura is visual noise — the orbs drift in from anywhere anyway,
   * so the radius only needs communicating at the moment it grows.
   */
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
