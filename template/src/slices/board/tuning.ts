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

/**
 * Shipped state: procedural glyph + a `PALETTE` tint per kind, `art: null`.
 *
 * Once a `game-art` pass ships a piece sheet, fill `art` AND move the tints
 * off `PALETTE` onto the sprites' own hues: identity tint is LOCKED to the
 * piece art (goal chips, match particles and fallback glyphs must echo the
 * sprite), so a UI retheme must never drift gameplay colour-coding away from
 * the drawing. Until then the palette reference is what keeps the board
 * coherent with the rest of the game.
 */
export const BOARD_KIND_STYLES: readonly BoardKindStyle[] = [
  { id: 'ember', label: 'EMBER', texture: TEX.disc, tint: PALETTE.bad, size: 56, art: null },
  { id: 'leaf', label: 'LEAF', texture: TEX.spike, tint: PALETTE.good, size: 58, art: null },
  { id: 'spark', label: 'SPARK', texture: TEX.star, tint: PALETTE.accent, size: 60, art: null },
  { id: 'tide', label: 'TIDE', texture: TEX.square, tint: PALETTE.primary, size: 54, art: null },
  { id: 'bloom', label: 'BLOOM', texture: TEX.ring, tint: PALETTE.secondary, size: 60, art: null },
];

export const BOARD_KINDS: readonly string[] = BOARD_KIND_STYLES.map((style) => style.id);

export const BOARD_TUNING = {
  /**
   * DEFAULT board size. Royal-Match-shaped: a 7x8 board is small enough that
   * a player can read the whole thing at a glance, which is the precondition
   * for "the layout is the difficulty" — a 9x9 field of five kinds is just
   * noise, and the round-1 playtest said exactly that.
   *
   * Per level, `LevelSpec.board` overrides this in the 6x7..8x8 range (see
   * `levels.ts`), which is why there is no fixed `cellPx` here any more: the
   * cell size is DERIVED from the active board's dimensions (`layout` below).
   */
  cols: 7,
  rows: 8,

  /**
   * Board geometry, derived rather than authored: the grid is centred inside
   * the vertical band `[bandTop, bandBottom]` and the cell size is whatever
   * fits the ACTIVE level's dimensions in it, capped by `maxCellPx`.
   *
   * A fixed cell size cannot survive per-level dimensions — either the 8x8
   * finale overflows the band or the 6x7 tutorial floats in a third of it.
   * The band is the constant instead: `bandTop` clears the goal-chip row,
   * `bandBottom` clears the booster tray, and every level fills what is left.
   *
   * `styleCellPx` is the cell size `BOARD_KIND_STYLES.size` was authored
   * against, so a piece glyph scales by `cellPx / styleCellPx` and a 6x7
   * board's fatter cells get proportionally fatter ingredients.
   */
  layout: { bandTop: 248, bandBottom: 930, framePad: 12, maxCellPx: 96, styleCellPx: 70 },

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
   * MERCY RULE (Royal Match's, and the reason its endgame reads as fair): as
   * the budget runs out the refill stream narrows to `poolSize` kinds, so the
   * last few moves deal a board that matches and cascades more readily.
   *
   * It is not a difficulty cut — it is a variance cut. Losing on the last
   * move because the refills dealt five kinds of nothing teaches the player
   * that the level is a slot machine; losing with a tightened pool means the
   * board gave them chances and the plan was short. `mercyPool` orders goal
   * kinds first, so the narrowing also points at what is still owed.
   *
   * The scene and the sim MUST apply this at the same threshold with the same
   * pool size, or the gate below measures a game nobody plays.
   */
  mercy: { movesLeft: 5, poolSize: 4 },

  /**
   * Blockers (`core/board/types.ts`): the obstacle layer the ladder leans on
   * from order 4 onward. Placement is per level in `levels.ts`; these are the
   * defaults and the read.
   */
  blockers: {
    /** Jar hit points when a level's picture does not say (`'#'` vs `'='`). */
    jarHp: 1,
    /**
     * A cracked jar has to look cracked BEFORE it breaks, or a 2-hp jar reads
     * as a bug ("I cleared next to it and nothing happened"). One shared
     * shake + one tint step per point of damage taken.
     */
    hitShakePx: 5,
    hitShakeMs: 120,
    /** Multiplied into the jar's tint per point of damage already taken. */
    crackedTintScale: 0.78,
    /** Break FX: the shard burst, and the pop the freed cell lands with. */
    breakMs: 190,
    breakShards: 7,
    /** A vine unwinding is quieter than a jar shattering — it frees, not destroys. */
    vineFreeMs: 150,
    /** Score for breaking a jar / freeing a vine, on top of any cell cleared. */
    jarBreakScore: 60,
    vineFreeScore: 25,
  },

  /**
   * Boosters, spent through `progression.spendBooster`. Ids are the
   * `boosterId`s of the board catalog in `data/metaCatalog.ts` — the catalog
   * is the shop, this is the effect.
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

    /**
     * IN-LEVEL boosters (`core/board/boosters.ts`), armed from the tray while
     * the board is live. NONE of the four spends a move — see that module for
     * why, and note that this is the Royal Match rule: an in-level booster is
     * a way OUT of a stuck board, so charging a move for it would make the
     * rescue cost the thing the player is short of.
     *
     * The set covers the four shapes a stuck board comes in: one wrong cell
     * (`ladle`), a wrong row (`broom`), a wrong column (`pestle`) and a wrong
     * board (`whisk`).
     *
     * `shopCostBase` mirrors the `baseCost` of the matching `meta_*` catalog
     * entry; it is here so the tray can price a chip without importing the
     * shop, and the two must be kept equal.
     */
    inLevel: {
      ladle: {
        /** Arming highlights one cell; the second tap scoops it. */
        shopCostBase: 70,
        /** How long the armed target ring pulses before it reads as stuck. */
        armPulseMs: 620,
        scoopMs: 210,
      },
      broom: {
        /** Arming highlights a whole row; the second tap sweeps it. */
        shopCostBase: 70,
        armPulseMs: 620,
        /** Per-cell stagger of the sweep, left to right — it must read as a sweep. */
        sweepStaggerMs: 22,
      },
      pestle: {
        /** Arming highlights a whole column; the second tap grinds it out. */
        shopCostBase: 90,
        armPulseMs: 620,
        /** Per-cell stagger of the grind, top to bottom — gravity's direction. */
        sweepStaggerMs: 22,
      },
      whisk: {
        /**
         * No arm phase: a shuffle has no target, so a second tap would only
         * be a chance to mis-tap. The chip fires on the first tap.
         */
        shopCostBase: 120,
        /** Slide time for the reshuffle; matches the `shuffle` booster's own. */
        slideMs: 320,
      },
    },
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
