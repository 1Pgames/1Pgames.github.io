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
import { finishFamily, hard, median, num, pct, printTable, soft } from './types';
import type { FamilySimOptions, GateResult } from './types';

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

const STEP_S = 1 / 60;
const STEP_MS = STEP_S * 1000;
const JITTER_MS_AT_ZERO_SKILL = 90;
/**
 * Skill spread the gates are evaluated across — a novice, a median player and
 * an expert. Gating at the median alone said nothing about whether the ladder
 * REWARDS skill: a level that plays identically for a novice and an expert is
 * a level whose difficulty is noise, not execution, and only a spread shows
 * that up. 0.25/0.75 rather than 0.1/0.9 because the jitter model is a timing
 * SD (`JITTER_MS_AT_ZERO_SKILL * (1 - skill)`), and its ends — 81ms and 9ms —
 * are a flailing beginner and a frame-perfect robot, neither of whom the
 * ladder is authored for.
 */
const GATE_SKILLS: readonly number[] = [0.25, 0.5, 0.75];
/** Index into `GATE_SKILLS` of the median player every absolute band is read at. */
const MID = 1;
/** Jitter streams per generated level per skill — the same level, replayed by three players. */
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

/** One skill's bot sample on one level. */
interface SkillSample {
  skill: number;
  runs: number;
  wins: number;
  completion: number;
  medianTimeS: number | null;
  topDeath: string;
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
  /** One sample per `GATE_SKILLS` entry, in that order. */
  bySkill: SkillSample[];
  /** Runs by a zero-jitter bot: a fair level is always clearable by perfect play. */
  flawlessRuns: number;
  flawlessWins: number;
  /** First flawless failure, for the fairness gate's message. */
  unfairSeed: string | null;
}

/** The median player's sample — every absolute completion band is read here. */
function midSample(report: LevelReport): SkillSample {
  return report.bySkill[MID] as SkillSample;
}

function buildReports(options: FamilySimOptions): { reports: LevelReport[]; validationFailures: string[] } {
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
    let flawlessRuns = 0;
    let flawlessWins = 0;
    let unfairSeed: string | null = null;
    // One accumulator per gate skill, all fed from the SAME generated levels
    // so the completion spread is a pure measurement of execution.
    const times = GATE_SKILLS.map((): number[] => []);
    const deaths = GATE_SKILLS.map(() => new Map<string, number>());
    const wins = GATE_SKILLS.map(() => 0);
    const runs = GATE_SKILLS.map(() => 0);

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

      for (let k = 0; k < GATE_SKILLS.length; k += 1) {
        const skill = GATE_SKILLS[k] as number;
        for (let attempt = 0; attempt < ATTEMPTS_PER_SEED; attempt += 1) {
          const result = simulateRun(level, skill, new Rng(`${seed}:bot:${index}:${skill}:${attempt}`));
          runs[k] = (runs[k] as number) + 1;
          if (result.won) {
            wins[k] = (wins[k] as number) + 1;
            (times[k] as number[]).push(result.timeS);
          } else {
            const reasons = deaths[k] as Map<string, number>;
            reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1);
          }
        }
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
      bySkill: GATE_SKILLS.map((skill, k) => {
        let topDeath = 'none';
        let topCount = 0;
        for (const [reason, count] of deaths[k] as Map<string, number>) {
          if (count > topCount) {
            topCount = count;
            topDeath = reason;
          }
        }
        const played = runs[k] as number;
        const won = wins[k] as number;
        const sample = times[k] as number[];
        return {
          skill,
          runs: played,
          wins: won,
          completion: played > 0 ? won / played : 0,
          medianTimeS: sample.length > 0 ? median(sample) : null,
          topDeath,
        };
      }),
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
): GateResult[] {
  const gates: GateResult[] = [];
  const midSkill = GATE_SKILLS[MID] as number;

  gates.push(
    hard(
      validationFailures.length === 0,
      validationFailures.length === 0
        ? `all ${SIDE_LEVEL_KNOBS.length} levels validated across every seed (reachability proof holds)`
        : `${validationFailures.length} level(s) failed their own reachability proof, first: ${validationFailures[0]}`,
    ),
  );

  const relaxedTotal = reports.reduce((sum, report) => sum + report.relaxed, 0);
  gates.push(
    soft(
      relaxedTotal === 0,
      `${relaxedTotal} level(s) needed the relaxed knob fallback (the shipped ladder should place directly)`,
    ),
  );

  const early = reports.filter((report) => report.level <= 3);
  const earlyWorst = early.reduce(
    (worst, report) => (midSample(report).completion < midSample(worst).completion ? report : worst),
    early[0] ?? reports[0]!,
  );
  gates.push(
    hard(
      midSample(earlyWorst).completion >= 0.7,
      `L1-3 completion at skill ${midSkill}: worst is L${earlyWorst.level} at ` +
        `${pct(midSample(earlyWorst).completion)} (must be >= 70%)`,
    ),
  );

  const finale = reports[reports.length - 1]!;
  gates.push(
    hard(
      midSample(finale).completion >= 0.25,
      `L${finale.level} completion at skill ${midSkill}: ${pct(midSample(finale).completion)} (must be >= 25%)`,
    ),
  );

  // Perfect play must clear everything. This is the gate that actually proves
  // the hazard-aware hop planner: an unfair level is one where a player who
  // lands exactly where the planner told them to still has no legal jump left.
  const unfair = reports.filter((report) => report.flawlessWins < report.flawlessRuns);
  gates.push(
    hard(
      unfair.length === 0,
      unfair.length === 0
        ? `zero-jitter play clears all ${reports.length} levels on every seed (no unfair level)`
        : `unfair level(s): ${unfair
            .map((report) => `L${report.level} ${report.flawlessRuns - report.flawlessWins}x, first ${report.unfairSeed}`)
            .join('; ')}`,
    ),
  );

  // EXECUTION MUST PAY. Read on the last three levels, where the gaps are
  // tight enough for timing to decide the run: if a 9ms-SD expert clears them
  // no more often than a 68ms-SD novice, the ladder's late difficulty is
  // coming from generator variance rather than from anything the player does,
  // and no amount of practice would make it feel fairer. Hard, because that is
  // a broken platformer, not a tuning preference.
  const late = reports.filter((report) => report.level >= reports.length - 2);
  const laneMean = (subset: readonly LevelReport[], k: number): number =>
    subset.reduce((sum, report) => sum + (report.bySkill[k] as SkillSample).completion, 0) /
    Math.max(1, subset.length);
  const noviceLate = laneMean(late, 0);
  const expertLate = laneMean(late, GATE_SKILLS.length - 1);
  gates.push(
    hard(
      expertLate > noviceLate,
      `late-ladder completion spread: skill ${GATE_SKILLS[GATE_SKILLS.length - 1]} ${pct(expertLate)} vs ` +
        `skill ${GATE_SKILLS[0]} ${pct(noviceLate)} on L${reports.length - 2}-L${reports.length} ` +
        '(execution must beat flailing)',
    ),
  );

  // Difficulty trend, aggregated: single-level completion at 60 runs is too
  // noisy to gate on, but the ladder's two halves should still separate.
  const earlyMean = laneMean(early, MID);
  const lateMean = laneMean(late, MID);
  gates.push(
    soft(
      lateMean <= earlyMean,
      `difficulty trend: L1-3 mean ${pct(earlyMean)} vs last three ${pct(lateMean)} ` +
        '(the ladder should not get easier)',
    ),
  );

  // Completion time is dominated by the world length: 5600px at 260px/s is
  // ~21.5s of running, plus airtime and the door approach.
  const outOfBand = reports.filter((report) => {
    const timeS = midSample(report).medianTimeS;
    return timeS !== null && (timeS < 20 || timeS > 75);
  });
  gates.push(
    soft(
      outOfBand.length === 0,
      outOfBand.length === 0
        ? `median completion time per level within [20, 75]s (${reports
            .map((report) => midSample(report).medianTimeS?.toFixed(1) ?? 'n/a')
            .join(', ')})`
        : `level(s) outside the 20-75s completion band: ${outOfBand
            .map((report) => `L${report.level}=${midSample(report).medianTimeS?.toFixed(1)}s`)
            .join(', ')}`,
    ),
  );

  const noCoins = reports.filter((report) => report.coins < 8);
  gates.push(
    soft(
      noCoins.length === 0,
      noCoins.length === 0
        ? `every level pays 8-14 coins (mean ${reports.map((r) => num(r.coins, 1)).join(', ')})`
        : `level(s) under the 8-coin payout floor: ${noCoins.map((r) => `L${r.level}`).join(', ')}`,
    ),
  );

  return gates;
}

/**
 * Family entry point (see `src/sim/cli.ts`): returns the process exit code —
 * 0 when every hard gate passes, 1 otherwise.
 */
export default function runFamilySim(options: FamilySimOptions): number {
  const { reports, validationFailures } = buildReports(options);
  const gates = evaluateGates(reports, validationFailures);

  const render = (): void => {
    console.log('side (family C) — authored platformer levels');
    printTable(
      [
        'level',
        'plats',
        'spikes',
        'coins',
        'maxGap',
        'minWin',
        'runs',
        ...GATE_SKILLS.map((skill) => `c@${skill}`),
        'medianS',
        'topDeath',
        'genTries',
      ],
      reports.map((report) => [
        `L${report.level}`,
        num(report.platforms, 1),
        num(report.spikes, 1),
        num(report.coins, 1),
        String(report.maxGap),
        num(report.minWindow, 0),
        String(midSample(report).runs),
        ...report.bySkill.map((sample) => pct(sample.completion)),
        midSample(report).medianTimeS?.toFixed(1) ?? 'n/a',
        midSample(report).topDeath,
        num(report.attempts, 2),
      ]),
    );
    console.log(
      `\n${ATTEMPTS_PER_SEED} attempt(s) x ${options.runs} seed(s) per level per skill, seed '${options.seed}'; ` +
        `${VALIDATION_SEEDS}-seed analytic sweep on top.`,
    );
  };

  return finishFamily(options, gates, render, { family: 'side', reports, validationFailures });
}
