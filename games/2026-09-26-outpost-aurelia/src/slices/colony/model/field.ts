/**
 * The Lit Grid (PRD §1b Differentiation, §4 Lit Grid): the union of the core
 * r6 disc and every connected relay r4 disc. One set gates placement, powers
 * buildings, heats them at night (upkeep per lit tile per °C), ships goods
 * (drones fly inside it) and lifts fog. Recomputed on grid change only.
 */
import { COLONY_TUNING } from '../tuning';
import { GOODS, RELICS, buildingDef } from '../content';
import { colonyStat } from './modifiers';
import type { BuildingInst, ColonyPhase, ColonyState } from './state';

const F = COLONY_TUNING.field;

/**
 * Temperature for a sol (PRD §2 table); day holds `temp.dayC`. `offsetC` is
 * the Landing's site + Severity offset (`ColonyState.tempOffsetC`).
 */
export function nightTempC(sol: number, phase: ColonyPhase, longNightSec: number, offsetC: number): number {
  const T = COLONY_TUNING.temp;
  if (phase === 'day' || phase === 'dusk') return T.dayC + offsetC;
  const base = T.nightBaseC + T.perSolC * (sol - 1) + offsetC;
  if (phase === 'long-night') return base + T.longNightStepC * Math.floor(longNightSec / T.longNightStepSec);
  return base;
}

/** Heat bill of `tiles` lit tiles at `tempC` (PRD §7 field.heatKwPerTilePerDeg × `field.heatUpkeep`). */
export function heatBillKw(state: ColonyState, tiles: number, tempC: number): number {
  return colonyStat(state, 'field.heatUpkeep', tiles * -Math.min(0, tempC) * F.heatKwPerTilePerDeg);
}

function stampDisc(state: ColonyState, set: Uint8Array, col: number, row: number, radius: number): void {
  const { cols, rows } = state.map;
  const r = Math.ceil(radius);
  const r2 = radius * radius;
  for (let dr = -r; dr <= r; dr += 1) {
    const rr = row + dr;
    if (rr < 0 || rr >= rows) continue;
    for (let dc = -r; dc <= r; dc += 1) {
      const cc = col + dc;
      if (cc < 0 || cc >= cols || dc * dc + dr * dr > r2) continue;
      set[rr * cols + cc] = 1;
    }
  }
}

export function relayRadius(state: ColonyState): number {
  return colonyStat(state, 'relay.radius', F.relayRadius);
}

/** Rebuilds the lit + revealed sets, building `lit` flags, heated tiles and relic claims. */
export function computeField(state: ColonyState): void {
  const { map, lit, revealed } = state;
  lit.fill(0);
  const core = map.core;
  const coreRadius = colonyStat(state, 'core.radius', F.coreRadius);
  const fog = colonyStat(state, 'fog.revealTiles', F.fogRevealTiles);
  stampDisc(state, lit, core.col, core.row, coreRadius);
  stampDisc(state, revealed, core.col, core.row, coreRadius + fog);
  const radius = relayRadius(state);
  const leechImmune = colonyStat(state, 'relay.leechImmune', 0) > 0;
  const relays: BuildingInst[] = [];
  const darkRelays: BuildingInst[] = [];
  for (const b of state.buildings.values()) {
    if (b.def !== 'relay_pylon') continue;
    // Dark relays do not project: shed by brownout, or held by a Static Leech (unless Halo Pylons).
    if (b.shed || (!leechImmune && state.latched.has(b.uid))) darkRelays.push(b);
    else relays.push(b);
  }
  const projecting = new Uint8Array(relays.length);
  // Relays chain: one only projects once its own tile is lit by the core or a projecting relay.
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < relays.length; i += 1) {
      const r = relays[i];
      if (r === undefined || projecting[i] === 1 || lit[state.tileIndex(r.col, r.row)] !== 1) continue;
      projecting[i] = 1;
      stampDisc(state, lit, r.col, r.row, radius);
      stampDisc(state, revealed, r.col, r.row, radius + fog);
      changed = true;
    }
  }
  // Warren Dome: a hab under a dark relay keeps a small lit pocket.
  const habPocket = colonyStat(state, 'hab.brownoutLitRadius', 0);
  if (habPocket > 0 && darkRelays.length > 0) {
    for (const h of state.buildings.values()) {
      if (h.def !== 'hab_dome') continue;
      const hc = h.col + 1;
      const hr = h.row + 1;
      if (!darkRelays.some((r) => Math.hypot(r.col - hc, r.row - hr) <= radius + 1)) continue;
      stampDisc(state, lit, hc, hr, habPocket + 0.75);
    }
  }
  let count = 0;
  for (let i = 0; i < lit.length; i += 1) count += lit[i] ?? 0;
  state.litTiles = count;

  for (const b of state.buildings.values()) {
    const f = buildingDef(b.def).footprint;
    let all = true;
    for (let dr = 0; dr < f && all; dr += 1) {
      for (let dc = 0; dc < f; dc += 1) {
        if (lit[state.tileIndex(b.col + dc, b.row + dr)] !== 1) {
          all = false;
          break;
        }
      }
    }
    b.lit = all && !(b.def === 'relay_pylon' && darkRelays.includes(b));
    if (b.lit) {
      b.darkSec = 0;
      b.frozen = false;
    }
  }

  // Slag Furnace: lit tiles near a lit smelter pay no heat.
  const slag = colonyStat(state, 'smelter.heatFreeRadius', 0);
  let heatFree = 0;
  if (slag > 0) {
    const mask = state.scratch;
    mask.fill(0);
    for (const b of state.buildings.values()) if (b.def === 'alloy_smelter' && b.lit) stampDisc(state, mask, b.col + 1, b.row + 1, slag + 0.75);
    for (let i = 0; i < lit.length; i += 1) if (lit[i] === 1 && mask[i] === 1) heatFree += 1;
  }
  state.heatedTiles = count - heatFree;

  let claimed = false;
  for (const relic of map.relics) {
    if (relic.claimed || lit[state.tileIndex(relic.col, relic.row)] !== 1) continue;
    const def = RELICS.find((r) => r.id === relic.id);
    if (def !== undefined && state.clock.sol < def.firstSol) continue;
    relic.claimed = true;
    const grant = def?.grant ?? {};
    for (const g of GOODS) state.stock[g] += grant.stock?.[g] ?? 0;
    state.rerolls += grant.rerolls ?? 0;
    state.relicData += grant.data ?? 0;
    claimed = true;
    state.pushFx({ kind: 'relic', col: relic.col, row: relic.row });
    state.onStateEvent?.({ type: 'relic', id: relic.id, col: relic.col, row: relic.row });
  }
  // Relic stock lands in capped storage (cert `invariant`: stock ≤ cap).
  if (claimed) state.clampStock();
  state.fieldVersion += 1;
}

/** Heat bill of the lit dome at the current temperature: 0 by day. */
export function nightUpkeepKw(state: ColonyState): number {
  if (!state.isNight) return 0;
  return heatBillKw(state, state.heatedTiles, state.clock.tempC);
}

function distToCore(state: ColonyState, b: BuildingInst): number {
  return Math.hypot(b.col - state.map.core.col, b.row - state.map.core.row);
}

/**
 * Brownout shed priority (critic build3: a turret went OFF mid-fight): lower
 * sheds first. 0 = a lit non-defence consumer (smelter, cutter,
 * foundry, commons…), 1 = a relay carrying neither a generator nor a
 * turret, 2 = a relay carrying a generator — and, once the Spire unlocks,
 * the Lumen Foundry and Prism Cutter —, 3 = a relay carrying a turret.
 * The Beacon Spire (charging or not) is never shed.
 * Null = never shed (core, habs, the Spire, defence, pinned or dark relays,
 * and the raw/food supply — extractors and Hydro Terraces: shedding them
 * halted every delivery through long deficits, payoff cadence 93 % → 49 %
 * in the 20-run sim).
 */
function shedTier(state: ColonyState, b: BuildingInst, radius: number): 0 | 1 | 2 | 3 | null {
  const def = buildingDef(b.def);
  if (b.def !== 'relay_pylon') {
    if (def.kw <= 0 || b.paused || !b.lit || def.category === 'defense' || b.def === 'hab_dome' || b.def === 'lander_core' || b.def === 'beacon_spire' || def.deposit !== null || b.def === 'hydro_terrace') return null;
    // Endgame (critic build4): once the Spire unlocks, the cell chain sheds with the generator relays.
    if ((b.def === 'lumen_foundry' || b.def === 'prism_cutter') && state.clock.sol >= state.beaconUnlockSol) return 2;
    return 0;
  }
  if (b.pinned || !b.lit) return null;
  return relayStake(state, b, radius);
}

/**
 * What toggling relay `flip` (lit → shed, or shed → lit) changes on the
 * relay GRAPH, not just its own disc: a relay only projects when its tile is
 * lit by the core or a projecting relay, so an upstream relay carries its
 * whole downstream chain (ThreatDev, round 5). Recomputes the chain into
 * `state.scratch` with `flip` toggled and returns 3 when a turret changes
 * lit state, 2 when only a generator does, else 1.
 */
function relayStake(state: ColonyState, flip: BuildingInst, radius: number): 1 | 2 | 3 {
  const mask = state.scratch;
  mask.fill(0);
  const core = state.map.core;
  stampDisc(state, mask, core.col, core.row, colonyStat(state, 'core.radius', F.coreRadius));
  const leechImmune = colonyStat(state, 'relay.leechImmune', 0) > 0;
  const relays: BuildingInst[] = [];
  for (const r of state.buildings.values()) {
    if (r.def !== 'relay_pylon') continue;
    const dark = (r === flip ? !r.shed : r.shed) || (!leechImmune && state.latched.has(r.uid));
    if (!dark) relays.push(r);
  }
  const done = new Uint8Array(relays.length);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < relays.length; i += 1) {
      const r = relays[i];
      if (r === undefined || done[i] === 1 || mask[state.tileIndex(r.col, r.row)] !== 1) continue;
      done[i] = 1;
      stampDisc(state, mask, r.col, r.row, radius);
      changed = true;
    }
  }
  let stake: 1 | 2 | 3 = 1;
  for (const o of state.buildings.values()) {
    const turret = buildingDef(o.def).turret !== null;
    if (!turret && o.def !== 'vent_tap' && o.def !== 'sun_sail' && o.def !== 'charge_bank') continue;
    const f = buildingDef(o.def).footprint;
    let all = true;
    for (let dr = 0; dr < f && all; dr += 1) for (let dc = 0; dc < f && all; dc += 1) if (mask[state.tileIndex(o.col + dc, o.row + dr)] !== 1) all = false;
    if (all === o.lit) continue;
    if (turret) return 3;
    stake = 2;
  }
  return stake;
}

/**
 * Brownout (PRD §5.2 cascade): while demand beats supply, every
 * `field.shedIntervalSec` switch off one building by `shedTier` (outermost
 * first within a tier). With headroom, restore in reverse: relays first
 * (turret-carrying relays before the rest, then innermost), then consumers.
 */
export function shedForBrownout(state: ColonyState, dt: number): void {
  const interval = colonyStat(state, 'field.shedIntervalSec', F.shedIntervalSec);
  const radius = relayRadius(state);
  const short = state.kwDemand > state.kwSupply + 1e-6;
  if (short) {
    state.restoreTimer = 0;
    state.consumerRestoreSec = 0;
    state.shedTimer += dt;
    if (state.shedTimer < interval) return;
    state.shedTimer = 0;
    let pick: BuildingInst | null = null;
    let pickTier = 4;
    for (const b of state.buildings.values()) {
      if (b.shed) continue;
      const tier = shedTier(state, b, radius);
      if (tier === null) continue;
      if (pick === null || tier < pickTier || (tier === pickTier && distToCore(state, b) > distToCore(state, pick))) {
        pick = b;
        pickTier = tier;
      }
    }
    if (pick === null) return;
    pick.shed = true;
    if (pick.def === 'relay_pylon') computeField(state);
    state.pushFx({ kind: 'shed', uid: pick.uid, lit: false });
    state.onStateEvent?.({ type: 'brownout', uid: pick.uid });
    return;
  }
  state.shedTimer = 0;
  // Restore. Relays keep priority (turret-carrying first, then innermost):
  // one relights per `field.shedIntervalSec` once true headroom covers 1.1 ×
  // its relight bill. Shed consumers come back on the headroom LEFT after
  // reserving that bill — so a relay whose relight cannot fit no longer holds
  // them off (critic final) — after one interval of steady headroom. Bank
  // charging is never demand: headroom counts only the generators' surplus.
  const headroom = (): number => state.kwSupply - Math.max(0, state.bankKw) - state.kwDemand;
  let inner: BuildingInst | null = null;
  let innerTurret = false;
  for (const b of state.buildings.values()) {
    if (!b.shed || b.def !== 'relay_pylon' || state.latched.has(b.uid)) continue;
    // Would relighting it (with its downstream chain) bring a turret back?
    const turret = relayStake(state, b, radius) === 3;
    if (inner === null || (turret && !innerTurret) || (turret === innerTurret && distToCore(state, b) < distToCore(state, inner))) {
      inner = b;
      innerTurret = turret;
    }
  }
  let bill = 0;
  if (inner !== null) {
    // Relight bill: newly lit tiles × heat, plus the loads they switch on.
    const r = Math.ceil(radius);
    const { cols, rows } = state.map;
    let newTiles = 0;
    let loadKw = buildingDef('relay_pylon').kw;
    const counted = new Set<number>();
    for (let dr = -r; dr <= r; dr += 1) {
      for (let dc = -r; dc <= r; dc += 1) {
        const c = inner.col + dc;
        const rr = inner.row + dr;
        if (c < 0 || rr < 0 || c >= cols || rr >= rows || dc * dc + dr * dr > radius * radius) continue;
        const i = rr * cols + c;
        if (state.lit[i] === 1) continue;
        newTiles += 1;
        const uid = state.occ[i] ?? 0;
        if (uid !== 0 && !counted.has(uid)) {
          counted.add(uid);
          const b = state.buildings.get(uid);
          if (b !== undefined && !b.paused && !b.shed) loadKw += buildingDef(b.def).kw;
        }
      }
    }
    bill = ((state.isNight ? heatBillKw(state, newTiles, state.clock.tempC) : 0) + loadKw) * 1.1;
  }
  const consumers = [...state.buildings.values()].filter((b) => b.shed && b.def !== 'relay_pylon').sort((a, b) => distToCore(state, a) - distToCore(state, b));
  const first = consumers[0];
  const spare = (): number => headroom() - bill;
  state.consumerRestoreSec = first !== undefined && spare() >= buildingDef(first.def).kw * 1.1 ? state.consumerRestoreSec + dt : 0;
  if (state.consumerRestoreSec >= interval) {
    for (const c of consumers) {
      const kw = buildingDef(c.def).kw;
      if (spare() < kw * 1.1) continue;
      c.shed = false;
      state.kwDemand += kw;
      state.pushFx({ kind: 'shed', uid: c.uid, lit: true });
    }
  }
  if (inner === null || headroom() < bill) {
    state.restoreTimer = 0;
    return;
  }
  state.restoreTimer += dt;
  if (state.restoreTimer < interval) return;
  state.restoreTimer = 0;
  inner.shed = false;
  computeField(state);
  state.pushFx({ kind: 'shed', uid: inner.uid, lit: true });
}

/** Dark buildings at night freeze once (−20 % hp) after `field.freezeAfterSec`. */
export function tickDarkness(state: ColonyState, dt: number): void {
  if (!state.isNight) return;
  const after = colonyStat(state, 'field.freezeAfterSec', F.freezeAfterSec);
  for (const b of state.buildings.values()) {
    if (b.lit || b.def === 'lander_core') continue;
    b.darkSec += dt;
    if (b.frozen || b.darkSec < after) continue;
    b.frozen = true;
    state.damage(b, b.maxHp * F.freezeHpShare);
  }
}
