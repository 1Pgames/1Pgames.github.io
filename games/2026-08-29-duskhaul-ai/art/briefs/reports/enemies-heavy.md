# Group report — `enemies-heavy` (8/8 accepted)

Output root: `games/2026-08-29-duskhaul/public/assets/generated/enemies-heavy/`
All 8 sheets: `qc.passed=true`, `sprite-sheet.png` present, `cell.aspect = 1.0`, `foreignRegionCount = 0`.
Palette gate: all 8 pass (`profile: art/style.json`, limit 48; brief's target ≤ 36).

## Per asset

| id | frames | provider (`source.file`) | meanDistance | outlierFrac | bodyScaleCv | anchorYStd | retries | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| enemy-paleknight-move | 4 | xai (.jpg) | 28.08 | 0.095 | 0.008 | 0.049 | 3 + 1 restore | final pass added the red eye-slit assertion |
| enemy-paleknight-death | 4 | xai (.jpg, reprocessed) | 25.74 | 0.050 | 0.199 † | 0.053 † | 0 | `--posture-change`; plates cascade EMPTY |
| enemy-marrowworm-move | 4 | codex (.webp) | 26.40 | 0.077 | 0.160 | 0.097 | 2 | only codex sheet in the group |
| enemy-marrowworm-death | 4 | xai (.jpg, reprocessed) | 24.63 | 0.054 | 0.223 † | 0.093 † | 0 | `--posture-change`; clean two-part split |
| enemy-dirgebell-move | 4 | xai (.jpg) | **16.61** | 0.019 | 0.109 | 0.047 | 2 | best palette figure in the group |
| enemy-dirgebell-death | 4 | xai (.jpg) | 19.82 | 0.043 | 0.077 | 0.014 | 2 | regenerated off the corrected grey bell |
| enemy-gildedghoul-move | 4 | xai (.jpg) | 24.25 | 0.051 | 0.101 | 0.072 | 1 | the loot piñata |
| enemy-gildedghoul-death | 4 | xai (.jpg, reprocessed) | 29.07 | 0.119 | 0.449 † | 0.052 † | 0 | `--posture-change`; gilt burst + gold pile |

† Reported as `qc.postureChange[]` notes, not failures — see "Posture gates" below.

Scale profiles written (all square 512×512 or 627×627 source cells, aspect 1.0):
`paleknight-scale.json`, `marrowworm-scale.json`, `dirgebell-scale.json`, `gildedghoul-scale.json`.

## Group `art_review` SET call (4 × `-move` + `enemies-light/enemy-husk-move`, renderScale 48)

Silhouette variety: **PASSED, no findings**, all 10 pairs distinct.

| pair | distance |
| --- | --- |
| paleknight × dirgebell | 0.088 |
| dirgebell × gildedghoul | 0.096 |
| marrowworm × dirgebell | 0.100 |
| paleknight × gildedghoul | 0.105 |
| marrowworm × gildedghoul | 0.105 |
| paleknight × husk | 0.109 |
| dirgebell × husk | 0.141 |
| paleknight × marrowworm | 0.144 |
| gildedghoul × husk | 0.165 |
| marrowworm × husk | 0.206 |

Value / colour structure:

| asset | dark | mid | light | spread | warmShare | colourCount | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| paleknight-move | 0.713 | 0.257 | 0.029 | 0.675 | 0.083 | 23791 | pass |
| marrowworm-move | 0.571 | 0.242 | 0.186 | 0.863 | 0.775 | 16724 | pass |
| dirgebell-move | 0.624 | 0.366 | 0.010 | 0.643 | 0.121 | 8459 | `value-tier-absent:light` (advisory, see below) |
| gildedghoul-move | 0.747 | 0.211 | 0.042 | 0.768 | 0.407 | 17150 | pass |
| husk-move (canon) | 0.808 | 0.188 | 0.004 | 0.537 | 0.799 | 18479 | `value-tier-absent:light` — the canon fails it harder |

**Cross-weight mass check:** the heavies read as heavier than the husk — every heavy/husk pair is ≥ 0.109 apart, and the two limbless silhouettes (worm 0.206, bell 0.141) are the furthest from it.

**Gilded-ghoul reward coding, measured:** warmShare 0.407 against paleknight 0.083 and dirgebell 0.121 — the ghoul is 3–5× warmer than its cold-iron siblings while its flesh stays cold plum-grey, so the gilt is doing the reward signalling rather than an overall warm drift. It is also the only sheet in the group carrying `#d9a24b`/`#e8c547`.

## Posture gates on the death sheets

Adopted the approved build-wide deviation: the 4 `-death` markers drop `scaleProfile` + `maxProfileScaleDrift` and keep `maxBodyScaleCv 0.08` + `maxAnchorYStd 0.05`. Three deaths still exceeded the intra-sheet gates because the action's *purpose* is to collapse or fragment, so they were reprocessed from their own accepted raw with `--posture-change`. Verified honoured — `qc.postureChange[]` is populated with the exact overages while `failures` is empty:

- paleknight-death: `body-scale-cv:0.1987>0.0800`, `anchor-y-std:0.0533>0.0500`
- marrowworm-death: `body-scale-cv:0.2228>0.0800`, `anchor-y-std:0.0929>0.0500`
- gildedghoul-death: `body-scale-cv:0.4495>0.0800`, `anchor-y-std:0.0523>0.0500`

All three were also reprocessed at `--component-mode all` so the detached debris survives (cascading plates, both worm halves, the coin spray and gold pile). `enemy-dirgebell-death` needed no posture flag — it cleared the gates outright at cv 0.077.

## Coded-glow check, measured (opaque pixels: r>90, r−g>45, r−b>45)

| asset | threatRed | warm |
| --- | --- | --- |
| paleknight-move | 0.30% | 15.9% |
| paleknight-death | 0.49% | 27.7% |
| dirgebell-move | 3.16% | 29.7% |
| gildedghoul-move | 6.81% | 55.2% |
| marrowworm-move | 0.32% | 94.5% |
| husk-move (canon) | 0.09% | 88.6% |

The red eye-slits on both paleknight sheets are present and bright — visually confirmed in all four frames of each after the final regeneration — and paleknight-move carries over 3× the canonical husk's threat-red share on this metric.

**Scope warning for anyone reusing a threat-red target.** Area share is not a usable gate for an eye-slit-only subject. Two slits on a massive armoured body are intrinsically a fraction of a percent, and a 5% target is only reachable where the glow is a large feature — a whole glowing face, a bell mouth (3.16%), a coin-crusted body (6.81%). Pushing a knight to 5% would mean bloating the slits into headlights, which contradicts `style.json`'s focal rule ("the single glowing element of the sprite"). For masked or armour-dominant characters, gate on **presence in every frame** (visual), not on area share.

## qcExceptions

**None declared.** One advisory, not an exception:

- `enemies-heavy/enemy-dirgebell-move` — `art_review` reports `value-tier-absent:light` (lights 1.0% against a planned 8%). Two retries were spent on exactly this and both improved it materially: dark 0.875→0.624, mid 0.125→0.366, spread 0.532→0.643, meanDistance 24.10→16.61. A black-iron bell lit by one torch has genuinely little light area, and the canonical `husk-move` fails the same check harder (0.4%). Per the standing order this is advisory pending the `plan.valuePlan` ruling, and `qc.passed` is true.

## Deviations from the brief

1. `writeScaleProfile: true` → literal path string on all 4 base markers (boolean is silently dropped).
2. `-death` markers unbound from `scaleProfile` + `maxProfileScaleDrift` (approved build-wide).
3. `componentMode: "all"` on all 4 `-death` markers so detached debris is not filtered.
4. `duration: 0` fix — **not applicable**, all 8 of this group's markers carry positive durations (100–160).
5. Violet clause 6 / chroma-key recovery — **not applicable**, this group contains no violet. Its coded hues are dried-blood red (all four enemies) and gilt/torch-amber (gildedghoul only).

## Known weaknesses, stated honestly

- **paleknight-move** is the closest pair in the set to `husk-move` (0.109) and to `dirgebell-move` (0.088) — a big armoured knight and a big ghoul are both hunched bipeds, so its "massive square block" mass is less extreme than the brief asks. Its red eye-slits were absent until the final regeneration and are now clearly present in all 4 frames; warmShare fell to 0.083, the coldest sheet in the group.
- **marrowworm-death** frame 1 shows the body already in ~4 fragments rather than "mid-body tears". The brief's load-bearing requirement — frame 2 reads as a clean two-part separation — is satisfied clearly, and frames 3–4 read as two thrashing then limp halves.
- **marrowworm-move** is the group's only codex sheet and its only warm-dominant one (warmShare 0.775), though that matches canonical `husk-move` at 0.799 and bone is legitimately parchment-toned.
- Faint welded contact smears survive under the feet on `paleknight-move`, `paleknight-death` and `gildedghoul-move` frames. They pass the key (`foreignRegionCount 0`, `edgeKeyFraction 1.0`) and read as grime at renderScale 48.

## Method notes worth reusing

- Prompt-length ceiling is real: `styleProfile`-bearing calls at ~2700–2900 chars failed as `failed for all credentialed providers: xai`; the same asset at ~2300 succeeded first try. `enemy-gildedghoul-move` failed twice at length and landed immediately once trimmed.
- Passing a character's **own accepted sheet** as `input` (1 explicit input + 1 appended anchor = 2 images, within xai's cap) held identity across each `-move`→`-death` pair better than an anchor guide, and doubles as a layout/no-divider/no-shadow demonstration.
- The `--posture-change` reprocess is strictly better than a qcException for a collapse action: zero regenerations, and the overage stays visible in the metadata.
- Reprocessing an accepted raw reproduced `sprite-sheet.png` byte-for-byte (md5 `9444a61e…` before and after) while writing the missing scale profile — the correct fix for the `writeScaleProfile` defect, never a reroll.
