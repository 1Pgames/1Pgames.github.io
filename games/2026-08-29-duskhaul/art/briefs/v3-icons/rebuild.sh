#!/bin/sh
# Re-exports the ArtIcons3 icons-v3 sheet from the kept provider raws (run from repo root).
# attempt2-base = accepted sheet; attempt3-donor = xai edit whose r3c2 (winged crowned skull)
# replaces attempt 2's r4c2 plain crown; attempt1-rejected kept for provenance only.
set -e
D=games/2026-08-29-duskhaul/art/briefs/v3-icons
R=$D/raw/icons-v3-cards
mkdir -p /tmp/icv3
python3 $D/compose-cells.py $R/attempt2-base.jpg $R/attempt3-donor.jpg /tmp/icv3/composed.png 4 2,1 3,1
python3 $D/finalize.py icons-v3-cards /tmp/icv3/composed.png 4 4 96
