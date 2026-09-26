/**
 * Gear affixes (PRD-V2 §5.15.3): 20 rows, value range per rarity tier r2-r6,
 * at most one of each per item. Pure data + formatting; rolling lives in
 * `data/gear.ts rollGear`, stacking in `core/progression.ts runLoadout`.
 *
 * Unit convention (shared with `data/gear.ts` implicits and `data/sanctum.ts`):
 * `value` is what the label prints. `toMod` turns it into the `StatMod` the
 * player StatBlock applies: percentages on a multiplier stat (`damageMul`,
 * `cooldownMul`, …) become an `add` fraction; percentages on an absolute stat
 * (`moveSpeed`) become a `mul` fraction; flat numbers stay flat.
 */
import type { GearAffix, PlayerStatKey, Rarity } from './types-v2';

/** How `value` maps onto a `StatMod`. */
export type AffixUnit = 'flat' | 'pctAdd' | 'pctAddNeg' | 'pctMul' | 'flatNeg';

export interface AffixDef {
  id: string;
  /** Display template; `{n}` is replaced by the formatted value. */
  label: string;
  /** Stat the affix modifies; null for behavioural affixes (a_iframes, a_gatewin, a_elitedmg). */
  stat: PlayerStatKey | null;
  unit: AffixUnit;
  /** [min, max] per rarity r2..r6 (index = rarity − 2); null where the affix cannot roll. */
  ranges: readonly ([number, number] | null)[];
  /** Roll granularity (1 for integer affixes). */
  step: number;
  /** Relative draw weight per rarity r2..r6 (0 = cannot roll there). */
  weights: readonly number[];
  /** Short name for compact lists (Codex, compare line). */
  short: string;
}

const W_ALL = [1, 1, 1, 1, 1] as const;
/** `a_bag`, `a_luck`: roll only at r ≥ 4. */
const W_R4 = [0, 0, 1, 1, 1] as const;
/** `a_proj`: r5 at weight 0.1 ("10% chance slot"), r6 ordinary rolls also 0.1; the Hallowed capstone pool uses weight 1 (`CAPSTONE_WEIGHT`). */
const W_PROJ = [0, 0, 0, 0.1, 0.1] as const;

export const AFFIXES: readonly AffixDef[] = [
  { id: 'a_hp', label: 'Max Health +{n}', short: 'Health', stat: 'maxHp', unit: 'flat', step: 1, weights: W_ALL, ranges: [[6, 10], [10, 16], [16, 24], [24, 34], [34, 40]] },
  { id: 'a_dmg', label: 'Damage +{n}%', short: 'Damage', stat: 'damageMul', unit: 'pctAdd', step: 1, weights: W_ALL, ranges: [[2, 3], [3, 5], [5, 7], [7, 10], [10, 12]] },
  { id: 'a_cd', label: 'Cooldown −{n}%', short: 'Cooldown', stat: 'cooldownMul', unit: 'pctAddNeg', step: 1, weights: W_ALL, ranges: [[1, 2], [2, 3], [3, 5], [5, 7], [7, 8]] },
  { id: 'a_area', label: 'Area +{n}%', short: 'Area', stat: 'area', unit: 'pctAdd', step: 1, weights: W_ALL, ranges: [[2, 3], [3, 5], [5, 7], [7, 9], [9, 10]] },
  { id: 'a_crit', label: 'Crit Chance +{n}%', short: 'Crit', stat: 'critChance', unit: 'pctAdd', step: 1, weights: W_ALL, ranges: [[1, 2], [2, 3], [3, 4], [4, 6], [6, 7]] },
  { id: 'a_critmul', label: 'Crit Damage +{n}', short: 'Crit Dmg', stat: 'critMul', unit: 'flat', step: 0.05, weights: W_ALL, ranges: [[0.05, 0.1], [0.1, 0.15], [0.15, 0.2], [0.2, 0.3], [0.3, 0.35]] },
  { id: 'a_speed', label: 'Move Speed +{n}%', short: 'Speed', stat: 'moveSpeed', unit: 'pctMul', step: 1, weights: W_ALL, ranges: [[1, 2], [2, 3], [3, 4], [4, 6], [6, 7]] },
  { id: 'a_pickup', label: 'Pickup Range +{n}', short: 'Pickup', stat: 'pickupRadius', unit: 'flat', step: 1, weights: W_ALL, ranges: [[8, 12], [12, 18], [18, 26], [26, 36], [36, 40]] },
  { id: 'a_shards', label: 'Shards +{n}%', short: 'Shards', stat: 'shardsMul', unit: 'pctAdd', step: 1, weights: W_ALL, ranges: [[2, 3], [3, 5], [5, 7], [7, 10], [10, 12]] },
  { id: 'a_xp', label: 'XP +{n}%', short: 'XP', stat: 'xpMul', unit: 'pctAdd', step: 1, weights: W_ALL, ranges: [[2, 3], [3, 5], [5, 7], [7, 9], [9, 10]] },
  { id: 'a_regen', label: 'Regen +{n}/s', short: 'Regen', stat: 'regenPerS', unit: 'flat', step: 0.05, weights: W_ALL, ranges: [[0.05, 0.1], [0.1, 0.15], [0.15, 0.25], [0.25, 0.35], [0.35, 0.4]] },
  { id: 'a_armor', label: 'Contact Damage −{n}%', short: 'Armor', stat: 'contactDamageMul', unit: 'pctAddNeg', step: 1, weights: W_ALL, ranges: [[1, 2], [2, 4], [4, 6], [6, 8], [8, 9]] },
  { id: 'a_dur', label: 'Effect Duration +{n}%', short: 'Duration', stat: 'durationMul', unit: 'pctAdd', step: 1, weights: W_ALL, ranges: [[2, 4], [4, 6], [6, 9], [9, 12], [12, 14]] },
  { id: 'a_proj', label: 'Projectiles +{n}', short: 'Projectiles', stat: 'projectileBonus', unit: 'flat', step: 1, weights: W_PROJ, ranges: [null, null, null, [1, 1], [1, 1]] },
  { id: 'a_channel', label: 'Extract −{n} ms', short: 'Extract', stat: 'channelMs', unit: 'flatNeg', step: 10, weights: W_ALL, ranges: [[50, 100], [100, 150], [150, 250], [250, 350], [350, 400]] },
  { id: 'a_bag', label: 'Bag +{n} cell', short: 'Bag', stat: 'bagCells', unit: 'flat', step: 1, weights: W_R4, ranges: [null, null, [1, 1], [1, 1], [1, 1]] },
  { id: 'a_luck', label: 'Luck +{n}', short: 'Luck', stat: 'luck', unit: 'flat', step: 1, weights: W_R4, ranges: [null, null, [1, 1], [1, 1], [1, 1]] },
  { id: 'a_iframes', label: 'I-frames +{n} ms', short: 'I-frames', stat: null, unit: 'flat', step: 1, weights: W_ALL, ranges: [[10, 20], [20, 30], [30, 50], [50, 70], [70, 80]] },
  { id: 'a_gatewin', label: 'Gate windows +{n} s', short: 'Gate window', stat: null, unit: 'flat', step: 1, weights: W_ALL, ranges: [[2, 3], [3, 5], [5, 8], [8, 12], [12, 15]] },
  { id: 'a_elitedmg', label: 'Damage vs elites +{n}%', short: 'vs Elites', stat: null, unit: 'flat', step: 1, weights: W_ALL, ranges: [[3, 5], [5, 8], [8, 12], [12, 16], [16, 20]] },
];

/** `a_proj` weight inside the Hallowed capstone pool ("guaranteed on Hallowed capstone roll pool"). */
export const CAPSTONE_WEIGHT_PROJ = 1;

const BY_ID = new Map<string, AffixDef>(AFFIXES.map((a) => [a.id, a]));

export function affixDef(id: string): AffixDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`affixDef: unknown affix "${id}"`);
  return def;
}

/** Guards `affixDef` for ids from old saves. */
export function hasAffix(id: string): boolean {
  return BY_ID.has(id);
}

/** [min, max] for `id` at `rarity`, or null when it cannot roll there (r1 never rolls). */
export function affixRange(def: AffixDef, rarity: Rarity): [number, number] | null {
  if (rarity < 2) return null;
  return def.ranges[rarity - 2] ?? null;
}

/** Draw weight for `def` at `rarity` (0 = excluded). */
export function affixWeight(def: AffixDef, rarity: Rarity): number {
  if (rarity < 2 || affixRange(def, rarity) === null) return 0;
  return def.weights[rarity - 2] ?? 0;
}

/** Rounds away float noise from `min + step·k` (0.1 + 0.05 → 0.15, not 0.15000000000000002). */
export function roundAffix(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function formatN(value: number): string {
  return String(roundAffix(value));
}

/** §16.1 E26: `"Damage +3%"`, `"Extract −100 ms"`. Unknown ids render as `id +value` (an old save must not crash a sheet). */
export function affixLabel(a: GearAffix): string {
  const def = BY_ID.get(a.id);
  if (!def) return `${a.id} +${formatN(a.value)}`;
  const label = def.label.replace('{n}', formatN(a.value));
  return def.id === 'a_bag' && a.value > 1 ? `${label}s` : label;
}

/**
 * The StatMod contribution of a stat affix with this label value, or null for
 * behavioural affixes. `source` tags the owning item.
 */
export function affixStatMod(def: AffixDef, value: number, source: string): { stat: PlayerStatKey; add?: number; mul?: number; source: string } | null {
  if (def.stat === null) return null;
  return unitMod(def.stat, def.unit, value, source);
}

/** Shared unit → StatMod conversion (also used by gear implicits). */
export function unitMod(stat: PlayerStatKey, unit: AffixUnit, value: number, source: string): { stat: PlayerStatKey; add?: number; mul?: number; source: string } {
  switch (unit) {
    case 'flat':
      return { stat, add: value, source };
    case 'flatNeg':
      return { stat, add: -value, source };
    case 'pctAdd':
      return { stat, add: value / 100, source };
    case 'pctAddNeg':
      return { stat, add: -value / 100, source };
    case 'pctMul':
      return { stat, mul: value / 100, source };
  }
}
