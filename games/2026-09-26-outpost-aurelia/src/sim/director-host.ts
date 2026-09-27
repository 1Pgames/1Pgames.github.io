import type { RunDirectorHost } from '../core/run';

/**
 * Minimal `RunDirectorHost` for the headless balance simulator: no scene, no
 * DOM, nothing to tear down mid-run. `RunDirector` only ever registers one
 * `'shutdown'` listener at construction time and never expects it to fire —
 * a sim run always finishes on its own (win, death, or the fixed-duration
 * loop running out) instead of being torn down externally the way a Phaser
 * scene restart tears down a stale director.
 */
export function createDirectorHost(): RunDirectorHost {
  return {
    events: {
      once(_event: 'shutdown', _callback: () => void): undefined {
        return undefined;
      },
    },
  };
}
