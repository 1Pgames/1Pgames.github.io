#!/usr/bin/env node
/**
 * Release gate for a single game: `node scripts/release-check.mjs <slug>`.
 *
 * Answers one question — is games/<slug>/ a POLISHED, shippable product, or is
 * it still wearing scaffold clothes? Exits 0 when every hard check passes,
 * 1 otherwise. `--json` prints a machine-readable findings array instead of the
 * human report.
 *
 * Checked:
 *   manifest   status/title/genre/description/prompt, English-only, screenshots
 *   placeholder scaffold strings still baked into index.html / menu.ts
 *   cover      raster public/cover.png, never the deterministic scaffold SVG
 *   cert       cert-report.json verdict AND every major it recorded (a cert
 *              that passed with majors is not a clean bill of health)
 *   fuzz       fuzz-report.json verdict, failures and scene coverage
 *   style      art/style.json is this game's own locked style, not the scaffold
 *   art        generated assets must not be a byte-copy of template art
 *   wiring     every texture a gameplay def names resolves to generated art —
 *              an unresolved key draws the procedural fallback square instead
 *   audio      generated tracks/samples stay inside the download budget
 *   store      shots/og.png presence (warning)
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_ART = path.join(ROOT, 'template', 'public', 'assets', 'generated');
const TEMPLATE_STYLE = path.join(ROOT, 'template', 'art', 'style.json');
const CERT_DRIVER = path.join(ROOT, 'scripts', 'cert-driver.mjs');

const CYRILLIC = /[\u0400-\u04FF]/;
const SCAFFOLD_HOWTO = 'Joystick to move. Survive the run.';
/** Share of byte-identical template art a released game may still ship. */
const ART_REUSE_LIMIT = { arena: 0.9, default: 0.6 };
/** Download budget for generated music + sfx, in MB; above it release-check warns. */
const AUDIO_BUDGET_MB = 6;

// --- findings ---------------------------------------------------------------

const findings = [];
const pass = (id, message) => findings.push({ id, level: 'pass', message });
const warn = (id, message) => findings.push({ id, level: 'warn', message });
const fail = (id, message) => findings.push({ id, level: 'error', message });
/** pass/fail in one call; returns the boolean so callers can branch. */
const check = (ok, id, okMsg, failMsg) => (ok ? pass(id, okMsg) : fail(id, failMsg), ok);

// --- scaffold cover reproduction --------------------------------------------

/** Python `html.escape(s)` (quote=True), byte-for-byte. */
function htmlEscape(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');
}

/**
 * Reproduces the deterministic gradient cover new-game.sh writes for a slug.
 * Kept byte-identical to the scaffold's python block so a shipped cover can be
 * recognised as "still the placeholder".
 */
function scaffoldCoverSvg(slug, title, family) {
  const h = createHash('sha256').update(slug, 'utf8').digest();
  const hue1 = Math.floor((h[0] * 360) / 255);
  const hue2 = (hue1 + 40 + Math.floor((h[1] * 80) / 255)) % 360;
  const words = String(title).toUpperCase().split(/\s+/).filter(Boolean);
  const half = Math.floor((words.length + 1) / 2);
  const line1 = words.slice(0, half).join(' ');
  const line2 = words.slice(half).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue1} 70% 22%)"/>
      <stop offset="1" stop-color="hsl(${hue2} 80% 12%)"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.35" r="0.8">
      <stop offset="0" stop-color="hsl(${hue1} 90% 60% / 0.35)"/>
      <stop offset="1" stop-color="transparent"/>
    </radialGradient>
  </defs>
  <rect width="600" height="800" fill="url(#g)"/>
  <rect width="600" height="800" fill="url(#glow)"/>
  <circle cx="${120 + (h[2] % 360)}" cy="${520 + (h[3] % 180)}" r="${90 + (h[4] % 70)}" fill="hsl(${hue2} 85% 55% / 0.18)"/>
  <circle cx="${380 + (h[5] % 140)}" cy="${150 + (h[6] % 200)}" r="${40 + (h[7] % 50)}" fill="hsl(${hue1} 85% 65% / 0.22)"/>
  <text x="300" y="392" text-anchor="middle" font-family="system-ui, sans-serif" font-size="56" font-weight="800" fill="#f2f6ff" letter-spacing="2">${htmlEscape(line1)}</text>
  <text x="300" y="458" text-anchor="middle" font-family="system-ui, sans-serif" font-size="56" font-weight="800" fill="#f2f6ff" letter-spacing="2">${htmlEscape(line2)}</text>
  <text x="300" y="740" text-anchor="middle" font-family="system-ui, sans-serif" font-size="22" font-weight="600" fill="#8fa1c7" letter-spacing="6">${htmlEscape(String(family).toUpperCase())}</text>
</svg>
`;
}

// --- checks -----------------------------------------------------------------

function checkManifest(m) {
  const status = m.status;
  if (status === undefined) fail('status', 'game.json: "status" missing (expected "draft" or "released")');
  else if (status !== 'draft' && status !== 'released') fail('status', `game.json: status "${status}" is not "draft" or "released"`);
  else pass('status', `game.json: status "${status}"`);

  for (const field of ['title', 'genre', 'description', 'prompt']) {
    const value = typeof m[field] === 'string' ? m[field].trim() : '';
    if (!value) {
      fail(`field:${field}`, `game.json: "${field}" is empty`);
      continue;
    }
    if (CYRILLIC.test(value)) {
      fail(`lang:${field}`, `game.json: "${field}" contains Cyrillic — the storefront is English-only`);
      continue;
    }
    if (field === 'description' && value.length < 40) {
      fail('field:description', `game.json: description is ${value.length} chars, need >= 40`);
      continue;
    }
    pass(`field:${field}`, `game.json: ${field} ok`);
  }
}

/**
 * A game ships only after a human has actually played it. The orchestrator
 * (game-build Step 6) hands the user the local build, collects feedback,
 * applies it, and only then records the approval here — hand-writing the
 * field without a real playtest defeats the only gate that catches "runs
 * fine, feels wrong".
 */
function checkPlaytest(m) {
  const p = m.playtest;
  if (!p || typeof p !== 'object') {
    fail(
      'playtest',
      'game.json: "playtest" missing — a user playtest is required before release. ' +
        'Run the game for the user, apply their feedback, then record ' +
        '{"playtest": {"approved": true, "by": "<user>", "date": "YYYY-MM-DD"}}',
    );
    return;
  }
  const by = typeof p.by === 'string' ? p.by.trim() : '';
  const date = typeof p.date === 'string' ? p.date.trim() : '';
  if (p.approved !== true) fail('playtest', 'game.json: playtest.approved is not true — the user has not signed off');
  else if (!by || !date) fail('playtest', 'game.json: playtest.approved is true but "by"/"date" are missing');
  else pass('playtest', `game.json: playtest approved by ${by} on ${date}`);
}

/**
 * Which families have a golden-path cert adapter, read from
 * `scripts/cert-driver.mjs` itself rather than duplicated here. A hand-kept
 * copy of this list is how a NEW family silently downgraded "no cert" from a
 * blocker to a warning: nobody added the family to the literal, so the gate
 * excused the very build it existed to stop. Returns null when the export
 * cannot be read — which is itself a blocker, never an excuse.
 */
function certAdaptedFamilies() {
  if (!existsSync(CERT_DRIVER)) return null;
  const m = /export\s+const\s+adapters\s*=\s*\{([^}]*)\}/.exec(readFileSync(CERT_DRIVER, 'utf8'));
  if (!m) return null;
  const names = [...m[1].matchAll(/(?:^|[,{\s])['"]?([A-Za-z_$][\w$-]*)['"]?\s*:/g)].map((x) => x[1]);
  return names.length > 0 ? new Set(names) : null;
}

/**
 * One line of the numbers inside a cert finding's `evidence`, so the human
 * report carries the measurement and not just the verdict: the Duskhaul
 * `arena:unreachable` major held `closest: 419` against a 70px requirement,
 * and that number is the whole finding.
 */
function evidenceBrief(ev) {
  if (ev === null || ev === undefined) return '';
  if (Array.isArray(ev)) {
    // An array of objects hits `String(ev)` and renders "[object Object]",
    // which is exactly the illegibility this gate exists to remove: the major
    // is surfaced, and then says nothing. Summarise each element the way a
    // bare object is summarised so the human reads the MEASUREMENT.
    const parts = ev.slice(0, 3).map((e) => evidenceBrief(e)).filter(Boolean);
    const more = ev.length > 3 ? ` +${ev.length - 3} more` : '';
    return parts.length > 0 ? `${parts.join(' | ')}${more}`.slice(0, 220) : '';
  }
  if (typeof ev !== 'object') return String(ev).slice(0, 160);
  const scalars = Object.entries(ev)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')
    .map(([k, v]) => `${k}=${v}`);
  if (scalars.length > 0) return scalars.join(', ').slice(0, 200);
  const json = JSON.stringify(ev);
  return json.length > 160 ? `${json.slice(0, 157)}...` : json;
}

/**
 * Golden-path certification (scripts/cert-driver.mjs) leaves a machine report
 * per run, whose schema is frozen as Contract R: `passed`, `blockers[]`,
 * `majors[]`, `notes`, `finishedAt`, with each major/blocker an
 * `{id, message, evidence}`. The cert WRITES that report; this gate READS it.
 *
 * `passed` alone is not the verdict a human needs. The shipped Duskhaul cert
 * recorded `passed: true` next to the major `arena:unreachable` — "walk to
 * Gate A: never came within 70px in 30000ms", closest 419px — after which the
 * driver teleported the player to certify the channel anyway. This gate
 * printed "ok cert passed" and the design defect reached nobody. Every major
 * is therefore surfaced as its own WARN line with its evidence, and a pass
 * carrying majors says so in as many words: a cert summary must never hide
 * what the cert itself recorded.
 */
function checkCert(m, dir) {
  const family = typeof m.family === 'string' ? m.family : '';
  const adapted = certAdaptedFamilies();
  if (adapted === null) {
    fail(
      'cert:adapters',
      'scripts/cert-driver.mjs does not export a readable `adapters` map — release-check cannot ' +
        'tell which families are certifiable, so no cert report can be judged',
    );
  }
  const certPath = path.join(dir, 'cert-report.json');
  if (!existsSync(certPath)) {
    fail(
      'cert',
      adapted !== null && adapted.has(family)
        ? `no cert-report.json — the '${family}' family has a cert adapter; ` +
            'run the golden-path cert (scripts/cert-driver.mjs) before release'
        : `no cert-report.json and no cert adapter for family '${family || 'unknown'}' — ` +
            `write one next to \`export const adapters\` in scripts/cert-driver.mjs (has: ` +
            `${adapted === null ? 'unreadable' : [...adapted].join(', ')}) and run the golden-path cert. ` +
            'A family without an adapter is an UNCERTIFIED game, not an excused one',
    );
    return;
  }

  let report;
  try {
    report = JSON.parse(readFileSync(certPath, 'utf8'));
  } catch (err) {
    fail('cert', `cert-report.json is not valid JSON: ${err.message}`);
    return;
  }

  // Contract R shape. A report missing `majors[]` cannot be trusted to have
  // recorded any, which is exactly the failure mode this check exists for.
  const blockers = Array.isArray(report.blockers) ? report.blockers : null;
  const majors = Array.isArray(report.majors) ? report.majors : null;
  if (typeof report.passed !== 'boolean' || blockers === null || majors === null) {
    fail(
      'cert:schema',
      'cert-report.json does not match Contract R — it needs `passed` (boolean), `blockers[]` and ' +
        `\`majors[]\` (arrays); got passed=${JSON.stringify(report.passed)}, ` +
        `blockers=${blockers === null ? 'missing' : `${blockers.length} entries`}, ` +
        `majors=${majors === null ? 'missing' : `${majors.length} entries`}`,
    );
    if (blockers === null || majors === null) return;
  }
  if (typeof report.family === 'string' && family && report.family !== family) {
    fail(
      'cert:family',
      `cert-report.json certifies family '${report.family}' but game.json says '${family}' — ` +
        'this report belongs to another adapter and proves nothing about this build',
    );
  }

  const finished = report.finishedAt ?? 'unknown time';
  // `certification` (cert-driver): 'clean' | 'conditional' | 'failed'.
  // CONDITIONAL means the driver could not REACH a beat by real input and
  // placed the player there — the fact that made the Duskhaul cert misleading,
  // so it gets its own line instead of living inside a major's prose.
  const conditional = report.certification === 'conditional' || report.conditional === true;
  const teleports = Array.isArray(report.teleports) ? report.teleports : [];
  if (report.passed === true) {
    if (majors.length === 0 && !conditional) pass('cert', `cert passed at ${finished}, no majors recorded`);
    else {
      pass('cert', `cert reports passed at ${finished}${report.certification ? ` (certification: ${report.certification})` : ''}`);
      if (conditional) {
        const caveat = typeof report.notes?.certificationCaveat === 'string' ? report.notes.certificationCaveat.trim().replace(/\.+$/, '') : '';
        warn(
          'cert:conditional',
          `cert is CONDITIONAL, not clean: the driver could not reach ${teleports.length || 'some'} beat(s) by ` +
            `real input and PLACED the player there${teleports.length ? ` (${teleports.map((t) => (typeof t === 'string' ? t : (t?.id ?? JSON.stringify(t)))).join(', ')})` : ''}. ` +
            `Everything certified from a placed position is unproven by navigation${caveat ? ` — ${caveat}` : ''}`,
        );
      }
      if (majors.length > 0) {
        warn(
          'cert:majors',
          `cert PASSED WITH ${majors.length} MAJOR(S) — a pass is not a clean bill of health; ` +
            'each major below is a real finding the cert measured and shipped anyway',
        );
      }
    }
  } else {
    fail('cert', `cert-report.json present but passed !== true (${blockers.length} blocker(s) recorded)`);
  }

  blockers.forEach((b, i) => {
    const id = typeof b?.id === 'string' ? b.id : `#${i}`;
    const msg = typeof b?.message === 'string' ? b.message : JSON.stringify(b);
    const ev = evidenceBrief(b?.evidence);
    fail(`cert:blocker:${id}`, `cert blocker ${id}: ${msg}${ev ? ` [${ev}]` : ''}`);
  });
  majors.forEach((mj, i) => {
    const id = typeof mj?.id === 'string' ? mj.id : `#${i}`;
    const msg = typeof mj?.message === 'string' ? mj.message : JSON.stringify(mj);
    const ev = evidenceBrief(mj?.evidence);
    warn(`cert:major:${id}`, `cert major ${id}: ${msg}${ev ? ` [${ev}]` : ''}`);
  });
}

/**
 * The random-input sweep (`runFuzz` in scripts/cert-driver.mjs) is the cheap
 * half of certification: seeded clicks and keys for N seconds, asserting a
 * scene stays active, the loop never wedges and the save survives a reload.
 * It is family-agnostic — every playable build can run it — so an absent
 * report is a missing check, not an unsupported one.
 */
function checkFuzz(dir) {
  const fuzzPath = path.join(dir, 'fuzz-report.json');
  if (!existsSync(fuzzPath)) {
    fail(
      'fuzz',
      'no fuzz-report.json — run the random-input sweep (`runFuzz` in scripts/cert-driver.mjs) ' +
        'before release; it is family-agnostic and every build can run it',
    );
    return;
  }
  let report;
  try {
    report = JSON.parse(readFileSync(fuzzPath, 'utf8'));
  } catch (err) {
    fail('fuzz', `fuzz-report.json is not valid JSON: ${err.message}`);
    return;
  }
  const failures = Array.isArray(report.failures) ? report.failures : null;
  if (typeof report.passed !== 'boolean' || failures === null) {
    fail(
      'fuzz:schema',
      'fuzz-report.json needs `passed` (boolean) and `failures[]` — got ' +
        `passed=${JSON.stringify(report.passed)}, failures=${failures === null ? 'missing' : `${failures.length} entries`}`,
    );
    return;
  }
  const shape = `${report.actions ?? '?'} action(s) over ${report.seconds ?? '?'}s, seed ${report.seed ?? '?'}`;
  if (report.passed === true && failures.length === 0) pass('fuzz', `fuzz: ${shape}, no failures (${report.finishedAt ?? 'unknown time'})`);
  else {
    fail('fuzz', `fuzz: ${shape} recorded ${failures.length} failure(s)`);
    failures.forEach((f, i) => fail(`fuzz:failure:${i}`, `fuzz failure: ${typeof f === 'string' ? f : JSON.stringify(f)}`));
  }
  // A sweep that never left one scene proves nothing about transitions, pause,
  // results or the menu — the places a random masher actually breaks a build.
  const trail = Array.isArray(report.sceneTrail) ? report.sceneTrail.filter((s) => typeof s === 'string') : [];
  const scenes = new Set(trail);
  if (trail.length > 0 && scenes.size <= 1) {
    warn(
      'fuzz:coverage',
      `fuzz never left the '${[...scenes][0]}' scene across the last ${trail.length} samples — ` +
        'no transition, pause or results screen was exercised',
    );
  }
}

/**
 * npm workspaces: scaffolding registers the game in the ROOT package-lock.json
 * (`games/*` is a workspace). If that lock update is not committed together
 * with the game, CI dies on `npm ci` in both jobs ("Missing: <slug> from
 * lock file") and nothing deploys.
 */
function checkWorkspaceLock(slug) {
  const lockPath = path.join(ROOT, 'package-lock.json');
  if (!existsSync(lockPath)) {
    fail('lock', 'root package-lock.json missing — run `npm install` at the repo root and commit it');
    return;
  }
  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (lock.packages?.[`games/${slug}`]) {
      pass('lock', `root package-lock.json registers the games/${slug} workspace`);
    } else {
      fail(
        'lock',
        `root package-lock.json does not register games/${slug} — run \`npm install\` at the ` +
          'repo root and commit the updated lock (CI `npm ci` fails without it)',
      );
    }
  } catch (err) {
    fail('lock', `root package-lock.json is not valid JSON: ${err.message}`);
  }
}

function checkScreenshots(m, dir) {
  const shots = Array.isArray(m.screenshots) ? m.screenshots : [];
  if (shots.length < 3) fail('shots:count', `game.json: ${shots.length} screenshot(s) listed, need >= 3`);
  else pass('shots:count', `game.json: ${shots.length} screenshots listed`);
  const missing = shots.filter((s) => !existsSync(path.join(dir, s)));
  if (missing.length) fail('shots:files', `missing screenshot file(s): ${missing.join(', ')}`);
  else if (shots.length) pass('shots:files', 'all listed screenshots exist on disk');

  if (existsSync(path.join(dir, 'shots', 'og.png'))) pass('shots:og', 'shots/og.png present (store og:image)');
  else warn('shots:og', 'shots/og.png missing — the store page falls back to the first screenshot');
}

function checkPlaceholders(m, dir, slug) {
  const indexPath = path.join(dir, 'index.html');
  if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, 'utf8');
    check(!html.includes('GAME_TITLE'), 'ph:index', 'index.html: <title> customised', 'index.html still contains the GAME_TITLE placeholder');
  } else fail('ph:index', 'index.html missing');

  const menuPath = path.join(dir, 'src', 'scenes', 'menu.ts');
  if (existsSync(menuPath)) {
    const menu = readFileSync(menuPath, 'utf8');
    check(!menu.includes('GAME\\nTITLE'), 'ph:menu', 'menu.ts: title art customised', "menu.ts still renders the 'GAME\\nTITLE' placeholder");
    if (m.family !== 'arena') {
      check(
        !menu.includes(SCAFFOLD_HOWTO),
        'ph:howto',
        'menu.ts: how-to line written for this game',
        `menu.ts still shows the arena default how-to ("${SCAFFOLD_HOWTO}") in a "${m.family}" game`,
      );
    }
    if (CYRILLIC.test(menu)) warn('ph:menu-lang', 'menu.ts contains Cyrillic text — in-game chrome should be English too');
  } else fail('ph:menu', 'src/scenes/menu.ts missing');

  check(
    String(m.title).trim().toLowerCase() !== slug.toLowerCase(),
    'ph:title',
    'game.json: title is a real name, not the slug',
    `game.json: title is still the slug ("${slug}")`,
  );
}

function checkCover(m, dir, slug) {
  const cover = typeof m.cover === 'string' ? m.cover : '';
  check(cover === 'cover.png', 'cover:name', 'game.json: cover is the raster cover.png', `game.json: cover is "${cover || '(unset)'}", a released game needs the raster "cover.png"`);

  const pngPath = path.join(dir, 'public', 'cover.png');
  check(existsSync(pngPath), 'cover:file', 'public/cover.png present', 'public/cover.png missing — generate a real cover');

  const scaffold = scaffoldCoverSvg(slug, m.title ?? slug, m.family ?? 'arena');
  const svgPath = path.join(dir, 'public', 'cover.svg');
  if (existsSync(svgPath)) {
    const isScaffold = readFileSync(svgPath, 'utf8') === scaffold;
    if (isScaffold && cover === 'cover.svg') fail('cover:scaffold', 'public/cover.svg is the untouched scaffold gradient and game.json points at it');
    else if (isScaffold) warn('cover:scaffold', 'public/cover.svg is still the scaffold gradient — delete it once cover.png ships');
    else pass('cover:scaffold', 'public/cover.svg differs from the scaffold gradient');
  }

  if (existsSync(pngPath) && cover === 'cover.png') {
    const bytes = readFileSync(pngPath);
    if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      fail('cover:png', 'public/cover.png is not a PNG file');
    } else pass('cover:png', `public/cover.png is a valid PNG (${(bytes.length / 1024).toFixed(0)} KB)`);
  }
}

/** Relative path -> sha256 for every file under `root`. */
function hashTree(root) {
  const out = new Map();
  if (!existsSync(root)) return out;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.set(path.relative(root, full), createHash('sha256').update(readFileSync(full)).digest('hex'));
    }
  };
  walk(root);
  return out;
}

function checkArt(m, dir) {
  const gameArt = path.join(dir, 'public', 'assets', 'generated');
  const mine = hashTree(gameArt);
  if (mine.size === 0) {
    fail('art:empty', 'public/assets/generated/ has no files — a released game needs generated art');
    return;
  }
  const theirs = hashTree(TEMPLATE_ART);
  let identical = 0;
  for (const [rel, hash] of mine) if (theirs.get(rel) === hash) identical += 1;
  const ratio = identical / mine.size;
  const limit = ART_REUSE_LIMIT[m.family] ?? ART_REUSE_LIMIT.default;
  const pct = (n) => `${(n * 100).toFixed(0)}%`;
  check(
    ratio <= limit,
    'art:unique',
    `art: ${identical}/${mine.size} files (${pct(ratio)}) reused from template, limit ${pct(limit)}`,
    `art: ${identical}/${mine.size} files (${pct(ratio)}) are byte-identical to template art, limit ${pct(limit)} — this game has no art of its own`,
  );
}

/**
 * The style lock is the ONE decision that makes 100 generated assets look like
 * one game, and until now nothing checked it: neither this gate nor
 * audit-check.mjs mentioned `art/style.json`. The scaffold ships a working but
 * deliberately-marked placeholder profile (`scaffold: true`), so a game whose
 * art-director never wrote a profile would have generated its whole set in the
 * scaffold's style — measured on Duskhaul, the art-director rewrote the profile
 * ten minutes before the first generation call, and a crash any earlier would
 * have produced 103 chibi assets in a grimdark game with nothing to stop it.
 *
 * Fails on the scaffold identity, and on an empty `references[]` once
 * generated art exists: the locked vision anchors (game-art Step 1b) are what
 * every generation call is conditioned on, so an empty list means the set was
 * built from prose alone.
 */
function checkStyleLock(dir) {
  const stylePath = path.join(dir, 'art', 'style.json');
  const hasArt = treeBytes(path.join(dir, 'public', 'assets', 'generated')) > 0;
  if (!existsSync(stylePath)) {
    fail(
      'style:file',
      'art/style.json missing — every asset is generated against a `sprite-forge.style.v1` ' +
        'profile (game-art Step 1); without it the set has no style contract',
    );
    return;
  }
  let style;
  try {
    style = JSON.parse(readFileSync(stylePath, 'utf8'));
  } catch (err) {
    fail('style:json', `art/style.json is not valid JSON: ${err.message}`);
    return;
  }
  if (style?.schema !== 'sprite-forge.style.v1') {
    fail('style:schema', `art/style.json schema is ${JSON.stringify(style?.schema)}, expected "sprite-forge.style.v1"`);
  }

  const scaffold = existsSync(TEMPLATE_STYLE) ? JSON.parse(readFileSync(TEMPLATE_STYLE, 'utf8')) : null;
  const name = typeof style?.name === 'string' ? style.name.trim() : '';
  const reasons = [];
  if (style?.scaffold === true) reasons.push('it still carries the scaffold marker `"scaffold": true`');
  if (!name) reasons.push('"name" is empty');
  else if (scaffold && name === String(scaffold.name).trim()) reasons.push(`"name" is still the scaffold's "${name}"`);
  if (scaffold && style?.artStyle === scaffold.artStyle) reasons.push('"artStyle" is byte-identical to the scaffold prose');
  if (reasons.length > 0) {
    fail(
      'style:scaffold',
      `art/style.json is still the scaffold style profile (${reasons.join('; ')}) — ` +
        'write this game\'s own profile (game-art Step 1) and delete the scaffold marker before generating art',
    );
  } else {
    pass('style:scaffold', `art/style.json: own style profile "${name}"`);
  }

  const refs = Array.isArray(style?.references) ? style.references.filter((r) => typeof r === 'string' && r.trim()) : [];
  if (refs.length === 0) {
    const message =
      'art/style.json references[] is empty — the locked vision anchors (game-art Step 1b) are ' +
      'what every generation call is conditioned on; a text-only lock does not hold a style';
    if (hasArt) fail('style:refs', `${message} (and this game already ships generated art)`);
    else warn('style:refs', message);
  } else {
    // Anchors are repo-root-relative by contract (art-director.md: the forge
    // middleware injects them as `input` on every call from the repo root).
    const missing = refs.filter((r) => !existsSync(path.join(ROOT, r)) && !existsSync(path.join(dir, r)));
    const misrooted = refs.filter((r) => !existsSync(path.join(ROOT, r)) && existsSync(path.join(dir, r)));
    if (missing.length > 0) fail('style:refs', `art/style.json references missing anchor file(s): ${missing.join(', ')}`);
    else pass('style:refs', `art/style.json: ${refs.length} locked vision anchor(s) on disk`);
    if (misrooted.length > 0) {
      warn(
        'style:refs-root',
        `art/style.json anchor path(s) are game-relative, not repo-root-relative: ${misrooted.join(', ')}`,
      );
    }
  }

  if (scaffold && Array.isArray(style?.palette) && Array.isArray(scaffold.palette) && style.palette.join() === scaffold.palette.join()) {
    warn('style:palette', 'art/style.json keeps the scaffold palette verbatim — palette QC will pass while the game looks like the template');
  }
}

/** Relative path -> source text for every `.ts` file under `root`. */
function tsSources(root) {
  const out = new Map();
  if (!existsSync(root)) return out;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.ts')) out.set(path.relative(root, full), readFileSync(full, 'utf8'));
    }
  };
  walk(root);
  return out;
}

/**
 * The generated registry (`src/data/art.ts`) as data: one row per loaded
 * texture and one entry per `TEXTURE`/`ANIM`/`ICON` alias, with the
 * generator's `// not shipped: group '<g>' pruned` flag preserved.
 */
function parseArtRegistry(text) {
  const listBody = (name) => {
    const m = new RegExp(`export const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\n\\] as const;`).exec(text);
    return m ? m[1] : '';
  };
  const mapBody = (name) => {
    const m = new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\n\\} as const;`).exec(text);
    return m ? m[1] : '';
  };
  const rows = [];
  for (const list of ['SPRITES', 'IMAGES']) {
    for (const r of listBody(list).matchAll(/\{\s*key:\s*'([^']+)'[^}]*?path:\s*'([^']+)'/g)) {
      rows.push({ key: r[1], file: r[2] });
    }
  }
  const aliases = [];
  for (const kind of ['TEXTURE', 'ANIM']) {
    for (const a of mapBody(kind).matchAll(/^\s*'?([\w$-]+)'?:\s*'([^']+)',(.*)$/gm)) {
      aliases.push({ kind, alias: a[1], key: a[2], pruned: /not shipped/.test(a[3]) });
    }
  }
  for (const a of mapBody('ICON').matchAll(/^\s*'?([\w$-]+)'?:\s*\{\s*key:\s*'([^']+)',[^}]*\},(.*)$/gm)) {
    aliases.push({ kind: 'ICON', alias: a[1], key: a[2], pruned: /not shipped/.test(a[3]) });
  }
  return { rows, aliases };
}

/**
 * A template literal like `enemy-${id}-death` as the key pattern it builds, or
 * null when the literal is not key-shaped. Both guards are load-bearing: a
 * hole-only literal such as `${y}-${m}-${d}` (a date) compiles to `\w+-\w+-\w+`
 * and would "consume" every three-segment art key in the registry, which is
 * how a first cut of this check reported zero dead art against 37 unplayed
 * animations. So the skeleton must be key-shaped (letters, digits, `_`, `-`)
 * and must carry a literal 3+ letter run of its own.
 */
function literalPattern(lit) {
  const HOLE = '\u0000';
  const skeleton = lit.replace(/\$\{[^{}]*\}/g, HOLE);
  const literalText = skeleton.split(HOLE).join('');
  if (!/^[A-Za-z0-9_-]*$/.test(literalText) || !/[A-Za-z]{3}/.test(literalText)) return null;
  const escaped = skeleton.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.split(HOLE).join('[\\w-]+')}$`);
}

/**
 * "No procedural art for gameplay" was the pitch, and the build shipped the
 * TEMPLATE's `props.ts` live: its four placeholder prop textures did not exist
 * in this game's registry, so the arena drew its tinted `tex-square` fallback
 * while 72 authored prop cells sat unplaced. Nothing caught it but a CDP
 * display-list dump, because §19's acceptance was prose checkboxes.
 *
 * So: every texture a gameplay def names must resolve to a row in the
 * generated registry, and every registry row's file must exist. An unresolved
 * key is not a missing texture — it is the procedural fallback, silently.
 *
 * The dual (generated art nothing names) is reported as a warning: keys are
 * also composed at runtime (`enemy-${id}-death`), so template-literal patterns
 * and plain mentions both count as a consumer and what is left is a list to
 * read, not a verdict.
 */
function checkArtWiring(dir) {
  const artTsPath = path.join(dir, 'src', 'data', 'art.ts');
  if (!existsSync(artTsPath)) {
    fail('wiring:registry', 'src/data/art.ts missing — regenerate it with `node scripts/gen-art-registry.mjs`');
    return;
  }
  const { rows, aliases } = parseArtRegistry(readFileSync(artTsPath, 'utf8'));
  if (rows.length === 0) {
    fail('wiring:registry', 'src/data/art.ts declares no SPRITES/IMAGES rows — nothing loads any generated art');
    return;
  }
  const loaded = new Set(rows.map((r) => r.key));
  const orphanFiles = rows.filter((r) => !existsSync(path.join(dir, 'public', r.file)));
  check(
    orphanFiles.length === 0,
    'wiring:files',
    `art registry: all ${rows.length} row(s) point at a file on disk`,
    `art registry names ${orphanFiles.length} missing file(s): ${orphanFiles.slice(0, 6).map((r) => `${r.key} -> ${r.file}`).join(', ')}${orphanFiles.length > 6 ? ', ...' : ''}`,
  );

  const sources = tsSources(path.join(dir, 'src'));
  sources.delete(path.join('data', 'art.ts'));

  // Texture keys named by gameplay data: PropDef/DecalDef/EnemyDef `texture:`,
  // and `ArtSlot` object literals (`art: { key }`, `{ key, frame }`).
  const named = new Map();
  const noteRef = (key, where) => {
    const at = named.get(key);
    if (at) at.add(where);
    else named.set(key, new Set([where]));
  };
  for (const [file, text] of sources) {
    for (const m of text.matchAll(/\btexture:\s*'([^']+)'/g)) noteRef(m[1], file);
    for (const m of text.matchAll(/\b(?:art|artSlot|slot|icon)\s*:\s*\{\s*key:\s*'([^']+)'/g)) noteRef(m[1], file);
    for (const m of text.matchAll(/\{\s*key:\s*'([^']+)'\s*,\s*frame\s*:/g)) noteRef(m[1], file);
  }
  const unresolved = [...named].filter(([key]) => !loaded.has(key));
  check(
    unresolved.length === 0,
    'wiring:procedural',
    `art wiring: all ${named.size} texture key(s) named by gameplay data resolve to generated art`,
    `${unresolved.length} gameplay texture key(s) resolve to NO generated art, so the procedural ` +
      `fallback is drawn instead: ${unresolved.map(([key, at]) => `'${key}' (${[...at].join(', ')})`).join('; ')}`,
  );

  // Alias member access: a name absent from the emitted maps cannot compile,
  // and one flagged `not shipped` renders nothing at runtime.
  const byKind = { TEXTURE: new Map(), ANIM: new Map(), ICON: new Map() };
  for (const a of aliases) byKind[a.kind].set(a.alias, a);
  const missingAlias = [];
  const prunedAlias = [];
  for (const [file, text] of sources) {
    for (const m of text.matchAll(/\b(TEXTURE|ANIM|ICON)(?:\.([A-Za-z_$][\w$]*)|\[\s*'([^']+)'\s*\])/g)) {
      const alias = m[2] ?? m[3];
      const entry = byKind[m[1]].get(alias);
      if (!entry) missingAlias.push(`${m[1]}.${alias} (${file})`);
      else {
        if (entry.pruned) prunedAlias.push(`${m[1]}.${alias} (${file})`);
        noteRef(entry.key, `alias ${m[1]}.${alias}`);
      }
    }
  }
  check(
    missingAlias.length === 0,
    'wiring:aliases',
    'art wiring: every TEXTURE/ANIM/ICON alias the code reads exists in the registry',
    `code reads ${missingAlias.length} art alias(es) the registry does not declare (these are TS2339 ` +
      `errors): ${[...new Set(missingAlias)].join(', ')}`,
  );
  if (prunedAlias.length > 0) {
    warn(
      'wiring:pruned',
      `code reads ${new Set(prunedAlias).size} alias(es) whose art group was pruned — those draw the ` +
        `procedural fallback: ${[...new Set(prunedAlias)].join(', ')}`,
    );
  }

  const patterns = [];
  for (const text of sources.values()) {
    for (const m of text.matchAll(/`([^`\\]*\$\{[^`]*)`/g)) {
      const rx = literalPattern(m[1]);
      if (rx !== null) patterns.push(rx);
    }
  }
  const texts = [...sources.values()];
  const dead = rows
    .map((r) => r.key)
    .filter((key) => !named.has(key) && !patterns.some((p) => p.test(key)) && !texts.some((t) => t.includes(key)));
  if (dead.length > 0) {
    warn(
      'wiring:dead-art',
      `${dead.length}/${rows.length} generated asset(s) are loaded but named by nothing in src/: ` +
        `${dead.slice(0, 12).join(', ')}${dead.length > 12 ? `, ... (+${dead.length - 12})` : ''}`,
    );
  } else {
    pass('wiring:dead-art', `art wiring: every one of the ${rows.length} loaded asset(s) is named by src/`);
  }
}

/** Total bytes of every file under `root`, recursively; 0 when it does not exist. */
function treeBytes(root) {
  if (!existsSync(root)) return 0;
  let total = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) total += treeBytes(full);
    else if (entry.isFile()) total += statSync(full).size;
  }
  return total;
}

/**
 * Generated audio is optional — `core/audio.ts` synthesises every voice and
 * `core/music.ts` the score, so an empty tree is a pass, not a gap. What is
 * checked is weight: music loops are the heaviest thing a game downloads.
 */
function checkAudio(dir) {
  const bytes = treeBytes(path.join(dir, 'public', 'assets', 'audio'));
  if (bytes === 0) {
    pass('audio', 'audio: synth only — no generated tracks or samples shipped');
    return;
  }
  const mb = bytes / (1024 * 1024);
  if (mb <= AUDIO_BUDGET_MB) pass('audio', `audio: ${mb.toFixed(1)} MB of generated tracks/samples, budget ${AUDIO_BUDGET_MB} MB`);
  else warn('audio', `audio: ${mb.toFixed(1)} MB of generated tracks/samples over the ${AUDIO_BUDGET_MB} MB budget — re-encode the music loops (30-60s mono at ~96 kbps)`);
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
    console.log(`\nrelease-check ${slug ?? '(no slug)'}\n`);
    for (const f of findings) console.log(`${icon[f.level]} ${f.message}`);
    if (extra.error) console.log(`FAIL  ${extra.error}`);
    console.log(
      ok
        ? `\nPASS — ${extra.variantOf ? `${slug} is a valid alternate build of ${extra.variantOf} — it ships when that game ships` : `${slug} is release-ready`}${warnings.length ? ` (${warnings.length} warning(s))` : ''}\n`
        : `\nNOT RELEASABLE — ${errors.length + (extra.error ? 1 : 0)} blocking issue(s), ${warnings.length} warning(s)\n`,
    );
  }
  process.exit(exitCode);
}

if (!slug) {
  report(1, { error: 'usage: node scripts/release-check.mjs <slug> [--json]' });
}

const dir = path.join(ROOT, 'games', slug);
if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  report(1, { error: `no such game: games/${slug}/` });
}

const manifestPath = path.join(dir, 'game.json');
if (!existsSync(manifestPath)) {
  report(1, { error: `games/${slug}/game.json missing` });
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (err) {
  report(1, { error: `games/${slug}/game.json is not valid JSON: ${err.message}` });
}

// A variant is a second playable build of another game, not a storefront
// entry: no card, no store page, no independent release. The parent's
// release-check decides whether the pair ships, so the storefront gates
// (status, playtest, screenshots, cover, cert) genuinely do not apply — only
// the checks that decide whether this build is honest and playable. Running
// the full list here would report blockers that can never legitimately be
// cleared: you cannot playtest-sign-off a build that is frozen by definition.
if (typeof manifest.variantOf === 'string' && manifest.variantOf) {
  if (!existsSync(path.join(ROOT, 'games', manifest.variantOf))) {
    fail('variant:parent', `game.json: variantOf "${manifest.variantOf}" is not a game in games/`);
  } else {
    pass('variant:parent', `game.json: alternate build of ${manifest.variantOf}`);
  }
  const versionLabel = typeof manifest.versionLabel === 'string' ? manifest.versionLabel.trim() : '';
  if (!versionLabel) {
    fail('variant:label', 'game.json: "versionLabel" is required on a variant — it names the button on the parent\'s page');
  } else {
    pass('variant:label', `game.json: versionLabel "${versionLabel}"`);
  }
  checkWorkspaceLock(slug);
  checkPlaceholders(manifest, dir, slug);
  checkStyleLock(dir);
  checkArt(manifest, dir);
  checkArtWiring(dir);
  checkFuzz(dir);
  checkAudio(dir);
  report(findings.some((f) => f.level === 'error') ? 1 : 0, { variantOf: manifest.variantOf });
}

checkManifest(manifest);
checkWorkspaceLock(slug);
checkPlaytest(manifest);
checkCert(manifest, dir);
checkFuzz(dir);
checkScreenshots(manifest, dir);
checkPlaceholders(manifest, dir, slug);
checkCover(manifest, dir, slug);
checkStyleLock(dir);
checkArt(manifest, dir);
checkArtWiring(dir);
checkAudio(dir);

report(findings.some((f) => f.level === 'error') ? 1 : 0);
