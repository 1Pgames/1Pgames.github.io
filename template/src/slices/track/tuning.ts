import type { LapSpec } from '../../core/lap';
import type { ArtSlot } from '../../data/art';
import type { BotProfile, CarSpec, TrackSpec } from './math';

/**
 * Every balance number of the top-down racing slice (family E). Slice-local by
 * design: the shared `TUNING` in `src/config.ts` stays the arena's.
 *
 * The track is sized to FIT the portrait screen inside `SAFE` (centre 360/600,
 * 250x380 radii → a 624x884 footprint including the tarmac), so the camera
 * never moves and the whole race stays readable — the single biggest
 * readability win a one-thumb racer can take. The centreline octagon is
 * ~1.95k px long, so `maxSpeed` sets the lap time directly:
 * 1950px / ~105px/s average ≈ 18.5s a lap, ~56s for the 3-lap race.
 */
export const TRACK_TUNING = {
  race: { laps: 3, checkpoints: 8 } satisfies LapSpec,

  track: {
    centerX: 360,
    centerY: 600,
    rx: 250,
    ry: 380,
    halfWidth: 62,
    checkpoints: 8,
    /**
     * Comfortably wider than `halfWidth` so nobody can drive a legal line and
     * still miss a checkpoint, and well under the ~240px waypoint spacing so
     * two rings never overlap.
     */
    checkpointRadius: 110,
  } satisfies TrackSpec,

  car: {
    accel: 190,
    brake: 260,
    drag: 0.55,
    maxSpeed: 102,
    steerRate: 2.6,
    steerSpeedRef: 90,
    /** Grass costs nearly half the top speed — cutting a corner never pays. */
    offTrackFactor: 0.5,
    corneringDrag: 0.22,
  } satisfies CarSpec,

  /**
   * The field. One bot below the player, one just under, one just over: the
   * player can win from the start grid but never coast to it. Wobble gives
   * each bot its own visible racing line.
   */
  bots: [
    { speedMul: 0.92, lookaheadPx: 210, wobbleAmp: 26, wobbleHz: 0.21, phase: 0.0 },
    { speedMul: 0.97, lookaheadPx: 190, wobbleAmp: 18, wobbleHz: 0.29, phase: 1.9 },
    { speedMul: 1.02, lookaheadPx: 178, wobbleAmp: 10, wobbleHz: 0.37, phase: 3.6 },
  ] satisfies readonly BotProfile[],

  /** Bot wobble phases are re-rolled per run seed within this band. */
  phaseJitter: Math.PI,

  car2d: { width: 40, height: 24 },

  /**
   * Surface colours. The tarmac has to sit CLEARLY above the backdrop —
   * painting it `PALETTE.bgTop` makes the road the same value as the infield
   * and the whole track collapses into a thin outline.
   */
  surface: { tarmac: 0x2b3450, centreLine: 0xffffff },

  /** Payout by finishing position (1st..4th). */
  currencyByPosition: [30, 20, 12, 6],
  /** Score by finishing position, plus a bonus per lap completed. */
  scoreByPosition: [1200, 800, 500, 300],
  scorePerLap: 200,

  /** Wrong-way nag: shown at most this often. */
  wrongWayCooldownMs: 1600,
  /** Heading-vs-centreline dot below this counts as driving backwards. */
  wrongWayDot: -0.25,

  hitstopMs: 60,
  fadeOutMs: 220,

  /**
   * `meta_tune_up`: top speed added per perk level. 2% a level over 6 levels is
   * +12% flat out — enough to feel, small enough that the bot field (0.92-1.02
   * of the player's spec) still races the player rather than parading in front
   * of them.
   */
  perks: {
    topSpeedPerLevel: 0.02,
  },

  /**
   * Generated-art slots. `cars[0]` is the player, the rest the field in grid
   * order; `null` keeps the tinted rectangle. The track SURFACE stays
   * procedural — it is baked per seed (see `paintTrack`).
   */
  art: {
    cars: [null, null, null, null] as readonly (ArtSlot | null)[],
    playerMarker: null as ArtSlot | null,
  },
} as const;
