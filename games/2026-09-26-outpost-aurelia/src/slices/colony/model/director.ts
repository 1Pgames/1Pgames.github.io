/**
 * `ColonyDirector` (PRD §2, §16.1): owns the sol clock (day / dusk / night /
 * Long Night), schedules the nightly swarms through the `ThreatPort`, runs
 * the 4 Hz model tick, the dawn payoff (mend, arrivals, draft) and the
 * Beacon (cells, Chorus, Long Night deadline), the order board, the
 * protocol evolutions, the night skip, and resolves the Landing. Composes the template `RunDirector` for
 * the phase clock (`sol{n}-day` / `sol{n}-night` phases carry difficulty).
 */
import type { Rng } from '../../../core/rng';
import { RunDirector, type RunDirectorHost, type RunPhase } from '../../../core/run';
import type { SessionDirector, SessionOutcome } from '../../../core/session';
import { COLONY_TUNING } from '../tuning';
import { ARK_NODES, BUILDINGS, GOODS, SWARM_NIGHTS, buildingDef, type DirectiveDef, type FaunaId, type ProtocolDef } from '../content';
import { dawnColonists } from './colonists';
import { drawDirectives, protocolReady, unlockedPool } from './draft';
import { computeField, nightTempC } from './field';
import { colonyStat } from './modifiers';
import { loudestQuadrant, swarmScale } from './noise';
import { dawnRequests, onAlphaKilled } from './requests';
import { checkpointLanding, computeLanding, settleLanding } from './score';
import type { LandingResult } from '../contracts';
import type { ColonyDirectorApi, ColonyEvent, NightPlan, ThreatPort } from '../contracts';
import type { ColonyState, StateEvent } from './state';

export type { ColonyEvent, NightPlan, ThreatPort } from '../contracts';

/** `bank: false` = headless Landing (sims, selftests): `finish` computes the result without banking and `checkpoint()` writes nothing. */
export interface ColonyDirectorOptions { bank?: boolean }

export interface SolWindow { sol: number; dayStart: number; duskStart: number; nightStart: number; nightEnd: number }

/** PRD §2 sol clock: first day 60 s, then 36 s; dusk = last 10 s of the day; night 12 + 2 × sol; sol 10 night = Long Night. */
export function buildSolTable(): SolWindow[] {
  const S = COLONY_TUNING.sol;
  const out: SolWindow[] = [];
  let t = 0;
  for (let sol = 1; sol <= S.count; sol += 1) {
    const day = sol === 1 ? S.firstDaySec : S.daySec;
    const nightStart = t + day;
    const night = sol === S.count ? S.longNightDeadlineSec : S.nightBaseSec + S.nightPerSolSec * sol;
    out.push({ sol, dayStart: t, duskStart: nightStart - S.duskSec, nightStart, nightEnd: nightStart + night });
    t = nightStart + night;
  }
  return out;
}

function buildPhases(table: readonly SolWindow[]): RunPhase[] {
  const mul = COLONY_TUNING.sol.difficultyBySol;
  const phases: RunPhase[] = [];
  for (const w of table) {
    const m = mul[w.sol - 1] ?? mul[mul.length - 1] ?? 1;
    phases.push({ name: `sol${w.sol}-day`, fromSeconds: w.dayStart, difficultyMul: m });
    phases.push({ name: `sol${w.sol}-night`, fromSeconds: w.nightStart, difficultyMul: m });
  }
  return phases;
}

interface ScheduledSpawn { at: number; id: FaunaId; edge: 0 | 1 | 2 | 3 }

/** Model step while `skipNight` fast-forwards (ms). */
const SKIP_STEP_MS = 250;

export class ColonyDirector implements SessionDirector, ColonyDirectorApi {
  readonly table: readonly SolWindow[];
  private readonly run: RunDirector;
  private readonly listeners: Array<(e: ColonyEvent) => void> = [];
  private readonly queue: ScheduledSpawn[] = [];
  private readonly pool: { directives: readonly DirectiveDef[]; protocols: readonly ProtocolDef[] };
  private userPaused = false;
  private tickAcc = 0;
  private solIdx = 0;
  private duskFired = false;
  private nightFired = false;
  private skitterDrip = 0;
  private bruteDrip = 0;
  private draftIndex = 0;
  private stopped = false;
  /** The Landing pick at t = 0 (every Landing after the first, PRD §5.3). */
  private landingPickPending: boolean;
  /** The Chorus answers the first trigger only; a re-trigger after a lost Spire does not summon it again. */
  private chorusSummoned = false;
  private matronsSeen = 0;
  /** Open draft cards (director holds while non-null). */
  draftCards: readonly DirectiveDef[] | null = null;
  /** The free 4th card of the open draft (`EVOLUTION READY`), or null. */
  draftProtocol: ProtocolDef | null = null;
  /** Tonight's plan, kept for the telegraph arrows. */
  plan: NightPlan | null = null;
  outcome: SessionOutcome | null = null;
  result: LandingResult | null = null;

  readonly state: ColonyState;
  private readonly threat: ThreatPort;
  private readonly rng: Rng;
  private readonly banks: boolean;

  constructor(state: ColonyState, threat: ThreatPort, host: RunDirectorHost, rng: Rng, opts: ColonyDirectorOptions = {}) {
    this.state = state;
    this.banks = opts.bank !== false;
    this.threat = threat;
    this.rng = rng;
    this.table = buildSolTable();
    this.run = new RunDirector(host, [], buildPhases(this.table), () => undefined);
    // Ark nodes unlock directives / protocols by id (`ArkNode.unlocks`).
    const ark = state.setup.ark;
    this.pool = unlockedPool([...ark, ...ARK_NODES.filter((n) => ark.includes(n.id)).flatMap((n) => n.unlocks)]);
    this.landingPickPending = !state.setup.ftue;
    this.matronsSeen = state.matronsKilled;
    host.events.once('shutdown', () => {
      this.stopped = true;
    });
    state.onStateEvent = (e: StateEvent) => this.emit(e);
    this.writeClock();
  }

  on(listener: (e: ColonyEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private emit(e: ColonyEvent): void {
    for (const l of [...this.listeners]) l(e);
  }

  get sol(): number {
    return (this.table[this.solIdx] ?? this.table[this.table.length - 1])?.sol ?? 1;
  }

  get window(): SolWindow {
    const w = this.table[this.solIdx] ?? this.table[this.table.length - 1];
    if (w === undefined) throw new Error('colony: empty sol table');
    return w;
  }

  get elapsedSeconds(): number {
    return this.run.elapsedSeconds;
  }

  /** Seconds left until the Long Night deadline (the Landing's hard cap). */
  get remainingSeconds(): number {
    const last = this.table[this.table.length - 1];
    return Math.max(0, (last?.nightEnd ?? 0) - this.elapsedSeconds);
  }

  get difficulty(): number {
    return this.run.difficulty;
  }

  /** Draft rerolls left (lives on the state: relics, trophies and orders grant them). */
  get rerolls(): number {
    return this.state.rerolls;
  }

  get isPaused(): boolean {
    return this.userPaused || this.draftCards !== null;
  }

  get ended(): boolean {
    return this.outcome !== null;
  }

  get progress(): number | null {
    const w = this.window;
    const share = Math.min(1, (this.elapsedSeconds - w.dayStart) / Math.max(1, w.nightEnd - w.dayStart));
    return this.state.beacon === 'launched' ? 1 : (w.sol - 1 + share) / COLONY_TUNING.sol.count;
  }

  pause(): void {
    this.userPaused = true;
  }

  resume(): void {
    this.userPaused = false;
  }

  update(deltaMs: number): void {
    if (this.stopped || this.ended || deltaMs <= 0) return;
    // Draft-only pause (not the player's or the coach's): dawn already called
    // `retreat()`, so keep the retreating fauna walking off instead of freezing
    // beside buildings while the modal is open. Retreating fauna can neither
    // attack nor be hurt (ThreatDev guarantee); nothing else advances.
    if (!this.userPaused && this.draftCards !== null && this.threat.liveCount > 0) {
      this.threat.tick(deltaMs / 1000, this.state);
      return;
    }
    if (this.isPaused) return;
    if (this.landingPickPending) {
      this.landingPickPending = false;
      this.openDraft();
      if (this.isPaused) return;
    }
    this.run.update(deltaMs);
    const dt = deltaMs / 1000;
    const t = this.elapsedSeconds;
    this.advanceClock(t);
    if (this.isPaused || this.ended) return;
    this.queue.sort((a, b) => a.at - b.at);
    while (this.queue.length > 0 && (this.queue[0]?.at ?? Infinity) <= t) {
      const s = this.queue.shift();
      if (s === undefined) break;
      this.threat.spawn(s.id, s.edge, this.difficulty);
      if (s.id === 'matron' || s.id === 'titan') {
        this.state.alphaAlive += 1;
        this.emit({ type: 'alpha', id: s.id });
      }
    }
    if (this.state.clock.phase === 'long-night') this.dripLongNight(dt);
    this.tickAcc += dt;
    const step = COLONY_TUNING.power.tickSec;
    while (this.tickAcc >= step) {
      this.tickAcc -= step;
      this.state.tick(step);
    }
    this.threat.tick(dt, this.state);
    // Threat-side stock writes (Chitin Salvage `kill.ferrite`) respect storage too.
    this.state.clampStock();
    this.onKills();
    this.writeClock();
    // Night dead air (critic2 #4): tonight's spawns are all out and nothing is near the field.
    this.state.nightClear =
      this.state.clock.phase === 'night' && this.queue.length === 0 && this.state.faunaNearField === 0 && this.state.beacon !== 'charging';
    this.checkOutcome();
  }

  /** Matron deaths since the last frame: trophy reroll + `killAlpha` orders. */
  private onKills(): void {
    const killed = this.state.matronsKilled - this.matronsSeen;
    if (killed <= 0) return;
    this.matronsSeen = this.state.matronsKilled;
    this.state.alphaAlive = Math.max(0, this.state.alphaAlive - killed);
    this.state.rerolls += killed;
    onAlphaKilled(this.state);
  }

  /** Advances whole simulated seconds (dev `skipTime`); stops early for a draft or the end. */
  skip(seconds: number): void {
    const until = this.elapsedSeconds + seconds;
    while (this.elapsedSeconds < until - 1e-6 && !this.isPaused && !this.ended) {
      this.update(Math.min(100, (until - this.elapsedSeconds) * 1000));
    }
  }

  /**
   * SKIP TO DAWN (critic2 #4): fast-forwards the rest of a cleared night in
   * model steps (rations, production and heat still run) until dawn fires.
   */
  skipNight(): boolean {
    if (this.ended || this.isPaused || !this.state.nightClear) return false;
    const idx = this.solIdx;
    while (this.solIdx === idx && !this.ended && !this.isPaused && !this.stopped) this.update(SKIP_STEP_MS);
    return true;
  }

  /** Seconds to the next dusk or dawn boundary (dev `skipTime` default). */
  secondsToNextBoundary(): number {
    const t = this.elapsedSeconds;
    const w = this.window;
    const next = t < w.duskStart ? w.duskStart : w.nightEnd;
    return Math.max(0.1, next - t + 0.05);
  }

  private writeClock(): void {
    const t = this.elapsedSeconds;
    const w = this.window;
    const c = this.state.clock;
    const longNight = w.sol === COLONY_TUNING.sol.count && t >= w.nightStart;
    c.sol = w.sol;
    c.elapsedSec = t;
    c.phase = longNight ? 'long-night' : t >= w.nightStart ? 'night' : t >= w.duskStart ? 'dusk' : 'day';
    c.phaseLeftSec = Math.max(0, (c.phase === 'day' ? w.duskStart : c.phase === 'dusk' ? w.nightStart : w.nightEnd) - t);
    c.longNightSec = longNight ? t - w.nightStart : 0;
    c.tempC = nightTempC(w.sol, c.phase, c.longNightSec, this.state.tempOffsetC);
  }

  private advanceClock(t: number): void {
    const w = this.window;
    if (!this.duskFired && t >= w.duskStart) {
      this.duskFired = true;
      this.onDusk(w);
    }
    if (!this.nightFired && t >= w.nightStart) {
      this.nightFired = true;
      this.writeClock();
      this.emit({ type: 'nightfall', sol: w.sol, tempC: this.state.clock.tempC });
    }
    if (t >= w.nightEnd) {
      if (w.sol >= COLONY_TUNING.sol.count) {
        this.finish({ won: false, reason: 'frozen' });
        return;
      }
      this.onDawn();
    }
  }

  private onDusk(w: SolWindow): void {
    const S = COLONY_TUNING.swarm;
    if (w.sol >= COLONY_TUNING.sol.count) {
      this.plan = this.threat.planLongNight();
      this.state.tonight = { edges: this.plan.edges, totalFauna: this.plan.totalFauna };
      this.emit({ type: 'dusk', sol: w.sol, plan: this.plan });
      return;
    }
    const night = SWARM_NIGHTS.find((n) => n.sol === w.sol);
    if (night === undefined) return;
    const plan = this.threat.planNight(night, swarmScale(this.state, w.sol), loudestQuadrant(this.state), this.rng);
    const units: FaunaId[] = [];
    for (const c of plan.counts) {
      if (c.id === night.alpha) continue;
      for (let i = 0; i < c.count; i += 1) units.push(c.id);
    }
    this.rng.shuffle(units);
    const start = w.duskStart + S.emergeDelaySec;
    const span = Math.max(1, (w.nightEnd - w.duskStart) * S.dripShare - S.emergeDelaySec);
    // The night's alpha emerges FIRST (queued ahead of the drip at the same `start`; the sort is stable):
    // spawned at nightfall it arrived as the night ended and retreated unfought (Balance: 0 Matron kills in 16 Landings).
    let total = plan.totalFauna;
    if (night.alpha !== null) this.queue.push({ at: start, id: night.alpha, edge: plan.edges[0] ?? 0 });
    // Nacre Shelf: an extra Matron on the site's sol.
    if (this.state.site.extraMatronSol === w.sol) {
      this.queue.push({ at: start, id: 'matron', edge: plan.edges[plan.edges.length - 1] ?? 0 });
      total += 1;
    }
    units.forEach((id, i) => {
      const edge = plan.edges[i % plan.edges.length] ?? 0;
      this.queue.push({ at: start + (span * i) / Math.max(1, units.length), id, edge });
    });
    this.plan = total === plan.totalFauna ? plan : { ...plan, totalFauna: total };
    this.state.tonight = { edges: plan.edges, totalFauna: total };
    this.emit({ type: 'dusk', sol: w.sol, plan: this.plan });
  }

  private dripLongNight(dt: number): void {
    const S = COLONY_TUNING.swarm;
    this.skitterDrip += dt;
    this.bruteDrip += dt;
    while (this.skitterDrip >= S.longNightSkitterEverySec) {
      this.skitterDrip -= S.longNightSkitterEverySec;
      this.threat.spawn('skitter', this.rng.int(0, 3) as 0 | 1 | 2 | 3, this.difficulty);
    }
    while (this.bruteDrip >= S.longNightBruteEverySec) {
      this.bruteDrip -= S.longNightBruteEverySec;
      this.threat.spawn('brute', this.rng.int(0, 3) as 0 | 1 | 2 | 3, this.difficulty);
    }
  }

  private onDawn(): void {
    const state = this.state;
    this.threat.retreat();
    this.queue.length = 0;
    this.plan = null;
    state.tonight = null;
    state.nightClear = false;
    state.alphaAlive = 0;
    this.solIdx += 1;
    this.duskFired = false;
    this.nightFired = false;
    const sol = this.sol;
    this.writeClock();
    if (state.beacon === 'locked' && sol >= state.beaconUnlockSol) state.beacon = 'unbuilt';
    // A new day relights the grid: shed relays come back before the relink and
    // mend (critic final: a relay ruin behind a shed relay sat dark through two
    // dawns). The brownout re-sheds by priority if the day is still short.
    for (const b of state.buildings.values()) if (b.def === 'relay_pylon') b.shed = false;
    // Also claims relics gated by `firstSol` on the first dawn they open.
    computeField(state);
    const mended = dawnMend(state) + state.dawnRebuildWalls();
    const { arrivals, deaths } = dawnColonists(state, sol);
    const refilled = dawnRequests(state, sol, this.rng);
    state.buildingsLostTonight = 0;
    state.stress = Math.max(0, state.stress - COLONY_TUNING.power.stressDecayPerDawn);
    this.emit({ type: 'dawn', sol, arrivals, deaths, mended });
    if (refilled) this.emit({ type: 'orders', sol });
    for (const b of BUILDINGS) {
      const at = b.id === 'beacon_spire' ? state.beaconUnlockSol : b.unlockSol;
      if (at === sol) this.emit({ type: 'unlock', building: b.id });
    }
    if (sol >= COLONY_TUNING.draft.firstSol) this.openDraft();
  }

  /** Opens a draft: the directive cards plus, when one is ready, the protocol as a free 4th card. */
  private openDraft(): void {
    const cards = drawDirectives(this.pool.directives, this.state.owned, this.draftIndex, this.rng, Math.max(1, Math.round(colonyStat(this.state, 'draft.choices', COLONY_TUNING.draft.choices))));
    const protocol = protocolReady(this.state, [...this.state.owned, ...this.state.evolved], this.pool.protocols);
    if (cards.length === 0 && protocol === null) return;
    this.draftCards = cards;
    this.draftProtocol = protocol;
    this.emitDraft();
  }

  private emitDraft(): void {
    if (this.draftCards === null) return;
    this.emit({ type: 'draft', sol: this.sol, cards: this.draftCards.map((c) => c.id), protocol: this.draftProtocol?.id ?? null, rerolls: this.state.rerolls });
  }

  /**
   * Picks a card from the open draft. The protocol card evolves (Apex, mk 4,
   * `evolved`) and leaves the directive pick open; a directive closes the draft.
   */
  pick(directiveOrProtocolId: string): void {
    if (this.draftCards === null) return;
    if (this.draftProtocol !== null && this.draftProtocol.id === directiveOrProtocolId) {
      this.draftProtocol = null;
      if (this.state.evolve(directiveOrProtocolId)) this.emit({ type: 'evolved', protocol: directiveOrProtocolId });
      if (this.draftCards.length === 0) this.closeDraft();
      else this.emitDraft();
      return;
    }
    if (!this.draftCards.some((c) => c.id === directiveOrProtocolId)) return;
    this.state.own(directiveOrProtocolId);
    this.closeDraft();
  }

  private closeDraft(): void {
    this.draftCards = null;
    this.draftProtocol = null;
    this.draftIndex += 1;
  }

  reroll(): boolean {
    if (this.draftCards === null || this.state.rerolls <= 0) return false;
    const shown = this.draftCards.map((c) => c.id);
    const cards = drawDirectives(this.pool.directives, [...this.state.owned, ...shown], this.draftIndex, this.rng, Math.max(1, Math.round(colonyStat(this.state, 'draft.choices', COLONY_TUNING.draft.choices))));
    if (cards.length === 0) return false;
    this.state.rerolls -= 1;
    this.draftCards = cards;
    this.emitDraft();
    return true;
  }

  /**
   * BEACON: with the Spire standing and lit and `cellsNeeded` Lumen Cells in
   * stock, spends the cells and starts the charge. The first trigger summons
   * the Chorus from all four edges (titan at `swarm.titanDelaySec`).
   */
  triggerBeacon(): boolean {
    const state = this.state;
    if (this.ended || state.beacon !== 'ready') return false;
    let spire = false;
    for (const b of state.buildings.values()) if (b.def === 'beacon_spire' && b.lit) spire = true;
    const cells = state.cellsNeeded;
    if (!spire || state.stock.cell < cells) return false;
    state.stock.cell -= cells;
    state.beacon = 'charging';
    state.beaconCharge = 0;
    if (!this.chorusSummoned) {
      this.chorusSummoned = true;
      const plan = this.threat.planChorus(Math.max(0, colonyStat(state, 'chorus.scale', 1)));
      const S = COLONY_TUNING.swarm;
      const t = this.elapsedSeconds;
      const units: FaunaId[] = [];
      for (const c of plan.counts) {
        for (let i = 0; i < c.count; i += 1) {
          if (c.id === 'titan') this.queue.push({ at: t + S.titanDelaySec, id: 'titan', edge: plan.edges[i % plan.edges.length] ?? 0 });
          else units.push(c.id);
        }
      }
      this.rng.shuffle(units);
      units.forEach((id, i) => {
        this.queue.push({ at: t + 2 + (S.chorusSec * i) / Math.max(1, units.length), id, edge: plan.edges[i % plan.edges.length] ?? 0 });
      });
      this.plan = plan;
    }
    this.emit({ type: 'beacon', state: 'charging' });
    return true;
  }

  abandon(): void {
    this.finish({ won: false, reason: 'abandoned' });
  }

  /** Stores the unbanked abandoned-result checkpoint (§14b law 6); a no-op once the Landing has ended and settled. */
  checkpoint(): void {
    if (this.ended || !this.banks) return;
    checkpointLanding(this.state, this.elapsedSeconds);
  }

  private checkOutcome(): void {
    const core = this.state.core;
    if (core === undefined || core.hp <= 0) {
      this.finish({ won: false, reason: 'core-lost' });
      return;
    }
    if (this.state.colonists <= 0) {
      this.finish({ won: false, reason: 'colony-lost' });
      return;
    }
    if (this.state.beacon === 'charging' && this.state.beaconCharge >= 1) {
      this.state.beacon = 'launched';
      this.threat.retreat();
      this.queue.length = 0;
      this.emit({ type: 'beacon', state: 'launched' });
      this.finish({ won: true, reason: 'beacon' });
    }
  }

  /** Resolves the Landing once: `settleLanding` banks it (the only bank on this path) and clears the checkpoint; headless directors only compute it. */
  private finish(outcome: SessionOutcome): void {
    if (this.outcome !== null) return;
    this.outcome = outcome;
    this.draftCards = null;
    this.draftProtocol = null;
    this.state.nightClear = false;
    this.result = this.banks ? settleLanding(this.state, outcome, this.elapsedSeconds) : computeLanding(this.state, outcome, this.elapsedSeconds);
    this.emit({ type: 'ended', result: this.result });
  }
}


/**
 * Dawn auto-mend (PRD §5.1): relay ruins are rebuilt first (`relinkRelays`,
 * counted in `mended` and `state.lastRelinked`), then lit damaged buildings
 * repair (core first),
 * paying Fe for the share repaired; partial when the budget
 * (`mend.maxStockShare` of stock) runs out. Writes `state.lastMendCost`.
 */
function dawnMend(state: ColonyState): number {
  const M = COLONY_TUNING.mend;
  let budget = state.stock.ferrite * M.maxStockShare;
  // Relink the grid first: relay ruins stand again before any repair.
  const relink = state.relinkRelays(budget);
  state.lastRelinked = relink.rebuilt;
  budget -= relink.spent;
  let spent = relink.spent;
  let mended = relink.rebuilt;
  const repairBudget = budget;
  const order = [...state.buildings.values()].sort((a, b) => (a.def === 'lander_core' ? -1 : b.def === 'lander_core' ? 1 : a.uid - b.uid));
  for (const b of order) {
    if (!b.lit || b.hp >= b.maxHp) continue;
    const cost = buildingDef(b.def).cost;
    let feValue = b.def === 'lander_core' ? M.coreFeValue : 0;
    for (const g of GOODS) {
      const v = cost[g] ?? 0;
      feValue += g === 'alloy' ? v * M.alloyFeValue : g === 'prism' ? v * M.prismFeValue : g === 'ferrite' ? v : 0;
    }
    const missing = (b.maxHp - b.hp) / b.maxHp;
    const price = missing * feValue * M.dawnFeEfficiency;
    // No single repair (usually the core) takes more than its share of the repair budget.
    const share = price <= 0 ? 1 : Math.min(1, Math.max(0, Math.min(budget, repairBudget * M.singleRepairShare)) / price);
    budget -= price * share;
    spent += price * share;
    state.stock.ferrite -= price * share;
    b.hp += (b.maxHp - b.hp) * share;
    if (share > 0) mended += 1;
  }
  state.lastMendCost = spent;
  return mended;
}
