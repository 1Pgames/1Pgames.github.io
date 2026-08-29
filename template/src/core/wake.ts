/**
 * Screen Wake Lock. A portrait game is played with long stretches of watching
 * (idle tycoons, boss fights, a physics run) where the OS dims and locks the
 * screen mid-session. One lock, acquired on the first real gesture, prevents it.
 *
 * Rules the browsers impose, and how this file satisfies them:
 *   - the request needs a user gesture and a visible page -> armed on the first
 *     `pointerdown`;
 *   - the lock is released automatically whenever the tab is hidden -> a
 *     `visibilitychange` handler re-acquires it when the page comes back.
 * Everything is `try`/`catch` + optional chaining: on a browser without the API
 * (Safari < 16.4, embedded webviews, insecure contexts) `armWakeLock()` is a
 * silent no-op and the game plays exactly as before.
 */

/** Structural shape of the Wake Lock API — avoids depending on the DOM lib. */
interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

let armed = false;
let sentinel: WakeLockSentinelLike | null = null;

function api(): WakeLockLike | undefined {
  return (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
}

async function acquire(): Promise<void> {
  if (sentinel && !sentinel.released) return;
  try {
    sentinel = (await api()?.request('screen')) ?? null;
  } catch {
    // Denied (battery saver, permissions policy, no gesture credit) — the game
    // does not care; the screen simply behaves like it always did.
    sentinel = null;
  }
}

/**
 * Idempotent: safe to call from `main.ts` on every boot and from a scene that
 * wants to be sure. Only the first call installs listeners.
 */
export function armWakeLock(): void {
  if (armed || !api()) return;
  armed = true;

  window.addEventListener('pointerdown', () => void acquire(), { once: true, passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void acquire();
  });
}
