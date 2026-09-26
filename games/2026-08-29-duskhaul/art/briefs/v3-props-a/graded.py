#!/usr/bin/env python3
"""Review props-v3a THROUGH the runtime grade (post-review pixel transform).

arena.ts tints every scenery sprite with the floor grade: scaleColor(FLOOR_GRADE[zone], lighting.gradeMul)
= 0xd9d9d9 * 0.85 = 0xb8b8b8 multiply for castle/outlands. This script applies that multiply offline and
reports, per cell, graded L* p50/p75 and the share of prop pixels brighter than the graded floor's p99 L*.

Run from games/2026-08-29-duskhaul/:  uv run -q --with pillow python art/briefs/v3-props-a/graded.py
"""
from PIL import Image

from build import SHEETS, lstar

GRADE = 0xB8 / 255
G = "public/assets/generated"


def lvals(im, grade):
    return sorted(lstar(r * grade, g * grade, b * grade) for r, g, b, a in im.convert("RGBA").get_flattened_data() if a >= 128)


for zone in ("castle", "outlands"):
    floor = []
    for v in "abc":
        floor += lvals(Image.open(f"{G}/floors-v2/floor-{zone}-{v}/sprite.png").resize((128, 128)), GRADE)
    floor.sort()
    fp50, fp99 = floor[len(floor) // 2], floor[int(len(floor) * 0.99)]
    print(f"{zone}: graded floor L* p50 {fp50:.1f} p99 {fp99:.1f}")
    for sheet, rows in SHEETS.items():
        if zone not in sheet:
            continue
        for i, (name, *_r) in enumerate(rows):
            ls = lvals(Image.open(f"{G}/props-v3a/{sheet}/frames/frame-{i:03d}.png"), GRADE)
            above = sum(1 for x in ls if x > fp99) / len(ls)
            print(f"  {zone}-{name:18s} graded L* p50 {ls[len(ls)//2]:5.1f} p75 {ls[3*len(ls)//4]:5.1f}  above-floor-p99 {above:5.1%}")
