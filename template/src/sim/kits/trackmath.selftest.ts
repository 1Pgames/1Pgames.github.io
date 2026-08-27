// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/trackmath.selftest.ts
import assert from 'node:assert/strict';
import { LapDirector } from '../../core/lap';
import { Rng } from '../../core/rng';
import {
  TRACK_SHAPES,
  advanceRaceProgress,
  botInput,
  botLateralOffset,
  buildTrack,
  checkpointHit,
  createRaceProgress,
  createTrackHit,
  isOffTrack,
  nearestOnTrack,
  pointAtDistance,
  scaleCarSpec,
  speedCeiling,
  startGrid,
  stepCar,
  trackForwardness,
  wrapAngle,
  type BotProfile,
  type CarInput,
  type CarState,
  type Track,
} from '../../slices/track/math';
import { TRACK_TUNING } from '../../slices/track/tuning';

const spec = TRACK_TUNING.track;
const carSpec = TRACK_TUNING.car;
const STEP = 1 / 60;

/**
 * Races one pure-pursuit car around `track` until it finishes or runs out of
 * steps — the same loop the slice and the sim family run.
 *
 * Only the EXPECTED checkpoint is ever reported: `LapDirector` deliberately
 * has no `nextCheckpoint` getter, so a driver mirrors it locally (the race
 * starts on the line, so checkpoint 1 is next) and advances the mirror on a
 * successful pass. Reporting every ring the car sits inside would spam
 * rejected out-of-order calls for as long as the car is near a waypoint.
 */
function driveLaps(
  track: Track,
  profile: BotProfile,
  laps: number,
  maxSteps: number,
): { steps: number; director: LapDirector; car: CarState; offTrackSteps: number; rejected: number } {
  const director = new LapDirector({ laps, checkpoints: spec.checkpoints });
  const car = startGrid(track, 1, [])[0]!;
  const scaled = scaleCarSpec(carSpec, profile.speedMul);
  const hit = createTrackHit();
  const aim = { x: 0, y: 0 };
  const input: CarInput = { throttle: 0, steer: 0 };
  let offTrackSteps = 0;
  let rejected = 0;
  let steps = 0;
  let expected = 1;

  while (!director.ended && steps < maxSteps) {
    botInput(track, car, scaled, profile, steps * STEP, hit, aim, input);
    stepCar(car, input, scaled, track, hit, STEP);
    director.update(STEP * 1000);
    if (isOffTrack(track, hit)) offTrackSteps += 1;
    if (checkpointHit(track, expected, car)) {
      if (director.passCheckpoint(expected)) expected = (expected + 1) % spec.checkpoints;
      else rejected += 1;
    }
    steps += 1;
  }
  return { steps, director, car, offTrackSteps, rejected };
}

// --- geometry: the three shapes are real, distinct tracks --------------------
{
  const tracks = TRACK_SHAPES.map((shape) => buildTrack(spec, shape));
  for (const track of tracks) {
    assert.equal(track.waypoints.length, spec.checkpoints, 'one waypoint per checkpoint');
    assert.equal(track.segments.length, spec.checkpoints, 'a closed loop has as many segments as waypoints');
    assert.ok(track.length > 1000, `${track.shape}: a race track is not a dot (${track.length.toFixed(0)}px)`);

    // Segment starts are cumulative and the loop closes back on waypoint 0.
    let walked = 0;
    for (const segment of track.segments) {
      assert.ok(Math.abs(segment.start - walked) < 1e-6, `${track.shape}: segment offsets must be cumulative`);
      assert.ok(Math.abs(Math.hypot(segment.dirX, segment.dirY) - 1) < 1e-9, 'segment directions are unit vectors');
      walked += segment.length;
    }
    assert.ok(Math.abs(walked - track.length) < 1e-6, `${track.shape}: length is the sum of its segments`);

    const first = track.waypoints[0]!;
    assert.ok(Math.abs(first.x - spec.centerX) < 1e-9, 'waypoint 0 is the bottom-centre start line');
    assert.ok(first.y > spec.centerY, 'and it is below the centre, so the field starts pointing right');

    // Everything, tarmac included, fits the portrait screen.
    for (const waypoint of track.waypoints) {
      assert.ok(waypoint.x - track.halfWidth > 0 && waypoint.x + track.halfWidth < 720, `${track.shape}: track off-screen in x`);
      assert.ok(waypoint.y - track.halfWidth > 140 && waypoint.y + track.halfWidth < 1060, `${track.shape}: track outside SAFE in y`);
    }
  }

  // Distinctness: measure the per-waypoint radius spread each shape produces.
  const spread = (track: Track): number => {
    const radii = track.waypoints.map((w) => Math.hypot((w.x - spec.centerX) / spec.rx, (w.y - spec.centerY) / spec.ry));
    const mean = radii.reduce((sum, r) => sum + r, 0) / radii.length;
    return radii.reduce((sum, r) => sum + (r - mean) ** 2, 0) / radii.length;
  };
  const [oval, kidney, pinch] = tracks as [Track, Track, Track];
  assert.ok(spread(oval) < 1e-9, 'the oval is a plain ellipse: zero radius variance');
  assert.ok(spread(kidney) > 0.02, 'the kidney pulls one waypoint in hard');
  assert.ok(spread(pinch) > 0.005 && spread(pinch) < spread(kidney), 'the pinch squeezes two waypoints less deeply');
  assert.notEqual(kidney.length.toFixed(2), oval.length.toFixed(2), 'a reshaped loop is a different length');
  assert.notEqual(pinch.length.toFixed(2), kidney.length.toFixed(2), 'and all three differ from each other');
}

// --- centreline queries -----------------------------------------------------
{
  const track = buildTrack(spec, 'oval');
  const hit = createTrackHit();
  const point = { x: 0, y: 0 };

  // A point exactly on a waypoint is on the centreline, at that waypoint's arc length.
  for (let i = 0; i < track.waypoints.length; i += 1) {
    const waypoint = track.waypoints[i]!;
    nearestOnTrack(track, waypoint.x, waypoint.y, hit);
    assert.ok(hit.distance < 1e-6, `waypoint ${i} is on the centreline`);
    const expected = track.segments[i]!.start;
    assert.ok(Math.abs(hit.s - expected) < 1e-6, `waypoint ${i} sits at its own segment offset`);
  }

  // pointAtDistance is the inverse of nearestOnTrack along the loop.
  for (const s of [0, 100, 777, track.length - 1, track.length + 250, -300]) {
    pointAtDistance(track, s, point);
    nearestOnTrack(track, point.x, point.y, hit);
    assert.ok(hit.distance < 1e-6, `s=${s} maps onto the centreline`);
    const wrapped = ((s % track.length) + track.length) % track.length;
    assert.ok(Math.abs(hit.s - wrapped) < 1e-3, `s=${s} round-trips to the same arc length`);
  }

  // Off-track detection: the middle of the ellipse is grass, so is far outside.
  nearestOnTrack(track, spec.centerX, spec.centerY, hit);
  assert.ok(isOffTrack(track, hit), 'the infield is not drivable');
  nearestOnTrack(track, track.waypoints[0]!.x, track.waypoints[0]!.y + spec.halfWidth - 2, hit);
  assert.equal(isOffTrack(track, hit), false, 'just inside halfWidth is still tarmac');
  nearestOnTrack(track, track.waypoints[0]!.x, track.waypoints[0]!.y + spec.halfWidth + 4, hit);
  assert.ok(isOffTrack(track, hit), 'just outside halfWidth is grass');

  // Off-track costs speed, hard cornering costs speed, both stack.
  assert.equal(speedCeiling(carSpec, 0, false), carSpec.maxSpeed, 'straight and on tarmac is the full ceiling');
  assert.ok(speedCeiling(carSpec, 1, false) < carSpec.maxSpeed, 'full lock costs speed');
  assert.ok(speedCeiling(carSpec, 0, true) < speedCeiling(carSpec, 0, false), 'grass costs speed');
  assert.ok(speedCeiling(carSpec, 1, true) < speedCeiling(carSpec, 1, false), 'and the two penalties stack');

  assert.equal(wrapAngle(Math.PI * 3), Math.PI, 'wrapAngle keeps pi, not -pi');
  assert.ok(Math.abs(wrapAngle(-Math.PI * 1.5) - Math.PI * 0.5) < 1e-9);
}

// --- car kinematics ---------------------------------------------------------
{
  const track = buildTrack(spec, 'oval');
  const hit = createTrackHit();
  const first = track.segments[0]!;
  // Aimed straight down segment 0 so the whole test stays on the tarmac —
  // off-track would cap the speed at half and mask the real ceiling.
  const car: CarState = { x: first.ax, y: first.ay, heading: Math.atan2(first.dirY, first.dirX), speed: 0 };

  // A parked car cannot pivot: steering authority is speed-gated.
  const before = car.heading;
  stepCar(car, { throttle: 0, steer: 1 }, carSpec, track, hit, STEP);
  assert.equal(car.heading, before, 'a stopped car does not turn');

  // Throttle converges on the ceiling (~0.8s from rest) and never passes it.
  for (let i = 0; i < 90; i += 1) stepCar(car, { throttle: 1, steer: 0 }, carSpec, track, hit, STEP);
  assert.ok(hit.distance <= track.halfWidth, 'the probe stayed on the tarmac');
  assert.ok(car.speed <= carSpec.maxSpeed + 1e-6, 'the speed ceiling holds');
  assert.ok(car.speed > carSpec.maxSpeed * 0.97, 'and full throttle actually reaches it');

  // Braking stops the car, and it never reverses through zero.
  for (let i = 0; i < 600; i += 1) stepCar(car, { throttle: -1, steer: 0 }, carSpec, track, hit, STEP);
  assert.equal(car.speed, 0, 'braking settles at a standstill, never negative');

  // Forwardness: a car aimed down the centreline it stands on reads +1,
  // reversed reads -1. The start grid sits on the approach to the line and is
  // aligned with it, so the whole field starts perfectly forward.
  const grid = startGrid(track, 4, []);
  const pole = grid[0]!;
  const onStartSegment = { ...pole, heading: Math.atan2(first.dirY, first.dirX), x: first.ax + first.dirX * 40, y: first.ay + first.dirY * 40 };
  nearestOnTrack(track, onStartSegment.x, onStartSegment.y, hit);
  assert.ok(trackForwardness(onStartSegment, hit) > 0.99, 'past the line, the racing line is the heading');
  nearestOnTrack(track, pole.x, pole.y, hit);
  const poleForward = trackForwardness(pole, hit);
  assert.ok(poleForward > 0.99, `the start grid points down the track (${poleForward.toFixed(2)})`);
  assert.ok(poleForward > TRACK_TUNING.wrongWayDot, 'and never trips the wrong-way threshold');
  assert.ok(trackForwardness({ ...pole, heading: pole.heading + Math.PI }, hit) < -0.99, 'a u-turn reads as wrong way');
  assert.equal(grid.length, 4, 'the grid holds the whole field');
  for (let i = 1; i < grid.length; i += 1) {
    const previous = grid[i - 1]!;
    const current = grid[i]!;
    assert.ok(
      Math.hypot(current.x - previous.x, current.y - previous.y) > 20,
      'grid slots are separated, so cars do not start inside each other',
    );
  }
}

// --- LapDirector integration: checkpoint order is enforced -------------------
{
  const track = buildTrack(spec, 'oval');
  const director = new LapDirector({ laps: 3, checkpoints: spec.checkpoints });

  // The race starts on the line, so checkpoint 1 is next — not 0, and not 5.
  assert.equal(director.passCheckpoint(5), false, 'skipping ahead is rejected');
  assert.equal(director.passCheckpoint(0), false, 're-crossing the line before a lap is rejected');
  assert.equal(director.passCheckpoint(1), true, 'the expected checkpoint counts');
  assert.equal(director.passCheckpoint(1), false, 'and it only counts once');

  const car = startGrid(track, 1, [])[0]!;
  assert.ok(checkpointHit(track, 0, car), 'the grid sits inside the start-line ring');
  assert.equal(checkpointHit(track, 4, car), false, 'and nowhere near the far side of the track');
}

// --- a pure-pursuit bot completes the race on every shape -------------------
{
  const profile: BotProfile = { speedMul: 1, lookaheadPx: 170, wobbleAmp: 0, wobbleHz: 0.2, phase: 0 };
  // Step budget: 3 laps of ~1.95k px at >= 60% of the 118px/s ceiling is well
  // under 40s a lap, so 45s of simulated time per lap is a generous ceiling.
  const budgetPerLap = Math.ceil(45 / STEP);

  for (const shape of TRACK_SHAPES) {
    const track = buildTrack(spec, shape);
    const run = driveLaps(track, profile, 3, budgetPerLap * 3);
    assert.ok(run.director.ended, `${shape}: the bot must finish the race`);
    assert.equal(run.director.outcome?.won, true, `${shape}: finishing 3 laps is a win`);
    assert.equal(run.director.lapTimesMs.length, 3, `${shape}: three lap times recorded`);
    assert.ok(run.steps < budgetPerLap * 3, `${shape}: finished inside the step budget`);
    assert.equal(run.rejected, 0, `${shape}: a clean lap never has a checkpoint rejected`);

    const lapSeconds = run.director.lapTimesMs.map((ms) => ms / 1000);
    for (const lap of lapSeconds) {
      assert.ok(lap >= 10 && lap <= 40, `${shape}: lap time ${lap.toFixed(1)}s is outside the design band`);
    }
    // Later laps are flying laps: no standing start to pay for.
    assert.ok(lapSeconds[1]! <= lapSeconds[0]! + 0.5, `${shape}: the second lap should not be slower than the first`);
    assert.ok(run.offTrackSteps / run.steps < 0.35, `${shape}: pure pursuit keeps the bot mostly on the tarmac`);
  }
}

// --- the bot field spreads out, and wobble is what individualises it --------
{
  const track = buildTrack(spec, 'oval');
  const times = TRACK_TUNING.bots.map((bot) => {
    const run = driveLaps(track, bot, 1, Math.ceil(60 / STEP));
    assert.ok(run.director.ended, `bot ${bot.speedMul} must complete its lap`);
    return { mul: bot.speedMul, ms: run.director.lapTimesMs[0]! };
  });
  for (let i = 1; i < times.length; i += 1) {
    assert.ok(
      times[i]!.ms < times[i - 1]!.ms,
      `a faster speedMul must lap faster (${times[i - 1]!.mul}:${times[i - 1]!.ms.toFixed(0)}ms vs ${times[i]!.mul}:${times[i]!.ms.toFixed(0)}ms)`,
    );
  }

  const wobbly: BotProfile = { ...TRACK_TUNING.bots[0]!, wobbleAmp: 40 };
  assert.equal(botLateralOffset(wobbly, 0), Math.sin(wobbly.phase) * 40, 'wobble is a plain seeded sine');
  const samples = [0, 1, 2, 3, 4].map((t) => botLateralOffset(wobbly, t));
  assert.ok(Math.max(...samples) - Math.min(...samples) > 10, 'and it actually moves the racing line');
  const rng = new Rng('phase');
  const shifted: BotProfile = { ...wobbly, phase: wobbly.phase + rng.float(0, Math.PI) };
  assert.notEqual(botLateralOffset(shifted, 0.5), botLateralOffset(wobbly, 0.5), 'a re-rolled phase changes the line');
}

// --- race progress is a monotone leaderboard key ----------------------------
{
  const track = buildTrack(spec, 'oval');
  const hit = createTrackHit();
  const car = startGrid(track, 1, [])[0]!;
  const profile: BotProfile = { speedMul: 1, lookaheadPx: 170, wobbleAmp: 0, wobbleHz: 0.2, phase: 0 };
  const scaled = scaleCarSpec(carSpec, 1);
  const aim = { x: 0, y: 0 };
  const input: CarInput = { throttle: 0, steer: 0 };
  const director = new LapDirector({ laps: 3, checkpoints: spec.checkpoints });
  nearestOnTrack(track, car.x, car.y, hit);
  const progress = createRaceProgress(hit);

  let previous = progress.distance;
  let laps = 0;
  let expected = 1;
  for (let step = 0; step < Math.ceil(60 / STEP) && !director.ended; step += 1) {
    botInput(track, car, scaled, profile, step * STEP, hit, aim, input);
    stepCar(car, input, scaled, track, hit, STEP);
    director.update(STEP * 1000);
    if (checkpointHit(track, expected, car) && director.passCheckpoint(expected)) {
      if (expected === 0) laps += 1;
      expected = (expected + 1) % spec.checkpoints;
    }
    const distance = advanceRaceProgress(track, hit, progress);
    assert.ok(distance >= previous - 1e-6, `progress must never go backwards (step ${step})`);
    previous = distance;
  }
  assert.ok(laps >= 2, 'the progress probe actually drove laps');
  // Two laps of driving must show up as two laps of centreline distance.
  assert.ok(
    progress.distance > track.length * laps * 0.9,
    `progress (${progress.distance.toFixed(0)}px) should track ${laps} laps of ${track.length.toFixed(0)}px`,
  );

  // Reversing drops the key, which is what makes overtaking readable.
  const before = progress.distance;
  car.heading += Math.PI;
  for (let step = 0; step < 120; step += 1) {
    stepCar(car, { throttle: 1, steer: 0 }, scaled, track, hit, STEP);
    advanceRaceProgress(track, hit, progress);
  }
  assert.ok(progress.distance < before, 'driving backwards loses progress');
}

console.log('trackmath.selftest: ok');
