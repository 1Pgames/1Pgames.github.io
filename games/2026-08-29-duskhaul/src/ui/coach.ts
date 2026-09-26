import Phaser from 'phaser';
import { PALETTE } from '../config';
import { hasSeen, markSeen } from '../core/progression';
import type { CoachBeatId } from '../data/types-v2';
import { COACH_BEATS, coachKey } from './coachBeats';
import { showToast, type ToastHandle } from './toast';

/**
 * PRD-V2 §14.14 coach: NON-MODAL. A beat is a toast in the run's single toast
 * lane (80, 360, 560, 88) — no dim, no spotlight, no input gate, never pauses
 * the run. It supersedes the V1 dim + spotlight `showCoach`.
 *
 * Each beat shows once per save: `markSeen('coach:<id>')` writes
 * `MetaSaveV4.flags.seenCoach` the moment the beat is queued, so a reload out
 * of the middle of a beat does not re-teach it. Beats queue behind other
 * toasts (max one visible) and die with the scene (the lane is shutdown-safe).
 */

/** Scene event emitted when a beat is shown — `ui/bagStrip.ts` pulses on `item`. */
export const COACH_EVENT = 'coach-beat';

const live = new Map<Phaser.Scene, Map<CoachBeatId, ToastHandle>>();

/** True once the beat has been shown on this save. */
export function hasSeenCoach(beat: CoachBeatId): boolean {
  return hasSeen(coachKey(beat));
}

/** §16.1 E43: show `beat` once per save; a no-op when already seen. */
export function coachToast(scene: Phaser.Scene, beat: CoachBeatId): void {
  if (hasSeenCoach(beat)) return;
  markSeen(coachKey(beat));
  const def = COACH_BEATS[beat];
  let perScene = live.get(scene);
  if (perScene === undefined) {
    const created = new Map<CoachBeatId, ToastHandle>();
    perScene = created;
    live.set(scene, created);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => live.delete(scene));
  }
  perScene.set(
    beat,
    showToast(scene, { text: def.copy, tone: PALETTE.accent, ms: def.autoMs, key: coachKey(beat) }),
  );
  scene.events.emit(COACH_EVENT, beat);
}

/**
 * Ends a condition-dismissed beat (`move` after 200 px, `item` on bag tap,
 * `channel` on channel start, `belt` on first use). Safe to call every time
 * the condition fires: a beat that is not live is ignored.
 */
export function endCoach(scene: Phaser.Scene, beat: CoachBeatId): void {
  const handle = live.get(scene)?.get(beat);
  if (handle === undefined) return;
  handle.dismiss();
  live.get(scene)?.delete(beat);
}
