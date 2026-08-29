# Group `elites-warden` — 3 elites + the Gate Warden (17 sheets)

Read `_common.md` first. Output root: `games/2026-08-29-duskhaul/public/assets/generated/elites-warden/`.

Elites render at 68-80px, the Warden at 120px — these are the LARGEST silhouettes in the game and the
Warden must dwarf every elite. Red eyes, no green. Telegraph windups glow torch-amber; arcane elements
dusk-violet; enrage glows dried-blood red. Per character: `move`/`idle` first (`writeScaleProfile` +
`profileName`), accept, then siblings with
`"scaleProfile":"games/2026-08-29-duskhaul/public/assets/generated/elites-warden/<char>-scale.json"` +
gates `"maxBodyScaleCv":0.08,"maxAnchorYStd":0.05,"maxProfileScaleDrift":0.08` (2x2 sheets only —
warden-sweep 2x3 and warden-death 2x4 take gates + anchor guide, NO scaleProfile).

**Silhouette contract:** reaper = tall figure dominated by a huge scythe arc · matron = bulbous wide
spider-queen · herald = split silhouette (figure + tall ragged banner) · warden = colossal square gaoler
crowned in black iron with a gate-bar mace. No elite may read as a scaled-up grunt.

## Elites (2x2, pixel-art-body, cellSize 256)

| id | dur | action + frames | notes |
| --- | --- | --- | --- |
| elite-reaper-move (base: reaper) | 140 | gliding stride: (1) scythe trails (2) step, robes swing (3) scythe swings forward (4) settle | Sorrow Reaper: gaunt robed elite, grave-cloth hood, huge chipped scythe — the scythe arc IS the silhouette |
| elite-reaper-attack | 110 | (1) scythe raised high, a hard-edged torch-amber glow with a bright core and one dithered fringe step smeared along the sweep path (2) that glow at its brightest (3) sweep — blade flat through the front arc (4) recover | 900ms windup in game: frames 1-2 must read as WARNING before frame 3 hits; keep the arc inside the cell |
| elite-reaper-death | 110 | (1) scythe drops (2) folds over the fallen scythe (3) robes deflate (4) heap over the blade | |
| elite-matron-move (base: matron) | 150 | heavy drag: (1) front legs pull (2) abdomen drags (3) alternate legs (4) settle; web strand trails behind | Widow Matron: bloated spider-queen, pale egg-swollen abdomen, iron-grey chitin, red eye cluster; widest elite |
| elite-matron-attack | 110 | (1) rears, abdomen tips forward (2) violet-grey web sacs swell (3) sprays a web slick downward-forward (4) settles | web strands stay attached and in-cell |
| elite-matron-death | 110 | (1) legs buckle inward (2) abdomen bursts (3) shrivels around the burst (4) curled husk | |
| elite-herald-move (base: herald) | 140 | march: (1) banner plants (2) stride past it (3) banner lifts (4) stride | Dread Herald: armoured banner-bearer, tall ragged dried-blood-red banner on a bone pole — the banner is half the silhouette and its ONLY red mass |
| elite-herald-attack | 110 | (1) slams the banner butt down (2) red rally ring pulses out at the base (3) ring peaks, banner cloth snaps taut (4) fades | rally pulse stays inside the cell |
| elite-herald-death | 110 | (1) knees buckle (2) falls forward (3) banner pole SNAPS (4) body under the fallen red cloth | |

## Gate Warden (castle base + zone skins)

Warden identity (verbatim in all 8 warden prompts): the Gate Warden — the dusk's colossal jailer: a
square-massed giant in riveted black-iron gaol plate wound in heavy chains, a black-iron crown with red
eye-slits beneath, dragging a gate-bar mace (a portcullis beam with chain links); dusk-violet arcane
seams glow between the plates.

| id | grid | dur | action + frames |
| --- | --- | --- | --- |
| boss-warden-idle (base: warden) | 2x2 | 160 | (1) chains hang (2) chest heaves, chains sway (3) crown tips, violet seams flare (4) settle |
| boss-warden-sweep | 2x3 | 100 | (1) mace drawn back, a hard-edged amber glow smeared along the swing path, bright core and one dithered fringe step (2) that glow at its brightest (3) sweep begins (4) full horizontal sweep (5) follow-through, dust (6) recover — NO scaleProfile (2x3), gates + anchor guide from accepted idle frame |
| boss-warden-summon | 2x2 | 130 | (1) free hand rises (2) violet sigil ring ignites before it (3) sigils orbit, chain-shield links rise around the body (4) shield set, sigils fade |
| boss-warden-enrage | 2x2 | 110 | loop: (1) crown ignites red (2) chains whip out (3) red glare peaks, seams burn red (4) chains lash back |
| boss-warden-death | 2x4 | 110 | (1) mace falls (2) first chain snaps (3) second snaps, plate shifts (4) knees crash down (5) chest plate falls open — empty dark inside (6) chains cascade (7) crown rolls off (8) still mound of iron, violet seams dead — NO scaleProfile (2x4), gates + anchor guide |
| boss-warden-idle-outlands | 2x2 | 160 | same 4-frame idle, same body/mace/chains, SKIN SWAP ONLY: gibbet-timber shoulder yokes with hanging rope loops replace the pauldrons; rope-wrapped crown |
| boss-warden-idle-desert | 2x2 | 160 | same idle, skin swap: bleached-bone pauldrons and a cracked sun-disc crown; sand-scoured plate |
| boss-warden-idle-winter | 2x2 | 160 | same idle, skin swap: ice-sheathed shoulders with icicle fringe and an icicle crown; frost-rimed chains |

Zone-skin calls pass the accepted castle `boss-warden-idle` sheet as an extra `input` image ("Image 3
fixes this exact character's identity, proportions and feet line — change ONLY the shoulders and
crown"). Skins keep `scaleProfile` + gates.

Marker template:
`OMP_SPRITE_EXPORT:{"outputDir":"games/2026-08-29-duskhaul/public/assets/generated/elites-warden/<id>","rows":<r>,"cols":<c>,"profile":"pixel-art-body","cellSize":256,"duration":<dur>,"styleProfile":"games/2026-08-29-duskhaul/art/style.json", ...}`

**Set review:** one `art_review` SET call across the 3 elite `-move` sheets + `boss-warden-idle`
(mass hierarchy: warden ≫ matron > herald ≈ reaper). Report per `_common.md`.
