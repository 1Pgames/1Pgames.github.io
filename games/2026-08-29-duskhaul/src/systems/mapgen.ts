/**
 * World generation (PRD-V2 §3.2): pure TS, no Phaser import, deterministic on
 * `Rng(\`map:${zone}:${seed}\`)` — same seed ⇒ byte-identical `nav.blocked`,
 * props and anchor lists (only `metrics.ms` differs).
 *
 * Pipeline (every placement is ALGORITHMIC — lattices, Voronoi, MST, Poisson
 * disk, distance tests — the RNG only breaks ties and picks variants):
 *
 *   1 regions   9 jittered 3×3 seeds, Lloyd-relaxed Voronoi on the 32 px raster
 *   2 spawn     within `SPAWN_CENTRE_JITTER` of the map centre (depth rings radiate out)
 *   3 depth     region adjacency ring from spawn (0 spawn / 1 neighbours / 2 rest)
 *   6 sites     best-candidate blue noise: major sites `poiMinSpacing` apart,
 *               minor sites `poiMinorSpacing` from everything
 *   4 landmarks one per region, in the site gap nearest its centroid
 *   7 gates     A/B/C + 2 conditional candidates from `zone.gateSlots` by depth
 *               and distance band; one conditional chosen by slot weight
 *   6 POIs      §5.12 quota assigned most-constrained-first by §3.3 depth law
 *   5 roads     MST over spawn + landmarks + gates, +`extraEdgeRatio` loops,
 *               bent polylines carved `roadWidth` wide
 *   9 masks     border, spawn/gate/POI clearings, plazas, stamps, roads, hazards
 *  10 stamps    landmark + POI stamps (`data/stamps.ts`)
 *  11 clusters  Bridson Poisson disk (`clusterMinSpacing`) over unmasked space
 *  12 archetype zone-weighted wall / grove / graveyard / monolith / debris
 *  13 coverage  stop at `coverageTarget` of walkable area
 *  14 clearance any body pair (not inside one stamp) with a visible gap in
 *               [64, minCorridor) ⇒ delete the smaller (cluster before stamp)
 *  15 connect   flood fill from spawn; pockets ≥ 4 cells ⇒ delete the smallest
 *               adjacent blocker, smaller crevices are sealed; path factor to
 *               every gate/POI ≤ `pathFactorMax` (else clear the straight line)
 *  16 retry     ≤ `maxRepairs` passes, then reseed `${seed}#n` (n ≤ `maxReseeds`)
 *  17 decals / splats, 18 light pools, breakables, 19 nav export, 20 metrics
 *
 * Gaps are designed, not hoped for: cluster members are either sealed (≤ 40 px
 * edge gap, below the 64 px hero nav seal) or ≥ `minCorridor` apart, and
 * different clusters/stamps keep ≥ `minCorridor` between bodies, so repair
 * only has to settle stamp-vs-stamp contacts.
 */
import { TUNING } from '../config';
import { Rng } from '../core/rng';
import { DECALS_BY_ZONE, PROPS_BY_ZONE, SPLAT_ALPHA, SPLAT_KEYS, propDef, propsWithRole, type DecalDef, type PropDef } from '../data/props';
import { GATE_APRON_RADIUS, MAJOR_POIS, POI_CLEARING, POI_STAMP, STAMP_SETS, stampDef, type StampDef } from '../data/stamps';
import type { ClusterArchetype, GateSlotRule, ZoneDef } from '../data/zones';
import type {
  Depth,
  GateCandidate,
  GateKind,
  GeneratedMap,
  PlacedDecal,
  PlacedProp,
  PoiAnchor,
  PoiKind,
  RegionInfo,
} from '../data/types-v2';

export interface GenerateMapOptions { ftue?: boolean; gateWindowBonusS?: number }

const CFG = TUNING.mapgen;
const SIZE = TUNING.arena.width;
const MC = CFG.maskCell;
const MN = Math.round(SIZE / MC);
const NC = CFG.navCell;
const NN = Math.round(SIZE / NC);
const FLOOR_TILE = TUNING.arena.tileSize;
const FN = Math.round(SIZE / FLOOR_TILE);
const BORDER = CFG.borderBand;
/** Hero body inflation used by the nav raster and the reachability flood (§3.2 step 19). */
const HERO_INFLATE = 32;
/** Edge gap below which two bodies are one wall for the hero (2 × inflation). */
const SEAL = HERO_INFLATE * 2;
/** Designed seal inside a cluster: comfortably below `SEAL`. */
const CLUSTER_SEAL = 40;
/** Minimum gap between the art circles of blockers that are not one composed structure (no heaps). */
const SPRITE_GAP = 60;
/** Variety: the same lone prop id keeps this far from itself… */
const SAME_PROP_PX = 900;
/** …and a 1024² chunk holds at most this many lone props of one shape class. */
const SHAPE_PER_CHUNK = 2;
/** Inter-cluster / cluster-to-stamp gap: wider than `minCorridor` so narrow share stays low. */
const CLUSTER_GAP = 300;
/** Narrow-corridor threshold for `narrowShare` (§3.2 step 14). */
const NARROW = 360;
/** Unreached free pockets smaller than this many mask cells are sealed, not repaired. */
const POCKET_SEAL_CELLS = 4;
const BUCKET = 256;
/** The spawn lies within this many px of the map centre. */
const SPAWN_CENTRE_JITTER = 700;
/** Timed gates A/B/C sit at least this far apart in bearing from the spawn (distinct compass directions). */
const GATE_MIN_BEARING = Math.PI / 2;
/** Spacing of the soft road brushes along road curves (decals with id `road-<zone>`). */
const ROAD_BRUSH_STEP = 90;
const BN = Math.ceil(SIZE / BUCKET);
const SQRT2 = Math.SQRT2;

// ─────────────────────────────── public API ────────────────────────────────

/** §16.1 E1. Pure and deterministic; see the file header for the pipeline. */
export function generateMap(zone: ZoneDef, seed: string, opts: GenerateMapOptions = {}): GeneratedMap {
  const t0 = performance.now();
  let last: Attempt | null = null;
  let usable: Attempt | null = null;
  // `maxReseeds` rerolls for band misses; beyond that, keep rerolling only
  // while no attempt produced a playable map (gates + POIs) at all.
  for (let n = 0; n <= CFG.maxReseeds + 8; n += 1) {
    if (n > CFG.maxReseeds && usable !== null) break;
    const attemptSeed = n === 0 ? seed : `${seed}#${n}`;
    const result = attempt(zone, attemptSeed, opts);
    last = result;
    if (result.map.gates.length > 0) usable = result;
    if (result.failure === null) break;
    console.info(`mapgen:reroll ${zone.id}/${attemptSeed}: ${result.failure}`);
  }
  // Best effort: a map that exhausted its reseeds still ships so the run can
  // start; the selftest bands flag it.
  const chosen = last!.failure === null ? last! : usable ?? last!;
  const map = chosen.map;
  map.seed = seed;
  map.metrics.reseeds = chosen.reseed;
  map.metrics.ms = performance.now() - t0;
  if (chosen.failure !== null) console.warn(`mapgen: ${zone.id}/${seed} shipped best effort: ${chosen.failure}`);
  return map;
}

/** §16.1 E2: region depth under a world point (clamped to the map). */
export function depthAt(map: GeneratedMap, x: number, y: number): Depth {
  const n = Math.round(map.width / MC);
  const col = Math.min(n - 1, Math.max(0, Math.floor(x / MC)));
  const row = Math.min(n - 1, Math.max(0, Math.floor(y / MC)));
  return map.regions[map.regionAt[row * n + col]!]?.depth ?? 2;
}

// ─────────────────────────────── internals ─────────────────────────────────

interface Attempt { map: GeneratedMap; failure: string | null; reseed: number }

interface Body {
  id: string;
  x: number;
  y: number;
  r: number;
  tall: boolean;
  rot: number;
  light: boolean;
  /** Radius of the drawn art; sprites of different groups keep ≥ `SPRITE_GAP` between these circles. */
  vr: number;
  shape: string;
  /** Group id: `s<n>` stamp, `c<n>` cluster. Pairs inside one stamp are exempt from the corridor rule. */
  group: string;
  stamp: boolean;
  alive: boolean;
}

interface Circle { x: number; y: number; r: number }
interface Site { x: number; y: number; region: number; depth: Depth; used: boolean; major?: boolean }
interface Segment { ax: number; ay: number; bx: number; by: number }

function attempt(zone: ZoneDef, seed: string, opts: GenerateMapOptions): Attempt {
  const reseed = seed.includes('#') ? Number(seed.slice(seed.lastIndexOf('#') + 1)) : 0;
  const rng = new Rng(`map:${zone.id}:${seed}`);
  const set = STAMP_SETS[zone.stampSet];
  if (set === undefined) throw new Error(`Zone "${zone.id}" names unknown stamp set "${zone.stampSet}"`);

  // 1 regions ────────────────────────────────────────────────────────────
  const regionAt = new Uint8Array(MN * MN);
  const centroids = buildRegions(rng, regionAt);

  // 2 spawn (user request: the hero starts mid-map) ───────────────────────
  // A seeded point within `SPAWN_CENTRE_JITTER` of the map centre; its region
  // is depth 0 and the depth rings radiate outward, so the deepest, richest
  // regions lie toward the edges. The spawn clearing keeps it open floor.
  const regionOf = (x: number, y: number): number => regionAt[cellOf(y) * MN + cellOf(x)]!;
  const spawnAngle = rng.float(0, Math.PI * 2);
  const spawnOff = rng.float(0, SPAWN_CENTRE_JITTER);
  const spawn = {
    x: Math.round(SIZE / 2 + Math.cos(spawnAngle) * spawnOff),
    y: Math.round(SIZE / 2 + Math.sin(spawnAngle) * spawnOff),
  };
  const spawnRegion = regionOf(spawn.x, spawn.y);

  // 3 depth ──────────────────────────────────────────────────────────────
  const depthOf = regionDepths(regionAt, spawnRegion, centroids.length);
  const depthAtPoint = (x: number, y: number): Depth => depthOf[regionOf(x, y)]!;
  const toSite = (p: { x: number; y: number }): Site => ({ ...p, region: regionOf(p.x, p.y), depth: depthAtPoint(p.x, p.y), used: false });
  // 6 sites: best-candidate blue noise (Mitchell) — major POI sites ≥
  // `poiMinSpacing` apart, no lattice; gaps between them (≥ 440 px from any
  // major site) host gates and landmarks; minor sites fill the remaining
  // floor at `poiMinorSpacing`. POI kinds are then dealt road-first.
  const majors = blueNoise(rng, CFG.poiMinSpacing, (x, y) => Math.hypot(x - spawn.x, y - spawn.y) >= CFG.spawnClear + 180, []);
  const sites = majors.map((p) => ({ ...toSite(p), major: true }));
  const holes = gapPoints(majors, 440).map(toSite);

  // 7 gates ──────────────────────────────────────────────────────────────
  const gatePick = pickGates(rng, zone, holes, spawn, opts);
  if (typeof gatePick === 'string') return failed(zone, seed, spawn, regionAt, reseed, gatePick);
  const gates = gatePick;

  // 4 landmarks ──────────────────────────────────────────────────────────
  const landmarkStamps = set.landmarks.map((id) => stampDef(id));
  // One landmark per region; the zone's 9 landmark stamps are dealt in
  // shuffled rounds so neighbouring regions rarely repeat one.
  const landmarkOrder: number[] = [];
  while (landmarkOrder.length < centroids.length) landmarkOrder.push(...rng.shuffle(landmarkStamps.map((_, i) => i)));
  const landmarks: Array<{ x: number; y: number; stamp: StampDef; bodyR: number }> = [];
  for (let k = 0; k < centroids.length; k += 1) {
    const stamp = landmarkStamps[landmarkOrder[k]!]!;
    // Keep-out radius of the landmark: its body or its art, whichever reaches farther.
    const lmDef = propDef(zone.id, stamp.props[0]!.propId);
    const bodyR = Math.max(stamp.props[0]?.bodyRadius ?? lmDef.bodyRadius, lmDef.visualR);
    landmarks.push({ ...placeLandmark(centroids[k]!, k, bodyR, holes, gates, spawn, regionOf), stamp, bodyR });
  }
  // A site the landmark sits on (closer than its stamp + the smallest clearing) is lost.
  const minClear = Math.min(...Object.values(POI_CLEARING));
  for (const site of sites) {
    for (const lm of landmarks) {
      if (Math.abs(site.x - lm.x) < 800 && Math.hypot(site.x - lm.x, site.y - lm.y) < lm.bodyR + minClear + 20) site.used = true;
    }
  }

  // 5 roads (before POIs, so POIs can line them) ──────────────────────────
  const roads = buildRoads(rng, [spawn, ...landmarks, ...gates]);
  const roadMask = new Uint8Array(MN * MN);
  rasterRoads(roads, roadMask);
  const roadDist = distanceField(roadMask);

  // 6 POIs ───────────────────────────────────────────────────────────────
  // Minor sites: `poiMinorSpacing` from every site, gate apron and landmark.
  const minors = blueNoise(
    rng,
    CFG.poiMinorSpacing,
    (x, y) =>
      Math.hypot(x - spawn.x, y - spawn.y) >= CFG.spawnClear + 100 &&
      gates.every((g) => Math.hypot(x - g.x, y - g.y) >= CFG.gateClear + 120) &&
      landmarks.every((lm) => Math.hypot(x - lm.x, y - lm.y) >= lm.bodyR + 140),
    majors,
  );
  for (const p of minors) sites.push({ ...toSite(p), major: false });
  const poiPick = assignPois(rng, sites, spawn, gates, landmarks, gates.some((g) => g.kind === 'bell'), roadDist);
  if (typeof poiPick === 'string') return failed(zone, seed, spawn, regionAt, reseed, poiPick);
  const pois = poiPick;

  // 9 masks: forbidden circles for cluster bodies ─────────────────────────
  const clearings: Circle[] = [
    { x: spawn.x, y: spawn.y, r: CFG.spawnClear },
    ...gates.map((g) => ({ x: g.x, y: g.y, r: Math.max(CFG.gateClear, GATE_APRON_RADIUS) })),
    ...pois.map((p) => ({ x: p.x, y: p.y, r: p.radius })),
  ];
  const plazas: Circle[] = landmarks.map((lm) => ({ x: lm.x, y: lm.y, r: CFG.plazaDiameter / 2 }));

  const forbidden = new CircleIndex([...clearings, ...plazas]);
  const clearIndex = new CircleIndex(clearings);

  // 10 stamps ────────────────────────────────────────────────────────────
  const bodies: Body[] = [];
  let groupSeq = 0;
  const placeStamp = (stamp: StampDef, x: number, y: number, ownClear: Circle | null): void => {
    const group = `s${groupSeq++}`;
    for (const piece of stamp.props) {
      const def = propDef(zone.id, piece.propId);
      const px = x + piece.dx;
      const py = y + piece.dy;
      const r = Math.min(CFG.maxBodyRadius, piece.bodyRadius ?? def.bodyRadius);
      // A stamp piece may not intrude another clearing (critic F4) or the border.
      let blocked = px - r < BORDER + 8 || py - r < BORDER + 8 || px + r > SIZE - BORDER - 8 || py + r > SIZE - BORDER - 8;
      // Neither the body nor the art may reach into another clearing.
      if (blocked || clearIndex.hits(px, py, Math.max(r, def.visualR), ownClear)) continue;
      bodies.push(makeBody(def, px, py, r, piece.rot ?? 0, group, true));
    }
  };
  for (const lm of landmarks) placeStamp(lm.stamp, lm.x, lm.y, null);
  pois.forEach((poi, i) => {
    const kind = POI_STAMP[poi.kind];
    if (kind !== null) placeStamp(stampDef(set.poi[kind]), poi.x, poi.y, clearings[1 + gates.length + i]!);
  });

  // 11-13 clusters ───────────────────────────────────────────────────────
  // Seeds come from a largest-empty-circle sweep over the room field (distance
  // to every clearing, plaza, road, border and body): each cluster goes where
  // the most room is left and is sized to that room, keeping ≥ CLUSTER_GAP to
  // everything. Successive seeds are therefore ≥ clusterMinSpacing apart in
  // practice and fill the free pockets evenly (a Poisson-disk-like best-candidate
  // sample) instead of piling rejections at clearing edges.
  // Settle stamp-vs-stamp conflicts first, so the cluster fill below
  // compensates for any piece the corridor rule removes.
  for (let k = 0; k < 4 && repairCorridors(bodies, clearIndex); k += 1);
  const coverage = new CoverageRaster();
  for (const b of bodies) if (b.alive) coverage.paint(b);
  const decals: PlacedDecal[] = [];
  /** Open-floor debris spots marked by the `debris` archetype; decals compose there later. */
  const debrisSpots: Array<{ x: number; y: number }> = [];
  const hash = new BodyHash();
  hash.rebuild(bodies);
  const archetypes: ClusterArchetype[] = ['wall', 'lone', 'graveyard', 'monolith', 'debris'];
  const variety = new Variety(zone);
  const archetypeWeights = archetypes.map((a) => zone.clusterWeights[a]);
  const minRoom = CLUSTER_GAP + 36;
  const room = new RoomField(rng, [...clearings, ...plazas], roads, bodies, minRoom);
  // Aim slightly over `coverageTarget`: repairs remove ~1% again afterwards.
  const fillTo = Math.min(CFG.coverageMax - 0.01, CFG.coverageTarget + 0.004);
  for (let guard = 0; guard < 20000 && coverage.share() < fillTo; guard += 1) {
    const seed = room.best();
    if (seed === null || seed.d < minRoom) break;
    const extent = seed.d - CLUSTER_GAP;
    const archetype = rng.pickWeighted(archetypes, archetypeWeights);
    const group = `c${groupSeq++}`;
    if (archetype === 'debris') {
      debrisSpots.push({ x: seed.x, y: seed.y });
      // Debris is flat: it spends only a small disc of room, so blocking clusters still fill the region.
      room.consume(seed.x, seed.y, Math.min(extent, 110));
      continue;
    }
    let placed = false;
    for (let attempt = 0; attempt < 4 && !placed; attempt += 1) {
      const kind = attempt < 2 ? archetype : 'lone';
      const accepted = fitCluster(kind, buildCluster(rng, zone, kind, seed.x, seed.y, extent, group, variety), hash, forbidden, roads);
      if (accepted.length === 0) continue;
      if (kind === 'lone') variety.note(accepted[0]!);
      for (const b of accepted) {
        bodies.push(b);
        hash.add(b, bodies.length - 1);
        coverage.paint(b);
      }
      room.carve(accepted);
      placed = true;
    }
    if (!placed) room.consume(seed.x, seed.y, 64);
  }

  // 14-16 repairs ────────────────────────────────────────────────────────
  const poiTargets = [...gates.map((g) => ({ x: g.x, y: g.y })), ...pois.map((p) => ({ x: p.x, y: p.y }))];
  const field = new ClearanceField();
  let failure: string | null = null;
  let pathFactor = 0;
  let pathDist: Float64Array | null = null;
  // `fresh`: the field, flood and path distances describe the final bodies
  // (the last pass changed nothing), so nothing is recomputed afterwards.
  let reach: Uint8Array = new Uint8Array(0);
  let fresh = false;
  for (let pass = 0; pass <= CFG.maxRepairs; pass += 1) {
    let changed = repairCorridors(bodies, clearIndex);
    hash.rebuild(bodies);
    field.compute(bodies);
    reach = field.flood(spawn);
    changed = repairPockets(bodies, hash, field, reach) || changed;
    if (changed) continue;
    pathDist = field.pathDistances(reach, spawn);
    const worst = worstPathFactor(pathDist, spawn, poiTargets);
    pathFactor = worst.factor;
    if (worst.factor > CFG.pathFactorMax && worst.target !== null) {
      if (clearLine(bodies, spawn, worst.target)) continue;
    }
    fresh = true;
    break;
  }
  if (!fresh) {
    hash.rebuild(bodies);
    field.compute(bodies);
    reach = field.flood(spawn);
    pathDist = field.pathDistances(reach, spawn);
    pathFactor = worstPathFactor(pathDist, spawn, poiTargets).factor;
  }
  // Sealing only blanks unreached crevices: reach and path distances are unchanged.
  field.sealPockets(reach);
  if (pathFactor > CFG.pathFactorMax) failure = `path factor ${pathFactor.toFixed(2)}`;


  coverage.reset();
  for (const b of bodies) if (b.alive) coverage.paint(b);
  const coverageShare = coverage.share();
  if (coverageShare < CFG.coverageMin || coverageShare > CFG.coverageMax) failure ??= `coverage ${coverageShare.toFixed(3)}`;

  const corridor = minCorridor(bodies, hash);
  if (corridor < CFG.minCorridor) failure ??= `corridor ${Math.round(corridor)}`;
  const narrowShare = field.narrowShare(reach, bodies, hash);
  if (narrowShare > CFG.narrowShareMax) failure ??= `narrow share ${narrowShare.toFixed(3)}`;
  if (pois.length < POI_QUOTA_MIN) failure ??= `only ${pois.length} POIs`;

  // 17 decals & splats, 18 light pools, breakables ─────────────────────────
  const walkCells = field.walkableCells(reach);
  const walkArea = walkCells.length * MC * MC;
  placeDecals(rng, zone, { roadDist, field, reach, clearIndex, bodies, debrisSpots }, Math.round(walkArea * CFG.decalPerPx2), decals);
  // Road surface (§3.7): soft-edged `road-<zone>` brushes every ROAD_BRUSH_STEP
  // px along the road curves; `Arena` draws them as one smooth band.
  const roadKey = `road-${zone.id}`;
  for (const sg of roads) {
    const len = Math.hypot(sg.bx - sg.ax, sg.by - sg.ay);
    const steps = Math.max(1, Math.round(len / ROAD_BRUSH_STEP));
    for (let k = 0; k < steps; k += 1) {
      const t = k / steps;
      decals.push({ id: roadKey, x: Math.round(sg.ax + (sg.bx - sg.ax) * t), y: Math.round(sg.ay + (sg.by - sg.ay) * t), rot: round3(rng.float(0, Math.PI * 2)), alpha: 1 });
    }
  }
  const splats: PlacedDecal[] = [];
  const splatCount = Math.round(walkArea * CFG.splatPerPx2);
  const splatKeys = SPLAT_KEYS[zone.id];
  for (let i = 0; i < splatCount && walkCells.length > 0; i += 1) {
    const cell = walkCells[rng.int(0, walkCells.length - 1)]!;
    splats.push({
      id: rng.pick(splatKeys),
      x: Math.round((cell % MN) * MC + rng.float(0, MC)),
      y: Math.round(Math.floor(cell / MN) * MC + rng.float(0, MC)),
      rot: round3(rng.float(0, Math.PI * 2)),
      alpha: SPLAT_ALPHA,
    });
  }
  const lightPools = placeLights(rng, bodies, landmarks, gates, pois, Math.round(walkArea * CFG.lightPoolPerPx2));
  // Hazard anchors (§3.9) go on the finished floor: reachable cells with room
  // for the hazard glyph, off every clearing, spaced per kind.
  const nav = navRaster(bodies, hash, field, spawn, poiTargets);
  const hazard = hazardAnchors(rng, zone, clearings, roadMask, (x, y, need) => {
    const i = cellOf(y) * MN + cellOf(x);
    return reach[i] === 1 && field.clear[i]! >= need && nav[Math.floor(y / NC) * NN + Math.floor(x / NC)] === 0;
  });
  const breakables = placeBreakables(rng, field, reach, clearings, hazard.keepOut);

  // 19 nav export ────────────────────────────────────────────────────────
  // Gate path bands (§2.2 / §3.6) on the exported nav raster — the grid actors walk.
  const navDist = navPathDistances(nav, spawn);
  for (const g of gates) {
    const d = navDist[Math.floor(g.y / NC) * NN + Math.floor(g.x / NC)]!;
    const band = gateBand(zone, g, opts);
    if (!(d >= band[0] && d <= band[1])) failure ??= `gate ${g.id} path ${Math.round(d)} outside ${band[0]}-${band[1]}`;
  }
  const gatePath = (id: string): number => {
    const g = gates.find((q) => q.id === id);
    return g === undefined ? NaN : navDist[Math.floor(g.y / NC) * NN + Math.floor(g.x / NC)]!;
  };
  if (!opts.ftue && !(gatePath('c') - gatePath('b') >= CFG.gateDist.cBeyondB)) failure ??= `gate c only ${Math.round(gatePath('c') - gatePath('b'))} px beyond b`;
  for (const t of poiTargets) {
    if (nav[Math.floor(t.y / NC) * NN + Math.floor(t.x / NC)] === 1) failure ??= `anchor (${Math.round(t.x)},${Math.round(t.y)}) nav-blocked`;
  }

  // Floor: 3 variants by 512 px value noise, road tiles from the road raster.
  const floor = floorRaster(rng, roadMask);

  const regions: RegionInfo[] = centroids.map((c, i) => ({
    index: i,
    cx: Math.round(c.x),
    cy: Math.round(c.y),
    depth: depthOf[i]!,
    landmark: landmarks[i]!.stamp.id.slice(landmarks[i]!.stamp.id.indexOf('/') + 1),
  }));

  const props: PlacedProp[] = [];
  for (const b of bodies) {
    if (!b.alive) continue;
    const p: PlacedProp = { id: b.id, x: Math.round(b.x), y: Math.round(b.y), bodyRadius: b.r };
    if (b.tall) p.tall = true;
    if (b.rot !== 0) p.rot = round3(b.rot);
    props.push(p);
  }

  const map: GeneratedMap = {
    seed,
    zone: zone.id,
    width: SIZE,
    height: SIZE,
    spawn,
    floor,
    props,
    decals,
    splats,
    lightPools,
    breakables,
    nav: { cols: NN, rows: NN, cell: NC, blocked: nav },
    regions,
    regionAt,
    gates,
    pois,
    hazardAnchors: hazard.anchors,
    metrics: {
      coverage: round3(coverageShare),
      minCorridor: Math.round(corridor),
      narrowShare: round3(narrowShare),
      maxPathFactor: round3(pathFactor),
      poiCount: pois.length,
      reseeds: reseed,
      ms: 0,
    },
  };
  return { map, failure, reseed };
}

/** An attempt that failed before any geometry: an empty but well-formed map. */
function failed(zone: ZoneDef, seed: string, spawn: { x: number; y: number }, regionAt: Uint8Array, reseed: number, failure: string): Attempt {
  return {
    failure,
    reseed,
    map: {
      seed, zone: zone.id, width: SIZE, height: SIZE, spawn,
      floor: { cols: FN, rows: FN, cell: FLOOR_TILE, variant: new Uint8Array(FN * FN), road: new Uint8Array(FN * FN) },
      props: [], decals: [], splats: [], lightPools: [], breakables: [],
      nav: { cols: NN, rows: NN, cell: NC, blocked: new Uint8Array(NN * NN) },
      regions: [], regionAt, gates: [], pois: [], hazardAnchors: [],
      metrics: { coverage: 0, minCorridor: 0, narrowShare: 1, maxPathFactor: 99, poiCount: 0, reseeds: reseed, ms: 0 },
    },
  };
}

const cellOf = (v: number): number => Math.min(MN - 1, Math.max(0, Math.floor(v / MC)));
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const roadHalf = (): number => CFG.roadWidth / 2;

function makeBody(def: PropDef, x: number, y: number, r: number, rot: number, group: string, stamp: boolean): Body {
  return { id: def.id, x, y, r, vr: def.visualR, shape: def.shape, tall: def.tall, rot, light: def.light, group, stamp, alive: true };
}

// ── 1 regions ───────────────────────────────────────────────────────────────

/**
 * Jittered n×n lattice seeds, Lloyd-relaxed on a coarse 128 px raster (the
 * centroid of a Voronoi cell moves < 1 px between 128 and 32 px sampling),
 * then one exact labelling pass on the mask raster. Each mask cell only tests
 * the seeds whose lattice slot is within one slot of its own — after jitter
 * and relaxation a seed never leaves its neighbouring slots.
 */
function buildRegions(rng: Rng, regionAt: Uint8Array): Array<{ x: number; y: number }> {
  const n = CFG.regionGrid;
  const pitch = SIZE / n;
  let seeds: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      seeds.push({
        x: pitch * (c + 0.5) + rng.float(-CFG.regionJitter, CFG.regionJitter),
        y: pitch * (r + 0.5) + rng.float(-CFG.regionJitter, CFG.regionJitter),
      });
    }
  }
  const nearest = (x: number, y: number): number => {
    const sc = Math.min(n - 1, Math.floor(x / pitch));
    const sr = Math.min(n - 1, Math.floor(y / pitch));
    let best = 0;
    let bestD = Infinity;
    for (let r = Math.max(0, sr - 1); r <= Math.min(n - 1, sr + 1); r += 1) {
      for (let c = Math.max(0, sc - 1); c <= Math.min(n - 1, sc + 1); c += 1) {
        const k = r * n + c;
        const dx = x - seeds[k]!.x;
        const dy = y - seeds[k]!.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = k; }
      }
    }
    return best;
  };
  const coarse = 128;
  const cn = Math.round(SIZE / coarse);
  for (let iter = 0; iter < CFG.lloydIters; iter += 1) {
    const sx = new Float64Array(seeds.length);
    const sy = new Float64Array(seeds.length);
    const count = new Float64Array(seeds.length);
    for (let row = 0; row < cn; row += 1) {
      const y = row * coarse + coarse / 2;
      for (let col = 0; col < cn; col += 1) {
        const x = col * coarse + coarse / 2;
        const k = nearest(x, y);
        sx[k] = sx[k]! + x;
        sy[k] = sy[k]! + y;
        count[k] = count[k]! + 1;
      }
    }
    seeds = seeds.map((s, k) => (count[k]! > 0 ? { x: sx[k]! / count[k]!, y: sy[k]! / count[k]! } : s));
  }
  for (let row = 0; row < MN; row += 1) {
    const y = row * MC + MC / 2;
    for (let col = 0; col < MN; col += 1) regionAt[row * MN + col] = nearest(col * MC + MC / 2, y);
  }
  return seeds;
}

/**
 * §3.3 depth by region-adjacency rings from the spawn region: 0 = the spawn
 * region, 1 = regions sharing a border (≥ 6 mask cells) with it, 2 = the rest.
 */
function regionDepths(regionAt: Uint8Array, spawnRegion: number, regionCount: number): Depth[] {
  const shared = new Array<number>(regionCount).fill(0);
  for (let row = 0; row < MN; row += 1) {
    for (let col = 0; col < MN; col += 1) {
      const a = regionAt[row * MN + col]!;
      if (col + 1 < MN) {
        const b = regionAt[row * MN + col + 1]!;
        if (a !== b && (a === spawnRegion || b === spawnRegion)) shared[a === spawnRegion ? b : a]! += 1;
      }
      if (row + 1 < MN) {
        const b = regionAt[(row + 1) * MN + col]!;
        if (a !== b && (a === spawnRegion || b === spawnRegion)) shared[a === spawnRegion ? b : a]! += 1;
      }
    }
  }
  const depth: Depth[] = new Array<Depth>(regionCount).fill(2);
  depth[spawnRegion] = 0;
  shared.forEach((len, i) => {
    if (i !== spawnRegion && len >= 6) depth[i] = 1;
  });
  return depth;
}


/** Uniform-grid point index for nearest / within-radius queries. */
class PointGrid {
  private readonly cell: number;
  private readonly cols: number;
  private readonly cells: Array<Array<{ x: number; y: number }>>;
  constructor(cell: number) {
    this.cell = cell;
    this.cols = Math.ceil(SIZE / cell) + 1;
    this.cells = Array.from({ length: this.cols * this.cols }, () => []);
  }
  add(p: { x: number; y: number }): void {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(p.x / this.cell)));
    const r = Math.min(this.cols - 1, Math.max(0, Math.floor(p.y / this.cell)));
    this.cells[r * this.cols + c]!.push(p);
  }
  /** Distance to the nearest point, capped at `cap` (search radius). */
  nearest(x: number, y: number, cap: number): number {
    const span = Math.ceil(cap / this.cell);
    const c0 = Math.floor(x / this.cell);
    const r0 = Math.floor(y / this.cell);
    let d = cap;
    for (let r = Math.max(0, r0 - span); r <= Math.min(this.cols - 1, r0 + span); r += 1) {
      for (let c = Math.max(0, c0 - span); c <= Math.min(this.cols - 1, c0 + span); c += 1) {
        for (const p of this.cells[r * this.cols + c]!) {
          const e = Math.hypot(p.x - x, p.y - y);
          if (e < d) d = e;
        }
      }
    }
    return d;
  }
}

// ── 6 sites ─────────────────────────────────────────────────────────────────

const SITE_MARGIN = BORDER + 70;
/**
 * Objectives the hero must STAND at (gates, chests, vault, shrines, bells) sit
 * ≥ this far from the world edge, so the camera never clamps with the hero
 * under the HUD or the thumb while channelling (critic F8).
 */
const EDGE_SAFE = 700;
const EDGE_SAFE_POIS: readonly PoiKind[] = [
  'chest_t1', 'chest_t2', 'chest_t3', 'vault', 'bell',
  'shrine_blood', 'shrine_gilt', 'shrine_bone', 'shrine_grave', 'shrine_curse',
];

/**
 * Mitchell best-candidate blue noise over the site margin: each new point is
 * the farthest of 32 random candidates from the existing set (`fixed` points
 * count as existing but are not returned), until the farthest falls below
 * `minDist`. Nearest-distance queries go through a `PointGrid`, capped at
 * 2 × `minDist` (candidates farther than that tie, which is harmless).
 * Stops after `misses` consecutive rounds found nothing ≥ `minDist`.
 */
function blueNoise(
  rng: Rng,
  minDist: number,
  accept: (x: number, y: number) => boolean,
  fixed: ReadonlyArray<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  const grid = new PointGrid(minDist);
  for (const p of fixed) grid.add(p);
  const out: Array<{ x: number; y: number }> = [];
  const lo = SITE_MARGIN;
  const span = SIZE - 2 * SITE_MARGIN;
  const cap = minDist * 2;
  let misses = 0;
  while (misses < 3) {
    let best: { x: number; y: number } | null = null;
    let bestD = -1;
    for (let k = 0; k < 32; k += 1) {
      const x = lo + rng.next() * span;
      const y = lo + rng.next() * span;
      if (!accept(x, y)) continue;
      const d = grid.nearest(x, y, cap);
      if (d > bestD) {
        bestD = d;
        best = { x, y };
      }
    }
    if (best === null || bestD < minDist) {
      misses += 1;
      continue;
    }
    misses = 0;
    const p = { x: Math.round(best.x), y: Math.round(best.y) };
    grid.add(p);
    out.push(p);
  }
  return out;
}

/** 128 px grid points ≥ `EDGE_SAFE` inside the world and ≥ `minD` from every site: where gates and landmarks may stand. */
function gapPoints(sites: ReadonlyArray<{ x: number; y: number }>, minD: number): Array<{ x: number; y: number }> {
  const grid = new PointGrid(minD);
  for (const p of sites) grid.add(p);
  const out: Array<{ x: number; y: number }> = [];
  for (let y = EDGE_SAFE; y <= SIZE - EDGE_SAFE; y += 128) {
    for (let x = EDGE_SAFE; x <= SIZE - EDGE_SAFE; x += 128) {
      if (grid.nearest(x, y, minD) >= minD) out.push({ x, y });
    }
  }
  return out;
}

// ── 4 landmarks ─────────────────────────────────────────────────────────────

/**
 * The free lattice hole nearest the region centroid (§3.2 step 4: landmark
 * at the centroid, snapped into the POI lattice's gaps so it costs no site),
 * away from gate aprons and the spawn clearing; falls back to the centroid.
 */
function placeLandmark(
  centroid: { x: number; y: number },
  region: number,
  radius: number,
  holes: Site[],
  gates: readonly GateCandidate[],
  spawn: { x: number; y: number },
  regionOf: (x: number, y: number) => number,
): { x: number; y: number } {
  let best: Site | null = null;
  let bestD = Infinity;
  const lo = BORDER + radius + 40;
  const hi = SIZE - BORDER - radius - 40;
  for (const h of holes) {
    if (h.used || h.x < lo || h.y < lo || h.x > hi || h.y > hi || regionOf(h.x, h.y) !== region) continue;
    if (Math.hypot(h.x - spawn.x, h.y - spawn.y) < CFG.spawnClear + radius + 60) continue;
    if (gates.some((g) => Math.hypot(h.x - g.x, h.y - g.y) < CFG.gateClear + radius + 60)) continue;
    const d = Math.hypot(h.x - centroid.x, h.y - centroid.y);
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  if (best !== null) {
    best.used = true;
    // Neighbouring holes would put two landmarks 520 px apart: reserve them.
    for (const h of holes) if (Math.hypot(h.x - best.x, h.y - best.y) < 600) h.used = true;
    return { x: best.x, y: best.y };
  }
  // No free hole in the region (tiny region): the centroid; the site it sits on is released by the caller.
  return { x: Math.round(centroid.x), y: Math.round(centroid.y) };
}

// ── 7 gates ─────────────────────────────────────────────────────────────────

/** Straight-line → path estimate used while choosing (blockers add a few %). */
const PATH_EST = 1.1;

function gateBand(zone: ZoneDef, g: GateCandidate, opts: GenerateMapOptions): [number, number] {
  if (opts.ftue && g.id === 'a') return [TUNING.ftue.gateADist - 400, TUNING.ftue.gateADist + 500];
  const gd = CFG.gateDist;
  if (g.id === 'a') return [gd.a[0], gd.a[1]];
  if (g.id === 'b') return [gd.b[0], gd.b[1]];
  if (g.id === 'c') return [gd.c[0], gd.c[1]];
  const rule = zone.gateSlots.find((r) => r.id === 'x' && r.kinds.includes(g.kind));
  return [Math.max(gd.xMin, rule?.minDist ?? gd.xMin), Math.max(SIZE * 2, rule?.maxDist ?? 0)];
}

function pickGates(rng: Rng, zone: ZoneDef, sites: Site[], spawn: { x: number; y: number }, opts: GenerateMapOptions): GateCandidate[] | string {
  const sep = CFG.gateDist.separation;
  const chosen: Array<{ rule: GateSlotRule; site: Site }> = [];
  const bearing = (p: { x: number; y: number }): number => Math.atan2(p.y - spawn.y, p.x - spawn.x);
  const angleGap = (a: number, b: number): number => {
    const d = Math.abs(a - b) % (Math.PI * 2);
    return d > Math.PI ? Math.PI * 2 - d : d;
  };
  // Every gate keeps `separation`; timed gates A/B/C also keep distinct
  // bearings from the central spawn, so choosing a gate means choosing a direction.
  const farFromChosen = (s: Site, timed: boolean): boolean =>
    chosen.every(
      (c) =>
        Math.hypot(c.site.x - s.x, c.site.y - s.y) >= sep &&
        (!timed || c.rule.id === 'x' || angleGap(bearing(c.site), bearing(s)) >= GATE_MIN_BEARING),
    );
  // Path ≥ euclid always; the finished map adds a few % detour, so the upper
  // bound keeps `PATH_EST` of slack and the lower bound uses the straight line.
  const est = (s: Site): number => Math.hypot(s.x - spawn.x, s.y - spawn.y);
  const bonus = Math.max(0, opts.gateWindowBonusS ?? 0);

  for (const rule of zone.gateSlots) {
    const ftueA = opts.ftue === true && rule.id === 'a';
    let pool = sites.filter((s) => {
      if (s.used || !rule.depth.includes(s.depth) || !farFromChosen(s, rule.id !== 'x')) return false;
      const d = est(s);
      if (ftueA) return true;
      // Leave slack inside the band for the detour the finished map adds.
      let lo = rule.id === 'x' ? Math.max(rule.minDist, CFG.gateDist.xMin) : rule.minDist;
      // Gate C is ≥ `cBeyondB` farther than B (straight line; checked on the nav path after generation).
      const b = chosen.find((c) => c.rule.id === 'b');
      if (rule.id === 'c' && b !== undefined) lo = Math.max(lo, est(b.site) + CFG.gateDist.cBeyondB);
      return d >= lo + 40 && d * PATH_EST <= rule.maxDist - 60;
    });
    if (ftueA) {
      pool.sort((a, b) => Math.abs(est(a) - TUNING.ftue.gateADist) - Math.abs(est(b) - TUNING.ftue.gateADist));
      pool = pool.slice(0, 1);
    }
    if (pool.length === 0) return `no site for gate slot ${rule.id}`;
    // Timed gates prefer the lower part of their band: blockers only ever
    // lengthen the walk, so a site near the top overshoots after generation.
    if (rule.id !== 'x' && rule.id !== 'c' && !ftueA) {
      const cap = rule.minDist + 0.55 * (rule.maxDist - rule.minDist);
      const inner = pool.filter((s) => est(s) * PATH_EST <= cap);
      if (inner.length > 0) pool = inner;
    }
    const site = rng.pick(pool);
    site.used = true;
    chosen.push({ rule, site });
  }

  // One conditional per run: the two x slots compete by weight; the loser's site returns to the POI pool.
  const xs = chosen.filter((c) => c.rule.id === 'x');
  const winner = rng.pickWeighted(xs, xs.map((c) => c.rule.weight));
  for (const c of xs) if (c !== winner) c.site.used = false;
  const weights = TUNING.gates.conditionalWeights;
  const xKinds = winner.rule.kinds.filter((k): k is Exclude<GateKind, 'timed'> => k !== 'timed');
  const xKind = rng.pickWeighted(xKinds, xKinds.map((k) => weights[k]));

  const out: GateCandidate[] = [];
  for (const c of chosen) {
    if (c.rule.id === 'x' && c !== winner) continue;
    const depth = c.site.depth;
    const x = Math.round(c.site.x);
    const y = Math.round(c.site.y);
    if (c.rule.id === 'a') {
      const openS = opts.ftue ? TUNING.ftue.gateAOpenS : TUNING.gate.a.openS;
      const closeS = opts.ftue ? TUNING.ftue.runS : TUNING.gate.a.closeS;
      out.push({ id: 'a', kind: 'timed', x, y, depth, opensS: openS, closesS: closeS + bonus });
    } else if (c.rule.id === 'b') {
      out.push({ id: 'b', kind: 'timed', x, y, depth, opensS: TUNING.gate.b.openS, closesS: TUNING.gate.b.closeS + bonus });
    } else if (c.rule.id === 'c') {
      out.push({ id: 'c', kind: 'timed', x, y, depth, opensS: TUNING.gate.c.openS, closesS: null });
    } else if (xKind === 'toll') {
      out.push({ id: 'x', kind: 'toll', x, y, depth, opensS: TUNING.gates.toll.opensS, closesS: TUNING.gates.toll.closesS + bonus });
    } else if (xKind === 'offering') {
      out.push({ id: 'x', kind: 'offering', x, y, depth, opensS: TUNING.gates.offering.opensS, closesS: null });
    } else {
      // Bell gate: condition-driven (opens `gates.bell.openS` after both bells ring); no clock schedule.
      out.push({ id: 'x', kind: 'bell', x, y, depth, opensS: 0, closesS: null });
    }
  }
  return out;
}

// ── 6 POIs ──────────────────────────────────────────────────────────────────

interface Quota { kind: PoiKind; depths: readonly Depth[]; count: number }

/**
 * `mapgen.poiCounts` in most-constrained-first order, depth law §3.3. Rows
 * restricted to the small inner rings (depth 1, depth 0-1) go first: on the
 * 6×6 map those rings are ~15% of the area.
 */
function quotas(withBells: boolean): Quota[] {
  const c = CFG.poiCounts;
  const lairInner = Math.round(c.lair / 4);
  const q: Quota[] = [
    { kind: 'den', depths: [2], count: c.den },
    { kind: 'vault', depths: [2], count: c.vault },
    { kind: 'lair', depths: [1], count: lairInner },
    { kind: 'fence', depths: [1], count: c.fence },
    { kind: 'lair', depths: [2], count: c.lair - lairInner },
    // The depth 0-1 rings hold only ~25 sites at `poiMinorSpacing`, so a
    // quarter of the rusted chests fill them and the rest spread over depth 2
    // (85% of the map) — otherwise the outer map would hold only t2/t3.
    { kind: 'chest_t1', depths: [0, 1], count: Math.round(c.chest_t1 / 4) },
    { kind: 'chest_t1', depths: [2], count: c.chest_t1 - Math.round(c.chest_t1 / 4) },
    { kind: 'event_yard', depths: [1, 2], count: c.event_yard },
    { kind: 'chest_t3', depths: [1, 2], count: c.chest_t3 },
    { kind: 'chest_t2', depths: [1, 2], count: c.chest_t2 },
  ];
  if (withBells) q.push({ kind: 'bell', depths: [1, 2], count: 2 });
  q.push(
    { kind: 'shrine_blood', depths: [1, 2], count: c.shrine_blood },
    { kind: 'shrine_bone', depths: [1, 2], count: c.shrine_bone },
    { kind: 'shrine_curse', depths: [1, 2], count: c.shrine_curse },
    { kind: 'shrine_grave', depths: [0, 1, 2], count: c.shrine_grave },
    { kind: 'shrine_gilt', depths: [0, 1, 2], count: c.shrine_gilt },
    { kind: 'lore', depths: [0, 1, 2], count: c.lore },
    { kind: 'vein', depths: [0, 1, 2], count: c.vein },
  );
  return q;
}

const POI_TOTAL = Object.values(CFG.poiCounts).reduce((a, b) => a + b, 0);
/** POI floor: every kind exact except veins (may run ≤ half short). */
const POI_QUOTA_MIN = POI_TOTAL - Math.floor(CFG.poiCounts.vein / 2);

function assignPois(
  rng: Rng,
  sites: Site[],
  spawn: { x: number; y: number },
  gates: readonly GateCandidate[],
  landmarks: ReadonlyArray<{ x: number; y: number; bodyR: number }>,
  withBells: boolean,
  roadDist: Float32Array,
): PoiAnchor[] | string {
  const pois: PoiAnchor[] = [];
  const counters: Partial<Record<PoiKind, number>> = {};
  // Placed POIs bucketed by `poiMinSpacing`: clearing and major-spacing
  // checks only look at the 3×3 neighbouring buckets, which cover that reach.
  const PB = Math.max(1024, CFG.poiMinSpacing);
  const pcols = Math.ceil(SIZE / PB);
  const placed: PoiAnchor[][] = Array.from({ length: pcols * pcols }, () => []);
  const near = (x: number, y: number, fn: (p: PoiAnchor) => boolean): boolean => {
    const c0 = Math.floor(x / PB);
    const r0 = Math.floor(y / PB);
    for (let r = Math.max(0, r0 - 1); r <= Math.min(pcols - 1, r0 + 1); r += 1) {
      for (let c = Math.max(0, c0 - 1); c <= Math.min(pcols - 1, c0 + 1); c += 1) {
        for (const p of placed[r * pcols + c]!) if (!fn(p)) return false;
      }
    }
    return true;
  };
  // Clearings never overlap each other, the spawn, a gate apron or a
  // landmark's main body; stamp ring pieces that would intrude a neighbour's
  // clearing are dropped at stamp time (they become extra openings).
  const fits = (s: Site, kind: PoiKind, major: boolean): boolean => {
    const clear = POI_CLEARING[kind];
    if (Math.hypot(s.x - spawn.x, s.y - spawn.y) < CFG.spawnClear + clear) return false;
    const edge = EDGE_SAFE_POIS.includes(kind) ? EDGE_SAFE : BORDER + clear * 0.6;
    if (s.x < edge || s.y < edge || s.x > SIZE - edge || s.y > SIZE - edge) return false;
    for (const g of gates) if (Math.hypot(s.x - g.x, s.y - g.y) < CFG.gateClear + clear) return false;
    for (const lm of landmarks) if (Math.hypot(s.x - lm.x, s.y - lm.y) < lm.bodyR + clear + 20) return false;
    return near(s.x, s.y, (p) => {
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < clear + p.radius) return false;
      return !(major && MAJOR_POIS.includes(p.kind) && d < CFG.poiMinSpacing);
    });
  };
  for (const q of quotas(withBells)) {
    const major = MAJOR_POIS.includes(q.kind);
    // One shuffled candidate order per quota row; each pick takes the first
    // that still fits. Majors try major sites first, then any site.
    // Roads lead to things: candidates are ranked by how far they sit from
    // "just beside a road" (clearing edge ~120 px off the road edge), plus a
    // 0-1,200 px random term so POIs line the roads without forming a queue.
    const want = roadHalf() + POI_CLEARING[q.kind] + 120;
    const base = sites.filter((s) => !s.used && q.depths.includes(s.depth));
    const key = new Map<Site, number>();
    for (const s of base) key.set(s, Math.abs(roadDist[cellOf(s.y) * MN + cellOf(s.x)]! - want) + rng.float(0, 1200));
    let order = base.sort((a, b) => key.get(a)! - key.get(b)!);
    if (major) order = [...order.filter((s) => s.major === true), ...order.filter((s) => s.major !== true)];
    let cursor = 0;
    for (let n = 0; n < q.count; n += 1) {
      let site: Site | null = null;
      while (cursor < order.length) {
        const s = order[cursor++]!;
        if (!s.used && fits(s, q.kind, major)) {
          site = s;
          break;
        }
      }
      if (site === null) {
        if (q.kind === 'vein') break;
        return `no site for ${q.kind}`;
      }
      site.used = true;
      const k = (counters[q.kind] ?? 0) + 1;
      counters[q.kind] = k;
      const poi: PoiAnchor = { id: `${q.kind}-${k}`, kind: q.kind, x: site.x, y: site.y, radius: POI_CLEARING[q.kind], depth: site.depth, region: site.region };
      pois.push(poi);
      placed[Math.floor(poi.y / PB) * pcols + Math.floor(poi.x / PB)]!.push(poi);
    }
  }
  return pois;
}

// ── 5 roads ─────────────────────────────────────────────────────────────────

function buildRoads(rng: Rng, nodes: ReadonlyArray<{ x: number; y: number }>): Segment[] {
  const n = nodes.length;
  const dist = (a: number, b: number): number => Math.hypot(nodes[a]!.x - nodes[b]!.x, nodes[a]!.y - nodes[b]!.y);
  // Prim's MST.
  const inTree = new Array<boolean>(n).fill(false);
  const best = new Array<number>(n).fill(Infinity);
  const parent = new Array<number>(n).fill(-1);
  best[0] = 0;
  const edges: Array<[number, number]> = [];
  for (let it = 0; it < n; it += 1) {
    let u = -1;
    for (let i = 0; i < n; i += 1) if (!inTree[i] && (u === -1 || best[i]! < best[u]!)) u = i;
    inTree[u] = true;
    if (parent[u]! >= 0) edges.push([parent[u]!, u]);
    for (let v = 0; v < n; v += 1) {
      if (inTree[v]) continue;
      const d = dist(u, v);
      if (d < best[v]!) { best[v] = d; parent[v] = u; }
    }
  }
  // Loop edges: the shortest non-tree pairs, sampled.
  const has = (a: number, b: number): boolean => edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a));
  const extra: Array<[number, number, number]> = [];
  for (let a = 0; a < n; a += 1) for (let b = a + 1; b < n; b += 1) if (!has(a, b)) extra.push([a, b, dist(a, b)]);
  extra.sort((p, q) => p[2] - q[2] || p[0] - q[0] || p[1] - q[1]);
  const loops = Math.round(edges.length * CFG.extraEdgeRatio);
  const shortlist = extra.slice(0, loops * 3);
  rng.shuffle(shortlist);
  for (const [a, b] of shortlist.slice(0, loops)) edges.push([a, b]);

  // Each edge bends through two offset control points (±12% of its length, perpendicular).
  const segs: Segment[] = [];
  for (const [a, b] of edges) {
    const A = nodes[a]!;
    const B = nodes[b]!;
    const len = dist(a, b);
    const nx = -(B.y - A.y) / len;
    const ny = (B.x - A.x) / len;
    const pts = [{ x: A.x, y: A.y }];
    for (const t of [1 / 3, 2 / 3]) {
      const off = rng.float(-0.12, 0.12) * len;
      pts.push({
        x: Math.min(SIZE - BORDER - 200, Math.max(BORDER + 200, A.x + (B.x - A.x) * t + nx * off)),
        y: Math.min(SIZE - BORDER - 200, Math.max(BORDER + 200, A.y + (B.y - A.y) * t + ny * off)),
      });
    }
    pts.push({ x: B.x, y: B.y });
    // Catmull-Rom through the bent control points: a smooth curve, 8 steps per leg.
    const curve: Array<{ x: number; y: number }> = [];
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const p0 = pts[Math.max(0, i - 1)]!;
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
      for (let k = 0; k < 8; k += 1) {
        const t = k / 8;
        const t2 = t * t;
        const t3 = t2 * t;
        curve.push({
          x: 0.5 * (2 * p1.x + (p2.x - p0.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (3 * p1.x - p0.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * (2 * p1.y + (p2.y - p0.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (3 * p1.y - p0.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    curve.push(pts[pts.length - 1]!);
    for (let i = 0; i + 1 < curve.length; i += 1) segs.push({ ax: curve[i]!.x, ay: curve[i]!.y, bx: curve[i + 1]!.x, by: curve[i + 1]!.y });
  }
  return segs;
}

function segDistance(s: Segment, x: number, y: number): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / l2));
  return Math.hypot(x - (s.ax + dx * t), y - (s.ay + dy * t));
}

/** Road curve pieces bucketed by 256 px cell; queries see segments within `ROAD_QUERY_RANGE`. */
const ROAD_QUERY_RANGE = 640;
const roadBuckets = new WeakMap<readonly Segment[], Segment[][]>();

function roadIndex(roads: readonly Segment[]): Segment[][] {
  let idx = roadBuckets.get(roads);
  if (idx !== undefined) return idx;
  idx = Array.from({ length: BN * BN }, () => []);
  for (const sg of roads) {
    const c0 = Math.max(0, Math.floor((Math.min(sg.ax, sg.bx) - ROAD_QUERY_RANGE) / BUCKET));
    const c1 = Math.min(BN - 1, Math.floor((Math.max(sg.ax, sg.bx) + ROAD_QUERY_RANGE) / BUCKET));
    const r0 = Math.max(0, Math.floor((Math.min(sg.ay, sg.by) - ROAD_QUERY_RANGE) / BUCKET));
    const r1 = Math.min(BN - 1, Math.floor((Math.max(sg.ay, sg.by) + ROAD_QUERY_RANGE) / BUCKET));
    for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) idx[r * BN + c]!.push(sg);
  }
  roadBuckets.set(roads, idx);
  return idx;
}

/** Distance to the nearest road centre line; exact within `ROAD_QUERY_RANGE`, else ≥ that range. */
function roadDistance(roads: readonly Segment[], x: number, y: number): number {
  const col = Math.min(BN - 1, Math.max(0, Math.floor(x / BUCKET)));
  const row = Math.min(BN - 1, Math.max(0, Math.floor(y / BUCKET)));
  let d = ROAD_QUERY_RANGE;
  for (const s of roadIndex(roads)[row * BN + col]!) d = Math.min(d, segDistance(s, x, y));
  return d;
}

/** Two-pass chamfer (32 / 45 px) distance from every mask cell to the nearest set cell. */
function distanceField(mask: Uint8Array): Float32Array {
  const d = new Float32Array(MN * MN);
  const D = MC;
  const DD = MC * SQRT2;
  for (let i = 0; i < d.length; i += 1) d[i] = mask[i] === 1 ? 0 : 1e9;
  for (let r = 0; r < MN; r += 1) {
    for (let c = 0; c < MN; c += 1) {
      const i = r * MN + c;
      let v = d[i]!;
      if (c > 0) v = Math.min(v, d[i - 1]! + D);
      if (r > 0) {
        v = Math.min(v, d[i - MN]! + D);
        if (c > 0) v = Math.min(v, d[i - MN - 1]! + DD);
        if (c < MN - 1) v = Math.min(v, d[i - MN + 1]! + DD);
      }
      d[i] = v;
    }
  }
  for (let r = MN - 1; r >= 0; r -= 1) {
    for (let c = MN - 1; c >= 0; c -= 1) {
      const i = r * MN + c;
      let v = d[i]!;
      if (c < MN - 1) v = Math.min(v, d[i + 1]! + D);
      if (r < MN - 1) {
        v = Math.min(v, d[i + MN]! + D);
        if (c < MN - 1) v = Math.min(v, d[i + MN + 1]! + DD);
        if (c > 0) v = Math.min(v, d[i + MN - 1]! + DD);
      }
      d[i] = v;
    }
  }
  return d;
}

function rasterRoads(roads: readonly Segment[], mask: Uint8Array): void {
  const half = roadHalf();
  for (const s of roads) {
    const c0 = cellOf(Math.min(s.ax, s.bx) - half);
    const c1 = cellOf(Math.max(s.ax, s.bx) + half);
    const r0 = cellOf(Math.min(s.ay, s.by) - half);
    const r1 = cellOf(Math.max(s.ay, s.by) + half);
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        if (segDistance(s, col * MC + MC / 2, row * MC + MC / 2) <= half) mask[row * MN + col] = 1;
      }
    }
  }
}

// ── hazards (§3.9) ──────────────────────────────────────────────────────────

function hazardAnchors(
  rng: Rng,
  zone: ZoneDef,
  clearings: readonly Circle[],
  roadMask: Uint8Array,
  floorOk: (x: number, y: number, clearance: number) => boolean,
): { anchors: Array<{ x: number; y: number }>; keepOut: Circle[] } {
  const p = zone.hazard.params;
  const anchors: Array<{ x: number; y: number }> = [];
  const keepOut: Circle[] = [];
  const clearIndex = new CircleIndex(clearings);

  // Road-bound kinds take road cells first, then (if the roads are full) open floor.
  const scatter = (count: number, radius: number, spacing: number, onRoad: boolean, blockRadius: number): void => {
    const road: Array<{ x: number; y: number }> = [];
    if (onRoad) {
      for (let i = 0; i < roadMask.length; i += 1) {
        if (roadMask[i] !== 1) continue;
        road.push({ x: (i % MN) * MC + MC / 2, y: Math.floor(i / MN) * MC + MC / 2 });
      }
    }
    const open: Array<{ x: number; y: number }> = [];
    const step = 128;
    for (let y = BORDER + radius; y < SIZE - BORDER - radius; y += step) {
      for (let x = BORDER + radius; x < SIZE - BORDER - radius; x += step) {
        open.push({ x: Math.round(x + rng.float(0, step * 0.8)), y: Math.round(y + rng.float(0, step * 0.8)) });
      }
    }
    const cands = [...rng.shuffle(road), ...rng.shuffle(open)];
    const start = anchors.length;
    const mine = new PointGrid(spacing);
    for (const c of cands) {
      if (anchors.length - start >= count) break;
      if (clearIndex.hits(c.x, c.y, radius * 0.5) || !floorOk(c.x, c.y, Math.min(radius, 64))) continue;
      if (mine.nearest(c.x, c.y, spacing) < spacing) continue;
      const a = { x: Math.round(c.x), y: Math.round(c.y) };
      mine.add(a);
      anchors.push(a);
      if (blockRadius > 0) keepOut.push({ x: a.x, y: a.y, r: blockRadius });
    }
  };

  switch (zone.hazard.kind) {
    case 'braziers':
      scatter(p.count ?? 0, p.radius ?? 110, 420, false, p.radius ?? 110);
      break;
    case 'bonestorm':
      // Ash zones stream along the roads; the gust carries them at runtime.
      scatter(p.dotZones ?? 0, p.dotRadius ?? 150, 700, true, 0);
      break;
    case 'sinksand':
      scatter(p.pits ?? 0, p.radius ?? 140, 520, false, p.radius ?? 140);
      break;
    case 'gale':
      // Order contract (systems/zone.ts): `iceSheets` ice anchors first, then `torches` torch anchors on roads.
      scatter(p.iceSheets ?? 0, p.iceRadius ?? 160, 560, false, p.iceRadius ?? 160);
      scatter(p.torches ?? 0, p.torchRadius ?? 260, 380, true, 70);
      break;
  }
  return { anchors, keepOut };
}

// ── spatial helpers ─────────────────────────────────────────────────────────

class CircleIndex {
  private readonly buckets: Circle[][] = Array.from({ length: BN * BN }, () => []);
  constructor(circles: readonly Circle[]) {
    for (const c of circles) {
      const b0 = Math.max(0, Math.floor((c.x - c.r) / BUCKET));
      const b1 = Math.min(BN - 1, Math.floor((c.x + c.r) / BUCKET));
      const r0 = Math.max(0, Math.floor((c.y - c.r) / BUCKET));
      const r1 = Math.min(BN - 1, Math.floor((c.y + c.r) / BUCKET));
      for (let row = r0; row <= r1; row += 1) for (let col = b0; col <= b1; col += 1) this.buckets[row * BN + col]!.push(c);
    }
  }
  /** True when a disc of radius `r` at (x, y) intersects any circle other than `except`. */
  hits(x: number, y: number, r: number, except: Circle | null = null): boolean {
    const b0 = Math.max(0, Math.floor((x - r) / BUCKET));
    const b1 = Math.min(BN - 1, Math.floor((x + r) / BUCKET));
    const r0 = Math.max(0, Math.floor((y - r) / BUCKET));
    const r1 = Math.min(BN - 1, Math.floor((y + r) / BUCKET));
    for (let row = r0; row <= r1; row += 1) {
      for (let col = b0; col <= b1; col += 1) {
        // +1 px: exported props are rounded to whole px, which may close a touching gap.
        for (const c of this.buckets[row * BN + col]!) if (c !== except && Math.hypot(x - c.x, y - c.y) < c.r + r + 1) return true;
      }
    }
    return false;
  }
}

/** Body spatial hash (256 px buckets) holding indices into the body array. */
class BodyHash {
  readonly buckets: number[][] = Array.from({ length: BN * BN }, () => []);
  bodies: readonly Body[] = [];
  rebuild(bodies: readonly Body[]): void {
    this.bodies = bodies;
    for (const b of this.buckets) b.length = 0;
    bodies.forEach((b, i) => { if (b.alive) this.add(b, i); });
  }
  add(b: Body, i: number): void {
    const col = Math.min(BN - 1, Math.max(0, Math.floor(b.x / BUCKET)));
    const row = Math.min(BN - 1, Math.max(0, Math.floor(b.y / BUCKET)));
    this.buckets[row * BN + col]!.push(i);
  }
  /** Calls `fn` with every live body index whose CENTRE lies within `reach` + max body radius of (x, y). */
  near(x: number, y: number, reach: number, fn: (i: number) => void): void {
    const span = reach + CFG.maxBodyRadius;
    const b0 = Math.max(0, Math.floor((x - span) / BUCKET));
    const b1 = Math.min(BN - 1, Math.floor((x + span) / BUCKET));
    const r0 = Math.max(0, Math.floor((y - span) / BUCKET));
    const r1 = Math.min(BN - 1, Math.floor((y + span) / BUCKET));
    for (let row = r0; row <= r1; row += 1) for (let col = b0; col <= b1; col += 1) for (const i of this.buckets[row * BN + col]!) fn(i);
  }
}

/** Blocking coverage on the mask raster: cells whose centre lies inside a body. */
class CoverageRaster {
  private readonly cells = new Uint8Array(MN * MN);
  private count = 0;
  private readonly walkable = (MN - 2 * Math.round(BORDER / MC)) ** 2;
  reset(): void {
    this.cells.fill(0);
    this.count = 0;
  }
  paint(b: Body): void {
    const c0 = cellOf(b.x - b.r);
    const c1 = cellOf(b.x + b.r);
    const r0 = cellOf(b.y - b.r);
    const r1 = cellOf(b.y + b.r);
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        const i = row * MN + col;
        if (this.cells[i] === 1) continue;
        if (Math.hypot(col * MC + MC / 2 - b.x, row * MC + MC / 2 - b.y) > b.r) continue;
        this.cells[i] = 1;
        this.count += 1;
      }
    }
  }
  share(): number {
    return this.count / this.walkable;
  }
}

/**
 * Room field on the mask raster: per cell, how far a cluster centred there
 * may spread (plus `CLUSTER_GAP`): up to any clearing/plaza/road edge, and a
 * full corridor short of the border and every body surface; capped at
 * `ROOM_CAP` (larger rooms all tie). Built by stamping each circle's and
 * body's neighbourhood, never by scanning every cell against every obstacle.
 *
 * `best` pops a max-room cell from a lazy max-heap: values only ever drop
 * (`carve`, `consume`), so a popped entry whose stored key is stale is
 * re-pushed at its current value. A fixed per-cell jitter (< 48 px) breaks
 * ties so equal rooms are chosen in seeded-random order.
 */
const ROOM_CAP = 640;
class RoomField {
  private readonly d = new Float32Array(MN * MN);
  private readonly jitter = new Float32Array(MN * MN);
  private readonly heap = new MinHeap();
  private readonly minRoom: number;

  constructor(rng: Rng, circles: readonly Circle[], roads: readonly Segment[], bodies: readonly Body[], minRoom: number) {
    this.minRoom = minRoom;
    const half = roadHalf();
    const d = this.d;
    for (let row = 0; row < MN; row += 1) {
      const y = row * MC + MC / 2;
      for (let col = 0; col < MN; col += 1) {
        const x = col * MC + MC / 2;
        const border = Math.min(x - BORDER, y - BORDER, SIZE - BORDER - x, SIZE - BORDER - y);
        d[row * MN + col] = Math.min(ROOM_CAP, border, roadDistance(roads, x, y) - half + CLUSTER_GAP);
      }
    }
    // Open-floor masks only need non-intersection: value = distance − r + gap.
    for (const c of circles) {
      const reach = c.r + ROOM_CAP - CLUSTER_GAP;
      const c0 = cellOf(c.x - reach);
      const c1 = cellOf(c.x + reach);
      const r0 = cellOf(c.y - reach);
      const r1 = cellOf(c.y + reach);
      for (let row = r0; row <= r1; row += 1) {
        const dy = row * MC + MC / 2 - c.y;
        for (let col = c0; col <= c1; col += 1) {
          const i = row * MN + col;
          const lim = d[i]! + c.r - CLUSTER_GAP;
          const dx = col * MC + MC / 2 - c.x;
          const q = dx * dx + dy * dy;
          if (lim <= 0) {
            d[i] = Math.min(d[i]!, Math.sqrt(q) - c.r + CLUSTER_GAP);
            continue;
          }
          if (q < lim * lim) d[i] = Math.sqrt(q) - c.r + CLUSTER_GAP;
        }
      }
    }
    this.carve(bodies);
    const salt = rng.int(1, 0x7fffffff);
    for (let i = 0; i < d.length; i += 1) {
      const j = (Math.imul(i ^ salt, 2654435761) >>> 0) % 4800 / 100;
      this.jitter[i] = j;
      if (d[i]! >= minRoom) this.heap.push(i, -(d[i]! + j));
    }
  }

  carve(bodies: readonly Body[]): void {
    for (const b of bodies) {
      if (!b.alive) continue;
      const reach = b.r + ROOM_CAP;
      const c0 = cellOf(b.x - reach);
      const c1 = cellOf(b.x + reach);
      const r0 = cellOf(b.y - reach);
      const r1 = cellOf(b.y + reach);
      for (let row = r0; row <= r1; row += 1) {
        const dy = row * MC + MC / 2 - b.y;
        for (let col = c0; col <= c1; col += 1) {
          const i = row * MN + col;
          const lim = this.d[i]! + b.r;
          if (lim <= 0) continue;
          const dx = col * MC + MC / 2 - b.x;
          const q = dx * dx + dy * dy;
          if (q < lim * lim) this.d[i] = Math.sqrt(q) - b.r;
        }
      }
    }
  }

  consume(x: number, y: number, r: number): void {
    const c0 = cellOf(x - r);
    const c1 = cellOf(x + r);
    const r0 = cellOf(y - r);
    const r1 = cellOf(y + r);
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        if (Math.hypot(col * MC + MC / 2 - x, row * MC + MC / 2 - y) <= r) this.d[row * MN + col] = -1;
      }
    }
  }

  /** A cell of (near-)maximal room, or null once no cell has `minRoom` left. */
  best(): { x: number; y: number; d: number } | null {
    while (this.heap.size > 0) {
      const i = this.heap.popIndex();
      const key = -this.heap.lastKey;
      const cur = this.d[i]! + this.jitter[i]!;
      if (cur < key - 0.5) {
        if (this.d[i]! >= this.minRoom) this.heap.push(i, -cur);
        continue;
      }
      return { x: (i % MN) * MC + MC / 2, y: Math.floor(i / MN) * MC + MC / 2, d: this.d[i]! };
    }
    return null;
  }
}

// ── 12 cluster archetypes ───────────────────────────────────────────────────

function pickProp(rng: Rng, defs: readonly PropDef[]): PropDef {
  return rng.pickWeighted(defs, defs.map((d) => d.weight));
}

/**
 * Variety for lone blockers: the same prop id keeps `SAME_PROP_PX` from
 * itself, a 1024² chunk holds ≤ `SHAPE_PER_CHUNK` lone props per shape class,
 * and the pick is by shape class first (uniform over the classes still
 * allowed here), then by prop weight within the class — so the mix reads as
 * many different silhouettes rather than the most common one.
 */
class Variety {
  private readonly pool: readonly PropDef[];
  private readonly byId: Record<string, PointGrid> = {};
  private readonly perChunk = new Map<number, Record<string, number>>();
  constructor(zone: ZoneDef) {
    this.pool = PROPS_BY_ZONE[zone.id].filter((d) => d.role !== 'landmark' && d.role !== 'wall' && d.role !== 'corner' && d.role !== 'fence' && d.role !== 'monolith');
  }
  private chunkKey(x: number, y: number): number {
    return Math.floor(y / 1024) * 64 + Math.floor(x / 1024);
  }
  pick(rng: Rng, x: number, y: number, maxR: number): PropDef | null {
    const counts = this.perChunk.get(this.chunkKey(x, y)) ?? {};
    const ok = this.pool.filter(
      (d) =>
        d.bodyRadius <= maxR &&
        (counts[d.shape] ?? 0) < SHAPE_PER_CHUNK &&
        (this.byId[d.id]?.nearest(x, y, SAME_PROP_PX) ?? SAME_PROP_PX) >= SAME_PROP_PX,
    );
    if (ok.length === 0) return null;
    const shapes = [...new Set(ok.map((d) => d.shape))];
    const shape = rng.pick(shapes);
    return pickProp(rng, ok.filter((d) => d.shape === shape));
  }
  note(b: Body): void {
    (this.byId[b.id] ??= new PointGrid(SAME_PROP_PX)).add({ x: b.x, y: b.y });
    const key = this.chunkKey(b.x, b.y);
    const counts = this.perChunk.get(key) ?? {};
    counts[b.shape] = (counts[b.shape] ?? 0) + 1;
    this.perChunk.set(key, counts);
  }
}

/**
 * One blocker placement (user request: blockers stand SINGLY, never heaped).
 * Composed structures keep their art abutting, never overlapping:
 * - `wall`: a near-horizontal run of one wall/fence cell at pitch = its art
 *   width + 4 (bodies `pitch/2 − 14`, sealed), 0-1 doorway ≥ 260, optional
 *   post caps abutting the ends;
 * - `graveyard`: a 3×3 to 4×5 grid of small graves at pitch = art + 8, bodies
 *   sized so every orthogonal and diagonal gap is sealed (no pockets);
 * - `monolith`: one large monolith;
 * - `lone`: one blocker from the zone's full pool via `Variety`.
 */
function buildCluster(
  rng: Rng,
  zone: ZoneDef,
  archetype: Exclude<ClusterArchetype, 'debris'>,
  sx: number,
  sy: number,
  extent: number,
  group: string,
  variety: Variety,
): Body[] {
  const out: Body[] = [];
  switch (archetype) {
    case 'wall': {
      const family = rng.chance(0.65) ? propsWithRole(zone.id, 'wall') : propsWithRole(zone.id, 'fence');
      const seg = pickProp(rng, family);
      const pitch = 2 * seg.visualR + 4;
      const r = Math.round(pitch / 2 - 14);
      const n = Math.min(rng.int(3, 6), Math.floor((2 * (extent - seg.visualR)) / pitch) + 1);
      if (n < 2) break;
      const angle = rng.float(-0.3, 0.3);
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const gapAt = n >= 4 && rng.chance(0.5) ? rng.int(1, n - 1) : -1;
      const gapExtra = gapAt < 0 ? 0 : rng.float(CFG.minCorridor + 20, CFG.minCorridor + 80) + 2 * r - pitch;
      let t = -((n - 1) * pitch + gapExtra) / 2;
      for (let i = 0; i < n; i += 1) {
        if (i === gapAt) t += gapExtra;
        out.push(makeBody(seg, sx + ca * t, sy + sa * t, r, angle, group, false));
        t += pitch;
      }
      const caps = propsWithRole(zone.id, 'post');
      if (caps.length > 0 && rng.chance(0.5)) {
        const cap = pickProp(rng, caps);
        const off = seg.visualR + cap.visualR + 4;
        if (((n - 1) * pitch + gapExtra) / 2 + off + cap.visualR < extent) {
          // Cap body sized so its gap to the end segment stays sealed.
          const cr = Math.max(24, Math.round(off - r - 30));
          const first = out[0]!;
          const last = out[out.length - 1]!;
          out.unshift(makeBody(cap, first.x - ca * off, first.y - sa * off, cr, 0, group, false));
          out.push(makeBody(cap, last.x + ca * off, last.y + sa * off, cr, 0, group, false));
        }
      }
      break;
    }
    case 'graveyard': {
      const graves = propsWithRole(zone.id, 'grave').filter((d) => d.visualR <= 64);
      if (graves.length === 0) break;
      const def = pickProp(rng, graves);
      const pitch = 2 * def.visualR + 8;
      // Diagonal gap (√2·pitch − 2r) ≤ 60 seals the grid; orthogonal gaps are smaller still.
      const r = Math.ceil((Math.SQRT2 * pitch - 60) / 2);
      const fit = Math.floor((2 * (extent - def.visualR)) / pitch) + 1;
      const cols = Math.min(rng.int(3, 4), fit);
      const rows = Math.min(rng.int(3, 5), fit);
      if (cols < 3 || rows < 3) break;
      for (let row = 0; row < rows; row += 1) {
        for (let c = 0; c < cols; c += 1) {
          out.push(makeBody(def, sx + (c - (cols - 1) / 2) * pitch, sy + (row - (rows - 1) / 2) * pitch, r, 0, group, false));
        }
      }
      break;
    }
    case 'monolith': {
      const big = propsWithRole(zone.id, 'monolith').filter((d) => d.bodyRadius <= extent);
      if (big.length > 0) {
        const def = pickProp(rng, big);
        out.push(makeBody(def, sx, sy, def.bodyRadius, 0, group, false));
      }
      break;
    }
    case 'lone': {
      const def = variety.pick(rng, sx, sy, extent);
      if (def !== null) out.push(makeBody(def, sx, sy, def.bodyRadius, 0, group, false));
      break;
    }
  }
  return out;
}

/**
 * The part of a built cluster that fits the map: wall runs keep their longest
 * contiguous fitting stretch (a hole mid-run would leave a sub-corridor gap),
 * graveyards fit whole or not at all, groves keep every fitting member (all
 * members are pairwise sealed-or-open by construction), monoliths are single.
 */
function fitCluster(archetype: ClusterArchetype, cluster: readonly Body[], hash: BodyHash, forbidden: CircleIndex, roads: readonly Segment[]): Body[] {
  if (cluster.length === 0) return [];
  const ok = cluster.map((b) => clusterBodyFits(b, hash, forbidden, roads));
  if (archetype !== 'wall') return ok.every(Boolean) ? [...cluster] : [];
  // A wall run keeps its longest contiguous fitting stretch (a hole mid-run
  // would leave a sub-corridor gap).
  let best: [number, number] = [0, 0];
  let start = 0;
  for (let i = 0; i <= ok.length; i += 1) {
    if (i < ok.length && ok[i]) continue;
    if (i - start > best[1] - best[0]) best = [start, i];
    start = i + 1;
  }
  return best[1] - best[0] >= 2 ? cluster.slice(best[0], best[1]) : [];
}

/**
 * A blocker fits when neither its body nor its art reaches a clearing, plaza
 * or road, and every existing blocker (of another structure) is a full
 * `gapMin` corridor away body to body and ≥ `SPRITE_GAP` art to art — nothing
 * is ever sealed onto another mass, so nothing heaps.
 */
function clusterBodyFits(b: Body, hash: BodyHash, forbidden: CircleIndex, roads: readonly Segment[], gapMin = CLUSTER_GAP): boolean {
  // Against the border band: sealed onto it or a full corridor away.
  for (const g of [b.x - b.r - BORDER, b.y - b.r - BORDER, SIZE - BORDER - b.x - b.r, SIZE - BORDER - b.y - b.r]) {
    if (g < 0 || (g > CLUSTER_SEAL / 2 && g < CFG.minCorridor)) return false;
  }
  const reach = Math.max(b.r, b.vr);
  if (forbidden.hits(b.x, b.y, reach)) return false;
  if (roadDistance(roads, b.x, b.y) < roadHalf() + reach) return false;
  let ok = true;
  hash.near(b.x, b.y, gapMin + b.r + b.vr, (i) => {
    if (!ok) return;
    const o = hash.bodies[i]!;
    if (!o.alive) return;
    const d = Math.hypot(o.x - b.x, o.y - b.y);
    if (d - o.r - b.r < gapMin || d - o.vr - b.vr < SPRITE_GAP) ok = false;
  });
  return ok;
}

function pickDecal(rng: Rng, defs: readonly DecalDef[]): DecalDef {
  return rng.pickWeighted(defs, defs.map((d) => d.weight));
}

// ── 14 corridor repair ──────────────────────────────────────────────────────

/**
 * Deletes one body of every visible pair (not inside one stamp) whose edge
 * gap is in [SEAL, minCorridor), bodies near the border with such a gap, and
 * any body intruding a clearing (hard rule). Returns true when anything died.
 */
function repairCorridors(bodies: Body[], clearings: CircleIndex): boolean {
  const hash = new BodyHash();
  hash.rebuild(bodies);
  let changed = false;
  const kill = (a: Body, b: Body | null): void => {
    // Cluster before stamp, then the smaller body.
    let victim = a;
    if (b !== null) {
      if (a.stamp !== b.stamp) victim = a.stamp ? b : a;
      else victim = a.r <= b.r ? a : b;
    }
    victim.alive = false;
    changed = true;
  };
  for (const b of bodies) {
    if (!b.alive) continue;
    if (clearings.hits(b.x, b.y, b.r)) {
      b.alive = false;
      changed = true;
    }
  }
  bodies.forEach((a, ia) => {
    if (!a.alive) return;
    const edges = [a.x - a.r - BORDER, a.y - a.r - BORDER, SIZE - BORDER - a.x - a.r, SIZE - BORDER - a.y - a.r];
    if (edges.some((g) => g >= SEAL && g < CFG.minCorridor)) { kill(a, null); return; }
    hash.near(a.x, a.y, CFG.minCorridor + a.r + a.vr, (ib) => {
      if (ib <= ia || !a.alive) return;
      const b = bodies[ib]!;
      if (!b.alive || a.group === b.group) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      // Art of two different structures may not overlap (no heaps), even when their bodies seal.
      if (d < a.vr + b.vr) {
        kill(a, b);
        return;
      }
      const gap = d - a.r - b.r;
      if (gap < SEAL || gap >= CFG.minCorridor) return;
      if (!gapVisible(a, b, d, hash, bodies)) return;
      kill(a, b);
    });
  });
  return changed;
}

/** True when no third body blocks the straight gap between two bodies' facing surfaces. */
function gapVisible(a: Body, b: Body, d: number, hash: BodyHash, bodies: readonly Body[]): boolean {
  const ux = (b.x - a.x) / d;
  const uy = (b.y - a.y) / d;
  const seg: Segment = { ax: a.x + ux * a.r, ay: a.y + uy * a.r, bx: b.x - ux * b.r, by: b.y - uy * b.r };
  const mx = (seg.ax + seg.bx) / 2;
  const my = (seg.ay + seg.by) / 2;
  let visible = true;
  hash.near(mx, my, d / 2 + 10, (i) => {
    if (!visible) return;
    const o = bodies[i]!;
    if (o === a || o === b || !o.alive) return;
    if (segDistance(seg, o.x, o.y) < o.r) visible = false;
  });
  return visible;
}

/** §3.8 metric: narrowest visible gap between bodies of different stamps/clusters (or a body and the border). */
function minCorridor(bodies: readonly Body[], hash: BodyHash): number {
  let min = Infinity;
  bodies.forEach((a, ia) => {
    if (!a.alive) return;
    for (const g of [a.x - a.r - BORDER, a.y - a.r - BORDER, SIZE - BORDER - a.x - a.r, SIZE - BORDER - a.y - a.r]) {
      if (g >= SEAL) min = Math.min(min, g);
    }
    hash.near(a.x, a.y, CFG.minCorridor + a.r, (ib) => {
      if (ib <= ia) return;
      const b = bodies[ib]!;
      if (!b.alive || (a.stamp && a.group === b.group)) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const gap = d - a.r - b.r;
      if (gap < SEAL || gap >= min) return;
      if (gapVisible(a, b, d, hash, bodies)) min = gap;
    });
  });
  return Number.isFinite(min) ? min : SIZE;
}

// ── 15 clearance field, flood, pockets, path factor ─────────────────────────

const CLEAR_CAP = 200;

class ClearanceField {
  /** Distance from each mask cell centre to the nearest body surface or border (px, ≤ 512). */
  readonly clear = new Float32Array(MN * MN);
  /** Crevices sealed by `sealPockets` (count as blocked). */
  readonly sealed = new Uint8Array(MN * MN);

  /**
   * Exact up to `CLEAR_CAP` (enough for the hero test at 32 px and the narrow
   * pre-filter at 180 px): the border distance, lowered by stamping each
   * body's neighbourhood.
   */
  compute(bodies: readonly Body[]): void {
    this.sealed.fill(0);
    const clear = this.clear;
    for (let row = 0; row < MN; row += 1) {
      const y = row * MC + MC / 2;
      const by = Math.min(y - BORDER, SIZE - BORDER - y, CLEAR_CAP);
      for (let col = 0; col < MN; col += 1) {
        const x = col * MC + MC / 2;
        clear[row * MN + col] = Math.min(by, x - BORDER, SIZE - BORDER - x);
      }
    }
    for (const b of bodies) {
      if (!b.alive) continue;
      const reach = b.r + CLEAR_CAP;
      const c0 = cellOf(b.x - reach);
      const c1 = cellOf(b.x + reach);
      const r0 = cellOf(b.y - reach);
      const r1 = cellOf(b.y + reach);
      for (let row = r0; row <= r1; row += 1) {
        const dy = row * MC + MC / 2 - b.y;
        for (let col = c0; col <= c1; col += 1) {
          const i = row * MN + col;
          const lim = clear[i]! + b.r;
          if (lim <= 0) continue;
          const dx = col * MC + MC / 2 - b.x;
          const q = dx * dx + dy * dy;
          if (q < lim * lim) clear[i] = Math.sqrt(q) - b.r;
        }
      }
    }
  }

  free(i: number): boolean {
    return this.clear[i]! >= HERO_INFLATE && this.sealed[i] === 0;
  }

  /** 8-connected flood (no corner cutting) of hero-free cells from the spawn. */
  flood(spawn: { x: number; y: number }): Uint8Array {
    const reach = new Uint8Array(MN * MN);
    const start = cellOf(spawn.y) * MN + cellOf(spawn.x);
    if (!this.free(start)) return reach;
    const queue = new Int32Array(MN * MN);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    reach[start] = 1;
    while (head < tail) {
      const cur = queue[head++]!;
      const row = (cur / MN) | 0;
      const col = cur - row * MN;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          const r = row + dr;
          const c = col + dc;
          if (r < 0 || c < 0 || r >= MN || c >= MN) continue;
          const n = r * MN + c;
          if (reach[n] === 1 || !this.free(n)) continue;
          if (dr !== 0 && dc !== 0 && (!this.free(row * MN + c) || !this.free(r * MN + col))) continue;
          reach[n] = 1;
          queue[tail++] = n;
        }
      }
    }
    return reach;
  }

  /** Free cells the flood never reached, grouped into 4-connected components. */
  pockets(reach: Uint8Array): number[][] {
    const seen = new Uint8Array(MN * MN);
    const out: number[][] = [];
    for (let i = 0; i < MN * MN; i += 1) {
      if (seen[i] === 1 || reach[i] === 1 || !this.free(i)) continue;
      const comp: number[] = [];
      const stack = [i];
      seen[i] = 1;
      while (stack.length > 0) {
        const cur = stack.pop()!;
        comp.push(cur);
        const row = (cur / MN) | 0;
        const col = cur - row * MN;
        const next = [col > 0 ? cur - 1 : -1, col < MN - 1 ? cur + 1 : -1, row > 0 ? cur - MN : -1, row < MN - 1 ? cur + MN : -1];
        for (const n of next) {
          if (n < 0 || seen[n] === 1 || reach[n] === 1 || !this.free(n)) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      out.push(comp);
    }
    return out;
  }

  sealPockets(reach: Uint8Array): void {
    for (const comp of this.pockets(reach)) for (const i of comp) this.sealed[i] = 1;
  }

  walkableCells(reach: Uint8Array): number[] {
    const out: number[] = [];
    for (let i = 0; i < MN * MN; i += 1) if (reach[i] === 1) out.push(i);
    return out;
  }

  /** Octile Dijkstra (no corner cutting) over reached cells; px distances. */
  pathDistances(reach: Uint8Array, spawn: { x: number; y: number }): Float64Array {
    // Float64 on purpose: a float32 store rounds below the heap key and the
    // stale-entry check would then skip live nodes.
    const dist = new Float64Array(MN * MN).fill(Infinity);
    const start = cellOf(spawn.y) * MN + cellOf(spawn.x);
    if (reach[start] !== 1) return dist;
    const heap = new MinHeap();
    dist[start] = 0;
    heap.push(start, 0);
    const diag = MC * SQRT2;
    while (heap.size > 0) {
      const cur = heap.popIndex();
      const dc = heap.lastKey;
      if (dc > dist[cur]!) continue;
      const row = (cur / MN) | 0;
      const col = cur - row * MN;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dq = -1; dq <= 1; dq += 1) {
          if (dr === 0 && dq === 0) continue;
          const r = row + dr;
          const c = col + dq;
          if (r < 0 || c < 0 || r >= MN || c >= MN) continue;
          const n = r * MN + c;
          if (reach[n] !== 1) continue;
          const isDiag = dr !== 0 && dq !== 0;
          if (isDiag && (reach[row * MN + c] !== 1 || reach[r * MN + col] !== 1)) continue;
          const nd = dc + (isDiag ? diag : MC);
          if (nd < dist[n]!) {
            dist[n] = nd;
            heap.push(n, nd);
          }
        }
      }
    }
    return dist;
  }

  /**
   * §3.8 narrow share: reached cells whose local passage — nearest surface
   * plus nearest surface of a DIFFERENT obstacle (other stamp/cluster or the
   * border) on the far side (> 90° apart) — is narrower than 360 px.
   */
  narrowShare(reach: Uint8Array, bodies: readonly Body[], hash: BodyHash): number {
    let total = 0;
    let narrow = 0;
    const near: Array<{ d: number; ux: number; uy: number; g: string }> = [];
    // Sampled on every other row and column (¼ of the cells): a share, not a census.
    for (let i = 0; i < MN * MN; i += 1) {
      if (reach[i] !== 1) continue;
      const row = (i / MN) | 0;
      if ((row & 1) === 1 || ((i - row * MN) & 1) === 1) continue;
      total += 1;
      if (this.clear[i]! >= NARROW / 2) continue;
      const x = (i - row * MN) * MC + MC / 2;
      const y = row * MC + MC / 2;
      near.length = 0;
      near.push({ d: x - BORDER, ux: -1, uy: 0, g: 'bw' }, { d: SIZE - BORDER - x, ux: 1, uy: 0, g: 'be' });
      near.push({ d: y - BORDER, ux: 0, uy: -1, g: 'bn' }, { d: SIZE - BORDER - y, ux: 0, uy: 1, g: 'bs' });
      hash.near(x, y, NARROW, (k) => {
        const b = bodies[k]!;
        if (!b.alive) return;
        const dd = Math.hypot(b.x - x, b.y - y);
        const s = dd - b.r;
        if (s >= NARROW || dd === 0) return;
        near.push({ d: s, ux: (b.x - x) / dd, uy: (b.y - y) / dd, g: b.group });
      });
      let first = near[0]!;
      for (const n of near) if (n.d < first.d) first = n;
      let second = Infinity;
      for (const n of near) {
        if (n.g === first.g || n.ux * first.ux + n.uy * first.uy >= 0) continue;
        if (n.d < second) second = n.d;
      }
      if (first.d + second < NARROW) narrow += 1;
    }
    return total === 0 ? 1 : narrow / total;
  }
}

class MinHeap {
  private readonly idx: number[] = [];
  private readonly key: number[] = [];
  lastKey = 0;
  get size(): number {
    return this.idx.length;
  }
  push(i: number, k: number): void {
    const idx = this.idx;
    const key = this.key;
    idx.push(i);
    key.push(k);
    let n = idx.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (key[p]! <= k) break;
      idx[n] = idx[p]!;
      key[n] = key[p]!;
      n = p;
    }
    idx[n] = i;
    key[n] = k;
  }
  popIndex(): number {
    const idx = this.idx;
    const key = this.key;
    const top = idx[0]!;
    this.lastKey = key[0]!;
    const li = idx.pop()!;
    const lk = key.pop()!;
    const len = idx.length;
    if (len > 0) {
      let n = 0;
      for (;;) {
        const l = 2 * n + 1;
        if (l >= len) break;
        const r = l + 1;
        const c = r < len && key[r]! < key[l]! ? r : l;
        if (key[c]! >= lk) break;
        idx[n] = idx[c]!;
        key[n] = key[c]!;
        n = c;
      }
      idx[n] = li;
      key[n] = lk;
    }
    return top;
  }
}

/** Pockets ≥ `POCKET_SEAL_CELLS`: delete the smallest body touching the pocket. */
function repairPockets(bodies: Body[], hash: BodyHash, field: ClearanceField, reach: Uint8Array): boolean {
  let changed = false;
  for (const comp of field.pockets(reach)) {
    if (comp.length < POCKET_SEAL_CELLS) continue;
    let victim: Body | null = null;
    for (const i of comp) {
      const row = (i / MN) | 0;
      const x = (i - row * MN) * MC + MC / 2;
      const y = row * MC + MC / 2;
      hash.near(x, y, 64, (k) => {
        const b = bodies[k]!;
        if (!b.alive || Math.hypot(b.x - x, b.y - y) - b.r > field.clear[i]! + MC) return;
        if (victim === null || (victim.stamp && !b.stamp) || (victim.stamp === b.stamp && b.r < victim.r)) victim = b;
      });
    }
    if (victim !== null) {
      (victim as Body).alive = false;
      changed = true;
    }
  }
  return changed;
}

function pathAt(dist: Float64Array, x: number, y: number): number {
  const c = cellOf(x);
  const r = cellOf(y);
  let best = Infinity;
  for (let dr = -3; dr <= 3; dr += 1) {
    for (let dc = -3; dc <= 3; dc += 1) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= MN || cc >= MN) continue;
      const d = dist[rr * MN + cc]!;
      if (d === Infinity) continue;
      best = Math.min(best, d + Math.hypot(dr, dc) * MC);
    }
  }
  return best;
}

function worstPathFactor(
  dist: Float64Array,
  spawn: { x: number; y: number },
  targets: ReadonlyArray<{ x: number; y: number }>,
): { factor: number; target: { x: number; y: number } | null } {
  let factor = 0;
  let target: { x: number; y: number } | null = null;
  for (const t of targets) {
    const e = Math.hypot(t.x - spawn.x, t.y - spawn.y);
    if (e < 1) continue;
    const f = pathAt(dist, t.x, t.y) / e;
    if (f > factor) {
      factor = f;
      target = t;
    }
  }
  return { factor, target };
}

/** Clears blockers along the straight spawn→target line (cluster bodies first, smallest first). */
function clearLine(bodies: Body[], a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const seg: Segment = { ax: a.x, ay: a.y, bx: b.x, by: b.y };
  const hits = bodies.filter((o) => o.alive && segDistance(seg, o.x, o.y) < o.r + CFG.minCorridor / 2);
  if (hits.length === 0) return false;
  hits.sort((p, q) => Number(p.stamp) - Number(q.stamp) || p.r - q.r);
  const n = Math.max(1, Math.ceil(hits.length / 3));
  for (const h of hits.slice(0, n)) h.alive = false;
  return true;
}

// ── 17-18 decals, lights, breakables ────────────────────────────────────────

/**
 * Floor debris, composed (user bug: uniform overlapping decals read as noise).
 * Candidate spots come from three sources, each matching a decal's `near`:
 * beside roads (200-420 px off the road edge), at the foot of blocking masses
 * (200-380 px off a body's surface) and the `debris` archetype's open-floor
 * spots. Every decal keeps ≥ 200 px from bodies, roads and clearings, ≥
 * `decalSpacing` from every other decal (never overlapping) and ≥
 * `decalSameIdPx` from the same id. Anchors seed 1-2 decals each, so debris
 * gathers where something happened and open floor stays clean.
 */
function placeDecals(
  rng: Rng,
  zone: ZoneDef,
  ctx: {
    roadDist: Float32Array;
    field: ClearanceField;
    reach: Uint8Array;
    clearIndex: CircleIndex;
    bodies: readonly Body[];
    debrisSpots: ReadonlyArray<{ x: number; y: number }>;
  },
  count: number,
  out: PlacedDecal[],
): void {
  const defs = DECALS_BY_ZONE[zone.id];
  if (defs.length === 0 || count <= 0) return;
  const KEEP = 200;
  const ok = (x: number, y: number): boolean => {
    if (x < BORDER + KEEP || y < BORDER + KEEP || x > SIZE - BORDER - KEEP || y > SIZE - BORDER - KEEP) return false;
    const i = cellOf(y) * MN + cellOf(x);
    return ctx.reach[i] === 1 && ctx.field.clear[i]! >= KEEP && ctx.roadDist[i]! >= KEEP && !ctx.clearIndex.hits(x, y, KEEP);
  };
  type Anchor = { x: number; y: number; road: boolean };
  const anchors: Anchor[] = [];
  // Road verges: sampled every 4 mask cells.
  for (let r = 0; r < MN; r += 4) {
    for (let c = 0; c < MN; c += 4) {
      const d = ctx.roadDist[r * MN + c]!;
      if (d >= KEEP && d <= 420) anchors.push({ x: c * MC + MC / 2, y: r * MC + MC / 2, road: true });
    }
  }
  const roadAnchors = anchors.length;
  for (const b of ctx.bodies) {
    if (!b.alive) continue;
    const a = rng.float(0, Math.PI * 2);
    const d = b.r + rng.float(KEEP, 380);
    anchors.push({ x: b.x + Math.cos(a) * d, y: b.y + Math.sin(a) * d, road: false });
  }
  for (const p of ctx.debrisSpots) anchors.push({ x: p.x, y: p.y, road: false });
  // Roads get about a third of the debris; masses and debris spots the rest.
  const order = [...rng.shuffle(anchors.slice(0, roadAnchors)).slice(0, Math.ceil(count / 3)), ...rng.shuffle(anchors.slice(roadAnchors))];
  rng.shuffle(order);
  const all = new PointGrid(CFG.decalSpacing);
  const byId: Record<string, PointGrid> = {};
  for (const anchor of order) {
    if (out.length >= count) break;
    const fit = defs.filter((d) => d.near === 'any' || d.near === (anchor.road ? 'road' : 'prop'));
    if (fit.length === 0) continue;
    const n = rng.chance(0.4) ? 2 : 1;
    for (let k = 0; k < n && out.length < count; k += 1) {
      const def = pickDecal(rng, fit);
      const a = rng.float(0, Math.PI * 2);
      const j = k === 0 ? rng.float(0, 60) : rng.float(CFG.decalSpacing, CFG.decalSpacing + 80);
      const x = Math.round(anchor.x + Math.cos(a) * j);
      const y = Math.round(anchor.y + Math.sin(a) * j);
      if (!ok(x, y) || all.nearest(x, y, CFG.decalSpacing) < CFG.decalSpacing) continue;
      const same = (byId[def.id] ??= new PointGrid(CFG.decalSameIdPx));
      if (same.nearest(x, y, CFG.decalSameIdPx) < CFG.decalSameIdPx) continue;
      all.add({ x, y });
      same.add({ x, y });
      const rot = def.spin === 'free' ? rng.float(0, Math.PI * 2) : rng.float(-UPRIGHT_TILT, UPRIGHT_TILT);
      out.push({ id: def.id, x, y, rot: round3(rot), alpha: def.alpha });
    }
  }
}

/** Upright decals (wheels, banners, feather fans) tilt at most ±15°. */
const UPRIGHT_TILT = (15 * Math.PI) / 180;

function placeLights(
  rng: Rng,
  bodies: readonly Body[],
  landmarks: ReadonlyArray<{ x: number; y: number }>,
  gates: readonly GateCandidate[],
  pois: readonly PoiAnchor[],
  target: number,
): Array<{ x: number; y: number; r: number }> {
  const out: Array<{ x: number; y: number; r: number }> = [];
  const add = (x: number, y: number, r: number): void => {
    if (out.length >= target) return;
    if (out.some((l) => Math.hypot(l.x - x, l.y - y) < 220)) return;
    out.push({ x: Math.round(x), y: Math.round(y), r });
  };
  for (const lm of landmarks) add(lm.x, lm.y + 60, 320);
  const lit = rng.shuffle(bodies.filter((b) => b.alive && b.light));
  for (const b of lit) add(b.x, b.y, 256);
  for (const g of gates) add(g.x, g.y, 300);
  const warm = rng.shuffle(pois.filter((p) => p.kind.startsWith('chest') || p.kind.startsWith('shrine') || p.kind === 'vault' || p.kind === 'den' || p.kind === 'fence' || p.kind === 'lair'));
  for (const p of warm) add(p.x, p.y, 256);
  return out;
}

function placeBreakables(
  rng: Rng,
  field: ClearanceField,
  reach: Uint8Array,
  clearings: readonly Circle[],
  keepOut: readonly Circle[],
): Array<{ x: number; y: number; kind: 'urn' | 'coffin' | 'crate' }> {
  const out: Array<{ x: number; y: number; kind: 'urn' | 'coffin' | 'crate' }> = [];
  const step = Math.sqrt(1 / CFG.breakablePerPx2);
  const kinds = ['urn', 'crate', 'coffin'] as const;
  const weights = [40, 35, 25];
  // Spawn and gate clearings stay empty; POI clearings keep their floor for the POI.
  const avoid = new CircleIndex([...clearings, ...keepOut]);
  for (let gy = BORDER; gy < SIZE - BORDER; gy += step) {
    for (let gx = BORDER; gx < SIZE - BORDER; gx += step) {
      const x = gx + rng.float(0.15, 0.85) * step;
      const y = gy + rng.float(0.15, 0.85) * step;
      const kind = rng.pickWeighted(kinds, weights);
      const i = cellOf(y) * MN + cellOf(x);
      if (reach[i] !== 1 || field.clear[i]! < 56) continue;
      if (avoid.hits(x, y, 24)) continue;
      out.push({ x: Math.round(x), y: Math.round(y), kind });
    }
  }
  return out;
}

// ── 19 nav export, floor ────────────────────────────────────────────────────

/** Octile Dijkstra (no corner cutting) over the nav raster from the spawn cell; px distances. */
function navPathDistances(blocked: Uint8Array, spawn: { x: number; y: number }): Float64Array {
  const dist = new Float64Array(NN * NN).fill(Infinity);
  const start = Math.floor(spawn.y / NC) * NN + Math.floor(spawn.x / NC);
  const heap = new MinHeap();
  dist[start] = 0;
  heap.push(start, 0);
  const diag = NC * SQRT2;
  while (heap.size > 0) {
    const cur = heap.popIndex();
    const dc = heap.lastKey;
    if (dc > dist[cur]!) continue;
    const row = (cur / NN) | 0;
    const col = cur - row * NN;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dq = -1; dq <= 1; dq += 1) {
        if (dr === 0 && dq === 0) continue;
        const r = row + dr;
        const c = col + dq;
        if (r < 0 || c < 0 || r >= NN || c >= NN) continue;
        const n = r * NN + c;
        if (blocked[n] === 1) continue;
        const isDiag = dr !== 0 && dq !== 0;
        if (isDiag && (blocked[row * NN + c] === 1 || blocked[r * NN + col] === 1)) continue;
        const nd = dc + (isDiag ? diag : NC);
        if (nd < dist[n]!) {
          dist[n] = nd;
          heap.push(n, nd);
        }
      }
    }
  }
  return dist;
}

function navRaster(
  bodies: readonly Body[],
  hash: BodyHash,
  field: ClearanceField,
  spawn: { x: number; y: number },
  anchors: ReadonlyArray<{ x: number; y: number }>,
): Uint8Array {
  const blocked = new Uint8Array(NN * NN);
  const ratio = NC / MC;
  // A cell holding an anchor is tested AT the anchor (guaranteed clear by its
  // clearing ≥ 60 px), not at the cell centre, which may sit up to 45 px off it.
  const probe = new Float64Array(NN * NN * 2).fill(NaN);
  for (const a of anchors) {
    const i = Math.floor(a.y / NC) * NN + Math.floor(a.x / NC);
    probe[i * 2] = a.x;
    probe[i * 2 + 1] = a.y;
  }
  for (let row = 0; row < NN; row += 1) {
    for (let col = 0; col < NN; col += 1) {
      const pi = (row * NN + col) * 2;
      const anchored = !Number.isNaN(probe[pi]!);
      const x = anchored ? probe[pi]! : col * NC + NC / 2;
      const y = anchored ? probe[pi + 1]! : row * NC + NC / 2;
      let b = x < BORDER + HERO_INFLATE || y < BORDER + HERO_INFLATE || x > SIZE - BORDER - HERO_INFLATE || y > SIZE - BORDER - HERO_INFLATE;
      if (!b) {
        hash.near(x, y, HERO_INFLATE, (k) => {
          const o = bodies[k]!;
          if (o.alive && Math.hypot(o.x - x, o.y - y) < o.r + HERO_INFLATE) b = true;
        });
      }
      // A nav cell whose four mask sub-cells are all sealed crevices is solid.
      if (!b) {
        let sealedSub = 0;
        for (let dr = 0; dr < ratio; dr += 1) for (let dc = 0; dc < ratio; dc += 1) sealedSub += field.sealed[(row * ratio + dr) * MN + col * ratio + dc]!;
        if (sealedSub === ratio * ratio) b = true;
      }
      blocked[row * NN + col] = b ? 1 : 0;
    }
  }
  // Cells the hero cannot reach on the nav raster are blocked too, so spawn
  // rejection and flow fields never treat an enclosed pocket as floor.
  const reach = new Uint8Array(NN * NN);
  const start = Math.floor(spawn.y / NC) * NN + Math.floor(spawn.x / NC);
  blocked[start] = 0;
  const queue = new Int32Array(NN * NN);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  reach[start] = 1;
  while (head < tail) {
    const cur = queue[head++]!;
    const row = (cur / NN) | 0;
    const col = cur - row * NN;
    const next = [col > 0 ? cur - 1 : -1, col < NN - 1 ? cur + 1 : -1, row > 0 ? cur - NN : -1, row < NN - 1 ? cur + NN : -1];
    for (const n of next) {
      if (n < 0 || reach[n] === 1 || blocked[n] === 1) continue;
      reach[n] = 1;
      queue[tail++] = n;
    }
  }
  for (let i = 0; i < NN * NN; i += 1) if (reach[i] === 0) blocked[i] = 1;
  return blocked;
}

function floorRaster(rng: Rng, roadMask: Uint8Array): GeneratedMap['floor'] {
  // 512 px value noise: random lattice every 2 tiles, bilinear between.
  const ln = Math.ceil(FN / 2) + 1;
  const lattice = new Float32Array(ln * ln);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = rng.next();
  const variant = new Uint8Array(FN * FN);
  const road = new Uint8Array(FN * FN);
  const sub = FLOOR_TILE / MC;
  for (let row = 0; row < FN; row += 1) {
    for (let col = 0; col < FN; col += 1) {
      const fx = (col + 0.5) / 2;
      const fy = (row + 0.5) / 2;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const v00 = lattice[y0 * ln + x0]!;
      const v10 = lattice[y0 * ln + x0 + 1]!;
      const v01 = lattice[(y0 + 1) * ln + x0]!;
      const v11 = lattice[(y0 + 1) * ln + x0 + 1]!;
      const v = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
      variant[row * FN + col] = v < 0.45 ? 0 : v < 0.7 ? 1 : 2;
      let roadCells = 0;
      for (let dr = 0; dr < sub; dr += 1) for (let dc = 0; dc < sub; dc += 1) roadCells += roadMask[(row * sub + dr) * MN + col * sub + dc]!;
      road[row * FN + col] = roadCells >= (sub * sub * 3) / 8 ? 1 : 0;
    }
  }
  return { cols: FN, rows: FN, cell: FLOOR_TILE, variant, road };
}
