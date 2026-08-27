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
| `references` | optional | accepted master frames; appended to `generate_image.input` |

Anti-patterns: a profile naming only a palette and a mood (passes palette QC,
produces flat wallpaper); adjectives with no measurable content ("epic",
"stylish"); per-asset style improvisation; changing the profile mid-run.

## Profile: vibrant chibi (default for generated games)

Shipped in this repo as `template/art/style.json`. Key wording:

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

## Choosing

| Game trait | Profile |
| --- | --- |
| Hundreds of small entities on a dark field | vibrant chibi, neon retro |
| Grid/tile world, inventory, equipment | gritty pixel |
| Heavy UI, cards, numbers | flat vector |
| Few large characters, cinematic moments | painterly |
| Recorded for vertical video | vibrant chibi (highest thumbnail contrast) |

## Verification

```bash
bun "$(realpath skill://sprite-forge)/scripts/style-profile.ts" \
  --profile art/style.json --input public/assets/generated/hero/hero-idle/sprite-sheet.png --strict
```

`meanDistance` above `maxPaletteDistance` means the asset drifted off-palette:
regenerate with the profile's palette restated in the prompt, do not raise the
threshold. Palette distance says nothing about value structure — always pair it
with `art_review`.
