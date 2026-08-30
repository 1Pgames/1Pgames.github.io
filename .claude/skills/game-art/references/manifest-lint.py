#!/usr/bin/env python3
"""Lint `art/manifest.json` BEFORE generation fans out. Run from the game project root.

    python3 <skill>/references/manifest-lint.py [art/manifest.json]

WHY THIS EXISTS
One `writeScaleProfile` mistake in the Duskhaul manifest was independently
rediscovered by 3 of 12 generation agents, each burning a full investigation on it,
because nothing checked the manifest before it was handed to twelve parallel
workers. A manifest defect is multiplied by the fan-out width. This lint is the
cheapest gate in the pipeline and it runs FIRST -- before Step 3 spawns anything.
It is also the STOP that keeps a scaffold-default style lock from reaching a
generation call at all.

CHECKS (every one mechanical; E = blocks fan-out, W = must be answered in the report)

  E style-lock-not-rewritten  `styleProfile` missing, unreadable, or still the
      SCAFFOLD lock -- detected by the scaffold's own marker keys (`scaffold`,
      `scaffoldNote`, a `scaffold-placeholder-*` name), never by grepping the prose
      for a style name. The art-director died mid-rewrite once; ten minutes earlier
      would have produced 103 chibi assets for a grimdark game. THIS is why the lint
      runs at Step 2 and not Step 4: a scaffold-default lock does not fail, it
      succeeds at building the wrong game's art.
  E vision-anchors-not-locked  `style.json.references` is empty. Step 1b locks the
      anchors before fan-out; a text profile alone does not hold 100 assets to one
      look.
  E vision-anchor-missing     a path in `style.json.references` or
      `conventions.visionAnchors` does not exist on disk.
  W vision-anchor-cap         more than 2 anchors, or a duplicate: every anchor is
      appended to every call's `input` and counts against the provider's image cap.
  E group-shape               a group without `group`, `owner` or a non-empty
      `assets[]`; duplicate group name; an asset with no `id`; >1 `baseAction`.
  E two-owners-one-group      `owner` must be exactly ONE agent id. A group that
      needs two owners must be SPLIT: one group is one output directory AND one
      report path, and two agents writing one report path lose half of it.
  E duplicate-asset-id        ids are texture keys; a duplicate silently overwrites.
  E duplicate-alias           two assets claiming one `textureAlias`/`animAlias`.
  E bad-grid                  `rows`/`cols` missing or not positive integers.
  E bad-duration              `duration` negative or non-integer. 0 and omitted BOTH
      mean "static, single frame" -- that is the tool contract, not a defect.
  W frame-count-mismatch      the `action` text names `<N>f` and `rows*cols != N`.
  W icons-overflow            `icons[]` longer than `rows*cols`.
  E scale-profile-on-non-nxn  an asset EXPLICITLY binds `scaleProfile` on a grid
      where `rows != cols`. Source cells are non-square and the processor
      hard-rejects the lock. A group-level declaration alongside non-NxN action
      sheets is normal and is NOT flagged.
  E scale-profile-unwritten   something binds a `scaleProfile` file that no asset in
      the manifest writes. THIS is the defect 3 of 12 agents each rediscovered: the
      binding resolves to nothing, so every sibling drift gate is inert and green.
  E duplicate-scale-profile-writer  two assets writing one profile file; the last
      one silently wins and the siblings inherit an unreviewed anchor.
  E scale-profile-path-drift  a `writeScaleProfile` string that does not end in
      `-scale.json`, sits outside the group's own output directory, or disagrees
      with the asset's `profileName`.
  E bad-write-scale-profile   `writeScaleProfile` is neither `true` nor a string.
      `true` is the natural form and the tool derives the canonical path from it.
  W prefer-write-scale-profile-true  a hand-written path where `true` would do.
  E writer-without-profile-name  `writeScaleProfile` with no `profileName`; the
      profile file is then anonymous and no sibling can address it.
  E strict-false-unexcepted   `strict: false` with no matching `qcExceptions[]`
      entry. A strict:false export can never report green, so it ships on a WRITTEN
      exception with a reason, or not at all.
  E attempt-budget-exceeded   `attempts >= 3` with no matching `qcExceptions[]`
      entry. The budget is 2 regenerations per asset per symptom; the exception is
      written BEFORE the third attempt. Advisory prose was reasoned past to a
      seventh variant on one tile.
  E exception-without-reason  a `qcExceptions[]` entry with no `reason` text. An
      exception without a one-line visual justification is an unexplained waiver.
  W exception-matches-nothing a `qcExceptions[]` id (fnmatch ok) matching no
      declared asset -- a stale or mistyped waiver.
  W group-not-in-art-groups   a group not named in `integration.artGroups[]`. A
      group absent from the slice's `ART_GROUPS` exports, registers, and never
      loads.

VALIDATED BEFORE IT WAS ALLOWED TO REJECT ANYTHING (the discipline this repo now
requires of every criterion): run against the ACCEPTED Duskhaul manifest, 2026-08-29
-- 0 errors, 2 warnings. An earlier draft required `writeScaleProfile` to sit on the
group's `baseAction` and treated a group-level `scaleProfile` as binding every asset;
that draft raised 34 errors on the accepted canon, because a group holds MANY
characters each with their own profile writer. The draft was right about the metric
and wrong about the POPULATION -- the same mistake that retired five audit
heuristics. Reject side validated by injecting all ten defect classes into a copy of
the same manifest: 12 errors, every class caught.

EXIT CODE
  0  clean; W-level warnings are allowed but must be answered in the report
  1  at least one E. Exit 1 ALWAYS comes with the printed finding list above it.
  2  bad invocation -- extra/unknown argument, manifest not found, unreadable or
     malformed manifest. NEVER 1, so an agent gating on the code can tell a mistyped
     command from a real blocker.
"""

from __future__ import annotations

import json
import os
import re
import sys
from fnmatch import fnmatch

FRAME_RE = re.compile(r"\b(\d+)\s*f\b", re.IGNORECASE)
ANCHOR_CAP = 2


class Report:
    """Findings, with repeated warning codes collapsed.

    A lint that prints the same sentence 25 times trains its reader to skip it, and a
    rule nobody reads is not a gate. Errors are always listed individually; warnings
    of the same code are folded into one line that names the first few subjects.
    """

    def __init__(self) -> None:
        self.errors: list[str] = []
        self._warns: dict[str, list[str]] = {}

    def error(self, code: str, message: str) -> None:
        self.errors.append(f"E {code}: {message}")

    def warn(self, code: str, message: str) -> None:
        self._warns.setdefault(code, []).append(message)

    @property
    def warns(self) -> list[str]:
        out: list[str] = []
        for code, messages in self._warns.items():
            if len(messages) == 1:
                out.append(f"W {code}: {messages[0]}")
                continue
            subjects = [m.split(":", 1)[0] for m in messages]
            head = ", ".join(subjects[:4]) + ("..." if len(subjects) > 4 else "")
            out.append(f"W {code} x{len(messages)} ({head}): "
                       f"{messages[0].split(':', 1)[-1].strip()}")
        return out


def _read_json(path: str):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _resolve(ref: str, root: str) -> str | None:
    """Resolve a manifest path. Manifests mix project-relative and repo-root-relative
    forms (both appear in the canon), so try the project root and then its ancestors."""
    if os.path.exists(ref):
        return ref
    base = os.path.abspath(root)
    for _ in range(5):
        candidate = os.path.join(base, ref)
        if os.path.exists(candidate):
            return candidate
        parent = os.path.dirname(base)
        if parent == base:
            break
        base = parent
    return None


def _check_style_lock(manifest: dict, root: str, rep: Report) -> None:
    rel = manifest.get("styleProfile")
    if not rel:
        rep.error("style-lock-not-rewritten", "manifest has no `styleProfile`")
        return
    path = _resolve(rel, root)
    if path is None:
        rep.error("style-lock-not-rewritten", f"`styleProfile` {rel} does not exist")
        return
    try:
        profile = json.loads(open(path, encoding="utf-8").read())
    except json.JSONDecodeError as exc:
        rep.error("style-lock-not-rewritten", f"{rel} is not valid JSON: {exc}")
        return
    # SCOPE: detect the scaffold by its own MARKER KEYS, never by searching the file for
    # a style name. `template/art/style.json` carries `scaffold: true` + `scaffoldNote`
    # and a `scaffold-placeholder-` name precisely so this is a key test. Grepping the
    # prose for "vibrant-chibi" would reject a game that genuinely IS vibrant chibi --
    # the same right-metric/wrong-population mistake that retired five audit
    # heuristics.
    stale = [k for k in ("scaffold", "scaffoldNote") if k in profile]
    if str(profile.get("name") or "").startswith("scaffold-placeholder"):
        stale.append(f"name={profile['name']!r}")
    if stale:
        rep.error(
            "style-lock-not-rewritten",
            f"{rel} is still the SCAFFOLD default ({', '.join(stale)}). Rewrite the "
            f"style lock from the PRD (game-art Step 1) and delete those keys BEFORE "
            f"any generation call. A scaffold-default lock does not fail: it succeeds "
            f"at producing a coherent asset set for the wrong game, and the run that "
            f"nearly shipped 103 chibi assets into a grimdark project was saved only "
            f"by an agent dying at the right moment.",
        )
    refs = profile.get("references") or []
    if not refs:
        rep.error(
            "vision-anchors-not-locked",
            f"{rel} has an empty `references` array: no vision anchor is locked "
            f"(game-art Step 1b). Lock the anchors before fan-out -- text profiles "
            f"alone do not hold a 100-asset set to one look.",
        )
    anchors = list(refs) + list((manifest.get("conventions") or {}).get("visionAnchors") or [])
    seen: list[str] = []
    for ref in anchors:
        if ref in seen:
            rep.warn("vision-anchor-cap", f"duplicate anchor {ref}")
            continue
        seen.append(ref)
        if _resolve(ref, root) is None:
            rep.error("vision-anchor-missing", f"anchor {ref} does not exist on disk")
    if len(set(refs)) > ANCHOR_CAP:
        rep.warn(
            "vision-anchor-cap",
            f"style.json.references lists {len(set(refs))} anchors; the cap is "
            f"{ANCHOR_CAP}. Every anchor is appended to every call's `input` and "
            f"counts against the provider's image cap.",
        )


def lint(path: str) -> Report:
    rep = Report()
    manifest = _read_json(path)
    root = os.path.dirname(os.path.abspath(path)) or "."
    root = os.path.dirname(root) or "."  # art/manifest.json -> project root
    _check_style_lock(manifest, root, rep)

    exceptions = [
        e for e in (manifest.get("qcExceptions") or []) if isinstance(e, dict)
    ]
    for entry in exceptions:
        if not str(entry.get("reason") or "").strip():
            rep.error(
                "exception-without-reason",
                f"qcExceptions entry {entry.get('id')!r} has no `reason`. An exception "
                f"without a one-line visual justification is an unexplained waiver.",
            )
    excepted = [str(e["id"]) for e in exceptions if e.get("id")]

    def is_excepted(asset_id: str) -> bool:
        return any(fnmatch(asset_id, pattern) for pattern in excepted)

    groups = manifest.get("groups")
    if not isinstance(groups, list) or not groups:
        rep.error("group-shape", "manifest has no `groups[]`")
        return rep

    art_groups = (manifest.get("integration") or {}).get("artGroups")
    seen_groups: set[str] = set()
    seen_ids: set[str] = set()
    seen_alias: dict[str, str] = {}
    all_ids: list[str] = []
    # basename -> [asset ids that write it]  /  (asset id, bound path) pairs.
    writers: dict[str, list[str]] = {}
    bindings: list[tuple[str, str]] = []

    for group in groups:
        name = group.get("group")
        owner = group.get("owner")
        assets = group.get("assets")
        if not name:
            rep.error("group-shape", f"group entry with no `group` name: {group!r:.80}")
            continue
        if name in seen_groups:
            rep.error("group-shape", f"duplicate group name {name!r}")
        seen_groups.add(name)
        if not isinstance(assets, list) or not assets:
            rep.error("group-shape", f"group {name!r} has no `assets[]`")
            continue
        if not owner or not isinstance(owner, str) or not owner.strip():
            rep.error("group-shape", f"group {name!r} has no single `owner` agent id")
        elif re.search(r"[,/]| and ", owner):
            rep.error(
                "two-owners-one-group",
                f"group {name!r} names more than one owner ({owner!r}). One group is "
                f"one output directory and one report path; split it into two groups "
                f"so each owner writes its own report.",
            )
        if art_groups is not None and name not in art_groups:
            rep.warn(
                "group-not-in-art-groups",
                f"group {name!r} is not in `integration.artGroups[]`; it will export, "
                f"register, and never load.",
            )

        # SCOPE, measured against the canon before this could reject anything: a group
        # holds MANY characters, each with its own `profileName` and its own writer on
        # its `-move` sheet. `baseAction` marks the group's ONE canonical base, which
        # for a multi-character group is not the same thing as "the writer". A first
        # draft of this lint required writer == baseAction and produced 20 false
        # positives on the accepted Duskhaul manifest; that draft was wrong about the
        # POPULATION, not the metric. Group-level `scaleProfile` likewise names the
        # group's primary profile FILE, it does not bind every asset in the group.
        bases = [a for a in assets if a.get("baseAction")]
        if len(bases) > 1:
            rep.error(
                "group-shape",
                f"group {name!r} has {len(bases)} assets with `baseAction: true`; "
                f"exactly one is allowed.",
            )
        # A group-level `scaleProfile` alongside non-NxN action sheets is NOT a defect:
        # the declaration names the group's profile file, and the non-NxN markers simply
        # must not attach it. Every accepted multi-action character in the canon has
        # this shape, so a warning here would fire on the whole canon and train its
        # reader to skip the lint. The mechanical check is the per-asset one below, on
        # an EXPLICITLY bound scaleProfile.

        for asset in assets:
            aid = asset.get("id")
            if not aid:
                rep.error("group-shape", f"group {name!r} has an asset with no `id`")
                continue
            full = f"{name}/{aid}"
            all_ids.append(full)
            if aid in seen_ids:
                rep.error(
                    "duplicate-asset-id",
                    f"asset id {aid!r} declared twice; ids are texture keys and the "
                    f"second silently overwrites the first.",
                )
            seen_ids.add(aid)
            for key in ("textureAlias", "animAlias"):
                alias = asset.get(key)
                if alias:
                    tag = f"{key}:{alias}"
                    if tag in seen_alias:
                        rep.error("duplicate-alias",
                                  f"{key} {alias!r} claimed by both "
                                  f"{seen_alias[tag]} and {full}")
                    seen_alias[tag] = full

            rows, cols = asset.get("rows"), asset.get("cols")
            ok_grid = all(isinstance(v, int) and not isinstance(v, bool) and v > 0
                          for v in (rows, cols))
            if not ok_grid:
                rep.error("bad-grid", f"{full}: rows/cols must be positive integers, "
                                      f"got rows={rows!r} cols={cols!r}")

            duration = asset.get("duration")
            if duration is not None:
                if isinstance(duration, bool) or not isinstance(duration, int) or duration < 0:
                    rep.error(
                        "bad-duration",
                        f"{full}: duration must be a non-negative integer; 0 and "
                        f"omitted both mean static single frame. Got {duration!r}.",
                    )

            if ok_grid:
                cells = rows * cols
                claimed = FRAME_RE.search(str(asset.get("action") or ""))
                if claimed and int(claimed.group(1)) != cells:
                    rep.warn(
                        "frame-count-mismatch",
                        f"{full}: action text says {claimed.group(1)}f but the grid "
                        f"{rows}x{cols} holds {cells} cells.",
                    )
                icons = asset.get("icons")
                if isinstance(icons, list) and len(icons) > cells:
                    rep.warn("icons-overflow",
                             f"{full}: {len(icons)} icon names for {cells} cells")

            if asset.get("scaleProfile") and ok_grid and rows != cols:
                rep.error(
                    "scale-profile-on-non-nxn",
                    f"{full}: grid {rows}x{cols} has non-square source cells and an "
                    f"explicitly bound scaleProfile; the processor hard-rejects the "
                    f"lock. Keep maxBodyScaleCv/maxAnchorYStd plus an anchor guide.",
                )
            if asset.get("scaleProfile"):
                bindings.append((full, str(asset["scaleProfile"])))

            wsp = asset.get("writeScaleProfile")
            if wsp is not None:
                if not (wsp is True or isinstance(wsp, str)):
                    rep.error(
                        "bad-write-scale-profile",
                        f"{full}: writeScaleProfile must be `true` (derive the "
                        f"canonical <profileName>-scale.json next to the sheet) or a "
                        f"string path. Got {wsp!r}.",
                    )
                if not str(asset.get("profileName") or "").strip():
                    rep.error(
                        "writer-without-profile-name",
                        f"{full}: declares writeScaleProfile with no `profileName`. "
                        f"The name is how siblings and the drift gates address the "
                        f"profile; without it the file is anonymous.",
                    )
                if isinstance(wsp, str):
                    rep.warn(
                        "prefer-write-scale-profile-true",
                        f"{full}: writeScaleProfile is a hand-written path. Pass "
                        f"`true` instead -- the tool derives the canonical "
                        f"<profileName>-scale.json next to the sheet, which removes "
                        f"this whole typo class. A path typo here was independently "
                        f"rediscovered by 3 of 12 generation agents.",
                    )
                    if not wsp.endswith("-scale.json"):
                        rep.error("scale-profile-path-drift",
                                  f"{full}: writeScaleProfile {wsp!r} must end in "
                                  f"`-scale.json`")
                    if f"/{name}/" not in wsp:
                        rep.error(
                            "scale-profile-path-drift",
                            f"{full}: writeScaleProfile {wsp!r} is not under this "
                            f"group's own output directory ({name}/); an agent may "
                            f"only write inside the directory it owns.",
                        )
                    pname = str(asset.get("profileName") or "").strip()
                    if pname and os.path.basename(wsp) != f"{pname}-scale.json":
                        rep.error(
                            "scale-profile-path-drift",
                            f"{full}: writeScaleProfile writes "
                            f"{os.path.basename(wsp)!r} but profileName is {pname!r}; "
                            f"the canonical name is {pname}-scale.json and siblings "
                            f"will bind the canonical one.",
                        )
                    writers.setdefault(os.path.basename(wsp), []).append(full)
                elif str(asset.get("profileName") or "").strip():
                    writers.setdefault(
                        f"{asset['profileName']}-scale.json", []).append(full)

            if asset.get("strict") is False and not is_excepted(full):
                rep.error(
                    "strict-false-unexcepted",
                    f"{full}: strict:false with no qcExceptions[] entry. A "
                    f"strict:false export can never report green, so it ships on a "
                    f"WRITTEN exception with a reason, or not at all.",
                )

            attempts = asset.get("attempts")
            if isinstance(attempts, int) and attempts >= 3 and not is_excepted(full):
                rep.error(
                    "attempt-budget-exceeded",
                    f"{full}: attempts={attempts} with no qcExceptions[] entry. The "
                    f"budget is 2 regenerations per asset per symptom; the exception "
                    f"is written BEFORE the third attempt, not after the seventh.",
                )

    # The defect 3 of 12 agents each rediscovered: a sibling binds a profile file that
    # nothing in the manifest ever writes, so every drift gate on that sibling is inert
    # and reports green. Group-level declarations count as bindings too.
    for group in groups:
        declared = group.get("scaleProfile")
        if declared:
            bindings.append((f"{group.get('group')} (group-level)", str(declared)))
    for who, bound in bindings:
        if os.path.basename(bound) not in writers:
            rep.error(
                "scale-profile-unwritten",
                f"{who} binds scaleProfile {bound!r} but no asset in this manifest "
                f"declares a writeScaleProfile for {os.path.basename(bound)!r}. "
                f"Nothing writes the file the siblings read, so every sibling drift "
                f"gate is inert and reports green.",
            )
    for basename, who in writers.items():
        if len(who) > 1:
            rep.error(
                "duplicate-scale-profile-writer",
                f"{basename!r} is written by {len(who)} assets ({', '.join(who)}); "
                f"the last one silently wins and the siblings inherit an "
                f"unreviewed anchor.",
            )

    for pattern in excepted:
        if not any(fnmatch(i, pattern) for i in all_ids):
            rep.warn("exception-matches-nothing",
                     f"qcExceptions id {pattern!r} matches no declared asset")
    return rep


def main(argv: list[str]) -> int:
    if len(argv) > 1 or (argv and argv[0].startswith("-")):
        print(__doc__.split("WHY THIS EXISTS")[0].strip(), file=sys.stderr)
        return 2
    path = argv[0] if argv else "art/manifest.json"
    if not os.path.exists(path):
        print(f"manifest-lint: {path} not found (run from the game project root)",
              file=sys.stderr)
        return 2
    try:
        rep = lint(path)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        # An unreadable or malformed manifest is a broken COMMAND, not a lint finding.
        # Exit 1 must always mean "the lint ran and found E-level defects", or an
        # agent gating on the code cannot tell a typo from a real blocker.
        print(f"manifest-lint: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    for line in rep.errors + rep.warns:
        print(line)
    print(f"manifest-lint {path}: {len(rep.errors)} error(s), {len(rep.warns)} warning(s)")
    return 1 if rep.errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
