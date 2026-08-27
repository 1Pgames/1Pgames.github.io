---
name: game-build
description: >-
  Turns ONE prompt into a finished, VERIFIED game end-to-end: auto-PRD →
  scaffold → parallel build → art (including map-forge world geometry when the
  genre needs it) → integration → sim + browser verification → balance loop →
  record. Orchestrates `game-prd` (forced `auto` mode), the genre build
  workstreams, and `game-art` as parallel subagent batches, then drives
  `npm run verify` and a live browser playthrough before declaring the game
  done. Use for "make a game about X end to end", "today's game", "сделай игру
  про X", or any single-prompt request for a complete playable game — as
  opposed to `game-prd` alone, which only produces the spec.
---

# Game Build (one prompt → verified game)

This skill is the top-level orchestrator. It never writes gameplay code
itself — it fans work out to `game-prd`, genre build workstreams, and
`game-art` as parallel subagents, then personally owns integration,
verification, and the balance loop. A user who says "make a game about X"
and nothing else gets a scaffolded, art-dressed, sim-balanced,
browser-verified game with no further questions asked.

Fixed decisions (same as `game-prd`, never re-derive): portrait 720x1280,
Phaser 4.2 + Vite + TypeScript template, 5-10 minute runs, one-thumb +
keyboard input, parallel build with one integrator.

## Non-negotiable rules

1. **Never interview unless the user asked to be interviewed.** `game-prd` is
   always invoked in `auto` mode from this skill (see `skill://game-prd`
   §Modes) — zero `ask` calls, every axis resolved from the pitch and
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
   integrator subagent it spawns) wires `GameScene`, generates the art
   registry, and is the only step that runs `npm run verify`.
4. **The balance loop is bounded.** Sim → `TUNING` edit → re-sim, maximum 3
   iterations. After 3, ship the best iteration and say so in the report —
   never iterate unbounded, never silently ship a failing hard gate.
5. **The browser loop is mandatory and spelled out.** A game is not "done"
   until it has been driven end-to-end in a real browser tab with
   screenshots at every state (Step 5). Sim gates prove balance; the browser
   loop proves the game actually renders and responds to input.
6. **Failure degrades gracefully, never silently.** See §Failure policy —
   every fallback is reported in the final Assumptions/report, never hidden.

## Workflow

### Step 0 — Auto-PRD

Invoke `skill://game-prd` in `auto` mode (never interactive) with the user's
pitch verbatim. This produces `games/<slug>/PRD.md` with a complete §16 build
plan, §18 Assumptions log, and §19 acceptance criteria — the contract for
every following step. Read it fully before fanning out; §16.1's frozen
interface contracts and §12.2's drift surface (from `design-heuristics.md`,
inherited into the PRD) are law for every workstream below.

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
- Genre kit workstreams that need the pure-logic modules from
  `src/core/{turns,deck,autobattle}.ts`, `src/systems/{placement,board}.ts`,
  or `src/ui/{hand,shopTray}.ts` import them read-only; they are owned by the
  GenreKits build, not re-implemented per game.

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

1. Wire `GameScene`: director → spawner → combat → UI, per
   `template/AGENTS.md` §"How to implement a PRD" and the PRD's §16.1
   contracts.
2. Run `node scripts/gen-art-registry.mjs` to produce/refresh
   `src/data/art.ts` from the art pipeline's manifest and exported sheets.
3. Run `npm run verify` (`template/scripts/verify.sh`): typecheck + `npm run
   sim` gates + `node scripts/gen-art-registry.mjs --check` + every
   `src/sim/kits/*.selftest.ts`. Fix and re-run until clean, or escalate per
   §Failure policy.

### Step 4 — Balance loop

1. `npm run sim -- --lane all --json` — capture per-lane winrate,
   `firstUpgradeS`, decision cadence.
2. Check hard gates (winnable, losable, first-upgrade timing) and soft gates
   (win-rate spread ≤ 0.35, cadence 10-14) per
   `skill://game-prd/references/design-heuristics.md` §5.5.
3. If any gate fails: edit the offending `TUNING` values in `src/config.ts`
   (integrator-only edit, per the frozen-contract rule), re-run the sim.
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
   PRD.
4. Start a run; screenshot early gameplay; verify the HUD is ticking (timer
   advancing, HP/XP bars responding) via `tab.observe()`/a second
   screenshot a few seconds later.
5. Play (drive input via `tab` — click/drag/keyboard per the PRD's §3
   Controls) until the first level-up/upgrade draft overlay appears;
   screenshot it.
6. Pick a card/upgrade; confirm the overlay dismisses and the field resumes.
7. Pause, screenshot the pause state, resume.
8. Play to a death or a win; screenshot the results screen.
9. Retry; confirm a fresh run starts cleanly.
10. Any state that fails to render, mis-renders, or does not respond to
    input → fix the owning file, restart the dev server if needed, repeat
    from the failing state — never skip a state or claim success without its
    screenshot.

### Step 6 — Record

Capture a short clip of the canvas (screenshots at each beat from Step 5 are
the minimum bar; a screen recording of one full run through the highlight
beats in `design-heuristics.md` §13 is the stretch goal when the recording
tool is available). Attach whichever was captured to the final report.

### Step 7 — Final report

Report, in this order:

1. PRD path (`games/<slug>/PRD.md`) and the one-line pitch.
2. The Assumptions summary (every auto-resolved axis, 4-6 lines).
3. The sim table: per-lane winrate, `firstUpgradeS`, decision cadence, and
   which balance-loop iteration produced it.
4. The screenshot set from Step 5, one per state, with a one-line playability
   verdict per state (renders correctly / input responds / matches PRD).
5. Any fallback taken under §Failure policy, stated plainly, not buried.
6. The exact next commands: `cd games/<slug> && npm install && npm run dev`.

## Failure policy

- **Art asset fails QC budget** (palette drift, silhouette collision,
  clipped limbs after `game-art`'s retry budget) → keep the template's
  default procedural/chibi asset for that slot, record a `qcExceptions`
  entry with the reason, and continue — never block the whole build on one
  asset.
- **Genre kit missing for an exotic pitch** (the pitch does not cleanly map
  to any of the 12 `genre-playbooks.md` genres or to a shipped
  `core/{turns,deck,autobattle}.ts` kit) → fall back to the nearest playbook
  genre by keyword score (same rule as `question-bank.md` Q2's Auto rule)
  and state the substitution explicitly in the PRD's Assumptions and in the
  final report.
- **Sim hard gate still fails after 3 balance iterations** → ship the best
  iteration (lowest total gate-violation count, or highest win-rate-spread
  compliance if tied) and flag the specific failing gate(s) in the final
  report — never silently ship a failing hard gate as if it passed, and
  never exceed the 3-iteration budget chasing a clean pass.

## References

| File | Use |
| --- | --- |
| `skill://game-prd` | Auto-PRD generation; §Modes for the forced `auto` invocation, `references/design-heuristics.md` §5.5/§12 for the sim contract and frozen-contract surface |
| `skill://game-art` | Style lock, parallel asset generation, engine wiring (Step 2) |
| `skill://map-forge` | World/level geometry — collision, zones, scene hooks — for genres that need authored maps |
| `template/AGENTS.md` | The build contract every workstream and the integrator follow; Phaser 4 traps, UI semantics, pooling rules |
| `template/scripts/verify.sh` (`npm run verify`) | Integration gate: typecheck + sim + art registry check + kit selftests |
| `scripts/gen-art-registry.mjs` | Generates `src/data/art.ts` from the art pipeline's manifest — integration-time only, never hand-authored |
