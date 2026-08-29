#!/usr/bin/env python3
"""Crop the magenta frame xai welds around a full-bleed texture swatch, take the
largest centred square of the remaining texture, and write it as a PNG that
process-sprite.ts can turn into a 100%-opaque tile at --fit 1."""
import sys
from PIL import Image


def magenta(px):
    r, g, b = px[0], px[1], px[2]
    return min(r, b) - g > 24 and (255 - r) ** 2 + g ** 2 + (255 - b) ** 2 < 180 ** 2


def main(src, dst, inset=2):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    px = im.load()
    # walk in from each edge while the row/column is majority magenta
    def row_magenta(y):
        return sum(magenta(px[x, y]) for x in range(0, w, 4)) > (w // 4) * 0.5

    def col_magenta(x):
        return sum(magenta(px[x, y]) for y in range(0, h, 4)) > (h // 4) * 0.5

    top = 0
    while top < h // 3 and row_magenta(top):
        top += 1
    bottom = h - 1
    while bottom > 2 * h // 3 and row_magenta(bottom):
        bottom -= 1
    left = 0
    while left < w // 3 and col_magenta(left):
        left += 1
    right = w - 1
    while right > 2 * w // 3 and col_magenta(right):
        right -= 1
    # inset past the anti-aliased fringe of the magenta frame: any surviving
    # near-magenta pixel becomes a visible hairline once the tile repeats
    top += inset
    left += inset
    bottom -= inset
    right -= inset
    iw, ih = right - left + 1, bottom - top + 1
    side = min(iw, ih)
    cx, cy = left + iw // 2, top + ih // 2
    x0, y0 = cx - side // 2, cy - side // 2
    im.crop((x0, y0, x0 + side, y0 + side)).save(dst)
    print(f"frame=({left},{top})-({right},{bottom}) inner={iw}x{ih} square={side} -> {dst}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 2)
