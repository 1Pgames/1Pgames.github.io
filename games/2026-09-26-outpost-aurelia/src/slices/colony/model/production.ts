/**
 * Recipe cycles (PRD §4 Production): extractors and processors run while lit,
 * unpaused and staffed; purity × Mk × morale × directive multipliers set the
 * rate; outputs land in core/silo storage (capped) and raise a `deliver` fx
 * for the drone dots.
 */
import { COLONY_TUNING } from '../tuning';
import { GOODS, buildingDef, type BuildingDef, type BuildingId, type GoodId } from '../content';
import { colonyStat } from './modifiers';
import { dawnArrivalsForecast, staffRank } from './colonists';
import type { BuildingInst, ColonyState } from './state';

const PROD = COLONY_TUNING.production;

/**
 * Index into the Mk tables (`production.mk*Mul`, noise per Mk). An Apex
 * building (protocol evolution, mk 4) runs on the Mk III row.
 */
export function mkIndex(mk: BuildingInst['mk']): 0 | 1 | 2 {
  return (Math.min(mk, 3) - 1) as 0 | 1 | 2;
}

export function capOf(state: ColonyState, _good: GoodId): number {
  let cap = PROD.coreStorage;
  for (const b of state.buildings.values()) if (b.def === 'cargo_silo') cap += PROD.siloStorage;
  return cap;
}

/** Seats a building wants (`process.workers` trims processors, never below 1). */
export function workersOf(state: ColonyState, def: BuildingDef): number {
  if (def.workers <= 0) return 0;
  if (def.category !== 'process') return def.workers;
  return Math.max(1, Math.round(colonyStat(state, 'process.workers', def.workers)));
}

/** Seconds per recipe cycle (`foundry.cycleSec` shortens the Lumen Foundry). */
function cycleSecOf(state: ColonyState, def: BuildingDef): number {
  const base = def.recipe?.cycleSec ?? 1;
  return def.id === 'lumen_foundry' ? Math.max(PROD.foundryMinCycleSec, colonyStat(state, 'foundry.cycleSec', base)) : base;
}

/** Cycles per second multiplier for a building (before power and staffing). */
export function rateOf(state: ColonyState, b: BuildingInst): number {
  const def = buildingDef(b.def);
  let rate: number = PROD.mkRateMul[mkIndex(b.mk)];
  if (def.deposit !== null) {
    const purity = Math.max(b.purity, Math.min(2, Math.round(colonyStat(state, 'purity.impureFloor', 0))));
    rate *= PROD.purityMul[purity] ?? 1;
  }
  if (def.category === 'process') rate = colonyStat(state, 'process.rate', rate);
  if (b.def === 'alloy_smelter') rate = colonyStat(state, 'smelter.rate', rate);
  else if (b.def === 'prism_cutter') rate = colonyStat(state, 'cutter.rate', rate);
  else if (b.def === 'aurel_harvester') rate = colonyStat(state, 'harvester.rate', rate);
  if (state.morale < PROD.lowMoraleAt) rate *= PROD.lowMoraleMul;
  return rate;
}

/**
 * Stock of `good` processors leave untouched: max(`production.reserve[good]`,
 * the `good` price of the building the player wants right now —
 * `ColonyState.want`, set on arm / cost-deny, 30 s). Live price.
 */
function reserveOf(state: ColonyState, good: GoodId): number {
  const want = state.activeWant;
  return Math.max(PROD.reserve[good], want === null ? 0 : (state.costOf(want)[good] ?? 0));
}

/**
 * Why a stopped recipe cannot start its next cycle, or null when it can.
 * Processors never draw an input below `production.reserve[good]` (so a
 * smelter cannot eat the Fe the player needs to build). One implementation
 * for the tick and for `statusOf`.
 */
function startBlock(state: ColonyState, def: BuildingDef): { reason: 'input-short' | 'input-reserve' | 'storage-full'; good: GoodId } | null {
  const recipe = def.recipe;
  if (recipe === null) return null;
  const hold = def.category === 'process';
  for (const g of GOODS) {
    const need = recipe.inputs[g] ?? 0;
    if (need <= 0) continue;
    if (need > state.stock[g]) return { reason: 'input-short', good: g };
    if (hold && state.stock[g] - need < reserveOf(state, g)) return { reason: 'input-reserve', good: g };
  }
  for (const g of GOODS) if ((recipe.outputs[g] ?? 0) > 0 && state.stock[g] >= capOf(state, g)) return { reason: 'storage-full', good: g };
  return null;
}

/** Card status reason (PRD §14 BuildingCard): what a building is doing, or why not. */
export type BuildingStatusReason =
  | 'working'
  | 'paused'
  | 'shed'
  | 'dark'
  | 'frozen'
  | 'unstaffed-no-colonists'
  | 'unstaffed-no-beds'
  | 'unstaffed-waking'
  | 'input-short'
  | 'input-reserve'
  | 'storage-full';

export interface BuildingStatus {
  reason: BuildingStatusReason;
  /** The good behind `input-*` / `storage-full`, else null. */
  good: GoodId | null;
  /** With `input-reserve`: the live `reserveOf(good)` being kept for building ("keeping 40 Fe"); else null. */
  reserve: number | null;
  /** With `input-reserve`: the building the stock is kept for (`ColonyState.want`), or null for the floor reserve. */
  reserveFor: BuildingId | null;
  /** Seats filled / wanted (0 / 0 for buildings without crew). */
  staffed: number;
  seats: number;
  /** 1-based staffing priority (`staffRank`: PRD §5.1 order, foundry after the terrace once the Spire unlocks); null when the building takes no crew. */
  priority: number | null;
  /** Colonists expected at the next dawn (`dawnArrivalsForecast`), for the unstaffed hints. */
  arrivalsAtDawn: number;
}

/**
 * Status of one building for the card and HUD (null for an unknown uid).
 * Order: paused → frozen/dark → unstaffed (beds vs colonists vs waking) →
 * running → the recipe's start block (input short / reserve / storage full).
 * A partly staffed building that runs reports `working`.
 */
export function statusOf(state: ColonyState, uid: number): BuildingStatus | null {
  const b = state.buildings.get(uid);
  if (b === undefined) return null;
  const def = buildingDef(b.def);
  const seats = workersOf(state, def);
  const base = { good: null, reserve: null, reserveFor: null, staffed: b.staffed, seats, priority: seats > 0 ? staffRank(state, b.def) + 1 : null, arrivalsAtDawn: dawnArrivalsForecast(state) };
  if (b.paused) return { ...base, reason: 'paused' };
  if (b.shed && b.def !== 'relay_pylon') return { ...base, reason: 'shed' };
  if (!b.lit) return { ...base, reason: b.frozen ? 'frozen' : 'dark' };
  if (seats > 0 && b.staffed <= 0) {
    const reason = state.waking > 0 ? 'unstaffed-waking' : state.colonists >= state.beds ? 'unstaffed-no-beds' : 'unstaffed-no-colonists';
    return { ...base, reason };
  }
  if (!b.working) {
    const block = startBlock(state, def);
    if (block !== null) return { ...base, reason: block.reason, good: block.good, reserve: block.reason === 'input-reserve' ? reserveOf(state, block.good) : null, reserveFor: block.reason === 'input-reserve' ? state.activeWant : null };
  }
  return { ...base, reason: 'working' };
}

export function tickProduction(state: ColonyState, dt: number): void {
  const extraCells = Math.max(0, Math.round(colonyStat(state, 'foundry.cellsPerCycle', 0)));
  for (const b of state.buildings.values()) {
    const def = buildingDef(b.def);
    const recipe = def.recipe;
    if (recipe === null || !b.lit || b.paused || b.shed || b.staffed <= 0) continue;
    if (!b.working) {
      // Waiting (held back or short) keeps its crew seated but consumes nothing.
      if (startBlock(state, def) !== null) continue;
      for (const g of GOODS) {
        const used = recipe.inputs[g] ?? 0;
        state.stock[g] -= used;
        state.flow[g] -= used;
      }
      b.working = true;
    }
    const seats = workersOf(state, def);
    const staffShare = seats > 0 ? Math.min(1, b.staffed / seats) : 1;
    b.cycle += (dt * rateOf(state, b) * state.powerRatio * staffShare) / cycleSecOf(state, def);
    if (b.cycle < 1) continue;
    b.cycle -= 1;
    b.working = false;
    for (const g of GOODS) {
      let out = recipe.outputs[g] ?? 0;
      if (out <= 0) continue;
      if (b.def === 'lumen_foundry' && g === 'cell') out += extraCells;
      const before = state.stock[g];
      const added = Math.max(0, Math.min(capOf(state, g), before + out) - before);
      state.stock[g] = before + added;
      state.flow[g] += added;
      state.pushFx({ kind: 'deliver', uid: b.uid, good: g });
    }
  }
}
