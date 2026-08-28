# 1Pgames — daily generated games

Pipeline for producing one complete vertical (9:16) browser game per day from a
**single prompt**:

```
prompt (any language) → family classification → scaffold --family <slice>
       → parallel build + art → verify (family sim gates + browser loop)
       → balance loop → store listing → release-check → publish (English)
```

```
.claude/skills/game-build/ ONE-PROMPT ORCHESTRATOR: prompt → verified game
.claude/skills/game-prd/   family classifier (Step 0) + auto-mode PRD (interview only on request)
.claude/skills/game-art/   style lock → map-forge geometry → parallel assets → generated registry
template/                  Phaser 4 + Vite + TS portrait template (runs as-is)
scripts/new-game.sh        template → games/<slug>: identity, --family slice, game.json manifest
scripts/release-check.mjs  release gate: manifest, English-only fields, cover, shots, no scaffold leftovers
scripts/build-site.mjs     games/*/game.json → _site/ (catalog + store pages + built games)
site/                      store-front assets (styles, filter, lightbox, config.json)
.github/workflows/pages.yml  push to master → build catalog + games → GitHub Pages
games/<slug>/              one generated game per folder: PRD.md, game.json, shots/, build-state.json
```

Games span ten gameplay families — mid-core indie genres (survivor-like,
roguelike, tower defense, deckbuilder, tactics, auto-battler, racing) and
casual ones (board puzzle, side-view physics, idle tycoon, table-dice, word,
hypercasual), plus the hybrid pattern that wraps a casual core in a meta layer
— all in portrait 720x1280 with 5-10 minute sittings and meta progression. The
template contains the shared systems layer (four session directors, board
engine, idle economy, meta-kit, genre kits, generative music, headless
family-aware balance sim) plus a full generated chibi art set, and **eight of
the families ship a running, verified starter slice** (an abridged view of the
canonical family table in `.claude/skills/game-prd/SKILL.md` §Step 0, which adds
the directors and the tiebreak rules):

| Code | Family | Slice | Sim gate |
| --- | --- | --- | --- |
| A | real-time arena (survivor-like, tower defense) | `src/slices/arena/` | `--family arena` |
| B | board puzzle (match/blast, merge, sort, block-fit) | `src/slices/board/` | `--family board` |
| C | side-view physics (platformer, runner) | `src/slices/side/` | `--family side` |
| E | track vehicle (racing, karts) | `src/slices/track/` | `--family track` |
| F | idle tycoon (incremental, prestige, offline) — no fail state, ends on ascend | `src/slices/idle/` | `--family idle` |
| G | table & dice (roll-and-move, deal loops) | `src/slices/table/` | `--family table` |
| H | word & trivia (anagram, quiz) | `src/slices/word/` | `--family word` |
| J | hypercasual (one mechanic, score chase) | `src/slices/hyper/` | `--family hyper` |

Family **D** (turn-based cards & tactics) has no starter slice: it ships the
kits — `core/{turns,deck,autobattle}.ts`, `systems/{placement,board}.ts`,
`ui/{hand,shopTray}.ts`, with headless selftests over the pure-logic ones
(`src/sim/kits/{turns,deck,autobattle,boardmath}.selftest.ts`) — and a D game
composes them into its own slice and writes its own
`src/sim/families/<slice>.ts` gate. Family **I** is
a composition pattern, not a family: a casual core from J/B/F wrapped in 2-3
meta-kit layers (saga map, stars, streaks, collections, boosters).

## One-prompt flow

Say what you want ("make a game about a lighthouse keeper fighting fog
wraiths") and the `game-build` skill runs the whole chain:

1. **Family classification.** `game-prd` Step 0 classifies the pitch two-tier —
   the family first (read semantically from what the player *does*, in whatever
   language the pitch arrived in; A-J, or the hybrid **I** pattern for a pitch
   that names no loop), then the subgenre playbook — and the family fixes the
   session shape, director, input profile, camera and meta shape. No questions
   asked in auto mode. The canonical code ↔ slice ↔ director ↔ gate table lives
   in `.claude/skills/game-prd/SKILL.md` §Step 0.
2. **Auto-PRD.** Still in auto mode, `game-prd` resolves every remaining design
   axis from the family's recorded defaults, scaffolds `games/<slug>/` with
   `scripts/new-game.sh --family <slice>`, and writes `PRD.md` with a parallel
   build plan and frozen interface contracts. Interview happens only if you ask
   for it.
3. **Parallel build + art.** Build workstreams implement the PRD against the
   contracts, starting from the family's slice (`src/slices/<slice>/`, re-exported
   by `src/scenes/game.ts`); `game-art` locks `art/style.json` first, generates
   asset groups in parallel (map-forge for authored geometry when the family
   needs it), and the integrator regenerates `src/data/art.ts` via
   `node scripts/gen-art-registry.mjs`.
4. **Verify.** `npm run verify` must be green: typecheck, **this family's
   headless sim gates**, art-registry drift check, kit selftests. Then the
   browser loop is driven end to end for that family's real verbs — menu →
   session → the family's decision surface → pause/resume → win and loss →
   results (with the family's stat rows) → retry, with screenshots.
5. **Balance loop.** Sim report → `TUNING`/slice `tuning.ts` edits → re-sim, max
   3 iterations.
6. **Store listing.** English `title`/`genre`/`description`/`prompt`, the
   generated cover as `public/cover.png` (+ `shots/og.png` for social), at least
   3 screenshots from the browser loop, optionally a short
   `shots/preview.webm` loop.
7. **Release + publish.** `node scripts/release-check.mjs <slug>` must pass,
   then `game.json.status` flips `draft` → `released`. Commit and push to
   `master`: the Pages workflow builds every **released** game plus the catalog
   and deploys to https://1pgames.github.io/. Capture the 720x1280 canvas for
   the daily clip while the workflow runs.

## English-only storefront

A pitch may arrive in any language. **Everything published is English.**

- Classification happens on the original wording — never pre-translate, that is
  how a pitch loses its verb.
- At scaffold time the pitch is translated to English (faithfully — translated,
  not rewritten) for `--prompt`, the title, `--genre` and `--desc`, so
  `game.json` is English end to end. The verbatim original is preserved in
  `games/<slug>/PRD.md` as its `Original pitch:` header line and nowhere else.
- All in-game copy — menu, HUD, how-to-play, results — is English too.
- `scripts/release-check.mjs` enforces it: any Cyrillic character in
  `title`/`genre`/`description`/`prompt` fails the gate, so a non-English
  listing cannot reach the site.

## Verification model

Fun is gated, not asserted. `template/src/sim/` runs the REAL game data through
the family's own bots and solvers and fails the build when a design gate
breaks: `arena` replays 480s runs against stat and per-weapon bot lanes,
`board` runs a greedy-vs-random solver ladder per level, `hyper` sweeps skill
against session length, `idle` checks economy curves and the first-prestige
floor, `table` a dice win-rate band, `word` bank integrity plus accuracy bots,
`side` analytic level validation plus a hop bot, `track` lap completion and bot
spread. `npm run sim -- --family <slice>` picks the family explicitly; a bare
`npm run sim` uses the scaffolded one from `src/sim/family.ts`. For `arena`,
`--runs 20 --lane all` prints the per-lane table and `--strict` promotes soft
warnings to failures.

## Catalog on GitHub Pages

The repo is the deployable monorepo: `scripts/build-site.mjs` assembles
`_site/` from every `games/<slug>/game.json` —

- `/` — the store-front: hero with the latest release, family filter chips,
  search, one card per game (cover, badges, and the **generating prompt** —
  English — as the card's quote);
- `/game/<slug>/` — the game's store page: cover, description, the prompt
  block, screenshots gallery with a lightbox, optional preview loop, play
  button;
- `/play/<slug>/` — the built game itself, with a `← Games` pill and an
  `ⓘ prompt` chip injected into its shell.

`game.json` is the single catalog source of truth, written at scaffold time:
`{slug, title, family, genre, description, prompt, date, tags, cover,
screenshots, status}`. The `prompt` field is the English pitch the game was
generated from (translated at scaffold time when the pitch was not English);
`game-build` tightens `description` from PRD §1 and appends its verification
screenshots to `shots/` + `screenshots`.

**Draft vs released.** The scaffold writes `"status": "draft"`, and
`build-site.mjs` publishes released games only. The release flow is:

```bash
node scripts/release-check.mjs <slug>   # manifest + English + cover + shots + art
# fix what it reports, then set game.json.status to "released"
node scripts/build-site.mjs             # released games only
git push                                # Pages deploys the catalog
```

Local preview of an unreleased game: `node scripts/build-site.mjs
--include-drafts && python3 -m http.server 5321 -d _site`.

**Media.** The cover is required for release: `public/cover.png` from the
`game-art` cover step, referenced by `game.json.cover`. The scaffold's
deterministic gradient `public/cover.svg` is a draft placeholder only.
`og:image` resolves to `media/<slug>/og.png` when `games/<slug>/shots/og.png`
exists, else the first `.png` screenshot, else it is omitted. An optional
`games/<slug>/shots/preview.webm` becomes an autoplaying muted loop on the store
page.

**Analytics.** Optional and off by default: `site/config.json` may hold
`{"goatcounter": "https://<code>.goatcounter.com/count"}`, and `build-site.mjs`
injects the GoatCounter snippet into every generated page. No file, no snippet,
no third-party requests.

Deploys run from `.github/workflows/pages.yml` on push to `master`
(build+typecheck gate the deploy; the slow sim/selftest `verify` job runs in
parallel without blocking it).

## Manual scaffold

```bash
scripts/new-game.sh 2026-08-27-star-catcher "Star Catcher" --family hyper \
  --prompt "a game about catching falling stars" \
  --genre "tap-timing arcade" \
  --desc "Time your taps to catch falling stars before they hit the ground."
cd games/2026-08-27-star-catcher && npm run dev
```

`--family <slice>` picks the starter slice (`arena` `board` `side` `track` `idle`
`table` `word` `hyper`), prunes the others, rewrites the `src/scenes/game.ts`
re-export and writes `src/sim/family.ts`; omitting it lands family A's arena
slice. The new `game.json` starts as `"status": "draft"` — it appears on the
storefront only after `scripts/release-check.mjs` passes and the status is
flipped to `"released"`. Keep every listing field English.

Template details: `template/README.md`. Build contract: `template/AGENTS.md`.
