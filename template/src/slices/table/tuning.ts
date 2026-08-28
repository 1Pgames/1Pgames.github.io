import type { ArtSlot } from '../../data/art';
import type { DiceRules } from './board';
import type { TileType } from './board';

/**
 * Slice-local balance for family G (dice-board). Global `TUNING` in
 * `src/config.ts` stays the arena reference slice's; every number this family
 * talks about lives here.
 */
export const TABLE_TUNING = {
  /** Tiles on the ring. */
  tiles: 20,

  /**
   * Rules the pure loop reads. `rolls` is tuned against
   * `src/sim/kits/diceloop.selftest.ts`: 3 set pieces off 2-3 `collect` tiles
   * out of 20 tiles is a ~15%/roll hit, so 30 rolls (plus `rollagain` refunds)
   * wins ~81% of seeds — the win is the expected outcome, an unlucky board
   * still loses.
   */
  rules: {
    rolls: 30,
    piecesTarget: 3,
    coinGain: 12,
    chestGain: 48,
    lossRatio: 0.2,
    diceFaces: 6,
  } satisfies DiceRules,

  /** Coins per 1 meta currency on the results screen. */
  coinsPerCurrency: 10,

  /**
   * Meta layer numbers. `extra-rolls` is the pre-session booster (armed in the
   * picker, spent when the ring is dealt); `meta_loaded_dice` is the standing
   * perk. Both are small on purpose: `rules.rolls` is tuned against
   * `diceloop.selftest.ts`, so a big grant would trivialise the win band.
   */
  meta: {
    /** Rolls added to the budget per armed `extra-rolls` booster. */
    rollsPerBooster: 2,
    /** Boosters armable at once in the picker. */
    maxPick: 2,
    /** `meta_loaded_dice`: natural 1s rerolled per perk level, per session. */
    loadedDiceRerollsPerLevel: 1,
  },

  /**
   * Generated-art slots. `null` keeps the procedural plate + icon + tint per
   * tile type; a resolved slot is drawn untinted. Dice faces are addressed by
   * frame on one sheet — `faces[n]` is the art for a roll of `n + 1`.
   */
  art: {
    tiles: {
      coin: null,
      chest: null,
      loss: null,
      rollagain: null,
      collect: null,
    } as Record<TileType, ArtSlot | null>,
    faces: [null, null, null, null, null, null] as readonly (ArtSlot | null)[],
    token: null as ArtSlot | null,
  },

  /** Results-screen score bonus per collected set piece (coins add on top). */
  scorePerPiece: 100,

  ring: {
    centerY: 560,
    radiusX: 258,
    radiusY: 340,
    tileSize: 74,
    iconScale: 0.36,
    tokenSize: 46,
  },

  /** One hop per tile; 6 hops must stay under ~1s so a roll reads as instant. */
  hopMs: 115,
  /** Pause between the last hop and the tile's payout, so cause reads before effect. */
  settleMs: 140,

  roll: {
    buttonWidth: 340,
    buttonHeight: 124,
    /** Alpha of the ROLL button while the token is hopping. */
    disabledAlpha: 0.45,
  },
} as const;
