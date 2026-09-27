#!/usr/bin/env python3
"""Re-key an accepted marker export WITHOUT the sprite-forge chroma guard.

Why: xai returns the key as pink (~rgb 252,61,175), not #FF00FF. With `styleProfile`
bound, the processor's chroma guard keeps every keyable pixel that sits nearer ANY
palette anchor than pure magenta -- including anchors far outside the key band
(#a78f75 at 217 from magenta). On pink raws that keeps the antialiased pink rim and
every glow halo fully opaque (icons-goods-a: 13466 pinkish px guarded vs 198 re-keyed).
Our palette has NO anchor inside the key band (min magenta distance 207.2 > softLimit
205 = threshold 150 + feather 55), so the guard has nothing legitimate to protect here.

What it does: reads the export's own sprite-metadata.json (the EFFECTIVE params the
marker used), re-runs process-sprite.ts on raw-source.* with the same params minus
--style-profile, and replaces the outputs in place. The marker's metadata is kept as
sprite-metadata.marker.json (provenance: styleProfile-bound generation, provider).

Usage (from games/<slug>/):  python3 art/tools/rekey.py public/assets/generated/<group>/<id> [...]
Needs: bun; SPRITE_FORGE (defaults to the omp plugin path).
"""
import json, os, shutil, subprocess, sys, tempfile

SF = os.environ.get("SPRITE_FORGE", os.path.expanduser(
    "~/.omp/plugins/node_modules/oh-my-pi-sprite-forge/skills/sprite-forge/scripts/process-sprite.ts"))


def rekey(asset_dir: str) -> int:
    marker = os.path.join(asset_dir, "sprite-metadata.marker.json")
    meta_path = os.path.join(asset_dir, "sprite-metadata.json")
    if not os.path.exists(marker):
        shutil.copyfile(meta_path, marker)
    meta = json.load(open(marker))
    o, src, grid, qc = meta["output"], meta["source"], meta["grid"], meta["qc"]
    raw = os.path.join(asset_dir, src["rawFile"])
    args = ["bun", SF, "--input", raw, "--rows", str(grid["rows"]), "--cols", str(grid["cols"]),
            "--cell-size", str(o["cellSize"]), "--cell-height", str(o["cellHeight"]),
            "--duration", str(o["durationMs"]), "--align", o["align"], "--scale", o["scaleMode"],
            "--fit", str(o["fit"]), "--threshold", str(o["threshold"]), "--feather", str(o["feather"]),
            "--edge-threshold", str(o["edgeThreshold"]), "--sampling", o["sampling"],
            "--component-mode", o["componentMode"], "--component-padding", str(o["componentPadding"]),
            "--min-component-area", str(o["minComponentArea"]), "--source-provider", src.get("provider", "unknown")]
    if qc.get("strict", True):
        args.append("--strict")
    if o.get("fullBleed"):
        args.append("--full-bleed")
    scale_files = [f for f in os.listdir(asset_dir) if f.endswith("-scale.json")]
    if scale_files:
        name = scale_files[0][: -len("-scale.json")]
        args += ["--profile-name", name]
    with tempfile.TemporaryDirectory() as tmp:
        if scale_files:
            args += ["--write-scale-profile", os.path.join(tmp, scale_files[0])]
        args += ["--output", tmp]
        run = subprocess.run(args, capture_output=True, text=True)
        if run.returncode != 0:
            print(f"{asset_dir}: FAILED\n{run.stdout[-1500:]}{run.stderr[-1500:]}")
            return 1
        for name in os.listdir(tmp):
            if name.startswith("raw-source"):
                continue
            dst = os.path.join(asset_dir, name)
            if os.path.isdir(dst):
                shutil.rmtree(dst)
            shutil.move(os.path.join(tmp, name), dst)
    new = json.load(open(meta_path))
    new["source"] = src
    new["rekey"] = {"tool": "art/tools/rekey.py", "chromaGuard": "off", "markerMetadata": "sprite-metadata.marker.json",
                    "styleProfile": "games/2026-09-26-outpost-aurelia/art/style.json"}
    json.dump(new, open(meta_path, "w"), indent=2)
    print(f"{asset_dir}: ok passed={new['qc']['passed']} notes={new['qc'].get('notes')}")
    return 0


if __name__ == "__main__":
    sys.exit(max((rekey(d.rstrip('/')) for d in sys.argv[1:]), default=2))
