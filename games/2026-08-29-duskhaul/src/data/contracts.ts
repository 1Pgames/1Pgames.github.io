/**
 * Contract table (PRD-V2 §5.22): 36 board contracts + the 3-step weekly.
 * `text` uses `{n}` (threshold/target), `{times}` (`once` / `N times`) and `{weapon}` / `{zone}` / `{affix}` /
 * `{h}` params rolled by `core/contracts.ts rollContracts`. `target` is the
 * progress count to finish; threshold contracts (greed ×1.3, 400 ◆ carried,
 * 6 items …) finish in one qualifying run, so their `target` is 1 and the
 * threshold rides in `threshold` (printed as `{n}`).
 */
import type { ZoneId } from './types-v2';

export interface ContractReward { shards?: number; dust?: number; sigils?: number; items?: number; xp?: number; /** tier bias of the reward item roll */ itemTierBias?: number }
export type ContractParam = 'weapon' | 'zone' | 'affix' | 'h';
export interface ContractDef {
  id: string; text: string; target: number; reward: ContractReward; threshold?: number; params?: readonly ContractParam[];
  /** Account feature the contract needs before it may roll (`m_sell` needs Vault SELL, `m_merge` Vault MERGE). */
  requires?: string;
}

export const CONTRACTS: readonly ContractDef[] = [
  { id: 'k_kill_any', text: 'Kill {n} enemies', target: 800, reward: { shards: 120 } },
  { id: 'k_kill_elite', text: 'Kill {n} elites', target: 5, reward: { shards: 150 } },
  { id: 'k_kill_boss', text: 'Defeat a zone boss', target: 1, reward: { shards: 250, dust: 20 } },
  { id: 'k_kill_mid', text: 'Defeat a mid-boss', target: 1, reward: { shards: 180 } },
  { id: 'k_kill_weapon', text: 'Kill {n} enemies with {weapon}', target: 300, reward: { shards: 120 }, params: ['weapon'] },
  { id: 'k_kill_zoneex', text: 'Kill {n} {zone} locals', target: 60, reward: { shards: 120 }, params: ['zone'] },
  { id: 'k_kill_affix', text: 'Kill {n} {affix} elites', target: 2, reward: { shards: 140 }, params: ['affix'] },
  { id: 'x_extract_any', text: 'Extract {times}', target: 2, reward: { shards: 150 } },
  { id: 'x_extract_zone', text: 'Extract from {zone}', target: 1, reward: { shards: 150 }, params: ['zone'] },
  { id: 'x_extract_b', text: 'Extract through a Dirge Door (B)', target: 1, reward: { shards: 160 } },
  { id: 'x_extract_c', text: 'Extract through a Bleak Arch (C)', target: 1, reward: { shards: 250 } },
  { id: 'x_extract_toll', text: 'Extract through a Toll Gate', target: 1, reward: { shards: 120 } },
  { id: 'x_extract_offer', text: 'Extract through an Offering Altar', target: 1, reward: { shards: 140 } },
  { id: 'x_extract_bell', text: 'Extract through a Bell Gate', target: 1, reward: { shards: 160 } },
  { id: 'x_extract_hazard', text: 'Extract at Hazard {h}+', target: 1, reward: { shards: 200, items: 1, itemTierBias: 0 }, params: ['h'] },
  { id: 'x_extract_greed', text: 'Extract with Greed ×{n}+', target: 1, threshold: 1.15, reward: { shards: 200 } },
  { id: 'x_extract_haul', text: 'Extract with {n} ◆ carried', target: 1, threshold: 400, reward: { shards: 180 } },
  { id: 'x_extract_items', text: 'Extract with {n} items', target: 1, threshold: 6, reward: { shards: 160 } },
  { id: 'x_extract_gilded', text: 'Extract with {n} Gilded+ items', target: 1, threshold: 2, reward: { shards: 220 } },
  { id: 'x_extract_nohit', text: 'Extract without dropping below 50% health', target: 1, threshold: 0.5, reward: { shards: 200 } },
  { id: 'p_chests', text: 'Open {n} Reliquaries', target: 10, reward: { shards: 130 } },
  { id: 'p_vault', text: 'Open a Dread Vault and extract', target: 1, reward: { sigils: 1 } },
  { id: 'p_shrines', text: 'Use {n} shrines', target: 4, reward: { shards: 110 } },
  { id: 'p_lairs', text: 'Clear {n} Elite Lairs', target: 3, reward: { shards: 150 } },
  { id: 'p_events', text: 'Complete {n} events', target: 2, reward: { shards: 140 } },
  { id: 'p_veins', text: 'Mine {n} veins', target: 12, reward: { shards: 100 } },
  { id: 'p_breakables', text: 'Break {n} urns', target: 150, reward: { shards: 100 } },
  { id: 'p_lore', text: 'Read {n} lore stones', target: 3, reward: { shards: 100, xp: 50 } },
  { id: 'p_fence', text: 'Trade with the Fence', target: 1, reward: { shards: 100 } },
  { id: 'b_evolve', text: 'Evolve {n} weapons in one run', target: 1, threshold: 1, reward: { shards: 150 } },
  { id: 'b_evolve_two', text: 'Evolve 2 weapons in one run', target: 1, threshold: 2, reward: { shards: 250 } },
  { id: 'b_level', text: 'Reach level {n}', target: 1, threshold: 20, reward: { shards: 120 } },
  { id: 'b_charms', text: 'Own 4 charms in one run', target: 1, threshold: 4, reward: { shards: 120 } },
  { id: 'm_salvage', text: 'Salvage {n} gear', target: 10, reward: { dust: 60 } },
  { id: 'm_merge', text: 'Merge {times}', target: 2, reward: { dust: 80 }, requires: 'feature:merge' },
  { id: 'm_sell', text: 'Sell valuables worth {n} ◆', target: 800, reward: { items: 1, itemTierBias: 1 }, requires: 'feature:sell' },
];

/** Weekly contract chain (seed = ISO week); reward paid when step 3 completes. */
export interface WeeklyStepDef { id: string; text: string; target: number }
export const WEEKLY_STEPS: readonly WeeklyStepDef[] = [
  { id: 'wk_1', text: 'Extract 3 times at H2+', target: 3 },
  { id: 'wk_2', text: 'Kill 2 zone bosses', target: 2 },
  { id: 'wk_3', text: 'Extract through Gate C once', target: 1 },
];
export const WEEKLY_REWARD: ContractReward = { sigils: 2, shards: 300 };

/**
 * Starter board (§5.22 + critic F9): below `STARTER_UNTIL_LEVEL` the board
 * draws ONLY these, at these targets — each is finishable on Keep H1 in 1-2
 * short runs (a novice run lasts ~100 s: ~6 chests/veins in reach, one Gate A
 * extraction). Rewards are the table's. From L5 the full 36-row pool opens.
 */
export const STARTER_UNTIL_LEVEL = 5;
export const STARTER_TARGETS: Readonly<Record<string, number>> = {
  x_extract_any: 1,
  p_chests: 3,
  p_veins: 2,
  p_breakables: 30,
  k_kill_any: 250,
  p_shrines: 1,
  p_lore: 1,
};

/** Board size by account level: 3 from L2, 4 from L24. */
export const CONTRACT_SLOTS = { base: 3, atL24: 4 } as const;

/** §5.29 zone exclusives ("locals") for `k_kill_zoneex`. */
export const ZONE_LOCALS: Readonly<Record<ZoneId, readonly string[]>> = {
  castle: ['chapelghast', 'gargoyle', 'choirwraith'],
  outlands: ['kite', 'giant', 'mirehag'],
  desert: ['leech', 'scarab', 'sandrevenant'],
  winter: ['widow', 'yeti', 'rimestalker'],
};


const BY_ID: Record<string, ContractDef> = Object.fromEntries(CONTRACTS.map((c) => [c.id, c]));

export function contractDef(id: string): ContractDef | undefined {
  return BY_ID[id];
}
