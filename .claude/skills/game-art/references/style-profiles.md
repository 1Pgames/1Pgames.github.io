# Style profiles

The style profile is the single artefact that makes 25 separately generated
assets look like one game. Write it before the first `generate_image` call and
pass `styleProfile` in every export marker.

Schema: `sprite-forge.style.v1` (validated by
`skill://sprite-forge/scripts/style-profile.ts`).

## Field checklist

| Field | Required | What makes it work |
| --- | --- | --- |
| `schema` | yes | exactly `"sprite-forge.style.v1"` |
| `name` | yes | short kebab id, e.g. `vibrant-chibi` |
| `artStyle` | yes | 4-6 sentences: proportions, shading steps, outline, finish, camera, what is forbidden |
| `palette` | yes | 12-18 `#rrggbb` values including the UI palette |
| `camera` | recommended | one sentence; constant distance and scale is the point |
| `lighting` | recommended | key, fill, speculars, and "no cast shadow, no ground plane" |
| `outline` | recommended | colour, weight, where internal lines are allowed |
| `maxPaletteDistance` | recommended | 48-56 stylised, 32-40 for a strict limited palette |
| `plan.valuePlan` | yes | dark/mid/light shares summing to ~1; without it the set comes back monotone |
| `plan.temperature` | yes | the gameplay colour code (threat vs ally vs reward) |
| `plan.saturationHierarchy` | yes | ordered, focal element first |
| `plan.focal` | yes | primary / secondary / rest |
| `plan.materials` | yes | material → substance and surface behaviour, never a colour |
| `plan.renderScale` | yes | px the asset is drawn at in game; QC judges silhouettes here |
| `references` | **yes, by Step 1b** | the locked vision anchors, **max 2**, repo-root-relative; appended to every `generate_image.input`. An empty array means no vision is locked and `manifest-lint.py` errors `vision-anchors-not-locked`. |

Anti-patterns: a profile naming only a palette and a mood (passes palette QC,
produces flat wallpaper); adjectives with no measurable content ("epic",
"stylish"); per-asset style improvisation; changing the profile mid-run;
**shipping the scaffold profile** (see below).

### `palette` is the gate's yardstick, not a suggestion

`sprite_check_palette` reports `meanDistance` as distance FROM THIS LIST. It is
therefore **not** a fidelity score — measured, an off-style sheet scored 20.58 while
a correct cold-blue snowfield scored 44.48, purely because the profile's 18-colour
list contained no cold blue. Two consequences:

- Put every zone's / faction's identity hue in `palette` at authoring time, or a
  correct asset cannot score well and you will spend regenerations compromising it
  toward the wrong palette until it stops reading as the thing it is. That happened:
  a snow tile was pushed to grey slate rock chasing the number.
- When a zone legitimately needs a hue the list lacks, pre-authorise the exception
  in `art/manifest.json.qcExceptions[]` rather than treating the score as a defect.

## The scaffold profile is NOT a starting point

`template/art/style.json` ships as a deliberate placeholder: `"scaffold": true`, a
`"scaffoldNote"`, and `"name": "scaffold-placeholder-vibrant-chibi"`. Its prose IS a
real, working vibrant-chibi profile — the template's own art was generated from it —
which is exactly what makes it dangerous: it does not fail, it succeeds at producing
a coherent asset set for the wrong game, and every per-asset gate passes it.

Step 1 must rewrite it: new kebab `name`, this game's own
`artStyle`/`palette`/`lighting`/`outline`, Step 1b anchors in `references`, and
**delete the `scaffold` and `scaffoldNote` keys**. `manifest-lint.py` errors
`style-lock-not-rewritten` and `scripts/release-check.mjs` fails the release while
any of those markers survive (including byte-identical scaffold `artStyle` prose).
Measured near-miss: the art-director died mid-rewrite on the Duskhaul run; ten
minutes earlier, 103 chibi assets would have been generated into a grimdark game.

## Profile: vibrant chibi (the scaffold's prose — adapt, never ship as-is)

This is the wording carried by `template/art/style.json` under the name
`scaffold-placeholder-vibrant-chibi`. Copy it only if the game genuinely IS vibrant
chibi, and even then re-name it, add your anchors and drop the scaffold keys. Key
wording:

- Two-heads-tall proportions, oversized round head, huge eyes with one specular
  dot, tiny stubby limbs, no neck.
- Exactly two shadow steps and one hard highlight; thick uniform dark-navy
  outline; glossy plastic-toy finish; chunky shapes, no texture noise.
- 3/4 front-facing camera, constant distance, constant standing-equivalent
  scale.
- Cool cyan allies, warm magenta/red threats, gold rewards; warm and cool never
  share a value tier.
- `valuePlan` `0.42 / 0.40 / 0.18`, `renderScale` 96, `maxPaletteDistance` 52.

Good for: survivor-likes, roguelikes, tower defense, anything that must read at
96px on a dark background and look friendly on video.

## Profile: gritty pixel

- 32px-tall sprites, 1px hard outline in the darkest palette colour, dithered
  two-step shading, no anti-aliasing, orthographic side or 3/4 camera.
- Palette 16 colours max, desaturated earth plus two saturated accents.
- `plan.renderScale` 32-64, `maxPaletteDistance` 32, profile `pixel-art-body` /
  `pixel-art-fx` (nearest sampling) instead of the `hd-*` profiles.
- `valuePlan` `0.5 / 0.35 / 0.15`; lights confined to metal and fire.

Good for: dungeon crawlers, survival, tactics. Costs more regenerations: pixel
grids are where providers cheat with anti-aliasing.

## Profile: flat vector

- No outline; shapes separated by value; single flat fill per shape plus one
  darker shade; geometric construction, perfect circles and rounded rectangles.
- Palette 10-12 colours, high chroma, one neutral.
- `valuePlan` `0.3 / 0.5 / 0.2`, `renderScale` 128.

Good for: puzzle, incremental, auto-battler, anything UI-heavy — the UI kit and
the entities come out of the same language.

## Profile: painterly

- Soft brush edges, three-step value blocking, warm/cool bounce, no outline.
- Palette 14-18, muted, one hot accent.
- `valuePlan` `0.45 / 0.4 / 0.15`, `renderScale` 192, `maxPaletteDistance` 56.

Good for: story-driven or slower games. Weakest choice for small on-screen
entities: soft edges disappear under 96px.

## Profile: neon retro

- Dark background, additive glow, chrome gradients, scanline-free, thin bright
  outlines instead of dark ones (state this explicitly — it inverts the default).
- Palette: near-black base plus 6 fluorescent hues; two value tiers only.
- `valuePlan` `0.55 / 0.25 / 0.2`, `renderScale` 96.

Good for: bullet hell, arcade shooters, rhythm. Watch readability: glow eats
silhouettes when many entities overlap.

## Profile: candy-gloss (default for B / G / J casual)

Not shipped as a file: copy the block into `art/style.json`. Built for pieces,
tiles, dice and skins that must stay separable on a bright board at 96-128px.

```json
{
  "schema": "sprite-forge.style.v1",
  "name": "candy-gloss",
  "artStyle": "Bright glossy casual-puzzle art: chunky rounded shapes with generous corner radii, every piece inscribed in the same square box and filling 80-90% of it. Exactly two flat shadow steps plus one hard elliptical specular in the upper-left third of each shape and one warm bounce along the lower-right rim; no gradient may span more than a third of a shape. Thick uniform dark-grape outline around every silhouette, internal lines only where the central glyph meets the body. Saturated candy colours at high contrast against a light board, wet-hard-candy finish, shapes readable in pure silhouette. Straight-on orthographic front view with no perspective, no tilt and no foreshortening. Forbidden: texture noise, painterly or feathered edges, drop shadows onto the board, fine internal detail, embossed or beveled chrome, any lettering.",
  "palette": [
    "#1b1033",
    "#3d2a63",
    "#ffffff",
    "#fff3d6",
    "#ffd54a",
    "#ff9f1c",
    "#ff5470",
    "#d02a53",
    "#7c4dff",
    "#4dd0ff",
    "#1a9be0",
    "#47e08a",
    "#17a86a",
    "#ff7ad9",
    "#b8c6e8",
    "#6f7dab"
  ],
  "camera": "Orthographic straight-on front view, subject centred, every asset drawn at the same box size and the same optical weight; no perspective, no rotation, no scale drift between cells.",
  "lighting": "Single key light from the upper left, one hard elliptical specular per glossy surface placed in the upper-left third, one warm bounce along the lower-right rim, ambient occlusion only where two shapes overlap. No cast shadow onto the board, no ground contact shading, no ground plane.",
  "outline": "Uniform 4px dark grape (#1b1033) outline on the outer silhouette, thinner internal separation only between the central glyph and the piece body. Never a light, coloured or glowing outline.",
  "maxPaletteDistance": 50,
  "plan": {
    "valuePlan": { "dark": 0.22, "mid": 0.45, "light": 0.33 },
    "temperature": "Hue is identity, not threat: each piece hue is locked to exactly one silhouette and never reused by a second piece. Gold is reserved for rewards, boosters and specials; warm cream for neutral chrome and empty slots; deep grape and violet for negatives — locks, ice, blockers, jail; mint for progress and goal completion.",
    "saturationHierarchy": [
      "booster and special-piece gold",
      "the active or selected piece hue",
      "standard piece hues",
      "chrome and slot neutrals",
      "board field and backdrop"
    ],
    "focal": {
      "primary": "the central glyph of the piece or icon plus its single specular",
      "secondary": "the outer silhouette edge that separates this piece from its neighbours",
      "rest": "the flat board field, gutters and panel fill"
    },
    "materials": {
      "candy": "wet hard-boiled sweet, one hard specular oval, deep saturated core, no interior detail",
      "jelly": "soft translucent gel with a lighter core and a slightly darker rim, holds a rounded blob shape",
      "foil": "reflective metallic wrapper with one sharp streak and a dark reflected band, used only for specials",
      "ice": "frosted translucent block with straight facet edges and a pale desaturated interior, used for blockers",
      "crate": "smooth painted toy wood with a chunky bevel, no grain lines, used for breakable chrome",
      "paper": "matte flat label with a crisp edge, used for goal and counter plates",
      "bubble": "clear glass sphere with a diagonal highlight streak and a darker lower rim"
    },
    "renderScale": 128
  },
  "references": []
}
```

Good for: B board-puzzle (piece sets), G table-dice (dice, board tiles,
collection badges), J hypercasual (object skins), and I hybrids built on those
cores. The high `light` share is deliberate: these families play on a light
board, so a value plan tuned for a dark arena returns pieces that look muddy.
Watch the specular — a provider that drifts to two or three highlights per shape
destroys the "same material" read across the set.

## Profile: cozy-paper (default for F / H, alternative for G)

Not shipped as a file: copy the block into `art/style.json`. Built for
icon-dominated, text-heavy screens read at 64-96px.

```json
{
  "schema": "sprite-forge.style.v1",
  "name": "cozy-paper",
  "artStyle": "Soft cut-paper illustration: flat matte shapes with a fine uniform paper tooth, one flat fill plus exactly one darker shade per shape, and no highlight. Depth comes from value steps and a 2px offset shadow kept inside the shape, as if one paper layer sits on another. Edges are clean and slightly hand-torn rather than mechanically sharp; no outline by default, and where two shapes of the same value meet, a soft dry-brush ink edge only. Warm muted kraft-and-ink palette with a single saturated accent per asset, straight-on flat camera, every icon inscribed in the same square with equal optical weight. Forbidden: gloss, speculars, neon, glow, gradients larger than a shape, digital sharpness, photographic texture, lettering.",
  "palette": [
    "#2f2a24",
    "#5c5347",
    "#8a7f6d",
    "#a8a29a",
    "#d9c9a8",
    "#efe6d4",
    "#fdf8ec",
    "#c9a227",
    "#e08a4f",
    "#b8563f",
    "#7e9b6a",
    "#4f7360",
    "#6e8fa8",
    "#3f5a72",
    "#b9788f"
  ],
  "camera": "Flat straight-on view, no perspective and no tilt; every icon inscribed in the same square, subject centred, with equal optical weight and identical stroke mass across sheets.",
  "lighting": "No directional light source. Depth is value steps plus a 2px darker offset inside the shape, reading as stacked paper layers. No speculars, no cast shadows, no glow, no rim light.",
  "outline": "None by default; shapes separate by value. Where two same-value shapes meet, a 2px soft dry-brush edge in ink brown (#2f2a24) only — never a hard uniform stroke around the whole silhouette.",
  "maxPaletteDistance": 40,
  "plan": {
    "valuePlan": { "dark": 0.28, "mid": 0.52, "light": 0.2 },
    "temperature": "Warm kraft and mustard for owned things, currency and positive progress; sage and pine for growth, production and income; dusty blue and slate for neutral information and locked content; terracotta and brick for cost, spend and warnings; dusty rose reserved for premium and limited offers.",
    "saturationHierarchy": [
      "currency and reward mustard",
      "cost and warning terracotta",
      "production and progress sage",
      "informational dusty blue",
      "paper and kraft neutrals",
      "stone UI greys"
    ],
    "focal": {
      "primary": "the icon glyph silhouette — the object or symbol the row is about",
      "secondary": "the single saturated accent inside the glyph that codes its category",
      "rest": "the paper field, the label band and the list background"
    },
    "materials": {
      "paper": "visible fine tooth, matte, hand-torn edge, flat single-value fill",
      "kraft": "warm card stock with a slightly coarser tooth and a fibrous edge",
      "wood": "unfinished sanded timber, two value steps, sparse straight grain marks only",
      "ceramic": "matte unglazed clay with a soft chalky value falloff and no highlight",
      "brass": "brushed warm metal with a broad soft value band, never mirror chrome",
      "linen": "woven cloth with a soft irregular edge and two value steps, no folds",
      "ink": "opaque dry-brush stroke, slightly ragged, used for glyph detail and separation"
    },
    "renderScale": 96
  },
  "references": []
}
```

Good for: F idle-tycoon (generator and upgrade icon lists), H word-trivia
(category icons over a primitive letter grid), G table-dice in its solitaire and
ludo form. Weakest choice for anything with fast motion or many overlapping
entities: with no outline and no highlight, a moving shape loses its edge. The
tight `maxPaletteDistance` of 40 is the point of this profile — the muted band is
narrow, so a provider drifting into saturation is caught by palette QC rather
than by eye.

## Choosing

| Game trait | Profile |
| --- | --- |
| Hundreds of small entities on a dark field | vibrant chibi, neon retro |
| Grid/tile world, inventory, equipment | gritty pixel |
| Heavy UI, cards, numbers | flat vector |
| Few large characters, cinematic moments | painterly |
| Recorded for vertical video | vibrant chibi (highest thumbnail contrast) |

By family (defaults; the alternative is a deliberate choice, not a fallback):

| Family | Default profile | Alternative |
| --- | --- | --- |
| A real-time-arena | vibrant chibi | neon retro (bullet hell), gritty pixel (crawler) |
| B board-puzzle | candy-gloss | flat vector (sort, block — UI-dominant boards) |
| C side-view-physics | vibrant chibi | gritty pixel (platformer), neon retro (arcade runner) |
| D turn-based-cards-tactics | flat vector | painterly for card art only if the whole set follows, gritty pixel (tactics) |
| E track-vehicle | flat vector | vibrant chibi (toy racers), neon retro (arcade) |
| F idle-tycoon | cozy-paper | flat vector (number-dominant screens) |
| G table-dice | candy-gloss (dice-board loop) | cozy-paper (solitaire, ludo) |
| H word-trivia | cozy-paper | flat vector |
| J hypercasual | candy-gloss | flat vector (minimal-shape mechanics) |
| I hybrid composition | the core family's profile, unchanged | none — two profiles in one build is a bug, not a style |

Painterly stays out of B/F/H/J entirely: soft edges vanish under 96px and these
families draw nothing larger.

## Verification

```bash
# RUN THIS THROUGH omp's `bash` TOOL, not a raw shell. `sprite-forge` lives in its own
# repo, so there is no $REPO-relative path and the harness must resolve it: `realpath
# skill://...` is rewritten by omp's bash tool but FAILS in a plain shell, where the
# substitution expands to empty and the command silently runs nothing (measured).
bun "$(realpath skill://sprite-forge)/scripts/style-profile.ts" \
  --profile art/style.json --input public/assets/generated/hero/hero-idle/sprite-sheet.png --strict
```

Everything under `skill://game-art` is in THIS repo and is therefore addressed with
`REPO="$(git rev-parse --show-toplevel)"`, which works in both environments — see the
block below and game-art SKILL.md Step 2.

`meanDistance` above `maxPaletteDistance` means the asset drifted off the profile's
palette LIST. Regenerate with the palette restated in the prompt; do not raise the
threshold. **Scope it honestly:** the figure is distance from a list, not quality — an
off-style sheet has measured 20.58 against a correct one at 44.48 — so before you
reroll, check whether the asset needs a hue the list lacks. If it does, fix the list
or write the exception; rerolling compromises the asset toward the wrong palette.

Palette distance says nothing about value structure — always pair it with
`art_review`. And neither says anything about how an asset reads against the OTHER
assets: a backdrop or tile must additionally clear the set-level gate

```bash
REPO="$(git rev-parse --show-toplevel)"
python3 "$REPO/.claude/skills/game-art/references/figure-ground.py" \
  --scene <zone> --actors <that scene's complete cast> \
  --fields <the floor/backdrop sheets> --grade <runtime tint hex> \
  --manifest art/manifest.json
```

which is the only measurement in this pipeline that compares two assets to each
other. Nothing else in this file can catch a floor drawn in the same value band as
the actors standing on it.
