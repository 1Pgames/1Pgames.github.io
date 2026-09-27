/**
 * Power solve (PRD §4 Power, §7 power.*): supply = core (+ overdrive) +
 * lit vent taps + lit sun sails (day only); demand = lit, running loads +
 * the night heat bill + the Beacon charge draw. Short supply sheds relays;
 * whatever is still short throttles every consumer by `powerRatio`.
 */
import { COLONY_TUNING } from '../tuning';
import { buildingDef } from '../content';
import { colonyStat } from './modifiers';
import { heatBillKw, nightTempC, nightUpkeepKw, shedForBrownout } from './field';
import { mkIndex } from './production';
import type { ColonyState } from './state';

export function solvePower(state: ColonyState, dt: number): void {
  const P = COLONY_TUNING.power;
  const prod = COLONY_TUNING.production;
  if (state.overdriveLeft > 0) state.overdriveLeft = Math.max(0, state.overdriveLeft - dt);
  let supply = colonyStat(state, 'core.kw', P.coreKw) * (state.overdriveLeft > 0 ? P.overdriveMul : 1);
  let demand = nightUpkeepKw(state);
  const day = !state.isNight;
  // Generators (vents, sails, banks) keep working while dark: a shed field
  // only cuts consumers, so a brownout cannot starve its own supply (critic build2).
  for (const b of state.buildings.values()) {
    const def = buildingDef(b.def);
    const mkMul = prod.mkRateMul[mkIndex(b.mk)];
    if (b.def === 'vent_tap') {
      supply += colonyStat(state, 'venttap.kw', def.kwOut * (prod.purityMul[b.purity] ?? 1) * mkMul);
    } else if (b.def === 'sun_sail') {
      const share = day ? 1 : colonyStat(state, 'sail.nightShare', 0);
      supply += colonyStat(state, 'sail.kw', def.kwOut * mkMul) * share;
    }
    if (b.lit && !b.paused && !b.shed) demand += def.kw;
  }
  if (state.beacon === 'charging') demand += COLONY_TUNING.beacon.chargeKw;
  // Charge Banks (PRD §5.2): drink surplus, cover a deficit up to 6 kW each from stored kJ.
  let bankCap = 0;
  let bankKw = 0;
  for (const b of state.buildings.values()) {
    if (b.def !== 'charge_bank') continue;
    const def = buildingDef(b.def);
    const mkMul = prod.mkRateMul[mkIndex(b.mk)];
    bankCap += colonyStat(state, 'bank.capacity', def.storeKj * mkMul);
    bankKw += def.kwOut * mkMul;
  }
  // Capacitor Vault: the racks discharge as one, no per-bank kW cap.
  if (colonyStat(state, 'bank.dischargeUncapped', 0) > 0) bankKw = Number.POSITIVE_INFINITY;
  state.bankCapKj = bankCap;
  state.bankKj = Math.min(state.bankKj, bankCap);
  state.kwSupply = supply;
  state.kwDemand = demand;
  state.bankKw = 0;
  const net = supply - demand;
  if (net < 0 && state.bankKj > 0) {
    const draw = Math.min(-net, bankKw, state.bankKj / dt);
    state.bankKj -= draw * dt;
    state.bankKw = draw;
    state.kwSupply += draw;
  } else if (net > 0 && bankCap > state.bankKj) {
    const charge = Math.min(net, bankKw);
    state.bankKj = Math.min(bankCap, state.bankKj + charge * dt);
    state.bankKw = -charge;
  }
  // Capacitor Vault: a surplus heals lit turrets.
  const heal = colonyStat(state, 'bank.turretHealPerSec', 0);
  if (heal > 0 && net > 0) {
    for (const b of state.buildings.values()) {
      if (b.lit && buildingDef(b.def).turret !== null && b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + heal * dt);
    }
  }
  shedForBrownout(state, dt);
  state.powerRatio = state.kwDemand <= 0 ? 1 : Math.min(1, state.kwSupply / state.kwDemand);
}

/**
 * Tonight's margin at the current build (PRD §14 power chip line 2): night supply
 * (core + vents + sails' night share) minus loads and the heat bill of the lit
 * tiles at tonight's temperature. Banks and overdrive are left out.
 */
export function nightForecastKw(state: ColonyState): number {
  const prod = COLONY_TUNING.production;
  let supply = colonyStat(state, 'core.kw', COLONY_TUNING.power.coreKw);
  let demand = 0;
  for (const b of state.buildings.values()) {
    const def = buildingDef(b.def);
    const mkMul = prod.mkRateMul[mkIndex(b.mk)];
    if (b.def === 'vent_tap') supply += colonyStat(state, 'venttap.kw', def.kwOut * (prod.purityMul[b.purity] ?? 1) * mkMul);
    else if (b.def === 'sun_sail') supply += colonyStat(state, 'sail.kw', def.kwOut * mkMul) * colonyStat(state, 'sail.nightShare', 0);
    if (b.lit && !b.paused) demand += def.kw;
  }
  const phase = state.isNight ? state.clock.phase : 'night';
  demand += heatBillKw(state, state.heatedTiles, nightTempC(state.clock.sol, phase, state.clock.longNightSec, state.tempOffsetC));
  return supply - demand;
}
