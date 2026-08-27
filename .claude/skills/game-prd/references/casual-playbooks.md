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
| `LevelDirector` | `core/session.ts` | goal set + move/time budget, win/fail evaluation, star thresholds | B, C-levels, G, H |
| `RampDirector` | `core/session.ts` | endless score-chase difficulty ramp, no win condition, single fail state | J, C-runner |
| `LapDirector` | `core/session.ts` | laps, checkpoints, per-lap splits, finishing position | E |

## Shared modules cited in this file

| Module | Contents |
| --- | --- |
| `core/board/grid.ts` | typed cell grid: fill from a level spec, swap, match/group query, refill queue |
| `core/board/gravity.ts` | column collapse and spawn-from-top; the only writer of tile positions |
| `core/board/cascade.ts` | cascade resolver: resolve match -> clear -> gravity -> re-match until stable, emitting a step list the scene animates |
| `core/board/goals.ts` | goal definitions (collect N of type, clear N blockers, reach score, drop N to bottom) and completion tracking fed to `LevelDirector` |
| `core/board/boosters.ts` | pre-level and in-level boosters: target selection, effect application through the cascade resolver |
| `core/economy.ts` | exponential generator economy: cost curves, production rates, offline accrual, prestige reset with a carry-over multiplier |
| `core/deck.ts` | seeded deck/pile primitive (draw, discard, exhaust, reshuffle); solitaire builds tableau/foundation piles on it |
| `core/progression.ts` | `MetaSave` persistence (`currency`, `unlocks`, `upgrades`, `stats`) |
| `core/rng.ts` | `Rng` — seeded; every level/deal/track/question set is a seed, never `Math.random` |
| `core/controls.ts` | `Controls` — `onTap`, `onSwipe`, `onDrag`, `onHoldStart/onHoldEnd`; joystick is optional per slice and unused in every family in this file |
| `ui/hand.ts` | fanned card row with tap/drag pick-up — used by G-solitaire's stock/waste and by pattern-I card metas |
| `ui/bars.ts`, `ui/cards.ts`, `ui/hud.ts`, `ui/button.ts` | HUD bars, choice panels, HUD frame, buttons |
| meta-kit | shared, family-agnostic: `saga-map`, `stars`, `streaks/daily`, `boosters`, `collections`, `decor/renovation tasks`, `reward track` |

Scaffold and gates, identical for every playbook here:

- `scripts/new-game.sh <slug> --family <code>` scaffolds the slice under
  `src/slices/` with the family's starter scene + data files.
- `npm run verify` — typecheck, lint, headless boot, asset manifest.
- `npm run sim -- --family <code>` — the family's simulation gate. B: board
  solver win-rate curve per level. C/J: ramp session-length bot. E: lap bot.
  F: economy curve check. G: deal solvability + roll distribution. H: wordlist
  and answer-key validation.

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
`core/board/grid.ts` + `core/board/cascade.ts`, scored by
`core/board/goals.ts`, and adjudicated by `LevelDirector`.

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
| 0:00-0:05 | Board deals in from the top (`core/board/gravity.ts` spawn pass); goal chips animate into the HUD; no input accepted until stable. |
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
| Tap on special | Detonate in place without consuming a swap-move (blast) or as the move itself (swap) | `Controls.onTap` -> `cascade.detonate(cell)` |
| Tap on booster then tap target | Arm booster, then apply to a cell/row/color | `core/board/boosters.ts` `arm()` / `applyTo(cell)` |
| Hold on any cell | Hint highlight after 600ms of no input (accessibility, not a booster) | `Controls.onHoldStart` |

No drag-follow, no joystick. The board never scrolls.

### Systems required

| Module | Use |
| --- | --- |
| `core/session.ts` (`LevelDirector`) | move budget, goal set, win/fail, 1-3 star thresholds, `progress` = goal completion fraction |
| `core/board/grid.ts` | cell storage, `swap`, `matchesAt`, `groupAt`, refill queue |
| `core/board/gravity.ts` | column collapse + top spawn; single writer of tile y positions |
| `core/board/cascade.ts` | the resolver loop; emits an ordered step list (`clear`, `fall`, `spawn`, `special`) that the scene animates at 90-140ms per step |
| `core/board/goals.ts` | goal types `collect`, `clearBlocker`, `score`, `dropToBottom`; feeds `LevelDirector` |
| `core/board/boosters.ts` | hammer, row-clear, color-bomb, shuffle; pre-level and in-level arming |
| `core/rng.ts` | `Rng` seeded per level id, so a level plays the same board for every player and for the sim gate |
| `core/progression.ts` | `MetaSave.stats` (levels cleared, stars), `MetaSave.currency` (coins), `MetaSave.upgrades` (owned boosters) |
| meta-kit `saga-map` | level nodes, star gates, chapter boundaries |
| meta-kit `stars` | 1-3 stars per level, star currency for gates and reward track |
| meta-kit `boosters` | pre-level loadout picker and shop |
| meta-kit `streaks/daily` | daily level + login streak |
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
| `saga-map` | one node per level, 10 levels per chapter | chapter gate every 10 levels |
| `stars` | 1-3 per level, spent on chapter gates and decor tasks | gate cost = 12 stars per chapter (of 30 available) |
| `boosters` | pre-level loadout (max 2 armed) + in-level shop | hammer 150 coins, row-clear 220, color-bomb 400, shuffle 90 |
| `streaks/daily` | daily level with a x2 coin bonus; 7-day streak track | day-7 reward = 1 of each booster |
| `reward track` | star-fed track, 20 tiers per chapter | tier every 4 stars |
| `collections` (optional) | level-drop collectible set, 8-12 per chapter | 1 drop per 3 levels |
| `decor/renovation tasks` (recommended for pattern I) | stars buy decor steps in a room scene | 1 task = 3-6 stars, 5-8 tasks per room |

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
| Board engine | `core/board/grid.ts`, `gravity.ts`, `cascade.ts` wiring for this slice | `interface CascadeStep { kind: 'clear' \| 'fall' \| 'spawn' \| 'special'; cells: BoardCell[]; payload?: string }` and `resolve(grid, move): CascadeStep[]` |
| Level content | `data/levels.ts` (50 specs), goal mix, star thresholds | `interface LevelSpec { id: number; seed: number; cols: number; rows: number; layout: string[]; goals: GoalSpec[]; moveBudget: number; starThresholds: [number, number, number] }` |
| Board view | `objects/tile.ts`, cascade animation timeline, juice | `function playSteps(steps: CascadeStep[]): Promise<void>` |
| Meta / UI | saga map scene, star deposit, booster shop, fail panel | `function onLevelEnd(outcome: SessionOutcome, stars: number): Promise<'retry' \| 'map'>` |
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
