# Report: `colony-motion` + `fx` (agent ArtMotionFx)

**Tool probe (rule 0):** `generate_image` 1024² throwaway, no marker, came back from xai-oauth / grok-imagine-image as a JPEG. OK.
Devices used: `sprite_preflight_background`, `sprite_check_palette`, `art_review`.

**Ownership note:** the manifest names owners `ArtMotion` (colony-motion) and `ArtFx` (fx). Both groups ran under one agent (`ArtMotionFx`) with one report, which is this file. The groups keep separate output dirs.

**Landed (complete groups):** `public/assets/generated/colony-motion/{drone,lander-shuttle,ark-silhouette}` and
`public/assets/generated/fx/{fx-pulse-bolt,fx-arc,fx-flak,fx-acid,fx-leech-sparks,fx-bloat-burst,fx-frost-creep,fx-beacon-beam,fx-launch-flare,fx-dusk-arrow,fx-build-dust,fx-upgrade-shine,fx-relic-burst}`.
**Missing: none.** Scratch attempts, raws and QC images are in `art/exports/{colony-motion,fx}/`. The staged final copy is in `art/exports/_land/`.

Common processing for every accepted asset:
- marker `threshold:150` + `styleProfile` (vision-1 appended as Image 1) + the fixing clause;
- then `art/tools/rekey.py`, which strips the pink rim the chroma guard keeps;
- the shipped `sprite-metadata.json` is the re-key, and `sprite-metadata.marker.json` is the marker export.

Every export reports `qc.passed: true`. Two exceptions:
- `fx-arc` was processed by CLI with `--no-preflight` (see CRITERIA).
- `drone` / `lander-shuttle` were re-processed with `scale fit` (see CRITERIA).

## Per-asset table

| id | intent | grid / cell | gens (attempts) | meanDistance (≤52) | outlierFrac | export QC | visual verdict / exception |
|---|---|---|---|---|---|---|---|
| drone | amber delivery pod, 4f hover | 2x2 / 256, 90 ms loop | 1 | 28.53 | 0.042 | strict pass, fit 0.9 centre, largest | accepted: egg pod in sodium amber, cream belly band, lit nose lamp, teal flank thrusters, brass clamp. **Reads as an amber pod at 24/28/32 px** on bgTop and on the steppe floor (`colony-motion/qc/drone-24-28-32px.png`) |
| lander-shuttle | cream lander capsule, 4f thrust flicker | 2x2 / 256, 120 ms loop | 1 | 28.45 | 0.059 | strict pass, fit 0.9 centre, componentMode all | accepted. The thrust flame has a salmon-pink cast (the flame blended into the pink key; the tighter key did not remove it). Cosmetic, 80×40 px of a 256 cell |
| ark-silhouette | Orbital Ark, side-on, flies right (+x) | 1x1 / 512, static | 1 | 23.94 | 0.016 | strict pass, hd-fx | accepted: long violet spine, ring section, engine cluster on the left, rows of amber windows. Visible bbox 440×98 of 512 |
| fx-pulse-bolt | muzzle flash + amber bolt | 2x2 / 256 | 2 | 36.23 | 0.227 | strict pass | 1st take: pink rim on the flash and the bolt faced −x. Accepted take 2 (`fx-pulse-bolt-r1`): head faces +x, no pink rim |
| fx-arc | horizontal chain-lightning filament | 2x2 / 256 | 3 | 47.62 | 0.405 | strict pass, **no-preflight** | take 1: black cell dividers. Take 2: lightning-bolt icons plus coverage. Take 3: correct filaments, but frames 0/3 cover 0.24% < 0.5% (see CRITERIA). qcException written in the delta |
| fx-flak | flak airburst; frame 0 = shell in flight | 2x2 / 256 | 3 | 36.65 | 0.124 | strict pass | take 1: dividers. Take 2: the shell reappeared in the burst frames. Accepted take 3 (`fx-flak-r2`): flash, star, ring + nacre shards, debris. Small rust smoke puffs in frame 3 |
| fx-acid | lime acid glob + splash | 2x2 / 256 | 1 | 37.14 | 0.048 | strict pass | accepted |
| fx-leech-sparks | teal spark crackle, loop while latched | 2x2 / 256 | 3 | 31.87 | 0.111 | strict pass | take 1: dividers. Take 2: drew the leech creature itself. Accepted take 3 (`-r2`): pure spark ring |
| fx-bloat-burst | spore sac burst | 2x2 / 256 | 1 | 32.62 | 0.059 | strict pass | accepted: sage cloud, lime specks, membrane scraps |
| fx-frost-creep | frost fringe growth 0→3 | 2x2 / 256 | 2 | 39.09 | 0.174 | strict pass | take 1 drew a metal slab under the frost. Accepted take 2 (`-r1`): frost only |
| fx-beacon-beam | amber light column | 2x2 / 256 | 2 | 34.08 | 0.037 | strict pass | **take 1 accepted.** Take 2 (`-r1`, real light shaft) was rejected for a baked pink rim and a pink base pool (tighter key 190/40/200 measured and failed to clear it). Take 1 has caps and an ink outline; under ADD blending the ink vanishes (see `night-grade-additive.png`) |
| fx-launch-flare | beacon launch starburst | 2x2 / 256 | 3 | 39.84 | 0.164 | strict pass | **take 1 accepted.** Frame 3 has a pink-violet cast (key blend). Take 2: uneven background + edge-touch. Take 3: drew brass badges, not light. qcException written in the delta |
| fx-dusk-arrow | rust chevron, points −y (up), pulse | 2x2 / 256 | 1 | 27.97 | 0.053 | strict pass | accepted: `bad` rust fill, heavy ink |
| fx-build-dust | ochre dust puff | 2x2 / 256 | 1 | 30.20 | 0.056 | strict pass | accepted |
| fx-upgrade-shine | brass glint sparkle | 2x2 / 256 | 3 | 27.67 | 0.049 | strict pass | take 1: **xai redrew the vision anchor** (the colony scene) into 3 of 4 cells. Take 2: brass rod + faint frames. Accepted take 3 (`-r2`): four-point glints. Frame 1 streak has a faint pink cast |
| fx-relic-burst | brass/nacre claim burst | 2x2 / 256 | 2 | 36.40 | 0.142 | strict pass | take 1: white cell dividers. Accepted take 2 |

Provider: xai-oauth on all 30 calls (from `metadata.source.provider`). No generation call failed at the provider.

## Frame maps (row-major, frame 0 top-left)

| key | frames | ms | loop (proposed) | map / origin |
|---|---|---|---|---|
| drone | 4 | 90 | yes | 0 thrusters bright · 1 tilt, dim · 2 bright · 3 tilt other way. Centred, origin (0.5,0.5). Body bbox 230×195 of 256 → setDisplaySize to ~28 px |
| lander-shuttle | 4 | 120 | yes | flame long/short/long/medium. Nose up (−y), flame down. Origin (0.5,0.5). Tween y for descent and launch |
| ark-silhouette | 1 | — | — | static, faces +x. Tween x across the sky |
| fx-pulse-bolt | 4 | 80 | no | 0–1 muzzle flash (play at the barrel) · 2–3 bolt, head toward +x; rotate to the travel angle |
| fx-arc | 4 | 80 | no | 0 faint · 1 bright · 2 bright (new path) · 3 breaking up. Filament along +x; scaleX to the chain distance, rotate to the angle |
| fx-flak | 4 | 80 | no | 0 glowing shell orb (in-flight projectile, hold) · 1 flash star · 2 ring + shards · 3 debris |
| fx-acid | 4 | 80 | no | 0 glob in flight (hold) · 1 impact flatten · 2 splash crown · 3 puddle |
| fx-leech-sparks | 4 | 80 | **yes** | spark crackle loop while latched |
| fx-bloat-burst | 4 | 80 | no | sac split → cloud → ring → wisps |
| fx-frost-creep | 4 | 80 | no | growth stages 0→3. Hold frame 3 on dark buildings, or pick a frame by frost intensity. Fringe base at y≈0.57–0.76 of the cell: origin (0.5, 0.72) |
| fx-beacon-beam | 4 | 80 | **yes** (1–3) | 0 thin · 1 wide + rings · 2 widest · 3 rings risen. Base at the bottom: origin (0.5, 0.92); scaleY to sky height |
| fx-launch-flare | 4 | 80 | no | core → 8-ray star → star + ring → fading ring |
| fx-dusk-arrow | 4 | 80 | **yes** | pulse. Points −y (up); rotate to the edge direction |
| fx-build-dust | 4 | 80 | no | puff → lobes → flat ring → wisps. Origin (0.5, 0.6) at the footprint base |
| fx-upgrade-shine | 4 | 80 | no | glint → streak glint → glint + 2 satellites → glint + 1 |
| fx-relic-burst | 4 | 80 | no | core → rays + shards → ring burst → thin ring |

**Wiring contract.** Texture key = animation key = manifest id; all cells are 256 (the Ark is a 512 image). `gen-art-registry.mjs` reads grid 2x2/1x1 from the metadata, and I checked that every landed dir matches the manifest grid. Add `colony-motion` and `fx` to the colony slice's `ART_GROUPS`. Draw FX with `BlendModes.ADD`; the sheets were checked additive over the night-graded steppe floor. The drone needs `core/outline.ts` `#10302f` 2 px (not painted).

## Coverage (content id → sprite)

| content | sprite | | content | sprite |
|---|---|---|---|---|
| Pulse Turret weapon | fx-pulse-bolt | | Beacon charge | fx-beacon-beam |
| Arc Coil weapon | fx-arc | | Beacon launch | fx-launch-flare + ark-silhouette |
| Flak Mortar weapon | fx-flak | | Dusk telegraph | fx-dusk-arrow |
| Acid Lobber attack | fx-acid | | Build complete | fx-build-dust |
| Static Leech latch | fx-leech-sparks | | Mk upgrade | fx-upgrade-shine |
| Spore Bloat death | fx-bloat-burst | | Relic claimed | fx-relic-burst |
| Brownout frost | fx-frost-creep | | Drone delivery / Dawn lander / Order shipped | drone / lander-shuttle |

That is zero placeholders. Field-edge glow and brownout flicker are runtime Graphics per the manifest note, and are not in scope.

## Frame-0 / consistency sheets

- `art/exports/colony-motion/qc/frame-sheet.png`: drone 4f, shuttle 4f, Ark.
  - Each character has ONE animation, so the cross-animation check reduces to within-sheet identity.
  - Drone and shuttle bboxes are identical across all 4 frames (drone 230×195, shuttle 230×188), and the design matches in every frame.
- `art/exports/fx/qc/final-contact.png`: all 13 FX, 4 frames each, on bgTop.
- `first-pass-contact.png` / `regen-contact.png`: the rejected takes.

## Set gates

- **`art_review` (16 assets, renderScale 128):**
  - All 16 assets pass individually.
  - Warnings only: value-plan misses. FX are emitters and run 33–79% lights; the Ark silhouette is 86% dark by design. `temperature-single` on build-dust is warm by design.
  - Set finding: `silhouette-collision` fx-launch-flare × fx-relic-burst at 0.041. It is REPORTED, not acted on (see CRITERIA).
  - Cross pairs otherwise run 0.10–0.53; drone × shuttle 0.203.
- **figure-ground.py: not run.** Neither group has a floor, backdrop or parallax field, and no actor stands on the Ark (a sky sprite). The task did not call for it.

## CRITERIA (retracted, rescoped, folklore, transforms)

1. **Plan §0.3 folklore, measured:**
   - Marker key `"scaleMode":"fit"` is ignored. The drone and shuttle metadata showed `output.scaleMode: "preserve"`, `componentMode: "largest"`.
   - The sprite-forge marker key is `scale`, confirmed by ArtBuildingsB at `extensions/sprite-generate.ts`.
   - Fixed by re-processing the raws with `scale fit, fit 0.9`, keeping `largest` on the drone and using `all` on the shuttle (flame). Recorded in `sprite-metadata.marker.json.reprocessNote`.
   - **generation-plan §0.3 should say `"scale":"fit"`.**
2. **Preflight `cell-coverage` < 0.005 — rescoped for thin-line FX.**
   - The arc raw measured `edgeKeyFraction 1.000`, `foreignRegionCount 0`, cell coverage `0.0024 / 0.0253 / 0.0239 / 0.0024`. The only findings were coverage in the deliberately faint frames 0 and 3, which the export reports as "background-contamination".
   - Its population is solid-subject sheets. It cannot pass a 1–2 px filament frame, so the arc was processed with `--no-preflight`.
   - Every other strict gate was live and passed (`--strict`, `threshold 150/feather 55/edge 170`, fit 0.86, `componentMode all`, `--preserve-raw`).
3. **`silhouette-collision` — scoped to actors.** It was calibrated on cross-character actor sheets. FX bursts share a radial-star motif by function. The flare (pure amber + ring, Beacon launch) and the relic burst (brass + violet shards, relic claim) are separated by hue and context. Reported only.
4. **Tighter key does not fix a baked pink fringe.**
   - Re-keyed beam-r1 / flare / shine at threshold 190, feather 40, edge 200: the pink rim stayed.
   - The model paints the glow INTO the pink key, so it is pixel content, not key residue. That is why beam-r1 was rejected for the clean take 1.
   - Prompt defence that worked for dividers: "four stages float in two rows of two … no drawn grid lines, dividers, borders or panels anywhere".
   - Drawn cell dividers appeared on 4 calls with "2x2 grid" wording: arc/flak/leech take 1 in black, relic take 1 in white (even with a "separated only by empty magenta space" clause). The "float" wording produced dividers on 0 of 9 calls.
5. **Anchor redraw on an FX call:** fx-upgrade-shine take 1 redrew the vision-1 colony scene inside 3 cells. The brief said "glint sliding across enamel", which invited a surface. Cleared by "only light floating in empty space, no scene".
6. **Post-review pixel transforms reviewed through** (`art/exports/fx/qc/night-grade-additive.png`, reproduced offline by `python3 art/exports/fx/qc/night-grade-review.py` from `games/<slug>/`):
   - The night grade `#2c2640` at α 0.55 over the steppe floor plus drone and shuttle.
   - Six FX composited with ADD over the graded world.
   - **Finding for the integrator:** under the grade the 32 px drone goes muted-amber (still reads, loses punch). Draw drones ABOVE the night-grade layer (or on the lit-ground +12%) so the "amber pulses" motion identity holds.
   - Not reviewed: the runtime `#10302f` drone outline (no build).

## Text-over-art flags for ui-engineer

None. No asset in these groups sits under text.

## manifest-delta

```json
{
  "owners": { "colony-motion": "ArtMotionFx", "fx": "ArtMotionFx" },
  "attempts": {
    "drone": 1, "lander-shuttle": 1, "ark-silhouette": 1,
    "fx-pulse-bolt": 2, "fx-arc": 3, "fx-flak": 3, "fx-acid": 1, "fx-leech-sparks": 3,
    "fx-bloat-burst": 1, "fx-frost-creep": 2, "fx-beacon-beam": 2, "fx-launch-flare": 3,
    "fx-dusk-arrow": 1, "fx-build-dust": 1, "fx-upgrade-shine": 3, "fx-relic-burst": 2
  },
  "loop": { "fx-leech-sparks": true, "fx-dusk-arrow": true, "fx-beacon-beam": true },
  "qcExceptions": [
    { "id": "fx-arc", "reason": "thin 1-2px filament frames 0/3 cover 0.24% < preflight 0.5% floor; background measured clean (edgeKeyFraction 1.0, 0 foreign regions); exported --no-preflight with all other strict gates passing; 3 gens" },
    { "id": "fx-flak", "reason": "3 gens (dividers; shell reappeared in burst); accepted take is shell-free burst whose frame 0 glowing orb serves as the in-flight shell" },
    { "id": "fx-leech-sparks", "reason": "3 gens (dividers; drew the leech creature); accepted take is a clean teal spark ring" },
    { "id": "fx-launch-flare", "reason": "3 gens; accepted take 1: frame 3 carries a pink-violet cast baked from the key blend; later takes had uneven key / drew brass badges" },
    { "id": "fx-upgrade-shine", "reason": "3 gens (take 1 redrew the vision-anchor scene, take 2 a brass rod); accepted glint take has a faint pink cast on the frame-1 streak" }
  ]
}
```

Regen counts: 30 generation calls for 16 ids. 14 calls were regenerations: 1 pulse, 2 arc, 2 flak, 2 leech, 1 frost, 1 beam, 2 flare, 2 shine, 1 relic.

- 10 exports failed strict QC: arc ×3, flak t1, leech t1, relic t1, beam-r1, shine-r1, flare-r1, flare-r2.
- 6 more exported but were rejected on pixels: pulse t1, flak t2, leech t2, frost t1, shine t1, beam-r1 (CLI-processed).
- Every failure's cause was measured (preflight or raw view). No provider outage.
