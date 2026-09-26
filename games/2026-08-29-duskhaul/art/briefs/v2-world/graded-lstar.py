#!/usr/bin/env python3
"""Offline repro of the runtime FLOOR_GRADE multiply (systems/arena.ts setTint) on floors-v2 tiles.

Usage (from games/2026-08-29-duskhaul/):
  uv run -q --with numpy --with pillow python art/briefs/v2-world/graded-lstar.py <hex> <tile.png> [...]
Prints authored vs graded L* mean/p1/p99 so the post-review tint is reviewed, not assumed.
"""
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, "art/briefs/v2-world")
from world import rgb_to_lab  # noqa: E402

g = sys.argv[1].lstrip("#")
grade = np.array([int(g[i:i + 2], 16) / 255 for i in (0, 2, 4)])
for p in sys.argv[2:]:
    rgb = np.asarray(Image.open(p).convert("RGB")).astype(np.float64)
    a = rgb_to_lab(rgb)[..., 0]
    b = rgb_to_lab(np.round(rgb * grade))[..., 0]
    print(f"{p.split('/')[-2]:18} grade #{g}  authored L* {a.mean():5.1f} [{np.percentile(a,1):4.1f}..{np.percentile(a,99):4.1f}]  graded L* {b.mean():5.1f} [{np.percentile(b,1):4.1f}..{np.percentile(b,99):4.1f}]")
