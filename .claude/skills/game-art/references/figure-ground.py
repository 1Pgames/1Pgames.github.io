#!/usr/bin/env python3
"""Figure/ground + cross-asset readability gate for a generated art set.

ONE SCENE:
    python3 figure-ground.py --actors <sheet.png ...> --fields <floor-or-bg.png ...>
        [--grade <hex|hex,...>] [--manifest art/manifest.json]
        [--render-scale 48] [--field-scale 0] [--json]

EVERY SCENE IN THE GAME, one command (the form a group sign-off must run):
    python3 figure-ground.py
        --scene <zone-a> --actors <a's cast ...> --fields <a's fields ...> --grade <hex>
        --scene <zone-b> --actors <b's cast ...> --fields <b's fields ...> --grade <hex>
        --manifest art/manifest.json

WHY THIS EXISTS
Every other gate in this pipeline measures ONE asset against a PROFILE. Nothing ever
compared a BACKDROP against the ACTORS drawn on it, so `zone-desert/floor-desert`
shipped at 27.45% figure/ground clash while a 103-asset audit returned an EMPTY
reject list and the verdict "Yes. I would ship this set." The same tile measured
2.39x the hero-sprite readability ceiling. A per-asset gate structurally cannot see
either defect: both live in the RELATIONSHIP between two assets. This is the
missing comparison, and it is the set-level gate a group must clear before anyone
may call it accepted.

SCOPE / POPULATION -- state it whenever you quote a number from here
  --fields  FIELD assets only: the things actors are drawn ON TOP OF. Floor and
            terrain tiles, backdrops, parallax layers, arena ground. NOT arena
            borders or walls (actors never stand on them), NOT props.
  --actors  the actor sheets that will actually be drawn on those fields IN THE
            SAME SCENE -- hero + that zone's enemies + that zone's ground props.
            Not the whole game's cast: a winter floor is judged against winter
            actors, because that is the pairing the player sees.
  NEVER run this on sprites, icons, FX or UI. Those are figures, not grounds, and
  every criterion below is meaningless for them. A gate applied to the wrong
  population is the single most common way this pipeline has produced confident
  wrong answers (five audit heuristics were retracted for exactly that).

WHAT IT MEASURES
Per-pixel LINEAR luminance (Rec.709 on linearised sRGB) -- perceptual value, not
the 8-bit channel mean, because the criteria are about what the eye separates.
Fields are measured AFTER the runtime grade tint (`--grade`), because a floor drawn
through `setTint()` is not the authored tile: on Duskhaul that tint moved the desert
field's mean from 0.4630 to 0.2460. Pass the tint or your numbers are fiction.

  read      Every field must COMMIT to a direction, and the gate infers which:
              inverted  field p50 >  actor p90  -- a bright field (sand, snow,
                        paper); actors read as dark holes punched in it.
              recessive field p50 <= actor p90  -- a dark ground the actors sit
                        above.
            The shipped defect is a field that does neither well: it sits IN the
            actor band, and then nothing on screen owns any part of the value range.

  clash%    Share of field pixels with NO value separation from the actors,
            measured in the field's own read direction against ONE boundary,
            the actor p90:
              recessive -> share of field pixels ABOVE actor p90
              inverted  -> share of field pixels BELOW actor p90
            This is the number that names the defect. Duskhaul's broken desert
            floor read 27.45% (original 8-bit definition), the fix read 0.63%.

  C1        foreground ownership: field p99 <= 0.5 * actor p99.
            The actors own the top of the value range in BOTH read directions. A
            field that out-highlights the brightest actor pixel steals the eye.

  busyRatio field high-frequency energy / actor high-frequency energy. Each side is
            measured at the size it is DRAWN AT on screen: actors at
            --render-scale (the sprite's on-screen long edge), fields at native 1:1
            (a floor tileSprite draws unscaled) unless --field-scale says otherwise.
            A ground busier than the actors on it is a readability-ceiling breach.

CROSS-ASSET SET SPREAD -- the second half of the gate
With 2+ fields it prints the set's meanL / busy / clash spread and flags any member
sitting more than 2x the set median on busyness. 103 assets passed individually
while one member sat 2.39x off the set's rail; that only becomes visible when the
set is measured against ITSELF.

TWO BANDS, AND THE BOOKKEEPING RULE
  FAIL  -> regenerate. Do not ship, do not write an exception for it.
  WARN  -> shippable ONLY with a matching `{ "id", "reason" }` entry in
           `art/manifest.json.qcExceptions[]`, written to the FILE, not merely
           mentioned in a report. Pass --manifest to have that checked here: a WARN
           with no manifest entry is reported as a FAIL. 26 asset-level exceptions
           once lived only in prose while the manifest held 6; a warning nobody is
           forced to record is a warning nobody records.

EXIT CODE
  0  every field clean (warn-band findings allowed when the manifest records them)
  1  at least one measured FAIL. Exit 1 ALWAYS comes with the measurement table
     above it; that is what makes it safe to gate on.
  2  bad invocation or bad population -- unknown flag, missing --actors/--fields,
     bad --grade count or hex, unreadable path, malformed manifest, actor sheets
     with no opaque pixels. NEVER 1: a typo'd flag that exits 1 is indistinguishable
     from broken art, and an agent gating on the code would regenerate assets
     because it mistyped a command.

THRESHOLD PROVENANCE -- READ BEFORE CHANGING A DEFAULT
A criterion may not reject anything until it has been run against the ACCEPTED set
and shown to pass it. Calibration run, 2026-08-29 Duskhaul, the 4 shipped zone
floors, each against its OWN zone's complete cast (hero idle+run + both zone
enemies) through its own real `FLOOR_GRADE` tint:

    floor-castle    clash  0.02%  busyRatio 0.47  C1 pass  read recessive  -> pass
    floor-outlands  clash  0.00%  busyRatio 0.53  C1 pass  read recessive  -> pass
    floor-winter    clash  0.01%  busyRatio 0.17  C1 pass  read recessive  -> pass
    floor-desert    clash 12.85%  busyRatio 0.35  C1 pass  read inverted   -> WARN

REJECT SIDE, validated the same day: the PRE-FIX desert tile is gone from disk, so
it was reconstructed from the figures its own report records (value tiers
0.65/0.12/0.23, stripe troughs at 8-bit luma ~40, authored linear mean 0.4630). The
reconstruction lands at graded mean 0.1670 against the report's recorded 0.1666 --
a faithful stand-in -- and this gate FAILS it at clash 34.88%. So the gate separates
the tile that shipped broken (34.88%) from the tile that replaced it (12.85%) with a
ceiling of 15.0% between them.

CLASH_WARN=8.0 / CLASH_FAIL=15.0: the whole accepted canon passes, and the single
member that lands in the WARN band is exactly the one whose manifest already carries
a `qcExceptions` entry for its thin violet trough tier. BUSY_WARN=0.80 /
BUSY_FAIL=1.20 sits above the accepted maximum of 0.53 and below the 2.39x that
shipped broken.

POPULATION SENSITIVITY -- this is why `--actors` must be the COMPLETE cast.
Measured: the accepted desert floor reads clash 12.85% (WARN, passes) against its
full 4-sheet cast, and 20.04% (FAIL) against only 2 of those sheets, because a
smaller cast moves the actor p90 boundary. A partial cast is not a conservative
approximation, it is a different criterion. Pass every actor sheet the scene's
`ART_GROUPS` actually loads, and read the printed sheet/pixel count to confirm it.

Arena BORDERS were deliberately excluded from the population and must stay out of
`--fields`: border-winter measures 21.37% clash and is CORRECT, because no actor is
ever drawn on a wall. Including it would have forced the ceiling above 21% and made
the gate blind.

OPEN HYPOTHESIS, recorded so the next game TESTS it instead of inheriting a guess:
a recessive field whose bulk sits exactly on the actor MEDIAN (rather than poking
above the actor p90) is plausibly also unreadable, and no criterion here catches it.
There is exactly one measured defect instance to calibrate against, and it was an
inverted-read failure, so a median-collision criterion would be unvalidated. Do not
add it as a gate until you have an accepted set and a real defect to separate.

If the accepted canon fails a rule you add here, the RULE is wrong -- two reject
criteria ("no visible pixel grid", "missing 1px outline") were retired for exactly
that reason after the canon was measured, and five audit heuristics were retracted
for being right about the metric and wrong about the population. Re-run the
calibration, rewrite this block with the new numbers, and never tighten a threshold
you have not re-measured against an accepted set.

Pillow only; no numpy required.
"""

from __future__ import annotations

import json
import os
import sys
from fnmatch import fnmatch

from PIL import Image, ImageChops, ImageStat

CLASH_WARN, CLASH_FAIL = 8.0, 15.0
BUSY_WARN, BUSY_FAIL = 0.80, 1.20
SET_BUSY_WARN = 2.0  # x the set median


class BadInvocation(Exception):
    """A command-line or population error, distinct from an art FAIL.

    Exit code 2, never 1. A typo'd flag that exits 1 is indistinguishable from a real
    figure/ground failure, and an agent gating on the exit code will regenerate art
    because it mistyped a command.
    """


# sRGB -> linear, per 8-bit channel value.
_LUT = [
    (c / 255.0 / 12.92) if (c / 255.0) <= 0.04045 else (((c / 255.0) + 0.055) / 1.055) ** 2.4
    for c in range(256)
]


def _lin(r: int, g: int, b: int) -> float:
    return 0.2126 * _LUT[r] + 0.7152 * _LUT[g] + 0.0722 * _LUT[b]


def _stats(values: list[float]) -> dict:
    values.sort()
    n = len(values)

    def pct(p: float) -> float:
        return values[min(n - 1, int(n * p))]

    return {"mean": sum(values) / n, "p10": pct(0.10), "p50": pct(0.50),
            "p90": pct(0.90), "p99": pct(0.99), "n": n}


def _share_above(values: list[float], bound: float) -> float:
    return sum(1 for v in values if v > bound) / len(values) * 100.0


def _at_scale(im: Image.Image, scale: int) -> Image.Image:
    """Downsample the long edge to `scale` px: the size the player actually sees."""
    w, h = im.size
    if scale <= 0 or max(w, h) <= scale:
        return im
    k = scale / float(max(w, h))
    return im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)


def _busy(rgb: Image.Image) -> float:
    """Mean absolute adjacent-pixel difference: high-frequency energy per screen pixel."""
    w, h = rgb.size
    if w < 2 or h < 2:
        return 0.0
    dx = ImageChops.difference(rgb.crop((1, 0, w, h)), rgb.crop((0, 0, w - 1, h)))
    dy = ImageChops.difference(rgb.crop((0, 1, w, h)), rgb.crop((0, 0, w, h - 1)))
    return (sum(ImageStat.Stat(dx).mean[:3]) + sum(ImageStat.Stat(dy).mean[:3])) / 6.0


def _rgba(im: Image.Image):
    """Yield (r, g, b, a) tuples. `tobytes` instead of the deprecated `getdata`."""
    buf = im.tobytes()
    return zip(buf[0::4], buf[1::4], buf[2::4], buf[3::4])


def actor_reference(paths: list[str], render_scale: int) -> dict:
    """Pooled linear-luma stats of the OPAQUE actor pixels + mean actor busyness."""
    values: list[float] = []
    busies: list[float] = []
    for path in paths:
        im = Image.open(path).convert("RGBA")
        values.extend(_lin(r, g, b) for r, g, b, a in _rgba(im) if a > 128)
        # Busyness is measured on the opaque CORE only; the transparent margin would
        # otherwise dilute every sprite toward zero energy and inflate every ratio.
        small = _at_scale(im, render_scale)
        bbox = small.split()[3].point(lambda a: 255 if a > 128 else 0).getbbox()
        if bbox:
            busies.append(_busy(small.convert("RGB").crop(bbox)))
    if not values:
        raise BadInvocation("--actors sheets have no opaque pixels")
    ref = _stats(values)
    ref["sheets"] = len(paths)
    ref["busy"] = sum(busies) / len(busies) if busies else 0.0
    return ref


def field_metrics(path: str, grade: int, actor: dict, field_scale: int) -> dict:
    im = Image.open(path).convert("RGBA")
    gr, gg, gb = (grade >> 16) & 255, (grade >> 8) & 255, grade & 255
    # Phaser's multiply tint, per channel, in 8-bit sRGB space -- same as the runtime.
    values = [
        _lin((r * gr) // 255, (g * gg) // 255, (b * gb) // 255)
        for r, g, b, _a in _rgba(im)
    ]
    st = _stats(values)
    inverted = st["p50"] > actor["p90"]
    # One boundary (actor p90), direction from the read.
    below = 100.0 - _share_above(values, actor["p90"])
    clash = below if inverted else _share_above(values, actor["p90"])
    busy = _busy(_at_scale(im, field_scale).convert("RGB"))
    return {
        "file": path,
        "grade": f"{grade:06x}",
        "minAlpha": min(im.split()[3].getextrema()),
        "read": "inverted" if inverted else "recessive",
        "meanL": st["mean"],
        "p50": st["p50"],
        "p90": st["p90"],
        "p99": st["p99"],
        "lightRange": st["p99"] - st["p10"],
        "C1": st["p99"] <= actor["p99"] / 2.0,
        "clash%": clash,
        "busy": busy,
        "busyRatio": busy / actor["busy"] if actor["busy"] else float("inf"),
    }


def judge(row: dict, actor: dict) -> tuple[list[str], list[str]]:
    fails: list[str] = []
    warns: list[str] = []
    if not row["C1"]:
        fails.append(
            f"C1 foreground-ownership: field p99 {row['p99']:.4f} > "
            f"{actor['p99'] / 2:.4f} (0.5 * actor p99) -- the ground out-highlights "
            f"the actors drawn on it"
        )
    clash = row["clash%"]
    if clash > CLASH_FAIL:
        fails.append(
            f"figure-ground-clash {clash:.2f}% > {CLASH_FAIL}% ({row['read']} read) -- "
            f"actors lose their silhouette on that share of the screen; commit harder "
            f"to a recessive dark ground or a bright inverted field and regenerate"
        )
    elif clash > CLASH_WARN:
        warns.append(f"figure-ground-clash {clash:.2f}% in the {CLASH_WARN}-{CLASH_FAIL}% "
                     f"warn band ({row['read']} read)")
    ratio = row["busyRatio"]
    if ratio > BUSY_FAIL:
        fails.append(
            f"readability-ceiling busyRatio {ratio:.2f}x > {BUSY_FAIL}x -- the ground "
            f"carries more high-frequency energy than the actors on it"
        )
    elif ratio > BUSY_WARN:
        warns.append(f"readability-ceiling busyRatio {ratio:.2f}x in the {BUSY_WARN}-"
                     f"{BUSY_FAIL}x warn band")
    return fails, warns


COLS = [
    ("file", 40, "s"), ("grade", 6, "s"), ("minAlpha", 8, "d"), ("read", 9, "s"),
    ("meanL", 7, ".4f"), ("p50", 7, ".4f"), ("p99", 7, ".4f"), ("lightRange", 10, ".4f"),
    ("clash%", 7, ".2f"), ("busy", 6, ".2f"), ("busyRatio", 9, ".2f"),
]


def _median(vals: list[float]) -> float:
    s = sorted(vals)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0


def _manifest_exceptions(path: str) -> list[str]:
    """Ids of `qcExceptions[]` entries that carry a real one-line reason.

    An entry with no `reason` is not an exception, it is an unexplained waiver, so it
    does not satisfy the warn-band requirement. Ids may be fnmatch patterns
    (`zone-*/floor-*`), which is how the canon writes a whole-class exception.
    """
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    out: list[str] = []
    for entry in data.get("qcExceptions") or []:
        if isinstance(entry, dict) and entry.get("id") and str(entry.get("reason") or "").strip():
            out.append(str(entry["id"]))
    return out


def _asset_id(path: str) -> str:
    """`.../generated/<group>/<asset>/sprite.png` -> `<group>/<asset>`."""
    tail = path.split("/generated/", 1)[-1]
    parts = [p for p in os.path.dirname(tail).split("/") if p]
    return "/".join(parts[-2:]) if len(parts) >= 2 else tail


def _parse(argv: list[str]):
    """Repeated `--scene NAME --actors ... --fields ... [--grade ...]` blocks.

    A single-scene invocation may omit `--scene`. Fields are always judged against
    THEIR OWN scene's actors; the set-level spread runs across every field in the
    whole invocation. That split is the point: the figure/ground verdict is a
    per-scene pairing, the coherence rail is game-wide.
    """
    scenes: list[dict] = []
    render_scale, field_scale = 48, 0
    manifest: str | None = None
    as_json = False
    bucket: list[str] | None = None

    def scene() -> dict:
        if not scenes:
            scenes.append({"name": "scene-1", "actors": [], "fields": [], "grades": []})
        return scenes[-1]

    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--scene":
            i += 1
            if i >= len(argv):
                raise BadInvocation("--scene needs a name")
            scenes.append({"name": argv[i], "actors": [], "fields": [], "grades": []})
            bucket = None
        elif arg == "--actors":
            cur = scene()
            # A second --actors inside a scene that already has fields starts a new scene.
            if cur["fields"]:
                scenes.append({"name": f"scene-{len(scenes) + 1}", "actors": [],
                               "fields": [], "grades": []})
                cur = scenes[-1]
            bucket = cur["actors"]
        elif arg == "--fields":
            bucket = scene()["fields"]
        elif arg == "--json":
            as_json = True
        elif arg in ("--grade", "--render-scale", "--field-scale", "--manifest"):
            i += 1
            if i >= len(argv):
                raise BadInvocation(f"{arg} needs a value")
            if arg == "--grade":
                scene()["grades"] = [int(h.strip().lstrip("#").removeprefix("0x"), 16)
                                     for h in argv[i].split(",")]
            elif arg == "--render-scale":
                render_scale = int(argv[i])
            elif arg == "--field-scale":
                field_scale = int(argv[i])
            else:
                manifest = argv[i]
            bucket = None
        elif arg.startswith("--"):
            raise BadInvocation(f"unknown flag {arg}")
        elif bucket is not None:
            bucket.append(arg)
        else:
            raise BadInvocation("path given before --actors/--fields")
        i += 1
    return scenes, render_scale, field_scale, manifest, as_json


def _run(argv: list[str]) -> int:
    scenes, render_scale, field_scale, manifest, as_json = _parse(argv)
    if not scenes or any(not s["actors"] or not s["fields"] for s in scenes):
        print(__doc__.split("WHY THIS EXISTS")[0].strip(), file=sys.stderr)
        return 2
    for s in scenes:
        n = len(s["fields"])
        if s["grades"] and len(s["grades"]) not in (1, n):
            raise BadInvocation(f"scene {s['name']}: --grade needs 1 hex or {n} "
                                f"(one per field), got {len(s['grades'])}")
        g = s["grades"] or [0xFFFFFF]
        s["grades"] = g * n if len(g) == 1 else g

    recorded = _manifest_exceptions(manifest) if manifest else None
    rows: list[dict] = []
    for s in scenes:
        s["actor"] = actor_reference(s["actors"], render_scale)
        for path, grade in zip(s["fields"], s["grades"]):
            row = field_metrics(path, grade, s["actor"], field_scale)
            row["scene"] = s["name"]
            row["fails"], row["warns"] = judge(row, s["actor"])
            rows.append(row)

    # Cross-asset rail: the set measured against ITSELF, across every scene.
    if len(rows) > 1:
        med = _median([r["busy"] for r in rows])
        for row in rows:
            if med and row["busy"] > med * SET_BUSY_WARN:
                row["warns"].append(
                    f"set-busyness-outlier {row['busy'] / med:.2f}x the set median "
                    f"({med:.2f}) -- one member is off the set's rail"
                )

    for row in rows:
        if recorded is not None and row["warns"]:
            aid = _asset_id(row["file"])
            if not any(fnmatch(aid, pattern) for pattern in recorded):
                row["fails"].append(
                    f"unrecorded-warning: {len(row['warns'])} warn-band finding(s) and no "
                    f"`{aid}` entry with a reason in {manifest}.qcExceptions[] -- write "
                    f"the exception to the manifest FILE, a report line does not count"
                )
        row["passed"] = not row["fails"]

    if as_json:
        print(json.dumps({
            "thresholds": {"clashWarn": CLASH_WARN, "clashFail": CLASH_FAIL,
                           "busyWarn": BUSY_WARN, "busyFail": BUSY_FAIL,
                           "setBusyWarn": SET_BUSY_WARN,
                           "renderScale": render_scale, "fieldScale": field_scale},
            "scenes": [{"name": s["name"], "actorSheets": s["actors"],
                        "actor": s["actor"]} for s in scenes],
            "fields": rows,
        }, indent=2))
        return 0 if all(r["passed"] for r in rows) else 1

    for s in scenes:
        a = s["actor"]
        print(f"[{s['name']}] actors: {a['sheets']} sheet(s), {a['n']} opaque px  "
              f"linear luma p50={a['p50']:.4f} p90={a['p90']:.4f} p99={a['p99']:.4f}  "
              f"busy={a['busy']:.2f} @ renderScale {render_scale}")
        print(f"[{s['name']}] limits: C1 field p99 <= {a['p99'] / 2:.4f} | read boundary "
              f"actor p90 = {a['p90']:.4f} | clash warn>{CLASH_WARN}% fail>{CLASH_FAIL}% "
              f"| busyRatio warn>{BUSY_WARN}x fail>{BUSY_FAIL}x")
    print(" ".join(f"{n:>{w}}" for n, w, _ in COLS) + "    C1")
    for row in rows:
        print(" ".join(f"{row[n]:>{w}{f}}" for n, w, f in COLS)
              + ("  PASS" if row["C1"] else "  fail"))
    if len(rows) > 1:
        def spread(k: str) -> str:
            v = [r[k] for r in rows]
            return f"{min(v):.3f}..{max(v):.3f}"
        print(f"set spread ({len(rows)} fields, {len(scenes)} scene(s)): "
              f"meanL {spread('meanL')}  busy {spread('busy')}  "
              f"clash% {spread('clash%')}  busyRatio {spread('busyRatio')}")
    for row in rows:
        for w in row["warns"]:
            print(f"WARN [{row['scene']}] {row['file']}: {w}")
        for f in row["fails"]:
            print(f"FAIL [{row['scene']}] {row['file']}: {f}")
    return 0 if all(r["passed"] for r in rows) else 1


def main(argv: list[str]) -> int:
    try:
        return _run(argv)
    except BadInvocation as exc:
        print(f"figure-ground: {exc}", file=sys.stderr)
        return 2
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        # A bad path, a bad hex, or a malformed manifest is a broken COMMAND, not
        # broken art. Anything that exits 1 must be a measured figure/ground verdict.
        print(f"figure-ground: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
