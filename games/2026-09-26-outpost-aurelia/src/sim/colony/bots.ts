/**
 * Colony sim brain (PRD §8 variety routes, §19 gates): the headless player
 * `runLanding` seats. One shared builder runs every lane; the lane's
 * `Profile` (`lanes.ts`) says WHAT it wants, sol by sol, and placement
 * legality is always `ColonyState.canPlace` — the rule the scene enforces.
 *
 * What a skilled lane does, in priority order each decision: ship a ready
 * order; keep two drills; at dusk, the defence floor on tonight's edges
 * (`guardEdges`); feed the colony; rebuild last night's ruins; beds;
 * tonight's power; the lane's plan (builds and Mk upgrades). Every want that
 * cannot be met enters its WHOLE bill in a reservation ledger (`hold`), so
 * lower wants and upgrades spend only what is left above it; a plan row wanted
 * before its building unlocks saves its bill. The novice follows its
 * coach-ordered plan with some slack. Deposits outside
 * the field are reached by ONE committed relay route at a time, so relays are
 * never spread across half-finished chases. Grid management (`manage`) runs
 * every tick: smelters burn only the Fe above the ledger (down to the first
 * want short of alloy) and idle once the plan's alloy is stocked, processors
 * pause at dusk when tonight's margin is short, foundries stop once the
 * Beacon's cells are stocked, and everything but the guns pauses while the
 * Beacon charges.
 *
 * Pure TypeScript, no Phaser; every random draw goes through a seeded `Rng`.
 */
import { Rng } from '../../core/rng';
import { COLONY_TUNING } from '../../slices/colony/tuning';
import {
  BUILDINGS,
  DIRECTIVES,
  GOODS,
  ORDERS,
  PROTOCOLS,
  buildingDef,
  type BuildingId,
  type DepositKind,
  type Edge,
  type Stock,
  type TagId,
} from '../../slices/colony/content';
import type { ColonyView } from '../../slices/colony/contracts';
import type { BuildingInst, ColonyState } from '../../slices/colony/model/state';
import { profileFor, type LaneLabel, type PerSol, type Profile, type Want } from './lanes';
import type { LaneId, LanePolicy } from './types';

/** Building rows present in the content table (a plan row whose building is not authored is skipped). */
const AUTHORED = new Set<BuildingId>(BUILDINGS.map((b) => b.id));
const DEFENSE: Partial<Record<BuildingId, true>> = { pulse_turret: true, arc_coil: true, flak_mortar: true };
/** A gun's worth in Mk I pulses (before its Mk damage multiplier). */
const GUN_WEIGHT: Partial<Record<BuildingId, number>> = { pulse_turret: 1, arc_coil: 2, flak_mortar: 2 };
/** Tiles from a front building a gun counts as guarding it (pulse range 4.5, less the building's half-width). */
const GUARD_REACH = 3.5;
/** Processors a skilled lane pauses at dusk when tonight's margin is short, cheapest loss first. */
const PAUSABLE: readonly BuildingId[] = ['alloy_smelter', 'prism_cutter', 'lumen_foundry', 'aurel_harvester', 'hearth_commons'];
const EXTRACTORS: readonly BuildingId[] = ['ferrite_drill', 'rime_borer', 'aurel_harvester'];

/** Beacon-chain jobs a smelter crew makes way for. */
const CHAIN: Partial<Record<BuildingId, true>> = { aurel_harvester: true, prism_cutter: true, lumen_foundry: true };
/** Relays an urgent chase (food, tonight's power) may add above the lane's budget. */
const URGENT_RELAYS = 2;
/**
 * Relays the protocol chase (variety lane) may add above the lane's budget for crystal: Geode Rig needs 4
 * harvesters on patches 10-30 tiles out, and the budget was spent on the ore/ice/relic routes first
 * (draft.selftest: p_geode evolved 0-1× in 500 Landings, max 2 harvesters ever standing).
 */
const CHASE_CRYSTAL_RELAYS = 6;
/** Farthest deposit (tiles from the core) an urgent chase walks to: the ring-2 pair, not a trek. */
const URGENT_REACH = 12;
const TAGS: readonly TagId[] = ['hearth', 'forge', 'bulwark', 'frontier', 'kin', 'orbit'];
/** Fe a smelter needs above the ledger to start a cycle (one recipe's input, plus a spare cycle). */
const SMELT_FE = 4;
/** Alloy below which a smelter takes a drill's crew (`manageGrid`): a pulse, a hab and a Spire all need alloy. */
const ALLOY_STARVED = 20;
const DIRS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Offsets sorted by distance: the spiral every "nearest free spot" search walks. */
const SPIRAL: ReadonlyArray<readonly [number, number]> = (() => {
  const out: Array<[number, number]> = [];
  for (let dy = -14; dy <= 14; dy += 1) for (let dx = -14; dx <= 14; dx += 1) if (dx * dx + dy * dy <= 196) out.push([dx, dy]);
  return out.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
})();

function at(table: PerSol, sol: number): number {
  return table[Math.min(sol, table.length) - 1] ?? table[table.length - 1] ?? 0;
}

/** Affordable with `reserved` goods held back for a blocked higher-priority want. */
function affordable(state: ColonyState, cost: Stock, reserved: Stock): boolean {
  for (const g of GOODS) {
    const need = cost[g] ?? 0;
    if (need > 0 && need > state.stock[g] - (reserved[g] ?? 0)) return false;
  }
  return true;
}

/**
 * The reservation ledger: a want that cannot be met holds back its WHOLE bill
 * (Fe, alloy, prism…), so every lower-priority want, Mk upgrade and smelter
 * works only with what is left above it.
 */
function reserve(cost: Stock, reserved: Stock): void {
  for (const g of GOODS) {
    const need = cost[g] ?? 0;
    if (need > 0) reserved[g] = (reserved[g] ?? 0) + need;
  }
}

function nightSec(sol: number): number {
  return COLONY_TUNING.sol.nightBaseSec + COLONY_TUNING.sol.nightPerSolSec * sol;
}

/** A committed relay route: the deposit (or relic) tile the chain walks toward. */
interface Route {
  col: number;
  row: number;
  /** A 2×2 deposit needs its far corner lit too; a relic only its own tile. */
  size: 1 | 2;
  /** Opened by an urgent chase (food, tonight's power): a non-urgent chase never takes it over. */
  urgent: boolean;
}

class Builder implements LanePolicy {
  readonly id: LaneId;
  private readonly p: Profile;
  private readonly rng: Rng;
  private nextThink = 0;
  private edgeTurn = 0;
  private route: Route | null = null;
  /** The Spire's reserved plot (`spireSite`). */
  private site: [number, number] | null = null;
  /** Fe the dusk defence floor still needs tonight: smelters leave it in the stock (`manageGrid`). */
  private guardFe = 0;
  /** The last decision pass's reservation ledger (`hold`): smelters burn only the Fe above it. */
  private held: Stock = {};
  /**
   * Fe held by the wants up to and including the first one short of alloy: that want needs the smelters,
   * so they may burn the Fe the wants below it hold. Null = no held want is short of alloy.
   */
  private smeltFe: number | null = null;
  /** The last decision was skipped (the novice never misses two in a row). */
  private skipped = false;

  constructor(profile: Profile, seed: string) {
    this.p = profile;
    this.id = profile.id;
    this.rng = new Rng(`${seed}:policy:${profile.id}`);
  }

  onDay(state: ColonyState, view: ColonyView, rng: Rng): void {
    const t = state.clock.elapsedSec;
    if (t < this.nextThink) return;
    this.nextThink = t + this.p.thinkSec;
    if (this.p.manage) this.manageGrid(state, view);
    // The novice's slack: it misses a decision now and then, never two in a row.
    const skip = this.p.skipChance > 0 && !this.skipped && rng.chance(this.p.skipChance);
    this.skipped = skip;
    if (skip) return;
    if (this.p.ship && this.shipOrder(state, view)) return;
    this.decide(state, view);
  }

  pick(cards: readonly string[], protocol: string | null): string {
    // A skilled lane takes an offered evolution (a 4th card, never displacing a choice); the floor bot never notices it.
    if (protocol !== null && this.p.manage) return protocol;
    const first = cards[0];
    if (first === undefined) return protocol ?? '';
    if (this.p.tags === null) return this.p.manage ? this.rng.pick(cards) : first;
    const tags = this.p.tags;
    let best = first;
    let bestScore = Infinity;
    for (const id of cards) {
      const d = DIRECTIVES.find((x) => x.id === id);
      const rank = d === undefined ? TAGS.length : tags.indexOf(d.tag);
      const score = (rank < 0 ? TAGS.length : rank) - (d?.rarity === 'prime' ? 0.5 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  }

  triggerWhen(view: ColonyView): boolean {
    if (view.beaconState !== 'ready' || view.stock.cell < view.cellsNeeded) return false;
    if (view.sol >= COLONY_TUNING.sol.count) return true;
    if (view.sol < this.p.triggerSol) return false;
    if (!this.p.manage) return true;
    // Skilled lanes charge early in a day, sails up, so most of the 75 s runs in daylight.
    return view.phase === 'day' && view.phaseLeftSec >= COLONY_TUNING.sol.daySec * 0.6;
  }

  /** Ships a ready order — a managing lane never feeds orbit the aurelite, prism or cells its Beacon chain still needs (a `feedOrbit` lane ships everything). */
  private shipOrder(state: ColonyState, view: ColonyView): boolean {
    const hold = this.p.manage && !this.p.feedOrbit && this.beaconOpen(state);
    for (const o of view.board) {
      if (!o.shippable) continue;
      const need = ORDERS.find((t) => t.id === o.templateId)?.need;
      const goods = need !== undefined && 'goods' in need ? need.goods : undefined;
      if (hold && goods !== undefined && ((goods.aurelite ?? 0) > 0 || (goods.prism ?? 0) > 0 || (goods.cell ?? 0) > 0)) continue;
      if (state.shipOrder(o.slot)) return true;
    }
    return false;
  }

  /** Goods the orders listed on the board ask for (summed per good). */
  private listedGoods(view: ColonyView): Stock {
    const out: Stock = {};
    for (const o of view.board) {
      const need = ORDERS.find((t) => t.id === o.templateId)?.need;
      if (need === undefined || !('goods' in need)) continue;
      for (const g of GOODS) {
        const n = need.goods[g] ?? 0;
        if (n > 0) out[g] = (out[g] ?? 0) + n;
      }
    }
    return out;
  }

  /**
   * Colonists not yet claimed by a lit, unpaused job (read off the buildings, not
   * the last tick's staffing). A managing lane counts smelter crews as free for
   * a Beacon-chain job once some alloy is stocked: `manageGrid` idles a smelter to staff it.
   */
  private freeHands(state: ColonyState, forDef: BuildingId | null = null): number {
    const smeltersYield = this.p.manage && forDef !== null && CHAIN[forDef] === true && state.stock.alloy >= 20;
    let seats = 0;
    for (const b of state.buildings.values()) {
      if (!b.lit || b.paused || (smeltersYield && b.def === 'alloy_smelter')) continue;
      seats += buildingDef(b.def).workers;
    }
    return state.colonists - seats;
  }

  private count(state: ColonyState, def: BuildingId): number {
    let n = 0;
    for (const b of state.buildings.values()) if (b.def === def) n += 1;
    return n;
  }

  // ---------------------------------------------------------------- grid management

  /** The lane still has to build the Spire / its foundries / stock its cells (the Beacon chain is open). */
  private beaconOpen(state: ColonyState): boolean {
    return state.beacon === 'locked' || state.beacon === 'unbuilt' || state.beacon === 'ready';
  }

  /** Prism the Beacon chain still needs (Spire + missing foundries + missing cells); prism-costing guns wait for it. */
  private prismReserve(state: ColonyState, sol: number): number {
    if (!this.beaconOpen(state) || sol < 3) return 0;
    let need = 0;
    if (state.beacon !== 'ready') need += state.costOf('beacon_spire').prism ?? 0;
    const foundries = this.wanted('lumen_foundry', Math.max(sol, 6)) - this.count(state, 'lumen_foundry');
    need += Math.max(0, foundries) * (state.costOf('lumen_foundry').prism ?? 0);
    need += Math.max(0, state.cellsNeeded - state.stock.cell);
    return need;
  }

  /** Alloy the plan wants stocked: small early, the whole Beacon bill once the chain opens. */
  private alloyGoal(state: ColonyState, sol: number): number {
    const cap = state.view().caps.alloy - 5;
    if (!this.beaconOpen(state)) return 30;
    if (sol < 4) return 45;
    let need = 40;
    if (state.beacon !== 'ready') need += state.costOf('beacon_spire').alloy ?? 0;
    const foundries = this.wanted('lumen_foundry', Math.max(sol, 6)) - this.count(state, 'lumen_foundry');
    need += Math.max(0, foundries) * (state.costOf('lumen_foundry').alloy ?? 0);
    need += Math.max(0, state.cellsNeeded - state.stock.cell) * 2;
    return Math.min(cap, need);
  }

  private wanted(def: BuildingId, sol: number): number {
    let n = 0;
    for (const w of this.p.plan) if ('b' in w && w.b === def) n = Math.max(n, at(w.n, sol));
    return n;
  }

  /**
   * Pauses what the colony cannot afford to run: smelters past the alloy goal
   * (their Fe buys guns), foundries once the cells are stocked, processors at
   * dusk while tonight's margin (forecast + banked kJ) is short, everything
   * but the guns while the Beacon charges.
   */
  private manageGrid(state: ColonyState, view: ColonyView): void {
    const sol = view.sol;
    const charging = state.beacon === 'charging';
    const alloyGoal = this.alloyGoal(state, sol);
    const want = new Map<number, boolean>();
    // A lane that feeds orbit (variety) keeps the goods a listed order asks for: cutters leave the aurelite a
    // Survey Samples order needs, foundries stock the cells a Lumen Batch needs on top of the Beacon's.
    const listed = this.p.feedOrbit ? this.listedGoods(view) : null;
    const cellGoal = state.cellsNeeded + (listed?.cell ?? 0);
    for (const b of state.buildings.values()) {
      let run = true;
      // Smelters burn only the Fe above the ledger (every blocked want's bill and tonight's guard): a harvester,
      // cutter or gun waiting on Fe is never out-bid by alloy for a later want.
      // Alloy-starved (below ALLOY_STARVED, where every gun, hab and the Spire wait on it): smelt down to the model's floor.
      if (b.def === 'alloy_smelter') run = state.stock.alloy < alloyGoal && state.stock.ferrite - (state.stock.alloy < ALLOY_STARVED ? 0 : (this.smeltFe ?? this.held.ferrite ?? 0)) - this.guardFe >= SMELT_FE;
      else if (b.def === 'lumen_foundry') run = state.stock.cell < cellGoal && (this.beaconOpen(state) || (listed?.cell ?? 0) > 0);
      else if (b.def === 'prism_cutter') run = (listed?.aurelite ?? 0) === 0 || state.stock.aurelite > (listed?.aurelite ?? 0);
      else if (b.def === 'aurel_harvester') run = true;
      else if (b.def === 'hydro_terrace' && listed !== null) {
        // Cryo Stock (feedOrbit): terraces leave the listed ice while the ration stock can take it (even while charging).
        want.set(b.uid, (listed.ice ?? 0) === 0 || state.stock.ice > (listed.ice ?? 0) || state.stock.rations < 20);
        continue;
      }
      // Commons and drills run by day (a pause below lasts one tick / one night, never the rest of the Landing).
      else if (b.def === 'hearth_commons' || b.def === 'ferrite_drill') run = true;
      else continue;
      if (charging) run = false;
      want.set(b.uid, run);
    }
    // Smelters are the flexible crew: they run only on hands the other jobs (cutters, foundries, commons) leave free.
    let hands = state.colonists;
    for (const b of state.buildings.values()) {
      if (b.def === 'alloy_smelter' || !b.lit) continue;
      if (want.get(b.uid) ?? !b.paused) hands -= buildingDef(b.def).workers;
    }
    // The foundry is last in the model's staffing order: a running foundry short of crew takes it from the commons,
    // then from drills beyond two (a player pauses them to seal the Beacon's cells).
    for (const def of ['hearth_commons', 'ferrite_drill'] as const) {
      let keep = def === 'ferrite_drill' ? 2 : 0;
      for (const b of state.buildings.values()) {
        if (hands >= 0) break;
        if (b.def !== def || !b.lit || want.get(b.uid) !== true) continue;
        if (keep > 0) {
          keep -= 1;
          continue;
        }
        let foundry = false;
        for (const f of state.buildings.values()) if (f.def === 'lumen_foundry' && f.lit && want.get(f.uid) === true) foundry = true;
        if (!foundry) break;
        want.set(b.uid, false);
        hands += buildingDef(b.def).workers;
      }
    }
    // Alloy-starved with Fe to spare (every gun, hab and Spire needs alloy): the first smelter takes a drill's crew,
    // the way a player pauses a drill when every hand mines and nothing smelts. Never below 2 running drills.
    let drills = 0;
    for (const b of state.buildings.values()) if (b.def === 'ferrite_drill' && b.lit && want.get(b.uid) === true) drills += 1;
    let first = true;
    for (const b of state.buildings.values()) {
      if (b.def !== 'alloy_smelter' || want.get(b.uid) !== true) continue;
      const seats = buildingDef(b.def).workers;
      if (hands < seats && first && state.stock.alloy < ALLOY_STARVED && state.stock.ferrite >= 2 * SMELT_FE + (this.smeltFe ?? 0) && drills > 2) {
        for (const d of state.buildings.values()) {
          if (d.def !== 'ferrite_drill' || !d.lit || want.get(d.uid) !== true || hands >= seats) continue;
          want.set(d.uid, false);
          hands += buildingDef(d.def).workers;
          drills -= 1;
        }
      }
      first = false;
      if (hands < seats) want.set(b.uid, false);
      else hands -= seats;
    }
    if (view.phase === 'dusk' || charging) {
      // Tonight's margin with what the banks hold spread over the night.
      let margin = view.kwNightForecast + Math.min(this.bankKw(state), state.bankKj / nightSec(sol));
      for (const b of state.buildings.values()) if (b.paused && want.get(b.uid) === true) margin -= buildingDef(b.def).kw;
      for (const b of state.buildings.values()) if (!b.paused && want.get(b.uid) === false) margin += buildingDef(b.def).kw;
      const floor = at(this.p.powerFloor, sol);
      for (const def of PAUSABLE) {
        if (margin >= floor) break;
        for (const b of state.buildings.values()) {
          if (b.def !== def || margin >= floor) continue;
          if (want.get(b.uid) === false) continue;
          want.set(b.uid, false);
          margin += buildingDef(b.def).kw;
        }
      }
    }
    for (const [uid, run] of want) {
      const b = state.buildings.get(uid);
      if (b !== undefined && b.paused === run) state.setPaused(uid, !run);
    }
  }

  private bankKw(state: ColonyState): number {
    let kw = 0;
    const mul = COLONY_TUNING.production.mkRateMul;
    for (const b of state.buildings.values()) if (b.def === 'charge_bank' && b.lit) kw += buildingDef(b.def).kwOut * (mul[Math.min(b.mk, 3) - 1] ?? 1);
    return kw;
  }

  // ---------------------------------------------------------------- decisions

  private decide(state: ColonyState, view: ColonyView): void {
    const sol = view.sol;
    const reserved: Stock = {};
    this.held = reserved;
    this.smeltFe = null;
    this.spireSite(state);
    // 0. Income first (skilled): two drills before anything else spends the landing Fe. The novice follows its coach plan.
    if (this.p.manage && this.count(state, 'ferrite_drill') < 2 && this.tryBuild(state, view, 'ferrite_drill', reserved, true)) return;
    // 0b. Defence floor: at dusk, every telegraphed edge's front gets the guns tonight's swarm needs — before food,
    // the plan and the Spire / foundries (and their alloy) spend the Fe.
    this.guardFe = 0;
    if (this.p.manage && this.guardEdges(state, view, reserved)) return;
    // 1. Food: feed the colony (+ slack) once the drills run (a skilled lane right after its first two) or the stock runs low.
    if (this.count(state, 'ferrite_drill') >= (this.p.manage ? 2 : 3) || view.stock.rations < 25) {
      if (this.p.manage) {
        if (this.feed(state, view, reserved)) return;
      } else {
        const perTerrace = 0.4 / COLONY_TUNING.colonists.rationPerSec;
        if (this.count(state, 'hydro_terrace') < Math.ceil((view.colonists + this.p.foodSlack) / perTerrace)) {
          const need: BuildingId = this.count(state, 'rime_borer') <= this.count(state, 'hydro_terrace') ? 'rime_borer' : 'hydro_terrace';
          if (this.tryBuild(state, view, need, reserved, this.p.staffAware)) return;
        }
      }
    }
    // 1b. Rebuild last night's ruins (60 % of the price, back at their Mk) — a skilled player's first dawn chore.
    if (this.p.manage) {
      for (const ruin of state.ruins) if (state.rebuild(ruin.col, ruin.row) !== null) return;
    }
    // 2-3 buy only from what is spare: an unaffordable bed or power want holds nothing back from the plan.
    // 2. Beds for arrivals — only while the colony has work for them.
    if (this.p.bedSlack > 0 && view.beds < view.colonists + this.p.bedSlack && this.freeHands(state) < 2) {
      if (this.tryBuild(state, view, 'hab_dome', { ...reserved })) return;
    }
    // 3. Night power: tonight's forecast plus the banked kJ must hold the lane's floor — a vent, a vent Mk, else a bank.
    if (this.p.manage && sol >= 2) {
      const margin = view.kwNightForecast + Math.min(this.bankKw(state), state.bankCapKj / nightSec(sol));
      if (margin < at(this.p.powerFloor, sol)) {
        const spare: Stock = { ...reserved };
        if (this.tryBuild(state, view, 'vent_tap', spare, true)) return;
        if (this.tryUpgrade(state, 'vent_tap', 3, spare)) return;
        if (this.tryBuild(state, view, 'charge_bank', spare)) return;
      }
    } else if (view.kwNightForecast < at(this.p.powerFloor, sol) && this.tryBuild(state, view, 'vent_tap', reserved, this.p.staffAware)) return;
    // 3b. Guard the crystal: every harvester out on the frontier keeps a pulse beside it.
    if (this.p.manage && sol >= 3 && this.guardOutposts(state, reserved)) return;
    // 4. The lane's plan, then the protocol chase.
    for (const w of this.plan(state)) {
      if ('up' in w) {
        if (this.p.manage && this.tryUpgrade(state, w.up, at(w.mk, sol), reserved)) return;
        continue;
      }
      const def = w.b;
      if (!AUTHORED.has(def)) continue;
      if (this.p.noTurretSol1 && sol === 1 && DEFENSE[def] === true) continue;
      let n = at(w.n, sol);
      // A skilled lane never builds a cutter with no crystal to feed it: one per harvester (its Mk is the cheaper
      // throughput). The variety lane's protocol chase (Focus Array: 3 cutters) is exempt.
      if (this.p.manage && !this.p.chaseProtocols && def === 'prism_cutter') n = Math.min(n, Math.max(1, this.count(state, 'aurel_harvester')));
      if (this.count(state, def) >= n) continue;
      // A row wanted before its building unlocks (the Spire Rush's Spire and foundries): a skilled lane saves its bill.
      if ((def === 'beacon_spire' ? state.beaconUnlockSol : buildingDef(def).unlockSol) > sol) {
        if (this.p.manage) this.hold(state, state.costOf(def), reserved);
        continue;
      }
      if (this.tryBuild(state, view, def, reserved)) return;
    }
  }

  /**
   * Skilled food: measure ice and ration capacity against the colony's need
   * (+ slack). Ice short → a borer Mk (cheap, no new crew) before a new borer
   * (a far ice lens is chased as an urgent route only when the stock runs
   * low); rations short → a new terrace, else a terrace Mk.
   */
  private feed(state: ColonyState, view: ColonyView, reserved: Stock): boolean {
    const P = COLONY_TUNING.production;
    let ice = 0;
    let rations = 0;
    for (const b of state.buildings.values()) {
      const mul = P.mkRateMul[Math.min(b.mk, 3) - 1] ?? 1;
      if (b.def === 'rime_borer') ice += (P.purityMul[b.purity] ?? 1) * mul;
      else if (b.def === 'hydro_terrace') rations += 0.5 * mul;
    }
    const need = (view.colonists + this.p.foodSlack) * COLONY_TUNING.colonists.rationPerSec;
    if (ice < 2 * Math.min(rations, need) - 1e-6 || (rations >= need && ice < 2 * need)) {
      if (this.tryUpgrade(state, 'rime_borer', 3, reserved)) return true;
      return this.tryBuild(state, view, 'rime_borer', reserved, view.stock.rations < 30);
    }
    if (rations < need) {
      if (this.tryBuild(state, view, 'hydro_terrace', reserved)) return true;
      return this.tryUpgrade(state, 'hydro_terrace', 3, reserved);
    }
    return false;
  }

  /** The profile plan, plus (variety) each owned directive's protocol building count right after the economy core. */
  private plan(state: ColonyState): readonly Want[] {
    if (!this.p.chaseProtocols) return this.p.plan;
    const extra: Want[] = [];
    for (const pr of PROTOCOLS) {
      if (!state.owned.includes(pr.directive) || state.evolved.includes(pr.id)) continue;
      if (!pr.openAtL1 && !state.setup.ark.includes(pr.id)) continue;
      const def: BuildingId = pr.building === 'extractors' ? 'ferrite_drill' : pr.building;
      const have = pr.building === 'extractors' ? EXTRACTORS.reduce((n, d) => n + this.count(state, d), 0) - this.count(state, 'ferrite_drill') : 0;
      extra.push({ b: def, n: [Math.max(0, pr.count - have)] });
    }
    if (extra.length === 0) return this.p.plan;
    const out = [...this.p.plan];
    out.splice(Math.min(6, out.length), 0, ...extra);
    return out;
  }

  /**
   * A harvester stands 10-30 tiles out, beyond the core guns: it keeps
   * one pulse (two from sol 6) within 3 tiles (placed on the lit tiles around
   * it), so the night swarm does not raze the Beacon chain every night.
   */
  private guardOutposts(state: ColonyState, reserved: Stock): boolean {
    const want = state.clock.sol >= 6 ? 2 : 1;
    for (const h of state.buildings.values()) {
      if (h.def !== 'aurel_harvester') continue;
      const hc = state.centreOf(h);
      let guns = 0;
      for (const b of state.buildings.values()) if (b.def === 'pulse_turret' && Math.hypot(b.col + 0.5 - hc.col, b.row + 0.5 - hc.row) <= 3) guns += 1;
      if (guns >= want) continue;
      const cost = state.costOf('pulse_turret');
      if (!affordable(state, cost, reserved)) {
        this.hold(state, cost, reserved);
        return false;
      }
      for (const [dx, dy] of SPIRAL) {
        if (dx * dx + dy * dy > 6.25) break;
        const col = Math.floor(hc.col + dx);
        const row = Math.floor(hc.row + dy);
        if (this.offSite(col, row, 1) && state.canPlace('pulse_turret', col, row).ok) return state.place('pulse_turret', col, row) !== null;
      }
    }
    return false;
  }

  /**
   * The dusk defence floor. Walkers come in from each telegraphed edge and
   * chew the first building on their way to the core, so the outermost
   * building in that edge's 90° sector (the front) keeps guns within
   * `GUARD_REACH` worth `fauna per edge × night difficulty / guardFauna` Mk I
   * pulses; a short front gets a pulse beside it, on the outward side.
   * Only the front: every extra pulse is 0.5 kW of night load, and guarding
   * each building behind it browned the night-1 grid out (bastion night-1
   * clean 95 % → 75 %, nights 1-4 margin 90 % → 35 % at 20 runs).
   */
  private guardEdges(state: ColonyState, view: ColonyView, reserved: Stock): boolean {
    const tonight = view.tonight;
    const core = state.core;
    if (tonight === null || tonight.edges.length === 0 || core === undefined || this.p.guardFauna <= 0) return false;
    const diffs = COLONY_TUNING.sol.difficultyBySol;
    const difficulty = diffs[Math.min(view.sol, diffs.length) - 1] ?? 1;
    const want = Math.max(1, Math.ceil(((tonight.totalFauna / tonight.edges.length) * difficulty) / this.p.guardFauna - 1e-6));
    const cc = state.centreOf(core);
    const mkMul = COLONY_TUNING.production.mkRateMul;
    const cost = state.costOf('pulse_turret');
    for (const edge of tonight.edges) {
      const [dx, dy] = DIRS[edge] ?? [0, -1];
      let front = { col: cc.col + dx * 2, row: cc.row + dy * 2 };
      let frontProj = 2;
      for (const b of state.buildings.values()) {
        if (b === core || DEFENSE[b.def] === true || b.def === 'plate_barricade') continue;
        const c = state.centreOf(b);
        const ox = c.col - cc.col;
        const oy = c.row - cc.row;
        const proj = ox * dx + oy * dy;
        if (proj <= frontProj || Math.abs(ox * dy - oy * dx) > proj) continue;
        frontProj = proj;
        front = c;
      }
      let power = 0;
      for (const b of state.buildings.values()) {
        const w = GUN_WEIGHT[b.def];
        if (w === undefined) continue;
        const c = state.centreOf(b);
        if (Math.hypot(c.col - front.col, c.row - front.row) <= GUARD_REACH) power += w * (mkMul[Math.min(b.mk, 3) - 1] ?? 1);
      }
      if (power >= want) continue;
      this.guardFe += (cost.ferrite ?? 0) * Math.ceil(want - power);
      if (!affordable(state, cost, reserved)) {
        this.hold(state, cost, reserved);
        continue;
      }
      const ax = front.col + dx * 1.5;
      const ay = front.row + dy * 1.5;
      for (const [ox, oy] of SPIRAL) {
        if (ox * ox + oy * oy > 6.25) break;
        const col = Math.floor(ax + ox);
        const row = Math.floor(ay + oy);
        if (Math.hypot(col + 0.5 - front.col, row + 0.5 - front.row) > GUARD_REACH) continue;
        if (this.offSite(col, row, 1) && state.canPlace('pulse_turret', col, row).ok) return state.place('pulse_turret', col, row) !== null;
      }
    }
    return false;
  }

  /** Enters an unmet want's whole bill in the ledger (`reserve`), noting where the smelters' Fe floor sits. */
  private hold(state: ColonyState, cost: Stock, reserved: Stock): void {
    reserve(cost, reserved);
    if (reserved === this.held && this.smeltFe === null && (reserved.alloy ?? 0) > state.stock.alloy) this.smeltFe = reserved.ferrite ?? 0;
  }

  /** Raises the lowest-Mk `def` below `mk` one step when affordable (reserving otherwise). */
  private tryUpgrade(state: ColonyState, def: BuildingId, mk: number, reserved: Stock): boolean {
    let pick: BuildingInst | null = null;
    for (const b of state.buildings.values()) if (b.def === def && b.mk < mk && b.mk < 3 && (pick === null || b.mk < pick.mk)) pick = b;
    if (pick === null) return false;
    const cost = state.upgradeCost(pick.uid);
    if (cost === null) return false;
    if (!affordable(state, cost, reserved)) {
      this.hold(state, cost, reserved);
      return false;
    }
    return state.upgrade(pick.uid);
  }

  /**
   * Builds one `def` if the lane can; an unaffordable want reserves the goods it
   * is short of so cheaper later wants cannot starve it; a deposit want with no lit
   * deposit left walks the committed relay route toward one.
   */
  private tryBuild(state: ColonyState, view: ColonyView, def: BuildingId, reserved: Stock, urgent = false): boolean {
    const d = buildingDef(def);
    if ((def === 'beacon_spire' ? state.beaconUnlockSol : d.unlockSol) > view.sol) return false;
    // A skilled lane's foundry is never held back for crew: `manageGrid` frees hands for it once it stands.
    const unstaffed = this.p.staffAware && d.workers > 0 && !(this.p.manage && def === 'lumen_foundry') && this.freeHands(state, def) < d.workers;
    const cost = state.costOf(def);
    // Guns that cost prism wait while the Beacon chain still needs it (the variety lane spends it on its protocol chase).
    if (this.p.manage && !this.p.chaseProtocols && (cost.prism ?? 0) > 0 && def !== 'beacon_spire' && def !== 'lumen_foundry') {
      if (state.stock.prism - (cost.prism ?? 0) < this.prismReserve(state, view.sol)) return false;
    }
    if (d.deposit !== null) {
      // The route is walked even before the hands exist: the relay chain is the slow part.
      const spot = this.depositSpot(state, def, d.deposit);
      if (spot === null) return this.extend(state, view, d.deposit, reserved, urgent);
      if (unstaffed) return false;
      if (!affordable(state, cost, reserved)) {
        this.hold(state, cost, reserved);
        return false;
      }
      return state.place(def, spot[0], spot[1]) !== null;
    }
    if (unstaffed) return false;
    if (!affordable(state, cost, reserved)) {
      this.hold(state, cost, reserved);
      return false;
    }
    const spot = this.openSpot(state, view, def);
    return spot !== null && state.place(def, spot[0], spot[1]) !== null;
  }

  private depositSpot(state: ColonyState, def: BuildingId, kind: DepositKind): [number, number] | null {
    let best: [number, number] | null = null;
    let bestScore = Infinity;
    const { core } = state.map;
    for (const dep of state.map.deposits) {
      if (dep.kind !== kind) continue;
      const check = state.canPlace(def, dep.col, dep.row);
      if (!check.ok && check.why !== 'afford') continue;
      const score = Math.hypot(dep.col - core.col, dep.row - core.row) - this.p.purityWeight * 3 * dep.purity;
      if (score < bestScore) {
        bestScore = score;
        best = [dep.col, dep.row];
      }
    }
    return best;
  }

  /**
   * The Spire's 3×3 plot, picked on open lit ground beside the core the first
   * time a skilled lane looks and kept free of everything else (`offSite`), the
   * way a player leaves room for it; re-picked if something else took it.
   */
  private spireSite(state: ColonyState): [number, number] | null {
    if (!this.p.manage || !this.beaconOpen(state) || state.beacon === 'ready') return null;
    const { core, cols } = state.map;
    const open = (col: number, row: number): boolean => {
      for (let dr = 0; dr < 3; dr += 1) {
        for (let dc = 0; dc < 3; dc += 1) {
          const c = col + dc;
          const r = row + dr;
          if (c < 0 || r < 0 || c >= cols || r >= state.map.rows) return false;
          const i = r * cols + c;
          if (state.map.blocked[i] === 1 || state.occ[i] !== 0 || state.depositAt[i] !== 0 || state.lit[i] !== 1) return false;
        }
      }
      return true;
    };
    if (this.site !== null && open(this.site[0], this.site[1])) return this.site;
    this.site = null;
    for (const [dx, dy] of SPIRAL) {
      const col = core.col + dx - 1;
      const row = core.row + dy - 1;
      if (Math.hypot(col + 1.5 - core.col - 0.5, row + 1.5 - core.row - 0.5) < 4) continue;
      if (open(col, row)) {
        this.site = [col, row];
        break;
      }
    }
    return this.site;
  }

  /** `f`×`f` at (col,row) stays off the Spire's plot. */
  private offSite(col: number, row: number, f: number): boolean {
    const s = this.site;
    return s === null || col >= s[0] + 3 || s[0] >= col + f || row >= s[1] + 3 || s[1] >= row + f;
  }

  /** Nearest legal spot to the def's anchor: guns and walls face tonight's (or the next) edge, the Spire takes its plot, the rest hug the core. */
  private openSpot(state: ColonyState, view: ColonyView, def: BuildingId): [number, number] | null {
    const { core } = state.map;
    const f = buildingDef(def).footprint;
    if (def === 'beacon_spire') {
      const site = this.spireSite(state);
      if (site !== null && state.canPlace(def, site[0], site[1]).ok) return site;
    }
    let ax = core.col;
    let ay = core.row;
    let minDist = f === 3 ? 4 : 2.5;
    if (DEFENSE[def] === true || def === 'plate_barricade') {
      const edges: readonly Edge[] = view.tonight?.edges ?? [0, 1, 2, 3];
      const edge = edges[this.edgeTurn % edges.length] ?? 0;
      this.edgeTurn += 1;
      const dir = DIRS[edge] ?? [0, -1];
      const reach = def === 'plate_barricade' ? COLONY_TUNING.field.coreRadius - 0.5 : 4;
      const lateral = def === 'plate_barricade' ? this.rng.int(-3, 3) : this.rng.int(-2, 2);
      ax = core.col + dir[0] * reach + (dir[1] !== 0 ? lateral : 0);
      ay = core.row + dir[1] * reach + (dir[0] !== 0 ? lateral : 0);
      minDist = 2.5;
    }
    for (const [dx, dy] of SPIRAL) {
      const col = Math.round(ax + dx) - Math.floor(f / 2);
      const row = Math.round(ay + dy) - Math.floor(f / 2);
      if (Math.hypot(col + f / 2 - core.col - 0.5, row + f / 2 - core.row - 0.5) < minDist) continue;
      if (def !== 'beacon_spire' && !this.offSite(col, row, f)) continue;
      if (state.canPlace(def, col, row).ok) return [col, row];
    }
    return null;
  }

  private routeLit(state: ColonyState, r: Route): boolean {
    const { cols } = state.map;
    const far = r.size - 1;
    return state.lit[r.row * cols + r.col] === 1 && state.lit[(r.row + far) * cols + r.col + far] === 1;
  }

  /**
   * One relay on the lit frontier along the committed route. A new route is
   * chosen only when none is open (or the open one is lit / taken), toward
   * the best unlit deposit of `kind` (or, sprawl, a relic).
   */
  private extend(state: ColonyState, view: ColonyView, kind: DepositKind, reserved: Stock, urgent: boolean): boolean {
    if (this.route !== null && (this.routeLit(state, this.route) || state.occ[this.route.row * state.map.cols + this.route.col] !== 0)) this.route = null;
    const allowance = (urgent ? URGENT_RELAYS : 0) + (this.p.chaseProtocols && kind === 'crystal' ? CHASE_CRYSTAL_RELAYS : 0);
    if (this.count(state, 'relay_pylon') >= at(this.p.relays, view.sol) + allowance) return false;
    const cost = state.costOf('relay_pylon');
    if (!affordable(state, cost, reserved)) {
      this.hold(state, cost, reserved);
      return false;
    }
    // One route at a time; only an urgent chase (food, tonight's power) takes over a non-urgent one.
    if (this.route === null || (urgent && !this.route.urgent)) {
      const next = this.relayTarget(state, kind, urgent);
      if (next === null) return false;
      this.route = next;
    }
    const target = this.route;
    const { cols, rows } = state.map;
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const i = row * cols + col;
        if (state.lit[i] !== 1 || state.occ[i] !== 0) continue;
        const dd = Math.hypot(col - target.col, row - target.row);
        if (dd < bestD && this.offSite(col, row, 1) && state.canPlace('relay_pylon', col, row).ok) {
          bestD = dd;
          best = [col, row];
        }
      }
    }
    return best !== null && state.place('relay_pylon', best[0], best[1]) !== null;
  }

  private relayTarget(state: ColonyState, kind: DepositKind, urgent: boolean): Route | null {
    const { core, cols } = state.map;
    let best: Route | null = null;
    let bestScore = Infinity;
    const consider = (col: number, row: number, size: 1 | 2, bonus: number): void => {
      const score = Math.hypot(col - core.col, row - core.row) - bonus;
      if (score < bestScore) {
        bestScore = score;
        best = { col, row, size, urgent };
      }
    };
    for (const dep of state.map.deposits) {
      if (dep.kind !== kind || state.occ[dep.row * cols + dep.col] !== 0) continue;
      if (this.routeLit(state, { col: dep.col, row: dep.row, size: 2, urgent })) continue;
      // An urgent chase is a one- or two-relay reach (the ring-2 pair), never a trek; only crystal (the Beacon chain) is worth any trek.
      const d = Math.hypot(dep.col - core.col, dep.row - core.row);
      if (d > (urgent ? URGENT_REACH : kind === 'crystal' ? Infinity : this.p.reach)) continue;
      consider(dep.col, dep.row, 2, this.p.purityWeight * 3 * dep.purity);
    }
    if (this.p.chaseRelics && !urgent) for (const r of state.map.relics) if (!r.claimed) consider(r.col, r.row, 1, 4);
    return best;
  }
}

/** One lane policy, seeded (its own draft/placement jitter never touches the Landing's `Rng`). */
export function createLane(label: LaneLabel, seed: string): LanePolicy {
  return new Builder(profileFor(label), seed);
}
