/**
 * Carried-loot bag (PRD-V2 §5.16, §16.1 E22/E23): a `cols`-wide cell grid
 * (12 cells base), 1-cell gear and 1-2-cell valuables auto-packed, a visible
 * casket (items that survive death), the value swap rule when full, and the
 * run settlement (§2.4, §5.26).
 *
 * Pure TypeScript — the headless sim and `sim/kits/loot.selftest.ts` tick it.
 *
 * Packing law: 2-cell items occupy two horizontally adjacent cells of one row.
 * Pairs are placed first (row-major first fit), singles fill what remains, so
 * the grid holds a set iff `pairs ≤ Σ floor(rowWidth/2)` and
 * `2·pairs + singles ≤ cells` — which makes the swap rule's minimum-value
 * victim set computable exactly from sorted prefix sums.
 */
import { gearValue } from '../data/gear';
import type { Rng } from '../core/rng';
import { valuableDef } from '../data/valuables';
import type { BagAddResult, BagItemView, BagSettlement, BagView, LootItem, Rarity } from '../data/types-v2';

/** `TUNING.bag` subset the bag reads (pass the section whole). */
export interface BagTuning {
  cols: number;
  /** Swap/overflow drops linger on the ground this long (the caller spawns them). */
  dropLingerS: number;
  /** FALSE IS LAW (PRD §5.6/§5.16): true auto-pins the most valuable pickup into a free casket slot. */
  autoPinHighest: boolean;
}

/** §16.1 E23: sell value in ◆ (gear: Meta's `gearValue` = `gear.valueByRarity`; valuable: table value). */
export function itemValue(item: LootItem): number {
  if (item.kind === 'gear') return gearValue(item.item);
  return valuableDef(item.item.id).value;
}

/** Cells the item occupies (gear 1; valuables 1-2). */
function itemCells(item: LootItem): 1 | 2 {
  return item.kind === 'gear' ? 1 : valuableDef(item.item.id).cells;
}

/** Rarity colour index (valuable tier maps 1:1 onto §5.15.1 rarities). */
export function itemRarity(item: LootItem): Rarity {
  return item.kind === 'gear' ? item.item.rarity : valuableDef(item.item.id).tier;
}

/** Codex key for `RunReport.itemsSeen` ('gear:<base>' | 'uniq:<id>' | 'val:<id>'). */
export function itemCodexKey(item: LootItem): string {
  if (item.kind === 'valuable') return `val:${item.item.id}`;
  return item.item.unique !== undefined ? `uniq:${item.item.unique}` : `gear:${item.item.base}`;
}

interface Carried {
  item: LootItem;
  uid: string;
  cells: 1 | 2;
  value: number;
  rarity: Rarity;
  /** Acquisition order — deterministic tie-break everywhere. */
  seq: number;
  pinned: boolean;
  col: number;
  row: number;
}

export class Bag {
  readonly cols: number;
  readonly tuning: BagTuning;
  private cellCount: number;
  private casketCount: number;
  private shardCount = 0;
  private readonly carried: Carried[] = [];
  private nextSeq = 0;
  private picked = 0;
  private nudged = false;

  constructor(cap: { cells: number; casketSlots: number }, tuning: BagTuning) {
    this.tuning = tuning;
    this.cols = Math.max(1, tuning.cols);
    this.cellCount = Math.max(1, Math.floor(cap.cells));
    this.casketCount = Math.max(0, Math.floor(cap.casketSlots));
  }

  get shards(): number {
    return this.shardCount;
  }

  get cells(): number {
    return this.cellCount;
  }

  get casketSlots(): number {
    return this.casketCount;
  }

  /** Items ever accepted this run (Ward Candle gate, coach beat). */
  get itemsPickedUp(): number {
    return this.picked;
  }

  get dropLingerMs(): number {
    return this.tuning.dropLingerS * 1000;
  }

  addShards(n: number): void {
    if (n > 0) this.shardCount += Math.floor(n);
  }

  /** Spends shards (Fence reveal); false and no change when short. */
  spendShards(n: number): boolean {
    if (n < 0 || n > this.shardCount) return false;
    this.shardCount -= n;
    return true;
  }

  /** Ward Candle (`cb_candle`): extra casket slots for the rest of the run. */
  addCasketSlots(n: number): void {
    this.casketCount += Math.max(0, Math.floor(n));
  }

  /**
   * Picks an item up (§5.16). Fits ⇒ accepted. Full ⇒ the cheapest set of
   * unpinned bag items whose removal lets it pack is found; if the new item's
   * value is STRICTLY greater than that set's value the set is dropped
   * (`dropped`, the caller leaves them on the ground for `dropLingerMs`),
   * otherwise the new item is `refused` and stays on the ground.
   */
  add(item: LootItem): BagAddResult {
    const entry = this.wrap(item);
    const bagItems = this.bagEntries();
    if (this.fits(bagItems, entry)) {
      this.accept(entry);
      return { accepted: true, dropped: [], refused: null };
    }
    const victims = this.cheapestVictims(bagItems, entry);
    if (victims === null || entry.value <= sumValue(victims)) {
      return { accepted: false, dropped: [], refused: item };
    }
    for (const v of victims) this.removeEntry(v);
    this.accept(entry);
    return { accepted: true, dropped: victims.map((v) => v.item), refused: null };
  }

  /**
   * Moves a bag item into the casket. With the casket full, its OLDEST pin is
   * swapped back into the bag — allowed only if the grid can hold it once the
   * newly pinned item leaves. False when nothing changed.
   */
  pin(uid: string): boolean {
    const target = this.carried.find((e) => e.uid === uid && !e.pinned);
    if (target === undefined || this.casketCount <= 0) return false;
    const pins = this.carried.filter((e) => e.pinned);
    if (pins.length < this.casketCount) {
      target.pinned = true;
      this.repack();
      return true;
    }
    const oldest = pins.reduce((a, b) => (a.seq <= b.seq ? a : b));
    const rest = this.bagEntries().filter((e) => e !== target);
    if (!this.fits(rest, oldest)) return false;
    oldest.pinned = false;
    target.pinned = true;
    this.repack();
    return true;
  }

  /** Returns a casket item to the bag; stays pinned when the grid has no room for it. */
  unpin(uid: string): void {
    const target = this.carried.find((e) => e.uid === uid && e.pinned);
    if (target === undefined || !this.fits(this.bagEntries(), target)) return;
    target.pinned = false;
    this.repack();
  }

  /** Removes an item (bag or casket) — the caller drops it on the ground. */
  drop(uid: string): LootItem | null {
    const target = this.carried.find((e) => e.uid === uid);
    if (target === undefined) return null;
    this.removeEntry(target);
    return target.item;
  }

  /** Offering Altar (§5.25): the highest-value UNPINNED item, removed. Earliest on ties. */
  takeHighestValue(): LootItem | null {
    let best: Carried | null = null;
    for (const e of this.carried) if (!e.pinned && (best === null || e.value > best.value)) best = e;
    if (best === null) return null;
    this.removeEntry(best);
    return best.item;
  }

  /**
   * Toll Gate (§5.25): pays `max(min, round(shards·pct))`. Returns the amount
   * paid, or 0 (nothing deducted) when the carried shards cannot cover it.
   */
  payToll(pct: number, min: number): number {
    const cost = Math.max(min, Math.round(this.shardCount * pct));
    if (cost > this.shardCount || cost <= 0) return 0;
    this.shardCount -= cost;
    return cost;
  }

  /** Every carried item, casket first then grid order. */
  private items(): LootItem[] {
    return [...this.casketEntries(), ...this.bagEntries()].map((e) => e.item);
  }

  view(): BagView {
    const items = this.bagEntries().map(toView);
    const used = items.reduce((n, v) => n + v.cells, 0);
    const casket = this.casketEntries().map(toView);
    return {
      cols: this.cols,
      rows: Math.ceil(this.cellCount / this.cols),
      cells: this.cellCount,
      used,
      full: used >= this.cellCount,
      shards: this.shardCount,
      casketSlots: this.casketCount,
      casket,
      items,
    };
  }

  /** `HudModelV2.bag`; `rarityStrip` = casket then grid order. */
  hud(): { used: number; cells: number; casketUsed: number; casketSlots: number; rarityStrip: Rarity[]; full: boolean } {
    const v = this.view();
    return {
      used: v.used,
      cells: v.cells,
      casketUsed: v.casket.length,
      casketSlots: v.casketSlots,
      rarityStrip: [...v.casket, ...v.items].map((i) => i.rarity),
      full: v.full,
    };
  }

  /**
   * §5.16 casket nudge: true exactly once per run, the first time the casket
   * has a free slot and a Gilded+ (rarity ≥ 4) item sits unpinned in the bag.
   */
  casketNudgeDue(): boolean {
    if (this.nudged || this.casketCount <= 0) return false;
    if (this.casketEntries().length > 0) return false;
    if (!this.bagEntries().some((e) => e.rarity >= 4)) return false;
    this.nudged = true;
    return true;
  }

  /**
   * §16.1 E22 settlement (§2.4, §5.26). Extracted: shards × greed, every item
   * kept. Died/abandoned: `deathKeepPct`% of shards (floor), casket kept, plus
   * one random bag item with Grave Pact (`e_gravepact`); the rest is lost.
   */
  settle(
    outcome: BagSettlement['outcome'],
    opts: { deathKeepPct: number; greedMul: number; gravePact: boolean; rng: Rng },
  ): BagSettlement {
    const shards = this.shardCount;
    if (outcome === 'extracted') {
      const banked = Math.floor(shards * Math.max(1, opts.greedMul));
      return { outcome, shardsBanked: banked, shardsLost: 0, greedMul: Math.max(1, opts.greedMul), kept: this.items(), lost: [] };
    }
    const keepPct = Math.max(0, Math.min(100, opts.deathKeepPct));
    const banked = Math.floor((shards * keepPct) / 100);
    const kept = this.casketEntries().map((e) => e.item);
    const bag = this.bagEntries();
    if (opts.gravePact && bag.length > 0) {
      const saved = opts.rng.pick(bag);
      kept.push(saved.item);
      bag.splice(bag.indexOf(saved), 1);
    }
    return { outcome, shardsBanked: banked, shardsLost: shards - banked, greedMul: 1, kept, lost: bag.map((e) => e.item) };
  }

  // ─── internals ───

  private wrap(item: LootItem): Carried {
    return {
      item,
      uid: item.item.uid,
      cells: itemCells(item),
      value: itemValue(item),
      rarity: itemRarity(item),
      seq: -1,
      pinned: false,
      col: -1,
      row: -1,
    };
  }

  private accept(entry: Carried): void {
    entry.seq = this.nextSeq;
    this.nextSeq += 1;
    this.picked += 1;
    this.carried.push(entry);
    if (this.tuning.autoPinHighest && this.casketEntries().length < this.casketCount) {
      const best = this.bagEntries().reduce<Carried | null>((a, b) => (a === null || b.value > a.value ? b : a), null);
      if (best !== null) best.pinned = true;
    }
    this.repack();
  }

  private removeEntry(entry: Carried): void {
    const i = this.carried.indexOf(entry);
    if (i >= 0) this.carried.splice(i, 1);
    this.repack();
  }

  private bagEntries(): Carried[] {
    return this.carried.filter((e) => !e.pinned).sort((a, b) => a.row - b.row || a.col - b.col || a.seq - b.seq);
  }

  private casketEntries(): Carried[] {
    return this.carried.filter((e) => e.pinned).sort((a, b) => a.seq - b.seq);
  }

  /** Row widths of the grid (last row partial when cells % cols ≠ 0). */
  private rowWidths(): number[] {
    const rows = Math.ceil(this.cellCount / this.cols);
    return Array.from({ length: rows }, (_, r) => Math.min(this.cols, this.cellCount - r * this.cols));
  }

  private pairCapacity(): number {
    return this.rowWidths().reduce((n, w) => n + Math.floor(w / 2), 0);
  }

  private fitsCounts(pairs: number, singles: number): boolean {
    return pairs <= this.pairCapacity() && pairs * 2 + singles <= this.cellCount;
  }

  private fits(current: readonly Carried[], extra: Carried): boolean {
    let pairs = extra.cells === 2 ? 1 : 0;
    let singles = extra.cells === 1 ? 1 : 0;
    for (const e of current) {
      if (e.cells === 2) pairs += 1;
      else singles += 1;
    }
    return this.fitsCounts(pairs, singles);
  }

  /**
   * Minimum-value victim set among unpinned bag items that lets `entry` pack.
   * Feasibility depends only on remaining pair/single COUNTS, so the cheapest
   * set removing p pairs and s singles is the p cheapest pairs + s cheapest
   * singles (latest-acquired first on value ties — older items are kept).
   * Ties on total value prefer fewer items. Null when nothing frees enough.
   */
  private cheapestVictims(bag: readonly Carried[], entry: Carried): Carried[] | null {
    const byCheap = (a: Carried, b: Carried): number => a.value - b.value || b.seq - a.seq;
    const pairs = bag.filter((e) => e.cells === 2).sort(byCheap);
    const singles = bag.filter((e) => e.cells === 1).sort(byCheap);
    const addP = entry.cells === 2 ? 1 : 0;
    const addS = entry.cells === 1 ? 1 : 0;
    let best: { p: number; s: number; cost: number } | null = null;
    let pCost = 0;
    for (let p = 0; p <= pairs.length; p += 1) {
      if (p > 0) pCost += pairs[p - 1]!.value;
      let sCost = 0;
      for (let s = 0; s <= singles.length; s += 1) {
        if (s > 0) sCost += singles[s - 1]!.value;
        if (!this.fitsCounts(pairs.length - p + addP, singles.length - s + addS)) continue;
        const cost = pCost + sCost;
        if (best === null || cost < best.cost || (cost === best.cost && p + s < best.p + best.s)) best = { p, s, cost };
        break; // more singles only cost more
      }
    }
    if (best === null) return null;
    return [...pairs.slice(0, best.p), ...singles.slice(0, best.s)];
  }

  /** Re-derives every bag item's cell: pairs first-fit row-major, then singles, acquisition order. */
  private repack(): void {
    const widths = this.rowWidths();
    const occupied = widths.map((w) => new Array<boolean>(w).fill(false));
    const bag = this.carried.filter((e) => !e.pinned).sort((a, b) => a.seq - b.seq);
    for (const e of this.carried) {
      e.col = -1;
      e.row = -1;
    }
    const place = (e: Carried): void => {
      for (let r = 0; r < occupied.length; r += 1) {
        const row = occupied[r]!;
        for (let c = 0; c + e.cells <= row.length; c += 1) {
          if (row[c] || (e.cells === 2 && row[c + 1])) continue;
          row[c] = true;
          if (e.cells === 2) row[c + 1] = true;
          e.row = r;
          e.col = c;
          return;
        }
      }
      throw new Error(`Bag packing invariant broken for ${e.uid}`);
    };
    for (const e of bag) if (e.cells === 2) place(e);
    for (const e of bag) if (e.cells === 1) place(e);
  }
}

function sumValue(list: readonly Carried[]): number {
  return list.reduce((n, e) => n + e.value, 0);
}

function toView(e: Carried): BagItemView {
  return { uid: e.uid, item: e.item, cells: e.cells, value: e.value, rarity: e.rarity, pinned: e.pinned, col: e.col, row: e.row };
}
