/**
 * `runLanding` (PRD §16.1 `RunLanding`): one headless Landing on the REAL
 * model and threat — `createColony` + `createThreat(state, rng)` +
 * `ColonyDirector`, wired exactly as `slices/colony/game.ts` wires them (one
 * `${seed}:landing` Rng shared by threat and director) — stepped at a fixed
 * 100 ms, with a `LanePolicy` in the player's seat. Same setup + lane seed =
 * same Landing, draw for draw.
 *
 * Besides the frozen `{ result, trace }` it returns `probe`: the per-Landing
 * measurements the §19 gates read that the trace does not carry (trigger sol,
 * sol-1 placement gaps, night power margins, night-1 losses, evolutions).
 */
import { Rng } from '../../core/rng';
import { KIT_NONE, SITES } from '../../slices/colony/content';
import type { ColonyEvent, LandingResult, LandingSetup } from '../../slices/colony/contracts';
import { ColonyDirector, buildSolTable } from '../../slices/colony/model/director';
import { createColony } from '../../slices/colony/model/state';
import { createThreat } from '../../slices/colony/threat/index';
import { createDirectorHost } from '../director-host';
import { createLane } from './bots';
import type { LaneLabel } from './lanes';
import type { LandingTrace, LanePolicy, RunLanding } from './types';

/** Fixed sim step (ms). */
const STEP_MS = 100;

export interface LandingProbe {
  /** Sol the Beacon charge started (null = never triggered). */
  triggerSol: number | null;
  /** The Landing reached nightfall of sol 5 (the Matron night). */
  reachedMatron: boolean;
  /** Nights whose nightfall the Landing reached. */
  nightsReached: number;
  /** Sol of the first brownout (dusk or night), null = never. */
  firstBrownoutSol: number | null;
  /** Rations at the sol 2 dawn (null = never reached). */
  rationsAtSol2Dawn: number | null;
  /** Rations touched 0 before the sol 3 dawn. */
  starvedBeforeSol3: boolean;
  /** Lowest supply − demand (kW, bank draw included) per night, index 0 = night 1. */
  nightMarginKw: number[];
  /** Longest wait (s) between the lane's placements during sol 1 (from t = 0 to dusk). */
  sol1MaxGapSec: number;
  /** Buildings destroyed on night 1 (dusk start → dawn). */
  night1Lost: number;
  /** Core hp share at the sol 2 dawn (1 when never reached — the gate reads it only with night1Lost). */
  coreShareAfterNight1: number;
  /** Protocol ids evolved this Landing. */
  evolved: string[];
}

export interface LandingRun {
  result: LandingResult;
  trace: LandingTrace;
  probe: LandingProbe;
}

export function runLanding(setup: LandingSetup, lane: LanePolicy): LandingRun {
  const state = createColony(setup);
  const rng = new Rng(`${setup.seed}:landing`);
  const threat = createThreat(state, rng);
  const director = new ColonyDirector(state, threat, createDirectorHost(), rng, { bank: false });
  const laneRng = new Rng(`${setup.seed}:lane:${lane.id}`);
  const table = buildSolTable();
  const matronNight = table.find((w) => w.sol === 5)?.nightStart ?? Infinity;
  const deadline = (table[table.length - 1]?.nightEnd ?? 0) + 5;

  const trace: LandingTrace = { actionsAtSec: [], payoffsAtSec: [], brownoutNights: 0, nightsLost: [], ordersDone: [], relics: [] };
  const probe: LandingProbe = {
    triggerSol: null,
    reachedMatron: false,
    nightsReached: 0,
    firstBrownoutSol: null,
    rationsAtSol2Dawn: null,
    starvedBeforeSol3: false,
    nightMarginKw: [],
    sol1MaxGapSec: 0,
    night1Lost: 0,
    coreShareAfterNight1: 1,
    evolved: [],
  };
  const brownoutSols = new Set<number>();
  /** The open draft, captured from its event and answered after `update` returns (never inside the emit). */
  const open: { draft: { cards: readonly string[]; protocol: string | null } | null } = { draft: null };
  let sol1LastPlace = 0;
  let liveBefore = 0;
  let matronsBefore = 0;
  let placedByLane = false;

  const unsub = director.on((e: ColonyEvent) => {
    const t = director.elapsedSeconds;
    switch (e.type) {
      case 'draft':
        open.draft = { cards: e.cards, protocol: e.protocol };
        break;
      case 'dawn':
        trace.payoffsAtSec.push(t);
        if (e.sol === 2) {
          probe.rationsAtSol2Dawn = state.stock.rations;
          probe.coreShareAfterNight1 = state.core === undefined ? 0 : state.core.hp / state.core.maxHp;
        }
        break;
      case 'nightfall':
        probe.nightsReached = Math.max(probe.nightsReached, e.sol);
        break;
      case 'brownout':
        if (state.clock.phase !== 'day') {
          brownoutSols.add(state.clock.sol);
          probe.firstBrownoutSol ??= state.clock.sol;
        }
        break;
      case 'destroyed':
        if (state.clock.phase !== 'day') {
          if (!trace.nightsLost.includes(state.clock.sol)) trace.nightsLost.push(state.clock.sol);
          if (state.clock.sol === 1) probe.night1Lost += 1;
        }
        break;
      case 'placed':
        trace.payoffsAtSec.push(t);
        placedByLane = true;
        break;
      case 'shipped':
        trace.ordersDone.push(e.templateId);
        trace.payoffsAtSec.push(t);
        break;
      case 'relic':
        trace.relics.push(e.id);
        trace.payoffsAtSec.push(t);
        break;
      case 'evolved':
        probe.evolved.push(e.protocol);
        trace.payoffsAtSec.push(t);
        break;
      case 'beacon':
        if (e.state === 'launched') trace.payoffsAtSec.push(t);
        break;
      case 'dusk':
      case 'unlock':
      case 'alpha':
      case 'deaths':
      case 'orders':
      case 'ended':
        break;
    }
  });

  while (!director.ended && director.elapsedSeconds < deadline) {
    const t = director.elapsedSeconds;
    const pending = open.draft;
    if (pending !== null) {
      open.draft = null;
      const choice = lane.pick(pending.cards, pending.protocol);
      director.pick(pending.cards.includes(choice) || choice === pending.protocol ? choice : (pending.cards[0] ?? choice));
      // An evolution is a 4th card: the director re-deals the same draft without it (`open.draft` again), answered next pass.
      if (director.isPaused && open.draft === null) throw new Error(`runLanding: draft pick '${choice}' left the director paused (lane ${lane.id})`);
      trace.actionsAtSec.push(t);
      trace.payoffsAtSec.push(t);
      if (open.draft !== null) continue;
    }

    const phase = state.clock.phase;
    if (phase === 'day' || phase === 'dusk') {
      const buildVersion = state.buildVersion;
      const shipped = trace.ordersDone.length;
      placedByLane = false;
      lane.onDay(state, state.view(), laneRng);
      if (state.buildVersion !== buildVersion || trace.ordersDone.length !== shipped) trace.actionsAtSec.push(t);
      if (placedByLane && state.clock.sol === 1 && phase === 'day') {
        probe.sol1MaxGapSec = Math.max(probe.sol1MaxGapSec, t - sol1LastPlace);
        sol1LastPlace = t;
      }
    }
    if (state.beacon === 'ready' && lane.triggerWhen(state.view()) && director.triggerBeacon()) {
      probe.triggerSol = state.clock.sol;
      trace.actionsAtSec.push(t);
    }

    const solBefore = state.clock.sol;
    const phaseBefore = state.clock.phase;
    director.update(STEP_MS);

    // Headless: the fx outbox is drained here (the view drains it per frame). Every delivery is a drone arrival,
    // a PRD §2 payoff beat ("drone arrivals, every 1-3 s") — extractor output included, not only processor goods.
    for (const fx of state.fx) {
      if (fx.kind === 'deliver') {
        trace.payoffsAtSec.push(director.elapsedSeconds);
        break;
      }
    }
    state.fx.length = 0;

    const night = state.clock.phase === 'night' || state.clock.phase === 'long-night';
    if (night) {
      const i = state.clock.sol - 1;
      const margin = state.kwSupply - state.kwDemand;
      probe.nightMarginKw[i] = Math.min(probe.nightMarginKw[i] ?? Infinity, margin);
      // A swarm cleared mid-night is the "repelled" banner beat.
      if (liveBefore > 0 && threat.liveCount === 0) trace.payoffsAtSec.push(director.elapsedSeconds);
    }
    if (state.matronsKilled > matronsBefore) trace.payoffsAtSec.push(director.elapsedSeconds);
    matronsBefore = state.matronsKilled;
    liveBefore = threat.liveCount;
    if (solBefore <= 2 && state.stock.rations <= 0) probe.starvedBeforeSol3 = true;
    if (director.elapsedSeconds >= matronNight) probe.reachedMatron = true;
    if (phaseBefore === 'day' && state.clock.phase !== 'day' && solBefore === 1) {
      probe.sol1MaxGapSec = Math.max(probe.sol1MaxGapSec, director.elapsedSeconds - sol1LastPlace);
    }
  }
  unsub();
  if (!director.ended) director.abandon();
  const result = director.result;
  if (result === null) throw new Error(`runLanding: Landing ${setup.seed} ended without a result`);
  trace.brownoutNights = brownoutSols.size;
  return { result, trace, probe };
}

runLanding satisfies RunLanding;

/**
 * Plays `runs` seeded Landings of one lane on the §19 reference Landing
 * (Halcyon Flats rung 1, frontier, no kit, no Ark). Landing i of lane L under
 * batch seed S is always seed `S:L:i` — the family sim and `ark.selftest.ts`
 * settle the same Landings. `overrides` changes the Landing (the draft
 * selftest's last-rung batch owns every Ark unlock).
 */
export function playLane(label: LaneLabel, runs: number, seed: string, overrides: Partial<LandingSetup> = {}): LandingRun[] {
  const site = SITES.find((s) => s.id === 'halcyon') ?? SITES[0];
  if (site === undefined) throw new Error('playLane: no site rows');
  const out: LandingRun[] = [];
  for (let i = 0; i < runs; i += 1) {
    const landingSeed = `${seed}:${label}:${i}`;
    const setup: LandingSetup = { site, rung: 1, kit: KIT_NONE, size: 'frontier', ark: [], refit: 0, daily: false, ftue: false, ...overrides, seed: landingSeed };
    out.push(runLanding(setup, createLane(label, landingSeed)));
  }
  return out;
}
