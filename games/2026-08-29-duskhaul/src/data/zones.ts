import { TUNING } from '../config';
import type { GateSpec } from '../systems/extraction';
import type { RelicTier } from './relics';

/**
 * Zone table (PRD §5.7 / §16.1 `ZoneDef`). Four zones, each a separate run
 * arena: its own threat base, unlock price, hazard, gate layout, loot bias and
 * backdrop. There is no mid-run zone travel (§5.7), so a `ZoneDef` is chosen
 * once at run start and `systems/zone.ts` applies it wholesale.
 *
 * Gate coordinates are authored in the PRD's 1600x1600 design space;
 * consumers scale by `ZONE_DESIGN_SIZE` into the live arena's real bounds
 * (`TUNING.arena.width/height`) so the layout survives arena-size tuning.
 *
 * Open/close SCHEDULES are identical in every zone (§2A gate schedule: "all
 * zones, positions per §5.7"), so every row reads them from `TUNING.gate.*`
 * rather than restating seconds — only the POSITIONS differ per zone.
 *
 * Zone-exclusive enemy rosters are NOT duplicated here: each exclusive
 * `EnemyDef` in `data/enemies.ts` carries `zone: '<id>'`, and
 * `enemiesForZone(id)` is the single query both the spawner and the sim use.
 */

export interface ZoneDef {
  id: 'castle' | 'outlands' | 'desert' | 'winter';
  name: string;
  threatBase: number;
  unlockShards: number;
  /** Additive tier-weight shift applied on top of `TUNING.loot.tierWeights`. */
  lootBias: Partial<Record<RelicTier, number>>;
  gates: [GateSpec, GateSpec, GateSpec];
  hazard: {
    kind: 'braziers' | 'bonestorm' | 'sinksand' | 'gale';
    params: Record<string, number>;
  };
  backdropKey: string;
}

export type ZoneId = ZoneDef['id'];

/** Side length of the square design space the PRD's gate coordinates use. */
export const ZONE_DESIGN_SIZE = 1600;

/**
 * Builds one zone's three gates from PRD design-space coordinates. The
 * schedule triple is shared by every zone, which is why it lives here once.
 */
function gates(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): [GateSpec, GateSpec, GateSpec] {
  return [
    { id: 'a', x: a[0], y: a[1], opensS: TUNING.gate.a.openS, closesS: TUNING.gate.a.closeS },
    { id: 'b', x: b[0], y: b[1], opensS: TUNING.gate.b.openS, closesS: TUNING.gate.b.closeS },
    { id: 'c', x: c[0], y: c[1], opensS: TUNING.gate.c.openS, closesS: TUNING.gate.c.closeS },
  ];
}

/**
 * Threat bases (§5.7: x1.0/1.15/1.3/1.5) and unlock prices (0/300/800/1600)
 * are per-zone content columns; hazard params are §5.7 content too — shape and
 * behaviour differ per hazard kind, so there is nothing to hoist.
 * `systems/zone.ts` reads them by kind.
 */
export const ZONES: readonly ZoneDef[] = [
  {
    id: 'castle',
    name: 'Bleakspire Keep',
    threatBase: 1.0,
    unlockShards: 0,
    lootBias: { 2: 5 },
    gates: gates([420, 300], [1200, 900], [1450, 1450]),
    // Cursed braziers: 6 fixed points pulse 8 dmg in r=110 every 5s (2s
    // telegraph glow).
    hazard: {
      kind: 'braziers',
      params: { count: 6, damage: 8, radius: 110, intervalS: 5, telegraphS: 2 },
    },
    backdropKey: 'bg-castle',
  },
  {
    id: 'outlands',
    name: 'Ashen Outlands',
    threatBase: 1.15,
    unlockShards: 300,
    lootBias: { 2: 8, 3: 4 },
    gates: gates([350, 1250], [900, 400], [1500, 200]),
    // Bonestorm wind: every 45s a 6s gust pushes 90 px/s left-to-right and
    // spawns 3 drifting ash-dot zones (3 dps).
    hazard: {
      kind: 'bonestorm',
      // `dotRadius` and the two radii below are geometry the §5.7 prose
      // implies but does not state; `systems/zone.ts` needs them to turn each
      // hazard into a real mechanic. The ash zones drift at `pushPxPerS`.
      params: { intervalS: 45, gustS: 6, pushPxPerS: 90, dotZones: 3, dotDps: 3, dotRadius: 150 },
    },
    backdropKey: 'bg-outlands',
  },
  {
    id: 'desert',
    name: 'Sorrow Dunes',
    threatBase: 1.3,
    unlockShards: 800,
    lootBias: { 3: 10 },
    gates: gates([500, 500], [1300, 1300], [200, 1500]),
    // Sinking sand: 5 shifting pits (r=140) slow 35% and block projectiles'
    // first 40px; midday scorch 380-420s: 2 hp/s outside shade props.
    hazard: {
      kind: 'sinksand',
      params: {
        pits: 5,
        radius: 140,
        slowPct: 35,
        projectileBlockPx: 40,
        scorchFromS: 380,
        scorchToS: 420,
        scorchDps: 2,
        // Radius of the shade each prop casts during the midday scorch.
        shadeRadius: 160,
      },
    },
    backdropKey: 'bg-desert',
  },
  {
    id: 'winter',
    name: "Widow's Crown",
    threatBase: 1.5,
    unlockShards: 1600,
    lootBias: { 3: 6, 4: 6 },
    gates: gates([800, 250], [250, 800], [1500, 1500]),
    // Freezing gale: 30% slow outside torch radii (5 torches); ice sheets (4
    // patches, r=160) make movement slide with 0.92 friction.
    hazard: {
      kind: 'gale',
      params: {
        slowPct: 30,
        torches: 5,
        // Radius each torch keeps warm — outside it the gale's slow applies.
        torchRadius: 260,
        iceSheets: 4,
        iceRadius: 160,
        iceFriction: 0.92,
      },
    },
    backdropKey: 'bg-winter',
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

/** The zone the game always starts unlocked with (§5.7: castle, 0 shards). */
export const STARTING_ZONE: ZoneDef = zoneDef('castle');
