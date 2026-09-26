#!/usr/bin/env python3
"""Deterministic raw cleanup for provider layout artifacts (repro record, no art is drawn).

xai welds non-art layout chrome into grid sheets: solid black/white divider lines between cells,
and black letterbox bars on the canvas edge. Those pixels are neither subject nor key colour, so
the keyer keeps them and every cell's bbox spans the whole cell. This script finds full-length
chrome lines by MEASUREMENT (a row/column whose pixels are >= 85% near-black or near-white), widens
each by 3 px of fringe, skips any band holding >= 3% art pixels (it is not a divider), and replaces only that band with the
raw's own median key colour. An optional lossless crop (CROP) removes provider-welded end caps.
Every other pixel is byte-for-byte the provider's.

Usage (cwd = games/2026-08-29-duskhaul):  python3 art/briefs/v4-arsenal-fx/clean.py <id> [...]
Reads the raw named in assets.json, writes raw/<id>.clean.png and prints the bands it filled.
"""
import os, sys
from PIL import Image

RAW = os.path.join(os.getcwd(), "art/briefs/v4-arsenal-fx/raw")

# id -> lossless crop box, measured on the raw (x0, y0, x1, y1).
CROP = {
    # wpn-siphon gen 2: xai capped both beam ends with bone knobs + a cyan line to the canvas edge
    # (breaks end-to-end repetition in code). Cropped inside the caps; the braid then runs to the
    # crop edge by design (a tiled beam segment), exported with allow-source-edge-touch.
    "wpn-siphon": (190, 0, 840, 1024),
}

# id -> (grid rows, grid cols, [cells]) whose subject the provider drew facing LEFT.
MIRROR = {
    "wpn-thralls-bite": (2, 2, [3]),  # frame 4 (recoil) came back facing left
}

# id -> (raw grid rows, raw grid cols, [cell indices]) for the 5-frame one-shots. xai does not
# honour a 1x5 strip for radial bursts (a1: bursts crossed cells) nor a 2x3 grid (returned 3x3 or
# 4x3). It is asked for the grid it honours, and the listed provider cells are laid side by side,
# unaltered, into the 1x5 strip the processor slices. Selection = the 5 cells that read as
# ignite -> peak -> scatter -> fade, chosen by eye on the raw (see assets.json rawNote).
RETILE = {
    "wpn-snares-blast": (3, 3, [0, 1, 2, 6, 7]),
    "wpn-snares-blast-evo": (3, 3, [0, 1, 2, 6, 7]),
    "wpn-bombs-blast": (4, 3, [1, 2, 3, 4, 5]),
    # non-uniform panels (top row 336 px, bottom row 688 px): explicit measured 341x336 boxes
    "wpn-bombs-blast-evo": [(0, 0, 341, 336), (341, 0, 682, 336), (683, 0, 1024, 336),
                            (0, 512, 341, 848), (683, 512, 1024, 848)],
    "wpn-totem-pulse": (4, 3, [0, 2, 3, 8, 11]),
    "wpn-totem-pulse-evo": (4, 3, [0, 1, 2, 4, 6]),
    "wpn-thralls-evo-burst": (3, 3, [0, 1, 2, 3, 7]),
}


def is_key(p):
    r, g, b = p
    return min(r, b) - g > 40 and r > 150 and b > 100 and g < 130


def is_chrome(p):
    """Layout chrome, measured on this set's raws: near-black / near-white dividers, the dark
    key-hued letterbox (74,0,44) and dim key-hued divider lines (162,44,118). Only ever acted on as
    a FULL-LENGTH line (>= 85% of a row/column; 60% caught the thralls' welded contact-shadow row), never per pixel."""
    r, g, b = p
    return max(p) < 90 or min(p) > 215 or (min(r, b) - g > 40 and max(r, b) < 200)

def is_art(p):
    """Same measured definition as v3 clean.py: subject pixels in this set (bone, cyan, violet,
    pale grey) carry green well above the key's; key, dark-magenta line fringe and chrome do not."""
    r, g, b = p
    return g > 90 and min(p) <= 215 and not (r - g > 50 and b - g > 30 and r >= b - 10)


def key_colour(im):
    w, h = im.size
    px = im.load()
    pts = [px[x, y] for x in range(0, w, 7) for y in range(0, h, 7)]
    pts = [p for p in pts if is_key(p)]
    return tuple(sorted(c[i] for c in pts)[len(pts) // 2] for i in range(3))


def lines(px, n_major, n_minor, get):
    hits = []
    for i in range(n_major):
        c = sum(1 for j in range(0, n_minor, 2) if is_chrome(get(px, i, j)))
        if c >= 0.85 * (n_minor / 2):
            hits.append(i)
    bands = []
    for i in hits:
        if bands and i <= bands[-1][1] + 2:
            bands[-1][1] = i
        else:
            bands.append([i, i])
    return [(max(0, a - 3), min(n_major, b + 4)) for a, b in bands]


def clean(aid, raw):
    im = Image.open(raw).convert("RGB")
    if aid in CROP:
        im = im.crop(CROP[aid])
    w, h = im.size
    px = im.load()
    key = key_colour(im)
    cols = lines(px, w, h, lambda p, i, j: p[i, j])
    rows = lines(px, h, w, lambda p, i, j: p[j, i])
    filled = []
    for (a, b) in cols:
        art = sum(1 for x in range(a, b) for y in range(h) if is_art(px[x, y]))
        if art >= 0.03 * (b - a) * h:  # holds art: not a divider (e.g. welded contact shadows) -> untouched
            filled.append(("x-skipped", a, b, art))
            continue
        for x in range(a, b):
            for y in range(h):
                px[x, y] = key
        filled.append(("x", a, b, art))
    for (a, b) in rows:
        art = sum(1 for y in range(a, b) for x in range(w) if is_art(px[x, y]))
        if art >= 0.03 * (b - a) * w:
            filled.append(("y-skipped", a, b, art))
            continue
        for y in range(a, b):
            for x in range(w):
                px[x, y] = key
        filled.append(("y", a, b, art))
    if aid.startswith("wpn-thralls") and aid != "wpn-thralls-evo-burst":
        # xai welds a dim magenta contact-shadow ellipse under grounded actors (measured on every
        # thrall raw; the prompt's "flat magenta beneath the feet" did not clear it). Those pixels
        # are key-hued and red-leaning (r > b), so after keying they survive as a hot-pink strip.
        # They are returned to the key colour so the keyer removes them. Thrall art (grey-blue
        # bone, cyan eyes, ochre rag, violet runes with b > r) never matches.
        n = 0
        for y in range(h):
            for x in range(w):
                r, g, b = px[x, y]
                if r > b + 5 and min(r, b) - g > 40:
                    px[x, y] = key
                    n += 1
        filled.append(("shadow-keyed", n))
    if aid in MIRROR:
        # Provider flipped the subject's facing in these cells; each cell is mirrored in place
        # (lossless geometric transform of the provider's own pixels) so every frame faces RIGHT.
        gr, gc, cells = MIRROR[aid]
        cw, ch = w // gc, h // gr
        for c in cells:
            box = ((c % gc) * cw, (c // gc) * ch, (c % gc + 1) * cw, (c // gc + 1) * ch)
            im.paste(im.crop(box).transpose(Image.FLIP_LEFT_RIGHT), box[:2])
        filled.append(("mirrored", MIRROR[aid]))
    if aid in RETILE:
        spec = RETILE[aid]
        if isinstance(spec, tuple):
            gr, gc, cells = spec
            cw, ch = w // gc, h // gr
            boxes = [((c % gc) * cw, (c // gc) * ch, (c % gc + 1) * cw, (c // gc + 1) * ch) for c in cells]
        else:
            boxes = spec
            cw, ch = boxes[0][2] - boxes[0][0], boxes[0][3] - boxes[0][1]
        strip = Image.new("RGB", (cw * len(boxes), ch), key)
        for k, (x0, y0, x1, y1) in enumerate(boxes):
            strip.paste(im.crop((x0, y0, x0 + cw, y0 + ch)), (k * cw, 0))
        im = strip
        filled.append(("retile", spec))
    out = os.path.join(RAW, aid + ".clean.png")
    im.save(out)
    print(f"{aid}: key {key} crop {CROP.get(aid)} size {im.size} bands {filled} -> {os.path.basename(out)}")
    return out


if __name__ == "__main__":
    import json
    rows = {a["id"]: a for a in json.load(open(os.path.join(os.path.dirname(RAW), "assets.json")))}
    for aid in sys.argv[1:]:
        clean(aid, os.path.join(os.getcwd(), rows[aid]["raw"]))
