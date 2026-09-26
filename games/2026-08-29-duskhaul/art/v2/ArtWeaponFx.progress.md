# ArtWeaponFx — group `weapon-fx-v1` (world fx for the six V1 weapons)

Probe (rule 0): `generate_image` 1024² throwaway → `xai-oauth / grok-imagine-image`, OK. Every raw below came from xai-oauth.

Manifest fragment (merge input): `art/v2/ArtWeaponFx.groups.json` — `python3 art/v2/merge-fragments.py ArtWeaponFx`.
Outputs: `public/assets/generated/weapon-fx-v1/<id>/` (`sprite-sheet.png`, `frames/`, `animation.gif`,
`raw-source.*`, `sprite-metadata.json`). Integrator: add `weapon-fx-v1` to the slice's `ART_GROUPS`.

## Pipeline as run (same as ArtPOI v2)
- Generation: native `generate_image`, one call per asset, 1024x1024 / 1:1. Inputs: Image 1 =
  `art/refs/vision-1.png` (style/palette/finish fixing clause) on every call; Image 2 = the matching
  `icons-v2/icons-wpn-a` frame (0 Rustspike, 1 Bone Halo, 3 Scythe, 8 Lance, 9 Hex) on base calls
  so the world fx match the icons, or the accepted BASE raw on evo calls so base/evo share identity.
  Ash Ring base and Pyre Shroud evo went vision-only (the icon is orange fire; the world fx must be cold).
- Raw cleanup (`art/briefs/v3-weaponfx/clean.py`, deterministic, draws nothing): xai welded layout
  chrome into three sheets — nova: black divider cross; scythe: white page border + white dividers
  (border cropped losslessly); scythe-evo: white dividers + ~70 px of canvas-clipped tatter flecks in
  the 8 px left border. Each band is asserted to hold < its art budget before it is key-filled.
- Export: `art/briefs/v3-weaponfx/build.py` → sprite-forge `process-sprite.ts` (nearest, centre,
  fit 0.86 [bolt 0.78 / bolt-evo 0.92 so the evo reads bigger], componentMode all, `--strict`,
  `--preserve-raw`, `--source-provider xai-oauth`). Key threshold = `bg+35` (ArtPOI rule) except
  nova / scythe / scythe-evo at 185 (measured: art p1 distance from #FF00FF ≥ 197).
- Despill (nova, scythe-evo only; `build.py despill()`, before keying): red-leaning magenta
  pixels that would survive the key are pulled to neutral dark soot. Violet (b > r) never touched.
- Repro: `python3 art/briefs/v3-weaponfx/clean.py && python3 art/briefs/v3-weaponfx/build.py && python3 art/briefs/v3-weaponfx/build.py --palette`.
  Wiring numbers: `python3 art/briefs/v3-weaponfx/measure.py`.

## Per-asset table (all 12 strict-QC pass; meanDistance = sprite_check_palette vs art/style.json, max 48)

| id | grid | cell | frames | ms | loop | meanDistance | gens | exception |
|---|---|---|---|---|---|---|---|---|
| wpn-bolt | 1x2 | 64x64 | 2 | 110 | yes | 36.56 | 2 | |
| wpn-bolt-evo | 1x2 | 64x64 | 2 | 110 | yes | 37.47 | 1 | |
| wpn-orbit | 2x2 | 96x96 | 4 | 120 | yes | 31.40 | 2 | |
| wpn-orbit-evo | 2x2 | 96x96 | 4 | 120 | yes | 31.90 | 1 | |
| wpn-nova | 2x2 | 512x512 | 4 | 90 | no | 33.01 | 2 | |
| wpn-nova-evo | 2x2 | 512x512 | 4 | 90 | no | 52.56 | 2 | weapon-fx-v1/wpn-nova-evo |
| wpn-scythe | 1x3 | 256x256 | 3 | 70 | no | 41.64 | 2 | |
| wpn-scythe-evo | 1x3 | 256x256 | 3 | 70 | no | 37.89 | 2 | |
| wpn-rail | 3x1 | 384x64 | 3 | 70 | yes | 83.03 | 2 | weapon-fx-v1/wpn-rail |
| wpn-rail-evo | 3x1 | 384x64 | 3 | 70 | yes | 49.79 | 2 | weapon-fx-v1/wpn-rail-evo |
| wpn-hex | 3x1 | 256x64 | 3 | 80 | yes | 40.96 | 1 | |
| wpn-hex-evo | 3x1 | 256x64 | 3 | 80 | yes | 38.65 | 1 | |

Rejected generations (why): bolt g1 diagonal nail + divider line; orbit g2 static two-blade shuriken
(g1 kept); nova g1 plank/stone ring; scythe g2 grey rock backdrop (g1 kept); rail g1 spear with ribbons;
nova-evo g1 redrew the grey ash ring; scythe-evo g1 redrew crescents; rail-evo g1 bone end-caps.
The three exceptions are palette-list gaps (no cyan / light lilac in `style.json.palette`), the same
class as canon `weapon-fx/wpn-breath` (63.7); written to `exceptions.json` → fragment `qcExceptions`.

## Wiring contract (keys = registry keys, frames row-major)
- `wpn-bolt` / `-evo`: 64 cell, nail points **+x** (head left). 2f shimmer loop. Base bbox x 7–56, evo x 3–61 (evo reads bigger).
- `wpn-orbit` / `-evo`: 96 cell, ONE crescent bone blade centred. 4f **tumble** loop (frames flip the
  crescent: open-right, open-left, open-right v-flipped, open-left v-flipped) — not a rotation; keep
  the code's tangent rotation.
- `wpn-nova` / `-evo`: 512 cell, ring centred on the hero, 4f **one-shot** (small → large → scattering → sparse).
  Rings are 3/4-camera ELLIPSES. Rim rx/ry per frame: nova .34/.25, .43/.32, .41/.29, .43/.32;
  nova-evo .37/.29, .43/.35, .43/.34, .41/.34. Frames barely grow after f0, so tween display scale
  for the expansion; match the hit radius to rx ≈ 0.43. Evo frame 4 is still a fairly full ring
  (provider order), so fade alpha on the last frame.
- `wpn-scythe`: 256 cell, 3f **one-shot**, ")" crescent convex toward **+x** (facing). Frames are
  bbox-centred, so the swinger is NOT the cell centre: origin **(0.36, 0.50)**, outer-rim radius
  **0.41** of cell (f0 .392 / f1 .432 / f2 .399) → display size = hitRadius / 0.41, rotate by facing.
- `wpn-scythe-evo`: 256 cell, full 360° ring, origin (0.5, 0.5), rim r .40/.43/.41 (use 0.41), 3f one-shot (forming → full → dissolving).
- `wpn-rail` / `-evo`: 384x64, horizontal, points **+x**, 3f flicker loop, uniform along length.
  Opaque core x-span: base 0.070–0.930, evo 0.156–0.844 (thicker beam → shorter after fit).
- `wpn-hex` / `-evo`: 256x64, horizontal link, 3f crackle loop. Core x-span base 0.168–0.840, evo 0.164–0.840.

## Set gates
- `art_review` (12 assets, `characters` = weapon id so base/evo are same-character): passed; every
  cross-weapon silhouette pair gated and passed (min 0.065 bolt↔scythe). Warnings, scoped: value-plan-miss
  and temperature-single on rail/rail-evo/nova-evo are single-hue glow FX against a profile value plan
  calibrated on bodies/props (canon wpn-breath has the same shape); orbit warm share 45% is bone-parchment.
- `figure-ground.py`: not applicable — the group holds no floor/tile/backdrop/parallax field.
- `manifest-lint.py` on a temp copy with this fragment merged (run from repo root): exit 0, 0 errors,
  the same 2 pre-existing warnings as the live manifest (duplicate vision-1 anchor; 33 hand-written
  writeScaleProfile paths) — neither is in this group.
- Registry dry run (temp tree, `node scripts/gen-art-registry.mjs`): all 12 rows, geometry as above.

## Criteria
- NEW, scoped: **red-magenta key spill share** (opaque px with r > b+5, r−g > 50, b−g > 20) — scope:
  magenta-keyed FX sheets in weapon-fx*. Validated on the accepted canon first: canon weapon-fx
  ranges 0.000–0.115 (lash 0.114, spear 0.110/0.115), so the reject line is > 0.115. Rejected nova
  (0.348 → 0.189 at t=185 → 0.000 after despill) and scythe-evo (0.189 → 0.000). The rest sit 0.000–0.068.
- `meanDistance`: read as distance from the palette LIST (rule 10); the three overs are list gaps, recorded.
- Post-review pixel transforms: none. The despill and band cleanup run BEFORE keying and were reviewed
  on the exported result (composited on #3a3440 and a mid plum-grey).
