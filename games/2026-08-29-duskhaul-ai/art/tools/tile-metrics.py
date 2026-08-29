#!/usr/bin/env python3
"""Measure a full-bleed tile: value tiers, black contamination, seam wrap, pixel density.

Usage: python3 tile-metrics.py <tile.png> [<tile.png> ...]

Pillow-only (no numpy in this env) -- every figure comes from ImageChops/ImageStat or a
histogram, so it is cheap enough to run on the whole zone set at once.

Numbers this reports and why they matter for Duskhaul zone floors:

  minAlpha      full-bleed tiles MUST be 255 (fit 1); 0 means the texture is inset and cannot tile.
  dark/mid/light  value tiers on luma. style.json plan.valuePlan is .60/.32/.08, but a FLOOR is
                  not an actor -- a floor is judged on lightRange staying open, and on the desert
                  floor deliberately INVERTING the tiers (light field, dark actors).
  black%        share of pixels below luma 20/255. THE desert killer: dark actors lose their
                  silhouette against any black in the field, so desert must read ~0.
  lightRange    p98 - p02 of luma, normalised 0..1. Collapsed range = blank paper, or mud.
  hWrap/vWrap   mean abs channel diff between opposing edge columns/rows -- the seam a 5x5
                  repeat actually shows. Judge against `density`, the mean abs diff of adjacent
                  INTERIOR lines: a wrap at or below ~2x that noise floor is an invisible seam.
  density       mean abs adjacent-pixel diff (high-frequency energy). The pixel-density proxy:
                  a coarse blobby tile sits far below the castle/outlands reference band.
  meanSat       catches a floor drifting off its zone hue rail (desert warm bone, winter cold blue).
"""
import sys

from PIL import Image, ImageChops, ImageStat


def _mean_abs_diff(a: Image.Image, b: Image.Image) -> float:
    return sum(ImageStat.Stat(ImageChops.difference(a, b)).mean[:3]) / 3.0


def metrics(path: str) -> dict:
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    rgb = im.convert("RGB")
    lum = rgb.convert("L")

    total = w * h
    hist = lum.histogram()
    dark = sum(hist[:77]) / total  # luma < 0.30
    mid = sum(hist[77:158]) / total  # 0.30 <= luma < 0.62
    light = sum(hist[158:]) / total
    black = sum(hist[:20]) / total * 100

    def pct(p: float) -> int:
        want, run = total * p, 0
        for value, count in enumerate(hist):
            run += count
            if run >= want:
                return value
        return 255

    # Seam: opposing edges must continue into each other.
    h_wrap = _mean_abs_diff(rgb.crop((0, 0, 1, h)), rgb.crop((w - 1, 0, w, h)))
    v_wrap = _mean_abs_diff(rgb.crop((0, 0, w, 1)), rgb.crop((0, h - 1, w, h)))
    # Noise floor: how different two genuinely adjacent lines are.
    density = (
        _mean_abs_diff(rgb.crop((1, 0, w, h)), rgb.crop((0, 0, w - 1, h)))
        + _mean_abs_diff(rgb.crop((0, 1, w, h)), rgb.crop((0, 0, w, h - 1)))
    ) / 2.0

    return {
        "file": path.rsplit("/generated/", 1)[-1].replace("/sprite.png", ""),
        "minAlpha": min(im.split()[3].getextrema()),
        "dark": dark,
        "mid": mid,
        "light": light,
        "black%": black,
        "meanL": ImageStat.Stat(lum).mean[0] / 255.0,
        "lightRange": (pct(0.98) - pct(0.02)) / 255.0,
        "hWrap": h_wrap,
        "vWrap": v_wrap,
        "density": density,
        "wrapRatio": max(h_wrap, v_wrap) / density if density else float("inf"),
        "meanSat": ImageStat.Stat(im.convert("HSV").getchannel("S")).mean[0] / 255.0,
    }


COLS = [
    ("file", 36, "s"),
    ("minAlpha", 8, "d"),
    ("dark", 6, ".2f"),
    ("mid", 6, ".2f"),
    ("light", 6, ".2f"),
    ("black%", 7, ".2f"),
    ("meanL", 6, ".3f"),
    ("lightRange", 10, ".3f"),
    ("hWrap", 6, ".2f"),
    ("vWrap", 6, ".2f"),
    ("density", 7, ".2f"),
    ("wrapRatio", 9, ".2f"),
    ("meanSat", 7, ".3f"),
]


def actor_band(paths: list[str]) -> tuple[int, int]:
    """Luma p50/p90 of the OPAQUE pixels of the canonical actor sheets, 0..255.

    This is the figure/ground reference. Duskhaul's actors are DARK -- measured core band luma
    9..107, median 40 -- so any field pixel below the actor p90 is a place where a dark actor
    has no value separation from the ground it stands on. The desert zone's whole identity is
    the INVERTED read (light bone field, dark figures), so its clash share must be near zero.
    """
    hist = [0] * 256
    for path in paths:
        im = Image.open(path).convert("RGBA")
        lum, alpha = im.convert("L"), im.split()[3]
        for value, a in zip(lum.getdata(), alpha.getdata()):
            if a > 128:
                hist[value] += 1
    total = sum(hist)

    def pct(p: float) -> int:
        want, run = total * p, 0
        for value, count in enumerate(hist):
            run += count
            if run >= want:
                return value
        return 255

    return pct(0.50), pct(0.90)


def main() -> None:
    args = sys.argv[1:]
    actors: list[str] = []
    if "--actors" in args:
        cut = args.index("--actors")
        args, actors = args[:cut], args[cut + 1 :]

    cols = list(COLS)
    p90 = None
    if actors:
        p50, p90 = actor_band(actors)
        print(f"actor band (opaque luma): p50={p50} p90={p90}  from {len(actors)} sheet(s)")
        cols += [("clash%", 7, ".2f"), ("actorGap", 8, ".3f")]

    print(" ".join(f"{n:>{width}}" for n, width, _ in cols))
    for path in args:
        row = metrics(path)
        if p90 is not None:
            hist = Image.open(path).convert("L").histogram()
            total = sum(hist)
            # Share of the field no lighter than the actor's p90: on that share of the screen a
            # dark actor has no figure/ground separation at all.
            row["clash%"] = sum(hist[: p90 + 1]) / total * 100
            row["actorGap"] = row["meanL"] - p50 / 255.0
        print(" ".join(f"{row[n]:>{width}{fmt}}" for n, width, fmt in cols))


if __name__ == "__main__":
    main()
