#!/usr/bin/env bash
# Reproduces a props-v3b 3x3 prop sheet export from its xai provider raw.
# Run from games/2026-08-29-duskhaul/:
#   art/briefs/v3-props-b/process-sheet.sh <provider-raw.jpg> <outDir>
# Same processor settings as art/briefs/v2-world/process-sheet.sh (props-v2 canon: centre align,
# fit 0.86, nearest, all components, hard key, strict QC, style profile NOT bound to the keyer —
# its chroma guard protects #c084fc and keeps pink halo), except the key is tightened to
# --threshold 200 --edge-threshold 260, then defringe.py removes the purple contact-shadow blobs and
# the salmon/pink rim xai's JPEG pink-magenta leaves (brief: no red/green rims).
set -euo pipefail
RAW="$1"; OUT="$2"
SF="$HOME/.omp/plugins/node_modules/oh-my-pi-sprite-forge/skills/sprite-forge/scripts/process-sprite.ts"
HERE="$(dirname "$0")"
mkdir -p "$OUT"
cp "$RAW" "$OUT/raw-provider.jpg"
bun "$SF" --input "$OUT/raw-provider.jpg" --output "$OUT" --rows 3 --cols 3 --cell-size 256 \
  --duration 0 --align center --fit 0.86 --sampling nearest --component-mode all \
  --threshold 200 --edge-threshold 260 --strict --source-provider xai >/dev/null
rm -f "$OUT/animation.gif"
uv run -q --with pillow python "$HERE/defringe.py" "$OUT"
