import { PALETTE, TUNING } from '../config';
import type { ZoneId } from './zones';

/**
 * Duskhaul's enemy roster (PRD §5.2 shared cast, §5.2b elites + the Gate
 * Warden, §5.7 zone-exclusive spawns). Implements the frozen §16.1 `EnemyDef`
 * contract: `stats` (with `shards`, this game's kill currency), the 13-verb
 * `behaviour` union, the optional `zone` tag and `firstSeenS`.
 *
 * Shape rules that keep the table honest:
 * - `behaviour` is the ONLY thing spawn/AI code switches on. A verb means the
 *   same thing for every row that carries it; per-row numbers that a verb
 *   cannot carry live in `params`, never in a second behaviour verb.
 * - `zone` absent = shared roster (all four zones). `zone` set = exclusive,
 *   and it only enters that zone's spawn table (§5.7).
 * - Elite and Warden HP are quoted in §5.2b as MULTIPLES of a grunt, so they
 *   are computed from `GRUNT_REFERENCE_HP * ELITE_HP_MUL` / `boss.hpMul`
 *   instead of being written out — the 6x/40x ladder stays in `TUNING`.
 *
 * Use `scaleEnemy` for every spawn: raw `stats` are the phase-1 baseline.
 */

export type EnemyBehaviour =
  | 'chase'
  | 'swarm'
  | 'ranged'
  | 'orbit-charge'
  | 'tank'
  | 'drift'
  | 'burst'
  | 'split'
  | 'aura'
  | 'flee'
  | 'teleport'
  | 'elite'
  | 'boss';

export interface EnemyStats {
  maxHp: number;
  damage: number;
  moveSpeed: number;
  /** XP granted to the player on death. */
  xp: number;
  /** Shards dropped on death — carried loot, banked only on extraction. */
  shards: number;
}

export interface EnemyDef {
  id: string;
  /** §5.2 flavor name, shown in kill feeds / bestiary rows. */
  name: string;
  /** §5.2 one-line flavor description. */
  desc: string;
  texture: string;
  /** Sprite display size in px (both axes; textures are square). */
  size: number;
  stats: EnemyStats;
  behaviour: EnemyBehaviour;
  /** Absent = shared roster; set = only spawns in that zone (§5.7). */
  zone?: ZoneId;
  /** Run second this archetype first enters the spawn table. */
  firstSeenS: number;
  /** Particle/damage-flash colour. Generated art is never tinted. */
  tint: number;
  /**
   * Behaviour parameters a verb cannot carry on its own (ranged reach, burst
   * radius, aura strength, blink cadence, enrage threshold...). Same shape as
   * `ZoneDef.hazard.params`; each verb documents the keys it reads below.
   */
  params?: Record<string, number>;
  /**
   * Death spawns, for archetypes that split into a DIFFERENT archetype.
   * Duskhaul's splitter (marrowworm) reproduces ITSELF at reduced HP, which
   * `behaviour: 'split'` + `params.splitCount/splitHpRatio/splitGenerations`
   * describes, so no row sets this — it stays because the pooled `Enemy` and
   * the sim both branch on it for the generic case.
   */
  splitInto?: readonly string[];
  /**
   * Heal-pulse support flag. Duskhaul's only aura unit (dirgebell) HASTENS the
   * dead rather than healing them (`behaviour: 'aura'` + `params.auraSpeedMul`),
   * so no row sets this either; it stays for the same consumer reason.
   */
  healAura?: boolean;
  /** Drops pooled shard/coin pickups on death — elites and the Warden. */
  eliteDrop?: boolean;
}

/**
 * The grunt HP every §5.2b multiplier is quoted against: Grave Husk's base
 * (§6 worked example uses the same reference — "hp 6x grunt-at-phase").
 */
const GRUNT_REFERENCE_HP = 18;

/**
 * §5.2b quotes elite and Warden HP as MULTIPLES of a phase grunt, and §7 names
 * `elite.hpMul` (6) and `boss.hpMul` (40) as TUNING keys — but `TUNING.elite`
 * and `TUNING.boss` do not carry them yet (`src/config.ts` is W6's file, and
 * the §7 pass has not landed). They live here until then; W6 replaces both
 * with the TUNING reads in one edit, and nothing else in this file changes.
 */
const ELITE_HP_MUL = 6;
const BOSS_HP_MUL = 40;

/** 12 shared archetypes (§5.2) — present in every zone. */
const SHARED: readonly EnemyDef[] = [
  {
    id: 'husk',
    name: 'Grave Husk',
    desc: 'A dried corpse that shuffles toward warm blood',
    texture: 'enemy-husk-move',
    size: 40,
    stats: { maxHp: GRUNT_REFERENCE_HP, damage: 6, moveSpeed: 80, xp: 4, shards: 1 },
    behaviour: 'chase',
    firstSeenS: 0,
    tint: PALETTE.inkSoft,
  },
  {
    id: 'wretch',
    name: 'Gloam Wretch',
    desc: 'A hunched scavenger that sprints in ragged bursts',
    texture: 'enemy-wretch-move',
    size: 36,
    stats: { maxHp: 12, damage: 5, moveSpeed: 150, xp: 4, shards: 1 },
    behaviour: 'chase',
    firstSeenS: 30,
    tint: PALETTE.inkSoft,
  },
  {
    id: 'ratking',
    name: 'Rot Ratking',
    desc: 'A knot of graveyard rats moving as one',
    texture: 'enemy-ratking-move',
    size: 32,
    stats: { maxHp: 8, damage: 4, moveSpeed: 120, xp: 3, shards: 1 },
    behaviour: 'swarm',
    firstSeenS: 45,
    tint: PALETTE.bad,
    // `swarm`: spawns and moves as a pack of this size (§5.4 "6-pack").
    params: { packSize: 6 },
  },
  {
    id: 'bonecaster',
    name: 'Bonecaster',
    desc: 'A robed skeleton lobbing marrow darts',
    texture: 'enemy-bonecaster-move',
    size: 44,
    stats: { maxHp: 24, damage: 8, moveSpeed: 60, xp: 6, shards: 3 },
    behaviour: 'ranged',
    firstSeenS: 90,
    tint: PALETTE.ink,
    // `ranged`: holds at `rangePx` and lobs a marrow dart every `fireEveryMs`.
    params: { rangePx: 320, fireEveryMs: 1500 },
  },
  {
    id: 'thornhound',
    name: 'Thornhound',
    desc: 'A briar-wrapped hound that circles before lunging',
    texture: 'enemy-thornhound-move',
    size: 46,
    stats: { maxHp: 30, damage: 10, moveSpeed: 130, xp: 6, shards: 3 },
    behaviour: 'orbit-charge',
    firstSeenS: 120,
    tint: PALETTE.bad,
    // `orbit-charge`: circles at `orbitRadiusPx`, then dashes after a windup.
    params: { orbitRadiusPx: 220, windupMs: 500 },
  },
  {
    id: 'paleknight',
    name: 'Pale Knight',
    desc: 'Rusted plate animated by spite; slow, wide blade',
    texture: 'enemy-paleknight-move',
    size: 56,
    stats: { maxHp: 90, damage: 14, moveSpeed: 55, xp: 12, shards: 5 },
    behaviour: 'tank',
    firstSeenS: 150,
    tint: PALETTE.inkSoft,
    // `tank`: walks straight through the horde, wide melee arc.
    params: { swingArcDeg: 120, swingReachPx: 90 },
  },
  {
    id: 'shroudmoth',
    name: 'Shroudmoth',
    desc: 'A moth of grave-silk that drifts through walls',
    texture: 'enemy-shroudmoth-move',
    size: 38,
    stats: { maxHp: 16, damage: 7, moveSpeed: 100, xp: 5, shards: 2 },
    behaviour: 'drift',
    firstSeenS: 180,
    tint: PALETTE.secondary,
    // `drift`: ignores props and arena collision entirely.
    params: { ignoresProps: 1 },
  },
  {
    id: 'pyreling',
    name: 'Pyreling',
    desc: 'A candle-flame spirit that bursts on death',
    texture: 'enemy-pyreling-move',
    size: 34,
    stats: { maxHp: 14, damage: 12, moveSpeed: 110, xp: 5, shards: 2 },
    behaviour: 'burst',
    firstSeenS: 210,
    tint: PALETTE.accent,
    // `burst`: chases, then detonates for `burstDamage` in `burstRadiusPx`.
    params: { burstDamage: 12, burstRadiusPx: 80 },
  },
  {
    id: 'marrowworm',
    name: 'Marrowworm',
    desc: 'A segmented burrower that splits when cut',
    texture: 'enemy-marrowworm-move',
    size: 48,
    stats: { maxHp: 40, damage: 9, moveSpeed: 70, xp: 8, shards: 4 },
    behaviour: 'split',
    firstSeenS: 240,
    tint: PALETTE.bad,
    // `split`: on death spawns `splitCount` copies of ITSELF at
    // `splitHpRatio` HP, for `splitGenerations` generations (so the chain
    // terminates instead of multiplying forever).
    params: { splitCount: 2, splitHpRatio: 0.5, splitGenerations: 1 },
  },
  {
    id: 'dirgebell',
    name: 'Dirgebell',
    desc: 'A floating bell that hastens nearby dead',
    texture: 'enemy-dirgebell-move',
    size: 42,
    stats: { maxHp: 35, damage: 0, moveSpeed: 70, xp: 10, shards: 5 },
    behaviour: 'aura',
    firstSeenS: 270,
    tint: PALETTE.primary,
    // `aura`: allies inside `auraRadiusPx` gain `auraSpeedMul` move speed.
    params: { auraRadiusPx: 200, auraSpeedMul: 0.25 },
  },
  {
    id: 'gildedghoul',
    name: 'Gilded Ghoul',
    desc: 'A ghoul crusted in stolen gold; flees when hurt',
    texture: 'enemy-gildedghoul-move',
    size: 44,
    stats: { maxHp: 50, damage: 6, moveSpeed: 160, xp: 10, shards: 15 },
    behaviour: 'flee',
    firstSeenS: 200,
    tint: PALETTE.accent,
    // `flee`: runs from the player and drops a relic roll on death. The COUNT
    // stays here because `TUNING.loot.eliteRelics`/`bossRelics` cover only the
    // elites and the Warden — the Ghoul is neither, and §5.2 gives it one roll.
    params: { relicRolls: 1, relicTierBias: 0 },
  },
  {
    id: 'ashwraith',
    name: 'Ashwraith',
    desc: 'A cinder ghost that blinks 200px every 3s',
    texture: 'enemy-ashwraith-move',
    size: 40,
    stats: { maxHp: 22, damage: 9, moveSpeed: 90, xp: 6, shards: 3 },
    behaviour: 'teleport',
    firstSeenS: 300,
    tint: PALETTE.secondary,
    // `teleport`: blinks `blinkPx` toward the player every `blinkEveryS`.
    params: { blinkPx: 200, blinkEveryS: 3 },
  },
];

/**
 * 8 zone-exclusive archetypes, 2 per zone (§5.7). Light entrants join their
 * zone's table at 60s, heavies at 240s, and both reuse the shared verbs.
 */
const EXCLUSIVE: readonly EnemyDef[] = [
  // --- castle: Bleakspire Keep ---------------------------------------------
  {
    id: 'chapelghast',
    name: 'Chapel Ghast',
    desc: 'Lunges from prop shadows',
    texture: 'enemy-chapelghast-move',
    size: 44,
    stats: { maxHp: 28, damage: 9, moveSpeed: 95, xp: 6, shards: 3 },
    behaviour: 'orbit-charge',
    zone: 'castle',
    firstSeenS: 60,
    tint: PALETTE.primary,
    params: { orbitRadiusPx: 180, windupMs: 400 },
  },
  {
    id: 'gargoyle',
    name: 'Rust Gargoyle',
    desc: 'Perches then dives every 6s',
    texture: 'enemy-gargoyle-move',
    size: 58,
    stats: { maxHp: 60, damage: 12, moveSpeed: 100, xp: 10, shards: 5 },
    behaviour: 'orbit-charge',
    zone: 'castle',
    firstSeenS: 240,
    tint: PALETTE.inkSoft,
    params: { orbitRadiusPx: 260, windupMs: 600, diveEveryS: 6 },
  },

  // --- outlands: Ashen Outlands -------------------------------------------
  {
    id: 'kite',
    name: 'Carrion Kite',
    desc: 'Swoops',
    texture: 'enemy-kite-move',
    size: 38,
    stats: { maxHp: 20, damage: 8, moveSpeed: 170, xp: 5, shards: 2 },
    behaviour: 'orbit-charge',
    zone: 'outlands',
    firstSeenS: 60,
    tint: PALETTE.inkSoft,
    params: { orbitRadiusPx: 300, windupMs: 350 },
  },
  {
    id: 'giant',
    name: 'Sloughed Giant',
    desc: 'Ground-slam r=130',
    texture: 'enemy-giant-move',
    size: 84,
    stats: { maxHp: 140, damage: 16, moveSpeed: 45, xp: 14, shards: 6 },
    behaviour: 'tank',
    zone: 'outlands',
    firstSeenS: 240,
    tint: PALETTE.bad,
    params: { slamRadiusPx: 130, slamEveryS: 5, swingArcDeg: 360, swingReachPx: 130 },
  },

  // --- desert: Sorrow Dunes -----------------------------------------------
  {
    id: 'leech',
    name: 'Dune Leech',
    desc: 'Burrows, surfaces at player every 7s',
    texture: 'enemy-leech-move',
    size: 42,
    stats: { maxHp: 26, damage: 10, moveSpeed: 90, xp: 6, shards: 3 },
    behaviour: 'teleport',
    zone: 'desert',
    firstSeenS: 60,
    tint: PALETTE.bad,
    // Surfacing IS the blink: it re-emerges on the player, not at a fixed
    // offset, so `blinkPx` is 0 and the cadence carries the behaviour.
    params: { blinkPx: 0, blinkEveryS: 7 },
  },
  {
    id: 'scarab',
    name: 'Gilt Scarab',
    desc: 'Drops 3 shards per hit taken',
    texture: 'enemy-scarab-move',
    size: 40,
    stats: { maxHp: 45, damage: 6, moveSpeed: 140, xp: 8, shards: 4 },
    behaviour: 'chase',
    zone: 'desert',
    firstSeenS: 240,
    tint: PALETTE.accent,
    params: { shardsPerHitTaken: 3 },
  },

  // --- winter: Widow's Crown ----------------------------------------------
  {
    id: 'widow',
    name: 'Frost Widow',
    desc: 'Lays slowing web r=120',
    texture: 'enemy-widow-move',
    size: 62,
    stats: { maxHp: 70, damage: 14, moveSpeed: 85, xp: 10, shards: 5 },
    behaviour: 'chase',
    zone: 'winter',
    firstSeenS: 60,
    tint: PALETTE.primary,
    params: { webRadiusPx: 120, webSlowPct: 40, webEveryS: 6 },
  },
  {
    id: 'yeti',
    name: 'Hollow Yeti',
    desc: 'Enrages below 30% hp: spd 110',
    texture: 'enemy-yeti-move',
    size: 96,
    stats: { maxHp: 180, damage: 20, moveSpeed: 60, xp: 16, shards: 7 },
    behaviour: 'tank',
    zone: 'winter',
    firstSeenS: 240,
    tint: PALETTE.ink,
    params: { enrageBelowPct: 30, enragedMoveSpeed: 110, swingArcDeg: 140, swingReachPx: 110 },
  },
];

/**
 * 3 elites (§5.2b) at 150s / 270s / 390s. `behaviour: 'elite'` is one verb
 * with a telegraphed signature move; `params.telegraphMs` is its windup and
 * the remaining keys are the signature's own numbers.
 */
const ELITES: readonly EnemyDef[] = [
  {
    id: 'elite_reaper',
    name: 'Sorrow Reaper',
    desc: 'A scythe-wielding elite with a telegraphed sweep',
    texture: 'elite-reaper-move',
    size: 72,
    stats: {
      maxHp: GRUNT_REFERENCE_HP * ELITE_HP_MUL,
      damage: 18,
      moveSpeed: 120,
      xp: 40,
      shards: TUNING.economy.currencyPerElite,
    },
    behaviour: 'elite',
    firstSeenS: 150,
    tint: PALETTE.secondary,
    eliteDrop: true,
    // Telegraphed arc sweep (900ms windup); drops a relic roll of tier >= 2,
    // which the +1 source bias guarantees (see `rollRelic`).
    params: {
      telegraphMs: 900,
      sweepEveryS: 5,
      sweepArcDeg: 200,
      sweepReachPx: 200,
      relicTierBias: 1,
    },
  },
  {
    id: 'elite_matron',
    name: 'Widow Matron',
    desc: 'A bloated spider-queen trailing web slicks',
    texture: 'elite-matron-move',
    size: 80,
    stats: {
      maxHp: GRUNT_REFERENCE_HP * ELITE_HP_MUL,
      damage: 14,
      moveSpeed: 90,
      xp: 40,
      shards: TUNING.economy.currencyPerElite,
    },
    behaviour: 'elite',
    firstSeenS: 270,
    tint: PALETTE.primary,
    eliteDrop: true,
    // Web zones + chase: the slick she trails slows 40%.
    params: {
      telegraphMs: 600,
      slickEveryS: 3,
      slickSlowPct: 40,
      slickRadiusPx: 150,
      relicTierBias: 1,
    },
  },
  {
    id: 'elite_herald',
    name: 'Dread Herald',
    desc: 'A banner-bearer that rallies a spawn surge',
    texture: 'elite-herald-move',
    size: 68,
    stats: {
      maxHp: GRUNT_REFERENCE_HP * ELITE_HP_MUL,
      damage: 12,
      moveSpeed: 100,
      xp: 40,
      shards: TUNING.economy.currencyPerElite,
    },
    behaviour: 'elite',
    firstSeenS: 390,
    tint: PALETTE.bad,
    eliteDrop: true,
    // Rally + chase: +50% spawn rate while alive.
    params: { telegraphMs: 500, rallySpawnMul: 0.5, relicTierBias: 1 },
  },
];

/**
 * The Gate Warden (§5.2b) — one def, four zone art skins resolved by the art
 * registry (`art/manifest.json`), because the fight is identical in every
 * zone. Phase thresholds and cadences are `TUNING.boss.*`; `params` carries
 * only the §5.2b numbers TUNING does not already name.
 */
const WARDEN: EnemyDef = {
  id: 'warden',
  name: 'Gate Warden',
  desc: "The dusk's jailer; guards the Bleak Arch in every zone (4 zone skins)",
  texture: 'boss-warden-idle',
  size: 120,
  stats: {
    maxHp: GRUNT_REFERENCE_HP * BOSS_HP_MUL,
    damage: 22,
    moveSpeed: 70,
    xp: 300,
    shards: TUNING.economy.currencyPerBoss,
  },
  behaviour: 'boss',
  firstSeenS: 420,
  tint: PALETTE.bad,
  eliteDrop: true,
  // 3-phase volley -> summon+shield -> enrage ring, plus the guaranteed Dread
  // relic roll (+2 source bias lands on t3/t4 and the Warden pins t4).
  params: { relicTierBias: 2, guaranteedTier: 4, standoffPx: 380 },
};

/**
 * The archetype the Warden's phase-2 summon calls in (`TUNING.boss.summonMin`
 * ..`summonMax` of them). Named here rather than typed as a literal in
 * `systems/combat.ts`, so the summon can never point at an id the roster no
 * longer carries.
 */
export const WARDEN_SUMMON_ID = 'husk';

/** The whole cast: 12 shared + 8 zone-exclusive + 3 elites + the Warden. */
export const ENEMIES: readonly EnemyDef[] = [...SHARED, ...EXCLUSIVE, ...ELITES, WARDEN];

const BY_ID: Record<string, EnemyDef> = {};
for (const def of ENEMIES) BY_ID[def.id] = def;

export function enemyDef(id: string): EnemyDef {
  const def = BY_ID[id];
  if (def === undefined) throw new Error(`Unknown enemy id "${id}"`);
  return def;
}

/** The 12 shared archetypes (every zone spawns these). */
export function sharedEnemies(): readonly EnemyDef[] {
  return SHARED;
}

/**
 * The spawn table for one zone: the shared roster plus that zone's two
 * exclusives. Anything tagged for a DIFFERENT zone is excluded, which is the
 * whole of the §5.7 exclusivity rule.
 */
export function enemiesForZone(zoneId: string): readonly EnemyDef[] {
  return ENEMIES.filter((def) => def.zone === undefined || def.zone === zoneId);
}

/**
 * Just the two exclusives for one zone (§5.7), light entrant first. Handy for
 * the spawn-table bias: the light one joins at 60s, the heavy at 240s, and
 * `firstSeenS` on each row already says which is which.
 */
export function exclusiveEnemies(zoneId: string): readonly EnemyDef[] {
  return EXCLUSIVE.filter((def) => def.zone === zoneId);
}

/** The 3 elites, entry order. */
export function eliteEnemies(): readonly EnemyDef[] {
  return ELITES;
}

/**
 * Scales an archetype's base stats by the current phase multiplier (already
 * multiplied by the zone's `threatBase` before it gets here).
 *
 * §6 curve, exactly: HP scales linearly with the multiplier, DAMAGE at HALF
 * rate (`base * (1 + (mult-1)/2)`) so late-run hits stay survivable, and move
 * speed plus rewards (xp/shards) never scale — movement feel and the §6 loot
 * income curve must not drift with difficulty.
 */
export function scaleEnemy(def: EnemyDef, difficultyMul: number): EnemyStats {
  return {
    maxHp: Math.round(def.stats.maxHp * difficultyMul),
    damage: Math.round(def.stats.damage * (1 + (difficultyMul - 1) / 2)),
    moveSpeed: def.stats.moveSpeed,
    xp: def.stats.xp,
    shards: def.stats.shards,
  };
}
