# Cover V2 (refined build key art)

- Shipped: `public/cover.png` (1024x1536, from `art/exports/cover/sprite.png`; raw `art/exports/cover/raw-source.png`, 1776x2368, ratio 0.750).
- V1 (AI build, byte-identical to `games/2026-08-29-duskhaul-ai/public/cover.png`): kept at `art/briefs/cover-v1/cover.png`.
- Provider: xai-oauth / grok-imagine-image. Style lock: `art/style.json` (duskhaul-grit) prose + anchor `art/refs/vision-1.png`.
- References: `public/cover.png` (V1: hero identity, finish), `ref-shots.png` (hstack of `shots/02-run-horde.png` + `shots/04-evolution.png`, built with ffmpeg so all three references fit xai's 3-image cap with the vision anchor).

## Attempts
0. Marker-style call with the sprite magenta background contract in the prompt: came back framed in a pink/magenta sky + border. Discarded (the sprite contract is wrong for a full-bleed illustration).
1. `attempt-1.png` — text call, inputs V1 cover + ref-shots + vision-1. Good composition; far gate an unlit iron portcullis (no violet read).
2. `attempt-2.png` — edit of attempt 1 (Image 1 = attempt-1, Image 2 = vision-1): gate now a blazing violet portal. ACCEPTED.

Processing (CLI fallback, since the export middleware injects the magenta contract):
`process-sprite.ts --input attempt-2.png --output art/exports/cover --cell-size 1024 --cell-height 1536 --duration 0 --full-bleed --threshold 1 --edge-threshold 1 --style-profile art/style.json --preserve-raw --source-provider xai-oauth`
→ qc.passed true, waived [], note `background-contamination-waived:full-bleed`, minAlpha 255.

## QC
- sprite_check_palette: meanDistance 28.27 (max 48), outlierFraction 0.135 — passed.
- art_review: passed; value dark 0.843 / mid 0.147 / light 0.010, spread 0.452 (V1: 0.925/0.060/0.015, spread 0.588). Warnings value-tier-absent:light + value-plan-miss are the known canon false positive (V1 fails them harder); silhouette metrics exempt (full-bleed).
- Card size: `card-220.png` — gate, burst, green-rimmed hero and red-rimmed horde all read at 220 px wide.
