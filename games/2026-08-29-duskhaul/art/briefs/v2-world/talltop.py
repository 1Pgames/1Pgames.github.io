#!/usr/bin/env python3
"""Build props-<zone>-tall-top sheets (PRD-V2 §3.7 Y-sort) by CROPPING the accepted tall prop frames.

Run from games/2026-08-29-duskhaul/:
  uv run -q --with pillow python art/briefs/v2-world/talltop.py

Why a crop and not a generation: the top sprite is drawn at depth 30 over the SAME prop's full base
sprite (base below actors, top above them at alpha 0.6 when the hero is behind). It must register
pixel-for-pixel with its base, which only a crop of the base's own frame can guarantee; a separately
generated "upper half" would never line up. Nothing is painted — each tall-top cell is the source
256px cell with every row below the cut made transparent.

Cut rule: the upper half of the art — rows above alignedBox.top + 0.5 * alignedBox.height of the
source frame (PRD-V2 §11 "upper halves of tall props").

Consumer contract: draw `props-<zone>-tall-top` frame i with the SAME origin, size, flip and rotation
as the base cell named in PAIRS[zone][i]; the cell geometry is identical (256px, same alignedBox left/width).
"""
import json
import os

from PIL import Image

ROOT = "public/assets/generated"
# zone -> 9 (sheetGroup/sheetId, frame, name) tall props, in tall-top frame order.
PAIRS = {
    "castle": [
        ("props-v2/props-castle-c", 0, "wall-straight"),
        ("props-v2/props-castle-c", 1, "wall-corner"),
        ("props-v2/props-castle-c", 3, "pillar"),
        ("props-v2/props-castle-c", 6, "monolith"),
        ("props-v2/props-castle-c", 7, "lamppost"),
        ("zone-castle/props-castle-a", 6, "torch"),
        ("zone-castle/props-castle-a", 7, "statue"),
        ("zone-castle/props-castle-b", 5, "column"),
        ("zone-castle/props-castle-b", 7, "hook"),
    ],
    "outlands": [
        ("props-v2/props-outlands-c", 1, "wall-corner"),
        ("props-v2/props-outlands-c", 2, "wall-broken"),
        ("props-v2/props-outlands-c", 3, "deadtree"),
        ("props-v2/props-outlands-c", 6, "monolith"),
        ("props-v2/props-outlands-c", 7, "gibbetpost"),
        ("zone-outlands/props-outlands-a", 1, "gibbet"),
        ("zone-outlands/props-outlands-a", 6, "tree"),
        ("zone-outlands/props-outlands-b", 1, "scarecrow"),
        ("zone-outlands/props-outlands-b", 5, "perch"),
    ],
    "desert": [
        ("props-v2/props-desert-c", 0, "wall-straight"),
        ("props-v2/props-desert-c", 1, "wall-corner"),
        ("props-v2/props-desert-c", 3, "column"),
        ("props-v2/props-desert-c", 6, "monolith"),
        ("props-v2/props-desert-c", 7, "cagepost"),
        ("zone-desert/props-desert-a", 5, "obelisk"),
        ("zone-desert/props-desert-a", 7, "palm"),
        ("zone-desert/props-desert-b", 1, "sunbanner"),
        ("zone-desert/props-desert-b", 6, "vulture"),
    ],
    "winter": [
        ("props-v2/props-winter-c", 0, "wall-straight"),
        ("props-v2/props-winter-c", 1, "wall-corner"),
        ("props-v2/props-winter-c", 3, "pine-c"),
        ("props-v2/props-winter-c", 6, "icemonolith"),
        ("props-v2/props-winter-c", 7, "lanternpost"),
        ("zone-winter/props-winter-a", 6, "pine"),
        ("zone-winter/props-winter-b", 0, "bellshrine"),
        ("zone-winter/props-winter-b", 4, "lantern"),
        ("zone-winter/props-winter-b", 6, "bonetree"),
    ],
}
CELL = 256


def build(zone):
    out_dir = f"{ROOT}/props-v2/props-{zone}-tall-top"
    os.makedirs(f"{out_dir}/frames", exist_ok=True)
    sheet = Image.new("RGBA", (CELL * 3, CELL * 3), (0, 0, 0, 0))
    frames = []
    for i, (src, frame, name) in enumerate(PAIRS[zone]):
        meta = json.load(open(f"{ROOT}/{src}/sprite-metadata.json"))
        box = meta["frames"][frame]["alignedBox"]
        cut = box["top"] + box["height"] // 2
        im = Image.open(f"{ROOT}/{src}/frames/frame-{frame:03d}.png").convert("RGBA")
        assert im.size == (CELL, CELL), f"{src} frame {frame} is {im.size}"
        top = im.copy()
        top.paste((0, 0, 0, 0), (0, cut, CELL, CELL))
        bbox = top.getbbox() or (0, 0, 0, 0)
        top.save(f"{out_dir}/frames/frame-{i:03d}.png")
        sheet.alpha_composite(top, ((i % 3) * CELL, (i // 3) * CELL))
        frames.append({
            "index": i,
            "file": f"frames/frame-{i:03d}.png",
            "name": name,
            "base": {"asset": src.split("/")[1], "group": src.split("/")[0], "frame": frame, "alignedBox": box},
            "cutY": cut,
            "alignedBox": {"left": bbox[0], "top": bbox[1], "width": bbox[2] - bbox[0], "height": bbox[3] - bbox[1]},
            "empty": bbox == (0, 0, 0, 0),
        })
    sheet.save(f"{out_dir}/sprite-sheet.png")
    meta = {
        "source": {"file": "derived: crop of base prop frames (see art/briefs/v2-world/talltop.py)", "provider": "derived", "width": CELL * 3, "height": CELL * 3},
        "grid": {"rows": 3, "cols": 3},
        "output": {"cellSize": CELL, "durationMs": 0, "derivation": "upper half of each base frame (rows above alignedBox.top + height/2), identical cell geometry"},
        "qc": {"strict": True, "passed": all(not f["empty"] for f in frames), "failures": [], "notes": ["derived-crop: registers pixel-for-pixel with its base cell"]},
        "frames": frames,
    }
    json.dump(meta, open(f"{out_dir}/sprite-metadata.json", "w"), indent=2)
    print(f"props-{zone}-tall-top: {[f['name'] for f in frames]}")


if __name__ == "__main__":
    for z in PAIRS:
        build(z)
