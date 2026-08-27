/**
 * Shared plumbing for the per-family balance sims (`npm run sim -- --family <code>`).
 *
 * A family module is a single default-exported function that plays its slice
 * headlessly, prints one table plus its `[PASS]/[FAIL]/[WARN]` gate lines and
 * returns the process exit code. Everything those modules have in common —
 * the gate record, the exit-code/report protocol and a few order statistics —
 * lives here so each family file is only its own model and its own gates.
 *
 * Pure TypeScript, no Phaser import, no `Math.random`.
 */

/** Same shape as the arena CLI's gate record: hard fails the run, soft warns. */
export interface GateResult {
  ok: boolean;
  level: 'hard' | 'soft';
  message: string;
}

/** Options every family sim receives from `src/sim/cli.ts`. */
export interface FamilySimOptions {
  runs: number;
  seed: string;
  strict: boolean;
  json: boolean;
}

/** The contract `--family <code>` dispatches to. */
export type FamilySim = (options: FamilySimOptions) => Promise<number> | number;

export function hard(ok: boolean, message: string): GateResult {
  return { ok, level: 'hard', message };
}

export function soft(ok: boolean, message: string): GateResult {
  return { ok, level: 'soft', message };
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/**
 * Linear-interpolated percentile (`p` in 0..1) of an unsorted sample.
 * `NaN` for an empty sample — every gate that reads one checks the count first.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const lowValue = sorted[low] as number;
  if (low === high) return lowValue;
  return lowValue + ((sorted[high] as number) - lowValue) * (rank - low);
}

export function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

/** `NaN`-safe fixed-width number for a table cell. */
export function num(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

export function pct(ratio: number, digits = 0): string {
  return Number.isFinite(ratio) ? `${(ratio * 100).toFixed(digits)}%` : 'n/a';
}

/**
 * Minimal fixed-width table: first column left-aligned (the row label), the
 * rest right-aligned (the numbers), separated by two spaces.
 */
export function printTable(headers: readonly string[], rows: readonly (readonly string[])[]): void {
  const widths = headers.map((header, column) =>
    rows.reduce((width, row) => Math.max(width, (row[column] ?? '').length), header.length),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, column) =>
        column === 0 ? cell.padEnd(widths[column] as number) : cell.padStart(widths[column] as number),
      )
      .join('  ')
      .trimEnd();
  console.log(line(headers));
  console.log('-'.repeat(widths.reduce((sum, width) => sum + width + 2, 0) - 2));
  for (const row of rows) console.log(line(row));
}

/**
 * Prints the family report and returns the exit code, using the same protocol
 * as the arena CLI: `--strict` promotes every soft gate to hard, hard failures
 * exit 1, soft warnings only print a note.
 */
export function finishFamily(
  options: FamilySimOptions,
  gates: readonly GateResult[],
  render: () => void,
  payload: Record<string, unknown>,
): number {
  const resolved = options.strict ? gates.map((gate) => ({ ...gate, level: 'hard' as const })) : gates;

  if (options.json) {
    console.log(JSON.stringify({ ...payload, gates: resolved }, null, 2));
  } else {
    render();
    console.log('');
    for (const gate of resolved) {
      const tag = gate.ok ? 'PASS' : gate.level === 'hard' ? 'FAIL' : 'WARN';
      console.log(`[${tag}] ${gate.message}`);
    }
  }

  const hardFailures = resolved.filter((gate) => gate.level === 'hard' && !gate.ok);
  const softWarnings = resolved.filter((gate) => gate.level === 'soft' && !gate.ok);
  if (hardFailures.length > 0) {
    console.error(`\n${hardFailures.length} hard gate(s) failed.`);
    return 1;
  }
  if (softWarnings.length > 0 && !options.json) {
    console.error(`\n${softWarnings.length} soft warning(s) (non-fatal; pass --strict to fail on these).`);
  }
  return 0;
}
