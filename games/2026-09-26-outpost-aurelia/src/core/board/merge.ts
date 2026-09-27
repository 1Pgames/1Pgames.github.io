import type { PieceKind } from './types';
import type { Rng } from '../rng';

/**
 * Merge-chain model (family B's merge variant: two identical items become the
 * next item up the ladder, generators keep feeding the bottom rung).
 *
 * Logic only — no slice consumes it yet. It is here so the merge slice is a
 * renderer over a tested model instead of a fresh implementation, exactly like
 * `resolve.ts` is for match-3.
 */

/** Ordered ladder, index 0 = the rung generators produce. */
export interface MergeChain {
  kinds: readonly PieceKind[];
}

/**
 * Merges two items: identical kinds that are not already the top rung produce
 * the next kind up. Anything else returns `null` (the slice snaps the dragged
 * item back).
 */
export function tryMerge(chain: MergeChain, a: PieceKind, b: PieceKind): PieceKind | null {
  if (a !== b) return null;
  const index = chain.kinds.indexOf(a);
  if (index < 0 || index >= chain.kinds.length - 1) return null;
  return chain.kinds[index + 1] as PieceKind;
}

/**
 * Score/value of a rung: doubling per step, so merging two rung-n items is
 * always worth exactly what its inputs were. Off-ladder kinds are worth 0.
 */
export function mergeValue(chain: MergeChain, kind: PieceKind, baseValue = 1): number {
  const index = chain.kinds.indexOf(kind);
  return index < 0 ? 0 : baseValue * 2 ** index;
}

/**
 * Greedily merges a bag of items until nothing pairs up (the "auto-merge"
 * button and the sim's yield model). Returns the settled bag and how many
 * merges happened.
 */
export function mergeAll(chain: MergeChain, items: readonly PieceKind[]): { items: PieceKind[]; merges: number } {
  const counts = new Array<number>(chain.kinds.length).fill(0);
  const offLadder: PieceKind[] = [];
  for (const item of items) {
    const index = chain.kinds.indexOf(item);
    if (index < 0) offLadder.push(item);
    else counts[index] = (counts[index] as number) + 1;
  }
  let merges = 0;
  for (let index = 0; index < counts.length - 1; index += 1) {
    const pairs = Math.floor((counts[index] as number) / 2);
    if (pairs === 0) continue;
    counts[index] = (counts[index] as number) - pairs * 2;
    counts[index + 1] = (counts[index + 1] as number) + pairs;
    merges += pairs;
  }
  const settled: PieceKind[] = [...offLadder];
  for (let index = 0; index < counts.length; index += 1) {
    for (let n = 0; n < (counts[index] as number); n += 1) settled.push(chain.kinds[index] as PieceKind);
  }
  return { items: settled, merges };
}

export interface GeneratorSpec {
  /** Taps available before the generator has to recharge. */
  charges: number;
  /** Milliseconds to regain one charge. */
  rechargeMs: number;
  /**
   * Chance a tap yields the SECOND rung instead of the first — the small
   * jackpot that makes tapping a generator feel alive. 0 disables it.
   */
  luckyChance?: number;
}

/**
 * A tappable source of bottom-rung items with a recharging charge pool.
 * Deterministic given its `Rng`, and Phaser-free so the sim can measure how
 * many items per minute a generator actually sustains.
 */
export class MergeGenerator {
  readonly spec: GeneratorSpec;

  private readonly chain: MergeChain;
  private readonly rng: Rng;
  private stock: number;
  private rechargeCarryMs = 0;

  constructor(chain: MergeChain, rng: Rng, spec: GeneratorSpec) {
    this.chain = chain;
    this.rng = rng;
    this.spec = spec;
    this.stock = spec.charges;
  }

  get charges(): number {
    return this.stock;
  }

  /** 0..1 fill of the charge currently regenerating (the radial UI value). */
  get rechargeRatio(): number {
    if (this.stock >= this.spec.charges) return 1;
    return Math.min(1, this.rechargeCarryMs / this.spec.rechargeMs);
  }

  update(deltaMs: number): void {
    if (this.stock >= this.spec.charges || deltaMs <= 0) return;
    this.rechargeCarryMs += deltaMs;
    while (this.rechargeCarryMs >= this.spec.rechargeMs && this.stock < this.spec.charges) {
      this.rechargeCarryMs -= this.spec.rechargeMs;
      this.stock += 1;
    }
    if (this.stock >= this.spec.charges) this.rechargeCarryMs = 0;
  }

  /** Spends one charge for one item, or `null` when empty. */
  tap(): PieceKind | null {
    if (this.stock <= 0) return null;
    this.stock -= 1;
    const lucky = this.spec.luckyChance ?? 0;
    const rung = lucky > 0 && this.chain.kinds.length > 1 && this.rng.chance(lucky) ? 1 : 0;
    return this.chain.kinds[rung] as PieceKind;
  }
}
