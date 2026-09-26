#!/usr/bin/env node
/**
 * Assembles the deployable GitHub Pages tree in `_site/`:
 *
 *   /                     store-front catalog (cards rendered at build time;
 *                         a game with variant builds shows its versions)
 *   /game/<slug>/         per-game store page: one tab per version (own
 *                         preview clip, cover, screenshots, note, PLAY
 *                         button), "What changed", original prompt.
 *                         /game/<variant-slug>/ is the same page opened on
 *                         that variant's tab.
 *   /play/<slug>/         the built game (vite dist), one per version
 *   /media/<slug>/        cover, screenshots, og image and preview clip,
 *                         one folder per version
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
    // A variant is not independently releasable: it ships when its parent
    // ships. Filtering it on its own status would let a released game quietly
    // lose one of its play buttons, so the parent's decision governs and the
    // orphan check below drops it if that parent never made the cut.
    if (!manifest.variantOf && status !== 'released' && !includeDrafts) {
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
 * What actually exists on disk for a game (or one of its variant builds),
 * resolved once so both the pages and the media copy step agree. Every build
 * owns its media under /media/<its-slug>/. `ogImage` is the absolute
 * social-card URL; `poster` is the 9:16 still shown before the preview loop.
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
  return {
    shots,
    og,
    preview,
    poster: shots.length ? path.basename(shots[0]) : g.cover,
    ogImage: card ? `${ORIGIN}/media/${g.slug}/${card}` : null,
  };
}

function page({
  title, description, body, depth, canonical,
  image = null, noindex = false, search = false, extraHead = '', scripts = [],
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
  <link rel="stylesheet" href="${rel}styles.css" />${extraHead}${ANALYTICS}${scripts.map((s) => `\n  <script src="${rel}${s}" defer></script>`).join('')}
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="site">
    <div class="wrap">
      <a class="logo" href="${rel}" aria-label="1PGAMES home">1P<b>GAMES</b></a>
      <span class="tagline">one prompt &rarr; one game</span>
      ${search ? '<input class="search" type="search" placeholder="Search games" aria-label="Search games" />' : ''}
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
const familyLabel = (g) => FAMILY_LABEL[g.family] ?? g.family;
const genreBadge = (g) =>
  g.genre && g.genre !== g.family && g.genre !== familyLabel(g) ? `<span class="badge dim">${esc(g.genre)}</span>` : '';
const timeTag = (d) => `<time datetime="${esc(d)}">${esc(d)}</time>`;

/**
 * Every playable build of one game, the released (refined) build first.
 *   name   what the tab / chip says: "Refined" for the released build when it
 *          has alternates, the variant's own `versionLabel` otherwise
 *   label  secondary line (the released build's `versionLabel`)
 *   date   `versionDate` (when this build shipped) falling back to `date`
 * A game with no variants yields one entry whose `name` is null — its pages
 * then read exactly like a single-build game, with no version vocabulary.
 */
function versionsOf(g) {
  const all = [g, ...(g.variants ?? [])];
  const multi = all.length > 1;
  return all.map((v, i) => ({
    g: v,
    m: media.get(v.slug),
    primary: i === 0,
    name: i === 0 ? (multi ? 'Refined' : null) : (v.versionLabel ?? v.title),
    label: i === 0 ? (v.versionLabel ?? '') : '',
    date: v.versionDate ?? v.date,
  }));
}

/** "2 versions: [Refined] [AI original]" — each chip opens that version's tab. */
function versionChips(vs, rel) {
  return `<span class="vcount">${vs.length} versions</span>${vs
    .map((v) => `<a class="vchip${v.primary ? ' primary' : ''}" href="${rel}game/${v.g.slug}/">${esc(v.name)}</a>`)
    .join('')}`;
}

function heroHtml(g) {
  const vs = versionsOf(g);
  const multi = vs.length > 1;
  const cover = `media/${g.slug}/${g.cover}`;
  return `
    <section class="hero" aria-labelledby="hero-title">
      <div class="bg" style="background-image:url('${cover}')" aria-hidden="true"></div>
      <div class="info">
        <span class="kicker">Latest release</span>
        <h1 id="hero-title">${esc(g.title)}</h1>
        <div class="meta-row"><span class="badge">${esc(familyLabel(g))}</span>${genreBadge(g)}${draftBadge(g)}</div>
        ${g.description ? `<p class="lede">${esc(g.description)}</p>` : ''}
        ${multi ? `<div class="vrow">${versionChips(vs, '')}</div>` : ''}
        <div class="actions">
          <a class="btn" href="play/${g.slug}/">&#9654; Play${multi ? ' Refined' : ''}</a>
          <a class="btn ghost" href="game/${g.slug}/${multi ? '#compare' : ''}">${multi ? 'Compare versions' : 'Game page'}</a>
        </div>
      </div>
      <a class="cover" href="game/${g.slug}/" tabindex="-1" aria-hidden="true"><img src="${cover}" alt="" /></a>
    </section>`;
}

function cardHtml(g) {
  const vs = versionsOf(g);
  const multi = vs.length > 1;
  const text = [g.title, g.genre, familyLabel(g), g.description, g.prompt, ...vs.map((v) => v.name)]
    .filter(Boolean).join(' ').toLowerCase();
  return `
      <article class="card" data-family="${esc(g.family)}" data-text="${esc(text)}">
        <div class="thumb">
          <img src="media/${g.slug}/${g.cover}" alt="${esc(g.title)} cover" loading="lazy" />
          ${multi ? `<span class="ribbon">${vs.length} versions</span>` : ''}
        </div>
        <div class="meta">
          <h3 class="title"><a class="stretch" href="game/${g.slug}/">${esc(g.title)}</a></h3>
          <div class="sub"><span class="badge">${esc(familyLabel(g))}</span>${timeTag(g.date)}${draftBadge(g)}</div>
          ${g.description ? `<p class="desc">${esc(g.description)}</p>` : ''}
          ${multi ? `<div class="vrow">${versionChips(vs, '')}</div>` : ''}
          <a class="btn small" href="play/${g.slug}/">&#9654; Play${multi ? ' Refined' : ''}</a>
        </div>
      </article>`;
}

/** Centered message block shared by the empty catalog and the 404 page. */
const noticeHtml = (kicker, title, text, cta = '') => `
  <main id="main" class="wrap">
    <section class="notice">
      <span class="kicker">${kicker}</span>
      <h1>${title}</h1>
      <p>${text}</p>${cta}
    </section>
  </main>`;

function indexHtml(games, media) {
  const families = [...new Set(games.map((g) => g.family))];
  const chips = ['<button class="chip active" type="button" data-family="all" aria-pressed="true">All</button>']
    .concat(families.map((f) => `<button class="chip" type="button" data-family="${esc(f)}" aria-pressed="false">${esc(FAMILY_LABEL[f] ?? f)}</button>`))
    .join('\n        ');
  const anyVariants = games.some((g) => g.variants?.length);
  const body =
    games.length === 0
      ? noticeHtml(
          'Opening soon',
          'The first release is on its way',
          'Every game here starts as a single prompt and ships fully playable, balance-gated, with its original prompt on the box.',
        )
      : `
  <main id="main" class="wrap">
    ${heroHtml(games[0])}
    <section class="catalog" aria-labelledby="catalog-title">
      <div class="catalog-head">
        <h2 id="catalog-title">All games</h2>
        ${anyVariants ? `<p class="section-note">Each game starts as one prompt. <b>AI original</b> is the build exactly as the pipeline generated it; <b>Refined</b> is the same game after human playtesting and a production pass.</p>` : ''}
      </div>
      <div class="chips" role="group" aria-label="Filter by family">
        ${chips}
      </div>
      <div class="grid">
        ${games.map(cardHtml).join('\n')}
      </div>
      <p class="empty" hidden>Nothing matches that filter.</p>
    </section>
  </main>`;
  return page({
    title: '1PGAMES — one prompt, one game',
    description: TAGLINE,
    body,
    depth: 0,
    canonical: `${ORIGIN}/`,
    image: games.length ? media.get(games[0].slug).ogImage : null,
    search: games.length > 0,
    scripts: games.length ? ['catalog.js'] : [],
  });
}

/** Document title for a store page with version `v` selected. */
const docTitle = (g, v) => `${g.title}${v.name && !v.primary ? ` — ${v.name}` : ''} — 1PGAMES`;

/**
 * One version's panel: its OWN preview loop, cover, note, play button and
 * screenshots, all from /media/<version-slug>/. Only the selected panel
 * autoplays; the others stay preload="none" until store.js shows them.
 */
function panelHtml(g, v, on, multi) {
  const base = `../../media/${v.g.slug}/`;
  const who = multi ? `${g.title} (${v.name})` : g.title;
  const poster = `${base}${v.m.poster}`;
  const clip = v.m.preview
    ? `<video class="preview" src="${base}preview.webm" poster="${poster}" muted loop playsinline controls ${on ? 'autoplay preload="auto"' : 'preload="none"'} aria-label="${esc(who)} gameplay preview"></video>`
    : `<img class="preview" src="${poster}" alt="${esc(who)} gameplay" />`;
  // A variant's description usually restates the game's pitch and then adds
  // what makes this build different — show only that difference here.
  let extra = v.primary ? '' : (v.g.description ?? '');
  if (extra.startsWith(g.description ?? '\0')) extra = extra.slice(g.description.length).trim();
  const shots = v.m.shots
    .map((s, i) => `<li><button class="shot" type="button" aria-label="Open screenshot ${i + 1} of ${v.m.shots.length}"><img src="${base}${path.basename(s)}" alt="${esc(who)} screenshot ${i + 1}" loading="lazy" /></button></li>`)
    .join('\n            ');
  const human = v.g.playtest?.approved ? `<span class="badge ok">Human playtested</span>` : '';
  const attrs = multi
    ? ` role="tabpanel" id="panel-${esc(v.g.slug)}" aria-labelledby="tab-${esc(v.g.slug)}"${on ? '' : ' hidden'}`
    : '';
  return `
      <div class="panel"${attrs}>
        <div class="panel-media">${clip}</div>
        <div class="panel-info">
          <img class="cover-thumb" src="${base}${v.g.cover}" alt="${esc(who)} cover" />
          <div class="panel-text">
            ${multi ? `<h2 class="panel-title">${esc(v.name)}</h2>` : ''}
            <div class="meta-row">${v.label ? `<span class="badge">${esc(v.label)}</span>` : ''}${human}<span class="date">${v.primary && multi ? 'Updated' : 'Released'} ${timeTag(v.date)}</span></div>
            ${extra ? `<p class="note">${esc(extra)}</p>` : ''}
            ${v.g.versionNote ? `<p class="note">${esc(v.g.versionNote)}</p>` : ''}
            <div class="cta"><a class="btn" href="../../play/${v.g.slug}/">&#9654; Play${multi ? ` ${esc(v.name)}` : ' in browser'}</a></div>
          </div>
        </div>${shots ? `
        <div class="panel-shots">
          <h3>Screenshots</h3>
          <ul class="shots">
            ${shots}
          </ul>
        </div>` : ''}
      </div>`;
}

/** "What changed": older builds on the left, the released build on the right. */
function compareHtml(vs) {
  const col = (v) => `
        <article class="compare-col${v.primary ? ' to' : ''}">
          <h3><a href="../${v.g.slug}/" data-version="${esc(v.g.slug)}">${esc(v.name)}</a></h3>
          <div class="meta-row">${v.label ? `<span class="badge">${esc(v.label)}</span>` : ''}<span class="date">${timeTag(v.date)}</span></div>
          ${v.g.versionNote ? `<p>${esc(v.g.versionNote)}</p>` : ''}
          ${v.primary && v.g.changes?.length ? `<ul class="changes">${v.g.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
        </article>`;
  return `
    <section class="compare" id="compare" aria-labelledby="compare-title">
      <h2 id="compare-title">What changed</h2>
      <div class="compare-grid">${vs.slice(1).map(col).join('')}
        <div class="compare-arrow" aria-hidden="true">&rarr;</div>${col(vs[0])}
      </div>
    </section>`;
}

/**
 * Store page of game `g` with version `selectedSlug` shown. Rendered once per
 * version: /game/<slug>/ opens on the refined build, /game/<variant>/ opens
 * the same page on the variant's tab (store.js swaps tabs in place and keeps
 * the address bar on the matching URL).
 */
function storeHtml(g, selectedSlug = g.slug) {
  const vs = versionsOf(g);
  const multi = vs.length > 1;
  const sel = vs.find((v) => v.g.slug === selectedSlug) ?? vs[0];
  const tabs = multi
    ? `
      <div class="tabs" role="tablist" aria-label="Versions of ${esc(g.title)}">${vs
        .map((v) => `
        <a class="tab" role="tab" id="tab-${esc(v.g.slug)}" href="../${v.g.slug}/" aria-controls="panel-${esc(v.g.slug)}" aria-selected="${v === sel}" data-doc-title="${esc(docTitle(g, v))}">
          <span class="tab-name">${esc(v.name)}</span>
          <span class="tab-sub">${esc([v.label, v.date].filter(Boolean).join(' · '))}</span>
        </a>`)
        .join('')}
      </div>`
    : '';
  const description = sel.g.description || g.description || `${g.title} — a ${familyLabel(g).toLowerCase()} generated from a single prompt.`;
  const body = `
  <main id="main" class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="../../">&larr; All games</a></nav>
    <header class="game-head">
      <h1>${esc(g.title)}</h1>
      <div class="meta-row"><span class="badge">${esc(familyLabel(g))}</span>${genreBadge(g)}<span class="date">First released ${timeTag(g.date)}</span>${draftBadge(g)}</div>
      ${g.description ? `<p class="lede">${esc(g.description)}</p>` : ''}
    </header>
    <section class="versions" aria-label="${multi ? 'Versions' : 'Play'}">${tabs}${vs.map((v) => panelHtml(g, v, v === sel, multi)).join('')}
    </section>${multi ? compareHtml(vs) : ''}${g.prompt ? `
    <section class="prompt-block" aria-labelledby="prompt-title">
      <h2 id="prompt-title">Prompt</h2>
      <p class="quote">&ldquo;${esc(g.prompt)}&rdquo;</p>
      <p class="hint">${multi ? 'Every version above was generated from this single prompt.' : 'The game was generated end-to-end from this single prompt.'}</p>
    </section>` : ''}
  </main>
  <div class="lightbox" role="dialog" aria-modal="true" aria-label="Screenshot viewer" hidden>
    <img alt="" />
    <button class="lb-btn lb-prev" type="button" aria-label="Previous screenshot">&lsaquo;</button>
    <button class="lb-btn lb-next" type="button" aria-label="Next screenshot">&rsaquo;</button>
    <button class="lb-btn lb-close" type="button" aria-label="Close">&times;</button>
  </div>`;
  return page({
    title: docTitle(g, sel),
    description,
    body,
    depth: 2,
    // Every version URL is the same page with a different tab open: the
    // released build's URL is canonical, the others stay out of the index.
    canonical: `${ORIGIN}/game/${g.slug}/`,
    image: sel.m.ogImage,
    noindex: g.status !== 'released' || !sel.primary,
    scripts: ['store.js'],
  });
}

function notFoundHtml() {
  // depth: null -> root-absolute asset URLs, because 404.html is served from
  // any path depth GitHub Pages happens to miss on.
  return page({
    title: 'Not found — 1PGAMES',
    description: 'This page does not exist on 1PGAMES.',
    body: noticeHtml(
      '404',
      'This cabinet is empty',
      'The page you asked for is not on the shelf. The games are all one click away.',
      '\n      <div class="actions"><a class="btn" href="/">Back to the catalog</a></div>',
    ),
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

const allGames = loadGames();

// A game whose manifest carries `variantOf: "<parent-slug>"` is a second
// PLAYABLE BUILD of another game, not a game in its own right: it is built and
// served at /play/<its-slug>/ with its own media at /media/<its-slug>/, but it
// never gets a catalog card or a sitemap entry. The parent's store page shows
// every version as a tab (each with its own preview, screenshots, note and
// play button), and /game/<variant>/ renders that same page with the
// variant's tab open — one entry in the catalog, versions side by side.
//
// An orphan variant (parent absent, e.g. filtered out as a draft) is dropped
// rather than published unreachable — nothing should ship with no way back to
// its own store page.
const games = allGames.filter((g) => !g.variantOf);
const bySlug = new Map(games.map((g) => [g.slug, g]));
const variants = [];
for (const v of allGames) {
  if (!v.variantOf) continue;
  const parent = bySlug.get(v.variantOf);
  if (!parent) {
    console.warn(`skip ${v.slug}: variantOf "${v.variantOf}" is not a published game`);
    continue;
  }
  (parent.variants ??= []).push(v);
  variants.push(v);
}

const media = new Map([...games, ...variants].map((g) => [g.slug, mediaOf(g)]));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const asset of ['styles.css', 'catalog.js', 'store.js', 'favicon.svg']) {
  cpSync(path.join(SITE, asset), path.join(OUT, asset));
}
writeFileSync(path.join(OUT, 'index.html'), indexHtml(games, media));
writeFileSync(path.join(OUT, '404.html'), notFoundHtml());
writeFileSync(path.join(OUT, 'sitemap.xml'), sitemapXml(games));
writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
writeFileSync(path.join(OUT, '.nojekyll'), '');

for (const g of [...games, ...variants]) {
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
  // Every build ships its own, so each version tab shows what that build is.
  const m = media.get(g.slug);
  const mediaDir = path.join(OUT, 'media', g.slug);
  mkdirSync(mediaDir, { recursive: true });
  const coverSrc = path.join(g.dir, 'public', g.cover);
  if (existsSync(coverSrc)) cpSync(coverSrc, path.join(mediaDir, g.cover));
  else console.warn(`warn ${g.slug}: cover missing: public/${g.cover}`);
  for (const s of m.shots) cpSync(path.join(g.dir, s), path.join(mediaDir, path.basename(s)));
  if (m.og) cpSync(path.join(g.dir, 'shots', 'og.png'), path.join(mediaDir, 'og.png'));
  if (m.preview) cpSync(path.join(g.dir, 'shots', 'preview.webm'), path.join(mediaDir, 'preview.webm'));

  // 3. Store page: the parent's page, opened on this build's tab.
  const pageDir = path.join(OUT, 'game', g.slug);
  mkdirSync(pageDir, { recursive: true });
  writeFileSync(path.join(pageDir, 'index.html'), storeHtml(g.variantOf ? bySlug.get(g.variantOf) : g, g.slug));
}

const versionNote = variants.length ? ` (+ ${variants.length} alternate build(s))` : '';
console.log(`\n_site ready: ${games.length} game(s)${versionNote} -> ${OUT}`);
