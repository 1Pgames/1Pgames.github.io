import { META_UPGRADES } from './upgrades';

/**
 * Per-family catalog for the between-run shop (`scenes/meta.ts`).
 *
 * The shop scene is shared by every family, but "permanent upgrade" means
 * something different in each: the arena slice buys stat modifiers, a
 * match-3 board buys consumable boosters, an idle game buys rule-bending
 * perks. Rather than fork the scene per family, the scene renders whatever
 * `metaCatalogFor(SIM_FAMILY)` returns and dispatches on `MetaEntry.kind`.
 *
 * Three kinds, three storage paths — all inside the single `MetaSave`:
 *
 * - `stat`    — a purchase bumps `MetaSave.upgrades[id]`, and the level is
 *               turned into `Modifier`s at run start by
 *               `core/progression.ts`'s `metaModifiers()`. That function
 *               walks `META_UPGRADES`, so a `stat` entry is only ever
 *               effective when a matching `MetaUpgradeDef` exists — which is
 *               why only the arena catalog uses this kind. `statKey` /
 *               `statPerLevel` are display/authoring hints, not the source
 *               of truth for the modifier.
 * - `booster` — a purchase bumps `MetaSave.upgrades[id]` (so `maxLevel` still
 *               caps lifetime purchases) AND grants `boosterPerLevel`
 *               boosters into `MetaSave.boosters[boosterId]`. Slices consume
 *               them in-run with `progression.spendBooster(boosterId)`.
 * - `perk`    — a purchase only bumps `MetaSave.upgrades[id]`. Slices read
 *               the level directly (`loadMeta().upgrades[id] ?? 0`) and
 *               apply the rule change themselves. Wiring each slice's perk
 *               reads is wave B; the catalog is the contract they read
 *               against.
 *
 * Ids are save keys: never renumber or rename an existing `id`, or a
 * player's purchases silently reset. Costs are modest on purpose — a run
 * pays out tens of coins, so the first level of anything should be one or
 * two runs away, and `costGrowth` does the pacing after that.
 */

export type MetaEntryKind = 'stat' | 'booster' | 'perk';

export interface MetaEntry {
  /** Save key in `MetaSave.upgrades`. Stable forever once shipped. */
  id: string;
  name: string;
  description: string;
  /** Cost of the first level; `cost(level) = round(baseCost * costGrowth ** level)`. */
  baseCost: number;
  /** Per-level cost multiplier; 1.35 means each level costs 35% more. */
  costGrowth: number;
  maxLevel: number;
  kind: MetaEntryKind;
  /** `stat` only: the `StatKey` the matching `MetaUpgradeDef` modifies. Informational. */
  statKey?: string;
  /** `stat` only: the per-level `add`/`mul` amount. Informational. */
  statPerLevel?: number;
  /** `booster` only: id in `MetaSave.boosters`, spent via `progression.spendBooster`. */
  boosterId?: string;
  /** `booster` only: boosters granted per level bought. Defaults to 1. */
  boosterPerLevel?: number;
}

/**
 * The arena catalog IS `META_UPGRADES`, projected. Deriving it instead of
 * retyping it keeps ids, costs and copy single-sourced, so existing saves and
 * the `metaModifiers()` lookup can never drift out of sync with the shop.
 */
const ARENA: readonly MetaEntry[] = META_UPGRADES.map((def) => ({
  id: def.id,
  name: def.name,
  description: def.description,
  baseCost: def.baseCost,
  costGrowth: def.costGrowth,
  maxLevel: def.maxLevel,
  kind: 'stat' as const,
  statKey: def.perLevel.stat,
  statPerLevel: def.perLevel.add ?? def.perLevel.mul,
}));

/** Match-3 / puzzle board: stockpiled consumables the player spends on a hard level. */
const BOARD: readonly MetaEntry[] = [
  {
    id: 'meta_extra_moves',
    name: 'Extra Moves',
    description: '+3 moves at the start of a level. Grants 1 use per level bought.',
    baseCost: 60,
    costGrowth: 1.35,
    maxLevel: 10,
    kind: 'booster',
    boosterId: 'extra-moves',
    boosterPerLevel: 1,
  },
  {
    id: 'meta_shuffle',
    name: 'Shuffle',
    description: 'Reshuffle the board once when you run out of matches.',
    baseCost: 80,
    costGrowth: 1.4,
    maxLevel: 8,
    kind: 'booster',
    boosterId: 'shuffle',
    boosterPerLevel: 1,
  },
  {
    id: 'meta_bomb_start',
    name: 'Opening Bomb',
    description: 'Start the level with one bomb already on the board.',
    baseCost: 110,
    costGrowth: 1.45,
    maxLevel: 6,
    kind: 'booster',
    boosterId: 'bomb-start',
    boosterPerLevel: 1,
  },
];

/** Side-scrolling runner/platformer: reach further, keep more of what you collect. */
const SIDE: readonly MetaEntry[] = [
  {
    id: 'meta_coin_magnet',
    name: 'Coin Magnet',
    description: 'Pull coins in from +12% further per level.',
    baseCost: 45,
    costGrowth: 1.3,
    maxLevel: 5,
    kind: 'perk',
  },
  {
    id: 'meta_extra_life',
    name: 'Extra Life',
    description: 'Carry on once after a fatal hit. Grants 1 use per level bought.',
    baseCost: 90,
    costGrowth: 1.4,
    maxLevel: 8,
    kind: 'booster',
    boosterId: 'extra-life',
    boosterPerLevel: 1,
  },
];

/** Word game: nudges for the puzzle you are stuck on, not permanent power. */
const WORD: readonly MetaEntry[] = [
  {
    id: 'meta_fifty_fifty',
    name: 'Fifty-Fifty',
    description: 'Reveal half of the remaining letters. Grants 1 use per level bought.',
    baseCost: 55,
    costGrowth: 1.35,
    maxLevel: 10,
    kind: 'booster',
    boosterId: 'fifty-fifty',
    boosterPerLevel: 1,
  },
  {
    id: 'meta_time_plus',
    name: 'Extra Time',
    description: '+20 seconds on the clock. Grants 1 use per level bought.',
    baseCost: 50,
    costGrowth: 1.3,
    maxLevel: 10,
    kind: 'booster',
    boosterId: 'time-plus',
    boosterPerLevel: 1,
  },
];

/** Hyper-casual one-input game: keep the loop pure, sell easing-in and looks. */
const HYPER: readonly MetaEntry[] = [
  {
    id: 'meta_slow_start',
    name: 'Slow Start',
    description: 'The first 5 seconds of a run are 8% slower per level.',
    baseCost: 40,
    costGrowth: 1.35,
    maxLevel: 4,
    kind: 'perk',
  },
  {
    id: 'meta_skin_pack',
    name: 'Skin Pack',
    description: 'Unlock one extra player colourway per level.',
    baseCost: 120,
    costGrowth: 1.5,
    maxLevel: 3,
    kind: 'perk',
  },
];

/** Idle/incremental: the two levers that matter are offline time and tap value. */
const IDLE: readonly MetaEntry[] = [
  {
    id: 'meta_offline_cap',
    name: 'Offline Storage',
    description: '+2 hours of banked offline production per level.',
    baseCost: 100,
    costGrowth: 1.6,
    maxLevel: 2,
    kind: 'perk',
  },
  {
    id: 'meta_golden_touch',
    name: 'Golden Touch',
    description: '+15% income from taps per level.',
    baseCost: 70,
    costGrowth: 1.4,
    maxLevel: 6,
    kind: 'perk',
  },
];

/** Dice/card table game: one consumable, one standing edge. */
const TABLE: readonly MetaEntry[] = [
  {
    id: 'meta_extra_rolls',
    name: 'Extra Rolls',
    description: 'One extra reroll this game. Grants 1 use per level bought.',
    baseCost: 60,
    costGrowth: 1.35,
    maxLevel: 10,
    kind: 'booster',
    boosterId: 'extra-rolls',
    boosterPerLevel: 1,
  },
  {
    id: 'meta_loaded_dice',
    name: 'Loaded Dice',
    description: 'Reroll a natural 1 once per round, per level.',
    baseCost: 95,
    costGrowth: 1.45,
    maxLevel: 3,
    kind: 'perk',
  },
];

/** Racer: a small permanent edge plus the cosmetic/class ladder. */
const TRACK: readonly MetaEntry[] = [
  {
    id: 'meta_tune_up',
    name: 'Tune-Up',
    description: '+2% top speed per level.',
    baseCost: 55,
    costGrowth: 1.35,
    maxLevel: 6,
    kind: 'perk',
  },
  {
    id: 'meta_championship',
    name: 'Championship Entry',
    description: 'Unlock one harder championship tier per level.',
    baseCost: 150,
    costGrowth: 1.55,
    maxLevel: 3,
    kind: 'perk',
  },
];

const CATALOGS: Record<string, readonly MetaEntry[]> = {
  arena: ARENA,
  board: BOARD,
  side: SIDE,
  word: WORD,
  hyper: HYPER,
  idle: IDLE,
  table: TABLE,
  track: TRACK,
};

/**
 * Shop contents for a runtime family (`sim/family.ts`'s `SIM_FAMILY`).
 *
 * An unknown family — an authored game that registered its own family module
 * without adding a catalog — returns an empty list, and the shop renders its
 * empty state. Falling back to the arena catalog would be worse than nothing:
 * its `stat` entries only do anything through `META_UPGRADES`, so a non-arena
 * game would sell upgrades that never apply.
 */
export function metaCatalogFor(family: string): readonly MetaEntry[] {
  return CATALOGS[family] ?? [];
}
