import Phaser from 'phaser';
import { VIEW } from '../config';
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
 * Allocation-free in `tickAi`: no vectors, no closures, no arrays.
 */
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  def!: EnemyDef;
  health!: Health;
  damage = 0;
  xpValue = 0;
  /** Set by the combat system when contact damage was last dealt to the player. */
  lastContactAt = 0;
  /** Ranged archetypes fire through this callback, owned by the combat system. */
  onShoot: ((enemy: Enemy) => void) | null = null;

  private speed = 0;
  private stateMs = 0;
  private dashMs = 0;
  private orbitAngle = 0;
  private bar: Bar | null = null;

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
    this.orbitAngle = Math.atan2(y - VIEW.centerY, x - VIEW.centerX);

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

    switch (this.def.behaviour) {
      case 'chase':
        this.setVelocity((dx / dist) * this.speed, (dy / dist) * this.speed);
        break;

      case 'charge': {
        // Wind up, then dash at 2.6x speed for 400ms.
        this.dashMs -= deltaMs;
        if (this.dashMs <= 0 && this.stateMs > 1600) {
          this.dashMs = 400;
          this.stateMs = 0;
        }
        const mul = this.dashMs > 0 ? 2.6 : 0.6;
        this.setVelocity((dx / dist) * this.speed * mul, (dy / dist) * this.speed * mul);
        break;
      }

      case 'shoot': {
        const standOff = 320;
        const approach = dist > standOff ? 1 : -0.5;
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
    }
  }
}
