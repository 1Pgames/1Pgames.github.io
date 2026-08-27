import type { LanePolicy } from './bots';

/** Outcome of one seeded, skill-parameterised sim run. */
export interface RunMetrics {
  seed: string;
  lane: LanePolicy;
  skill: number;
  /** Seconds into the run the first upgrade card was taken, or null if none was. */
  firstUpgradeS: number | null;
  levelUps: number;
  kills: number;
  /** Seconds into the run the player died, or null if the run was survived. */
  deathS: number | null;
  survived: boolean;
  /** Lowest player HP ratio (0..1) reached at any point in the run. */
  hpMinPct: number;
  /** Player DPS dealt, bucketed per 60s of run time (index 0 = 0-60s, etc). */
  dpsBy60s: number[];
}

export interface LaneAggregate {
  lane: LanePolicy;
  runs: number;
  winrate: number;
  medianDeathS: number | null;
  /** Level-ups per minute of run time survived — the draft "cadence" the design targets. */
  cadence: number;
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

export function aggregateLane(lane: LanePolicy, runs: readonly RunMetrics[], runSeconds: number): LaneAggregate {
  const laneRuns = runs.filter((run) => run.lane === lane);
  const wins = laneRuns.filter((run) => run.survived).length;
  const deathSeconds: number[] = [];
  let totalLevelUps = 0;
  for (const run of laneRuns) {
    if (run.deathS !== null) deathSeconds.push(run.deathS);
    totalLevelUps += run.levelUps;
  }
  // Cadence denominator: every run's own elapsed minutes — death time if it
  // died, the full run length if it survived to the end.
  const totalSurvivedMinutes = laneRuns.reduce((sum, run) => sum + (run.deathS ?? runSeconds) / 60, 0);
  return {
    lane,
    runs: laneRuns.length,
    winrate: laneRuns.length > 0 ? wins / laneRuns.length : 0,
    medianDeathS: median(deathSeconds),
    cadence: totalSurvivedMinutes > 0 ? totalLevelUps / totalSurvivedMinutes : 0,
  };
}
