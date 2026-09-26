#!/bin/sh
# Re-exports every ArtIcons V2 asset from the kept provider raws (run from repo root).
# These are the exact flags the shipped exports used; output is byte-reproducible.
set -e
F=games/2026-08-29-duskhaul/art/briefs/v2-icons/finalize.py
Z=games/2026-08-29-duskhaul/art/briefs/v2-icons/zonekey.py
R=games/2026-08-29-duskhaul/art/briefs/v2-icons/raw
python3 $F icons-wpn-a   $R/icons-wpn-a/provider-raw.jpg   4 4 96 --edge-ok
python3 $F icons-wpn-b   $R/icons-wpn-b/provider-raw.jpg   4 4 96
python3 $F icons-kit     $R/icons-kit/provider-raw.jpg     4 4 96
python3 $F icons-gear-a  $R/icons-gear-a/provider-raw.jpg  4 4 96
python3 $F icons-gear-b  $R/icons-gear-b/provider-raw.jpg  4 4 96
python3 $F icons-val-a   $R/icons-val-a/provider-raw.jpg   4 4 96
python3 $F icons-val-b   $R/icons-val-b/provider-raw.jpg   3 3 96
python3 $F icons-affix   $R/icons-affix/provider-raw.jpg   3 3 32
python3 $F icons-minimap $R/icons-minimap/provider-raw.jpg 4 4 24 --edge-ok
python3 $F icons-hub     $R/icons-hub/provider-raw.jpg     3 3 64 --edge-ok
python3 $F icons-class   $R/icons-class/provider-raw.jpg   2 2 128 --divider
python3 $Z castle   $R/zone-key-castle/provider-raw.png   --top 0.7
python3 $Z outlands $R/zone-key-outlands/provider-raw.png --top 0.6
python3 $Z desert   $R/zone-key-desert/provider-raw.png   --top 0.6
python3 $Z winter   $R/zone-key-winter/provider-raw.png   --top 0.6
