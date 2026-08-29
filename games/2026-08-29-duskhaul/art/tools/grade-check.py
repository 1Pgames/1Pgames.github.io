#!/usr/bin/env python3
"""Check a floor tile against the in-game FLOOR_GRADE multiply and its C1/C2 contrast criteria.

Usage: python3 grade-check.py <hero-sheet.png> <grade-hex> <tile.png> [<grade-hex> <tile.png> ...]

WHY THIS EXISTS. `systems/arena.ts` draws the floor as a tileSprite with
`.setTint(FLOOR_GRADE[zone])`, i.e. the authored tile is MULTIPLIED per channel before the
player ever sees it. `ui/duskChrome.ts#FLOOR_GRADE` calibrated those tints against the OLD
tiles, and documents two acceptance criteria measured in per-pixel LINEAR luminance
(Rec709 on linearised sRGB -- reproduced here exactly; it matches the table's four
before-values to 4 decimals):

  C1 foreground ownership: graded floor p99 <= 0.5 * hero p99
  C2 ground recession:     graded floor p90 <= hero p90

C2 deliberately does NOT apply to desert: that zone is the inverted light field, where the
floor p50 is meant to sit ABOVE the hero p90 so actors read as holes in the sand. C1 still
holds there. Re-authoring a floor at a different lightness therefore changes the graded
result and can silently break these criteria, which is why this runs before promotion.
"""
import sys

from PIL import Image

_LUT = [
    (c / 255.0 / 12.92) if (c / 255.0) <= 0.04045 else (((c / 255.0) + 0.055) / 1.055) ** 2.4
    for c in range(256)
]


def _lin_luma(r: int, g: int, b: int) -> float:
    return 0.2126 * _LUT[r] + 0.7152 * _LUT[g] + 0.0722 * _LUT[b]


def _stats(values: list[float]) -> dict:
    values.sort()
    n = len(values)

    def pct(p: float) -> float:
        return values[min(n - 1, int(n * p))]

    return {
        "mean": sum(values) / n,
        "p50": pct(0.50),
        "p90": pct(0.90),
        "p99": pct(0.99),
    }


def hero_stats(path: str) -> dict:
    im = Image.open(path).convert("RGBA")
    return _stats(
        [_lin_luma(r, g, b) for r, g, b, a in im.getdata() if a > 128]
    )


def tile_stats(path: str, grade: int) -> tuple[dict, dict]:
    im = Image.open(path).convert("RGB")
    px = list(im.getdata())
    gr, gg, gb = (grade >> 16) & 255, (grade >> 8) & 255, grade & 255
    plain = [_lin_luma(r, g, b) for r, g, b in px]
    # Phaser's multiply tint, per channel, in 8-bit sRGB space -- same as the runtime.
    graded = [
        _lin_luma((r * gr) // 255, (g * gg) // 255, (b * gb) // 255) for r, g, b in px
    ]
    return _stats(plain), _stats(graded)


def main() -> None:
    hero = hero_stats(sys.argv[1])
    print(
        f"hero (opaque, linear luma): mean={hero['mean']:.4f} p50={hero['p50']:.4f} "
        f"p90={hero['p90']:.4f} p99={hero['p99']:.4f}"
    )
    print(f"  C1 limit = 0.5 * hero p99 = {hero['p99'] / 2:.4f}   C2 limit = hero p90 = {hero['p90']:.4f}")
    print()
    print(f"{'tile':34} {'grade':>7} {'meanL':>7} {'graded':>7} {'gp50':>7} {'gp90':>7} {'gp99':>7}  C1    C2    INV")
    rest = sys.argv[2:]
    for i in range(0, len(rest), 2):
        grade = int(rest[i], 16)
        path = rest[i + 1]
        plain, graded = tile_stats(path, grade)
        c1 = "PASS" if graded["p99"] <= hero["p99"] / 2 else "FAIL"
        c2 = "PASS" if graded["p90"] <= hero["p90"] else "FAIL"
        # Desert's inverted identity: the field's median must out-value the hero's p90 so
        # actors read as dark holes in a bright field. Informational for the other zones.
        inv = "yes" if graded["p50"] > hero["p90"] else "no"
        label = path.replace("public/assets/generated/", "").replace("/sprite.png", "")
        print(
            f"{label:34} {rest[i]:>7} {plain['mean']:7.4f} {graded['mean']:7.4f} "
            f"{graded['p50']:7.4f} {graded['p90']:7.4f} {graded['p99']:7.4f}  {c1}  {c2}  {inv}"
        )


if __name__ == "__main__":
    main()
