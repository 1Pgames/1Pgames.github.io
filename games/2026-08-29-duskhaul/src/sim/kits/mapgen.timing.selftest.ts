// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/mapgen.timing.selftest.ts
//   MAPGEN_TIMING_SEEDS (default 20) fresh generations per zone.
//
// Generation-time gate for the 24576² map (user request): median ≤ 600 ms,
// p95 ≤ 1200 ms ON THE REFERENCE MACHINE. `verify.sh` runs the selftests in
// parallel but runs every `src/sim/kits/*.timing.selftest.ts` alone, before
// that pool, because a wall-clock budget measured while eight other processes
// share the CPU fails on load, not on code.
//
// Runner-speed calibration. A GitHub runner generated at median 653 ms what the
// reference Mac generates at ~350-400 ms, and failed a gate the code met. The
// budget is therefore expressed in units of this machine's speed: a fixed,
// deterministic reference workload shaped like mapgen's hot loops (768² mask
// raster fills with hashing and `Math.sqrt`, a two-pass chamfer distance
// transform, a queue flood fill, small-object churn) is timed first, and both
// budgets scale by `max(1, refMs / REF_BASELINE_MS)`. The floor of 1 means a
// faster machine never gets a TIGHTER budget than the spec numbers, and a
// slower one gets exactly its measured slowdown — a mapgen regression still
// fails everywhere, because it moves the generation time and not the
// reference. Every map here is `generateMap` itself; the disk cache is never
// consulted.
import assert from 'node:assert/strict';
import { ZONES } from '../../data/zones';
import { generateMap } from '../../systems/mapgen';

const MEDIAN_BUDGET_MS = 600;
const P95_BUDGET_MS = 1200;
/**
 * Min-of-5 time of 3× the reference workload on the reference machine (Apple
 * M-series, Node 24.19), where the budgets were set: 93-100 ms idle, with mapgen
 * median ~350-370 ms. Under 14 busy processes the same machine measured
 * reference 184 ms (×1.9) and mapgen median 802 ms (×2.2): the two move together.
 */
const REF_BASELINE_MS = 95;
const SEEDS = Number(process.env.MAPGEN_TIMING_SEEDS ?? 20);

/** The fixed reference workload; returns a checksum so V8 cannot drop the work. */
function referenceWorkload(): number {
  const N = 768;
  const cells = N * N;
  const field = new Float32Array(cells);
  const blocked = new Uint8Array(cells);
  let h = 0x9e3779b9;
  for (let i = 0; i < cells; i += 1) {
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
    const x = i % N;
    const y = (i - x) / N;
    field[i] = Math.sqrt((x - N / 2) ** 2 + (y - N / 2) ** 2) + (h & 0xff) / 64;
    blocked[i] = (h & 0x1f) === 0 ? 1 : 0;
  }
  // Two-pass chamfer distance transform (3-4 metric), as mapgen's clearance rasters do.
  const dist = new Float32Array(cells).fill(1e9);
  for (let i = 0; i < cells; i += 1) if (blocked[i] === 1) dist[i] = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 1; y < N - 1; y += 1) {
      for (let x = 1; x < N - 1; x += 1) {
        const i = y * N + x;
        let d = dist[i]!;
        d = Math.min(d, dist[i - 1]! + 3, dist[i - N]! + 3, dist[i - N - 1]! + 4, dist[i - N + 1]! + 4);
        dist[i] = d;
      }
    }
    for (let y = N - 2; y >= 1; y -= 1) {
      for (let x = N - 2; x >= 1; x -= 1) {
        const i = y * N + x;
        let d = dist[i]!;
        d = Math.min(d, dist[i + 1]! + 3, dist[i + N]! + 3, dist[i + N + 1]! + 4, dist[i + N - 1]! + 4);
        dist[i] = d;
      }
    }
  }
  // Queue flood fill from the centre over open cells.
  const seen = new Uint8Array(cells);
  const queue = new Int32Array(cells);
  let head = 0;
  let tail = 0;
  const start = (N / 2) * N + N / 2;
  blocked[start] = 0;
  queue[tail++] = start;
  seen[start] = 1;
  while (head < tail) {
    const cur = queue[head++]!;
    const x = cur % N;
    if (x > 0 && seen[cur - 1] === 0 && blocked[cur - 1] === 0) { seen[cur - 1] = 1; queue[tail++] = cur - 1; }
    if (x < N - 1 && seen[cur + 1] === 0 && blocked[cur + 1] === 0) { seen[cur + 1] = 1; queue[tail++] = cur + 1; }
    if (cur >= N && seen[cur - N] === 0 && blocked[cur - N] === 0) { seen[cur - N] = 1; queue[tail++] = cur - N; }
    if (cur < cells - N && seen[cur + N] === 0 && blocked[cur + N] === 0) { seen[cur + N] = 1; queue[tail++] = cur + N; }
  }
  // Small-object churn (prop/anchor lists), sorted by a derived key.
  const objects: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < 60000; i += 1) objects.push({ x: field[(i * 7919) % cells]!, y: dist[(i * 104729) % cells]!, r: i & 63 });
  objects.sort((a, b) => a.x + a.r - (b.x + b.r));
  return tail + objects[0]!.x + dist[cells >> 1]!;
}

let checksum = 0;
const refTimes: number[] = [];
for (let rep = 0; rep < 5; rep += 1) {
  const t0 = performance.now();
  for (let k = 0; k < 3; k += 1) checksum += referenceWorkload();
  refTimes.push(performance.now() - t0);
}
const refMs = Math.min(...refTimes);
const scale = Math.max(1, refMs / REF_BASELINE_MS);
console.log(`mapgen timing: reference workload ${refMs.toFixed(1)} ms (baseline ${REF_BASELINE_MS} ms) → budget ×${scale.toFixed(2)} [checksum ${checksum.toFixed(0)}]`);

const times: number[] = [];
for (const zone of ZONES) {
  for (let i = 0; i < SEEDS; i += 1) times.push(generateMap(zone, `timing-${i}`).metrics.ms);
}
times.sort((p, q) => p - q);
const median = times[Math.floor(times.length / 2)]!;
const p95 = times[Math.floor(times.length * 0.95)]!;
const medianBudget = MEDIAN_BUDGET_MS * scale;
const p95Budget = P95_BUDGET_MS * scale;
console.log(`generation ms over ${times.length} maps: median ${median.toFixed(1)}, p95 ${p95.toFixed(1)}, max ${times[times.length - 1]!.toFixed(1)}`);
console.log(`budget: median ≤ ${medianBudget.toFixed(0)} ms, p95 ≤ ${p95Budget.toFixed(0)} ms`);
assert.ok(median <= medianBudget, `median generation ${median.toFixed(1)} ms > ${medianBudget.toFixed(0)} (${MEDIAN_BUDGET_MS} × runner scale ${scale.toFixed(2)})`);
assert.ok(p95 <= p95Budget, `p95 generation ${p95.toFixed(1)} ms > ${p95Budget.toFixed(0)} (${P95_BUDGET_MS} × runner scale ${scale.toFixed(2)})`);

console.log('mapgen timing OK');
