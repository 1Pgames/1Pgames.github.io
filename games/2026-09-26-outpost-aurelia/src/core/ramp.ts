/**
 * Endless score-chase session director: difficulty ramps with SCORE (not
 * wall time), the session only ends when the slice reports a fail, and the
 * instant-retry loop is the whole meta. The session model of hypercasual
 * (family J) and endless runners (family C).
 *
 * Use for: one-mechanic score chases — tap-timing, stacking, swerve, drop,
 * io-lite, endless runners.
 * Do NOT use for: pass/fail levels (LevelDirector) or timed runs (RunDirector).
 *
 * Pure TypeScript, no Phaser import (headless-safe for sim ramp bots).
 */

import type { SessionDirector, SessionOutcome } from './session';

export interface RampSpec {
  /** Score points per difficulty step. */
  scorePerStep: number;
  /** Additive difficulty-multiplier gain per step: difficulty = 1 + steps * this. */
  difficultyPerStep: number;
  /** Ramp ceiling; the game stays playable-hard instead of impossible. */
  maxDifficulty?: number;
}

export interface RampDirectorOptions {
  onStep?: (step: number, difficulty: number) => void;
  onEnd?: (outcome: SessionOutcome) => void;
}

export class RampDirector implements SessionDirector {
  private readonly spec: RampSpec;
  private readonly options: RampDirectorOptions;

  private elapsedMs = 0;
  private points = 0;
  private lastStep = 0;
  private paused = false;
  private result: SessionOutcome | null = null;

  constructor(spec: RampSpec, options: RampDirectorOptions = {}) {
    this.spec = spec;
    this.options = options;
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

  /** Endless: no completion fraction. */
  get progress(): number | null {
    return null;
  }

  get score(): number {
    return this.points;
  }

  get step(): number {
    return Math.floor(this.points / Math.max(1, this.spec.scorePerStep));
  }

  /** The one dial slices read: spawn rates, speeds and gaps scale off this. */
  get difficulty(): number {
    const raw = 1 + this.step * this.spec.difficultyPerStep;
    return this.spec.maxDifficulty !== undefined ? Math.min(this.spec.maxDifficulty, raw) : raw;
  }

  addScore(n = 1): void {
    if (this.result !== null) return;
    this.points += n;
    const step = this.step;
    if (step !== this.lastStep) {
      this.lastStep = step;
      this.options.onStep?.(step, this.difficulty);
    }
  }

  /** The only way an endless session ends. */
  fail(reason: string): void {
    if (this.result !== null) return;
    this.result = { won: false, reason };
    this.options.onEnd?.(this.result);
  }

  update(deltaMs: number): void {
    if (this.result !== null || this.paused || deltaMs <= 0) return;
    this.elapsedMs += deltaMs;
  }
}
