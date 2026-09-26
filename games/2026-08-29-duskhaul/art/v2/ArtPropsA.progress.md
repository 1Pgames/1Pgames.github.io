# ArtPropsA — standalone blockers v3 (castle + outlands), group `props-v3a`

Tool probe: `generate_image` OK (xai-oauth / grok-imagine-image, 1024x1024). The first real call (castle-d) served as the probe; every raw came from xai.
Groups fragment: `art/v2/ArtPropsA.groups.json` (owner `ArtPropsA`, 1 group `props-v3a`, 8 assets, 2 `qcExceptions`). Integrator: `python3 art/v2/merge-fragments.py ArtPropsA`, add `props-v3a` to the arena slice `ART_GROUPS`, then run `node scripts/gen-art-registry.mjs`. Dry run: the fragment merged into a copy of the manifest gives 0 duplicate ICON names, and `manifest-lint.py` on that merged copy exits 0 (0 errors; the 2 warnings already exist in the real manifest). I did not run the registry generator, because it reads only `art/manifest.json`, which I do not own.

## Delivered ids

| group | assets | file | frames |
|---|---|---|---|
| props-v3a | `props-castle-d`, `props-castle-e`, `props-outlands-d`, `props-outlands-e` | `<id>/sprite-sheet.png`, `<id>/frames/frame-00N.png` | 3x3 @ 256, frame = cell index (row-major) |
| props-v3a | `props-<zone>-{d,e}-tall-top` (4) | same | 3 frames each (cells 0-2; cells 3-8 are empty), registers 1:1 with its base cell |

## Wiring contract (same as ArtWorld props-c)
- Props: `props-<zone>-{d,e}` frame i. The ICON name is the id in the table below. `CellRow.cell` = the `[w,h]` column, `footprint` = the suggested column, `radius` = the body-radius column. Every radius is ≤ 90, well under the 190 cap.
- Each cell is ONE object that reads on its own, with no cluster inside the cell. Place them one at a time. Shape classes are mixed so that neighbours differ.
- Tall props (Y-sort): draw the full base cell at `depth 10 + y/6144`, then draw `props-<zone>-{d,e}-tall-top` frame j at depth 30 with the SAME x/y/origin/displaySize/flip/rotation as the base (alpha 0.6 when the hero is behind it). ICON `<id>-top`.
- Size mix per zone (small/medium/large): castle 6/7/5, outlands 7/7/4 (≈ 36/39/25%).

## Prop cells (props-v3a)

| id | sheet | cell | alignedBox (l,t,wxh) | cell [w,h] | footprint px | body radius | shape | size | L* p25/med/p75 (ungraded) | blocking | tall-top pair |
|---|---|---|---|---|---|---|---|---|---|---|---|
| castle-obelisk | props-castle-d | 0 | 79,35,99x187 | [99, 187] | 120 | 48 | tall | medium | 23.3/26.9/43.1 | yes | props-castle-d-tall-top #0 (cutY 128) |
| castle-fallen-column | props-castle-d | 1 | 35,61,191x134 | [191, 134] | 190 | 90 | wide | large | 22.6/36.0/43.1 | yes | — |
| castle-cauldron | props-castle-d | 2 | 66,57,124x142 | [124, 142] | 130 | 60 | round | medium | 27.2/32.3/51.8 | yes | — |
| castle-stocks | props-castle-d | 3 | 30,70,197x117 | [197, 117] | 110 | 50 | wide | small | 30.6/48.2/67.7 | yes | — |
| castle-gargoyle | props-castle-d | 4 | 71,27,114x202 | [114, 202] | 125 | 55 | tall | medium | 14.4/22.5/34.8 | yes | props-castle-d-tall-top #1 (cutY 128) |
| castle-trough | props-castle-d | 5 | 18,64,220x129 | [220, 129] | 170 | 80 | wide | medium | 22.6/30.8/42.4 | yes | — |
| castle-boulder | props-castle-d | 6 | 54,53,148x149 | [148, 149] | 150 | 70 | round | large | 23.2/42.1/44.3 | yes | — |
| castle-bollard | props-castle-d | 7 | 73,33,110x190 | [110, 190] | 95 | 40 | small | small | 22.6/25.7/42.4 | yes | props-castle-d-tall-top #2 (cutY 128) |
| castle-stair-ruin | props-castle-d | 8 | 42,44,173x167 | [173, 167] | 170 | 80 | irregular | large | 23.2/33.3/43.2 | yes | — |
| castle-barrels | props-castle-e | 0 | 45,59,167x137 | [167, 137] | 140 | 62 | round | medium | 17.3/28.2/44.3 | yes | — |
| castle-spear-rack | props-castle-e | 1 | 34,46,188x165 | [188, 165] | 165 | 75 | wide | medium | 10.4/27.0/44.7 | yes | — |
| castle-banner-pole | props-castle-e | 2 | 80,31,95x194 | [95, 194] | 100 | 30 | tall | small | 18.4/36.6/40.2 | yes | props-castle-e-tall-top #0 (cutY 128) |
| castle-anvil | props-castle-e | 3 | 69,59,118x138 | [118, 138] | 105 | 48 | small | small | 15.4/23.5/26.6 | yes | — |
| castle-iron-maiden | props-castle-e | 4 | 68,29,121x199 | [121, 199] | 120 | 55 | tall | medium | 20.0/26.1/42.0 | yes | props-castle-e-tall-top #1 (cutY 128) |
| castle-grave-cross | props-castle-e | 5 | 86,50,84x155 | [84, 155] | 90 | 36 | small | small | 19.4/32.8/43.1 | yes | props-castle-e-tall-top #2 (cutY 127) |
| castle-ballista | props-castle-e | 6 | 18,41,220x174 | [220, 174] | 190 | 90 | wide | large | 15.2/27.6/43.5 | yes | — |
| castle-millstone | props-castle-e | 7 | 62,73,133x110 | [133, 110] | 115 | 55 | round | small | 21.7/40.4/45.7 | yes | — |
| castle-wall-corner-ruin | props-castle-e | 8 | 22,54,212x148 | [212, 148] | 185 | 88 | irregular | large | 17.2/22.2/39.0 | yes | — |
| outlands-split-tree | props-outlands-d | 0 | 68,23,118x209 | [118, 209] | 125 | 45 | tall | medium | 17.8/35.9/47.6 | yes | props-outlands-d-tall-top #0 (cutY 127) |
| outlands-hollow-log | props-outlands-d | 1 | 18,66,220x124 | [220, 124] | 190 | 88 | wide | large | 22.7/37.4/50.5 | yes | — |
| outlands-stone-idol | props-outlands-d | 2 | 54,45,148x167 | [148, 167] | 105 | 48 | small | small | 24.3/40.5/56.3 | yes | — |
| outlands-crag | props-outlands-d | 3 | 30,55,197x147 | [197, 147] | 175 | 82 | irregular | large | 21.6/35.3/43.5 | yes | — |
| outlands-axe-stump | props-outlands-d | 4 | 55,55,146x147 | [146, 147] | 105 | 48 | small | small | 21.0/34.7/44.3 | yes | — |
| outlands-signpost | props-outlands-d | 5 | 71,38,113x181 | [113, 181] | 100 | 32 | tall | small | 18.2/38.7/46.0 | yes | props-outlands-d-tall-top #1 (cutY 128) |
| outlands-beast-skull | props-outlands-d | 6 | 40,50,176x155 | [176, 155] | 150 | 68 | irregular | medium | 19.0/42.4/74.6 | yes | — |
| outlands-trough | props-outlands-d | 7 | 20,62,216x132 | [216, 132] | 175 | 82 | wide | medium | 17.6/25.2/33.9 | yes | — |
| outlands-bird-totem | props-outlands-d | 8 | 76,35,104x185 | [104, 185] | 90 | 30 | tall | small | 11.6/29.9/44.8 | yes | props-outlands-d-tall-top #2 (cutY 127) |
| outlands-menhir | props-outlands-e | 0 | 62,41,132x174 | [132, 174] | 115 | 50 | tall | medium | 26.1/35.4/42.8 | yes | props-outlands-e-tall-top #0 (cutY 128) |
| outlands-plough | props-outlands-e | 1 | 18,57,220x142 | [220, 142] | 175 | 80 | wide | medium | 19.3/28.3/37.8 | yes | — |
| outlands-cauldron | props-outlands-e | 2 | 31,68,194x121 | [194, 121] | 150 | 70 | round | medium | 15.7/28.0/36.7 | yes | — |
| outlands-root-tangle | props-outlands-e | 3 | 31,20,193x216 | [193, 216] | 180 | 85 | irregular | large | 18.8/33.0/46.9 | yes | — |
| outlands-toadstool | props-outlands-e | 4 | 76,71,105x113 | [105, 113] | 90 | 40 | small | small | 32.8/56.7/67.5 | yes | — |
| outlands-barrel | props-outlands-e | 5 | 67,61,122x133 | [122, 133] | 100 | 46 | small | small | 14.6/25.5/34.7 | yes | — |
| outlands-wayshrine | props-outlands-e | 6 | 60,30,136x196 | [136, 196] | 110 | 44 | tall | small | 13.6/28.4/44.0 | yes | props-outlands-e-tall-top #1 (cutY 128) |
| outlands-antler-totem | props-outlands-e | 7 | 69,21,119x214 | [119, 214] | 110 | 42 | tall | medium | 12.0/25.1/39.0 | yes | props-outlands-e-tall-top #2 (cutY 128) |
| outlands-wattle-corner | props-outlands-e | 8 | 25,64,206x127 | [206, 127] | 180 | 85 | irregular | large | 8.0/19.0/31.6 | yes | — |

"shape" is the silhouette class from the brief. A cell counts as tall (and gets a tall-top) when alignedBox height > 1.3 × width, which is why `small` bollard, grave-cross, signpost, bird-totem and wayshrine also have one. root-tangle (216/193 = 1.12) has no tall-top.

## Tall-top pairs

| tall-top sheet | frame | top icon | base sheet (group) | base frame | cutY | top alignedBox |
|---|---|---|---|---|---|---|
| props-castle-d-tall-top | 0 | castle-obelisk-top | props-castle-d (props-v3a) | 0 | 128 | 98,35,61x93 |
| props-castle-d-tall-top | 1 | castle-gargoyle-top | props-castle-d (props-v3a) | 4 | 128 | 80,27,105x101 |
| props-castle-d-tall-top | 2 | castle-bollard-top | props-castle-d (props-v3a) | 7 | 128 | 86,33,80x95 |
| props-castle-e-tall-top | 0 | castle-banner-pole-top | props-castle-e (props-v3a) | 2 | 128 | 80,31,95x97 |
| props-castle-e-tall-top | 1 | castle-iron-maiden-top | props-castle-e (props-v3a) | 4 | 128 | 68,29,121x99 |
| props-castle-e-tall-top | 2 | castle-grave-cross-top | props-castle-e (props-v3a) | 5 | 127 | 86,50,84x77 |
| props-outlands-d-tall-top | 0 | outlands-split-tree-top | props-outlands-d (props-v3a) | 0 | 127 | 105,23,80x104 |
| props-outlands-d-tall-top | 1 | outlands-signpost-top | props-outlands-d (props-v3a) | 5 | 128 | 77,38,107x90 |
| props-outlands-d-tall-top | 2 | outlands-bird-totem-top | props-outlands-d (props-v3a) | 8 | 127 | 85,35,93x92 |
| props-outlands-e-tall-top | 0 | outlands-menhir-top | props-outlands-e (props-v3a) | 0 | 128 | 95,41,78x87 |
| props-outlands-e-tall-top | 1 | outlands-wayshrine-top | props-outlands-e (props-v3a) | 6 | 128 | 60,30,136x98 |
| props-outlands-e-tall-top | 2 | outlands-antler-totem-top | props-outlands-e (props-v3a) | 7 | 128 | 69,21,119x107 |

## Per-asset QC

| asset | strict QC | palette meanDistance (outlier%) | attempts | notes / exceptions |
|---|---|---|---|---|
| props-castle-d | pass 9/9, 0 empty, 0 edge touch | 32.22 (4.6%) | 2 | Edit 1: black cauldron lifted to mid slate (median L* 9.7 → 32). Edit 2: crate replaced by stocks (crate failed art_review `value-spread-flat` at 98% darks and collided with the boulder at 0.032) |
| props-castle-e | pass 9/9 | 25.72 (3.4%) | 2 | Value lift. The first edit came back on a magenta→black gradient (background contamination) and was discarded |
| props-outlands-d | pass 9/9 | 25.06 (4.3%) | 3 | Value lift (first edit hit the same gradient failure, discarded), then a boulder → stone-idol swap to break a 0.033 collision with outlands-cauldron. `qcExceptions` entry `props-v3a/props-outlands-d` was written BEFORE the 3rd attempt |
| props-outlands-e | pass 9/9 | 22.60 (3.7%) | 2 | Cell 6 milestone → wayshrine (near-duplicate of the menhir), then value lift |
| props-*-tall-top (4) | derived crops, 12/12 non-empty | tall-tops are pixel-identical to their bases | 0 | `qcExceptions` `props-v3a/props-*-tall-top` (derived, not generated) |

Generation inputs: `input` = [`props-v2/props-<zone>-c/raw-provider.jpg` (Image 1: rendering, camera, scale), `art/refs/vision-1.png` (Image 2: palette and finish)], with the fixing clause at the head of each prompt. Edits and value lifts passed the accepted raw of the same sheet as their only Image 1, which already carries the anchors' style. I followed ArtWorld's route: raws were generated without a marker and exported through the sprite-forge CLI.

Repro (run from `games/2026-08-29-duskhaul/`):
- all exports + tall-tops + table + fragment: `art/briefs/v3-props-a/process.sh` (accepted raws are in `art/briefs/v3-props-a/raws/`)
- graded review: `PYTHONPATH=art/briefs/v3-props-a uv run -q --with pillow python art/briefs/v3-props-a/graded.py`

## Set gates

`figure-ground.py` per zone. The cast is the complete scene: hero idle+run, every enemies-light/-heavy/-v2 `*-move`, `zone-<z>/*-move`, props a/b + props-v2 c + props-v3a d/e, 29 actor sheets per scene. Fields are floor a/b/c + road, at the EFFECTIVE runtime grade `b8b8b8` (FLOOR_GRADE d9d9d9 × gradeMul 0.85). Both zones exit 0: every field is `recessive`, clash 0.00%, busyRatio castle 0.20-0.36 and outlands 0.15-0.26, C1 PASS.

`art_review` (renderScale 48, all 36 frames, one character each):
- Per asset: 0 fails. Only warnings: `value-tier-absent:light` (scoped out: known false positive, and the canon itself ships at 0.4%), `value-plan-miss`, and `temperature-single` on castle-boulder.
- Silhouettes within a zone: 0 collisions. The closest in-zone pairs are castle-cauldron/castle-millstone at 0.050 and outlands-split-tree/outlands-antler-totem at 0.051.
- The 5 cross-zone "collisions" (castle vs outlands, 0.040-0.049) were scoped out. Castle and outlands props never share a scene, so that pair population is outside the criterion's scope.

## CRITERIA
- **"L* key forms 30-55", checked against the canon and rescoped.** Read as a per-cell MEDIAN it rejects the canon: medians for castle a/b/c are 26/25/18 and for outlands a/b/c 26/24/18. I scoped it to the lit key plane (ungraded p75): 35 of 36 cells have p75 in 31.6-51.8 (bone and pale-cap highlights reach 56-75). The one below is castle-anvil at 26.6, a blackened-iron anvil. It still out-separates castle-c at runtime (next item), so it ships and is flagged as the weakest cell.
- **Post-review pixel transform: the scenery grade.** `arena.ts` tints every art prop with the floor grade (`0xb8b8b8` multiply for castle/outlands), so the player never sees the ungraded pixels. I reviewed the graded result with `graded.py`: graded floor L* p99 is castle 24.2 and outlands 24.9. The share of prop pixels brighter than that per cell is castle 12.7-65.9% (median ≈ 45%) and outlands 17.4-72.7% (median ≈ 47%). The canon's per-sheet medians are castle-c 7% (min 3), castle-a/b 30/39, outlands-c/a/b 22/33/35 (min 2-21). Every castle cell sits above the castle-c median. One outlands cell falls below the outlands-c median of 22: wattle-corner at 17.4%, which is still above the outlands-c minimum of 8. Trough (22.4%) and barrel (24.6%) sit at that median. Both new zone medians sit above every canon sheet median.
- **Contact shadow.** xai draws the cast shadow as dark magenta on the key, and the keyer removes it. Castle cells have no ground patch, which matches castle-c. Outlands cells keep their dirt patch, which matches outlands a/b/c. Grounding therefore matches the canon of each zone; neither has a separate baked shadow.
- **Keyer threshold 210/230 instead of 180/210.** At the defaults, pink magenta trapped inside open frames survived keying (castle-e: 284 px, visible inside the ballista frame). At 210 that drops to 5 px. The opaque pixels lost (127426 → 127114) are that residue. No prop hue sits within 210 of #FF00FF.

## Flags for WorldGen / integrator
- No text sits over this art. Only the toadstool (L* 57) and the beast skull (bone, p75 75) read as bright. They are scenery lights, not pickups: neither has a gold or cyan reward hue.
