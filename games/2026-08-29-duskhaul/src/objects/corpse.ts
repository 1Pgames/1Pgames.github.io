import Phaser from 'phaser';
import { TEX } from '../core/keys';
import { Pool } from '../core/pool';
import { artScale } from '../data/art';

/**
 * Death animations for POOLED bodies.
 *
 * The art wave generated a `-death` sheet for every enemy, elite and the
 * Warden — 37 of the 103 shipped assets — and none of them ever appeared,
 * because `Enemy` is recycled the frame it dies: `CombatSystem.hitEnemy`
 * returns it to the pool, which parks it invisible, so the body cannot play its
 * own death. A corpse is therefore a SEPARATE, non-physics sprite that inherits
 * the dead body's sheet, position, facing and per-action scale, plays the
 * one-shot animation once, and returns to this pool.
 *
 * Pooled for the same reason enemies are: a 480s run kills several hundred
 * bodies, and one `add.sprite`/`destroy` pair per kill is exactly the GC churn
 * `core/pool.ts` exists to avoid. Depth 9 puts corpses UNDER living enemies
 * (depth 10) so a fresh spawn is never hidden behind something already dead.
 */
export class CorpseFx {
  private readonly scene: Phaser.Scene;
  private readonly pool: Pool<Phaser.GameObjects.Sprite>;

  constructor(scene: Phaser.Scene, initial = 8) {
    this.scene = scene;
    this.pool = new Pool<Phaser.GameObjects.Sprite>(
      () => this.createSprite(),
      (sprite) => CorpseFx.park(sprite),
      initial,
    );
  }

  private createSprite(): Phaser.GameObjects.Sprite {
    const sprite = this.scene.add.sprite(0, 0, TEX.disc).setDepth(9);
    // ONE persistent listener per sprite, installed at construction: a corpse
    // only ever plays a non-looping death animation, so completion always means
    // "done". A listener added per play would still be armed after the sprite
    // was recycled and would release the NEXT corpse early.
    sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.pool.release(sprite));
    CorpseFx.park(sprite);
    return sprite;
  }

  private static park(sprite: Phaser.GameObjects.Sprite): void {
    sprite.setActive(false).setVisible(false);
    sprite.anims.stop();
  }

  /**
   * Plays `animKey`'s death frames at `x,y`. `size` is the dead body's tuned
   * size — the corpse re-applies the death action's own `SpriteAsset.scale`, so
   * a sheet that draws its collapse shorter than its walk cycle does not shrink
   * mid-death.
   *
   * False when that death sheet was never generated (or its art group was
   * pruned), which is the caller's cue that there is no death animation to show
   * — never a reason to skip the kill.
   */
  play(animKey: string, x: number, y: number, size: number, flipX: boolean): boolean {
    if (!this.scene.anims.exists(animKey)) return false;
    const sprite = this.pool.obtain();
    const shown = size * artScale(animKey);
    sprite
      .setActive(true)
      .setVisible(true)
      .setPosition(x, y)
      .setFlipX(flipX)
      .setDisplaySize(shown, shown);
    sprite.play(animKey, true);
    return true;
  }

  /** Parks every corpse still on screen — the run ended or the scene restarted. */
  releaseAll(): void {
    this.pool.releaseAll();
  }
}
