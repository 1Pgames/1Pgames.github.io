# Group `zone-desert` — Sorrow Dunes (9 sheets)

Read `_common.md` first. Output root:
`games/2026-08-29-duskhaul/public/assets/generated/zone-desert/`.

Arena is an OPEN FIELD, 1600x1600, seen straight-down top-down. No authored room geometry: the
floor TILES, the border band runs the field edge, every prop cell is a scattered instance that
OCCLUDES and BLOCKS. Props are obstacles with real mass and a readable footprint, never
decoration.

**Zone value/colour trick:** desert is the only INVERTED zone — the field is LIGHT and the shapes
on it are DARK. Bone-white bleached sand holds the light band while every prop and every actor
throws a hard-edged, high-contrast dusk-VIOLET shadow with a crisp boundary (a single savage
overhead sun; no soft falloff anywhere). That violet shadow is the zone's signature: castle has
amber point-light on dark stone, outlands has no shadows at all, winter has soft cold-cyan
shadows, desert has hard violet ones. Second signature: everything man-made is SUNKEN — statuary,
lintels and obelisks are drowned to the shoulder in sand, cut off by a sand line rather than
standing on it.

Because the field is light, hostiles must read as DARK masses here — deepen the outlines and keep
enemy bodies in the mid-to-dark band. Palette rails: bone-white sand `#e8e0d0`-ward for the field,
dusk violet `#5b4bff` desaturated toward plum for every shadow, weathered grey-brown for stone,
gilt `#d9a24b` on the scarab and shrine metal, dried blood `#c0392b` only on hostile eyes and
windup light, torch amber `#e8c547` only on the scorch ground-tell. No green, no cyan.

**Value contract (include in every ACTOR and PROP prompt; the tiles keep their own value
instructions above):** about half dark, about a third a readable MID tier, and a real LIGHT tier
covering roughly one sixth carries the brightest torch-amber and pale bone-grey highlights as BROAD
BRIGHT PATCHES, not a thin one-pixel rim; the core shadow does not swallow the whole body. This is art
direction, not a gate — apply it going forward, but do NOT reroll an already-accepted sheet to chase
the light tier.

Desert exception: this is the INVERTED zone (light bone-white field, dark figures), so `floor-desert`
and `border-desert` carry the MIRROR risk — value-tier-absent:DARK — and are fixed by protecting the
violet trough and lee darks, never by adding lights. On desert ACTORS the light tier is specifically
the sun-struck TOP PLANES, not an overall lightening.

## Enemy sheets (5)

All hostile: red pinprick eyes, NO green. Generate `-move` FIRST with
`"writeScaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-desert/<char>-scale.json","profileName":"<char>"`, LOOK at it and accept identity/proportions/feet
line, then the siblings with
`"scaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-desert/<char>-scale.json"`
plus `"maxBodyScaleCv":0.08,"maxAnchorYStd":0.05,"maxProfileScaleDrift":0.08`.

**Silhouette contract (repeat the character's own line in its prompt):** leech = a long limbless
sinuous S, smooth and segmented, no hard edges anywhere · scarab = a small hard-shelled oval,
compact and symmetrical, six spiky legs breaking its outline. At 48px one is a long soft curve and
the other a tight bristled bead, with a 3x length difference. If they read alike, the silhouette
brief gets rewritten, not the colour.

Both are DARK on a light field: the leech is wet plum-grey, the scarab is a dark carapace with
gilt inlay — never a pale body.

| id | char | rows x cols | dur | action + frames | material/colour notes |
| --- | --- | --- | --- | --- | --- |
| enemy-leech-move | leech (base) | 2x2 | 130 | sand-swim, body half-submerged and rippling (NO ground patch — only the creature and the sand it displaces, kept attached to the body): (1) S-curve leaning left (2) straightening, head forward (3) S-curve leaning right (4) gathering, head dipped | Dune Leech: a limbless segmented sand-swimmer, wet plum-grey hide with pale banding between segments, no eyes visible while swimming, a violet cast shadow ONLY where the body arches clear of the sand; long sinuous S silhouette |
| enemy-leech-attack | leech | 2x2 | 90 | surfaces mouth-first: (1) sand bulges, a hard-edged red glow spreading up through it from beneath, bright core and one dithered fringe step — frame 1 is the BRIGHTEST and must read before any motion (2) head bursts up, mouth still shut (3) maw opening TOWARD THE CAMERA as a ring-toothed rosette, red gullet down its centre, the body staying a flat ribbon (4) recoils, mouth closing | the maw is the whole payload: rings of hooked teeth, red inside; the reared body must stay inside the cell — coil the tail rather than crossing the boundary |
| enemy-leech-death | leech | 2x2 | 100 | (1) body goes rigid, arched (2) hide splits along a seam (3) deflates, fluid dark on the sand (4) slack empty skin sinking into sand | the deflated skin must still read as a long curve, not a blob |
| enemy-scarab-move | scarab (base) | 2x2 | 110 | fast skitter, faces right: (1) left legs reach (2) mid-stride, body low (3) right legs reach (4) gather, body bobs up | Gilt Scarab: a dark chitin beetle the size of a shield, carapace near-black with gilt inlay veins that catch the sun, mandibles, six spiky legs, red eye-pair under the shell rim; compact hard oval silhouette broken by leg spikes; the gilt is why it drops shards — it must LOOK like it is full of treasure |
| enemy-scarab-death | scarab | 2x2 | 90 | cracks open spilling shards: (1) shell splits down the seam (2) halves lever apart, gilt shards spraying (3) shards fanned out, body collapsing (4) empty split husk, shards settled | shards stay inside the safe area; the gilt spray is the reward read — make it the brightest event on the sheet |

Literal markers, one per sheet — generate in this order (`-move` first, accept, then its siblings):

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-desert/enemy-leech-move","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":130,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","writeScaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-desert/leech-scale.json","profileName":"leech"}`

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-desert/enemy-leech-attack","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":90,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","scaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-desert/leech-scale.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05,"maxProfileScaleDrift":0.08}`

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-desert/enemy-leech-death","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":100,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05}`

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-desert/enemy-scarab-move","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":110,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","writeScaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/zone-desert/scarab-scale.json","profileName":"scarab"}`

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-desert/enemy-scarab-death","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":90,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05}`

If a `-move` export reports its scale-profile path differently, use the exact reported path.

The `-death` markers deliberately carry NO `scaleProfile` and NO `maxProfileScaleDrift`: drift is
measured on BBOX HEIGHT, so gating height-invariance on an action whose whole purpose is to collapse is a
category error. The intra-sheet `maxBodyScaleCv` / `maxAnchorYStd` gates still hold four frames to one
character at one scale while letting the silhouette fall. Do NOT re-add the gate.

## Floor tile — `floor-desert` (seamless, full-bleed)

Subject: bone-white dune sand seen straight down from directly overhead — a seamless repeating
tile of bleached fine sand in low wind ripples, drifts of coarser grit, a salt crust cracking in
patches, scattered small bleached bones and one broken potsherd pressed flush into the surface,
faint darker plum-violet in the ripple troughs. Even overall lighting, NO vignette, NO single
light source, NO props, NO figures, NO text.

Tiling clause (state verbatim in the prompt): "The image is a SEAMLESS REPEATING TEXTURE: the
left edge continues into the right edge and the top edge into the bottom edge exactly. Fill the
entire canvas edge to edge with the texture — full-bleed, NO magenta background, no border, no
frame, no drop shadow, no lighting falloff at the edges. Do not place any feature that reads as a
centre or a focal point; the pattern must repeat 5x5 times without a visible seam or an obvious
repeated landmark."

Value rail: the LIGHTEST floor of the four and the one that inverts the game's figure/ground —
hold it in the light band, and put the entire lightness range into the ripple troughs (plum-violet
darks) so it does not read as blank paper. It must be distinguishable from `floor-winter` (also
light) by HUE and pattern: desert is warm bone with fine directional ripples, winter is cold blue
with a hard crust and buried shapes.

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
own (V-wrap 12.29 against a 6.28 baseline); the PERIODIC form reached 6.57. State: "put the canvas edges exactly ONE FULL WIND-RIPPLE PERIOD apart, a whole number of ripple
crests across the width and the height."
Keep the full-bleed, no-magenta and no-focal-landmark sentences of the tiling clause above; only
the "continues into" phrasing is insufficient by itself.
TILEABILITY: a full-bleed tile MUST export `minAlpha` 255 with `fit` 1. The `pixel-art-fx` path applies
fit 0.86, which insets the texture and leaves a transparent margin, so it exports clean, passes its
checks and silently cannot tile. Zero-regeneration fix: reprocess at `--fit 1 --align center --scale fit
--allow-source-edge-touch`. (This test is for FULL-BLEED assets only — a sprite correctly reads
minAlpha 0 at fit 0.86.)

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-desert/floor-desert","rows":1,"cols":1,"profile":"pixel-art-fx","styleProfile":"games/2026-08-29-duskhaul/art/style.json","cellSize":512,"fit":1,"strict":false,"allowSourceEdgeTouch":true}`

`qcExceptions` entry (REQUIRED, append on the first export, not after a retry):
`{ "id": "zone-desert/floor-desert", "reason": "Seamless full-bleed floor tile: the texture must reach every canvas edge for the repeat to work, so there is no magenta key and border/edge-contact QC cannot pass by construction — same documented case as the template's own arena/floor and bg/arena exports." }`

## Border band — `border-desert` (tileable, full-bleed)

Subject: a horizontal band of high dune ridge seen from directly overhead — a steep crest of
bone-white sand with a knife-sharp lee edge dropping into deep hard violet shade, wind streaks
combing up the windward face, a sunken lintel and a ribcage breaking the crest, salt crust along
the top. Tiles LEFT-TO-RIGHT only (state: "the left edge continues into the right edge exactly;
the band runs the full width of the canvas"), full-bleed, no magenta, no frame. The arena edge
here is read from the SHADOW: the violet lee band is the darkest value in the zone and reads as
"you cannot climb this" at a glance.

STYLE STAYS LOCKED HERE — `styleProfile` is KEPT deliberately. Lead the prompt with this CRITICAL line,
which cleared anchor dominance first try WITH the anchor still attached: "this image contains a high dune ridge seen from directly overhead and NOTHING ELSE — no creature, no figure,
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
own (V-wrap 12.29 against a 6.28 baseline); the PERIODIC form reached 6.57. State: "put the canvas edges exactly ONE FULL WIND-RIPPLE PERIOD apart, a whole number of ripple
crests across the width and the height."
Keep the full-bleed, no-magenta and no-focal-landmark sentences of the tiling clause above; only
the "continues into" phrasing is insufficient by itself.
TILEABILITY: a full-bleed tile MUST export `minAlpha` 255 with `fit` 1. The `pixel-art-fx` path applies
fit 0.86, which insets the texture and leaves a transparent margin, so it exports clean, passes its
checks and silently cannot tile. Zero-regeneration fix: reprocess at `--fit 1 --align center --scale fit
--allow-source-edge-touch`. (This test is for FULL-BLEED assets only — a sprite correctly reads
minAlpha 0 at fit 0.86.)

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-desert/border-desert","rows":1,"cols":1,"profile":"pixel-art-fx","styleProfile":"games/2026-08-29-duskhaul/art/style.json","cellSize":512,"fit":1,"strict":false,"allowSourceEdgeTouch":true}`

`qcExceptions`: `{ "id": "zone-desert/border-desert", "reason": "Tileable full-bleed border band: horizontal repeat requires edge-to-edge coverage, so magenta-key and edge-contact QC are inapplicable by design (template arena/floor precedent)." }`

## Prop sheet A — `props-desert-a` (3x3, 9 cells)

Cell contract: nine SEPARATE objects, one per cell, centred in the central 65% and floating in flat
`#FF00FF`; overhead-with-slight-tilt camera; obelisk 2x hero height, urns knee-high, skulls ankle-high;
each an OBSTACLE with a visible footprint. ZONE RULE: standing props carry an ATTACHED hard violet cast
shadow touching the base as part of the silhouette — never detached, never a strip past the object.
Row-major:

1. `statuehead` — colossal carved head sunk to the brow in sand, nose sheared; big rounded mass cut by
   the sand line, the zone's signature.
2. `well` — dry stone well, coping cracked, shaft solid black; squat cylinder, the darkest hole here.
3. `canopy` — SHADE PROP, the scorch shelter: tattered bleached cloth on four leaning poles over a
   generous violet shade pool, the most inviting dark here.
4. `ribs` — bleached ribcage arch half-buried, pale on pale, split only by violet inner shade; wide
   arch, lowest contrast — keep the outline heavy for 48px.
5. `pit` — HAZARD, r=140, slows 35%: concentric slumping sand rings drawn inward to a dark plum throat,
   a thin rim of torch-amber light on the outer ring; the rings read as MOTION toward the centre.
6. `obelisk` — tall sunken obelisk leaning off vertical, scoured blank (NO lettering); tallest mass.
7. `urns` — three funerary urns, one shattered spilling ash and a gilt trinket; small grouped mass.
8. `palm` — dead palm snapped mid-trunk, dry grey fronds; tall organic thin vertical, NOT straight.
9. `skulls` — CLUMPED pile of bleached skulls and bones, ankle-high, one solid silhouette.

Families (director-facing — verify at 48px; NOT prompt text): tall verticals (obelisk, palm), rounded blocks (statuehead, well), arches (ribs, canopy), a
depression (pit), low clumps (urns, skulls); `pit` alone goes DOWN.

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-desert/props-desert-a","rows":3,"cols":3,"profile":"pixel-art-fx","cellSize":256,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## Prop sheet B — `props-desert-b` (3x3, 9 cells)

Same cell contract, camera, scale, attached-violet-shadow rule and obstacle rule as sheet A. Row-major:

1. `wreck` — hauler wagon sunk to the axles, canvas shredded, frame ribs bare; largest angular mass.
2. `sunbanner` — sun-cult banner on a leaning pole, bleached cloth with a faded gilt disc (a plain
   circle, NO lettering); tall thin vertical with a flag mass on top.
3. `mound` — low burial mound of heaped sand, bone marker in the crest; long low soft horizontal, the
   only soft-edged mass.
4. `cistern` — sunken cistern mouth, square coping flush with the sand, black water far below; flat
   square frame at ground level.
5. `lintel` — carved doorway lintel and posts buried to mid-post, hard violet shade in the opening;
   wide rectangular frame, the clearest sunken-architecture read.
6. `salt` — SCORCH GROUND TELL: blistered salt crust, pale crazed plates lifting over cracked plum-dark
   ground, thin lines of torch-amber light shimmering in the cracks; flat, no height.
7. `vulture` — stone vulture on a low plinth, one wing broken at the shoulder; compact hunched mass
   with a broken asymmetric outline.
8. `awning` — SHADE PROP (second): stone-and-hide awning off a buried wall stub, deep violet shade pool
   beneath; same shade job as `canopy` but rigid and angular where that one slumps.
9. `shrine-sun` — bleached niche with a gilt sun disc and an offering bowl; compact block, the group's
   strongest gilt accent.

`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/zone-desert/props-desert-b","rows":3,"cols":3,"profile":"pixel-art-fx","cellSize":256,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## Set review

Two `art_review` SET calls: (a) both `-move` enemy sheets plus both prop sheets — silhouette
variety at renderScale 48, AND an explicit check that enemy bodies sit DARKER than
`floor-desert`: on a light field a pale enemy disappears; (b) `floor-desert` + `border-desert`
together — the floor must not collapse to blank light values and the ridge's violet lee must be
the zone's darkest value. Then `sprite_check_palette` with
`profile: games/2026-08-29-duskhaul/art/style.json` on all 9 exports (pass ≤ 36). Report per
`_common.md` to `art/briefs/reports/zone-desert.md`.
