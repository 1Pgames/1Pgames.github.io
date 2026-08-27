import Phaser from 'phaser';
import { PALETTE } from '../config';
import { TEX } from '../core/keys';
import type { NavGrid } from '../core/grid';

/**
 * Tap-to-place system for tower-defense/base-builder boards: arm a def id,
 * a semi-transparent ghost then tracks the pointer snapped to grid cells,
 * tinted green when the cell is a legal build spot and red otherwise, and a
 * tap (down and up on the same valid cell) confirms the placement.
 *
 * Validity combines three checks against the shared `NavGrid`: the cell must
 * pass the caller's `isBuildable` predicate, must not already be blocked
 * (occupied or impassable terrain), and must not seal off every remaining
 * route to `goal` — checked by tentatively blocking the candidate cell,
 * rebuilding the flow field, and confirming every cell that could reach the
 * goal before can still reach it after (minus the candidate cell itself).
 * `grid` is shared, mutable state: callers must call `grid.setBlocked(col,
 * row, true)` from their own `onPlace` handler (the same way `Arena` and
 * other systems register obstacles) so later validity checks account for
 * earlier placements, and must rebuild their own flow field afterward if
 * they read the grid for a different goal — this system always leaves the
 * grid's last-built field pointed at `goal`.
 *
 * Use for: tower-defense tower placement, base-builder structure placement,
 * any "tap an empty cell to build" verb on a `NavGrid`-backed board.
 * Do NOT use for: free-form (non-grid) placement, or auto-battler bench/board
 * drag-drop — see `systems/board.ts` for cell-snapped drag instead of tap.
 */

export interface PlacementCell {
  col: number;
  row: number;
}

export interface PlacementOptions {
  grid: NavGrid;
  /** Grid dimensions matching how `grid` was constructed — `NavGrid` does not expose them. */
  cols: number;
  rows: number;
  cellPx: number;
  /** World position of the grid's (0, 0) cell corner. */
  origin: { x: number; y: number };
  /** Cell units path toward; placement is rejected if it would cut every route there. */
  goal: PlacementCell;
  isBuildable(cell: PlacementCell): boolean;
  cost(defId: string): number;
  canAfford(cost: number): boolean;
  onPlace(defId: string, cell: PlacementCell): void;
}

/** Total cells with a finite `dist` after the grid's last `buildFlowField` call. */
function reachableCount(grid: NavGrid, cols: number, rows: number): number {
  let n = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (grid.pathExists(col, row)) n += 1;
    }
  }
  return n;
}

export class PlacementSystem {
  private readonly scene: Phaser.Scene;
  private readonly opts: PlacementOptions;
  private ghost: Phaser.GameObjects.Image | null = null;
  private armedDefId: string | null = null;
  private lastCell: PlacementCell | null = null;
  private pointerDownCell: PlacementCell | null = null;

  constructor(scene: Phaser.Scene, opts: PlacementOptions) {
    this.scene = scene;
    this.opts = opts;

    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  /** Enters (or switches) placement mode for `defId` and shows the ghost preview. */
  arm(defId: string): void {
    this.armedDefId = defId;
    this.lastCell = null;
    if (this.ghost === null) {
      this.ghost = this.scene.add
        .image(0, 0, TEX.square)
        .setAlpha(0.55)
        .setDisplaySize(this.opts.cellPx * 0.86, this.opts.cellPx * 0.86)
        .setDepth(500);
    }
    this.ghost.setVisible(true);
  }

  /** Leaves placement mode, hides the ghost, and discards any in-flight tap. */
  cancel(): void {
    this.armedDefId = null;
    this.pointerDownCell = null;
    this.ghost?.setVisible(false);
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    if (this.armedDefId === null || this.ghost === null) return;
    const cell = this.pointerToCell(pointer);
    const center = this.cellCenter(cell);
    this.ghost.setPosition(center.x, center.y);
    if (this.lastCell !== null && this.lastCell.col === cell.col && this.lastCell.row === cell.row) return;
    this.lastCell = cell;
    this.ghost.setTint(this.isValidCell(cell) ? PALETTE.good : PALETTE.bad);
  }

  // Click semantics, not release semantics: only a POINTER_UP that started on
  // this system's own POINTER_DOWN (and lands on the same cell) confirms — a
  // drag that merely ends over the board must not place anything.
  private onDown(pointer: Phaser.Input.Pointer): void {
    if (this.armedDefId === null) return;
    this.pointerDownCell = this.pointerToCell(pointer);
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    const defId = this.armedDefId;
    const downCell = this.pointerDownCell;
    this.pointerDownCell = null;
    if (defId === null || downCell === null) return;

    const cell = this.pointerToCell(pointer);
    if (cell.col !== downCell.col || cell.row !== downCell.row) return;
    if (!this.isValidCell(cell)) return;

    const cost = this.opts.cost(defId);
    if (!this.opts.canAfford(cost)) return;
    this.opts.onPlace(defId, cell);
  }

  private isValidCell(cell: PlacementCell): boolean {
    if (this.opts.grid.isBlocked(cell.col, cell.row)) return false;
    if (!this.opts.isBuildable(cell)) return false;
    return !this.wouldSealPath(cell);
  }

  /** True if tentatively blocking `cell` would strand a currently-reachable cell other than itself. */
  private wouldSealPath(cell: PlacementCell): boolean {
    const { grid, cols, rows, goal } = this.opts;
    grid.buildFlowField(goal.col, goal.row);
    const candidateWasReachable = grid.pathExists(cell.col, cell.row);
    const before = reachableCount(grid, cols, rows);

    grid.setBlocked(cell.col, cell.row, true);
    grid.buildFlowField(goal.col, goal.row);
    const after = reachableCount(grid, cols, rows);
    grid.setBlocked(cell.col, cell.row, false);
    grid.buildFlowField(goal.col, goal.row);

    const expectedLoss = candidateWasReachable ? 1 : 0;
    return before - after > expectedLoss;
  }

  private pointerToCell(pointer: Phaser.Input.Pointer): PlacementCell {
    const { origin, cellPx } = this.opts;
    return {
      col: Math.floor((pointer.worldX - origin.x) / cellPx),
      row: Math.floor((pointer.worldY - origin.y) / cellPx),
    };
  }

  private cellCenter(cell: PlacementCell): { x: number; y: number } {
    const { origin, cellPx } = this.opts;
    return { x: origin.x + cell.col * cellPx + cellPx / 2, y: origin.y + cell.row * cellPx + cellPx / 2 };
  }

  destroy(): void {
    this.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    this.ghost?.destroy();
    this.ghost = null;
  }
}
