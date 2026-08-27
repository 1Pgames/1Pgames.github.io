#!/usr/bin/env node
/**
 * Assembles the deployable GitHub Pages tree in `_site/`:
 *
 *   /                     store-front catalog (cards rendered at build time)
 *   /game/<slug>/         per-game store page: cover, description, original
 *                         prompt, screenshots gallery, PLAY button
 *   /play/<slug>/         the built game (vite dist)
 *   /media/<slug>/        cover + screenshots referenced by the pages
 *
 * Data source: games/<slug>/game.json (written by scripts/new-game.sh).
 * Flags: --no-build  reuse existing games/<slug>/dist (local iteration).
 */
import { execSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAMES = path.join(ROOT, 'games');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, '_site');
const noBuild = process.argv.includes('--no-build');

const esc = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** games/<slug>/game.json, newest first. */
function loadGames() {
  if (!existsSync(GAMES)) return [];
  const out = [];
  for (const slug of readdirSync(GAMES).sort()) {
    const manifestPath = path.join(GAMES, slug, 'game.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    out.push({ ...manifest, slug: manifest.slug ?? slug, dir: path.join(GAMES, slug) });
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.slug.localeCompare(b.slug));
}

const FAMILY_LABEL = {
  arena: 'Arena survivor', board: 'Board puzzle', hyper: 'Hypercasual', idle: 'Idle tycoon',
  table: 'Table & dice', word: 'Word & trivia', side: 'Platformer', track: 'Racing',
};

function page({ title, body, depth, extraHead = '' }) {
  const rel = '../'.repeat(depth);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="${rel}styles.css" />${extraHead}
</head>
<body>
  <header class="site">
    <div class="wrap">
      <a class="logo" href="${rel}">1P<b>GAMES</b></a>
      <span class="tagline">one prompt &rarr; one game, daily</span>
      ${depth === 0 ? '<input class="search" type="search" placeholder="Search games..." />' : ''}
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
        <span class="sub"><span class="badge">${esc(label)}</span><span>${esc(g.date)}</span></span>
        ${g.prompt ? `<span class="prompt-preview">&ldquo;${esc(g.prompt)}&rdquo;</span>` : ''}
      </div>
    </a>`;
}

function indexHtml(games) {
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
          Every game here starts as a single prompt and ships the same day —
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
  return page({ title: '1PGAMES — one prompt, one game', body, depth: 0 });
}

function storeHtml(g) {
  const label = FAMILY_LABEL[g.family] ?? g.family;
  const cover = `../../media/${g.slug}/${g.cover}`;
  const shots = (g.screenshots ?? [])
    .map((s) => `<img src="../../media/${g.slug}/${path.basename(s)}" alt="${esc(g.title)} screenshot" loading="lazy" />`)
    .join('\n        ');
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
    </section>
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
  return page({ title: `${g.title} — 1PGAMES`, body, depth: 2 });
}

// --- assemble -------------------------------------------------------------

const games = loadGames();
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const asset of ['styles.css', 'catalog.js', 'lightbox.js']) {
  cpSync(path.join(SITE, asset), path.join(OUT, asset));
}
writeFileSync(path.join(OUT, 'index.html'), indexHtml(games));
writeFileSync(path.join(OUT, '.nojekyll'), '');

for (const g of games) {
  // 1. Build the game (vite) unless we are iterating on the site only.
  if (!noBuild) {
    console.log(`build ${g.slug}`);
    execSync(`npm run build -w ${g.slug}`, { cwd: ROOT, stdio: 'inherit' });
  }
  const dist = path.join(g.dir, 'dist');
  if (!existsSync(dist)) throw new Error(`${g.slug}: dist/ missing — run without --no-build`);
  cpSync(dist, path.join(OUT, 'play', g.slug), { recursive: true });

  // 2. Store media: cover from public/, screenshots from shots/.
  const media = path.join(OUT, 'media', g.slug);
  mkdirSync(media, { recursive: true });
  const coverSrc = path.join(g.dir, 'public', g.cover);
  if (existsSync(coverSrc)) cpSync(coverSrc, path.join(media, g.cover));
  for (const s of g.screenshots ?? []) {
    const src = path.join(g.dir, s);
    if (existsSync(src)) cpSync(src, path.join(media, path.basename(s)));
    else console.warn(`warn ${g.slug}: screenshot missing: ${s}`);
  }

  // 3. Store page.
  const pageDir = path.join(OUT, 'game', g.slug);
  mkdirSync(pageDir, { recursive: true });
  writeFileSync(path.join(pageDir, 'index.html'), storeHtml(g));
}

console.log(`\n_site ready: ${games.length} game(s) -> ${OUT}`);
