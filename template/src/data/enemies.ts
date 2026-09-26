import type { OutlineRank } from '../core/outline';
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

export type EnemyBehaviour = 'chase' | 'orbit' | 'shoot' | 'charge' | 'split' | 'boss';

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
  /**
   * Gameplay footprint diameter in px: contact reach (`contactReach`, scene AND
   * sim), spawn clearance and the physics body. NOT the display size.
   */
  size: number;
  /**
   * On-screen silhouette height in px (readability floor: ≥ 8% of 720 = 58).
   * The sprite's cell display size is derived from it (`displaySizeFor`).
   */
  visiblePx: number;
  base: EnemyBaseStats;
  behaviour: EnemyBehaviour;
  tint: number;
  /** Only set for `behaviour: 'split'` — ids spawned on death. */
  splitInto?: readonly string[];
  /** Periodically heals nearby enemies (see `TUNING.enemy.healAura*`). Only `healer` sets this. */
  healAura?: boolean;
  /** Only set for `id: 'elite'` — drops pooled coin pickups on death. */
  eliteDrop?: boolean;
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
    visiblePx: 60,
    base: { maxHp: 8, damage: 3, moveSpeed: 140, xp: 1, currency: 1 },
    behaviour: 'chase',
    tint: PALETTE.bad,
  },
  {
    id: 'runner',
    texture: 'runner-move',
    size: 74,
    visiblePx: 66,
    base: { maxHp: 14, damage: 4, moveSpeed: 260, xp: 2, currency: 2 },
    behaviour: 'charge',
    tint: PALETTE.secondary,
  },
  {
    id: 'tank',
    texture: 'tank-move',
    size: 120,
    visiblePx: 88,
    base: { maxHp: 120, damage: 10, moveSpeed: 70, xp: 8, currency: 6 },
    behaviour: 'chase',
    tint: PALETTE.inkSoft,
  },
  {
    id: 'shooter',
    texture: 'shooter-idle',
    size: 92,
    visiblePx: 68,
    base: { maxHp: 22, damage: 6, moveSpeed: 110, xp: 4, currency: 4 },
    behaviour: 'shoot',
    tint: PALETTE.primary,
  },
  {
    id: 'splitter',
    texture: 'splitter-move',
    size: 98,
    visiblePx: 74,
    base: { maxHp: 40, damage: 6, moveSpeed: 130, xp: 5, currency: 3 },
    behaviour: 'split',
    tint: PALETTE.accent,
    splitInto: ['swarm', 'swarm'],
  },
  {
    id: 'healer',
    texture: 'healer-idle',
    size: 88,
    visiblePx: 66,
    base: { maxHp: 26, damage: 2, moveSpeed: 120, xp: 6, currency: 5 },
    behaviour: 'orbit',
    tint: PALETTE.good,
    healAura: true,
  },
  {
    id: 'elite',
    texture: 'elite-move',
    size: 150,
    visiblePx: 116,
    base: { maxHp: 300, damage: 13, moveSpeed: 150, xp: 25, currency: 20 },
    behaviour: 'charge',
    tint: PALETTE.secondary,
    eliteDrop: true,
  },
  {
    id: 'boss',
    texture: 'boss-idle',
    size: 280,
    visiblePx: 232,
    base: { maxHp: 4000, damage: 30, moveSpeed: 90, xp: 200, currency: 150 },
    behaviour: 'boss',
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

/**
 * Mean opaque-bbox height (px inside the 256 cell, alpha ≥ 24) of every actor
 * loop sheet, measured from `public/assets/generated/**`. A regenerated sheet
 * must update its row — the readability floor is a statement about pixels on
 * screen, and the cell size alone says nothing about how much of it is body.
 * Unlisted keys fall back to `DEFAULT_SUBJECT_HEIGHT`.
 */
export const SUBJECT_HEIGHT: Readonly<Record<string, number>> = {
  'hero-idle': 171,
  'swarm-move': 114.8,
  'runner-move': 171,
  'shooter-idle': 172,
  'healer-idle': 170,
  'tank-move': 157,
  'splitter-move': 167,
  'elite-move': 163.5,
  'boss-idle': 199.2,
};
const DEFAULT_SUBJECT_HEIGHT = 170;
const CELL_PX = 256;

/** Square display size of a 256 px cell sheet so its silhouette is `visiblePx` tall on screen. */
export function displaySizeFor(textureKey: string, visiblePx: number): number {
  return Math.round((visiblePx * CELL_PX) / (SUBJECT_HEIGHT[textureKey] ?? DEFAULT_SUBJECT_HEIGHT));
}

/**
 * Distance at which an enemy's contact damage lands on the hero — ONE formula
 * for `systems/combat.ts` and `sim/model.ts`, from the two gameplay footprints.
 */
export function contactReach(def: EnemyDef, playerSize: number): number {
  return (def.size + playerSize) * 0.45;
}

/** Team-outline rank of an archetype (`core/outline.ts` px 3/4/5): the elite and the boss read heavier. */
export function outlineRankOf(def: EnemyDef): OutlineRank {
  return def.behaviour === 'boss' ? 'boss' : def.eliteDrop === true ? 'elite' : 'trash';
}
