# Group report — `ui-icons` (3/3 accepted)

Owner: `GenGatesUi`. Output root `games/2026-08-29-duskhaul/public/assets/generated/ui-icons/`.
`icons` ships `sprite-sheet.png`; the two 1x1 assets ship `sprite.png` + `sprite-sheet.png`. No asset in this
group binds a scaleProfile.

| asset | dir | frames | palette meanDistance | qc | provider | retries |
| --- | --- | --- | --- | --- | --- | --- |
| icons | `icons/` | 16 | 19.53 | pass w/ documented deviations | codex `.webp` | 1 |
| emblem | `emblem/` | 1 | 23.34 | true (strict) | xai `.jpg` | 0 |
| bg-menu | `bg-menu/` | 1 | 13.67 | strict:false by design; **minAlpha 255** (full-bleed, fixed) | xai `.png` | 4 |

Provider from `sprite-metadata.json.source.file`. `icons` reads `raw-source.webp` because it was reprocessed
in place from its own accepted raw (md5-verified identical to the accepted `omp-image-…webp` temp) — codex.
**New census datapoint: `.png` is also xai** (returned for both 9:16 `bg-menu` runs), so the proxy is
`.jpg`/`.png` = xai, `.webp` = codex. Single raw per dir, no stale duplicates (swept).

## icons — index map (BINDING, matches `art/manifest.json.icons[]`)

Verified glyph-by-glyph against the exported sheet, reading left-to-right then top-to-bottom:

| # | name | rendered glyph | colour |
| --- | --- | --- | --- |
| 0 | `shard` | chipped triangular wedge, one bright facet | gilt `#d9a24b` |
| 1 | `relic-t1` | plain squat open ring + tooth nub, no aura | tarnished `#a5a38b` |
| 2 | `relic-t2` | ring inside ONE thin aura ring | burnished `#835d2f` |
| 3 | `relic-t3` | ring inside aura ring + 4 spokes at N/E/S/W | gilded `#f3ca67` |
| 4 | `relic-t4` | ring inside THICK aura + red pinprick centre | dread `#ad6eef` + `#c0392b` |
| 5 | `casket` | rounded reliquary box, keyhole clasp, hasp nub | bone ink |
| 6 | `gate-arrow` | stubby right chevron, tail through tiny archway | dusk-violet `#5b4bff` |
| 7 | `pause` | two thick vertical bars, squared ends | bone ink |
| 8 | `gear-blade` | broken sickle blade, edge up, short grip | bone ink |
| 9 | `gear-shroud` | hooded cowl front-on, hood mouth black | bone ink |
| 10 | `gear-trinket` | teardrop pendant on 3 chain links | bone ink |
| 11 | `zone-castle` | crenellated keep spire, one arrow-slit | bone ink |
| 12 | `zone-outlands` | three ribcage arcs off a short ground line | bone ink |
| 13 | `zone-desert` | half-buried statue head over two dune curves | bone ink |
| 14 | `zone-winter` | jagged six-point ice crystal, one arm broken | bone ink |
| 15 | `skull` | blunt front-on skull, two black sockets, no jaw | bone ink |

Tier ladder uses the ART-LOCKED §11 literals supplied mid-wave (`#a5a38b`/`#835d2f`/`#f3ca67`/`#ad6eef`), NOT
the brief's original gilt/violet, so the generated glyphs match the procedurally-drawn HUD bag pips.
Scope law honoured: no plate, frame, pill, badge, bar housing or backing anywhere; no lettering or digits.

### 40px accept gate — PASS
Downscaled all 16 to 40px on the `#1a1520` HUD ground and inspected. **No glyph becomes a blob**; all 16
silhouette classes stay distinct, and the four `relic-t*` read apart purely on aura as intended
(none / thin bronze / gilded+spokes / thick violet+red core).
Known cosmetic: `relic-t3`'s spokes render slightly OUTSIDE the aura ring, so it reads a little like a
crosshair/gunsight rather than a spoked relic. Legible and tier-correct, off-language by a hair — logged, not
rerolled (budget better spent on the two missing assets). One ~4px stray speck survives under `gear-trinket`.

## art_review

- **SET (`icons` + `emblem`) at renderScale 48:** silhouettes **passed**, pair distance **0.443**.
  `icons` passed (value dark .395 / mid .101 / light .504, spread .937 — light-heavy because bone ink IS the
  glyph body; warns only). `emblem` failed `value-tier-absent:light` (1.7%) and warns `temperature-single`
  (92% cool) — not rerolled per Main's value-tier hold.
- **`bg-menu` single (re-run on the SHIPPED opaque 1080x1920 sheet):** **passed** — dark .858 / mid .095 /
  light .047, spread **0.725** (was spread 0.301 with 0% lights before the value fix). Warns only on
  dark/mid plan miss, which every sheet in the build shares.

## bg-menu — anchor dominance (the group's real finding)

Attempts 1-3 with `styleProfile` set returned the **vision-1 hooded reaper on dull pink**, growing larger with
each added negation; attempt 3 also invented runic lettering the prompt explicitly banned. With a reference
appended, xai behaves as image-to-image, and a landscape shares no structure with a hooded-figure anchor, so it
redraws the anchor. **Not fixable in prose.**
Fix: **dropped `styleProfile` from this marker only**, carrying style in prose (palette hexes, value tiers,
"chunky pixel art, hard square pixels, visible pixel grid, flat banded fills, two-step dithering, no
anti-aliasing"). Correct first try. Now build-wide policy for tiles and backdrops.
Attempt 4 was content-correct but measured `value-spread-flat` (spread 0.301, 0% lights, 99.5% dark) — a
monotone image. Attempt 5 added an explicit three-step dark/mid/light build with a BROAD bright horizon band;
spread 0.301→0.725, lights 0.0%→4.6%, all fails cleared.
Shipped: quiet dark upper sky, bright pale horizon band, wide amber cloud break right, ruined keep left,
mudflats + dry riverbed, three violet gate pinpricks, near-black headstone/gibbet ridge. No figure, no text.

### FULL-BLEED FIX — `minAlpha` 0 → 255 (zero regenerations)
`bg-menu` initially shipped with a transparent margin (`minAlpha 0`), the same `fit: 0.86` inset that broke the
zone tiles — the page would have shown through at the menu edges.

**Main's prescribed tile fix does NOT work for a PORTRAIT asset.** Measured: `--fit 1 --align center
--scale fit --allow-source-edge-touch` returned **1536x1536, minAlpha 0**, and so did `--scale preserve` and
`--threshold 0 --edge-threshold 0`. Cause: for a 1x1 export the processor always emits a SQUARE `cellSize`
canvas and letterboxes the image into it — content measured at cols 336-1199 of 1536 (864/1536 = 0.5625,
i.e. the 9:16 content was intact but padded with transparent side bars). That works for the zone tiles only
because they are square; it cannot produce a portrait full-bleed sheet.

Fix used — deterministic resample of the accepted raw, no painting, no regeneration (same class as the
sanctioned `border-inner.png` intermediate route):
`raw-source.png` (1584x2816, exactly 9:16) → `Image.NEAREST` resize to **1080x1920** → `sprite.png` +
`sprite-sheet.png`. NEAREST preserves the hard pixel edges; 1080x1920 is exactly 9:16.

EXACT REPRODUCIBLE COMMAND (metadata will not carry this either — it still describes the discarded 1536
square, so treat this block as the authoritative recipe for `bg-menu`):

```sh
cd games/2026-08-29-duskhaul/public/assets/generated/ui-icons/bg-menu
python3 -c "
from PIL import Image
out = Image.open('raw-source.png').convert('RGB').resize((1080, 1920), Image.NEAREST).convert('RGBA')
out.save('sprite.png'); out.save('sprite-sheet.png')
"
```

Do NOT run `process-sprite.ts` on this asset: every flag combination tried
(`--fit 1 --align center --scale fit --allow-source-edge-touch`, `--scale preserve --fit 1`, and
`--threshold 0 --feather 0 --edge-threshold 0 --no-preflight`) returned a 1536x1536 SQUARE sheet at
`minAlpha 0`, because a 1x1 export always emits a square `cellSize` canvas and letterboxes into it.
**Note the brief's stated `1024x1792` is actually 4:7 (0.5714), not 9:16 (0.5625)** — using it verbatim would
have vertically distorted the backdrop, so 1080x1920 was used to honour the manifest's `aspect_ratio: "9:16"`.
Verified after: size 1080x1920, aspect 0.5625, **minAlpha 255**, palette 13.67, `art_review` **passed**
(dark .858 / mid .095 / light .047, spread 0.725).
`collapse-ring` and the 5 gate/icon sprites stay at `minAlpha 0` — correct for their class, confirmed by Main.

### READABILITY HANDOFF (mandatory) — for ArtDirector + ui-engineer
`bg-menu` is a **text-over-art surface**. The menu title, the 4 zone cards (640x150 from y 420) and the PLAY
button all sit on it and need the §11 text-armour / scrim treatment. Measured row-mean luminance by % height
on the shipped 1080x1920 sheet:

| band | 0-30% | 30-40% | 40-45% | 45-50% | **50-55%** | 55-60% | 60-70% | 70-100% |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mean luma | 15 | 22-36 | 65 | 120 | **181 (peak)** | 91 | 50-61 | 6-15 |

- **Safe:** 0-30% (luma 15) and 70-100% (luma 6-15) are genuinely dark. Title and crest at the top are fine.
- **COLLISION:** the bright band runs **45-60%, peaking 181 at 50-55%**. Four 150px cards stacked from y 420
  span y 420-1020 = **21.9%-53.1%**, so the **3rd and 4th cards land in the bright band** and bone-parchment
  text over them will lose contrast. Those two cards specifically need a scrim or darkened plate.
- `emblem` measures 92% cool and only 1.7% lights, i.e. a DARK crest. Composited over this dark backdrop it
  risks a low-contrast mark — it likely needs a rim, glow or scrim of its own rather than sitting raw.
Flagged, not fixed in this group, per the brief.

## NON-DEFAULT PROCESSING — required to reproduce `icons`

`sprite-metadata.json` records `threshold`/`edgeThreshold` as **null** even when non-default. `icons` needs:

`--rows 4 --cols 4 --cell-size 256 --duration 120 --align center --scale fit --fit 0.86 --component-mode all
--component-padding 0 --min-component-area 60 --threshold 120 --feather 0 --edge-threshold 120
--allow-source-edge-touch --no-preflight --strict`

Three deliberate deviations, each with a reason:
1. **`--threshold 120 --edge-threshold 120`** (not 150) — per Main's ruling, the art-locked Dread literal
   `#ad6eef` is magenta-LEANING and computes dist 138 / minRB-g 63, so it is eaten even at 150. 120 preserves
   the locked hex; pure magenta is distance 0 so the field still keys with wide margin. Verified: the t4 aura
   exports as full violet with its red centre dot intact.
2. **`--allow-source-edge-touch --no-preflight`** — 4 glyphs (cowl, pendant, statue head, ice crystal) touch
   their source cell edges. NOT a strict relax to hide clipping: every glyph is complete, the field is
   genuinely pure magenta (`edgeKeyFraction 1.0`, `keyedFraction 0.744`), and the 2 reported "foreign regions"
   were glyph geometry crossing cell lines, not background contamination.
3. **`--min-component-area 60`** — removes cross-cell bleed specks while preserving the t4 red pinprick, both
   `pause` bars and all 3 `gear-trinket` chain links (visually confirmed post-filter).

`bg-menu` carries no `styleProfile` in its marker by design (see above) and its existing
`ui-icons/bg-menu` qcException already covers `strict:false` — no duplicate added.
