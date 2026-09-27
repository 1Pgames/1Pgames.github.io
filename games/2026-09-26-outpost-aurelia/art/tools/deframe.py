#!/usr/bin/env python3
"""Strip xai's welded magenta/pink frame from a FULL-BLEED export and re-export it.

xai welds a 45-95px magenta-ish frame around full-bleed swatches (sprite-forge SKILL,
"Provider artifacts"). With fullBleed + threshold 1 nothing keys it, so the tile ships
with a pink border. This detects the frame by RELATION (min(r,b)-g > 40, r>150, b>150,
g<120), crops it plus a 3px inset, and re-runs process-sprite.ts full-bleed on the crop.
The marker metadata is kept as sprite-metadata.marker.json.

Usage (from games/<slug>/): python3 art/tools/deframe.py public/assets/generated/terrain/<id> [cellSize=512]
"""
import json, os, shutil, subprocess, sys, tempfile
from PIL import Image

SF = os.environ.get("SPRITE_FORGE", os.path.expanduser(
    "~/.omp/plugins/node_modules/oh-my-pi-sprite-forge/skills/sprite-forge/scripts/process-sprite.ts"))


def is_frame(p):
    r, g, b = p
    return min(r, b) - g > 40 and r > 150 and b > 150 and g < 120


def main(asset_dir, cell=512):
    shutil.copyfile(os.path.join(asset_dir, "sprite-metadata.json"), os.path.join(asset_dir, "sprite-metadata.marker.json"))
    marker = json.load(open(os.path.join(asset_dir, "sprite-metadata.marker.json")))
    raw = Image.open(os.path.join(asset_dir, marker["source"]["rawFile"])).convert("RGB")
    w, h = raw.size
    def inset(get, n):
        best = 0
        for k in range(8):  # sample 8 lines, take the deepest frame
            i = 0
            while i < n // 2 and is_frame(get(k, i)):
                i += 1
            best = max(best, i)
        return best
    left = inset(lambda k, i: raw.getpixel((i, h * (k + 1) // 9)), w)
    right = inset(lambda k, i: raw.getpixel((w - 1 - i, h * (k + 1) // 9)), w)
    top = inset(lambda k, i: raw.getpixel((w * (k + 1) // 9, i)), h)
    bottom = inset(lambda k, i: raw.getpixel((w * (k + 1) // 9, h - 1 - i)), h)
    m = max(left, right, top, bottom)
    m = m + 3 if m else 0
    crop = raw.crop((m, m, w - m, h - m))
    cropped = os.path.join(asset_dir, "raw-cropped.png")
    crop.save(cropped)
    with tempfile.TemporaryDirectory() as tmp:
        run = subprocess.run(["bun", SF, "--input", cropped, "--output", tmp, "--rows", "1", "--cols", "1",
                              "--cell-size", str(cell), "--duration", "0", "--align", "center", "--sampling", "smooth",
                              "--threshold", "1", "--edge-threshold", "1", "--full-bleed", "--strict",
                              "--source-provider", marker["source"].get("provider", "unknown")], capture_output=True, text=True)
        if run.returncode:
            print(run.stdout[-1500:], run.stderr[-1500:]); return 1
        for name in ("sprite.png", "sprite-sheet.png"):
            shutil.copyfile(os.path.join(tmp, name), os.path.join(asset_dir, name))
        meta = json.load(open(os.path.join(tmp, "sprite-metadata.json")))
    meta["source"] = marker["source"]
    meta["rekey"] = {"tool": "art/tools/deframe.py", "frameInsetPx": m, "croppedRaw": "raw-cropped.png",
                     "markerMetadata": "sprite-metadata.marker.json"}
    json.dump(meta, open(os.path.join(asset_dir, "sprite-metadata.json"), "w"), indent=2)
    print(f"{asset_dir}: frame {left}/{right}/{top}/{bottom}px -> cropped {m}px, passed={meta['qc']['passed']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 512))
