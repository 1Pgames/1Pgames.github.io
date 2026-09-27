/**
 * Orbital Requests (PRD §5.3 orders, §7 requests.*): a board of
 * `requests.slots` (+ `request.slots`) orders from `requests.firstSol`,
 * refilled at dawn, each expiring `requests.expirySols` sols after it was
 * posted. Goods orders SHIP in one tap (stock deducted); condition orders
 * (colonists alive at dawn, a clean night, a Matron kill) complete on their
 * own. Every completion pays Data (`request.data`) and the template bonus.
 * Headless; the director calls the dawn/alpha hooks, the host calls `shipOrder`.
 */
import type { Rng } from '../../../core/rng';
import { COLONY_TUNING } from '../tuning';
import { GOODS, ORDERS, SWARM_NIGHTS, type OrderTemplate, type Stock } from '../content';
import { colonyStat } from './modifiers';
import { capOf } from './production';
import { clampMorale } from './colonists';
import type { ColonyState, OrderSlot } from './state';

const R = COLONY_TUNING.requests;

/** A Matron order only posts while a Matron night falls inside its expiry window. */
function matronWithin(state: ColonyState, sol: number): boolean {
  const last = sol + R.expirySols - 1;
  if (state.site.extraMatronSol !== null && state.site.extraMatronSol >= sol && state.site.extraMatronSol <= last) return true;
  return SWARM_NIGHTS.some((n) => n.alpha === 'matron' && n.sol >= sol && n.sol <= last);
}

/** Whether a goods order's stock is on hand (the SHIP button state). */
export function canShip(state: ColonyState, order: OrderSlot): boolean {
  const need = order.template.need;
  return 'goods' in need && state.canAfford(need.goods);
}

/** Pays an order's Data + bonus, removes it from the board and emits `shipped`. */
function complete(state: ColonyState, order: OrderSlot): void {
  const i = state.board.indexOf(order);
  if (i < 0) return;
  state.board.splice(i, 1);
  const t = order.template;
  const b = t.bonus;
  const grant: Stock = {
    ferrite: (b.fe ?? 0) + colonyStat(state, 'request.bonusFe', 0),
    alloy: (b.alloy ?? 0) + colonyStat(state, 'request.bonusAlloy', 0),
  };
  for (const g of GOODS) {
    const v = grant[g] ?? 0;
    if (v > 0) state.stock[g] = Math.max(state.stock[g], Math.min(capOf(state, g), state.stock[g] + v));
  }
  state.colonists += b.colonists ?? 0;
  state.morale += b.morale ?? 0;
  clampMorale(state);
  state.rerolls += b.rerolls ?? 0;
  state.mk2Tokens += b.mk2Tokens ?? 0;
  if (b.freeBuild !== undefined) state.freeBuilds.set(b.freeBuild.id, (state.freeBuilds.get(b.freeBuild.id) ?? 0) + b.freeBuild.count);
  state.beaconBonusSec += b.beaconSecs ?? 0;
  if (b.refillBanks === true) state.bankKj = state.bankCapKj;
  if ((b.pingPure ?? 0) > 0) state.pingPure(b.pingPure ?? 0);
  const data = Math.round(colonyStat(state, 'request.data', t.data));
  state.ordersData += data;
  state.ordersDone.push(t.id);
  state.onStateEvent?.({ type: 'shipped', slot: order.slot, templateId: t.id, data });
}

/** SHIP (one tap): deducts a goods order's stock and pays it. False for condition orders or short stock. */
export function shipOrder(state: ColonyState, slot: number): boolean {
  const order = state.board.find((o) => o.slot === slot);
  if (order === undefined || !canShip(state, order)) return false;
  const need = order.template.need;
  if (!('goods' in need)) return false;
  for (const g of GOODS) {
    const v = need.goods[g] ?? 0;
    state.stock[g] -= v;
  }
  complete(state, order);
  return true;
}

/** A Hive Matron died: every listed `killAlpha` order completes. */
export function onAlphaKilled(state: ColonyState): void {
  for (const o of [...state.board]) if ('killAlpha' in o.template.need) complete(state, o);
}

/**
 * Dawn pass, run after arrivals and BEFORE `buildingsLostTonight` resets:
 * condition orders resolve, Orbital Exchange auto-ships goods orders,
 * expired orders leave, empty slots refill. Returns true when the board
 * changed by refill (the director emits `orders`).
 */
export function dawnRequests(state: ColonyState, sol: number, rng: Rng): boolean {
  for (const o of [...state.board]) {
    const need = o.template.need;
    if ('cleanNight' in need && o.postedSol < sol && state.buildingsLostTonight === 0) complete(state, o);
    else if ('colonists' in need && state.colonists >= need.colonists) complete(state, o);
  }
  if (colonyStat(state, 'request.autoShip', 0) > 0) {
    for (const o of [...state.board]) if (canShip(state, o)) shipOrder(state, o.slot);
  }
  for (let i = state.board.length - 1; i >= 0; i -= 1) {
    const o = state.board[i];
    if (o !== undefined && sol >= o.expiresSol) state.board.splice(i, 1);
  }
  if (sol < R.firstSol) return false;
  // Board size after `request.slots` (Wide Band).
  const slots = Math.max(1, Math.round(colonyStat(state, 'request.slots', R.slots)));
  let added = false;
  for (let slot = 0; slot < slots; slot += 1) {
    if (state.board.some((o) => o.slot === slot)) continue;
    const open: OrderTemplate[] = ORDERS.filter(
      (t) =>
        t.solMin <= sol &&
        t.solMax >= sol &&
        !state.board.some((o) => o.template.id === t.id) &&
        (!('killAlpha' in t.need) || matronWithin(state, sol)),
    );
    if (open.length === 0) break;
    const template = rng.pick(open);
    state.board.push({ slot, template, postedSol: sol, expiresSol: sol + R.expirySols });
    added = true;
  }
  state.board.sort((a, b) => a.slot - b.slot);
  return added;
}
