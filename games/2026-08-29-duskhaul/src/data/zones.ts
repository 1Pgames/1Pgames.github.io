import { TUNING } from '../config';
import type { Depth, GateId, GateKind, ZoneId } from './types-v2';

export type { ZoneId } from './types-v2';

/**
 * Zone table (PRD-V2 §5.29 / §16.1 E7). Four zones, each a separate run
 * map: threat base, account-level unlock rule, hazard, loot bias, boss pair,
 * the stamp set and cluster biome `systems/mapgen.ts` builds the map from, and
 * the five gate candidate slot rules (§3.6).
 *
 * Gate POSITIONS no longer live here: mapgen picks them per run from
 * `gateSlots` by region depth and path distance (§3.6), and the run reads
 * them from `GeneratedMap.gates`.
 *
 * Zone-exclusive enemy rosters are not duplicated: each exclusive `EnemyDef`
 * in `data/enemies.ts` carries `zone: '<id>'`; `exclusives` below is the
 * §5.29 content column for UI (codex/expedition cards).
 *
 * Pure data, no Phaser import.
 */

/** Cluster archetypes mapgen scatters between stamps (§3.2 step 12). */
/** `lone` = a single blocker from the zone's full prop pool (no heaps). */
export type ClusterArchetype = 'wall' | 'lone' | 'graveyard' | 'monolith' | 'debris';

/**
 * One gate candidate slot (§3.6): the region depths it may sit in, its PATH
 * distance band from spawn, its weight among the conditional (`x`) slots, and
 * the gate kinds it may become. `id` is the gate the slot feeds; the two `x`
 * slots compete by `weight` for the one conditional gate a run gets.
 */
export interface GateSlotRule {
  id: GateId;
  depth: readonly Depth[];
  minDist: number;
  maxDist: number;
  weight: number;
  kinds: readonly GateKind[];
}

export type ZoneHazardKind = 'braziers' | 'bonestorm' | 'sinksand' | 'gale';

export interface ZoneDef {
  id: ZoneId;
  name: string;
  threatBase: number;
  /** §5.29 unlock rule: account level AND an extraction from `unlockAfter` (null = open from L1). */
  unlockLevel: number;
  unlockAfter: ZoneId | null;
  /** Rarity/valuable tier shift points (§5.29; replaces V1 per-tier percentages). */
  lootBias: number;
  hazard: { kind: ZoneHazardKind; params: Record<string, number> };
  backdropKey: string;
  /** §3.6: exactly five slot rules — a, b, c and two competing conditional slots. */
  gateSlots: readonly GateSlotRule[];
  /** Key into `data/stamps.ts STAMP_SETS`. */
  stampSet: string;
  /** Cluster archetype weights (§3.5), in `ClusterArchetype` order. */
  clusterWeights: Readonly<Record<ClusterArchetype, number>>;
  /** Lighting pool tint (§3.7). */
  lightTint: number;
  bossId: string;
  bossName: string;
  midBossId: string;
  midBossName: string;
  /** §5.29 exclusive roster ids (content column; spawn tables read `EnemyDef.zone`). */
  exclusives: readonly string[];
}

/**
 * The a/b/c slots are identical in every zone (§2.2 distance bands, depth
 * law §3.3); zones differ in which conditional kinds their two `x` slots
 * allow and how they weigh them.
 */
const GD = TUNING.mapgen.gateDist;

function slots(x1: Omit<GateSlotRule, 'id' | 'minDist' | 'maxDist'>, x2: Omit<GateSlotRule, 'id' | 'minDist' | 'maxDist'>): GateSlotRule[] {
  return [
    { id: 'a', depth: [0, 1], minDist: GD.a[0], maxDist: GD.a[1], weight: 1, kinds: ['timed'] },
    { id: 'b', depth: [1], minDist: GD.b[0], maxDist: GD.b[1], weight: 1, kinds: ['timed'] },
    // C at 6-7.5 km from a central spawn straddles the depth 1/2 ring boundary.
    { id: 'c', depth: [1, 2], minDist: GD.c[0], maxDist: GD.c[1], weight: 1, kinds: ['timed'] },
    // Conditional slots: a near one inside the A-B span, a far one inside B-C.
    { id: 'x', minDist: GD.xMin, maxDist: GD.b[1] + 2000, ...x1 },
    { id: 'x', minDist: GD.b[0], maxDist: GD.c[0] + 3200, ...x2 },
  ];
}

export const ZONES: readonly ZoneDef[] = [
  {
    id: 'castle',
    name: 'Bleakspire Keep',
    threatBase: 1.0,
    unlockLevel: 1,
    unlockAfter: null,
    lootBias: 0.25,
    // Cursed braziers (§5.29 ×9, ×16 area): 864 fixed hazard anchors pulse 8 dmg in r 110
    // every 5 s after a 2 s telegraph glow.
    hazard: { kind: 'braziers', params: { count: 864, damage: 8, radius: 110, intervalS: 5, telegraphS: 2 } },
    backdropKey: 'bg-castle',
    gateSlots: slots(
      { depth: [1], weight: 60, kinds: ['toll', 'bell'] },
      { depth: [1, 2], weight: 40, kinds: ['offering', 'bell'] },
    ),
    stampSet: 'castle',
    clusterWeights: { wall: 25, lone: 45, graveyard: 15, monolith: 5, debris: 10 },
    lightTint: 0xf7a446,
    bossId: 'boss_castle',
    bossName: 'Bell Warden of Bleakspire',
    midBossId: 'mb_castle',
    midBossName: 'Sexton of Bleakspire',
    exclusives: ['chapelghast', 'gargoyle', 'choirwraith'],
  },
  {
    id: 'outlands',
    name: 'Ashen Outlands',
    threatBase: 1.15,
    unlockLevel: 5,
    unlockAfter: 'castle',
    lootBias: 0.5,
    // Bonestorm: every 45 s a 6 s gust pushes 90 px/s; 192 ash zones stream
    // along the roads (§3.9: hazard anchors sit ON road cells).
    hazard: {
      kind: 'bonestorm',
      params: { intervalS: 45, gustS: 6, pushPxPerS: 90, dotZones: 192, dotDps: 3, dotRadius: 150 },
    },
    backdropKey: 'bg-outlands',
    gateSlots: slots(
      { depth: [1], weight: 50, kinds: ['toll', 'offering'] },
      { depth: [1, 2], weight: 50, kinds: ['bell', 'toll'] },
    ),
    stampSet: 'outlands',
    clusterWeights: { wall: 10, lone: 60, graveyard: 10, monolith: 8, debris: 12 },
    lightTint: 0xd9a24b,
    bossId: 'boss_outlands',
    bossName: 'Ashen Warden',
    midBossId: 'mb_outlands',
    midBossName: 'Gibbet Herald',
    exclusives: ['kite', 'giant', 'mirehag'],
  },
  {
    id: 'desert',
    name: 'Sorrow Dunes',
    threatBase: 1.3,
    unlockLevel: 12,
    unlockAfter: 'outlands',
    lootBias: 0.75,
    // 720 sinksand pits (r 140, slow 35%); midday scorch 380-420 s burns 2 hp/s
    // outside the shade props cast.
    hazard: {
      kind: 'sinksand',
      params: {
        pits: 720,
        radius: 140,
        slowPct: 35,
        projectileBlockPx: 40,
        scorchFromS: 380,
        scorchToS: 420,
        scorchDps: 2,
        shadeRadius: 160,
      },
    },
    backdropKey: 'bg-desert',
    gateSlots: slots(
      { depth: [1], weight: 40, kinds: ['offering', 'toll'] },
      { depth: [1, 2], weight: 60, kinds: ['bell', 'offering'] },
    ),
    stampSet: 'desert',
    clusterWeights: { wall: 15, lone: 50, graveyard: 8, monolith: 12, debris: 15 },
    lightTint: 0xf3ca67,
    bossId: 'boss_desert',
    bossName: 'Sun-Eaten Warden',
    midBossId: 'mb_desert',
    midBossName: 'Sand Matron',
    exclusives: ['leech', 'scarab', 'sandrevenant'],
  },
  {
    id: 'winter',
    name: "Widow's Crown",
    threatBase: 1.5,
    unlockLevel: 20,
    unlockAfter: 'desert',
    lootBias: 1.0,
    // Gale: 30% slow outside 720 torch radii (placed along roads — the warm
    // route); 576 ice sheets (r 160) slide with 0.92 friction.
    hazard: {
      kind: 'gale',
      params: { slowPct: 30, torches: 720, torchRadius: 260, iceSheets: 576, iceRadius: 160, iceFriction: 0.92 },
    },
    backdropKey: 'bg-winter',
    gateSlots: slots(
      { depth: [1], weight: 50, kinds: ['bell', 'toll'] },
      { depth: [1, 2], weight: 50, kinds: ['offering', 'toll'] },
    ),
    stampSet: 'winter',
    clusterWeights: { wall: 15, lone: 55, graveyard: 8, monolith: 10, debris: 12 },
    lightTint: 0x9fd3ff,
    bossId: 'boss_winter',
    bossName: 'Rime Warden',
    midBossId: 'mb_winter',
    midBossName: 'Rime Reaper',
    exclusives: ['widow', 'yeti', 'rimestalker'],
  },
];

const BY_ID: Record<string, ZoneDef> = {};
for (const zone of ZONES) BY_ID[zone.id] = zone;

/** Zone by id. Throws on an unknown id — a bad zone id is an authoring bug. */
export function zoneDef(id: string): ZoneDef {
  const def = BY_ID[id];
  if (def === undefined) throw new Error(`Unknown zone id "${id}"`);
  return def;
}
