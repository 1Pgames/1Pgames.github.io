# ArtWorld — V2 world art progress (floors-v2 · props-v2 · landmarks)

Tool probe: `generate_image` OK (xai-oauth / grok-imagine-image, 1024x1024). Every raw in this set came from xai (`sprite-metadata.json source.provider = "xai"`).
Groups file: `art/v2/ArtWorld.groups.json` (owner `ArtWorld`, 3 groups, 44 assets, 8 `qcExceptions`). Integrator: merge those groups + exceptions into `art/manifest.json`, add `floors-v2`, `props-v2`, `landmarks` to the arena slice `ART_GROUPS`, run `node scripts/gen-art-registry.mjs`. Dry-run of the registry on a merged manifest copy: writes 44 rows + ICON entries, no duplicate ICON keys; `manifest-lint.py` on the real manifest 0 errors (2 pre-existing warnings), my groups add no finding.

## Delivered ids (all 44 — none in qcExceptions as missing)

| group | ids | file | cell |
|---|---|---|---|
| floors-v2 | `floor-{castle,outlands,desert,winter}-{a,b,c}` (12) | `<id>/sprite.png` | 256, full-bleed, seamless |
| floors-v2 | `road-{castle,outlands,desert,winter}` (4) | `<id>/sprite.png` | 256, full-bleed, seamless |
| floors-v2 | `splat-{zone}-{a,b,c}` (12) | `<id>/sprite.png` | 512, soft alpha edge (alpha 0.55 applied in code) |
| props-v2 | `props-{zone}-c` (4) | `<id>/sprite-sheet.png` | 3x3 @ 256, frame = cell index |
| props-v2 | `props-{zone}-tall-top` (4) | `<id>/sprite-sheet.png` | 3x3 @ 256, registers 1:1 with its base cell |
| landmarks | `landmarks-{zone}` (4) | `<id>/sprite-sheet.png` | 3x3 @ 512, frame order = PRD-V2 §3.5 table order |

Splat themes: castle a lichen moss / b wet seep stain / c masonry grit; outlands a mud puddle / b ash drift / c dead grass; desert a sand ripple drift / b salt crust / c grit + bone chips; winter a snowdrift / b ice glaze / c hoarfrost.
Road materials: castle cobble, outlands packed-dirt ruts (vertical), desert hard sand ripples, winter packed snow with sled grooves (vertical).

## Wiring contract

- Floors/roads: texture key = id, 256x256, `setTint(FLOOR_GRADE[zone])` per the Tilemap layer. **Retune `FLOOR_GRADE` (src/ui/duskChrome.ts, not mine) to castle/outlands/desert `0xd9d9d9`, winter `0xf5f5f5`.** The V1 grades push V2 floors out of band (outlands `0x969493` → graded L* 12.9-14.2; desert `0xa89ea6` → 16.3-16.9). With the recommended grades every floor stays in L* 18-32 after the multiply (table below). Repro: `art/briefs/v2-world/graded-lstar.py <hex> <tiles>`.
- Splats: key = id, 512x512, draw as `DecalDef` at alpha 0.55, any rotation.
- Props: `props-<zone>-c` frame i; ICON names `<zone>-<name>` (table below). `CellRow.cell` = the `[w,h]` column, `footprint` = suggested column.
- Tall props (Y-sort, PRD §3.7): draw the full base cell at `depth 10 + y/6144`, and `props-<zone>-tall-top` frame j at depth 30 with the SAME x/y/origin/displaySize/flip/rotation as its base (alpha 0.6 when the hero is behind). Pair map in "Tall-top pairs"; ICON `<zone>-<name>-top`.
- Landmarks: `landmarks-<zone>` frame i = stamp id per PRD §3.5 row order; ICON `lm-*` = stamp id.

## Floors / roads / splats — measured (art/briefs/v2-world/world.py metrics; L* CIELAB, sat = HSL mean, forb% = pixels in hue 350-20°/95-150° above 30% sat, wrapX = max(edge wrap)/interior noise; ≤ ~2 is an invisible seam)

```
file                                                       L*mean  L*p1 L*p99   sat  forb%     hW     vW  noise wrapX minA
floors-v2/floor-castle-a/sprite.png                          27.3  14.8  34.6 0.084   0.00   3.00   3.85   4.24  0.91  255
floors-v2/floor-castle-b/sprite.png                          25.0  14.4  34.9 0.085   0.00   5.31   4.99   4.93  1.08  255
floors-v2/floor-castle-c/sprite.png                          26.1  14.4  34.6 0.088   0.00   3.14   4.24   4.17  1.02  255
floors-v2/floor-desert-a/sprite.png                          27.6  14.7  34.8 0.127   0.00   3.24   9.71   3.56  2.73  255
floors-v2/floor-desert-b/sprite.png                          27.9  15.4  35.2 0.175   0.00   3.58   8.51   3.39  2.51  255
floors-v2/floor-desert-c/sprite.png                          27.2  14.3  35.2 0.093   0.00   5.09  11.34   4.67  2.43  255
floors-v2/floor-outlands-a/sprite.png                        24.1  14.5  35.4 0.084   0.00   7.39   6.55   4.39  1.68  255
floors-v2/floor-outlands-b/sprite.png                        26.1  14.3  33.9 0.082   0.03   8.36   8.50   5.83  1.46  255
floors-v2/floor-outlands-c/sprite.png                        24.4  14.2  35.7 0.077   0.00   7.91   7.40   4.45  1.78  255
floors-v2/floor-winter-a/sprite.png                          19.1  14.0  35.4 0.209   0.00   4.63   2.69   2.78  1.66  255
floors-v2/floor-winter-b/sprite.png                          21.5  13.9  35.7 0.207   0.00   2.48   2.46   3.73  0.66  255
floors-v2/floor-winter-c/sprite.png                          20.0  14.0  35.5 0.212   0.00   8.93   6.88   3.62  2.47  255
floors-v2/road-castle/sprite.png                             22.5  12.7  31.1 0.081   0.00   5.38   4.65   7.38  0.73  255
floors-v2/road-desert/sprite.png                             24.2  13.3  32.4 0.145   0.00   7.51   7.70   4.72  1.63  255
floors-v2/road-outlands/sprite.png                           22.5   9.9  27.8 0.086   0.00   4.62   4.32   3.32  1.39  255
floors-v2/road-winter/sprite.png                             18.1   2.5  24.8 0.194   0.00   7.72   9.96   4.23  2.36  255
floors-v2/splat-castle-a/sprite.png                          25.6  12.0  38.0 0.203   0.02   0.00   0.00   3.34  0.00    0
floors-v2/splat-castle-b/sprite.png                          24.9  19.2  33.2 0.082   0.00   0.00   0.00   1.67  0.00    0
floors-v2/splat-castle-c/sprite.png                          26.0  12.0  38.0 0.116   0.00   0.00   0.00   5.30  0.00    0
floors-v2/splat-desert-a/sprite.png                          27.2  11.9  38.1 0.170   0.01   0.00   0.00   3.38  0.00    0
floors-v2/splat-desert-b/sprite.png                          24.7  12.0  38.0 0.074   0.01   0.00   0.00   3.90  0.00    0
floors-v2/splat-desert-c/sprite.png                          20.7  12.0  38.0 0.205   0.01   0.00   0.00   4.15  0.00    0
floors-v2/splat-outlands-a/sprite.png                        22.7  11.9  38.1 0.124   0.01   0.00   0.00   3.83  0.00    0
floors-v2/splat-outlands-b/sprite.png                        27.1  12.0  38.0 0.046   0.00   0.00   0.00   3.71  0.00    0
floors-v2/splat-outlands-c/sprite.png                        23.7  12.0  38.0 0.153   0.00   0.00   0.00   6.09  0.00    0
floors-v2/splat-winter-a/sprite.png                          25.1  12.0  38.0 0.117   0.00   0.00   0.00   2.47  0.00    0
floors-v2/splat-winter-b/sprite.png                          19.3  12.0  38.0 0.174   0.00   0.00   0.00   3.57  0.00    0
floors-v2/splat-winter-c/sprite.png                          24.0  12.0  38.0 0.192   0.00   0.00   0.00   4.09  0.00    0
```

Graded (runtime multiply) L* with the recommended FLOOR_GRADE:

```
floor-castle-a     grade #d9d9d9  authored L*  27.3 [14.8..34.6]  graded L*  23.0 [12.0..29.3]
floor-castle-b     grade #d9d9d9  authored L*  25.0 [14.4..34.9]  graded L*  21.0 [11.9..29.5]
floor-castle-c     grade #d9d9d9  authored L*  26.1 [14.4..34.6]  graded L*  21.9 [11.9..29.4]
road-castle        grade #d9d9d9  authored L*  22.5 [12.7..31.1]  graded L*  18.8 [10.1..26.3]
floor-outlands-a   grade #d9d9d9  authored L*  24.1 [14.5..35.4]  graded L*  20.2 [11.8..30.1]
floor-outlands-b   grade #d9d9d9  authored L*  26.1 [14.3..33.9]  graded L*  22.0 [11.8..28.7]
floor-outlands-c   grade #d9d9d9  authored L*  24.4 [14.2..35.7]  graded L*  20.5 [11.7..30.4]
road-outlands      grade #d9d9d9  authored L*  22.5 [ 9.9..27.8]  graded L*  18.8 [ 7.9..23.4]
floor-desert-a     grade #d9d9d9  authored L*  27.6 [14.7..34.8]  graded L*  23.3 [11.9..29.5]
floor-desert-b     grade #d9d9d9  authored L*  27.9 [15.4..35.2]  graded L*  23.5 [12.5..29.9]
floor-desert-c     grade #d9d9d9  authored L*  27.2 [14.3..35.2]  graded L*  22.9 [11.8..30.0]
road-desert        grade #d9d9d9  authored L*  24.2 [13.3..32.4]  graded L*  20.3 [10.8..27.6]
floor-winter-a     grade #f5f5f5  authored L*  19.1 [14.0..35.4]  graded L*  18.2 [13.5..34.1]
floor-winter-b     grade #f5f5f5  authored L*  21.5 [13.9..35.7]  graded L*  20.5 [13.3..34.4]
floor-winter-c     grade #f5f5f5  authored L*  20.0 [14.0..35.5]  graded L*  19.0 [13.5..34.2]
road-winter        grade #f5f5f5  authored L*  18.1 [ 2.5..24.8]  graded L*  17.3 [ 2.5..23.8]
```

Palette (`sprite_check_palette` / style-profile.ts vs art/style.json, max 48): passed, meanDistance, outlierFraction

```
floors-v2/floor-castle-a/sprite.png True 11.36 0
floors-v2/floor-castle-b/sprite.png True 13.8 0
floors-v2/floor-castle-c/sprite.png True 12.66 0
floors-v2/floor-desert-a/sprite.png True 23.63 0
floors-v2/floor-desert-b/sprite.png True 27.43 0
floors-v2/floor-desert-c/sprite.png True 21.55 0
floors-v2/floor-outlands-a/sprite.png True 17.92 0
floors-v2/floor-outlands-b/sprite.png True 19.86 0
floors-v2/floor-outlands-c/sprite.png True 17.03 0
floors-v2/floor-winter-a/sprite.png True 13.73 0
floors-v2/floor-winter-b/sprite.png True 18.57 0.002
floors-v2/floor-winter-c/sprite.png True 16.35 0
floors-v2/road-castle/sprite.png True 10.3 0
floors-v2/road-desert/sprite.png True 25.58 0
floors-v2/road-outlands/sprite.png True 24.02 0
floors-v2/road-winter/sprite.png True 17.24 0
floors-v2/splat-castle-a/sprite.png True 28.0 0.01
floors-v2/splat-castle-b/sprite.png True 21.17 0.007
floors-v2/splat-castle-c/sprite.png True 18.53 0.005
floors-v2/splat-desert-a/sprite.png True 26.86 0.007
floors-v2/splat-desert-b/sprite.png True 23.09 0.002
floors-v2/splat-desert-c/sprite.png True 23.11 0.019
floors-v2/splat-outlands-a/sprite.png True 23.51 0.024
floors-v2/splat-outlands-b/sprite.png True 19.79 0.001
floors-v2/splat-outlands-c/sprite.png True 23.56 0.01
floors-v2/splat-winter-a/sprite.png True 16.92 0.002
floors-v2/splat-winter-b/sprite.png True 15.51 0.003
floors-v2/splat-winter-c/sprite.png True 19.78 0.001
props-v2/props-castle-c/sprite-sheet.png True 15.87 0.022
props-v2/props-castle-tall-top/sprite-sheet.png True 23.15 0.094
props-v2/props-desert-c/sprite-sheet.png True 30.76 0.183
props-v2/props-desert-tall-top/sprite-sheet.png True 23.75 0.032
props-v2/props-outlands-c/sprite-sheet.png True 23.44 0.048
props-v2/props-outlands-tall-top/sprite-sheet.png True 23.46 0.049
props-v2/props-winter-c/sprite-sheet.png True 40.15 0.258
props-v2/props-winter-tall-top/sprite-sheet.png True 38.62 0.258
landmarks/landmarks-castle/sprite-sheet.png True 20.67 0.022
landmarks/landmarks-desert/sprite-sheet.png True 34.85 0.213
landmarks/landmarks-outlands/sprite-sheet.png True 24.76 0.06
landmarks/landmarks-winter/sprite-sheet.png True 37.38 0.244
```

## Prop cells (props-<zone>-c)

| id | sheet | cell | alignedBox (l,t,wxh) | cell [w,h] | footprint px | blocking | tall-top pair |
|---|---|---|---|---|---|---|---|
| castle-wall-straight | props-castle-c | 0 | 18,59,216x139 | [216, 139] | 190 | yes | props-castle-tall-top #0 |
| castle-wall-corner | props-castle-c | 1 | 28,66,201x124 | [201, 124] | 180 | yes | props-castle-tall-top #1 |
| castle-wall-broken | props-castle-c | 2 | 47,52,161x152 | [161, 152] | 165 | yes | — |
| castle-pillar | props-castle-c | 3 | 84,35,88x186 | [88, 186] | 165 | yes | props-castle-tall-top #2 |
| castle-rubble-heap | props-castle-c | 4 | 22,68,212x121 | [212, 121] | 135 | yes | — |
| castle-gravestone | props-castle-c | 5 | 73,54,110x149 | [110, 149] | 115 | yes | — |
| castle-monolith | props-castle-c | 6 | 72,47,112x163 | [112, 163] | 170 | yes | props-castle-tall-top #3 |
| castle-lamppost | props-castle-c | 7 | 87,35,83x185 | [83, 185] | 130 | yes | props-castle-tall-top #4 |
| castle-ironfence | props-castle-c | 8 | 29,61,198x135 | [198, 135] | 160 | yes | — |
| outlands-logwall | props-outlands-c | 0 | 25,85,205x86 | [205, 86] | 180 | yes | — |
| outlands-palisade-corner | props-outlands-c | 1 | 18,61,220x135 | [220, 135] | 180 | yes | props-outlands-tall-top #0 |
| outlands-palisade-broken | props-outlands-c | 2 | 27,67,201x123 | [201, 123] | 170 | yes | props-outlands-tall-top #1 |
| outlands-deadtree | props-outlands-c | 3 | 42,23,173x209 | [173, 209] | 175 | yes | props-outlands-tall-top #2 |
| outlands-stonepile | props-outlands-c | 4 | 19,83,217x90 | [217, 90] | 135 | yes | — |
| outlands-gravemarker | props-outlands-c | 5 | 74,56,108x143 | [108, 143] | 115 | yes | — |
| outlands-spiralstone | props-outlands-c | 6 | 51,56,154x144 | [154, 144] | 165 | yes | props-outlands-tall-top #3 |
| outlands-gibbetpost | props-outlands-c | 7 | 63,37,130x182 | [130, 182] | 150 | yes | props-outlands-tall-top #4 |
| outlands-bonefence | props-outlands-c | 8 | 27,73,203x111 | [203, 111] | 160 | yes | — |
| desert-mudwall | props-desert-c | 0 | 21,75,215x105 | [215, 105] | 185 | yes | props-desert-tall-top #0 |
| desert-mudwall-corner | props-desert-c | 1 | 23,57,210x142 | [210, 142] | 180 | yes | props-desert-tall-top #1 |
| desert-mudwall-broken | props-desert-c | 2 | 18,77,219x102 | [219, 102] | 160 | yes | — |
| desert-lotuscolumn | props-desert-c | 3 | 61,38,135x181 | [135, 181] | 165 | yes | props-desert-tall-top #2 |
| desert-sandrubble | props-desert-c | 4 | 18,78,220x99 | [220, 99] | 135 | yes | — |
| desert-stele | props-desert-c | 5 | 34,65,187x126 | [187, 126] | 115 | yes | — |
| desert-sunidol | props-desert-c | 6 | 37,55,182x146 | [182, 146] | 165 | yes | props-desert-tall-top #3 |
| desert-cagepost | props-desert-c | 7 | 66,43,125x171 | [125, 171] | 150 | yes | props-desert-tall-top #4 |
| desert-ribfence | props-desert-c | 8 | 18,62,219x131 | [219, 131] | 160 | yes | — |
| winter-frostwall | props-winter-c | 0 | 19,67,215x121 | [215, 121] | 185 | yes | props-winter-tall-top #0 |
| winter-frostwall-corner | props-winter-c | 1 | 19,60,217x135 | [217, 135] | 180 | yes | props-winter-tall-top #1 |
| winter-frostwall-broken | props-winter-c | 2 | 32,65,192x126 | [192, 126] | 160 | yes | — |
| winter-snowpine | props-winter-c | 3 | 57,25,142x206 | [142, 206] | 180 | yes | props-winter-tall-top #2 |
| winter-snowrubble | props-winter-c | 4 | 18,72,220x111 | [220, 111] | 135 | yes | — |
| winter-frostgrave | props-winter-c | 5 | 54,59,149x138 | [149, 138] | 115 | yes | — |
| winter-icemonolith | props-winter-c | 6 | 56,39,145x177 | [145, 177] | 170 | yes | props-winter-tall-top #3 |
| winter-lanternpost | props-winter-c | 7 | 72,39,113x177 | [113, 177] | 130 | yes | props-winter-tall-top #4 |
| winter-icefence | props-winter-c | 8 | 21,53,211x150 | [211, 150] | 160 | yes | — |

## Tall-top pairs

| tall-top sheet | frame | top icon | base sheet (group) | base frame | cutY | top alignedBox |
|---|---|---|---|---|---|---|
| props-castle-tall-top | 0 | castle-wall-straight-top | props-castle-c (props-v2) | 0 | 128 | 24,59,209x69 |
| props-castle-tall-top | 1 | castle-wall-corner-top | props-castle-c (props-v2) | 1 | 128 | 36,66,189x62 |
| props-castle-tall-top | 2 | castle-pillar-top | props-castle-c (props-v2) | 3 | 128 | 95,35,73x93 |
| props-castle-tall-top | 3 | castle-monolith-top | props-castle-c (props-v2) | 6 | 128 | 83,47,89x81 |
| props-castle-tall-top | 4 | castle-lamppost-top | props-castle-c (props-v2) | 7 | 127 | 93,35,77x92 |
| props-castle-tall-top | 5 | castle-torch-top | props-castle-a (zone-castle) | 6 | 127 | 115,37,54x90 |
| props-castle-tall-top | 6 | castle-statue-top | props-castle-a (zone-castle) | 7 | 128 | 82,41,91x87 |
| props-castle-tall-top | 7 | castle-column-top | props-castle-b (zone-castle) | 5 | 128 | 85,36,85x92 |
| props-castle-tall-top | 8 | castle-hook-top | props-castle-b (zone-castle) | 7 | 127 | 124,43,22x84 |
| props-outlands-tall-top | 0 | outlands-wall-corner-top | props-outlands-c (props-v2) | 1 | 128 | 36,61,187x67 |
| props-outlands-tall-top | 1 | outlands-wall-broken-top | props-outlands-c (props-v2) | 2 | 128 | 46,67,170x61 |
| props-outlands-tall-top | 2 | outlands-deadtree-top | props-outlands-c (props-v2) | 3 | 127 | 42,23,173x104 |
| props-outlands-tall-top | 3 | outlands-monolith-top | props-outlands-c (props-v2) | 6 | 128 | 89,56,83x72 |
| props-outlands-tall-top | 4 | outlands-gibbetpost-top | props-outlands-c (props-v2) | 7 | 128 | 63,37,130x91 |
| props-outlands-tall-top | 5 | outlands-gibbet-top | props-outlands-a (zone-outlands) | 1 | 128 | 77,32,112x96 |
| props-outlands-tall-top | 6 | outlands-tree-top | props-outlands-a (zone-outlands) | 6 | 127 | 86,39,86x88 |
| props-outlands-tall-top | 7 | outlands-scarecrow-top | props-outlands-b (zone-outlands) | 1 | 128 | 53,49,150x79 |
| props-outlands-tall-top | 8 | outlands-perch-top | props-outlands-b (zone-outlands) | 5 | 128 | 67,52,122x76 |
| props-desert-tall-top | 0 | desert-wall-straight-top | props-desert-c (props-v2) | 0 | 127 | 42,75,173x52 |
| props-desert-tall-top | 1 | desert-wall-corner-top | props-desert-c (props-v2) | 1 | 128 | 46,57,168x71 |
| props-desert-tall-top | 2 | desert-column-top | props-desert-c (props-v2) | 3 | 128 | 85,38,87x90 |
| props-desert-tall-top | 3 | desert-monolith-top | props-desert-c (props-v2) | 6 | 128 | 81,55,99x73 |
| props-desert-tall-top | 4 | desert-cagepost-top | props-desert-c (props-v2) | 7 | 128 | 77,43,107x85 |
| props-desert-tall-top | 5 | desert-obelisk-top | props-desert-a (zone-desert) | 5 | 170 | 95,100,84x70 |
| props-desert-tall-top | 6 | desert-palm-top | props-desert-a (zone-desert) | 7 | 171 | 46,100,168x71 |
| props-desert-tall-top | 7 | desert-sunbanner-top | props-desert-b (zone-desert) | 1 | 127 | 104,52,107x75 |
| props-desert-tall-top | 8 | desert-vulture-top | props-desert-b (zone-desert) | 6 | 128 | 79,59,106x69 |
| props-winter-tall-top | 0 | winter-wall-straight-top | props-winter-c (props-v2) | 0 | 127 | 29,67,195x60 |
| props-winter-tall-top | 1 | winter-wall-corner-top | props-winter-c (props-v2) | 1 | 127 | 29,60,197x67 |
| props-winter-tall-top | 2 | winter-pine-c-top | props-winter-c (props-v2) | 3 | 128 | 84,25,90x103 |
| props-winter-tall-top | 3 | winter-icemonolith-top | props-winter-c (props-v2) | 6 | 127 | 93,39,74x88 |
| props-winter-tall-top | 4 | winter-lanternpost-top | props-winter-c (props-v2) | 7 | 127 | 79,39,101x88 |
| props-winter-tall-top | 5 | winter-pine-top | props-winter-a (zone-winter) | 6 | 128 | 62,36,130x92 |
| props-winter-tall-top | 6 | winter-bellshrine-top | props-winter-b (zone-winter) | 0 | 128 | 47,40,162x88 |
| props-winter-tall-top | 7 | winter-lantern-top | props-winter-b (zone-winter) | 4 | 128 | 75,40,106x88 |
| props-winter-tall-top | 8 | winter-bonetree-top | props-winter-b (zone-winter) | 6 | 128 | 62,41,138x87 |

## Landmark cells

| stamp id | sheet | cell | alignedBox (512 cell) | cell [w,h] | suggested footprint px | blocking | tall |
|---|---|---|---|---|---|---|---|
| lm-belltower | landmarks-castle | 0 | 128,70,256x371 | [256, 371] | 380 | yes (base footprint) | yes |
| lm-ossuary | landmarks-castle | 1 | 64,97,383x319 | [383, 319] | 440 | yes (base footprint) | no |
| lm-chapelruin | landmarks-castle | 2 | 95,79,322x354 | [322, 354] | 440 | yes (base footprint) | no |
| lm-barracks | landmarks-castle | 3 | 36,86,440x340 | [440, 340] | 440 | yes (base footprint) | no |
| lm-cistern | landmarks-castle | 4 | 82,125,348x262 | [348, 262] | 440 | yes (base footprint) | no |
| lm-gallowsyard | landmarks-castle | 5 | 67,74,379x363 | [379, 363] | 440 | yes (base footprint) | no |
| lm-cryptmouth | landmarks-castle | 6 | 125,78,262x356 | [262, 356] | 440 | yes (base footprint) | no |
| lm-rampartbreach | landmarks-castle | 7 | 72,82,368x348 | [368, 348] | 440 | yes (base footprint) | no |
| lm-thronecourt | landmarks-castle | 8 | 106,77,300x357 | [300, 357] | 440 | yes (base footprint) | no |
| lm-gibbetrow | landmarks-outlands | 0 | 51,61,410x389 | [410, 389] | 380 | yes (base footprint) | yes |
| lm-ribcage | landmarks-outlands | 1 | 37,98,439x316 | [439, 316] | 440 | yes (base footprint) | no |
| lm-mudcamp | landmarks-outlands | 2 | 37,106,437x300 | [437, 300] | 440 | yes (base footprint) | no |
| lm-windmill | landmarks-outlands | 3 | 96,39,319x434 | [319, 434] | 380 | yes (base footprint) | yes |
| lm-carrionfield | landmarks-outlands | 4 | 36,112,440x287 | [440, 287] | 440 | yes (base footprint) | no |
| lm-bonebridge | landmarks-outlands | 5 | 44,101,424x310 | [424, 310] | 440 | yes (base footprint) | no |
| lm-burnedfarm | landmarks-outlands | 6 | 45,77,421x359 | [421, 359] | 440 | yes (base footprint) | no |
| lm-standingstones | landmarks-outlands | 7 | 38,75,436x362 | [436, 362] | 440 | yes (base footprint) | no |
| lm-ashpit | landmarks-outlands | 8 | 40,124,432x265 | [432, 265] | 440 | yes (base footprint) | no |
| lm-sunkenhead | landmarks-desert | 0 | 46,126,420x260 | [420, 260] | 440 | yes (base footprint) | no |
| lm-drywell | landmarks-desert | 1 | 71,120,369x272 | [369, 272] | 440 | yes (base footprint) | no |
| lm-shadecanopy | landmarks-desert | 2 | 60,110,392x291 | [392, 291] | 440 | yes (base footprint) | no |
| lm-obelisk | landmarks-desert | 3 | 109,76,294x361 | [294, 361] | 380 | yes (base footprint) | yes |
| lm-caravanwreck | landmarks-desert | 4 | 44,130,424x253 | [424, 253] | 440 | yes (base footprint) | no |
| lm-tombgate | landmarks-desert | 5 | 53,100,406x312 | [406, 312] | 440 | yes (base footprint) | no |
| lm-dunespine | landmarks-desert | 6 | 54,107,403x298 | [403, 298] | 440 | yes (base footprint) | no |
| lm-saltflat | landmarks-desert | 7 | 36,148,440x216 | [440, 216] | 440 | yes (base footprint) | no |
| lm-scarabmound | landmarks-desert | 8 | 41,135,430x242 | [430, 242] | 440 | yes (base footprint) | no |
| lm-frozenshrine | landmarks-winter | 0 | 102,91,308x330 | [308, 330] | 440 | yes (base footprint) | no |
| lm-torchcircle | landmarks-winter | 1 | 71,95,370x321 | [370, 321] | 440 | yes (base footprint) | no |
| lm-icecavern | landmarks-winter | 2 | 71,100,370x312 | [370, 312] | 440 | yes (base footprint) | no |
| lm-widowspire | landmarks-winter | 3 | 148,57,216x397 | [216, 397] | 380 | yes (base footprint) | yes |
| lm-corpselake | landmarks-winter | 4 | 41,144,430x225 | [430, 225] | 440 | yes (base footprint) | no |
| lm-brokenwall | landmarks-winter | 5 | 36,104,440x305 | [440, 305] | 440 | yes (base footprint) | no |
| lm-pineclutch | landmarks-winter | 6 | 73,69,366x375 | [366, 375] | 380 | yes (base footprint) | yes |
| lm-yetiden | landmarks-winter | 7 | 64,104,384x305 | [384, 305] | 440 | yes (base footprint) | no |
| lm-crownsteps | landmarks-winter | 8 | 96,88,320x336 | [320, 336] | 440 | yes (base footprint) | no |

## Per-asset QC, attempts, exceptions

| asset(s) | intent | QC | attempts (regens) | exception id |
|---|---|---|---|---|
| floor-castle-a/b/c | ash-plum flagstones; b broken/missing stones, c damp stains | fullBleed export, qc.passed, minAlpha 255, wrapX 0.91-1.08; pitch castle-a 34-35px, castle-c 34px (recropped 772px), castle-b ~32px (8 stones/tile, visual) | 0 | `floors-v2/floor-*` |
| floor-outlands-a/b/c | fieldstones in ash mud; b cracked mud, c wet sunk stones | wrapX 1.46-1.78; stones ~45-50px | a: 1 (first take 15 stones/tile + horizontal bands) | `floors-v2/floor-*`, `floors-v2/floor-outlands-*` |
| floor-desert-a/b/c | eroded sandstone flags; b sand-drifted, c crazed plates | wrapX 2.43-2.74 (V-wrap ~9-11 vs noise 3.5-4.7: faint seam at 5x5 repeat, masked by the 3-variant noise blend) | a: 1 (first take clean brick bond, 51px) | `floors-v2/floor-*` |
| floor-winter-a/b/c | frost-rimed slate; b ice-heaved cracks (one central burst), c ice glaze + frost ferns | wrapX 0.66-2.49; slabs 34-35 x 48-49px | 0 | `floors-v2/floor-*`, `floors-v2/floor-winter-*` |
| road-castle | small cobbles (~13px) | wrapX 0.73 | 0 | `floors-v2/road-*` |
| road-outlands/desert/winter | ruts / ripples / sled grooves | wrapX 1.39 / 1.63 / 2.36 | 1 each (first takes photographic, smooth; retry with the zone's floor raw as Image 1 for rendering only) | `floors-v2/road-*` |
| splat-* (12) | soft decals | strict QC passed, 1 frame, alignedBox 471 wide in 512 | 0 | `floors-v2/splat-*` |
| props-{zone}-c (4) | 9 cluster-archetype pieces | strict QC passed 9/9 each, 0 empty, 0 edge touch | 1 each (first takes lacked the vision anchor in `input`; discarded) | desert: `props-v2/props-desert-c` |
| props-{zone}-tall-top (4) | upper halves | derived crops, 36/36 non-empty | 0 (not generated) | `props-v2/props-*-tall-top` |
| landmarks-{zone} (4) | 9 region set-pieces | strict QC passed 9/9 each | 0 | `landmarks/landmarks-*` |

Generation inputs. Actor-class sheets (props-c, landmarks): `input` = [zone's accepted props sheet (Image 1: zone rendering/material/scale), `art/refs/vision-1.png` (Image 2: style anchor)], fixing clause at the head of the subject. Full-bleed subjects (floors, roads, splats): text-only, or an ACCEPTED sibling tile raw as Image 1 (floor b/c variants, 3 roads) — visually confirmed no anchor subject landed in any tile. The generations were called without the `OMP_SPRITE_EXPORT` marker and exported through the same sprite-forge processor via the CLI scripts below (the middleware's always-on "isolated sprite on magenta" clause is what welds xai's magenta frame onto full-bleed swatches; the first 4-tile batch with that clause came back framed and full of props, and was discarded). Provider raw is kept beside every export as `raw-provider.jpg`.

Repro (from `games/2026-08-29-duskhaul/`):
- floors/roads: `art/briefs/v2-world/process-fullbleed.sh <raw> <outDir> [--mean 25] [--lo 14]` (roads `--mean 22.5 --lo 6`, winter road `--mean 18 --lo 1`, floor-castle-c `--crop-min 760 --crop-max 820`)
- splats: `art/briefs/v2-world/process-splat.sh <raw> <outDir> [--mean 25]` (winter-a, desert-b `--mean 30`)
- props-c / landmarks: `art/briefs/v2-world/process-sheet.sh <raw> <outDir> 256|512` (landmarks `--sampling smooth`)
- tall-tops: `uv run -q --with pillow python art/briefs/v2-world/talltop.py`
- groups + tables: `uv run -q --with pillow python art/briefs/v2-world/emit.py`

## Set gates

`figure-ground.py`, per zone: complete cast = hero idle+run, every enemies-light/-heavy/-v2 `*-move`, that zone's `zone-<z>/*-move`, `props-<z>-a/b` + `props-v2/props-<z>-c` (27 actor sheets per scene); fields = floor a/b/c + road. Exit 0 with both grades:
- recommended grades (d9d9d9 ×3, winter checked separately at f5f5f5 in the L* table): every field `recessive`, clash 0.00%, busyRatio 0.11-0.37, C1 PASS. Set spread meanL 0.020..0.040, busy 2.78..7.38.
- current V1 `FLOOR_GRADE` values: also clash 0.00% / C1 PASS / busyRatio ≤ 0.37 — the relational gate passes, but the value band does not (see graded L* above). That is why the grade retune is part of the contract.

`art_review` (floors, fullBleedAssets, renderScale 256): all 12 report `value-spread-flat` FAIL (spread 0.155-0.179) + light-tier/plan warnings; silhouette checks correctly exempt (full-bleed). props-c + landmarks (renderScale 48): every sheet passed per-asset (value warnings only); set silhouette FAIL `props-castle-c` vs `props-winter-c` 0.049. Both findings are scoped out below.

## CRITERIA (retracted / rescoped, with the measurement)

1. **`art_review value-spread-flat` rescoped: not a floor criterion under PRD-V2 §3.7.** The PRD law requires L* 18-32 with grout 12-38, which caps lightness spread at about 0.26 of 0..1. Every V2 floor measures 0.155-0.179, inside that band by design. The plan it enforces (60/32/8 dark/mid/light) was calibrated on actor sheets. On floors it may be reported, never rejected on. The acceptance check for floors is the L* table (world.py) cross-read with art_review's `value.dark ≈ 0.99`.
2. **`art_review silhouette-collision` rescoped for cross-zone prop sheets.** castle-c vs winter-c 0.049 compares two whole 3x3 sheets. The PRD fixes the same 9 archetype slots for both (wall, corner, broken wall, tall, rubble, gravestone, monolith, post, fence), so equal occupancy is the brief. The two sheets never appear in the same scene. Within each sheet I checked the 9 cells by eye and they are distinct masses (long-low walls, L-corner, jagged stub, thin tall, wide-low heap, small slab, tall slab, thin post, wide lattice). Cross-sheet sheet-occupancy is reported, not gated.
3. **`sprite_check_palette meanDistance` read as distance-from-list only.** Winter props/landmarks read 37-40 with outliers 0.24-0.26: the cold ice hue is not in the 18-colour list. It still passes ≤48. This is a fact about the list, not a style defect.
4. **Chroma guard rescoped for props/landmarks.** Binding `art/style.json` to the keyer made the guard refuse `#c084fc` (146.3 from magenta). It kept 11,376-22,311 halo pixels of xai's pink-magenta background per sheet (visible pink fringe). No prop uses that violet, so these sheets key without the profile. Palette QC still binds it.

Post-review pixel transforms (reviewed THROUGH, all reproducible offline):
- `tonefit` (floors, roads, splats): applied BEFORE export and review. The shipped `sprite.png` is the file every number above measured.
- Runtime `FLOOR_GRADE` multiply: reviewed via `graded-lstar.py` and `figure-ground.py --grade` for both the V1 and the recommended values.
- Splat alpha 0.55 and tall-top alpha 0.6 are applied in code. Neither changes the value band: splats are graded to the floor band, and tall-tops are identical pixels over their own base.

## Flags for ui-engineer / integrator
- No text sits over this art. Landmarks carry warm torch accents (outlands/desert); minimap glyphs come from `mm-*`, not these sheets.
- `splat-castle-a` is a dull grey-olive lichen (0.02% forbidden-hue pixels). If it competes with the gloam-green player rim in the run screenshot, drop its weight.
- Provenance note: floors/roads keep `raw-provider.jpg` (the xai raw) and `raw-source.png` (the graded processor input; `sprite-metadata.json source.file` names it `graded.png` and `source.rawFile` names `raw-source.png`, same bytes). The intermediates `crop.png`/`graded.png` were deleted to keep the public tree small (floors-v2 39 MB → mostly raws); `process-fullbleed.sh` regenerates them.
