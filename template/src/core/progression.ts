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
const META_VERSION = 2;

/** A calendar day in local time, `YYYY-MM-DD` — the granularity a daily streak counts in. */
export interface StreakSave {
  days: number;
  lastDayKey: string;
}

export interface MetaSave {
  version: number;
  currency: number;
  unlocks: string[];
  upgrades: Record<string, number>;
  stats: { runs: number; wins: number; bestScore: number; bestTimeMs: number };
  /** Level id -> best star rating (0-3). Written by `recordStars`, read by the saga map. */
  stars: Record<string, number>;
  /** Consecutive-day login/play streak. */
  streak: StreakSave;
  /** Collection set id -> owned piece ids (see `core/collections.ts`). */
  collections: Record<string, string[]>;
  /** Booster id -> owned count. Spent by the pre-level booster picker. */
  boosters: Record<string, number>;
}

export const DEFAULT_META: MetaSave = {
  version: META_VERSION,
  currency: 0,
  unlocks: [],
  upgrades: {},
  stats: { runs: 0, wins: 0, bestScore: 0, bestTimeMs: 0 },
  stars: {},
  streak: { days: 0, lastDayKey: '' },
  collections: {},
  boosters: {},
};

/** Highest star rating a level can be worth. */
export const MAX_STARS = 3;

/**
 * One entry per historical version bump: `MIGRATIONS[v]` upgrades an
 * already-coerced save sitting at version `v` into version `v + 1`. Never
 * mutate `DEFAULT_META` retroactively — add a step here instead.
 *
 * v1 -> v2 added the meta-kit slots (`stars`, `streak`, `collections`,
 * `boosters`). `coerceMeta` already defaults anything missing, so the step
 * only has to be explicit about *which* defaults a v1 save inherits and must
 * leave every v1 field (currency, unlocks, upgrades, stats) untouched.
 */
const MIGRATIONS: Record<number, (meta: MetaSave) => MetaSave> = {
  1: (meta) => ({
    ...meta,
    stars: meta.stars ?? {},
    streak: meta.streak ?? { days: 0, lastDayKey: '' },
    collections: meta.collections ?? {},
    boosters: meta.boosters ?? {},
  }),
};

/** Fills every field from a possibly-partial/stale stored blob, defaulting anything missing or malformed. */
function coerceMeta(raw: Partial<MetaSave>): MetaSave {
  return {
    version: typeof raw.version === 'number' ? raw.version : DEFAULT_META.version,
    currency: typeof raw.currency === 'number' ? raw.currency : DEFAULT_META.currency,
    // Records and arrays are always copied: a fresh save reads `DEFAULT_META`
    // itself as the storage fallback, and handing its containers out by
    // reference would let the first mutation rewrite the defaults.
    unlocks: Array.isArray(raw.unlocks) ? [...raw.unlocks] : [...DEFAULT_META.unlocks],
    upgrades: typeof raw.upgrades === 'object' && raw.upgrades !== null ? { ...raw.upgrades } : { ...DEFAULT_META.upgrades },
    stats:
      typeof raw.stats === 'object' && raw.stats !== null
        ? { ...DEFAULT_META.stats, ...raw.stats }
        : { ...DEFAULT_META.stats },
    stars: typeof raw.stars === 'object' && raw.stars !== null ? { ...raw.stars } : { ...DEFAULT_META.stars },
    streak:
      typeof raw.streak === 'object' && raw.streak !== null
        ? { ...DEFAULT_META.streak, ...raw.streak }
        : { ...DEFAULT_META.streak },
    collections: copySets(raw.collections),
    boosters:
      typeof raw.boosters === 'object' && raw.boosters !== null
        ? { ...raw.boosters }
        : { ...DEFAULT_META.boosters },
  };
}

/** Deep-copies the owned-piece lists so a stored blob and the returned save never share arrays. */
function copySets(raw: Record<string, string[]> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [setId, pieces] of Object.entries(raw)) {
    if (Array.isArray(pieces)) out[setId] = [...pieces];
  }
  return out;
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
    stars: {},
    streak: { ...DEFAULT_META.streak },
    collections: {},
    boosters: {},
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

/**
 * Records a level's star rating, keeping the best one ever earned — a replay
 * that goes worse must never take stars away. Ratings are clamped to
 * `0..MAX_STARS` so a caller that hands over a raw score cannot inflate the
 * saga map.
 */
export function recordStars(levelId: string, stars: number): MetaSave {
  const meta = loadMeta();
  const clamped = Math.max(0, Math.min(MAX_STARS, Math.floor(stars)));
  const best = meta.stars[levelId] ?? 0;
  if (clamped > best) {
    meta.stars[levelId] = clamped;
    saveMeta(meta);
  }
  return meta;
}

export function bestStars(levelId: string): number {
  return loadMeta().stars[levelId] ?? 0;
}

/** Lifetime star total — the currency saga-map gates and star-chests unlock against. */
export function totalStars(): number {
  let total = 0;
  for (const stars of Object.values(loadMeta().stars)) {
    if (typeof stars === 'number') total += stars;
  }
  return total;
}

/**
 * Advances the consecutive-day streak. Idempotent within one local calendar
 * day (a session that opens the app twice does not count twice), extends when
 * the last touch was *yesterday*, and restarts at 1 after any longer gap.
 * `now` is injectable so the transitions are testable without waiting a day.
 *
 * `extended` is true only on the day the streak actually grew — that is the
 * signal for "show the streak reward", not `days`.
 */
export function touchDailyStreak(now: Date = new Date()): { days: number; extended: boolean } {
  const meta = loadMeta();
  const today = localDayKey(now);
  if (meta.streak.lastDayKey === today) return { days: meta.streak.days, extended: false };

  const yesterday = localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const extended = meta.streak.lastDayKey === yesterday;
  meta.streak = { days: extended ? meta.streak.days + 1 : 1, lastDayKey: today };
  saveMeta(meta);
  return { days: meta.streak.days, extended };
}

/**
 * Local calendar day, not UTC: a streak must break at the player's midnight,
 * otherwise anyone west of Greenwich loses a day early.
 */
function localDayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Adds a collection piece (see `core/collections.ts`). `added` is false for a
 * duplicate, so the caller knows whether to play the "new piece" celebration.
 * `completed` needs the set's size — pass `setSize` (usually
 * `def.pieces.length`) to get it; without it the answer is always false,
 * because progression deliberately does not know the game's content tables.
 */
export function addToCollection(
  setId: string,
  pieceId: string,
  setSize?: number,
): { added: boolean; completed: boolean } {
  const meta = loadMeta();
  const owned = meta.collections[setId] ?? [];
  const added = !owned.includes(pieceId);
  if (added) {
    owned.push(pieceId);
    meta.collections[setId] = owned;
    saveMeta(meta);
  }
  return { added, completed: setSize !== undefined && owned.length >= setSize };
}

export function ownedPieces(setId: string): string[] {
  return loadMeta().collections[setId] ?? [];
}

/** Grants `n` boosters (rewards, streak payouts, IAP). Counts never go below zero. */
export function grantBooster(id: string, n: number): MetaSave {
  const meta = loadMeta();
  meta.boosters[id] = Math.max(0, Math.floor((meta.boosters[id] ?? 0) + n));
  saveMeta(meta);
  return meta;
}

export function boosterCount(id: string): number {
  return loadMeta().boosters[id] ?? 0;
}

/**
 * Consumes one booster. Returns false and writes nothing when the player has
 * none, so a caller can gate the effect on the spend instead of checking the
 * count first and racing itself.
 */
export function spendBooster(id: string): boolean {
  const meta = loadMeta();
  const count = meta.boosters[id] ?? 0;
  if (count <= 0) return false;
  meta.boosters[id] = count - 1;
  saveMeta(meta);
  return true;
}
