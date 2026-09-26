/**
 * Hauler classes (PRD-V2 §5.3). Identity = start weapon + stat deltas + one
 * passive. Stat deltas are `StatMod`s folded first by `runLoadout`; passives
 * are applied by their owning system keyed by `loadout.classId`, except
 * Scavenger, which `runLoadout` folds into `veinMul` (the only thing it
 * touches) — no other system may apply it again.
 */
import type { ClassId, StatMod, WeaponId } from './types-v2';

export interface ClassDef {
  id: ClassId; name: string; startWeapon: WeaponId; mods: StatMod[];
  /** Passive name + effect copy. */
  passive: string;
  unlockLevel: number;
  /** Numeric passive parameters for the consumer systems. */
  passiveParams: Readonly<Record<string, number>>;
}

export const CLASSES: readonly ClassDef[] = [
  {
    id: 'duskhauler', name: 'Duskhauler', startWeapon: 'bolt', unlockLevel: 1,
    passive: 'Scavenger: +15% shards from veins and caches', passiveParams: { veinShardsMul: 1.15 },
    mods: [],
  },
  {
    id: 'gravewarden', name: 'Gravewarden', startWeapon: 'orbit', unlockLevel: 10,
    passive: 'Bulwark: contact damage −15%; knockback ×2', passiveParams: { knockbackMul: 2 },
    mods: [
      { stat: 'maxHp', mul: 0.3, source: 'class:gravewarden' },
      { stat: 'moveSpeed', mul: -0.1, source: 'class:gravewarden' },
      // Bulwark's contact half rides the stat system (combat reads `contactDamageMul`).
      { stat: 'contactDamageMul', mul: -0.15, source: 'class:gravewarden' },
    ],
  },
  {
    id: 'ashwitch', name: 'Ashwitch', startWeapon: 'nova', unlockLevel: 16,
    passive: 'Kindling: burn DoTs +25% duration', passiveParams: { burnDurationMul: 1.25 },
    mods: [
      { stat: 'area', add: 0.2, source: 'class:ashwitch' },
      { stat: 'maxHp', add: -20, source: 'class:ashwitch' },
    ],
  },
  {
    id: 'widowblade', name: 'Widowblade', startWeapon: 'rail', unlockLevel: 25,
    passive: 'Grief Edge: crits restore 1 hp (max 5/s)', passiveParams: { critHeal: 1, critHealPerSMax: 5 },
    mods: [
      { stat: 'critChance', add: 0.1, source: 'class:widowblade' },
      { stat: 'maxHp', add: -10, source: 'class:widowblade' },
    ],
  },
];

const BY_ID: Record<string, ClassDef> = Object.fromEntries(CLASSES.map((c) => [c.id, c]));

/** §16.1 E34. */
export function classDef(id: ClassId): ClassDef {
  const def = BY_ID[id];
  if (!def) throw new Error(`classDef: unknown class "${id}"`);
  return def;
}
