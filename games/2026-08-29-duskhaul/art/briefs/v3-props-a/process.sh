#!/usr/bin/env bash
# Reproduces every props-v3a export from its accepted provider raw, then derives tall-tops + tables.
# Run from games/2026-08-29-duskhaul/:  art/briefs/v3-props-a/process.sh
# Same processor settings as ArtWorld's props-c (art/briefs/v2-world/process-sheet.sh), plus
# --threshold 210 --edge-threshold 230: at the default 180 xai's pink-magenta trapped inside open
# frames (ballista, spear rack) survived keying (284 pink px on castle-e); at 210 it is 5, and the
# only opaque pixels lost are that residue (127426 -> 127114). No prop colour sits within 210 of #FF00FF.
set -euo pipefail
for s in castle-d castle-e outlands-d outlands-e; do
  art/briefs/v2-world/process-sheet.sh "art/briefs/v3-props-a/raws/props-$s.jpg" \
    "public/assets/generated/props-v3a/props-$s" 256 --threshold 210 --edge-threshold 230
done
uv run -q --with pillow python art/briefs/v3-props-a/build.py >/dev/null
echo "props-v3a rebuilt"
