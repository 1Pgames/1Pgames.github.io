#!/usr/bin/env python3
"""props-v3b: tall-top crops, per-cell metrics, groups fragment and the WorldGen cell table.

Run from games/2026-08-29-duskhaul/ (after process-sheet.sh exported the 4 base sheets):
  uv run -q --with pillow --with numpy python art/briefs/v3-props-b/build.py

Tall-top method = art/briefs/v2-world/talltop.py (ArtWorld): each top cell is the base 256px cell with
every row at/below alignedBox.top + height//2 made transparent, so it registers pixel-for-pixel with
its base frame. Nothing is painted. Tall rule (scope: standing props in these 4 sheets): alignedBox
h >= 1.3 * w, or h >= 175 for an upright object whose top half rises over the hero.

Every alignedBox comes from the exported sprite-metadata.json; size/bodyRadius reproduce
src/data/props.ts toProp() (size = footprint*256/max(w,h); body = size*clamp(min(w,h)/256,.34,.68)/2,
cap 170) so WorldGen can check the numbers against the code.

Writes: public/assets/generated/props-v3b/props-<zone>-<d|e>-tall-top/, art/v2/ArtPropsB.groups.json,
art/briefs/v3-props-b/tables.md.
"""
import json
import os
import re
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, "art/briefs/v2-world")
from world import forbidden, hsl, rgb_to_lab  # noqa: E402

ROOT = "public/assets/generated/props-v3b"
GROUP = "props-v3b"
OWNER = "ArtPropsB"
CELL = 256
# sheet -> 9 x (name, shape class, size class, footprint px = on-field length of the long axis)
SHEETS = {
    "props-desert-d": [("sarcophagus", "wide", "L", 190), ("ramtotem", "tall", "M", 140), ("boulder", "round", "M", 145),
                       ("amphora", "small", "S", 100), ("fallencolumn", "wide", "M", 160), ("deadcactus", "tall", "M", 150),
                       ("hoodoo", "irregular", "L", 185), ("beastskull", "small", "S", 110), ("milestone", "small", "S", 100)],
    "props-desert-e": [("trough", "wide", "M", 155), ("sundial", "small", "S", 105), ("handcart", "wide", "M", 160),
                       ("deadacacia", "tall", "L", 200), ("crate", "small", "S", 100), ("tusk", "irregular", "M", 150),
                       ("ziggurat", "irregular", "L", 190), ("barrel", "round", "S", 95), ("petrifiedstump", "small", "S", 105)],
    "props-winter-d": [("frozenlog", "wide", "M", 160), ("signpost", "tall", "S", 110), ("boulder", "round", "M", 140),
                       ("barrel", "round", "S", 95), ("sarcophagus", "wide", "L", 190), ("stump", "small", "S", 105),
                       ("outcrop", "irregular", "L", 190), ("crate", "small", "S", 100), ("sapling", "tall", "S", 115)],
    "props-winter-e": [("woodpile", "wide", "M", 155), ("obelisk", "tall", "L", 190), ("cauldron", "round", "M", 130),
                       ("mammothskull", "irregular", "M", 160), ("anvil", "small", "S", 100), ("fallencolumn", "wide", "M", 155),
                       ("weaponrack", "wide", "M", 160), ("gravecross", "tall", "S", 110), ("helm", "round", "L", 185)],
}
ATTEMPTS = {"props-desert-d": 1}


def zone(sheet):
    return sheet.split("-")[1]


def meta(sheet):
    return json.load(open(f"{ROOT}/{sheet}/sprite-metadata.json"))


def is_tall(b):
    return b["height"] >= 1.3 * b["width"] or b["height"] >= 175


def to_prop(w, h, fp):
    size = round(fp * CELL / max(w, h))
    scale = min(0.68, max(0.34, min(w, h) / CELL))
    return size, min(170, round(size * scale / 2))


def cell_metrics(sheet, i):
    im = np.asarray(Image.open(f"{ROOT}/{sheet}/frames/frame-{i:03d}.png").convert("RGBA")).astype(np.float64)
    m = im[..., 3] > 0
    rgb = im[..., :3]
    L = rgb_to_lab(rgb)[..., 0][m]
    h, s, _l = hsl(rgb)
    forb = (forbidden(h) & (s > 0.30))[m].mean() * 100
    return float(np.median(L)), float(np.percentile(L, 25)), float(np.percentile(L, 75)), float(forb)


def talltop(sheet):
    out = f"{ROOT}/{sheet}-tall-top"
    os.makedirs(f"{out}/frames", exist_ok=True)
    m = meta(sheet)
    pairs = [(i, n) for i, (n, *_r) in enumerate(SHEETS[sheet]) if is_tall(m["frames"][i]["alignedBox"])]
    img = Image.new("RGBA", (CELL * 3, CELL * 3), (0, 0, 0, 0))
    frames = []
    for j in range(9):
        if j < len(pairs):
            i, name = pairs[j]
            box = m["frames"][i]["alignedBox"]
            cut = box["top"] + box["height"] // 2
            top = Image.open(f"{ROOT}/{sheet}/frames/frame-{i:03d}.png").convert("RGBA")
            top.paste((0, 0, 0, 0), (0, cut, CELL, CELL))
        else:
            i, name, box, cut = None, None, None, None
            top = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        bb = top.getbbox() or (0, 0, 0, 0)
        top.save(f"{out}/frames/frame-{j:03d}.png")
        img.alpha_composite(top, ((j % 3) * CELL, (j // 3) * CELL))
        frames.append({"index": j, "file": f"frames/frame-{j:03d}.png", "name": name,
                       "base": None if i is None else {"asset": sheet, "group": GROUP, "frame": i, "alignedBox": box},
                       "cutY": cut, "alignedBox": {"left": bb[0], "top": bb[1], "width": bb[2] - bb[0], "height": bb[3] - bb[1]},
                       "empty": bb == (0, 0, 0, 0), "unused": i is None})
    img.save(f"{out}/sprite-sheet.png")
    used = [f for f in frames if not f["unused"]]
    json.dump({
        "source": {"file": "derived: crop of base prop frames (see art/briefs/v3-props-b/build.py)", "provider": "derived",
                   "width": CELL * 3, "height": CELL * 3},
        "grid": {"rows": 3, "cols": 3},
        "output": {"cellSize": CELL, "durationMs": 0,
                   "derivation": "upper half of each tall base frame (rows above alignedBox.top + height//2), identical cell geometry"},
        "qc": {"strict": True, "passed": all(not f["empty"] for f in used), "failures": [],
               "notes": ["derived-crop: registers pixel-for-pixel with its base cell",
                         f"frames {len(used)}-8 unused (transparent); only {len(used)} tall props on {sheet}"]},
        "frames": frames,
    }, open(f"{out}/sprite-metadata.json", "w"), indent=2)
    return {pi: j for j, (pi, _n) in enumerate(pairs)}


def existing_icons():
    src = open("src/data/art.ts").read()
    return set(re.findall(r"^\s*'([a-z0-9-]+)':\s*\{\s*key:", src, re.M))


def main():
    taken = existing_icons()
    groups, rows, tall_rows, metric_rows = [], [], [], []
    for sheet, cells in SHEETS.items():
        z = zone(sheet)
        tmap = talltop(sheet)
        m = meta(sheet)
        tops = meta(f"{sheet}-tall-top")
        for i, (name, shape, sz, fp) in enumerate(cells):
            cid = f"{z}-{name}"
            assert cid not in taken, f"icon collision: {cid}"
            b = m["frames"][i]["alignedBox"]
            size, radius = to_prop(b["width"], b["height"], fp)
            assert radius <= 190
            j = tmap.get(i)
            pair = f"{sheet}-tall-top #{j}" if j is not None else "—"
            rows.append(f"| {cid} | {sheet} | {i} | {b['left']},{b['top']},{b['width']}x{b['height']} | [{b['width']}, {b['height']}] "
                        f"| {fp} | {size} | {radius} | {shape} | {sz} | yes | {pair} |")
            med, p25, p75, forb = cell_metrics(sheet, i)
            metric_rows.append(f"| {cid} | {med:.1f} | {p25:.1f}-{p75:.1f} | {forb:.2f} |")
            if j is not None:
                t = tops["frames"][j]
                tb = t["alignedBox"]
                tall_rows.append(f"| {sheet}-tall-top | {j} | {cid}-top | {sheet} ({GROUP}) | {i} | {t['cutY']} "
                                 f"| {tb['left']},{tb['top']},{tb['width']}x{tb['height']} |")
        base = {"id": sheet, "kind": "ui", "rows": 3, "cols": 3, "duration": 0,
                "icons": [f"{z}-{n}" for n, *_r in cells],
                "action": f"{z} standalone blockers {sheet[-1]}: " + ", ".join(n for n, *_r in cells)}
        if sheet in ATTEMPTS:
            base["attempts"] = ATTEMPTS[sheet]
        groups.append(base)
        inv = {j: i for i, j in tmap.items()}
        groups.append({"id": f"{sheet}-tall-top", "kind": "ui", "rows": 3, "cols": 3, "duration": 0,
                       "icons": [f"{z}-{cells[inv[j]][0]}-top" for j in sorted(inv)],
                       "action": f"{z} tall-prop upper halves of {sheet} for Y-sort occlusion (derived crops, registers 1:1 with base cells; frames {len(inv)}-8 unused)"})
    frag = {
        "owner": OWNER,
        "groups": [{"group": GROUP, "owner": OWNER, "assets": groups}],
        "qcExceptions": [
            {"id": f"{GROUP}/props-*-tall-top", "reason": "Derived, not generated: upper-half crops of the accepted base frames (art/briefs/v3-props-b/build.py) so the occluding top registers pixel-for-pixel with its base; unused trailing cells are transparent by design."},
            {"id": f"{GROUP}/props-*", "reason": "Keyed with a post-key defringe (art/briefs/v3-props-b/defringe.py): background-connected purple contact-shadow blobs and pink boundary pixels removed, nothing painted; boundary pink share falls from 12-54% to <=1.5%."},
        ],
    }
    json.dump(frag, open("art/v2/ArtPropsB.groups.json", "w"), indent=2)
    hdr = ("| id | sheet | cell | alignedBox (l,t,wxh) | cell [w,h] | footprint px | size (toProp) | bodyRadius | shape | size class | blocking | tall-top pair |\n"
           "|---|---|---|---|---|---|---|---|---|---|---|---|")
    thdr = ("| tall-top sheet | frame | top icon | base sheet (group) | base frame | cutY | top alignedBox |\n"
            "|---|---|---|---|---|---|---|")
    mhdr = "| id | L* median (opaque px) | L* p25-p75 | forbidden-hue % |\n|---|---|---|---|"
    open("art/briefs/v3-props-b/tables.md", "w").write(
        "## Prop cells\n\n" + hdr + "\n" + "\n".join(rows) + "\n\n## Tall-top pairs\n\n" + thdr + "\n" + "\n".join(tall_rows)
        + "\n\n## Cell values\n\n" + mhdr + "\n" + "\n".join(metric_rows) + "\n")
    print("\n".join(rows))
    print("\n".join(tall_rows))
    print("\n".join(metric_rows))


if __name__ == "__main__":
    main()
