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
npm run verify    # all 6 stages below, every one reported, sim gates LAST
```

### URL parameters

| Param | Effect |
| --- | --- |
| `?debug` | Arcade physics debug bodies, dev only |
| `?d=YYYY-MM-DD` | pins the daily-challenge seed (`core/daily.ts`) |
| `?mute=1` | forces silence for one page load — see below |

**Any agent driving this game in a browser MUST load it muted.** Two agents
browser-testing mid-wave made noise on the user's machine and the user had to
interrupt the run. `?mute=1` is the canonical form. A bare `?mute` works, and
`=true` / `=on` / `=yes` (or any other value) also force silence; only
`=0` / `=false` / `=off` / `=no` mean present-but-OFF, so a driver can
template the value in without rewriting the query string. Values are trimmed
and case-insensitive; the NAME is case-sensitive and has no alias (`silent`,
`nosound`, `muted` are not accepted) — one spelling, because five call sites
wire to it. That truthy/falsy asymmetry is deliberate: with the bare `has()`
test the `?debug` line uses, `?mute=0` would SILENCE the game, which is the
trap a driver templating the value would hit. Read ONCE at module init,
before any scene exists and therefore before any `sfx()` can fire. Unlike
`?debug` it is NOT gated on `import.meta.env.DEV`: cert, fuzz and QA drive
PRODUCTION bundles, and those are exactly the runs that must be silent.

- **Never silence a run by writing the persisted preference.** `?mute` does
  not write through: the key it deliberately leaves alone is `gt:muted`
  (`STORE.muted` under `core/storage.ts`'s `gt:` namespace), which stays
  ABSENT across a whole forced run, and a preference set before a forced run
  survives it unchanged. So a test run cannot permanently mute a real player's
  save and cannot corrupt a wiped-save FTUE run. The param exists precisely
  because the localStorage route races audio init and gets forgotten half the
  time — that race is how the noise happened. Do not "simplify" it back to a
  storage write.
- **Silence must not cost coverage.** Audio stays verified, but ASSERTED
  rather than played. `audioStatus()` — also `window.__AUDIO__()` for a driver
  on a bundled build, which survives minification, same convention as
  `__GAME__` — returns `{ muted, forcedByUrl, storedPreference, masterGain,
  contextState, requested, played, lastRequested }`. Assert silence with
  `forcedByUrl === true`, `contextState === null`, `masterGain === null`,
  `played === 0`; assert coverage with `requested > 0` after gameplay and
  `lastRequested` naming the last voice. `requested` is incremented BEFORE the
  mute check, so "the hit sound fires on a hit" is provable without playing
  it. No spying on `sfx` and no counter to bolt on later.
- **Forced mute and player mute are deliberately NOT the same depth.** Under
  `?mute` no AudioContext is created at all — no master gain, no oscillator,
  no scheduler, and `core/music.ts` bails on its own null-context guard, so
  the music layer is silent at BOOT rather than after a toggle. That is what
  makes `contextState === null` the canonical assertion, and it is stronger
  than "gain 0". A mute from the PLAYER's own preference still builds the
  graph at gain 0, because their next tap on SOUND has to be audible
  immediately. Keep the asymmetry.
- **`isMuted()` is the EFFECTIVE mute** (`forcedByUrl || storedPreference`) —
  that is what a SOUND label must show. There is no `isForcedMute()`
  predicate; read `audioStatus().forcedByUrl`, so the five call sites cannot
  drift. `toggleMute()` records the player's preference and returns the
  effective state, and it derives the new preference from what the player can
  SEE, not from the stored value: under `?mute` the label reads OFF even with
  nothing stored, so a press means "give me sound" and records UNMUTED.
  Flipping the stored value blindly would record the opposite of what the
  button said. The override still owns the session, so the label stays OFF
  while it is active and the preference is honoured on the next ordinary load.

Headless TS runs through Node 24 type stripping:
`node --import ./scripts/ts-resolve.mjs <file.ts>`.

`npm run verify` runs six stages **in order**, each independently reported,
and **none of them short-circuits the others** — the exit code is aggregated
at the end, so a red stage never hides the stages behind it:

1. **typecheck**
2. **content contract check** — the PRD §16.1 types and TUNING paths exist
3. **consumer-edge check** — every exported symbol in a workstream-owned dir
   has an importer OUTSIDE its own dir and selftests, and every TUNING path
   the contract names has at least one reader in `src/`. This is the stage
   that catches a perfectly built thing wired to nothing; five review blockers
   on the last build were all that one shape.
4. **art registry** `--check`
5. **kit selftests**
6. **sim gates** — last, because this is the one stage that legitimately
   ships flagged

Ordering is not cosmetic. When the permanently-flagged sim gates ran first
under `set -e`, their failure skipped the art-registry check and all nine kit
selftests for the whole build.

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
export { GameScene, ART_GROUPS } from '../slices/arena/game';
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
| `src/data/props.ts` | prop and decal definitions (`bodyScale` drives the collision circle). **PLACEHOLDER ROWS, but LIVE** — the arena places them every run and an unresolved `texture` draws `tex-square`; replace them with real generated art (see §Generated art) |
| `src/ui/joystick.ts` | `Joystick`: floating on-screen thumb stick (movement), `vector` carries throttle, `setEnabled` for overlays — re-enabling ADOPTS a pointer that is already down |
| `src/core/controls.ts` | `Controls`: tap / swipe / drag / hold callbacks + `axisX/axisY` keyboard parity |
| `src/core/juice.ts` | `shake`, `flash`, `pop`, `floatText`, `burst`, `hitstop`, `countTo`, `enterFromBottom`, `idleBob`, `starfield`. `flash(scene, color?, durationMs?, peakAlpha = 0.4)` is never opaque — hard-clamped to 0.6 and rate-capped at one flash per 220ms, so a burst of damage events reads as one hit and not a strobe. `enterFromBottom` is for INERT decor ONLY: it slides the hit area with the pixels |
| `src/ui/entrance.ts` | `enterPinningHitArea(scene, obj, opts?) → Tween` — the only entrance helper permitted for interactive objects. `opts`: `delayMs` (0), `distance` (80), `from` (`'bottom'`\|`'top'`\|`'left'`\|`'right'`), `durationMs` (380), `ease` (`'Back.easeOut'`), `fade` (true), `fadeTo` (1), `onComplete`. Animates the VISUAL position only; pins every hit area in the object's tree (rect/circle/ellipse, nested and scaled containers corrected by accumulated scale) at its final rest rect, restores them on complete/stop, and starts alpha at 0.001 rather than 0. It does not tween scale. Template call sites: `menu.ts` play/shop/mute/daily, `gameover.ts` primary/shop/share/menu, `cards.ts` the three upgrade cards + reroll chip — everything else in those files is inert copy and stays on `enterFromBottom` |
| `src/core/audio.ts` | `sfx(name)` — synthesised WebAudio, no files required: `ui tap pickup combo jump hit die levelup whoosh`; `sfxArp`, `isMuted`, `toggleMute`, `onMuteChange`. Generated samples are OPT-IN per name via `src/data/audio.ts` + `initGeneratedAudio()` (called once by `PreloadScene`); anything unregistered keeps its synth voice. `?mute` forces silence for one page load WITHOUT touching the stored preference (§URL parameters), and `audioStatus()` / `window.__AUDIO__()` expose `muted`, `forcedByUrl`, `storedPreference`, `masterGain`, `contextState`, `requested`, `played`, `lastRequested` so a silent run still proves its audio |
| `src/core/textures.ts` | procedural `disc / ring / square / spike / star / particle / panel`; `buildGradient` |
| `src/ui/primitives.ts` | `drawPanel` / `drawPill` / `paintPanel` / `paintPill` — all UI chrome, palette-driven |
| `src/ui/button.ts` | `Button` — primitive capsule, ≥88px tap target, pressed repaint, plays `sfx('ui')` |
| `src/ui/hud.ts` | `Hud` — hp/xp bars, level, run timer, currency, kills, phase label; fed a diffed `HudModel` via `set(model)` each frame |
| `src/ui/bars.ts` | `Bar` — HP / XP / progress bars: primitive housing + texture-scaled fill |
| `src/ui/cards.ts` | `showUpgradeCards(scene, choices, onPick, opts)` — pick-1-of-N overlay with rarity chips and an optional one-per-draft reroll (`TUNING.draft.rerollCost`) |
| `src/ui/pauseOverlay.ts` | `showPauseOverlay(scene, {onResume, onRestart, onMenu?})` — dim + Resume/Restart/**Menu**/Mute; the MENU row renders ONLY when `onMenu` is passed (and every slice passes it: the run's exit door), and the caller owns the teardown before `scene.start(SCENES.menu)` |
| `src/ui/sagaMap.ts` | `showSagaMap(scene, opts)` — scrolling level path with star ratings and lock states; the meta shape for B/C/H |
| `src/ui/boosterBar.ts` | `showBoosterPicker(scene, opts)` pre-level gate + `showBoosterTray(scene, opts)` in-level tray, both ICON-ONLY square slots (glow/plate/count badge) sharing one tooltip (`BOOSTER_BLURB[id]`, SAFE-aware flip, 3s auto-hide, never interactive). A name is never a permanent label. Both return `bounds` for a coach mark; `BoosterGlyph.art` degrades to the tinted `TEX` primitive when its slot is unloaded |
| `src/ui/coach.ts` | `showCoach(scene, {id, target, text, mode, isLive?, onExpire?})` / `hasSeenCoach(id)` — FTUE coach marks: 4-rect dim + spotlight cutout, pointer hand placed BESIDE the spotlight (never over it, bob travel included), one-line card; `'tap'` or `'swap-gate'` (the dim rects ARE the input gate); one-shot `tut:<id>` flags via `core/storage`. `isLive` is polled every 120ms and retires the beat (killing every loop) when it returns false, firing `onExpire`; `CoachHandle.spend()` is the imperative equivalent and is NOT a success — `onDone` stays silent |
| `src/ui/background.ts` | `addBackground(scene)` — parallax `bg-layer-0/1/2` (cover-fit, camera scrollFactors) → single `bg-arena` → procedural gradient+starfield fallback |
| `src/ui/background.ts` scrim | the generated-backdrop branch adds a `bgDeep` veil at depth -190 (full frame 0.45 + heavier top/bottom bands) — generated art is brighter than the gradient the UI was designed against, and ink text needs a guaranteed dark surface |
| `src/core/music.ts` | generative music, zero assets by default: `startMusic('menu'\|'run')`, `setMusicIntensity(0..1)`, `setMusicLayer('boss', on)`, `stopMusic()`; muted together with sfx. Registered stems in `src/data/audio.ts` (`menu`, `game-low`+`game-high`, same key/tempo/bar length) replace the synth score per mood and crossfade at intensity ~0.55; a missing/undecodable file warns once and falls back to synth |

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
| `src/core/telemetry.ts` | `track('<event>')` → GoatCounter event `ev/<slug>/<event>`; silent no-op without the injected snippet, one deferred retry per page load |
| `src/core/daily.ts` | UTC daily challenge: `sessionSeed()` (every slice's `init` seed default), `?d=YYYY-MM-DD` link pinning, `isDailyMode()`/`setDailyMode()`, per-day `loadDailyBest()`/`saveDailyBest()` |
| `src/core/share.ts` | `shareResult({score, won})` → native share sheet, clipboard fallback, `'unavailable'` when neither is permitted; fires `track('share')` itself |
| `src/core/wake.ts` | `armWakeLock()` — one call from `main.ts`: first-gesture Screen Wake Lock + re-acquire on tab return; no scene requests its own. `armLoopVisibility(loop)` — the LEVEL-triggered tab-visibility policy for `game.loop`, also called once from `main.ts`; idempotent, structurally typed (`{running, sleep(), wake()}`) so this file still imports nothing. It is the ONLY permitted caller of `loop.sleep()`/`loop.wake()` |
| `src/data/enemies.ts` | archetypes as `{ base, behaviour, ... }` incl. `healer` aura, telegraphed `charge`, 3-phase `boss` (`TUNING.boss`: volley → summon+shield → enrage ring), `eliteDrop` coins; `scaleEnemy(def, difficultyMul)` |
| `src/data/weapons.ts` | `WeaponDef` catalog: `bolt / orbit / nova / rail` + evolutions; per-weapon numbers in `TUNING.weapons`; patterns implemented in `systems/combat.ts` |
| `src/data/upgrades.ts` | card pool with `kind: 'stat' \| 'weapon-unlock' \| 'weapon-boost'`, slot/ownership gating via `UpgradeRollContext`, 2 legendary `effect` cards, meta upgrades, `rollUpgradeChoices()`, boot-time `validateUpgradeStats` |
| `src/core/effects.ts` | `EFFECT_HOOKS` registry consuming `UpgradeDef.effect` (`glass-cannon`, `bulwark`) — behaviour cards, not stat tweaks |
| `src/data/waves.ts` | reference 480s run: phases, waves, `TIMELINE_EVENTS` (2 chests, breather, elite-rush) |
| `src/objects/coin.ts`, `src/objects/blade.ts` | pooled elite-drop currency pickup; pooled orbit blade |
| `src/sim/*` | headless balance sim over the REAL data. `families/<code>.ts` holds one family's bots/solvers and gates (`board` greedy-vs-random solver ladder, `hyper` skill-parameterised session length, `idle` economy curves and prestige floor, `table` dice win-rate band, `word` bank integrity + accuracy bots over all five packs, `side` generator validation + hop bot, `track` lap completion + bot spread); `arena` is `cli.ts`'s own lane pipeline; `family.ts` holds the scaffolded default; `kits/*.selftest.ts` guard the shared kits |
| `src/scenes/*` | `boot → preload → menu → meta → game → gameover` wired with fades. `meta.ts` is the SHOP: a drag-scrolled row list clipped by its OWN camera viewport (a real GPU scissor — Phaser 4 has no `setMask`), identity scroll, mutual `ignore` with the main camera, re-hooked per visit. `gameover.ts` obeys one CTA law: `won && next` → PLAY NEXT (`levelIndex`), `won && !next` → PLAY AGAIN (the retry action relabelled, plus the neutral `ALL CLEAR!` note), a loss → RETRY (same seed) — SPACE always mirrors the primary, and the shop pill is labelled SHOP everywhere, never UPGRADES. It also closes the funnel: one `win-<level>`/`loss-<level>` event per run (plain `win`/`loss` when the family passes no `level`), `retry` on the seed-replay CTA, the per-day best via `saveDailyBest` in daily mode, and a half-width SHARE next to SHOP (label flashes COPIED!/NO SHARE) — read back with `node scripts/telemetry-pull.mjs --slug <slug>` |

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

### Player platform (ships in every game, degrade-to-nothing by design)

- **PWA shell.** `public/manifest.webmanifest` (name = game title, portrait,
  standalone) + `public/sw.js` (`game-v1` cache: navigation network-first,
  hashed Vite output immutable, other public/ paths stale-while-revalidate) +
  icons built from the logo. `main.ts` registers the worker in PROD builds
  only — dev stays uncached; `vite preview` on localhost does register, so
  browser-driving harnesses purge SW + caches before measuring a boot
  (`cert-driver.mjs` does this in both `runCert` and `runFuzz`).
- **Keep the tones in sync**: `index.html` `<meta name="theme-color">`, the
  manifest `theme_color`/`background_color` and the page background all equal
  `PALETTE.bgDeep` (`#05070d`) — repaint all four together in Step 5.5.
- **Haptics ride the juice layer**: `shake()` and `hitstop()` fire a
  throttled `navigator.vibrate` (≥120ms apart). Never add per-callsite
  vibration — call the juice helpers.
- **Wake lock has one owner**: `armWakeLock()` in `main.ts`.
- **Tab visibility has one owner too**: `armLoopVisibility(game.loop)` in
  `main.ts`. **Never hand-roll a `visibilitychange` → `loop.sleep()` /
  `loop.wake()` pair** — that idiom is the defect, not the fix, and it wedged
  a shipped build into a permanent freeze on a page reporting itself visible
  (mechanism in §Common Phaser 4 traps). The only permitted call sites for
  `loop.sleep`/`loop.wake` are inside `wake.ts`'s `sync()`; grep `src/` and
  there should be no others.
- **Telemetry events are a fixed vocabulary** — `session-start`,
  `daily-start`, `win[-<level>]`, `loss[-<level>]`, `retry`, `share` — fired
  from `menu.ts`/`gameover.ts`. A new surface adds an event only together
  with a funnel reading in `scripts/telemetry-pull.mjs`; never rename
  existing events (they are the cross-release retention baseline).
- **Daily seed is the session default**: every slice's `init` takes
  `data.seed ?? sessionSeed()`. Never reintroduce `Date.now()` seeding in a
  slice — it silently breaks the daily challenge and `?d=` share links.

### Generated art (vibrant 2D chibi)

| File | Role |
| --- | --- |
| `art/style.json` | the project's `sprite-forge.style.v1` contract — every asset is generated against it |
| `art/manifest.json` | asset plan per group (hero, enemies, FX, UI, backdrop) |
| `public/assets/generated/**` | exported sheets, frames, GIFs, `sprite-metadata.json` |
| `src/data/art.ts` | **GENERATED** registry (`node scripts/gen-art-registry.mjs`, `--check` guards drift in `npm run verify`) — texture keys, frame geometry, per-action `scale`, `facesRight`, `ICON` frames. Never hand-edit; edit `art/manifest.json` and regenerate |
| `src/scenes/preload.ts` | loads the registry rows whose `group` is in the active slice's `ART_GROUPS` (re-exported by `src/scenes/game.ts`) and creates one animation per animated sheet |

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
- **The template's content tables are placeholders that are LIVE.**
  `src/data/props.ts` ships four rows (`prop-rock`, `prop-crystal`,
  `prop-pillar`, `prop-stump`) and `enemies.ts` / `waves.ts` / `upgrades.ts`
  ship reference content. These are not inert examples: `systems/arena.ts`
  places them every run, and a row whose `texture` key is not in the loaded
  registry silently draws the tinted procedural `tex-square` instead. That is
  exactly how a shipped build put 72 generated prop cells on disk under
  `public/assets/generated/props/**` and drew squares on the field — in a game
  whose PRD forbade procedural gameplay art — while §19 acceptance (prose
  checkboxes) reported green. Replacing every placeholder row with real art is
  part of implementing the PRD, and it is checkable two ways, both required:
  - **Static, and gated:** `node scripts/release-check.mjs <slug>` FAILS when
    a gameplay texture key resolves to no generated art — every
    `texture: '<key>'` literal and every `ArtSlot` `{ key: '<key>' }` in
    `src/`, plus every `TEXTURE`/`ANIM`/`ICON` alias the code reads, must
    have a row in the generated `src/data/art.ts`. The untouched template
    passes — its registry declares all six placeholder keys, so it is
    internally consistent, as it must be. The failure appears the moment a
    game REGENERATES its prop art and keeps this `props.ts`: the registry is
    now 103 rows of `props-<zone>-<n>` and the six template keys resolve to
    nothing, which is exactly what shipped. That is the defect stated as a
    failure instead of a checkbox. A key that resolves nowhere is a defect,
    not a fallback. The same check WARNS on the other direction — generated
    sheets nothing in `src/` ever names, 37 of 103 on the last build — so an
    art run that produced work the code never plays is visible too.
  - **Runtime:** dump the running scene's display list in a browser and count
    gameplay objects whose texture key starts `tex-`. When the PRD forbids
    procedural art that count is **0**. `fallbackTint` exists so a missing
    sheet degrades instead of crashing — it is never the shipping path.

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
4. **Systems live in `src/systems/`** as classes taking their
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
- **A gated action accepts EVERY documented input, not the one the designer
  pictured.** Anything that blocks progress until the player acts — an FTUE
  beat, a tutorial gate, a "move to begin" — tests the UNION of the inputs the
  PRD documents: `joystick.vector` **or** `controls.axisX/axisY` for movement,
  tap **or** SPACE/ENTER for a CTA. Gating the first movement beat on
  `joystick.vector` alone soft-locked keyboard-only players FOREVER on the
  first screen of the game, run clock frozen at 0.00s, no way forward and no
  way out — while the next lines of that same `update` read `controls.axisX`
  to drive the player. The check is mechanical: for every early-return on an
  input read inside a gate, grep the same function for the other input source.
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
- **An entrance may move pixels, never hit areas.** Use
  `enterPinningHitArea(scene, obj, opts?)` from `src/ui/entrance.ts` for
  anything tappable: it animates the VISUAL position only, and the interactive
  hit area is set once at the FINAL rest position before the tween starts, so
  the control accepts taps at its landing rect from frame one — entrance delay
  included. It is the only entrance helper permitted for interactive objects.
  **Call it LAST, after the object's interactive state has SETTLED.**
  `setInteractive()` and `disableInteractive()` each REPLACE the input object
  and therefore the hit area, and the helper pins the areas it finds at call
  time — so pinning first and deciding enabled/disabled second pins an area
  that no longer exists, and the control slides again. In `cards.ts` the
  chip's entrance is the last statement of the layout function, below both
  calls.
  **An entrance must not lie about state, either.** `fadeTo` (default 1) is
  the alpha the control LANDS on, and it exists because a control can arrive
  already disabled: the draft's reroll chip rests at alpha 0.4 when the player
  cannot afford it, so an entrance hard-coded to fade to 1 would fade a
  DISABLED control up to look fully available — the animation silently
  contradicting the "refused affordance is DEAFENED" rule below. `cards.ts`
  passes `fadeTo: rerollButton.alpha`. Do not "simplify" the field away.
  `core/juice.ts`'s `enterFromBottom` tweens the object's own `y`, which
  drags the tap target along with the pixels; keep it for headings,
  labels and other inert decor. Measured cost of getting this wrong: the menu
  CTA ate the first 1-3 taps across four cold starts, plus one automated
  attempt that tapped PLAY's final position and then sat on the menu for 300s.
  Measured proof of the fix, same control and same coordinate, tapped 60ms
  into a 160ms delay: `enterFromBottom` 0 pointerdowns, `enterPinningHitArea`
  1 pointerdown with `scene.isActive('Game')` true 900ms later — the
  mid-entrance tap actually started the run.
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
- **Exactly one overlay owns the screen, and the owners are enumerated by
  name.** List them explicitly — pause, the upgrade/draft picker, the coach
  beat, the booster picker — and make each one REFUSE to open while another
  holds the run. Naming only the coach is how this shipped broken:
  `togglePause` guarded on the coach hold and not on `drafting`, so pause
  opened on top of a live draft and the two drew through each other (pause
  chrome at depth 2100 over cards at 2000, both unreadable), one tap away for
  the ~13 drafts of every run. A draft is itself a stopped clock, so refusing
  costs the player nothing.
- **A refused affordance is DEAFENED, not merely ignored.** A control that is
  illegal under the current overlay goes visibly dim (≈0.28 alpha) **and**
  `disableInteractive()` for the duration. Refusing the tap inside the handler
  is not enough: a lit, full-opacity icon above the dim is a promise the game
  does not keep — the player aims, taps, and nothing happens. Drive it from a
  mirrored boolean so the object is touched on transitions only (~26 times a
  run, not 60 times a second), and reset that mirror at the top of `create()`
  — the scene instance survives `scene.start`, so a stale `false` leaves the
  icon permanently deaf on the second run.
- **`setEnabled(true)` must handle a pointer that is ALREADY held.** Phaser
  emits no fresh `POINTER_DOWN` for a finger that never lifted, so a control
  re-armed under a held thumb stays dead until the player lifts and presses
  again — input the game has swallowed. Factor the bind out of the
  `POINTER_DOWN` handler and call it from the enable path over
  `scene.input.manager.pointers` (mouse plus every touch pointer —
  `activePointer` alone can be a lifted pointer or the wrong one of two
  thumbs), taking the first that `isDown` and arms through the same refusals
  (disabled / already bound / outside the control zone). Adopt the pointer at
  its CURRENT position, so the control starts neutral (`vector` 0,0) and
  answers on the first movement: the tap that dismissed the overlay must not
  become a steering input. Closing a draft with
  the thumb still down left the player unable to move out of whatever had
  surrounded them, and the `tut:stick` beat — which dismisses on the taught
  drag and on nothing else — hung for 120s for any first-time player already
  touching the screen when it opened.
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
- **Bank before you clear — settlement is ordered by dependency.** The durable
  write happens FIRST, in the scene that owns the data, synchronously; the
  volatile journal that fed it is torn down only once that save has taken.
  `finish()` cleared the run journal and left banking to `GameOverScene`, on
  the far side of a 340ms fade and a `scene.start` — so for ~360ms plus a
  scene boot the in-flight marker was gone AND the haul was not yet banked,
  and the freeze this build shipped with landed inside precisely that window
  and destroyed the player's entire run with nothing left to recover it from.
  Ordered correctly, the worst case is a bounded double-settle on the next
  boot instead of an unbounded loss. Never carry unbanked state across a
  scene transition, a fade or a `delayedCall`.
- **Every game teaches itself (FTUE).** First session gets a coach-mark
  sequence on level/run 1 (dim + spotlight + one-liner: goal surface,
  resource, one gated first action), and every new mechanic gets a one-beat
  callout on its debut level. Build it with `ui/coach.ts` (`showCoach` /
  `hasSeenCoach`) — never a bespoke overlay. Beats show once per save
  (persisted `tut:<id>` flags), pause the game while visible, never stack,
  and destroy cleanly. A game without a tutorial fails the game-build
  Step 5.5 audit.
- **A beat whose target can vanish MUST be able to expire.** A coach mark
  spotlights something; if that something has its own clock — a gate that
  closes, a pickup that despawns, an enemy that dies, a timed offer — the beat
  can outlive it and then holds a paused run hostage pointing at nothing.
  Every such beat passes `isLive: () => boolean` to `showCoach` (polled every
  120ms; false retires the beat, kills its loops and fires `onExpire`) or the
  owner calls `CoachHandle.spend()` when it learns the target is gone.
  Expiring is NOT completing: `onDone` stays silent, so a beat the player
  never actually performed is not recorded as taught. The check is mechanical:
  for every `showCoach` call, ask what destroys its `target` — if anything
  can, `isLive` or `spend()` is mandatory.
- **Pool everything hot.** Above ~50 spawns/minute use `Pool`/`SpritePool`. Above
  ~150 simultaneous entities use `SpatialHash` instead of per-pair overlaps.
- **60fps at the PRD's peak entity count.** No `Graphics` redraw per frame, no new
  tween per frame, no `text.setText` with an unchanged value, no `filter`/`map` in
  update loops.
- **The DIFF must not allocate either.** A widget that repaints only on change
  still runs its comparison 60 times a second, so the comparison is itself on
  the hot path. Building a key string to compare against the last one —
  `` `${slots}|${used}|${tiers.join(',')}` ``, or formatting a label just to
  see whether it changed — allocated 60-120 short-lived strings a second on
  the one path this rule exists to protect, to discover that 59 of every 60
  were identical. Cache the inputs as primitive fields (`lastPercent = -1`,
  `lastSlots = -1`) plus an element-wise walk of any small array, and snapshot
  into a REUSED array (`last.length = next.length; for (…) last[i] = next[i]`),
  never a fresh one.
- **Every gameplay event gets feedback:** one of `shake / pop / flash / burst /
  floatText / hitstop` plus one `sfx()`, respecting the PRD's spam caps (damage
  numbers per second, no shake at very high entity counts). Persistent states
  are designed too: earned specials pulse/glow while idle (loop tweens killed
  on recycle), and the selection highlight is themed, never a default circle.
  Feedback never blinds: `flash()` peaks at 0.4 alpha, is hard-clamped to 0.6
  and rate-capped to one flash per 220ms, so a burst of damage events reads as
  one hit rather than a strobe — go through the juice helpers and never write
  a full-screen white rect of your own.
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
- **A selftest asserts the INVARIANT, never today's constant.** The migration
  test's invariant is "a v1 save lands on the CURRENT version", so it asserts
  `migrated.version === DEFAULT_META.version` — never `=== 2`. A frozen
  literal turns the next legitimate `META_VERSION` bump into a red selftest
  for the wrong reason, and the agent who then "fixes" it by bumping the
  literal has quietly disabled the check that was there to catch a broken
  migration chain. Same rule for any selftest naming a number the source owns:
  read it from the source (`src/sim/kits/metakit.selftest.ts` is the pattern).
- **Determinism where it matters:** anything that must be reproducible uses `Rng`,
  never `Math.random`.
- **No new dependency** without a reason the template cannot cover.
- **"Grep found nothing" is not evidence that a thing is absent.** Skills,
  plugins and tools that run against this repo are not necessarily inside this
  checkout: `skill://sprite-forge` and `skill://map-forge` resolve into a
  separate out-of-tree repository, while `.claude/skills/` here holds only
  `game-art`, `game-build` and `game-prd`. A recursive grep from the repo root
  therefore returns zero hits for code that exists and runs, and a symlinked
  or mounted path is not traversed at all by default. Before writing "feature
  X does not exist": resolve the URL (`read skill://<name>`), `ls -la` the
  directory you searched to see whether it is a link or a mount, and state
  WHERE you looked. A false "feature absent" claim was filed on this build in
  exactly this way.
- **The harness must not produce side effects on the user's machine that the
  user did not ask for.** You are driving a real browser on someone else's
  desktop while they work. Sound is the instance that actually bit — two
  agents browser-testing mid-wave made noise and the user had to interrupt the
  run — but the rule is general and covers stealing focus, opening windows,
  and writing anywhere outside the workspace. Load every automated run with
  `?mute` (§URL parameters), never by writing the persisted preference, and
  assert audio through `audioStatus()` instead of playing it.
- **`npm run verify` must pass** — all six stages (§Commands: typecheck,
  content contract, consumer edges, art registry, kit selftests, sim gates),
  and you must play the full loop of your family in a browser before claiming
  done, with `?mute` in the URL — menu → session → the family's
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

### Lifecycle, physics and silent-substitution traps

Every trap below was measured on a shipped build, and none of them produced a
visible error. They are grouped because they share a failure mode, not an API:
the code reads correct, `tsc` is satisfied, every gate is green, and the game
quietly does the wrong thing — or stops being a game at all.

- **Arcade sets `gameObject.body` to `undefined`, not `null`, at world
  teardown.** A teardown-reachable guard MUST be `?.` or a plain truthiness
  check. `if (body !== null)` PASSES on `undefined`, `setVelocity` then throws
  *inside* the SHUTDOWN handler, and that throw aborts
  `SceneManager.processQueue` — so the queued next scene never starts and the
  game FREEZES on its last drawn frame, with zero live scenes and dead input.
  Nothing in the console names a scene; the game simply stops being a game.
  This is not a hypothetical and it was not cheap: it shipped, it fired on
  every run end that left a pickup on the floor, and it destroyed the player's
  entire haul. Four agents reproduced it independently and **the first fix was
  also wrong** — it swapped one identity comparison for another. That near
  miss is the actual lesson: when a teardown path throws, do not narrow the
  guard, DELETE the identity comparison. Any `x !== null` on a Phaser-owned
  handle inside a `despawn` / `destroy` / `teardown` path is this same defect
  in different clothes. `this.body?.setVelocity(0, 0)` is the shape that is
  always right.
- **`alpha === 0` removes an object from the hit map.** Phaser skips
  hit-testing anything whose `willRender` is false, and zero alpha clears that
  flag — so a control parked at its final rect but faded in from 0 through an
  entrance delay is not merely invisible, it is ABSENT from input. Start such
  a fade at `0.001`: `0.001 * 255` rounds to 0 on an 8-bit channel, so it is
  visually identical to transparent and behaviourally the opposite. Measured
  directly here as `willRender: false` with the tap ignored, and the same tap
  60ms later — once the tween had nudged alpha off zero — starting the scene.
  `ui/entrance.ts` already does this; see the entrance rule in
  §Non-negotiable rules.
- **`scene.start(key)` with NO payload reuses the PREVIOUS payload.**
  `this.sys.settings.data` is NOT cleared when a scene is started again
  without an argument, so a screen that reads its parameters out of scene data
  — level index, zone, seed, difficulty rung, which gate was taken — silently
  re-runs the LAST payload instead of a fresh default. A bare
  `scene.start(SCENES.game)` after a RETRY that passed `{seed}` replays that
  seed and boots straight into the previously requested content. **It does not
  look like a data bug, which is why it costs hours**: the symptom is "PLAY
  skipped the map", so it gets chased in the map/picker screen, which is
  innocent. The cert files it as `flow:map-bypassed`, and the driver keeps
  `sceneData: { ...(s.sys.settings.data ?? {}) }` in its state snapshot so the
  real cause is visible in the report. Two rules make it mechanical:
  1. A scene that takes a payload reads it in `init(data)` and normalises
     EVERY field there against an explicit default (`this.level =
     data.level ?? 0`) — never lazily off `this.sys.settings.data` later in
     `create()`.
  2. Every `scene.start(key)` passes an explicit payload object, even for the
     empty/default case (`scene.start(SCENES.game, { level: 0 })`). A bare
     `scene.start(key)` on a payload-taking scene IS the bug — grep for one.

  Then type the payload at the CALL SITE (`const data: GameOverData = { … }`):
  `scene.start` takes a bare `object` and the receiving `init` takes a
  `Partial`, so a field the sender forgets defaults SILENTLY on the far side —
  that seam is how a perfect extraction banked zero. Annotating the literal is
  what makes `tsc` the guard on the seam instead of a playtest.
- **A component's `destroy()` can re-enter the scene that is tearing it
  down.** A well-behaved overlay un-pauses the run on `destroy()` so an
  abandoned beat cannot freeze the game — correct during play, wrong on
  SHUTDOWN, where it calls `director.resume()`, `combat.setPaused(false)` and
  `joystick.setEnabled(true)` against a scene whose children are already being
  destroyed. Set `this.tearingDown = true` as the FIRST statement of
  `teardown()`, before any `destroy()` call, and return early on it from every
  resume/pause path. Ordering is the whole rule: a flag set after the first
  `destroy()` is not a flag.
- **MODULE-level state outlives a scene swap.** A scene that installs a
  closure over one of its own fields into a module singleton —
  `setDamageClock(() => this.simTimeMs)` is the shipped example — leaves the
  DEAD scene's field feeding the next scene after the swap. The next `Health`
  then reads a FROZEN clock, so every i-frame window it opens never closes and
  nothing in the new run can be hit. Pair every `set*` on a module singleton
  with its `reset*` in `teardown()`, and ship that `reset*` next to the setter
  so the obligation is visible from the call site (`core/damage.ts`). The same
  class covers module `let` registries, `document`/`window` listeners (which
  are not on the scene's bus and will happily fire into a dead scene) and any
  cache keyed by something the scene owns.
- **`setPosition` on a body-bearing sprite does not move the body.** It writes
  the GameObject transform only: `body.position`, `body.prev`, `prevFrame` and
  `body.center` all keep the OLD values until the next `preUpdate` resyncs
  them. So for the rest of that frame the world resolves collisions, world
  bounds and overlap queries against where the sprite USED to be, and
  `postUpdate` then adds `body.position - prevFrame` — the pre-teleport step
  plus any separation computed at the old spot — on top of your new transform,
  which is the visible rubber-band. The retained velocity keeps pushing in the
  old direction on top of that. Move both, in one call:
  `this.setPosition(nx, ny); this.body?.reset(nx, ny);` — `Body.reset` stops
  the body, re-derives `position` from the object, copies it into
  `prev`/`prevFrame`, rebuilds bounds and centre, rechecks world bounds and
  clears the collision flags, so the frame's delta is zero and nothing is
  owed. `reset` moves the game object itself too, so the leading `setPosition`
  is what still places the sprite on a frame where the body is already gone —
  keep both, and keep the `?.` (see the first trap in this section). Required
  for every teleport: blink, respawn, screen wrap, snap-to-grid.
- **Two id namespaces both typed `string` compare cleanly and match
  nothing.** This build compared an ENEMY id against a GATE id: `tsc` was
  satisfied, `.find()` returned `undefined`, the guarding
  `if (x === undefined) return;` swallowed it, and an entire authored beat
  simply never happened — no error, no log, a green build, and content the
  player paid for in design time that they could never see. Give every id set
  a union or branded type (`type GateId = 'a' | 'b' | 'c'`) so the compiler
  rejects the crossover, and make any lookup that MUST hit throw or
  `console.error` instead of returning early. A silent `return` on a missed
  lookup is how content goes missing without one red pixel.
- **Liveness restored by an EVENT EDGE is liveness you do not have.** The
  four-line idiom everyone writes — `document.addEventListener(
  'visibilitychange', () => document.hidden ? game.loop.sleep() :
  game.loop.wake())` — is a wedge. `TimeStep.sleep()` calls `raf.stop()`, so
  the requestAnimationFrame chain is DESTROYED and nothing on earth restarts
  it except a later `wake()`. Liveness now depends on a second event arriving,
  and Chrome coalesces and reorders visibility notifications around focus
  changes and under heavy input dispatch, so that second edge can simply never
  come. The game then sits dead forever on a page that reports itself VISIBLE,
  with every scene still "active", no exception anywhere and nothing in the
  console — a player who tabbed away and came back is just stuck. Measured on
  both the dev server and the minified production build: with the wake event
  dropped, the edge-triggered loop stays at `running:false, raf:false` and
  `loop.time` frozen forever, while the level-triggered one heals with no
  event at all. Call `armLoopVisibility(game.loop)` (`core/wake.ts`) instead:
  `sync()` reads the visibility that is true NOW and makes the loop match, and
  is re-run on `visibilitychange`, `focus`, `pageshow`, `resume` and a 1s
  poll, so a dropped edge can only delay the resume (measured 201ms prod /
  1012ms dev, and a normally delivered pair still wakes immediately with no
  1s wait) instead of being fatal. The cost is one boolean comparison per
  second. Sleeping while HIDDEN is kept deliberately — a backgrounded run must
  not advance — so only the RESTORE stops being a guess. **The general rule:
  when the cost of a missed event is permanent, poll the STATE; never trust
  the EDGE.** Mechanically checkable: `grep` `src/` for `loop.sleep`/
  `loop.wake` and the only hits outside `wake.ts` should be none.
