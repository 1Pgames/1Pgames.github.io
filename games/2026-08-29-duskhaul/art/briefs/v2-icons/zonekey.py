#!/usr/bin/env python3
"""Reproducible export for one zone key-art image (run from repo root).

  zonekey.py <zone> <raw> [--top <fraction>]

Copies the untouched provider raw to art/briefs/v2-icons/raw/zone-key-<zone>/,
crops the full width to the 640:300 aspect (vertical offset --top as a fraction of
the spare height, default 0.5 = centred), then exports with sprite-forge as a
1x1 full-bleed image at 640x300 (fullBleed, threshold/edge 1: a magenta-less
raw has nothing to key). Crop is the only pixel transform; no resample other
than the processor's own fit.
"""
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

GAME = Path("games/2026-08-29-duskhaul")
HERE = GAME / "art/briefs/v2-icons"
PROC = Path.home() / ".omp/plugins/node_modules/oh-my-pi-sprite-forge/skills/sprite-forge/scripts/process-sprite.ts"


def main() -> None:
    a = sys.argv[1:]
    zone, raw = a[0], Path(a[1])
    top = float(a[a.index("--top") + 1]) if "--top" in a else 0.5
    asset = f"zone-key-{zone}"
    keep = HERE / "raw" / asset
    keep.mkdir(parents=True, exist_ok=True)
    kept = keep / f"provider-raw{raw.suffix}"
    if raw.resolve() != kept.resolve():
        shutil.copyfile(raw, kept)
    im = Image.open(kept).convert("RGB")
    w, h = im.size
    ch = round(w * 300 / 640)
    y0 = round((h - ch) * top)
    crop = Path("/tmp/icv2") / f"{asset}-crop.png"
    crop.parent.mkdir(exist_ok=True)
    im.crop((0, y0, w, y0 + ch)).save(crop)
    out = GAME / "public/assets/generated/icons-v2" / asset
    r = subprocess.run([
        "bun", str(PROC), "--input", str(crop), "--output", str(out), "--rows", "1", "--cols", "1",
        "--cell-size", "640", "--cell-height", "300", "--full-bleed", "--align", "center",
        "--sampling", "smooth", "--duration", "0", "--threshold", "1", "--edge-threshold", "1",
        "--style-profile", str(GAME / "art/style.json"), "--preserve-raw", "--source-provider", "xai-oauth",
    ], capture_output=True, text=True)
    print("\n".join((r.stdout + r.stderr).strip().splitlines()[-3:]))
    sys.exit(r.returncode)


if __name__ == "__main__":
    main()
