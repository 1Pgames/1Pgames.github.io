# Duskhaul — AI original (frozen)

This folder is a **frozen snapshot** of `games/2026-08-29-duskhaul/` taken on
2026-08-29, immediately after the automated pipeline finished and **before any
human had played the game**. It exists so the storefront can offer both builds
of the same game side by side.

It is not a separate game. It has no catalog card, no store page and no
independent release: `game.json` carries `"variantOf": "2026-08-29-duskhaul"`,
and `scripts/build-site.mjs` folds it into the parent's page as a second play
button. `scripts/release-check.mjs` runs only build-integrity checks here and
reports that it ships when the parent ships.

## Do not "improve" this folder

Feedback goes to the parent. The comparison is only worth anything while this
side stays untouched — every fix applied here erases the thing it documents.

## Deliberate deltas from the snapshot

Four changes were required to host two builds of one game on one origin. All
four are packaging, none touch gameplay, balance, content or art:

| File | Change | Why |
| --- | --- | --- |
| `package.json` | `name` → `2026-08-29-duskhaul-ai` | npm workspace names must be unique |
| `game.json` | `slug`, `title`, `variantOf`, `versionLabel`, `versionNote`, `status: "variant"` | identifies it as the parent's alternate build |
| `src/core/storage.ts` | `NS` → `2026-08-29-duskhaul-ai:` | **load-bearing** — a shared `localStorage` namespace would let the polished cut's progression migration rewrite this build's stash |
| — | `art/refs/`, `raw-source.*`, `shots/cert/` excluded | generation provenance, ~214 MB, already preserved in the parent |

## What was not copied

Excluded from the snapshot because it is build residue rather than the build:
`art/refs/` (7.5 MB vision anchors), 103 × `raw-source.*` (54 MB pre-keying
generation output), `shots/cert/` (28 MB cert screenshots), `node_modules`,
`dist`. All 115 exported sprite sheets and all 780 shipped asset files are
present — this folder builds and plays standalone.
