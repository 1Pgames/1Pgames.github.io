import { LevelDirector } from '../../core/level';
import { Rng } from '../../core/rng';
import {
  jumpEnvelope,
  planHop,
  planSpikeHop,
  platformRight,
  spikesOn,
  validateLevel,
  type JumpEnvelope,
  type SideGeometry,
  type SideLevel,
} from '../../slices/side/gen';
import { SIDE_LEVEL_KNOBS, buildSideLevel, sideLevelSpec } from '../../slices/side/levels';
import { SIDE_TUNING } from '../../slices/side/tuning';

/**
 * Headless balance gates for the side-view platformer slice (family C).
 *
 * Two things are checked, and they are different questions:
 *
 *  1. Is every generated level *possible*? `gen.ts`'s validator answers that
 *     analytically (a hop chain inside the jump envelope), so the gate just
 *     replays the shipped ladder across many seeds and insists it never
 *     produces a level it cannot itself prove.
 *  2. Is every level *playable by a human*? For that a bot actually runs the
 *     level through the same integrator the slice uses — auto-run right, jump
 *     with a variable-height release, coyote time — aiming at the analytic
 *     takeoff windows but with human timing jitter on top. Its completion rate
 *     per level is the difficulty curve.
 *
 * The jitter model is the whole point of the second gate, so it is explicit:
 * a player's jump timing scatters around the intended instant with a standard
 * deviation of `JITTER_MS_AT_ZERO_SKILL * (1 - skill)` — 45ms at the median
 * skill 0.5, which is the ballpark of human motor timing SD. At 260px/s that
 * is ±11.7px of takeoff position against landing windows of 30-90px, so an
 * early jump on a tight late-ladder gap really does fall short. Late jumps are
 * partly forgiven by the slice's 100ms coyote time, exactly as in the game.
 *
 * Run: `npm run sim -- --family side [--runs 20] [--seed balance] [--json]`
 */

interface FamilyOptions {
  runs: number;
  seed: string;
  strict: boolean;
  json: boolean;
}

const STEP_S = 1 / 60;
const STEP_MS = STEP_S * 1000;
const JITTER_MS_AT_ZERO_SKILL = 90;
/** Skill the gates are evaluated at: a median player, not an expert. */
const GATE_SKILL = 0.5;
/** Jitter streams per generated level — the same level, replayed by three players. */
const ATTEMPTS_PER_SEED = 3;
/** Seeds the analytic validator gate sweeps, independent of `--runs`. */
const VALIDATION_SEEDS = 50;

const geo: SideGeometry = SIDE_TUNING.geometry;
const motion = SIDE_TUNING.motion;
const env: JumpEnvelope = jumpEnvelope(motion);

interface RunResult {
  won: boolean;
  reason: string;
  timeS: number;
  coins: number;
  /** Platform index the run ended on — where the level actually kills people. */
  platform: number;
}

/** Box-Muller normal deviate: jump timing scatters, it does not sit in a box. */
function gaussian(rng: Rng): number {
  const u = Math.max(1e-9, rng.next());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * rng.next());
}

interface JumpPlan {
  takeoffX: number;
  cutAtS: number;
}

/**
 * What the bot intends to do from the platform it is standing on: clear the
 * spike ahead of it if there is one, otherwise cross the gap to the next
 * platform. Returns null on the exit pad (nothing left to jump).
 *
 * Both plans are solved from the bot's ACTUAL x, not from the platform's left
 * edge: a player who landed late picks the jump strength that still fits
 * rather than committing to a takeoff already behind them. Without that the
 * bot inherits every previous landing error and the measured difficulty says
 * more about error carry-over than about the level.
 *
 * Two independent human errors are injected, both scaled by `jitterS`:
 *  - WHEN the jump starts, which mostly shifts the takeoff (and is partly
 *    absorbed: an aim already behind the runner just becomes "jump now");
 *  - WHEN the button is RELEASED, which changes the arc itself and is not
 *    absorbed by anything. A held (uncut) jump has no release to mistime, so
 *    max-height jumps stay easy and precision hops — the ones tight platforms
 *    force — are where a level gets its difficulty.
 */
function planNext(
  level: SideLevel,
  index: number,
  x: number,
  jitterS: number,
  rng: Rng,
): JumpPlan | null {
  const platform = level.platforms[index];
  if (platform === undefined) return null;
  const jitterPx = jitterS * motion.moveSpeed;

  const mistime = (cutAtS: number): number => {
    if (!Number.isFinite(cutAtS)) return cutAtS;
    return Math.max(0.03, cutAtS + gaussian(rng) * jitterS);
  };

  const spike = level.spikes.find((s) => s.x + s.w > x && s.x < platformRight(platform) && s.y + s.h === platform.y);
  if (spike !== undefined) {
    const hop = planSpikeHop(env, platform, spike, geo, x);
    if (hop === null) return null;
    return { takeoffX: hop.takeoffX + gaussian(rng) * jitterPx, cutAtS: mistime(hop.cutAtS) };
  }

  const next = level.platforms[index + 1];
  if (next === undefined) return null;
  const hop = planHop(env, platform, next, geo, x, spikesOn(level, next));
  if (hop === null) return null;
  return { takeoffX: hop.takeoffX + gaussian(rng) * jitterPx, cutAtS: mistime(hop.cutAtS) };
}

/**
 * Runs one attempt at `level`. The integrator is trapezoidal (exact for
 * constant gravity), so the run agrees with the closed-form envelope in
 * `gen.ts` rather than drifting a few px per jump away from it.
 *
 * The player is modelled as a point at its feet — which is the same point the
 * generator's landing windows and coin arcs are expressed in.
 */
function simulateRun(level: SideLevel, skill: number, rng: Rng): RunResult {
  const director = new LevelDirector(sideLevelSpec(level.index));
  const jitterS = (JITTER_MS_AT_ZERO_SKILL * (1 - skill)) / 1000;
  const coyoteS = SIDE_TUNING.player.coyoteMs / 1000;

  let x = level.spawn.x;
  let y = level.spawn.y;
  let vy = 0;
  let grounded = true;
  let standing = 0;
  let airborneS = 0;
  let cutAtS = Number.POSITIVE_INFINITY;
  let jumpedThisAir = false;
  let plan: JumpPlan | null = planNext(level, 0, x, jitterS, rng);
  let coins = 0;
  const collected = new Set<number>();

  while (!director.ended) {
    director.update(STEP_MS);

    // --- input: jump when the run reaches the planned takeoff -------------
    const canJump = grounded || (!jumpedThisAir && airborneS <= coyoteS && vy >= 0);
    if (plan !== null && canJump && x >= plan.takeoffX) {
      vy = -motion.jumpVel;
      cutAtS = plan.cutAtS;
      grounded = false;
      airborneS = 0;
      jumpedThisAir = true;
      plan = null;
    }

    // --- integrate --------------------------------------------------------
    x += motion.moveSpeed * STEP_S;
    const previousY = y;
    if (!grounded) {
      airborneS += STEP_S;
      if (airborneS >= cutAtS && vy < 0) {
        vy *= motion.cutFactor;
        cutAtS = Number.POSITIVE_INFINITY;
      }
      const nextVy = vy + motion.gravity * STEP_S;
      y += ((vy + nextVy) / 2) * STEP_S;
      vy = nextVy;
    }

    // --- surface resolution ----------------------------------------------
    if (grounded) {
      const current = level.platforms[standing]!;
      if (x > platformRight(current)) {
        grounded = false;
        airborneS = 0;
        jumpedThisAir = false;
        vy = 0;
      }
    } else if (vy > 0) {
      const landed = level.platforms.findIndex(
        (p, i) => i >= standing && x >= p.x && x <= platformRight(p) && previousY <= p.y && y >= p.y,
      );
      if (landed >= 0) {
        const platform = level.platforms[landed]!;
        y = platform.y;
        vy = 0;
        grounded = true;
        standing = landed;
        jumpedThisAir = false;
        cutAtS = Number.POSITIVE_INFINITY;
        plan = planNext(level, standing, x, jitterS, rng);
      }
    }

    // --- hazards ----------------------------------------------------------
    if (y > level.worldHeight) {
      director.fail('void');
      break;
    }
    const spiked = level.spikes.some((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
    if (spiked) {
      director.fail('hazard');
      break;
    }

    // --- pickups and the door --------------------------------------------
    for (let i = 0; i < level.coins.length; i += 1) {
      if (collected.has(i)) continue;
      const coin = level.coins[i]!;
      if (Math.abs(coin.x - x) > geo.coinRadius) continue;
      if (Math.hypot(coin.x - x, coin.y - y) > geo.coinRadius) continue;
      collected.add(i);
      coins += 1;
    }
    if (grounded && x >= level.exit.x) {
      director.recordProgress('exit');
      break;
    }
  }

  const outcome = director.outcome;
  return {
    won: outcome?.won ?? false,
    reason: outcome?.reason ?? 'out-of-time',
    timeS: director.elapsedSeconds,
    coins,
    platform: standing,
  };
}

interface LevelReport {
  level: number;
  /** Generator health across the validation sweep. */
  attempts: number;
  relaxed: number;
  platforms: number;
  spikes: number;
  coins: number;
  minWindow: number;
  maxGap: number;
  /** Bot results at `GATE_SKILL`. */
  runs: number;
  wins: number;
  completion: number;
  medianTimeS: number | null;
  topDeath: string;
  /** Runs by a zero-jitter bot: a fair level is always clearable by perfect play. */
  flawlessRuns: number;
  flawlessWins: number;
  /** First flawless failure, for the fairness gate's message. */
  unfairSeed: string | null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

interface GateResult {
  ok: boolean;
  level: 'hard' | 'soft';
  message: string;
}

function buildReports(options: FamilyOptions): { reports: LevelReport[]; validationFailures: string[] } {
  const reports: LevelReport[] = [];
  const validationFailures: string[] = [];
  const seeds = Math.max(VALIDATION_SEEDS, options.runs);

  for (let index = 0; index < SIDE_LEVEL_KNOBS.length; index += 1) {
    let attempts = 0;
    let relaxed = 0;
    let platforms = 0;
    let spikes = 0;
    let coins = 0;
    let minWindow = Number.POSITIVE_INFINITY;
    let maxGap = 0;
    const times: number[] = [];
    const deaths = new Map<string, number>();
    let wins = 0;
    let runs = 0;
    let flawlessRuns = 0;
    let flawlessWins = 0;
    let unfairSeed: string | null = null;

    for (let s = 0; s < seeds; s += 1) {
      const seed = `${options.seed}:${s}`;
      const level = buildSideLevel(index, seed);
      const check = validateLevel(level, env, geo);
      attempts += level.attempts;
      if (level.relaxed) relaxed += 1;
      platforms += level.platforms.length;
      spikes += level.spikes.length;
      coins += level.coins.length;
      if (!check.ok) {
        validationFailures.push(`L${index + 1} seed ${seed}: ${check.reason}`);
        continue;
      }
      minWindow = Math.min(minWindow, check.minWindow);
      maxGap = Math.max(maxGap, check.maxGap);

      // The bot only plays `--runs` of the generated seeds; the rest are there
      // for the analytic sweep, which is much cheaper than a full run.
      if (s >= options.runs) continue;

      // Perfect play first: skill 1 means zero jitter, so this is a fairness
      // check on the LEVEL (does the trap-aware hop planner really cover every
      // hazard?), not a measurement of a player.
      const flawless = simulateRun(level, 1, new Rng(`${seed}:flawless:${index}`));
      flawlessRuns += 1;
      if (flawless.won) flawlessWins += 1;
      else if (unfairSeed === null) unfairSeed = `${seed} (${flawless.reason} on platform ${flawless.platform})`;

      for (let attempt = 0; attempt < ATTEMPTS_PER_SEED; attempt += 1) {
        const result = simulateRun(level, GATE_SKILL, new Rng(`${seed}:bot:${index}:${attempt}`));
        runs += 1;
        if (result.won) {
          wins += 1;
          times.push(result.timeS);
        } else {
          deaths.set(result.reason, (deaths.get(result.reason) ?? 0) + 1);
        }
      }
    }

    let topDeath = 'none';
    let topCount = 0;
    for (const [reason, count] of deaths) {
      if (count > topCount) {
        topCount = count;
        topDeath = reason;
      }
    }

    reports.push({
      level: index + 1,
      attempts: attempts / seeds,
      relaxed,
      platforms: platforms / seeds,
      spikes: spikes / seeds,
      coins: coins / seeds,
      minWindow: minWindow === Number.POSITIVE_INFINITY ? 0 : minWindow,
      maxGap,
      runs,
      wins,
      completion: runs > 0 ? wins / runs : 0,
      medianTimeS: median(times),
      topDeath,
      flawlessRuns,
      flawlessWins,
      unfairSeed,
    });
  }

  return { reports, validationFailures };
}

function evaluateGates(
  reports: readonly LevelReport[],
  validationFailures: readonly string[],
  strict: boolean,
): GateResult[] {
  const gates: GateResult[] = [];

  gates.push({
    ok: validationFailures.length === 0,
    level: 'hard',
    message:
      validationFailures.length === 0
        ? `all ${SIDE_LEVEL_KNOBS.length} levels validated across every seed (reachability proof holds)`
        : `${validationFailures.length} level(s) failed their own reachability proof, first: ${validationFailures[0]}`,
  });

  const relaxedTotal = reports.reduce((sum, report) => sum + report.relaxed, 0);
  gates.push({
    ok: relaxedTotal === 0,
    level: 'soft',
    message: `${relaxedTotal} level(s) needed the relaxed knob fallback (the shipped ladder should place directly)`,
  });

  const early = reports.filter((report) => report.level <= 3);
  const earlyWorst = early.reduce(
    (worst, report) => (report.completion < worst.completion ? report : worst),
    early[0] ?? reports[0]!,
  );
  gates.push({
    ok: earlyWorst.completion >= 0.7,
    level: 'hard',
    message: `L1-3 completion at skill ${GATE_SKILL}: worst is L${earlyWorst.level} at ${(earlyWorst.completion * 100).toFixed(0)}% (must be >= 70%)`,
  });

  const finale = reports[reports.length - 1]!;
  gates.push({
    ok: finale.completion >= 0.25,
    level: 'hard',
    message: `L${finale.level} completion at skill ${GATE_SKILL}: ${(finale.completion * 100).toFixed(0)}% (must be >= 25%)`,
  });

  // Perfect play must clear everything. This is the gate that actually proves
  // the hazard-aware hop planner: an unfair level is one where a player who
  // lands exactly where the planner told them to still has no legal jump left.
  const unfair = reports.filter((report) => report.flawlessWins < report.flawlessRuns);
  gates.push({
    ok: unfair.length === 0,
    level: 'hard',
    message:
      unfair.length === 0
        ? `zero-jitter play clears all ${reports.length} levels on every seed (no unfair level)`
        : `unfair level(s): ${unfair
            .map((report) => `L${report.level} ${report.flawlessRuns - report.flawlessWins}x, first ${report.unfairSeed}`)
            .join('; ')}`,
  });

  // Difficulty trend, aggregated: single-level completion at 60 runs is too
  // noisy to gate on, but the ladder's two halves should still separate.
  const meanCompletion = (subset: readonly LevelReport[]): number =>
    subset.reduce((sum, report) => sum + report.completion, 0) / Math.max(1, subset.length);
  const earlyMean = meanCompletion(early);
  const lateMean = meanCompletion(reports.filter((report) => report.level >= reports.length - 2));
  gates.push({
    ok: lateMean <= earlyMean,
    level: 'soft',
    message: `difficulty trend: L1-3 mean ${(earlyMean * 100).toFixed(0)}% vs last three ${(lateMean * 100).toFixed(0)}% (the ladder should not get easier)`,
  });

  // Completion time is dominated by the world length: 5600px at 260px/s is
  // ~21.5s of running, plus airtime and the door approach.
  const outOfBand = reports.filter(
    (report) => report.medianTimeS !== null && (report.medianTimeS < 20 || report.medianTimeS > 75),
  );
  gates.push({
    ok: outOfBand.length === 0,
    level: 'soft',
    message:
      outOfBand.length === 0
        ? `median completion time per level within [20, 75]s (${reports
            .map((report) => report.medianTimeS?.toFixed(1) ?? 'n/a')
            .join(', ')})`
        : `level(s) outside the 20-75s completion band: ${outOfBand
            .map((report) => `L${report.level}=${report.medianTimeS?.toFixed(1)}s`)
            .join(', ')}`,
  });

  const noCoins = reports.filter((report) => report.coins < 8);
  gates.push({
    ok: noCoins.length === 0,
    level: 'soft',
    message:
      noCoins.length === 0
        ? `every level pays 8-14 coins (mean ${reports.map((r) => r.coins.toFixed(1)).join(', ')})`
        : `level(s) under the 8-coin payout floor: ${noCoins.map((r) => `L${r.level}`).join(', ')}`,
  });

  if (strict) return gates.map((gate) => ({ ...gate, level: 'hard' as const }));
  return gates;
}

function printTable(reports: readonly LevelReport[]): void {
  console.log('side (family C) — authored platformer levels');
  console.log('level  plats  spikes  coins  maxGap  minWin  runs  completion  medianS  topDeath  genTries');
  console.log('------------------------------------------------------------------------------------------');
  for (const report of reports) {
    console.log(
      `L${String(report.level).padEnd(5)}` +
        `${report.platforms.toFixed(1).padStart(5)}  ` +
        `${report.spikes.toFixed(1).padStart(6)}  ` +
        `${report.coins.toFixed(1).padStart(5)}  ` +
        `${String(report.maxGap).padStart(6)}  ` +
        `${report.minWindow.toFixed(0).padStart(6)}  ` +
        `${String(report.runs).padStart(4)}  ` +
        `${`${(report.completion * 100).toFixed(0)}%`.padStart(10)}  ` +
        `${(report.medianTimeS?.toFixed(1) ?? 'n/a').padStart(7)}  ` +
        `${report.topDeath.padEnd(8)}  ` +
        `${report.attempts.toFixed(2).padStart(8)}`,
    );
  }
}

/**
 * Family entry point (see `src/sim/cli.ts`): returns the process exit code —
 * 0 when every hard gate passes, 1 otherwise.
 */
export default function runFamilySim(options: FamilyOptions): number {
  const { reports, validationFailures } = buildReports(options);
  const gates = evaluateGates(reports, validationFailures, options.strict);
  const hardFailures = gates.filter((gate) => gate.level === 'hard' && !gate.ok);
  const softWarnings = gates.filter((gate) => gate.level === 'soft' && !gate.ok);

  if (options.json) {
    console.log(JSON.stringify({ family: 'side', reports, gates, validationFailures }, null, 2));
  } else {
    printTable(reports);
    console.log('');
    for (const gate of gates) {
      const tag = gate.ok ? 'PASS' : gate.level === 'hard' ? 'FAIL' : 'WARN';
      console.log(`[${tag}] ${gate.message}`);
    }
  }

  if (hardFailures.length > 0) {
    console.error(`\n${hardFailures.length} hard gate(s) failed.`);
    return 1;
  }
  if (softWarnings.length > 0 && !options.json) {
    console.error(`\n${softWarnings.length} soft warning(s) (non-fatal; pass --strict to fail on these).`);
  }
  return 0;
}
