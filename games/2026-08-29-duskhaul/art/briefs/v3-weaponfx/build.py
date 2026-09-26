#!/usr/bin/env python3
"""ArtWeaponFx V3 (weapon-fx-v1) export driver (repro record).

Reads art/briefs/v3-weaponfx/assets.json (one row per asset: group, id, raw, rows, cols,
cell, cellHeight?, duration, loop?, action, flags?) and reprocesses each accepted raw
through sprite-forge's deterministic processor (`process-sprite.ts`, the documented
reprocessing fallback) into public/assets/generated/<group>/<id>/, strict QC,
raw preserved, provider recorded. Then writes art/v2/ArtWeaponFx.groups.json.

Usage (cwd = games/2026-08-29-duskhaul):
  python3 art/briefs/v3-weaponfx/build.py [id ...]     # process listed ids (default: all with a raw)
  python3 art/briefs/v3-weaponfx/build.py --groups     # only rewrite the groups file
"""
import json, os, subprocess, sys

GAME = os.getcwd()
PROC = os.path.expanduser(
    "~/.omp/plugins/node_modules/oh-my-pi-sprite-forge/skills/sprite-forge/scripts/process-sprite.ts")
STYLE = os.path.join(GAME, "art/style.json")
TABLE = os.path.join(GAME, "art/briefs/v3-weaponfx/assets.json")
OUT = os.path.join(GAME, "public/assets/generated")


def load():
    with open(TABLE) as f:
        return json.load(f)


def bg_distance(path):
    """Median distance of the raw's border pixels from pure magenta (xai returns off-key pinks)."""
    from PIL import Image
    im = Image.open(path).convert("RGB")
    w, h = im.size
    pts = [(x, y) for x in range(4, w - 4, max(1, w // 40)) for y in (4, h - 5)]
    pts += [(x, y) for y in range(4, h - 4, max(1, h // 40)) for x in (4, w - 5)]
    ds = sorted(((255 - r) ** 2 + g ** 2 + (255 - b) ** 2) ** 0.5
                for r, g, b in (im.getpixel(p) for p in pts))
    return ds[len(ds) // 2]


def despill(src, t):
    """Chroma-key spill suppression on the raw, before keying (no art is drawn).
    JPEG blends of dark soot flecks with the magenta key survive a threshold that must stay below
    the grey ash's own key distance, and read as crimson specks (warm = enemy in this game).
    Only red-leaning magenta pixels that WOULD survive keying (distance > t) are touched: their
    red and blue are pulled down to just above green, i.e. the neutral dark soot they came from.
    Violet art (b > r) is never touched. Writes <raw stem>.keyprep.png next to the raw."""
    from PIL import Image
    im = Image.open(src).convert("RGB")
    px = im.load()
    w, h = im.size
    n = 0
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if r > b + 5 and r - g > 50 and b - g > 20 and ((255 - r) ** 2 + g * g + (255 - b) ** 2) ** 0.5 > t:
                v = g + min(24, (min(r, b) - g) // 3)
                px[x, y] = (v, g, v)
                n += 1
    out = os.path.splitext(src)[0] + ".keyprep.png"
    im.save(out)
    print(f"  despill: {n} px -> {out}")
    return out

def process(a):
    out = os.path.join(OUT, a["group"], a["id"])
    os.makedirs(out, exist_ok=True)
    # The keyer's style-profile chroma guard is NOT bound: xai returns the key as an off-magenta
    # pink (measured 99-125 from #FF00FF), which sits nearer to the profile's #c084fc anchor than
    # to magenta, so the guard "protects" the whole background. Assets that carry violet art
    # (#ad6eef 138 / #c084fc 146 from magenta) instead key at a threshold measured from THIS raw's
    # background, so the violet stays outside the key band.
    src = despill(a["raw"], a["threshold"]) if a.get("despill") else a["raw"]
    cmd = ["bun", PROC, "--input", src, "--output", out,
           "--rows", str(a["rows"]), "--cols", str(a["cols"]),
           "--cell-size", str(a["cell"]), "--duration", str(a.get("duration", 0)),
           "--align", "center", "--scale", "fit", "--sampling", "nearest",
           "--component-mode", "all",
           "--preserve-raw", "--source-provider", a.get("provider", "xai-oauth")]
    if a.get("threshold"):
        # Explicit per-raw key threshold, measured: 1st-percentile art distance from #FF00FF
        # minus a margin (see assets.json "thresholdNote").
        t = a["threshold"]
        cmd += ["--threshold", str(t), "--edge-threshold", str(t)]
    elif a.get("violet"):
        t = int(min(170, max(125, bg_distance(a["raw"]) + 35)))
        cmd += ["--threshold", str(t), "--edge-threshold", str(t)]
    if a.get("cellHeight"):
        cmd += ["--cell-height", str(a["cellHeight"])]
    if a.get("fit"):
        cmd += ["--fit", str(a["fit"])]
    if not a.get("nonStrict"):
        cmd += ["--strict"]
    cmd += a.get("flags", [])
    r = subprocess.run(cmd, capture_output=True, text=True)
    meta_ok = os.path.join(out, "sprite-metadata.json")
    meta_bad = os.path.join(out, "sprite-metadata.failed.json")
    status = "OK" if r.returncode == 0 else "FAIL"
    src = meta_bad if (r.returncode != 0 and os.path.exists(meta_bad)) else meta_ok
    info = ""
    if os.path.exists(src):
        m = json.load(open(src))
        q = m.get("qc", {})
        s = q.get("summary", {})
        info = (f"passed={q.get('passed')} failures={q.get('failures')} frames={s.get('frameCount')} "
                f"empty={s.get('emptyCount')} edge={s.get('sourceEdgeTouchCount')} "
                f"notes={[n[:70] for n in q.get('notes', [])]}")
    print(f"[{status}] {a['group']}/{a['id']} {info}")
    if r.returncode != 0:
        print(r.stderr.strip()[-600:])
    return r.returncode == 0


def groups():
    rows = load()
    order = []
    by = {}
    for a in rows:
        if a["group"] not in by:
            by[a["group"]] = []
            order.append(a["group"])
        entry = {"id": a["id"], "kind": a.get("kind", "fx"), "rows": a["rows"], "cols": a["cols"]}
        if a["rows"] * a["cols"] > 1:
            entry["duration"] = a.get("duration", 0)
            if "loop" in a:
                entry["loop"] = a["loop"]
        entry["action"] = a["action"]
        for k in ("icons", "textureAlias", "animAlias", "attempts"):
            if k in a:
                entry[k] = a[k]
        by[a["group"]].append(entry)
    data = {
        "owner": "ArtWeaponFx",
        "styleProfile": "games/2026-08-29-duskhaul/art/style.json",
        "groups": [{"group": g, "owner": "ArtWeaponFx", "assets": by[g]} for g in order],
        "qcExceptions": json.load(open(os.path.join(GAME, "art/briefs/v3-weaponfx/exceptions.json"))),
    }
    os.makedirs(os.path.join(GAME, "art/v2"), exist_ok=True)
    with open(os.path.join(GAME, "art/v2/ArtWeaponFx.groups.json"), "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    print("wrote art/v2/ArtWeaponFx.groups.json:", sum(len(v) for v in by.values()), "assets")

def palette():
    """sprite_check_palette (same checkPalette as the xd device) on every export; recorded in assets.json."""
    rows = load()
    sp = os.path.join(os.path.dirname(PROC), "style-profile.ts")
    for a in rows:
        d = os.path.join(OUT, a["group"], a["id"])
        png = os.path.join(d, "sprite-sheet.png" if a["rows"] * a["cols"] > 1 else "sprite.png")
        if not os.path.exists(png):
            print("MISSING", a["id"])
            continue
        r = subprocess.run(["bun", sp, "--profile", STYLE, "--input", png], capture_output=True, text=True)
        rep = json.loads(r.stdout)
        a["meanDistance"] = round(rep["meanDistance"], 2)
        a["palettePassed"] = rep["passed"]
        print(f"{a['group']}/{a['id']}: meanDistance={a['meanDistance']} passed={rep['passed']} outliers={rep['outlierFraction']:.3f}")
    with open(TABLE, "w") as f:
        json.dump(rows, f, indent=1)



if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["--groups"]:
        groups()
        sys.exit(0)
    if args == ["--palette"]:
        palette()
        groups()
        sys.exit(0)
    if args and args[0] == "--set":
        # --set id=/tmp/omp-image-x.jpg ...  copy raws into the brief raw store, then process them
        import shutil
        rows = load()
        ids = []
        for pair in args[1:]:
            aid, path = pair.split("=", 1)
            row = next(r for r in rows if r["id"] == aid)
            dst = os.path.join(GAME, "art/briefs/v3-weaponfx/raw", aid + os.path.splitext(path)[1])
            shutil.copyfile(path, dst)
            row["raw"] = dst
            row["attempts"] = row.get("attempts", 0) + 1
            ids.append(aid)
        with open(TABLE, "w") as f:
            json.dump(rows, f, indent=1)
        args = ids
    fails = 0
    for a in load():
        if not a.get("raw"):
            continue
        if args and a["id"] not in args:
            continue
        if not process(a):
            fails += 1
    groups()
    sys.exit(1 if fails else 0)
