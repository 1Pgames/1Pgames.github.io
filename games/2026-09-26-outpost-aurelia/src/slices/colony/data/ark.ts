/**
 * Orbital Ark tech tree + endless Refit (PRD §10).
 * Owned by ContentDev (W3); shapes frozen in `./types.ts`.
 *
 * 36 nodes: 6 branches × rings 0-5; a ring-r node requires one ring r − 1
 * node of the same branch. `effects` apply at `createColony`
 * (`model/modifiers.ts:arkModifiers`); `unlocks` lists directive, protocol,
 * kit and site ids (`model/draft.ts:unlockedPool`, hub LAND tab).
 */
import { COLONY_TUNING } from '../tuning';
import type { ArkNode, Effect } from './types';

/** Ring prices in Data (PRD §9, provisional until `ark.selftest.ts` measures income). */
const ARK_RING_COST: readonly number[] = [60, 250, 725, 775, 825, 900];

function node(id: string, name: string, desc: string, branch: ArkNode['branch'], ring: ArkNode['ring'], effects: readonly Effect[], unlocks: readonly string[] = []): ArkNode {
  return { id, name, desc, branch, ring, cost: ARK_RING_COST[ring] ?? 0, effects, unlocks };
}

export const ARK_NODES: readonly ArkNode[] = [
  // hab (kin)
  node('hab_bunks', 'Bunk Racks', 'Fold-down berths: every Hab Dome +1 bed.', 'hab', 0, [{ stat: 'hab.beds', add: 1 }]),
  node('hab_kit', 'Settler Charter', 'Unlocks the Settler Crate kit.', 'hab', 1, [], ['kit_settler']),
  node('hab_charter', 'Kin Charter', 'Unlocks Hearth Songs, Auto-Rota, Kinship Pact.', 'hab', 2, [], ['kin_songs', 'kin_rota', 'kin_pact']),
  node('hab_morale', 'Homeworld Letters', 'Recorded voices from home: start morale 65.', 'hab', 3, [{ stat: 'morale.start', add: 15 }]),
  node('hab_proto', 'Plaza Plans', 'Unlocks the Infirmary protocol.', 'hab', 4, [], ['p_infirm']),
  node('hab_wave', 'Second Wave', 'Wake the next deck early: +1 arrival every dawn.', 'hab', 5, [{ stat: 'arrivals', add: 1 }]),
  // forge
  node('forge_bay', 'Cargo Bay', 'More ore in the landing hold: start Fe +30.', 'forge', 0, [{ stat: 'start.ferrite', add: 30 }]),
  node('forge_charter', 'Forge Charter', 'Unlocks Hot Pour, Lens Grinders, Cell Line.', 'forge', 1, [], ['forge_pour', 'forge_lens', 'forge_cell']),
  node('forge_dies', 'Tooling Dies', 'Pre-cut parts: Mk upgrades cost −15 %.', 'forge', 2, [{ stat: 'upgrade.cost', mul: -0.15 }]),
  node('forge_notes', 'Crucible Notes', 'Unlocks the Slag Furnace and Focus Array protocols.', 'forge', 3, [], ['p_slag', 'p_focus']),
  node('forge_theory', 'Lumen Theory', 'Unlocks the Lumen Forge and Geode Rig protocols.', 'forge', 4, [], ['p_lumen', 'p_geode']),
  node('forge_lathes', 'Precision Lathes', 'Tighter tolerances: processors +10 % rate.', 'forge', 5, [{ stat: 'process.rate', mul: 0.1 }]),
  // grid (hearth)
  node('grid_coils', 'Core Coils', 'Rewound core windings: core +1 kW.', 'grid', 0, [{ stat: 'core.kw', add: 1 }]),
  node('grid_charter', 'Hearth Charter', 'Unlocks Deep Taps, Sunward Sails, Graceful Dimming.', 'grid', 1, [], ['hearth_vents', 'hearth_sunward', 'hearth_dimming']),
  node('grid_emitter', 'Wide Emitter', 'A taller core mast: core field radius +1.', 'grid', 2, [{ stat: 'core.radius', add: 1 }]),
  node('grid_vents', 'Vent Schematics', 'Unlocks the Magma Well and Capacitor Vault protocols.', 'grid', 3, [], ['p_magma', 'p_vault']),
  node('grid_sails', 'Sail Schematics', 'Unlocks the Aurora Sails and Silent Bore protocols.', 'grid', 4, [], ['p_aurora', 'p_silent']),
  node('grid_aerogel', 'Aerogel Hulls', 'Lighter, warmer skins: night heat upkeep −10 %.', 'grid', 5, [{ stat: 'field.heatUpkeep', mul: -0.1 }]),
  // bulwark
  node('bul_core', 'Hardened Core', "Armour the lander's belly: core hp +20 %.", 'bul', 0, [{ stat: 'core.hp', mul: 0.2 }]),
  node('bul_charter', 'Bulwark Charter', 'Unlocks Arc Tuning, Airburst Fuse, Night Mend.', 'bul', 1, [], ['bul_arc', 'bul_flak', 'bul_mend']),
  node('bul_drill', 'Warden Drill', 'Faster turret assembly: Pulse Turrets cost −20 %.', 'bul', 2, [{ stat: 'pulse.cost', mul: -0.2 }]),
  node('bul_siege', 'Siege Notes', 'Unlocks the Storm Coil and Skyshatter protocols.', 'bul', 3, [], ['p_storm', 'p_sky']),
  node('bul_codex', 'Wall Codex', 'Unlocks the Living Wall protocol.', 'bul', 4, [], ['p_living']),
  node('bul_overwatch', 'Overwatch', 'Rangefinders on every barrel: turret range +8 %.', 'bul', 5, [{ stat: 'turret.range', mul: 0.08 }]),
  // survey (frontier)
  node('sur_scan', 'Orbital Scan', 'Clearer passes: fog reveal +2 tiles.', 'sur', 0, [{ stat: 'fog.revealTiles', add: 2 }]),
  node('sur_kit', 'Surveyor Charter', 'Unlocks the Surveyor Crate kit.', 'sur', 1, [], ['kit_surveyor']),
  node('sur_charter', 'Frontier Charter', 'Unlocks Deep Survey, Pylon Sentries, Stake Claims.', 'sur', 2, [], ['fr_survey', 'fr_sentry', 'fr_claim']),
  node('sur_samplers', 'Core Samplers', '+1 guaranteed pure deposit on every site.', 'sur', 3, [{ stat: 'deposit.purePerSite', add: 1 }]),
  node('sur_printing', 'Relay Printing', 'Print masts on site: Relay Pylons cost −20 %.', 'sur', 4, [{ stat: 'relay.cost', mul: -0.2 }]),
  node('sur_charts', 'Deep Space Charts', "The rift's coordinates: unlocks Aurora Rift (with 20 ★).", 'sur', 5, [], ['aurora_rift']),
  // command (orbit)
  node('cmd_ballots', 'Spare Ballots', '+1 draft reroll per Landing.', 'cmd', 0, [{ stat: 'draft.rerolls', add: 1 }]),
  node('cmd_charter', 'Orbit Charter', 'Unlocks Resonant Spire, Wide Band, Decoy Beacons, Launch Window.', 'cmd', 1, [], ['orb_resonant', 'orb_band', 'orb_decoy', 'orb_window']),
  node('cmd_kit', 'Tinker Charter', 'Unlocks the Tinker Crate kit.', 'cmd', 2, [], ['kit_tinker']),
  node('cmd_choir', 'Choir Notes', 'Unlocks the Choir Spire and Orbital Exchange protocols.', 'cmd', 3, [], ['p_choir', 'p_exchange']),
  node('cmd_uplink', 'Telemetry Uplink', 'Better compression: Data +10 %.', 'cmd', 4, [{ stat: 'data.mul', mul: 0.1 }]),
  node('cmd_fourth', 'Fourth Option', 'The council drafts wider: drafts show 4 cards.', 'cmd', 5, [{ stat: 'draft.choices', add: 1 }]),
];

/** Endless Data sink: `refitBase × refitGrowth ^ level` (PRD §7 colony.meta.refit*). */
export function refitCost(level: number): number {
  return Math.round(COLONY_TUNING.meta.refitBase * COLONY_TUNING.meta.refitGrowth ** level);
}
