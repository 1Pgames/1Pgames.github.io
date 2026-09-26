#!/usr/bin/env python3
"""Single source of truth for the ArtIcons V2 icon slice (PRD-V2 §11 icons rows).

Writes art/v2/ArtIcons.groups.json (manifest `groups[]` entry, same schema as
art/manifest.json, for the integrator to merge) and art/v2/ArtIcons.progress.md
(delivered ids -> texture key + frame + path). An asset is emitted only when its
export exists on disk (sprite-metadata.json with the declared grid), so the
groups file never names art that is not there.

Run from games/2026-08-29-duskhaul/:  python3 art/v2/ArtIcons.build.py
"""
import json
from pathlib import Path

GROUP = "icons-v2"
ROOT = Path("public/assets/generated") / GROUP


def gear(*names: str) -> list[str]:
    return [f"icon-gear-{n}" for n in names]


def ch(*ids: str) -> list[str]:
    return [f"icon-charm-{i}" for i in ids]


def val(*ids: str) -> list[str]:
    return [f"icon-val-{i}" for i in ids]


W1 = ["bolt", "orbit", "nova", "scythe"]
W2 = ["rail", "hex", "skull", "censer"]
W3 = ["sickle", "lash", "breath", "spears"]

# (assetId, rows, cols, cellPx, attempts, icons[], action)
SHEETS = [
    ("icons-wpn-a", 4, 4, 96, 1,
     [f"icon-wpn-{w}" for w in W1] + [f"icon-evo-{w}" for w in W1]
     + [f"icon-wpn-{w}" for w in W2] + [f"icon-evo-{w}" for w in W2],
     "Weapon + evolution item icons (rows: base, evolved, base, evolved), PRD-V2 §5.8 ids"),
    ("icons-wpn-b", 4, 4, 96, 0,
     [f"icon-wpn-{w}" for w in W3] + [f"icon-evo-{w}" for w in W3]
     + ch("c_oath", "c_bell", "c_drum", "c_heart", "c_eye", "c_tongue", "c_lodestone", "c_candle"),
     "Weapons 9-12 + evolutions, charms 1-8 (PRD-V2 §5.8/§5.9)"),
    ("icons-kit", 4, 4, 96, 1,
     ch("c_spur", "c_mail", "c_salve", "c_pouch", "c_step")
     + [f"icon-cb-{c}" for c in ("cb_bread", "cb_flask", "cb_salt", "cb_candle", "cb_oil")]
     + [f"icon-uniq-{u}" for u in ("u_dreadcrown", "u_sorrowplate", "u_gravekey", "u_duskmirror", "u_suneater", "u_rimeheart")],
     "Charms 9-13, belt consumables (§5.27), uniques (§5.15.4) except bellrope/gibbetboots"),
    ("icons-gear-a", 4, 4, 96, 0,
     gear("sackcloth-hood", "gravediggers-cap", "plague-mask", "iron-coif", "mourning-veil",
          "burial-shroud", "rust-brigandine", "pilgrim-cloak", "bone-lamellar", "ash-mantle",
          "gut-wrap-gloves", "iron-gauntlets", "thiefs-grips", "hexbinder-wraps", "butchers-mitts")
     + ["icon-uniq-u_bellrope"],
     "Gear bases hood/shroud/grips (§5.15.2, names kebab-cased) + Bell-Ringer's Rope unique"),
    ("icons-gear-b", 4, 4, 96, 2,
     gear("mud-boots", "grave-treads", "ashwalker-soles", "courier-boots", "iron-sabatons",
          "tin-band", "thornband", "bone-dice-ring", "signet-of-hours", "lodestone-loop",
          "rat-tooth-charm", "ash-locket", "dirge-pipe", "saints-knuckle", "gloam-talisman")
     + ["icon-uniq-u_gibbetboots"],
     "Gear bases boots/ring/amulet (§5.15.2) + Gibbet Boots unique"),
    ("icons-val-a", 4, 4, 96, 1,
     val("v_tallowstub", "v_rustcoin", "v_bonecomb", "v_ashurn", "v_widowring", "v_censerchain",
         "v_psalter", "v_gargoyletooth", "v_carvedskull", "v_silvercup", "v_reliquarybox",
         "v_gildedicon", "v_amberbeetle", "v_frostpearl", "v_bishopsring", "v_giltchalice"),
     "Valuables 1-16 (§5.14)"),
    ("icons-val-b", 3, 3, 96, 0,
     val("v_crownshard", "v_sunmask", "v_rimecrown", "v_saintsbone", "v_duskgem", "v_gravecrown",
         "v_blackcandle", "v_hollowheart") + ["icon-item-unknown"],
     "Valuables 17-24 (§5.14) + unknown-item fallback glyph"),
    ("icons-affix", 3, 3, 32, 0,
     [f"icon-affix-{a}" for a in ("vampiric", "hasted", "shielded", "splitter", "frenzied", "warded", "plagued", "magnetic")]
     + ["icon-elite"],
     "Elite affix badges shown over elites at 28 px (§5.5) + generic elite mark"),
    ("icons-hub", 3, 3, 64, 0,
     [f"icon-tab-{t}" for t in ("expedition", "armory", "vault", "sanctum", "codex")]
     + ["icon-cur-dust", "icon-cur-sigil", "icon-cur-xp", "icon-cur-shard"],
     "Hub tab glyphs (§14.2, drawn at 56 px) + currencies (§5.17, drawn at 64 px)"),
    ("icons-minimap", 4, 4, 24, 0,
     [f"mm-{m}" for m in ("gate", "gate-cond", "chest", "lair", "den", "shrine", "vault", "event", "fence", "boss",
                          "vein", "lore", "bell", "hero", "drop", "key")],
     "Minimap glyphs (§14.10, drawn at 12 px) incl. extra POI kinds vein/lore/bell + hero/drop/key"),
    ("icons-class", 2, 2, 128, 0,
     [f"icon-class-{c}" for c in ("duskhauler", "gravewarden", "ashwitch", "widowblade")],
     "Class portraits (§5.3), hero identity with class start-weapon"),
]
ZONE_KEYS = [(f"zone-key-{z}", 0) for z in ("castle", "outlands", "desert", "winter")]


def delivered(asset: str, rows: int, cols: int) -> bool:
    meta = ROOT / asset / "sprite-metadata.json"
    if not meta.exists():
        return False
    g = json.loads(meta.read_text())["grid"]
    return g["rows"] == rows and g["cols"] == cols


def main() -> None:
    assets, lines, missing = [], [], []
    for asset, rows, cols, cell, attempts, icons, action in SHEETS:
        assert len(icons) == rows * cols, asset
        if not delivered(asset, rows, cols):
            missing += icons
            continue
        assets.append({"id": asset, "kind": "ui", "rows": rows, "cols": cols, "duration": 0,
                       "loop": False, "attempts": attempts, "icons": icons, "action": action,
                       "cellPx": cell, "strict": True})
        path = f"assets/generated/{GROUP}/{asset}/sprite-sheet.png"
        for i, name in enumerate(icons):
            lines.append(f"| `{name}` | `{asset}` | {i} | {cell} | `{path}` |")
    for zid, attempts in ZONE_KEYS:
        if not delivered(zid, 1, 1):
            missing.append(zid)
            continue
        assets.append({"id": zid, "kind": "bg", "rows": 1, "cols": 1, "attempts": attempts, "strict": False,
                       "action": "Zone key art 640x300 for the EXPEDITION zone card (§11 key art)",
                       "textureAlias": "zoneKey" + zid.removeprefix("zone-key-").capitalize()})
        lines.append(f"| `{zid}` | `{zid}` (image) | - | 640x300 | `assets/generated/{GROUP}/{zid}/sprite.png` |")
    exceptions = json.loads(Path("art/v2/ArtIcons.qc.json").read_text()) if Path("art/v2/ArtIcons.qc.json").exists() else []
    out = {"group": GROUP, "owner": "ArtIcons",
           "note": "V2 icons (PRD-V2 §11). Static sheets addressed by frame via ICON.<id>; rarity is drawn by UI frames in code, never in the icon.",
           "assets": assets, "qcExceptions": exceptions, "missing": missing}
    Path("art/v2/ArtIcons.groups.json").write_text(json.dumps(out, indent=2) + "\n")
    md = ["# ArtIcons V2 progress", "",
          "Group `icons-v2` (add to ART_GROUPS). Consumers: `ICON['<id>']` -> `{ key, frame }` after the integrator merges "
          "`art/v2/ArtIcons.groups.json` into `art/manifest.json` and runs `node scripts/gen-art-registry.mjs`. "
          "Until then: texture key = sheet id, frame = index below, spritesheet frameWidth = cell px.", "",
          "| id | texture key | frame | cell px | path (under public/) |", "|---|---|---|---|---|", *lines, "",
          f"Missing (not yet delivered): {', '.join(missing) if missing else 'none'}", ""]
    Path("art/v2/ArtIcons.progress.md").write_text("\n".join(md))
    print(f"assets={len(assets)} icons={len(lines)} missing={len(missing)}")


if __name__ == "__main__":
    main()
