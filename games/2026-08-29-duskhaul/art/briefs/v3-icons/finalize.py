#!/usr/bin/env python3
"""Reproducible export for one ArtIcons3 (icons-v3) sheet (run from repo root).

  finalize.py <assetId> <raw> <rows> <cols> <cellSize> [--edge-ok] [--provider xai-oauth]

1. copies the untouched provider raw to art/briefs/v3-icons/raw/<assetId>/
2. normalize-key.py -> pure #FF00FF background, pink fringe despilled
3. sprite-forge process-sprite.ts, strict, centred, smooth sampling, static
   (duration 0), threshold 70 / edge 120, min component 60, style profile bound
4. writes a 3x preview on the darkest UI panel tone to /tmp/icv3/<assetId>-view.png
"""
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

GAME = Path("games/2026-08-29-duskhaul")
HERE = GAME / "art/briefs/v3-icons"
PROC = Path.home() / ".omp/plugins/node_modules/oh-my-pi-sprite-forge/skills/sprite-forge/scripts/process-sprite.ts"


def main() -> None:
    a = sys.argv[1:]
    asset, raw, rows, cols, cell = a[0], Path(a[1]), a[2], a[3], a[4]
    edge_ok = "--edge-ok" in a
    provider = a[a.index("--provider") + 1] if "--provider" in a else "xai-oauth"
    keep = HERE / "raw" / asset
    keep.mkdir(parents=True, exist_ok=True)
    kept = keep / f"provider-raw{raw.suffix}"
    if raw.resolve() != kept.resolve():
        shutil.copyfile(raw, kept)
    tmp = Path("/tmp/icv3")
    tmp.mkdir(exist_ok=True)
    norm = tmp / f"{asset}-norm.png"
    ncmd = [sys.executable, str(HERE / "normalize-key.py"), str(kept), str(norm)]
    if "--flood" in a:
        ncmd += ["--flood", "1"]
    if "--divider" in a:
        ncmd += ["--grid", rows]
    subprocess.run(ncmd, check=True)
    out = GAME / "public/assets/generated/icons-v3" / asset
    cmd = [
        "bun", str(PROC), "--input", str(norm), "--output", str(out),
        "--rows", rows, "--cols", cols, "--cell-size", cell, "--align", "center",
        "--sampling", "smooth", "--duration", "0", "--threshold", "70", "--edge-threshold", "120",
        "--min-component-area", "60" if int(cell) >= 64 else "8", "--strict",
        "--style-profile", str(GAME / "art/style.json"), "--preserve-raw", "--source-provider", provider,
    ]
    if edge_ok:
        cmd.append("--allow-source-edge-touch")
    r = subprocess.run(cmd, capture_output=True, text=True)
    tail = (r.stdout + r.stderr).strip().splitlines()[-3:]
    print("\n".join(tail))
    if r.returncode != 0:
        sys.exit(r.returncode)
    sheet = out / ("sprite-sheet.png" if int(rows) * int(cols) > 1 else "sprite.png")
    im = Image.open(sheet).convert("RGBA")
    bg = Image.new("RGBA", im.size, (26, 21, 32, 255))
    bg.alpha_composite(im)
    k = max(1, 1152 // im.width)
    bg.resize((im.width * k, im.height * k), Image.NEAREST).save(tmp / f"{asset}-view.png")
    print(f"ok {out} view=/tmp/icv3/{asset}-view.png")


if __name__ == "__main__":
    main()
