import { readdirSync } from 'node:fs';

import { LANES, type LanePolicy } from './bots';
import { SIM_FAMILY } from './family';
import runArenaSim from './families/arena';
import type { FamilySim } from './families/types';

/**
 * Headless balance CLI. `npm run sim -- --family <code> [flags]`.
 *
 * Every family's gates live in `src/sim/families/<code>.ts`, which prints its
 * own report and returns the process exit code; this file only parses flags and
 * dispatches. Duskhaul's own family is `arena` (see `src/sim/family.ts`), whose
 * §8 route lanes take the extra `--lane` flag.
 *
 * The template's generic 480s run model (`src/sim/model.ts` + `metrics.ts`) is
 * GONE, not disabled: it resolved a run by expiring a timer, and Duskhaul has
 * no timer ending — §2A resolves a run only by a gate extraction or death.
 * Keeping it would have left a wrong model one import away from being wired
 * back up.
 */

/** The family whose module also accepts `--lane` (its lanes are the §8 routes). */
const ARENA_FAMILY = 'arena';
const FAMILIES_DIR = new URL('./families/', import.meta.url);
/** Slice/gate names are file stems: keep `--family` from reaching outside the dir. */
const FAMILY_CODE_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Families are DISCOVERED, never listed. `new-game.sh` deletes the families a
 * scaffold does not ship, so a literal list was wrong in both directions:
 * it named modules that are gone, and a game that authors its own family had
 * to be registered here before `--family <code>` would route to it. Now
 * authoring the file is the registration.
 */
function availableFamilies(): string[] {
  const codes: string[] = [];
  try {
    for (const entry of readdirSync(FAMILIES_DIR)) {
      // `types.ts` is the shared gate/report plumbing, not a family.
      if (!entry.endsWith('.ts') || entry === 'types.ts') continue;
      codes.push(entry.slice(0, -'.ts'.length));
    }
  } catch {
    // No families dir at all — nothing to run but the error message.
  }
  return codes.sort();
}

interface CliOptions {
  runs: number;
  seed: string;
  lane: 'all' | LanePolicy;
  json: boolean;
  strict: boolean;
  /** Slice family whose gates run; defaults to the scaffolded `SIM_FAMILY`. */
  family: string;
  /** `--trace <path>`: per-family sims dump their raw session records there. */
  trace?: string;
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
        if (value !== 'all' && !LANES.includes(value as LanePolicy)) {
          throw new Error(`Unknown --lane "${value}". Expected one of: all, ${LANES.join(', ')}`);
        }
        options.lane = value as CliOptions['lane'];
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
      case '--trace':
        options.trace = argv[(i += 1)] ?? options.trace;
        break;
      default:
        throw new Error(`Unknown flag "${arg}"`);
    }
  }
  if (options.lane !== 'all' && options.family !== ARENA_FAMILY) {
    throw new Error(`--lane is an ${ARENA_FAMILY}-family flag; --family "${options.family}" has no lanes.`);
  }
  return options;
}

/**
 * Hands the run to the family's own module, which prints its table and gate
 * lines and returns the exit code. The arena family is imported statically —
 * it is this game's own family and `verify.sh` always runs it — while every
 * other code resolves dynamically, because `new-game.sh` prunes the families a
 * scaffold does not ship and a static import of a deleted module breaks
 * `npm run sim` for the one that remains. Only an unresolvable specifier exits
 * 2; a family that exists but throws while loading rethrows, since that is a
 * bug in that family and swallowing it would hide the stack.
 */
async function runFamily(options: CliOptions): Promise<number> {
  const runs = Number.isFinite(options.runs) && options.runs > 0 ? options.runs : 20;
  const shared = {
    runs,
    seed: options.seed,
    strict: options.strict,
    json: options.json,
    trace: options.trace,
  };
  if (options.family === ARENA_FAMILY) return runArenaSim({ ...shared, lane: options.lane });

  const unavailable = (reason: string): number => {
    console.error(
      `No sim for --family "${options.family}": ${reason}. ` +
        `Available: ${availableFamilies().join(', ')}. ` +
        `Run without --family for this game's own family ("${SIM_FAMILY}").`,
    );
    return 2;
  };
  if (!FAMILY_CODE_RE.test(options.family)) {
    return unavailable('not a family code (lowercase letters, digits, dashes)');
  }

  let sim: FamilySim;
  try {
    const mod = (await import(`./families/${options.family}.ts`)) as { default?: FamilySim };
    if (typeof mod.default !== 'function') {
      return unavailable(`src/sim/families/${options.family}.ts has no default-exported FamilySim`);
    }
    sim = mod.default;
  } catch (error) {
    const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') throw error;
    return unavailable(
      `src/sim/families/${options.family}.ts does not exist (never authored, or pruned at scaffold time)`,
    );
  }
  return await sim(shared);
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  runFamily(options).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}

main();
