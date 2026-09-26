#!/usr/bin/env python3
"""Merge art/v2/<Agent>.groups.json fragments into art/manifest.json (idempotent).

Usage: python3 art/v2/merge-fragments.py ArtWorld ArtEnemies ...
Groups owned by a named agent are replaced wholesale; their qcExceptions are
re-appended to the top-level list tagged with `fragment`.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "manifest.json"


def main(agents):
    manifest = json.loads(MANIFEST.read_text())
    groups = manifest["groups"]
    qc = manifest.setdefault("qcExceptions", [])
    for agent in agents:
        frag = json.loads((ROOT / "v2" / f"{agent}.groups.json").read_text())
        if isinstance(frag, list):
            frag_groups = frag
        elif "groups" in frag:
            frag_groups = frag["groups"]
        else:  # a single group object
            frag_groups = [{k: v for k, v in frag.items() if k not in ("note", "qcExceptions", "missing")}]
        names = {g["group"] for g in frag_groups}
        groups[:] = [g for g in groups if g["group"] not in names]
        groups.extend(frag_groups)
        qc[:] = [q for q in qc if not (isinstance(q, dict) and q.get("fragment") == agent)]
        extra = []
        if isinstance(frag, dict):
            extra.extend(frag.get("qcExceptions", []))
        for g in frag_groups:
            extra.extend(g.pop("qcExceptions", []) or [])
            g.pop("missing", None)
        for q in extra:
            entry = dict(q) if isinstance(q, dict) else {"note": q}
            entry["fragment"] = agent
            qc.append(entry)
        print(f"{agent}: {sorted(names)} (+{len(extra)} qcExceptions)")
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
