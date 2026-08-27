
/**
 * localStorage wrapper that never throws (private mode, quota, embedded webviews)
 * and namespaces every key so multiple games can share one origin.
 */

const NS = '2026-08-27-gem-cascade:'; // change per game if several are hosted on the same domain

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

