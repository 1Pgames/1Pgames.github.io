---
name: game-prd
description: >-
  Turns a game idea into an implementation-ready PRD for a COMPLEX indie-genre
  browser game (roguelike, survivor-like, tower defense, survival, tactics,
  deckbuilder, auto-battler) in portrait 9:16 with 5-10 minute runs and meta
  progression. Runs a structured clarifying interview with the ask tool in 2-3
  batched rounds covering fantasy, run architecture, systems, content volume,
  build variety, economy, difficulty scaling, portrait UI density and juice,
  then scaffolds games/<slug>/ from template/ (Phaser 4 + Vite) and writes PRD.md
  including a parallel build plan with interface contracts for concurrent agents.
  Use for "make a game about X", "new game idea", "write a game PRD", "today's
  game", daily generated-game channel work, or turning a rough concept into a
  buildable spec.
---

# Game PRD (interview → spec → scaffold → parallel build plan)

Output: `games/<slug>/` (a runnable copy of `template/`) plus `games/<slug>/PRD.md`
— a spec complete enough that 4-6 agents can implement it **in parallel** without
asking further questions.

Fixed project decisions — never ask about these:

| Decision | Value |
| --- | --- |
| Frame | portrait 720x1280, `FIT` scale, SAFE top 140 / bottom 220 / side 40 |
| Engine | Phaser 4.2.1 + Vite 8 + TypeScript strict (`template/`) |
| Run length | 5-10 minutes (480s reference run) |
| Scope class | complex indie genre with systems + meta progression |
| Input | one thumb (touch) with full keyboard parity |
| Build method | parallel agents against interface contracts, one integrator |

## Non-negotiable rules

1. **Interview first.** Never write a PRD from a one-line pitch. Two rounds
   minimum; a third only for structural blockers.
2. **Use `ask`, batched:** 4-6 questions per call, 2-5 options each, short
   labels, tradeoffs in `description`, always a `recommended` index. The user
   must be able to accept defaults and still get a coherent, buildable game.
3. **Never ask what a reference answers.** Genre conventions, systems mapping,
   content volumes, scaling formulas, UI budgets → look them up in
   `references/genre-playbooks.md` and `references/design-heuristics.md`. Ask
   only about decisions that change the design or the architecture.
4. **No adjective without a number.** "Deep", "juicy", "hard" are banned in the
   PRD. Everything becomes a value: HP, dps, px/s, ms, hex, formula, count.
5. **Systems before content.** The PRD names which template modules each system
   uses (`core/stats.ts`, `core/damage.ts`, `core/pool.ts`, `core/spatial.ts`,
   `core/grid.ts`, `core/run.ts`, `core/progression.ts`, `ui/cards.ts`,
   `ui/bars.ts`, `data/*`). Anything genuinely missing is specified as
   `NEW: <file> — <one-line spec>`, never assumed.
6. **Content tables are mandatory.** Enemies/units/towers/upgrades/items each get
   a full stat row. Minimum volumes come from the genre playbook; a PRD with
   fewer entries than the "minimum viable" column is a defect.
7. **Prove build variety.** At least 3 viable strategies, each named, with the
   upgrades/units that enable it and why it is not dominated.
8. **Parallel build plan is part of the PRD.** 4-6 workstreams, one owner per
   file, interface contracts written as real TypeScript signatures, plus the
   integration order and the integrator's checklist.
9. **Portrait UI plan with pixel coordinates.** Dense UI must fit 720x1280 inside
   SAFE, with nothing interactive under the thumb zone except full-width
   controls; minimum tap target 88px.
10. **Record assumptions.** Anything the user defers is decided by you and listed
    in the PRD's Assumptions section with the chosen value.

## Workflow

### Step 0 — Classify (no user contact yet)

From the pitch determine: fantasy/theme, closest genre from
`references/genre-playbooks.md`, the primary verb, and the systems weight
(S/M/L). Read that playbook plus `references/design-heuristics.md` §1-§6.
State the classification back to the user in two lines before the first `ask`,
so a wrong read is caught immediately.

### Step 1 — Round 1: the six axes (always)

One `ask` call, six questions, from `references/question-bank.md` §Round 1:
fantasy/setting, genre confirmation, run architecture (how a run starts, escalates
and ends), primary verb + secondary interaction, art direction (palette with hex),
meta progression shape.

### Step 2 — Round 2: systems and content (always)

Second `ask` call, 4-6 questions from §Round 2: enemy/unit roster shape, player
power sources and upgrade pool size, economy (in-run and meta currency),
difficulty scaling curve, UI density plan, boss/finale shape, juice level.

### Step 3 — Round 3: structural blockers only

At most 3 questions, only when an answer changes file structure or systems
(persistent hub scene? procedurally generated map or fixed layouts? inventory
with equipment slots? multiple playable characters?). Otherwise skip and resolve
into Assumptions.

### Step 4 — Scaffold, then write the PRD

```bash
scripts/new-game.sh <slug> "Game Title" --no-install
```

Slug: `YYYY-MM-DD-<short-name>` for daily channel games. Then write
`games/<slug>/PRD.md` following `references/prd-template.md` section by section.
All sections required; no placeholders, no "TBD".

### Step 4b — Art direction hand-off

Section 11 of the PRD (art direction) is the input to the `game-art` skill: it
must name the palette hex values, shape language, the colour code for
threat/ally/reward, and any asset the template does not already have. The
generated template art is a coherent chibi set — a game that keeps it needs no
art work; a game that wants its own look runs `game-art` with a new
`art/style.json` before the build agents start on visuals.

### Step 5 — Self-review, then hand off

Verify against `references/prd-template.md` §Definition of done. Then report:
slug, PRD path, the interview decisions in 4-6 lines, the parallel workstream
list, and the exact next commands:

```bash
cd games/<slug> && npm install && npm run dev
```

## Output contract

- `games/<slug>/` — template copy with identity renamed.
- `games/<slug>/PRD.md` — the spec, including §Build plan.
- Do **not** implement gameplay during this skill's run unless the user asks.
  `template/AGENTS.md` is the build contract the implementing agents follow.

## References

| File | Use |
| --- | --- |
| `references/question-bank.md` | Exact questions, options, defaults per round |
| `references/genre-playbooks.md` | Per-genre systems, content volumes, numbers, parallel split |
| `references/design-heuristics.md` | Run architecture, scaling math, economy, UI density, performance, build methodology |
| `references/prd-template.md` | PRD structure to fill + definition of done |
| `../../../template/AGENTS.md` | What the template already provides — never spec around it |
| `../game-art/SKILL.md` | Art pipeline: style lock, parallel asset generation, engine wiring |
