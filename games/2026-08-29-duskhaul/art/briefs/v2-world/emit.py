#!/usr/bin/env python3
"""Emit art/v2/ArtWorld.groups.json and the measured tables in art/v2/ArtWorld.progress.md.

Run from games/2026-08-29-duskhaul/:  python3 art/briefs/v2-world/emit.py
Every alignedBox is read from the exported sprite-metadata.json, never typed by hand.
"""
import json
import sys

sys.path.insert(0, "art/briefs/v2-world")
from talltop import PAIRS  # noqa: E402

ROOT = "public/assets/generated"
ZONES = ["castle", "outlands", "desert", "winter"]

# props-<zone>-c: (name, footprint px long axis, blocking, tall)
PROPS_C = {
    "castle": [("wall-straight", 190, True), ("wall-corner", 180, True), ("wall-broken", 165, True),
               ("pillar", 165, True), ("rubble-heap", 135, True), ("gravestone", 115, True),
               ("monolith", 170, True), ("lamppost", 130, True), ("ironfence", 160, True)],
    "outlands": [("logwall", 180, True), ("palisade-corner", 180, True), ("palisade-broken", 170, True),
                 ("deadtree", 175, True), ("stonepile", 135, True), ("gravemarker", 115, True),
                 ("spiralstone", 165, True), ("gibbetpost", 150, True), ("bonefence", 160, True)],
    "desert": [("mudwall", 185, True), ("mudwall-corner", 180, True), ("mudwall-broken", 160, True),
               ("lotuscolumn", 165, True), ("sandrubble", 135, True), ("stele", 115, True),
               ("sunidol", 165, True), ("cagepost", 150, True), ("ribfence", 160, True)],
    "winter": [("frostwall", 185, True), ("frostwall-corner", 180, True), ("frostwall-broken", 160, True),
               ("snowpine", 180, True), ("snowrubble", 135, True), ("frostgrave", 115, True),
               ("icemonolith", 170, True), ("lanternpost", 130, True), ("icefence", 160, True)],
}
LANDMARKS = {
    "castle": ["lm-belltower", "lm-ossuary", "lm-chapelruin", "lm-barracks", "lm-cistern", "lm-gallowsyard", "lm-cryptmouth", "lm-rampartbreach", "lm-thronecourt"],
    "outlands": ["lm-gibbetrow", "lm-ribcage", "lm-mudcamp", "lm-windmill", "lm-carrionfield", "lm-bonebridge", "lm-burnedfarm", "lm-standingstones", "lm-ashpit"],
    "desert": ["lm-sunkenhead", "lm-drywell", "lm-shadecanopy", "lm-obelisk", "lm-caravanwreck", "lm-tombgate", "lm-dunespine", "lm-saltflat", "lm-scarabmound"],
    "winter": ["lm-frozenshrine", "lm-torchcircle", "lm-icecavern", "lm-widowspire", "lm-corpselake", "lm-brokenwall", "lm-pineclutch", "lm-yetiden", "lm-crownsteps"],
}
TALL_LANDMARKS = {"lm-belltower", "lm-windmill", "lm-obelisk", "lm-widowspire", "lm-pineclutch", "lm-gibbetrow"}
SPLATS = {
    "castle": ["lichen moss", "wet seep stain", "masonry grit"],
    "outlands": ["mud puddle", "ash drift", "dead grass"],
    "desert": ["sand ripple drift", "salt crust", "grit + bone chips"],
    "winter": ["snowdrift", "ice glaze", "hoarfrost rime"],
}
ROADS = {"castle": "cobble", "outlands": "packed dirt ruts", "desert": "hard sand", "winter": "packed snow"}
ATTEMPTS = {"floor-outlands-a": 1, "floor-desert-a": 1, "road-outlands": 1, "road-desert": 1, "road-winter": 1,
            "props-castle-c": 1, "props-outlands-c": 1, "props-desert-c": 1, "props-winter-c": 1}


def meta(group, aid):
    return json.load(open(f"{ROOT}/{group}/{aid}/sprite-metadata.json"))


def box(b):
    return f"{b['left']},{b['top']},{b['width']}x{b['height']}"


def tall_top_index(zone, sheet_id, frame):
    for i, (src, f, _n) in enumerate(PAIRS[zone]):
        if src.split("/")[1] == sheet_id and f == frame:
            return i
    return None


def with_attempts(asset):
    if asset["id"] in ATTEMPTS:
        asset["attempts"] = ATTEMPTS[asset["id"]]
    return asset


def groups():
    floors = []
    for z in ZONES:
        for v in "abc":
            floors.append(with_attempts({"id": f"floor-{z}-{v}", "kind": "bg", "rows": 1, "cols": 1, "duration": 0, "strict": False,
                                         "action": f"{z} floor variant {v}, 256px seamless full-bleed tile, L* 18-32 band (PRD-V2 §3.7)"}))
        floors.append(with_attempts({"id": f"road-{z}", "kind": "bg", "rows": 1, "cols": 1, "duration": 0, "strict": False,
                                     "action": f"{z} road tile ({ROADS[z]}), 256px seamless, L* ~10% under the zone floor"}))
        for v, what in zip("abc", SPLATS[z]):
            floors.append({"id": f"splat-{z}-{v}", "kind": "bg", "rows": 1, "cols": 1, "duration": 0,
                           "action": f"{z} splat decal {v}: {what}, 512px soft-edged alpha (drawn at alpha 0.55 in code)"})
    props = []
    for z in ZONES:
        props.append(with_attempts({"id": f"props-{z}-c", "kind": "ui", "rows": 3, "cols": 3, "duration": 0,
                                    "icons": [f"{z}-{n}" for n, _f, _b in PROPS_C[z]],
                                    "action": f"{z} props C: walls, pillar/tree, rubble, gravestone, monolith, post, fence"}))
        props.append({"id": f"props-{z}-tall-top", "kind": "ui", "rows": 3, "cols": 3, "duration": 0,
                      "icons": [f"{z}-{n}-top" for _s, _f, n in PAIRS[z]],
                      "action": f"{z} tall-prop upper halves for Y-sort occlusion (derived crops, registers 1:1 with base cells)"})
    lms = [{"id": f"landmarks-{z}", "kind": "ui", "rows": 3, "cols": 3, "duration": 0, "icons": LANDMARKS[z],
            "action": f"{z} 9 region landmarks, 512px cells (PRD-V2 §3.5 stamp ids)"} for z in ZONES]
    exc = [
        {"id": "floors-v2/floor-*", "reason": "Full-bleed seamless tiles touch every canvas edge by design; exported fullBleed without --strict (background-contamination waived by structure, same class as zone-*/floor-*). Value band set by the documented tonefit grade (art/briefs/v2-world/process-fullbleed.sh)."},
        {"id": "floors-v2/road-*", "reason": "Full-bleed seamless road tiles, same class as floors-v2/floor-*."},
        {"id": "floors-v2/floor-outlands-*", "reason": "Irregular fieldstones measure ~45-50px at 256 (PRD asks 32-40); a full 984-1000px crop to shrink them doubled the V-seam (16.5 vs noise 6.5), so the seamless 856px crop was kept."},
        {"id": "floors-v2/floor-winter-*", "reason": "Rectangular slabs: autocorrelation pitch 34-35px x 48-49px; the long axis sits 8px over the 32-40 band. Authored mean L* 19-22 (bright frost joints hold p99 at the L*36 ceiling); in band, lower third."},
        {"id": "floors-v2/splat-*", "reason": "Provider returned a smoother, semi-photographic finish on most splats instead of chunky pixels; accepted because splats render at alpha 0.55 as soft ground variation under actors, graded into the floor value band by tonefit. Regenerate if they read as off-style in the run screenshot."},
        {"id": "props-v2/props-*-tall-top", "reason": "Derived, not generated: upper-half crops of the accepted base frames (art/briefs/v2-world/talltop.py) so the occluding top registers pixel-for-pixel with its base; a generated upper half cannot align."},
        {"id": "props-v2/props-desert-c", "reason": "Cells 0-1 (mudwall straight/corner) carry a small warm torch-glow blob at the top-left corner, the style's key-light specular; kept, reads as torchlit brick at 48-170px."},
        {"id": "landmarks/landmarks-*", "reason": "3x3 on a 1024 canvas gives 341px source cells, upscaled to the PRD's 512px cell with smooth sampling (nearest at 1.5x produced uneven pixel rows). Outlands/desert added unrequested wall torches (amber) beside several landmarks; kept as scenic light, they are not hazard telegraphs."},
    ]
    return {
        "owner": "ArtWorld",
        "groups": [
            {"group": "floors-v2", "owner": "ArtWorld", "assets": floors},
            {"group": "props-v2", "owner": "ArtWorld", "assets": props},
            {"group": "landmarks", "owner": "ArtWorld", "assets": lms},
        ],
        "qcExceptions": exc,
    }


def prop_table():
    rows = ["| id | sheet | cell | alignedBox (l,t,wxh) | cell [w,h] | footprint px | blocking | tall-top pair |",
            "|---|---|---|---|---|---|---|---|"]
    for z in ZONES:
        m = meta("props-v2", f"props-{z}-c")
        for i, (name, fp, blk) in enumerate(PROPS_C[z]):
            b = m["frames"][i]["alignedBox"]
            t = tall_top_index(z, f"props-{z}-c", i)
            pair = f"props-{z}-tall-top #{t}" if t is not None else "—"
            rows.append(f"| {z}-{name} | props-{z}-c | {i} | {box(b)} | [{b['width']}, {b['height']}] | {fp} | {'yes' if blk else 'no'} | {pair} |")
    return "\n".join(rows)


def tall_table():
    rows = ["| tall-top sheet | frame | top icon | base sheet (group) | base frame | cutY | top alignedBox |",
            "|---|---|---|---|---|---|---|"]
    for z in ZONES:
        m = meta("props-v2", f"props-{z}-tall-top")
        for f in m["frames"]:
            rows.append(f"| props-{z}-tall-top | {f['index']} | {z}-{f['name']}-top | {f['base']['asset']} ({f['base']['group']}) | {f['base']['frame']} | {f['cutY']} | {box(f['alignedBox'])} |")
    return "\n".join(rows)


def landmark_table():
    rows = ["| stamp id | sheet | cell | alignedBox (512 cell) | cell [w,h] | suggested footprint px | blocking | tall |",
            "|---|---|---|---|---|---|---|---|"]
    for z in ZONES:
        m = meta("landmarks", f"landmarks-{z}")
        for i, lid in enumerate(LANDMARKS[z]):
            b = m["frames"][i]["alignedBox"]
            fp = 380 if lid in TALL_LANDMARKS else 440
            rows.append(f"| {lid} | landmarks-{z} | {i} | {box(b)} | [{b['width']}, {b['height']}] | {fp} | yes (base footprint) | {'yes' if lid in TALL_LANDMARKS else 'no'} |")
    return "\n".join(rows)


if __name__ == "__main__":
    json.dump(groups(), open("art/v2/ArtWorld.groups.json", "w"), indent=2)
    open("art/briefs/v2-world/tables.md", "w").write(
        "## Prop cells (props-<zone>-c)\n\n" + prop_table() + "\n\n## Tall-top pairs\n\n" + tall_table()
        + "\n\n## Landmark cells\n\n" + landmark_table() + "\n")
    print("wrote art/v2/ArtWorld.groups.json and art/briefs/v2-world/tables.md")
