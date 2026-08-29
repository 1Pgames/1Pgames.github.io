# Group report — `pickups-fx` (loot atoms, 9 sheets)

Agent `GenPickupsFx`. Output root `games/2026-08-29-duskhaul/public/assets/generated/pickups-fx/`.
Style profile `games/2026-08-29-duskhaul/art/style.json` (`maxPaletteDistance` 48, report pass bar 36).

## Per-asset

| id | frames | grid | cell (src) | strict QC | palette meanDistance | outlierFrac | regens | provider |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `shard-glint` | 4 | 2x2 | 627x627, aspect 1.0 | pass | **30.98** | 0.084 | 2 (provider/divider-line) | openai-codex |
| `relic-hover-t1` | 4 | 2x2 | 627x627, aspect 1.0 | pass | **27.97** | 0.031 | 0 | openai-codex |
| `relic-hover-t2` | 4 | 2x2 | 627x627, aspect 1.0 | pass | **32.82** | 0.156 | 1 (missing halo tier-tell) | openai-codex |
| `relic-hover-t3` | 4 | 2x2 | 627x627, aspect 1.0 | pass | **29.73** | 0.066 | 0 | openai-codex |
| `relic-hover-t4` | 4 | 2x2 | 627x627, aspect 1.0 | pass | **22.23** | 0.075 | 2 (absent aura, absent light tier) + 2 threshold reprocesses | openai-codex |
| `chest-open` | 4 | 2x2 | 627x627, aspect 1.0 | pass | **22.53** | 0.065 | 0 | openai-codex |
| `casket-sparkle` | 2 | 1x2 | 768x1024, aspect 0.75 | pass | **16.55** | 0.010 | 0 | openai-codex |
| `xp-mote` | 4 | 2x2 | 512x512, aspect 1.0 | pass | **20.74** | 0.020 | 3 (silhouette drift, smooth-render style loss, palette 60.18) | xai |
| `bolt-arcane` | 1 | 1x1 | 1024x1024, aspect 1.0 | pass | **24.34** | 0.086 | 3 (aspect 3.74, then 20° lean, then aspect) | xai |

**Palette note:** the two `xai` rows were measured against the palette AFTER ArtInterface corrected it
(adding `#c084fc` and `#f0ccfc`, the pale cool violet-white the profile had been missing). That correction
is monotonically safe — adding an anchor can only shorten each pixel's nearest-anchor distance — and I
confirmed it on two of my own assets rather than taking it on trust: `xp-mote` 22.81 → **20.74**
(outliers 0.047 → 0.020) and `relic-hover-t4` 22.23 → **22.16** (outliers 0.075 → 0.072). No regression
anywhere. The seven `openai-codex` rows above are the pre-correction figures and can only have improved.

> ## ⚠ INTEGRATION HAZARD — do not reprocess `relic-hover-t4` at default thresholds
>
> `relic-hover-t4` is the only sheet in this group processed with **non-default chroma params**
> (`--threshold 150 --edge-threshold 150`), and **its metadata does not record them** — `output.threshold`
> and `output.edgeThreshold` both read `null`. Anyone who reprocesses that sheet from its raw using the
> params in `sprite-metadata.json` will silently get the default 180/210 and **destroy the 3px dusk-violet
> aura**, which is the Dread tier's primary tell and the reward-legibility surface of the extraction loop.
> The sheet will still pass strict QC while doing so, so nothing will flag it.
>
> If `relic-hover-t4` must ever be reprocessed, the command is:
>
> ```
> bun ~/.omp/plugins/node_modules/oh-my-pi-sprite-forge/skills/sprite-forge/scripts/process-sprite.ts \
>   --input <dir>/raw-source.webp --output <dir> --rows 2 --cols 2 --cell-size 128 --duration 140 \
>   --align center --scale fit --fit 0.86 --sampling nearest \
>   --component-mode all --component-padding 0 --min-component-area 1 \
>   --threshold 150 --feather 0 --edge-threshold 150 --strict
> ```
>
> Verify afterwards by counting connected components per frame: correct is **16 / 31 / 26 / 19**. A collapse
> toward 1–4 per frame means the aura and motes were keyed away.

All 7: `qc.passed = true`, `edgeKeyFraction = 1.0`, `foreignRegionCount = 0`, no findings.
`casket-sparkle`'s 0.75 cell aspect is inherent to a 1x2 grid on a square canvas and is expected — the brief
names it explicitly. It binds no `scaleProfile`, so the aspect cannot break a profile bind.

Provider read via the on-disk proxy agreed with Main (`raw-source` container: `.webp` = openai-codex,
`.jpg` = xai). **`sprite-metadata.json` records no provider field**, so the "read provider from saved
metadata" instruction is not directly satisfiable; all 7 sheets are `.webp`, and every accepted generation
also reported `openai-codex / gpt-5.5` in its tool result.

### Debris integrity — the `scaleProfile` / `componentMode` override does not apply here

`applyScaleProfile` (`process-sprite.ts:743-757`) unconditionally overwrites `componentMode`,
`minComponentArea`, `threshold`, `feather` and `edgeThreshold` from a bound profile, which silently forces
`componentMode: "largest"` and deletes every detached particle. **No marker in this group binds a
`scaleProfile`**, so the override cannot fire — verified rather than assumed, since `pickups-fx` was named
as exposed. All 7 metadata records show `componentMode: "all"` / `minComponentArea: 1`, and a per-frame
connected-component count confirms the detached debris is physically present and tracks the brief's own
mote schedule:

| asset | components per frame | reads as |
| --- | --- | --- |
| `relic-hover-t1` | 1, 1, 1, 1 | correct — t1 is the 0-mote tier |
| `relic-hover-t2` | 3, 3, 5, 1 | 2 motes present, present, peak, then "motes gone" on frame 4 as briefed |
| `relic-hover-t3` | 1, 7, 1, 1 | 4 motes lift on frame 2 |
| `relic-hover-t4` | 16, 31, 26, 19 | 3px violet aura fragments + the 6 rising motes |
| `shard-glint` | 1, 1, 3, 1 | wedge + the 2 briefed sparks on frame 3 |
| `chest-open` | 1, 1, 2, 1 | gilt sparks above the open mouth |
| `casket-sparkle` | 1, 1 | correct — the star flares off the gilt edging, so it is attached |

Had the override fired, every one of these would have collapsed to 1. The necessary condition is a bound
profile, so any group that never used one is clear by construction.

Corollary that also protected the t4 violet recovery: because the override forces `threshold`/`edgeThreshold`
back to the profile's values, a `--threshold 150` recovery is silently discarded on any sibling that binds a
profile. This group's t4 reprocess ran with no `--scale-profile`, so the 150 pass took effect.

`--posture-change` is not applicable: this group has no death, collapse or prone sheet, and `chest-open`'s
bbox does not collapse.

### Raw-source hygiene

`shard-glint` held two raws — a stale `raw-source.jpg` (xai, 14:01, from the failed divider-line attempt)
beside the accepted `raw-source.webp` (codex, 14:03). The `.webp` was md5-matched against the accepted run's
temp file (`f45025d0c24e2c1392520abb475bc000`, exact) to confirm which one shipped, and the `.jpg` was
deleted. All 7 dirs now hold exactly one raw, all `.webp`, so the `.jpg = xai / .webp = codex` census is
honest for this group. Note that `shard-glint` would have mis-censused as ambiguous before this cleanup.

## The critical 4-tier separation gate

`art_review` SET call over the four `relic-hover-t*` sheets at `renderScale` 48 — **PASSED**
(`silhouettes.passed = true`, `findings: []`), and every one of the 6 pairs is separated:

| pair | silhouette distance |
| --- | --- |
| t2 vs t3 | 0.093 |
| t1 vs t4 | 0.159 |
| t3 vs t4 | 0.191 |
| t2 vs t4 | 0.220 |
| t1 vs t3 | 0.260 |
| t1 vs t2 | 0.292 |

The brief's four binding axes, verified as delivered rather than as intended:

| tier | aura | motes | silhouette class | measured warmShare / coolShare |
| --- | --- | --- | --- | --- |
| t1 Tarnished | none, 1 dim gilt glint pixel | 0 | wide low hollow ring + tooth nub, open hole | 0.921 / 0.058 |
| t2 Burnished | thin continuous gilt halo outside the outline | 2 | tall narrow teardrop pendant, 3-link chain stub | 0.949 / 0.013 |
| t3 Gilded | 2px gilt halo + 4 straight hard-edged N/E/S/W spokes | 4 | tallest, upright skull idol with head and shoulders | 0.981 / 0.005 |
| t4 Dread | 3px dusk-violet aura + red pinprick core | 6 | widest, jagged 5-spike crown | **0.198 / 0.258** |

**Verdict: the tiers are separable at renderScale 48 without reading a label.** The primary tell is
measured, not asserted: t1/t2/t3 sit at coolShare 0.005–0.058 while t4 sits at 0.258 with warmShare
collapsing from 0.98 to 0.20 — t4 is the only cool relic and the only one with a red core, exactly as the
brief requires. The secondary tell is mass: t1 wide-and-hollow vs t3 tall-and-shouldered are the two
extremes (distance 0.260), with t4 the widest and the only jagged upper edge. Closest pair is t2 vs t3 at
0.093 — both vertical masses — but they are held apart on the other three axes (1px halo vs 2px halo plus
four straight spokes; 2 motes vs 4; jewellery-on-a-chain vs a figure with a head), and the gate reported no
finding on the pair.

## Set review 2 — value structure

`art_review` SET over `shard-glint` + `chest-open` + `casket-sparkle`: silhouettes **passed**, `findings: []`
(distances 0.186 / 0.251 / 0.273). Busiest sheet `chest-open` reviewed individually as well — **passed**
(`colourCount` 17597, the group's highest; value dark 0.809 / mid 0.153 / light 0.038, spread 0.753,
`peakOverMean` 3.11).

A whole-group 7-asset SET call was also run to catch duplicate silhouettes across the entire group:
**silhouettes passed, `findings: []`, all 21 pairs distinct**, minimum distance 0.093 (t2 vs t3).

Recurring non-blocking warnings across the group, and why they are correct here rather than fixed:
`value-plan-miss:dark` on 5 sheets (dark 0.63–0.93 against a planned 0.50) and `temperature-single` on the
four gilt sheets. These are small loot objects on a transparent field: there is no environment to carry the
planned mid tier, and a gilt reward atom is warm by gameplay law (§11), so a warm-against-cool read inside
a single gilt shard would mean breaking the colour code. t4 is the group's counterexample and shows the
system works — being the violet tier, it lands at neutralShare 0.544 and trips no temperature warning.

### The `value-tier-absent:light` finding, and why two sheets keep it

The SET calls failed two sheets on `value-tier-absent:light` (t4 at 1.0%, `casket-sparkle` at 1.1%, against
the 3.75% floor = 25% of the planned 15%). Both set calls passed silhouette variety with `findings: []`
while this quietly failed, which is the argument for running the SET call for real rather than inferring
from per-asset palette numbers.

**t4 was fixed** — it needed a regeneration anyway, and bright gilt band inlay plus a specular chip on each
of the 5 spike tips took it from lights 1.0% → **6.3%**, dark 0.750 → 0.684, spread 0.580 → **0.902**,
`passed: true`, which turned the 4-tier gate green.

**`casket-sparkle` deliberately keeps its 1.1%**, on three grounds:
1. Ruled out as a processing artifact by measurement, so nobody else wastes a reprocess: I suspected
   nearest-neighbour decimation was discarding 2px speculars from a 768px source cell into a 128px output
   cell, which `--sampling smooth` would have fixed for free. Light share in the RAW vs the EXPORT is
   **0.0097 vs 0.0108** — identical. The lights were never generated. Unlike the violet aura, this is a
   generation-space property, not a processing loss.
2. It is a *geometric* impossibility as briefed, not laziness: the brief puts this object's light in the
   gilt EDGING round the rim of a box, and a rim is intrinsically thin, so brightening it can never reach
   one sixth of the object's area. A light tier needs a broad SURFACE to live on. (Corrected prompt, held
   unused: move the light onto the lid's whole top plane in the 3/4 view.)
3. Per Main's standing ruling, an already-accepted sheet is not rerolled to chase this check while
   `plan.valuePlan` is itself under review — and canonical `enemies-light/enemy-husk-move` fails the same
   check **harder**, at 0.4% lights, than this sheet does at 1.1%. Forcing a bright sixth onto a
   deliberately dark "kept locked and safe" badge would fight both the brief's intent and the value
   language every other sheet in the build actually speaks.

**`xp-mote` also keeps its 1.7%**, for a different and more interesting reason — see the qcExceptions
section. Briefly: the profile palette held no cool light at generation time, so a cool-only pickup could
not reach a light tier and stay on-palette; ArtInterface has since corrected the palette from the vision
anchor, so it is now reachable via pale violet-white glow cores on a future pass.

Taken together the three cases show the check fails for three DIFFERENT reasons, which is why it should
not be chased mechanically: t4 was a genuine miss and was fixed; `casket-sparkle` is geometric (the light
has nowhere broad to live); `xp-mote` was a palette-coverage defect in the profile itself.

## Three defects found and fixed (all generalisable)

**1. The chroma key silently destroys dusk-violet — this cost t4 its entire tier tell.**
Read from `process-sprite.ts:288-309`: a pixel is keyed iff `min(r,b) - g > 24` AND
`magentaDistance <= --threshold` (default 180), where `magentaDistance = hypot(255-r, g, 255-b)`.
Sampled from t4's own raw, the rendered aura is ~`rgb(87,50,233)` → distance ~176, gate ~37 — inside the
kill zone. Measured on that raw: **29,045 aura pixels destroyed, 6,176 spared**. The raw had a perfect 3px
aura; the export had a bare outline plus stray specks, which reads exactly like the model ignoring the
prompt. I burned one regeneration on that false diagnosis before checking the raw.
Fix, zero regenerations: reprocess the accepted raw with `--threshold 150 --edge-threshold 150`, every other
param copied verbatim from `sprite-metadata.json.output`. Both matter — the default `--edge-threshold` 210
deletes the aura by background-connected flood fill even when the hard key spares it.
Confirmed my aura is the `#5b4bff` family (observed min distance 172.1, safe at 150) and **not** the
`#ad6eef` Dread literal, so the `--threshold 120` ruling for art-locked literals did not apply here.
Note for anyone reusing this: a fresh export always keys at the default 180, so when t4 was regenerated for
an unrelated reason the aura was gutted again and the 150 pass had to be re-run. **The fix lives in the
processing step, not in the raw.**

**2. `xai` cannot produce these sheets; the counter is prose, not a provider switch.**
`xai/grok-imagine` returned a dull-pink field (not `#FF00FF`), literal black divider lines across the sheet,
and once a 3x2 grid for a requested 2x2 plus an unrequested violet aura — failing strict QC with
`background-contamination` + `source-edge-touch` on all 4 frames, twice. What cleared it, with no marker
change: describe the canvas as "ONE single continuous sheet of pure flat magenta RGB(255,0,255) … NOT a
grid, NOT a contact sheet … do not draw the line across the middle", and describe frames as "the same
subject drawn four times, two across and two down" rather than as a rows×cols sprite sheet. Every export
after that passed first try. This was adopted centrally.

**3. The "provider outage" is prompt LENGTH combined with the appended style anchors.**
Four consecutive calls here returned `Image generation failed for all credentialed providers: xai`, all with
**no `input` key at all** (so exactly the auto-appended anchors), and all after 7 successful `openai-codex`
calls in the same session — which ruled out the 3-image-ceiling hypothesis from my side and matched
GenZoneDesert's and GenZoneCastle's no-input failures. GenHero's controlled sequence identified the actual
variable: a long `subject` **plus** the appended reference images is rejected and misreported as a
credential error, while the same length with no marker succeeds. My failing prompts were ~4400 chars.
The counter is to cut the prompt to ~2000–2400 chars, which is the same edit as de-negating it: the
mandatory assertions are all short, and it is the negative enumerations that eat the budget.

## Style acceptance

Judged against the canonical pair (`hero/hero-idle`, `enemies-light/enemy-husk-move`) per the final
procedure, at frame level as well as sheet level. All 7 carry the visible chunky pixel grid, the hard
near-black 1px silhouette outline, and their coded hue. No brown drift: the explicit palette assertion held
`chest-open` and `casket-sparkle` to cold blue-grey stone/iron (chest-open coolShare 0.545, casket 0.682),
and t4 to cold black-blue iron. The four gilt sheets are legitimately warm because gilt **is** the coded
reward hue — the same warmth that appears on hero-idle's gilt belt fittings.

Per Main's ruling, `meanDistance` is reported as a drift alarm only and was never used as style evidence.

## Brief defects — none in this group

Both circulated marker defects are **non-applicable** to `pickups-fx`, verified rather than assumed:
- `"duration":0` — all 9 markers carry positive durations or omit the key (`bolt-arcane`, 1x1, correctly
  omits it and the exporter fallback supplies 120).
- `"writeScaleProfile": true` — no marker in `pickups-fx.md` uses `writeScaleProfile`, `scaleProfile` or
  `profileName`; the only mention is prose on `casket-sparkle` saying not to use one. No chains, so the
  sibling-drift reprocess step does not apply either.

## The two integrator additions

Both requested by `Integrator` to close the only genuine art-slot gaps (`objects/xporb.ts`,
`objects/projectile.ts`). Both markers carried `threshold`/`edgeThreshold` 150 as written.

**Marker-level chroma params ARE honoured — verified, and worth recording because they are unrecorded.**
`xp-mote`'s metadata reports `threshold: null` / `edgeThreshold: null` despite the marker carrying 150/150.
I proved the marker took effect by md5: the shipped sheet is byte-identical to an explicit
`--threshold 150 --edge-threshold 150` reprocess (`7f9f55e0c1c69fce8131254d051280cf`) and differs from a
defaults reprocess (`290a4e1a15f546b45339f32900b5845a`). So Integrator's marker design was correct; only
the persistence is lossy, exactly as for `relic-hover-t4`.

**New refinement of the violet-key finding — pale glow ERODES rather than vanishing.** At default
thresholds `xp-mote` does not lose its glow outright; it gets shredded. Components per frame go
`[1,4,9,1]` → `[1,13,31,11]` while opaque area DROPS (6100 → 5359 px on frame 2), i.e. the key eats
pixels out of the middle of the glow and fragments one solid blob into many islands. That is the OPPOSITE
diagnostic signature to t4's saturated aura, which was deleted wholesale and showed as a component
count *collapse*. So the component-count test detects both, but the direction of the change differs by
glow type — a count that RISES while area falls means erosion, a count that FALLS means deletion. My
earlier broadcast only described the collapse case.

**`xp-mote` vs `shard-glint` separation — the acceptance criterion — PASSED.** They drop side by side and
mean opposite things. `art_review` SET at renderScale 48 reported `silhouettes.passed = true`,
`findings: []`, distance **0.185**, and the colour split is the widest in the whole group:

| | warmShare | coolShare | silhouette |
| --- | --- | --- | --- |
| `shard-glint` (carry, can lose) | 0.912 | 0.074 | angular faceted wedge |
| `xp-mote` (kept XP) | **0.000** | **1.000** | round blocky bloom |

Round-vs-angular carries the read, with 0% vs 91% warm reinforcing it — so the separation is silhouette
first, as instructed, not colour alone. `bolt-arcane` sits at 0.392 from the shard and 0.455 from the mote.

`bolt-arcane` geometry, measured on the export rather than eyeballed: bbox 110x43, level to **1.4°**
(vertical centroids 65.6 → 62.8 across the width), and asymmetric with the mass on the right
(mean column heights left→right 14.5 / 24.0 / 34.8 / 30.7), so it points RIGHT with a thin tail left as
required. Core is pale near-neutral cool with a violet fringe and no baked gilt or red, so the runtime
multiply-tint reads.

## qcExceptions

Two lines, both on the integrator additions. The original 7 need none.

`{ "id": "pickups-fx/bolt-arcane", "reason": "Drawn box is 110x43 (2.56:1) against the brief's ~1.4:1, so it ships nearer 5.6:1 than 3:1 at the consumer's size*2.2 stretch. Four attempts could not hold thickness and level orientation at once: 3.74 -> 1.24 (but with a 20 deg built-in lean) -> 3.14 -> 2.56 level. Kept the LEVEL take, because a 20 deg lean makes EVERY projectile fly visibly crooked relative to its travel vector, which is worse for readability than a longer streak. Two alternatives if Integrator prefers a different trade: the 1.24-ratio take is preserved at /tmp/bolt-v2/ (volatile, ask soon), or a one-number change to the consumer's 2.2 multiplier (their file, not mine) makes the shipped take read at the intended proportion." }`

`{ "id": "pickups-fx/xp-mote", "reason": "art_review value-tier-absent:light at 1.7%. At GENERATION TIME the profile palette contained no cool light — the sole entry above the light threshold was warm bone #e8e0d0, and the brightest cool entry was far below it — so a cool-only pickup could not carry a light tier and stay on-palette. Proven empirically: the pale-cyan take reached the light tier and blew the palette gate to meanDistance 60.18 (outlierFraction 0.53), while the violet take passes at 20.74. ArtInterface has SINCE CORRECTED the palette from the vision anchor (added #c084fc and #f0ccfc, a genuine pale cool violet-white), so this is no longer impossible: a future regeneration could reach the light tier on-palette using pale violet-white glow cores. The asset is kept as-is because it passes strict export QC, the palette gate and the silhouette set, and the light-tier check is advisory-as-reject under ArtInterface's standing ruling." }`
