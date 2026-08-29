
/**
 * localStorage wrapper that never throws (private mode, quota, embedded webviews)
 * and namespaces every key so multiple games can share one origin.
 */

// Both builds of Duskhaul are served from one origin, so they MUST NOT share a
// save namespace: the polished cut is free to bump the progression schema, and
// a shared stash would let that migration rewrite this frozen build's save.
const NS = '2026-08-29-duskhaul-ai:';

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

