# Duskhaul — common generation contract (read first, applies to EVERY brief in this directory)

Game: `games/2026-08-29-duskhaul/` — grimdark-fantasy horde-survivor + extraction. Style: gritty pixel
(`duskhaul-grit`). Every path below is REPO-ROOT-relative.

Style profile: `games/2026-08-29-duskhaul/art/style.json` — pass it as `styleProfile` in every export
marker. Its `references` hold the LOCKED VISION ANCHOR — now exactly ONE:

- `games/2026-08-29-duskhaul/art/refs/vision-1.png` — Image 1: fixes rendering style, palette, lighting,
  1px outline, chunky pixel finish, torch-amber/dusk-violet light logic.

`vision-2.png` is still on disk but is NO LONGER a reference and is NOT appended. The set was cut to one
so a guide-bearing call is 2 images instead of 3, clearing xai's ceiling. Never write a prompt that
refers to "Image 2" unless YOU passed a second image yourself. The material detail vision-2 used to
carry — rust specular, bone porosity, wet stone, gilt — must now be asserted in prose.

The middleware APPENDS the profile reference to `generate_image.input` — no cap, no truncation, no
dedupe — whenever `styleProfile` is set; a text-only call after this lock is a DEFECT.

## Prompt template (compose every prompt exactly like this)

1. Open with the fixing clause, verbatim shape:
   > Image 1 fixes the rendering style, palette, lighting, outline, finish AND material rendering — dry
   > bone, rotten cloth, rusted iron, gilt — match it exactly. Draw a NEW subject in that style: <the
   > asset's subject line> — an original composition of your own, taking only rendering, palette and
   > materials from the reference image.
   Note: `vision-2.png` used to be Image 2 and carried MATERIAL rendering — rust specular, bone
   porosity, wet stone, gilt. The anchor set was cut to one, so that job is now done by PROSE in the
   clause above. Sheets generated before the cut had that material anchor and later ones do not: a
   temporal coherence seam, recorded in `art/coherence-audit.md`. Assert materials explicitly.
2. Then the asset's ACTION + frame-by-frame progression (one clause per frame, given per asset).
3. Then the asset's SILHOUETTE BRIEF (mass + outline + how it differs from its siblings).
4. Then ALL of these, explicitly, every call:
   - exact `<rows> rows x <cols> columns`, read left-to-right then top-to-bottom in chronological
     order; NOT a grid — no divider, separator or cross line, do not draw the line across the middle;
     no border, gutter, gradient, vignette, text or watermark;
   - The entire background is one flat solid pure magenta, hex #FF00FF, RGB 255 0 255, uniform in every
     background pixel, continuing seamlessly and unbroken behind, between and beneath all poses — the
     subject floats in empty magenta, with pure flat magenta touching the soles directly. The subject is
     the only thing drawn, and every pixel that is not the subject is that same flat magenta.
   - one subject centred in each implied cell, drawn complete and entire within the central 65% safe
     area — every limb, weapon, hair strand, cloth fold, chain and particle ending inside that margin,
     with clear flat magenta separating each cell's subject from the next;
     CONCRETE PIXEL BOXES BEAT PERCENTAGES. If a subject keeps overrunning the margin — wide, many-
     limbed or long-tailed ones do — restate the containment as measured pixels rather than a share of
     the cell: "the creature fits a box 340px wide by 250px tall, centred, leaving 85px of magenta past
     the leftmost tip". That cleared a wide 8-legged subject which had ignored "middle 55%/60%" four
     times running.
   - identical subject identity, costume, palette, camera distance and standing-equivalent scale in
     every frame; stable bottom/feet anchor (or stable hover line for floaters).
   Rule: negation tokenizes the artifact, assertion removes it — describe the magenta that should be
   present, never enumerate the shadows/lines/ground that should be absent. The single-line canvas ban
   above is the deliberate exception: the xai anti-divider phrasing is measured, load-bearing and cheap,
   so it stays even though it is a negation.
5. Canvas: `image_size: "1024x1024"`, `aspect_ratio: "1:1"` (exceptions are named per asset).
6. Do NOT add style adjectives beyond the per-asset material notes — the styleProfile merge carries the
   art direction. Never request lettering, digits or words.

## Prompt budget (hard failure if exceeded)

Keep the `subject` string in the 2000-2400 character band whenever a `styleProfile` is attached. A long
subject COMBINED with the appended anchor is rejected by xai as `failed for all credentialed providers:
xai` — a fake credential error, not a size error, which is why it reads as an outage. Bisected on one
asset with everything else held constant: ~4500 failed, ~3200 failed, ~2400 SUCCEEDED, ~2300 succeeded;
4250 chars with NO marker succeeded, so raw length alone is not the problem. The ceiling therefore sits
between 2400 and 3200 — target 2000-2400, and if you still fail "at about 2400" cut nearer 2000.

If you see that error string, TRIM. Do not wait for it to clear, do not drop `styleProfile` (that costs
the style-prose merge too), and do not rewrite the art direction. Four trims that cost zero constraints:

- collapse the per-frame paragraph to ONE LINE per frame;
- state the identity block ONCE instead of restating it per section;
- fold the SILHOUETTE BRIEF into the subject line;
- reduce the canvas negatives to "no divider, separator or cross line, no border, gutter, gradient,
  vignette, text or watermark".

Every mandatory clause still fits at 2400 chars because the assertions are SHORT — it is the
enumerations that eat the budget. Trimming and de-negating are the same edit.

TWO THINGS NOT TO TRIM. (1) Keep the xai anti-contamination prose — "not a grid / no divider or
separator line / do not draw the line across the middle". A trimmed call routes to xai readily and xai
reproduces its contamination signature without that line; those characters are the one xai-specific
defence and they are cheap. (2) Provider size priors DIFFER — the same size prose rendered one actor
15% OVER profile height on xai and 12% UNDER on codex — so a numeric size clause calibrated against a
drift gate does NOT transfer across providers. If a retry lands on the other provider, re-check drift
rather than assuming your calibration holds.

## Colour code (gameplay law — never negotiate per asset)

threat = dried-blood `#c0392b` glow · reward = gilt `#d9a24b` · extraction/arcane = dusk-violet
`#5b4bff` · player rim = gloam-green `#8a9a5b` · hazard light = torch-amber `#e8c547`. Red eyes on
every hostile; the world stays cold desaturated plum-grey.

**Palette assertion (put it in every actor and prop prompt — the styleProfile merge alone does NOT hold
either provider to the palette).** Use this POSITIVE form, adapting only the material noun:

> DARK ASH-PLUM GREY #2b2431/#4a4452/#1a1520/#0d0b10, a dim grey-violet stone colour, dull as wet
> granite in an unlit cellar; absolutely no tan, beige, sand, khaki, brown, sepia or ochre, and no part
> should read as a saturated colour rather than dull grey <material>.

PASTE ONLY THE QUOTED BLOCK ABOVE. Everything below it is director-facing rationale and deliberately
names the blue tokens; putting any of it in a prompt reintroduces the exact defect it documents.

THIS CLAUSE USED TO CARRY ITS OWN DEFECT. The earlier "COLD DESATURATED BLUE-GREY PLUM" wording
contains the token BLUE and produced fully NAVY cloth and navy armour on xai; adding "never blue, navy,
teal" made it WORSE — negation at maximum prominence, the identical self-defeat as the ground-shadow
wording. So the cold end is now named as grey-violet / ash-plum and the words blue, navy, cyan and teal
appear NOWHERE in the assertion. The guard is still two-sided, just asymmetric on purpose: the warm
family stays ENUMERATED because it is measured to help (the model's prior for these subjects is warm),
while the cool over-correction is caught by the SATURATION TEST rather than by naming a cool colour.

Measured: the warm-only form left one sheet at 98.7% warm; over-correcting pushed another to saturated
teal at meanDistance 44.42; the positive ash-plum form fixed two navy sheets FIRST TRY.

WINTER EXCEPTION: that zone legitimately needs cold blue vocabulary for its ice identity. Put the
zone's own colour in the SUBJECT prose; the ash-plum wording governs grime, stone and metal only.

OPEN HYPOTHESIS, recorded so the next game tests it instead of inheriting our conclusion: the blue
token may be a cheaper explanation than "provider warm gravity" for some of the "the palette assertion
did not take" reports, possibly including matron-move. NOT settled.

## Scale profiles (multi-action characters)

- The character's `move`/`idle` sheet is generated FIRST with `"writeScaleProfile":
  "games/2026-08-29-duskhaul/public/assets/generated/<group>/<char>-scale.json", "profileName":
  "<char>"`. Inspect and ACCEPT it (identity, proportions, feet line) before any sibling.
- Every 2x2 sibling of that character passes `"scaleProfile":
  "games/2026-08-29-duskhaul/public/assets/generated/<group>/<char>-scale.json"` (use the exact path the
  base export reports if it differs) plus `"maxBodyScaleCv": 0.08, "maxAnchorYStd": 0.05,
  "maxProfileScaleDrift": 0.08`.
- Non-NxN grids (1x2, 2x3, 2x4) have non-square source cells: NEVER attach `scaleProfile` to them; keep
  only the CV/anchor gates.

### WARNING — a bound `scaleProfile` silently overrides your PROCESSING params

`applyScaleProfile` (process-sprite.ts:743-757) unconditionally overwrites `cellSize`, `align`,
`scaleMode`, `fit`, `threshold`, `feather`, `edgeThreshold`, `sampling`, `componentMode`,
`componentPadding` and `minComponentArea` FROM THE PROFILE, ignoring whatever you passed, and nothing
in the metadata records that it happened. Two consequences that have already cost real work:

- componentMode requested as `all` is processed as `largest`, which keeps ONE connected component and
  DELETES every detached element — debris, sparks, scattered rubble, rising motes. The tell is a burst
  that looks "oddly clean": the art was generated and then filtered away.
- the violet / pale-rose recovery at `--threshold 150 --edge-threshold 150` is DISCARDED the same way,
  because a base processed at the default 180 forces 180 on every sibling binding it. If you
  "recovered" an aura on a bound sibling, re-check the pixels.

ESCAPE HATCH for both, identical: reprocess WITHOUT `--scale-profile` and pass the profile's pixel
params explicitly. Identity scale is preserved bit-for-bit — `scaleMode preserve` at the same
cellSize/fit reproduces `sourceToOutputScale` exactly, verified to 16 digits.

Corollary: the override only fires when a profile is BOUND, so the build-wide `-death` unbind already
immunises all 8 death sheets. That matters most for `enemy-scarab-death`, whose entire payload is
detached gilt shards, and for the chapelghast/kite/gargoyle/giant/yeti deaths whose cloth scraps,
feathers, rubble, tearing skin and ice sheeting would otherwise have been deleted with nothing
reported. Attacks stay bound, so `enemy-widow-attack` and `enemy-giant-attack` are still exposed —
verify their debris by COUNTING CONNECTED COMPONENTS per frame, never by eye: a force-filtered sheet
collapses to 1.

### On drift — the anchor-guide route (measured; use it verbatim)

`maxBodyScaleCv` and `maxAnchorYStd` are INTRA-sheet gates; `maxProfileScaleDrift` compares the sheet
against the base profile. Steps 1-2 fix the first two; only step 3 fixes the third.

1. Build the guide from an ACCEPTED BASE frame with `xd://sprite_anchor_guide`:
   `{"input":"<base>/frames/frame-000.png","output":"/tmp/<char>-anchor.png","rows":R,"cols":C,"cellWidth":512,"cellHeight":512,"subjectHeightRatio":<step 3>,"feetRatio":<base anchorYMean>}`
2. Pass it as the ONLY explicit `input`. The middleware APPENDS the single vision anchor AFTER it, so
   your guide is Image 1 and the anchor becomes Image 2 — RELABEL the fixing clause accordingly. Prompt
   it as "Image 1 fixes THIS EXACT CHARACTER's identity, proportions, overall size and hem line ...
   change ONLY the <action>". ARITHMETIC TO KEEP: explicit inputs + appended references must stay ≤ 3
   (xai's cap); with one anchor a guide-bearing call is 2, so there is headroom. If such a call returns
   `failed for all credentialed providers: xai`, first TRIM the subject into the 2000-2400 band (see
   Prompt budget); only if it still fails, drop the `input` and carry the constraint in prose instead —
   "each figure is SMALL in its quarter, about two thirds of the quarter's height, with a wide band of
   empty magenta above and below" — which measured a clean strict pass with no guide image at all.
3. Set `subjectHeightRatio` to the base profile's `bodyScaleMean` and TRY IT UNCOMPENSATED FIRST — with
   a height-preserving pose an uncompensated guide tracked to drift 0.0096. ONLY if drift actually
   appears, divide by 1.15 (`subjectHeightRatio = <bodyScaleMean> / 1.15`) to compensate the measured
   ~1.15x provider overshoot; compensating pre-emptively overshoots small. Carry this prose with it:
   "each figure is SMALL in its quarter, about two thirds of the quarter's height, with a wide band of
   empty magenta above and below — do not enlarge, do not let them fill their quarters, do not zoom in".

Measured effect, so nobody re-derives it: the guide alone took `bodyScaleCv` 0.2004 -> 0.0198 and
`anchorYStd` 0.1013 -> 0.0120; where compensation WAS needed the 1.15 divide took
`profile-body-scale-drift` 0.1499 -> 0.0206; where the pose preserved height, an uncompensated guide
already sat at 0.0096.

THIS CANNOT BE FIXED AT PROCESSING TIME. `bodyScale` is measured in SOURCE space (subject bbox height
over source grid-cell height), so `--fit` provably does not move `profile-body-scale-drift` — verified
twice, once by reprocess and once by reading `process-sprite.ts`. Only regeneration with a corrected
guide moves it.

CHEAPER ALTERNATIVE where the pose permits it: drift is bbox-height-over-cell, so a kneeling or
crouched sibling CAN bind an upright base profile if you brief it to PRESERVE BBOX HEIGHT — "a TALL
UPRIGHT high kneel — spine straight, shoulders squared, hood carried high", plus "the top of the head
and the lowest point sit at the identical height in every drawing". A low crouch fails. Use this when
the action allows, and the compensated guide when the action genuinely changes height (death, prone,
lunges).

## QC + retries (every asset)

- Export QC is automatic (strict unless the asset says `strict:false`). On failure use `qc.retryHints`,
  change ONE thing, regenerate. Budget: 2 regenerations per asset per symptom. After that keep the best
  export and append `{ "id": "<group>/<id>", "reason": "<one-line visual justification>" }` to
  `art/manifest.json.qcExceptions[]` — never relax strict QC to hide clipping.
- A shippable asset is proved by OUTPUT PRESENT — `sprite-sheet.png` for a multi-frame export, or
  `sprite.png` for a 1x1 — never by a non-empty directory, and never by `sprite-sheet.png` alone (that
  test libels every single-frame tile, icon and backdrop). Two-part discriminator: output ABSENT with
  `passed=false` is genuinely unshipped; output PRESENT with `passed=false` means the METADATA is
  LYING, because a failed run writes no output — a failed export overwrites `raw-source.*` and
  `sprite-metadata.json` while leaving a good sheet in place. Restore the accepted raw from its
  omp-image temp and reprocess; an unchanged md5 proves the art was never broken.
- FULL-BLEED ASSETS ONLY (the 8 zone tiles, `bg-menu`, `collapse-ring`): `minAlpha` MUST be 255 and
  `fit` MUST be 1. The `pixel-art-fx` path applies fit 0.86, which insets the texture and leaves a
  transparent margin, so the asset exports clean, passes every check and silently cannot tile. Zero-
  regeneration fix: reprocess at `--fit 1 --align center --scale fit --allow-source-edge-touch`.
  SCOPE, state it whenever you quote this rule: for a sprite, prop or FX sheet `minAlpha` 0 at fit 0.86
  is CORRECT and required, since strict QC enforces that margin via source-edge-touch. Never sweep this
  check tree-wide. Note two different causes leave the same transparent margin — this inset, and xai's
  welded 45-56px magenta frame on full-bleed swatches — so check `minAlpha` on the OUTPUT and the
  border of the RAW separately rather than reprocessing against the wrong one.
  ONE MORE SCOPE SPLIT inside full-bleed: `--fit 1` only works on a SQUARE asset. For a 1x1 export the
  processor always emits a square `cellSize` canvas and letterboxes the image into it, so a PORTRAIT
  full-bleed asset keeps its content at the right ratio inside transparent side bars and `minAlpha`
  stays 0 no matter what you pass (measured across three flag combinations including `--threshold 0
  --edge-threshold 0`). Full-bleed SQUARE -> `--fit 1`; full-bleed NON-SQUARE -> deterministic NEAREST
  resample of the accepted raw to the target size, which preserves hard pixel edges.
- `sprite_check_palette` with `profile: games/2026-08-29-duskhaul/art/style.json`: record `meanDistance`
  (pass ≤ 36).
- Per group: one `art_review` SET call across the sheets named in the brief's "Set review" line —
  silhouette variety is judged at renderScale 48. Record lightnessRange / lights% / silhouette notes.
- LOOK at every exported sheet/GIF. Regenerate on: identity drift, clipped limbs, welded ground strip,
  scale/anchor drift, collapsed lightness, blob-sibling silhouettes.

## Report

Write `games/2026-08-29-duskhaul/art/briefs/reports/<group>.md`: per asset — output dir, frame count,
palette meanDistance, retries used, accepted exceptions; then the group `art_review` figures. The
ArtDirector audits the numbers AND the pixels.
