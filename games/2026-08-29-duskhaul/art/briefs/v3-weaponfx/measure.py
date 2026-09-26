#!/usr/bin/env python3
"""Wiring measurements for weapon-fx-v1 (repro record for the numbers in ArtWeaponFx.progress.md).

- scythe crescent: circle fitted to the OUTER rim of each frame (the cutting edge), so code can put
  the swinger at the arc's centre and scale the arc to the hit radius.
- rail / hex strips: opaque x-span per frame (columns with >= 3 opaque px, ignores stray flecks).
- bolt: opaque bbox.
Usage (cwd = games/2026-08-29-duskhaul): python3 art/briefs/v3-weaponfx/measure.py
"""
from PIL import Image

ROOT = "public/assets/generated/weapon-fx-v1"


def mask(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    a = im.getchannel("A").load()
    return w, h, [[a[x, y] > 40 for x in range(w)] for y in range(h)]


def solve3(m, v):
    # Cramer's rule for the 3x3 normal equations.
    def det(a):
        return (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
                - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
                + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]))
    d = det(m)
    out = []
    for i in range(3):
        mi = [row[:] for row in m]
        for r in range(3):
            mi[r][i] = v[r]
        out.append(det(mi) / d)
    return out


def fit_circle(pts):
    # x^2 + y^2 = 2ax + 2by + c  (Kasa fit)
    rows = [(2 * x, 2 * y, 1.0, x * x + y * y) for x, y in pts]
    m = [[sum(r[i] * r[j] for r in rows) for j in range(3)] for i in range(3)]
    v = [sum(r[i] * r[3] for r in rows) for i in range(3)]
    a, b, c = solve3(m, v)
    return a, b, (c + a * a + b * b) ** 0.5


for f in range(3):
    w, h, m = mask(f"{ROOT}/wpn-scythe/frames/frame-{f:03d}.png")
    outer = []
    xs, ys = [], []
    for y in range(h):
        row = [x for x in range(w) if m[y][x]]
        if row:
            outer.append((max(row), y))
            xs += [min(row), max(row)]
            ys.append(y)
    cx, cy, r = fit_circle(outer)
    print(f"wpn-scythe f{f}: bbox x {min(xs)}-{max(xs)} y {min(ys)}-{max(ys)}; outer-rim circle "
          f"centre ({cx:.1f},{cy:.1f}) R {r:.1f} px = cx {cx / w:.3f} cy {cy / h:.3f} R {r / w:.3f} of cell")

for aid in ("wpn-rail", "wpn-rail-evo", "wpn-hex", "wpn-hex-evo"):
    w, h, m = mask(f"{ROOT}/{aid}/sprite-sheet.png")
    ch = h // 3
    for f in range(3):
        band = m[f * ch:(f + 1) * ch]
        cols = [x for x in range(w) if sum(row[x] for row in band) >= 3]
        rows = [y for y in range(ch) if any(band[y])]
        print(f"{aid} f{f}: core x {cols[0]}-{cols[-1]} of {w} = {cols[0] / w:.3f}-{(cols[-1] + 1) / w:.3f}; "
              f"y {rows[0]}-{rows[-1]} of {ch}")

for aid in ("wpn-bolt", "wpn-bolt-evo"):
    w, h, m = mask(f"{ROOT}/{aid}/frames/frame-000.png")
    pts = [(x, y) for y in range(h) for x in range(w) if m[y][x]]
    print(f"{aid}: bbox x {min(p[0] for p in pts)}-{max(p[0] for p in pts)} "
          f"y {min(p[1] for p in pts)}-{max(p[1] for p in pts)} of {w}x{h}")
