import type { LevelSpec } from '../../core/level';

/**
 * The board slice's level ladder. Each entry is a `LevelSpec` for
 * `LevelDirector` plus the seed that deals its starting board, so level 7 is
 * the same puzzle for every player and a retry replays it exactly.
 *
 * Goal ids ARE piece kind ids (see `tuning.ts`) — the resolver reports cleared
 * cells by kind, so a "collect 24 leaf" goal needs no extra plumbing.
 *
 * SHAPE. b-01..b-03 teach (one or two goals, a fat 24-move budget). b-04..b-10
 * widen the goal set and shave the budget. b-11..b-12 are the TOP END, and
 * they exist because the family gate measures one: with the ladder ending at
 * b-10 the greedy solver cleared every level of it 100% of the time, so the
 * ladder had a floor and no ceiling — nothing in it could ever be lost by a
 * player who reads the board, and there was no level worth retrying. The last
 * two ask for 4 and 5 colours at once on a 10-move budget, which is close to
 * the ~10 goal-cells-per-move a good cascade actually pays, and the solver
 * lands around 70% on them (see `sim/families/board.ts`).
 *
 * Star bands stay at the `LevelDirector` default (any win = 1, 20% of the move
 * budget left = 2, 45% = 3), so 3-starring b-11/b-12 is a real ask: they are
 * won with 2-3 moves to spare, which is 1-2 stars.
 */
export interface BoardLevel {
  spec: LevelSpec;
  /** Seeds the starting deal; the run seed is mixed in for daily variety. */
  seed: string;
}

export const BOARD_LEVELS: readonly BoardLevel[] = [
  { spec: { id: 'b-01', goals: [{ id: 'ember', target: 16 }], moves: 24 }, seed: 'board-01' },
  { spec: { id: 'b-02', goals: [{ id: 'leaf', target: 20 }], moves: 24 }, seed: 'board-02' },
  {
    spec: { id: 'b-03', goals: [{ id: 'ember', target: 17 }, { id: 'leaf', target: 17 }], moves: 24 },
    seed: 'board-03',
  },
  { spec: { id: 'b-04', goals: [{ id: 'spark', target: 24 }], moves: 25 }, seed: 'board-04' },
  {
    spec: { id: 'b-05', goals: [{ id: 'leaf', target: 22 }, { id: 'tide', target: 22 }], moves: 24 },
    seed: 'board-05',
  },
  {
    spec: { id: 'b-06', goals: [{ id: 'ember', target: 24 }, { id: 'spark', target: 24 }], moves: 23 },
    seed: 'board-06',
  },
  { spec: { id: 'b-07', goals: [{ id: 'bloom', target: 28 }], moves: 22 }, seed: 'board-07' },
  {
    spec: {
      id: 'b-08',
      goals: [{ id: 'ember', target: 20 }, { id: 'leaf', target: 20 }, { id: 'tide', target: 20 }],
      moves: 21,
    },
    seed: 'board-08',
  },
  {
    spec: { id: 'b-09', goals: [{ id: 'spark', target: 28 }, { id: 'bloom', target: 28 }], moves: 19 },
    seed: 'board-09',
  },
  {
    spec: {
      id: 'b-10',
      goals: [{ id: 'ember', target: 24 }, { id: 'leaf', target: 24 }, { id: 'spark', target: 24 }],
      moves: 18,
    },
    seed: 'board-10',
  },
  {
    spec: {
      id: 'b-11',
      goals: [
        { id: 'ember', target: 24 },
        { id: 'leaf', target: 24 },
        { id: 'spark', target: 24 },
        { id: 'tide', target: 24 },
      ],
      moves: 10,
    },
    seed: 'board-11',
  },
  {
    spec: {
      id: 'b-12',
      goals: [
        { id: 'ember', target: 21 },
        { id: 'leaf', target: 21 },
        { id: 'spark', target: 21 },
        { id: 'tide', target: 21 },
        { id: 'bloom', target: 21 },
      ],
      moves: 10,
    },
    seed: 'board-12',
  },
];

/** Namespaced `core/storage` key holding the next unplayed level index. */
export const BOARD_PROGRESS_KEY = 'board:level';

/**
 * Index of the level actually being played, written the moment a level starts.
 *
 * `GameOverScene` hands RETRY nothing but the run seed, so without this the
 * retry of a WON level would re-read `BOARD_PROGRESS_KEY` — which the win just
 * advanced — and silently start the next level instead of replaying the one the
 * player asked for.
 */
export const BOARD_LAST_LEVEL_KEY = 'board:last';

/** Clamps any stored/derived index into the ladder. */
export function clampBoardLevel(index: number): number {
  return Math.max(0, Math.min(BOARD_LEVELS.length - 1, Math.floor(index)));
}
