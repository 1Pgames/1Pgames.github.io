# Group `zone-outlands` — Ashen Outlands (9 sheets)

Read `_common.md` first. Output root:
`games/2026-08-29-duskhaul/public/assets/generated/zone-outlands/`.

Arena is an OPEN FIELD, 1600x1600, seen straight-down top-down. No authored room geometry: the
floor TILES, the border band runs the field edge, every prop cell is a scattered instance that
OCCLUDES and BLOCKS. Props are obstacles with real mass and a readable footprint, never
decoration.

**Zone value/colour trick:** outlands is the FLATTEST and haziest zone — one continuous mid-value
grey-brown mudflat with almost no darks and no highlights, veiled by an ochre dust haze that
lifts the whole field toward a dirty warm middle. Its readability comes not from light but from
CONTOUR: the floor carries long horizontal wind-combed streaks and drying cracks running
left-to-right (the bonestorm blows left-to-right, and the ground remembers it), and the only
value contrast in the zone is bone — hard bone-parchment whites, half-buried ribcages and cairn
skulls punching out of the mud. Castle = dark field with hot points; outlands = flat warm-grey
field with white bone accents and directional streaking. Nothing in this zone is wet and nothing
in it is bright.

Palette rails: grey-brown mudflat mids, ochre dust `#a08a5b`-ward warm grey for haze, bone
parchment `#e8e0d0` for bone, dead-bramble near-black for twig outlines, torch amber `#e8c547`
only on the one firepit and the ash-vent glow, gilt `#d9a24b` only on treasure metal, dried blood
`#c0392b` only on hostile eyes and windup light. No violet, no cyan, no green except grey-green
lichen on stone.

**Value contract (include in every ACTOR and PROP prompt; the tiles keep their own value
instructions above):** about half dark, about a third a readable MID tier, and a real LIGHT tier
covering roughly one sixth carries the brightest torch-amber and pale bone-grey highlights as BROAD
BRIGHT PATCHES, not a thin one-pixel rim; the core shadow does not swallow the whole body. This is art
direction, not a gate — apply it going forward, but do NOT reroll an already-accepted sheet to chase
the light tier.

Outlands exception: this is deliberately the flattest zone in the game. Its floor will always sit
narrow — its lights come from the bone chips and its darks from the crack network — and nothing should
widen it into looking like castle.

## Enemy sheets (5)

All hostile: red pinprick eyes, NO green. Generate `-move` FIRST with
`"writeScaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-outlands/<char>-scale.json","profileName":"<char>"`, LOOK at it and accept identity/proportions/feet
line, then the siblings with
`"scaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-outlands/<char>-scale.json"`
plus `"maxBodyScaleCv":0.08,"maxAnchorYStd":0.05,"maxProfileScaleDrift":0.08`.

**Silhouette contract (repeat the character's own line in its prompt):** kite = wide flat
horizontal glider, a shallow M of ragged wings, tiny body · giant = towering top-heavy pear, a
huge sagging torso on short thick legs, the biggest mass in either shared roster. The pair must
read at 48px as "wide thin thing" vs "tall fat thing" with a 3x mass difference. If they read
alike, the silhouette brief gets rewritten, not the colour.

| id | char | rows x cols | dur | action + frames | material/colour notes |
| --- | --- | --- | --- | --- | --- |
| enemy-kite-move | kite (base) | 2x2 | 100 | swoop-circle, stable hover line, banking: (1) wings high, body tilted into the turn (2) wings level, gliding (3) wings low on the downbeat (4) wings sweep back, gathering | Carrion Kite: bald carrion bird, ragged dust-grey primaries with bone-white shafts showing through gaps, naked red-raw neck, hooked beak, red eyes; wide flat horizontal glider silhouette, tiny body between big wings; faces right |
| enemy-kite-death | kite | 2x2 | 90 | (1) one wing folds wrong mid-glide (2) body tumbles sideways (3) feathers burst loose (4) crumpled heap, loose feathers still drifting | feathers stay inside the safe area |
| enemy-giant-move | giant (base) | 2x2 | 170 | heavy trudge with the 2px vertical stutter: (1) right leg lifts, torso lurches (2) weight lands, flesh sags (3) left leg lifts (4) lands lower, arms swinging late | Sloughed Giant: a huge corpse whose skin is sloughing off in grey sheets, wet meat and yellow fat showing beneath, ribs exposed on one side, tiny head sunk between shoulders, red eyes; towering top-heavy pear silhouette on short thick legs; the slowest-reading mass in the game |
| enemy-giant-attack | giant | 2x2 | 110 | ground slam: (1) arms drawn back and OUT TO THE SIDES in-plane, never lifted above the head, a hard-edged red glow gathering in the fists with a bright core and one dithered fringe step — frame 1 is the BRIGHTEST and holds through frame 2 (2) fists at the far point of the wind-up, shoulders squared to the camera (3) fists driven DOWN in-plane, torso folded over them (4) hunched follow-through, dust ring at the fists | the r=130 slam must read as a WIDE threat: put the dust ring at the fists inside the cell, never crossing the boundary; no ground line under the feet |
| enemy-giant-death | giant | 2x2 | 120 | (1) knees buckle (2) torso pitches forward (3) crashes down, skin sheets tearing free (4) collapsed mound of grey hide and bone | the fallen mass must still read as the biggest silhouette on the sheet |

Literal markers, one per sheet — generate in this order (`-move` first, accept, then its siblings):

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-outlands/enemy-kite-move","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":100,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","writeScaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-outlands/kite-scale.json","profileName":"kite"}`

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-outlands/enemy-kite-death","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":90,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05}`

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-outlands/enemy-giant-move","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":170,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","writeScaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-outlands/giant-scale.json","profileName":"giant"}`

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-outlands/enemy-giant-attack","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":110,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","scaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-outlands/giant-scale.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05,"maxProfileScaleDrift":0.08}`

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-outlands/enemy-giant-death","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":120,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05}`

If a `-move` export reports its scale-profile path differently, use the exact reported path.

The `-death` markers deliberately carry NO `scaleProfile` and NO `maxProfileScaleDrift`: drift is
measured on BBOX HEIGHT, so gating height-invariance on an action whose whole purpose is to collapse is a
category error. The intra-sheet `maxBodyScaleCv` / `maxAnchorYStd` gates still hold four frames to one
character at one scale while letting the silhouette fall. Do NOT re-add the gate.

## Floor tile — `floor-outlands` (seamless, full-bleed)

Subject: an ashen mudflat seen straight down from directly overhead — a seamless repeating tile
of dried grey-brown mud, polygonal drying cracks, long shallow wind-combed streaks and drifts of
pale ash running LEFT-TO-RIGHT across the whole tile, patches of grit and gravel, scattered small
bone chips and one or two knuckle bones pressed into the surface, a faint ochre dust film over
everything. Even overall lighting, NO vignette, NO single light source, NO props, NO figures, NO
text.

Tiling clause (state verbatim in the prompt): "The image is a SEAMLESS REPEATING TEXTURE: the
left edge continues into the right edge and the top edge into the bottom edge exactly. Fill the
entire canvas edge to edge with the texture — full-bleed, NO magenta background, no border, no
frame, no drop shadow, no lighting falloff at the edges. Do not place any feature that reads as a
centre or a focal point; the pattern must repeat 5x5 times without a visible seam or an obvious
repeated landmark."

Value rail: the flattest floor of the four — hold it in the mid band, warm-grey, and let the bone
chips be the only near-lights. It must still not collapse to one value: the crack network and the
ash streaks carry the lightness range. Keep it MID so the bone-white desert floor and the
blue-white winter floor stay distinguishable from it at a glance.

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
own (V-wrap 12.29 against a 6.28 baseline); the PERIODIC form reached 6.57. State: "put the canvas edges on the BOUNDARIES OF THE DRYING-CRACK POLYGONS, a whole number of crack
cells across the width and the height."
Keep the full-bleed, no-magenta and no-focal-landmark sentences of the tiling clause above; only
the "continues into" phrasing is insufficient by itself.
TILEABILITY: a full-bleed tile MUST export `minAlpha` 255 with `fit` 1. The `pixel-art-fx` path applies
fit 0.86, which insets the texture and leaves a transparent margin, so it exports clean, passes its
checks and silently cannot tile. Zero-regeneration fix: reprocess at `--fit 1 --align center --scale fit
--allow-source-edge-touch`. (This test is for FULL-BLEED assets only — a sprite correctly reads
minAlpha 0 at fit 0.86.)

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-outlands/floor-outlands","rows":1,"cols":1,"profile":"pixel-art-fx","styleProfile":"games/2026-08-29-duskhaul/art/style.json","cellSize":512,"fit":1,"strict":false,"allowSourceEdgeTouch":true}`

`qcExceptions` entry (REQUIRED, append on the first export, not after a retry):
`{ "id": "zone-outlands/floor-outlands", "reason": "Seamless full-bleed floor tile: the texture must reach every canvas edge for the repeat to work, so there is no magenta key and border/edge-contact QC cannot pass by construction — same documented case as the template's own arena/floor and bg/arena exports." }`

## Border band — `border-outlands` (tileable, full-bleed)

Subject: a horizontal band of dead bramble thicket seen from directly overhead — a dense
impassable tangle of black leafless thorn branches over a bank of drifted ash, snagged rags and
one snapped wheel caught in the brambles, half-buried long bones at the near edge. Tiles
LEFT-TO-RIGHT only (state: "the left edge continues into the right edge exactly; the band runs
the full width of the canvas"), full-bleed, no magenta, no frame. Against the flat mid floor the
arena edge cannot be read by value alone, so this band's signal is DENSITY and DARKNESS: a
near-black high-frequency thorn mass, unmistakably the wall of a field at a glance.

STYLE STAYS LOCKED HERE — `styleProfile` is KEPT deliberately. Lead the prompt with this CRITICAL line,
which cleared anchor dominance first try WITH the anchor still attached: "this image contains a dense dead-bramble thicket over drifted ash and NOTHING ELSE — no creature, no figure,
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
own (V-wrap 12.29 against a 6.28 baseline); the PERIODIC form reached 6.57. State: "put the canvas edges on the BOUNDARIES OF THE DRYING-CRACK POLYGONS, a whole number of crack
cells across the width and the height."
Keep the full-bleed, no-magenta and no-focal-landmark sentences of the tiling clause above; only
the "continues into" phrasing is insufficient by itself.
TILEABILITY: a full-bleed tile MUST export `minAlpha` 255 with `fit` 1. The `pixel-art-fx` path applies
fit 0.86, which insets the texture and leaves a transparent margin, so it exports clean, passes its
checks and silently cannot tile. Zero-regeneration fix: reprocess at `--fit 1 --align center --scale fit
--allow-source-edge-touch`. (This test is for FULL-BLEED assets only — a sprite correctly reads
minAlpha 0 at fit 0.86.)

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-outlands/border-outlands","rows":1,"cols":1,"profile":"pixel-art-fx","styleProfile":"games/2026-08-29-duskhaul/art/style.json","cellSize":512,"fit":1,"strict":false,"allowSourceEdgeTouch":true}`

`qcExceptions`: `{ "id": "zone-outlands/border-outlands", "reason": "Tileable full-bleed border band: horizontal repeat requires edge-to-edge coverage, so magenta-key and edge-contact QC are inapplicable by design (template arena/floor precedent)." }`

## Prop sheet A — `props-outlands-a` (3x3, 9 cells)

Cell contract: nine SEPARATE objects, one per cell, centred in the central 65% and floating in flat
`#FF00FF`; overhead-with-slight-tilt camera; cart hero-height, cairn waist-high, mud pools
ground-level; each an OBSTACLE with a visible footprint. Row-major:

1. `ribcage` — huge half-buried ribcage arching out of the mud, ribs snapped one side; wide arch, the
   zone's signature and brightest bone-white mass.
2. `gibbet` — leaning empty iron gibbet cage on a bent post; tall thin vertical leaning off true —
   nothing else in the zone leans, and that tilt is its identity.
3. `bramble` — knot of dead black thorn brush, waist-high and dense; the darkest mass here.
4. `dune` — low wind-combed ash drift, ash paler than the mud; long low horizontal, the only soft mass.
5. `cart` — overturned haul-cart, one wheel gone, boards split; largest angular mass.
6. `cairn` — stacked stone cairn, cracked skull in the top course, lichen; compact vertical stack.
7. `tree` — dead lightning-split stump, bark gone silver-grey, two limbs clawing up; tall irregular
   vertical, organic and NOT leaning, distinct from `gibbet`.
8. `mudpool` — black wet mud, dull sheen, bubble rings, a hand breaking the surface; flat ground-level
   disc, the zone's only wet highlight and only plain circle.
9. `wheel` — broken cart wheel half-sunk on its side, spokes snapped, rim rusted; flat round mass, a
   hard spoked lattice rather than `mudpool`'s solid disc.

Families (director-facing — verify at 48px; NOT prompt text): tall verticals (gibbet, tree, cairn), angular blocks (cart, ribcage), low soft horizontals
(dune, bramble), flat discs (mudpool, wheel); no two cells share a family AND a size.

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-outlands/props-outlands-a","rows":3,"cols":3,"profile":"pixel-art-fx","cellSize":256,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## Prop sheet B — `props-outlands-b` (3x3, 9 cells)

Same cell contract, camera, scale and obstacle rule as sheet A. Row-major:

1. `cage` — toppled iron transport cage on its side, bars sprung, bone inside; low horizontal lattice.
2. `scarecrow` — corpse-scarecrow on a crossed frame, sacking head, arms wired wide; the zone's only
   cruciform silhouette.
3. `vent` — HAZARD, the bonestorm ash source (3 dps drifting zones): a cracked fissure ringed with grey
   ash cones, a column of drifting ash-DOTS rising and leaning left-to-right with the wind, and a dull
   ember glow of amber light deep in the crack, low and dimmer than cell 8. The ash-dots must be
   discrete pale specks with visible gaps, never smooth smoke, so the runtime's scattered zones read as
   the same motif.
4. `bonefence` — long bones lashed upright with wire, uneven heights, skull finials; picket mass.
5. `milestone` — leaning milestone, inscription scoured blank (NO lettering); small vertical block.
6. `perch` — tall iron carrion perch, bare crossbar on a pole, droppings streaking it white; thin T,
   the slenderest mass.
7. `tent` — collapsed hide tent, poles snapped inward, one corner pegged; low wide triangular slump.
8. `firepit` — ring of blackened stones, charred logs, one live torch-amber flame; the sheet's only
   real light source and the brightest thing in the zone.
9. `shrine-ash` — roadside niche packed with grey ash, a bone offering and one gilt coin; compact
   block, the zone's only gilt accent.

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-outlands/props-outlands-b","rows":3,"cols":3,"profile":"pixel-art-fx","cellSize":256,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## Set review

Two `art_review` SET calls: (a) both `-move` enemy sheets plus both prop sheets — the
silhouette-variety gate at renderScale 48 (this zone is the highest blob-risk of the four: a flat
palette hides shape failure, so judge the sheets downscaled to 48px); (b) `floor-outlands` +
`border-outlands` together — the floor must not collapse its lightness range and the bramble band
must read clearly denser and darker than the floor. Then `sprite_check_palette` with
`profile: games/2026-08-29-duskhaul/art/style.json` on all 9 exports (pass ≤ 36). Report per
`_common.md` to `art/briefs/reports/zone-outlands.md`.
