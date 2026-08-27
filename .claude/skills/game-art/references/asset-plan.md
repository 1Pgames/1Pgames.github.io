# Asset plan

What a generated game actually needs, in generation order. Every row is one
`generate_image` call with one export marker.

Grid rule (measured, not assumed): on a square canvas only `NxN` grids — `1x1`,
`2x2`, `3x3`, `4x4` — produce square cells. `2x4` produces 256x512 cells and
`2x3` produces 341x512 cells; neither can share a scale profile with a `2x2`
asset, and the processor rejects the attempt. For an 8-frame action either
accept `2x4` and hold consistency with `maxBodyScaleCv: 0.08`,
`maxAnchorYStd: 0.05` plus a `sprite_anchor_guide` built from the accepted idle
frame, or spend a `4x4` canvas. Exported sheets are always normalised to square
`cellSize` frames, so the engine side is unaffected.

## Core set (any action game, 28-30 calls)

| Group | Asset | Kind | Grid | Frames | Duration | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| hero | idle | body | 2x2 | 4 | 140 | generate FIRST, `writeScaleProfile` |
| hero | run | body | 2x4 | 8 | 110 | non-square source cells: anchor guide + CV gates, NOT `scaleProfile` |
| hero | attack | body | 2x2 | 4 | 90 | effect stays attached and inside the cell |
| hero | hurt | body | 2x2 | 4 | 90 | brightest frame = the damage flash |
| hero | death | body | 2x2 | 4-6 | 90-110 | non-looping; last frame is the held "defeated" pose |
| enemies-light | 4 archetypes | body | 2x2 | 4 | 110-140 | distinct silhouette mass each |
| enemies-light | ranged archetype attack/telegraph | body | 2x2 | 4 | 90-120 | wind-up frame must read before the shot fires |
| enemies-light | 2 archetype deaths | body | 2x2 | 4 | 90-110 | non-looping; covers the weight classes players see most |
| enemies-heavy | 3 archetypes + boss | body | 2x2 | 4 | 110-150 | boss = largest silhouette in the game |
| enemies-heavy | elite archetype attack/telegraph | body | 2x2 | 4 | 90-120 | same telegraph contract as the light ranged unit |
| enemies-heavy | boss phase 2 (+ attack action) | body | 2x2 | 4 | 90-150 | reuses the boss's `scaleProfile`; visibly distinct palette/damage state, not a recolour tint |
| pickups-fx | xp orb, coin | fx | 2x2 | 4 | 90 | spin loops, one edge-on frame |
| pickups-fx | hit spark, level-up burst | fx | 2x2 | 4 | 60-90 | no character content |
| pickups-fx | projectile | fx | 1x1 | 1 | — | drawn pointing right; engine rotates |
| ui | 2 icon sheets | ui | 2x2 | 4 | — | same optical size and stroke weight |
| ui | title emblem | ui | 1x1 | 1 | — | wordless crest; the engine draws text |
| ui | victory / defeat splash pair | ui | 1x1 | 1 each | — | full-bleed results-screen art, distinct compositions, not palette-swapped |
| bg | backdrop (or 2-3 parallax layers) | bg | 1x1 | 1 each | — | only asset(s) allowed a non-square canvas; see parallax bg below |

## Genre additions

| Genre | Extra assets |
| --- | --- |
| Tower defense | 3-5 tower bodies (2x2 idle + 1x1 muzzle FX each), build-slot marker, path tile set |
| Roguelike / crawler | door, chest, room floor tiles, 2 trap FX, minimap icons |
| Deckbuilder | card back, 8-12 ability icons (2x2 sheets) — card frames are primitives; **≥8 illustrated card-art images (1x1)** — the card IS the content, not an icon riding a primitive frame |
| Auto-battler | unit bodies (2x2 idle each), bench slot, tier badge icons |
| Survival crafting | 6-10 resource icons, 4 tool sprites, campfire FX (2x2), day/night overlay |
| Bullet hell | 4-6 bullet shapes (1x1), 2 charge FX (2x2), boss part sprites |
| Tactics | unit tokens (1x1 each), tile highlight set, ability range marker |
| Deckbuilder / tactics (optional) | portrait per named unit/character (1x1), used in dialogue or unit-detail panels — skip for genres with no named-character screen |

## Volume budgets

| Content | Minimum viable | Comfortable | Cost |
| --- | --- | --- | --- |
| Hero actions | 2 (idle, run) | 5-6 (+ attack, hurt, death, cast) | S each |
| Enemy archetypes | 4 | 8 | S each |
| Enemy attack/telegraph anims | 0 | 1 per ranged/elite archetype | S each |
| Death anims | hero only | hero + 2 enemy weight classes | S each |
| Bosses | 1 (idle only) | 2 (+ attack action, +1 phase-2 variant) | M |
| FX | 3 | 6 | S each |
| UI icons + emblem | 4 icons + emblem | 8-10 icons + badges | S each |
| Victory/defeat splash | 0 (reuse backdrop) | 1 pair, distinct compositions | S |
| Deckbuilder card art | — | 8-12 illustrated cards | S each |
| Portraits | 0 | 1 per named unit (deckbuilder/tactics) | S each |
| Backgrounds | 1 | 3 parallax layers (`bg-layer-0/1/2`) | M |

Below minimum the game reads as a prototype; above comfortable, generation time
starts dominating the build with no visible gain per asset.

## Ordering and dependencies

1. Style profile.
2. Hero idle — it is the reference for scale, palette and identity; every later
   asset is judged against it.
3. Hero remaining actions with the written scale profile.
4. Enemies, in a single group per weight class so silhouette variety can be
   checked in one `art_review` set call.
5. FX and pickups (independent).
6. UI icons and emblem (independent; can start in parallel with hero). Panels,
   buttons and bars are NOT generated — they are primitives.
7. Background last: it is tuned against the finished entity palette.

## Animation defaults

| Action | Frames | Duration/frame | Loop |
| --- | --- | --- | --- |
| idle / breathe | 4 | 140-160 | yes |
| walk | 4 | 130 | yes |
| run | 8 | 100-110 | yes |
| attack / cast | 4 | 80-90 | no |
| hurt | 4 | 80-90 | no |
| death | 4-6 | 90-110 | no |
| pickup spin | 4 | 90 | yes |
| impact FX | 4 | 50-70 | no |
| aura pulse | 4 | 160 | yes |

Total frame time for a non-looping action should stay under ~400ms: longer and
the player sees animation instead of feedback.

## Post-export measurements the engine needs

Providers do not draw every action at the same subject height, and they do not
always face the direction you assumed. Measure once per sheet and record it in
the asset registry:

| Measurement | How | Used for |
| --- | --- | --- |
| Subject height per action | opaque bbox height of each cell | `scale = idleHeight / actionHeight`, re-applied on animation switch |
| Facing | look at the art: which way does the cloak/weapon/lean point | `facesRight` flag driving `setFlipX` |
| Opaque bbox vs cell | bbox / cell size | hitbox radius, so collision matches the visible body |

Skipping the first two produces the two most common "the animation is broken"
reports: the character resizes when it starts moving, and it runs backwards.
