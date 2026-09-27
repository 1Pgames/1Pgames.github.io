/**
 * Dawn Directives (PRD §5.3): 36 rows, 17 open at L1; the other 19 unlock
 * through the Ark ring-1/2 charters (`data/ark.ts` `unlocks`).
 * Owned by ContentDev (W3); shapes frozen in `./types.ts`.
 * `desc` is the card's effect line; `iconKey` is the icon frame name `dir-<id>`.
 */
import type { DirectiveDef, Effect, TagId } from './types';

function dir(id: string, name: string, desc: string, tag: TagId, rarity: DirectiveDef['rarity'], openAtL1: boolean, effects: readonly Effect[]): DirectiveDef {
  return { id, name, desc, tag, rarity, openAtL1, effects, iconKey: `dir-${id}` };
}

export const DIRECTIVES: readonly DirectiveDef[] = [
  // hearth
  dir('hearth_insulate', 'Rime Lining', 'Foam the hulls: night heat upkeep −20 %.', 'hearth', 'standard', true, [{ stat: 'field.heatUpkeep', mul: -0.2 }]),
  dir('hearth_overdrive', 'Core Overdrive+', 'Overdrive lasts twice as long for half the stress.', 'hearth', 'standard', true, [{ stat: 'power.overdriveSec', mul: 1 }, { stat: 'power.overdriveStress', mul: -0.5 }]),
  dir('hearth_battery', 'Charge Discipline', 'Charge Banks hold +50 %.', 'hearth', 'standard', true, [{ stat: 'bank.capacity', mul: 0.5 }]),
  dir('hearth_vents', 'Deep Taps', 'Vent Taps +35 % kW.', 'hearth', 'prime', false, [{ stat: 'venttap.kw', mul: 0.35 }]),
  dir('hearth_sunward', 'Sunward Sails', 'Sun Sails +40 % kW and keep 25 % after dark.', 'hearth', 'standard', false, [{ stat: 'sail.kw', mul: 0.4 }, { stat: 'sail.nightShare', add: 0.25 }]),
  dir('hearth_dimming', 'Graceful Dimming', 'Relays shed 2× slower; dark buildings freeze 2× later.', 'hearth', 'prime', false, [{ stat: 'field.shedIntervalSec', mul: 1 }, { stat: 'field.freezeAfterSec', mul: 1 }]),
  // forge
  dir('forge_quota', 'Double Shift', 'Processors +25 % rate; morale −5 every dawn.', 'forge', 'standard', true, [{ stat: 'process.rate', mul: 0.25 }, { stat: 'morale.perDawn', add: -5 }]),
  dir('forge_parts', 'Standard Parts', 'Mk upgrades cost −40 %.', 'forge', 'standard', true, [{ stat: 'upgrade.cost', mul: -0.4 }]),
  dir('forge_assay', 'Assay Crews', 'Impure deposits yield as normal.', 'forge', 'standard', true, [{ stat: 'purity.impureFloor', add: 1 }]),
  dir('forge_pour', 'Hot Pour', 'Smelters +25 % rate, +1 noise each.', 'forge', 'prime', false, [{ stat: 'smelter.rate', mul: 0.25 }, { stat: 'smelter.noise', add: 1 }]),
  dir('forge_lens', 'Lens Grinders', 'Prism Cutters +30 % rate.', 'forge', 'standard', false, [{ stat: 'cutter.rate', mul: 0.3 }]),
  dir('forge_cell', 'Cell Line', 'Lumen Foundry cycles −25 % time.', 'forge', 'prime', false, [{ stat: 'foundry.cycleSec', mul: -0.25 }]),
  // bulwark
  dir('bul_plate', 'Plated Barricades', 'Barricades +60 % hp.', 'bulwark', 'standard', true, [{ stat: 'wall.hp', mul: 0.6 }]),
  dir('bul_pulse', 'Pulse Capacitors', 'Pulse Turrets +30 % damage.', 'bulwark', 'standard', true, [{ stat: 'pulse.damage', mul: 0.3 }]),
  dir('bul_arc', 'Arc Tuning', 'Arc Coils chain to 2 more targets.', 'bulwark', 'prime', false, [{ stat: 'arc.chain', add: 2 }]),
  dir('bul_flak', 'Airburst Fuse', 'Flak splash +40 %; +0.5× damage vs fliers.', 'bulwark', 'standard', false, [{ stat: 'flak.splash', mul: 0.4 }, { stat: 'flak.airMul', add: 0.5 }]),
  dir('bul_mend', 'Night Mend', 'Lit buildings regrow 1 % hp per second at night.', 'bulwark', 'prime', false, [{ stat: 'building.nightRegenPct', add: 1 }]),
  dir('bul_salvage', 'Chitin Salvage', '+1 Fe for every fauna killed.', 'bulwark', 'standard', true, [{ stat: 'kill.ferrite', add: 1 }]),
  // frontier
  dir('fr_relay', 'Long Relays', 'Relay light radius +1 tile.', 'frontier', 'standard', true, [{ stat: 'relay.radius', add: 1 }]),
  dir('fr_survey', 'Deep Survey', 'Fog reveal +4 tiles; every pure deposit pinged.', 'frontier', 'prime', false, [{ stat: 'fog.revealTiles', add: 4 }]),
  dir('fr_prefab', 'Prefab Frames', 'Relays and Hab Domes cost −40 %.', 'frontier', 'standard', true, [{ stat: 'relay.cost', mul: -0.4 }, { stat: 'hab.cost', mul: -0.4 }]),
  dir('fr_muffle', 'Muffled Drills', 'Extractor noise −50 %: smaller swarms.', 'frontier', 'standard', true, [{ stat: 'extract.noise', mul: -0.5 }]),
  dir('fr_sentry', 'Pylon Sentries', 'Every relay zaps fauna within 2.5 tiles (8 dps).', 'frontier', 'prime', false, [{ stat: 'relay.sentryDps', add: 8 }]),
  dir('fr_claim', 'Stake Claims', 'The first extractor on each pure deposit is free.', 'frontier', 'prime', false, [{ stat: 'extract.pureFirstFree', add: 1 }]),
  // kin
  dir('kin_hatch', 'Open Hatch', '+2 colonists wake every dawn.', 'kin', 'standard', true, [{ stat: 'arrivals', add: 2 }]),
  dir('kin_lean', 'Lean Rations', 'Ration use −25 %; morale −3 every dawn.', 'kin', 'standard', true, [{ stat: 'rations.use', mul: -0.25 }, { stat: 'morale.perDawn', add: -3 }]),
  dir('kin_songs', 'Hearth Songs', 'Hearth Commons give double morale.', 'kin', 'standard', false, [{ stat: 'commons.morale', mul: 1 }]),
  dir('kin_medics', 'Field Medics', 'Cold deaths in dark domes −50 %.', 'kin', 'standard', true, [{ stat: 'cold.deathRate', mul: -0.5 }]),
  dir('kin_rota', 'Auto-Rota', 'Processors need 1 fewer worker (min 1).', 'kin', 'prime', false, [{ stat: 'process.workers', add: -1 }]),
  dir('kin_pact', 'Kinship Pact', 'Morale never falls below 30.', 'kin', 'prime', false, [{ stat: 'morale.floor', add: 30 }]),
  // orbit
  dir('orb_manifest', 'Priority Manifest', 'Orbital Requests pay +50 % Data.', 'orbit', 'standard', true, [{ stat: 'request.data', mul: 0.5 }]),
  dir('orb_pods', 'Supply Pods', 'Every shipment returns +30 Fe and +10 alloy.', 'orbit', 'standard', true, [{ stat: 'request.bonusFe', add: 30 }, { stat: 'request.bonusAlloy', add: 10 }]),
  dir('orb_resonant', 'Resonant Spire', 'Beacon charges in 44 s instead of 60 s.', 'orbit', 'prime', false, [{ stat: 'beacon.chargeSec', mul: -0.27 }]),
  dir('orb_band', 'Wide Band', 'A 4th Orbital Request slot.', 'orbit', 'standard', false, [{ stat: 'request.slots', add: 1 }]),
  dir('orb_decoy', 'Decoy Beacons', 'The Chorus is 25 % smaller.', 'orbit', 'prime', false, [{ stat: 'chorus.scale', mul: -0.25 }]),
  dir('orb_window', 'Launch Window', 'Spire unlocks a sol early and costs −20 %.', 'orbit', 'prime', false, [{ stat: 'beacon.unlockSol', add: -1 }, { stat: 'beacon.cost', mul: -0.2 }]),
];
