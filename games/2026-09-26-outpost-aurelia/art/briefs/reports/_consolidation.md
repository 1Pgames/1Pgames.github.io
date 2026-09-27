# Art consolidation — Outpost Aurelia (owner ArtOwner)

No generation in this pass (none needed). Scope: merge every group report's manifest-delta, drop the
template arena groups, gate the full set, write the integrator contract (`art/wiring.md`).

## What changed

- `art/tools/build-manifest.py` rewritten self-contained (it used to re-read its own output: the hero
  group's TEMPLATE-LEGACY note had been appended 3× by repeated runs). It now:
  - declares all 18 groups (ui, bg, buildings-a/b/c, apex, building-states, deposits, relics, terrain,
    world-props, fauna-a/b, colony-motion, fx, icons-a/b, hub) with the notes/owners from the deltas
    (relics → ArtWorld, colony-motion + fx → ArtMotionFx);
  - merges every report's `attempts` (163 assets carry a counter) and **35 `qcExceptions[]` entries** — every entry
    any report listed, plus none invented;
  - `sync_from_disk`: rows/cols, `frames`, `cellSize` (+ `cellHeight` when non-square), `duration`,
    `loop`, `strict`, `fullBleed`, `componentMode`, `postureChange` are taken from each shipped
    `sprite-metadata.json`; a missing export aborts the build. Loop comes from the deltas (metadata
    does not record it): walks/work loops/beacon-charging/drone/shuttle loop, fx loop only
    `fx-leech-sparks`, `fx-dusk-arrow`, `fx-beacon-beam`.
  - `kind` fixed to what shipped: hd-fx exports are `fx` — terrain blockers (4), world-props (14),
    deposits (4), relics (1); each asset also records its processing `profile`.
  - icon order changes from icons-a (ark spares `ark-ship`, `ark-locked`; bld-3 spares `ico-upgrade`,
    `ico-demolish`), icons-proto-3 spare note, titan stomp `postureChange`, matron/titan 512 cells,
    howler-attack / matron-brood `strict:false` (all synced).
  - conventions corrected (`fxCellSize` 256, `scale` not `scaleMode`), stale `bg/arena` and
    `arena/floor` exceptions removed (bg report: backdrop now exports strict with fullBleed).
  - fails on a duplicate icon name across sheets (none).
- **Exception ids are written as `<group>/<id>`.** Reports wrote bare ids (`bld-pulse-apex`); both
  `manifest-lint.py` (`is_excepted(full)`, full = `group/id`, lines 237-238/428) and
  `figure-ground.py` (`_asset_id`) fnmatch against `group/id`, so a bare id would record nothing.
- Legacy groups `hero`, `enemies-light`, `enemies-heavy`, `pickups-fx`, `arena`, `props` removed from
  the manifest and their `public/assets/generated/<group>/` dirs deleted.
- `art/generation-plan.md` §0 errata fixed: marker key `scale` (not `scaleMode`), explicit input =
  Image 1 / appended vision anchor = Image 2 (`sprite-generate.ts:860`), pinker key
  `rgb(252,84-95,171-183)` + guard-off processing, `deframe.py` → `deframe_bbox.py`.
- New `art/tools/figure-ground-cast.py`: the full-cast gate + offline night-grade repro.

## Gates

`python3 "$(git rev-parse --show-toplevel)/.claude/skills/game-art/references/manifest-lint.py" art/manifest.json`

```
manifest-lint art/manifest.json: 0 error(s), 0 warning(s)      exit 0
```

No warnings to answer.

`python3 art/tools/figure-ground-cast.py` (renderScale 128 from `art/style.json`, `--manifest art/manifest.json`).
Cast per biome = 94 sheets: buildings-a/b/c (39), apex buildings (16), scaffold + ruin (6), every fauna
sheet (22), deposits (4), relics (1), shared props (2), that biome's props (3), that biome's blockers (1).
Fields = that biome's 3 floor tiles only.

| run | scenes | actor p90 | field meanL | clash % | busyRatio | C1 | exit |
|---|---|---|---|---|---|---|---|
| day (`--grade ffffff`) | steppe/rime/ember/nacre | 0.717-0.730 | 0.043-0.050 | 0.00 (12/12) | 0.044-0.073 | PASS 12/12 | 0 |
| night overlay `#2c2640`@0.55 on actors AND fields (pre-graded copies) | 4 | 0.193-0.196 | 0.030-0.033 | 0.00 | 0.034-0.057 | PASS | 0 |
| night multiply `--grade 8b8896` (fields) | 4 | 0.717-0.730 | 0.014-0.016 | 0.00 | 0.044-0.073 | PASS | 0 |

`figure-ground-cast: exit 0 (day 0, night 0, night-mult 0)`. No WARN, so no figure-ground qcException
was needed. Set spread day: busy 0.756..1.260, no set-busyness outlier.

## Broken / needs a reprocess or regeneration pass

Items 1-3 were RESOLVED in a follow-up re-processing pass (no regeneration; scratch + review sheet in
`art/exports/_consolidation/`, `qc-reprocess.png`). All gates were re-run afterwards: lint 0 errors /
0 warnings, figure-ground-cast exit 0 (day 0, night 0, night-mult 0; actor p90 moved ≤ 0.0005).

1. RESOLVED — **fauna-a/fauna-spitter-attack** re-processed with `art/exports/fauna-a/refit.py
   --bind fauna-spitter-scale.json --deshadow --posture --fit=0.72` (same raw, same bound scale: mean
   height 189.25 unchanged, frame heights 162/200/193/202 unchanged). Ground line now y 220/256 on every
   frame of BOTH walk and attack (was walk 220 / attack 238); top margin ≥ 18 px, no clamp;
   strict pass, `body-scale-cv 0.0844` recorded under `qc.postureChange` as before.
2. RESOLVED — **buildings-a/bld-core** re-processed with `art/tools/rekey.py` at align bottom, fit 0.9
   (was centred fit 0.86): base now y 365/384 (19 px pad, same as bld-beacon / state-*-3x3), visible
   bbox 346×305. Provenance in its `sprite-metadata.json.reprocess`; the marker metadata is untouched.
3. RESOLVED — stale `building-states/state-frost-2x2/sprite-metadata.failed.json` deleted; the shipped
   `sprite-metadata.json` (strict pass) is unchanged.
4. **Tier reads that rely on runtime pips** (recorded exceptions, candidates for a regeneration pass if
   the tier read matters): `bld-foundry-mk3` (visually Mk I on 3/3 attempts), `bld-cutter-mk3` (upper
   tier only in spray frames), `bld-smelter-mk3` f2 (Mk I crucible for 120 ms), `bld-harvester-mk3` f0
   tread colour.
5. Cosmetic, recorded in exceptions or reports: `fx-launch-flare` f3 / `fx-upgrade-shine` f1 pink cast,
   `lander-shuttle` salmon flame cast, `hub-planet-map` hairlines/pin dots.

## For the integrator (src is not mine)

- Removing the legacy groups makes `gen-art-registry.mjs` stop with "no longer declares N art alias(es)
  that src/ still reads" until the template readers are deleted/retargeted: `ANIM.heroIdle/heroRun/
  heroAttack/heroHurt`, `ANIM.xpOrb`, `ANIM.coin`, `ANIM.hitSpark`, `ANIM.levelUpBurst`,
  `TEXTURE.bullet` (objects/player.ts, xporb.ts, coin.ts, projectile.ts, systems/combat.ts,
  slices/arena/game.ts).
- `content.ts` builds `artKey: \`bld-${def.id}\`` (`bld-ferrite_drill`), which matches no texture — use
  the stem table in `art/wiring.md` §1. Fauna `artKey`s (`fauna-<species>`) already match the walk keys.
- PRD §5.4's `site-*` postcard names do not exist; the keys are `postcard-<site id>`.

## CRITERIA

- **Night grade reviewed through, both readings.** Runtime = world-camera overlay `#2c2640` α 0.55 on every
  world pixel (terrain/deposits/props/fx reports' lerp); apex/buildings-b modelled it as a multiply blend
  (= `--grade 8b8896`, field-only). The gate's `--grade` can only express a field multiply, so the lerp is
  applied offline to actors AND fields by `art/tools/figure-ground-cast.py` (temp copies mirroring
  `.../generated/<group>/<id>/` so exception ids still resolve). Both pass with 0.00 % clash. Not modelled
  (values not in src): building dim-to-night tint, lit ground +12 %, runtime fauna outline `#3a1712`,
  drone outline `#10302f` — clash margin is 0.00 % against a boundary ≥ 4× the graded field p99, so none
  plausibly moves a verdict; re-run the script once `src/` fixes them.
- **Fauna display size rescoped to LONG EDGE for all ten species.** fauna-b wrote "driven by visible
  height"; fauna-a measured that height normalisation draws the grub 214 px long. Long edge is the
  creature size (PRD `sizePx`) for every species; for the tall species (bloat, howler, matron) long
  edge = visible height, so their numbers are the same under either rule.
- **`meanDistance` read as distance from the 18-colour list**, not quality: the >52 cases
  (`state-frost-2x2` 53.68, `fauna-leech-attack` 53.61) are hues the list lacks (pale ice, grey-teal),
  recorded as exceptions, not rejects.
- **Silhouette-collision scoped cross-object only**: deposits (one footprint by contract), blocker/prop
  same-mass pairs and apex-vs-own-Mk III pairs are recorded exceptions with visual reasons, per the
  rule that same-object / same-footprint pairs are not the population the criterion was calibrated on.
- **Figure-ground population**: frost shells, crack decals, fx, icons, UI, hub/bg are NOT actors (overlays
  or figures never standing on the floor alone) and floors are never actors; blockers and props ARE
  actors of their own biome only.
