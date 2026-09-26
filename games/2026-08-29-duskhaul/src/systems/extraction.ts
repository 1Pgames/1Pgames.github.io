/**
 * Extraction gates, conditional extracts, Collapse clock and Greed meter for
 * Duskhaul V2 (PRD-V2 §2.2-2.3, §5.25-5.26, §16.1 E27/E28).
 *
 * Pure TypeScript (no Phaser) — the balance sim ticks this class in Node. All
 * timing derives from the deltas fed in; the Collapse ring radius is a CLOSED
 * FORM of collapse time, so any tick size produces the same geometry.
 *
 * ## Gates
 * `map.gates` carries exactly A, B, C (kind `timed`) and one conditional `x`:
 *  - `toll`     opens/closes per the candidate; the channel START charges the toll,
 *  - `offering` opens per the candidate, never closes; the channel START sacrifices
 *               the highest-value carried item,
 *  - `bell`     opens when `TUNING.gates.bell.bells` bells were rung (`ringBell`)
 *               and closes `gates.bell.openS` seconds later.
 * The condition is paid through `hooks.payCondition(gate)` exactly once per gate;
 * a refused payment blocks that gate's channel until the hero leaves and
 * re-enters its ring (so the hook is not spammed every frame).
 *
 * ## The channel rule (law, §2.3)
 * A hit rolls accrued channel ms back by `hitSetbackMs` (never a reset) and
 * freezes accrual for `hitStallMs`; accrual runs at `contestedRate` while
 * enemies stand in the ring, minus `eliteContestPenalty` per elite, floored at
 * `minRate`. Completability: `(invulnMs − hitStallMs)·minRate > hitSetbackMs`.
 */
import { TUNING } from '../config';
import type { ExtractionHooks, GateCandidate, GateId, GateKind, MinimapModel, RunLoadoutV2 } from '../data/types-v2';

export type GateState = 'closed' | 'open' | 'closing' | 'spent';

export type ExtractionEvent = 'gate-open' | 'gate-close' | 'collapse' | 'extracted';

/** Enemy pressure inside the channelling gate's ring, counted by the caller. */
export interface ChannelContest {
  /** Every hostile inside `radius` of the gate, elites/boss included. */
  enemies: number;
  /** How many of those are elites or bosses (each costs `eliteContestPenalty`). */
  elites: number;
}

/** `TUNING.extract` keys the channel reads (pass the section whole). */
export interface ChannelTuning {
  channelMs: number;
  hitSetbackMs: number;
  hitStallMs: number;
  contestedRate: number;
  eliteContestPenalty: number;
  minRate: number;
  suppressRadius: number;
  contestedInferMs: number;
  channelMsDelta: number;
  channelMsFloor: number;
}

/** `TUNING.collapse` keys (pass the section whole). */
export interface CollapseTuning {
  atS: number;
  centerGate: 'a' | 'b' | 'c';
  startPad: number;
  minStart: number;
  maxStart: number;
  minRadius: number;
  ringSpeedPxPerS: number;
  ringAccel: number;
  ringSpeedMax: number;
  fireDps: number;
  fireDpsStep: number;
  fireDpsMax: number;
  threatStep: number;
  stepEveryS: number;
  eliteEveryS: number;
  stopTrashDrip: boolean;
  spawnFloorMs: number;
}

/**
 * §16.1 tuning triple plus optional overrides of `TUNING.extract` /
 * `TUNING.collapse` (omitted keys read TUNING directly — no second copy).
 */
export interface ExtractionTuning {
  channelMs: number;
  radius: number;
  /** Seconds into the run the Collapse ignites (hazard `collapseAtS`). */
  collapseAtS: number;
  closingWarnS?: number;
  channel?: Partial<ChannelTuning>;
  collapse?: Partial<CollapseTuning>;
}

/**
 * §16.1 E28 / §5.26 Greed multiplier:
 * `1 + greed.stepPct/100 · floor(max(0, t − greed.startS)/greed.stepS)`, capped
 * at `maxMul` (`loadout.greedMaxMul`: 1.25, 1.4 with `g_greedcap`).
 */
export function greedMul(elapsedS: number, maxMul: number): number {
  const g = TUNING.greed;
  const steps = Math.floor(Math.max(0, elapsedS - g.startS) / g.stepS);
  // Integer percent arithmetic keeps 1.1 / 1.5 exact (no 1.4000000000000001).
  return Math.min(maxMul, (100 + g.stepPct * steps) / 100);
}

/** Worst-case ms to fill the channel under UNBROKEN contact (a hit every `invulnMs`). Infinity when not completable. */
export function worstCaseChannelMs(channel: ChannelTuning, invulnMs: number, elitesInRing = 0): number {
  const rate = Math.max(
    channel.minRate,
    Math.min(1, channel.contestedRate - channel.eliteContestPenalty * Math.max(0, elitesInRing)),
  );
  const netPerCycle = (invulnMs - channel.hitStallMs) * rate - channel.hitSetbackMs;
  if (netPerCycle <= 0) return Infinity;
  const total = Math.max(channel.channelMsFloor, channel.channelMs + channel.channelMsDelta);
  return (total / netPerCycle) * invulnMs;
}

/** The completability law (§2.3). */
export function channelCompletableUnderContact(channel: ChannelTuning, invulnMs: number): boolean {
  return (invulnMs - channel.hitStallMs) * channel.minRate > channel.hitSetbackMs;
}

/**
 * The ONE channel accrual rule (§2.3), shared by gates and POI channels (§5.12
 * "channel rules as gate"): 1.0 when the ring is clear, else `contestedRate`
 * minus `eliteContestPenalty` per elite, floored at `minRate`.
 */
export function channelAccrualRate(t: ChannelTuning, contest: ChannelContest): number {
  if (contest.enemies <= 0) return 1;
  return Math.max(t.minRate, Math.min(1, t.contestedRate - t.eliteContestPenalty * Math.max(0, contest.elites)));
}

interface GateRuntime {
  gate: GateCandidate;
  state: GateState;
  /** Scheduled open second; `null` = not yet scheduled (bell gate before its bells). */
  opensS: number | null;
  closesS: number | null;
  /** Condition paid (toll/offering) — never charged twice. */
  paid: boolean;
}

export class ExtractionSystem {
  readonly channelTuning: ChannelTuning;
  readonly collapseTuning: CollapseTuning;

  private readonly radius: number;
  private readonly collapseAtS: number;
  private readonly closingWarnS: number;
  private readonly windowBonusS: number;
  /** Toll share the label prints (`loadout.tollPct`: 25%, 15% with `e_toll`). */
  private readonly tollPct: number;
  private readonly channelMsTotal: number;
  private readonly runtimes: GateRuntime[];
  private readonly hooks: ExtractionHooks;

  private elapsedMs = 0;
  private bells = 0;
  private channelMsAccum = 0;
  private channelGateId: GateId | null = null;
  /** Conditional gate whose payment was refused while the hero stays in its ring. */
  private refusedGateId: GateId | null = null;
  private stallMsLeft = 0;
  private inferredContestMsLeft = 0;
  private rateLast = 1;
  private interruptedThisFrame = false;
  private collapseState: { active: boolean; ringRadius: number } | null = null;
  private collapseMsElapsed = 0;
  private collapseStartRadiusPx = 0;
  private collapseCenter = { x: 0, y: 0 };
  private hasExtracted = false;
  private extractedGateId: GateId | null = null;

  constructor(gates: GateCandidate[], tuning: ExtractionTuning, loadout: RunLoadoutV2, hooks: ExtractionHooks) {
    this.hooks = hooks;
    this.channelTuning = {
      ...TUNING.extract,
      ...tuning.channel,
      channelMs: tuning.channelMs,
      channelMsDelta: (tuning.channel?.channelMsDelta ?? TUNING.extract.channelMsDelta) + loadout.channelMsDelta,
      contestedRate: loadout.contestedRate > 0 ? loadout.contestedRate : (tuning.channel?.contestedRate ?? TUNING.extract.contestedRate),
    };
    this.collapseTuning = { ...TUNING.collapse, ...tuning.collapse };
    this.radius = tuning.radius;
    this.collapseAtS = tuning.collapseAtS;
    this.closingWarnS = tuning.closingWarnS ?? TUNING.gate.closingWarnS;
    this.windowBonusS = Math.max(0, loadout.gateWindowBonusS);
    this.tollPct = loadout.tollPct;
    this.channelMsTotal = Math.max(
      this.channelTuning.channelMsFloor,
      this.channelTuning.channelMs + this.channelTuning.channelMsDelta,
    );
    this.runtimes = gates.map((gate) => ({
      gate,
      state: 'closed',
      opensS: gate.kind === 'bell' ? null : gate.opensS,
      // mapgen already folded `gateWindowBonusS` into every scheduled closesS;
      // only the condition-driven Bell window is timed here (ringBell).
      closesS: gate.kind === 'bell' ? null : gate.closesS,
      paid: gate.kind === 'timed' || gate.kind === 'bell',
    }));
  }

  get gates(): readonly GateCandidate[] {
    return this.runtimes.map((r) => r.gate);
  }

  get elapsedS(): number {
    return this.elapsedMs / 1000;
  }

  get channelMsEffective(): number {
    return this.channelMsTotal;
  }

  get channelProgress(): number {
    return Math.min(1, this.channelMsAccum / this.channelMsTotal);
  }

  get channelMsRemaining(): number {
    return Math.max(0, this.channelMsTotal - this.channelMsAccum);
  }

  get channelingGate(): GateId | null {
    return this.channelGateId;
  }

  get channelRate(): number {
    return this.rateLast;
  }

  get channelStallMs(): number {
    return this.stallMsLeft;
  }

  get channelStalled(): boolean {
    return this.stallMsLeft > 0;
  }

  /** True only on the frame a hit rolled the channel back (HUD interrupt flash). */
  get channelInterrupted(): boolean {
    return this.interruptedThisFrame;
  }

  /** Bells rung so far (`BELLS n/2`). */
  get bellsRung(): number {
    return this.bells;
  }

  get collapse(): { active: boolean; ringRadius: number } | null {
    return this.collapseState;
  }

  get collapseElapsedS(): number {
    return this.collapseMsElapsed / 1000;
  }

  get collapseRingCenter(): { x: number; y: number } {
    return this.collapseCenter;
  }

  get collapseRingStartRadius(): number {
    return this.collapseStartRadiusPx;
  }

  get collapseRingSpeed(): number {
    if (this.collapseState === null) return 0;
    const c = this.collapseTuning;
    return Math.min(c.ringSpeedMax, c.ringSpeedPxPerS + c.ringAccel * this.collapseElapsedS);
  }

  get collapseFireDps(): number {
    if (this.collapseState === null) return 0;
    const c = this.collapseTuning;
    return Math.min(c.fireDpsMax, c.fireDps + c.fireDpsStep * this.rampSteps());
  }

  get collapseThreatBonus(): number {
    if (this.collapseState === null) return 0;
    return this.collapseTuning.threatStep * this.rampSteps();
  }

  /** Collapse elites the schedule says should exist by now; the caller covers the difference. */
  get collapseEliteQuota(): number {
    if (this.collapseState === null || this.collapseTuning.eliteEveryS <= 0) return 0;
    return Math.floor(this.collapseElapsedS / this.collapseTuning.eliteEveryS);
  }

  /** 0..1 progress toward the Collapse (`HudModelV2.darkMeter`). */
  get darkMeter(): number {
    return this.collapseAtS <= 0 ? 1 : Math.min(1, this.elapsedS / this.collapseAtS);
  }

  get suppressRadius(): number {
    return this.channelTuning.suppressRadius;
  }

  get extracted(): boolean {
    return this.hasExtracted;
  }

  get extractedGate(): GateId | null {
    return this.extractedGateId;
  }

  /** Kind of the gate that completed the channel (RunReport.gate). */
  get extractedGateKind(): GateKind | null {
    return this.runtimes.find((r) => r.gate.id === this.extractedGateId)?.gate.kind ?? null;
  }

  gateState(id: GateId): GateState {
    return this.runtimes.find((r) => r.gate.id === id)?.state ?? 'closed';
  }

  /** §16.1 E27 alias of `gateState`. */
  state(id: GateId): GateState {
    return this.gateState(id);
  }

  /** Seconds until the gate's next transition (open, or close); null when none is scheduled. */
  secondsTo(id: GateId): number | null {
    const r = this.runtimes.find((g) => g.gate.id === id);
    if (r === undefined) return null;
    const t = this.elapsedS;
    if (r.state === 'closed') return r.opensS === null ? null : Math.max(0, r.opensS - t);
    if ((r.state === 'open' || r.state === 'closing') && r.closesS !== null) return Math.max(0, r.closesS - t);
    return null;
  }

  /** True inside the suppression radius of an open/closing gate — the spawner rejects the spot. */
  spawnSuppressed(x: number, y: number): boolean {
    const r = this.channelTuning.suppressRadius;
    if (r <= 0) return false;
    const r2 = r * r;
    for (const g of this.runtimes) {
      if (g.state !== 'open' && g.state !== 'closing') continue;
      const dx = x - g.gate.x;
      const dy = y - g.gate.y;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  }

  /** True within `px` of an open/closing gate (Sanctum Homeward `e_speedgate`). */
  nearOpenGate(x: number, y: number, px: number): boolean {
    const r2 = px * px;
    for (const g of this.runtimes) {
      if (g.state !== 'open' && g.state !== 'closing') continue;
      const dx = x - g.gate.x;
      const dy = y - g.gate.y;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  }

  /**
   * A bell POI finished its 2 s stand (§5.25). When the bell count reaches
   * `gates.bell.bells` a bell conditional opens NOW for `gates.bell.openS` s
   * (+ Duskmirror window bonus).
   */
  ringBell(): void {
    if (this.hasExtracted) return;
    this.bells += 1;
    if (this.bells !== TUNING.gates.bell.bells) return;
    const bell = this.runtimes.find((r) => r.gate.kind === 'bell');
    if (bell === undefined) return;
    bell.opensS = this.elapsedS;
    bell.closesS = this.elapsedS + TUNING.gates.bell.openS + this.windowBonusS;
    this.advanceGates(this.elapsedS);
  }

  /**
   * Pulls a still-closed gate's opening forward (Wicket: the locket pickup
   * opens Gate A early). New open time = min(scheduled, max(atS, now));
   * closesS unchanged; no-op for gates that are open, spent or unscheduled.
   */
  openEarly(id: GateId, atS: number): void {
    const r = this.runtimes.find((g) => g.gate.id === id);
    if (r === undefined || r.state !== 'closed' || r.opensS === null) return;
    r.opensS = Math.min(r.opensS, Math.max(atS, this.elapsedS));
    this.advanceGates(this.elapsedS);
  }

  /** §16.1 E27: minimap/compass rows. */
  view(): MinimapModel['gates'] {
    return this.runtimes.map((r) => ({
      id: r.gate.id,
      kind: r.gate.kind,
      x: r.gate.x,
      y: r.gate.y,
      state: r.state,
      label: this.label(r),
    }));
  }

  /**
   * Advance one ticking frame. `tookHit` = the player took damage since the
   * last tick; `contest` = enemy census inside the channelling ring (omit ⇒
   * inferred from recent hits for headless callers).
   */
  update(deltaMs: number, playerX: number, playerY: number, tookHit: boolean, contest?: ChannelContest): void {
    if (this.hasExtracted || deltaMs <= 0) return;
    this.interruptedThisFrame = false;
    this.elapsedMs += deltaMs;
    const seconds = this.elapsedS;
    this.advanceGates(seconds);
    this.advanceCollapse(seconds, deltaMs, playerX, playerY);
    this.advanceChannel(deltaMs, playerX, playerY, tookHit, contest);
  }

  /** Closed-form ring radius (ramped speed, holds at `minRadius`). */
  private ringRadiusAt(collapseS: number): number {
    const c = this.collapseTuning;
    const t = Math.max(0, collapseS);
    const rampS = c.ringAccel > 0 ? Math.max(0, (c.ringSpeedMax - c.ringSpeedPxPerS) / c.ringAccel) : Infinity;
    let swept: number;
    if (t <= rampS) {
      swept = c.ringSpeedPxPerS * t + (c.ringAccel * t * t) / 2;
    } else {
      const atCap = c.ringSpeedPxPerS * rampS + (c.ringAccel * rampS * rampS) / 2;
      swept = atCap + c.ringSpeedMax * (t - rampS);
    }
    return Math.min(this.collapseStartRadiusPx, Math.max(c.minRadius, this.collapseStartRadiusPx - swept));
  }

  // ─── internals ───

  private label(r: GateRuntime): string {
    const t = this.elapsedS;
    const clock = (s: number): string => {
      const whole = Math.max(0, Math.ceil(s));
      return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
    };
    let state: string;
    if (r.state === 'spent') state = 'SPENT';
    else if (r.state === 'closed') state = r.opensS === null ? '' : `OPENS ${clock(r.opensS - t)}`;
    else if (r.state === 'closing') state = `CLOSING ${clock((r.closesS ?? t) - t)}`;
    else state = r.closesS === null ? 'OPEN' : `OPEN · ${clock(r.closesS - t)}`;
    let condition = '';
    if (r.gate.kind === 'toll') condition = `TOLL ${Math.round(this.tollPct * 100)}%`;
    else if (r.gate.kind === 'offering') condition = 'OFFERING';
    else if (r.gate.kind === 'bell') condition = `BELLS ${Math.min(this.bells, TUNING.gates.bell.bells)}/${TUNING.gates.bell.bells}`;
    if (condition === '') return state;
    return state === '' ? condition : `${condition} · ${state}`;
  }

  private advanceGates(seconds: number): void {
    for (const r of this.runtimes) {
      if (r.state === 'spent') continue;
      const target = this.scheduledState(r, seconds);
      if (target === r.state) continue;
      const before = r.state;
      r.state = target;
      if (before === 'closed' && (target === 'open' || target === 'closing')) this.hooks.onEvent('gate-open', r.gate);
      if (target === 'spent') {
        if (this.channelGateId === r.gate.id) this.resetChannel();
        this.hooks.onEvent('gate-close', r.gate);
      }
    }
  }

  private scheduledState(r: GateRuntime, seconds: number): GateState {
    if (r.opensS === null || seconds < r.opensS) return 'closed';
    if (r.closesS === null) return 'open';
    if (seconds >= r.closesS) return 'spent';
    if (seconds >= r.closesS - this.closingWarnS) return 'closing';
    return 'open';
  }

  private advanceCollapse(seconds: number, deltaMs: number, playerX: number, playerY: number): void {
    if (seconds < this.collapseAtS) return;
    const c = this.collapseTuning;
    if (this.collapseState === null) {
      // Ignition: start radius derives from the PLAYER's distance to the centre gate.
      const centre = this.runtimes.find((r) => r.gate.id === c.centerGate) ?? this.runtimes[this.runtimes.length - 1];
      this.collapseCenter = centre === undefined ? { x: playerX, y: playerY } : { x: centre.gate.x, y: centre.gate.y };
      const raw = Math.hypot(playerX - this.collapseCenter.x, playerY - this.collapseCenter.y) + c.startPad;
      this.collapseStartRadiusPx = Math.min(c.maxStart, Math.max(c.minStart, raw));
      this.collapseMsElapsed = 0;
      this.collapseState = { active: true, ringRadius: this.collapseStartRadiusPx };
      this.hooks.onEvent('collapse', centre?.gate ?? null);
      return;
    }
    this.collapseMsElapsed += deltaMs;
    this.collapseState.ringRadius = this.ringRadiusAt(this.collapseElapsedS);
  }

  private rampSteps(): number {
    const every = this.collapseTuning.stepEveryS;
    return every <= 0 ? 0 : Math.floor(this.collapseElapsedS / every);
  }

  private advanceChannel(
    deltaMs: number,
    playerX: number,
    playerY: number,
    tookHit: boolean,
    contest: ChannelContest | undefined,
  ): void {
    const t = this.channelTuning;
    if (tookHit) {
      const before = this.channelMsAccum;
      this.channelMsAccum = Math.max(0, this.channelMsAccum - t.hitSetbackMs);
      this.interruptedThisFrame = this.channelMsAccum < before;
      this.stallMsLeft = t.hitStallMs;
      this.inferredContestMsLeft = t.contestedInferMs;
    }
    this.inferredContestMsLeft = Math.max(0, this.inferredContestMsLeft - deltaMs);

    const r = this.gateUnderPlayer(playerX, playerY);
    if (this.refusedGateId !== null && r?.gate.id !== this.refusedGateId) this.refusedGateId = null;
    if (r === null || r.gate.id === this.refusedGateId) {
      // Outside every usable ring: the hold PAUSES (progress kept, stall burns down).
      this.stallMsLeft = Math.max(0, this.stallMsLeft - deltaMs);
      this.rateLast = 0;
      return;
    }
    if (this.channelGateId !== r.gate.id) {
      // Channel START: conditional gates charge their condition exactly once.
      if (!r.paid) {
        if (!this.hooks.payCondition(r.gate)) {
          this.refusedGateId = r.gate.id;
          this.rateLast = 0;
          return;
        }
        r.paid = true;
      }
      this.channelGateId = r.gate.id;
      this.channelMsAccum = 0;
    }

    const stalled = Math.min(this.stallMsLeft, deltaMs);
    this.stallMsLeft -= stalled;
    const rate = this.accrualRate(contest);
    this.rateLast = rate;
    this.channelMsAccum += (deltaMs - stalled) * rate;

    if (this.channelMsAccum >= this.channelMsTotal) {
      this.channelMsAccum = this.channelMsTotal;
      this.hasExtracted = true;
      this.extractedGateId = r.gate.id;
      r.state = 'spent';
      this.hooks.onEvent('extracted', r.gate);
    }
  }

  private accrualRate(contest: ChannelContest | undefined): number {
    if (contest !== undefined) return channelAccrualRate(this.channelTuning, contest);
    return this.inferredContestMsLeft > 0 ? channelAccrualRate(this.channelTuning, { enemies: 1, elites: 0 }) : 1;
  }

  private gateUnderPlayer(px: number, py: number): GateRuntime | null {
    const r2 = this.radius * this.radius;
    for (const r of this.runtimes) {
      if (r.state !== 'open' && r.state !== 'closing') continue;
      const dx = px - r.gate.x;
      const dy = py - r.gate.y;
      if (dx * dx + dy * dy <= r2) return r;
    }
    return null;
  }

  private resetChannel(): void {
    this.channelGateId = null;
    this.channelMsAccum = 0;
    this.stallMsLeft = 0;
  }
}
