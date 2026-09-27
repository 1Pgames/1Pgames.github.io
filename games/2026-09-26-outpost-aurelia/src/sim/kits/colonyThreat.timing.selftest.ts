// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/colonyThreat.timing.selftest.ts
//
// W2 threat wall-clock budgets, scaled by this runner's measured speed
// (`src/sim/calibrate.ts`; a raw ms gate is a statement about one machine):
//   generateSite  Frontier median ≤ 400 ms (Continent reported)
//   Chorus peak   180 fauna incl. the Titan (PRD §15 mix) against a defended
//                 colony: threat.tick (fauna + defense) mean ≤ 4 ms per 60 Hz frame
import assert from 'node:assert/strict';
import { Rng } from '../../core/rng';
import { KIT_NONE, SITES, buildingDef, type BuildingId, type FaunaId } from '../../slices/colony/content';
import { createColony, type ColonyState } from '../../slices/colony/model/state';
import { createThreat } from '../../slices/colony/threat/index';
import { generateSite } from '../../slices/colony/threat/terrain';
import { calibrateRunner, calibratedBudget, describeRunner } from '../calibrate';

const GEN_MEDIAN_BUDGET_MS = 400;
const TICK_MEAN_BUDGET_MS = 4;
const FRAMES = 600;

const site = SITES.find((s) => s.chokepoints) ?? SITES[0];
assert.ok(site !== undefined);

for (let i = 0; i < 3; i += 1) generateSite(site, 1, `warm-${i}`, 'frontier');
const runner = calibrateRunner();
console.log(describeRunner(runner));

const gen: number[] = [];
for (let i = 0; i < 15; i += 1) {
  const t = performance.now();
  generateSite(site, 1, `timing-${i}`, 'frontier');
  gen.push(performance.now() - t);
}
gen.sort((a, b) => a - b);
const genMedian = gen[Math.floor(gen.length / 2)] ?? 0;
const t0 = performance.now();
generateSite(site, 1, 'timing-continent', 'continent');
const continentMs = performance.now() - t0;
const genBudget = calibratedBudget(GEN_MEDIAN_BUDGET_MS, runner);
console.log(`generateSite ${site.id} frontier median ${genMedian.toFixed(1)} ms (max ${(gen[gen.length - 1] ?? 0).toFixed(1)}), continent ${continentMs.toFixed(1)} ms; budget ≤ ${genBudget.toFixed(0)} ms`);
assert.ok(genMedian <= genBudget, `frontier generation ${genMedian.toFixed(1)} ms > ${genBudget.toFixed(0)}`);

function put(state: ColonyState, def: BuildingId, dist: number, angle: number): void {
  const f = buildingDef(def).footprint;
  const { core, cols } = state.map;
  for (let d = dist; d < dist + 6; d += 0.5) {
    for (let a = 0; a < 64; a += 1) {
      const t = angle + (a * Math.PI * 2) / 64;
      const c = Math.round(core.col + Math.cos(t) * d);
      const r = Math.round(core.row + Math.sin(t) * d);
      let ok = true;
      for (let dr = 0; dr < f && ok; dr += 1) {
        for (let dc = 0; dc < f && ok; dc += 1) {
          const i = (r + dr) * cols + c + dc;
          ok = state.map.blocked[i] === 0 && state.occ[i] === 0 && state.depositAt[i] === 0 && state.lit[i] === 1;
        }
      }
      if (ok) {
        state.spawnBuilding(def, c, r);
        return;
      }
    }
  }
}

const state = createColony({ site, rung: 2, kit: KIT_NONE, seed: 'chorus-timing', size: 'frontier', ark: [], refit: 0, daily: false, ftue: false });
const core = state.core;
assert.ok(core !== undefined);
core.hp = 1e9;
core.maxHp = 1e9;
put(state, 'beacon_spire', 3, 4);
for (let a = 0; a < 8; a += 1) put(state, 'pulse_turret', 3.5, a * 0.785);
put(state, 'arc_coil', 4.5, 0.6);
put(state, 'arc_coil', 4.5, 3.6);
put(state, 'flak_mortar', 4.5, 2.4);
put(state, 'flak_mortar', 4.5, 5.2);
for (let a = 0; a < 4; a += 1) put(state, 'relay_pylon', 5.5, a * 1.57 + 0.3);
for (let a = 0; a < 40; a += 1) put(state, 'plate_barricade', 5.5, (a * Math.PI) / 20);
state.beacon = 'charging';

const threat = createThreat(state, new Rng('chorus-timing'));
// PRD §15 peak mix, 180 total including the Titan and a Matron.
const MIX: ReadonlyArray<[FaunaId, number]> = [
  ['skitter', 110], ['moth', 24], ['brute', 16], ['sapper', 8], ['spitter', 6], ['burrower', 4], ['bloater', 4], ['howler', 6], ['matron', 1], ['titan', 1],
];
const want = MIX.reduce((n, [, c]) => n + c, 0);
assert.equal(want, 180);
let k = 0;
for (const [id, count] of MIX) for (let i = 0; i < count; i += 1) threat.spawn(id, (k++ % 4) as 0 | 1 | 2 | 3, 3);
const dt = 1 / 60;
// Warm-up (JIT, pool) until the front reaches the walls; the measured window is the fight at 180 live.
for (let i = 0; i < 600; i += 1) threat.tick(dt, state);
let total = 0;
let peak = 0;
let minLive = Infinity;
let shots = 0;
const kills0 = state.kills;
for (let frame = 0; frame < FRAMES; frame += 1) {
  while (threat.liveCount < want) threat.spawn('skitter', (frame % 4) as 0 | 1 | 2 | 3, 3);
  minLive = Math.min(minLive, threat.liveCount);
  for (const fx of state.fx) if (fx.kind === 'shot') shots += 1;
  state.fx.length = 0;
  const t = performance.now();
  threat.tick(dt, state);
  const ms = performance.now() - t;
  total += ms;
  peak = Math.max(peak, ms);
}
const mean = total / FRAMES;
const tickBudget = calibratedBudget(TICK_MEAN_BUDGET_MS, runner);
console.log(`chorus tick: ${FRAMES} frames at ≥ ${minLive} fauna, mean ${mean.toFixed(3)} ms, peak ${peak.toFixed(2)} ms, ${shots} shots, ${state.kills - kills0} kills; budget mean ≤ ${tickBudget.toFixed(2)} ms`);
assert.ok(shots > 100 && state.kills > kills0, 'the defense is engaged during the measurement');
assert.ok(mean <= tickBudget, `chorus tick mean ${mean.toFixed(3)} ms > ${tickBudget.toFixed(2)}`);

console.log('colonyThreat timing OK');
