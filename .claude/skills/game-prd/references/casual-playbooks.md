# Casual family playbooks

Companion to `references/genre-playbooks.md`, which covers family **A**
(real-time-arena: survivor-like, action roguelike, bullet hell) and family **D**
(turn-based-cards-tactics: deckbuilder, tactics, auto-battler). This file
covers the casual, table, word and hypercasual families — **B, C, E, F, G, H,
J** — and the hybrid composition pattern **I**.

Same 13-section format per playbook, same fixed frame: portrait **720x1280**,
`SAFE` top 140px / bottom 220px / side 40px, 60fps target on a 2019-class
phone.

The single 480s reference run of `genre-playbooks.md` is a family-A artifact.
Casual families satisfy the mandated 5-10 minute session by **composing short
attempts**: a session is N levels, N runs or N rolls, not one timer. Each
family's session frame is fixed below and every playbook's beat table keys off
it.

## Family frame

| Family | Name | Session director | Camera | Input profile | 5-10 min session composed of |
| --- | --- | --- | --- | --- | --- |
| B | board-puzzle | `LevelDirector` | static-board | tap + swipe | 4-8 levels at 45-120s each |
| C | side-view-physics | `LevelDirector` (levels) or `RampDirector` (endless) | side-follow | tap / swipe / drag | 8-20 levels at 20-45s, or 4-10 runs at 45-150s |
| E | track-vehicle | `LapDirector` | track | drag (steer) + tap (drift) | 2-4 races at 120-200s each |
| F | idle-tycoon | none in the core loop; `LevelDirector` for milestone chapters | static-board (static UI) | tap | one continuous 6-10 min first session, then 60-180s check-ins |
| G | table-dice | `LevelDirector` (solitaire deals, dice-board chapters) | static-board | tap + drag | 3-6 deals at 60-150s, or one 5-10 min energy bar of rolls |
| H | word-trivia | `LevelDirector` | static-board | tap + swipe (drag-connect) | 5-12 puzzles/rounds at 30-90s each |
| J | hypercasual | `RampDirector` | side-follow or static-board | one-finger (tap or swipe) | 5-15 runs at 30-120s each |
| I | hybrid (pattern, not a family) | casual core's director + meta-kit | inherited from the core | inherited | one J/B/F core loop + a meta layer between attempts |

## Director contracts

All four directors implement `SessionDirector` from `core/session.ts` and are
driven identically by the scene: `update(deltaMs)` each frame, then read
`ended` / `outcome` / `progress`.

| Member | Meaning |
| --- | --- |
| `update(deltaMs)` | advance the session by one frame |
| `elapsedMs` | wall time inside the session, pause-excluded |
| `ended` | session is over; scene must stop accepting input |
| `outcome` | `{ won: boolean, reason: string }` — `reason` is the fail/win cause shown on the results panel |
| `progress` | 0..1 for the HUD progress element (goal completion, ramp depth, lap fraction) |
| `pause()` / `resume()` | freeze the whole scene, not just the director |

| Director | File | Drives | Families |
| --- | --- | --- | --- |
| `RunDirector` | `core/run.ts` | fixed-duration timed run, wave timeline, phase multipliers | A |
| `LevelDirector` | `core/level.ts` | goal set + move/time budget, win/fail evaluation, star thresholds | B, C-levels, G, H |
| `RampDirector` | `core/ramp.ts` | endless score-chase difficulty ramp, no win condition, single fail state | J, C-runner |
| `LapDirector` | `core/lap.ts` | laps, checkpoints, per-lap splits, finishing position | E |

## Shared modules cited in this file

| Module | Contents |
| --- | --- |
| `core/board/types.ts` | shared board types: `BoardCell`, piece/tier/color ids, `GoalSpec`, `BoardStep` — no Phaser import, so every sim gate can use them |
| `core/board/grid.ts` | typed cell grid: fill from a level spec, swap, neighbor/group query, refill queue, flat save serialization |
| `core/board/resolve.ts` | match/blast detection + gravity (column collapse, spawn-from-top) + the cascade loop; emits an ordered `BoardStep[]` the scene animates. The only writer of tile positions |
| `core/board/merge.ts` | merge-2 rules: identical-pair detection, tier-up, chain forks, jam detection (no gravity) |
| `core/board/sort.ts` | container/stack rules: legal pour or transfer, container completion, deadlock detection |
| `core/board/block.ts` | polyomino placement: fit test, line/region clear, no-legal-placement (game-over) test |
| `core/economy.ts` | exponential generator economy: cost curves, production rates, offline accrual, prestige reset with a carry-over multiplier |
| `core/deck.ts` | seeded deck/pile primitive (draw, discard, exhaust, reshuffle); solitaire builds tableau/foundation piles on it |
| `core/progression.ts` | `MetaSave` persistence (`currency`, `unlocks`, `upgrades`, `stats`) |
| `core/rng.ts` | `Rng` — seeded; every level/deal/track/question set is a seed, never `Math.random` |
| `core/controls.ts` | `Controls` — `onTap`, `onSwipe`, `onDrag`, `onHoldStart/onHoldEnd`; joystick is optional per slice and unused in every family in this file |
| `ui/hand.ts` | fanned card row with tap/drag pick-up — used by G-solitaire's stock/waste and by pattern-I card metas |
| `ui/bars.ts`, `ui/cards.ts`, `ui/hud.ts`, `ui/button.ts` | HUD bars, choice panels, HUD frame, buttons |
| meta-kit | shared, family-agnostic: `ui/sagaMap.ts` (level nodes, star gates, chapters), `ui/boosterBar.ts` (booster tray, arming, shop entry), `core/collections.ts` (albums, sets, streaks/daily, reward track state), plus `core/progression.ts` for stars/currency persistence and a per-slice decor/renovation-task scene |

Scaffold and gates, identical for every playbook here:

- `scripts/new-game.sh <slug> --family <code>` scaffolds the slice as
  `src/slices/<family>/game.ts` plus its starter data files. Slice directory
  names: `arena` (A), `board` (B), `side` (C), `track` (E), `idle` (F),
  `table` (G), `word` (H), `hyper` (J).
- `npm run verify` — typecheck, lint, headless boot, asset manifest.
- `npm run sim -- --family <code>` — runs `src/sim/families/<family>.ts`. B:
  board solver win-rate curve per level. C/J: ramp session-length bot. E: lap
  bot. F: economy curve check. G: deal solvability + roll distribution. H:
  wordlist and answer-key validation.

## Selection table

| # | Subgenre | Family | Primary verb | Systems weight | Content volume (levels/pieces/specials) | Build sessions | 2026 market signal | Best-fit pitch keywords |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | Match-swap / blast | B | Swipe swap or tap group | M | 20-50+ / 6-9 / 3-5 | 1-1.5 | puzzle = 44% of casual revenue, but 0.8% new-title success rate | match-3, cascade, blast, boosters |
| B2 | Merge-2 | B | Drag piece onto twin | M | 20-50+ / 6-9 chains / 3-5 | 1.5 | +65-74% YoY | merge, chain, generator, board inventory |
| B3 | Sort / screw | B | Tap source then container | M | 20-50+ / 6-9 colors / 3-5 | 1-1.5 | +170-229% YoY | water sort, nuts and bolts, unscrew, containers |
| B4 | Block-fit | B | Drag block into grid | S-M | 20-50+ / 6-9 shapes / 3-5 | 1 | +176% YoY | block blast, line clear, bin packing, wood puzzle |
| C1 | Platformer levels | C | Tap jump (+ swipe dash) | M | 12-20 levels / 6-9 hazards / 3-5 | 1.5 | Level Devil, Moto X3M carry web-portal traffic | precision jump, trap level, rage platformer |
| C2 | Endless runner | C | Swipe lane / tilt-free steer | M | 6-10 chunk types / 6-9 obstacles / 3-5 | 1-1.5 | Subway-class = 8.34% of all mobile downloads | endless run, dodge, lane switch, coin line |
| E1 | Top-down arcade racing | E | Drag steer + tap drift | M-L | 3-6 tracks / 4-8 bots / 3-5 upgrades | 1.5 | racing market $9.8B | laps, drift boost, rivals, tuning |
| F1 | Idle tycoon | F | Tap upgrade / tap collect | M | 8-12 generators / 4-6 managers / 3-5 prestige perks | 1-1.5 | simulation is #1 by downloads (6.3B on Google Play) | idle, exponential, prestige, offline earnings |
| G1 | Dice-board | G | Tap roll | M-L | 20-40 tiles / 3-6 boards / 3-5 tile events | 1.5-2 | Monopoly GO: $27-43 IAP per install | roll and move, landmarks, collections, dice energy |
| G2 | Solitaire family | G | Tap or drag card | S-M | 20-50+ deals / 3 variants / 3-5 boosters | 1 | evergreen; MS Solitaire ~35M MAU | klondike, tripeaks, spider, daily deal |
| H1 | Word + trivia | H | Drag-connect letters / tap answer | S-M | 20-50+ puzzles / 100+ questions / 4 categories | 1 | word and trivia are the cheapest content-per-hour casual genres | word connect, crossword, quiz, categories |
| J1 | Hypercasual one-mechanic | J | One finger, one verb | S | 1 mechanic + 1-2 twists / 10-15 skins | 0.5-1 | #1 by downloads (22B); hybrid-casual +20-23%, the only growing segment | tap timing, stacking, swerve, rise, io-lite |

Pattern **I** (hybrid) is not a row: it is `J1`, `B2-B4` or `F1` used as the
casual core plus 2-4 meta-kit components. See the promotion path in `J1`.

## Family B — board-puzzle

Shared frame for all four B playbooks; a playbook only restates what it
changes.

**Board geometry.** 8 cols x 8 rows at `cellPx = 80` gives a 640x640 board,
`origin = { x: 40, y: 300 }` — fully inside `SAFE` sides, with a 160px HUD
band above (y 140-300) and a 340px bottom band (y 940-1280) for boosters and
the thumb. Grids wider than 9 or taller than 10 break the 80px minimum touch
target and are prohibited in portrait.

**Level pipeline.** Every level is `{ seed, layout, goals, moveBudget, starThresholds }`
authored in `data/levels.ts`, loaded by the slice scene, executed by
`core/board/grid.ts` + `core/board/resolve.ts`, scored against the goal set in
`core/board/types.ts`, and adjudicated by `LevelDirector` (`core/level.ts`).

**Slice + gates.** `scripts/new-game.sh <slug> --family B` scaffolds
`src/slices/board/game.ts`; `npm run sim -- --family B` runs
`src/sim/families/board.ts` (board solver + policy bots).

**Level-curve table (shared B target).** `npm run sim -- --family B` runs the
board solver 500 times per level and fails the gate if the measured first-try
win rate leaves its band by more than 8 points.

| Level index | Target first-try win rate | Role | Move budget vs solver-optimal |
| --- | --- | --- | --- |
| 1-5 | 95-100% | teach one mechanic per level, no fail possible in 1-3 | +60-80% moves |
| 6-15 | 85-95% | build confidence, introduce specials | +35-50% moves |
| 16-30 | 70-85% | first real fail; booster tutorial fires on the first loss | +20-30% moves |
| 31-50 | 55-70% | booster demand becomes structural | +8-15% moves |
| 51+ | 45-60%, with a 30-40% spike every 10th level | retention wall / gate | -5% to +8% moves |

**Content volume (shared B floor).**

| Item | Minimum | Comfortable |
| --- | --- | --- |
| Levels | 20 | 50+ |
| Piece types | 6 | 9 |
| Specials | 3 | 5 |
| Boosters | 2 | 4 |
| Blockers / obstacles | 2 | 5 |

## B1. Match-swap and blast

Swap-adjacent match-3 and tap-a-group blast are one playbook: identical
grid, gravity, cascade and goal systems, different match predicate (swap two
cells and test for 3-in-a-line vs tap a connected same-color group of >=2).

**Market warning, state it in the PRD.** Puzzle is 44% of casual revenue, but
the new-title success rate for pure match-swap is **0.8%** — the most crowded
mechanic in mobile. Recommend this playbook only as (a) the casual core of a
pattern-**I** hybrid where the meta layer carries the product, or (b) blast
rather than swap, which is cheaper to build and less saturated. For a
standalone board-puzzle pitch, steer to `B2`/`B3`/`B4`, whose categories are
growing 65-229% YoY.

### Core loop and run shape

**Core loop:** read the board, spend one of a finite pool of moves to create a
match, watch the cascade resolve and goals tick down, chase the specials that
turn a bad board into a chain, and finish the goal set before the moves run
out.

| Level time | Beat |
| --- | --- |
| 0:00-0:05 | Board deals in from the top (`core/board/resolve.ts` spawn pass); goal chips animate into the HUD; no input accepted until stable. |
| 0:05-0:20 | First 2-3 moves. Player scans for the obvious match; first cascade fires; first goal chip decrements. |
| 0:20-0:50 | Mid-level. First special created (from a 4+ match or a 5+ blast group); blockers start gating the remaining goals. |
| 0:50-1:20 | Endgame. Moves remaining <= 6, HUD switches the move counter to warning color; special-combo chance is the intended out. |
| 1:20-1:35 | Resolution. Goals complete -> remaining moves fire as free specials (the "sugar crush" payoff), stars awarded; or moves hit 0 -> fail panel with a booster/retry offer. |
| between levels | Saga-map node advance, star deposit, reward-track tick: 8-15s. |

Session: 4-8 levels, 45-120s each, plus inter-level meta = 5-10 min.

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Swipe (match-swap) | Swap the touched cell with its neighbor in the swipe direction; illegal swap plays a 120ms bounce-back | `Controls.onSwipe` -> `grid.swap(a, b)` |
| Tap (blast) | Clear the connected same-color group under the finger if `size >= minGroup` | `Controls.onTap` -> `grid.groupAt(cell)` |
| Tap on special | Detonate in place without consuming a swap-move (blast) or as the move itself (swap) | `Controls.onTap` -> `resolve.detonate(grid, cell)` |
| Tap on booster then tap target | Arm booster, then apply to a cell/row/color | `ui/boosterBar.ts` `arm()` -> `resolve.applyBooster(grid, booster, cell)` |
| Hold on any cell | Hint highlight after 600ms of no input (accessibility, not a booster) | `Controls.onHoldStart` |

No drag-follow, no joystick. The board never scrolls.

### Systems required

| Module | Use |
| --- | --- |
| `core/level.ts` (`LevelDirector`) | move budget, goal set, win/fail, 1-3 star thresholds, `progress` = goal completion fraction, `outcome.reason` = `'goals' \| 'outOfMoves'` |
| `core/board/types.ts` | `BoardCell`, `PieceType`, `GoalSpec`, `BoardStep` |
| `core/board/grid.ts` | cell storage, `swap`, `matchesAt`, `groupAt`, refill queue |
| `core/board/resolve.ts` | detection + gravity + the cascade loop; emits `BoardStep[]` (`clear`, `fall`, `spawn`, `special`) that the scene animates at 90-140ms per step; also applies boosters |
| `core/rng.ts` | `Rng` seeded per level id, so a level plays the same board for every player and for the sim gate |
| `core/progression.ts` | `MetaSave.stats` (levels cleared, stars), `MetaSave.currency` (coins), `MetaSave.upgrades` (owned boosters) |
| meta-kit `ui/sagaMap.ts` | level nodes, star gates, chapter boundaries |
| meta-kit `core/collections.ts` | star ledger, reward track, daily level + login streak |
| meta-kit `ui/boosterBar.ts` | pre-level loadout picker, in-level tray, shop entry |
| `ui/hud.ts`, `ui/bars.ts` | move counter, goal chips, score bar |
| `ui/cards.ts` | fail panel offers (retry / +5 moves / booster) and pre-level booster picker |
| NEW: needs `objects/tile.ts` | Tile view: sprite + type + special flag + pooled tween set. Spec: `class Tile { setType(t: PieceType): void; playClear(delayMs: number): Promise<void>; playFall(toRow: number): Promise<void> }`. |
| NEW: needs `data/levels.ts` | `LevelSpec[]`: `{ id, seed, cols, rows, layout: string[], goals: GoalSpec[], moveBudget: number, starThresholds: [number, number, number] }`. |

### Content volume

| Item | Minimum | Comfortable |
| --- | --- | --- |
| Levels | 20 | 50+ |
| Piece types (colors) | 6 | 9 (but only 5-6 live on any one board) |
| Specials | 3 (line, bomb, color) | 5 (+ cross, + rainbow) |
| Special x special combos | 3 | 9 (every pair) |
| Blockers | 2 (crate, ice) | 5 (+ chain, spawner, jelly) |
| Boosters | 2 | 4 |
| Goal types | 2 | 4 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `board.cols` | 8 | 6-9 | cells | portrait limit |
| `board.rows` | 8 | 7-10 | cells | |
| `board.cellPx` | 80 | 72-92 | px | 80px = minimum comfortable touch target |
| `board.colorsLive` | 5 | 4-6 | count | 4 makes cascades trivial, 7+ makes boards unreadable |
| `blast.minGroup` | 2 | 2-3 | cells | blast variant only |
| `swap.invalidBounceMs` | 120 | 90-160 | ms | illegal-swap feedback |
| `cascade.stepMs` | 110 | 90-140 | ms | one resolver step animation |
| `cascade.maxDepth` | 12 | 8-20 | steps | safety cap; a deeper cascade is a level-design bug |
| `gravity.fallPxPerMs` | 1.6 | 1.2-2.2 | px/ms | tile fall speed |
| `moveBudget.level1` | 25 | 20-30 | moves | |
| `moveBudget.level50` | 22 | 18-28 | moves | budget shrinks while goals grow |
| `special.threshold` | 4 | 4-5 | matched cells | 4 -> line, 5 -> color |
| `special.blastThreshold` | 6 | 5-7 | group size | blast variant |
| `score.perTile` | 60 | 40-100 | points | |
| `score.cascadeMul` | 1.5 | 1.3-2.0 | multiplier/depth | compounding per cascade step |
| `stars.threshold1` | 1.0 | — | x par score | par = solver median |
| `stars.threshold2` | 1.6 | 1.4-1.8 | x par score | |
| `stars.threshold3` | 2.4 | 2.0-3.0 | x par score | |
| `hint.idleMs` | 600 | 500-1200 | ms | hint highlight delay |
| `entityBudgetLive` | 220 | 180-260 | count | 64 tiles + specials + up to ~150 particles |

### Progression math

Par score per level: `par(L) = score.perTile * goalTileCount(L) * 1.35`.
Stars are score/par ratios, so a level's own goal size normalizes them.

Goal growth and budget squeeze across the saga:

| Level | Goal tiles | Move budget | Moves per goal tile | Target win rate |
| --- | --- | --- | --- | --- |
| 1 | 20 | 25 | 1.25 | 98% |
| 10 | 40 | 26 | 0.65 | 90% |
| 20 | 55 | 25 | 0.45 | 78% |
| 30 | 70 | 24 | 0.34 | 72% |
| 40 | 85 | 23 | 0.27 | 62% |
| 50 | 100 | 22 | 0.22 | 57% |

Cascade scoring worked example: a 4-match that creates a line special, which
clears 8 more tiles at cascade depth 2, then 5 at depth 3:
`4*60 + 8*60*1.5 + 5*60*1.5^2 = 240 + 720 + 675 = 1635` points against a
level-20 par of `60 * 55 * 1.35 = 4455` — i.e. one strong chain is ~37% of a
1-star clear, which is the intended "three good chains win the level" feel.

### Meta progression

Persisted in `MetaSave`: `stats.levelsCleared`, `stats.stars`, `currency`
(coins), `upgrades[boosterId]` (owned counts), `unlocks` (chapters).

| Meta-kit component | Wiring | Numbers |
| --- | --- | --- |
| `ui/sagaMap.ts` | one node per level, 10 levels per chapter | chapter gate every 10 levels |
| stars (`core/progression.ts`) | 1-3 per level, spent on chapter gates and decor tasks | gate cost = 12 stars per chapter (of 30 available) |
| `ui/boosterBar.ts` | pre-level loadout (max 2 armed) + in-level shop | hammer 150 coins, row-clear 220, color-bomb 400, shuffle 90 |
| `core/collections.ts` streaks/daily | daily level with a x2 coin bonus; 7-day streak track | day-7 reward = 1 of each booster |
| `core/collections.ts` reward track | star-fed track, 20 tiers per chapter | tier every 4 stars |
| `core/collections.ts` albums (optional) | level-drop collectible set, 8-12 per chapter | 1 drop per 3 levels |
| decor/renovation tasks (slice scene) | stars buy decor steps in a room scene | 1 task = 3-6 stars, 5-8 tasks per room |

Coins: `grantCurrency(30 + stars * 20 + firstClearBonus)` where
`firstClearBonus = 50` on a level's first clear, 0 on replays.

### Build variety

A board-puzzle's "build variety" is **solution variety per level**, proven by
the sim gate: for each level, the solver must find at least 3 distinct
opening sequences (disjoint in their first 3 moves) that clear it, and no
single tile column may be required by every solution. Level-authoring
archetypes to hit that: (1) two independent goal clusters (left/right), so
the player chooses an order; (2) a blocker wall that can be broken top-down
with a line special or bottom-up with cascades; (3) a spawner that rewards
ignoring the main goal for 3-4 moves. Boosters add a third axis — every level
past 30 must be clearable with zero boosters (verified by the gate) so the
economy stays optional.

### Portrait UI plan

- y 140-190: chapter + level label, pause button (88x88px, right-aligned to
  `SAFE` side).
- y 190-300: goal chips row — up to 4 chips at 120x104px, 16px gutters,
  centered; move counter as a 132x104px chip at the left, score bar
  (`Bar`, 400x16px) under the chips.
- y 300-940: the 640x640 board. Nothing overlays it, ever — cascade text
  popups render inside it but auto-fade in 400ms.
- y 940-1120: booster tray, up to 4 slots at 120x120px with 24px gutters,
  centered. This is the thumb band: the board's bottom row sits at y 860-940,
  a comfortable 80px above the tray.
- y 1120-1280: reserved empty (`SAFE` bottom), used by the fail/win panel
  slide-in.
- Fail/win panel: 640x520px centered at y 480-1000, `LevelDirector.pause()`
  first so tweens stop with physics.

### Performance plan

Peak live: 64 tiles + up to 6 specials + ~150 particles = ~220 objects.
Everything pooled: one `SpritePool` per piece type (6-9 pools of 24), one for
particles (200), one for score popups (24). The resolver returns a step list;
the scene animates steps with a single shared timeline instead of one tween
per tile per step — a 12-deep cascade on an 8x8 board is up to 300 tweens if
built naively, which is the genre's only real fps risk. Cap concurrent tweens
at 96 and batch the rest into the next step. `core/board/*` is pure logic with
no Phaser import, so the sim gate runs it headlessly at thousands of boards
per second.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Board engine | `core/board/grid.ts` + `core/board/resolve.ts` wiring for this slice | `interface BoardStep { kind: 'clear' \| 'fall' \| 'spawn' \| 'special'; cells: BoardCell[]; payload?: string }` and `resolve(grid, move): BoardStep[]` |
| Level content | `data/levels.ts` (50 specs), goal mix, star thresholds | `interface LevelSpec { id: number; seed: number; cols: number; rows: number; layout: string[]; goals: GoalSpec[]; moveBudget: number; starThresholds: [number, number, number] }` |
| Board view | `objects/tile.ts`, cascade animation timeline, juice | `function playSteps(steps: BoardStep[]): Promise<void>` |
| Meta / UI | saga map scene, star deposit, booster shop, fail panel | `function onLevelEnd(outcome: { won: boolean; reason: string }, stars: number): Promise<'retry' \| 'map'>` |
| Balance (integrator) | move budgets, star thresholds, runs `npm run sim -- --family B` until every band is met | consumes all contracts above |

### Pitfalls

1. Animating each tile with its own tween per cascade step — 300 concurrent tweens on a deep cascade, instant fps collapse. Use one timeline per step list.
2. Accepting input while the cascade resolves: produces illegal states and double-spent moves. Input is hard-gated on `cascade` idle.
3. Boards deal in with matches already present, so the level starts with a free cascade the player did not earn. The initial fill must re-roll until match-free.
4. Star thresholds authored as absolute scores instead of par ratios — a level with 2x the goal tiles becomes trivially 3-star.
5. Move budget tuned by the designer playing optimally: the sim gate exists because human-optimal is 20-30% better than median-player play.
6. Blast variant shipped with `minGroup = 2` and 6 live colors reads as a dead board past level 30; either drop to 5 colors or add a shuffle booster.
7. Building the swap variant by default. State the 0.8% success rate in the PRD and get an explicit decision.

### Video hook

25-40s clip, one level: 0-5s board deals in and the goal chips land (reads as
"I know this game" in one second), 5-18s two ordinary moves then a 4-match
creating a line special, 18-30s the special is combined with a color bomb and
a 6-deep cascade clears half the board with escalating `combo` pitch and
hitstop, 30-38s goals complete and the leftover moves fire as free specials
in a full-board sugar-crush, 38-40s three stars slam in. Payoff moment: the
special x special detonation.

## B2. Merge-2

Two identical items dragged together become one item of the next tier. The
board is a persistent inventory, generators spew low-tier items on a
cooldown, and orders demand specific tiers. `Merge Mansion` / `Travel Town` /
`Gossip Harbor` shape.

**Market signal:** merge is up **65-74% YoY** — one of the three fastest
growing casual categories in 2026. The strongest standalone pick in family B,
and the strongest pattern-**I** core, because the board is already a meta
surface (persistent state between sessions).

### Core loop and run shape

**Core loop:** tap a generator to produce low-tier items, drag identical items
together to merge up a chain, keep the finite board from jamming, deliver the
tiers an order asks for, spend the reward on the next generator or board
expansion.

| Session time | Beat |
| --- | --- |
| 0:00-0:20 | Board restores from save with 2-4 items already on it (never empty — an empty board reads as "nothing to do"); the active order card is visible in the HUD. |
| 0:20-1:20 | Generator taps + first 3-6 merges. Tier 1 -> 3 happens fast (4 taps) to establish the cadence. |
| 1:20-3:00 | First order delivered (~1:30). Energy spend becomes visible; occupancy passes 60% and the player starts merging defensively. |
| 3:00-5:00 | A second generator or a board expansion is bought; a two-chain order (tier 5 of chain A + tier 3 of chain B) forces planning. |
| 5:00-7:00 | Energy runs low; the player consolidates the board into high tiers to bank progress and delivers the last order. |
| 7:00-8:00 | Out of energy -> soft session end: order-track reward, decor task advance, next-order preview, energy timer. |

Session: one continuous 5-10 min block bounded by energy, not by levels.
`LevelDirector` (`core/level.ts`) still adjudicates **chapter milestones**
(deliver N orders / reach tier 7) with a goal set and stars; the
moment-to-moment loop has no move budget and no fail state.

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Drag item onto identical item | Merge into tier+1 at the target cell; illegal drop springs back in 160ms | `Controls.onDrag` -> `merge.mergeAt(grid, from, to)` |
| Tap generator | Produce 1 item at a free adjacent cell, consuming one charge | `Controls.onTap` -> `merge.produce(grid, generatorId, rng)` |
| Tap item | Select + show its tier card (name, tier, what it becomes) | `Controls.onTap` |
| Hold item (450ms) | Full chain-preview overlay for that item's chain | `Controls.onHoldStart` |
| Drag item onto order card | Deliver if it satisfies a requirement | `Controls.onDrag` -> order rail `deliver(item)` |

No gravity, no swipe, no joystick. The board never scrolls.

### Systems required

| Module | Use |
| --- | --- |
| `core/level.ts` (`LevelDirector`) | chapter milestone: goal set = orders delivered / tier reached, no move budget, stars from delivery speed; `progress` = milestone fraction |
| `core/board/types.ts` | `BoardCell`, chain/tier ids, `GoalSpec` for orders |
| `core/board/grid.ts` | the persistent board inventory: occupancy, free-cell search, placement, flat save serialization |
| `core/board/merge.ts` | identical-pair detection, tier-up, chain forks, generator output, jam detection |
| `core/board/resolve.ts` | **not used** — merge boards have no gravity and no cascade. Named here to state the deliberate omission; importing it is a bug. |
| `core/economy.ts` | energy regeneration + offline accrual, generator charge cost curve, order reward curve, expansion cost curve |
| `core/rng.ts` | seeded generator output tables |
| `core/progression.ts` | `MetaSave` holds board snapshot, chain unlocks, order index, energy timestamp — in this family the save *is* the game |
| meta-kit `core/collections.ts` | chain albums (every tier discovered fills a slot), reward track, daily order, login streak |
| meta-kit `ui/boosterBar.ts` | tier-skip bubble, instant generator charge, +1 row token |
| meta-kit decor/renovation tasks (slice scene) | order rewards buy story/decor steps — the retention spine of the genre |
| `ui/hud.ts`, `ui/bars.ts` | energy bar, order rail, occupancy indicator |
| `ui/cards.ts` | chain preview overlay, order detail, generator purchase panel |
| NEW: needs `data/chains.ts` | `ChainSpec[]`: `{ id, name, tiers: Array<{ texture: string; value: number }>, fork?: { atTier: number; into: [string, string] }, generator?: { chargeMs: number; charges: number; outputs: Array<{ tier: number; weight: number }> } }`. |
| NEW: needs `objects/mergeItem.ts` | Item view: sprite + chain + tier + drag ghost + merge burst. Spec: `class MergeItem { chain: string; tier: number; playMerge(): Promise<void>; setGhost(on: boolean): void }`. |

### Content volume

| Item | Minimum | Comfortable |
| --- | --- | --- |
| Levels (chapter milestones) | 20 | 50+ |
| Chains (piece types) | 6 | 9 |
| Tiers per chain | 6 | 9 |
| Specials (forks, tier-skip items, wildcards) | 3 | 5 |
| Generators | 2 | 4 |
| Orders authored | 20 | 50+ |
| Boosters | 2 | 4 |
| Board expansions | 1 | 3 |
| Decor tasks | 5 | 12-20 |

A chain is content-cheap and content-dense: 9 tiers x 6 chains = 54 sprites
covering 50+ orders. That ratio is why the category scales.

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `board.cols` | 7 | 6-8 | cells | merge boards run narrower than match boards (bigger items) |
| `board.rows` | 9 | 8-10 | cells | |
| `board.cellPx` | 88 | 80-96 | px | items must read at a glance |
| `board.startFreeRatio` | 0.55 | 0.45-0.65 | fraction | free cells at session start |
| `board.jamThreshold` | 0.90 | 0.85-0.95 | occupancy | above it, generators refuse to produce and the HUD warns |
| `merge.springBackMs` | 160 | 120-220 | ms | illegal drop |
| `merge.burstMs` | 280 | 220-360 | ms | merge payoff animation |
| `chain.tiers` | 9 | 6-9 | tiers | |
| `chain.tierValueGrowth` | 2.4 | 2.0-3.0 | multiplier/tier | 2 items in must be worth < 1 item out, or merging is pointless |
| `generator.chargeMs` | 9000 | 6000-15000 | ms | recharge per charge |
| `generator.charges` | 5 | 3-8 | count | taps available when full |
| `energy.max` | 60 | 40-100 | energy | |
| `energy.perGeneratorTap` | 1 | 1-2 | energy | the only energy sink |
| `energy.regenMs` | 90000 | 60000-150000 | ms/point | full bar in ~90 min |
| `energy.sessionBudget` | 45 | 30-60 | energy | what a 5-10 min session actually spends |
| `order.rewardCoinsBase` | 120 | 80-200 | coins | tier-1 order |
| `order.rewardGrowth` | 1.45 | 1.3-1.6 | multiplier/tier | vs highest tier demanded |
| `expansion.cost1` | 1500 | 1000-2500 | coins | first board expansion |
| `expansion.costGrowth` | 2.6 | 2.2-3.2 | multiplier | |
| `save.debounceMs` | 800 | 500-1500 | ms | board writes are coalesced |
| `entityBudgetLive` | 120 | 90-160 | count | 63 cells + items + drag ghost + bursts |

### Progression math

Tier-1 items required for one item of tier T: `items(T) = 2^(T-1)`; each item
is one generator tap. With `charges = 5` per 9s recharge cycle:

| Tier | Tier-1 items | Taps | Generator cycles | Wall time, 1 generator |
| --- | --- | --- | --- | --- |
| 3 | 4 | 4 | 0.8 | ~10s |
| 5 | 16 | 16 | 3.2 | ~30s |
| 7 | 64 | 64 | 12.8 | ~2:00 |
| 9 | 256 | 256 | 51.2 | ~8:00 (or 2 generators + tier-skip boosters) |

Item value `value(T) = base * 2.4^(T-1)`: merging two tier-T items yields 2.4x
their individual value against 2x the input, so the merge is always the
dominant move and the player never needs arithmetic.

Order reward `reward = 120 * 1.45^(maxTierDemanded - 1)`: a tier-7 order pays
`120 * 1.45^6 ≈ 1105` coins ≈ 0.74 of `expansion.cost1`, making expansion a
2-order goal — the correct cadence for a first session.

Energy is the session governor: 45 energy = 45 generator outputs ≈ one tier-6
chain plus change; a 90s/point regen returns a full bar in 90 min, i.e. 3-4
organic sessions per day.

### Meta progression

There is no run/meta boundary — the board is the meta. `MetaSave` persists the
board snapshot, chain unlocks, order index, decor step, album slots, and the
wall clock at last energy spend (server-less accrual on load, capped at
`energy.max`).

| Meta-kit component | Wiring | Numbers |
| --- | --- | --- |
| decor/renovation tasks | orders pay coins, coins buy decor steps that advance the story | 400-2500 coins per task, 5-8 tasks per room, 3-5 rooms |
| `core/collections.ts` albums | one album per chain; discovering tier T fills slot T | full album = 1 booster + 20 energy |
| `core/collections.ts` reward track | 20 tiers fed by orders delivered | 1 tier per 2 orders |
| `core/collections.ts` streaks/daily | daily order at 2x coins; 7-day streak = +20 energy cap for a day | |
| stars (`core/progression.ts`) | chapter milestones award 1-3 stars by delivery speed | stars gate the next chain unlock |
| `ui/boosterBar.ts` | tier-skip bubble / instant charge / +1 row token | 300 / 150 / 900 coins |
| `ui/sagaMap.ts` (optional) | chapter map over milestones rather than levels | 1 node per milestone |

### Build variety

Variety here is **board policy**, and the PRD must name three viable ones:
(1) *hoarder* — never merge below tier 4, board sits at 80% occupancy,
maximum value density, jam risk; (2) *flusher* — merges on sight, occupancy
under 50%, slow to high tiers, never jams; (3) *order-sniper* — produces only
what the active order needs and banks the rest as tier-2 pairs. The order
table must include, per 10 orders, at least one that punishes each policy: a
wide order that jams the hoarder, a deep order that starves the flusher, a
two-chain order that breaks the sniper. Chains must also differ mechanically,
not only visually — at least one chain carries a mid-tier fork (tier 5 merges
into 6a or 6b, `ChainSpec.fork`).

### Portrait UI plan

- y 140-200: coins, energy bar (`Bar`, 240x28px, numeric label), settings.
- y 200-330: order rail — 2-3 cards at 200x120px, horizontally scrollable,
  each with up to 3 requirement chips at 44x44px. These are drop targets.
- y 330-1122: the 616x792 board (7x9 at 88px), `origin = { x: 52, y: 330 }`.
  Items render at 76px inside 88px cells so the 1.15x drag ghost reads.
- y 1122-1280 (`SAFE` bottom band): generator dock, up to 3 generators at
  120x120px with charge rings. Deliberately in the thumb zone — generator taps
  are the highest-frequency action in the game.
- Valid merge targets pulse at 1.06x scale on a 400ms period while dragging;
  the ghost is 0.85 alpha with a 6px outline.
- Chain preview: 640x900px overlay, `LevelDirector.pause()` first.

### Performance plan

Peak live ≈ 120 objects (63 cells + up to 57 items + ghost + 1-2 bursts) —
trivial to render. The real cost is **save writes**: the board persists after
every merge, so `saveMeta` is debounced to one write per 800ms and the board
serializes as a flat numeric array (`chainIndex * 16 + tier` per cell), never
an object per cell. A 63-cell object graph stringified per merge is a visible
30-60ms hitch on low-end Android. Merge bursts share one pooled emitter (48
particles). `core/board/merge.ts` is Phaser-free, so the sim gate runs
thousands of simulated sessions headlessly.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Merge core | `core/board/merge.ts` wiring, occupancy, jam detection, save serialization | `function mergeAt(grid: BoardGrid, from: BoardCell, to: BoardCell): { ok: boolean; resultTier?: number; reason?: string }` |
| Chains + orders content | `data/chains.ts` (6 chains x 9 tiers), 50 orders, reward curve | `interface ChainSpec { id: string; name: string; tiers: Array<{ texture: string; value: number }>; fork?: { atTier: number; into: [string, string] } }` |
| Economy | `core/economy.ts` wiring: energy accrual, generator charges, rewards, expansion costs | `function accrueEnergy(save: MetaSave, nowMs: number): number` |
| View + juice | `objects/mergeItem.ts`, drag ghost, merge burst, charge rings | `function playMerge(item: MergeItem, resultTier: number): Promise<void>` |
| Meta / decor | order rail, decor room scene, album, reward track | `function onOrderDelivered(orderId: string, coins: number): Promise<void>` |
| Balance (integrator) | tier growth, energy budget, order cadence; runs `npm run sim -- --family B` (merge mode: 200 simulated sessions; asserts tier 7 reachable in 6-10 min and jam rate < 5%) | consumes all contracts above |

### Pitfalls

1. Board restores empty — the player opens the game to nothing to do. Always seed 2-4 items on a fresh or fully-cleared board.
2. No jam recovery: a full board with no legal merge is an unwinnable save. Ship sell/shuffle and assert jam rate < 5% in the sim gate.
3. `saveMeta` per merge without debounce — a stringify hitch that reads as input lag.
4. `chain.tierValueGrowth` below 2.0 makes merging value-negative; players hoard tier-1 items and the loop dies.
5. Energy that empties in 90 seconds. The 5-10 min mandate requires `energy.sessionBudget >= 30`; tune the bar to the session, not to a monetization spreadsheet.
6. Nine tiers distinguished by tint alone are unreadable at 76px. Every tier needs a silhouette change.
7. Importing `core/board/resolve.ts` "because it is the board engine" — gravity on a merge board destroys the player's spatial plan.
8. Orders that demand a tier the current generators cannot reach in the energy budget: every order must be verified reachable by the sim gate.

### Video hook

30-45s clip: 0-6s generator tapped three times, three items pop out (instant
cause->effect), 6-16s four fast merges to tier 4 with rising `combo` pitch and
a burst each time, 16-28s one drag triggers four consecutive auto-merges up to
tier 7 (the genre's money shot), 28-38s the tier-7 item is dragged onto an
order card, coins spray, a decor step builds in the room behind the board,
38-45s the album slot fills with a shine. Payoff moment: the four-deep chain
merge from a single drag.

## B3. Sort and screw

One playbook, two skins of the same state machine: move a colored unit from a
source container to a destination container that legally accepts it, until
every container is monochrome and complete. *Sort* = water/ball/pin sort into
tubes. *Screw* = unscrew colored bolts and re-seat them in matching boards,
where the container is a plate slot and freeing a plate is the goal. `Water
Sort`, `Screw Jam`, `Nuts & Bolts`.

**Market signal:** sort-type puzzles grew **170-229% YoY** — the single
fastest-growing casual category in 2026, and the cheapest of family B to build
(no gravity, no cascade, no score curve; the whole engine is a legality
predicate plus a deadlock detector).

### Core loop and run shape

**Core loop:** scan the containers, find a legal transfer that does not waste
a scarce free slot, execute it, repeat; when the board deadlocks, spend an
undo or an extra-container booster; complete every container before the move
or slot budget runs out.

| Level time | Beat |
| --- | --- |
| 0:00-0:05 | Containers fill in left-to-right; colors are visible and countable at rest. No shuffle animation longer than 500ms — this genre's appeal is "the puzzle is fully readable before I touch it". |
| 0:05-0:25 | The 2-4 obvious transfers (a same-color pair sitting on top). Free container count drops from 2 to 1. |
| 0:25-1:00 | The real puzzle: the player must unstack a mixed container into the one free slot in the right order. First undo usage typically here. |
| 1:00-1:40 | Endgame. 2-3 containers complete and lock with a satisfying seal animation; the last color untangles. |
| 1:40-1:50 | Resolution: all containers monochrome -> win, stars by moves used vs par; or no legal move and no undo -> fail panel offering +1 container / undo / retry. |
| between levels | Saga node advance, star deposit, reward track: 8-15s. |

Session: 4-8 levels at 45-120s = 5-10 min.

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Tap source container | Lift the top run of same-colored units (up to the legal transfer size); tapping again cancels | `Controls.onTap` -> `sort.lift(state, containerId)` |
| Tap destination container | Transfer if legal; illegal target shakes 140ms and keeps the lift armed | `Controls.onTap` -> `sort.transfer(state, from, to)` |
| Drag source to destination (screw skin) | Same transfer as a single gesture — mandatory for the screw skin, optional for sort | `Controls.onDrag` |
| Tap undo | Revert the last transfer (bounded stack) | `ui/boosterBar.ts` -> `sort.undo(state)` |
| Tap +container booster | Add one empty container for the rest of the level | `ui/boosterBar.ts` -> `sort.addContainer(state)` |
| Hold container (500ms) | Peek: highlight every unit of the top color across the board | `Controls.onHoldStart` |

### Systems required

| Module | Use |
| --- | --- |
| `core/level.ts` (`LevelDirector`) | goal set = all containers complete; budget = moves (sort) or plates freed (screw); star thresholds from moves-vs-par; `outcome.reason` = `'complete' \| 'deadlock' \| 'outOfMoves'` |
| `core/board/types.ts` | `GoalSpec`, color ids, container/slot descriptors |
| `core/board/sort.ts` | the whole rule set: `lift`, `transfer` legality, run size, container completion + lock, bounded `undo` stack, `hasLegalMove` deadlock detector |
| `core/board/grid.ts` | container layout as a coarse grid (rows x columns of containers) for hit-testing and screw-skin plate adjacency |
| `core/board/resolve.ts` | **not used** — no gravity, no cascade. |
| `core/rng.ts` | `Rng` seeded per level; the generator shuffles a solved state backwards N moves so every level is provably solvable |
| `core/progression.ts` | stars, coins, owned undos/containers |
| meta-kit `ui/sagaMap.ts` | level nodes, chapter gates |
| meta-kit `ui/boosterBar.ts` | undo, +container, remove-one-color |
| meta-kit `core/collections.ts` | daily level, streak, reward track |
| `ui/hud.ts`, `ui/bars.ts` | move counter, completed-container counter |
| `ui/cards.ts` | fail panel (booster offers), pre-level loadout |
| NEW: needs `data/levels.ts` | `SortLevelSpec[]`: `{ id, seed, colors: number, containerCapacity: number, containers: number, freeContainers: number, moveBudget: number, backShuffleMoves: number, starThresholds: [number, number, number] }`. |
| NEW: needs `objects/container.ts` | Container view: stacked unit sprites, lift offset, completion seal, illegal shake. Spec: `class Container { units: number[]; playLift(count: number): void; playTransfer(to: Container, count: number): Promise<void>; playSeal(): Promise<void> }`. |
| NEW: needs `core/board/sortgen.ts` | Backwards level generator: `generateSortLevel(rng: Rng, spec: SortLevelSpec): SortState` — start from the solved state, apply `backShuffleMoves` inverse-legal moves, guaranteeing solvability and a known optimal-move upper bound. |

### Content volume

| Item | Minimum | Comfortable |
| --- | --- | --- |
| Levels | 20 | 50+ |
| Piece types (colors) | 6 | 9 |
| Specials (locked container, mixed-capacity, one-way slot, hidden unit, timed lock) | 3 | 5 |
| Boosters | 2 (undo, +container) | 4 (+ remove-color, + shuffle) |
| Container archetypes (capacity 3/4/5, tube/plate/wheel) | 2 | 4 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `containers.total` | 11 | 6-16 | count | 2 rows of 5-6 in portrait |
| `containers.free` | 2 | 1-3 | count | the scarcity dial; 1 free container is expert-tier |
| `container.capacity` | 4 | 3-6 | units | 4 is the readability sweet spot |
| `colors.live` | 7 | 4-9 | count | `containers.total - containers.free` must equal `colors.live` |
| `container.widthPx` | 96 | 84-112 | px | |
| `container.unitPx` | 84 | 72-96 | px | unit sprite inside the container |
| `transfer.msPerUnit` | 110 | 80-160 | ms | pour/seat animation per unit moved |
| `illegalShakeMs` | 140 | 100-200 | ms | |
| `seal.ms` | 420 | 320-600 | ms | container-complete payoff |
| `undo.stackDepth` | 20 | 10-999 | moves | free undos are 3/level, then 40 coins |
| `moveBudget.level1` | 40 | 30-60 | moves | ~2.5x par |
| `moveBudget.level50` | 26 | 20-34 | moves | ~1.15x par |
| `backShuffleMoves.level1` | 8 | 6-12 | moves | generator depth |
| `backShuffleMoves.level50` | 34 | 24-48 | moves | deeper = harder, monotonic difficulty dial |
| `peekHoldMs` | 500 | 400-800 | ms | |
| `screw.platesPerLevel` | 6 | 4-10 | plates | screw skin only |
| `screw.boltsPerPlate` | 3 | 2-5 | bolts | screw skin only |
| `entityBudgetLive` | 90 | 60-120 | count | 11 containers x 4 units + FX |

### Progression math

Difficulty is one monotonic dial: `backShuffleMoves`. Par is the generator's
known shuffle depth (an upper bound on the optimal solution), so
`par(L) = backShuffleMoves(L)` and stars are `movesUsed / par` ratios — no
score curve is needed anywhere in this playbook.

`backShuffleMoves(L) = 8 + floor(L * 0.55)`, `moveBudget(L) = ceil(par(L) * m(L))`
with `m` falling from 2.5 to 1.15 across 50 levels:

| Level | Colors | Free containers | Par (shuffle depth) | Move budget | Multiplier | Target win rate |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 3 | 2 | 8 | 40 | 2.50 | 98% |
| 10 | 5 | 2 | 13 | 29 | 2.20 | 90% |
| 20 | 6 | 2 | 19 | 34 | 1.80 | 79% |
| 30 | 7 | 2 | 24 | 36 | 1.50 | 70% |
| 40 | 7 | 1 | 30 | 39 | 1.30 | 62% |
| 50 | 8 | 1 | 35 | 40 | 1.15 | 56% |

Stars: 3 stars at `movesUsed <= par * 1.15`, 2 at `<= par * 1.6`, 1 on any
clear. Worked: level 20 par 19 -> 3 stars at 21 moves, 2 stars at 30, 1 star
at up to the 34-move budget.

Deadlock probability is the thing the sim gate actually measures: with
`free = 2` a random-legal-move bot deadlocks ~12% of the time; with `free = 1`
it deadlocks ~48%. Levels past 40 that use `free = 1` must therefore ship the
undo affordance visibly, or the measured win rate collapses below the band.

### Meta progression

| Meta-kit component | Wiring | Numbers |
| --- | --- | --- |
| `ui/sagaMap.ts` | one node per level, 10 per chapter | chapter gate = 12 stars |
| stars (`core/progression.ts`) | 1-3 per level from moves-vs-par | 30 stars available per chapter |
| `ui/boosterBar.ts` | undo (3 free/level, then 40 coins), +container (120), remove-color (250), shuffle (90) | |
| `core/collections.ts` streaks/daily | daily level at 2x coins, 7-day streak track | day 7 = 1 of each booster |
| `core/collections.ts` reward track | 20 tiers per chapter, fed by stars | 1 tier per 4 stars |
| `core/collections.ts` albums (optional) | a cosmetic container-skin set, 8-12 skins | 1 skin per 5 levels |
| decor/renovation tasks (optional, pattern I) | stars fund a room build | 3-6 stars per task |

Coins: `grantCurrency(25 + stars * 15 + (firstClear ? 40 : 0))`.

### Build variety

Solution variety, provable by the gate: every level must admit at least 3
distinct first-3-move openings that still solve, and no level may have exactly
one solution path (the generator's backwards shuffle can produce
near-forced boards at high depth — reject any generated level whose
random-legal-move bot solve rate is 0% over 2000 trials). Player-facing
strategy archetypes to design levels against: (1) *greedy* — always complete
the nearest container; (2) *slot-saver* — never fills a free container above
50% capacity; (3) *unstacker* — deliberately empties one mixed container fully
before touching anything else. At least one special per chapter should punish
greedy play (a locked container that only opens when another completes).

### Portrait UI plan

- y 140-200: level label, pause, undo counter.
- y 200-300: move counter chip (132x104px) + completed-container progress
  (`Bar`, 380x16px).
- y 300-940: container field, two rows of up to 6 containers. Row 1 at
  y 320-600, row 2 at y 640-920; container 96px wide with 24px gutters, so 6
  containers = 696px — 12px inside the 720 frame, `SAFE` sides respected by
  centering 5 per row when `containers.total <= 11`.
- y 940-1120: booster tray (undo / +container / remove-color / shuffle) at
  120x120px.
- y 1120-1280: `SAFE` bottom, panel slide-in region.
- The lifted unit renders 40px above its container at 1.1x scale so the armed
  state is unambiguous — this genre's #1 usability failure is "I do not know
  what I have picked up".

### Performance plan

Peak live ≈ 90 objects (11 containers x up to 4 units, plus a seal FX and a
peek highlight overlay). The lightest playbook in this file; a 60fps budget is
never at risk. Everything is pooled anyway (one unit pool of 64, one FX pool
of 16). `core/board/sort.ts` and `sortgen.ts` are Phaser-free, so the sim gate
can generate and bot-solve tens of thousands of levels per run — use that: the
gate should regenerate every shipped level id and assert solvability, bot
solve rate > 0%, and win-rate band compliance.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Sort rules | `core/board/sort.ts`: lift/transfer legality, completion, undo stack, deadlock detector | `function transfer(state: SortState, from: number, to: number): { ok: boolean; moved: number; completed?: number[]; reason?: string }` and `function hasLegalMove(state: SortState): boolean` |
| Generator + content | `core/board/sortgen.ts`, `data/levels.ts` (50 specs), specials schedule | `function generateSortLevel(rng: Rng, spec: SortLevelSpec): SortState` |
| View + juice | `objects/container.ts`, pour/seat animation, seal, peek overlay | `function playTransfer(from: Container, to: Container, count: number): Promise<void>` |
| Meta / UI | saga map, booster tray, fail panel, star deposit | `function onLevelEnd(outcome: { won: boolean; reason: string }, movesUsed: number, par: number): Promise<'retry' \| 'map'>` |
| Balance (integrator) | shuffle depth curve, move multipliers, free-container schedule; runs `npm run sim -- --family B` | consumes all contracts above |

### Pitfalls

1. Hand-authoring levels instead of generating them backwards from solved — unsolvable levels ship and the 1-star reviews are all identical.
2. No deadlock detection: the player sits on a dead board with moves remaining and no fail state fires. `hasLegalMove` must run after every transfer.
3. Ambiguous lift state — no lift offset, no scale change — so the player cannot tell whether a tap registered.
4. Transfer animation billed per unit at 200ms+; a 4-unit pour takes almost a second and the level feels slow. Keep `msPerUnit <= 160` and allow input queueing.
5. `containers.total - containers.free != colors.live`, which makes some levels trivially or impossibly configured. Assert the identity in the level loader.
6. Free undo unlimited: the puzzle dissolves into brute force. Cap free undos at 3 per level and price the rest.
7. Screw skin without a plate-adjacency rule reduces to plain sort with worse readability — the screw variant must make plate freeing the goal, not a reskin of tubes.
8. Colors that differ only in hue at 84px (teal vs green) — every color needs a distinct shape/pattern token for colorblind readability.

### Video hook

20-35s clip: 0-4s the full board sits still and readable (this genre sells on
"I can see the puzzle"), 4-12s three quick satisfying pours with rising pitch,
12-22s a tense 6-move untangle through the single free container, 22-30s three
containers seal in sequence with escalating chimes, 30-35s the last pour
completes the board and stars slam in. Payoff moment: the sequential
container-seal chain at the end.

## B4. Block-fit

Drag polyomino blocks from a 3-slot tray into a fixed grid; a filled row,
column (or region, in the sudoku-flavored variant) clears and scores. The
board never refills itself — every cell on it was placed by the player, which
makes this the purest bin-packing loop in casual. `Block Blast`, `Woodoku`.

**Market signal:** block puzzle grew **176% YoY**. It is also the cheapest
playbook in family B to reach shippable quality (no gravity, no cascade, no
level generator — the content is the shape table and the goal schedule), which
makes it the best family-B choice when the build budget is one session.

### Core loop and run shape

**Core loop:** read the three offered blocks, choose a placement that both
clears a line now and leaves a placeable shape for the next tray, take the
combo bonus when two clears land on one placement, and keep the grid's free
space above the largest tray shape or the level ends.

| Level time | Beat |
| --- | --- |
| 0:00-0:05 | Grid appears with a small pre-placed layout (the level's `layout`, 8-20 cells) and the first tray of 3 blocks slides up. |
| 0:05-0:25 | First 3-5 placements. Empty grid means every shape fits; the player is choosing scoring, not survival. |
| 0:25-1:00 | Free space drops below ~55%; the first real tray-lock threat appears; first double-clear combo is the intended payoff. |
| 1:00-1:40 | Endgame pressure. The player is now placing to preserve a 3x3 hole for the square shape; goal chips (clear N rows / score N / clear N special cells) are 60-90% done. |
| 1:40-1:55 | Resolution: goals complete -> win + stars; or no tray shape fits any grid position -> fail panel offering a shape-reroll / hammer / retry. |
| between levels | Saga node advance, star deposit, reward track tick: 8-15s. |

Session: 4-8 levels at 45-120s = 5-10 min. The endless score-chase variant of
the same core swaps `LevelDirector` for `RampDirector` (`core/ramp.ts`) and
becomes a family-J entry — see `J1`; do not ship both modes in one build
session.

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Drag block from tray to grid | Ghost-preview the footprint under the finger; on release, place if every target cell is free, else spring back in 160ms | `Controls.onDrag` -> `block.canPlace(grid, shape, cell)` / `block.place(...)` |
| Tap block in tray | Select + show its footprint hint on the grid's best-fit position (accessibility aid, not a booster) | `Controls.onTap` |
| Tap hammer booster then tap cell | Delete one placed cell | `ui/boosterBar.ts` -> `block.clearCell(grid, cell)` |
| Tap reroll booster | Replace the current tray with three fresh shapes | `ui/boosterBar.ts` -> `block.rerollTray(state, rng)` |
| Hold on grid (500ms) | Highlight every position where the selected shape fits | `Controls.onHoldStart` |

Drag offset matters: the ghost anchors to the shape's top-left cell offset by
the grab point, and renders 120px above the finger so the thumb never covers
the target — the single most important UX detail in the genre.

### Systems required

| Module | Use |
| --- | --- |
| `core/level.ts` (`LevelDirector`) | goal set (`clearRows`, `score`, `clearSpecialCells`), no move budget (the fail state is tray-lock), star thresholds vs par score; `outcome.reason` = `'goals' \| 'noFit'` |
| `core/board/types.ts` | `BoardCell`, shape ids, `GoalSpec` |
| `core/board/grid.ts` | occupancy grid, pre-placed level layout, region membership for the 3x3 variant |
| `core/board/block.ts` | shape table + rotations, `canPlace`, `place`, full row/column/region detection, multi-clear grouping, `hasAnyFit` (game-over test), tray refill |
| `core/board/resolve.ts` | **not used** — cleared cells leave holes; nothing falls. Importing it turns the game into Tetris and breaks every level. |
| `core/rng.ts` | seeded tray sequence per level, so a level's shape stream is identical for every player and for the gate |
| `core/progression.ts` | stars, coins, owned boosters |
| meta-kit `ui/sagaMap.ts` | level nodes, chapter gates |
| meta-kit `ui/boosterBar.ts` | hammer, tray reroll, row-clear, single-cell block |
| meta-kit `core/collections.ts` | daily level, streak, reward track, wood/neon skin albums |
| `ui/hud.ts`, `ui/bars.ts` | score, combo indicator, goal chips |
| `ui/cards.ts` | fail panel, pre-level booster loadout |
| NEW: needs `data/shapes.ts` | `ShapeSpec[]`: `{ id, cells: Array<[number, number]>, weight: number, minLevel: number }` — 9-14 shapes with a weighted draw table that gates the awkward shapes (S/Z/plus/L5) behind level thresholds. |
| NEW: needs `objects/blockPiece.ts` | Tray piece view: cell sprites, drag ghost at 120px lift, footprint preview, invalid tint. Spec: `class BlockPiece { shape: ShapeSpec; setGhost(on: boolean): void; playPlace(): Promise<void> }`. |
| NEW: needs `data/levels.ts` | `BlockLevelSpec[]`: `{ id, seed, cols, rows, layout: string[], trayWeights: Record<string, number>, goals: GoalSpec[], starThresholds: [number, number, number] }`. |

### Content volume

| Item | Minimum | Comfortable |
| --- | --- | --- |
| Levels | 20 | 50+ |
| Piece types (shapes) | 6 | 9 (14 with rotations authored as distinct ids) |
| Specials (locked cell, ice cell, bomb cell with a countdown, double-score cell, region goal) | 3 | 5 |
| Boosters | 2 (hammer, reroll) | 4 (+ row-clear, + 1x1 block) |
| Goal types | 2 | 4 |
| Board skins | 1 | 4 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `board.cols` | 8 | 8-10 | cells | 8x8 at 80px or 10x10 at 64px; both are 640px wide |
| `board.rows` | 8 | 8-10 | cells | non-square boards read badly with square shapes |
| `board.cellPx` | 80 | 64-80 | px | 64px is the floor: a placed cell is not a touch target, only the tray is |
| `tray.slots` | 3 | 2-3 | slots | 2 slots is expert-tier; 4 removes all planning tension |
| `tray.maxShapeCells` | 5 | 4-5 | cells | a 6-cell shape needs a 10x10 board |
| `layout.preFilledCells` | 14 | 8-20 | cells | level's starting clutter; the main difficulty dial |
| `drag.ghostLiftPx` | 120 | 100-160 | px | ghost renders above the finger |
| `drag.springBackMs` | 160 | 120-220 | ms | invalid drop |
| `place.settleMs` | 90 | 70-140 | ms | |
| `clear.lineMs` | 260 | 200-360 | ms | line-clear sweep |
| `score.perPlacedCell` | 10 | 5-20 | points | |
| `score.perLineBase` | 100 | 60-160 | points | one row or column |
| `score.multiClearMul` | 2.0 | 1.8-3.0 | multiplier/extra line | 2 lines at once = 100 + 200 |
| `score.comboMul` | 1.4 | 1.2-1.8 | multiplier | consecutive placements that each clear |
| `combo.decayPlacements` | 1 | 1-2 | placements | one non-clearing placement resets the combo |
| `stars.threshold1` | 1.0 | — | x par score | par = bot median |
| `stars.threshold2` | 1.5 | 1.4-1.7 | x par score | |
| `stars.threshold3` | 2.2 | 2.0-2.8 | x par score | |
| `entityBudgetLive` | 140 | 100-180 | count | 64-100 grid cells + 3 tray pieces + clear FX |

### Progression math

Difficulty has two dials and no move budget: pre-filled cells and the tray
weight table (how often awkward 5-cell shapes appear). Free space is the
player's real resource; the fail state is `hasAnyFit == false`.

| Level | Pre-filled cells | Free ratio at start | Awkward-shape weight | Goal | Target win rate |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 1.00 | 0% | clear 3 rows | 99% |
| 10 | 8 | 0.88 | 10% | score 1200 | 91% |
| 20 | 14 | 0.78 | 20% | clear 8 rows + 4 ice cells | 80% |
| 30 | 18 | 0.72 | 28% | score 3000 with 6 locked cells | 71% |
| 40 | 22 | 0.66 | 34% | clear 12 rows, 2 bomb cells on 8-turn timers | 63% |
| 50 | 26 | 0.59 | 40% | score 5000 + clear all 6 ice cells | 56% |

Scoring worked example, a double clear at combo 2: two lines (`100 + 100*2.0 =
300`) plus 5 placed cells (`50`), all times the combo multiplier
(`1.4^1 = 1.4`) = `(300 + 50) * 1.4 = 490` points. A level-20 par of 2400
means roughly five such placements is a 1-star clear and eleven is 3 stars —
the intended "combo chains, not slow grinding, win stars" shape.

### Meta progression

| Meta-kit component | Wiring | Numbers |
| --- | --- | --- |
| `ui/sagaMap.ts` | one node per level, 10 per chapter | chapter gate = 12 of 30 stars |
| stars (`core/progression.ts`) | 1-3 per level from score/par | |
| `ui/boosterBar.ts` | hammer 120 coins, reroll 90, row-clear 220, 1x1 block 60 | max 2 pre-armed |
| `core/collections.ts` streaks/daily | daily level at 2x coins; 7-day streak | day 7 = 1 of each booster |
| `core/collections.ts` reward track | 20 tiers per chapter, fed by stars | 1 tier per 4 stars |
| `core/collections.ts` albums | board/skin collection (wood, neon, candy, stone) | 1 skin per chapter |
| decor/renovation tasks (pattern I) | stars fund a room build | 3-6 stars per task |

Coins: `grantCurrency(20 + stars * 15 + floor(score / 400))`.

### Build variety

Variety is **placement policy**, and the shape table must keep all three
viable: (1) *edge-hugger* — fills from the borders inward, maximizes long
straight lines, dies to 3x3 squares; (2) *center-keeper* — reserves a central
3x3 hole for the square shape, sacrifices some line clears; (3) *combo-chaser*
— refuses non-clearing placements to hold the combo multiplier, runs the grid
much fuller. The gate proves viability by running a bot per policy over every
level: each policy must clear at least 70% of the campaign and each must be
the *best* scorer on at least 15% of levels. If one policy dominates
everywhere, the tray weight table is wrong.

### Portrait UI plan

- y 140-200: level label, pause, score (right-aligned, 44px digits).
- y 200-300: goal chips (up to 3 at 120x104px) + combo indicator, which scales
  1.0 -> 1.35 and shifts hue as the multiplier climbs.
- y 300-940: the 640x640 grid (8x8 at 80px), `origin = { x: 40, y: 300 }`.
- y 960-1140: the tray — 3 slots, each a 200x180px panel, pieces rendered at
  0.7x cell scale so a 5-cell shape fits. Slots are the only touch targets in
  the bottom band.
- y 1140-1280: `SAFE` bottom; booster row (4 x 100x100px) overlays it at
  y 1150-1250 pinned right, leaving the left third clear for the drag start.
- While dragging, the ghost is drawn on the grid at full cell size with valid
  cells tinted 0x00ff88 at 0.5 alpha and invalid at 0xff3355; the piece itself
  floats 120px above the finger.

### Performance plan

Peak live ≈ 140 objects (64-100 grid cell sprites + 3 tray pieces of up to 5
cells + line-clear FX). Grid cells are a single pooled `SpritePool` of
`cols * rows` sprites toggled visible, never created/destroyed. The line-clear
sweep is one tween per cleared line driving a shared timeline, not one tween
per cell (a quadruple clear on a 10x10 board is 40 cells). `block.hasAnyFit`
runs after every placement and every tray refill: worst case that is
`3 shapes x 100 cells x 5 offsets = 1500` cheap integer tests — fine per
placement, so never call it per frame. `core/board/block.ts` is Phaser-free,
so the policy bots in the sim gate run whole campaigns headlessly.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Block rules | `core/board/block.ts`: placement, clears, tray refill, `hasAnyFit` | `function place(grid: BoardGrid, shape: ShapeSpec, at: BoardCell): { ok: boolean; cleared: Array<{ kind: 'row' \| 'col' \| 'region'; index: number }>; reason?: string }` |
| Shapes + levels content | `data/shapes.ts` (9-14 shapes with weights), `data/levels.ts` (50 specs), specials schedule | `interface ShapeSpec { id: string; cells: Array<[number, number]>; weight: number; minLevel: number }` |
| View + juice | `objects/blockPiece.ts`, drag ghost, clear sweep, combo indicator | `function playClears(cleared: Array<{ kind: string; index: number }>, combo: number): Promise<void>` |
| Meta / UI | saga map, booster row, fail panel, star deposit | `function onLevelEnd(outcome: { won: boolean; reason: string }, score: number, par: number): Promise<'retry' \| 'map'>` |
| Balance (integrator) | pre-fill curve, tray weights, star pars; runs `npm run sim -- --family B` with all three policy bots | consumes all contracts above |

### Pitfalls

1. Ghost drawn under the finger — the thumb covers the exact cells being judged. The 120px lift is not optional.
2. Cleared cells made to fall (importing the cascade resolver). Block-fit holes must stay holes; gravity destroys the entire strategic layer.
3. `hasAnyFit` checked only on tray refill, not after each placement, so the player sits on a locked board holding two unplayable shapes.
4. Uniform shape weights: the 5-cell awkward shapes arrive at level 2 and the early campaign fails the 90%+ win-rate band. Gate them with `minLevel`.
5. Star thresholds as absolute scores — a level with a `score` goal and a level with a `clearRows` goal produce wildly different score ranges. Use par ratios.
6. Combo reset rules invisible: the player cannot tell why the multiplier dropped. The combo indicator must animate its own decay.
7. Tray pieces rendered at full cell size — three 5-cell shapes need 1200px of width. Render tray pieces at 0.7x.
8. Shipping the endless mode and the campaign in one build session; pick `LevelDirector` (B) or `RampDirector` (J) and ship one.

### Video hook

20-35s clip: 0-4s an empty grid with three blocks sliding into the tray (zero
explanation needed), 4-14s three placements, each clearing a line with a clean
sweep and a rising chime, 14-24s the grid fills toward danger — visibly one
bad placement from lock — 24-31s a 5-cell piece drops into the reserved hole
and triggers a triple clear at combo 3 with screen shake and a score
count-up, 31-35s goals complete, three stars. Payoff moment: the reserved-hole
triple clear.

## Family C — side-view-physics

Shared frame for both C playbooks.

**Camera: side-follow.** The world is a horizontal ribbon read through a
portrait window, which is the family's whole design problem: at 720px wide the
player sees only ~11 tiles of 64px ahead. Fixed rules: camera deadzone
280x360px centered at (x 300, y 620), lookahead `+120px` in the facing
direction, vertical smoothing `lerp 0.12` (horizontal `0.22`), and a hard
clamp so the player sprite never enters the top 140px or bottom 220px `SAFE`
bands. Any hazard must be visible for at least **450ms** at the current
scroll speed before it can kill — that is the constraint that sets maximum
speed: `maxScrollPx/s <= (720 - playerScreenX) / 0.45`. With the player pinned
at x=300, that is **933 px/s**.

**Physics.** Arcade physics, not Matter: axis-aligned bodies, tile collision,
no rotation except cosmetic. Shared tuning (both playbooks):

| Key | Value | Range | Unit |
| --- | --- | --- | --- |
| `world.gravity` | 2400 | 1800-3000 | px/s^2 |
| `player.terminalVy` | 1400 | 1100-1800 | px/s |
| `player.jumpVy` | -900 | -760 to -1050 | px/s |
| `player.jumpCutMul` | 0.45 | 0.3-0.6 | multiplier on release (variable-height jump) |
| `player.apexGravityMul` | 0.85 | 0.75-0.95 | multiplier while `abs(vy) < 180` |
| `player.coyoteMs` | 100 | 80-120 | ms after leaving ground where a jump still fires |
| `player.jumpBufferMs` | 120 | 100-150 | ms before landing where a jump press is remembered |
| `tile.px` | 64 | 48-80 | px |
| `respawnMs` | 600 | 400-800 | ms — instant retry, no menu |

Coyote time and jump buffer are **not** polish; without both, a portrait
one-button platformer measures as unfair in the first 30 seconds of play. Both
are asserted by the C sim gate (`npm run sim -- --family C`): a bot that
presses jump 60ms late must still clear a standard gap.

**Slice + gates.** `scripts/new-game.sh <slug> --family C` scaffolds
`src/slices/side/game.ts`. `npm run sim -- --family C` runs
`src/sim/families/side.ts`: for levels it bot-plays each level and reports
deaths-to-clear; for the runner it measures session length distribution
against the ramp table.

## C1. Platformer levels

Handcrafted-feeling short levels, one-button or two-zone input, death is cheap
and instant. The web-portal proof that this still works in 2026 is `Level
Devil` (trap-platformer, tens of millions of plays on browser portals) and
`Moto X3M` (physics-bike, the most-played browser racing series) — both are
short-level, instant-retry, side-view physics games with no meta at all.

### Core loop and run shape

**Core loop:** read the next 11 tiles, commit to a jump, die or clear, retry in
under a second with the layout now known, and finish the level fast enough for
3 stars.

| Level time | Beat |
| --- | --- |
| 0:00-0:03 | Level fades in already scrolled to the start; the first obstacle is visible on screen 1 (never off-camera). |
| 0:03-0:12 | Two teaching beats: one gap, one hazard of the level's featured type. First death, if any, happens here and costs 600ms. |
| 0:12-0:28 | The level's real content: 4-8 obstacle beats, one of them a two-input combination (jump then dash / jump then wall-slide). |
| 0:28-0:40 | The finisher: the hardest single beat, placed 2-3 tiles before the goal so failing it is cheap and re-attemptable. |
| 0:40-0:45 | Resolution: goal flag, time and death count, 1-3 stars, next-level auto-advance in 1.5s (skippable by tap). |
| between levels | Saga node advance + star deposit: 5-10s. Auto-advance is default; the map is opt-in. |

Session: 8-20 levels at 20-45s each = 5-10 min.

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Tap (anywhere) | Jump; hold longer = higher (variable jump via `jumpCutMul`) | `Controls.onTap`, `Controls.onHoldStart/onHoldEnd` |
| Tap left / right zone (two-zone variant, `Moto X3M` style) | Brake-lean / accelerate-lean; used only by the physics-vehicle skin | `Controls.onHoldStart` with x < 360 vs x >= 360 |
| Swipe down | Dash / slide / fast-fall (one level-mechanic slot) | `Controls.onSwipe` |
| Tap in mid-air (if unlocked) | Double jump — a per-chapter unlock, not a default | `Controls.onTap` while `!onGround` |

Auto-run is the default: the player never controls horizontal movement, which
is what makes one-button portrait play viable. Manual horizontal control
requires an on-screen dpad and is prohibited in this family.

### Systems required

| Module | Use |
| --- | --- |
| `core/level.ts` (`LevelDirector`) | goal set = reach the flag (+ optional collect N coins); time budget optional; star thresholds from clear time and deaths; `outcome.reason` = `'flag' \| 'death' \| 'timeout'` |
| `core/controls.ts` | `onTap` / `onHoldStart` / `onHoldEnd` / `onSwipe`; no joystick |
| `core/grid.ts` | tile collision grid (reused as a static solidity map, not for pathfinding) |
| `core/pool.ts` | `SpritePool` for tiles in the visible window + 2 screens of margin, hazards, particles |
| `core/damage.ts` | `Health` only if the skin has hit points; the default is one-hit death |
| `core/juice.ts` | landing squash, death burst, hitstop on the near-miss, screen shake on impact |
| `core/rng.ts` | seeded decoration + generated-level assembly (levels are generated from authored beat templates, then frozen by id) |
| `core/progression.ts` | stars, best times, chapter unlocks |
| meta-kit `ui/sagaMap.ts` | level nodes, chapter gates |
| meta-kit `core/collections.ts` | daily level, streak, reward track, skin album |
| `ui/hud.ts`, `ui/bars.ts` | timer, death counter, level progress bar (0..1 from `LevelDirector.progress`) |
| `ui/cards.ts` | level-end panel (time, deaths, stars, retry/next) |
| NEW: needs `objects/platformerBody.ts` | Player controller: coyote timer, jump buffer, variable jump, apex gravity, one-way platforms, wall-slide. Spec: `class PlatformerBody { update(deltaMs: number, input: { jumpHeld: boolean; jumpPressedAtMs: number }): void; get onGround(): boolean }`. |
| NEW: needs `data/beats.ts` | Authored obstacle beats: `{ id, widthTiles, tiles: string[], featured: 'gap' \| 'spike' \| 'crusher' \| 'saw' \| 'movingPlatform' \| 'trap', difficulty: 1..5, minLevel: number }` — 24-40 beats compose 12-20 levels. |
| NEW: needs `core/levelgen.ts` | Beat assembler: `assembleLevel(rng: Rng, spec: LevelSpec): TileMap` — concatenates beats to a target length under a difficulty budget, guaranteeing a jump-reachable path (verified by the C bot). |

### Content volume

| Item | Minimum | Comfortable |
| --- | --- | --- |
| Levels | 12 | 20 |
| Obstacle beats (the real content unit) | 24 | 40 |
| Hazard types | 5 | 8 |
| Mechanic slots (dash, double jump, wall-slide, bounce pad, grapple) | 2 | 4 |
| Tilesets / biomes | 2 | 4 |
| Player skins (collection) | 6 | 12 |

12-20 levels reads as handcrafted because the *beats* are handcrafted; the
assembler only chooses order and spacing. Never generate tiles cell-by-cell —
that is what makes generated platformers feel like noise.

### Numbers table

Shared physics values live in the family-C table above; playbook-specific:

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `player.runSpeed` | 340 | 260-420 | px/s | auto-run; well under the 933 px/s readability ceiling |
| `player.widthPx` | 44 | 36-56 | px | body, not sprite |
| `player.heightPx` | 60 | 48-72 | px | |
| `jump.maxHeightPx` | 169 | 130-220 | px | `jumpVy^2 / (2 * gravity)` = `900^2 / 4800` |
| `jump.maxDistancePx` | 255 | 200-330 | px | `runSpeed * 2 * abs(jumpVy) / gravity` = `340 * 0.75` |
| `gap.maxTiles` | 3 | 2-4 | tiles | 3 x 64 = 192px, a 75% margin inside `jump.maxDistancePx` |
| `level.lengthPx` | 9000 | 5000-14000 | px | 9000 / 340 ≈ 26s of clean running |
| `level.beatCount` | 8 | 5-12 | beats | at ~1100px per beat |
| `level.targetDeaths` | 2 | 0-6 | deaths | median first-clear deaths, measured by the gate |
| `hazard.leadTimeMs` | 450 | 400-700 | ms | minimum on-screen warning; hard rule |
| `dash.speedPx` | 900 | 700-1100 | px/s | |
| `dash.durationMs` | 180 | 140-240 | ms | |
| `dash.cooldownMs` | 700 | 500-1200 | ms | |
| `camera.lookaheadPx` | 120 | 80-200 | px | |
| `stars.time3` | 0.85 | 0.8-0.9 | x par time | par = bot clean-run time |
| `stars.time2` | 1.15 | 1.05-1.3 | x par time | |
| `stars.deathPenalty` | 1 | 1-2 | star per 3 deaths | capped at -1 star |
| `entityBudgetLive` | 180 | 140-240 | count | ~130 visible tiles + hazards + particles |

### Progression math

Par time is derived, not guessed: `parTime(L) = level.lengthPx / runSpeed +
beatCount * 0.35s` (0.35s is the measured cost of a jump arc's horizontal
stall). Worked for a level-10 layout of 9000px and 8 beats:
`9000/340 + 8*0.35 = 26.5 + 2.8 = 29.3s`. Stars: 3 at <= 24.9s (0.85x), 2 at
<= 33.7s (1.15x), 1 on any clear, minus 1 star per 3 deaths.

Difficulty is the beat budget, one dial:
`difficultyBudget(L) = 8 + floor(L * 1.1)`, spent by concatenating beats whose
`difficulty` sums to the budget.

| Level | Length (px) | Beats | Difficulty budget | Mechanics live | Target median deaths |
| --- | --- | --- | --- | --- | --- |
| 1 | 5000 | 4 | 9 | jump | 0 |
| 5 | 6500 | 6 | 13 | jump | 1 |
| 10 | 9000 | 8 | 19 | jump + dash | 2 |
| 14 | 10500 | 9 | 23 | jump + dash | 3 |
| 18 | 12000 | 10 | 28 | jump + dash + double jump | 4 |
| 20 | 13000 | 11 | 30 | all | 5 |

A level whose measured median deaths exceed the target by more than 3 fails
the gate: `npm run sim -- --family C` bot-plays each level 200 times with a
±60ms input-jitter model and reports the death distribution.

### Meta progression

Deliberately light — this playbook's retention is level supply and time
chasing, not an economy. Persist `MetaSave.stats.bestTimeMs` per level,
`stats.stars`, `unlocks` (mechanics, skins), `currency` (coins from levels).

| Meta-kit component | Wiring | Numbers |
| --- | --- | --- |
| `ui/sagaMap.ts` | one node per level, 5-7 per chapter/biome | chapter gate = 8 of 15-21 stars |
| stars (`core/progression.ts`) | 1-3 per level from time and deaths | |
| `core/collections.ts` albums | player skins, 6-12, purely cosmetic | 1 skin per 2 levels of stars |
| `core/collections.ts` streaks/daily | one daily generated level with a fixed seed and a leaderboard-style personal best | 2x coins |
| `core/collections.ts` reward track | 15 tiers, star-fed | 1 tier per 3 stars |
| Mechanic unlocks | dash at level 6, double jump at 13, wall-slide at 17 | free, gated by chapter, never purchasable |
| `ui/boosterBar.ts` | **not used** — boosters break a precision platformer | a "skip level" token after 8 deaths is the only assist, and it awards 0 stars |

### Build variety

Not build variety but **route variety**: every level must contain at least one
beat with two solutions (jump over vs dash under; high road with coins vs low
road that is faster). Prove it in the PRD by tagging beats `routes: 1 | 2` and
requiring >= 30% of a level's beats to be `routes: 2`. The three player styles
the gate bots model: (1) *safe* — always maximum-height jumps, ignores coins;
(2) *speedrunner* — minimum-height jumps, dashes through hazards, takes the low
road; (3) *collector* — takes every high road for coins, accepts 1.3x par time.
All three must be able to clear every level; only the speedrunner should reach
3 stars on levels past 10.

### Portrait UI plan

- Play area: the full 720x1280 frame; the camera clamp keeps the player inside
  y 300-1060, so HUD in the `SAFE` bands never overlaps the action.
- y 140-200: level label + timer (44px digits, right), pause (88x88px).
- y 200-230: level progress bar (`Bar`, 640x12px) driven by
  `LevelDirector.progress`.
- y 200-260 (left): death counter chip, 120x60px.
- y 1060-1280: no controls at all — the whole screen is the jump button. This
  is why one-button auto-run is mandated: the thumb can rest anywhere.
- Two-zone variant only: two invisible 360x400px zones at y 880-1280 with a
  16px hairline divider and a 200ms tint on press, so the player learns the
  split without permanent chrome.
- Level-end panel: 640x480px centered at y 400-880, auto-advancing after 1.5s
  with a visible countdown ring — never a modal the player must dismiss.

### Performance plan

Peak live ≈ 180 objects: ~130 visible tiles (11 x 20 window plus 2 screens of
margin), 6-12 hazards, 40 particles. Tiles stream from one `SpritePool` sized
`ceil(720/64 + 4) x ceil(1280/64 + 4) = 16 x 24 = 384`; recycle by column as
the camera moves and never instantiate a tile per level cell (a 13000px level
is 203 columns = 4000+ tiles). Hazard update runs only for hazards within
1.5 screens. Fixed-step the physics at 60Hz with a max of 3 substeps per frame
— a variable-step platformer with `gravity 2400` tunnels through 64px tiles on
a frame spike, which is the family's classic crash bug.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Player controller | `objects/platformerBody.ts`: coyote, buffer, variable jump, apex gravity, dash, wall-slide | `class PlatformerBody { update(deltaMs: number, input: { jumpHeld: boolean; jumpPressedAtMs: number; dashPressed: boolean }): void; get onGround(): boolean; get vy(): number }` |
| Level content | `data/beats.ts` (40 beats), `core/levelgen.ts` assembler, biome tilesets | `function assembleLevel(rng: Rng, spec: { lengthPx: number; difficultyBudget: number; mechanics: string[] }): TileMap` |
| Camera + streaming | side-follow camera, tile pool streaming, parallax layers | `function streamTiles(cameraX: number, map: TileMap): void` |
| Meta / UI | saga map, level-end panel, star deposit, skin album | `function onLevelEnd(outcome: { won: boolean; reason: string }, timeMs: number, deaths: number): Promise<'retry' \| 'next'>` |
| Balance (integrator) | beat difficulty ratings, par times, death targets; runs `npm run sim -- --family C` with all three style bots | consumes all contracts above |

### Pitfalls

1. No coyote time or jump buffer — the game measures as broken within 30 seconds and no amount of level design fixes it.
2. Variable-step physics with high gravity: tunneling through floors on a frame spike. Fixed 60Hz substeps, always.
3. Hazards entering the frame with less than 450ms of warning: unavoidable deaths, which read as cheating rather than difficulty.
4. A tile GameObject per level cell — 4000+ sprites, instant memory blowup. Stream by column from a pool.
5. Death -> menu -> retry. Respawn must be 600ms and automatic; the retry loop *is* the game.
6. Generating tiles cell-by-cell instead of concatenating authored beats: the level reads as noise and no difficulty curve is possible.
7. Manual horizontal control via an on-screen dpad in portrait — occupies the thumb band and halves the visible world.
8. Star thresholds on absolute seconds instead of par ratios, so a long level is unstarrable and a short one is free.
9. Boosters/continues bolted on: a precision platformer with a "+3 lives" purchase loses its only source of tension.

### Video hook

25-40s clip: 0-5s a clean run through two easy beats (the movement reads as
crisp), 5-12s a surprise trap kills the player and the 600ms respawn snaps
back instantly (twice) — the retry speed *is* the hook, 12-26s a dash-through-
saw + double-jump combination cleared on the third attempt with hitstop on the
near-miss, 26-36s a fast clean run to the flag with the timer visibly beating
par, 36-40s three stars. Payoff moment: the instant-respawn rhythm followed by
the clean par-beating run.

## C2. Endless runner

Auto-run forward forever, dodge by lane or by steering, collect the coin line,
die once, retry immediately, chase the high score. The `Subway Surfers` class
of runner is still **8.34% of all mobile downloads** — the largest single-title
share in casual — which makes this the safest "endless" pick and the standard
onboarding minigame for pattern **I**.

### Core loop and run shape

**Core loop:** read the next two chunks, swipe to the safe lane, grab the coin
line on the way, bank a powerup for the dense stretch, survive the ramp until
one mistake ends the run, then retry inside 2 seconds with a slightly better
read of the chunk vocabulary.

| Run time | Beat |
| --- | --- |
| 0:00-0:08 | Grace. Speed at base, one obstacle only, coin line dead center — the run starts scoring before it starts threatening. |
| 0:08-0:30 | Ramp step 1-2. Two-lane blocks appear; first powerup pickup; the player learns the chunk vocabulary. |
| 0:30-0:60 | Ramp step 3-4. Speed +35%, obstacle density +40%; near-misses start; first mission tick ("collect 150 coins"). |
| 1:00-1:40 | Ramp step 5-6. Speed near cap; forced-lane sequences (only one safe lane for 3 chunks) demand pre-reading; this is where the median run ends. |
| 1:40-2:30 | Cap phase. Speed is flat at the readability ceiling and only density and pattern complexity rise — the run can no longer be won by reflex, only by pattern memory. |
| on death | Crash freeze 250ms, revive offer (1 per run, ad or currency), score count-up with the personal best line, mission progress, retry button already under the thumb. Total time to next run: **< 2s**. |

Session: 5-15 runs at 30-150s each = 5-10 min. Median run 45-90s.

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Swipe left / right | Change lane (lane variant) or apply a steering impulse (physics variant) | `Controls.onSwipe` |
| Swipe up | Jump | `Controls.onSwipe` |
| Swipe down | Roll / slide under | `Controls.onSwipe` |
| Tap | Use the banked powerup, if any | `Controls.onTap` |
| Drag (physics variant only) | Continuous lateral steering; replaces discrete lanes | `Controls.onDrag` -> `controls.axisX` |

One verb family, four gestures, no chrome. The lane variant is strongly
recommended: discrete lanes make obstacle authoring a finite vocabulary and
make the ramp measurable.

### Systems required

| Module | Use |
| --- | --- |
| `core/ramp.ts` (`RampDirector`) | the whole session: difficulty steps by distance, no win condition, single fail state; `progress` maps to the current ramp step for the HUD; `outcome.reason` = `'crash'` |
| `core/controls.ts` | `onSwipe` (4 directions), `onTap`, `onDrag` for the physics variant |
| `core/pool.ts` | `SpritePool` per obstacle type, coin pool (120), particle pool (200) — nothing in a runner is ever constructed mid-run |
| `core/grid.ts` | lane/chunk occupancy for authored chunk templates (3 lanes x 20 rows per chunk) |
| `core/spatial.ts` | only if the physics variant needs continuous overlap; the lane variant does index math instead and skips it |
| `core/juice.ts` | speed-line FX, near-miss hitstop (60ms), crash shake, coin pop |
| `core/rng.ts` | seeded chunk stream; the daily run uses a fixed seed so scores are comparable |
| `core/progression.ts` | best score/distance, coins, powerup upgrade levels, character unlocks |
| meta-kit `core/collections.ts` | character/skin album (10-15), rotating missions, reward track, daily streak |
| meta-kit `ui/boosterBar.ts` | pre-run loadout: head start, x2 coins, starting powerup |
| `ui/hud.ts`, `ui/bars.ts` | score, coin count, powerup charge bar, personal-best ghost line |
| `ui/cards.ts` | death panel (revive offer, score, missions), character select |
| NEW: needs `data/chunks.ts` | Authored chunk vocabulary: `{ id, lengthPx, lanes: string[][], difficulty: 1..5, minRampStep: number, coinPath: Array<[lane, row]> }` — 10-16 chunks, gated by ramp step. |
| NEW: needs `objects/runnerBody.ts` | Lane-snapping body: lane index, lane-change tween with input queueing, jump/roll state machine reusing the shared C physics constants. Spec: `class RunnerBody { changeLane(dir: -1 \| 1): void; jump(): void; roll(): void; get lane(): number; get state(): 'run' \| 'air' \| 'roll' }`. |
| NEW: needs `core/chunkStream.ts` | Infinite streamer: `nextChunk(rng: Rng, rampStep: number, lastChunkId: string): ChunkSpec` — weighted draw filtered by `minRampStep`, forbidding the same chunk twice in a row and guaranteeing at least one survivable lane path across every chunk seam. |

### Content volume

| Item | Minimum | Comfortable |
| --- | --- | --- |
| Chunk templates | 10 | 16 |
| Obstacle types | 6 | 9 |
| Powerups | 3 (magnet, shield, x2 coins) | 5 (+ jetpack, + hoverboard/second-chance) |
| Characters / skins (collection) | 10 | 15 |
| Biomes (background + tint set) | 2 | 4 |
| Missions in the rotating pool | 12 | 24 |

### Numbers table

Shared physics constants from the family-C table; runner-specific:

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `lanes` | 3 | 3-5 | count | 3 lanes x 200px = 600px, centered in the 640px `SAFE` width |
| `lane.widthPx` | 200 | 160-220 | px | |
| `laneChange.ms` | 140 | 110-190 | ms | must be shorter than the minimum obstacle spacing at cap speed |
| `speed.basePx` | 420 | 340-500 | px/s | |
| `speed.capPx` | 900 | 800-933 | px/s | hard ceiling from the 450ms readability rule |
| `speed.stepMul` | 1.10 | 1.06-1.15 | multiplier per ramp step | |
| `ramp.stepMeters` | 250 | 180-350 | m | one ramp step per 250m (`= 250 * 64px` world units) |
| `ramp.steps` | 8 | 6-12 | steps | after the last step only density rises |
| `obstacle.densityStart` | 0.22 | 0.15-0.30 | obstacles per chunk row | |
| `obstacle.densityCap` | 0.55 | 0.45-0.65 | obstacles per chunk row | above 0.65 the run is unsurvivable |
| `chunk.lengthPx` | 1280 | 960-1920 | px | exactly one screen height of world |
| `coin.value` | 1 | 1-2 | coin | |
| `coin.perChunkAvg` | 14 | 8-22 | coins | the coin line is the reward for the risky lane |
| `score.perMeter` | 1 | 1-2 | points | |
| `score.nearMissBonus` | 15 | 10-30 | points | rewards the risky lane, drives the video hook |
| `powerup.durationMs` | 9000 | 6000-14000 | ms | upgradeable +1500ms per level, 5 levels |
| `powerup.dropRate` | 0.18 | 0.12-0.25 | per chunk | |
| `revive.perRun` | 1 | 0-1 | count | ad or 300 coins |
| `crashFreezeMs` | 250 | 180-400 | ms | before the death panel |
| `retryLatencyMs` | 1200 | 800-2000 | ms | tap-to-tap; must stay under 2000 |
| `entityBudgetLive` | 240 | 180-300 | count | 3 chunks live + coins + particles |

### Progression math

Speed by ramp step: `speed(s) = min(basePx * stepMul^s, capPx)`; distance to
step s is `s * ramp.stepMeters`. Density rises linearly from `densityStart` to
`densityCap` across the 8 steps.

| Ramp step | Distance | Speed (px/s) | Density | Chunk pool | Expected survival |
| --- | --- | --- | --- | --- | --- |
| 0 | 0-250m | 420 | 0.22 | easy 4 | ~100% |
| 1 | 250-500m | 462 | 0.26 | easy 6 | 97% |
| 2 | 500-750m | 508 | 0.30 | easy 6 + mid 3 | 90% |
| 3 | 750-1000m | 559 | 0.34 | mid 6 | 78% |
| 4 | 1000-1250m | 615 | 0.38 | mid 8 | 62% |
| 5 | 1250-1500m | 677 | 0.43 | mid 8 + hard 3 | 44% |
| 6 | 1500-1750m | 744 | 0.47 | hard 6 | 28% |
| 7 | 1750-2000m | 819 | 0.51 | hard 8 | 16% |
| 8+ | 2000m+ | 900 (cap) | 0.55 | hard 10, forced-lane seams | 8% and falling |

That curve is what the sim gate measures: `npm run sim -- --family C` runs a
bot with a 220ms reaction time and ±60ms jitter for 2000 runs and asserts a
**median session of 45-90s** and a p90 under 180s. Session length is the
tuning target, not "difficulty" in the abstract — a runner whose median is 20s
reads as unfair and one whose median is 4 minutes reads as boring.

Score: `score = meters * 1 + coins * 3 + nearMisses * 15`. A median 70s run at
an average 600px/s covers `70 * 600 / 64 ≈ 656m`, collects ~90 coins and ~12
near-misses: `656 + 270 + 180 = 1106` points. Personal-best pacing should put
a first-week player's best around 2.5-3x the median run.

### Meta progression

| Meta-kit component | Wiring | Numbers |
| --- | --- | --- |
| `core/collections.ts` albums | 10-15 characters/skins, each with a purely cosmetic identity (no stats — stat-bearing skins force a "best skin" and kill collection value) | 400-3000 coins, or mission rewards |
| `core/collections.ts` missions | 3 active rotating missions, replaced individually on completion | "collect 300 coins", "10 near-misses", "reach 1200m" |
| `core/collections.ts` reward track | 30 tiers fed by mission completions | 1 tier per 2 missions |
| `core/collections.ts` streaks/daily | daily run with a fixed seed + login streak | day 7 = a character shard |
| Powerup upgrades (`core/progression.ts`) | 5 levels per powerup, +1500ms duration each | `cost(n) = 250 * 1.6^n` |
| `ui/boosterBar.ts` | pre-run loadout: head start (500m), x2 coins, starting powerup | 200 / 300 / 150 coins |
| `ui/sagaMap.ts` | **not used** — there are no levels | the reward track replaces the map |

### Build variety

Runners have no builds; the variety axis is **risk policy**, and the coin/
near-miss economy must keep three viable: (1) *safe-lane* — always the emptiest
lane, minimum coins, longest runs; (2) *coin-liner* — follows the coin path
even into the tight lane, ~30% shorter runs but 2x the currency; (3)
*near-miss farmer* — deliberately grazes obstacles for the 15-point bonus,
highest score per meter, shortest runs. Prove it in the PRD with the expected
value per run for each policy at ramp step 4; no policy may dominate the other
two on both score and coins. Powerups must also differ in *policy* effect, not
just magnitude: the magnet subsidizes the safe lane, the shield subsidizes the
coin line.

### Portrait UI plan

- Play area: full frame. The runner sprite sits at y 880 (screen-space,
  fixed) so 740px of track is visible ahead — the portrait runner's core
  compromise, and the reason `speed.capPx` is 900 rather than 1400.
- y 140-200: score (56px digits, center), coin counter with icon (right),
  pause (left).
- y 200-230: ramp-step pips (8 dots, 12px) — a legible "how deep am I" read
  without a number.
- y 200-260 (right): powerup charge (`Bar`, 180x18px) when a powerup is banked.
- y 1100-1280: nothing. Swipes are read anywhere on the frame; a permanent
  control overlay here would sit exactly where the player looks for incoming
  obstacles in the physics variant.
- Death panel: 640x700px at y 300-1000, with the retry button as a 400x120px
  target centered at y 900 — inside the thumb arc, because retry frequency is
  the whole loop.
- Personal-best ghost: a thin horizontal line marker on the ramp pips at the
  best-run step; it is the only competitive UI needed.

### Performance plan

Peak live ≈ 240 objects: 3 live chunks (current + 2 ahead) with up to 20
obstacles each, ~40 coins, 200-particle pool shared between speed lines,
coin pops and the crash burst. Chunks recycle whole: a chunk that leaves the
bottom of the frame returns its sprites to their pools in one pass, and the
next chunk is populated from `chunkStream.nextChunk` — never build a chunk
during the frame it becomes visible; build it one chunk early. Parallax
backgrounds are 3 layers at 0.2 / 0.45 / 0.8 scroll factors, each a single
wrapped texture, not tiled sprites. At `speed.capPx = 900` the world moves 15px
per frame, so any per-frame allocation shows up as a stutter within seconds:
the runner is the strictest zero-allocation loop in this file.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Runner controller | `objects/runnerBody.ts`: lane snapping, input queueing, jump/roll states | `class RunnerBody { changeLane(dir: -1 \| 1): void; jump(): void; roll(): void; get lane(): number; get state(): 'run' \| 'air' \| 'roll' }` |
| Chunk content + streaming | `data/chunks.ts` (16 chunks), `core/chunkStream.ts`, seam survivability rule | `function nextChunk(rng: Rng, rampStep: number, lastChunkId: string): ChunkSpec` |
| Ramp + scoring | `RampDirector` wiring, speed/density curves, score and near-miss detection | `function rampAt(distanceMeters: number): { step: number; speedPx: number; density: number }` |
| Meta / UI | missions, character album, reward track, death panel, revive flow | `function onRunEnd(score: number, coins: number, meters: number): Promise<'retry' \| 'menu'>` |
| Balance (integrator) | tunes the ramp until the bot median lands in 45-90s; runs `npm run sim -- --family C` | consumes all contracts above |

### Pitfalls

1. Speed above 933 px/s with the player at y 880: obstacles get less than 450ms of screen time and every death feels stolen.
2. Chunk seams that produce no survivable lane path — the run ends for reasons the player cannot read. `nextChunk` must verify the seam.
3. Building the next chunk on the frame it appears: a 20-obstacle instantiation spike every 1.4s at cap speed. Build one chunk ahead.
4. Lane-change tween longer than the minimum obstacle gap at cap speed — the player commits and still clips. Keep `laneChange.ms <= 190`.
5. No input queueing: a swipe during a lane change is dropped, which reads as unresponsive. Queue exactly one pending swipe.
6. Retry behind two taps or an interstitial. Above 2s tap-to-tap, session length collapses; the retry button must be pre-focused under the thumb.
7. Stat-bearing characters: one becomes optimal, the other 14 are dead content and the collection loses its point.
8. Tuning "difficulty" instead of session length. The gate's median-45-90s assertion is the actual specification.
9. Per-frame allocations (new vectors, string concatenation for the score label) — at 15px/frame world motion these are visible stutters. Update the score label only when the integer meter value changes.

### Video hook

20-35s clip: 0-4s base-speed run scooping a full coin line (the reward reads
first), 4-12s two clean lane changes and a jump over a two-lane block as speed
visibly rises, 12-22s a powerup pickup and a near-miss chain with hitstop
ticks and the bonus numbers popping, 22-30s the forced-lane sequence at cap
speed with speed lines and a shrinking gap, 30-33s a crash freeze, 33-35s the
instant retry already running again. Payoff moment: the near-miss chain at cap
speed, ending on the sub-2-second retry.

## Family E — track-vehicle

One playbook, one director. `LapDirector` (`core/lap.ts`) owns laps,
checkpoints, per-lap splits and finishing position; the camera profile is
**track** (follow + velocity lookahead + optional rotation lock); input is
drag to steer plus tap to drift. Slice: `scripts/new-game.sh <slug> --family E`
scaffolds `src/slices/track/game.ts`; the gate is
`npm run sim -- --family E` (`src/sim/families/track.ts`), which drives a lap
bot around every track and asserts clean-lap times, checkpoint reachability
and finishing-position distribution.

Racing is a **$9.8B** mobile category — large, stable, and unusually tolerant
of small content volumes because a track is replayed dozens of times.

## E1. Top-down arcade racing

Top-down view, 3-5 laps, 4-8 AI opponents, drift-to-boost as the single skill
expression. No simulation handling model: grip is a two-state machine (gripped
or drifting) and the whole game is knowing when to switch.

### Core loop and run shape

**Core loop:** hold the racing line, tap into a drift before the apex, hold the
drift long enough to charge boost, release into the straight, spend boost to
pass, repeat for 3 laps and take the position.

| Race time | Beat |
| --- | --- |
| 0:00-0:04 | Countdown 3-2-1-GO with a launch-boost window (a tap inside 150ms of GO grants a 1.2s boost) — the race's first skill test. |
| 0:04-0:40 | Lap 1. The player is mid-pack; 2-3 overtakes available on the two easiest corners; the track is being learned. |
| 0:40-1:20 | Lap 2. Rubber-banding puts the leader ~1.5s ahead; the boost economy matters now — a lap without a full drift chain cannot close that gap. |
| 1:20-2:00 | Lap 3 (final). Best-drift corner is the deciding overtake; the last straight resolves the race. |
| 2:00-2:20 | Resolution: finishing position, best lap, drift-time total, coins, 1-3 stars (position-based), next-race panel. |
| between races | Track select / upgrade shop / reward track: 15-30s. |

Session: 2-4 races at 120-200s each = 5-10 min.

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Drag (horizontal) | Steering angle proportional to the drag offset from the touch origin, clamped to `steer.maxDeg` | `Controls.onDrag` -> `controls.axisX` |
| Tap / hold (right zone) | Enter drift while held: grip drops, yaw rate rises, boost charges | `Controls.onHoldStart/onHoldEnd` |
| Release drift | Convert charged drift time into a boost burst | same hook, on `onHoldEnd` |
| Tap (left zone) | Brake — needed on 2 of 6 tracks only; auto-throttle otherwise | `Controls.onHoldStart` with x < 240 |
| Swipe down | Use the banked pickup (nitro / shield), if the track has pickups | `Controls.onSwipe` |

Throttle is automatic. A portrait racer with a manual throttle spends the
thumb band on a pedal and loses the road.

### Systems required

| Module | Use |
| --- | --- |
| `core/lap.ts` (`LapDirector`) | laps, ordered checkpoints, per-lap splits, live position, wrong-way detection; `progress` = `(lap + checkpointFraction) / totalLaps`; `outcome.reason` = `'finished' \| 'dnf'` |
| `core/controls.ts` | `onDrag` for steering, `onHoldStart/onHoldEnd` for drift/brake |
| `core/stats.ts` | per-car `StatBlock`: `topSpeed`, `accel`, `grip`, `driftCharge`, `boostPower`; upgrades are `Modifier[]` |
| `core/spatial.ts` | `SpatialHash` for car-vs-car contact and pickup overlap at 8 cars |
| `core/grid.ts` | `NavGrid` over the track for the bot racing line and off-track detection (blocked = off-surface) |
| `core/pool.ts` | `SpritePool` for tire marks (120), boost particles (200), dust, pickups |
| `core/juice.ts` | boost FOV/zoom punch, drift camera lean, contact shake, speed lines above 0.8 top speed |
| `core/rng.ts` | seeded bot personality jitter, so a track+seed replays identically for the gate |
| `core/progression.ts` | coins, car unlocks, per-car upgrade levels, track stars, best laps |
| meta-kit `core/collections.ts` | car album (6-10), rotating race missions, reward track, daily race |
| meta-kit `ui/sagaMap.ts` | championship map: track nodes with star gates |
| meta-kit `ui/boosterBar.ts` | pre-race loadout: launch nitro, tire set, repair kit |
| `ui/hud.ts`, `ui/bars.ts` | speed, lap counter, position, boost bar, split delta |
| `ui/cards.ts` | results panel, upgrade shop cards, car select |
| NEW: needs `objects/carBody.ts` | Two-state arcade handling: `class CarBody { update(deltaMs: number, input: { steer: number; drifting: boolean; braking: boolean }): void; get speed(): number; get driftChargeMs(): number; releaseBoost(): number }`. Grip state sets lateral friction and yaw response; there is no tire model. |
| NEW: needs `data/tracks.ts` | `TrackSpec[]`: `{ id, name, laps, widthPx, centerline: Array<[x, y]>, checkpoints: number, surface: 'asphalt' \| 'dirt' \| 'ice', pickups: boolean, parLapMs: number }`. |
| NEW: needs `objects/racerAi.ts` | Bot: follows a precomputed racing line from the centerline with per-personality corner-entry error and a drift-usage probability. Spec: `class RacerAi { update(deltaMs: number, line: RacingLine, skill: number): CarInput }`. |

### Content volume

| Item | Minimum | Comfortable |
| --- | --- | --- |
| Tracks | 3 | 6 |
| Laps per race | 3 | 3-5 |
| Opponent bots per race | 4 | 7 |
| Bot personalities | 3 | 5 |
| Player cars | 3 | 6-10 |
| Upgrade paths per car | 3 (engine, grip, boost) | 5 (+ brakes, + weight) |
| Surfaces | 2 | 3 (asphalt, dirt, ice) |
| Championships (track sets) | 1 | 3 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `car.topSpeedPx` | 620 | 480-760 | px/s | at camera zoom 0.72 this reads as ~860 px/s of apparent motion |
| `car.accelPxS2` | 620 | 480-800 | px/s^2 | 1.0s to top speed |
| `car.brakePxS2` | 1400 | 1000-1900 | px/s^2 | |
| `car.lengthPx` | 96 | 80-120 | px | |
| `steer.maxDegPerS` | 190 | 150-240 | deg/s | gripped yaw rate |
| `drift.yawMulti` | 1.85 | 1.5-2.2 | multiplier | yaw rate while drifting |
| `drift.lateralFriction` | 0.35 | 0.25-0.5 | fraction of gripped friction | |
| `drift.speedLossPerS` | 0.12 | 0.06-0.2 | fraction of speed per second | drifting must cost something |
| `drift.minChargeMs` | 450 | 350-600 | ms | below this, no boost is granted |
| `drift.maxChargeMs` | 1800 | 1400-2400 | ms | charge cap |
| `boost.speedMul` | 1.35 | 1.2-1.5 | multiplier on top speed | |
| `boost.msPerChargeMs` | 0.9 | 0.7-1.2 | ms of boost per ms of drift | |
| `boost.maxMs` | 2200 | 1600-3000 | ms | |
| `launch.windowMs` | 150 | 100-250 | ms | perfect-start window at GO |
| `track.widthPx` | 340 | 260-460 | px | ~3.5 car widths; narrower than 260 makes 8-car packs unfair |
| `track.lengthPx` | 9500 | 7000-14000 | px | ~38s per lap at average 250 px/s effective |
| `track.checkpoints` | 12 | 8-20 | count | also the bot's line resolution and the respawn granularity |
| `laps` | 3 | 3-5 | count | 3 laps x 38s = 114s + countdown + results ≈ 140s |
| `offTrack.speedMul` | 0.55 | 0.4-0.7 | multiplier | grass/sand penalty, no hard wall |
| `contact.pushImpulse` | 220 | 150-320 | px/s | car-vs-car nudge; never a spin-out |
| `bots.count` | 6 | 4-7 | count | player + 6 = 7 cars |
| `bots.skillSpread` | 0.18 | 0.1-0.3 | fraction | bot lap-time spread around the player's par |
| `rubberband.maxGapS` | 2.5 | 1.5-4.0 | s | leader is pulled back inside this gap |
| `rubberband.speedMul` | 0.06 | 0.03-0.12 | fraction | max speed adjustment magnitude — must stay invisible |
| `camera.zoom` | 0.72 | 0.6-0.9 | scale | shows ~1000px of world height in portrait |
| `camera.lookaheadMs` | 320 | 220-450 | ms | lookahead = velocity x this |
| `entityBudgetLive` | 260 | 200-320 | count | 7 cars + tire marks + boost particles + track props |

### Progression math

Par lap is computed from the track, not guessed:
`parLapMs = trackLengthPx / (topSpeedPx * 0.62) * 1000` — the 0.62 factor is
the measured fraction of top speed an ideal line sustains on a 12-checkpoint
track. For a 9500px track at 620 px/s: `9500 / 384 = 24.7s`. Add the drift
economy: a full drift chain (4 corners x 1.2s charge -> 4.3s of boost at
1.35x) saves ~1.6s per lap, so a clean expert lap is ~23.1s and a no-drift lap
is ~24.7s. **That 6.5% gap is the entire skill ceiling** — if drifting saves
less than 4% per lap nobody drifts; more than 12% and non-drifters cannot
finish.

Star and reward thresholds by finishing position:

| Position | Stars | Coins | Championship points |
| --- | --- | --- | --- |
| 1st | 3 | 300 | 10 |
| 2nd | 2 | 220 | 8 |
| 3rd | 2 | 170 | 6 |
| 4th-5th | 1 | 110 | 4 |
| 6th-7th | 0 | 60 | 2 |

Bot skill: `botLapMs(i) = parLapMs * (1 + skillSpread * (i / (bots.count - 1) - 0.35))`
so with `spread = 0.18` and 6 bots the field spans `parLapMs * 0.937` to
`parLapMs * 1.055` — the fastest bot is ~6% faster than par, exactly the drift
skill gap, which makes "learn to drift or finish 4th" the honest difficulty
statement. Upgrades shift the player's own par:
`cost(n) = 400 * 1.55^n` per upgrade level, 5 levels, each +3% in its stat.

### Meta progression

| Meta-kit component | Wiring | Numbers |
| --- | --- | --- |
| `ui/sagaMap.ts` | championship map: 3-6 track nodes per championship, star gates | gate = 6 of 9-18 stars |
| stars (`core/progression.ts`) | 0-3 per race by finishing position | |
| Car upgrades (`core/progression.ts`) | 3-5 paths x 5 levels per car, `Modifier[]` folded into the car `StatBlock` | `cost(n) = 400 * 1.55^n`, +3% per level |
| `core/collections.ts` albums | 6-10 cars, each with a distinct stat silhouette (grip car vs top-speed car — cars must differ in *policy*, not power level) | 2000-15000 coins |
| `core/collections.ts` missions | 3 rotating: "5s of drift in one lap", "win without going off-track", "beat par on Track 3" | |
| `core/collections.ts` reward track | 25 tiers fed by championship points | 1 tier per 12 points |
| `core/collections.ts` streaks/daily | daily time-trial on a fixed seed with a personal-best ghost | 2x coins |
| `ui/boosterBar.ts` | pre-race: launch nitro, sticky tires (+8% grip for lap 1), repair kit | 150 / 200 / 120 coins |

### Build variety

Three viable car/driving builds, each provable against the lap bot: (1)
*top-speed* — max engine, minimum grip, wins on the two long-straight tracks,
loses the technical ones; (2) *grip* — max grip and brakes, never drifts,
consistent but 4% off par everywhere, the safe pick for a new player; (3)
*drift-boost* — max `driftCharge` and `boostPower`, lowest top speed, fastest
of the three in expert hands on corner-dense tracks. The PRD must include the
bot-measured lap time of all three builds on all tracks; every build must be
fastest on at least one track, and no build may be slowest on more than half.
Surfaces are the second axis: dirt halves the grip build's advantage, ice
punishes the top-speed build.

### Portrait UI plan

- Play area: full frame at `camera.zoom = 0.72`, showing ~1000x1780 world
  units. The car sits at screen y 800 with a 320ms velocity lookahead, so
  ~660px of track reads ahead at speed.
- y 140-215: position indicator ("3/7", 64px digits, left), lap counter
  ("2/3", center), split delta vs personal best (green/red, right).
- y 215-245: boost bar (`Bar`, 400x22px, centered) — the only bar the player
  actually watches; it must be adjacent to the car's line of sight, not in a
  corner.
- y 1060-1280: two invisible input zones — left 240px = brake, right 480px =
  drift — with a 180ms tint on press and no permanent chrome. Steering is
  read as a drag anywhere in the frame, so both zones double as steering
  origins.
- Mini-map: 180x180px at top-right, y 250-430, only on tracks longer than
  10000px; below that it is noise.
- Results panel: 640x760px at y 260-1020, showing position, best lap vs par,
  total drift time (the stat that teaches the skill), coins, stars.

### Performance plan

Peak live ≈ 260 objects: 7 cars (each a body + shadow + 2 boost emitters), 120
pooled tire-mark quads, 200-particle shared pool, plus track props. Tire marks
are the classic blowup: they must be a fixed-size ring buffer of pooled quads
that overwrite oldest-first, never a growing render list, and they must be
drawn to a single RenderTexture per lap rather than kept as live objects.
`SpatialHash` handles the 7-car contact test; a naive all-pairs test is fine at
7 cars but not at pickups + cars + props, so route everything through the hash.
The bot AI runs its racing-line query at 20Hz, not per frame — 7 bots x 60Hz of
`NavGrid` queries is pure waste. Camera zoom changes during boost must be
tweened, never set per frame, to avoid re-culling the whole display list.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Handling | `objects/carBody.ts`: grip/drift states, boost charge and release, contact response | `class CarBody { update(deltaMs: number, input: { steer: number; drifting: boolean; braking: boolean }): void; get speed(): number; get driftChargeMs(): number; releaseBoost(): number }` |
| Tracks + content | `data/tracks.ts` (6 tracks), centerlines, checkpoints, surfaces, `parLapMs` | `interface TrackSpec { id: string; laps: number; widthPx: number; centerline: Array<[number, number]>; checkpoints: number; surface: 'asphalt' \| 'dirt' \| 'ice'; parLapMs: number }` |
| Bots + race director | `objects/racerAi.ts`, `LapDirector` wiring, positions, rubber-banding | `function racingLine(track: TrackSpec, skill: number): RacingLine` and `class RacerAi { update(deltaMs: number, line: RacingLine, skill: number): CarInput }` |
| Meta / UI | championship map, upgrade shop, car select, results panel, missions | `function onRaceEnd(position: number, bestLapMs: number, driftMs: number): Promise<'retry' \| 'next'>` |
| Balance (integrator) | par laps, bot spread, rubber-band limits, drift gap; runs `npm run sim -- --family E` for all builds x all tracks | consumes all contracts above |

### Pitfalls

1. A tire/grip simulation instead of a two-state grip switch. Arcade drift must be binary and instantly legible; a slip-angle model is unplayable on a 720px portrait screen.
2. Visible rubber-banding: above ~12% speed adjustment players notice and stop trying. Cap at 6% and cap the pull-back gap.
3. Drift that costs nothing — then the optimal line is a permanent drift and the skill disappears. `drift.speedLossPerS` must be non-zero.
4. Camera too tight: at zoom 1.0 the player sees 380px ahead at 620 px/s, i.e. 600ms of warning, and every corner is a surprise. 0.72 or wider, always.
5. Tire marks as live GameObjects — a 3-lap race with 7 cars produces tens of thousands. Ring buffer into a RenderTexture.
6. Hard walls on the track edge: a portrait racer with wall-stops turns every corner into a dead stop. Use an off-track speed penalty instead.
7. Manual throttle in the thumb band, which costs the player 220px of road.
8. Bot lap times authored as absolute seconds; they must be derived from `parLapMs` so upgrades and car choice stay meaningful.
9. Boost bar in a screen corner where nobody looks; put it under the lap counter, in the driving sightline.

### Video hook

25-40s clip: 0-4s the countdown and a perfect launch boost (immediate skill
read), 4-14s two corners with the drift camera lean, tire marks and the boost
bar visibly charging, 14-24s three overtakes down a straight with the boost
released, speed lines and a contact nudge, 24-34s the final corner taken as a
long drift into a boost that steals first place on the line, 34-40s results
with the best-lap split beating par in green. Payoff moment: the last-corner
drift-boost overtake.

## Family F — idle-tycoon

One playbook. The core loop has **no session director** — an idle game has no
session boundary, and forcing one is the genre's most common design error.
`LevelDirector` (`core/level.ts`) is used only for **milestone chapters**
("reach $1M/s", "unlock generator 8"), where its goal set and stars drive the
saga map. Camera: static-board (a fixed UI screen with a scrolling generator
list; no world camera at all). Input: tap only. Slice:
`scripts/new-game.sh <slug> --family F` scaffolds `src/slices/idle/game.ts`;
the gate is `npm run sim -- --family F` (`src/sim/families/idle.ts`), which
fast-forwards the economy and asserts the milestone-time and prestige-time
curves below.

Simulation is the **#1 category by downloads** (6.3B on Google Play) and idle
is its cheapest, most parallelizable sub-shape: the entire game is one
exponential-curve module plus presentation.

## F1. Generators, managers, prestige

Buy a generator, it produces currency forever, buy a manager so it produces
while you are away, buy the next generator at 10x the cost and 8x the output,
and when growth stalls, prestige: reset everything for a permanent multiplier
that makes the next pass 5-10x faster.

### Core loop and run shape

**Core loop:** tap-collect or auto-collect currency, spend it on the cheapest
meaningful multiplier (next generator tier / x2 upgrade / manager), watch the
production rate cross a milestone, repeat until the curve flattens, then
prestige for a permanent multiplier.

| First-session time | Beat |
| --- | --- |
| 0:00-0:30 | Generator 1 is free and tap-driven: 8-10 taps produce visible currency and the first purchase happens inside 20s. No tutorial text. |
| 0:30-2:00 | Generators 2-3 unlock (cost 60 and 720). First manager offered at ~1:30, converting tapping into idling — the pivotal teaching moment of the genre. |
| 2:00-5:00 | Generators 4-6. First x2 upgrade tier appears; the player learns that upgrades beat new generators when the ratio is right. First milestone chapter completes (~3:30). |
| 5:00-8:00 | Generators 7-9. Growth visibly slows: the next generator costs ~40x the current income per second. The prestige button becomes available and is *explained by the number*, not a tooltip. |
| 8:00-10:00 | First prestige (target 15-30 min of total play, reachable inside one long first session or two short ones): full reset, permanent x1.8-2.4 multiplier, and the first 8 minutes replay in ~90 seconds. |
| Return visits | Offline accrual popup (capped), 60-180s of purchasing, one milestone, out. |

Session: one continuous 6-10 min first session, then 60-180s check-ins. This
playbook satisfies the 5-10 min mandate with the **first** session and does not
pretend later sessions are that long.

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Tap generator row | Buy 1 (or `buyMode` x10 / x100 / max) | `Controls.onTap` -> `economy.buy(state, generatorId, count)` |
| Tap generator icon (pre-manager) | Manual production tick for that generator | `Controls.onTap` -> `economy.tick(state, generatorId)` |
| Tap buy-mode toggle | Cycle x1 / x10 / x100 / max — mandatory; without it late-game play is 400 taps per purchase | `Controls.onTap` |
| Tap upgrade card | Buy a x2/x3 multiplier for one generator or all | `ui/cards.ts` -> `economy.buyUpgrade(state, id)` |
| Tap manager card | Automate one generator permanently | `economy.hireManager(state, id)` |
| Tap prestige | Confirm reset, bank the permanent multiplier | `economy.prestige(state)` |
| Hold generator row (400ms) | Continuous buy while held, 8 buys/s | `Controls.onHoldStart/onHoldEnd` |

### Systems required

| Module | Use |
| --- | --- |
| `core/economy.ts` | the entire game: generator cost curves (`cost(n) = base * growth^n`), production rates, upgrade multipliers, manager automation, offline accrual with a cap, prestige reset with a carry-over multiplier, and big-number formatting (K/M/B/T/aa/ab) |
| `core/level.ts` (`LevelDirector`) | milestone chapters only: goal set = production/currency/unlock thresholds, no move or time budget, stars by time-to-complete |
| `core/progression.ts` | `MetaSave`: generator counts, upgrade ids, managers, prestige count, permanent multiplier, last-seen timestamp |
| `core/rng.ts` | seeded events only (a random 2-minute x3 boost offer); the economy itself must be fully deterministic |
| `core/juice.ts` | purchase pop, milestone flash, prestige whiteout, number count-up easing |
| meta-kit `core/collections.ts` | manager/character album, rotating daily goals, reward track, login streak |
| meta-kit `ui/sagaMap.ts` | chapter map over milestones |
| meta-kit decor/renovation tasks (slice scene) | the tycoon's visible world: each generator tier upgrades a building sprite, giving the exponential numbers a physical read |
| `ui/hud.ts`, `ui/bars.ts` | currency header, per-generator progress bars, prestige-readiness bar |
| `ui/cards.ts` | upgrade cards, manager cards, prestige confirm, offline-earnings panel |
| `ui/button.ts` | the buy rows and buy-mode toggle |
| `ui/boosterBar.ts` | time-skip (2h of production), x2 production for 15 min, instant-manager token |
| NEW: needs `data/generators.ts` | `GeneratorSpec[]`: `{ id, name, baseCost, costGrowth, baseOutput, tickMs, managerCost, unlockAt }` — 8-12 entries. |
| NEW: needs `data/idleUpgrades.ts` | `IdleUpgradeSpec[]`: `{ id, target: 'all' \| generatorId, mul: number, cost: number, unlockAt: { generatorId, count } }` — 24-40 entries. |
| NEW: needs `objects/generatorRow.ts` | Row view: icon, level, output/s, cost, progress bar, buy target. Spec: `class GeneratorRow { setState(count: number, cost: number, affordable: boolean, outputPerS: number): void }`. |

### Content volume

| Item | Minimum | Comfortable |
| --- | --- | --- |
| Generators | 8 | 12 |
| Managers | 8 (one per generator) | 12 |
| Upgrades (x2/x3 multipliers) | 24 | 40 |
| Prestige perks | 4 | 8 |
| Milestone chapters | 6 | 12 |
| Building art tiers per generator | 2 | 4 |
| Daily goals in the pool | 8 | 16 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `generators.count` | 10 | 8-12 | count | fewer than 8 flattens the curve; more than 12 is unreadable in portrait |
| `generator.costGrowth` | 1.12 | 1.08-1.15 | multiplier per unit owned | **the single most important number in the game** |
| `generator.baseCost.g1` | 4 | 2-10 | currency | first purchase inside 20s |
| `generator.tierCostMul` | 12 | 8-20 | multiplier | cost of tier n+1 base vs tier n base |
| `generator.tierOutputMul` | 8 | 5-12 | multiplier | output of tier n+1 vs tier n; must be below `tierCostMul` so old tiers stay relevant |
| `generator.baseOutput.g1` | 1 | 0.5-2 | currency/tick | |
| `generator.tickMs.g1` | 1000 | 600-1500 | ms | later tiers tick slower (up to 12000ms) and pay more |
| `manager.costMul` | 25 | 15-40 | x current generator cost | the automation paywall, paid in soft currency |
| `upgrade.mul` | 2 | 2-3 | multiplier | x2 is the readable default |
| `upgrade.costMul` | 18 | 12-30 | x generator base cost | |
| `buyModes` | x1/x10/x100/max | — | — | mandatory |
| `offline.capHours` | 4 | 2-8 | hours | accrual cap; below 2h punishes real life, above 8h destroys session frequency |
| `offline.rateMul` | 0.6 | 0.4-1.0 | fraction of online rate | offline pays less than playing |
| `prestige.firstAtMinutes` | 22 | 15-30 | min of total play | measured by the gate, not guessed |
| `prestige.multiplier1` | 2.0 | 1.8-2.4 | multiplier | first prestige reward |
| `prestige.multiplierGrowth` | 1.55 | 1.35-1.8 | multiplier per prestige | |
| `prestige.replaySpeedup` | 6 | 5-10 | x | how much faster the same content replays after prestige |
| `prestige.keptOnReset` | perks, album, chapters | — | — | never reset the collection or the map |
| `numberFormat.tiers` | K M B T aa ab ac | — | — | switch to suffix notation above 1e5 |
| `countUp.ms` | 300 | 200-500 | ms | number easing; instant number jumps read as broken |
| `entityBudgetLive` | 80 | 50-120 | count | 10 rows + cards + particles; the lightest family in this file |

### Progression math

Cost of the nth unit of a generator: `cost(n) = baseCost * 1.12^n`. Total for
the first N units: `baseCost * (1.12^N - 1) / 0.12`. Output is linear in units
owned and multiplicative in upgrades:
`rate = sum_i(count_i * baseOutput_i * upgradeMul_i) * prestigeMul`.

Time-to-double is the number that must stay flat: with `costGrowth = 1.12`,
doubling a generator's owned count costs ~`1.12^N` times the last unit, so the
*ratio* of cost to income stays roughly constant — that flatness is what makes
an idle game feel infinite. Verify it in the gate: the measured wall-clock time
per production-rate doubling must sit in a 1.5-4 minute band for the whole
first prestige cycle.

| Milestone | Rate reached | Cumulative play time (target) | Generators owned | Note |
| --- | --- | --- | --- | --- |
| M1 | 10/s | 0:45 | g1-g2 | first manager offered |
| M2 | 200/s | 2:30 | g1-g4 | first x2 upgrade tier |
| M3 | 5e3/s | 4:30 | g1-g6 | first chapter star |
| M4 | 2e5/s | 7:00 | g1-g8 | prestige button appears |
| M5 | 8e6/s | 10:00 | g1-g9 | curve visibly flattens |
| P1 | prestige | 22:00 | reset | permanent x2.0 |
| M5 again | 8e6/s | 3:40 after P1 | g1-g9 | `replaySpeedup ≈ 6x` |

Offline: `offlineEarnings = min(elapsedH, 4) * 3600 * rate * 0.6`. Worked: a
player away 6 hours at 2e5/s banks `4 * 3600 * 2e5 * 0.6 = 1.73e9` — roughly
2.4 minutes of active play, which is the correct scale for a re-engagement
reward: enough to justify opening the app, not enough to replace playing.

Prestige: `multiplier(p) = 2.0 * 1.55^(p-1)`, so prestige 4 grants x7.4 and the
cycle time falls from 22 min to ~4 min. The gate asserts that prestige p+1 is
reachable in 25-45% of the time prestige p took; outside that band the game
either stalls or trivializes.

### Meta progression

In an idle game the meta *is* prestige, so the meta-kit is used for identity
and cadence rather than power.

| Meta-kit component | Wiring | Numbers |
| --- | --- | --- |
| Prestige perks (`core/progression.ts`) | permanent-currency shop, survives every reset | 4-8 perks: +25% offline cap, +10% all output, start with g2 owned, manager discount; `cost(n) = 1 * 2.2^n` prestige currency |
| `ui/sagaMap.ts` | chapter map over the 6-12 milestone chapters | 1-3 stars per chapter by completion time |
| `core/collections.ts` albums | manager/character album (8-12), each with a flavour bonus of at most +5% so collecting stays cosmetic | earned from chapters, never bought with soft currency |
| `core/collections.ts` daily goals | 3 rotating: "buy 50 units", "complete a chapter", "prestige once" | reward: time-skip tokens |
| `core/collections.ts` reward track | 30 tiers fed by chapter stars | 1 tier per 2 stars |
| `core/collections.ts` streaks/daily | login streak grants escalating time-skips | day 7 = 4h skip |
| decor/renovation tasks | each generator tier's building visibly upgrades at 25/50/100/200 units owned | 4 art tiers per generator |
| `ui/boosterBar.ts` | time-skip 2h, x2 for 15 min, instant manager | earned from goals; a rewarded-ad hook if the build has one |

### Build variety

Idle "builds" are **spend policies**, and the economy must keep three within
15% of each other in time-to-prestige: (1) *wide* — buys every generator to
equal counts, best offline rate, worst burst; (2) *tall* — dumps everything
into the newest generator, fastest rate spikes, fragile if a manager is
unaffordable; (3) *upgrade-first* — hoards for x2 upgrades before buying units,
slowest early and fastest after M3. Prove it in the PRD with the gate's
measured time-to-M5 for each policy. If one policy wins by more than 15%, the
`tierCostMul`/`tierOutputMul`/`upgrade.costMul` triangle is misconfigured —
that is the only lever, and `tierOutputMul < tierCostMul` is the invariant that
keeps older generators worth buying.

### Portrait UI plan

- y 140-260: currency header — total (64px digits, count-up eased) and rate/s
  (36px) — plus the prestige-readiness bar (`Bar`, 640x14px) at y 246.
- y 260-1060: the generator list, 5.5 rows visible at 148px each, vertically
  scrollable. Each row: 96x96px icon (left), name + owned count + output/s
  (center), a full-height 200x120px buy button (right) showing cost and
  affordability state. The buy button is the only touch target in the row, and
  it sits in the right third where the thumb naturally lands.
- y 1060-1180: tab bar — Generators / Upgrades / Managers / Prestige, 4 tabs at
  160x110px.
- y 1180-1280 (`SAFE` bottom): buy-mode toggle (x1/x10/x100/max) as a 300x80px
  segmented control, plus the booster/time-skip button.
- Offline-earnings panel on resume: 640x520px centered, with a single
  "Collect" button at 400x120px; it must be dismissable in one tap.
- Affordability is colour-coded on every row simultaneously, so the player
  scans one column to decide — this is the genre's entire moment-to-moment UX.

### Performance plan

Peak live ≈ 80 objects. Rendering is trivial; the two real risks are
**numeric** and **update frequency**. (1) Currency exceeds `Number.MAX_SAFE_INTEGER`
within a few prestiges: `core/economy.ts` must carry values as
`{ mantissa, exponent }` pairs (or scaled logs) and never as raw floats past
1e15, or the late game silently freezes at `Infinity`. (2) Do not recompute the
full rate or re-render 10 rows every frame: tick the economy on a fixed 250ms
accumulator, update only the rows whose affordability or count changed, and ease
the displayed number toward the model value. Offline accrual is a single closed-
form computation at resume, never a loop over elapsed ticks (a 4-hour catch-up
loop at 1000ms ticks is 14400 iterations and, with 10 generators, a visible
freeze on resume).

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Economy core | `core/economy.ts`: cost/output curves, big-number type, offline accrual, prestige | `function rate(state: EconomyState): BigNum` and `function buy(state: EconomyState, generatorId: string, count: number \| 'max'): { ok: boolean; spent: BigNum }` and `function accrueOffline(state: EconomyState, elapsedMs: number): BigNum` |
| Content | `data/generators.ts` (10), `data/idleUpgrades.ts` (40), milestone chapters, prestige perks | `interface GeneratorSpec { id: string; baseCost: number; costGrowth: number; baseOutput: number; tickMs: number; managerCost: number; unlockAt: number }` |
| UI shell | `objects/generatorRow.ts`, tabs, buy-mode control, count-up formatting | `function formatBig(v: BigNum): string` and `class GeneratorRow { setState(count: number, cost: BigNum, affordable: boolean, outputPerS: BigNum): void }` |
| Meta / world | chapter map, building art tiers, album, daily goals, offline panel | `function onMilestone(chapterId: string, stars: number): Promise<void>` |
| Balance (integrator) | growth constants, milestone times, prestige band; runs `npm run sim -- --family F` for all three spend policies | consumes all contracts above |

### Pitfalls

1. Raw JS floats for currency: the game reaches `Infinity` after a few prestiges and dies silently. Big-number representation is a day-one requirement, not a late optimization.
2. `costGrowth` outside 1.08-1.15. At 1.05 the player buys hundreds of units per second and the UI cannot keep up; at 1.25 every purchase is a 10-minute wait by generator 5.
3. `tierOutputMul >= tierCostMul`, which makes old generators worthless and collapses the game to "always buy the newest".
4. No x10/x100/max buy modes — late game becomes hundreds of taps and players quit at exactly the moment the numbers get interesting.
5. Offline accrual simulated tick-by-tick: a multi-second freeze on resume. Closed form only.
6. Prestige with no visible explanation of the gain. The confirm panel must show "your next run will be ~6x faster" as a number.
7. Prestige resetting collections, chapters or perks — that is not a fresh start, that is deleted progress.
8. An idle game with a forced session timer or a "run" framing. There is no run; do not instantiate `RunDirector` or `RampDirector` here.
9. Milestones authored as round numbers of currency rather than of *rate* — currency milestones are trivially satisfied by idling, rate milestones require building.
10. Number labels updated every frame: 10 rows x 60Hz of string formatting is a measurable cost for zero benefit. Update on change only.

### Video hook

25-40s clip: 0-5s a single tap producing one coin and the first generator
bought (the loop is legible in 5 seconds), 5-14s three purchases with the
rate/s counter accelerating and a building visibly upgrading, 14-24s the
manager purchase converts tapping into automatic income and the number starts
climbing on its own, 24-33s a milestone flash and the number crossing into
suffix notation (1.2M/s), 33-40s prestige: the screen whites out, everything
resets, and the same first 8 minutes replay in 8 seconds of fast-forward.
Payoff moment: the prestige fast-forward showing 6x speed.

## Family G — table-dice

Shared frame for both G playbooks. Camera: **static-board** — the whole play
surface is on screen at once and never scrolls (the dice-board pans between
board *sections*, which is a tween, not a camera follow). Input: tap primary,
drag for card moves. Director: `LevelDirector` (`core/level.ts`) — deals and
board chapters both express as a goal set plus a budget (moves for solitaire,
dice for the board). Slice: `scripts/new-game.sh <slug> --family G` scaffolds
`src/slices/table/game.ts`. Gate: `npm run sim -- --family G`
(`src/sim/families/table.ts`) — deal solvability for solitaire, roll and
reward distribution for the dice-board.

Both playbooks share one property that makes them unusually good business:
**the core loop is 40 years old and needs no teaching**, so the entire build
budget goes into the meta layer. Family G is where the meta-kit does the most
work of anywhere in this file.

## G1. Dice-board

Roll, move, resolve the tile you land on, build the board's landmarks with the
cash, collect stickers, move to the next board. The `Monopoly GO` shape.

**Market signal, and the reason this playbook exists:** `Monopoly GO` monetizes
at **$27-43 of IAP per install** — one to two orders of magnitude above a
typical casual title. The dice loop itself is trivial (a random walk with tile
events); *all* of that value sits in the meta layer — collections (sticker
sets), landmark building, and the roll-energy economy. Treat the dice as the
delivery mechanism for the meta, never as the game. If a pitch wants this
playbook without the collection album and the landmark build, redirect it: the
core loop alone is a slot machine with no retention.

### Core loop and run shape

**Core loop:** spend a die from a regenerating pool, watch the token walk 1-6
tiles, resolve a tile event (cash, tax, chance, sticker pack, mini-game), spend
banked cash on the current landmark, watch the board visibly build, and repeat
until the dice pool empties.

| Session time | Beat |
| --- | --- |
| 0:00-0:20 | Resume: offline dice accrual popup ("+18 dice"), the current landmark's completion bar, and the active sticker set shown. |
| 0:20-1:30 | 12-20 single rolls at multiplier x1. Cash accumulates; 2-3 tile events fire; the first sticker pack drops. |
| 1:30-3:30 | The player unlocks the multiplier (x2-x10) and switches to fewer, bigger rolls — the same dice pool now resolves in a third of the taps with 10x the stakes. |
| 3:30-6:00 | First landmark completes: a build animation upgrades the board art, the landmark grants a permanent cash bonus, and the next landmark's cost appears at ~2.4x. |
| 6:00-8:00 | Sticker album opened, a set completes, a duplicate is traded; the second landmark is 60% funded. |
| 8:00-9:00 | Dice pool empties -> soft stop: dice timer, next-landmark preview, album progress. |
| on board complete | All 5-6 landmarks built -> board chapter completes (`LevelDirector` goal set met), 1-3 stars by dice spent, next board unlocks with fresh art and higher stakes. |

Session: one continuous 5-10 min block bounded by the dice pool.

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Tap roll | Spend `multiplier` dice, roll, walk the token, resolve the tile | `Controls.onTap` -> `dice.roll(state, rng, multiplier)` |
| Hold roll (350ms) | Auto-roll while held, one roll per 900ms, stopping on any event that needs a choice | `Controls.onHoldStart/onHoldEnd` |
| Tap multiplier control | Cycle x1 / x2 / x5 / x10 (each unlocked by board progress) | `Controls.onTap` |
| Tap landmark | Open the build panel; drag/tap to invest cash in fixed chunks | `Controls.onTap` -> `landmark.invest(state, amount)` |
| Tap album | Open the sticker album, tap a duplicate to offer it for trade | meta-kit `core/collections.ts` |
| Tap tile event card | Resolve a choice event (take cash now vs gamble for 4x) | `ui/cards.ts` |

### Systems required

| Module | Use |
| --- | --- |
| `core/level.ts` (`LevelDirector`) | board chapter: goal set = all landmarks built (+ optional "collect set N"), budget = dice spent for the star rating, no fail state; `progress` = landmarks funded fraction |
| `core/rng.ts` | `Rng` — every roll, tile event and sticker pack draws from a seeded stream; the gate replays exact sequences to verify the reward distribution |
| `core/economy.ts` | dice regeneration with an offline cap, landmark cost curve, cash reward curve, multiplier scaling — the same exponential machinery as `F1`, applied to three dimensions instead of ten |
| `core/progression.ts` | `MetaSave`: cash, dice, dice timestamp, landmark funding, board index, album state, stars |
| `core/pool.ts` | `SpritePool` for tile-event popups, coin bursts (200), sticker shine FX |
| `core/juice.ts` | dice tumble, token hop per tile, cash count-up, landmark build shake, sticker-pack reveal |
| meta-kit `core/collections.ts` | **the load-bearing component**: sticker album (4-6 sets of 9), duplicates, trades, set-completion rewards, seasonal album rotation |
| meta-kit decor/renovation tasks (slice scene) | landmark building — the board's visible progress and the cash sink |
| meta-kit `ui/sagaMap.ts` | board map: one node per board, star gates between them |
| meta-kit `ui/boosterBar.ts` | dice packs, x2 cash for 10 rolls, shield (blocks the next tax tile) |
| `ui/hud.ts`, `ui/bars.ts` | cash header, dice counter, landmark funding bar, album progress |
| `ui/cards.ts` | tile-event cards, landmark build panel, sticker-pack reveal, offline-dice panel |
| NEW: needs `data/boards.ts` | `BoardSpec[]`: `{ id, name, tiles: TileSpec[], landmarks: Array<{ id, cost, bonusPct }>, cashScale: number, stickerSetId: string }` — 3-6 boards. |
| NEW: needs `data/tiles.ts` | `TileSpec[]`: `{ kind: 'cash' \| 'tax' \| 'chance' \| 'stickerPack' \| 'landmarkFund' \| 'miniGame' \| 'jail' \| 'bonusRoll', weight, payoutMul }` — 8-12 tile kinds across 24 board positions. |
| NEW: needs `objects/boardToken.ts` | Token walker: hops N tiles with per-hop easing and a camera pan between board sections. Spec: `class BoardToken { walk(steps: number): Promise<number> }` returning the landed tile index. |

### Content volume

| Item | Minimum | Comfortable |
| --- | --- | --- |
| Boards | 3 | 6 |
| Tiles per board | 20 | 24-40 |
| Tile event kinds | 6 | 10 |
| Landmarks per board | 4 | 6 |
| Sticker sets per album | 4 | 6 (9 stickers each = 54) |
| Mini-games on tiles | 1 | 3 |
| Boosters | 2 | 4 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `board.tiles` | 24 | 20-40 | count | 24 = 4 sections of 6, one section per portrait screen |
| `dice.max` | 40 | 25-60 | dice | pool cap |
| `dice.regenMs` | 360000 | 240000-600000 | ms/die | 6 min per die: a full pool in 4 hours |
| `dice.offlineCapHours` | 4 | 2-8 | hours | same rule as `F1` |
| `dice.sessionSpend` | 34 | 25-50 | dice | what a 5-10 min session actually spends |
| `roll.faces` | 6 | 6 | faces | a plain d6; weighting the die is detectable and destroys trust |
| `roll.walkMsPerTile` | 260 | 180-360 | ms | hop animation; 6 tiles = 1.56s, the loop's rhythm |
| `multipliers` | 1 / 2 / 5 / 10 | — | — | unlocked at landmark 1 / board 2 / board 3 |
| `multiplier.diceCost` | = multiplier | — | dice | x5 costs 5 dice and pays 5x — strictly linear, or the pool becomes a trap |
| `tile.cashBase` | 220 | 120-400 | cash | scaled by `board.cashScale` |
| `tile.taxPct` | 0.08 | 0.04-0.15 | fraction of banked cash | never more than 15%, or players stop banking |
| `tile.stickerPackRate` | 0.10 | 0.06-0.16 | per landed tile | ~3 packs per session |
| `tile.bonusRollRate` | 0.08 | 0.05-0.12 | per landed tile | free-roll tiles are the loop's pacing gift |
| `landmark.cost1` | 3600 | 2000-6000 | cash | ~16 rolls of average payout |
| `landmark.costGrowth` | 2.4 | 2.0-3.0 | multiplier per landmark | |
| `landmark.bonusPct` | 0.12 | 0.08-0.2 | fraction | permanent cash-payout bonus per built landmark |
| `board.cashScale` | 3.5 | 2.5-5.0 | multiplier per board | board n+1 pays and costs this much more |
| `album.setSize` | 9 | 6-12 | stickers | 9 = a 3x3 page, the readable maximum in portrait |
| `album.duplicateRate` | 0.35 | 0.25-0.5 | fraction | duplicates are the trade economy's fuel, not a bug |
| `album.setReward` | 8 dice + 1 booster | — | — | must be worth ~1 session of dice |
| `entityBudgetLive` | 160 | 120-220 | count | board art + token + popups + coin burst |

### Progression math

Average cash per roll: `E[cash] = tile.cashBase * sum(weight_k * payoutMul_k) *
(1 + landmarksBuilt * 0.12) * board.cashScale`. With the default tile table
(cash 40%, landmarkFund 15%, chance 12%, tax 10%, stickerPack 10%, bonusRoll
8%, miniGame 5%) the expected payout is `~1.02 * tile.cashBase` = ~225 cash per
roll at board 1 with no landmarks.

| Landmark | Cost | Rolls to fund (cumulative) | Session number | Payout bonus after |
| --- | --- | --- | --- | --- |
| 1 | 3600 | 16 | 1 | +12% |
| 2 | 8640 | 34 (50) | 2 | +24% |
| 3 | 20736 | 74 (124) | 3-4 | +36% |
| 4 | 49766 | 160 (284) | 6-8 | +48% |
| 5 | 119439 | 346 (630) | 12-18 | +60% |
| 6 | 286654 | 748 (1378) | 25-40 | board complete |

At `dice.sessionSpend = 34` rolls per session, a 6-landmark board is ~40
sessions ≈ 2-3 weeks of daily play — the correct pace for a board that must
carry a sticker season. The gate asserts this: `npm run sim -- --family G`
rolls 100k seeded dice and checks that the measured rolls-to-complete per board
lands within 20% of the table, that no tile kind's realized frequency deviates
more than 2% from its weight, and that the expected value of a x10 roll equals
10x a x1 roll (linearity — the single most trust-critical number in the game).

Star rating per board chapter: 3 stars if completed in <= 0.85x the table's
roll count, 2 at <= 1.15x, 1 on completion.

### Meta progression

This is the playbook where the meta *is* the product; the PRD must specify all
four components below, not a subset.

| Meta-kit component | Wiring | Numbers |
| --- | --- | --- |
| `core/collections.ts` sticker album | 4-6 sets x 9 stickers, packs from tiles and set rewards; duplicates tradable | pack = 3 stickers, 35% duplicate rate; set reward = 8 dice + 1 booster; full album = a cosmetic board skin + 40 dice |
| decor/renovation tasks (landmarks) | cash sink + visible board progress + permanent payout bonus | 4-6 per board, `cost(n) = 3600 * 2.4^(n-1)`, +12% payout each |
| `ui/sagaMap.ts` | board map, one node per board | gate = 2 stars from the previous board |
| `core/collections.ts` streaks/daily | daily dice bonus, 7-day login streak, one daily "roll 20 times" goal | day 7 = 20 dice |
| `core/collections.ts` reward track | 30 tiers fed by rolls spent (not cash — cash inflates across boards) | 1 tier per 12 rolls |
| `ui/boosterBar.ts` | dice pack (+15), x2 cash for 10 rolls, tax shield | earned from goals and set completions |
| Prestige-equivalent | none. Boards replace prestige: each new board is a 3.5x-scaled restart with the album carried over. | |

### Build variety

A random walk has no builds, so variety must come from **spend policy** across
the three resources (dice, cash, stickers). Three policies the economy must
keep within 20% of each other in rolls-to-complete-board: (1) *multiplier
masher* — always rolls at the highest unlocked multiplier, fastest wall-clock,
highest variance, most likely to eat a tax at x10; (2) *x1 grinder* — rolls at
x1 for maximum tile events and sticker packs per die, slowest cash but the best
album progress; (3) *landmark rusher* — banks nothing, invests every coin
immediately to compound the +12% bonuses earliest. The linearity requirement
(`multiplier.diceCost == multiplier`) is what keeps (1) and (2) both rational;
the moment a x10 roll pays more or less than 10 x1 rolls, one policy dies and
the other becomes mandatory.

### Portrait UI plan

- y 140-240: cash header (56px digits with count-up) + dice counter with the
  regen timer (right, 44px) + album button (left, 88x88px).
- y 240-300: landmark funding bar (`Bar`, 640x28px) with the current landmark's
  name and cost — permanently visible, because it is the reason to keep rolling.
- y 300-1020: the board section in view: 6 tiles as a 2x3 or L arrangement of
  200x200px tiles with the landmark art behind them. The token walk pans this
  view between sections with a 400ms tween, never a free camera.
- y 1020-1160: the roll button — 400x120px, centered, the largest touch target
  in the game, with the multiplier control as a 200x120px segmented control at
  its right.
- y 1160-1280 (`SAFE` bottom): boosters (3 x 100x100px) and the reward-track pip
  strip.
- Tile-event card: 560x420px centered at y 420-840, auto-dismissing after 1.2s
  unless it requires a choice — the loop must not need two taps per roll.
- Sticker-pack reveal: full-screen overlay, 3 cards flipping in sequence at
  260ms each; the only place in the game where a 1s+ animation is justified.

### Performance plan

Peak live ≈ 160 objects: 6-8 visible tiles with art, the token, 200-particle
coin pool, event popups, landmark build FX. Board art per section is one atlas
frame, not a composed tilemap. The two real costs are (1) the **pan tween**,
which must move a single container rather than 24 tile objects, and (2) the
**sticker album**, which is a 54-slot scroll view — build it with a pooled
3x3 page window, not 54 live sprites, or opening the album stalls for 200ms.
Dice regeneration is closed-form at resume like `F1`'s offline accrual, never a
tick loop. Auto-roll at one roll per 900ms must reuse the same tween timeline
each roll; allocating a new timeline per roll leaks across a 40-roll session.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Roll + tile resolution | dice pool, seeded roll, tile-event table, payout math | `function roll(state: BoardState, rng: Rng, multiplier: number): { landedTile: number; events: TileEvent[]; cashDelta: number }` |
| Board content | `data/boards.ts` (6), `data/tiles.ts` (10 kinds), landmark curves, cash scales | `interface BoardSpec { id: string; tiles: TileSpec[]; landmarks: Array<{ id: string; cost: number; bonusPct: number }>; cashScale: number; stickerSetId: string }` |
| Economy + persistence | `core/economy.ts` wiring: dice regen + offline cap, landmark investment, cash curves, save schema | `function accrueDice(save: MetaSave, nowMs: number): number` |
| Collections meta | album, packs, duplicates, trades, set rewards, reward track | `function openPack(rng: Rng, setId: string): Array<{ stickerId: string; duplicate: boolean }>` |
| View + juice | `objects/boardToken.ts`, pan tween, coin burst, landmark build animation, pack reveal | `function walkAndResolve(steps: number): Promise<TileEvent[]>` |
| Balance (integrator) | tile weights, landmark curve, dice budget, multiplier linearity; runs `npm run sim -- --family G` | consumes all contracts above |

### Pitfalls

1. Shipping the dice loop without the album and landmarks. The core loop is a random walk; the meta is the entire product. This is the one pitfall that kills the pitch.
2. Non-linear multipliers (x10 costs 10 dice but pays 8.5x). Players compute this within a day and trust never returns. Assert linearity in the gate.
3. A weighted die. Detectable, and the genre's audience does detect it. Weight the *tile table*, never the die.
4. Tax tiles above 15% of banked cash: players learn to hold zero cash, which breaks the landmark loop entirely.
5. Two taps per roll (roll, then dismiss an event card). Auto-dismiss non-choice events in 1.2s.
6. Dice regen slower than 10 min/die with a cap under 25: the session cannot reach 5 minutes and the mandate fails.
7. 54 live sprites for the album page — a visible stall on open. Pool a 3x3 window.
8. Tick-loop dice accrual on resume (14400 iterations for 4 hours) instead of closed form.
9. New boards that reskin without rescaling `cashScale` — board 2 feels identical to board 1, and the "restart bigger" psychology that replaces prestige never fires.
10. Landmark bonuses that are cosmetic only. Each built landmark must measurably raise payout (+12%), or building is a chore instead of an investment.

### Video hook

25-40s clip: 0-5s a single roll, token hops 4 tiles, coins spray (loop legible
immediately), 5-13s the multiplier flips to x10 and one roll pays a 10x cash
burst with the count-up hitting six digits, 13-24s the landmark funding bar
fills and the landmark builds on screen — the board visibly transforms —
24-33s a sticker pack reveal with three flips and a set completing, 33-40s the
next board unlocks with new art at 3.5x stakes. Payoff moment: the landmark
build transforming the board.

## G2. Solitaire family

One playbook, three variants sharing `core/deck.ts`: **klondike** (7 tableau
columns, 4 foundations, draw-1 or draw-3 stock), **tripeaks** (28-card pyramid,
match ±1 on a waste pile), **spider** (2-suit, 10 columns, build descending
runs). Pick one as the primary and ship the other two as modes only if the
build budget allows; they share every system but each needs its own solver.

**Market signal:** solitaire is the most durable casual category in existence —
Microsoft Solitaire alone holds ~**35M MAU** after three decades, and the
mobile solitaire titles that grew in 2026 did it entirely through meta layers
(daily deals, star tracks, collection events) bolted onto the unchanged 1990
core loop. This playbook is the safest content bet in family G and the one
where meta-kit reuse pays most.

### Core loop and run shape

**Core loop:** scan the tableau for a legal move, prefer the move that reveals a
face-down card, work the stock when the tableau stalls, and clear every card to
the foundations before the stock cycles run out.

| Deal time | Beat |
| --- | --- |
| 0:00-0:06 | Cards deal in with a staggered 24ms-per-card cascade (this animation is the genre's signature; do not skip it) and the goal chips show foundation targets. |
| 0:06-0:25 | The 3-6 obvious opening moves; 2-3 face-down cards flip; the player's read of the deal forms. |
| 0:25-1:00 | The middle game: the first real decision (which column to dig, whether to burn a stock cycle) and the first undo. |
| 1:00-1:50 | The cascade phase: foundations start absorbing runs, each auto-play chaining 3-8 cards with escalating chimes. |
| 1:50-2:10 | Resolution: last card lands, the foundation fireworks fire, stars are awarded by moves and time; or the stock exhausts with no legal move -> fail panel offering undo / extra shuffle / retry. |
| between deals | Saga node or daily-deal calendar, star deposit, reward track: 8-15s. |

Session: 3-6 deals at 60-150s each = 5-10 min.

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Tap card | Auto-move to the best legal destination (foundation first, then the tableau column that unblocks most) — the single most important usability feature in the genre | `Controls.onTap` -> `solitaire.autoMove(state, cardId)` |
| Drag card or run | Manual move with a drop-target highlight; illegal drop springs back in 160ms | `Controls.onDrag` -> `solitaire.move(state, cardId, targetPile)` |
| Tap stock | Deal the next 1 or 3 cards to the waste; tapping an empty stock recycles the waste and consumes a cycle | `Controls.onTap` -> `deck.draw(n)` |
| Tap undo | Revert the last move (bounded stack) | `ui/boosterBar.ts` -> `solitaire.undo(state)` |
| Double-tap card | Send to foundation if legal (redundant with auto-move, but expected by returning players) | `Controls.onTap` within 260ms |
| Hold anywhere (600ms) | Hint: highlight one legal move, preferring the one the solver would take | `Controls.onHoldStart` |

### Systems required

| Module | Use |
| --- | --- |
| `core/level.ts` (`LevelDirector`) | goal set = all cards on foundations; budget = stock cycles (klondike/spider) or stock cards (tripeaks); star thresholds from moves and time vs solver par; `outcome.reason` = `'cleared' \| 'noMoves' \| 'stockExhausted'` |
| `core/deck.ts` | the deck primitive: seeded shuffle, draw/discard/recycle piles, the "every card in exactly one zone" invariant that makes solitaire bugs impossible to hide |
| `core/rng.ts` | `Rng` seeded per deal id; the daily deal seeds from the date so every player gets the identical deal |
| `ui/hand.ts` | the stock/waste fan and the tripeaks waste stack — fanned card row with tap/drag pick-up, reused directly |
| `core/progression.ts` | stars, coins, boosters owned, streaks, per-variant best times |
| `core/pool.ts` | `SpritePool` of 104 card views (covers spider's 2 decks), foundation-fireworks particles (200) |
| `core/juice.ts` | deal cascade, flip, snap, foundation chime ladder, win fireworks |
| meta-kit `ui/sagaMap.ts` | deal ladder: one node per authored deal, chapter gates |
| meta-kit `ui/boosterBar.ts` | undo, extra stock cycle, shuffle tableau, wildcard (tripeaks) |
| meta-kit `core/collections.ts` | **daily-deal calendar** (a monthly badge for a full month of deals), card-back and table-felt albums, reward track, streaks |
| `ui/hud.ts`, `ui/bars.ts` | moves, time, stock cycles remaining, foundation progress |
| `ui/cards.ts` | fail panel, pre-deal booster loadout, variant select |
| NEW: needs `core/solitaire.ts` | Rules engine per variant, Phaser-free: `legalMoves(state)`, `move(state, cardId, pile)`, `autoMove(state, cardId)`, `bestHint(state)`, `isWon(state)`, `isStuck(state)`. One file, three rule tables — not three engines. |
| NEW: needs `core/solitaireSolver.ts` | Deal verifier for the gate and for `data/deals.ts` authoring: `solve(state, budgetNodes: number): { winnable: boolean; moves: number }` — a depth-limited search with transposition pruning; used offline to pre-verify every shipped deal and to compute its par move count. |
| NEW: needs `data/deals.ts` | `DealSpec[]`: `{ id, variant, seed, solverParMoves, difficulty: 1..5 }` — 50+ pre-verified deals per variant. |

### Content volume

| Item | Minimum | Comfortable |
| --- | --- | --- |
| Deals (levels) | 20 | 50+ |
| Variants | 1 | 3 (klondike, tripeaks, spider) |
| Boosters | 2 (undo, extra cycle) | 4 (+ shuffle, + wildcard) |
| Card backs / felts (collection) | 6 | 16 |
| Daily-deal months authored | 1 | 12 (a rolling calendar) |
| Difficulty tiers | 3 | 5 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `deck.cards` | 52 | 52-104 | cards | 104 for spider (2 decks, 2 suits) |
| `klondike.columns` | 7 | 7 | columns | |
| `klondike.drawCount` | 3 | 1-3 | cards | draw-3 is harder and the default for a star economy; draw-1 for the daily deal |
| `klondike.stockCycles` | 3 | 1-999 | cycles | the budget `LevelDirector` adjudicates |
| `tripeaks.pyramidCards` | 28 | 28 | cards | 3 peaks |
| `tripeaks.stockCards` | 23 | 20-26 | cards | the budget for that variant |
| `spider.columns` | 10 | 10 | columns | |
| `spider.suits` | 2 | 1-4 | suits | 4-suit spider is expert-only and fails the win-rate band |
| `card.widthPx` | 96 | 84-112 | px | 7 columns x 96 = 672px, inside the 720 frame with 24px gutters |
| `card.heightPx` | 134 | 118-156 | px | 1.4 ratio |
| `card.faceUpOffsetPx` | 34 | 28-44 | px | vertical stagger of a face-up run; 34 x 12 cards = 408px, the tallest legal column |
| `card.faceDownOffsetPx` | 12 | 10-18 | px | |
| `deal.cascadeMsPerCard` | 24 | 18-36 | ms | 52 cards = 1.25s of deal animation |
| `move.snapMs` | 150 | 110-220 | ms | |
| `move.springBackMs` | 160 | 120-220 | ms | illegal drop |
| `autoPlay.msPerCard` | 90 | 60-140 | ms | the end-of-deal foundation cascade |
| `undo.freePerDeal` | 3 | 2-5 | count | then 40 coins each |
| `hint.holdMs` | 600 | 500-1000 | ms | |
| `solvableRatio` | 0.98 | 0.95-1.00 | fraction of shipped deals | pre-verified by the solver; random klondike is only ~0.80 winnable, which is unacceptable for an authored ladder |
| `stars.moves3` | 1.10 | 1.05-1.2 | x solver par | |
| `stars.moves2` | 1.45 | 1.3-1.6 | x solver par | |
| `entityBudgetLive` | 150 | 120-200 | count | 104 card views + FX |

### Progression math

Par is the solver's move count, so stars are ratios and no hand-tuning is
needed: 3 stars at `moves <= par * 1.10`, 2 at `<= par * 1.45`, 1 on any clear.

Difficulty is authored by **filtering generated deals through the solver**, not
by changing rules: generate seeds, solve them, and bucket by
`solverParMoves / minimumPossibleMoves` and by the search depth needed. A deal
ladder built this way produces a monotonic curve with zero designer guesswork.

| Deal index | Difficulty tier | Solver par (klondike draw-3) | Stock cycles | Target first-try win rate |
| --- | --- | --- | --- | --- |
| 1-5 | 1 | 105-120 | 3 | 96% |
| 6-15 | 2 | 120-140 | 3 | 88% |
| 16-30 | 3 | 140-165 | 2 | 76% |
| 31-45 | 4 | 165-190 | 2 | 64% |
| 46-50+ | 5 | 190-220 | 1 | 52% |

The gate (`npm run sim -- --family G`) re-solves every shipped deal id at build
time, asserts `winnable == true` for >= 98% of them, recomputes
`solverParMoves` (failing on drift), and runs a greedy-player bot — "always
play to foundation, else the move that flips a card, else draw" — to measure
the first-try win-rate band above. A greedy bot is a good model of a casual
player and a bad model of an expert, which is exactly the right calibration
target for this ladder.

### Meta progression

| Meta-kit component | Wiring | Numbers |
| --- | --- | --- |
| `core/collections.ts` daily-deal calendar | one deal per calendar day, seeded from the date; a monthly badge for a full month | badge = a card-back unlock; missed days purchasable for 200 coins |
| `ui/sagaMap.ts` | deal ladder, 10 deals per chapter, star gates | gate = 12 of 30 stars |
| stars (`core/progression.ts`) | 1-3 per deal from moves vs par | |
| `core/collections.ts` albums | card backs and table felts, 6-16, purely cosmetic | 500-4000 coins or badge rewards |
| `core/collections.ts` reward track | 25 tiers fed by stars | 1 tier per 3 stars |
| `core/collections.ts` streaks/daily | login streak + a "clear 3 deals" daily goal | day 7 = 1 of each booster |
| `ui/boosterBar.ts` | undo (3 free, then 40 coins), extra stock cycle (150), shuffle tableau (250), wildcard (300, tripeaks) | max 2 pre-armed |
| decor/renovation tasks | optional; if the pitch wants a themed meta, stars fund a room build exactly as in `B1` | 3-6 stars per task |

Coins: `grantCurrency(25 + stars * 20 + (dealFirstClear ? 40 : 0))`.

### Build variety

Variety is **play-policy variety within a deal**, and the solver proves it:
every shipped deal must have at least 3 distinct winning lines whose first 5
moves differ, and no deal may require a single forced 10-move sequence from the
opening (reject such seeds during authoring). Player policies the gate models:
(1) *greedy-foundation* — always plays to foundation immediately, which
deliberately loses some deals by burying tableau needs; (2) *flip-first* —
prefers any move that reveals a face-down card, the strongest casual heuristic;
(3) *stock-miser* — refuses to cycle the stock until the tableau is fully
stalled. All three must clear tier-1 and tier-2 deals; only *flip-first* should
reliably clear tier-5. If *greedy-foundation* clears tier-5 deals, the ladder is
too easy.

### Portrait UI plan

- y 140-215: score/moves (left), timer (center), stock-cycles-remaining pips
  (right, 3 x 20px dots).
- y 215-260: foundation progress bar (`Bar`, 640x18px) driven by
  `LevelDirector.progress`.
- y 260-420: the foundation row (4 piles at 96x134px, 24px gutters) and the
  stock/waste pair on the right, rendered through `ui/hand.ts` as a 3-card fan.
- y 440-1080: the tableau. 7 columns at 96px with 8px gutters = 728px, so the
  variant either uses 96px cards with a 4px gutter or 88px cards — measure it,
  because a clipped 7th column is the genre's most common portrait bug. Face-up
  runs stagger 34px, allowing a 12-card column (408px) inside the 640px band.
- y 1080-1200: booster bar (4 x 100x100px) plus the undo button, which gets its
  own oversized 140x100px target because it is pressed constantly.
- y 1200-1280: `SAFE` bottom, panel slide-in region.
- Drag ghost lifts the card 30px with a 1.06x scale and a soft shadow; legal
  drop targets get a 4px glow outline. Tap-to-auto-move must be the default
  interaction, with drag as the power-user path.

### Performance plan

Peak live ≈ 150 objects (up to 104 card containers, each a back sprite + face
sprite + rank/suit text, plus FX). Cards are a fixed pool of 104 built at boot
and re-labelled per deal — never created per deal. Card faces are one atlas of
52 frames; rendering rank/suit as separate text objects triples the draw calls
and is the standard performance mistake here. The deal cascade and the
end-of-deal auto-play both use a single staggered timeline, not 52 tweens. The
solver is build-time and gate-time only and must never run in the client on the
main thread; the in-game hint uses `bestHint` (a 1-ply lookahead over
`legalMoves`), not the solver.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Rules engine | `core/solitaire.ts` for all three variants on top of `core/deck.ts` | `function legalMoves(state: SolitaireState): Move[]`, `function move(state: SolitaireState, cardId: string, pile: PileId): { ok: boolean; flipped?: string[] }`, `function isStuck(state: SolitaireState): boolean` |
| Solver + deal authoring | `core/solitaireSolver.ts`, `data/deals.ts` (50+ verified deals per variant), difficulty bucketing | `function solve(state: SolitaireState, budgetNodes: number): { winnable: boolean; moves: number }` |
| Card view + juice | pooled card views, deal cascade, drag ghost, foundation chime ladder, win fireworks | `function dealCascade(order: string[]): Promise<void>` and `function autoPlayToFoundations(): Promise<number>` |
| Meta / UI | daily-deal calendar, saga ladder, booster bar, album, fail panel | `function onDealEnd(outcome: { won: boolean; reason: string }, moves: number, par: number): Promise<'retry' \| 'map'>` |
| Balance (integrator) | difficulty tiers, star ratios, cycle budgets; runs `npm run sim -- --family G` (re-solve every deal + 3 policy bots) | consumes all contracts above |

### Pitfalls

1. Shipping random deals. ~20% of random klondike deals are unwinnable; players read that as a broken game. Every shipped deal is solver-verified.
2. No tap-to-auto-move. Requiring a drag for every card makes a 120-move deal exhausting on a phone.
3. Rank/suit as text objects per card — 104 cards x 2 text objects is 200+ extra draw calls. Use a 52-frame atlas.
4. Running the solver client-side for hints; a depth-limited klondike search stalls the main thread for seconds. Hints use 1-ply `bestHint`.
5. Stars from raw move counts instead of solver-par ratios, which makes easy deals unstarrable and hard deals free.
6. Seven 96px columns plus gutters exceeding 720px, clipping the last column. Measure the tableau width against `SAFE` before authoring art.
7. Face-up stagger below 28px: a 10-card run becomes unreadable; above 44px it overflows the tableau band.
8. Unlimited free undo, which turns a deal into a solved-by-brute-force exercise. 3 free, then priced.
9. Skipping the deal cascade animation to "save time" — that 1.25s is the genre's most recognizable signature and its perceived-quality anchor.
10. Four-suit spider or draw-1 klondike as the default. Both break the win-rate bands: draw-1 is too easy for stars, 4-suit spider too hard for a casual ladder.

### Video hook

20-35s clip: 0-4s the deal cascade snapping 52 cards into place (instant
recognition), 4-12s three tap-to-move plays, each flipping a face-down card
with a clean snap, 12-22s a stalled tableau resolved by one stock draw that
unlocks a 6-card run, 22-30s the endgame auto-play cascade sending 20+ cards to
the foundations in a rising chime ladder with fireworks, 30-35s three stars and
the daily-deal calendar stamping today's date. Payoff moment: the auto-play
cascade to the foundations.

## Family H — word-trivia

One playbook covering three shapes that share a single director, camera and
content pipeline: **word-connect** (letter wheel, drag to spell), **crossword-
lite** (small grid filled from a letter bank) and **trivia quiz** (multiple
choice from a generated question bank). Director: `LevelDirector`
(`core/level.ts`) — every shape is a goal set (find all words / fill all cells
/ answer N questions) with a budget (hints, time, or lives). Camera:
static-board. Input: tap + drag-connect. Slice:
`scripts/new-game.sh <slug> --family H` scaffolds `src/slices/word/game.ts`;
the gate is `npm run sim -- --family H` (`src/sim/families/word.ts`), which
validates the wordlist and the answer keys — for this family the gate is a
**content-correctness** gate, not a balance gate, and it is the difference
between a shippable word game and an embarrassing one.

Word and trivia are the cheapest content-per-hour genres in this file: a
validated wordlist plus a generated question bank yields hundreds of puzzles
for no art budget at all. That is the entire reason to pick this family.

## H1. Word-connect, crossword-lite and trivia

### Core loop and run shape

**Core loop (word):** read the letter set, drag a path through letters to spell
a word, watch it lock into the answer grid, chase the bonus words the grid does
not show, and finish the grid before spending hints.

**Core loop (trivia):** read the question, answer inside the timer, keep the
streak multiplier alive, and clear the round's category before running out of
lives.

| Puzzle time | Beat (word) | Beat (trivia) |
| --- | --- | --- |
| 0:00-0:05 | Letter wheel spins in; the answer grid shows empty slots with lengths — the puzzle's shape is fully legible before the first input. | Category card flips in with the round's 10 questions and 3 lives shown. |
| 0:05-0:20 | The 2-3 obvious short words; each lock plays a rising chime and reveals crossing letters. | Q1-Q2: easy tier, 100% expected; the streak multiplier reaches x2. |
| 0:20-0:50 | The middle: the player has the letters but not the word; the shuffle button gets pressed; the first bonus word appears. | Q3-Q6: medium tier; first wrong answer costs a life and resets the streak. |
| 0:50-1:20 | The long word (all letters used) unlocks and cascades 2-3 crossings with it — the puzzle's payoff. | Q7-Q10: hard tier, 15s each; the last question is worth 3x with the streak. |
| 1:20-1:30 | Resolution: grid complete, stars by hints used, bonus-word coins; or hints exhausted -> hint offer / retry. | Round score, accuracy, category badge, next category. |
| between puzzles | Saga node advance, star deposit, reward track: 8-15s. | Category map, badge progress: 8-15s. |

Session: 5-12 puzzles or rounds at 30-90s each = 5-10 min.

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Drag across letters (word) | Trace a path; letters highlight, a rubber-band line follows the finger, release submits | `Controls.onDrag` -> `word.trace(state, letterIndices)` |
| Tap letter (word, accessibility path) | Append that letter to the current guess; tap the submit chip to confirm | `Controls.onTap` |
| Tap shuffle | Re-arrange the wheel; free and unlimited (it changes nothing but perception, and blocking it only frustrates) | `Controls.onTap` |
| Tap grid slot (crossword-lite) | Focus that answer; the letter bank fills it left-to-right | `Controls.onTap` |
| Tap answer card (trivia) | Submit; 200ms lockout prevents double-submits, then correct/incorrect reveal | `Controls.onTap` -> `quiz.answer(state, index)` |
| Tap hint | Reveal one letter (word) or eliminate two wrong answers (trivia) | `ui/boosterBar.ts` |
| Hold letter (500ms) | Peek: highlight every grid slot whose first letter matches | `Controls.onHoldStart` |

### Systems required

| Module | Use |
| --- | --- |
| `core/level.ts` (`LevelDirector`) | word: goal set = all grid answers found, budget = hints (soft) and no time limit; trivia: goal set = N correct, budget = 3 lives + per-question timer; `outcome.reason` = `'solved' \| 'outOfLives' \| 'timeout'` |
| `core/controls.ts` | `onDrag` for the trace, `onTap` for letters/answers, `onHoldStart` for peek |
| `core/rng.ts` | seeded puzzle order, wheel arrangement, distractor shuffling; the daily puzzle seeds from the date |
| `core/progression.ts` | stars, coins, hints owned, category badges, streaks, best accuracy |
| `core/pool.ts` | `SpritePool` for letter tiles (24), grid cells (120), particle FX (120) |
| `core/juice.ts` | letter-lock chime ladder, word-slam into the grid, bonus-word coin pop, correct/incorrect flash, streak-multiplier scale pulse |
| meta-kit `ui/sagaMap.ts` | puzzle ladder (word) or category map (trivia), chapter gates |
| meta-kit `core/collections.ts` | daily puzzle + login streak, category badges, reward track, bonus-word "dictionary" album |
| meta-kit `ui/boosterBar.ts` | reveal-letter, reveal-word, 50/50 (trivia), skip-question, +15s |
| `ui/hud.ts`, `ui/bars.ts` | hint counter, bonus-word coin jar, lives, question timer bar, streak multiplier |
| `ui/cards.ts` | answer cards (trivia), puzzle-complete panel, category select |
| NEW: needs `data/wordlist.ts` | The validated dictionary: a sorted, deduplicated, lowercase ASCII word set (30k-60k entries for English), shipped as a compact string blob with a prefix index, plus a curated `ANSWERS` subset (8k-15k common words) used for puzzle *authoring* — a puzzle answer must come from `ANSWERS`, while a bonus word only needs to be in the dictionary. |
| NEW: needs `core/wordgen.ts` | Puzzle generator: `generateWordPuzzle(rng: Rng, letters: number): { letters: string[]; answers: string[]; bonus: string[] }` — pick a 6-7 letter anchor from `ANSWERS`, enumerate every sub-word from its letter multiset, keep those in `ANSWERS` as grid answers (5-12) and those only in the dictionary as bonus words. |
| NEW: needs `data/questions.ts` | The trivia bank: `QuestionSpec[]`: `{ id, category, tier: 1 \| 2 \| 3, prompt, answer, distractors: [string, string, string], source }` — 100+ minimum, 400+ comfortable, LLM-generated at authoring time and validated by the gate (never generated at runtime). |
| NEW: needs `objects/letterWheel.ts` | Wheel view: N letter tiles on a circle, trace line, path highlight, shuffle tween. Spec: `class LetterWheel { setLetters(l: string[]): void; onTrace(cb: (indices: number[]) => void): void; shuffle(): Promise<void> }`. |

### Content volume

| Item | Minimum | Comfortable |
| --- | --- | --- |
| Puzzles (word/crossword levels) | 20 | 50+ (generated, then frozen by id) |
| Dictionary entries | 30000 | 60000 |
| Curated answer words | 8000 | 15000 |
| Trivia questions | 100 | 400+ |
| Trivia categories | 4 | 8 |
| Difficulty tiers (trivia) | 3 | 3 |
| Boosters | 2 | 4 |
| Daily puzzles authored ahead | 30 | 90 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `wheel.letters` | 6 | 4-7 | letters | 7 letters is the practical ceiling: sub-word count explodes past 200 |
| `puzzle.gridAnswers` | 8 | 5-12 | words | answers shown as empty slots |
| `puzzle.minAnswerLen` | 3 | 3-4 | letters | |
| `puzzle.bonusWords` | 14 | 6-30 | words | in-dictionary but off-grid; the completionist hook |
| `grid.cellPx` | 76 | 64-88 | px | 8 columns x 76 = 608px inside `SAFE` |
| `wheel.radiusPx` | 190 | 160-220 | px | 6 tiles of 104px on a 380px circle |
| `wheel.tilePx` | 104 | 92-120 | px | drag targets must be generous |
| `trace.snapPx` | 58 | 48-72 | px | radius within which the trace snaps to a tile |
| `lock.ms` | 260 | 200-360 | ms | word slamming into the grid |
| `shuffle.ms` | 320 | 240-450 | ms | |
| `hint.revealLetterCost` | 25 | 15-40 | coins | |
| `hint.revealWordCost` | 90 | 60-140 | coins | |
| `bonusWord.coins` | 5 | 3-10 | coins | the self-funding hint economy: ~14 bonus words = 70 coins ≈ 3 letter hints |
| `quiz.questionsPerRound` | 10 | 6-12 | questions | |
| `quiz.timerMs.tier1` | 20000 | 15000-25000 | ms | |
| `quiz.timerMs.tier3` | 15000 | 10000-20000 | ms | harder questions get *less* time, not more |
| `quiz.lives` | 3 | 2-5 | lives | |
| `quiz.streakMulStep` | 0.5 | 0.25-1.0 | multiplier per consecutive correct | capped at x3 |
| `quiz.basePoints` | 100 | 50-200 | points | x tier x streak multiplier |
| `quiz.tierMix` | 4/4/2 | — | questions per round (t1/t2/t3) | the round's difficulty shape |
| `quiz.answerLockoutMs` | 200 | 150-350 | ms | prevents double-submit |
| `quiz.revealMs` | 900 | 700-1400 | ms | correct/incorrect reveal before the next question |
| `stars.hints3` | 0 | 0-1 | hints used | 3 stars for a no-hint solve |
| `stars.hints2` | 2 | 1-3 | hints used | |
| `entityBudgetLive` | 140 | 100-180 | count | wheel + grid cells + FX |

### Progression math

**Word difficulty** is a two-dimensional dial, both computable from the
generator: letter count and the *answer-density ratio*
`gridAnswers / totalSubWords`. A 6-letter anchor with 40 legal sub-words and 8
grid answers has density 0.20 — easy, because most guesses hit something. Push
density to 0.45 and the same wheel feels twice as hard.

| Puzzle index | Wheel letters | Grid answers | Density | Longest answer | Target first-try solve rate |
| --- | --- | --- | --- | --- | --- |
| 1-5 | 4 | 5 | 0.16 | 4 | 97% |
| 6-15 | 5 | 6 | 0.20 | 5 | 90% |
| 16-30 | 6 | 8 | 0.26 | 6 | 80% |
| 31-45 | 6 | 10 | 0.34 | 6 | 68% |
| 46-50+ | 7 | 12 | 0.42 | 7 | 56% |

**Trivia scoring:** `points = basePoints * tier * (1 + streak * 0.5)` capped at
x3. A perfect 10-question round with the 4/4/2 tier mix scores
`4*100*1 + 4*100*2 + 2*100*3` before streak, times an average multiplier of
~2.2 with a full streak = `(400 + 800 + 600) * 2.2 = 3960`. One wrong answer in
the middle costs both the life and the multiplier, which is what makes the
streak the real tension rather than the lives.

**Question bank sizing:** a player answering 10 questions per round, 6 rounds
per session, must not see a repeat inside a week of daily play: `10 * 6 * 7 =
420` questions. That is why 400+ is the comfortable volume and 100 is the bare
minimum (repeats after ~2 days). LLM generation makes 400 cheap; validation is
the cost, not authoring.

**The gate is content validation.** `npm run sim -- --family H` must assert:
every grid answer of every shipped puzzle is in `ANSWERS`; every bonus word is
in the dictionary; every puzzle is solvable using only its wheel letters
(multiset containment, no letter reuse beyond multiplicity); no puzzle has zero
bonus words; and for the trivia bank — no duplicate prompts (normalized), no
duplicate answers inside one question's option set, exactly one correct answer,
all four options of comparable length (a distractor 3x shorter than the answer
is a free giveaway), no answer text appearing verbatim in the prompt, and every
question carrying a `source` string. An LLM-generated bank that skips this
validation ships ambiguous or duplicated questions, which is the single fastest
way to lose a trivia audience.

### Meta progression

| Meta-kit component | Wiring | Numbers |
| --- | --- | --- |
| `ui/sagaMap.ts` | word: puzzle ladder, 10 per chapter with a themed name; trivia: category map | gate = 12 of 30 stars |
| stars (`core/progression.ts`) | 1-3 per puzzle by hints used; trivia: by accuracy (100% / >=80% / cleared) | |
| `core/collections.ts` albums | the "dictionary" album — every distinct bonus word ever found, grouped by letter, with a per-letter completion badge | 26 badges; a genuinely cheap collection with real completionist pull |
| `core/collections.ts` badges (trivia) | one badge per category at 80% questions seen and >=85% accuracy | 4-8 badges |
| `core/collections.ts` streaks/daily | daily puzzle seeded from the date + login streak | day 7 = 3 hints |
| `core/collections.ts` reward track | 25 tiers fed by stars | 1 tier per 3 stars |
| `ui/boosterBar.ts` | reveal-letter 25, reveal-word 90, 50/50 60, skip 80, +15s 40 (coins) | funded by bonus words |
| decor/renovation tasks | optional themed meta; identical wiring to `B1` | 3-6 stars per task |

Coins: `grantCurrency(15 + stars * 15 + bonusWordsFound * 5)`.

### Build variety

No builds; the variety axis is **solve-path variety**, and it is a generator
property: (1) a puzzle must be solvable from any starting word — never require
a specific first answer, which the generator guarantees because crossings are
revealed, not required; (2) at least 30% of grid answers must be reachable
without any crossing letter, so a stuck player always has an independent
target; (3) bonus words must exceed grid answers, so exploration is always
rewarded even when the grid stalls. For trivia the equivalent is category
independence: any 3 of the 4+ categories must be sufficient to complete a
chapter, so a player weak on Sports is never blocked. Prove all four properties
in the PRD as generator assertions, verified by the gate.

### Portrait UI plan

- y 140-215: puzzle/round label, coin jar (right), pause (left).
- y 215-250: hint counter chips + star preview (word) or lives and the streak
  multiplier (trivia, multiplier scaling 1.0 -> 1.35 as it climbs).
- y 250-780: the answer grid — up to 8 columns x 6 rows of 76px cells,
  centered; empty slots show length, filled cells show locked letters. Trivia
  replaces this band with the question card (600x360px) plus the timer bar
  (`Bar`, 600x16px) directly under it.
- y 800-1180: the letter wheel (380px circle centered at y 990) with a submit
  chip and a shuffle button flanking it at 120x120px. Trivia replaces this band
  with 4 answer cards at 640x120px stacked with 16px gutters — all four inside
  the thumb arc, which is why trivia works so well on a phone.
- y 1180-1280 (`SAFE` bottom): booster row (4 x 100x100px).
- The trace line renders under the letter tiles at 8px width with a 0.6 alpha
  glow; the current word displays above the wheel at 56px so the player reads
  it without looking away from the finger.

### Performance plan

Peak live ≈ 140 objects (up to 48 grid cells, 7 wheel tiles, 4 answer cards,
FX). Rendering is trivial; the cost is the **dictionary**. Ship it as one
concatenated string blob with a fixed-width or newline layout plus a
first-two-letter prefix index, and do lookups by binary search inside the
prefix range — a `Set` of 60k JS strings costs several MB of heap and a visible
parse stall on boot, on the exact low-end devices this genre attracts. The
generator (`core/wordgen.ts`) runs at authoring time and its output is frozen
into `data/levels.ts` by puzzle id; never enumerate sub-words at runtime (a
7-letter multiset against 60k words is 60k multiset tests per puzzle load).
Trivia questions load as one JSON blob, category-partitioned, and only the
active category's array is kept hot.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Wordlist + generator | `data/wordlist.ts` blob + prefix index, `core/wordgen.ts`, frozen puzzle output | `function lookup(word: string): boolean` and `function generateWordPuzzle(rng: Rng, letters: number): { letters: string[]; answers: string[]; bonus: string[] }` |
| Question bank | `data/questions.ts` (400+ LLM-generated, validated), category and tier balance, `source` strings | `interface QuestionSpec { id: string; category: string; tier: 1 \| 2 \| 3; prompt: string; answer: string; distractors: [string, string, string]; source: string }` |
| Word view | `objects/letterWheel.ts`, trace rendering, grid lock animation, shuffle | `class LetterWheel { setLetters(l: string[]): void; onTrace(cb: (indices: number[]) => void): void; shuffle(): Promise<void> }` |
| Quiz view + rules | question card, answer cards, timer, lives, streak multiplier, reveal flow | `function answer(state: QuizState, index: number): { correct: boolean; points: number; livesLeft: number }` |
| Meta / UI | saga/category map, dictionary album, badges, daily puzzle, booster row | `function onPuzzleEnd(outcome: { won: boolean; reason: string }, hintsUsed: number, bonusFound: number): Promise<'retry' \| 'map'>` |
| Content validation (integrator) | writes and runs the `npm run sim -- --family H` assertions over wordlist, puzzles and question bank | consumes all contracts above |

### Pitfalls

1. An unvalidated wordlist: a rejected word that players know is real generates immediate one-star reviews. The `ANSWERS`/dictionary split (strict for grid answers, permissive for bonus words) is the fix.
2. Loading 60k words into a `Set` at boot — multi-MB heap and a parse stall. String blob plus prefix index.
3. Enumerating sub-words at runtime instead of freezing generator output into level data.
4. LLM-generated questions shipped without validation: duplicate prompts, two defensible answers, or the answer visible in the prompt. All are caught by the gate assertions listed above; none are caught by reading a sample of 20.
5. Distractors of obviously wrong length or register (three short options and one long correct answer) — the bank becomes solvable without knowledge.
6. More time for harder questions. Difficulty should compress time, not extend it, or the round loses rhythm.
7. Blocking or charging for shuffle. It changes nothing mechanically and blocking it only reads as hostile.
8. Trace snapping too tight (< 48px), so words break mid-drag on a moving thumb.
9. Answer cards outside the thumb arc, or above the fold — trivia's entire ergonomic advantage is four large targets in the bottom third.
10. A category the player cannot avoid: chapter gates must be completable with any 3 of 4+ categories.
11. No bonus-word coin economy, which leaves hints purchasable only with hard currency and makes the hint offer feel like a paywall instead of a reward loop.

### Video hook

20-35s clip: 0-4s the wheel spins in and the empty grid shows the puzzle's
shape (instantly legible), 4-12s three quick traces, each word slamming into
the grid with a rising chime and revealing crossing letters, 12-22s a bonus
word pops with coins and the dictionary album stamps a new entry, 22-30s the
7-letter word traced across the whole wheel cascades three crossings and
completes the grid, 30-35s three stars and the daily-puzzle stamp. Payoff
moment: the full-wheel long word completing the grid in one trace.

## Family J — hypercasual

One playbook. Director: `RampDirector` (`core/ramp.ts`) — no win condition, no
levels, one fail state, difficulty as a monotonic function of time or distance.
Camera: side-follow or static-board, depending on the mechanic. Input:
**one finger, one verb**. Slice: `scripts/new-game.sh <slug> --family J`
scaffolds `src/slices/hyper/game.ts`; the gate is
`npm run sim -- --family J` (`src/sim/families/hyper.ts`), a reaction-time bot
that measures the **session-length distribution** — the only number that
matters in this family.

Market position, 2026: hypercasual is still **#1 by downloads (22B)** and its
ad revenue is reviving after the 2023-2024 collapse, but the growth is in
**hybrid-casual, +20-23% YoY — the only growing segment in mobile gaming**. The
formula is explicit: *a mechanic learned in 10 seconds, plus a meta layer*,
which measures at **5-20x the LTV** of a pure hypercasual build. Ship the core
here; then either keep it pure (ad-funded, 10-15 skins) or promote it into
pattern **I** (see below), which is the default recommendation for 2026.

## J1. One-mechanic score chase

### The mechanic menu

Pick exactly **one**. Each row is a complete, proven core; the fail state and
the ramp dial are what make it a game rather than a toy.

| Mechanic | Verb | Fail state | Ramp dial | Camera | Live entities |
| --- | --- | --- | --- | --- | --- |
| Tap-timing | Tap when the moving marker is inside the target band | Miss the band | Band width shrinks, marker speed rises | static-board | 20-40 |
| Stacking | Tap to drop the swinging/sliding block onto the tower | Drop misses the tower footprint | Swing amplitude and speed rise, block width shrinks with each overhang | static-board with an upward pan | 40-80 |
| Swerve | Drag left/right to steer a constantly-advancing avatar | Touch an obstacle | Forward speed and obstacle density rise, gaps narrow | side-follow | 60-120 |
| Rise / drop | Hold to ascend or drop, release to fall, through a scrolling gap field | Touch a wall or a hazard | Scroll speed and gap tightness rise | side-follow | 60-120 |
| io-lite (offline bots) | Drag to move an absorbing/growing avatar around an arena of **bot** opponents | Touched by a bigger bot | Bot count, bot aggression and bot growth rate rise | follow-arena | 80-160 |

**io-lite is explicitly single-player.** Real-time multiplayer is out of scope
for this pipeline (see the red-flag list in the family model); the io *feel* is
delivered by 8-20 offline bots with staggered spawn times, name tags from a
name pool, and a leaderboard rail — which is also how the genre's biggest
titles actually run most of their sessions.

### Twist guidance

**One mechanic plus one or two twists. Never three.** A twist changes the
*decision*, not the presentation.

| Twist class | Example on stacking | Example on swerve |
| --- | --- | --- |
| Resource | Each drop consumes a "precision" charge; perfect drops refund it | Fuel drains, pickups refill |
| Risk-reward | An optional narrow bonus platform pays 3x score | A tighter lane holds the coin line |
| Transformation | Every 10 blocks the tower type changes (wider but heavier) | Every 300m the avatar changes size |
| Combo | Consecutive perfect drops multiply score up to x5 | Consecutive near-misses multiply score |

Pick from **different classes** — two risk-reward twists read as one twist. The
combo twist is the strongest default because it converts skill directly into
score variance, which is what a score chase needs.

### Core loop and run shape

**Core loop:** perform the one verb, survive the ramp, keep the combo alive for
score, die to a single mistake, and retry in under a second because the retry
button is already under the thumb.

| Run time | Beat |
| --- | --- |
| 0:00-0:03 | No tutorial, no menu. The run is already moving and the first input opportunity arrives inside 2s. The verb must be self-evident from one frame of motion. |
| 0:03-0:15 | Ramp step 0-1. Free success; the combo multiplier reaches x2; the twist's first decision appears (a bonus platform, a coin lane). |
| 0:15-0:45 | Ramp steps 2-4. The mechanic's parameters tighten by ~40%; the median player dies somewhere in this window. |
| 0:45-1:30 | Ramp steps 5-7. Near the cap; only pattern reading and rhythm survive; personal bests happen here. |
| 1:30+ | Cap phase: parameters flat at the readability limit, score rate rising via the combo only. A run past 3 minutes should be rare (p95). |
| on death | 250ms freeze on the mistake (the player must *see* what killed them), score count-up against the personal-best line, one revive offer, retry. **Tap-to-tap under 2s, target 900ms.** |

Session: 5-15 runs at 30-120s = 5-10 min. Median run **45-75s**.

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Tap | The verb, for tap-timing and stacking | `Controls.onTap` |
| Drag (horizontal) | The verb, for swerve and io-lite | `Controls.onDrag` -> `controls.axisX` |
| Hold / release | The verb, for rise-drop | `Controls.onHoldStart/onHoldEnd` |
| — | There is no second input. A hypercasual game with two verbs is a casual game with a hypercasual art budget. | |

### Systems required

| Module | Use |
| --- | --- |
| `core/ramp.ts` (`RampDirector`) | the entire session: monotonic difficulty steps, no win condition, single fail state; `progress` = current ramp step for the HUD pips; `outcome.reason` = the specific mistake (`'miss' \| 'hit' \| 'eaten'`) so the death panel can name it |
| `core/controls.ts` | exactly one of `onTap` / `onDrag` / `onHoldStart` |
| `core/pool.ts` | `SpritePool` per spawned type; a hypercasual loop with 15 runs per session must allocate nothing after boot |
| `core/spatial.ts` | `SpatialHash` for io-lite only (80-160 entities); the other four mechanics use index or AABB math |
| `core/juice.ts` | **the highest-leverage module in this playbook**: hitstop on every success, scale punch, screen shake, particle burst, chromatic flash on the combo, death freeze. Hypercasual quality *is* juice quality |
| `core/rng.ts` | seeded spawn stream; the daily challenge uses a fixed seed so scores compare |
| `core/progression.ts` | best score, coins, skin unlocks, mission progress |
| meta-kit `core/collections.ts` | skin album (10-15), 3 rotating missions, reward track, login streak |
| meta-kit `ui/boosterBar.ts` | pre-run: head start, x2 score, one shield |
| `ui/hud.ts`, `ui/bars.ts` | score (large), combo multiplier, ramp pips, personal-best marker |
| `ui/cards.ts` | death panel with the retry target, skin select, mission list |
| `ui/sagaMap.ts` | **not used** — there are no levels. The reward track replaces it. |
| NEW: needs `data/rampSteps.ts` | `RampStep[]`: `{ at: number; params: Record<string, number>; poolTags: string[] }` — the mechanic's parameter values per step, authored as data so the balance pass never edits code. |
| NEW: needs `objects/<mechanic>.ts` | One file implementing the chosen verb and its fail test. Spec (stacking example): `class Stacker { drop(): { landed: boolean; overhangPx: number; perfect: boolean }; get towerWidthPx(): number }`. |

### Content volume

| Item | Minimum | Comfortable |
| --- | --- | --- |
| Mechanics | 1 | 1 (never 2) |
| Twists | 1 | 2 (from different classes) |
| Ramp steps | 6 | 10 |
| Spawn/obstacle variants | 4 | 8 |
| Skins (the collection) | 10 | 15 |
| Palette/environment sets | 2 | 4 |
| Missions in the rotating pool | 9 | 18 |
| Bot name pool (io-lite) | 40 | 120 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `run.medianTargetS` | 60 | 45-75 | s | **the specification**; the gate asserts it |
| `run.p95TargetS` | 165 | 120-210 | s | long runs must exist but stay rare |
| `run.firstInputByMs` | 2000 | 1200-2500 | ms | time from scene start to the first meaningful input |
| `retry.latencyMs` | 900 | 600-2000 | ms | tap-to-tap; above 2000 the session collapses |
| `death.freezeMs` | 250 | 180-400 | ms | the player must see the mistake |
| `ramp.steps` | 8 | 6-12 | steps | |
| `ramp.stepS` | 8 | 6-12 | s | one step per 8s of survival |
| `ramp.paramDeltaPerStep` | 0.09 | 0.06-0.14 | fraction | each step tightens the mechanic's key parameter by this much |
| `ramp.capAtStep` | 8 | 6-12 | step | parameters freeze here; only score rate rises after |
| `combo.mulStep` | 0.5 | 0.25-1.0 | multiplier per success | |
| `combo.mulCap` | 5 | 3-8 | multiplier | |
| `combo.breakOn` | 1 | 1 | failure | any miss resets the combo (but not always the run) |
| `score.perSuccess` | 10 | 5-25 | points | x combo multiplier |
| `input.latencyBudgetMs` | 50 | 32-66 | ms | input-to-visible-response; above 66ms the game reads as broken |
| `success.hitstopMs` | 45 | 30-70 | ms | on every success, not just big ones |
| `perfect.windowPct` | 0.12 | 0.08-0.2 | fraction of the target band | the "perfect" sub-window that feeds the combo |
| `skins.count` | 12 | 10-15 | skins | cosmetic only, no stats, ever |
| `skin.cost` | 400 | 200-2500 | coins | |
| `revive.perRun` | 1 | 0-1 | count | ad or 200 coins |
| `entityBudgetLive` | 120 | 20-160 | count | mechanic-dependent (see the menu table) |

### Progression math

The mechanic's key parameter tightens geometrically and then caps:
`param(s) = param0 * (1 - 0.09)^min(s, capAtStep)`. For stacking with a 220px
starting block:

| Ramp step | At | Block width (px) | Swing period (ms) | Expected survival to next step |
| --- | --- | --- | --- | --- |
| 0 | 0-8s | 220 | 1800 | 99% |
| 1 | 8-16s | 200 | 1660 | 96% |
| 2 | 16-24s | 182 | 1530 | 90% |
| 3 | 24-32s | 166 | 1410 | 80% |
| 4 | 32-40s | 151 | 1300 | 66% |
| 5 | 40-48s | 137 | 1200 | 50% |
| 6 | 48-56s | 125 | 1105 | 36% |
| 7 | 56-64s | 114 | 1020 | 24% |
| 8+ | 64s+ | 103 (cap) | 940 (cap) | 14% and falling |

Cumulative survival at step 5 is `0.99*0.96*0.90*0.80*0.66*0.50 ≈ 0.226`, which
puts the **median run at ~44-52s** — inside the 45-75s target band. That
multiplication is the whole balance method: choose per-step survival rates,
multiply them, and read off the median. Never tune a hypercasual ramp by feel.

Score: `score = sum(perSuccess * comboMul)`. A median 50s run with ~28 successes
at an average combo of 2.4 scores `28 * 10 * 2.4 = 672`. A first-week personal
best should land at 2.5-3.5x the median, which the combo cap of x5 delivers
naturally.

The gate: `npm run sim -- --family J` runs 5000 bot sessions with a 220ms
reaction time and ±60ms jitter and asserts median 45-75s, p95 under 210s,
`firstInputByMs <= 2500`, and that no ramp step drops survival by more than 18
points (a cliff reads as unfair even when the median is correct).

### Meta progression

Deliberately thin for a pure build, and the promotion point for a hybrid one.

| Meta-kit component | Wiring | Numbers |
| --- | --- | --- |
| `core/collections.ts` albums | 10-15 skins, cosmetic only — a stat-bearing skin creates a "best skin" and kills the collection | 400-2500 coins; 3 skins earned from missions, never purchasable |
| `core/collections.ts` missions | 3 active, rotating individually on completion | "survive 90s", "combo x5", "score 1500" |
| `core/collections.ts` reward track | 30 tiers fed by mission completions | 1 tier per 2 missions |
| `core/collections.ts` streaks/daily | daily challenge on a fixed seed with a personal-best ghost + login streak | day 7 = a skin shard |
| `ui/boosterBar.ts` | head start (skip to ramp step 2), x2 score, one shield | 150 / 250 / 200 coins |
| Coins | `grantCurrency(floor(score / 10) + missionRewards)` | ~67 coins per median run |
| Prestige / upgrades | **none.** Permanent power upgrades destroy a score chase: they make old scores incomparable. | |

### The promotion path (pattern I)

This is the highest-value section of this playbook. A finished J1 core is the
**onboarding minigame** of a pattern-**I** hybrid — the `Last War` / `Whiteout
Survival` pattern: a casual mechanic teaches and hooks in the first 60 seconds,
then a deep meta layer carries retention and monetization. The measured payoff
is **5-20x LTV** versus the pure build, and hybrid-casual is the only segment
growing in 2026 (+20-23%).

Promotion recipe, in order:

1. **Keep the core untouched.** The same `RampDirector`, the same one verb, the
   same 45-75s median. Do not "deepen" the minigame; its shallowness is what
   makes it a hook.
2. **Convert the score into a meta currency.** `score -> soft currency` at a
   fixed rate, so every run feeds the layer above. This is the only change to
   the core loop.
3. **Add exactly one meta spine**, chosen for the fantasy, not for volume:
   base/decor building (meta-kit decor tasks), a saga map of chapters
   (`ui/sagaMap.ts`), or a collection season (`core/collections.ts`). One spine,
   fully built, beats three shallow ones.
4. **Gate the spine on runs, not on time.** Each meta step costs the output of
   2-5 runs, so the minigame is always the path forward.
5. **Re-verify the core.** The J gate must still pass: adding meta must not
   change the median session, and the promoted build must still reach first
   input within 2.5s of a cold start.

Ambiguous or "make me a fun mobile game" pitches default to this promoted
shape: `J1` core + one meta spine, which is pattern **I**.

### Build variety

A one-verb game has no builds; variety is **risk policy**, and the twist must
keep at least two viable: (1) *safe* — never takes the bonus platform or the
tight lane, longest runs, lowest score rate; (2) *combo-max* — always takes the
perfect window and the risky option, ~35% shorter runs at 2.2x the score rate.
The PRD must show the expected score of both policies at ramp step 4; if safe
play wins on score, the risk-reward twist is mispriced and the game has no
skill expression. Skins add identity variety only — never stats.

### Portrait UI plan

- Play area: the full 720x1280 frame. Hypercasual is the one family where the
  action may enter the `SAFE` bands, as long as nothing lethal spawns inside
  the bottom 220px where the thumb sits.
- y 140-260: score at 84px digits, centered — the largest element on screen,
  because the score *is* the game. Personal best as a 32px line under it.
- y 260-300: combo multiplier, scaling 1.0 -> 1.4 and hue-shifting as it
  climbs; ramp pips (8 dots, 14px) at the right.
- y 300-1060: the mechanic. Nothing else may occupy this band, ever.
- y 1060-1280: no permanent controls. The whole frame is the input surface.
- Death panel: 640x680px at y 320-1000, with the retry target as a 440x140px
  button centered at y 900 — the single most-pressed pixel in the product, so
  it is oversized and pre-focused, and the panel must accept the retry tap
  before its entry animation finishes.
- No settings, no menus, no currency shop on the main screen: one tap from
  death to the next run, one tap from anywhere to the skin select.

### Performance plan

Peak live is mechanic-dependent (20-160; see the menu table). The binding
constraint is not entity count but **input latency and frame consistency**: the
input-to-visible-response budget is 50ms, and a single dropped frame during a
tap-timing window reads as a stolen death. Consequences: allocate nothing after
boot (every spawn from a `SpritePool`, every FX from a shared 200-particle
pool, score labels updated only when the integer changes); never build the next
spawn wave in the frame it becomes visible; keep the physics fixed-step; and
re-use one death-panel container rather than constructing it per run (15 runs
per session x panel construction is a measurable GC source). io-lite is the only
mechanic needing `SpatialHash`, at 80-160 entities with all-pairs proximity.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Mechanic | `objects/<mechanic>.ts`: the verb, the fail test, the perfect window | `interface Mechanic { update(deltaMs: number, params: Record<string, number>): void; act(): { success: boolean; perfect: boolean }; get failed(): boolean }` |
| Ramp + scoring | `RampDirector` wiring, `data/rampSteps.ts`, combo and score | `function rampAt(elapsedMs: number): { step: number; params: Record<string, number> }` |
| Juice | hitstop, shake, particles, chromatic combo flash, death freeze, count-up | `function onSuccess(perfect: boolean, combo: number): void` and `function onDeath(reason: string): Promise<void>` |
| Meta / UI | skins, missions, reward track, daily challenge, death panel, coins | `function onRunEnd(score: number, combo: number, ms: number): Promise<'retry' \| 'skins'>` |
| Balance (integrator) | per-step survival rates until the bot median lands in 45-75s; runs `npm run sim -- --family J` | consumes all contracts above |

### Pitfalls

1. Two verbs. The moment the player must learn a second input, the 10-second comprehension promise breaks and the family's entire advantage is gone.
2. Three twists, or two twists from the same class — the run stops having one legible decision.
3. Tuning by feel instead of multiplying per-step survival rates. The median session length is the specification; derive it.
4. A tutorial. If the verb needs explaining, the mechanic is wrong. First input inside 2.5s of a cold start, always.
5. Retry behind an interstitial, a menu, or an animation that swallows the tap. Target 900ms tap-to-tap and accept the tap during the panel's entry tween.
6. No death freeze: players cannot see what killed them and read every death as random.
7. Permanent power upgrades or stat-bearing skins, which make old scores incomparable and destroy the only progression a score chase has.
8. Weak juice. In this family juice is not polish, it is the product; a mechanically identical build with 60% of the juice measures as a different, worse game.
9. A difficulty cliff (a step that drops survival by 30 points) — the median can be perfect and the game still feels unfair.
10. Building io-lite as real-time multiplayer. Out of scope for this pipeline: 8-20 offline bots with name tags deliver the same session.
11. Shipping pure hypercasual in 2026 without even considering the promotion path, forgoing a 5-20x LTV multiple for one meta spine of extra work.

### Video hook

15-30s clip (shorter than every other family — the mechanic must sell itself
immediately): 0-3s one input and one success with full juice (hitstop, punch,
particles), 3-10s a rhythm of four successes with the combo climbing and the
colour shifting, 10-18s the ramp visibly tightening — the same action now
demanding precision — 18-24s a risky twist decision taken for a 3x payoff and
the score jumping, 24-27s a death freeze on the exact mistake, 27-30s the
instant retry already in motion. Payoff moment: the combo chain at high ramp,
ending on the sub-second retry.
