#!/usr/bin/env python3
"""ArtWorld (Duskhaul V2) deterministic tooling for floors/roads/splats/props/landmarks.

Run with numpy + pillow:  uv run -q --with numpy --with pillow python art/briefs/v2-world/world.py <cmd> ...

Nothing here paints: every command SELECTS or REMAPS generated pixels, or MEASURES them.

  bestcrop <raw> <out.png> [--min 768] [--max N] [--step 8]
      --min/--max bound the window size, which sets stone pitch at 256px (PRD-V2 §3.7 32-40px).
      Seamless-crop search on a full-bleed raw: finds the square window whose opposite edges
      continue into each other best (wrap diff / interior noise floor). Region SELECTION only,
      same class as art/tools/detile.py. Also skips xai's welded magenta frame / black letterbox
      because such borders never wrap cleanly against interior texture.
  tonefit <in.png> <out.png> [--mean 25] [--lo 14] [--hi 36] [--sat 0.22]
      PRD-V2 §3.7 value-band fit in CIELAB: affine L* remap so mean L* = --mean and the
      p1..p99 span sits inside [--lo, --hi] (grout never < 12 / > 38), chroma scaled so mean HSL
      saturation <= --sat, and any pixel in the forbidden hues (350-20 deg, 95-150 deg) clamped
      to HSL saturation 0.30. Hue is preserved. This is a GRADE on generated pixels, run BEFORE
      review; the reviewed file is the shipped file.
  metrics <tile.png> ...
      L* mean/p1/p99, HSL saturation mean, forbidden-hue share (sat > 0.30), wrap ratio.
  sheet <out.png> <cell> <img> ...          contact sheet on a mid-grey checker
  repeat <tile.png> <out.png> [n]           n x n repeat for seam inspection
"""
import sys

import numpy as np
from PIL import Image


def load_rgb(path):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.float64)
    return a[..., :3], a[..., 3]


def srgb_to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055) * 255.0


M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
MI = np.linalg.inv(M)
WP = np.array([0.95047, 1.0, 1.08883])


def rgb_to_lab(rgb):
    xyz = srgb_to_lin(rgb) @ M.T / WP
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], -1)


def lab_to_rgb(lab):
    fy = (lab[..., 0] + 16) / 116
    fx = fy + lab[..., 1] / 500
    fz = fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], -1)
    xyz = np.where(f ** 3 > 216 / 24389, f ** 3, (116 * f - 16) / (24389 / 27)) * WP
    return lin_to_srgb(xyz @ MI.T)


def hsl(rgb):
    c = rgb / 255.0
    mx, mn = c.max(-1), c.min(-1)
    l = (mx + mn) / 2
    d = mx - mn
    s = np.where(d == 0, 0, d / (1 - np.abs(2 * l - 1) + 1e-9))
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    h = np.zeros_like(mx)
    nz = d > 0
    rm = nz & (mx == r)
    gm = nz & (mx == g) & ~rm
    bm = nz & ~rm & ~gm
    h[rm] = (60 * ((g - b)[rm] / d[rm])) % 360
    h[gm] = 60 * ((b - r)[gm] / d[gm]) + 120
    h[bm] = 60 * ((r - g)[bm] / d[bm]) + 240
    return h, np.clip(s, 0, 1), l


def forbidden(h):
    return (h >= 350) | (h <= 20) | ((h >= 95) & (h <= 150))


def wrap_ratio(rgb):
    h = np.abs(rgb[:, 0] - rgb[:, -1]).mean()
    v = np.abs(rgb[0] - rgb[-1]).mean()
    noise = (np.abs(np.diff(rgb, axis=1)).mean() + np.abs(np.diff(rgb, axis=0)).mean()) / 2
    return h, v, noise


def metrics(paths):
    print(f"{'file':58} {'L*mean':>6} {'L*p1':>5} {'L*p99':>5} {'sat':>5} {'forb%':>6} {'hW':>6} {'vW':>6} {'noise':>6} {'wrapX':>5} {'minA':>4}")
    for p in paths:
        rgb, a = load_rgb(p)
        m = a > 8
        lab = rgb_to_lab(rgb)
        L = lab[..., 0][m]
        h, s, _ = hsl(rgb)
        forb = (forbidden(h) & (s > 0.30))[m].mean() * 100
        hw, vw, n = wrap_ratio(rgb)
        name = "/".join(p.split("/")[-3:])
        print(f"{name:58} {L.mean():6.1f} {np.percentile(L,1):5.1f} {np.percentile(L,99):5.1f} {s[m].mean():5.3f} {forb:6.2f} {hw:6.2f} {vw:6.2f} {n:6.2f} {max(hw,vw)/max(n,1e-6):5.2f} {int(a.min()):4d}")


def bestcrop(raw, out, mn=768, step=8, mx=None):
    rgb, _ = load_rgb(raw)
    H, W, _ = rgb.shape
    g = rgb[::2, ::2]  # half-res search
    best = None
    top = min(H, W) if mx is None else min(mx, H, W)
    for S in range(top // 2, mn // 2 - 1, -step // 2):
        for y in range(0, H // 2 - S + 1, step // 2):
            for x in range(0, W // 2 - S + 1, step // 2):
                w = g[y:y + S, x:x + S]
                hw = np.abs(w[:, 0] - w[:, -1]).mean()
                vw = np.abs(w[0] - w[-1]).mean()
                # interior noise of the same window
                n = np.abs(w[:, S // 2] - w[:, S // 2 - 1]).mean() + np.abs(w[S // 2] - w[S // 2 - 1]).mean()
                score = (hw + vw) / max(n, 1e-6) - 0.0004 * S  # mild preference for larger windows
                if best is None or score < best[0]:
                    best = (score, x * 2, y * 2, S * 2, hw, vw, n / 2)
    _, x, y, S, hw, vw, n = best
    Image.open(raw).convert("RGB").crop((x, y, x + S, y + S)).save(out)
    print(f"bestcrop {raw} -> {out}: x={x} y={y} size={S} hWrap={hw:.2f} vWrap={vw:.2f} noise={n:.2f}")


def tonefit(inp, out, mean=25.0, lo=14.0, hi=36.0, sat=0.22):
    im = Image.open(inp).convert("RGBA")
    arr = np.asarray(im).astype(np.float64)
    rgb, a = arr[..., :3], arr[..., 3]
    m = a > 8
    lab = rgb_to_lab(rgb)
    L = lab[..., 0]
    p1, p99, mu = np.percentile(L[m], 1), np.percentile(L[m], 99), L[m].mean()
    k = min(1.0, (hi - lo) / max(p99 - p1, 1e-6))
    shift = 0.0
    if mean + (p99 - mu) * k > hi:
        shift = hi - (mean + (p99 - mu) * k)
    elif mean + (p1 - mu) * k < lo:
        shift = lo - (mean + (p1 - mu) * k)
    Ln = mean + shift + (L - mu) * k
    lab2 = lab.copy()
    lab2[..., 0] = np.clip(Ln, 0, 100)
    for _ in range(12):
        rgb2 = lab_to_rgb(lab2)
        h, s, _ = hsl(rgb2)
        if s[m].mean() <= sat:
            break
        lab2[..., 1:] *= 0.85
    rgb2 = lab_to_rgb(lab2)
    h, s, _ = hsl(rgb2)
    bad = forbidden(h) & (s > 0.30)
    for _ in range(12):
        if not bad.any():
            break
        lab2[bad, 1:] *= 0.8
        rgb2 = lab_to_rgb(lab2)
        h, s, _ = hsl(rgb2)
        bad = forbidden(h) & (s > 0.30)
    res = np.concatenate([np.clip(np.round(rgb2), 0, 255), a[..., None]], -1).astype(np.uint8)
    Image.fromarray(res, "RGBA").save(out)
    print(f"tonefit {inp} -> {out}: L* mean {mu:.1f}->{mean}, span p1..p99 {p1:.1f}..{p99:.1f} x{k:.3f}")


def sheet(out, cell, paths):
    cell = int(cell)
    n = len(paths)
    cols = min(n, 4)
    rows = (n + cols - 1) // cols
    bg = Image.new("RGBA", (cols * cell, rows * cell), (96, 96, 96, 255))
    for i in range(0, cols * cell, 16):
        for j in range(0, rows * cell, 16):
            if (i // 16 + j // 16) % 2:
                bg.paste((110, 110, 110, 255), (i, j, i + 16, j + 16))
    for i, p in enumerate(paths):
        im = Image.open(p).convert("RGBA")
        im.thumbnail((cell, cell), Image.NEAREST)
        bg.alpha_composite(im, ((i % cols) * cell, (i // cols) * cell))
    bg.save(out)


def repeat(tile, out, n=3):
    im = Image.open(tile).convert("RGBA")
    w, h = im.size
    c = Image.new("RGBA", (w * n, h * n))
    for i in range(n):
        for j in range(n):
            c.paste(im, (i * w, j * h))
    c.save(out)


def opt(args, name, default, cast=float):
    if name in args:
        i = args.index(name)
        v = cast(args[i + 1])
        del args[i:i + 2]
        return v
    return default


if __name__ == "__main__":
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "metrics":
        metrics(args)
    elif cmd == "bestcrop":
        mn = opt(args, "--min", 768, int)
        st = opt(args, "--step", 8, int)
        mx = opt(args, "--max", None, int)
        bestcrop(args[0], args[1], mn, st, mx)
    elif cmd == "tonefit":
        mean = opt(args, "--mean", 25.0)
        lo = opt(args, "--lo", 14.0)
        hi = opt(args, "--hi", 36.0)
        sat = opt(args, "--sat", 0.22)
        tonefit(args[0], args[1], mean, lo, hi, sat)
    elif cmd == "sheet":
        sheet(args[0], args[1], args[2:])
    elif cmd == "repeat":
        repeat(args[0], args[1], int(args[2]) if len(args) > 2 else 3)
    else:
        sys.exit(f"unknown command {cmd}")
