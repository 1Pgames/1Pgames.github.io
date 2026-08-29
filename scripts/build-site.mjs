#!/usr/bin/env node
/**
 * Assembles the deployable GitHub Pages tree in `_site/`:
 *
 *   /                     store-front catalog (cards rendered at build time)
 *   /game/<slug>/         per-game store page: cover, description, original
 *                         prompt, preview clip, screenshots gallery, PLAY button
 *   /play/<slug>/         the built game (vite dist)
 *   /media/<slug>/        cover, screenshots, og image and preview clip
 *   /404.html /sitemap.xml /robots.txt /favicon.svg
 *
 * Data source: games/<slug>/game.json (written by scripts/new-game.sh).
 * Only games with `"status": "released"` are published; drafts stay off the
 * shelf until `node scripts/release-check.mjs <slug>` is green.
 *
 * Flags:
 *   --no-build         reuse existing games/<slug>/dist (local iteration)
 *   --include-drafts   also publish draft games (local preview; they are
 *                      marked noindex and kept out of the sitemap)
 *
 * Vite runs only when a game actually changed: the hash of its sources is
 * stored in games/<slug>/dist/.buildhash and compared on the next run.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAMES = path.join(ROOT, 'games');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, '_site');
const ORIGIN = 'https://1pgames.github.io';
const TAGLINE = 'One prompt in, one finished browser game out — a new generated game, playable in seconds, with its original prompt printed on the box.';
const noBuild = process.argv.includes('--no-build');
const includeDrafts = process.argv.includes('--include-drafts');

const esc = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Optional site/config.json — currently only { "goatcounter": "<count url>" }. */
function loadConfig() {
  const p = path.join(SITE, 'config.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (err) {
    console.warn(`warn: site/config.json ignored (${err.message})`);
    return {};
  }
}
const CONFIG = loadConfig();
const ANALYTICS = CONFIG.goatcounter
  ? `\n  <script data-goatcounter="${esc(CONFIG.goatcounter)}" async src="//gc.zgo.at/count.js"></script>`
  : '';

/** games/<slug>/game.json, newest first. */
function loadGames() {
  if (!existsSync(GAMES)) return [];
  const out = [];
  for (const slug of readdirSync(GAMES).sort()) {
    const manifestPath = path.join(GAMES, slug, 'game.json');
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      // One broken draft must not take the whole catalog down. A RELEASED
      // game with a corrupt manifest is still caught before deploy: the CI
      // verify job's release-check loop parses game.json itself and fails.
      console.warn(`skip ${slug}: invalid game.json (${err.message})`);
      continue;
    }
    const status = manifest.status ?? 'draft';
    if (status !== 'released' && !includeDrafts) {
      console.log(`skip ${slug}: status "${status}" (use --include-drafts to preview)`);
      continue;
    }
    out.push({ ...manifest, status, slug: manifest.slug ?? slug, dir: path.join(GAMES, slug) });
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.slug.localeCompare(b.slug));
}

const FAMILY_LABEL = {
  arena: 'Arena survivor', board: 'Board puzzle', hyper: 'Hypercasual', idle: 'Idle tycoon',
  table: 'Table & dice', word: 'Word & trivia', side: 'Platformer', track: 'Racing',
};

/**
 * What actually exists on disk for a game, resolved once so both the pages and
 * the media copy step agree. `ogImage` is the absolute social-card URL.
 */
function mediaOf(g) {
  const shots = (g.screenshots ?? []).filter((s) => existsSync(path.join(g.dir, s)));
  for (const s of g.screenshots ?? []) {
    if (!shots.includes(s)) console.warn(`warn ${g.slug}: screenshot missing: ${s}`);
  }
  const og = existsSync(path.join(g.dir, 'shots', 'og.png'));
  const preview = existsSync(path.join(g.dir, 'shots', 'preview.webm'));
  const firstPng = shots.map((s) => path.basename(s)).find((s) => s.toLowerCase().endsWith('.png'));
  const card = og ? 'og.png' : firstPng;
  return { shots, og, preview, ogImage: card ? `${ORIGIN}/media/${g.slug}/${card}` : null };
}

function page({
  title, description, body, depth, canonical,
  image = null, noindex = false, search = false, extraHead = '',
}) {
  const rel = depth === null ? '/' : '../'.repeat(depth);
  const head = [
    `<meta name="description" content="${esc(description)}" />`,
    noindex ? '<meta name="robots" content="noindex" />' : '',
    `<link rel="canonical" href="${esc(canonical)}" />`,
    `<link rel="icon" type="image/svg+xml" href="${rel}favicon.svg" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="1PGAMES" />',
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(canonical)}" />`,
    image ? `<meta property="og:image" content="${esc(image)}" />` : '',
    image ? '<meta name="twitter:card" content="summary_large_image" />' : '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    image ? `<meta name="twitter:image" content="${esc(image)}" />` : '',
  ]
    .filter(Boolean)
    .map((tag) => `\n  ${tag}`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>${esc(title)}</title>${head}
  <link rel="stylesheet" href="${rel}styles.css" />${extraHead}${ANALYTICS}
</head>
<body>
  <header class="site">
    <div class="wrap">
      <a class="logo" href="${rel}">1P<b>GAMES</b></a>
      <span class="tagline">one prompt &rarr; one game, daily</span>
      ${search ? '<input class="search" type="search" placeholder="Search games..." />' : ''}
    </div>
  </header>
  ${body}
  <footer class="site">
    <div class="wrap"><span>Every game here was generated end-to-end from a single prompt.</span></div>
  </footer>
</body>
</html>
`;
}

const draftBadge = (g) => (g.status === 'released' ? '' : '<span class="badge draft">Draft</span>');

function heroHtml(g) {
  const cover = `media/${g.slug}/${g.cover}`;
  return `
  <section class="hero">
    <div class="bg" style="background-image:url('${cover}')"></div>
    <div class="info">
      <span class="kicker">LATEST RELEASE</span>
      <h1>${esc(g.title)}</h1>
      ${g.prompt ? `<p class="prompt-quote">&ldquo;${esc(g.prompt)}&rdquo;</p>` : ''}
      <div style="display:flex; gap:12px; margin-top:6px;">
        <a class="btn" href="play/${g.slug}/">&#9654; Play</a>
        <a class="btn ghost" href="game/${g.slug}/">Game page</a>
      </div>
    </div>
    <a class="cover" href="game/${g.slug}/"><img src="${cover}" alt="${esc(g.title)} cover" /></a>
  </section>`;
}

function cardHtml(g) {
  const label = FAMILY_LABEL[g.family] ?? g.family;
  const text = `${g.title} ${g.genre} ${label} ${g.prompt}`.toLowerCase();
  return `
    <a class="card" href="game/${g.slug}/" data-family="${esc(g.family)}" data-text="${esc(text)}">
      <img class="cover" src="media/${g.slug}/${g.cover}" alt="${esc(g.title)} cover" loading="lazy" />
      <span class="play-mini">&#9654; Play</span>
      <div class="meta">
        <span class="title">${esc(g.title)}</span>
        <span class="sub"><span class="badge">${esc(label)}</span><span>${esc(g.date)}</span>${draftBadge(g)}</span>
        ${g.prompt ? `<span class="prompt-preview">&ldquo;${esc(g.prompt)}&rdquo;</span>` : ''}
      </div>
    </a>`;
}

function indexHtml(games, media) {
  const families = [...new Set(games.map((g) => g.family))];
  const chips = ['<button class="chip active" data-family="all">All</button>']
    .concat(families.map((f) => `<button class="chip" data-family="${esc(f)}">${esc(FAMILY_LABEL[f] ?? f)}</button>`))
    .join('\n      ');
  const body =
    games.length === 0
      ? `
  <main class="wrap">
    <section class="hero" style="grid-template-columns: 1fr; min-height: 380px;">
      <div class="info" style="align-items: center; text-align: center;">
        <span class="kicker">OPENING SOON</span>
        <h1>The first release is on its way</h1>
        <p class="prompt-quote" style="border: 0; padding: 0;">
          Every game here starts as a single prompt and ships the same day &mdash;
          fully playable, balance-gated, with its original prompt on the box.
        </p>
      </div>
    </section>
  </main>`
      : `
  <main class="wrap">
    ${heroHtml(games[0])}
    <div class="chips">
      ${chips}
    </div>
    <div class="grid">
      ${games.map(cardHtml).join('\n')}
    </div>
    <p class="empty" style="display:none">Nothing matches that filter.</p>
  </main>
  <script src="catalog.js" defer></script>`;
  return page({
    title: '1PGAMES — one prompt, one game',
    description: TAGLINE,
    body,
    depth: 0,
    canonical: `${ORIGIN}/`,
    image: games.length ? media.get(games[0].slug).ogImage : null,
    search: games.length > 0,
  });
}

function storeHtml(g, m) {
  const label = FAMILY_LABEL[g.family] ?? g.family;
  const cover = `../../media/${g.slug}/${g.cover}`;
  const shots = m.shots
    .map((s) => `<img src="../../media/${g.slug}/${path.basename(s)}" alt="${esc(g.title)} screenshot" loading="lazy" />`)
    .join('\n        ');
  const preview = m.preview
    ? `
    <section class="preview-clip">
      <video class="preview" src="../../media/${g.slug}/preview.webm" autoplay muted loop playsinline
             poster="${cover}" aria-label="${esc(g.title)} gameplay preview"></video>
    </section>`
    : '';
  const description = g.description || `${g.title} — a ${label.toLowerCase()} generated from a single prompt.`;
  const body = `
  <main class="wrap">
    <nav class="crumbs"><a href="../../">&larr; All games</a></nav>
    <section class="store">
      <div class="cover-col"><img src="${cover}" alt="${esc(g.title)} cover" /></div>
      <div>
        <h1>${esc(g.title)}</h1>
        <div class="meta-row">
          <span class="badge">${esc(label)}</span>
          ${g.genre && g.genre !== g.family ? `<span class="badge dim">${esc(g.genre)}</span>` : ''}
          <span class="date">${esc(g.date)}</span>
          ${draftBadge(g)}
        </div>
        ${g.description ? `<p class="desc">${esc(g.description)}</p>` : ''}
        ${g.prompt ? `
        <div class="prompt-block">
          <div class="label">Original prompt</div>
          <p>&ldquo;${esc(g.prompt)}&rdquo;</p>
        </div>` : ''}
        <div class="cta">
          <a class="btn" href="../../play/${g.slug}/">&#9654; Play in browser</a>
        </div>
      </div>
    </section>${preview}
    ${shots ? `
    <section class="shots">
      <h2>Screenshots</h2>
      <div class="row">
        ${shots}
      </div>
    </section>` : ''}
  </main>
  <div class="lightbox"><img alt="screenshot" /></div>
  <script src="../../lightbox.js" defer></script>`;
  return page({
    title: `${g.title} — 1PGAMES`,
    description,
    body,
    depth: 2,
    canonical: `${ORIGIN}/game/${g.slug}/`,
    image: m.ogImage,
    noindex: g.status !== 'released',
  });
}

function notFoundHtml() {
  const body = `
  <main class="wrap">
    <section class="hero" style="grid-template-columns: 1fr; min-height: 340px;">
      <div class="info" style="align-items: center; text-align: center;">
        <span class="kicker">404</span>
        <h1>This cabinet is empty</h1>
        <p class="prompt-quote" style="border: 0; padding: 0;">
          The page you asked for is not on the shelf. The games are all one click away.
        </p>
        <div style="margin-top: 6px;"><a class="btn" href="/">Back to the catalog</a></div>
      </div>
    </section>
  </main>`;
  // depth: null -> root-absolute asset URLs, because 404.html is served from
  // any path depth GitHub Pages happens to miss on.
  return page({
    title: 'Not found — 1PGAMES',
    description: 'This page does not exist on 1PGAMES.',
    body,
    depth: null,
    canonical: `${ORIGIN}/404.html`,
    noindex: true,
  });
}

function sitemapXml(games) {
  const urls = [`${ORIGIN}/`];
  for (const g of games) {
    if (g.status !== 'released') continue;
    urls.push(`${ORIGIN}/game/${g.slug}/`, `${ORIGIN}/play/${g.slug}/`);
  }
  const body = urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

/** Root lockfile: shared deps change what vite emits, so it seeds every hash. */
const LOCK_HASH = (() => {
  const lock = path.join(ROOT, 'package-lock.json');
  return existsSync(lock) ? createHash('sha256').update(readFileSync(lock)).digest('hex') : 'no-lock';
})();

/**
 * Content hash of a game's sources (dist/, node_modules/ and vite caches
 * excluded) plus the root lockfile. Identical hash => the previous dist/ is
 * still correct and vite can be skipped.
 */
function sourceHash(dir) {
  const skip = new Set(['dist', 'node_modules', '.vite', '.git', '.DS_Store']);
  const hash = createHash('sha256').update(LOCK_HASH).update('\0');
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (skip.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        hash.update(path.relative(dir, full));
        hash.update('\0');
        hash.update(readFileSync(full));
        hash.update('\0');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

// --- assemble -------------------------------------------------------------

const games = loadGames();
const media = new Map(games.map((g) => [g.slug, mediaOf(g)]));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const asset of ['styles.css', 'catalog.js', 'lightbox.js', 'favicon.svg']) {
  cpSync(path.join(SITE, asset), path.join(OUT, asset));
}
writeFileSync(path.join(OUT, 'index.html'), indexHtml(games, media));
writeFileSync(path.join(OUT, '404.html'), notFoundHtml());
writeFileSync(path.join(OUT, 'sitemap.xml'), sitemapXml(games));
writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
writeFileSync(path.join(OUT, '.nojekyll'), '');

for (const g of games) {
  const dist = path.join(g.dir, 'dist');
  const hashFile = path.join(dist, '.buildhash');

  // 1. Build the game (vite) unless nothing changed since the last build.
  if (!noBuild) {
    const hash = sourceHash(g.dir);
    const cached = existsSync(hashFile) ? readFileSync(hashFile, 'utf8').trim() : null;
    if (cached === hash && existsSync(path.join(dist, 'index.html'))) {
      console.log(`cached ${g.slug} (sources unchanged)`);
    } else {
      console.log(`build ${g.slug}`);
      execSync(`npm run build -w ${g.slug}`, { cwd: ROOT, stdio: 'inherit' });
      writeFileSync(hashFile, `${hash}\n`);
    }
  }
  if (!existsSync(dist)) throw new Error(`${g.slug}: dist/ missing — run without --no-build`);
  cpSync(dist, path.join(OUT, 'play', g.slug), {
    recursive: true,
    filter: (src) => path.basename(src) !== '.buildhash',
  });
  // The play page is the game's own vite build — inject the analytics
  // snippet there too (dist/ never carries it, so re-copies stay
  // idempotent): game sessions count, and in-game
  // `window.goatcounter.count()` events have count.js to talk to.
  if (ANALYTICS) {
    const playIndex = path.join(OUT, 'play', g.slug, 'index.html');
    const html = readFileSync(playIndex, 'utf8');
    if (html.includes('</head>')) {
      writeFileSync(playIndex, html.replace('</head>', `${ANALYTICS}\n</head>`));
    } else {
      console.warn(`warn ${g.slug}: play index.html has no </head>; analytics not injected`);
    }
  }

  // 2. Store media: cover from public/, screenshots + og/preview from shots/.
  const m = media.get(g.slug);
  const mediaDir = path.join(OUT, 'media', g.slug);
  mkdirSync(mediaDir, { recursive: true });
  const coverSrc = path.join(g.dir, 'public', g.cover);
  if (existsSync(coverSrc)) cpSync(coverSrc, path.join(mediaDir, g.cover));
  else console.warn(`warn ${g.slug}: cover missing: public/${g.cover}`);
  for (const s of m.shots) cpSync(path.join(g.dir, s), path.join(mediaDir, path.basename(s)));
  if (m.og) cpSync(path.join(g.dir, 'shots', 'og.png'), path.join(mediaDir, 'og.png'));
  if (m.preview) cpSync(path.join(g.dir, 'shots', 'preview.webm'), path.join(mediaDir, 'preview.webm'));

  // 3. Store page.
  const pageDir = path.join(OUT, 'game', g.slug);
  mkdirSync(pageDir, { recursive: true });
  writeFileSync(path.join(pageDir, 'index.html'), storeHtml(g, m));
}

console.log(`\n_site ready: ${games.length} game(s) -> ${OUT}`);
