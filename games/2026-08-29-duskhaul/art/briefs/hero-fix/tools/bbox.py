"""Print the non-key bbox of each image (key = magenta/pink family, same test as assemble.py)."""
import sys
from PIL import Image
def is_key(r, g, b): return r > 150 and b > 100 and g < 130 and min(r, b) - g > 60
def bbox(p, step=2):
    im = Image.open(p).convert('RGB'); px = im.load(); W, H = im.size
    xs, ys = [], []
    for y in range(4, H - 4, step):
        for x in range(4, W - 4, step):
            if not is_key(*px[x, y]): xs.append(x); ys.append(y)
    return im.size, (min(xs), min(ys), max(xs), max(ys))
if __name__ == '__main__':
    for p in sys.argv[1:]:
        (W, H), (l, t, r, b) = bbox(p)
        print(p, (W, H), 'norm', tuple(round(v, 3) for v in (l / W, t / H, r / W, b / H)))
