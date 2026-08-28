import { LevelDirector } from '../../core/level';
import { Rng } from '../../core/rng';
import { TRIVIA } from '../../data/trivia';
import type { TriviaQuestion } from '../../data/trivia';
import { WORD_TUNING } from '../../slices/word/tuning';
import { GOAL_ANSWERS, WORD_PACK_COUNT, drawPack, wordPackSpec } from '../../slices/word/packs';
import { finishFamily, hard, median, num, pct, printTable, soft } from './types';
import type { FamilySimOptions, GateResult } from './types';

/**
 * Family H (trivia quiz) gate. Run: `npm run sim -- --family word`.
 *
 * WHAT IT GATES:
 *  - BANK INTEGRITY, re-checked at sim time and not only in the selftest:
 *    unique ids, exactly four distinct options, an in-range `answerIndex`, and
 *    a tier spread wide enough for `drawQuiz`'s 40/30/30 ramp. A bank edit that
 *    breaks these turns the level unwinnable, so it fails the sim too.
 *  - WINNABLE: a 0.9-accuracy player clears 10/10 inside the 90s clock in at
 *    least 90% of seeds — the reserve of 6 spare questions has to actually
 *    absorb the wrong answers it was sized for.
 *  - LOSABLE: a 0.35-accuracy player fails at least half the time.
 *
 * HOW IT PLAYS — the loop `slices/word/game.ts` runs: one `LevelDirector` with
 * a 10-correct goal and a 90s budget, questions from `drawQuiz` in ramp order,
 * `recordProgress` on a correct answer and `update(wrongPenaltySeconds)` on a
 * wrong one, a loss when the drawn pool runs out.
 *
 * THE BOT: a per-question coin flip weighted by tier — `p(correct) = base *
 * (1 - (difficulty - 1) * TIER_PENALTY)`, so the closing tier-3 stretch costs
 * an accuracy bot real answers instead of being free. Deliberation time is
 * modelled too, because the clock is a real budget: reading a <=90 character
 * prompt plus four options is `READ_BASE_MS + READ_PER_TIER_MS` per tier, on
 * top of the scene's own `advanceMs`/`revealMs` beats.
 *
 * Deterministic given `--seed`.
 */

/** Accuracy bands: a guesser, a decent player, an expert. */
const ACCURACY_LEVELS: readonly number[] = [0.35, 0.65, 0.9];
/** Accuracy lost per difficulty tier above 1. */
const TIER_PENALTY = 0.12;
/** Deliberation before answering: base plus this much per tier above 1. */
const READ_BASE_MS = 2600;
const READ_PER_TIER_MS = 700;

const EXPERT_WIN_FLOOR = 0.9;
/** The mid band must win more than this and lose more than this. */
const MID_WIN_FLOOR = 0.2;
const GUESSER_LOSS_FLOOR = 0.5;

interface RunResult {
  won: boolean;
  reason: string;
  correct: number;
  answered: number;
  /** Seconds of the pack's budget spent, penalties included. */
  spentS: number;
  /** Pack index this run played (see `slices/word/packs.ts`). */
  pack: number;
}

/**
 * One run of pack `pack`. The draw and the spec come from the slice's own
 * `packs.ts`, so the gate measures the ladder the game actually ships rather
 * than a bank-wide draw nothing plays.
 */
function playRun(accuracy: number, pack: number, seed: string): RunResult {
  const rng = new Rng(seed);
  const quiz: readonly TriviaQuestion[] = drawPack(new Rng(`${seed}:draw`), pack);
  const spec = wordPackSpec(pack);
  const level = new LevelDirector(spec);
  const budgetS = spec.timeSeconds ?? WORD_TUNING.timeSeconds;

  let correct = 0;
  let answered = 0;
  for (const question of quiz) {
    if (level.ended) break;
    // Reading and deciding is charged to the clock before the answer lands.
    level.update(READ_BASE_MS + (question.difficulty - 1) * READ_PER_TIER_MS);
    if (level.ended) break;

    const chance = Math.max(0.02, accuracy * (1 - (question.difficulty - 1) * TIER_PENALTY));
    answered += 1;
    if (rng.chance(chance)) {
      correct += 1;
      // Progress before the beat: the tenth correct answer must win instantly.
      level.recordProgress(GOAL_ANSWERS, 1);
      level.update(WORD_TUNING.advanceMs);
    } else {
      level.update(WORD_TUNING.revealMs + WORD_TUNING.wrongPenaltySeconds * 1000);
    }
  }
  // Pool exhausted with the goal unmet is the slice's `out-of-questions` loss.
  if (!level.ended) level.fail('out-of-questions');

  const outcome = level.outcome;
  return {
    won: outcome?.won === true,
    reason: outcome?.reason ?? 'unresolved',
    correct,
    answered,
    spentS: budgetS - (level.timeLeftSeconds ?? 0),
    pack,
  };
}

/** The bank invariants the level's winnability rests on; same checks as the selftest. */
function bankFaults(): string[] {
  const faults: string[] = [];
  const ids = new Set<string>();
  const perTier: Record<string, number> = { '1': 0, '2': 0, '3': 0 };
  for (const question of TRIVIA) {
    if (ids.has(question.id)) faults.push(`duplicate id ${question.id}`);
    ids.add(question.id);
    if (question.options.length !== 4) faults.push(`${question.id}: ${question.options.length} options`);
    if (new Set(question.options).size !== question.options.length) faults.push(`${question.id}: repeated option`);
    if (
      !Number.isInteger(question.answerIndex) ||
      question.answerIndex < 0 ||
      question.answerIndex >= question.options.length
    ) {
      faults.push(`${question.id}: answerIndex ${question.answerIndex} out of range`);
    }
    perTier[`${question.difficulty}`] = (perTier[`${question.difficulty}`] ?? 0) + 1;
  }
  if (TRIVIA.length < WORD_TUNING.poolSize) {
    faults.push(`bank of ${TRIVIA.length} cannot fill a ${WORD_TUNING.poolSize}-question pool`);
  }
  // `drawQuiz` asks each tier for ~40/30/30 of the pool; a starved tier
  // silently backfills and the authored ramp disappears.
  for (const tier of ['1', '2', '3']) {
    if ((perTier[tier] ?? 0) < Math.ceil(WORD_TUNING.poolSize * 0.4)) {
      faults.push(`tier ${tier} has ${perTier[tier] ?? 0} questions, below the draw quota`);
    }
  }
  return faults;
}

export default function runFamilySim(options: FamilySimOptions): number {
  const runs = Math.max(1, Math.floor(options.runs)) * 5;
  const bands = ACCURACY_LEVELS.map((accuracy) => {
    const results: RunResult[] = [];
    for (let run = 0; run < runs; run += 1) {
      // Runs are dealt round-robin across the pack ladder, so one band covers
      // every difficulty window at the same total run count.
      const pack = run % WORD_PACK_COUNT;
      results.push(playRun(accuracy, pack, `${options.seed}:word:${accuracy}:${run}`));
    }
    return { accuracy, results };
  });

  const winrate = (accuracy: number): number => {
    const band = bands.find((entry) => entry.accuracy === accuracy)?.results ?? [];
    return band.length === 0 ? Number.NaN : band.filter((result) => result.won).length / band.length;
  };

  const gates: GateResult[] = [];
  const faults = bankFaults();
  gates.push(
    hard(
      faults.length === 0,
      faults.length === 0
        ? `bank integrity: ${TRIVIA.length} questions, unique ids, 4 distinct options, answer in range`
        : `bank integrity broken: ${faults.slice(0, 4).join('; ')}`,
    ),
  );

  const expert = winrate(0.9);
  gates.push(
    hard(
      expert >= EXPERT_WIN_FLOOR,
      `0.90-accuracy bot clears ${WORD_TUNING.quizLength}/${WORD_TUNING.quizLength} in ${pct(expert, 1)} of ` +
        `seeds (must be >= ${pct(EXPERT_WIN_FLOOR)})`,
    ),
  );

  const guesser = winrate(0.35);
  gates.push(
    soft(
      1 - guesser >= GUESSER_LOSS_FLOOR,
      `0.35-accuracy bot loses ${pct(1 - guesser, 1)} of seeds (must be >= ${pct(GUESSER_LOSS_FLOOR)}, ` +
        'else the level cannot be lost)',
    ),
  );

  // The middle of the curve is where the level is actually played: a 0.65 bot
  // must be able to both win and lose, otherwise the 90s clock and the -6s
  // miss penalty are doing all the deciding instead of the answers.
  const mid = winrate(0.65);
  const midTimeouts = (bands[1]?.results ?? []).filter((result) => result.reason === 'out-of-time').length;
  gates.push(
    soft(
      mid > MID_WIN_FLOOR && mid < 1 - MID_WIN_FLOOR,
      `0.65-accuracy bot wins ${pct(mid, 1)} of seeds (contest band ` +
        `${pct(MID_WIN_FLOOR)}-${pct(1 - MID_WIN_FLOOR)}; ${midTimeouts}/${bands[1]?.results.length ?? 0} of its ` +
        'runs ended on the clock rather than the question pool)',
    ),
  );

  // Per-pack readout. The win-rate floors above are measured across the whole
  // ladder; this is what says WHICH window is out of line.
  const packWinrate = (accuracy: number, pack: number): number => {
    const band = bands.find((entry) => entry.accuracy === accuracy)?.results ?? [];
    const subset = band.filter((result) => result.pack === pack);
    return subset.length === 0 ? Number.NaN : subset.filter((result) => result.won).length / subset.length;
  };

  // Ladder SHAPE is gated on the authored data, not on per-pack win rates: at
  // 20 runs a pack a single unlucky seed moves a rate by 5 points, so a
  // win-rate comparison between neighbouring packs would flip run to run. The
  // tier-3 share is the difficulty the packs actually author, and it must never
  // fall as the ladder climbs.
  const hardShare = WORD_TUNING.packs.map((pack) => pack.mix[2] ?? 0);
  let inversion = -1;
  for (let index = 1; index < hardShare.length; index += 1) {
    if ((hardShare[index] as number) < (hardShare[index - 1] as number)) inversion = index;
  }
  gates.push(
    soft(
      inversion < 0,
      `tier-3 share per pack = [${hardShare.map((share) => `${Math.round(share * 100)}%`).join(', ')}]` +
        (inversion < 0
          ? ' (the authored difficulty climbs)'
          : ` — pack ${inversion + 1} is easier than pack ${inversion}`),
    ),
  );

  const render = (): void => {
    printTable(
      ['accuracy', 'runs', 'win rate', 'correct', 'answered', 'clock s', 'top loss'],
      bands.map((entry) => {
        const losses = entry.results.filter((result) => !result.won);
        const reasons = new Set(losses.map((result) => result.reason));
        return [
          entry.accuracy.toFixed(2),
          String(entry.results.length),
          pct(entry.results.filter((result) => result.won).length / entry.results.length, 1),
          num(median(entry.results.map((result) => result.correct)), 1),
          num(median(entry.results.map((result) => result.answered)), 1),
          num(median(entry.results.map((result) => result.spentS)), 1),
          losses.length === 0 ? '-' : [...reasons].join('/'),
        ];
      }),
    );
    printTable(
      ['pack', 'mix 1/2/3', 'clock s', 'pool', '0.35 WR', '0.65 WR', '0.90 WR'],
      WORD_TUNING.packs.map((pack, index) => [
        pack.label,
        pack.mix.map((share) => `${Math.round(share * 100)}`).join('/'),
        `${pack.timeSeconds}`,
        `${pack.poolSize}`,
        pct(packWinrate(0.35, index), 0),
        pct(packWinrate(0.65, index), 0),
        pct(packWinrate(0.9, index), 0),
      ]),
    );
    console.log(
      `\n${runs} seed(s) per accuracy band (round-robin over ${WORD_PACK_COUNT} packs), ` +
        `seed '${options.seed}'; goal ${WORD_TUNING.quizLength} correct, ` +
        `-${WORD_TUNING.wrongPenaltySeconds}s per miss, ${TRIVIA.length} questions in the shared bank.`,
    );
  };

  return finishFamily(options, gates, render, {
    family: 'word',
    runs,
    bankFaults: faults,
    bands: bands.map((entry) => ({
      accuracy: entry.accuracy,
      winrate: entry.results.filter((result) => result.won).length / entry.results.length,
      medianCorrect: median(entry.results.map((result) => result.correct)),
      medianClockS: median(entry.results.map((result) => result.spentS)),
    })),
  });
}
