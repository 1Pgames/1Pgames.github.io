/**
 * Object pooling for anything spawned and destroyed in bulk: bullets, enemies,
 * pickups, damage-number popups, particles. Essential for survivor-likes and
 * tower defense where hundreds of entities spawn/die per minute — `new`/`destroy`
 * churn is the single biggest cause of GC hitches at 300+ live entities.
 *
 * `Pool<T>` is the generic free-list, useful for plain data/logic objects
 * (e.g. pooled `DamageEvent` records, AI blackboards) as well as anything
 * Phaser-backed — see `core/spritePool.ts` for the `Phaser.Physics.Arcade.Sprite`
 * wrapper so gameplay code never calls `scene.physics.add.sprite` /
 * `sprite.destroy()` directly in a spawn loop.
 *
 * Do NOT pool one-shot objects created a handful of times per run (a boss,
 * the player) — plain construction is clearer there.
 *
 * Pure TypeScript, no Phaser import — safe to import from a headless context
 * (e.g. `src/sim/`) that never touches the DOM.
 */

export class Pool<T> {
  private readonly create: () => T;
  private readonly reset: (item: T) => void;
  private readonly free: T[] = [];
  /** Every item currently checked out — reclaimed by `releaseAll`, O(1) membership for `release`. */
  private readonly live = new Set<T>();

  constructor(create: () => T, reset: (item: T) => void, initial = 0) {
    this.create = create;
    this.reset = reset;
    for (let i = 0; i < initial; i += 1) this.free.push(create());
  }

  /** Pops a free item (creating one if the free list is empty) and marks it active. */
  obtain(): T {
    const item = this.free.pop() ?? this.create();
    this.live.add(item);
    return item;
  }

  /** Resets and returns an item to the free list. Safe to call at most once per obtain. */
  release(item: T): void {
    if (!this.live.delete(item)) return; // not currently obtained — ignore a double release.
    this.reset(item);
    this.free.push(item);
  }

  /**
   * Resets and reclaims every currently-obtained item in one pass (e.g. a
   * scene restart that needs every live entity parked without visiting each
   * one). Previously this only zeroed the active count and dropped the live
   * items on the floor, so a restart's obtain() calls kept `create()`-ing new
   * instances forever instead of recycling the ones already checked out.
   */
  releaseAll(): void {
    for (const item of this.live) {
      this.reset(item);
      this.free.push(item);
    }
    this.live.clear();
  }

  get active(): number {
    return this.live.size;
  }
}

