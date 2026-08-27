/**
 * Pure cell-space math for `systems/board.ts`'s drag-drop grid, split into
 * its own file so it can be imported and unit-tested headlessly (by
 * `sim/kits/boardmath.selftest.ts`) without pulling in the Phaser runtime,
 * which throws on load outside a browser (`window is not defined`).
 *
 * No Phaser import, ever — that is this file's entire reason to exist. Add
 * new board geometry helpers here, not in `board.ts`, as long as they need
 * no `Phaser.*` value.
 */

export interface BoardCell {
  col: number;
  row: number;
}

export interface BoardGeometry {
  cols: number;
  rows: number;
  cellPx: number;
  origin: { x: number; y: number };
}

/** Maps a world position to the (possibly out-of-range) cell it falls in. */
export function pointerToCell(geometry: BoardGeometry, x: number, y: number): BoardCell {
  return {
    col: Math.floor((x - geometry.origin.x) / geometry.cellPx),
    row: Math.floor((y - geometry.origin.y) / geometry.cellPx),
  };
}

/** World position of a cell's center. */
export function cellToXY(geometry: BoardGeometry, cell: BoardCell): { x: number; y: number } {
  return {
    x: geometry.origin.x + cell.col * geometry.cellPx + geometry.cellPx / 2,
    y: geometry.origin.y + cell.row * geometry.cellPx + geometry.cellPx / 2,
  };
}

/** True when `cell` is inside the board's bounds. */
export function validDrop(geometry: BoardGeometry, cell: BoardCell): boolean {
  return cell.col >= 0 && cell.col < geometry.cols && cell.row >= 0 && cell.row < geometry.rows;
}
