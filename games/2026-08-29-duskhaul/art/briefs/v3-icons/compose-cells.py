#!/usr/bin/env python3
"""Deterministic cell swap between two provider raws of the icons-v3 sheet.

xai edit attempt 3 (asked to replace only the plain crown, r4c2 of attempt 2)
drew the requested winged crowned skull but put it in r3c2, overwriting the
purse, and dropped the ash-ring ember. Attempt 2 is the accepted sheet; its
r4c2 plain crown duplicated icons-v2 `icon-uniq-u_dreadcrown`. This copies the
generated r3c2 cell of attempt 3 over r4c2 of attempt 2 — a pixel copy of
generated art between two same-lineage raws (attempt 3 was generated with
attempt 2 as Image 1), nothing drawn. Both raws are kept in raw/.

  compose-cells.py <base.jpg> <donor.jpg> <out.png> <grid> <srcRow,srcCol> <dstRow,dstCol>
"""
import sys

from PIL import Image


def main() -> None:
    base_p, donor_p, out_p, grid, src, dst = sys.argv[1:7]
    n = int(grid)
    base = Image.open(base_p).convert("RGB")
    donor = Image.open(donor_p).convert("RGB")
    assert base.size == donor.size, (base.size, donor.size)
    cw, ch = base.width // n, base.height // n
    sr, sc = (int(v) for v in src.split(","))
    dr, dc = (int(v) for v in dst.split(","))
    cell = donor.crop((sc * cw, sr * ch, (sc + 1) * cw, (sr + 1) * ch))
    base.paste(cell, (dc * cw, dr * ch))
    base.save(out_p)
    print(f"copied donor r{sr}c{sc} -> base r{dr}c{dc} ({cw}x{ch}) -> {out_p}")


if __name__ == "__main__":
    main()
