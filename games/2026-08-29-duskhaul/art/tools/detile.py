#!/usr/bin/env python3
"""Crop xai's welded magenta frame off a full-bleed swatch, and trim to clean texture.

Usage: python3 detile.py <raw.jpg> <out.png> [--inset N]

xai welds a flat magenta border (measured 45-76px on this project) around every full-bleed
tile it generates. The magenta-key pass then turns that border into transparency, which is
why such a tile exports "clean" yet reports minAlpha 0 and cannot tile. The documented fix is
to detile to the inner rect and keep the intermediate beside the raw -- never to drop the
style anchor and never to relax QC.

This finds the inner rect by scanning in from each edge for the first line that is not
predominantly magenta, then applies an extra `--inset` (default 10px) because the frame's
inner boundary carries JPEG ringing and, on desert v7, a cluster of black speckle artifacts
welded to the frame edge -- both of which would otherwise survive into the tile as the very
"contains black" defect the zone forbids.
"""
import sys

from PIL import Image


def is_magenta(rgb: tuple[int, int, int]) -> bool:
    # xai's welded frame measures (250, 3, 155) on this project -- a PINK magenta whose blue
    # channel sits near 155, so a naive `b > 160` pure-#FF00FF test misses the frame entirely.
    r, g, b = rgb
    return r > 180 and g < 100 and b > 120


def first_clean(pixels: list[tuple[int, int, int]]) -> bool:
    hits = sum(1 for p in pixels if is_magenta(p))
    return hits < len(pixels) * 0.5


def is_black_bar(pixels: list[tuple[int, int, int]]) -> bool:
    """xai's OTHER full-bleed defect: an opaque near-black letterbox instead of a key frame.

    Measured on winter v4: rows 0-11 and 1012-1023 of the raw were RGB ~(0,0,1). Those bars
    survive keying (they are opaque, so minAlpha still reports 255) and then read as hard
    black lines along every tile seam once the texture repeats -- and on the desert zone they
    would also violate its no-black rule outright.
    """
    return sum(1 for r, g, b in pixels if max(r, g, b) < 24) > len(pixels) * 0.7


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    inset = int(sys.argv[sys.argv.index("--inset") + 1]) if "--inset" in sys.argv else 10

    im = Image.open(src).convert("RGB")
    w, h = im.size
    step = 4

    def col(x: int) -> list:
        return [im.getpixel((x, y)) for y in range(0, h, step)]

    def row(y: int) -> list:
        return [im.getpixel((x, y)) for x in range(0, w, step)]

    left = next((x for x in range(w // 3) if first_clean(col(x))), 0)
    right = next((x for x in range(w - 1, 2 * w // 3, -1) if first_clean(col(x))), w - 1)
    top = next((y for y in range(h // 3) if first_clean(row(y))), 0)
    bottom = next((y for y in range(h - 1, 2 * h // 3, -1) if first_clean(row(y))), h - 1)

    # Then trim any opaque black letterbox inside whatever the key-frame scan left.
    while left < right and is_black_bar(col(left)):
        left += 1
    while right > left and is_black_bar(col(right)):
        right -= 1
    while top < bottom and is_black_bar(row(top)):
        top += 1
    while bottom > top and is_black_bar(row(bottom)):
        bottom -= 1

    box = (left + inset, top + inset, right + 1 - inset, bottom + 1 - inset)
    print(f"frame: left={left} top={top} right={w - 1 - right} bottom={h - 1 - bottom}")
    print(f"inner rect (inset {inset}): {box} -> {box[2] - box[0]}x{box[3] - box[1]}")

    # A full-bleed tile MUST be square: the 1x1 export path letterboxes a non-square image
    # into a square cellSize canvas, which leaves transparent side bars and pins minAlpha at
    # 0 no matter what --fit says. Centre-crop to the shorter side instead.
    side = min(box[2] - box[0], box[3] - box[1])
    cx, cy = (box[0] + box[2]) // 2, (box[1] + box[3]) // 2
    square = (cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)
    print(f"square crop: {square} -> {side}x{side}")
    im.crop(square).save(dst)
    print(f"wrote {dst}")


if __name__ == "__main__":
    main()
