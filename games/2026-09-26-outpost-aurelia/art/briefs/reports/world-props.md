# world-props — group report (owner ArtProps)

**Tool probe (rule 0):** `generate_image` 1024² throwaway, no marker → `xai-oauth / grok-imagine-image`, OK.
QC devices used: `sprite_check_palette` (17 calls), `art_review` (1 set call over all 14 sheets + 1 calibration call),
`figure-ground.py` (3 transforms × 4 biome scenes), `manifest-lint.py` exit 0 (0 errors, 0 warnings, read-only run).

**Status: 14/14 ids landed** in `public/assets/generated/world-props/<id>/` (staged in `art/exports/world-props/<id>/`,
copied as a complete group). 126 single-prop cells. No ids missing.

## Method

- Actor calls: `styleProfile` in the marker (vision anchor auto-appended as Image 1), fixing clause, per-cell prop list
  with a silhouette/material per cell, "ONE single standalone object, never a heap", "no lights, no glow, no red, no green".
- Marker: `{"rows":3,"cols":3,"profile":"hd-fx","cellSize":256,"duration":0,"threshold":150,"styleProfile":…}` —
  the terrain-blocker precedent (hd-fx centred fit, `scaleMode fit` verified in every metadata, one shared sheet scale).
  Then `art/tools/rekey.py` on every accepted export (chroma guard off).
- From the 4th call on, the composition says "floating on one continuous magenta field … no grid lines, no divider
  lines" — ember-0's first take came back with drawn dark cell dividers (`background-contamination`).
- **nacre-0** failed strict `source-edge-touch` on frame 8 only; the kelp measures 47-111 px clear of every cell
  edge in the raw, so the failure is the guarded pink key. Per standing order so-2 the saved raw was re-processed
  guard-off with the marker's exact effective hd-fx params (`art/exports/world-props/process_raw.py`), not
  regenerated. `sprite-metadata.json.rekey` records it.
- Provider: `xai-oauth` for every export (`sprite-metadata.json.source.provider`).

## Per-asset table

`meanDistance` = `sprite_check_palette` vs `art/style.json` (max 52). regens = regenerations (manifest `attempts`).
red% = saturated-red share of opaque px (hue ≤15/≥345°, S≥0.55, V≥0.35), max over cells. luma = Rec.709 p50/p90 of opaque px
(buildings on disk: p50 0.586 / p90 0.883). Green share is 0.00-0.01% on every sheet. Surviving key-pink px: 0 (steppe-0: 1).

| id | intent | meanDistance | outliers | max cell red% | luma p50/p90 | regens | qc |
| --- | --- | --- | --- | --- | --- | --- | --- |
| props-shared-0 | debris, bones, boulder | 26.41 | 0.024 | 1.8 (crate stripe) | 0.523/0.853 | 0 | strict pass |
| props-shared-1 | debris, bones, stones | 28.42 | 0.022 | 0.0 | 0.434/0.816 | 0 | strict pass |
| props-steppe-0 | violet crystal, ochre flora | 29.53 | 0.066 | 0.6 | 0.353/0.667 | 0 | strict pass |
| props-steppe-1 | violet crystal, ochre flora | 27.11 | 0.058 | 0.3 | 0.316/0.545 | 0 | strict pass |
| props-steppe-2 | violet crystal, ochre flora | 33.84 | 0.061 | ≤0.4 | 0.427/0.690 | 0 | strict pass |
| props-rime-0 | ice, slate, frozen flora | 37.81 | 0.174 | 0.0 | 0.521/0.808 | 0 | strict pass |
| props-rime-1 | ice, slate, frozen flora | 35.99 | 0.177 | 0.0 | 0.512/0.842 | 0 | strict pass |
| props-rime-2 | ice, slate, frozen flora | 35.93 | 0.188 | 0.0 | 0.452/0.752 | 0 | strict pass |
| props-ember-0 | slag, basalt, fungus, reeds | 27.12 | 0.035 | 0.0 | 0.293/0.702 | 3 | strict pass |
| props-ember-1 | slag, basalt, fungus, reeds | 24.10 | 0.034 | 0.0 | 0.295/0.618 | 2 | strict pass |
| props-ember-2 | slag, basalt, fungus, reeds | 24.05 | 0.038 | 0.0 | 0.319/0.749 | 2 | strict pass |
| props-nacre-0 | shells, nacre crystal, coral | 29.68 | 0.051 | 0.0 | 0.665/0.899 | 0 (raw re-processed) | strict pass |
| props-nacre-1 | shells, sponge, sea-rock | 29.36 | 0.045 | 0.0 | 0.650/0.884 | 0 | strict pass |
| props-nacre-2 | shells, coral, bone | 28.20 | 0.037 | 0.0 | 0.584/0.836 | 0 | strict pass |

Regeneration log:
- **ember-0** ×3: (1) drawn cell dividers → `background-contamination` (anti-divider composition); (2) vent chimney
  painted saturated rust, cell red 21.8% (colour words → ash grey/charcoal, "rust only as a thin crust, no orange");
  (3) 3 flat cells (value spread 0.27/0.28/0.34) + 17 within-biome silhouette collisions, all round lumps (brief:
  "lit pale ash-grey top face, dark underside", lumps replaced by shard / step block / puffball-on-stalk). Budget:
  the 3rd regeneration is covered by the qcExceptions entry in the delta below.
- **ember-1** ×2: (1) tube-worm cell red 3.7% (colour words); (2) slag spire flat 0.29 + pumice lump collisions
  (lit-top brief; pumice → pumice arch).
- **ember-2** ×2: (1) cells red 4.0/4.1% (colour words); (2) slag nugget 0.28 + basalt stub 0.32 flat + anemone
  collisions (lit-top brief; slab with drip, tall column, frond fan).

## Frame map (row-major; frame i ↔ manifest `icons[i]`)

| frame | shared-0 (prop-shared-1..9) | shared-1 (-10..18) | steppe-0 (-1..9) | steppe-1 (-10..18) | steppe-2 (-19..27) |
| --- | --- | --- | --- | --- | --- |
| 0 | torn cream hull panel | tall standing stone | tall violet crystal shard | curled violet glass fern | umbrella plant, violet cap |
| 1 | dented fuel canister | bent tripod landing leg | fan of 5 violet crystals | ochre rock ring | jagged ochre rock, glass veins |
| 2 | rib-bone arch | vertebra/joint bone | ochre stalk + violet glass bulb | ribbed violet-grey succulent | violet crystal lying down |
| 3 | round grey boulder | rover wheel | sandstone mushroom rock | leaning violet crystal pair | lilac bell-flower stem |
| 4 | antenna stub + dish | survey marker post | dry thorn bush | 3-stone ochre cairn | wind-grooved pyramid rock |
| 5 | long thigh bone | thruster nozzle bell | 3 tube plants, one root | ribbed violet spire plant | coiled horn fossil |
| 6 | cracked supply crate | split slab rock | violet glassed nodule | star rosette, violet centre | feathery ochre plume |
| 7 | horned beast skull | cable spool | whip-grass tuft | split geode, violet crystals | stalk with violet glass pods |
| 8 | broken pipe elbow | tilted broken dish | ochre mound with hole | twisted dead stump | flat-top rock + crystal sprout |

| frame | rime-0 | rime-1 | rime-2 | ember-0 | ember-1 | ember-2 | nacre-0 | nacre-1 | nacre-2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | frost spire | curved horn spire | branched ice coral | violet-cap fungal stalk | stump + bracket fungus | funnel fungus | spiral conch | auger shell spire | nautilus shell |
| 1 | ice-crusted boulder | rime snow mound | frozen fern frond | leaning slag shard | tall slag spire | violet obsidian shard | open clam + pearl | open mussel pair | pearl crystal fan |
| 2 | frozen icicle shrub | ice flower bud | frosted boulder + crystal | ash-grey vent chimney | violet bulb stalk | bone-white fungal coral | nacre crystal shard | pearl pebble | tube sponge column |
| 3 | fan of 3 ice blades | split slate slab | ice urchin ball | violet fungus stalks | tilted slag plate | mud dome with crater | fan scallop | limpet dome shell | ribbed cockle |
| 4 | snow-capped cone rock | ice stalagmite | leaning stone + icicles | flat-top basalt block | dead thorn tree | reed with seed head | holed sea-rock | driftwood branch | rib-bone arch |
| 5 | frosted tube plant | frozen seed pod | ice-cap mushroom | drooping ash-tan reed | stacked fungus cone | slag slab + violet drip | branching coral | cup sponge | knobby coral lump |
| 6 | hex ice pillar | twin ice shards | ice arch ring | puffball on crooked stalk | pumice arch | hooded mushroom | stacked nacre plates | teal-pearl bubble stalk | abalone shell |
| 7 | frozen violet fern | rime bulb plant | frosted slate cairn | rope slag coil | tube-worm chimneys | basalt column | spiky urchin shell | barnacle rock | tendril anemone |
| 8 | cracked ice block | stepped slate stone | frozen stump | cracked mud cone | curled dead frond | violet frond fan | curled kelp stalk | lavender star shell | spiral cast mound (reads as whorl shell) |

## Coverage (content id → art)

All 126 prop ids of group `world-props` (`prop-shared-1..18`, `prop-<biome>-1..27`) have a cell; zero placeholders.
Kinds per biome scene = 18 shared + 27 biome = **45 ≥ 40** (PRD §1c). Not applicable here: icons, weapon/evolution
world fx, character frame-0 consistency sheets (no multi-action characters in this group).

## Wiring contract

- Sheet `world-props/<id>/sprite-sheet.png`, 768×768, 3×3 cells of 256², `durationMs 0` (static; 9 frames of one
  texture). Frame i ↔ `icons[i]` of that asset in `art/manifest.json`.
- hd-fx, `align center`, `scaleMode fit`, `fit 0.86`, one shared scale per sheet: relative size is meaningful within a
  sheet only. Place each frame's visual centre on its footprint centre (like terrain blockers). Designed to be drawn
  at ~64-96 px (`_qc/props-on-floor.png` mock at 80 px).
- Ink outline is painted into the art (PRD §1c "props ink baked into the art"); no runtime outline needed.

## Set gates

### figure-ground.py (`art/exports/world-props/fg_props.py`, repro of every transform)

Scenes glass-steppe / rime-basin / ember-mire / nacre-coast. Actors = **67 sheets per scene**: all 61 building + fauna
sheets on disk in `public/assets/generated/{buildings-a,-b,-c,fauna-a,-b}` + that biome's blocker sheet + the 2 shared
and 3 biome prop sheets. Fields = that biome's 3 floors. renderScale 128.

| transform | actor p90 | clash% (12 fields) | busyRatio | C1 | exit |
| --- | --- | --- | --- | --- | --- |
| day | 0.712-0.728 | 0.00 | 0.044-0.073 | PASS | 0 |
| night overlay #2c2640 α0.55 (actors + floor) | 0.192-0.196 | 0.00 | 0.033-0.056 | PASS | 0 |
| lit ground +12% (floor only) | 0.712-0.728 | 0.00 | 0.048-0.081 | PASS | 0 |

### art_review

- **Set call, 14 sheets, renderScale 128: `passed: true`, 0 findings.** Cross-sheet silhouette distance min 0.091
  (steppe-0 ↔ rime-0), all 91 pairs gated and ≥ 0.05. That call ran before the ember sheets' last regeneration, so
  the **final ember scene was re-run** (ember-0/1/2 + shared-0/1 from `public/`, renderScale 128): `passed: true`,
  0 findings, value spread ember-0 0.727 / ember-1 0.665 / ember-2 0.828, silhouette pairs 0.137-0.211. Warnings only
  across both calls: `value-plan-miss:*` (nacre 40-53% lights, rime-1 33%, shared-0 31%, ember 55-59% darks),
  `value-tier-absent:light` (steppe-1 3.3%) — scoped below.
- **Per-cell, within one biome scene** (`art/exports/world-props/sil_cells.py`, exact replica of art-report.ts
  `reviewSilhouettes` 12×12 occupancy + `value.spread`; replica reproduced a live art_review call exactly: 0.035 /
  0.142 / 0.153 and spread 0.275 vs 0.274), 45 cells = 990 pairs per biome at 64 px:

| biome | min pair | collisions < 0.05 | flat cells (< 0.35) |
| --- | --- | --- | --- |
| steppe | 0.015 shared-0#3 boulder ↔ steppe-2#5 coiled fossil | 5 | none |
| rime | 0.021 rime-1#3 split slab ↔ rime-1#8 stepped stone | 5 | none |
| ember (final) | 0.035 shared-1#0 standing stone ↔ ember-2#7 basalt column | 2 | ember-0#7 rope coil 0.322 |
| nacre | 0.031 shared-1#3 wheel ↔ nacre-0#7 urchin | 6 | none |

Ember before its last regens: 17 collisions and 6 flat cells. The remaining 18 pairs are two compact masses that
differ by material/hue/interior (boulder vs whorl fossil, wheel vs urchin, standing stone vs hex column), written as
qcExceptions below rather than rerolled.

### Readability vs buildings (reported)

Props carry no windows, glow or cream hull masses; at 80 px on the floor (`_qc/props-on-floor.png`) they read as
scattered decoration around the core, not as structures or fauna. Luma p90: steppe 0.55-0.69, ember 0.62-0.75,
rime 0.75-0.84, nacre 0.84-0.90 vs buildings 0.883 — nacre props sit at building brightness by biome identity (pearl),
the same as the accepted nacre-blockers (p90 0.852).

## CRITERIA

1. **Rescoped: "no red" → per-cell saturated-red share ≤ 3.6%.** Population: actor sprite cells. A literal 0% rejects
   canon: steppe-blockers 1.05% (cell 1.3%), vision anchor 0.51%, bld-arc-mk3 cell 3.6%, bld-borer-mk1 1.1%,
   bld-hab-mk1 1.1% (40 building sheets + 4 blocker sheets measured). 3.6% = canon max. Rejected on it: ember-0 vent
   21.8%, ember-1 3.7%, ember-2 4.0/4.1%; all final sheets 0.0-1.8%. Green: 0.00-0.01% everywhere (no rule needed).
   Note this game's hostile outline is oxblood `#3a1712` (PRD §18), not `#ff2d2d`.
2. **Kept: `value-spread-flat` per cell (< 0.35).** Validated on canon first: every accepted blocker cell measures
   0.43-0.92. Used to reject 6 ember cells; 1 remains (exception).
3. **Rescoped (terrain precedent): `silhouette-collision` per cell within one biome scene**, not per 3×3 atlas; the
   atlas-level set call cannot see a cell. Canon terrain blockers shipped within-biome pairs at 0.025-0.049 under
   written exceptions, so collisions here are exception-recorded, not reroll-mandatory. Cross-biome pairs are not gated
   (they never share a scene).
4. **Warnings, not rejects: `value-plan-miss:*` / `value-tier-absent:light`.** Material-driven (pearl nacre is light,
   slag is dark); canon nacre-blockers run 40-60% lights. Rule 10 scope.
5. **Not a reject: rime `meanDistance` 35.9-37.8, outliers 17-19%.** Frost blue; the list holds one cold blue. Fact
   about the list, same as rime-blockers (41.24).
6. **Folklore:** none invoked; one provider (xai-oauth) served every call, no provider comparison possible.
7. **Post-review pixel transforms reviewed through:** night overlay (#2c2640 α0.55 on actors + floor) and lit ground
   (+12%, floor) — repro `art/exports/world-props/fg_props.py` (graded copies in `_qc/graded/`). Not reproduced: fauna
   runtime outline `#3a1712` (darkens actor edges only; clash margin 0.00%) and building night dimming (values not in
   `src/` yet). Props get no runtime tint that I found in the plan.

## Text-over-art surfaces

None introduced: props are world decoration under the HUD; no text sits on them.

## manifest-delta

```json
{
  "group": "world-props",
  "profileNote": "exported hd-fx (centred fit, scale fit 0.86, componentMode all), terrain-blocker precedent; manifest kind says body - set kind fx or note hd-fx",
  "attempts": {
    "props-shared-0": 0, "props-shared-1": 0,
    "props-steppe-0": 0, "props-steppe-1": 0, "props-steppe-2": 0,
    "props-rime-0": 0, "props-rime-1": 0, "props-rime-2": 0,
    "props-ember-0": 3, "props-ember-1": 2, "props-ember-2": 2,
    "props-nacre-0": 0, "props-nacre-1": 0, "props-nacre-2": 0
  },
  "qcExceptions": [
    { "id": "props-ember-0", "reason": "3 regenerations for 3 different symptoms (drawn cell dividers, rust-red vent, flat round lumps); final cell 7 rope slag coil value spread 0.322 < 0.35 is charcoal slag by material, inked and readable on the mud floor" },
    { "id": "props-ember-*", "reason": "per-cell silhouette 0.035 shared-1#0 standing stone vs ember-2#7 basalt column and 0.045 ember-0#2 vent vs ember-0#8 mud cone at 64px: grey stone vs black hex basalt, hollow chimney vs cracked cone read apart at 80px" },
    { "id": "props-steppe-*", "reason": "per-cell silhouette 0.015-0.048 at 64px (shared boulder vs coiled fossil, standing stone vs spire plant, crate/boulder vs succulent, cairn vs pyramid rock): same compact mass, distinct by violet/ochre hue and interior at 80px" },
    { "id": "props-rime-*", "reason": "per-cell silhouette 0.021-0.049 at 64px (split slab vs stepped stone, icicle shrub vs rime bulb, ice block vs crate/boulder): distinct by blue ice vs dark slate material at 80px" },
    { "id": "props-nacre-*", "reason": "per-cell silhouette 0.031-0.049 at 64px (wheel vs urchin, standing stone vs nacre shard, conch/scallop vs urchin, spool vs sea-rock): pearl shells vs grey debris read apart by value and ribbing at 80px" }
  ]
}
```

## Files

- Landed: `public/assets/generated/world-props/props-{shared-0,shared-1,steppe-0..2,rime-0..2,ember-0..2,nacre-0..2}/`
  (`sprite-sheet.png`, `frames/`, `animation.gif`, `raw-source.jpg`, `sprite-metadata.json`, `sprite-metadata.marker.json`)
- Staging: `art/exports/world-props/<id>/`
- Repro/QC scripts: `art/exports/world-props/process_raw.py` (guard-off raw re-process), `props_qc.py` (red/green/pink/luma),
  `sil_cells.py` (per-cell silhouette + value spread replica), `fg_props.py` (figure-ground through transforms)
- QC images: `art/exports/world-props/_qc/all-sheets.png` (14 sheets), `_qc/ember-regen.png` (final ember),
  `_qc/props-on-floor.png` (steppe + nacre mock with core and skitter)
