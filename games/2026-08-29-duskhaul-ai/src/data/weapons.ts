import { TUNING } from '../config';

/**
 * Weapon catalog (PRD §5.3): 6 weapons, each with an evolution, filling up to
 * `TUNING.weapons.maxSlots` slots (§7 `weapon.slots` = 4). Firing logic lives
 * in `systems/combat.ts` — one case per `WeaponPattern` — so this file stays
 * pure data and `data/upgrades.ts` builds unlock/boost/evolution cards from it
 * without importing combat code.
 *
 * `bolt` (Rustspike) is the starting weapon and never gets an unlock card.
 * The other five are unlocked by draft cards; every weapon then ranks 1..5 via
 * its boost card and evolves at max rank once its gate card is owned (§5.3).
 *
 * Numbers here are §5 CONTENT columns, not §7 tuning: §7's frozen key list
 * names only `weapon.slots` and `weapon.maxRank` for weapons (both read from
 * `TUNING` below), so per-weapon damage/cadence belongs with the weapon row,
 * exactly as per-enemy stats belong with the enemy row.
 */

export type WeaponPattern = 'bolt' | 'orbit' | 'nova' | 'rail' | 'scythe' | 'hex';

/**
 * §5.3 rank rule: a boost card grants "+25% dmg OR +1 projectile per rank".
 * One number for the whole cast — a weapon takes one side of that "or" via
 * `rankGrowth`.
 */
export const RANK_DAMAGE_STEP = 0.25;

/**
 * How a weapon converts ranks into power. `damageStep` is a +fraction of base
 * damage per rank above 1; `countStep` adds projectiles/bones/chain jumps per
 * rank. A weapon uses one or the other (§5.3), never both.
 */
export interface WeaponRankGrowth {
  damageStep: number;
  countStep?: number;
}

export interface WeaponDef {
  id: WeaponPattern;
  /** §5.3 flavor name. */
  name: string;
  /** §5.3 flavor description, verbatim. */
  description: string;
  /** Damage per hit (per tick for `orbit`, which is continuous). */
  baseDamage: number;
  /** Fire cadence; `null` = continuous contact damage (`orbit`). */
  cooldownMs: number | null;
  rankGrowth: WeaponRankGrowth;
  /** Pattern geometry the combat case reads (arc degrees, chain jumps, ...). */
  params?: Record<string, number>;
  /** Evolution name shown once the weapon is at max rank (§5.3). */
  evolvedName: string;
  /** §5.3 evolution effect text, verbatim. */
  evolvedDescription: string;
  /**
   * Gate card id (`data/upgrades.ts`): the evolution card only enters the
   * draft pool once this card is owned AND the weapon sits at max rank.
   */
  evolutionRequiresCard: string;
  /** Damage after evolving; omitted when the evolution changes shape, not damage. */
  evolvedDamage?: number;
  /** Evolution geometry/riders the combat case reads. */
  evolvedParams?: Record<string, number>;
}

export const WEAPONS: readonly WeaponDef[] = [
  {
    id: 'bolt',
    name: 'Rustspike',
    description: 'A nail of grave-iron flung at the nearest horror',
    baseDamage: 8,
    cooldownMs: 900,
    rankGrowth: { damageStep: RANK_DAMAGE_STEP },
    evolvedName: 'Coffin Nail',
    evolvedDescription: 'pierce 3, dmg 20',
    evolutionRequiresCard: 'stat_might',
    evolvedDamage: 20,
    evolvedParams: { pierce: 3 },
  },
  {
    id: 'orbit',
    name: 'Bone Halo',
    description: 'Femurs circling the hauler in a slow wheel',
    baseDamage: 6,
    cooldownMs: null,
    // Trades the damage side of §5.3's "or" for one extra femur per rank.
    rankGrowth: { damageStep: 0, countStep: 1 },
    params: { bones: 2, radiusPx: 150, hitCooldownMs: 380 },
    evolvedName: 'Marrow Wheel',
    evolvedDescription: '2x radius, +2 bones',
    evolutionRequiresCard: 'stat_area',
    evolvedParams: { radiusMul: 2, bonesAdd: 2 },
  },
  {
    id: 'nova',
    name: 'Ash Ring',
    description: 'A burst of cinders in all directions',
    baseDamage: 10,
    cooldownMs: 1600,
    rankGrowth: { damageStep: RANK_DAMAGE_STEP },
    params: { radiusPx: 260, falloffStart: 0.4 },
    evolvedName: 'Pyre Shroud',
    evolvedDescription: 'leaves a 3s burn field, 4 dps',
    evolutionRequiresCard: 'stat_haste',
    evolvedParams: { burnFieldS: 3, burnDps: 4 },
  },
  {
    id: 'rail',
    name: "Widow's Lance",
    description: 'A piercing beam through the thickest column of dead',
    baseDamage: 24,
    cooldownMs: 2200,
    rankGrowth: { damageStep: RANK_DAMAGE_STEP },
    params: { pierce: 4 },
    evolvedName: 'Sorrow Piercer',
    evolvedDescription: 'dmg 60, +30% crit',
    evolutionRequiresCard: 'stat_crit',
    evolvedDamage: 60,
    evolvedParams: { critChanceAdd: 0.3 },
  },
  {
    id: 'scythe',
    name: 'Gloam Scythe',
    description: 'A sweeping arc that reaps everything ahead',
    baseDamage: 14,
    cooldownMs: 1200,
    rankGrowth: { damageStep: RANK_DAMAGE_STEP },
    // NEW pattern `arc`: 140 degree frontal sweep, r=140.
    params: { arcDeg: 140, radiusPx: 140 },
    evolvedName: 'Dirge Reaper',
    evolvedDescription: '360 degree sweep, +50% dmg',
    evolutionRequiresCard: 'stat_might',
    evolvedParams: { arcDeg: 360, damageMul: 0.5 },
  },
  {
    id: 'hex',
    name: 'Thorn Hex',
    description: 'A curse that leaps between up to 4 horrors',
    baseDamage: 9,
    cooldownMs: 1400,
    // Trades damage for reach: one extra chain jump per rank.
    rankGrowth: { damageStep: 0, countStep: 1 },
    // NEW pattern `chain`: 4 jumps, 200px apart.
    params: { jumps: 4, jumpRangePx: 200 },
    evolvedName: 'Rot Chorus',
    evolvedDescription: '6 jumps, applies 3s DoT 3 dps',
    evolutionRequiresCard: 'stat_greed',
    evolvedParams: { jumps: 6, dotS: 3, dotDps: 3 },
  },
];

/** The weapon every run starts with (§5.3). */
export const STARTING_WEAPON: WeaponPattern = 'bolt';

/**
 * Max rank (§7 `weapon.maxRank` = 5). Rank 1 is the unlock, so a weapon needs
 * `TUNING.weapons.maxBoosts` boost cards to reach it — the boost card's stack
 * limit and the evolution gate are the same number by construction.
 */
export const WEAPON_MAX_RANK = TUNING.weapons.maxBoosts + 1;

/** Rank from boost count: rank 1 at unlock, +1 per boost card taken. */
export function weaponRank(boosts: number): number {
  return 1 + boosts;
}

const BY_ID: Record<WeaponPattern, WeaponDef> = {} as Record<WeaponPattern, WeaponDef>;
for (const weapon of WEAPONS) BY_ID[weapon.id] = weapon;

export function weaponDef(id: WeaponPattern): WeaponDef {
  const def = BY_ID[id];
  if (def === undefined) throw new Error(`Unknown weapon id "${id}"`);
  return def;
}

/** Runtime state for one equipped weapon slot, owned by `CombatSystem`. */
export interface WeaponState {
  id: WeaponPattern;
  /** How many boost cards this weapon has taken (0..TUNING.weapons.maxBoosts). */
  boosts: number;
  /** True once the evolution card has been taken and applied. */
  evolved: boolean;
  cooldownMs: number;
  /** `orbit` blade angle in radians; unused by other patterns. */
  angle: number;
}

export function createWeaponState(id: WeaponPattern): WeaponState {
  return { id, boosts: 0, evolved: false, cooldownMs: 0, angle: 0 };
}

/**
 * Boost-scaled damage multiplier (1 + step * boosts). Weapons that take the
 * projectile side of §5.3's "or" (`orbit`, `hex`) have a zero damage step and
 * grow through `countStep` instead — read that with `weaponRankCount`.
 */
export function weaponBoostDamageMul(id: WeaponPattern, boosts: number): number {
  return 1 + weaponDef(id).rankGrowth.damageStep * boosts;
}

/**
 * Rank-scaled projectile/bone/chain-jump count for a weapon whose ranks buy
 * count instead of damage. `baseKey` names the entry in the weapon's `params`
 * holding the rank-1 count (`bones` for `orbit`, `jumps` for `hex`).
 */
export function weaponRankCount(id: WeaponPattern, boosts: number, baseKey: string): number {
  const def = weaponDef(id);
  const base = def.params?.[baseKey] ?? 0;
  return base + (def.rankGrowth.countStep ?? 0) * boosts;
}
