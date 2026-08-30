# Prompt contract for generation agents

Every generation agent gets: the style profile path, its manifest slice, its
output directory, and this contract. Deviating from it is what produces sheets
that cannot be sliced.

## The call

One `generate_image` call per asset (write JSON to `xd://generate_image`), with
exactly one export marker in `changes`:

```json
{
  "prompt": "<subject + action + frame-by-frame progression>",
  "style": "<merged automatically from the style profile; add only asset-specific material notes>",
  "composition": "<grid + containment contract>",
  "image_size": "1024x1024",
  "aspect_ratio": "1:1",
  "changes": [
    "OMP_SPRITE_EXPORT:{\"outputDir\":\"public/assets/generated/hero/hero-run\",\"rows\":2,\"cols\":4,\"profile\":\"hd-body\",\"cellSize\":256,\"duration\":110,\"styleProfile\":\"art/style.json\",\"scaleProfile\":\"public/assets/generated/hero/hero-scale.json\",\"maxBodyScaleCv\":0.08,\"maxAnchorYStd\":0.05,\"maxProfileScaleDrift\":0.08}"
  ]
}
```

## Mandatory prompt clauses

Every prompt states, explicitly:

1. Exact rows and columns, and that frames read left-to-right then
   top-to-bottom in chronological order.
2. Solid flat `#FF00FF` background — no gradient, shadow, border, grid line,
   text, label, watermark or UI.
3. **Nothing beneath the subject**: no ground line, contact strip, baseline,
   platform, terrain patch or cast shadow. Providers that honour "no shadow"
   still weld a strip of ground to the feet unless told twice.
4. One subject centred in each implied cell, entirely inside the central 65-70%
   safe area; no limb, weapon, hair, cape, particle or effect crossing a cell
   boundary.
5. Identical subject identity, costume, palette, camera distance and
   standing-equivalent scale in every frame; stable feet/hover line.
6. The frame-by-frame progression, one clause per frame ("frame 1 crouch, frame
   2 lean forward, frame 3 launch, frame 4 recover").
7. The silhouette brief: the asset's mass and outline shape, and how it differs
   from its siblings in the same group.

## Per-kind settings

| Kind | `profile` | `cellSize` | Extra |
| --- | --- | --- | --- |
| body | `hd-body` | 256 | feet anchor; scale-profile gates on multi-action characters |
| fx | `hd-fx` | 128 | centred fit; all components retained |
| ui | `hd-fx` | 256 | icons/emblems only; centred, symmetric, transparent margin, no character content |
| bg | `hd-fx` | native | only kind allowed a non-square canvas: request a **portrait target aspect (9:16)**; a provider returning a source width/height ratio of **0.5-0.75** (i.e. taller than wide, close to 9:16 = 0.5625) is acceptable — MEASURE the returned `sprite-metadata.json` `source.width`/`source.height`, don't eyeball it, and regenerate if the ratio falls outside that band |

The runtime policy for every `bg` asset is **uniform cover-fit crop**
(`scale = max(viewWidth / sourceWidth, viewHeight / sourceHeight)`, centred,
overflow cropped symmetrically) — never a non-uniform stretch. A source
outside the 0.5-0.75 band either crops too aggressively (near-square source)
or leaves letterboxing impossible to fill (very tall/narrow source); staying
in-band is what makes the crop forgiving instead of surgical.

## Step 0 — tool preconditions (before your first prompt)

You cannot satisfy this contract without `generate_image`. Before writing a single
prompt:

1. Confirm you hold `generate_image`, plus whichever of
   `sprite_preflight_background`, `sprite_check_palette`, `art_review` and
   `sprite_anchor_guide` your slice needs.
2. Prove it with ONE cheap probe call (512x512, no export marker) and put the probe
   result on the first line of your report.
3. If a required tool is missing, return **`blocked: required tool missing —
   <tool>`** and stop. That is a named, reportable failure and the correct
   deliverable.

**Never work around a missing tool.** Shelling out to a nested `omp -p
--auto-approve` session, calling a provider CLI directly, or hand-authoring pixels
all bypass the export marker, which means no background preflight, no palette check,
no `sprite-metadata.json`, no registry row and no reproducibility. One generation
agent did exactly this — 0 `generate_image` calls for a whole group — and the group
had to be regenerated from scratch.

## Vision anchors (reference-conditioned generation)

Once `art/style.json.references` names the locked vision anchors
(`art/refs/vision-*.png`, game-art Step 1b), every **ACTOR-class** generation call
carries them:

```json
"input": [{ "path": "games/<slug>/art/refs/vision-1.png" }]
```

and the prompt's `changes`/`subject` opens with the fixing clause, verbatim
shape:

> Image 1 fixes the rendering style, palette, lighting, outline and finish —
> match it exactly. Draw a NEW subject in that style: <subject description>.
> Do not copy Image 1's composition or objects.

**SCOPE — this rule is split by SUBJECT CLASS. The split is measured; do not
collapse it back into a blanket rule.**

| Subject class | Anchors | Why |
| --- | --- | --- |
| ACTOR: characters, enemies, bosses, props, icons, emblems, cover | MANDATORY. A text-only actor call after the lock is a defect. | The anchor is the only thing that holds 100 actor sheets to one look. |
| FULL-BLEED: seamless tiles, floors, terrain, backdrops, parallax layers | Text-only, OR an ACCEPTED SIBLING TILE as explicit Image 1 (which demotes the vision anchor to Image 2). Then LOOK at the result. | The provider redraws the anchor's SUBJECT into the tile. A floor request came back as a full reaper portrait on magenta, and the brief's CRITICAL "ground and nothing else" line did not clear it. Passing an accepted ground tile as Image 1 cleared it first try — at the cost that Image 1's composition is then copied hard, so pick a parent whose structure you want and say which properties transfer. |

Rules:
- **Cap: 2 anchors, deduped.** The middleware APPENDS every `style.json.references`
  entry to `input` with no cap, no dedupe and no truncation whenever `styleProfile`
  is set. xai's total image cap is 3, so 2 anchors + an anchor guide already fails;
  1 anchor leaves headroom for the guide. Fix the count at lock time — Duskhaul cut
  2 anchors to 1 mid-run and inherited a temporal coherence seam, with earlier
  sheets carrying a material anchor that later ones do not.
- Anchors pin STYLE; the marker's `styleProfile` still rides along (palette
  QC measures against it) and the magenta-background composition clause is
  unchanged — reference images never replace the chroma-key contract.
- Multi-action characters stack inputs: Image 1 = vision anchor, Image 2 =
  the accepted base frame / `sprite_anchor_guide` (identity + scale), and
  the clause names both ("Image 1 fixes style; Image 2 fixes this exact
  character's identity, proportions and feet line"). If you pass the guide as your
  only explicit `input`, the appended anchor lands SECOND — relabel the clause to
  match what the provider actually receives, never to what you intended.
- A provider that ignores inputs (style drifts anyway) is handled like any
  QC failure: 2 retries counted in the manifest's `attempts`, then fall back to
  text-only and WRITE a `qcExceptions[]` entry naming the drift.

## Multi-action characters

1. Generate `idle` with `"writeScaleProfile": true, "profileName": "<char>"`.
2. Inspect it. Accept only when identity, proportions and feet line are right —
   everything downstream inherits its errors.
3. Every later action passes `"scaleProfile": "<path>"` plus the gates
   `maxBodyScaleCv: 0.08`, `maxAnchorYStd: 0.05`,
   `maxProfileScaleDrift: 0.08`. Only NxN grids may bind a profile.
4. If the provider keeps changing anatomy scale, build a
   `sprite_anchor_guide` from the accepted idle frame and pass it as an input
   image before regenerating.
5. **A bound `scaleProfile` overwrites your PROCESSING params** —
   `cellSize`/`align`/`scaleMode`/`fit`/`threshold`/`feather`/`edgeThreshold`/
   `sampling`/`componentMode`/`componentPadding`/`minComponentArea` come from the
   profile, and the export records which ones the profile won. Two consequences with
   real cost: `componentMode: all` processed as `largest` DELETES every detached
   element (debris, sparks, motes — the tell is a burst that looks "oddly clean";
   verify by COUNTING CONNECTED COMPONENTS per frame, never by eye), and a
   chroma-recovery `--threshold 150 --edge-threshold 150` is discarded if the base
   was processed at the default. Escape hatch for both: reprocess WITHOUT
   `--scale-profile` and pass the profile's pixel params explicitly; identity scale
   is preserved bit-for-bit at the same cellSize/fit.

## UI specifics

Generate only UI that is drawing, never UI that is geometry: panels, buttons,
bar housings and frames are primitives in `ui/primitives.ts`.

- Icon sheets: one glyph per cell, same optical size and stroke weight across
  the sheet, thick outline, one specular highlight, no background plate, no
  drop shadow, no character features (providers love adding eyes to a heart).
- Emblems/badges: symmetric, centred, transparent margin, wordless.
- Never generate letters, digits or words: the engine renders text.

## Inspection and regeneration

Inspect every returned sheet/GIF. Regenerate — never patch — on:

| Symptom | Prompt delta |
| --- | --- |
| Ground strip welded to the feet | repeat the "nothing beneath the subject" clause and name the strip explicitly |
| Limb/weapon crosses a cell edge | shrink the subject to the central 60% and restate the safe area |
| Scale or anatomy drifts between frames | add the scale profile / anchor guide, restate constant camera distance |
| Identity drift (costume, palette) | restate the identity clause verbatim from the accepted idle |
| Muddy, no lights | restate `valuePlan` lights share and where the specular sits |
| Siblings look like one blob | rewrite the silhouette brief with mass and outline contrast |
| Background contamination failure | do not disable the gate: regenerate with more magenta padding |

Change exactly one thing per regeneration, and use `qc.retryHints` from the
failed export instead of guessing.

**The budget is a counter, not advice: 2 regenerations per asset per symptom.**
Increment that asset's `attempts` in `art/manifest.json` after each regeneration.
**Before a third generation of the same asset, WRITE its `qcExceptions[]` entry
first** — `manifest-lint.py` errors `attempt-budget-exceeded` at `attempts >= 3`
without one. Prose alone did not hold: the same budget was reasoned past to a
seventh variant on one tile.

## Full-bleed fields have their own gate

If your slice contains a floor, terrain tile, backdrop or parallax layer, the group
is not accepted on per-asset numbers. Run, and report the output:

```bash
# From the game project root. `realpath skill://...` does NOT work in a plain shell
# (it only resolves inside omp's bash tool) and would silently run nothing.
REPO="$(git rev-parse --show-toplevel)"
python3 "$REPO/.claude/skills/game-art/references/figure-ground.py" --scene <zone> \
  --actors <that scene's COMPLETE cast sheets> --fields <your field sheets> \
  --grade <runtime tint hex> --manifest art/manifest.json
```

It measures the field against the ACTORS drawn on it: clash > 15% fails, 8-15% ships
only on a written manifest exception, `busyRatio` > 1.20x fails. Also: a full-bleed
asset needs `fit: 1` (or an explicit `fullBleed: true` marker) — the default 0.86
inset leaves a transparent margin, so the tile exports clean, passes every per-asset
check and silently cannot tile. That scope is FULL-BLEED ONLY: for a sprite, prop or
FX sheet, `minAlpha` 0 at fit 0.86 is correct and required.

## Reporting

First line: the Step 0 tool probe result.

Per asset: output dir, sheet path, frame count, cell size, palette `meanDistance`,
`attempts` used, `art_review` figures where run, and any accepted QC exception
**named by the `art/manifest.json.qcExceptions[]` id it was written under** — a
justification that lives only in this report is not recorded, and the lint will say
so. Then the `figure-ground.py` output for every scene your fields appear in,
including the actor sheet list you ran it against.

Never claim quality from metadata alone, and never claim it from a per-asset number
when the defect lives between two assets.
