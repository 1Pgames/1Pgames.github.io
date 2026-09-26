#!/usr/bin/env python3
"""ArtArsenalFx (weapon-fx-v2) export driver (repro record).

Same process as art/briefs/v3-weaponfx/build.py (the proven weapon-fx-v1 pipeline): each accepted
native generate_image raw is (1) cleaned of provider layout chrome by clean.py when `clean` is set,
then (2) reprocessed through sprite-forge's deterministic processor (process-sprite.ts) into
public/assets/generated/weapon-fx-v2/<id>/, strict QC, raw preserved, provider recorded, and
(3) palette-checked with sprite-forge's style-profile.ts (the sprite_check_palette implementation).
Finally writes art/v2/ArtArsenalFx.groups.json.

Usage (cwd = games/2026-08-29-duskhaul):
  python3 art/briefs/v4-arsenal-fx/build.py [id ...]   # process listed ids (default: all with a raw)
  python3 art/briefs/v4-arsenal-fx/build.py --palette  # palette-check every export, rewrite groups
  python3 art/briefs/v4-arsenal-fx/build.py --groups   # only rewrite the groups file
"""
import json, os, subprocess, sys

GAME = os.getcwd()
BRIEF = os.path.join(GAME, "art/briefs/v4-arsenal-fx")
PROC = os.path.expanduser(
    "~/.omp/plugins/node_modules/oh-my-pi-sprite-forge/skills/sprite-forge/scripts/process-sprite.ts")
STYLE = os.path.join(GAME, "art/style.json")
TABLE = os.path.join(BRIEF, "assets.json")
OUT = os.path.join(GAME, "public/assets/generated")
sys.path.insert(0, BRIEF)
import clean as cleaner  # noqa: E402


def load():
    with open(TABLE) as f:
        return json.load(f)


def save(rows):
    with open(TABLE, "w") as f:
        json.dump(rows, f, indent=1)
        f.write("\n")


def bg_distance(path):
    """Median distance of the raw's key pixels from pure magenta (xai returns off-key pinks)."""
    from PIL import Image
    im = Image.open(path).convert("RGB")
    k = cleaner.key_colour(im)
    return ((255 - k[0]) ** 2 + k[1] ** 2 + (255 - k[2]) ** 2) ** 0.5


def process(a):
    out = os.path.join(OUT, a["group"], a["id"])
    os.makedirs(out, exist_ok=True)
    src = os.path.join(GAME, a["raw"])
    if a.get("clean"):
        src = cleaner.clean(a["id"], src)
    # Chroma guard NOT bound (same measured reason as v3: xai's off-magenta pink key sits nearer the
    # profile's #c084fc anchor than to #FF00FF, so the guard would "protect" the background). Violet
    # art is instead keyed at a threshold measured from THIS raw's key colour: bg distance + 35,
    # clamped 125..170, which keeps #ad6eef (138 from magenta) outside the key band.
    cmd = ["bun", PROC, "--input", src, "--output", out,
           "--rows", str(a["rows"]), "--cols", str(a["cols"]),
           "--cell-size", str(a["cell"]), "--duration", str(a.get("duration", 0)),
           "--align", a.get("align", "center"), "--scale", a.get("scale", "fit"), "--sampling", "nearest",
           "--component-mode", a.get("componentMode", "all"),
           "--preserve-raw", "--source-provider", a.get("provider", "xai-oauth")]
    t = a.get("threshold") or int(min(170, max(125, bg_distance(src) + 35)))
    cmd += ["--threshold", str(t), "--edge-threshold", str(t)]
    if a.get("cellHeight"):
        cmd += ["--cell-height", str(a["cellHeight"])]
    if a.get("fit"):
        cmd += ["--fit", str(a["fit"])]
    cmd += ["--strict"]
    cmd += a.get("flags", [])
    r = subprocess.run(cmd, capture_output=True, text=True)
    meta_ok = os.path.join(out, "sprite-metadata.json")
    meta_bad = os.path.join(out, "sprite-metadata.failed.json")
    status = "OK" if r.returncode == 0 else "FAIL"
    m_src = meta_bad if (r.returncode != 0 and os.path.exists(meta_bad)) else meta_ok
    info = ""
    if os.path.exists(m_src):
        m = json.load(open(m_src))
        q = m.get("qc", {})
        s = q.get("summary", {})
        info = (f"t={t} passed={q.get('passed')} failures={q.get('failures')} frames={s.get('frameCount')} "
                f"empty={s.get('emptyCount')} edge={s.get('sourceEdgeTouchCount')} "
                f"notes={[n[:80] for n in q.get('notes', [])]}")
    print(f"[{status}] {a['group']}/{a['id']} {info}")
    if r.returncode != 0:
        print(r.stderr.strip()[-700:])
    return r.returncode == 0


def palette():
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
        print(f"{a['id']}: meanDistance={a['meanDistance']} passed={rep['passed']} outliers={rep['outlierFraction']:.3f}")
    save(rows)


def groups():
    rows = load()
    assets = []
    for a in rows:
        if not a.get("raw"):
            continue
        e = {"id": a["id"], "kind": a.get("kind", "fx"), "rows": a["rows"], "cols": a["cols"]}
        if a["rows"] * a["cols"] > 1:
            e["duration"] = a.get("duration", 0)
            if "loop" in a:
                e["loop"] = a["loop"]
        e["action"] = a["action"]
        for k in ("attempts",):
            if k in a:
                e[k] = a[k]
        assets.append(e)
    data = {
        "owner": "ArtArsenalFx",
        "styleProfile": "games/2026-08-29-duskhaul/art/style.json",
        "groups": [{"group": "weapon-fx-v2", "owner": "ArtArsenalFx", "assets": assets}],
        "qcExceptions": json.load(open(os.path.join(BRIEF, "exceptions.json"))),
    }
    with open(os.path.join(GAME, "art/v2/ArtArsenalFx.groups.json"), "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    print("wrote art/v2/ArtArsenalFx.groups.json:", len(assets), "assets")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["--groups"]:
        groups()
        sys.exit(0)
    if args == ["--palette"]:
        palette()
        groups()
        sys.exit(0)
    fails = 0
    for a in load():
        if not a.get("raw") or (args and a["id"] not in args):
            continue
        if not process(a):
            fails += 1
    groups()
    sys.exit(1 if fails else 0)
