import { load, save } from './storage';

/**
 * Daily-challenge mode: one seed shared by everybody who plays on the same
 * calendar day (UTC), plus the per-day best score and the `?d=YYYY-MM-DD` deep
 * link that shared results carry.
 *
 * Every slice takes its run seed from `sessionSeed()`. With daily mode OFF that
 * is byte-for-byte the old `Date.now().toString(36)` behaviour; with it ON the
 * seed is derived from the day, so the run is reproducible and comparable.
 *
 * Fully self-contained: no Phaser, no analytics, no network. Works when
 * `localStorage` is unavailable (see `core/storage.ts`) and when there is no
 * `location` at all (headless sim), in which case it is simply always off.
 */

/** Last explicit player choice, so daily mode survives a reload. */
const MODE_KEY = 'daily-mode';
/** Per-day best score, one key per day: `daily-best:2026-08-29`. */
const BEST_PREFIX = 'daily-best:';
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Day pinned by `?d=` on the URL, read ONCE at import: a shared link must
 * resolve to the day it was shared on even if the reader opens it later.
 * `null` on a plain visit.
 */
const linkedDay = readLinkedDay();

/**
 * A `?d=` link arms daily mode for this visit without overwriting the stored
 * preference — following someone's daily link is not a settings change.
 */
let dailyMode = linkedDay !== null || load<boolean>(MODE_KEY, false) === true;

/** Today in UTC as 'YYYY-MM-DD' — the same string for every player on Earth. */
export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The `?d=` value when the page was opened with a valid one, else `null`. */
export function dailyUrlParam(): string | null {
  return linkedDay;
}

/**
 * The day the daily surfaces (seed, best score, share link) refer to: the day
 * from the link when there is one, otherwise today.
 */
export function dailyDay(): string {
  return linkedDay ?? todayKey();
}

export function isDailyMode(): boolean {
  return dailyMode;
}

/** Toggles daily mode and remembers the choice for the next visit. */
export function setDailyMode(on: boolean): void {
  dailyMode = on;
  save(MODE_KEY, on);
}

/**
 * Seed for the run about to start. Deterministic per day in daily mode, a
 * throwaway timestamp otherwise — which is exactly what slices used before.
 */
export function sessionSeed(): string {
  if (!dailyMode) return Date.now().toString(36);
  return hashString(`daily:${dailyDay()}`).toString(36);
}

/** Best score recorded for the active day, or `null` if it was not played yet. */
export function loadDailyBest(): number | null {
  const stored = load<number | null>(BEST_PREFIX + dailyDay(), null);
  return typeof stored === 'number' && Number.isFinite(stored) ? stored : null;
}

/** Stores `score` when it beats the active day's best. True = new daily best. */
export function saveDailyBest(score: number): boolean {
  const best = loadDailyBest();
  if (best !== null && score <= best) return false;
  save(BEST_PREFIX + dailyDay(), score);
  return true;
}

/** FNV-1a — same mixer as `core/rng.ts`, so a seed string hashes consistently. */
function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function readLinkedDay(): string | null {
  try {
    if (typeof location === 'undefined') return null;
    const value = new URLSearchParams(location.search).get('d');
    return value !== null && DAY_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}
