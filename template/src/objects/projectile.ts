import Phaser from 'phaser';
import { PALETTE, TUNING } from '../config';
import { TEXTURE } from '../data/art';
import type { Enemy } from './enemy';

/**
 * Pooled projectile for auto-attacks and enemy shots. Carries its own damage
 * payload so a hit needs no lookup back into the shooter (which may already be
 * dead by the time the shot lands).
 *
 * Use for: any bullet-like entity spawned in bulk.
 * Do NOT use for: persistent orbiting weapons or beams — those want their own
 * object with a lifetime tied to the owner.
 */
export class Projectile extends Phaser.Physics.Arcade.Sprite {
  damage = 0;
  crit = false;
  /** true when fired by an enemy: it damages the player instead of enemies. */
  hostile = false;
  lifeMs = 0;
  /** Remaining enemies this shot can still pass through after a hit (rail weapon). 0 = normal bolt. */
  pierceRemaining = 0;
  /** Enemies already hit this flight, so a piercing shot never double-hits the same target. */
  readonly hitTargets: Set<Enemy> = new Set();

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, TEXTURE.bullet);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setActive(false).setVisible(false).setDepth(15);
    this.disableBody();
  }

  /** Radius used for hit tests, in world px. Scales with the `areaMul` stat. */
  hitRadius = 0;

  fire(
    x: number,
    y: number,
    vx: number,
    vy: number,
    damage: number,
    crit: boolean,
    hostile: boolean,
    area = 1,
    pierce = 0,
  ): void {
    this.damage = damage;
    this.crit = crit;
    this.hostile = hostile;
    this.lifeMs = 1600;
    this.pierceRemaining = pierce;
    this.hitTargets.clear();

    const size = TUNING.player.projectileSize * (crit ? 1.6 : 1) * (hostile ? 1.3 : 1) * area;
    this.hitRadius = size;
    this.setPosition(x, y);
    this.setDisplaySize(size * 2.2, size);
    // The bolt art is drawn pointing right: rotate it along the travel vector.
    this.setRotation(Math.atan2(vy, vx));
    // Hostile shots are recoloured so the player can read incoming danger;
    // friendly shots keep the generated cyan, crits get a gold overlay.
    if (hostile) this.setTint(PALETTE.bad);
    else if (crit) this.setTint(PALETTE.accent);
    else this.clearTint();
    this.setActive(true).setVisible(true);
    this.enableBody(false, x, y, true, true);
    this.body?.setCircle(64, 0, 0);
    this.setVelocity(vx, vy);
  }

  despawn(): void {
    this.setActive(false).setVisible(false);
    this.setVelocity(0, 0);
    this.disableBody();
    this.hitTargets.clear();
    this.pierceRemaining = 0;
  }
}
