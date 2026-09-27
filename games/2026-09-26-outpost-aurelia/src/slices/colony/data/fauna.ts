/**
 * Fauna rows (PRD §5.2): 8 species + 2 alphas.
 * Owned by ContentDev (W3); shapes frozen in `./types.ts`.
 *
 * `rangeTiles` means, per behaviour (threat/ reads it this way): shell =
 * firing range, burst = death AoE radius, rally = aura radius, titan = stomp
 * radius, burrow = tiles travelled inside the field before surfacing; 0
 * otherwise. `dps` is sustained damage (titan: 60 per stomp / 5 s = 12).
 * `artKey` is the walk texture (`art/wiring.md` §6); `sizePx` the long edge.
 */
import type { FaunaDef, FaunaId } from './types';

export const FAUNA: readonly FaunaDef[] = [
  { id: 'skitter', name: 'Glass Skitter', desc: 'A hand-sized chitin runner with lens eyes. Chews the first building in its path.', hp: 30, dps: 8, speedPx: 96, flying: false, wallMul: 1, rangeTiles: 0, sizePx: 64, rank: 'trash', artKey: 'fauna-skitter', behaviour: 'chew' },
  { id: 'spitter', name: 'Acid Lobber', desc: 'A bloated sac that arcs acid at towers from 3 tiles. Flak outranges it.', hp: 45, dps: 10 / 1.5, speedPx: 64, flying: false, wallMul: 1, rangeTiles: 3, sizePx: 72, rank: 'trash', artKey: 'fauna-spitter', behaviour: 'shell' },
  { id: 'brute', name: 'Carapace Ram', desc: 'A plated beetle the size of a rover. Triple damage to walls.', hp: 380, dps: 30, speedPx: 40, flying: false, wallMul: 3, rangeTiles: 0, sizePx: 112, rank: 'elite', artKey: 'fauna-brute', behaviour: 'ram' },
  { id: 'moth', name: 'Lumen Moth', desc: 'A pale flier drawn to lamplight. Ignores walls, hunts relays.', hp: 40, dps: 6, speedPx: 110, flying: true, wallMul: 1, rangeTiles: 0, sizePx: 72, rank: 'trash', artKey: 'fauna-moth', behaviour: 'lamp' },
  { id: 'burrower', name: 'Tunnel Grub', desc: 'A blind digger that surfaces inside the walls, beside a building.', hp: 90, dps: 12, speedPx: 60, flying: false, wallMul: 1, rangeTiles: 4, sizePx: 72, rank: 'trash', artKey: 'fauna-grub', behaviour: 'burrow' },
  { id: 'sapper', name: 'Static Leech', desc: 'A flat parasite that drinks current. Its relay goes dark; banks drain.', hp: 70, dps: 0, speedPx: 70, flying: false, wallMul: 1, rangeTiles: 0, sizePx: 64, rank: 'trash', artKey: 'fauna-leech', behaviour: 'latch' },
  { id: 'bloater', name: 'Spore Bloat', desc: 'A drifting gas-sac. Bursts for 40 damage and 4 skitters when killed.', hp: 120, dps: 4, speedPx: 45, flying: false, wallMul: 1, rangeTiles: 1.5, sizePx: 96, rank: 'elite', artKey: 'fauna-bloat', behaviour: 'burst' },
  { id: 'howler', name: 'Dusk Howler', desc: 'A long-necked caller. Nearby fauna run 30 % faster and bite 20 % harder.', hp: 160, dps: 0, speedPx: 55, flying: false, wallMul: 1, rangeTiles: 3, sizePx: 88, rank: 'elite', artKey: 'fauna-howler', behaviour: 'rally' },
  { id: 'matron', name: 'Hive Matron', desc: 'A crowned brood-queen dragging her nest. Spawns 3 skitters every 6 s.', hp: 2000, dps: 45, speedPx: 48, flying: false, wallMul: 1, rangeTiles: 0, sizePx: 176, rank: 'alpha', artKey: 'fauna-matron', behaviour: 'brood' },
  { id: 'titan', name: 'Chorus Titan', desc: 'A choir-throated colossus that beelines for the Beacon Spire.', hp: 8000, dps: 12, speedPx: 26, flying: false, wallMul: 2, rangeTiles: 2, sizePx: 256, rank: 'alpha', artKey: 'fauna-titan', behaviour: 'titan' },
];

const FAUNA_INDEX: Partial<Record<FaunaId, FaunaDef>> = Object.fromEntries(FAUNA.map((f) => [f.id, f]));

export function faunaDef(id: FaunaId): FaunaDef {
  const def = FAUNA_INDEX[id];
  if (def === undefined) throw new Error(`colony: no fauna row '${id}'`);
  return def;
}
