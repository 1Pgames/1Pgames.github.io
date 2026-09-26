#!/usr/bin/env bash
# Reproduces every floors-v2 full-bleed export offline (floors, roads) from its provider raw.
# Run from games/2026-08-29-duskhaul/:
#   art/briefs/v2-world/process-fullbleed.sh <provider-raw.jpg> <outDir> [--mean 25] [--lo 14] [--no-crop] [--cell 256] [--crop-min 768] [--crop-max 1024]
# floor-castle-c: --crop-min 760 --crop-max 820 (stone pitch 27px at full crop -> ~34px).
# Roads: --mean 22.5 --lo 6 (PRD-V2 §3.7 road luminance -10% vs floor).
#
# Steps (all deterministic, nothing painted):
#   1. provider raw copied in as raw-provider.jpg (true provenance; the provider was xai).
#   2. world.py bestcrop  -> crop.png   seamless square window (region selection only).
#   3. world.py tonefit   -> graded.png PRD-V2 §3.7 value band (L* mean 25, span 14..36,
#                                      mean HSL sat <= 0.22, forbidden hues clamped to sat 0.30).
#   4. sprite-forge process-sprite.ts on graded.png: 256 cell, full-bleed, threshold 1 / edge 1
#      (magenta-less raw), smooth sampling, styleProfile bound; graded.png preserved as
#      raw-source.png and named in sprite-metadata.json source.file.
# The shipped sprite.png is what art_review / figure-ground measured; FLOOR_GRADE multiplies it
# at runtime and is reviewed separately (see ArtWorld.progress.md CRITERIA).
set -euo pipefail
RAW="$1"; OUT="$2"; shift 2
MEAN=25; LO=14; CROP=1; CELL=256; CMIN=768; CMAX=1024
while [ $# -gt 0 ]; do
  case "$1" in
    --mean) MEAN="$2"; shift 2;;
    --lo) LO="$2"; shift 2;;
    --crop-min) CMIN="$2"; shift 2;;
    --crop-max) CMAX="$2"; shift 2;;
    --no-crop) CROP=0; shift;;
    --cell) CELL="$2"; shift 2;;
    *) echo "unknown arg $1" >&2; exit 2;;
  esac
done
PY=(uv run -q --with numpy --with pillow python art/briefs/v2-world/world.py)
SF="$HOME/.omp/plugins/node_modules/oh-my-pi-sprite-forge/skills/sprite-forge/scripts/process-sprite.ts"
mkdir -p "$OUT"
cp "$RAW" "$OUT/raw-provider.jpg"
if [ "$CROP" = 1 ]; then
  "${PY[@]}" bestcrop "$OUT/raw-provider.jpg" "$OUT/crop.png" --min "$CMIN" --max "$CMAX"
else
  uv run -q --with pillow python -c "from PIL import Image;Image.open('$OUT/raw-provider.jpg').convert('RGB').save('$OUT/crop.png')"
fi
"${PY[@]}" tonefit "$OUT/crop.png" "$OUT/graded.png" --mean "$MEAN" --lo "$LO"
bun "$SF" --input "$OUT/graded.png" --output "$OUT" --rows 1 --cols 1 --cell-size "$CELL" \
  --duration 0 --full-bleed --threshold 1 --edge-threshold 1 --sampling smooth --align center \
  --style-profile art/style.json --preserve-raw --source-provider xai >/dev/null
echo "exported $OUT"
