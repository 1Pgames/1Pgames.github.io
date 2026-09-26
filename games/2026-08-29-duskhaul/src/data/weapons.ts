import { TUNING } from '../config';
import type { CharmId, CharmSlotView, WeaponId, WeaponSlotView } from './types-v2';

/**
 * Weapon catalog (PRD-V2 §5.8): 12 weapons, each with one evolution unlocked
 * by a partner charm (§5.9). Firing logic lives in `systems/weapons.ts` (one
 * case per id); this file is pure data + pure rules so `data/upgrades.ts`, the
 * headless sim and the selftests read the SAME numbers the scene fires with.
 *
 * Numbers: absolute rank-1 geometry/damage/cadence live in
 * `TUNING.weapons.<id>` (§7 `weapons.<id>.*`); the per-boost growth (§5.8
 * "Rank growth" column) is authored on the row below as `growth`; `weaponStats`
 * is the ONE function that folds both (plus the evolution) into the resolved
 * numbers. Scene and sim both call it.
 */

/**
 * One boost's effect (§5.8 "Rank growth (per boost)"). Additive percentages
 * sum across boosts (three "+25% dmg" boosts = +75%), counts add.
 */
export interface RankStep {
  /** +% of rank-1 damage. */
  damagePct?: number;
  /** % change of the cooldown (negative = faster). */
  cooldownPct?: number;
  /** +projectiles / blades / jumps / skulls / pools / sickles / spikes / lash sides. */
  count?: number;
  /** +enemies a shot passes through. */
  pierce?: number;
  /** +degrees of arc/cone. */
  arcDeg?: number;
  /** +px radius (aura, wake segment, snare blast, totem pulse). */
  radius?: number;
  /** +ms life (wake segment, totem). */
  durationMs?: number;
  /** +ricochets / lob hops. */
  bounces?: number;
  /** +px acquisition range (siphon tether). */
  range?: number;
  /** Δms of the damage tick (negative = faster; aura). */
  tickMs?: number;
  /** +% thrall hp. */
  hpPct?: number;
}

export interface WeaponDef {
  id: WeaponId;
  /** §5.8 name. */
  name: string;
  /** §5.8 pattern column (codex / card copy). */
  pattern: string;
  /** Flavour line for the unlock card and codex. */
  description: string;
  /** Boost 1, 2, 3 in order (`TUNING.weapons.maxBoosts` entries). */
  growth: readonly RankStep[];
  /** Partner charm: rank max + this charm owned (any rank) ⇒ evolution eligible (§5.8). */
  partner: CharmId;
  evolvedName: string;
  /** §5.8 "Evolved stats" column, human form. */
  evolvedDescription: string;
  /** §11 weapon-fx art ids (`weapon-fx` / `weapon-fx-v1` groups); a missing texture falls back to procedural shapes. */
  fx: string;
  fxEvolved: string;
}

export const WEAPONS: readonly WeaponDef[] = [
  {
    id: 'bolt',
    name: 'Rustspike',
    pattern: 'nearest-target projectile',
    description: 'A nail of grave-iron flung at the nearest horror',
    growth: [{ count: 1 }, { damagePct: 20 }, { count: 1 }],
    partner: 'c_oath',
    evolvedName: 'Coffin Nail',
    evolvedDescription: '3 nails, pierce 3, dmg 20',
    fx: 'wpn-bolt',
    fxEvolved: 'wpn-bolt-evo',
  },
  {
    id: 'orbit',
    name: 'Bone Halo',
    pattern: 'orbiting blades',
    description: 'Femurs circling the hauler in a slow wheel',
    growth: [{ count: 1 }, { count: 1 }, { count: 1 }],
    partner: 'c_bell',
    evolvedName: 'Marrow Wheel',
    evolvedDescription: 'radius 380, 4 blades, dmg 10',
    fx: 'wpn-orbit',
    fxEvolved: 'wpn-orbit-evo',
  },
  {
    id: 'nova',
    name: 'Ash Ring',
    pattern: 'radial burst',
    description: 'A burst of cinders in all directions',
    growth: [
      { damagePct: 25, cooldownPct: -10 },
      { damagePct: 25, cooldownPct: -10 },
      { damagePct: 25, cooldownPct: -10 },
    ],
    partner: 'c_drum',
    evolvedName: 'Pyre Shroud',
    evolvedDescription: 'leaves a burn field 3 s, 8 dps, r 320',
    fx: 'wpn-nova',
    fxEvolved: 'wpn-nova-evo',
  },
  {
    id: 'scythe',
    name: 'Gloam Scythe',
    pattern: 'frontal arc',
    description: 'A sweeping arc that reaps everything ahead',
    growth: [{ damagePct: 25 }, { damagePct: 25 }, { damagePct: 25 }],
    partner: 'c_heart',
    evolvedName: 'Dirge Reaper',
    evolvedDescription: '360° sweep, +50% dmg',
    fx: 'wpn-scythe',
    fxEvolved: 'wpn-scythe-evo',
  },
  {
    id: 'rail',
    name: "Widow's Lance",
    pattern: 'piercing beam',
    description: 'A piercing beam through the thickest column of dead',
    growth: [
      { pierce: 1, damagePct: 25 },
      { pierce: 1, damagePct: 25 },
      { pierce: 1, damagePct: 25 },
    ],
    partner: 'c_eye',
    evolvedName: 'Sorrow Piercer',
    evolvedDescription: 'dmg 60, +30% crit chance',
    fx: 'wpn-rail',
    fxEvolved: 'wpn-rail-evo',
  },
  {
    id: 'hex',
    name: 'Thorn Hex',
    pattern: 'chain',
    description: 'A curse that leaps from horror to horror',
    growth: [{ count: 1 }, { count: 1 }, { count: 1 }],
    partner: 'c_tongue',
    evolvedName: 'Rot Chorus',
    evolvedDescription: '6+ jumps, rot 3 s at 6 dps',
    fx: 'wpn-hex',
    fxEvolved: 'wpn-hex-evo',
  },
  {
    id: 'skull',
    name: 'Wailing Skull',
    pattern: 'homing',
    description: 'A screaming skull that hunts on its own',
    growth: [{ count: 1 }, { damagePct: 20 }, { count: 1 }],
    partner: 'c_lodestone',
    evolvedName: 'Choir of Skulls',
    evolvedDescription: '4 skulls, each bursts r 90 for 50%',
    fx: 'wpn-skull',
    fxEvolved: 'wpn-skull-evo',
  },
  {
    id: 'censer',
    name: 'Plague Censer',
    pattern: 'ground pools on enemies',
    description: 'Swung incense that settles as a choking pool',
    growth: [{ count: 1 }, { count: 1 }, { count: 1 }],
    partner: 'c_candle',
    evolvedName: 'Pestilent Thurible',
    evolvedDescription: 'pools r 150, 5 s, slow 30%',
    fx: 'wpn-censer-pool',
    fxEvolved: 'wpn-censer-pool-evo',
  },
  {
    id: 'sickle',
    name: 'Grave Sickle',
    pattern: 'boomerang',
    description: 'A hooked blade that always comes home',
    growth: [{ damagePct: 20 }, { damagePct: 20 }, { damagePct: 20, count: 1 }],
    partner: 'c_spur',
    evolvedName: 'Moon Harvester',
    evolvedDescription: '3 sickles on a spiral, dmg 26',
    fx: 'wpn-sickle',
    fxEvolved: 'wpn-sickle-evo',
  },
  {
    id: 'lash',
    name: 'Thorn Lash',
    pattern: 'horizontal whip',
    description: 'A briar whip cracked to either flank',
    growth: [{ count: 1 }, { damagePct: 20 }, { damagePct: 20 }],
    partner: 'c_mail',
    evolvedName: 'Briar Scourge',
    evolvedDescription: 'both sides, dmg 30, bleed 2 dps 3 s',
    fx: 'wpn-lash',
    fxEvolved: 'wpn-lash-evo',
  },
  {
    id: 'breath',
    name: 'Pyre Breath',
    pattern: 'cone in move direction',
    description: 'Cold spirit-flame exhaled where you walk',
    growth: [
      { arcDeg: 15, damagePct: 20 },
      { arcDeg: 15, damagePct: 20 },
      { arcDeg: 15, damagePct: 20 },
    ],
    partner: 'c_salve',
    evolvedName: 'Cinder Maw',
    evolvedDescription: '90°+ cone, length 360, 2 s, ignite 4 dps, cd 1.6 s',
    fx: 'wpn-breath',
    fxEvolved: 'wpn-breath-evo',
  },
  {
    id: 'spears',
    name: 'Gallows Spears',
    pattern: 'ground eruption',
    description: 'Bone stakes that burst up beneath the dead',
    growth: [{ count: 1 }, { count: 1 }, { count: 1 }],
    partner: 'c_pouch',
    evolvedName: 'Gallows Forest',
    evolvedDescription: '8 spikes in a line to the densest pack, root 1 s',
    fx: 'wpn-spear',
    fxEvolved: 'wpn-spear-evo',
  },
  {
    id: 'aura',
    name: 'Mourning Pall',
    pattern: 'constant damage aura',
    description: 'A shroud of grief that gnaws at anything close',
    growth: [{ radius: 20 }, { damagePct: 30 }, { tickMs: -100 }],
    partner: 'c_pin',
    evolvedName: 'Pall of the Dead',
    evolvedDescription: 'r 200, 10 dmg / 0.35 s, −25% speed inside, kills inside heal',
    fx: 'wpn-aura',
    fxEvolved: 'wpn-aura-evo',
  },
  {
    id: 'chakram',
    name: 'Ossuary Disc',
    pattern: 'ricochet disc',
    description: 'A bone disc that skips from skull to skull',
    growth: [{ bounces: 1 }, { damagePct: 20 }, { count: 1 }],
    partner: 'c_knuckle',
    evolvedName: 'Wheel of Sorrows',
    evolvedDescription: '3 discs, 7 bounces, dmg 20, crits keep the bounce, discs return',
    fx: 'wpn-chakram',
    fxEvolved: 'wpn-chakram-evo',
  },
  {
    id: 'wake',
    name: 'Gloam Wake',
    pattern: 'movement trail',
    description: 'Cold fire left in the footprints of the hauler',
    growth: [{ damagePct: 25 }, { radius: 15 }, { durationMs: 1000 }],
    partner: 'c_sole',
    evolvedName: 'River of Dusk',
    evolvedDescription: 'r 80, 4 s, 14 dmg / 0.4 s, slows 30%',
    fx: 'wpn-wake',
    fxEvolved: 'wpn-wake-evo',
  },
  {
    id: 'snares',
    name: 'Grave Snares',
    pattern: 'proximity mines',
    description: 'Bone traps sown at your heels',
    growth: [{ count: 1, cooldownPct: -10 }, { damagePct: 25 }, { radius: 30 }],
    partner: 'c_fuse',
    evolvedName: 'Ossuary Minefield',
    evolvedDescription: '10 snares, dmg 45, blasts chain within 220 px, root 0.8 s',
    fx: 'wpn-snares',
    fxEvolved: 'wpn-snares-evo',
  },
  {
    id: 'siphon',
    name: 'Marrow Siphon',
    pattern: 'lifesteal tether',
    description: 'A thread of marrow that drinks from the nearest horror',
    growth: [{ range: 60 }, { damagePct: 25 }, { count: 1 }],
    partner: 'c_vial',
    evolvedName: 'Heartdrinker',
    evolvedDescription: '3 tethers, 7 dmg / 0.2 s, heal 6% (cap 6 hp/s), tether passes on a kill',
    fx: 'wpn-siphon',
    fxEvolved: 'wpn-siphon-evo',
  },
  {
    id: 'bombs',
    name: 'Rattle Urns',
    pattern: 'bouncing lob',
    description: 'Funeral urns that burst every time they land',
    growth: [{ bounces: 1 }, { damagePct: 25 }, { count: 1 }],
    partner: 'c_powder',
    evolvedName: 'Ossuary Barrage',
    evolvedDescription: '3 urns, 5 bounces, each bounce throws 2 bone shards',
    fx: 'wpn-bombs',
    fxEvolved: 'wpn-bombs-evo',
  },
  {
    id: 'totem',
    name: 'Dirge Totem',
    pattern: 'placed pulsing beacon',
    description: 'A bone totem that tolls the dead down',
    growth: [{ durationMs: 2000 }, { damagePct: 25 }, { radius: 40 }],
    partner: 'c_hymnal',
    evolvedName: 'Cathedral of Bones',
    evolvedDescription: '2 totems, r 300, pulse 0.6 s, dmg 16, pulls enemies in',
    fx: 'wpn-totem',
    fxEvolved: 'wpn-totem-evo',
  },
  {
    id: 'thralls',
    name: 'Husk Thralls',
    pattern: 'summoned minions',
    description: 'Hollow husks that bite for you',
    growth: [{ count: 1 }, { damagePct: 30, hpPct: 30 }, { count: 1 }],
    partner: 'c_collar',
    evolvedName: 'Legion of the Hollow',
    evolvedDescription: '4 permanent thralls, bite 16, burst on death and return',
    fx: 'wpn-thralls-move',
    fxEvolved: 'wpn-thralls-evo-move',
  },
];

/** Max rank (law, §5.8): rank 1 is the unlock, +1 per boost card. */
export const WEAPON_MAX_RANK = TUNING.weapons.maxBoosts + 1;

/** Rank from boost count: rank 1 at unlock, +1 per boost card taken. */
export function weaponRank(boosts: number): number {
  return 1 + boosts;
}

const BY_ID = new Map<WeaponId, WeaponDef>(WEAPONS.map((w) => [w.id, w]));

export function weaponDef(id: WeaponId): WeaponDef {
  const def = BY_ID.get(id);
  if (def === undefined) throw new Error(`Unknown weapon id "${id}"`);
  return def;
}

/** Runtime state for one equipped weapon slot, owned by `systems/weapons.ts`. */
export interface WeaponState {
  id: WeaponId;
  /** Boost cards taken (0..`TUNING.weapons.maxBoosts`). */
  boosts: number;
  evolved: boolean;
  cooldownMs: number;
  /** Pattern phase: orbit angle (rad), lash side toggle, breath active time. */
  angle: number;
}

export function createWeaponState(id: WeaponId): WeaponState {
  return { id, boosts: 0, evolved: false, cooldownMs: 0, angle: 0 };
}

/**
 * Resolved numbers for one weapon at one rank, BEFORE player stats (area,
 * cooldownMul, damageMul, durationMul, projectileBonus are applied by the
 * caller). Fields a pattern does not use stay 0.
 */
export interface WeaponStats {
  /** Per hit; per tick for `breath`; dps for `censer`. */
  damage: number;
  /** Fire cadence; per-target hit cooldown for `orbit`. */
  cooldownMs: number;
  /** Projectiles / blades / jumps / skulls / pools / sickles / lash sides / spikes. */
  count: number;
  /** Orbit, nova, scythe reach, censer pool, spike radius, sickle out-distance. */
  radius: number;
  pierce: number;
  arcDeg: number;
  /** Rail beam length, lash rect width, breath cone length. */
  length: number;
  /** Lash rect height. */
  width: number;
  /** Censer pool / breath / nova burn-field life. */
  durationMs: number;
  speed: number;
  /** Target acquisition range (censer, spears); 0 = `TUNING.player.range`. */
  range: number;
  tickMs: number;
  critAdd: number;
  /** Status riders: DoT (hex rot, lash bleed, breath ignite, nova burn field). */
  dotDps: number;
  dotMs: number;
  /** Nova burn field radius (evolved Pyre Shroud). */
  fieldRadius: number;
  slowPct: number;
  rootMs: number;
  /** Skull burst on hit (evolved). */
  splashRadius: number;
  splashMul: number;
  telegraphMs: number;
  turnRadPerS: number;
  /** Nova falloff start as a fraction of radius. */
  falloff: number;
  /** Ricochets (disc) / hops (urns). */
  bounces: number;
  /** Thrall hit points. */
  hp: number;
  /** Fraction of damage dealt returned as healing (siphon). */
  healPct: number;
  /** Heal cap per second (siphon evo, aura evo kills). */
  healCapPerS: number;
  /** Heal granted per kill inside the field (aura evo). */
  healPerKill: number;
  /** Totem pull speed toward its centre. */
  pullPxPerS: number;
  /** Urn evo shards per bounce, their damage and range. */
  shards: number;
  shardDamage: number;
  shardRange: number;
  /** Thrall evo death burst damage (radius in `splashRadius`) and respawn delay. */
  burstDamage: number;
  respawnMs: number;
}

function blank(): WeaponStats {
  return {
    damage: 0, cooldownMs: 0, count: 1, radius: 0, pierce: 0, arcDeg: 0, length: 0, width: 0,
    durationMs: 0, speed: 0, range: 0, tickMs: 0, critAdd: 0, dotDps: 0, dotMs: 0, fieldRadius: 0,
    slowPct: 0, rootMs: 0, splashRadius: 0, splashMul: 0, telegraphMs: 0, turnRadPerS: 0, falloff: 0,
    bounces: 0, hp: 0, healPct: 0, healCapPerS: 0, healPerKill: 0, pullPxPerS: 0, shards: 0, shardDamage: 0,
    shardRange: 0, burstDamage: 0, respawnMs: 0,
  };
}

/** Rank-1 numbers straight from `TUNING.weapons.<id>`. */
function baseStats(id: WeaponId): WeaponStats {
  const w = TUNING.weapons;
  const s = blank();
  switch (id) {
    case 'bolt':
      s.damage = w.bolt.baseDamage; s.cooldownMs = w.bolt.cooldownMs; s.speed = w.bolt.speed;
      break;
    case 'orbit':
      s.damage = w.orbit.baseDamage; s.cooldownMs = w.orbit.hitCooldownMs; s.radius = w.orbit.radius; s.count = w.orbit.blades;
      break;
    case 'nova':
      s.damage = w.nova.baseDamage; s.cooldownMs = w.nova.cooldownMs; s.radius = w.nova.radius; s.falloff = w.nova.falloffStart;
      break;
    case 'scythe':
      s.damage = w.scythe.baseDamage; s.cooldownMs = w.scythe.cooldownMs; s.arcDeg = w.scythe.arcDeg; s.radius = w.scythe.radius;
      break;
    case 'rail':
      s.damage = w.rail.baseDamage; s.cooldownMs = w.rail.cooldownMs; s.pierce = w.rail.pierceCount; s.length = w.rail.length;
      break;
    case 'hex':
      s.damage = w.hex.baseDamage; s.cooldownMs = w.hex.cooldownMs; s.count = w.hex.jumps; s.radius = w.hex.jumpPx;
      break;
    case 'skull':
      s.damage = w.skull.baseDamage; s.cooldownMs = w.skull.cooldownMs; s.speed = w.skull.speed;
      s.turnRadPerS = w.skull.turnRadPerS; s.count = w.skull.skulls;
      break;
    case 'censer':
      s.damage = w.censer.dps; s.cooldownMs = w.censer.cooldownMs; s.radius = w.censer.poolRadius;
      s.durationMs = w.censer.poolMs; s.range = w.censer.targetRange; s.count = w.censer.pools;
      break;
    case 'sickle':
      s.damage = w.sickle.baseDamage; s.cooldownMs = w.sickle.cooldownMs; s.radius = w.sickle.outPx; s.count = w.sickle.sickles;
      s.pierce = Number.POSITIVE_INFINITY;
      break;
    case 'lash':
      s.damage = w.lash.baseDamage; s.cooldownMs = w.lash.cooldownMs; s.length = w.lash.width; s.width = w.lash.height;
      break;
    case 'breath':
      s.damage = w.breath.tickDamage; s.tickMs = w.breath.tickMs; s.cooldownMs = w.breath.cooldownMs;
      s.arcDeg = w.breath.coneDeg; s.length = w.breath.length; s.durationMs = w.breath.durationMs;
      break;
    case 'spears':
      s.damage = w.spears.baseDamage; s.cooldownMs = w.spears.cooldownMs; s.count = w.spears.spikes;
      s.radius = w.spears.radius; s.range = w.spears.range; s.telegraphMs = w.spears.telegraphMs;
      break;
    case 'aura':
      // No cooldown (§5.8b.1): the damage tick is the cadence.
      s.radius = w.aura.radius; s.damage = w.aura.tickDamage; s.tickMs = w.aura.tickMs; s.cooldownMs = w.aura.tickMs;
      break;
    case 'chakram':
      s.damage = w.chakram.baseDamage; s.cooldownMs = w.chakram.cooldownMs; s.speed = w.chakram.speed;
      s.radius = w.chakram.size; s.bounces = w.chakram.bounces; s.range = w.chakram.bounceRange; s.count = w.chakram.discs;
      break;
    case 'wake':
      s.radius = w.wake.radius; s.durationMs = w.wake.lifeMs; s.damage = w.wake.tickDamage; s.tickMs = w.wake.tickMs;
      s.cooldownMs = w.wake.tickMs; s.length = w.wake.stepPx;
      break;
    case 'snares':
      s.cooldownMs = w.snares.cooldownMs; s.radius = w.snares.blastRadius; s.damage = w.snares.baseDamage;
      s.count = w.snares.maxLive; s.range = w.snares.triggerRadius; s.telegraphMs = w.snares.armMs;
      break;
    case 'siphon':
      s.damage = w.siphon.tickDamage; s.tickMs = w.siphon.tickMs; s.cooldownMs = w.siphon.tickMs;
      s.range = w.siphon.range; s.healPct = w.siphon.healPct; s.count = w.siphon.tethers;
      break;
    case 'bombs':
      s.cooldownMs = w.bombs.cooldownMs; s.range = w.bombs.range; s.length = w.bombs.hopPx; s.bounces = w.bombs.bounces;
      s.radius = w.bombs.blastRadius; s.damage = w.bombs.baseDamage; s.count = w.bombs.urns;
      break;
    case 'totem':
      s.cooldownMs = w.totem.cooldownMs; s.durationMs = w.totem.lifeMs; s.radius = w.totem.pulseRadius;
      s.tickMs = w.totem.pulseMs; s.damage = w.totem.baseDamage; s.count = w.totem.maxLive;
      break;
    case 'thralls':
      s.cooldownMs = w.thralls.cooldownMs; s.count = w.thralls.maxAlive; s.hp = w.thralls.hp; s.speed = w.thralls.speed;
      s.damage = w.thralls.bite; s.tickMs = w.thralls.biteMs; s.durationMs = w.thralls.lifeMs; s.radius = w.thralls.bodyRadius;
      break;
  }
  return s;
}

/**
 * THE weapon rule (§5.8): rank-1 TUNING numbers + `growth` steps for `boosts`
 * + the evolution. Evolved absolute stats (damage, counts, geometry) never
 * shrink a stat the ranks already grew past — a retuned base can outgrow the
 * §5.8 evolved literal, and an evolution must never be a downgrade (a rank-4 Thorn
 * Hex has 7 jumps, Rot Chorus keeps 7, not 6).
 */
export function weaponStats(id: WeaponId, boosts: number, evolved: boolean): WeaponStats {
  const s = baseStats(id);
  const growth = weaponDef(id).growth;
  let damagePct = 0;
  let cooldownPct = 0;
  let hpPct = 0;
  const steps = Math.min(boosts, growth.length);
  for (let i = 0; i < steps; i += 1) {
    const step = growth[i];
    if (step === undefined) continue;
    damagePct += step.damagePct ?? 0;
    cooldownPct += step.cooldownPct ?? 0;
    s.count += step.count ?? 0;
    s.pierce += step.pierce ?? 0;
    s.arcDeg += step.arcDeg ?? 0;
    s.radius += step.radius ?? 0;
    s.durationMs += step.durationMs ?? 0;
    s.bounces += step.bounces ?? 0;
    s.range += step.range ?? 0;
    hpPct += step.hpPct ?? 0;
    if (step.tickMs !== undefined) {
      s.tickMs += step.tickMs;
      if (id === 'aura') s.cooldownMs = s.tickMs;
    }
  }
  s.hp *= 1 + hpPct / 100;
  s.damage *= 1 + damagePct / 100;
  s.cooldownMs *= Math.max(0.2, 1 + cooldownPct / 100);
  if (!evolved) return s;

  const w = TUNING.weapons;
  switch (id) {
    case 'bolt':
      s.count = Math.max(s.count, w.bolt.evolved.projectiles);
      s.pierce = Math.max(s.pierce, w.bolt.evolved.pierce);
      s.damage = Math.max(s.damage, w.bolt.evolved.damage);
      break;
    case 'orbit':
      s.radius = Math.max(s.radius, w.orbit.evolved.radius);
      s.count = Math.max(s.count, w.orbit.evolved.blades);
      s.damage = Math.max(s.damage, w.orbit.evolved.damage);
      break;
    case 'nova':
      s.dotDps = w.nova.evolved.burnDps;
      s.dotMs = w.nova.evolved.burnMs;
      s.fieldRadius = w.nova.evolved.burnRadius;
      break;
    case 'scythe':
      s.arcDeg = Math.max(s.arcDeg, w.scythe.evolved.arcDeg);
      s.damage *= w.scythe.evolved.damageMul;
      break;
    case 'rail':
      s.damage = Math.max(s.damage, w.rail.evolved.damage);
      s.critAdd = w.rail.evolved.critChanceAdd;
      break;
    case 'hex':
      s.count = Math.max(s.count, w.hex.evolved.jumps);
      s.dotDps = w.hex.evolved.dotDps;
      s.dotMs = w.hex.evolved.dotMs;
      break;
    case 'skull':
      s.count = Math.max(s.count, w.skull.evolved.skulls);
      s.splashRadius = w.skull.evolved.explodeRadius;
      s.splashMul = w.skull.evolved.explodeDamageMul;
      break;
    case 'censer':
      s.radius = Math.max(s.radius, w.censer.evolved.poolRadius);
      s.durationMs = Math.max(s.durationMs, w.censer.evolved.poolMs);
      s.slowPct = w.censer.evolved.slowPct;
      break;
    case 'sickle':
      s.count = Math.max(s.count, w.sickle.evolved.sickles);
      s.damage = Math.max(s.damage, w.sickle.evolved.damage);
      break;
    case 'lash':
      s.count = 2;
      s.damage = Math.max(s.damage, w.lash.evolved.damage);
      s.dotDps = w.lash.evolved.bleedDps;
      s.dotMs = w.lash.evolved.bleedMs;
      break;
    case 'breath':
      s.arcDeg = Math.max(s.arcDeg, w.breath.evolved.coneDeg);
      s.length = Math.max(s.length, w.breath.evolved.length);
      s.durationMs = Math.max(s.durationMs, w.breath.evolved.durationMs);
      s.dotDps = w.breath.evolved.igniteDps;
      s.dotMs = w.breath.evolved.durationMs;
      s.cooldownMs = Math.min(s.cooldownMs, w.breath.evolved.cooldownMs);
      break;
    case 'spears':
      s.count = Math.max(s.count, w.spears.evolved.spikes);
      s.rootMs = w.spears.evolved.rootMs;
      break;
    case 'aura':
      s.radius = Math.max(s.radius, w.aura.evolved.radius);
      s.damage = Math.max(s.damage, w.aura.evolved.tickDamage);
      s.tickMs = Math.min(s.tickMs, w.aura.evolved.tickMs);
      s.cooldownMs = s.tickMs;
      s.slowPct = w.aura.evolved.slowPct;
      s.healPerKill = w.aura.evolved.healPerKill;
      s.healCapPerS = w.aura.evolved.healCapPerS;
      break;
    case 'chakram':
      s.count = Math.max(s.count, w.chakram.evolved.discs);
      s.bounces = Math.max(s.bounces, w.chakram.evolved.bounces);
      s.damage = Math.max(s.damage, w.chakram.evolved.damage);
      break;
    case 'wake':
      s.radius = Math.max(s.radius, w.wake.evolved.radius);
      s.durationMs = Math.max(s.durationMs, w.wake.evolved.lifeMs);
      s.damage = Math.max(s.damage, w.wake.evolved.tickDamage);
      s.slowPct = w.wake.evolved.slowPct;
      break;
    case 'snares':
      s.count = Math.max(s.count, w.snares.evolved.maxLive);
      s.damage = Math.max(s.damage, w.snares.evolved.damage);
      s.fieldRadius = w.snares.evolved.chainRadius;
      s.rootMs = w.snares.evolved.rootMs;
      break;
    case 'siphon':
      s.count = Math.max(s.count, w.siphon.evolved.tethers);
      s.damage = Math.max(s.damage, w.siphon.evolved.tickDamage);
      s.healPct = Math.max(s.healPct, w.siphon.evolved.healPct);
      s.healCapPerS = w.siphon.evolved.healCapPerS;
      break;
    case 'bombs':
      s.count = Math.max(s.count, w.bombs.evolved.urns);
      s.bounces = Math.max(s.bounces, w.bombs.evolved.bounces);
      s.shards = w.bombs.evolved.shardsPerBounce;
      s.shardDamage = w.bombs.evolved.shardDamage;
      s.shardRange = w.bombs.evolved.shardRange;
      break;
    case 'totem':
      s.count = Math.max(s.count, w.totem.evolved.maxLive);
      s.radius = Math.max(s.radius, w.totem.evolved.pulseRadius);
      s.tickMs = Math.min(s.tickMs, w.totem.evolved.pulseMs);
      s.damage = Math.max(s.damage, w.totem.evolved.damage);
      s.pullPxPerS = w.totem.evolved.pullPxPerS;
      break;
    case 'thralls':
      s.count = Math.max(s.count, w.thralls.evolved.maxAlive);
      s.damage = Math.max(s.damage, w.thralls.evolved.bite);
      s.durationMs = Number.POSITIVE_INFINITY;
      s.splashRadius = w.thralls.evolved.burstRadius;
      s.burstDamage = w.thralls.evolved.burstDamage;
      s.respawnMs = w.thralls.evolved.respawnMs;
      break;
  }
  return s;
}

/**
 * THE evolution eligibility rule (§5.8): the weapon sits at max rank, is not
 * evolved yet, and its partner charm is owned at any rank. Slot order.
 * Read by `WeaponSystem.evolutionEligible`, `data/upgrades.ts`, and the sim.
 */
export function evolutionReady(
  weapons: readonly WeaponSlotView[],
  charms: readonly CharmSlotView[],
): WeaponId[] {
  const out: WeaponId[] = [];
  for (const w of weapons) {
    if (w.evolved || w.rank < WEAPON_MAX_RANK) continue;
    const partner = weaponDef(w.id).partner;
    if (charms.some((c) => c.id === partner)) out.push(w.id);
  }
  return out;
}

/** Weapon-side effects of equipped uniques (§5.15.4). */
export interface UniqueRiders {
  /** Extra Bone Halo / Marrow Wheel blades. */
  orbitBlades: number;
  /** Subtracted from the Gloam Step cooldown (floored at 0). */
  stepCdMs: number;
  /** Multiplier on every burn/DoT/ground-pool tick. */
  dotMul: number;
}

/**
 * Weapon riders keyed by unique id (`RunLoadoutV2.uniques`, §5.15.4 rows in
 * `data/gear.ts`; the stat half of each unique is applied by `runLoadout`).
 */
const UNIQUE_WEAPON_RIDERS: Record<string, Partial<UniqueRiders>> = {
  u_bellrope: { orbitBlades: 2 },
  u_gibbetboots: { stepCdMs: 1000 },
  u_suneater: { dotMul: 1.4 },
};

/** Folds the riders of every equipped unique id. Unknown or non-weapon unique ids contribute nothing. */
export function uniqueRiders(uniques: readonly string[]): UniqueRiders {
  const out: UniqueRiders = { orbitBlades: 0, stepCdMs: 0, dotMul: 1 };
  for (const id of uniques) {
    const rider = UNIQUE_WEAPON_RIDERS[id];
    if (rider === undefined) continue;
    out.orbitBlades += rider.orbitBlades ?? 0;
    out.stepCdMs += rider.stepCdMs ?? 0;
    out.dotMul *= rider.dotMul ?? 1;
  }
  return out;
}
