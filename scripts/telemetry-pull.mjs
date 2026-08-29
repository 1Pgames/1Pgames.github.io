#!/usr/bin/env node
/**
 * Reads the funnel back out of GoatCounter:
 * `GOATCOUNTER_TOKEN=... node scripts/telemetry-pull.mjs --slug <slug> [--days 7] [--json]`
 *
 * `template/src/core/telemetry.ts` records one event per funnel beat as the
 * path `ev/<slug>/<event>` — 'session-start', 'daily-start', 'win-3',
 * 'loss-3', 'retry', 'share'. This script pulls those paths for one game and
 * prints the three readings they were designed for:
 *
 *   events   every event of this game with its visitor count
 *   levels   win-N/loss-N folded into a per-level funnel: plays, winrate and
 *            REACH (share of level-1 plays that got this far) — the coarse
 *            retention curve that says WHERE players stop
 *   flow     the session beats: starts, daily starts, retries, shares
 *
 * Site URL comes from site/config.json's `goatcounter` value (the same one
 * scripts/build-site.mjs injects), minus its trailing `/count`. The API token
 * is made in GoatCounter under [account] -> API and passed as
 * GOATCOUNTER_TOKEN — it is never stored in the repo.
 *
 * Flags:
 *   --slug <slug>   game slug, as in games/<slug>/ (required)
 *   --days N        how far back to look, default 7
 *   --json          machine dump instead of the human report
 *
 * Exit codes: 0 report printed, 1 network/HTTP/config failure (one line, no
 * stack trace), 2 bad or missing invocation.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'site', 'config.json');

/** GoatCounter's own cap for `limit`; fewer pages means fewer round trips. */
const PAGE_LIMIT = 100;
/** A game has tens of event paths, not thousands — this cap only stops a loop. */
const MAX_PAGES = 20;

const USAGE = `usage: GOATCOUNTER_TOKEN=<api token> node scripts/telemetry-pull.mjs --slug <slug> [--days 7] [--json]

  --slug <slug>   game slug, as in games/<slug>/ (required)
  --days N        days of history to pull (default 7)
  --json          machine-readable dump instead of the report

The token is created in GoatCounter under [account menu] -> API and needs the
"read statistics" permission. The site URL is read from site/config.json.`;

/** Usage problem: tell the caller how to invoke it, do not pretend to work. */
function bail(message) {
  console.error(`error: ${message}\n`);
  console.error(USAGE);
  process.exit(2);
}

/** Runtime problem (config, network, HTTP): one line, no stack trace. */
function die(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

// --- invocation -------------------------------------------------------------

function parseArgs(argv) {
  const opts = { slug: null, days: 7, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--slug') {
      opts.slug = argv[i + 1];
      i += 1;
      if (opts.slug === undefined || opts.slug.startsWith('--')) bail('--slug needs a value');
    } else if (arg === '--days') {
      const raw = argv[i + 1];
      i += 1;
      const days = Number(raw);
      if (!Number.isFinite(days) || days <= 0) bail(`--days needs a positive number, got ${raw ?? '(nothing)'}`);
      opts.days = Math.floor(days);
    } else bail(`unknown argument ${arg}`);
  }
  if (opts.slug === null) bail('--slug is required');
  return opts;
}

/**
 * The dashboard origin behind the count URL: the config holds the endpoint the
 * browser snippet posts to (`https://<code>.goatcounter.com/count`), while the
 * API lives at the same host's root.
 */
function loadBaseUrl() {
  if (!existsSync(CONFIG_PATH)) {
    die(`site/config.json not found at ${CONFIG_PATH} — analytics are not configured for this repo, so there is nothing to pull`);
  }
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    die(`site/config.json is not valid JSON (${err.message})`);
  }
  const count = typeof config.goatcounter === 'string' ? config.goatcounter.trim() : '';
  if (count === '') die('site/config.json has no "goatcounter" URL — nothing was ever counted');
  let url;
  try {
    url = new URL(count);
  } catch {
    die(`site/config.json "goatcounter" is not a URL: ${count}`);
  }
  return url.origin;
}

// --- api --------------------------------------------------------------------

/** Start of the hour `days` back — GoatCounter wants hour-rounded bounds. */
function windowStart(now, days) {
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  start.setUTCMinutes(0, 0, 0);
  return start;
}

/**
 * Every event path in the window. `/api/v0/stats/hits` paginates by EXCLUSION
 * (`more: true` plus the path IDs already seen), so the loop feeds back what it
 * has; an `after` cursor is honoured too in case the endpoint grows one, and a
 * page that adds no new path ends the loop regardless of what `more` claims.
 */
async function fetchHits(base, token, start, end) {
  const hits = [];
  const seen = new Set();
  let after = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL('/api/v0/stats/hits', base);
    url.searchParams.set('start', start.toISOString());
    url.searchParams.set('end', end.toISOString());
    url.searchParams.set('limit', String(PAGE_LIMIT));
    for (const id of seen) url.searchParams.append('exclude_paths', String(id));
    if (after !== null) url.searchParams.set('after', String(after));

    const body = await request(url, token);
    const pageHits = Array.isArray(body.hits) ? body.hits : [];
    let added = 0;
    for (const hit of pageHits) {
      const key = hit.path_id ?? hit.path;
      if (key === undefined || seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
      added += 1;
    }
    after = body.after ?? null;
    if (added === 0) break;
    if (body.more !== true && after === null) break;
  }
  return hits;
}

async function request(url, token) {
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    die(`cannot reach ${url.host} (${err.message})`);
  }
  const text = await res.text();
  let body = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const detail = apiError(body) ?? text.slice(0, 200).replace(/\s+/g, ' ').trim();
    const hint = res.status === 401 || res.status === 403 ? ' — check GOATCOUNTER_TOKEN and its permissions' : '';
    die(`GoatCounter answered ${res.status} ${res.statusText}${detail === '' ? '' : `: ${detail}`}${hint}`);
  }
  if (body === null || typeof body !== 'object') die(`GoatCounter returned a non-JSON body from ${url.pathname}`);
  return body;
}

/** GoatCounter reports failures in `error` (string) or `errors` (field -> list). */
function apiError(body) {
  if (body === null || typeof body !== 'object') return null;
  if (typeof body.error === 'string' && body.error !== '') return body.error;
  if (body.errors !== null && typeof body.errors === 'object') {
    const parts = Object.entries(body.errors).map(
      ([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : String(msgs)}`,
    );
    if (parts.length > 0) return parts.join('; ');
  }
  return null;
}

// --- shaping ----------------------------------------------------------------

/**
 * Event name -> count for one game. Paths arrive with or without a leading
 * slash depending on how the hit was recorded, so both shapes are accepted;
 * anything outside this game's `ev/<slug>/` namespace is dropped.
 */
function collectEvents(hits, slug) {
  const prefix = `ev/${slug}/`;
  const events = new Map();
  for (const hit of hits) {
    const raw = typeof hit.path === 'string' ? hit.path : '';
    const clean = raw.replace(/^\/+/, '');
    if (!clean.startsWith(prefix)) continue;
    const name = clean.slice(prefix.length);
    if (name === '') continue;
    events.set(name, (events.get(name) ?? 0) + hitCount(hit));
  }
  return events;
}

/** `count` is the window's visitor total; sum the daily rows when it is absent. */
function hitCount(hit) {
  if (Number.isFinite(hit.count)) return hit.count;
  if (!Array.isArray(hit.stats)) return 0;
  return hit.stats.reduce((sum, row) => sum + (Number.isFinite(row?.daily) ? row.daily : 0), 0);
}

/**
 * win-N/loss-N folded per level. `reach` is the level's plays as a share of
 * level 1's — a coarse retention curve, not a session-exact funnel: it counts
 * visitors per level, so a player who cleared three levels appears on all
 * three rows. It answers "where do people stop", which is what it is for.
 */
function buildFunnel(events) {
  const levels = new Map();
  for (const [name, count] of events) {
    const match = /^(win|loss)-(\d+)$/.exec(name);
    if (match === null) continue;
    const level = Number(match[2]);
    const row = levels.get(level) ?? { level, win: 0, loss: 0 };
    row[match[1]] += count;
    levels.set(level, row);
  }
  const rows = [...levels.values()].sort((a, b) => a.level - b.level);
  const first = rows.length > 0 ? rows[0].win + rows[0].loss : 0;
  return rows.map((row) => {
    const plays = row.win + row.loss;
    return {
      ...row,
      plays,
      winrate: plays > 0 ? row.win / plays : null,
      reach: first > 0 ? plays / first : null,
    };
  });
}

/** The session beats that are not per-level, in the order they happen. */
const FLOW_EVENTS = ['session-start', 'daily-start', 'retry', 'share', 'win', 'loss'];

// --- report -----------------------------------------------------------------

const pct = (value) => (value === null ? '   -  ' : `${(value * 100).toFixed(1)}%`);
const pad = (value, width) => String(value).padStart(width);
const padEnd = (value, width) => String(value).padEnd(width);

function report(data) {
  const lines = [];
  lines.push(
    `telemetry for ${data.slug} — last ${data.days} day${data.days === 1 ? '' : 's'} (${data.start} .. ${data.end})`,
  );
  lines.push(`site ${data.base}`);
  lines.push('');

  const events = Object.entries(data.events);
  if (events.length === 0) {
    lines.push(`no ev/${data.slug}/* events in this window — either nobody played, or the build was published`);
    lines.push('before the GoatCounter snippet landed (see scripts/build-site.mjs).');
    return lines.join('\n');
  }

  const nameWidth = Math.max(...events.map(([name]) => name.length), 14);
  lines.push('events');
  for (const [name, count] of events.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    lines.push(`  ${padEnd(name, nameWidth)}  ${pad(count, 7)}`);
  }
  lines.push(`  ${padEnd(`(${events.length} events)`, nameWidth)}  ${pad(data.total, 7)}`);
  lines.push('');

  lines.push('flow');
  for (const name of FLOW_EVENTS) {
    const count = data.events[name];
    if (count === undefined) continue;
    lines.push(`  ${padEnd(name, nameWidth)}  ${pad(count, 7)}`);
  }
  const starts = (data.events['session-start'] ?? 0) + (data.events['daily-start'] ?? 0);
  const firstPlays = data.levels.length > 0 ? data.levels[0].plays : 0;
  if (starts > 0 && firstPlays > 0) {
    lines.push(`  ${padEnd('start -> played', nameWidth)}  ${pad(pct(firstPlays / starts), 7)}`);
  }
  lines.push('');

  if (data.levels.length === 0) {
    lines.push('levels: no win-N/loss-N events — this game reports plain win/loss (no level ladder).');
    return lines.join('\n');
  }
  lines.push('levels');
  lines.push('  LVL     WIN   LOSS  PLAYS  WINRATE   REACH');
  for (const row of data.levels) {
    lines.push(
      `  ${pad(row.level, 3)}  ${pad(row.win, 6)} ${pad(row.loss, 6)} ${pad(row.plays, 6)}   ${pad(pct(row.winrate), 6)}  ${pad(pct(row.reach), 6)}`,
    );
  }
  lines.push('');
  lines.push('REACH is level-N plays as a share of level-1 plays: the row where it falls off a');
  lines.push('cliff is where the game loses players. WINRATE far from the PRD target means the');
  lines.push('difficulty curve needs another balance pass.');
  return lines.join('\n');
}

// --- main -------------------------------------------------------------------

// Token first: without it no invocation can work, so that is the useful error
// even when the slug is missing too.
const token = (process.env.GOATCOUNTER_TOKEN ?? '').trim();
if (token === '') bail('GOATCOUNTER_TOKEN is not set');
const opts = parseArgs(process.argv.slice(2));

const base = loadBaseUrl();
const end = new Date();
const start = windowStart(end, opts.days);
const hits = await fetchHits(base, token, start, end);
const events = collectEvents(hits, opts.slug);
const levels = buildFunnel(events);
const data = {
  slug: opts.slug,
  days: opts.days,
  start: start.toISOString(),
  end: end.toISOString(),
  base,
  total: [...events.values()].reduce((sum, n) => sum + n, 0),
  events: Object.fromEntries([...events.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  levels,
};

if (opts.json) console.log(JSON.stringify(data, null, 2));
else console.log(report(data));
