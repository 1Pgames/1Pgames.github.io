/**
 * Lap-race session director: ordered checkpoints, lap counting, lap times.
 * The session model of track/vehicle games (family E): win when the target
 * lap count completes, lose only on an explicit fail (DNF, wrong-way timeout).
 *
 * Use for: top-down/side racing with a closed track and 2+ checkpoints.
 * Do NOT use for: point-to-point sprints with one finish line — that is a
 * LevelDirector with a time budget.
 *
 * Pure TypeScript, no Phaser import (headless-safe for sim lap bots).
 */

import type { SessionDirector, SessionOutcome } from './session';

export interface LapSpec {
  laps: number;
  /** Ordered checkpoint count; the finish line is checkpoint 0. */
  checkpoints: number;
}

export interface LapDirectorOptions {
  onLap?: (lap: number, lapTimeMs: number) => void;
  onEnd?: (outcome: SessionOutcome) => void;
}

export class LapDirector implements SessionDirector {
  private readonly spec: LapSpec;
  private readonly options: LapDirectorOptions;

  private elapsedMs = 0;
  private lapStartMs = 0;
  private nextCheckpoint = 1; // the race starts ON the finish line (checkpoint 0)
  private lapsDone = 0;
  private readonly lapTimes: number[] = [];
  private paused = false;
  private result: SessionOutcome | null = null;

  constructor(spec: LapSpec, options: LapDirectorOptions = {}) {
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

  /** Completed share of the whole race, checkpoint-granular. */
  get progress(): number | null {
    const perLap = this.spec.checkpoints;
    const total = this.spec.laps * perLap;
    const done = this.lapsDone * perLap + (this.nextCheckpoint - 1);
    return total > 0 ? Math.min(1, done / total) : 0;
  }

  get lap(): number {
    return Math.min(this.spec.laps, this.lapsDone + 1);
  }

  get lapTimesMs(): readonly number[] {
    return this.lapTimes;
  }

  get currentLapMs(): number {
    return this.elapsedMs - this.lapStartMs;
  }

  /**
   * Reports the vehicle crossing checkpoint `index`. Returns true when it was
   * the expected next checkpoint (progress counted); false for out-of-order
   * crossings, which slices may use for wrong-way feedback.
   */
  passCheckpoint(index: number): boolean {
    if (this.result !== null) return false;
    const expected = this.nextCheckpoint;
    if (index !== expected) return false;

    if (index === 0) {
      // Crossing the finish line completes the lap started earlier.
      const lapTime = this.currentLapMs;
      this.lapTimes.push(lapTime);
      this.lapsDone += 1;
      this.lapStartMs = this.elapsedMs;
      this.options.onLap?.(this.lapsDone, lapTime);
      if (this.lapsDone >= this.spec.laps) {
        this.result = { won: true, reason: 'laps' };
        this.options.onEnd?.(this.result);
        return true;
      }
    }
    this.nextCheckpoint = (index + 1) % this.spec.checkpoints;
    return true;
  }

  /** DNF, out-of-track timeout, destroyed vehicle. */
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
