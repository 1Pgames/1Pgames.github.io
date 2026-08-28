# Phaser 4 integration

The integrator wires generated assets into the project. Generation agents never
touch source files; this step is serial and owned by one agent.

## 1. Asset registry (`src/data/art.ts`, generated)

`src/data/art.ts` is **generated**, never hand-transcribed. One record per
generated asset, produced by `scripts/gen-art-registry.mjs` from
`art/manifest.json` plus every asset's `sprite-metadata.json`:

```ts
export interface SpriteAsset {
  /** Phaser texture key; also the animation key when `frames > 1`. */
  key: string;
  /** `art/manifest.json` group; loaded only when the active slice lists it. */
  group: string;
  /** Path under `public/`, loaded as-is by the loader. */
  path: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  /** ms per frame; ignored when `frames === 1`. */
  duration: number;
  loop: boolean;
  /** Per-action display-size compensation; see `baseAction` below. */
  scale?: number;
  /** Whether the unflipped art faces right; default true. */
  facesRight?: boolean;
}

export const SPRITES: readonly SpriteAsset[] = [ /* multi-frame, animated */ ] as const;
export const IMAGES: readonly SpriteAsset[] = [ /* single-frame, static */ ] as const;
```

To add or change an asset: edit `art/manifest.json` (id, grid, `facesRight`,
`baseAction`, `textureAlias`/`animAlias`, `icons`), export or re-export the
sheet, then regenerate from `template/`:

```bash
node scripts/gen-art-registry.mjs         # writes src/data/art.ts
node scripts/gen-art-registry.mjs --check # verifies it matches the manifest; exits 1 on drift
```

Frame geometry comes from the PNG itself and the manifest's `rows`/`cols` —
never guessed. Per-action `scale` comes from the `baseAction` asset's
`outputSubjectHeightMean` in `sprite-metadata.json` versus every sibling's —
never hand-baked. `npm run verify` (`scripts/verify.sh`) runs `--check` as a
build gate, so a manifest edit without a regeneration fails CI, not just
review.

## 2. Loading (`src/scenes/preload.ts`)

A row is loaded only when its `group` is one the active slice asked for.
`src/scenes/game.ts` re-exports both the scene and that list
(`export { GameScene, ART_GROUPS } from '../slices/<family>/game';`), so a game
downloads the art its gameplay uses and nothing else — see
`references/slice-wiring.md` for the per-family group names.

```ts
const LOADED_GROUPS: readonly string[] = ART_GROUPS;

for (const asset of SPRITES) {
  if (!LOADED_GROUPS.includes(asset.group)) continue;
  this.load.spritesheet(asset.key, asset.path, {
    frameWidth: asset.frameWidth,
    frameHeight: asset.frameHeight,
  });
}
for (const asset of IMAGES) {
  if (!LOADED_GROUPS.includes(asset.group)) continue;
  this.load.image(asset.key, asset.path);
}
```

In `create`, register animations once for the whole project:

```ts
for (const asset of SPRITES) {
  if (!LOADED_GROUPS.includes(asset.group)) continue;
  if (asset.duration <= 0 || asset.frames < 2 || this.anims.exists(asset.key)) continue;
  this.anims.create({
    key: asset.key,
    frames: this.anims.generateFrameNumbers(asset.key, { start: 0, end: asset.frames - 1 }),
    frameRate: 1000 / asset.duration,
    repeat: asset.loop ? -1 : 0,
  });
}
```

Animations live on the global anim manager, so every scene can play them.

## 3. Entities

- Replace `TEX.disc`-style primitives with the generated key, and
  `sprite.play(key)` for the state's animation.
- Keep `setDisplaySize(...)` driven by `TUNING` (e.g. `TUNING.player.size`), so
  balance and art scale stay independent — generated cells are 256px, gameplay
  sizes are much smaller.
- Physics bodies stay circles sized from `TUNING`, never from the art: art has
  transparent margin and would inflate hitboxes.
- Direction: flip with `setFlipX(artFacesRight(key) ? vx < 0 : vx > 0)`; never
  generate mirrored sheets.
- Action switching belongs in the entity, one line per state:
  `run` while moving, `idle` when stopped, `attack` on fire, `hurt` on damage —
  and back to the locomotion animation on `ANIMATION_COMPLETE`.
- Pooled entities must re-`play(key, true)` on spawn: a released sprite keeps
  the previous animation's frame.

## 4. UI

| Element | Approach |
| --- | --- |
| Panel / card / list row | `drawPanel(scene, w, h, { fill, stroke, radius, gloss })` from `ui/primitives.ts` |
| Button | `Button` (`ui/button.ts`): primitive capsule, repainted once per pointer event, colours from `PALETTE` |
| Bar housing + fill | `drawPill` housing + a redrawn rounded fill (never a scaled texture: scaling rounds into ellipses) — see `ui/bars.ts` |
| Icons | one generated spritesheet, `setFrame(n)`; `ICON` maps name → sheet + frame |
| Emblem / backdrop | generated single images |
| Particles | keep the procedural `TEX.particle`: generated art is wasted at 8px |

Chrome is drawn, not stretched: a nine-sliced PNG carries transparent margins,
distorts at sizes it was not drawn for, and bakes the palette into pixels.
Generated art is for glyphs and pictures. Never repaint chrome from `update` —
only on a state change.

## 5. Verification (mandatory)

1. `npm run build` — zero TypeScript errors.
2. Run the dev server and drive the game in a browser: menu, an actual run, the
   level-up overlay, results, and the meta screen.
3. Screenshot each of those states and look at them: missing texture keys render
   as green boxes, wrong `frameWidth` renders as sliced garbage, wrong origin
   makes entities sink into the floor.
4. Check the frame budget with the debug readout: generated 256px sheets cost
   texture memory, so confirm fps at the design's peak entity count.
5. Report the screenshots and the fps number.

## 6. Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Green/black box | texture key not loaded | registry path wrong, or `load` not run for that key |
| Sprite shows several frames at once | `frameWidth`/`frameHeight` mismatch | read the real cell size from `sprite-metadata.json` |
| Entity floats or sinks | origin vs feet anchor | `setOrigin(0.5, 0.5)` for hovering, `(0.5, 1)` for grounded art |
| Character resizes when its animation changes | actions do not fill their cells to the same height | measure each sheet's subject height, store `scale = idleHeight / thisHeight` in the registry, re-apply on every animation switch |
| Character runs backwards | the art faces left, the code assumed right | store `facesRight` per asset and mirror through it |
| Animation never advances | anim key clashes with texture key of a single-frame asset | keep animated and static keys disjoint |
| Hitbox too big | body sized from art | size the body from `TUNING`, not `displayWidth` |
| Pooled sprite frozen on one frame | animation not restarted on reuse | `play(key, true)` in the spawn method |
| fps drop after art | 256px sheets for tiny entities | export at the smallest cell that still reads at `renderScale` |
| Scrolling list bleeds past its viewport | `setMask`/`createGeometryMask` are removed in Phaser 4 | use `filters.internal.addMask`, or cull row visibility |
| Chrome distorted at an unusual size | it was stretched art | draw it with `ui/primitives.ts` |
| UI stutters | `paint*` called every frame | repaint only on state change |
| Black screen after a scene transition | a `SHUTDOWN` listener touched `this.scene` on an already-destroyed object | hold your own scene ref + `destroyed` flag, unsubscribe in `destroy()` |
| A button/card fires when the player lets go of a drag | `POINTER_UP` goes to whatever is under the pointer | arm on the object's own `POINTER_DOWN`, disarm on `POINTER_OUT` |
| `src/data/art.ts` no longer matches `art/manifest.json` (stale registry after regeneration) | a manifest edit or asset re-export happened without re-running the generator | `node scripts/gen-art-registry.mjs`, then `node scripts/gen-art-registry.mjs --check` (also gated by `npm run verify`) |
| Whole group renders as green boxes although the registry lists it | the group is not in the active slice's `ART_GROUPS`, so `PreloadScene` skipped every row | add the group name to the slice's `ART_GROUPS` (see `references/slice-wiring.md`) |
| A scaffolded game has no art for a group the template ships | `scripts/new-game.sh` prunes `public/assets/generated/<group>/` for groups the slice does not list, then regenerates the registry | list the group in the slice's `ART_GROUPS` before scaffolding; re-export into the game if it was already created |
| Alias resolves but nothing draws (`// not shipped: group 'x' pruned` in `art.ts`) | code from another family references art this game does not ship | point the slot at a group this slice loads, or stop using that alias here |
