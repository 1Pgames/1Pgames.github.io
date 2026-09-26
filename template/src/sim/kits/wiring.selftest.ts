// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/wiring.selftest.ts
//
// Connectedness gate: every payload declared in `src/sim/wiring.ts` — results
// fields, pause actions, paid meta perks/boosters of every family slice
// present, paid player stats, plus whatever the game appends (its run-loadout
// fields, meta-node ids, mutator params, paid TUNING subtrees) — has a reader in
// RUN code: `src/` minus `sim/**`, minus `*.selftest.ts`, minus the payload's
// producers, comments stripped. Presence was checked everywhere and
// connectedness nowhere: a paid "start at level 2" was folded into the loadout
// and read by nothing, and it typechecked and passed every sim.
//
// Every finding of every payload is reported before the assert, and the
// scanner proves it can fail (a probe id no code spells must come back dead).
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wiringPayloads, type FieldsPayload, type IdsPayload, type TuningPayload, type WiringPayload } from '../wiring';

const SRC = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Source with comments blanked, offsets preserved. A doc comment naming
 * `loadout.startLevel` is exactly how a dead field would look read. With
 * `blankStrings`, '…' and "…" contents are blanked too, so a member read only
 * counts in code; template literals are kept whole (their `${…}` is code).
 */
function stripComments(text: string, blankStrings: boolean): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i += 1; }
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (c === "'" || c === '"' || c === '`') {
      // A quote inside a regex literal would open a phantom string; stopping a
      // '…'/"…" string at the line end bounds the damage to one line.
      let j = i + 1;
      while (j < text.length && text[j] !== c && (c === '`' || text[j] !== '\n')) j += text[j] === '\\' ? 2 : 1;
      const literal = text.slice(i, j + 1);
      out += blankStrings && c !== '`' && literal.length >= 2
        ? c + ' '.repeat(literal.length - 2) + literal[literal.length - 1]!
        : literal;
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** `code`: comments stripped (string literals kept, for id spellings); `bare`: string contents blanked too. */
interface RunFile { rel: string; code: string; bare: string }

function collectRunFiles(dir: string, out: RunFile[]): RunFile[] {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const rel = relative(SRC, path).split('\\').join('/');
    if (statSync(path).isDirectory()) {
      if (rel !== 'sim') collectRunFiles(path, out);
    } else if (rel.endsWith('.ts') && !rel.endsWith('.selftest.ts') && !rel.endsWith('.d.ts')) {
      const text = readFileSync(path, 'utf8');
      out.push({ rel, code: stripComments(text, false), bare: stripComments(text, true) });
    }
  }
  return out;
}

const RUN = collectRunFiles(SRC, []);
const underAny = (rel: string, paths: readonly string[]): boolean =>
  paths.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p));

function scopeOf(payload: WiringPayload): RunFile[] {
  return RUN.filter((f) =>
    (payload.readers === undefined || underAny(f.rel, payload.readers))
    && !underAny(f.rel, payload.producers ?? []));
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Top-level and one-level-nested field names of `interface T {…}` / `type T = {…}`. */
function parseFields(payload: FieldsPayload): { top: string[]; nested: [string, string][] } {
  const path = join(SRC, payload.file);
  assert.ok(existsSync(path), `${payload.label}: ${payload.file} does not exist`);
  const code = stripComments(readFileSync(path, 'utf8'), true);
  const head = new RegExp(`(?:interface\\s+${esc(payload.type)}\\b[^{]*|type\\s+${esc(payload.type)}\\s*=\\s*)\\{`).exec(code);
  assert.ok(head !== null, `${payload.label}: no \`interface ${payload.type} {\` or \`type ${payload.type} = {\` in ${payload.file}`);
  // The body, balanced — an inline object type nests braces.
  const open = head.index + head[0].length - 1;
  let depth = 0;
  let close = open;
  for (; close < code.length; close += 1) {
    if (code[close] === '{') depth += 1;
    else if (code[close] === '}' && --depth === 0) break;
  }
  const body = code.slice(open + 1, close);
  const names = (s: string): string[] => [...s.matchAll(/(?:^|[;,\n])\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:/g)].map((m) => m[1]!);
  // Collapse every inline object type so `belt: ({ id; charges } | null)[]` yields `belt` only.
  let flat = body;
  for (let prev = ''; prev !== flat;) { prev = flat; flat = flat.replace(/\{[^{}]*\}/g, '{}'); }
  const nested: [string, string][] = [];
  for (const m of body.matchAll(/(?:^|[;,\n])\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:\s*\{([^{}]*)\}/g)) {
    for (const child of names(m[2]!)) nested.push([m[1]!, child]);
  }
  return { top: names(flat), nested };
}

interface Verdict { names: string[]; dead: string[] }

function checkFields(payload: FieldsPayload): Verdict {
  const files = scopeOf(payload);
  const { top, nested } = parseFields(payload);
  assert.ok(top.length > 0, `${payload.label}: parsed no fields out of ${payload.type}`);
  const recv = payload.receivers.map(esc).join('|');
  const dead: string[] = [];
  for (const field of top) {
    const dotted = new RegExp(`\\b(?:${recv})\\??\\.${esc(field)}\\b`);
    const destructured = new RegExp(`\\{[^{}]*\\b${esc(field)}\\b[^{}]*\\}\\s*=\\s*(?:this\\.)?(?:${recv})\\b`);
    if (!files.some((f) => dotted.test(f.bare) || destructured.test(f.bare))) dead.push(field);
  }
  for (const [parent, child] of nested) {
    const holders = files.filter((f) => new RegExp(`\\b${esc(parent)}\\b`).test(f.bare));
    const read = new RegExp(`\\??\\.${esc(child)}\\b|\\{[^{}]*\\b${esc(child)}\\b[^{}]*\\}\\s*=`);
    if (!holders.some((f) => read.test(f.bare))) dead.push(`${parent}.${child}`);
  }
  return { names: [...top, ...nested.map(([parent, child]) => `${parent}.${child}`)], dead };
}

function checkIds(payload: IdsPayload): Verdict {
  const files = scopeOf(payload);
  const pattern = payload.reader ?? ((id: string) => new RegExp(`(['"\`])${esc(id)}\\1`));
  return { names: [...payload.ids], dead: payload.ids.filter((id) => !files.some((f) => pattern(id).test(f.code))) };
}

function leavesOf(value: unknown, prefix: string, out: string[]): string[] {
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value)) leavesOf(child, prefix === '' ? key : `${prefix}.${key}`, out);
  } else {
    out.push(prefix);
  }
  return out;
}

function checkTuning(payload: TuningPayload): Verdict {
  const reads = new Set<string>();
  const rootName = payload.root ?? 'TUNING';
  const root = esc(rootName);
  const dotted = new RegExp(`\\b${root}((?:\\??\\.[A-Za-z_$][\\w$]*)+)`, 'g');
  const destructured = new RegExp(`\\{([^{}]*)\\}\\s*=\\s*${root}((?:\\??\\.[A-Za-z_$][\\w$]*)*)`, 'g');
  for (const f of scopeOf(payload)) {
    for (const m of f.bare.matchAll(dotted)) reads.add(m[1]!.replace(/\?/g, '').slice(1));
    for (const m of f.bare.matchAll(destructured)) {
      const base = m[2]!.replace(/\?/g, '').replace(/^\./, '');
      for (const part of m[1]!.split(',')) {
        const key = part.trim().split(':')[0]!.trim();
        if (/^[A-Za-z_$][\w$]*$/.test(key)) reads.add(base === '' ? key : `${base}.${key}`);
      }
    }
  }
  const leaves = leavesOf(payload.tree, payload.path, []);
  assert.ok(leaves.length > 0 && leaves[0] !== '', `${payload.label}: ${rootName}.${payload.path} has no leaves`);
  // Read = the leaf itself, an ancestor handed on whole (`const w = TUNING.weapons`),
  // or a descendant of a leaf that is an object/array.
  const dead = leaves.filter((leaf) => {
    const parts = leaf.split('.');
    for (let i = 1; i <= parts.length; i += 1) if (reads.has(parts.slice(0, i).join('.'))) return false;
    for (const read of reads) if (read.startsWith(`${leaf}.`)) return false;
    return true;
  });
  return { names: leaves, dead };
}

// ── the scanner itself must be able to fail ──
assert.equal(
  stripComments("a // 'x'\n/* 'y' */ b.c('z // no') `w.v`", true),
  "a       \n          b.c('       ') `w.v`",
  'comments blanked, string contents blanked, template literals and offsets kept',
);
assert.deepEqual(
  checkIds({ kind: 'ids', label: 'probe', ids: ['__wiring_probe_never_read__'] }).dead,
  ['__wiring_probe_never_read__'],
  'an id no run code spells must come back dead',
);

// ── the manifest ──
const families = existsSync(join(SRC, 'slices'))
  ? readdirSync(join(SRC, 'slices')).filter((name) => statSync(join(SRC, 'slices', name)).isDirectory()).sort()
  : [];
const payloads = wiringPayloads(families);
const failures: string[] = [];
let checked = 0;
for (const payload of payloads) {
  const scopeLabel = JSON.stringify(payload.readers ?? 'src/');
  if (scopeOf(payload).length === 0) {
    failures.push(`${payload.label}: no run file in reader scope ${scopeLabel}`);
    continue;
  }
  const verdict = payload.kind === 'fields' ? checkFields(payload) : payload.kind === 'ids' ? checkIds(payload) : checkTuning(payload);
  for (const [name, why] of Object.entries(payload.exempt ?? {})) {
    assert.ok(why.trim().length > 0, `${payload.label}: exemption for ${name} needs a reason`);
    assert.ok(verdict.names.includes(name), `${payload.label}: exemption for ${name}, which the payload does not declare`);
    console.log(`  exempt ${payload.label}: ${name} — ${why}`);
  }
  const dead = verdict.dead.filter((name) => payload.exempt?.[name] === undefined);
  checked += verdict.names.length;
  console.log(`  ${dead.length === 0 ? 'ok  ' : 'DEAD'} ${payload.label}: ${verdict.names.length - dead.length}/${verdict.names.length} read`);
  for (const name of dead) failures.push(`${payload.label}: \`${name}\` has no reader in run code ${scopeLabel}`);
}
assert.deepEqual(failures, [], `payloads nothing in the game reads:\n  ${failures.join('\n  ')}`);
console.log(`wiring selftest OK — ${payloads.length} payloads, ${checked} names, families: ${families.join(', ') || '(none)'}`);
