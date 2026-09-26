#!/usr/bin/env python3
"""Single source of truth for the ArtArsenalIcons slice (PRD-V2 §5.8b.5 icon rows).

Writes art/v2/ArtArsenalIcons.groups.json (manifest `groups[]` entry, same schema
as art/manifest.json, for Main to merge) and art/v2/ArtArsenalIcons.progress.md
(icon id -> texture key + frame). An asset is emitted only when its export
exists on disk with the declared grid.

Run from games/2026-08-29-duskhaul/:  python3 art/v2/ArtArsenalIcons.build.py
Re-export pixels from the kept raws (repo root): sh games/2026-08-29-duskhaul/art/briefs/v4-icons/rebuild.sh
"""
import json
from pathlib import Path

GROUP = "icons-v4"
OWNER = "ArtArsenalIcons"
ROOT = Path("public/assets/generated") / GROUP
A = ["aura", "chakram", "wake", "snares"]
B = ["siphon", "bombs", "totem", "thralls"]

# (assetId, rows, cols, cellPx, attempts, icons[], action)
SHEETS = [
    ("icons-arsenal-wpn", 4, 4, 96, 1,
     [f"icon-wpn-{w}" for w in A] + [f"icon-evo-{w}" for w in A]
     + [f"icon-wpn-{w}" for w in B] + [f"icon-evo-{w}" for w in B],
     "Arsenal-20 weapon + evolution icons for the 8 new pairs (rows: base, evolved, base, evolved), PRD-V2 §5.8b.5"),
    ("icons-arsenal-charm-a", 2, 2, 96, 0,
     [f"icon-charm-{c}" for c in ("c_pin", "c_knuckle", "c_sole", "c_fuse")],
     "Arsenal-20 partner charms 1-4 (§5.8b.2): Widow's Pin, Cheater's Knucklebone, Pilgrim's Sole, Sexton's Fuse"),
    ("icons-arsenal-charm-b", 2, 2, 96, 0,
     [f"icon-charm-{c}" for c in ("c_vial", "c_powder", "c_hymnal", "c_collar")],
     "Arsenal-20 partner charms 5-8 (§5.8b.2): Marrow Vial, Ossuary Powder, Dirge Hymnal, Bone Collar"),
]

EXCEPTIONS = [
    {"id": "icons-v4/icons-arsenal-*",
     "reason": "Export provenance, same class as icons-v2/icons-*: native generate_image (xai-oauth; inputs vision-1 + an accepted icons-v2 raw) exported by sprite-forge process-sprite.ts CLI --strict with --style-profile from the preserved raw, not by the OMP_SPRITE_EXPORT middleware, because xai returns the key as hot pink (~rgb(252,48,186)); art/briefs/v4-icons/normalize-key.py maps the sampled bg to #FF00FF first (pixels only ever become key). rebuild.sh reproduces every export from art/briefs/v4-icons/raw/."},
    {"id": "icons-v4/icons-arsenal-wpn",
     "reason": "allowSourceEdgeTouch reviewed: only frame 14 (icon-evo-totem, Cathedral of Bones) touches the raw cell top with the tip of a violet flame wisp (<4 px); the reliquary reads complete. Raw is a same-position cell composite (compose-cells.py) of attempt 1 + the xai edit attempt 2 cells r1c2/r2c2/r3c3, which removed the totem flame crossing into the wake cell and recoloured the Legion's orange collar straps to bone/steel; attempt 2 deleted the reliquary, so r3c2 stays attempt 1."},
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
           "note": "Arsenal-20 icons for the 8 new weapon/charm pairs (PRD-V2 §5.8b.5). Static sheets addressed by frame via ICON.<id>; drawn at 48-96 px; cool hero palette, no red/green rims (rarity/state frames stay in UI code).",
           "assets": assets, "qcExceptions": EXCEPTIONS, "missing": missing}
    Path(f"art/v2/{OWNER}.groups.json").write_text(json.dumps(out, indent=2) + "\n")
    md = [f"# {OWNER} progress", "",
          f"Group `{GROUP}` (add to ART_GROUPS wherever `icons-v2` is listed). Consumers: `ICON['<id>']` -> `{{ key, frame }}` "
          f"after Main merges `art/v2/{OWNER}.groups.json` into `art/manifest.json` and runs `node scripts/gen-art-registry.mjs`. "
          "Until then: texture key = sheet id, frame = index below, spritesheet frameWidth = cell px.", "",
          "| id | texture key | frame | cell px | path (under public/) |", "|---|---|---|---|---|", *lines, "",
          f"Missing (not yet delivered): {', '.join(missing) if missing else 'none'}", ""]
    Path(f"art/v2/{OWNER}.progress.md").write_text("\n".join(md))
    print(f"assets={len(assets)} icons={len(lines)} missing={len(missing)}")


if __name__ == "__main__":
    main()
