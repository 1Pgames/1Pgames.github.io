/**
 * Slice-local balance for the idle-tycoon starter (family F). These numbers are
 * deliberately NOT in `src/config.ts`: they only mean anything to this slice,
 * and every other family would have to scroll past them.
 *
 * Curve shape: each generator costs ~10x the previous one and pays ~7x more, so
 * a tier's payback time grows from ~25s to ~190s. The multiplier from a prestige
 * is what makes the late tiers reachable in a second cycle.
 */

export interface GeneratorTuning {
  baseCost: number;
  /** Geometric cost growth per owned unit — the spine of the idle curve. */
  costGrowth: number;
  /** Income of ONE unit per second, before the prestige multiplier. */
  incomePerSec: number;
  /** Manual-collect cycle: how often an un-managed tier can be tapped. */
  cycleMs: number;
  /** Revealed once this much has been earned since the last prestige. */
  unlockAtTotalEarned: number;
}

export const IDLE_TUNING = {
  /** Enough to buy the first Glowcap Farm on a cold start. */
  startingCash: 20,
  /** Passive income while away is credited up to this many hours. */
  offlineCapHours: 4,
  autosaveMs: 5000,
  /** Manual taps can crit — the reason a seeded run is reproducible. */
  tapCritChance: 0.12,
  tapCritMult: 3,
  /** A single credit worth this share of the purse animates instead of snapping. */
  cashCountThreshold: 0.12,

  prestige: {
    /** Earn this much in one cycle to unlock ASCEND. */
    unlockAtTotalEarned: 100_000,
    /** +0.02 multiplier per `earningsPerStep` earned — see `Economy.prestigeGain`. */
    multiplierPerReset: 0.02,
    earningsPerStep: 1000,
  },

  generators: {
    glowcap: { baseCost: 15, costGrowth: 1.09, incomePerSec: 0.6, cycleMs: 1000, unlockAtTotalEarned: 0 },
    copper: { baseCost: 150, costGrowth: 1.1, incomePerSec: 4, cycleMs: 2000, unlockAtTotalEarned: 60 },
    still: { baseCost: 1_400, costGrowth: 1.1, incomePerSec: 22, cycleMs: 3000, unlockAtTotalEarned: 600 },
    forge: { baseCost: 12_000, costGrowth: 1.11, incomePerSec: 130, cycleMs: 4000, unlockAtTotalEarned: 6_000 },
    roost: { baseCost: 90_000, costGrowth: 1.11, incomePerSec: 800, cycleMs: 6000, unlockAtTotalEarned: 50_000 },
    well: { baseCost: 700_000, costGrowth: 1.12, incomePerSec: 5_200, cycleMs: 8000, unlockAtTotalEarned: 400_000 },
    hoard: { baseCost: 6_000_000, costGrowth: 1.13, incomePerSec: 36_000, cycleMs: 10_000, unlockAtTotalEarned: 3_500_000 },
    mint: { baseCost: 50_000_000, costGrowth: 1.14, incomePerSec: 260_000, cycleMs: 12_000, unlockAtTotalEarned: 30_000_000 },
  },

  /** Manager price per generator — roughly 20-26 first units of that tier. */
  managers: {
    glowcap: 400,
    copper: 3_500,
    still: 30_000,
    forge: 250_000,
    roost: 2_000_000,
    well: 16_000_000,
  },

  ui: {
    rowHeight: 200,
    rowGap: 16,
    buyWidth: 196,
    buyHeight: 88,
    iconSize: 62,
    /** Drag further than this and the pointer is scrolling, not tapping. */
    dragSlopPx: 12,
  },
} as const satisfies {
  startingCash: number;
  offlineCapHours: number;
  autosaveMs: number;
  tapCritChance: number;
  tapCritMult: number;
  cashCountThreshold: number;
  prestige: { unlockAtTotalEarned: number; multiplierPerReset: number; earningsPerStep: number };
  generators: Record<string, GeneratorTuning>;
  managers: Record<string, number>;
  ui: Record<string, number>;
};

export type IdleGeneratorId = keyof typeof IDLE_TUNING.generators;
export type IdleManagerGeneratorId = keyof typeof IDLE_TUNING.managers;
