# Group `enemies-light` — part A report (GenEnemiesLightA)

Owner: `GenEnemiesLightA`. Scope: 9 of the group's 18 sheets — the four shared light horrors
**husk, wretch, ratking, bonecaster**. The other 9 (thornhound, shroudmoth, pyreling, ashwraith) belong to
`GenEnemiesLightB`, who reports separately in `enemies-light-B.md`.

> Report split: `_common.md` names a single `reports/enemies-light.md`, but two agents own disjoint halves of
> this group, so a single path means whoever writes second clobbers the first. Split by agent, coordinated
> with `GenEnemiesLightB` over hub. The shared filename was left untouched.

Output root: `games/2026-08-29-duskhaul/public/assets/generated/enemies-light/`

## Per-asset results

All 9 sheets: `strict` QC **passed**, `sprite-sheet.png` + `animation.gif` + `frames/` + metadata present,
4 frames each, source grid cell aspect **1.0**, `sprite_check_palette` **passed** against
`art/style.json` (limit 48; every sheet also clears the tighter ≤36 advisory).

| id | src provider | frames | outH px | bodyScaleCv | anchorYStd | palette meanDistance | retries | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| enemy-husk-move | codex `.webp` | 4 | 157.0 | 0.067 | 0.027 | 18.93 | 2 | base, `husk-scale.json` written. **Main's canonical reference sheet.** |
| enemy-husk-death | codex `.webp` | 4 | 92.0 | 0.158 | 0.043 | 19.77 | 0 | posture-change note on cv |
| enemy-wretch-move | codex `.webp` | 4 | 112.8 | 0.183 | 0.037 | 19.75 | 2 | base, `wretch-scale.json` written |
| enemy-wretch-death | xai `.jpg` | 4 | 59.5 | 0.236 | 0.094 | 28.36 | 2 | posture-change notes on cv + anchorY |
| enemy-ratking-move | codex `.webp` | 4 | 81.5 | 0.135 | 0.088 | 26.13 | 0 | base, `ratking-scale.json` written |
| enemy-ratking-death | codex `.webp` | 4 | 74.8 | 0.507 | 0.119 | 22.91 | 0 | posture-change notes; 29-component burst |
| enemy-bonecaster-move | codex `.webp` | 4 | 181.0 | 0.015 | 0.029 | 20.02 | 0 | base, `bonecaster-scale.json` written; best cv in the group |
| enemy-bonecaster-attack | xai `.jpg` | 4 | 168.2 | 0.045 | 0.051 | 20.93 | 2 | telegraph + visible dart; only `art_review` clean-sweep sheet |
| enemy-bonecaster-death | xai `.jpg` | 4 | 141.0 | 0.360 | 0.076 | 20.52 | 2 | posture-change notes on cv + anchorY |

Provider column is read from `sprite-metadata.json.source.file`, not from a `raw-source.*` glob. The four
reprocessed sheets record `raw-source.<ext>` as their source because they were re-exported from the saved raw;
their generation provider is given above from my own run records. **Ambiguity sweep done:** every one of my 9
dirs now holds exactly one `raw-source.*`. I deleted a stale xai `.jpg` beside the shipped codex `.webp` in
`enemy-husk-move` (it was polluting the census — that dir is codex), and the superseded codex `.webp` raws in
the three dirs that shipped from xai.

## Silhouette separation — the group gate

`art_review` SET call, `renderScale: 48`, all 9 sheets: **`silhouettes.passed: true`, `findings: []`**, 36
pairs spanning **0.061 – 0.221**. A second SET call across just the four `-move` sheets also passes clean:

| pair (move sheets) | distance |
| --- | --- |
| wretch ↔ ratking | 0.112 |
| wretch ↔ bonecaster | 0.128 |
| husk ↔ bonecaster | 0.140 |
| ratking ↔ bonecaster | 0.154 |
| husk ↔ wretch | 0.161 |
| husk ↔ ratking | 0.175 |

**Verdict: the four creatures do not read as the same blob at 48px.** Separation is carried by mass and
outline as the brief demands, not by colour: husk is a broad slumped rectangle (dense, wide as it is tall);
wretch is a low sprinting hook (wider than tall, spindly, open magenta gaps between limbs and torso); ratking
is a flat wide writhing mound roughly 3× wider than tall with a bristling tail/leg fringe; bonecaster is a
tall thin column ~3× taller than wide broken by a single vertical staff line. Closest pair in the whole set is
`husk-death ↔ ratking-death` at 0.061 — both are *end-state debris piles*, which is semantically correct and
involves no living silhouette.

## Debris survival — measured, not eyeballed

Connected components per frame (area ≥ 4px). Under a force-filtered `componentMode: largest` every row would
read `1 / 1 / 1 / 1`:

| id | components/frame | reads as |
| --- | --- | --- |
| enemy-husk-death | 1 / 1 / **11** / 4 | dust burst, then motes above the heap |
| enemy-ratking-death | **29** / 12 / 2 / 9 | burst → scatter → exactly *two* stragglers → bone litter |
| enemy-bonecaster-death | 1 / 1 / **8** / 3 | bone cascade → robe-and-bone pile |
| enemy-bonecaster-attack | 2 / **7** / 3 / 1 | amber bead + sparks; **dart detached in flight** |
| enemy-wretch-death | 1 / 1 / 1 / 1 | correct — this tumble has no detached debris by design |

## Group `art_review` figures

`value.dark` / `mid` / `light`, `spread`, `colourCount`:

| id | dark | mid | light | spread | colours | asset verdict |
| --- | --- | --- | --- | --- | --- | --- |
| enemy-husk-move | 0.808 | 0.188 | 0.004 | 0.537 | 18479 | fail: light tier |
| enemy-husk-death | 0.795 | 0.190 | 0.015 | 0.639 | 15195 | fail: light tier |
| enemy-wretch-move | 0.800 | 0.181 | 0.018 | 0.644 | 12046 | fail: light tier |
| enemy-wretch-death | 0.750 | 0.238 | 0.012 | 0.639 | 7059 | fail: light tier; warn temperature-single (93% cool) |
| enemy-ratking-move | 0.821 | 0.167 | 0.012 | 0.557 | 25461 | fail: light tier |
| enemy-ratking-death | 0.804 | 0.174 | 0.022 | 0.675 | 11329 | **pass** |
| enemy-bonecaster-move | 0.808 | 0.149 | 0.043 | 0.783 | 21120 | **pass** |
| enemy-bonecaster-attack | 0.640 | 0.273 | 0.087 | 0.794 | 18695 | **pass, zero findings** |
| enemy-bonecaster-death | 0.824 | 0.111 | 0.065 | 0.749 | 15509 | **pass** |

No sheet has a collapsed lightness range — spread runs 0.537–0.794 throughout. The failures are the
*light-tier share*, not monotone output.

## qcExceptions (reported, NOT written into the shared manifest)

Per batch instruction these are reported here rather than edited into `art/manifest.json`.

1. `{ "id": "enemies-light/enemy-husk-move", "reason": "art_review value-tier-absent:light (lights 0.4%). Kept unchanged: this is Main's declared canonical reference sheet, so rerolling it to chase the plan number would move the whole build's style target." }`
2. `{ "id": "enemies-light/enemy-husk-death", "reason": "art_review value-tier-absent:light (lights 1.5%); dark-dominant read matches canonical husk-move, which measures 0.4%." }`
3. `{ "id": "enemies-light/enemy-wretch-move", "reason": "art_review value-tier-absent:light (lights 1.8%); kept for coherence with canonical husk-move rather than lightened away from the canon." }`
4. `{ "id": "enemies-light/enemy-wretch-death", "reason": "art_review value-tier-absent:light (lights 1.2%) plus temperature-single at 93% cool; retry budget spent, and the cool-only read is the correct trade against the warm-brown drift of the alternative take." }`
5. `{ "id": "enemies-light/enemy-ratking-move", "reason": "art_review value-tier-absent:light (lights 1.2%); a knot of wet dark rats has no large light plane to carry a 1/6 light tier without ceasing to read as vermin." }`

Not exceptions, recorded for transparency: the four collapse sheets and the attack carry
`qc.postureChange[]` notes rather than failures — see below. That is a first-class exporter feature, not a
relaxation, so I am deliberately **not** filing them as exceptions.

| id | posture notes |
| --- | --- |
| enemy-husk-death | `body-scale-cv:0.1582>0.0800` |
| enemy-wretch-death | `body-scale-cv:0.2360>0.0800`, `anchor-y-std:0.0943>0.0500` |
| enemy-ratking-death | `body-scale-cv:0.5065>0.0800`, `anchor-y-std:0.1187>0.0500` |
| enemy-bonecaster-death | `body-scale-cv:0.3597>0.0800`, `anchor-y-std:0.0762>0.0500` |
| enemy-bonecaster-attack | `anchor-y-std:0.0515>0.0500` (marginal) |

## Deviations from the brief, with justification

1. **`writeScaleProfile` as a path, not `true`.** The exporter only reads it when
   `typeof === "string"`; the boolean is silently dropped and no `<char>-scale.json` is ever written. All four
   bases use the literal path the siblings reference. Found independently here on the first husk export;
   `husk-scale.json` was the build's first proof the string form works.
2. **Collapse sheets exported via `process-sprite.ts --posture-change`.** A death animation whose specified
   final frame is a heap cannot satisfy a bbox-height *invariance* gate — measured cv 0.16 / 0.24 / 0.51 /
   0.36 against a 0.08 limit. `--posture-change` routes only the four scale gates into `qc.postureChange[]`
   while contamination, edge-touch and paste-clamp stay fatal, so the gates still measure. Its own doc comment
   names a death animation as the motivating case. CLI-only — the marker whitelist does not carry it.
3. **Collapse sheets reprocessed WITHOUT `--scale-profile`, pixel params passed explicitly.** A bound profile
   overrides `componentMode` (and `threshold`/`edgeThreshold`/`minComponentArea`/…) unconditionally, forcing
   `largest`, which deletes every detached rat and dust mote. Scale fidelity is exact rather than approximate:
   `scaleMode preserve` at the same `cellSize`/`fit` on identical 627×627 cells reproduces the base's
   `sourceToOutputScale` bit-for-bit — verified to 16 digits, 0.3511323763955343 both ways.
4. **Three sheets shipped from xai while their chain base is codex.** Prompt-length trimming routed them to
   xai. Kept because they satisfy the group's cold-palette law where the codex takes drifted warm brown/olive,
   and because the xai attack is the only take that actually renders the marrow dart. Cross-provider size
   prior was corrected deterministically, not by regeneration: reprocessed unbound with
   `--scale fit --fit (base outputSubjectHeightMean / 256)` — 0.707 for bonecaster, 0.44 for wretch — which
   normalises exported subject height to the base and took bonecaster-attack's profile drift from 0.2018 to
   ~7%.
5. **`duration: 0` fix not applicable.** All 9 of my markers carry positive durations (90–150).

## Known weaknesses I would flag before integration

- `enemy-bonecaster-move` (codex) has a grey-**lavender** robe; `enemy-bonecaster-attack` and
  `enemy-bonecaster-death` (xai) are cold blue-grey. All three are cold and in-law, but the chain is not one
  single robe hue. The attack and death agree with each other; the move sheet is the odd one and is also the
  scale-profile base, so I did not touch it.
- `enemy-wretch-death` is 93% cool with no warm-against-cool read at all — the flattest colour structure in
  my nine.
- The xai sheets (wretch-death, both bonecaster siblings) are somewhat lower in detail density than the codex
  ones. They pass the reference-pair eyeball test against `hero-idle` and `husk-move` — chunky pixels, hard
  dark outline, cold palette, red eyes present — but they are visibly simpler.
