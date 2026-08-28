#!/usr/bin/env node
/**
 * Spec gate for a single game: `node scripts/audit-check.mjs <slug> [--json]`.
 *
 * Answers one question — is games/<slug>/PRD.md an IMPLEMENTABLE spec, or is it
 * still a template with the hard parts left blank? This is the mechanical half
 * of the PRD review the pipeline used to do by prompt: presence, placeholders,
 * the §1b genre dossier, the §13 feel budgets, the §14b flow map, the cut list,
 * the assumptions log, and the orchestrator's build-state.json.
 *
 * Exits 0 when every hard check passes, 1 when any check fails (a warning never
 * changes the exit code). `--json` prints the findings array instead of the
 * human report. Same findings framework as scripts/release-check.mjs.
 *
 * Checked:
 *   prd        PRD.md exists and is not a stub (>200 lines for a full build)
 *   ph         TBD / TODO / placeholder / <angle stubs> outside code fences
 *   dossier    §1b staples checklist: >=8 rows, adopt|adapt|cut, cut has a why
 *   feel       §13 feel-budget table: six budget rows, no unfilled cells
 *   flow       §14b flow map: mermaid + tap-depth + interruptions + edges + confirm
 *   cut        §17 cut list >= 5 entries
 *   assume     §18 Assumptions non-empty
 *   state      build-state.json shape (wave + tasks[] with ownership + status)
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A PRD this short cannot carry §1b-§20 at implementable detail. */
const FULL_PRD_LINES = 200;
/** The six feel budgets template/AGENTS.md §Quality budgets makes measurable. */
const FEEL_BUDGETS = [
  ['ack', /\back\b|acknowledg/i, 'input acknowledgment (<=100ms)'],
  ['animation', /\banimation\b/i, 'core-loop animation (120-400ms)'],
  ['transition', /\btransition\b/i, 'scene transition (<=400ms)'],
  ['retry', /\bretry\b/i, 'retry to playable (<=2s)'],
  ['payoff', /\bpayoff\b/i, 'payoff cadence (<=20s)'],
  ['fps', /\bfps\b/i, 'peak-fps beat (60fps at the heaviest beat)'],
];
/** The five blocks §14b must carry; a missing one is an undefined-UX hole. */
const FLOW_BLOCKS = [
  ['mermaid graph fence', (s) => s.fenceLangs.includes('mermaid')],
  ['tap-depth table', (s) => /tap[\s-]?depth/i.test(s.text)],
  ['interruption matrix', (s) => /interruption/i.test(s.text)],
  ['edge-state inventory', (s) => /edge[\s-]?state/i.test(s.text)],
  ['confirmation policy', (s) => /confirmation/i.test(s.text)],
];
const TASK_STATUS = new Set(['pending', 'running', 'done', 'dead', 'taken-over']);
/** Angle-bracket spans that are markup or links, not spec stubs. */
const HTML_TAGS = /^\/?(br|hr|p|div|span|a|b|i|em|strong|title|canvas|script|img|meta|link|html|head|body|code|pre|ul|ol|li|table|tr|td|th|button|input|style|svg)\b/i;

// --- findings ---------------------------------------------------------------

const findings = [];
const pass = (id, message) => findings.push({ id, level: 'pass', message });
const warn = (id, message) => findings.push({ id, level: 'warn', message });
const fail = (id, message) => findings.push({ id, level: 'error', message });
/** pass/fail in one call; returns the boolean so callers can branch. */
const check = (ok, id, okMsg, failMsg) => (ok ? pass(id, okMsg) : fail(id, failMsg), ok);

// --- markdown model ---------------------------------------------------------

/**
 * Line-indexed view of the PRD. Fenced blocks are flagged so a check never
 * mistakes example code for prose (a `<T>` generic is not a spec stub), and the
 * fence language is kept so §14b's mermaid graph can be found.
 */
function parseDoc(text) {
  const lines = text.split(/\r?\n/);
  const inFence = lines.map(() => false);
  const fenceLang = lines.map(() => null);
  let open = null;
  lines.forEach((line, i) => {
    const m = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(line);
    if (open) {
      inFence[i] = true;
      if (m && m[1][0] === open) open = null;
    } else if (m) {
      inFence[i] = true;
      open = m[1][0];
      fenceLang[i] = m[2] || '';
    }
  });
  return { lines, inFence, fenceLang };
}

/**
 * The `## <token>` section, ending at the next heading of the same or higher
 * level. Token is the PRD's own numbering ('1b', '13', '14b', '17', '18') so a
 * retitled section still resolves.
 */
function section(doc, token) {
  const head = new RegExp(`^(#{2,4})\\s*(?:§\\s*)?${token}\\b`, 'i');
  let start = -1;
  let level = 0;
  for (let i = 0; i < doc.lines.length; i += 1) {
    if (doc.inFence[i]) continue;
    const m = head.exec(doc.lines[i]);
    if (m) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start < 0) return null;
  let end = doc.lines.length;
  for (let i = start + 1; i < doc.lines.length; i += 1) {
    if (doc.inFence[i]) continue;
    const m = /^(#{1,6})\s/.exec(doc.lines[i]);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  const body = doc.lines.slice(start + 1, end);
  return {
    start,
    end,
    heading: doc.lines[start].trim(),
    body,
    text: body.join('\n'),
    fenceLangs: doc.fenceLang.slice(start + 1, end).filter((l) => l !== null),
  };
}

const cells = (row) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** Every markdown table in a section: header cells plus data rows with line numbers. */
function tables(doc, sec) {
  const out = [];
  for (let i = sec.start + 1; i < sec.end; i += 1) {
    if (doc.inFence[i]) continue;
    const sep = doc.lines[i];
    const head = doc.lines[i - 1];
    if (!/^\s*\|?[\s:|-]*-[-\s:|]*\|/.test(sep) || !/\|/.test(head ?? '')) continue;
    const rows = [];
    let j = i + 1;
    for (; j < sec.end && /^\s*\|/.test(doc.lines[j] ?? ''); j += 1) {
      const c = cells(doc.lines[j]);
      if (c.some((x) => x !== '')) rows.push({ cells: c, line: j + 1 });
    }
    out.push({ header: cells(head), rows, line: i });
    i = j;
  }
  return out;
}

// --- checks -----------------------------------------------------------------

/**
 * A PRD is the build contract for 4-6 parallel agents; a short one means the
 * agents will improvise. Compact PRDs exist (game #1 shipped one), so this
 * warns rather than blocks.
 */
function checkPrdShape(doc, relPath) {
  const n = doc.lines.length;
  const words = doc.lines.join(' ').split(/\s+/).filter(Boolean).length;
  if (n >= FULL_PRD_LINES) pass('prd:size', `${relPath}: ${n} lines / ${words} words`);
  else warn('prd:size', `${relPath}: only ${n} lines (<${FULL_PRD_LINES}) — compact PRD, sections are inherited by assumption`);
}

/**
 * An unfilled marker is a decision nobody made: the build agent will either
 * guess or ask. Code fences are exempt (example code legitimately holds
 * generics/tags) and so are inline-code spans for angle stubs only — `tut:<id>`
 * is an identifier pattern, while a bare <name the heaviest beat> is a hole.
 */
function checkPlaceholders(doc) {
  const hits = [];
  doc.lines.forEach((line, i) => {
    if (doc.inFence[i]) return;
    const word = /\b(TBD|TODO|placeholders?)\b/i.exec(line);
    if (word) hits.push({ line: i + 1, what: word[1] });
    const prose = line.replace(/`[^`]*`/g, '');
    for (const m of prose.matchAll(/<([^<>\n]{2,})>/g)) {
      const inner = m[1];
      if (inner.includes('://') || inner.includes('@') || HTML_TAGS.test(inner)) continue;
      hits.push({ line: i + 1, what: `<${inner}>` });
    }
  });
  if (!hits.length) return pass('ph:markers', 'no TBD/TODO/placeholder/<stub> markers outside code fences');
  const shown = hits.slice(0, 12).map((h) => `L${h.line} ${h.what}`).join(', ');
  fail('ph:markers', `${hits.length} unfilled marker(s): ${shown}${hits.length > 12 ? ', …' : ''}`);
}

/**
 * §1b is why a game ships content-rich instead of template-shaped: the staples
 * checklist is the genre's real kit, `adopt` is the default, and a `cut` without
 * a reason is scope loss disguised as a decision. Sub-8 rows means the research
 * pass was too shallow (skill://game-prd rule 5).
 */
function checkDossier(doc) {
  const sec = section(doc, '1b');
  if (!check(!!sec, 'dossier:section', '§1b genre dossier present', '§1b genre dossier missing — no market/mechanics research pass in the PRD')) return;

  // Playbook-cached is the offline fallback; legal, but the kit is a cache, not the market.
  if (/playbook[\s-]?cached/i.test(doc.lines.join('\n'))) {
    warn('dossier:cached', 'dossier flagged playbook-cached (no live research) — staple set is the cached baseline');
  }

  const all = tables(doc, sec);
  const staples = all.find((t) => t.header.some((h) => /staple/i.test(h))) ?? all.find((t) => t.rows.length >= 4);
  if (!check(!!staples, 'dossier:table', '§1b staples checklist table found', '§1b has no staples checklist table')) return;

  check(
    staples.rows.length >= 8,
    'dossier:rows',
    `§1b staples checklist: ${staples.rows.length} rows (>=8)`,
    `§1b staples checklist has only ${staples.rows.length} data row(s), need >=8 — the genre's kit is never that small`,
  );

  const bad = [];
  const bareAdapt = [];
  for (const row of staples.rows) {
    const verdict = (row.cells[row.cells.length - 1] ?? '').replace(/[*`_]/g, '').trim();
    const m = /^(adopt|adapt|cut)\b(.*)$/i.exec(verdict);
    if (!m) {
      bad.push(`L${row.line} "${row.cells[0] || '(unnamed)'}" verdict=${verdict ? `"${verdict}"` : '(empty)'}`);
      continue;
    }
    const rest = m[2].replace(/^[\s:—–-]+/, '').trim();
    if (m[1].toLowerCase() === 'cut' && !rest) bad.push(`L${row.line} "${row.cells[0] || '(unnamed)'}" cut without a reason`);
    if (m[1].toLowerCase() === 'adapt' && !rest) bareAdapt.push(`L${row.line} "${row.cells[0] || '(unnamed)'}"`);
  }
  check(
    bad.length === 0,
    'dossier:verdicts',
    `§1b: all ${staples.rows.length} staple verdicts are adopt/adapt/cut, every cut justified`,
    `§1b staple verdict problems: ${bad.join('; ')}`,
  );
  if (bareAdapt.length) warn('dossier:adapt', `§1b: adapt without a "how": ${bareAdapt.join('; ')}`);
}

/**
 * §13's feel budgets turn template/AGENTS.md §Quality budgets into numbers this
 * game is measured against; a missing row is a budget game-qa cannot check, and
 * an unfilled cell (60fps at <name the heaviest beat>) means nobody chose where.
 */
function checkFeelBudget(doc) {
  const sec = section(doc, '13');
  if (!check(!!sec, 'feel:section', '§13 juice/feel section present', '§13 juice table + feel budgets missing')) return;

  const all = tables(doc, sec);
  const budget = all.find((t) => t.header.some((h) => /budget/i.test(h)));
  const rows = budget ? budget.rows : all.flatMap((t) => t.rows);
  if (!check(rows.length > 0, 'feel:table', '§13 feel-budget table found', '§13 has no feel-budget table')) return;

  const missing = FEEL_BUDGETS.filter(([, re]) => !rows.some((r) => re.test(r.cells.join(' ')))).map(([, , label]) => label);
  check(
    missing.length === 0,
    'feel:rows',
    `§13 feel budgets: all six rows present (${rows.length} budget row(s))`,
    `§13 feel budgets missing ${missing.length} row(s): ${missing.join('; ')}`,
  );

  // Scanned across the whole section, not just the parsed rows: a stub sitting
  // after a blank line (which ends the markdown table) is still an unmade decision.
  const unfilled = [];
  sec.body.forEach((line, i) => {
    const at = sec.start + 1 + i;
    if (doc.inFence[at]) return;
    if (/<[^<>\n]{2,}>/.test(line.replace(/`[^`]*`/g, ''))) unfilled.push(`L${at + 1}`);
  });
  check(
    unfilled.length === 0,
    'feel:filled',
    '§13 feel budgets: every cell filled in',
    `§13 feel budgets still hold template stubs: ${unfilled.join('; ')}`,
  );
}

/** "The flow map is law": without these five blocks a state is undefined at runtime. */
function checkFlowMap(doc) {
  const sec = section(doc, '14b');
  if (!check(!!sec, 'flow:section', '§14b flow map present', '§14b flow map missing — screens/transitions/interruptions unspecified')) return;

  const missing = FLOW_BLOCKS.filter(([, has]) => !has(sec)).map(([name]) => name);
  check(
    missing.length === 0,
    'flow:blocks',
    '§14b flow map: all five blocks present (graph, tap-depth, interruptions, edge states, confirmations)',
    `§14b flow map missing block(s): ${missing.join('; ')}`,
  );
}

/** An empty cut list means the scope is unbounded — the build never converges. */
function checkCutList(doc) {
  const sec = section(doc, '17');
  if (!check(!!sec, 'cut:section', '§17 cut list present', '§17 cut list missing — scope is unbounded')) return;

  const entries = sec.body.filter((l, i) => {
    if (doc.inFence[sec.start + 1 + i]) return false;
    return /^\s*(?:[-*+]\s+\S|\d+[.)]\s+\S)/.test(l) || (/^\s*\|/.test(l) && !/^\s*\|?[\s:|-]*-[-\s:|]*\|/.test(l) && !/^\s*\|\s*(feature|cut|item)\b/i.test(l));
  }).length;
  check(
    entries >= 5,
    'cut:count',
    `§17 cut list: ${entries} entries (>=5)`,
    `§17 cut list has ${entries} entr${entries === 1 ? 'y' : 'ies'}, need >=5`,
  );
}

/** Every auto-resolved axis is logged here; an empty log means undocumented guesses. */
function checkAssumptions(doc) {
  const sec = section(doc, '18');
  if (!check(!!sec, 'assume:section', '§18 Assumptions present', '§18 Assumptions missing — no record of the decisions made for the author')) return;

  const content = sec.body.filter((l, i) => !doc.inFence[sec.start + 1 + i] && l.trim() !== '').length;
  check(
    content > 0,
    'assume:content',
    `§18 Assumptions: ${content} line(s) of decisions logged`,
    '§18 Assumptions is empty',
  );
}

/**
 * build-state.json is the orchestrator's crash-recovery record: which wave is
 * running, who owns which files, and which tasks died. A malformed one is worse
 * than none (a takeover would trust it), so shape errors are hard failures.
 */
function checkBuildState(dir) {
  const file = path.join(dir, 'build-state.json');
  if (!existsSync(file)) {
    return warn('state:file', 'build-state.json absent — the orchestrator should have written the wave/ownership record');
  }
  let state;
  try {
    state = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return fail('state:json', `build-state.json is not valid JSON: ${err.message}`);
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return fail('state:shape', 'build-state.json is not a JSON object');
  }
  const errs = [];
  if (typeof state.wave !== 'string' || !state.wave.trim()) errs.push('wave must be a non-empty string');
  if (!Array.isArray(state.tasks)) errs.push('tasks must be an array');
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const empties = [];
  tasks.forEach((t, i) => {
    const at = `tasks[${i}]`;
    if (!t || typeof t !== 'object' || Array.isArray(t)) return errs.push(`${at} must be an object`);
    if (typeof t.name !== 'string' || !t.name.trim()) errs.push(`${at}.name must be a non-empty string`);
    if (!Array.isArray(t.ownershipGlobs)) errs.push(`${at}.ownershipGlobs must be an array of strings`);
    else if (!t.ownershipGlobs.every((g) => typeof g === 'string' && g.trim())) errs.push(`${at}.ownershipGlobs must contain non-empty strings`);
    else if (t.ownershipGlobs.length === 0) empties.push(t.name ?? at);
    if (!TASK_STATUS.has(t.status)) errs.push(`${at}.status ${JSON.stringify(t.status)} not one of ${[...TASK_STATUS].join('|')}`);
  });
  check(
    errs.length === 0,
    'state:shape',
    `build-state.json valid: wave "${state.wave}", ${tasks.length} task(s)`,
    `build-state.json malformed: ${errs.join('; ')}`,
  );
  // A task owning no globs cannot be sanity-checked for overlap, but it is not corrupt.
  if (empties.length) warn('state:ownership', `build-state.json: task(s) with empty ownershipGlobs: ${empties.join(', ')}`);
}

// --- driver -----------------------------------------------------------------

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const slug = args.find((a) => !a.startsWith('--'));

function report(exitCode, extra = {}) {
  const errors = findings.filter((f) => f.level === 'error');
  const warnings = findings.filter((f) => f.level === 'warn');
  const ok = exitCode === 0;
  if (asJson) {
    console.log(JSON.stringify({ slug: slug ?? null, ok, findings, ...extra }, null, 2));
  } else {
    const icon = { pass: '  ok ', warn: 'warn ', error: 'FAIL ' };
    console.log(`\naudit-check ${slug ?? '(no slug)'}\n`);
    for (const f of findings) console.log(`${icon[f.level]} ${f.message}`);
    if (extra.error) console.log(`FAIL  ${extra.error}`);
    console.log(
      ok
        ? `\nPASS — ${slug} PRD is implementable${warnings.length ? ` (${warnings.length} warning(s))` : ''}\n`
        : `\nSPEC INCOMPLETE — ${errors.length + (extra.error ? 1 : 0)} blocking issue(s), ${warnings.length} warning(s)\n`,
    );
  }
  process.exit(exitCode);
}

if (!slug) {
  report(1, { error: 'usage: node scripts/audit-check.mjs <slug> [--json]' });
}

const dir = path.join(ROOT, 'games', slug);
if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  report(1, { error: `no such game: games/${slug}/` });
}

const prdPath = path.join(dir, 'PRD.md');
const relPath = `games/${slug}/PRD.md`;
if (existsSync(prdPath)) {
  pass('prd:file', `${relPath} present`);
  const doc = parseDoc(readFileSync(prdPath, 'utf8'));
  checkPrdShape(doc, relPath);
  checkPlaceholders(doc);
  checkDossier(doc);
  checkFeelBudget(doc);
  checkFlowMap(doc);
  checkCutList(doc);
  checkAssumptions(doc);
} else {
  fail('prd:file', `${relPath} missing — the build has no spec`);
}
checkBuildState(dir);

report(findings.some((f) => f.level === 'error') ? 1 : 0);
