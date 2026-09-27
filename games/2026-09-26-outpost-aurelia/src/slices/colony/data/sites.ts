/**
 * Landing sites (PRD §5.4): 8 sites over 4 biomes, unlocked by total stars.
 * Owned by ContentDev (W3); shapes frozen in `./types.ts`.
 * Postcard texture = `postcard-<id>` (`art/wiring.md` §10); ids match it.
 * Severity rungs are global rules (§5.4), not per-site rows.
 */
import type { FaunaId, SiteDef } from './types';

/** PRD §5.4 Aurora Rift: every non-alpha fauna joins from night 3 (skitters and lobbers already do). */
const AURORA_EARLY: SiteDef['earlyFauna'] = (['brute', 'moth', 'burrower', 'sapper', 'bloater', 'howler'] as const satisfies readonly FaunaId[]).map((id) => ({ id, fromSol: 3 }));

export const SITES: readonly SiteDef[] = [
  { id: 'halcyon', name: 'Halcyon Flats', desc: "Glass Steppe: mild plains, the Ark's first choice.", biome: 'steppe', starsToUnlock: 0, requiresNode: null, tempOffsetC: 0, dataMul: 1, depositMul: {}, purityShift: {}, ceilingMul: {}, noiseMul: 1, extraMatronSol: null, chokepoints: false, chorusMul: 1, earlyFauna: [] },
  { id: 'prism_reach', name: 'Prism Reach', desc: 'Glass Steppe: crystal forests under violet skies. Crystal ×1.5, moths +50 %.', biome: 'steppe', starsToUnlock: 2, requiresNode: null, tempOffsetC: 0, dataMul: 1.05, depositMul: { crystal: 1.5 }, purityShift: {}, ceilingMul: { moth: 1.5 }, noiseMul: 1, extraMatronSol: null, chokepoints: false, chorusMul: 1, earlyFauna: [] },
  { id: 'rimewater', name: 'Rimewater', desc: 'Rime Basin: frozen lakes over pure ice. −10 °C, ice one purity richer.', biome: 'rime', starsToUnlock: 4, requiresNode: null, tempOffsetC: -10, dataMul: 1.1, depositMul: {}, purityShift: { ice: 1 }, ceilingMul: {}, noiseMul: 1, extraMatronSol: null, chokepoints: false, chorusMul: 1, earlyFauna: [] },
  { id: 'cinder_fen', name: 'Cinder Fen', desc: 'Ember Mire: a steaming marsh riddled with vents. Vents ×2, noise ×1.25, bloats ×2.', biome: 'mire', starsToUnlock: 6, requiresNode: null, tempOffsetC: 0, dataMul: 1.1, depositMul: { vent: 2 }, purityShift: {}, ceilingMul: { bloater: 2 }, noiseMul: 1.25, extraMatronSol: null, chokepoints: false, chorusMul: 1, earlyFauna: [] },
  { id: 'frostcrown', name: 'Frostcrown', desc: 'Rime Basin: a caldera rim at the edge of life. −18 °C, 2 vents, rams ×1.5.', biome: 'rime', starsToUnlock: 9, requiresNode: null, tempOffsetC: -18, dataMul: 1.2, depositMul: { vent: 0.4 }, purityShift: {}, ceilingMul: { brute: 1.5 }, noiseMul: 1, extraMatronSol: null, chokepoints: false, chorusMul: 1, earlyFauna: [] },
  { id: 'sulfur_hollow', name: 'Sulfur Hollow', desc: 'Ember Mire: yellow sinks where grubs nest. Ore one purity richer, leeches ×1.5, grubs from night 4.', biome: 'mire', starsToUnlock: 12, requiresNode: null, tempOffsetC: 0, dataMul: 1.2, depositMul: {}, purityShift: { ore: 1 }, ceilingMul: { sapper: 1.5 }, noiseMul: 1, extraMatronSol: null, chokepoints: false, chorusMul: 1, earlyFauna: [{ id: 'burrower', fromSol: 4 }] },
  { id: 'nacre_shelf', name: 'Nacre Shelf', desc: 'Nacre Coast: pearl cliffs cut by narrow passes. An extra Matron on night 4.', biome: 'nacre', starsToUnlock: 15, requiresNode: null, tempOffsetC: 0, dataMul: 1.25, depositMul: {}, purityShift: {}, ceilingMul: {}, noiseMul: 1, extraMatronSol: 4, chokepoints: true, chorusMul: 1, earlyFauna: [] },
  { id: 'aurora_rift', name: 'Aurora Rift', desc: 'Nacre Coast: the rift where the Chorus is born. −12 °C, Data ×1.5, all fauna from night 3, Chorus ×1.25.', biome: 'nacre', starsToUnlock: 20, requiresNode: 'sur_charts', tempOffsetC: -12, dataMul: 1.5, depositMul: {}, purityShift: {}, ceilingMul: {}, noiseMul: 1, extraMatronSol: null, chokepoints: false, chorusMul: 1.25, earlyFauna: AURORA_EARLY },
];
