"""Splice per-frame edits back into an original 2x3 raw at the original cell boxes.

The xai edits keep the input framing (normalised bbox within ~0.01 of the source cell), so each
edited frame is resized uniformly (same aspect) back to its source cell size and pasted at that
cell's box. Frames not listed stay byte-identical to the original raw.

usage: splice.py <orig-raw> <out.png> <rows> <cols> idx=edited.png [idx=edited.png ...]
"""
import sys
from PIL import Image

orig, out, rows, cols, *pairs = sys.argv[1:]
rows, cols = int(rows), int(cols)
raw = Image.open(orig).convert('RGB')
W, H = raw.size
cw, ch = W / cols, H / rows
for pair in pairs:
    i, path = pair.split('=')
    i = int(i)
    box = (round((i % cols) * cw), round((i // cols) * ch), round((i % cols + 1) * cw), round((i // cols + 1) * ch))
    ed = Image.open(path).convert('RGB').resize((box[2] - box[0], box[3] - box[1]), Image.LANCZOS)
    raw.paste(ed, box[:2])
raw.save(out)
print(out, raw.size, 'spliced', len(pairs))
