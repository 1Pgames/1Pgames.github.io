import type { Modifier } from '../core/stats';
import type { Rng } from '../core/rng';

/**
 * Data-driven upgrade catalog: the "pick 1 of 3" in-run cards handed out on
 * level-up, and the permanent meta-upgrades bought between runs with meta
 * currency. Every card is plain data (id/name/description/`Modifier[]`) so
 * `ui/cards.ts` and `core/progression.ts` never hardcode a single number —
 * add a build by adding an entry here, not by branching in scene code.
 *
 * Use for: roguelike / survivor-like / tower-defense games with in-run stat
 * builds and a between-run economy.
 * Do NOT use for: games with no meta progression or no run-time leveling —
 * plain `TUNING` constants are simpler there.
 */

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

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
  /** Stat changes this card grants; source is always `upgrade:<id>`. */
  modifiers: Array<Omit<Modifier, 'source'>>;
  /**
   * Behavioral hook for cards that are more than a stat tweak (e.g. lifesteal
   * on hit, chain explosions on crit). The scene's upgrade-effect switch
   * looks this up; pure stat cards leave it undefined.
   */
  effect?: string;
  /** How many times this card can be taken in one run. */
  maxStacks: number;
}

/**
 * 14 category cards (damage, attack speed, projectile count, area, move
 * speed, max HP, regen, crit chance/mult, pickup radius, XP gain) plus 2
 * build-defining synergy cards. Common cards are broad and safe; legendary
 * cards trade one stat for another so a run develops a real identity.
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
  },
  {
    id: 'dmg_mul',
    name: 'Honed Technique',
    description: '+15% damage.',
    rarity: 'uncommon',
    modifiers: [{ stat: 'damage', mul: 0.15 }],
    maxStacks: 5,
  },
  {
    id: 'dmg_mul_big',
    name: 'Overwhelming Force',
    description: '+30% damage.',
    rarity: 'rare',
    modifiers: [{ stat: 'damage', mul: 0.3 }],
    maxStacks: 3,
  },
  // --- attack speed ----------------------------------------------------
  {
    id: 'atk_speed',
    name: 'Quick Hands',
    description: '+12% attack speed.',
    rarity: 'common',
    modifiers: [{ stat: 'attackSpeed', mul: 0.12 }],
    maxStacks: 6,
  },
  {
    id: 'atk_speed_big',
    name: 'Blur of Motion',
    description: '+25% attack speed.',
    rarity: 'rare',
    modifiers: [{ stat: 'attackSpeed', mul: 0.25 }],
    maxStacks: 3,
  },
  // --- projectile count -------------------------------------------------
  {
    id: 'projectile_count',
    name: 'Split Shot',
    description: '+1 projectile per attack.',
    rarity: 'uncommon',
    modifiers: [{ stat: 'projectiles', add: 1 }],
    maxStacks: 4,
  },
  // --- area ------------------------------------------------------------
  {
    id: 'area_mul',
    name: 'Wider Reach',
    description: '+20% attack area.',
    rarity: 'uncommon',
    modifiers: [{ stat: 'areaMul', mul: 0.2 }],
    maxStacks: 5,
  },
  // --- move speed --------------------------------------------------------
  {
    id: 'move_speed',
    name: 'Light Footwork',
    description: '+8% move speed.',
    rarity: 'common',
    modifiers: [{ stat: 'moveSpeed', mul: 0.08 }],
    maxStacks: 5,
  },
  // --- max hp ------------------------------------------------------------
  {
    id: 'max_hp',
    name: 'Thicker Hide',
    description: '+20 max HP.',
    rarity: 'common',
    modifiers: [{ stat: 'maxHp', add: 20 }],
    maxStacks: 8,
  },
  // --- regen ---------------------------------------------------------
  {
    id: 'regen',
    name: 'Steady Pulse',
    description: '+0.5 HP regenerated per second.',
    rarity: 'uncommon',
    modifiers: [{ stat: 'regenPerSecond', add: 0.5 }],
    maxStacks: 6,
  },
  // --- crit ------------------------------------------------------------
  {
    id: 'crit_chance',
    name: 'Weak Point Sense',
    description: '+8% critical hit chance.',
    rarity: 'uncommon',
    modifiers: [{ stat: 'critChance', add: 0.08 }],
    maxStacks: 5,
  },
  {
    id: 'crit_mul',
    name: 'Executioner',
    description: '+50% critical damage.',
    rarity: 'rare',
    modifiers: [{ stat: 'critMul', mul: 0.5 }],
    maxStacks: 3,
  },
  // --- pickup radius ---------------------------------------------------
  {
    id: 'pickup_radius',
    name: 'Magnetic Aura',
    description: '+25% pickup radius.',
    rarity: 'common',
    modifiers: [{ stat: 'pickupRadius', mul: 0.25 }],
    maxStacks: 4,
  },
  // --- xp gain ---------------------------------------------------------
  {
    id: 'xp_gain',
    name: "Scholar's Focus",
    description: '+15% XP gained.',
    rarity: 'common',
    modifiers: [{ stat: 'xpGain', mul: 0.15 }],
    maxStacks: 5,
  },
  // --- synergy (build-defining, legendary) ------------------------------
  {
    id: 'synergy_glass_cannon',
    name: 'Glass Cannon',
    description: '+50% damage, -20% max HP. Every hit becomes a threat.',
    rarity: 'legendary',
    modifiers: [
      { stat: 'damage', mul: 0.5 },
      { stat: 'maxHp', mul: -0.2 },
    ],
    effect: 'glass-cannon',
    maxStacks: 1,
  },
  {
    id: 'synergy_bulwark',
    name: 'Bulwark',
    description: '+40% max HP, +30% area, -15% move speed. Stand and clear the room.',
    rarity: 'legendary',
    modifiers: [
      { stat: 'maxHp', mul: 0.4 },
      { stat: 'areaMul', mul: 0.3 },
      { stat: 'moveSpeed', mul: -0.15 },
    ],
    effect: 'bulwark',
    maxStacks: 1,
  },
] as const;

/**
 * Weighted, duplicate-free draw of `count` cards. `taken` is every card id
 * already picked this run (with repeats); a card drops out of the pool once
 * its pick count reaches `maxStacks`, and a single roll never offers the
 * same card twice.
 */
export function rollUpgradeChoices(
  rng: Rng,
  taken: readonly string[],
  count: number,
): UpgradeDef[] {
  const pickedCounts = new Map<string, number>();
  for (const id of taken) pickedCounts.set(id, (pickedCounts.get(id) ?? 0) + 1);

  let pool = UPGRADE_CARDS.filter((card) => (pickedCounts.get(card.id) ?? 0) < card.maxStacks);
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

/** `cost(level) = round(baseCost * costGrowth ^ level)` — `level` is the level about to be bought (0-indexed). */
export function upgradeCost(def: MetaUpgradeDef, level: number): number {
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
