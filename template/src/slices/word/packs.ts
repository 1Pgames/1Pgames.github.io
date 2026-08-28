import type { LevelSpec } from '../../core/level';
import type { Rng } from '../../core/rng';
import { TRIVIA, type TriviaQuestion } from '../../data/trivia';
import { WORD_TUNING, type WordPack } from './tuning';

/**
 * The word slice's pack ladder: five levels over ONE question bank.
 *
 * A pack is not a bank, it is a difficulty WINDOW — `WORD_TUNING.packs[n].mix`
 * says what share of the drawn pool comes from tiers 1/2/3, so pack 1 is mostly
 * warm-up questions and pack 5 is mostly the closing tier, off the same 60
 * questions. That is a deliberate limitation of the TEMPLATE bank: a generated
 * game replaces `src/data/trivia.ts` wholesale with its own themed banks (see
 * that file's header), and the pack shape then becomes a per-bank draw instead
 * of a window over one.
 *
 * Pure TypeScript (no Phaser): the scene animates it, and a headless bot can
 * play a pack end to end.
 */

export const WORD_PACK_COUNT = WORD_TUNING.packs.length;

/** Namespaced `core/storage` key holding the next unplayed pack index. */
export const WORD_PROGRESS_KEY = 'word:pack';

/**
 * Index of the pack actually being played, written when it starts. RETRY hands
 * the scene nothing but the run seed, so this — not `WORD_PROGRESS_KEY`, which
 * a win already advanced — is what a replay reads.
 */
export const WORD_LAST_PACK_KEY = 'word:last';

/** Goal id tracked by the `LevelDirector`: correct answers. */
export const GOAL_ANSWERS = 'answers';

/** Clamps any stored/derived index into the ladder. */
export function clampPackIndex(index: number): number {
  return Math.max(0, Math.min(WORD_PACK_COUNT - 1, Math.floor(index)));
}

export function wordPack(index: number): WordPack {
  return WORD_TUNING.packs[clampPackIndex(index)] as WordPack;
}

/**
 * `LevelSpec` for pack `index`: 10 correct answers inside the pack's own clock,
 * rated by the clock LEFT on the win. `extraSeconds` is the `time-plus`
 * booster — a spec copy, so the authored pack data never changes.
 */
export function wordPackSpec(index: number, extraSeconds = 0): LevelSpec {
  const pack = wordPack(index);
  return {
    id: pack.id,
    goals: [{ id: GOAL_ANSWERS, target: WORD_TUNING.quizLength }],
    timeSeconds: pack.timeSeconds + extraSeconds,
    starBands: WORD_TUNING.starBands,
  };
}

/**
 * Seeded draw for pack `index`: `mix` decides the per-tier quota, each tier is
 * shuffled, and the result is returned in non-decreasing difficulty order so
 * every pack still opens with its easiest question. A tier that cannot fill its
 * quota spills into the next one (and finally backfills from whatever is left),
 * so a smaller bank degrades into a flatter ramp instead of a short pool.
 *
 * The correct answer is authored first in the bank; the option order is
 * permuted per draw here, exactly like `data/trivia.ts`'s own `drawQuiz`, so
 * position is never a tell.
 */
export function drawPack(rng: Rng, index: number): TriviaQuestion[] {
  const pack = wordPack(index);
  const wanted = Math.max(0, Math.min(pack.poolSize, TRIVIA.length));
  const tiers = [1, 2, 3].map((tier) => rng.shuffle(TRIVIA.filter((question) => question.difficulty === tier)));

  const quota = [
    Math.round(wanted * (pack.mix[0] ?? 0)),
    Math.round(wanted * (pack.mix[1] ?? 0)),
    0,
  ];
  // The last tier absorbs the rounding, so the quotas always sum to `wanted`.
  quota[2] = wanted - (quota[0] as number) - (quota[1] as number);

  const drawn: TriviaQuestion[] = [];
  let carry = 0;
  for (let tier = 0; tier < tiers.length; tier += 1) {
    const pool = tiers[tier] ?? [];
    const target = Math.max(0, (quota[tier] ?? 0) + carry);
    const take = Math.min(target, pool.length);
    carry = target - take;
    for (let i = 0; i < take; i += 1) drawn.push(pool[i] as TriviaQuestion);
    tiers[tier] = pool.slice(take);
  }
  // A quota that could not be met anywhere above leaves a shortfall; fill it
  // from whatever is left rather than handing back a pool with no reserve.
  if (drawn.length < wanted) {
    for (const pool of tiers) {
      for (const question of pool) {
        if (drawn.length >= wanted) break;
        drawn.push(question);
      }
    }
  }

  // Stable sort: the shuffle inside each tier survives, the ramp is guaranteed.
  drawn.sort((a, b) => a.difficulty - b.difficulty);
  return drawn.map((question) => {
    const answer = question.options[question.answerIndex] ?? '';
    const options = rng.shuffle([...question.options]);
    return { ...question, options, answerIndex: options.indexOf(answer) };
  });
}
