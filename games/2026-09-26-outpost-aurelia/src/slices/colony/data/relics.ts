/**
 * Relic Sites (PRD §5.2): 13 per Frontier map, claimed when the Lit Grid first
 * covers the tile. Owned by ContentDev (W3); shapes frozen in `./types.ts`.
 * Texture: the `relics` sheet frame in row order (`art/wiring.md` §3).
 */
import type { RelicDef } from './types';

export const RELICS: readonly RelicDef[] = [
  { id: 'relic_cache', name: 'Probe Wreck', desc: 'A pre-colony survey probe, cargo intact: +60 Fe, +15 alloy.', count: 5, minDistTiles: 8, firstSol: 1, grant: { stock: { ferrite: 60, alloy: 15 } } },
  { id: 'relic_monolith', name: 'Chorus Stone', desc: 'A glassy monolith that sings at night: +1 draft reroll.', count: 3, minDistTiles: 12, firstSol: 2, grant: { rerolls: 1 } },
  { id: 'relic_archive', name: 'Signal Buoy', desc: 'A beacon from a lost Ark, still transmitting: +15 Data.', count: 3, minDistTiles: 14, firstSol: 3, grant: { data: 15 } },
  { id: 'relic_geode', name: 'Hollow Geode', desc: 'A split geode lined with ready-cut prisms: +12 prism.', count: 2, minDistTiles: 16, firstSol: 4, grant: { stock: { prism: 12 } } },
];
