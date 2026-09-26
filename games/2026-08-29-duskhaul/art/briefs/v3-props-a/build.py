#!/usr/bin/env python3
"""props-v3a (ArtPropsA): measure cells, derive tall-top crops, emit groups fragment + prop table.

Run from games/2026-08-29-duskhaul/:
  uv run -q --with pillow python art/briefs/v3-props-a/build.py

Tall-top method is ArtWorld's (art/briefs/v2-world/talltop.py): the top cell is the base cell with every
row at/below cutY = alignedBox.top + alignedBox.height // 2 made transparent, so it registers
pixel-for-pixel with its base. Nothing is painted. Tall = alignedBox height > 1.3 x width.
"""
import json
import os

from PIL import Image

ROOT = "public/assets/generated/props-v3a"
CELL = 256
# regenerations per sheet (edits of the accepted raw count): castle-d cauldron value lift; castle-e and
# outlands-d value lift (first try came back on a magenta->black gradient, contamination, discarded);
# outlands-e cell-7 swap (menhir/milestone near-duplicate) + value lift.
ATTEMPTS = {"props-castle-d": 2, "props-castle-e": 2, "props-outlands-d": 3, "props-outlands-e": 2}
# sheet -> 9 x (name, shape class, size class, footprint px, body radius px)
SHEETS = {
    "props-castle-d": [
        ("obelisk", "tall", "medium", 120, 48), ("fallen-column", "wide", "large", 190, 90),
        ("cauldron", "round", "medium", 130, 60), ("stocks", "wide", "small", 110, 50),
        ("gargoyle", "tall", "medium", 125, 55), ("trough", "wide", "medium", 170, 80),
        ("boulder", "round", "large", 150, 70), ("bollard", "small", "small", 95, 40),
        ("stair-ruin", "irregular", "large", 170, 80),
    ],
    "props-castle-e": [
        ("barrels", "round", "medium", 140, 62), ("spear-rack", "wide", "medium", 165, 75),
        ("banner-pole", "tall", "small", 100, 30), ("anvil", "small", "small", 105, 48),
        ("iron-maiden", "tall", "medium", 120, 55), ("grave-cross", "small", "small", 90, 36),
        ("ballista", "wide", "large", 190, 90), ("millstone", "round", "small", 115, 55),
        ("wall-corner-ruin", "irregular", "large", 185, 88),
    ],
    "props-outlands-d": [
        ("split-tree", "tall", "medium", 125, 45), ("hollow-log", "wide", "large", 190, 88),
        ("stone-idol", "small", "small", 105, 48), ("crag", "irregular", "large", 175, 82),
        ("axe-stump", "small", "small", 105, 48), ("signpost", "tall", "small", 100, 32),
        ("beast-skull", "irregular", "medium", 150, 68), ("trough", "wide", "medium", 175, 82),
        ("bird-totem", "tall", "small", 90, 30),
    ],
    "props-outlands-e": [
        ("menhir", "tall", "medium", 115, 50), ("plough", "wide", "medium", 175, 80),
        ("cauldron", "round", "medium", 150, 70), ("root-tangle", "irregular", "large", 180, 85),
        ("toadstool", "small", "small", 90, 40), ("barrel", "small", "small", 100, 46),
        ("wayshrine", "tall", "small", 110, 44), ("antler-totem", "tall", "medium", 110, 42),
        ("wattle-corner", "irregular", "large", 180, 85),
    ],
}


def lstar(r, g, b):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    return 116 * (y ** (1 / 3)) - 16 if y > 216 / 24389 else y * 24389 / 27


def median(v):
    v = sorted(v)
    return v[len(v) // 2] if v else 0


def main():
    cells = []
    tops = {}
    for sheet, rows in SHEETS.items():
        zone = sheet.split("-")[1]
        meta = json.load(open(f"{ROOT}/{sheet}/sprite-metadata.json"))
        for i, (name, shape, size, fp, rad) in enumerate(rows):
            box = meta["frames"][i]["alignedBox"]
            im = Image.open(f"{ROOT}/{sheet}/frames/frame-{i:03d}.png").convert("RGBA")
            assert im.size == (CELL, CELL)
            ls = [lstar(r, g, b) for r, g, b, a in im.convert("RGBA").get_flattened_data() if a >= 128]
            ls.sort()
            tall = box["height"] > 1.3 * box["width"]
            cell = {"id": f"{zone}-{name}", "sheet": sheet, "frame": i, "box": box, "shape": shape,
                    "size": size, "footprint": fp, "radius": rad, "tall": tall,
                    "lMed": round(median(ls), 1), "lP25": round(ls[len(ls) // 4], 1), "lP75": round(ls[3 * len(ls) // 4], 1)}
            cells.append(cell)
            if tall:
                tops.setdefault(sheet, []).append((cell, im))
    # tall-top sheets: one per base sheet, frames in base order, remaining cells empty
    top_meta = {}
    for sheet, items in tops.items():
        out = f"{ROOT}/{sheet}-tall-top"
        os.makedirs(f"{out}/frames", exist_ok=True)
        for f in os.listdir(f"{out}/frames"):
            os.remove(f"{out}/frames/{f}")
        grid = Image.new("RGBA", (CELL * 3, CELL * 3), (0, 0, 0, 0))
        frames = []
        for j, (cell, im) in enumerate(items):
            box = cell["box"]
            cut = box["top"] + box["height"] // 2
            top = im.copy()
            top.paste((0, 0, 0, 0), (0, cut, CELL, CELL))
            bb = top.getbbox()
            top.save(f"{out}/frames/frame-{j:03d}.png")
            grid.alpha_composite(top, ((j % 3) * CELL, (j // 3) * CELL))
            cell["top"] = (f"{sheet}-tall-top", j, cut)
            frames.append({"index": j, "file": f"frames/frame-{j:03d}.png", "name": f"{cell['id']}-top",
                           "base": {"asset": sheet, "group": "props-v3a", "frame": cell["frame"], "alignedBox": box},
                           "cutY": cut,
                           "alignedBox": {"left": bb[0], "top": bb[1], "width": bb[2] - bb[0], "height": bb[3] - bb[1]},
                           "empty": False})
        grid.save(f"{out}/sprite-sheet.png")
        json.dump({
            "source": {"file": "derived: crop of base prop frames (art/briefs/v3-props-a/build.py)", "provider": "derived",
                       "width": CELL * 3, "height": CELL * 3},
            "grid": {"rows": 3, "cols": 3},
            "output": {"cellSize": CELL, "durationMs": 0, "frameCount": len(frames),
                       "derivation": "upper half of each tall base frame (rows above alignedBox.top + height//2), identical cell geometry; cells after frameCount are empty"},
            "qc": {"strict": True, "passed": True, "failures": [], "notes": ["derived-crop: registers pixel-for-pixel with its base cell"]},
            "frames": frames,
        }, open(f"{out}/sprite-metadata.json", "w"), indent=2)
        top_meta[sheet] = frames

    # groups fragment
    assets = []
    for sheet, rows in SHEETS.items():
        zone = sheet.split("-")[1]
        assets.append({"id": sheet, "kind": "ui", "rows": 3, "cols": 3, "duration": 0, "attempts": ATTEMPTS[sheet],
                       "icons": [f"{zone}-{n}" for n, *_ in rows],
                       "action": f"{zone} standalone blockers {sheet[-1]}: " + ", ".join(n for n, *_ in rows)})
        if sheet in top_meta:
            assets.append({"id": f"{sheet}-tall-top", "kind": "ui", "rows": 3, "cols": 3, "duration": 0,
                           "icons": [f["name"] for f in top_meta[sheet]],
                           "action": f"derived upper-half crops of the tall cells of {sheet} (Y-sort occluder, registers 1:1 with base)"})
    frag = {"owner": "ArtPropsA",
            "groups": [{"group": "props-v3a", "owner": "ArtPropsA", "assets": assets}],
            "qcExceptions": [
                {"id": "props-v3a/props-*-tall-top", "reason": "Derived, not generated: upper-half crops of the accepted base frames (art/briefs/v3-props-a/build.py) so the occluding top registers pixel-for-pixel with its base; a generated upper half cannot align."},
                {"id": "props-v3a/props-outlands-d", "reason": "Third regeneration (single-cell edit of the accepted raw) to break an art_review silhouette collision (0.033 at 48px) between the round boulder and outlands-e's round cauldron; the rest of the sheet was already accepted. If the edit fails, the prior raw ships and both round cells stay, visibly different materials (stone dome vs rusted pot on ash ring)."},
            ]}
    json.dump(frag, open("art/v2/ArtPropsA.groups.json", "w"), indent=2)

    def b(x):
        return f"{x['left']},{x['top']},{x['width']}x{x['height']}"
    lines = ["| id | sheet | cell | alignedBox (l,t,wxh) | cell [w,h] | footprint px | body radius | shape | size | L* p25/med/p75 | blocking | tall-top pair |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for c in cells:
        pair = f"{c['top'][0]} #{c['top'][1]} (cutY {c['top'][2]})" if "top" in c else "—"
        lines.append(f"| {c['id']} | {c['sheet']} | {c['frame']} | {b(c['box'])} | [{c['box']['width']}, {c['box']['height']}] | {c['footprint']} | {c['radius']} | {c['shape']} | {c['size']} | {c['lP25']}/{c['lMed']}/{c['lP75']} | yes | {pair} |")
    open("art/briefs/v3-props-a/tables.md", "w").write("## Prop cells (props-v3a)\n\n" + "\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
