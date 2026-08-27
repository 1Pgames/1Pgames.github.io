import { STORE } from './keys';

/**
 * localStorage wrapper that never throws (private mode, quota, embedded webviews)
 * and namespaces every key so multiple games can share one origin.
 */

const NS = 'gt:'; // change per game if several are hosted on the same domain

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(NS + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
  } catch {
    /* storage unavailable — the game must still play */
  }
}

/** Persists the score if it beats the record. Returns true when it is a new best. */
export function submitScore(score: number): boolean {
  const best = load<number>(STORE.best, 0);
  save(STORE.runs, load<number>(STORE.runs, 0) + 1);
  if (score <= best) return false;
  save(STORE.best, score);
  return true;
}
