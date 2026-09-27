# terrain — group report (owner ArtTerrain)

**Tool probe (rule 0):** `generate_image` 1024² throwaway, no marker → `xai-oauth / grok-imagine-image`, OK.
QC devices used: `sprite_check_palette`, `art_review`; set gate `figure-ground.py`; `manifest-lint.py` exit 0 (0 errors, 0 warnings, read-only run).

**Status: 16/16 ids landed** in `public/assets/generated/terrain/<id>/` (complete group copied from the
staging dir `art/exports/terrain/`; `steppe-floor-a` is the accepted anchor copied in unchanged). No ids missing.

## Method

- **Floors** (12, `1x1`, full-bleed, cell 512): marker `{"profile":"hd-fx","cellSize":512,"duration":0,"fullBleed":true,"threshold":1,"edgeThreshold":1}`, **no `styleProfile`** (so the vision anchor is not appended). Every floor passes an accepted SIBLING tile as explicit Image 1: `steppe-floor-a` for steppe b/c and for each other biome's `-a`; that biome's accepted `-a` for its `-b`/`-c`. Visually confirmed: no vision-anchor subject redrawn into any tile.
- **xai frame strip:** `art/tools/deframe.py` worked on 2 tiles (steppe-a, nacre-a) and **crashed on 3** (`ValueError: Coordinate 'right' is less than 'left'`): its 8 scan lines sit at `h*(k+1)/9`, so a frame wider than ~113 px (measured 137-250 px this wave) puts the first scan line inside the top band and the inset runs to w/2. It also missed ember-a's darker frame `rgb(205,42,118)` (its `b>150` relation fails). Scratch replacement **`art/exports/terrain/deframe_bbox.py`** measures the frame per ROW/COLUMN (≥50% frame pixels), relation `r>150, r-g>100, b-g>50, g<120`, crops +3 px inset to a centred square and re-runs `process-sprite.ts` with the same full-bleed params as deframe.py. Owner of `art/tools/deframe.py`: please adopt the row/column scan (I did not edit the shared tool).
- **Blockers** (4, `3x3`, `hd-fx`, cell 256): actor calls, `styleProfile` in marker (vision anchor auto-appended as Image 1), fixing clause, per-cell silhouette brief, `threshold 150`, then `art/tools/rekey.py`. `metadata.output.scaleMode = fit` (hd-fx centred fit; ArtBuildingsB's `scaleMode`-key warning does not apply — no scale key was passed).

## Per-asset table

L* measured on the shipped `sprite.png` (128² sample): p5 / mean / p95. Target band L* 18-32.
`meanDistance` = `sprite_check_palette` vs `art/style.json` (max 52). regens = regenerations (manifest `attempts`).

| id | intent | grid / cell | L* p5/mean/p95 | mean hex | meanDistance | frame stripped | regens | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| steppe-floor-a | anchor (unchanged) | 1x1 / 512 | 21.0/24.6/29.0 | #4d351a | 13.81 | 85 px (anchor pass) | 1 (anchor pass) | — |
| steppe-floor-b | ochre dust, soft blotches | 1x1 / 512 | 21.7/25.2/29.4 | #503619 | 14.64 | 184-185 px | 0 | |
| steppe-floor-c | ochre dust, wind streaks | 1x1 / 512 | 21.3/24.8/29.2 | #4f351a | 14.07 | 183-189 px | 0 | |
| rime-floor-a | cold slate frozen soil | 1x1 / 512 | 21.2/25.4/30.2 | #333d44 | 18.15 | none | 1 | 1st take p95 36.4 (bright blue haze) → "one step lighter only" brief |
| rime-floor-b | slate + hairline frost veins | 1x1 / 512 | 22.1/26.5/31.6 | #354047 | 15.50 | 249-250 px | 0 | |
| rime-floor-c | slate + drifted rime dust | 1x1 / 512 | 21.2/25.6/30.9 | #333e45 | 17.24 | 168 px | 0 | |
| ember-floor-a | ash-brown marsh mud | 1x1 / 512 | 22.8/26.1/29.2 | #493a2f | 16.77 | 31 px top/bottom (dark pink) | 0 | |
| ember-floor-b | mud + damp patches | 1x1 / 512 | 23.0/26.7/30.5 | #4c3b2f | 16.96 | 230-233 px | 0 | |
| ember-floor-c | mud, shapeless blotches | 1x1 / 512 | 22.9/26.0/29.2 | #4a3a2e | 16.39 | 134-136 px | 2 | take 1: concentric ripple rings (repeats visibly); take 2: magenta vignette bled into the art at the edges; take 3 clean (edge mean = centre mean, 74,58,47) |
| nacre-floor-a | dark pearl-sand shore | 1x1 / 512 | 22.9/26.6/31.1 | #3d3f3e | 16.38 | 39-48 px | 0 | |
| nacre-floor-b | pearl-sand, blotches | 1x1 / 512 | 22.1/25.9/30.7 | #3c3d3d | 16.64 | 24-43 px | 1 | 1st take p95 34.4 (lavender sheen patch) |
| nacre-floor-c | pearl-sand, damp patches | 1x1 / 512 | 22.8/26.6/31.2 | #3d3f3e | 17.82 | none | 1 | 1st take diagonal ripple streaks (hard directional feature) |
| steppe-blockers | 9 sandstone/glass outcrops | 3x3 / 256 | — | — | 22.19 | — | 0 | outlierFraction 0.025 |
| rime-blockers | 9 slate/ice outcrops | 3x3 / 256 | — | — | 41.24 | — | 0 | outlierFraction 0.243: the frost-blue ice crusts; the list has one cold blue (#7d93b8) — fact about the LIST (rule 10), not a defect |
| ember-blockers | 9 basalt outcrops | 3x3 / 256 | — | — | 25.57 | — | 1 | 1st take: 5 within-biome silhouette collisions (squat masses) + 3 frames value-spread 0.31 (near-black) → aspect-ratio silhouette brief + lit top faces |
| nacre-blockers | 9 pearl/nacre shell-rock | 3x3 / 256 | — | — | 26.17 | — | 0 | |

Every floor: `qc.passed true`, strict, `minAlpha 255`, surviving pink px 0, provider `xai-oauth`
(`sprite-metadata.json.source.provider`), opposite-edge seam diff 2.6-4.8 (8-bit mean). All 12 floors sit inside
L* 18-32 at p5 and p95, i.e. the whole value distribution is in band, not just the mean.

**Biome blend:** within each biome the three tiles share mean colour within 3/255 per channel
(`_qc/floors-contact.png`, `_qc/blend-contact.png`: random a/b/c at 64 px, 10×10) — no visible seam or
hard feature between variants. **Reported, not rejected:** at 64 px each tile's own internal
~2×2 period (inherited from the accepted anchor, which has the same property) reads as a fine regular weave.
The canon has it, so it is not a rejection criterion here; the integrator can soften it by drawing the
512 texture at 128-256 px per repeat or by random 90° rotation/flip per cell.

Failed calls that were **not** generations: one parallel batch of 7 returned `urlopen error [Errno 49] Can't assign
requested address` (local socket exhaustion); single and 3-way parallel retries succeeded. Bisect: concurrency, not
prompt/input/marker. Filed via `xd://report_issue`. Not counted in `attempts`.

## Frame map (blockers; icons[] order = frame order, row-major)

| frame | steppe | rime | ember | nacre |
| --- | --- | --- | --- | --- |
| 0 → *-block-1 | tall rock spire + glass | frozen spire | needle spire | curved nacre spire |
| 1 → *-block-2 | flat-topped mesa | flat slate shelf | wide flat slab | layered pearl shelf |
| 2 → *-block-3 | leaning slab pair (A-frame) | leaning ice-glazed slab | rock arch w/ hole | fan shell rock |
| 3 → *-block-4 | domed boulder | frost-capped boulder | round pumice ball | polished pearl sphere |
| 4 → *-block-5 | stepped cliff chunk | cliff chunk + icicles | L-shaped cliff wall | stepped pearl cliff |
| 5 → *-block-6 | low long ridge | low frozen ridge | long diagonal ridge | wave-worn ridge |
| 6 → *-block-7 (spare) | pillar crowned with violet glass | blue ice column | crater cone | conch tower |
| 7 → *-block-8 (spare) | split boulder | split boulder w/ ice | horned rock — **reads as a fossil horned skull** | split geode w/ violet interior |
| 8 → *-block-9 (spare) | tiered butte | tiered frozen butte | mushroom rock | tiered nacre butte |

Note on ember-block-8: the provider drew a horned skull-shaped outcrop, not a plain rock. It is a single solid
object, inked, on-palette, and fits PRD §11 props ("bones"); it sits in a spare slot. Mapgen may weight it low or
skip it; no third regeneration was spent on a spare cell.

## Coverage (content id → art)

All 36 terrain ids of manifest group `terrain` have art: 12 floor textures (`<biome>-floor-{a,b,c}` → `sprite.png`
512²) and 36 blocker frames (`<biome>-block-{1..9}` → `<biome>-blockers/sprite-sheet.png` frames 0-8, 256² cells).
Zero placeholders. Not applicable to this group: weapon/evolution world fx, character frame-0 consistency sheets
(no multi-action characters here).

## Wiring contract

- Floors: texture key per registry from `terrain/<biome>-floor-<v>`, file `sprite.png` 512×512 opaque (minAlpha 255),
  seamless-ish; intended at a 64 px world tile (PRD §11 "feather-blended" variants). All three variants of a biome are
  interchangeable per cell.
- Blockers: `terrain/<biome>-blockers/sprite-sheet.png`, 3×3 grid of 256² cells, frame i ↔ `<biome>-block-(i+1)`,
  hd-fx centred fit (not feet-anchored): place each frame's visual centre on its footprint centre. Use frames 0-5 as the
  six required blockers, 6-8 as spares (see collisions below).
- `scaleMode fit` (hd-fx): relative size between cells is preserved within a sheet only.

## Set gates

### figure-ground.py (fields = the 3 floors of each biome)

Primary run — the cast the brief named (building anchors core + drill + pulse, skitter), renderScale 128, no grade:

```
python3 figure-ground.py --render-scale 128 --manifest art/manifest.json \
  --scene glass-steppe --actors <core sprite.png, drill-mk1 sprite-sheet, pulse-mk1 sprite.png, skitter-walk sheet> --fields steppe-floor-{a,b,c} \
  --scene rime-basin ... --scene ember-mire ... --scene nacre-coast ...
actors: 4 sheets, 207497 opaque px, luma p50 0.2806 p90 0.7541 p99 0.8728
all 12 fields: read recessive, clash 0.00%, busyRatio 0.05-0.08, C1 PASS (field p99 0.069-0.089 <= 0.4364)
set spread: meanL 0.043..0.050, busy 0.756..1.260, clash 0..0, busyRatio 0.048..0.080  -> EXIT 0
```

Extended run — `art/exports/terrain/fg_night.py` (repro script): every building/fauna sheet on disk at run time
(58 sheets from buildings-a/-b/-c and fauna-a/-b, in-flight, not signed off) + that biome's blocker sheet = 59 sheets,
through each post-review transform:

| transform | actor p90 | field clash% | busyRatio | C1 | exit |
| --- | --- | --- | --- | --- | --- |
| day (none) | 0.734-0.738 | 0.00 (all 12) | 0.043-0.072 | PASS | 0 |
| night overlay #2c2640 α0.55 on actors AND floor | 0.197-0.198 | 0.00 | 0.033-0.057 | PASS | 0 |
| lit ground +12% (floor only) | 0.734-0.738 | 0.00 | 0.048-0.080 | PASS | 0 |

No FAIL, so nothing regenerated for figure/ground. The final cast is still the integrator's: re-run
`fg_night.py` after wave 2 (it globs whatever is on disk).

### art_review

- Group set call (16 assets, renderScale 128): floors report `value-spread-flat` FAIL (spread 0.08-0.11) — see
  CRITERIA, retracted for this population. Cross-sheet silhouette 0.048 rime-blockers vs ember-blockers — whole 3×3
  atlas compared as one silhouette; rescoped to per-cell (below).
- Per-cell silhouette (renderScale 64, each cell its own character), within-biome collisions < 0.05:
  - steppe: block-1 ↔ block-7 0.041 (spire vs glass-crowned pillar — both tall; block-7 spare)
  - rime: block-4 ↔ block-8 0.025 (round boulder vs split boulder; block-8 spare)
  - nacre: block-3 ↔ block-4 0.049 (fan shell vs sphere; distinct by the scalloped rim at 128 px, borderline at 64)
  - ember (after regen): 0 collisions, min pair 0.079.
  Cross-biome same-index pairs (e.g. rime-1 ↔ ember-1 0.025) are by construction the same archetype in two
  biomes that never share a scene; not gated (see CRITERIA). Remaining within-biome pairs are written as
  qcExceptions in the delta below.
- Blocker value plan: warnings only (`value-tier-absent:light`, dark share > plan) — rock is dark by material;
  nacre runs 40-60% lights (pearl). Scoped as warnings per rule 10.

## CRITERIA

1. **Retracted for full-bleed floors: `art_review value-spread-flat`.** Population: floor tiles bound to the L* 18-32
   band. The accepted anchor `steppe-floor-a` measures spread 0.09 and FAILS it; the band itself caps the lightness
   span near 0.14, so the rule cannot pass any in-band floor. The anchor pass rerolled the first floor on this
   criterion (0.03); that reroll fixed a real flatness, but the rule as a reject line rejects canon. Floors are
   judged by L* band + figure-ground instead. Still valid (and used) on blocker sprites.
2. **Rescoped: `silhouette-collision` on 3×3 atlases.** Calibrated on character sheets; applied to a whole atlas it
   compares nine-object layouts, not objects. Scope for this group: per cell, within one biome (one scene).
3. **Not a reject: `meanDistance` on rime-blockers (41.24, outliers 24%).** The list holds one cold blue; the
   profile's own temperature line gives Rime the frost blue. Under 52, recorded as a fact about the list.
4. **Folklore check:** none invoked; one provider served every call (xai-oauth), so no provider comparison.
5. **Post-review pixel transforms reviewed through:** night overlay (#2c2640 α0.55, world camera, actors + floor),
   lit ground +12% (floor). Repro: `art/exports/terrain/fg_night.py` (writes graded copies to `_qc/graded/`).
   Not reproduced: the runtime fauna outline #3a1712 (adds dark px to actors; lowers actor p90 slightly — clash
   margin is 0.00% vs a boundary ~8× above field p99, so no plausible outline shifts the verdict) and the building
   dim-to-night tint (values not final in `src/`).

## Text-over-art surfaces

None introduced: floors are dark (L* ≤ 32) and recessive. Floaters over nacre/rime floors keep the §3 text armour.

## manifest-delta

```json
{
  "group": "terrain",
  "attempts": {
    "steppe-floor-b": 0, "steppe-floor-c": 0,
    "rime-floor-a": 1, "rime-floor-b": 0, "rime-floor-c": 0,
    "ember-floor-a": 0, "ember-floor-b": 0, "ember-floor-c": 2,
    "nacre-floor-a": 0, "nacre-floor-b": 1, "nacre-floor-c": 1,
    "steppe-blockers": 0, "rime-blockers": 0, "ember-blockers": 1, "nacre-blockers": 0
  },
  "profileNote": "blockers were exported hd-fx (centred fit), manifest kind says body; set kind fx or keep body but note hd-fx",
  "qcExceptions": [
    { "id": "steppe-blockers", "reason": "art_review per-cell silhouette block-1 vs block-7 0.041 at 64px: both tall pillars, block-7 is a spare and differs by its violet glass crown" },
    { "id": "rime-blockers", "reason": "art_review per-cell silhouette block-4 vs block-8 0.025 at 64px: round vs split boulder, block-8 is a spare and reads distinct by its blue ice seam; meanDistance 41.24 from the frost-blue ice the palette list covers with one hex" },
    { "id": "nacre-blockers", "reason": "art_review per-cell silhouette block-3 vs block-4 0.049 at 64px: fan shell vs pearl sphere, distinct by the scalloped fan rim at 128px" }
  ]
}
```

## Files

- Landed: `public/assets/generated/terrain/{steppe,rime,ember,nacre}-{floor-a,floor-b,floor-c,blockers}/`
- Staging + raws: `art/exports/terrain/<id>/` (`raw-source.jpg`, `raw-cropped.png`, `sprite-metadata.marker.json`)
- Scratch tools (repro): `art/exports/terrain/deframe_bbox.py`, `tilestats.py`, `fg_night.py`
- QC images: `art/exports/terrain/_qc/` (`floors-contact.png`, `blend-contact.png`, `blockers-on-floor.png`, `ember-blockers-on-floor.png`, `*-2x2.png`)
