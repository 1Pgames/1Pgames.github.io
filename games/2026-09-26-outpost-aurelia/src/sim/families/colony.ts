/**
 * Colony family sim (`npm run sim -- --family colony`, verify stage 6): plays
 * `--runs` Landings per lane on Halcyon Flats rung 1 through `runLanding` (the
 * real model + threat, fixed 100 ms steps, seeded) and prints the lane table
 * plus every PRD §19 colony gate.
 *
 * Batch size: the §19 bands are specified at 200 Landings per lane (`--runs
 * 200`, the balance batch). The verify smoke batch is 20; below 200 a rate
 * band is judged against the band widened by its 95 % binomial half-width at
 * the batch size (printed with every gate), so a 20-run batch fails only a
 * lane that is out of band beyond sampling noise.
 */
import { writeFileSync } from 'node:fs';

import { ORDERS, RELICS } from '../../slices/colony/content';
import { buildSolTable, type SolWindow } from '../../slices/colony/model/director';
import { calibrateRunner, calibratedBudget } from '../calibrate';
import { LANE_LABELS, type LaneLabel } from '../colony/lanes';
import { playLane, type LandingRun } from '../colony/runLanding';
import {
  finishFamily,
  hard,
  mean,
  median,
  num,
  pct,
  percentile,
  printTable,
  soft,
  type FamilySim,
  type FamilySimOptions,
  type GateResult,
} from './types';

/** Batch size the §19 bands are written for. */
const SPEC_RUNS = 200;
/** Reference-machine wall budget for the default 20-run batch (verify's whole budget is 300 s). */
const SIM_BUDGET_MS = 120_000;
const SKILLED: readonly LaneLabel[] = ['bastion', 'sprawl', 'spire', 'kin'];

interface LaneReport {
  label: LaneLabel;
  runs: LandingRun[];
  winRate: number;
  wins: LandingRun[];
}

function share(runs: readonly LandingRun[], test: (run: LandingRun) => boolean): number {
  return runs.length === 0 ? Number.NaN : runs.filter(test).length / runs.length;
}

/** 95 % binomial half-width at `p` over `n` samples; 0 at the spec batch size. */
function slack(p: number, n: number): number {
  return n >= SPEC_RUNS || n === 0 ? 0 : 1.96 * Math.sqrt((p * (1 - p)) / n);
}

function inBand(rate: number, lo: number, hi: number, n: number): boolean {
  return rate >= lo - slack(lo, n) && rate <= hi + slack(hi, n);
}

function bandNote(lo: number, hi: number, n: number): string {
  return n >= SPEC_RUNS ? '' : ` (±${pct(slack(lo, n))}/${pct(slack(hi, n))} at ${n} runs)`;
}

/** Gaps (s) between actions inside each day window, window edges included: a day with no action is one long gap. */
function dayGaps(run: LandingRun, table: readonly SolWindow[]): number[] {
  const gaps: number[] = [];
  const end = run.result.timeSec;
  for (const w of table) {
    if (w.dayStart >= end) break;
    const stop = Math.min(w.nightStart, end);
    let last = w.dayStart;
    for (const t of run.trace.actionsAtSec) {
      if (t < w.dayStart || t >= stop) continue;
      gaps.push(t - last);
      last = t;
    }
    gaps.push(stop - last);
  }
  return gaps;
}

function longestQuiet(run: LandingRun): number {
  const beats = [...run.trace.payoffsAtSec].sort((a, b) => a - b);
  let last = 0;
  let longest = 0;
  for (const t of beats) {
    longest = Math.max(longest, t - last);
    last = t;
  }
  return Math.max(longest, run.result.timeSec - last);
}

function evaluateGates(reports: readonly LaneReport[], runs: number, elapsedMs: number, budgetMs: number, deterministic: boolean): GateResult[] {
  const gates: GateResult[] = [];
  const lane = (label: LaneLabel): LaneReport => {
    const report = reports.find((r) => r.label === label);
    if (report === undefined) throw new Error(`colony sim: lane ${label} not played`);
    return report;
  };
  const table = buildSolTable();

  gates.push(hard(deterministic, deterministic ? 'same seed → same Landing (bastion seed 0 replayed identically)' : 'NON-DETERMINISTIC: bastion seed 0 replayed to a different result'));
  gates.push(soft(elapsedMs <= budgetMs, `sim wall time ${num(elapsedMs / 1000, 1)} s ≤ ${num(budgetMs / 1000, 1)} s (${SIM_BUDGET_MS / 1000} s × runner scale × runs/20)`));

  for (const label of SKILLED) {
    const r = lane(label);
    gates.push(hard(inBand(r.winRate, 0.45, 0.8, runs), `${label} wins ${pct(r.winRate)} (must be 45-80 %${bandNote(0.45, 0.8, runs)})`));
  }
  const rates = SKILLED.map((l) => lane(l).winRate);
  const spread = Math.max(...rates) - Math.min(...rates);
  gates.push(hard(spread <= 0.35 + slack(0.35, runs), `route spread best − worst ${num(spread, 2)} (must be ≤ 0.35${bandNote(0.35, 0.35, runs)})`));

  const novice = lane('novice');
  gates.push(hard(inBand(novice.winRate, 0, 0.4, runs), `novice floor bot wins ${pct(novice.winRate)} (must be ≤ 40 %${bandNote(0.4, 0.4, runs)})`));
  const matron = share(novice.runs, (r) => r.probe.reachedMatron);
  gates.push(hard(inBand(matron, 0.5, 1, runs), `novice reaches the night-5 Matron in ${pct(matron)} (must be ≥ 50 %${bandNote(0.5, 0.5, runs)})`));

  const winLengths = SKILLED.flatMap((l) => lane(l).wins.map((r) => r.result.timeSec));
  const winLen = median(winLengths);
  gates.push(soft(winLengths.length > 0 && winLen >= 540 && winLen <= 700, `median winning Landing ${num(winLen, 0)} s over ${winLengths.length} wins (must be 540-700 s)`));

  const spireSol = median(lane('spire').runs.flatMap((r) => (r.probe.triggerSol === null ? [] : [r.probe.triggerSol])));
  gates.push(soft(spireSol >= 7 && spireSol <= 8, `spire median trigger sol ${num(spireSol, 1)} (must be 7-8)`));
  const bastionSol = median(lane('bastion').runs.flatMap((r) => (r.probe.triggerSol === null ? [] : [r.probe.triggerSol])));
  gates.push(soft(bastionSol === 10, `bastion median trigger sol ${num(bastionSol, 1)} (must be 10)`));

  const gaps = SKILLED.flatMap((l) => lane(l).runs.flatMap((r) => dayGaps(r, table)));
  const gapMedian = median(gaps);
  const gapP90 = percentile(gaps, 0.9);
  gates.push(soft(gapMedian <= 15 && gapP90 <= 25, `decision cadence over day windows: median gap ${num(gapMedian, 1)} s (≤ 15), p90 ${num(gapP90, 1)} s (≤ 25)`));

  const skilledRuns = SKILLED.flatMap((l) => lane(l).runs);
  const payoffOk = share(skilledRuns, (r) => longestQuiet(r) <= 20);
  const worstQuiet = Math.max(...skilledRuns.map(longestQuiet));
  gates.push(soft(payoffOk >= 0.95, `payoff cadence: ${pct(payoffOk)} of Landings never go > 20 s without a payoff beat (must be ≥ 95 %; worst stretch ${num(worstQuiet, 1)} s)`));

  const bastion = lane('bastion');
  const n1Clean = share(bastion.runs, (r) => r.probe.night1Lost === 0);
  gates.push(hard(inBand(n1Clean, 0.95, 1, runs), `bastion survives night 1 without a building lost in ${pct(n1Clean)} (must be ≥ 95 %${bandNote(0.95, 0.95, runs)})`));

  const sprawl = lane('sprawl');
  const sprawlBrown = share(sprawl.runs, (r) => r.trace.brownoutNights > 0);
  gates.push(soft(inBand(sprawlBrown, 0.6, 1, runs), `tension: sprawl browns out on ≥ 1 night in ${pct(sprawlBrown)} of Landings (must be ≥ 60 %${bandNote(0.6, 0.6, runs)})`));
  const bastionNights = bastion.runs.reduce((s, r) => s + r.probe.nightsReached, 0);
  const bastionBrownNights = bastion.runs.reduce((s, r) => s + r.trace.brownoutNights, 0);
  const bastionBrownShare = bastionNights > 0 ? bastionBrownNights / bastionNights : Number.NaN;
  gates.push(soft(bastionBrownShare <= 0.4, `tension: bastion browns out on ${pct(bastionBrownShare)} of its ${bastionNights} nights (must be ≤ 40 %)`));

  const noviceGap = Math.max(...novice.runs.map((r) => r.probe.sol1MaxGapSec));
  gates.push(soft(noviceGap <= 15, `sol 1 economy: novice's longest wait between placements in sol 1 is ${num(noviceGap, 1)} s (must be ≤ 15 s)`));
  const starved = share(bastion.runs, (r) => r.probe.starvedBeforeSol3);
  const lowRations = share(bastion.runs, (r) => r.probe.rationsAtSol2Dawn !== null && r.probe.rationsAtSol2Dawn < 30);
  gates.push(soft(starved === 0 && lowRations === 0, `sol 1 economy: bastion rations hit 0 before the sol 3 dawn in ${pct(starved)} and stand < 30 at the sol 2 dawn in ${pct(lowRations)} (both must be 0 %)`));
  const margins = share(bastion.runs, (r) => [0, 1, 2, 3].every((i) => (r.probe.nightMarginKw[i] ?? 0) >= -1e-6));
  gates.push(soft(inBand(margins, 0.9, 1, runs), `sol 1 economy: bastion night power margin (banks included) ≥ 0 on nights 1-4 in ${pct(margins)} (must be ≥ 90 %${bandNote(0.9, 0.9, runs)})`));
  const firstBrown = median(sprawl.runs.flatMap((r) => (r.probe.firstBrownoutSol === null ? [] : [r.probe.firstBrownoutSol])));
  gates.push(soft(firstBrown >= 3 && firstBrown <= 4, `sol 1 economy: sprawl's first brownout falls on night ${num(firstBrown, 1)} (median; must be 3-4)`));

  const bite = lane('novice-noturret');
  const bites = share(bite.runs, (r) => r.probe.night1Lost >= 1 && r.probe.coreShareAfterNight1 >= 0.9);
  gates.push(hard(inBand(bites, 0.7, 1, runs), `night 1 bites: novice-noturret loses ≥ 1 building on night 1 with the core ≥ 90 % in ${pct(bites)} (must be ≥ 70 %${bandNote(0.7, 0.7, runs)})`));

  const allRuns = reports.flatMap((r) => r.runs);
  const done = new Set(allRuns.flatMap((r) => r.trace.ordersDone));
  const missingOrders = ORDERS.filter((o) => !done.has(o.id)).map((o) => o.id);
  gates.push(soft(ORDERS.length > 0 && missingOrders.length === 0, ORDERS.length === 0 ? 'orders: no order templates authored (ORDERS is empty)' : `orders: every template completed ≥ 1× across the batch${missingOrders.length > 0 ? ` — never: ${missingOrders.join(', ')}` : ''}`));
  const claimed = new Set(allRuns.flatMap((r) => r.trace.relics));
  const missingRelics = RELICS.filter((r) => !claimed.has(r.id)).map((r) => r.id);
  gates.push(soft(missingRelics.length === 0, `relics: every relic kind claimed ≥ 1× across the batch${missingRelics.length > 0 ? ` — never: ${missingRelics.join(', ')}` : ''}`));

  return gates;
}

const runColonySim: FamilySim = (options: FamilySimOptions): number => {
  const runs = Math.max(1, Math.floor(options.runs));
  const started = performance.now();
  const reports: LaneReport[] = LANE_LABELS.map((label) => {
    const played = playLane(label, runs, options.seed);
    const wins = played.filter((r) => r.result.won);
    return { label, runs: played, wins, winRate: wins.length / played.length };
  });
  const elapsedMs = performance.now() - started;
  const budgetMs = calibratedBudget(SIM_BUDGET_MS * (runs / 20), calibrateRunner());
  const replay = playLane('bastion', 1, options.seed)[0];
  const first = reports.find((r) => r.label === 'bastion')?.runs[0];
  const deterministic = replay !== undefined && first !== undefined && JSON.stringify(replay.result) === JSON.stringify(first.result) && JSON.stringify(replay.trace) === JSON.stringify(first.trace);
  const gates = evaluateGates(reports, runs, elapsedMs, budgetMs, deterministic);

  if (options.trace !== undefined) {
    writeFileSync(options.trace, JSON.stringify(reports.map((r) => ({ lane: r.label, landings: r.runs })), null, 1));
  }

  const summary = reports.map((r) => {
    const triggers = r.runs.flatMap((x) => (x.probe.triggerSol === null ? [] : [x.probe.triggerSol]));
    const reasons: Record<string, number> = {};
    for (const x of r.runs) if (!x.result.won) reasons[x.result.reason] = (reasons[x.result.reason] ?? 0) + 1;
    return {
      lane: r.label,
      runs: r.runs.length,
      winRate: r.winRate,
      medianWinSec: median(r.wins.map((x) => x.result.timeSec)),
      medianTriggerSol: median(triggers),
      meanSols: mean(r.runs.map((x) => x.result.solsSurvived)),
      brownoutLandings: share(r.runs, (x) => x.trace.brownoutNights > 0),
      nightsLostMean: mean(r.runs.map((x) => x.trace.nightsLost.length)),
      dataPerLanding: mean(r.runs.map((x) => x.result.data.total)),
      losses: reasons,
    };
  });

  const render = (): void => {
    console.log('colony (family A) — Landings on Halcyon Flats rung 1, real model + threat, 100 ms steps');
    printTable(
      ['lane', 'runs', 'win', 'winLen', 'trigSol', 'sols', 'brownout', 'nightsLost', 'data', 'losses'],
      summary.map((s) => [
        s.lane,
        String(s.runs),
        pct(s.winRate),
        num(s.medianWinSec, 0),
        num(s.medianTriggerSol, 1),
        num(s.meanSols, 1),
        pct(s.brownoutLandings),
        num(s.nightsLostMean, 1),
        num(s.dataPerLanding, 0),
        Object.entries(s.losses).map(([k, v]) => `${k}:${v}`).join(' ') || '-',
      ]),
    );
    console.log(`\n${runs} Landing(s) per lane, seed '${options.seed}', ${num(elapsedMs / 1000, 1)} s wall. Data per Landing feeds ark.selftest.ts.`);
  };

  return finishFamily(options, gates, render, { family: 'colony', runs, lanes: summary });
};

export default runColonySim;
