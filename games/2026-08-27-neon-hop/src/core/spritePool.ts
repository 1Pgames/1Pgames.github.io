import Phaser from 'phaser';
import { Pool } from './pool';

/**
 * Pooled `Phaser.Physics.Arcade.Sprite`s sharing one texture (one pool per
 * enemy/projectile type). `obtain` re-enables the arcade body; `release`
 * disables it and hides the sprite, mirroring Phaser's own Group recycling
 * (`setActive(false).setVisible(false)`) without paying for a full Group.
 *
 * Split out from `core/pool.ts` so that file — and anything that only needs
 * the generic `Pool<T>` free-list, including the headless balance simulator
 * in `src/sim/` — never pulls in a Phaser value import.
 */
export class SpritePool {
  private readonly scene: Phaser.Scene;
  private readonly pool: Pool<Phaser.Physics.Arcade.Sprite>;

  constructor(scene: Phaser.Scene, texture: string, initial = 0) {
    this.scene = scene;
    this.pool = new Pool<Phaser.Physics.Arcade.Sprite>(
      () => this.createSprite(texture),
      (sprite) => this.deactivate(sprite),
      initial,
    );
  }

  private createSprite(texture: string): Phaser.Physics.Arcade.Sprite {
    const sprite = this.scene.physics.add.sprite(0, 0, texture);
    this.deactivate(sprite);
    return sprite;
  }

  private deactivate(sprite: Phaser.Physics.Arcade.Sprite): void {
    sprite.setActive(false).setVisible(false);
    const body = sprite.body as Phaser.Physics.Arcade.Body | null;
    if (body !== null) {
      body.stop();
      body.enable = false;
    }
  }

  obtain(x: number, y: number): Phaser.Physics.Arcade.Sprite {
    const sprite = this.pool.obtain();
    sprite.setActive(true).setVisible(true).setPosition(x, y);
    const body = sprite.body as Phaser.Physics.Arcade.Body | null;
    if (body !== null) body.enable = true;
    return sprite;
  }

  release(sprite: Phaser.Physics.Arcade.Sprite): void {
    this.pool.release(sprite);
  }

  releaseAll(): void {
    this.pool.releaseAll();
  }

  get active(): number {
    return this.pool.active;
  }
}
