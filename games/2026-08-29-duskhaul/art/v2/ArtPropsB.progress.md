# ArtPropsB — props-v3b: standalone blockers for desert and winter

Tool probe: `generate_image` OK (xai-oauth / grok-imagine-image, 1024x1024). All 4 accepted raws came from xai.
Groups file: `art/v2/ArtPropsB.groups.json` (owner `ArtPropsB`, group `props-v3b`, 8 assets, 2 `qcExceptions`).
Integrator steps: `python3 art/v2/merge-fragments.py ArtPropsB`, add `props-v3b` to the arena slice `ART_GROUPS`, then run `node scripts/gen-art-registry.mjs`.
Dry run on a temp copy of the manifest: the merge + registry wrote 8 `props-v3b` rows and 45 ICON entries (36 base + 9 `-top`), with no ICON collisions. `build.py` asserts that no new id collides with an existing `src/data/art.ts` ICON key.
`manifest-lint.py` on the merged copy adds no finding of its own. It reports the same 2 pre-existing warnings as the real manifest. The 2 anchor-path errors it printed come only from running it on a copy under /tmp.

## Delivered ids

| group | asset | file | cell |
|---|---|---|---|
| props-v3b | `props-desert-d`, `props-desert-e`, `props-winter-d`, `props-winter-e` | `public/assets/generated/props-v3b/<id>/sprite-sheet.png` | 3x3 @ 256; frame = cell index |
| props-v3b | `props-desert-d-tall-top`, `props-desert-e-tall-top`, `props-winter-d-tall-top`, `props-winter-e-tall-top` | same | 3x3 @ 256; frames 0..n-1 used, the rest transparent |

36 new blockers, 18 per zone, each one self-contained object. Mix per zone: 7 small, 7 medium, 4 large (39/39/22%).
Shape classes, desert: tall 3, wide 4, round 2, irregular 3, small 6. Winter: tall 4, wide 5, round 4, irregular 2, small 3.
None of them is a pile, and none duplicates an object already in props a/b/c (checked against the manifest icon lists).

## Wiring contract (for WorldGen → `src/data/props.ts`)

- The base sprite is `props-<zone>-<d|e>` frame = `cell`, and the ICON is the `id` column.
- A `CellRow` gets `cell` from the `cell [w,h]` column and `footprint` from the footprint column. `size` and `bodyRadius` in the table reproduce `toProp()` for that footprint, as a cross-check. Every radius is ≤ 90, far under the 170/190 cap.
- Tall props: set `top: slot('props-<zone>-<d|e>-tall-top', frame)` from the pair table. The top has the same position, size, origin and flip as its base, because it is a pixel-aligned crop of the same 256 cell (ArtWorld's method, `art/briefs/v3-props-b/build.py`).
- Blocking: every cell blocks. Nothing here imitates a hazard: no pits, ice sheets, fire, webs or vents. No cell emits light, so `light` stays false.

## Prop cells

| id | sheet | cell | alignedBox (l,t,wxh) | cell [w,h] | footprint px | size (toProp) | bodyRadius | shape | size class | blocking | tall-top pair |
|---|---|---|---|---|---|---|---|---|---|---|---|
| desert-sarcophagus | props-desert-d | 0 | 20,71,213x115 | [213, 115] | 190 | 228 | 51 | wide | L | yes | — |
| desert-ramtotem | props-desert-d | 1 | 66,39,121x178 | [121, 178] | 140 | 201 | 48 | tall | M | yes | props-desert-d-tall-top #0 |
| desert-boulder | props-desert-d | 2 | 28,71,201x113 | [201, 113] | 145 | 185 | 41 | round | M | yes | — |
| desert-amphora | props-desert-d | 3 | 59,61,139x134 | [139, 134] | 100 | 184 | 48 | small | S | yes | — |
| desert-fallencolumn | props-desert-d | 4 | 30,67,197x121 | [197, 121] | 160 | 208 | 49 | wide | M | yes | — |
| desert-deadcactus | props-desert-d | 5 | 61,34,134x189 | [134, 189] | 150 | 203 | 53 | tall | M | yes | props-desert-d-tall-top #1 |
| desert-hoodoo | props-desert-d | 6 | 41,40,172x176 | [172, 176] | 185 | 269 | 90 | irregular | L | yes | props-desert-d-tall-top #2 |
| desert-beastskull | props-desert-d | 7 | 43,73,172x110 | [172, 110] | 110 | 164 | 35 | small | S | yes | — |
| desert-milestone | props-desert-d | 8 | 46,67,163x122 | [163, 122] | 100 | 157 | 37 | small | S | yes | — |
| desert-trough | props-desert-e | 0 | 27,81,196x94 | [196, 94] | 155 | 202 | 37 | wide | M | yes | — |
| desert-sundial | props-desert-e | 1 | 59,71,138x115 | [138, 115] | 105 | 195 | 44 | small | S | yes | — |
| desert-handcart | props-desert-e | 2 | 29,63,180x125 | [180, 125] | 160 | 228 | 56 | wide | M | yes | — |
| desert-deadacacia | props-desert-e | 3 | 31,39,193x185 | [193, 185] | 200 | 265 | 90 | tall | L | yes | props-desert-e-tall-top #0 |
| desert-crate | props-desert-e | 4 | 50,79,155x99 | [155, 99] | 100 | 165 | 32 | small | S | yes | — |
| desert-tusk | props-desert-e | 5 | 24,57,210x140 | [210, 140] | 150 | 183 | 50 | irregular | M | yes | — |
| desert-ziggurat | props-desert-e | 6 | 24,58,202x140 | [202, 140] | 190 | 241 | 66 | irregular | L | yes | — |
| desert-barrel | props-desert-e | 7 | 54,71,147x113 | [147, 113] | 95 | 165 | 36 | round | S | yes | — |
| desert-petrifiedstump | props-desert-e | 8 | 43,82,171x92 | [171, 92] | 105 | 157 | 28 | small | S | yes | — |
| winter-frozenlog | props-winter-d | 0 | 28,65,200x126 | [200, 126] | 160 | 205 | 50 | wide | M | yes | — |
| winter-signpost | props-winter-d | 1 | 79,52,99x153 | [99, 153] | 110 | 184 | 36 | tall | S | yes | props-winter-d-tall-top #0 |
| winter-boulder | props-winter-d | 2 | 53,74,151x109 | [151, 109] | 140 | 237 | 50 | round | M | yes | — |
| winter-barrel | props-winter-d | 3 | 66,63,123x131 | [123, 131] | 95 | 186 | 45 | round | S | yes | — |
| winter-sarcophagus | props-winter-d | 4 | 18,58,220x140 | [220, 140] | 190 | 221 | 60 | wide | L | yes | — |
| winter-stump | props-winter-d | 5 | 48,76,160x105 | [160, 105] | 105 | 168 | 34 | small | S | yes | — |
| winter-outcrop | props-winter-d | 6 | 25,46,207x164 | [207, 164] | 190 | 235 | 75 | irregular | L | yes | — |
| winter-crate | props-winter-d | 7 | 47,73,163x111 | [163, 111] | 100 | 157 | 34 | small | S | yes | — |
| winter-sapling | props-winter-d | 8 | 68,33,120x191 | [120, 191] | 115 | 154 | 36 | tall | S | yes | props-winter-d-tall-top #1 |
| winter-woodpile | props-winter-e | 0 | 18,60,220x137 | [220, 137] | 155 | 180 | 48 | wide | M | yes | — |
| winter-obelisk | props-winter-e | 1 | 51,33,153x190 | [153, 190] | 190 | 256 | 76 | tall | L | yes | props-winter-e-tall-top #0 |
| winter-cauldron | props-winter-e | 2 | 64,61,127x136 | [127, 136] | 130 | 245 | 61 | round | M | yes | — |
| winter-mammothskull | props-winter-e | 3 | 38,57,180x143 | [180, 143] | 160 | 228 | 64 | irregular | M | yes | — |
| winter-anvil | props-winter-e | 4 | 54,65,147x126 | [147, 126] | 100 | 174 | 43 | small | S | yes | — |
| winter-fallencolumn | props-winter-e | 5 | 26,66,204x124 | [204, 124] | 155 | 195 | 47 | wide | M | yes | — |
| winter-weaponrack | props-winter-e | 6 | 23,37,206x184 | [206, 184] | 160 | 199 | 68 | wide | M | yes | props-winter-e-tall-top #1 |
| winter-gravecross | props-winter-e | 7 | 75,35,105x187 | [105, 187] | 110 | 151 | 31 | tall | S | yes | props-winter-e-tall-top #2 |
| winter-helm | props-winter-e | 8 | 24,61,208x134 | [208, 134] | 185 | 228 | 60 | round | L | yes | — |

The alignedBox includes the sand/snow contact patch, so small props read wider than the object itself. Footprint is set by size class (S 95-115, M 130-160, L 185-200), not by the box.

## Tall-top pairs

Tall rule, scoped to standing props on these 4 sheets: alignedBox h ≥ 1.3·w, or h ≥ 175 when the object is upright and its top half rises over the hero. Cut = alignedBox.top + height//2, the same as ArtWorld.

| tall-top sheet | frame | top icon | base sheet (group) | base frame | cutY | top alignedBox |
|---|---|---|---|---|---|---|
| props-desert-d-tall-top | 0 | desert-ramtotem-top | props-desert-d (props-v3b) | 1 | 128 | 71,39,104x89 |
| props-desert-d-tall-top | 1 | desert-deadcactus-top | props-desert-d (props-v3b) | 5 | 128 | 76,34,114x94 |
| props-desert-d-tall-top | 2 | desert-hoodoo-top | props-desert-d (props-v3b) | 6 | 128 | 93,40,91x88 |
| props-desert-e-tall-top | 0 | desert-deadacacia-top | props-desert-e (props-v3b) | 3 | 131 | 31,39,193x92 |
| props-winter-d-tall-top | 0 | winter-signpost-top | props-winter-d (props-v3b) | 1 | 128 | 79,52,99x76 |
| props-winter-d-tall-top | 1 | winter-sapling-top | props-winter-d (props-v3b) | 8 | 128 | 89,33,92x95 |
| props-winter-e-tall-top | 0 | winter-obelisk-top | props-winter-e (props-v3b) | 1 | 128 | 90,33,84x95 |
| props-winter-e-tall-top | 1 | winter-weaponrack-top | props-winter-e (props-v3b) | 6 | 129 | 48,37,168x92 |
| props-winter-e-tall-top | 2 | winter-gravecross-top | props-winter-e (props-v3b) | 7 | 128 | 81,35,94x93 |

## Per-asset QC

| asset | intent | strict export QC | palette (passed, meanDistance, outliers) | boundary pink before → after defringe | attempts (regens) | exception |
|---|---|---|---|---|---|---|
| props-desert-d | sarcophagus, ram totem, boulder, amphora, fallen column, dead cactus, hoodoo, beast skull, milestone | passed 9/9, 0 empty, 0 edge touch | True, 29.83, 0.166 | 47.75% → 0.09% | 1 (take 1: saturated green saguaro, a reserved gameplay hue) | `props-v3b/props-*` |
| props-desert-e | trough, sundial, handcart, dead acacia, crate, tusk, ziggurat, barrel, petrified stump | passed 9/9 | True, 33.46, 0.204 | 54.36% → 1.53% | 0 | `props-v3b/props-*` |
| props-winter-d | frozen log, signpost, boulder, barrel, sarcophagus, stump, outcrop, crate, sapling | passed 9/9 | True, 33.22, 0.163 | 11.89% → 0.12% | 0 | `props-v3b/props-*` |
| props-winter-e | woodpile, obelisk, cauldron, mammoth skull, anvil, fallen column, weapon rack, grave cross, helm | passed 9/9 | True, 31.03, 0.148 | 11.61% → 0.05% | 0 | `props-v3b/props-*` |
| props-desert-d-tall-top | 3 tops | derived crops, 3/3 non-empty | True, 24.44, 0.014 | — | 0 (not generated) | `props-v3b/props-*-tall-top` |
| props-desert-e-tall-top | 1 top | derived, 1/1 | True, 28.12, 0.080 | — | 0 | same |
| props-winter-d-tall-top | 2 tops | derived, 2/2 | True, 27.33, 0.048 | — | 0 | same |
| props-winter-e-tall-top | 3 tops | derived, 3/3 | True, 30.37, 0.098 | — | 0 | same |

Per-cell values (L* median of opaque px, including the contact patch) and the forbidden-hue share are in `art/briefs/v3-props-b/tables.md` § Cell values. The forbidden-hue share is 0.01-5.5% on every cell.
Floor separation is the share of object pixels above L* 36, the graded floor ceiling: desert 49-95%, winter 37-80%. The accepted canon a/b/c ranges 26-97%, so every new cell sits inside the canon's range.

Generation inputs: Image 1 = the zone's accepted `props-v2/props-<zone>-c` raw (zone materials, scale, camera); Image 2 = `art/refs/vision-1.png` (style anchor). The fixing clause opens every subject. Full prompts: `art/briefs/v3-props-b/prompts.md`.

Repro, run from `games/2026-08-29-duskhaul/`:
- export: `art/briefs/v3-props-b/process-sheet.sh art/briefs/v3-props-b/raws/<zone>-<d|e>-take<N>.jpg public/assets/generated/props-v3b/props-<zone>-<d|e>`. It is the props-v2 processor with `--threshold 200 --edge-threshold 260`, followed by `defringe.py`.
- tall-tops, groups fragment, tables: `uv run -q --with pillow --with numpy python art/briefs/v3-props-b/build.py`
- set gate: `art/briefs/v3-props-b/figure-ground.sh`

## Set gates

`figure-ground.py`, desert + winter in one invocation. Exit 0.
- Cast per scene: 29 actor sheets. Hero idle+run, every enemies-light/-heavy/-v2 `*-move`, the zone's own `*-move`, `props-<z>-a/b`, `props-v2/props-<z>-c`, and the new `props-v3b/props-<z>-d/e`.
- Fields: floor a/b/c + road through the live `FLOOR_GRADE` (desert d9d9d9, winter f5f5f5).
- Result: every field `recessive`, clash 0.00%, busyRatio 0.10-0.20, C1 PASS on all 8. Actor p90: desert 0.5037, winter 0.7227.

`art_review`, renderScale 48, profile `art/style.json`. Input: the 18 new cells plus the 27 canon cells (a/b/c) per zone, each as its own character.
- 0 per-asset fails. Warnings only: `value-plan-miss`, and `value-tier-absent` on the handcart (light) and the acacia (dark).
- Silhouette-collision fired at < 0.05 on 21 desert pairs and 13 winter pairs. **7 desert and 2 winter pairs are canon against canon**, and the lowest canon pair is 0.024 (desert) / 0.018 (winter). The lowest new pair is 0.025 (desert) / 0.017 (winter), the same floor. See CRITERIA 1.

## CRITERIA (retracted / rescoped, with the measurement)

1. **`art_review silhouette-collision` at renderScale 48 is REPORTED, never rejected on, for single-prop cells with a ground patch.**
   - Why: the accepted canon fails it internally 9 times (for example desert-a#0 vs a#1 at 0.024, winter-c lanternpost vs winter-b lantern at 0.018). At 48px, every compact prop sitting on its sand/snow patch collapses into the same low blob. The new cells sit on the same distance floor as the canon.
   - Visual read instead, done by eye on each exported sheet: the flagged new pairs are distinct masses. Boulder dome / flared stump / cube crate. Sundial on pedestal / barrel. Milestone trapezoid / stele with a rounded top. Sarcophagus / mudwall (lid overhang vs brick run).
2. **The brief's "L* 30-55 key forms" is rescoped to object bodies.** It does not apply to bleached bone, snow caps or contact patches.
   - Canon measured the same way (median of opaque px) reaches 62-87: winter-a 87.6, desert-b 74.6, desert-c ribfence 62.0. A 55 ceiling on whole cells would reject 18 of the 54 canon cells.
   - The new cells above 55 are all bleached bone or pale sandstone, which is the desert identity the brief names: tusk 77.5, beast skull 67.5, hoodoo 67.0, milestone 66.5, acacia 64.9, petrified stump 56.5, and the winter mammoth skull 57.8.
   - Wood, stone and iron bodies sit at 29-54. The two lowest are the sapling (28.2) and the black cauldron (29.3), and they still clear the floor on 40% / 37% of their pixels, inside the canon's 26% minimum.
3. **Boundary-pink share ("no red rims") applies to the new sheets only.**
   - The canon measures 51.9% (`props-v2/props-desert-c`) and 27.1% (`props-winter-c`) with the same metric (`defringe.py --measure-only`). It is not a rejection criterion for already-accepted sheets.
   - It was the user's explicit ask for these, so every new sheet is ≤ 1.5%. Re-keying the canon is out of this task's scope; flagged below.
4. **`sprite_check_palette meanDistance` is read as distance from the list only.** 29.8-33.5 on the base sheets, every one ≤ 48.

Post-review pixel transforms (reviewed THROUGH):
- `defringe.py` runs inside the export, BEFORE review. The shipped `sprite-sheet.png`, `frames/*` and `sprite-metadata.json` (with its alignedBox re-measured) are exactly the pixels every number above measured.
- Runtime `FLOOR_GRADE` multiply applies to floors, not props. It was passed to `figure-ground.py --grade`.
- Tall-top alpha 0.6 applies in code. The tops are the base's own pixels, so the value band does not change.

## Flags for WorldGen / integrator

- `winter-obelisk` carries a carved rune panel. Checked at 256: it reads as glyph carving, not legible lettering.
- `desert-tusk` is one tusk arching out of the sand, plus a small broken tip beside it in the same cell. Body radius 50 covers both.
- `winter-weaponrack` is an open trestle. Its collision circle (68) blocks the space between the legs, which is intended for a blocker.
- Canon props-v2 `-c` sheets still carry the pink key rim (CRITERIA 3). `defringe.py` would clean them the same way, if the owner wants it.
- No text sits over this art.
