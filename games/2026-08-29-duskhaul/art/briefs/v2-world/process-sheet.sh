#!/usr/bin/env bash
# Reproduces a props-v2 / landmarks 3x3 sheet export from its provider raw (magenta-keyed actor sheet).
# Run from games/2026-08-29-duskhaul/:
#   art/briefs/v2-world/process-sheet.sh <provider-raw.jpg> <outDir> <cellSize> [extra process-sprite flags]
# Settings mirror the manifest's pixel-art-fx convention used by props-<zone>-a/b: centre align, fit 0.86,
# nearest sampling, keep all components, hard magenta key, strict QC.
# The style profile is NOT bound to the keyer here: its chroma guard refuses #c084fc (146 from magenta)
# as key and kept 11k-22k pink halo pixels on xai's pink-magenta background. No prop/landmark uses
# that violet, so the guard only protected background. Palette QC runs separately (sprite_check_palette).
set -euo pipefail
RAW="$1"; OUT="$2"; CELL="$3"; shift 3
SF="$HOME/.omp/plugins/node_modules/oh-my-pi-sprite-forge/skills/sprite-forge/scripts/process-sprite.ts"
mkdir -p "$OUT"
cp "$RAW" "$OUT/raw-provider.jpg"
bun "$SF" --input "$OUT/raw-provider.jpg" --output "$OUT" --rows 3 --cols 3 --cell-size "$CELL" \
  --duration 0 --align center --fit 0.86 --sampling nearest --component-mode all \
  --strict --source-provider xai "$@" >/dev/null
rm -f "$OUT/animation.gif"
echo "exported $OUT"
