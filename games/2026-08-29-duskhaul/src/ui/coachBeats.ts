import type { CoachBeatId } from '../data/types-v2';

/**
 * PRD-V2 §14.14 beat table — copy and auto-dismiss, verbatim. Trigger sites
 * live in `slices/arena/game.ts` (the integrator calls `coachToast` /
 * `endCoach`); this table is the only place the copy lives.
 *
 * `autoMs: null` beats end on a condition the run observes (`endCoach`):
 * `locket` on the Wicket Ash Locket pickup, `move` on the first 200 px moved, `item` on the bag tap, `channel` on
 * channel start, `belt` on first use (those two also time out). `draft` is
 * rendered INSIDE the draft overlay by `ui/cards.ts` (the toast lane sits
 * under the modal), so it never reaches the toast lane.
 *
 * Copy law: never say "anywhere" for the stick, and never promise a zone the
 * stick does not have. `ui/joystick.ts` arms on any press at y ≥ SAFE.top
 * (140, the HUD band's bottom) that no UI control consumes, so the move line
 * names THAT zone. §14.14's "lower half" line would under-state it (and the
 * V1 C1 lesson is that the copy must match the zone), so the PRD row needs an
 * amendment rather than the code a restriction.
 */
export interface CoachBeat {
  copy: string;
  /**
   * Auto-dismiss after this many ms; `null` = `endCoach` ends it (or, after 6 s
   * on screen, another queued toast — `ui/toast.ts` never lets it starve the lane).
   */
  autoMs: number | null;
}

export const COACH_BEATS: Record<CoachBeatId, CoachBeat> = {
  locket: { copy: 'Grab the Ash Locket — follow the light.', autoMs: null },
  move: { copy: 'Drag below the top bar to move.', autoMs: null },
  attack: { copy: 'Your weapons fire on their own. Keep moving.', autoMs: 4000 },
  draft: { copy: 'Pick one. Weapons evolve at rank 4 with their charm.', autoMs: null },
  item: { copy: 'Items are lost if you die. Tap the bag to pin one to your casket.', autoMs: 6000 },
  gate: { copy: 'Gate A opens in 0:30. Follow the violet arrow.', autoMs: 5000 },
  channel: { copy: 'Stand in the ring to escape. Hits slow you down.', autoMs: null },
  map: { copy: 'Chests, shrines and lairs show on your map. Tap it to peek.', autoMs: 5000 },
  belt: { copy: 'Tap your belt to use a consumable.', autoMs: 6000 },
};

/** Storage key in `MetaSaveV4.flags.seenCoach` (E43). */
export function coachKey(beat: CoachBeatId): string {
  return `coach:${beat}`;
}
