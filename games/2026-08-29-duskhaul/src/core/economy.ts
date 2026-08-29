/**
 * Idle-tycoon economy kit — family F (`generators / managers / prestige`).
 *
 * Pure TypeScript, no Phaser import, no `Math.random`: the whole loop is a
 * function of the spec plus elapsed milliseconds, so `src/sim/kits/*.selftest.ts`
 * and the balance sim can tick a full prestige cycle headlessly, and the scene
 * only renders what this class already decided.
 *
 * The three verbs of the family:
 *  - **buy** a generator: cost grows geometrically per unit owned, so a bulk
 *    purchase is a closed-form geometric sum (`buyCost`).
 *  - **collect**: a generator with no manager pays only when tapped, once per
 *    its `cycleMs`. A generator with a manager pays continuously in `update`.
 *    Both routes pay the SAME rate — a manager buys away the tapping, not extra
 *    income. That keeps `incomePerSec()` honest as "money that arrives on its
 *    own" (used for offline earnings) without a second balance curve.
 *  - **prestige**: wipe cash/generators/managers, keep a permanent additive
 *    multiplier. See `prestigeGain` for the formula.
 */

export interface GeneratorDef {
  id: string;
  name: string;
  /** Cost of the FIRST unit. Unit n costs `baseCost * costGrowth^n`. */
  baseCost: number;
  /** Geometric cost growth per owned unit; keep inside 1.07..1.15. */
  costGrowth: number;
  /** Income of ONE unit per second, before the prestige multiplier. */
  baseIncomePerSec: number;
  /** Manual-collect cycle. Also the granularity a manual tap pays out in. */
  cycleMs: number;
  /** Hidden until this much has been earned since the last prestige. */
  unlockAtTotalEarned?: number;
}

export interface ManagerDef {
  id: string;
  /** Generator this manager automates. */
  generatorId: string;
  name: string;
  /** One-off cash cost; managers are wiped by a prestige reset. */
  cost: number;
}

export interface PrestigeSpec {
  /** `totalEarned` (since the last reset) needed before prestige is offered. */
  unlockAtTotalEarned: number;
  /** Additive multiplier granted per `earningsPerStep` earned this cycle. */
  multiplierPerReset: number;
  /** Denominator of the prestige formula (e.g. 1e3 lifetime earnings). */
  earningsPerStep: number;
}

export interface EconomySpec {
  generators: readonly GeneratorDef[];
  managers: readonly ManagerDef[];
  prestige: PrestigeSpec;
}

/** Plain JSON-safe save shape produced by `snapshot()`. */
export interface EconomySnapshot {
  v: number;
  cash: number;
  totalEarned: number;
  lifetimeEarned: number;
  owned: Record<string, number>;
  managers: string[];
  prestigeMult: number;
  prestigeCount: number;
  /** Manual-collect fill per generator, in ms. */
  cycle: Record<string, number>;
}

const SNAPSHOT_VERSION = 1;

export class Economy {
  readonly spec: EconomySpec;

  cash = 0;
  /** Earned since the last prestige — drives unlocks and the prestige gate. */
  totalEarned = 0;
  /** Earned across every prestige cycle; never reset. */
  lifetimeEarned = 0;
  /** Additive prestige bonus, starts at 1.0 (no bonus). */
  prestigeMult = 1;
  prestigeCount = 0;

  private readonly owned = new Map<string, number>();
  private readonly managed = new Set<string>();
  /** Manual-collect fill in ms, capped at the generator's `cycleMs`. */
  private readonly cycle = new Map<string, number>();
  private readonly byId = new Map<string, GeneratorDef>();
  private readonly managerById = new Map<string, ManagerDef>();

  constructor(spec: EconomySpec, startingCash = 0) {
    this.spec = spec;
    this.cash = startingCash;
    for (const def of spec.generators) this.byId.set(def.id, def);
    for (const def of spec.managers) this.managerById.set(def.id, def);
  }

  // --- queries ------------------------------------------------------------

  generator(id: string): GeneratorDef | undefined {
    return this.byId.get(id);
  }

  ownedOf(id: string): number {
    return this.owned.get(id) ?? 0;
  }

  hasManager(managerId: string): boolean {
    return this.managed.has(managerId);
  }

  /** True when any owned manager automates this generator. */
  isAutomated(generatorId: string): boolean {
    for (const id of this.managed) {
      if (this.managerById.get(id)?.generatorId === generatorId) return true;
    }
    return false;
  }

  /** Generators are revealed by earnings, so the list grows as the run does. */
  isUnlocked(generatorId: string): boolean {
    const def = this.byId.get(generatorId);
    if (!def) return false;
    return this.totalEarned >= (def.unlockAtTotalEarned ?? 0);
  }

  /**
   * Geometric sum of the next `count` units:
   * `baseCost * g^owned * (g^count - 1) / (g - 1)`.
   */
  buyCost(generatorId: string, count = 1): number {
    const def = this.byId.get(generatorId);
    if (!def || count <= 0) return Number.POSITIVE_INFINITY;
    const g = def.costGrowth;
    const first = def.baseCost * Math.pow(g, this.ownedOf(generatorId));
    if (g === 1) return first * count;
    return (first * (Math.pow(g, count) - 1)) / (g - 1);
  }

  canBuy(generatorId: string, count = 1): boolean {
    return this.isUnlocked(generatorId) && this.cash >= this.buyCost(generatorId, count);
  }

  /** What one generator pays per second at its current count, incl. prestige. */
  generatorIncomePerSec(generatorId: string): number {
    const def = this.byId.get(generatorId);
    if (!def) return 0;
    return this.ownedOf(generatorId) * def.baseIncomePerSec * this.prestigeMult;
  }

  /**
   * Passive income: ONLY manager-automated generators. This is the number the
   * offline calculation and the HUD's "per second" readout use.
   */
  incomePerSec(): number {
    let total = 0;
    for (const def of this.spec.generators) {
      if (this.isAutomated(def.id)) total += this.generatorIncomePerSec(def.id);
    }
    return total;
  }

  /** Income if every owned generator were automated — the row-total readout. */
  potentialIncomePerSec(): number {
    let total = 0;
    for (const def of this.spec.generators) total += this.generatorIncomePerSec(def.id);
    return total;
  }

  /** 0..1 fill of an un-managed generator's manual-collect cycle. */
  collectReadyRatio(generatorId: string): number {
    const def = this.byId.get(generatorId);
    if (!def || def.cycleMs <= 0) return 1;
    return Math.min(1, (this.cycle.get(generatorId) ?? 0) / def.cycleMs);
  }

  // --- actions ------------------------------------------------------------

  buy(generatorId: string, count = 1): boolean {
    if (!this.canBuy(generatorId, count)) return false;
    const cost = this.buyCost(generatorId, count);
    this.cash -= cost;
    const before = this.ownedOf(generatorId);
    this.owned.set(generatorId, before + count);
    // First unit arrives ready to tap, so buying always has an immediate verb.
    if (before === 0) this.cycle.set(generatorId, this.byId.get(generatorId)?.cycleMs ?? 0);
    return true;
  }

  managerCost(managerId: string): number {
    return this.managerById.get(managerId)?.cost ?? Number.POSITIVE_INFINITY;
  }

  canBuyManager(managerId: string): boolean {
    const def = this.managerById.get(managerId);
    if (!def || this.managed.has(managerId)) return false;
    // A manager is only useful once its generator produces something.
    return this.ownedOf(def.generatorId) > 0 && this.cash >= def.cost;
  }

  buyManager(managerId: string): boolean {
    if (!this.canBuyManager(managerId)) return false;
    this.cash -= this.managerCost(managerId);
    this.managed.add(managerId);
    return true;
  }

  /**
   * Manual payout for an un-managed generator: one full cycle's worth, at most
   * once per `cycleMs`. Returns the amount granted (0 when not ready, when
   * nothing is owned, or when a manager already collects for you).
   */
  collect(generatorId: string): number {
    const def = this.byId.get(generatorId);
    if (!def || this.ownedOf(generatorId) <= 0) return 0;
    if (this.isAutomated(generatorId)) return 0;
    if ((this.cycle.get(generatorId) ?? 0) < def.cycleMs) return 0;
    this.cycle.set(generatorId, 0);
    const amount = this.generatorIncomePerSec(generatorId) * (def.cycleMs / 1000);
    this.credit(amount);
    return amount;
  }

  /** Accrues automated income and refills manual-collect cycles. */
  update(deltaMs: number): void {
    if (deltaMs <= 0) return;
    const seconds = deltaMs / 1000;
    let passive = 0;
    for (const def of this.spec.generators) {
      const count = this.ownedOf(def.id);
      if (count <= 0) continue;
      if (this.isAutomated(def.id)) {
        passive += count * def.baseIncomePerSec;
        continue;
      }
      const fill = (this.cycle.get(def.id) ?? 0) + deltaMs;
      this.cycle.set(def.id, fill > def.cycleMs ? def.cycleMs : fill);
    }
    if (passive > 0) this.credit(passive * this.prestigeMult * seconds);
  }

  /** Preview of what a return after `elapsedMs` away is worth, capped. */
  offlineEarnings(elapsedMs: number, capHours: number): number {
    if (elapsedMs <= 0) return 0;
    const capMs = capHours * 3600_000;
    const creditedMs = Math.min(elapsedMs, capMs);
    return (this.incomePerSec() * creditedMs) / 1000;
  }

  /** Credits `offlineEarnings` and returns the granted amount. */
  grantOffline(elapsedMs: number, capHours: number): number {
    const amount = this.offlineEarnings(elapsedMs, capHours);
    if (amount > 0) this.credit(amount);
    return amount;
  }

  // --- prestige -----------------------------------------------------------

  prestigeAvailable(): boolean {
    return this.totalEarned >= this.spec.prestige.unlockAtTotalEarned;
  }

  /**
   * Additive multiplier a reset would grant:
   *
   *   gain = multiplierPerReset * (totalEarned / earningsPerStep)
   *
   * i.e. with `multiplierPerReset: 0.02` and `earningsPerStep: 1e3`, every
   * 1 000 earned this cycle is worth +0.02 forever. Gains accumulate onto
   * `prestigeMult` (start 1.0), so income scales linearly with total career
   * earnings while each cycle's cost curve restarts.
   */
  prestigeGain(): number {
    const { multiplierPerReset, earningsPerStep } = this.spec.prestige;
    if (earningsPerStep <= 0) return 0;
    return (this.totalEarned / earningsPerStep) * multiplierPerReset;
  }

  /**
   * Wipes cash, generators, managers and the cycle clocks; keeps
   * `prestigeMult` (raised by `prestigeGain`), `lifetimeEarned` and the reset
   * count. Returns the granted multiplier, or 0 when not yet available.
   */
  prestige(): number {
    if (!this.prestigeAvailable()) return 0;
    const gain = this.prestigeGain();
    this.prestigeMult += gain;
    this.prestigeCount += 1;
    this.cash = 0;
    this.totalEarned = 0;
    this.owned.clear();
    this.managed.clear();
    this.cycle.clear();
    return gain;
  }

  // --- serialization ------------------------------------------------------

  snapshot(): EconomySnapshot {
    const owned: Record<string, number> = {};
    for (const [id, count] of this.owned) owned[id] = count;
    const cycle: Record<string, number> = {};
    for (const [id, fill] of this.cycle) cycle[id] = fill;
    return {
      v: SNAPSHOT_VERSION,
      cash: this.cash,
      totalEarned: this.totalEarned,
      lifetimeEarned: this.lifetimeEarned,
      owned,
      managers: [...this.managed],
      prestigeMult: this.prestigeMult,
      prestigeCount: this.prestigeCount,
      cycle,
    };
  }

  /**
   * Restores a `snapshot()`. Unknown ids are dropped (content changed between
   * versions), missing fields fall back to a fresh state — a corrupt save must
   * degrade to a playable game, never throw.
   */
  restore(data: unknown): void {
    const raw = data as Partial<EconomySnapshot> | null | undefined;
    if (!raw || typeof raw !== 'object') return;
    this.cash = numberOr(raw.cash, 0);
    this.totalEarned = numberOr(raw.totalEarned, 0);
    this.lifetimeEarned = numberOr(raw.lifetimeEarned, this.totalEarned);
    this.prestigeMult = Math.max(1, numberOr(raw.prestigeMult, 1));
    this.prestigeCount = Math.max(0, Math.floor(numberOr(raw.prestigeCount, 0)));

    this.owned.clear();
    const owned = raw.owned;
    if (owned && typeof owned === 'object') {
      for (const def of this.spec.generators) {
        const count = Math.floor(numberOr(owned[def.id], 0));
        if (count > 0) this.owned.set(def.id, count);
      }
    }

    this.managed.clear();
    if (Array.isArray(raw.managers)) {
      for (const id of raw.managers) {
        if (typeof id === 'string' && this.managerById.has(id)) this.managed.add(id);
      }
    }

    this.cycle.clear();
    const cycle = raw.cycle;
    for (const def of this.spec.generators) {
      if (this.ownedOf(def.id) <= 0) continue;
      const fill = cycle && typeof cycle === 'object' ? numberOr(cycle[def.id], def.cycleMs) : def.cycleMs;
      this.cycle.set(def.id, Math.min(def.cycleMs, Math.max(0, fill)));
    }
  }

  /**
   * Single accounting door for every payout: cash, cycle earnings and lifetime
   * earnings move together, so unlocks and the prestige gate can never drift
   * from the purse. Scenes call this for income the spec does not describe —
   * tap crits, event bonuses — instead of touching `cash` directly.
   */
  credit(amount: number): void {
    if (!(amount > 0)) return;
    this.cash += amount;
    this.totalEarned += amount;
    this.lifetimeEarned += amount;
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
