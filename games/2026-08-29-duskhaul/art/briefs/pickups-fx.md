# Group `pickups-fx` — loot atoms (9 sheets)

Read `_common.md` first. Output root: `games/2026-08-29-duskhaul/public/assets/generated/pickups-fx/`.
Profile `pixel-art-fx`, cellSize `128` (fx convention), canvas `1024x1024` / `1:1`, all sheets strict.

**Group identity (verbatim in every prompt of this group):** small grave-goods lying/floating in cold
dusk air, seen from the same 3/4 top-down-ish game angle as the actors. No hands, no character, no
pedestal, no ground. Each object is a single compact silhouette with a heavy 1px black outline, dirty
desaturated metal, and its light coming from itself (gilt) or from behind it (violet) — never from a
scene lamp. Object fills ~55-60% of the cell so the aura/glint has room and never touches a cell edge.
**Anchor: these are FLOATERS — the object keeps a stable hover line (same y-centre) across frames; the
bob is 2-3px, not a jump.** `casket-sparkle` and `chest-open` are grounded but still have NO ground strip.

**Colour code (law, §11):** reward = gilt `#d9a24b`; extraction/arcane = dusk-violet `#5b4bff`; threat =
dried-blood `#c0392b`; hazard = torch-amber `#e8c547`. Gilt is the ONLY warm saturated element on t1-t3;
violet is the only saturated element on t4.

## The four relic tiers must be told apart at renderScale 48

At 48px the player reads AURA COLOUR + AURA WIDTH + SILHOUETTE CLASS, nothing else. These four axes are
fixed and must not be blended (PRD §5.5 tiers Tarnished / Burnished / Gilded / Dread):

| Tier | Aura | Motes | Silhouette class | Value read |
| --- | --- | --- | --- | --- |
| t1 Tarnished | NONE — one 1px dim gilt glint pixel only | 0 | small squat **ring/buckle** — wide, low, hole in the middle | junk |
| t2 Burnished | thin continuous 1px warm gilt halo hugging the outline | 2 slow gilt motes | **pendant/locket on a short chain** — tall narrow teardrop | decent |
| t3 Gilded | 2px gilt halo + 4 hard-edged radiating spark spokes (N/E/S/W cross flare) | 4 gilt motes | **upright idol/skull figure** — tallest, vertical, shouldered | rich |
| t4 Dread | 3px **dusk-violet** aura swallowing the gilt, single red pinprick core | 6 rising violet motes | **wide spiked crown** — widest, jagged top edge | dangerous prize |

t4 is the only cool-aura relic and the only one with a red core: violet-vs-gilt is the primary tell,
crown-vs-ring the secondary. Never give t1 a halo; never give t4 a gilt halo.

## shard-glint — 2x2 (4f loop)
Subject: a single small gilt currency shard — a chipped triangular wedge of gilded temple metal, dull
pitted face, one bright gilt facet.
Frames: (1) dull, only the outline and a dark gilt body; (2) a hard-edged 1px gilt highlight appears on
the top-left facet; (3) the highlight blooms into a 4-pixel gilt cross-glint with two 1px sparks;
(4) glint collapses back to dull. The 1.2s loot-glint cycle of §11.
Silhouette brief: the SMALLEST object in the group — an asymmetric triangular wedge, no hole, no chain,
no aura. Must not be confusable with the round-holed t1 ring.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/pickups-fx/shard-glint","rows":2,"cols":2,"profile":"pixel-art-fx","cellSize":128,"duration":90,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## relic-hover-t1 — 2x2 (4f loop) — Tarnished
Subject: a tarnished pauper's relic — a squat corroded iron finger-ring with a rat-tooth lashed to it by
grey gut cord (PRD §5.5 `r_toothcharm` / `r_rustbuckle` family). Grey-brown pitted metal, almost no
shine; ONE dim gilt glint pixel is the entire reward cue. NO aura.
Frames: (1) hover baseline, glint pixel dark; (2) rises 2px, glint lights dimly; (3) top of the bob (3px
up), glint at its dimmest gilt; (4) sinks back to baseline. Slow tired bob.
Silhouette brief: wide, low, hollow — a clear open hole in the middle with a small nub (the tooth) on the
upper right. Lowest, widest, plainest relic; the only tier with no light around it.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/pickups-fx/relic-hover-t1","rows":2,"cols":2,"profile":"pixel-art-fx","cellSize":128,"duration":140,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## relic-hover-t2 — 2x2 (4f loop) — Burnished
Subject: a burnished relic — an ash locket / thornband pendant hanging from a short broken iron chain of
3 visible links, brass-gilt rubbed bright on the raised edges, dark tarnish in the recesses.
Frames: (1) hover baseline, thin 1px gilt halo dim, 2 gilt motes low beside it; (2) rises 2px, halo
brightens, motes drift up; (3) top of bob, halo at full 1px brightness, motes at the top; (4) sinks,
halo dims, motes gone. Chain swings 1px opposite the bob.
Silhouette brief: TALL NARROW teardrop with a chain stub on top — a vertical mass where t1 is horizontal.
The continuous thin warm halo is its tier tell; it never gets spokes.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/pickups-fx/relic-hover-t2","rows":2,"cols":2,"profile":"pixel-art-fx","cellSize":128,"duration":140,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## relic-hover-t3 — 2x2 (4f loop) — Gilded
Subject: a gilded relic — a marrow idol / gilt skull fetish: a small standing figurine of gilded bone
and wire with a skull head and squared shoulders, heavy gilt on the crown and shoulders, black tarnish
in the eye sockets.
Frames: (1) hover baseline, 2px gilt halo, the 4 cross spokes short; (2) rises 2px, spokes extend, 4 gilt
motes lift from the base; (3) top of bob, halo widest and spokes at full length (hard-edged, 2px thick,
straight N/E/S/W — no soft rays); (4) sinks, spokes retract to stubs.
Silhouette brief: the TALLEST relic, unmistakably a little upright figure with a head and shoulders where
t1/t2 are jewellery. Wide 2px halo + straight cross spokes is the tier tell. Spokes must stay inside the
central 65% safe area at full extension.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/pickups-fx/relic-hover-t3","rows":2,"cols":2,"profile":"pixel-art-fx","cellSize":128,"duration":140,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## relic-hover-t4 — 2x2 (4f loop) — Dread
Subject: the Warden's dread relic — a wide circlet of black iron with 5 jagged upward spikes (PRD §5.5
`r_dreadcrown`), thin worn gilt inlay along the band, a single red pinprick gem at the centre front. The
gilt is nearly drowned by a dusk-violet 3px aura pressed tight to the outline.
Frames: (1) hover baseline, violet aura at its thinnest, red core dim; (2) rises 2px, aura swells to 3px,
3 violet motes rise; (3) top of bob, aura at full 3px, red core at its brightest pinprick, 6 violet motes
spread upward; (4) sinks, aura contracts, motes fade. The 0.8s arcane breathe of §11.
Silhouette brief: the WIDEST relic and the only one with a jagged upper edge — a spiked horizontal band,
the opposite mass of t3's vertical figure. Cool violet aura + red core: it must never read as gilt.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/pickups-fx/relic-hover-t4","rows":2,"cols":2,"profile":"pixel-art-fx","cellSize":128,"duration":140,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## chest-open — 2x2 (4f, non-loop, held last frame)
Subject: a coffin-chest — a short stone-and-iron child-sized sarcophagus with a hinged slab lid, rusted
banding, moss in the seams. Grounded (no hover), NO ground strip beneath it.
Frames: (1) shut, dead grey stone, one 1px gilt seam of light escaping the lid crack; (2) lid cracks 4px,
gilt light spills upward across the lid face; (3) lid thrown back on the hinge, interior a bright gilt
pool, 3 gilt shards and 1 relic glinting inside, 4 gilt sparks above the mouth; (4) settled open — lid
back, interior still gilt-lit but calmer, contents visible. Held on frame 4 (chest stays open in world).
Silhouette brief: the LARGEST, blockiest, most rectangular object in the group — a heavy horizontal box
that grows a raised lid flap in the top-left by the final frame. Nothing else here is rectilinear.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/pickups-fx/chest-open","rows":2,"cols":2,"profile":"pixel-art-fx","cellSize":128,"duration":110,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## casket-sparkle — 1x2 (2f loop)
Subject: the casket pin (PRD §5.6, the one secure slot) — a small gilt-and-black reliquary casket badge:
a rounded gilt-edged black box with a tiny gilt keyhole clasp on the front and a pinned gilt hasp at the
top. Reads as "kept safe", not as loot to grab.
Frames: (1) resting — dull gilt edging, keyhole dark; (2) sparkle — one 3-pixel gilt star flares off the
top-right corner of the gilt edging and the keyhole lights 1px gilt. Two-frame heartbeat, nothing moves
position between frames (the sparkle is the only delta).
Silhouette brief: a small ROUNDED-CORNER box with a hasp nub on top — smaller and rounder than the
chest's slab rectangle, more solid and closed than any relic. The only object with a keyhole.
Note: 1x2 source cells are non-square — no `scaleProfile`, gates only (see `_common.md`).
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/pickups-fx/casket-sparkle","rows":1,"cols":2,"profile":"pixel-art-fx","cellSize":128,"duration":160,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## xp-mote — 2x2 (4f loop) — INTEGRATOR ADDITION
Why it exists: `objects/xporb.ts` is a GAMEPLAY pickup and had no art slot at all (the template's
scaffold `xpOrb` slot is gone from the manifest). §11 forbids procedural or template art for a
gameplay pickup, so it is generated. It must NOT be confusable with `shard-glint`, because the two
drop side by side from every kill and mean different things: gilt = shards you carry and can LOSE,
violet = experience you keep.
Subject: a soul mote — the scrap of will a dead thing leaves behind: a knuckle-sized chipped grey
bone splinter wrapped in a knot of cold hard-edged pixel light. The light is the subject; the bone
core is a 4-5px dark anchor inside it so the mote still has a silhouette when the glow is dim.
Frames: (1) hover baseline, light knot at its thinnest 1px, core dim; (2) rises 2px, knot swells to
2px, two 1px flecks lift off the top; (3) top of the bob (3px up), knot at full 3px with four short
1px sparks on the diagonals, core brightest; (4) sinks back to baseline, knot contracts, flecks gone.
Silhouette brief: the ROUNDEST and SMALLEST mass in the group and the one with the highest
light-to-body ratio — a compact circular bloom around a tiny dark core. No facet (unlike the shard's
triangular wedge), no hole (t1), no chain (t2), no head-and-shoulders (t3), no spikes (t4).
Colour: dusk-violet `#5b4bff` arcane light per §11, CYAN-LEANED at the core toward `#6fd6ff`. This is
the second cool-only pickup after t4 — t4 is a WIDE SPIKED CROWN with a red pinprick core, this is a
small round mote with NO red anywhere. No gilt on it at all.
Key note (`_common.md`): the chroma key eats bright violet and pale rose, which is exactly what this
asset is made of — hence the cyan lean AND the explicit `threshold`/`edgeThreshold` 150 recovery in
the marker. pickups-fx binds no `scaleProfile`, so those params are honoured (they would be silently
overwritten on a profile-bound sheet).
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/pickups-fx/xp-mote","rows":2,"cols":2,"profile":"pixel-art-fx","cellSize":128,"duration":100,"threshold":150,"edgeThreshold":150,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## bolt-arcane — 1x1 (static) — INTEGRATOR ADDITION
Why it exists: `objects/projectile.ts` is the player's and the enemies' GAMEPLAY projectile and had no
art slot (`TEXTURE.bullet` was a template scaffold key). One static texture is correct, not a sheet:
the consumer rotates the texture along the travel vector (`setRotation(atan2(vy, vx))`) and recolours
it per owner — hostile shots get a dried-blood tint, crits a gilt tint, friendly shots ship untinted.
CONSEQUENCE FOR THE ART, and it is the one thing that must not be got wrong: **the bolt points RIGHT**
(rotation 0 = travelling right), and the base art must be BRIGHT and NEARLY NEUTRAL-COOL so a
multiply tint reads. A saturated violet bolt goes muddy under a red tint; a pale cyan-white one goes
red, gold or stays cold correctly.
Subject: the Duskhauler's arcane bolt — a short hard-edged dart of channelled dusk light travelling
right: a pale cyan-white 3px core lozenge with a chisel point on the RIGHT end, a two-step dithered
dusk-violet fringe around it, and a 3-pixel stepped tail trailing to the LEFT that thins to 1px. Hard
pixel steps only, no soft bloom (style `materials.energy`: "a bright core and one dithered fringe
step, never a soft bloom"). No shaft, no fletching, no arrowhead — this is light, not an arrow.
MEASURED CONTAINMENT (concrete boxes beat percentages, `_common.md`): the bolt occupies a box about
300px wide by 210px tall, centred in the 1024x1024 canvas, leaving a wide band of flat magenta on all
four sides. That ~1.4:1 drawn box is deliberate: the consumer displays the square texture at
`size*2.2` by `size`, which stretches the drawn box to roughly 3:1 on screen — a bolt. Drawing it at
3:1 in source would ship a 6.6:1 streak.
Silhouette brief: the only DIRECTIONAL, only pointed, only horizontally-tapered asset in the group —
everything else here is a compact centred lump. Asymmetry along the horizontal axis (point right, tail
left) is the whole read; a symmetrical lozenge is a failure.
Colour: pale cyan-white core `#e8e0d0` pushed cool, dusk-violet `#5b4bff` fringe. No gilt, no red —
those are the TINTS the runtime applies, and baking them in makes crit and hostile shots unreadable.
Key note: same violet/pale-rose key risk as `xp-mote`; same 150/150 recovery in the marker.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/pickups-fx/bolt-arcane","rows":1,"cols":1,"profile":"pixel-art-fx","cellSize":128,"threshold":150,"edgeThreshold":150,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

**Order:** generate `shard-glint` first and accept it — it fixes how gilt light is drawn for the whole
group; then t1 → t2 → t3 → t4 in order so each tier can be compared against the previous one; then
`chest-open` and `casket-sparkle`. The two integrator additions come last and are judged against
`shard-glint` (which they must NOT resemble) rather than against each other.

**Set review:** one `art_review` SET call across all four `relic-hover-t*` sheets — this is the group's
critical gate: if the four auras/silhouettes are not separable at renderScale 48, regenerate the offending
tier (change ONE axis: aura width, aura hue, mote count, or silhouette class). Then a second SET call
across `shard-glint` + `chest-open` + `casket-sparkle` for value structure. Report per `_common.md`.
