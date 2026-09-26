# props-v3b — generation calls (xai-oauth / grok-imagine-image, 1024x1024, 1:1)

All four calls use the same shape. There is no `OMP_SPRITE_EXPORT` marker: the raws are exported through
`process-sheet.sh`, which is how ArtWorld exported props-v2 (with the marker, the style profile binds the
chroma guard, and that guard keeps pink halo).

- `input_paths`: [`public/assets/generated/props-v2/props-<zone>-c/raw-provider.jpg` (Image 1: the zone's accepted prop rendering, materials, scale), `art/refs/vision-1.png` (Image 2: the style anchor)]
- `composition`: "Exact 3 rows x 3 columns grid of equal square cells, one object centred in each cell inside the central 70% safe area, nothing crossing a cell boundary, no divider lines. Draw objects at true relative scale: LARGE objects span about 85% of the cell width, MEDIUM about 60%, SMALL about 35-40%. Each object has a tight dark contact shadow and a thin sand|snow drift hugging its base, no wider than the object."
- `style`: "Gritty pixel art, chunky crisp pixels, 1px dark outline, two-step dithered shading, mid values: key forms mid-tone (not white, not black) so they separate from a dark floor. No red or green rim light, no glow[, no green anywhere — desert]."
- `scene`: "Solid flat pure #FF00FF magenta background filling the whole image, no gradient, no ground plane, no text, no labels, no grid lines."
- `lighting`: desert "Warm key light from upper left…", winter "Cold pale key light from upper left…", then "cool dusk ambient, orthographic 3/4 top-down camera."
- `subject` opens with the fixing clause: "Image 1 fixes the zone's prop rendering, materials, scale, camera and lighting; Image 2 fixes the rendering style, palette, outline and finish — match both exactly. Draw NEW subjects in that style; do not copy either image's objects or layout. A 3x3 sprite sheet of nine DIFFERENT standalone <zone> blockers, each ONE single self-contained object (never a cluster or pile), <materials>." After that come the nine cells, in row-major order:

| sheet | cells (size class, silhouette) |
|---|---|
| props-desert-d | L long low carved sandstone sarcophagus · M tall thin driftwood totem topped by a ram skull · M round wind-eroded boulder · S single tall cracked clay amphora · M one toppled fluted column shaft on its side · M tall long-dead dried cactus, grey-brown woody husk, NO green · L jagged leaning sandstone hoodoo outcrop · S single bleached horned beast skull · S short square sandstone milestone |
| props-desert-e | M long dry sandstone water trough · S round stone sundial on a pedestal · M broken two-wheeled handcart tipped forward · L tall bleached dead acacia, flat spreading dead crown · S rope-bound supply crate · M one enormous curved mammoth tusk arching out of the sand · L half-buried stepped ziggurat block, L-shaped stepped mass · S single iron-banded barrel · S squat petrified stump |
| props-winter-d | M fallen frozen pine log · S thin waymarker signpost with two blank crossed boards · M round snow-capped granite boulder · S frost-rimed barrel · L long low carved stone sarcophagus with frost on the lid · S snow-capped stump with an axe mark · L jagged dark granite outcrop with icy seams, L-shaped · S crate half-buried in snow · S narrow young pine sapling |
| props-winter-e | M stacked split-firewood woodpile · L tall dark stone obelisk with frost-filled grooves · M round black iron cauldron on three legs · M mammoth skull with two long tusks · S iron anvil on a log block · M broken stone column segment on its side · M wooden weapon rack with frozen spears · S rusted iron grave cross · L enormous fallen iron knight helmet half-buried |

Winter materials also carry: "with snow only as a thin cap on top — the body of every object stays mid-grey or mid-brown, never white".

Attempts: desert-d had 2 generations. Take 1 had a saturated GREEN saguaro in cell 5, which is the gameplay-reserved hue (forbidden 95-150°), so the cell was rewritten to "long-dead dried cactus, NO green". desert-e, winter-d and winter-e were each accepted on the first take. Raws: `raws/<zone>-<d|e>-take<N>.jpg`.
