/**
 * One-call funnel telemetry, routed through the GoatCounter snippet that
 * `scripts/build-site.mjs` injects into `/play/<slug>/` when `site/config.json`
 * has a `goatcounter` URL.
 *
 * `track('win-3')` records the event `ev/<slug>/win-3`, which
 * `scripts/telemetry-pull.mjs` reads back as a per-level funnel. No snippet
 * (dev server, self-hosted build, analytics disabled) means a silent no-op:
 * this module NEVER throws, never blocks a scene transition, and never loads a
 * script of its own.
 */

interface GoatCounter {
  count(vars: { path: string; title?: string; event?: boolean }): void;
}

declare global {
  interface Window {
    goatcounter?: GoatCounter;
  }
}

/** `count.js` is loaded `async`, so the very first event can lose the race. */
const RETRY_MS = 3000;

let retried = false;

/**
 * Records one funnel event. Keep names short, lowercase and stable —
 * 'session-start', 'daily-start', 'win-3', 'loss-3', 'retry', 'share' — because
 * the dashboard groups by exact string.
 */
export function track(event: string): void {
  const path = `ev/${slug()}/${event}`;
  if (send(path)) return;
  // Exactly one deferred retry per page load: if the snippet is genuinely
  // absent, a timer per event would be pure noise.
  if (retried) return;
  retried = true;
  setTimeout(() => void send(path), RETRY_MS);
}

function send(path: string): boolean {
  try {
    const gc = typeof window === 'undefined' ? undefined : window.goatcounter;
    if (gc === undefined || typeof gc.count !== 'function') return false;
    gc.count({ path, event: true });
    return true;
  } catch {
    return false;
  }
}

/** Game slug from the published URL shape `/play/<slug>/`; 'dev' anywhere else. */
function slug(): string {
  try {
    if (typeof location === 'undefined') return 'dev';
    const match = /\/play\/([^/]+)\//.exec(location.pathname);
    return match?.[1] ?? 'dev';
  } catch {
    return 'dev';
  }
}
