import Phaser from 'phaser';
import { TUNING } from '../config';
import { ANIM } from '../data/art';

/**
 * Pooled currency pickup: identical magnetism to `XpOrb` but grants run
 * currency instead of XP. In Duskhaul currency IS shards — the slice routes
 * `onCoinCollected` straight into `Bag.addShards` — so this plays the gilt
 * `ANIM.shard` glint sheet, the same art the ground caches use. Elites drop
 * several of these instead of one lump sum so a kill reads as a small reward
 * burst.
 *
 * Use for: elite/boss currency drops only — regular kills grant currency
 * directly through `TUNING.economy.currencyPerKill`, no pickup needed.
 */
export class Coin extends Phaser.Physics.Arcade.Sprite {
  value = 0;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, ANIM.shard);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setActive(false).setVisible(false).setDepth(8);
    this.disableBody();
  }

  drop(x: number, y: number, value: number): void {
    this.value = value;
    const size = 16 + Math.min(16, value);
    this.setPosition(x, y);
    this.setDisplaySize(size * 1.8, size * 1.8);
    this.clearTint();
    this.setActive(true).setVisible(true);
    this.play(ANIM.shard, true);
    this.enableBody(false, x, y, true, true);
    this.body?.setCircle(64, 0, 0);
    this.setVelocity(0, 0);
  }

  /** Same magnetism curve as `XpOrb.tickMagnet` — see that class for the rationale. */
  tickMagnet(playerX: number, playerY: number, radius: number): boolean {
    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 26) return true;
    const speed = TUNING.xp.orbSpeed * (dist > radius ? TUNING.xp.driftFactor : 1);
    this.setVelocity((dx / dist) * speed, (dy / dist) * speed);
    return false;
  }

  despawn(): void {
    this.setActive(false).setVisible(false);
    this.setVelocity(0, 0);
    this.disableBody();
  }
}
