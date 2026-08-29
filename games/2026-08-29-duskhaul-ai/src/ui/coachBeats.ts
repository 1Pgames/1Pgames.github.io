import Phaser from 'phaser';
import { SAFE, VIEW } from '../config';
import { hasSeenCoach, showCoach, type CoachHandle, type CoachRect } from './coach';

/**
 * Duskhaul's three run-1 FTUE beats (§14b "FTUE coach beats"), wired through
 * the shipped `ui/coach.ts` — never a bespoke overlay.
 *
 * The beats live here rather than inline in the slice for one reason: they are
 * a SEQUENCE with a pause contract, and a sequence smeared across a 900-line
 * GameScene is where "the tutorial fired twice" and "the director ran while
 * the card was up" come from. This module owns the ordering, the flags, the
 * pause/resume pairing and the teardown; the slice owns only the two triggers
 * (run start, and the first `gate-open` event).
 *
 * | Beat | Fires | Mode | Spotlight |
 * | --- | --- | --- | --- |
 * | `tut:goal` | run 1, 0s, before the director ticks | `tap` | run clock + shard band |
 * | `tut:stick` | immediately after `tut:goal` | `swap-gate` | bottom joystick band |
 * | `tut:gate` | run 1, first `gate-open` event | `tap` | that gate's compass arrow |
 *
 * Every beat shows ONCE EVER per save (`coach.ts` writes `tut:<id>` the moment
 * it appears, so a reload mid-beat does not re-teach), the director is held or
 * paused while one is visible so a slow reader is never killed by a tutorial,
 * and beats never stack.
 */

/** What the sequence needs from the run in order to be safe to read. */
export interface CoachHooks {
  /** Halt the session clock. Called once when a beat appears. */
  pause(): void;
  /** Resume it. Called once when the LAST beat of a sequence is dismissed. */
  resume(): void;
}

/**
 * §14b: the goal beat spotlights the run clock + shard counter band — the two
 * widgets that say what the run is for. Right of the shell corner by
 * construction (band A starts at x=336).
 */
const GOAL_TARGET: CoachRect = { x: 330, y: 10, w: 356, h: 110 };

/** The bottom joystick region (§14.3). The dim rects around it ARE the input gate. */
const STICK_TARGET: CoachRect = {
  x: 0,
  y: VIEW.height - SAFE.bottom,
  w: VIEW.width,
  h: SAFE.bottom,
};

/** Handle over the two-beat opening sequence. */
export interface OpeningCoach {
  /**
   * Ends the joystick beat as taught. Call it from the FIRST real joystick
   * drag — `swap-gate` mode dismisses on nothing else, which is exactly what
   * makes "run 1, player never moves" safe forever (§14b edge state).
   */
  finishStick(): void;
  /** Tears the sequence down without resuming — scene shutdown, defeat, abandon. */
  destroy(): void;
}

/**
 * Runs `tut:goal` -> `tut:stick`. Returns `null` when both flags are already
 * set, which the caller reads as "already taught, start the run normally" —
 * and in that case `pause`/`resume` are never called at all.
 *
 * The director must NOT be ticking when this is called.
 */
export function startOpeningCoach(scene: Phaser.Scene, hooks: CoachHooks): OpeningCoach | null {
  if (hasSeenCoach('goal') && hasSeenCoach('stick')) return null;

  let live: CoachHandle | null = null;
  let finished = false;
  let paused = false;

  const release = (): void => {
    if (finished) return;
    finished = true;
    live = null;
    if (paused) {
      paused = false;
      hooks.resume();
    }
  };

  const stick = (): void => {
    if (finished) return;
    live = showCoach(scene, {
      id: 'stick',
      target: STICK_TARGET,
      text: 'Drag anywhere to move — your weapons fire themselves.',
      mode: 'swap-gate',
      // The rect IS the input gate here, so a fat pad would hand the drag to
      // the dim instead of to the stick underneath.
      pad: 0,
      onDone: release,
    });
    // Already taught (or refused): nothing is holding the run, so let it go.
    if (live === null) release();
  };

  const goal = showCoach(scene, {
    id: 'goal',
    target: GOAL_TARGET,
    text: 'Loot the dark. Reach a gate before it keeps you.',
    mode: 'tap',
    onDone: stick,
  });

  if (goal === null) {
    // `tut:goal` was seen on an earlier save; go straight to the stick beat.
    stick();
  } else {
    live = goal;
  }

  // Nothing to show after all (both flags set mid-flight is impossible, but a
  // refused beat is not): do not hold the run.
  if (live === null && finished) return null;

  paused = true;
  hooks.pause();

  return {
    finishStick: () => {
      live?.finish();
    },
    destroy: () => {
      finished = true;
      const handle = live;
      live = null;
      handle?.destroy();
      if (paused) {
        paused = false;
        hooks.resume();
      }
    },
  };
}

/**
 * `tut:gate` — the first gate decision, fired from the `gate-open` event.
 * `spotlight` is that gate's compass arrow + countdown chip in screen px; the
 * slice knows where the compass put it, this module does not.
 *
 * Returns the handle so the caller can tear it down on shutdown, or `null`
 * when the beat was already taught (in which case the run is not paused).
 */
export function showGateCoach(
  scene: Phaser.Scene,
  hooks: CoachHooks,
  spotlight: CoachRect,
): CoachHandle | null {
  if (hasSeenCoach('gate')) return null;

  let resumed = false;
  const handle = showCoach(scene, {
    id: 'gate',
    target: spotlight,
    text: 'A gate is open. Extract to keep your haul — or stay greedy.',
    mode: 'tap',
    onDone: () => {
      if (resumed) return;
      resumed = true;
      hooks.resume();
    },
  });
  if (handle === null) return null;

  hooks.pause();
  // A destroy() that skips onDone must still un-pause, or an abandoned beat
  // freezes the run — the shutdown path is the one that actually does this.
  return {
    id: handle.id,
    finish: () => handle.finish(),
    destroy: () => {
      handle.destroy();
      if (!resumed) {
        resumed = true;
        hooks.resume();
      }
    },
  };
}

/** Has this run already taught the whole opening? Cheap enough to call in `create`. */
export function openingCoachDone(): boolean {
  return hasSeenCoach('goal') && hasSeenCoach('stick');
}
