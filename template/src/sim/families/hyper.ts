import { VIEW } from '../../config';
import { RampDirector } from '../../core/ramp';
import { Rng } from '../../core/rng';
import { createTower, placeSlab, slabSpeed, travelBounds } from '../../slices/hyper/stack';
import { HYPER_TUNING } from '../../slices/hyper/tuning';
import { finishFamily, hard, median, num, pct, printTable, soft } from './types';
import type { FamilySimOptions, GateResult } from './types';

/**
 * Family J (hypercasual tap-timing) ramp gate. Run: `npm run sim -- --family hyper`.
 *
 * WHAT IT GATES — that the stack-tower ramp produces a session worth retrying:
 *  - SESSION LENGTH: a median-skill player's run lasts 30-120s (a run shorter
 *    than that is a coin flip, longer than that stops being instant-retry),
 *  - SKILL MATTERS: the expert's median run outlasts the novice's,
 *  - the ramp actually ramps: difficulty at death climbs with skill,
 *  - the perfect-drop reward is reachable but not free (15-60% at expert).
 *
 * HOW IT PLAYS — the exact geometry `slices/hyper/game.ts` runs: `slabSpeed`
 * off `RampDirector.difficulty`, `travelBounds` for the current tower width,
 * `placeSlab` for the drop, `RampDirector.addScore` for the score that feeds
 * the ramp back into the speed.
 *
 * TWO MODELLING CHOICES, both deliberate:
 *
 * 1. TIMING ERROR IS TIME, NOT PIXELS. A player mistimes a tap by
 *    milliseconds; the pixel error is that latency multiplied by the CURRENT
 *    slab speed. Modelling the error directly in pixels would make the speed
 *    ramp free — the bot would be exactly as accurate at difficulty 3.5 as at
 *    1.0, and this file exists to gate that ramp. `sigmaMs` therefore spans a
 *    ~200ms novice to a ~25ms expert, which at the tuned 260px/s base speed is
 *    ~52px vs ~6px of drift.
 *
 * 2. SESSION SECONDS COME FROM THE SLAB'S TRAVEL, NOT A GUESSED CADENCE.
 *    `armMover` re-spawns the slab at the screen edge on the side the last drop
 *     landed, so the time cost of a drop is `|dropX - spawnEdgeX| / speed` —
 *    one traversal from the edge to the drop point. The bot drops on that FIRST
 *    approach, which makes every session time here a LOWER BOUND: a human who
 *    lets the slab swing past once pays another `2 * span / speed` per drop.
 *
 * Deterministic given `--seed`.
 */

/** Timing jitter (1 sigma, ms) at skill 0 and the floor an expert keeps. */
const SIGMA_MS_NOVICE = 200;
const SIGMA_MS_EXPERT = 25;
/** Skill spread the gates read — novice, median, expert (same as the arena CLI). */
const SKILL_LEVELS: readonly number[] = [0.1, 0.5, 0.9];
/** Safety valve: a run this long is a pass by any reading of the gate. */
const MAX_DROPS = 4000;

/**
 * Session-length band at median skill, HARD.
 *
 * `SESSION_TARGET_S` is the design target: a hypercasual sitting is one deep
 * breath, and the whole meta (skins on score milestones, the pre-run picker,
 * `meta_slow_start`) is priced against a player who takes ~30s a run and
 * retries instantly.
 *
 * The band brackets that target rather than merely bracketing the absurd. It
 * used to be [10, 120] with the 30s target parked in a separate SOFT gate,
 * which is the same thing as having no session-length bar at all: 10s is
 * fewer than ~20 drops, too short to even show a perfect drop (~1 in 5 at
 * median skill) before the retry transition costs more than the run, and 120s
 * is four times the target — a run that long is a different genre. So:
 *  - 25s floor: the target minus one bad early drop. Under it the loop is not
 *    "one more go", it is a coin-flip on the first three slabs.
 *  - 90s ceiling: three times the target. A median player routinely running
 *    that long means `difficultyPerStep`/`minWidth` never close the window,
 *    and the score chase has no pressure.
 * Asymmetric on purpose: overshooting the target is a slow-burn design smell,
 * undershooting it breaks the retry loop immediately.
 */
const MIN_SESSION_S = 25;
const MAX_SESSION_S = 90;
const SESSION_TARGET_S = 30;

interface RunResult {
  skill: number;
  sessionS: number;
  drops: number;
  perfects: number;
  /** `RampDirector.difficulty` at the moment the run ended. */
  difficultyAtDeath: number;
  failure: string;
}

/** Box-Muller normal; two uniforms per draw, so the seed stream stays simple. */
function gaussian(rng: Rng): number {
  const u = Math.max(1e-12, rng.next());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
}

function playRun(skill: number, seed: string): RunResult {
  const spec = HYPER_TUNING.stack;
  const rng = new Rng(seed);
  const tower = createTower(spec, VIEW.centerX);
  const director = new RampDirector(HYPER_TUNING.ramp);
  const sigmaMs = SIGMA_MS_EXPERT + (SIGMA_MS_NOVICE - SIGMA_MS_EXPERT) * (1 - skill);

  let sessionMs = 0;
  // The first slab is armed from the left, mirroring `armMover`'s spawn rule
  // for a tower still centred on screen.
  let spawnLeft = true;

  while (tower.alive && tower.height < MAX_DROPS) {
    const speed = slabSpeed(HYPER_TUNING.baseSpeed, HYPER_TUNING.speedPerDifficulty, director.difficulty);
    const bounds = travelBounds(tower.width, VIEW.width);
    const spawnX = spawnLeft ? bounds.minX : bounds.maxX;

    const errorPx = gaussian(rng) * (sigmaMs / 1000) * speed;
    const dropX = Math.min(bounds.maxX, Math.max(bounds.minX, tower.topX + errorPx));
    sessionMs += (Math.abs(dropX - spawnX) / speed) * 1000;
    director.update((Math.abs(dropX - spawnX) / speed) * 1000);
    spawnLeft = dropX <= VIEW.centerX;

    const result = placeSlab(tower, spec, dropX);
    if (!tower.alive) break;
    director.addScore(HYPER_TUNING.scorePerDrop + (result.perfect ? HYPER_TUNING.scorePerPerfect : 0));
  }

  return {
    skill,
    sessionS: sessionMs / 1000,
    drops: tower.height,
    perfects: tower.perfects,
    difficultyAtDeath: director.difficulty,
    failure: tower.failure === '' ? 'capped' : tower.failure,
  };
}

export default function runFamilySim(options: FamilySimOptions): number {
  const runs = Math.max(1, Math.floor(options.runs));
  const bySkill = SKILL_LEVELS.map((skill) => {
    const results: RunResult[] = [];
    for (let run = 0; run < runs; run += 1) {
      results.push(playRun(skill, `${options.seed}:hyper:${skill}:${run}`));
    }
    return { skill, results };
  });

  const medianSession = (skill: number): number =>
    median((bySkill.find((entry) => entry.skill === skill)?.results ?? []).map((r) => r.sessionS));
  const perfectRate = (results: readonly RunResult[]): number => {
    const drops = results.reduce((sum, r) => sum + r.drops, 0);
    return drops === 0 ? Number.NaN : results.reduce((sum, r) => sum + r.perfects, 0) / drops;
  };

  const gates: GateResult[] = [];

  const midSession = medianSession(0.5);
  gates.push(
    hard(
      midSession >= MIN_SESSION_S && midSession <= MAX_SESSION_S,
      `median session at skill 0.5 = ${num(midSession, 1)}s ` +
        `(must be within [${MIN_SESSION_S}, ${MAX_SESSION_S}] around the ${SESSION_TARGET_S}s design target)`,
    ),
  );

  const expertSession = medianSession(0.9);
  const noviceSession = medianSession(0.1);
  gates.push(
    hard(
      expertSession > noviceSession,
      `median session skill 0.9 = ${num(expertSession, 1)}s vs skill 0.1 = ${num(noviceSession, 1)}s ` +
        '(skill must buy time)',
    ),
  );

  const difficulties = bySkill.map((entry) => median(entry.results.map((r) => r.difficultyAtDeath)));
  let monotone = true;
  for (let i = 1; i < difficulties.length; i += 1) {
    if ((difficulties[i] as number) < (difficulties[i - 1] as number) - 1e-9) monotone = false;
  }
  gates.push(
    soft(
      monotone,
      `difficulty at death by skill = [${difficulties.map((value) => num(value)).join(', ')}] ` +
        '(must not fall as skill rises)',
    ),
  );

  const expertPerfect = perfectRate(bySkill[bySkill.length - 1]?.results ?? []);
  gates.push(
    soft(
      expertPerfect >= 0.15 && expertPerfect <= 0.6,
      `perfect-drop rate at skill 0.9 = ${pct(expertPerfect, 1)} (target 15-60%)`,
    ),
  );

  // The ramp's own ceiling has to be reachable, or `maxDifficulty` and
  // `difficultyPerStep` are dead numbers nobody ever plays against.
  const rampCeiling = HYPER_TUNING.ramp.maxDifficulty ?? Number.POSITIVE_INFINITY;
  const rampHorizon = 1 + (rampCeiling - 1) / 2;
  const expertDifficulty = median(bySkill[bySkill.length - 1]?.results.map((r) => r.difficultyAtDeath) ?? []);
  gates.push(
    hard(
      expertDifficulty >= rampHorizon,
      `difficulty reached at skill 0.9 = ${num(expertDifficulty)} of a ${num(rampCeiling)} ceiling ` +
        `(must pass ${num(rampHorizon)}, else the ramp is unreachable)`,
    ),
  );

  const render = (): void => {
    printTable(
      ['skill', 'runs', 'session s', 'height', 'perfect%', 'difficulty', 'top failure'],
      bySkill.map((entry) => {
        const misses = entry.results.filter((r) => r.failure === 'missed').length;
        return [
          entry.skill.toFixed(1),
          String(entry.results.length),
          num(median(entry.results.map((r) => r.sessionS)), 1),
          num(median(entry.results.map((r) => r.drops)), 1),
          pct(perfectRate(entry.results), 1),
          num(median(entry.results.map((r) => r.difficultyAtDeath))),
          misses * 2 >= entry.results.length ? 'missed' : 'toppled',
        ];
      }),
    );
    console.log(
      `\n${runs} run(s) per skill, seed '${options.seed}'; timing jitter ` +
        `${SIGMA_MS_EXPERT}-${SIGMA_MS_NOVICE}ms of slab travel (see the header note).`,
    );
  };

  return finishFamily(options, gates, render, {
    family: 'hyper',
    runs,
    skills: bySkill.map((entry) => ({
      skill: entry.skill,
      medianSessionS: median(entry.results.map((r) => r.sessionS)),
      medianDrops: median(entry.results.map((r) => r.drops)),
      perfectRate: perfectRate(entry.results),
      medianDifficultyAtDeath: median(entry.results.map((r) => r.difficultyAtDeath)),
    })),
  });
}
