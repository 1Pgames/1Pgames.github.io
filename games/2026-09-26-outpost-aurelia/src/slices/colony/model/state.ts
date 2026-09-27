/**
 * `ColonyState` — the headless colony (PRD §4 Colony model, §16.1): grid
 * occupancy, stocks, buildings, the Lit Grid, power, production, colonists.
 * No Phaser. The scene and the sim drive the same instance through
 * `ColonyDirector`; the view reads `view()` plus the `fx` outbox.
 */
import { COLONY_TUNING } from '../tuning';
import {
  DIRECTIVES,
  DOCK_DEFAULT,
  GOODS,
  PROTOCOLS,
  buildingDef,
  type BuildingId,
  type DepositKind,
  type Edge,
  type Effect,
  type GoodId,
  type OrderTemplate,
  type RelicId,
  type SiteDef,
  type Stock,
} from '../content';
import type { AlertKind, BeaconState, BuildingInst, ColonyFx, ColonyPhase, ColonyView, LandingSetup, PlaceCheck, Ruin } from '../contracts';
import { generateSite, type SiteMap } from '../threat/terrain';
import { applyEffects, arkModifiers, colonyStat, createStatTotals, type StatTotals } from './modifiers';
import { computeField, nightTempC, tickDarkness } from './field';
import { capOf, mkIndex, tickProduction, workersOf } from './production';
import { nightForecastKw, solvePower } from './power';
import { bedsOf, staffBuildings, tickColonists } from './colonists';
import { noiseSum } from './noise';
import { canShip, shipOrder } from './requests';

export type {
  AlertKind,
  BeaconState,
  BuildingInst,
  ColonyFx,
  ColonyPhase,
  ColonyView,
  LandingSetup,
  PlaceCheck,
  Ruin,
} from '../contracts';

/** The clock the director writes into the state every frame. */
export interface ColonyClock { sol: number; phase: ColonyPhase; phaseLeftSec: number; tempC: number; elapsedSec: number; longNightSec: number }

/** State-side events the director forwards into its `ColonyEvent` stream. */
export type StateEvent =
  | { type: 'brownout'; uid: number }
  | { type: 'relic'; id: RelicId; col: number; row: number }
  | { type: 'placed'; building: BuildingId; uid: number }
  | { type: 'destroyed'; building: BuildingId; col: number; row: number }
  | { type: 'deaths'; count: number; reason: 'cold' | 'starve' }
  | { type: 'shipped'; slot: number; templateId: string; data: number }
  | { type: 'beacon'; state: BeaconState };

/** One Orbital Request on the board (`model/requests.ts` fills, resolves and expires these). */
export interface OrderSlot { slot: number; template: OrderTemplate; postedSol: number; expiresSol: number }

const FX_CAP = 256;


/** Tiles from the core centre to a 2×2 deposit's centre. */
function depositDistance(map: SiteMap, d: { col: number; row: number }): number {
  return Math.hypot(d.col + 1 - map.core.col, d.row + 1 - map.core.row);
}

/** Extractor that fits each deposit kind (idle-crew hint, Engineer Crate). */
const EXTRACTOR_FOR: Record<DepositKind, BuildingId> = { ore: 'ferrite_drill', ice: 'rime_borer', crystal: 'aurel_harvester', vent: 'vent_tap' };
/** Buildings a protocol's `'extractors'` target evolves (vent taps are power, not extraction). */
const EXTRACTORS: readonly BuildingId[] = ['ferrite_drill', 'rime_borer', 'aurel_harvester'];
/** Directives whose effect row includes "pings every pure deposit" (PRD §5.3 Deep Survey). */
const PINGS_PURE: Readonly<Record<string, true>> = { fr_survey: true };

export class ColonyState {
  readonly map: SiteMap;
  /** The Landing this colony was created for (site, rung, kit, Ark, daily). */
  readonly setup: LandingSetup;
  readonly site: SiteDef;
  readonly rung: number;
  /** Site + Severity temperature offset added to every sol's temperature. */
  readonly tempOffsetC: number;
  readonly stock: Record<GoodId, number>;
  colonists: number;
  morale: number;
  readonly buildings = new Map<number, BuildingInst>();
  readonly stats: StatTotals = createStatTotals();
  /** Owned directive ids, in pick order. */
  readonly owned: string[] = [];
  /** Evolved protocol ids, in pick order (their buildings are Apex, mk 4). */
  readonly evolved: string[] = [];

  /** Tile → building uid (0 = empty). */
  readonly occ: Int32Array;
  /** Tile → deposit index + 1 (0 = none). */
  readonly depositAt: Int16Array;
  /** Tile lit by the field (1) or dark (0). */
  readonly lit: Uint8Array;
  /** Tile ever revealed from fog. */
  readonly revealed: Uint8Array;
  litTiles = 0;
  /** Lit tiles that pay night heat (lit minus Slag Furnace heat-free tiles). */
  heatedTiles = 0;
  /** Scratch tile mask for field passes (no per-recompute allocation). */
  readonly scratch: Uint8Array;
  /** Relay uids held by a Static Leech (threat adds/deletes, then recomputes the field). */
  readonly latched = new Set<number>();
  /** Live, non-retreating fauna within 8 tiles of the lit field (threat writes each frame). */
  faunaNearField = 0;
  /** The director's verdict for `ColonyView.canSkipNight` (spawns done, nothing near the field). */
  nightClear = false;
  /** Alphas spawned tonight and still alive (the 'alpha' alert). */
  alphaAlive = 0;
  /** Bumps when the lit/revealed sets change (view redraws glow + fog). */
  fieldVersion = 0;
  /** Bumps when occupancy changes (view re-syncs the valid-tile glow). */
  buildVersion = 0;

  clock: ColonyClock = { sol: 1, phase: 'day', phaseLeftSec: 0, tempC: COLONY_TUNING.temp.dayC, elapsedSec: 0, longNightSec: 0 };

  kwSupply = 0;
  kwDemand = 0;
  bankKj = 0;
  bankCapKj = 0;
  /** Bank flow this tick: + discharging into the grid, − charging. */
  bankKw = 0;
  /** Production − consumption this tick per good (placements and refunds excluded). */
  readonly flow: Record<GoodId, number> = { ferrite: 0, ice: 0, aurelite: 0, rations: 0, alloy: 0, prism: 0, cell: 0 };
  /** Ring of per-tick flows over `hud.rateWindowSec` for `ColonyView.rates`. */
  private readonly flowRing: Array<Record<GoodId, number>> = [];
  private flowRingAt = 0;
  /** supply / demand after shedding, capped to 1: throttles every consumer. */
  powerRatio = 1;
  stress = 0;
  overdriveLeft = 0;
  shedTimer = 0;
  /** Seconds of steady headroom toward restoring shed consumers (brownout hysteresis). */
  consumerRestoreSec = 0;
  restoreTimer = 0;
  idleWorkers = 0;
  starving = false;
  /** Dawn arrivals still waking (not yet staffing) and the seconds left. */
  waking = 0;
  wakeLeftSec = 0;
  /** Draft rerolls left this Landing (free + Ark + relics + trophies + orders + kit). */
  rerolls = 0;
  /** Free Mk I → Mk II upgrades (Tinker Crate, Ore Tithe, `upgrade.freeMk2`). */
  mk2Tokens = 0;
  /** Free placements per building (order bonuses). */
  readonly freeBuilds = new Map<BuildingId, number>();
  /** Pure deposits (index) whose first extractor was already placed (Stake Claims). */
  readonly claimedPure = new Set<number>();
  /** Seconds shaved off the Beacon charge (Lumen Batch order). */
  beaconBonusSec = 0;

  beacon: BeaconState = 'locked';
  beaconCharge = 0;

  kills = 0;
  deathsTotal = 0;
  arrivalsTotal = 0;
  buildingsLostTonight = 0;
  matronsKilled = 0;
  coreHitAt = -99;
  /** The building the player is saving for (armed, or denied for cost); processors keep its price. Use `setWant`. */
  want: BuildingId | null = null;
  /** `clock.elapsedSec` after which `want` lapses. */
  wantUntilSec = 0;
  /** Relay Pylons the last dawn mend rebuilt from ruins (dawn toast). */
  lastRelinked = 0;
  /** Fe the last dawn mend spent (the dawn banner / ledger reads it). */
  lastMendCost = 0;

  readonly fx: ColonyFx[] = [];
  /** Destroyed buildings waiting for REBUILD (§5.1). */
  readonly ruins: Ruin[] = [];
  /** Orbital Request board (W1 `model/requests.ts` refills it at dawn from `requests.firstSol`). */
  readonly board: OrderSlot[] = [];
  /** Data earned by shipped orders this Landing (settled by `model/score.ts`). */
  ordersData = 0;
  /** Template ids of every completed order (sim trace). */
  readonly ordersDone: string[] = [];
  /** Data from claimed Signal Buoys (settled by `model/score.ts`). */
  relicData = 0;
  /** Tonight's telegraphed edges, set by the director at dusk start and cleared at dawn. */
  tonight: { edges: readonly Edge[]; totalFauna: number } | null = null;
  private lastDemolish: { def: BuildingId; col: number; row: number; mk: BuildingInst['mk']; hp: number; refund: Stock; atSec: number } | null = null;
  onStateEvent: ((e: StateEvent) => void) | null = null;

  private nextUid = 1;
  coreUid = 0;

  constructor(map: SiteMap, setup: LandingSetup) {
    this.map = map;
    this.setup = setup;
    this.site = setup.site;
    this.rung = setup.rung;
    this.tempOffsetC = setup.site.tempOffsetC + COLONY_TUNING.temp.perRungC * Math.max(0, setup.rung - 1);
    const n = map.cols * map.rows;
    this.scratch = new Uint8Array(n);
    this.occ = new Int32Array(n);
    this.depositAt = new Int16Array(n);
    this.lit = new Uint8Array(n);
    this.revealed = new Uint8Array(n);
    map.deposits.forEach((d, i) => {
      for (let dr = 0; dr < 2; dr += 1) for (let dc = 0; dc < 2; dc += 1) this.depositAt[(d.row + dr) * map.cols + d.col + dc] = i + 1;
    });
    const T = COLONY_TUNING;
    this.stock = { ferrite: T.start.ferrite, ice: 0, aurelite: 0, rations: T.start.rations, alloy: T.start.alloy, prism: 0, cell: 0 };
    this.colonists = T.colonists.start;
    this.morale = T.colonists.startMorale;
  }

  pushFx(fx: ColonyFx): void {
    if (this.fx.length < FX_CAP) this.fx.push(fx);
  }

  get core(): BuildingInst | undefined {
    return this.buildings.get(this.coreUid);
  }

  get isNight(): boolean {
    return this.clock.phase === 'night' || this.clock.phase === 'long-night';
  }

  tileIndex(col: number, row: number): number {
    return row * this.map.cols + col;
  }

  buildingAt(col: number, row: number): BuildingInst | undefined {
    if (col < 0 || row < 0 || col >= this.map.cols || row >= this.map.rows) return undefined;
    const uid = this.occ[this.tileIndex(col, row)] ?? 0;
    return uid === 0 ? undefined : this.buildings.get(uid);
  }

  /** Centre of a building in tile units (fractional for 2×2). */
  centreOf(b: BuildingInst): { col: number; row: number } {
    const f = buildingDef(b.def).footprint;
    return { col: b.col + f / 2, row: b.row + f / 2 };
  }

  /** Build price after directives / Ark (`relay.cost`, `hab.cost`, `pulse.cost`, `beacon.cost`); {} while a free-build token is held. */
  costOf(def: BuildingId): Stock {
    if ((this.freeBuilds.get(def) ?? 0) > 0) return {};
    const base = buildingDef(def).cost;
    const stat =
      def === 'relay_pylon' ? 'relay.cost' : def === 'hab_dome' ? 'hab.cost' : def === 'pulse_turret' ? 'pulse.cost' : def === 'beacon_spire' ? 'beacon.cost' : null;
    if (stat === null) return base;
    const out: Stock = {};
    for (const g of GOODS) {
      const v = base[g];
      if (v !== undefined) out[g] = Math.max(0, Math.round(colonyStat(this, stat, v)));
    }
    return out;
  }

  canAfford(cost: Stock): boolean {
    for (const g of GOODS) if ((cost[g] ?? 0) > this.stock[g]) return false;
    return true;
  }

  private pay(cost: Stock): void {
    for (const g of GOODS) this.stock[g] -= cost[g] ?? 0;
  }

  /** Placement rule (PRD §3 / §5.2): in bounds, unlocked, on open lit ground, extractors exactly on their deposit. */
  canPlace(def: BuildingId, col: number, row: number): PlaceCheck {
    const d = buildingDef(def);
    const f = d.footprint;
    const { cols, rows } = this.map;
    if (col < 0 || row < 0 || col + f > cols || row + f > rows) return { ok: false, why: 'bounds' };
    if ((def === 'beacon_spire' ? this.beaconUnlockSol : d.unlockSol) > this.clock.sol) return { ok: false, why: 'locked' };
    if (def === 'beacon_spire') {
      for (const b of this.buildings.values()) if (b.def === 'beacon_spire') return { ok: false, why: 'unique' };
    }
    for (let dr = 0; dr < f; dr += 1) {
      for (let dc = 0; dc < f; dc += 1) {
        const i = this.tileIndex(col + dc, row + dr);
        if (this.map.blocked[i] === 1 || this.occ[i] !== 0) return { ok: false, why: 'blocked' };
      }
    }
    if (d.deposit !== null) {
      const di = this.depositAt[this.tileIndex(col, row)] ?? 0;
      const dep = this.map.deposits[di - 1];
      if (dep === undefined || dep.kind !== d.deposit || dep.col !== col || dep.row !== row) return { ok: false, why: 'deposit' };
    } else {
      for (let dr = 0; dr < f; dr += 1) {
        for (let dc = 0; dc < f; dc += 1) if (this.depositAt[this.tileIndex(col + dc, row + dr)] !== 0) return { ok: false, why: 'deposit' };
      }
    }
    for (let dr = 0; dr < f; dr += 1) {
      for (let dc = 0; dc < f; dc += 1) if (this.lit[this.tileIndex(col + dc, row + dr)] !== 1) return { ok: false, why: 'dark' };
    }
    const cost = this.pureClaimFree(def, col, row) ? {} : this.costOf(def);
    if (!this.canAfford(cost)) return { ok: false, why: 'afford' };
    return { ok: true, cost };
  }

  /** Stake Claims: the first extractor on each pure deposit costs nothing. */
  private pureClaimFree(def: BuildingId, col: number, row: number): boolean {
    if (!EXTRACTORS.includes(def) || colonyStat(this, 'extract.pureFirstFree', 0) <= 0) return false;
    const di = this.depositAt[this.tileIndex(col, row)] ?? 0;
    return this.map.deposits[di - 1]?.purity === 2 && !this.claimedPure.has(di - 1);
  }

  /**
   * The host calls this when the player arms a building or is denied one for
   * cost: processors then keep that building's price in stock for
   * `production.wantHoldSec` (refreshed by every call). Cleared by placing it or `null`.
   */
  setWant(def: BuildingId | null): void {
    this.want = def;
    this.wantUntilSec = this.clock.elapsedSec + COLONY_TUNING.production.wantHoldSec;
  }

  /** `want` while it is fresh, else null. */
  get activeWant(): BuildingId | null {
    return this.want !== null && this.clock.elapsedSec <= this.wantUntilSec ? this.want : null;
  }

  place(def: BuildingId, col: number, row: number): BuildingInst | null {
    const check = this.canPlace(def, col, row);
    if (!check.ok) return null;
    const token = this.freeBuilds.get(def) ?? 0;
    if (token > 0 && Object.keys(check.cost).length === 0) this.freeBuilds.set(def, token - 1);
    this.pay(check.cost);
    if (buildingDef(def).deposit !== null) {
      const di = this.depositAt[this.tileIndex(col, row)] ?? 0;
      if (this.map.deposits[di - 1]?.purity === 2) this.claimedPure.add(di - 1);
    }
    const b = this.spawnBuilding(def, col, row);
    if (this.want === def) this.want = null;
    this.pushFx({ kind: 'placed', uid: b.uid });
    this.onStateEvent?.({ type: 'placed', building: def, uid: b.uid });
    return b;
  }

  /** Puts a building down without cost or rules (core, pre-placed hab). */
  spawnBuilding(def: BuildingId, col: number, row: number): BuildingInst {
    const d = buildingDef(def);
    const di = this.depositAt[this.tileIndex(col, row)] ?? 0;
    const dep = d.deposit !== null ? this.map.deposits[di - 1] : undefined;
    const maxHp = Math.round(def === 'plate_barricade' ? colonyStat(this, 'wall.hp', d.hp) : def === 'lander_core' ? colonyStat(this, 'core.hp', d.hp) : d.hp);
    const b: BuildingInst = {
      uid: this.nextUid,
      def,
      col,
      row,
      mk: 1,
      hp: maxHp,
      lit: false,
      darkSec: 0,
      staffed: 0,
      paused: false,
      pinned: false,
      cycle: 0,
      maxHp,
      shed: false,
      frozen: false,
      working: false,
      purity: dep?.purity ?? 1,
      fireCd: 0,
      coldSec: 0,
    };
    this.nextUid += 1;
    if (this.isApex(def)) this.setMk(b, 4);
    this.buildings.set(b.uid, b);
    for (let dr = 0; dr < d.footprint; dr += 1) {
      for (let dc = 0; dc < d.footprint; dc += 1) this.occ[this.tileIndex(col + dc, row + dr)] = b.uid;
    }
    for (let i = this.ruins.length - 1; i >= 0; i -= 1) {
      const r = this.ruins[i];
      if (r === undefined) continue;
      const rf = buildingDef(r.def).footprint;
      if (r.col < col + d.footprint && col < r.col + rf && r.row < row + d.footprint && row < r.row + rf) this.ruins.splice(i, 1);
    }
    if (def === 'beacon_spire' && (this.beacon === 'unbuilt' || this.beacon === 'locked')) {
      this.beacon = 'ready';
      this.onStateEvent?.({ type: 'beacon', state: 'ready' });
    }
    this.buildVersion += 1;
    computeField(this);
    return b;
  }

  /** True when an evolved protocol targets this building type (placed and upgraded as Apex, mk 4). */
  isApex(def: BuildingId): boolean {
    for (const id of this.evolved) {
      const p = PROTOCOLS.find((x) => x.id === id);
      if (p !== undefined && (p.building === def || (p.building === 'extractors' && EXTRACTORS.includes(def)))) return true;
    }
    return false;
  }

  /** Next-Mk price; {} while a free Mk II token applies; null at Mk III / Apex or for the core. */
  upgradeCost(uid: number): Stock | null {
    const b = this.buildings.get(uid);
    if (b === undefined || b.def === 'lander_core' || b.mk >= 3) return null;
    if (b.mk === 1 && this.mk2Tokens > 0) return {};
    const costMul: readonly number[] = COLONY_TUNING.production.mkCostMul;
    const mul = costMul[b.mk] ?? 1;
    const base = buildingDef(b.def).cost;
    const out: Stock = {};
    for (const g of GOODS) {
      const v = base[g];
      if (v !== undefined) out[g] = Math.round(colonyStat(this, 'upgrade.cost', v * mul));
    }
    return out;
  }

  upgrade(uid: number): boolean {
    const b = this.buildings.get(uid);
    const cost = this.upgradeCost(uid);
    if (b === undefined || cost === null || !this.canAfford(cost)) return false;
    if (b.mk === 1 && this.mk2Tokens > 0) this.mk2Tokens -= 1;
    this.pay(cost);
    this.setMk(b, (b.mk + 1) as BuildingInst['mk']);
    this.buildVersion += 1;
    return true;
  }

  /** Removes a building, refunding half its build cost. The core cannot be demolished. */
  demolish(uid: number): Stock {
    const b = this.buildings.get(uid);
    if (b === undefined || b.def === 'lander_core') return {};
    const refund: Stock = {};
    const cost = buildingDef(b.def).cost;
    for (const g of GOODS) {
      const v = cost[g];
      if (v === undefined) continue;
      const back = Math.floor(v / 2);
      refund[g] = back;
      this.stock[g] = Math.min(capOf(this, g), this.stock[g] + back);
    }
    this.lastDemolish = { def: b.def, col: b.col, row: b.row, mk: b.mk, hp: b.hp, refund, atSec: this.clock.elapsedSec };
    this.removeBuilding(b);
    return refund;
  }

  get canUndoDemolish(): boolean {
    const last = this.lastDemolish;
    return last !== null && this.clock.elapsedSec - last.atSec <= COLONY_TUNING.input.undoDemolishSec && this.canAfford(last.refund);
  }

  /** Restores the last demolish inside its UNDO window: takes the refund back, same tile, Mk and hp. */
  undoDemolish(): boolean {
    const last = this.lastDemolish;
    if (last === null || !this.canUndoDemolish) return false;
    const f = buildingDef(last.def).footprint;
    for (let dr = 0; dr < f; dr += 1) {
      for (let dc = 0; dc < f; dc += 1) if (this.occ[this.tileIndex(last.col + dc, last.row + dr)] !== 0) return false;
    }
    this.pay(last.refund);
    const b = this.spawnBuilding(last.def, last.col, last.row);
    this.setMk(b, last.mk);
    b.hp = Math.min(b.maxHp, last.hp);
    this.lastDemolish = null;
    return true;
  }

  /** Living Wall (`wall.dawnRebuild`): destroyed barricades stand again for free at dawn, at their old Mk. Returns how many. */
  dawnRebuildWalls(): number {
    if (colonyStat(this, 'wall.dawnRebuild', 0) <= 0) return 0;
    let n = 0;
    for (const r of [...this.ruins]) {
      if (r.def !== 'plate_barricade') continue;
      const i = this.tileIndex(r.col, r.row);
      if (this.map.blocked[i] === 1 || this.occ[i] !== 0) continue;
      const b = this.spawnBuilding(r.def, r.col, r.row);
      this.setMk(b, r.mk);
      n += 1;
    }
    return n;
  }

  /**
   * Dawn relink (critic build4): rebuilds Relay Pylon ruins at
   * `mend.rebuildCostRatio` × their Fe price, innermost first so chains
   * relight in order, while each fits the Fe `budget`. Returns the count and
   * Fe spent; emits no `placed` (it is not a player placement).
   */
  relinkRelays(budget: number): { rebuilt: number; spent: number } {
    let rebuilt = 0;
    let spent = 0;
    const core = this.map.core;
    const ruins = this.ruins.filter((r) => r.def === 'relay_pylon').sort((a, b) => Math.hypot(a.col - core.col, a.row - core.row) - Math.hypot(b.col - core.col, b.row - core.row));
    let progress = true;
    while (progress) {
      progress = false;
      for (const r of ruins) {
        if (!this.ruins.includes(r)) continue;
        const i = this.tileIndex(r.col, r.row);
        if (this.map.blocked[i] === 1 || this.occ[i] !== 0 || this.lit[i] !== 1) continue;
        const fe = Math.ceil((this.costOf('relay_pylon').ferrite ?? 0) * COLONY_TUNING.mend.rebuildCostRatio);
        if (fe > budget - spent || fe > this.stock.ferrite) continue;
        this.stock.ferrite -= fe;
        spent += fe;
        const b = this.spawnBuilding('relay_pylon', r.col, r.row);
        this.setMk(b, r.mk);
        rebuilt += 1;
        progress = true;
      }
    }
    return { rebuilt, spent };
  }

  /** Upgrades every building of a type, cheapest-first, while affordable; returns how many rose a Mk. */
  upgradeAll(def: BuildingId): number {
    const list = [...this.buildings.values()].filter((b) => b.def === def).sort((a, b) => a.mk - b.mk || a.uid - b.uid);
    let n = 0;
    for (const b of list) if (this.upgrade(b.uid)) n += 1;
    return n;
  }

  /** REBUILD a ruin covering (col, row) at `mend.rebuildCostRatio` × build cost, back at its old Mk. */
  rebuild(col: number, row: number): BuildingInst | null {
    const i = this.ruins.findIndex((r) => {
      const f = buildingDef(r.def).footprint;
      return col >= r.col && col < r.col + f && row >= r.row && row < r.row + f;
    });
    const ruin = this.ruins[i];
    if (ruin === undefined) return null;
    const check = this.canPlace(ruin.def, ruin.col, ruin.row);
    if (!check.ok && check.why !== 'afford') return null;
    const cost: Stock = {};
    const base = this.costOf(ruin.def);
    for (const g of GOODS) {
      const v = base[g];
      if (v !== undefined) cost[g] = Math.ceil(v * COLONY_TUNING.mend.rebuildCostRatio);
    }
    if (!this.canAfford(cost)) return null;
    this.pay(cost);
    const b = this.spawnBuilding(ruin.def, ruin.col, ruin.row);
    this.setMk(b, ruin.mk);
    this.onStateEvent?.({ type: 'placed', building: b.def, uid: b.uid });
    return b;
  }

  /** SHIP an order (one tap): deducts its goods, pays Data + bonus (`model/requests.ts`). Condition orders complete on their own. */
  shipOrder(slot: number): boolean {
    return shipOrder(this, slot);
  }

  /** Raises a building to `mk` (4 = Apex, which runs on the Mk III rows), scaling hp by the Mk hp table. */
  private setMk(b: BuildingInst, mk: BuildingInst['mk']): void {
    if (mk <= b.mk) return;
    const hpMul = COLONY_TUNING.production.mkHpMul;
    const grown = Math.round((b.maxHp * hpMul[mkIndex(mk)]) / hpMul[mkIndex(b.mk)]);
    b.hp += grown - b.maxHp;
    b.maxHp = grown;
    b.mk = mk;
  }

  setPaused(uid: number, paused: boolean): void {
    const b = this.buildings.get(uid);
    if (b === undefined || b.def === 'lander_core') return;
    b.paused = paused;
  }

  setPinned(uid: number, pinned: boolean): void {
    const b = this.buildings.get(uid);
    if (b === undefined || b.def !== 'relay_pylon') return;
    b.pinned = pinned;
    if (pinned && b.shed) {
      b.shed = false;
      computeField(this);
    }
  }

  /** Core Overdrive (PRD §7 power.overdrive*): ×1.5 core kW for 10 s, +34 % stress; full stress breaks the core. */
  overdrive(): boolean {
    if (this.overdriveLeft > 0) return false;
    const P = COLONY_TUNING.power;
    this.overdriveLeft = colonyStat(this, 'power.overdriveSec', P.overdriveSec);
    this.stress += colonyStat(this, 'power.overdriveStress', P.overdriveStress);
    if (this.stress >= 1) {
      this.stress -= 1;
      const core = this.core;
      if (core !== undefined) this.damage(core, P.stressBreakDamage);
    }
    return true;
  }

  /** Applies a picked directive's effects; returns false if it was already owned. */
  own(directiveId: string): boolean {
    if (this.owned.includes(directiveId)) return false;
    const def = DIRECTIVES.find((d) => d.id === directiveId);
    if (def === undefined) return false;
    this.owned.push(directiveId);
    this.applyStatEffects(def.effects);
    if (PINGS_PURE[directiveId] === true) this.pingPure(Number.POSITIVE_INFINITY);
    return true;
  }

  /**
   * Evolves a protocol (PRD §5.3): applies its effects and turns every
   * matching building (and every later one) into its Apex, mk 4. False when
   * unknown or already evolved.
   */
  evolve(protocolId: string): boolean {
    if (this.evolved.includes(protocolId)) return false;
    const p = PROTOCOLS.find((x) => x.id === protocolId);
    if (p === undefined) return false;
    this.evolved.push(protocolId);
    for (const b of this.buildings.values()) if (this.isApex(b.def)) this.setMk(b, 4);
    this.applyStatEffects(p.effects);
    this.buildVersion += 1;
    return true;
  }

  /** Folds effects into the stat totals, then refreshes stats read at placement time (wall hp) and the field. */
  private applyStatEffects(effects: readonly Effect[]): void {
    applyEffects(this.stats, effects);
    const hpMul = COLONY_TUNING.production.mkHpMul;
    for (const b of this.buildings.values()) {
      if (b.def !== 'plate_barricade') continue;
      const grown = Math.round(colonyStat(this, 'wall.hp', buildingDef('plate_barricade').hp) * hpMul[mkIndex(b.mk)]);
      b.hp += grown - b.maxHp;
      b.maxHp = grown;
    }
    computeField(this);
  }

  /** Reveals up to `count` unrevealed pure deposits, nearest first (Deep Survey, Surveyor Crate, Survey Samples). */
  pingPure(count: number): number {
    const pure = this.map.deposits
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => d.purity === 2 && this.revealed[this.tileIndex(d.col, d.row)] !== 1)
      .sort((a, b) => depositDistance(this.map, a.d) - depositDistance(this.map, b.d) || a.i - b.i);
    let n = 0;
    for (const { d } of pure) {
      if (n >= count) break;
      for (let dr = 0; dr < 2; dr += 1) for (let dc = 0; dc < 2; dc += 1) this.revealed[this.tileIndex(d.col + dc, d.row + dr)] = 1;
      n += 1;
    }
    if (n > 0) this.fieldVersion += 1;
    return n;
  }

  /** Damage from fauna or overdrive. Returns true when the building was destroyed. */
  damage(b: BuildingInst, amount: number): boolean {
    if (amount <= 0 || !this.buildings.has(b.uid)) return false;
    b.hp -= amount;
    if (b.def === 'lander_core' && Math.round((b.hp / b.maxHp) * 100) < 100) this.coreHitAt = this.clock.elapsedSec;
    if (b.hp > 0) return false;
    if (b.def === 'lander_core') {
      b.hp = 0;
      return true;
    }
    this.buildingsLostTonight += 1;
    this.pushFx({ kind: 'destroyed', def: b.def, col: b.col, row: b.row });
    this.ruins.push({ def: b.def, col: b.col, row: b.row, mk: b.mk });
    this.onStateEvent?.({ type: 'destroyed', building: b.def, col: b.col, row: b.row });
    this.removeBuilding(b);
    return true;
  }

  private removeBuilding(b: BuildingInst): void {
    const f = buildingDef(b.def).footprint;
    for (let dr = 0; dr < f; dr += 1) for (let dc = 0; dc < f; dc += 1) this.occ[this.tileIndex(b.col + dc, b.row + dr)] = 0;
    this.buildings.delete(b.uid);
    this.latched.delete(b.uid);
    if (b.def === 'beacon_spire' && this.beacon !== 'launched') {
      // Spire lost (mid-charge too): the charge aborts, spent cells stay spent (PRD §2 endings).
      this.beacon = this.clock.sol >= this.beaconUnlockSol ? 'unbuilt' : 'locked';
      this.beaconCharge = 0;
      this.onStateEvent?.({ type: 'beacon', state: this.beacon });
    }
    this.buildVersion += 1;
    computeField(this);
    // A lost or demolished Cargo Silo shrinks the cap: the overflow is lost.
    this.clampStock();
  }

  /**
   * Storage invariant (cert `invariant`): every good ≤ `capOf`. Anything that
   * can raise stock past its cap — relic and kit grants, a shrinking cap,
   * threat-side salvage — ends in this clamp; the overflow is lost.
   */
  clampStock(): void {
    for (const g of GOODS) {
      const cap = capOf(this, g);
      if (this.stock[g] > cap) this.stock[g] = cap;
    }
  }

  /** Sol the Beacon Spire unlocks (`beacon.unlockSol`, Launch Window −1). */
  get beaconUnlockSol(): number {
    return Math.round(colonyStat(this, 'beacon.unlockSol', COLONY_TUNING.beacon.unlockSol));
  }

  /** Lumen Cells one Beacon charge consumes (`beacon.cellsToCharge` × `beacon.cost`). */
  get cellsNeeded(): number {
    return Math.max(0, Math.round(colonyStat(this, 'beacon.cost', COLONY_TUNING.beacon.cellsToCharge)));
  }

  /** One model step (PRD §15: power, production and colonists at 4 Hz). */
  tick(dt: number): void {
    for (const g of GOODS) this.flow[g] = 0;
    solvePower(this, dt);
    staffBuildings(this);
    tickProduction(this, dt);
    tickColonists(this, dt);
    tickDarkness(this, dt);
    // Night Mend: lit buildings regrow `building.nightRegenPct` % of max hp per second at night.
    const regen = colonyStat(this, 'building.nightRegenPct', 0);
    if (regen > 0 && this.isNight) {
      for (const b of this.buildings.values()) if (b.lit && b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + (b.maxHp * regen * dt) / 100);
    }
    if (this.beacon === 'charging') {
      const sec = Math.max(1, colonyStat(this, 'beacon.chargeSec', COLONY_TUNING.beacon.chargeSec) - this.beaconBonusSec);
      this.beaconCharge = Math.min(1, this.beaconCharge + (dt * this.powerRatio) / sec);
    }
    const slots = Math.max(1, Math.round(COLONY_TUNING.hud.rateWindowSec / dt));
    const sample = { ...this.flow };
    if (this.flowRing.length < slots) this.flowRing.push(sample);
    else this.flowRing[this.flowRingAt % slots] = sample;
    this.flowRingAt += 1;
    this.clampStock();
  }

  /** Net per-second rate of each good over the rolling window (PRD §14 ResourceStrip ±r/s). */
  rates(): Record<GoodId, number> {
    const out = { ferrite: 0, ice: 0, aurelite: 0, rations: 0, alloy: 0, prism: 0, cell: 0 };
    if (this.flowRing.length === 0) return out;
    const span = this.flowRing.length * COLONY_TUNING.power.tickSec;
    for (const f of this.flowRing) for (const g of GOODS) out[g] += f[g];
    for (const g of GOODS) out[g] /= span;
    return out;
  }

  get beds(): number {
    let n = 0;
    for (const b of this.buildings.values()) n += bedsOf(this, b);
    return n;
  }

  /**
   * Where idle hands could work right now, or null when nothing is actionable:
   * a paused building that wants seats, else a lit, free deposit whose
   * extractor is unlocked and affordable.
   */
  private idleTarget(): { col: number; row: number; uid: number | null } | null {
    for (const b of this.buildings.values()) {
      if (b.paused && b.lit && workersOf(this, buildingDef(b.def)) > 0) return { col: b.col, row: b.row, uid: b.uid };
    }
    let best: { col: number; row: number; d: number } | null = null;
    for (const dep of this.map.deposits) {
      const def = EXTRACTOR_FOR[dep.kind];
      if (buildingDef(def).workers <= 0 || !this.canPlace(def, dep.col, dep.row).ok) continue;
      const d = depositDistance(this.map, dep);
      if (best === null || d < best.d) best = { col: dep.col, row: dep.row, d };
    }
    return best === null ? null : { col: best.col, row: best.row, uid: null };
  }

  view(): ColonyView {
    const caps = {} as Record<GoodId, number>;
    for (const g of GOODS) caps[g] = capOf(this, g);
    const alerts: Array<{ kind: AlertKind; col: number; row: number; uid: number | null }> = [];
    const MAX_ALERTS = 2;
    const core = this.map.core;
    const hull = this.core;
    // Only a real, visible hit: the core is below 100 % and was damaged in the last 3 s.
    if (this.clock.elapsedSec - this.coreHitAt < 3 && hull !== undefined && Math.round((hull.hp / hull.maxHp) * 100) < 100) alerts.push({ kind: 'core', col: core.col, row: core.row, uid: this.coreUid });
    if (this.isNight && this.alphaAlive > 0) alerts.push({ kind: 'alpha', col: core.col, row: core.row, uid: null });
    if (this.starving) alerts.push({ kind: 'starve', col: core.col, row: core.row, uid: null });
    for (const uid of this.latched) {
      const b = this.buildings.get(uid);
      if (alerts.length >= MAX_ALERTS) break;
      if (b !== undefined) alerts.push({ kind: 'leech', col: b.col, row: b.row, uid });
    }
    if (this.isNight) {
      for (const b of this.buildings.values()) {
        if (alerts.length >= MAX_ALERTS) break;
        if (b.def === 'hab_dome' && !b.lit) alerts.push({ kind: 'cold', col: b.col, row: b.row, uid: b.uid });
      }
      for (const b of this.buildings.values()) {
        if (alerts.length >= MAX_ALERTS) break;
        if (b.shed) alerts.push({ kind: 'dark', col: b.col, row: b.row, uid: b.uid });
      }
    } else {
      if (alerts.length < MAX_ALERTS && this.board.some((o) => canShip(this, o))) alerts.push({ kind: 'order', col: core.col, row: core.row, uid: null });
      if (alerts.length < MAX_ALERTS && this.idleWorkers > 0) {
        const t = this.idleTarget();
        if (t !== null) alerts.push({ kind: 'idle', ...t });
      }
    }
    let needed = 0;
    let staffed = 0;
    const unstaffed: number[] = [];
    for (const b of this.buildings.values()) {
      const w = workersOf(this, buildingDef(b.def));
      if (w <= 0 || !b.lit || b.paused) continue;
      needed += w;
      staffed += b.staffed;
      if (b.staffed < w) unstaffed.push(b.uid);
    }
    return {
      sol: this.clock.sol,
      phase: this.clock.phase,
      phaseLeftSec: this.clock.phaseLeftSec,
      tempC: this.clock.tempC,
      stock: this.stock,
      caps,
      kwSupply: this.kwSupply,
      kwDemand: this.kwDemand,
      bankKj: this.bankKj,
      bankCapKj: this.bankCapKj,
      rates: this.rates(),
      kwNightForecast: nightForecastKw(this),
      colonists: this.colonists,
      beds: this.beds,
      morale: this.morale,
      stress: this.stress,
      litTiles: this.litTiles,
      noise: noiseSum(this),
      beaconState: this.beacon,
      beaconCharge: this.beaconCharge,
      cellsNeeded: this.cellsNeeded,
      staffing: { needed, staffed, idle: this.idleWorkers, unstaffed },
      tonight: this.tonight,
      alerts,
      board: this.board.map((o) => ({ slot: o.slot, templateId: o.template.id, expiresSol: o.expiresSol, shippable: canShip(this, o) })),
      ruins: this.ruins,
      canUndoDemolish: this.canUndoDemolish,
      canSkipNight: this.nightClear,
      dockSuggest: DOCK_DEFAULT,
    };
  }
}

/** First open, lit, deposit-free f×f spot among `spots` (null when none fits). */
function openSpot(state: ColonyState, spots: ReadonlyArray<readonly [number, number]>, f: number): readonly [number, number] | null {
  for (const spot of spots) {
    const [c, r] = spot;
    let open = c >= 0 && r >= 0 && c + f <= state.map.cols && r + f <= state.map.rows;
    for (let dr = 0; dr < f && open; dr += 1) {
      for (let dc = 0; dc < f; dc += 1) {
        const i = state.tileIndex(c + dc, r + dr);
        if (state.map.blocked[i] === 1 || state.occ[i] !== 0 || state.depositAt[i] !== 0 || state.lit[i] !== 1) {
          open = false;
          break;
        }
      }
    }
    if (open) return spot;
  }
  return null;
}

/** Spots hugging the core for a 2×2 dome, nearest ring first. */
function domeSpots(core: { col: number; row: number }): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [
    [core.col + 2, core.row - 1],
    [core.col - 3, core.row - 1],
    [core.col - 1, core.row + 2],
    [core.col - 1, core.row - 3],
  ];
  for (let ring = 3; ring <= 5; ring += 1) {
    for (let d = -ring; d <= ring; d += 1) out.push([core.col + d, core.row - ring - 1], [core.col + d, core.row + ring], [core.col - ring - 1, core.row + d], [core.col + ring, core.row + d]);
  }
  return out;
}

/** Tiles 3-5 out on the side of the core with the most lit deposits (where industry, and noise, will grow). */
function busySideSpots(state: ColonyState): Array<readonly [number, number]> {
  const { map } = state;
  const q = [0, 0, 0, 0];
  for (const d of map.deposits) {
    if (state.lit[state.tileIndex(d.col, d.row)] !== 1) continue;
    const dx = d.col + 1 - map.core.col;
    const dy = d.row + 1 - map.core.row;
    const e = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
    q[e] = (q[e] ?? 0) + 1;
  }
  const edge = q.indexOf(Math.max(...q));
  const [ex, ey] = [[0, -1], [1, 0], [0, 1], [-1, 0]][edge] ?? [0, -1];
  const tiles: Array<readonly [number, number]> = [];
  for (let k = 3; k <= 5; k += 1) for (const lat of [-2, 2, -1, 1, -3, 3, 0]) tiles.push([map.core.col + (ex ?? 0) * k + (ey !== 0 ? lat : 0), map.core.row + (ey ?? 0) * k + (ex !== 0 ? lat : 0)]);
  return tiles;
}

/** Pre-builds one kit building by its placement rule; false when no spot fits. */
function placeKitBuilding(state: ColonyState, id: BuildingId): boolean {
  const def = buildingDef(id);
  const { map } = state;
  if (def.deposit !== null) {
    const d = map.deposits
      .filter((dep) => dep.kind === def.deposit && state.canPlace(id, dep.col, dep.row).ok)
      .sort((a, b) => depositDistance(map, a) - depositDistance(map, b))[0];
    if (d === undefined) return false;
    state.spawnBuilding(id, d.col, d.row);
    return true;
  }
  const spot = openSpot(state, def.category === 'defense' ? busySideSpots(state) : domeSpots(map.core), def.footprint);
  if (spot === null) return false;
  state.spawnBuilding(id, spot[0], spot[1]);
  return true;
}

/**
 * Seeds the site and lands the colony (PRD §5.1, §5.3 kits, §5.4 sites, §10):
 * Ark + Refit effects, site purity shift and Core Samplers, start stock and
 * morale, the Lander Core, one Hab Dome, then the Landing Kit.
 */
export function createColony(setup: LandingSetup): ColonyState {
  const T = COLONY_TUNING;
  const map = generateSite(setup.site, setup.rung, setup.seed, setup.size);
  const state = new ColonyState(map, setup);
  applyEffects(state.stats, arkModifiers(setup.ark, setup.refit));
  // Site purity shift (Rimewater ice +1 tier, Sulfur Hollow ore +1 tier).
  for (const d of map.deposits) {
    const shift = setup.site.purityShift[d.kind] ?? 0;
    if (shift !== 0) d.purity = Math.max(0, Math.min(2, d.purity + shift)) as 0 | 1 | 2;
  }
  // Core Samplers: the nearest non-pure deposits outside the inner ring become pure.
  const extraPure = Math.max(0, Math.round(colonyStat(state, 'deposit.purePerSite', 0)));
  const candidates = map.deposits.filter((d) => d.purity < 2 && depositDistance(map, d) >= T.field.coreRadius + 2).sort((a, b) => depositDistance(map, a) - depositDistance(map, b));
  for (const d of candidates.slice(0, extraPure)) d.purity = 2;

  state.stock.ferrite = Math.max(0, Math.round(colonyStat(state, 'start.ferrite', T.start.ferrite)));
  state.morale = colonyStat(state, 'morale.start', T.colonists.startMorale);
  state.rerolls = Math.max(0, Math.round(colonyStat(state, 'draft.rerolls', T.draft.freeRerolls)));
  state.mk2Tokens = Math.max(0, Math.round(colonyStat(state, 'upgrade.freeMk2', 0)));
  state.clock.tempC = nightTempC(1, 'day', 0, state.tempOffsetC);
  const core = state.spawnBuilding('lander_core', map.core.col - 1, map.core.row - 1);
  state.coreUid = core.uid;
  const spots = domeSpots(map.core);
  const dome = openSpot(state, spots, 2);
  if (dome !== null) state.spawnBuilding('hab_dome', dome[0], dome[1]);

  // Landing Kit crate (`data/kits.ts` `grant`).
  const g = setup.kit.grant;
  state.stock.ferrite += g.fe ?? 0;
  state.colonists += g.colonists ?? 0;
  state.rerolls += g.rerolls ?? 0;
  state.mk2Tokens += g.mk2Tokens ?? 0;
  if (g.place !== undefined) for (let n = 0; n < g.place.count; n += 1) placeKitBuilding(state, g.place.id);
  if (g.fogTiles !== undefined) {
    applyEffects(state.stats, [{ stat: 'fog.revealTiles', add: g.fogTiles }]);
    computeField(state);
  }
  state.clampStock();
  if (g.pingPure === true) {
    computeField(state);
    state.pingPure(Number.POSITIVE_INFINITY);
  }
  return state;
}
