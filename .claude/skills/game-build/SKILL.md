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

Project agents live in `.omp/agents/*.md`; each carries its contract, owned
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
| `gameplay-programmer` | `core/**` engines, slice gameplay logic, sim-model parity, selftests | Step 1 wave |
| `ui-engineer` | scenes, UI chrome, HUD, coach wiring, every Step 5.5 fix | Step 1 wave, Step 5.5 |
| `fx-artist` | game-feel wiring: juice/sfx/tween timing, transitions, skip paths, the §13 feel budgets made real | dedicated feel pass after Step 3, before qa |
| `ux-flow-designer` | PRD §14b flow map (scene graph, tap-depth, interruption matrix, edge states); flow audit of the built game | Step 0 (with game-designer), flow audit before the critic |
| `art-director` | vision board + anchors (Step 1b), interface direction: UI palette / HUD plan / chrome spec (Step 1c, revises PRD §11+§14), `art/style.json`, generation + QC, manifest, cover/og, icon sheets | Step 2 — vision lock + Step 1c land FIRST (early deliverable ui-engineer waits on) |
| `content-writer` | naming lexicon, all player-facing copy, store listing strings | Step 1 wave (parallel), Step 6.1 |
| `build-integrator` | seam reconciliation, GameScene wiring, registry, the ONLY `npm run verify` runner, boot smoke | Step 3 |
| `game-qa` | golden-path E2E, invariant scans, bug repro/minimization, regression re-checks | Step 5, after every fix round |
| `game-critic` | persona playtests (novice/veteran/masher), feel verdict vs §1b bar | after Step 5.5, before EVERY user handoff |
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
   one `task` batch with frozen interface contracts; `game-art` groups run
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
  `src/slices/<slice>/game.ts` and its local `tuning.ts`/level/content modules,
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
- **Key art is a required deliverable, not a nice-to-have.** `game-art`'s cover
  step produces the store cover; the integrator saves it as
  `public/cover.png` (600x800) and `games/<slug>/shots/og.png` (1200x630 social
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
3. Run `npm run verify` (`template/scripts/verify.sh`): typecheck + `npm run
   sim` (this game's family, from `src/sim/family.ts`) + `node
   scripts/gen-art-registry.mjs --check` + every `src/sim/kits/*.selftest.ts`.
   Fix and re-run until clean, or escalate per §Failure policy.

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

### Step 6 — Store listing + publish

1. **Store data — English, complete, cover included.** The scaffold already
   wrote `games/<slug>/game.json` with `status: "draft"` and the English
   `prompt`/`genre`/`description` from Step 0; tighten `description` to 1-2
   player-facing sentences from PRD §1 (no jargon, no family jargon, English).
   Then:
   - **Cover (required).** Save `game-art`'s key art as `public/cover.png`
     (600x800) and set `game.json.cover` to `cover.png`. Also export the social
     crop to `games/<slug>/shots/og.png` (1200x630) — the site uses
     `media/<slug>/og.png` for `og:image` when that file exists, otherwise the
     first `.png` screenshot, otherwise no `og:image` at all. The gradient
     `cover.svg` is draft-only and fails the release gate.
   - **Screenshots (≥3).** Copy the 3-5 best Step-5 shots into
     `games/<slug>/shots/` (menu, the decision surface, a payoff moment,
     results) and list them in `game.json.screenshots`.
   - **Preview clip (optional).** A short loop of real gameplay saved as
     `games/<slug>/shots/preview.webm` becomes an autoplaying muted loop on the
     store page. Skip it rather than ship a stuttering one.
2. **Release gate.** `node scripts/release-check.mjs <slug>` (`--json` for a
   machine-readable findings array). Hard checks: `status` valid; `title`,
   `genre`, `description` (≥ 40 chars) and `prompt` present and free of
   Cyrillic; ≥ 3 screenshots listed **and** on disk; `cover` = `cover.png` with
   a real PNG behind it (never the scaffold gradient); no scaffold placeholder
   strings left in `index.html`/`menu.ts`; generated art not a byte-copy of the
   template set; **`playtest.approved: true` recorded by a real user
   playtest** (step 3 below — the one finding that cannot be fixed by
   editing files). Warnings (not blockers): missing `shots/og.png`, leftover
   `cover.svg`, Cyrillic in `menu.ts`. Fix everything else it reports first,
   so the playtest is the only remaining blocker.
3. **User playtest gate (blocking).** The user plays the game before it
   ships — no exceptions:
   - Keep the Step-5 dev server running (or restart it) and hand the user the
     URL plus a one-line "what to try" (the family's core loop verbs).
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
5. **Publish.** Make the build's FIRST commit (everything: game, docs,
   pipeline changes it needed) and push to `master` — allowed only now, with
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
7. Release state: `game.json.status` (`draft` or `released`), the
   `release-check.mjs` verdict, the **playtest state** (approved by whom and
   when, or the playtest URL still awaiting the user), and — if any wave
   needed it — which subagents died and were respawned or taken over (from
   `build-state.json`).
8. The exact next commands: `cd games/<slug> && npm install && npm run dev`.

### Step 8 — Post-release retrospective (mandatory, ~10 minutes)

The pipeline learns per release, not per complaint. After the deploy is
live:

1. **Delta table.** Two columns: findings the INTERNAL loop caught
   (code-reviewer / qa / flow audit / critic) vs findings the USER's
   playtest caught. Every user-caught finding is a hole in an internal
   gate — name the gate that should have caught it.
2. **Route the holes** per `references/playtest-lessons.md` (merge-first):
   contract rule, quality budget, playbook number, agent-prompt duty, sim
   gate, cert/audit script check. A hole with no destination is a new gap —
   say so explicitly.
3. **Tighten budgets that measured slack.** If every game clears a budget
   band effortlessly, the band is too loose to teach anything — tighten it
   in `template/AGENTS.md` §Quality budgets with the measured evidence.
4. Append one line to the game's PRD: `Retro: <n internal / m user
   findings, holes routed to <destinations>>` — the audit trail that the
   step ran.

A release without a retro is unfinished: the NEXT game pays for it.


## Checkpoints and dead agents

Subagents die. The observed failure mode in this pipeline is a **provider stream
death mid-write**: the agent stops with no result, having already created some
files and half-written others. A wave that is not checkpointed cannot tell that
state apart from success, and the integrator then wires a half-written slice.

**Before each wave** (Step 1 build batch, Step 2 art batch, Step 3 integration),
write `games/<slug>/build-state.json`:

```json
{
  "wave": "build",
  "tasks": [
    { "name": "BoardEngine", "ownershipGlobs": ["src/slices/board/**", "src/data/levels.ts"], "status": "running" },
    { "name": "MetaUI", "ownershipGlobs": ["src/ui/**"], "status": "running" }
  ]
}
```

`name` matches the `task` name, `ownershipGlobs` is that task's §16 "Owns files"
column expanded to globs, `status` is one of `pending` | `running` | `done` |
`dead` | `taken-over`. **After each wave**, update every row's status from the
actual results before doing anything else.

**When a subagent dies** (no result returned, provider/stream error, or a
result that does not match its ownership globs):

1. Mark it `dead` in `build-state.json`.
2. Re-check its ownership globs against reality — `git status --short` plus a
   read of the files it claimed — and decide:
   - **nothing written** → respawn from scratch;
   - **partial write** (files exist, incomplete or non-compiling) → respawn to
     resume;
   - **complete work, lost result** (all owned files present and coherent
     against §16.1) → mark `done`, do not respawn.
3. Respawn with the **same task text verbatim**, prefixed with:
   *"A previous attempt at this task died mid-write. Its partial work is already
   on disk in your owned files — read them first, reconcile against the
   contracts below, and finish the task. Do not start over from scratch if the
   existing code is usable, and do not duplicate what is already there."*
   Frozen contracts and file ownership are unchanged — never widen a respawn's
   ownership to cover a sibling's files.
4. **Maximum 2 respawns per task.** After the second death, the orchestrator
   takes the slice over itself, finishes it inline, marks the row `taken-over`,
   and says so in the Step 7 report.

**Never proceed to integration (Step 3) with any task in an unknown state.** A
row that is neither `done` nor `taken-over` blocks the wave — reconcile it
first. `build-state.json` stays in the game folder as the build's audit trail.

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
| `scripts/release-check.mjs` | Release gate: manifest completeness, English-only fields, ≥3 screenshots, real raster cover, no scaffold leftovers, and `playtest.approved` from a real user playtest — exit 0 is the precondition for setting `game.json.status` to `released` |
| `scripts/build-site.mjs` | Catalog + store pages; publishes released games only (`--include-drafts` for local preview) |
| `games/<slug>/build-state.json` | Per-wave checkpoint written by this skill — task names, ownership globs, statuses; the audit trail for dead-agent recovery |
| `template/AGENTS.md` | The build contract every workstream and the integrator follow; Phaser 4 traps, UI semantics, pooling rules |
| `template/scripts/verify.sh` (`npm run verify`) | Integration gate: typecheck + sim + art registry check + kit selftests |
| `scripts/gen-art-registry.mjs` | Generates `src/data/art.ts` from the art pipeline's manifest — integration-time only, never hand-authored |
