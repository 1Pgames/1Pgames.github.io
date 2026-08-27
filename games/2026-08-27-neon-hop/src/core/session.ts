/**
 * Session contracts shared by every gameplay family (see AGENTS.md families):
 * a director owns one play session's clock, win/lose resolution and coarse
 * progress, so scenes, HUD, music and the headless sim can drive any family
 * through one interface.
 *
 * Directors implementing this today:
 *  - `RunDirector`  (core/run.ts)   — timed wave run; family A (arena).
 *  - `LevelDirector`(core/level.ts) — goals + move/time budget; families B/C/G/H.
 *  - `RampDirector` (core/ramp.ts)  — endless score-chase; families J and C-runner.
 *  - `LapDirector`  (core/lap.ts)   — laps + checkpoints; family E.
 *
 * Pure TypeScript, no Phaser import — every director must stay headless-safe
 * so `src/sim/families/*` can tick it in Node.
 */

export interface SessionOutcome {
  won: boolean;
  /** Machine-readable cause: 'survived' | 'boss' | 'goals' | 'out-of-moves' | 'crashed' | ... */
  reason: string;
}

export interface SessionDirector {
  /** Advance the session clock by one frame's delta. No-op once ended/paused. */
  update(deltaMs: number): void;
  readonly elapsedSeconds: number;
  readonly isPaused: boolean;
  pause(): void;
  resume(): void;
  /** True once the session has resolved; `outcome` is non-null from then on. */
  readonly ended: boolean;
  readonly outcome: SessionOutcome | null;
  /**
   * Coarse 0..1 completion where the family defines one (time share, goal
   * share, lap share). `null` for endless sessions (score-chase).
   */
  readonly progress: number | null;
}

/**
 * One generic stat row for the results screen — slices fill these instead of
 * the arena-specific kills/level fields (see `scenes/gameover.ts`).
 */
export interface ResultStat {
  label: string;
  value: string;
}
