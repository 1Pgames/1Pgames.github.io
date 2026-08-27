/**
 * Board-family vocabulary (family B: match-swap, blast, merge, sort, block-fit).
 *
 * One engine, data-driven: a slice supplies a `BoardSpec` (dimensions + the
 * piece kinds it draws) and the resolver returns a replayable list of
 * `CascadeStep`s. Nothing here knows about pixels, tweens or Phaser — the
 * headless sim ticks the exact same code the scene animates.
 */

/** Piece identity as the slice's own id (a kind is also a goal id). */
export type PieceKind = string;

/** Board coordinate. Column grows right, row grows DOWN (gravity direction). */
export interface Cell {
  col: number;
  row: number;
}

/**
 * Special payloads earned by oversized matches:
 *  - `line-h` clears its whole row, `line-v` its whole column,
 *  - `bomb` clears the 3x3 block around itself.
 */
export type SpecialKind = 'line-h' | 'line-v' | 'bomb';

export interface Piece {
  kind: PieceKind;
  /** `null`/absent for a plain piece. */
  special?: SpecialKind | null;
}

export interface BoardSpec {
  cols: number;
  rows: number;
  /** The kinds the seeded fill and every refill draw from. */
  kinds: readonly PieceKind[];
  /** Permanently empty holes: never filled, and pieces cannot fall through them. */
  blocked?: readonly Cell[];
}

/**
 * One resolved match group. `cells` is every cell of the group (including the
 * cell that survives as a freshly created special), `kind` the matched kind,
 * `special` the payload the group earned and `specialAt` where it lands.
 */
export interface MatchEvent {
  cells: readonly Cell[];
  kind: PieceKind;
  special?: SpecialKind | null;
  specialAt?: Cell;
  /** Longest horizontal run in the group (shape info for FX). */
  runH?: number;
  /** Longest vertical run in the group. */
  runV?: number;
}

/** A cell actually emptied this step — the goal-counting source of truth. */
export interface ClearedCell {
  cell: Cell;
  kind: PieceKind;
  /** The special that was destroyed there, if any (it detonated). */
  special: SpecialKind | null;
}

/** A surviving piece sliding down its column. */
export interface FallEvent {
  from: Cell;
  to: Cell;
}

/** A new piece spawned at the top of a column. */
export interface RefillEvent {
  cell: Cell;
  piece: Piece;
}

/** One match -> clear -> fall -> refill beat of a cascade. */
export interface CascadeStep {
  matches: readonly MatchEvent[];
  /** Every cell emptied by this step, matches and detonation fallout alike. */
  cleared: readonly ClearedCell[];
  /** Specials created by this step (they survive inside `cleared`'s group). */
  created: readonly { cell: Cell; kind: PieceKind; special: SpecialKind }[];
  falls: readonly FallEvent[];
  refills: readonly RefillEvent[];
}

export interface Swap {
  a: Cell;
  b: Cell;
}

export function cellKey(cell: Cell): number {
  return cell.row * 1024 + cell.col;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.col === b.col && a.row === b.row;
}

/** Orthogonally adjacent — the only legal swap distance. */
export function areAdjacent(a: Cell, b: Cell): boolean {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
}
