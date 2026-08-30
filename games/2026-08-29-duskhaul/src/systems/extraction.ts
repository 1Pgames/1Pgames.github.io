/**
 * Extraction gate state machine + Collapse clock for Duskhaul (PRD §2A/§16.1).
 *
 * Owns the run's real resolution surface: three gates with open/close windows,
 * the hold-to-extract channel, and the post-480s Collapse ring closing on Gate
 * C. The scene (and the headless balance sim) calls
 * `update(deltaMs, px, py, tookHit, contest?)` once per ticking frame and
 * reacts to events.
 *
 * Pure TypeScript, ZERO Phaser imports — the balance sim ticks this class in
 * plain Node. All timing derives from the deltas fed in, so pausing the run
 * simply means "don't call update"; determinism needs no Rng (the schedule is
 * fully scripted) and the ring radius is a CLOSED FORM of collapse time, so a
 * 16ms sim tick and a 33ms frame produce the same geometry.
 *
 * ## The channel rule (post-greybox re-spec, PRD §2A/§7)
 * The greybox zeroed the channel on any hit, which made the deep gates
 * mathematically uncompletable under pressure (analytic ceiling 17.5% at
 * `invulnMs` 700 / `channelMs` 4000; measured plateau 0.13-0.22 over 115s
 * inside Gate B). The rule is now strictly monotone-positive under ANY contact:
 *   - a hit rolls accrued channel ms back by `hitSetbackMs` (flat, clamped at
 *     0 — never a reset, never a % of current progress),
 *   - a hit freezes accrual for `hitStallMs`,
 *   - accrual runs at `contestedRate` while enemies stand in the ring, minus
 *     `eliteContestPenalty` per elite/boss, floored at `minRate`.
 * The invariant that makes it completable (asserted in the selftest):
 *   `(player.invulnMs - hitStallMs) * minRate > hitSetbackMs`.
 */

export interface GateSpec {
  id: 'a' | 'b' | 'c';
  x: number;
  y: number;
  /** Seconds into the run the gate opens. */
  opensS: number;
  /** Seconds into the run the gate closes; `null` = never (Gate C). */
  closesS: number | null;
}

export type GateState = 'closed' | 'open' | 'closing' | 'spent';

export type ExtractionEvent = 'gate-open' | 'gate-close' | 'collapse' | 'extracted';

/** Enemy pressure inside the channelling gate's ring, counted by the caller. */
export interface ChannelContest {
  /** Every hostile inside `radius` of the gate, elites/boss included. */
  enemies: number;
  /** How many of those are elites or the Warden (each costs `eliteContestPenalty`). */
  elites: number;
}

/** `TUNING.extract` — mirrors that section's key names verbatim (PRD §7). */
export interface ChannelTuning {
  /** Base hold duration; `channelMsDelta` (gear) shifts it. */
  channelMs: number;
  /** Flat rollback of ACCRUED channel ms per hit, clamped at 0. */
  hitSetbackMs: number;
  /** Accrual is frozen for this long after a hit. */
  hitStallMs: number;
  /** Accrual rate multiplier while >=1 enemy is inside the ring (1.0 when clear). */
  contestedRate: number;
  /** Subtracted from the rate per elite/boss inside the ring. */
  eliteContestPenalty: number;
  /** Hard floor on the accrual rate — the completability guarantee. */
  minRate: number;
  /** px: no NEW spawn inside this radius of an OPEN gate (enforced by the spawner). */
  suppressRadius: number;
  /**
   * When the caller passes no `ChannelContest` (headless bots without a
   * broad-phase), the ring counts as contested for this long after a hit.
   */
  contestedInferMs: number;
  /** Gear shift on the channel (Gravekey: -800ms). Negative shortens. */
  channelMsDelta: number;
  /** Effective channel never drops below this however much gear stacks. */
  channelMsFloor: number;
}

/** `TUNING.collapse` — mirrors that section's key names verbatim (PRD §7). */
export interface CollapseTuning {
  /**
   * Present so `TUNING.collapse` passes straight through; the CONTRACT field
   * `ExtractionTuning.collapseAtS` is the authority and this is ignored.
   */
  atS: number;
  /** Which gate the dusk-fire ring is centred on. */
  centerGate: 'a' | 'b' | 'c';
  /** Start radius = dist(player, centre gate) at ignition + this pad. */
  startPad: number;
  /** Clamp lo on the start radius. */
  minStart: number;
  /** Clamp hi on the start radius (replaces the greybox's 2340px corner span). */
  maxStart: number;
  /** The ring stops here and HOLDS, so the centre gate stays standable. */
  minRadius: number;
  /** Initial shrink speed, px/s. */
  ringSpeedPxPerS: number;
  /** Shrink acceleration, px/s^2. */
  ringAccel: number;
  /** Cap on the shrink speed, px/s. */
  ringSpeedMax: number;
  /** Fire damage inside the ring at ignition, hp/s (bypasses i-frames). */
  fireDps: number;
  /** hp/s added to the fire per `stepEveryS`. */
  fireDpsStep: number;
  fireDpsMax: number;
  /** Threat multiplier bonus per `stepEveryS`, uncapped (§2A anti-idle). */
  threatStep: number;
  /** Ramp period shared by the fire and threat steps, seconds. */
  stepEveryS: number;
  /** One elite is injected at the ring edge every this many seconds. */
  eliteEveryS: number;
  /** True = the trash drip STOPS at ignition and only Collapse elites spawn. */
  stopTrashDrip: boolean;
  /** Spawn-interval floor while the Collapse runs (read by the spawner). */
  spawnFloorMs: number;
}

/**
 * §16.1 tuning triple plus ADDITIVE nested sections that mirror
 * `TUNING.extract` / `TUNING.collapse` key-for-key. Everything additive is
 * optional and defaulted, so a caller mid-cutover still compiles and the sim
 * can pass the TUNING sections straight through, unrenamed:
 *
 * ```ts
 * new ExtractionSystem(gates, {
 *   channelMs: TUNING.extract.channelMs,
 *   radius: TUNING.gate.radius,
 *   collapseAtS: TUNING.collapse.atS,
 *   closingWarnS: TUNING.gate.closingWarnS,
 *   channel: TUNING.extract,
 *   collapse: TUNING.collapse,
 * });
 * ```
 *
 * The Collapse start radius is NOT a caller input any more: it is latched on
 * the ignition frame from the player's distance to `centerGate` (blocker 2).
 */
export interface ExtractionTuning {
  /** Hold-to-extract duration while inside an open gate ring. */
  channelMs: number;
  /** Gate ring radius in world px — inside it the channel runs. */
  radius: number;
  /** Seconds into the run the Collapse begins. */
  collapseAtS: number;
  /** A gate reads 'closing' inside this many seconds of its close time. */
  closingWarnS?: number;
  /** Duskmirror: every closing gate's window is extended by this many seconds. */
  gateWindowBonusS?: number;
  channel?: Partial<ChannelTuning>;
  collapse?: Partial<CollapseTuning>;
}

/**
 * Defaults for every additive channel key (PRD §7, DesignFix re-spec).
 *
 * MODULE-PRIVATE on purpose: these numbers are a copy of `TUNING.extract`, and
 * every real caller passes that section whole, so an exported table is a second
 * source of truth for the same values. It exists only to give an omitted
 * optional key a defined meaning.
 */
const CHANNEL_DEFAULTS: ChannelTuning = {
  channelMs: 4000,
  hitSetbackMs: 200,
  hitStallMs: 200,
  contestedRate: 0.7,
  eliteContestPenalty: 0.1,
  minRate: 0.55,
  suppressRadius: 400,
  contestedInferMs: 1000,
  channelMsDelta: 0,
  channelMsFloor: 1200,
};

/** As `CHANNEL_DEFAULTS`, for `TUNING.collapse`. Module-private for the same reason. */
const COLLAPSE_DEFAULTS: CollapseTuning = {
  atS: 480,
  centerGate: 'c',
  startPad: 240,
  minStart: 700,
  maxStart: 1200,
  minRadius: 140,
  ringSpeedPxPerS: 22,
  ringAccel: 0.8,
  ringSpeedMax: 90,
  fireDps: 10,
  fireDpsStep: 4,
  fireDpsMax: 60,
  threatStep: 0.4,
  stepEveryS: 10,
  eliteEveryS: 6,
  stopTrashDrip: true,
  spawnFloorMs: 100,
};

const DEFAULT_CLOSING_WARN_S = 15;

/**
 * Worst-case ms of real time to fill the channel under UNBROKEN contact: a hit
 * lands every `invulnMs`, each costing `hitSetbackMs` of accrual and
 * `hitStallMs` of freeze, with the rest accruing at the contested rate. Pure
 * arithmetic on the tuning — the sim gate and the selftest both assert against
 * it instead of re-deriving the algebra.
 *
 * Returns `Infinity` when the tuning is not completable (net accrual <= 0),
 * which is exactly the greybox failure the re-spec removed.
 */
export function worstCaseChannelMs(
  channel: ChannelTuning,
  invulnMs: number,
  elitesInRing = 0,
): number {
  const rate = Math.max(
    channel.minRate,
    Math.min(1, channel.contestedRate - channel.eliteContestPenalty * Math.max(0, elitesInRing)),
  );
  const netPerCycle = (invulnMs - channel.hitStallMs) * rate - channel.hitSetbackMs;
  if (netPerCycle <= 0) return Infinity;
  const total = Math.max(channel.channelMsFloor, channel.channelMs + channel.channelMsDelta);
  return (total / netPerCycle) * invulnMs;
}

/**
 * The completability law (PRD §7): `(invulnMs - hitStallMs) * minRate >
 * hitSetbackMs`. True means progress is strictly monotone-positive under ANY
 * contact, however many elites stand in the ring. Asserted by the selftest so
 * a future retune of `player.invulnMs` cannot silently reinstate blocker 1.
 */
export function channelCompletableUnderContact(channel: ChannelTuning, invulnMs: number): boolean {
  return (invulnMs - channel.hitStallMs) * channel.minRate > channel.hitSetbackMs;
}

interface CollapseState {
  active: boolean;
  ringRadius: number;
}

/**
 * One instance per run. `update` is idempotent after extraction: once
 * `extracted` flips true the system freezes (the run is over).
 */
export class ExtractionSystem {
  /** Gates with the Duskmirror window bonus already applied. */
  readonly gates: readonly GateSpec[];
  /** Resolved channel tuning (defaults merged) — the sim asserts against this. */
  readonly channelTuning: ChannelTuning;
  /** Resolved Collapse tuning (defaults merged). */
  readonly collapseTuning: CollapseTuning;

  private readonly radius: number;
  private readonly collapseAtS: number;
  private readonly closingWarnS: number;
  private readonly channelMsTotal: number;
  private readonly states: Record<GateSpec['id'], GateState> = { a: 'closed', b: 'closed', c: 'closed' };
  private readonly listeners: Array<(e: ExtractionEvent, id?: string) => void> = [];

  private elapsedMs = 0;
  private channelMsAccum = 0;
  /** Gate the current channel belongs to — switching gates restarts the hold. */
  private channelGateId: GateSpec['id'] | null = null;
  /** Remaining post-hit accrual freeze, ms. */
  private stallMsLeft = 0;
  /** Remaining inferred-contest window, ms (used only when no contest is passed). */
  private inferredContestMsLeft = 0;
  /** Accrual multiplier the last ticking frame used — HUD/telemetry readout. */
  private rateLast = 1;
  /** True for the single frame on which a hit rolled progress back. */
  private interruptedThisFrame = false;
  private collapseState: CollapseState | null = null;
  private collapseMsElapsed = 0;
  private collapseStartRadiusPx = 0;
  private collapseCenter: { x: number; y: number } = { x: 0, y: 0 };
  private hasExtracted = false;
  /** Which gate completed the channel (set with `extracted`). */
  private extractedGateId: GateSpec['id'] | null = null;

  constructor(gates: GateSpec[], tuning: ExtractionTuning) {
    this.channelTuning = { ...CHANNEL_DEFAULTS, ...tuning.channel, channelMs: tuning.channelMs };
    this.collapseTuning = { ...COLLAPSE_DEFAULTS, ...tuning.collapse };
    this.radius = tuning.radius;
    this.collapseAtS = tuning.collapseAtS;
    this.closingWarnS = tuning.closingWarnS ?? DEFAULT_CLOSING_WARN_S;
    this.channelMsTotal = Math.max(
      this.channelTuning.channelMsFloor,
      this.channelTuning.channelMs + this.channelTuning.channelMsDelta,
    );

    const bonusS = Math.max(0, tuning.gateWindowBonusS ?? 0);
    this.gates = gates.map((gate) =>
      gate.closesS === null || bonusS === 0 ? { ...gate } : { ...gate, closesS: gate.closesS + bonusS },
    );
    for (const gate of this.gates) this.states[gate.id] = 'closed';
  }

  /** Seconds of run time this system has been fed. */
  get elapsedS(): number {
    return this.elapsedMs / 1000;
  }

  /** Channel duration actually in force (base + gear delta, floored). */
  get channelMsEffective(): number {
    return this.channelMsTotal;
  }

  /** 0..1 channel fill on the gate currently being channeled. */
  get channelProgress(): number {
    return Math.min(1, this.channelMsAccum / this.channelMsTotal);
  }

  /** Channel ms still needed at rate 1.0. */
  get channelMsRemaining(): number {
    return Math.max(0, this.channelMsTotal - this.channelMsAccum);
  }

  /** Gate id the channel is bound to, or null when no hold is in progress. */
  get channelingGate(): GateSpec['id'] | null {
    return this.channelGateId;
  }

  /** Accrual multiplier applied on the last ticking frame (1.0 = ring clear). */
  get channelRate(): number {
    return this.rateLast;
  }

  /** Remaining post-hit accrual freeze in ms (>0 = the ring pip reads stalled). */
  get channelStallMs(): number {
    return this.stallMsLeft;
  }

  get channelStalled(): boolean {
    return this.stallMsLeft > 0;
  }

  /**
   * True only on the frame a hit rolled the channel back — the HUD's interrupt
   * flash trigger. Cleared at the top of the next `update`.
   */
  get channelInterrupted(): boolean {
    return this.interruptedThisFrame;
  }

  get collapse(): { active: boolean; ringRadius: number } | null {
    return this.collapseState;
  }

  /** Seconds since the Collapse ignited; 0 before it does. */
  get collapseElapsedS(): number {
    return this.collapseMsElapsed / 1000;
  }

  /** World centre of the dusk-fire ring (the `centerGate`). */
  get collapseRingCenter(): { x: number; y: number } {
    return this.collapseCenter;
  }

  /** Radius the ring ignited at — the scene's fill/mask reference. */
  get collapseRingStartRadius(): number {
    return this.collapseStartRadiusPx;
  }

  /** Current shrink speed, px/s (ramped by `ringAccel`, capped). */
  get collapseRingSpeed(): number {
    if (this.collapseState === null) return 0;
    const c = this.collapseTuning;
    return Math.min(c.ringSpeedMax, c.ringSpeedPxPerS + c.ringAccel * this.collapseElapsedS);
  }

  /** Fire damage inside the ring right now, hp/s (ramped, capped). */
  get collapseFireDps(): number {
    if (this.collapseState === null) return 0;
    const c = this.collapseTuning;
    return Math.min(c.fireDpsMax, c.fireDps + c.fireDpsStep * this.rampSteps());
  }

  /** Threat multiplier BONUS the Collapse adds right now (uncapped, §2A). */
  get collapseThreatBonus(): number {
    if (this.collapseState === null) return 0;
    return this.collapseTuning.threatStep * this.rampSteps();
  }

  /**
   * How many Collapse elites the schedule says should have been injected by
   * now. The caller tracks how many it has spawned and covers the difference —
   * a pure function of time, so scene and sim agree without a callback.
   */
  get collapseEliteQuota(): number {
    if (this.collapseState === null || this.collapseTuning.eliteEveryS <= 0) return 0;
    return Math.floor(this.collapseElapsedS / this.collapseTuning.eliteEveryS);
  }

  /** px: the spawner must not place a new enemy inside this of an open gate. */
  get suppressRadius(): number {
    return this.channelTuning.suppressRadius;
  }

  get extracted(): boolean {
    return this.hasExtracted;
  }

  /** Gate the completed channel used — null until `extracted` is true. */
  get extractedGate(): GateSpec['id'] | null {
    return this.extractedGateId;
  }

  gateState(id: 'a' | 'b' | 'c'): GateState {
    return this.states[id];
  }

  /**
   * True when (x, y) sits inside the suppression radius of a gate that is
   * open/closing — the spawner rejects the position and rolls another. This is
   * what stops a contested channel from being fed fresh bodies point-blank.
   */
  spawnSuppressed(x: number, y: number): boolean {
    const r = this.channelTuning.suppressRadius;
    if (r <= 0) return false;
    const r2 = r * r;
    for (const gate of this.gates) {
      const state = this.states[gate.id];
      if (state !== 'open' && state !== 'closing') continue;
      const dx = x - gate.x;
      const dy = y - gate.y;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  }

  onEvent(cb: (e: ExtractionEvent, id?: string) => void): void {
    this.listeners.push(cb);
  }

  /**
   * Advance the schedule by one ticking frame. `tookHit` is the caller's
   * "player took damage since the last extraction tick" flag: it costs
   * `hitSetbackMs` of accrued channel and stalls accrual for `hitStallMs`.
   * `contest` is the enemy census inside the channelling gate's ring; omit it
   * and contest is inferred from recent hits (`contestedInferMs`).
   */
  update(
    deltaMs: number,
    playerX: number,
    playerY: number,
    tookHit: boolean,
    contest?: ChannelContest,
  ): void {
    if (this.hasExtracted || deltaMs <= 0) return;
    this.interruptedThisFrame = false;
    this.elapsedMs += deltaMs;
    const seconds = this.elapsedS;

    this.advanceGates(seconds);
    this.advanceCollapse(seconds, deltaMs, playerX, playerY);
    this.advanceChannel(deltaMs, playerX, playerY, tookHit, contest);
  }

  private advanceGates(seconds: number): void {
    for (const gate of this.gates) {
      const current = this.states[gate.id];
      const target = this.scheduledState(gate, seconds);
      if (target === current) continue;
      this.states[gate.id] = target;
      if (current === 'closed' && (target === 'open' || target === 'closing')) {
        this.emit('gate-open', gate.id);
      }
      if (target === 'spent') {
        if (this.channelGateId === gate.id) this.resetChannel();
        this.emit('gate-close', gate.id);
      }
    }
  }

  /** The state a gate's script alone dictates at `seconds` (extraction aside). */
  private scheduledState(gate: GateSpec, seconds: number): GateState {
    if (seconds < gate.opensS) return 'closed';
    if (gate.closesS === null) return 'open';
    if (seconds >= gate.closesS) return 'spent';
    if (seconds >= gate.closesS - this.closingWarnS) return 'closing';
    return 'open';
  }

  private advanceCollapse(seconds: number, deltaMs: number, playerX: number, playerY: number): void {
    if (seconds < this.collapseAtS) return;
    const c = this.collapseTuning;
    if (this.collapseState === null) {
      // Ignition: the ring starts just outside the PLAYER, not at the arena
      // corner — a corner-span start radius is what made the greybox Collapse
      // a non-event (measured: never reached the player in 29s of overtime).
      const centre = this.gates.find((gate) => gate.id === c.centerGate) ?? this.gates[this.gates.length - 1];
      this.collapseCenter = centre === undefined ? { x: playerX, y: playerY } : { x: centre.x, y: centre.y };
      const dx = playerX - this.collapseCenter.x;
      const dy = playerY - this.collapseCenter.y;
      const raw = Math.sqrt(dx * dx + dy * dy) + c.startPad;
      this.collapseStartRadiusPx = Math.min(c.maxStart, Math.max(c.minStart, raw));
      this.collapseMsElapsed = 0;
      this.collapseState = { active: true, ringRadius: this.collapseStartRadiusPx };
      this.emit('collapse');
      return;
    }
    this.collapseMsElapsed += deltaMs;
    this.collapseState.ringRadius = this.ringRadiusAt(this.collapseElapsedS);
  }

  /**
   * Closed-form ring radius: the speed ramps `ringSpeedPxPerS -> ringSpeedMax`
   * under `ringAccel`, the swept distance is its integral, and the ring HOLDS
   * at `minRadius` so the centre gate (ring radius `radius`) stays standable.
   * Closed form rather than a per-frame decrement keeps a 16ms sim tick and a
   * 33ms frame geometrically identical.
   */
  ringRadiusAt(collapseS: number): number {
    const c = this.collapseTuning;
    const t = Math.max(0, collapseS);
    const rampS =
      c.ringAccel > 0 ? Math.max(0, (c.ringSpeedMax - c.ringSpeedPxPerS) / c.ringAccel) : Infinity;
    let swept: number;
    if (t <= rampS) {
      swept = c.ringSpeedPxPerS * t + (c.ringAccel * t * t) / 2;
    } else {
      const atCap = c.ringSpeedPxPerS * rampS + (c.ringAccel * rampS * rampS) / 2;
      swept = atCap + c.ringSpeedMax * (t - rampS);
    }
    return Math.min(this.collapseStartRadiusPx, Math.max(c.minRadius, this.collapseStartRadiusPx - swept));
  }

  /** How many `stepEveryS` ramp steps the Collapse has completed. */
  private rampSteps(): number {
    const every = this.collapseTuning.stepEveryS;
    if (every <= 0) return 0;
    return Math.floor(this.collapseElapsedS / every);
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
      // Setback + stall, NEVER a reset: progress stays monotone-positive.
      const before = this.channelMsAccum;
      this.channelMsAccum = Math.max(0, this.channelMsAccum - t.hitSetbackMs);
      this.interruptedThisFrame = this.channelMsAccum < before;
      this.stallMsLeft = t.hitStallMs;
      this.inferredContestMsLeft = t.contestedInferMs;
    }
    this.inferredContestMsLeft = Math.max(0, this.inferredContestMsLeft - deltaMs);

    const gate = this.gateUnderPlayer(playerX, playerY);
    if (gate === null) {
      // Outside every open ring: the hold PAUSES (progress kept) but stays
      // bound to its gate; stepping back in resumes where it left off. The
      // stall still burns down so re-entry is not punished twice.
      this.stallMsLeft = Math.max(0, this.stallMsLeft - deltaMs);
      this.rateLast = 0;
      return;
    }
    if (this.channelGateId !== gate.id) {
      // A fresh gate starts a fresh hold — progress never transfers.
      this.channelGateId = gate.id;
      this.channelMsAccum = 0;
    }

    const stalled = Math.min(this.stallMsLeft, deltaMs);
    this.stallMsLeft -= stalled;
    const accruingMs = deltaMs - stalled;
    const rate = this.accrualRate(contest);
    this.rateLast = rate;
    this.channelMsAccum += accruingMs * rate;

    if (this.channelMsAccum >= this.channelMsTotal) {
      this.channelMsAccum = this.channelMsTotal;
      this.hasExtracted = true;
      this.extractedGateId = gate.id;
      this.states[gate.id] = 'spent';
      this.emit('extracted', gate.id);
    }
  }

  /**
   * `contestedRate` while the ring is contested, minus `eliteContestPenalty`
   * per elite/boss, floored at `minRate`; 1.0 while the ring is clear.
   */
  private accrualRate(contest: ChannelContest | undefined): number {
    const t = this.channelTuning;
    const contested = contest === undefined ? this.inferredContestMsLeft > 0 : contest.enemies > 0;
    if (!contested) return 1;
    const elites = contest === undefined ? 0 : Math.max(0, contest.elites);
    return Math.max(t.minRate, Math.min(1, t.contestedRate - t.eliteContestPenalty * elites));
  }

  /** The open/closing gate whose ring contains the player, if any. */
  private gateUnderPlayer(px: number, py: number): GateSpec | null {
    const r2 = this.radius * this.radius;
    for (const gate of this.gates) {
      const state = this.states[gate.id];
      if (state !== 'open' && state !== 'closing') continue;
      const dx = px - gate.x;
      const dy = py - gate.y;
      if (dx * dx + dy * dy <= r2) return gate;
    }
    return null;
  }

  private resetChannel(): void {
    this.channelGateId = null;
    this.channelMsAccum = 0;
    this.stallMsLeft = 0;
  }

  private emit(event: ExtractionEvent, id?: string): void {
    for (const cb of this.listeners) cb(event, id);
  }
}
