import type { BoardSpec, Cell, Piece, PieceKind } from './types';
import { Rng } from '../rng';

/**
 * The board itself: a flat row-major array of pieces with permanent holes.
 *
 * Pure TypeScript with an injected `Rng`, so the same seed always produces the
 * same starting board in the browser, in the sim and in the selftest. Row 0 is
 * the TOP row; gravity moves pieces toward increasing `row`.
 */
export class Board {
  readonly cols: number;
  readonly rows: number;
  readonly kinds: readonly PieceKind[];

  private readonly cellsArr: (Piece | null)[];
  private readonly blockedArr: boolean[];

  constructor(spec: BoardSpec, rng: Rng) {
    if (spec.cols < 1 || spec.rows < 1) throw new Error('Board: cols/rows must be >= 1');
    if (spec.kinds.length < 3) throw new Error('Board: needs at least 3 kinds for match-3');
    this.cols = spec.cols;
    this.rows = spec.rows;
    this.kinds = spec.kinds.slice();
    const size = spec.cols * spec.rows;
    this.cellsArr = new Array<Piece | null>(size).fill(null);
    this.blockedArr = new Array<boolean>(size).fill(false);
    for (const hole of spec.blocked ?? []) {
      if (this.inBounds(hole)) this.blockedArr[hole.row * this.cols + hole.col] = true;
    }
    this.fill(rng);
  }

  /**
   * Builds a board from a literal picture — `'.'` marks a permanent hole and
   * `' '` an empty playable cell. Used by levels with fixed layouts and by the
   * selftest to construct exact match/detonation/dead-board situations.
   */
  static fromRows(rows: readonly string[], kindOf: Readonly<Record<string, PieceKind>>): Board {
    const height = rows.length;
    const width = rows[0]?.length ?? 0;
    if (height === 0 || width === 0) throw new Error('Board.fromRows: empty picture');
    const kinds = Array.from(new Set(Object.values(kindOf)));
    const blocked: Cell[] = [];
    for (let row = 0; row < height; row += 1) {
      const line = rows[row] ?? '';
      if (line.length !== width) throw new Error('Board.fromRows: ragged picture');
      for (let col = 0; col < width; col += 1) {
        if (line[col] === '.') blocked.push({ col, row });
      }
    }
    // The seeded fill is thrown away immediately; the picture is authoritative.
    const board = new Board({ cols: width, rows: height, kinds, blocked }, new Rng(1));
    for (let row = 0; row < height; row += 1) {
      const line = rows[row] ?? '';
      for (let col = 0; col < width; col += 1) {
        const glyph = line[col] ?? ' ';
        if (glyph === '.') continue;
        const kind = kindOf[glyph];
        board.set({ col, row }, kind === undefined ? null : { kind, special: null });
      }
    }
    return board;
  }

  inBounds(cell: Cell): boolean {
    return cell.col >= 0 && cell.col < this.cols && cell.row >= 0 && cell.row < this.rows;
  }

  isBlocked(cell: Cell): boolean {
    return !this.inBounds(cell) || this.blockedArr[cell.row * this.cols + cell.col] === true;
  }

  /** `null` for an empty or blocked cell. */
  get(cell: Cell): Piece | null {
    if (!this.inBounds(cell)) return null;
    return this.cellsArr[cell.row * this.cols + cell.col] ?? null;
  }

  set(cell: Cell, piece: Piece | null): void {
    if (!this.inBounds(cell) || this.isBlocked(cell)) return;
    this.cellsArr[cell.row * this.cols + cell.col] = piece;
  }

  kindAt(cell: Cell): PieceKind | null {
    return this.get(cell)?.kind ?? null;
  }

  swap(a: Cell, b: Cell): void {
    if (this.isBlocked(a) || this.isBlocked(b)) return;
    const ai = a.row * this.cols + a.col;
    const bi = b.row * this.cols + b.col;
    const tmp = this.cellsArr[ai] ?? null;
    this.cellsArr[ai] = this.cellsArr[bi] ?? null;
    this.cellsArr[bi] = tmp;
  }

  /** Every playable cell, top-left to bottom-right. */
  forEachCell(visit: (cell: Cell, piece: Piece | null) => void): void {
    const cell = { col: 0, row: 0 };
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        if (this.blockedArr[row * this.cols + col] === true) continue;
        cell.col = col;
        cell.row = row;
        visit(cell, this.cellsArr[row * this.cols + col] ?? null);
      }
    }
  }

  /** Playable cells that currently hold a piece. */
  get filledCount(): number {
    let n = 0;
    for (const piece of this.cellsArr) if (piece !== null) n += 1;
    return n;
  }

  /** Playable (non-blocked) cell count — the target `filledCount` at rest. */
  get playableCount(): number {
    let n = 0;
    for (const blocked of this.blockedArr) if (!blocked) n += 1;
    return n;
  }

  /**
   * Seeds every playable cell, rerolling any kind that would complete a run of
   * three with the two cells already written to its left or above — so a fresh
   * board never resolves before the player's first move.
   */
  fill(rng: Rng): void {
    const probe = { col: 0, row: 0 };
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        const index = row * this.cols + col;
        if (this.blockedArr[index] === true) {
          this.cellsArr[index] = null;
          continue;
        }
        const candidates = rng.shuffle(this.kinds.slice());
        let chosen = candidates[0] as PieceKind;
        for (const kind of candidates) {
          probe.col = col;
          probe.row = row;
          if (!this.completesTriple(probe, kind)) {
            chosen = kind;
            break;
          }
        }
        this.cellsArr[index] = { kind: chosen, special: null };
      }
    }
  }

  /**
   * True when placing `kind` at `cell` would give it two same-kind neighbours
   * in a row on either axis (the fill-time and reshuffle-time match guard).
   */
  completesTriple(cell: Cell, kind: PieceKind): boolean {
    return this.runThrough(cell, kind, 1, 0) >= 3 || this.runThrough(cell, kind, 0, 1) >= 3;
  }

  /**
   * Length of the same-kind run through `cell` along one axis, counting `cell`
   * itself as holding `kind`. Blocked/empty cells break the run.
   */
  runThrough(cell: Cell, kind: PieceKind, dCol: number, dRow: number): number {
    let length = 1;
    for (const sign of [-1, 1]) {
      let col = cell.col + dCol * sign;
      let row = cell.row + dRow * sign;
      while (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
        const piece = this.cellsArr[row * this.cols + col] ?? null;
        if (piece === null || piece.kind !== kind) break;
        length += 1;
        col += dCol * sign;
        row += dRow * sign;
      }
    }
    return length;
  }

  /** Independent copy, holes included — used by move search and the solver. */
  clone(): Board {
    const blocked: Cell[] = [];
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        if (this.blockedArr[row * this.cols + col] === true) blocked.push({ col, row });
      }
    }
    const copy = new Board({ cols: this.cols, rows: this.rows, kinds: this.kinds, blocked }, new Rng(1));
    for (let i = 0; i < this.cellsArr.length; i += 1) {
      const piece = this.cellsArr[i] ?? null;
      copy.cellsArr[i] = piece === null ? null : { ...piece };
    }
    return copy;
  }

  /** Debug/selftest picture: one string per row, `.` for holes, `_` for empty. */
  toRows(glyphOf: Readonly<Record<PieceKind, string>>): string[] {
    const out: string[] = [];
    for (let row = 0; row < this.rows; row += 1) {
      let line = '';
      for (let col = 0; col < this.cols; col += 1) {
        const index = row * this.cols + col;
        if (this.blockedArr[index] === true) line += '.';
        else {
          const piece = this.cellsArr[index] ?? null;
          line += piece === null ? '_' : (glyphOf[piece.kind] ?? '?');
        }
      }
      out.push(line);
    }
    return out;
  }
}
