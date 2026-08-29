import type { Board } from './grid';
import { detonationCells, findRuns, findValidMoves, resolveCascades } from './resolve';
import type { CascadeStep, Cell, FallEvent, Piece } from './types';
import { isMovable } from './types';
import type { Rng } from '../rng';

/**
 * IN-LEVEL boosters: the four the player spends while the board is live, as
 * opposed to the pre-level ones the picker spends before the first move
 * (`slices/board/tuning.ts`'s `boosters`).
 *
 * All four are FREE in move budget on purpose. A booster that also costs a
 * move is a booster the player has to do arithmetic about, and the fantasy is
 * the opposite: the witch reaches into the cauldron and fixes it. The cost is
 * the consumable itself, bought in the shop with coins earned from stars.
 *
 * Three of them are expressed as an ordinary detonation handed to
 * `resolveCascades`, so a booster produces the exact same `CascadeStep[]` a
 * move does — one animation path, one goal-counting path, one cascade cap, and
 * no second implementation of gravity or refill to drift out of sync. The
 * whisk is the exception and says why in its own comment.
 */

export type InLevelBoosterId = 'ladle' | 'broom' | 'pestle' | 'whisk';

export type InLevelBoosterAction =
  /** Scoop one cell out, whatever is in it. */
  | { id: 'ladle'; cell: Cell }
  /** Sweep one whole row. */
  | { id: 'broom'; row: number }
  /** Grind one whole column. */
  | { id: 'pestle'; col: number }
  /** Stir the free pieces into a new arrangement. */
  | { id: 'whisk' };

/**
 * How many permutations the whisk may try before it settles for one that
 * happens to match immediately. High enough that a normal board finds a clean
 * arrangement on the first or second try, low enough to stay a fixed cost.
 */
const WHISK_ATTEMPTS = 20;

/**
 * Applies a booster and returns the cascade it started, or an empty list when
 * the action could not do anything (an out-of-bounds row, an already-empty
 * cell, a whisk with nothing to stir). An empty result means NOTHING happened
 * to the board, so the caller can refund the charge instead of animating a
 * no-op.
 *
 * The ladle is the only path in the game that ignores a blocker's hit points:
 * it empties its target outright — a 2-hp jar, a vined piece and the vine with
 * it. The broom and the pestle are deliberately weaker: they are `line-h` and
 * `line-v` detonations, so the jars in their lane take one point of damage
 * like any other adjacent clear.
 */
export function applyInLevelBooster(
  board: Board,
  action: InLevelBoosterAction,
  rng: Rng,
): CascadeStep[] {
  if (action.id === 'ladle') {
    const { cell } = action;
    if (board.isBlocked(cell) || board.get(cell) === null) return [];
    return resolveCascades(board, rng, {
      origin: cell,
      detonate: [cell],
      force: [cell],
    });
  }

  if (action.id === 'whisk') return applyWhisk(board, rng);

  if (action.id === 'pestle') {
    const col = Math.floor(action.col);
    if (col < 0 || col >= board.cols) return [];
    const cells = detonationCells(board, { col, row: 0 }, 'line-v');
    if (cells.length === 0) return [];
    return resolveCascades(board, rng, { detonate: cells });
  }

  const row = Math.floor(action.row);
  if (row < 0 || row >= board.rows) return [];
  const cells = detonationCells(board, { col: 0, row }, 'line-h');
  if (cells.length === 0) return [];
  return resolveCascades(board, rng, { detonate: cells });
}

/**
 * The whisk: re-arranges the pieces already on the board instead of clearing
 * anything, so a stuck board becomes a playable one without spending the
 * player's goals.
 *
 * It is a PERMUTATION, not a re-deal: `reshuffle` (the dead-board fallback)
 * re-draws kinds and would move a vined piece's ingredient out from under its
 * vine. The whisk moves whole pieces — specials included, since a special the
 * player earned must survive being stirred — and only the FREE ones. Jars are
 * furniture and vined pieces are rooted (`isMovable`), so both keep their
 * cells and the level's layout is untouched.
 *
 * The result always has at least one legal move; it prefers an arrangement
 * with no immediate match, because a whisk that instantly cascades reads as
 * the booster taking the player's turn for them. After `WHISK_ATTEMPTS` tries
 * a matching arrangement is accepted, and the cascade it causes is appended as
 * ordinary steps.
 *
 * The permutation itself is reported as the first step's `falls` (from -> to),
 * which is exactly the vocabulary the renderer already tweens — the only
 * `FallEvent`s in the game that are not vertical.
 */
function applyWhisk(board: Board, rng: Rng): CascadeStep[] {
  const cells: Cell[] = [];
  const pieces: Piece[] = [];
  board.forEachCell((cell, piece) => {
    if (!isMovable(piece)) return;
    cells.push({ col: cell.col, row: cell.row });
    pieces.push(piece as Piece);
  });
  if (cells.length < 2) return [];

  // `order[i]` is the index of the piece that ends up at `cells[i]`.
  const order: number[] = cells.map((_, index) => index);
  const identity = order.slice();
  const place = (from: readonly number[]): void => {
    for (let i = 0; i < cells.length; i += 1) board.set(cells[i] as Cell, pieces[from[i] as number] as Piece);
  };

  let chosen: number[] | null = null;
  for (let attempt = 0; attempt < WHISK_ATTEMPTS; attempt += 1) {
    rng.shuffle(order);
    // A permutation that moves nothing is a spent booster the player cannot
    // see, whatever else is true about it.
    if (order.every((source, target) => source === target)) continue;
    place(order);
    if (findValidMoves(board).length === 0) continue;
    if (findRuns(board).length === 0) {
      chosen = order.slice();
      break;
    }
    // Playable but pre-matched: keep it as the fallback and keep looking.
    if (chosen === null) chosen = order.slice();
  }

  // Either commit the winner or put every piece back exactly where it was.
  place(chosen ?? identity);
  if (chosen === null) return [];

  const falls: FallEvent[] = [];
  for (let i = 0; i < cells.length; i += 1) {
    const source = chosen[i] as number;
    if (source === i) continue;
    falls.push({ from: cells[source] as Cell, to: cells[i] as Cell });
  }

  const steps: CascadeStep[] = [
    { matches: [], cleared: [], created: [], blockerHits: [], falls, refills: [] },
  ];
  // Only reachable when all 20 tries matched; the stir then cascades like a move.
  if (findRuns(board).length > 0) steps.push(...resolveCascades(board, rng));
  return steps;
}
