import { PALETTE } from '../config';

/**
 * Data-driven enemy archetype catalog for survivor-like / roguelike /
 * tower-defense scenes. Every enemy is a plain record — texture, size, base
 * stats and a behaviour tag — so a scene's spawn/AI code switches on
 * `behaviour` once and never hardcodes a stat for a specific enemy id.
 *
 * Use for: any genre that spawns dozens of simultaneous enemy instances from
 * a shared pool (see `core/pool.ts`) driven by `core/run.ts` waves.
 * Do NOT use for: a single hand-placed boss or puzzle obstacle — build that
 * as a one-off entity instead of forcing it into this table.
 */

export type EnemyBehaviour = 'chase' | 'orbit' | 'shoot' | 'charge' | 'split';

export interface EnemyBaseStats {
  maxHp: number;
  damage: number;
  moveSpeed: number;
  /** XP granted to the player on death. */
  xp: number;
  /** Meta/run currency dropped on death. */
  currency: number;
}

export interface EnemyDef {
  id: string;
  texture: string;
  /** Sprite display size in px (both axes; textures are square). */
  size: number;
  base: EnemyBaseStats;
  behaviour: EnemyBehaviour;
  tint: number;
  /** Only set for `behaviour: 'split'` — ids spawned on death. */
  splitInto?: readonly string[];
}

/**
 * 8 archetypes covering the standard survivor-like cast: cheap swarm filler,
 * a fast harasser, a slow damage sponge, a ranged threat, a splitter, a
 * support unit, a mini-elite, and a run-ending boss.
 */
export const ENEMIES: readonly EnemyDef[] = [
  {
    id: 'swarm',
    texture: 'swarm-move',
    size: 62,
    base: { maxHp: 8, damage: 3, moveSpeed: 140, xp: 1, currency: 1 },
    behaviour: 'chase',
    tint: PALETTE.bad,
  },
  {
    id: 'runner',
    texture: 'runner-move',
    size: 74,
    base: { maxHp: 14, damage: 5, moveSpeed: 260, xp: 2, currency: 2 },
    behaviour: 'charge',
    tint: PALETTE.secondary,
  },
  {
    id: 'tank',
    texture: 'tank-move',
    size: 120,
    base: { maxHp: 120, damage: 10, moveSpeed: 70, xp: 8, currency: 6 },
    behaviour: 'chase',
    tint: PALETTE.inkSoft,
  },
  {
    id: 'shooter',
    texture: 'shooter-idle',
    size: 92,
    base: { maxHp: 22, damage: 6, moveSpeed: 110, xp: 4, currency: 4 },
    behaviour: 'shoot',
    tint: PALETTE.primary,
  },
  {
    id: 'splitter',
    texture: 'splitter-move',
    size: 98,
    base: { maxHp: 40, damage: 6, moveSpeed: 130, xp: 5, currency: 3 },
    behaviour: 'split',
    tint: PALETTE.accent,
    splitInto: ['swarm', 'swarm'],
  },
  {
    id: 'healer',
    texture: 'healer-idle',
    size: 88,
    base: { maxHp: 26, damage: 2, moveSpeed: 120, xp: 6, currency: 5 },
    behaviour: 'orbit',
    tint: PALETTE.good,
  },
  {
    id: 'elite',
    texture: 'elite-move',
    size: 150,
    base: { maxHp: 300, damage: 16, moveSpeed: 150, xp: 25, currency: 20 },
    behaviour: 'charge',
    tint: PALETTE.secondary,
  },
  {
    id: 'boss',
    texture: 'boss-idle',
    size: 280,
    base: { maxHp: 4000, damage: 30, moveSpeed: 90, xp: 200, currency: 150 },
    behaviour: 'shoot',
    tint: PALETTE.bad,
  },
] as const;

/**
 * Scales an archetype's base stats by the current `RunPhase.difficultyMul`.
 * HP and damage scale with difficulty (the run gets harder); move speed and
 * rewards (xp/currency) stay fixed so movement feel and pacing don't drift
 * as the multiplier climbs.
 */
export function scaleEnemy(def: EnemyDef, difficultyMul: number): EnemyBaseStats {
  return {
    maxHp: Math.round(def.base.maxHp * difficultyMul),
    damage: Math.round(def.base.damage * difficultyMul),
    moveSpeed: def.base.moveSpeed,
    xp: def.base.xp,
    currency: def.base.currency,
  };
}
