# buildings-a — report (owner ArtBuildingsA)

**Tool probe:** `generate_image` 1024x1024, no marker → `xai-oauth / grok-imagine-image`, JPEG saved to the omp temp dir. OK.
`sprite_check_palette`, `art_review` also exercised (numbers below).

Group landed COMPLETE: 13/13 ids in `public/assets/generated/buildings-a/<id>/` (staging and raws in
`art/exports/buildings-a/`). Every export: `hd-body`, marker `"scale":"fit","fit":0.9,"align":"bottom"`,
`threshold 150`, `styleProfile` bound, then `art/tools/rekey.py` (chroma guard off). Every shipped
`sprite-metadata.json` reads `output.scaleMode = fit` (checked on all 13, including after the
orchestrator's `scaleMode`-key notice — this group used the `scale` key from the first call).
Provider on all 13 (`source.provider`): `xai-oauth`.

## Per-asset table

attempts = number of generations (the first one counts as 1), so regenerations = attempts − 1.

| id | intent / silhouette brief | grid / cell | subject h (px of 256) | bodyScaleCv | meanDistance | attempts | regen reasons | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bld-core | Lander Core, 3×3 dome hub (anchor) | 1x1 / 384 | 291/384 | 0 | 26.12 (anchor pass) | 1 | — | copied from `art/anchors` |
| bld-drill-mk1 | saucer base + lattice mast, piston (anchor) | 2x2 / 256 | 230 | 0 | 25.39 (anchor pass) | 2 | anchor pass | copied from `art/anchors` |
| bld-drill-mk3 | taller double mast, brass pulley crown, teal beacon, steel-plated saucer, 2 window rows, twin pistons | 2x2 / 256 | 230 | 0 | 29.40 | 2 | #1 frame 0 was the Mk I rig and frames 2-3 had a different base (drift inside the sheet) | piston travel is small. A thin pinkish dust haze near the pistons makes up 0.22% of pixels (the drill-mk1 anchor has 0.29%) |
| bld-borer-mk1 | tall slim column on 4 splayed legs, amber-coil corkscrew into ice | 2x2 / 256 | 230 | 0.0013 | 31.72 | 1 | — | the pink-tinted steam was keyed out by rekey; the motion reads through the coil glow |
| bld-borer-mk3 | column plus 2 side tanks, brass crown of lamps, 6 legs, double-flight auger | 2x2 / 256 | 230 | 0.0013 | 31.62 | 1 | — | the marker export FAILED source-edge-touch on all 4 frames: the chroma guard protected 777,895 px, which is the whole pale-pink background. The raw was recovered from the temp file and re-keyed. No regeneration |
| bld-harvester-mk1 | low wide saucer crawler, 2 round saws, gold crystal | 2x2 / 256 | 187.5 | 0.0016 | 29.73 | 1 | — | `largest` dropped 2,295 px of flying chips |
| bld-harvester-mk3 | same saucer hull plus raised amber-window turret, twin teal lamps, crystal hopper, steel skirts | 2x2 / 256 | 187.5 | 0.0016 | 31.05 | 3 | #1 identity drift (came back as a truck cab); #2 no visible upgrade (a copy of Mk I with violet crystal) | budget spent. The qcException is in the delta. Frame 0 has cream tread pods and frames 1-3 have steel ones. 2 saws, not the 3 briefed |
| bld-venttap-mk1 | squat round cowl with an open fan top, base ring | 2x2 / 256 | 157 | 0 | 26.89 | 2 | #1 background-contamination plus source-edge-touch: the provider drew grid divider lines and a smoke plume across the cell edges | the vapour wisp was keyed out, so the fan turn is the only motion |
| bld-venttap-mk3 | two-stage stacked turbine, 4 brass stacks, riveted steel plating, amber window band | 2x2 / 256 | 229.5 | 0.0026 | 30.76 | 1 | — | the hull shifted from cream to steel plating (reads as armoured). The identity carrier (drum plus fan) is kept |
| bld-sail-mk1 | thin mast under a wide 6-petal gold flower | 2x2 / 256 | 228 | 0.0096 | 24.39 | 1 | — | the tilt tracks left to right |
| bld-sail-mk3 | petals with teal solar-cell inlays, thick cream pylon with amber window, steel plinth | 2x2 / 256 | 228 | 0.0078 | 32.44 | 2 | #1 upgrade not visible (only a tripod and a box added) | — |
| bld-bank-mk1 | low cream cabinet, picket of 10 teal cells | 1x1 / 256 | 161 | 0 | 31.61 | 1 | — | — |
| bld-bank-mk3 | two-tier cell rack, steel corner armour, brass fin stack, 4 amber lamps | 1x1 / 256 | 190 | 0 | 37.68 | 1 | — | same guard failure as borer-mk3 (759,921 px protected), recovered the same way. No regeneration |

All 11 new `sprite_check_palette` results: `passed: true`, meanDistance between 24.39 and 37.68 against max 52.
Regenerations used: drill-mk3 1, harvester-mk3 2, venttap-mk1 1, sail-mk3 1. Total generation calls: 16
(+1 probe; +6 calls rejected by `urlopen [Errno 49] Can't assign requested address` before reaching the
provider. That is local ephemeral-port exhaustion: 2,773 TIME_WAIT sockets were measured at the time. The
same prompts succeeded when resent 1-3 at a time. It was not a prompt, input-count or marker boundary).

## Frame maps (all 2x2 sheets, reading order, 120 ms, loop)

| key | f0 | f1-f3 |
| --- | --- | --- |
| drill | idle, piston up | piston strokes and ore dust |
| borer | idle, coils dim | auger turns, coils glow amber |
| harvester | idle, saws lifted | saws spin into the crystal, chips |
| venttap | idle, fan still | fan turns about 1/3 per frame |
| sail | idle, half closed, tilted left | opens and tilts step by step to the right |

core and bank are 1x1 statics (`sprite.png`, duration 0).

## Frame-0 consistency (Mk I row 1 / Mk III row 2)

`art/exports/buildings-a/frame0-contact.png` (256 px cells) and `frame0-contact-128.png` (the 128 px
render size). Each Mk III keeps its Mk I silhouette type: mast, column, saw crawler, drum, flower, rack.
Each also reads as upgraded at 128 px through added mass and lights. Known in-sheet drift: harvester-mk3
frame 0 tread pods (cream vs steel).

## Set gates

- `art_review` set call, 13 assets, renderScale 128, `characters` pairing Mk I with Mk III: **passed**,
  silhouettes passed.
  - The closest cross-character pairs are core↔bank-mk3 0.106 and harvester-mk3↔venttap-mk1 0.111.
  - Among the extractors (drill/borer/harvester/venttap) the minimum cross pair is 0.111, then
    drill-mk3↔borer-mk1 0.130.
  - All of these are above the canon cross-pair floor 0.088. Same-building Mk pairs (0.031-0.191) are
    exempt by design.
  - Value findings are `value-plan-miss:*` warnings only. Cream hulls run 17-53% lights against the
    planned 15%, the same pattern the anchor QC recorded for the core (53%). They are not acted on
    (scope: warn-only, canon fails it).
- `figure-ground.py --scene glass-steppe`, actors = the 13 buildings-a sheets plus fauna-skitter-walk,
  field = `art/anchors/terrain/steppe-floor-a/sprite.png`, renderScale 128, no grade: clash 0.00%,
  busyRatio 0.07×, C1 PASS, read recessive, **exit 0**. This is a PARTIAL cast (buildings-b/-c and the
  rest of the fauna are not in it), so it is informational. This group owns no field.
- `manifest-lint.py`: exit 0, 0 errors, 0 warnings (run before the delta below. The delta adds
  `attempts: 3` to harvester-mk3 WITH its exception, so it stays clean when merged together).

## CRITERIA

- **Residual key tint** (scope: keyed actor sheets on xai pink raws; calibrated on this group plus the
  accepted drill-mk1 anchor). Share of visible px with `min(r,b)-g>40 & r>150 & b>120`:
  - this group ranges 0.00-0.44% (borer-mk3 highest);
  - the accepted anchor drill-mk1 measures 0.29%.
  - The canon sits inside that band, so no asset is rejected on it. REPORTED only.
- **Retracted belief, measured:** generation-plan §0.5 says a sibling's explicit `input` "becomes Image 2".
  The middleware source (`extensions/sprite-generate.ts:860`,
  `merged.input = [...existing, ...anchors]`) APPENDS the vision anchor after explicit inputs. So on
  Mk III calls the Mk I raw is **Image 1** and the vision anchor is **Image 2**, and the prompts here
  were written that way. The plan's wording should be flipped by the art owner.
- **New failure mode, measured:** the marker chroma guard can protect the ENTIRE background when xai
  returns a paler pink key (borer-mk3 777,895 px; bank-mk3 759,921 px). The strict export then fails on
  source-edge-touch, which looks like a composition defect and is not one. The raw is not written on
  failure (atomic export), so the recovery is to copy the omp temp raw into the asset dir and run
  `rekey.py`. That spends no regeneration. Worth folding into rekey.py (accept a raw path) — flagged, not
  done (not my file).
- **Post-review pixel transforms, not reviewed through** (none are final and there is no build):
  - night grade `#2c2640` @ 0.55;
  - building dim-to-night tint;
  - baked ink outline `#141519` 3 px from `core/outline.ts`.
  The figure-ground run above is ungraded. Re-run with `--grade` once runtime values land.

## Wiring contract (registry via `gen-art-registry.mjs`, integrator)

Texture keys = asset ids. The 2x2 sheets are 512×512, 4 frames of 256×256, 120 ms loop, frame 0 = idle
(play frame 0 static when unpowered or unstaffed). bank-mk1/-mk3 are 256×256 `sprite.png`. core is
384×384. All are bottom-aligned inside the cell (fit 0.9), so the origin is (0.5, ~0.95) on the footprint
centre. Mk II = the Mk I sheet plus runtime rank pips (manifest note).

## manifest-delta

```json
{
  "attempts": {
    "bld-drill-mk3": 2, "bld-borer-mk1": 1, "bld-borer-mk3": 1,
    "bld-harvester-mk1": 1, "bld-harvester-mk3": 3,
    "bld-venttap-mk1": 2, "bld-venttap-mk3": 1,
    "bld-sail-mk1": 1, "bld-sail-mk3": 2,
    "bld-bank-mk1": 1, "bld-bank-mk3": 1
  },
  "qcExceptions": [
    { "id": "bld-harvester-mk3", "reason": "Budget spent (3 generations): frame 0 tread pods are cream while frames 1-3 are steel, and 2 saws instead of the briefed 3; hull, turret, hopper and saws read as one upgraded harvester at 128 px." }
  ]
}
```
