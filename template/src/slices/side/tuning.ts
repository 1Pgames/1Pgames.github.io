import type { ArtSlot } from '../../data/art';
import type { SideGeometry, SideMotion } from './gen';

/**
 * Every balance number of the side-view platformer slice (family C, authored
 * levels). Slice-local by design: the shared `TUNING` in `src/config.ts` stays
 * the arena's, so swapping slices never touches global config.
 *
 * The motion block is load-bearing — `gen.ts` derives the whole jump envelope
 * from it (128px apex, 208px flat gap at these values), so changing a number
 * here re-shapes every generated level. Re-run the `sidegen` selftest and
 * `npm run sim -- --family side` after touching it.
 */
export const SIDE_TUNING = {
  motion: {
    gravity: 1600,
    jumpVel: 640,
    moveSpeed: 260,
    /** Pointer-up cuts the remaining rise to 55% — the variable-height jump. */
    cutFactor: 0.55,
  } satisfies SideMotion,

  geometry: {
    grid: 40,
    /**
     * 5600px at 260px/s is ~21.5s of pure running, which is what puts a clean
     * run inside the family's 20-75s completion band (a 4800px world lands at
     * 18.5s, under it).
     */
    worldWidth: 5600,
    worldHeight: 1280,
    baseY: 1040,
    // The whole surface band fits one screen height, so the camera only ever
    // scrolls horizontally — no vertical follow, no off-screen platforms.
    minTopY: 560,
    maxTopY: 1080,
    minWidth: 120,
    maxWidth: 400,
    floatThickness: 40,
    startPad: 480,
    endPad: 560,
    maxDrop: 160,
    landMargin: 20,
    minLandingWindow: 32,
    spikeClearance: 120,
    spikeSize: 40,
    hazardMargin: 8,
    coinRadius: 40,
  } satisfies SideGeometry,

  player: {
    size: 44,
    /** Jump still allowed this long after walking off an edge. */
    coyoteMs: 100,
    /** A tap this long before landing still jumps on touchdown. */
    jumpBufferMs: 120,
  },

  coin: {
    size: 28,
    score: 25,
    /** Coins per unit of meta currency on the results screen. */
    perCurrency: 2,
    /**
     * `meta_coin_magnet` widens the pickup BODY (never the drawn coin) by this
     * share of its size per perk level, so a magnet reads as reach rather than
     * as bigger scenery.
     */
    magnetPerPerkLevel: 0.12,
  },

  exit: { width: 64, height: 104 },

  camera: {
    lerp: 0.14,
    /** Player sits left of centre so the run-up to the next gap is visible. */
    lookAhead: 140,
    deadzoneWidth: 160,
  },

  /** Time budget per level (`LevelDirector.timeSeconds`); a clean run is ~22s. */
  levelTimeSeconds: 90,
  /**
   * Star bands as the share of the time budget LEFT on the win. A clean ~22s
   * run of the 90s budget leaves ~75% and takes all three; 40s leaves 55% and
   * takes two; anything slower still clears the level for one.
   */
  starBands: [0, 0.55, 0.7] as readonly [number, number, number],
  /** `extra-life`: the revive offer after a fatal hit, once per level. */
  revive: {
    /** How long the offer stays tappable before the level restarts anyway. */
    promptMs: 3000,
    /** Hero is re-dropped this far above the surface it last stood on. */
    liftPx: 24,
  },
  /** Score for reaching the door, on top of coins. */
  exitScore: 250,
  /** Death → restart transition; the retry must feel instant (< 600ms). */
  deathHoldMs: 220,
  hitstopMs: 60,
  fadeOutMs: 200,
  /** Generator attempts before the knobs are relaxed (see `gen.ts`). */
  maxGenAttempts: 20,

  /**
   * Generated-art slots; `null` keeps the procedural primitive + tint. Hero
   * art is a character (never tinted once it resolves), platforms and spikes
   * are tiles stretched to the generator's geometry.
   */
  art: {
    hero: null,
    platform: null,
    spike: null,
    coin: null,
    exit: null,
  } as Record<'hero' | 'platform' | 'spike' | 'coin' | 'exit', ArtSlot | null>,
} as const;
