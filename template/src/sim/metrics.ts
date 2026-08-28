import type { LanePolicy } from './bots';

/** Outcome of one seeded, skill-parameterised sim run. */
export interface RunMetrics {
  seed: string;
  lane: LanePolicy;
  skill: number;
  /** Seconds into the run the first upgrade card was taken, or null if none was. */
  firstUpgradeS: number | null;
  levelUps: number;
  /** Draft decisions actually made: level-up drafts + chest bonus drafts. */
  choiceEvents: number;
  /** Choice events made in the first 120s — the pacing window that survives early deaths. */
  choicesBy120S: number;
  kills: number;
  /** Seconds into the run the player died, or null if the run was survived. */
  deathS: number | null;
  /** Seconds the run actually lasted: death time, boss-kill time, or the full run length. */
  endS: number;
  survived: boolean;
  /** Lowest player HP ratio (0..1) reached at any point in the run. */
  hpMinPct: number;
  /** Player DPS dealt, bucketed per 60s of run time (index 0 = 0-60s, etc). */
  dpsBy60s: number[];
  /**
   * Fraction of the boss's HP bar the player removed (1 = killed), or `null`
   * on a run that died before the boss spawned. The finale is the only place
   * `TUNING.boss` matters, so this is the one number that says whether the
   * authored 3-phase script is reachable content or decoration.
   */
  bossHpRemoved: number | null;
  /** Highest boss phase the fight reached (0 = boss never spawned, 3 = enrage). */
  bossPhase: number;
}

export interface LaneAggregate {
  lane: LanePolicy;
  runs: number;
  winrate: number;
  medianDeathS: number | null;
  /** Choice events normalized to the 480s reference run: `choices * 480 / max(endS, 60)`, averaged per lane. */
  cadencePer480: number;
  /** Mean choice events inside the first 120s (design lands 3-4 there: first draft ~45s, then a slowing curve). */
  choicesBy120S: number;
  /** Runs that lived long enough to meet the boss. */
  bossRuns: number;
  /** Mean fraction of the boss bar removed across those runs (`NaN` when none met it). */
  bossHpRemoved: number;
  /**
   * Deepest boss phase any run reached (0 = boss never met). `TUNING.boss`
   * scripts three of them, so a lane stuck at 1 is a lane that never sees the
   * summon+shield or enrage-ring content at all.
   */
  bossPhaseMax: number;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const midValue = sorted[mid];
  if (midValue === undefined) return null;
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + midValue) / 2 : midValue;
}

/** Median across every run regardless of lane/skill — used by the firstUpgradeS pacing gate. */
export function medianFirstUpgradeS(runs: readonly RunMetrics[]): number | null {
  const values: number[] = [];
  for (const run of runs) if (run.firstUpgradeS !== null) values.push(run.firstUpgradeS);
  return median(values);
}

export function aggregateLane(lane: LanePolicy, runs: readonly RunMetrics[]): LaneAggregate {
  const laneRuns = runs.filter((run) => run.lane === lane);
  const wins = laneRuns.filter((run) => run.survived).length;
  const deathSeconds: number[] = [];
  let totalChoices = 0;
  let totalBy120 = 0;
  let totalRefRuns = 0; // each run's share of a 480s reference run
  let bossRuns = 0;
  let totalBossHpRemoved = 0;
  let bossPhaseMax = 0;
  for (const run of laneRuns) {
    if (run.deathS !== null) deathSeconds.push(run.deathS);
    totalChoices += run.choiceEvents;
    totalBy120 += run.choicesBy120S;
    totalRefRuns += Math.max(run.endS, 60) / 480;
    if (run.bossHpRemoved !== null) {
      bossRuns += 1;
      totalBossHpRemoved += run.bossHpRemoved;
      bossPhaseMax = Math.max(bossPhaseMax, run.bossPhase);
    }
  }
  return {
    lane,
    runs: laneRuns.length,
    winrate: laneRuns.length > 0 ? wins / laneRuns.length : 0,
    medianDeathS: median(deathSeconds),
    cadencePer480: totalRefRuns > 0 ? totalChoices / totalRefRuns : 0,
    choicesBy120S: laneRuns.length > 0 ? totalBy120 / laneRuns.length : 0,
    bossRuns,
    bossHpRemoved: bossRuns > 0 ? totalBossHpRemoved / bossRuns : Number.NaN,
    bossPhaseMax,
  };
}
