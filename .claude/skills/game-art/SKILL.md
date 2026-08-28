---
name: game-art
description: >-
  Produces the complete art set for a generated game — animated characters,
  enemies, bosses, pickups, FX, UI kit (panels, buttons, bars, icons) and
  backgrounds — in one coherent style, using native generate_image through the
  sprite-forge pipeline, then wires the assets into a Phaser 4 project (texture
  keys, spritesheets, animation configs, nine-slice UI). Defines the style
  profile first so a whole asset run looks like one game, parallelises generation
  across asset groups, and gates every asset with background preflight, palette
  distance and art review. Use for "generate graphics for the game", "make the
  art", "chibi/pixel/anime style assets", "animate the hero", "UI kit", or when a
  game looks like flat placeholder shapes.
---

# Game art (style lock → parallel generation → engine wiring)

Art is the difference between a generated game and a screenshot of coloured
rectangles. This skill turns a game project into a full asset set without
hand-drawing anything and without the set drifting into 20 unrelated styles.

Fixed pipeline decisions:

| Decision | Value |
| --- | --- |
| Generator | native `generate_image` via `skill://sprite-forge` markers only |
| Cleanup/export | sprite-forge deterministic processing (magenta key, slicing, atlas) |
| Style contract | one `sprite-forge.style.v1` profile per project, in `art/style.json` |
| Canvas | `1024x1024`, `aspect_ratio: "1:1"` for every asset |
| Grids | square cells only come from `NxN` (`1x1`, `2x2`, `3x3`, `4x4`); `2x4` gives 2:1-tall cells and cannot share a scale profile with them |
| Body profile | `hd-body` (feet anchor, largest component, strict QC) |
| FX/UI profile | `hd-fx` (centred fit, all components, strict QC) |
| Output root | `public/assets/generated/<group>/<asset-id>/` |

## Non-negotiable rules

1. **Style profile before any generation.** Write `art/style.json` and pass
   `styleProfile` in every export marker. Skipping it produces individually
   clean assets that do not belong to the same game. The profile's
   `references` array names the LOCKED VISION ANCHORS (Step 1b) — once they
   exist, every generation call passes them as `input` images; a text-only
   call after the vision is locked is a defect.
2. **Never draw art with code.** No Canvas, SVG, CSS, procedural shapes or
   ASCII. Placeholder procedural textures stay only for particles and debug.
3. **One `generate_image` call per coherent asset**, one `OMP_SPRITE_EXPORT`
   marker per call. Never pack unrelated actions as rows of one sheet.
4. **Cell aspect is measured, not requested.** On a square canvas only `NxN`
   grids yield square cells: a `2x4` sheet has 256x512 cells and the processor
   hard-rejects locking it to a `2x2` scale profile. Keep frame counts on `NxN`
   grids when a character's actions must share one scale profile; when an
   8-frame action needs `2x4`, gate it with `maxBodyScaleCv`/`maxAnchorYStd` and
   an anchor guide instead. Run `sprite_preflight_background` when an export
   fails and regenerate — never rescale a mismatched sheet, never relax QC.
5. **Silhouette brief per asset.** Every enemy/prop states its mass and outline
   difference from its siblings. Sets generated without it come back as
   variations of one blob, visible only at `renderScale`.
6. **Colour coding is gameplay.** Threat / player / reward hues are fixed in the
   style profile's `temperature` and `saturationHierarchy` and must not be
   negotiated per asset.
7. **Split UI by kind.** Chrome — panels, buttons, bar housings, frames — is
   *geometry*: draw it with primitives (`ui/primitives.ts`) so it adapts to any
   size and re-skins with `PALETTE`. Generate art only for UI that is genuinely
   *drawing*: icon glyphs, the title emblem, badges, portraits. Stretched
   nine-sliced PNG chrome is banned: it carries transparent margins, breaks at
   sizes it was not drawn for, and locks the palette into the pixels.
8. **Gate every asset:** background preflight (automatic in export), then
   `sprite_check_palette` against the profile, then `art_review` per group and
   one multi-asset set call for silhouette variety.
9. **Parallelise by group, integrate serially.** Generation agents own disjoint
   output directories and touch no source file; one integrator wires everything
   into the engine afterwards.
10. **Inspect the pixels.** Never claim quality from metadata. Look at the
    exported sheet/GIF, and at the game running with the assets in place.

## Workflow

### Step 1 — Style profile (`art/style.json`)

Fill every field of `sprite-forge.style.v1`; see
`references/style-profiles.md` for ready-made profiles (vibrant chibi, gritty
pixel, flat vector, painterly, neon retro) and the checklist:

- `artStyle`: proportions, shading steps, outline, finish, camera — as sentences,
  not adjectives.
- `palette`: 12-18 hex values, including the project's UI palette so art and
  interface agree.
- `camera`, `lighting`, `outline`: one sentence each, they are prompt-merged.
- `plan.valuePlan`: dark/mid/light shares (a set with no lights reads flat).
- `plan.temperature` + `plan.saturationHierarchy`: the gameplay colour code.
- `plan.focal`: what the eye lands on, reads next, rests on.
- `plan.materials`: material → substance and surface behaviour, never a colour.
- `plan.renderScale`: the pixel size the asset is actually drawn at in game.
- `maxPaletteDistance`: 48-56 for stylised sets.

### Step 1b — Art vision board (choose the vision, lock the anchors)

Text profiles hold a set together; REFERENCE IMAGES hold it together better.
The art-director chooses one visual vision and every asset is generated
UNDER it:

1. **Candidates.** Generate 2-3 vision candidates — one full key-art frame
   each, SAME subject brief (the game's hero moment from PRD §1/§11),
   deliberately different art directions (pick from
   `references/style-profiles.md` + the §1b dossier's genre visual bar).
   One `generate_image` call per candidate, no export marker (these are
   reference material, not assets).
2. **Choose.** The art-director picks ONE against explicit criteria: the
   dossier's reference-title bar, readability at `plan.renderScale`,
   palette compatibility with the UI, and one distinctive trait that is not
   a clone of the reference games. Record the choice AND the rejections
   with one-line reasons in the report; losing candidates are deleted.
3. **Lock.** Save the winner (and up to 2 detail crops — e.g. a face/prop
   close-up for material rendering) to `art/refs/vision-*.png`; list those
   paths in `art/style.json.references`; align the profile's prose fields
   (artStyle/palette/lighting) to what the winner actually shows — the
   IMAGE is now the truth, the prose is its description.
4. **Condition every call.** From this point EVERY asset generation passes
   the anchors via the native `input` array with the fixing clause (exact
   wording in `references/prompt-contract.md`): Image 1 fixes rendering
   style, palette, lighting and finish; the prompt describes only the NEW
   subject. Characters with multiple actions add their own accepted base
   frame as the next input (the existing `sprite_anchor_guide` flow) so
   identity AND style are both pinned.
5. **Gates unchanged.** `sprite_check_palette` and `art_review` still run
   on every export — anchors are how the set PASSES them coherently, not a
   replacement for them.

### Step 1c — Interface direction (UI palette + HUD plan; art-director owns)

The interface is part of the vision. Immediately after the vision lock —
BEFORE sheet generation fans out — the art-director authors the UI
direction; ui-engineer implements it verbatim and never re-derives it:

1. **UI palette from the anchors.** Sample the locked vision image(s) and
   derive every `PALETTE`/`CSS` role: bg tones (deep/top/bottom), ink +
   inkSoft, primary/secondary/accent, good/bad. Each ink/text colour is
   CHECKED with real contrast math against `bgTop` (≥4.5:1) and each
   role's hex is written down with its source ("sampled from the cauldron
   glow", "anchor shadow tone"). Gameplay identity colours (piece kinds,
   teams) stay art-locked literals in the slice tuning, never palette
   references.
2. **HUD plan (PRD §14 revision).** Author the pixel plan on the game's
   real frame: every HUD element with coordinates and sizes inside SAFE
   and clear of the shell corner (315x75), visual hierarchy (what reads
   first at arm's length), 88px tap targets, and the reserved bands for
   coach cards / banners / floaters so juice never collides with chrome.
3. **Chrome spec.** Panel fill/stroke/alpha/radius, button fills per state,
   armour tone (`INK_STROKE`/shadow colour derived from the darkest anchor
   tone), scrim strength for text-over-art bands.
4. **Deliverable.** The PRD's §11 palette table and §14 HUD plan updated to
   the authored values (they were the game-designer's DRAFT until now) —
   this is the contract ui-engineer codes against; disagreements route
   back here, not into ad-hoc code values.

### Step 2 — Asset manifest (`art/manifest.json`)

Enumerate every asset before generating: id, group, owner agent, kind
(`body`/`fx`/`ui`/`bg`), grid, action description, cell size, duration, and any
`writeScaleProfile`/`scaleProfile` link. Volume targets and grid choices per
asset class are in `references/asset-plan.md`.

### Step 2b — World geometry (`skill://map-forge`)

When the genre needs authored space instead of a seeded scatter — tower
defense paths, rooms, tactics grids, or a parallax stage — run
`skill://map-forge` before generation, not after: the map bundle's props and
terrain drive part of the manifest.

- Output lands under `public/assets/generated/map/`, alongside the entity
  groups, so one `gen-art-registry.mjs` pass sees everything.
- Map bundle → `ArenaLayout` (`src/systems/arena.ts`) field mapping: bundle
  `width`/`height` → `ArenaLayout.width`/`height`; the floor/terrain layer's
  texture key → `floorKey`; placed prop instances → `ArenaLayout.props[]`
  (`id` matches a `PropDef.id` from `data/props.ts`, unmatched ids fall back to
  a tinted square); static decoration → `ArenaLayout.decals[]`; the bundle's
  walkable rectangle → `ArenaLayout.walkable`.
- Collision comes from `xd://map_trace_geometry` measurement on the generated
  terrain layer, never estimated coordinates — the same "measure, don't guess"
  rule as sprite frame geometry.
- Parallax backgrounds register as `bg-layer-0` (back) through `bg-layer-2`
  (front) in `art/manifest.json`'s `bg` group; `ui/background.ts` picks them up
  automatically ahead of the single `bg-arena` fallback.

### Step 3 — Parallel generation

One `task` agent per group (typically hero, light enemies, heavy enemies,
pickups/FX, UI, background). Each agent gets: the skill references, the style
profile path, its manifest slice, its output directory, and the ownership rule.
The prompt contract each agent must satisfy is in
`references/prompt-contract.md`; multi-action characters follow the scale-profile
sequence (accept idle → `writeScaleProfile` → reuse via `scaleProfile` with the
drift gates).

### Step 4 — QC

Per asset: strict export QC (automatic), `sprite_check_palette`
(`meanDistance` < profile max). Per group: `art_review` on the busiest asset and
one set call across the group's sheets. Reject and regenerate on: identity
drift, clipped limbs, welded ground strip, scale/anchor drift, collapsed
lightness range, duplicate silhouettes. Change one thing per regeneration and
use `qc.retryHints`.

**Retry budget: at most 2 regenerations per asset per symptom.** If the third
attempt still fails, stop regenerating and keep the current export for that
slot — a slightly imperfect asset the pipeline finished beats a slot that
burns the whole run chasing one QC line. Record the exception as
`{ id, reason }` in the manifest's top-level `qcExceptions[]`, with a one-line
visual justification (not "QC failed", but why the failure is acceptable or
unfixable). A `strict: false` export that ships with `qc.passed: false` (e.g.
a full-bleed backdrop or a seamless tile touching its canvas edge on purpose)
REQUIRES the same one-line `qcExceptions` entry, even on the first attempt:
the template itself ships `arena/floor` and `bg/arena` this way — cite them as
the motivating case for when `strict:false` is the correct call versus a QC
dodge.

### Step 5 — Key art (required for release)

A game with no cover is a grey card in the catalog, and the release gate
(`node scripts/release-check.mjs <slug>`) treats the scaffolded placeholder
`cover.svg` as unfinished. Every game therefore gets **one** generated cover
illustration — not a screenshot, not a montage: the game's hero moment, in the
project's own style profile.

1. **Brief.** Portrait, `aspect_ratio: "3:4"`, `image_size: "1024x1536"`. The
   player character (or the genre's signature object) mid-action, with the
   game's threat and reward colours in frame. No text, no logo, no UI, no
   border; a title treatment is allowed only if the game's own `logo` emblem is
   composited later by the store page, never rendered into the illustration by
   the provider.
2. **Export.** One `generate_image` call, one export marker, single frame,
   full-bleed like a backdrop:
   `OMP_SPRITE_EXPORT:{"outputDir":"art/exports/cover","rows":1,"cols":1,"profile":"hd-fx","styleProfile":"art/style.json","strict":false}`.
   `art/exports/` is reference material (the scaffold excludes it), so the cover
   never enters `art/manifest.json` and `gen-art-registry.mjs` never sees it:
   the cover is store media, not a game texture.
3. **Measure, then place.** Read the export's `sprite-metadata.json`
   `source.width`/`source.height`; accept a ratio of `0.66-0.80` (3:4 = 0.75)
   and regenerate outside that band. Then:
   - copy the exported single frame to `games/<slug>/public/cover.png`
   - set `game.json` `"cover": "cover.png"` (replacing `cover.svg`) and delete
     `public/cover.svg`
4. **Open Graph variant.** The store page's `og:image` is
   `games/<slug>/shots/og.png` when it exists. Produce it from the same hero
   moment as a landscape call (`aspect_ratio: "16:9"`,
   `image_size: "1536x1024"`) with `cover.png` passed as `input` (state in the
   prompt that Image 1 fixes composition, palette and character identity), then
   crop it to the Open Graph frame deterministically with the repo script:

   ```bash
   scripts/og-crop.sh games/<slug>/shots/og.raw.png games/<slug>/shots/og.png
   ```

   If the script reports its tool missing, ship the uncropped landscape as
   `shots/og.png`: Open Graph consumers rescale, and a hand-guessed crop
   loses the subject. Never crop the portrait cover into a landscape og —
   it decapitates the hero.
5. **Look at it.** Open both files. A cover that does not read at catalog-card
   size (≈300px wide) is a failed cover, regardless of QC numbers, and the
   `qcExceptions[]` entry a `strict: false` export requires still applies.

   Note the reserved store slot next to it: an optional looping
   `games/<slug>/shots/preview.webm` becomes the store page's autoplaying
   preview. It is captured from the running game, never generated.

### Step 6 — Engine wiring (the integrator)

`src/data/art.ts` is generated, not hand-edited. Follow
`references/phaser-integration.md`:

- Run `node scripts/gen-art-registry.mjs` from `template/` after every export
  or manifest edit; it reads `art/manifest.json` plus every asset's
  `sprite-metadata.json` and writes the registry — texture key, sheet path,
  frame geometry, animation key, duration, loop flag, per-action `scale` and
  `facesRight`. Never hand-edit `src/data/art.ts`; a manual edit is silently
  overwritten by the next regeneration and `verify.sh`'s
  `gen-art-registry.mjs --check` step fails the build the moment it drifts
  from the manifest.
- `PreloadScene` loads a registry row only when its `group` is listed in the
  active slice's `ART_GROUPS` (re-exported through `src/scenes/game.ts`), and
  creates animations in one loop; the loading bar already exists. **New art for
  a slice means a new manifest group AND that group's name added to the slice's
  `ART_GROUPS`** — otherwise the sheets export, the registry lists them, and
  nothing ever loads them. Per-family group names and the art-slot contract are
  in `references/slice-wiring.md`.
- Entities switch from tinted primitives to `sprite.play(ANIM.x)`; keep
  `setDisplaySize` driven by `TUNING` so balance and art stay decoupled.
- UI: `this.add.nineslice(...)` for panels/bars, idle/pressed textures for
  buttons, icon frames for HUD. Procedural textures stay for particles only.
- Verify: `npm run build` clean, then drive the running game in a browser and
  screenshot menu, run, level-up overlay and results. Generated art is
  brighter and busier than the template gradient the UI was designed against:
  after wiring, the build MUST run `game-build` Step 5.5 (UI adaptation +
  overlap/readability audit) — palette re-fit, text contrast armour, backdrop
  scrim, and an every-screen overlap pass — before store screenshots are
  taken. Swapping in a busy background without that audit is a known way to
  ship unreadable copy.

### Step 7 — Report

Per group: asset paths, frame counts, palette distances, art-review figures,
accepted QC exceptions with justification. Then the integration diff summary and
the browser screenshots proving the game renders with the new art.

## References

| File | Use |
| --- | --- |
| `references/style-profiles.md` | Ready-made `sprite-forge.style.v1` profiles + field checklist |
| `references/asset-plan.md` | What a game needs, per genre: asset classes, counts, grids, durations |
| `references/prompt-contract.md` | The exact prompt/marker contract each generation agent must follow |
| `references/phaser-integration.md` | Registry, preload, animations, nine-slice UI, verification |
| `references/slice-wiring.md` | Per-family art slots, manifest group names, `ART_GROUPS` rule |
| `skill://sprite-forge` | The generation and export contract itself |
| `skill://sprite-forge/references/art-direction.md` | How to write prompts that produce art, not diagrams |
