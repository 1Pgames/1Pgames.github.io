import { LapDirector } from '../../core/lap';
import { Rng } from '../../core/rng';
import {
  TRACK_SHAPES,
  advanceRaceProgress,
  botInput,
  buildTrack,
  checkpointHit,
  createRaceProgress,
  createTrackHit,
  isOffTrack,
  nearestOnTrack,
  scaleCarSpec,
  startGrid,
  stepCar,
  type BotProfile,
  type CarInput,
  type CarSpec,
  type CarState,
  type RaceProgress,
  type Track,
  type TrackHit,
  type TrackShapeId,
} from '../../slices/track/math';
import { TRACK_TUNING } from '../../slices/track/tuning';

/**
 * Headless balance gates for the top-down racing slice (family E).
 *
 * A race here is the real thing, not an approximation: the same `buildTrack`
 * geometry, the same `stepCar` kinematics, the same pure-pursuit `botInput`,
 * and one `LapDirector` per car with ordered checkpoints — so anything the sim
 * proves (a lap CAN be completed, the field DOES spread out, a lap takes N
 * seconds) is a statement about the shipping slice.
 *
 * The player's car is driven by a bot at `speedMul` 1.0 with the same handling
 * the human gets. That is deliberately an idealised driver: the gate it feeds
 * asks "is the track completable and is the field beatable at all", which is a
 * property of the track and the bot spread, not of a player's skill.
 *
 * Run: `npm run sim -- --family track [--runs 20] [--seed balance] [--json]`
 */

interface FamilyOptions {
  runs: number;
  seed: string;
  strict: boolean;
  json: boolean;
}

const STEP_S = 1 / 60;
const STEP_MS = STEP_S * 1000;
/** A race is abandoned after this much simulated time — 3 laps never need it. */
const RACE_TIMEOUT_S = 240;
/** Lap-time design band (soft gate). */
const LAP_BAND: readonly [number, number] = [15, 40];

const trackSpec = TRACK_TUNING.track;
const baseCar: CarSpec = TRACK_TUNING.car;

/** The player's seat, driven at the same handling a human gets. */
const PLAYER_PROFILE: BotProfile = {
  speedMul: 1,
  lookaheadPx: 180,
  wobbleAmp: 10,
  wobbleHz: 0.23,
  phase: 0.7,
};

interface Racer {
  name: string;
  profile: BotProfile;
  spec: CarSpec;
  car: CarState;
  director: LapDirector;
  hit: TrackHit;
  aim: { x: number; y: number };
  input: CarInput;
  progress: RaceProgress;
  /** Mirror of `LapDirector`'s expected checkpoint (it exposes no getter). */
  expected: number;
  finishS: number | null;
  offTrackSteps: number;
  steps: number;
}

interface RaceResult {
  shape: TrackShapeId;
  seed: string;
  order: readonly {
    name: string;
    speedMul: number;
    finishS: number | null;
    laps: number;
    bestLapS: number | null;
  }[];
  playerPosition: number;
  playerFinished: boolean;
  lapTimesS: readonly number[];
}

/**
 * Runs one 4-car race: the player's seat plus the three shipped bot profiles,
 * each with its wobble phase re-rolled from the run seed so a field never
 * replays exactly the same lines.
 */
function simulateRace(shape: TrackShapeId, seed: string): RaceResult {
  const track: Track = buildTrack(trackSpec, shape);
  const rng = new Rng(`${seed}:${shape}`);
  const profiles: BotProfile[] = [
    PLAYER_PROFILE,
    ...TRACK_TUNING.bots.map((bot) => ({ ...bot, phase: bot.phase + rng.float(0, TRACK_TUNING.phaseJitter) })),
  ];
  const grid = startGrid(track, profiles.length, []);

  const racers: Racer[] = profiles.map((profile, index) => {
    const car = grid[index]!;
    const hit = createTrackHit();
    nearestOnTrack(track, car.x, car.y, hit);
    return {
      name: index === 0 ? 'player' : `bot${index}`,
      profile,
      spec: scaleCarSpec(baseCar, profile.speedMul),
      car,
      director: new LapDirector(TRACK_TUNING.race),
      hit,
      aim: { x: 0, y: 0 },
      input: { throttle: 0, steer: 0 },
      progress: createRaceProgress(hit),
      expected: 1,
      finishS: null,
      offTrackSteps: 0,
      steps: 0,
    };
  });

  const maxSteps = Math.ceil(RACE_TIMEOUT_S / STEP_S);
  for (let step = 0; step < maxSteps; step += 1) {
    let racing = false;
    const timeS = step * STEP_S;
    for (const racer of racers) {
      if (racer.director.ended) continue;
      racing = true;
      botInput(track, racer.car, racer.spec, racer.profile, timeS, racer.hit, racer.aim, racer.input);
      stepCar(racer.car, racer.input, racer.spec, track, racer.hit, STEP_S);
      racer.director.update(STEP_MS);
      racer.steps += 1;
      if (isOffTrack(track, racer.hit)) racer.offTrackSteps += 1;
      advanceRaceProgress(track, racer.hit, racer.progress);
      if (checkpointHit(track, racer.expected, racer.car) && racer.director.passCheckpoint(racer.expected)) {
        racer.expected = (racer.expected + 1) % trackSpec.checkpoints;
      }
      if (racer.director.ended && racer.finishS === null) racer.finishS = racer.director.elapsedSeconds;
    }
    if (!racing) break;
  }

  // Finishers by time, then everyone else by distance covered.
  const ranked = [...racers].sort((a, b) => {
    if (a.finishS !== null && b.finishS !== null) return a.finishS - b.finishS;
    if (a.finishS !== null) return -1;
    if (b.finishS !== null) return 1;
    return b.progress.distance - a.progress.distance;
  });
  const player = racers[0]!;

  return {
    shape,
    seed,
    order: ranked.map((racer) => ({
      name: racer.name,
      speedMul: racer.profile.speedMul,
      finishS: racer.finishS,
      laps: racer.director.lapTimesMs.length,
      bestLapS: racer.director.lapTimesMs.length > 0 ? Math.min(...racer.director.lapTimesMs) / 1000 : null,
    })),
    playerPosition: ranked.indexOf(player) + 1,
    playerFinished: player.finishS !== null,
    lapTimesS: player.director.lapTimesMs.map((ms) => ms / 1000),
  };
}

interface ShapeReport {
  shape: TrackShapeId;
  races: number;
  playerFinished: number;
  /** Median of every lap time in the shape's races. */
  medianLapS: number | null;
  fastestLapS: number | null;
  slowestLapS: number | null;
  medianRaceS: number | null;
  /** How often the fastest bot profile beat the slowest one. */
  spreadRaces: number;
  spreadHeld: number;
  /** Player finishing positions, 1-indexed. */
  positions: number[];
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

interface GateResult {
  ok: boolean;
  level: 'hard' | 'soft';
  message: string;
}

function buildReports(options: FamilyOptions): ShapeReport[] {
  const fastestMul = Math.max(...TRACK_TUNING.bots.map((bot) => bot.speedMul));
  const slowestMul = Math.min(...TRACK_TUNING.bots.map((bot) => bot.speedMul));

  return TRACK_SHAPES.map((shape) => {
    const laps: number[] = [];
    const raceTimes: number[] = [];
    const positions: number[] = [];
    let playerFinished = 0;
    let spreadRaces = 0;
    let spreadHeld = 0;

    for (let i = 0; i < options.runs; i += 1) {
      const result = simulateRace(shape, `${options.seed}:${i}`);
      if (result.playerFinished) playerFinished += 1;
      positions.push(result.playerPosition);
      laps.push(...result.lapTimesS);
      const playerEntry = result.order.find((entry) => entry.name === 'player');
      if (playerEntry?.finishS != null) raceTimes.push(playerEntry.finishS);

      // Field spread: the quickest bot profile must actually beat the slowest
      // one. A field that finishes as one block means the speed multipliers do
      // nothing and every race ends in a photo finish.
      const fast = result.order.findIndex((entry) => entry.name !== 'player' && entry.speedMul === fastestMul);
      const slow = result.order.findIndex((entry) => entry.name !== 'player' && entry.speedMul === slowestMul);
      if (fast >= 0 && slow >= 0) {
        spreadRaces += 1;
        if (fast < slow) spreadHeld += 1;
      }
    }

    return {
      shape,
      races: options.runs,
      playerFinished,
      medianLapS: median(laps),
      fastestLapS: laps.length > 0 ? Math.min(...laps) : null,
      slowestLapS: laps.length > 0 ? Math.max(...laps) : null,
      medianRaceS: median(raceTimes),
      spreadRaces,
      spreadHeld,
      positions,
    };
  });
}

function evaluateGates(reports: readonly ShapeReport[], strict: boolean): GateResult[] {
  const gates: GateResult[] = [];

  const unfinished = reports.filter((report) => report.playerFinished < report.races);
  gates.push({
    ok: unfinished.length === 0,
    level: 'hard',
    message:
      unfinished.length === 0
        ? `the player-speed driver finished 3 laps in every race on all ${reports.length} shapes`
        : `shape(s) the player-speed driver could not finish: ${unfinished
            .map((report) => `${report.shape} ${report.playerFinished}/${report.races}`)
            .join(', ')}`,
  });

  const spreadTotal = reports.reduce((sum, report) => sum + report.spreadRaces, 0);
  const spreadHeld = reports.reduce((sum, report) => sum + report.spreadHeld, 0);
  gates.push({
    ok: spreadTotal > 0 && spreadHeld === spreadTotal,
    level: 'hard',
    message: `the fastest bot beat the slowest in ${spreadHeld}/${spreadTotal} races (the field must spread)`,
  });

  const lapOutOfBand = reports.filter(
    (report) => report.medianLapS !== null && (report.medianLapS < LAP_BAND[0] || report.medianLapS > LAP_BAND[1]),
  );
  gates.push({
    ok: lapOutOfBand.length === 0,
    level: 'soft',
    message:
      lapOutOfBand.length === 0
        ? `median lap time inside [${LAP_BAND[0]}, ${LAP_BAND[1]}]s on every shape (${reports
            .map((report) => `${report.shape} ${report.medianLapS?.toFixed(1)}s`)
            .join(', ')})`
        : `shape(s) outside the lap band: ${lapOutOfBand
            .map((report) => `${report.shape}=${report.medianLapS?.toFixed(1)}s`)
            .join(', ')}`,
  });

  // Every shape should be a different race, otherwise the three "variants" are
  // one track with cosmetic differences.
  const medians = reports.map((report) => report.medianLapS).filter((value): value is number => value !== null);
  const shapeSpread = medians.length > 1 ? Math.max(...medians) - Math.min(...medians) : 0;
  gates.push({
    ok: shapeSpread >= 0.5,
    level: 'soft',
    message: `lap-time spread across shapes = ${shapeSpread.toFixed(1)}s (the three shapes should not race identically)`,
  });

  // A winnable but not free grid: the idealised player driver should be able to
  // take the win, and the 1.02x bot should be able to take it back. A field
  // that always loses (or always wins) is a cutscene, not a race.
  const wins = reports.reduce((sum, report) => sum + report.positions.filter((position) => position === 1).length, 0);
  const races = reports.reduce((sum, report) => sum + report.races, 0);
  gates.push({
    ok: wins > 0 && wins < races,
    level: 'soft',
    message: `the player-speed driver won ${wins}/${races} races (the grid must be beatable AND able to beat back)`,
  });

  if (strict) return gates.map((gate) => ({ ...gate, level: 'hard' as const }));
  return gates;
}

function printTable(reports: readonly ShapeReport[]): void {
  console.log('track (family E) — 3 laps, 8 checkpoints, 4-car field');
  console.log('shape   races  finished  medianLap  fastest  slowest  medianRace  spread  playerPos');
  console.log('---------------------------------------------------------------------------------');
  for (const report of reports) {
    const positions = report.positions.reduce<Record<number, number>>((acc, position) => {
      acc[position] = (acc[position] ?? 0) + 1;
      return acc;
    }, {});
    const positionSummary = [1, 2, 3, 4].map((slot) => `P${slot}:${positions[slot] ?? 0}`).join(' ');
    console.log(
      `${report.shape.padEnd(7)}${String(report.races).padStart(5)}  ` +
        `${`${report.playerFinished}/${report.races}`.padStart(8)}  ` +
        `${(report.medianLapS?.toFixed(1) ?? 'n/a').padStart(9)}  ` +
        `${(report.fastestLapS?.toFixed(1) ?? 'n/a').padStart(7)}  ` +
        `${(report.slowestLapS?.toFixed(1) ?? 'n/a').padStart(7)}  ` +
        `${(report.medianRaceS?.toFixed(1) ?? 'n/a').padStart(10)}  ` +
        `${`${report.spreadHeld}/${report.spreadRaces}`.padStart(6)}  ` +
        `${positionSummary}`,
    );
  }
}

/**
 * Family entry point (see `src/sim/cli.ts`): returns the process exit code —
 * 0 when every hard gate passes, 1 otherwise.
 */
export default function runFamilySim(options: FamilyOptions): number {
  const reports = buildReports(options);
  const gates = evaluateGates(reports, options.strict);
  const hardFailures = gates.filter((gate) => gate.level === 'hard' && !gate.ok);
  const softWarnings = gates.filter((gate) => gate.level === 'soft' && !gate.ok);

  if (options.json) {
    console.log(JSON.stringify({ family: 'track', reports, gates }, null, 2));
  } else {
    printTable(reports);
    console.log('');
    for (const gate of gates) {
      const tag = gate.ok ? 'PASS' : gate.level === 'hard' ? 'FAIL' : 'WARN';
      console.log(`[${tag}] ${gate.message}`);
    }
  }

  if (hardFailures.length > 0) {
    console.error(`\n${hardFailures.length} hard gate(s) failed.`);
    return 1;
  }
  if (softWarnings.length > 0 && !options.json) {
    console.error(`\n${softWarnings.length} soft warning(s) (non-fatal; pass --strict to fail on these).`);
  }
  return 0;
}
