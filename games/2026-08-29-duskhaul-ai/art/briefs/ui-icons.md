# Group `ui-icons` — HUD glyphs, title crest, menu backdrop (3 sheets)

Read `_common.md` first. Output root: `games/2026-08-29-duskhaul/public/assets/generated/ui-icons/`.
Profile `pixel-art-fx`, cellSize `256` (ui convention).

**Scope law (game-art rule 7 + PRD §11):** this group generates GLYPHS and IMAGES only. Panels, pills,
bars, buttons, the joystick region and every frame/housing stay procedural (`ui/primitives.ts`,
`core/textures.ts`) and are NOT drawn here. Never generate a button, a plate, a bar housing, a border
frame, a rounded rectangle background, a badge plate, lettering, digits or words.

## icons — 4x4 (16 glyphs, static sheet)

One glyph per cell, frame index = the `icons[]` order in `art/manifest.json` (index 0 = top-left, reading
left-to-right then top-to-bottom). The runtime addresses these by frame index (`duration: 0` in the
manifest = no animation), so the ORDER BELOW IS BINDING:

| # | name | Glyph |
| --- | --- | --- |
| 0 | `shard` | a chipped triangular gilt wedge with one bright facet — the currency shard of `pickups-fx/shard-glint`, reduced to a flat glyph |
| 1 | `relic-t1` | a squat open ring with a small tooth nub, PLAIN — no aura ring |
| 2 | `relic-t2` | the same ring silhouette inside ONE thin gilt aura ring |
| 3 | `relic-t3` | the ring inside a gilt aura ring with 4 short straight spokes at N/E/S/W |
| 4 | `relic-t4` | the ring inside a thick DUSK-VIOLET aura ring with a red pinprick centre |
| 5 | `casket` | a small rounded-corner reliquary box with a keyhole clasp and a hasp nub on top |
| 6 | `gate-arrow` | a solid stubby chevron arrow pointing RIGHT, its tail passing through a tiny archway outline — the gate-compass arrow |
| 7 | `pause` | two thick vertical bars with a 1-bar gap, ends squared |
| 8 | `gear-blade` | a broken sickle blade, edge up, short bone grip — the Blade charm slot |
| 9 | `gear-shroud` | a hanging hooded cowl seen front-on, empty hood mouth black — the Shroud slot |
| 10 | `gear-trinket` | a pendant teardrop on 3 chain links — the Trinket slot |
| 11 | `zone-castle` | a crenellated keep spire with one arrow-slit window — Bleakspire Keep |
| 12 | `zone-outlands` | three curved ribcage arcs rising out of a flat ground line — Ashen Outlands |
| 13 | `zone-desert` | a half-buried statue head above two dune curves — Sorrow Dunes |
| 14 | `zone-winter` | a jagged six-point ice crystal with one broken arm — Widow's Crown |
| 15 | `skull` | a blunt human skull, front-on, two black eye sockets, no jaw — used for threat/death/LOST rows and the locked-zone lock read |

**Uniformity contract (state all of it in the prompt):** all 16 glyphs share ONE optical size — each fills
55-60% of its cell measured across its longest axis, so the ring glyphs and the tall spire glyph read the
same weight in the HUD; ONE stroke weight — every outline and every internal line is the same thickness in
every cell; flat silhouette-first shapes with at most two internal detail lines each; no perspective, no
shading ramp, no gradient, no highlight sparkle, no drop shadow, no aura beyond the tier rings specified
above, no plate/frame/background behind any glyph.

**Colour contract:** every glyph body is bone-parchment ink `#e8e0d0` on a heavy black outline. Colour is
permitted ONLY where colour IS the meaning: gilt `#d9a24b` on `shard` and on the t2/t3 aura rings;
dusk-violet `#5b4bff` on the `relic-t4` aura ring and on `gate-arrow`; dried-blood `#c0392b` for the
single pinprick at the centre of `relic-t4`. Glyphs 5, 7-15 are bone ink only — the HUD tints them in code.

Silhouette brief: no two glyphs may share a silhouette class. The four `relic-t*` glyphs are the one
deliberate exception — they share the ring body and differ ONLY by aura (none / thin gilt / gilt+spokes /
thick violet+red core), because that is the tier language the pickups use (`pickups-fx.md`); at HUD size
the aura is what the player reads.

Marker (no `duration`: static sheet addressed by frame index):
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/ui-icons/icons","rows":4,"cols":4,"profile":"pixel-art-fx","cellSize":256,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

**Accept gate:** downscale the exported sheet to 40px per glyph (the PRD §14 pause-icon size) and look at
it. Any glyph that becomes a blob at 40px is rejected — regenerate that sheet with fewer internal lines,
not with a bigger glyph.

## emblem — 1x1 (title crest, WORDLESS)

Subject: the Duskhaul crest — a heraldic shield-less emblem: a hooded revenant skull (the Duskhauler's
moss-green hood and two red pinprick eyes) centred over a squat stone archway whose opening burns
dusk-violet, with two crossed grave-spades behind the skull and a spray of three gilt shards below. Cold
plum-grey stone, gilt highlights, the violet arch light as the only bright area. Compact, symmetrical,
roughly circular overall mass, filling ~70% of the cell.
**Absolutely no lettering, no digits, no words, no ribbon banner, no scroll, no plate, no frame** — the
title text is composited by the menu scene over this crest (PRD §14b Menu).
Silhouette brief: a single symmetrical circular clump — skull dome at the top, spade blades fanning
diagonally, arch base squaring it off at the bottom. Must read as one mark at 200px on the menu.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/ui-icons/emblem","rows":1,"cols":1,"profile":"pixel-art-fx","cellSize":256,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## bg-menu — 1x1, PORTRAIT 9:16, full-bleed — `strict:false`

Canvas exception: `image_size: "1080x1920"`, `aspect_ratio: "9:16"` (overrides `_common.md` §5). The
earlier value `1024x1792` was WRONG and vertically squashed the backdrop — 1024/1792 = 0.5714 is 4:7,
not 9:16's 0.5625. 1080x1920 is what shipped; do not restore the old number.
NON-SQUARE FULL-BLEED WARNING: `--fit 1` CANNOT fix this asset class. For a 1x1 export the processor
always emits a SQUARE `cellSize` canvas and letterboxes the image into it, so the content stays intact
at 0.5625 inside transparent side bars and `minAlpha` stays 0 — measured across three flag
combinations including `--threshold 0 --edge-threshold 0`. `--fit 1` works for the zone tiles only
because those are square. The fix here is a deterministic NEAREST resample of the accepted raw to the
target size (1584x2816 -> 1080x1920), which preserves hard pixel edges and is the same sanctioned class
of operation as the `border-inner.png` detile.

Subject: a dusk horizon over the ruined province — the menu backdrop. Foreground lower third: a dark
silhouetted ridge of broken headstones, a leaning gibbet and dead brambles, almost black. Middle: the
cold desaturated plum-grey province — a distant ruined keep on the left, mudflats and a dry riverbed
running back to the horizon, three tiny dusk-violet gate lights scattered across it (the extraction
gates, glowing pinpricks). Upper half: a heavy overcast dusk sky, deep `#1a1520` at the top falling to a
bruised violet-grey band at the horizon, one thin torch-amber break in the cloud on the right. No moon,
no stars, no birds.
**Full-bleed backdrop rules:** the image runs edge to edge with no border, no vignette frame, no magenta;
**no character, no hero, no creature, no text, no logo, no UI element, no HUD** anywhere in frame.
Composition: keep the upper-middle band (roughly y 15-45% of the image) visually QUIET and dark — the
menu's title, crest and zone cards sit there (PRD §14b) and this backdrop must not compete with them; put
all the detail in the lower third and the horizon line.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/ui-icons/bg-menu","rows":1,"cols":1,"profile":"pixel-art-fx","cellSize":256,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","strict":false}`
`strict:false` is already covered by the existing `art/manifest.json.qcExceptions[]` entry
`ui-icons/bg-menu` ("Full-bleed 9:16 backdrop; strict:false by design (template bg/arena precedent)") —
do not add a duplicate.

**Readability handoff (mandatory):** this backdrop is a text-over-art surface. Report it to the
ArtDirector and ui-engineer as such: the menu title, the 4 zone cards (640x150 from y 420) and the PLAY
button all sit on it and need the §11 text armour / scrim treatment. Generated art is brighter and busier
than the template gradient — flag it, do not fix it in this group.

**Order:** `icons` first (it is the group's hardest gate), then `emblem`, then `bg-menu`.

**Set review:** one `art_review` SET call across the `icons` sheet + `emblem` (glyph weight and value
structure consistency), and a separate single-asset `art_review` on `bg-menu` — a backdrop with no real
darks or no real lights will swallow the menu copy. `sprite_check_palette` with
`profile: games/2026-08-29-duskhaul/art/style.json` on all three. Report per `_common.md`.
