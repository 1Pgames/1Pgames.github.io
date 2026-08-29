import Phaser from 'phaser';
import { PALETTE } from '../config';
import { TEX } from '../core/keys';

/**
 * Pooled orbit-weapon blade: a small disc that circles the player at a fixed
 * radius, dealing contact damage to anything it touches on a per-target
 * cooldown (owned by `systems/combat.ts`, not this class — the blade is pure
 * visual + position, combat resolves hits through the spatial hash exactly
 * like every other attack).
 *
 * Use for: `WeaponPattern: 'orbit'` blades only. One instance per active
 * blade slot (1-2 depending on evolution), repositioned every frame instead
 * of pooled per-shot like `Projectile`.
 */
export class Blade extends Phaser.Physics.Arcade.Sprite {
  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, TEX.disc);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setTint(PALETTE.primary).setDepth(16);
    this.setActive(false).setVisible(false);
    this.disableBody();
  }

  activate(radius: number): void {
    const size = Math.max(20, radius * 0.22);
    this.setDisplaySize(size, size);
    this.setActive(true).setVisible(true);
    this.enableBody(false, this.x, this.y, true, true);
    this.body?.setCircle(64, 0, 0);
  }

  moveTo(x: number, y: number): void {
    this.setPosition(x, y);
  }

  despawn(): void {
    this.setActive(false).setVisible(false);
    this.disableBody();
  }
}
