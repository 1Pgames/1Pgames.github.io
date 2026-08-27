import Phaser from 'phaser';
import { TUNING } from '../config';
import { ANIM } from '../data/art';

/**
 * Pooled XP pickup. Idles where the enemy died, then magnetises to the player
 * once inside the `pickupRadius` stat — the pull is what makes clearing a swarm
 * feel rewarding, so keep it snappy.
 *
 * Use for: XP, coins, any small collectible dropped in bulk.
 * Do NOT use for: unique quest items or drops with bespoke pickup rules.
 */
export class XpOrb extends Phaser.Physics.Arcade.Sprite {
  value = 0;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, ANIM.xpOrb);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setActive(false).setVisible(false).setDepth(8);
    this.disableBody();
  }

  drop(x: number, y: number, value: number): void {
    this.value = value;
    const size = 14 + Math.min(18, value);
    this.setPosition(x, y);
    this.setDisplaySize(size * 1.8, size * 1.8);
    this.clearTint();
    this.setActive(true).setVisible(true);
    this.play(ANIM.xpOrb, true);
    this.enableBody(false, x, y, true, true);
    this.body?.setCircle(64, 0, 0);
    this.setVelocity(0, 0);
  }

  /**
   * Returns true when the orb reached the player and should be collected.
   * Outside `radius` the orb still drifts in slowly: in a 720px-wide portrait
   * frame, drops land far enough away that a hard radius cut-off would strand
   * most of a run's XP off to the side.
   */
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
