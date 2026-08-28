import { writeFileSync } from 'node:fs';

import { Board } from '../../core/board/grid';
import { mercyPool } from '../../core/board/mercy';
import { findValidMoves, hasDeadBoard, reshuffle, resolveCascades } from '../../core/board/resolve';
import type { Cell, Swap } from '../../core/board/types';
import { LevelDirector } from '../../core/level';
import { Rng } from '../../core/rng';
import { BOARD_LEVELS, boardSpecFor } from '../../slices/board/levels';
import { BOARD_TUNING } from '../../slices/board/tuning';
import { finishFamily, hard, mean, median, num, pct, percentile, printTable, soft } from './types';
import type { FamilySimOptions, GateResult } from './types';

/**
 * Family B (board puzzle) solver gate. Run: `npm run sim -- --family board`.
 *
 * WHAT IT GATES — that the shipped ladder (`slices/board/levels.ts`) delivers
 * the DIFFICULTY CURVE it claims to, measured against two bots that bracket a
 * human from both sides:
 *
 *  - the RANDOM bot is the weak-human FLOOR. It sees nothing and plans nothing,
 *    so its win rate is what the level gives away for free.
 *  - the GREEDY bot is the skilled-human CEILING. It scores every legal swap
 *    against the goals across the whole board, which no player does, so a level
 *    it loses is a level a human loses much more often.
 *
 * A single-bot gate cannot see difficulty at all: the round-1 ladder passed a
 * greedy-only gate with a twelve-move budget that no human could clear. So
 * every level is now checked against BOTH bounds of its authored tier, and the
 * tiers are the genre's own (Royal Match's attempt counts):
 *
 *  - TUTORIAL   greedy 100%,  random >= 85%  — nothing here can be lost.
 *  - NORMAL     greedy >= 95%, random 35-65% — ~1.2 attempts.
 *  - HARD       greedy >= 85%, random 12-35% — ~1.6 attempts.
 *  - FINALE     greedy >= 70%, random  5-20% — ~2.5 attempts (see TIER_BANDS
 *    for why the finale's window is the one that is 5 points wider).
 *
 * plus the three things a curve needs to be a curve and not a wall:
 *  - MOVES ARE NEVER THE DIFFICULTY: the budget stays inside its tier's band
 *    and never below 22, so a level can only be hard because of its layout.
 *  - THE FLOOR FALLS TIER BY TIER (per-level is not measurable — see
 *    TIER_DECLINE_MARGIN), and
 *  - A LOSS IS A NEAR MISS: the median losing run ends within 15% of the order,
 *    which is the difference between "one more go" and "this is rigged".
 *
 * HOW IT PLAYS — exactly the move pipeline `slices/board/game.ts` commits:
 * `board.swap` -> `director.useMove()` -> detonate any swapped special ->
 * `resolveCascades` -> `recordProgress` per cleared cell -> `settleMove()`,
 * with a `reshuffle` on a dead board and the MERCY POOL applied at the same
 * threshold the scene uses. The bots differ only in which of `findValidMoves`'
 * swaps they pick, so the win-rate gap between them is a pure measurement of
 * how much the level rewards reading the board.
 *
 * Neither bot ever touches an in-level booster: the ladder has to stand up
 * without them, and the boosters are what turn a bad board into a fair one.
 *
 * PERSONAS, TRACE AND FUN PROXIES — the two gated bots are two entries in
 * `BOT_POLICIES`, the persona registry. A third, `impatient`, ships beside
 * them as a MID-SKILL proxy (uniform among the top-3 scored swaps) and is
 * REPORT-ONLY: no gate names it, so it can be read, retuned or replaced
 * without moving a single threshold. The same run also measures the
 * REPORT-ONLY fun proxies — decision density, dead-turn ratio, cascade payoff
 * p50/p90, special and combo rates: the shape of the fun rather than the
 * shape of the difficulty, printed under the ladder table. `--trace <path>`
 * dumps every session's raw record (including the greedy solver's per-move
 * candidate counts and scores) for offline analysis; nothing extra is
 * collected when the flag is absent.
 *
 * Deterministic given `--seed`: the deal, the refills and the greedy solver's
 * lookahead each draw from their own named child seed.
 */

/** Extra score a greedy candidate earns per cascade beat past the first. */
const CASCADE_BONUS = 0.75;
/**
 * What a greedy candidate pays for blocker damage. Breaking a jar clears no
 * goal cell at all, so a solver scored purely on goals would step around the
 * obstacle layer and then lose to it — which would measure the SOLVER, not
 * the level. The values are deliberately below one goal cell: opening the
 * board is worth doing, never worth doing instead of the order.
 */
const BLOCKER_CRACK_BONUS = 0.4;
const BLOCKER_BREAK_BONUS = 1.1;

/**
 * How many of the top-scoring candidates the `impatient` persona is willing to
 * treat as interchangeable. 3 is the mid-skill proxy: it sees the good moves
 * but not which of them is best.
 */
const IMPATIENT_WIDTH = 3;

/**
 * DEAD-TURN LINE (report-only). A candidate scored at or below this cleared no
 * goal cell (1.0 each) and broke no blocker (1.1) — all it earned was cascade
 * filler. When the BEST candidate on the board is under the line, the turn had
 * nothing in it, which is what a player reads as a wasted move. Chip damage on
 * jars (0.4 a hit) can stack over the line, so the measured ratio is a floor
 * on wasted turns, not a census of them.
 */
const NO_PROGRESS_SCORE = CASCADE_BONUS;

/** The authored difficulty tier of a level, and what each tier promises. */
type Tier = 'tutorial' | 'normal' | 'hard' | 'finale';

interface TierBand {
  /** Skilled-human ceiling: the greedy solver must win at least this often. */
  greedyMin: number;
  /** Weak-human floor: the random bot's win rate must land in this window. */
  randomMin: number;
  randomMax: number;
  /** Move budget window. The floor is the promise that moves are never the wall. */
  movesMin: number;
  movesMax: number;
}

/**
 * The finale's floor window is 5-20%, not the 5-15% the other bands are drawn
 * from, and the reason is a MEASURED conflict with the near-miss law rather
 * than a concession.
 *
 * A losing run's median shortfall is fixed by one number: how wide the spread
 * of "goal cells collected in a full budget" is, relative to the order. Pushing
 * the random floor from 20% down to 10% means sizing the order at the 90th
 * percentile of that spread instead of the 80th, which moves the median LOSS
 * from ~13% short to ~18% short. On this mechanic the two laws cross between
 * 15% and 20%, and the near-miss law wins: a finale a weak player loses 4 times
 * in 5 but always loses by a few bottles is the level the playtest asked for,
 * and a finale they lose by a fifth of the order is the one they quit at.
 *
 * Measured with the four-chip order at 26 moves; a three-chip order and a
 * four-ingredient board were both tried and both spread WIDER, not tighter.
 */
const TIER_BANDS: Record<Tier, TierBand> = {
  tutorial: { greedyMin: 1, randomMin: 0.85, randomMax: 1, movesMin: 30, movesMax: 38 },
  normal: { greedyMin: 0.95, randomMin: 0.35, randomMax: 0.65, movesMin: 26, movesMax: 32 },
  hard: { greedyMin: 0.85, randomMin: 0.12, randomMax: 0.35, movesMin: 24, movesMax: 28 },
  finale: { greedyMin: 0.7, randomMin: 0.05, randomMax: 0.2, movesMin: 22, movesMax: 26 },
};

/**
 * Tier per ladder index. Authored here rather than derived from the index
 * because index 9 (`w-10`) is a deliberate BREATHER back down to normal, and a
 * gate that assumed a monotone climb would fail the one level whose job is to
 * interrupt it.
 */
const TIERS: readonly Tier[] = [
  'tutorial',
  'tutorial',
  'tutorial',
  'normal',
  'normal',
  'normal',
  'normal',
  'hard',
  'hard',
  'normal',
  'hard',
  'finale',
];

/**
 * Index of the breather (`w-10`). Excluded from the tier-mean decline check by
 * being tiered `normal` rather than by index; the constant is here so the
 * report can name it.
 */
const BREATHER_INDEX = 9;

/** No level, in any tier, may be authored below this. */
const ABSOLUTE_MOVE_FLOOR = 22;

/** Authored board-size envelope: small enough to read, never bigger than 8x8. */
const MIN_COLS = 6;
const MAX_COLS = 8;
const MIN_ROWS = 7;
const MAX_ROWS = 8;

/**
 * How far a losing run may end from the order, as a fraction of it. Above this
 * the level is not hard, it is mis-sized: the player never saw the win.
 */
const MAX_LOSS_SHORTFALL = 0.15;

/**
 * How far each tier's mean floor must sit below the tier above it. Tier means
 * pool 3-5 levels, so this is measured on 180-300 sessions per tier and is the
 * only decline statement this sim can actually make: a PER-LEVEL monotone
 * check is not measurable here, because changing `--seed` re-deals every board
 * and a single level's floor legitimately moves 15+ points between seeds. The
 * curve is a property of the ladder, not of any one rung.
 */
const TIER_DECLINE_MARGIN = 0.05;

/** Losing runs needed before a level's near-miss median means anything. */
const MIN_LOSS_SAMPLE = 5;

/**
 * 95% half-width of a win-rate estimate from `runs` samples, used as the gate's
 * tolerance on every band edge.
 *
 * Without it the gate is noisier than the thing it measures: at the shipped
 * `--runs 60` a level authored at a true 50% floor lands anywhere in 37-63% on
 * sampling alone, so a hard band edge at 65% would fail on some seeds and pass
 * on others and tell the author nothing either way. With it, a band edge means
 * "the measurement is INCONSISTENT with the tier", and raising `--runs`
 * tightens the gate instead of just re-rolling it — which is why the ladder is
 * confirmed at `--runs 240` and gated at 60.
 *
 * At a measured rate of 0 or 1 the half-width is 0, so "tutorials are a 100%
 * clear for the solver" stays an exact claim.
 */
function bandSlack(rate: number, runs: number): number {
  return 1.96 * Math.sqrt(Math.max(0, rate * (1 - rate)) / runs);
}

/**
 * What a persona sees on its turn. The object is REUSED for every turn of a
 * session, so a policy must read it and never retain it — `goals` in
 * particular is overwritten in place.
 */
interface BotContext {
  board: Board;
  /** Every legal swap this turn; the caller guarantees it is non-empty. */
  moves: readonly Swap[];
  /** Cells each goal still owes. The scored personas only pay for these kinds. */
  goals: ReadonlyMap<string, number>;
  /** Budget left, for a persona that plays the clock. Infinite on a moveless level. */
  movesLeft: number;
  /** The persona's own pick stream. How many draws it takes is part of its identity. */
  rng: Rng;
  /** Seed prefix for this turn's lookahead: each candidate evaluates at `${evalSeed}:${i}`. */
  evalSeed: string;
  /**
   * A scoring persona reports the candidate count it weighed and the score of
   * the swap it played (for `greedy` that is also the best score on the
   * board). Feeds the dead-turn ratio and the `--trace` dump.
   */
  note: (candidates: number, score: number) => void;
}

/**
 * A persona: one legal swap out of `ctx.moves`, or `null` when it has nothing
 * to play — the caller then fails the level as a dead board.
 */
type BotPolicy = (ctx: BotContext) => Swap | null;

/** One turn of a scoring persona's reasoning, kept only under `--trace`. */
interface MoveScore {
  candidates: number;
  score: number;
}

interface SessionResult {
  /** The run seed this session was dealt from — the trace's join key. */
  seed: string;
  won: boolean;
  /** Moves left on the budget when the session ended (0 on a loss). */
  movesLeft: number;
  movesMade: number;
  /** Goal cells still owed when the session ended — 0 on a win. */
  shortfall: number;
  /** Cascade beats each committed move produced — the juice sample. */
  cascadeLengths: number[];
  stars: number;
  /** Blockers the level was dealt with, and how many the bot actually removed. */
  blockersAtStart: number;
  blockersBroken: number;
  /** Moves committed inside the mercy window (narrowed refill pool). */
  mercyMoves: number;
  /** Legal swaps offered on each turn — the decision-density sample. */
  legalMoves: number[];
  /** Turns a scoring persona rated, and how many of those were dead (see NO_PROGRESS_SCORE). */
  scoredTurns: number;
  deadTurns: number;
  /** Specials the session created, and moves it played by firing one. */
  specialsCreated: number;
  comboMoves: number;
  /** Per-turn candidate count and played score. Collected only under `--trace`. */
  perMoveScores?: MoveScore[];
}

interface LevelReport {
  id: string;
  tier: Tier;
  cols: number;
  rows: number;
  moves: number;
  /** Total goal cells the order asks for — the near-miss denominator. */
  goalTotal: number;
  goalKinds: number;
  /** Blockers the level is authored with — the second difficulty axis. */
  jars: number;
  vines: number;
  /** Sessions per persona, keyed by its `BOT_POLICIES` name. */
  sessions: Map<string, SessionResult[]>;
}

/**
 * A persona's sessions on this level. Throws for a name the registry never
 * ran, which is a typo in a gate rather than a data condition.
 */
function sessionsOf(report: LevelReport, bot: string): SessionResult[] {
  const sessions = report.sessions.get(bot);
  if (sessions === undefined) throw new Error(`No "${bot}" sessions on ${report.id}`);
  return sessions;
}

/**
 * Cells each goal still owes, written into the caller's map — the context's
 * map is reused for every turn of a session, so a turn costs no allocation.
 * The keys are the level's goals and never change, so overwriting is enough.
 */
function remainingGoals(
  remaining: Map<string, number>,
  director: LevelDirector,
  level: (typeof BOARD_LEVELS)[number],
): void {
  for (const goal of level.spec.goals) {
    const progress = director.goalProgress(goal.id);
    remaining.set(goal.id, Math.max(0, progress.target - progress.current));
  }
}

/**
 * Greedy value of one swap: goal-relevant cells it would clear (capped at what
 * the goals still need, so over-clearing a finished colour is worth nothing),
 * plus a bonus per extra cascade beat, plus what it does to the blockers in
 * the way. Simulated on a clone with its own seed — the solver cannot see the
 * real refill stream, only the shape of the board (and, inside the mercy
 * window, the same narrowed pool the real board is drawing from).
 */
function scoreSwap(
  board: Board,
  swap: Swap,
  remaining: ReadonlyMap<string, number>,
  evalSeed: string,
): number {
  const probe = board.clone();
  probe.swap(swap.a, swap.b);
  const detonate: Cell[] = [];
  for (const cell of [swap.a, swap.b]) {
    const piece = probe.get(cell);
    if (piece !== null && (piece.special ?? null) !== null) detonate.push(cell);
  }
  const steps = resolveCascades(probe, new Rng(evalSeed), {
    origin: swap.b,
    detonate: detonate.length > 0 ? detonate : undefined,
  });

  const left = new Map(remaining);
  let score = 0;
  for (const step of steps) {
    for (const entry of step.cleared) {
      const need = left.get(entry.kind);
      if (need === undefined || need <= 0) continue;
      left.set(entry.kind, need - 1);
      score += 1;
    }
    for (const hit of step.blockerHits) {
      score += hit.broken ? BLOCKER_BREAK_BONUS : BLOCKER_CRACK_BONUS;
    }
  }
  return score + CASCADE_BONUS * Math.max(0, steps.length - 1);
}

/** The weak-human floor: one uniform draw over the legal moves, nothing read. */
function uniformPick(ctx: BotContext): Swap | null {
  if (ctx.moves.length === 0) return null;
  return ctx.moves[ctx.rng.int(0, ctx.moves.length - 1)] as Swap;
}

/** `scoreSwap` for every legal move; `scores[i]` pairs with `ctx.moves[i]`. */
function scoreMoves(ctx: BotContext): number[] {
  const scores = new Array<number>(ctx.moves.length);
  for (let i = 0; i < ctx.moves.length; i += 1) {
    scores[i] = scoreSwap(ctx.board, ctx.moves[i] as Swap, ctx.goals, `${ctx.evalSeed}:${i}`);
  }
  return scores;
}

/**
 * The skilled ceiling: the best-scoring swap on the board, ties broken
 * uniformly.
 *
 * It draws the uniform pick FIRST and then overrides it. That is two draws per
 * turn from its own stream, and every tier band in this file is calibrated
 * against exactly that stream — collapsing it to one draw re-deals the whole
 * ladder's greedy column. Do not "simplify" it.
 */
function greedyPick(ctx: BotContext): Swap | null {
  const fallback = uniformPick(ctx);
  if (fallback === null) return null;
  const scores = scoreMoves(ctx);
  let best = Number.NEGATIVE_INFINITY;
  const tied: Swap[] = [];
  for (let i = 0; i < ctx.moves.length; i += 1) {
    const score = scores[i] as number;
    if (score > best + 1e-9) {
      best = score;
      tied.length = 0;
      tied.push(ctx.moves[i] as Swap);
    } else if (score > best - 1e-9) {
      tied.push(ctx.moves[i] as Swap);
    }
  }
  ctx.note(ctx.moves.length, best);
  return tied[ctx.rng.int(0, tied.length - 1)] ?? fallback;
}

/**
 * REPORT-ONLY mid-skill proxy: reads the board exactly like greedy, then plays
 * a uniform pick among the top `IMPATIENT_WIDTH` candidates. It stands in for
 * the player who spots the good moves and takes one without comparing them —
 * the band between the two gated bounds, which no gate reads.
 */
function impatientPick(ctx: BotContext): Swap | null {
  if (ctx.moves.length === 0) return null;
  const scores = scoreMoves(ctx);
  const ranked = scores.map((_, index) => index);
  // Ties keep board order, so the pick stays reproducible from the seed alone.
  ranked.sort((a, b) => (scores[b] as number) - (scores[a] as number) || a - b);
  const width = Math.min(IMPATIENT_WIDTH, ranked.length);
  const chosen = ranked[ctx.rng.int(0, width - 1)] as number;
  ctx.note(ctx.moves.length, scores[chosen] as number);
  return ctx.moves[chosen] as Swap;
}

/**
 * THE PERSONA REGISTRY. An entry here is played on every level of every run
 * and appears in the report, the JSON payload and the trace. The gates below
 * name only the two bounds they bracket the ladder with (`greedy`, `random`),
 * so adding a persona measures the ladder without moving a threshold.
 */
const BOT_POLICIES: Record<string, BotPolicy> = {
  greedy: greedyPick,
  random: uniformPick,
  impatient: impatientPick,
};

/** Registry order (authored key order), used for every per-bot loop. */
const BOT_NAMES: readonly string[] = Object.keys(BOT_POLICIES);

function playSession(
  level: (typeof BOARD_LEVELS)[number],
  bot: string,
  runSeed: string,
  capture: boolean,
): SessionResult {
  const policy = BOT_POLICIES[bot];
  if (policy === undefined) throw new Error(`Unknown bot "${bot}" (registry: ${BOT_NAMES.join(', ')})`);

  const spec = boardSpecFor(level);
  const board = new Board(spec, new Rng(`${runSeed}:deal`));
  const rng = new Rng(`${runSeed}:play`);
  const picker = new Rng(`${runSeed}:pick`);
  const director = new LevelDirector(level.spec);
  const blockersAtStart = board.blockerCount;

  // MERCY, identical to the scene's: below the threshold, refills narrow to
  // this pool. Derived once — it depends only on the level, so a scene and a
  // sim that both call `mercyPool` cannot drift apart.
  const mercy = BOARD_TUNING.mercy;
  const mercyKinds = mercyPool(
    spec,
    level.spec.goals.map((goal) => ({ kind: goal.id })),
    mercy.poolSize,
  );
  let mercyActive = false;
  let mercyMoves = 0;

  let movesMade = 0;
  let blockersBroken = 0;
  let specialsCreated = 0;
  let comboMoves = 0;
  let scoredTurns = 0;
  let deadTurns = 0;
  const cascadeLengths: number[] = [];
  const legalMoves: number[] = [];
  const perMoveScores: MoveScore[] | undefined = capture ? [] : undefined;
  // Goal remainder, rewritten in place each turn and exposed read-only on the
  // context: dynamic keys, runtime writes, so a Map and not a Record.
  const goals = new Map<string, number>();

  // One context for the whole session, rewritten per turn (see BotContext).
  const ctx: BotContext = {
    board,
    moves: [],
    goals,
    movesLeft: Number.POSITIVE_INFINITY,
    rng: picker,
    evalSeed: '',
    note: (candidates, score) => {
      scoredTurns += 1;
      if (score <= NO_PROGRESS_SCORE + 1e-9) deadTurns += 1;
      perMoveScores?.push({ candidates, score });
    },
  };

  while (!director.ended) {
    const inMercy = (director.movesLeft ?? Number.POSITIVE_INFINITY) <= mercy.movesLeft;
    if (inMercy !== mercyActive) {
      board.setRefillPool(inMercy ? mercyKinds : null);
      mercyActive = inMercy;
    }
    if (inMercy) mercyMoves += 1;

    let moves = findValidMoves(board);
    if (moves.length === 0) {
      // Same recovery the slice runs: re-deal in place, fail only if even that
      // cannot produce a playable board.
      const ok = reshuffle(board, rng);
      moves = findValidMoves(board);
      if (!ok || moves.length === 0) {
        director.fail('no-moves');
        break;
      }
    }
    legalMoves.push(moves.length);

    remainingGoals(goals, director, level);
    ctx.moves = moves;
    ctx.movesLeft = director.movesLeft ?? Number.POSITIVE_INFINITY;
    ctx.evalSeed = `${runSeed}:eval:${movesMade}`;
    const choice = policy(ctx);
    if (choice === null) {
      director.fail('no-moves');
      break;
    }

    board.swap(choice.a, choice.b);
    director.useMove();
    movesMade += 1;

    const detonate: Cell[] = [];
    for (const cell of [choice.a, choice.b]) {
      const piece = board.get(cell);
      if (piece !== null && (piece.special ?? null) !== null) detonate.push(cell);
    }
    // A COMBO is a move that fires an earned special rather than making a
    // plain match — the payoff half of the special economy.
    if (detonate.length > 0) comboMoves += 1;
    const steps = resolveCascades(board, rng, {
      origin: choice.b,
      detonate: detonate.length > 0 ? detonate : undefined,
    });
    cascadeLengths.push(steps.length);
    for (const step of steps) {
      // Exactly the slice's goal counting: `cleared` only. A vine that
      // absorbed a match is in `blockerHits` and NOT in `cleared`, so the bot
      // gets no credit for it either — that is the rule under test.
      for (const entry of step.cleared) director.recordProgress(entry.kind, 1);
      for (const hit of step.blockerHits) if (hit.broken) blockersBroken += 1;
      specialsCreated += step.created.length;
    }
    director.settleMove();
    if (!director.ended && hasDeadBoard(board)) reshuffle(board, rng);
  }

  let shortfall = 0;
  for (const goal of level.spec.goals) {
    const progress = director.goalProgress(goal.id);
    shortfall += Math.max(0, progress.target - progress.current);
  }

  const outcome = director.outcome;
  return {
    seed: runSeed,
    won: outcome?.won === true,
    movesLeft: director.movesLeft ?? 0,
    movesMade,
    shortfall,
    cascadeLengths,
    stars: director.stars,
    blockersAtStart,
    blockersBroken,
    mercyMoves,
    legalMoves,
    scoredTurns,
    deadTurns,
    specialsCreated,
    comboMoves,
    perMoveScores,
  };
}

function winrate(sessions: readonly SessionResult[]): number {
  if (sessions.length === 0) return Number.NaN;
  return sessions.filter((session) => session.won).length / sessions.length;
}

/**
 * Median shortfall of the LOSING runs as a fraction of the order — the
 * near-miss number. `NaN` when the bot barely lost, which is a level the gate
 * has nothing to say about rather than a level that passed.
 */
function lossShortfall(report: LevelReport, sessions: readonly SessionResult[]): number {
  const losses = sessions.filter((session) => !session.won);
  if (losses.length < MIN_LOSS_SAMPLE) return Number.NaN;
  return median(losses.map((session) => session.shortfall)) / report.goalTotal;
}

/**
 * REPORT-ONLY fun proxies: what the ladder FEELS like, as opposed to how hard
 * it is. None of these is gated — the difficulty gates are laws, these are
 * instruments, and `--strict` (which the release check runs) would turn every
 * one of them into a red build for a design change that is nobody's bug.
 */
interface FunProxies {
  /** DECISION DENSITY: mean legal swaps offered per turn — how much choice a turn really has. */
  density: number;
  /** DEAD-TURN RATIO: share of scored turns whose best swap fell under NO_PROGRESS_SCORE. */
  deadRatio: number;
  /** PAYOFF p50: cascade beats the typical move pays out — the baseline reward. */
  payoffP50: number;
  /** PAYOFF p90: cascade beats the lucky one in ten pays out — the reward's tail. */
  payoffP90: number;
  /** SPECIAL RATE: specials created per 10 committed moves — how often the board hands out a tool. */
  specialsPer10: number;
  /** COMBO RATE: moves per session played by firing a special — how often that tool gets used. */
  comboRate: number;
}

/** Fun proxies over one persona's sessions on one level. */
function funProxies(sessions: readonly SessionResult[]): FunProxies {
  const cascades = sessions.flatMap((session) => session.cascadeLengths);
  let moves = 0;
  let scored = 0;
  let dead = 0;
  let specials = 0;
  for (const session of sessions) {
    moves += session.movesMade;
    scored += session.scoredTurns;
    dead += session.deadTurns;
    specials += session.specialsCreated;
  }
  return {
    density: mean(sessions.flatMap((session) => session.legalMoves)),
    deadRatio: scored > 0 ? dead / scored : Number.NaN,
    payoffP50: percentile(cascades, 0.5),
    payoffP90: percentile(cascades, 0.9),
    specialsPer10: moves > 0 ? (10 * specials) / moves : Number.NaN,
    comboRate: mean(sessions.map((session) => session.comboMoves)),
  };
}

export default function runFamilySim(options: FamilySimOptions): number {
  const runs = Math.max(1, Math.floor(options.runs));
  /** `--trace` is the only thing that turns on per-move collection. */
  const tracePath = options.trace ?? null;
  const reports: LevelReport[] = [];

  for (let index = 0; index < BOARD_LEVELS.length; index += 1) {
    const level = BOARD_LEVELS[index] as (typeof BOARD_LEVELS)[number];
    const layout = boardSpecFor(level);
    const report: LevelReport = {
      id: level.spec.id,
      tier: TIERS[index] ?? 'normal',
      cols: layout.cols,
      rows: layout.rows,
      moves: level.spec.moves ?? 0,
      goalTotal: level.spec.goals.reduce((sum, goal) => sum + goal.target, 0),
      goalKinds: level.spec.goals.length,
      jars: layout.jars?.length ?? 0,
      vines: layout.vines?.length ?? 0,
      sessions: new Map(BOT_NAMES.map((bot): [string, SessionResult[]] => [bot, []])),
    };
    for (let run = 0; run < runs; run += 1) {
      // The deal seed is shared between the bots so they all face the SAME
      // puzzle — the win-rate gap is then only about move choice.
      const runSeed = `${options.seed}:${level.seed}:${run}`;
      // Registry order, one session each: a persona added to BOT_POLICIES is
      // played and reported here without this loop changing.
      for (const bot of BOT_NAMES) {
        sessionsOf(report, bot).push(playSession(level, bot, runSeed, tracePath !== null));
      }
    }
    reports.push(report);
  }

  // The gates below read ONLY these two personas — the ladder's two bounds.
  const greedyOf = (report: LevelReport): readonly SessionResult[] => sessionsOf(report, 'greedy');
  const randomOf = (report: LevelReport): readonly SessionResult[] => sessionsOf(report, 'random');
  // Report-only, and read forgivingly: dropping `impatient` from the registry
  // must cost a column, never the run.
  const impatientOf = (report: LevelReport): readonly SessionResult[] =>
    report.sessions.get('impatient') ?? [];
  const proxies = reports.map((report) => funProxies(greedyOf(report)));

  const gates: GateResult[] = [];

  const unsolvable = reports.filter((report) => greedyOf(report).every((session) => !session.won));
  gates.push(
    hard(
      unsolvable.length === 0,
      `every level solvable by the greedy solver: ${reports.length - unsolvable.length}/${reports.length}` +
        (unsolvable.length > 0 ? ` (never won: ${unsolvable.map((r) => r.id).join(', ')})` : ''),
    ),
  );

  // MOVE BUDGETS first, because they are the design law the round-1 ladder
  // broke: a level is allowed to be hard, never allowed to be short.
  const starved = reports.filter((report) => {
    const band = TIER_BANDS[report.tier];
    return report.moves < Math.max(band.movesMin, ABSOLUTE_MOVE_FLOOR) || report.moves > band.movesMax;
  });
  gates.push(
    hard(
      starved.length === 0,
      `move budgets inside their tier band (floor ${ABSOLUTE_MOVE_FLOOR}): ` +
        `${reports.length - starved.length}/${reports.length}` +
        (starved.length > 0
          ? ` (off-band: ${starved.map((r) => `${r.id} ${r.moves} vs ${TIER_BANDS[r.tier].movesMin}-${TIER_BANDS[r.tier].movesMax}`).join(', ')})`
          : ''),
    ),
  );

  const offSize = reports.filter(
    (report) =>
      report.cols < MIN_COLS || report.cols > MAX_COLS || report.rows < MIN_ROWS || report.rows > MAX_ROWS,
  );
  gates.push(
    hard(
      offSize.length === 0,
      `board sizes inside ${MIN_COLS}x${MIN_ROWS}..${MAX_COLS}x${MAX_ROWS}: ` +
        `${reports.length - offSize.length}/${reports.length}` +
        (offSize.length > 0 ? ` (off: ${offSize.map((r) => `${r.id} ${r.cols}x${r.rows}`).join(', ')})` : ''),
    ),
  );

  // The CEILING, per tier: the skilled bound. A level the greedy solver drops
  // below its tier's floor is a level a human cannot reliably clear at all.
  const ceilingMisses = reports.filter((report) => {
    const rate = winrate(greedyOf(report));
    return rate < TIER_BANDS[report.tier].greedyMin - bandSlack(rate, runs) - 1e-9;
  });
  gates.push(
    hard(
      ceilingMisses.length === 0,
      `greedy (skilled ceiling) clears its tier: ${reports.length - ceilingMisses.length}/${reports.length}` +
        (ceilingMisses.length > 0
          ? ` (short: ${ceilingMisses.map((r) => `${r.id} ${pct(winrate(greedyOf(r)))} < ${pct(TIER_BANDS[r.tier].greedyMin)}`).join(', ')})`
          : ''),
    ),
  );

  // The FLOOR, per tier, and it is a WINDOW: too low is a wall, too high is a
  // level with no difficulty in it at all. This is the gate the round-1 ladder
  // had no equivalent of, and the reason it shipped unplayable.
  const floorMisses = reports.filter((report) => {
    const band = TIER_BANDS[report.tier];
    const rate = winrate(randomOf(report));
    const slack = bandSlack(rate, runs);
    return rate < band.randomMin - slack - 1e-9 || rate > band.randomMax + slack + 1e-9;
  });
  gates.push(
    hard(
      floorMisses.length === 0,
      `random (weak-human floor) inside its tier window (+-${pct(bandSlack(0.5, runs), 1)} sampling ` +
        `slack at ${runs} runs): ${reports.length - floorMisses.length}/${reports.length}` +
        (floorMisses.length > 0
          ? ` (off: ${floorMisses
              .map(
                (r) =>
                  `${r.id} ${r.tier} ${pct(winrate(randomOf(r)))} vs ` +
                  `${pct(TIER_BANDS[r.tier].randomMin)}-${pct(TIER_BANDS[r.tier].randomMax)}`,
              )
              .join(', ')})`
          : ''),
    ),
  );

  // NEAR MISS: a loss has to end within sight of the order. Measured on the
  // random bot because that is the bot that loses often enough to have a
  // median, and it is the one standing in for the player who lost.
  const misSized = reports.filter((report) => {
    const ratio = lossShortfall(report, randomOf(report));
    return Number.isFinite(ratio) && ratio > MAX_LOSS_SHORTFALL + 1e-9;
  });
  const measured = reports.filter((report) => Number.isFinite(lossShortfall(report, randomOf(report))));
  gates.push(
    hard(
      misSized.length === 0,
      `losing runs end within ${pct(MAX_LOSS_SHORTFALL)} of the order on ` +
        `${measured.length - misSized.length}/${measured.length} measurable levels` +
        (misSized.length > 0
          ? ` (mis-sized: ${misSized.map((r) => `${r.id} ${pct(lossShortfall(r, randomOf(r)), 1)}`).join(', ')})`
          : ''),
    ),
  );

  // The floor has to FALL, tier by tier, or the ladder is one difficulty with
  // twelve pictures. Measured on the tier MEANS (see TIER_DECLINE_MARGIN): the
  // breather is inside the normal mean, where it belongs, and no single rung's
  // seed luck can fake or break the curve.
  const tierOrder: readonly Tier[] = ['tutorial', 'normal', 'hard', 'finale'];
  const tierFloor = tierOrder.map((tier) =>
    mean(reports.filter((report) => report.tier === tier).map((report) => winrate(randomOf(report)))),
  );
  const flats: string[] = [];
  for (let i = 1; i < tierOrder.length; i += 1) {
    const prev = tierFloor[i - 1] as number;
    const here = tierFloor[i] as number;
    if (here > prev - TIER_DECLINE_MARGIN) flats.push(`${tierOrder[i - 1]}->${tierOrder[i]}`);
  }
  gates.push(
    hard(
      flats.length === 0,
      `random floor falls tier by tier (>= ${pct(TIER_DECLINE_MARGIN)} per step): ` +
        tierOrder.map((tier, i) => `${tier} ${pct(tierFloor[i] as number)}`).join(' > ') +
        ` [breather ${reports[BREATHER_INDEX]?.id ?? '?'} counted as normal]` +
        (flats.length > 0 ? ` (flat: ${flats.join(', ')})` : ''),
    ),
  );

  // Per-level floors are REPORTED (the `random` column) rather than gated: at
  // 60 runs a single level's rate carries a +-13 point sampling error and
  // re-deals with every seed, so there is no honest per-rung threshold to set.
  // The tier gate above is the measurable form of the same claim.

  const greedyOverall = mean(reports.map((report) => winrate(greedyOf(report))));
  const randomOverall = mean(reports.map((report) => winrate(randomOf(report))));
  gates.push(
    soft(
      randomOverall < greedyOverall,
      `ladder win rate greedy ${pct(greedyOverall, 1)} vs random ${pct(randomOverall, 1)} ` +
        '(skill must beat chance)',
    ),
  );

  const cascadeMedian = median(reports.flatMap((report) => greedyOf(report).flatMap((s) => s.cascadeLengths)));
  gates.push(
    soft(
      cascadeMedian >= 1.2 && cascadeMedian <= 3,
      `median cascade length = ${num(cascadeMedian)} beats per move (juice target 1.2-3.0)`,
    ),
  );

  // The obstacle layer has to be LIVE, not scenery. A blocker level the solver
  // wins without ever removing a blocker means the layout is somewhere the
  // play never goes, and the levels below it were tuned against nothing.
  const blockerLevels = reports.filter((report) => (greedyOf(report)[0]?.blockersAtStart ?? 0) > 0);
  const inertLevels = blockerLevels.filter(
    (report) => median(greedyOf(report).map((session) => session.blockersBroken)) < 1,
  );
  gates.push(
    hard(
      blockerLevels.length > 0 && inertLevels.length === 0,
      `blocker levels engaged: ${blockerLevels.length - inertLevels.length}/${blockerLevels.length} ` +
        `remove a blocker in a median run` +
        (inertLevels.length > 0 ? ` (inert: ${inertLevels.map((r) => r.id).join(', ')})` : ''),
    ),
  );

  // The mercy rule has to actually fire somewhere, or the scene and the sim are
  // agreeing about a code path neither one runs.
  const mercyLevels = reports.filter((report) => randomOf(report).some((session) => session.mercyMoves > 0));
  gates.push(
    soft(
      mercyLevels.length > 0,
      `mercy window reached on ${mercyLevels.length}/${reports.length} levels ` +
        `(refills narrow to ${BOARD_TUNING.mercy.poolSize} kinds at ${BOARD_TUNING.mercy.movesLeft} moves left)`,
    ),
  );

  // TRACE: every session's raw record, written only when `--trace <path>` asks
  // for it — the per-move arrays are the bulk of the file and are not even
  // collected otherwise. Shape is level -> bot -> session[], so two personas on
  // the same deal are joined by `seed`.
  let traceNote: string | null = null;
  if (tracePath !== null) {
    const trace = {
      family: 'board',
      seed: options.seed,
      runs,
      bots: BOT_NAMES,
      deadTurnScore: NO_PROGRESS_SCORE,
      levels: reports.map((report) => ({
        id: report.id,
        tier: report.tier,
        moves: report.moves,
        goalTotal: report.goalTotal,
        bots: Object.fromEntries(
          BOT_NAMES.map((bot) => [
            bot,
            sessionsOf(report, bot).map((session) => ({
              seed: session.seed,
              won: session.won,
              movesMade: session.movesMade,
              movesLeft: session.movesLeft,
              shortfall: session.shortfall,
              cascadeLengths: session.cascadeLengths,
              specialsCreated: session.specialsCreated,
              comboMoves: session.comboMoves,
              blockersBroken: session.blockersBroken,
              mercyMoves: session.mercyMoves,
              // Scoring personas only: `random` rates nothing and reports [].
              perMoveScores: session.perMoveScores,
            })),
          ]),
        ),
      })),
    };
    writeFileSync(tracePath, JSON.stringify(trace, null, 2));
    traceNote = `trace: ${reports.length * runs * BOT_NAMES.length} session records -> ${tracePath}`;
  }

  const render = (): void => {
    printTable(
      ['level', 'tier', 'board', 'moves', 'goal', 'jars', 'vines', 'greedy', 'random', 'left', 'short', 'casc', 'stars', 'par'],
      reports.map((report) => {
        const wins = greedyOf(report).filter((session) => session.won);
        return [
          report.id,
          report.tier,
          `${report.cols}x${report.rows}`,
          num(report.moves, 0),
          `${report.goalTotal}/${report.goalKinds}`,
          num(report.jars, 0),
          num(report.vines, 0),
          pct(winrate(greedyOf(report))),
          pct(winrate(randomOf(report))),
          num(median(wins.map((session) => session.movesLeft)), 1),
          pct(lossShortfall(report, randomOf(report)), 1),
          num(median(greedyOf(report).flatMap((session) => session.cascadeLengths)), 1),
          num(median(wins.map((session) => session.stars)), 1),
          num(report.moves * median(randomOf(report).map((s) => (report.goalTotal - s.shortfall) / Math.max(1, s.movesMade))), 0),
        ];
      }),
    );
    console.log(
      "\ngoal column is 'cells/kinds'; left = median moves left on a greedy win; " +
        'short = median shortfall of a RANDOM loss, as a share of the order',
    );
    // `par` is the authoring handle: the random bot's measured collection rate
    // stretched over the whole budget, i.e. the order size that bot would just
    // about finish. Authoring a goal AT par lands the floor near 50%; a few
    // points above par is the hard band, ~15% above is the finale. Resizing a
    // level is therefore one measurement, not a bisection.
    console.log('par = order size the random floor would just finish in a full budget');
    console.log(`${runs} run(s) per level per bot, seed '${options.seed}'`);

    console.log('\nfun proxies (REPORT-ONLY, measured on the greedy sessions):');
    printTable(
      ['level', 'imp-win', 'density', 'dead', 'p50', 'p90', 'spec/10', 'combo'],
      reports.map((report, index) => {
        const fun = proxies[index] as FunProxies;
        return [
          report.id,
          pct(winrate(impatientOf(report))),
          num(fun.density, 1),
          pct(fun.deadRatio, 1),
          num(fun.payoffP50, 1),
          num(fun.payoffP90, 1),
          num(fun.specialsPer10, 2),
          num(fun.comboRate, 1),
        ];
      }),
    );
    console.log(
      `imp-win = win rate of the report-only 'impatient' persona (uniform among its top ` +
        `${IMPATIENT_WIDTH} swaps); density = mean legal swaps per turn; ` +
        'dead = greedy turns whose best swap did nothing for the order',
    );
    console.log(
      'p50/p90 = cascade beats per move; spec/10 = specials created per 10 moves; ' +
        'combo = moves per session played by firing a special',
    );
    console.log('none of these is gated: they measure the shape of the fun, not a law');
    if (traceNote !== null) console.log(traceNote);
  };

  return finishFamily(options, gates, render, {
    family: 'board',
    runs,
    bots: BOT_NAMES,
    trace: tracePath,
    levels: reports.map((report, index) => ({
      id: report.id,
      tier: report.tier,
      cols: report.cols,
      rows: report.rows,
      moves: report.moves,
      goalTotal: report.goalTotal,
      jars: report.jars,
      vines: report.vines,
      greedyWinrate: winrate(greedyOf(report)),
      randomWinrate: winrate(randomOf(report)),
      medianMovesLeft: median(greedyOf(report).filter((s) => s.won).map((s) => s.movesLeft)),
      medianLossShortfall: lossShortfall(report, randomOf(report)),
      medianCascadeLength: median(greedyOf(report).flatMap((s) => s.cascadeLengths)),
      medianBlockersBroken: median(greedyOf(report).map((s) => s.blockersBroken)),
      // REPORT-ONLY from here down: no gate above reads either field.
      impatientWinrate: winrate(impatientOf(report)),
      fun: proxies[index],
    })),
  });
}
