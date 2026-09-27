# buildings-c — defence buildings + Beacon Spire (owner: ArtBuildingsC)

**Tool probe:** `generate_image` 1024x1024 no-marker probe → `xai-oauth / grok-imagine-image`, OK.
Every call after that was served by `xai-oauth` (read from `sprite-metadata.json.source.provider`).

**Status: landed complete.** 10/10 ids in `public/assets/generated/buildings-c/<id>/`
(staging + rejected raws + QC sheets in `art/exports/buildings-c/`). 0 ids missing.

## Per-asset table

| id | intent (PRD §5) | grid / cell | render px | subject box in cell | generations | meanDistance (≤ 52) | outlier | export QC | visual verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bld-pulse-mk1 | anchor, twin amber emitters on teal ring | 1x1 / 256 | 64 | 230×213 | 1 (anchor pass) + re-process | 24.79 | 0.021 | strict pass | accepted anchor, re-processed to fit 0.9 bottom (see Criteria) |
| bld-pulse-mk3 | same egg housing, 4 barrels, brass collar, taller plinth | 1x1 / 256 | 64 | 184×230 | 2 | 27.28 | 0.098 | strict pass | accepted: housing identity kept; base became a narrower pedestal (reads as the upgrade) |
| bld-arc-mk1 | tall copper coil, brass sphere electrode | 1x1 / 256 | 128 | 87×230 | 1 | 28.90 | 0.076 | strict pass | accepted: tallest-narrow silhouette of the set |
| bld-arc-mk3 | caged heavy coil, copper torus electrode, hex teal base | 1x1 / 256 | 128 | 157×230 | 2 | 34.88 | 0.140 | strict pass | accepted r2. a1 rejected: near-copy of Mk I (one extra brass band) — no visible upgrade |
| bld-flak-mk1 | stubby fat mortar on octagonal cream bunker, nacre shell rack | 1x1 / 256 | 128 | 230×197 | 1 | 23.63 | 0.013 | strict pass | accepted |
| bld-flak-mk3 | twin tubes, brass sleeves, bigger shell rack | 1x1 / 256 | 128 | 230×229 | 1 | 25.71 | 0.020 | strict pass | accepted |
| bld-wall-mk1 | riveted grey hull plate on end, hazard stripes, buttress feet | 1x1 / 256, fit 0.97 | 64 | 248×188 | 1 | 25.26 | 0.004 | strict pass | accepted; tiles side by side (see tiling note) |
| bld-wall-mk3 | double plate, brass cap rail, amber lamp stud | 1x1 / 256, fit 0.97 | 64 | 248×190 | 1 | 25.73 | 0.015 | strict pass | accepted; plate went cream hull instead of grey (upgrade reads as colony-hull armour) |
| bld-beacon | violet-nacre prism needle in brass clamps on cream domed base, unlit | 1x1 / 384 | 192 | 198×346 | 1 | 26.51 | 0.034 | strict pass | accepted: the tallest landmark, reads at 192 |
| bld-beacon-charging | same spire, amber/white core inside the prisms | 2x2 / 384, 150 ms loop | 192 | 196×345 all 4 frames | 2 | 31.58 | 0.075 | strict pass, bodyScaleCv 0 | accepted r2. a1 rejected: pink key halo around the glow + no readable progression |

Processing for every export: `hd-body`, `scale fit`, `fit 0.9` (walls 0.97), `align bottom`,
threshold 150 / feather 55 / edgeThreshold 170, smooth, componentMode largest, strict, then the
chroma guard OFF (rekey). `qc.notes` empty on all ten; no components dropped.

### Frame maps
- All ids except `bld-beacon-charging`: 1 frame, `sprite.png` (256×256; beacon 384×384).
- `bld-beacon-charging`: `sprite-sheet.png` 768×768, 2x2, frames 0-3 row-major, 384×384 each,
  150 ms, loop. Measured amber fill (px with r>200, g>110, b<140 in the column): f0 2613,
  f1 2080, f2 2069, f3 4090 (f3 lit to the tip). It reads as a PULSE (glow, settle, settle,
  flare) — which is the manifest action ("prism needle pulsing amber light") — not a monotonic
  rise. The 0-100 % charge progress is the HUD's job; if a rising read is wanted the integrator
  can play frames `[2,1,0,3]` (2069→2080→2613→4090) with no pixel change.

### Frame-0 consistency (one design across animations)
`art/exports/buildings-c/qc-beacon-frame0.png`: idle + charging f0-f3 side by side. Spire shape,
3 brass clamps, cream dome, teal pipe skirt, 12 amber windows are identical across all five;
only the column fill changes. The other ids are single-frame, and Mk I/Mk III pairs are in
`qc-set-mk1-mk3.png`. Render-size preview (64 / 128 / 192 px): `qc-render-size.png`.

### Wall tiling
`qc-wall-tiling.png`: 5 segments of each tier at 64 px. Segments butt with ≤ 1 px gap (fit 0.97
leaves 4 px per side at 256). Each segment keeps its own ink outline and the top edge has a slight
3/4 slope, so a run reads as a row of bolted modular plates, not one seamless slab. Only a
horizontal (front-facing) segment exists; vertical wall runs use the same sprite (runtime concern).

## Content-id coverage (this group)

| content id (PRD §5) | world sprite(s) | icon | world fx |
| --- | --- | --- | --- |
| pulse_turret | bld-pulse-mk1, -mk3 (Mk II = Mk I + rank pips per plan) | icons group (not mine) | pulse bolt: fx group |
| arc_coil | bld-arc-mk1, -mk3 | icons group | arc segment: fx group |
| flak_mortar | bld-flak-mk1, -mk3 | icons group | flak shell + burst: fx group |
| plate_barricade | bld-wall-mk1, -mk3 | icons group | — |
| beacon_spire | bld-beacon, bld-beacon-charging | icons group | beacon beam + launch flare: fx group |

Zero placeholders in this group.

## Wiring contract (registry keys = manifest ids, group `buildings-c`)

| key | file | frame | frames | duration | footprint / draw size |
| --- | --- | --- | --- | --- | --- |
| bld-pulse-mk1 / -mk3 | sprite.png | 256×256 | 1 | 0 | 1×1, 64 px |
| bld-wall-mk1 / -mk3 | sprite.png | 256×256 | 1 | 0 | 1×1, 64 px |
| bld-arc-mk1 / -mk3 | sprite.png | 256×256 | 1 | 0 | 2×2, 128 px |
| bld-flak-mk1 / -mk3 | sprite.png | 256×256 | 1 | 0 | 2×2, 128 px |
| bld-beacon | sprite.png | 384×384 | 1 | 0 | 3×3, 192 px |
| bld-beacon-charging | sprite-sheet.png | 384×384 | 4 | 150, loop | 3×3, 192 px |

All bottom-aligned: the base sits 13 px (256 cells) / 19-20 px (384 cells) above the cell bottom
(`(1 - fit)/2` padding), walls 4 px. Origin (0.5, 1) with that pad is the ground contact.

## Set gates

**art_review** (10 assets, renderScale 128, characters pulse/arc/flak/wall/beacon): `passed: true`.
- Silhouettes: every gated cross-character pair ≥ 0.100 (min arc-mk1 × beacon 0.100, then
  pulse-mk3 × arc-mk3 0.121); no findings. Same-character pairs exempt (wall Mk I/III 0.008 —
  same plate by design).
- Value: only `value-plan-miss:*` warnings. Scope: those tiers are calibrated for the whole
  profile; cream hulls run 30-77 % lights (anchor QC recorded the same on the core at 53 %).
  Reported, not acted on. Lightness spread 0.80-0.91 on every asset (no collapsed range).

**figure-ground.py** — no field in this group, so it is not this group's acceptance gate; run for
information over the only accepted floor with the cast that exists (10 buildings-c + core +
drill + skitter), renderScale 128:
- `--scene glass-steppe` (no grade): clash 0.00 %, busyRatio 0.07×, C1 PASS, read recessive, exit 0.
- `--scene glass-steppe-night --grade 2c2640`: clash 0.00 %, busyRatio 0.07×, C1 PASS, exit 0.
- Cast still partial (other buildings-a/-b, fauna-a/-b in flight): re-run after wave 1.

**manifest-lint:** not re-run by me (I did not touch the manifest); the delta below needs the
owner's merge + lint.

## CRITERIA

- **Plan §0.3 marker key is wrong (measured, reported to Main and filed).** `"scaleMode":"fit"` is
  not a marker field; sprite-forge reads `scale` (`extensions/sprite-generate.ts:26,694`). The
  unknown key is dropped silently: my first 4 exports recorded `metadata.output.scaleMode:
  "preserve"` (arc Mk I came out 57×150 in a 256 cell). Fixed by `"scale":"fit"` in later markers
  and by re-processing the first 4 raws at scale fit (`art/exports/buildings-c/refit.py`).
- **Chroma guard vs. the pinker xai key (new measurement).** Every call that carried an explicit
  Image 2 input (5 of 5: pulse-mk3 ×2, arc-mk3, flak-mk3, wall-mk3, beacon-charging) failed strict
  `source-edge-touch` although the raws had wide margins. Their key measured
  rgb(252,84-95,171-183) — pinker than §0.1's (252,45-80,…) — and the guard kept it as subject.
  The same raws pass strict with identical params minus the guard
  (`art/exports/buildings-c/process_raw.py`, the rekey processing applied to the raw). Those
  exports carry no `sprite-metadata.marker.json`; their generation args (styleProfile bound,
  vision anchor appended) are in this report. Not a provider defect; not a regeneration reason.
- **Post-review pixel transforms, reviewed through:** (1) rekey (guard off) on all ten; reviewed
  the rekeyed output. (2) The accepted anchor `bld-pulse-mk1` was re-processed from its own raw
  from `align center, fit 0.86` to `align bottom, fit 0.9` so Mk I and Mk III share a base line and
  fill; reviewed in `qc-set-mk1-mk3.png` (`art/anchors/` untouched). (3) Runtime: the night grade
  `#2c2640` is applied by figure-ground to the FIELD only, not to the actors, so the night run
  above does not see graded buildings; the building dim-to-night tint and the lit-ground +12 % are
  not modelled by any gate. These are open, as in anchors/QC.md.
- `meanDistance` is read as distance from the palette list, not as quality. Highest is arc-mk3
  34.88 (saturated copper + teal), inside 52.

## Regeneration counts

pulse-mk3 2 (guard-caused strict fail, then accepted), arc-mk3 2 (a1 visually rejected: no
upgrade), beacon-charging 2 (a1 visually rejected: pink halo, no progression). Everything else 1.
No asset reached attempt 3; no qcExceptions needed (all ten strict-pass).

## manifest-delta

```json
{
  "group": "buildings-c",
  "note": "Defense buildings + Beacon Spire. hd-body, marker \"scale\":\"fit\" (NOT scaleMode), fit 0.9, align bottom, cellSize 256; beacon + beacon-charging 384; walls fit 0.97 so segments butt side by side. Chroma guard off after export (rekey / process_raw).",
  "attempts": {
    "bld-pulse-mk1": 1,
    "bld-pulse-mk3": 2,
    "bld-arc-mk1": 1,
    "bld-arc-mk3": 2,
    "bld-flak-mk1": 1,
    "bld-flak-mk3": 1,
    "bld-wall-mk1": 1,
    "bld-wall-mk3": 1,
    "bld-beacon": 1,
    "bld-beacon-charging": 2
  },
  "qcExceptions": [],
  "generationPlanFix": "§0.3: replace \"scaleMode\":\"fit\" with \"scale\":\"fit\"; §0.1: xai key also measured rgb(252,84-95,171-183) - the chroma guard then fails strict source-edge-touch on input-bearing calls; process the raw without the guard."
}
```
