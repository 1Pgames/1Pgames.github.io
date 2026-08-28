import type { CollectionSetDef } from '../../core/collections';
import type { ArtSlot } from '../../data/art';
import type { RampSpec } from '../../core/ramp';
import type { StackSpec } from './stack';

/**
 * A slab colourway. The tower bands its rows by cycling `colors`, so a skin is
 * a whole palette rather than a single hue — the six of them are the collection
 * set this family sells (`core/collections.ts`).
 */
export interface HyperSkin {
  /** Collection piece id in `MetaSave.collections`. Stable forever once shipped. */
  id: string;
  name: string;
  /** Row tints cycled by height; used only while the slab art slot is null. */
  colors: readonly number[];
}

/**
 * Every balance number of the stack-tower slice. Slice-local by design: the
 * shared `TUNING` in `src/config.ts` stays the arena's, so swapping slices
 * never touches global config.
 */
export const HYPER_TUNING = {
  /** Row height in px; also the camera step per drop. */
  slabHeight: 64,
  /** Slab geometry + perfect-drop economy (see `stack.ts`). */
  stack: {
    startWidth: 420,
    minWidth: 36,
    perfectEpsilon: 10,
    widthBonusOnPerfect: 18,
  } satisfies StackSpec,
  /** Slide speed at difficulty 1, and the px/s added per difficulty point. */
  baseSpeed: 185,
  speedPerDifficulty: 55,
  /** Endless score-chase ramp: difficulty climbs with score, never with time. */
  ramp: {
    scorePerStep: 6,
    difficultyPerStep: 0.1,
    maxDifficulty: 3.2,
  } satisfies RampSpec,
  /** Score awarded per landed drop, and the bonus on top for a perfect one. */
  scorePerDrop: 1,
  scorePerPerfect: 3,
  /** Fraction of screen height the action line sits at — the tower top never moves. */
  actionLineRatio: 0.55,
  /** Overhang pieces alive at once, and how long their fall reads for. */
  maxFallingPieces: 6,
  fallMs: 520,
  /** Slabs kept rendered below the action line before the oldest is recycled. */
  visibleRows: 14,
  /** Death → results transition, kept short for instant-retry feel. */
  hitstopMs: 70,
  fadeOutMs: 240,
  /** Score needed for one unit of meta currency. */
  scorePerCurrency: 5,

  /**
   * The six slab colourways, `skins[0]` first — it is the one every player
   * starts with, so it is granted on the first run rather than earned. The
   * other five are the collection this family sells: one per milestone below,
   * or bought forward a level at a time with the `meta_skin_pack` perk.
   */
  skins: [
    { id: 'aurora', name: 'AURORA', colors: [0x4de1ff, 0x5df2a0, 0xffd166, 0xff5da2, 0xa88bff, 0xff8f5d] },
    { id: 'ember', name: 'EMBER', colors: [0xff8f5d, 0xff5da2, 0xffd166, 0xff6b3d, 0xffa07a, 0xff3d6e] },
    { id: 'tide', name: 'TIDE', colors: [0x4de1ff, 0x2f9bd6, 0x7fe6ff, 0x1f6f9c, 0x9be8ff, 0x3fc0e8] },
    { id: 'moss', name: 'MOSS', colors: [0x5df2a0, 0x3fbf7a, 0x9bf5c4, 0x2d8f5c, 0xbdf7d8, 0x4fd68c] },
    { id: 'dusk', name: 'DUSK', colors: [0xa88bff, 0x7f5fe0, 0xc9b3ff, 0x5f3fb0, 0xe0d4ff, 0x8f6fe8] },
    { id: 'bone', name: 'BONE', colors: [0xf2f6ff, 0xd6dbe8, 0xffffff, 0xb8c0d0, 0xe8edf7, 0xc8d0e0] },
  ] as readonly HyperSkin[],
  /**
   * Best-score thresholds that grant `skins[n + 1]`. Five entries for the five
   * earnable skins: the first is one good opening run, the last is a session
   * the player has to work for.
   */
  skinMilestones: [15, 30, 50, 80, 120] as readonly number[],
  /** `core/storage` key holding the chosen skin id. */
  skinStoreKey: 'hyper-skin',

  /**
   * `meta_slow_start`: the opening of a run is slowed by
   * `speedMulPerLevel * level`, which is the one thing a hypercasual game can
   * sell without touching the ceiling — it only makes the first seconds
   * readable.
   */
  slowStart: {
    seconds: 5,
    speedMulPerLevel: 0.08,
  },

  /**
   * Generated-art slot for a slab. While it is `null` the slab is the
   * procedural square TINTED by the active skin's palette; once it resolves,
   * the art carries the colour and the palette is not applied.
   */
  art: {
    slab: null as ArtSlot | null,
  },
} as const;

/**
 * The skin collection as `core/collections.ts` sees it — the same six ids, so
 * `collectionProgress` and the meta screen can read the set without a second
 * list to keep in sync.
 */
export const HYPER_SKIN_SET: CollectionSetDef = {
  id: 'skins',
  name: 'Slab Colourways',
  pieces: HYPER_TUNING.skins.map((skin) => ({ id: skin.id, name: skin.name })),
};
