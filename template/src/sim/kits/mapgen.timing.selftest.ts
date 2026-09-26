// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/mapgen.timing.selftest.ts
//   MAPGEN_TIMING_SEEDS (default 30) fresh generations of the default world.
//
// World generation happens on the scene's `create()`, between the menu tap
// and the first playable frame (retry-to-playable ≤ 2 s, AGENTS.md
// §Responsiveness), so it has a budget: median ≤ 60 ms, p95 ≤ 120 ms ON THE
// REFERENCE MACHINE for the default 36-screen world. The budget is scaled by
// this runner's measured speed (`src/sim/calibrate.ts` — a raw millisecond
// gate is a statement about one machine; duskhaul's failed CI at 653 ms > 600
// on a slower runner while the code met it). `verify.sh` runs
// `*.timing.selftest.ts` alone, before the parallel selftest pool. Every world
// here is `generateWorld` itself; the disk cache is never consulted.
import assert from 'node:assert/strict';
import { WORLD } from '../../data/world';
import { generateWorld } from '../../systems/mapgen';
import { calibrateRunner, calibratedBudget, describeRunner } from '../calibrate';

const MEDIAN_BUDGET_MS = 60;
const P95_BUDGET_MS = 120;
const SEEDS = Number(process.env.MAPGEN_TIMING_SEEDS ?? 30);

// Warm the JIT so the first samples measure the generator, not compilation.
for (let i = 0; i < 3; i += 1) generateWorld(WORLD, `warmup-${i}`);

const runner = calibrateRunner();
console.log(describeRunner(runner));

const times: number[] = [];
for (let i = 0; i < SEEDS; i += 1) times.push(generateWorld(WORLD, `timing-${i}`).metrics.ms);
times.sort((p, q) => p - q);
const median = times[Math.floor(times.length / 2)]!;
const p95 = times[Math.floor(times.length * 0.95)]!;
const medianBudget = calibratedBudget(MEDIAN_BUDGET_MS, runner);
const p95Budget = calibratedBudget(P95_BUDGET_MS, runner);
console.log(`generation ms over ${times.length} worlds: median ${median.toFixed(1)}, p95 ${p95.toFixed(1)}, max ${times[times.length - 1]!.toFixed(1)}`);
console.log(`budget: median ≤ ${medianBudget.toFixed(0)} ms, p95 ≤ ${p95Budget.toFixed(0)} ms`);
assert.ok(median <= medianBudget, `median generation ${median.toFixed(1)} ms > ${medianBudget.toFixed(0)} (${MEDIAN_BUDGET_MS} × runner scale ${runner.scale.toFixed(2)})`);
assert.ok(p95 <= p95Budget, `p95 generation ${p95.toFixed(1)} ms > ${p95Budget.toFixed(0)} (${P95_BUDGET_MS} × runner scale ${runner.scale.toFixed(2)})`);

console.log('mapgen timing OK');
