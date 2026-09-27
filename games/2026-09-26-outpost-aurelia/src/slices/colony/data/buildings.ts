/**
 * Building rows (PRD §5.2, Mk I stats) + dock / build-sheet / staffing order.
 * Owned by ContentDev (W3); shapes frozen in `./types.ts`.
 *
 * Mk II / Mk III are rules, not rows: cost × `production.mkCostMul`, rate and
 * turret damage × `production.mkRateMul`, hp × `production.mkHpMul`
 * (`COLONY_TUNING`, read by the model). `artKey` is the Mk I texture
 * (`art/wiring.md` §1 stem table: `<stem>-mk1`; Mk II reuses it with rank
 * pips, Mk III is `<stem>-mk3`); `iconKey` is the icon frame name `ico-<stem>`.
 */
import type { BuildingDef, BuildingId } from './types';

type RowInput = Omit<BuildingDef, 'artKey' | 'iconKey' | 'storeKj' | 'turret' | 'recipe' | 'deposit' | 'kwOut' | 'dayOnly' | 'beds' | 'storage' | 'fieldRadius'> &
  Partial<BuildingDef> & { stem: string };

function row(input: RowInput): BuildingDef {
  const { stem, ...def } = input;
  return {
    deposit: null,
    recipe: null,
    kwOut: 0,
    dayOnly: false,
    storeKj: 0,
    beds: 0,
    storage: 0,
    fieldRadius: 0,
    turret: null,
    artKey: `bld-${stem}-mk1`,
    iconKey: `ico-${stem}`,
    ...def,
  };
}

/** The 20 building rows (PRD §5.2 Mk I; alloy shares amended for critic2 #1, see §18). */
export const BUILDINGS: readonly BuildingDef[] = [
  row({ id: 'lander_core', stem: 'core', artKey: 'bld-core', name: 'Lander Core', desc: 'The ship that became the town square. Powers, heats, stores and berths 6 sleepers; lose it and the Landing ends.', category: 'core', footprint: 3, cost: {}, workers: 0, kw: 0, noise: 1, hp: 3000, unlockSol: 99, kwOut: 8, storage: 200, fieldRadius: 6, beds: 6 }),

  // extract
  row({ id: 'ferrite_drill', stem: 'drill', name: 'Ferrite Drill', desc: 'A piston rig hammering the seam. 1 Fe/s on a normal ore seam.', category: 'extract', footprint: 2, cost: { ferrite: 12 }, workers: 1, kw: 0.5, noise: 1, hp: 360, unlockSol: 1, deposit: 'ore', recipe: { inputs: {}, outputs: { ferrite: 1 }, cycleSec: 1 } }),
  row({ id: 'rime_borer', stem: 'borer', name: 'Rime Borer', desc: 'A heated screw that sips the ice. 1 ice/s on a normal lens; feeds one terrace.', category: 'extract', footprint: 2, cost: { ferrite: 12 }, workers: 1, kw: 0.5, noise: 1, hp: 360, unlockSol: 1, deposit: 'ice', recipe: { inputs: {}, outputs: { ice: 1 }, cycleSec: 1 } }),
  row({ id: 'aurel_harvester', stem: 'harvester', name: 'Aurel Harvester', desc: 'Singing saws that coax crystal loose. 1 aurelite / 2 s on a normal geode.', category: 'extract', footprint: 2, cost: { ferrite: 40, alloy: 5 }, workers: 1, kw: 0.5, noise: 1, hp: 360, unlockSol: 3, deposit: 'crystal', recipe: { inputs: {}, outputs: { aurelite: 1 }, cycleSec: 2 } }),

  // power
  row({ id: 'vent_tap', stem: 'venttap', name: 'Vent Tap', desc: 'A turbine capping a breathing fissure. +4 kW day and night on a normal vent.', category: 'power', footprint: 2, cost: { ferrite: 36, alloy: 6 }, workers: 0, kw: 0, noise: 2, hp: 450, unlockSol: 1, deposit: 'vent', kwOut: 4 }),
  row({ id: 'sun_sail', stem: 'sail', name: 'Sun Sail', desc: 'Gold foil petals tracking a pale sun. +4 kW by day, nothing at night.', category: 'power', footprint: 2, cost: { ferrite: 15 }, workers: 0, kw: 0, noise: 0, hp: 160, unlockSol: 1, kwOut: 4, dayOnly: true }),
  row({ id: 'charge_bank', stem: 'bank', name: 'Charge Bank', desc: 'Racked cells that drink the daylight. Stores 60 kJ, gives up to 6 kW at night.', category: 'power', footprint: 2, cost: { ferrite: 40, alloy: 5 }, workers: 0, kw: 0, noise: 0, hp: 200, unlockSol: 2, storeKj: 60, kwOut: 6 }),

  // process
  row({ id: 'hydro_terrace', stem: 'farm', name: 'Hydro Terrace', desc: 'Stacked green trays under amber lamps. 2 ice → 1 ration / 2 s; feeds 10 colonists.', category: 'process', footprint: 2, cost: { ferrite: 20 }, workers: 2, kw: 0.5, noise: 0, hp: 200, unlockSol: 1, recipe: { inputs: { ice: 2 }, outputs: { rations: 1 }, cycleSec: 2 } }),
  row({ id: 'alloy_smelter', stem: 'smelter', name: 'Alloy Smelter', desc: 'A squat crucible glowing ember-orange. 2 Fe → 1 alloy / s with one crew.', category: 'process', footprint: 2, cost: { ferrite: 30 }, workers: 1, kw: 2, noise: 2, hp: 260, unlockSol: 2, recipe: { inputs: { ferrite: 2 }, outputs: { alloy: 1 }, cycleSec: 1 } }),
  row({ id: 'prism_cutter', stem: 'cutter', name: 'Prism Cutter', desc: 'Water-jets grinding crystal into lenses. 1 aurelite → 1 prism / 2 s.', category: 'process', footprint: 2, cost: { ferrite: 20, alloy: 12 }, workers: 2, kw: 2, noise: 2, hp: 240, unlockSol: 3, recipe: { inputs: { aurelite: 1 }, outputs: { prism: 1 }, cycleSec: 2 } }),
  row({ id: 'lumen_foundry', stem: 'foundry', name: 'Lumen Foundry', desc: 'A clean-room dome sealing dusk in cells. 2 alloy + 1 prism → 1 cell / 4 s.', category: 'process', footprint: 2, cost: { alloy: 30, prism: 5 }, workers: 2, kw: 3, noise: 3, hp: 300, unlockSol: 6, recipe: { inputs: { alloy: 2, prism: 1 }, outputs: { cell: 1 }, cycleSec: 4 } }),

  // logistics
  row({ id: 'relay_pylon', stem: 'relay', name: 'Relay Pylon', desc: 'A lamp-mast that carries the grid onward. Lights r4; must stand inside the field.', category: 'logistics', footprint: 1, cost: { ferrite: 10 }, workers: 0, kw: 0.2, noise: 0, hp: 300, unlockSol: 1, fieldRadius: 4 }),
  row({ id: 'cargo_silo', stem: 'silo', name: 'Cargo Silo', desc: 'Ribbed tanks where drones set down. +150 storage for every good.', category: 'logistics', footprint: 2, cost: { ferrite: 30 }, workers: 0, kw: 0, noise: 0, hp: 260, unlockSol: 2, storage: 150 }),

  // housing
  row({ id: 'hab_dome', stem: 'hab', name: 'Hab Dome', desc: 'A pressurised bubble of warm windows. 6 beds; dark at night, residents freeze.', category: 'housing', footprint: 2, cost: { ferrite: 20, alloy: 5 }, workers: 0, kw: 0.3, noise: 0, hp: 330, unlockSol: 1, beds: 6 }),
  row({ id: 'hearth_commons', stem: 'commons', name: 'Hearth Commons', desc: 'Mess hall and music under one lamp. +4 morale every dawn (3 count).', category: 'housing', footprint: 2, cost: { ferrite: 30, alloy: 20 }, workers: 1, kw: 0.5, noise: 0, hp: 220, unlockSol: 4 }),

  // defense
  row({ id: 'pulse_turret', stem: 'pulse', name: 'Pulse Turret', desc: 'A twin-barrel emitter spitting amber bolts. 28 dps at 5.5 tiles, half vs fliers.', category: 'defense', footprint: 1, cost: { ferrite: 20, alloy: 5 }, workers: 0, kw: 0.5, noise: 0.5, hp: 220, unlockSol: 1, turret: { rangeTiles: 5.5, minRangeTiles: 0, damage: 14, cooldownSec: 0.5, chain: 0, splashTiles: 0, hitsAir: true, airMul: 0.5 } }),
  row({ id: 'arc_coil', stem: 'arc', name: 'Arc Coil', desc: 'A copper coil whose lightning leaps. 22 dmg chaining to 3 at 3.5 tiles; hits fliers.', category: 'defense', footprint: 2, cost: { ferrite: 30, alloy: 20, prism: 5 }, workers: 0, kw: 2, noise: 1, hp: 300, unlockSol: 3, turret: { rangeTiles: 3.5, minRangeTiles: 0, damage: 22, cooldownSec: 0.9, chain: 3, splashTiles: 0, hitsAir: true, airMul: 1 } }),
  row({ id: 'flak_mortar', stem: 'flak', name: 'Flak Mortar', desc: 'A stubby tube lobbing glass shrapnel. 30 splash at 2-7 tiles; ×1.5 vs fliers.', category: 'defense', footprint: 2, cost: { ferrite: 40, alloy: 30, prism: 10 }, workers: 0, kw: 1.5, noise: 1.5, hp: 280, unlockSol: 4, turret: { rangeTiles: 7, minRangeTiles: 2, damage: 30, cooldownSec: 1.6, chain: 0, splashTiles: 1.2, hitsAir: true, airMul: 1.5 } }),
  row({ id: 'plate_barricade', stem: 'wall', name: 'Plate Barricade', desc: 'Riveted hull plate stood on end. 400 hp that fauna must chew through.', category: 'defense', footprint: 1, cost: { ferrite: 10 }, workers: 0, kw: 0, noise: 0, hp: 400, unlockSol: 1 }),

  // beacon
  row({ id: 'beacon_spire', stem: 'beacon', artKey: 'bld-beacon', name: 'Beacon Spire', desc: 'A needle of prisms that sings to orbit. 12 cells + 5 kW for 60 s calls the Ark.', category: 'beacon', footprint: 3, cost: { alloy: 100, prism: 20 }, workers: 0, kw: 0, noise: 0, hp: 2400, unlockSol: 6 }),
];

const BUILDING_INDEX: Partial<Record<BuildingId, BuildingDef>> = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));

export function buildingDef(id: BuildingId): BuildingDef {
  const def = BUILDING_INDEX[id];
  if (def === undefined) throw new Error(`colony: no building row '${id}'`);
  return def;
}

/** Staffing priority (PRD §5.1): terrace → borer → other extractors → smelter → cutter → commons → foundry. */
export const STAFF_PRIORITY: readonly BuildingId[] = [
  'hydro_terrace', 'rime_borer', 'ferrite_drill', 'aurel_harvester', 'alloy_smelter', 'prism_cutter', 'hearth_commons', 'lumen_foundry',
];

/** Buildings the dock shows (slots 1-5); the rest sit behind ALL. */
export const DOCK_DEFAULT: readonly BuildingId[] = ['ferrite_drill', 'rime_borer', 'sun_sail', 'relay_pylon', 'pulse_turret'];

/** Build sheet order: extract, power, process, logistics, housing, defense, beacon (every placeable row). */
export const BUILD_SHEET: readonly BuildingId[] = [
  'ferrite_drill', 'rime_borer', 'aurel_harvester',
  'vent_tap', 'sun_sail', 'charge_bank',
  'hydro_terrace', 'alloy_smelter', 'prism_cutter', 'lumen_foundry',
  'relay_pylon', 'cargo_silo',
  'hab_dome', 'hearth_commons',
  'pulse_turret', 'arc_coil', 'flak_mortar', 'plate_barricade',
  'beacon_spire',
];
