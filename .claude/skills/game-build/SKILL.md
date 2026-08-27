---
name: game-build
description: >-
  Turns ONE prompt into a finished, VERIFIED game end-to-end: family
  classification → auto-PRD → scaffold with `--family` → parallel build → art
  (including map-forge world geometry when the family needs it) → integration →
  family sim gates + browser verification → balance loop → record. Orchestrates
  `game-prd` (forced `auto` mode), the per-family build workstreams, and
  `game-art` as parallel subagent batches, then drives `npm run verify` and a
  live browser playthrough before declaring the game done. Use for "make a game
  about X end to end", "today's game", "сделай игру про X", or any
  single-prompt request for a complete playable game — as opposed to `game-prd`
  alone, which only produces the spec.
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

`game-prd` Step 0 resolves exactly one family code from the pitch; every step
below is keyed on it. The template ships eight starter slices, and the code
chooses the slice, the session director and the sim gate:

| Code | Family | Slice | Director | Verify gate |
| --- | --- | --- | --- | --- |
| A | real-time arena | `src/slices/arena/` | `RunDirector` | `npm run sim -- --family arena` |
| B | board puzzle | `src/slices/board/` | `LevelDirector` | `npm run sim -- --family board` |
| C | side-view physics | `src/slices/side/` | `LevelDirector` / `RampDirector` | `npm run sim -- --family side` |
| D | cards & tactics | **none — compose kits** | `RunDirector`, fight-indexed | must be written (see §Failure policy) |
| E | track vehicle | `src/slices/track/` | `LapDirector` | `npm run sim -- --family track` |
| F | idle tycoon | `src/slices/idle/` | `Economy` (no session end until ascend) | `npm run sim -- --family idle` |
| G | table & dice | `src/slices/table/` | `LevelDirector`, or the slice's `DiceLoop` roll budget | `npm run sim -- --family table` |
| H | word & trivia | `src/slices/word/` | `LevelDirector` | `npm run sim -- --family word` |
| J | hypercasual | `src/slices/hyper/` | `RampDirector` | `npm run sim -- --family hyper` |
| I | hybrid pattern, not a family | the casual core's slice | the core's | the core's gate |

`--family` takes the slice name in column 3, not the letter. A build that
scaffolds without `--family` silently lands family A's arena slice and is wrong
for every other family — that is the single most expensive mistake in this
pipeline.

## Non-negotiable rules

1. **Family first, and never interview unless the user asked to be
   interviewed.** `game-prd` is always invoked in `auto` mode from this skill
   (see `skill://game-prd` §Modes) — zero `ask` calls, family resolved by the
   Step 0 two-tier score, every other axis resolved from that family's
   defaults, logged in PRD §18 Assumptions.
2. **Real concurrency, not padding.** Build workstreams from PRD §16 run as
   one `task` batch with frozen interface contracts; `game-art` groups run
   as a second batch overlapping the build batch wherever their file
   ownership is disjoint (art touches `art/`, `public/assets/generated/`,
   and — at the end — `src/data/art.ts`; build workstreams touch
   `src/objects/`, `src/systems/`, `src/data/{enemies,upgrades,waves}.ts`,
   `src/ui/*`). Neither batch runs `npm run build`/`typecheck`/`verify`
   mid-flight — that is the integrator's job, after both batches land.
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

## Workflow

### Step 0 — Family classification + auto-PRD + scaffold

Invoke `skill://game-prd` in `auto` mode (never interactive) with the user's
pitch verbatim. It performs, in this order:

1. **Step 0 two-tier classification** — Tier 1 scores the pitch's keywords
   against the family table (anchor beats modifier, specificity wins, earliest
   mention then mechanic over setting) and yields one code; a vague, brandless
   or verb-less casual pitch takes the HYBRID DEFAULT (**I**: casual core from
   J/B/F + 2-3 meta-kit layers), never a mid-core fallback and never plain
   match-swap. Tier 2 locks the subgenre from that family's playbook —
   `references/genre-playbooks.md` for A/D/E, `references/casual-playbooks.md`
   for B/C/F/G/H/J, both for I.
2. **Step 0b fixed decisions** — session shape, input profile, camera,
   director and meta shape, all looked up on the code.
3. **Scaffold** — `scripts/new-game.sh <slug> "Title" --family <code> --no-install`,
   which copies the template, prunes every other
   `src/slices/*`, rewrites the `src/scenes/game.ts` re-export and writes
   `src/sim/family.ts` (`SIM_FAMILY`) so a bare `npm run sim` runs the right
   gates.

The result is `games/<slug>/PRD.md` with the family code in its header, a
complete §16 build plan, §18 Assumptions log and §19 acceptance criteria — the
contract for every following step. Read it fully before fanning out, and
confirm the scaffold actually landed the right slice (`src/slices/` holds one
dir; `src/sim/family.ts` names it) before spawning anyone. §16.1's frozen
interface contracts and §12.2's drift surface are law for every workstream.

### Step 1 — Parallel build workstreams

Read PRD §16 (Build plan). Fan out one `task` per workstream (4-6, per the
PRD) in a single batch, each given:

- Its owned files only (§16's "Owns files" column) — no workstream may edit
  a file another workstream owns, and none may edit the frozen-contract
  surface (`TUNING` keys, `StatKey` union, `core/keys.ts` event names,
  content id sets) except the integrator.
- The full §16.1 interface contracts verbatim, as a shared, unchanging
  context block — every sibling task batch call gets the identical text so
  nobody renegotiates a type mid-flight.
- An explicit instruction: no `npm run build`/`typecheck`/lint/test; prove
  your own slice only (module instantiates, data table type-checks in
  isolation).
- The family's own surfaces: gameplay work happens in
  `src/slices/<code>/game.ts` and its local `tuning.ts`/level/content modules,
  never by editing `src/scenes/game.ts` (a one-line re-export) and never by
  moving family numbers into `src/config.ts`. Shared modules —
  `core/{session,run,level,ramp,lap,economy,collections}.ts`,
  `core/board/*`, `ui/{sagaMap,boosterBar,hand,shopTray}.ts`,
  `core/{turns,deck,autobattle}.ts`, `systems/{placement,board}.ts` — are
  imported read-only, not re-implemented or forked per game.

### Step 2 — Art in parallel

Invoke `skill://game-art` as its own subagent (or its own `task` batch
following that skill's Step 1-3) **in parallel with Step 1** whenever their
file ownership is disjoint — which it is by default (art never touches
`src/objects/`, `src/systems/`, or `src/data/{enemies,upgrades,waves}.ts`;
build workstreams never touch `art/` or `public/assets/generated/`).

- Style lock (`game-art` Step 1, `art/style.json`) happens first, before any
  generation — it has no dependency on the build batch and can start the
  instant the PRD's §11 Art direction section exists.
- If the genre needs authored world geometry — tower-defense lanes,
  base-builder plots, dungeon-crawler floors, extraction-run rooms — run
  `skill://map-forge` for the map bundle (collision, zones, scene hooks)
  alongside the sprite/UI generation groups; it produces engine-neutral
  geometry that the Level/systems build workstream consumes directly (never
  hand-estimate collision when `map_trace_geometry` can derive it).
- The art registry generator (`scripts/gen-art-registry.mjs`, producing
  `src/data/art.ts`) is an **integration-time** step, not a Step 2
  deliverable — it runs once, in Step 3, after both the art assets and the
  data tables they reference exist.

### Step 3 — Integration

One integrator (this skill directly, or a single dedicated `task`):

1. Wire the slice's `GameScene` (`src/slices/<code>/game.ts`, re-exported by
   `src/scenes/game.ts`): session director → gameplay systems → UI →
   `GameOverData.stats`, per `template/AGENTS.md` §"Gameplay families and
   slices" and §"How to implement a PRD", and the PRD's §16.1 contracts.
2. Run `node scripts/gen-art-registry.mjs` to produce/refresh
   `src/data/art.ts` from the art pipeline's manifest and exported sheets.
3. Run `npm run verify` (`template/scripts/verify.sh`): typecheck + `npm run
   sim` (this game's family, from `src/sim/family.ts`) + `node
   scripts/gen-art-registry.mjs --check` + every `src/sim/kits/*.selftest.ts`.
   Fix and re-run until clean, or escalate per §Failure policy.

### Step 4 — Balance loop

1. `npm run sim -- --family <code>` — capture the family's gate table (arena
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
   `src/slices/<code>/tuning.ts` (or `TUNING` in `src/config.ts` for arena) —
   an integrator-only edit, per the frozen-contract rule — and re-run the sim.
4. Repeat steps 1-3 for a maximum of **3 iterations**. After 3, stop, ship
   the best iteration, and flag the remaining gate failures explicitly in
   the final report — do not iterate unbounded.

### Step 5 — Browser bot procedure

Drive the actual running game; this is not optional and not simulated.

1. `hub` `op:"start"` — launch `npm run dev` in `games/<slug>/` with
   `ready: { port: 5173, log: "Local:.*http", timeout: 30 }` (adjust the port
   if the template's Vite config differs).
2. Open a `browser` tab at the dev server URL.
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

### Step 6 — Store listing + publish

1. **Store data.** The scaffold already wrote `games/<slug>/game.json` with the
   verbatim `prompt`; fill `description` (1-2 sentences from PRD §1, player-
   facing, no jargon) and `genre`. Copy the 3-5 best Step-5 screenshots into
   `games/<slug>/shots/` (menu, the decision surface, a payoff moment, results)
   and list them in `game.json.screenshots`. If `game-art` produced a cover,
   save it as `public/cover.png` and set `game.json.cover`; otherwise the
   scaffold's gradient `cover.svg` stands.
2. **Preview.** `node scripts/build-site.mjs && python3 -m http.server 5321 -d
   _site` — check the catalog card, the store page (prompt block, gallery) and
   `/play/<slug>/` (the `← Games` pill must return to the catalog).
3. **Publish.** Commit and push to `master`. `.github/workflows/pages.yml`
   rebuilds every game plus the catalog and deploys to
   https://1pgames.github.io/ ; watch the run with `gh run watch`. The `verify`
   job (sims + selftests) runs alongside — a red verify is a bug to fix even
   though it does not block the deploy.
4. **Record.** Capture a short clip of the canvas (screenshots at each beat
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
5. Any fallback taken under §Failure policy, stated plainly, not buried.
6. The exact next commands: `cd games/<slug> && npm install && npm run dev`.

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
  scaffold plain, author `src/slices/<code>/{game,tuning}.ts` by composing the
  shipped kits per the playbook (`turns` + `deck` for a deckbuilder,
  `autobattle` + `systems/board` + `ui/shopTray` for an auto-battler, `turns` +
  `systems/placement` for tactics), point the `src/scenes/game.ts` re-export at
  it, and write `src/sim/families/<code>.ts` with that family's hard gates
  (match completable at high skill, losable at low skill, fight/node pacing)
  plus `SIM_FAMILY`. Report the authored gate explicitly.
- **Pitch maps to no family at all** (nothing in the Step 0 table scores, or
  the pitch is out of scope: real-time multiplayer, gacha LiveOps, social
  casino) → out-of-scope pitches are rejected with a counter-proposal, never
  specced; an unscored casual pitch takes the HYBRID DEFAULT (**I**) rather
  than a mid-core fallback. State the substitution in the PRD Assumptions and
  in the final report.
- **Sim hard gate still fails after 3 balance iterations** → ship the best
  iteration (lowest total gate-violation count, or highest win-rate-spread
  compliance if tied) and flag the specific failing gate(s) in the final
  report — never silently ship a failing hard gate as if it passed, and
  never exceed the 3-iteration budget chasing a clean pass.

## References

| File | Use |
| --- | --- |
| `skill://game-prd` | Family classification (Step 0/0b), auto-PRD generation, §Modes for the forced `auto` invocation; `references/design-heuristics.md` §5.5/§18 for the sim contract and family→verification map, §12 for the frozen-contract surface |
| `skill://game-art` | Style lock, parallel asset generation, engine wiring (Step 2) |
| `skill://map-forge` | World/level geometry — collision, zones, scene hooks — for genres that need authored maps |
| `skill://game-prd/references/casual-playbooks.md` | Subgenre playbooks for families B/C/F/G/H/J (and I's casual core) |
| `skill://game-prd/references/genre-playbooks.md` | Subgenre playbooks for families A/D/E |
| `template/src/slices/` | The eight starter slices; the one the scaffold kept is where gameplay work happens |
| `scripts/new-game.sh` | Scaffold with `--family <code>` — prunes other slices, rewrites the `src/scenes/game.ts` re-export, writes `src/sim/family.ts` |
| `template/AGENTS.md` | The build contract every workstream and the integrator follow; Phaser 4 traps, UI semantics, pooling rules |
| `template/scripts/verify.sh` (`npm run verify`) | Integration gate: typecheck + sim + art registry check + kit selftests |
| `scripts/gen-art-registry.mjs` | Generates `src/data/art.ts` from the art pipeline's manifest — integration-time only, never hand-authored |
