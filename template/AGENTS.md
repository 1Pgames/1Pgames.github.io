# Build instructions for the agent

Portrait **720×1280 (9:16) Phaser 4 + Vite + TypeScript** template covering ten
gameplay families — from mid-core indie genres (survivor-like, tower defense,
deckbuilder, racing) to casual ones (board puzzle, idle tycoon, table/dice,
word, hypercasual) — with 5-10 minute sittings and meta progression between
sessions. The spec for the game you are building is `PRD.md` in this folder,
and its header names the **family code** that decides the session director, the
slice you start from and the sim gate you must pass. Implement it **inside this
structure**; do not restructure the project.

## Commands

```bash
npm install       # once
npm run dev       # http://localhost:5173
npm run typecheck # tsc --noEmit — must be clean
npm run build     # typecheck + production bundle
npm run sim       # headless balance sim + gates for THIS game's family
npm run sim -- --family board   # gates of a specific family (arena adds --runs N --lane all --strict)
npm run verify    # typecheck + sim gates + art-registry check + kit selftests
```

`?debug` in the URL enables Arcade physics debug bodies in dev. Headless TS
runs through Node 24 type stripping: `node --import ./scripts/ts-resolve.mjs <file.ts>`.

## Gameplay families and slices

Ten families, one shared systems layer. The family code comes from the PRD
header (`game-prd` Step 0); everything below is a lookup on it. `--family`
takes the slice/gate name in the `Sim gate` column, not the letter. The last
column is what the slice already wires out of `core/progression.ts` and
`data/metaCatalog.ts` — do not rebuild it, extend it.

| Code | Genres | Session director | Slice | Sim gate | Meta wiring the slice ships |
| --- | --- | --- | --- | --- | --- |
| A | survivor-like, action roguelike, tower defense, horde arena | `RunDirector` (`src/core/run.ts`) | `src/slices/arena/` | `npm run sim -- --family arena` | `metaModifiers()` stat upgrades + daily streak |
| B | match/blast, merge, sort, block-fit | `LevelDirector` (`src/core/level.ts`) | `src/slices/board/` | `npm run sim -- --family board` | saga map + stars + 7 uncapped boosters — pre-level (`extra-moves`, `shuffle`, `bomb-start`) and in-level tray (`ladle`, `broom`, `pestle`, `whisk`, none of which spend a move) — + streak |
| C | platformer, endless runner, physics launch/hill-climb | `LevelDirector` (levels) or `RampDirector` (endless) | `src/slices/side/` | `npm run sim -- --family side` | saga map + time-band stars + `extra-life` revive + `meta_coin_magnet` + streak |
| D | deckbuilder, tactics, auto-battler | `RunDirector`, `progress` indexed by fight/node | **no slice — compose from the genre kits** | none yet | none yet — a D game wires its own |
| E | racing, karts, drift circuits | `LapDirector` (`src/core/lap.ts`) | `src/slices/track/` | `npm run sim -- --family track` | `meta_tune_up` top speed + streak |
| F | idle, incremental, tycoon, clicker | `Economy` (`src/core/economy.ts`) — no `SessionDirector`: the session ends only when the player ascends; `LevelDirector` only if the PRD adds milestone chapters | `src/slices/idle/` | `npm run sim -- --family idle` | `meta_offline_cap` + `meta_golden_touch` + streak |
| G | solitaire, dice, roll-and-move, tile draw | `LevelDirector` for a deal/goal loop; the shipped table slice instead resolves `SessionOutcome` from its own roll-budget `DiceLoop` (`slices/table/board.ts`) | `src/slices/table/` | `npm run sim -- --family table` | pre-session picker (`extra-rolls`) + `meta_loaded_dice` + streak |
| H | word, anagram, trivia, quiz | `LevelDirector` | `src/slices/word/` | `npm run sim -- --family word` | pack map + time-band stars + `time-plus`/`fifty-fifty` + streak |
| J | hypercasual: one mechanic, endless score chase, instant retry | `RampDirector` (`src/core/ramp.ts`) | `src/slices/hyper/` | `npm run sim -- --family hyper` | `skins` collection (milestones + `meta_skin_pack`) + pre-run picker + `meta_slow_start` + streak |
| I | hybrid **composition pattern**, not a family: a casual core from J/B/F wrapped in 2-3 meta-kit layers | the core's director | the core's slice | the core's family gate | the core slice's, plus the wrapping kit layers |

**Family D has kits but no slice.** `core/{turns,deck,autobattle}.ts`,
`systems/{placement,board}.ts` and `ui/{hand,shopTray}.ts` are shipped, and the
pure-logic ones are guarded by the `turns`, `deck`, `autobattle` and
`boardmath` selftests in `src/sim/kits/` — but there is no D slice dir and no
`src/sim/families/` module for it. A D game authors its own
`src/slices/<code>/{game,tuning}.ts` from those kits per the PRD's playbook,
points the `src/scenes/game.ts` re-export at it, and writes its own
`src/sim/families/<code>.ts` gate — do not claim a family gate that does not
exist.

### The slice re-export

`src/scenes/game.ts` is a one-line re-export of the active slice, nothing else:

```ts
export { GameScene } from '../slices/arena/game';
```

`scripts/new-game.sh <slug> "Title" --family <code>` does three things at
scaffold time: deletes every `src/slices/*` dir except the chosen one, rewrites
that re-export line, and writes `src/sim/family.ts`
(`export const SIM_FAMILY = '<code>'`) so a bare `npm run sim` runs the right
family's gates and the pruned `src/sim/families/*` modules are never imported.
The template default is `arena`.

### Slice authoring rules

- **A slice owns its directory and nothing else.** `src/slices/<code>/` may
  contain `game.ts` (required) plus family data modules — the shipped ones are
  `levels.ts` (board, side), `gen.ts` (side), `content.ts` (idle), `stack.ts`
  (hyper), `board.ts` (table), `math.ts` (track), `packs.ts` (word).
  Everything outside the dir is imported read-only from
  `src/{core,ui,systems,data}`; a slice never edits a shared module to suit
  itself. It also exports `ART_GROUPS` next to its `GameScene` (see the art
  slots rule below).
- **`tuning.ts` is local and mandatory.** Every slice except `arena` keeps its
  balance numbers in `src/slices/<code>/tuning.ts` (`BOARD_TUNING`,
  `SIDE_TUNING`, `TRACK_TUNING`, …); the arena slice uses `TUNING` in
  `src/config.ts`. The family sim imports the same module, so a number the sim
  cannot see is a number that is not gated.
- **Full loop or nothing.** A slice must reach `SCENES.GAMEOVER` on every
  outcome its family has — both a win and a loss where the family has both,
  resolved by its director's `SessionOutcome {won, reason}` (family F is the
  one exception: the idle economy has no fail state and ends only when the
  player ascends). It hands over `GameOverData.stats` — `readonly ResultStat[]`
  of `{label, value}` rows from `src/core/session.ts` — instead of the
  arena-specific kills/level fields. `GameOverScene` awards currency and writes
  the meta save itself; the slice must not.
- **Headless-safe logic.** Directors and family maths stay Phaser-free so
  `src/sim/families/*` can tick them in Node; `Rng` (never `Math.random`) for
  anything a seed must reproduce.
- **One pause path.** `showPauseOverlay` + `director.pause()/resume()`; the
  director's clock is the session clock, not `scene.time`.
- **The meta layer is a catalog, not a feature.** `data/metaCatalog.ts` holds
  one entry list per family and `scenes/meta.ts` renders whichever
  `metaCatalogFor(SIM_FAMILY)` returns; the slice's job is to CONSUME what the
  player bought, through three paths and no others:
  - `booster` entries: read `boosterCount(id)` to build the offer, call
    `spendBooster(id)` **at the moment the level actually begins**, and apply
    the effect to a COPY of the level/rules spec (`{...spec, moves: …}`), never
    to the authored data the family sim reads. A picker the player backs out of
    must cost nothing.
  - `perk` entries: read `loadMeta().upgrades[id] ?? 0` ONCE in `create`, turn
    it into a local multiplier, and keep every per-level number in `tuning.ts`
    (e.g. `SIDE_TUNING.coin.magnetPerPerkLevel`). A perk read per frame is a
    perk that changes mid-session.
  - `stat` entries: nothing to wire — `metaModifiers()` already folds them in
    at run start (arena only).
  Level families additionally own the map/stars loop: `showSagaMap` before the
  first deal, `recordStars(levelId, director.stars)` on the win, and the level
  index persisted under a `<family>:last` storage key so `RETRY` — which
  carries only the run seed — replays the level the player just lost instead of
  the next one. Every slice calls `touchDailyStreak()` once in `create` and
  floats a `DAY n STREAK!` toast when it returns `extended`.
- **Art slots, never hardcoded textures.** A gameplay role that generated art
  can fill carries an `ArtSlot | null` (`{key, frame?}`, imported from
  `data/art.ts`) beside its procedural fallback — `BOARD_KIND_STYLES[].art`,
  `SIDE_TUNING.art.hero`, `HYPER_TUNING.art.slab`, and so on. Resolve it ONCE
  at construction with `scene.textures.exists(slot.key)`: a slot whose group is
  pruned falls back to `TEX.*` + `tint` instead of drawing a green box. A
  resolved slot is drawn **untinted** — generated art carries its own colour —
  and sizes always come from `tuning.ts`, never from the art's cell. The
  slice's `ART_GROUPS` export lists the manifest groups those slots need; `ui`
  and `bg` are always in it.

## What already exists (use it, never reinvent)

### Presentation and input

| File | Role |
| --- | --- |
| `src/config.ts` | `VIEW` (720×1280), `SAFE` (top 140 / bottom 220 / side 40), `PALETTE`/`CSS`, `TEXT` presets, **`TUNING` = every balance number** |
| `src/systems/arena.ts` | `Arena`: bounded field, tiled floor, decals, primitive walls + static bodies, seeded impassable props |
| `src/data/props.ts` | prop and decal definitions (`bodyScale` drives the collision circle) |
| `src/ui/joystick.ts` | `Joystick`: floating on-screen thumb stick (movement), `vector` carries throttle, `setEnabled` for overlays |
| `src/core/controls.ts` | `Controls`: tap / swipe / drag / hold callbacks + `axisX/axisY` keyboard parity |
| `src/core/juice.ts` | `shake`, `flash`, `pop`, `floatText`, `burst`, `hitstop`, `countTo`, `enterFromBottom`, `idleBob`, `starfield` |
| `src/core/audio.ts` | `sfx(name)` — synthesised WebAudio, no files: `ui tap pickup combo jump hit die levelup whoosh`; `sfxArp`, `toggleMute` |
| `src/core/textures.ts` | procedural `disc / ring / square / spike / star / particle / panel`; `buildGradient` |
| `src/ui/primitives.ts` | `drawPanel` / `drawPill` / `paintPanel` / `paintPill` — all UI chrome, palette-driven |
| `src/ui/button.ts` | `Button` — primitive capsule, ≥88px tap target, pressed repaint, plays `sfx('ui')` |
| `src/ui/hud.ts` | `Hud` — hp/xp bars, level, run timer, currency, kills, phase label; fed a diffed `HudModel` via `set(model)` each frame |
| `src/ui/bars.ts` | `Bar` — HP / XP / progress bars: primitive housing + texture-scaled fill |
| `src/ui/cards.ts` | `showUpgradeCards(scene, choices, onPick, opts)` — pick-1-of-N overlay with rarity chips and an optional one-per-draft reroll (`TUNING.draft.rerollCost`) |
| `src/ui/pauseOverlay.ts` | `showPauseOverlay(scene, {onResume, onRestart, onMenu?})` — dim + Resume/Restart/**Menu**/Mute; the MENU row renders ONLY when `onMenu` is passed (and every slice passes it: the run's exit door), and the caller owns the teardown before `scene.start(SCENES.menu)` |
| `src/ui/sagaMap.ts` | `showSagaMap(scene, opts)` — scrolling level path with star ratings and lock states; the meta shape for B/C/H |
| `src/ui/boosterBar.ts` | `showBoosterPicker(scene, opts)` pre-level gate + `showBoosterTray(scene, opts)` in-level tray, both ICON-ONLY square slots (glow/plate/count badge) sharing one tooltip (`BOOSTER_BLURB[id]`, SAFE-aware flip, 3s auto-hide, never interactive). A name is never a permanent label. Both return `bounds` for a coach mark; `BoosterGlyph.art` degrades to the tinted `TEX` primitive when its slot is unloaded |
| `src/ui/coach.ts` | `showCoach(scene, {id, target, text, mode})` / `hasSeenCoach(id)` — FTUE coach marks: 4-rect dim + spotlight cutout, pointer hand, one-line card; `'tap'` or `'swap-gate'` (the dim rects ARE the input gate); one-shot `tut:<id>` flags via `core/storage` |
| `src/ui/background.ts` | `addBackground(scene)` — parallax `bg-layer-0/1/2` (cover-fit, camera scrollFactors) → single `bg-arena` → procedural gradient+starfield fallback |
| `src/ui/background.ts` scrim | the generated-backdrop branch adds a `bgDeep` veil at depth -190 (full frame 0.45 + heavier top/bottom bands) — generated art is brighter than the gradient the UI was designed against, and ink text needs a guaranteed dark surface |
| `src/core/music.ts` | zero-asset generative music: `startMusic('menu'\|'run')`, `setMusicIntensity(0..1)`, `setMusicLayer('boss', on)`, `stopMusic()`; muted together with sfx |

### Systems (the reason this template exists)

| File | Role |
| --- | --- |
| `src/core/stats.ts` | `StatBlock` + `Modifier`: `(base + Σadd) * Π(1+mul)`, memoised — the backbone of upgrade builds |
| `src/core/damage.ts` | `Health` (i-frames, heal cap, `grantIframes`, idempotent death), `rollDamage` (crit), `applyDot`; `setDamageClock()` makes i-frames tick on sim time, not wall clock |
| `src/core/pool.ts` | `Pool<T>` (zero-allocation free list, live-set tracked `releaseAll`) — pure TS |
| `src/core/spritePool.ts` | `SpritePool` for pooled arcade sprites (the Phaser half of pooling) |
| `src/core/spatial.ts` | `SpatialHash` broad phase — mandatory above ~150 entities |
| `src/core/grid.ts` | `NavGrid` BFS flow field — tower-defense/dungeon pathing |
| `src/core/session.ts` | `SessionDirector` (`update(deltaMs)`, `elapsedSeconds`, `pause/resume`, `ended`, `outcome`, `progress`), `SessionOutcome`, `ResultStat` — the one interface scenes, HUD, music and the sim drive every family through |
| `src/core/run.ts` | `RunDirector`: declarative `WaveSpec[]` (spawn `pattern`: ring/arc/line/cluster) + `RunPhase[]` + scripted `EventSpec[]` (chest/breather/elite-rush) via `onEvent`; delta-driven, structural host (no Phaser import — headless-safe) |
| `src/core/level.ts` | `LevelDirector`: `LevelGoal[]` + move/time budget → win/lose; families B/C/G/H |
| `src/core/ramp.ts` | `RampDirector`: endless score-chase with a difficulty ramp (`RampSpec`), `progress === null`; family J and C-endless |
| `src/core/lap.ts` | `LapDirector`: laps + checkpoints (`LapSpec`); family E |
| `src/core/board/*` | headless board engine: `types` (cells/specials/blockers), `grid` (`Board`), `resolve` (match-swap/blast cascades, jar + vine blocker layer), `boosters` (in-level `ladle`/`broom`/`pestle`/`whisk` — none spends a move), `mercy` (refill-pool narrowing at low moves), `merge` (merge chains), `sort` (sort puzzles), `block` (block-fit) — all seeded, all Phaser-free |
| `src/core/economy.ts` | `Economy`: generators, managers, prestige, offline accrual, `EconomySnapshot` save/restore — family F's whole loop |
| `src/core/progression.ts` | versioned `MetaSave` (v2: currency, unlocks, upgrades, **stars**, daily **streak**, **collections**, **boosters**) + `metaModifiers()`; migrations are per-version steps — bump `version` and add one |
| `src/core/collections.ts` | `CollectionSetDef` / `collectionProgress` / `rollMissingPiece` — the collect-a-set meta layer |
| `src/core/rng.ts` | seeded `Rng` (`float/int/chance/pick/pickWeighted/shuffle`), `dailySeed()` |
| `src/core/storage.ts` | namespaced, throw-safe localStorage |
| `src/data/enemies.ts` | archetypes as `{ base, behaviour, ... }` incl. `healer` aura, telegraphed `charge`, 3-phase `boss` (`TUNING.boss`: volley → summon+shield → enrage ring), `eliteDrop` coins; `scaleEnemy(def, difficultyMul)` |
| `src/data/weapons.ts` | `WeaponDef` catalog: `bolt / orbit / nova / rail` + evolutions; per-weapon numbers in `TUNING.weapons`; patterns implemented in `systems/combat.ts` |
| `src/data/upgrades.ts` | card pool with `kind: 'stat' \| 'weapon-unlock' \| 'weapon-boost'`, slot/ownership gating via `UpgradeRollContext`, 2 legendary `effect` cards, meta upgrades, `rollUpgradeChoices()`, boot-time `validateUpgradeStats` |
| `src/core/effects.ts` | `EFFECT_HOOKS` registry consuming `UpgradeDef.effect` (`glass-cannon`, `bulwark`) — behaviour cards, not stat tweaks |
| `src/data/waves.ts` | reference 480s run: phases, waves, `TIMELINE_EVENTS` (2 chests, breather, elite-rush) |
| `src/objects/coin.ts`, `src/objects/blade.ts` | pooled elite-drop currency pickup; pooled orbit blade |
| `src/sim/*` | headless balance sim over the REAL data. `families/<code>.ts` holds one family's bots/solvers and gates (`board` greedy-vs-random solver ladder, `hyper` skill-parameterised session length, `idle` economy curves and prestige floor, `table` dice win-rate band, `word` bank integrity + accuracy bots over all five packs, `side` generator validation + hop bot, `track` lap completion + bot spread); `arena` is `cli.ts`'s own lane pipeline; `family.ts` holds the scaffolded default; `kits/*.selftest.ts` guard the shared kits |
| `src/scenes/*` | `boot → preload → menu → meta → game → gameover` wired with fades. `meta.ts` is the SHOP: a drag-scrolled row list clipped by its OWN camera viewport (a real GPU scissor — Phaser 4 has no `setMask`), identity scroll, mutual `ignore` with the main camera, re-hooked per visit. `gameover.ts` obeys one CTA law: `won && next` → PLAY NEXT (`levelIndex`), `won && !next` → PLAY AGAIN (the retry action relabelled, plus the neutral `ALL CLEAR!` note), a loss → RETRY (same seed) — SPACE always mirrors the primary, and the shop pill is labelled SHOP everywhere, never UPGRADES |

### Genre kits (dormant until a PRD needs them)

| File | Role |
| --- | --- |
| `src/core/turns.ts` | `TurnManager`: synchronous phase/round state machine with per-side action points — tactics/deckbuilder |
| `src/core/deck.ts` | `Deck<TCard>`: draw/discard/exhaust with seeded shuffle + energy tracker; one-zone invariant |
| `src/core/autobattle.ts` | `resolveCombat(playerBoard, enemyBoard, rng)`: deterministic fixed-dt resolver returning a full `CombatEvent` log for replay |
| `src/systems/placement.ts` | `PlacementSystem`: tap-to-place with ghost preview + `NavGrid` reachability validation — tower defense / base builder |
| `src/systems/board.ts` + `src/systems/boardMath.ts` | drag-drop bench/board with cell snap, swap, sell zone; pure cell math lives in `boardMath.ts` (headless-testable) |
| `src/ui/hand.ts` | `HandView`: bottom-docked card fan, tap-select/tap-target or drag-up-to-play |
| `src/ui/shopTray.ts` | `ShopTray`: docked offer slots with reroll cost and lock toggle — auto-battler |

These are the kits family **D** is built from (`turns` + `deck` for a
deckbuilder, `autobattle` + `board` + `shopTray` for an auto-battler,
`turns` + `placement` for tactics) — D is the one family with no starter slice,
so a D game wires them into its own `src/slices/<code>/game.ts` and gets a new
`src/sim/families/<code>.ts` gate.

### Generated art (vibrant 2D chibi)

| File | Role |
| --- | --- |
| `art/style.json` | the project's `sprite-forge.style.v1` contract — every asset is generated against it |
| `art/manifest.json` | asset plan per group (hero, enemies, FX, UI, backdrop) |
| `public/assets/generated/**` | exported sheets, frames, GIFs, `sprite-metadata.json` |
| `src/data/art.ts` | **GENERATED** registry (`node scripts/gen-art-registry.mjs`, `--check` guards drift in `npm run verify`) — texture keys, frame geometry, per-action `scale`, `facesRight`, `ICON` frames. Never hand-edit; edit `art/manifest.json` and regenerate |
| `src/scenes/preload.ts` | loads every registry row and creates one animation per animated sheet |

Regenerating or adding art is the `game-art` skill's job, not hand-drawing:
`.claude/skills/game-art`. Rules that matter when you touch it:

- Entity size comes from `TUNING`, never from the art; hitboxes are set in
  source-cell pixels and are deliberately smaller than the sprite.
- Generated actions of one character do NOT fill their cell to the same height
  (measured hero subject heights: idle 171, run 146, attack 162, hurt 165 in a
  256px cell). Every animated asset therefore carries `scale` in
  `src/data/art.ts`, computed by the generator from `sprite-metadata.json`
  subject heights and re-applied on each animation switch — otherwise the
  character visibly shrinks when it starts running.
- Facing is per-asset too (`facesRight`): this hero's art reads as moving LEFT,
  so a blanket `setFlipX(vx < 0)` made it run backwards. Mirror through
  `artFacesRight(key)`.
- Generated art is already coloured: do not `setTint` a character sprite.
- Pooled sprites must `play(key, true)` on spawn or they keep the old frame.
- A progress fill is **redrawn**, never scaled: scaling a rounded shape turns
  its caps into ellipses, and a nearly-empty bar becomes a smear. `ui/bars.ts`
  repaints a rounded rect whose radius is `min(height/2, width/2)` while the
  value animates, so a 5% bar is a dot and a 100% bar is a capsule.
- UI chrome (panels, buttons, bars, frames) is **primitives**, never stretched
  art: use `ui/primitives.ts` so it fits any size and re-skins with `PALETTE`.
  Generated art in the UI is limited to icon glyphs, the emblem and the
  backdrop. Repaint chrome only on state changes, never from `update`.

## How to implement a PRD

1. **Contracts first.** If several agents build in parallel, the PRD's §16.1
   interface types are law. Never renegotiate them mid-flight; never edit a file
   another workstream owns.
2. **Balance numbers live in one place per family**: `TUNING` in
   `src/config.ts` for the arena slice, `src/slices/<code>/tuning.ts` for every
   other family. Nothing balance-related is hardcoded anywhere else, and the
   family sim must import the same module.
3. **Content lives in `src/data/`** as plain data records (enemies, upgrades,
   waves, towers, items) — never as `if` chains in scenes.
4. **Systems live in `src/systems/`** (create it) as classes taking their
   dependencies in the constructor. They must be Phaser-light: gameplay maths in
   pure TS, Phaser only for rendering/physics.
5. **Entities live in `src/objects/`**, one class per file, extending
   `Phaser.Physics.Arcade.Sprite` or `Phaser.GameObjects.Container`, each owning a
   `StatBlock` and a `Health` where applicable.
6. **The slice's `GameScene` is the integrator**: it wires session director →
   gameplay → UI → `GameOverData.stats`, and `src/scenes/game.ts` only
   re-exports it. In the arena slice keep the block marked `BEGIN/END
   replaceable gameplay` as the seam.
7. **Balance loop is the sim.** After every change to `TUNING` or the slice's
   `tuning.ts`/level data, run this family's gate:
   `npm run sim -- --family <code>` (arena also takes `--runs 20 --lane all`).
   Hard gates must stay green. Tune data, never the sim's bot constants.
8. **Music is two lines:** `startMusic('run')` + `setMusicIntensity(...)` from
   the difficulty curve, `setMusicLayer('boss', on)` around the boss. Internals
   live in `core/music.ts` — do not touch them per game.
9. **Meta layer**: read/write only through `core/progression.ts`; bump `version`
   and add a migration when the schema changes.
10. **Repaint** `PALETTE`/`CSS` and `index.html`'s `<title>`, and update the menu
   copy so the how-to-play matches the real verb.

## Non-negotiable rules

- **Portrait, one thumb.** Interactive elements inside `SAFE`; minimum tap target
  88px; nothing interactive in the bottom 220px except full-width controls; the
  play field stays visible while overlays are open unless the run is paused.
- **Movement is the joystick** (`ui/joystick.ts`), with keyboard parity: the base
  floats to the thumb inside `TUNING.joystick.zoneTop`, the vector's magnitude is
  the throttle, and it MUST be disabled (`setEnabled(false)`) while a modal
  overlay covers the control zone.
- **Screen-space UI must set `setScrollFactor(0)` on every interactive object,**
  not just on its parent container: with a following camera Phaser hit-tests a
  child against the camera scroll independently, so an unpinned card renders
  centred but only accepts clicks at the camera's world offset. The ONE
  exception: objects inside a camera-scissor list scroll WITH the content —
  restore factor 1 on their whole tree there (`buyButton.setScrollFactor(1,
  1, true)` in `scenes/meta.ts`), because that camera's base scroll equals
  its viewport origin.
- **Tappable UI uses click semantics, never release semantics.** Phaser
  dispatches `POINTER_UP` to whatever is under the pointer, so a control must
  arm on its own `POINTER_DOWN` and disarm on `POINTER_OUT` before acting —
  otherwise letting go of the stick over a freshly opened overlay picks a card
  for the player. `ui/button.ts` and `ui/cards.ts` already do this; copy the
  pattern for any new interactive object.
- **Interactive z-order is a contract.** Phaser hands the pointer to the
  TOPMOST interactive object only: any scroll zone, dim veil or overlay
  created AFTER a set of buttons swallows their taps. Create drag/scroll
  zones BEFORE the rows they scroll (see `scenes/meta.ts`), and after adding
  any full-screen interactive layer, re-verify every button under it still
  receives clicks in a real browser.
- **The site shell owns the top-left corner.** The published page (and dev)
  overlays back-link + prompt chips over roughly the top-left 315x75 design
  px of the canvas. No in-game text or tappable element may sit there:
  centre or right-anchor top-band HUD, or drop it below y≈90.
- **Every modal offers an explicit way out.** A picker/overlay without a
  close control (X pill, ESC parity) traps the player; pause always offers
  RESUME / RESTART / MENU / SOUND (`ui/pauseOverlay.ts` renders MENU when
  `onMenu` is wired — wire it in every slice).
- **Results CTA matches the outcome.** Win with a next level → PLAY NEXT
  (direct start); win without one → PLAY AGAIN; loss → RETRY (same seed).
  Never RETRY as the primary on a win (`scenes/gameover.ts` implements the
  law via `GameOverData.next`).
- **Scrolling lists clip, they never hide.** Rows scroll continuously under
  a camera-viewport scissor (list on its own camera, identity scroll, mutual
  `ignore` — `scenes/meta.ts` is the pattern); visibility-culling or fading
  rows at the boundary reads as broken.
- **Economy surfaces are icon-first.** Booster chips/slots show an icon +
  corner count badge, never a text label; selecting/arming shows the shared
  tooltip (name + one-liner, `BOOSTER_BLURB`). In-level boosters live in the
  tray housing panel; the meta screen is called SHOP and sells consumables
  UNCAPPED at escalating prices, coin glyph on every price pill.
- **Stats shown match the loop.** A move-budgeted game shows no BEST TIME; a
  timed game shows no MOVES. Menu and results rows are re-derived per family,
  never left as template defaults.
- **UI must be re-fit to generated art (game-build Step 5.5).** The template
  chrome is tuned for the dark procedural gradient. Once `game-art` lands a
  backdrop or piece art: re-derive `PALETTE`/`CSS` from the art; keep
  gameplay identity colours (piece kinds, teams) as literals in the slice's
  `tuning.ts` locked to the art, never palette references; give `TEXT`
  presets stroke+shadow armour against the darkest background tone; add a
  backdrop scrim in `ui/background.ts` when text draws straight over art;
  and STRIP the armour (`stroke: undefined, strokeThickness: 0,
  shadow: undefined`) on labels that sit on their own pill/panel/disc
  surface, where it reads as grime.
- **Ladder progress is monotonic.** Any `save(<family> progress key, …)` on a
  win takes `Math.max` with the stored value — replaying an early level must
  never revoke the frontier (the board/side/word slices ship this pattern;
  copy it for any new ladder).
- **Every game teaches itself (FTUE).** First session gets a coach-mark
  sequence on level/run 1 (dim + spotlight + one-liner: goal surface,
  resource, one gated first action), and every new mechanic gets a one-beat
  callout on its debut level. Build it with `ui/coach.ts` (`showCoach` /
  `hasSeenCoach`) — never a bespoke overlay. Beats show once per save
  (persisted `tut:<id>` flags), pause the game while visible, never stack,
  and destroy cleanly. A game without a tutorial fails the game-build
  Step 5.5 audit.
- **Pool everything hot.** Above ~50 spawns/minute use `Pool`/`SpritePool`. Above
  ~150 simultaneous entities use `SpatialHash` instead of per-pair overlaps.
- **60fps at the PRD's peak entity count.** No `Graphics` redraw per frame, no new
  tween per frame, no `text.setText` with an unchanged value, no `filter`/`map` in
  update loops.
- **Every gameplay event gets feedback:** one of `shake / pop / flash / burst /
  floatText / hitstop` plus one `sfx()`, respecting the PRD's spam caps (damage
  numbers per second, no shake at very high entity counts). Persistent states
  are designed too: earned specials pulse/glow while idle (loop tweens killed
  on recycle), and the selection highlight is themed, never a default circle.
- **A session must be completable** in the PRD's target window, with win and
  loss both reachable through the director's `SessionOutcome`, and one-tap
  retry.
- **Upgrade stat keys are a contract.** `PLAYER_BASE_STATS` in `src/config.ts`
  is the only list of stats the game reads; every modifier in `src/data/*` must
  use one of those keys. A typo is silent — the modifier applies to a key nobody
  queries, so the card costs a level-up and does nothing. `PreloadScene` runs
  `validateUpgradeStats(Object.keys(PLAYER_BASE_STATS))` at boot and logs any
  offender. Rate stats are multipliers (`attackSpeed` divides `attackMs`),
  never millisecond deltas.
- **Determinism where it matters:** anything that must be reproducible uses `Rng`,
  never `Math.random`.
- **No new dependency** without a reason the template cannot cover.
- **`npm run verify` must pass** (typecheck, this family's sim hard gates,
  art-registry check, kit selftests), and you must play the full loop of your
  family in a browser before claiming done — menu → session → the family's
  mid-session decision surface (arena upgrade draft with reroll, board
  goal/moves budget, hyper instant retry, idle buy/automate, table roll, word
  answer, side level clear, track lap) → pause/resume → win **and** loss →
  results with the family's `ResultStat` rows → retry.

## Quality budgets (genre-agnostic numbers; the feel contract)

Every budget below is measurable in the running game; game-qa measures them,
game-critic judges against them, fx-artist and ui-engineer are held to them.
A build over budget is a defect even when every feature "works".

### Responsiveness
- **Input acknowledgment ≤ 100ms** (ideally next frame): every tap/drag gets
  a VISIBLE reaction immediately — pressed state, selection glow, refusal
  headshake — even when the real effect animates later. Silence is a bug.
- **No swallowed input**: during cascades/animations, input is either
  queued (and visibly so) or refused WITH feedback (bounce + soft sfx) —
  never silently dropped. Buttons stay armed on their own POINTER_DOWN.
- **Scene transitions ≤ 400ms** (fade or slide, never a hard cut, never a
  black gap); retry/restart from decision to playable ≤ 2s.
- **60fps at the PRD's peak counts** — measured during the heaviest beat
  (max cascade / max entities), not the menu.

### Feel & dynamism
- **Meaningful events stack ≥ 2 feedback channels** (visual + audio minimum;
  big beats add scale/shake/hitstop) with spam caps from the PRD's §13
  juice table.
- **Payoff cadence**: no stretch of normal play longer than ~20s without a
  reward beat (family's §9 feel budget refines this); idle/persistent
  states have designed presence (pulse/glow), never static sprites.
- **Animation tempo**: core-loop action animations 120-400ms; anything
  longer is skippable or fast-forwardable (tap-to-skip on finales and
  ceremonies). Nothing the player waits on twice per minute exceeds 700ms.

### Flow logic
- **≤ 2 taps from boot to the core action** (menu → [map] → playing);
  every extra gate needs a design reason in the PRD.
- **Every screen is exitable**: no dead ends; back/close never destroys
  progress without confirmation; the pause path always reaches the menu.
- **State honesty**: empty/zero/maxed states are designed (empty shop,
  zero-count consumables, last-level win), never blank panels or dangling
  buttons.
- **The flow map is law**: the PRD's §14b scene/flow graph names every
  screen, transition and its trigger; a shipped transition not on the map
  (or a mapped one that dead-ends) is a defect.

## Common Phaser 4 traps (this is v4, not v3)

- `setTintFill()` is gone → `setTint(c).setTintMode(Phaser.TintModes.FILL)`.
- `preFX`/`postFX`/`BitmapMask` are gone → the Filters API (`obj.filters.*`).
- `setPipeline('Light2D')` is gone → `setLighting(true)`.
- `Phaser.Geom.Point` is gone → `Phaser.Math.Vector2`.
- `Phaser.Math.TAU` is now `PI*2` (was `PI/2`); `PI2` is gone; use `PI_OVER_2`.
- `TextureManager.generate` / `Create.GenerateTexture` are gone → draw with
  `Graphics#generateTexture` (see `core/textures.ts`).
- `DynamicTexture`/`RenderTexture` buffer draws and need an explicit `render()`.
- `Phaser` has no global: **every file using `Phaser` at runtime must
  `import Phaser from 'phaser'`.**
- `TimerEvent#delay` is read-only → `timer.reset({...})`.
- `setMask()` / `createGeometryMask()` are gone: masks are Filters
  (`obj.filters.internal.addMask(...)`). For a scrolling list do NOT reach for
  a filter (or for visibility culling, which pops rows in and out at the band
  edge): give the list its OWN camera whose viewport IS the band — a camera
  viewport is a true GPU scissor. Set that camera's scroll to its viewport
  origin so world→screen stays identity (same hit areas, same drag math),
  `cameras.main.ignore(list)` and `listCam.ignore(everything else)`.
  Two follow-on traps, both in `scenes/meta.ts`:
  `ui/button.ts` pins itself at scrollFactor 0, which a factor-0 object
  renders offset by the list camera's origin — restore
  `setScrollFactor(1, 1, true)` on any button that scrolls with the content;
  and an `ADDED_TO_SCENE` listener that keeps the camera honest OUTLIVES a
  `scene.start()` round-trip, so it must be unhooked on `SHUTDOWN` or the next
  visit ignores everything against the destroyed camera's reused id and the
  screen comes up blank.
- `this.sound` is a union type; narrow to `Phaser.Sound.WebAudioSoundManager`
  before touching `.context`.
- Arcade `StaticBody` circles are in WORLD px, their centre is derived as
  `position + halfWidth`, and only `setCircle` re-inserts the body into the
  static RTree. Write `body.position` first, call `setCircle(radius)` last, and
  never call `updateFromGameObject()` afterwards (it overwrites the radius with
  the display size). Getting this wrong leaves a stale tree entry, and the prop
  silently blocks nothing — see `systems/arena.ts#placeProp`.
- `GameObject#scene` is nulled on destroy, and scene shutdown destroys children
  before every `SHUTDOWN` listener has run. A listener that touches
  `this.scene` throws *inside* the shutdown emit and aborts the rest of the
  scene transition — which shows up as a black screen on game over, not as an
  obvious crash. Hold your own scene reference plus a `destroyed` flag (see
  `ui/bars.ts`) and unsubscribe in `destroy()`.
- A Scene INSTANCE survives `scene.start()` round-trips: instance fields
  (arrays, scroll offsets, flags) keep their values while every child they
  described is destroyed, and `this.events` listeners registered in
  `create()` stay attached across the restart. Reset per-visit state at the
  top of `create()`, and pair every `this.events.on(...)` with
  `this.events.once(SHUTDOWN, () => this.events.off(...))` — a leaked
  ADDED_TO_SCENE listener holding a destroyed camera blanked a shipped game's
  shop on re-entry, because the fresh camera REUSES the destroyed camera's
  id in `cameraFilter` masks.
