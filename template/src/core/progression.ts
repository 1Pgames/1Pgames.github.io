import type { Modifier } from './stats';
import { load, save } from './storage';
import { META_UPGRADES, upgradeCost, type MetaUpgradeDef } from '../data/upgrades';

/**
 * Persistent meta-progression: currency earned across runs, permanent
 * unlocks, and leveled meta-upgrades bought between runs. This is the only
 * place that reads/writes the `meta` storage slot — everything else asks it
 * for numbers instead of touching `localStorage` directly.
 *
 * Use for: roguelike / survivor-like / tactics games with a hub between runs
 * where power should persist even after a death.
 * Do NOT use for: in-run-only state (that is `RunState` / `StatBlock`) or for
 * anything that must reset every run — meta state is explicitly the opposite.
 */

const META_KEY = 'meta';
const META_VERSION = 1;

export interface MetaSave {
  version: number;
  currency: number;
  unlocks: string[];
  upgrades: Record<string, number>;
  stats: { runs: number; wins: number; bestScore: number; bestTimeMs: number };
}

export const DEFAULT_META: MetaSave = {
  version: META_VERSION,
  currency: 0,
  unlocks: [],
  upgrades: {},
  stats: { runs: 0, wins: 0, bestScore: 0, bestTimeMs: 0 },
};

/**
 * One entry per historical version bump: `MIGRATIONS[v]` upgrades an
 * already-coerced save sitting at version `v` into version `v + 1`. Empty
 * today because nothing has shipped past version 1 yet — add a step here
 * the day `META_VERSION` becomes 2, never mutate `DEFAULT_META` retroactively.
 */
const MIGRATIONS: Record<number, (meta: MetaSave) => MetaSave> = {};

/** Fills every field from a possibly-partial/stale stored blob, defaulting anything missing or malformed. */
function coerceMeta(raw: Partial<MetaSave>): MetaSave {
  return {
    version: typeof raw.version === 'number' ? raw.version : DEFAULT_META.version,
    currency: typeof raw.currency === 'number' ? raw.currency : DEFAULT_META.currency,
    unlocks: Array.isArray(raw.unlocks) ? raw.unlocks : [...DEFAULT_META.unlocks],
    upgrades: raw.upgrades && typeof raw.upgrades === 'object' ? raw.upgrades : { ...DEFAULT_META.upgrades },
    stats:
      raw.stats && typeof raw.stats === 'object'
        ? { ...DEFAULT_META.stats, ...raw.stats }
        : { ...DEFAULT_META.stats },
  };
}

function migrate(raw: Partial<MetaSave>): MetaSave {
  let meta = coerceMeta(raw);
  while (meta.version < META_VERSION) {
    const step = MIGRATIONS[meta.version];
    meta = { ...(step ? step(meta) : meta), version: meta.version + 1 };
  }
  return meta;
}

/** Reads the meta-save, transparently migrating and persisting old versions. */
export function loadMeta(): MetaSave {
  const raw = load<Partial<MetaSave>>(META_KEY, DEFAULT_META);
  if (raw.version !== META_VERSION) {
    const migrated = migrate(raw);
    saveMeta(migrated);
    return migrated;
  }
  return coerceMeta(raw);
}

export function saveMeta(meta: MetaSave): void {
  save(META_KEY, meta);
}

/** Wipes meta-progression back to a fresh `DEFAULT_META` (e.g. a "reset save" menu option). */
export function resetMeta(): MetaSave {
  const meta: MetaSave = {
    version: DEFAULT_META.version,
    currency: DEFAULT_META.currency,
    unlocks: [],
    upgrades: {},
    stats: { ...DEFAULT_META.stats },
  };
  saveMeta(meta);
  return meta;
}

export function grantCurrency(n: number): MetaSave {
  const meta = loadMeta();
  meta.currency = Math.max(0, meta.currency + n);
  saveMeta(meta);
  return meta;
}

export function hasUnlock(id: string): boolean {
  return loadMeta().unlocks.includes(id);
}

/** Permanently unlocks a piece of content (character, tower type, biome, ...). */
export function grantUnlock(id: string): MetaSave {
  const meta = loadMeta();
  if (!meta.unlocks.includes(id)) meta.unlocks.push(id);
  saveMeta(meta);
  return meta;
}

/** Folds a finished run's outcome into lifetime stats. Call once when a run ends. */
export function recordRunResult(result: { won: boolean; score: number; timeMs: number }): MetaSave {
  const meta = loadMeta();
  meta.stats.runs += 1;
  if (result.won) meta.stats.wins += 1;
  meta.stats.bestScore = Math.max(meta.stats.bestScore, result.score);
  meta.stats.bestTimeMs = Math.max(meta.stats.bestTimeMs, result.timeMs);
  saveMeta(meta);
  return meta;
}

/**
 * Spends currency on the next level of a meta-upgrade defined in
 * `data/upgrades.ts`. Cost follows `cost(level) = round(baseCost *
 * growth^level)` (see `upgradeCost`), so each level is a flat percentage more
 * expensive than the last — cheap early, deliberate later.
 */
export function buyUpgrade(id: string): { ok: boolean; meta: MetaSave; reason?: string } {
  const meta = loadMeta();
  const def: MetaUpgradeDef | undefined = META_UPGRADES.find((u) => u.id === id);
  if (!def) return { ok: false, meta, reason: 'unknown upgrade' };
  const level = meta.upgrades[id] ?? 0;
  if (level >= def.maxLevel) return { ok: false, meta, reason: 'max level reached' };
  const cost = upgradeCost(def, level);
  if (meta.currency < cost) return { ok: false, meta, reason: 'not enough currency' };
  meta.currency -= cost;
  meta.upgrades[id] = level + 1;
  saveMeta(meta);
  return { ok: true, meta };
}

/**
 * Turns every purchased meta-upgrade level into `Modifier`s a fresh
 * `StatBlock` can absorb at run start. Call once when a run begins; the
 * source string (`meta:<id>`) lets a respec clear only meta-sourced mods.
 */
export function metaModifiers(): Modifier[] {
  const meta = loadMeta();
  const mods: Modifier[] = [];
  for (const def of META_UPGRADES) {
    const level = meta.upgrades[def.id] ?? 0;
    for (let i = 0; i < level; i += 1) {
      mods.push({ ...def.perLevel, source: `meta:${def.id}` });
    }
  }
  return mods;
}
