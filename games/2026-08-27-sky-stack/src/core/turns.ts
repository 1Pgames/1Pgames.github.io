/**
 * Turn/phase state machine for tactics and deckbuilder runs: cycles a fixed
 * ordered list of phases every round (default a player act/resolve/enemy
 * act/resolve cadence) and gates who may spend action points when.
 *
 * Fully synchronous — no timers, no wall clock, no `deltaMs`. The caller
 * decides when a round of input is "done" (all cards played, all units
 * acted) and calls `endPhase()`; nothing here ever advances on its own. This
 * is the opposite of `core/run.ts`'s delta-driven timeline, which is exactly
 * why the two don't share a base: a turn-based game has no continuous clock
 * to drive.
 *
 * Use for: turn-based tactics, deckbuilder combat, auto-battler prep phases —
 * anything with discrete "your turn / my turn" structure and a per-round
 * action-point budget.
 * Do NOT use for: continuous-time games (survivor-like, twin-stick) — see
 * `core/run.ts` instead.
 */

export interface TurnManagerOptions {
  /**
   * Ordered phase names cycled every round. A phase name that also appears
   * as a key in `apPerRound` is that side's acting phase; any other name
   * (e.g. `'resolve'`) is a neutral phase where `current().side` is `null`
   * and no side can spend AP.
   */
  phases?: readonly string[];
  /** Action points granted to each side at the start of every round. */
  apPerRound: Readonly<Record<string, number>>;
}

export interface TurnState {
  /** 1-based round counter. */
  round: number;
  phase: string;
  /** The side whose acting phase this is, or `null` during a neutral phase. */
  side: string | null;
}

const DEFAULT_PHASES: readonly string[] = ['player', 'resolve', 'enemy', 'resolve'];

/**
 * Drives one run's turn structure. Construct once, call `begin()`, then let
 * gameplay code call `canAct`/`spend` during a side's phase and `endPhase()`
 * once that side is done acting (or a resolve step has finished).
 */
export class TurnManager {
  private readonly phases: readonly string[];
  private readonly apBudget: Readonly<Record<string, number>>;
  private readonly apRemaining: Record<string, number> = {};
  private readonly phaseListeners: Array<(state: TurnState) => void> = [];
  private readonly roundListeners: Array<(round: number) => void> = [];

  private round = 0;
  private phaseIndex = 0;
  private started = false;

  constructor(options: TurnManagerOptions) {
    this.phases = options.phases ?? DEFAULT_PHASES;
    if (this.phases.length === 0) throw new Error('TurnManager: phases must be non-empty');
    this.apBudget = options.apPerRound;
  }

  /** Starts round 1 at the first phase, refilling every side's AP. */
  begin(): void {
    if (this.started) throw new Error('TurnManager: begin() called twice');
    this.started = true;
    this.round = 1;
    this.phaseIndex = 0;
    this.refillAp();
    this.emitRound();
    this.emitPhase();
  }

  current(): TurnState {
    this.assertStarted();
    return { round: this.round, phase: this.phases[this.phaseIndex]!, side: this.sideForCurrentPhase() };
  }

  /** True only when it is `side`'s acting phase and it still has AP to spend. */
  canAct(side: string): boolean {
    this.assertStarted();
    if (this.sideForCurrentPhase() !== side) return false;
    return (this.apRemaining[side] ?? 0) > 0;
  }

  /** Spends `n` AP from `side` if it is that side's phase and it can afford it. */
  spend(side: string, n: number): boolean {
    this.assertStarted();
    if (n < 0) throw new Error('TurnManager: spend() amount must be >= 0');
    if (this.sideForCurrentPhase() !== side) return false;
    const remaining = this.apRemaining[side] ?? 0;
    if (remaining < n) return false;
    this.apRemaining[side] = remaining - n;
    return true;
  }

  /** Advances to the next phase, wrapping to a new round (and refilling AP) at the end of the list. */
  endPhase(): void {
    this.assertStarted();
    this.phaseIndex += 1;
    if (this.phaseIndex >= this.phases.length) {
      this.phaseIndex = 0;
      this.round += 1;
      this.refillAp();
      this.emitRound();
    }
    this.emitPhase();
  }

  /** Fires on every phase transition, including the initial phase set by `begin()`. */
  onPhase(cb: (state: TurnState) => void): void {
    this.phaseListeners.push(cb);
  }

  /** Fires whenever a new round starts (including round 1), after AP refill. */
  onRound(cb: (round: number) => void): void {
    this.roundListeners.push(cb);
  }

  private sideForCurrentPhase(): string | null {
    const phase = this.phases[this.phaseIndex]!;
    return phase in this.apBudget ? phase : null;
  }

  private refillAp(): void {
    for (const side of Object.keys(this.apBudget)) {
      this.apRemaining[side] = this.apBudget[side] ?? 0;
    }
  }

  private emitPhase(): void {
    const state = this.current();
    for (const cb of this.phaseListeners) cb(state);
  }

  private emitRound(): void {
    for (const cb of this.roundListeners) cb(this.round);
  }

  private assertStarted(): void {
    if (!this.started) throw new Error('TurnManager: begin() must be called first');
  }
}
