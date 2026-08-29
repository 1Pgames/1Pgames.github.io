# Group `zone-winter` — Widow's Crown (10 sheets)

Read `_common.md` first. Output root:
`games/2026-08-29-duskhaul/public/assets/generated/zone-winter/`.

Arena is an OPEN FIELD, 1600x1600, seen straight-down top-down. No authored room geometry: the
floor TILES, the border band runs the field edge, every prop cell is a scattered instance that
OCCLUDES and BLOCKS. Props are obstacles with real mass and a readable footprint, never
decoration.

**Zone value/colour trick:** winter is the only zone built on a TEMPERATURE SPLIT rather than a
value one. The field is light-to-mid cold blue snow with cyan-white highlights and soft blue
shadows (no hard edges — the light here is a flat overcast dusk), and the only warm thing in the
whole zone is the torch pools: circular, hard-edged amber islands with a visible warm-to-cold
boundary sitting ON the blue snow. Castle is amber points on a dark field, desert is hard violet
shadows on a bright field, outlands is flat and warm-grey with no shadows; winter is a cold bright
field with round warm islands. Second signature, unique to this zone: things are LOOKING OUT FROM
UNDER the surface — frozen corpses, gates and stonework read THROUGH a glaze of ice, faces and
edges softened and blue-shifted by the layer over them. Nothing else in the game has that
under-ice read.

Gameplay legibility this buys: the amber torch ring is exactly the safe radius from the 30% gale
slow, so warm = safe is the zone's whole visual grammar. Ice sheets are the counter-read — a
cyan-white glassy patch with a mirror sheen, cold and slick.

Palette rails: cold blue snow field, cyan-white `#cfe6f0`-ward highlights, deep blue-plum shadow,
torch amber `#e8c547` for every flame and pool, bone parchment for exposed bone, dusk violet
`#5b4bff` only on the buried gate's glow, gilt `#d9a24b` only on shrine metal, dried blood
`#c0392b` only on hostile eyes and windup light. No green.

**Value contract (include in every ACTOR and PROP prompt; the tiles keep their own value
instructions above):** about half dark, about a third a readable MID tier, and a real LIGHT tier
covering roughly one sixth carries the brightest torch-amber and pale bone-grey highlights as BROAD
BRIGHT PATCHES, not a thin one-pixel rim; the core shadow does not swallow the whole body. This is art
direction, not a gate — apply it going forward, but do NOT reroll an already-accepted sheet to chase
the light tier.

## Enemy sheets (6)

All hostile: red pinprick eyes, NO green. Generate `-move` FIRST with
`"writeScaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-winter/<char>-scale.json","profileName":"<char>"`, LOOK at it and accept identity/proportions/feet
line, then the siblings with
`"scaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-winter/<char>-scale.json"`
plus `"maxBodyScaleCv":0.08,"maxAnchorYStd":0.05,"maxProfileScaleDrift":0.08`.

**Silhouette contract (repeat the character's own line in its prompt):** widow = a wide low
spidery star, small body with eight long thin legs spanning far past it, mostly negative space ·
yeti = a tall solid slab, a single heavy rectangular mass with almost no negative space at all.
At 48px one is a spiky openwork shape and the other a filled block. If they read alike, the
silhouette brief gets rewritten, not the colour.

Both are DARK-ish on a light field: keep bodies in the mid band with heavy outlines — a white yeti
on white snow is the predictable failure here, so the Hollow Yeti's hide is DIRTY grey-blue, never
snow-white.

| id | char | rows x cols | dur | action + frames | material/colour notes |
| --- | --- | --- | --- | --- | --- |
| enemy-widow-move | widow (base) | 2x2 | 140 | creeping crawl: (1) left legs reach forward, body low (2) body hauled forward between them (3) right legs reach (4) gather, body lifts slightly | Frost Widow: a shield-sized spider of frost-rimed black chitin, hoar crystals furring the joints, pale ice-white web silk trailing from the spinnerets, cluster of red eyes; wide low spidery star silhouette, mostly negative space between long thin legs |
| enemy-widow-attack | widow (rear + web) | 2x2 | 100 | rears and lays web: (1) front four legs lift, abdomen drops, a hard-edged red glow in the eye cluster with a bright core and one dithered fringe step — frame 1 is the BRIGHTEST and must read before any motion (2) body hunched low and squared to the camera, abdomen tipped forward, never reared taller (3) spinnerets fire, a pale ice-white web disc spraying outward-down (4) settles onto the finished web patch | the r=120 web is the payload: the disc must read as a distinct pale patch of radial silk attached to the body, kept inside the cell — do not let silk cross the boundary |
| enemy-widow-death | widow | 2x2 | 100 | (1) legs snap inward (2) curls tight, body drawn under (3) frost creeps over the curled mass (4) a frozen fist of legs and ice, eyes dark | the death silhouette inverts the move silhouette: open star to closed ball — protect that contrast |
| enemy-yeti-move | yeti (base) | 2x2 | 160 | heavy lumber with the 2px vertical stutter: (1) right leg swings through, shoulders roll (2) weight lands, hide sways (3) left leg swings (4) lands lower, arms trailing | Hollow Yeti: a huge dead ape-thing, dirty grey-blue matted hide caked with ice, the chest cavity HOLLOW — a dark gap between spread ribs with nothing inside, jaw hanging, red eyes; tall solid slab silhouette, almost no negative space except that rib cavity |
| enemy-yeti-attack | yeti | 2x2 | 100 | enrage flurry (this is the sub-30%-hp rage): (1) head tipped back, chest cavity flaring with a hard-edged red glow, bright core and one dithered fringe step — frame 1 is the BRIGHTEST and must read before any motion (2) arms swept OUT ACROSS in-plane, never lifted, hide bristling, red bleeding from the ribs (3) both arms swept across in a battering flurry, body twisted (4) hunched, breathing hard, cavity still glowing red | the RED IN THE HOLLOW CHEST is the enrage tell — it must be the only red mass of its size in the zone and clearly brighter than in the move sheet |
| enemy-yeti-death | yeti | 2x2 | 110 | (1) staggers, knees give (2) drops to knees, arms slack (3) ribcage caves inward, ice sheeting off (4) collapsed slab of hide and shattered ribs, cavity dark | the caving ribcage is the payload — the hollow chest must visibly crush shut |

Literal markers, one per sheet — generate in this order (`-move` first, accept, then its siblings):

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-winter/enemy-widow-move","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":140,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","writeScaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-winter/widow-scale.json","profileName":"widow"}`

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-winter/enemy-widow-attack","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":100,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","scaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-winter/widow-scale.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05,"maxProfileScaleDrift":0.08}`

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-winter/enemy-widow-death","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":100,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05}`

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-winter/enemy-yeti-move","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":160,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","writeScaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-winter/yeti-scale.json","profileName":"yeti"}`

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-winter/enemy-yeti-attack","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":100,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","scaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-winter/yeti-scale.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05,"maxProfileScaleDrift":0.08}`

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-winter/enemy-yeti-death","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":110,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05}`

If a `-move` export reports its scale-profile path differently, use the exact reported path.

The `-death` markers deliberately carry NO `scaleProfile` and NO `maxProfileScaleDrift`: drift is
measured on BBOX HEIGHT, so gating height-invariance on an action whose whole purpose is to collapse is a
category error. The intra-sheet `maxBodyScaleCv` / `maxAnchorYStd` gates still hold four frames to one
character at one scale while letting the silhouette fall. Do NOT re-add the gate.

## Floor tile — `floor-winter` (seamless, full-bleed)

Subject: a blue snowfield with corpses under the ice, seen straight down from directly overhead —
a seamless repeating tile of wind-packed cold blue snow with cyan-white crust plates, sastrugi
ridges, and beneath a glaze of clear grey-blue ice the shapes of the dead showing through
SOFTENED and blue-shifted: a hand pressed flat against the underside, a face turned away, a
shoulder and a rib line, a scrap of frozen cloth — all read THROUGH the ice, never breaking its
surface. Hairline stress cracks in the glaze, drift dust on top. Flat overcast lighting, NO
vignette, NO single light source, NO props above the surface, NO figures standing on it, NO text.

Tiling clause (state verbatim in the prompt): "The image is a SEAMLESS REPEATING TEXTURE: the
left edge continues into the right edge and the top edge into the bottom edge exactly. Fill the
entire canvas edge to edge with the texture — full-bleed, NO magenta background, no border, no
frame, no drop shadow, no lighting falloff at the edges. Do not place any feature that reads as a
centre or a focal point; the pattern must repeat 5x5 times without a visible seam or an obvious
repeated landmark."

Value rail: light-to-mid COLD, and it must stay clearly cooler and harder-crusted than
`floor-desert` (the other light floor): desert is warm bone with fine ripples, winter is blue with
plate crust and buried shapes. The under-ice corpses are the darks that keep the lightness range
open — keep them low-contrast enough that they never compete with an enemy sprite standing on top,
but present enough to be seen when the player looks down.

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
own (V-wrap 12.29 against a 6.28 baseline); the PERIODIC form reached 6.57. State: "put the canvas edges on the BOUNDARIES OF THE CRUST PLATES, a whole number of complete plates
across the width and the height."
Keep the full-bleed, no-magenta and no-focal-landmark sentences of the tiling clause above; only
the "continues into" phrasing is insufficient by itself.
TILEABILITY: a full-bleed tile MUST export `minAlpha` 255 with `fit` 1. The `pixel-art-fx` path applies
fit 0.86, which insets the texture and leaves a transparent margin, so it exports clean, passes its
checks and silently cannot tile. Zero-regeneration fix: reprocess at `--fit 1 --align center --scale fit
--allow-source-edge-touch`. (This test is for FULL-BLEED assets only — a sprite correctly reads
minAlpha 0 at fit 0.86.)

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-winter/floor-winter","rows":1,"cols":1,"profile":"pixel-art-fx","styleProfile":"games/2026-08-29-duskhaul/art/style.json","cellSize":512,"fit":1,"strict":false,"allowSourceEdgeTouch":true}`

`qcExceptions` entry (REQUIRED, append on the first export, not after a retry):
`{ "id": "zone-winter/floor-winter", "reason": "Seamless full-bleed floor tile: the texture must reach every canvas edge for the repeat to work, so there is no magenta key and border/edge-contact QC cannot pass by construction — same documented case as the template's own arena/floor and bg/arena exports." }`

## Border band — `border-winter` (tileable, full-bleed)

Subject: a horizontal band of shattered shrine wall seen from directly overhead — a run of broken
grey-blue shrine masonry drowned in drifted snow: carved panels snapped off at the base, ice
sheeting down the standing faces, a fallen bell half-buried, one gilt fitting still bright, deep
blue snow shadow banked against the near side, icicle fringe along the broken top. Tiles
LEFT-TO-RIGHT only (state: "the left edge continues into the right edge exactly; the band runs the
full width of the canvas"), full-bleed, no magenta, no frame. On a light field the arena edge is
read from the banked blue shadow and the vertical broken masonry — this band must be the coldest
and darkest thing in the zone so "field ends here" is unmistakable at a glance.

STYLE STAYS LOCKED HERE — `styleProfile` is KEPT deliberately. Lead the prompt with this CRITICAL line,
which cleared anchor dominance first try WITH the anchor still attached: "this image contains a run of snow-drowned shrine masonry and NOTHING ELSE — no creature, no figure,
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
own (V-wrap 12.29 against a 6.28 baseline); the PERIODIC form reached 6.57. State: "put the canvas edges on the BOUNDARIES OF THE CRUST PLATES, a whole number of complete plates
across the width and the height."
Keep the full-bleed, no-magenta and no-focal-landmark sentences of the tiling clause above; only
the "continues into" phrasing is insufficient by itself.
TILEABILITY: a full-bleed tile MUST export `minAlpha` 255 with `fit` 1. The `pixel-art-fx` path applies
fit 0.86, which insets the texture and leaves a transparent margin, so it exports clean, passes its
checks and silently cannot tile. Zero-regeneration fix: reprocess at `--fit 1 --align center --scale fit
--allow-source-edge-touch`. (This test is for FULL-BLEED assets only — a sprite correctly reads
minAlpha 0 at fit 0.86.)

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-winter/border-winter","rows":1,"cols":1,"profile":"pixel-art-fx","styleProfile":"games/2026-08-29-duskhaul/art/style.json","cellSize":512,"fit":1,"strict":false,"allowSourceEdgeTouch":true}`

`qcExceptions`: `{ "id": "zone-winter/border-winter", "reason": "Tileable full-bleed border band: horizontal repeat requires edge-to-edge coverage, so magenta-key and edge-contact QC are inapplicable by design (template arena/floor precedent)." }`

## Prop sheet A — `props-winter-a` (3x3, 9 cells)

Cell contract: nine SEPARATE objects, one per cell, centred in the central 65% and floating in flat
`#FF00FF`; overhead-with-slight-tilt camera; pine 2x hero height, torchring hero-height, drifts
knee-high; each an OBSTACLE with a visible footprint EXCEPT `icesheet` (and `webpatch` on sheet B),
which are flat ground surfaces and must clearly NOT look like blockers. Row-major:

1. `torchring` — HAZARD-SAFETY, gale shelter (30% slow outside): five staked torch-amber flames in
   packed snow around a warm slush pool, with a HARD edge where amber light meets cold blue snow; the
   zone's only strongly warm object.
2. `frozencorpse` — haulier frozen upright to the knees, arm raised; thin vertical read THROUGH ice.
3. `wallshard` — snapped shrine panel on edge, scoured blank (NO lettering); flat angular slab, the
   straightest edge here.
4. `icesheet` — HAZARD, slide patch (0.92 friction, r=160): flat grey-cyan ice over dark water, mirror
   sheen with long white glare streaks; no height, no raised edge, never a blocker — the streaks say
   "slick".
5. `drift` — wind-carved snow ridge, crust breaking to blue lee shadow; long low soft horizontal, the
   zone's only soft-edged mass.
6. `frozenwell` — stone well capped with ice, icicles from the coping; squat cylinder.
7. `pine` — dead black pine, needles gone, branches snow-loaded; tall irregular vertical, taller and
   wider-branched than `frozencorpse`; strongest occluder.
8. `sled` — overturned haul sled, runners up, ropes frozen stiff; largest angular mass.
9. `icicle` — ground-grown ice spears from a frozen puddle; small spiky translucent mass.

Families (director-facing — verify at 48px; NOT prompt text): tall verticals (pine, frozencorpse), slabs (wallshard, sled, frozenwell), soft horizontal
(drift), spiky cluster (icicle), ring (torchring), flat ground (icesheet); `torchring` and `icesheet`
are the pair the player's life depends on telling apart.

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-winter/props-winter-a","rows":3,"cols":3,"profile":"pixel-art-fx","cellSize":256,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## Prop sheet B — `props-winter-b` (3x3, 9 cells)

Same cell contract, camera, scale and obstacle rule as sheet A. Row-major:

1. `bellshrine` — shrine bell in a snow-loaded stone arch, green-black bronze with one gilt rim; tall
   arch with a heavy mass inside it.
2. `frostcairn` — stacked cairn welded with hoar ice, frozen skull in the top course; compact stack.
3. `fountain` — shrine fountain frozen mid-pour, a solid cyan-white cascade of ice locked over the
   basin; the zone's most distinctive silhouette, a frozen curve where all else is static mass.
4. `buriedgate` — gate arch buried to the springline, opening choked with ice, a small COLD dusk-violet
   glow deep BEHIND the glaze and read through it (the group's only violet; keep it cyan-leaning,
   never magenta-leaning).
5. `lantern` — hauler's iron lantern on a bent post, one amber flame behind cracked glass; thin
   vertical, a SMALL warm light, deliberately far weaker than sheet A's `torchring`.
6. `webpatch` — the Frost Widow's r=120 slowing web as a world object: a radial disc of thick
   ice-white silk beaded with hoar, flat to the ground with no height; the same radial motif as
   `enemy-widow-attack`, in opaque white strands so it never reads as `icesheet`'s mirror plate.
7. `bonetree` — tree of lashed bone and antler, hoar fur on the joints, rags knotted on; tall spiky
   vertical, pale bone rather than sheet A's black `pine`.
8. `stormstone` — leaning monolith scoured smooth windward, snow banked on the lee, blank surfaces (NO
   lettering); big simple leaning block, heaviest mass here.
9. `shrine-ice` — niche carved into blue ice, gilt offering plate frozen under a glaze; compact block,
   the group's strongest gilt accent, seen through ice.

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-winter/props-winter-b","rows":3,"cols":3,"profile":"pixel-art-fx","cellSize":256,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## Set review

Three `art_review` SET calls: (a) both `-move` enemy sheets plus both prop sheets — silhouette
variety at renderScale 48, plus an explicit check that the Hollow Yeti does NOT sit at the same
lightness as `floor-winter`; (b) `floor-winter` + `border-winter` — the floor's under-ice darks
must keep the lightness range open and the shrine band must be the zone's darkest, coldest value;
(c) the three flat/circular ground reads (`torchring`, `icesheet`, `webpatch`) as one set — they
must be mutually unmistakable in temperature and pattern. Then `sprite_check_palette` with
`profile: games/2026-08-29-duskhaul/art/style.json` on all 10 exports (pass ≤ 36). Report per
`_common.md` to `art/briefs/reports/zone-winter.md`.
