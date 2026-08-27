/**
 * Slice-local balance for family H (trivia quiz). Global `TUNING` in
 * `src/config.ts` belongs to the arena reference slice; every number this
 * family talks about lives here.
 */
export const WORD_TUNING = {
  /** Correct answers needed to win. */
  quizLength: 10,
  /**
   * Questions actually drawn. The extra 6 are the reserve a wrong answer eats:
   * the goal stays 10 CORRECT, so without a reserve one slip would make the
   * level unwinnable.
   */
  poolSize: 16,
  /** Time budget for the whole quiz. */
  timeSeconds: 90,
  /** A wrong answer burns this much of the clock (charged to the timer). */
  wrongPenaltySeconds: 6,

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
  },
} as const;
