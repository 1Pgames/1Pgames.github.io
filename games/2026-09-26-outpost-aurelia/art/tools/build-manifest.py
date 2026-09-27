#!/usr/bin/env python3
"""Writes art/manifest.json for Outpost Aurelia from the art-director's plan
(art/generation-plan.md) plus every generation group's manifest-delta
(art/briefs/reports/*.md). Edit THIS script, never the JSON.

Run from games/<slug>/:  python3 art/tools/build-manifest.py

Self-contained on purpose: the only thing read back from the previous manifest is
the static `assetSchema` block. Groups are never re-read from the JSON (an earlier
version appended the TEMPLATE-LEGACY note to its own output on every run).

After the groups are declared, `sync_from_disk` makes every asset's grid, frames,
cellSize/cellHeight, duration, loop, strict, fullBleed, componentMode and
postureChange agree with the shipped `sprite-metadata.json`, and fails loudly on a
missing export - the manifest describes what shipped, not what was briefed.
"""
import json
import os
import sys

OLD = json.load(open("art/manifest.json"))
ROOT = "public/assets/generated"


def body(id_, action, rows=2, cols=2, **kw):
    return {"id": id_, "kind": "body", "profile": "hd-body", "rows": rows, "cols": cols, "action": action, **kw}


def static(id_, action, kind="body", profile="hd-body", **kw):
    return {"id": id_, "kind": kind, "profile": profile, "rows": 1, "cols": 1, "action": action, "duration": 0, **kw}


def icon_sheet(id_, names, rows=3, cols=3, action=None):
    return {"id": id_, "kind": "ui", "profile": "hd-fx", "rows": rows, "cols": cols, "duration": 0,
            "action": action or f"icon sheet: {', '.join(names)}", "icons": names}


def full_bleed(id_, action, **kw):
    return {"id": id_, "kind": "bg", "profile": "hd-fx", "rows": 1, "cols": 1, "duration": 0, "action": action, **kw}


# ---- buildings: Mk I + Mk III generated, Mk II = Mk I sheet + runtime rank pips (plan cut) ----
WORK = {  # production types: 2x2 4f work loop, frame 0 doubles as idle
    "drill": "piston rig hammering ore", "borer": "heated screw boring ice",
    "harvester": "singing saws cutting crystal", "venttap": "turbine capping a vent",
    "sail": "gold foil petals tracking the sun", "farm": "green trays under amber lamps",
    "smelter": "crucible glowing ember orange", "cutter": "water-jets grinding crystal",
    "foundry": "clean-room dome sealing cells"}
STATIC = {"bank": "racked charge cells", "relay": "lamp-mast relay pylon", "silo": "ribbed cargo tanks",
          "hab": "pressurised dome with warm windows", "commons": "mess hall under one lamp",
          "pulse": "twin-barrel amber emitter turret", "arc": "copper lightning coil",
          "flak": "stubby glass-shrapnel mortar", "wall": "riveted hull plate barricade"}
GROUP_OF = {"drill": "a", "borer": "a", "harvester": "a", "venttap": "a", "sail": "a", "bank": "a",
            "farm": "b", "smelter": "b", "cutter": "b", "foundry": "b", "relay": "b", "silo": "b",
            "hab": "b", "commons": "b", "pulse": "c", "arc": "c", "flak": "c", "wall": "c"}
bld = {"a": [static("bld-core", "Lander Core 3x3 landed dome hub (ANCHOR, accepted)")],
       "b": [], "c": []}
for kind, desc in {**WORK, **STATIC}.items():
    for mk in (1, 3):
        id_ = f"bld-{kind}-mk{mk}"
        if kind in WORK:
            bld[GROUP_OF[kind]].append(body(id_, f"4f work loop, Mk {'I' if mk == 1 else 'III'}: {desc}", duration=120))
        else:
            bld[GROUP_OF[kind]].append(static(id_, f"Mk {'I' if mk == 1 else 'III'} idle: {desc}"))
bld["c"] += [static("bld-beacon", "Beacon Spire 3x3 needle of prisms, idle"),
             body("bld-beacon-charging", "4f charging loop: prism needle pulsing amber light", duration=150)]

APEX = ["hab", "pulse", "wall", "smelter", "relay", "venttap", "bank", "sail", "arc", "flak",
        "cutter", "foundry", "harvester", "commons", "beacon", "silo"]
apex = [static(f"bld-{k}-apex", f"Mk IV protocol apex variant of {k}") for k in APEX]
apex.append(static("badge-silent", "silent-extractor badge glyph", kind="ui", profile="hd-fx"))

states = []
for s in (1, 2, 3):
    states += [static(f"state-scaffold-{s}x{s}", f"construction scaffold over a {s}x{s} footprint"),
               static(f"state-ruin-{s}x{s}", f"ruin ghost rubble of a {s}x{s} building"),
               static(f"state-frost-{s}x{s}", f"frost crust overlay for a {s}x{s} building", kind="fx", profile="hd-fx")]
states.append({"id": "state-cracks", "kind": "fx", "profile": "hd-fx", "rows": 2, "cols": 2, "duration": 0,
               "action": "damage crack decals x3 (4th cell spare)",
               "icons": ["crack-a", "crack-b", "crack-c"]})

# Deposits, relics, blockers and props were all exported hd-fx (centred fit, componentMode all):
# kind "fx" describes what shipped (terrain + world-props manifest-deltas, deposits report §Method).
deposits = [{"id": f"dep-{k}", "kind": "fx", "profile": "hd-fx", "rows": 2, "cols": 2, "duration": 0,
             "action": f"{k} deposit patch 2x2: impure, normal, pure, depleted",
             "icons": [f"dep-{k}-0", f"dep-{k}-1", f"dep-{k}-2", f"dep-{k}-x"]}
            for k in ("ore", "ice", "crystal", "vent")]
relics = [{"id": "relics", "kind": "fx", "profile": "hd-fx", "rows": 2, "cols": 2, "duration": 0,
           "action": "relic sites: probe wreck, chorus stone, signal buoy, hollow geode",
           "icons": ["relic-probe", "relic-monolith", "relic-buoy", "relic-geode"]}]

BIOMES = ["steppe", "rime", "ember", "nacre"]
terrain = []
for b in BIOMES:
    for v in "abc":
        terrain.append(full_bleed(f"{b}-floor-{v}", f"{b} seamless floor tile variant {v}, full-bleed, L* 18-32"))
    terrain.append({"id": f"{b}-blockers", "kind": "fx", "profile": "hd-fx", "rows": 3, "cols": 3, "duration": 0,
                    "action": f"{b} cliff/rock blockers x6 (+3 spare cells)",
                    "icons": [f"{b}-block-{i}" for i in range(1, 10)]})

props = [{"id": f"props-shared-{i}", "kind": "fx", "profile": "hd-fx", "rows": 3, "cols": 3, "duration": 0,
          "action": "9 single shared props (crash debris, bones, boulders)",
          "icons": [f"prop-shared-{i * 9 + j + 1}" for j in range(9)]} for i in range(2)]
for b in BIOMES:
    props += [{"id": f"props-{b}-{i}", "kind": "fx", "profile": "hd-fx", "rows": 3, "cols": 3, "duration": 0,
               "action": f"9 single {b} props (crystal clumps, alien flora, boulders)",
               "icons": [f"prop-{b}-{i * 9 + j + 1}" for j in range(9)]} for i in range(3)]

FAUNA_A = ["skitter", "spitter", "brute", "moth", "grub"]
FAUNA_B = ["leech", "bloat", "howler", "matron", "titan"]


def fauna(group, names):
    out = []
    for n in names:
        prof = f"public/assets/generated/{group}/fauna-{n}-walk/fauna-{n}-scale.json"
        out.append(body(f"fauna-{n}-walk", f"4f walk cycle of the {n}", key=f"fauna-{n}", duration=90, loop=True,
                        writeScaleProfile=True, profileName=f"fauna-{n}"))
        out.append(body(f"fauna-{n}-attack", f"4f attack of the {n}", loop=False, duration=100, scaleProfile=prof))
    if "matron" in names:
        out.append(body("fauna-matron-brood", "4f brood spawn of the matron", loop=False, duration=120,
                        scaleProfile=f"public/assets/generated/{group}/fauna-matron-walk/fauna-matron-scale.json"))
    if "titan" in names:
        out.append(body("fauna-titan-stomp", "4f stomp of the titan", loop=False, duration=120, postureChange=True,
                        scaleProfile=f"public/assets/generated/{group}/fauna-titan-walk/fauna-titan-scale.json"))
    return out


motion = [body("drone", "4f amber delivery drone hover loop", duration=90, loop=True),
          body("lander-shuttle", "4f lander shuttle descent/thrust loop", duration=120, loop=True),
          static("ark-silhouette", "Orbital Ark ship silhouette crossing the sky", kind="bg", profile="hd-fx")]

FX = [("fx-pulse-bolt", "amber pulse bolt projectile and muzzle flash, 4 frames"), ("fx-arc", "chain lightning arc segment"),
      ("fx-flak", "flak shell and glass-shrapnel burst"), ("fx-acid", "acid glob projectile + splash"),
      ("fx-leech-sparks", "leech latch sparks"), ("fx-bloat-burst", "spore bloat burst"),
      ("fx-frost-creep", "frost creep edge"), ("fx-beacon-beam", "beacon beam column"),
      ("fx-launch-flare", "beacon launch flare"), ("fx-dusk-arrow", "dusk edge arrow"),
      ("fx-build-dust", "build dust puff"), ("fx-upgrade-shine", "upgrade shine sweep"),
      ("fx-relic-burst", "relic claim burst")]
FX_LOOP = {"fx-leech-sparks", "fx-dusk-arrow", "fx-beacon-beam"}  # colony-motion-fx delta
fx = [{"id": i, "kind": "fx", "profile": "hd-fx", "rows": 2, "cols": 2, "action": a, "loop": i in FX_LOOP,
       "duration": 80} for i, a in FX]

icons_a = [icon_sheet("icons-goods-a", ["ferrite", "ice", "aurelite", "alloy"], 2, 2,
                      "goods icons (ANCHOR, accepted): ferrite, ice, aurelite, alloy"),
           icon_sheet("icons-goods-b", ["rations", "prism", "cell", "power", "colonists", "morale",
                                        "temperature", "data", "reroll"]),
           icon_sheet("icons-tags", ["tag-hearth", "tag-forge", "tag-bul", "tag-fr", "tag-kin", "tag-orb",
                                     "alert-relay-dark", "alert-hab-cold", "alert-leech"]),
           icon_sheet("icons-alerts", ["alert-order-ready", "alert-idle-crew", "alert-starving",
                                       "alert-core-hit", "alert-alpha", "kit-engineer", "kit-warden",
                                       "kit-settler", "kit-surveyor"]),
           # icons-a delta: spare cells 7/8 named so nothing on the sheet is dead.
           icon_sheet("icons-ark", ["kit-tinker", "ark-hab", "ark-forge", "ark-grid", "ark-bul", "ark-sur",
                                    "ark-cmd", "ark-ship", "ark-locked"]),
           icon_sheet("icons-bld-1", ["ico-core", "ico-drill", "ico-borer", "ico-harvester", "ico-venttap",
                                      "ico-sail", "ico-bank", "ico-farm", "ico-smelter"]),
           icon_sheet("icons-bld-2", ["ico-cutter", "ico-foundry", "ico-relay", "ico-silo", "ico-hab",
                                      "ico-commons", "ico-pulse", "ico-arc", "ico-flak"]),
           # icons-a delta: spare cells 2/3 = upgrade chevron, demolish hammer.
           icon_sheet("icons-bld-3", ["ico-wall", "ico-beacon", "ico-upgrade", "ico-demolish"], 2, 2)]
DIRECTIVES = ("hearth_insulate hearth_overdrive hearth_battery hearth_vents hearth_sunward hearth_dimming "
              "forge_quota forge_parts forge_assay forge_pour forge_lens forge_cell bul_plate bul_pulse bul_arc "
              "bul_flak bul_mend bul_salvage fr_relay fr_survey fr_prefab fr_muffle fr_sentry fr_claim kin_hatch "
              "kin_lean kin_songs kin_medics kin_rota kin_pact orb_manifest orb_pods orb_resonant orb_band "
              "orb_decoy orb_window").split()
PROTOCOLS = ("p_warren p_lattice p_bastion p_crucible p_halo p_plaza p_magma p_vault p_aurora p_storm p_sky "
             "p_living p_slag p_focus p_lumen p_silent p_geode p_infirm p_choir p_exchange").split()
icons_b = [icon_sheet(f"icons-dir-{i + 1}", [f"dir-{d}" for d in DIRECTIVES[i * 9:(i + 1) * 9]]) for i in range(4)]
icons_b += [icon_sheet(f"icons-proto-{i + 1}", [f"proto-{p}" for p in PROTOCOLS[i * 9:(i + 1) * 9]]) for i in range(3)]
icons_b[-1]["note"] = ("frames 2-8 are spare takes of the 3x3 grid (an empty cell is a non-waivable QC failure), "
                       "not in icons[]; frame 3 carries a '$' glyph and must never be wired")

hub = [full_bleed("hub-planet-map", "Aurelia planet saga map 720x900, full-bleed portrait")]
hub += [full_bleed(f"postcard-{s}", f"site postcard 600x360 of {s}, full-bleed landscape")
        for s in ("halcyon", "prism_reach", "rimewater", "cinder_fen", "frostcrown", "sulfur_hollow",
                  "nacre_shelf", "aurora_rift")]

# ---- template groups src still reads by alias: regenerated in this style, ids/icon order unchanged ----
ui = [icon_sheet("icons", ["heart", "star", "coin", "bolt"], 2, 2,
                 "icon set: rust enamel heart, brass star, brass Data token, amber lightning"),
      icon_sheet("icons-b", ["shield", "skull", "clock", "levelUp"], 2, 2,
                 "icon set: riveted shield, glass-chitin skull, brass stopwatch, double amber chevron")]
bg = [full_bleed("arena", "dusk-violet Aurelia sky backdrop, full-bleed 720x1280, strict with fullBleed",
                 key="bg-arena", textureAlias="backdrop"),
      static("logo", "title wordmark OUTPOST AURELIA (two stacked lines, retro NASA caps) over a small dome emblem, "
                     "on magenta, 512 cell", kind="ui", profile="hd-fx", textureAlias="logo")]

GROUPS = [
    ("ui", "ArtIconsA", ui, "Template ICON names src reads (heart/star/coin/bolt, shield/skull/clock/levelUp), "
                            "regenerated in the aurelia-retro-nasa style, same ids and cell order."),
    ("bg", "ArtHubBg", bg, "arena = dusk Aurelia sky backdrop, full-bleed 720x1280 (9:16), strict + fullBleed; "
                           "logo = OUTPOST AURELIA wordmark (stacked) over a dome emblem, 512 cell, re-keyed."),
    ("buildings-a", "ArtBuildingsA", bld["a"], "Extract + power buildings. hd-body, marker \"scale\":\"fit\", fit 0.9, align bottom, "
                                               "cellSize 256 (core 384). Mk II cut: Mk I sheet + runtime rank pips. Chroma guard off after export (rekey)."),
    ("buildings-b", "ArtBuildingsB", bld["b"], "Process, logistics and housing buildings. Same conventions as buildings-a."),
    ("buildings-c", "ArtBuildingsC", bld["c"], "Defense buildings + Beacon Spire. hd-body, marker \"scale\":\"fit\" (NOT scaleMode), fit 0.9, "
                                               "align bottom, cellSize 256; beacon + beacon-charging 384; walls fit 0.97 so segments butt side by side. "
                                               "Chroma guard off after export (rekey / process_raw)."),
    ("apex", "ArtApex", apex, "Mk IV protocol variants. Image 1 = single-frame Mk III crop flattened on #FF00FF (or text-only when "
                              "Image 1 was copied), Image 2 = vision anchor. hd-body, marker \"scale\":\"fit\", fit 0.9 (wall 0.97), "
                              "align bottom, cellSize 256 (beacon 384), threshold 150, chroma guard off. badge-silent: hd-fx centred 256."),
    ("building-states", "ArtStates", states, "Selection ring is NOT generated: core/textures reticle (Graphics). scaffold/ruin: hd-body, "
                                             "frost: hd-fx; all \"scale\":\"fit\", fit 0.9, align bottom, componentMode all, 256 cells (3x3: 384). "
                                             "cracks: hd-fx 2x2 256 centre fit 0.86, frames 0-2 = crack-a/b/c, frame 3 spare. Frost is drawn over "
                                             "the dark building at alpha 0.6 (reviewed value)."),
    ("deposits", "ArtWorld", deposits, "2x2 patches, hd-fx centred fit 0.9, one shared sheet scale; frame index = purity "
                                       "(0 impure, 1 normal, 2 pure, 3 depleted)."),
    ("relics", "ArtWorld", relics, "4 relic sites, one per cell, hd-fx centred."),
    ("terrain", "ArtTerrain", terrain, "Full-bleed floor tiles (fullBleed + threshold 1 + edgeThreshold 1, xai frame stripped by "
                                       "deframe_bbox.py), L* 18-32. Blockers: hd-fx centred 3x3 sheets, frames 0-5 required, 6-8 spare."),
    ("world-props", "ArtProps", props, "112-kind budget as 3x3 hd-fx atlas sheets of single props (18 shared + 27 per biome), centred fit 0.86."),
    ("fauna-a", "ArtFaunaA", fauna("fauna-a", FAUNA_A), "Walk = base (writeScaleProfile), attack binds it. Refit fit 0.86 align bottom "
                                                        "(spitter 0.72, moth centre). Death sheets cut: chitin-shard burst + corpse fade."),
    ("fauna-b", "ArtFaunaB", fauna("fauna-b", FAUNA_B), "Same as fauna-a (hd-body feet preserve); matron + titan on 512 cells, brood and "
                                                        "stomp bind their walk profiles."),
    ("colony-motion", "ArtMotionFx", motion, "Drone, lander shuttle (centred fit 0.9), Ark silhouette (hd-fx 512)."),
    ("fx", "ArtMotionFx", fx, "hd-fx 2x2 sheets, drawn with BlendModes.ADD. Field-edge glow and brownout flicker are runtime "
                              "Graphics/tweens (core/textures), not generated."),
    ("icons-a", "ArtIconsA", icons_a, "96px UI glyphs on 256 cells; goods, tags, alerts, kits, Ark branches, buildings."),
    ("icons-b", "ArtIconsB", icons_b, "Directive (36) and protocol (20) glyphs; tag frame drawn by ui primitives."),
    ("hub", "ArtHubBg", hub, "Full-bleed hub art; planet map portrait 720x900, postcards 600x360. Generated marker-less and processed "
                             "by art/exports/hub/fitcrop.py (process-sprite --full-bleed --strict). Site-node centres: art/briefs/reports/hub.md."),
]

# ---- attempts: anchors (art/anchors/QC.md) + every report's manifest-delta, as reported ----
ANCHORS = {"bld-core": 1, "bld-drill-mk1": 2, "bld-pulse-mk1": 1, "fauna-skitter-walk": 1,
           "icons-goods-a": 1, "steppe-floor-a": 1}
ATTEMPTS = {
    # buildings-a
    "bld-drill-mk3": 2, "bld-borer-mk1": 1, "bld-borer-mk3": 1, "bld-harvester-mk1": 1, "bld-harvester-mk3": 3,
    "bld-venttap-mk1": 2, "bld-venttap-mk3": 1, "bld-sail-mk1": 1, "bld-sail-mk3": 2, "bld-bank-mk1": 1, "bld-bank-mk3": 1,
    # buildings-b
    "bld-farm-mk1": 2, "bld-farm-mk3": 1, "bld-smelter-mk1": 2, "bld-smelter-mk3": 3, "bld-cutter-mk1": 1,
    "bld-cutter-mk3": 3, "bld-foundry-mk1": 1, "bld-foundry-mk3": 3, "bld-relay-mk1": 2, "bld-relay-mk3": 1,
    "bld-silo-mk1": 1, "bld-silo-mk3": 1, "bld-hab-mk1": 1, "bld-hab-mk3": 1, "bld-commons-mk1": 2, "bld-commons-mk3": 2,
    # buildings-c
    "bld-pulse-mk3": 2, "bld-arc-mk1": 1, "bld-arc-mk3": 2, "bld-flak-mk1": 1, "bld-flak-mk3": 1,
    "bld-wall-mk1": 1, "bld-wall-mk3": 1, "bld-beacon": 1, "bld-beacon-charging": 2,
    # apex
    "bld-hab-apex": 2, "bld-pulse-apex": 3, "bld-wall-apex": 1, "bld-smelter-apex": 1, "bld-relay-apex": 2,
    "bld-venttap-apex": 1, "bld-bank-apex": 1, "bld-sail-apex": 2, "bld-arc-apex": 2, "bld-flak-apex": 2,
    "bld-cutter-apex": 2, "bld-foundry-apex": 2, "bld-harvester-apex": 2, "bld-commons-apex": 1,
    "bld-beacon-apex": 2, "bld-silo-apex": 1, "badge-silent": 1,
    # building-states
    "state-scaffold-1x1": 2, "state-scaffold-2x2": 3, "state-scaffold-3x3": 1, "state-ruin-1x1": 1,
    "state-ruin-2x2": 1, "state-ruin-3x3": 1, "state-frost-1x1": 2, "state-frost-2x2": 2, "state-frost-3x3": 1,
    "state-cracks": 2,
    # deposits / relics
    "dep-vent": 2,
    # terrain
    "steppe-floor-b": 0, "steppe-floor-c": 0, "rime-floor-a": 1, "rime-floor-b": 0, "rime-floor-c": 0,
    "ember-floor-a": 0, "ember-floor-b": 0, "ember-floor-c": 2, "nacre-floor-a": 0, "nacre-floor-b": 1,
    "nacre-floor-c": 1, "steppe-blockers": 0, "rime-blockers": 0, "ember-blockers": 1, "nacre-blockers": 0,
    # world-props
    "props-shared-0": 0, "props-shared-1": 0, "props-steppe-0": 0, "props-steppe-1": 0, "props-steppe-2": 0,
    "props-rime-0": 0, "props-rime-1": 0, "props-rime-2": 0, "props-ember-0": 3, "props-ember-1": 2,
    "props-ember-2": 2, "props-nacre-0": 0, "props-nacre-1": 0, "props-nacre-2": 0,
    # fauna-a
    "fauna-skitter-attack": 2, "fauna-spitter-walk": 0, "fauna-spitter-attack": 3, "fauna-brute-walk": 1,
    "fauna-brute-attack": 1, "fauna-moth-walk": 0, "fauna-moth-attack": 1, "fauna-grub-walk": 0, "fauna-grub-attack": 1,
    # fauna-b
    "fauna-leech-walk": 1, "fauna-leech-attack": 2, "fauna-bloat-walk": 1, "fauna-bloat-attack": 1,
    "fauna-howler-walk": 1, "fauna-howler-attack": 3, "fauna-matron-walk": 3, "fauna-matron-attack": 1,
    "fauna-matron-brood": 2, "fauna-titan-walk": 2, "fauna-titan-attack": 2, "fauna-titan-stomp": 2,
    # colony-motion + fx
    "drone": 1, "lander-shuttle": 1, "ark-silhouette": 1, "fx-pulse-bolt": 2, "fx-arc": 3, "fx-flak": 3,
    "fx-acid": 1, "fx-leech-sparks": 3, "fx-bloat-burst": 1, "fx-frost-creep": 2, "fx-beacon-beam": 2,
    "fx-launch-flare": 3, "fx-dusk-arrow": 1, "fx-build-dust": 1, "fx-upgrade-shine": 3, "fx-relic-burst": 2,
    # icons-a + ui (regenerations)
    "icons-goods-b": 2, "icons-tags": 1, "icons-alerts": 1, "icons-ark": 1, "icons-bld-1": 0, "icons-bld-2": 0,
    "icons-bld-3": 0, "icons": 0, "icons-b": 0,
    # icons-b
    "icons-dir-1": 2, "icons-dir-2": 2, "icons-dir-3": 1, "icons-dir-4": 3, "icons-proto-1": 2,
    "icons-proto-2": 1, "icons-proto-3": 1,
    # hub + bg
    "hub-planet-map": 4, "postcard-halcyon": 2, "postcard-prism_reach": 2, "postcard-rimewater": 2,
    "postcard-cinder_fen": 1, "postcard-frostcrown": 1, "postcard-sulfur_hollow": 1, "postcard-nacre_shelf": 1,
    "postcard-aurora_rift": 1, "arena": 2, "logo": 1,
}

# ---- qcExceptions: every entry the reports list, ids as `<group>/<id>` (both gates fnmatch that form) ----
EXCEPTIONS = [
    # buildings-a/b
    ("buildings-a/bld-harvester-mk3", "Budget spent (3 generations): frame 0 tread pods are cream while frames 1-3 are steel, and 2 saws instead of the briefed 3; hull, turret, hopper and saws read as one upgraded harvester at 128 px."),
    ("buildings-b/bld-smelter-mk3", "pour frame (f2) shows the plain Mk I crucible tipping for 120 ms; the other 3 frames and the hood/chimney/cradle read Mk III, a3 that fixed it touched the image border"),
    ("buildings-b/bld-cutter-mk3", "sheet re-tiled from a3's two Mk III cells [idle,spray,spray,idle]; the upper glass tier shows only in spray frames (reads as a raised hood), bodyScaleCv 0.118"),
    ("buildings-b/bld-foundry-mk3", "provider copied the Mk I sheet on 3/3 attempts; Mk III is visually identical to Mk I and relies on the runtime rank pips"),
    # apex
    ("apex/bld-pulse-apex", "3rd attempt on a new symptom: a1 near-copied the Mk III, a2 dropped the four emitter barrels; a3 keeps egg + 4 barrels with brass bands, fins and sensor mast"),
    ("apex/bld-wall-apex", "art_review own-pair occupancy 0.048 vs Mk III: plate outline is locked by side-by-side tiling; apex reads by brass crest spikes + lamp strip"),
    ("apex/bld-venttap-apex", "art_review own-pair occupancy 0.044 vs Mk III: same drum footprint, but grey steel became cream/brass cladding over a glowing magma ring"),
    ("apex/bld-foundry-apex", "art_review own-pair occupancy 0.049 vs Mk III: kept tower identity (a2 gate redesign lost it); apex reads by twin amber-lamp brass spires + radiator fins"),
    # building-states
    ("building-states/state-scaffold-2x2", "Third generation: a1/a2 copied the 1x1 cage proportions from explicit Image 1; a3 went text-only with the vision anchor and is a wide 2-bay site sharing slab, stripes, tubes and lamps with its siblings."),
    ("building-states/state-frost-2x2", "meanDistance 53.68 > 52 because the palette list has no pale ice blue (siblings 47.31/43.58 pass); the on-list desaturated reroll (27.61) read as cream, not frost, over buildings at alpha 0.6."),
    # deposits
    ("deposits/dep-*", "art_review silhouette-collision (ore/ice 0.041, ore/vent 0.046) is by contract: all deposit kinds share the flat 2x2 extractor-footprint patch; kinds read apart by hue/material/value (rust plates, frost-blue ice, gold teeth, dark basalt with amber cracks)."),
    # terrain
    ("terrain/steppe-blockers", "art_review per-cell silhouette block-1 vs block-7 0.041 at 64px: both tall pillars, block-7 is a spare and differs by its violet glass crown"),
    ("terrain/rime-blockers", "art_review per-cell silhouette block-4 vs block-8 0.025 at 64px: round vs split boulder, block-8 is a spare and reads distinct by its blue ice seam; meanDistance 41.24 from the frost-blue ice the palette list covers with one hex"),
    ("terrain/nacre-blockers", "art_review per-cell silhouette block-3 vs block-4 0.049 at 64px: fan shell vs pearl sphere, distinct by the scalloped fan rim at 128px"),
    # world-props
    ("world-props/props-ember-0", "3 regenerations for 3 different symptoms (drawn cell dividers, rust-red vent, flat round lumps); final cell 7 rope slag coil value spread 0.322 < 0.35 is charcoal slag by material, inked and readable on the mud floor"),
    ("world-props/props-ember-*", "per-cell silhouette 0.035 shared-1#0 standing stone vs ember-2#7 basalt column and 0.045 ember-0#2 vent vs ember-0#8 mud cone at 64px: grey stone vs black hex basalt, hollow chimney vs cracked cone read apart at 80px"),
    ("world-props/props-steppe-*", "per-cell silhouette 0.015-0.048 at 64px (shared boulder vs coiled fossil, standing stone vs spire plant, crate/boulder vs succulent, cairn vs pyramid rock): same compact mass, distinct by violet/ochre hue and interior at 80px"),
    ("world-props/props-rime-*", "per-cell silhouette 0.021-0.049 at 64px (split slab vs stepped stone, icicle shrub vs rime bulb, ice block vs crate/boulder): distinct by blue ice vs dark slate material at 80px"),
    ("world-props/props-nacre-*", "per-cell silhouette 0.031-0.049 at 64px (wheel vs urchin, standing stone vs nacre shard, conch/scallop vs urchin, spool vs sea-rock): pearl shells vs grey debris read apart by value and ribbing at 80px"),
    # fauna-a
    ("fauna-a/fauna-spitter-attack", "3 regens (copy, salmon bg + facing flip, dividers + front view), each a different symptom within the per-symptom budget; the accepted 4th call is a clean right-facing lob; acid droplet dropped by componentMode largest (projectile is fx)"),
    ("fauna-a/fauna-skitter-attack", "bite reads as a small forward lean with mandibles reaching (low pose amplitude); budget spent on a reference copy and divider lines; seams painted to key before processing (refit.py --deseam)"),
    ("fauna-a/fauna-grub-attack", "body tan is a step lighter than the walk's ochre-brown; segment layout, blind toothed maw and facing match"),
    # fauna-b
    ("fauna-b/fauna-leech-attack", "meanDistance 53.61 vs max 52: the leech's identity hue is saturated grey-teal (PRD #5f8f8a family) that the 18-colour list lacks; walk sheet of the same creature measures 36.32; the regen (a2) drew ghost reflections and was rejected."),
    ("fauna-b/fauna-howler-attack", "strict:false, waived profile-body-scale-drift 0.138: xai draws the howler 14% under its walk and ignored the howl pose in 3 takes (a2 drifted to an ivory body, a3 had cell dividers + contamination); a1 kept for exact identity, the rally reads from the runtime aura."),
    ("fauna-b/fauna-matron-walk", "attempts 3 on different symptoms: a1 faced left + guard edge-touch, a2 faced left + welded contact ellipse; a3 faces right, no shadow, strict pass."),
    ("fauna-b/fauna-matron-brood", "strict:false, waived profile-body-scale-drift 0.143: 2 of 2 brood takes render the matron ~14% under her walk (xai sibling size prior); crown, sac and hatching babies are correct."),
    # fx
    ("fx/fx-arc", "thin 1-2px filament frames 0/3 cover 0.24% < preflight 0.5% floor; background measured clean (edgeKeyFraction 1.0, 0 foreign regions); exported --no-preflight with all other strict gates passing; 3 gens"),
    ("fx/fx-flak", "3 gens (dividers; shell reappeared in burst); accepted take is shell-free burst whose frame 0 glowing orb serves as the in-flight shell"),
    ("fx/fx-leech-sparks", "3 gens (dividers; drew the leech creature); accepted take is a clean teal spark ring"),
    ("fx/fx-launch-flare", "3 gens; accepted take 1: frame 3 carries a pink-violet cast baked from the key blend; later takes had uneven key / drew brass badges"),
    ("fx/fx-upgrade-shine", "3 gens (take 1 redrew the vision-anchor scene, take 2 a brass rod); accepted glint take has a faint pink cast on the frame-1 streak"),
    # icons
    ("icons-a/icons-goods-b", "3 generations over 2 distinct symptoms (drawn cell numbers; violet prism keyed to holes); third take visually clean, prism redrawn as clear glass"),
    ("icons-a/icons-ark", "raw composed from whole cells of 2 generations (compose_cells.py): gen1 badges + gen2 tinker crate/ship/padlock, 1:1 pixels, provenance in sprite-metadata.json.composite"),
    ("icons-b/icons-dir-4", "3 generations, each for a DIFFERENT symptom (raspberry key with violet waves inside the key band; the word FREIGHT on the clipboard); the 3rd take is clean, text-free and strict-pass."),
    # hub (bg/arena exception dropped: the regenerated backdrop exports strict with fullBleed - bg report)
    ("hub/hub-planet-map", "4 generations over 3 distinct symptoms (baked UI discs, island-on-pink from marker injection, parchment edge + pins); accepted take keeps faint route hairlines and ~6 px pin dots in the ice band, negligible under the 0.35 scrim and covered where the 96 px site nodes sit"),
]

# ---- conventions (fx/ui cells are 256 in this game; the template's 128 fx cell is gone) ----
CONVENTIONS = {
    "bodyCellSize": 256, "fxCellSize": 256, "uiCellSize": 256, "bodyProfile": "hd-body", "fxProfile": "hd-fx",
    "canvas": {"image_size": "1024x1024", "aspect_ratio": "1:1"},
    "note": "Measured rule: on a square canvas only NxN grids (1x1, 2x2, 3x3, 4x4) have square cells. Every sheet in "
            "this game is NxN. cellSize/cellHeight/duration per asset are synced from sprite-metadata.json by "
            "art/tools/build-manifest.py.",
    "keying": "xai returns the key as pink (~252,61,175). Markers pass threshold 150; after export run "
              "art/tools/rekey.py (chroma guard off) - see art/generation-plan.md.",
    "buildingProfile": "hd-body + marker \"scale\":\"fit\" (NOT scaleMode) + fit 0.9 + align bottom (shared sheet scale)",
    "kind": "body = hd-body export (feet/bottom anchored); fx = hd-fx export (centred fit, all components); "
            "ui = icon/emblem glyph sheet; bg = full-bleed (fullBleed:true).",
}


def sync_from_disk(group, asset):
    """Rewrites geometry/timing/QC-mode fields from the shipped sprite-metadata.json."""
    path = os.path.join(ROOT, group, asset["id"], "sprite-metadata.json")
    if not os.path.exists(path):
        sys.exit(f"build-manifest: missing export {path}")
    meta = json.load(open(path))
    out, qc = meta["output"], meta["qc"]
    asset["rows"], asset["cols"] = meta["grid"]["rows"], meta["grid"]["cols"]
    frames = asset["rows"] * asset["cols"]
    asset["frames"] = frames
    asset["cellSize"] = out["cellSize"]
    if out.get("cellHeight", out["cellSize"]) != out["cellSize"]:
        asset["cellHeight"] = out["cellHeight"]
    asset["duration"] = int(out.get("durationMs") or 0) if frames > 1 else 0
    if frames > 1:
        # loop is not recorded in metadata; animated sheets carry the explicit value declared above.
        asset["loop"] = bool(asset.get("loop", asset["duration"] > 0)) and asset["duration"] > 0
    else:
        asset.pop("loop", None)
    if qc.get("strict") is False:
        asset["strict"] = False
    if out.get("fullBleed"):
        asset["fullBleed"] = True
    else:
        asset["componentMode"] = out.get("componentMode")
    if qc.get("postureChange"):
        asset["postureChange"] = True


groups = []
for name, owner, assets, note in GROUPS:
    for a in assets:
        if a["id"] in ANCHORS:
            a["attempts"], a["anchor"] = ANCHORS[a["id"]], True
        elif a["id"] in ATTEMPTS:
            a["attempts"] = ATTEMPTS[a["id"]]
        sync_from_disk(name, a)
    groups.append({"group": name, "owner": owner, "note": note, "assets": assets})

# icon names become ICON.<name> constants: a duplicate would silently alias two frames.
seen = {}
for g in groups:
    for a in g["assets"]:
        for n in a.get("icons", []):
            if n in seen:
                sys.exit(f"build-manifest: icon name {n!r} on both {seen[n]} and {a['id']}")
            seen[n] = a["id"]

manifest = {
    "styleProfile": "art/style.json",
    "outputRoot": ROOT,
    "conventions": CONVENTIONS,
    "assetSchema": OLD["assetSchema"],
    "groups": groups,
    "qcExceptions": [{"id": i, "reason": r} for i, r in EXCEPTIONS],
    "integration": {
        "loader": "src/data/art.ts (GENERATED by scripts/gen-art-registry.mjs) + src/scenes/preload.ts",
        "keys": "Phaser texture key equals the asset's `key` (default: its `id`); animation key equals the texture key, "
                "with frames from the processed sprite sheet.",
        "wiring": "art/wiring.md",
        "gates": [
            "sprite_preflight_background on every raw sheet",
            "art_review on at least one asset per group plus one cross-group set call",
            "sprite_check_palette against art/style.json for every exported asset",
            "figure-ground per biome, day + night: python3 art/tools/figure-ground-cast.py",
            "node scripts/gen-art-registry.mjs --check guards src/data/art.ts against drift from this manifest + the metadata on disk",
        ],
        "artGroups": [g["group"] for g in groups],
    },
}
with open("art/manifest.json", "w") as fh:
    json.dump(manifest, fh, indent=2)
    fh.write("\n")
print(len(groups), "groups,", sum(len(g["assets"]) for g in groups), "assets,", len(EXCEPTIONS), "qcExceptions")
