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

/** Just the bit of `Phaser.Game.loop` this policy touches — no Phaser import needed. */
interface GameLoopLike {
  running: boolean;
  sleep(): void;
  wake(): void;
}

let loopArmed = false;

/**
 * Keeps the game loop's running state a FUNCTION of the page's CURRENT
 * visibility, rather than a consequence of whichever lifecycle event happened
 * to be delivered last.
 *
 * ## The wedge this replaces
 * `main.ts` used to do this inline, and every generated game inherited it:
 *
 * ```ts
 * document.addEventListener('visibilitychange', () => {
 *   if (document.hidden) game.loop.sleep();
 *   else game.loop.wake();
 * });
 * ```
 *
 * `TimeStep.sleep()` calls `raf.stop()`: the requestAnimationFrame chain is
 * gone, and NOTHING restarts it except a later `wake()`. So the whole game's
 * liveness hung on a second `visibilitychange` arriving — an EDGE. Chrome
 * coalesces and reorders visibility notifications around tab focus changes and
 * under heavy input dispatch, so that second edge can simply never come, and
 * the game then sits dead forever on a page that reports itself VISIBLE:
 * `loop.running === false`, `loop.raf.isRunning === false`, `loop.time` frozen,
 * every scene still "active", no exception anywhere. Measured, in that state:
 *
 * ```
 * after a hidden event only   {"vis":"visible","running":false,"raf":false,"time":8275}
 * ```
 *
 * A player who tabbed away and came back is simply stuck, and no gate we own
 * sees it except a loop-liveness probe: there is nothing to catch.
 *
 * ## The rule
 * LEVEL-triggered: `sync()` reads the visibility that is true NOW and makes the
 * loop match it. It is re-run on every signal by which a page can come back
 * (`visibilitychange`, `focus`, `pageshow`, `resume`) AND on a 1s poll, so a
 * dropped or coalesced event cannot be fatal — it can only delay the resume by
 * up to a second. The poll costs one boolean comparison per second and only
 * acts when the two disagree.
 *
 * Sleeping while hidden is kept deliberately (a backgrounded run must not
 * advance, or a recording desyncs and an idle tab burns battery); it is only
 * the RESTORE that stops being a guess.
 *
 * Never hand-roll a `visibilitychange` -> `sleep`/`wake` pair again: call this.
 * Idempotent, so a scene may call it as well as the bootstrap.
 */
export function armLoopVisibility(loop: GameLoopLike): void {
  if (loopArmed) return;
  loopArmed = true;

  const sync = (): void => {
    const shouldRun = document.visibilityState === 'visible';
    if (shouldRun === loop.running) return;
    if (shouldRun) loop.wake();
    else loop.sleep();
  };

  document.addEventListener('visibilitychange', sync);
  window.addEventListener('focus', sync);
  window.addEventListener('pageshow', sync);
  // iOS/Android webviews deliver `resume` instead of a focus event.
  document.addEventListener('resume', sync);
  window.setInterval(sync, 1000);
  sync();
}
