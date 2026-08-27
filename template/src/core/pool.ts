/**
 * Object pooling for anything spawned and destroyed in bulk: bullets, enemies,
 * pickups, damage-number popups, particles. Essential for survivor-likes and
 * tower defense where hundreds of entities spawn/die per minute — `new`/`destroy`
 * churn is the single biggest cause of GC hitches at 300+ live entities.
 *
 * `Pool<T>` is the generic free-list, useful for plain data/logic objects
 * (e.g. pooled `DamageEvent` records, AI blackboards). `SpritePool` wraps it
 * for `Phaser.Physics.Arcade.Sprite` so gameplay code never calls
 * `scene.physics.add.sprite` / `sprite.destroy()` directly in a spawn loop.
 *
 * Do NOT pool one-shot objects created a handful of times per run (a boss,
 * the player) — plain construction is clearer there.
 *
 * This file imports Phaser (for `SpritePool` only); `Pool<T>` itself has no
 * Phaser dependency and can hold anything.
 */

import Phaser from 'phaser';

export class Pool<T> {
  private readonly create: () => T;
  private readonly reset: (item: T) => void;
  private readonly free: T[] = [];
  private activeCount = 0;

  constructor(create: () => T, reset: (item: T) => void, initial = 0) {
    this.create = create;
    this.reset = reset;
    for (let i = 0; i < initial; i += 1) this.free.push(create());
  }

  /** Pops a free item (creating one if the free list is empty) and marks it active. */
  obtain(): T {
    this.activeCount += 1;
    const item = this.free.pop();
    return item !== undefined ? item : this.create();
  }

  /** Resets and returns an item to the free list. Safe to call at most once per obtain. */
  release(item: T): void {
    this.reset(item);
    this.free.push(item);
    this.activeCount = Math.max(0, this.activeCount - 1);
  }

  releaseAll(): void {
    this.activeCount = 0;
  }

  get active(): number {
    return this.activeCount;
  }
}

/**
 * Pooled `Phaser.Physics.Arcade.Sprite`s sharing one texture (one pool per
 * enemy/projectile type). `obtain` re-enables the arcade body; `release`
 * disables it and hides the sprite, mirroring Phaser's own Group recycling
 * (`setActive(false).setVisible(false)`) without paying for a full Group.
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
