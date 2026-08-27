import { TUNING } from '../config';

/**
 * Weapon catalog: the depth ceiling above the single starting auto-attack.
 * Each `WeaponDef` is a pattern tag plus a display name/description; the
 * actual firing logic lives in `systems/combat.ts` (one case per pattern) so
 * this file stays pure data, and `data/upgrades.ts` references weapon ids by
 * string to build unlock/boost cards without importing combat code.
 *
 * `bolt` is always held (the starting weapon, unlock card never offered for
 * it); `orbit`, `nova`, `rail` are unlocked via upgrade cards up to
 * `TUNING.weapons.maxSlots` total equipped weapons.
 */

export type WeaponPattern = 'bolt' | 'orbit' | 'nova' | 'rail';

export interface WeaponDef {
  id: WeaponPattern;
  name: string;
  description: string;
  /** Evolution name shown once every boost card for this weapon is maxed. */
  evolvedName: string;
  evolvedDescription: string;
}

export const WEAPONS: readonly WeaponDef[] = [
  {
    id: 'bolt',
    name: 'Auto Bolt',
    description: 'Fires an aimed bolt at the nearest enemy in range.',
    evolvedName: 'Twin Volley',
    evolvedDescription: 'Fires two aimed bolts per shot, one at the nearest two targets.',
  },
  {
    id: 'orbit',
    name: 'Orbit Blade',
    description: 'A blade circles you, damaging any enemy it touches.',
    evolvedName: 'Blade Storm',
    evolvedDescription: 'One extra blade and a wider orbit radius.',
  },
  {
    id: 'nova',
    name: 'Nova Burst',
    description: 'Periodic radial burst; damage falls off with distance.',
    evolvedName: 'Double Pulse',
    evolvedDescription: 'Fires two pulses back-to-back on every cooldown.',
  },
  {
    id: 'rail',
    name: 'Rail Shot',
    description: 'Piercing line shot fired through the densest cluster of enemies.',
    evolvedName: 'Wide Rail',
    evolvedDescription: 'Wider piercing shot that hits more enemies per cluster.',
  },
] as const;

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
  /** True once `boosts >= TUNING.weapons.maxBoosts` and the evolution has fired. */
  evolved: boolean;
  cooldownMs: number;
  /** `orbit` blade angle in radians; unused by other patterns. */
  angle: number;
}

export function createWeaponState(id: WeaponPattern): WeaponState {
  return { id, boosts: 0, evolved: false, cooldownMs: 0, angle: 0 };
}

/** Reads the boost-scaled damage multiplier for a weapon (1 + boosts * per-boost step). */
export function weaponBoostDamageMul(id: WeaponPattern, boosts: number): number {
  const step =
    id === 'bolt'
      ? TUNING.weapons.bolt.boostDamageMul
      : id === 'orbit'
        ? TUNING.weapons.orbit.boostDamageMul
        : id === 'nova'
          ? TUNING.weapons.nova.boostDamageMul
          : TUNING.weapons.rail.boostDamageMul;
  return 1 + step * boosts;
}
