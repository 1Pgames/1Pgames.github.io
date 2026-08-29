# Group report — `gates-collapse` (5/5 accepted)

Owner: `GenGatesUi`. Output root `games/2026-08-29-duskhaul/public/assets/generated/gates-collapse/`.
All 5 have `sprite-sheet.png` on disk. **No asset in this group binds a scaleProfile** (the brief forbids it on
the non-square 2x3, and none of the 2x2s use one) — confirmed by `ls *scale*.json` returning nothing, so the
bound-profile override of `threshold`/`edgeThreshold`/`componentMode` never applied here.

| asset | dir | frames | palette meanDistance | qc.passed | provider | retries |
| --- | --- | --- | --- | --- | --- | --- |
| gate-closed | `gate-closed/` | 1 | 19.69 | true (strict) | codex `.webp` | 3 |
| gate-opening | `gate-opening/` | 6 | 23.74 | true (strict) | codex `.webp` | 2 |
| gate-open | `gate-open/` | 4 | 26.61 | true (strict) | codex `.webp` | 1 |
| gate-closing | `gate-closing/` | 4 | 25.62 | true (strict) | codex `.webp` | 0 |
| collapse-ring | `collapse-ring/` | 4 | 36.34 | strict:false by design | xai `.jpg` | 2 |

Provider read from `sprite-metadata.json.source.file` (authoritative). Where that field reads `raw-source.*`
the sheet was reprocessed in place from its OWN accepted raw in the same dir — not hand-staged — so the raw's
extension still attributes it: `gate-opening`, `gate-open` `.webp` = codex; `collapse-ring` `.jpg` = xai.
Single raw per dir, no stale duplicates (swept).

## Three-state legibility — VERDICT: PASS

`art_review` SET across `gate-closed` + `gate-open` + `gate-closing` at renderScale 48:

- **Silhouettes passed.** Pair distances: closed↔closing **0.443**, closed↔open **0.404**, open↔closing **0.104**.
- **Hue is the primary tell and it separates decisively** — exactly as the brief requires:
  `gate-closed` neutral (warmShare 0.271 / coolShare 0.198), `gate-open` **coolShare 0.602** with warmShare
  collapsed to 0.037, `gate-closing` **warmShare 0.403** with coolShare 0.153. Dead grey / violet / amber
  read apart at a glance.
- The open↔closing silhouette distance (0.104) is the weakest pair, as predicted — both are lit arches with a
  hole. The tells carry it: the descending black bar-teeth row plus the amber/violet hue inversion.
- Verified by eye on a dark HUD ground: **zero violet pixels in `gate-closing`**, zero amber in `gate-open`.
- Value findings: `gate-closed` `value-tier-absent:light` (1.3% vs planned 15%), `gate-open` 3.3%.
  NOT rerolled, per Main's hold — canonical `husk-move` fails the same check harder (0.4%) and every sheet in
  the build runs 80-88% dark against a planned 50, so the plan itself is under review.

## Chain integrity

`gate-closed` was generated first, but the accepted arch master is `gate-opening` frame 1 — the codex 6-frame
grind produced a cleaner arch than the initial takes, so frame 1 was cropped from the ACCEPTED raw and fed as
the identity image to `gate-closed`, `gate-open` and `gate-closing`. `gate-opening` frame 6 was cropped and fed
as the identity/first-frame image to `gate-open`, so **gate-opening f6 chains into gate-open f1 without a pop**.

## NON-DEFAULT PROCESSING — required to reproduce these sheets

`sprite-metadata.json` records `threshold`/`edgeThreshold` as **null** even when non-default, so these params
survive nowhere else on disk. Reproducing from the raw with defaults (180/210) yields a byte-different sheet
with the violet gutted.

- **`gate-opening`** — `--threshold 150 --edge-threshold 150`, all else from metadata `output`
  (`--rows 2 --cols 3 --cell-size 128 --duration 110 --align center --scale fit --fit 0.86 --component-mode all
  --component-padding 0 --min-component-area 1 --feather 0 --max-body-scale-cv 0.08 --max-anchor-y-std 0.05 --strict`).
- **`gate-open`** — `--threshold 150 --edge-threshold 150`, else
  (`--rows 2 --cols 2 --cell-size 128 --duration 130 --align center --scale fit --fit 0.86 --component-mode all
  --component-padding 0 --min-component-area 1 --feather 0 --strict`).
- **`collapse-ring`** — `--threshold 150 --edge-threshold 150 --fit 1.0` (NOT 0.86; 0.86 shrank the full-height
  stripe and destroyed the edge contact the tiling contract needs), else
  (`--rows 2 --cols 2 --cell-size 128 --duration 90 --align center --scale fit --component-mode all
  --component-padding 0 --min-component-area 1 --feather 0`), no `--strict`.

Why 150: dusk-violet sits ~4 units inside the default chroma kill zone. The recovery is **verified real** — both
sprite-sheet md5s changed (`f96b0f→8c5990`, `32f2d6→d74513`) while still passing `--strict`.

## qcExceptions to append

```json
{ "id": "gates-collapse/collapse-ring", "reason": "Seamless vertical dusk-fire curtain segment: the flame must touch the top, bottom and side cell edges to tile around the Collapse circle; strict:false by design (template bg/arena and the zone floor tiles are the precedent)." }
```

## collapse-ring — INTEGRATION-SIDE PROBLEM, escalated

Budget spent (3 generations, one per distinct symptom: bonfire-shape → top-crop-only → both-ends-crop).
Root cause measured, not guessed: **xai never draws flame to a source cell edge.** On the final raw, every one
of the 4 cells reads `nonMagenta topRow = 0/512, bottomRow = 0/512` — the model composes each stripe as a
self-contained framed object with a magenta margin, and three escalating prose assertions ("cropped flat by the
top edge", "flame pixels occupy the very topmost row", "no base, no pool, no floor") did not move it.
It also drew **8 stripes (4 across x 2 down)**, so each 2x2 cell holds 2 stripes rather than 1.

Shipped state: reads unmistakably as a rolling cyan-violet fire curtain with the dried-blood heat line at the
base; frames roll rightward; palette 36.34 (within the profile's 48 ceiling, above `_common.md`'s advisory 36
because of the deliberate cyan lean). Output span 115-118px of 128 after `--fit 1.0`.
**Residual defect: tiled copies show visible gaps** (verified by butting 4 copies side by side) and there is no
true top/bottom edge contact.

Taking Main's offer: this needs an **integration-side fix** — an overlap-tiled draw or a scrolling repeat that
lets the columns overdraw each other will hide the gap that the art cannot close. The asset is good enough to
carry the Collapse's colour language; it is the *seam* that needs code, not a 4th generation.
