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
 *   retired    a §14b-retired node is named nowhere live (graph, matrix, prose)
 *   band       §14 band-ownership table: an owner and an arbitration path per band
 *   claim      §5.5 claimability ledger: no [unproven] row, every row has a reader
 *   cut        §17 cut list >= 5 entries
 *   assume     §18 Assumptions non-empty
 *   amend      §18 amendment log: every amendment names the sections it updated
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

/**
 * Every table in the whole PRD. Spec SURFACES are located by their header
 * signature rather than by section number: a game's own numbering drifts (one
 * PRD's §5.5 is the relic table, the template's §5.5 is the claimability
 * ledger), and a check keyed to the number would pass on the wrong table.
 */
function allTables(doc) {
  return tables(doc, { start: -1, end: doc.lines.length });
}

/** The first table whose header cells satisfy `predicate`, or null. */
function findTable(doc, predicate) {
  return allTables(doc).find((t) => predicate(t.header)) ?? null;
}

/** A leftover template stub row: `| … | | | |`. */
const isStubRow = (row) => /^(?:…|\.{3})$/.test(row.cells[0] ?? '');

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

/**
 * A retired flow node must leave the spec in the SAME edit that retires it.
 * Measured: `PauseDraft` was retired in a §14b amendment (two overlays owning
 * the screen at once) and survived as a live row in the interruption matrix at
 * PRD.md:1128-1129, so the matrix still described a state that does not exist.
 * A retune reading it would rebuild the node.
 *
 * The retirement itself is recorded in prose and must stay there — provenance
 * is the point of an amendment. What may not survive is the node named as
 * LIVE: in the graph, in a table row, or in any prose paragraph that does not
 * record the retirement.
 */
const RETIRED_MARKER = /\bretir|\brevers|\bremov|no longer|\bcut\b|\bsupersed|\bwithdraw/i;
const MERMAID_KEYWORDS = new Set(['graph', 'flowchart', 'subgraph', 'end', 'click', 'style', 'classDef', 'linkStyle', 'direction', 'TD', 'TB', 'BT', 'LR', 'RL']);
/** `PauseDraft` also spelled `Pause-over-Draft` / `pause over draft`. */
function nodeNamePattern(name) {
  const segments = name.split(/(?=[A-Z])/).filter(Boolean);
  const joint = '[-_\\s]*(?:over|on|of|the|in|atop|during)?[-_\\s]*';
  return new RegExp(segments.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(joint), 'i');
}

function checkFlowRetirement(doc) {
  const sec = section(doc, '14b');
  if (!sec) return;

  const fence = [];
  const tableRows = [];
  const prose = [];
  for (let i = sec.start + 1; i < sec.end; i += 1) {
    const line = doc.lines[i];
    if (doc.inFence[i]) fence.push([i + 1, line]);
    else if (/^\s*\|/.test(line)) tableRows.push([i + 1, line]);
    else prose.push([i + 1, line]);
  }

  // Graph node ids, with quoted labels and bracketed display text removed so a
  // label's prose never reads as a node.
  const stripped = fence
    .map(([, l]) => l)
    .join('\n')
    .replace(/"[^"]*"/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ');
  const nodes = new Set(
    [...stripped.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\b/g)].map((m) => m[1]).filter((n) => !MERMAID_KEYWORDS.has(n)),
  );

  // A retirement record: a prose line that says so and backticks the node.
  const retired = new Map();
  for (const [line, text] of prose) {
    if (!RETIRED_MARKER.test(text)) continue;
    for (const m of text.matchAll(/`([A-Z][A-Za-z0-9]*)`/g)) {
      if (!nodes.has(m[1]) && !retired.has(m[1])) retired.set(m[1], line);
    }
  }
  if (retired.size === 0) return;

  // Paragraphs of prose; one that carries the marker is the record itself and
  // is allowed (and required) to name the retired node.
  const paragraphs = [];
  let current = null;
  for (const [line, text] of prose) {
    if (text.trim() === '') {
      current = null;
      continue;
    }
    if (!current) {
      current = { lines: [], marked: false };
      paragraphs.push(current);
    }
    current.lines.push([line, text]);
    if (RETIRED_MARKER.test(text)) current.marked = true;
  }

  const stale = [];
  for (const [name] of retired) {
    const rx = nodeNamePattern(name);
    for (const [line, text] of tableRows) if (rx.test(text)) stale.push(`${name} in a table row at line ${line}`);
    for (const [line, text] of fence) if (rx.test(text)) stale.push(`${name} in the flow graph at line ${line}`);
    for (const para of paragraphs) {
      if (para.marked) continue;
      for (const [line, text] of para.lines) if (rx.test(text)) stale.push(`${name} described as live at line ${line}`);
    }
  }
  check(
    stale.length === 0,
    'flow:retired',
    `§14b: retired node(s) ${[...retired.keys()].join(', ')} recorded in the amendment and named nowhere live`,
    `§14b retires ${[...retired.keys()].map((n) => `\`${n}\``).join(', ')} but the spec still describes ` +
      `${stale.length === 1 ? 'it' : 'them'} as live: ${stale.join('; ')} — retire a node in ONE edit ` +
      '(graph, matrix, tap-depth, node inventory), leaving only the amendment that records why',
  );
}

/**
 * The claimability ledger (template §5.5): one row per authored reward, bonus,
 * drop, unlock and effect id, each with the player action that claims it, a
 * NAMED reachability proof and the file that reads it.
 *
 * Provenance: one build shipped `extract.collapseHaulBonus = 0.5` behind a gate
 * no run structurally reached (cert measured 419px closest approach against
 * the 70px needed), an effect id (`fx_lastgasp`) registered nowhere, and a
 * threat key asserted by a contract check yet read by nothing — 12 dead-content
 * classes in one build, none of which any gate could see. `[unproven]` in the
 * reachability column is a blocker by rule: the value stays out of the build
 * until it is proven or the row is cut.
 */
function checkClaimability(doc) {
  const table = findTable(doc, (h) => h.some((c) => /claim\s*condition/i.test(c)) && h.some((c) => /reachab/i.test(c)));
  if (!check(!!table, 'claim:table', '§5.5 claimability ledger present', '§5.5 claimability ledger missing — no PRD row proves any authored reward/bonus/drop/effect id is claimable or read by anything')) return;

  const rows = table.rows.filter((r) => !isStubRow(r));
  if (!check(rows.length > 0, 'claim:rows', `§5.5 claimability ledger: ${rows.length} authored payout(s) logged`, '§5.5 claimability ledger has no rows — every authored payout needs one')) return;

  const unproven = rows.filter((r) => r.cells.some((c) => /\[unproven\]/i.test(c))).map((r) => `line ${r.line}: ${r.cells[0]}`);
  check(
    unproven.length === 0,
    'claim:proven',
    '§5.5 claimability ledger: every row names a reachability proof',
    `§5.5 claimability ledger has ${unproven.length} [unproven] row(s) — a value whose gate nobody has ` +
      `reached must be proven or cut, never shipped dark: ${unproven.join('; ')}`,
  );
  const readerCol = table.header.findIndex((c) => /read\s*by/i.test(c));
  if (readerCol >= 0) {
    const unread = rows.filter((r) => !(r.cells[readerCol] ?? '').trim()).map((r) => `line ${r.line}: ${r.cells[0]}`);
    check(
      unread.length === 0,
      'claim:readers',
      '§5.5 claimability ledger: every row names the file that reads it',
      `§5.5 claimability ledger has ${unread.length} row(s) with an empty "Read by" — an authored value ` +
        `nothing reads is dead content: ${unread.join('; ')}`,
    );
  }
}

/**
 * §14's band-ownership table: one owner per horizontal band plus the
 * arbitration path a new widget must take. Its absence is what let authored
 * coordinates collide — a reroll chip authored 23px into the first card, and a
 * seventh widget squatting the Banner band — because two widgets were authored
 * independently against the same y-range with no arbiter.
 */
function checkBandOwnership(doc) {
  const table = findTable(doc, (h) => h.some((c) => /^band\b/i.test(c)) && h.some((c) => /y-?range|rect|y\s*\d/i.test(c)));
  if (!check(!!table, 'band:table', '§14 band-ownership table present', '§14 band-ownership table missing — nothing arbitrates two widgets authored against the same y-range (this is how authored coordinates collide)')) return;

  const rows = table.rows.filter((r) => !isStubRow(r));
  check(
    rows.length >= 3,
    'band:rows',
    `§14 band-ownership table: ${rows.length} band(s) with an owner`,
    `§14 band-ownership table has ${rows.length} band(s) — a frame has at least a top, a playfield and a bottom band`,
  );
  // The arbitration path is the last column: "if a new widget wants this band".
  const arbCol = table.header.findIndex((c) => /arbitrat|if a new widget|rule|occupan/i.test(c));
  if (arbCol < 0) {
    fail('band:arbitration', `§14 band-ownership table has no arbitration column (expected "If a new widget wants this band" or "Rule"): header is ${table.header.join(' | ')}`);
    return;
  }
  const silent = rows.filter((r) => !(r.cells[arbCol] ?? '').trim()).map((r) => `line ${r.line}: ${r.cells[0]}`);
  check(
    silent.length === 0,
    'band:arbitration',
    '§14 band-ownership table: every band states what a new widget must do',
    `§14 band-ownership table: ${silent.length} band(s) with no arbitration path — "author it 23px higher ` +
      `and hope" is what happens next: ${silent.join('; ')}`,
  );
}

/**
 * §18's amendment log. A number changed after a measurement has to be changed
 * in every section that quotes it, in the same pass; the log is the record of
 * which sections were updated. Measured: `gear.slots` was amended 4 → 3 on a
 * lane-spread measurement while §5.3 still said "4 slots; each ranks 1-5", so
 * the next retune would have read the superseded number and reinstated it.
 */
function checkAmendmentLog(doc) {
  const table = findTable(
    doc,
    (h) => h.some((c) => /old\s*(?:→|->|to)\s*new/i.test(c)) || (h.some((c) => /^key\b/i.test(c)) && h.some((c) => /sections?\s*updated/i.test(c))),
  );
  if (!check(!!table, 'amend:table', '§18 amendment log present', '§18 amendment log missing — nothing records which numbers were amended on measurement, so a stale quote elsewhere in the PRD silently re-breaks the fixed thing')) return;

  const rows = table.rows.filter((r) => !isStubRow(r));
  const sectionsCol = table.header.findIndex((c) => /sections?\s*updated/i.test(c));
  if (sectionsCol < 0) {
    fail('amend:sections', `§18 amendment log has no "Sections updated in the same pass" column: header is ${table.header.join(' | ')}`);
    return;
  }
  const unmirrored = rows.filter((r) => !(r.cells[sectionsCol] ?? '').trim()).map((r) => `line ${r.line}: ${r.cells[0]}`);
  check(
    unmirrored.length === 0,
    'amend:sections',
    `§18 amendment log: ${rows.length} amendment(s), each naming the sections updated in the same pass`,
    `§18 amendment log: ${unmirrored.length} amendment(s) name no updated sections — an amendment that did ` +
      `not propagate leaves the superseded number live somewhere: ${unmirrored.join('; ')}`,
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
    // A READ-ONLY gate agent (critic, reviewer, QA sweep, flow audit) owns no
    // files by design, and warning about it every run trains people to ignore
    // this gate — the `console.error` failure mode. An explicit `readOnly: true`
    // is the difference between "owns nothing on purpose" and "someone forgot".
    else if (t.ownershipGlobs.length === 0 && t.readOnly !== true) empties.push(t.name ?? at);
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
  checkFlowRetirement(doc);
  checkBandOwnership(doc);
  checkClaimability(doc);
  checkCutList(doc);
  checkAssumptions(doc);
  checkAmendmentLog(doc);
} else {
  fail('prd:file', `${relPath} missing — the build has no spec`);
}
checkBuildState(dir);

report(findings.some((f) => f.level === 'error') ? 1 : 0);
