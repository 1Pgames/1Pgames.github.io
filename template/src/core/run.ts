/**
 * Run/wave/phase director for a single roguelike-survivor run: ticks off a
 * declarative wave timeline, tells the scene when to spawn, and tracks which
 * `RunPhase` (and difficulty multiplier) the run is currently in.
 *
 * Mostly engine-agnostic: timing is driven exclusively by the `deltaMs` the
 * scene's own `update(time, delta)` hands to `update()` — never by
 * `time.addEvent`/`this.time`, so pausing the scene (or the whole game)
 * simply means "don't call `update`": there is no drift to correct and no
 * orphaned timer firing after a scene shuts down. The constructor only needs
 * a minimal `{ events: { once } }` host (a `Phaser.Scene` satisfies it
 * structurally) to auto-detach on the scene's `'shutdown'` event — the
 * literal Phaser dispatches for `Phaser.Scenes.Events.SHUTDOWN` — so a
 * restarted scene never keeps ticking a stale director. Keeping this
 * structural (no `import Phaser` value dependency) is what lets a headless
 * balance simulator (`src/sim/`) construct a `RunDirector` in plain Node
 * without a DOM.
 *
 * Use for: survivor-like / roguelike / tower-defense runs with a fixed or
 * escalating spawn timeline and named difficulty phases.
 * Do NOT use for: turn-based/tactics (no continuous clock) or one-shot
 * casual games (a plain `time.addEvent` is simpler there).
 */

/** Minimal event-host contract `RunDirector` needs from its scene. */
export interface RunDirectorHost {
  events: {
    once(event: 'shutdown', callback: () => void): unknown;
  };
}

export interface WaveSpec {
  /** Seconds into the run this wave fires. */
  at: number;
  spawns: Array<{ id: string; count: number; everyMs?: number }>;
  /**
   * Sustained pressure: while set, the wave's slots keep dripping on their
   * `everyMs` cadence until this many seconds into the run, ignoring `count`.
   * This is what keeps a survivor-like screen full between set-piece waves —
   * without it every wave is a burst followed by an empty screen.
   */
  until?: number;
  /** Marks pressure spikes ("elite", "boss") for UI/telegraphs. */
  label?: string;
}

export interface RunPhase {
  name: string;
  /** Seconds into the run this phase becomes active. */
  fromSeconds: number;
  /** Multiplier applied to enemy stats while this phase is active. */
  difficultyMul: number;
}

interface PendingSpawn {
  wave: WaveSpec;
  spawnIndex: number;
  spawned: number;
  /** Absolute `elapsedMs` timestamp of this spawn slot's next fire. */
  nextFireAtMs: number;
}

export interface RunDirectorOptions {
  /** Fixed run length; enables `remainingSeconds`. Omit for an endless run. */
  durationSeconds?: number;
  onPhaseChange?: (phase: RunPhase) => void;
}

const FALLBACK_PHASE: RunPhase = { name: 'default', fromSeconds: 0, difficultyMul: 1 };

/**
 * Drives one run's timeline. Construct once per run in the scene's `create`,
 * call `update(delta)` from the scene's `update`, and never re-implement the
 * spawn scheduling elsewhere — a second timer source is how waves double-fire.
 */
export class RunDirector {
  private readonly waves: readonly WaveSpec[];
  private readonly phases: readonly RunPhase[];
  private readonly onSpawn: (id: string, index: number, total: number) => void;
  private readonly durationSeconds: number | null;
  private readonly onPhaseChange: ((phase: RunPhase) => void) | undefined;

  private elapsedMs = 0;
  private paused = false;
  private stopped = false;
  private currentPhase: RunPhase;
  private nextWaveIndex = 0;
  private readonly pending: PendingSpawn[] = [];

  constructor(
    host: RunDirectorHost,
    waves: readonly WaveSpec[],
    phases: readonly RunPhase[],
    onSpawn: (id: string, index: number, total: number) => void,
    options: RunDirectorOptions = {},
  ) {
    // Waves must fire in timeline order — sort once up front so `update`
    // only ever has to look at the head of the array.
    this.waves = [...waves].sort((a, b) => a.at - b.at);
    this.phases = [...phases].sort((a, b) => a.fromSeconds - b.fromSeconds);
    this.onSpawn = onSpawn;
    this.durationSeconds = options.durationSeconds ?? null;
    this.onPhaseChange = options.onPhaseChange;
    this.currentPhase = this.phases[0] ?? FALLBACK_PHASE;
    host.events.once('shutdown', () => {
      this.stopped = true;
    });
  }

  get elapsedSeconds(): number {
    return this.elapsedMs / 1000;
  }

  get phase(): RunPhase {
    return this.currentPhase;
  }

  get difficulty(): number {
    return this.currentPhase.difficultyMul;
  }

  get remainingSeconds(): number | null {
    if (this.durationSeconds === null) return null;
    return Math.max(0, this.durationSeconds - this.elapsedSeconds);
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

  /** Advance the timeline by one frame's worth of scene delta. */
  update(deltaMs: number): void {
    if (this.stopped || this.paused || deltaMs <= 0) return;
    this.elapsedMs += deltaMs;
    this.advancePhase();
    this.startDueWaves();
    this.tickPendingSpawns();
  }

  private advancePhase(): void {
    const seconds = this.elapsedSeconds;
    let candidate = this.currentPhase;
    for (const phase of this.phases) {
      if (phase.fromSeconds <= seconds) candidate = phase;
    }
    if (candidate !== this.currentPhase) {
      this.currentPhase = candidate;
      this.onPhaseChange?.(candidate);
    }
  }

  private startDueWaves(): void {
    const seconds = this.elapsedSeconds;
    while (this.nextWaveIndex < this.waves.length) {
      const wave = this.waves[this.nextWaveIndex];
      if (!wave || wave.at > seconds) break;
      for (let spawnIndex = 0; spawnIndex < wave.spawns.length; spawnIndex += 1) {
        this.pending.push({ wave, spawnIndex, spawned: 0, nextFireAtMs: this.elapsedMs });
      }
      this.nextWaveIndex += 1;
    }
  }

  /**
   * Fires every spawn slot whose next scheduled tick has arrived. A slot
   * with no `everyMs` fires its whole `count` in a single tick (its next
   * fire time never advances past "now"); a slot with `everyMs` drips one
   * spawn per interval, correct even across multi-second frame drops.
   */
  private tickPendingSpawns(): void {
    if (this.pending.length === 0) return;
    // Iterate back-to-front so a mid-loop removal never skips the next entry.
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      const entry = this.pending[i];
      if (!entry) continue;
      const spec = entry.wave.spawns[entry.spawnIndex];
      if (!spec) {
        this.pending.splice(i, 1);
        continue;
      }
      const interval = spec.everyMs ?? 0;
      const until = entry.wave.until;
      const sustained = until !== undefined && this.elapsedSeconds < until && interval > 0;

      while ((sustained || entry.spawned < spec.count) && entry.nextFireAtMs <= this.elapsedMs) {
        this.onSpawn(spec.id, entry.spawned, spec.count);
        entry.spawned += 1;
        entry.nextFireAtMs += interval;
      }
      const finished = until === undefined ? entry.spawned >= spec.count : this.elapsedSeconds >= until;
      if (finished) this.pending.splice(i, 1);
    }
  }
}
