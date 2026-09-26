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
