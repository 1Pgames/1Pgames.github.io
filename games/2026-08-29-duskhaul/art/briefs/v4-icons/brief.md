# icons-v4 brief (ArtArsenalIcons) — Arsenal-20 new pairs (PRD-V2 §5.8b.5)

Group `icons-v4`, 96 px cells, read target 48 px. Every call: Image 1 `art/refs/vision-1.png`
(palette/lighting/finish) + Image 2 an accepted icons-v2 raw (weapons: `icons-wpn-a`; charms:
`icons-kit`) for icon rendering (chunky hand-painted, thick near-black outline). Hero cool
palette only (cyan/violet/bone/steel); no red/orange/amber, no `#39ff6a`, no rims.

| sheet | grid | frame → id : subject |
|---|---|---|
| icons-arsenal-wpn | 4x4 | 0 wpn-aura shroud in violet ring · 1 wpn-chakram split bone disc, cyan rim · 2 wpn-wake violet cold-fire footprints · 3 wpn-snares bone-toothed jaw trap, cyan rune · 4 evo-aura hooded skull in double flame ring · 5 evo-chakram bone wheel with cyan arcs · 6 evo-wake S-river of violet fire · 7 evo-snares 4 chained jaw traps · 8 wpn-siphon hollow femur, violet beam · 9 wpn-bombs rune urn · 10 wpn-totem skull on bone post, violet flame · 11 wpn-thralls hunched grey husk, cyan eyes, facing right · 12 evo-siphon bone heart pierced by 3 tethers · 13 evo-bombs 3 urns + flying shards · 14 evo-totem bone reliquary, violet flames · 15 evo-thralls 4 husks with bone collars |
| icons-arsenal-charm-a | 2x2 | 0 c_pin jet-bead mourning hatpin · 1 c_knuckle pipped knucklebone · 2 c_sole pilgrim sandal + scallop token · 3 c_fuse coiled fuse, bone cap, cyan spark |
| icons-arsenal-charm-b | 2x2 | 0 c_vial corked marrow vial · 1 c_powder horn powder flask spilling bone dust · 2 c_hymnal black hymnal, bone clasp, violet ribbon · 3 c_collar riveted collar with bone tag |

Charms use two 2x2 sheets (8 exactly) rather than a 3x3 with an empty cell (strict `empty` fails).
Distinct from existing charms: powder is a horn (c_pouch is a sack), vial is a slim tube (cb_flask is round).

## QC (sprite_check_palette vs art/style.json, max 48)
| sheet | meanDistance | outlierFraction | attempts | notes |
|---|---|---|---|---|
| icons-arsenal-wpn | 37.61 | 0.254 | 1 (edit) | accepted icons-v2/icons-wpn-a baseline 38.25 / 0.272; edge touch frame 14 reviewed |
| icons-arsenal-charm-a | 24.33 | 0.043 | 0 | |
| icons-arsenal-charm-b | 23.17 | 0.061 | 0 | |

Red-rim/green-rim pixel census (alpha≥128; red r>150,g<90,b<90; green g>150,r,b<130):
wpn 0/1, charm-a 0/0, charm-b 0/0 (accepted icons-wpn-a: 14/265).

Reproduce: `sh games/2026-08-29-duskhaul/art/briefs/v4-icons/rebuild.sh` (repo root) — verified byte-identical.
