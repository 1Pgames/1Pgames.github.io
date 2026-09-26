// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/mapgen.selftest.ts
//   Default 40 seeds × 4 zones (PRD-V2 §3.8 asks 200; the 24576² map takes
//   ~0.35 s per seed, so the default is 40 and the run logs it). MAPGEN_SEEDS=200 for the full band.
//
// Bands (§3.8): coverage, min corridor, narrow share, zero unreachable nav
// cells, path factor, POI count/spacing (900 px between large POIs, 450 px
// between any two — see `MAJOR_POIS`), gate bands + separation, empty gate
// aprons and POI clearings, body radius cap, reseed rate, generation time,
// determinism. Plus the conservation laws consumers rely on: every anchor is
// on reachable nav floor, depth rules (§3.3) hold for every POI and gate, the
// hazard anchor census matches the zone's hazard params, and `depthAt` agrees
// with the anchors' recorded depth.
import assert from 'node:assert/strict';
import { TUNING } from '../../config';
import { NavGrid } from '../../core/grid';
import { propDef } from '../../data/props';
import { MAJOR_POIS, POI_CLEARING } from '../../data/stamps';
import { ZONES, type ZoneDef } from '../../data/zones';
import type { Depth, GeneratedMap, PoiKind } from '../../data/types-v2';
import { depthAt, generateMap } from '../../systems/mapgen';

/** Spec bands (PRD-V2 §3.8 + user requests): central spawn, edge-safe objectives, POI total from the quota table. */
const SPAWN_MAX_OFF_CENTRE = 1000;
const EDGE_SAFE_MIN = 700;
const POI_TOTAL_SPEC = Object.values(TUNING.mapgen.poiCounts as Record<string, number>).reduce((a, b) => a + b, 0);
const POI_BAND: readonly [number, number] = [Math.floor(POI_TOTAL_SPEC * 0.85), POI_TOTAL_SPEC + 2];

const SEEDS = Number(process.env.MAPGEN_SEEDS ?? 40);
console.log(`mapgen selftest: ${SEEDS} seeds × 4 zones (24576² map)`);
const cfg = TUNING.mapgen;

/** §3.3 / §5.12 depth law per POI kind. */
const POI_DEPTHS: Record<PoiKind, readonly Depth[]> = {
  chest_t1: [0, 1, 2], chest_t2: [1, 2], chest_t3: [1, 2], vault: [2], lair: [1, 2], den: [2],
  shrine_blood: [1, 2], shrine_bone: [1, 2], shrine_curse: [1, 2], shrine_grave: [0, 1, 2], shrine_gilt: [0, 1, 2],
  vein: [0, 1, 2], lore: [0, 1, 2], bell: [1, 2], fence: [1], event_yard: [1, 2],
};

function expectedHazards(zone: ZoneDef): number {
  const p = zone.hazard.params;
  switch (zone.hazard.kind) {
    case 'braziers': return p.count!;
    case 'bonestorm': return p.dotZones!;
    case 'sinksand': return p.pits!;
    case 'gale': return p.iceSheets! + p.torches!;
  }
}

/** Octile path length on the exported nav raster from the spawn (what actors walk). */
function navPaths(map: GeneratedMap): Float64Array {
  const { cols, rows, cell, blocked } = map.nav;
  const dist = new Float64Array(cols * rows).fill(Infinity);
  const start = Math.floor(map.spawn.y / cell) * cols + Math.floor(map.spawn.x / cell);
  dist[start] = 0;
  // Label-correcting search with a ring queue (re-queues on improvement).
  const cap = cols * rows;
  const order = new Int32Array(cap);
  let head = 0;
  let size = 1;
  order[0] = start;
  const inQ = new Uint8Array(cols * rows);
  inQ[start] = 1;
  while (size > 0) {
    const cur = order[head]!;
    head = (head + 1) % cap;
    size -= 1;
    inQ[cur] = 0;
    const r = Math.floor(cur / cols);
    const c = cur - r * cols;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const n = rr * cols + cc;
        if (blocked[n] === 1) continue;
        if (dr !== 0 && dc !== 0 && (blocked[r * cols + cc] === 1 || blocked[rr * cols + c] === 1)) continue;
        const nd = dist[cur]! + (dr !== 0 && dc !== 0 ? cell * Math.SQRT2 : cell);
        if (nd + 1e-6 < dist[n]!) {
          dist[n] = nd;
          if (inQ[n] === 0) {
            inQ[n] = 1;
            order[(head + size) % cap] = n;
            size += 1;
          }
        }
      }
    }
  }
  return dist;
}

const times: number[] = [];

for (const zone of ZONES) {
  let reseeded = 0;
  const hazards = expectedHazards(zone);
  for (let i = 0; i < SEEDS; i += 1) {
    const seed = `selftest-${i}`;
    const map = generateMap(zone, seed);
    const tag = `${zone.id}/${seed}`;
    const m = map.metrics;
    times.push(m.ms);
    if (m.reseeds > 0) reseeded += 1;

    assert.ok(m.coverage >= cfg.coverageMin && m.coverage <= cfg.coverageMax, `${tag}: coverage ${m.coverage}`);
    assert.ok(m.minCorridor >= cfg.minCorridor, `${tag}: min corridor ${m.minCorridor}`);
    assert.ok(m.narrowShare <= cfg.narrowShareMax, `${tag}: narrow share ${m.narrowShare}`);
    assert.ok(m.maxPathFactor <= cfg.pathFactorMax, `${tag}: path factor ${m.maxPathFactor}`);
    assert.deepEqual(map.gates.map((g) => g.id).sort(), ['a', 'b', 'c', 'x'], `${tag}: gates a, b, c + one conditional`);
    for (const prop of map.props) assert.ok(prop.bodyRadius <= cfg.maxBodyRadius, `${tag}: prop ${prop.id} body ${prop.bodyRadius}`);

    // POIs: count, spacing, depth law, depthAt agreement.
    assert.ok(map.pois.length >= POI_BAND[0] && map.pois.length <= POI_BAND[1], `${tag}: ${map.pois.length} POIs`);
    assert.equal(m.poiCount, map.pois.length, `${tag}: metrics.poiCount`);
    for (let a = 0; a < map.pois.length; a += 1) {
      const p = map.pois[a]!;
      assert.ok(POI_DEPTHS[p.kind].includes(p.depth), `${tag}: ${p.id} at depth ${p.depth}`);
      assert.equal(depthAt(map, p.x, p.y), p.depth, `${tag}: depthAt disagrees at ${p.id}`);
      assert.equal(p.radius, POI_CLEARING[p.kind], `${tag}: ${p.id} clearing`);
      for (let b = a + 1; b < map.pois.length; b += 1) {
        const q = map.pois[b]!;
        if (Math.abs(p.x - q.x) > cfg.poiMinSpacing) continue;
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        // Large POIs keep the full spacing between each other; every anchor keeps half and never overlaps a clearing.
        const need = MAJOR_POIS.includes(p.kind) && MAJOR_POIS.includes(q.kind) ? cfg.poiMinSpacing : cfg.poiMinorSpacing;
        assert.ok(d >= need - 1 && d >= p.radius + q.radius, `${tag}: ${p.id}–${q.id} ${Math.round(d)} px apart`);
      }
    }
    // The hero starts mid-map; its region is depth 0.
    assert.ok(Math.hypot(map.spawn.x - map.width / 2, map.spawn.y - map.height / 2) <= SPAWN_MAX_OFF_CENTRE, `${tag}: spawn off-centre`);
    assert.equal(depthAt(map, map.spawn.x, map.spawn.y), 0, `${tag}: spawn region depth`);
    // Timed gates point in different directions from the spawn (≥ 90° apart).
    const timed = map.gates.filter((g) => g.id !== 'x');
    for (const g of timed) {
      for (const o of timed) {
        if (o === g) continue;
        let d = Math.abs(Math.atan2(g.y - map.spawn.y, g.x - map.spawn.x) - Math.atan2(o.y - map.spawn.y, o.x - map.spawn.x));
        if (d > Math.PI) d = Math.PI * 2 - d;
        assert.ok(d >= Math.PI / 2 - 1e-6, `${tag}: gates ${g.id}/${o.id} share a direction`);
      }
    }
    // Objectives the hero stands at keep EDGE_SAFE_MIN from the world edge (camera never clamps there).
    const standAt = [...map.gates, ...map.pois.filter((p) => p.kind.startsWith('chest') || p.kind.startsWith('shrine') || p.kind === 'vault' || p.kind === 'bell')];
    for (const o of standAt) {
      assert.ok(Math.min(o.x, o.y, map.width - o.x, map.height - o.y) >= EDGE_SAFE_MIN, `${tag}: objective (${o.x},${o.y}) within ${EDGE_SAFE_MIN} px of the edge`);
    }
    const bellGate = map.gates.some((g) => g.kind === 'bell');
    assert.equal(map.pois.filter((p) => p.kind === 'bell').length, bellGate ? 2 : 0, `${tag}: bells iff Bell Gate`);
    // Every kind but veins is placed exactly as `mapgen.poiCounts` asks.
    for (const [kind, n] of Object.entries(cfg.poiCounts)) {
      if (kind === 'vein') continue;
      assert.equal(map.pois.filter((p) => p.kind === kind).length, n, `${tag}: ${kind} count`);
    }

    // Clearings: no blocker body inside any gate apron (r 400) or POI clearing, nor the spawn clearing.
    const CB = 1024;
    const cn = Math.ceil(map.width / CB);
    const clearGrid: Array<Array<{ x: number; y: number; r: number; what: string }>> = Array.from({ length: cn * cn }, () => []);
    for (const g of map.gates) clearGrid[Math.floor(g.y / CB) * cn + Math.floor(g.x / CB)]!.push({ x: g.x, y: g.y, r: cfg.gateClear, what: `gate ${g.id} apron` });
    for (const p of map.pois) clearGrid[Math.floor(p.y / CB) * cn + Math.floor(p.x / CB)]!.push({ x: p.x, y: p.y, r: p.radius, what: `${p.id} clearing` });
    const artR = (id: string): number => propDef(zone.id, id).visualR;
    const propGrid: Array<typeof map.props> = Array.from({ length: cn * cn }, () => []);
    for (const prop of map.props) propGrid[Math.floor(prop.y / CB) * cn + Math.floor(prop.x / CB)]!.push(prop);
    for (const prop of map.props) {
      const c0 = Math.floor(prop.x / CB);
      const r0 = Math.floor(prop.y / CB);
      // No heaps: blocker art never overlaps (±1 px for rounded positions).
      for (let r = Math.max(0, r0 - 1); r <= Math.min(cn - 1, r0 + 1); r += 1) {
        for (let c = Math.max(0, c0 - 1); c <= Math.min(cn - 1, c0 + 1); c += 1) {
          for (const o of propGrid[r * cn + c]!) {
            if (o === prop) continue;
            assert.ok(Math.hypot(prop.x - o.x, prop.y - o.y) >= artR(prop.id) + artR(o.id) - 1.5, `${tag}: ${prop.id} art overlaps ${o.id}`);
          }
        }
      }
      for (let r = Math.max(0, r0 - 1); r <= Math.min(cn - 1, r0 + 1); r += 1) {
        for (let c = Math.max(0, c0 - 1); c <= Math.min(cn - 1, c0 + 1); c += 1) {
          for (const k of clearGrid[r * cn + c]!) {
            // Neither body nor art inside a gate apron or POI clearing.
            assert.ok(Math.hypot(prop.x - k.x, prop.y - k.y) >= k.r + Math.max(prop.bodyRadius, artR(prop.id)) - 1, `${tag}: ${prop.id} inside ${k.what}`);
          }
        }
      }
      assert.ok(Math.hypot(prop.x - map.spawn.x, prop.y - map.spawn.y) >= cfg.spawnClear + prop.bodyRadius, `${tag}: ${prop.id} in spawn clearing`);
    }

    // Nav: zero unreachable walkable cells; every anchor on reachable floor.
    const paths = navPaths(map);
    const { cols, cell, blocked } = map.nav;
    for (let c = 0; c < blocked.length; c += 1) {
      if (blocked[c] === 0) assert.ok(paths[c]! < Infinity, `${tag}: nav cell ${c} walkable but unreachable`);
    }
    const navAt = (x: number, y: number): number => Math.floor(y / cell) * cols + Math.floor(x / cell);
    for (const a of [...map.gates, ...map.pois, ...map.hazardAnchors]) {
      assert.equal(blocked[navAt(a.x, a.y)], 0, `${tag}: anchor (${a.x},${a.y}) nav-blocked`);
    }
    assert.equal(map.hazardAnchors.length, hazards, `${tag}: hazard anchors ${map.hazardAnchors.length}/${hazards}`);

    // Gates: depth law, bands on the nav raster (± 2 cells quantisation), separation.
    const band: Record<string, readonly [number, number]> = { a: cfg.gateDist.a, b: cfg.gateDist.b, c: cfg.gateDist.c, x: [cfg.gateDist.xMin, Infinity] };
    const gateDepths: Record<string, readonly Depth[]> = { a: [0, 1], b: [1], c: [1, 2], x: [1, 2] };
    for (const g of map.gates) {
      assert.ok(gateDepths[g.id]!.includes(g.depth), `${tag}: gate ${g.id} depth ${g.depth}`);
      const d = paths[navAt(g.x, g.y)]!;
      const [lo, hi] = band[g.id]!;
      assert.ok(d >= lo - 2 * cell && d <= hi + 2 * cell, `${tag}: gate ${g.id} nav path ${Math.round(d)} outside ${lo}-${hi}`);
      for (const o of map.gates) {
        if (o !== g) assert.ok(Math.hypot(o.x - g.x, o.y - g.y) >= cfg.gateDist.separation, `${tag}: gates ${g.id}/${o.id} too close`);
      }
    }
    assert.equal(map.gates.find((g) => g.id === 'c')!.closesS, null, `${tag}: Gate C never closes`);
    const pathOf = (id: string): number => { const g = map.gates.find((q) => q.id === id)!; return paths[navAt(g.x, g.y)]!; };
    assert.ok(pathOf('c') - pathOf('b') >= cfg.gateDist.cBeyondB, `${tag}: gate C only ${Math.round(pathOf('c') - pathOf('b'))} px beyond B`);

    // Floor: 3 variants used, some road.
    assert.ok(new Set(map.floor.variant).size === 3, `${tag}: floor uses 3 variants`);
    assert.ok(map.floor.road.some((v) => v === 1), `${tag}: roads on the floor`);
  }
  const rate = reseeded / SEEDS;
  assert.ok(rate <= 0.1, `${zone.id}: reseed rate ${rate}`);
  console.log(`${zone.id}: ${SEEDS} seeds OK, reseed rate ${(rate * 100).toFixed(1)}%`);
}

// Determinism: same seed ⇒ byte-identical nav + anchor/prop lists.
for (const zone of ZONES) {
  const a = generateMap(zone, 'determinism');
  const b = generateMap(zone, 'determinism');
  assert.deepEqual(Buffer.from(a.nav.blocked), Buffer.from(b.nav.blocked), `${zone.id}: nav differs`);
  const strip = (m: GeneratedMap): string => JSON.stringify({ ...m, metrics: { ...m.metrics, ms: 0 } }, (_k, v: unknown) => (v instanceof Uint8Array ? Array.from(v) : v));
  assert.equal(strip(a), strip(b), `${zone.id}: map differs`);
}

// NavGrid over the export: a window flow field steers every reachable cell toward the goal.
{
  const map = generateMap(ZONES[0]!, 'nav-probe');
  const nav = NavGrid.fromBlocked(map.nav.cols, map.nav.rows, map.nav.cell, map.nav.blocked);
  const out = { col: 0, row: 0 };
  nav.worldToCell(map.spawn.x, map.spawn.y, out);
  nav.buildFlowFieldWindow(out.col, out.row, TUNING.nav.windowCells);
  const dir = { x: 0, y: 0 };
  let steered = 0;
  for (let r = out.row - 10; r <= out.row + 10; r += 1) {
    for (let c = out.col - 10; c <= out.col + 10; c += 1) {
      if (nav.isBlocked(c, r)) continue;
      assert.ok(nav.steer(c * map.nav.cell + 32, r * map.nav.cell + 32, dir), `nav: reachable cell (${c},${r}) has no direction`);
      // Following the direction never increases the BFS distance.
      if (dir.x === 0 && dir.y === 0) continue;
      const nc = c + Math.round(dir.x / Math.max(Math.abs(dir.x), Math.abs(dir.y)));
      const nr = r + Math.round(dir.y / Math.max(Math.abs(dir.x), Math.abs(dir.y)));
      assert.ok(nav.distanceAt(nc, nr) < nav.distanceAt(c, r), `nav: step from (${c},${r}) does not descend`);
      steered += 1;
    }
  }
  assert.ok(steered > 100, 'nav: window steers the spawn neighbourhood');
  // A walkable cell beyond the window radius has no field: the caller straight-steers.
  const far = out.col + TUNING.nav.windowCells + 2 < map.nav.cols ? out.col + TUNING.nav.windowCells + 2 : out.col - TUNING.nav.windowCells - 2;
  assert.equal(nav.steer(far * map.nav.cell + 32, out.row * map.nav.cell + 32, dir), false, 'nav: outside the window → false');
  assert.equal(nav.isBlocked(-1, 0), true, 'nav: out of bounds is blocked');
}

times.sort((p, q) => p - q);
const median = times[Math.floor(times.length / 2)]!;
const p95 = times[Math.floor(times.length * 0.95)]!;
console.log(`generation ms: median ${median.toFixed(1)}, p95 ${p95.toFixed(1)}, max ${times[times.length - 1]!.toFixed(1)}`);
// 24576² map budget (user request): median ≤ 600 ms, p95 ≤ 1.2 s.
assert.ok(median <= 600, `median generation ${median.toFixed(1)} ms > 600`);
assert.ok(p95 <= 1200, `p95 generation ${p95.toFixed(1)} ms > 1200`);

console.log('mapgen selftest OK');
