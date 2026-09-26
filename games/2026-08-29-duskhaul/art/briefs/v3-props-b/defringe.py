#!/usr/bin/env python3
"""Key-fringe cleanup + metric for props-v3b sheets (deterministic keying step, paints nothing).

Run from games/2026-08-29-duskhaul/:
  uv run -q --with pillow python art/briefs/v3-props-b/defringe.py <exportDir> [--measure-only]

Why: xai's background is a JPEG pink-magenta (~#FF40E0), so the antialiased rim between a warm
subject (sand, bone) and the key blends to salmon/pink that sits OUTSIDE the magenta distance the
keyer removes. It reads as a red rim at render scale (user brief: "no red/green rims"). xai also
paints the requested contact shadow onto the key as a DARK MAGENTA/PURPLE blob beside the object,
which is far from #FF00FF in RGB distance and survives keying whole.

Step 1 (shadow flood): from every transparent pixel, flood through opaque pixels whose hue is
magenta/purple (HSV hue 275-335 deg, saturation >= 0.18), any value, and make them transparent. No
prop in this group carries a magenta/purple material, so this band is key-only by construction.
Step 2 (rim): up to PASSES times, every opaque pixel on the alpha boundary whose hue is
pink/red-violet (hue >= 285 or <= 12 deg) with saturation >= 0.22 is made transparent.
Only background-connected pixels are touched; interior art is never altered, nothing is painted.
Then the sheet is rebuilt from the frames and each frame's alignedBox is re-measured into
sprite-metadata.json.
"""
import colorsys
import json
import sys

from PIL import Image

PASSES = 3
CELL = 256


def hsv(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return h * 360, s, v


def is_pink(r, g, b):
    deg, s, v = hsv(r, g, b)
    return s >= 0.22 and v > 0.25 and (deg >= 285 or deg <= 12)


def is_purple(r, g, b):
    deg, s, _v = hsv(r, g, b)
    return s >= 0.18 and 275 <= deg <= 335


def boundary(px, w, h, x, y):
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if nx < 0 or ny < 0 or nx >= w or ny >= h or px[nx, ny][3] == 0:
            return True
    return False


def measure(im):
    w, h = im.size
    px = im.load()
    edge = bad = 0
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            if p[3] and boundary(px, w, h, x, y):
                edge += 1
                bad += is_pink(*p[:3])
    return edge, bad


def clean(im):
    w, h = im.size
    px = im.load()
    removed = 0
    stack = [(x, y) for y in range(h) for x in range(w)
             if px[x, y][3] and is_purple(*px[x, y][:3]) and boundary(px, w, h, x, y)]
    while stack:
        x, y = stack.pop()
        if not px[x, y][3]:
            continue
        px[x, y] = (0, 0, 0, 0)
        removed += 1
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] and is_purple(*px[nx, ny][:3]):
                stack.append((nx, ny))
    for _ in range(PASSES):
        kill = [(x, y) for y in range(h) for x in range(w)
                if px[x, y][3] and is_pink(*px[x, y][:3]) and boundary(px, w, h, x, y)]
        if not kill:
            break
        for x, y in kill:
            px[x, y] = (0, 0, 0, 0)
        removed += len(kill)
    return removed


def main(out, measure_only):
    meta_path = f"{out}/sprite-metadata.json"
    meta = json.load(open(meta_path))
    rows, cols = meta["grid"]["rows"], meta["grid"]["cols"]
    sheet = Image.open(f"{out}/sprite-sheet.png").convert("RGBA")
    e0, b0 = measure(sheet)
    if measure_only:
        print(f"{out}: boundary {e0} pink {b0} ({100 * b0 / max(e0, 1):.2f}%)")
        return
    total = 0
    sheet = Image.new("RGBA", (CELL * cols, CELL * rows), (0, 0, 0, 0))
    for f in meta["frames"]:
        path = f"{out}/{f['file']}"
        im = Image.open(path).convert("RGBA")
        total += clean(im)
        im.save(path)
        bb = im.getbbox() or (0, 0, 0, 0)
        f["alignedBox"] = {"left": bb[0], "top": bb[1], "width": bb[2] - bb[0], "height": bb[3] - bb[1]}
        sheet.alpha_composite(im, ((f["index"] % cols) * CELL, (f["index"] // cols) * CELL))
    sheet.save(f"{out}/sprite-sheet.png")
    e1, b1 = measure(sheet)
    note = (f"defringe: removed {total} pink boundary px (art/briefs/v3-props-b/defringe.py); "
            f"boundary pink {100 * b0 / max(e0, 1):.2f}% -> {100 * b1 / max(e1, 1):.2f}%")
    meta["qc"].setdefault("notes", []).append(note)
    json.dump(meta, open(meta_path, "w"), indent=2)
    print(f"{out}: {note}")


if __name__ == "__main__":
    main(sys.argv[1], "--measure-only" in sys.argv[2:])
