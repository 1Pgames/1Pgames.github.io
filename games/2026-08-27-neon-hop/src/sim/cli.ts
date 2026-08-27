import { simulateRun } from './model';
import { LANES, type LanePolicy } from './bots';
import { SIM_FAMILY } from './family';
import type { FamilySim } from './families/types';
import { aggregateLane, medianFirstUpgradeS, type RunMetrics } from './metrics';
import { Rng } from '../core/rng';

/**
 * Headless balance CLI: replays the current template balance data against a
 * bot for every lane at a spread of skill levels, then checks it against a
 * small set of gates the design doc calls non-negotiable (see the header
 * comment in `template/scripts/verify.sh`). Run via `npm run sim`.
 */

/**
 * Family codes `--family` accepts. `arena` is this file's own lane pipeline;
 * every other code is a `src/sim/families/<code>.ts` module, imported
 * DYNAMICALLY so a scaffold that pruned the other families still runs its own.
 */
const ARENA_FAMILY = 'arena';
const FAMILY_CODES: readonly string[] = [
  ARENA_FAMILY,
  'board',
  'hyper',
  'idle',
  'side',
  'table',
  'track',
  'word',
];

interface CliOptions {
  runs: number;
  seed: string;
  lane: 'all' | LanePolicy;
  json: boolean;
  strict: boolean;
  /** Slice family whose gates run; defaults to the scaffolded `SIM_FAMILY`. */
  family: string;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    runs: 20,
    seed: 'balance',
    lane: 'all',
    json: false,
    strict: false,
    family: SIM_FAMILY,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--runs':
        options.runs = Number(argv[(i += 1)] ?? options.runs);
        break;
      case '--seed':
        options.seed = argv[(i += 1)] ?? options.seed;
        break;
      case '--lane': {
        const value = argv[(i += 1)] ?? 'all';
        if (value === 'all' || LANES.includes(value as LanePolicy)) options.lane = value as CliOptions['lane'];
        else throw new Error(`Unknown --lane "${value}". Expected one of: all, ${LANES.join(', ')}`);
        break;
      }
      case '--family':
        options.family = argv[(i += 1)] ?? options.family;
        break;
      case '--json':
        options.json = true;
        break;
      case '--strict':
        options.strict = true;
        break;
      default:
        throw new Error(`Unknown flag "${arg}"`);
    }
  }
  return options;
}

/** Skill spread the gates are evaluated against — a novice, a median, and an expert player. */
const SKILL_LEVELS: readonly number[] = [0.1, 0.5, 0.9];

function runBatch(options: CliOptions): RunMetrics[] {
  const lanes = options.lane === 'all' ? LANES : [options.lane];
  const results: RunMetrics[] = [];
  const seeder = new Rng(`${options.seed}:dispatch`);
  for (const lane of lanes) {
    for (const skill of SKILL_LEVELS) {
      for (let i = 0; i < options.runs; i += 1) {
        // Each (lane, skill, index) gets its own deterministic child seed —
        // stable across repeats of the same --seed, distinct across lanes/skills
        // so lanes don't all replay the identical enemy-spawn coin flips.
        const runSeed = `${options.seed}:${lane}:${skill}:${i}:${seeder.int(0, 0x7fffffff)}`;
        results.push(simulateRun({ seed: runSeed, lane, skill }));
      }
    }
  }
  return results;
}

interface GateResult {
  ok: boolean;
  level: 'hard' | 'soft';
  message: string;
}

/**
 * Hard gates fail the run (exit 1); soft gates only warn unless `--strict`.
 * Gates read the ALREADY-COLLECTED results — they never re-tune `TUNING` to
 * force a pass. A failing hard gate here is the template balance itself
 * being broken, not a sim bug to paper over.
 */
function evaluateGates(results: readonly RunMetrics[], strict: boolean): GateResult[] {
  const gates: GateResult[] = [];

  // Winnability = an expert with SOME coherent build can win (§5.5 asks each
  // build lane's winrate, not that an unfocused draft wins): best lane at 0.9.
  const expertRuns = results.filter((r) => r.skill === 0.9);
  const expertWinsByLane = LANES.map((lane) => {
    const runs = expertRuns.filter((r) => r.lane === lane);
    return { lane, runs: runs.length, wins: runs.filter((r) => r.survived).length };
  }).filter((entry) => entry.runs > 0);
  const bestLane = expertWinsByLane.reduce(
    (best, entry) => (entry.wins > best.wins ? entry : best),
    { lane: 'none', runs: 0, wins: 0 },
  );
  gates.push({
    ok: expertWinsByLane.length === 0 || bestLane.wins > 0,
    level: 'hard',
    message: `best lane at skill 0.9: '${bestLane.lane}' won ${bestLane.wins}/${bestLane.runs} runs (unwinnable if no lane wins)`,
  });

  const novice = results.filter((r) => r.lane === 'balanced' && r.skill === 0.1);
  const noviceWins = novice.filter((r) => r.survived).length;
  gates.push({
    ok: novice.length === 0 || noviceWins < novice.length,
    level: 'hard',
    message: `'balanced' lane at skill 0.1 won ${noviceWins}/${novice.length} runs (un-losable if all)`,
  });

  const firstUpgradeMedian = medianFirstUpgradeS(results);
  gates.push({
    ok: firstUpgradeMedian === null || (firstUpgradeMedian >= 20 && firstUpgradeMedian <= 90),
    level: 'hard',
    message: `median firstUpgradeS = ${firstUpgradeMedian?.toFixed(1) ?? 'n/a'} (must be within [20, 90])`,
  });

  const midSkillRuns = results.filter((r) => r.skill === 0.5);
  const laneWinrates = LANES.map((lane) => aggregateLane(lane, midSkillRuns).winrate).filter(
    (_, index) => midSkillRuns.some((r) => r.lane === LANES[index]),
  );
  const dominance = laneWinrates.length > 0 ? Math.max(...laneWinrates) - Math.min(...laneWinrates) : 0;
  gates.push({
    ok: dominance <= 0.35,
    level: 'soft',
    message: `lane winrate spread at skill 0.5 = ${dominance.toFixed(2)} (dominance warning above 0.35)`,
  });

  // Full-run cadence (10-14 choices/480s) is only measurable on survived
  // runs; the first-120s window is the pacing signal that survives early
  // deaths: design lands the first draft ~45s and 3-4 total by 2:00.
  const paceWindows = LANES.map((lane) => aggregateLane(lane, midSkillRuns).choicesBy120S).filter(
    (_, index) => midSkillRuns.some((r) => r.lane === LANES[index]),
  );
  const paceOk = paceWindows.every((c) => c >= 2 && c <= 5);
  gates.push({
    ok: paceOk,
    level: 'soft',
    message: `choice events in the first 120s at skill 0.5 = [${paceWindows.map((c) => c.toFixed(1)).join(', ')}] (target 2-5)`,
  });

  const survivors = results.filter((r) => r.survived && r.skill === 0.5);
  if (survivors.length > 0) {
    const perRun = survivors.reduce((sum, r) => sum + r.choiceEvents, 0) / survivors.length;
    gates.push({
      ok: perRun >= 10 && perRun <= 18,
      level: 'soft',
      message: `choice events per survived mid-skill run = ${perRun.toFixed(1)} (target 10-18)`,
    });
  }

  const everDroppedBelow30 = results.some((r) => r.hpMinPct < 0.3);
  gates.push({
    ok: everDroppedBelow30,
    level: 'soft',
    message: everDroppedBelow30
      ? 'hpMinPct dropped below 30% in at least one run (tension present)'
      : 'hpMinPct never dropped below 30% across any run (no tension warning)',
  });

  if (strict) return gates.map((gate) => ({ ...gate, level: 'hard' as const }));
  return gates;
}

function printTable(results: readonly RunMetrics[]): void {
  const lanes = [...new Set(results.map((r) => r.lane))];
  const skills = [...new Set(results.map((r) => r.skill))].sort((a, b) => a - b);
  console.log('lane         skill  runs  winrate  medianDeathS  choices/480s');
  console.log('--------------------------------------------------------------');
  for (const lane of lanes) {
    for (const skill of skills) {
      const subset = results.filter((r) => r.lane === lane && r.skill === skill);
      if (subset.length === 0) continue;
      const agg = aggregateLane(lane, subset);
      console.log(
        `${lane.padEnd(12)} ${skill.toFixed(1).padStart(5)}  ${String(agg.runs).padStart(4)}  ` +
          `${agg.winrate.toFixed(2).padStart(7)}  ${(agg.medianDeathS?.toFixed(1) ?? 'n/a').padStart(12)}  ` +
          `${agg.cadencePer480.toFixed(1).padStart(12)}`,
      );
    }
  }
}

/**
 * Hands the run to `src/sim/families/<code>.ts`, which prints its own table
 * and gate lines and returns the exit code. Both failure modes (a code this
 * build never had, and a code whose module the scaffold pruned) exit 2 with
 * the list of families that ARE available.
 */
async function runFamily(options: CliOptions): Promise<number> {
  if (!FAMILY_CODES.includes(options.family)) {
    console.error(`Unknown --family "${options.family}". Expected one of: ${FAMILY_CODES.join(', ')}`);
    return 2;
  }
  let sim: FamilySim;
  try {
    // Runtime-selected specifier, and deliberately not static: `new-game.sh`
    // deletes the families a scaffold does not ship, and a static import of
    // all six would then break `npm run sim` for the one family that remains.
    const mod = (await import(`./families/${options.family}.ts`)) as { default: FamilySim };
    sim = mod.default;
  } catch {
    console.error(
      `Family "${options.family}" is not part of this scaffold: ` +
        `src/sim/families/${options.family}.ts is missing (pruned at scaffold time). ` +
        `Run without --family for this game's own family ("${SIM_FAMILY}").`,
    );
    return 2;
  }
  return await sim({
    // `--runs banana` parses to NaN; a family sim would then silently measure
    // nothing, so the default is restored here.
    runs: Number.isFinite(options.runs) ? options.runs : 20,
    seed: options.seed,
    strict: options.strict,
    json: options.json,
  });
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options.family !== ARENA_FAMILY) {
    // Kept off the arena path entirely: that flow stays synchronous, so its
    // output and its `--lane`/flag error behaviour are unchanged.
    runFamily(options).then(
      (code) => process.exit(code),
      (error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      },
    );
    return;
  }
  const results = runBatch(options);
  const gates = evaluateGates(results, options.strict);
  const hardFailures = gates.filter((gate) => gate.level === 'hard' && !gate.ok);
  const softWarnings = gates.filter((gate) => gate.level === 'soft' && !gate.ok);

  if (options.json) {
    console.log(JSON.stringify({ results, gates }, null, 2));
  } else {
    printTable(results);
    console.log('');
    for (const gate of gates) {
      const tag = gate.ok ? 'PASS' : gate.level === 'hard' ? 'FAIL' : 'WARN';
      console.log(`[${tag}] ${gate.message}`);
    }
  }

  if (hardFailures.length > 0) {
    console.error(`\n${hardFailures.length} hard gate(s) failed.`);
    process.exit(1);
  }
  if (softWarnings.length > 0 && !options.json) {
    console.error(`\n${softWarnings.length} soft warning(s) (non-fatal; pass --strict to fail on these).`);
  }
}

main();
