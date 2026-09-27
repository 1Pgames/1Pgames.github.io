/**
 * Seeded site map (PRD §5.2 deposits + relics, §5.4 sites, §1c world-scale
 * and density budgets): Lander Core at the centre, 2×2 deposit patches whose
 * purity rises with distance (counts × site `depositMul` × map area), the four
 * Relic Site kinds spread by best-candidate sampling past their distance
 * floors, rock clusters (and 3-5 cliff ridges with passes on chokepoint sites)
 * drawn from the biome's blocker sheet, single world props from the shared +
 * biome prop sheets, and a blobby floor-variant field. Headless and
 * deterministic: one seed → one map; every open tile stays reachable from the
 * core (each blocker batch is flood-checked and pockets are filled).
 * Site `purityShift` is applied by `model/state.ts:createColony`, not here.
 */
import { Rng } from '../../../core/rng';
import { COLONY_TUNING } from '../tuning';
import { RELICS, type DepositKind, type Purity, type RelicId, type SiteDef } from '../content';

export type MapSize = 'frontier' | 'expanse' | 'continent';
export interface Deposit { kind: DepositKind; purity: Purity; col: number; row: number }
export interface Relic { id: RelicId; col: number; row: number; claimed: boolean }
/** A blocker sprite: `key` = `<artBiome>-blockers`, `frame` 0-8; `size` tiles square from (col, row). */
export interface Blocker { key: string; frame: number; col: number; row: number; size: 1 | 2 }
/** A single world prop on one tile (the tile is blocked): `id` = `prop-<sheet>-<n>` from art/wiring.md §5. */
export interface Prop { id: string; key: string; frame: number; col: number; row: number }
export interface SiteMap {
  cols: number; rows: number;
  /** Terrain mask (rocks, cliffs, props): 1 = no building, no walking. */
  blocked: Uint8Array;
  biome: SiteDef['biome'];
  /** Art biome stem for `<artBiome>-floor-{a,b,c}`, `<artBiome>-blockers`, `props-<artBiome>-*` (mire → ember). */
  artBiome: 'steppe' | 'rime' | 'ember' | 'nacre';
  site: SiteDef; rung: number; size: MapSize;
  deposits: Deposit[]; relics: Relic[]; props: Prop[]; blockers: Blocker[];
  /** Pass tiles through the cliff ridges of a chokepoint site (empty elsewhere). */
  passes: Array<{ col: number; row: number }>;
  /** Floor variant per tile (0 a, 1 b, 2 c): low-frequency noise, so variant regions are blobs, never straight seams. */
  floor: Uint8Array;
  /** Flow-field window radius in tiles around the core (0 = whole map; Continent uses a window, PRD §15). */
  navWindow: number;
  /** Centre tile of the 3×3 Lander Core. */
  core: { col: number; row: number };
}

const T = COLONY_TUNING.map;

/** PRD §1c map-size scale against the 72 × 96 Frontier. */
const SIZE_SCALE: Readonly<Record<MapSize, number>> = T.sizeScale;
/** PRD §15: `buildFlowFieldWindow` radius for the Continent. */
const CONTINENT_NAV_WINDOW = T.continentNavWindow;
/** PRD §1c density: target props per 720 × 1280 screen (≥ 3 kinds per screen in ≥ 90 % of windows). */
const PROPS_PER_SCREEN = T.propsPerScreen;
/** Prop draw 80 px + 60 px gap ⇒ centres ≥ 140 px. */
const PROP_SPACING_TILES = T.propSpacingTiles;
/** Same prop kind ≥ 900 px apart. */
const PROP_SAME_KIND_TILES = T.propSameKindTiles;
/** Prop (40 px half) vs blocker (32 px half) + 60 px gap ⇒ centre distance² floor. */
const PROP_BLOCKER_D2 = T.propBlockerD2;
/** Relic Sites spread: best of this many candidates by distance to the nearest other relic. */
const RELIC_CANDIDATES = T.relicCandidates;
/** Chokepoint sites (Nacre Shelf): cliff ridges on this core-distance band, one pass each. */
const RIDGE_RADIUS: readonly [number, number] = T.ridge.radius;
const RIDGE_HALF_SPAN_RAD: readonly [number, number] = T.ridge.halfSpanRad;
const RIDGE_PASS_HALF_TILES = T.ridge.passHalfTiles;
/** Inner guarantees keep every patch tile this many tiles off both core axes (the swarms' approach lanes, ± 1.5 around the 3-wide core). */
const INNER_OFF_AXIS = 1.5;
/** The extra inner lenses (rung-1 crystal, second ice) may sit this close to another patch (the 1-tile gap still holds). */
const INNER_SPACING = 3;

const ART_BIOME: Record<SiteDef['biome'], SiteMap['artBiome']> = { steppe: 'steppe', rime: 'rime', mire: 'ember', nacre: 'nacre' };
/** Blocker frames (art/briefs/reports/terrain.md frame map): rocks, cliff pieces, 2×2 masses; spares 6-8 weighted low. */
const ROCK_FRAMES: readonly number[] = [0, 2, 3, 0, 2, 3, 1, 5, 6, 7, 8];
const CLIFF_FRAMES: readonly number[] = [4, 5, 4, 5, 1];
const MASS_FRAMES: readonly number[] = [1, 3, 8];
/** ember frame 7 reads as a horned skull: never tiled in rock fields. */
const EMBER_SKULL_FRAME = 7;
const SHARED_PROPS = 18;
const BIOME_PROPS = 27;
const PROPS_PER_SHEET = 9;

const SCREEN_TILES = (720 * 1280) / (T.tilePx * T.tilePx);
/** No two props of one kind inside any 720 × 1280 window: every screen's props are all distinct kinds. */
const SCREEN_COLS = Math.ceil(720 / T.tilePx) + 1;
const SCREEN_ROWS = Math.ceil(1280 / T.tilePx) + 1;

function rollPurity(rng: Rng, dist: number): Purity {
  for (const [maxDist, impure, normal] of T.purityBands) {
    if (dist > maxDist) continue;
    const roll = rng.next();
    if (roll < impure) return 0;
    if (roll < impure + normal) return 1;
    return 2;
  }
  return 1;
}

/** Tile tags while generating. */
const OPEN = 0;
const ROCK = 1;
const CLIFF = 2;
const PROP = 3;

export function generateSite(site: SiteDef, rung: number, seed: string, size: MapSize): SiteMap {
  const rng = new Rng(`${seed}:site:${site.id}`);
  const scale = SIZE_SCALE[size];
  const area = scale * scale;
  const cols = Math.round(T.cols * scale);
  const rows = Math.round(T.rows * scale);
  const n = cols * rows;
  const core = { col: Math.floor(cols / 2), row: Math.floor(rows / 2) };
  const artBiome = ART_BIOME[site.biome];
  const blocked = new Uint8Array(n);
  const tag = new Uint8Array(n);
  // Tiles reserved by the core, deposits and relics (no rock, no prop, no other patch).
  const reserved = new Uint8Array(n);
  const reservedList: number[] = [];
  const idx = (c: number, r: number): number => r * cols + c;
  const inBounds = (c: number, r: number): boolean => c >= 0 && r >= 0 && c < cols && r < rows;
  const distCore = (c: number, r: number): number => Math.hypot(c - core.col, r - core.row);
  const reserve = (c: number, r: number): void => {
    const i = idx(c, r);
    if (reserved[i] === 1) return;
    reserved[i] = 1;
    reservedList.push(i);
  };

  for (let r = core.row - 1; r <= core.row + 1; r += 1) {
    for (let c = core.col - 1; c <= core.col + 1; c += 1) reserve(c, r);
  }

  // ── deposits ───────────────────────────────────────────────────────────
  const deposits: Deposit[] = [];
  const patchFree = (c: number, r: number, margin: number): boolean => {
    for (let dr = -margin; dr < 2 + margin; dr += 1) {
      for (let dc = -margin; dc < 2 + margin; dc += 1) {
        const cc = c + dc;
        const rr = r + dr;
        if (!inBounds(cc, rr)) return false;
        if (reserved[idx(cc, rr)] === 1) return false;
      }
    }
    return true;
  };
  const addDeposit = (kind: DepositKind, purity: Purity, c: number, r: number): void => {
    deposits.push({ kind, purity, col: c, row: r });
    for (let dr = 0; dr < 2; dr += 1) for (let dc = 0; dc < 2; dc += 1) reserve(c + dc, r + dr);
  };
  /**
   * One patch at core distance [minDist, maxDist]; `quadrant` (0 N, 1 E, 2 S, 3 W), `diag` (0 NE, 1 SE,
   * 2 SW, 3 NW), `offAxis` (every tile of the patch at least this many tiles off both core axes, where
   * the edge swarms funnel in) or `near` (a patch centre it must sit within `nearTiles` of) narrow the
   * search; `spacing` overrides `map.minDepositSpacing` for this patch;
   * `draw` is the stream it samples.
   */
  const tryPlace = (
    kind: DepositKind,
    minDist: number,
    maxDist: number,
    fixedPurity: Purity | null,
    opts: { quadrant?: number; avoidQuadrant?: number; diag?: number; offAxis?: number; spacing?: number; near?: { col: number; row: number }; nearTiles?: number } = {},
    draw: Rng = rng,
  ): Deposit | null => {
    // Sample inside the distance band's bounding box: a whole-map draw almost never lands in the small
    // inner disc, which left ~4 % of maps without a guaranteed patch (PRD §5.2: 2 ore + ice + vent inside r6).
    const reach = Math.ceil(maxDist) + 1;
    const cLo = Math.max(1, core.col - reach);
    const cHi = Math.min(cols - 3, core.col + reach);
    const rLo = Math.max(1, core.row - reach);
    const rHi = Math.min(rows - 3, core.row + reach);
    for (let attempt = 0; attempt < 2000; attempt += 1) {
      const c = draw.int(cLo, cHi);
      const r = draw.int(rLo, rHi);
      const dx = c + 0.5 - core.col;
      const dy = r + 0.5 - core.row;
      const d = Math.hypot(dx, dy);
      if (d < minDist || d > maxDist) continue;
      const quad = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
      if (opts.quadrant !== undefined && quad !== opts.quadrant) continue;
      if (opts.avoidQuadrant !== undefined && quad === opts.avoidQuadrant) continue;
      if (opts.diag !== undefined && ((dx > 0) !== (opts.diag === 0 || opts.diag === 1) || (dy > 0) !== (opts.diag === 1 || opts.diag === 2))) continue;
      // The patch spans its centre ± 1 tile; the core's axis lanes span ± 1.5 tiles of the core centre.
      if (opts.offAxis !== undefined && Math.min(Math.abs(dx), Math.abs(dy)) - 1 < opts.offAxis) continue;
      if (opts.near !== undefined && Math.hypot(c - opts.near.col, r - opts.near.row) > (opts.nearTiles ?? 4)) continue;
      if (!patchFree(c, r, 1)) continue;
      let spaced = true;
      for (const other of deposits) {
        if (Math.hypot(other.col - c, other.row - r) < (opts.spacing ?? T.minDepositSpacing)) {
          spaced = false;
          break;
        }
      }
      if (!spaced) continue;
      addDeposit(kind, fixedPurity ?? rollPurity(draw, d), c, r);
      return deposits[deposits.length - 1] ?? null;
    }
    return null;
  };
  const quadrantOf = (p: { col: number; row: number }): number => {
    const dx = p.col + 0.5 - core.col;
    const dy = p.row + 0.5 - core.row;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
  };

  // PRD §5.2 guarantees: 2 ore + 1 ice + 1 vent (normal) inside r6, one per quadrant in a seeded order so the four
  // patches never crowd each other out of the core disc. The vent (the colony's night power) takes the diagonal
  // next to its quadrant, clear of the N/E/S/W approach lanes the edge swarms funnel along (critic final #1: an
  // on-axis inner vent died on nights 4, 5 and 7); the others keep the axis quadrant so the ice lens and the
  // rung-1 crystal below still fit inside r6 ...
  const innerKinds = rng.shuffle<DepositKind>(['ore', 'ore', 'ice', 'vent']);
  innerKinds.forEach((kind, quadrant) => {
    if (kind === 'vent') {
      tryPlace(kind, 3, 5.2, 1, { diag: quadrant, offAxis: INNER_OFF_AXIS }) ?? tryPlace(kind, 3, 5.2, 1, { offAxis: INNER_OFF_AXIS }) ?? tryPlace(kind, 2.8, 5, 1);
      return;
    }
    tryPlace(kind, 3, 4.6, 1, { quadrant }) ?? tryPlace(kind, 2.8, 5, 1);
  });
  // Rung 1 only (Balance amendment, §18: critic build3 never reached a crystal, aurelite 0 all game): one normal
  // crystal inside r6, from its own seeded stream so the rest of the map is unchanged; buildable from sol 3.
  if (rung <= 1) {
    const crystalRng = new Rng(`${seed}:site:${site.id}:crystal1`);
    tryPlace('crystal', 2.8, 5.2, 1, { offAxis: INNER_OFF_AXIS, spacing: INNER_SPACING }, crystalRng) ?? tryPlace('crystal', 2.5, 5.4, 1, { spacing: INNER_SPACING }, crystalRng);
  }
  // ... then ring 2: a normal ore at d 7-9 (relay A) and a normal ice + vent pair at d 8-10 in another quadrant (relay B).
  const ring2Ore = tryPlace('ore', 7, 9, 1);
  const pairIce = tryPlace('ice', 8, 10, 1, ring2Ore !== null ? { avoidQuadrant: quadrantOf(ring2Ore) } : {});
  if (pairIce !== null) {
    tryPlace('vent', 8, 10.5, 1, { quadrant: quadrantOf(pairIce), near: pairIce, nearTiles: 4.5 }) ??
      tryPlace('vent', 7, 11.5, 1, { near: pairIce, nearTiles: 6 });
  }
  // ... and ring 3 (Balance amendment, §18): one normal crystal at d 10-14 so the Beacon chain is a 1-2 relay
  // reach, preferably along relay A's route (near the ring-2 ore), else anywhere in the band.
  (ring2Ore !== null ? tryPlace('crystal', 10, 14, 1, { near: ring2Ore, nearTiles: 7 }) : null) ?? tryPlace('crystal', 10, 14, 1);
  // A second normal ice lens inside r6 (Balance amendment, §18: critic build2 starved on one borer): a second
  // terrace line needs no relay. Its own seeded stream, so every other draw of the map is unchanged.
  const iceRng = new Rng(`${seed}:site:${site.id}:ice2`);
  tryPlace('ice', 2.8, 5.2, 1, { offAxis: INNER_OFF_AXIS, spacing: INNER_SPACING }, iceRng) ?? tryPlace('ice', 2.5, 5.4, 1, { spacing: INNER_SPACING }, iceRng);
  const want = (kind: DepositKind): number => Math.round(T.deposits[kind] * (site.depositMul[kind] ?? 1) * area);
  const placedOf = (kind: DepositKind): number => {
    let k = 0;
    for (const d of deposits) if (d.kind === kind) k += 1;
    return k;
  };
  while (placedOf('ore') < want('ore') && tryPlace('ore', 10, 999, null) !== null);
  while (placedOf('ice') < want('ice') && tryPlace('ice', 10, 999, null) !== null);
  while (placedOf('vent') < want('vent') && tryPlace('vent', 11, 999, null) !== null);
  // Crystal is never seen inside the starting field (buildable from sol 3).
  while (placedOf('crystal') < want('crystal') && tryPlace('crystal', 10, 999, null) !== null);

  // ── relic sites: distance floor per kind, spread by best-candidate sampling ──
  const relics: Relic[] = [];
  const tileFree = (c: number, r: number): boolean => {
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) if (!inBounds(c + dc, r + dr) || reserved[idx(c + dc, r + dr)] === 1) return false;
    }
    return true;
  };
  for (const def of RELICS) {
    const count = Math.max(def.count, Math.round(def.count * area));
    for (let i = 0; i < count; i += 1) {
      let best: { c: number; r: number; d: number } | null = null;
      for (let k = 0, tries = 0; k < RELIC_CANDIDATES && tries < 400; tries += 1) {
        const c = rng.int(2, cols - 3);
        const r = rng.int(2, rows - 3);
        if (distCore(c, r) < def.minDistTiles || !tileFree(c, r)) continue;
        k += 1;
        let near = Infinity;
        for (const o of relics) near = Math.min(near, Math.hypot(o.col - c, o.row - r));
        if (best === null || near > best.d) best = { c, r, d: near };
      }
      if (best === null) continue;
      relics.push({ id: def.id, col: best.c, row: best.r, claimed: false });
      reserve(best.c, best.r);
    }
  }

  // Clearing mask: core disc + 1 tile around every reserved tile (no rock, no prop).
  const clear = new Uint8Array(n);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) if (distCore(c, r) <= T.coreClearing) clear[idx(c, r)] = 1;
  }
  for (const i of reservedList) {
    const r = (i / cols) | 0;
    const c = i - r * cols;
    for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) if (inBounds(c + dc, r + dr)) clear[idx(c + dc, r + dr)] = 1;
  }

  // ── connectivity: every blocker batch is flood-checked from the core ─────
  const seen = new Uint32Array(n);
  const queue = new Int32Array(n);
  let floodGen = 0;
  const flood = (): number => {
    floodGen += 1;
    const g = floodGen;
    const start = idx(core.col, core.row);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = g;
    while (head < tail) {
      const cur = queue[head++] ?? 0;
      const r = (cur / cols) | 0;
      const c = cur - r * cols;
      if (c + 1 < cols && blocked[cur + 1] === 0 && seen[cur + 1] !== g) { seen[cur + 1] = g; queue[tail++] = cur + 1; }
      if (c > 0 && blocked[cur - 1] === 0 && seen[cur - 1] !== g) { seen[cur - 1] = g; queue[tail++] = cur - 1; }
      if (r + 1 < rows && blocked[cur + cols] === 0 && seen[cur + cols] !== g) { seen[cur + cols] = g; queue[tail++] = cur + cols; }
      if (r > 0 && blocked[cur - cols] === 0 && seen[cur - cols] !== g) { seen[cur - cols] = g; queue[tail++] = cur - cols; }
    }
    return g;
  };
  /** Stamps a batch; reverts it when any reserved tile loses its path to the core, else fills sealed pockets. */
  const commit = (tiles: number[], kind: number): boolean => {
    if (tiles.length === 0) return false;
    for (const i of tiles) {
      blocked[i] = 1;
      tag[i] = kind;
    }
    const g = flood();
    for (const i of reservedList) {
      if (seen[i] === g) continue;
      for (const t of tiles) {
        blocked[t] = 0;
        tag[t] = OPEN;
      }
      return false;
    }
    for (let i = 0; i < n; i += 1) {
      if (blocked[i] === 0 && seen[i] !== g) {
        blocked[i] = 1;
        tag[i] = ROCK;
      }
    }
    return true;
  };

  const passes: Array<{ col: number; row: number }> = [];
  if (site.chokepoints) {
    const ridges = rng.int(3, 5);
    const phase = rng.float(0, Math.PI * 2);
    for (let k = 0; k < ridges; k += 1) {
      const mid = phase + ((k + rng.float(0.25, 0.75)) * Math.PI * 2) / ridges;
      const radius = rng.float(RIDGE_RADIUS[0], RIDGE_RADIUS[1]) * scale;
      const half = rng.float(RIDGE_HALF_SPAN_RAD[0], RIDGE_HALF_SPAN_RAD[1]);
      const passAt = mid + rng.float(-half * 0.4, half * 0.4);
      const tiles: number[] = [];
      const steps = Math.ceil(radius * half * 2 * 2);
      for (let s = 0; s <= steps; s += 1) {
        const a = mid - half + (2 * half * s) / steps;
        if (Math.abs(a - passAt) * radius < RIDGE_PASS_HALF_TILES) continue;
        for (let th = -1; th <= 0.5; th += 0.75) {
          const c = Math.round(core.col + Math.cos(a) * (radius + th));
          const r = Math.round(core.row + Math.sin(a) * (radius + th));
          if (!inBounds(c, r)) continue;
          const i = idx(c, r);
          if (clear[i] === 1 || blocked[i] === 1 || tiles.includes(i)) continue;
          tiles.push(i);
        }
      }
      if (commit(tiles, CLIFF)) {
        const pc = Math.round(core.col + Math.cos(passAt) * radius);
        const pr = Math.round(core.row + Math.sin(passAt) * radius);
        if (inBounds(pc, pr)) passes.push({ col: pc, row: pr });
      }
    }
  }

  // Rock clusters: blocked, the core clearing and 1 tile around reserved tiles stay open.
  const clusters = Math.round(T.rockClusters * area);
  const batch: number[] = [];
  for (let i = 0; i < clusters; i += 1) {
    const cx = rng.int(0, cols - 1);
    const cy = rng.int(0, rows - 1);
    const radius = rng.float(0.8, 2.2);
    if (distCore(cx, cy) <= T.coreClearing + 2) continue;
    batch.length = 0;
    for (let r = Math.floor(cy - radius); r <= Math.ceil(cy + radius); r += 1) {
      for (let c = Math.floor(cx - radius); c <= Math.ceil(cx + radius); c += 1) {
        if (!inBounds(c, r) || Math.hypot(c - cx, r - cy) > radius) continue;
        const t = idx(c, r);
        if (clear[t] === 1 || blocked[t] === 1) continue;
        batch.push(t);
      }
    }
    commit(batch, ROCK);
  }

  // ── props: single tiles, spaced, kinds spread, never in a clearing ──────
  const kinds: Array<{ id: string; key: string; frame: number; at: number[] }> = [];
  for (let k = 0; k < SHARED_PROPS; k += 1) kinds.push({ id: `prop-shared-${k + 1}`, key: `props-shared-${Math.floor(k / PROPS_PER_SHEET)}`, frame: k % PROPS_PER_SHEET, at: [] });
  for (let k = 0; k < BIOME_PROPS; k += 1) kinds.push({ id: `prop-${artBiome}-${k + 1}`, key: `props-${artBiome}-${Math.floor(k / PROPS_PER_SHEET)}`, frame: k % PROPS_PER_SHEET, at: [] });
  const props: Prop[] = [];
  const propTarget = Math.round((n / SCREEN_TILES) * PROPS_PER_SCREEN);
  const sameKind2 = PROP_SAME_KIND_TILES * PROP_SAME_KIND_TILES;
  const spacing = PROP_SPACING_TILES;
  const propOk = (c: number, r: number): boolean => {
    if (c < 1 || r < 1 || c >= cols - 1 || r >= rows - 1) return false;
    if (clear[idx(c, r)] === 1 || blocked[idx(c, r)] === 1) return false;
    for (let dr = -spacing; dr <= spacing; dr += 1) {
      for (let dc = -spacing; dc <= spacing; dc += 1) {
        const cc = c + dc;
        const rr = r + dr;
        if (!inBounds(cc, rr)) continue;
        const d2 = dc * dc + dr * dr;
        const t = tag[idx(cc, rr)];
        if (t === PROP && d2 < spacing * spacing) return false;
        if ((t === ROCK || t === CLIFF) && d2 < PROP_BLOCKER_D2) return false;
      }
    }
    return true;
  };
  // Stratified: one pass per cell of a coarse lattice so every screen gets its share.
  const cell = Math.max(spacing + 1, Math.round(Math.sqrt(SCREEN_TILES / PROPS_PER_SCREEN)));
  const cellsAcross = Math.ceil(cols / cell);
  const cellsDown = Math.ceil(rows / cell);
  const order: number[] = [];
  for (let i = 0; i < cellsAcross * cellsDown; i += 1) order.push(i);
  rng.shuffle(order);
  for (let pass = 0; pass < 2 && props.length < propTarget; pass += 1) {
    for (const ci of order) {
      if (props.length >= propTarget) break;
      const c0 = (ci % cellsAcross) * cell;
      const r0 = Math.floor(ci / cellsAcross) * cell;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const c = c0 + rng.int(0, cell - 1);
        const r = r0 + rng.int(0, cell - 1);
        if (!propOk(c, r)) continue;
        // Least-used kind that has no twin within 900 px; seeded tie-break.
        let pick: (typeof kinds)[number] | null = null;
        const offset = rng.int(0, kinds.length - 1);
        for (let k = 0; k < kinds.length; k += 1) {
          const kind = kinds[(k + offset) % kinds.length];
          if (kind === undefined || (pick !== null && kind.at.length >= pick.at.length)) continue;
          let far = true;
          for (let a = 0; a < kind.at.length; a += 1) {
            const t = kind.at[a] ?? 0;
            const tr = (t / cols) | 0;
            const dc = t - tr * cols - c;
            const dr = tr - r;
            if (dc * dc + dr * dr < sameKind2 || (Math.abs(dc) < SCREEN_COLS && Math.abs(dr) < SCREEN_ROWS)) {
              far = false;
              break;
            }
          }
          if (far) pick = kind;
        }
        if (pick === null) continue;
        const t = idx(c, r);
        pick.at.push(t);
        blocked[t] = 1;
        tag[t] = PROP;
        props.push({ id: pick.id, key: pick.key, frame: pick.frame, col: c, row: r });
        break;
      }
    }
  }

  // ── blocker sprites from the mask: 2×2 masses where rock fills a square, else single pieces ──
  const key = `${artBiome}-blockers`;
  const blockers: Blocker[] = [];
  const done = new Uint8Array(n);
  const frameAt = new Int8Array(n).fill(-1);
  const rollFrame = (pool: readonly number[], c: number, r: number): number => {
    for (let k = 0; k < 4; k += 1) {
      const f = pool[rng.int(0, pool.length - 1)] ?? 0;
      if (artBiome === 'ember' && f === EMBER_SKULL_FRAME) continue;
      if ((c > 0 && frameAt[idx(c - 1, r)] === f) || (r > 0 && frameAt[idx(c, r - 1)] === f)) continue;
      return f;
    }
    return pool[0] ?? 0;
  };
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = idx(c, r);
      const t = tag[i];
      if (done[i] === 1 || (t !== ROCK && t !== CLIFF)) continue;
      const square =
        t === ROCK && c + 1 < cols && r + 1 < rows &&
        tag[i + 1] === ROCK && tag[i + cols] === ROCK && tag[i + cols + 1] === ROCK &&
        done[i + 1] === 0 && done[i + cols] === 0 && done[i + cols + 1] === 0;
      if (square && rng.chance(0.5)) {
        const f = rollFrame(MASS_FRAMES, c, r);
        blockers.push({ key, frame: f, col: c, row: r, size: 2 });
        for (const j of [i, i + 1, i + cols, i + cols + 1]) {
          done[j] = 1;
          frameAt[j] = f;
        }
        continue;
      }
      const f = rollFrame(t === CLIFF ? CLIFF_FRAMES : ROCK_FRAMES, c, r);
      blockers.push({ key, frame: f, col: c, row: r, size: 1 });
      done[i] = 1;
      frameAt[i] = f;
    }
  }

  // ── floor variants: bilinear value noise on a 7-tile lattice → 3 blobby bands ──
  const floor = new Uint8Array(n);
  const step = 7;
  const lc = Math.ceil(cols / step) + 2;
  const lr = Math.ceil(rows / step) + 2;
  const lattice = new Float32Array(lc * lr);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = rng.next();
  for (let r = 0; r < rows; r += 1) {
    const fy = r / step;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    for (let c = 0; c < cols; c += 1) {
      const fx = c / step;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const a = lattice[y0 * lc + x0] ?? 0;
      const b = lattice[y0 * lc + x0 + 1] ?? 0;
      const d = lattice[(y0 + 1) * lc + x0] ?? 0;
      const e = lattice[(y0 + 1) * lc + x0 + 1] ?? 0;
      const v = (a + (b - a) * sx) * (1 - sy) + (d + (e - d) * sx) * sy;
      floor[idx(c, r)] = v < 0.4 ? 0 : v < 0.62 ? 1 : 2;
    }
  }

  return {
    cols,
    rows,
    blocked,
    biome: site.biome,
    artBiome,
    site,
    rung,
    size,
    deposits,
    relics,
    props,
    blockers,
    passes,
    floor,
    navWindow: size === 'continent' ? CONTINENT_NAV_WINDOW : 0,
    core,
  };
}
