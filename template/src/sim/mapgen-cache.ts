/**
 * Node-only disk cache for `generateWorld` — the sim and the kit selftests
 * only; the browser game never imports this file (it reaches for `node:fs`).
 * Ported from duskhaul `src/sim/mapgen-cache.ts`.
 *
 * `generateWorld(world, seed)` is pure and deterministic, but a gate that
 * reads hundreds of seeded worlds per `npm run verify` should pay for each one
 * once. A hit here is a gunzip + `v8.deserialize` (structured clone: typed
 * arrays, `Infinity` and nesting round-trip exactly).
 *
 * KEY = sha256 over
 *   - the content of every file in `systems/mapgen.ts`'s static import closure
 *     (walked from source, so a new mapgen dependency is hashed without anyone
 *     updating a list),
 *   - `TUNING.arena` serialized (belt and braces: config.ts is in the closure),
 *   - the V8 version (serialization format and Math results),
 *   - the `WorldDef` serialized, and the seed.
 * Any edit to a mapgen input therefore misses the cache; nothing is ever
 * invalidated by hand. Entries live in `.cache/mapgen/<source hash>/`
 * (gitignored); the first write under a new source hash deletes every other
 * source-hash dir, so the cache holds one generation of inputs at a time.
 *
 * A cached world equals a fresh one except `metrics.ms` (the wall-clock time
 * of whichever run generated it) — the mapgen selftest's determinism gate and
 * the timing gate therefore call `generateWorld` directly.
 *
 * `MAPGEN_NO_CACHE=1` bypasses reads and writes entirely.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { threadId } from 'node:worker_threads';
import { deserialize, serialize } from 'node:v8';
import { gunzipSync, gzipSync, constants as zlibConstants } from 'node:zlib';

import { TUNING } from '../config';
import type { WorldDef } from '../data/world';
import { generateWorld, type GeneratedWorld } from '../systems/mapgen';

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
function mapgenSourceClosure(): string[] {
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

/** Content hash of every mapgen input: the entry dir name (and a CI cache key). */
function mapgenSourceHash(): string {
  if (sourceHashMemo !== undefined) return sourceHashMemo;
  const hash = createHash('sha256');
  hash.update(`format:${FORMAT}\0v8:${process.versions.v8}\0`);
  for (const file of mapgenSourceClosure()) {
    hash.update(file.slice(SRC_DIR.length));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  hash.update(JSON.stringify(TUNING.arena));
  sourceHashMemo = hash.digest('hex');
  return sourceHashMemo;
}

function entryPath(world: WorldDef, seed: string): string {
  const source = mapgenSourceHash();
  const key = createHash('sha256').update(source).update('\0').update(JSON.stringify(world)).update('\0').update(seed).digest('hex');
  return join(MAPGEN_CACHE_DIR, source, `${key}.v8.gz`);
}

let prunedStale = false;
let tmpCounter = 0;

/** Drop-in for `generateWorld` in node-only callers (sim, selftests). */
export function cachedGenerateWorld(world: WorldDef, seed: string): GeneratedWorld {
  const enabled = process.env.MAPGEN_NO_CACHE !== '1';
  const path = entryPath(world, seed);
  if (enabled) {
    try {
      return deserialize(gunzipSync(readFileSync(path))) as GeneratedWorld;
    } catch {
      // Miss, or a torn/corrupt entry: regenerate and overwrite it.
    }
  }
  const map = generateWorld(world, seed);
  if (!enabled) return map;
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
  // Atomic rename: parallel writers never tear a file.
  const tmp = `${path}.${process.pid}-${threadId}-${(tmpCounter += 1)}.tmp`;
  writeFileSync(tmp, gzipSync(serialize(map), { level: zlibConstants.Z_BEST_SPEED }));
  renameSync(tmp, path);
  return map;
}
