// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/ark.selftest.ts
//   ARK_RUNS_PER_LANE (default 5): Landings per skilled lane in the measured
//   20-Landing Data cycle (4 lanes × 5).
//
// PRD §19 / §1c meta-pacing / §9, on MEASURED income: the skilled lanes
// (bastion, sprawl, spire, kin) play real Landings through `runLanding`, and
// the Data they settle (`LandingResult.data.total`, losses included) is the
// income a buyer banks, cycled Landing by Landing. The buyer takes the
// cheapest legal node after every Landing (ring r needs a ring r − 1 node of
// its branch); owned `data.mul` nodes raise later income.
//   - the first node is affordable after Landing 1;
//   - 50 % of the tree is owned at Landings 25-35, 100 % at 80-120;
//   - the Refit price (`data/ark.ts:refitCost`) rises strictly and is uncapped.
import assert from 'node:assert/strict';
import { ARK_NODES, refitCost, type ArkNode } from '../../slices/colony/content';
import { playLane } from '../colony/runLanding';

const PER_LANE = Number(process.env.ARK_RUNS_PER_LANE ?? 5);
const MAX_LANDINGS = 400;

// Tree shape: every ring-r node (r > 0) has a ring r − 1 node in its branch, so the whole tree is reachable.
assert.ok(ARK_NODES.length > 0, 'ARK_NODES is empty: nothing to pace');
for (const node of ARK_NODES) {
  if (node.ring === 0) continue;
  assert.ok(ARK_NODES.some((n) => n.branch === node.branch && n.ring === node.ring - 1), `${node.id}: no ring ${node.ring - 1} node in branch ${node.branch}`);
}

// Measured income: the skilled lanes' settled Data, 20-Landing cycle.
const cycle: number[] = [];
for (const lane of ['bastion', 'sprawl', 'spire', 'kin'] as const) {
  for (const run of playLane(lane, PER_LANE, 'ark:income')) cycle.push(run.result.data.total);
}
// Interleave lanes so the cycle is not four lane blocks in a row.
const income = cycle.map((_, i) => cycle[(i % 4) * PER_LANE + Math.floor(i / 4)] ?? 0);
const meanIncome = income.reduce((s, v) => s + v, 0) / income.length;
assert.ok(meanIncome > 0, 'measured Data per Landing is 0');

const owned = new Set<string>();
let dataMul = 0;
let bank = 0;
const reachedAt: Record<'first' | 'half' | 'full', number | null> = { first: null, half: null, full: null };
const half = Math.ceil(ARK_NODES.length / 2);
const legal = (n: ArkNode): boolean =>
  !owned.has(n.id) && (n.ring === 0 || ARK_NODES.some((p) => owned.has(p.id) && p.branch === n.branch && p.ring === n.ring - 1));
for (let landing = 1; landing <= MAX_LANDINGS && owned.size < ARK_NODES.length; landing += 1) {
  bank += Math.round((income[(landing - 1) % income.length] ?? 0) * (1 + dataMul));
  for (;;) {
    const next = ARK_NODES.filter(legal).sort((a, b) => a.cost - b.cost)[0];
    if (next === undefined || next.cost > bank) break;
    bank -= next.cost;
    owned.add(next.id);
    for (const e of next.effects) if (e.stat === 'data.mul') dataMul += e.mul ?? 0;
  }
  if (reachedAt.first === null && owned.size >= 1) reachedAt.first = landing;
  if (reachedAt.half === null && owned.size >= half) reachedAt.half = landing;
  if (reachedAt.full === null && owned.size >= ARK_NODES.length) reachedAt.full = landing;
}
const total = ARK_NODES.reduce((s, n) => s + n.cost, 0);
console.log(`measured Data per Landing: mean ${meanIncome.toFixed(1)} over ${income.length} Landings (${income.join(', ')})`);
console.log(`tree ${ARK_NODES.length} nodes, ${total} Data; first node at Landing ${reachedAt.first}, 50 % at ${reachedAt.half}, 100 % at ${reachedAt.full}`);
assert.ok(reachedAt.first !== null && reachedAt.first <= 1, `first Ark node affordable after Landing ${reachedAt.first ?? 'never'} (must be 1)`);
assert.ok(reachedAt.half !== null && reachedAt.half >= 25 && reachedAt.half <= 35, `50 % of the tree at Landing ${reachedAt.half ?? `> ${MAX_LANDINGS}`} (must be 25-35)`);
assert.ok(reachedAt.full !== null && reachedAt.full >= 80 && reachedAt.full <= 120, `100 % of the tree at Landing ${reachedAt.full ?? `> ${MAX_LANDINGS}`} (must be 80-120)`);

// Refit: strictly rising, finite, uncapped.
let prev = refitCost(0);
assert.ok(prev > 0, `refitCost(0) = ${prev}`);
for (let level = 1; level <= 200; level += 1) {
  const cost = refitCost(level);
  assert.ok(Number.isFinite(cost) && cost > prev, `refitCost(${level}) = ${cost} does not rise above ${prev}`);
  prev = cost;
}
assert.ok(refitCost(100) > 1000 * refitCost(0), 'Refit price flattens (must be uncapped geometric growth)');
console.log(`Refit: ${refitCost(0)} → ${refitCost(10)} (L10) → ${refitCost(50)} (L50), strictly rising`);
console.log('ark OK');
