/**
 * Family G (dice-board) loop model: a ring of tiles, one token, a dice budget
 * and a set-collection goal.
 *
 * Pure TypeScript — no Phaser — so `src/sim/kits/diceloop.selftest.ts` (and any
 * headless balance pass) can play a whole session in Node. The scene owns only
 * the hops, the icons and the juice; every rule lives here.
 */

import { LevelDirector } from '../../core/level';
import type { SessionOutcome } from '../../core/session';
import type { Rng } from '../../core/rng';

export type TileType = 'coin' | 'loss' | 'chest' | 'rollagain' | 'collect';

/** Every non-coin tile type. `coin` fills whatever the ring has left over. */
export const SPECIAL_TILES: readonly TileType[] = ['loss', 'chest', 'rollagain', 'collect'];

/** Copies of each special type the layout always contains. */
const SPECIALS_BASE = 2;
/** Extra copies dealt to distinct types, so each special ends up 2 or 3. */
const SPECIALS_BONUS = 2;

/** Goal id tracked by the `LevelDirector` — the collected set pieces. */
export const GOAL_SETS = 'sets';

/** The three set pieces a `collect` tile hands out, in grant order. */
export const PIECE_NAMES: readonly string[] = ['GEAR', 'GEM', 'KEY'];

export interface DiceRules {
  /** Roll (move) budget for the session. */
  rolls: number;
  /** Set pieces needed to win. */
  piecesTarget: number;
  /** Coins from a `coin` tile. */
  coinGain: number;
  /** Coins from a `chest` tile. */
  chestGain: number;
  /** Share of the purse a `loss` tile takes (0..1). */
  lossRatio: number;
  /** Highest dice face; faces are 1..diceFaces. */
  diceFaces: number;
}

/** One resolved roll: where the token went and what the tile did. */
export interface RollEvent {
  /** Dice face, 1..`diceFaces`. */
  roll: number;
  from: number;
  to: number;
  tile: TileType;
  /** Machine-readable outcome: same as `tile`, or `'loss-empty'` on an empty purse. */
  effect: string;
  /** Coin change applied by the tile (negative for `loss`). */
  delta: number;
  /** Purse after the tile resolved; never below 0. */
  coins: number;
  /** Index of the set piece granted (0-based), or null. */
  piece: number | null;
  /** True when the tile refunded the roll it consumed (`rollagain`). */
  refunded: boolean;
}

/**
 * Builds the tile ring: `SPECIALS_BASE` of every special type plus
 * `SPECIALS_BONUS` extra copies dealt to distinct types (so each special type
 * appears 2-3 times), the rest `coin`. Specials are dealt one per equal
 * segment of the ring so they never clump, and tile 0 — where the token starts
 * — is always a plain `coin`.
 */
export function buildRing(rng: Rng, tileCount = 20): TileType[] {
  const counts: Record<string, number> = {
    loss: SPECIALS_BASE,
    chest: SPECIALS_BASE,
    rollagain: SPECIALS_BASE,
    collect: SPECIALS_BASE,
  };
  const bonusOrder = rng.shuffle([...SPECIAL_TILES]);
  for (let i = 0; i < SPECIALS_BONUS && i < bonusOrder.length; i += 1) {
    const type = bonusOrder[i]!;
    counts[type] = (counts[type] ?? 0) + 1;
  }

  const specials: TileType[] = [];
  for (const type of SPECIAL_TILES) {
    for (let i = 0; i < (counts[type] ?? 0); i += 1) specials.push(type);
  }
  rng.shuffle(specials);

  const tiles: TileType[] = new Array<TileType>(tileCount).fill('coin');
  // One special per equal segment: an even spread reads as a designed board
  // and keeps every dice face meaningful.
  const segment = tileCount / specials.length;
  for (let i = 0; i < specials.length; i += 1) {
    const start = Math.floor(i * segment);
    const end = Math.min(tileCount - 1, Math.floor((i + 1) * segment) - 1);
    let slot = end > start ? rng.int(start, end) : start;
    // The start tile stays plain so the first roll is the first real decision.
    if (slot === 0) slot = Math.min(tileCount - 1, 1);
    tiles[slot] = specials[i]!;
  }
  return tiles;
}

export interface DiceLoopOptions {
  onEnd?: (outcome: SessionOutcome) => void;
  onGoal?: (goalId: string, current: number, target: number) => void;
}

export class DiceLoop {
  readonly tiles: readonly TileType[];
  readonly level: LevelDirector;

  private readonly rules: DiceRules;
  private pos = 0;
  private purse = 0;
  private held = 0;

  constructor(tiles: readonly TileType[], rules: DiceRules, options: DiceLoopOptions = {}) {
    this.tiles = tiles;
    this.rules = rules;
    this.level = new LevelDirector(
      {
        id: 'table-ring',
        goals: [{ id: GOAL_SETS, target: rules.piecesTarget }],
        moves: rules.rolls,
      },
      { onEnd: options.onEnd, onGoal: options.onGoal },
    );
  }

  get position(): number {
    return this.pos;
  }

  get coins(): number {
    return this.purse;
  }

  get pieces(): number {
    return this.held;
  }

  /** Tile indices the token visits for `roll`, in hop order (excludes `from`). */
  path(from: number, roll: number): number[] {
    const steps: number[] = [];
    for (let i = 1; i <= roll; i += 1) steps.push((from + i) % this.tiles.length);
    return steps;
  }

  /**
   * Rolls once and resolves the landing tile. Returns null when the session is
   * already over. `rollagain` refunds the roll it consumed instead of granting a
   * queued extra turn, which is the same thing for a move budget and keeps the
   * scene's "one roll per tap" flow intact.
   */
  roll(rng: Rng): RollEvent | null {
    if (this.level.ended) return null;

    const face = rng.int(1, this.rules.diceFaces);
    const from = this.pos;
    const to = (from + face) % this.tiles.length;
    this.level.useMove();
    this.pos = to;

    const tile = this.tiles[to] ?? 'coin';
    let delta = 0;
    let piece: number | null = null;
    let refunded = false;
    let effect: string = tile;

    switch (tile) {
      case 'coin':
        delta = this.rules.coinGain;
        break;
      case 'chest':
        delta = this.rules.chestGain;
        break;
      case 'loss':
        delta = -Math.round(this.purse * this.rules.lossRatio);
        if (delta === 0) effect = 'loss-empty';
        break;
      case 'rollagain':
        this.level.useMove(-1);
        refunded = true;
        break;
      case 'collect':
        if (this.held < this.rules.piecesTarget) {
          piece = this.held;
          this.held += 1;
        }
        break;
    }

    this.purse = Math.max(0, this.purse + delta);
    // Progress before settling: a final piece must win, not run out of moves.
    if (piece !== null) this.level.recordProgress(GOAL_SETS, 1);
    this.level.settleMove();

    return { roll: face, from, to, tile, effect, delta, coins: this.purse, piece, refunded };
  }
}
