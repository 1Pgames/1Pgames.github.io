# Group `gates-collapse` — extraction gates + Collapse ring (5 sheets)

Read `_common.md` first. Output root: `games/2026-08-29-duskhaul/public/assets/generated/gates-collapse/`.
Profile `pixel-art-fx`, cellSize `128` (fx convention), canvas `1024x1024` / `1:1`.

These are the highest-stakes readability assets in the game: the player decides whether to run across the
arena based on a 48px glance at a gate (PRD §2 gate schedule, §13 gate juice). Because they are upscaled
in world space, draw them CHUNKY — big forms, few internal details, no fine filigree that dies at export.

**Shared identity (verbatim in every gate prompt):** the extraction gate — a squat free-standing stone
archway of four heavy blue-grey ashlar blocks per leg and a keystone lintel, ~1.3x as tall as it is wide,
weathered, moss in the joints, a plain iron-strapped barred grille filling the opening. Seen straight-on
in the same 3/4 game angle as the actors. NO ground beneath it, no plinth, no step, no cast shadow (state
this twice). Arch fills ~62% of the cell so flame and light stay inside the safe area.

**Three states must be told apart at a single glance (PRD §11):**

| State | Stone | Opening | Light | One-word read |
| --- | --- | --- | --- | --- |
| closed | DEAD grey, no light on it at all | grille intact, bars unbroken | none | "shut" |
| open | blocks rim-lit dusk-violet | grille gone, opening full of flame | dusk-violet `#5b4bff` breathing, 0.8s | "go" |
| closing | blocks rim-lit torch-amber | grille sliding back down over the flame | torch-amber `#e8c547` flickering | "hurry" |

Hue is the primary tell (grey / violet / amber), the grille is the secondary tell (present / absent /
descending). Never put violet on the closed gate and never put violet on the closing gate — an amber gate
means the window is dying (last 30s) and the palette must say so alone.

## gate-closed — 1x1 (static)
Subject: the shared arch, fully dead. Every stone a cold desaturated plum-grey, damp but unlit; the iron
grille whole, all bars present, rust streaks running down the bars; the opening behind the bars is flat
black emptiness with zero glow. One dry dead bramble at the base of the left leg for silhouette interest.
Silhouette brief: a solid closed rectangle-with-an-arched-top mass — the grille reads as a filled hatched
block, so the whole shape is HEAVY and SOLID. Its opposite is `gate-open`, whose opening is a bright hole.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/gates-collapse/gate-closed","rows":1,"cols":1,"profile":"pixel-art-fx","cellSize":128,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## gate-opening — 2x3 (6f, non-loop, held last frame)
Frames — the grind (PRD §11 "opening 6f grind"), identical arch position in all six, only light and
grille change: (1) dead grey exactly as `gate-closed`; (2) a single 1px dusk-violet seam ignites along the
keystone joint, dust flecks fall; (3) the grille has ground 1/3 of the way UP into the lintel, violet
light leaks through the widening gap, the exposed inner jambs pick up a 1px violet rim; (4) grille 2/3 up,
violet light floods the lower opening, block edges rim-lit violet; (5) grille fully retracted into the
lintel, the opening is a violet void with the first two hard-edged violet flame tongues rising; (6)
settled open — flame filling the opening, block rims violet, matching `gate-open` frame 1 exactly so the
animations chain without a pop.
Silhouette brief: the outer arch mass never changes; the ANIMATION is the grille climbing and the hole
brightening. Frame 6 must be pixel-compatible with `gate-open` frame 1.
Note: 2x3 source cells are non-square — no `scaleProfile`, gates only (`_common.md`).
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/gates-collapse/gate-opening","rows":2,"cols":3,"profile":"pixel-art-fx","cellSize":128,"duration":110,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","maxBodyScaleCv":0.08,"maxAnchorYStd":0.05}`

## gate-open — 2x2 (4f loop)
Frames — the 0.8s breathe of §11, no grille at all: (1) violet flame low in the opening, block rims dim
violet; (2) flame rises to half the arch height, rims brighter, 2 violet embers lift; (3) flame at full
height licking the keystone, block rims at their brightest violet, 4 embers; (4) flame subsides. Hard-
edged chunky pixel flame in 3 violet values (deep indigo core, mid violet body, pale lilac tips) — no
soft gradient, no glow bloom, no smoke.
Silhouette brief: an arch with a BRIGHT OPEN HOLE — the inverse of `gate-closed`'s filled block. At 48px
the violet hole is the whole message. Embers stay inside the safe area and never cross a cell boundary.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/gates-collapse/gate-open","rows":2,"cols":2,"profile":"pixel-art-fx","cellSize":128,"duration":130,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## gate-closing — 2x2 (4f loop) — the ≤30s warning
Frames — an anxious amber stutter, NOT a smooth close (this loops for the whole last 30s of the window):
(1) the iron grille hangs a quarter of the way down out of the lintel, the flame behind it guttering
torch-amber, block rims amber; (2) grille jolts 3px lower, flame dips to half height and goes dark amber,
rims dim; (3) grille jolts back up 1px (the mechanism fighting), flame flares bright amber with 3 amber
sparks, rims at their brightest amber; (4) grille settles, flame low and thin. All four frames keep the
grille in the UPPER THIRD of the opening — the gate never actually shuts in this loop.
Silhouette brief: same arch, but the opening is now PARTLY BARRED — a bright hole with black bar teeth
biting down from the top edge. That descending tooth row plus the amber hue is the tell versus `gate-open`.
The flame is amber here; a single violet pixel in this sheet is a defect.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/gates-collapse/gate-closing","rows":2,"cols":2,"profile":"pixel-art-fx","cellSize":128,"duration":110,"styleProfile":"games/2026-08-29-duskhaul/art/style.json"}`

## collapse-ring — 2x2 (4f loop), HORIZONTALLY TILEABLE — `strict:false`
Subject: one segment of the Collapse wall (PRD §2/§13) — a vertical band of rolling dusk-fire that the
runtime repeats side by side around a shrinking circle. NOT an arch, NOT a ring: a straight vertical
curtain segment, full cell height, roughly one third of the cell wide, centred.
Frames: (1) flame crest low, a dark ember base at the bottom; (2) crest rolls up and to the right, ember
base brighter; (3) crest at full height, hard pale-lilac tips, ash flecks lifting; (4) crest rolls down
and to the right, base darkest — a 4-frame rightward roll so adjacent tiles read as one moving wall.
Colour: dusk-violet `#5b4bff` body with a dried-blood `#c0392b` heat line at the very base (this is the
one place threat-red touches the violet — the Collapse is death, not extraction).
**Tiling contract:** the flame TOUCHES the top and bottom cell edges and its left and right silhouette
edges are identical in every frame, so copies butt seamlessly. State in the prompt: "the flame runs off
the top and bottom of each cell and its left and right profiles are identical so copies tile seamlessly
side by side". This deliberate edge contact is why the export is `strict:false`.
Silhouette brief: the only NON-ARCHITECTURAL, non-enclosed shape in the group — a tall straight ragged-
topped curtain. Cannot be mistaken for a gate at any size.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/gates-collapse/collapse-ring","rows":2,"cols":2,"profile":"pixel-art-fx","cellSize":128,"duration":90,"styleProfile":"games/2026-08-29-duskhaul/art/style.json","strict":false}`
**Required on the first attempt** (skill rule: any `strict:false` export needs the entry) — append to
`art/manifest.json.qcExceptions[]`:
`{ "id": "gates-collapse/collapse-ring", "reason": "Seamless vertical dusk-fire curtain segment: the flame must touch the top, bottom and side cell edges to tile around the Collapse circle; strict:false by design (template bg/arena and the zone floor tiles are the precedent)." }`
The manifest row itself carries no `strict` flag — hand this line to the ArtDirector with the group report;
do not edit the manifest from the generation agent beyond appending this exception.

**Order:** `gate-closed` FIRST — accept the arch (stone forms, grille, proportions) as the group master,
then pass the accepted `gate-closed` frame as the next `input` image on `gate-opening`, `gate-open` and
`gate-closing` ("Image 3 fixes this exact archway's stone forms, block count and proportions; change only
the grille position and the light"). `collapse-ring` last and independently.

**Set review:** one `art_review` SET call across `gate-closed` + `gate-open` + `gate-closing` sheets — the
gate is only accepted if the three states separate at renderScale 48 by hue AND by grille state. Then
inspect `collapse-ring` by tiling three copies side by side and looking for a visible seam. Report per
`_common.md`.
