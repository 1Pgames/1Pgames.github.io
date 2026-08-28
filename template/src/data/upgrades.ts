import { TUNING } from '../config';
import type { Modifier } from '../core/stats';
import type { Rng } from '../core/rng';
import { WEAPONS, weaponDef, type WeaponPattern } from './weapons';

/**
 * Data-driven upgrade catalog: the "pick 1 of 3" in-run cards handed out on
 * level-up, and the permanent meta-upgrades bought between runs with meta
 * currency. Every card is plain data (id/name/description/`Modifier[]`) so
 * `ui/cards.ts` and `core/progression.ts` never hardcode a single number —
 * add a build by adding an entry here, not by branching in scene code.
 *
 * Three `kind`s of in-run card:
 * - `'stat'`: a plain `StatBlock` modifier (and, for the two legendaries, an
 *   `effect` hook consumed by `core/effects.ts`).
 * - `'weapon-unlock'`: no modifiers; `GameScene.applyUpgrade` calls
 *   `combat.unlockWeapon(card.weapon)`. Only offered while a slot is free
 *   (see the `context` param on `rollUpgradeChoices`).
 * - `'weapon-boost'`: no modifiers; `GameScene.applyUpgrade` calls
 *   `combat.boostWeapon(card.weapon)`, which evolves the weapon once its
 *   boosts reach `TUNING.weapons.maxBoosts`. Only offered for owned weapons.
 *
 * Use for: roguelike / survivor-like / tower-defense games with in-run stat
 * builds and a between-run economy.
 * Do NOT use for: games with no meta progression or no run-time leveling —
 * plain `TUNING` constants are simpler there.
 */

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export type UpgradeKind = 'stat' | 'weapon-unlock' | 'weapon-boost';

/** Draw weight per rarity — common is 20x more likely than legendary. */
const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 60,
  uncommon: 25,
  rare: 12,
  legendary: 3,
};

export interface UpgradeDef {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  /** Stat changes this card grants; source is always `upgrade:<id>`. Empty for weapon cards. */
  modifiers: Array<Omit<Modifier, 'source'>>;
  /**
   * Behavioral hook for cards that are more than a stat tweak (lifesteal on
   * hit, chain explosions on crit, the two legendary synergies). The scene's
   * `core/effects.ts` registry looks this up; pure stat cards leave it
   * undefined.
   */
  effect?: string;
  /** How many times this card can be taken in one run. */
  maxStacks: number;
  kind: UpgradeKind;
  /** Set for `kind !== 'stat'` — the weapon this card unlocks or boosts. */
  weapon?: WeaponPattern;
}

const weaponUnlockCard = (weapon: WeaponPattern, rarity: Rarity): UpgradeDef => {
  const def = weaponDef(weapon);
  return {
    id: `unlock_${weapon}`,
    name: `Unlock: ${def.name}`,
    description: def.description,
    rarity,
    modifiers: [],
    maxStacks: 1,
    kind: 'weapon-unlock',
    weapon,
  };
};

const weaponBoostCard = (weapon: WeaponPattern): UpgradeDef => {
  const def = weaponDef(weapon);
  return {
    id: `boost_${weapon}`,
    name: `Upgrade: ${def.name}`,
    description: `Strengthens ${def.name}. Maxing this out evolves it into ${def.evolvedName}.`,
    rarity: 'uncommon',
    modifiers: [],
    maxStacks: TUNING.weapons.maxBoosts,
    kind: 'weapon-boost',
    weapon,
  };
};

/**
 * 8 strongest generic stat cards (damage, attack speed, area, max HP, regen,
 * pickup radius, XP gain) plus the weapon unlock/boost cards (see above) and
 * 2 build-defining legendary synergy cards.
 */
export const UPGRADE_CARDS: readonly UpgradeDef[] = [
  // --- damage ---------------------------------------------------------
  {
    id: 'dmg_flat',
    name: 'Sharpened Edges',
    description: '+6 flat damage.',
    rarity: 'common',
    modifiers: [{ stat: 'damage', add: 6 }],
    maxStacks: 6,
    kind: 'stat',
  },
  {
    id: 'dmg_mul',
    name: 'Honed Technique',
    description: '+15% damage.',
    rarity: 'uncommon',
    modifiers: [{ stat: 'damage', mul: 0.15 }],
    maxStacks: 5,
    kind: 'stat',
  },
  // --- attack speed ----------------------------------------------------
  {
    id: 'atk_speed',
    name: 'Quick Hands',
    description: '+12% attack speed.',
    rarity: 'common',
    modifiers: [{ stat: 'attackSpeed', mul: 0.12 }],
    maxStacks: 6,
    kind: 'stat',
  },
  // --- area ------------------------------------------------------------
  {
    id: 'area_mul',
    name: 'Wider Reach',
    description: '+20% attack area.',
    rarity: 'uncommon',
    modifiers: [{ stat: 'areaMul', mul: 0.2 }],
    maxStacks: 5,
    kind: 'stat',
  },
  // --- max hp ------------------------------------------------------------
  {
    id: 'max_hp',
    name: 'Thicker Hide',
    description: '+25 max HP.',
    rarity: 'common',
    modifiers: [{ stat: 'maxHp', add: 25 }],
    maxStacks: 8,
    kind: 'stat',
  },
  // --- regen ---------------------------------------------------------
  {
    id: 'regen',
    name: 'Steady Pulse',
    description: '+0.75 HP regenerated per second.',
    rarity: 'uncommon',
    modifiers: [{ stat: 'regenPerSecond', add: 0.75 }],
    maxStacks: 6,
    kind: 'stat',
  },
  // --- pickup radius ---------------------------------------------------
  {
    id: 'pickup_radius',
    name: 'Magnetic Aura',
    description: '+25% pickup radius.',
    rarity: 'common',
    modifiers: [{ stat: 'pickupRadius', mul: 0.25 }],
    maxStacks: 4,
    kind: 'stat',
  },
  // --- xp gain ---------------------------------------------------------
  {
    id: 'xp_gain',
    name: "Scholar's Focus",
    description: '+15% XP gained.',
    rarity: 'common',
    modifiers: [{ stat: 'xpGain', mul: 0.15 }],
    maxStacks: 5,
    kind: 'stat',
  },

  // --- weapon unlocks (only offered while a slot is free) --------------
  weaponUnlockCard('orbit', 'uncommon'),
  weaponUnlockCard('nova', 'rare'),
  weaponUnlockCard('rail', 'rare'),

  // --- weapon boosts (only offered for owned weapons) -------------------
  weaponBoostCard('bolt'),
  weaponBoostCard('orbit'),
  weaponBoostCard('nova'),
  weaponBoostCard('rail'),

  // --- synergy (build-defining, legendary, real `effect` hooks) --------
  {
    id: 'synergy_glass_cannon',
    name: 'Glass Cannon',
    description: `+${Math.round(TUNING.effects.glassCannon.damageMul * 100)}% damage. Max HP locks to ${Math.round(TUNING.effects.glassCannon.hpCapRatio * 100)}% (heals cap there); every kill grants a brief i-frame.`,
    rarity: 'legendary',
    modifiers: [{ stat: 'damage', mul: TUNING.effects.glassCannon.damageMul }],
    effect: 'glass-cannon',
    maxStacks: 1,
    kind: 'stat',
  },
  {
    id: 'synergy_bulwark',
    name: 'Bulwark',
    description: `+${TUNING.effects.bulwark.maxHpAdd} max HP, +${TUNING.effects.bulwark.regenPerSecondAdd} HP regen/s, ${Math.round(TUNING.effects.bulwark.moveSpeedMul * 100)}% move speed. Contact knockback doubles.`,
    rarity: 'legendary',
    modifiers: [
      { stat: 'maxHp', add: TUNING.effects.bulwark.maxHpAdd },
      { stat: 'regenPerSecond', add: TUNING.effects.bulwark.regenPerSecondAdd },
      { stat: 'moveSpeed', mul: TUNING.effects.bulwark.moveSpeedMul },
    ],
    effect: 'bulwark',
    maxStacks: 1,
    kind: 'stat',
  },
] as const;

/** Names every weapon id that has a dedicated unlock card (`bolt` starts owned, so it has none). */
const UNLOCKABLE_WEAPONS: ReadonlySet<WeaponPattern> = new Set(
  WEAPONS.filter((w) => w.id !== 'bolt').map((w) => w.id),
);

/** Gating context `rollUpgradeChoices` needs to decide which weapon cards are on the table. */
export interface UpgradeRollContext {
  ownedWeapons: readonly WeaponPattern[];
  hasFreeWeaponSlot: boolean;
}

function weaponCardEligible(card: UpgradeDef, ctx: UpgradeRollContext | undefined): boolean {
  if (card.kind === 'stat') return true;
  const weapon = card.weapon;
  if (weapon === undefined) return true;
  if (ctx === undefined) return card.kind !== 'weapon-unlock' && card.kind !== 'weapon-boost';
  const owned = ctx.ownedWeapons.includes(weapon);
  if (card.kind === 'weapon-unlock') return !owned && ctx.hasFreeWeaponSlot && UNLOCKABLE_WEAPONS.has(weapon);
  return owned; // weapon-boost
}

/**
 * Weighted, duplicate-free draw of `count` cards. `taken` is every card id
 * already picked this run (with repeats); a card drops out of the pool once
 * its pick count reaches `maxStacks`, and a single roll never offers the
 * same card twice. `context` additionally gates weapon-unlock/boost cards on
 * the equipped-weapon state (see `UpgradeRollContext`).
 */
export function rollUpgradeChoices(
  rng: Rng,
  taken: readonly string[],
  count: number,
  context?: UpgradeRollContext,
): UpgradeDef[] {
  const pickedCounts = new Map<string, number>();
  for (const id of taken) pickedCounts.set(id, (pickedCounts.get(id) ?? 0) + 1);

  let pool = UPGRADE_CARDS.filter(
    (card) => (pickedCounts.get(card.id) ?? 0) < card.maxStacks && weaponCardEligible(card, context),
  );
  const choices: UpgradeDef[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    const weights = pool.map((card) => RARITY_WEIGHT[card.rarity]);
    const picked = rng.pickWeighted(pool, weights);
    choices.push(picked);
    pool = pool.filter((card) => card.id !== picked.id);
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

/** 6 permanent meta-upgrades spending the run's currency drop between runs. */
export const META_UPGRADES: readonly MetaUpgradeDef[] = [
  {
    id: 'meta_max_hp',
    name: 'Vitality Training',
    description: '+10 max HP per level.',
    maxLevel: 10,
    baseCost: 50,
    costGrowth: 1.35,
    perLevel: { stat: 'maxHp', add: 10 },
  },
  {
    id: 'meta_damage',
    name: 'Combat Drills',
    description: '+5% damage per level.',
    maxLevel: 8,
    baseCost: 60,
    costGrowth: 1.4,
    perLevel: { stat: 'damage', mul: 0.05 },
  },
  {
    id: 'meta_move_speed',
    name: 'Endurance Runs',
    description: '+3% move speed per level.',
    maxLevel: 6,
    baseCost: 40,
    costGrowth: 1.3,
    perLevel: { stat: 'moveSpeed', mul: 0.03 },
  },
  {
    id: 'meta_pickup_radius',
    name: 'Scavenger Instinct',
    description: '+10% pickup radius per level.',
    maxLevel: 5,
    baseCost: 30,
    costGrowth: 1.25,
    perLevel: { stat: 'pickupRadius', mul: 0.1 },
  },
  {
    id: 'meta_regen',
    name: 'Field Medicine',
    description: '+0.2 HP regen per second, per level.',
    maxLevel: 8,
    baseCost: 45,
    costGrowth: 1.35,
    perLevel: { stat: 'regenPerSecond', add: 0.2 },
  },
  {
    id: 'meta_xp_gain',
    name: 'Battle Journal',
    description: '+8% XP gained per level.',
    maxLevel: 6,
    baseCost: 50,
    costGrowth: 1.3,
    perLevel: { stat: 'xpGain', mul: 0.08 },
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
 * content mistake never blocks a build mid-stream.
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
