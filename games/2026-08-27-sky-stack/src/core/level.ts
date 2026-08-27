/**
 * Level session director: goal counters + a move or time budget + a star
 * rating. The session model of level-based families — board-puzzle (B),
 * level platformers (C), table (G) and word (H) games: win when every goal
 * hits its target, lose when the budget runs out first.
 *
 * Use for: pass/fail levels with 1-3 explicit goals ("collect 30 red",
 * "clear 12 blocks", "answer 10 questions") and a moves- or seconds-budget.
 * Do NOT use for: timed wave runs (RunDirector), endless score-chase
 * (RampDirector), lap races (LapDirector).
 *
 * Pure TypeScript, no Phaser import (headless-safe for sim solvers).
 */

import type { SessionDirector, SessionOutcome } from './session';

export interface LevelGoal {
  id: string;
  target: number;
}

export interface LevelSpec {
  id: string;
  goals: readonly LevelGoal[];
  /** Move budget; omit for purely timed levels. */
  moves?: number;
  /** Time budget in seconds; omit for purely move-budgeted levels. */
  timeSeconds?: number;
  /**
   * Star bands as the fraction of budget LEFT on the win: `[one, two, three]`
   * ascending. Defaults to [0, 0.2, 0.45] — any win is 1 star, finishing with
   * 20%+ of the budget left is 2, 45%+ is 3.
   */
  starBands?: readonly [number, number, number];
}

export interface LevelDirectorOptions {
  onGoal?: (goalId: string, current: number, target: number) => void;
  onEnd?: (outcome: SessionOutcome) => void;
}

const DEFAULT_STAR_BANDS: readonly [number, number, number] = [0, 0.2, 0.45];

export class LevelDirector implements SessionDirector {
  private readonly spec: LevelSpec;
  private readonly options: LevelDirectorOptions;
  private readonly counts = new Map<string, number>();

  private elapsedMs = 0;
  private movesUsed = 0;
  private paused = false;
  private result: SessionOutcome | null = null;

  constructor(spec: LevelSpec, options: LevelDirectorOptions = {}) {
    this.spec = spec;
    this.options = options;
    for (const goal of spec.goals) this.counts.set(goal.id, 0);
  }

  get elapsedSeconds(): number {
    return this.elapsedMs / 1000;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  get ended(): boolean {
    return this.result !== null;
  }

  get outcome(): SessionOutcome | null {
    return this.result;
  }

  /** Goal completion share (the meaningful progress for level HUDs). */
  get progress(): number | null {
    let total = 0;
    let done = 0;
    for (const goal of this.spec.goals) {
      total += goal.target;
      done += Math.min(goal.target, this.counts.get(goal.id) ?? 0);
    }
    return total > 0 ? done / total : 0;
  }

  get movesLeft(): number | null {
    return this.spec.moves === undefined ? null : Math.max(0, this.spec.moves - this.movesUsed);
  }

  get timeLeftSeconds(): number | null {
    if (this.spec.timeSeconds === undefined) return null;
    return Math.max(0, this.spec.timeSeconds - this.elapsedSeconds);
  }

  goalProgress(goalId: string): { current: number; target: number } {
    const goal = this.spec.goals.find((g) => g.id === goalId);
    return { current: this.counts.get(goalId) ?? 0, target: goal?.target ?? 0 };
  }

  /**
   * Fraction of the binding budget still left (0..1); the star currency.
   * With both budgets present the tighter one binds.
   */
  get budgetLeftRatio(): number {
    const ratios: number[] = [];
    if (this.spec.moves !== undefined && this.spec.moves > 0) {
      ratios.push((this.spec.moves - this.movesUsed) / this.spec.moves);
    }
    if (this.spec.timeSeconds !== undefined && this.spec.timeSeconds > 0) {
      ratios.push((this.spec.timeSeconds - this.elapsedSeconds) / this.spec.timeSeconds);
    }
    if (ratios.length === 0) return 1;
    return Math.max(0, Math.min(...ratios));
  }

  /** Stars for the current (won) state: 1..3. 0 before a win. */
  get stars(): number {
    if (this.result === null || !this.result.won) return 0;
    const bands = this.spec.starBands ?? DEFAULT_STAR_BANDS;
    const left = this.budgetLeftRatio;
    let stars = 0;
    for (const band of bands) if (left >= band) stars += 1;
    return Math.max(1, stars);
  }

  /** Records progress toward a goal; resolves the win when all goals complete. */
  recordProgress(goalId: string, amount = 1): void {
    if (this.result !== null) return;
    const current = this.counts.get(goalId);
    if (current === undefined) return;
    this.counts.set(goalId, current + amount);
    const goal = this.spec.goals.find((g) => g.id === goalId);
    if (goal !== undefined) {
      this.options.onGoal?.(goalId, Math.min(goal.target, current + amount), goal.target);
    }
    if (this.allGoalsMet()) this.finish({ won: true, reason: 'goals' });
  }

  /**
   * Spends moves from the budget. The loss only lands after the caller's
   * cascade settles: call `settleMove()` when the board is at rest so a
   * final move that completes the goals still wins.
   */
  useMove(n = 1): void {
    if (this.result !== null) return;
    this.movesUsed += n;
  }

  /** Resolves out-of-moves AFTER cascades settle; no-op while moves remain. */
  settleMove(): void {
    if (this.result !== null) return;
    if (this.spec.moves !== undefined && this.movesUsed >= this.spec.moves && !this.allGoalsMet()) {
      this.finish({ won: false, reason: 'out-of-moves' });
    }
  }

  /** Explicit failure from the slice (player quit, hazard, trap). */
  fail(reason: string): void {
    if (this.result !== null) return;
    this.finish({ won: false, reason });
  }

  update(deltaMs: number): void {
    if (this.result !== null || this.paused || deltaMs <= 0) return;
    this.elapsedMs += deltaMs;
    if (this.spec.timeSeconds !== undefined && this.elapsedSeconds >= this.spec.timeSeconds) {
      if (this.allGoalsMet()) this.finish({ won: true, reason: 'goals' });
      else this.finish({ won: false, reason: 'out-of-time' });
    }
  }

  private allGoalsMet(): boolean {
    for (const goal of this.spec.goals) {
      if ((this.counts.get(goal.id) ?? 0) < goal.target) return false;
    }
    return true;
  }

  private finish(outcome: SessionOutcome): void {
    this.result = outcome;
    this.options.onEnd?.(outcome);
  }
}
