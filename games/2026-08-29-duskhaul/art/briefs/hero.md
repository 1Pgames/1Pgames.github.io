# Group `hero` — the Duskhauler (6 sheets)

Read `_common.md` first. Output root: `games/2026-08-29-duskhaul/public/assets/generated/hero/`.

**Identity (verbatim in every prompt of this group):** the Duskhauler — a skeletal grave-robbing
revenant: mummified skull face with two red pinprick eyes deep in a ragged moss-green hood; tattered
moss-green cloak with a torn dripping hem and a thin gloam-green rim light on the silhhouette; bare bone
hands and forearms; rust-brown leather straps and a tarnished round medallion at the chest; a bulging
brown leather loot-sack slung on the left hip spilling a glint of gilt; dark wrapped legs and boots.
3/4 front view, faces slightly right. Standing height fills ~65% of the cell.

**Silhouette brief:** upright but hunched forward at the shoulders; the hood peak, the sagging cloak hem
and the hip sack are the three silhouette landmarks. Nothing else in the game wears green.

**Order:** generate `hero-idle` FIRST, accept it, then the rest. Non-NxN sheets (run/hurt/death/extract)
use gates + anchor guide, never `scaleProfile` (see `_common.md`).

## hero-idle — 2x2, base action
Frames: (1) weight settled, shoulders low; (2) chest rises, hood tips 1px up; (3) shoulders lift 2px,
sack sways; (4) settle back down — the 2px dead-stutter breathing loop.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/hero/hero-idle","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":150,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","writeScaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/hero/hero-scale.json","profileName":"hero"}`

## hero-run — 2x3 (6f)
Frames: (1) push-off right leg, cloak trails; (2) full stride, sack swings back; (3) contact left,
body dips; (4) push-off left; (5) full stride opposite, cloak snaps; (6) contact right, dip. Hunched
loping run, arms low, lantern-side sack bouncing.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/hero/hero-run","rows":2,"cols":3,"profile":"pixel-art-body","cellSize":256,"duration":110,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05}`

## hero-hurt — 1x2 (2f, non-loop)
Frames: (1) full-body bone-white flash, head snapped back; (2) recoil slump, hood fallen forward, red
eyes flaring.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/hero/hero-hurt","rows":1,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":90,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05}`

## hero-channel — 2x2 (4f loop)
Frames: kneeling extraction rite — (1) knees down, palms open above the ground; (2) dusk-violet
hard-edged pixel glow kindles between the hands; (3) glow rises past the hood, runic flecks; (4) glow
ebbs back. The violet light is the ONLY saturated element; keep it off the cell edges.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/hero/hero-channel","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":140,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","scaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/hero/hero-scale.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05,"maxProfileScaleDrift":0.08}`

## hero-death — 2x3 (6f, non-loop)
Frames: (1) staggers, hand to chest; (2) knees buckle; (3) drops to knees, sack tips; (4) gilt trinkets
spill; (5) torso folds face-down; (6) still heap, red eyes gone dark. Held last pose.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/hero/hero-death","rows":2,"cols":3,"profile":"pixel-art-body","cellSize":256,"duration":100,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05}`

## hero-extract — 2x3 (6f, non-loop)
Frames: (1) standing, violet light licks up from the feet; (2) lower legs dissolve into rising violet
pixels; (3) waist gone, sack clutched tight; (4) torso streaming upward; (5) only hood and red eyes in
a violet column; (6) sparse violet motes. Dissolve upward, silhouette last to go; motes stay inside the
safe area.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/hero/hero-extract","rows":2,"cols":3,"profile":"pixel-art-body","cellSize":256,"duration":110,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05}`

**Set review:** `art_review` across hero-idle + hero-run + hero-channel sheets (value structure + green
rim consistency). Report per `_common.md`.
