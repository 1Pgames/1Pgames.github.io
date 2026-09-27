/**
 * Colonists (PRD §5.1): auto-staffing by priority (no manual assignment),
 * rations, cold deaths in dark Hab Domes at night, dawn arrivals + morale,
 * Hearth Commons morale, morale floor.
 */
import { COLONY_TUNING } from '../tuning';
import { STAFF_PRIORITY, buildingDef, type BuildingId } from '../content';
import { colonyStat } from './modifiers';
import { workersOf } from './production';
import type { BuildingInst, ColonyState } from './state';

const C = COLONY_TUNING.colonists;

/** Clamps morale into [`morale.floor`, 100]. */
export function clampMorale(state: ColonyState): void {
  const floor = Math.min(100, Math.max(0, colonyStat(state, 'morale.floor', 0)));
  state.morale = Math.max(floor, Math.min(100, state.morale));
}

/**
 * 0-based staffing rank (PRD §5.1 `STAFF_PRIORITY`). Once the Beacon Spire
 * unlocks, the Lumen Foundry moves up to right after the Hydro Terrace:
 * food first, then cells (critic build4: foundry unstaffed all night).
 */
export function staffRank(state: ColonyState, def: BuildingId): number {
  const order = STAFF_PRIORITY.filter((id) => id !== 'lumen_foundry' || state.clock.sol < state.beaconUnlockSol);
  if (order.length < STAFF_PRIORITY.length) order.splice(order.indexOf('hydro_terrace') + 1, 0, 'lumen_foundry');
  const i = order.indexOf(def);
  return i < 0 ? order.length : i;
}

export function staffBuildings(state: ColonyState): void {
  const jobs: BuildingInst[] = [];
  for (const b of state.buildings.values()) {
    b.staffed = 0;
    if (buildingDef(b.def).workers > 0 && b.lit && !b.paused && !b.shed) jobs.push(b);
  }
  jobs.sort((a, b) => staffRank(state, a.def) - staffRank(state, b.def) || a.uid - b.uid);
  let free = Math.max(0, state.colonists - state.waking);
  for (const b of jobs) {
    const n = Math.min(free, workersOf(state, buildingDef(b.def)));
    b.staffed = n;
    free -= n;
  }
  state.idleWorkers = free;
}

function killColonists(state: ColonyState, count: number, reason: 'cold' | 'starve'): void {
  const n = Math.min(count, state.colonists);
  if (n <= 0) return;
  state.colonists -= n;
  state.waking = Math.min(state.waking, state.colonists);
  state.deathsTotal += n;
  state.morale += C.moraleDeath * n;
  clampMorale(state);
  state.pushFx({ kind: 'death', count: n, reason });
  state.onStateEvent?.({ type: 'deaths', count: n, reason });
}

export function tickColonists(state: ColonyState, dt: number): void {
  if (state.waking > 0) {
    state.wakeLeftSec -= dt;
    if (state.wakeLeftSec <= 0) state.waking = 0;
  }
  const need = state.colonists * colonyStat(state, 'rations.use', C.rationPerSec) * dt;
  if (state.stock.rations >= need) {
    state.stock.rations -= need;
    state.flow.rations -= need;
    state.starving = false;
  } else {
    state.flow.rations -= state.stock.rations;
    state.stock.rations = 0;
    state.starving = state.colonists > 0;
  }
  if (!state.isNight) return;
  // Residents fill domes in uid order; a dark dome with residents loses one every coldDeathEverySec / rate.
  // `colonist.deathRate` scales every colonist death source (p_infirm −75 %).
  const rate = Math.max(0, colonyStat(state, 'cold.deathRate', 1)) * Math.max(0, colonyStat(state, 'colonist.deathRate', 1));
  if (rate <= 0) return;
  const every = C.coldDeathEverySec / rate;
  let housed = state.colonists;
  for (const b of state.buildings.values()) {
    const beds = bedsOf(state, b);
    if (beds <= 0) continue;
    const residents = Math.min(beds, housed);
    housed -= residents;
    if (b.lit || residents <= 0) {
      b.coldSec = 0;
      continue;
    }
    b.coldSec += dt;
    if (b.coldSec >= every) {
      b.coldSec -= every;
      killColonists(state, 1, 'cold');
    }
  }
}

/** Beds of one building (`hab.beds` adds per Hab Dome: Bunk Racks, Warren Dome). */
export function bedsOf(state: ColonyState, b: BuildingInst): number {
  const beds = buildingDef(b.def).beds;
  if (beds <= 0) return 0;
  return b.def === 'hab_dome' ? Math.max(0, Math.round(colonyStat(state, 'hab.beds', beds))) : beds;
}

/**
 * Colonists the next dawn wakes at the current beds and morale (PRD §5.1:
 * min(free beds, 2 + floor(morale / 25)), × `arrivals`). The dawn pass and
 * the unstaffed hints share this one formula.
 */
export function dawnArrivalsForecast(state: ColonyState): number {
  const free = Math.max(0, state.beds - state.colonists);
  const want = C.arrivalsBase + Math.floor(state.morale / C.arrivalsPerMorale);
  return Math.max(0, Math.min(free, Math.round(colonyStat(state, 'arrivals', want))));
}

/**
 * Dawn payoff for people: starvation check, morale (fed, clean night, commons),
 * arrivals (from sol 2). Arrivals wake for `sol.duskSec` before they staff
 * unless `arrivals.staffSameDawn` (Arrival Plaza).
 */
export function dawnColonists(state: ColonyState, newSol: number): { arrivals: number; deaths: number } {
  let deaths = 0;
  if (state.stock.rations < 1 && state.colonists > 0) {
    deaths = Math.max(1, Math.round(Math.floor(state.colonists / C.starveDeathPer) * Math.max(0, colonyStat(state, 'colonist.deathRate', 1))));
    killColonists(state, deaths, 'starve');
    state.morale += C.moraleStarve;
  } else {
    state.morale += colonyStat(state, 'morale.perDawn', C.moraleFedDawn);
  }
  if (state.buildingsLostTonight === 0) state.morale += C.moraleCleanNight;
  let commons = 0;
  for (const b of state.buildings.values()) if (b.def === 'hearth_commons' && b.lit && !b.paused) commons += 1;
  state.morale += Math.min(commons, C.commonsCountMax) * colonyStat(state, 'commons.morale', C.commonsMorale);
  clampMorale(state);
  let arrivals = 0;
  if (newSol >= 2 && state.colonists > 0) {
    arrivals = dawnArrivalsForecast(state);
    state.colonists += arrivals;
    state.arrivalsTotal += arrivals;
    if (arrivals > 0 && colonyStat(state, 'arrivals.staffSameDawn', 0) <= 0) {
      state.waking = arrivals;
      state.wakeLeftSec = COLONY_TUNING.sol.duskSec;
    }
  }
  return { arrivals, deaths };
}
