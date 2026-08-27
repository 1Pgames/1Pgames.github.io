# 1Pgames — daily generated games

Pipeline for producing one complete vertical (9:16) browser game per day from a
**single prompt**.

```
.claude/skills/game-build/ ONE-PROMPT ORCHESTRATOR: prompt → verified game
.claude/skills/game-prd/   auto-mode PRD (interview only on request)
.claude/skills/game-art/   style lock → map-forge geometry → parallel assets → generated registry
template/                  Phaser 4 + Vite + TS portrait template (runs as-is)
scripts/new-game.sh        template → games/<slug>, renames identity
games/<slug>/              one generated game per folder, PRD.md included
```

Games are **complex indie genres** (survivor-like, roguelike, tower defense,
survival, tactics, deckbuilder, auto-battler) in portrait 720x1280 with 5-10
minute runs and meta progression — not casual toys. The template contains the
systems layer (weapons, boss phases, scripted events, genre kits, generative
music, headless balance sim) plus a full generated chibi art set, so a new game
starts from a running, *verified* survivor-like slice.

## One-prompt flow

Say what you want ("make a game about a lighthouse keeper fighting fog
wraiths") and the `game-build` skill runs the whole chain:

1. **Auto-PRD.** `game-prd` in auto mode classifies the pitch against 12 genre
   playbooks, resolves every design axis from recorded defaults (no questions),
   scaffolds `games/<slug>/` and writes `PRD.md` with a parallel build plan and
   frozen interface contracts. Interview happens only if you ask for it.
2. **Parallel build + art.** Build workstreams implement the PRD against the
   contracts; `game-art` locks `art/style.json` first, generates asset groups
   in parallel (map-forge for authored geometry when the genre needs it), and
   the integrator regenerates `src/data/art.ts` via
   `node scripts/gen-art-registry.mjs`.
3. **Verify.** `npm run verify` must be green: typecheck, **headless balance
   sim gates** (winnable by a coherent expert build, losable by a novice,
   first-upgrade pacing, no dominant lane), art-registry drift check, genre-kit
   selftests. Then the browser loop is driven end to end:
   menu → run → draft (with reroll) → pause/resume → death or win → results
   (with seed) → retry, with screenshots.
4. **Balance loop.** Sim report → `TUNING` edits → re-sim, max 3 iterations.
5. **Record.** `npm run dev`, capture the 720x1280 canvas.

## Verification model

Fun is gated, not asserted. `template/src/sim/` replays full 480s runs against
bot lanes (stat builds and per-weapon builds) on the REAL game data and fails
the build when the design gates break. `npm run sim -- --runs 20 --lane all`
prints the per-lane table; `--strict` promotes soft warnings (build-lane
dominance, pacing drift, tension) to failures.

## Manual scaffold

```bash
scripts/new-game.sh 2026-08-27-star-catcher "Star Catcher"
cd games/2026-08-27-star-catcher && npm run dev
```

Template details: `template/README.md`. Build contract: `template/AGENTS.md`.
