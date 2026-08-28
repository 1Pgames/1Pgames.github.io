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
 *   art        generated assets must not be a byte-copy of template art
 *   store      shots/og.png presence (warning)
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_ART = path.join(ROOT, 'template', 'public', 'assets', 'generated');

const CYRILLIC = /[\u0400-\u04FF]/;
const SCAFFOLD_HOWTO = 'Joystick to move. Survive the run.';
/** Share of byte-identical template art a released game may still ship. */
const ART_REUSE_LIMIT = { arena: 0.9, default: 0.6 };

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
        ? `\nPASS — ${slug} is release-ready${warnings.length ? ` (${warnings.length} warning(s))` : ''}\n`
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

checkManifest(manifest);
checkScreenshots(manifest, dir);
checkPlaceholders(manifest, dir, slug);
checkCover(manifest, dir, slug);
checkArt(manifest, dir);

report(findings.some((f) => f.level === 'error') ? 1 : 0);
