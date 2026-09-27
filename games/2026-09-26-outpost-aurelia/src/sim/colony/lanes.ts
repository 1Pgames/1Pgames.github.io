/**
 * Colony sim lane profiles (PRD §8 variety routes, §19 lanes): WHAT each
 * headless player wants, sol by sol. `bots.ts` owns HOW (one shared builder
 * brain); a lane differs from another only in this data.
 *
 * A plan is a priority list of wants. `{ b, n }` = keep `n` of building `b`;
 * `{ up, mk }` = raise every `up` building to at least Mk `mk`. Each table is
 * indexed by sol (index 0 = sol 1; the last entry holds for later sols). A
 * want that cannot be met reserves the goods it is short of, so cheaper wants
 * further down cannot starve it.
 */
import type { BuildingId, TagId } from '../../slices/colony/content';
import type { LaneId } from './types';

/** Lanes the colony family sim plays: the §19 lanes plus `novice-noturret` (the novice with turrets withheld in sol 1). */
export const LANE_LABELS = ['bastion', 'sprawl', 'spire', 'kin', 'novice', 'novice-noturret', 'variety'] as const;
export type LaneLabel = (typeof LANE_LABELS)[number];

/** Count wanted per sol (index 0 = sol 1); the last entry holds for later sols. */
export type PerSol = readonly number[];

export type Want = { readonly b: BuildingId; readonly n: PerSol } | { readonly up: BuildingId; readonly mk: PerSol };

export interface Profile {
  id: LaneId;
  /** Seconds between decisions (reaction time). */
  thinkSec: number;
  /** Chance a decision is skipped (the novice's slack). */
  skipChance: number;
  /** Draft tag preference, best first; `null` = pick at random (novice: first card; variety: seeded random). */
  tags: readonly TagId[] | null;
  /** Wants in priority order. */
  plan: readonly Want[];
  /** Relay pylons the lane allows itself per sol (the route to the next deposit it wants). */
  relays: PerSol;
  /** The relay route may detour to unclaimed relics (sprawl). */
  chaseRelics: boolean;
  /** Purity weight when choosing an extractor site / relay target (0 = nearest). */
  purityWeight: number;
  /** Farthest ore / ice / vent (tiles from the core) the relay route treks to; crystal, the Beacon chain, has no limit. */
  reach: number;
  ship: boolean;
  /** First sol the lane charges the Beacon (every lane charges once it can on sol 10). */
  triggerSol: number;
  /** Turrets are never built on sol 1 (`novice-noturret`). */
  noTurretSol1: boolean;
  /** Beds kept free above the population (arrivals need free beds). */
  bedSlack: number;
  /** Feed this many colonists above the current count (kin grows). */
  foodSlack: number;
  /** Night kW margin (forecast + what the banks hold) the lane keeps, per sol. */
  powerFloor: PerSol;
  /**
   * Defence floor (skilled lanes): at dusk every telegraphed edge's front (the
   * outermost building on that side) keeps guns within reach worth
   * `fauna on the edge × night difficulty / guardFauna` Mk I pulses.
   */
  guardFauna: number;
  /** Staffing is respected (a skilled player never builds unstaffable buildings). */
  staffAware: boolean;
  /**
   * Skilled grid management: smelters idle once the alloy the plan needs is
   * stocked, processors pause at dusk when tonight's margin is short, prism is
   * held back for the Beacon chain, everything but the guns pauses while the
   * Beacon charges, ruins are rebuilt at dawn.
   */
  manage: boolean;
  /** Build toward the protocol of every owned directive (the variety lane's evolution chase). */
  chaseProtocols: boolean;
  /**
   * Ships every shippable order at once and keeps the goods a listed order asks for (cutters leave its aurelite,
   * foundries stock its cells on top of the Beacon's) — the variety lane proves every order template is reachable.
   */
  feedOrbit: boolean;
}

const BASTION: Profile = {
  id: 'bastion',
  thinkSec: 1,
  skipChance: 0,
  tags: ['bulwark', 'hearth', 'forge', 'kin', 'orbit', 'frontier'],
  plan: [
    // Income first (PRD §6 economy growth: ~5.5 Fe/s at sol 5, ~10 at sol 9): drills and their Mk head the ledger.
    { b: 'ferrite_drill', n: [3, 3, 4, 4, 5] },
    { b: 'pulse_turret', n: [2, 3, 3, 4, 5, 6] },
    { up: 'ferrite_drill', mk: [2, 3] },
    { b: 'vent_tap', n: [1, 2] },
    { b: 'alloy_smelter', n: [0, 1, 1, 2] },
    // PRD §2A.1 build R: harvester + cutter on sol 5 (earlier, their 2.5 kW sinks the nights 3-4 margin).
    { b: 'aurel_harvester', n: [0, 0, 0, 0, 1, 1, 2] },
    { b: 'prism_cutter', n: [0, 0, 0, 0, 1] },
    { up: 'aurel_harvester', mk: [0, 0, 0, 2, 3] },
    { up: 'prism_cutter', mk: [0, 0, 0, 0, 2, 3] },
    { up: 'alloy_smelter', mk: [0, 2, 3] },
    { b: 'charge_bank', n: [0, 1, 1, 2, 2, 3, 3, 4] },
    { up: 'vent_tap', mk: [1, 1, 2, 3] },
    { b: 'cargo_silo', n: [0, 0, 0, 1] },
    { b: 'lumen_foundry', n: [0, 0, 0, 0, 0, 1] },
    { b: 'beacon_spire', n: [0, 0, 0, 0, 0, 1] },
    { b: 'pulse_turret', n: [2, 3, 4, 6, 8, 9, 10, 11, 12, 12] },
    { b: 'plate_barricade', n: [0, 0, 2, 4, 6, 8, 10, 12] },
    { b: 'arc_coil', n: [0, 0, 0, 1, 2, 2, 3, 3, 4] },
    { b: 'sun_sail', n: [0, 1, 1, 2, 2, 3, 4, 5, 6, 7] },
    { up: 'lumen_foundry', mk: [0, 0, 0, 0, 0, 0, 2, 3] },
    { b: 'flak_mortar', n: [0, 0, 0, 0, 1, 1, 2] },
    { up: 'pulse_turret', mk: [0, 0, 0, 0, 2, 2, 3] },
    { up: 'plate_barricade', mk: [0, 0, 0, 0, 0, 2] },
  ],
  relays: [1, 3, 4, 6, 7, 7, 8],
  chaseRelics: false,
  purityWeight: 1,
  reach: 14,
  ship: true,
  triggerSol: 10,
  noTurretSol1: false,
  bedSlack: 4,
  foodSlack: 2,
  powerFloor: [0.5],
  guardFauna: 12,
  staffAware: true,
  manage: true,
  chaseProtocols: false,
  feedOrbit: false,
};

const SPRAWL: Profile = {
  id: 'sprawl',
  thinkSec: 1,
  skipChance: 0,
  tags: ['frontier', 'orbit', 'forge', 'hearth', 'kin', 'bulwark'],
  // PRD §8 Sprawl: the frontier drills and relays, the Spire route's Beacon chain and timing (the human rung-1 win:
  // one harvester + one cutter, the Spire the day it unlocks, foundries right after), then guns for its perimeter.
  plan: [
    { b: 'ferrite_drill', n: [3, 3, 4, 5, 6, 7] },
    { b: 'pulse_turret', n: [2, 3, 3, 4, 5, 6] },
    { up: 'ferrite_drill', mk: [2, 3] },
    { b: 'vent_tap', n: [1, 2, 2, 2, 3] },
    // The Fe its far drills bring is only worth guns and a Spire once smelted.
    { b: 'alloy_smelter', n: [0, 1, 2, 3, 3] },
    { b: 'aurel_harvester', n: [0, 0, 1] },
    { b: 'prism_cutter', n: [0, 0, 1] },
    { b: 'beacon_spire', n: [0, 0, 0, 0, 1] },
    { b: 'lumen_foundry', n: [0, 0, 0, 0, 0, 1, 2] },
    { b: 'charge_bank', n: [0, 0, 1, 1, 2, 2, 3] },
    { b: 'pulse_turret', n: [2, 3, 4, 6, 8, 9, 10, 11, 12, 12] },
    { up: 'alloy_smelter', mk: [0, 0, 0, 2, 3] },
    { b: 'cargo_silo', n: [0, 0, 0, 1, 2] },
    { up: 'vent_tap', mk: [1, 1, 2, 3] },
    { b: 'sun_sail', n: [0, 1, 2, 2, 3, 4, 5, 6, 7] },
    { b: 'arc_coil', n: [0, 0, 0, 1, 2, 2, 3, 3, 4] },
    { b: 'plate_barricade', n: [0, 0, 0, 0, 2, 3, 4, 5, 6] },
    { b: 'flak_mortar', n: [0, 0, 0, 0, 1, 1, 2] },
    { up: 'pulse_turret', mk: [0, 0, 0, 0, 2, 2, 3] },
  ],
  // PRD §8: 7-10 relays, 350-450 lit tiles (32-tile treks lit 550-850 and browned the guns out every night).
  relays: [1, 3, 5, 6, 7, 8, 8],
  chaseRelics: true,
  purityWeight: 4,
  reach: 24,
  ship: true,
  triggerSol: 9,
  noTurretSol1: false,
  bedSlack: 4,
  foodSlack: 2,
  // PRD §2A.1: S = R until sol 3; the extra relays (and the dips they cost) start on night 3.
  powerFloor: [0.5, 0.5, -2],
  guardFauna: 12,
  staffAware: true,
  manage: true,
  chaseProtocols: false,
  feedOrbit: false,
};

const SPIRE: Profile = {
  id: 'spire',
  thinkSec: 1,
  skipChance: 0,
  tags: ['orbit', 'forge', 'hearth', 'bulwark', 'kin', 'frontier'],
  // PRD §8 Spire Rush, replayed from the human win (critic-final, rung 1): drills to Mk III by sol 4, the inner crystal's
  // harvester sol 3 and ONE cutter (one Mk I cutter out-cuts the Beacon's prism need, so no crystal Mk upgrades), a
  // bank sol 5, the Spire the day it unlocks (bill saved from sol 5), a foundry right after, a second the next sol;
  // every alloy the smelters make goes to that chain, guns come from the dusk defence floor (`guardEdges`).
  plan: [
    { b: 'ferrite_drill', n: [3, 3, 4, 4, 5] },
    { b: 'pulse_turret', n: [2, 3, 3, 4, 4, 5] },
    { up: 'ferrite_drill', mk: [2, 3] },
    { b: 'vent_tap', n: [1, 2] },
    { b: 'alloy_smelter', n: [0, 1, 2] },
    { b: 'aurel_harvester', n: [0, 0, 1] },
    { b: 'prism_cutter', n: [0, 0, 1] },
    { b: 'beacon_spire', n: [0, 0, 0, 0, 1] },
    { b: 'lumen_foundry', n: [0, 0, 0, 0, 0, 1, 2] },
    { b: 'charge_bank', n: [0, 0, 0, 0, 1, 1, 2] },
    { b: 'pulse_turret', n: [2, 3, 4, 5, 6, 8, 10, 12, 13, 13] },
    { up: 'alloy_smelter', mk: [0, 0, 0, 0, 0, 0, 2] },
    { up: 'vent_tap', mk: [1, 1, 1, 1, 1, 1, 2, 3] },
    { b: 'sun_sail', n: [0, 1, 1, 2, 3, 5, 7] },
    { b: 'plate_barricade', n: [0, 0, 0, 2, 3, 4, 6, 12] },
    { b: 'arc_coil', n: [0, 0, 0, 0, 0, 0, 1, 2] },
    { up: 'pulse_turret', mk: [0, 0, 0, 0, 0, 0, 2, 3] },
  ],
  relays: [1, 3, 5, 7, 8, 8, 9],
  chaseRelics: false,
  purityWeight: 2,
  reach: 14,
  ship: true,
  triggerSol: 7,
  noTurretSol1: false,
  bedSlack: 4,
  foodSlack: 2,
  powerFloor: [0],
  guardFauna: 12,
  staffAware: true,
  manage: true,
  chaseProtocols: false,
  feedOrbit: false,
};

const KIN: Profile = {
  id: 'kin',
  thinkSec: 1,
  skipChance: 0,
  tags: ['kin', 'hearth', 'forge', 'bulwark', 'orbit', 'frontier'],
  // PRD §8 Kin Boom: the Spire route's Beacon chain and timing (the human rung-1 win), then the population build —
  // commons and beds for the Open Hatch arrivals — whose extra crews smelt for the gun growth below.
  plan: [
    { b: 'ferrite_drill', n: [3, 3, 4, 4, 5] },
    { b: 'pulse_turret', n: [2, 3, 3, 4, 5, 6] },
    { up: 'ferrite_drill', mk: [2, 3] },
    { b: 'vent_tap', n: [1, 2] },
    { b: 'alloy_smelter', n: [0, 1, 2] },
    { b: 'aurel_harvester', n: [0, 0, 1] },
    { b: 'prism_cutter', n: [0, 0, 1] },
    { b: 'beacon_spire', n: [0, 0, 0, 0, 1] },
    { b: 'lumen_foundry', n: [0, 0, 0, 0, 0, 1, 2] },
    { b: 'hearth_commons', n: [0, 0, 0, 1, 1, 2] },
    { b: 'charge_bank', n: [0, 0, 0, 1, 1, 2, 2, 3] },
    { b: 'pulse_turret', n: [2, 3, 4, 6, 8, 9, 10, 11, 12, 12] },
    { b: 'alloy_smelter', n: [0, 1, 2, 2, 2, 3] },
    { up: 'alloy_smelter', mk: [0, 0, 0, 0, 0, 2, 3] },
    { up: 'hydro_terrace', mk: [0, 0, 0, 2, 3] },
    { up: 'rime_borer', mk: [0, 0, 0, 2, 3] },
    { up: 'vent_tap', mk: [1, 1, 1, 2, 2, 3] },
    { b: 'arc_coil', n: [0, 0, 0, 0, 1, 2, 3, 3, 4] },
    { b: 'plate_barricade', n: [0, 0, 1, 2, 4, 6] },
    { b: 'sun_sail', n: [0, 1, 1, 2, 3, 3, 4, 5, 6] },
    { b: 'flak_mortar', n: [0, 0, 0, 0, 0, 1, 2] },
    { up: 'pulse_turret', mk: [0, 0, 0, 0, 0, 2, 3] },
  ],
  relays: [1, 3, 5, 6, 7, 8, 9],
  chaseRelics: false,
  purityWeight: 1,
  reach: 18,
  ship: true,
  triggerSol: 9,
  noTurretSol1: false,
  bedSlack: 6,
  foodSlack: 6,
  powerFloor: [0.5],
  guardFauna: 12,
  staffAware: true,
  manage: true,
  chaseProtocols: false,
  feedOrbit: false,
};

/**
 * Floor bot: slow, forgetful, never upgrades, ships or manages the grid, picks
 * the first card, triggers the moment it can. Sol 1 follows the coach (PRD
 * §2A.1 novice script): drill (`ore`), borer (`dock`), terrace, the second
 * drill, vent tap (`vent`), a sun sail it does not need at night, then
 * turrets (`dusk`). It walks one relay a sol from sol 2, so the ring-2 ore
 * waits for sol 2.
 */
const NOVICE: Profile = {
  id: 'novice',
  thinkSec: 3,
  skipChance: 0.2,
  tags: null,
  plan: [
    { b: 'ferrite_drill', n: [1] },
    { b: 'rime_borer', n: [1] },
    { b: 'hydro_terrace', n: [1] },
    { b: 'ferrite_drill', n: [2] },
    { b: 'vent_tap', n: [1] },
    { b: 'sun_sail', n: [1, 1, 1, 2, 2, 3] },
    { b: 'pulse_turret', n: [2, 2, 3, 3, 4, 4, 5] },
    { b: 'ferrite_drill', n: [2, 3, 4, 4, 5] },
    { b: 'alloy_smelter', n: [0, 0, 1] },
    { b: 'aurel_harvester', n: [0, 0, 0, 1] },
    { b: 'prism_cutter', n: [0, 0, 0, 1] },
    { b: 'beacon_spire', n: [0, 0, 0, 0, 0, 0, 1] },
    { b: 'lumen_foundry', n: [0, 0, 0, 0, 0, 0, 1] },
  ],
  relays: [0, 1, 1, 2, 2, 2, 3],
  chaseRelics: false,
  purityWeight: 0,
  reach: 12,
  ship: false,
  triggerSol: 6,
  noTurretSol1: false,
  bedSlack: 0,
  foodSlack: 0,
  powerFloor: [-99],
  guardFauna: 0,
  staffAware: false,
  manage: false,
  chaseProtocols: false,
  feedOrbit: false,
};

/**
 * Draft-variety lane: seeded random picks, a middle-of-the-road build that also chases every owned directive's
 * protocol. It opens the crystal chain on sol 3 (bastion waits for sol 5), so Geode Rig's 4 harvesters are reachable.
 */
const VARIETY: Profile = {
  ...BASTION,
  id: 'variety',
  tags: null,
  plan: BASTION.plan.map((w): Want => ('b' in w && (w.b === 'aurel_harvester' || w.b === 'prism_cutter') ? { b: w.b, n: w.b === 'aurel_harvester' ? [0, 0, 1, 1, 2] : [0, 0, 1] } : w)),
  relays: [1, 3, 5, 7, 9, 11, 13],
  chaseRelics: true,
  reach: 20,
  triggerSol: 8,
  chaseProtocols: true,
  feedOrbit: true,
};

export function profileFor(label: LaneLabel): Profile {
  switch (label) {
    case 'bastion':
      return BASTION;
    case 'sprawl':
      return SPRAWL;
    case 'spire':
      return SPIRE;
    case 'kin':
      return KIN;
    case 'novice':
      return NOVICE;
    case 'novice-noturret':
      return { ...NOVICE, id: 'novice-noturret', noTurretSol1: true };
    case 'variety':
      return VARIETY;
  }
}
