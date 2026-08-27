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

## Multi-action characters

1. Generate `idle` with `"writeScaleProfile": true, "profileName": "<char>"`.
2. Inspect it. Accept only when identity, proportions and feet line are right —
   everything downstream inherits its errors.
3. Every later action passes `"scaleProfile": "<path>"` plus the gates
   `maxBodyScaleCv: 0.08`, `maxAnchorYStd: 0.05`,
   `maxProfileScaleDrift: 0.08`.
4. If the provider keeps changing anatomy scale, build a
   `sprite_anchor_guide` from the accepted idle frame and pass it as an input
   image before regenerating.

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

## Reporting

Per asset: output dir, sheet path, frame count, cell size, palette
`meanDistance`, `art_review` figures where run, and any accepted QC exception
with the visual justification for it. Never claim quality from metadata alone.
