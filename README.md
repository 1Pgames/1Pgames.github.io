# 1Pgames — daily generated games

Pipeline for producing one complete vertical (9:16) browser game per day from a
**single prompt**:

```
prompt → family classification → scaffold --family → parallel build + art
       → verify (family sim gates + browser loop) → balance loop → record
```

```
.claude/skills/game-build/ ONE-PROMPT ORCHESTRATOR: prompt → verified game
.claude/skills/game-prd/   family classifier (Step 0) + auto-mode PRD (interview only on request)
.claude/skills/game-art/   style lock → map-forge geometry → parallel assets → generated registry
template/                  Phaser 4 + Vite + TS portrait template (runs as-is)
scripts/new-game.sh        template → games/<slug>, renames identity, wires --family
games/<slug>/              one generated game per folder, PRD.md included
```

Games span ten gameplay families — mid-core indie genres (survivor-like,
roguelike, tower defense, deckbuilder, tactics, auto-battler, racing) and
casual ones (board puzzle, side-view physics, idle tycoon, table-dice, word,
hypercasual), plus the hybrid pattern that wraps a casual core in a meta layer
— all in portrait 720x1280 with 5-10 minute sittings and meta progression. The
template contains the shared systems layer (four session directors, board
engine, idle economy, meta-kit, genre kits, generative music, headless
family-aware balance sim) plus a full generated chibi art set, and **eight of
the families ship a running, verified starter slice**:

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
`src/sim/families/<code>.ts` gate. Family **I** is
a composition pattern, not a family: a casual core from J/B/F wrapped in 2-3
meta-kit layers (saga map, stars, streaks, collections, boosters).

## One-prompt flow

Say what you want ("make a game about a lighthouse keeper fighting fog
wraiths") and the `game-build` skill runs the whole chain:

1. **Family classification.** `game-prd` Step 0 scores the pitch two-tier —
   family code first (A-J, or the hybrid **I** pattern for vague/brandless
   casual pitches), then the subgenre playbook — and that code fixes the
   session shape, director, input profile, camera and meta shape. No questions
   asked in auto mode.
2. **Auto-PRD.** Still in auto mode, `game-prd` resolves every remaining design
   axis from the family's recorded defaults, scaffolds `games/<slug>/` with
   `scripts/new-game.sh --family <code>`, and writes `PRD.md` with a parallel
   build plan and frozen interface contracts. Interview happens only if you ask
   for it.
3. **Parallel build + art.** Build workstreams implement the PRD against the
   contracts, starting from the family's slice (`src/slices/<code>/`, re-exported
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
6. **Record.** `npm run dev`, capture the 720x1280 canvas.

## Verification model

Fun is gated, not asserted. `template/src/sim/` runs the REAL game data through
the family's own bots and solvers and fails the build when a design gate
breaks: `arena` replays 480s runs against stat and per-weapon bot lanes,
`board` runs a greedy-vs-random solver ladder per level, `hyper` sweeps skill
against session length, `idle` checks economy curves and the first-prestige
floor, `table` a dice win-rate band, `word` bank integrity plus accuracy bots,
`side` analytic level validation plus a hop bot, `track` lap completion and bot
spread. `npm run sim -- --family <code>` picks the family explicitly; a bare
`npm run sim` uses the scaffolded one from `src/sim/family.ts`. For `arena`,
`--runs 20 --lane all` prints the per-lane table and `--strict` promotes soft
warnings to failures.

## Manual scaffold

```bash
scripts/new-game.sh 2026-08-27-star-catcher "Star Catcher" --family hyper
cd games/2026-08-27-star-catcher && npm run dev
```

`--family <code>` picks the starter slice (`arena` `board` `side` `track` `idle`
`table` `word` `hyper`), prunes the others, rewrites the `src/scenes/game.ts`
re-export and writes `src/sim/family.ts`; omitting it lands family A's arena
slice.

Template details: `template/README.md`. Build contract: `template/AGENTS.md`.
