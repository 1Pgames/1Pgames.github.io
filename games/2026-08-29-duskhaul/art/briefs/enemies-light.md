# Group `enemies-light` — 8 shared light horrors (18 sheets)

Read `_common.md` first. Output root: `games/2026-08-29-duskhaul/public/assets/generated/enemies-light/`.

All hostile: red pinprick eyes, NO green anywhere (green is the player's). Every "dead" walker carries
the 2px vertical shamble-stutter between frames. Per character: generate `move` first
(`writeScaleProfile` + `profileName` as marked), accept, then its `death`/`attack` with
`"scaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/enemies-light/<char>-scale.json"` +
gates `"maxBodyScaleCv":0.08,"maxAnchorYStd":0.05,"maxProfileScaleDrift":0.08`. All sheets 2x2,
`profile":"pixel-art-body"`, `cellSize":256`, styleProfile as in `_common.md`. Marker durations below.

**Group silhouette contract (repeat the character's own line in its prompts):** each of the 8 must read
as a DIFFERENT mass at 48px: husk = broad slumped rectangle · wretch = low sprinting hook · ratking =
flat wide writhing mound · bonecaster = tall thin staff-bearer · thornhound = long horizontal
quadruped · shroudmoth = soft wide X of wings · pyreling = small teardrop flame · ashwraith = vertical
tatter-column. If two read alike, the silhouette brief — not the colour — gets rewritten.

| id | char | dur | action + frames | material/colour notes |
| --- | --- | --- | --- | --- |
| enemy-husk-move | husk (base) | 140 | shuffling walk: (1) drag right foot (2) sag (3) drag left (4) sag lower | dried grey-green corpse, hanging jaw, rag scraps; broad slumped silhouette, arms slack |
| enemy-husk-death | husk | 100 | (1) knees fold (2) torso caves (3) bursts to dust (4) rag-and-bone heap | dust motes stay in-cell |
| enemy-wretch-move | wretch (base) | 110 | ragged sprint on all-fours-then-upright: (1) coil (2) leap forward (3) land on knuckles (4) recover | hunched scavenger, long knuckle-dragging arms, low hook silhouette |
| enemy-wretch-death | wretch | 100 | (1) trips mid-stride (2) skids (3) folds over (4) limp sprawl | |
| enemy-ratking-move | ratking (base) | 120 | swarm-scuttle: (1) mound surges left (2) rats crest (3) surges right (4) tails whip | knot of graveyard rats moving as one flat wide mound, many red eyes, bone scraps in the tangle |
| enemy-ratking-death | ratking | 90 | (1) mound bursts apart (2) rats flee outward (3) two stragglers (4) bones left | fleeing rats stay inside the safe area |
| enemy-bonecaster-move | bonecaster (base) | 150 | hover-shamble: (1) staff plant (2) drift forward (3) robe swings (4) settle | robed skeleton, tall thin silhouette, cracked marrow-staff glowing faint amber at the tip |
| enemy-bonecaster-attack | bonecaster | 110 | (1) staff raised, a hard-edged amber glow swelling at the tip with a bright core and one dithered fringe step (2) that glow at its brightest (3) hurls marrow dart forward-right (4) follow-through | the windup MUST read before the throw; dart stays attached inside the cell |
| enemy-bonecaster-death | bonecaster | 100 | (1) staff drops (2) spine folds (3) bones cascade (4) empty robe on bone pile | |
| enemy-thornhound-move | thornhound (base) | 110 | circling trot: (1) fore-legs reach (2) full stride (3) hind push (4) gather | briar-wrapped hound, long horizontal silhouette, thorn spikes along the spine, faces right |
| enemy-thornhound-attack | thornhound | 90 | (1) crouch, a hard-edged red glow in the jaws, bright core and one dithered fringe step (2) hind coil (3) lunge stretched flat (4) snap and recover | |
| enemy-thornhound-death | thornhound | 100 | (1) legs splay (2) briars unravel (3) body sags through the loosened thorns (4) heap of briar and bone | |
| enemy-shroudmoth-move | shroudmoth (base) | 130 | drift flight: (1) wings up (2) mid-beat (3) wings down (4) glide — stable hover line | moth of grave-silk, wide soft X silhouette, pale dusty wings, red eyes; hovers, no legs visible |
| enemy-shroudmoth-death | shroudmoth | 90 | (1) wings crumple (2) tears into silk scraps (3) scraps flutter (4) drifting threads | |
| enemy-pyreling-move | pyreling (base) | 120 | bobbing float: (1) flame tall (2) flame leans (3) flame squat (4) flame recovers — stable hover line | candle-flame spirit: small teardrop of torch-amber fire over a black wax stub, red eye-pair in the flame; ONLY light source of the group |
| enemy-pyreling-death | pyreling | 80 | death-burst: (1) flame swells (2) bursts to cinders ring (3) cinders scatter (4) smoke wisp — all inside the safe area | the in-game burst radius is r=80: keep the burst readable but contained |
| enemy-ashwraith-move | ashwraith (base) | 130 | glide: (1) tatters trail (2) body stretches (3) contracts (4) trails settle — stable hover line | cinder ghost: vertical column of charred tatters trailing ember flecks, red eyes high in the column |
| enemy-ashwraith-death | ashwraith | 90 | (1) embers gutter (2) column collapses downward (3) disperses to grey ash (4) cooling flecks | |

Marker template (fill id/duration; add writeScaleProfile+profileName on `-move`, scaleProfile+gates otherwise):
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/enemies-light/<id>","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":<dur>,"styleProfile":"games/2026-08-29-duskhaul/art/style.json", ...}`

**Set review:** one `art_review` SET call across all 8 `-move` sheets — the silhouette-variety gate for
the whole roster. Report per `_common.md`.
