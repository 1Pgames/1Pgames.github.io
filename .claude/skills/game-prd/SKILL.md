---
name: game-prd
description: >-
  Turns a game idea into an implementation-ready PRD for a COMPLEX indie-genre
  browser game (survivor-like, action roguelike, tower defense, roguelike
  deckbuilder, auto-battler, survival crafting, base builder, bullet hell,
  turn-based tactics, idle/incremental, extraction run, dungeon crawler) in
  portrait 9:16 with 5-10 minute runs and meta progression. Defaults to a fully
  autonomous `auto` mode that turns ONE pitch into a complete PRD with zero
  clarifying questions (every axis resolved from playbook/heuristic lookups and
  logged in Assumptions); switches to an `interactive` mode with a structured
  `ask`-tool interview in 2-3 batched rounds only on explicit request or a
  genuinely contradictory pitch. Either mode scaffolds games/<slug>/ from
  template/ (Phaser 4 + Vite) and writes PRD.md including a parallel build plan
  with interface contracts for concurrent agents. Use for "make a game about X",
  "make a game about X end to end", "new game idea", "write a game PRD",
  "today's game", daily generated-game channel work, or turning a rough concept
  into a buildable spec.
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

## Modes

| Mode | When | Behaviour |
| --- | --- | --- |
| `auto` (default) | The user gives a pitch without asking to be interviewed; **always** when this skill is invoked by the `game-build` orchestrator | Zero `ask` calls. Every interview axis in `references/question-bank.md` is resolved deterministically: each question's `recommended` option, cross-checked against `references/genre-playbooks.md`/`references/design-heuristics.md` lookups and the pitch's own keywords, wins unless the pitch explicitly states otherwise. Every decision is logged in the PRD's §18 Assumptions as `axis → chosen value — one-line rationale`. |
| `interactive` | The user explicitly asks to be interviewed/asked questions, or the pitch contains genuinely contradictory constraints (e.g. "turn-based" and "auto-attack swarm" in the same sentence) that `auto` cannot resolve without guessing wrong | The `ask`-tool interview below, 2-3 batched rounds. |

`auto` is the default path for "make a game about X", "today's game", and any
single-prompt request — it must never block on a question the pitch, a
playbook, or a heuristic default can already answer.

## Non-negotiable rules

1. **Decide every axis before writing.** In `auto` mode, resolve all 13
   questions in `references/question-bank.md` via their `Auto rule:` — no
   `ask` call. In `interactive` mode, interview first: two rounds minimum, a
   third only for structural blockers. Never write a PRD from an unresolved
   axis.
2. **When interviewing, use `ask`, batched:** 4-6 questions per call, 2-5
   options each, short labels, tradeoffs in `description`, always a
   `recommended` index. The user must be able to accept defaults and still get
   a coherent, buildable game.
3. **Never ask (or auto-decide against) what a reference answers.** Genre
   conventions, systems mapping, content volumes, scaling formulas, UI budgets
   → look them up in `references/genre-playbooks.md` and
   `references/design-heuristics.md`. Ask only about decisions that change the
   design or the architecture, and only in `interactive` mode.
4. **No adjective without a number.** "Deep", "juicy", "hard" are banned in the
   PRD. Everything becomes a value: HP, dps, px/s, ms, hex, formula, count.
5. **Systems before content.** The PRD names which template modules each system
   uses (`core/stats.ts`, `core/damage.ts`, `core/pool.ts`, `core/spatial.ts`,
   `core/grid.ts`, `core/run.ts`, `core/progression.ts`, `ui/cards.ts`,
   `ui/bars.ts`, `data/*`). Anything genuinely missing is specified as
   `NEW: <file> — <one-line spec>`, never assumed.
6. **Content tables are mandatory.** Enemies/units/towers/upgrades/items each get
   a full stat row plus a Flavor name and description. Minimum volumes come
   from the genre playbook; a PRD with fewer entries than the "minimum viable"
   column is a defect.
7. **Prove build variety.** At least 3 viable strategies, each named, with the
   upgrades/units that enable it and why it is not dominated.
8. **Parallel build plan is part of the PRD.** 4-6 workstreams, one owner per
   file, interface contracts written as real TypeScript signatures, plus the
   integration order and the integrator's checklist.
9. **Portrait UI plan with pixel coordinates.** Dense UI must fit 720x1280 inside
   SAFE, with nothing interactive under the thumb zone except full-width
   controls; minimum tap target 88px.
10. **Record assumptions.** Anything the user defers (interactive) or anything
    decided deterministically (auto) is listed in the PRD's Assumptions section
    with the chosen value and, in auto mode, the one-line rationale.

## Workflow

### Step 0 — Classify and pick a mode (no user contact yet in `auto`)

From the pitch determine: fantasy/theme, closest genre from
`references/genre-playbooks.md`, the primary verb, and the systems weight
(S/M/L). Read that playbook plus `references/design-heuristics.md` §1-§6.
Pick the mode per §Modes above. In `interactive` mode, state the
classification back to the user in two lines before the first `ask`, so a
wrong read is caught immediately. In `auto` mode, skip straight to Step 1.

### Step 1 — Resolve the six axes

`auto`: apply each Round 1 question's `Auto rule:` from
`references/question-bank.md` §Round 1 — fantasy/setting, genre confirmation,
run architecture, primary verb + secondary interaction, art direction
(palette with hex), meta progression shape. No `ask` call.

`interactive`: one `ask` call, the same six questions.

### Step 2 — Resolve systems and content

`auto`: apply the `Auto rule:` for 4-6 Round 2 questions, prioritising
whatever the genre playbook flags as genre-critical — enemy/unit roster
shape, player power sources and upgrade pool size, economy, difficulty
scaling curve, UI density plan, boss/finale shape, juice level. No `ask` call.

`interactive`: second `ask` call, the same 4-6 questions.

### Step 3 — Structural blockers

`auto`: resolve every Round 3 question via its `Auto rule:` (cheapest option
that satisfies the pitch) and log it in Assumptions. Never ask.

`interactive`: at most 3 questions, only when an answer changes file
structure or systems (persistent hub scene? procedurally generated map or
fixed layouts? inventory with equipment slots? multiple playable
characters?). Otherwise skip and resolve into Assumptions.

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
slug, PRD path, the axis decisions in 4-6 lines (interview answers or, in
`auto` mode, the Assumptions summary), the parallel workstream list, and the
verification contract the build must satisfy before it counts as done:

- `npm run verify` (`template/scripts/verify.sh`): typecheck + `npm run sim`
  gates + `node scripts/gen-art-registry.mjs --check` + every
  `src/sim/kits/*.selftest.ts`.
- The browser-bot playthrough loop (menu → run → draft → pause → death/win →
  retry, screenshotted at each state) — owned and driven by the
  `game-build` skill, not by this one.

Then the exact next commands:

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
| `../game-build/SKILL.md` | One-prompt orchestrator: runs this skill in `auto` mode, then scaffold/build/art/integration/verification |
