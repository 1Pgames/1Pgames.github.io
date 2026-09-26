#!/usr/bin/env python3
"""Offline repro of the post-review pixel transforms ArtPOI assets receive at runtime.

Phaser `setTint(c)` multiplies texture RGB by c; `setAlpha(a)` scales alpha. This composites,
on the castle floor tile (canon, no FLOOR_GRADE applied here — see report):
  - fx-shadow at alpha 0.45 under hero-idle frame 0 (PRD-V2 §13.1 hero) and 0.35 (trash)
  - fx-lightpool tinted torch-amber #e8c547 and dusk-violet #5b4bff at alpha 0.5
  - fx-chest-beam frame 0 tinted with each rarity colour (PRD-V2 §5.15.1)
  - POI / gate / breakable samples at 1:1 over the same floor
Output: art/briefs/v2-poi/runtime-preview.png   (cwd = game root)
"""
from PIL import Image

G = "public/assets/generated/"


def tint(im, hexc, alpha=1.0):
    c = tuple(int(hexc[i:i + 2], 16) for i in (1, 3, 5))
    px = im.load()
    out = im.copy()
    po = out.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            po[x, y] = (r * c[0] // 255, g * c[1] // 255, b * c[2] // 255, int(a * alpha))
    return out


def fade(im, alpha):
    r, g, b, a = im.split()
    return Image.merge("RGBA", (r, g, b, a.point(lambda v: int(v * alpha))))


def frame(path, cols, rows, idx=0):
    im = Image.open(path).convert("RGBA")
    w, h = im.width // cols, im.height // rows
    return im.crop(((idx % cols) * w, (idx // cols) * h, (idx % cols + 1) * w, (idx // cols + 1) * h))


floor = Image.open(G + "zone-castle/floor-castle/sprite.png").convert("RGBA")
W, H = 1536, 768
canvas = Image.new("RGBA", (W, H))
for y in range(0, H, floor.height):
    for x in range(0, W, floor.width):
        canvas.alpha_composite(floor, (x, y))

shadow = Image.open(G + "fx-v2/fx-shadow/sprite.png").convert("RGBA")
hero = frame(G + "hero/hero-idle/sprite-sheet.png", 2, 2)
for i, a in enumerate((0.45, 0.35)):
    x = 40 + i * 180
    canvas.alpha_composite(fade(shadow, a), (x, 200))
    canvas.alpha_composite(hero.resize((128, 128), Image.NEAREST), (x, 120))

pool = Image.open(G + "fx-v2/fx-lightpool/sprite.png").convert("RGBA").resize((256, 256), Image.NEAREST)
canvas.alpha_composite(tint(pool, "#e8c547", 0.5), (400, 20))
canvas.alpha_composite(tint(pool, "#5b4bff", 0.5), (400, 300))

beam = frame(G + "fx-v2/fx-chest-beam/sprite-sheet.png", 4, 1)
for i, c in enumerate(("#a5a38b", "#6f8fa6", "#c07a3a", "#f3ca67", "#ad6eef", "#e8f0ff")):
    canvas.alpha_composite(tint(beam, c), (680 + i * 70, 20))
chest = frame(G + "poi/poi-chest-t3/sprite-sheet.png", 2, 2, 3)
canvas.alpha_composite(chest, (680 + 70 * 3 - 32, 200))

x = 680
for p, cols, rows, idx in (("poi/poi-shrine-curse", 2, 2, 2), ("gates-v2/gate-bell-open", 2, 2, 2),
                           ("breakables/brk-castle", 3, 2, 0), ("breakables/brk-castle", 3, 2, 4),
                           ("pickups-v2/pk-key", 2, 2, 0), ("poi/poi-vein", 3, 1, 0)):
    f = frame(G + p + "/sprite-sheet.png", cols, rows, idx)
    s = 160 / max(f.width, f.height)
    f = f.resize((int(f.width * s), int(f.height * s)), Image.NEAREST)
    canvas.alpha_composite(f, (x, 420))
    x += 140

canvas.save("art/briefs/v2-poi/runtime-preview.png")
print("wrote art/briefs/v2-poi/runtime-preview.png")
