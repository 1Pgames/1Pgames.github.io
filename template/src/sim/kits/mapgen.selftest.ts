// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/mapgen.selftest.ts
//   MAPGEN_SEEDS (default 40) seeds per world; MAPGEN_NO_CACHE=1 bypasses the disk cache.
//
// The world-composition budgets (`game-prd` genre-playbooks §Taste floors,
// template AGENTS.md §Quality budgets) as assertions over `systems/mapgen.ts`,
// recomputed from the generated geometry — never read back from the
// generator's own metrics:
//   scale      ≥ 30 screens of 720×1280 (arena-survival floor)
//   spawn      at the centre (≤ `spawnJitter`), depth 0 there, 1 at the walls
//   props      placed singly: art overlap 0 with ≥ 60 px gaps; same kind
//              ≥ 900 px apart; ≥ 3 kinds in ≥ 90% of screen windows; never in
//              a clearing, on a road or in the wall band
//   decals     ≤ 3 in every screen window of the cap lattice (so p95 ≤ 3 on a
//              finer one too), no overlap, never on a prop, alpha ≤ 0.45
//   POIs       (fixture world) along roads, ≥ `poiMinSpacing` apart, nearest-
//              POI median 1,200-2,200 px (one per 2-3 screens), in depth band,
//              clearings free of props and decals
//   landmarks  (fixture world) on road nodes, plazas free
//   floor      3 variants, each ≥ 25% of the tiles (feather-blended by the arena)
//   nav        every open cell reachable from the spawn, crevices sealed
//              (≤ 0.5%), every anchor on open floor; the windowed flow field
//              descends; travel detour ≤ 1.15 (sparse single props)
// plus determinism (same seed ⇒ same world) and cache == fresh.
// Generation TIME is `mapgen.timing.selftest.ts` (runs alone, calibrated).
import assert from 'node:assert/strict';
import { TUNING, VIEW } from '../../config';
import { NavGrid } from '../../core/grid';
import { DECALS, PROPS } from '../../data/props';
import { WORLD, type WorldDef } from '../../data/world';
import {
  DECAL_LATTICE,
  approachDetour,
  depthAt,
  depthDangerMul,
  generateWorld,
  segmentsDistance,
  type GeneratedWorld,
} from '../../systems/mapgen';
import { cachedGenerateWorld } from '../mapgen-cache';

/** Spec floors — pinned here so a TUNING edit cannot quietly lower them. */
const FLOOR = {
  screens: 30,
  propGap: 60,
  sameKindPx: 900,
  kindsPerScreen: 3,
  kindsWindowShare: 0.9,
  decalsPerScreen: 3,
  decalAlpha: 0.45,
  poiNearestMedian: [1200, 2200] as const,
  poiPlacedShare: 0.85,
  sealedShare: 0.005,
  detourMax: 1.15,
} as const;

const SEEDS = Number(process.env.MAPGEN_SEEDS ?? 40);
const cfg = TUNING.arena;
const SW = VIEW.width;
const SH = VIEW.height;

/** The template world plus the rules a real game fills in: POIs in depth bands and two landmarks. */
const FIXTURE: WorldDef = {
  ...WORLD,
  id: 'fixture',
  landmarks: [
    { propId: 'obelisk', plaza: 320 },
    { propId: 'crystal-spire', plaza: 300 },
  ],
  pois: [
    { kind: 'chest', count: 8, radius: 170, depth: [0.15, 1] },
    { kind: 'shrine', count: 4, radius: 220, depth: [0.5, 1] },
  ],
};

// ── static floors on the tuning and the content rows ─────────────────────────
assert.ok((cfg.width * cfg.height) / (SW * SH) >= FLOOR.screens, `world is ${((cfg.width * cfg.height) / (SW * SH)).toFixed(1)} screens (< ${FLOOR.screens})`);
assert.ok(cfg.propGap >= FLOOR.propGap, 'arena.propGap under the 60 px floor');
assert.ok(cfg.sameKindPx >= FLOOR.sameKindPx, 'arena.sameKindPx under the 900 px floor');
assert.ok(cfg.decalMaxPerScreen <= FLOOR.decalsPerScreen, 'arena.decalMaxPerScreen over the 3/screen ceiling');
for (const d of DECALS) assert.ok(d.alpha <= FLOOR.decalAlpha, `decal ${d.id} alpha ${d.alpha} > ${FLOOR.decalAlpha}`);
assert.equal(new Set(PROPS.map((p) => p.id)).size, PROPS.length, 'prop kind ids are unique');

/** Screen windows (720×1280) on a lattice of 1/`div` screen steps, fully inside the world. */
function windows(map: GeneratedWorld, div: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let y = 0; y + SH <= map.height; y += SH / div) for (let x = 0; x + SW <= map.width; x += SW / div) out.push({ x, y });
  return out;
}

function inWindow(p: { x: number; y: number }, w: { x: number; y: number }): boolean {
  return p.x >= w.x && p.x < w.x + SW && p.y >= w.y && p.y < w.y + SH;
}

/** Independent 4-neighbour flood over the exported nav raster. */
function reachable(map: GeneratedWorld): Uint8Array {
  const { cols, rows, cell, blocked } = map.nav;
  const seen = new Uint8Array(cols * rows);
  const start = Math.floor(map.spawn.y / cell) * cols + Math.floor(map.spawn.x / cell);
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const r = Math.floor(cur / cols);
    const c = cur - r * cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const cc = c + dc;
      const rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
      const n = rr * cols + cc;
      if (blocked[n] === 1 || seen[n] === 1) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  return seen;
}

function checkWorld(world: WorldDef, seed: string): { kindsMedian: number; decalsP95: number; poiMedian: number } {
  const map = cachedGenerateWorld(world, seed);
  const tag = `${world.id}/${seed}`;
  const artOf: Record<string, number> = {};
  const clearings: Array<{ x: number; y: number; r: number; what: string }> = [{ x: map.spawn.x, y: map.spawn.y, r: cfg.spawnClearRadius, what: 'spawn clearing' }];
  for (const p of map.pois) clearings.push({ x: p.x, y: p.y, r: p.radius, what: `${p.id} clearing` });
  for (const p of map.props) {
    if (p.landmark !== true) continue;
    const lm = world.landmarks.find((l) => l.propId === p.id)!;
    clearings.push({ x: p.x, y: p.y, r: lm.plaza, what: `landmark ${p.id} plaza` });
  }

  // Spawn at the centre; depth rises to the walls.
  assert.ok(Math.hypot(map.spawn.x - map.width / 2, map.spawn.y - map.height / 2) <= cfg.spawnJitter + 1, `${tag}: spawn off-centre`);
  assert.equal(depthAt(map, map.spawn.x, map.spawn.y), 0, `${tag}: spawn depth`);
  assert.equal(depthAt(map, 0, 0), 1, `${tag}: corner depth`);

  // Props: single, gap, same kind, placement.
  const t = cfg.wallThickness;
  for (let a = 0; a < map.props.length; a += 1) {
    const p = map.props[a]!;
    artOf[p.id] = p.artRadius;
    assert.ok(p.x - p.artRadius >= t && p.y - p.artRadius >= t && p.x + p.artRadius <= map.width - t && p.y + p.artRadius <= map.height - t, `${tag}: ${p.id} in the wall band`);
    for (let b = a + 1; b < map.props.length; b += 1) {
      const q = map.props[b]!;
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      assert.ok(d >= p.artRadius + q.artRadius + FLOOR.propGap - 1, `${tag}: ${p.id}/${q.id} art gap ${Math.round(d - p.artRadius - q.artRadius)} px`);
      if (p.id === q.id && p.landmark !== true && q.landmark !== true) assert.ok(d >= FLOOR.sameKindPx - 1, `${tag}: two ${p.id} ${Math.round(d)} px apart`);
    }
    if (p.landmark === true) continue;
    for (const k of clearings) {
      assert.ok(Math.hypot(p.x - k.x, p.y - k.y) >= k.r + Math.max(p.artRadius, p.bodyRadius) - 1, `${tag}: ${p.id} inside ${k.what}`);
    }
    if (map.roadWidth > 0) assert.ok(segmentsDistance(map.roads, p.x, p.y) >= map.roadWidth / 2 + p.artRadius, `${tag}: ${p.id} on a road`);
  }
  const lattice = windows(map, DECAL_LATTICE);
  const kinds = lattice.map((w) => new Set(map.props.filter((p) => inWindow(p, w)).map((p) => p.id)).size).sort((x, y) => x - y);
  const share = kinds.filter((k) => k >= FLOOR.kindsPerScreen).length / kinds.length;
  assert.ok(share >= FLOOR.kindsWindowShare, `${tag}: only ${(share * 100).toFixed(0)}% of screens show ≥ ${FLOOR.kindsPerScreen} prop kinds`);

  // Decals: cap on the generator's lattice, p95 on a finer one, no overlap, not on props.
  for (const w of lattice) {
    const n = map.decals.filter((d) => inWindow(d, w)).length;
    assert.ok(n <= FLOOR.decalsPerScreen, `${tag}: ${n} decals in screen (${w.x},${w.y})`);
  }
  const fine = windows(map, DECAL_LATTICE * 2).map((w) => map.decals.filter((d) => inWindow(d, w)).length).sort((x, y) => x - y);
  const decalsP95 = fine[Math.floor(fine.length * 0.95)]!;
  assert.ok(decalsP95 <= FLOOR.decalsPerScreen, `${tag}: decals p95 ${decalsP95}/screen`);
  for (let a = 0; a < map.decals.length; a += 1) {
    const d = map.decals[a]!;
    assert.ok(d.alpha <= FLOOR.decalAlpha, `${tag}: decal alpha ${d.alpha}`);
    for (let b = a + 1; b < map.decals.length; b += 1) {
      const e = map.decals[b]!;
      assert.ok(Math.hypot(d.x - e.x, d.y - e.y) >= d.radius + e.radius - 1, `${tag}: decals overlap at (${d.x},${d.y})`);
    }
    for (const p of map.props) assert.ok(Math.hypot(d.x - p.x, d.y - p.y) >= d.radius + p.artRadius - 1, `${tag}: decal on ${p.id}`);
    for (const k of clearings) assert.ok(Math.hypot(d.x - k.x, d.y - k.y) >= k.r + d.radius - 1, `${tag}: decal inside ${k.what}`);
  }

  // POIs (only a world that asks for them).
  let poiMedian = 0;
  const asked = world.pois.reduce((n, r) => n + r.count, 0);
  if (asked > 0) {
    assert.ok(map.pois.length >= Math.ceil(asked * FLOOR.poiPlacedShare), `${tag}: ${map.pois.length}/${asked} POIs placed`);
    const nearest: number[] = [];
    for (const p of map.pois) {
      const rule = world.pois.find((r) => r.kind === p.kind)!;
      assert.equal(p.radius, rule.radius, `${tag}: ${p.id} clearing radius`);
      assert.ok(p.depth >= rule.depth[0] - 1e-3 && p.depth <= rule.depth[1] + 1e-3, `${tag}: ${p.id} depth ${p.depth}`);
      assert.ok(Math.abs(depthAt(map, p.x, p.y) - p.depth) < 2e-3, `${tag}: ${p.id} depth disagrees with depthAt`);
      assert.ok(segmentsDistance(map.roads, p.x, p.y) <= cfg.poiRoadMaxPx + 1, `${tag}: ${p.id} is not along a road`);
      let near = Infinity;
      for (const q of map.pois) if (q !== p) near = Math.min(near, Math.hypot(p.x - q.x, p.y - q.y));
      assert.ok(near >= cfg.poiMinSpacing - 1, `${tag}: ${p.id} ${Math.round(near)} px from the next POI`);
      nearest.push(near);
    }
    nearest.sort((x, y) => x - y);
    poiMedian = nearest[Math.floor(nearest.length / 2)]!;
    assert.ok(poiMedian >= FLOOR.poiNearestMedian[0] && poiMedian <= FLOOR.poiNearestMedian[1], `${tag}: nearest-POI median ${Math.round(poiMedian)} px`);
  }
  assert.equal(map.props.filter((p) => p.landmark === true).length, world.landmarks.length, `${tag}: landmark census`);

  // Floor: three variants, none a sliver.
  const counts = [0, 0, 0];
  for (const v of map.floor.variant) counts[v]! += 1;
  for (const c of counts) assert.ok(c >= map.floor.variant.length * 0.25, `${tag}: floor variant share ${counts.join('/')}`);

  // Nav: all open floor reachable, little sealed, anchors on open floor.
  const seen = reachable(map);
  const { cols, cell, blocked } = map.nav;
  let sealedOrBlocked = 0;
  for (let i = 0; i < blocked.length; i += 1) {
    if (blocked[i] === 0) assert.equal(seen[i], 1, `${tag}: nav cell ${i} open but unreachable`);
    else sealedOrBlocked += 1;
  }
  assert.ok(map.metrics.sealedCells <= blocked.length * FLOOR.sealedShare, `${tag}: ${map.metrics.sealedCells} cells sealed`);
  const navAt = (x: number, y: number): number => Math.floor(y / cell) * cols + Math.floor(x / cell);
  assert.equal(blocked[navAt(map.spawn.x, map.spawn.y)], 0, `${tag}: spawn nav-blocked`);
  for (const p of map.pois) assert.equal(blocked[navAt(p.x, p.y)], 0, `${tag}: ${p.id} nav-blocked`);
  assert.ok(sealedOrBlocked < blocked.length * 0.25, `${tag}: ${sealedOrBlocked} of ${blocked.length} nav cells blocked`);
  return { kindsMedian: kinds[Math.floor(kinds.length / 2)]!, decalsP95, poiMedian };
}

for (const world of [WORLD, FIXTURE]) {
  const kindsMedians: number[] = [];
  const poiMedians: number[] = [];
  let decalsP95 = 0;
  for (let i = 0; i < SEEDS; i += 1) {
    const r = checkWorld(world, `selftest-${i}`);
    kindsMedians.push(r.kindsMedian);
    poiMedians.push(r.poiMedian);
    decalsP95 = Math.max(decalsP95, r.decalsP95);
  }
  const sample = cachedGenerateWorld(world, 'selftest-0');
  kindsMedians.sort((a, b) => a - b);
  poiMedians.sort((a, b) => a - b);
  console.log(
    `${world.id}: ${SEEDS} seeds OK — ${sample.metrics.screens} screens, ${sample.props.length} props, ${sample.decals.length} decals, ` +
      `kinds/screen median ${kindsMedians[Math.floor(SEEDS / 2)]}, decals/screen p95 ≤ ${decalsP95}` +
      (world.pois.length > 0 ? `, ${sample.pois.length} POIs, nearest-POI median ${Math.round(poiMedians[Math.floor(SEEDS / 2)]!)} px` : ''),
  );
}

// Danger depth: 1 across the spawn band, 1 + depthDanger at the wall, monotone.
assert.equal(depthDangerMul(0), 1);
assert.equal(depthDangerMul(1 / 3), 1);
assert.ok(Math.abs(depthDangerMul(1) - (1 + cfg.depthDanger)) < 1e-9);
for (let d = 0; d < 1; d += 0.05) assert.ok(depthDangerMul(d + 0.05) >= depthDangerMul(d), 'depthDangerMul is monotone');

// Travel: sparse single props barely bend an approach (the sim applies this factor).
{
  const detour = approachDetour(cachedGenerateWorld(WORLD, 'selftest-0'));
  assert.ok(detour >= 1 && detour <= FLOOR.detourMax, `approach detour ${detour.toFixed(3)}`);
  console.log(`approach detour ${detour.toFixed(3)}`);
}

// Cache equivalence and determinism (the generator itself, never the cache).
const strip = (m: GeneratedWorld): string =>
  JSON.stringify({ ...m, metrics: { ...m.metrics, ms: 0 } }, (_k, v: unknown) => (v instanceof Uint8Array ? Array.from(v) : v));
for (const world of [WORLD, FIXTURE]) {
  const fresh = generateWorld(world, 'selftest-1');
  assert.equal(strip(cachedGenerateWorld(world, 'selftest-1')), strip(fresh), `${world.id}: cached world differs from a fresh one`);
  assert.equal(strip(generateWorld(world, 'determinism')), strip(generateWorld(world, 'determinism')), `${world.id}: same seed, different world`);
}
assert.notEqual(strip(generateWorld(WORLD, 'a')), strip(generateWorld(WORLD, 'b')), 'different seeds give different worlds');
console.log(process.env.MAPGEN_NO_CACHE === '1' ? 'cache: bypassed (MAPGEN_NO_CACHE=1)' : 'cache: cached == fresh; determinism OK');

// NavGrid over the export: the hero's window flow field steers every reachable cell downhill.
{
  const map = generateWorld(WORLD, 'nav-probe');
  const nav = NavGrid.fromBlocked(map.nav.cols, map.nav.rows, map.nav.cell, map.nav.blocked);
  const hero = { col: 0, row: 0 };
  nav.worldToCell(map.spawn.x, map.spawn.y, hero);
  const radius = TUNING.enemy.navWindowCells;
  nav.buildFlowFieldWindow(hero.col, hero.row, radius);
  const dir = { x: 0, y: 0 };
  const half = map.nav.cell / 2;
  let steered = 0;
  for (let r = hero.row - 12; r <= hero.row + 12; r += 1) {
    for (let c = hero.col - 12; c <= hero.col + 12; c += 1) {
      if (nav.isBlocked(c, r)) continue;
      assert.ok(nav.steer(c * map.nav.cell + half, r * map.nav.cell + half, dir), `nav: reachable cell (${c},${r}) has no direction`);
      if (dir.x === 0 && dir.y === 0) continue;
      const step = Math.max(Math.abs(dir.x), Math.abs(dir.y));
      const nc = c + Math.round(dir.x / step);
      const nr = r + Math.round(dir.y / step);
      assert.ok(nav.distanceAt(nc, nr) < nav.distanceAt(c, r), `nav: step from (${c},${r}) does not descend`);
      steered += 1;
    }
  }
  assert.ok(steered > 300, `nav: window steers the spawn neighbourhood (${steered} cells)`);
  const far = hero.col + radius + 2;
  assert.equal(nav.steer(far * map.nav.cell + half, hero.row * map.nav.cell + half, dir), false, 'nav: outside the window → false (straight steer)');
  assert.equal(nav.isBlocked(-1, 0), true, 'nav: out of bounds is blocked');
}

console.log('mapgen selftest OK');
