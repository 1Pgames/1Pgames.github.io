import { Rng } from '../../core/rng';
import { buildRing, DiceLoop, SPECIAL_TILES } from '../../slices/table/board';
import type { TileType } from '../../slices/table/board';
import { TABLE_TUNING } from '../../slices/table/tuning';
import { finishFamily, hard, median, num, pct, printTable, soft } from './types';
import type { FamilySimOptions, GateResult } from './types';

/**
 * Family G (dice board) budget gate. Run: `npm run sim -- --family table`.
 *
 * WHAT IT GATES — that `TABLE_TUNING.rules` is a budget and not a formality:
 *  - the win rate at the shipped roll budget sits in 55-95%: the win is the
 *    expected outcome, an unlucky ring still loses,
 *  - a win has to COST something: the median winning session leaves at most
 *    two rolls spare, so the budget is felt.
 *
 * HOW IT PLAYS — `DiceLoop` itself, the same pure model the scene and
 * `src/sim/kits/diceloop.selftest.ts` drive: `buildRing` deals the layout, then
 * one `roll()` per turn until the `LevelDirector` resolves. The family has no
 * decisions to make (a dice board is pure budget maths), so there is no bot
 * policy here — the gate is entirely about the tuned budget.
 *
 * Deterministic given `--seed`.
 */

/** Win-rate band for the shipped budget. */
const MIN_WINRATE = 0.55;
const MAX_WINRATE = 0.95;
/** Headroom the median win must keep inside the budget (`rolls - this`). */
const MAX_SPARE_ROLLS = 2;
/** Roll-loop safety valve; `rollagain` refunds cannot outrun this. */
const MAX_ROLLS = 500;
/** Extra budgets probed for context around the shipped one. */
const BUDGET_OFFSETS: readonly number[] = [-6, -3, 0, 3];

interface SessionResult {
  won: boolean;
  reason: string;
  /** Rolls actually taken (refunded `rollagain` turns included). */
  rolls: number;
  /** Budget left on a win. */
  rollsLeft: number;
  pieces: number;
  coins: number;
}

function playSession(seed: string, rolls: number): SessionResult {
  const rng = new Rng(seed);
  const ring: readonly TileType[] = buildRing(rng, TABLE_TUNING.tiles);
  const loop = new DiceLoop(ring, { ...TABLE_TUNING.rules, rolls });

  let taken = 0;
  for (let guard = 0; guard < MAX_ROLLS && !loop.level.ended; guard += 1) {
    if (loop.roll(rng) === null) break;
    taken += 1;
  }

  const outcome = loop.level.outcome;
  return {
    won: outcome?.won === true,
    reason: outcome?.reason ?? 'unresolved',
    rolls: taken,
    rollsLeft: loop.level.movesLeft ?? 0,
    pieces: loop.pieces,
    coins: loop.coins,
  };
}

export default function runFamilySim(options: FamilySimOptions): number {
  // A dice board is a variance question, so the sample has to be wide: the
  // budget sweep multiplies `--runs` by 10 seeds per budget.
  const runs = Math.max(1, Math.floor(options.runs)) * 10;
  const budgets = BUDGET_OFFSETS.map((offset) => TABLE_TUNING.rules.rolls + offset).filter((value) => value > 0);

  const bands = budgets.map((rolls) => {
    const sessions: SessionResult[] = [];
    for (let run = 0; run < runs; run += 1) sessions.push(playSession(`${options.seed}:table:${run}`, rolls));
    return { rolls, sessions };
  });

  const shipped = bands.find((band) => band.rolls === TABLE_TUNING.rules.rolls) ?? (bands[0] as (typeof bands)[number]);
  const shippedWins = shipped.sessions.filter((session) => session.won);
  const shippedWinrate = shippedWins.length / shipped.sessions.length;
  const gates: GateResult[] = [];

  gates.push(
    hard(
      shippedWinrate >= MIN_WINRATE && shippedWinrate <= MAX_WINRATE,
      `win rate at the shipped ${TABLE_TUNING.rules.rolls}-roll budget = ${pct(shippedWinrate, 1)} ` +
        `(must be within [${pct(MIN_WINRATE)}, ${pct(MAX_WINRATE)}])`,
    ),
  );

  const medianRollsToWin = median(shippedWins.map((session) => session.rolls));
  gates.push(
    soft(
      medianRollsToWin <= TABLE_TUNING.rules.rolls - MAX_SPARE_ROLLS,
      `median rolls to win = ${num(medianRollsToWin, 1)} of ${TABLE_TUNING.rules.rolls} ` +
        `(must finish at least ${MAX_SPARE_ROLLS} rolls inside the budget, or every win is a photo finish)`,
    ),
  );

  // The ring is the other half of the tuning: a layout that stops handing out
  // `collect` tiles makes the budget unwinnable no matter how wide it is.
  const collectTiles = median(
    Array.from({ length: runs }, (_, run) =>
      buildRing(new Rng(`${options.seed}:table:${run}`), TABLE_TUNING.tiles).filter((tile) => tile === 'collect')
        .length,
    ),
  );
  gates.push(
    soft(
      collectTiles >= TABLE_TUNING.rules.piecesTarget - 1,
      `median 'collect' tiles per ring = ${num(collectTiles, 1)} for a ${TABLE_TUNING.rules.piecesTarget}-piece ` +
        `goal (of ${SPECIAL_TILES.length} special types on ${TABLE_TUNING.tiles} tiles)`,
    ),
  );

  const render = (): void => {
    printTable(
      ['budget', 'runs', 'win rate', 'rolls to win', 'rolls left', 'coins', 'top loss'],
      bands.map((band) => {
        const wins = band.sessions.filter((session) => session.won);
        const losses = band.sessions.filter((session) => !session.won);
        return [
          `${band.rolls}${band.rolls === TABLE_TUNING.rules.rolls ? '*' : ''}`,
          String(band.sessions.length),
          pct(wins.length / band.sessions.length, 1),
          num(median(wins.map((session) => session.rolls)), 1),
          num(median(wins.map((session) => session.rollsLeft)), 1),
          num(median(band.sessions.map((session) => session.coins)), 0),
          losses.length === 0 ? '-' : (losses[0] as SessionResult).reason,
        ];
      }),
    );
    console.log(`\n${runs} seed(s) per budget, seed '${options.seed}'; * marks the shipped budget.`);
  };

  return finishFamily(options, gates, render, {
    family: 'table',
    runs,
    shippedWinrate,
    medianRollsToWin,
    budgets: bands.map((band) => ({
      rolls: band.rolls,
      winrate: band.sessions.filter((session) => session.won).length / band.sessions.length,
      medianRollsToWin: median(band.sessions.filter((session) => session.won).map((session) => session.rolls)),
    })),
  });
}
