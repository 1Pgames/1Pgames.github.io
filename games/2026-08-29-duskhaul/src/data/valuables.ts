/**
 * Sell-only valuables (PRD-V2 §5.14). Tier = rarity colour index (§5.15.1:
 * t1 Tarnished … t4 Gilded, t5 Dread); `value` is the base sell price in ◆
 * (the Vault applies `g_sell`). Cells 1-2 feed the bag grid (§5.16).
 */
import type { Rng } from '../core/rng';
import { zoneDef } from './zones';
import type { ValuableInstance, ZoneId } from './types-v2';

export type ValuableTier = 1 | 2 | 3 | 4 | 5;
export interface ValuableDef { id: string; name: string; tier: ValuableTier; cells: 1 | 2; value: number; flavor: string }

export const VALUABLES: readonly ValuableDef[] = [
  { id: 'v_tallowstub', name: 'Tallow Stub', tier: 1, cells: 1, value: 20, flavor: "A candle end that burned for someone's wake" },
  { id: 'v_rustcoin', name: 'Rust Coin Roll', tier: 1, cells: 1, value: 25, flavor: 'Pennies fused into a single green brick' },
  { id: 'v_bonecomb', name: 'Bone Comb', tier: 1, cells: 1, value: 25, flavor: 'Teeth cut from a shinbone' },
  { id: 'v_ashurn', name: 'Ash Urn', tier: 1, cells: 2, value: 45, flavor: 'Still full; the family never came' },
  { id: 'v_widowring', name: "Widow's Ring", tier: 2, cells: 1, value: 50, flavor: 'Engraved with a date nobody remembers' },
  { id: 'v_censerchain', name: 'Censer Chain', tier: 2, cells: 1, value: 55, flavor: 'Silver-plated, mostly' },
  { id: 'v_psalter', name: 'Mouldered Psalter', tier: 2, cells: 2, value: 90, flavor: 'Prayers the dark already answered' },
  { id: 'v_gargoyletooth', name: 'Gargoyle Tooth', tier: 2, cells: 1, value: 60, flavor: 'Stone, and still sharp' },
  { id: 'v_carvedskull', name: 'Carved Skull', tier: 2, cells: 2, value: 95, flavor: 'Scrimshaw of a drowned port' },
  { id: 'v_silvercup', name: 'Silver Grave-Cup', tier: 3, cells: 1, value: 110, flavor: 'Poured for the dead, drunk by thieves' },
  { id: 'v_reliquarybox', name: 'Reliquary Box', tier: 3, cells: 2, value: 180, flavor: 'The finger inside points north' },
  { id: 'v_gildedicon', name: 'Gilded Icon', tier: 3, cells: 1, value: 120, flavor: 'A saint with the eyes scratched out' },
  { id: 'v_amberbeetle', name: 'Amber Beetle', tier: 3, cells: 1, value: 115, flavor: 'A scarab asleep for a thousand dusks' },
  { id: 'v_frostpearl', name: 'Frost Pearl', tier: 3, cells: 1, value: 125, flavor: 'Never melts in a living hand' },
  { id: 'v_bishopsring', name: "Bishop's Seal", tier: 3, cells: 1, value: 130, flavor: 'Signs indulgences for sins not yet done' },
  { id: 'v_giltchalice', name: 'Gilt Chalice', tier: 4, cells: 2, value: 260, flavor: "The Keep's communion cup" },
  { id: 'v_crownshard', name: 'Crown Shard', tier: 4, cells: 1, value: 200, flavor: "A piece of a king's circlet" },
  { id: 'v_sunmask', name: 'Sun-Eaten Mask', tier: 4, cells: 2, value: 280, flavor: "Gold beaten thin over a stranger's face" },
  { id: 'v_rimecrown', name: 'Rime Circlet', tier: 4, cells: 1, value: 220, flavor: 'Frost-silver for a widow queen' },
  { id: 'v_saintsbone', name: "Saint's Femur", tier: 4, cells: 2, value: 240, flavor: 'Wrapped in gold wire and lies' },
  { id: 'v_duskgem', name: 'Duskgem', tier: 5, cells: 1, value: 340, flavor: 'Holds the last light of a dead sun' },
  { id: 'v_gravecrown', name: 'Grave Crown', tier: 5, cells: 2, value: 400, flavor: 'Worn by every Warden, in turn' },
  { id: 'v_blackcandle', name: 'Black Candle', tier: 5, cells: 1, value: 320, flavor: 'Burns darkness instead of wax' },
  { id: 'v_hollowheart', name: 'Hollow Heart', tier: 5, cells: 1, value: 360, flavor: 'A reliquary heart that still beats' },
];

/** §5.14 base tier ladder t1..t5. */
const VALUABLE_TIER_WEIGHTS: readonly number[] = [46, 30, 16, 6, 2];

const BY_ID: Record<string, ValuableDef> = Object.fromEntries(VALUABLES.map((v) => [v.id, v]));
const BY_TIER: readonly (readonly ValuableDef[])[] = [1, 2, 3, 4, 5].map((t) => VALUABLES.filter((v) => v.tier === t));

export function valuableDef(id: string): ValuableDef {
  const def = BY_ID[id];
  if (def === undefined) throw new Error(`Unknown valuable id "${id}"`);
  return def;
}

/**
 * Tier weights after a source shift (§5.14: same rule as V1 `relicTierWeights`):
 * every weight moves UP `bias` tiers, overflow accumulates on t5, mass is
 * conserved. A fractional bias (zone loot bias is 0.25-1.0 points, §5.29) moves
 * that fraction of each weight one further tier. Negative bias shifts down,
 * underflow accumulating on t1.
 */
function valuableTierWeights(bias: number): number[] {
  const whole = Math.floor(bias);
  const frac = bias - whole;
  const out = [0, 0, 0, 0, 0];
  const last = out.length - 1;
  VALUABLE_TIER_WEIGHTS.forEach((w, i) => {
    const lo = Math.max(0, Math.min(last, i + whole));
    const hi = Math.max(0, Math.min(last, i + whole + 1));
    out[lo] = (out[lo] ?? 0) + w * (1 - frac);
    out[hi] = (out[hi] ?? 0) + w * frac;
  });
  return out;
}

/** Deterministic instance uid drawn from the run's Rng (two 32-bit draws). */
export function lootUid(rng: Rng, prefix: string): string {
  const a = Math.floor(rng.next() * 0x100000000).toString(36);
  const b = Math.floor(rng.next() * 0x100000000).toString(36);
  return `${prefix}-${a}${b}`;
}

/** §16.1 E24: tier drawn from the ladder shifted by source bias + zone loot bias (§5.29), then a uniform row of that tier. */
export function rollValuable(rng: Rng, tierBias: number, zone: ZoneId): ValuableInstance {
  const weights = valuableTierWeights(tierBias + zoneDef(zone).lootBias);
  const tiers: number[] = [];
  const live: number[] = [];
  weights.forEach((w, i) => {
    if (w > 0) {
      tiers.push(i);
      live.push(w);
    }
  });
  const tierIndex = rng.pickWeighted(tiers, live);
  const def = rng.pick(BY_TIER[tierIndex] ?? VALUABLES);
  return { uid: lootUid(rng, 'val'), id: def.id };
}
