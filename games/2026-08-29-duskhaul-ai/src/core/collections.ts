import type { Rng } from './rng';

/**
 * Collection sets: the "collect 5 shards to unlock the dragon" meta layer.
 * A set is a small, fixed bag of pieces; a run drops pieces, and completing a
 * set is the reward moment. Pure TS (no Phaser, no storage) — ownership lives
 * in `core/progression.ts` (`addToCollection` / `ownedPieces`) and the pieces
 * themselves are content, defined per game in `src/data/`.
 *
 * Use for: album/shard/blueprint sets that pay out on completion.
 * Do NOT use for: unlock flags (`grantUnlock`) or stackable consumables
 * (`grantBooster`) — a collection is specifically a *set* you fill.
 */

export interface CollectionPieceDef {
  id: string;
  name: string;
}

export interface CollectionSetDef {
  id: string;
  name: string;
  /**
   * 3-6 pieces. Fewer than 3 completes before the player notices it is a set;
   * more than 6 stops reading as "nearly there" on a portrait screen.
   */
  pieces: CollectionPieceDef[];
}

export interface CollectionProgress {
  owned: number;
  total: number;
  /** 0..1 — safe to feed straight into `ui/bars.ts`. */
  ratio: number;
  complete: boolean;
  /** Piece ids still missing, in definition order. */
  missing: string[];
}

/**
 * Progress of one set against an owned-piece list. Ignores unknown ids in
 * `owned` (a piece removed from the game must not inflate the count) and
 * counts each defined piece at most once.
 */
export function collectionProgress(def: CollectionSetDef, owned: readonly string[]): CollectionProgress {
  const missing: string[] = [];
  let count = 0;
  for (const piece of def.pieces) {
    if (owned.includes(piece.id)) count += 1;
    else missing.push(piece.id);
  }
  const total = def.pieces.length;
  return {
    owned: count,
    total,
    ratio: total === 0 ? 1 : count / total,
    complete: missing.length === 0,
    missing,
  };
}

/**
 * Seeded drop of a piece the player does not own yet — duplicate-avoiding by
 * construction: it rolls over the *missing* pieces, so a set always completes
 * in exactly `pieces.length` drops instead of degenerating into the coupon
 * collector's tail. Returns `null` once the set is complete, which is the
 * caller's cue to drop currency instead.
 */
export function rollMissingPiece(
  def: CollectionSetDef,
  owned: readonly string[],
  rng: Rng,
): string | null {
  const missing = def.pieces.filter((piece) => !owned.includes(piece.id));
  if (missing.length === 0) return null;
  return rng.pick(missing).id;
}
