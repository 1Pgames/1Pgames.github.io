import type Phaser from 'phaser';

/**
 * The ONE guard every animation play in `src/` goes through.
 *
 * `anims.exists(key)` is not enough: a registered key can have ZERO frames
 * (its spritesheet failed to load, so `generateFrameNumbers` returned `[]`),
 * and Phaser 4 then throws inside `startAnimation → getFirstTick`
 * (`Cannot read properties of undefined (reading 'duration')`), killing the
 * game loop. A missing or empty anim must degrade to a static frame instead.
 */

/** The slice of Phaser's AnimationManager this guard reads (stub-able in a selftest). */
export interface AnimLookup {
  get(key: string): { readonly frames: { readonly length: number } } | null | undefined;
}

/** True when `key` is registered AND has at least one frame, i.e. safe to `play()`. */
export function playable(anims: AnimLookup, key: string): boolean {
  const anim = anims.get(key);
  return anim !== undefined && anim !== null && anim.frames.length > 0;
}

/**
 * Plays `key` on `sprite` when playable; otherwise stops any running anim and
 * shows frame 0 of the `key` texture when it exists (else the sprite keeps its
 * current texture, so the caller's own fallback art stays). Never throws.
 * Returns whether the animation is playing.
 */
export function safePlay(sprite: Phaser.GameObjects.Sprite, key: string, ignoreIfPlaying = false): boolean {
  if (playable(sprite.scene.anims, key)) {
    sprite.play(key, ignoreIfPlaying);
    return true;
  }
  sprite.anims.stop();
  if (sprite.scene.textures.exists(key)) sprite.setTexture(key, 0);
  return false;
}
