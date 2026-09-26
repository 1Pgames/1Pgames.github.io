/**
 * Daily/Weekly mutators (PRD-V2 §5.24). Each row carries its numbers in
 * `params`, split by who applies them:
 *
 * - `loadout` params are FOLDED by `core/progression.ts runLoadout` into the
 *   RunLoadoutV2 fields / StatMods (never re-apply them in-run).
 * - `run` params are applied by `slices/arena/game.ts` (and the director /
 *   combat it configures) for every id in `loadout.mutators`.
 */
import type { MutatorId } from './types-v2';

export interface MutatorLoadoutParams {
  lootBias?: number;
  /** Multiplier on the stat via StatMod `mul` (−1 = ×0). */
  shardsMul?: number; damageMul?: number; maxHpMul?: number; xpMul?: number; regenMul?: number;
  minimapRevealPx?: number;
  collapseAtS?: number;
  gearDisabled?: boolean;
  casketSlots?: number;
  deathKeepPct?: number;
  breakableDropMul?: number;
}
export interface MutatorRunParams {
  eliteFreqMul?: number; enemyHpMul?: number; enemySpeedMul?: number; maxAliveMul?: number; maxAliveCap?: number;
  noGraveBread?: boolean; gateShiftS?: number; draftChoicesBonus?: number; bellWaveEveryS?: number;
}
export interface MutatorDef { id: MutatorId; name: string; effect: string; loadout: MutatorLoadoutParams; run: MutatorRunParams }

export const MUTATORS: readonly MutatorDef[] = [
  { id: 'mu_bloodmoon', name: 'Bloodmoon', effect: 'Elites ×2 frequency, item tier bias +1', loadout: { lootBias: 1 }, run: { eliteFreqMul: 2 } },
  { id: 'mu_famine', name: 'Famine', effect: 'No Grave Bread; regen 0', loadout: { regenMul: 0 }, run: { noGraveBread: true } },
  { id: 'mu_gilded', name: 'Gilded Hour', effect: 'Shards ×1.5, enemies hp ×1.2', loadout: { shardsMul: 1.5 }, run: { enemyHpMul: 1.2 } },
  { id: 'mu_fog', name: 'Grave Fog', effect: 'Minimap reveal radius 450', loadout: { minimapRevealPx: 450 }, run: {} },
  { id: 'mu_haste', name: 'Hastened Dead', effect: 'Enemy speed ×1.2', loadout: {}, run: { enemySpeedMul: 1.2 } },
  { id: 'mu_glass', name: 'Glass Hauler', effect: 'Damage ×1.3, max health ×0.7', loadout: { damageMul: 1.3, maxHpMul: 0.7 }, run: {} },
  { id: 'mu_crowded', name: 'Crowded Graves', effect: 'Live target +20% (cap 300), XP ×1.2', loadout: { xpMul: 1.2 }, run: { maxAliveMul: 1.2, maxAliveCap: 300 } },
  { id: 'mu_earlydusk', name: 'Early Dusk', effect: 'All gates −30 s, Collapse at 420 s', loadout: { collapseAtS: 420 }, run: { gateShiftS: -30 } },
  { id: 'mu_armory', name: 'Armory Sealed', effect: 'Gear disabled; draft +1 choice (4 cards)', loadout: { gearDisabled: true }, run: { draftChoicesBonus: 1 } },
  { id: 'mu_pact', name: 'Blood Pact', effect: 'Casket disabled; tithe 50%', loadout: { casketSlots: 0, deathKeepPct: 50 }, run: {} },
  { id: 'mu_bells', name: 'Tolling Bells', effect: 'Every 60 s a Bell Vigil wave spawns at the hero', loadout: {}, run: { bellWaveEveryS: 60 } },
  { id: 'mu_lucky', name: 'Lucky Dead', effect: 'Breakable drop chances ×2', loadout: { breakableDropMul: 2 }, run: {} },
];

const BY_ID: Record<string, MutatorDef> = Object.fromEntries(MUTATORS.map((m) => [m.id, m]));

export function mutatorDef(id: MutatorId): MutatorDef {
  const def = BY_ID[id];
  if (!def) throw new Error(`mutatorDef: unknown mutator "${id}"`);
  return def;
}
