---
name: game-prd
description: >-
  Turns a game idea into an implementation-ready PRD for a browser game in
  portrait 9:16, in any of ten gameplay families: real-time arena
  (survivor-like, action roguelike, bullet hell, tower defense), board puzzle
  (match/blast/merge/sort/block/screw), side-view physics (platformer, runner,
  physics driving), turn-based cards and tactics (deckbuilder, tactics,
  auto-battler), track vehicle (top-down racing, drift, laps), idle tycoon
  (generators, managers, prestige), table dice (solitaire, dice-board, ludo),
  word and trivia, hypercasual (tap-timing, stacking, swerve, rise/drop,
  io-lite), plus the hybrid composition pattern (casual core + meta layer) that
  is the 2026 default for an ambiguous casual pitch. Defaults to a fully
  autonomous `auto` mode that turns ONE pitch into a complete PRD with zero
  clarifying questions (family and every axis resolved from playbook/heuristic
  lookups and logged in Assumptions); switches to an `interactive` mode with a
  structured `ask`-tool interview in 2-3 batched rounds only on explicit request
  or a genuinely contradictory pitch. Either mode scaffolds games/<slug>/ from
  template/ (Phaser 4 + Vite) and writes PRD.md including a parallel build plan
  with interface contracts for concurrent agents. Use for "make a game about X",
  "make a game about X end to end", "new game idea", "write a game PRD",
  "today's game", daily generated-game channel work, or turning a rough concept
  into a buildable spec.
---

# Game PRD (classify → spec → scaffold → parallel build plan)

Output: `games/<slug>/` (a runnable copy of `template/`) plus `games/<slug>/PRD.md`
— a spec complete enough that 4-6 agents can implement it **in parallel** without
asking further questions.

Fixed project decisions — never ask about these:

| Decision | Value |
| --- | --- |
| Frame | portrait 720x1280, `FIT` scale, SAFE top 140 / bottom 220 / side 40 |
| Engine | Phaser 4.2.1 + Vite 8 + TypeScript strict (`template/`) |
| Input | one thumb (touch) with full keyboard parity |
| Session driver | a `SessionDirector` implementation (`core/session.ts`), one per family |
| Build method | parallel agents against interface contracts, one integrator |
| Slice home | `src/slices/<family>/` — the family's starter scene + data |

Everything the old single-archetype version fixed globally (480s run, meta shop,
follow camera, joystick) is now **per family** — see §Family fixed decisions.

## Modes

| Mode | When | Behaviour |
| --- | --- | --- |
| `auto` (default) | The user gives a pitch without asking to be interviewed; **always** when this skill is invoked by the `game-build` orchestrator | Zero `ask` calls. Family is resolved from the Step 0 table, then every interview axis in `references/question-bank.md` is resolved deterministically: each question's `recommended` option for that family, cross-checked against the family's playbook (`references/genre-playbooks.md` for A/D/E, `references/casual-playbooks.md` for B/C/F/G/H/J) and `references/design-heuristics.md`, wins unless the pitch explicitly states otherwise. Every decision is logged in the PRD's §18 Assumptions as `axis → chosen value — one-line rationale`. |
| `interactive` | The user explicitly asks to be interviewed/asked questions, or the pitch contains genuinely contradictory constraints (e.g. "turn-based" and "auto-attack swarm" in the same sentence, or "endless score chase" and "100 hand-authored levels") that `auto` cannot resolve without guessing wrong | The `ask`-tool interview below, 2-3 batched rounds. Q2 asks the **family** first, subgenre second. |

`auto` is the default path for "make a game about X", "today's game", and any
single-prompt request — it must never block on a question the pitch, a
playbook, or a heuristic default can already answer.

## Non-negotiable rules

1. **Family before anything else.** Step 0 resolves exactly one family code
   (A-J) or the composition pattern **I**. Every later axis — session shape,
   director, input profile, camera, meta shape, content volumes, sim gate — is
   a lookup keyed on that code. A PRD without a family code in its header is a
   defect.
2. **Decide every axis before writing.** In `auto` mode, resolve all 15
   questions in `references/question-bank.md` via their `Auto rule:` — no
   `ask` call. In `interactive` mode, interview first: two rounds minimum, a
   third only for structural blockers. Never write a PRD from an unresolved
   axis.
3. **When interviewing, use `ask`, batched:** 4-6 questions per call, 2-5
   options each, short labels, tradeoffs in `description`, always a
   `recommended` index. The user must be able to accept defaults and still get
   a coherent, buildable game.
4. **Never ask (or auto-decide against) what a reference answers.** Family
   conventions, systems mapping, content volumes, scaling formulas, UI budgets
   → look them up in the family's playbook and
   `references/design-heuristics.md`. Ask only about decisions that change the
   design or the architecture, and only in `interactive` mode.
5. **No adjective without a number.** "Deep", "juicy", "hard" are banned in the
   PRD. Everything becomes a value: HP, dps, px/s, ms, hex, formula, count,
   win-rate band, moves, cost growth.
6. **Systems before content.** The PRD names which template modules each system
   uses (`core/session.ts`, `core/stats.ts`, `core/damage.ts`, `core/pool.ts`,
   `core/spatial.ts`, `core/grid.ts`, `core/run.ts`, `core/progression.ts`,
   `ui/cards.ts`, `ui/bars.ts`, `data/*`) plus the family slice in
   `src/slices/<family>/`. Anything genuinely missing is specified as
   `NEW: <file> — <one-line spec>`, never assumed.
7. **Content tables are mandatory.** Whatever the family's content atoms are
   (enemies/upgrades, piece types/specials/levels, generators/upgrades,
   questions/word lists, cars/tracks, tile events) each get a full stat row
   plus a Flavor name and description. Minimum volumes come from the family
   content-volume table in `references/prd-template.md` §5; a PRD below the
   "minimum" column is a defect.
8. **Prove variety.** At least 3 viable strategies (A/D/E), or 3 distinct
   solve routes / board archetypes (B/G/H), or 3 economy routes (F), or 1
   mechanic + 2 twists (J) — each named, with what enables it and why it is
   not dominated.
9. **Parallel build plan is part of the PRD.** 4-6 workstreams, one owner per
   file, interface contracts written as real TypeScript signatures, plus the
   integration order and the integrator's checklist.
10. **Portrait UI plan with pixel coordinates.** Dense UI must fit 720x1280
    inside SAFE, with nothing interactive under the thumb zone except
    full-width controls; minimum tap target 88px. Board families additionally
    fit the whole board inside the playfield band with no scrolling.
11. **Record assumptions.** Anything the user defers (interactive) or anything
    decided deterministically (auto) is listed in the PRD's Assumptions section
    with the chosen value and, in auto mode, the one-line rationale.

## Workflow

### Step 0 — Two-tier classification (no user contact yet in `auto`)

**Tier 1 — family.** Score the pitch against the keyword column below and take
the highest-scoring row. Ties and zero-match pitches go to the HYBRID DEFAULT
rule beneath the table.

| Code | Family | One-line identifier | Keyword hints |
| --- | --- | --- | --- |
| A | real-time-arena | You move one avatar in real time and threats escalate around you until a timer or boss resolves the run | swarm, auto-attack, survivor, roguelike, bullet hell, dodge, waves, tower defense, defend the core, horde, arena, dungeon |
| B | board-puzzle | You act on a static grid of pieces; each move mutates the board toward a goal | match, match-3, swap, blast, cube, merge, merge-2, sort, sort puzzle, water sort, block, blocks, tetris-like, screw, pin, nuts and bolts, tile match, triple tile, jam, unblock |
| C | side-view-physics | Gravity and momentum in a side view; you time one input against terrain | platformer, jump, runner, endless runner, parkour, rooftops, physics, ragdoll, hill climb, driving, ramps, flip, rope, swing, launch |
| D | turn-based-cards-tactics | Nothing moves until you commit; a turn resolves and the board answers | deckbuilder, deck, cards, draft, turn-based, tactics, grid combat, squad, auto-battler, comp, synergy, initiative, chess-like |
| E | track-vehicle | You steer a vehicle around a closed circuit against lap and rival pressure | racing, race, laps, drift, circuit, kart, rally, track, checkpoint, nitro, top-down racing |
| F | idle-tycoon | Numbers grow while you watch, and you spend them to make them grow faster | idle, incremental, tycoon, empire, factory, manager, clicker, capitalist, offline, prestige, automation, lemonade stand, shop simulator |
| G | table-dice | A deal, a dice roll or a card stack drives a table-top loop of small decisions | solitaire, klondike, spider, freecell, tripeaks, patience, dice, board game, monopoly, roll and move, ludo, snakes and ladders, bingo, tile draw |
| H | word-trivia | Text is the content; you retrieve or arrange language under a small constraint | word, words, letters, anagram, crossword, wordle-like, spelling, vocabulary, trivia, quiz, questions, guess the, riddle |
| J | hypercasual | One learnable-in-10-seconds mechanic, endless score chase, instant retry | tap, one tap, flappy, timing, stack, stacking, swerve, dodge the, rise, drop, helix, hole io, agar, snake io, grow, hyper-casual, arcade score |
| I | **hybrid composition pattern** (not a family) | A casual core from J/B/F wrapped in a meta layer from the meta-kit | cozy, relaxing, collect, decorate, renovate, story, "casual game", brandless one-noun pitches, any pitch that names a fantasy but no verb |

Out of scope — reject and counter-propose, never spec: real-time multiplayer
(MOBA/battle-royale/online .io), LiveOps-dependent gacha, social casino or
real-money gambling. An "io" pitch is in scope only as **J io-lite**: offline
bots, no netcode.

**HYBRID DEFAULT rule.** When the pitch is ambiguous, brand-less, or names a
fantasy without a verb ("a cozy game about a bakery", "something with cats",
"a relaxing game"), do **not** fall back to a mid-core family and do not fall
back to match-3 swap. Compose pattern **I**: pick the casual core whose keyword
score is highest among **J** (one mechanic), **B** (board), **F** (economy) —
default **F** when the pitch names a place or business, **B** when it names
objects to organise, **J** when it names a single motion — and wrap it in 2-3
meta-kit layers (saga map, stars, collections, decor/renovation tasks, reward
track, streaks/daily). Rationale to log in Assumptions, with numbers:
hybrid-casual is the only growing segment in 2026 (+20-23% YoY) and the
formula is "mechanic learned in 10s + meta", worth 5-20x the LTV of a pure
hypercasual title; the Last War / Whiteout pattern (casual minigame onboarding
→ deep meta) is the reference. Never default a vague casual pitch to **pure
match-swap**: new match-swap titles succeed at ~0.8%. If the pitch does say
"match 3", offer the growing niches instead and record the swap — **sort**
(+170-229% YoY), **block** (+176%), **merge** (+65-74%), **screw/pin** — and
keep match-swap only when the user names it twice or names a specific
competitor.

**Tier 2 — subgenre playbook.** Read the family's playbook section and lock the
subgenre:

| Family | Playbook home |
| --- | --- |
| A, D, E | `references/genre-playbooks.md` (mid-core set) |
| B, C, F, G, H, J | `references/casual-playbooks.md` (casual set) |
| I | both — the casual core's section, plus the meta-kit section |

`F` reads `references/casual-playbooks.md` for the tycoon/prestige shape and
`references/genre-playbooks.md` §10 for the active-layer economy math when the
pitch wants a foreground tapping layer.

Then read `references/design-heuristics.md` §1-§6 plus the family's math
section (§15 level curves, §16 ramp math, §17 idle economy) and §18's
family→verification map. In `interactive` mode, state the classification back
to the user in two lines (`family + subgenre + session shape`) before the first
`ask`, so a wrong read is caught immediately. In `auto` mode, skip straight to
Step 1.

### Step 0b — Family fixed decisions

Once the family is known, these are decided; never ask, never re-derive. All
directors implement `SessionDirector` (`core/session.ts`:
`update(deltaMs)`, `elapsedMs`, `ended`, `outcome {won, reason}`,
`progress` 0..1, `pause()`/`resume()`).

| Code | Session shape | Input profile | Camera | Director | Meta shape |
| --- | --- | --- | --- | --- | --- |
| A | 480s run, 6 phases (§1.1), boss at 420s | joystick (drag/axis) + tap for abilities | follow-arena (`static-board` for place-defense subgenres: tower defense, base builder) | `RunDirector` | shop (currency + upgrade tree) |
| B | 1-3 min levels; 10-25 levels per session; move- or timer-limited | tap (swap/blast), drag (merge/sort/screw) | static-board | `LevelDirector` | saga-map + stars (+ collections) |
| C | levels (2-4 min each, 12-25 per session) **or** endless; pick one, never both | tap (jump), swipe (dash/flip), drag (steer) | side-follow | `LevelDirector` (levels) / `RampDirector` (endless) | saga-map (levels) / shop + collections (endless) |
| D | 5-10 min match, fight/round-indexed rather than wall-clock | tap (card/tile/target), drag-to-play as the video-legible alternative | static-board | `RunDirector`, `progress` indexed by fight/node, not seconds | shop (currency + unlocks) |
| E | 3-5 lap races, 60-150s per race, 8-15 races per session | drag (steer) + tap (drift/boost) | track | `LapDirector` | shop (vehicle upgrades) + collections (vehicles) |
| F | continuous economy, no session end; prestige cycle every 15-30 min; offline progress on return | tap | static-board | `RampDirector`, `progress` = fraction of the way to the next prestige threshold, `outcome.won` when prestige unlocks | prestige tree (+ collections for managers) |
| G | 1-3 min deals/matches; 10-25 per session | tap (+ drag for card moves) | static-board | `LevelDirector` | collections (+ saga-map for the dice-board loop) |
| H | 1-3 min puzzles/quizzes; 10-25 per session | tap (+ swipe for letter-connect drag) | static-board | `LevelDirector` | saga-map + collections |
| J | 30-120s endless score-chase; retry in under 2s from death to playable | exactly one of tap \| swipe \| drag — never two | side-follow or static-board per mechanic | `RampDirector` | collections (skins) + light prestige |
| I | the chosen core's row above, unchanged | core's row | core's row | core's row | meta-kit: 2-3 of saga-map / stars / streaks-daily / boosters / collections / decor-renovation / reward track |

The meta-kit is shared and family-agnostic: any family may take any subset, but
a family's default meta shape above is the one to ship unless the pitch asks
otherwise.

### Step 1 — Resolve the six axes

`auto`: apply each Round 1 question's `Auto rule:` from
`references/question-bank.md` §Round 1 — fantasy/setting, **family +
subgenre**, session architecture, primary verb + secondary interaction, art
direction (palette with hex), meta progression shape. No `ask` call.

`interactive`: one `ask` call, the same six questions, Q2 phrased
family-first.

### Step 2 — Resolve systems and content

`auto`: apply the `Auto rule:` for 4-6 Round 2 questions, prioritising
whatever the family playbook flags as critical — roster/piece-set shape,
player power or progression sources, economy, difficulty curve (level-curve
band for B/C-levels/G/H, ramp for J/C-endless, phase-step for A/D/E, cost
growth for F), UI density plan, finale/goal shape, juice level, and for the
casual families the **level count + curve preference**. No `ask` call.

`interactive`: second `ask` call, the same 4-6 questions.

### Step 3 — Structural blockers

`auto`: resolve every Round 3 question via its `Auto rule:` (cheapest option
that satisfies the pitch) and log it in Assumptions. Never ask.

`interactive`: at most 3 questions, only when an answer changes file
structure or systems (persistent hub/base scene? generated levels or fixed
layouts? inventory with equipment slots? multiple playable
characters/vehicles/decks?). Otherwise skip and resolve into Assumptions.

### Step 4 — Scaffold, then write the PRD

```bash
scripts/new-game.sh <slug> "Game Title" --family <code> --no-install
```

`--family <code>` copies the family slice from `src/slices/<family>/` into the
new game and wires its director; a scaffold without it lands the family-A
starter and is wrong for every other family.

Slug: `YYYY-MM-DD-<short-name>` for daily channel games. Then write
`games/<slug>/PRD.md` following `references/prd-template.md` section by section,
taking §2's per-family variant (beat sheet / level curve / ramp table / economy
curve). All sections required; no placeholders, no "TBD".

### Step 4b — Art direction hand-off

Section 11 of the PRD (art direction) is the input to the `game-art` skill: it
must name the palette hex values, shape language, the colour code for
threat/ally/reward, and any asset the template does not already have. Board and
table families additionally name the piece-face set (one legible silhouette per
piece type at 96px) and the board chrome; J names the single hero silhouette
plus its skin variants. The generated template art is a coherent chibi set — a
game that keeps it needs no art work; a game that wants its own look runs
`game-art` with a new `art/style.json` before the build agents start on visuals.

### Step 5 — Self-review, then hand off

Verify against `references/prd-template.md` §Definition of done. Then report:
slug, family code + subgenre, PRD path, the axis decisions in 4-6 lines
(interview answers or, in `auto` mode, the Assumptions summary), the parallel
workstream list, and the verification contract the build must satisfy before it
counts as done:

- `npm run verify` (`template/scripts/verify.sh`): typecheck +
  `npm run sim -- --family <code>` gates + `node scripts/gen-art-registry.mjs
  --check` + every `src/sim/kits/*.selftest.ts`.
- The family's sim gate (bots in `src/sim/families/<family>.ts`, see
  `references/design-heuristics.md` §18): A/D arena and fight bots as today;
  B board solver — every generated level solvable and its win-rate inside the
  §15 band; C/J ramp bot — median session inside the family's window with a
  monotone difficulty curve; E lap bot — completes every track inside the
  target lap time; F economy sim — first prestige in 15-30 min, no dead-air
  gap over 90s in the first 10 min; G/H generator validation — every deal
  solvable, every question/word list validated against its answer key.
- The browser-bot playthrough loop (menu → session → mid-session decision →
  pause → win/lose → retry, screenshotted at each state) — owned and driven by
  the `game-build` skill, not by this one.

Then the exact next commands:

```bash
cd games/<slug> && npm install && npm run dev
```

## Output contract

- `games/<slug>/` — template copy with identity renamed and the family slice wired.
- `games/<slug>/PRD.md` — the spec, including §Build plan.
- Do **not** implement gameplay during this skill's run unless the user asks.
  `template/AGENTS.md` is the build contract the implementing agents follow.

## References

| File | Use |
| --- | --- |
| `references/question-bank.md` | Exact questions, options, per-family defaults per round |
| `references/genre-playbooks.md` | Mid-core families A/D/E: systems, content volumes, numbers, parallel split |
| `references/casual-playbooks.md` | Casual families B/C/F/G/H/J + the shared meta-kit |
| `references/design-heuristics.md` | Session architecture, scaling math, level-curve/ramp/idle math, economy, UI density, performance, family→verification map, build methodology |
| `references/prd-template.md` | PRD structure to fill (per-family §2 variants, per-family content volumes) + definition of done |
| `../../../template/AGENTS.md` | What the template already provides — never spec around it |
| `../game-art/SKILL.md` | Art pipeline: style lock, parallel asset generation, engine wiring |
| `../game-build/SKILL.md` | One-prompt orchestrator: runs this skill in `auto` mode, then scaffold/build/art/integration/verification |
