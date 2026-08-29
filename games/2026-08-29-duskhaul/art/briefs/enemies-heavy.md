# Group `enemies-heavy` — 4 shared heavy horrors (8 sheets)

Read `_common.md` first. Output root: `games/2026-08-29-duskhaul/public/assets/generated/enemies-heavy/`.

All hostile: red pinprick eyes, no green. Heavier masses than `enemies-light` — these must read BIGGER
and SLOWER at 48-56px. Per character: `move` first (`writeScaleProfile` + `profileName`), accept, then
`death` with `"scaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/enemies-heavy/<char>-scale.json"`
+ gates `"maxBodyScaleCv":0.08,"maxAnchorYStd":0.05,"maxProfileScaleDrift":0.08`. All sheets 2x2,
`"profile":"pixel-art-body"`, `"cellSize":256`.

**Group silhouette contract:** paleknight = massive square armoured block dragging a wide blade ·
marrowworm = long arched segmented worm · dirgebell = floating bell-dome with a chain · gildedghoul =
hunched glinting runner. No two share a mass.

| id | char | dur | action + frames | material/colour notes |
| --- | --- | --- | --- | --- |
| enemy-paleknight-move | paleknight (base) | 160 | ponderous stomp: (1) heave right (2) armour settles with a clank-dip (3) heave left (4) settle; wide blade drags behind | rusted pitted full plate animated by spite: empty helm with red eye-slits, torn surcoat scraps, one thin wet specular on the struck pauldron edge |
| enemy-paleknight-death | paleknight | 110 | (1) sways (2) helm tips off (3) plates cascade apart EMPTY — no body inside (4) heap of rusted plate, dark inside | |
| enemy-marrowworm-move | marrowworm (base) | 140 | burrow-surge: (1) front segments rear up (2) arch peaks (3) crash forward (4) rear segments gather | segmented burrower of stacked bone rings and grey sinew, arched long silhouette, red eyes on a blunt bone head |
| enemy-marrowworm-death | marrowworm | 100 | (1) mid-body tears (2) SPLITS into two halves (3) both halves thrash (4) both limp — the split is the read | in-game it splits into 2 half-HP worms; frame 2 must show a clean two-part separation |
| enemy-dirgebell-move | dirgebell (base) | 150 | float: (1) bell sways left, clapper right (2) centre (3) sways right, clapper left (4) centre; stable hover line | cracked black-iron funeral bell, verdigris seams, a snapped chain above, red glow inside the mouth; dome silhouette |
| enemy-dirgebell-death | dirgebell | 100 | (1) crack splits wide (2) bell shears in two (3) halves drop (4) shards and the dead clapper | |
| enemy-gildedghoul-move | gildedghoul (base) | 110 | fleeing scamper glancing back: (1) push off (2) stretched stride, coins shed (3) land (4) gather | ghoul crusted in stolen gold: grey flesh under plates of coins and gilt chains, hunched glinting silhouette — the group's ONLY gilt accents (it is the loot piñata) |
| enemy-gildedghoul-death | enemy | 100 | (1) stumbles (2) bursts into a spray of gilt shards and coins (3) shards fountain (4) grey husk among scattered gold — all inside the safe area | |

Marker template (fill id/duration; writeScaleProfile+profileName on `-move`, scaleProfile+gates on `-death`):
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/enemies-heavy/<id>","rows":2,"cols":2,"profile":"pixel-art-body","cellSize":256,"duration":<dur>,"styleProfile":"games/2026-08-29-duskhaul/art/style.json", ...}`

**Set review:** one `art_review` SET call across the 4 `-move` sheets PLUS
`enemies-light/enemy-husk-move` (cross-weight mass check: heavies must clearly outweigh the husk).
Report per `_common.md`.
