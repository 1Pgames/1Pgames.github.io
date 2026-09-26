#!/usr/bin/env python3
"""Deterministic chroma pre-clean for xai icon raws (ArtIcons, V2).

xai returns the requested #FF00FF as a hot pink (~rgb(251,51,184)) plus JPEG
blend fringes. Keying that against pure magenta at the default threshold (180)
also deletes the set's violet/lilac glows (#c084fc is 146 from magenta), and
binding the style profile's chroma guard instead PROTECTS the pink fringe, which
then ships as a pink halo and stray edge specks (measured on icons-wpn-a:
60,300 protected px, 4 source-edge-touch frames).

This script samples the actual background from the canvas border (median), then
  1. maps every pixel within --bg-dist of that colour to pure #FF00FF;
  2. despills the fringe: a pixel within --fringe-dist of the bg that is
     magenta-leaning (min(r,b) - g > --spill) and red-leaning (r > 0.9 b) is
     mapped to #FF00FF; palette violets have b >> r and survive.
  3. --flood 1 (only for sheets whose objects ALL carry a dark outline): xai
     sometimes paints a warm/pink glow halo into the background around each
     object. A BFS seeded from every pixel keyed in steps 1-2 (the border AND
     the enclosed holes of rings/chains, which are bg-coloured at their centre)
     walks every pixel that is magenta-to-orange (r > 150 and r - g > 60) and
     brighter than the outline (luma > 70); it stops at the near-black outline,
     so enclosed object pixels with no key colour inside are never reached.
  4. --grid N (optional): xai sometimes draws a thick dark divider cross on the
     N x N cell boundaries. For every row/column within 24 px of an internal
     boundary, if >= 80% of that full-length line is dark (luma < 60) or key,
     its dark pixels are keyed. Art never spans 80% of the canvas, so only the
     divider qualifies.
Nothing is drawn; pixels only ever become key colour. Usage:
  normalize-key.py <in> <out.png> [--bg-dist 70] [--fringe-dist 150] [--spill 90] [--flood 1] [--grid N]
"""
import sys
from collections import deque
from statistics import median

from PIL import Image

KEY = (255, 0, 255)


def main() -> None:
    args = sys.argv[1:]
    src, dst = args[0], args[1]
    opts = {"--bg-dist": 70.0, "--fringe-dist": 150.0, "--spill": 90.0, "--flood": 0.0, "--grid": 0.0}
    for i in range(2, len(args), 2):
        opts[args[i]] = float(args[i + 1])
    im = Image.open(src).convert("RGB")
    w, h = im.size
    px = im.load()
    border = [px[x, y] for x in range(0, w, 7) for y in (2, h - 3)] + [
        px[x, y] for y in range(0, h, 7) for x in (2, w - 3)
    ]
    bg = tuple(int(median(c[i] for c in border)) for i in range(3))
    bd2 = opts["--bg-dist"] ** 2
    fd2 = opts["--fringe-dist"] ** 2
    spill = opts["--spill"]
    n_bg = n_fr = n_fl = n_dv = 0
    grid = int(opts["--grid"])
    if grid > 1:

        def dark(p: tuple) -> bool:
            return p == KEY or 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] < 60

        for k in range(1, grid):
            for off in range(-24, 25):
                y = round(h * k / grid) + off
                if 0 <= y < h and sum(dark(px[x, y]) for x in range(w)) >= 0.8 * w:
                    for x in range(w):
                        if dark(px[x, y]) and px[x, y] != KEY:
                            px[x, y] = KEY
                            n_dv += 1
                x = round(w * k / grid) + off
                if 0 <= x < w and sum(dark(px[x, y]) for y in range(h)) >= 0.8 * h:
                    for y in range(h):
                        if dark(px[x, y]) and px[x, y] != KEY:
                            px[x, y] = KEY
                            n_dv += 1
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            d2 = (r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2
            if d2 < bd2:
                px[x, y] = KEY
                n_bg += 1
            elif d2 < fd2 and min(r, b) - g > spill and r > b * 0.9:
                px[x, y] = KEY
                n_fr += 1
            elif min(r, b) > 15 and g < 0.3 * min(r, b) and r > 0.8 * b:
                # shadowed magenta at any brightness (xai's faint dark divider
                # traces on cell boundaries); no palette colour has g ~ 0 with r ~ b
                px[x, y] = KEY
                n_fr += 1
    if opts["--flood"]:
        seen = bytearray(w * h)
        q = deque()
        for y in range(h):
            for x in range(w):
                if px[x, y] == KEY:
                    q.append((x, y))
        while q:
            x, y = q.popleft()
            i = y * w + x
            if seen[i]:
                continue
            seen[i] = 1
            r, g, b = px[x, y]
            if (r, g, b) != KEY:
                if not (r > 150 and r - g > 60 and 0.299 * r + 0.587 * g + 0.114 * b > 70):
                    continue
                px[x, y] = KEY
                n_fl += 1
            if x > 0:
                q.append((x - 1, y))
            if x < w - 1:
                q.append((x + 1, y))
            if y > 0:
                q.append((x, y - 1))
            if y < h - 1:
                q.append((x, y + 1))
    im.save(dst)
    print(f"bg={bg} keyed_bg={n_bg} keyed_fringe={n_fr} keyed_flood={n_fl} keyed_divider={n_dv}")


if __name__ == "__main__":
    main()
