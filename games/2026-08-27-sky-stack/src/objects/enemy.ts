import Phaser from 'phaser';
import { PALETTE, TUNING, VIEW } from '../config';
import { TEX } from '../core/keys';
import { Health } from '../core/damage';
import { scaleEnemy, type EnemyDef } from '../data/enemies';
import { Bar } from '../ui/bars';
import { artFacesRight, artScale } from '../data/art';

/**
 * Pooled enemy body. One instance is reused for every archetype: `spawnWith`
 * re-skins it from an `EnemyDef` and `despawn` parks it. Behaviour is a small
 * switch over `EnemyDef.behaviour` — deliberately not a class hierarchy, so 8
 * archetypes cost 8 data records instead of 8 files.
 *
 * Use for: every non-unique combat entity (swarms, elites, bosses).
 * Do NOT use for: the player, or entities needing bespoke multi-phase logic —
 * give those their own class and let this one handle the crowd.
 *
 * Allocation-free in `tickAi` for the steady-state path: telegraphs and boss
 * phase transitions create a handful of one-shot display objects, but only
 * once per event, never per frame.
 */

/** Mirrored by `src/sim/model.ts` — keep both in sync when tuning. */
const CHARGE_WINDUP_MS = 1600;
const CHARGE_DASH_MS = 400;
const CHARGE_DASH_MUL = 2.6;
const CHARGE_WINDUP_MUL = 0.6;
const SHOOT_STANDOFF_PX = 320;
const BOSS_STANDOFF_PX = 380;

export type BossPhase = 1 | 2 | 3;

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  def!: EnemyDef;
  health!: Health;
  damage = 0;
  xpValue = 0;
  /** Set by the combat system when contact damage was last dealt to the player. */
  lastContactAt = 0;
  /** Ranged archetypes fire through this callback, owned by the combat system. */
  onShoot: ((enemy: Enemy) => void) | null = null;
  /** `healAura` archetypes pulse through this callback; combat system heals nearby enemies and paints the ring. */
  onHealPulse: ((enemy: Enemy) => void) | null = null;
  /** Boss-only: fired on a volley/ring attack tick, or on a phase transition (2 = summon, 3 = enrage). */
  onBossAttack: ((enemy: Enemy, kind: 'volley' | 'ring' | 'phase2' | 'phase3') => void) | null = null;

  /** Boss-only: true while summoned adds are alive, set/cleared by the combat system. Halves incoming damage. */
  shielded = false;
  /** Current boss phase (1..3), read by the combat system for UI/telegraph decisions. */
  bossPhase: BossPhase = 1;

  private speed = 0;
  private stateMs = 0;
  private dashMs = 0;
  private orbitAngle = 0;
  private bar: Bar | null = null;

  /** Charge telegraph: windup -> 400ms telegraph (flash + line) -> dash. */
  private telegraphMs = 0;
  private telegraphLine: Phaser.GameObjects.Rectangle | null = null;

  /** Heal-aura pulse cadence. */
  private healAuraMs = 0;

  /** Boss attack cadence + ring telegraph. */
  private bossAttackMs = 0;
  private ringTelegraphMs = 0;
  private ringTelegraphRing: Phaser.GameObjects.Image | null = null;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, TEX.disc);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setActive(false).setVisible(false).setDepth(10);
    this.disableBody();
  }

  spawnWith(def: EnemyDef, x: number, y: number, difficultyMul: number): void {
    const stats = scaleEnemy(def, difficultyMul);
    this.def = def;
    this.health = new Health(stats.maxHp);
    this.damage = stats.damage;
    this.speed = stats.moveSpeed;
    this.xpValue = stats.xp;
    this.lastContactAt = 0;
    this.stateMs = 0;
    this.dashMs = 0;
    this.telegraphMs = 0;
    this.healAuraMs = TUNING.enemy.healAuraIntervalMs;
    this.bossAttackMs = TUNING.boss.volleyCooldownMs;
    this.ringTelegraphMs = 0;
    this.bossPhase = 1;
    this.shielded = false;
    this.orbitAngle = Math.atan2(y - VIEW.centerY, x - VIEW.centerX);
    this.clearTelegraph();
    this.clearRingTelegraph();

    this.setTexture(def.texture);
    this.setPosition(x, y);
    // Per-asset scale keeps archetypes visually consistent even when a sheet
    // does not fill its cell to the same height.
    const size = def.size * artScale(def.texture);
    this.setDisplaySize(size, size);
    // Generated art is already coloured; tinting it would fight the style
    // profile. `def.tint` is only used for particles and damage flashes.
    this.clearTint();
    this.setAngle(0);
    this.setActive(true).setVisible(true);
    this.enableBody(false, x, y, true, true);
    // Body is measured in source-cell pixels: a 256px cell with transparent
    // margin gives a ~60%-of-display hitbox, which matches the visible body.
    this.body?.setCircle(74, 54, 62);
    this.setVelocity(0, 0);
    // Pooled sprites keep the previous animation's frame: always restart.
    if (this.scene.anims.exists(def.texture)) this.play(def.texture, true);

    // HP bars only for the enemies whose HP the player actually tracks.
    if (def.id === 'elite' || def.id === 'boss') {
      this.bar ??= new Bar(this.scene, x, y, def.size + 24, 14);
      this.bar.setVisible(true);
      this.bar.setValue(this.health.hp, this.health.max);
      this.bar.followTarget(this, -def.size * 0.75);
    } else if (this.bar !== null) {
      this.bar.stopFollow();
      this.bar.setVisible(false);
    }
  }

  despawn(): void {
    this.setActive(false).setVisible(false);
    this.setVelocity(0, 0);
    this.disableBody();
    if (this.bar !== null) {
      this.bar.stopFollow();
      this.bar.setVisible(false);
    }
    this.clearTelegraph();
    this.clearRingTelegraph();
  }

  /** Refreshes the elite/boss HP bar after damage. No-op for swarm enemies. */
  syncBar(): void {
    if (this.bar !== null && this.bar.visible) this.bar.setValue(this.health.hp, this.health.max);
  }

  tickAi(deltaMs: number, targetX: number, targetY: number): void {
    this.stateMs += deltaMs;
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    // Mirror toward the target, honouring which way the art was drawn.
    this.setFlipX(artFacesRight(this.def.texture) ? dx < 0 : dx > 0);

    if (this.def.healAura === true) this.tickHealAura(deltaMs);

    switch (this.def.behaviour) {
      case 'chase':
        this.setVelocity((dx / dist) * this.speed, (dy / dist) * this.speed);
        break;

      case 'charge':
        this.tickCharge(deltaMs, dx, dy, dist);
        break;

      case 'shoot': {
        const approach = dist > SHOOT_STANDOFF_PX ? 1 : -0.5;
        this.setVelocity((dx / dist) * this.speed * approach, (dy / dist) * this.speed * approach);
        if (this.stateMs >= 1500) {
          this.stateMs = 0;
          this.onShoot?.(this);
        }
        break;
      }

      case 'orbit': {
        // Circles the player at a fixed radius; support units stay alive longer.
        const radius = 240;
        this.orbitAngle += (deltaMs / 1000) * (this.speed / radius);
        const wantX = targetX + Math.cos(this.orbitAngle) * radius;
        const wantY = targetY + Math.sin(this.orbitAngle) * radius;
        const odx = wantX - this.x;
        const ody = wantY - this.y;
        const odist = Math.hypot(odx, ody) || 1;
        this.setVelocity((odx / odist) * this.speed, (ody / odist) * this.speed);
        break;
      }

      case 'split':
        this.setVelocity((dx / dist) * this.speed, (dy / dist) * this.speed);
        this.setAngle(this.angle + deltaMs * 0.18);
        break;

      case 'boss':
        this.tickBoss(deltaMs, dx, dy, dist);
        break;
    }
  }

  /** Windup (0.6x) -> 400ms telegraph (flash + line, stationary) -> dash (2.6x) -> repeat. */
  private tickCharge(deltaMs: number, dx: number, dy: number, dist: number): void {
    if (this.telegraphMs > 0) {
      this.telegraphMs -= deltaMs;
      this.setVelocity(0, 0);
      if (this.telegraphMs <= 0) {
        this.clearTelegraph();
        this.dashMs = CHARGE_DASH_MS;
        this.stateMs = 0;
      }
      return;
    }

    this.dashMs -= deltaMs;
    if (this.dashMs <= 0 && this.stateMs > CHARGE_WINDUP_MS) {
      this.startTelegraph(dx, dy, dist);
      return;
    }
    const mul = this.dashMs > 0 ? CHARGE_DASH_MUL : CHARGE_WINDUP_MUL;
    this.setVelocity((dx / dist) * this.speed * mul, (dy / dist) * this.speed * mul);
  }

  private startTelegraph(dx: number, dy: number, dist: number): void {
    this.telegraphMs = TUNING.enemy.chargeTelegraphMs;
    this.setTint(PALETTE.bad);
    const angle = Math.atan2(dy, dx);
    this.telegraphLine = this.scene.add
      .rectangle(this.x + (dx / dist) * (dist / 2), this.y + (dy / dist) * (dist / 2), dist, 6, PALETTE.bad, 0.5)
      .setRotation(angle)
      .setDepth(9);
  }

  private clearTelegraph(): void {
    this.telegraphMs = 0;
    this.clearTint();
    if (this.telegraphLine !== null) {
      this.telegraphLine.destroy();
      this.telegraphLine = null;
    }
  }

  private tickHealAura(deltaMs: number): void {
    this.healAuraMs -= deltaMs;
    if (this.healAuraMs > 0) return;
    this.healAuraMs = TUNING.enemy.healAuraIntervalMs;
    this.onHealPulse?.(this);
  }

  /** Standoff dance (like `shoot`) plus phase-gated volley/summon/ring attacks. */
  private tickBoss(deltaMs: number, dx: number, dy: number, dist: number): void {
    const ratio = this.health.ratio;
    const nextPhase: BossPhase = ratio <= TUNING.boss.phase3At ? 3 : ratio <= TUNING.boss.phase2At ? 2 : 1;
    if (nextPhase !== this.bossPhase) {
      this.bossPhase = nextPhase;
      if (nextPhase === 2) this.onBossAttack?.(this, 'phase2');
      if (nextPhase === 3) this.onBossAttack?.(this, 'phase3');
    }

    const enrageMul = this.bossPhase === 3 ? TUNING.boss.enrageSpeedMul : 1;
    const approach = dist > BOSS_STANDOFF_PX ? 1 : -0.5;
    this.setVelocity((dx / dist) * this.speed * approach * enrageMul, (dy / dist) * this.speed * approach * enrageMul);

    if (this.bossPhase === 3) {
      this.tickBossRing(deltaMs);
      return;
    }

    this.bossAttackMs -= deltaMs;
    if (this.bossAttackMs <= 0) {
      this.bossAttackMs = TUNING.boss.volleyCooldownMs;
      this.onBossAttack?.(this, 'volley');
    }
  }

  private tickBossRing(deltaMs: number): void {
    if (this.ringTelegraphMs > 0) {
      this.ringTelegraphMs -= deltaMs;
      if (this.ringTelegraphMs <= 0) {
        this.clearRingTelegraph();
        this.onBossAttack?.(this, 'ring');
        this.bossAttackMs = TUNING.boss.ringCooldownMs;
      }
      return;
    }
    this.bossAttackMs -= deltaMs;
    if (this.bossAttackMs <= 0) {
      this.ringTelegraphMs = TUNING.boss.ringTelegraphMs;
      this.ringTelegraphRing = this.scene.add
        .image(this.x, this.y, TEX.ring)
        .setTint(PALETTE.bad)
        .setDisplaySize(this.def.size * 0.6, this.def.size * 0.6)
        .setAlpha(0.7)
        .setDepth(9);
      this.scene.tweens.add({
        targets: this.ringTelegraphRing,
        displayWidth: this.def.size * 2.4,
        displayHeight: this.def.size * 2.4,
        alpha: 0.15,
        duration: TUNING.boss.ringTelegraphMs,
        ease: 'Cubic.easeOut',
      });
    }
  }

  private clearRingTelegraph(): void {
    this.ringTelegraphMs = 0;
    if (this.ringTelegraphRing !== null) {
      this.ringTelegraphRing.destroy();
      this.ringTelegraphRing = null;
    }
  }
}
