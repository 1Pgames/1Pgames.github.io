# `zone-castle` — Bleakspire Keep — report

**9/9 accepted.** Output root: `games/2026-08-29-duskhaul/public/assets/generated/zone-castle/`.
Scale profiles written: `chapelghast-scale.json` (512² cells), `gargoyle-scale.json` (627² cells) — both square, so the mixed-provider chains bind.

## Per asset

| id | out | frames | qc.passed | palette meanDistance | retries | provider | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| enemy-chapelghast-move | sprite-sheet.png | 4 | true | 33.61 | 2 (background-contamination) | xai | base action; profile written by reprocess, not regeneration |
| enemy-chapelghast-death | sprite-sheet.png | 4 | true | 16.56 | 3 (cv, then profile drift) | codex | cv 0.042 / anchorY 0.035 / drift 0.021 |
| enemy-gargoyle-move | sprite-sheet.png | 4 | true | 17.86 | 1 (sepia drift) | codex | base action; cv 0.054 |
| enemy-gargoyle-attack | sprite-sheet.png | 4 | true | 22.03 | 4 (drift, then wing hue) | xai | drift 0.004; 1 posture note |
| enemy-gargoyle-death | sprite-sheet.png | 4 | true | 30.06 | 0 — first pass | xai | unbound per death ruling; cv 0.072 / anchorY 0.025 |
| floor-castle | sprite.png | 1 | false (strict:false) | 34.15 | 1 (vertical seam) | xai | seamless both axes; minAlpha 255 |
| border-castle | sprite.png | 1 | false (strict:false) | **10.56** | 5 (view, coverage, value) | xai | staged via `border-inner.png`; minAlpha 255 |
| props-castle-a | sprite-sheet.png | 9 | true | 26.52 | 1 (statue + bones) | xai | 9/9 cells correct |
| props-castle-b | sprite-sheet.png | 9 | true | 35.35 | 0 — first pass | xai | 9/9 cells correct; violet survived |

All nine pass `sprite_check_palette` (≤36). Every dir swept to exactly one `raw-source.*`.
Provider read from `sprite-metadata.json.source.file` where it is an `omp-image-*` temp; the four reprocessed
assets (chapelghast-move, gargoyle-attack, floor-castle, border-castle) record their local input instead, and
their true renderer is recorded above from the generation call.

## Tiling verdict — both tiles seamless

Measured as mean absolute RGB difference across the wrap, against two adjacent interior lines as the baseline.
At or below baseline = seamless; 3–4× baseline = a seam visible when repeated 5×5.

| tile | axis | wrap | interior baseline | verdict |
| --- | --- | --- | --- | --- |
| floor-castle | horizontal | 5.19 | 5.25 | seamless |
| floor-castle | vertical | 6.57 | 6.28 | seamless |
| border-castle | horizontal | 3.71 | 1.44 | seamless in absolute terms (3.7/255) |

`border-castle` tiles left-to-right only, as specified. Confirmed by eye: opposite edges continue, both
tiles land their canvas edges on a mortar seam, and neither contains a focal landmark.

**Arena edge reads correctly:** border mean luma **32.4** vs floor **74.5** — the border is darker by 42.0,
so the field boundary is unmistakable at a glance.

## Zone trick held

Darkest field of the four zones plus the only point-source lighting. Floor sits 61.5% dark / 38.5% mid with
**zero** light pixels; border 98.4% dark. The hot spots are carried by the props, not the ground: the lit
brazier is the brightest object in the zone, the sconce torch is a deliberate second step down, and the
candle stand third. Rectilinear man-made geometry is the silhouette signature — straight right-angled mortar
seams in both tiles, the only zone whose floor has straight lines. The brazier reads as a hazard telegraph,
not decoration: amber flame, dirty dried-red core, black smoke curl, and `brazier-cold` is distinguishable
from `brazier-lit` by **value alone** (no bright spot at all), so a live brazier can never be misread as spent.

## `art_review` set calls

**Set (a) — both `-move` sheets + both prop sheets, renderScale 48. Silhouette variety PASSED, `findings: []`.**
All six pairs separated: props-a↔props-b 0.133, chapelghast↔gargoyle 0.144, chapelghast↔props-a 0.242,
chapelghast↔props-b 0.264, gargoyle↔props-a 0.296, gargoyle↔props-b 0.299. The enemy silhouette contract
holds — chapelghast reads as a vertical stroke, gargoyle as a horizontal block.

| asset | dark | mid | light | spread | warm/cool | colours | passed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| enemy-chapelghast-move | 0.658 | 0.321 | 0.021 | 0.633 | 0.043 / 0.953 | 16508 | true |
| enemy-gargoyle-move | 0.846 | 0.146 | 0.008 | 0.595 | 0.342 / 0.249 | 25510 | false |
| props-castle-a | 0.766 | 0.210 | 0.024 | 0.682 | 0.262 / 0.688 | 47363 | true |
| props-castle-b | 0.671 | 0.319 | 0.010 | 0.560 | 0.088 / 0.886 | 53788 | false |

**Set (b) — `floor-castle` + `border-castle`.** Floor: 0.615 / 0.385 / 0.000, spread **0.379 — lightness
range NOT collapsed**, which is the brief's explicit requirement for this tile. Border: 0.984 / 0.016 / 0.000,
spread 0.253, flagged `value-spread-flat`.

Two findings in set (b) are **inapplicable to this asset class** rather than defects, and I am not treating
them as such:
- `silhouette-collision` floor↔border at distance 0.000 — both are full-bleed opaque textures, so occupancy
  at 48px is 100% for each by construction. The silhouette gate measures sprite occupancy and cannot say
  anything about two edge-to-edge tiles. (Same "right metric, wrong population" class as the
  `sprite-sheet.png` presence test and the blanket `minAlpha 0` test.)
- `temperature-single` on the tiles — the zone is a deliberately monochrome cold stone field; the warm
  counterpoint is supplied by the brazier/torch props that sit on top of it, not by the ground.

## qcExceptions

Report-only, as instructed — **not** written into the shared `art/manifest.json`.

- `{ "id": "zone-castle/floor-castle", "reason": "Seamless full-bleed floor tile: the texture must reach every canvas edge for the repeat to work, so there is no magenta key and border/edge-contact QC cannot pass by construction — same documented case as the template's own arena/floor and bg/arena exports." }`
- `{ "id": "zone-castle/border-castle", "reason": "Tileable full-bleed border band: horizontal repeat requires edge-to-edge coverage, so magenta-key and edge-contact QC are inapplicable by design (template arena/floor precedent)." }`
- `{ "id": "zone-castle/border-castle", "reason": "art_review value-spread-flat (0.253): accepted deliberately. The brief requires the band to sit CLEARLY DARKER than the floor so the arena edge is unmistakable, and it does (luma 32.4 vs 74.5). A wider value range would lift the band toward the floor and destroy the boundary read, which is the gameplay-load-bearing property." }`
- `{ "id": "zone-castle/enemy-gargoyle-move", "reason": "art_review value-tier-absent:light (0.8% vs 8% planned). Darkest-zone actor; not rerolled per the standing order that accepted sheets are not re-generated to chase the light tier. Note the canonical husk-move fails the same check harder (0.4%), so the plan share, not this sheet, is the outlier." }`
- `{ "id": "zone-castle/props-castle-b", "reason": "art_review value-tier-absent:light (1.0% vs 8% planned). All nine cells are correct and silhouette variety passes; the sheet is cold stone and tarnished metal by brief, whose lit top planes are genuinely small. Kept rather than rerolled to avoid the cell-quality regression a reroll caused on props-castle-a." }`

`enemy-gargoyle-attack` needs **no** exception: it carries one honest measured posture note,
`qc.postureChange: ["anchor-y-std:0.0669>0.0500"]`, with `passed: true` and `failures: []`.

## Brief/tooling deviations applied locally (for central reconciliation — I edited no shared file)

1. **`"duration":0` removed** from all four static markers — `floor-castle`, `border-castle`,
   `props-castle-a`, `props-castle-b`. The exporter rejects 0 (`sprite.duration must be a positive integer`).
2. **`"writeScaleProfile": true` → string path** on both base markers (`chapelghast`, `gargoyle`). The
   boolean is silently dropped, so no profile is ever written.
3. **`"scaleProfile"` + `"maxProfileScaleDrift"` dropped from `enemy-gargoyle-death`**, per the build-wide
   death-unbind ruling. `chapelghast-death` was already green with the profile bound, so it kept it.
4. **`"fit": 1` on both tiles**, applied via reprocess. The `pixel-art-fx` default `fit: 0.86` insets a
   full-bleed texture and silently ships an untileable tile.
5. **`styleProfile` dropped from `border-castle` only.** With the anchor attached, xai drew a side-elevation
   wall (vision-1 contains elevation walls at its top edge) instead of a plan view. Style carried in prose.
   Kept on all seven other assets, including both floor and prop sheets.
6. **`border-castle` staged through `border-inner.png`**, kept beside the raw so the tile is reproducible:
   `raw-source.jpg` → detect the welded magenta frame (`min(r,b)-g > 40`, `r,b > 150`, `g < 120`) → inset 3px
   past the JPEG fringe → crop to a whole number of mortar-joint periods (10 periods, 384px, period ≈ 38.4,
   measured from column-luma minima) → `process-sprite`. Deterministic region selection; no painting.

## Findings contributed to the wave

- **A failed export overwrites `raw-source.*` and `sprite-metadata.json` while leaving an accepted
  `sprite-sheet.png` intact** — so the reprocess route silently operates on contaminated pixels. Restoring the
  accepted raw from its `omp-image-*` temp first made the reprocess byte-identical (same md5) with the profile
  written and zero regenerations.
- **`--fit` cannot fix `profile-body-scale-drift`.** `bodyScale` is measured in source space (bbox height over
  source cell), so it is a generation-space property; reprocessing at `--fit 0.748` returned byte-identical
  failure numbers.
- **`sprite_anchor_guide` fixes the intra-sheet gates**, taking chapelghast-death from cv 0.2004 → 0.0198 and
  anchorY 0.1013 → 0.0120, and providing a genuinely pure `#FF00FF` field as a bonus.
- **Both providers render ~1.15× larger than the guide shows**; compensating the guide's
  `subjectHeightRatio` by that factor cleared profile drift 0.1499 → 0.0206.
- **The real lever for a height gate is choreography, not calibration.** gargoyle-attack only went green
  (drift 0.004) once the prose pinned the humped back line as the highest point in all four frames and swept
  the wings back rather than up — `bodyScale` is bbox *height*, so a raised wing is what breaks it.
- **codex ignores `aspect_ratio`** and returned 1122×1402 once, which makes a 512²-built scale profile
  unbindable (aspect-mismatch error). Only aspect is checked, not size, so 627² codex siblings bind to a 512²
  xai-built profile fine.
- **codex's warm/sepia drift is correctable in prose** — naming the hexes and forbidding the warm family
  outright took gargoyle-move from brown sandstone to cold blue-grey granite at meanDistance 17.86.
- **The "put the canvas edges on a mortar seam" clause is what makes a tile tile.** Floor V-wrap went
  12.29 (≈4× baseline, visibly seamed) → 6.57 against a 6.28 baseline; the generic "left edge continues into
  the right edge" wording achieved nothing.
- **xai welds a 45–56px magenta frame around every full-bleed swatch** — 4 of 4 attempts, including with the
  word "magenta" absent from the prompt entirely. This is the provider signature behind all three
  hand-staged tile intermediates in the build.
- **Clause 6 (cyan-lean) prevents the violet loss at the default threshold**, no reprocess needed: the
  `shrine` votive glow survives with `minRB-g` −47.4 and magentaDistance 242.9, far outside the kill zone.
- **`--posture-change` exists and is honoured** in the installed plugin: metadata contains
  `qc.postureChange: ["anchor-y-std:0.0669>0.0500"]` with `passed: true`, i.e. the gate ran and reported
  rather than being switched off.
- **Floating/perched actors never got the welded ground shadow** on either provider; the ellipse tracks the
  token "standing", which is why chapelghast (hovering) and gargoyle (crouched on nothing) came through clean.
