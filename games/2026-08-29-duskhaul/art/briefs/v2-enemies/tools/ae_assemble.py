"""Assemble four generated 1024x1024 frames (row-major) into one 2x2 raw sheet.

Deterministic layout only: every frame is CROPPED (translation only, never
scaled) to a square of the character's shared side length (from
/tmp/ae/<char>.box.json), centred on that frame's own subject with the subject's
lowest point at 0.86 of the side. One side per character = one source cell size,
one camera distance for every animation of that character.

usage: ae_assemble.py <char> <out.png> f1 f2 f3 f4 [--side N]
"""
import json
import sys

from PIL import Image


def is_key(r, g, b):
    return r > 150 and b > 100 and g < 130 and min(r, b) - g > 60


def bbox(im):
    W, H = im.size
    px = im.load()
    xs, ys = [], []
    for y in range(8, H - 8, 2):
        for x in range(8, W - 8, 2):
            if not is_key(*px[x, y]):
                xs.append(x)
                ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


args = sys.argv[1:]
side_override = None
if "--side" in args:
    i = args.index("--side")
    side_override = int(args[i + 1])
    del args[i : i + 2]
char, out, *frames = args
assert len(frames) == 4, "need 4 frames"
side = side_override or json.load(open(f"/tmp/ae/{char}.box.json"))["side"]
sheet = Image.new("RGB", (side * 2, side * 2), (255, 0, 255))
for i, p in enumerate(frames):
    im = Image.open(p).convert("RGB")
    assert im.size == (1024, 1024), f"{p} is {im.size}"
    l, t, r, b = bbox(im)
    cx = (l + r) // 2
    x0 = cx - side // 2
    y0 = int(b - 0.86 * side)
    tile = Image.new("RGB", (side, side), im.getpixel((2, 2)))
    # paste the frame translated; areas outside the source keep its own key colour
    tile.paste(im, (-x0, -y0))
    sheet.paste(tile, ((i % 2) * side, (i // 2) * side))
sheet.save(out)
print(out, sheet.size, "side", side)
