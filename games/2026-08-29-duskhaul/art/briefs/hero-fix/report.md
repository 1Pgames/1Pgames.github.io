# hero-fix — loot-sack side consistency (HeroIdleFix)

Tool probe: `generate_image` present (xai-oauth / grok-imagine-image served every call).
Canonical sack side: the VIEWER'S LEFT (hero-run 6/6, hero-hurt, hero-channel).

## Before / after

| sheet | before | after |
|---|---|---|
| hero-idle | f0, f1, f3 had the sack at the viewer's RIGHT hip; f2 held a large dark bowl sack at the viewer's LEFT → sack flipped mid-loop and on every idle↔run switch | all 4 frames: tan-brown flap satchel with gold coin emblem on a chest strap, VIEWER'S LEFT hip (matches run); subtle breathing sway (hood drop ≤ ~6 output px) |
| hero-death | f0–f3: large dark sack at the viewer's RIGHT front hip (f2 spills coins there); f4–f5 no sack | f0–f3: satchel on VIEWER'S LEFT (f1 swings out, f2 coins pour from it to the left boot, f3 emptied/limp); f4–f5 byte-identical to original raw |
| hero-extract | all 6 frames: violet-tinted sack at the viewer's RIGHT front hip | all 6 frames: violet-tinted satchel on VIEWER'S LEFT, original teal→blue→glow tint progression kept |

Originals: `orig/hero-idle/`, `orig/hero-death/`, `orig/hero-extract/`, `orig/hero-scale.json`.
Visual proof: `transition-check.png` (idle f0 · run f0 · hurt f0 · death f0 · extract f0 — sack left in all).

## Method

Per-frame edits (v2-enemies CRITERIA method; anchor-guide route not used), single input image per call —
a first idle-base attempt with 3 inputs (idle f2 + run f0 + vision-1) FUSED two figures and was rejected.

- idle: base = edit of original idle f2 (raw cell crop, 627px) changing only the sack → `raw-frames/idle-base.jpg`;
  f1/f2/f3 = pose edits of that base. Assembled translation-only (`tools/assemble.py`, side 1016 so
  outputSubjectHeight matches the original 177.5) → `raw-idle-2x2.png`, processed by `tools/proc.sh`.
- death/extract: each original raw cell (341x512) edited in place; the edits kept framing (normalised
  bbox within ~0.01, `tools/bbox.py`), so each is resized uniformly back to its source cell and spliced
  into a copy of the original raw at the original cell box (`tools/splice.py`) → `raw-*-2x3.png`,
  processed by `tools/proc-2x3.sh` with the original params (unbound, no profile).

## Per-asset table

| id | frames/cell | src cell | ms | palette meanDistance (≤48) new / orig | bodyScaleCv | anchorYStd | outputSubjectHeightMean new / orig | regenerations | exception |
|---|---|---|---|---|---|---|---|---|---|
| hero-idle | 4 / 256 (2x2) | 1016 (was 627) | 150 | 23.60 / 23.51 | 0.0132 | 0.0005 | 177.75 / 177.5 | base 1, f2 1, f3 2 | none |
| hero-death | 6 / 256 (2x3) | 341x512 (same) | 100 | 22.75 / 22.81 | 0.0099 | 0.0342 | 154.83 / 154.33 | f0 1 | none |
| hero-extract | 6 / 256 (2x3) | 341x512 (same) | 110 | 31.45 / 29.12 | 0.0031 | 0.0332 | 153.67 / 153.83 | f3 1, f4 2 | none |

No asset/frame reached 3 attempts; no `qcExceptions[]` needed. `art/manifest.json` untouched (not in this
agent's ownership); rejected attempts archived in `raw-frames/*-a*.png|jpg`.

QC: strict export passed all three (0 empty / edge-touch / clamp). Preflight on assembled raws: edgeKeyFraction 1.0,
foreignRegionCount 0, no geometryMismatch (idle cell 1016x1016 aspect 1). Notes: death drops 162 px and
extract 273 px of detached components under `componentMode: largest` (loose coins / dissolve motes) — same
mode as the originals. Magenta-ish fringe pixels: idle 8/57192, death 8/58058, extract 4/61169 (originals 4, 14, 13).
art_review: all passed; warnings `value-plan-miss:dark/mid` also present on the original idle and on hero-run
(canon), `value-tier-absent:light` on extract (0.6%) is the known canon false positive (REPORTED, not rejected).

## Wiring contract

Unchanged keys/files: `hero-idle` (4f, 150 ms, loop, 2x2 → 256 cells), `hero-death` (6f, 100 ms), `hero-extract`
(6f, 110 ms); each dir holds `sprite-sheet.png`, `frames/frame-00N.png`, `sprite-metadata.json`, `animation.gif`,
`raw-source.webp` (lossless; idle's was .webp before, death/extract were .jpg — raws are not read by the registry).
Frame order row-major. Output geometry unchanged (256 cells, feet line y≈241-242 same as before).

`hero-scale.json` rewritten by the idle export (writeScaleProfile, profileName hero): processing block identical;
reference now sourceCellWidth/Height 1016, sourceToOutputScale 0.2167, bodyScaleMean 0.8073 (was 0.8070),
outputSubjectHeightMean 177.75 (was 177.5). No sibling currently binds it at export time.

Registry (`node scripts/gen-art-registry.mjs`, then `--check` → up to date): only per-action `scale` values moved,
because the base height moved 177.5 → 177.75: hero-run 1.121→1.123, hero-hurt 1.109→1.111,
hero-channel 0.937→0.938, hero-death 1.15→1.148, hero-extract 1.154→1.157.

## CRITERIA

- No criterion retracted or rescoped.
- Post-review pixel transforms: none added. The splice resize (uniform, aspect-preserving, back to the
  source cell) and the translation-only idle assembly happen BEFORE processing/review and are reproducible
  from `raw-frames/` + `tools/`. Runtime per-action `scale` from the registry is a uniform size factor only.
