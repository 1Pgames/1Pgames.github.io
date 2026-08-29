import { TUNING } from '../config';
import type { Modifier } from '../core/stats';
import type { Rng } from '../core/rng';
import type { StatKey } from './relics';
import { STARTING_WEAPON, WEAPONS, weaponDef, type WeaponPattern } from './weapons';

/**
 * In-run upgrade draft (PRD §5.3) plus the between-run meta-upgrade rows.
 *
 * 26-card pool, exactly as §5.3 enumerates it: 6 weapon-unlocks + 6
 * weapon-boosts + 6 evolutions + 8 stat/effect cards. Cards are plain data
 * (id/name/description/`Modifier[]`) so `ui/cards.ts` and the scene never
 * hardcode a number.
 *
 * Four `kind`s of in-run card:
 * - `'stat'`: a plain `StatBlock` modifier (and, for `fx_lastgasp`, an
 *   `effect` hook consumed by `core/effects.ts`).
 * - `'weapon-unlock'`: `applyUpgrade` calls `combat.unlockWeapon(card.weapon)`.
 *   Only offered while a slot is free and the weapon is not owned.
 * - `'weapon-boost'`: `combat.boostWeapon(card.weapon)`, +1 rank. Only offered
 *   for owned weapons, and it leaves the pool at `TUNING.weapons.maxBoosts`.
 * - `'weapon-evolution'`: replaces the max-rank weapon with its evolution.
 *   Only offered once the §5.3 gate holds (max rank + the tagged stat card).
 *
 * §8 no-dead-draft rules are ALL implemented in `rollUpgradeChoices`; read its
 * doc comment for the guarantees the draft makes.
 *
 * `w_unlock_bolt` exists because §5.3 enumerates six unlock cards, but
 * Rustspike is the starting weapon, so its unlock is never eligible — the card
 * is in the table for id-set completeness, not for the pool.
 */

export type Rarity = 'common' | 'rare' | 'epic';
export type UpgradeKind = 'stat' | 'weapon-unlock' | 'weapon-boost' | 'weapon-evolution';

/** §5.3 synergy tags — build-lane hints for the §8 routes and the sim bots. */
export type SynergyTag = 'offense' | 'area' | 'burst' | 'sustain' | 'mobility' | 'loot' | 'weapon';

/** §5.3 rarity weights: common 60 / rare 30 / epic 10. */
const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 60,
  rare: 30,
  epic: 10,
};

export interface UpgradeDef {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  /** Stat changes this card grants; source is always `upgrade:<id>`. Empty for weapon cards. */
  modifiers: Array<Omit<Modifier, 'source'> & { stat: StatKey }>;
  /**
   * Behavioral hook for cards that are more than a stat tweak. The scene's
   * `core/effects.ts` registry looks this up; pure stat cards leave it
   * undefined.
   */
  effect?: string;
  /** How many times this card can be taken in one run. */
  maxStacks: number;
  kind: UpgradeKind;
  /** Set for `kind !== 'stat'` — the weapon this card unlocks, boosts or evolves. */
  weapon?: WeaponPattern;
  synergy: SynergyTag;
}

const weaponUnlockCard = (weapon: WeaponPattern): UpgradeDef => {
  const def = weaponDef(weapon);
  return {
    id: `w_unlock_${weapon}`,
    name: def.name,
    description: def.description,
    rarity: 'common',
    modifiers: [],
    maxStacks: 1,
    kind: 'weapon-unlock',
    weapon,
    synergy: 'weapon',
  };
};

const weaponBoostCard = (weapon: WeaponPattern): UpgradeDef => {
  const def = weaponDef(weapon);
  const gain =
    def.rankGrowth.damageStep > 0
      ? `+${Math.round(def.rankGrowth.damageStep * 100)}% damage`
      : `+${def.rankGrowth.countStep ?? 0} projectile`;
  return {
    id: `w_boost_${weapon}`,
    name: `Whetted ${def.name}`,
    description: `+1 rank: ${gain} per rank. At max rank ${def.name} can become ${def.evolvedName}.`,
    rarity: 'common',
    modifiers: [],
    maxStacks: TUNING.weapons.maxBoosts,
    kind: 'weapon-boost',
    weapon,
    synergy: 'weapon',
  };
};

const weaponEvolutionCard = (weapon: WeaponPattern): UpgradeDef => {
  const def = weaponDef(weapon);
  return {
    id: `w_evo_${weapon}`,
    name: def.evolvedName,
    description: `Replaces ${def.name}: ${def.evolvedDescription}.`,
    rarity: 'epic',
    modifiers: [],
    maxStacks: 1,
    kind: 'weapon-evolution',
    weapon,
    synergy: 'weapon',
  };
};

/**
 * The 8 stat/effect cards (§5.3). Names and descriptions are §5.3 copy,
 * verbatim; stat keys are the frozen §16.1 `StatKey` union.
 */
const STAT_CARDS: readonly UpgradeDef[] = [
  {
    id: 'stat_might',
    name: 'Grave Might',
    description: 'Marrow-deep strength for every blow',
    rarity: 'common',
    modifiers: [{ stat: 'damageMul', mul: 0.12 }],
    maxStacks: 5,
    kind: 'stat',
    synergy: 'offense',
  },
  {
    id: 'stat_haste',
    name: 'Dirge Tempo',
    description: 'The dead march faster to your drum',
    rarity: 'common',
    modifiers: [{ stat: 'cooldownMul', mul: -0.08 }],
    maxStacks: 5,
    kind: 'stat',
    synergy: 'offense',
  },
  {
    id: 'stat_area',
    name: 'Ashen Reach',
    description: 'Your curses spread like windblown ash',
    rarity: 'common',
    modifiers: [{ stat: 'area', mul: 0.15 }],
    maxStacks: 5,
    kind: 'stat',
    synergy: 'area',
  },
  {
    id: 'stat_crit',
    name: 'Dread Edge',
    description: 'Sometimes the blade remembers hatred',
    rarity: 'rare',
    modifiers: [{ stat: 'critChance', add: 0.06 }],
    maxStacks: 4,
    kind: 'stat',
    synergy: 'burst',
  },
  {
    id: 'stat_vital',
    name: 'Husk Hide',
    description: 'Leathered skin that forgets pain',
    rarity: 'common',
    modifiers: [{ stat: 'maxHp', add: 20 }],
    maxStacks: 4,
    kind: 'stat',
    synergy: 'sustain',
  },
  {
    id: 'stat_swift',
    name: 'Gloam Stride',
    description: 'Feet that never quite touch the mud',
    rarity: 'rare',
    modifiers: [{ stat: 'moveSpeed', mul: 0.08 }],
    maxStacks: 3,
    kind: 'stat',
    synergy: 'mobility',
  },
  {
    id: 'stat_greed',
    name: 'Gilt Hunger',
    description: 'Shards leap to a hungrier hand',
    rarity: 'rare',
    modifiers: [
      { stat: 'pickupRadius', add: 30 },
      { stat: 'shardsMul', mul: 0.1 },
    ],
    maxStacks: 3,
    kind: 'stat',
    synergy: 'loot',
  },
  {
    id: 'fx_lastgasp',
    name: 'Last Gasp',
    description: 'Once per run, refuse the grave',
    rarity: 'epic',
    modifiers: [],
    effect: 'last-gasp',
    maxStacks: 1,
    kind: 'stat',
    synergy: 'sustain',
  },
];

/** The 26-card draft pool (§5.3): 6 unlocks + 6 boosts + 6 evolutions + 8 stat/effect. */
export const UPGRADE_CARDS: readonly UpgradeDef[] = [
  ...WEAPONS.map((w) => weaponUnlockCard(w.id)),
  ...WEAPONS.map((w) => weaponBoostCard(w.id)),
  ...WEAPONS.map((w) => weaponEvolutionCard(w.id)),
  ...STAT_CARDS,
];

/** Gating context `rollUpgradeChoices` needs for the weapon-slot rules. */
export interface UpgradeRollContext {
  ownedWeapons: readonly WeaponPattern[];
  hasFreeWeaponSlot: boolean;
}

function countTaken(taken: readonly string[], id: string): number {
  let n = 0;
  for (const entry of taken) if (entry === id) n += 1;
  return n;
}

/** Rustspike is owned from the start; everything else needs its unlock card. */
function ownsWeapon(taken: readonly string[], weapon: WeaponPattern): boolean {
  return weapon === STARTING_WEAPON || taken.includes(`w_unlock_${weapon}`);
}

/**
 * §5.3 evolution gate: the weapon is owned, sits at max rank
 * (`TUNING.weapons.maxBoosts` boost cards taken), its tagged stat card is
 * owned, and it has not evolved yet. Derived from `taken` alone so the rule is
 * identical in the scene and the headless sim.
 */
export function evolutionEligible(taken: readonly string[], weapon: WeaponPattern): boolean {
  if (!ownsWeapon(taken, weapon)) return false;
  if (taken.includes(`w_evo_${weapon}`)) return false;
  if (countTaken(taken, `w_boost_${weapon}`) < TUNING.weapons.maxBoosts) return false;
  return taken.includes(weaponDef(weapon).evolutionRequiresCard);
}

function anyEvolutionEligible(taken: readonly string[]): boolean {
  return WEAPONS.some((w) => evolutionEligible(taken, w.id));
}

/**
 * How many drafts an evolution has been eligible for, counting the draft it
 * became eligible on as 0. `-1` when nothing is eligible right now.
 *
 * `taken` holds one pick per resolved draft, so a prefix of length k IS the
 * state entering draft k — the streak is measured by walking backwards from
 * the current state, which correctly re-starts the clock when a previous
 * evolution was taken and a later weapon becomes eligible.
 */
function draftsSinceEvolutionEligible(taken: readonly string[]): number {
  let streakStart = -1;
  for (let k = taken.length; k >= 0; k -= 1) {
    if (!anyEvolutionEligible(taken.slice(0, k))) break;
    streakStart = k;
  }
  return streakStart < 0 ? -1 : taken.length - streakStart;
}

function cardEligible(
  card: UpgradeDef,
  taken: readonly string[],
  ctx: UpgradeRollContext | undefined,
): boolean {
  if (card.kind === 'stat') return true;
  const weapon = card.weapon;
  if (weapon === undefined) return true;

  if (card.kind === 'weapon-evolution') return evolutionEligible(taken, weapon);

  // Unlock/boost need the live slot state; without a context they are hidden
  // rather than mis-offered.
  if (ctx === undefined) return false;
  const owned = ctx.ownedWeapons.includes(weapon);
  if (card.kind === 'weapon-unlock') return !owned && ctx.hasFreeWeaponSlot;
  return owned; // weapon-boost
}

function drawWeighted(rng: Rng, pool: readonly UpgradeDef[]): UpgradeDef {
  return rng.pickWeighted(
    pool,
    pool.map((card) => RARITY_WEIGHT[card.rarity]),
  );
}

/**
 * Weighted, duplicate-free draw of `count` cards, honouring every §8
 * no-dead-draft rule:
 *
 * - a card at its stack limit leaves the pool;
 * - weapon-unlock cards disappear once all `TUNING.weapons.maxSlots` slots are
 *   filled (via `ctx.hasFreeWeaponSlot`), and boost cards only appear for
 *   owned weapons;
 * - evolution cards surface ONLY while their §5.3 gate holds, and are
 *   GUARANTEED within 2 drafts of becoming eligible — the second such draft
 *   forces one into the hand instead of leaving it to the weights;
 * - every hand of 2+ contains at least one non-weapon stat card, so no draft
 *   can be all-weapon for a player who has no use for weapon cards.
 *
 * Every draw goes through the seeded `Rng`; the same seed and the same `taken`
 * history always produce the same hand.
 */
export function rollUpgradeChoices(
  rng: Rng,
  taken: readonly string[],
  count: number,
  context?: UpgradeRollContext,
): UpgradeDef[] {
  if (count <= 0) return [];

  const pickedCounts = new Map<string, number>();
  for (const id of taken) pickedCounts.set(id, (pickedCounts.get(id) ?? 0) + 1);

  let pool = UPGRADE_CARDS.filter(
    (card) =>
      (pickedCounts.get(card.id) ?? 0) < card.maxStacks && cardEligible(card, taken, context),
  );

  const choices: UpgradeDef[] = [];

  // §8: an eligible evolution must be offered within 2 drafts. On the second
  // draft of the streak it is seeded into the hand before anything else.
  if (draftsSinceEvolutionEligible(taken) >= 1) {
    const evolutions = pool.filter((card) => card.kind === 'weapon-evolution');
    if (evolutions.length > 0) {
      const forced = drawWeighted(rng, evolutions);
      choices.push(forced);
      pool = pool.filter((card) => card.id !== forced.id);
    }
  }

  while (choices.length < count && pool.length > 0) {
    const picked = drawWeighted(rng, pool);
    choices.push(picked);
    pool = pool.filter((card) => card.id !== picked.id);
  }

  // §8: at least one non-weapon stat card per hand. Swap the last weapon card
  // that is not the guaranteed evolution — the guarantee outranks this rule.
  if (choices.length > 1 && !choices.some((card) => card.kind === 'stat')) {
    const stats = pool.filter((card) => card.kind === 'stat');
    if (stats.length > 0) {
      for (let i = choices.length - 1; i >= 0; i -= 1) {
        if (choices[i]?.kind === 'weapon-evolution') continue;
        choices[i] = drawWeighted(rng, stats);
        break;
      }
    }
  }

  return choices;
}

/**
 * Permanent, currency-bought meta-upgrade. `perLevel` omits `source` because
 * `core/progression.ts` stamps it with `meta:<id>` when it turns levels into
 * `Modifier`s at run start.
 */
export interface MetaUpgradeDef {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  /** Cost of the first level; see `upgradeCost` for the full formula. */
  baseCost: number;
  /** Per-level cost multiplier; 1.35 means each level costs 35% more. */
  costGrowth: number;
  perLevel: Omit<Modifier, 'source'>;
}

/**
 * Between-run meta tree (PRD §10). Exactly the SEVEN rows whose effect is a
 * `Modifier` on a frozen §16.1 `StatKey` live here; `data/metaCatalog.ts`
 * projects them into the shop's UPGRADES group and `core/progression.ts`
 * folds them in through `metaModifiers()` at run start.
 *
 * The other FIVE §10 rows — `m_reroll`, `m_casket`, `m_tithe`, `m_ward`,
 * `m_revive` — are deliberately NOT here. None of them has a `StatKey` (note
 * `casketSlots` appears in §5.1 but is intentionally absent from the frozen
 * union), and `perLevel` is REQUIRED because `metaModifiers()` spreads it
 * unconditionally, so a "no modifier" row cannot exist in this table without
 * editing `core/progression.ts`. They land instead as `perk` entries appended
 * to `ARENA` in `data/metaCatalog.ts` (W4) — the template's designed path for a
 * non-stat meta row — and the slice reads `loadMeta().upgrades[id]` for each.
 * All 12 rows therefore reach the shop through one `metaCatalogFor('arena')`
 * read, with costs single-sourced and nothing duplicated.
 *
 * The scaffold rows this replaced (`meta_max_hp`, `meta_damage`, ...) are gone
 * rather than kept alongside: they would render as ghost shop rows, and their
 * `damage`/`regenPerSecond`/`xpGain` keys are not in the frozen union, so
 * `validateUpgradeStats` would flag them forever.
 */
export const META_UPGRADES: readonly MetaUpgradeDef[] = [
  {
    id: 'm_vitality',
    name: 'Husk Vigor',
    description: '+10 max HP per level.',
    maxLevel: 5,
    baseCost: 50,
    costGrowth: 1.35,
    perLevel: { stat: 'maxHp', add: 10 },
  },
  {
    id: 'm_haste',
    name: 'Gloam Pace',
    description: '+4% move speed per level.',
    maxLevel: 5,
    baseCost: 60,
    costGrowth: 1.4,
    perLevel: { stat: 'moveSpeed', mul: 0.04 },
  },
  {
    id: 'm_might',
    name: 'Marrow Might',
    description: '+6% damage per level.',
    maxLevel: 5,
    baseCost: 70,
    costGrowth: 1.4,
    perLevel: { stat: 'damageMul', mul: 0.06 },
  },
  {
    id: 'm_greed',
    name: 'Gilt Sense',
    description: '+8% shards per level.',
    maxLevel: 5,
    baseCost: 55,
    costGrowth: 1.35,
    perLevel: { stat: 'shardsMul', mul: 0.08 },
  },
  {
    id: 'm_magnet',
    name: 'Grave Pull',
    description: '+20px pickup radius per level.',
    maxLevel: 4,
    baseCost: 40,
    costGrowth: 1.3,
    perLevel: { stat: 'pickupRadius', add: 20 },
  },
  {
    id: 'm_bag',
    name: 'Marrow Sack',
    description: '+2 relic slots in the bag per level.',
    maxLevel: 2,
    baseCost: 70,
    costGrowth: 1.4,
    perLevel: { stat: 'bagSlots', add: 2 },
  },
  {
    // §10 quotes a 2000ms floor, but the floor IS
    // `TUNING.extract.channelMsFloor` and the extraction system applies it.
    // Restating a number here that has already moved once in tuning would only
    // create a second source, so this copy stays qualitative.
    id: 'm_extract',
    name: 'Bleak Haste',
    description: '-500ms extraction channel per level, down to the tuned floor.',
    maxLevel: 3,
    baseCost: 65,
    costGrowth: 1.35,
    perLevel: { stat: 'channelMs', add: -500 },
  },
] as const;

/**
 * `cost(level) = round(baseCost * costGrowth ^ level)` — `level` is the level
 * about to be bought (0-indexed). Typed on the two cost fields rather than on
 * `MetaUpgradeDef` so `data/metaCatalog.ts`'s `MetaEntry` (booster and perk
 * rows, which have no stat modifier) prices through the same formula.
 */
export function upgradeCost(def: { baseCost: number; costGrowth: number }, level: number): number {
  return Math.round(def.baseCost * def.costGrowth ** level);
}

/**
 * Boot-time guard: every stat an upgrade touches must be a stat the game reads.
 * A typo here is invisible at runtime — the modifier applies to a key nobody
 * queries, so the card looks fine, costs a level-up, and does nothing (this
 * shipped once as `projectileCount` versus `projectiles`).
 *
 * Called from `PreloadScene`; logs the offending ids instead of throwing so a
 * content mistake never blocks a build mid-stream. NOTE: until W6 mirrors the
 * frozen §16.1 `StatKey` union into `PLAYER_BASE_STATS`, this reports the §5.3
 * card keys (`damageMul`, `cooldownMul`, `area`, `shardsMul`, ...) as unread —
 * that is the integration signal, not a content bug.
 */
export function validateUpgradeStats(knownStats: readonly string[]): string[] {
  const problems: string[] = [];
  const known = new Set(knownStats);

  for (const card of UPGRADE_CARDS) {
    for (const mod of card.modifiers) {
      if (!known.has(mod.stat)) problems.push(`card ${card.id}: unknown stat "${mod.stat}"`);
    }
  }
  for (const meta of META_UPGRADES) {
    if (!known.has(meta.perLevel.stat)) {
      problems.push(`meta ${meta.id}: unknown stat "${meta.perLevel.stat}"`);
    }
  }
  if (problems.length > 0) {
    console.error(`[upgrades] ${problems.length} modifier(s) point at unread stats:`, problems);
  }
  return problems;
}
