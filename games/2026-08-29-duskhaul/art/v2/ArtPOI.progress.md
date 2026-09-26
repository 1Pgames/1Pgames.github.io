# ArtPOI progress (V2 §11 poi / gates-v2 / breakables / pickups-v2 / weapon-fx / boss-fx / fx-v2)

Manifest groups (merge input): `art/v2/ArtPOI.groups.json`. Paths are under `public/assets/generated/<group>/<id>/`
(`sprite-sheet.png` for multi-frame, `sprite.png` for 1x1, plus `sprite-metadata.json`).
Repro: `python3 art/briefs/v2-poi/build.py` (cwd = game root) reprocesses every accepted raw in `art/briefs/v2-poi/raw/`.

## Batch 1 — pickups + lore (strict QC pass)
- pickups-v2/pk-bread, pk-bell, pk-flask, pk-salt, pk-xpcluster, pk-key — 2x2, 64px cells, 4f glint loop
- poi/poi-lore — 1x1, 128px

## Batch 2 — chests, vault, banner, vein (strict QC pass)
- poi/poi-chest-t1, -t2, -t3 — 2x2, 128px, 4f open (loop false; frame 3 = open)
- poi/poi-vault — 1x2, 256px, frame 0 closed / frame 1 open (duration 0, index-addressed)
- poi/poi-lair-banner — 2x2, 128px, 4f flutter loop
- poi/poi-vein — 1x3, 128px, frame 0 full / 1 half / 2 depleted (duration 0)

## Batch 3 — shrines + bell (strict QC pass)
- poi/poi-shrine-blood, -gilt, -bone, -grave, -curse — 2x2, 192px, 4f idle glow loop
- poi/poi-bell — 2x2, 192px, 4f swing loop

## Batch 4 — gates, fence, den wall (strict QC pass)
- gates-v2/gate-toll-closed, gate-offering-closed, gate-bell-closed — 1x1, 256px (same arch as gates-collapse/gate-closed)
- gates-v2/gate-toll-open, gate-offering-open, gate-bell-open — 2x2, 256px, 4f violet flame loop
- poi/npc-fence — 2x2, 256px, 4f idle loop (faces right)
- poi/poi-den-wall — 1x2, 256px, frame 0 rising / frame 1 raised (duration 0)

## Batch 5 — breakables (strict QC pass)
- breakables/brk-castle, brk-outlands, brk-desert, brk-winter — 2x3, 128px, duration 0.
  Frame map: 0 urn, 1 coffin, 2 crate (intact); 3 urn, 4 coffin, 5 crate (broken) = frame+3.
  ICON names `brk-<zone>-urn|coffin|crate[-broken]` map to those frames.

## Batch 6-8 — weapon-fx, boss-fx, fx-v2 (strict QC pass)
- weapon-fx/wpn-skull, -evo (2x2 64px, faces right) · wpn-censer-pool, -evo (2x2 256px) · wpn-sickle, -evo (2x2 96px spin)
  · wpn-lash, -evo (3x1, 384x96 cells, loop false) · wpn-breath, -evo (2x2 256px, cone points right) · wpn-spear, -evo (1x5 128px, loop false)
- boss-fx/fx-bell-ring (2x2 512, loop false) · fx-geyser (1x5 128, loop false) · fx-scorch-beam (1x3, 64x400 vertical)
  · fx-icicle (2x2 64, points down) · fx-ice-wall (1x2 256, frame 0 forming / 1 standing, duration 0) · fx-sand-pillar (1x3 128, loop false)
- fx-v2/fx-lightpool (1x1 512, white dithered radial — tint in code) · fx-shadow (1x1 128x64) · fx-chest-beam (1x4, 64x256, tint by rarity)

ALL 52 ids delivered. Groups file: art/v2/ArtPOI.groups.json (7 groups, 52 assets, 7 qcExceptions).
Full report: art/briefs/v2-poi/report.md. Integrator: add poi, gates-v2, breakables, pickups-v2, weapon-fx, boss-fx, fx-v2 to ART_GROUPS.
