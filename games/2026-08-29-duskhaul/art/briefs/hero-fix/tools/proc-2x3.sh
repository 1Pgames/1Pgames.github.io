#!/bin/bash
# usage: proc-2x3.sh <raw> <outdir> <durationMs>
# hero-death / hero-extract processing: same params as the original exports (unbound, no profile write)
set -e
P=~/.omp/plugins/node_modules/oh-my-pi-sprite-forge/skills/sprite-forge/scripts
bun $P/process-sprite.ts --input "$1" --output "$2" --rows 2 --cols 3 --cell-size 256 \
  --align feet --scale preserve --fit 0.86 --sampling nearest --duration "$3" --strict --preserve-raw \
  --threshold 180 --feather 0 --edge-threshold 210 --component-mode largest --source-provider xai
