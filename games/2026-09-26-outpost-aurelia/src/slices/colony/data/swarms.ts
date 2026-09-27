/**
 * Nightly swarm ceilings (PRD §5.4), the Long Night drip and the Chorus.
 * Owned by ContentDev (W3); shapes frozen in `./types.ts`.
 *
 * Spawned count = ceil(ceiling × swarmScale) per row (alphas never scaled);
 * from sol 2 `threat/swarm.ts:planNight` peels ≈ 25 % of the trash onto an
 * off-axis edge (critic2 #3), so `edges` here is the telegraphed main count.
 * `atSec` = dusk start.
 */
import { COLONY_TUNING } from '../tuning';
import type { SwarmNight } from './types';

export const SWARM_NIGHTS: readonly SwarmNight[] = [
  { sol: 1, atSec: 50, edges: 1, label: 'Night 1', spawns: [{ id: 'skitter', count: 12 }], alpha: null },
  { sol: 2, atSec: 100, edges: 1, label: 'Night 2', spawns: [{ id: 'skitter', count: 20 }, { id: 'spitter', count: 4 }], alpha: null },
  { sol: 3, atSec: 152, edges: 1, label: 'Night 3', spawns: [{ id: 'skitter', count: 20 }, { id: 'spitter', count: 4 }, { id: 'brute', count: 1 }], alpha: null },
  { sol: 4, atSec: 206, edges: 2, label: 'Night 4', spawns: [{ id: 'skitter', count: 24 }, { id: 'spitter', count: 5 }, { id: 'brute', count: 3 }], alpha: null },
  { sol: 5, atSec: 262, edges: 2, label: 'Matron', spawns: [{ id: 'skitter', count: 20 }, { id: 'moth', count: 6 }, { id: 'spitter', count: 4 }], alpha: 'matron' },
  { sol: 6, atSec: 320, edges: 2, label: 'Night 6', spawns: [{ id: 'skitter', count: 24 }, { id: 'moth', count: 8 }, { id: 'burrower', count: 4 }, { id: 'brute', count: 3 }, { id: 'howler', count: 2 }], alpha: null },
  { sol: 7, atSec: 380, edges: 3, label: 'Night 7', spawns: [{ id: 'skitter', count: 28 }, { id: 'sapper', count: 6 }, { id: 'spitter', count: 6 }, { id: 'bloater', count: 4 }, { id: 'brute', count: 3 }], alpha: null },
  { sol: 8, atSec: 442, edges: 3, label: 'Night 8', spawns: [{ id: 'skitter', count: 32 }, { id: 'moth', count: 10 }, { id: 'burrower', count: 6 }, { id: 'brute', count: 4 }, { id: 'sapper', count: 4 }, { id: 'howler', count: 3 }], alpha: null },
  { sol: 9, atSec: 506, edges: 3, label: 'Deep Cold', spawns: [{ id: 'skitter', count: 36 }, { id: 'moth', count: 10 }, { id: 'bloater', count: 6 }, { id: 'brute', count: 3 }, { id: 'spitter', count: 6 }], alpha: 'matron' },
];

const SW = COLONY_TUNING.swarm;
const LONG_NIGHT_SEC = COLONY_TUNING.sol.longNightDeadlineSec;

/** Sol 10 Long Night drip from all 4 edges: 1 skitter / 0.8 s + 1 ram / 12 s until the Landing ends. */
export const LONG_NIGHT: SwarmNight = {
  sol: 10,
  atSec: 572,
  edges: 4,
  label: 'Long Night',
  spawns: [
    { id: 'skitter', count: Math.floor(LONG_NIGHT_SEC / SW.longNightSkitterEverySec) },
    { id: 'brute', count: Math.floor(LONG_NIGHT_SEC / SW.longNightBruteEverySec) },
  ],
  alpha: null,
};

/** The Chorus on BEACON trigger (`atSec` 0 = on trigger): 4 edges over `swarm.chorusSec`, Titan at +`swarm.titanDelaySec`. */
export const CHORUS: SwarmNight = {
  sol: 10,
  atSec: 0,
  edges: 4,
  label: 'Chorus',
  spawns: [
    { id: 'skitter', count: SW.chorus.skitter },
    { id: 'brute', count: SW.chorus.brute },
    { id: 'moth', count: 12 },
    { id: 'sapper', count: 8 },
  ],
  alpha: 'titan',
};
