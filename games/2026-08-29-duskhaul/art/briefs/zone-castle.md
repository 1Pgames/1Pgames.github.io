# Group `zone-castle` — Bleakspire Keep (9 sheets)

Read `_common.md` first. Output root:
`games/2026-08-29-duskhaul/public/assets/generated/zone-castle/`.

Arena is an OPEN FIELD, 1600x1600, seen straight-down top-down. There is no authored room
geometry: the floor TILES, the border band runs around the field edge, and every prop cell is a
scattered instance that OCCLUDES and BLOCKS. Draw props as obstacles with real mass and a
readable footprint, never as flat decoration.

**Zone value/colour trick (the one thing that separates castle from the other three):** the
floor is the DARKEST of the four zones — cold blue-grey wet stone, values sitting in the dark
band — and it is the only zone whose lights come from POINT SOURCES: torch-amber pools with hard
edges on wet flagstone, each pool ringed by a near-black falloff. Outlands is a flat mid-value
haze, desert is a bright field with hard shadows, winter is a bright field with soft cold
shadows; castle is dark field + small hot spots. Rectilinear man-made geometry (straight mortar
seams, square blocks, vertical columns) is the silhouette signature — the other three zones carry
no straight lines in their floors.

Palette rails for the whole group: blue-grey stone `#2b2f3a`-ish darks off the anchor's stone
tone, rotten moss-green seams (`#8a9a5b` desaturated HARD — moss is not the player rim; keep it
dull and confined to mortar lines), torch amber `#e8c547` for flame and pool light, gilt
`#d9a24b` only on treasure/shrine metal, dried-blood `#c0392b` only on hostile eyes and
windup light. No violet except gate light (gates are a sibling group's asset).

**Value contract (include in every ACTOR and PROP prompt; the tiles keep their own value
instructions above):** about half dark, about a third a readable MID tier, and a real LIGHT tier
covering roughly one sixth carries the brightest torch-amber and pale bone-grey highlights as BROAD
BRIGHT PATCHES, not a thin one-pixel rim; the core shadow does not swallow the whole body. This is art
direction, not a gate — apply it going forward, but do NOT reroll an already-accepted sheet to chase
the light tier.

## Enemy sheets (5)

All hostile: red pinprick eyes, NO green. Both characters shamble with the 2px vertical stutter.
Generate `-move` FIRST with `"writeScaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-castle/<char>-scale.json","profileName":"<char>"`, LOOK at it and
accept identity/proportions/feet line, then generate the siblings with
`"scaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-castle/<char>-scale.json"`
plus `"maxBodyScaleCv":0.08,"maxAnchorYStd":0.05,"maxProfileScaleDrift":0.08`.

**Silhouette contract (repeat the character's own line in its prompt):** chapelghast = tall
narrow vertical smear of torn grave-cloth, no legs, hem frayed to nothing · gargoyle = compact
squat wedge, wings folded into a hunched triangle wider than it is tall. At 48px one must read as
a vertical stroke and the other as a horizontal block. If they read alike, the silhouette brief
gets rewritten, not the colour.

| id | char | rows x cols | dur | action + frames | material/colour notes |
| --- | --- | --- | --- | --- | --- |
| enemy-chapelghast-move | chapelghast (base) | 2x2 | 120 | prowl, stable hover line: (1) cloth trails behind (2) drifts forward, hem lifts (3) body stretches taller (4) contracts, cloth settles | Chapel Ghast: rotten grave-cloth over a hollow, a dead choirboy's shroud; pale bone-parchment cloth gone grey-green with mould, two red pinpricks deep in the cowl; tall narrow vertical silhouette, no visible legs |
| enemy-chapelghast-death | chapelghast | 2x2 | 100 | (1) cowl snaps back (2) cloth tears along its length (3) shreds into strips (4) drifting grave-cloth scraps, eyes gone | scraps stay inside the safe area |
| enemy-gargoyle-move | gargoyle (base) | 2x2 | 150 | perch-shift, crouched on nothing (NO plinth, NO ground): (1) settled, wings folded (2) head turns, shoulders load (3) claws re-grip, wings twitch open a hand's width (4) settles back | Rust Gargoyle: pitted iron-and-stone chimera, orange rust bleeding down grey stone, cracked wing membranes; compact squat wedge, wings folded into a hunched triangle, red eyes in a blunt snout |
| enemy-gargoyle-attack | gargoyle | 2x2 | 90 | dive: (1) crouch deep, a hard-edged red glow gathering in the eyes, bright core and one dithered fringe step — frame 1 is the BRIGHTEST of the four and must read before any motion (2) wings snap wide (3) stretched dive, wings swept back, claws forward (4) impact recoil, wings flared to brake | the windup MUST read before the dive; wings must not cross the cell boundary — sweep them back along the body instead |
| enemy-gargoyle-death | gargoyle | 2x2 | 110 | (1) cracks split the stone, rust flakes (2) one wing shears off (3) body breaks into chunks (4) rubble pile, rust dust | rubble reads as broken masonry, not dust |

Literal markers, one per sheet — generate in this order (`-move` first, accept, then its siblings):

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-castle/enemy-chapelghast-move","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":120,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","writeScaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-castle/chapelghast-scale.json","profileName":"chapelghast"}`

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-castle/enemy-chapelghast-death","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":100,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05}`

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-castle/enemy-gargoyle-move","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":150,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","writeScaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-castle/gargoyle-scale.json","profileName":"gargoyle"}`

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-castle/enemy-gargoyle-attack","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":90,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","scaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-castle/gargoyle-scale.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05,"maxProfileScaleDrift":0.08}`

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-castle/enemy-gargoyle-death","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":110,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05}`

If a `-move` export reports its scale-profile path differently, use the exact reported path.

The `-death` markers deliberately carry NO `scaleProfile` and NO `maxProfileScaleDrift`: drift is
measured on BBOX HEIGHT, so gating height-invariance on an action whose whole purpose is to collapse is a
category error. The intra-sheet `maxBodyScaleCv` / `maxAnchorYStd` gates still hold four frames to one
character at one scale while letting the silhouette fall. Do NOT re-add the gate.

## Floor tile — `floor-castle` (seamless, full-bleed)

Subject: Bleakspire Keep flagstone floor seen straight down from directly overhead — a seamless
repeating tile of cracked square blue-grey flagstones, irregular block sizes, deep near-black
mortar seams with dull rotten moss growing in them, standing water in the low spots catching a
cold sheen, hairline cracks, grit and bone chips in the corners. Even overall lighting, NO
vignette, NO single light source, NO props, NO figures, NO text.

Tiling clause (state verbatim in the prompt): "The image is a SEAMLESS REPEATING TEXTURE: the
left edge continues into the right edge and the top edge into the bottom edge exactly. Fill the
entire canvas edge to edge with the texture — full-bleed, NO magenta background, no border, no
frame, no drop shadow, no lighting falloff at the edges. Do not place any feature that reads as a
centre or a focal point; the pattern must be uniform enough to repeat 5x5 times without a visible
seam or an obvious repeated landmark."

Value rail: this is the darkest floor in the game — keep it in the dark and low-mid bands so
enemy silhouettes and amber hazard pools read on top of it, but keep the wet highlights so it
does not collapse to one value (`art_review` lightnessRange must not collapse).

STYLE STAYS LOCKED HERE — `styleProfile` is KEPT deliberately. Lead the prompt with this CRITICAL line,
which cleared anchor dominance first try WITH the anchor still attached: "this image contains GROUND AND NOTHING ELSE — no creature, no figure, no skull; nothing stands up out of the
ground and nothing has a face."
Do NOT drop `styleProfile` for a tile. That fix was measured on a 9:16 LANDSCAPE BACKDROP (bg-menu), a
different asset class; here it would cost the artStyle/outline merge and leave nothing systemic holding
the tile to the lock. A welded MAGENTA FRAME on a full-bleed swatch (xai does this on every one, 45-56px)
is a SEPARATE defect with its own fix — detile to the inner rect, crop to a whole number of mortar
periods, keep the intermediate beside the raw — never a reason to drop the anchor.
Palette default, overridden by this zone's own tile instruction above wherever they differ: "Palette
strictly cold desaturated plum-grey and near-black — #0d0b10, #1a1520, #2b2431, #4a4452, #6e6875 — with
moss #57663a in the seams, torch-amber #e8c547 only where light lands, and bone-parchment #a89f8c chips;
absolutely no tan, beige, sand, khaki, brown, sepia or ochre."
SEAM CLAUSE — the generic "left edge continues into the right edge" measurably does NOTHING on its
own (V-wrap 12.29 against a 6.28 baseline); the PERIODIC form reached 6.57. State: "put the canvas edges EXACTLY ON A MORTAR SEAM, so no flagstone is cut in half and a whole
number of complete blocks spans the width and the height."
Keep the full-bleed, no-magenta and no-focal-landmark sentences of the tiling clause above; only
the "continues into" phrasing is insufficient by itself.
TILEABILITY: a full-bleed tile MUST export `minAlpha` 255 with `fit` 1. The `pixel-art-fx` path applies
fit 0.86, which insets the texture and leaves a transparent margin, so it exports clean, passes its
checks and silently cannot tile. Zero-regeneration fix: reprocess at `--fit 1 --align center --scale fit
--allow-source-edge-touch`. (This test is for FULL-BLEED assets only — a sprite correctly reads
minAlpha 0 at fit 0.86.)

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-castle/floor-castle","rows":1,"cols":1,"profile":"pixel-art-fx","styleProfile":"games/2026-08-29-duskhaul/art/style.json","cellSize":512,"fit":1,"strict":false,"allowSourceEdgeTouch":true}`

`qcExceptions` entry (REQUIRED, append on the first export, not after a retry):
`{ "id": "zone-castle/floor-castle", "reason": "Seamless full-bleed floor tile: the texture must reach every canvas edge for the repeat to work, so there is no magenta key and border/edge-contact QC cannot pass by construction — same documented case as the template's own arena/floor and bg/arena exports." }`

## Border band — `border-castle` (tileable, full-bleed)

Subject: a horizontal band of Bleakspire rampart seen from directly overhead — the top of a
ruined curtain wall: two courses of heavy square blue-grey blocks, crenellation gaps, collapsed
sections spilling rubble inward, a fallen banner of rotten cloth draped over one merlon, cold
water pooled in the wall's channel. Tiles LEFT-TO-RIGHT only (state: "the left edge continues
into the right edge exactly; the band runs the full width of the canvas"), full-bleed, no magenta,
no frame. This band is what the player reads as "the field ends here" — its value must be clearly
DARKER and its geometry clearly straighter than the floor so the arena edge is unmistakable at a
glance.

STYLE STAYS LOCKED HERE — `styleProfile` is KEPT deliberately. Lead the prompt with this CRITICAL line,
which cleared anchor dominance first try WITH the anchor still attached: "this image contains a ruined rampart wall-top seen from directly overhead and NOTHING ELSE — no creature, no figure,
no face, nothing standing upright out of it."
Do NOT drop `styleProfile` for a tile. That fix was measured on a 9:16 LANDSCAPE BACKDROP (bg-menu), a
different asset class; here it would cost the artStyle/outline merge and leave nothing systemic holding
the tile to the lock. A welded MAGENTA FRAME on a full-bleed swatch (xai does this on every one, 45-56px)
is a SEPARATE defect with its own fix — detile to the inner rect, crop to a whole number of mortar
periods, keep the intermediate beside the raw — never a reason to drop the anchor.
Palette default, overridden by this zone's own tile instruction above wherever they differ: "Palette
strictly cold desaturated plum-grey and near-black — #0d0b10, #1a1520, #2b2431, #4a4452, #6e6875 — with
moss #57663a in the seams, torch-amber #e8c547 only where light lands, and bone-parchment #a89f8c chips;
absolutely no tan, beige, sand, khaki, brown, sepia or ochre."
SEAM CLAUSE — the generic "left edge continues into the right edge" measurably does NOTHING on its
own (V-wrap 12.29 against a 6.28 baseline); the PERIODIC form reached 6.57. State: "put the canvas edges EXACTLY ON A MORTAR SEAM, so no flagstone is cut in half and a whole
number of complete blocks spans the width and the height."
Keep the full-bleed, no-magenta and no-focal-landmark sentences of the tiling clause above; only
the "continues into" phrasing is insufficient by itself.
TILEABILITY: a full-bleed tile MUST export `minAlpha` 255 with `fit` 1. The `pixel-art-fx` path applies
fit 0.86, which insets the texture and leaves a transparent margin, so it exports clean, passes its
checks and silently cannot tile. Zero-regeneration fix: reprocess at `--fit 1 --align center --scale fit
--allow-source-edge-touch`. (This test is for FULL-BLEED assets only — a sprite correctly reads
minAlpha 0 at fit 0.86.)

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-castle/border-castle","rows":1,"cols":1,"profile":"pixel-art-fx","styleProfile":"games/2026-08-29-duskhaul/art/style.json","cellSize":512,"fit":1,"strict":false,"allowSourceEdgeTouch":true}`

`qcExceptions`: `{ "id": "zone-castle/border-castle", "reason": "Tileable full-bleed border band: horizontal repeat requires edge-to-edge coverage, so magenta-key and edge-contact QC are inapplicable by design (template arena/floor precedent)." }`

## Prop sheet A — `props-castle-a` (3x3, 9 cells)

Cell contract: nine SEPARATE objects, one per cell, centred in the central 65% and floating in flat
`#FF00FF`; overhead-with-slight-tilt camera; brazier waist-high, statue head-high, bones ankle-high;
each an OBSTACLE with solid mass, closed dark outline and a visible footprint. Row-major:

1. `brazier-lit` — HAZARD, 8 dmg r=110: rusted iron bowl on clawed legs, tall torch-amber flame with a
   dirty red core; the brightest thing in the zone, reading as danger not comfort.
2. `brazier-cold` — the same bowl dead, grey ash and one dull ember; separates from cell 1 at 48px by
   VALUE alone, with no bright spot.
3. `banner` — rotten moss-green cloth banner crumpled into a heap over its snapped pole.
4. `coffin` — stone coffin, lid slid off, bone wrappings in the gap; most rectangular mass.
5. `pew` — broken chapel pew, back split; long low horizontal.
6. `rubble` — pile of broken flagstone and mortar dust; the smallest blocker.
7. `torch` — torn-free iron sconce, guttering amber head; tall thin vertical, dimmer than the brazier.
8. `statue` — headless armoured saint, moss down one side; tall vertical, strongest occluder.
9. `bones` — dry bone and a cracked skull, ankle-high, CLUMPED into one solid silhouette.

Families (director-facing — verify at 48px; NOT prompt text): tall verticals (statue, torch), rectangular blocks (coffin, braziers), long horizontals (pew,
banner), low clumps (rubble, bones); no two cells share a family AND a size.

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-castle/props-castle-a","rows":3,"cols":3,"profile":"pixel-art-fx","cellSize":256,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## Prop sheet B — `props-castle-b` (3x3, 9 cells)

Same cell contract, camera, scale and obstacle rule as sheet A. Row-major:

1. `font` — cracked baptismal font, black water in the basin, dull gilt inlay; squat cylinder.
2. `gatepiece` — fallen portcullis section, bars bent and rust-bleeding; flat lattice, the only
   see-through silhouette — bars thick enough to read at 48px.
3. `candles` — iron candle stand, five guttering stubs, wax down the arms; small amber light, dimmer
   than sheet A's torch.
4. `tomb` — raised tomb slab on a plinth, effigy worn featureless; largest rectangular mass.
5. `fence` — wrought-iron graveyard fence, spear finials, one panel bowed; long low horizontal.
6. `column` — broken column sheared at an angle, moss at the base; tall smooth untapered cylinder,
   distinct from sheet A's statue.
7. `shrine` — small blue-grey wall shrine, gilt-edged niche, one votive glow deep inside: the group's
   ONLY violet, small and COLD, lifted toward blue-cyan periwinkle, never magenta- or pink-leaning.
8. `hook` — butcher's chain and meat hook hanging from nothing, chain coiled below; thin vertical.
9. `shield` — dented heraldic shield propped upright, blazon scoured off, one gilt rivet; flat
   round-topped mass.

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-castle/props-castle-b","rows":3,"cols":3,"profile":"pixel-art-fx","cellSize":256,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## Set review

Two `art_review` SET calls: (a) both `-move` enemy sheets plus both prop sheets — the
silhouette-variety gate at renderScale 48; (b) `floor-castle` + `border-castle` together — the
floor must NOT collapse its lightness range and the border must sit clearly darker than the
floor. Then `sprite_check_palette` with `profile: games/2026-08-29-duskhaul/art/style.json` on all 9
exports (pass ≤ 36). Report per `_common.md` to `art/briefs/reports/zone-castle.md`.
