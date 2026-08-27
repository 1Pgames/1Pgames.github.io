import type { EventSpec, RunPhase, WaveSpec } from '../core/run';

/**
 * Reference wave/phase timeline for an 8-minute (480s) survivor-like run.
 * Feed both arrays straight into `new RunDirector(scene, WAVES, PHASES, onSpawn)`.
 * Enemy ids reference `data/enemies.ts` (`ENEMIES[i].id`).
 *
 * Use for: bootstrapping a survivor-like scene's default run, or as a
 * worked example for authoring a game-specific timeline.
 * Do NOT use for: tower-defense (waves there are usually per-lane, see a
 * game-specific `data/` file) or any run whose PRD gives its own numbers —
 * replace this file wholesale rather than special-casing around it.
 *
 * Pressure curve (5 phases across 480s):
 *  - Opening    0-120s  x1.0  — teach movement/aim against cheap swarm+runner.
 *  - Escalation 120-240s x1.3 — tanks and shooters enter; first elite @150s.
 *  - Pressure   240-360s x1.7 — splitters/healers stack, density climbs.
 *  - Climax     360-450s x2.2 — second elite @330s already landed; heavy mix.
 *  - Finale     450-480s x2.6 — boss @450s plus chip swarm so the last 30s
 *    is a boss fight, not a lull; run resolves at 480s.
 */
export const PHASES: readonly RunPhase[] = [
  { name: 'Opening', fromSeconds: 0, difficultyMul: 1.0 },
  { name: 'Escalation', fromSeconds: 120, difficultyMul: 1.3 },
  { name: 'Pressure', fromSeconds: 240, difficultyMul: 1.6 },
  { name: 'Climax', fromSeconds: 360, difficultyMul: 1.85 },
  { name: 'Finale', fromSeconds: 450, difficultyMul: 2.15 },
] as const;

export const WAVES: readonly WaveSpec[] = [
  // --- Sustained pressure --------------------------------------------------
  // Set-piece waves below are spikes on top of this baseline drip. Without a
  // baseline the screen empties between waves and the run reads as dead air.
  { at: 4, until: 60, spawns: [{ id: 'swarm', count: 0, everyMs: 1600 }] },
  { at: 60, until: 120, spawns: [{ id: 'swarm', count: 0, everyMs: 1000 }] },
  { at: 120, until: 180, spawns: [{ id: 'swarm', count: 0, everyMs: 700 }, { id: 'runner', count: 0, everyMs: 3000 }] },
  { at: 180, until: 240, spawns: [{ id: 'swarm', count: 0, everyMs: 550 }, { id: 'runner', count: 0, everyMs: 2600 }] },
  { at: 240, until: 360, spawns: [{ id: 'swarm', count: 0, everyMs: 380 }, { id: 'runner', count: 0, everyMs: 2200 }] },
  { at: 360, until: 480, spawns: [{ id: 'swarm', count: 0, everyMs: 340 }, { id: 'runner', count: 0, everyMs: 1800 }] },

  // --- Opening (0-120s): learn to move and hit things ------------------
  { at: 6, spawns: [{ id: 'swarm', count: 4, everyMs: 600 }] },
  { at: 30, spawns: [{ id: 'swarm', count: 6, everyMs: 450 }] },
  { at: 40, spawns: [{ id: 'runner', count: 4, everyMs: 600 }] },
  {
    at: 60,
    spawns: [
      { id: 'swarm', count: 10, everyMs: 300 },
      { id: 'shooter', count: 2, everyMs: 800 },
    ],
  },
  {
    at: 85,
    spawns: [
      { id: 'tank', count: 1 },
      { id: 'runner', count: 4, everyMs: 500 },
    ],
  },
  {
    at: 110,
    spawns: [
      { id: 'shooter', count: 3, everyMs: 700 },
      { id: 'swarm', count: 8, everyMs: 300 },
    ],
  },

  // --- Escalation (120-240s): the full cast shows up --------------------
  {
    at: 120,
    spawns: [
      { id: 'swarm', count: 12, everyMs: 300 },
      { id: 'runner', count: 4, everyMs: 500 },
    ],
  },
  {
    at: 150,
    label: 'elite',
    pattern: 'cluster',
    spawns: [
      { id: 'elite', count: 1 },
      { id: 'swarm', count: 6, everyMs: 250 },
    ],
  },
  {
    at: 175,
    spawns: [
      { id: 'tank', count: 2, everyMs: 1200 },
      { id: 'shooter', count: 4, everyMs: 600 },
    ],
  },
  {
    at: 200,
    spawns: [
      { id: 'splitter', count: 3, everyMs: 900 },
      { id: 'healer', count: 2, everyMs: 1000 },
    ],
  },
  {
    at: 225,
    spawns: [
      { id: 'swarm', count: 14, everyMs: 280 },
      { id: 'runner', count: 8, everyMs: 400 },
    ],
  },

  // --- Pressure (240-360s): density and mixed threats -------------------
  {
    at: 240,
    spawns: [
      { id: 'shooter', count: 5, everyMs: 500 },
      { id: 'splitter', count: 2, everyMs: 900 },
    ],
  },
  {
    at: 270,
    pattern: 'arc',
    spawns: [
      { id: 'runner', count: 10, everyMs: 350 },
      { id: 'tank', count: 2, everyMs: 1400 },
    ],
  },
  {
    at: 300,
    spawns: [
      { id: 'swarm', count: 16, everyMs: 260 },
      { id: 'healer', count: 3, everyMs: 900 },
    ],
  },
  {
    at: 330,
    label: 'elite',
    pattern: 'cluster',
    spawns: [
      { id: 'elite', count: 2, everyMs: 1500 },
      { id: 'shooter', count: 6, everyMs: 500 },
    ],
  },

  // --- Climax (360-450s): heaviest sustained mix -------------------------
  {
    at: 360,
    spawns: [
      { id: 'splitter', count: 4, everyMs: 800 },
      { id: 'tank', count: 3, everyMs: 1200 },
    ],
  },
  {
    at: 390,
    spawns: [
      { id: 'runner', count: 9, everyMs: 320 },
      { id: 'swarm', count: 14, everyMs: 240 },
    ],
  },
  {
    at: 420,
    spawns: [
      { id: 'elite', count: 1 },
      { id: 'shooter', count: 5, everyMs: 450 },
      { id: 'healer', count: 2, everyMs: 800 },
    ],
  },

  // --- Finale (450-480s): boss fight ------------------------------------
  {
    at: 450,
    label: 'boss',
    spawns: [
      { id: 'boss', count: 1 },
      { id: 'elite', count: 2, everyMs: 2000 },
    ],
  },
  {
    at: 460,
    spawns: [{ id: 'swarm', count: 10, everyMs: 300 }],
  },
] as const;

/**
 * Scripted, one-shot timeline beats layered on top of the wave drip: two
 * chests (early, mid) that open a bonus draft, one breather (a lull right
 * after the pressure phase's density spike), and one elite-rush arc in the
 * climax phase. See `RunDirector.onEvent` / `GameScene.onScriptedEvent`.
 */
export const TIMELINE_EVENTS: readonly EventSpec[] = [
  { at: 95, kind: 'chest' },
  { at: 260, kind: 'breather' },
  { at: 305, kind: 'chest' },
  { at: 400, kind: 'elite-rush' },
] as const;
