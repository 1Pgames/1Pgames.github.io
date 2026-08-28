import type { ArtSlot } from '../../data/art';
import type { TriviaCategory } from '../../data/trivia';

/**
 * One quiz pack: a difficulty WINDOW over the shared question bank, plus the
 * budget that window is playable with. `mix` is the share of the drawn pool
 * taken from tiers 1/2/3 and must sum to 1; the later packs lean on tier 3,
 * which costs both accuracy and reading time, so they buy back clock and
 * reserve questions to stay winnable.
 */
export interface WordPack {
  /** Level id: the saga-map node id and the `recordStars` key. Stable forever. */
  id: string;
  label: string;
  mix: readonly [number, number, number];
  /** Time budget for this pack. */
  timeSeconds: number;
  /** Questions drawn; everything past `quizLength` is the wrong-answer reserve. */
  poolSize: number;
}

/**
 * Slice-local balance for family H (trivia quiz). Global `TUNING` in
 * `src/config.ts` belongs to the arena reference slice; every number this
 * family talks about lives here.
 */
export const WORD_TUNING = {
  /** Correct answers needed to win. */
  quizLength: 10,
  /**
   * Baseline pool and clock — pack 3's numbers, and the shape the family sim
   * gates. The extra 6 questions are the reserve a wrong answer eats: the goal
   * stays 10 CORRECT, so without a reserve one slip would make a pack
   * unwinnable. Per-pack overrides live in `packs` below.
   */
  poolSize: 16,
  /** Time budget for the whole quiz. */
  timeSeconds: 90,
  /** A wrong answer burns this much of the clock (charged to the timer). */
  wrongPenaltySeconds: 6,

  /**
   * The five packs, easiest first. They draw from the SAME bank through a
   * difficulty window rather than from five separate banks (see the header of
   * `data/trivia.ts`): a generated game replaces that file wholesale, and
   * per-pack banks are its job, not this ladder's.
   */
  packs: [
    { id: 'word-01', label: 'WARM UP', mix: [0.75, 0.25, 0], timeSeconds: 90, poolSize: 16 },
    { id: 'word-02', label: 'STEADY', mix: [0.55, 0.35, 0.1], timeSeconds: 95, poolSize: 16 },
    { id: 'word-03', label: 'MIXED', mix: [0.4, 0.3, 0.3], timeSeconds: 100, poolSize: 17 },
    { id: 'word-04', label: 'SHARP', mix: [0.25, 0.35, 0.4], timeSeconds: 108, poolSize: 18 },
    { id: 'word-05', label: 'EXPERT', mix: [0.1, 0.25, 0.65], timeSeconds: 120, poolSize: 20 },
  ] as readonly WordPack[],

  /**
   * Star bands as the share of the pack's clock LEFT on the win. Finishing
   * with a third of the budget in hand is a three-star run; scraping in on the
   * last seconds still clears it for one.
   */
  starBands: [0, 0.12, 0.3] as readonly [number, number, number],

  /** Pre-pack boosters (ids are the word catalog's `boosterId`s). */
  boosters: {
    /** `time-plus`: seconds added to the pack's budget, once per pack. */
    timePlusSeconds: 20,
    /** `fifty-fifty`: wrong options greyed out, one question per armed use. */
    fiftyFiftyRemoves: 2,
    /** Boosters armable at once in the picker. */
    maxPick: 2,
  },

  score: {
    /** Base score per correct answer, multiplied by the question's difficulty. */
    perDifficulty: 100,
    /** Answers in a row before the streak starts paying. */
    streakThreshold: 3,
    /** Bonus per streak step once the threshold is reached. */
    streakBonus: 40,
  },
  /** Score per 1 meta currency on the results screen. */
  scorePerCurrency: 50,

  /** Beat between a correct answer and the next question. */
  advanceMs: 420,
  /** How long the correct option stays highlighted after a wrong answer. */
  revealMs: 950,

  layout: {
    panelY: 380,
    panelWidth: 640,
    panelHeight: 260,
    optionTop: 660,
    optionGap: 116,
    optionWidth: 620,
    optionHeight: 104,
    /** Category glyph next to the tier label on the question panel. */
    categoryIconSize: 40,
  },

  /**
   * Generated-art slots. A quiz is chrome (`ui/primitives.ts`) plus type, so
   * the only art this family wants is one glyph per question category — a frame
   * of the shared `ui` icon sheet. `null` draws no glyph at all rather than a
   * placeholder shape, because a wrong icon reads worse than none.
   */
  art: {
    categories: {
      science: null,
      geography: null,
      wordplay: null,
      logic: null,
    } as Record<TriviaCategory, ArtSlot | null>,
  },
} as const;
