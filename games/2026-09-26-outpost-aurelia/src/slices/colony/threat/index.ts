/**
 * `createThreat` — the §16.1 `ThreatPort` the director drives: swarm plans
 * (with the off-axis trickle router), edge spawns 10 tiles past the lit field,
 * the fauna sim and turret defense behind one object. Phaser-free.
 */
import type { Rng } from '../../../core/rng';
import { COLONY_TUNING } from '../tuning';
import { faunaDef, type Edge, type FaunaId, type SwarmNight } from '../content';
import type { CreateThreat, NightPlan, ThreatPort } from '../contracts';
import type { ColonyState } from '../model/state';
import { FaunaSim } from './fauna';
import { buildCoreFlow } from './nav';
import { SwarmRouter } from './swarm';
import { Defense } from './defense';

export interface ColonyThreat extends ThreatPort {
  readonly fauna: FaunaSim;
}

const TILE = COLONY_TUNING.map.tilePx;
const LANES: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** `CreateThreat` (contracts.ts) plus the pooled fauna the view draws. */
export const createThreat = (state: ColonyState, rng: Rng): ColonyThreat => {
  const map = state.map;
  const nav = buildCoreFlow(map);
  const fauna = new FaunaSim(nav, rng, state);
  const defense = new Defense(state, fauna);
  const router = new SwarmRouter();
  const beyond = COLONY_TUNING.swarm.spawnBeyondFieldTiles;
  /** A point `spawnBeyondFieldTiles` past the lit edge on a lane toward `edge`; walkers need a path (or open ground outside the nav window). */
  const edgePoint = (edge: Edge, flying: boolean): { x: number; y: number } => {
    const [dx, dy] = LANES[edge] ?? [0, -1];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const lateral = rng.int(-6, 6);
      const baseCol = map.core.col + (dy !== 0 ? lateral : 0);
      const baseRow = map.core.row + (dx !== 0 ? lateral : 0);
      let lastLit = 0;
      for (let k = 0; k < Math.max(map.cols, map.rows); k += 1) {
        const c = baseCol + dx * k;
        const r = baseRow + dy * k;
        if (c < 0 || r < 0 || c >= map.cols || r >= map.rows) break;
        if (state.lit[r * map.cols + c] === 1) lastLit = k;
      }
      const k = lastLit + beyond;
      const col = Math.max(0, Math.min(map.cols - 1, baseCol + dx * k));
      const row = Math.max(0, Math.min(map.rows - 1, baseRow + dy * k));
      const outsideWindow = map.navWindow > 0 && Math.max(Math.abs(col - map.core.col), Math.abs(row - map.core.row)) > map.navWindow;
      const ok = flying || nav.pathExists(col, row) || (outsideWindow && !nav.isBlocked(col, row));
      if (!ok) continue;
      return { x: (col + 0.5) * TILE + rng.float(-16, 16), y: (row + 0.5) * TILE + rng.float(-16, 16) };
    }
    return { x: (map.core.col + 0.5) * TILE, y: TILE / 2 };
  };
  return {
    fauna,
    planNight: (night: SwarmNight, scale: number, loudest: Edge, r: Rng): NightPlan => router.planNight(night, scale, loudest, r, state.site, state.rung),
    planLongNight: (): NightPlan => router.planLongNight(),
    planChorus: (scaleMul: number): NightPlan => router.planChorus(scaleMul, state.site),
    spawn(id: FaunaId, edge: Edge, difficultyMul: number): void {
      const p = edgePoint(router.route(edge), faunaDef(id).flying);
      fauna.spawnAt(id, p.x, p.y, difficultyMul);
    },
    retreat(): void {
      fauna.retreat();
    },
    tick(dtSec: number): void {
      fauna.tick(dtSec);
      defense.tick(dtSec);
    },
    get liveCount(): number {
      return fauna.liveCount;
    },
  };
};

// Compile-time proof that the factory honours the frozen seam signature.
createThreat satisfies CreateThreat;
