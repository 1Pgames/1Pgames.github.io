# Slice wiring: which art each family loads, and where it plugs in

Generated art is only shipped art if three things line up:

1. the sheets exist under `public/assets/generated/<group>/<id>/`,
2. `art/manifest.json` lists that `<group>`, so `scripts/gen-art-registry.mjs`
   emits rows carrying `group: '<group>'`,
3. the active slice's `ART_GROUPS` includes `<group>`, so `PreloadScene` loads
   those rows at all.

Miss (3) and everything looks correct — export QC green, registry regenerated,
`--check` clean — while the game still renders placeholder shapes, because the
loader skipped every row of that group.

## 1. The group gate

`src/scenes/game.ts` re-exports the active slice's scene *and* its art groups:

```ts
export { GameScene, ART_GROUPS } from '../slices/arena/game';
```

The slice owns the list, next to its `GameScene`:

```ts
export const ART_GROUPS = ['ui', 'bg', 'board-pieces'] as const;
```

`PreloadScene` loads a `SPRITES`/`IMAGES` row only when `row.group` appears in
`ART_GROUPS`, and creates animations only for rows it loaded.

`scripts/new-game.sh` reads the slice's `ART_GROUPS` when scaffolding a game,
**deletes every `public/assets/generated/<group>/` directory not in it**, and
re-runs `node scripts/gen-art-registry.mjs` inside the new game. So a game's
registry describes exactly the art it ships, and `--check` stays green per game.
Consequences for this skill:

- Adding a group to a slice's `ART_GROUPS` is what makes the scaffold keep that
  art. A group nobody lists is pruned out of every new game.
- A group directory that is absent is treated as *pruned on purpose*: the
  generator emits no rows for it but keeps its `TEXTURE`/`ANIM`/`ICON` aliases,
  flagged `// not shipped: group '<g>' pruned`. A missing asset **inside** a
  present group is still a hard error — that is a broken export.
- Never re-add a pruned group by hand-editing `src/data/art.ts`. Export into the
  group directory, list it in `ART_GROUPS`, regenerate.

Two groups are universal: `ui` (icon glyphs) and `bg` (backdrop + emblem). Every
family loads them, because the HUD, the menu and `ui/background.ts` use them
regardless of genre.

## 2. The art slot contract

A slice's tuning file is the only place that says *which* texture fills a
gameplay role. Slots are declared once and resolved at draw time:

```ts
/** Which loaded texture (and frame, on an icon sheet) fills this role. */
export interface ArtSlot {
  /** Phaser texture key from `src/data/art.ts` (`TEXTURE.*`/`ANIM.*`/`ICON.*`). */
  key: string;
  /** Frame index on a multi-frame sheet; omit for single-image textures. */
  frame?: number;
}
```

Rules the slices implement:

- A tuning row that used `texture: TEX.disc, tint: PALETTE.bad` becomes
  `texture: { key: 'gem-ember' }`. The shape is always
  `{ texture: { key, frame? } }` — never a bare string, so a slot can point at
  one frame of a shared sheet without a second field per row.
- **Tint belongs to the procedural fallback only.** Generated art carries its
  own colour; tinting it fights the style profile. Keep `tint` on the row for
  the fallback path and stop applying it once the slot resolves to generated
  art.
- Resolution is one check, at construction: when
  `scene.textures.exists(slot.texture.key)` is false, draw the procedural
  primitive (`TEX.*` + `tint`) instead. That is what keeps a slice playable
  before its art exists, and what makes a pruned group degrade instead of
  crash.
- Sizes stay in `TUNING`. A slot changes *what* is drawn, never how big — the
  256px cell is not a gameplay size.
- Pooled sprites re-`setTexture`/`play(key, true)` on spawn; a released sprite
  keeps the previous slot's frame.

## 3. Per-family map

| Family | New manifest group | Slots to fill (file) | Notes |
| --- | --- | --- | --- |
| `arena` | `hero`, `enemies-light`, `enemies-heavy`, `pickups-fx`, `props`, `arena` | `data/enemies.ts` `texture`, `TUNING.player`, `data/props.ts`, `ArenaLayout.floorKey`/`decals` | The reference set; already wired end to end |
| `board` | `board-pieces` | `slices/board/tuning.ts` `GEM_STYLES[].texture`; the special-piece glyph map in `slices/board/game.ts` (`line-h`, `line-v`, `bomb`) | One sheet of 5-6 gem glyphs plus 3 special overlays; silhouettes must differ by outline, not only hue — matching by colour alone fails colour-blind players |
| `side` | `side-hero` | `slices/side/game.ts` player/platform/spike/coin/exit images | Hero needs idle + run + jump/fall on one `NxN` grid with a shared scale profile; platforms and spikes are tiles, not characters |
| `track` | `track-cars` | `slices/track/game.ts` car images, player marker | Top-down cars: one sheet per car class, drawn nose-up; the track surface stays procedural (it is regenerated per seed) |
| `table` | `table-icons` | `EVENT_STYLE` map in `slices/table/game.ts` (`icon`), tile plates, token | Icon sheet addressed by frame (`duration: 0` in the manifest so no animation is created) |
| `idle` | `idle-icons` | `slices/idle/content.ts` `GENERATOR_VIEW[].tex` | One icon per generator; they sit in a list at ~64px, so they must read at `renderScale`, not at 256 |
| `hyper` | `hyper-skins` | `slices/hyper/game.ts` slab texture + `HYPER_TUNING.colors` | Slabs are stacked and cropped: art must tile vertically and survive `setDisplaySize` on width; keep the height banding via distinct skins rather than tints |
| `word` | — | chrome only | Quiz UI is `ui/primitives.ts` geometry; `ui` + `bg` is the whole art set |

Every row of that table means the same three edits: manifest group + exported
sheets, the group name added to that slice's `ART_GROUPS`, and the tuning slots
switched from `TEX.*` to `{ key: … }`. Ship them together — a partial landing
either loads art nothing points at, or points at art nothing loaded.

## 4. Checklist before reporting a family wired

1. `node scripts/gen-art-registry.mjs --check` green in `template/`.
2. The slice's `ART_GROUPS` lists every group its slots reference.
3. Grep the slice for `TEX.` — what remains must be a deliberate procedural
   fallback or a particle, not a forgotten slot.
4. Scaffold a throwaway game on that family and confirm
   `public/assets/generated/` contains exactly the groups in `ART_GROUPS`.
5. Run the game and screenshot it: a green box means a slot points at a key its
   group never loaded.
