import Phaser from 'phaser';
import { PALETTE } from '../config';
import { pointerToCell, cellToXY, validDrop } from './boardMath';
import type { BoardCell, BoardGeometry } from './boardMath';

/**
 * Bench + board drag-drop system for auto-battler/tactics unit placement:
 * a row of bench slots (units not yet fielded) plus an N×M board grid, where
 * dragging a unit sprite snaps it to the nearest cell on drop, dropping onto
 * an occupied cell swaps the two units, and dropping inside `sellZone`
 * removes it via the caller's callback instead of placing it.
 *
 * The cell math (`pointerToCell`, `cellToXY`, `validDrop`) lives in the
 * sibling `systems/boardMath.ts` (re-exported here for convenience) so it
 * can be imported and unit-tested headlessly, and reused by AI/preview code
 * that needs to reason about drops without a live scene, without pulling in
 * the Phaser runtime.
 *
 * Use for: auto-battler unit bench/board management, tactics pre-battle
 * placement phases.
 * Do NOT use for: tower-defense tap-to-place (see `systems/placement.ts`,
 * which has no drag and validates against a `NavGrid` instead of a fixed
 * board rect).
 */

export type { BoardCell, BoardGeometry };
export { pointerToCell, cellToXY, validDrop };

export interface BoardUnitSprite extends Phaser.GameObjects.Container {
  /** Board cell the sprite currently occupies, or `null` while benched. */
  boardCell: BoardCell | null;
}

export interface BoardSystemOptions {
  geometry: BoardGeometry;
  /** World-space rect; a drop inside it sells instead of placing. */
  sellZone: { x: number; y: number; width: number; height: number };
  onSwap(a: BoardUnitSprite, b: BoardUnitSprite): void;
  onPlace(sprite: BoardUnitSprite, cell: BoardCell): void;
  onSell(sprite: BoardUnitSprite): void;
}

function insideRect(rect: { x: number; y: number; width: number; height: number }, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/**
 * Owns drag lifecycle for every sprite registered with `track()`. Cell
 * occupancy (`occupantAt`) is tracked internally so drops can detect swaps;
 * callers still own creating/destroying the sprites themselves.
 */
export class BoardSystem {
  private readonly scene: Phaser.Scene;
  private readonly opts: BoardSystemOptions;
  private readonly occupants = new Map<string, BoardUnitSprite>();

  constructor(scene: Phaser.Scene, opts: BoardSystemOptions) {
    this.scene = scene;
    this.opts = opts;
  }

  /** Registers a sprite for drag-drop; call once per unit sprite after creating it. */
  track(sprite: BoardUnitSprite): void {
    sprite.setScrollFactor(0);
    sprite.setInteractive({ useHandCursor: true, draggable: true });
    this.scene.input.setDraggable(sprite);

    if (sprite.boardCell !== null) this.occupants.set(this.cellKey(sprite.boardCell), sprite);

    sprite.on(Phaser.Input.Events.DRAG_START, () => sprite.setDepth(600).setScale(1.08));
    sprite.on(Phaser.Input.Events.DRAG, (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      sprite.setPosition(dragX, dragY);
    });
    sprite.on(Phaser.Input.Events.DRAG_END, (pointer: Phaser.Input.Pointer) => {
      sprite.setDepth(500).setScale(1);
      this.resolveDrop(sprite, pointer.worldX, pointer.worldY);
    });
  }

  /** Removes bookkeeping for a sprite about to be destroyed (e.g. after a sell). */
  untrack(sprite: BoardUnitSprite): void {
    if (sprite.boardCell !== null) this.occupants.delete(this.cellKey(sprite.boardCell));
  }

  private resolveDrop(sprite: BoardUnitSprite, worldX: number, worldY: number): void {
    if (insideRect(this.opts.sellZone, worldX, worldY)) {
      if (sprite.boardCell !== null) this.occupants.delete(this.cellKey(sprite.boardCell));
      sprite.boardCell = null;
      this.opts.onSell(sprite);
      return;
    }

    const cell = pointerToCell(this.opts.geometry, worldX, worldY);
    if (!validDrop(this.opts.geometry, cell)) {
      this.snapBackOrHome(sprite);
      return;
    }

    const key = this.cellKey(cell);
    const occupant = this.occupants.get(key);
    if (sprite.boardCell !== null) this.occupants.delete(this.cellKey(sprite.boardCell));

    if (occupant !== undefined && occupant !== sprite) {
      const previousCell = sprite.boardCell;
      this.occupants.set(key, sprite);
      sprite.boardCell = cell;
      const swapXY = cellToXY(this.opts.geometry, cell);
      sprite.setPosition(swapXY.x, swapXY.y);
      if (previousCell !== null) {
        this.occupants.set(this.cellKey(previousCell), occupant);
        occupant.boardCell = previousCell;
        const occupantXY = cellToXY(this.opts.geometry, previousCell);
        occupant.setPosition(occupantXY.x, occupantXY.y);
      }
      this.opts.onSwap(sprite, occupant);
      return;
    }

    this.occupants.set(key, sprite);
    sprite.boardCell = cell;
    const xy = cellToXY(this.opts.geometry, cell);
    sprite.setPosition(xy.x, xy.y);
    this.opts.onPlace(sprite, cell);
  }

  /** Invalid drop target: return to the last known board cell, or leave benched at its drag-start position. */
  private snapBackOrHome(sprite: BoardUnitSprite): void {
    if (sprite.boardCell === null) return;
    const xy = cellToXY(this.opts.geometry, sprite.boardCell);
    sprite.setPosition(xy.x, xy.y);
  }

  private cellKey(cell: BoardCell): string {
    return `${cell.col},${cell.row}`;
  }
}

/** Housing tint for the sell zone (used by callers drawing it with `primitives`). */
export const SELL_ZONE_COLOR = PALETTE.bad;
