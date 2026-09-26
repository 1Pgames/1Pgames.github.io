#!/bin/bash
# usage: proc.sh <raw> <outdir> <scale-profile-out>
# hero-idle processing: identical params to the original hero-idle export / hero-scale.json
set -e
P=~/.omp/plugins/node_modules/oh-my-pi-sprite-forge/skills/sprite-forge/scripts
bun $P/process-sprite.ts --input "$1" --output "$2" --rows 2 --cols 2 --cell-size 256 \
  --align feet --scale preserve --fit 0.86 --sampling nearest --duration 150 --strict --preserve-raw \
  --threshold 180 --feather 0 --edge-threshold 210 --component-mode largest \
  --source-provider xai --write-scale-profile "$3" --profile-name hero \
  --max-body-scale-cv 0.08 --max-anchor-y-std 0.05
