import type { PieceKind } from './types';
import type { Rng } from '../rng';

/**
 * Container-sort model (family B's sort variant: pour coloured units between
 * tubes until every tube holds one colour).
 *
 * Logic only — no slice consumes it yet. It ships with a bounded solver so a
 * future slice can *prove* a generated level is solvable instead of hoping,
 * and so the selftest can assert solvability without a hand-written script.
 */

export interface SortSpec {
  /** Units per tube. */
  capacity: number;
  /** Tube contents, index 0 = bottom of the tube. */
  tubes: readonly (readonly PieceKind[])[];
}

export interface Pour {
  from: number;
  to: number;
}

export class SortPuzzle {
  readonly capacity: number;
  readonly tubes: PieceKind[][];

  constructor(spec: SortSpec) {
    if (spec.capacity < 1) throw new Error('SortPuzzle: capacity must be >= 1');
    this.capacity = spec.capacity;
    this.tubes = spec.tubes.map((tube) => {
      if (tube.length > spec.capacity) throw new Error('SortPuzzle: tube over capacity');
      return tube.slice();
    });
  }

  /** Top unit of a tube, or `null` when empty. */
  topOf(index: number): PieceKind | null {
    const tube = this.tubes[index];
    if (tube === undefined || tube.length === 0) return null;
    return tube[tube.length - 1] as PieceKind;
  }

  /** How many identical units sit on top of a tube — a pour moves them together. */
  runOnTop(index: number): number {
    const tube = this.tubes[index];
    if (tube === undefined || tube.length === 0) return 0;
    const top = tube[tube.length - 1] as PieceKind;
    let run = 1;
    while (run < tube.length && tube[tube.length - 1 - run] === top) run += 1;
    return run;
  }

  /**
   * Units that would actually move from `from` to `to`: 0 means the pour is
   * illegal. Legal when the source has units, the destination has room and is
   * either empty or topped by the same colour — and pouring a uniform tube
   * into an empty one is rejected as a pointless shuffle.
   */
  pourAmount(from: number, to: number): number {
    if (from === to) return 0;
    const source = this.tubes[from];
    const target = this.tubes[to];
    if (source === undefined || target === undefined) return 0;
    if (source.length === 0 || target.length >= this.capacity) return 0;
    const top = source[source.length - 1] as PieceKind;
    const targetTop = this.topOf(to);
    if (targetTop !== null && targetTop !== top) return 0;
    if (targetTop === null && this.runOnTop(from) === source.length) return 0;
    return Math.min(this.runOnTop(from), this.capacity - target.length);
  }

  /** Applies a pour; returns the number of units moved (0 = rejected). */
  pour(from: number, to: number): number {
    const amount = this.pourAmount(from, to);
    if (amount === 0) return 0;
    const source = this.tubes[from] as PieceKind[];
    const target = this.tubes[to] as PieceKind[];
    for (let i = 0; i < amount; i += 1) target.push(source.pop() as PieceKind);
    return amount;
  }

  validPours(): Pour[] {
    const pours: Pour[] = [];
    for (let from = 0; from < this.tubes.length; from += 1) {
      for (let to = 0; to < this.tubes.length; to += 1) {
        if (this.pourAmount(from, to) > 0) pours.push({ from, to });
      }
    }
    return pours;
  }

  /** Solved when every non-empty tube is uniform and no colour is split. */
  get isSolved(): boolean {
    const homes = new Set<PieceKind>();
    for (const tube of this.tubes) {
      if (tube.length === 0) continue;
      const colour = tube[0] as PieceKind;
      for (const unit of tube) if (unit !== colour) return false;
      if (homes.has(colour)) return false;
      homes.add(colour);
    }
    return true;
  }

  /** Canonical string of the state, tube order ignored — the solver's visited key. */
  signature(): string {
    return this.tubes
      .map((tube) => tube.join(','))
      .sort()
      .join('|');
  }

  clone(): SortPuzzle {
    return new SortPuzzle({ capacity: this.capacity, tubes: this.tubes });
  }
}

/**
 * Depth-first search for a winning pour sequence, bounded by `maxNodes` so a
 * level check can never hang. Returns the pours to play, or `null` when no
 * solution was found inside the budget.
 */
export function solveSort(puzzle: SortPuzzle, maxNodes = 20000): Pour[] | null {
  const visited = new Set<string>();
  const path: Pour[] = [];
  let nodes = 0;

  const walk = (state: SortPuzzle): boolean => {
    if (state.isSolved) return true;
    nodes += 1;
    if (nodes > maxNodes) return false;
    const signature = state.signature();
    if (visited.has(signature)) return false;
    visited.add(signature);
    for (const pour of state.validPours()) {
      const next = state.clone();
      next.pour(pour.from, pour.to);
      path.push(pour);
      if (walk(next)) return true;
      path.pop();
    }
    return false;
  };

  return walk(puzzle.clone()) ? path.slice() : null;
}

/**
 * Deals a seeded puzzle: `colours.length` full tubes of units shuffled across
 * the coloured tubes plus `spareTubes` empty ones. Retries until the bounded
 * solver proves the deal winnable, so a generated level is always beatable.
 */
export function dealSortPuzzle(
  colours: readonly PieceKind[],
  capacity: number,
  spareTubes: number,
  rng: Rng,
  attempts = 24,
): SortPuzzle {
  const bag: PieceKind[] = [];
  for (const colour of colours) for (let i = 0; i < capacity; i += 1) bag.push(colour);

  let fallback: SortPuzzle | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    rng.shuffle(bag);
    const tubes: PieceKind[][] = [];
    for (let index = 0; index < colours.length; index += 1) {
      tubes.push(bag.slice(index * capacity, (index + 1) * capacity));
    }
    for (let index = 0; index < spareTubes; index += 1) tubes.push([]);
    const puzzle = new SortPuzzle({ capacity, tubes });
    if (puzzle.isSolved) continue;
    fallback = puzzle;
    if (solveSort(puzzle) !== null) return puzzle;
  }
  if (fallback === null) throw new Error('dealSortPuzzle: could not deal a puzzle');
  return fallback;
}
