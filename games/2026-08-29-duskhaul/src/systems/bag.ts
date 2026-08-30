/**
 * Carried-loot bag for Duskhaul (PRD §5.6/§16.1): weightless shards, a fixed
 * number of relic slots, the Gravekeeper's Casket (secure slots that survive
 * death), drop-lowest overflow with a regret window, and the end-of-run
 * settlement.
 *
 * Pure TypeScript, ZERO imports — the headless sim ticks this.
 *
 * ## The casket is MANUAL-PIN ONLY (post-playtest re-spec, PRD §5.6)
 * The greybox auto-pinned the highest-tier carried relic, which inverted the
 * fear the casket exists to create: whatever died with you was BY DEFINITION
 * your worst loot (measured: 3 of 5 runs ended "BANKED 0sh 1rl / LOST 448sh
 * 0rl"). The casket now starts EMPTY and stays empty until the player pins
 * deliberately — so pinning is a real decision with an opportunity cost, and
 * never pinning means nothing survives. `autoPinHighest` keeps the old
 * behaviour available to the balance loop as a number change, defaulting off.
 */

export type RelicTier = 1 | 2 | 3 | 4;

/**
 * The relic shape the bag and the results screen read. `data/relics.ts` owns
 * the FULL §16.1 `RelicDef` (desc/slot/gear/effect) and is a structural
 * superset of this, so a real relic is assignable here without a cast and this
 * module stays importable by a headless fixture that has no content table —
 * which `sim/kits/extraction.selftest.ts` relies on. Deliberately NOT collapsed
 * into an import of `data/relics.ts`: that would drag the content table (and
 * `config.ts`, and Phaser) into every consumer of the bag.
 */
export interface RelicDef {
  id: string;
  name: string;
  tier: RelicTier;
  /** Shard value when salvaged (also the results screen's value readout). */
  salvage: number;
}

export interface BagSettlement {
  shards: number;
  relics: RelicDef[];
  lost: RelicDef[];
}

/** `TUNING.bag` — mirrors that section's key names verbatim (PRD §7). */
export interface BagTuning {
  /**
   * FALSE IS LAW (PRD §5.6): the casket starts empty and `pinCasket` is the
   * only way in. True restores the greybox's auto-pin of the highest tier —
   * kept only so the balance loop can revisit without a code change.
   */
  autoPinHighest: boolean;
  /** An overflow-dropped relic lingers on the ground this long for regret pickup. */
  dropLingerS: number;
}

/**
 * MODULE-PRIVATE: a copy of `TUNING.bag`, kept only so an omitted key in the
 * optional `tuning` argument has a defined meaning. Exporting it would publish
 * a second source of truth for two numbers config already owns.
 */
const BAG_DEFAULTS: BagTuning = {
  autoPinHighest: false,
  dropLingerS: 10,
};

/** Result of a pickup: what got in, what fell out, and how long it lingers. */
export interface BagAddResult {
  accepted: boolean;
  dropped: RelicDef | null;
  /** ms the dropped (or refused) relic stays re-pickable on the ground. */
  dropLingerMs: number;
}

/** What `pinCasket` did: the pin, what it displaced, and what fell on the floor. */
export interface BagPinResult {
  pinned: boolean;
  /** The relic a full casket had to give up, if any. */
  unpinned: RelicDef | null;
  /** Set when the unpinned relic could not fit back into a full bag. */
  dropped: RelicDef | null;
  dropLingerMs: number;
}

interface CarriedRelic {
  def: RelicDef;
  /** Monotonic acquisition index — the deterministic tie-break everywhere. */
  seq: number;
  /** True while it occupies a casket slot. */
  pinned: boolean;
  /** True when the PLAYER pinned it — an auto-pin may be displaced, a manual one may not. */
  manual: boolean;
  /** Pin order — the deterministic "oldest pin" a full casket displaces. */
  pinSeq: number;
}

/**
 * One instance per run. `relics` is the ordinary bag (bounded by `slots`);
 * `casket` is the secure slice (bounded by `casketSlots`). Casket relics do NOT
 * occupy bag slots (PRD §5.1: 8 bag slots + 1 casket slot), so pinning frees a
 * bag slot and un-pinning re-occupies one.
 */
export class Bag {
  readonly slots: number;
  readonly casketSlots: number;
  readonly tuning: BagTuning;

  private shardCount = 0;
  /** Everything carried, casket included, in acquisition order. */
  private readonly carried: CarriedRelic[] = [];
  private nextSeq = 0;
  private nextPinSeq = 0;

  /** Scratch, rebuilt by `repartition` — exposed via the readonly getters. */
  private bagView: RelicDef[] = [];
  private casketView: RelicDef[] = [];

  constructor(slots: number, casketSlots: number, tuning?: Partial<BagTuning>) {
    this.slots = slots;
    this.casketSlots = casketSlots;
    this.tuning = { ...BAG_DEFAULTS, ...tuning };
  }

  get shards(): number {
    return this.shardCount;
  }

  /** Carried relics OUTSIDE the casket, acquisition order. */
  get relics(): readonly RelicDef[] {
    return this.bagView;
  }

  /** Casket-pinned relics — these survive death. Empty until the player pins. */
  get casket(): readonly RelicDef[] {
    return this.casketView;
  }

  /** Bag slots occupied (casket excluded) — the HUD pip count. */
  get used(): number {
    return this.bagView.length;
  }

  /** True when the next relic will force a drop-lowest decision. */
  get full(): boolean {
    return this.bagView.length >= this.slots;
  }

  /** Salvage value of everything carried, casket included — results readout. */
  get carriedValue(): number {
    let total = 0;
    for (const entry of this.carried) total += entry.def.salvage;
    return total;
  }

  /** How long a dropped relic stays re-pickable, ms. */
  get dropLingerMs(): number {
    return this.tuning.dropLingerS * 1000;
  }

  addShards(n: number): void {
    if (n > 0) this.shardCount += n;
  }

  /**
   * Picks up a relic. Overflow drops the LOWEST-tier unpinned bag relic
   * (earliest acquired on ties); a casket-pinned relic is NEVER a victim. When
   * the new relic itself is the worst thing carried it never enters:
   * `{accepted: false, dropped: null}` — the caller leaves it on the ground for
   * `dropLingerMs`, exactly as it does a displaced one.
   */
  addRelic(def: RelicDef): BagAddResult {
    const entry: CarriedRelic = { def, seq: this.nextSeq, pinned: false, manual: false, pinSeq: -1 };
    this.nextSeq += 1;
    this.carried.push(entry);
    this.repartition();

    if (this.bagView.length <= this.slots) {
      return { accepted: true, dropped: null, dropLingerMs: this.dropLingerMs };
    }

    const victim = this.overflowVictim();
    if (victim === null) return { accepted: true, dropped: null, dropLingerMs: this.dropLingerMs };
    this.remove(victim);
    if (victim === entry) return { accepted: false, dropped: null, dropLingerMs: this.dropLingerMs };
    return { accepted: true, dropped: victim.def, dropLingerMs: this.dropLingerMs };
  }

  /**
   * Deliberately pins a carried relic into the casket (PRD §5.6: tap a bag pip
   * on the pause overlay). A full casket gives up its OLDEST pin, which returns
   * to the bag — and is dropped (with the linger window) only if the bag has no
   * room, since the player chose the swap.
   *
   * Reports the whole outcome rather than a bare boolean because the caller has
   * to sell all three of them: the pin, the relic it displaced, and the relic
   * that fell on the floor. A boolean `pinCasket` sat beside this for the whole
   * build with no product call site precisely because no UI could use it.
   */
  pinCasket(relicId: string): BagPinResult {
    const miss: BagPinResult = {
      pinned: false,
      unpinned: null,
      dropped: null,
      dropLingerMs: this.dropLingerMs,
    };
    if (this.casketSlots <= 0) return miss;
    const target = this.carried.find((e) => e.def.id === relicId && !e.pinned);
    if (target === undefined) return miss;

    let unpinned: CarriedRelic | null = null;
    if (this.pinnedCount() >= this.casketSlots) {
      unpinned = this.oldestPin();
      if (unpinned !== null) {
        unpinned.pinned = false;
        unpinned.manual = false;
        unpinned.pinSeq = -1;
      }
    }
    target.pinned = true;
    target.manual = true;
    target.pinSeq = this.nextPinSeq;
    this.nextPinSeq += 1;
    this.repartition();

    let dropped: RelicDef | null = null;
    if (this.bagView.length > this.slots && unpinned !== null) {
      // The displaced relic is the one that falls out: the player chose the swap.
      this.remove(unpinned);
      dropped = unpinned.def;
    }
    return {
      pinned: true,
      unpinned: unpinned === null ? null : unpinned.def,
      dropped,
      dropLingerMs: this.dropLingerMs,
    };
  }

  /** Releases a pin back into the bag. False if it was not pinned. */
  unpinCasket(relicId: string): boolean {
    const entry = this.carried.find((e) => e.def.id === relicId && e.pinned);
    if (entry === undefined) return false;
    entry.pinned = false;
    entry.manual = false;
    entry.pinSeq = -1;
    this.repartition();
    return true;
  }

  /**
   * Ends the run. `extracted` banks everything carried; `died` banks the casket
   * plus `keepPct`% (0-100) of carried shards — the Rot Tithe meta valve,
   * `TUNING.meta.deathKeepPct`, 0 without it — and reports the bag as lost.
   *
   * Nothing EQUIPPED or already banked appears here: gear lives in the meta
   * save, so a death can never touch it (PRD §2A "equipped gear is never
   * lost"). Only carried loot is ever at stake.
   */
  settle(outcome: 'extracted' | 'died', keepPct: number): BagSettlement {
    if (outcome === 'extracted') {
      return { shards: this.shardCount, relics: [...this.casketView, ...this.bagView], lost: [] };
    }
    return {
      shards: Math.floor((this.shardCount * Math.max(0, Math.min(100, keepPct))) / 100),
      relics: [...this.casketView],
      lost: [...this.bagView],
    };
  }

  /** Lowest-tier unpinned entry, earliest acquired on ties. */
  private overflowVictim(): CarriedRelic | null {
    let victim: CarriedRelic | null = null;
    for (const entry of this.carried) {
      if (entry.pinned) continue;
      if (victim === null || entry.def.tier < victim.def.tier) victim = entry;
    }
    return victim;
  }

  private pinnedCount(): number {
    let n = 0;
    for (const entry of this.carried) if (entry.pinned) n += 1;
    return n;
  }

  private oldestPin(): CarriedRelic | null {
    let oldest: CarriedRelic | null = null;
    for (const entry of this.carried) {
      if (!entry.pinned) continue;
      if (oldest === null || entry.pinSeq < oldest.pinSeq) oldest = entry;
    }
    return oldest;
  }

  private remove(entry: CarriedRelic): void {
    const index = this.carried.indexOf(entry);
    if (index >= 0) this.carried.splice(index, 1);
    this.repartition();
  }

  /**
   * Rebuilds the casket/bag split from the PIN FLAGS — never from def identity.
   * Relic defs come from a shared table, so two copies of one relic are the
   * same object and an identity comparison would conflate them (the greybox
   * bug: a duplicate of a casketed relic vanished from both views).
   * Both views keep acquisition order for stable HUD pips.
   */
  private repartition(): void {
    if (this.tuning.autoPinHighest) this.autoPin();
    this.casketView = [];
    this.bagView = [];
    for (const entry of this.carried) {
      if (entry.pinned) this.casketView.push(entry.def);
      else this.bagView.push(entry.def);
    }
  }

  /**
   * Legacy greybox behaviour, OFF by default: keep the spare casket slots
   * filled with the best carried relics. Auto-pins are re-evaluated on every
   * mutation (a later Dread relic displaces an auto-pinned Tarnished one);
   * MANUAL pins are never displaced by it.
   */
  private autoPin(): void {
    for (const entry of this.carried) {
      if (entry.pinned && !entry.manual) {
        entry.pinned = false;
        entry.pinSeq = -1;
      }
    }
    let free = this.casketSlots - this.pinnedCount();
    if (free <= 0) return;
    const candidates = this.carried
      .filter((entry) => !entry.pinned)
      .sort((a, b) => (a.def.tier !== b.def.tier ? b.def.tier - a.def.tier : a.seq - b.seq));
    for (const entry of candidates) {
      if (free <= 0) break;
      entry.pinned = true;
      entry.pinSeq = this.nextPinSeq;
      this.nextPinSeq += 1;
      free -= 1;
    }
  }
}

/**
 * Meta-resolved bag capacity (PRD §10): Marrow Sack adds bag slots per stack,
 * Widow's Casket adds a secure slot. One place, so the scene and the sim size
 * the bag identically.
 */
export function resolveBagCapacity(
  base: { slots: number; casketSlots: number },
  meta: { bagSlotsBonus?: number; casketSlotsBonus?: number } = {},
): { slots: number; casketSlots: number } {
  return {
    slots: Math.max(1, base.slots + (meta.bagSlotsBonus ?? 0)),
    casketSlots: Math.max(0, base.casketSlots + (meta.casketSlotsBonus ?? 0)),
  };
}
