import sys
from PIL import Image
paths = sys.argv[2:]
out = sys.argv[1]
S = 384
c = Image.new('RGB', (S * len(paths), S), (40, 40, 40))
for i, p in enumerate(paths):
    im = Image.open(p).convert('RGBA')
    im.thumbnail((S, S))
    bg = Image.new('RGBA', im.size, (40, 40, 40, 255))
    bg.alpha_composite(im)
    c.paste(bg.convert('RGB'), (i * S, 0))
c.save(out)
