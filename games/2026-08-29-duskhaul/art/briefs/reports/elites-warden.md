# Group `elites-warden` — GenElites report (9 elite sheets)

Scope: the 9 `elite-*` assets only. `boss-warden-*` and `warden-scale.json` are GenWarden's and were
not touched. Output root `games/2026-08-29-duskhaul/public/assets/generated/elites-warden/`.

**All 9 accepted. 9/9 strict `qc.passed=true`, `sprite-sheet.png` present, source cell aspect 1.0.**
Scale profiles written: `reaper-scale.json`, `matron-scale.json`, `herald-scale.json`.

## Per-asset table

| id | frames | provider | palette meanDistance | cv | anchorYStd | subjH | gens used | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| elite-reaper-move (base) | 4 (2x2) | codex | 18.65 | 0.0431 | 0.0224 | 181.5 | 4 | base of reaper chain |
| elite-reaper-attack | 4 (2x2) | xai | 22.53 | 0.0010 | 0.0010 | 177.75 | 2 | profile-bound, drift 0.0228 |
| elite-reaper-death | 4 (2x2) | xai | 19.75 | 0.3251 | 0.0454 | 140.75 | 3 | unbound; cv as posture note |
| elite-matron-move (base) | 4 (2x2) | codex | 23.24 | 0.0734 | 0.0586 | 92 | 6 | base of matron chain |
| elite-matron-attack | 4 (2x2) | xai | 25.03 | 0.0030 | 0.0767 | ~72 | 4 | anchorY as posture note |
| elite-matron-death | 4 (2x2) | xai | 24.37 | 0.0487 | 0.0056 | 88.5 | 1 | burst debris retained |
| elite-herald-move (base) | 4 (2x2) | xai | 21.49 | 0.0143 | 0.0000 | 164.75 | 2 | base of herald chain |
| elite-herald-attack | 4 (2x2) | xai | 23.33 | 0.0105 | 0.0068 | 163.5 | 2 | profile-bound, drift 0.0091 |
| elite-herald-death | 4 (2x2) | xai | 23.89 | 0.2860 | 0.0074 | 159.25 | 2 | unbound; cv as posture note |

Every sheet passes `sprite_check_palette` (max 25.03 against the profile's 48 limit and the brief's
stricter ≤36). Provider read from `sprite-metadata.json.source.file`, not from a glob: `.jpg`/`.png` =
xai, `.webp` = codex. Each dir holds exactly one `raw-source.*` after the sweep.

## How each telegraph reads

- **Sorrow Reaper (900ms arc sweep).** Frame 1 raises the scythe with a thin faint torch-amber crescent
  tracing the path the blade will travel; frame 2 is the peak — the same crescent thick, solid and the
  brightest thing in frame, scythe wound furthest back; frame 3 strikes with the amber cut to a short
  streak behind the edge; frame 4 recovers with no amber at all. The tell is a *doubled curve*: the
  amber arc repeats the scythe's own crescent, so the warning uses the silhouette the player already
  reads as this enemy. Amber persists across frames 1-3, giving the full windup as warning before the
  blow lands on 4.
- **Widow Matron (web slick).** Frame 1 braces with no light; frame 2 lights two sacs at the rear
  abdomen tip in dim cold dusk violet — the only glow on the creature, so its location *is* the tell;
  frame 3 fires the slick forward-low along the leg-tip line; frame 4 settles. Read is "the back end
  lights up, then the ground in front is dangerous".
- **Dread Herald (rally surge).** Frame 1 slams the bone pole butt down with no light; frame 2 swells a
  low dried-blood ring outward around the pole base at boot level; frame 3 peaks with the ring widest
  and brightest while the banner snaps taut above; frame 4 fades. The ring grows only sideways along the
  ground, and the banner snapping taut is a second, silhouette-level confirmation of the same beat.

All three telegraphs are drawn as *light*, never as notation — no arrows or arrowheads appeared.

## Elite read vs the grunt roster

Reaper 181.5px and Herald 164.75px exported subject height sit well above the light-grunt band, and the
Matron trades height for width (92px tall but the widest mass in the group). Silhouette contract holds:
reaper = tall vertical broken by one dominant scythe crescent; matron = low wide lopsided oval on eight
splayed legs, no vertical dominance; herald = genuinely split silhouette, blocky armoured knight plus a
tall ragged banner rising above the helm as a second mass. Threat-red accents present on all three (red
eyes throughout, red hem stitching, red abdomen welts, and the banner as the herald's single red mass).

## art_review

**Brief-mandated set call** — 3 elite `-move` sheets + `boss-warden-idle`, renderScale 48.
Silhouette variety **PASSED**, all 6 pairs 0.092-0.170 (reaper/warden 0.092, matron/herald 0.119,
reaper/herald 0.120, reaper/matron 0.123, herald/warden 0.151, matron/warden 0.170). No collisions.

| sheet | dark | mid | light | spread | warm | cool | colourCount |
| --- | --- | --- | --- | --- | --- | --- | --- |
| elite-reaper-move | 0.875 | 0.105 | 0.020 | 0.665 | 0.342 | 0.601 | 29941 |
| elite-matron-move | 0.633 | 0.256 | 0.111 | 0.831 | 0.613 | 0.097 | 20094 |
| elite-herald-move | 0.886 | 0.105 | 0.009 | 0.534 | 0.406 | 0.588 | 20852 |
| boss-warden-idle (ref) | 0.944 | 0.055 | 0.002 | 0.444 | 0.142 | 0.809 | 39870 |

**Busiest sheet + attack/death set call** (matron-death is busiest at detail mean 0.506, quietShare
0.089): matron-death, matron-attack, reaper-death and reaper-attack pass with zero or warn-only
findings. herald-attack (1.2% light) and herald-death (1.6% light) report `value-tier-absent:light`.

Two `silhouette-collision` findings — matron-death vs matron-attack (0.034) and herald-attack vs
herald-death (0.041). **Both are between two actions of the SAME character and are correct by design:**
a character must read as itself across its own actions. The gate exists to stop two different enemies
sharing a mass, and that is the cross-character set call above, which passed on all 6 pairs.

## qcExceptions to record (2)

- `{"id": "elites-warden/elite-matron-attack", "reason": "anchorYStd 0.0767 vs 0.05, recorded as a posture note, not suppressed: the four frames sit on slightly different vertical levels. Kept over a gate-clean earlier take because that take sprayed web from the HEAD instead of the abdomen spinnerets and rendered the sac glow as a bright cyan orb, both off-brief; an anatomy error outbids a ~20px anchor wobble on a low wide ground creature. The web slick is also attenuated: retaining it in full (componentMode all) put it across the source cell boundary, and strict QC was NOT relaxed to hide that clipping."}`
- `{"id": "elites-warden/elite-matron-move", "reason": "anchorYStd 0.0586 vs the 0.05 the brief asks of siblings, and the locked three-quarter side camera drifts to a head-on view in 2 of the 4 frames. Reads correct as a static frame and slightly swimmy in motion. One sanctioned reroll was spent and failed strict QC outright (contamination + source-edge-touch x2 + anchorY 0.1602), so the better sheet was kept. As this is the chain base, matron-scale.json inherits the looseness."}`

Neither is a suppressed gate: both numbers are live in `sprite-metadata.json`, the first as a
`qc.postureChange[]` note.

## Deviations from the brief (all sanctioned by Main during the wave)

1. `"writeScaleProfile": true` is silently dropped — the exporter only accepts a string path. Used the
   literal path the siblings reference. Affected `elite-reaper-move`, `elite-matron-move`,
   `elite-herald-move`. No elite marker carried `duration: 0`, so that defect did not apply here.
2. The three `-death` markers drop `scaleProfile` + `maxProfileScaleDrift` per Main's categorical
   ruling — a bbox-height invariance gate cannot be satisfied by an action whose purpose is to collapse.
   Intra-sheet cv/anchorY retained and surfaced through `--posture-change`.
3. `elite-matron-death` and `elite-herald-death` used `componentMode: "all"` + `minComponentArea: 24`
   so the burst fragments and snapped pole survive the connected-component filter. Verified by
   component count: matron-death reads `[1, 7, 1, 2]` — the burst frame genuinely retains 7 pieces.
4. `elite-reaper-move` and `elite-matron-move` metadata/profile were restored by deterministic reprocess
   of the accepted raw after a later failed attempt clobbered the dir; `sprite-sheet.png` md5 unchanged
   in both cases (2e7281de… reaper-death, 090e46ce… matron-move), proving the art was never altered.

## Findings contributed to the wave

- Ground-shadow counter: put the ban as the first sentence of `subject`; later refined by others to
  strip the trigger word. Non-standing phrasing ("many-legged skitter") removed it entirely.
- Long-prop containment: bound the PROP's reach ("the whole scythe stays within the middle 55% of the
  cell width, close beside the body"). Telling the model to shrink the figure does not work — it keeps
  extending the weapon across the boundary. Concrete pixel budgets ("a box 340px by 250px, centred,
  leaving 85px of magenta") landed where percentages had failed repeatedly.
- Codex returns non-square canvases on wide subjects (measured 1402x1122, cells 701x561, aspect 1.25,
  `geometryMismatch: true`). `aspect_ratio` alone does not hold it; assert squareness in prose.
- `/1.15` guide compensation OVERSHOOTS on xai, which tracks a guide at ~1.04x: reaper-attack came back
  9.4% small (drift 0.0944). Build the anchor guide UNCOMPENSATED first; the constant does not transfer
  across providers.
- **The mandated palette clause contains its own failure mode.** "COLD DESATURATED BLUE-GREY PLUM"
  includes the token BLUE, and on xai it produced fully navy cloth on reaper-death and navy armour on
  herald-move. Adding "never blue, navy, teal" made it worse — negation at maximum prominence. Rewording
  positively as "DARK ASH-PLUM GREY … a dim grey-violet stone colour, dull as wet granite in an unlit
  cellar", with every blue token deleted, fixed both first try. Same root cause as the divider line and
  the ground shadow.
- `art_review`'s `value-tier-absent:light` is not a usable reject for this project: canonical
  `husk-move` fails it at 0.4% lights, worse than any sheet of mine. Measured and reported to Main,
  who made the check advisory and retuned `plan.valuePlan`.
- `process-sprite.ts:865` — `profileLimit = options.maxProfileScaleDrift ?? loadedProfile.qc.maxBodyScaleDrift`,
  and every written profile carries 0.08. Binding a profile for its processing params therefore always
  imports the height gate; there is no way to take one without the other.

## Known-weak, stated honestly

`elite-matron-move` and `elite-matron-attack` are the two sheets in this group I would flag rather than
defend beside `hero-idle` and `husk-move` — see the exceptions above. The matron chain measures warmer
than its siblings (art_review warmShare 0.613 on `-move`), which is partly intrinsic: the brief makes a
large pale bone-parchment abdomen the creature's dominant mass, and bone is warm. The chitin and legs
did come back cold grey. The remaining seven sheets I would defend as-is; `elite-reaper-move` is
histogram-verified cold plum (top buckets (0,0,0), (32,16,32), (64,48,64), (16,16,32) all cool) with a
visible chunky pixel grid, a hard near-black outline, red eyes and a gilt collar.
