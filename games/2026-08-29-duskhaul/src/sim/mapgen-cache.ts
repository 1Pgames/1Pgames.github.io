/**
 * Node-only disk cache for `generateMap` — the sim and the kit selftests only;
 * the browser game never imports this file (it reaches for `node:fs`).
 *
 * `generateMap(zone, seed, opts)` is pure and deterministic, and on a 24576²
 * map it costs ~0.4 s, which `npm run verify` used to pay ~2000 times. A hit
 * here is a gunzip + `v8.deserialize` (structured clone: typed arrays,
 * `Infinity`, `undefined` and nesting round-trip exactly).
 *
 * KEY = sha256 over
 *   - the content of every file in `systems/mapgen.ts`'s static import closure
 *     (walked from source, so a new mapgen dependency is hashed without anyone
 *     updating a list),
 *   - `TUNING.mapgen` / `TUNING.arena` serialized (belt and braces: config.ts is
 *     already in the closure),
 *   - the V8 version (serialization format and Math results),
 *   - zone id + the zone row, seed, and `JSON.stringify(opts)`.
 * Any edit to a mapgen input therefore misses the cache; nothing is ever
 * invalidated by hand. Entries live in `.cache/mapgen/<source hash>/`
 * (gitignored); the first write under a new source hash deletes every other
 * source-hash dir, so the cache holds one generation of inputs at a time.
 *
 * A cached map equals a fresh one except `metrics.ms`, which is the wall-clock
 * measurement taken when the entry was generated — the mapgen selftest's
 * timing and determinism gates therefore call `generateMap` directly. The
 * generator's `mapgen:reroll` diagnostics print only when a map is generated.
 *
 * `MAPGEN_NO_CACHE=1` bypasses reads and writes entirely.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deserialize, serialize } from 'node:v8';
import { gunzipSync, gzipSync, constants as zlibConstants } from 'node:zlib';
import { isMainThread, threadId, Worker, workerData } from 'node:worker_threads';

import { TUNING } from '../config';
import type { GeneratedMap } from '../data/types-v2';
import { ZONES, type ZoneDef } from '../data/zones';
import { generateMap, type GenerateMapOptions } from '../systems/mapgen';

/** Bump when the on-disk entry layout changes. */
const FORMAT = 1;
const SRC_DIR = fileURLToPath(new URL('../', import.meta.url));
const MAPGEN_ENTRY = join(SRC_DIR, 'systems/mapgen.ts');
const MAPGEN_CACHE_DIR = resolve(SRC_DIR, '../.cache/mapgen');

const IMPORT_RE = /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;
const EXTENSIONS = ['', '.ts', '.tsx', '.mts', '/index.ts'];

function resolveRelative(fromFile: string, specifier: string): string {
  const base = resolve(dirname(fromFile), specifier);
  for (const ext of EXTENSIONS) {
    try {
      readFileSync(base + ext);
      return base + ext;
    } catch {
      // try the next extension
    }
  }
  throw new Error(`mapgen-cache: cannot resolve ${specifier} from ${fromFile}`);
}

/** Every file `systems/mapgen.ts` statically imports, transitively (sorted, absolute). */
export function mapgenSourceClosure(): string[] {
  const seen = new Set<string>();
  const stack = [MAPGEN_ENTRY];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(IMPORT_RE)) stack.push(resolveRelative(file, match[1]!));
  }
  return [...seen].sort();
}

let sourceHashMemo: string | undefined;

/** Content hash of every mapgen input: the entry dir name, and the CI `actions/cache` key (`npm run sim -- --mapgen-cache-key`). */
export function mapgenSourceHash(): string {
  if (sourceHashMemo !== undefined) return sourceHashMemo;
  const hash = createHash('sha256');
  hash.update(`format:${FORMAT}\0v8:${process.versions.v8}\0`);
  for (const file of mapgenSourceClosure()) {
    hash.update(file.slice(SRC_DIR.length));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  hash.update(JSON.stringify({ mapgen: TUNING.mapgen, arena: (TUNING as Record<string, unknown>).arena ?? null }));
  sourceHashMemo = hash.digest('hex');
  return sourceHashMemo;
}

function mapgenCacheEnabled(): boolean {
  return process.env.MAPGEN_NO_CACHE !== '1';
}

function entryPath(zone: ZoneDef, seed: string, opts: GenerateMapOptions): string {
  const source = mapgenSourceHash();
  const key = createHash('sha256')
    .update(source)
    .update('\0')
    .update(zone.id)
    .update('\0')
    .update(JSON.stringify(zone))
    .update('\0')
    .update(seed)
    .update('\0')
    .update(JSON.stringify(opts))
    .digest('hex');
  return join(MAPGEN_CACHE_DIR, source, `${key}.v8.gz`);
}

let prunedStale = false;
let tmpCounter = 0;

/** The exact bytes an entry stores. */
function encodeMap(map: GeneratedMap): Buffer {
  return gzipSync(serialize(map), { level: zlibConstants.Z_BEST_SPEED });
}

function decodeMap(bytes: Buffer): GeneratedMap {
  return deserialize(gunzipSync(bytes)) as GeneratedMap;
}

/** The cached entry for these inputs, or `undefined` (miss, unreadable, or cache disabled). */
function readCachedMap(zone: ZoneDef, seed: string, opts: GenerateMapOptions = {}): GeneratedMap | undefined {
  if (!mapgenCacheEnabled()) return undefined;
  let bytes: Buffer;
  try {
    bytes = readFileSync(entryPath(zone, seed, opts));
  } catch {
    return undefined;
  }
  try {
    return decodeMap(bytes);
  } catch {
    // A torn/corrupt entry is a miss; the caller regenerates and overwrites it.
    return undefined;
  }
}

/** Stores `map` as the entry for these inputs (atomic rename: parallel writers never tear a file). */
function writeCachedMap(zone: ZoneDef, seed: string, opts: GenerateMapOptions, map: GeneratedMap): void {
  if (!mapgenCacheEnabled()) return;
  const path = entryPath(zone, seed, opts);
  if (!prunedStale) {
    prunedStale = true;
    // Entries of any other source hash can never hit again.
    const current = mapgenSourceHash();
    let stale: string[] = [];
    try {
      stale = readdirSync(MAPGEN_CACHE_DIR).filter((name) => name !== current);
    } catch {
      // no cache dir yet
    }
    for (const name of stale) rmSync(join(MAPGEN_CACHE_DIR, name), { recursive: true, force: true });
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}-${threadId}-${(tmpCounter += 1)}.tmp`;
  writeFileSync(tmp, encodeMap(map));
  renameSync(tmp, path);
}

/** Drop-in for `generateMap` in node-only callers (sim, selftests). */
export function cachedGenerateMap(zone: ZoneDef, seed: string, opts: GenerateMapOptions = {}): GeneratedMap {
  const hit = readCachedMap(zone, seed, opts);
  if (hit !== undefined) return hit;
  const map = generateMap(zone, seed, opts);
  writeCachedMap(zone, seed, opts, map);
  return map;
}

/**
 * Generates every MISSING entry among `seeds` × `zones` on a pool of worker
 * threads (one per core; `MAPGEN_WORKERS=N` overrides), so a serial consumer
 * loop that follows reads only hits. A cold 200-seed selftest drops from
 * ~0.4 s × 800 serial generations to that work spread over every core; the
 * maps are the same `generateMap` output either way. No-op when the cache is
 * disabled or already warm.
 */
/** `workerData.role` of a prewarm worker: this very module (see the bottom of the file). */
const PREWARM_WORKER = 'mapgen-prewarm-worker';

export async function prewarmMapCache(zones: readonly ZoneDef[], seeds: readonly string[]): Promise<void> {
  if (!mapgenCacheEnabled()) return;
  const missing: { zoneId: string; seed: string }[] = [];
  for (const zone of zones) {
    for (const seed of seeds) if (!existsSync(entryPath(zone, seed, {}))) missing.push({ zoneId: zone.id, seed });
  }
  const requested = Number(process.env.MAPGEN_WORKERS ?? availableParallelism());
  const workerCount = Math.min(missing.length, Number.isInteger(requested) && requested > 0 ? requested : 1);
  if (workerCount <= 1) {
    for (const { zoneId, seed } of missing) cachedGenerateMap(zones.find((z) => z.id === zoneId)!, seed);
    return;
  }
  await Promise.all(
    Array.from({ length: workerCount }, (_, w) => {
      const worker = new Worker(new URL(import.meta.url), {
        workerData: { role: PREWARM_WORKER, jobs: missing.filter((_job, i) => i % workerCount === w) },
      });
      return new Promise<void>((resolveDone, reject) => {
        worker.on('error', reject);
        worker.on('exit', (code) => (code === 0 ? resolveDone() : reject(new Error(`mapgen cache worker exited with code ${code}`))));
      });
    }),
  );
}

if (!isMainThread && (workerData as { role?: unknown } | null)?.role === PREWARM_WORKER) {
  for (const { zoneId, seed } of (workerData as { jobs: { zoneId: string; seed: string }[] }).jobs) {
    const zone = ZONES.find((z) => z.id === zoneId);
    if (zone === undefined) throw new Error(`mapgen cache prewarm: unknown zone ${zoneId}`);
    cachedGenerateMap(zone, seed);
  }
}
