import type { LevelSpec } from '../../core/level';

/**
 * The board slice's level ladder. Each entry is a `LevelSpec` for
 * `LevelDirector` plus the seed that deals its starting board, so level 7 is
 * the same puzzle for every player and a retry replays it exactly.
 *
 * Goal ids ARE piece kind ids (see `tuning.ts`) — the resolver reports cleared
 * cells by kind, so a "collect 24 leaf" goal needs no extra plumbing.
 *
 * Star bands stay at the `LevelDirector` default (any win = 1, 20% of the move
 * budget left = 2, 45% = 3).
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
];

/** Namespaced `core/storage` key holding the next unplayed level index. */
export const BOARD_PROGRESS_KEY = 'board:level';
