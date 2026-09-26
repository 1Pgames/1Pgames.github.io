#!/usr/bin/env python3
"""Deterministic same-position cell swap between two provider raws (icons-v4).

icons-arsenal-wpn attempt 1 is the accepted base. Attempt 2 was an xai edit of
attempt 1 (attempt 1 as Image 1) asking to shorten two flames and recolour the
orange collar straps of the Legion icon; it fixed the collars and the totem
flame but deleted the reliquary tower (r3c2). This copies only the fixed cells
of attempt 2 over attempt 1 at the SAME grid position — a pixel copy of
generated art between two same-lineage raws, nothing drawn. Rows/cols 0-based.

  compose-cells.py <base> <donor> <out.png> <grid> <row,col> [<row,col> ...]
"""
import sys

from PIL import Image


def main() -> None:
    base_p, donor_p, out_p, grid, *cells = sys.argv[1:]
    n = int(grid)
    base = Image.open(base_p).convert("RGB")
    donor = Image.open(donor_p).convert("RGB")
    assert base.size == donor.size, (base.size, donor.size)
    cw, ch = base.width // n, base.height // n
    for rc in cells:
        r, c = (int(v) for v in rc.split(","))
        box = (c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)
        base.paste(donor.crop(box), box[:2])
        print(f"copied donor r{r}c{c} ({cw}x{ch})")
    base.save(out_p)
    print(f"-> {out_p}")


if __name__ == "__main__":
    main()
