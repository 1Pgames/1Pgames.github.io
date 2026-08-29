#!/usr/bin/env python3
"""Render a floor tile the way the game actually shows it, for eyeball QC.

Usage: python3 tile-preview.py <tile.png> <grade-hex> <out-prefix>
                              [--actors <sheet.png>:<px> ...]

Produces two files:
  <out-prefix>-tile3x3.png  3x3 repeat at native scale, GRADE APPLIED -- seams and any
                            repeated landmark show up here, because the eye finds a seam
                            far more reliably than a wrap statistic does.
  <out-prefix>-play.png     720x720 crop at 1:1 (the arena draws the tile as a tileSprite
                            with no tile scaling, so 512 tile px = 512 screen px), centred
                            on the seam cross, with actor frames composited at their REAL
                            `data/enemies.ts` display size. Enemies are 40-96px against
                            512px of floor pattern, so floor features are actor-sized and
                            figure/ground separation has to be judged at this scale.

The grade is `FLOOR_GRADE[zone]` from `ui/duskChrome.ts`, applied as Phaser's multiply tint.
Previewing the UNGRADED tile flatters it: grading is what darkens the field in play.
"""
import sys

from PIL import Image


def graded(tile: Image.Image, grade: int) -> Image.Image:
    gr, gg, gb = (grade >> 16) & 255, (grade >> 8) & 255, grade & 255
    rgb = tile.convert("RGB")
    r, g, b = rgb.split()
    return Image.merge(
        "RGB",
        (
            r.point(lambda v: (v * gr) // 255),
            g.point(lambda v: (v * gg) // 255),
            b.point(lambda v: (v * gb) // 255),
        ),
    )


def first_frame(path: str) -> Image.Image:
    """Top-left cell of a 2x2 sheet, trimmed to the subject's bounding box."""
    sheet = Image.open(path).convert("RGBA")
    cell = sheet.crop((0, 0, sheet.width // 2, sheet.height // 2))
    box = cell.getbbox()
    return cell.crop(box) if box else cell


def main() -> None:
    tile_path, grade_hex, prefix = sys.argv[1], sys.argv[2], sys.argv[3]
    actors: list[tuple[str, int]] = []
    if "--actors" in sys.argv:
        for spec in sys.argv[sys.argv.index("--actors") + 1 :]:
            path, _, px = spec.rpartition(":")
            actors.append((path, int(px)))

    tile = graded(Image.open(tile_path), int(grade_hex, 16))
    w, h = tile.size

    sheet = Image.new("RGB", (w * 3, h * 3))
    for row in range(3):
        for col in range(3):
            sheet.paste(tile, (col * w, row * h))
    sheet.save(f"{prefix}-tile3x3.png")

    # Centre the 720x720 view on the seam cross so a bad seam cannot hide off-frame.
    view = 720
    cx, cy = w * 3 // 2, h * 3 // 2
    play = sheet.crop((cx - view // 2, cy - view // 2, cx + view // 2, cy + view // 2)).convert(
        "RGBA"
    )
    step = view // (len(actors) + 1) if actors else 0
    for i, (path, px) in enumerate(actors):
        art = first_frame(path)
        scaled = art.resize((px, max(1, round(px * art.height / art.width))), Image.NEAREST)
        x = step * (i + 1) - px // 2
        for y in (view // 4, view // 2, 3 * view // 4):
            play.alpha_composite(scaled, (max(0, x), y - scaled.height // 2))
    play.convert("RGB").save(f"{prefix}-play.png")
    print(f"wrote {prefix}-tile3x3.png ({w * 3}x{h * 3}) and {prefix}-play.png ({view}x{view})")


if __name__ == "__main__":
    main()
