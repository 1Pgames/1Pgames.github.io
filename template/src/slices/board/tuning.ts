import { PALETTE } from '../../config';
import { TEX } from '../../core/keys';
import type { ArtSlot } from '../../data/art';
import type { SpecialKind } from '../../core/board/types';

/**
 * Slice-local balance and presentation numbers for the match-3 board.
 * Global `TUNING` stays untouched: these values only mean anything inside
 * `slices/board`.
 */

/**
 * Piece identity is DUAL CODED — a distinct silhouette AND a distinct colour —
 * so the board stays readable for colour-blind players and in a compressed
 * vertical video. Never add a kind that reuses a shape or a hue.
 */
export interface BoardKindStyle {
  id: string;
  label: string;
  texture: string;
  tint: number;
  /** Target on-screen size in px (longest axis); the sprite keeps its aspect. */
  size: number;
  /**
   * Generated piece art. `null` keeps the procedural `texture` + `tint` path;
   * a resolved slot is drawn UNTINTED (generated art carries its own colour),
   * so an art pass has to keep the silhouettes distinct on its own.
   */
  art: ArtSlot | null;
}

export const BOARD_KIND_STYLES: readonly BoardKindStyle[] = [
  { id: 'ember', label: 'EMBER', texture: TEX.disc, tint: PALETTE.bad, size: 56, art: null },
  { id: 'leaf', label: 'LEAF', texture: TEX.spike, tint: PALETTE.good, size: 58, art: null },
  { id: 'spark', label: 'SPARK', texture: TEX.star, tint: PALETTE.accent, size: 60, art: null },
  { id: 'tide', label: 'TIDE', texture: TEX.square, tint: PALETTE.primary, size: 54, art: null },
  { id: 'bloom', label: 'BLOOM', texture: TEX.ring, tint: PALETTE.secondary, size: 60, art: null },
];

export const BOARD_KINDS: readonly string[] = BOARD_KIND_STYLES.map((style) => style.id);

export const BOARD_TUNING = {
  /** 9 x 70px = 630px, inside the 640px playable width left by `SAFE.side`. */
  cols: 9,
  rows: 9,
  cellPx: 70,
  /** Top edge of the grid; keeps the goal HUD above and the bottom band clear. */
  boardTop: 330,

  /** Swap animation, and the bounce-back when the swap makes no match. */
  swapMs: 130,
  rejectMs: 120,
  /** Cleared pieces shrink out; survivors fall at this speed per cell. */
  clearMs: 150,
  fallMsPerCell: 52,
  fallMinMs: 95,
  /** Pause between cascade beats so the player can read the chain. */
  stepGapMs: 60,
  /** Per-cell stagger inside one clear, left-to-right. */
  clearStaggerMs: 14,
  shuffleMs: 380,

  /** Score: a cell is worth this, multiplied by its cascade depth. */
  scorePerCell: 12,
  cascadeStepBonus: 0.5,
  specialCreatedScore: 80,
  /** Results-screen currency per star earned. */
  currencyPerStar: 10,

  /** Drag distance that commits a swipe-swap instead of a tap-select. */
  dragCommitPx: 26,
  /** Cap on floating score numbers per cascade beat. */
  floatTextPerStep: 3,

  /**
   * Pre-level boosters, spent through `progression.spendBooster` when the
   * level begins. Ids are the `boosterId`s of the board catalog in
   * `data/metaCatalog.ts` — the catalog is the shop, this is the effect.
   */
  boosters: {
    /** `extra-moves`: added to the level's move budget (a spec copy, not the ladder). */
    extraMoves: 3,
    /** `bomb-start`: the inclusive mid-board row band the opening bomb may land in. */
    bombRowBand: { min: 3, max: 5 },
    /** `shuffle`: one-tap reshuffles granted for the level. */
    shuffleCharges: 1,
    /** Boosters armable at once in the picker (`ui/boosterBar.ts` default is 2). */
    maxPick: 2,
  },

  /**
   * Generated-art slots. `null` everywhere is the shipped state: the slice
   * draws its procedural glyph and tint. `game-art` fills these per the
   * slice-wiring guide; a slot that names an unloaded key falls back on its
   * own (one `textures.exists` check at construction).
   */
  art: {
    /** Overlay badge per special kind; the piece underneath keeps its own slot. */
    specials: { 'line-h': null, 'line-v': null, bomb: null } as Record<SpecialKind, ArtSlot | null>,
  },
} as const;
