import { Board } from '../../core/board/grid';
import { findValidMoves, hasDeadBoard, reshuffle, resolveCascades } from '../../core/board/resolve';
import type { Cell, Swap } from '../../core/board/types';
import { LevelDirector } from '../../core/level';
import { Rng } from '../../core/rng';
import { BOARD_LEVELS } from '../../slices/board/levels';
import { BOARD_KINDS, BOARD_TUNING } from '../../slices/board/tuning';
import { finishFamily, hard, mean, median, num, pct, printTable, soft } from './types';
import type { FamilySimOptions, GateResult } from './types';

/**
 * Family B (board puzzle) solver gate. Run: `npm run sim -- --family board`.
 *
 * WHAT IT GATES — that the shipped level ladder (`slices/board/levels.ts`) is
 * actually content and not an accident:
 *  - every level is SOLVABLE at all (a greedy solver wins it at least once),
 *  - the difficulty band is human AND bounded at BOTH ends: levels 1-3 are
 *    near-guaranteed wins, no level collapses below a 30% win rate, and the
 *    hardest level is not a guaranteed win either (30-90%),
 *  - SKILL MATTERS: a random-swap bot must lose to the greedy one (otherwise
 *    the level is a slot machine, not a puzzle),
 *  - cascades happen (the juice proxy: mean cascade beats per move).
 *
 * HOW IT PLAYS — exactly the move pipeline `slices/board/game.ts` commits:
 * `board.swap` -> `director.useMove()` -> detonate any swapped special ->
 * `resolveCascades` -> `recordProgress` per cleared cell -> `settleMove()`,
 * with a `reshuffle` on a dead board. The bots differ only in which of
 * `findValidMoves`' swaps they pick, so the win-rate gap between them is a
 * pure measurement of how much the level rewards reading the board.
 *
 * Deterministic given `--seed`: the deal, the refills and the greedy solver's
 * lookahead each draw from their own named child seed.
 */

/** Extra score a greedy candidate earns per cascade beat past the first. */
const CASCADE_BONUS = 0.75;
/** Hard floor on any level's greedy win rate — below this the level is broken. */
const MIN_LEVEL_WINRATE = 0.3;
/** Levels 1-3 are the teaching band: a solver should almost never lose them. */
const TUTORIAL_WINRATE = 0.9;
const TUTORIAL_LEVELS = 3;
/**
 * Hard CEILING on the hardest level's greedy win rate.
 *
 * The floor above proves no level is broken; this proves the ladder has a top.
 * A ladder whose hardest level the solver clears every single time has no
 * level a reading player can lose, so it has no level worth a retry, no
 * booster worth spending and no 3-star worth chasing — the whole saga/stars
 * meta hangs off there being a level that resists. 90% is the loosest bar that
 * still means "resists": one loss in ten for a bot that scores every legal
 * swap against the goals, i.e. considerably more than one in ten for a human.
 * Hard rather than soft because it is not a preference; a ladder without a top
 * end has no endgame content at all.
 */
const MAX_LADDER_WINRATE = 0.9;

type BotKind = 'greedy' | 'random';

interface SessionResult {
  won: boolean;
  /** Moves left on the budget when the session ended (0 on a loss). */
  movesLeft: number;
  movesMade: number;
  /** Cascade beats each committed move produced — the juice sample. */
  cascadeLengths: number[];
  stars: number;
}

interface LevelReport {
  id: string;
  greedy: SessionResult[];
  random: SessionResult[];
}

/** Remaining count per goal id; the greedy score only pays for these kinds. */
function remainingGoals(director: LevelDirector, level: (typeof BOARD_LEVELS)[number]): Map<string, number> {
  const remaining = new Map<string, number>();
  for (const goal of level.spec.goals) {
    const progress = director.goalProgress(goal.id);
    remaining.set(goal.id, Math.max(0, progress.target - progress.current));
  }
  return remaining;
}

/**
 * Greedy value of one swap: goal-relevant cells it would clear (capped at what
 * the goals still need, so over-clearing a finished colour is worth nothing)
 * plus a bonus per extra cascade beat. Simulated on a clone with its own seed —
 * the solver cannot see the real refill stream, only the shape of the board.
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
  }
  return score + CASCADE_BONUS * Math.max(0, steps.length - 1);
}

function playSession(
  level: (typeof BOARD_LEVELS)[number],
  bot: BotKind,
  runSeed: string,
): SessionResult {
  const board = new Board(
    { cols: BOARD_TUNING.cols, rows: BOARD_TUNING.rows, kinds: BOARD_KINDS },
    new Rng(`${runSeed}:deal`),
  );
  const rng = new Rng(`${runSeed}:play`);
  const picker = new Rng(`${runSeed}:pick`);
  const director = new LevelDirector(level.spec);

  let movesMade = 0;
  const cascadeLengths: number[] = [];

  while (!director.ended) {
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

    let choice = moves[picker.int(0, moves.length - 1)] as Swap;
    if (bot === 'greedy') {
      const remaining = remainingGoals(director, level);
      let best = Number.NEGATIVE_INFINITY;
      const tied: Swap[] = [];
      for (let i = 0; i < moves.length; i += 1) {
        const swap = moves[i] as Swap;
        const score = scoreSwap(board, swap, remaining, `${runSeed}:eval:${movesMade}:${i}`);
        if (score > best + 1e-9) {
          best = score;
          tied.length = 0;
          tied.push(swap);
        } else if (score > best - 1e-9) {
          tied.push(swap);
        }
      }
      choice = tied[picker.int(0, tied.length - 1)] as Swap;
    }

    board.swap(choice.a, choice.b);
    director.useMove();
    movesMade += 1;

    const detonate: Cell[] = [];
    for (const cell of [choice.a, choice.b]) {
      const piece = board.get(cell);
      if (piece !== null && (piece.special ?? null) !== null) detonate.push(cell);
    }
    const steps = resolveCascades(board, rng, {
      origin: choice.b,
      detonate: detonate.length > 0 ? detonate : undefined,
    });
    cascadeLengths.push(steps.length);
    for (const step of steps) {
      for (const entry of step.cleared) director.recordProgress(entry.kind, 1);
    }
    director.settleMove();
    if (!director.ended && hasDeadBoard(board)) reshuffle(board, rng);
  }

  const outcome = director.outcome;
  return {
    won: outcome?.won === true,
    movesLeft: director.movesLeft ?? 0,
    movesMade,
    cascadeLengths,
    stars: director.stars,
  };
}

function winrate(sessions: readonly SessionResult[]): number {
  if (sessions.length === 0) return Number.NaN;
  return sessions.filter((session) => session.won).length / sessions.length;
}

export default function runFamilySim(options: FamilySimOptions): number {
  const runs = Math.max(1, Math.floor(options.runs));
  const reports: LevelReport[] = [];

  for (let index = 0; index < BOARD_LEVELS.length; index += 1) {
    const level = BOARD_LEVELS[index] as (typeof BOARD_LEVELS)[number];
    const report: LevelReport = { id: level.spec.id, greedy: [], random: [] };
    for (let run = 0; run < runs; run += 1) {
      // The deal seed is shared between the two bots so they face the SAME
      // puzzle — the win-rate gap is then only about move choice.
      const runSeed = `${options.seed}:${level.seed}:${run}`;
      report.greedy.push(playSession(level, 'greedy', runSeed));
      report.random.push(playSession(level, 'random', runSeed));
    }
    reports.push(report);
  }

  const gates: GateResult[] = [];

  const unsolvable = reports.filter((report) => report.greedy.every((session) => !session.won));
  gates.push(
    hard(
      unsolvable.length === 0,
      `every level solvable by the greedy solver: ${reports.length - unsolvable.length}/${reports.length}` +
        (unsolvable.length > 0 ? ` (never won: ${unsolvable.map((r) => r.id).join(', ')})` : ''),
    ),
  );

  const tutorial = reports.slice(0, TUTORIAL_LEVELS);
  const tutorialLow = tutorial.filter((report) => winrate(report.greedy) < TUTORIAL_WINRATE);
  gates.push(
    hard(
      tutorialLow.length === 0,
      `greedy win rate on levels 1-${TUTORIAL_LEVELS} = [${tutorial
        .map((report) => pct(winrate(report.greedy)))
        .join(', ')}] (each must be >= ${pct(TUTORIAL_WINRATE)})`,
    ),
  );

  const floorRate = Math.min(...reports.map((report) => winrate(report.greedy)));
  const floorLevels = reports
    .filter((report) => winrate(report.greedy) <= floorRate + 1e-9)
    .map((report) => report.id);
  const floorLabel =
    floorLevels.length > 3 ? `${floorLevels.slice(0, 3).join(', ')}, +${floorLevels.length - 3} more` : floorLevels.join(', ');
  gates.push(
    hard(
      floorRate >= MIN_LEVEL_WINRATE,
      `lowest greedy win rate on the ladder = ${pct(floorRate)} ` +
        `(${floorLabel}; must be >= ${pct(MIN_LEVEL_WINRATE)})`,
    ),
  );

  const greedyOverall = mean(reports.map((report) => winrate(report.greedy)));
  const randomOverall = mean(reports.map((report) => winrate(report.random)));
  gates.push(
    soft(
      randomOverall < greedyOverall,
      `ladder win rate greedy ${pct(greedyOverall, 1)} vs random ${pct(randomOverall, 1)} ` +
        '(skill must beat chance)',
    ),
  );

  const cascadeMedian = median(reports.flatMap((report) => report.greedy.flatMap((s) => s.cascadeLengths)));
  gates.push(
    soft(
      cascadeMedian >= 1.2 && cascadeMedian <= 3,
      `median cascade length = ${num(cascadeMedian)} beats per move (juice target 1.2-3.0)`,
    ),
  );

  // Ladder SHAPE, measured on the random floor bot: the authored decline has to
  // show up somewhere, and the floor is the only bot that can still lose.
  const openingFloor = mean(reports.slice(0, TUTORIAL_LEVELS).map((report) => winrate(report.random)));
  const closingFloor = mean(reports.slice(-TUTORIAL_LEVELS).map((report) => winrate(report.random)));
  gates.push(
    soft(
      closingFloor < openingFloor,
      `random-bot win rate falls across the ladder: ${pct(openingFloor, 1)} on levels 1-${TUTORIAL_LEVELS} ` +
        `vs ${pct(closingFloor, 1)} on the last ${TUTORIAL_LEVELS} (authored difficulty must climb)`,
    ),
  );

  // The ladder's ceiling (see MAX_LADDER_WINRATE). Measured on the greedy bot
  // because it is an UPPER bound on human play: a level it loses one run in
  // four is a level a player loses far more often than that.
  gates.push(
    hard(
      floorRate <= MAX_LADDER_WINRATE,
      `hardest level for the solver wins ${pct(floorRate)} of runs ` +
        `(must be <= ${pct(MAX_LADDER_WINRATE)}: a ladder the solver always clears has no top end)`,
    ),
  );

  const render = (): void => {
    printTable(
      ['level', 'greedy WR', 'random WR', 'moves left', 'cascade len', 'stars'],
      reports.map((report) => {
        const wins = report.greedy.filter((session) => session.won);
        return [
          report.id,
          pct(winrate(report.greedy)),
          pct(winrate(report.random)),
          num(median(wins.map((session) => session.movesLeft)), 1),
          num(median(report.greedy.flatMap((session) => session.cascadeLengths))),
          num(median(wins.map((session) => session.stars)), 1),
        ];
      }),
    );
    console.log(`\n${runs} run(s) per level per bot, seed '${options.seed}'`);
  };

  return finishFamily(options, gates, render, {
    family: 'board',
    runs,
    levels: reports.map((report) => ({
      id: report.id,
      greedyWinrate: winrate(report.greedy),
      randomWinrate: winrate(report.random),
      medianMovesLeft: median(report.greedy.filter((s) => s.won).map((s) => s.movesLeft)),
      medianCascadeLength: median(report.greedy.flatMap((s) => s.cascadeLengths)),
    })),
  });
}
