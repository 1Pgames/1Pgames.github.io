# enemies-v2 — brief + report (ArtEnemies)

Probe (rule 0): `generate_image` 512-class throwaway call succeeded on `xai-oauth/grok-imagine-image`.
Scope: PRD-V2 §11 rows `enemies-v2` — 8 enemies, 20 sheets, 256 cells, 2x2.
Owned outputs: `public/assets/generated/enemies-v2/**`, this folder, `art/v2/ArtEnemies.*`.

## Silhouette contract (the brief)

| char | mass at 48-120 px | differs from |
|---|---|---|
| cryptcrawler | flattest, widest: 8-leg star round a small rat body, w/h 2.50 | ratking (writhing mound), thornhound (long quadruped) |
| lanternmonk | short squat hooded pear + lantern hanging out front (amber = hazard telegraph) | bonecaster (tall thin staff-bearer) |
| bulwark | tall upright slab: door-sized bone shield on the RIGHT, skull peeking top-left | paleknight (armoured biped) |
| gibbet | tall dangling vertical line, noose stub above, hook + chain the one sideways shape | ashwraith (tatter column) |
| choirwraith | wide bell: raised arms + flared hem, black open mouth notch, pale lilac-grey | ashwraith, shroudmoth |
| mirehag | low wide lumpy mound bent forward on a cane, mud drips | husk (slumped rectangle) |
| sandrevenant | broad upright reaching biped in pale parchment wrappings, sand streams | paleknight (see exception) |
| rimestalker | long angular spidery crouch with an ice-shard ridge, frost-pale + ice blue | wretch (low hook), thornhound |

Value rule (task): key forms mid-value (L* >= 40) so bodies separate from dark floors. Every prompt
named the lit body hexes (#8a8392/#a89f8c/#e8e0d0; winter: frost-pale + #9fd3ff) and kept #0d0b10 for
outline and deep folds only. Red eyes on every enemy; no green anywhere (player colour).

## Method actually used (and why the documented routes were not)

1. **Base frame, one per enemy**: one `generate_image` 1x1 call per enemy, vision anchor
   `art/refs/vision-1.png` passed as `input_paths` Image 1 + fixing clause. Raw frames archived in
   `raw-frames/<char>-base*.jpg`.
2. **Measured failure of the whole-sheet routes on this provider** (all xai, this session):
   - text-to-2x2 sheets returned **3x2 grids of 6 identical poses** three times (crawler), and 4
     identical poses for monk/bulwark — no animation at all;
   - the `sprite_anchor_guide` route (guide as Image 1, vision as Image 2) returned the guide copied
     **pixel-for-pixel in all 4 cells** with a visible cell seam (bulwark) — the guide cannot induce
     pose change on xai edit mode.
   So the anchor guide was retired for this group and replaced by:
3. **Per-frame edits of the accepted base**: every animation frame is one `generate_image` edit call
   with the accepted base as the ONLY input ("keep identity, colours, rendering, size and framing
   exactly; change ONLY the pose: ..."). Every frame of every action derives from the same base, so
   identity and camera distance are pinned without chaining drift.
4. **Deterministic assembly** (`tools/ae_assemble.py`): the four 1024x1024 frames are pasted
   unscaled into one 2x2 raw. Each frame is translated (never resampled) so its own subject is
   centred with its lowest point at 0.86 of a per-character square side (`raw-frames/<char>.box.json`);
   one side per character = one source-cell size = one pixel scale across move/attack/revive. The
   assembled raw is what sprite-forge processed and is preserved as `raw-source.png` in every asset dir.
5. **Processing** (`tools/ae_proc.sh`): `process-sprite.ts` with the `pixel-art-body` parameters
   (feet align, scale preserve, nearest, hard key, strict, cellSize 256). Moves write the scale
   profile; attacks/revive bind it with `maxBodyScaleCv 0.08 / maxAnchorYStd 0.05 /
   maxProfileScaleDrift 0.08`; deaths are unbound (canon rule), componentMode all.
   `--style-profile` was dropped from the KEYER after measuring it: the chroma guard protected
   palette anchor `#c084fc` (146.3 from magenta) and thereby kept 17-28 k pink background pixels per
   sheet as visible fringes on xai's pink (≈ rgb 253,55,165) background. The style profile still
   governs prompts and the palette gate.

Post-review pixel transforms: none after acceptance. The only transforms are the translation-only
assembly and sprite-forge's own key/align/scale, all before review and reproducible from
`raw-frames/` + `tools/`. Runtime tints/outlines (PRD §13.1 code-baked outline, stalk alpha) are
the integrator's and were not reviewed here.

## Per-asset table

attempts = regenerations of that sheet's frames beyond the first accepted pipeline pass (provider
"exhausted chain" refusals are counted as attempts on the frame that needed re-asking).

| id | frames/cell | src cell | ms | palette meanDistance (≤48) | L* p75 / share L*≥40 | bodyScaleCv | anchorYStd | profile | attempts | exception |
|---|---|---|---|---|---|---|---|---|---|---|
| enemy-cryptcrawler-move | 4 / 256 | 1024 | 90 | 20.86 | 60.2 / 0.45 | 0.152 | 0.0045 | writes cryptcrawler | 4 (base) | silhouette note |
| enemy-cryptcrawler-death | 4 / 256 | 1024 | 90 | 20.81 | — / 0.45 | 0.147 | 0.0039 | unbound | 0 | deaths |
| enemy-lanternmonk-move | 4 / 256 | 1024 | 150 | 20.37 | 49.5 / 0.37 | 0.006 | 0.0013 | writes lanternmonk | 1 | — |
| enemy-lanternmonk-attack | 4 / 256 | 1024 | 110 | 22.05 | — / 0.43 | 0.283 | 0.0028 | bound (applied) | 0 | postureChange |
| enemy-lanternmonk-death | 4 / 256 | 1024 | 100 | 21.01 | — / 0.38 | 0.123 | 0.0045 | unbound | 0 | deaths |
| enemy-bulwark-move | 4 / 256 | 855 | 150 | 23.19 | 60.7 / 0.46 | 0.035 | 0.0060 | writes bulwark | 1 | — |
| enemy-bulwark-death | 4 / 256 | 1024 | 100 | 23.41 | — / 0.44 | 0.207 | 0.0028 | unbound | 2 | deaths |
| enemy-gibbet-move | 4 / 256 | 1013 | 140 | 22.73 | 61.5 / 0.44 | 0.037 | 0.0025 | writes gibbet | 1 | frame reuse |
| enemy-gibbet-attack | 4 / 256 | 1013 | 100 | 23.49 | — / 0.41 | 0.002 | 0.0022 | bound (applied) | 0 | — |
| enemy-gibbet-death | 4 / 256 | 1024 | 100 | 22.57 | — / 0.44 | 0.364 | 0.0019 | unbound | 2 | deaths |
| enemy-choirwraith-move | 4 / 256 | 1010 | 130 | 38.82 | 75.8 / 0.66 | 0.104 | 0.0174 | writes choirwraith | 1 | — |
| enemy-choirwraith-attack | 4 / 256 | 1010 | 110 | 40.17 | — / 0.69 | 0.044 | 0.0076 | bound (applied) | 0 | — |
| enemy-choirwraith-death | 4 / 256 | 1010 | 100 | 34.03 | — / 0.61 | 0.204 | 0.0162 | unbound | 0 | deaths |
| enemy-mirehag-move | 4 / 256 | 930 | 150 | 26.02 | 54.7 / 0.39 | 0.018 | 0.0025 | writes mirehag | 1 | — |
| enemy-mirehag-death | 4 / 256 | 1024 | 100 | 28.24 | — / 0.52 | 0.227 | 0.0039 | unbound | 0 | deaths |
| enemy-sandrevenant-move | 4 / 256 | 977 | 140 | 20.66 | 71.3 / 0.54 | 0.005 | 0.0045 | writes sandrevenant | 1 | silhouette note |
| enemy-sandrevenant-death | 4 / 256 | 977 | 110 | 29.18 | — / 0.68 | 0.312 | 0.0080 | unbound | 0 | deaths |
| enemy-sandrevenant-revive | 4 / 256 | 977 | 150 | 29.19 | — / 0.67 | 0.107 | 0.0081 | bound (applied) | 0 | postureChange |
| enemy-rimestalker-move | 4 / 256 | 1024 | 100 | 40.12 | 82.5 / 0.65 | 0.018 | 0.0037 | writes rimestalker | 0 | — |
| enemy-rimestalker-death | 4 / 256 | 1024 | 90 | 43.05 | — / 0.63 | 0.245 | 0.0060 | unbound | 0 | deaths |

Every export: strict QC `passed: true`, `background.contaminated: false`, no
`sprite-metadata.failed.json` left. Every `-move` wrote its `<char>-scale.json` (verified on disk);
every bound sibling reports `profileApplied: <char>`.

Frame maps (row-major, frame 0-3) are the per-asset action strings in `ArtEnemies.groups.json`.
Gameplay-event frames: monk attack f2 = lob release, gibbet attack f2 = hook at full extension,
choir attack f2 = scream/ring start (0-indexed). Revive starts from death f3's mound.

## Group gates

**art_review set call** (renderScale 48, 8 v2 moves + canon bonecaster, ratking, ashwraith,
paleknight, `characters` set so only cross-character pairs gate): 2 collisions —
- cryptcrawler × lanternmonk 0.041: measured bbox w/h 2.50 vs 1.18 and heights 73 vs 98 px; the
  occupancy metric compares two SMALL-in-cell subjects, not two similar shapes. Recorded exception.
- sandrevenant × paleknight (canon) 0.041: genuinely similar upright-biped mass; separated by value
  (L* p75 71.3 vs 40.8) and hue (parchment vs cold steel). Recorded exception; if playtest confuses
  them, the fix is a regenerated revenant base with a sand-column lower body (3 sheets).
All other cross pairs 0.055-0.179. Value warnings (`value-plan-miss:*`, one `value-tier-absent:light`
on lanternmonk-move) are warn-only and expected: the V2 task deliberately moves bodies up the value
scale against the profile's 60/32/8 plan.

**figure-ground.py**: not run by this group — it gates FIELDS (floors/backdrops); this group ships
actors only. These 8 move sheets are the cast the floor owners must pass as `--actors` for castle
(choirwraith), outlands (mirehag), desert (sandrevenant), winter (rimestalker) plus the shared 4.

**manifest-lint**: merged slice (current `art/manifest.json` + this group + its qcExceptions),
run from the game root: `0 error(s), 2 warning(s)` — both pre-existing canon warnings
(duplicate vision-1 anchor; `writeScaleProfile` as path — this slice uses the path form on purpose to
mirror the sibling groups' on-disk layout, and the files exist).

**Registry smoke**: `node scripts/gen-art-registry.mjs` run in a temp root with the merged manifest:
20 `enemies-v2` rows, 256x256, 4 frames each, correct loop flags. `src/data/art.ts` untouched.

## CRITERIA

- **"L* ≥ 40 on key forms" (new, V2 task)** — operationalised as the 75th percentile L* of opaque
  pixels (key lit forms; the median is dominated by the 1px outline and shade). SCOPE: enemies-v2
  actor sheets only. Validated against canon before use: canon moves measure p75 25.9-43.7 (e.g.
  husk 31.5, paleknight 40.8), so canon FAILS it — this is a deliberate V2 raise of the bar per the
  task, NOT a retroactive reject criterion; it must not be swept over enemies-light/heavy. All 8 v2
  moves pass (49.5-82.5).
- **`sprite_anchor_guide` for frame consistency — RESCOPED** for xai edit mode: measured to copy the
  guide verbatim into all 4 cells (zero pose change). Frame consistency is instead enforced by
  single-base edits + translation-only assembly + feet alignment: move anchorYStd 0.0013-0.0174,
  bodyScaleCv ≤ 0.037 on every upright move (crawler 0.152 and choirwraith 0.104 are tail-curl /
  arms-overhead bbox changes with stable feet).
- **Chroma guard via `--style-profile` on the keyer — RESCOPED** off for this group: measured to keep
  17,792-27,738 background pixels per sheet as pink fringe because xai's key colour is pink
  (≈253,55,165), not #FF00FF, and it lands near protected anchor #c084fc. No enemy here carries a
  near-magenta identity hue, so nothing needed protection.
- **meanDistance** read as distance-from-list only: highest values are the pale lilac choir (38-40)
  and frost-blue winter stalker (40-43), both because the list lacks those hues, all ≤ 48.
