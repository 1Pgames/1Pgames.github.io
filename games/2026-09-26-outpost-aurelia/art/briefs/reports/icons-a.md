# icons-a + ui: report (owner ArtIconsA)

**Tool precondition probe:** `generate_image` → `xai-oauth / grok-imagine-image`, 1024×1024 JPEG, OK.
(`512x512` from game-art rule 0 is rejected by the schema, which only accepts 1024 sizes. Filed to `xd://report_issue`.)

Both groups landed complete:
- `public/assets/generated/icons-a/`: 8 sheets
- `public/assets/generated/ui/`: `icons` and `icons-b` regenerated in place, same ids and same cell order

Staging, raws, attempts and tools live in `art/exports/icons-a/**` and `art/exports/ui/**`.
Every export is `profile hd-fx`, `cellSize 256`, `threshold 150`, `feather 55`, strict, and `qc.passed: true`. Every export was also re-keyed without the chroma guard, as generation-plan §0.2 requires.

## Per-asset table

Regenerations: the plan counts the regenerations of an asset. "Generations" is the total number of calls, including the first one.

| Asset (landed dir) | Grid / frames | Intent | meanDistance (≤52) | outlier | Generations (regens) | Processing path | Visual verdict / notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| icons-a/icons-goods-a | 2x2 / 4 | ferrite, ice, aurelite, alloy | 30.38 | 0.074 | anchor (1) | anchor, copied unchanged | accepted anchor (art/anchors/QC.md) |
| icons-a/icons-goods-b | 3x3 / 9 | rations, prism, cell, power, colonists, morale, temperature, data, reroll | 40.18 | 0.210 | 3 (2) | undivide → reprocess | Regen 1: gen 1 drew cell numbers "1-9" and divider lines. Regen 2: gen 2's violet prism sat 129-154 from magenta and keyed into holes; the prism was redrawn as clear pale-blue glass holding honey-gold light. Accepted. The prism and the goods-a ice are both blue-ish, but they read apart: clear faceted lens vs opaque rock |
| icons-a/icons-tags | 3x3 / 9 | tag-hearth, forge, bul, fr, kin, orb, alert-relay-dark, alert-hab-cold, alert-leech | 33.54 | 0.139 | 2 (1) | undivide → reprocess | Regen 1: gen 1 captioned every icon ("hearth", "forge" …). Accepted with a note: relay-dark kept the teal radio arcs. It separates from tag-fr only by the dead grey lamp and the dangling cable, which still reads at 32 px on the rust alert pill |
| icons-a/icons-alerts | 3x3 / 9 | order-ready, idle-crew, starving, core-hit, alpha, kit-engineer, kit-warden, kit-settler, kit-surveyor | 35.60 | 0.159 | 2 (1) | undivide → reprocess | Regen 1: gen 1's alpha was a furry boar head in a smoke cloud that touched the cell edge. Accepted: the alpha is now a chitin insect queen head with a brass crown. A faint violet haze is left beside the crown, and a pink-orange fringe sits on the order-ready arrow tip; both are invisible at 44 px |
| icons-a/icons-ark | 3x3 / 9 | kit-tinker, ark-hab, ark-forge, ark-grid, ark-bul, ark-sur, ark-cmd + 2 spare cells | 28.97 | 0.070 | 2 (1) | undivide → **compose_cells** → reprocess | Gen 1: badges correct, but kit-tinker was a closed gift box. Gen 2: tinker correct, but it drew an extra crate, dropped the cmd badge and shifted the order. The landed raw is whole cells in manifest order: gen 2 cells 1, 7, 8 and gen 1 cells 1-6, copied 1:1 with no scaling and no painting (`sprite-metadata.json.composite`). Spare frames: 7 = Ark starship, 8 = padlock (see delta) |
| icons-a/icons-bld-1 | 3x3 / 9 | ico-core, drill, borer, harvester, venttap, sail, bank, farm, smelter | 31.12 | 0.073 | 1 (0) | marker export → rekey.py | Image 3 was a reference grid of the accepted Mk I frame-0 sprites. Each icon is a faithful redraw of its building. The outline is the buildings' 2-3 px, not the icon sheets' 4 px, but every silhouette is distinct at 32 px |
| icons-a/icons-bld-2 | 3x3 / 9 | ico-cutter, foundry, relay, silo, hab, commons, pulse, arc, flak | 27.74 | 0.058 | 1 (0) | undivide → reprocess | Faithful redraws. The cutter's violet crystal was briefed as pale amber, because violet is inside the key band |
| icons-a/icons-bld-3 | 2x2 / 4 | ico-wall, ico-beacon + 2 spare cells | 28.13 | 0.024 | 1 (0) | undivide → reprocess | wall and beacon match their sprites; the violet beacon crystal survived keying intact. Spare frames: 2 = upgrade (brass chevron over wrench), 3 = demolish (sledgehammer on cracked plate) |
| ui/icons | 2x2 / 4 | heart, star, coin, bolt (template order) | 36.45 | 0.137 | 1 (0) | undivide → reprocess | heart = rust enamel heart, star = brass star, coin = brass Data token with a chip stamp, bolt = amber lightning. `temperature-single` (99% warm) warning: all four glyphs are warm by meaning, so this is accepted |
| ui/icons-b | 2x2 / 4 | shield, skull, clock, levelUp (template order) | 28.30 | 0.073 | 1 (0) | undivide → reprocess | shield = riveted cream plate with a teal stripe, skull = glass-chitin insect skull (no red), clock = brass stopwatch, levelUp = double amber chevron |

Frame maps: frame `i` = manifest `icons[i]`, row-major, 256×256 cells, `duration 0` (static).
- Frames past the named list are the spares shown in the table above: ark 7-8, bld-3 2-3.
- No red or green outlines were painted anywhere.
- No text appears in any landed image. Gen 1 of tags and gen 1 of goods-b had text; both were rejected.

## Coverage (content id → icon), zero placeholders

All ids come from the manifest `icons[]`, and every one maps to a generated frame:
- goods: ferrite, ice, aurelite, alloy (goods-a 0-3); rations, prism, cell (goods-b 0-2)
- stats: power, colonists, morale, temperature, data, reroll (goods-b 3-8)
- tags: 6 (tags 0-5)
- alerts: relay-dark, hab-cold, leech (tags 6-8); order-ready, idle-crew, starving, core-hit, alpha (alerts 0-4). All 8 PRD `AlertKind`s are covered.
- kits: engineer, warden, settler, surveyor (alerts 5-8); tinker (ark 0)
- Ark branches: hab, forge, grid, bul, sur, cmd (ark 1-6)
- buildings: all 20 (bld-1 0-8, bld-2 0-8, bld-3 0-1)
- template ICON names: heart, star, coin, bolt, shield, skull, clock, levelUp

Directive and protocol glyphs belong to icons-b (ArtIconsB), not this report.

## Wiring contract (consumers)

`gen-art-registry.mjs` emits `ICON.<name> = { key, frame }` from the manifest `icons[]` index. Keys stay unchanged. The template reads `ICON.coin`, `ICON.star` (menu/meta), and `ICON.heart`, `ICON.skull` (hud); those stay on `ui/icons` frames 0-2 and `ui/icons-b` frame 1, as before.

## Set-level gates

- `art_review` set call: 10 sheets, renderScale 96, `passed: true`. The closest cross-sheet silhouette pair is 0.103 (alerts vs ark), and no silhouette findings were reported.
  - Every sheet has `value-plan-miss` warnings, mostly lights at 31-53% against a planned 15%. Scope: the valuePlan was calibrated on world actors, so it does not apply to icons. The accepted goods-a anchor itself runs 36% lights. Reported, not acted on.
- figure-ground: not applicable, because this group has no floor, backdrop or field.
- `manifest-lint.py art/manifest.json`: exit 0, with 0 errors and 0 warnings (run read-only; I did not edit the manifest).
- 32/96 px readability contact sheets: `art/exports/icons-a/qc/*.png`. Each is the sheet over the HUD chip tone `#1a1418` plus every frame at 96 and 32 px.

## Processing tools (all in `art/exports/icons-a/tools/`, deterministic, pixel-provenance recorded in metadata)

- `undivide.py`: xai draws 2-4 px pale-pink divider lines at the implied cell boundaries on 7 of 9 sheets, measured at `rgb(255,135-148,200-219)`. They sit at about 150 from magenta, on the threshold, so they survive keying half-opaque and fail `source-edge-touch` on every frame even though every icon has a wide margin.
  - The prompt never produced them away. I tried "no grid lines / divider lines", dropping the word "grid", and "one uninterrupted background"; the lines appeared anyway.
  - The script repaints only pinkish-light key pixels inside a ±10 px band at internal boundaries. The original raw is kept as `raw-original.jpg`.
- `reprocess.py`: `rekey.py` plus an optional `protectColours` list. The measured result on the protect list is negative (see Criteria), so no landed sheet uses it.
- `compose_cells.py`: builds one raw from whole cells of two generations (used for icons-ark only).
- `make_ref.py`: lays the accepted building frame-0 sprites into the reference grid used as Image 3. It is a layout of sibling exports; nothing is drawn.
- `preview.py`: the QC contact sheets.

## Criteria (retracted / rescoped / measured)

- **Provider-rule addendum (measured, icon sheets):**
  - Do not number or name cells in the prompt. "1 rations - …" came back with the digits drawn, and "hearth - …" came back with captions. Describe positions as "Top row, left to right: <object>; …".
  - Keep violet, lavender and pink out of icon subjects. Violet `rgb(178,103,245)`, `(148,79,224)` and `(199,129,253)` measured 129-154 from magenta and keyed into holes at threshold 150. The generation-plan's "all 18 palette colours ≥ 207 from magenta" is true of the palette LIST, not of the violets xai actually paints.
- **`--protect-colours` cannot rescue key-band violets on xai pink-key raws.** The pink key `(252,81,170)` measures 117 from magenta but only 107-113 from those violets, so the guard keeps the key itself. Result: every frame failed `source-edge-touch`. Measured, so do not retry it.
- **meanDistance**: 27.7-40.2 across the set, all under 52. Read it as distance from the palette list; goods-b is highest because of the saturated green, frost-blue and teal glyph fills the list lacks.
- **value-plan lights**: rescoped as above, a warning only for icons (canon anchor 36%).
- **Post-review pixel transforms**: none at runtime for icons (the HUD camera is never graded; interface-direction §4). Icons were reviewed composited on `#1a1418`, the chip fill they render on (alpha 0.82).

## manifest-delta

`attempts` below counts regenerations, the plan §0.7 counter; each total generation count is one higher. goods-b is at 2 regenerations across two different symptoms; the exception entry makes the third generation auditable. `icons` appends name the spare frames, so the registry exposes them and nothing is dead.

```json
{
  "manifest-delta": {
    "icons-a": {
      "icons-goods-b": { "attempts": 2 },
      "icons-tags": { "attempts": 1 },
      "icons-alerts": { "attempts": 1 },
      "icons-ark": {
        "attempts": 1,
        "icons": ["kit-tinker", "ark-hab", "ark-forge", "ark-grid", "ark-bul", "ark-sur", "ark-cmd", "ark-ship", "ark-locked"]
      },
      "icons-bld-1": { "attempts": 0 },
      "icons-bld-2": { "attempts": 0 },
      "icons-bld-3": { "attempts": 0, "icons": ["ico-wall", "ico-beacon", "ico-upgrade", "ico-demolish"] }
    },
    "ui": {
      "icons": { "attempts": 0 },
      "icons-b": { "attempts": 0 }
    },
    "qcExceptions": [
      { "id": "icons-goods-b", "reason": "3 generations over 2 distinct symptoms (drawn cell numbers; violet prism keyed to holes); third take visually clean, prism redrawn as clear glass" },
      { "id": "icons-ark", "reason": "raw composed from whole cells of 2 generations (compose_cells.py): gen1 badges + gen2 tinker crate/ship/padlock, 1:1 pixels, provenance in sprite-metadata.json.composite" }
    ]
  }
}
```
