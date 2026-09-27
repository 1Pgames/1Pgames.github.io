import { readdirSync } from 'node:fs';

import { SIM_FAMILY } from './family';
import type { FamilySim } from './families/types';

/**
 * Headless balance CLI (`npm run sim`): hands the run to
 * `src/sim/families/<code>.ts`, which plays its seeded sessions on the real
 * model, prints its table and gate lines, and returns the exit code.
 *
 * Family codes are DISCOVERED from the families dir, never listed: authoring
 * `src/sim/families/<code>.ts` is the registration. This game ships only
 * `colony` (the template's arena lane pipeline was removed with the arena
 * modules), and `SIM_FAMILY` makes it the default.
 */
const FAMILIES_DIR = new URL('./families/', import.meta.url);
/** Slice/gate names are file stems: keep `--family` from reaching outside the dir. */
const FAMILY_CODE_RE = /^[a-z][a-z0-9-]*$/;

function availableFamilies(): string[] {
  const codes: string[] = [];
  try {
    for (const entry of readdirSync(FAMILIES_DIR)) {
      // `types.ts` is the shared gate/report plumbing, not a family.
      if (!entry.endsWith('.ts') || entry === 'types.ts') continue;
      codes.push(entry.slice(0, -'.ts'.length));
    }
  } catch {
    // No families dir at all.
  }
  return codes.sort();
}

interface CliOptions {
  runs: number;
  seed: string;
  json: boolean;
  strict: boolean;
  /** Slice family whose gates run; defaults to the scaffolded `SIM_FAMILY`. */
  family: string;
  /** `--trace <path>`: the family sim dumps its raw session records there. */
  trace?: string;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { runs: 20, seed: 'balance', json: false, strict: false, family: SIM_FAMILY };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--runs':
        options.runs = Number(argv[(i += 1)] ?? options.runs);
        break;
      case '--seed':
        options.seed = argv[(i += 1)] ?? options.seed;
        break;
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
  return options;
}

/**
 * Loads the family module and runs it. Only a specifier that does not resolve
 * exits 2 (naming the families the dir holds); a family file that throws while
 * loading rethrows — that is a bug in that family, not a missing one.
 */
async function runFamily(options: CliOptions): Promise<number> {
  const unavailable = (reason: string): number => {
    console.error(`No sim for --family "${options.family}": ${reason}. Available: ${availableFamilies().join(', ')}.`);
    return 2;
  };
  if (!FAMILY_CODE_RE.test(options.family)) return unavailable('not a family code (lowercase letters, digits, dashes)');

  let sim: FamilySim;
  try {
    // Runtime-selected specifier (`--family`), so no static import can name it.
    const mod = (await import(`./families/${options.family}.ts`)) as { default?: FamilySim };
    if (typeof mod.default !== 'function') return unavailable(`src/sim/families/${options.family}.ts has no default-exported FamilySim`);
    sim = mod.default;
  } catch (error) {
    const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') throw error;
    return unavailable(`src/sim/families/${options.family}.ts does not exist`);
  }
  return await sim({
    // `--runs banana` parses to NaN; a family sim would then silently measure nothing.
    runs: Number.isFinite(options.runs) ? options.runs : 20,
    seed: options.seed,
    strict: options.strict,
    json: options.json,
    trace: options.trace,
  });
}

runFamily(parseArgs(process.argv.slice(2))).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
