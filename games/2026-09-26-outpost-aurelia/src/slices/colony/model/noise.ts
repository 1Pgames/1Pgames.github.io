/**
 * Industry noise (PRD §4 Noise, §7 noise.*): lit buildings' noise sums into
 * the night's swarm scale and biases the spawn edge to the loudest quadrant.
 * Directive / protocol stats (`extract.noise`, `smelter.noise`,
 * `venttap.noise`) and the site's `noiseMul` shape each building's share.
 */
import { COLONY_TUNING } from '../tuning';
import { buildingDef } from '../content';
import { colonyStat } from './modifiers';
import { mkIndex } from './production';
import type { BuildingInst, ColonyState } from './state';

/** Noise × `noise.mkMul` per Mk above I (PRD §5.2). */
const MK_NOISE = COLONY_TUNING.noise.mkMul;

/** One lit building's noise after Mk, stats and the site multiplier. */
function buildingNoise(state: ColonyState, b: BuildingInst): number {
  const def = buildingDef(b.def);
  let n = def.noise * MK_NOISE ** mkIndex(b.mk);
  if (b.def === 'vent_tap') n = colonyStat(state, 'venttap.noise', n);
  else if (def.deposit !== null) n = colonyStat(state, 'extract.noise', n);
  else if (b.def === 'alloy_smelter') n = colonyStat(state, 'smelter.noise', n);
  return Math.max(0, n) * state.site.noiseMul;
}

export function noiseSum(state: ColonyState): number {
  let sum = 0;
  for (const b of state.buildings.values()) {
    if (!b.lit || b.paused) continue;
    sum += buildingNoise(state, b);
  }
  return sum;
}

export function swarmScale(state: ColonyState, sol: number): number {
  const N = COLONY_TUNING.noise;
  const cap = N.capBase + N.capPerSol * sol;
  // PRD §5.4: 0.40 + 0.60 × min(1, noise / (8 + 4 × sol)).
  return N.scaleFloor + (1 - N.scaleFloor) * Math.min(1, noiseSum(state) / cap);
}

/** Edge index 0 north, 1 east, 2 south, 3 west — whichever quadrant carries the most noise. */
export function loudestQuadrant(state: ColonyState): 0 | 1 | 2 | 3 {
  const q = [0, 0, 0, 0];
  const { core } = state.map;
  for (const b of state.buildings.values()) {
    if (b.def === 'lander_core' || !b.lit) continue;
    const c = state.centreOf(b);
    const dx = c.col - core.col;
    const dy = c.row - core.row;
    const edge = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
    q[edge] = (q[edge] ?? 0) + buildingNoise(state, b);
  }
  let best: 0 | 1 | 2 | 3 = 0;
  for (let i = 1 as 0 | 1 | 2 | 3; i < 4; i = (i + 1) as 0 | 1 | 2 | 3) if ((q[i] ?? 0) > (q[best] ?? 0)) best = i;
  return best;
}
