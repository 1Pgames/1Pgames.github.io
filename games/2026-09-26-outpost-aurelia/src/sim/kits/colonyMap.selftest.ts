// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/colonyMap.selftest.ts
//   COLONY_MAP_SEEDS (default 200) seeded sites per size (frontier, expanse, continent).
//
// PRD §19 / §1c world-scale + density on `threat/terrain.ts:generateSite`:
//   area ≥ 30 screens (and Frontier < Expanse < Continent), Lander Core at the
//   map centre, deposit purity rising with core distance (no pure patch inside
//   8 tiles; the pure share per distance band rises over the batch — the mean
//   is not the measure, because §5.2 pins the guaranteed inner ring to normal), POI (Relic Site or
//   deposit cluster) nearest-neighbour median 1,200-2,200 px, props: overlap 0
//   (one per tile, never on a deposit / relic / core clearing), same kind
//   ≥ 900 px apart, ≥ 3 kinds on every screen holding ≥ 3 props; clearings:
//   radius 5 around the core and 1 tile around every deposit/relic are open.
import assert from 'node:assert/strict';
import { SITES } from '../../slices/colony/content';
import { COLONY_TUNING } from '../../slices/colony/tuning';
import { generateSite, type MapSize, type SiteMap } from '../../slices/colony/threat/terrain';

const SEEDS = Number(process.env.COLONY_MAP_SEEDS ?? 200);
const SIZES: readonly MapSize[] = ['frontier', 'expanse', 'continent'];
const TILE = COLONY_TUNING.map.tilePx;
const SCREEN_W_TILES = 720 / TILE;
const SCREEN_H_TILES = 1280 / TILE;
const SCREEN_PX = 720 * 1280;
/** Deposit patches this close (tiles, origin to origin: a ≤ 3-tile gap between 2×2 patches) chain into a cluster; ≥ 2 patches make a POI, a lone patch does not. */
const CLUSTER_TILES = 5;
/** The starting field (core disc) is home, not a point of interest. */
const HOME_TILES = COLONY_TUNING.field.coreRadius + 2;
const PURITY_BANDS: readonly number[] = [8, 14, Infinity];

const site = SITES.find((s) => s.id === 'halcyon_flats') ?? SITES[0];
assert.ok(site !== undefined, 'no site rows');

/** POI centres in px: every Relic Site plus one per single-linkage cluster of ≥ 2 deposit patches outside the home disc. */
function pois(map: SiteMap): Array<[number, number]> {
  const out: Array<[number, number]> = map.relics.map((r) => [(r.col + 0.5) * TILE, (r.row + 0.5) * TILE]);
  const far = map.deposits.filter((d) => Math.hypot(d.col + 1 - map.core.col, d.row + 1 - map.core.row) > HOME_TILES);
  const group = far.map((_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (group[r] !== r) r = group[r] ?? r;
    return r;
  };
  for (let i = 0; i < far.length; i += 1) {
    for (let j = i + 1; j < far.length; j += 1) {
      const a = far[i];
      const b = far[j];
      if (a !== undefined && b !== undefined && Math.hypot(a.col - b.col, a.row - b.row) <= CLUSTER_TILES) group[root(j)] = root(i);
    }
  }
  const sums = new Map<number, [number, number, number]>();
  // [Σx, Σy, patches] per cluster root.
  far.forEach((d, i) => {
    const s = sums.get(root(i)) ?? [0, 0, 0];
    s[0] += (d.col + 1) * TILE;
    s[1] += (d.row + 1) * TILE;
    s[2] += 1;
    sums.set(root(i), s);
  });
  for (const [x, y, n] of sums.values()) if (n >= 2) out.push([x / n, y / n]);
  return out;
}

function nearestNeighbourMedian(points: ReadonlyArray<readonly [number, number]>): number {
  const nn = points.map((p, i) => {
    let best = Infinity;
    points.forEach((q, j) => {
      if (i !== j) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
    });
    return best;
  });
  nn.sort((a, b) => a - b);
  return nn[Math.floor(nn.length / 2)] ?? Infinity;
}

const areaBySize: Record<MapSize, number> = { frontier: 0, expanse: 0, continent: 0 };
const bandPurity: Array<{ pure: number; n: number }> = PURITY_BANDS.map(() => ({ pure: 0, n: 0 }));
const poiMedians: number[] = [];
let screensChecked = 0;
let screensWithProps = 0;
let totalProps = 0;
const thinScreens: string[] = [];

for (const size of SIZES) {
  for (let s = 0; s < SEEDS; s += 1) {
    const seed = `colonyMap:${size}:${s}`;
    const map = generateSite(site, 1, seed, size);
    const where = `${size} seed ${s}`;
    const { cols, rows, core } = map;
    const screens = (cols * rows * TILE * TILE) / SCREEN_PX;
    assert.ok(screens >= 30, `${where}: ${screens.toFixed(1)} screens < 30`);
    areaBySize[size] = screens;
    assert.ok(Math.abs(core.col - cols / 2) <= 1 && Math.abs(core.row - rows / 2) <= 1, `${where}: core (${core.col},${core.row}) not at centre of ${cols}×${rows}`);

    // Core clearing open; deposits / relics keep a 1-tile clearing.
    const radius = COLONY_TUNING.map.coreClearing;
    for (let r = core.row - radius; r <= core.row + radius; r += 1) {
      for (let c = core.col - radius; c <= core.col + radius; c += 1) {
        if (Math.hypot(c - core.col, r - core.row) > radius) continue;
        assert.equal(map.blocked[r * cols + c], 0, `${where}: core clearing tile (${c},${r}) blocked`);
      }
    }
    const reserved = new Uint8Array(cols * rows);
    for (const d of map.deposits) {
      for (let dr = -1; dr <= 2; dr += 1) {
        for (let dc = -1; dc <= 2; dc += 1) {
          const c = d.col + dc;
          const r = d.row + dr;
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          reserved[r * cols + c] = 1;
          assert.equal(map.blocked[r * cols + c], 0, `${where}: ${d.kind} deposit at (${d.col},${d.row}) has blocked tile (${c},${r}) in its clearing`);
        }
      }
      const dist = Math.hypot(d.col + 1 - core.col, d.row + 1 - core.row);
      if (d.purity === 2) assert.ok(dist > 8, `${where}: pure ${d.kind} patch ${dist.toFixed(1)} tiles from the core (none within 8)`);
      const band = PURITY_BANDS.findIndex((edge) => dist <= edge);
      const slot = bandPurity[band];
      if (slot !== undefined) {
        slot.pure += d.purity === 2 ? 1 : 0;
        slot.n += 1;
      }
    }
    for (const relic of map.relics) {
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const c = relic.col + dc;
          const r = relic.row + dr;
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          reserved[r * cols + c] = 1;
          assert.equal(map.blocked[r * cols + c], 0, `${where}: relic ${relic.id} at (${relic.col},${relic.row}) has blocked tile (${c},${r}) in its clearing`);
        }
      }
    }

    // Props: one per tile, off every clearing, same kind ≥ 900 px apart.
    assert.ok(map.props.length > 0, `${where}: no world props`);
    totalProps += map.props.length;
    const propAt = new Map<number, string>();
    const byKind = new Map<string, Array<{ col: number; row: number }>>();
    for (const p of map.props) {
      const i = p.row * cols + p.col;
      assert.ok(!propAt.has(i), `${where}: props overlap at (${p.col},${p.row})`);
      propAt.set(i, p.id);
      assert.equal(reserved[i], 0, `${where}: prop ${p.id} at (${p.col},${p.row}) sits in a deposit/relic clearing`);
      assert.ok(Math.hypot(p.col - core.col, p.row - core.row) > radius, `${where}: prop ${p.id} inside the core clearing`);
      const list = byKind.get(p.id) ?? [];
      for (const q of list) {
        const px = Math.hypot(p.col - q.col, p.row - q.row) * TILE;
        assert.ok(px >= 900, `${where}: two ${p.id} props ${px.toFixed(0)} px apart (< 900)`);
      }
      list.push({ col: p.col, row: p.row });
      byKind.set(p.id, list);
    }
    // ≥ 3 kinds on every screen (the map tiled into 720 × 1280 screens, as cert `composition` walks it) holding ≥ 3 props.
    for (let r0 = 0; r0 + SCREEN_H_TILES <= rows; r0 += SCREEN_H_TILES) {
      for (let c0 = 0; c0 + SCREEN_W_TILES <= cols; c0 += SCREEN_W_TILES) {
        const kinds = new Set<string>();
        let count = 0;
        for (const p of map.props) {
          if (p.col < c0 || p.col >= c0 + SCREEN_W_TILES || p.row < r0 || p.row >= r0 + SCREEN_H_TILES) continue;
          count += 1;
          kinds.add(p.id);
        }
        screensChecked += 1;
        if (count < 3) continue;
        screensWithProps += 1;
        if (kinds.size < 3) thinScreens.push(`${where} screen (${c0},${r0}): ${count} props, ${kinds.size} kind(s)`);
      }
    }
    if (size === 'frontier') poiMedians.push(nearestNeighbourMedian(pois(map)));
  }
}

assert.equal(thinScreens.length, 0, `${thinScreens.length}/${screensWithProps} screens with ≥ 3 props show < 3 kinds, first: ${thinScreens.slice(0, 3).join('; ')}`);
assert.ok(areaBySize.frontier < areaBySize.expanse && areaBySize.expanse < areaBySize.continent, `map sizes not rising: ${JSON.stringify(areaBySize)}`);
const pureShare = bandPurity.map((b) => (b.n > 0 ? b.pure / b.n : Number.NaN));
for (let i = 1; i < pureShare.length; i += 1) {
  assert.ok((pureShare[i] ?? 0) > (pureShare[i - 1] ?? 0), `pure share not rising with distance: ${pureShare.map((m) => m.toFixed(2)).join(' → ')}`);
}
poiMedians.sort((a, b) => a - b);
const poiMedian = poiMedians[Math.floor(poiMedians.length / 2)] ?? Infinity;
assert.ok(poiMedian >= 1200 && poiMedian <= 2200, `Frontier POI nearest-neighbour median ${poiMedian.toFixed(0)} px (must be 1,200-2,200)`);

console.log(`screens: frontier ${areaBySize.frontier.toFixed(1)}, expanse ${areaBySize.expanse.toFixed(1)}, continent ${areaBySize.continent.toFixed(1)}`);
console.log(`pure share by core distance (≤8, ≤14, beyond): ${pureShare.map((m) => m.toFixed(2)).join(' → ')}`);
console.log(`Frontier POI nearest-neighbour median ${poiMedian.toFixed(0)} px; ${totalProps} props, ${screensWithProps}/${screensChecked} screens with ≥ 3 props all ≥ 3 kinds`);
console.log(`colonyMap OK — ${SEEDS} seeds × ${SIZES.length} sizes`);
