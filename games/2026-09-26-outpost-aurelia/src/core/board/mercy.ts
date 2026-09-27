import type { BoardSpec, PieceKind } from './types';
import { JAR_KIND } from './types';

/**
 * The MERCY RULE: when the move budget runs low, the board starts refilling
 * from a smaller set of kinds.
 *
 * This is the single most important difficulty valve a match-3 ladder has, and
 * it is not a difficulty setting — it is a fairness one. A near-miss the player
 * could see coming ("two more jars and I had it") is the loss that gets
 * retried; a near-miss caused by the refill dealing five different kinds into
 * the last three moves is the loss that gets uninstalled. Narrowing the pool
 * makes matches — and specials — land more often exactly when they decide the
 * level, so the last moves are the loudest ones.
 *
 * The pool is GOAL-FIRST, not random: the kinds the level actually asks for
 * come first, so the extra matches are also the useful matches. Everything
 * after them follows `spec.kinds` order, which keeps the pool stable and
 * seed-independent — the scene and the headless sim derive the identical list
 * from the identical inputs, which is the only way a simulated win rate means
 * anything about the real game.
 *
 * Refills only. The seeded fill and the reshuffle always use the level's full
 * `spec.kinds` (see `Board.fill`), because a whole board of four kinds is a
 * different level, not a merciful one.
 */

/**
 * Never narrower than this. Three kinds is a board that matches itself in
 * cascades the player did not cause; four is the floor where the player is
 * still the one making the moves.
 */
const MIN_POOL = 4;

/**
 * The kinds refills should draw from once the player is inside the mercy
 * window: every goal kind the level draws (in goal order), then the rest of
 * `spec.kinds` in spec order, truncated to `poolSize`.
 *
 * Goals naming something that is not a drawable piece — a jar goal, a blocker
 * count — contribute nothing and are skipped: they are cleared BY matches, not
 * by being dealt. A `poolSize` at or above the level's kind count returns the
 * full list, so a 4-kind level is never "narrowed" into a subset of itself.
 */
export function mercyPool(
  spec: BoardSpec,
  goals: readonly { kind: string }[],
  poolSize: number,
): PieceKind[] {
  const all = spec.kinds;
  const size = Math.min(all.length, Math.max(MIN_POOL, Math.floor(poolSize)));
  if (size >= all.length) return all.slice();

  const pool: PieceKind[] = [];
  const taken = new Set<PieceKind>();
  for (const goal of goals) {
    if (pool.length >= size) break;
    if (goal.kind === JAR_KIND || taken.has(goal.kind) || !all.includes(goal.kind)) continue;
    taken.add(goal.kind);
    pool.push(goal.kind);
  }
  for (const kind of all) {
    if (pool.length >= size) break;
    if (taken.has(kind)) continue;
    taken.add(kind);
    pool.push(kind);
  }
  return pool;
}
