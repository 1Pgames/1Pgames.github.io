#!/usr/bin/env bash
# Reproduces a floors-v2 splat decal export from its provider raw.
# Run from games/2026-08-29-duskhaul/:
#   art/briefs/v2-world/process-splat.sh <provider-raw.jpg> <outDir> [--mean 25]
#
# 1. sprite-forge process-sprite.ts: 1x1, 512 cell, centre, fit 0.92, smooth sampling, all components,
#    magenta key threshold 180 + feather 40 (soft decal edge), strict QC. Raw copied as raw-provider.jpg.
# 2. world.py tonefit on the exported sprite.png (alpha-weighted): same PRD-V2 §3.7 floor value/saturation
#    band as the floors, so a splat is a material change on the floor, never a brighter or greener blob.
#    frames/frame-000.png and sprite-sheet.png are replaced by the graded sprite so all three agree.
# The decal alpha 0.55 from PRD-V2 §3.7 is applied in CODE (DecalDef.alpha), not baked here.
set -euo pipefail
RAW="$1"; OUT="$2"; shift 2
MEAN=25
while [ $# -gt 0 ]; do
  case "$1" in
    --mean) MEAN="$2"; shift 2;;
    *) echo "unknown arg $1" >&2; exit 2;;
  esac
done
SF="$HOME/.omp/plugins/node_modules/oh-my-pi-sprite-forge/skills/sprite-forge/scripts/process-sprite.ts"
mkdir -p "$OUT"
cp "$RAW" "$OUT/raw-provider.jpg"
bun "$SF" --input "$OUT/raw-provider.jpg" --output "$OUT" --rows 1 --cols 1 --cell-size 512 \
  --duration 0 --align center --fit 0.92 --sampling smooth --component-mode all \
  --threshold 180 --feather 40 --strict --source-provider xai >/dev/null
uv run -q --with numpy --with pillow python art/briefs/v2-world/world.py tonefit "$OUT/sprite.png" "$OUT/sprite.png" --mean "$MEAN" --lo 12 --hi 38
cp "$OUT/sprite.png" "$OUT/frames/frame-000.png"
cp "$OUT/sprite.png" "$OUT/sprite-sheet.png"
echo "exported $OUT"
