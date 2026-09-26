import { PLAYER_BASE_STATS, TUNING, VIEW } from '../../config';
import { RunDirector, type EventSpec, type WaveSpec } from '../../core/run';
import { Rng } from '../../core/rng';
import { StatBlock } from '../../core/stats';
import { CHARMS, charmRankMods, gloamStepCooldownMs } from '../../data/charms';
import { classDef } from '../../data/classes';
import {
  contactReachOf,
  eliteStats,
  enemyDef,
  midBossDef,
  scaleEnemy,
  zoneBossDef,
  type EnemyDef,
} from '../../data/enemies';
import { rollGear } from '../../data/gear';
import { hazardDef, type HazardDef } from '../../data/hazards';
import { rollBreakableDrop } from '../../data/pickups';
import type {
  CharmId,
  ClassId,
  Depth,
  EliteAffixId,
  GateCandidate,
  GateId,
  GeneratedMap,
  LootItem,
  PoiAnchor,
  RunLoadoutV2,
  WeaponId,
  WeaponsView,
} from '../../data/types-v2';
import { FILLER, rollUpgradeChoices, xpNeeded, type UpgradeDef } from '../../data/upgrades';
import { rollValuable } from '../../data/valuables';
import { PHASES, TIMELINE_EVENTS, densityTarget, rollElite, wavesFor } from '../../data/waves';
import { evolutionReady, weaponStats, WEAPONS, WEAPON_MAX_RANK } from '../../data/weapons';
import { ZONES, type ZoneDef } from '../../data/zones';
import { Bag, itemValue } from '../../systems/bag';
import {
  ExtractionSystem,
  channelCompletableUnderContact,
  greedMul,
  worstCaseChannelMs,
  type ChannelContest,
} from '../../systems/extraction';
import { depthAt, generateMap } from '../../systems/mapgen';
import { poiXpBurst } from '../../systems/poi';
import {
  CEILING_SKILL,
  FLOOR_SKILL,
  LANES,
  SKILL_LEVELS,
  gateDecision,
  pickUpgrade,
  routeProfile,
  type GateContext,
  type LanePolicy,
  type RouteProfile,
} from '../bots';
import { createDirectorHost } from '../director-host';
import { finishFamily, hard, median, num, pct, printTable, type FamilySimOptions, type GateResult } from './types';

/**
 * Duskhaul V2 arena route sim — the instrument PRD-V2 §19's Balance row is
 * measured with: 4 §8 lanes × N runs × 4 zones at H1, each at a CEILING and a
 * FLOOR skill.
 *
 * WHAT IS REAL (ticked directly; all Phaser-free):
 *   - `systems/mapgen.ts generateMap` — every run plays its own 6144² map:
 *     spawn, nav raster (travel is PATHED over `nav.blocked`, so the map's own
 *     path factor is paid), region depth (`depthAt` → `mapgen.depthMul` on
 *     every spawn), gate candidates A/B/C + the conditional, POI anchors and
 *     breakables;
 *   - `systems/extraction.ts` — gate windows, the channel law, conditional
 *     conditions via `payCondition`, the Collapse, and `greedMul`;
 *   - `systems/bag.ts` — cell bag, toll/offering payments, settlement with
 *     greed and the death tithe (`meta.deathKeepPct`);
 *   - `core/run.ts RunDirector` over `wavesFor(zone)` / `PHASES` /
 *     `TIMELINE_EVENTS`; `data/enemies.ts` scaling + elite/boss/mid-boss
 *     stats + contact reach; `data/upgrades.ts rollUpgradeChoices` and
 *     `xpNeeded`; `data/weapons.ts weaponStats` / `evolutionReady`;
 *     `data/charms.ts charmRankMods`; `data/classes.ts`; `data/hazards.ts`;
 *     `data/gear.ts rollGear`; `data/valuables.ts rollValuable`;
 *     `data/pickups.ts rollBreakableDrop`.
 * MODELLED (approximate, because `systems/combat.ts`/`poi.ts` are Phaser-bound):
 *   - weapon throughput per pattern from `weaponStats` (targets × dps × reach);
 *   - contact/ranged damage (surround-scaled dodge, one hit per i-frame);
 *   - elite affixes as stat/behaviour riders; boss/mid-boss attacks as a
 *     telegraphed pattern hit on a cadence;
 *   - POI interactions per §5.12 (channel, reward, guards) and §6.5 income;
 *   - XP orbs dropped at the kill site and collected within `pickupRadius`.
 * A failing gate names the file that owns the number: this file measures.
 *
 * Pure TypeScript, no Phaser import, no `Math.random`.
 */

// ---------------------------------------------------------------------------
// Sim-only bot/abstraction calibration (how a bot PLAYS; not balance).
// ---------------------------------------------------------------------------

const STEP_MS = 100;
/** Crowd cap on one weapon's hit list (an area weapon in a saturated field). */
const MAX_TARGETS_TRACKED = 48;
/** Damage output at skill 0 vs skill 1 — aim and positioning quality. */
const SKILL_DAMAGE_FLOOR = 0.7;
const SKILL_DAMAGE_GAIN = 0.4;
/**
 * Share of the modelled weapon throughput that lands as useful damage in the
 * LIVE game — misses on moving bodies, overkill, re-targeting spread across a
 * crowd, and a kiting player standing out of its own reach. FITTED to live
 * honest-bot runs (fix round 2, 2026-09-25, H1 castle, veteran/novice kiting
 * policies on a vite-preview build): live near-hero density ran 40-60 at
 * 120-160 s with 1.2-1.8 kills/s Early and 2.5-4.3 Mid, and those runs died at
 * 130-165 s. At 1.0 the sim held density at 13-20, killed 3.7/5.4 per s and
 * almost never died; at 0.25 it holds 30-50 near the hero with 2.8-3.3 / 4-5
 * kills/s — the closest match. Recalibrate against live runs whenever weapon
 * patterns or enemy steering change; the live numbers win.
 */
const LIVE_DPS_EFFICIENCY = 0.25;
/** Crowd-centroid sampling radius; also the §6.3 "live ≤ 900 px" census radius. */
const CROWD_RADIUS_PX = 900;
/** Simultaneous attackers at which a dodge attempt is worthless (V1 persona fit). */
const SURROUND_FOR_CERTAINTY = 8;
/** Encirclement break-out (V1 persona fit). */
const BREAKOUT_RADIUS_MUL = 1.6;
const BREAKOUT_TRIGGER_BASE = 8;
const BREAKOUT_TRIGGER_SKILL_GAIN = 5;
/**
 * Breakables break only under a weapon's AREA (`WeaponHost.hitBreakables` is
 * called by the area patterns, not by targeted shots), so the sim breaks one
 * only inside the widest owned area weapon's reach — a bolt-only build breaks
 * none, exactly as in the scene.
 */
const BREAKABLE_PATTERNS: ReadonlySet<WeaponId> = new Set<WeaponId>(['orbit', 'nova', 'scythe', 'lash', 'breath', 'censer', 'spears', 'sickle']);
/** Arrival tolerance for a POI interaction. */
const POI_ARRIVE_PX = 90;
/** Boss/mid-boss telegraphed pattern cadence and share of it a perfect player dodges. */
const BOSS_PATTERN_MS = 3500;
const MIDBOSS_PATTERN_MS = 4000;
const PATTERN_DODGE_AT_SKILL1 = 0.8;
/** A run still going this far past the Collapse has stopped resolving — the gate fails on it. */
const SAFETY_OVERTIME_S = 900;
/** Census seconds of the §19 density gate. */
const CENSUS_S: readonly number[] = [240, 420];

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
  standoff: number;
  /** Body contact reach (bodyRadius + hero bodyRadius). */
  reach: number;
  /** Where this body's attack lands from, and whether it is a telegraphed (reaction-dodged) attack. */
  attackReach: number;
  telegraphed: boolean;
  hitEveryMs: number;
  nextHitAtMs: number;
  elite: EliteAffixId[] | null;
  boss: 'zone' | 'mid' | null;
  /** Damage-taken multiplier (shield behaviour, shielded/warded affixes). */
  takenMul: number;
  generation: number;
  revived: boolean;
  /** Last ms this body was within leash range; recycled after `enemy.leashMs` beyond it. */
  inLeashAtMs: number;
  /** POI population id, or null for ambient. */
  owner: string | null;
  nextPatternAtMs: number;
}

interface SimWeapon {
  id: WeaponId;
  boosts: number;
  evolved: boolean;
  eligibleAtMs: number | null;
}

interface SimCharm {
  id: CharmId;
  rank: number;
}

interface XpOrb {
  x: number;
  y: number;
  value: number;
}

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
  xp: number;
  shards: number;
  damageTaken: number;
  liveSum: number;
  liveMax: number;
  level: number;
}

export interface RouteRun {
  seed: string;
  lane: LanePolicy;
  skill: number;
  zone: string;
  endS: number;
  endReason: 'extracted' | 'died' | 'unresolved';
  gateUsed: GateId | null;
  gateKind: string | null;
  gateIntents: string[];
  shardsBanked: number;
  itemsBankedValue: number;
  /** Table value (`valuableDef`, before `economy.sellMul`) of banked VALUABLES only — gear is salvage-only. */
  valuablesBankedValue: number;
  /** Banked ◆ + sell value of every banked item (the §19 greed-premium haul). */
  haul: number;
  greedMul: number;
  kills: number;
  eliteKills: number;
  bossKilled: boolean;
  midBossKilled: boolean;
  level: number;
  drafts: number;
  firstLevelS: number | null;
  firstEvolutionS: number | null;
  evolutions: number;
  hpMinRatio: number;
  live: Record<number, number | null>;
  liveMax: number;
  bands: BandSample[];
  poisVisited: number;
  chestsOpened: number;
  breakablesBroken: number;
  /** Heals received: Grave Bread from urns, elites and chests (HP). */
  healHp: number;
  engaged: string[];
  spawned: string[];
  reachedCollapse: boolean;
  unknownStatMods: string[];
  pathFactor: number;
  /** Damage taken, keyed `<band>|<source>|<archetype>` (source: contact, ranged, burst, pattern, pool, fire). */
  damageBy: Record<string, number>;
  /** Carried shards by income source, before settlement (greed / tithe). */
  shardsBy: Record<string, number>;
  /** End-of-run build, e.g. `orbit4*,nova2 | c_bell3` (`*` = evolved). */
  build: string;
}

export interface RouteSimOptions {
  seed: string;
  lane: LanePolicy;
  skill: number;
  zone: ZoneDef;
  weaponSlots: number;
}

/** A synthetic H1 `RunLoadoutV2` for a fresh-meta player of `classId` (no Sanctum, no gear). */
function simLoadout(zone: ZoneDef, classId: ClassId, hazard: HazardDef, seed: string): RunLoadoutV2 {
  const cls = classDef(classId);
  return {
    zone: zone.id,
    hazard: hazard.level,
    mode: 'normal',
    seed,
    mutators: [],
    classId,
    startWeapon: cls.startWeapon,
    modifiers: cls.mods.map((mod) => ({ ...mod, source: `class:${classId}` })),
    // The full pools: the lanes model a player whose account has unlocked the arsenal.
    unlockedWeapons: WEAPONS.map((w) => w.id),
    unlockedCharms: CHARMS.map((c) => c.id),
    bagCells: TUNING.bag.cols * TUNING.bag.rows,
    casketSlots: TUNING.bag.casketSlots,
    deathKeepPct: TUNING.meta.deathKeepPct,
    greedMaxMul: TUNING.greed.maxMul,
    tollPct: TUNING.gates.toll.pct,
    rerollsPerRun: TUNING.draft.rerollsPerRun,
    banishesPerRun: TUNING.draft.banishPerRun,
    startLevel: 1,
    startDreadKeys: 0,
    reviveCharges: 0,
    reviveHpRatio: TUNING.effects.lastGasp.reviveHpRatio,
    reviveImmunityMs: TUNING.effects.lastGasp.iframesMs,
    iframesMsBonus: 0,
    gateWindowBonusS: 0,
    channelMsDelta: 0,
    contestedRate: TUNING.extract.contestedRate,
    previewS: TUNING.gate.previewS,
    minimapRevealPx: TUNING.minimap.revealPx,
    speedNearGateMul: 1,
    gloamwalkMs: 0,
    gravePact: false,
    fenceChance: TUNING.poi.fence.chance,
    fenceTrades: 1,
    veinMul: 1,
    veinStandMs: TUNING.poi.vein.standMs,
    breakableDropMul: 1,
    eliteExtraValuables: 0,
    belt: [],
    uniques: [],
    threatMul: hazard.threatMul,
    lootBias: hazard.lootBias,
    itemLevel: hazard.itemLevel,
    hazardExtras: {
      eliteExtraAffix: hazard.extraEliteAffix,
      forcedAffix: hazard.forcedAffixes[0] ?? null,
      collapseAtS: hazard.collapseAtS,
      bossPhaseAt: hazard.bossPhaseAt,
    },
    mercy: false,
  };
}

// ---------------------------------------------------------------------------
// Navigation over the generated map's nav raster
// ---------------------------------------------------------------------------

/**
 * Dijkstra path-distance field (px) over `map.nav.blocked`, 8-connected, from
 * one goal cell. 96×96 cells — cheap enough to build per target and cache.
 */
class NavFields {
  private readonly cache = new Map<number, Float32Array>();
  readonly cols: number;
  readonly rows: number;
  readonly cell: number;

  private readonly map: GeneratedMap;

  constructor(map: GeneratedMap) {
    this.map = map;
    this.cols = map.nav.cols;
    this.rows = map.nav.rows;
    this.cell = map.nav.cell;
  }

  cellOf(x: number, y: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cell)));
    return r * this.cols + c;
  }

  blocked(x: number, y: number): boolean {
    return this.map.nav.blocked[this.cellOf(x, y)] === 1;
  }

  field(x: number, y: number): Float32Array {
    const goal = this.nearestOpen(this.cellOf(x, y));
    const hit = this.cache.get(goal);
    if (hit !== undefined) return hit;
    const n = this.cols * this.rows;
    const dist = new Float32Array(n).fill(Number.POSITIVE_INFINITY);
    const heap: number[] = [];
    const push = (index: number, d: number): void => {
      dist[index] = d;
      heap.push(index);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (dist[heap[parent]!]! <= dist[heap[i]!]!) break;
        [heap[parent], heap[i]] = [heap[i]!, heap[parent]!];
        i = parent;
      }
    };
    const pop = (): number => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && dist[heap[l]!]! < dist[heap[m]!]!) m = l;
          if (r < heap.length && dist[heap[r]!]! < dist[heap[m]!]!) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i]!, heap[m]!];
          i = m;
        }
      }
      return top;
    };
    const done = new Uint8Array(n);
    push(goal, 0);
    while (heap.length > 0) {
      const at = pop();
      if (done[at] === 1) continue;
      done[at] = 1;
      const c = at % this.cols;
      const r = (at - c) / this.cols;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
          const next = nr * this.cols + nc;
          if (this.map.nav.blocked[next] === 1 || done[next] === 1) continue;
          // No corner cutting between two blocked orthogonals.
          if (dr !== 0 && dc !== 0) {
            if (this.map.nav.blocked[r * this.cols + nc] === 1 || this.map.nav.blocked[nr * this.cols + c] === 1) continue;
          }
          const d = dist[at]! + (dr !== 0 && dc !== 0 ? Math.SQRT2 : 1) * this.cell;
          if (d < dist[next]!) push(next, d);
        }
      }
    }
    this.cache.set(goal, dist);
    return dist;
  }

  /** Path distance (px) from (x,y) to the field's goal. */
  distance(field: Float32Array, x: number, y: number): number {
    return field[this.nearestOpen(this.cellOf(x, y))]!;
  }

  /** Next waypoint toward the field's goal from (x,y). */
  step(field: Float32Array, x: number, y: number): { x: number; y: number } {
    const at = this.nearestOpen(this.cellOf(x, y));
    const c = at % this.cols;
    const r = (at - c) / this.cols;
    let best = at;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
        const next = nr * this.cols + nc;
        if (field[next]! < field[best]!) best = next;
      }
    }
    const bc = best % this.cols;
    const br = (best - bc) / this.cols;
    return { x: (bc + 0.5) * this.cell, y: (br + 0.5) * this.cell };
  }

  private nearestOpen(index: number): number {
    if (this.map.nav.blocked[index] !== 1) return index;
    const c = index % this.cols;
    const r = (index - c) / this.cols;
    for (let radius = 1; radius < 6; radius += 1) {
      for (let dr = -radius; dr <= radius; dr += 1) {
        for (let dc = -radius; dc <= radius; dc += 1) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
          const next = nr * this.cols + nc;
          if (this.map.nav.blocked[next] !== 1) return next;
        }
      }
    }
    return index;
  }
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

interface WeaponThroughput {
  dpsPerTarget: number;
  maxTargets: number;
  reachPx: number;
}

/**
 * One weapon's throughput from `weaponStats` (THE rank/evolution rule shared
 * with `systems/weapons.ts`), scaled by the run's stats: dps per touched body,
 * how many bodies its pattern touches, and its reach.
 */
function weaponThroughput(weapon: SimWeapon, stats: StatBlock, dotMsMul: number): WeaponThroughput {
  const s = weaponStats(weapon.id, weapon.boosts, weapon.evolved);
  const area = stats.get('area');
  const duration = stats.get('durationMul');
  const crit = Math.min(1, stats.get('critChance') + s.critAdd);
  const hitMul = stats.get('damageMul') * (1 + crit * (stats.get('critMul') - 1));
  const cooldownS = Math.max(0.05, (s.cooldownMs / 1000) * stats.get('cooldownMul'));
  const projectiles = Math.max(1, s.count + stats.get('projectileBonus'));
  const range = TUNING.player.range * area;
  const dot = s.dotDps * Math.min(1, ((s.dotMs * duration * dotMsMul) / 1000) / cooldownS);
  const cap = (n: number): number => Math.max(1, Math.min(MAX_TARGETS_TRACKED, Math.round(n)));
  switch (weapon.id) {
    case 'bolt':
      return { dpsPerTarget: (s.damage * hitMul) / cooldownS, maxTargets: cap(projectiles * (1 + s.pierce)), reachPx: range };
    case 'orbit': {
      const radius = s.radius * area;
      // Blades sweep a ring; each blade lands on ~3 bodies per revolution window.
      return { dpsPerTarget: (s.damage * hitMul) / (s.cooldownMs / 1000), maxTargets: cap(s.count * 3), reachPx: radius };
    }
    case 'nova': {
      const falloffAvg = s.falloff + (1 - s.falloff) * 0.5;
      const field = s.fieldRadius > 0 ? dot : 0;
      return {
        dpsPerTarget: (s.damage * hitMul * falloffAvg) / cooldownS + field,
        maxTargets: MAX_TARGETS_TRACKED,
        reachPx: s.radius * area,
      };
    }
    case 'scythe':
      return {
        dpsPerTarget: (s.damage * hitMul) / cooldownS,
        maxTargets: cap((MAX_TARGETS_TRACKED * s.arcDeg) / 360),
        reachPx: s.radius * area,
      };
    case 'rail':
      return { dpsPerTarget: (s.damage * hitMul) / cooldownS, maxTargets: cap(s.pierce + 1), reachPx: s.length * area };
    case 'hex':
      return { dpsPerTarget: (s.damage * hitMul) / cooldownS + dot, maxTargets: cap(s.count), reachPx: range };
    case 'skull': {
      const splash = s.splashRadius > 0 ? 1 + s.splashMul * 2 : 1;
      return { dpsPerTarget: (s.damage * hitMul * splash) / cooldownS, maxTargets: cap(projectiles), reachPx: range };
    }
    case 'censer': {
      const uptime = Math.min(1, ((s.durationMs * duration) / 1000) / cooldownS);
      const bodiesPerPool = Math.max(1, ((s.radius * area) / 55) ** 2 / 2);
      return {
        dpsPerTarget: s.damage * hitMul * uptime * s.count,
        maxTargets: cap(bodiesPerPool * s.count),
        reachPx: (s.range || TUNING.player.range) * area,
      };
    }
    case 'sickle':
      // Out and back: every body on the path is hit twice per throw.
      return { dpsPerTarget: (2 * s.damage * hitMul) / cooldownS, maxTargets: cap(8 * projectiles), reachPx: s.radius * area };
    case 'lash':
      return { dpsPerTarget: (s.damage * hitMul) / cooldownS + dot, maxTargets: cap(5 * Math.max(1, s.count)), reachPx: (s.length / 2) * area };
    case 'breath': {
      const uptime = Math.min(1, ((s.durationMs * duration) / 1000) / cooldownS);
      return {
        dpsPerTarget: ((s.damage * hitMul) / (s.tickMs / 1000)) * uptime + dot,
        maxTargets: cap((MAX_TARGETS_TRACKED * s.arcDeg) / 360),
        reachPx: s.length * area,
      };
    }
    case 'spears':
      return { dpsPerTarget: (s.damage * hitMul) / cooldownS, maxTargets: cap(s.count * 2), reachPx: (s.range || TUNING.player.range) * area };
    case 'aura':
      // Always-on ring: every body inside the radius takes each tick.
      return { dpsPerTarget: (s.damage * hitMul) / cooldownS, maxTargets: cap(((s.radius * area) / 55) ** 2 / 2), reachPx: s.radius * area };
    case 'chakram':
      // Each disc hits its target, then `bounces` more within `range`.
      return { dpsPerTarget: (s.damage * hitMul) / cooldownS, maxTargets: cap(projectiles * (1 + s.bounces)), reachPx: range };
    case 'wake': {
      // A trail behind a moving hero: pursuers step through it, about half the time.
      const trailBodies = Math.max(1, ((s.radius * area) / 55) * ((s.durationMs * duration) / 1000) * 2);
      return { dpsPerTarget: ((s.damage * hitMul) / cooldownS) * 0.5, maxTargets: cap(trailBodies), reachPx: 200 };
    }
    case 'snares': {
      // A mine per cooldown; each blast catches the bodies inside its radius.
      const perBlast = Math.max(1, ((s.radius * area) / 55) ** 2 / 2);
      return { dpsPerTarget: (s.damage * hitMul) / cooldownS, maxTargets: cap(perBlast), reachPx: range };
    }
    case 'siphon':
      return { dpsPerTarget: (s.damage * hitMul) / cooldownS, maxTargets: cap(s.count), reachPx: (s.range || TUNING.player.range) * area };
    case 'bombs': {
      // Each urn hops `bounces` times, blasting at every landing.
      const perBlast = Math.max(1, ((s.radius * area) / 55) ** 2 / 2);
      return {
        dpsPerTarget: (s.damage * hitMul) / cooldownS,
        maxTargets: cap(s.count * (1 + s.bounces) * Math.min(perBlast, 3)),
        reachPx: (s.range || TUNING.player.range) * area,
      };
    }
    case 'totem': {
      // Planted pulses for `durationMs` out of every cooldown.
      const uptime = Math.min(1, ((s.durationMs * duration) / 1000) / cooldownS) * s.count;
      return {
        dpsPerTarget: ((s.damage * hitMul) / (s.tickMs / 1000)) * Math.min(1, uptime),
        maxTargets: cap(((s.radius * area) / 55) ** 2 / 2),
        reachPx: s.radius * area,
      };
    }
    case 'thralls': {
      // Each thrall bites one body per tick for the part of the cooldown it lives.
      const uptime = Number.isFinite(s.durationMs) ? Math.min(1, (s.durationMs * duration) / 1000 / cooldownS) : 1;
      return { dpsPerTarget: ((s.damage * hitMul) / (s.tickMs / 1000)) * uptime, maxTargets: cap(s.count), reachPx: range };
    }
  }
}

/**
 * Zone hazard ambient pressure from the hazard's own §5.29 params (V1 model,
 * kept): a pulsing hazard lands its damage on its interval and a skilled
 * player steps out of most pulses; a windowed hazard (desert scorch) drains
 * flat while its window holds. `gale` slows, it does not damage.
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

// ---------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------

function simulateRoute(options: RouteSimOptions): RouteRun {
  const { seed, lane, skill, zone, weaponSlots } = options;
  const profile: RouteProfile = routeProfile(lane);
  const rng = new Rng(seed);
  const hazard = hazardDef(1);
  const loadout = simLoadout(zone, profile.classId, hazard, seed);
  const map = generateMap(zone, seed);
  const nav = new NavFields(map);
  const collapseAtS = loadout.hazardExtras.collapseAtS;

  const bag = new Bag({ cells: loadout.bagCells, casketSlots: loadout.casketSlots }, TUNING.bag);
  const stats = new StatBlock(PLAYER_BASE_STATS);
  const knownStats = new Set(Object.keys(PLAYER_BASE_STATS));
  const unknownStatMods: string[] = [];
  for (const mod of loadout.modifiers) stats.addModifier(mod);

  let endReason: RouteRun['endReason'] = 'unresolved';
  let gateUsed: GateCandidate | null = null;
  const extraction = new ExtractionSystem(
    map.gates,
    {
      channelMs: TUNING.extract.channelMs,
      radius: TUNING.gate.radius,
      collapseAtS,
      closingWarnS: TUNING.gate.closingWarnS,
      channel: TUNING.extract,
      collapse: TUNING.collapse,
    },
    loadout,
    {
      payCondition(gate) {
        if (gate.kind === 'toll') return bag.payToll(loadout.tollPct, TUNING.gates.toll.min) > 0;
        if (gate.kind === 'offering') return bag.takeHighestValue() !== null;
        return true;
      },
      onEvent(event, gate) {
        if (event !== 'extracted') return;
        endReason = 'extracted';
        gateUsed = gate;
      },
    },
  );

  const enemies: SimEnemy[] = [];
  const orbs: XpOrb[] = [];
  const weapons: SimWeapon[] = [{ id: loadout.startWeapon, boosts: 0, evolved: false, eligibleAtMs: null }];
  const charms: SimCharm[] = [];
  const taken: string[] = [];
  const gateIntents: string[] = [];
  const engaged = new Set<string>();
  const spawnedIds = new Set<string>();
  const poiDone = new Set<string>();
  const brokeBreakable = new Uint8Array(map.breakables.length);
  const live: Record<number, number | null> = {};
  for (const at of CENSUS_S) live[at] = null;
  const bands: BandSample[] = BANDS.map(() => ({
    seconds: 0,
    ticks: 0,
    kills: 0,
    xp: 0,
    shards: 0,
    damageTaken: 0,
    liveSum: 0,
    liveMax: 0,
    level: 0,
  }));

  let px = map.spawn.x;
  let py = map.spawn.y;
  let hp = stats.get('maxHp');
  let reviveCharges = loadout.reviveCharges;
  let lastHitAtMs = -Infinity;
  let iframesUntilMs = -Infinity;
  let simTimeMs = 0;
  let level = 1;
  let xp = 0;
  let xpTotal = 0;
  let kills = 0;
  let eliteKills = 0;
  let bossAlive = false;
  let bossKilled = false;
  let midBossSpawned = false;
  let midBossKilled = false;
  let drafts = 0;
  let firstLevelS: number | null = null;
  let firstEvolutionS: number | null = null;
  let evolutions = 0;
  let hpMinRatio = 1;
  let hpDrainRatioPerS = 0;
  let hpLast = hp;
  let eliteSwapAtMs = TUNING.wave.compositionFromS * 1000;
  let collapseElitesSpawned = 0;
  let liveMax = 0;
  let reachedCollapse = false;
  let poisVisited = 0;
  let chestsOpened = 0;
  let breakablesBroken = 0;
  let healHp = 0;
  let dreadKeys = loadout.startDreadKeys;
  let itemTierBonusRolls = 0;
  let giltUntilMs = -Infinity;
  let gloamReadyAtMs = 0;
  let spawnSilenceUntilMs = -Infinity;
  let poiTarget: PoiAnchor | null = null;
  let gateGuardSpawned = false;
  /** The Gate B pack is dormant (no move, no attack) until this, or until the hero is within `poi.lair.wakePx`. */
  let guardWakeAtMs = Number.POSITIVE_INFINITY;
  let poiProgressMs = 0;
  let denLockUntilMs = -Infinity;
  /** Active event at a yard: kind, anchor, deadline, and progress counter. */
  let activeEvent = null as {
    kind: 'ev_caravan' | 'ev_vigil' | 'ev_rising';
    yard: PoiAnchor;
    untilMs: number;
    progress: number;
    started: boolean;
    startedAtMs: number;
    wavesSpawned: number;
  } | null;
  const eventOrder = rng.shuffle<'ev_caravan' | 'ev_vigil' | 'ev_rising'>(['ev_caravan', 'ev_vigil', 'ev_rising']);
  let eventIndex = 0;

  const gateById = new Map<GateId, GateCandidate>();
  for (const gate of map.gates) gateById.set(gate.id, gate);
  const gateC = gateById.get('c')!;
  const spawnToGatePath = nav.distance(nav.field(gateC.x, gateC.y), map.spawn.x, map.spawn.y);
  const pathFactor = spawnToGatePath / Math.max(1, Math.hypot(gateC.x - map.spawn.x, gateC.y - map.spawn.y));

  function threatAt(x: number, y: number): number {
    const depth: Depth = depthAt(map, x, y);
    return (
      director.difficulty * zone.threatBase * loadout.threatMul * (TUNING.mapgen.depthMul[depth] ?? 1) +
      extraction.collapseThreatBonus
    );
  }

  function weaponsView(): WeaponsView {
    const weaponViews = weapons.map((w) => ({ id: w.id, rank: w.boosts + 1, evolved: w.evolved }));
    const charmViews = charms.map((c) => ({ id: c.id, rank: c.rank }));
    const step = charms.find((c) => c.id === 'c_step');
    return {
      weapons: weaponViews,
      charms: charmViews,
      maxWeapons: weaponSlots,
      maxCharms: TUNING.charms.maxSlots,
      maxRank: WEAPON_MAX_RANK,
      maxCharmRank: TUNING.charms.maxRank,
      // §5.8 delivery: a chest grants the evolution; only after
      // `evolution.fallbackS` without one does the card enter the draft.
      evolutionEligible: weapons
        .filter((w) => w.eligibleAtMs !== null && simTimeMs - w.eligibleAtMs >= TUNING.evolution.fallbackS * 1000)
        .map((w) => w.id),
      gloamStepCdMs: step === undefined ? null : Math.max(0, gloamReadyAtMs - simTimeMs),
    };
  }

  function refreshEligibility(): void {
    const ready = evolutionReady(
      weapons.map((w) => ({ id: w.id, rank: w.boosts + 1, evolved: w.evolved })),
      charms.map((c) => ({ id: c.id, rank: c.rank })),
    );
    for (const w of weapons) {
      if (ready.includes(w.id)) w.eligibleAtMs ??= simTimeMs;
      else w.eligibleAtMs = null;
    }
  }

  function evolve(id: WeaponId): void {
    const slot = weapons.find((w) => w.id === id);
    if (slot === undefined || slot.evolved) return;
    slot.evolved = true;
    slot.eligibleAtMs = null;
    evolutions += 1;
    firstEvolutionS ??= simTimeMs / 1000;
  }

  function addMod(mod: { stat: string; add?: number; mul?: number }, source: string): void {
    if (!knownStats.has(mod.stat)) {
      unknownStatMods.push(`${source}:${mod.stat}`);
      return;
    }
    const before = stats.get('maxHp');
    stats.addModifier({ ...mod, source });
    const after = stats.get('maxHp');
    if (after !== before && before > 0) hp = (hp / before) * after;
  }

  function applyCard(card: UpgradeDef): void {
    taken.push(card.id);
    for (const mod of card.modifiers) addMod(mod, `upgrade:${card.id}`);
    const weapon = card.weapon === undefined ? undefined : weapons.find((w) => w.id === card.weapon);
    const charm = card.charm === undefined ? undefined : charms.find((c) => c.id === card.charm);
    switch (card.kind) {
      case 'weapon-unlock':
        if (card.weapon !== undefined && weapon === undefined) {
          weapons.push({ id: card.weapon, boosts: 0, evolved: false, eligibleAtMs: null });
        }
        break;
      case 'weapon-boost':
        if (weapon !== undefined) weapon.boosts = Math.min(TUNING.weapons.maxBoosts, weapon.boosts + 1);
        break;
      case 'weapon-evolution':
        if (card.weapon !== undefined) evolve(card.weapon);
        break;
      case 'charm-unlock':
        if (card.charm !== undefined && charm === undefined) {
          charms.push({ id: card.charm, rank: 1 });
          for (const mod of charmRankMods(card.charm, 1)) addMod(mod, `charm:${card.charm}:1`);
        }
        break;
      case 'charm-rank':
        if (charm !== undefined && charm.rank < TUNING.charms.maxRank) {
          charm.rank += 1;
          for (const mod of charmRankMods(charm.id, charm.rank)) addMod(mod, `charm:${charm.id}:${charm.rank}`);
        }
        break;
      case 'effect':
        if (card.effect === 'last-gasp') reviveCharges += 1;
        break;
      case 'filler':
        if (card.effect === 'fill-bread') hp += stats.get('maxHp') * FILLER.breadHealPct;
        if (card.effect === 'fill-purse') {
          bag.addShards(FILLER.purseShards);
          shardsBy.purse = (shardsBy.purse ?? 0) + FILLER.purseShards;
        }
        break;
      default:
        break;
    }
    hp = Math.min(stats.get('maxHp'), hp);
    refreshEligibility();
  }

  function draft(countsAsLevelDraft: boolean): void {
    const choices = rollUpgradeChoices(
      rng,
      {
        taken,
        weapons: weaponsView(),
        unlockedWeapons: loadout.unlockedWeapons,
        unlockedCharms: loadout.unlockedCharms,
        banished: [],
      },
      TUNING.draft.choices,
    );
    if (choices.length === 0) return;
    if (countsAsLevelDraft) drafts += 1;
    applyCard(pickUpgrade(lane, choices, rng, hp / stats.get('maxHp')));
  }

  function lootItem(tierBias: number, kind: 'gear' | 'valuable' = 'gear'): void {
    const bias = tierBias + (itemTierBonusRolls > 0 ? 1 : 0);
    if (itemTierBonusRolls > 0) itemTierBonusRolls -= 1;
    const item: LootItem =
      kind === 'gear'
        ? {
            kind: 'gear',
            item: rollGear(rng, {
              tierBias: bias,
              luck: stats.get('luck'),
              lootBias: zone.lootBias + loadout.lootBias,
              itemLevel: loadout.itemLevel,
              uniqueChance: tierBias >= 2 ? TUNING.gear.uniqueChance : 0,
              zone: zone.id,
            }),
          }
        : { kind: 'valuable', item: rollValuable(rng, bias, zone.id) };
    bag.add(item);
  }

  /** Elite/Boss Chest (§5.12): evolution if eligible, else a draft-quality pick; plus items. */
  function eliteChest(boss: boolean): void {
    const eligible = weapons.find((w) => w.eligibleAtMs !== null);
    if (eligible !== undefined) evolve(eligible.id);
    else if (!boss) draft(false);
    if (boss) for (let i = 0; i < TUNING.loot.bossItems; i += 1) lootItem(TUNING.loot.bossTierBias);
    else lootItem(TUNING.loot.eliteTierBias);
  }

  function spawnRing(pattern: WaveSpec['pattern'], at: number): { x: number; y: number } {
    const rx = VIEW.width / 2 + TUNING.enemy.spawnMargin;
    const ry = VIEW.height / 2 + TUNING.enemy.spawnMargin;
    const fixedAngle = ((at * 137.508) % 360) * (Math.PI / 180);
    let point = { x: px, y: py };
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const spread = pattern === 'cluster' ? 0.2 : 0.6;
      const angle =
        pattern === undefined || pattern === 'ring' || attempt > 1
          ? rng.float(0, Math.PI * 2)
          : fixedAngle + rng.float(-spread, spread);
      point = {
        x: Math.min(map.width - 1, Math.max(1, px + Math.cos(angle) * rx)),
        y: Math.min(map.height - 1, Math.max(1, py + Math.sin(angle) * ry)),
      };
      if (!nav.blocked(point.x, point.y) && !extraction.spawnSuppressed(point.x, point.y)) return point;
    }
    return point;
  }

  /**
   * Live bodies within 900 px of the hero, refreshed every tick and bumped by
   * each ambient spawn — the count `densityTarget` throttles against (mirrors
   * `CombatSystem.spawn` / its leash).
   */
  let near900 = 0;

  function ambientCount(): number {
    let n = 0;
    for (const enemy of enemies) if (enemy.owner === null) n += 1;
    return n;
  }

  function spawn(
    def: EnemyDef,
    x: number,
    y: number,
    opts: { elite?: EliteAffixId[] | null; boss?: 'zone' | 'mid' | null; owner?: string | null } = {},
  ): void {
    const owner = opts.owner ?? null;
    if (owner === null && ambientCount() >= TUNING.enemy.maxAlive) return;
    // Mid-bosses always carry their §5.6 fixed affix (rider only; stats stay the mid-boss row's).
    const elite = opts.elite ?? (def.fixedAffix !== undefined ? [def.fixedAffix] : null);
    const boss = opts.boss ?? null;
    const mul = threatAt(x, y);
    const scaled = elite !== null && boss === null ? eliteStats(def, mul) : scaleEnemy(def, mul, simTimeMs / 1000);
    const params = def.params ?? {};
    // One spawn call is one body, swarms included — `packSize` only shapes
    // swarm steering in `objects/enemy.ts` (the V1 sim spawned the whole pack
    // and over-supplied kills/XP 6-8× on every swarm row).
    const pack = 1;
    const standoff =
      def.behaviour === 'ranged' || def.behaviour === 'lob'
        ? params.rangePx ?? 0
        : def.behaviour === 'hook'
          ? params.lengthPx ?? 0
          : def.behaviour === 'orbit-charge'
            ? params.orbitRadiusPx ?? 0
            : def.behaviour === 'aura'
              ? params.auraRadiusPx ?? 0
              : def.behaviour === 'boss'
                ? params.standoffPx ?? 0
                : 0;
    let takenMul = def.behaviour === 'shield' ? 0.65 : 1;
    let speed = scaled.moveSpeed;
    // Attack cadence per §5.4 behaviour, from the row's own params: contact
    // bodies tick on `enemy.hitMs`; ranged/lob/hook/charge bodies attack on
    // their own cooldown from their own reach, with a telegraph the hero reacts
    // to. Bosses hit only by contact here — their attacks are the 'pattern' model.
    const contactReach = contactReachOf(def, elite !== null);
    let hitEveryMs: number = TUNING.enemy.hitMs;
    let attackReach = contactReach;
    let telegraphed = false;
    switch (def.behaviour) {
      case 'ranged':
        hitEveryMs = params.fireEveryMs ?? 1500;
        attackReach = params.rangePx ?? contactReach;
        telegraphed = true;
        break;
      case 'lob':
      case 'hook':
        hitEveryMs = params.cdMs ?? 3500;
        attackReach = def.behaviour === 'hook' ? params.lengthPx ?? contactReach : params.rangePx ?? contactReach;
        telegraphed = true;
        break;
      case 'orbit-charge':
        hitEveryMs = (params.diveEveryS ?? 2.5) * 1000;
        attackReach = (params.orbitRadiusPx ?? 0) + contactReach;
        telegraphed = true;
        break;
      default:
        break;
    }
    for (const affix of elite ?? []) {
      if (affix === 'shielded') takenMul *= 1 - (1 - TUNING.elite.affixes.shielded.frontalDamageMul) / 2;
      if (affix === 'warded') takenMul *= 1 - TUNING.elite.affixes.warded.immuneMs / TUNING.elite.affixes.warded.everyMs;
      if (affix === 'hasted') {
        speed *= TUNING.elite.affixes.hasted.moveMul;
        hitEveryMs *= TUNING.elite.affixes.hasted.attackCdMul;
      }
    }
    for (let i = 0; i < pack; i += 1) {
      if (owner === null && ambientCount() >= TUNING.enemy.maxAlive) break;
      enemies.push({
        def,
        hp: scaled.maxHp,
        maxHp: scaled.maxHp,
        damage: scaled.damage,
        speed,
        x: i === 0 ? x : x + rng.float(-90, 90),
        y: i === 0 ? y : y + rng.float(-90, 90),
        standoff,
        reach: contactReach,
        attackReach,
        telegraphed,
        hitEveryMs,
        nextHitAtMs: simTimeMs,
        elite,
        boss,
        takenMul,
        generation: 0,
        revived: false,
        inLeashAtMs: simTimeMs,
        owner,
        nextPatternAtMs: simTimeMs + (boss === 'zone' ? BOSS_PATTERN_MS : MIDBOSS_PATTERN_MS),
      });
    }
    spawnedIds.add(def.id);
    if (boss === 'zone') bossAlive = true;
  }

  function spawnEliteRoll(x: number, y: number, owner: string | null = null): void {
    const roll = rollElite(rng, simTimeMs / 1000, zone.id, loadout.hazardExtras.forcedAffix, loadout.hazardExtras.eliteExtraAffix);
    spawn(enemyDef(roll.defId), x, y, { elite: roll.affixes, owner });
  }

  function spawnAround(defId: string, count: number, cx: number, cy: number, radius: number, owner: string | null): void {
    const def = enemyDef(defId);
    // Critic B2 hard cap (mirrors `CombatSystem`): scripted/POI trash that
    // would land within 900 px stops at ceil(target × densityHardCapMul).
    const hardCap = Math.ceil(densityTarget(simTimeMs / 1000, false) * TUNING.wave.densityHardCapMul);
    const lands = Math.hypot(cx - px, cy - py) <= CROWD_RADIUS_PX;
    for (let i = 0; i < count; i += 1) {
      if (lands && owner?.startsWith('lair:') !== true && near900 >= hardCap) break;
      if (lands) near900 += 1;
      const angle = rng.float(0, Math.PI * 2);
      const r = rng.float(radius * 0.4, radius);
      spawn(def, cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, { owner });
    }
  }

  /** §5.7 composition swaps: from `wave.compositionFromS`, one trash spawn per `eliteSwapEveryS` is promoted. */
  function composeSpawn(id: string, x: number, y: number): void {
    const def = enemyDef(id);
    if (simTimeMs >= eliteSwapAtMs && def.behaviour !== 'swarm' && def.behaviour !== 'flee' && def.stats.damage > 0) {
      let elites = 0;
      for (const enemy of enemies) if (enemy.elite !== null) elites += 1;
      if (enemies.length === 0 || elites / enemies.length < TUNING.wave.eliteShareMax) {
        eliteSwapAtMs = simTimeMs + TUNING.wave.eliteSwapEveryS * 1000;
        spawnEliteRoll(x, y);
        return;
      }
    }
    spawn(def, x, y);
  }

  function nearestPoiOfKind(kinds: readonly string[], minDist: number): PoiAnchor | null {
    let best: PoiAnchor | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const poi of map.pois) {
      if (!kinds.includes(poi.kind) || poiDone.has(poi.id)) continue;
      const d = Math.hypot(poi.x - px, poi.y - py);
      if (d < minDist || d >= bestDist) continue;
      best = poi;
      bestDist = d;
    }
    return best;
  }

  function onScriptedEvent(event: EventSpec): void {
    const atS = event.at;
    switch (event.kind) {
      case 'breather':
        hp = Math.min(stats.get('maxHp'), hp + stats.get('maxHp') * TUNING.events.breatherHealRatio);
        spawnSilenceUntilMs = simTimeMs + TUNING.events.breatherSilenceMs;
        return;
      case 'elite': {
        const point = spawnRing('arc', atS);
        spawnEliteRoll(point.x, point.y);
        return;
      }
      case 'boss': {
        const angle = rng.float(0, Math.PI * 2);
        spawn(zoneBossDef(zone.id), gateC.x + Math.cos(angle) * 260, gateC.y + Math.sin(angle) * 260, { boss: 'zone' });
        return;
      }
      case 'poi-event': {
        const kind = eventOrder[eventIndex % eventOrder.length]!;
        eventIndex += 1;
        const yard = nearestPoiOfKind(['event_yard'], 1200);
        if (yard === null) return;
        const durationS =
          kind === 'ev_caravan'
            ? TUNING.poi.events.caravan.durationS
            : kind === 'ev_vigil'
              ? TUNING.poi.events.vigil.holdS + 20
              : TUNING.poi.events.rising.windowS + 20;
        activeEvent = { kind, yard, untilMs: simTimeMs + durationS * 1000, progress: 0, started: false, startedAtMs: 0, wavesSpawned: 0 };
        return;
      }
      default:
        // 'den-open' / 'fence-window' / 'chest' / 'elite-rush': the den is
        // gated on `midboss.opensS` in the POI walk below; the Fence's trades
        // are hub-economy (not modelled); V1 kinds are not authored in V2.
        return;
    }
  }

  const director = new RunDirector(createDirectorHost(), wavesFor(zone.id), PHASES, (id, _i, _t, pattern) => {
    if (extraction.collapse !== null && TUNING.collapse.stopTrashDrip) return;
    if (simTimeMs < spawnSilenceUntilMs) return;
    if (near900 >= densityTarget(simTimeMs / 1000, false)) return;
    if (ambientCount() >= Math.ceil(densityTarget(simTimeMs / 1000, false) * TUNING.wave.ambientTotalMul)) return;
    const before = enemies.length;
    const point = spawnRing(pattern, Math.round(simTimeMs / 1000));
    composeSpawn(id, point.x, point.y);
    // Gilt Shrine: +50% spawns for its window.
    if (simTimeMs < giltUntilMs && rng.chance(TUNING.poi.shrines.gilt.spawnMul - 1)) composeSpawn(id, point.x, point.y);
    near900 += enemies.length - before;
  }, { events: TIMELINE_EVENTS, onEvent: onScriptedEvent });

  function shardsIn(amount: number, source: string): void {
    const gilt = simTimeMs < giltUntilMs ? TUNING.poi.shrines.gilt.shardsMul : 1;
    const gained = Math.round(amount * stats.get('shardsMul') * gilt);
    bag.addShards(gained);
    shardsBy[source] = (shardsBy[source] ?? 0) + gained;
  }

  /** POI completion XP burst, sized by `systems/poi.ts poiXpBurst` and dropped as an orb at the POI (as `game.ts` does). */
  function xpBurst(poi: PoiAnchor): void {
    const amount = poiXpBurst(poi.kind, poi.depth, simTimeMs / 1000);
    if (amount > 0) orbs.push({ x: poi.x, y: poi.y, value: amount });
  }

  function killEnemy(index: number): void {
    const enemy = enemies[index]!;
    const def = enemy.def;
    const params = def.params ?? {};
    if (def.behaviour === 'revive' && !enemy.revived) {
      enemy.revived = true;
      enemy.hp = enemy.maxHp * 0.5;
      enemy.nextHitAtMs = simTimeMs + 2000;
      return;
    }
    kills += 1;
    const xpValue = (enemy.elite !== null || enemy.boss !== null ? def.stats.xp * 5 : def.stats.xp) * stats.get('xpMul');
    orbs.push({ x: enemy.x, y: enemy.y, value: xpValue });
    if (enemy.boss === 'zone') {
      bossKilled = true;
      bossAlive = false;
      shardsIn(TUNING.economy.currencyPerBoss, 'boss');
      eliteChest(true);
    } else if (enemy.boss === 'mid') {
      midBossKilled = true;
      shardsIn(150, 'midboss');
      lootItem(3);
      dreadKeys += 1;
    } else if (enemy.elite !== null) {
      eliteKills += 1;
      shardsIn(TUNING.elite.shards, 'elites');
      for (let i = 0; i < TUNING.loot.eliteValuables + loadout.eliteExtraValuables; i += 1) {
        lootItem(TUNING.loot.eliteTierBias, 'valuable');
      }
      eliteChest(false);
      // Grave Bread from elite kills (critic v2c M1).
      if (rng.chance(TUNING.pickups.bread.eliteChance)) {
        healHp += Math.min(TUNING.pickups.bread.heal, stats.get('maxHp') - hp);
        hp = Math.min(stats.get('maxHp'), hp + TUNING.pickups.bread.heal);
      }
      if (enemy.owner?.startsWith('lair:') === true) {
        const lair = map.pois.find((p) => `lair:${p.id}` === enemy.owner);
        if (lair !== undefined) xpBurst(lair);
        if (rng.chance(TUNING.poi.lair.keyChance)) dreadKeys += 1;
      }
      if (enemy.elite.includes('splitter')) {
        spawnAround(def.id, TUNING.elite.affixes.splitter.minions, enemy.x, enemy.y, 60, null);
      }
    } else {
      // `economy.killShardChanceByS`: a trash kill pays its ◆ only with the
      // chance of the last row whose second has passed (mirrors combat.ts).
      let killChance = 1;
      for (const [fromS, chance] of TUNING.economy.killShardChanceByS) if (simTimeMs / 1000 >= fromS) killChance = chance;
      if (rng.chance(killChance)) shardsIn(def.stats.shards, 'kills');
    }
    if (activeEvent?.kind === 'ev_rising' && activeEvent.started) {
      if (Math.hypot(enemy.x - activeEvent.yard.x, enemy.y - activeEvent.yard.y) <= TUNING.poi.events.rising.radius) {
        activeEvent.progress += 1;
      }
    }
    if (def.behaviour === 'burst' && Math.hypot(px - enemy.x, py - enemy.y) <= (params.burstRadiusPx ?? 0)) {
      if (!rng.chance(skill)) {
        const burst = (params.burstDamage ?? 0) * stats.get('contactDamageMul');
        hp -= burst;
        logDamage('burst', def.id, burst);
      }
    }
    enemies.splice(index, 1);
    if (def.behaviour === 'split' && enemy.generation < (params.splitGenerations ?? 0)) {
      const ratio = params.splitHpRatio ?? 0.5;
      for (let i = 0; i < (params.splitCount ?? 0); i += 1) {
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

  /** The POI the route wants next, by lane appetite, depth ceiling and detour budget. */
  function choosePoi(moveSpeed: number): PoiAnchor | null {
    let best: PoiAnchor | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const elapsedS = simTimeMs / 1000;
    for (const poi of map.pois) {
      if (poiDone.has(poi.id)) continue;
      const maxDepth = profile.poiAppetite[poi.kind];
      if (maxDepth === undefined || poi.depth > maxDepth) continue;
      if (poi.depth === 2 && (elapsedS < profile.deepPoiFromS || level < profile.deepPoiFromLevel)) continue;
      if (poi.kind === 'den' && elapsedS < TUNING.midboss.opensS) continue;
      if (poi.kind === 'event_yard') continue;
      if (poi.kind === 'vault' && dreadKeys === 0 && lane !== 'delver') continue;
      if (poi.kind === 'bell' && map.gates.find((g) => g.id === 'x')?.kind !== 'bell') continue;
      if (poi.kind === 'shrine_grave' && hp / stats.get('maxHp') > 0.5) continue;
      const straight = Math.hypot(poi.x - px, poi.y - py);
      const travelS = (straight * pathFactor) / moveSpeed;
      if (travelS > profile.poiDetourS) continue;
      if (travelS < bestScore) {
        best = poi;
        bestScore = travelS;
      }
    }
    return best;
  }

  /** Resolves standing at a POI; returns true when the interaction is complete. */
  function interactPoi(poi: PoiAnchor, contested: boolean, tookHit: boolean): boolean {
    const chest = poi.kind === 'chest_t1' ? TUNING.poi.chest.t1 : poi.kind === 'chest_t2' ? TUNING.poi.chest.t2 : poi.kind === 'chest_t3' ? TUNING.poi.chest.t3 : null;
    const depthBias = TUNING.mapgen.chestTierBiasByDepth[poi.depth] ?? 0;
    const channel = (needMs: number): boolean => {
      poiProgressMs += STEP_MS * (contested ? TUNING.extract.contestedRate : 1);
      if (tookHit) poiProgressMs = Math.max(0, poiProgressMs - TUNING.extract.hitSetbackMs);
      return poiProgressMs >= needMs;
    };
    if (chest !== null) {
      if (!channel(chest.channelMs)) return false;
      chestsOpened += 1;
      shardsIn(rng.int(chest.shards[0], chest.shards[1]), 'chests');
      const items = poi.kind === 'chest_t3' ? 2 : 1;
      for (let i = 0; i < items; i += 1) lootItem(Math.max(chest.tierBias, depthBias));
      if (poi.kind === 'chest_t3') spawnAround('husk', TUNING.poi.chest.t3.guards, poi.x, poi.y, 300, null);
      // Grave Bread from t2+ reliquaries (critic v2c M1, `PoiSystem.takePickups`).
      if (poi.kind !== 'chest_t1' && rng.chance(TUNING.pickups.bread.chestChance)) {
        healHp += Math.min(TUNING.pickups.bread.heal, stats.get('maxHp') - hp);
        hp = Math.min(stats.get('maxHp'), hp + TUNING.pickups.bread.heal);
      }
      return true;
    }
    switch (poi.kind) {
      case 'vein':
        if (!channel(loadout.veinStandMs)) return false;
        shardsIn(
          rng.int(TUNING.poi.vein.shards[0], TUNING.poi.vein.shards[1]) *
            loadout.veinMul *
            (profile.classId === 'duskhauler' ? 1.15 : 1),
          'veins',
        );
        return true;
      case 'vault':
        if (poiProgressMs === 0 && dreadKeys === 0) spawnAround('husk', 24, poi.x, poi.y, TUNING.poi.vault.radius, `vault:${poi.id}`);
        if (dreadKeys > 0) dreadKeys -= 1;
        else if (!channel(TUNING.poi.vault.channelMs)) return false;
        lootItem(3);
        lootItem(3);
        lootItem(3, 'valuable');
        return true;
      case 'lair':
        return true;
      case 'den':
        if (!midBossSpawned) {
          midBossSpawned = true;
          spawn(midBossDef(zone.id), poi.x, poi.y, { boss: 'mid', owner: `den:${poi.id}` });
          denLockUntilMs = simTimeMs + TUNING.midboss.lockS * 1000;
        }
        return midBossKilled || simTimeMs >= denLockUntilMs;
      case 'shrine_grave':
        if (!channel(1000)) return false;
        hp = stats.get('maxHp');
        return true;
      case 'shrine_blood':
        if (!channel(1000)) return false;
        addMod({ stat: 'maxHp', mul: -TUNING.poi.shrines.blood.maxHpPenalty }, `shrine:${poi.id}`);
        for (let i = 0; i < TUNING.poi.shrines.blood.drafts; i += 1) draft(false);
        return true;
      case 'shrine_gilt':
        if (!channel(1000)) return false;
        giltUntilMs = simTimeMs + TUNING.poi.shrines.gilt.durationS * 1000;
        return true;
      case 'shrine_curse':
        if (!channel(1000)) return false;
        for (let i = 0; i < TUNING.poi.shrines.curse.elites; i += 1) {
          const angle = rng.float(0, Math.PI * 2);
          spawnEliteRoll(px + Math.cos(angle) * TUNING.poi.shrines.curse.radius, py + Math.sin(angle) * TUNING.poi.shrines.curse.radius);
        }
        itemTierBonusRolls += TUNING.poi.shrines.curse.rolls;
        return true;
      case 'bell':
        if (!channel(TUNING.gates.bell.standMs)) return false;
        extraction.ringBell();
        spawnAround('husk', TUNING.gates.bell.wave, poi.x, poi.y, 500, null);
        return true;
      default:
        return channel(1000);
    }
  }

  const damageBy: Record<string, number> = {};
  /** Carried shards by income source (kills, breakables, veins, chests, elites, midboss, boss, purse). */
  const shardsBy: Record<string, number> = {};
  const bandNow = (): string => {
    const t = simTimeMs / 1000;
    let name = BANDS[0]!.name;
    for (const band of BANDS) if (t >= band.fromS) name = band.name;
    return name;
  };
  const logDamage = (source: string, archetype: string, amount: number): void => {
    if (amount <= 0) return;
    const key = `${bandNow()}|${source}|${archetype}`;
    damageBy[key] = (damageBy[key] ?? 0) + amount;
  };

  const nearest: { index: number; dist: number }[] = [];
  const intentGates: GateId[] = map.gates.map((gate) => gate.id);

  for (;;) {
    const elapsedS = simTimeMs / 1000;
    if (elapsedS > collapseAtS + SAFETY_OVERTIME_S) break;

    director.update(STEP_MS);
    const collapse = extraction.collapse;
    const inCollapse = collapse !== null && collapse.active;
    if (inCollapse) reachedCollapse = true;
    const ringCentre = extraction.collapseRingCenter;
    while (inCollapse && collapse !== null && collapseElitesSpawned < extraction.collapseEliteQuota) {
      collapseElitesSpawned += 1;
      const angle = rng.float(0, Math.PI * 2);
      spawnEliteRoll(
        Math.min(map.width - 1, Math.max(1, ringCentre.x + Math.cos(angle) * collapse.ringRadius)),
        Math.min(map.height - 1, Math.max(1, ringCentre.y + Math.sin(angle) * collapse.ringRadius)),
      );
    }

    // --- Gate B guard (critic C1, mirrors game.ts): at gate open, an elite +
    // adds parked PAST the apron on the gate→hero side, damage capped per hit.
    const gateB = gateById.get('b');
    if (!gateGuardSpawned && gateB !== undefined && elapsedS >= TUNING.elite.gateGuardAtS) {
      gateGuardSpawned = true;
      const g = TUNING.elite;
      // QA v2c NEW-1 (mirrors game.ts): of 16 bearings at the park
      // distance, the walkable one FARTHEST from the hero; no guard at all if
      // even that is within `gateGuardHeroClearPx` of the hero.
      const park = TUNING.mapgen.gateClear + rng.float(g.gateGuardParkPx[0], g.gateGuardParkPx[1]);
      let best: { x: number; y: number; d: number } | null = null;
      for (let k = 0; k < 16; k += 1) {
        const a = (k / 16) * Math.PI * 2;
        const x = gateB.x + Math.cos(a) * park;
        const y = gateB.y + Math.sin(a) * park;
        if (x < 0 || y < 0 || x > map.width || y > map.height || nav.blocked(x, y)) continue;
        const d = Math.hypot(x - px, y - py);
        if (best === null || d > best.d) best = { x, y, d };
      }
      if (best !== null && best.d >= g.gateGuardHeroClearPx) {
        const first = enemies.length;
        spawnEliteRoll(best.x, best.y, 'guard:b');
        spawnAround('husk', g.gateGuardAdds, best.x, best.y, g.gateGuardRadiusPx, 'guard:b');
        const cap = g.gateGuardDmgCap * hazard.threatMul;
        for (let i = first; i < enemies.length; i += 1) enemies[i]!.damage = Math.min(enemies[i]!.damage, cap);
        guardWakeAtMs = simTimeMs + g.gateGuardTelegraphMs;
      }
    }

    // --- lairs wake on approach ------------------------------------------
    for (const poi of map.pois) {
      if (poi.kind !== 'lair' || poiDone.has(poi.id)) continue;
      if (Math.hypot(poi.x - px, poi.y - py) > TUNING.poi.lair.wakePx) continue;
      poiDone.add(poi.id);
      poisVisited += 1;
      spawnEliteRoll(poi.x, poi.y, `lair:${poi.id}`);
      spawnAround('husk', rng.int(TUNING.poi.lair.guards[0], TUNING.poi.lair.guards[1]), poi.x, poi.y, 260, `lair:${poi.id}`);
    }

    // --- decide where to stand -------------------------------------------
    const maxHp = stats.get('maxHp');
    const moveSpeed = stats.get('moveSpeed');
    const greedStepAtS =
      elapsedS < TUNING.greed.startS
        ? TUNING.greed.startS + TUNING.greed.stepS
        : TUNING.greed.startS + TUNING.greed.stepS * (Math.floor((elapsedS - TUNING.greed.startS) / TUNING.greed.stepS) + 1);
    const context: GateContext = {
      elapsedS,
      hpRatio: hp / maxHp,
      bagFull: bag.view().full,
      collapseActive: inCollapse,
      bossAlive,
      bossKilled,
      gates: intentGates,
      kind: {},
      state: {},
      opensInS: {},
      closesInS: {},
      travelS: {},
      payable: {},
      channelS: extraction.channelMsEffective / 1000,
      secondsToCollapseS: collapseAtS - elapsedS,
      secondsToGreedStepS:
        greedMul(elapsedS, loadout.greedMaxMul) >= loadout.greedMaxMul ? Number.POSITIVE_INFINITY : greedStepAtS - elapsedS,
      hpDrainRatioPerS,
    };
    for (const gate of map.gates) {
      const state = extraction.gateState(gate.id);
      context.kind[gate.id] = gate.kind;
      context.state[gate.id] = state;
      context.opensInS[gate.id] =
        gate.kind === 'bell' && state === 'closed' ? Number.POSITIVE_INFINITY : gate.opensS - elapsedS;
      context.closesInS[gate.id] = gate.closesS === null ? null : gate.closesS - elapsedS;
      context.travelS[gate.id] = nav.distance(nav.field(gate.x, gate.y), px, py) / Math.max(1, moveSpeed);
      context.payable[gate.id] =
        gate.kind === 'offering' ? bag.view().items.length > 0 : gate.kind === 'toll' ? bag.shards >= TUNING.gates.toll.min : true;
    }
    const intent = gateDecision(profile, context);
    if (gateIntents[gateIntents.length - 1] !== intent.reason) gateIntents.push(intent.reason);

    let targetX = px;
    let targetY = py;
    let pathed = false;
    const headingTo = intent.gate ?? (intent.reason === 'boss-first' ? 'c' : null);
    const denLocked = simTimeMs < denLockUntilMs && !midBossKilled;
    if (headingTo !== null && !denLocked) {
      const gate = gateById.get(headingTo)!;
      poiTarget = null;
      if (Math.hypot(gate.x - px, gate.y - py) > TUNING.gate.radius * 0.5) {
        const next = nav.step(nav.field(gate.x, gate.y), px, py);
        targetX = next.x;
        targetY = next.y;
        pathed = true;
      } else {
        targetX = gate.x;
        targetY = gate.y;
      }
    } else if (intent.reason === 'hold-for-greed') {
      // Camp just OUTSIDE Gate C's ring: stepping in starts the channel.
      const standoff = TUNING.gate.radius + 90;
      const dx = px - gateC.x;
      const dy = py - gateC.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const tx = gateC.x + (dx / d) * standoff;
      const ty = gateC.y + (dy / d) * standoff;
      if (d > standoff + 200) {
        const next = nav.step(nav.field(gateC.x, gateC.y), px, py);
        targetX = next.x;
        targetY = next.y;
        pathed = true;
      } else {
        targetX = tx;
        targetY = ty;
      }
    }

    const ringGate =
      map.gates.find((gate) => {
        const state = extraction.gateState(gate.id);
        if (state !== 'open' && state !== 'closing') return false;
        return Math.hypot(px - gate.x, py - gate.y) <= TUNING.gate.radius;
      }) ?? null;

    // --- one pass over the horde -----------------------------------------
    nearest.length = 0;
    let auraSpeedMul = 1;
    let crowdX = 0;
    let crowdY = 0;
    let crowdCount = 0;
    let pressCount = 0;
    let pressX = 0;
    let pressY = 0;
    let pullX = 0;
    let pullY = 0;
    let poolDps = 0;
    const attackers: number[] = [];
    const attackerIds: string[] = [];
    const attackerRanged: boolean[] = [];
    let contactAttack = false;
    const contest: ChannelContest = { enemies: 0, elites: 0 };
    const poiContest = poiTarget !== null ? poiTarget : null;
    let poiContested = false;
    const invuln = simTimeMs - lastHitAtMs < TUNING.player.invulnMs + loadout.iframesMsBonus || simTimeMs < iframesUntilMs;

    // Leash (§3.9), its own pass so the horde pass below can index safely:
    // an ambient trash body stranded beyond `leashPx` for `leashMs` is
    // re-seated on the spawn ring while the density target has room, and
    // recycled silently (no kill, no drops) once it does not.
    for (let i = enemies.length - 1; i >= 0; i -= 1) {
      const enemy = enemies[i]!;
      if (Math.hypot(px - enemy.x, py - enemy.y) <= TUNING.enemy.leashPx) {
        enemy.inLeashAtMs = simTimeMs;
        continue;
      }
      if (enemy.owner !== null || enemy.boss !== null || simTimeMs - enemy.inLeashAtMs <= TUNING.enemy.leashMs) continue;
      if (near900 >= densityTarget(elapsedS, false) || ambientCount() > Math.ceil(densityTarget(elapsedS, false) * TUNING.wave.ambientTotalMul)) {
        enemies.splice(i, 1);
        continue;
      }
      near900 += 1;
      const point = spawnRing(undefined, elapsedS);
      enemy.x = point.x;
      enemy.y = point.y;
      enemy.inLeashAtMs = simTimeMs;
    }

    for (let i = enemies.length - 1; i >= 0; i -= 1) {
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
        if (enemy.elite !== null || enemy.boss !== null) contest.elites += 1;
      }
      if (poiContest !== null && Math.hypot(poiContest.x - enemy.x, poiContest.y - enemy.y) <= poiContest.radius) poiContested = true;
      if (enemy.elite?.includes('magnetic') === true && dist <= TUNING.elite.affixes.magnetic.radius && dist > 1) {
        pullX += ((enemy.x - px) / dist) * TUNING.elite.affixes.magnetic.pullPxPerS;
        pullY += ((enemy.y - py) / dist) * TUNING.elite.affixes.magnetic.pullPxPerS;
      }
      if (enemy.elite?.includes('plagued') === true && dist <= TUNING.elite.affixes.plagued.radius * 1.5) {
        poolDps += TUNING.elite.affixes.plagued.dps * (1 - skill * 0.6);
      }
      const reach = enemy.attackReach;
      // Encirclement is bodies, not shooters: the break-out reads contact reach.
      if (dist <= enemy.reach * BREAKOUT_RADIUS_MUL) {
        pressCount += 1;
        pressX += (px - enemy.x) / Math.max(1, dist);
        pressY += (py - enemy.y) / Math.max(1, dist);
      }
      let damage = enemy.damage;
      if (enemy.elite?.includes('frenzied') === true && enemy.hp / enemy.maxHp < TUNING.elite.affixes.frenzied.belowHpRatio) {
        damage *= TUNING.elite.affixes.frenzied.damageMul;
      }
      const guardAsleep = enemy.owner === 'guard:b' && simTimeMs < guardWakeAtMs && dist > TUNING.poi.lair.wakePx;
      if (!guardAsleep && dist <= reach + 8 && simTimeMs >= enemy.nextHitAtMs && damage > 0) {
        enemy.nextHitAtMs = simTimeMs + enemy.hitEveryMs;
        attackers.push(damage);
        attackerIds.push(enemy.elite !== null ? `elite:${enemy.def.id}` : enemy.def.id);
        attackerRanged.push(enemy.telegraphed);
        if (!enemy.telegraphed) contactAttack = true;
        if (enemy.elite?.includes('vampiric') === true) {
          enemy.hp = Math.min(enemy.maxHp, enemy.hp + damage * TUNING.elite.affixes.vampiric.healPct);
        }
      }
      // Boss / mid-boss telegraphed patterns (≥ 500 ms telegraphs; dodged on skill).
      if (enemy.boss !== null && simTimeMs >= enemy.nextPatternAtMs && dist <= 700) {
        enemy.nextPatternAtMs = simTimeMs + (enemy.boss === 'zone' ? BOSS_PATTERN_MS : MIDBOSS_PATTERN_MS);
        if (!rng.chance(PATTERN_DODGE_AT_SKILL1 * skill)) {
          hp -= enemy.damage * stats.get('contactDamageMul');
          logDamage('pattern', enemy.def.id, enemy.damage * stats.get('contactDamageMul'));
        }
      }
    }
    nearest.sort((a, b) => a.dist - b.dist);

    let damageThisTick = 0;
    let tookHit = false;
    if (!invuln && attackers.length > 0) {
      const pressure = Math.min(1, attackers.length / SURROUND_FOR_CERTAINTY);
      const dodge = contactAttack ? profile.evasion * skill : skill;
      if (rng.chance((1 - dodge) * pressure)) {
        const step = charms.find((c) => c.id === 'c_step');
        if (step !== undefined && contactAttack && simTimeMs >= gloamReadyAtMs) {
          // Gloam Step (§5.9): the dash eats the blow.
          gloamReadyAtMs = simTimeMs + gloamStepCooldownMs(step.rank);
          iframesUntilMs = simTimeMs + TUNING.charms.gloamStep.iframesMs;
        } else {
          damageThisTick = Math.max(...attackers) * stats.get('contactDamageMul');
          const top = attackers.indexOf(Math.max(...attackers));
          logDamage(attackerRanged[top] === true ? 'ranged' : 'contact', attackerIds[top] ?? '?', damageThisTick);
          tookHit = true;
          hp -= damageThisTick;
          lastHitAtMs = simTimeMs;
        }
      }
    }
    hp -= (poolDps * STEP_MS) / 1000;
    logDamage('pool', 'plagued', (poolDps * STEP_MS) / 1000);
    const hazardHit = (hazardDps(zone, elapsedS, skill) * STEP_MS) / 1000;
    hp -= hazardHit;
    logDamage('hazard', zone.hazard.kind, hazardHit);
    hp = Math.min(maxHp, hp + (stats.get('regenPerS') * STEP_MS) / 1000);

    if (inCollapse && collapse !== null && Math.hypot(px - ringCentre.x, py - ringCentre.y) > collapse.ringRadius) {
      hp -= (extraction.collapseFireDps * STEP_MS) / 1000;
      logDamage('fire', 'collapse', (extraction.collapseFireDps * STEP_MS) / 1000);
    }

    // --- weapons ----------------------------------------------------------
    const skillDamage = (SKILL_DAMAGE_FLOOR + SKILL_DAMAGE_GAIN * skill) * LIVE_DPS_EFFICIENCY;
    let widestReach = 0;
    let areaReach = 0;
    for (const weapon of weapons) {
      const shot = weaponThroughput(weapon, stats, classDef(profile.classId).passiveParams.burnDurationMul ?? 1);
      widestReach = Math.max(widestReach, shot.reachPx);
      if (BREAKABLE_PATTERNS.has(weapon.id)) areaReach = Math.max(areaReach, shot.reachPx);
      const engageCap = Math.max(1, Math.floor(shot.maxTargets * profile.engageRatio));
      let hits = 0;
      for (const candidate of nearest) {
        if (hits >= engageCap) break;
        if (candidate.dist > shot.reachPx) break;
        const enemy = enemies[candidate.index];
        if (enemy === undefined || enemy.hp <= 0) continue;
        const focus = enemy.elite !== null || enemy.boss !== null ? profile.eliteFocus : 1;
        enemy.hp -= (shot.dpsPerTarget * skillDamage * focus * enemy.takenMul * STEP_MS) / 1000;
        engaged.add(enemy.def.id);
        hits += 1;
      }
    }
    for (let i = enemies.length - 1; i >= 0; i -= 1) if (enemies[i]!.hp <= 0) killEnemy(i);

    // --- breakables -------------------------------------------------------
    for (let i = 0; i < map.breakables.length; i += 1) {
      if (brokeBreakable[i] === 1) continue;
      const b = map.breakables[i]!;
      if (Math.abs(b.x - px) > areaReach || Math.abs(b.y - py) > areaReach) continue;
      if (Math.hypot(b.x - px, b.y - py) > areaReach) continue;
      brokeBreakable[i] = 1;
      breakablesBroken += 1;
      const drop = rollBreakableDrop(rng, loadout.breakableDropMul, hp / maxHp < TUNING.breakable.drops.pk_bread.lowHpRatio);
      if (drop === null) continue;
      if (drop.kind === 'shards') shardsIn(drop.coins, 'breakables');
      else if (drop.kind === 'xp') orbs.push({ x: b.x, y: b.y, value: drop.orbs * drop.value * stats.get('xpMul') });
      else if (drop.kind === 'item') lootItem(drop.tierBias);
      else if (drop.id === 'pk_bread') {
        healHp += Math.min(TUNING.pickups.bread.heal, maxHp - hp);
        hp = Math.min(maxHp, hp + TUNING.pickups.bread.heal);
      }
      else if (drop.id === 'pk_bell') for (const orb of orbs) { orb.x = px; orb.y = py; }
      else if (drop.id === 'pk_flask') {
        for (const enemy of enemies) if (Math.hypot(enemy.x - px, enemy.y - py) <= TUNING.pickups.flask.radius) enemy.hp -= TUNING.pickups.flask.damage;
      }
    }

    // --- xp orbs + level ups ---------------------------------------------
    const vacuum = TUNING.xp.earlyVacuum;
    const pickup = stats.get('pickupRadius') + (level < vacuum.untilLevel ? vacuum.radiusAdd : 0);
    for (let i = orbs.length - 1; i >= 0; i -= 1) {
      const orb = orbs[i]!;
      if (Math.abs(orb.x - px) > pickup || Math.abs(orb.y - py) > pickup) continue;
      if (Math.hypot(orb.x - px, orb.y - py) > pickup) continue;
      xp += orb.value;
      xpTotal += orb.value;
      orbs.splice(i, 1);
    }
    for (;;) {
      const needed = xpNeeded(level);
      if (xp < needed) break;
      xp -= needed;
      level += 1;
      firstLevelS ??= elapsedS;
      draft(true);
    }

    // --- events ----------------------------------------------------------
    if (activeEvent !== null) {
      const ev = activeEvent;
      const dYard = Math.hypot(ev.yard.x - px, ev.yard.y - py);
      if (simTimeMs >= ev.untilMs) {
        activeEvent = null;
      } else if (!ev.started && dYard <= ev.yard.radius) {
        ev.started = true;
        ev.startedAtMs = simTimeMs;
        poisVisited += 1;
        if (ev.kind === 'ev_caravan') {
          for (let i = 0; i < TUNING.poi.events.caravan.ghouls; i += 1) {
            spawnAround('gildedghoul', 1, ev.yard.x, ev.yard.y, 200, `event:${ev.yard.id}`);
          }
          ev.untilMs = simTimeMs + TUNING.poi.events.caravan.durationS * 1000;
        } else if (ev.kind === 'ev_vigil') {
          ev.untilMs = simTimeMs + TUNING.poi.events.vigil.holdS * 1000;
        } else {
          ev.untilMs = simTimeMs + TUNING.poi.events.rising.windowS * 1000;
        }
      } else if (ev.started) {
        if (ev.kind === 'ev_vigil') {
          if (dYard <= TUNING.poi.events.vigil.radius) ev.progress += STEP_MS;
          // 3 waves of 20 across the hold: one at the start, then evenly spaced.
          const waveEveryMs = (TUNING.poi.events.vigil.holdS * 1000) / TUNING.poi.events.vigil.waves;
          const due = Math.min(TUNING.poi.events.vigil.waves, Math.floor(ev.progress / waveEveryMs) + 1);
          while (ev.wavesSpawned < due) {
            ev.wavesSpawned += 1;
            spawnAround('husk', TUNING.poi.events.vigil.waveSize, ev.yard.x, ev.yard.y, 420, null);
          }
          if (ev.progress >= TUNING.poi.events.vigil.holdS * 1000) {
            lootItem(2);
            xpBurst(ev.yard);
            activeEvent = null;
          }
        } else if (ev.kind === 'ev_rising') {
          // The Rising raises its dead in pulses of 20 (every 10 s) inside the ring.
          const due = 1 + Math.floor((simTimeMs - ev.startedAtMs) / 10000);
          while (ev.wavesSpawned < due) {
            ev.wavesSpawned += 1;
            spawnAround('husk', 20, ev.yard.x, ev.yard.y, TUNING.poi.events.rising.radius, null);
          }
          if (ev.progress >= TUNING.poi.events.rising.kills) {
            eliteChest(false);
            xpBurst(ev.yard);
            activeEvent = null;
          }
        } else if (!enemies.some((e) => e.owner === `event:${ev.yard.id}`)) {
          activeEvent = null;
        }
      }
    }

    // --- move -------------------------------------------------------------
    if (headingTo === null && intent.reason !== 'hold-for-greed') {
      const ev = activeEvent;
      const eventTravelS =
        ev === null ? Number.POSITIVE_INFINITY : (Math.hypot(ev.yard.x - px, ev.yard.y - py) * pathFactor) / moveSpeed;
      if (denLocked) {
        poiTarget = null;
      } else if (ev !== null && profile.eventDetourS > 0 && (ev.started || eventTravelS <= profile.eventDetourS)) {
        poiTarget = null;
        const next = nav.step(nav.field(ev.yard.x, ev.yard.y), px, py);
        if (Math.hypot(ev.yard.x - px, ev.yard.y - py) > 120) {
          targetX = next.x;
          targetY = next.y;
          pathed = true;
        }
      } else {
        if (poiTarget === null) {
          poiTarget = choosePoi(moveSpeed);
          poiProgressMs = 0;
        }
        if (poiTarget !== null) {
          const poi = poiTarget;
          if (Math.hypot(poi.x - px, poi.y - py) <= POI_ARRIVE_PX || (poi.kind === 'den' && Math.hypot(poi.x - px, poi.y - py) <= poi.radius)) {
            if (interactPoi(poi, poiContested, tookHit)) {
              xpBurst(poi);
              poiDone.add(poi.id);
              poisVisited += 1;
              poiTarget = null;
            }
          } else {
            const next = nav.step(nav.field(poi.x, poi.y), px, py);
            targetX = next.x;
            targetY = next.y;
            pathed = true;
          }
        }
      }
      if (!pathed && (poiTarget === null || Math.hypot(poiTarget.x - px, poiTarget.y - py) > POI_ARRIVE_PX) && crowdCount > 0 && !denLocked) {
        const cx = crowdX / crowdCount;
        const cy = crowdY / crowdCount;
        const toCrowd = Math.max(1, Math.hypot(cx - px, cy - py));
        const hold = widestReach * profile.holdRatio;
        targetX = cx - ((cx - px) / toCrowd) * hold;
        targetY = cy - ((cy - py) / toCrowd) * hold;
      }
    }

    const breakoutTrigger = Math.max(2, BREAKOUT_TRIGGER_BASE - BREAKOUT_TRIGGER_SKILL_GAIN * skill);
    const channelling = extraction.channelProgress > 0 && ringGate !== null;
    if (pressCount >= breakoutTrigger && !channelling) {
      const pressLen = Math.max(0.001, Math.hypot(pressX, pressY));
      const escape = Math.max(200, widestReach);
      targetX = px + (pressX / pressLen) * escape;
      targetY = py + (pressY / pressLen) * escape;
    }

    const stepPx = (moveSpeed * STEP_MS) / 1000;
    const dx = targetX - px;
    const dy = targetY - py;
    const moveDist = Math.hypot(dx, dy);
    let nx = px;
    let ny = py;
    if (moveDist > 1) {
      nx += (dx / moveDist) * Math.min(stepPx, moveDist);
      ny += (dy / moveDist) * Math.min(stepPx, moveDist);
    }
    nx += (pullX * STEP_MS) / 1000;
    ny += (pullY * STEP_MS) / 1000;
    nx = Math.min(map.width - 40, Math.max(40, nx));
    ny = Math.min(map.height - 40, Math.max(40, ny));
    // Blockers: slide along an axis, or hold.
    if (!nav.blocked(nx, ny)) {
      px = nx;
      py = ny;
    } else if (!nav.blocked(nx, py)) {
      px = nx;
    } else if (!nav.blocked(px, ny)) {
      py = ny;
    }

    // Critic B3 elite near cap (mirrors `CombatSystem`): only the nearest
    // `eliteNearCap` elites engage; the rest orbit at `eliteNearPx + 300`.
    const engagedElites = new Set(
      enemies
        .filter((e) => e.elite !== null && e.boss === null)
        .sort((a, b) => Math.hypot(px - a.x, py - a.y) - Math.hypot(px - b.x, py - b.y))
        .slice(0, TUNING.wave.eliteNearCap),
    );
    for (const enemy of enemies) {
      const edx = px - enemy.x;
      const edy = py - enemy.y;
      const edist = Math.max(1, Math.hypot(edx, edy));
      let standoff = enemy.standoff;
      if (enemy.elite !== null && enemy.boss === null) {
        if (!engagedElites.has(enemy)) standoff = Math.max(standoff, TUNING.wave.eliteNearPx + 300);
      }
      const approach = enemy.def.behaviour === 'flee' ? -1 : edist > standoff ? 1 : -0.5;
      let speed = enemy.speed;
      if (enemy.elite?.includes('frenzied') === true && enemy.hp / enemy.maxHp < TUNING.elite.affixes.frenzied.belowHpRatio) {
        speed *= TUNING.elite.affixes.frenzied.speedMul;
      }
      // Dormant POI populations hold their post until the hero is near.
      if (enemy.owner !== null && edist > TUNING.poi.activateRadius) continue;
      if (enemy.owner === 'guard:b' && simTimeMs < guardWakeAtMs && edist > TUNING.poi.lair.wakePx) continue;
      const move = (speed * auraSpeedMul * approach * STEP_MS) / 1000;
      enemy.x += (edx / edist) * move;
      enemy.y += (edy / edist) * move;
    }

    // --- extraction --------------------------------------------------------
    extraction.update(STEP_MS, px, py, tookHit, contest);

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
    let near = 0;
    for (const entry of nearest) if (entry.dist <= CROWD_RADIUS_PX) near += 1;
    near900 = near;
    const band = bands[bandIndex]!;
    band.seconds += STEP_MS / 1000;
    band.ticks += 1;
    band.kills = kills;
    band.xp = xpTotal;
    band.shards = bag.shards;
    band.damageTaken += damageThisTick;
    band.liveSum += near;
    band.liveMax = Math.max(band.liveMax, near);
    band.level = level;
    liveMax = Math.max(liveMax, near);
    for (const at of CENSUS_S) if (Math.abs(elapsedS - at) < STEP_MS / 2000) live[at] = near;
    hpMinRatio = Math.min(hpMinRatio, Math.max(0, hp) / maxHp);

    simTimeMs += STEP_MS;
    if (extraction.extracted) break;
    if (hp <= 0) {
      if (reviveCharges > 0) {
        reviveCharges -= 1;
        hp = maxHp * loadout.reviveHpRatio;
        iframesUntilMs = simTimeMs + loadout.reviveImmunityMs;
        continue;
      }
      endReason = 'died';
      break;
    }
  }

  const endS = simTimeMs / 1000;
  const extracted = extraction.extracted;
  const greed = extracted ? greedMul(endS, loadout.greedMaxMul) : 1;
  const settlement = bag.settle(extracted ? 'extracted' : 'died', {
    deathKeepPct: loadout.deathKeepPct,
    greedMul: greed,
    gravePact: loadout.gravePact,
    rng,
  });
  let itemsBankedValue = 0;
  let valuablesBankedValue = 0;
  for (const item of settlement.kept) {
    itemsBankedValue += itemValue(item);
    if (item.kind === 'valuable') valuablesBankedValue += itemValue(item);
  }

  let previousKills = 0;
  let previousShards = 0;
  let previousXp = 0;
  for (const band of bands) {
    if (band.ticks === 0) continue;
    const ck = band.kills;
    const cs = band.shards;
    const cx = band.xp;
    band.kills = ck - previousKills;
    band.shards = cs - previousShards;
    band.xp = cx - previousXp;
    previousKills = ck;
    previousShards = cs;
    previousXp = cx;
  }

  const used = gateUsed as GateCandidate | null;
  return {
    seed,
    lane,
    skill,
    zone: zone.id,
    endS,
    endReason,
    gateUsed: used?.id ?? null,
    gateKind: used?.kind ?? null,
    gateIntents,
    shardsBanked: settlement.shardsBanked,
    itemsBankedValue,
    valuablesBankedValue,
    haul: settlement.shardsBanked + itemsBankedValue,
    greedMul: greed,
    kills,
    eliteKills,
    bossKilled,
    midBossKilled,
    level,
    drafts,
    firstLevelS,
    firstEvolutionS,
    evolutions,
    hpMinRatio,
    live,
    liveMax,
    bands,
    poisVisited,
    chestsOpened,
    breakablesBroken,
    healHp,
    engaged: [...engaged],
    spawned: [...spawnedIds],
    reachedCollapse,
    unknownStatMods,
    pathFactor,
    damageBy,
    shardsBy,
    build: `${weapons.map((w) => `${w.id}${w.boosts + 1}${w.evolved ? '*' : ''}`).join(',')} | ${charms.map((c) => `${c.id}${c.rank}`).join(',')}`,
  };
}

// ---------------------------------------------------------------------------
// Probes — single-question measurements on the real ExtractionSystem
// ---------------------------------------------------------------------------

interface ChannelProbe {
  gate: GateId;
  completedInS: number | null;
  interrupts: number;
  plateau: number;
  rate: number;
  elitesInRing: number;
  worstCaseS: number;
}

function probeExtraction(map: GeneratedMap, zone: ZoneDef): ExtractionSystem {
  const hazard = hazardDef(1);
  return new ExtractionSystem(
    map.gates,
    {
      channelMs: TUNING.extract.channelMs,
      radius: TUNING.gate.radius,
      collapseAtS: TUNING.collapse.atS,
      closingWarnS: TUNING.gate.closingWarnS,
      channel: TUNING.extract,
      collapse: TUNING.collapse,
    },
    simLoadout(zone, 'duskhauler', hazard, map.seed),
    { payCondition: () => true, onEvent: () => undefined },
  );
}

/**
 * Stands in one gate's ring from its open second; `hitEveryMs` null is the
 * uncontested case, otherwise a hit lands on that cadence with
 * `elitesInRing` elites contesting (the V1 greybox's uncompletable channel).
 */
function probeChannel(map: GeneratedMap, zone: ZoneDef, gateId: GateId, hitEveryMs: number | null, elitesInRing: number, limitS: number): ChannelProbe {
  const extraction = probeExtraction(map, zone);
  const gate = map.gates.find((entry) => entry.id === gateId)!;
  const worstCaseS = worstCaseChannelMs(extraction.channelTuning, TUNING.player.invulnMs, elitesInRing) / 1000;
  const contest: ChannelContest | undefined =
    hitEveryMs === null ? undefined : { enemies: Math.max(1, elitesInRing), elites: elitesInRing };
  let interrupts = 0;
  let plateau = 0;
  let standingMs = 0;
  let nextHitMs = hitEveryMs ?? Number.POSITIVE_INFINITY;
  let rate = 1;
  for (let t = 0; t < (gate.opensS + limitS) * 1000; t += STEP_MS) {
    const inRing = t >= gate.opensS * 1000;
    let tookHit = false;
    if (inRing && hitEveryMs !== null && standingMs >= nextHitMs) {
      nextHitMs += hitEveryMs;
      tookHit = true;
    }
    extraction.update(STEP_MS, inRing ? gate.x : map.spawn.x, inRing ? gate.y : map.spawn.y, tookHit, inRing ? contest : undefined);
    if (!inRing) continue;
    standingMs += STEP_MS;
    rate = extraction.channelRate;
    plateau = Math.max(plateau, extraction.channelProgress);
    if (extraction.channelInterrupted) interrupts += 1;
    if (extraction.extracted) {
      return { gate: gateId, completedInS: standingMs / 1000, interrupts, plateau: 1, rate, elitesInRing, worstCaseS };
    }
  }
  return { gate: gateId, completedInS: null, interrupts, plateau, rate, elitesInRing, worstCaseS };
}

interface ReachProbe {
  zone: string;
  gate: GateId;
  kind: string;
  pathPx: number;
  pathFactor: number;
  travelS: number;
  windowS: number;
  ok: boolean;
}

/** §19/§2.2: every timed gate reachable from spawn at BASE moveSpeed (pathed) inside its window. */
function probeReachability(maps: readonly { zone: ZoneDef; map: GeneratedMap }[]): ReachProbe[] {
  const probes: ReachProbe[] = [];
  const channelS = TUNING.extract.channelMs / 1000;
  for (const { zone, map } of maps) {
    const nav = new NavFields(map);
    for (const gate of map.gates) {
      const pathPx = nav.distance(nav.field(gate.x, gate.y), map.spawn.x, map.spawn.y);
      const travelS = pathPx / TUNING.player.moveSpeed;
      const windowEnd = gate.closesS ?? TUNING.collapse.atS + 60;
      const windowS = windowEnd - gate.opensS;
      probes.push({
        zone: zone.id,
        gate: gate.id,
        kind: gate.kind,
        pathPx,
        pathFactor: pathPx / Math.max(1, Math.hypot(gate.x - map.spawn.x, gate.y - map.spawn.y)),
        travelS,
        windowS,
        // A walker leaving spawn at 0 s is at the gate by max(open, travel); it must finish inside the window.
        ok: Math.max(gate.opensS, travelS) + channelS <= windowEnd,
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
}

/** §19 anti-idle: the Collapse kills a bot standing still at the map corner farthest from Gate C within 90 s. */
function probeIdleCollapse(map: GeneratedMap, zone: ZoneDef): IdleProbe {
  const gateC = map.gates.find((gate) => gate.id === 'c')!;
  const corners: readonly (readonly [number, number])[] = [
    [60, 60],
    [map.width - 60, 60],
    [60, map.height - 60],
    [map.width - 60, map.height - 60],
  ];
  let far = corners[0]!;
  for (const corner of corners) {
    if (Math.hypot(corner[0] - gateC.x, corner[1] - gateC.y) > Math.hypot(far[0] - gateC.x, far[1] - gateC.y)) far = corner;
  }
  let hp = TUNING.player.maxHp * 2;
  const extraction = probeExtraction(map, zone);
  let ringStartPx = 0;
  let ringEndPx = 0;
  let fireContactedAtS: number | null = null;
  for (let t = 0; t <= (TUNING.collapse.atS + 120) * 1000; t += STEP_MS) {
    extraction.update(STEP_MS, far[0], far[1], false);
    const collapse = extraction.collapse;
    if (collapse === null || !collapse.active) continue;
    ringStartPx = extraction.collapseRingStartRadius;
    ringEndPx = collapse.ringRadius;
    const centre = extraction.collapseRingCenter;
    if (Math.hypot(far[0] - centre.x, far[1] - centre.y) > collapse.ringRadius) {
      fireContactedAtS ??= extraction.collapseElapsedS;
      hp -= (extraction.collapseFireDps * STEP_MS) / 1000;
    }
    if (hp <= 0) return { deathAtOvertimeS: extraction.collapseElapsedS, ringStartPx, ringEndPx, fireContactedAtS };
  }
  return { deathAtOvertimeS: null, ringStartPx, ringEndPx, fireContactedAtS };
}

interface Probes {
  reach: ReachProbe[];
  clean: ChannelProbe;
  contestedB: ChannelProbe;
  contestedC: ChannelProbe;
  idle: IdleProbe;
}

// ---------------------------------------------------------------------------
// Aggregation and the §19 Balance battery
// ---------------------------------------------------------------------------

interface LaneStats {
  lane: LanePolicy;
  runs: number;
  extractionRate: number;
  died: number;
  unresolved: number;
  medianEndS: number;
  medianHaul: number;
  gateMix: Record<string, number>;
  medianDrafts: number;
  medianLevel: number;
  medianPois: number;
  medianBreakables: number;
  medianHealHp: number;
  bossKillRate: number;
  midBossKillRate: number;
  medianFirstEvolutionS: number;
}

function medianOrInf(values: readonly (number | null)[]): number {
  return median(values.map((value) => value ?? Number.POSITIVE_INFINITY));
}

function laneStats(lane: LanePolicy, runs: readonly RouteRun[]): LaneStats {
  const mine = runs.filter((run) => run.lane === lane);
  const gateMix: Record<string, number> = {};
  for (const run of mine) {
    const key = run.gateUsed === null ? run.endReason : run.gateUsed === 'x' ? `x-${run.gateKind}` : run.gateUsed;
    gateMix[key] = (gateMix[key] ?? 0) + 1;
  }
  const extracted = mine.filter((run) => run.endReason === 'extracted').length;
  const share = (predicate: (run: RouteRun) => boolean): number =>
    mine.length > 0 ? mine.filter(predicate).length / mine.length : 0;
  return {
    lane,
    runs: mine.length,
    extractionRate: mine.length > 0 ? extracted / mine.length : 0,
    died: mine.filter((run) => run.endReason === 'died').length,
    unresolved: mine.filter((run) => run.endReason === 'unresolved').length,
    medianEndS: median(mine.map((run) => run.endS)),
    medianHaul: median(mine.map((run) => run.haul)),
    gateMix,
    medianDrafts: median(mine.map((run) => run.drafts)),
    medianLevel: median(mine.map((run) => run.level)),
    medianPois: median(mine.map((run) => run.poisVisited)),
    medianBreakables: median(mine.map((run) => run.breakablesBroken)),
    medianHealHp: median(mine.map((run) => run.healHp)),
    bossKillRate: share((run) => run.bossKilled),
    midBossKillRate: share((run) => run.midBossKilled),
    medianFirstEvolutionS: medianOrInf(mine.map((run) => run.firstEvolutionS)),
  };
}

/** §19 Balance bands (PRD-V2). */
const MAX_FIRST_LEVEL_S = 10;
/**
 * SIM-calibrated draft band (user decision 2026-09-25, re-scope of §19's
 * 20-24). No single XP calibration factor fits: at matched run time the sim
 * and live agree (sim Duelist 22 drafts by ~225 s vs live veteran 27 by
 * 232-262 s, Arsenal-20 build), so scaling sim XP down would make the early
 * window colder than live. The gap is at 420 s+, where only the deep lanes
 * survive (40-42 drafts). Live already exceeds 24 by ~250 s (POI XP bursts +
 * draft pity), so the §6.1 20-24 no longer describes the live game either.
 * The band brackets the measured sim value; the live cert run is the
 * authority for pacing.
 */
const DRAFTS_BAND: readonly [number, number] = [28, 48];
const FULL_RUN_S = 420;
/**
 * Re-scoped by Main (V2 bodies are ~2.5× larger linearly, so on-screen
 * coverage is already dense): §6.3's 100-150 / 170-240 became 50-90 / 80-140.
 */
/**
 * 420 s: 80-140 → 60-140 (user decision 2026-09-25). V2 bodies are ~2.5×
 * larger linearly, and the live density-target curve caps ambient bodies near
 * the hero; the few sim bots alive at 420 s sit at Gate C in a thinned field.
 */
const LIVE_BANDS: Record<number, readonly [number, number]> = { 240: [50, 90], 420: [60, 140] };
const COURIER_MIN_EXTRACTION = 0.85;
/**
 * 40-60% → 25-60% (user decision 2026-09-25: the user asked for a harder game
 * and approved the difficulty; the deep greed lane is meant to be risky; live
 * veteran Gate-B runs end at 17-35% HP, sim Delver 25-41% over the last passes).
 */
const DELVER_EXTRACTION_BAND: readonly [number, number] = [0.25, 0.6];
/**
 * Spread is measured across the three RISK lanes only (user decision
 * 2026-09-25). Courier is the safe loot-and-leave lane by design and is gated
 * on its own (`COURIER_MIN_EXTRACTION`); including it made the spread measure
 * the design intent rather than lane balance.
 */
const MAX_LANE_SPREAD = 0.45;
const RISK_LANES: readonly LanePolicy[] = ['delver', 'duelist', 'pyre'];
const MIN_GREED_PREMIUM = 2.5;
const MAX_FIRST_EVOLUTION_S = 300;
const MIN_COLLAPSE_SHARE = 1 / 20;
const CONTESTED_GATE_B_LIMIT_S = 20;
const CONTESTED_GATE_C_LIMIT_S = 30;

export interface BalanceRow {
  band: string;
  target: string;
  measured: string;
  pass: boolean;
  /** Reported, never a hard gate. */
  informational?: boolean;
}

/** The §19 Balance row, band by band, on the CEILING runs. */
function balanceRows(ceiling: readonly RouteRun[], lanesRun: readonly LanePolicy[]): BalanceRow[] {
  const rows: BalanceRow[] = [];
  const lanes = lanesRun.map((lane) => laneStats(lane, ceiling));
  const allLanes = lanesRun.length === LANES.length;

  const firstLevel = medianOrInf(ceiling.map((run) => run.firstLevelS));
  rows.push({ band: 'first level (median)', target: `<= ${MAX_FIRST_LEVEL_S} s`, measured: `${num(firstLevel, 1)} s`, pass: firstLevel <= MAX_FIRST_LEVEL_S });

  const full = ceiling.filter((run) => run.endS >= FULL_RUN_S);
  const drafts = full.length > 0 ? median(full.map((run) => run.drafts)) : Number.NaN;
  rows.push({
    band: `drafts/run (median, full runs >= ${FULL_RUN_S} s, n=${full.length})`,
    target: `${DRAFTS_BAND[0]}-${DRAFTS_BAND[1]}`,
    measured: num(drafts, 1),
    pass: drafts >= DRAFTS_BAND[0] && drafts <= DRAFTS_BAND[1],
  });

  for (const at of CENSUS_S) {
    const values = ceiling.map((run) => run.live[at]).filter((value): value is number => value !== null && value !== undefined);
    const band = LIVE_BANDS[at]!;
    const m = values.length > 0 ? median(values) : Number.NaN;
    rows.push({
      band: `live enemies <= 900 px at ${at} s (median, n=${values.length})`,
      target: `${band[0]}-${band[1]}`,
      measured: num(m, 0),
      pass: m >= band[0] && m <= band[1],
    });
  }

  const courier = lanes.find((lane) => lane.lane === 'courier');
  if (courier !== undefined) {
    rows.push({ band: 'Courier extraction', target: `>= ${pct(COURIER_MIN_EXTRACTION)}`, measured: pct(courier.extractionRate), pass: courier.extractionRate >= COURIER_MIN_EXTRACTION });
  }
  const delver = lanes.find((lane) => lane.lane === 'delver');
  if (delver !== undefined) {
    rows.push({
      band: 'Delver extraction',
      target: `${pct(DELVER_EXTRACTION_BAND[0])}-${pct(DELVER_EXTRACTION_BAND[1])}`,
      measured: pct(delver.extractionRate),
      pass: delver.extractionRate >= DELVER_EXTRACTION_BAND[0] && delver.extractionRate <= DELVER_EXTRACTION_BAND[1],
    });
  }
  const risk = lanes.filter((lane) => RISK_LANES.includes(lane.lane));
  const rates = risk.map((lane) => lane.extractionRate);
  const spread = rates.length > 0 ? Math.max(...rates) - Math.min(...rates) : 0;
  rows.push({
    band: 'risk-lane spread (extraction rate max-min, Delver/Duelist/Pyre)',
    target: `<= ${MAX_LANE_SPREAD}`,
    measured: `${num(spread)} [${risk.map((lane) => `${lane.lane} ${pct(lane.extractionRate)}`).join(', ')}]`,
    pass: !allLanes || spread <= MAX_LANE_SPREAD,
  });

  const haulA = ceiling.filter((run) => run.gateUsed === 'a').map((run) => run.haul);
  const haulC = ceiling.filter((run) => run.gateUsed === 'c').map((run) => run.haul);
  const premium = haulA.length > 0 && haulC.length > 0 ? median(haulC) / Math.max(1, median(haulA)) : Number.NaN;
  rows.push({
    band: `greed premium haul(C)/haul(A) (medians, nA=${haulA.length}, nC=${haulC.length})`,
    target: `>= ${MIN_GREED_PREMIUM}`,
    measured: `${num(premium)} (A ${num(haulA.length > 0 ? median(haulA) : Number.NaN, 0)}, C ${num(haulC.length > 0 ? median(haulC) : Number.NaN, 0)})`,
    pass: premium >= MIN_GREED_PREMIUM,
  });

  // Censored at the band: a run that ended before 300 s never had the chance
  // to evolve by 300 s, so it is not evidence either way.
  const lived = ceiling.filter((run) => run.endS >= MAX_FIRST_EVOLUTION_S);
  const firstEvo = medianOrInf(lived.map((run) => run.firstEvolutionS));
  rows.push({
    band: `first evolution (median over runs alive at ${MAX_FIRST_EVOLUTION_S} s, n=${lived.length}; never = inf)`,
    target: `<= ${MAX_FIRST_EVOLUTION_S} s`,
    measured: `${num(firstEvo, 0)} s`,
    pass: firstEvo <= MAX_FIRST_EVOLUTION_S,
  });

  const collapseShare = ceiling.length > 0 ? ceiling.filter((run) => run.reachedCollapse).length / ceiling.length : 0;
  // Informational (user decision 2026-09-25): no bot policy waits for the
  // Collapse, so this counts accidents, not a design outcome. The Collapse
  // itself stays hard-gated by the idle-bot probe (kills within 90 s).
  rows.push({
    band: 'runs reaching the Collapse (informational)',
    target: '>= 1 per 20',
    measured: `${pct(collapseShare, 1)} (${ceiling.filter((run) => run.reachedCollapse).length}/${ceiling.length})`,
    pass: collapseShare >= MIN_COLLAPSE_SHARE,
    informational: true,
  });
  return rows;
}

function evaluateGates(
  runs: readonly RouteRun[],
  ceiling: readonly RouteRun[],
  floor: readonly RouteRun[],
  probes: Probes,
  lanesRun: readonly LanePolicy[],
): GateResult[] {
  const gates: GateResult[] = [];
  for (const row of balanceRows(ceiling, lanesRun)) {
    if (row.informational === true) continue;
    gates.push(hard(row.pass, `§19 ${row.band}: ${row.measured} (${row.target}) [owner data/waves.ts + config.ts TUNING]`));
  }

  const unresolved = runs.filter((run) => run.endReason === 'unresolved');
  gates.push(hard(unresolved.length === 0, `every run ended by extraction or death, never by a clock: ${runs.length - unresolved.length}/${runs.length}`));

  const extracted = runs.filter((run) => run.endReason === 'extracted');
  const accidental = extracted.filter((run) => run.gateIntents.every((reason) => reason === 'farm' || reason === 'hold-for-greed'));
  gates.push(
    hard(
      extracted.length === 0 || accidental.length / extracted.length < 0.2,
      `extractions are DECIDED, not stumbled into: ${accidental.length}/${extracted.length} with no gate intent (< 20%)`,
    ),
  );

  const unreachable = probes.reach.filter((probe) => !probe.ok);
  gates.push(
    hard(
      unreachable.length === 0,
      unreachable.length === 0
        ? `all ${probes.reach.length} zone/gate pairs reachable (pathed, base moveSpeed) inside their window`
        : `unreachable [owner systems/mapgen.ts gate bands]: ${unreachable.map((p) => `${p.zone}/${p.gate} travel ${num(p.travelS, 1)}s window ${num(p.windowS, 0)}s`).join('; ')}`,
    ),
  );

  gates.push(
    hard(
      probes.clean.completedInS !== null && probes.clean.completedInS <= TUNING.extract.channelMs / 1000 + 0.3,
      `clean channel at Gate A: ${probes.clean.completedInS === null ? 'NEVER' : `${num(probes.clean.completedInS, 1)}s`} (channelMs ${TUNING.extract.channelMs}) [owner systems/extraction.ts]`,
    ),
  );
  for (const [probe, limit, label] of [
    [probes.contestedB, CONTESTED_GATE_B_LIMIT_S, 'Gate B under unbroken contact'],
    [probes.contestedC, CONTESTED_GATE_C_LIMIT_S, 'Gate C with the boss in the ring'],
  ] as const) {
    gates.push(
      hard(
        probe.completedInS !== null && probe.completedInS <= limit,
        `CONTESTED channel, ${label}: ${probe.completedInS === null ? `NEVER (plateau ${num(probe.plateau)})` : `${num(probe.completedInS, 1)}s`} (<= ${limit}s; worst case ${num(probe.worstCaseS, 1)}s) [owner systems/extraction.ts + TUNING.extract]`,
      ),
    );
  }
  const channel = probeExtraction(sampleMapFor(ZONES[0]!), ZONES[0]!).channelTuning;
  gates.push(
    hard(
      channelCompletableUnderContact(channel, TUNING.player.invulnMs),
      `channel law: (invulnMs ${TUNING.player.invulnMs} - hitStallMs ${channel.hitStallMs}) * minRate ${channel.minRate} > hitSetbackMs ${channel.hitSetbackMs}`,
    ),
  );
  gates.push(
    hard(
      probes.idle.deathAtOvertimeS !== null && probes.idle.deathAtOvertimeS <= 90,
      `Collapse kills an idle bot (farthest corner, 2x base hp) ${probes.idle.deathAtOvertimeS === null ? 'NEVER' : `at +${num(probes.idle.deathAtOvertimeS, 1)}s`} (<= 90s); ring ${num(probes.idle.ringStartPx, 0)} -> ${num(probes.idle.ringEndPx, 0)}px [owner systems/extraction.ts + TUNING.collapse]`,
    ),
  );

  // Per-type engagement law (§18.1): every spawned archetype is fought by the ceiling bot in a median run.
  const spawnedAll = new Set<string>();
  for (const run of ceiling) for (const id of run.spawned) spawnedAll.add(id);
  const neverEngaged = [...spawnedAll].filter((id) => {
    const seen = ceiling.filter((run) => run.spawned.includes(id));
    return seen.length > 0 && seen.filter((run) => run.engaged.includes(id)).length / seen.length < 0.5;
  });
  gates.push(
    hard(
      neverEngaged.length === 0,
      neverEngaged.length === 0
        ? `every one of the ${spawnedAll.size} spawned archetypes is engaged by the ceiling bot in a median run`
        : `archetypes the ceiling bot never fights [owner data/waves.ts]: ${neverEngaged.join(', ')}`,
    ),
  );

  if (floor.length > 0) {
    const floorRate = floor.filter((run) => run.endReason === 'extracted').length / floor.length;
    gates.push(hard(floorRate > 0 && floorRate < 0.9, `FLOOR bot (skill ${FLOOR_SKILL}) extraction rate = ${pct(floorRate)} (neither hopeless nor a formality)`));
  }

  const unknown = new Set<string>();
  for (const run of runs) for (const entry of run.unknownStatMods) unknown.add(entry);
  gates.push(
    hard(
      unknown.size === 0,
      unknown.size === 0 ? 'every card/charm/class modifier targets a stat the run model reads' : `modifiers target stats nothing reads: ${[...unknown].slice(0, 8).join(', ')}`,
    ),
  );
  return gates;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function renderReport(runs: readonly RouteRun[], ceiling: readonly RouteRun[], probes: Probes, lanesRun: readonly LanePolicy[], weaponSlots: number): void {
  console.log(`§19 BALANCE ROW (ceiling skill ${CEILING_SKILL}; weapons.maxSlots ${weaponSlots}; ${ZONES.length} zones, H1)`);
  printTable(
    ['band', 'target', 'measured', 'pass'],
    balanceRows(ceiling, lanesRun).map((row) => [row.band, row.target, row.measured, row.informational === true ? 'INFO' : row.pass ? 'PASS' : 'FAIL']),
  );

  console.log('');
  console.log('LANES (ceiling)');
  printTable(
    ['lane', 'runs', 'extract%', 'died', 'medEndS', 'medHaul', 'gate mix', 'drafts', 'level', 'pois', 'urns', 'heal hp', 'boss%', 'midboss%', '1st evo s'],
    lanesRun.map((lane) => {
      const s = laneStats(lane, ceiling);
      return [
        s.lane,
        String(s.runs),
        pct(s.extractionRate),
        String(s.died),
        num(s.medianEndS, 0),
        num(s.medianHaul, 0),
        Object.entries(s.gateMix).map(([key, count]) => `${key}:${count}`).join(' '),
        num(s.medianDrafts, 0),
        num(s.medianLevel, 0),
        num(s.medianPois, 0),
        num(s.medianBreakables, 0),
        num(s.medianHealHp, 0),
        pct(s.bossKillRate),
        pct(s.midBossKillRate),
        num(s.medianFirstEvolutionS, 0),
      ];
    }),
  );

  console.log('');
  console.log('BY ZONE (ceiling, all lanes)');
  printTable(
    ['zone', 'runs', 'extract%', 'medHaul', 'live@240', 'live@420', 'path factor spawn->C'],
    ZONES.map((zone) => {
      const mine = ceiling.filter((run) => run.zone === zone.id);
      const liveAt = (at: number): string => {
        const values = mine.map((run) => run.live[at]).filter((v): v is number => v !== null && v !== undefined);
        return values.length > 0 ? num(median(values), 0) : '-';
      };
      return [
        zone.id,
        String(mine.length),
        pct(mine.length > 0 ? mine.filter((run) => run.endReason === 'extracted').length / mine.length : 0),
        num(median(mine.map((run) => run.haul)), 0),
        liveAt(240),
        liveAt(420),
        num(median(mine.map((run) => run.pathFactor))),
      ];
    }),
  );

  console.log('');
  console.log('PROGRESSION BY PHASE BAND (ceiling, medians) — unit = §2.1 phase');
  printTable(
    ['band', 'window', 'live<=900 avg', 'live max', 'kills/s', 'xp/s', 'shards/s', 'dmg/s', 'level at end'],
    BANDS.map((band, index) => {
      const window = `${band.fromS}-${Number.isFinite(band.toS) ? band.toS : 'end'}s`;
      const samples = ceiling.map((run) => run.bands[index]!).filter((sample) => sample.seconds > 1);
      if (samples.length === 0) return [band.name, window, '-', '-', '-', '-', '-', '-', '-'];
      return [
        band.name,
        window,
        num(median(samples.map((s) => s.liveSum / s.ticks)), 0),
        String(Math.max(...samples.map((s) => s.liveMax))),
        num(median(samples.map((s) => s.kills / s.seconds))),
        num(median(samples.map((s) => s.xp / s.seconds))),
        num(median(samples.map((s) => s.shards / s.seconds))),
        num(median(samples.map((s) => s.damageTaken / s.seconds))),
        num(median(samples.map((s) => s.level)), 0),
      ];
    }),
  );

  console.log('');
  console.log('DAMAGE TAKEN BY SOURCE (ceiling; hp per second of band, median-free mean across runs in band)');
  const sources = ['contact', 'ranged', 'burst', 'pattern', 'pool', 'hazard', 'fire'];
  printTable(
    ['band', ...sources, 'top archetypes (share of band damage)'],
    BANDS.map((band, index) => {
      const seconds = ceiling.reduce((sum, run) => sum + run.bands[index]!.seconds, 0);
      const bySource: Record<string, number> = {};
      const byArchetype: Record<string, number> = {};
      let total = 0;
      for (const run of ceiling) {
        for (const [key, amount] of Object.entries(run.damageBy)) {
          const [name, source, archetype] = key.split('|');
          if (name !== band.name) continue;
          bySource[source!] = (bySource[source!] ?? 0) + amount;
          byArchetype[archetype!] = (byArchetype[archetype!] ?? 0) + amount;
          total += amount;
        }
      }
      const top = Object.entries(byArchetype)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([id, amount]) => `${id} ${pct(amount / Math.max(1, total))}`)
        .join(', ');
      return [band.name, ...sources.map((source) => (seconds > 0 ? num((bySource[source] ?? 0) / seconds) : '-')), top || '-'];
    }),
  );

  console.log('');
  console.log('PROBES (the real ExtractionSystem on a castle map)');
  printTable(
    ['probe', 'result', 'detail'],
    [
      ['channel clean (A)', probes.clean.completedInS === null ? 'NEVER' : `${num(probes.clean.completedInS, 1)}s`, `rate ${num(probes.clean.rate)}`],
      ['channel contested (B)', probes.contestedB.completedInS === null ? 'NEVER' : `${num(probes.contestedB.completedInS, 1)}s`, `worst ${num(probes.contestedB.worstCaseS, 1)}s, interrupts ${probes.contestedB.interrupts}`],
      ['channel contested (C)', probes.contestedC.completedInS === null ? 'NEVER' : `${num(probes.contestedC.completedInS, 1)}s`, `worst ${num(probes.contestedC.worstCaseS, 1)}s`],
      ['collapse vs idle bot', probes.idle.deathAtOvertimeS === null ? 'SURVIVED' : `+${num(probes.idle.deathAtOvertimeS, 1)}s`, `ring ${num(probes.idle.ringStartPx, 0)} -> ${num(probes.idle.ringEndPx, 0)}px`],
    ],
  );

  console.log('');
  console.log('GATE REACHABILITY (seed map per zone, pathed, base moveSpeed)');
  printTable(
    ['zone', 'gate', 'kind', 'pathPx', 'pathFactor', 'travelS', 'windowS', 'ok'],
    probes.reach.map((p) => [p.zone, p.gate, p.kind, num(p.pathPx, 0), num(p.pathFactor), num(p.travelS, 1), num(p.windowS, 0), p.ok ? 'yes' : 'NO']),
  );

  const unresolved = runs.filter((run) => run.endReason === 'unresolved');
  for (const run of unresolved.slice(0, 5)) {
    console.log(`  UNRESOLVED ${run.lane} ${run.zone} skill ${run.skill}: ${num(run.endS, 0)}s, intents ${run.gateIntents.join('>')}`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function sampleMapFor(zone: ZoneDef): GeneratedMap {
  return generateMap(zone, `probe:${zone.id}`);
}

export interface ArenaSimOptions extends FamilySimOptions {
  /** `--lane`: one §8 route, or every route. */
  lane?: 'all' | LanePolicy;
  /** `--weapon-slots`: measurement override of `weapons.maxSlots` (the §18a fallback-3 check). */
  weaponSlots?: number;
}

function runArenaSim(options: ArenaSimOptions): number {
  const lanes = options.lane === undefined || options.lane === 'all' ? LANES : [options.lane];
  const runCount = Number.isFinite(options.runs) && options.runs > 0 ? options.runs : 20;
  const weaponSlots = options.weaponSlots ?? TUNING.weapons.maxSlots;
  const seeder = new Rng(`${options.seed}:arena`);
  const runs: RouteRun[] = [];
  for (const zone of ZONES) {
    for (const lane of lanes) {
      for (const skill of SKILL_LEVELS) {
        for (let i = 0; i < runCount; i += 1) {
          const seed = `${options.seed}:${zone.id}:${lane}:${skill}:${i}:${seeder.int(0, 0x7fffffff)}`;
          runs.push(simulateRoute({ seed, lane, skill, zone, weaponSlots }));
        }
      }
    }
  }

  const maps = ZONES.map((zone) => ({ zone, map: sampleMapFor(zone) }));
  const castle = maps[0]!;
  const probes: Probes = {
    reach: probeReachability(maps),
    clean: probeChannel(castle.map, castle.zone, 'a', null, 0, 30),
    contestedB: probeChannel(castle.map, castle.zone, 'b', TUNING.player.invulnMs, 0, 90),
    contestedC: probeChannel(castle.map, castle.zone, 'c', TUNING.player.invulnMs, 1, 90),
    idle: probeIdleCollapse(castle.map, castle.zone),
  };
  const ceiling = runs.filter((run) => run.skill === CEILING_SKILL);
  const floor = runs.filter((run) => run.skill === FLOOR_SKILL);
  const gates = evaluateGates(runs, ceiling, floor, probes, lanes);

  return finishFamily(options, gates, () => renderReport(runs, ceiling, probes, lanes, weaponSlots), {
    family: 'arena',
    weaponSlots,
    balance: balanceRows(ceiling, lanes),
    lanes: lanes.map((lane) => laneStats(lane, ceiling)),
    probes,
    runs: runs.map((run) => ({ ...run, bands: undefined })),
  });
}

export default runArenaSim;
