// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/trivia.selftest.ts
import assert from 'node:assert/strict';
import { Rng } from '../../core/rng';
import { TRIVIA, drawQuiz } from '../../data/trivia';
import type { TriviaCategory } from '../../data/trivia';
import { WORD_TUNING } from '../../slices/word/tuning';

const CATEGORIES: readonly TriviaCategory[] = ['science', 'geography', 'wordplay', 'logic'];
const ID_PREFIX: Record<string, string> = {
  science: 'sci',
  geography: 'geo',
  wordplay: 'wrd',
  logic: 'log',
};

// --- bank integrity: size, unique ids, 4 distinct options, answer in range ---
{
  assert.ok(TRIVIA.length >= 60, `the bank needs 60+ questions, has ${TRIVIA.length}`);

  const ids = new Set<string>();
  const prompts = new Set<string>();
  const perCategory: Record<string, number> = { science: 0, geography: 0, wordplay: 0, logic: 0 };
  const perDifficulty: Record<string, number> = { '1': 0, '2': 0, '3': 0 };

  for (const q of TRIVIA) {
    assert.ok(!ids.has(q.id), `duplicate question id: ${q.id}`);
    ids.add(q.id);

    assert.ok(!prompts.has(q.question), `duplicate prompt: ${q.question}`);
    prompts.add(q.question);

    assert.ok(q.question.length > 0 && q.question.length <= 90, `${q.id}: prompt must be 1-90 chars, is ${q.question.length}`);
    assert.equal(q.options.length, 4, `${q.id}: exactly 4 options`);
    assert.equal(new Set(q.options).size, 4, `${q.id}: options must all differ`);
    for (const option of q.options) {
      assert.ok(option.trim().length > 0, `${q.id}: no blank options`);
    }
    assert.ok(
      Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < q.options.length,
      `${q.id}: answerIndex ${q.answerIndex} out of range`,
    );
    assert.ok(
      q.difficulty === 1 || q.difficulty === 2 || q.difficulty === 3,
      `${q.id}: difficulty must be 1-3`,
    );
    assert.ok(CATEGORIES.includes(q.category), `${q.id}: unknown category ${q.category}`);
    assert.equal(q.id.slice(0, 3), ID_PREFIX[q.category], `${q.id}: id prefix must match its category`);

    perCategory[q.category] = (perCategory[q.category] ?? 0) + 1;
    perDifficulty[`${q.difficulty}`] = (perDifficulty[`${q.difficulty}`] ?? 0) + 1;
  }

  for (const category of CATEGORIES) {
    assert.ok((perCategory[category] ?? 0) >= 15, `${category}: needs 15+ questions, has ${perCategory[category]}`);
  }
  for (const tier of ['1', '2', '3']) {
    assert.ok((perDifficulty[tier] ?? 0) >= 15, `difficulty ${tier}: needs 15+ questions, has ${perDifficulty[tier]}`);
  }
}

// --- seeded draw: deterministic, ramped, no repeats, option order permuted ---
{
  const size = WORD_TUNING.poolSize;
  const a = drawQuiz(new Rng('quiz'), size);
  const b = drawQuiz(new Rng('quiz'), size);
  assert.deepEqual(a, b, 'the same seed draws the same quiz, options included');

  const other = drawQuiz(new Rng('quiz-2'), size);
  assert.notDeepEqual(
    a.map((q) => q.id),
    other.map((q) => q.id),
    'a different seed draws a different quiz',
  );

  for (const seed of ['ramp-1', 'ramp-2', 'ramp-3', 'ramp-4', 'ramp-5']) {
    const quiz = drawQuiz(new Rng(seed), size);
    assert.equal(quiz.length, size, 'the draw returns exactly what was asked for');
    assert.equal(new Set(quiz.map((q) => q.id)).size, size, 'no question is drawn twice');

    let previous = 0;
    for (const q of quiz) {
      assert.ok(q.difficulty >= previous, `seed ${seed}: difficulty must never step back`);
      previous = q.difficulty;
    }
    assert.equal(quiz[0]?.difficulty, 1, `seed ${seed}: a quiz opens on tier 1`);
    assert.equal(quiz[quiz.length - 1]?.difficulty, 3, `seed ${seed}: a quiz closes on tier 3`);

    // The permutation must keep the authored answer, not just an index.
    for (const q of quiz) {
      const source = TRIVIA.find((row) => row.id === q.id);
      assert.ok(source !== undefined, `${q.id}: drawn question must exist in the bank`);
      assert.equal(
        q.options[q.answerIndex],
        source.options[source.answerIndex],
        `${q.id}: the shuffled options must still point at the right answer`,
      );
      assert.deepEqual([...q.options].sort(), [...source.options].sort(), `${q.id}: same option set`);
    }
  }

  // Over many draws the correct answer must land in every slot — otherwise the
  // player learns the position instead of the answer.
  const slots = [0, 0, 0, 0];
  for (let i = 0; i < 120; i += 1) {
    for (const q of drawQuiz(new Rng(`slots-${i}`), 10)) {
      slots[q.answerIndex] = (slots[q.answerIndex] ?? 0) + 1;
    }
  }
  for (let slot = 0; slot < 4; slot += 1) {
    assert.ok((slots[slot] ?? 0) > 120, `answers must reach slot ${slot}, saw ${slots[slot]}`);
  }
}

// --- the draw covers the quiz length plus its reserve, and clamps at the bank ---
{
  assert.ok(
    WORD_TUNING.poolSize >= WORD_TUNING.quizLength,
    'the pool must cover the goal, plus a reserve for wrong answers',
  );
  assert.equal(drawQuiz(new Rng('clamp'), TRIVIA.length + 25).length, TRIVIA.length, 'the draw clamps to the bank');
  assert.equal(drawQuiz(new Rng('empty'), 0).length, 0);
}

console.log('trivia.selftest: ok');
