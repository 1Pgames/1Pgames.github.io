// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/boardmath.selftest.ts
import assert from 'node:assert/strict';
import { pointerToCell, cellToXY, validDrop } from '../../systems/boardMath';
import type { BoardGeometry } from '../../systems/boardMath';

const geometry: BoardGeometry = { cols: 4, rows: 3, cellPx: 80, origin: { x: 100, y: 200 } };

// --- pointerToCell: origin-relative flooring, including negative-offset (before-origin) positions ---
{
  assert.deepEqual(pointerToCell(geometry, 100, 200), { col: 0, row: 0 }, 'exactly at origin is cell (0,0)');
  assert.deepEqual(pointerToCell(geometry, 179, 279), { col: 0, row: 0 }, 'just inside the last pixel of cell (0,0)');
  assert.deepEqual(pointerToCell(geometry, 180, 280), { col: 1, row: 1 }, 'exactly at the next cell boundary');
  assert.deepEqual(pointerToCell(geometry, 419, 439), { col: 3, row: 2 }, 'last valid cell, near its far edge');
  assert.deepEqual(pointerToCell(geometry, 99, 199), { col: -1, row: -1 }, 'one pixel before origin floors to -1, not 0');
}

// --- cellToXY: returns the pixel center, and round-trips through pointerToCell for in-bounds cells ---
{
  assert.deepEqual(cellToXY(geometry, { col: 0, row: 0 }), { x: 140, y: 240 });
  assert.deepEqual(cellToXY(geometry, { col: 3, row: 2 }), { x: 380, y: 400 });

  for (let row = 0; row < geometry.rows; row += 1) {
    for (let col = 0; col < geometry.cols; col += 1) {
      const center = cellToXY(geometry, { col, row });
      assert.deepEqual(
        pointerToCell(geometry, center.x, center.y),
        { col, row },
        `cell (${col},${row}) center must map back to itself`,
      );
    }
  }
}

// --- validDrop: edge cells in bounds, one-past-edge cells (in every direction) out of bounds ---
{
  assert.equal(validDrop(geometry, { col: 0, row: 0 }), true, 'top-left corner is valid');
  assert.equal(validDrop(geometry, { col: 3, row: 2 }), true, 'bottom-right corner is valid');
  assert.equal(validDrop(geometry, { col: -1, row: 0 }), false, 'one column left of the board');
  assert.equal(validDrop(geometry, { col: 4, row: 0 }), false, 'one column right of the board (cols is 4, so col 4 is out)');
  assert.equal(validDrop(geometry, { col: 0, row: -1 }), false, 'one row above the board');
  assert.equal(validDrop(geometry, { col: 0, row: 3 }), false, 'one row below the board (rows is 3, so row 3 is out)');
  assert.equal(validDrop(geometry, { col: -1, row: -1 }), false, 'both axes out of bounds');
}

console.log('boardmath.selftest: ok');
