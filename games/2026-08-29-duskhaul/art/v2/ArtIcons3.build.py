#!/usr/bin/env python3
"""Single source of truth for the ArtIcons3 `icons-v3` slice (draft stat/effect/filler
cards + Sanctum branch crests that had no art in icons-v2).

Writes art/v2/ArtIcons3.groups.json (manifest `groups[]` entry, same schema as
art/manifest.json, for Main to merge) and art/v2/ArtIcons3.progress.md. An asset is
emitted only when its export exists on disk with the declared grid.

Run from games/2026-08-29-duskhaul/:  python3 art/v2/ArtIcons3.build.py
Re-export pixels from the kept raws:  sh games/2026-08-29-duskhaul/art/briefs/v3-icons/rebuild.sh (repo root)
"""
import json
from pathlib import Path

GROUP = "icons-v3"
OWNER = "ArtIcons3"
ROOT = Path("public/assets/generated") / GROUP

CARDS = ["stat_might", "stat_haste", "stat_area", "stat_crit", "stat_vital", "stat_swift", "stat_greed",
         "fx_lastgasp", "fill_bread", "fill_purse"]
BRANCHES = ["body", "greed", "escape", "ascension", "root"]

# (assetId, rows, cols, cellPx, attempts, icons[], action)
SHEETS = [
    ("icons-v3-cards", 4, 4, 96, 2,
     [f"icon-card-{c}" for c in CARDS] + [f"icon-branch-{b}" for b in BRANCHES] + ["icon-sanctum-keystone"],
     "Draft stat/effect/filler card icons (upgrades.ts STAT_CARDS + FILLER_CARDS) + Sanctum branch crests "
     "(sanctum.ts BODY/GREED/ESCAPE, Dread Ascension row, ROOT oath) + row-4 keystone mark"),
]
EXCEPTIONS = [
    {"id": "icons-v3/icons-v3-cards",
     "reason": "Export provenance, same class as icons-v2/icons-*: native generate_image (xai-oauth, inputs vision-1 + "
               "accepted icons-v2 icons-kit raw) exported by process-sprite.ts CLI --strict from the kept raw after "
               "normalize-key.py (xai paints the key hot pink ~rgb(248,11,202)); not through the OMP_SPRITE_EXPORT "
               "marker. Frame 13 is a cell composite: attempt 2 (accepted sheet) drew a plain iron crown at r4c2 that "
               "duplicated icon-uniq-u_dreadcrown; edit attempt 3 drew the requested winged crowned skull but in r3c2 "
               "(over the purse), so compose-cells.py pixel-copies that generated cell into r4c2 of attempt 2; nothing "
               "drawn. Both raws kept in art/briefs/v3-icons/raw/icons-v3-cards/, rebuild.sh reproduces the export."},
]


def delivered(asset: str, rows: int, cols: int) -> bool:
    meta = ROOT / asset / "sprite-metadata.json"
    if not meta.exists():
        return False
    g = json.loads(meta.read_text())["grid"]
    return g["rows"] == rows and g["cols"] == cols


def main() -> None:
    assets, lines, missing = [], [], []
    for asset, rows, cols, cell, attempts, icons, action in SHEETS:
        assert len(icons) == rows * cols, asset
        if not delivered(asset, rows, cols):
            missing += icons
            continue
        assets.append({"id": asset, "kind": "ui", "rows": rows, "cols": cols, "duration": 0,
                       "loop": False, "attempts": attempts, "icons": icons, "action": action,
                       "cellPx": cell, "strict": True})
        path = f"assets/generated/{GROUP}/{asset}/sprite-sheet.png"
        for i, name in enumerate(icons):
            lines.append(f"| `{name}` | `{asset}` | {i} | {cell} | `{path}` |")
    out = {"group": GROUP, "owner": OWNER,
           "note": "V3 icons: draft stat/effect/filler cards + Sanctum branch crests. Static sheet addressed by frame "
                   "via ICON.<id>; rarity is drawn by UI frames in code, never in the icon.",
           "assets": assets, "qcExceptions": EXCEPTIONS, "missing": missing}
    Path("art/v2/ArtIcons3.groups.json").write_text(json.dumps(out, indent=2) + "\n")
    md = ["# ArtIcons3 (icons-v3) progress", "",
          "Group `icons-v3` (add to ART_GROUPS). Consumers: `ICON['<id>']` -> `{ key, frame }` after Main merges "
          "`art/v2/ArtIcons3.groups.json` into `art/manifest.json` and runs `node scripts/gen-art-registry.mjs`. "
          "Until then: texture key = sheet id, frame = index below, spritesheet frameWidth = cell px.", "",
          "| id | texture key | frame | cell px | path (under public/) |", "|---|---|---|---|---|", *lines, "",
          f"Missing (not yet delivered): {', '.join(missing) if missing else 'none'}", ""]
    Path("art/v2/ArtIcons3.progress.md").write_text("\n".join(md))
    print(f"assets={len(assets)} icons={len(lines)} missing={len(missing)}")


if __name__ == "__main__":
    main()
