# ArtPOI report — PRD-V2 §11 poi / gates / breakables / pickups / weapon-fx / boss-fx / fx

Probe (rule 0): `generate_image` 1024² throwaway → `xai-oauth / grok-imagine-image`, OK. Every raw below came from xai-oauth.

## Pipeline as actually run (read before auditing)
- Generation: native `generate_image`, one call per asset, 1024x1024 / 1:1, vision anchor
  `art/refs/vision-1.png` as Image 1 on actor/prop/icon-class calls. Gates pass the canon
  `gates-collapse/gate-closed` raw (closed) or the new closed variant + canon `gate-open` raw
  (open) as Images 1-2 for silhouette identity. `fx-lightpool` / `fx-shadow` are text-only
  (texture swatches, not actors).
- **Anchor caveat (batch 1 only):** pk-bread/bell/flask/salt/xpcluster/key and poi-lore passed
  the anchor through a non-schema `input` field instead of `input_paths`; whether the provider
  received it is UNVERIFIED. Their pixels match the set (1px dark outline, dithered shading,
  meanDistance 14.5-30.3). Every later call used `input_paths`.
- Export: raws are processed by sprite-forge's own processor (`process-sprite.ts`, the
  documented reprocess path) via `art/briefs/v2-poi/build.py`: pixel-art-fx equivalents
  (nearest, centre, fit 0.86, componentMode all), `--strict`, `--preserve-raw`,
  `--source-provider xai-oauth`. Raws kept in `art/briefs/v2-poi/raw/`. Re-run
  `python3 art/briefs/v2-poi/build.py` (cwd = game root) to reproduce every export.
- **Keyer chroma guard NOT bound** (`--style-profile` omitted from the keyer only): xai returns
  the key as an off-magenta pink measured 88-125 from #FF00FF, nearer to the profile anchor
  #c084fc than to magenta, so the guard "protected" the whole background (890k px on
  poi-lore, source-edge-touch on every frame). Violet-bearing assets instead key at a
  threshold measured from that raw's own border (`bg_distance + 35`, clamped 125-170), which
  keeps #ad6eef (138) / #c084fc (146) outside the key. Palette gate still runs against the
  profile on every export (below).

## Per-asset table (all 52 strict-QC pass; meanDistance = `sprite_check_palette` vs art/style.json, max 48)

| group/id | grid | cell | frames | meanDistance | gens | exception |
|---|---|---|---|---|---|---|
| poi/poi-chest-t1 | 2x2 | 128x128 | 4 | 22.77 | 1 |  |
| poi/poi-chest-t2 | 2x2 | 128x128 | 4 | 27.45 | 1 |  |
| poi/poi-chest-t3 | 2x2 | 128x128 | 4 | 26.39 | 1 |  |
| poi/poi-vault | 1x2 | 256x256 | 2 | 18.77 | 1 |  |
| poi/poi-lair-banner | 2x2 | 128x128 | 4 | 23.12 | 1 |  |
| poi/poi-shrine-blood | 2x2 | 192x192 | 4 | 22.74 | 1 |  |
| poi/poi-shrine-gilt | 2x2 | 192x192 | 4 | 23.9 | 1 |  |
| poi/poi-shrine-bone | 2x2 | 192x192 | 4 | 26.14 | 1 |  |
| poi/poi-shrine-grave | 2x2 | 192x192 | 4 | 28.1 | 1 |  |
| poi/poi-shrine-curse | 2x2 | 192x192 | 4 | 22.76 | 1 |  |
| poi/poi-vein | 1x3 | 128x128 | 3 | 30.46 | 1 | yes |
| poi/poi-lore | 1x1 | 128x128 | 1 | 19.55 | 1 |  |
| poi/poi-bell | 2x2 | 192x192 | 4 | 18.33 | 1 |  |
| poi/poi-den-wall | 1x2 | 256x256 | 2 | 26.98 | 1 |  |
| poi/npc-fence | 2x2 | 256x256 | 4 | 20.74 | 1 |  |
| gates-v2/gate-toll-closed | 1x1 | 256x256 | 1 | 20.03 | 1 |  |
| gates-v2/gate-toll-open | 2x2 | 256x256 | 4 | 28.52 | 1 |  |
| gates-v2/gate-offering-closed | 1x1 | 256x256 | 1 | 20.14 | 1 |  |
| gates-v2/gate-offering-open | 2x2 | 256x256 | 4 | 25.37 | 2 |  |
| gates-v2/gate-bell-closed | 1x1 | 256x256 | 1 | 19.1 | 2 |  |
| gates-v2/gate-bell-open | 2x2 | 256x256 | 4 | 28.26 | 2 |  |
| breakables/brk-castle | 2x3 | 128x128 | 6 | 21.46 | 1 |  |
| breakables/brk-outlands | 2x3 | 128x128 | 6 | 23.09 | 1 |  |
| breakables/brk-desert | 2x3 | 128x128 | 6 | 25.07 | 2 |  |
| breakables/brk-winter | 2x3 | 128x128 | 6 | 29.96 | 1 |  |
| pickups-v2/pk-bread | 2x2 | 64x64 | 4 | 14.47 | 1 |  |
| pickups-v2/pk-bell | 2x2 | 64x64 | 4 | 19.41 | 1 |  |
| pickups-v2/pk-flask | 2x2 | 64x64 | 4 | 25.71 | 1 |  |
| pickups-v2/pk-salt | 2x2 | 64x64 | 4 | 30.27 | 1 |  |
| pickups-v2/pk-xpcluster | 2x2 | 64x64 | 4 | 22.58 | 1 |  |
| pickups-v2/pk-key | 2x2 | 64x64 | 4 | 22.77 | 1 |  |
| weapon-fx/wpn-skull | 2x2 | 64x64 | 4 | 47.5 | 1 |  |
| weapon-fx/wpn-skull-evo | 2x2 | 64x64 | 4 | 42.33 | 2 |  |
| weapon-fx/wpn-censer-pool | 2x2 | 256x256 | 4 | 28.61 | 1 |  |
| weapon-fx/wpn-censer-pool-evo | 2x2 | 256x256 | 4 | 24.52 | 2 |  |
| weapon-fx/wpn-sickle | 2x2 | 96x96 | 4 | 47.09 | 1 |  |
| weapon-fx/wpn-sickle-evo | 2x2 | 96x96 | 4 | 45.78 | 2 |  |
| weapon-fx/wpn-lash | 3x1 | 384x96 | 3 | 32.49 | 2 |  |
| weapon-fx/wpn-lash-evo | 3x1 | 384x96 | 3 | 33.14 | 1 |  |
| weapon-fx/wpn-breath | 2x2 | 256x256 | 4 | 63.71 | 1 | yes |
| weapon-fx/wpn-breath-evo | 2x2 | 256x256 | 4 | 58.77 | 2 | yes |
| weapon-fx/wpn-spear | 1x5 | 128x128 | 5 | 42.04 | 1 |  |
| weapon-fx/wpn-spear-evo | 1x5 | 128x128 | 5 | 43.62 | 2 |  |
| boss-fx/fx-bell-ring | 2x2 | 512x512 | 4 | 24.06 | 3 | yes |
| boss-fx/fx-geyser | 1x5 | 128x128 | 5 | 24.5 | 1 |  |
| boss-fx/fx-scorch-beam | 1x3 | 64x400 | 3 | 32.71 | 1 |  |
| boss-fx/fx-icicle | 2x2 | 64x64 | 4 | 57.98 | 1 | yes |
| boss-fx/fx-ice-wall | 1x2 | 256x256 | 2 | 85.07 | 1 | yes |
| boss-fx/fx-sand-pillar | 1x3 | 128x128 | 3 | 27.8 | 1 |  |
| fx-v2/fx-lightpool | 1x1 | 512x512 | 1 | 50.39 | 1 | yes |
| fx-v2/fx-shadow | 1x1 | 128x64 | 1 | 16.32 | 1 |  |
| fx-v2/fx-chest-beam | 1x4 | 64x256 | 4 | 37.45 | 1 |  |

`gens` = generations used (lint `attempts`). Exceptions are in `art/v2/ArtPOI.groups.json.qcExceptions`.

## Frame maps (index-addressed sheets, duration 0)
- `poi-vault` 0 closed / 1 open · `poi-den-wall` 0 rising / 1 raised · `poi-vein` 0 full / 1 half / 2 depleted · `fx-ice-wall` 0 forming / 1 standing
- `brk-<zone>` 2x3: 0 urn, 1 coffin, 2 crate intact; 3/4/5 the same broken (= intact + 3). ICON names `brk-<zone>-{urn,coffin,crate}[-broken]`.
- One-shot (loop false, hold last): chests t1-t3 (frame 3 = open), wpn-lash(-evo), wpn-spear(-evo), fx-bell-ring, fx-geyser, fx-sand-pillar.
- Facing: skull/breath/lash art points RIGHT; icicle points DOWN; scorch beam is vertical 64x400 (rotate in code).

## Wiring contract
Texture key = asset id; `sprite-sheet.png` for multi-frame, `sprite.png` for 1x1. Groups:
`poi`, `gates-v2`, `breakables`, `pickups-v2`, `weapon-fx`, `boss-fx`, `fx-v2` — each must be in
the slice's `ART_GROUPS` or nothing loads. Registry dry-run (merged manifest in a temp tree,
`node scripts/gen-art-registry.mjs`) produced all 52 rows with the expected geometry.
Tints: `fx-lightpool` (white, tint in code), `fx-chest-beam` (near-white, tint by rarity colour),
`fx-shadow` (use at 0.45 hero / 0.35 trash alpha per §13.1).

## Set gates
- `manifest-lint.py` on art/manifest.json + these groups merged: 0 errors, 2 pre-existing warnings
  (duplicate vision anchor listing; 25 canon hand-written writeScaleProfile paths — not ours).
- `figure-ground.py`, 4 scenes, cast = hero-idle + that zone's enemy sheets + brk-<zone> + chests + vein + lore,
  fields = canon floor-<zone> + floors-v2 a/b/c, grade = FLOOR_GRADE: all 12 floors-v2 fields PASS
  (clash 0.00%, busyRatio 0.12-0.28). One FAIL is the CANON V1 `zone-desert/floor-desert`
  (34.44% inverted clash) — not an ArtPOI asset; floors-v2 replaces it. Partial cast (no elites/boss).
- `art_review` POI set (21 frames) and FX set (6 frames), renderScale 48: see CRITERIA.

## CRITERIA
- `silhouette-collision` RESCOPED to reported-only for (a) gate variants: toll/offering closed differ
  by 0.024 because PRD-V2 §11 REQUIRES them to share the canon gate-arch silhouette — identity is
  the chain/altar/bell detail plus state hue; (b) breakables urn vs coffin (0.034): one gameplay
  class (1-hit breakable), not distinct actors. Cross-character POI pairs measured 0.19-0.43.
- `sprite_check_palette` meanDistance is distance from the LIST: fails on wpn-breath (63.7),
  wpn-breath-evo (58.8), fx-icicle (58.0), fx-ice-wall (85.1), fx-lightpool (50.4) — all PRD-mandated
  hues (#6fd6ff hero cyan, cold-cyan ice, pure white for code tint) absent from style.json.
  Canon check: canon winter props reach 46.9 only because they are mostly stone. Recorded as
  qcExceptions, not rerolled.
- `value-tier-absent:light` / value-plan-miss: reported only (known false positive; canon at 0.4%).
- Post-review pixel transforms, reviewed through `art/briefs/v2-poi/runtime-preview.py`
  (writes runtime-preview.png): Phaser multiply tint on lightpool (#e8c547/#5b4bff @0.5) and
  chest-beam (6 rarity colours), shadow alpha 0.45/0.35 under hero, props on castle floor.
  Finding: castle urn (grey-blue) sits close to the ungraded castle floor tone; it separates by
  outline only — flag for WS-World if urns vanish in play. Outlines (§13.1 `-ol` bake) do not
  apply to these props.
