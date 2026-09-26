# ArtEnemies — enemies-v2 delivery log

Group `enemies-v2` (owner ArtEnemies). Manifest slice: `art/v2/ArtEnemies.groups.json`.
All sheets: 2x2 grid, 256x256 frames, 512x512 `sprite-sheet.png` + `frames/` + `animation.gif` +
`sprite-metadata.json` + `raw-source.png`. Art faces RIGHT (`facesRight` default true).
Loop: `-move` loops; `-attack`, `-death`, `-revive` play once.

## Batch 1 — all 20 sheets delivered (2026-09-25)

| texture/anim key | path (under `public/`) | ms/frame |
|---|---|---|
| enemy-cryptcrawler-move | assets/generated/enemies-v2/enemy-cryptcrawler-move/sprite-sheet.png | 90 |
| enemy-cryptcrawler-death | assets/generated/enemies-v2/enemy-cryptcrawler-death/sprite-sheet.png | 90 |
| enemy-lanternmonk-move | assets/generated/enemies-v2/enemy-lanternmonk-move/sprite-sheet.png | 150 |
| enemy-lanternmonk-attack | assets/generated/enemies-v2/enemy-lanternmonk-attack/sprite-sheet.png | 110 |
| enemy-lanternmonk-death | assets/generated/enemies-v2/enemy-lanternmonk-death/sprite-sheet.png | 100 |
| enemy-bulwark-move | assets/generated/enemies-v2/enemy-bulwark-move/sprite-sheet.png | 150 |
| enemy-bulwark-death | assets/generated/enemies-v2/enemy-bulwark-death/sprite-sheet.png | 100 |
| enemy-gibbet-move | assets/generated/enemies-v2/enemy-gibbet-move/sprite-sheet.png | 140 |
| enemy-gibbet-attack | assets/generated/enemies-v2/enemy-gibbet-attack/sprite-sheet.png | 100 |
| enemy-gibbet-death | assets/generated/enemies-v2/enemy-gibbet-death/sprite-sheet.png | 100 |
| enemy-choirwraith-move | assets/generated/enemies-v2/enemy-choirwraith-move/sprite-sheet.png | 130 |
| enemy-choirwraith-attack | assets/generated/enemies-v2/enemy-choirwraith-attack/sprite-sheet.png | 110 |
| enemy-choirwraith-death | assets/generated/enemies-v2/enemy-choirwraith-death/sprite-sheet.png | 100 |
| enemy-mirehag-move | assets/generated/enemies-v2/enemy-mirehag-move/sprite-sheet.png | 150 |
| enemy-mirehag-death | assets/generated/enemies-v2/enemy-mirehag-death/sprite-sheet.png | 100 |
| enemy-sandrevenant-move | assets/generated/enemies-v2/enemy-sandrevenant-move/sprite-sheet.png | 140 |
| enemy-sandrevenant-death | assets/generated/enemies-v2/enemy-sandrevenant-death/sprite-sheet.png | 110 |
| enemy-sandrevenant-revive | assets/generated/enemies-v2/enemy-sandrevenant-revive/sprite-sheet.png | 150 |
| enemy-rimestalker-move | assets/generated/enemies-v2/enemy-rimestalker-move/sprite-sheet.png | 100 |
| enemy-rimestalker-death | assets/generated/enemies-v2/enemy-rimestalker-death/sprite-sheet.png | 90 |

Scale profiles: `public/assets/generated/enemies-v2/<char>-scale.json` for cryptcrawler, lanternmonk,
bulwark, gibbet, choirwraith, mirehag, sandrevenant, rimestalker.

Wiring notes for code:
- Add `enemies-v2` to the arena slice's `ART_GROUPS`, merge the slice into `art/manifest.json`, then
  `node scripts/gen-art-registry.mjs` (smoke-run on a temp copy: all 20 rows emitted, 256x256, 4 frames).
- `enemy-sandrevenant-revive` is authored to start from `enemy-sandrevenant-death` last frame (index 3, sand mound):
  play death, hold its last frame for the 2 s collapse, then play revive, then resume move.
- `enemy-lanternmonk-attack` 3rd frame (index 2) is the release frame (fire-glob leaves the lantern) — spawn the lob there.
- `enemy-gibbet-attack` 3rd frame (index 2) is the chain-at-full-extension frame — fire the hook pull there.
- `enemy-choirwraith-attack` 3rd frame (index 2) is the scream frame (red sound-rings at the mouth) — start the slow ring there.
- `enemy-bulwark-*`: the shield is on the art's RIGHT; when flipped for leftward movement the shield
  faces left, i.e. always toward the direction of travel — frontal-180° shield logic should use facing.
- Rime Stalker `stalk` alpha 0.25: the body is frost-pale (L* p75 82.5), so at alpha 0.25 it still ghosts
  visibly on dark winter floors; outline stays code-baked per PRD §13.1.
