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

/**
 * Level furniture that sits ON a cell and has to be destroyed by playing
 * NEAR it — the difficulty axis a match-3 ladder needs once the player can
 * read the board (PRD §2B).
 *
 *  - `jar`: a cell-shaped obstacle. It is not a piece the player can move or
 *    match; it is a wall with hit points. Damaged by clearing an
 *    orthogonally adjacent cell.
 *  - `vine`: a normal piece held in place. It matches as its own kind, but
 *    the vine eats the first clear that would take it: the piece survives
 *    free instead of scoring.
 */
export type BlockerKind = 'jar' | 'vine';

export interface Blocker {
  kind: BlockerKind;
  hp: number;
}

/**
 * Pseudo piece kind of a jar. Never in `BoardSpec.kinds`, so it is never
 * refilled and never drawn by the seeded fill; never matchable, because no
 * other cell can ever hold it.
 */
export const JAR_KIND = '__jar__';

export interface Piece {
  kind: PieceKind;
  /** `null`/absent for a plain piece. */
  special?: SpecialKind | null;
  /** `null`/absent for an unencumbered piece. */
  blocker?: Blocker | null;
}

export interface BoardSpec {
  cols: number;
  rows: number;
  /** The kinds the seeded fill and every refill draw from. */
  kinds: readonly PieceKind[];
  /** Permanently empty holes: never filled, and pieces cannot fall through them. */
  blocked?: readonly Cell[];
  /** Jar obstacles placed by the level, with their starting hit points. */
  jars?: readonly { cell: Cell; hp: 1 | 2 }[];
  /** Cells whose seeded piece starts vined. */
  vines?: readonly Cell[];
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

/**
 * A blocker that took damage this step. `broken` means it is GONE: a jar's
 * cell emptied (and is also in `cleared`, with kind `JAR_KIND`), or a vine
 * released its piece.
 */
export interface BlockerHit {
  cell: Cell;
  kind: BlockerKind;
  broken: boolean;
}

/** One match -> clear -> fall -> refill beat of a cascade. */
export interface CascadeStep {
  matches: readonly MatchEvent[];
  /**
   * Every cell emptied by this step, matches and detonation fallout alike.
   * The goal-counting source of truth: a vine that absorbed a match is NOT
   * here (its piece survived), a broken jar IS, under `JAR_KIND`.
   */
  cleared: readonly ClearedCell[];
  /** Specials created by this step (they survive inside `cleared`'s group). */
  created: readonly { cell: Cell; kind: PieceKind; special: SpecialKind }[];
  /** Blockers damaged or destroyed this step. Always present, often empty. */
  blockerHits: readonly BlockerHit[];
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

/** A jar occupies its cell but is not a piece: nothing about it is playable. */
export function isJar(piece: Piece | null): boolean {
  return piece !== null && piece.kind === JAR_KIND;
}

/** A vined piece matches as its own kind but cannot be moved. */
export function isVined(piece: Piece | null): boolean {
  return piece !== null && (piece.blocker?.kind ?? null) === 'vine';
}

/**
 * Can the player pick this cell up? Jars are furniture and vines are rooted,
 * so neither is ever a swap endpoint — the single rule both the input layer
 * and `findValidMoves` read.
 */
export function isMovable(piece: Piece | null): boolean {
  return piece !== null && !isJar(piece) && !isVined(piece);
}
