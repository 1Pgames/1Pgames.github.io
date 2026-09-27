#!/usr/bin/env python3
"""Full-cast figure/ground gate for every biome, day and night, with the runtime
night grade reproduced offline. Run from games/<slug>/:

    python3 art/tools/figure-ground-cast.py

Population (per biome scene; figure-ground.py SCOPE rules):
  --fields  that biome's 3 floor tiles (terrain/<biome>-floor-{a,b,c}) ONLY.
  --actors  every building sheet (buildings-a/-b/-c, apex minus the badge glyph,
            building-states scaffold + ruin), every fauna sheet (fauna-a/-b, every
            action), deposits, relics, the shared props, that biome's props and that
            biome's blocker sheet. Frost shells, crack decals, fx, icons and UI are
            not actors (overlays/figures drawn on buildings, never on the floor alone).

Post-review pixel transforms reproduced (art/interface-direction.md night row):
  day          no tint (--grade ffffff).
  night        world-camera overlay #2c2640 at alpha 0.55 on EVERY world pixel, actors
               and floor alike: out = src*0.45 + night*0.55. figure-ground's --grade is
               a field-only multiply and cannot express this lerp, so graded copies of
               actors AND fields are written to a temp dir (mirroring
               .../generated/<group>/<id>/ so manifest exception ids still resolve)
               and measured at --grade ffffff.
  night-mult   the multiply reading used by apex/buildings-b ("multiply by #2c2640,
               blend 0.55"): per channel 255*0.45 + c*0.55 = #8b8896, passed as --grade
               on the untouched field (actors ungraded - the gate's own model).
Each variant is its own invocation, so the cross-asset set rail compares fields
under the same grade only. Exit code = worst of the three runs (0 clean, 1 FAIL, 2 bad call).
"""
import glob
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image

REPO = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
FG = os.path.join(REPO, ".claude/skills/game-art/references/figure-ground.py")
GEN = "public/assets/generated"
BIOMES = ("steppe", "rime", "ember", "nacre")
NIGHT, NIGHT_A = (0x2C, 0x26, 0x40), 0.55
NIGHT_MULT = "8b8896"
RENDER_SCALE = str(json.load(open("art/style.json"))["plan"]["renderScale"])


def sheet(group, aid):
    for name in ("sprite-sheet.png", "sprite.png"):
        p = os.path.join(GEN, group, aid, name)
        if os.path.exists(p):
            return p
    sys.exit(f"figure-ground-cast: no sheet for {group}/{aid}")


def ids(group, pattern="*"):
    return sorted(os.path.basename(os.path.dirname(p))
                  for p in glob.glob(os.path.join(GEN, group, pattern, "sprite-metadata.json")))


def cast(biome):
    out = []
    for g in ("buildings-a", "buildings-b", "buildings-c", "apex"):
        out += [sheet(g, a) for a in ids(g, "bld-*")]
    out += [sheet("building-states", a) for a in ids("building-states", "state-scaffold-*")]
    out += [sheet("building-states", a) for a in ids("building-states", "state-ruin-*")]
    for g in ("fauna-a", "fauna-b", "deposits", "relics"):
        out += [sheet(g, a) for a in ids(g)]
    out += [sheet("world-props", a) for a in ids("world-props", "props-shared-*")]
    out += [sheet("world-props", a) for a in ids("world-props", f"props-{biome}-*")]
    out.append(sheet("terrain", f"{biome}-blockers"))
    return out


def fields(biome):
    return [sheet("terrain", f"{biome}-floor-{v}") for v in "abc"]


def night(src, tmp):
    dst = os.path.join(tmp, "generated", os.path.relpath(src, GEN))
    if not os.path.exists(dst):
        im = Image.open(src).convert("RGBA")
        r, g, b, a = im.split()
        r, g, b = (ch.point(lambda v, c=c: round(v * (1 - NIGHT_A) + c * NIGHT_A)) for ch, c in zip((r, g, b), NIGHT))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        Image.merge("RGBA", (r, g, b, a)).save(dst)
    return dst


def run(label, scenes):
    argv = [sys.executable, FG]
    for name, actors, flds, grade in scenes:
        argv += ["--scene", name, "--actors", *actors, "--fields", *flds, "--grade", grade]
    argv += ["--render-scale", RENDER_SCALE, "--manifest", "art/manifest.json"]
    print(f"===== {label}: " + ", ".join(f"{n} ({len(a)} actor sheets, {len(f)} fields)" for n, a, f, _ in scenes))
    code = subprocess.run(argv).returncode
    print(f"===== {label}: exit {code}\n")
    return code


def main():
    with tempfile.TemporaryDirectory(prefix="aurelia-night-") as tmp:
        day = [(f"{b}-day", cast(b), fields(b), "ffffff") for b in BIOMES]
        lerp = [(f"{b}-night", [night(p, tmp) for p in cast(b)], [night(p, tmp) for p in fields(b)], "ffffff")
                for b in BIOMES]
        mult = [(f"{b}-night-mult", cast(b), fields(b), NIGHT_MULT) for b in BIOMES]
        codes = [run("day", day), run("night #2c2640@0.55 overlay (actors+fields)", lerp),
                 run("night-mult --grade 8b8896 (fields)", mult)]
    worst = 2 if 2 in codes else max(codes)
    print(f"figure-ground-cast: exit {worst} (day {codes[0]}, night {codes[1]}, night-mult {codes[2]})")
    return worst


if __name__ == "__main__":
    sys.exit(main())
