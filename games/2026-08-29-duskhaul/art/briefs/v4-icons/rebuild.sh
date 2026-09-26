#!/bin/sh
# Re-exports the ArtArsenalIcons icons-v4 sheets from the kept provider raws (run from repo root).
# icons-arsenal-wpn: attempt1-base = accepted sheet; attempt2-donor = xai edit (attempt 1 as Image 1)
# whose cells r1c2 (wake river), r2c2 (totem), r3c3 (Legion, bone collars) replace attempt 1's.
set -e
D=games/2026-08-29-duskhaul/art/briefs/v4-icons
R=$D/raw
mkdir -p /tmp/icv4
python3 $D/compose-cells.py $R/icons-arsenal-wpn/attempt1-base.jpg $R/icons-arsenal-wpn/attempt2-donor.jpg /tmp/icv4/composed.png 4 1,2 2,2 3,3
cp /tmp/icv4/composed.png $R/icons-arsenal-wpn/provider-raw.png
python3 $D/finalize.py icons-arsenal-wpn     $R/icons-arsenal-wpn/provider-raw.png     4 4 96 --edge-ok
python3 $D/finalize.py icons-arsenal-charm-a $R/icons-arsenal-charm-a/provider-raw.jpg 2 2 96
python3 $D/finalize.py icons-arsenal-charm-b $R/icons-arsenal-charm-b/provider-raw.jpg 2 2 96
