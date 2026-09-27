# deposits + relics — group report (owner ArtWorld)

**Tool probe (rule 0):** `generate_image` 1024² throwaway, no marker → `xai-oauth / grok-imagine-image`, OK.
QC devices used: `sprite_check_palette`, `art_review`; set gate `figure-ground.py`; `manifest-lint.py` exit 0
(0 errors, 0 warnings, read-only run after landing).

**Status: 5/5 ids landed** — `public/assets/generated/deposits/{dep-ore,dep-ice,dep-crystal,dep-vent}/` and
`public/assets/generated/relics/relics/` (staged in `art/exports/deposits/`, `art/exports/relics/`, copied whole).
No ids missing. This one report covers both groups because both were assigned to ArtWorld (the manifest still
names `ArtRelics` as relics owner — see manifest-delta).

## Method

- Actor calls: `styleProfile` in the marker (vision-1 auto-appended as Image 1), fixing clause, no explicit input.
- Marker: `{"rows":2,"cols":2,"profile":"hd-fx","cellSize":256,"duration":0,"threshold":150,"scale":"fit","fit":0.9,"componentMode":"all","styleProfile":"games/2026-09-26-outpost-aurelia/art/style.json"}`.
  `metadata.output.scaleMode == "fit"` verified on all 5. Fit uses ONE shared sheet scale, so the purity size
  steps drawn by the provider survive into the export (that is the point of the deposit sheet).
- `art/tools/rekey.py` run on every accepted export (marker metadata kept as `sprite-metadata.marker.json`).
- Deposit design: a LOW, FLAT ground patch (flush lens/scar), never a volumetric rock — so it reads as a
  tappable resource and not as a blocker. Purity is carried by three channels at once: footprint size,
  richness (nugget/tooth/crack count) and inner glow; depleted = normal footprint, greyed, no glow.

## Per-asset table

`meanDistance` = `sprite_check_palette` vs `art/style.json` (max 52). regens = regenerations (manifest `attempts`).
Area = opaque px (α>32) per 256² cell, frames 0/1/2/3 = impure/normal/pure/depleted.

| id | intent | grid / cell | meanDistance (outliers) | cell area 0/1/2/3 | pure ÷ normal area | regens | qc | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dep-ore | Ferrite Seam: rust iron-crust plates + steel nuggets, amber cracks when pure | 2x2 / 256 | 25.04 (0.013) | 10993 / 19412 / 24034 / 19824 | 1.24 | 0 | strict pass | pure = densest nuggets + molten-amber cracks |
| dep-ice | Rime Lens: frost-blue ice pool, fracture lines, inner blue-white glow | 2x2 / 256 | 41.07 (0.264) | 15671 / 20043 / 26939 / 19733 | 1.34 | 0 | strict pass | high mD = cold blue, fact about the LIST (same as rime-blockers 41.24) |
| dep-crystal | Aurel Geode: stubby gold crystal teeth through cracked soil | 2x2 / 256 | 29.64 (0.021) | 10582 / 15699 / 21364 / 16321 | 1.36 | 0 | strict pass | pure crown glows; depleted = grey stumps |
| dep-vent | Ember Vent: dark basalt fissure, amber heat cracks, low steam puff | 2x2 / 256 | 22.01 (0.027) | 10886 / 15356 / 23490 / 15054 | 1.53 | 2 | strict pass | take 1: pure's tall steam plume crossed into cell 0 → `source-edge-touch` f0/f2 (raw not reprocessed: it is a real crossing, not antialias); take 2: exported, but pure area = normal (20714 vs 20751) and depleted still steamed → purity unreadable; take 3 (accepted): explicit 40/60/88% size steps, "absolutely no steam" on depleted |
| relics | Probe Wreck / Chorus Stone / Signal Buoy / Hollow Geode | 2x2 / 256 | 28.09 (0.038) | 21902 / 17116 / 12943 / 28414 | — | 0 | strict pass | 73 residual pinkish px (soil flecks under the probe); negligible, not a halo |

Provider: `xai-oauth` on every call (`sprite-metadata.json.source.provider`). No `qc.notes`, no `.failed.json` left.

## Frame maps (icons[] order = frame order, row-major)

| frame | dep-ore | dep-ice | dep-crystal | dep-vent | relics |
| --- | --- | --- | --- | --- | --- |
| 0 | dep-ore-0 impure | dep-ice-0 impure | dep-crystal-0 impure | dep-vent-0 impure | relic-probe (Probe Wreck) |
| 1 | dep-ore-1 normal | dep-ice-1 normal | dep-crystal-1 normal | dep-vent-1 normal | relic-monolith (Chorus Stone) |
| 2 | dep-ore-2 pure | dep-ice-2 pure | dep-crystal-2 pure | dep-vent-2 pure | relic-buoy (Signal Buoy) |
| 3 | dep-ore-x depleted | dep-ice-x depleted | dep-crystal-x depleted | dep-vent-x depleted | relic-geode (Hollow Geode) |

## Coverage (content id → art)

All 12 PRD deposit ids (`dep-{ore,ice,crystal,vent}-{0,1,2}`) + 4 depleted states + 4 relic ids have a frame.
Zero placeholders. Not applicable: weapon/evolution world fx; frame-0 consistency sheets (no multi-action
characters — each sheet is a set of states/objects, not animations).

## Wiring contract

- `deposits/dep-<kind>/sprite-sheet.png`, 2×2 grid of 256² cells, static (`duration 0`); frame index =
  purity (0 impure, 1 normal, 2 pure, 3 depleted). Draw at 128 px (2×2 tiles, the extractor footprint).
- hd-fx centred fit with one shared sheet scale: place the frame centre on the 2×2 footprint centre. Do NOT
  per-frame rescale to fill the footprint — the size difference between frames IS the purity read.
- `relics/relics/sprite-sheet.png`, 2×2 grid, frame i ↔ icons[i] above; draw at 128 px, centred.
- Glow is painted in the art; no runtime tint needed. If the integrator adds a pulse/tint on pure deposits,
  that is a post-review transform and must be re-measured (see CRITERIA 4).

## Set gates

### figure-ground.py (fields = the 3 floors of each biome, renderScale 128)

Repro: `python3 art/exports/deposits/fg_deposits.py` (writes graded copies to `art/exports/deposits/_qc/graded/`).

| cast | transform | actor p90 | clash% (12 fields) | busyRatio | C1 | exit |
| --- | --- | --- | --- | --- | --- | --- |
| brief: 4 deposit sheets + relics (5) | day | 0.5209 | 0.000 | 0.069-0.114 | PASS | 0 |
| brief | night overlay #2c2640 α0.55 (actors+floor) | 0.1509 | 0.000 | 0.049-0.083 | PASS | 0 |
| brief | lit ground +12% (floor) | 0.5209 | 0.000-0.002 | 0.075-0.126 | PASS | 0 |
| full: brief + every buildings-*/fauna-* sheet in public + biome blockers (67) | day | 0.7233-0.7257 | 0.000 | 0.045-0.074 | PASS | 0 |
| full | night | 0.1941-0.1951 | 0.000 | 0.034-0.058 | PASS | 0 |
| full | lit | 0.7233-0.7257 | 0.000 | 0.049-0.082 | PASS | 0 |

Per-sheet (each sheet alone as the cast, day, 4 biomes) — so a dark sheet cannot hide in a pooled p90:
dep-ore clash ≤ 0.028%, dep-ice 0.000, dep-crystal 0.000, dep-vent ≤ 0.045%, relics 0.000; all exit 0.
The darkest deposit (dep-vent, actor p50 0.066) is the closest to the floors; its impure frame on ember mud is
the weakest read in the set (visible by ink outline + faint glow at 128 px) and still passes. No FAIL, nothing
regenerated for figure/ground.

Visual: `art/exports/deposits/_qc/deposits-on-floors.png` (all 16 deposit frames at 128 px on each biome's
floor, with that biome's blockers 1-3 at the end) and `_qc/relics-on-floors.png`. Purity reads on every floor:
impure < normal < pure by size, and pure is the only frame with a bright core.

### Deposits vs blockers/props (tappable-resource read)

- Shape: every deposit cell is a flat patch, h/w 0.46-0.67; blockers are volumetric with a tall front face
  (h/w up to 2.59). The flat blockers (block-2 mesa/shelf, block-6 ridge, h/w 0.37-0.60) overlap on aspect
  only; they differ by a thick vertical side face and by carrying the biome's own rock colour.
- Hue/value: each deposit carries an identity hue the floors and blockers do not — normal-frame saturated mean
  ore #894029 (rust, sat share 0.94), ice #4b87a9 (frost blue), crystal gold teeth, vent near-black basalt
  (65% darks) with amber cracks. Pure frames add a glowing core no blocker or floor has.
- Ore vs threat rust: ore saturated mean #813d28 (L* ≈ 33) vs threat #c8553d (L* 50.8), RGB distance ≈ 77; the
  vision anchor's ore rocks sample #5a382d, so ore sits between canon and threat, not on threat.

### art_review set call (5 sheets, renderScale 128, `characters` = one per sheet)

- Per asset: all `passed: true`. Warnings: dep-ore `value-tier-absent:light` (1.2%); dep-ice `value-plan-miss:dark`
  (21%); dep-vent `value-plan-miss:dark/mid` (65/31% — basalt is dark by material). Scoped as warnings (rule 10).
  Value spread 0.54-0.88.
- Silhouettes: `silhouette-collision` FAIL on dep-ore↔dep-ice 0.041 and dep-ore↔dep-vent 0.046. Other pairs
  0.066-0.214; every deposit↔relics pair ≥ 0.195. **Rescoped, not acted on** — CRITERIA 1.

## CRITERIA

1. **Rescoped: `silhouette-collision` between deposit kinds.** Calibrated on characters (distinct actors must
   have distinct masses). Deposits are not characters: PRD §5.2 mandates "the extractor footprint must cover the
   patch exactly", so four kinds sharing one flat 2×2 patch outline is the contract, and an outline difference
   would be a defect. Identity is carried by hue/material/value (measured above). Also compared as whole 2×2
   atlases, which terrain already rescoped to per-cell. Written as a qcException in the delta.
2. **Not a reject: `meanDistance` 41.07 on dep-ice.** The list holds one cold blue; Rime owns frost blue per the
   profile's temperature line. Same fact the terrain group recorded for rime-blockers (41.24).
3. **Folklore check:** none invoked; one provider served every call (xai-oauth), no provider comparison possible.
4. **Post-review pixel transforms reviewed through:** night overlay #2c2640 α0.55 (actors + floor) and lit
   ground +12% (floor), repro `art/exports/deposits/fg_deposits.py`. Not reproduced: "deposits outside the field
   show as silhouettes" (PRD §5.2) and any fog-of-war darkening — values not in `src/` yet; a silhouette/fog
   tint on deposits must be re-measured by the integrator with this script once it exists.
5. **Retry-budget accounting:** dep-vent used 2 regenerations on two different symptoms (edge crossing; purity
   unreadable), within budget; no third attempt, no exception needed.

## manifest-delta

```json
{
  "groups": {
    "relics": { "owner": "ArtWorld" }
  },
  "assets": {
    "dep-vent": { "attempts": 2 }
  },
  "qcExceptions": [
    { "id": "dep-*", "reason": "art_review silhouette-collision (ore/ice 0.041, ore/vent 0.046) is by contract: all deposit kinds share the flat 2x2 extractor-footprint patch; kinds read apart by hue/material/value (rust plates, frost-blue ice, gold teeth, dark basalt with amber cracks)." }
  ]
}
```

Registry: the integrator runs `node scripts/gen-art-registry.mjs` and adds `deposits` and `relics` to the colony
slice's `ART_GROUPS`.
