import type { Cell } from './types';
import type { Rng } from '../rng';

/**
 * Block-fit model (family B's block variant: drop a small polyomino onto an
 * 8x8 grid, clear full rows and columns, lose when nothing in the hand fits).
 *
 * Logic only — no slice consumes it yet.
 */

export interface BlockPiece {
  id: string;
  /** Occupied offsets, normalised so the minimum col/row is 0. */
  cells: readonly Cell[];
  /** Bounding box, precomputed because placement checks it per candidate cell. */
  width: number;
  height: number;
}

function definePiece(id: string, rows: readonly string[]): BlockPiece {
  const cells: Cell[] = [];
  for (let row = 0; row < rows.length; row += 1) {
    const line = rows[row] ?? '';
    for (let col = 0; col < line.length; col += 1) {
      if (line[col] === '#') cells.push({ col, row });
    }
  }
  let width = 0;
  let height = 0;
  for (const cell of cells) {
    width = Math.max(width, cell.col + 1);
    height = Math.max(height, cell.row + 1);
  }
  return { id, cells, width, height };
}

/** The hand's piece pool: dominoes, trominoes and every tetromino. */
export const BLOCK_PIECES: readonly BlockPiece[] = [
  definePiece('dot', ['#']),
  definePiece('domino-h', ['##']),
  definePiece('domino-v', ['#', '#']),
  definePiece('tri-h', ['###']),
  definePiece('tri-v', ['#', '#', '#']),
  definePiece('corner-ne', ['##', '#.']),
  definePiece('corner-nw', ['##', '.#']),
  definePiece('corner-se', ['#.', '##']),
  definePiece('corner-sw', ['.#', '##']),
  definePiece('square', ['##', '##']),
  definePiece('line-h4', ['####']),
  definePiece('line-v4', ['#', '#', '#', '#']),
  definePiece('tee', ['###', '.#.']),
  definePiece('ell', ['#..', '###']),
  definePiece('jay', ['..#', '###']),
  definePiece('ess', ['.##', '##.']),
  definePiece('zed', ['##.', '.##']),
];

export class BlockGrid {
  readonly cols: number;
  readonly rows: number;

  private readonly filledArr: boolean[];

  constructor(cols = 8, rows = 8) {
    this.cols = cols;
    this.rows = rows;
    this.filledArr = new Array<boolean>(cols * rows).fill(false);
  }

  isFilled(cell: Cell): boolean {
    if (cell.col < 0 || cell.col >= this.cols || cell.row < 0 || cell.row >= this.rows) return true;
    return this.filledArr[cell.row * this.cols + cell.col] === true;
  }

  get occupancy(): number {
    let n = 0;
    for (const filled of this.filledArr) if (filled) n += 1;
    return n;
  }

  /** Can `piece` sit with its (0,0) offset on `at`? */
  canPlace(piece: BlockPiece, at: Cell): boolean {
    if (at.col < 0 || at.row < 0) return false;
    if (at.col + piece.width > this.cols || at.row + piece.height > this.rows) return false;
    for (const offset of piece.cells) {
      if (this.filledArr[(at.row + offset.row) * this.cols + at.col + offset.col] === true) return false;
    }
    return true;
  }

  /** Places the piece; returns false (and changes nothing) when it does not fit. */
  place(piece: BlockPiece, at: Cell): boolean {
    if (!this.canPlace(piece, at)) return false;
    for (const offset of piece.cells) {
      this.filledArr[(at.row + offset.row) * this.cols + at.col + offset.col] = true;
    }
    return true;
  }

  /**
   * Clears every full row and column simultaneously (a cell shared by a full
   * row and a full column is cleared once) and returns the number of lines
   * cleared — the score multiplier in this genre.
   */
  clearFullLines(): number {
    const fullRows: number[] = [];
    const fullCols: number[] = [];
    for (let row = 0; row < this.rows; row += 1) {
      let full = true;
      for (let col = 0; col < this.cols; col += 1) {
        if (this.filledArr[row * this.cols + col] !== true) {
          full = false;
          break;
        }
      }
      if (full) fullRows.push(row);
    }
    for (let col = 0; col < this.cols; col += 1) {
      let full = true;
      for (let row = 0; row < this.rows; row += 1) {
        if (this.filledArr[row * this.cols + col] !== true) {
          full = false;
          break;
        }
      }
      if (full) fullCols.push(col);
    }
    for (const row of fullRows) {
      for (let col = 0; col < this.cols; col += 1) this.filledArr[row * this.cols + col] = false;
    }
    for (const col of fullCols) {
      for (let row = 0; row < this.rows; row += 1) this.filledArr[row * this.cols + col] = false;
    }
    return fullRows.length + fullCols.length;
  }

  /** Topmost-leftmost legal spot for `piece`, or `null` when it does not fit. */
  firstFit(piece: BlockPiece): Cell | null {
    for (let row = 0; row + piece.height <= this.rows; row += 1) {
      for (let col = 0; col + piece.width <= this.cols; col += 1) {
        const at = { col, row };
        if (this.canPlace(piece, at)) return at;
      }
    }
    return null;
  }

  /** All cells `piece` can legally occupy — the ghost-preview candidate list. */
  placements(piece: BlockPiece): Cell[] {
    const spots: Cell[] = [];
    for (let row = 0; row + piece.height <= this.rows; row += 1) {
      for (let col = 0; col + piece.width <= this.cols; col += 1) {
        const at = { col, row };
        if (this.canPlace(piece, at)) spots.push(at);
      }
    }
    return spots;
  }

  /** Game-over test: does ANY piece still in hand fit anywhere? */
  anyFits(pieces: readonly BlockPiece[]): boolean {
    for (const piece of pieces) if (this.firstFit(piece) !== null) return true;
    return false;
  }

  /** Pre-filled obstacle cells for a level layout, and the selftest's setup. */
  setFilled(cell: Cell, filled = true): void {
    if (cell.col < 0 || cell.col >= this.cols || cell.row < 0 || cell.row >= this.rows) return;
    this.filledArr[cell.row * this.cols + cell.col] = filled;
  }

  clone(): BlockGrid {
    const copy = new BlockGrid(this.cols, this.rows);
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        if (this.filledArr[row * this.cols + col] === true) copy.setFilled({ col, row });
      }
    }
    return copy;
  }
}

/** Seeded hand of `count` pieces drawn from the pool (with replacement). */
export function drawPieceBag(rng: Rng, count = 3, pool: readonly BlockPiece[] = BLOCK_PIECES): BlockPiece[] {
  const hand: BlockPiece[] = [];
  for (let i = 0; i < count; i += 1) hand.push(rng.pick(pool));
  return hand;
}
