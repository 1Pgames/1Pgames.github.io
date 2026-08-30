---
name: game-build
description: >-
  Turns ONE prompt into a finished, VERIFIED, PUBLISHED game end-to-end: family
  classification → auto-PRD → scaffold with `--family <slice>` → parallel build
  → art (including map-forge world geometry when the family needs it) →
  integration → family sim gates + browser verification → balance loop → UI
  adaptation → store listing → release gate → user playtest → publish.
  Orchestrates `game-prd` (forced `auto`
  mode), the per-family build workstreams, and `game-art` as parallel subagent
  batches, checkpoints every wave so a dead subagent is reconciled rather than
  ignored, then drives `npm run verify`, a live browser playthrough, a
  mandatory UI-adaptation + overlap/readability audit against the generated
  art, and `scripts/release-check.mjs` — and NEVER flips draft to released
  without a real user playtest: the user plays the local build, feedback is
  applied, and the sign-off is recorded in `game.json.playtest`.
  A pitch in any language is accepted; the storefront it produces is English.
  Use for "make a game about X end to end", "today's game", "сделай игру про X",
  or any single-prompt request for a complete playable game — as opposed to
  `game-prd` alone, which only produces the spec.
---

# Game Build (one prompt → verified game)

This skill is the top-level orchestrator. It never writes gameplay code
itself — it fans work out to `game-prd`, genre build workstreams, and
`game-art` as parallel subagents, then personally owns integration,
verification, and the balance loop. A user who says "make a game about X"
and nothing else gets a scaffolded, art-dressed, sim-balanced,
browser-verified game with no further questions asked.

Fixed decisions (same as `game-prd`, never re-derive): portrait 720x1280,
Phaser 4.2 + Vite + TypeScript template, 5-10 minute sittings, one-thumb +
keyboard input, parallel build with one integrator. Everything else that looks
global — session length, director, camera, input verb, meta shape — is a
**lookup on the family code** (`game-prd` §Step 0b), never a project default.

## Family routing (do this before anything else)

`game-prd` Step 0 resolves exactly one family from the pitch; every step below
is keyed on it. **The canonical family table — letter code ↔ `--family` slice
name ↔ director ↔ sim gate — lives in `skill://game-prd` §Step 0 ("Tier 1 result
— the canonical family table") and is not repeated here.** Read it there; if this
skill and that table ever disagree, that table wins.

Two consequences worth stating twice:

- `--family` takes the **slice name** (`arena` `board` `side` `track` `idle`
  `table` `word` `hyper`), never the letter code. A bare letter after the flag
  is always a bug — the scaffold rejects it as an unknown family.
- A build that scaffolds without `--family` silently lands family A's arena
  slice and is wrong for every other family — the single most expensive mistake
  in this pipeline. Confirm the landed slice (`src/slices/` holds exactly one
  dir, `src/sim/family.ts` names it) before spawning anyone.

## Agent roster (specialists, not generic `task` workers)

Project agents live in `.claude/agents/*.md` (mirrored at `.omp/agents`);
each carries its contract, owned
surfaces and hard rules in its own system prompt, so a dispatch names WHAT to
do, never re-teaches HOW. The agents are GENRE-AGNOSTIC by design: role and
method live in the agent, the genre's law flows in from the game's own
artifacts (PRD §1b dossier, family playbook, heuristics family math,
AGENTS.md contract) — the same roster builds a casual puzzle today and a
survival extraction shooter tomorrow. Spawn the specialist, not `task`:

| Agent | Owns | Dispatched at |
| --- | --- | --- |
| `game-designer` | Step 0c research, §1b dossier, PRD content tables, design-drift review | Step 0 (with `game-prd`), mid-build design questions |
| `level-designer` | the family's progression data (ladders / waves / ramps / economy curves), slice tuning, `sim/families/<slice>.ts`, balance loop | Step 1 wave, Step 4 |
| `gameplay-programmer` | `core/**` engines, slice gameplay logic, sim-model parity, selftests | Step 0.7 greybox, Step 1 wave |
| `ui-engineer` | scenes, UI chrome, HUD, coach wiring, every Step 5.5 fix | Step 1 wave, Step 5.5 |
| `fx-artist` | game-feel wiring: juice/sfx/tween timing, transitions, skip paths, the §13 feel budgets made real | dedicated feel pass after Step 3, before qa |
| `ux-flow-designer` | PRD §14b flow map (scene graph, tap-depth, interruption matrix, edge states); flow audit of the built game | Step 0 (with game-designer), flow audit before the critic |
| `art-director` | vision board + anchors (Step 1b), interface direction: UI palette / HUD plan / chrome spec (Step 1c, revises PRD §11+§14), `art/style.json`, generation + QC, manifest, cover/og, icon sheets | Step 2 — vision lock + Step 1c land FIRST (early deliverable ui-engineer waits on) |
| `content-writer` | naming lexicon, all player-facing copy, store listing strings | Step 1 wave (parallel), Step 6.1 |
| `build-integrator` | seam reconciliation, GameScene wiring, registry, the ONLY `npm run verify` runner, boot smoke | Step 3 |
| `game-qa` | golden-path E2E, invariant scans, bug repro/minimization, regression re-checks | Step 5, after every fix round |
| `game-critic` | persona playtests (novice/veteran/masher), feel verdict vs §1b bar | Step 0.7 greybox verdict, after Step 5.5, before EVERY user handoff |
| `code-reviewer` | diff review vs AGENTS.md contract + traps + ownership | between Step 1/2 landing and Step 3 |

The internal loop before ANY user handoff: build waves → `code-reviewer` →
`build-integrator` → `fx-artist` feel pass → `game-qa` (incl. quality-budget
measurements + the `ux-flow-designer` flow audit) → fixes (routed to the
owning specialist) → `game-critic` verdict — repeat until qa has zero
BLOCKERs, every quality budget measures inside its band, and the critic says
SHIP. The user's playtest starts where the internal rounds ended, not before
them.

## Non-negotiable rules

1. **Family first, and never interview unless the user asked to be
   interviewed.** `game-prd` is always invoked in `auto` mode from this skill
   (see `skill://game-prd` §Modes) — zero `ask` calls, family read
   semantically from the pitch in whatever language it arrived in (Step 0, no
   keyword scoring), every other axis resolved from that family's defaults,
   logged in PRD §18 Assumptions.
2. **Real concurrency, not padding.** Build workstreams from PRD §16 run as
   one `task` batch, and only after Step 1a's contract-freeze wave is `done` —
   a contract authored in the same batch as its consumers is not frozen.
   Ownership inside the batch is per FILE and exclusive, reconciled against
   §16 before the batch spawns (§Ownership reconciliation); `game-art` groups
   run
   as a second batch overlapping the build batch wherever their file
   ownership is disjoint — art owns `art/` and `public/assets/generated/`,
   build workstreams own `src/objects/`, `src/systems/`,
   `src/data/{enemies,upgrades,waves}.ts` and `src/ui/*`. `src/data/art.ts`
   belongs to **nobody**: it is generated by
   `node scripts/gen-art-registry.mjs` at integration time (Step 3) and is
   never hand-written by an art group, a build workstream or the integrator.
   Neither batch runs `npm run build`/`typecheck`/`verify` mid-flight — that is
   the integrator's job, after both batches land.
3. **One integrator, one verification pass.** This skill (or a single
   integrator subagent it spawns) wires the slice's `GameScene`, generates the
   art registry, and is the only step that runs `npm run verify`.
4. **The balance loop is bounded.** Sim → tuning edit (the slice's
   `tuning.ts`, or `TUNING` for arena) → re-sim, maximum 3
   iterations. After 3, ship the best iteration and say so in the report —
   never iterate unbounded, never silently ship a failing hard gate.
5. **The browser loop is mandatory and spelled out.** A game is not "done"
   until it has been driven end-to-end in a real browser tab with
   screenshots at every state (Step 5). Sim gates prove balance; the browser
   loop proves the game actually renders and responds to input.
6. **Failure degrades gracefully, never silently.** See §Failure policy —
   every fallback is reported in the final Assumptions/report, never hidden.
7. **The storefront is English-only.** `game.json`'s `title`, `genre`,
   `description`, `prompt` and every string a player reads are English. A
   non-English pitch is classified as-is, then translated to English at scaffold
   time; the verbatim original is preserved only in `PRD.md`'s
   `Original pitch:` header line. `node scripts/release-check.mjs <slug>`
   rejects Cyrillic in those manifest fields, so a Russian description does not
   ship — it fails the release gate.
8. **Nothing ships from an unknown state.** Every wave is checkpointed in
   `games/<slug>/build-state.json` and a dead subagent is reconciled before
   integration — see §Checkpoints and dead agents.
9. **UI adaptation to the game's own art is a build step, not polish.** The
   template UI is designed against its dark procedural gradient; the moment
   `game-art` swaps in generated backdrops/pieces, every text layer and
   surface must be re-fit to that art (Step 5.5): per-game palette, contrast
   armour, scrim, and an overlap audit of every screen. A game that ships
   template chrome over bright generated art is not done.
10. **A user playtest gates every release — AND every commit.** No `git
    commit` and no `git push` happen anywhere in this pipeline before the
    user has played the build and signed off. The build's audit trail during
    development is `build-state.json` plus the working tree, never commits;
    the FIRST commit of a build is made in Step 6.5 Publish, after
    `playtest.approved: true` is recorded and `release-check.mjs` exits 0.
    `release-check.mjs` hard-fails without that field, and it is only written
    after a human actually played the build and their feedback was applied
    (Step 6.3). In a headless/non-interactive run the game stays `draft`,
    nothing is committed or pushed, and the report carries the ready-to-play
    URL — releasing or deploying without a playtest is not an option the
    orchestrator has.
11. **Never `to:"all"`, and never at finished work.** A message is an
    INTERRUPT: it lands mid-write, including mid-`yield`, and destroys what it
    lands on. Address named recipients whose owned files the message actually
    changes; check `build-state.json` `waves[]` first and never message an
    agent whose row is `done` or whose job is settling. See §Orchestrator
    conduct — this rule cost one build its critic verdict six times over.
12. **Measure before you act on the environment.** Any claim that the
    provider, the tool or the whole set is broken gets BISECTED to a minimal
    reproducer and falsified once before it reaches another agent or becomes a
    standing order. Four agents "confirming" a phantom outage is one agent's
    frame, copied four times.
13. **Every agent is dispatched with the tools its job requires.** A
    generation agent without `generate_image` shells out to nested sessions and
    produces unreviewable work. `tool-missing` is a dispatch bug, not an agent
    failure (§Dispatch preflight, §Failure policy).
14. **Every gate carries a hard timebox and an interim-verdict protocol.** A
    gate with neither becomes the critical path: a "3-minute verdict" once ran
    30m10s and blocked four workstreams (§Gate timeboxes).
15. **Nothing is "green" until the gates have been reconciled against each
    other** (Step 5.8). Four systems measured one design defect in four
    vocabularies and every gate reported green or "flagged"; the game shipped
    with its endgame unreachable.
16. **Every driven run is SILENT, and no run produces side effects on the
    user's machine that the user did not ask for.** Every browser URL this
    pipeline or its agents open, navigate to or reload carries `?mute=1`, the
    run asserts `window.__AUDIO__().forcedByUrl === true`, and audio coverage is
    kept by ASSERTION (`requested`/`played` counters) rather than by playing it
    aloud. Silence is never achieved by writing the persisted `muted`
    preference — that mutates the save and corrupts the wiped-save FTUE run.
    The single exception is the URL handed to the human for the Step 6.3
    playtest. A user who has to interrupt a run to stop the harness is a
    BLOCKER-class defect (§Side effects on the user's machine).

## Workflow

### Step 0 — Family classification + auto-PRD + scaffold

Invoke `skill://game-prd` in `auto` mode (never interactive) with the user's
pitch verbatim. It performs, in this order:

1. **Step 0 two-tier classification** — Tier 1 reads the pitch's actual loop
   (semantic, language-independent; the keyword column is a tiebreak aid, not a
   score) and yields one family; a vague, brandless or verb-less casual pitch
   takes the HYBRID DEFAULT (**I**: casual core from J/B/F + 2-3 meta-kit
   layers), never a mid-core fallback and never plain match-swap. Tier 2 locks
   the subgenre from that family's playbook —
   `references/genre-playbooks.md` for A/D/E, `references/casual-playbooks.md`
   for B/C/F/G/H/J, both for I.
2. **Step 0b fixed decisions** — session shape, input profile, camera,
   director and meta shape, all looked up on the family.
2b. **Step 0c genre research (mandatory).** A live market/mechanics research
    pass on the subgenre (3-6 `web_search` calls, ~10 min budget): reference
    titles, mechanics inventory incl. special-combo matrices and obstacle
    taxonomies, numbers (budgets, attempt tiers, mercy), retention surfaces,
    one differentiation axis — distilled into the PRD's §1b Genre dossier
    with a ≥8-row staples checklist (`adopt` by default, every `cut`
    justified). The dossier drives §5 content floors upward
    (`max(playbook, dossier)`) and sizes §16 workstreams — this is what makes
    every game content-rich instead of template-shaped. Offline/headless →
    playbook-cached dossier, flagged in §18; a PRD without §1b is a defect
    and blocks Step 1.
3. **Scaffold** — the full command, every flag present:

   ```bash
   scripts/new-game.sh <slug> "Title" \
     --family <slice> \
     --prompt "<english prompt>" \
     --genre "<english genre>" \
     --desc "<english one-liner>" \
     --no-install
   ```

   It copies the template, prunes every other `src/slices/*`, rewrites the
   `src/scenes/game.ts` re-export, writes `src/sim/family.ts` (`SIM_FAMILY`) so
   a bare `npm run sim` runs the right gates, prunes the
   `public/assets/generated/<group>/` dirs outside the slice's `ART_GROUPS`,
   re-runs `gen-art-registry` over what is left (so `--check` is green from the
   first commit) and writes `games/<slug>/game.json` with `"status": "draft"`.

   **Translation rule.** `--prompt`, the positional `"Title"`, `--genre` and
   `--desc` are **English**. An English pitch goes into `--prompt` verbatim; a
   non-English pitch is translated faithfully (translate, do not rewrite or
   expand) and the untouched original is written into `PRD.md` as its
   `Original pitch: <verbatim original>` header line — never into `game.json`.
   Classification happens before translation, on the original wording.
   Omitting `--prompt`/`--genre`/`--desc` ships an empty storefront card and
   fails the release gate; `--family` takes the slice name, never a letter.

The result is `games/<slug>/PRD.md` with the family code in its header, the
§1b Genre dossier, a complete §16 build plan, §18 Assumptions log and §19
acceptance criteria — the contract for every following step. Read it fully
before fanning out, and
confirm the scaffold actually landed the right slice (`src/slices/` holds one
dir; `src/sim/family.ts` names it) before spawning anyone. §16.1's frozen
interface contracts and §12.2's drift surface are law for every workstream.

**Mechanical PRD gate.** Before fanning out, run
`node scripts/audit-check.mjs <slug>` — it checks the PRD's load-bearing
sections mechanically (§1b dossier row floor, §13 feel table, §14b flow
blocks, §17 cut list, §18 assumptions; later runs also shape-check
`build-state.json`). `SPEC INCOMPLETE` blocks Step 1 exactly like a missing
§1b: route the gaps back to `game-designer`, fix the PRD, re-run the script,
then spawn the waves.

### Step 0.7 — Greybox fun gate (find the fun before building the game)

The slice already boots as a playable core; the PRD names this game's twist.
Prove the twist is FUN before six workstreams build on top of it:

1. One `gameplay-programmer` wave (checkpoint `greybox` in
   `build-state.json`): re-point the slice's core verb at the PRD's variant
   and prototype the §1b differentiation axis — placeholder art, slice
   `tuning.ts` numbers, nothing else. When the axis has two credible
   readings, build BOTH behind a tuning flag instead of debating them.
2. Boot it in a browser tab (Step 5's `hub` recipe) and hand it to
   `game-critic` for a verdict against the §1b reference bar: does the core
   verb generate decisions, tension and payoff on its own — before art, meta
   and balance exist to dress it up? With two variants the critic picks one;
   the loser's flag is deleted, not left to rot. **Dispatch it with the 5-minute
   timebox and the interim-verdict line from §Gate timeboxes verbatim** — this
   is the gate that ran 30m10s and blocked four workstreams — and while it runs,
   do not message it and do not broadcast (§Message discipline).
3. `FUN` → freeze the twist's final shape into the §16.1 contracts, land them
   as the Step 1a contract wave, and fan out Step 1b. `NO-FUN` → route the
   critic's evidence to `game-designer`,
   re-spec §4/§5, re-run `audit-check.mjs`, rebuild the greybox — ONCE. A
   second NO-FUN ships the stronger variant anyway, with the verdict quoted
   in §18 Assumptions and the final report: bounded like the balance loop,
   never an unbounded design spiral.

### Step 1 — Contract freeze, then parallel build workstreams

#### Step 1a — Contract freeze (its own wave, `done` before 1b spawns)

A contract handed out by the same batch that authors it is not frozen: five
consumers start against a type that does not exist yet. Every review blocker in
the Duskhaul build was one shape — a workstream built its half correctly and
the seam was never connected (`finish()`↔`GameOverScene.init()`, `StatKey`
implemented twice against disjoint key sets, `ui/coachBeats.ts` with zero
importers, `bag.pinCasket()` with no call-site).

1. Name ONE **seam owner** for the wave — `build-integrator`, or the
   `gameplay-programmer` who will own `core/**` if the integrator is not
   spawned yet. Nobody else writes the contract surface, in this wave or any
   later one.
2. The seam owner lands DECLARATIONS ONLY, in real files: `core/keys.ts` event
   names, the `StatKey` union, `TUNING` keys, the `GameOverData`/results
   payload types, content id sets, and the empty-but-typed shapes of every
   shared data table. No behaviour. This is a minutes-long wave, not an hour.
3. Every PRD §16.1 entry names **producer `file:symbol`** AND **consumer
   `file:call-site`** (`skill://game-prd` §16.1 carries the same requirement).
   An entry with no named consumer call-site is a wish, not a contract: route
   it back to `game-designer` and fix the PRD before spawning anyone.
4. **Freeze check before fan-out:** for every §16.1 row, both named paths
   exist on disk (the consumer may be a stub, but the file and the function
   must exist) and both are covered by exactly one workstream's ownership
   globs. `npm run verify`'s consumer-edge stage proves the same edge after the
   build lands — the contract is the plan, that stage is the proof.
5. Close the wave in `build-state.json` `waves[]` (`status: "done"`), THEN
   spawn 1b. Consumers spawned against an unfrozen contract are the single
   most expensive rework in this pipeline.

#### Step 1b — Parallel build workstreams

Read PRD §16 (Build plan). Fan out one `task` per workstream (4-6, per the
PRD) in a single batch, each given:

- Its owned files only (§16's "Owns files" column) — no workstream may edit
  a file another workstream owns, and none may edit the frozen-contract
  surface (`TUNING` keys, `StatKey` union, `core/keys.ts` event names,
  content id sets) except the seam owner.
- The full §16.1 interface contracts verbatim, as a shared, unchanging
  context block — every sibling task batch call gets the identical text so
  nobody renegotiates a type mid-flight.
- An explicit instruction: no `npm run build`/`typecheck`/lint/test; prove
  your own slice only (module instantiates, data table type-checks in
  isolation).
- A hard timebox and the interim-verdict line (§Gate timeboxes) — a
  workstream that runs long reports what it has, it does not run silent.
- The family's own surfaces: gameplay work happens in
  `src/slices/<slice>/game.ts` and its local `tuning.ts`/level/content modules,
  never by editing `src/scenes/game.ts` (a one-line re-export) and never by
  moving family numbers into `src/config.ts`. Shared modules —
  `core/{session,run,level,ramp,lap,economy,collections}.ts`,
  `core/board/*`, `ui/{sagaMap,boosterBar,hand,shopTray}.ts`,
  `core/{turns,deck,autobattle}.ts`, `systems/{placement,board}.ts` — are
  imported read-only, not re-implemented or forked per game.

Two batch-shaping rules, both paid for in the Duskhaul build:

- **The ownership map is reconciled before the batch spawns** (§Ownership
  reconciliation). `build-state.json`'s globs are derived mechanically from
  §16's column; when the two disagree the PRD wins and is amended. Duskhaul's
  two maps disagreed and left `src/systems/combat.ts` owned by nobody — it was
  written by whoever got there first and reviewed by no one.
- **One glob, one owner, one wave.** If five agents need `src/ui/**`, split it
  by FILE at plan time or give it to one agent. Re-dispatching the same glob to
  a fresh owner five times in a row is a decomposition bug, and every hand-off
  pays a full context to re-read the same files.

### Step 2 — Art in parallel

Invoke `skill://game-art` as its own subagent (or its own `task` batch
following that skill's Step 1-3) **in parallel with Step 1** whenever their
file ownership is disjoint — which it is by default (art never touches
`src/objects/`, `src/systems/`, or `src/data/{enemies,upgrades,waves}.ts`;
build workstreams never touch `art/` or `public/assets/generated/`).

- Style lock (`game-art` Step 1, `art/style.json`) happens first, before any
  generation — it has no dependency on the build batch and can start the
  instant the PRD's §11 Art direction section exists. It is also a release
  BLOCKER: `release-check.mjs` fails a `style.json` that is still the scaffold
  profile (`scaffold: true`, the scaffold name/artStyle) or that has an empty
  `references[]` while generated art exists. An art wave that generates before
  the lock lands ships a different game's look — this pipeline came within ten
  minutes of 103 chibi assets in a grimdark game.
- **Manifest lint is a HARD GATE before the generation batch spawns** — the
  cheapest gate in the pipeline, and the only one that runs at fan-out width.
  Both validators ship under the `game-art` skill and the cwd is the game
  project root (`games/<slug>/`), so RESOLVE the skill dir instead of guessing
  a relative depth — and never assume a `skill://` target lives under
  `.claude/skills/` (`skill://sprite-forge` resolves into a separate tool repo,
  which is how one agent filed a false "feature absent" claim):

  ```bash
  REPO="$(git rev-parse --show-toplevel)"
  python3 "$REPO/.claude/skills/game-art/references/manifest-lint.py" art/manifest.json
  ```

  *Measured 2026-08-30, do not "simplify": `$(realpath skill://game-art)` works
  only inside the omp `bash` tool, which resolves internal URIs before the
  shell sees them. In a plain shell — a `browser`-run sandbox, a script, a
  subagent shelling out — `realpath` exits 1, the substitution is EMPTY, and
  the command becomes `python3 "/references/manifest-lint.py"`: the gate never
  runs. `git rev-parse --show-toplevel` was verified in both environments.
  The one case where `realpath` is unavoidable is a script in a DIFFERENT repo
  — `skill://sprite-forge` lives outside this tree and has no `$REPO`-relative
  path — and such a command MUST be labelled "run through omp's `bash` tool,
  not a raw shell". Everything under `skill://game-art` is in this repo and
  uses the `git rev-parse` form.*

  Exit 0 (warnings allowed) is required before a single generation agent is
  dispatched. **Exit 1 means the lint RAN and found `E`-level defects — fix the
  manifest. Exit 2 means the lint could not run — fix your command.** Never
  read a 2 as a pass. Every `W` finding is answered in the
  wave report, never ignored. Two reasons this is orchestrator work and not an
  art group's: a manifest defect is MULTIPLIED by the fan-out width (one
  `writeScaleProfile` binding that resolved to nothing was independently
  rediscovered by 3 of 12 generation agents, each burning a full investigation,
  while every sibling drift gate sat inert and green), and the lint is also the
  STOP that keeps a scaffold-default style lock from ever reaching a generation
  call — a scaffold lock does not fail, it succeeds at building the wrong
  game's art. Fix the manifest, re-run, then spawn. This is §Dispatch preflight
  item 2 with an executable.
- **An art group is not accepted until the figure/ground gate has been run on
  its scenes.** Per-asset QC structurally cannot see this defect class: every
  other gate measures ONE asset against a PROFILE, so nothing ever compared a
  backdrop against the actors drawn on it. A 103-asset audit returned an EMPTY
  reject list and "I would ship this set" while `zone-desert/floor-desert`
  shipped at 27.45% clash and 2.39x the set's readability rail. Require the
  every-scene form in each group's sign-off:

  ```bash
  python3 "$REPO/.claude/skills/game-art/references/figure-ground.py" \
    --scene <zone-a> --actors <a's complete cast ...> --fields <a's floors/backdrops ...> --grade <hex> \
    --scene <zone-b> --actors <b's complete cast ...> --fields <b's floors/backdrops ...> --grade <hex> \
    --manifest art/manifest.json
  ```

  Three invocation rules decide whether the numbers mean anything: `--grade`
  carries the scene's real runtime tint (a floor drawn through `setTint()` is
  not the authored tile — Duskhaul's tint moved a field's mean from 0.4630 to
  0.2460, and this also covers the post-review `FLOOR_GRADE` trap); `--fields`
  is FIELD assets only — the things actors are drawn ON TOP OF, never walls,
  props, sprites, icons, FX or UI; and `--actors` is the scene's COMPLETE cast,
  because a partial cast moves the actor p90 boundary and is a different
  criterion, not a conservative one (12.85% on the full cast vs 20.04% on half
  of it). A FAIL is regenerated, never excepted; a WARN ships only with a
  matching `{ "id", "reason" }` entry written into
  `art/manifest.json.qcExceptions[]` — the FILE, not a report (26 exceptions
  once lived only in prose while the manifest held 6). Quote the population
  with every number.

  **The exit code is the verdict, and it is unambiguous by construction.**
  0 = clean; **1 = the gate RAN and at least one scene FAILED — fix the art**;
  **2 = the gate could not run — fix your command** (unknown flag, a path
  before `--actors`/`--fields`, a `--grade` count that matches no field count,
  a missing sheet, a bad hex, an actor sheet with no opaque pixels). Both
  validators share this contract. *Provenance: as first shipped, a mistyped
  flag exited 1 and was indistinguishable from broken art — measured
  2026-08-30 and fixed at the source; do not "restore" a rule that reads a 1
  as possibly-a-typo, and do not gate on stderr text.*
- If the genre needs authored world geometry — tower-defense lanes,
  base-builder plots, dungeon-crawler floors, extraction-run rooms — run
  `skill://map-forge` for the map bundle (collision, zones, scene hooks)
  alongside the sprite/UI generation groups; it produces engine-neutral
  geometry that the Level/systems build workstream consumes directly (never
  hand-estimate collision when `map_trace_geometry` can derive it).
- **Key art is a required deliverable, not a nice-to-have.** `game-art`'s cover
  step produces the store cover; the integrator saves it as
  `public/cover.png` (1024x1536, the 3:4 key-art frame from `game-art`'s
  cover step) and `games/<slug>/shots/og.png` (1200x630 social
  crop) and points `game.json.cover` at `cover.png`. The scaffold's gradient
  `public/cover.svg` is a **draft-only** placeholder — a release with it still
  in `game.json.cover` fails Step 6's release gate.
- The art registry generator (`scripts/gen-art-registry.mjs`, producing
  `src/data/art.ts`) is an **integration-time** step, not a Step 2
  deliverable — it runs once, in Step 3, after both the art assets and the
  data tables they reference exist. No art group and no build workstream ever
  edits `src/data/art.ts` by hand; the generator is the only writer, and
  `--check` in `npm run verify` is what proves the file matches the manifest.

### Step 3 — Integration

One integrator (this skill directly, or a single dedicated `task`):

1. Wire the slice's `GameScene` (`src/slices/<slice>/game.ts`, re-exported by
   `src/scenes/game.ts`): session director → gameplay systems → UI →
   `GameOverData.stats`, per `template/AGENTS.md` §"Gameplay families and
   slices" and §"How to implement a PRD", and the PRD's §16.1 contracts.
2. Run `node scripts/gen-art-registry.mjs` to produce/refresh
   `src/data/art.ts` from the art pipeline's manifest and exported sheets.
3. Run `npm run verify` (`template/scripts/verify.sh`). Its stages run IN
   ORDER and each reports independently — none short-circuits the rest, and
   the exit code is aggregated at the end: **typecheck → content contract
   check → consumer-edge check → art registry `--check` → kit selftests → sim
   gates LAST**. The sim gates run last precisely because they are the stage
   that legitimately ships flagged; in an earlier ordering their failure
   skipped the registry check and all nine selftests. The **consumer-edge**
   stage is the one that catches this pipeline's most expensive defect class:
   every exported symbol in a workstream-owned dir must have an importer
   outside its own dir, and every TUNING path the contract names must have at
   least one reader in `src/`. Fix and re-run until clean, or escalate per
   §Failure policy.
4. **The art seam is wired by the integrator and OWNED by `art-director`.**
   The integrator has no `generate_image`: it can point a texture key at a
   sheet, but it cannot produce, re-roll or QC one. In the Duskhaul build the
   integrator held the art seam anyway, so a missing/failed asset had no route
   back to a tool that could make it and became a registry hole. Rule: any
   finding that requires a NEW or RE-GENERATED asset is dispatched back to
   `art-director` (which mounts the tool and the QC gates) with the exact key,
   size and slot; the integrator records it as a pending seam in
   `build-state.json` and never substitutes a procedural placeholder silently
   (see §Failure policy for the one legal fallback and its `qcExceptions`
   entry).

### Step 4 — Balance loop

1. `npm run sim -- --family <slice>` — capture the family's gate table (arena
   also takes `--lane all --json` for per-lane winrate, `firstUpgradeS` and
   decision cadence).
2. Check that family's hard gates, per
   `skill://game-prd/references/design-heuristics.md` §18's
   family→verification map (§5.5 for arena's lane gates): board = every level
   solvable by the greedy solver, tutorial and floor win rates above their
   thresholds, skill beating chance; hyper = session length inside the family
   window across the skill sweep; idle = economy curve plus the first-prestige
   floor; table = dice win rate inside the band; word = bank integrity plus
   accuracy-bot spread; side = every generated level analytically possible plus
   hop-bot completion; track = lap completion plus bot spread.
3. If any gate fails: edit the offending numbers in the slice's
   `src/slices/<slice>/tuning.ts` (or `TUNING` in `src/config.ts` for arena) —
   an integrator-only edit, per the frozen-contract rule — and re-run the sim.
4. Repeat steps 1-3 for a maximum of **3 iterations**. After 3, stop, ship
   the best iteration, and flag the remaining gate failures explicitly in
   the final report — do not iterate unbounded.
5. **Sim-vs-live parity — run it before any sim number is trusted.** The sim
   is a SECOND implementation of the rules and it will certify a game that does
   not exist: `src/sim/families/arena.ts` passed the gate "every upgrade-card
   modifier targets a stat the run model reads" by measuring the SIM's reader,
   not the scene's, while the shipped scene ignored 8 modifiers. Pick the three
   numbers this family's hard gates depend on (arena: time-to-first-upgrade,
   contested-channel duration, floor-bot run length), measure the same three in
   the live browser tab from the same starting state, and record a parity
   table: `metric | sim | live | delta%`. **Any gate-bearing number off by more
   than 25% means the SIM is wrong, not the game** — fix the sim model before
   tuning anything with it. Measured in Duskhaul: contested channel 17.4s in
   sim vs 35-40s live, and the balance loop tuned against the 17.4s.
6. **A gate that asserts something about the SCENE must read the SCENE.** If
   the assertion is "the game reads this stat / registers this effect id /
   spawns this content", the check imports the scene's own symbol or it is not
   a gate — it is a sim selftest. Label it as such and move the real check into
   `verify.sh`'s consumer-edge stage, which reads `src/**`.
7. **Floor-bot calibration.** The weak-human floor bot must be measurably
   WORSE than a real novice: compare its run against `game-critic`'s recorded
   novice-persona run on the same build. If the bot survives longer, the floor
   gate is certifying a difficulty nobody experiences — re-tune the bot
   (reaction delay, aim error, idle frames) until it lands below the critic's
   measured run, and record both numbers in the report. Duskhaul's floor bot
   outperformed the human; its "playable at low skill" gate meant nothing.

### Step 5 — Browser bot procedure

Drive the actual running game; this is not optional and not simulated.

1. `hub` `op:"start"` — for the interactive fix-and-look loop, launch `npm run
   dev` in `games/<slug>/` with `ready: { port: 5173, log: "Local:.*http",
   timeout: 30 }` (adjust the port if the template's Vite config differs). For
   every **multi-minute automated run** — the Step 5.7 cert, the fuzz sweep,
   balance deep-runs, the critic's playthrough — serve the BUILT bundle
   instead: `npm run build && npm run preview -- --port 5322`. A Vite HMR
   reload fires on any sibling's save and silently restarts the game mid-run,
   destroying the run AND its evidence; several of this pipeline's longest runs
   died exactly that way and were re-run blind. Drive it with the shipped
   harness (`scripts/cert-driver.mjs`: `runCert`, `runFuzz`, `adapters`;
   `scripts/preview-capture.mjs`: `startPreview`/`finishPreview`) — never
   hand-roll a browser driver stub. Three agents independently reinvented the
   same stub in one build; a missing helper is ADDED there once and announced,
   not re-written per agent.
2. Open a `browser` tab at the dev/preview server URL **with `?mute=1`** — e.g.
   `http://localhost:5322/?mute=1`. Every URL this step or any dispatched agent
   opens, navigates to or reloads carries it (§Side effects on the user's
   machine): the game runs on the USER's machine and must make no sound they
   did not ask for. Assert `(await tab.evaluate(() => window.__AUDIO__()))
   .forcedByUrl === true` right after the first load; a dropped param is caught
   by that assertion instead of by the user.
3. Menu screenshot — confirm title, palette, and how-to-play copy match the
   PRD's real verb for this family.
4. Start a session; screenshot early gameplay; verify the family's live HUD is
   ticking (timer/moves/goal/score/currency, per the family) via
   `tab.observe()` or a second screenshot a few seconds later.
5. Drive the family's own loop with `tab` input (click/drag/keyboard per the
   PRD's §3 Controls) and screenshot each beat below. The checklist is per
   family — do not run arena's draft steps on a family that has no draft:

   | Family | Mandatory browser beats |
   | --- | --- |
   | A arena | first level-up upgrade draft (incl. the one-per-draft reroll) → pick a card → field resumes |
   | B board | play **2 levels** through to their goals; there is no upgrade draft — verify the goal and move/timer budget update per move, and one level ends in a loss (out of moves) |
   | C side | clear **level 1** end to end; verify the hold-to-climb variable-height jump and the level-complete/door state, plus one death → same-level instant retry |
   | E track | complete **1 full lap**; verify lap counter, checkpoints and steering |
   | F idle | **buy** a generator, **collect**, then **automate** (manager/prestige); verify offline/accrual numbers move |
   | G table | **roll to a resolution** — one win and one loss reachable from the deal/roll loop |
   | H word | complete a **full quiz/puzzle** including one wrong answer, to the results state |
   | J hyper | **3 deaths** in a row, each with an **instant retry** back to playable (target under 2s) |
   | D cards | the composed kit loop: draw/play or place → turn resolves → fight/node index advances → match ends |
   | I hybrid | the casual core's row above, **plus** each meta-kit layer the PRD shipped (saga map, stars, streak, collections, boosters) |

6. Pause, screenshot the pause state, resume — the director's clock must stop
   and resume, not the wall clock.
7. Play to both a win **and** a loss (family F has no loss — ascend instead);
   screenshot the results screen and confirm its `ResultStat` rows are this
   family's stats, not arena's kills/level.
8. Retry; confirm a fresh session starts cleanly.
9. Any state that fails to render, mis-renders, or does not respond to
   input → fix the owning file, restart the dev server if needed, repeat
   from the failing state — never skip a state or claim success without its
   screenshot.

### Step 5.5 — UI adaptation + overlap/readability audit (mandatory)

The browser loop proves the game runs; this step proves a player can READ it.
Run it after Step 5, on the same live tab, using the Step-5 screenshots as the
audit corpus. The template's own slices under `template/src/slices/` are the
reference implementation of every fix pattern below.

1. **Palette fit.** `PALETTE`/`CSS` in `src/config.ts` implement the
   art-director's interface direction (game-art Step 1c: sampled from the
   locked vision anchors, contrast-checked, recorded in PRD §11/§14) — not
   the template navy and not values invented in code. If no Step 1c pass
   exists yet, treat that as the defect: request it via hub, don't
   re-derive by eye. Keep gameplay identity colours (piece kinds, team
   colours) as literals locked to the art in the slice's `tuning.ts` —
   retheming UI chrome must never recolour gameplay coding.
2. **Contrast armour.** Every `TEXT` preset carries a dark stroke + soft drop
   shadow tuned to the game's darkest background tone, so copy survives on top
   of busy art. Components that draw text on their OWN surface (buttons, saga
   nodes, any pill/panel-backed label) strip the armour
   (`stroke: undefined, strokeThickness: 0, shadow: undefined`) — armour on a
   self-surfaced label reads as grime.
3. **Scrim.** If the slice draws text straight over a generated backdrop, add
   a readability veil in `src/ui/background.ts` (full-frame ~0.45 alpha of
   `bgDeep`, heavier top/bottom bands where HUD and results live) so the art
   stays visible mid-frame while ink text keeps ≥ 4.5:1 contrast.
4. **Overlap audit — every screen, one screenshot each.** Menu, level/saga
   map, shop/meta, gameplay HUD, pause, win results, loss results, booster or
   draft picker (whatever the family ships). Check each against:
   - the site shell's back-link + prompt chips own the top-left ~315x75 design
     px on EVERY published page — no in-game text or tappable element may sit
     under them (centre or right-anchor top-band HUD, or drop it below y≈90);
   - `SAFE` bands respected: nothing interactive above `SAFE.top` corners or
     below `VIEW.height - SAFE.bottom` except the shell's own chrome;
   - no element overlaps another at worst-case animation offsets (idle bobs,
     count-up text growth, two-line titles from the scaffold's stacked-title
     rule);
   - every tappable control actually receives the tap — Phaser hands the
     pointer to the TOPMOST object only, so a scroll zone or overlay created
     after buttons swallows them (the template meta shop shipped exactly this
     bug; its fix — zone created before the rows — is the canonical pattern).
5. **FTUE / tutorials (mandatory in every game).** A player who has never
   seen the game must be taught by the game itself, Royal-Match style:
   - a first-session coach-mark sequence on the first level (dim + spotlight
     + one-line copy): the goal surface, the resource (moves/timer/lives),
     and a GATED first action — spotlight a real valid move and only accept
     that input;
   - every NEW mechanic (blocker type, booster surface, special) gets a
     one-beat callout on the level where it debuts, never earlier;
   - each beat shows exactly ONCE per save (persisted flags), never stacks
     with another beat, pauses the game while visible, and survives the
     shutdown trap (clean destroy);
   - the audit plays the FTUE on a WIPED save and screenshots every beat; a
     game with no tutorial fails this audit outright.
   The component SHIPS in the template — `template/src/ui/coach.ts`
   (`showCoach`/`hasSeenCoach`, `'tap'`/`'swap-gate'` modes) — so a build
   only writes the WIRING (which beats, which targets, which copy);
   `template/src/slices/board/game.ts` is the reference wiring. Never build a bespoke tutorial overlay.
6. **Contract audit.** Walk `template/AGENTS.md` §Non-negotiable rules AND
   §Quality budgets row by row against the Step-5 screenshots and game-qa's
   measurements — every rule there is playtest-derived law (modal close,
   results CTA, scrolling lists clip, icon-first economy surfaces,
   stats-match-loop, overlap, readability, FTUE, ack ≤100ms, no swallowed
   input, transition/tempo bands, flow-map fidelity…). The PRD's §1b
   Genre dossier is part of the same audit: every staple marked
   `adopt`/`adapt` MUST exist in the shipped game — a dossier row without a
   shipped implementation is a build defect, not a spec footnote (this is the
   content-richness gate). A violation is
   a bug even if this game's user has not complained YET — a previous one
   already did. New findings from THIS game's playtest are routed per
   `references/playtest-lessons.md` (a fixed-size routing protocol, not a
   grow-forever list): merged into the bounded artifact that owns their
   kind — contract rule, playbook number, Phaser trap, template component,
   sim gate, or release check.
7. **Fix and re-shoot.** Any violation is fixed in the owning file and the
   screen re-captured; the audit is done when every screen passes every row.
   The store screenshots for Step 6 are taken AFTER this step, never before.

### Step 5.7 — Golden-path cert (machine playtest)

`scripts/cert-driver.mjs` replays the golden path — cold boot on a wiped
save, the FTUE walk, the core loop to BOTH outcomes, the surface tour, the
quality-budget measurements — inside a live browser tab and writes
`games/<slug>/cert-report.json`, which `release-check.mjs` reads
(`checkCert`). Run it after Step 5.5's fixes, following the USAGE recipe in
the driver's own header (two `xd://browser` calls; point them at the BUILT
preview server, per Step 5 item 1 — an HMR reload mid-cert destroys the run).
Both the tab `url` and the `baseUrl` passed to `runCert` carry `?mute=1`: the
cert is the longest driven run in the pipeline and the one most likely to be
running while the user is doing something else.

- The report must end `passed: true`. Blockers route to the owning
  specialist like any qa finding; fix, then re-run the cert.
- **A cert report is required for EVERY family, adapter or not** — a missing
  report is a release BLOCKER, not a warning. Family adapters live next to
  `export const adapters` in the driver (`board`, `arena`). Building a family
  with no adapter yet: write the adapter against the board reference as part of
  the build — it amortises over every future game of that family, and there is
  no longer a "warn and ship" path that lets a new family ship uncertified.
  Keep `CERT_ADAPTED` in `scripts/release-check.mjs` in sync when an adapter
  lands.
- **`passed: true` with a non-empty `majors[]` is not a pass.** Every major is
  printed by `release-check.mjs` with its evidence
  (`cert major arena:unreachable … [closest=419]`) and carries the machine id
  prefix `cert:major:` in `--json`. Those ids are the input to Step 5.8; an
  unreconciled major blocks the release.
- Every family — with or without an adapter — also runs the adapter-less
  monkey test from the same module:
  `mod.runFuzz({ tab, page, baseUrl, gameDir, seconds: 45 })` — `baseUrl` with
  `?mute=1`, and note the fuzz RELOADS the page to test save survival, which is
  the exact leg where the param gets dropped — hammers random
  taps/drags/keys while watching family-agnostic invariants (no page errors,
  a scene always active, the loop never wedges, the save survives a reload)
  and writes `fuzz-report.json`. **A missing `fuzz-report.json` is a release
  BLOCKER for every family**, and `passed: false` routes to the owning
  specialist like any qa blocker. A `fuzz:coverage` warning (the fuzz never
  left one scene) means the sweep did not exercise the game — re-run it with
  the entry surface reachable, do not ship the warning.

### Step 5.8 — Gate reconciliation (before the word "green" is used)

Every measuring system speaks its own vocabulary, and a single design defect
shows up in ALL of them at once wearing a different name each time. Duskhaul
shipped with four systems describing ONE fact and not one of them saying so:

| System | What it said | Its number |
| --- | --- | --- |
| cert | `arena:unreachable` (a MAJOR, under `passed: true`) | closest approach 419px, needed ≤70px |
| sim | "no run reached the Collapse" | 0 runs |
| critic | "pilot died at 74-111s, never saw a gate" | 4 of 4 runs |
| balance | "~4 of 20 deep runs alive at 420s" | at 6-13% HP |

One fact: **the player cannot reach the extraction content.** Every gate was
green or "flagged", so the build shipped with its endgame unreachable and
`extract.collapseHaulBonus` unclaimable.

Do this in writing, before declaring the build green:

1. **Collect one line per measuring system that ran:** the sim gate table,
   `cert-report.json` `blockers[]` **and** `majors[]`, `fuzz-report.json`, the
   critic's persona notes, the balance loop's deep-run stats, game-qa findings,
   the flow audit. A system with no line did not run — run it.
   `node scripts/release-check.mjs <slug> --json` hands you the machine
   handles for three of these rows: finding ids prefixed `cert:major:` (a
   passing cert's majors, printed with their evidence), `wiring:dead-art`
   (generated assets nothing in `src/` names — Duskhaul: 37 of 103) and
   `fuzz:coverage` (the fuzz sweep never left one scene). Start the table from
   those; they are the rows a human reconciliation forgets.
2. **Build the table above for THIS game,** with a fourth column the systems
   never write: **the player-visible fact** ("the player can/cannot X"). The
   wording column never matches across systems; the fact column is the whole
   point of the exercise.
3. **Answer explicitly, in writing: do two or more rows name the same
   player-visible fact?** If yes they are ONE blocker with N witnesses, not N
   notes — escalate to the owning specialist at blocker severity whatever
   severity each system assigned individually. Corroboration RAISES severity;
   it never averages it.
4. **Unreached content is unreachable until proven otherwise.** List every
   content id, scene, zone, gate or reward that no system observed a player
   REACHING. Each is either proven reachable by real navigation in the live tab
   — a teleport is not proof; `cert-driver.mjs`'s `placeAtGate` certified the
   channel while the reach was broken — or it is a blocker. Cross-check against
   the dead-content sweep: an id the contract check asserts but nothing reads
   is the same defect from the code side.
5. Green requires zero unexplained pairs and zero unproven content. Paste the
   finished table into the Step 7 report; it is the input to Step 8's delta
   table.

### Step 6 — Store listing + publish

1. **Store data — English, complete, cover included.** The scaffold already
   wrote `games/<slug>/game.json` with `status: "draft"` and the English
   `prompt`/`genre`/`description` from Step 0; tighten `description` to 1-2
   player-facing sentences from PRD §1 (no jargon, no family jargon, English).
   Then:
   - **Cover (required).** Save `game-art`'s key art as `public/cover.png`
     (1024x1536, 3:4) and set `game.json.cover` to `cover.png`. Also export the social
     crop to `games/<slug>/shots/og.png` (1200x630) — the site uses
     `media/<slug>/og.png` for `og:image` when that file exists, otherwise the
     first `.png` screenshot, otherwise no `og:image` at all. The gradient
     `cover.svg` is draft-only and fails the release gate.
   - **Screenshots (≥3).** Copy the 3-5 best Step-5 shots into
     `games/<slug>/shots/` (menu, the decision surface, a payoff moment,
     results) and list them in `game.json.screenshots`.
   - **Preview clip (capture it, don't skip it).** Record 10-15s of the §13
     highlight beats with `scripts/preview-capture.mjs` — same `xd://browser`
     sandbox as the cert: `startPreview` → drive the beats with `tab`/`page`
     → `finishPreview` writes `shots/preview.webm`, the autoplaying muted
     loop on the store page. Skip only a genuinely broken recording, and say
     so in the final report.
2. **Release gate.** `node scripts/release-check.mjs <slug>` (`--json` for a
   machine-readable findings array). Hard checks: `status` valid; `title`,
   `genre`, `description` (≥ 40 chars) and `prompt` present and free of
   Cyrillic; the ROOT `package-lock.json` registers the `games/<slug>`
   workspace (the `lock` check — run `npm install` at the repo root if it
   fails); ≥ 3 screenshots listed **and** on disk; `cover` = `cover.png` with
   a real PNG behind it (never the scaffold gradient); no scaffold placeholder
   strings left in `index.html`/`menu.ts`; generated art not a byte-copy of the
   template set; **`art/style.json` is a real locked profile** — not the
   scaffold profile (`scaffold: true`, the scaffold name or artStyle) and not
   an empty `references[]` while generated art exists; **every gameplay
   `texture:`/`ArtSlot` key resolves to generated art** (an unresolved key
   draws the procedural fallback — this is how 72 generated props shipped
   unplaced behind `tex-square`); **every `TEXTURE`/`ANIM`/`ICON` alias the
   code reads is declared by the registry**; a `cert-report.json` with
   `passed: true` **for every family, adapter or not**, and a
   `fuzz-report.json` (both missing-report cases are blockers now, Step 5.7);
   **`playtest.approved: true` recorded by a real user
   playtest** (step 3 below — the one finding that cannot be fixed by
   editing files). Warnings (not blockers): missing `shots/og.png`, leftover
   `cover.svg`, Cyrillic in `menu.ts`, `wiring:dead-art`, `fuzz:coverage`, and
   every `cert:major:` finding from a cert that passed with majors. Fix
   everything else it reports first, so the playtest is the only remaining
   blocker — and route each warning through Step 5.8 rather than reading it as
   permission to ship.
   **`passed: true` with a non-empty `majors[]` is not a pass.** The Duskhaul
   cert shipped `passed: true` alongside `majors: [arena:unreachable]` and the
   gate read only the boolean. Step 5.8 reconciles every `majors[]` entry
   against the other systems' verdicts BEFORE this gate runs, and an
   unreconciled major blocks the release regardless of the boolean.
3. **User playtest gate (blocking).** The user plays the game before it
   ships — no exceptions:
   - Keep the Step-5 server running (or restart it) and hand the user the URL
     plus a one-line "what to try" (the family's core loop verbs). **This is
     the one URL that does NOT carry `?mute=1`** — the human is playing on
     purpose and audio is part of what they are judging. Say so when you hand
     it over, and confirm the automated tabs are closed so nothing else is
     making noise alongside them.
   - Collect feedback and apply it: gameplay feel, UI readability, palette,
     anything — each item is a fix + re-verify cycle (typecheck, affected sim
     gate, re-shoot the touched screen). Update the store screenshots if the
     fixes changed what the player sees.
   - **Generalize every finding before closing its fix round — by ROUTING,
     never by appending to a log.** `references/playtest-lessons.md` is the
     routing protocol: merge the finding into the bounded artifact that owns
     its kind (AGENTS.md contract rule or Phaser trap, family playbook
     number, `template/src/**` component, sim gate/selftest, release check),
     preferring to SHARPEN an existing rule over adding a sibling. A finding
     fixed only inside one game will be re-reported by the next game's user.
   - Only when the user explicitly signs off, write
     `game.json.playtest = {"approved": true, "by": "<user>", "date": "YYYY-MM-DD"}`,
     re-run `release-check.mjs` to exit 0, and set `game.json.status` to
     `"released"`. Games with `status: "draft"` are **not published** —
     `scripts/build-site.mjs` skips them unless run with `--include-drafts`.
   - **Headless/non-interactive runs stop here.** Leave the game `draft`,
     commit NOTHING, push NOTHING, and report the playtest URL and the exact
     approval command; never self-approve.
   - Until this gate passes, the entire build exists only in the working
     tree + `build-state.json` — rule 10: no commit, no push, no deploy.
4. **Preview.** `node scripts/build-site.mjs --include-drafts && python3 -m
   http.server 5321 -d _site` — check the catalog card, the store page (prompt
   block, gallery, preview loop) and `/play/<slug>/` (the `← Games` pill must
   return to the catalog). Re-run without `--include-drafts` after flipping to
   `released` and confirm the game is in the catalog.
5. **Publish.** Make the build's FIRST commit — everything the build touched:
   `games/<slug>/`, the ROOT `package-lock.json` (the workspace registration
   from the scaffold's root `npm install`; if the scaffold ran
   `--no-install`, run `npm install` at the repo root now — CI `npm ci` dies
   without the lock entry and `release-check`'s `lock` check catches it),
   plus any docs/pipeline changes it needed —
   and push to `master` — allowed only now, with
   the sign-off recorded. `.github/workflows/pages.yml` rebuilds every
   released game plus the catalog and deploys to https://1pgames.github.io/ ;
   watch the run with `gh run watch`. The `verify` job (sims + selftests)
   and the release-check job run in CI and **BLOCK the deploy** — a red
   gate means the push does not ship; fix and re-push.
6. **Record.** Capture a short clip of the canvas (screenshots at each beat
   from Step 5 are the minimum bar; a full-run recording of the
   `design-heuristics.md` §13 highlight beats is the stretch goal).

### Step 7 — Final report

Report, in this order:

1. PRD path (`games/<slug>/PRD.md`), the family code + subgenre, and the
   one-line pitch.
2. The Assumptions summary (every auto-resolved axis, 4-6 lines).
3. The family's sim gate table (for arena: per-lane winrate, `firstUpgradeS`,
   decision cadence) and which balance-loop iteration produced it.
4. The screenshot set from Step 5 — the family's checklist rows, one per state,
   with a one-line playability verdict each (renders correctly / input responds
   / matches PRD).
5. The Step 5.5 audit table — one row per screen (menu / map / shop / HUD /
   pause / win / loss / picker): overlap check + readability check, and what
   was fixed.
6. Any fallback taken under §Failure policy, stated plainly, not buried.
7. **The Step 5.8 reconciliation table** in full (system | wording | number |
   player-visible fact), including the rows that agreed, plus the Step 4
   sim-vs-live parity table (`metric | sim | live | delta%`) and the floor-bot
   vs novice-persona comparison.
8. **The wave record.** Every `build-state.json` `waves[]` row that ended
   `dead` or `taken-over`, with its machine-recorded `cause.kind`, the verbatim
   `cause.evidence`, and the recovery taken. "A subagent died" without a cause
   is not a report line. Also: any standing order issued or reversed during
   the build, with its evidence.
9. Release state: `game.json.status` (`draft` or `released`), the
   `release-check.mjs` verdict, and the **playtest state** (approved by whom
   and when, or the playtest URL still awaiting the user).
10. The exact next commands: `cd games/<slug> && npm install && npm run dev`.

### Step 8 — Post-release retrospective (mandatory, ~10 minutes)

The pipeline learns per release, not per complaint. After the deploy is
live:

1. **Delta table.** Three columns: findings the INTERNAL loop caught
   (code-reviewer / qa / flow audit / critic), findings the USER's playtest
   caught, and findings REAL PLAYERS surfaced through telemetry —
   `GOATCOUNTER_TOKEN=… node scripts/telemetry-pull.mjs --slug <slug>`
   turns the `ev/<slug>/*` events the template fires into a level funnel,
   retry rate and quit points. Telemetry lands on its own clock: THIS retro
   pulls the numbers for the PREVIOUS release, the next one pulls this
   one's. Every finding outside column one is a hole in an internal gate —
   name the gate that should have caught it.
2. **Route the holes** per `references/playtest-lessons.md` (merge-first):
   contract rule, quality budget, playbook number, agent-prompt duty, sim
   gate, cert/audit script check, telemetry event. A hole with no
   destination is a new gap — say so explicitly.
3. **Tighten budgets that measured slack.** If every game clears a budget
   band effortlessly, the band is too loose to teach anything — tighten it
   in `template/AGENTS.md` §Quality budgets with the measured evidence.
4. Append one line to the game's PRD: `Retro: <n internal / m user
   findings, holes routed to <destinations>>` — the audit trail that the
   step ran.

A release without a retro is unfinished: the NEXT game pays for it.


## Orchestrator conduct

The Duskhaul build's worst failures were not code. They were an orchestrator
broadcasting an unverified claim to twenty agents, guessing why an agent died,
and letting one gate block four workstreams. These rules are mechanical;
follow them literally.

### Message discipline (`to:"all"` is prohibited)

An inbound message is an **interrupt**, not a mail. It lands in the middle of
whatever the recipient is doing — including the middle of its `yield`.
Orchestrator `to:"all"` broadcasts destroyed `GreyboxCritic`'s verdict **six
times** until its job aborted outright; the verdict survived only because an
unrelated status poll happened to land. There were ≥22 broadcasts to 17-22
peers in 42 minutes.

**Cost model, priced before every send.** A message to N agents costs N
context windows, N interrupts and N re-plans, and it cannot be retracted. A
wrong broadcast to 20 agents is 20 agents doing wrong work — with the evidence
of the right work already overwritten.

1. **`hub` `to:"all"` is never used in this pipeline.** Address recipients by
   id. If you cannot name them, you do not yet know enough to send.
2. **Recipients = the agents whose OWNED FILES or CURRENT DECISION the message
   changes.** Derive that list from `build-state.json` `waves[]` ownership
   globs, not from "who might care". Everyone else is spam with a context bill.
3. **Never message an agent whose work is complete.** Check `waves[]` and
   `hub` `op:"jobs"` first: a row that is `done`, or a job that is settling, is
   off-limits. The most expensive message in this pipeline is the one that
   lands while a finished agent is writing its result.
4. **An in-band audience filter is not a filter.** `*** ART AGENTS ONLY —
   everyone else ignore ***` does not stop the interrupt; the twelve non-art
   agents already paid for it. Prose cannot un-deliver a message.
5. **Budget: ≤3 outbound messages to any one agent per wave, and ≤1
   multi-recipient send per 10 minutes.** Exceeding either means the wave was
   under-specified at dispatch — fix the next dispatch text, do not patch a
   wave by interrupt.
6. **Every message states three things:** what changed, what the recipient must
   DO differently, and whether it invalidates work already done. A message with
   no action for the recipient is not sent.
7. **Prefer pull over push.** A finding the CURRENT wave cannot act on goes
   into `local://<topic>.md` and the NEXT wave's dispatch text, not into twenty
   inboxes.
8. **Never ask "are you done?".** Results auto-deliver; `hub` `op:"jobs"`
   answers it for free. Poll the board, never the player.
9. **Corrections obey §Measure before you broadcast.** An unverified
   correction is worse than silence: it is N agents' worth of wrong work plus a
   retraction.

### Measure before you broadcast

Every corrected belief in the Duskhaul build was corrected by RE-MEASURING
FINISHED WORK — never by re-reading the rule. Bake that in:

1. **Bisect before you name a cause.** "The provider is down" was a
   prompt-length ceiling: 4500 chars fail, 3200 fail, 2400 pass. Halve the
   suspect variable until you have the boundary, then report the boundary, not
   the symptom. `Image generation failed for all credentialed providers: xai`
   names the provider, not the fault.
2. **Falsify, don't confirm.** Run the case that should PASS if your hypothesis
   is wrong. Four agents independently "confirming" an outage confirmed one
   frame copied four times — agents handed the same wrong premise are not
   independent evidence.
3. **Re-measure any new reject criterion against work already ACCEPTED.** If it
   rejects the accepted canon, the criterion is wrong, not the work. Two art
   criteria ("no visible pixel grid", "missing 1px outline") were retired
   exactly this way, and five audit heuristics were wrong on POPULATION rather
   than on metric — the metric was fine, the set it was applied to was not.
   State the population a criterion is valid for, every time.
4. **Prefer a concrete in-set reference to an abstract criterion.** "Match
   `<named accepted asset>`" is checkable and was right; "1px outline, no pixel
   grid" was abstract and was wrong. Same for gameplay: name the shipped
   reference, not the adjective.
5. **Provider/tool folklore needs a measurement with a direction and a sample
   size.** "codex loses the outline" measured **+14 in the opposite direction**
   and drove real rerolls before anyone checked.

### Standing orders (policy stability)

A standing order is any instruction that changes how agents work for the rest
of a wave: provider choice, prompt rule, retry budget, ownership change.
Provider policy flipped **four times in 5m15s** in the Duskhaul art wave and
stranded every in-flight generation.

- **Evidence bar.** An order carries a measurement, its sample size, and the
  falsifying case that was run (§Measure before you broadcast). Below that bar
  it is an "unverified hypothesis — do not act on it yet", and it is not sent
  as an order at all.
- **Stated reversal cost.** Reversing an order costs every agent that adopted
  it its in-flight work. Write that cost into the reversal message: *"this
  invalidates work started after HH:MM by \<named agents\>"*. If you cannot
  name them, you are not ready to reverse.
- **Minimum dwell: one wave.** Once issued, an order holds to the wave boundary
  unless it is actively producing a BLOCKER. Re-measure at the boundary, where
  nothing is in flight.
- **One home.** Orders live in `build-state.json` `standingOrders[]`
  (`{id, order, issuedAt, evidence, supersedes}`) and are pasted into the next
  dispatch's context block. An order that exists only in chat does not exist
  for the agent spawned after it.

### Dispatch preflight (tools, manifests, ownership, timeboxes)

Run this before every `task` batch. Each item cost this pipeline a wave.

1. **Tools.** For each agent, name the tool its job requires and confirm its
   agent type mounts it. `ZoneArt` was dispatched to generate art with zero
   `generate_image` calls available and shelled out to nested `omp -p
   --auto-approve` sessions — unreviewable output from an unowned session.
   Output produced by a workaround around a missing tool is **discarded**, not
   reviewed.
2. **Manifest lint once, not N times.** Before fanning N agents over one
   manifest/spec/marker set, lint it yourself and fix the class. For an art
   wave the lint is EXECUTABLE and its exit code is the gate —
   `python3 "$REPO/.claude/skills/game-art/references/manifest-lint.py"
   art/manifest.json` must exit 0 before a single generation agent is spawned
   (Step 2; 1 = fix the manifest, 2 = fix your command, never a pass).
   Three of twelve art agents independently rediscovered the same
   `writeScaleProfile` defect: three contexts spent on one bug a two-minute
   lint would have removed for all twelve. Where no executable lint exists for
   the artifact being fanned out, one `scout` reads it once — never N agents.
3. **Ownership.** §Ownership reconciliation passes — every path the PRD names
   is owned by exactly one agent in this wave.
4. **Contracts.** For a consumer wave, its contract wave is `done` (Step 1a)
   and every frozen entry names a producer AND a consumer call-site.
5. **Timebox.** Every agent — gates especially — is dispatched with an explicit
   deadline and the interim protocol below.
6. **Silence and side effects.** Every dispatch that DRIVES a build carries
   the mute clause from §Side effects on the user's machine verbatim. An agent
   that opens a browser tab on a user's desktop is running on their hardware,
   and the default is: make no sound, steal no focus, write nothing outside the
   workspace.

### Side effects on the user's machine

**An agent must not produce side effects on the user's machine that the user
did not ask for.** This is not an etiquette rule; it is a correctness rule. The
user should never have to interrupt a run to stop the harness misbehaving —
and when they do, the interrupt lands on whatever agents were mid-write, so one
agent's noise becomes several agents' destroyed work (§Message discipline
prices the same mechanism).

Audio is the instance that surfaced: two agents browser-testing mid-wave played
game sound out loud on the user's machine and the user interrupted the run to
stop it. The same principle covers stealing window focus, opening applications
the task did not require, writing outside the workspace, and any notification.

**Every browser-driven step this skill runs or dispatches is MUTED** — the
Step 5 playthrough, the Step 5.5 UI audit, the Step 5.7 cert, the fuzz sweep,
the `game-qa` sweep, the critic's playthrough and the preview capture. The
mute clause is part of the dispatch text, not something each agent is trusted
to remember, because the cost of one agent forgetting is paid by the whole
wave.

Five rules make the silence correct rather than merely quiet. The canonical
contract is `template/src/core/audio.ts` — read there, not from memory:

1. **Mute at load, via the URL: `?mute=1`.** The param name is `mute` and is
   CASE-SENSITIVE; presence alone is enough (`?mute`), and values are
   case-insensitive and trimmed. `1`/`true`/`on`/`yes` — and any other value —
   force silence. Write `?mute=1`: it is the form every step appends and the
   one a driver can build mechanically. `?mute=0`, `false`, `off` and `no`
   explicitly DO NOT mute; that is deliberate, so a driver can template the
   value and switch it off without rewriting the query string — which also
   means a driver assembling the value from a variable must never pass a falsey
   one by accident. There is no alias: not `silent`, not `nosound`, not
   `muted`. Not gated on dev: verified on a production `vite build`, which is
   what the cert, fuzz and QA sweep actually drive.
2. **Re-append it to every URL the driver VISITS.** The override must be in the
   URL at load and is read once per document. It survives in-app navigation and
   scene restarts for free — a Phaser scene change does not touch the URL and
   the value is already latched in module state — but every `goto`, every
   `reload`, every new tab needs it again, and the reload after a save wipe is
   exactly where it gets dropped. It cannot be switched on mid-session, by
   design: "effective from frame 0" is the whole point.
3. **Never by writing the game's persisted `muted` preference.** The param
   writes nothing, ever — measured over a full forced run including gameplay
   and a music start, `localStorage['gt:muted']` (`STORE.muted`, under
   `core/storage.ts`'s `gt:` namespace) stays ABSENT. A driver must not do what
   the template refuses to: writing it mutates the save, corrupts the
   wiped-save FTUE run that Step 5.5 and the cert both depend on, races audio
   init, and is the route that produced the noise in the first place. A run
   that silences itself by editing player state has invalidated its own
   evidence.
4. **The silence is structural, at boot.** Under a forced mute NO
   `AudioContext` is created at all — no master gain, no oscillator, no
   scheduler — and `core/music.ts` bails on its null-context guard, so the
   music layer is silent at BOOT rather than after a toggle. The in-game SOUND
   toggle still works and still records the player's preference; the override
   owns the session, so the label reads OFF and the preference applies on the
   player's next ordinary load.
5. **Older builds predating the param** are muted at the BROWSER layer
   instead, from the driver, in the page: every media element `muted`, the
   `AudioContext` suspended, master gain zeroed. Detect the case rather than
   assuming it — `window.__AUDIO__` absent means the build has no param.

**Silence must not reduce coverage.** A muted run still PROVES the audio stack
is wired, by assertion: `window.__AUDIO__()` (exposed on production bundles
too, so it works against the built preview server the multi-minute runs use)
returns `{ muted, forcedByUrl, storedPreference, masterGain, contextState,
requested, played, lastRequested }`. The assertions a driven run makes:

- `forcedByUrl === true` — proves the mute actually took effect. Assert this
  FIRST, on every leg; it is the check that catches a dropped param before the
  sound does.
- `contextState === null` and `masterGain === null` — under `?mute` no
  `AudioContext` is ever created, so silence is structural rather than a gain
  ramp that a race could beat.
- `played === 0` for the WHOLE run — one non-zero reading means something
  bypassed the master bus. This is the regression guard.
- `requested > 0` after real gameplay, and `lastRequested` naming the last
  voice. `requested` counts every `sfx()` call BEFORE the mute check, so "the
  hit cue fires on a hit" is asserted by a counter delta across the beat,
  never by listening. **`requested === 0` after real gameplay is a DEFECT, not
  a pass** — it means a dead audio path, and it is precisely the failure a
  muted run would otherwise hide. The `game-qa` sweep asserts this explicitly;
  a silent run that never checked whether anything ASKED for sound has proven
  nothing.
- `storedPreference` unchanged and `localStorage['gt:muted']` still ABSENT at
  the end of a forced run — the proof that the run did not mutate the save it
  was measuring. `isMuted()` and `audioStatus()` are importable directly for
  in-repo tests; flipping the in-game SOUND toggle during a muted run must
  record the preference and still leave `played` at 0.

"I heard it" was never evidence anyone could put in a report; a counter delta
is. A muted run that skips audio checks entirely is a failed run, not a quiet
one.

### Gate timeboxes and interim verdicts

A "3-minute verdict" gate ran **30m10s** and blocked four workstreams, because
nobody had told it what to do when it ran long.

| Gate | Timebox | Watchdog (1.5x) |
| --- | --- | --- |
| greybox critic verdict (Step 0.7) | 5 min | 8 min |
| `code-reviewer` pass over a wave | 10 min | 15 min |
| flow audit / Step 5.5 UI audit | 10 min | 15 min |
| `game-qa` golden-path sweep | 20 min | 30 min |
| cert driver run (Step 5.7) | 15 min | 22 min |
| one balance-loop sim iteration | 10 min | 15 min |

- **Interim protocol — paste verbatim into every gate dispatch:** *"Hard
  timebox: N minutes. At N minutes you MUST `hub` send `Main` the verdict you
  have — the strongest call the current evidence supports, plus what is still
  unmeasured — and only keep going after that if you are not blocking anyone. A
  partial verdict on time beats a complete one late."*
- **Watchdog side.** At 1.5x the timebox, record `timeout` (see the cause
  taxonomy), take the interim verdict if one arrived, and unblock the
  dependents. Do NOT send "how's it going?" — that is message-discipline rule 8
  and it is exactly how a verdict gets destroyed.
- **Never let one gate block more than two workstreams.** If four are waiting,
  the gate is on the critical path: split its scope, or start the workstreams
  whose files the verdict cannot change.

## Checkpoints and dead agents

Subagents die. The observed failure modes are a **provider stream death
mid-write** (the agent stops with no result, having created some files and
half-written others), a **rate limit**, a **context exhaustion**, a **missing
tool**, and an **orchestrator interrupt that killed the job**. A wave that is
not checkpointed cannot tell any of those apart from success, and the
integrator then wires a half-written slice.

### `build-state.json` is append-only

A single mutable snapshot cannot do the one job the file exists for. Duskhaul's
overwrote every earlier wave and collapsed **twelve** generation agents into
ONE row — at recovery time there was nothing left to recover from.

**Before each wave** (Step 1a contract freeze, Step 1b build batch, Step 2 art
batch, Step 3 integration) append one row per dispatched agent to
`games/<slug>/build-state.json`:

```json
{
  "wave": "art",
  "tasks": [
    { "name": "ZoneArt", "ownershipGlobs": ["public/assets/generated/zones/**"], "status": "dead" }
  ],
  "standingOrders": [
    { "id": "so-1", "order": "image prompts <= 2400 chars", "issuedAt": "2026-08-29T14:02:11Z",
      "evidence": "bisect: 4500 fail / 3200 fail / 2400 pass, n=3", "supersedes": null }
  ],
  "waves": [
    { "wave": "contracts", "agent": "SeamOwner", "type": "build-integrator", "attempt": 1,
      "ownershipGlobs": ["src/core/keys.ts", "src/data/stats.ts"],
      "startedAt": "2026-08-29T12:03:00Z", "endedAt": "2026-08-29T12:11:40Z",
      "status": "done", "cause": null, "artifact": "agent://01a0-…" },
    { "wave": "art", "agent": "ZoneArt", "type": "art-director", "attempt": 1,
      "ownershipGlobs": ["public/assets/generated/zones/**"],
      "startedAt": "2026-08-29T14:22:03Z", "endedAt": "2026-08-29T14:39:55Z",
      "status": "dead",
      "cause": { "kind": "rate-limit",
                 "evidence": "HTTP 429 … \"retry-after-ms\":259932000",
                 "source": "job result" },
      "artifact": "history://01a0-…" }
  ]
}
```

- **`waves[]` is the record, and it is APPEND-ONLY.** A row is written at
  spawn (`status: "running"`) and CLOSED exactly once (`endedAt`, terminal
  `status`, `cause`). Never delete a row, never reuse one for a different
  agent, never let a later wave overwrite an earlier one.
- **One row per AGENT per ATTEMPT.** Twelve generation agents are twelve rows.
  A respawn APPENDS a new row with `attempt: n+1` and the same `agent` name;
  the dead row keeps its cause forever. A row covering more than one dispatched
  agent is malformed.
- **`wave` and `tasks[]` remain** as a projection of the newest wave's rows —
  that is the shape `node scripts/audit-check.mjs <slug>` validates
  (`state:shape`). They are DERIVED: regenerate them from `waves[]`, never edit
  them independently.
- **`status`** is one of `pending` | `running` | `done` | `dead` |
  `taken-over` (the set `audit-check.mjs` enforces).
- Mechanical check, any time: `grep -c '"agent"'
  games/<slug>/build-state.json` equals the number of `task` dispatches made so
  far, and every row with `status: "dead"` has a non-empty `cause.evidence`.

### Ownership reconciliation (before every wave, and after)

PRD §16's "Owns files" column and `build-state.json`'s globs disagreed in the
Duskhaul build and left `src/systems/combat.ts` owned by nobody: written by
whoever got there first, reviewed by no one.

1. Derive `ownershipGlobs` mechanically FROM §16 — copy the column and expand
   to globs; do not paraphrase. When the two maps disagree the **PRD wins**:
   amend §16 (route to `game-designer`) and re-derive. Never silently fix the
   checkpoint to match a guess.
2. Every path named anywhere in PRD §16/§16.1 — owned files, contract producer
   files, contract consumer call-sites — must match **exactly one** row of the
   wave. Zero matches = UNOWNED and blocks the wave. Two = COLLISION and blocks
   the wave.
3. After the wave, run the same test over what actually changed; anything a
   workstream wrote outside its globs is a boundary violation to reconcile
   before integration. From the repo root:

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs"; import { execSync } from "node:child_process";
const [wave, slug] = process.argv.slice(1);
const rows = JSON.parse(readFileSync(`games/${slug}/build-state.json`, "utf8"))
  .waves.filter((w) => w.wave === wave && w.status !== "dead");
const rx = (g) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  .replace(/\*\*\/|\*\*|\*/g, (m) => (m === "**/" ? "(?:.*/)?" : m === "**" ? ".*" : "[^/]*")) + "$");
// -uall matters: git collapses untracked DIRECTORIES by default, and until Step 6.5
// nothing in a build is committed, so every file the wave wrote is untracked.
for (const line of execSync("git status --short --untracked-files=all").toString().split("\n").filter(Boolean)) {
  const f = line.slice(3).trim().split(" -> ").pop();
  const owners = rows.filter((r) => r.ownershipGlobs.some((g) => rx(g).test(f))).map((r) => r.agent);
  if (owners.length !== 1) console.log(owners.length ? `COLLISION ${f} ${owners}` : `UNOWNED   ${f}`);
}' art my-slug
```

Triage the output in full — the rule is only worth having if its noise is
named. `games/<slug>/{PRD.md,build-state.json,cert-report.json,fuzz-report.json,shots/**}`
are the ORCHESTRATOR's own artifacts and are expected in the UNOWNED list.
Every other UNOWNED line is a file nobody was accountable for (`src/systems/combat.ts`
was exactly this), and every COLLISION line is two agents writing the same
file. Both block integration until the row is assigned or the write is
reverted.

### Cause of death is machine-recorded, never guessed

`ArtDirector` died of an HTTP 429 carrying `retry-after-ms=259932000` —
**72.2 hours** — and the checkpoint recorded "context limit". Because the cause
was wrong, the only mitigation that works (respawn on a different model) is
documented nowhere, so the next build waits, or retries straight into the same
wall.

**`cause.evidence` is the VERBATIM error text or status line, copied from the
job result or from `history://<id>`.** No evidence string → `kind: "unknown"`.
A plausible-sounding guess is prohibited: it is worse than `unknown`, because
it looks answered.

| `cause.kind` | Machine signature | Recovery |
| --- | --- | --- |
| `rate-limit` | HTTP 429, or an error carrying `retry-after` / `retry-after-ms` | Read the retry window from the error. **> 5 min → never wait:** respawn the task on a different agent type/model and log the swap in `standingOrders[]`. ≤ 5 min → one delayed respawn. Does not consume respawn budget. |
| `context-exhaustion` | result truncated mid-write with no tool/provider error, or an explicit context/length error in the transcript | Respawn NARROWER: fewer owned files, explicit "read only these paths", and the partial work on disk named in the prompt. Splitting the row into two agents is a legitimate recovery — append both rows. |
| `provider-error` | 5xx, stream reset, empty completion | Respawn verbatim once, immediately. A second on the same agent is treated as `rate-limit` (swap the model), not as a third try. |
| `tool-missing` | the agent reports a required tool is unavailable, OR its transcript shows zero calls to the tool its job needs plus shell workarounds (`omp -p`, `curl`, a nested session) | Dispatch bug, not agent failure: re-dispatch to an agent type that mounts the tool, and discard the workaround's output. Does not consume respawn budget. |
| `killed-by-interrupt` | the job aborted with an inbound message among its final events; the result never delivered | Your bug (§Message discipline). Do not respawn blind: read `history://<id>` — the verdict is usually IN the transcript — and check the owned files against §16.1 before deciding anything. |
| `timeout` | exceeded 1.5x its dispatched timebox with no interim verdict | Take the interim verdict if any, unblock the dependents, and re-dispatch only the REMAINDER, as a narrower question. Never re-ask the whole question. |
| `unknown` | none of the above matched | Quote the raw tail of the job result in `cause.evidence` and name it as unknown in the Step 7 report. Never invent a kind to fill the field. |

**When a subagent dies** (no result, provider/stream error, or a result that
does not match its ownership globs):

1. **Close its `waves[]` row first**: `status: "dead"`, `endedAt`, and a
   `cause` object with machine evidence. The recovery decision depends on the
   kind, so the kind is established before the decision, not after it.
2. Re-check its ownership globs against reality — `git status --short` plus a
   read of the files it claimed — and decide:
   - **nothing written** → respawn from scratch;
   - **partial write** (files exist, incomplete or non-compiling) → respawn to
     resume;
   - **complete work, lost result** (all owned files present and coherent
     against §16.1) → append a `done` row, do not respawn. **A result you never
     received is not a death.** Results auto-deliver, but a wave can still miss
     one: check `hub` `op:"jobs"`, then `history://<id>`, then the files, before
     spawning anyone. Duskhaul re-dispatched `src/ui/**` to five sequential
     owners this way — four were unnecessary, and each paid a full context to
     re-read the same files.
3. Respawn by APPENDING a row (`attempt: n+1`) with the **same task text
   verbatim**, prefixed with:
   *"A previous attempt at this task died mid-write. Its partial work is already
   on disk in your owned files — read them first, reconcile against the
   contracts below, and finish the task. Do not start over from scratch if the
   existing code is usable, and do not duplicate what is already there."*
   Frozen contracts and file ownership are unchanged — never widen a respawn's
   ownership to cover a sibling's files.
4. **Maximum 2 respawns per task**, counting only `context-exhaustion`,
   `provider-error` and `killed-by-interrupt`. `tool-missing`, and
   `rate-limit` recovered by a model swap, are dispatch corrections and do not
   count. After the second death, the orchestrator takes the slice over itself,
   finishes it inline, appends a `taken-over` row, and says so in the Step 7
   report.

**Never proceed to integration (Step 3) with any task in an unknown state.** A
row that is neither `done` nor `taken-over` blocks the wave — reconcile it
first. `build-state.json` stays in the game folder as the build's audit trail,
and `waves[]` is what a takeover reads: the snapshot fields are a convenience,
the history is the evidence.

## Failure policy

- **Art asset fails QC budget** (palette drift, silhouette collision,
  clipped limbs after `game-art`'s retry budget) → keep the template's
  default procedural/chibi asset for that slot, record a `qcExceptions`
  entry with the reason, and continue — never block the whole build on one
  asset.
- **Family has no starter slice (family D, or an exotic pitch).** D ships the
  kits but no `src/slices/` dir and no `src/sim/families/` gate. Do not
  scaffold D as arena and do not pretend a gate passed. Instead: scaffold with
  the nearest slice only if the PRD's subgenre genuinely reuses it, otherwise
  scaffold plain, author `src/slices/<slice>/{game,tuning}.ts` by composing the
  shipped kits per the playbook (`turns` + `deck` for a deckbuilder,
  `autobattle` + `systems/board` + `ui/shopTray` for an auto-battler, `turns` +
  `systems/placement` for tactics), point the `src/scenes/game.ts` re-export at
  it, and write `src/sim/families/<slice>.ts` with that family's hard gates
  (match completable at high skill, losable at low skill, fight/node pacing)
  plus `SIM_FAMILY`. Report the authored gate explicitly.
- **Pitch maps to no family at all** (the pitch names no loop the Step 0 table
  describes, or it is out of scope: real-time multiplayer, gacha LiveOps, social
  casino) → out-of-scope pitches are rejected with a counter-proposal, never
  specced; a loop-less casual pitch takes the HYBRID DEFAULT (**I**) rather
  than a mid-core fallback. State the substitution in the PRD Assumptions and
  in the final report.
- **Sim hard gate still fails after 3 balance iterations** → ship the best
  iteration (lowest total gate-violation count, or highest win-rate-spread
  compliance if tied) and flag the specific failing gate(s) in the final
  report — never silently ship a failing hard gate as if it passed, and
  never exceed the 3-iteration budget chasing a clean pass.
- **A required tool is missing** (an agent has no `generate_image`, no browser,
  no `hub`) → stop it; do not let it improvise. Output produced by shelling out
  to a nested `omp -p` session or a hand-rolled substitute is **discarded, not
  reviewed** — it was never gated by the tool's own QC. Re-dispatch to an agent
  type that mounts the tool, record `tool-missing` in `waves[]`, and route the
  mis-dispatch to the agent definition per `references/playtest-lessons.md` so
  the next build cannot repeat it.
- **An agent dies of a rate limit with a retry window > 5 minutes** → swap the
  agent type/model, never wait. A `retry-after-ms` of 259932000 is 72.2 hours,
  not a pause; recording it as a context limit hides the only fix there is.
- **A gate exceeds 1.5x its timebox** → record `timeout`, take the interim
  verdict, unblock the dependents, and re-dispatch only the remaining question.
  A gate never blocks more than two workstreams.
- **Two systems disagree, or one says MAJOR while another says "flagged"** →
  they are reconciled per Step 5.8 before anything is called green.
  Corroboration raises severity; it never averages it.
- **A sim gate and the live game disagree by > 25% on a gate-bearing number**
  → the sim is wrong until proven otherwise. Fix the sim model before tuning
  the game with it, and report both numbers.
- **A broadcast killed an agent's result** → recover it from `history://<id>`
  before respawning anything, record `killed-by-interrupt`, and state the cost
  in the Step 7 report. This is the orchestrator's own defect, and it is
  reported as one.
- **An agent produced an unrequested side effect on the user's machine** —
  sound from a driven tab, stolen focus, a window opened, a write outside the
  workspace → stop that agent's run, not just the symptom, and fix the
  dispatch: the mute clause and §Side effects on the user's machine go into the
  dispatch text for every agent that drives a build, and a run whose evidence
  was collected while misbehaving is re-run. Treat a user interrupt caused by
  the harness as a BLOCKER-class orchestration defect: it costs every mid-write
  agent its result (§Message discipline prices the same mechanism), it is
  reported in Step 7, and it is routed per
  `references/playtest-lessons.md` — never left as "we'll remember next time".

## References

| File | Use |
| --- | --- |
| `skill://game-prd` | Family classification (Step 0/0b), auto-PRD generation, §Modes for the forced `auto` invocation; `references/design-heuristics.md` §5.5/§18 for the sim contract and family→verification map, §12 for the frozen-contract surface |
| `skill://game-art` | Style lock, parallel asset generation, engine wiring (Step 2) |
| `skill://map-forge` | World/level geometry — collision, zones, scene hooks — for genres that need authored maps |
| `skill://game-prd/references/casual-playbooks.md` | Subgenre playbooks for families B/C/F/G/H/J (and I's casual core) |
| `references/playtest-lessons.md` | Fixed-size ROUTING PROTOCOL for playtest findings: classification table (finding kind → bounded destination artifact) + merge-first discipline. Findings are never appended as a log — they sharpen a contract rule, playbook number, trap entry, template component, sim gate, or release check |
| `template/src/slices/` | The eight starter slices; the one the scaffold kept is where gameplay work happens |
| `scripts/new-game.sh` | Scaffold with `--family <slice> --prompt/--genre/--desc` — prunes other slices and off-family art groups, rewrites the `src/scenes/game.ts` re-export, writes `src/sim/family.ts` and a `status: "draft"` `game.json` |
| `scripts/release-check.mjs` | Release gate: manifest completeness, English-only fields, ≥3 screenshots, real raster cover, no scaffold leftovers, a locked non-scaffold `art/style.json`, every gameplay texture/`ArtSlot` key resolving to generated art, every `TEXTURE`/`ANIM`/`ICON` alias declared by the registry, a `cert-report.json` (`passed: true`) and a `fuzz-report.json` for EVERY family, and `playtest.approved` from a real user playtest — exit 0 is the precondition for setting `game.json.status` to `released`. `--json` finding ids `cert:major:*`, `wiring:dead-art`, `fuzz:coverage` are the machine handles Step 5.8 reconciles |
| `scripts/build-site.mjs` | Catalog + store pages; publishes released games only (`--include-drafts` for local preview) |
| `games/<slug>/build-state.json` | The build's append-only audit trail: `waves[]` (one row per agent per attempt, with a machine-recorded `cause` on failure), `standingOrders[]`, and the derived `wave`/`tasks[]` projection that `audit-check.mjs` shape-checks |
| `template/AGENTS.md` | The build contract every workstream and the integrator follow; Phaser 4 traps, UI semantics, pooling rules |
| `template/scripts/verify.sh` (`npm run verify`) | Integration gate, staged and non-short-circuiting: typecheck → content contract check → consumer-edge check → art registry `--check` → kit selftests → sim gates last; exit code aggregated at the end |
| `scripts/gen-art-registry.mjs` | Generates `src/data/art.ts` from the art pipeline's manifest — integration-time only, never hand-authored |
| `scripts/cert-driver.mjs` | The golden-path harness — `runCert`, `runFuzz`, `adapters`, `writeReport`. The ONLY browser driver for automated runs; never hand-roll a stub beside it, and never point a multi-minute run at the HMR dev server |
| `history://<id>` | A dead or interrupted agent's transcript — where a lost verdict is recovered from BEFORE anyone is respawned, and where a cause-of-death evidence string is copied from |
| `scripts/audit-check.mjs` | Mechanical PRD + `build-state.json` gate; `SPEC INCOMPLETE` blocks Step 1 |
| `game-art/references/manifest-lint.py` | Pre-fan-out gate for `art/manifest.json`: style-lock-not-rewritten, unwritten/duplicate scale profiles, two-owners-one-group, duplicate ids/aliases, bad grids and durations. Exit 0 (warnings allowed) is REQUIRED before any generation agent spawns; run from the game project root |
| `game-art/references/figure-ground.py` | Set-level readability gate a per-asset check cannot replace: field-vs-actor clash%, foreground ownership, busyness ratio and cross-asset set spread, measured through the scene's runtime grade tint. Required in every art group's sign-off; FAIL regenerates, WARN needs a `qcExceptions` entry in the manifest FILE |
