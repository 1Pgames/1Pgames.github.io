# fauna-a report (ArtFaunaA)

Tool probe: `generate_image` (512-class throwaway, no marker) → xai-oauth / grok-imagine-image, 1024×1024 JPEG. OK.
Every asset call below was served by `xai-oauth` (read from `sprite-metadata.json.source.provider`).
19 asset generations + 1 probe. Landed: `public/assets/generated/fauna-a/` with all 10 manifest ids.
Staging, raws, cleaned raws and the reprocess script: `art/exports/fauna-a/`.

## Processing: what differs from the generation plan, and why

1. **The plan's `"scaleMode":"fit"` marker key is silently ignored** (measured on my first 4 exports:
   `metadata.output.scaleMode = "preserve"`; ArtBuildingsB found the same). The marker field is
   **`"scale":"fit"`**, which I used from the brute regeneration on (`output.scaleMode = "fit"`,
   `overrides: []`). This needs fixing in generation-plan §0.3.
2. **Every sheet goes through `art/exports/fauna-a/refit.py`**: `process-sprite.ts` on the export's own
   raw with `--scale fit --fit 0.86` (spitter 0.72, see below), `--align bottom` (moth `center`),
   threshold 150 / feather 55 / edgeThreshold 170, `componentMode largest`, strict, **no chroma guard**.
   That is the same thing `rekey.py` does, so rekey is superseded, not skipped. The marker's metadata is kept as
   `sprite-metadata.marker.json`, and `sprite-metadata.json.reprocess` records the tool, fit and input.
   - `--deshadow` (brute walk/attack, spitter walk/attack): xai welded a darkened-key contact shadow
     (measured rgb ≈ (144,48,112)) under the feet. It is alpha-connected to the legs, so `largest`
     cannot drop it. The script repaints raw pixels with `r>100, b>80, r-g>70, g<0.5·min(r,b)` to the
     key colour. Every fauna palette colour fails that test, so only the darkened key is touched.
   - `--deseam` (skitter attack, brute attack): xai drew black divider lines on the cell seams. The script paints
     a 10 px seam band and a 6 px border with key before processing. `source-edge-touch` still gates the subject.
3. **The skitter walk anchor was re-processed, not regenerated.** It used the same raw, but went from `preserve`/`feet`
   (95 px tall, 145 px long in a 256 cell) to `fit 0.86`/`bottom` (143.5 px tall, 220 px long).
   `feet` alignment clamped at fit (the feet anchor sits off the body's centre) and `bottom` fixed that. The rewritten
   `fauna-skitter-scale.json` (sourceToOutputScale 0.651) is the profile the attack binds.
4. **Spitter at fit 0.72**: the lob attack stretches the sac ~10% taller than the walk, so at the
   walk's fit 0.86 frames 1 and 3 clamped at the cell top. I re-based the walk at 0.72 (184 px tall), and the
   attack binds that profile (189 px mean, 202 max).

## Per-asset table

Regens = regenerations after the first call. The manifest `attempts` convention follows the anchor QC
(skitter walk = 1 regen). mD = `sprite_check_palette` meanDistance (max 52).

| id | intent / silhouette brief | grid / cell | regens (symptoms) | mD | outlier | export QC (effective) | h mean / long edge px | visual verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fauna-skitter-walk | anchor: glass runner, round shell, thin legs | 2x2 / 256 | 0 new (anchor, re-processed) | 25.26 | 0.041 | strict pass, cv 0.002, ayStd 0.001 | 143.5 / 220 | accepted (canon) |
| fauna-skitter-attack | pounce-bite, mandibles forward | 2x2 / 256 | 2 (copied Image-2 sheet; dividers → deseam salvage). A 3rd call was rejected (facing flip + front view) | 28.70 | 0.043 | strict pass, profile fauna-skitter, cv 0.048 | 153.3 / 253 | accepted with exception: small pose amplitude (lean + mandible reach) |
| fauna-spitter-walk | Acid Lobber: TALL glowing acid balloon on a small banded body | 2x2 / 256 | 0 | 29.73 | 0.045 | strict pass, cv 0.001, fit 0.72, deshadow | 184 / 184 | accepted: faces right, sac wobble |
| fauna-spitter-attack | squash → stretch → lean-and-lob → upright | 2x2 / 256 | 3 (copy; salmon bg + facing flip; white dividers + front view) | 27.60 | 0.037 | strict pass, profile fauna-spitter, postureChange (cv 0.084) | 189.3 / 202 | accepted: consistent side view facing right. The detached droplet under the spout (514 px) was dropped by `largest`; the projectile is fx |
| fauna-brute-walk | Carapace Ram: heavy domed plates + big curved horn | 2x2 / 256 | 1 (dividers + welded ground line) | 23.79 | 0.012 | strict pass, cv 0.000, deshadow | 135 / 220 | accepted; leg motion is subtle but present |
| fauna-brute-attack | rear-dip → horn thrust → head toss → settle | 2x2 / 256 | 1 (copied Image-2 sheet); 2nd call salvaged by deseam | 25.52 | 0.015 | strict pass, profile fauna-brute, postureChange (cv 0.150) | 143 / 223 | accepted: strong readable ram |
| fauna-moth-walk | Lumen Moth: WIDE pale wing triangle, airborne, symmetric top-front view | 2x2 / 256 | 0 | 26.59 | 0.028 | strict pass, align center, cv 0.130 (wing extents) | 112.8 / 220 | accepted: direction-neutral symmetric view (flipX-invariant) |
| fauna-moth-attack | wings up → slam down → wrap-grab → half open | 2x2 / 256 | 1 (copied Image-2 sheet) | 27.35 | 0.038 | strict pass, profile fauna-moth, postureChange (drift 0.287) | 145 / 205 | accepted |
| fauna-grub-walk | Tunnel Grub: LONG low segmented worm, toothed maw, blind | 2x2 / 256 | 0 | 26.00 | 0.039 | strict pass, cv 0.230 (inchworm hump) | 74.3 / 220 | accepted: faces right, clear hump cycle |
| fauna-grub-attack | bunch → rear-up gape → slam → flat | 2x2 / 256 | 1 (frame 4 turned left + height drift) | 29.02 | 0.035 | strict pass, profile fauna-grub, postureChange (drift 0.200) | 89 / 235 | accepted with exception: body tan is lighter than the walk's ochre-brown |

Frame maps: every sheet is 2×2 at 256 px cells, frames 0-3 row-major (`frames/frame-000..003.png`).
Walks loop at 90 ms. Attacks play once at 100 ms. Attack frame 0 = wind-up, 1-2 = strike, 3 = recovery.

## Frame-0 consistency sheet

`art/briefs/reports/fauna-a-frame0.png` (top row: walk frame 0, bottom row: attack frame 0; skitter,
spitter, brute, moth, grub). Persistent attributes match across both actions: facing right (moth symmetric),
eye colour, plate and sac layout, horn side, spout on top. One known drift: the grub attack's body is a paler tan (recorded exception).
`art/briefs/reports/fauna-a-on-steppe.png` shows each walk frame 0 on the steppe floor at PRD sizes,
normalised by LONG EDGE.

## art_review set call (10 sheets, characters index-aligned, renderScale 128)

- `passed: true`, silhouette findings: none.
- Cross-character distances: min **0.080** (skitter walk vs moth walk), then 0.098, 0.111, …, max 0.284.
  Same-character pairs (0.058-0.120) are exempt by scope.
- Warnings, scoped:
  - Spitter and moth: `value-plan-miss:light` (48-71% lights). This is by design: glowing acid and a pale moth.
  - Brute: `value-tier-absent:light` 1.4-1.5% plus dark 58%. This is the known false positive, since the canon ships at 0.4% lights. The brute is PRD `#4f4560`.
  - Skitter attack: `temperature-single` (91% cool). The canon skitter walk measures 77% cool, and the style plan makes fauna cool.
  All are REPORTED, none rejected.

## Figure-ground (scene glass-steppe; cast = 10 fauna-a sheets + 23 landed building sheets from buildings-a and buildings-c; renderScale 128)

```
[glass-steppe] actors: 33 sheet(s) p50=0.2667 p90=0.7527 p99=0.8763
steppe-floor-a  grade ffffff  recessive  meanL 0.0434  p99 0.0691  clash 0.00%  busyRatio 0.07  C1 PASS   EXIT 0
[glass-steppe-night] --grade 8b8896 (approximation of #2c2640 @ 0.55 over white), fields steppe-floor-a/b/c
a 0.00% / 0.07 PASS · b 0.00% / 0.04 PASS · c 0.00% / 0.05 PASS   EXIT 0
[fauna-only] 10 sheets: clash 0.00%, busyRatio 0.08, C1 PASS   EXIT 0
```
The cast is partial in two ways. fauna-b (howler) and buildings-b had not landed, so a re-run after wave 1 is needed.
Per-species check on the darkest actor: brute p50 0.052 vs floor p50 0.042 still passes (0.00%, 0.10×).
It separates on hue (violet vs ochre), the pale rim light and the lime eyes (see the on-steppe image).
Manifest lint after landing: `0 error(s), 0 warning(s)`, exit 0. `gen-art-registry.mjs --check` parses the group
without throwing; it reports "stale", as expected, until the integrator regenerates.

## Wiring contract (for the integrator)

| texture key (manifest) | walk id | attack id | PRD sizePx | walk long edge (px of 256 cell) | walk h mean | cell display size = sizePx·256/longEdge |
| --- | --- | --- | --- | --- | --- | --- |
| fauna-skitter | fauna-skitter-walk | fauna-skitter-attack | 64 | 220 | 143.5 | 74.5 |
| fauna-spitter | fauna-spitter-walk | fauna-spitter-attack | 72 | 184 | 184 | 100.2 |
| fauna-brute | fauna-brute-walk | fauna-brute-attack | 112 | 220 | 135 | 130.3 |
| fauna-moth | fauna-moth-walk | fauna-moth-attack | 72 | 220 | 112.8 | 83.8 |
| fauna-grub | fauna-grub-walk | fauna-grub-attack | 72 | 220 | 74.3 | 83.8 |

- **Normalise by long edge, not by height.** Height normalisation (`displaySizeFor`) would draw the grub
  at 72 px TALL and therefore 214 px long, and the spitter 45 px wide. The PRD sizes are creature sizes.
- Use the same display cell size for walk and attack of a species. Each attack is scale-locked to its walk profile
  (`profileApplied` = the walk's profile), so switching actions does not resize the body.
- `facesRight`: true for all (default; nothing to emit). The moth is symmetric, so flipX is invariant.
- Anchor/origin: bottom-aligned in the cell (moth centred). Walk baselines sit at y ≈ 238/256.
- Outline bake: pass the table's display size as `displayPx` to `teamOutline(key,'hostile', rank)`.

## CRITERIA

- **Retracted: "keep PRD relative sizes IN THE CELL" combined with "fill better than the anchor".** On the canon's own proportions
  this is arithmetically impossible: brute/skitter = 112/64 = 1.75 × the anchor's 145 px long edge = 254 px,
  which is more than 0.92 × 256. Relative size therefore lives at runtime (the table above). Every sheet fills its cell at the same long-edge rule.
- **Rescoped: `bodyScaleCv ≤ 0.08` applies to walkers only.** It was calibrated on the canon skitter walk (0.002). The grub walk (0.230,
  inchworm hump) and moth walk (0.130, wing extents) exceed it by construction. Base walks are not gated on it.
  Attacks with a deliberate posture change (spitter, brute, moth, grub) record their scale figures under
  `qc.postureChange` instead of failing.
- **Measured provider behaviour, not folklore.** Passing the whole accepted walk RAW SHEET as Image 2
  made xai return a near-verbatim copy of the walk on 4 of 5 attack calls (skitter, spitter, brute, moth; visual
  check, and the moth attack re-measured the walk's exact cv 0.1307 and h 112.75). A single-frame 512 px crop (`ref-*-frame0.png`)
  plus "keep identity, NOT its pose" produced real attack poses on 5 of 5 calls. Facing drift appeared on 3 calls
  (grub attack frame 4, spitter attack twice). Stating "face on the RIGHT side in all four frames; never a
  front view" cleared it on the next call. Dividers/borders appeared on 4 calls with "no divider lines" in the prompt.
- **Post-review pixel transforms, not reviewed through (no runtime):** the baked hostile outline
  `#3a1712` at 3/4 px, the night overlay `#2c2640` at α 0.55 (only approximated as a field multiply
  `#8b8896` in figure-ground; the tool cannot grade actors), and display scaling. Reproduce offline
  with `figure-ground.py --grade`. Re-run with the real transform once `core/outline.ts` values are final.
  All of my own transforms (fit, deshadow, deseam, no-guard key) happened BEFORE review, and the images above show their output.

## manifest-delta

```json
{
  "fauna-a": {
    "attempts": {
      "fauna-skitter-walk": 1,
      "fauna-skitter-attack": 2,
      "fauna-spitter-walk": 0,
      "fauna-spitter-attack": 3,
      "fauna-brute-walk": 1,
      "fauna-brute-attack": 1,
      "fauna-moth-walk": 0,
      "fauna-moth-attack": 1,
      "fauna-grub-walk": 0,
      "fauna-grub-attack": 1
    },
    "qcExceptions": [
      { "id": "fauna-spitter-attack", "reason": "3 regens (copy, salmon bg + facing flip, dividers + front view), each a different symptom within the per-symptom budget; the accepted 4th call is a clean right-facing lob; acid droplet dropped by componentMode largest (projectile is fx)" },
      { "id": "fauna-skitter-attack", "reason": "bite reads as a small forward lean with mandibles reaching (low pose amplitude); budget spent on a reference copy and divider lines; seams painted to key before processing (refit.py --deseam)" },
      { "id": "fauna-grub-attack", "reason": "body tan is a step lighter than the walk's ochre-brown; segment layout, blind toothed maw and facing match" }
    ],
    "anchorReprocessed": { "fauna-skitter-walk": "same raw, fit 0.86 align bottom (95 -> 143.5 px); fauna-skitter-scale.json rewritten" },
    "generationPlanFix": "§0.3 marker key is `scale`, not `scaleMode` (scaleMode is silently ignored)"
  }
}
```
