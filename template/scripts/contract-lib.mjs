/**
 * Shared static-analysis primitives for the two structural verify stages
 * (`w1-contract-check.mjs`, `consumer-edge-check.mjs`).
 *
 * Both stages exist because `tsc` is blind to the two failure modes that cost
 * this pipeline the most time:
 *
 *  1. a *reader* names a content/TUNING path the data never defines — the file
 *     typechecks, the run throws (or silently no-ops) at start;
 *  2. a *producer* is built perfectly and connected to nothing — an unimported
 *     module typechecks flawlessly forever.
 *
 * Everything here is DERIVED from the tree. The predecessor of these scripts
 * carried a hand-maintained list of 99 TUNING paths, and that list asserted
 * `elite.gateGuardAdds` — a key no line of the game ever read. A hand list is
 * itself content that rots, and it rotted into asserting a fiction, which is
 * the exact failure class the check exists to catch. So: no path lists, no
 * symbol lists, no allowlists. Scan the source, load the data, compare.
 *
 * Nothing in this file imports Phaser, and nothing it dynamically imports may
 * either (see `loadDataModules`) — the stages run in plain Node via
 * `node --import ./scripts/ts-resolve.mjs`.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Repo root of the game (the directory holding `package.json`/`src/`).
 *
 * Defaults to the parent of this script, which is what every scaffolded game
 * gets. `--root <dir>` / `CONTRACT_ROOT` point the same analysis at another
 * checkout, which is how the template's own copy is regression-tested against
 * a shipped game without editing that game.
 */
function detectRoot() {
  const flag = process.argv.indexOf('--root');
  if (flag !== -1 && process.argv[flag + 1] !== undefined) return resolvePath(process.argv[flag + 1]);
  if (process.env.CONTRACT_ROOT !== undefined) return resolvePath(process.env.CONTRACT_ROOT);
  return resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
}
export const ROOT = detectRoot();
export const SRC = join(ROOT, 'src');

/** A selftest is a consumer that does not count as a consumer: see `consumer-edge-check.mjs`. */
export const isSelftest = (rel) => rel.endsWith('.selftest.ts');

/* ------------------------------------------------------------------ files -- */

/** Every `.ts`/`.tsx` file under `src/`, as repo-relative POSIX paths. */
export function listSourceFiles(dir = SRC) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(abs));
    else if (/\.tsx?$/.test(entry.name)) out.push(relative(ROOT, abs));
  }
  return out;
}

const fileCache = new Map();
/** File text with comments blanked out (line/col positions preserved). */
export function sourceOf(rel) {
  let cached = fileCache.get(rel);
  if (cached === undefined) {
    const raw = readFileSync(join(ROOT, rel), 'utf8');
    cached = { raw, code: stripComments(raw) };
    fileCache.set(rel, cached);
  }
  return cached;
}

/**
 * Replace comment bodies with spaces, preserving every newline and offset.
 *
 * This is load-bearing, not cosmetic: these files carry long design comments
 * that quote TUNING paths and symbol names in prose. Scanning raw text would
 * invent readers for keys nothing reads (making the dead-content check inert)
 * and invent importers for symbols nothing imports.
 *
 * Strings, template literals and regex literals are walked so a `//` inside
 * `'https://…'` or a `/[/]/` character class does not swallow real code.
 */
export function stripComments(text) {
  const out = Array.from(text);
  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  let prevSignificant = '';
  while (i < text.length) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      const end = text.indexOf('\n', i);
      blank(i, end === -1 ? text.length : end);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      i = skipQuoted(text, i, c);
      prevSignificant = c;
      continue;
    }
    // A `/` in an expression position starts a regex literal; after a value it
    // is division. `prevSignificant` is the last non-whitespace code char.
    if (c === '/' && (prevSignificant === '' || '([{=,:;!&|?+-*%~^<>'.includes(prevSignificant))) {
      i = skipRegex(text, i);
      prevSignificant = '/';
      continue;
    }
    if (!/\s/.test(c)) prevSignificant = c;
    i += 1;
  }
  return out.join('');
}

function skipQuoted(text, start, quote) {
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (c === quote) return i + 1;
    if (quote !== '`' && c === '\n') return i + 1; // unterminated: bail on the line
    if (quote === '`' && c === '$' && text[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}') depth -= 1;
        else if (text[i] === '"' || text[i] === "'" || text[i] === '`') { i = skipQuoted(text, i, text[i]); continue; }
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return i;
}

function skipRegex(text, start) {
  let i = start + 1;
  let inClass = false;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '\n') return i; // not a regex after all
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return i + 1;
    i += 1;
  }
  return i;
}

/* -------------------------------------------------------------- modules --- */

/**
 * Import/export shape of one module, from text. Deliberately regex-level: the
 * template ships no parser dependency, and `import`/`export` statement syntax
 * is the one part of TS that is reliably line-shaped.
 */
export function parseModule(rel) {
  const { code } = sourceOf(rel);
  const imports = [];
  const exports = [];

  const importRe = /(?:^|\n)\s*import\s+(type\s+)?([\s\S]*?)\s*from\s*'([^']+)'/g;
  for (let m = importRe.exec(code); m !== null; m = importRe.exec(code)) {
    const clause = m[2];
    const spec = m[3];
    const entry = { spec, typeOnly: m[1] !== undefined, named: [], namespace: false, default: false };
    const braces = clause.match(/\{([\s\S]*)\}/);
    if (braces !== null) {
      for (const part of braces[1].split(',')) {
        const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
        if (name.length > 0) entry.named.push(name);
      }
    }
    if (/\*\s+as\s+\w+/.test(clause)) entry.namespace = true;
    const bare = clause.replace(/\{[\s\S]*\}/, '').replace(/\*\s+as\s+\w+/, '').replace(/,/g, '').trim();
    if (bare.length > 0) entry.default = true;
    imports.push(entry);
  }
  // Side-effect imports (`import './x'`) still create a module edge.
  const bareRe = /(?:^|\n)\s*import\s*'([^']+)'/g;
  for (let m = bareRe.exec(code); m !== null; m = bareRe.exec(code)) {
    imports.push({ spec: m[1], typeOnly: false, named: [], namespace: false, default: false });
  }

  // `export { a, b } from './x'` / `export * from './x'` re-export edges.
  const reExportRe = /(?:^|\n)\s*export\s+(?:(\*)|\{([\s\S]*?)\})\s*from\s*'([^']+)'/g;
  for (let m = reExportRe.exec(code); m !== null; m = reExportRe.exec(code)) {
    const named = m[2] === undefined
      ? []
      : m[2].split(',').map((p) => p.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()).filter((s) => s.length > 0);
    imports.push({ spec: m[3], typeOnly: false, named, namespace: m[1] !== undefined, default: false, reExport: true });
    for (const name of named) exports.push({ name, kind: 're-export', line: lineOf(code, m.index) });
  }

  const declRe = /(?:^|\n)export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(const|let|var|function|class|interface|type|enum)\s+\*?\s*(\w+)/g;
  for (let m = declRe.exec(code); m !== null; m = declRe.exec(code)) {
    exports.push({ name: m[2], kind: m[1], line: lineOf(code, m.index) });
  }
  // `export { a, b }` (local re-export of same-file symbols) — not a new symbol.
  return { rel, imports, exports };
}

function lineOf(code, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (code[i] === '\n') line += 1;
  return line;
}

/** Resolve a relative specifier from `fromRel` to a repo-relative source path. */
export function resolveSpec(fromRel, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolvePath(join(ROOT, dirname(fromRel)), spec);
  for (const candidate of ['', '.ts', '.tsx', '/index.ts', '.mjs', '.js']) {
    const abs = base + candidate;
    if (existsSync(abs) && statSync(abs).isFile()) return relative(ROOT, abs);
  }
  return null;
}

/* ------------------------------------------------------------ data load --- */

/**
 * Dynamically import every Phaser-free module that could hold content or
 * numbers, so the checks compare against the values the game actually ships
 * rather than against a transcription of them.
 *
 * A module that imports Phaser at runtime cannot load in plain Node; those are
 * skipped BY NAME in the report, never silently — a silent skip is how a gate
 * turns green by measuring nothing.
 */
export async function loadDataModules() {
  const candidates = listSourceFiles().filter((rel) => (
    rel === 'src/config.ts'
    || rel.startsWith('src/data/')
    || rel.startsWith('src/core/')
    || /^src\/slices\/[^/]+\/(tuning|levels|content|packs|gen|math|board|stack)\.ts$/.test(rel)
  ));
  const loaded = new Map();
  const skipped = [];
  const failed = [];
  for (const rel of candidates) {
    const { code } = sourceOf(rel);
    if (/(?:^|\n)\s*import\s+(?!type\b)[^;]*from\s*'phaser'/.test(code)) {
      skipped.push(rel);
      continue;
    }
    try {
      loaded.set(rel, await import(pathToFileURL(join(ROOT, rel)).href));
    } catch (err) {
      failed.push({ rel, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { loaded, skipped, failed };
}

/* ----------------------------------------------------------- tuning ------- */

/**
 * The tuning roots a game exposes: `TUNING` from `src/config.ts` plus every
 * `*_TUNING` export (the per-family slice tuning tables). Discovered, not
 * listed, so a new family's table is gated the day it is added.
 */
export function tuningRoots(loaded) {
  const roots = [];
  for (const [rel, mod] of loaded) {
    for (const [name, value] of Object.entries(mod)) {
      if (name !== 'TUNING' && !name.endsWith('_TUNING')) continue;
      if (value === null || typeof value !== 'object') continue;
      roots.push({ rel, name, value });
    }
  }
  return roots;
}

/** Every leaf path in a tuning object. Arrays and primitives are leaves. */
export function tuningLeaves(value, prefix = '', out = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    if (prefix !== '') out.push(prefix);
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    tuningLeaves(child, prefix === '' ? key : `${prefix}.${key}`, out);
  }
  return out;
}

/** Resolve a dotted path against an object; `undefined` when absent. */
export function readPath(root, path) {
  let node = root;
  for (const key of path.split('.')) {
    if (node === null || node === undefined) return undefined;
    node = node[key];
  }
  return node;
}

/**
 * Every dotted access of a tuning root in `src/`, e.g. `TUNING.collapse.atS`
 * → `{ path: 'collapse.atS', sites: ['src/systems/zone.ts:311', …] }`.
 *
 * Also records aliasing reads that do not spell the whole path:
 *  - `const { collapse } = TUNING`              → path `collapse`
 *  - `const { radiusX } = TABLE_TUNING.ring`    → path `ring.radiusX`. The
 *    dotted prefix MUST be carried: reading the key alone made this scanner
 *    report five real slice-layout numbers as missing from their own table.
 *  - `const c = TUNING.collapse`                → path `collapse` (dotted)
 *  - `TUNING` passed bare to a function → recorded in `opaque`, never treated
 *    as a read of everything (that would make the dead-tuning check inert).
 */
export function scanTuningReads(rootName, files) {
  const reads = new Map();
  const opaque = [];
  const add = (path, site) => {
    if (path === '') return;
    const list = reads.get(path);
    if (list === undefined) reads.set(path, [site]);
    else list.push(site);
  };
  const dotted = new RegExp(`\\b${rootName}((?:\\??\\.[A-Za-z_$][\\w$]*)+)`, 'g');
  const destructured = new RegExp(`\\{([^{}]*)\\}\\s*=\\s*${rootName}((?:\\??\\.[A-Za-z_$][\\w$]*)*)`, 'g');
  const bare = new RegExp(`\\b${rootName}\\b`, 'g');
  for (const rel of files) {
    const { code } = sourceOf(rel);
    if (!code.includes(rootName)) continue;
    const consumed = [];
    for (let m = dotted.exec(code); m !== null; m = dotted.exec(code)) {
      const path = m[1].replace(/\??\./g, '.').replace(/^\./, '');
      add(path, `${rel}:${lineOf(code, m.index)}`);
      consumed.push([m.index, m.index + m[0].length]);
    }
    for (let m = destructured.exec(code); m !== null; m = destructured.exec(code)) {
      const prefix = m[2].replace(/\??\./g, '.').replace(/^\./, '');
      for (const part of m[1].split(',')) {
        const key = part.trim().split(':')[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(key)) {
          add(prefix === '' ? key : `${prefix}.${key}`, `${rel}:${lineOf(code, m.index)}`);
        }
      }
      consumed.push([m.index, m.index + m[0].length]);
    }
    for (let m = bare.exec(code); m !== null; m = bare.exec(code)) {
      if (consumed.some(([from, to]) => m.index >= from && m.index < to)) continue;
      // `export type Tuning = typeof TUNING` and `import { TUNING }` are not reads.
      const context = code.slice(Math.max(0, m.index - 40), m.index);
      if (/typeof\s*$/.test(context) || /import[^;]*$/.test(context) || /export\s+(const|let|var)\s*$/.test(context)) continue;
      opaque.push(`${rel}:${lineOf(code, m.index)}`);
    }
  }
  return { reads, opaque };
}

/**
 * True when some scanned read path covers `leaf`.
 *
 * Three shapes count, and all three are real:
 *  - exact:     `TUNING.gate.radius`            reads `gate.radius`
 *  - shallower: `const g = TUNING.gate`         reads every `gate.*` leaf
 *  - deeper:    `TUNING.hyper.skinMilestones.forEach(…)` / `.length` / `[0]`
 *    reads the leaf `hyper.skinMilestones` — the trailing member is a method or
 *    an index on the value, not another tuning key. Missing this case is how an
 *    earlier revision of this scanner reported a leaf as dead while a slice was
 *    iterating it two files away.
 */
export function leafIsRead(leaf, reads) {
  if (reads.has(leaf)) return true;
  const parts = leaf.split('.');
  for (let i = 1; i < parts.length; i += 1) {
    if (reads.has(parts.slice(0, i).join('.'))) return true;
  }
  const prefix = `${leaf}.`;
  for (const path of reads.keys()) if (path.startsWith(prefix)) return true;
  return false;
}

/* --------------------------------------------------------- report shape --- */

/**
 * A stage prints every finding it has and exits once. Stages never throw on the
 * first problem: a check that stops at failure #1 hides failures #2..#n, and
 * this pipeline has already paid for that (see `verify.sh`'s stage aggregation).
 */
export function report(title, { failures, notes, summary }) {
  if (summary !== undefined) console.log(summary);
  for (const note of notes) console.log(`note: ${note}`);
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  if (failures.length > 0) {
    console.error(`${title}: ${failures.length} failure(s)`);
    process.exitCode = 1;
    return false;
  }
  console.log(`${title}: OK`);
  return true;
}
