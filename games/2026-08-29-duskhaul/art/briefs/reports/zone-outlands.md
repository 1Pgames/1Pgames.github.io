# Report — group `zone-outlands` (Ashen Outlands), 9/9 accepted

Output root: `games/2026-08-29-duskhaul/public/assets/generated/zone-outlands/`
Every accepted asset was produced on **xai / grok-imagine-image** (all nine dirs hold `raw-source.jpg`;
`sprite-metadata.json.source.file` confirms the shipped sheet was processed from that raw, or from the
documented detile intermediate for the two tiles — see "Tiles" below). No codex sheet was kept: the two
codex takes of `floor-outlands` and `border-outlands` were rejected on style (smooth/painterly, no pixel
grid, warm purple-brown drift) and one returned a 3:2 canvas.

## Per asset

| id | dir | frames | strict | qc.passed | posture notes | cv | anchorYStd | bodyScaleMean | meanDistance | outlierFrac | regenerations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| enemy-kite-move | `enemy-kite-move/` | 4 | true | **true** | — | 0.1237 | 0.0118 | 0.537 | **21.07** | 0.023 | 3 |
| enemy-kite-death | `enemy-kite-death/` | 4 | true | **true** | `body-scale-cv:0.0831>0.0800` | 0.0831 | 0.0457 | 0.519 | **22.58** | 0.035 | 1 |
| enemy-giant-move | `enemy-giant-move/` | 4 | true | **true** | — | 0.0012 | 0.0010 | 0.845 | **24.70** | 0.087 | 0 |
| enemy-giant-attack | `enemy-giant-attack/` | 4 | true | **true** | — | 0.0310 | 0.0049 | 0.783 | **30.42** | 0.076 | 3 |
| enemy-giant-death | `enemy-giant-death/` | 4 | true | **true** | `body-scale-cv:0.2452>0.0800` | 0.2452 | 0.0241 | 0.603 | **27.73** | 0.048 | 1 |
| floor-outlands | `floor-outlands/` | 1 | false | false (documented) | — | — | — | — | **23.22** | 0.001 | 2 |
| border-outlands | `border-outlands/` | 1 | false | false (documented) | — | — | — | — | **18.44** | 0.006 | 1 |
| props-outlands-a | `props-outlands-a/` | 9 | true | **true** | — | 0.2464 | 0.0110 | 0.564 | **22.33** | 0.037 | 0 |
| props-outlands-b | `props-outlands-b/` | 9 | true | **true** | — | 0.1397 | 0.0586 | 0.532 | **24.21** | 0.056 | 3 |

All nine palette checks PASS (`profile: art/style.json`, cap 36; worst 30.42). Every dir holds a
`sprite-sheet.png` (tiles also `sprite.png`). Scale profiles written: `kite-scale.json` (bodyScaleMean
0.5366, 512x512 source cells), `giant-scale.json` (0.8447, 512x512 source cells).

`enemy-giant-attack` measures **profile-body-scale-drift 0.0734** against `giant-scale.json` — green,
computed from bodyScaleMean 0.783 / 0.845 (the sheet is exported without `--scale-profile` so that the
dust ring survives, see below; the bound run of the same raw read 0.0827).

## Zone trick — flat mid field, contour and bone as the only contrast

Held on every asset. `floor-outlands` is one continuous warm grey-brown mudflat: value dark 15.8% /
mid 83.3% / light 0.9%, saturationSpread 0.173, i.e. deliberately the narrowest value band of the four
zones. Readability is carried by CONTOUR — long left-to-right wind-combed streaks and a near-black
polygonal crack network — and by bone-parchment whites (the chips are the only near-lights). No wet
highlight and nothing bright anywhere except the single firepit flame in `props-outlands-b` cell 8 and
the confined ember glow in cell 3. `border-outlands` separates from that field by DENSITY and DARKNESS
(dark 79.5%, coolShare 0.43) rather than by hue.

## Tiling verdict (verified by eye, 3x3 and 3x1 previews of the shipped tiles)

- **floor-outlands — PASS.** The horizontal wind-combed streaks and ash drifts continue unbroken across
  the vertical seam, so the whole field reads as one wind direction, which is the acceptance criterion
  for this zone. Two honest caveats: there is a faint value step at the seam (a slightly darker band
  along one edge), and the one knuckle bone plus one pebble form a recognisable repeat every 512px.
  Neither breaks the field at play scale; no landmark, no vignette, no focal point.
- **border-outlands — PASS left-to-right.** Thorn mass and the drifted-ash near edge both continue
  across the seam. The snapped wheel and two snagged rags (both required by the brief) repeat once per
  512px — that is the one visible landmark, ~3 repeats along a 1600px field edge.
- Both tiles are 100% opaque, edge to edge (verified: all four outermost pixel rows/columns opaque, no
  residual magenta fringe), which is what the repeat needs.

## art_review

**Set (a) — silhouette variety at renderScale 48**, `enemy-kite-move` + `enemy-giant-move` +
`props-outlands-a` + `props-outlands-b`: **passed: true**, no findings on any of the four assets.
Pairwise silhouette distances: props-a↔props-b 0.094, kite↔giant **0.167**, kite↔props-b 0.234,
kite↔props-a 0.265, giant↔props-b 0.308, giant↔props-a 0.328. The roster contract holds — the kite
reads "wide thin thing" and the giant "tall fat thing" (bodyScaleMean 0.537 vs 0.845, and the giant is
the larger mass by ~3x in area).
Value/colour per asset: kite dark .693/mid .260/light .047, spread .779; giant .474/.302/.224, spread
.788; props-a .695/.279/.025, spread .731; props-b .669/.295/.036, spread .732.

**Set (b) — tiles**, `floor-outlands` + `border-outlands`: **passed: false**, both on
`value-tier-absent:light` (floor 0.9% vs planned 8%, border 1.6% vs planned 8%) plus value-plan-miss
warnings (floor mid 83% vs 32%, border dark 80% vs 60%). **Not actioned, by design** — this is exactly
the flattest-zone trick the brief locks ("its floor will always sit narrow; its lights come from the
bone chips and its darks from the crack network"), and widening it would turn the outlands into the
castle. The set's `silhouettes.passed: false` is a false positive for this asset class: two full-bleed
100%-opaque squares are identical silhouettes by construction.

## Detached-debris verification (connected components per frame, min 12px)

Requested specifically because attacks stay profile-bound and a bound profile silently forces
`componentMode: largest`.

- `enemy-giant-attack` **2 / 1 / 1 / 4** — the frame-4 dust ring survives. It was initially destroyed,
  but **not** by componentMode: the ring is drawn in a pale dusty rose at magentaDistance ~207, so the
  *edge flood fill* at the default `--edge-threshold 210` ate it as background-connected. Reprocessing
  at `--threshold 150 --edge-threshold 150` restored it (frame 4 went 1 → 4 components). Same failure
  family as the violet-aura problem, different hue — worth knowing that any pale warm-pink FX is also
  inside the key's reach, not just violet.
- `enemy-kite-death` **1 / 4 / 7 / 4** — the loose feather burst survives (peaks at frame 3).
- `enemy-giant-death` **1 / 1 / 1 / 2** — tearing skin sheets stay attached to the body by design.

## Deviations from the brief text (approved, listed for central reconciliation)

1. **`"duration":0` removed** from the four static markers — `floor-outlands`, `border-outlands`,
   `props-outlands-a`, `props-outlands-b`. The exporter rejects 0 (`positiveInteger` requires >= 1);
   dropping the key lets the fallback apply. Found and reported by this group.
2. **`"writeScaleProfile": true` replaced with the literal path string** on `enemy-kite-move`
   (`.../zone-outlands/kite-scale.json`) and `enemy-giant-move` (`.../giant-scale.json`). The boolean is
   silently dropped, so neither base had written a profile.
   `enemy-giant-move` was fixed by **reprocessing its accepted raw**, zero regenerations, pixels
   unchanged; `enemy-kite-move` was regenerated anyway for silhouette reasons.
3. **`scaleProfile` + `maxProfileScaleDrift` dropped from the two `-death` markers** per the build-wide
   death-unbind ruling, and `--posture-change` used on both so the collapse is REPORTED in
   `qc.postureChange[]` rather than failing.
4. **Tiles are processed from a hand-staged intermediate** (see below) instead of straight from the
   provider raw.

## The `floor-inner.png` / `border-inner.png` intermediate — REPRODUCIBLE, not a one-off

`sprite-metadata.json.source.file` for the two tiles is `floor-inner.png` / `border-inner.png` rather
than an `omp-image-*` temp. This is deliberate and scripted, and it is the fix for a real defect:

xai welds a **magenta frame** around a full-bleed texture swatch (~45-56px on every side) no matter how
the prompt asserts edge-to-edge coverage. The exporter then keys that frame away and fits the remainder
at `fit 0.86`, so the shipped tile came out as an inset picture-of-a-texture with a transparent margin
and a magenta hairline — unusable as a repeat. The pipeline is now:

1. `python3 <group>/detile-tile.py <dir>/raw-source.jpg <dir>/<a>-inner.png 12` — walks in from each
   edge while that row/column is majority chroma-key magenta, insets a further 12px past the JPEG /
   anti-aliased fringe, and crops the largest centred square. Deterministic region SELECTION on
   generated pixels only; nothing is painted.
2. `process-sprite.ts --input <dir>/<a>-inner.png --output <dir> --rows 1 --cols 1 --cell-size 512
   --duration 100 --align center --scale fit --fit 1 --threshold 180 --feather 0 --edge-threshold 210
   --sampling nearest --component-mode all --allow-source-edge-touch` — the marker's own parameters
   with `--fit 1`, which is the other half of the fix: at the marker's default `fit 0.86` a full-bleed
   texture is INSET inside its 512 cell and ships with a transparent margin, so it exports clean,
   passes its checks and cannot tile.

Everything needed to redo this is now committed beside the assets, so the tiles are regenerable by
someone who is not the author:

- `zone-outlands/detile-tile.py` — the crop script.
- `zone-outlands/floor-outlands/{raw-source.jpg, floor-inner.png}` and
  `zone-outlands/border-outlands/{raw-source.jpg, border-inner.png}` — the provider raw and the
  intermediate actually processed, side by side. `sprite-metadata.json.source.file` names the
  intermediate, so the path back from disk is raw → intermediate → sheet with no missing link.

**Tileability verified numerically, not just by eye:** `minAlpha` of both shipped `sprite.png` files is
**255** (fully opaque everywhere, so no inset margin, so the repeat is valid). 0 would mean broken.

Note on the mortar-seam clause: it does not apply to this zone. Neither outlands tile has a repeating
block grid to align the canvas edge to — the floor is an organic crack network and the border an organic
thicket — so seam continuity here was achieved by the directional-streak clause and confirmed on the
tiled preview instead.

## qcExceptions lines (NOT written to the shared manifest — for central application)

```json
{ "id": "zone-outlands/floor-outlands", "reason": "Seamless full-bleed floor tile: the texture must reach every canvas edge for the repeat to work, so there is no magenta key and border/edge-contact QC cannot pass by construction — same documented case as the template's own arena/floor and bg/arena exports." }
{ "id": "zone-outlands/border-outlands", "reason": "Tileable full-bleed border band: horizontal repeat requires edge-to-edge coverage, so magenta-key and edge-contact QC are inapplicable by design (template arena/floor precedent)." }
{ "id": "zone-outlands/props-outlands-b", "reason": "Cell 3 (ash vent) reads as a cracked debris pit with amber embers rather than a fissure with a discrete rising ash-dot column; the hazard-marker dot motif is weak. Retry budget spent on the sheet's edge-touch and contamination symptoms, and 8 of 9 cells are on-brief, so the sheet ships rather than re-rolling nine good props for one." }
{ "id": "zone-outlands/props-outlands-a", "reason": "All nine props carry a small welded dirt patch under them (the provider's implied-ground artifact, alpha-connected to the prop so it cannot be filtered). On this zone's grey mudflat the patch reads as the prop's own footprint rather than as a foreign ground strip, and props-outlands-b matches it, so the two sheets stay consistent." }
```

The two tile lines are the ones the brief pre-authorised. The two prop lines are the honest ones from
this build.

## Sheets I would defend, and the one I would flag

Beside `hero/hero-idle` and `enemies-light/enemy-husk-move`, all three giant sheets, both kite sheets and
both prop sheets read as the same game: visible chunky pixels, hard near-black outline, cold desaturated
grey, red pinprick eyes present on every hostile. The giant chain is identity-consistent across
move/attack/death (cold blue-grey hide, tiny head sunk between the shoulders, exposed ribs, pale sagging
belly) — the first attack and death takes drifted green/teal and yellow and were both regenerated with an
explicit three-signature-feature clause, which fixed it.

The one I would flag: **`props-outlands-b` cell 3**, the ash vent, per the exception above. It is the
zone's hazard marker, so if anything in this group deserves one more pass at integration it is that
cell — but the sheet is shippable as it stands.

## Housekeeping done

Stale `raw-source.webp` files from discarded codex attempts deleted from `enemy-kite-move`,
`border-outlands` and `floor-outlands`; every dir now holds exactly one raw, all `.jpg` (xai).
