# Store key art — cover + Open Graph (2 calls, NOT game textures)

Read `_common.md` first. This brief is store media, not a manifest group: the exports land in
`games/2026-08-29-duskhaul/art/exports/` (reference material, excluded from the scaffold), the cover
never enters `art/manifest.json`, and `scripts/gen-art-registry.mjs` never sees it. Required for the
release gate — `node scripts/release-check.mjs 2026-08-29-duskhaul` treats the scaffolded placeholder
`public/cover.svg` as unfinished.

## The hero moment (one frame, one idea)

The Duskhauler's greed at the last second — channelling extraction at a violet gate while the horde
closes and gilt spills out of the bag:

- **Foreground centre, the subject:** the Duskhauler (identity verbatim from `hero.md` — mummified skull
  face with two red pinprick eyes deep in a ragged moss-green hood, tattered moss-green cloak with a torn
  dripping hem and a thin gloam-green rim light, bare bone hands and forearms, rust-brown leather straps
  and a tarnished round medallion, bulging brown leather loot-sack on the left hip, dark wrapped legs and
  boots) KNEELING in the extraction rite, three-quarter view facing slightly right, palms open and raised,
  a hard-edged dusk-violet channel glow rising between his hands and up past the hood.
- **The reward:** the loot-sack has tipped and gilt relics are spilling out across the wet flagstones
  beside his knee — a ring, a locket, a gilt skull idol, loose shards — each catching a hard gilt glint.
  The gilt spill is the second-brightest thing in frame after the gate.
- **Behind him, the promise:** the extraction gate, a squat stone archway with the grille retracted, its
  opening full of dusk-violet flame that rim-lights the ashlar blocks and throws violet across the
  flagstones and up the back of his cloak.
- **Closing in, the cost:** the horde — six to eight skeletal grave-risen silhouettes crowding in from
  the left and right edges, almost black against the violet light, each with two red pinprick eyes. They
  are SHAPES and RED EYES, not detailed characters; they must not compete with the hero.
- **World:** wet cracked flagstones, moss seams, a fallen banner, cold desaturated plum-grey stone; a
  single torch-amber ember glow low on the right for temperature contrast.

**Colour code holds (law, §11):** violet gate = the goal, gilt = the reward, red eyes = the threat, gloam
green = the player. Nothing else in frame is saturated.

**Composition:** portrait. Hero and channel glow occupy the middle band; the gate arch fills the upper
third behind him; the gilt spill and flagstones the lower third; horde silhouettes hug the left and right
edges. Full-bleed to all four edges — no border, no frame, no vignette ring, no magenta background (this
is an illustration, not a chroma-keyed sprite).

**Absolutely not in frame:** no text, no lettering, no digits, no title treatment, no logo, no watermark,
no UI, no HUD, no health bar, no button, no border. The `ui-icons/emblem` crest and the title are
composited by the store page over this image, never rendered by the provider.

## Call 1 — cover (portrait)

Canvas exception to `_common.md` §5: `aspect_ratio: "3:4"`, `image_size: "1024x1536"`.
Open with the `_common.md` fixing clause (Image 1 fixes rendering style, palette, lighting, outline and
finish; Image 2 fixes material rendering and the Duskhauler's identity) — the styleProfile merge appends
both vision anchors automatically; a text-only cover call is a defect.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"art/exports/cover","rows":1,"cols":1,"profile":"pixel-art-fx","styleProfile":"art/style.json","strict":false}`
(Marker paths here are project-relative — run this call from `games/2026-08-29-duskhaul/`.)

`strict:false` is correct and required: a full-bleed illustration touches every canvas edge on purpose,
exactly like the template's `bg/arena` and this game's zone floor tiles. Because it ships `strict:false`,
record the exception in the report even though the cover is not a manifest asset:
`{ "id": "art/exports/cover", "reason": "Full-bleed store illustration: the art runs to all four edges by design, so strict edge-contact QC cannot pass (template bg/arena precedent). Not a game texture." }`

### Measure, then place
1. Read the export's `sprite-metadata.json` → `source.width` / `source.height`.
2. **Accept band: `width / height` between 0.66 and 0.80** (3:4 = 0.75). Outside that band the provider
   ignored the requested ratio — regenerate on the same brief, do NOT rescale or crop to fit.
3. On accept: copy the exported single frame to `games/2026-08-29-duskhaul/public/cover.png`, set
   `game.json` `"cover": "cover.png"`, and delete `games/2026-08-29-duskhaul/public/cover.svg`.

### The real gate: it must read at ~300px
Open `public/cover.png` and view it at catalog-card width (~300px wide). At that size the player must see,
in this order: the violet gate hole, the kneeling green-hooded figure, the gilt spill, red eyes closing in.
If the figure dissolves into the horde or the gilt is lost in the flagstones, the cover FAILS regardless of
palette distance or QC numbers — regenerate with fewer horde silhouettes and a larger hero, changing ONE
thing per attempt.

## Call 2 — Open Graph (landscape, after the cover is accepted)

Same hero moment, re-staged wide. `aspect_ratio: "16:9"`, `image_size: "1536x1024"`.
Pass the accepted `games/2026-08-29-duskhaul/public/cover.png` as the FIRST `input` image and state its
role in the prompt: "Image 1 fixes the composition, palette and the character's identity — re-stage the
same moment in a wide landscape frame; the gate and hero stay centred, the horde silhouettes spread
further out along the left and right edges." Same no-text / no-logo / no-UI clauses.
Marker:
`OMP_SPRITE_EXPORT:{"outputDir":"art/exports/og","rows":1,"cols":1,"profile":"pixel-art-fx","styleProfile":"art/style.json","strict":false}`

Then copy the exported frame to `games/2026-08-29-duskhaul/shots/og.raw.png` and crop it deterministically
with the repo script (never by hand, never by eye):

```bash
scripts/og-crop.sh games/2026-08-29-duskhaul/shots/og.raw.png games/2026-08-29-duskhaul/shots/og.png
```

If the script reports its tool missing, ship the uncropped landscape as `shots/og.png` — Open Graph
consumers rescale, and a guessed crop loses the subject. **Never crop the portrait `cover.png` into a
landscape og**: it decapitates the hero.

## Report
Cover: source dimensions + measured ratio, the catalog-size read verdict (what you actually saw at 300px),
`sprite_check_palette` with `profile: games/2026-08-29-duskhaul/art/style.json` — `meanDistance`,
retries used, the `strict:false` exception line above, and the
`game.json` / `cover.svg` change. OG: whether `og-crop.sh` ran or was skipped, and the final file path.
