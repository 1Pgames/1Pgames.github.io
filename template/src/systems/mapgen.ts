/**
 * World generation for camera-scrolled worlds: pure TS, no Phaser import,
 * deterministic on `Rng(\`world:${world.id}:${seed}\`)` — same seed ⇒
 * byte-identical output (only `metrics.ms` differs). Ported and generalised
 * from duskhaul `systems/mapgen.ts`; `systems/arena.ts` renders the result and
 * `sim/kits/mapgen.selftest.ts` asserts every composition law below.
 *
 * Pipeline (placement is ALGORITHMIC — best-candidate blue noise, MST,
 * distance tests; the RNG only breaks ties and picks variants):
 *
 *   1 spawn      within `arena.spawnJitter` of the world centre; `depthAt`
 *                rises from 0 there to 1 at the walls (danger/loot depth)
 *   2 roads      (`WorldDef.roads`) blue-noise road nodes `roadNodeSpacing`
 *                apart, Prim MST from the spawn + `roadLoopRatio` loops, each
 *                edge a bent 3-piece polyline `roadWidth` wide
 *   3 landmarks  (`WorldDef.landmarks`, none in the template) one per road
 *                node, deepest first, each on its own plaza clearing
 *   4 POIs       (`WorldDef.pois`, none in the template) best-candidate
 *                along the roads (≤ `poiRoadMaxPx` off the centreline),
 *                ≥ `poiMinSpacing` apart, in the rule's depth band, each in its
 *                own clearing — roughly one per 2-3 screens
 *   5 props      best-candidate blue noise at `propsPerScreen`; placed SINGLY:
 *                drawn-art circles keep ≥ `propGap` (overlap 0), the same kind
 *                keeps ≥ `sameKindPx` from itself, a kind already present in
 *                the surrounding screen is picked last (variety), never inside
 *                a clearing, on a road or in the wall band
 *   6 decals     `decalsPerScreen`, no overlap with each other or with props,
 *                never more than `decalMaxPerScreen` in any quarter-screen-lattice
 *                screen window, off roads and clearings
 *   7 floor      3 variants per `tileSize` tile from smoothed value noise at
 *                exact tertiles (the arena feather-blends them: no seams)
 *   8 nav        `navCell` raster: prop bodies + actor inflation and the wall
 *                band are blocked; the flood from the spawn seals unreachable
 *                crevices so every open cell is reachable
 *
 * Singly placed props with ≥ 60 px art gaps cannot seal a corridor, so no
 * repair pass is needed: reachability is a law the selftest asserts.
 */
import { TUNING, VIEW } from '../config';
import { Rng } from '../core/rng';
import { propArtRadius, propBodyRadius, type PropDef } from '../data/props';
import type { PoiRule, WorldDef } from '../data/world';

export interface Point {
  x: number;
  y: number;
}

export interface PlacedProp {
  id: string;
  x: number;
  y: number;
  bodyRadius: number;
  /** Drawn-art circle radius (the no-overlap rule's circle). */
  artRadius: number;
  /** Landmarks are placed props too, flagged so a game can draw them on a map. */
  landmark?: true;
}

export interface PlacedDecal {
  id: string;
  x: number;
  y: number;
  rot: number;
  alpha: number;
  radius: number;
}

export interface RoadSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface PoiAnchor {
  id: string;
  kind: string;
  x: number;
  y: number;
  /** Clearing radius: no prop body/art and no decal inside it. */
  radius: number;
  /** `depthAt` of the anchor, rounded to 3 decimals. */
  depth: number;
}

export interface NavRaster {
  cols: number;
  rows: number;
  cell: number;
  /** 1 = blocked (prop body + inflation, wall band, sealed crevice). */
  blocked: Uint8Array;
}

export interface GeneratedWorld {
  seed: string;
  world: string;
  width: number;
  height: number;
  spawn: Point;
  floor: { cell: number; cols: number; rows: number; variant: Uint8Array };
  roads: RoadSegment[];
  roadWidth: number;
  props: PlacedProp[];
  decals: PlacedDecal[];
  pois: PoiAnchor[];
  nav: NavRaster;
  metrics: { screens: number; sealedCells: number; ms: number };
}

/** Actor body inflation used by the nav raster (enemy bodies are ~18-40 px). */
const NAV_INFLATE = 24;
/** Nothing that must be walked to sits closer than this to the wall band. */
const EDGE_MARGIN = 220;
/** Neighbour-bucket size for prop/decal proximity queries. */
const BUCKET = 256;
/** Candidates per best-candidate draw. */
const CANDIDATES = 10;
/** Radius of the "already in this screen" variety test. */
const VARIETY_PX = 640;
/** Floor noise lattice, in floor tiles. */
const FLOOR_NOISE_TILES = 3;
/** Decal cap windows are screen-sized, on a lattice of 1/this screen steps (the selftest measures the same windows). */
export const DECAL_LATTICE = 4;
/** Candidates per POI anchor (along the roads). */
const POI_CANDIDATES = 400;
/** Preferred distance to the nearest placed POI, in `poiMinSpacing` units. */
const POI_ROOM_TARGET = 1.25;
/** Seeded placement passes; the fullest ships. */
const POI_PASSES = 6;

const SCREEN_AREA = VIEW.width * VIEW.height;

// ─────────────────────────────── public API ────────────────────────────────

/** The default world pipeline (file header). Pure and deterministic. */
export function generateWorld(world: WorldDef, seed: string): GeneratedWorld {
  const t0 = performance.now();
  const cfg = TUNING.arena;
  const W = cfg.width;
  const H = cfg.height;
  const rng = new Rng(`world:${world.id}:${seed}`);

  // 1 spawn ─────────────────────────────────────────────────────────────
  const spawnAngle = rng.float(0, Math.PI * 2);
  const spawnOff = rng.float(0, cfg.spawnJitter);
  const spawn = { x: Math.round(W / 2 + Math.cos(spawnAngle) * spawnOff), y: Math.round(H / 2 + Math.sin(spawnAngle) * spawnOff) };
  const clearings: Circle[] = [{ x: spawn.x, y: spawn.y, r: cfg.spawnClearRadius }];

  // 2 roads ─────────────────────────────────────────────────────────────
  const nodes: Point[] = [spawn];
  if (world.roads || world.landmarks.length > 0) {
    nodes.push(...blueNoise(rng, W, H, cfg.roadNodeSpacing, EDGE_MARGIN + 300, [spawn]));
  }
  const roads = world.roads ? buildRoads(rng, nodes, cfg.roadLoopRatio, W, H) : [];
  const roadClear = world.roads ? cfg.roadWidth / 2 : 0;
  const roadDist = (x: number, y: number): number => segmentsDistance(roads, x, y);

  const props: PlacedProp[] = [];
  const propBuckets = new Buckets<PlacedProp>(W, H);
  const defs: Record<string, PropDef> = {};
  for (const def of world.props) defs[def.id] = def;

  // 3 landmarks ─────────────────────────────────────────────────────────
  const landmarkNodes = nodes.slice(1).sort((a, b) => depthFrom(spawn, W, H, b.x, b.y) - depthFrom(spawn, W, H, a.x, a.y));
  world.landmarks.forEach((lm, i) => {
    const node = landmarkNodes[i];
    const def = defs[lm.propId];
    if (node === undefined || def === undefined) return;
    const placed: PlacedProp = { id: def.id, x: node.x, y: node.y, bodyRadius: propBodyRadius(def), artRadius: propArtRadius(def), landmark: true };
    props.push(placed);
    propBuckets.add(placed);
    clearings.push({ x: node.x, y: node.y, r: lm.plaza });
  });

  // 4 POIs ──────────────────────────────────────────────────────────────
  const pois = placePois(rng, world.pois, roads, spawn, W, H, clearings);
  for (const p of pois) clearings.push({ x: p.x, y: p.y, r: p.radius });

  // 5 props ─────────────────────────────────────────────────────────────
  const screens = (W * H) / SCREEN_AREA;
  const target = Math.round(cfg.propsPerScreen * screens);
  const kinds = world.props;
  const weights = kinds.map((k) => k.weight);
  const byKind: Record<string, Buckets<PlacedProp>> = {};
  const wall = cfg.wallThickness;
  let misses = 0;
  while (props.length < target && misses < 300 && kinds.length > 0) {
    // Best candidate: the most room to the nearest prop, so the field fills evenly.
    let best: Point | null = null;
    let bestRoom = -1;
    for (let c = 0; c < CANDIDATES; c += 1) {
      const x = rng.float(wall + EDGE_MARGIN / 2, W - wall - EDGE_MARGIN / 2);
      const y = rng.float(wall + EDGE_MARGIN / 2, H - wall - EDGE_MARGIN / 2);
      const room = propBuckets.nearest(x, y, 900);
      if (room > bestRoom) {
        bestRoom = room;
        best = { x, y };
      }
    }
    const at = best!;
    const local = new Set<string>();
    propBuckets.forEachWithin(at.x, at.y, VARIETY_PX, (p) => local.add(p.id));
    const allowed: PropDef[] = [];
    const allowedWeights: number[] = [];
    const fresh: PropDef[] = [];
    const freshWeights: number[] = [];
    for (let k = 0; k < kinds.length; k += 1) {
      const def = kinds[k]!;
      const art = propArtRadius(def);
      if (at.x - art < wall + 24 || at.y - art < wall + 24 || at.x + art > W - wall - 24 || at.y + art > H - wall - 24) continue;
      if (clearings.some((c) => Math.hypot(at.x - c.x, at.y - c.y) < c.r + Math.max(art, propBodyRadius(def)))) continue;
      if (roadClear > 0 && roadDist(at.x, at.y) < roadClear + art + 10) continue;
      if (propBuckets.anyWithin(at.x, at.y, art + 2 * BUCKET, (p, d) => d < art + p.artRadius + cfg.propGap)) continue;
      const same = byKind[def.id];
      if (same !== undefined && same.nearest(at.x, at.y, cfg.sameKindPx) < cfg.sameKindPx) continue;
      allowed.push(def);
      allowedWeights.push(weights[k]!);
      if (!local.has(def.id)) {
        fresh.push(def);
        freshWeights.push(weights[k]!);
      }
    }
    if (allowed.length === 0) {
      misses += 1;
      continue;
    }
    const def = fresh.length > 0 ? rng.pickWeighted(fresh, freshWeights) : rng.pickWeighted(allowed, allowedWeights);
    const placed: PlacedProp = { id: def.id, x: Math.round(at.x), y: Math.round(at.y), bodyRadius: propBodyRadius(def), artRadius: propArtRadius(def) };
    props.push(placed);
    propBuckets.add(placed);
    (byKind[def.id] ??= new Buckets<PlacedProp>(W, H)).add(placed);
  }

  // 6 decals ────────────────────────────────────────────────────────────
  const decals = placeDecals(rng, world, W, H, screens, clearings, propBuckets, roadClear > 0 ? roadDist : null, roadClear);

  // 7 floor ─────────────────────────────────────────────────────────────
  const floor = floorVariants(rng, W, H, cfg.tileSize);

  // 8 nav ───────────────────────────────────────────────────────────────
  const { nav, sealed } = buildNav(W, H, { x: wall, y: wall, w: W - wall * 2, h: H - wall * 2 }, props, spawn);

  return {
    seed,
    world: world.id,
    width: W,
    height: H,
    spawn,
    floor,
    roads,
    roadWidth: world.roads ? cfg.roadWidth : 0,
    props,
    decals,
    pois,
    nav,
    metrics: { screens: Math.round(screens * 100) / 100, sealedCells: sealed, ms: performance.now() - t0 },
  };
}

/**
 * Depth of a world point: 0 at the spawn, 1 at the walls, measured per axis
 * toward the wall on that side (rectangular rings, so a portrait world's depth
 * bands follow its shape). Danger and loot depth rise with it.
 */
export function depthAt(world: Pick<GeneratedWorld, 'spawn' | 'width' | 'height'>, x: number, y: number): number {
  return depthFrom(world.spawn, world.width, world.height, x, y);
}

/**
 * Enemy difficulty multiplier at a depth: exactly 1 inside the spawn band
 * (depth ≤ 1/3), rising linearly to `1 + arena.depthDanger` at the wall.
 * `systems/combat.ts` scales every spawn by it at the PLAYER's depth.
 */
export function depthDangerMul(depth: number): number {
  return 1 + TUNING.arena.depthDanger * Math.max(0, Math.min(1, (depth - 1 / 3) / (2 / 3)));
}

/**
 * The nav raster for any prop set (generated or authored): cells outside
 * `walkable` or within a prop body + `NAV_INFLATE` are blocked, then every
 * open cell the 4-neighbour flood from `spawn` cannot reach is sealed.
 */
export function buildNav(
  width: number,
  height: number,
  walkable: { x: number; y: number; w: number; h: number },
  props: readonly { x: number; y: number; bodyRadius: number }[],
  spawn: Point,
): { nav: NavRaster; sealed: number } {
  const cell = TUNING.arena.navCell;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const blocked = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    const cy = r * cell + cell / 2;
    for (let c = 0; c < cols; c += 1) {
      const cx = c * cell + cell / 2;
      if (cx < walkable.x + NAV_INFLATE || cy < walkable.y + NAV_INFLATE || cx > walkable.x + walkable.w - NAV_INFLATE || cy > walkable.y + walkable.h - NAV_INFLATE) {
        blocked[r * cols + c] = 1;
      }
    }
  }
  for (const p of props) {
    const reach = p.bodyRadius + NAV_INFLATE;
    const c0 = Math.max(0, Math.floor((p.x - reach) / cell));
    const c1 = Math.min(cols - 1, Math.floor((p.x + reach) / cell));
    const r0 = Math.max(0, Math.floor((p.y - reach) / cell));
    const r1 = Math.min(rows - 1, Math.floor((p.y + reach) / cell));
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        if (Math.hypot(c * cell + cell / 2 - p.x, r * cell + cell / 2 - p.y) < reach) blocked[r * cols + c] = 1;
      }
    }
  }
  // Flood from the spawn; unreached open cells are crevices nobody can walk to.
  const reached = new Uint8Array(cols * rows);
  const queue = new Int32Array(cols * rows);
  const start = Math.floor(spawn.y / cell) * cols + Math.floor(spawn.x / cell);
  let head = 0;
  let tail = 0;
  if (blocked[start] === 0) {
    reached[start] = 1;
    queue[tail++] = start;
  }
  while (head < tail) {
    const cur = queue[head++]!;
    const r = (cur / cols) | 0;
    const c = cur - r * cols;
    const visit = (n: number): void => {
      if (blocked[n] === 1 || reached[n] === 1) return;
      reached[n] = 1;
      queue[tail++] = n;
    };
    if (c + 1 < cols) visit(cur + 1);
    if (c > 0) visit(cur - 1);
    if (r + 1 < rows) visit(cur + cols);
    if (r > 0) visit(cur - cols);
  }
  let sealed = 0;
  for (let i = 0; i < blocked.length; i += 1) {
    if (blocked[i] === 0 && reached[i] === 0) {
      blocked[i] = 1;
      sealed += 1;
    }
  }
  return { nav: { cols, rows, cell, blocked }, sealed };
}

// ─────────────────────────────── internals ─────────────────────────────────

interface Circle {
  x: number;
  y: number;
  r: number;
}

function depthFrom(spawn: Point, W: number, H: number, x: number, y: number): number {
  const dx = x - spawn.x;
  const dy = y - spawn.y;
  const sx = Math.abs(dx) / Math.max(1, dx >= 0 ? W - spawn.x : spawn.x);
  const sy = Math.abs(dy) / Math.max(1, dy >= 0 ? H - spawn.y : spawn.y);
  return Math.min(1, Math.max(sx, sy));
}

/** Uniform-grid neighbour index over points with an optional payload. */
class Buckets<T extends Point> {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: T[][];

  constructor(width: number, height: number) {
    this.cols = Math.ceil(width / BUCKET);
    this.rows = Math.ceil(height / BUCKET);
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }

  add(item: T): void {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(item.x / BUCKET)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(item.y / BUCKET)));
    this.cells[r * this.cols + c]!.push(item);
  }

  /** Visits items within `radius`; stops early (returning true) when `fn` returns true. */
  anyWithin(x: number, y: number, radius: number, fn: (item: T, dist: number) => boolean): boolean {
    const c0 = Math.max(0, Math.floor((x - radius) / BUCKET));
    const c1 = Math.min(this.cols - 1, Math.floor((x + radius) / BUCKET));
    const r0 = Math.max(0, Math.floor((y - radius) / BUCKET));
    const r1 = Math.min(this.rows - 1, Math.floor((y + radius) / BUCKET));
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        for (const item of this.cells[r * this.cols + c]!) {
          const d = Math.hypot(item.x - x, item.y - y);
          if (d <= radius && fn(item, d)) return true;
        }
      }
    }
    return false;
  }

  forEachWithin(x: number, y: number, radius: number, fn: (item: T) => void): void {
    this.anyWithin(x, y, radius, (item) => {
      fn(item);
      return false;
    });
  }

  /** Distance to the nearest item, capped at `cap`. */
  nearest(x: number, y: number, cap: number): number {
    let best = cap;
    this.anyWithin(x, y, cap, (_item, d) => {
      if (d < best) best = d;
      return false;
    });
    return best;
  }
}

/** Mitchell best-candidate blue noise: points ≥ `spacing` apart (and from `existing`) until the field is full. */
function blueNoise(rng: Rng, W: number, H: number, spacing: number, margin: number, existing: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (let guard = 0; guard < 400; guard += 1) {
    let best: Point | null = null;
    let bestD = -1;
    for (let c = 0; c < 30; c += 1) {
      const x = rng.float(margin, W - margin);
      const y = rng.float(margin, H - margin);
      let d = Infinity;
      for (const p of existing) d = Math.min(d, Math.hypot(p.x - x, p.y - y));
      for (const p of out) d = Math.min(d, Math.hypot(p.x - x, p.y - y));
      if (d > bestD) {
        bestD = d;
        best = { x: Math.round(x), y: Math.round(y) };
      }
    }
    if (best === null || bestD < spacing) break;
    out.push(best);
  }
  return out;
}

/** Prim MST over `nodes` plus the shortest `loopRatio × n` extra edges, each bent into a 3-piece polyline. */
function buildRoads(rng: Rng, nodes: readonly Point[], loopRatio: number, W: number, H: number): RoadSegment[] {
  const n = nodes.length;
  if (n < 2) return [];
  const dist = (a: number, b: number): number => Math.hypot(nodes[a]!.x - nodes[b]!.x, nodes[a]!.y - nodes[b]!.y);
  const inTree = new Uint8Array(n);
  inTree[0] = 1;
  const edges: Array<[number, number]> = [];
  const used = new Set<string>();
  for (let k = 1; k < n; k += 1) {
    let bestA = -1;
    let bestB = -1;
    let bestD = Infinity;
    for (let a = 0; a < n; a += 1) {
      if (inTree[a] === 0) continue;
      for (let b = 0; b < n; b += 1) {
        if (inTree[b] === 1) continue;
        const d = dist(a, b);
        if (d < bestD) {
          bestD = d;
          bestA = a;
          bestB = b;
        }
      }
    }
    inTree[bestB] = 1;
    edges.push([bestA, bestB]);
    used.add(`${Math.min(bestA, bestB)}:${Math.max(bestA, bestB)}`);
  }
  const extra: Array<[number, number, number]> = [];
  for (let a = 0; a < n; a += 1) {
    for (let b = a + 1; b < n; b += 1) if (!used.has(`${a}:${b}`)) extra.push([a, b, dist(a, b)]);
  }
  extra.sort((p, q) => p[2] - q[2]);
  const loops = Math.round(loopRatio * n);
  for (let i = 0; i < loops && i < extra.length; i += 1) edges.push([extra[i]![0], extra[i]![1]]);

  const margin = TUNING.arena.wallThickness + TUNING.arena.roadWidth;
  const segments: RoadSegment[] = [];
  for (const [a, b] of edges) {
    const pa = nodes[a]!;
    const pb = nodes[b]!;
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const nx = -(pb.y - pa.y) / len;
    const ny = (pb.x - pa.x) / len;
    const pts: Point[] = [pa];
    for (const t of [1 / 3, 2 / 3]) {
      const bend = rng.float(-0.12, 0.12) * len;
      pts.push({
        x: Math.round(Math.min(W - margin, Math.max(margin, pa.x + (pb.x - pa.x) * t + nx * bend))),
        y: Math.round(Math.min(H - margin, Math.max(margin, pa.y + (pb.y - pa.y) * t + ny * bend))),
      });
    }
    pts.push(pb);
    for (let i = 0; i + 1 < pts.length; i += 1) segments.push({ ax: pts[i]!.x, ay: pts[i]!.y, bx: pts[i + 1]!.x, by: pts[i + 1]!.y });
  }
  return segments;
}

/** Distance from a point to the nearest road centreline (∞ without roads). */
export function segmentsDistance(segments: readonly RoadSegment[], x: number, y: number): number {
  let best = Infinity;
  for (const s of segments) {
    const vx = s.bx - s.ax;
    const vy = s.by - s.ay;
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - s.ax) * vx + (y - s.ay) * vy) / len2));
    const d = Math.hypot(s.ax + vx * t - x, s.ay + vy * t - y);
    if (d < best) best = d;
  }
  return best;
}

/**
 * POI anchors: rules with the narrowest depth band first, each anchor the
 * candidate (of `POI_CANDIDATES` along the roads, ≤ `poiRoadMaxPx` off the
 * centreline) whose distance to the anchors already placed is closest to
 * `POI_ROOM_TARGET × poiMinSpacing` — anchors chain along the roads at a
 * steady 2-3-screen rhythm instead of scattering to the far corners and
 * leaving no room for the rest. Every anchor sits inside its depth band,
 * ≥ `poiMinSpacing` from every other and clear of the spawn and landmark
 * clearings. Without roads, candidates are uniform.
 */
function placePois(rng: Rng, rules: readonly PoiRule[], roads: readonly RoadSegment[], spawn: Point, W: number, H: number, clearings: readonly Circle[]): PoiAnchor[] {
  if (rules.length === 0) return [];
  // Greedy packing can strand the last anchors; the fullest of a few seeded passes ships.
  let best: PoiAnchor[] = [];
  const asked = rules.reduce((n, r) => n + r.count, 0);
  for (let pass = 0; pass < POI_PASSES && best.length < asked; pass += 1) {
    const out = poiPass(rng, rules, roads, spawn, W, H, clearings);
    if (out.length > best.length) best = out;
  }
  return best;
}

function poiPass(rng: Rng, rules: readonly PoiRule[], roads: readonly RoadSegment[], spawn: Point, W: number, H: number, clearings: readonly Circle[]): PoiAnchor[] {
  const cfg = TUNING.arena;
  const out: PoiAnchor[] = [];
  const lengths = roads.map((s) => Math.hypot(s.bx - s.ax, s.by - s.ay));
  const ordered = [...rules].sort((a, b) => a.depth[1] - a.depth[0] - (b.depth[1] - b.depth[0]));
  const target = cfg.poiMinSpacing * POI_ROOM_TARGET;
  for (const rule of ordered) {
    for (let i = 0; i < rule.count; i += 1) {
      let best: Point | null = null;
      let bestScore = Infinity;
      for (let c = 0; c < POI_CANDIDATES; c += 1) {
        let x: number;
        let y: number;
        if (roads.length > 0) {
          const s = rng.pickWeighted(roads, lengths);
          const t = rng.float(0, 1);
          const len = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
          const off = rng.float(-cfg.poiRoadMaxPx, cfg.poiRoadMaxPx);
          x = s.ax + (s.bx - s.ax) * t + (-(s.by - s.ay) / len) * off;
          y = s.ay + (s.by - s.ay) * t + ((s.bx - s.ax) / len) * off;
        } else {
          x = rng.float(EDGE_MARGIN, W - EDGE_MARGIN);
          y = rng.float(EDGE_MARGIN, H - EDGE_MARGIN);
        }
        const edge = Math.max(EDGE_MARGIN, rule.radius + cfg.wallThickness + 60);
        if (x < edge || y < edge || x > W - edge || y > H - edge) continue;
        const depth = depthFrom(spawn, W, H, x, y);
        if (depth < rule.depth[0] || depth > rule.depth[1]) continue;
        if (clearings.some((k) => Math.hypot(x - k.x, y - k.y) < k.r + rule.radius)) continue;
        let room = Infinity;
        for (const p of out) room = Math.min(room, Math.hypot(p.x - x, p.y - y));
        if (room < cfg.poiMinSpacing) continue;
        const score = Math.abs(Math.min(room, target * 2) - target);
        if (score < bestScore) {
          bestScore = score;
          best = { x: Math.round(x), y: Math.round(y) };
        }
      }
      if (best === null) continue;
      out.push({
        id: `${rule.kind}-${i}`,
        kind: rule.kind,
        x: best.x,
        y: best.y,
        radius: rule.radius,
        depth: Math.round(depthFrom(spawn, W, H, best.x, best.y) * 1000) / 1000,
      });
    }
  }
  return out;
}

/**
 * Floor decals: `decalsPerScreen` over the world, never overlapping each other
 * or a prop's art, never on a road or in a clearing, and never a 4th decal in
 * any screen window of the `DECAL_LATTICE` lattice (so ≤ 3 per screen p95).
 */
function placeDecals(
  rng: Rng,
  world: WorldDef,
  W: number,
  H: number,
  screens: number,
  clearings: readonly Circle[],
  props: Buckets<PlacedProp>,
  roadDist: ((x: number, y: number) => number) | null,
  roadClear: number,
): PlacedDecal[] {
  const cfg = TUNING.arena;
  const out: PlacedDecal[] = [];
  if (world.decals.length === 0) return out;
  const stepX = VIEW.width / DECAL_LATTICE;
  const stepY = VIEW.height / DECAL_LATTICE;
  const wc = Math.ceil(W / stepX) + 1;
  const wr = Math.ceil(H / stepY) + 1;
  const windows = new Uint8Array(wc * wr);
  const buckets = new Buckets<PlacedDecal>(W, H);
  const weights = world.decals.map((d) => d.weight);
  const target = Math.round(cfg.decalsPerScreen * screens);
  const edge = cfg.wallThickness + 60;
  for (let tries = 0; tries < target * 40 && out.length < target; tries += 1) {
    const def = rng.pickWeighted(world.decals, weights);
    const r = def.size / 2;
    // Rounded first: the cap windows must count the coordinates that ship.
    const x = Math.round(rng.float(edge + r, W - edge - r));
    const y = Math.round(rng.float(edge + r, H - edge - r));
    // Windows [i·stepX, i·stepX + 720) containing x are i = ix - LATTICE + 1 … ix.
    const ix = Math.floor(x / stepX);
    const iy = Math.floor(y / stepY);
    let full = false;
    for (let j = iy - DECAL_LATTICE + 1; j <= iy && !full; j += 1) {
      for (let i = ix - DECAL_LATTICE + 1; i <= ix; i += 1) {
        if (i >= 0 && j >= 0 && windows[j * wc + i]! >= cfg.decalMaxPerScreen) full = true;
      }
    }
    if (full) continue;
    if (clearings.some((c) => Math.hypot(x - c.x, y - c.y) < c.r + r)) continue;
    if (roadDist !== null && roadDist(x, y) < roadClear + r * 0.6) continue;
    if (props.anyWithin(x, y, r + 2 * BUCKET, (p, d) => d < r + p.artRadius)) continue;
    if (buckets.anyWithin(x, y, r + 2 * BUCKET, (o, d) => d < r + o.radius)) continue;
    const placed: PlacedDecal = { id: def.id, x, y, rot: Math.round(rng.float(0, Math.PI * 2) * 1000) / 1000, alpha: def.alpha, radius: r };
    out.push(placed);
    buckets.add(placed);
    for (let j = iy - DECAL_LATTICE + 1; j <= iy; j += 1) {
      for (let i = ix - DECAL_LATTICE + 1; i <= ix; i += 1) if (i >= 0 && j >= 0) windows[j * wc + i]! += 1;
    }
  }
  return out;
}

/** Floor variants 0/1/2 per tile: bilinear value noise on a `FLOOR_NOISE_TILES` lattice, cut at its exact tertiles. */
function floorVariants(rng: Rng, W: number, H: number, tile: number): GeneratedWorld['floor'] {
  const cols = Math.ceil(W / tile);
  const rows = Math.ceil(H / tile);
  const lc = Math.ceil(cols / FLOOR_NOISE_TILES) + 2;
  const lr = Math.ceil(rows / FLOOR_NOISE_TILES) + 2;
  const lattice = Array.from({ length: lc * lr }, () => rng.next());
  const values = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const fx = c / FLOOR_NOISE_TILES;
      const fy = r / FLOOR_NOISE_TILES;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const at = (x: number, y: number): number => lattice[y * lc + x]!;
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      values[r * cols + c] = top * (1 - ty) + bottom * ty + rng.float(0, 1e-6);
    }
  }
  const sorted = Float64Array.from(values).sort();
  const t1 = sorted[Math.floor(sorted.length / 3)]!;
  const t2 = sorted[Math.floor((sorted.length * 2) / 3)]!;
  const variant = new Uint8Array(cols * rows);
  for (let i = 0; i < values.length; i += 1) variant[i] = values[i]! < t1 ? 0 : values[i]! < t2 ? 1 : 2;
  return { cell: tile, cols, rows, variant };
}

/**
 * Travel cost of the world's props for an enemy walking in from the spawn
 * ring: the mean, over ring points around hero spots in the spawn band, of
 * (octile nav path ÷ octile distance on an EMPTY grid). 1 = no detour. The
 * arena sim (`sim/model.ts`) slows its scalar convergence by it, so a denser
 * world is a slower-closing world in the sim exactly as on the nav grid.
 */
export function approachDetour(world: GeneratedWorld): number {
  const { cols, rows, cell, blocked } = world.nav;
  const rx = VIEW.width / 2 + TUNING.enemy.spawnMargin;
  const ry = VIEW.height / 2 + TUNING.enemy.spawnMargin;
  const heroes: Point[] = [world.spawn];
  for (let k = 0; k < 8; k += 1) {
    const a = (k / 8) * Math.PI * 2;
    heroes.push({ x: world.spawn.x + Math.cos(a) * world.width * 0.12, y: world.spawn.y + Math.sin(a) * world.height * 0.12 });
  }
  const dist = new Float64Array(cols * rows);
  const queue = new Int32Array(cols * rows);
  const inQ = new Uint8Array(cols * rows);
  const ratios: number[] = [];
  for (const hero of heroes) {
    const hc = Math.floor(hero.x / cell);
    const hr = Math.floor(hero.y / cell);
    const start = hr * cols + hc;
    if (blocked[start] === 1) continue;
    dist.fill(Infinity);
    dist[start] = 0;
    // Label-correcting octile search with a ring queue (re-queues on improvement).
    let head = 0;
    let size = 1;
    queue[0] = start;
    inQ[start] = 1;
    while (size > 0) {
      const cur = queue[head]!;
      head = (head + 1) % queue.length;
      size -= 1;
      inQ[cur] = 0;
      const r = (cur / cols) | 0;
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
          const nd = dist[cur]! + (dr !== 0 && dc !== 0 ? Math.SQRT2 : 1);
          if (nd + 1e-9 < dist[n]!) {
            dist[n] = nd;
            if (inQ[n] === 0) {
              inQ[n] = 1;
              queue[(head + size) % queue.length] = n;
              size += 1;
            }
          }
        }
      }
    }
    for (let k = 0; k < 48; k += 1) {
      const a = (k / 48) * Math.PI * 2;
      const c = Math.floor((hero.x + Math.cos(a) * rx) / cell);
      const r = Math.floor((hero.y + Math.sin(a) * ry) / cell);
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      const d = dist[r * cols + c]!;
      if (!Number.isFinite(d)) continue;
      const dx = Math.abs(c - hc);
      const dy = Math.abs(r - hr);
      const open = Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
      if (open > 0) ratios.push(d / open);
    }
  }
  let sum = 0;
  for (const r of ratios) sum += r;
  return ratios.length === 0 ? 1 : sum / ratios.length;
}
