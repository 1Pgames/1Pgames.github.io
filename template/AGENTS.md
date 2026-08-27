# Build instructions for the agent

Portrait **720×1280 (9:16) Phaser 4 + Vite + TypeScript** template for **complex
indie-genre games** — survivor-like, action roguelike, tower defense, survival,
tactics, deckbuilder, auto-battler — with **5-10 minute runs** and meta
progression between runs. The spec for the game you are building is `PRD.md` in
this folder. Implement it **inside this structure**; do not restructure the
project.

## Commands

```bash
npm install       # once
npm run dev       # http://localhost:5173
npm run typecheck # tsc --noEmit — must be clean
npm run build     # typecheck + production bundle
```

`?debug` in the URL enables Arcade physics debug bodies in dev.

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
| `src/ui/hud.ts` | `Hud` — score / combo / lives, driven by `RunState` events |
| `src/ui/bars.ts` | `Bar` — HP / XP / progress bars: primitive housing + texture-scaled fill |
| `src/ui/cards.ts` | `showUpgradeCards(scene, choices, onPick)` — pick-1-of-3 overlay |
| `src/ui/background.ts` | `addBackground(scene)` — gradient + drifting dots |

### Systems (the reason this template exists)

| File | Role |
| --- | --- |
| `src/core/stats.ts` | `StatBlock` + `Modifier`: `(base + Σadd) * Π(1+mul)`, memoised — the backbone of upgrade builds |
| `src/core/damage.ts` | `Health` (i-frames, idempotent death), `rollDamage` (crit), `applyDot` |
| `src/core/pool.ts` | `Pool<T>` (zero-allocation free list), `SpritePool` for arcade sprites |
| `src/core/spatial.ts` | `SpatialHash` broad phase — mandatory above ~150 entities |
| `src/core/grid.ts` | `NavGrid` BFS flow field — tower-defense/dungeon pathing |
| `src/core/run.ts` | `RunDirector`: declarative `WaveSpec[]` + `RunPhase[]`, difficulty multiplier, delta-driven (pause-safe) |
| `src/core/progression.ts` | versioned `MetaSave`: currency, unlocks, purchased upgrades, `metaModifiers()` |
| `src/core/state.ts` | `RunState`: score, lives, combo, elapsed, run-ended events |
| `src/core/rng.ts` | seeded `Rng` (`float/int/chance/pick/pickWeighted/shuffle`), `dailySeed()` |
| `src/core/storage.ts` | namespaced, throw-safe localStorage |
| `src/data/enemies.ts` | enemy archetypes + `scaleEnemy(def, difficultyMul)` |
| `src/data/upgrades.ts` | in-run upgrade pool + meta upgrades + `rollUpgradeChoices()` |
| `src/data/waves.ts` | reference 480s run: phases and waves |
| `src/scenes/*` | `boot → preload → menu → meta → game → gameover` wired with fades |

### Generated art (vibrant 2D chibi)

| File | Role |
| --- | --- |
| `art/style.json` | the project's `sprite-forge.style.v1` contract — every asset is generated against it |
| `art/manifest.json` | asset plan per group (hero, enemies, FX, UI, backdrop) |
| `public/assets/generated/**` | exported sheets, frames, GIFs, `sprite-metadata.json` |
| `src/data/art.ts` | registry: texture keys, frame geometry, animation keys, `ICON` frames, `CHROME` nine-slice geometry |
| `src/scenes/preload.ts` | loads every registry row and creates one animation per animated sheet |

Regenerating or adding art is the `game-art` skill's job, not hand-drawing:
`.claude/skills/game-art`. Rules that matter when you touch it:

- Entity size comes from `TUNING`, never from the art; hitboxes are set in
  source-cell pixels and are deliberately smaller than the sprite.
- Generated actions of one character do NOT fill their cell to the same height
  (measured hero subject heights: idle 171, run 146, attack 162, hurt 165 in a
  256px cell). Every animated asset therefore carries `scale` in
  `src/data/art.ts` (`idleHeight / thisHeight`), re-applied on each animation
  switch — otherwise the character visibly shrinks when it starts running.
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
2. **`TUNING` in `src/config.ts`** gets every number from the PRD's balance
   table. Nothing balance-related is hardcoded anywhere else.
3. **Content lives in `src/data/`** as plain data records (enemies, upgrades,
   waves, towers, items) — never as `if` chains in scenes.
4. **Systems live in `src/systems/`** (create it) as classes taking their
   dependencies in the constructor. They must be Phaser-light: gameplay maths in
   pure TS, Phaser only for rendering/physics.
5. **Entities live in `src/objects/`**, one class per file, extending
   `Phaser.Physics.Arcade.Sprite` or `Phaser.GameObjects.Container`, each owning a
   `StatBlock` and a `Health` where applicable.
6. **`GameScene` is the integrator**: it wires director → spawner → combat → UI.
   Keep the block marked `BEGIN/END replaceable gameplay` as the seam.
7. **Meta layer**: read/write only through `core/progression.ts`; bump `version`
   and add a migration when the schema changes.
8. **Repaint** `PALETTE`/`CSS` and `index.html`'s `<title>`, and update the menu
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
  centred but only accepts clicks at the camera's world offset.
- **Tappable UI uses click semantics, never release semantics.** Phaser
  dispatches `POINTER_UP` to whatever is under the pointer, so a control must
  arm on its own `POINTER_DOWN` and disarm on `POINTER_OUT` before acting —
  otherwise letting go of the stick over a freshly opened overlay picks a card
  for the player. `ui/button.ts` and `ui/cards.ts` already do this; copy the
  pattern for any new interactive object.
- **Pool everything hot.** Above ~50 spawns/minute use `Pool`/`SpritePool`. Above
  ~150 simultaneous entities use `SpatialHash` instead of per-pair overlaps.
- **60fps at the PRD's peak entity count.** No `Graphics` redraw per frame, no new
  tween per frame, no `text.setText` with an unchanged value, no `filter`/`map` in
  update loops.
- **Every gameplay event gets feedback:** one of `shake / pop / flash / burst /
  floatText / hitstop` plus one `sfx()`, respecting the PRD's spam caps (damage
  numbers per second, no shake at very high entity counts).
- **A run must be completable** in the PRD's target window, with win and loss both
  reachable, and one-tap retry.
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
- **`npm run build` must pass** with zero TypeScript errors, and you must play the
  full loop in a browser (menu → run → upgrade draft → finale → results → retry)
  before claiming done.

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
  (`obj.filters.internal.addMask(...)`). For a short scrolling list prefer
  visibility culling (see `scenes/meta.ts`) over a filter.
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
