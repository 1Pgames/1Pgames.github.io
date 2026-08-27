import type { LevelSpec } from '../../core/level';
import { generateLevel, type SideKnobs, type SideLevel } from './gen';
import { SIDE_TUNING } from './tuning';

/**
 * The side slice's 8-level ladder. A level is not authored geometry but an
 * authored *difficulty knob set* — `gen.ts` lays the platforms out from the
 * knobs plus the run seed, so level 5 is the same shape for everyone playing
 * the same seed and a retry replays it jump for jump.
 *
 * The ladder is deliberately monotone in both knobs (`gapRatio` and
 * `spikeDensity` only ever rise, `riseRatio` never falls) — that monotonicity
 * is asserted by `sim/kits/sidegen.selftest.ts`, so an accidental difficulty
 * dip cannot ship. Coin counts stay in the 8-14 band the design asks for and
 * rise with the level, since a harder level should also pay more.
 *
 * Caps: `gapRatio <= 0.8` of the rise-aware reach `R(r)` and
 * `riseRatio <= 0.75` of the 128px apex — see the envelope block in `gen.ts`.
 */
export const SIDE_LEVEL_KNOBS: readonly SideKnobs[] = [
  { gapRatio: 0.45, riseRatio: 0.25, widthRatio: 1.0, spikeDensity: 0.0, coins: 8 },
  { gapRatio: 0.5, riseRatio: 0.35, widthRatio: 0.92, spikeDensity: 0.1, coins: 9 },
  { gapRatio: 0.55, riseRatio: 0.45, widthRatio: 0.82, spikeDensity: 0.18, coins: 10 },
  { gapRatio: 0.6, riseRatio: 0.5, widthRatio: 0.7, spikeDensity: 0.26, coins: 10 },
  { gapRatio: 0.65, riseRatio: 0.6, widthRatio: 0.58, spikeDensity: 0.34, coins: 11 },
  { gapRatio: 0.7, riseRatio: 0.65, widthRatio: 0.46, spikeDensity: 0.42, coins: 12 },
  { gapRatio: 0.75, riseRatio: 0.7, widthRatio: 0.34, spikeDensity: 0.48, coins: 13 },
  { gapRatio: 0.8, riseRatio: 0.75, widthRatio: 0.22, spikeDensity: 0.55, coins: 14 },
];

export const SIDE_LEVEL_COUNT = SIDE_LEVEL_KNOBS.length;

/** Namespaced `core/storage` key holding the next unplayed level index. */
export const SIDE_PROGRESS_KEY = 'side:level';

/**
 * `LevelSpec` for level `index`: one goal (`exit`), a 90s budget. Coins are
 * score, never a goal — a level must never be blocked by a missed pickup.
 */
export function sideLevelSpec(index: number): LevelSpec {
  return {
    id: `side-${(index + 1).toString().padStart(2, '0')}`,
    goals: [{ id: 'exit', target: 1 }],
    timeSeconds: SIDE_TUNING.levelTimeSeconds,
  };
}

/** Clamps any stored/derived index into the ladder. */
export function clampLevelIndex(index: number): number {
  return Math.max(0, Math.min(SIDE_LEVEL_COUNT - 1, Math.floor(index)));
}

/** Builds level `index` of the ladder for `seed` (the same call the sim makes). */
export function buildSideLevel(index: number, seed: string): SideLevel {
  const safeIndex = clampLevelIndex(index);
  return generateLevel(
    safeIndex,
    SIDE_LEVEL_KNOBS[safeIndex]!,
    SIDE_TUNING.geometry,
    SIDE_TUNING.motion,
    seed,
    SIDE_TUNING.maxGenAttempts,
  );
}
