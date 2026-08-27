/**
 * Track geometry + car kinematics for the family E (top-down racing) slice.
 * Pure TypeScript, no Phaser import, no `Math.random`: the slice renders what
 * this module computes and `src/sim/families/track.ts` races the exact same
 * numbers headlessly.
 *
 * ---------------------------------------------------------------------------
 * THE TRACK
 * ---------------------------------------------------------------------------
 * A closed loop of `checkpoints` waypoints sampled off an ellipse, with a
 * per-waypoint radius multiplier that gives the three shapes their character:
 *
 *   oval    every waypoint on the ellipse — the readable baseline
 *   kidney  ONE waypoint pulled inward, so one corner tightens into a hairpin
 *   pinch   two OPPOSITE waypoints pulled in, squeezing the loop at the waist
 *
 * Waypoint 0 sits at the bottom centre (the start/finish line) and the loop
 * runs bottom → right → top → left, so a car starts pointing right. The
 * drivable surface is everything within `halfWidth` of the centreline
 * polyline; further out is off-track and speed-capped, never a wall — a
 * one-thumb racer must not be able to get stuck.
 *
 * ---------------------------------------------------------------------------
 * THE CAR
 * ---------------------------------------------------------------------------
 * Kinematic, not rigid-body: heading integrates the steering input, speed
 * integrates throttle/brake against drag, and position integrates heading.
 * Two couplings do all the feel work:
 *   - steering authority scales with speed (`speed / steerSpeedRef`, capped at
 *     1) so a stopped car cannot pivot on the spot;
 *   - the speed ceiling drops with `|steer|` (`corneringDrag`) and again when
 *     off-track (`offTrackFactor`), so cutting a corner across the grass costs
 *     time instead of being free.
 *
 * Bots drive by pure pursuit: aim at a point `lookaheadPx` further along the
 * centreline, offset sideways by a seeded wobble so a field of bots takes
 * visibly different lines instead of driving as one rigid train.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export type TrackShapeId = 'oval' | 'kidney' | 'pinch';

export const TRACK_SHAPES: readonly TrackShapeId[] = ['oval', 'kidney', 'pinch'];

export interface TrackSpec {
  centerX: number;
  centerY: number;
  rx: number;
  ry: number;
  /** Drivable half width around the centreline. */
  halfWidth: number;
  /** Waypoint count; index 0 is the start/finish line (`LapSpec.checkpoints`). */
  checkpoints: number;
  /** How close a car must pass a waypoint for it to count as crossed. */
  checkpointRadius: number;
}

export interface TrackSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Unit direction from a to b. */
  dirX: number;
  dirY: number;
  length: number;
  /** Centreline distance from waypoint 0 to this segment's start. */
  start: number;
}

export interface Track {
  shape: TrackShapeId;
  /** Closed loop; `waypoints[0]` is the start/finish line. */
  waypoints: readonly Vec2[];
  /** `segments[i]` runs waypoint i → i+1 (last wraps to 0). */
  segments: readonly TrackSegment[];
  halfWidth: number;
  checkpointRadius: number;
  /** Total centreline length of the closed loop. */
  length: number;
}

/** Radius multiplier per waypoint — the only difference between the shapes. */
function shapeRadius(shape: TrackShapeId, index: number, count: number): number {
  if (shape === 'kidney') return index === 2 ? 0.42 : 1;
  if (shape === 'pinch') return index === 2 || index === 2 + count / 2 ? 0.62 : 1;
  return 1;
}

export function buildTrack(spec: TrackSpec, shape: TrackShapeId): Track {
  const count = spec.checkpoints;
  const waypoints: Vec2[] = [];
  for (let i = 0; i < count; i += 1) {
    // Start at the bottom centre and sweep so the loop reads bottom → right
    // → top → left on a portrait screen.
    const angle = Math.PI / 2 - (i * Math.PI * 2) / count;
    const k = shapeRadius(shape, i, count);
    waypoints.push({
      x: spec.centerX + Math.cos(angle) * spec.rx * k,
      y: spec.centerY + Math.sin(angle) * spec.ry * k,
    });
  }

  const segments: TrackSegment[] = [];
  let start = 0;
  for (let i = 0; i < count; i += 1) {
    const a = waypoints[i]!;
    const b = waypoints[(i + 1) % count]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, dirX: dx / length, dirY: dy / length, length, start });
    start += length;
  }

  return { shape, waypoints, segments, halfWidth: spec.halfWidth, checkpointRadius: spec.checkpointRadius, length: start };
}

/** Where a point projects onto the centreline. Filled in place: no allocation. */
export interface TrackHit {
  /** Perpendicular distance to the closest centreline segment. */
  distance: number;
  segment: number;
  /** Arc length from waypoint 0 to the projection. */
  s: number;
  /** Unit tangent of the closest segment (the "forward" direction there). */
  tangentX: number;
  tangentY: number;
}

export function createTrackHit(): TrackHit {
  return { distance: 0, segment: 0, s: 0, tangentX: 1, tangentY: 0 };
}

export function nearestOnTrack(track: Track, x: number, y: number, out: TrackHit): TrackHit {
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < track.segments.length; i += 1) {
    const seg = track.segments[i]!;
    const along = Math.min(seg.length, Math.max(0, (x - seg.ax) * seg.dirX + (y - seg.ay) * seg.dirY));
    const px = seg.ax + seg.dirX * along;
    const py = seg.ay + seg.dirY * along;
    const distance = Math.hypot(x - px, y - py);
    if (distance < bestDistance) {
      bestDistance = distance;
      out.distance = distance;
      out.segment = i;
      out.s = seg.start + along;
      out.tangentX = seg.dirX;
      out.tangentY = seg.dirY;
    }
  }
  return out;
}

/** Point `s` px along the centreline, wrapping around the loop. */
export function pointAtDistance(track: Track, s: number, out: Vec2): Vec2 {
  const total = track.length;
  let target = s % total;
  if (target < 0) target += total;
  for (let i = 0; i < track.segments.length; i += 1) {
    const seg = track.segments[i]!;
    if (target <= seg.start + seg.length || i === track.segments.length - 1) {
      const along = Math.min(seg.length, Math.max(0, target - seg.start));
      out.x = seg.ax + seg.dirX * along;
      out.y = seg.ay + seg.dirY * along;
      return out;
    }
  }
  out.x = track.segments[0]!.ax;
  out.y = track.segments[0]!.ay;
  return out;
}

export interface CarSpec {
  accel: number;
  brake: number;
  /** Velocity decay per second (fraction), applied every step. */
  drag: number;
  maxSpeed: number;
  /** Turn rate (rad/s) at or above `steerSpeedRef`. */
  steerRate: number;
  steerSpeedRef: number;
  /** Share of `maxSpeed` still available with the wheels off the tarmac. */
  offTrackFactor: number;
  /** Share of `maxSpeed` a full-lock corner costs. */
  corneringDrag: number;
}

export interface CarState {
  x: number;
  y: number;
  /** Radians; 0 points right (+x), matching `Phaser.GameObjects.Image#rotation`. */
  heading: number;
  speed: number;
}

export interface CarInput {
  /** 1 = throttle, 0 = coast, negative = brake. */
  throttle: number;
  /** -1 = full left, 1 = full right. */
  steer: number;
}

/** Per-car copy of the shared handling spec with its own speed ceiling. */
export function scaleCarSpec(spec: CarSpec, speedMul: number): CarSpec {
  return { ...spec, maxSpeed: spec.maxSpeed * speedMul };
}

/** Speed ceiling for the current steering angle and surface. */
export function speedCeiling(spec: CarSpec, steer: number, offTrack: boolean): number {
  const cornering = 1 - spec.corneringDrag * Math.min(1, Math.abs(steer));
  return spec.maxSpeed * cornering * (offTrack ? spec.offTrackFactor : 1);
}

/** Advances one car by `dtS` seconds. Mutates `car`; allocates nothing. */
export function stepCar(car: CarState, input: CarInput, spec: CarSpec, track: Track, hit: TrackHit, dtS: number): void {
  const steer = Math.min(1, Math.max(-1, input.steer));
  const throttle = Math.min(1, Math.max(-1, input.throttle));

  // Steering authority grows with speed: a stationary car cannot pivot, which
  // is what stops a stalled player from spinning in place on the grass.
  const authority = Math.min(1, car.speed / spec.steerSpeedRef);
  car.heading += steer * spec.steerRate * authority * dtS;

  nearestOnTrack(track, car.x, car.y, hit);
  const ceiling = speedCeiling(spec, steer, hit.distance > track.halfWidth);

  car.speed += (throttle >= 0 ? throttle * spec.accel : throttle * spec.brake) * dtS;
  car.speed -= car.speed * spec.drag * dtS;
  // Over the ceiling the car scrubs down instead of snapping, so hitting the
  // grass or a hard corner reads as losing momentum.
  if (car.speed > ceiling) car.speed = Math.max(ceiling, car.speed - spec.brake * dtS);
  if (car.speed < 0) car.speed = 0;

  car.x += Math.cos(car.heading) * car.speed * dtS;
  car.y += Math.sin(car.heading) * car.speed * dtS;
}

export function isOffTrack(track: Track, hit: TrackHit): boolean {
  return hit.distance > track.halfWidth;
}

/** Normalises to (-π, π] — the only sane form for a heading difference. */
export function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * cos of the angle between the car's heading and the centreline's forward
 * direction: 1 = perfectly on the racing line, negative = driving backwards
 * (what the slice's wrong-way indicator watches).
 */
export function trackForwardness(car: CarState, hit: TrackHit): number {
  return Math.cos(car.heading) * hit.tangentX + Math.sin(car.heading) * hit.tangentY;
}

/** True when the car is inside checkpoint `index`'s proximity ring. */
export function checkpointHit(track: Track, index: number, car: CarState): boolean {
  const waypoint = track.waypoints[index];
  if (waypoint === undefined) return false;
  const dx = car.x - waypoint.x;
  const dy = car.y - waypoint.y;
  return dx * dx + dy * dy <= track.checkpointRadius * track.checkpointRadius;
}

export interface BotProfile {
  /** Multiplier on the shared `maxSpeed`; the whole field's spread. */
  speedMul: number;
  /** How far up the centreline the bot aims. Short = twitchy, long = smooth. */
  lookaheadPx: number;
  /** Lateral wobble amplitude in px — a bot's personal racing line. */
  wobbleAmp: number;
  /** Wobble frequency in Hz. */
  wobbleHz: number;
  /** Seeded phase so two bots with the same numbers still differ. */
  phase: number;
}

/** Sideways offset of the bot's aim point at `timeS`. */
export function botLateralOffset(profile: BotProfile, timeS: number): number {
  return profile.wobbleAmp * Math.sin(Math.PI * 2 * profile.wobbleHz * timeS + profile.phase);
}

/** Steering gain: this much heading error (rad) means full lock. */
const FULL_LOCK_ERROR = 0.55;

/**
 * Pure pursuit: steer toward a point `lookaheadPx` ahead on the centreline,
 * pushed `lateralOffset` px sideways. Returns a steer input in [-1, 1].
 */
export function pursuitSteer(
  track: Track,
  car: CarState,
  hit: TrackHit,
  lookaheadPx: number,
  lateralOffset: number,
  aim: Vec2,
): number {
  nearestOnTrack(track, car.x, car.y, hit);
  pointAtDistance(track, hit.s + lookaheadPx, aim);
  // Segment normal (tangent rotated 90°) carries the personal racing line.
  const targetX = aim.x - hit.tangentY * lateralOffset;
  const targetY = aim.y + hit.tangentX * lateralOffset;
  const error = wrapAngle(Math.atan2(targetY - car.y, targetX - car.x) - car.heading);
  return Math.min(1, Math.max(-1, error / FULL_LOCK_ERROR));
}

/** Full bot input for this frame: pursuit steering plus a speed-holding throttle. */
export function botInput(
  track: Track,
  car: CarState,
  spec: CarSpec,
  profile: BotProfile,
  timeS: number,
  hit: TrackHit,
  aim: Vec2,
  out: CarInput,
): CarInput {
  out.steer = pursuitSteer(track, car, hit, profile.lookaheadPx, botLateralOffset(profile, timeS), aim);
  // Hold just under the corner-adjusted ceiling: full throttle out of a bend,
  // a touch of brake when carrying too much speed into one.
  const ceiling = speedCeiling(spec, out.steer, isOffTrack(track, hit));
  out.throttle = car.speed < ceiling * 0.98 ? 1 : -0.15;
  return out;
}

/**
 * Per-car race progress in centreline px. Sorting cars by `distance`
 * descending IS the leaderboard, so the HUD's position readout needs no
 * bespoke bookkeeping.
 *
 * The arc length `hit.s` wraps to 0 at the start/finish line, and a lap is
 * credited on ENTERING the finish ring — some way before the line itself — so
 * neither one is a monotone key on its own. Accumulating the *delta* and
 * unwrapping any jump longer than half the loop is, and it stays correct for a
 * car that spins and drives backwards (its progress genuinely goes down).
 */
export interface RaceProgress {
  distance: number;
  lastS: number;
}

export function createRaceProgress(hit: TrackHit): RaceProgress {
  return { distance: hit.s, lastS: hit.s };
}

export function advanceRaceProgress(track: Track, hit: TrackHit, progress: RaceProgress): number {
  let delta = hit.s - progress.lastS;
  const half = track.length / 2;
  if (delta < -half) delta += track.length;
  else if (delta > half) delta -= track.length;
  progress.distance += delta;
  progress.lastS = hit.s;
  return progress.distance;
}

/**
 * Places `count` cars on a staggered grid on the APPROACH to waypoint 0 — the
 * segment that leads into the start/finish line — so every car begins aligned
 * with the centreline it is standing on (a grid aimed down the *next* segment
 * would start the whole field at a 60° angle to the tarmac under it).
 */
export function startGrid(track: Track, count: number, out: CarState[]): CarState[] {
  const approach = track.segments[track.segments.length - 1]!;
  const heading = Math.atan2(approach.dirY, approach.dirX);
  for (let i = 0; i < count; i += 1) {
    // Two-by-two grid, staggered back along the centreline from the line.
    const back = 40 + Math.floor(i / 2) * 56;
    const side = (i % 2 === 0 ? -1 : 1) * track.halfWidth * 0.45;
    const state = out[i] ?? { x: 0, y: 0, heading: 0, speed: 0 };
    state.x = approach.bx - approach.dirX * back - approach.dirY * side;
    state.y = approach.by - approach.dirY * back + approach.dirX * side;
    state.heading = heading;
    state.speed = 0;
    out[i] = state;
  }
  return out;
}
