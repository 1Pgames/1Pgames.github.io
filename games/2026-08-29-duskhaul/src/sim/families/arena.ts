import { TUNING, VIEW } from '../../config';
import { RunDirector, type EventSpec, type WaveSpec } from '../../core/run';
import { Rng } from '../../core/rng';
import { StatBlock } from '../../core/stats';
import { eliteEnemies, enemyDef, scaleEnemy, type EnemyDef } from '../../data/enemies';
import { relicTierWeights, rollRelic, type RelicDef } from '../../data/relics';
import { rollUpgradeChoices, UPGRADE_CARDS, type UpgradeDef } from '../../data/upgrades';
import { PHASES, TIMELINE_EVENTS, WAVES } from '../../data/waves';
import { STARTING_WEAPON, weaponDef, weaponRankCount, type WeaponPattern } from '../../data/weapons';
import { ZONES, zoneGates, type ZoneDef } from '../../data/zones';
import { Bag } from '../../systems/bag';
import {
  ExtractionSystem,
  channelCompletableUnderContact,
  worstCaseChannelMs,
  type ChannelContest,
  type GateSpec,
} from '../../systems/extraction';
import {
  CEILING_SKILL,
  FLOOR_SKILL,
  LANES,
  SKILL_LEVELS,
  gateDecision,
  pickUpgrade,
  routeProfile,
  type GateContext,
  type GateId,
  type LanePolicy,
  type RouteProfile,
} from '../bots';
import { createDirectorHost } from '../director-host';
import {
  finishFamily,
  hard,
  median,
  num,
  pct,
  printTable,
  type FamilySimOptions,
  type GateResult,
} from './types';

/**
 * Duskhaul's arena route sim — the instrument the §19 acceptance criteria are
 * measured with, and the anti-regression harness for the two blockers the
 * greybox playtest MEASURED: an extraction channel that was mathematically
 * uncompletable under pressure, and a Collapse that never reached the player.
 *
 * WHAT IS REAL AND WHAT IS MODELLED — read this before trusting a number.
 * Real, ticked directly because both are deliberately Phaser-free:
 *   - `systems/extraction.ts` — gate windows, the hold-to-extract channel with
 *     its setback/stall/contested-rate rule, and the Collapse ring, fire dps,
 *     threat bonus and elite quota. Every channel and Collapse number below
 *     comes out of that class (or its resolved `channelTuning`/`collapseTuning`),
 *     never out of this file.
 *   - `systems/bag.ts` — slots, casket, drop-lowest overflow, settlement.
 *   - `core/run.ts` `RunDirector` over the real `WAVES`/`PHASES`/
 *     `TIMELINE_EVENTS`, `data/enemies.ts` `scaleEnemy`, `data/upgrades.ts`
 *     `rollUpgradeChoices`, `data/relics.ts` `rollRelic`, `data/zones.ts` gate
 *     layouts, `core/stats.ts` `StatBlock`, and `TUNING`.
 * Modelled here, because `systems/combat.ts` is Phaser-bound:
 *   - 2D positions for the player and every enemy inside the real
 *     `TUNING.arena` bounds — gate reachability is a distance question, so the
 *     dimension is kept rather than collapsed to a scalar;
 *   - weapon throughput derived from `data/weapons.ts` rows (damage, cadence,
 *     target count, reach), never a fudge factor;
 *   - contact and ranged damage as a per-archetype attempt on
 *     `TUNING.enemy.hitMs`, gated by `TUNING.player.invulnMs` and the route's
 *     dodge skill;
 *   - spawn COMPOSITION (`TUNING.wave.*` elite swap, the Collapse's stopped
 *     trash drip and elite quota), since there is no headless spawner to ask.
 * A failing gate therefore names the file that owns the number: this file
 * measures, it never fixes.
 *
 * Bot calibration against the greybox playtest's five persona logs lives in
 * `../bots.ts`; the per-band table printed here is directly comparable to it.
 *
 * Pure TypeScript, no Phaser import, no `Math.random`.
 */

// ---------------------------------------------------------------------------
// Sim-only bot/abstraction calibration. None of this is balance: it describes
// how a bot PLAYS and how the collapsed combat model turns data numbers into
// throughput. Fitted to the greybox persona logs (see ../bots.ts).
// ---------------------------------------------------------------------------

const STEP_MS = 100;
/**
 * Crowd cap on one weapon's hit list. An area weapon in a SATURATED field
 * genuinely touches dozens of bodies — `nova` at rank 4 with an `area` stack
 * covers r~416px — so a small cap silently under-models the clear rate exactly
 * where the run is decided. 48 is the largest crowd any single pattern here can
 * plausibly cover at once.
 */
const MAX_TARGETS_TRACKED = 48;
/** Damage output at skill 0 vs skill 1 — aim and positioning quality. */
const SKILL_DAMAGE_FLOOR = 0.7;
const SKILL_DAMAGE_GAIN = 0.4;
/** A pierce/beam weapon's line reach as a multiple of the aimed-shot range. */
const BEAM_REACH_MUL = 2;
/** How far a farming bot detours for a shard cache when loot is not its appetite. */
const OPPORTUNIST_CACHE_PX = 350;
/** Crowd-centroid sampling radius for the farm/kite decision. */
const CROWD_RADIUS_PX = 900;
/**
 * How many simultaneous attackers it takes before a dodge attempt is worthless.
 *
 * A per-attacker coin flip prices a lone chaser exactly like a wall of twenty,
 * which contradicts the persona logs hard: measured damage taken/s runs 0.27
 * (veteran, Early, a handful of bodies) to 5.01 (veteran, Late, 40+ bodies) —
 * a ~19x spread that tracks DENSITY, not archetype damage. So one contact
 * window resolves once, and the route's dodge quality is scaled by how
 * surrounded it is: at 1 attacker a good kiter is barely ever touched, at this
 * many the dodge is gone. This is also what makes the avoidant lane lose to
 * the enemy wall it declined to clear.
 */
const SURROUND_FOR_CERTAINTY = 8;
/**
 * Encirclement break-out. A kiting player who is being touched does not stand
 * and trade: they run out of the ring of bodies, re-open the gap and resume
 * shooting. Without this the bot enters a death spiral the persona logs never
 * show — measured, the avoidant line held ~8-14 live enemies at 2.5 kills/s,
 * whereas a bot that stays put collapses to 0.4 kills/s against 30+ bodies.
 * The trigger count is skill-scaled: a good player reads the encirclement
 * early, a weak one notices once it is already closed.
 */
const BREAKOUT_RADIUS_MUL = 1.6;
const BREAKOUT_TRIGGER_BASE = 8;
const BREAKOUT_TRIGGER_SKILL_GAIN = 5;
/** A run still going this far past the Collapse has stopped resolving — the §19 gate fails on it. */
const SAFETY_OVERTIME_S = 900;
/** The §5.4 Warden beat the §15 entity budget is quoted at. */
const WARDEN_BEAT_S = TUNING.warden.atS;

// ---------------------------------------------------------------------------
// Run model
// ---------------------------------------------------------------------------

interface SimEnemy {
  def: EnemyDef;
  hp: number;
  maxHp: number;
  damage: number;
  speed: number;
  x: number;
  y: number;
  /** Distance the archetype holds instead of closing (ranged reach, orbit radius). */
  standoff: number;
  nextHitAtMs: number;
  elite: boolean;
  boss: boolean;
  /** Split depth, bounded by `params.splitGenerations`. 0 for a spawned enemy. */
  generation: number;
}

interface SimWeapon {
  id: WeaponPattern;
  boosts: number;
  evolved: boolean;
}

interface ShardCache {
  x: number;
  y: number;
  expiresAtMs: number;
}

/** Phase bands the progression table reports, matching §2A. */
const BANDS: readonly { name: string; fromS: number; toS: number }[] = [
  { name: 'Grace', fromS: 0, toS: 30 },
  { name: 'Early', fromS: 30, toS: 120 },
  { name: 'Mid', fromS: 120, toS: 240 },
  { name: 'Late', fromS: 240, toS: 360 },
  { name: 'Climax', fromS: 360, toS: TUNING.collapse.atS },
  { name: 'Collapse', fromS: TUNING.collapse.atS, toS: Number.POSITIVE_INFINITY },
];

interface BandSample {
  seconds: number;
  ticks: number;
  kills: number;
  shards: number;
  damageTaken: number;
  liveSum: number;
  liveMax: number;
  eliteSum: number;
  threatSum: number;
}

interface OvertimeSample {
  fireContacted: boolean;
  fireContactAtS: number | null;
  ringStartPx: number;
  ringEndPx: number;
  liveAtStart: number;
  liveAt30s: number;
  elitesAtStart: number;
  elitesAt30s: number;
  fireDpsStart: number;
  fireDpsEnd: number;
  seconds: number;
}

export interface RouteRun {
  seed: string;
  lane: LanePolicy;
  skill: number;
  zone: string;
  endS: number;
  /** 'extracted' | 'died' are the only legitimate endings (§2A: there is no timer win). */
  endReason: 'extracted' | 'died' | 'unresolved';
  gateUsed: GateId | null;
  gateIntents: string[];
  bankedShards: number;
  /** True when the extraction completed at or after the Collapse ignited (haul premium paid). */
  extractedInCollapse: boolean;
  carriedShards: number;
  relicsCarried: number;
  relicsBanked: number;
  relicsLost: number;
  kills: number;
  eliteKills: number;
  wardenKilled: boolean;
  level: number;
  drafts: number;
  firstUpgradeS: number | null;
  /** First second the bag had to drop a relic to accept one — the capacity bind. */
  bagBoundS: number | null;
  hpMinRatio: number;
  channelInterrupts: number;
  /** Seconds spent holding a partially-filled channel. */
  channelHeldS: number;
  /** Seconds the winning hold took, from first progress to completion (null if none). */
  channelCompletedInS: number | null;
  liveAtWardenBeat: number;
  liveMax: number;
  bands: BandSample[];
  /** Archetypes this run actually dealt damage to (per-type engagement law). */
  engaged: string[];
  /** Archetypes that spawned at all. */
  spawned: string[];
  overtime: OvertimeSample | null;
  unknownStatMods: string[];
}

export interface RouteSimOptions {
  seed: string;
  lane: LanePolicy;
  skill: number;
  zone?: ZoneDef;
}

/**
 * The §7 tuning `ExtractionSystem` runs on, passed through unrenamed exactly as
 * its doc comment prescribes — so the sim and the scene share one channel rule
 * and one ring, and the ring's start radius is latched by the system from the
 * player's own position at ignition.
 */
function newExtraction(gates: GateSpec[]): ExtractionSystem {
  return new ExtractionSystem(gates, {
    channelMs: TUNING.extract.channelMs,
    radius: TUNING.gate.radius,
    collapseAtS: TUNING.collapse.atS,
    closingWarnS: TUNING.gate.closingWarnS,
    gateWindowBonusS: TUNING.extract.gateWindowBonusS,
    channel: TUNING.extract,
    collapse: TUNING.collapse,
  });
}

/** The stat surface the frozen §16.1 `StatKey` union names, at its §7 bases. */
function baseStats(): Record<string, number> {
  return {
    maxHp: TUNING.player.maxHp,
    moveSpeed: TUNING.player.moveSpeed,
    damageMul: 1,
    cooldownMul: 1,
    area: 1,
    critChance: TUNING.player.critChance,
    critMul: TUNING.player.critMul,
    pickupRadius: TUNING.player.pickupRadius,
    shardsMul: 1,
    channelMs: TUNING.extract.channelMs,
    bagSlots: TUNING.bag.slots,
  };
}

interface WeaponThroughput {
  dpsPerTarget: number;
  maxTargets: number;
  reachPx: number;
}

/**
 * One weapon's throughput straight from its `data/weapons.ts` row: rank-scaled
 * damage over its own cadence, the number of bodies its pattern touches, and
 * the reach it has. `orbit` carries `cooldownMs === null` (continuous contact on
 * `params.hitCooldownMs`); the count-ranked weapons (`orbit`, `hex`) grow
 * targets instead of damage, through `weaponRankCount`.
 */
function weaponThroughput(weapon: SimWeapon, stats: StatBlock): WeaponThroughput {
  const def = weaponDef(weapon.id);
  const params = def.params ?? {};
  const evo = def.evolvedParams ?? {};
  const evolved = weapon.evolved;
  const area = stats.get('area');

  let damage = evolved && def.evolvedDamage !== undefined ? def.evolvedDamage : def.baseDamage;
  damage *= 1 + def.rankGrowth.damageStep * weapon.boosts;
  if (evolved && evo.damageMul !== undefined) damage *= 1 + evo.damageMul;
  damage *= stats.get('damageMul');
  damage *= 1 + stats.get('critChance') * (stats.get('critMul') - 1);

  if (def.cooldownMs === null) {
    const hitCooldownS = (params.hitCooldownMs ?? 400) / 1000;
    const bones = weaponRankCount(weapon.id, weapon.boosts, 'bones') + (evolved ? evo.bonesAdd ?? 0 : 0);
    const radius = (params.radiusPx ?? 150) * (evolved ? evo.radiusMul ?? 1 : 1) * area;
    return { dpsPerTarget: damage / hitCooldownS, maxTargets: Math.max(1, bones), reachPx: radius };
  }

  const dpsPerTarget = damage / ((def.cooldownMs / 1000) * stats.get('cooldownMul'));
  switch (weapon.id) {
    case 'bolt':
      return { dpsPerTarget, maxTargets: evolved ? evo.pierce ?? 1 : 1, reachPx: TUNING.player.range * area };
    case 'nova':
      return { dpsPerTarget, maxTargets: MAX_TARGETS_TRACKED, reachPx: (params.radiusPx ?? 260) * area };
    case 'rail':
      return {
        dpsPerTarget,
        maxTargets: params.pierce ?? 4,
        reachPx: TUNING.player.range * BEAM_REACH_MUL * area,
      };
    case 'scythe': {
      // A frontal sweep touches roughly the crowd share its arc covers.
      const arcDeg = evolved ? evo.arcDeg ?? params.arcDeg ?? 140 : params.arcDeg ?? 140;
      return {
        dpsPerTarget,
        maxTargets: Math.max(1, Math.round((MAX_TARGETS_TRACKED * arcDeg) / 360)),
        reachPx: (params.radiusPx ?? 140) * area,
      };
    }
    default: {
      // `hex`: chain jumps are the target count, the first jump is the reach.
      const jumps = weaponRankCount(weapon.id, weapon.boosts, 'jumps') + (evolved ? evo.jumps ?? 0 : 0);
      return { dpsPerTarget, maxTargets: Math.max(1, jumps), reachPx: (params.jumpRangePx ?? 200) * area };
    }
  }
}

/**
 * The zone hazard's ambient pressure, derived from the hazard's own §5.7 params
 * rather than invented: a pulsing hazard lands its damage on its own interval
 * and a skilled player steps out of most pulses, while a windowed hazard (the
 * desert scorch) is a flat drain for as long as its window holds.
 */
function hazardDps(zone: ZoneDef, elapsedS: number, skill: number): number {
  const params = zone.hazard.params;
  const exposure = 1 - skill * 0.8;
  switch (zone.hazard.kind) {
    case 'braziers':
      return ((params.damage ?? 0) / (params.intervalS ?? 1)) * exposure * 0.5;
    case 'bonestorm':
      return (params.dotDps ?? 0) * ((params.gustS ?? 0) / (params.intervalS ?? 1)) * exposure;
    case 'sinksand': {
      const from = params.scorchFromS ?? Number.POSITIVE_INFINITY;
      const to = params.scorchToS ?? Number.POSITIVE_INFINITY;
      return elapsedS >= from && elapsedS <= to ? (params.scorchDps ?? 0) * exposure : 0;
    }
    default:
      return 0;
  }
}

/**
 * One seeded route run. It ends ONLY by extraction or death (§2A); the
 * `unresolved` ending exists so a build that can no longer resolve is reported
 * as a hard failure instead of being silently capped at 480s.
 */
function simulateRoute(options: RouteSimOptions): RouteRun {
  const { seed, lane, skill } = options;
  const zone = options.zone ?? ZONES[0]!;
  const profile: RouteProfile = routeProfile(lane);
  const rng = new Rng(seed);

  const elites = eliteEnemies();
  const extraction = newExtraction(zoneGates(zone));
  const bag = new Bag(TUNING.bag.slots, TUNING.bag.casketSlots);

  const statBase = baseStats();
  const stats = new StatBlock(statBase);
  const knownStats = new Set(Object.keys(statBase));

  const enemies: SimEnemy[] = [];
  const caches: ShardCache[] = [];
  const weapons: SimWeapon[] = [{ id: STARTING_WEAPON, boosts: 0, evolved: false }];
  const taken: string[] = [];
  const gateIntents: string[] = [];
  const engaged = new Set<string>();
  const spawnedIds = new Set<string>();
  const unknownStatMods: string[] = [];
  const bands: BandSample[] = BANDS.map(() => ({
    seconds: 0,
    ticks: 0,
    kills: 0,
    shards: 0,
    damageTaken: 0,
    liveSum: 0,
    liveMax: 0,
    eliteSum: 0,
    threatSum: 0,
  }));

  let px = TUNING.arena.width / 2;
  let py = TUNING.arena.height / 2;
  let hp = stats.get('maxHp');
  let lastHitAtMs = -Infinity;
  let simTimeMs = 0;
  let level = 1;
  let xp = 0;
  let kills = 0;
  let eliteKills = 0;
  let wardenAlive = false;
  let wardenKilled = false;
  let drafts = 0;
  let firstUpgradeS: number | null = null;
  let bagBoundS: number | null = null;
  let hpMinRatio = 1;
  /**
   * Exponentially-weighted net hp loss, as a fraction of max hp per second.
   * This is the input to the greed route's survival estimate, and it is
   * MEASURED from the run rather than assumed: it already carries contact,
   * ranged, hazard and Collapse-fire damage net of regen.
   */
  let hpDrainRatioPerS = 0;
  let hpLast = hp;
  let channelInterrupts = 0;
  let channelHeldS = 0;
  let channelStartedAtMs: number | null = null;
  let channelCompletedInS: number | null = null;
  let relicDripAtMs = TUNING.loot.firstRelicS * 1000;
  let cacheAtMs = TUNING.loot.cacheEveryS * 1000;
  let eliteSwapAtMs = TUNING.wave.compositionFromS * 1000;
  let collapseElitesSpawned = 0;
  let liveAtWardenBeat = 0;
  let liveMax = 0;
  let overtime: OvertimeSample | null = null;
  let endReason: RouteRun['endReason'] = 'unresolved';
  let gateUsed: GateId | null = null;

  extraction.onEvent((event, id) => {
    if (event !== 'extracted') return;
    endReason = 'extracted';
    gateUsed = (id ?? null) as GateId | null;
    if (channelStartedAtMs !== null) channelCompletedInS = (simTimeMs - channelStartedAtMs) / 1000;
  });

  function liveElites(): number {
    let count = 0;
    for (const enemy of enemies) if (enemy.elite || enemy.boss) count += 1;
    return count;
  }

  function threatMul(): number {
    return director.difficulty * zone.threatBase + extraction.collapseThreatBonus;
  }

  /**
   * Spawn geometry mirrors `CombatSystem.spawn`: just outside the camera view
   * around the player, with the wave's own pattern deciding whether the angle is
   * random or one direction. The system's `spawnSuppressed` keeps new bodies off
   * an open/closing gate ring — the rule that makes a contested channel
   * winnable — so a blocked angle is re-rolled, never clamped onto the ring.
   */
  function spawnPoint(pattern: WaveSpec['pattern'], at: number): { x: number; y: number } {
    const rx = VIEW.width / 2 + TUNING.enemy.spawnMargin;
    const ry = VIEW.height / 2 + TUNING.enemy.spawnMargin;
    // Deterministic per-wave direction for arc/line/cluster, as the real
    // spawner derives it from the wave's `at`.
    const fixedAngle = ((at * 137.508) % 360) * (Math.PI / 180);
    let point = { x: px, y: py };
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const spread = pattern === 'cluster' ? 0.2 : 0.6;
      const angle =
        pattern === undefined || pattern === 'ring' || attempt > 0
          ? rng.float(0, Math.PI * 2)
          : fixedAngle + rng.float(-spread, spread);
      point = {
        x: Math.min(TUNING.arena.width, Math.max(0, px + Math.cos(angle) * rx)),
        y: Math.min(TUNING.arena.height, Math.max(0, py + Math.sin(angle) * ry)),
      };
      if (!extraction.spawnSuppressed(point.x, point.y)) return point;
    }
    return point;
  }

  function spawn(id: string, x: number, y: number, difficultyMul: number): void {
    if (enemies.length >= TUNING.enemy.maxAlive) return;
    let def: EnemyDef;
    try {
      def = enemyDef(id);
    } catch {
      // A wave pointing at an id the roster dropped is a content bug; the
      // spawned/engaged diff reports it instead of throwing mid-measurement.
      return;
    }
    const scaled = scaleEnemy(def, difficultyMul);
    const params = def.params ?? {};
    // `swarm` archetypes arrive as a pack (`params.packSize`) on one call.
    const pack = def.behaviour === 'swarm' ? Math.max(1, params.packSize ?? 1) : 1;
    const standoff =
      def.behaviour === 'ranged'
        ? params.rangePx ?? 0
        : def.behaviour === 'orbit-charge'
          ? params.orbitRadiusPx ?? 0
          : def.behaviour === 'aura'
            ? params.auraRadiusPx ?? 0
            : 0;
    for (let i = 0; i < pack; i += 1) {
      if (enemies.length >= TUNING.enemy.maxAlive) break;
      enemies.push({
        def,
        hp: scaled.maxHp,
        maxHp: scaled.maxHp,
        damage: scaled.damage,
        speed: scaled.moveSpeed,
        x: i === 0 ? x : x + rng.float(-90, 90),
        y: i === 0 ? y : y + rng.float(-90, 90),
        standoff,
        nextHitAtMs: simTimeMs,
        elite: def.behaviour === 'elite',
        boss: def.behaviour === 'boss',
        generation: 0,
      });
    }
    spawnedIds.add(def.id);
    if (def.behaviour === 'boss') wardenAlive = true;
  }

  /**
   * §7 `wave.compositionFromS`: from that second a scheduled trash spawn is
   * UPGRADED to an elite instead of adding another body, capped at
   * `wave.eliteShareMax` of the live pool. This is the mechanism that lets late
   * pressure rise while `enemy.maxAlive` is already saturated.
   */
  function resolveSpawnId(id: string): string {
    if (simTimeMs < eliteSwapAtMs) return id;
    const live = enemies.length;
    if (live > 0 && liveElites() / live >= TUNING.wave.eliteShareMax) return id;
    const eligible = elites.filter((def) => def.firstSeenS <= simTimeMs / 1000);
    if (eligible.length === 0) return id;
    eliteSwapAtMs = simTimeMs + TUNING.wave.eliteSwapEveryS * 1000;
    return rng.pick(eligible).id;
  }

  function dropRelic(tierBias: number): void {
    const relic: RelicDef = rollRelic(rng, zone.id, tierBias);
    const result = bag.addRelic(relic);
    if (bagBoundS === null && (!result.accepted || result.dropped !== null)) bagBoundS = simTimeMs / 1000;
  }

  function applyCard(card: UpgradeDef): void {
    taken.push(card.id);
    const maxHpBefore = stats.get('maxHp');
    for (const mod of card.modifiers) {
      if (!knownStats.has(mod.stat)) {
        // A card pointing at a stat nobody reads lands just as silently in the
        // game, which is exactly why it is reported instead of ignored.
        unknownStatMods.push(`${card.id}:${mod.stat}`);
        continue;
      }
      stats.addModifier({ ...mod, source: `upgrade:${card.id}` });
    }
    // `objects/player.ts` routes a maxHp modifier through
    // `Health.setMax(next, keepRatio = true)`, which scales CURRENT hp by the
    // same ratio — so a +20 max-hp card at half health really does hand back
    // 10 hp. Ignoring that under-heals the sim badly over a full run: the
    // persona logs show max hp climbing 110 -> 195, and their heal/s (0.28 to
    // 1.93) is mostly this, not regen.
    const maxHpAfter = stats.get('maxHp');
    if (maxHpAfter !== maxHpBefore && maxHpBefore > 0) hp = (hp / maxHpBefore) * maxHpAfter;
    const slot = weapons.find((weapon) => weapon.id === card.weapon);
    if (card.kind === 'weapon-unlock' && card.weapon !== undefined && slot === undefined) {
      weapons.push({ id: card.weapon, boosts: 0, evolved: false });
    }
    if (card.kind === 'weapon-boost' && slot !== undefined) slot.boosts += 1;
    if (card.kind === 'weapon-evolution' && slot !== undefined) slot.evolved = true;
    hp = Math.min(stats.get('maxHp'), hp);
  }

  function draft(): void {
    const choices = rollUpgradeChoices(rng, taken, TUNING.draft.choices, {
      ownedWeapons: weapons.map((weapon) => weapon.id),
      hasFreeWeaponSlot: weapons.length < TUNING.weapons.maxSlots,
    });
    if (choices.length === 0) return;
    drafts += 1;
    if (firstUpgradeS === null) firstUpgradeS = simTimeMs / 1000;
    applyCard(pickUpgrade(lane, choices, rng, hp / stats.get('maxHp')));
  }

  function onScriptedEvent(event: EventSpec): void {
    switch (event.kind) {
      case 'chest':
        // §5.4/§7 `chest.*`: guaranteed relic rolls at the source bias, plus a
        // bonus draft.
        for (let i = 0; i < TUNING.chest.relics; i += 1) dropRelic(TUNING.chest.tierBias);
        draft();
        return;
      case 'breather':
        hp = Math.min(stats.get('maxHp'), hp + stats.get('maxHp') * TUNING.events.breatherHealRatio);
        return;
      default: {
        const eligible = elites.filter((def) => def.firstSeenS <= simTimeMs / 1000);
        if (eligible.length === 0) return;
        for (let i = 0; i < TUNING.events.eliteRushCount; i += 1) {
          const point = spawnPoint('arc', event.at);
          spawn(rng.pick(eligible).id, point.x, point.y, threatMul());
        }
      }
    }
  }

  const director = new RunDirector(
    createDirectorHost(),
    WAVES,
    PHASES,
    (id, _index, _total, pattern) => {
      // §7 `collapse.stopTrashDrip`: at ignition the trash drip stops and only
      // the Collapse's own elite injection continues.
      if (extraction.collapse !== null && TUNING.collapse.stopTrashDrip) return;
      const point = spawnPoint(pattern, Math.round(simTimeMs / 1000));
      spawn(resolveSpawnId(id), point.x, point.y, threatMul());
    },
    { events: TIMELINE_EVENTS, onEvent: onScriptedEvent },
  );

  function killEnemy(index: number): void {
    const enemy = enemies[index]!;
    const def = enemy.def;
    const params = def.params ?? {};
    kills += 1;
    xp += def.stats.xp;
    bag.addShards(Math.round(def.stats.shards * stats.get('shardsMul')));

    if (enemy.boss) {
      wardenKilled = true;
      wardenAlive = false;
      for (let i = 0; i < (params.relicRolls ?? 1); i += 1) {
        dropRelic(params.relicTierBias ?? TUNING.loot.bossTierBias);
      }
    } else if (enemy.elite) {
      eliteKills += 1;
      for (let i = 0; i < TUNING.loot.eliteRelics; i += 1) {
        dropRelic(params.relicTierBias ?? TUNING.loot.eliteTierBias);
      }
    }

    if (def.behaviour === 'burst' && Math.hypot(px - enemy.x, py - enemy.y) <= (params.burstRadiusPx ?? 0)) {
      // A pyreling detonates where it died; reaction speed is the dodge.
      if (!rng.chance(skill)) hp -= params.burstDamage ?? 0;
    }
    enemies.splice(index, 1);
    // `split`: `params.splitGenerations` BOUNDS the chain (marrowworm: 1, so a
    // worm's children never split again). Without the bound the chain only ends
    // at `enemy.maxAlive` — which measured as a saturated pool and a phantom
    // 8.6 kills/s in Late, i.e. the sim inventing content the roster does not
    // author.
    if (def.behaviour === 'split' && enemy.generation < (params.splitGenerations ?? 0)) {
      const ratio = params.splitHpRatio ?? 0.5;
      for (let i = 0; i < (params.splitCount ?? 0); i += 1) {
        if (enemies.length >= TUNING.enemy.maxAlive) break;
        enemies.push({
          ...enemy,
          hp: enemy.maxHp * ratio,
          maxHp: enemy.maxHp * ratio,
          x: enemy.x + rng.float(-40, 40),
          y: enemy.y + rng.float(-40, 40),
          nextHitAtMs: simTimeMs,
          generation: enemy.generation + 1,
        });
      }
    }
  }

  const nearest: { index: number; dist: number }[] = [];

  for (;;) {
    const elapsedS = simTimeMs / 1000;
    if (elapsedS > TUNING.collapse.atS + SAFETY_OVERTIME_S) break;

    director.update(STEP_MS);
    const collapse = extraction.collapse;
    const inCollapse = collapse !== null && collapse.active;
    const ringCentre = extraction.collapseRingCenter;
    if (inCollapse && collapse !== null && overtime === null) {
      overtime = {
        fireContacted: false,
        fireContactAtS: null,
        ringStartPx: extraction.collapseRingStartRadius,
        ringEndPx: collapse.ringRadius,
        liveAtStart: enemies.length,
        liveAt30s: enemies.length,
        elitesAtStart: liveElites(),
        elitesAt30s: liveElites(),
        fireDpsStart: extraction.collapseFireDps,
        fireDpsEnd: extraction.collapseFireDps,
        seconds: 0,
      };
    }
    // §7 `collapse.eliteEveryS`: the escalation is COMPOSITION, not count. The
    // system publishes the quota; the caller covers the difference.
    while (inCollapse && collapse !== null && collapseElitesSpawned < extraction.collapseEliteQuota) {
      collapseElitesSpawned += 1;
      const eligible = elites.filter((def) => def.firstSeenS <= elapsedS);
      if (eligible.length === 0) break;
      const angle = rng.float(0, Math.PI * 2);
      spawn(
        rng.pick(eligible).id,
        Math.min(TUNING.arena.width, Math.max(0, ringCentre.x + Math.cos(angle) * collapse.ringRadius)),
        Math.min(TUNING.arena.height, Math.max(0, ringCentre.y + Math.sin(angle) * collapse.ringRadius)),
        threatMul(),
      );
    }

    // --- decide where to stand -------------------------------------------
    const maxHp = stats.get('maxHp');
    const moveSpeed = stats.get('moveSpeed');
    const context: GateContext = {
      elapsedS,
      hpRatio: hp / maxHp,
      bagFull: bag.relics.length >= TUNING.bag.slots,
      collapseActive: inCollapse,
      wardenAlive,
      wardenKilled,
      state: {
        a: extraction.gateState('a'),
        b: extraction.gateState('b'),
        c: extraction.gateState('c'),
      },
      opensInS: { a: 0, b: 0, c: 0 },
      closesInS: { a: null, b: null, c: null },
      travelS: { a: 0, b: 0, c: 0 },
      channelS: extraction.channelMsEffective / 1000,
      secondsToCollapseS: TUNING.collapse.atS - elapsedS,
      hpDrainRatioPerS: hpDrainRatioPerS,
    };
    for (const gate of extraction.gates) {
      context.opensInS[gate.id] = gate.opensS - elapsedS;
      context.closesInS[gate.id] = gate.closesS === null ? null : gate.closesS - elapsedS;
      context.travelS[gate.id] = Math.hypot(px - gate.x, py - gate.y) / Math.max(1, moveSpeed);
    }
    const intent = gateDecision(profile, context);
    if (gateIntents[gateIntents.length - 1] !== intent.reason) gateIntents.push(intent.reason);

    let targetX = px;
    let targetY = py;
    const headingTo = intent.gate ?? (intent.reason === 'warden-first' ? 'c' : null);
    if (headingTo !== null) {
      const gate = extraction.gates.find((entry) => entry.id === headingTo)!;
      targetX = gate.x;
      targetY = gate.y;
    } else if (intent.reason === 'hold-for-premium') {
      // Camp just OUTSIDE Gate C's ring, facing the arena: close enough to step
      // in on the ignition frame, far enough that the hold does not start by
      // itself and forfeit `extract.collapseHaulBonus`.
      const gate = extraction.gates.find((entry) => entry.id === 'c')!;
      const inward = Math.max(
        1,
        Math.hypot(TUNING.arena.width / 2 - gate.x, TUNING.arena.height / 2 - gate.y),
      );
      const standoff = TUNING.gate.radius + 80;
      targetX = gate.x + ((TUNING.arena.width / 2 - gate.x) / inward) * standoff;
      targetY = gate.y + ((TUNING.arena.height / 2 - gate.y) / inward) * standoff;
    }

    // The ring the channel is bound to — the contest census is counted inside
    // THAT ring, which is what the system asks its caller for.
    const ringGate =
      extraction.gates.find((gate) => {
        const state = extraction.gateState(gate.id);
        if (state !== 'open' && state !== 'closing') return false;
        return Math.hypot(px - gate.x, py - gate.y) <= TUNING.gate.radius;
      }) ?? null;

    // --- one pass over the horde: distance, contact, contest, nearest ------
    nearest.length = 0;
    let auraSpeedMul = 1;
    let crowdX = 0;
    let crowdY = 0;
    let crowdCount = 0;
    let pressCount = 0;
    let pressX = 0;
    let pressY = 0;
    const contactAttackers: number[] = [];
    const rangedAttackers: number[] = [];
    const contest: ChannelContest = { enemies: 0, elites: 0 };
    const invuln = simTimeMs - lastHitAtMs < TUNING.player.invulnMs;

    for (let i = 0; i < enemies.length; i += 1) {
      const enemy = enemies[i]!;
      const params = enemy.def.params ?? {};
      const dist = Math.hypot(px - enemy.x, py - enemy.y);

      if (enemy.def.behaviour === 'aura' && dist <= (params.auraRadiusPx ?? 0) + CROWD_RADIUS_PX) {
        auraSpeedMul = Math.max(auraSpeedMul, params.auraSpeedMul ?? 1);
      }
      nearest.push({ index: i, dist });
      if (dist < CROWD_RADIUS_PX) {
        crowdX += enemy.x;
        crowdY += enemy.y;
        crowdCount += 1;
      }
      if (ringGate !== null && Math.hypot(ringGate.x - enemy.x, ringGate.y - enemy.y) <= TUNING.gate.radius) {
        contest.enemies += 1;
        if (enemy.elite || enemy.boss) contest.elites += 1;
      }

      const reach = enemy.standoff > 0 ? enemy.standoff : (TUNING.player.size + enemy.def.size) / 2;
      if (dist <= reach * BREAKOUT_RADIUS_MUL) {
        // Repulsion from the bodies actually crowding the player: well defined
        // even when the crowd's centroid sits on top of the player, which is
        // exactly the encirclement case.
        pressCount += 1;
        pressX += (px - enemy.x) / Math.max(1, dist);
        pressY += (py - enemy.y) / Math.max(1, dist);
      }
      if (dist <= reach + 8 && simTimeMs >= enemy.nextHitAtMs) {
        // The attack happens on the archetype's own cadence whether or not it
        // connects; whether it connects is resolved once, below, against how
        // surrounded the player is.
        enemy.nextHitAtMs = simTimeMs + TUNING.enemy.hitMs;
        if (enemy.standoff > 0) rangedAttackers.push(enemy.damage);
        else contactAttackers.push(enemy.damage);
      }
    }
    // Sorted once per tick, then every weapon walks the same list from the
    // nearest body outward — which is what auto-aim does.
    nearest.sort((a, b) => a.dist - b.dist);

    // One i-frame window resolves ONE hit, and the dodge is scaled by how
    // surrounded the player is (see SURROUND_FOR_CERTAINTY). The hit that lands
    // is the biggest one offered — a player who eats a hit while boxed in eats
    // the worst thing touching them.
    let damageThisTick = 0;
    let tookHit = false;
    if (!invuln && (contactAttackers.length > 0 || rangedAttackers.length > 0)) {
      const pressure = Math.min(1, (contactAttackers.length + rangedAttackers.length) / SURROUND_FOR_CERTAINTY);
      // Contact is dodged by the route's kite quality; a telegraphed shot is
      // dodged on reaction alone.
      const dodge = contactAttackers.length > 0 ? profile.evasion * skill : skill;
      if (rng.chance((1 - dodge) * pressure)) {
        damageThisTick = Math.max(0, ...contactAttackers, ...rangedAttackers);
        tookHit = true;
        hp -= damageThisTick;
        lastHitAtMs = simTimeMs;
      }
    }
    hp -= (hazardDps(zone, elapsedS, skill) * STEP_MS) / 1000;
    hp = Math.min(maxHp, hp + (TUNING.player.regenPerSecond * STEP_MS) / 1000);

    // --- Collapse fire (bypasses i-frames, §2A) ---------------------------
    if (inCollapse && collapse !== null && overtime !== null) {
      const dps = extraction.collapseFireDps;
      overtime.ringEndPx = collapse.ringRadius;
      overtime.fireDpsEnd = dps;
      overtime.seconds = extraction.collapseElapsedS;
      if (overtime.seconds <= 30) {
        overtime.liveAt30s = enemies.length;
        overtime.elitesAt30s = liveElites();
      }
      if (Math.hypot(px - ringCentre.x, py - ringCentre.y) > collapse.ringRadius) {
        if (!overtime.fireContacted) overtime.fireContactAtS = overtime.seconds;
        overtime.fireContacted = true;
        hp -= (dps * STEP_MS) / 1000;
      }
    }

    // --- weapons ----------------------------------------------------------
    const skillDamage = SKILL_DAMAGE_FLOOR + SKILL_DAMAGE_GAIN * skill;
    for (const weapon of weapons) {
      const shot = weaponThroughput(weapon, stats);
      const engageCap = Math.max(1, Math.floor(shot.maxTargets * profile.engageRatio));
      let hits = 0;
      for (const candidate of nearest) {
        if (hits >= engageCap) break;
        if (candidate.dist > shot.reachPx) break;
        const enemy = enemies[candidate.index];
        if (enemy === undefined || enemy.hp <= 0) continue;
        const focus = enemy.elite || enemy.boss ? profile.eliteFocus : 1;
        enemy.hp -= (shot.dpsPerTarget * skillDamage * focus * STEP_MS) / 1000;
        engaged.add(enemy.def.id);
        hits += 1;
      }
    }
    for (let i = enemies.length - 1; i >= 0; i -= 1) if (enemies[i]!.hp <= 0) killEnemy(i);

    // --- level ups --------------------------------------------------------
    for (;;) {
      const needed = Math.round(TUNING.xp.base * Math.pow(TUNING.xp.growth, level - 1));
      if (xp < needed) break;
      xp -= needed;
      level += 1;
      draft();
    }

    // --- relic drip + shard caches ---------------------------------------
    if (simTimeMs >= relicDripAtMs) {
      relicDripAtMs = simTimeMs + TUNING.loot.relicDripS * 1000;
      dropRelic(0);
    }
    if (simTimeMs >= cacheAtMs) {
      cacheAtMs = simTimeMs + TUNING.loot.cacheEveryS * 1000;
      const angle = rng.float(0, Math.PI * 2);
      const dist = rng.float(TUNING.loot.cacheMinDist, TUNING.loot.cacheMaxDist);
      caches.push({
        x: Math.min(TUNING.arena.width, Math.max(0, px + Math.cos(angle) * dist)),
        y: Math.min(TUNING.arena.height, Math.max(0, py + Math.sin(angle) * dist)),
        expiresAtMs: simTimeMs + TUNING.loot.cacheLingerS * 1000,
      });
    }
    for (let i = caches.length - 1; i >= 0; i -= 1) {
      const cache = caches[i]!;
      if (simTimeMs >= cache.expiresAtMs) {
        caches.splice(i, 1);
        continue;
      }
      if (Math.hypot(px - cache.x, py - cache.y) <= stats.get('pickupRadius')) {
        bag.addShards(Math.round(TUNING.loot.cacheValue * stats.get('shardsMul')));
        caches.splice(i, 1);
      }
    }

    // --- move -------------------------------------------------------------
    if (headingTo === null) {
      // Farming. A loot-appetite route walks the caches (non-kill income — the
      // avoidant line's whole economy); otherwise every route stations itself at
      // `holdRatio` of its own reach from the crowd's centre. That single rule
      // covers both styles honestly: a brawler at 0.55 stands inside the horde
      // and clears it, a kiter at 0.95 hangs on the lip of its range and keeps
      // shooting. Retreating FURTHER than its own reach — which an earlier
      // version did — models a player who never kills anything, and the persona
      // logs are explicit that the kiting line still killed 1.29-2.51/s.
      const wantsCache = (profile.appetite.loot ?? 1) >= 3;
      let cacheTarget: ShardCache | null = null;
      let cacheDist = Number.POSITIVE_INFINITY;
      for (const cache of caches) {
        const dist = Math.hypot(px - cache.x, py - cache.y);
        if (!wantsCache && dist > OPPORTUNIST_CACHE_PX) continue;
        if (dist < cacheDist) {
          cacheTarget = cache;
          cacheDist = dist;
        }
      }
      if (cacheTarget !== null) {
        targetX = cacheTarget.x;
        targetY = cacheTarget.y;
      } else if (crowdCount > 0) {
        const primary = weaponThroughput(weapons[0]!, stats);
        const cx = crowdX / crowdCount;
        const cy = crowdY / crowdCount;
        const toCrowd = Math.max(1, Math.hypot(cx - px, cy - py));
        const hold = primary.reachPx * profile.holdRatio;
        targetX = cx - ((cx - px) / toCrowd) * hold;
        targetY = cy - ((cy - py) / toCrowd) * hold;
      }
    }

    // Break-out overrides everything short of an active channel: a player being
    // closed in on runs, whether they were farming or walking to a gate. The
    // one exception is standing in a gate ring with the hold already running —
    // leaving there throws away the extraction.
    const breakoutTrigger = Math.max(2, BREAKOUT_TRIGGER_BASE - BREAKOUT_TRIGGER_SKILL_GAIN * skill);
    const channelling = extraction.channelProgress > 0 && ringGate !== null;
    if (pressCount >= breakoutTrigger && !channelling) {
      const pressLen = Math.max(0.001, Math.hypot(pressX, pressY));
      const escape = weaponThroughput(weapons[0]!, stats).reachPx;
      targetX = px + (pressX / pressLen) * escape;
      targetY = py + (pressY / pressLen) * escape;
    }

    const stepPx = (moveSpeed * STEP_MS) / 1000;
    const dx = targetX - px;
    const dy = targetY - py;
    const moveDist = Math.hypot(dx, dy);
    if (moveDist > 1) {
      px += (dx / moveDist) * Math.min(stepPx, moveDist);
      py += (dy / moveDist) * Math.min(stepPx, moveDist);
    }
    px = Math.min(TUNING.arena.width - 40, Math.max(40, px));
    py = Math.min(TUNING.arena.height - 40, Math.max(40, py));

    for (const enemy of enemies) {
      const edx = px - enemy.x;
      const edy = py - enemy.y;
      const edist = Math.max(1, Math.hypot(edx, edy));
      // `flee` runs; everything else closes to its standoff and holds there.
      const approach = enemy.def.behaviour === 'flee' ? -1 : edist > enemy.standoff ? 1 : -0.5;
      const move = (enemy.speed * auraSpeedMul * approach * STEP_MS) / 1000;
      enemy.x += (edx / edist) * move;
      enemy.y += (edy / edist) * move;
    }

    // --- extraction (the real system, with the real in-ring census) --------
    extraction.update(STEP_MS, px, py, tookHit, contest);
    const progress = extraction.channelProgress;
    if (progress > 0 && progress < 1) {
      channelHeldS += STEP_MS / 1000;
      if (channelStartedAtMs === null) channelStartedAtMs = simTimeMs;
    } else if (progress === 0) {
      channelStartedAtMs = null;
    }
    if (extraction.channelInterrupted) channelInterrupts += 1;

    // Net hp movement this tick, smoothed with a ~10s window.
    const drainThisTick = Math.max(0, hpLast - hp) / maxHp / (STEP_MS / 1000);
    hpDrainRatioPerS += (drainThisTick - hpDrainRatioPerS) * (STEP_MS / 1000 / 10);
    hpLast = hp;

    // --- sampling ---------------------------------------------------------
    let bandIndex = 0;
    for (let i = BANDS.length - 1; i >= 0; i -= 1) {
      if (elapsedS >= BANDS[i]!.fromS) {
        bandIndex = i;
        break;
      }
    }
    const band = bands[bandIndex]!;
    band.seconds += STEP_MS / 1000;
    band.ticks += 1;
    band.kills = kills;
    band.shards = bag.shards;
    band.damageTaken += damageThisTick;
    band.liveSum += enemies.length;
    band.liveMax = Math.max(band.liveMax, enemies.length);
    band.eliteSum += liveElites();
    band.threatSum += threatMul();
    liveMax = Math.max(liveMax, enemies.length);
    if (Math.abs(elapsedS - WARDEN_BEAT_S) < STEP_MS / 1000) liveAtWardenBeat = enemies.length;
    hpMinRatio = Math.min(hpMinRatio, Math.max(0, hp) / maxHp);

    simTimeMs += STEP_MS;
    if (extraction.extracted) break;
    if (hp <= 0) {
      endReason = 'died';
      break;
    }
  }

  const carriedShards = bag.shards;
  const relicsCarried = bag.relics.length + bag.casket.length;
  // Read the outcome off the system rather than the local: `endReason` is
  // assigned inside the event callback, which control-flow analysis cannot see.
  const settlement = bag.settle(extraction.extracted ? 'extracted' : 'died', TUNING.meta.deathKeepPct);
  // `extract.collapseHaulBonus`, mirrored from the authoritative site
  // (`slices/arena/game.ts` `finish()`): banked SHARDS only, extracted branch
  // only, when the run resolved at or after the Collapse ignited. `Bag.settle`
  // stays pure — its §16.1 signature is frozen — so the premium is applied here
  // exactly as the slice applies it.
  const extractedInCollapse = extraction.extracted && simTimeMs / 1000 >= TUNING.collapse.atS;
  const collapseBonus = extractedInCollapse
    ? Math.round(settlement.shards * TUNING.extract.collapseHaulBonus)
    : 0;

  // `kills`/`shards` were sampled cumulatively; convert to per-band deltas.
  let previousKills = 0;
  let previousShards = 0;
  for (const band of bands) {
    if (band.ticks === 0) continue;
    const cumulativeKills = band.kills;
    const cumulativeShards = band.shards;
    band.kills = cumulativeKills - previousKills;
    band.shards = cumulativeShards - previousShards;
    previousKills = cumulativeKills;
    previousShards = cumulativeShards;
  }

  return {
    seed,
    lane,
    skill,
    zone: zone.id,
    endS: simTimeMs / 1000,
    endReason,
    gateUsed,
    gateIntents,
    bankedShards: settlement.shards + collapseBonus,
    extractedInCollapse,
    carriedShards,
    relicsCarried,
    relicsBanked: settlement.relics.length,
    relicsLost: settlement.lost.length,
    kills,
    eliteKills,
    wardenKilled,
    level,
    drafts,
    firstUpgradeS,
    bagBoundS,
    hpMinRatio,
    channelInterrupts,
    channelHeldS,
    channelCompletedInS,
    liveAtWardenBeat,
    liveMax,
    bands,
    engaged: [...engaged],
    spawned: [...spawnedIds],
    overtime,
    unknownStatMods,
  };
}

// ---------------------------------------------------------------------------
// Probes — single-question measurements of the two measured blockers
// ---------------------------------------------------------------------------

interface ChannelProbe {
  gate: GateId;
  /** Seconds spent standing in the ring before the channel completed, or null. */
  completedInS: number | null;
  interrupts: number;
  /** Highest progress ever reached — a failure reports its ceiling, not just "no". */
  plateau: number;
  /** Accrual rate the system settled on (1.0 = clear ring). */
  rate: number;
  elitesInRing: number;
  /** Closed-form worst case from the system's own `worstCaseChannelMs`. */
  worstCaseS: number;
}

/**
 * Ticks the REAL `ExtractionSystem` while standing in one gate's ring.
 *
 * `hitEveryMs` null is the uncontested case (§19's Gate A criterion).
 * Otherwise the bot is hit on that cadence for the whole attempt with
 * `elitesInRing` elites contesting — the case the greybox measured as
 * mathematically uncompletable: `invulnMs` 700 against `channelMs` 4000 with a
 * full reset per hit caps progress at an analytic 17.5%, and the live plateau
 * sat at 0.13-0.22 across 115 continuous seconds inside Gate B's ring.
 */
function probeChannel(
  gateId: GateId,
  hitEveryMs: number | null,
  elitesInRing: number,
  limitS: number,
): ChannelProbe {
  const extraction = newExtraction(zoneGates(ZONES[0]!));
  const gate = extraction.gates.find((entry) => entry.id === gateId)!;
  const openAtMs = gate.opensS * 1000;
  const worstCaseS =
    worstCaseChannelMs(extraction.channelTuning, TUNING.player.invulnMs, elitesInRing) / 1000;
  const contest: ChannelContest | undefined =
    hitEveryMs === null ? undefined : { enemies: Math.max(1, elitesInRing), elites: elitesInRing };

  let interrupts = 0;
  let plateau = 0;
  let standingMs = 0;
  let nextHitMs = hitEveryMs ?? Number.POSITIVE_INFINITY;
  let rate = 1;

  for (let t = 0; t < (gate.opensS + limitS) * 1000; t += STEP_MS) {
    const inRing = t >= openAtMs;
    let tookHit = false;
    if (inRing && hitEveryMs !== null && standingMs >= nextHitMs) {
      nextHitMs += hitEveryMs;
      tookHit = true;
    }
    // Before the window the bot waits at the arena centre; inside it, it stands
    // exactly on the gate.
    extraction.update(
      STEP_MS,
      inRing ? gate.x : TUNING.arena.width / 2,
      inRing ? gate.y : TUNING.arena.height / 2,
      tookHit,
      inRing ? contest : undefined,
    );
    if (!inRing) continue;
    standingMs += STEP_MS;
    rate = extraction.channelRate;
    plateau = Math.max(plateau, extraction.channelProgress);
    if (extraction.channelInterrupted) interrupts += 1;
    if (extraction.extracted) {
      return {
        gate: gateId,
        completedInS: standingMs / 1000,
        interrupts,
        plateau: 1,
        rate,
        elitesInRing,
        worstCaseS,
      };
    }
  }
  return { gate: gateId, completedInS: null, interrupts, plateau, rate, elitesInRing, worstCaseS };
}

interface ReachProbe {
  zone: string;
  gate: GateId;
  travelS: number;
  windowS: number;
  channelS: number;
  ok: boolean;
}

/**
 * §19: every gate reachable from spawn inside its own open window at BASE
 * moveSpeed — travel plus a full channel, no upgrades, no shortcuts. Gate C
 * never closes, so its window ends at the Collapse: arriving after the ring has
 * ignited is not "reachable within the window".
 */
function probeReachability(): ReachProbe[] {
  const probes: ReachProbe[] = [];
  const startX = TUNING.arena.width / 2;
  const startY = TUNING.arena.height / 2;
  for (const zone of ZONES) {
    const extraction = newExtraction(zoneGates(zone));
    const channelS = extraction.channelMsEffective / 1000;
    for (const gate of extraction.gates) {
      const travelS = Math.hypot(startX - gate.x, startY - gate.y) / TUNING.player.moveSpeed;
      const windowS = (gate.closesS ?? TUNING.collapse.atS) - gate.opensS;
      probes.push({
        zone: zone.id,
        gate: gate.id,
        travelS,
        windowS,
        channelS,
        ok: travelS + channelS <= windowS,
      });
    }
  }
  return probes;
}

interface IdleProbe {
  deathAtOvertimeS: number | null;
  ringStartPx: number;
  ringEndPx: number;
  fireContactedAtS: number | null;
  fireDpsEnd: number;
  hpEnd: number;
  maxHp: number;
}

/**
 * §19: the Collapse kills an IDLE bot within 90s past its start — the anti-idle
 * ending. Deliberately generous: the bot enters overtime at the highest max-HP
 * the card pool can reach, stands still in the arena corner FARTHEST from the
 * ring centre, and takes nothing but ring fire. If that bot lives, no player can
 * ever be forced out, which is exactly what the greybox measured (the ring
 * opened at 2340px and never made contact in 29s of overtime).
 */
function probeIdleCollapse(): IdleProbe {
  const gates = zoneGates(ZONES[0]!);
  const centre = gates.find((gate) => gate.id === TUNING.collapse.centerGate) ?? gates[gates.length - 1]!;
  const corners: ReadonlyArray<readonly [number, number]> = [
    [40, 40],
    [TUNING.arena.width - 40, 40],
    [40, TUNING.arena.height - 40],
    [TUNING.arena.width - 40, TUNING.arena.height - 40],
  ];
  let far = corners[0]!;
  for (const corner of corners) {
    if (
      Math.hypot(corner[0] - centre.x, corner[1] - centre.y) >
      Math.hypot(far[0] - centre.x, far[1] - centre.y)
    ) {
      far = corner;
    }
  }

  // The most HP a build can hold: base plus every maxHp card at full stacks.
  const stats = new StatBlock(baseStats());
  for (const card of UPGRADE_CARDS) {
    for (const mod of card.modifiers) {
      if (mod.stat !== 'maxHp') continue;
      for (let stack = 0; stack < card.maxStacks; stack += 1) {
        stats.addModifier({ ...mod, source: `${card.id}:${stack}` });
      }
    }
  }
  const maxHp = stats.get('maxHp');
  let hp = maxHp;

  const extraction = newExtraction(gates);
  const centreDist = Math.hypot(far[0] - centre.x, far[1] - centre.y);
  let ringStartPx = 0;
  let ringEndPx = 0;
  let fireContactedAtS: number | null = null;
  let fireDpsEnd: number = TUNING.collapse.fireDps;

  for (let t = 0; t <= (TUNING.collapse.atS + 120) * 1000; t += STEP_MS) {
    extraction.update(STEP_MS, far[0], far[1], false);
    const collapse = extraction.collapse;
    if (collapse === null || !collapse.active) continue;
    ringStartPx = extraction.collapseRingStartRadius;
    ringEndPx = collapse.ringRadius;
    fireDpsEnd = extraction.collapseFireDps;
    if (centreDist > collapse.ringRadius) {
      if (fireContactedAtS === null) fireContactedAtS = extraction.collapseElapsedS;
      hp -= (fireDpsEnd * STEP_MS) / 1000;
    }
    if (hp <= 0) {
      return {
        deathAtOvertimeS: extraction.collapseElapsedS,
        ringStartPx,
        ringEndPx,
        fireContactedAtS,
        fireDpsEnd,
        hpEnd: 0,
        maxHp,
      };
    }
  }
  return { deathAtOvertimeS: null, ringStartPx, ringEndPx, fireContactedAtS, fireDpsEnd, hpEnd: hp, maxHp };
}

interface Probes {
  reach: ReachProbe[];
  clean: ChannelProbe;
  contestedB: ChannelProbe;
  contestedC: ChannelProbe;
  idle: IdleProbe;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Seconds a run must have spent inside a band before its rate is reportable. */
const MIN_BAND_SAMPLE_S = 30;

interface LaneStats {
  lane: LanePolicy;
  runs: number;
  extracted: number;
  extractionRate: number;
  died: number;
  unresolved: number;
  medianEndS: number;
  medianBanked: number;
  gateMix: Record<string, number>;
  /** Median live-enemy count through Early — the horde a route declines to clear. */
  earlyLiveAvg: number;
  earlyKillsPerS: number;
  midKillsPerS: number;
  lateKillsPerS: number;
  earlyShardsPerS: number;
  midShardsPerS: number;
  lateShardsPerS: number;
  bagBoundBefore400: number;
  medianDrafts: number;
  medianRelics: number;
  /** Share of runs that killed the Gate Warden — the §8 deep-route signature. */
  wardenKillRate: number;
  /** Share of runs that extracted at or after the Collapse ignited (paid the haul premium). */
  collapseExtractRate: number;
}

function laneStats(lane: LanePolicy, runs: readonly RouteRun[]): LaneStats {
  const mine = runs.filter((run) => run.lane === lane);
  const gateMix: Record<string, number> = {};
  for (const run of mine) {
    const key = run.gateUsed ?? run.endReason;
    gateMix[key] = (gateMix[key] ?? 0) + 1;
  }
  // A rate measured over a 5-second sliver of a band is noise, and comparing
  // one lane's sliver against another's full window is worse than noise: it
  // inverted the income-fork check, because a lane that extracts at 133s only
  // samples the densest 13 seconds of Mid. So a band only reports a rate once
  // the run actually spent MIN_BAND_SAMPLE_S in it.
  const bandRate = (index: number, field: 'kills' | 'shards'): number => {
    const values = mine
      .map((run) => run.bands[index]!)
      .filter((band) => band.seconds >= MIN_BAND_SAMPLE_S)
      .map((band) => band[field] / band.seconds);
    return values.length > 0 ? median(values) : Number.NaN;
  };
  const extracted = mine.filter((run) => run.endReason === 'extracted').length;
  return {
    lane,
    runs: mine.length,
    extracted,
    extractionRate: mine.length > 0 ? extracted / mine.length : 0,
    died: mine.filter((run) => run.endReason === 'died').length,
    unresolved: mine.filter((run) => run.endReason === 'unresolved').length,
    medianEndS: median(mine.map((run) => run.endS)),
    medianBanked: median(mine.map((run) => run.bankedShards)),
    gateMix,
    earlyLiveAvg: (() => {
      const values = mine
        .map((run) => run.bands[1]!)
        .filter((band) => band.seconds >= MIN_BAND_SAMPLE_S)
        .map((band) => band.liveSum / band.ticks);
      return values.length > 0 ? median(values) : Number.NaN;
    })(),
    earlyKillsPerS: bandRate(1, 'kills'),
    midKillsPerS: bandRate(2, 'kills'),
    lateKillsPerS: bandRate(3, 'kills'),
    earlyShardsPerS: bandRate(1, 'shards'),
    midShardsPerS: bandRate(2, 'shards'),
    lateShardsPerS: bandRate(3, 'shards'),
    bagBoundBefore400:
      mine.length > 0
        ? mine.filter((run) => run.bagBoundS !== null && run.bagBoundS < 400).length / mine.length
        : 0,
    medianDrafts: median(mine.map((run) => run.drafts)),
    medianRelics: median(mine.map((run) => run.relicsBanked + run.relicsLost)),
    wardenKillRate: mine.length > 0 ? mine.filter((run) => run.wardenKilled).length / mine.length : 0,
    collapseExtractRate:
      mine.length > 0 ? mine.filter((run) => run.extractedInCollapse).length / mine.length : 0,
  };
}

/**
 * §15 peak budget: 180 enemies out of the ~300 live sprites at the Warden beat
 * (the rest is projectiles, shards, relic pickups and particles). The enemy
 * share is the part a headless sim can measure, so that is what it asserts —
 * and a `TUNING.enemy.maxAlive` above it is a finding, not rounding.
 */
const WARDEN_BEAT_ENEMY_BUDGET = 180;
const ENTITY_CAP = 300;
/** DesignFix's frozen §7 bounds for the re-spec'd channel. */
const CONTESTED_GATE_B_LIMIT_S = 20;
const CONTESTED_GATE_C_LIMIT_S = 30;
/** §19 lane bounds. */
const MAX_LANE_SPREAD = 0.35;
const COURIER_MIN_EXTRACTION = 0.85;
const DEEP_EXTRACTION_BAND: readonly [number, number] = [0.35, 0.65];
const MAX_FIRST_UPGRADE_S = 50;

function evaluateGates(
  runs: readonly RouteRun[],
  ceiling: readonly RouteRun[],
  floor: readonly RouteRun[],
  probes: Probes,
  lanesRun: readonly LanePolicy[],
): GateResult[] {
  const gates: GateResult[] = [];
  const lanes = lanesRun.map((lane) => laneStats(lane, ceiling));
  /**
   * `--lane <one>` is a diagnostic mode for iterating on a single route; the
   * cross-lane gates (spread, the income fork) are undefined there and say so
   * instead of failing on absent data. `verify.sh` always runs `--lane all`, so
   * the shipping gate set is unaffected.
   */
  const allLanes = lanesRun.length === LANES.length;
  const singleLaneNote = ` — not measurable with --lane ${lanesRun.join(',')}; needs --lane all`;
  const courier = lanes.find((lane) => lane.lane === 'gloam-courier') ?? laneStats('gloam-courier', ceiling);
  const deep = lanes.find((lane) => lane.lane === 'ash-reaper') ?? laneStats('ash-reaper', ceiling);

  // --- §19 lane battery ---------------------------------------------------
  gates.push(
    hard(
      lanes.every((lane) => lane.runs > 0),
      `${allLanes ? 'all three' : lanes.length} §8 route lane(s) ran: ` +
        `${lanes.map((lane) => `${lane.lane}=${lane.runs}`).join(' ')}${allLanes ? '' : singleLaneNote}`,
    ),
  );

  const rates = lanes.map((lane) => lane.extractionRate);
  const spread = Math.max(...rates) - Math.min(...rates);
  gates.push(
    hard(
      !allLanes || spread <= MAX_LANE_SPREAD,
      `win-rate spread across lanes = ${num(spread)} (<= ${MAX_LANE_SPREAD}) [${lanes
        .map((lane) => `${lane.lane} ${pct(lane.extractionRate)}`)
        .join(', ')}]${allLanes ? '' : singleLaneNote}`,
    ),
  );

  gates.push(
    hard(
      !lanesRun.includes('gloam-courier') || courier.extractionRate >= COURIER_MIN_EXTRACTION,
      `courier extraction rate = ${pct(courier.extractionRate)} (>= ${pct(COURIER_MIN_EXTRACTION)}) ` +
        `[owner config.ts TUNING.gate windows + data/waves.ts]`,
    ),
  );

  gates.push(
    hard(
      !lanesRun.includes('ash-reaper') ||
        (deep.extractionRate >= DEEP_EXTRACTION_BAND[0] && deep.extractionRate <= DEEP_EXTRACTION_BAND[1]),
      `deep-lane extraction rate = ${pct(deep.extractionRate)} ` +
        `(${pct(DEEP_EXTRACTION_BAND[0])}-${pct(DEEP_EXTRACTION_BAND[1])}) [owner data/waves.ts threat curve]`,
    ),
  );

  const firstUpgrades = runs
    .map((run) => run.firstUpgradeS)
    .filter((value): value is number => value !== null);
  const medianFirstUpgrade = firstUpgrades.length > 0 ? median(firstUpgrades) : Number.NaN;
  gates.push(
    hard(
      Number.isFinite(medianFirstUpgrade) && medianFirstUpgrade <= MAX_FIRST_UPGRADE_S,
      `median firstUpgradeS = ${num(medianFirstUpgrade, 1)} (<= ${MAX_FIRST_UPGRADE_S}) ` +
        `[owner config.ts TUNING.xp + data/waves.ts early spawn budget]`,
    ),
  );

  const unresolved = runs.filter((run) => run.endReason === 'unresolved');
  gates.push(
    hard(
      unresolved.length === 0,
      `every run ended by extraction or death, never by a clock: ` +
        `${runs.length - unresolved.length}/${runs.length}` +
        (unresolved.length > 0
          ? ` — ${unresolved.length} unresolved after ${SAFETY_OVERTIME_S}s of overtime`
          : ''),
    ),
  );

  // --- §19 extraction battery --------------------------------------------

  // §19 asks that no lane ends by a timer and that gate decisions are actually
  // taken. A run that dies at 70s never SAW a gate open, so requiring an intent
  // from it would measure the death rate twice; what must hold is that every run
  // which lived into a gate window decided something, and that every lane
  // decides in runs of its own.
  const extractedRuns = runs.filter((run) => run.endReason === 'extracted');
  const lanesDeciding = lanesRun.filter((lane) =>
    runs.some((run) => run.lane === lane && run.gateIntents.some((reason) => reason !== 'farm')),
  );
  const diedBeforeDeciding = runs.filter(
    (run) => run.endReason === 'died' && run.gateIntents.every((reason) => reason === 'farm'),
  ).length;
  gates.push(
    hard(
      lanesDeciding.length === lanesRun.length,
      `every lane's gate policy fires in its own runs: ${lanesDeciding.length}/${lanesRun.length} ` +
        `(${diedBeforeDeciding}/${runs.length} runs died before any gate they plan for was reachable — that is ` +
        `the death rate, not a missing decision)`,
    ),
  );

  // The run is supposed to RESOLVE on a leave-or-loot decision. Because the
  // channel starts simply by standing in an open ring (§2A), a bot can also be
  // extracted by walking across one while farming — which is a decision nobody
  // made. A few such runs are the price of a frictionless ring; a large share
  // would mean the game's whole axis is being resolved by accident.
  const accidental = extractedRuns.filter((run) => run.gateIntents.every((reason) => reason === 'farm'));
  const accidentalShare = extractedRuns.length > 0 ? accidental.length / extractedRuns.length : 0;
  gates.push(
    hard(
      accidentalShare < 0.2,
      `extractions are DECIDED, not stumbled into: ${accidental.length}/${extractedRuns.length} ` +
        `(${pct(accidentalShare)}) completed a channel with no gate intent ever logged — a bot that walked over ` +
        `an open ring while farming (< 20%) [owner slices/arena/game.ts channel entry + config.ts TUNING.gate.radius]`,
    ),
  );
  const unreachable = probes.reach.filter((probe) => !probe.ok);
  gates.push(
    hard(
      unreachable.length === 0,
      unreachable.length === 0
        ? `all ${probes.reach.length} zone/gate pairs reachable from spawn at base moveSpeed inside their window`
        : `unreachable at base moveSpeed [owner data/zones.ts gate coords + config.ts TUNING.gate]: ` +
          unreachable
            .map(
              (probe) =>
                `${probe.zone}/${probe.gate} travel ${num(probe.travelS, 1)}s + channel ` +
                `${num(probe.channelS, 1)}s > window ${num(probe.windowS, 0)}s`,
            )
            .join('; '),
    ),
  );

  gates.push(
    hard(
      probes.clean.completedInS !== null &&
        probes.clean.completedInS <= TUNING.extract.channelMs / 1000 + 0.3,
      `clean channel at Gate A completed in ` +
        `${probes.clean.completedInS === null ? 'NEVER' : `${num(probes.clean.completedInS, 1)}s`} ` +
        `(channelMs ${TUNING.extract.channelMs}) [owner systems/extraction.ts]`,
    ),
  );

  for (const [probe, limit, label] of [
    [probes.contestedB, CONTESTED_GATE_B_LIMIT_S, 'Gate B under unbroken contact'],
    [probes.contestedC, CONTESTED_GATE_C_LIMIT_S, 'Gate C under the Warden (1 elite in ring)'],
  ] as const) {
    gates.push(
      hard(
        probe.completedInS !== null && probe.completedInS <= limit,
        `CONTESTED channel, ${label}: ` +
          `${
            probe.completedInS === null
              ? `NEVER completed — plateau ${num(probe.plateau)} after ${probe.interrupts} interrupts`
              : `${num(probe.completedInS, 1)}s`
          } (<= ${limit}s; closed-form worst case ${num(probe.worstCaseS, 1)}s at rate ${num(probe.rate)}) ` +
          `[owner systems/extraction.ts + config.ts TUNING.extract]`,
      ),
    );
  }

  // The channel law itself: one contact cycle must net POSITIVE progress, or no
  // tuning anywhere else makes a contested gate usable. Asserted through the
  // system's own exported predicate so the algebra lives in exactly one place.
  const channel = newExtraction(zoneGates(ZONES[0]!)).channelTuning;
  const net = (TUNING.player.invulnMs - channel.hitStallMs) * channel.minRate - channel.hitSetbackMs;
  gates.push(
    hard(
      channelCompletableUnderContact(channel, TUNING.player.invulnMs),
      `channel law: (invulnMs ${TUNING.player.invulnMs} - hitStallMs ${channel.hitStallMs}) * minRate ` +
        `${channel.minRate} - hitSetbackMs ${channel.hitSetbackMs} = ${num(net, 1)}ms of progress per contact ` +
        `cycle (must be > 0) [owner config.ts TUNING.extract]`,
    ),
  );

  // --- Collapse battery ---------------------------------------------------
  gates.push(
    hard(
      probes.idle.deathAtOvertimeS !== null && probes.idle.deathAtOvertimeS <= 90,
      `Collapse kills an idle bot (${num(probes.idle.maxHp, 0)} hp, farthest corner) ` +
        `${
          probes.idle.deathAtOvertimeS === null
            ? `NEVER — ${num(probes.idle.hpEnd, 0)} hp left after 120s of overtime`
            : `at +${num(probes.idle.deathAtOvertimeS, 1)}s`
        } past ${TUNING.collapse.atS}s (<= 90s) [owner systems/extraction.ts + config.ts TUNING.collapse]`,
    ),
  );

  gates.push(
    hard(
      probes.idle.fireContactedAtS !== null,
      `the Collapse ring actually closes on the player (greybox: opened at 2340px, no contact in 29s): ` +
        `contact ${probes.idle.fireContactedAtS === null ? 'NEVER' : `at +${num(probes.idle.fireContactedAtS, 1)}s`}, ` +
        `ring ${num(probes.idle.ringStartPx, 0)}px -> ${num(probes.idle.ringEndPx, 0)}px ` +
        `[owner systems/extraction.ts + config.ts TUNING.collapse]`,
    ),
  );

  const overtimes = runs
    .map((run) => run.overtime)
    .filter((sample): sample is OvertimeSample => sample !== null);
  if (overtimes.length > 0) {
    const eliteRose = overtimes.filter((s) => s.elitesAt30s > s.elitesAtStart).length / overtimes.length;
    const dpsRose = overtimes.filter((s) => s.fireDpsEnd > s.fireDpsStart).length / overtimes.length;
    const ringShrank = overtimes.filter((s) => s.ringEndPx < s.ringStartPx).length / overtimes.length;
    gates.push(
      hard(
        eliteRose >= 0.6 && dpsRose >= 0.6 && ringShrank >= 0.9,
        `overtime escalation is OBSERVABLE rather than masked by a saturated spawn cap: elites rose in ` +
          `${pct(eliteRose)} of overtime runs, fire dps stepped in ${pct(dpsRose)}, ring shrank in ` +
          `${pct(ringShrank)}; live ${num(median(overtimes.map((s) => s.liveAtStart)), 0)} -> ` +
          `${num(median(overtimes.map((s) => s.liveAt30s)), 0)}, elites ` +
          `${num(median(overtimes.map((s) => s.elitesAtStart)), 1)} -> ` +
          `${num(median(overtimes.map((s) => s.elitesAt30s)), 1)} ` +
          `[owner config.ts TUNING.collapse + data/waves.ts]`,
      ),
    );
  } else {
    gates.push(
      hard(false, 'no run reached the Collapse — overtime escalation unmeasurable [owner data/waves.ts]'),
    );
  }

  // --- late-game pressure must actually rise (measured greybox failure) ---
  const pressure = ceiling
    .filter((run) => run.bands[3]!.seconds > 10 && run.bands[4]!.seconds > 10)
    .map((run) => ({
      late: run.bands[3]!.damageTaken / run.bands[3]!.seconds,
      climax: run.bands[4]!.damageTaken / run.bands[4]!.seconds,
    }));
  if (pressure.length > 0) {
    const lateMed = median(pressure.map((entry) => entry.late));
    const climaxMed = median(pressure.map((entry) => entry.climax));
    gates.push(
      hard(
        climaxMed >= lateMed * 1.1,
        `late-game pressure rises: damage taken/s Late ${num(lateMed)} -> Climax ${num(climaxMed)} ` +
          `across the ${pressure.length} runs that spanned both bands (Climax must exceed Late by 10%; the ` +
          `greybox measured player hp RISING at 470s) ` +
          `[owner data/waves.ts + config.ts TUNING.wave]`,
      ),
    );
  } else {
    gates.push(hard(false, 'no ceiling run spanned both Late and Climax [owner data/waves.ts threat curve]'));
  }

  // --- §15 entity budget at the Warden beat -------------------------------
  const wardenBeat = ceiling.filter((run) => run.endS >= WARDEN_BEAT_S).map((run) => run.liveAtWardenBeat);
  if (wardenBeat.length > 0) {
    const worst = Math.max(...wardenBeat);
    gates.push(
      hard(
        worst <= WARDEN_BEAT_ENEMY_BUDGET,
        `live enemies at the ${WARDEN_BEAT_S}s Warden beat: max ${worst}, median ` +
          `${num(median(wardenBeat), 0)} (<= ${WARDEN_BEAT_ENEMY_BUDGET}, the enemy share of §15's ` +
          `${ENTITY_CAP}-sprite cap; TUNING.enemy.maxAlive is ${TUNING.enemy.maxAlive}) ` +
          `[owner config.ts TUNING.enemy.maxAlive]`,
      ),
    );
  } else {
    gates.push(
      hard(false, `no ceiling run reached the ${WARDEN_BEAT_S}s Warden beat [owner data/waves.ts threat curve]`),
    );
  }

  // --- bag must bind (§19) ------------------------------------------------
  gates.push(
    hard(
      !lanesRun.includes('ash-reaper') || deep.bagBoundBefore400 >= 0.6,
      `deep lane hit bag capacity before 400s in ${pct(deep.bagBoundBefore400)} of runs (>= 60%) ` +
        `[owner config.ts TUNING.loot.firstRelicS/relicDripS/eliteRelics]`,
    ),
  );

  // --- the income fork the greybox measured ------------------------------
  // Measured in the EARLY band: it is the last window every lane still occupies
  // in full, so the two lanes are compared over the same 90 seconds rather than
  // one lane's tail against another's whole phase.
  // The avoidance signal is the horde LEFT STANDING, not the kill rate. Early
  // kill rate is spawn-limited — every lane kills roughly what arrives — so the
  // two styles only separate in what they let accumulate, which is also the
  // mechanism the playtest identified: the avoidant line builds the wall that
  // later locks it out of a gate.
  gates.push(
    hard(
      !allLanes || courier.earlyLiveAvg >= deep.earlyLiveAvg * 1.5,
      `the avoidant lane is genuinely avoidant: through Early it leaves ${num(courier.earlyLiveAvg, 1)} enemies ` +
        `standing against the reaper's ${num(deep.earlyLiveAvg, 1)} (must be >= 1.5x, or the spread gate hides ` +
        `the income fork), and takes ${num(courier.earlyKillsPerS)} kills/s vs ${num(deep.earlyKillsPerS)}`,
    ),
  );
  gates.push(
    hard(
      !lanesRun.includes('gloam-courier') || courier.earlyShardsPerS >= 1.0,
      `avoidant income floor: courier shards/s Early ${num(courier.earlyShardsPerS)} / Mid ` +
        `${num(courier.midShardsPerS)} (must clear 1.0/s — the greybox measured the kiting line collapsing ` +
        `to 1.30 then 0.79) [owner config.ts TUNING.loot.cache*]`,
    ),
  );

  // --- greed premium (§6 loot EV) ----------------------------------------
  const haulA = runs.filter((run) => run.gateUsed === 'a').map((run) => run.bankedShards);
  const haulB = runs.filter((run) => run.gateUsed === 'b').map((run) => run.bankedShards);
  const haulC = runs.filter((run) => run.gateUsed === 'c').map((run) => run.bankedShards);
  if (haulA.length > 0 && haulB.length > 0) {
    const ratio = median(haulB) / Math.max(1, median(haulA));
    gates.push(
      hard(
        ratio >= 1.6 && ratio <= 2.6,
        `greed premium Gate B / Gate A = ${num(ratio)}x (1.6-2.6; the greybox measured 2.08x on hauls ` +
          `177/530) [owner config.ts TUNING.loot + data/enemies.ts shard values]`,
      ),
    );
  }
  if (haulB.length > 0 && haulC.length > 0) {
    gates.push(
      hard(
        median(haulC) > median(haulB),
        `haul is monotone in greed: A ${num(median(haulA), 0)} < B ${num(median(haulB), 0)} < ` +
          `C ${num(median(haulC), 0)} shards`,
      ),
    );
  }

  // --- death must cost relics (§5.6; bag.autoPinHighest false) ------------
  const relicDeaths = runs.filter((run) => run.endReason === 'died' && run.relicsCarried > 0);
  if (relicDeaths.length > 0) {
    const costly = relicDeaths.filter((run) => run.relicsLost > 0).length / relicDeaths.length;
    gates.push(
      hard(
        costly >= 0.8,
        `death costs relics: ${pct(costly)} of relic-carrying deaths lost something (>= 80%; the old ` +
          `auto-pinning casket made 3 of 5 measured deaths cost nothing) ` +
          `[owner systems/bag.ts + config.ts TUNING.bag.autoPinHighest]`,
      ),
    );
  } else {
    gates.push(
      hard(false, 'no run died carrying a relic — the loss beat is unmeasurable [owner config.ts TUNING.loot]'),
    );
  }

  // --- the §5.5 source-bias guarantee, ANALYTIC (not sampled) -------------
  //
  // §5.5 promises the player that a Shrine or Warden roll (`+2` source bias)
  // is Gilded-or-Dread. That is a NEVER-claim, so it is proved on the ladder
  // itself rather than on draws: `relicTierWeights` composes the base ladder,
  // the zone bias and the source shift, and a zone whose `lootBias` pushes
  // weight into t1/t2 could leave a low tier reachable under +2 in that zone
  // only — which sampling across the run set would report as "no t1 seen".
  const leakyZones = ZONES.filter((zone) => {
    const weights = relicTierWeights(zone.id, TUNING.loot.bossTierBias);
    return (weights[0] ?? 0) > 0 || (weights[1] ?? 0) > 0;
  });
  gates.push(
    hard(
      leakyZones.length === 0,
      leakyZones.length === 0
        ? `the +${TUNING.loot.bossTierBias} source bias (Shrine/Warden) cannot roll below Gilded in any of ` +
          `the ${ZONES.length} zones`
        : `zones where a +${TUNING.loot.bossTierBias} roll can still produce Tarnished/Burnished ` +
          `[owner data/zones.ts lootBias + config.ts TUNING.loot.tierWeights]: ` +
          `${leakyZones.map((zone) => zone.id).join(', ')}`,
    ),
  );

  // --- per-type engagement law (§18.1) -----------------------------------
  const spawnedAll = new Set<string>();
  for (const run of ceiling) for (const id of run.spawned) spawnedAll.add(id);
  const neverEngaged = [...spawnedAll].filter((id) => {
    const seen = ceiling.filter((run) => run.spawned.includes(id));
    if (seen.length === 0) return false;
    return seen.filter((run) => run.engaged.includes(id)).length / seen.length < 0.5;
  });
  gates.push(
    hard(
      neverEngaged.length === 0,
      neverEngaged.length === 0
        ? `every one of the ${spawnedAll.size} spawned archetypes is engaged by the ceiling bot in a median run`
        : `archetypes the ceiling bot never fights [owner data/waves.ts + data/enemies.ts]: ${neverEngaged.join(', ')}`,
    ),
  );

  // --- floor-bot sanity (§18.1) ------------------------------------------
  if (floor.length > 0) {
    const floorRate = floor.filter((run) => run.endReason === 'extracted').length / floor.length;
    gates.push(
      hard(
        floorRate > 0 && floorRate < 0.9,
        `weak-human FLOOR bot (skill ${FLOOR_SKILL}) extraction rate = ${pct(floorRate)} ` +
          `(must be neither hopeless nor a formality)`,
      ),
    );
  }

  // --- draft/stat wiring drift -------------------------------------------
  const unknown = new Set<string>();
  for (const run of runs) for (const entry of run.unknownStatMods) unknown.add(entry);
  gates.push(
    hard(
      unknown.size === 0,
      unknown.size === 0
        ? 'every upgrade-card modifier targets a stat the run model reads'
        : `upgrade cards modify stats nothing reads [owner data/upgrades.ts + config.ts]: ` +
          [...unknown].slice(0, 8).join(', '),
    ),
  );

  return gates;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function renderReport(
  runs: readonly RouteRun[],
  ceiling: readonly RouteRun[],
  probes: Probes,
  lanesRun: readonly LanePolicy[],
): void {
  console.log('LANES (skill ceiling — the §19 battery reads these rows)');
  printTable(
    [
      'lane',
      'runs',
      'extract%',
      'died',
      'medEndS',
      'medHaul',
      'gate mix',
      'earlyLive',
      'earlyK/s',
      'midK/s',
      'lateK/s',
      'earlySh/s',
      'bag<400s',
      'drafts',
      'relics',
      'warden%',
      'postCollapse%',
    ],
    lanesRun.map((lane) => {
      const stats = laneStats(lane, ceiling);
      return [
        stats.lane,
        String(stats.runs),
        pct(stats.extractionRate),
        String(stats.died),
        num(stats.medianEndS, 0),
        num(stats.medianBanked, 0),
        Object.entries(stats.gateMix)
          .map(([key, count]) => `${key}:${count}`)
          .join(' '),
        num(stats.earlyLiveAvg, 1),
        num(stats.earlyKillsPerS),
        num(stats.midKillsPerS),
        num(stats.lateKillsPerS),
        num(stats.earlyShardsPerS),
        pct(stats.bagBoundBefore400),
        num(stats.medianDrafts, 0),
        num(stats.medianRelics, 0),
        pct(stats.wardenKillRate),
        pct(stats.collapseExtractRate),
      ];
    }),
  );

  console.log('');
  console.log('PROGRESSION BY PHASE BAND (ceiling bot, median across lanes) — comparable to the greybox logs');
  printTable(
    ['band', 'window', 'threat', 'live avg', 'live max', 'elite avg', 'kills/s', 'shards/s', 'dmg/s'],
    BANDS.map((band, index) => {
      const window = `${band.fromS}-${Number.isFinite(band.toS) ? band.toS : 'end'}s`;
      const samples = ceiling.map((run) => run.bands[index]!).filter((sample) => sample.seconds > 1);
      if (samples.length === 0) return [band.name, window, '-', '-', '-', '-', '-', '-', '-'];
      return [
        band.name,
        window,
        num(median(samples.map((sample) => sample.threatSum / sample.ticks))),
        num(median(samples.map((sample) => sample.liveSum / sample.ticks)), 0),
        String(Math.max(...samples.map((sample) => sample.liveMax))),
        num(median(samples.map((sample) => sample.eliteSum / sample.ticks)), 1),
        num(median(samples.map((sample) => sample.kills / sample.seconds))),
        num(median(samples.map((sample) => sample.shards / sample.seconds))),
        num(median(samples.map((sample) => sample.damageTaken / sample.seconds))),
      ];
    }),
  );

  console.log('');
  console.log('PROBES (the real ExtractionSystem, ticked directly)');
  printTable(
    ['probe', 'result', 'detail'],
    [
      [
        'channel clean (Gate A)',
        probes.clean.completedInS === null ? 'NEVER' : `${num(probes.clean.completedInS, 1)}s`,
        `channelMs ${TUNING.extract.channelMs}, rate ${num(probes.clean.rate)}, plateau ${num(probes.clean.plateau)}`,
      ],
      [
        'channel contested (Gate B)',
        probes.contestedB.completedInS === null ? 'NEVER' : `${num(probes.contestedB.completedInS, 1)}s`,
        `hit every ${TUNING.player.invulnMs}ms, rate ${num(probes.contestedB.rate)}, interrupts ` +
          `${probes.contestedB.interrupts}, worst case ${num(probes.contestedB.worstCaseS, 1)}s, plateau ` +
          `${num(probes.contestedB.plateau)}`,
      ],
      [
        'channel contested (Gate C)',
        probes.contestedC.completedInS === null ? 'NEVER' : `${num(probes.contestedC.completedInS, 1)}s`,
        `Warden in ring (elites ${probes.contestedC.elitesInRing}), rate ${num(probes.contestedC.rate)}, ` +
          `worst case ${num(probes.contestedC.worstCaseS, 1)}s, plateau ${num(probes.contestedC.plateau)}`,
      ],
      [
        'collapse vs idle bot',
        probes.idle.deathAtOvertimeS === null ? 'SURVIVED' : `+${num(probes.idle.deathAtOvertimeS, 1)}s`,
        `ring ${num(probes.idle.ringStartPx, 0)} -> ${num(probes.idle.ringEndPx, 0)}px, contact ` +
          `${probes.idle.fireContactedAtS === null ? 'never' : `+${num(probes.idle.fireContactedAtS, 1)}s`}, ` +
          `end dps ${num(probes.idle.fireDpsEnd, 0)}, hp ${num(probes.idle.maxHp, 0)}`,
      ],
    ],
  );

  console.log('');
  console.log('GATE REACHABILITY (base moveSpeed, spawn -> gate, travel + full channel vs window)');
  printTable(
    ['zone', 'gate', 'travelS', 'channelS', 'windowS', 'ok'],
    probes.reach.map((probe) => [
      probe.zone,
      probe.gate,
      num(probe.travelS, 1),
      num(probe.channelS, 1),
      num(probe.windowS, 0),
      probe.ok ? 'yes' : 'NO',
    ]),
  );

  const unresolved = runs.filter((run) => run.endReason === 'unresolved');
  if (unresolved.length > 0) {
    console.log('');
    console.log(`UNRESOLVED RUNS (${unresolved.length}) — the "no timer end" failures`);
    for (const run of unresolved.slice(0, 5)) {
      console.log(
        `  ${run.lane} skill ${run.skill}: ${num(run.endS, 0)}s, intents ${run.gateIntents.join('>')}, seed ${run.seed}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface ArenaSimOptions extends FamilySimOptions {
  /** `--lane`: one §8 route, or every route. */
  lane?: 'all' | LanePolicy;
}

/**
 * The family entry point. Exported as the DEFAULT only: `sim/cli.ts` resolves
 * every non-arena family through `mod.default`, so one export surface per
 * family module is the contract (see the bottom of this file).
 */
function runArenaSim(options: ArenaSimOptions): number {
  const lanes = options.lane === undefined || options.lane === 'all' ? LANES : [options.lane];
  const runCount = Number.isFinite(options.runs) && options.runs > 0 ? options.runs : 20;
  const seeder = new Rng(`${options.seed}:arena`);
  const runs: RouteRun[] = [];
  for (const lane of lanes) {
    for (const skill of SKILL_LEVELS) {
      for (let i = 0; i < runCount; i += 1) {
        // Deterministic per (lane, skill, index) child seed: stable across
        // repeats of the same --seed, distinct across lanes so they do not all
        // replay the identical spawn coin flips.
        const seed = `${options.seed}:${lane}:${skill}:${i}:${seeder.int(0, 0x7fffffff)}`;
        runs.push(simulateRoute({ seed, lane, skill }));
      }
    }
  }

  const probes: Probes = {
    reach: probeReachability(),
    clean: probeChannel('a', null, 0, 30),
    // Unbroken contact — one hit per i-frame window is the worst case a player
    // standing in a contested ring can face. Gate C adds the Warden itself.
    contestedB: probeChannel('b', TUNING.player.invulnMs, 0, 90),
    contestedC: probeChannel('c', TUNING.player.invulnMs, 1, 90),
    idle: probeIdleCollapse(),
  };
  const ceiling = runs.filter((run) => run.skill === CEILING_SKILL);
  const floor = runs.filter((run) => run.skill === FLOOR_SKILL);
  const gates = evaluateGates(runs, ceiling, floor, probes, lanes);

  return finishFamily(options, gates, () => renderReport(runs, ceiling, probes, lanes), {
    family: 'arena',
    lanes: lanes.map((lane) => laneStats(lane, ceiling)),
    probes,
    runs,
  });
}

export default runArenaSim;
