// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/anim.selftest.ts
//
// Animation play guard (crash: `TypeError: Cannot read properties of undefined
// (reading 'duration')` in Phaser's startAnimation → getFirstTick, which stops
// the game loop). A spritesheet that failed to load leaves a registered anim
// with ZERO frames; `anims.exists` says yes, `play` throws. Every play in src/
// goes through `core/anim.ts`; this pins its contract on stubs:
//   - playable: missing / null / zero-frame keys are not playable, ≥1 frame is;
//   - safePlay: plays only a playable key; otherwise stops the running anim and
//     shows frame 0 of the key's texture when it exists, else keeps the
//     caller's texture — and never calls Phaser's `play` on an empty anim.
import assert from 'node:assert/strict';
import type Phaser from 'phaser';
import { playable, safePlay } from '../../core/anim';

type StubAnim = { frames: unknown[] };
const registry: Record<string, StubAnim | null> = {
  loop: { frames: [{}, {}, {}] },
  single: { frames: [{}] },
  'failed-sheet': { frames: [] },
  nulled: null,
};
const anims = { get: (key: string) => registry[key] };

assert.equal(playable(anims, 'loop'), true, 'multi-frame anim is playable');
assert.equal(playable(anims, 'single'), true, 'one frame is enough');
assert.equal(playable(anims, 'failed-sheet'), false, 'registered-but-empty anim (failed sheet) is not playable');
assert.equal(playable(anims, 'nulled'), false, 'null lookup is not playable');
assert.equal(playable(anims, 'never-registered'), false, 'missing key is not playable');

/** A sprite stub that records calls and, like Phaser, throws when asked to play an empty anim. */
function stubSprite(textures: readonly string[]) {
  const log: string[] = [];
  const sprite = {
    texture: 'placeholder',
    frame: -1 as number | string | undefined,
    playing: null as string | null,
    scene: { anims, textures: { exists: (k: string) => textures.includes(k) } },
    anims: { stop: () => { log.push('stop'); sprite.playing = null; } },
    play(key: string, ignoreIfPlaying?: boolean) {
      const a = registry[key];
      if (a !== undefined && a !== null && a.frames.length === 0) throw new TypeError("Cannot read properties of undefined (reading 'duration')");
      log.push(`play:${key}:${ignoreIfPlaying === true}`);
      sprite.playing = key;
      return sprite;
    },
    setTexture(key: string, frame?: number | string) {
      log.push(`tex:${key}:${String(frame)}`);
      sprite.texture = key;
      sprite.frame = frame;
      return sprite;
    },
  };
  return { sprite, log, as: sprite as unknown as Phaser.GameObjects.Sprite };
}

{
  const s = stubSprite(['loop']);
  assert.equal(safePlay(s.as, 'loop', true), true);
  assert.equal(s.sprite.playing, 'loop');
  assert.deepEqual(s.log, ['play:loop:true'], 'playable key: plays, forwards ignoreIfPlaying, no fallback');
}
{
  const s = stubSprite(['failed-sheet']);
  s.sprite.playing = 'loop';
  assert.doesNotThrow(() => assert.equal(safePlay(s.as, 'failed-sheet'), false));
  assert.equal(s.sprite.playing, null, 'running anim is stopped');
  assert.deepEqual([s.sprite.texture, s.sprite.frame], ['failed-sheet', 0], 'empty anim with a texture → its static frame 0');
}
{
  const s = stubSprite([]);
  assert.equal(safePlay(s.as, 'failed-sheet'), false);
  assert.equal(safePlay(s.as, 'never-registered'), false);
  assert.equal(s.sprite.texture, 'placeholder', 'no texture for the key → caller art is kept');
  assert.ok(!s.log.some((l) => l.startsWith('play:') || l.startsWith('tex:')), 'neither play nor setTexture on an unplayable, textureless key');
}

console.log('anim selftest: OK (playable 5 cases, safePlay play/empty/missing)');
