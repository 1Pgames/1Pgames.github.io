# 1Pgames — daily generated games

Pipeline for producing one small vertical (9:16) browser game per day.

```
.claude/skills/game-prd/   interview → PRD skill (run it: "make a game about X")
.claude/skills/game-art/   style lock → parallel asset generation → engine wiring
template/                  Phaser 4 + Vite + TS portrait template (runs as-is)
scripts/new-game.sh        template → games/<slug>, renames identity
games/<slug>/              one generated game per folder, PRD.md included
```

Games are **complex indie genres** (survivor-like, roguelike, tower defense,
survival, tactics) in portrait 720x1280 with 5-10 minute runs and meta
progression — not casual toys. The template already contains the systems layer
and a full generated chibi art set, so a new game starts from a running
survivor-like slice.

## Daily flow

1. **Spec.** Ask for a game; the `game-prd` skill interviews you (2 rounds of
   batched questions) and writes `games/<slug>/PRD.md`, scaffolding the project
   from `template/`. The PRD ends with a parallel build plan and interface
   contracts.
2. **Build.** Fan the PRD's workstreams out to agents against those contracts;
   they read `PRD.md` and `AGENTS.md` and work inside the existing structure.
   One integrator wires `GameScene` and runs the balance pass.
3. **Art.** Run the `game-art` skill for the game's own style: it writes
   `art/style.json`, generates each asset group in parallel, gates them on
   palette distance and art review, and wires them into `src/data/art.ts`.
3. **Verify.** `npm run build` must be clean and the loop
   menu → run → death → retry must work in a browser.
4. **Record.** `npm run dev`, capture the 720x1280 canvas.

## Manual scaffold

```bash
scripts/new-game.sh 2026-08-27-star-catcher "Star Catcher"
cd games/2026-08-27-star-catcher && npm run dev
```

Template details: `template/README.md`. Build contract: `template/AGENTS.md`.
