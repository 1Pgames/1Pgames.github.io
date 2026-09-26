/**
 * Runner-speed calibration for wall-clock gates — every budget a
 * `src/sim/kits/*.timing.selftest.ts` asserts goes through `calibratedBudget`.
 *
 * A raw millisecond budget is a statement about ONE machine. A GitHub runner
 * generated at median 653 ms what the reference Mac generates at ~350-400 ms and
 * failed a 600 ms gate the code met (duskhaul mapgen, 2026-09). So a budget is
 * written in reference-machine milliseconds and scaled by this runner's measured
 * speed: a fixed, deterministic reference workload shaped like typical
 * generator hot loops (raster fills with hashing and `Math.sqrt`, a two-pass
 * chamfer distance transform, a queue flood fill, small-object churn) is timed
 * min-of-N, and budgets scale by `max(1, refMs / baselineMs)`. The floor of 1
 * means a faster machine never gets a TIGHTER budget than the spec number, and
 * a slower (or loaded) one gets exactly its measured slowdown. A regression in
 * the gated code still fails everywhere, because it moves the gated time and
 * not the reference.
 *
 * Usage in a timing selftest:
 *   const runner = calibrateRunner();
 *   console.log(describeRunner(runner));
 *   assert.ok(medianMs <= calibratedBudget(600, runner), ...);
 */

/**
 * Min-of-5 time of `REFERENCE_REPS`× the reference workload on the reference
 * machine (Apple M-series, Node 24), idle. Measured there: 93-100 ms; under 14
 * busy processes the same machine measured ×1.9 on the reference and ×2.2 on
 * the mapgen it calibrates — the two move together.
 */
const REFERENCE_BASELINE_MS = 95;
/** Workload repetitions per timed sample (one sample ≈ `REFERENCE_BASELINE_MS`). */
const REFERENCE_REPS = 3;

export interface RunnerCalibration {
  /** Min-of-samples time of `REFERENCE_REPS`× the reference workload on this runner. */
  refMs: number;
  baselineMs: number;
  /** `max(1, refMs / baselineMs)` — multiply every reference-machine budget by it. */
  scale: number;
  /** Workload checksum; printed so V8 cannot prove the work dead. */
  checksum: number;
}

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
  // Two-pass chamfer distance transform (3-4 metric).
  const dist = new Float32Array(cells).fill(1e9);
  for (let i = 0; i < cells; i += 1) if (blocked[i] === 1) dist[i] = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 1; y < N - 1; y += 1) {
      for (let x = 1; x < N - 1; x += 1) {
        const i = y * N + x;
        dist[i] = Math.min(dist[i]!, dist[i - 1]! + 3, dist[i - N]! + 3, dist[i - N - 1]! + 4, dist[i - N + 1]! + 4);
      }
    }
    for (let y = N - 2; y >= 1; y -= 1) {
      for (let x = N - 2; x >= 1; x -= 1) {
        const i = y * N + x;
        dist[i] = Math.min(dist[i]!, dist[i + 1]! + 3, dist[i + N]! + 3, dist[i + N + 1]! + 4, dist[i + N - 1]! + 4);
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

/**
 * Time the reference workload on THIS runner. Call it once per timing
 * selftest, immediately before the gated measurement, so both see the same
 * machine load.
 */
export function calibrateRunner(samples = 5, baselineMs = REFERENCE_BASELINE_MS): RunnerCalibration {
  let checksum = 0;
  let refMs = Number.POSITIVE_INFINITY;
  for (let s = 0; s < samples; s += 1) {
    const t0 = performance.now();
    for (let k = 0; k < REFERENCE_REPS; k += 1) checksum += referenceWorkload();
    refMs = Math.min(refMs, performance.now() - t0);
  }
  return { refMs, baselineMs, scale: Math.max(1, refMs / baselineMs), checksum };
}

/** A reference-machine budget, scaled to this runner. Never below `budgetMs`. */
export function calibratedBudget(budgetMs: number, runner: RunnerCalibration): number {
  return budgetMs * runner.scale;
}

/** One log line naming the measurement, so a CI failure shows which side moved. */
export function describeRunner(runner: RunnerCalibration): string {
  return `runner calibration: reference workload ${runner.refMs.toFixed(1)} ms `
    + `(baseline ${runner.baselineMs} ms) → budgets ×${runner.scale.toFixed(2)} [checksum ${runner.checksum.toFixed(0)}]`;
}
