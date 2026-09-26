#!/usr/bin/env python3
"""Deterministic raw cleanup for provider layout artifacts (repro record, no art is drawn).

xai sometimes welds non-art layout chrome into a grid sheet: solid divider lines between cells,
or a white page border around the magenta panels. Those pixels are not subject and not key colour,
so the keyer keeps them and the per-cell bbox spans the whole cell. This script replaces ONLY those
measured bands with the raw's own median border key colour (or crops the border off losslessly),
after asserting the band holds no art pixels. Every other pixel is byte-for-byte the provider's.

Usage (cwd = games/2026-08-29-duskhaul):  python3 art/briefs/v3-weaponfx/clean.py
Reads raw/<id>.src.jpg, writes raw/<id>.png.
"""
import os
from PIL import Image

RAW = os.path.join(os.getcwd(), "art/briefs/v3-weaponfx/raw")

# id -> (crop box or None, [(x0, y0, x1, y1[, maxArt]) bands to key-fill])  measured on the .src raw.
# maxArt defaults to 40 (divider fringe only); a larger budget is an explicit, commented decision.
OPS = {
    # 2x2 sheet: 1px-ish black divider cross at x 498-502 and y 510-513
    "wpn-nova": (None, [(494, 0, 507, 1024), (0, 506, 1024, 518)]),
    # 1x3 sheet: white page border above y 218 / below y 806, white dividers x 333-341 and 682-690
    "wpn-scythe": ((0, 220, 1024, 805), [(329, 0, 346, 585), (678, 0, 695, 585)]),
    # 1x3 sheet: white dividers x 335-340 and 683-687 (no page border this time); plus the 7px
    # left canvas border, where ~70 px of stray tatter flecks were already cut off by the canvas
    # edge (ring body starts at x 20) — erased so the frame does not source-edge-touch.
    "wpn-scythe-evo": (None, [(331, 0, 345, 1024), (679, 0, 692, 1024), (0, 0, 8, 1024, 90)]),
}


def is_key(p):
    r, g, b = p
    return min(r, b) - g > 40 and r > 150 and b > 100 and g < 120


def is_art(p):
    """Subject pixels in this set are grey ash / cyan / bone: green channel well above the key's.
    Key, dark-magenta line fringe (low green), near-black dividers and near-white border are not art."""
    r, g, b = p
    return g > 90 and min(p) <= 200 and not (r - g > 50 and b - g > 30 and r >= b - 10)


def key_colour(im):
    w, h = im.size
    pts = [im.getpixel((x, y)) for x in range(8, w - 8, 16) for y in (4, h - 5)]
    pts = [p for p in pts if is_key(p)]
    return tuple(sorted(c[i] for c in pts)[len(pts) // 2] for i in range(3))


for aid, (crop, bands) in OPS.items():
    src = os.path.join(RAW, aid + ".src.jpg")
    im = Image.open(src).convert("RGB")
    if crop:
        im = im.crop(crop)
    key = key_colour(im)
    px = im.load()
    for band in bands:
        x0, y0, x1, y1 = band[:4]
        budget = band[4] if len(band) > 4 else 40
        art = sum(1 for x in range(x0, x1) for y in range(y0, y1) if is_art(px[x, y]))
        assert art < budget, f"{aid}: band {x0},{y0},{x1},{y1} holds {art} art pixels, refusing"
        for x in range(x0, x1):
            for y in range(y0, y1):
                px[x, y] = key
    out = os.path.join(RAW, aid + ".png")
    im.save(out)
    print(f"{aid}: key {key} crop {crop} bands {len(bands)} -> {out} {im.size}")
