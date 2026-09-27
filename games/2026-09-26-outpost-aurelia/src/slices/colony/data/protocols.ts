/**
 * Protocols: directive ↔ building evolutions (PRD §5.3). 20 rows, 6 open at
 * L1; the other 14 unlock through Ark rings 3-4 (`data/ark.ts` `unlocks`).
 * Owned by ContentDev (W3); shapes frozen in `./types.ts`.
 *
 * Ready when the colony owns `directive` and ≥ `count` of `building`
 * ('extractors' = drill + borer + harvester). Evolution sets those buildings
 * to Apex (`apexArtKey`, `art/wiring.md` §1; p_silent is the badge overlay).
 */
import type { ProtocolDef } from './types';

export const PROTOCOLS: readonly ProtocolDef[] = [
  // open at L1
  { id: 'p_warren', name: 'Warren Dome', desc: 'Domes hold their own heat: 8 beds each; tiles within 2 of a dome stay lit in brownout.', directive: 'hearth_insulate', building: 'hab_dome', count: 4, openAtL1: true, effects: [{ stat: 'hab.beds', add: 2 }, { stat: 'hab.brownoutLitRadius', add: 2 }], apexArtKey: 'bld-hab-apex' },
  { id: 'p_lattice', name: 'Pulse Lattice', desc: 'Turrets share one sight-grid: a Pulse with a neighbour within 3 tiles fires at +1 target.', directive: 'bul_pulse', building: 'pulse_turret', count: 6, openAtL1: true, effects: [{ stat: 'pulse.extraTargets', add: 1 }], apexArtKey: 'bld-pulse-apex' },
  { id: 'p_bastion', name: 'Bastion Plate', desc: 'Walls that bite back: barricades reflect 20 % of melee damage.', directive: 'bul_plate', building: 'plate_barricade', count: 12, openAtL1: true, effects: [{ stat: 'wall.reflect', add: 0.2 }], apexArtKey: 'bld-wall-apex' },
  { id: 'p_crucible', name: 'Crucible Array', desc: 'A smelter line that never cools: smelter rate × 2.5.', directive: 'forge_parts', building: 'alloy_smelter', count: 3, openAtL1: true, effects: [{ stat: 'smelter.rate', mul: 1.5 }], apexArtKey: 'bld-smelter-apex' },
  { id: 'p_halo', name: 'Halo Pylons', desc: 'Masts ringed in warning light: relay radius +1, immune to Static Leeches.', directive: 'fr_relay', building: 'relay_pylon', count: 5, openAtL1: true, effects: [{ stat: 'relay.radius', add: 1 }, { stat: 'relay.leechImmune', add: 1 }], apexArtKey: 'bld-relay-apex' },
  { id: 'p_plaza', name: 'Arrival Plaza', desc: 'A landing pad in the square: +3 arrivals, and they staff the same dawn.', directive: 'kin_hatch', building: 'hab_dome', count: 5, openAtL1: true, effects: [{ stat: 'arrivals', add: 3 }, { stat: 'arrivals.staffSameDawn', add: 1 }], apexArtKey: 'bld-hab-apex' },
  // Ark ring 3-4
  { id: 'p_magma', name: 'Magma Well', desc: 'Turbines sunk into the melt: Vent Tap kW × 2, +3 noise each.', directive: 'hearth_vents', building: 'vent_tap', count: 3, openAtL1: false, effects: [{ stat: 'venttap.kw', mul: 1 }, { stat: 'venttap.noise', add: 3 }], apexArtKey: 'bld-venttap-apex' },
  { id: 'p_vault', name: 'Capacitor Vault', desc: 'Racks wired as one: bank discharge uncapped; surplus heals turrets 2 hp/s.', directive: 'hearth_battery', building: 'charge_bank', count: 4, openAtL1: false, effects: [{ stat: 'bank.dischargeUncapped', add: 1 }, { stat: 'bank.turretHealPerSec', add: 2 }], apexArtKey: 'bld-bank-apex' },
  { id: 'p_aurora', name: 'Aurora Sails', desc: 'Petals that drink the aurora: Sun Sails give 50 % at night.', directive: 'hearth_sunward', building: 'sun_sail', count: 6, openAtL1: false, effects: [{ stat: 'sail.nightShare', add: 0.5 }], apexArtKey: 'bld-sail-apex' },
  { id: 'p_storm', name: 'Storm Coil', desc: 'Lightning that locks joints: arc hits stun for 0.6 s.', directive: 'bul_arc', building: 'arc_coil', count: 3, openAtL1: false, effects: [{ stat: 'arc.stunSec', add: 0.6 }], apexArtKey: 'bld-arc-apex' },
  { id: 'p_sky', name: 'Skyshatter', desc: 'Shells that bloom thrice: every flak shell splits into 3.', directive: 'bul_flak', building: 'flak_mortar', count: 3, openAtL1: false, effects: [{ stat: 'flak.split', add: 3 }], apexArtKey: 'bld-flak-apex' },
  { id: 'p_living', name: 'Living Wall', desc: 'Walls regrow from rubble: destroyed barricades rebuild free at dawn.', directive: 'bul_mend', building: 'plate_barricade', count: 8, openAtL1: false, effects: [{ stat: 'wall.dawnRebuild', add: 1 }], apexArtKey: 'bld-wall-apex' },
  { id: 'p_slag', name: 'Slag Furnace', desc: 'Waste heat warms the block: lit tiles within 2 of a smelter cost no upkeep.', directive: 'forge_pour', building: 'alloy_smelter', count: 4, openAtL1: false, effects: [{ stat: 'smelter.heatFreeRadius', add: 2 }], apexArtKey: 'bld-smelter-apex' },
  { id: 'p_focus', name: 'Focus Array', desc: 'Lenses cut by lenses: Prism Cutter rate × 2.', directive: 'forge_lens', building: 'prism_cutter', count: 3, openAtL1: false, effects: [{ stat: 'cutter.rate', mul: 1 }], apexArtKey: 'bld-cutter-apex' },
  { id: 'p_lumen', name: 'Lumen Forge', desc: 'Two cells sealed per breath: foundries output 2 cells per cycle.', directive: 'forge_cell', building: 'lumen_foundry', count: 2, openAtL1: false, effects: [{ stat: 'foundry.cellsPerCycle', add: 1 }], apexArtKey: 'bld-foundry-apex' },
  { id: 'p_silent', name: 'Silent Bore', desc: 'Rigs that make no sound: extractor noise 0.', directive: 'fr_muffle', building: 'extractors', count: 8, openAtL1: false, effects: [{ stat: 'extract.noise', mul: -1 }], apexArtKey: 'badge-silent' },
  { id: 'p_geode', name: 'Geode Rig', desc: 'Saws tuned to the crystal: Aurel Harvester rate × 2.', directive: 'forge_assay', building: 'aurel_harvester', count: 4, openAtL1: false, effects: [{ stat: 'harvester.rate', mul: 1 }], apexArtKey: 'bld-harvester-apex' },
  { id: 'p_infirm', name: 'Infirmary', desc: 'The commons becomes a ward: colonist deaths −75 % (cold and attack).', directive: 'kin_medics', building: 'hearth_commons', count: 2, openAtL1: false, effects: [{ stat: 'colonist.deathRate', mul: -0.75 }], apexArtKey: 'bld-commons-apex' },
  { id: 'p_choir', name: 'Choir Spire', desc: 'The Spire sings back: while charging, 200 damage to fauna within 6 tiles every 8 s.', directive: 'orb_resonant', building: 'beacon_spire', count: 1, openAtL1: false, effects: [{ stat: 'beacon.choirDamage', add: 200 }], apexArtKey: 'bld-beacon-apex' },
  { id: 'p_exchange', name: 'Orbital Exchange', desc: 'Freight ships itself: goods orders auto-ship at dawn; Data +25 %.', directive: 'orb_manifest', building: 'cargo_silo', count: 3, openAtL1: false, effects: [{ stat: 'request.autoShip', add: 1 }, { stat: 'request.data', mul: 0.25 }], apexArtKey: 'bld-silo-apex' },
];
