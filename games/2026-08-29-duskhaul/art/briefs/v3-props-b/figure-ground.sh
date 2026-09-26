#!/usr/bin/env bash
# Set gate for props-v3b: figure-ground.py per zone (desert, winter) with the COMPLETE cast that stands on
# those floors — hero idle+run, every enemies-light/-heavy/-v2 *-move, the zone's own *-move sheets, and
# every ground-prop sheet of the zone (props-<z>-a/b, props-v2 -c, props-v3b -d/-e). Fields = floors-v2
# floor a/b/c + road through the runtime FLOOR_GRADE (src/ui/duskChrome.ts: desert d9d9d9, winter f5f5f5).
# Run from games/2026-08-29-duskhaul/:  art/briefs/v3-props-b/figure-ground.sh
set -euo pipefail
REPO="$(git rev-parse --show-toplevel)"
G=public/assets/generated
common() {
  ls $G/hero/hero-idle/sprite-sheet.png $G/hero/hero-run/sprite-sheet.png \
     $G/enemies-light/*-move/sprite-sheet.png $G/enemies-heavy/*-move/sprite-sheet.png $G/enemies-v2/*-move/sprite-sheet.png
}
scene() {
  local z="$1" grade="$2"
  echo --scene "$z" --grade "$grade" --actors $(common) $G/zone-$z/*-move/sprite-sheet.png \
    $G/zone-$z/props-$z-a/sprite-sheet.png $G/zone-$z/props-$z-b/sprite-sheet.png \
    $G/props-v2/props-$z-c/sprite-sheet.png $G/props-v3b/props-$z-d/sprite-sheet.png $G/props-v3b/props-$z-e/sprite-sheet.png \
    --fields $G/floors-v2/floor-$z-{a,b,c}/sprite.png $G/floors-v2/road-$z/sprite.png
}
python3 "$REPO/.claude/skills/game-art/references/figure-ground.py" $(scene desert d9d9d9) $(scene winter f5f5f5) "$@"
