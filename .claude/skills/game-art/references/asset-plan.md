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

## Per-family asset plans

The core set below is family **A**'s set, not a universal one. Generating it for
a board puzzle spends ~20 calls on assets the game never draws; skipping the
dual-coding rule on a match/sort board ships levels a colourblind player cannot
finish. Pick the family first, then generate only its table.

| Code | Family | Art weight | Section |
| --- | --- | --- | --- |
| A | real-time-arena | heavy, 28-30 calls | Core set below, unchanged |
| B | board-puzzle | medium, 10-16 | B |
| C | side-view-physics | medium, 14-20 | C |
| D | turn-based-cards-tactics | medium-heavy, 18-26 | D |
| E | track-vehicle | medium, 12-18 | E |
| F | idle-tycoon | icon-dominated, 8-12 | F |
| G | table-dice | icon-dominated, 9-14 | G |
| H | word-trivia | near art-free, 4-7 | H |
| J | hypercasual | minimal, 4-8 (0 for a prototype) | J |
| I | hybrid composition (pattern, not a family) | core family + 4-8 | I |

Counts below are written `min / comfortable`. Below min the family reads as a
prototype; above comfortable, generation time dominates the build.

### B — board-puzzle (match-swap, blast, merge-2, sort, block, screw, tile-match)

| Group | Asset | Kind | Grid | Count | Notes |
| --- | --- | --- | --- | --- | --- |
| pieces | piece faces, idle state | ui | 3x3 | 6 / 9 pieces, ONE call | cells are independent 1x1 pieces, not animation frames |
| pieces | piece faces, clear-burst state | ui | 3x3 | same cell order, ONE call | cell N = piece N mid-clear; the engine cross-fades idle → burst, then scales out |
| pieces | special pieces | ui | 2x2 or 3x3 | 3 / 5 | bomb, line/rocket, rainbow, locked-or-frozen, genre special (screw, key, gift) |
| fx | clear shatter | fx | 2x2 | 4 @ 60-70 | one neutral shatter shared by all pieces; per-piece bursts only for the 3 most frequent pieces |
| ui | goal icons | ui | 2x2 / 3x3 | 4 / 8 | one per goal type (collect, drop, clear-jelly, order); same optical size and stroke weight as the piece glyphs |
| ui | booster icons | ui | 2x2 | 3 / 4 | shuffle, hammer, swap, extra-moves |
| ui | title emblem | ui | 1x1 | 1 | wordless crest |
| bg | chapter backdrop | bg | 1x1 | 1 / 3 | one per 10-level chapter, 9:16 portrait, cover-fit |

Board chrome — cells, frame, gutters, selection highlight, move and goal
counters — is geometry: `ui/primitives.ts` plus `TEX.square`. Never generated.

**Dual coding (hard rule).** Every piece differs from every sibling in *both*
hue and silhouette. One channel is not enough: ~8% of male players cannot
separate the classic puzzle hue pairs, and every player loses the read at
`renderScale` on a busy board.

| Piece | Silhouette | Hue band |
| --- | --- | --- |
| 1 | circle / sphere | cyan |
| 2 | rounded square | red |
| 3 | triangle / teardrop | yellow |
| 4 | hexagon | violet |
| 5 | five-point star | green |
| 6 | diamond / crescent | orange |
| 7 | capsule / pill | white-neutral |
| 8 | flower / cog | magenta |
| 9 | heart / shield | deep blue |

Banned pairs — never assign these two hues to two pieces whose silhouettes are
in the same family (both round, both angular): red/green, green/brown,
blue/violet, cyan/grey, yellow/light-green, pink/grey, orange/red. If the design
demands a banned hue pair, the shapes must be from opposite families and the
value tiers must differ.

The check is visual and cheap: after export, look at the pieces sheet, then look
at it desaturated. Two pieces indistinguishable without hue means regenerate the
**shape**, never re-tune the colour. Pair it with one `art_review` set call over
the pieces sheet for silhouette variety.

Market note: pure match-swap is the worst default (new-title success rate 0.8%).
Prefer the growing niches — sort +170-229%, block +176%, merge +65-74% YoY — or
a B core inside the I hybrid pattern.

### C — side-view-physics (platformer, runner, physics-driving)

| Group | Asset | Kind | Grid | Count | Notes |
| --- | --- | --- | --- | --- | --- |
| hero | idle | body | 2x2 | 4 @ 140 | generate FIRST, `writeScaleProfile` |
| hero | run | body | 2x4 | 8 @ 100-110 | non-square source cells: anchor guide + CV gates, NOT `scaleProfile` |
| hero | jump (launch + rise) | body | 2x2 | 4 @ 90 | non-looping; last frame is the held rise pose |
| hero | fall | body | 2x2 | 2-4 @ 110 | loops; a distinct pose, never a reversed jump |
| hero | slide / roll | body | 2x2 | 4 @ 90 | silhouette drops to =<60% standing height — that drop *is* the mechanic |
| props | obstacles | body | 2x2 / 3x3 | 3 / 5, one cell each | hazard vs. solid must differ by silhouette, not only hue |
| terrain | ground tile strip | map | map-forge | 1 family + 3-4 variants | `xd://map_extract_terrain_tiles`, then `xd://map_trace_geometry` for the collision band — never a hand-cut sheet |
| fx | dust / impact | fx | 2x2 | 4 @ 50-70 | |
| pickups | coin / collectible | fx | 2x2 | 4 @ 90 | spin loop, one edge-on frame |
| bg | `bg-layer-0` / `-1` / `-2` | bg | 1x1 each | 3, MANDATORY | three separate calls |
| ui | icon sheet + emblem | ui | 2x2 + 1x1 | 4 + 1 | |

**3-layer parallax is mandatory for C.** A side-view camera over a single
backdrop reads as a static photograph and destroys the sense of speed — the one
thing a runner sells. The pipeline already exists: layers register as
`bg-layer-0` (back) through `bg-layer-2` (front) in the `bg` group and
`ui/background.ts` picks them up ahead of the single-backdrop fallback, so the
wiring cost is zero. Scroll factors: layer 0 at 0.1-0.2x camera, layer 1 at
0.4-0.5x, layer 2 at 0.8-1.0x. Each layer is drawn with its own value tier —
layer 0 lightest and lowest contrast, layer 2 darkest — or the parallax reads as
smearing instead of depth.

### D — turn-based-cards-tactics (deckbuilder, tactics, auto-battler)

| Group | Asset | Kind | Grid | Count | Notes |
| --- | --- | --- | --- | --- | --- |
| cards | card back | ui | 1x1 | 1 | |
| cards | card art | ui | 1x1 each | 8 / 12 | the card IS the content; frames and borders are primitives (`ui/cards.ts`) |
| cards | ability icons | ui | 3x3 | 8 / 12 | one call per 9; identical optical size |
| units | unit idle bodies | body | 2x2 | 4 / 8 units @ 110-140 | distinct silhouette mass each |
| units | unit attack | body | 2x2 | 2 / 4 units @ 90 | the units the player sees most |
| units | portraits | ui | 1x1 each | 0 / 1 per named unit | only with a dialogue or unit-detail panel |
| ui | tier / status badges | ui | 2x2 | 4 / 8 | |
| fx | hit, buff | fx | 2x2 | 2 calls, 4 @ 60-90 | |
| bg | battle backdrop | bg | 1x1 | 1 | |

Board furniture — bench slots, tile highlights, range markers, the tableau — is
primitives. Tactics variants add 1x1 unit tokens only when the board view is
separate from the battle view. The Genre additions table below still applies to
D and A.

### E — track-vehicle (top-down racing, drift, laps)

| Group | Asset | Kind | Grid | Count | Notes |
| --- | --- | --- | --- | --- | --- |
| vehicles | player vehicle | body | 1x1 | 1 | drawn pointing UP for top-down (right for side-view); the engine rotates. `writeScaleProfile` from this cell |
| vehicles | opponent vehicles | body | 1x1 each | 3 | **recolour-by-design, not `setTint`**: each opponent is a separately generated variant with its own chassis silhouette, decals and hue |
| vehicles | player lean / turn | body | 2x2 | 0 / 4 @ 70 | hard-left, left, right, hard-right; drift games need it |
| terrain | track tile strip | map | map-forge | 1 road family + 3-4 variants | straight, curve, apex, kerb via `xd://map_extract_terrain_tiles`; collision band from `xd://map_trace_geometry` |
| props | trackside props | body | 2x2 / 3x3 | 4 / 6, one cell each | tyre stack, sign, tree, barrier, crowd block, lamp |
| fx | boost flame, skid puff, crash burst | fx | 2x2 | 3 calls, 4 @ 50-90 | |
| ui | lap/checkpoint marker, icon sheet, emblem | ui | 1x1 / 2x2 | 3 | |
| bg | horizon backdrop | bg | 1x1 | 1 | |

A `setTint` clone pack is the signature failure of this family: four cars of the
same silhouette in one frame are unreadable at speed, and the results screen
shows four identical shapes with different hues. Four generated variants cost
three extra calls and are the difference between a race and a colour test.

### F — idle-tycoon (generators, managers, prestige, offline progress)

| Group | Asset | Kind | Grid | Count | Notes |
| --- | --- | --- | --- | --- | --- |
| icons | generator icons | ui | 3x3 x2 | 8 / 12 | `hd-fx`, centred, transparent margin; identical optical size and stroke weight *across both sheets* — they sit in one scrolling list where any drift is visible |
| icons | upgrade icons | ui | 3x3 x2-3 | 10 / 20 | must differ from generator icons as a *class*: generators are objects, upgrades are symbols |
| icons | currency + prestige glyphs | ui | 2x2 | 4 | soft, hard, prestige, offline-earnings |
| fx | prestige burst, income pop | fx | 2x2 | 2 calls, 4 @ 60-90 | |
| ui | manager portraits | ui | 1x1 each | 0 / 4-6 | only if managers are named characters with a panel |
| ui | title emblem | ui | 1x1 | 1 | |
| bg | backdrop | bg | 1x1 | 1 | one is enough: the screen is 80% list |

An idle screen is an icon list, so the whole budget goes into icon
differentiation, not characters. Two icons that read alike at 64px cost the
player a purchase decision every tap. Simulation is #1 by downloads (6.3B on
Google Play) and the genre's art bar is icon clarity, not fidelity.

### G — table-dice (solitaire family, dice-board loop, ludo)

| Group | Asset | Kind | Grid | Count | Notes |
| --- | --- | --- | --- | --- | --- |
| cards | card back | ui | 1x1 | 1 | the single most-seen asset in a solitaire build |
| cards | suit glyphs (solitaire) or tile faces (tile-match) | ui | 2x2 (4 suits) / 3x3 (6-9 faces) | 1-2 calls | dual coding as in family B: the glyph *shape* must carry the read with hue removed — red/black suit pairs are the classic 48px failure |
| dice | dice faces 1-6 | ui | 3x3 | 6 of 9 cells | spare cells take special faces: multiplier, wildcard, blank |
| board | board tile icons | ui | 3x3 x2 | 8 / 12 | cash, attack, shield, roll-again, chest, jail, bonus, travel |
| collection | collection badges | ui | 3x3 | 6 / 10 | framed and metallic so they read as collectable, not as flat icons |
| fx | win burst, dice-land impact | fx | 2x2 | 2 calls, 4 @ 50-90 | |
| ui | title emblem | ui | 1x1 | 1 | |
| bg | table / board backdrop | bg | 1x1 | 1 | |

Card faces, pips, felt, tableau slots and the board path are primitives plus
text. The dice-board loop monetises through its collection layer
($27-43 IAP/install for the Monopoly GO pattern), so collection badges are
content, not decoration. Solitaire is evergreen (35M MAU on the Microsoft title)
and its entire art budget is the card back plus one backdrop.

### H — word-trivia (word-connect, crossword-lite, quiz)

| Group | Asset | Kind | Grid | Count | Notes |
| --- | --- | --- | --- | --- | --- |
| ui | category icons | ui | 2x2 / 3x3 | 4 / 8 | one per category or chapter |
| ui | hint / booster icons | ui | 2x2 | 3 / 4 | reveal-letter, shuffle, skip, coin |
| ui | title emblem | ui | 1x1 | 1 | |
| fx | word-solved burst | fx | 2x2 | 4 @ 60 | |
| bg | backdrop | bg | 1x1 | 1 | |

This family is nearly art-free by design. Letter tiles, the answer grid, the
shuffle wheel and the keyboard are geometry plus text (`ui/primitives.ts`,
`TEX.square`, the `TEXT` presets). Generating letter tiles bakes the alphabet
into pixels, breaks localisation and multiplies the call count by 26 for zero
visible gain. Spend the saved budget on level and word-list content.

### J — hypercasual (tap-timing, stacking, swerve, rise/drop, io-lite, score-chase)

| Group | Asset | Kind | Grid | Count | Notes |
| --- | --- | --- | --- | --- | --- |
| hero | player object skin | body | 1x1 (2x2 if it animates) | 1 | the one object: ball, block, knife, car, stack piece |
| skins | collectible skin variants | ui | 4x4 | 10 / 15 in ONE call | 16 slots; each cell is an independent 1x1 skin, not a frame. This is the meta layer and the only place J art volume belongs |
| fx | pop / trail / perfect burst | fx | 2x2 | 1-2 calls, 4 @ 50-70 | |
| ui | icon sheet + emblem | ui | 2x2 + 1x1 | 0 / 2 | |
| bg | backdrop | bg | 1x1 | 1 | flat gradient field; the obstacle rhythm carries identity, not the sky |

Obstacles, platforms, walls, the stack and the ground are primitives recoloured
from `PALETTE` (`TEX.square`, `TEX.spike`, `TEX.disc`, `TEX.ring`). io-lite
variants skin the bots from the same 4x4 sheet.

**A J prototype may ship with zero `generate_image` calls.** The mechanic has to
read in 10 seconds; a primitives-only build proves or kills that in one session,
and art spent before the mechanic is validated is art thrown away. The
milestone, not the style, is what is relaxed: once the mechanic is accepted, the
hero skin and the 4x4 skin sheet are generated before the build ships.

### I — hybrid composition (pattern, not a family)

A casual core from J, B or F plus a meta layer. Art plan = the core family's
table, unchanged, plus these meta-kit rows once:

| Group | Asset | Kind | Grid | Count | Notes |
| --- | --- | --- | --- | --- | --- |
| meta | saga map node icons | ui | 2x2 | 4 | locked, current, cleared, boss node |
| meta | star + streak badges | ui | 2x2 | 4 | 1/2/3-star, daily-streak flame |
| meta | reward-track / chest icons | ui | 3x3 | 6-9 | closed, opening, tier chests, track milestone |
| meta | decor / renovation items | ui | 3x3 | 0 / 6-9 | decor meta only; each cell is one placeable item |
| meta | collection cards | ui | 1x1 each | 0 / 6-12 | same contract as the G collection badges |

Cost: +4-8 calls over the core family, +8-16 with decor or collection cards.
Hybrid-casual is the only growing segment (+20-23% YoY) and its meta layer is
worth 5-20x the LTV of the pure casual core, so this is the one place where
extra art volume has a measured return. The onboarding pattern (Last War,
Whiteout) is a casual minigame skin over a deep meta: the minigame art comes
from the core family table and must look *simpler* than the meta art, not
richer.

## Call budgets and fallback ladder per family

| Family | `generate_image` calls (min / comfortable) | Fallback 1: template art | Fallback 2: procedural |
| --- | --- | --- | --- |
| A real-time-arena | 22 / 30 | ship `template/public/assets/generated/{hero,enemies-light,enemies-heavy,pickups-fx,props,arena,bg,ui}` as-is | `TEX.disc` hero, `TEX.spike` enemies, `TEX.star` pickups, `PALETTE` hues |
| B board-puzzle | 10 / 16 | `ui/icons` + `ui/icons-b` cover goal and booster icons; `bg/arena` as the chapter backdrop | pieces from `TEX.disc` / `TEX.square` / `TEX.spike` / `TEX.star` / `TEX.ring` — five distinct silhouettes, so dual coding survives the fallback |
| C side-view-physics | 14 / 20 | `hero/hero-idle` + `hero/hero-run` as the runner body; `props/{rock,stump,pillar}` as obstacles; `bg/arena` as a single backdrop (parallax is lost — regenerate the 3 layers before shipping) | `TEX.square` platforms, `TEX.spike` hazards, scrolling primitive bands as layers |
| D turn-based-cards-tactics | 18 / 26 | template hero and enemy bodies as unit art; `ui/icons` as ability icons; `ui/cards.ts` already draws frames | primitive cards (frame + text + `TEX.star` glyph), `TEX.disc` unit tokens |
| E track-vehicle | 12 / 18 | `props/{rock,stump}` trackside, `bg/arena` horizon, `arena/floor` as the road surface | `TEX.square` chassis with a `TEX.spike` nose, one hue per opponent, road from `TEX.square` bands |
| F idle-tycoon | 8 / 12 | `ui/icons` + `ui/icons-b` (8 slots) as generator icons; `bg/arena` backdrop | `TEX.disc` / `TEX.square` / `TEX.star` glyph plates with `PALETTE` hues plus text labels |
| G table-dice | 9 / 14 | `ui/icons` as board tile icons; `bg/arena` as the table | primitive card back and faces, `TEX.disc` pips, `TEX.star` badges |
| H word-trivia | 4 / 7 | `ui/icons` as category icons | already primitive-first: `TEX.square` tiles + `TEXT` presets; a primitives-only H build is shippable |
| J hypercasual | 0 (prototype) / 4-8 (ship) | `pickups-fx/coin` as the collectible, `bg/arena` backdrop | full procedural: `TEX.disc` / `TEX.square` / `TEX.spike` — the accepted prototype path |
| I hybrid | core family + 4-8 (+8-16 with decor/collections) | core family's fallback plus `ui/icons` for meta badges | primitive nodes, bars and badges from `ui/primitives.ts` |

Ladder rules:

1. Never lower a QC gate to keep a generated asset. Drop the asset to the next
   rung instead; `maxPaletteDistance` and the `art_review` thresholds are not
   negotiable per asset.
2. Fall back by whole **group**, never by single asset. One procedural piece
   among eight generated pieces is more visible than eight procedural pieces.
3. Template art is family A's vibrant-chibi set. Using it under a different
   style profile means the whole run adopts vibrant chibi, or the borrowed
   assets get regenerated — mixing profiles is not a fallback, it is a bug.
4. Record the rung per group in `art/manifest.json` so the next pass knows what
   still needs generating.

## Core set (family A real-time-arena, 28-30 calls)

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

## Genre additions (families A and D)

Extras for the arena and card/tactics families. Every other family's extras are
in the per-family tables above.

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

## Volume budgets (families A and D)

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

Non-A families keep steps 1, 6 and 7 and replace steps 2-5 with their own
reference asset: piece-faces sheet (B), hero idle (C), player vehicle (E),
generator icon sheet 1 (F), card back or tile-faces sheet (G), category icons
(H), player object skin (J). Whatever that first asset is, it carries
`writeScaleProfile` and every later asset in the family is judged against it.

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
