# Outpost Aurelia — art wiring contract (integrator)

Source of truth: `art/manifest.json` (written ONLY by `python3 art/tools/build-manifest.py`) plus each asset's
`sprite-metadata.json`. `src/data/art.ts` is written ONLY by `node scripts/gen-art-registry.mjs`. Every number
below was measured on the shipped files (alpha > 128 bounding boxes), not copied from a brief.

General rules

- **Texture key = animation key = manifest `key`, else the asset `id`.** Frames are row-major (frame 0 top-left).
- Static sheets (`duration: 0`) get NO animation; address frames by index via `ICON.<name> = { key, frame }`
  (emitted from each asset's `icons[]`).
- Every non-full-bleed cell carries a transparent inset (fit 0.86-0.97). Draw sizes below are the size of the
  whole CELL on screen; the pad is part of the design.
- No red/green is painted into any sprite. Runtime outlines (`core/outline.ts`) and grades are post-review
  transforms; the night grade is already reviewed through (see `art/briefs/reports/_consolidation.md`).

## 0. ART_GROUPS the colony slice must declare

```ts
export const ART_GROUPS = [
  'ui', 'bg', 'hub',
  'buildings-a', 'buildings-b', 'buildings-c', 'apex', 'building-states',
  'deposits', 'relics', 'terrain', 'world-props',
  'fauna-a', 'fauna-b', 'colony-motion', 'fx',
  'icons-a', 'icons-b',
] as const;
```

This equals `art/manifest.json.integration.artGroups`. The template arena groups (`hero`, `enemies-light`,
`enemies-heavy`, `pickups-fx`, `arena`, `props`) are REMOVED from the manifest and their directories deleted.
**Consequence for src (integrator's):** `gen-art-registry.mjs` refuses to write while src still reads their
aliases — `ANIM.heroIdle/heroRun/heroAttack/heroHurt` (`objects/player.ts`, `systems/combat.ts`,
`slices/arena/game.ts`), `ANIM.xpOrb` (`objects/xporb.ts`), `ANIM.coin` (`objects/coin.ts`), `ANIM.hitSpark`
(`systems/combat.ts`), `ANIM.levelUpBurst` (`slices/arena/game.ts`), `TEXTURE.bullet` (`objects/projectile.ts`).
Delete or retarget those readers (the colony slice uses none of them) before regenerating the registry.

## 1. Buildings — `buildings-a`, `buildings-b`, `buildings-c`, `apex`

Origin **(0.5, 1) at the footprint's bottom-centre**; setDisplaySize(draw, draw) with the draw size below.
Every sheet is `align bottom`, so ground contact is a fixed inset above the cell bottom:
256 cells 13 px (5.1 %), 384 cells 19 px (4.9 %), walls 4 px (1.6 %, fit 0.97 so segments butt).
`bld-core` was re-processed to the same convention (align bottom, fit 0.9: base at y 365/384), so no
building needs a per-asset origin override.

| content id (`content.ts`) | art key stem | footprint | draw px | Mk I | Mk III | Mk IV (apex) |
|---|---|---|---|---|---|---|
| lander_core | bld-core | 3×3 | 192 | `bld-core` (384 cell, 1 f) | — | — |
| ferrite_drill | bld-drill | 2×2 | 128 | `bld-drill-mk1` 4 f | `bld-drill-mk3` 4 f | badge-silent overlay |
| rime_borer | bld-borer | 2×2 | 128 | `bld-borer-mk1` 4 f | `bld-borer-mk3` 4 f | badge-silent overlay |
| aurel_harvester | bld-harvester | 2×2 | 128 | `-mk1` 4 f | `-mk3` 4 f | `bld-harvester-apex` (+ badge) |
| vent_tap | bld-venttap | 2×2 | 128 | `-mk1` 4 f | `-mk3` 4 f | `bld-venttap-apex` |
| sun_sail | bld-sail | 2×2 | 128 | `-mk1` 4 f | `-mk3` 4 f | `bld-sail-apex` |
| charge_bank | bld-bank | 2×2 | 128 | `-mk1` 1 f | `-mk3` 1 f | `bld-bank-apex` |
| hydro_terrace | bld-farm | 2×2 | 128 | `-mk1` 4 f | `-mk3` 4 f | — |
| alloy_smelter | bld-smelter | 2×2 | 128 | `-mk1` 4 f | `-mk3` 4 f | `bld-smelter-apex` |
| prism_cutter | bld-cutter | 2×2 | 128 | `-mk1` 4 f | `-mk3` 4 f | `bld-cutter-apex` |
| lumen_foundry | bld-foundry | 2×2 | 128 | `-mk1` 4 f | `-mk3` 4 f | `bld-foundry-apex` |
| relay_pylon | bld-relay | 1×1 | 64 | `-mk1` 1 f | `-mk3` 1 f | `bld-relay-apex` |
| cargo_silo | bld-silo | 2×2 | 128 | `-mk1` 1 f | `-mk3` 1 f | `bld-silo-apex` |
| hab_dome | bld-hab | 2×2 | 128 | `-mk1` 1 f | `-mk3` 1 f | `bld-hab-apex` |
| hearth_commons | bld-commons | 2×2 | 128 | `-mk1` 1 f | `-mk3` 1 f | `bld-commons-apex` |
| pulse_turret | bld-pulse | 1×1 | 64 | `-mk1` 1 f | `-mk3` 1 f | `bld-pulse-apex` |
| arc_coil | bld-arc | 2×2 | 128 | `-mk1` 1 f | `-mk3` 1 f | `bld-arc-apex` |
| flak_mortar | bld-flak | 2×2 | 128 | `-mk1` 1 f | `-mk3` 1 f | `bld-flak-apex` |
| plate_barricade | bld-wall | 1×1 | 64 | `-mk1` 1 f | `-mk3` 1 f | `bld-wall-apex` |
| beacon_spire | bld-beacon | 3×3 | 192 | `bld-beacon` (384) + `bld-beacon-charging` 4 f | — | `bld-beacon-apex` (384) |

- `content.ts` currently derives `artKey: \`bld-${def.id}\`` (`bld-ferrite_drill`), which matches no texture.
  Map through the stem column: `${stem}-mk${mk === 2 ? 1 : mk}` (Mk II = Mk I sheet + runtime rank pips), and
  `${stem}-apex` once the building's protocol is evolved. Tier-to-tier size is identical (same fit and pad).
- **Work loops** (drill, borer, harvester, venttap, sail, farm, smelter, cutter, foundry; Mk I and Mk III):
  4 frames, **120 ms, loop**; frame 0 = idle — show frame 0 static when unpowered/unstaffed.
  Frame meaning per type: `art/briefs/reports/buildings-a.md`, `buildings-b.md` (§Frame maps).
- `bld-beacon-charging`: 4 frames, **150 ms, loop**, 384 cells; pulse reads glow-settle-settle-flare. For a
  monotonic "rising" read play frames `[2, 1, 0, 3]`.
- Apex sprites are static (1 f); no work loop over them. `bld-cutter-mk3`/`bld-foundry-mk3` read close to Mk I
  (recorded exceptions) — the rank pips carry the tier.
- `badge-silent` (group `apex`, 256 cell, hd-fx centred): overlay ~24-32 px at the top-right of every drill,
  borer and harvester once `p_silent` is evolved; origin (0.5, 0.5).

## 2. Building states — `building-states`

| key | frames | draw px | origin / use |
|---|---|---|---|
| `state-scaffold-1x1` / `-2x2` / `-3x3` | 1 | 64 / 128 / 192 | (0.5, 1) at footprint bottom-centre, same pads as buildings (13 px/256, 19 px/384). Drawn INSTEAD of the building while under construction |
| `state-ruin-1x1` / `-2x2` / `-3x3` | 1 | 64 / 128 / 192 | as above; drawn INSTEAD of the building after destruction (REBUILD chip). If ghosted, alpha ≥ 0.75 |
| `state-frost-1x1` / `-2x2` / `-3x3` | 1 | = building draw size | ON TOP of the dimmed building, same origin/size, depth + ε, **alpha 0.6** (reviewed value); fade in over the 400 ms dim |
| `state-cracks` | 4, static | 0.5-0.75 × building draw size | frame 0 = `crack-a` (forked) at ≤ 66 % hp, frame 1 = `crack-b` (3-arm), frame 2 = `crack-c` (star puncture) at ≤ 33 % hp, frame 3 = spare zig-zag (unnamed). Origin (0.5, 0.5) on the building's front face (~40 % up from its base) |

Scaffold/ruin cells for footprint N×N: 1×1 and 2×2 share 256 cells, 3×3 uses 384.

## 3. Deposits and relics — `deposits`, `relics` (hd-fx, centre origin)

- `dep-ore`, `dep-ice`, `dep-crystal`, `dep-vent`: 2×2 sheet, 256 cells, static. **Frame = purity:
  0 impure (`dep-<k>-0`), 1 normal (`-1`), 2 pure (`-2`), 3 depleted (`-x`).** Draw the cell at **128 px**
  (2×2 tiles = the extractor footprint), origin **(0.5, 0.5) on the footprint centre**. Do not rescale per
  frame: the size step between frames is the purity read.
- `relics`: 2×2, static, 128 px, origin (0.5, 0.5). Frame 0 `relic-probe` (Probe Wreck), 1 `relic-monolith`
  (Chorus Stone), 2 `relic-buoy` (Signal Buoy), 3 `relic-geode` (Hollow Geode).

## 4. Terrain — `terrain`

- Floors `<biome>-floor-{a,b,c}` for steppe / rime / ember / nacre: 512×512 opaque (`sprite.png`), full-bleed,
  drawn at a **64 px world tile** (tileSprite / per-cell image scaled 0.125); the three variants of a biome are
  interchangeable per cell. No runtime tint other than the night grade.
- Blockers `<biome>-blockers`: 3×3, 256 cells, static, hd-fx centred. Frame i ↔ `<biome>-block-(i+1)`;
  frames 0-5 are the six required blockers, 6-8 spares (ember frame 7 reads as a horned skull — weight low).
  Origin (0.5, 0.5) on the footprint centre; draw at the footprint size (64 px per tile). Per-frame shapes:
  `art/briefs/reports/terrain.md` §Frame map.

## 5. World props — `world-props` (hd-fx, centre origin)

- `props-shared-0/1` (`prop-shared-1..18`) + `props-<biome>-0/1/2` (`prop-<biome>-1..27`): 3×3, 256 cells,
  static; frame i ↔ `icons[i]` (`props-steppe-1` frame 0 = `prop-steppe-10`). Draw at **64-96 px** (80 px
  reviewed), origin (0.5, 0.5) on the footprint centre. Ink is painted in; no runtime outline.
- Relative size is meaningful only within one sheet (one shared fit scale per sheet).
- Object per frame: `art/briefs/reports/world-props.md` §Frame map.

## 6. Fauna — `fauna-a`, `fauna-b`

Walk sheets carry `key: fauna-<species>` (the `content.ts` `artKey`); attack/brood/stomp keys are their ids.
All face **right** (`facesRight` default). Size by **long edge**, never height: display cell size =
`sizePx × cell / walkLongEdge`, applied identically to every action of the species (actions are scale-locked to
the walk profile). Origin **(0.5, groundY)** at the creature's ground point (moth: centre, it flies).

| species | content id | walk key | actions (ms/frame, loop) | cell | sizePx | walk long edge | **display cell px** | groundY (walk / others) |
|---|---|---|---|---|---|---|---|---|
| skitter | skitter | `fauna-skitter` | walk 90 loop · `fauna-skitter-attack` 100 once | 256 | 64 | 220 | **74.5** | 0.930 / 0.930 |
| spitter | spitter | `fauna-spitter` | walk 90 loop · attack 100 once | 256 | 72 | 184 | **100.2** | 0.859 / 0.859 (fit 0.72 on both) |
| brute | brute | `fauna-brute` | walk 90 loop · attack 100 once | 256 | 112 | 220 | **130.3** | 0.930 / 0.930 |
| moth | moth | `fauna-moth` | walk 90 loop · attack 100 once | 256 | 72 | 220 | **83.8** | centre (0.5, 0.5) |
| grub | burrower | `fauna-grub` | walk 90 loop · attack 100 once | 256 | 72 | 220 | **83.8** | 0.930 / 0.930 |
| leech | sapper | `fauna-leech` | walk 90 loop · attack 100 once | 256 | 64 | 157 | **104.4** | 0.953 / 0.961 |
| bloat | bloater | `fauna-bloat` | walk 90 loop · attack 100 once | 256 | 96 | 171 | **143.7** | 0.941 / 0.949 |
| howler | howler | `fauna-howler` | walk 90 loop · attack 100 once | 256 | 88 | 189 | **119.2** | 0.965 / 0.957 |
| matron | matron | `fauna-matron` | walk 90 loop · attack 100 once · `fauna-matron-brood` 120 once | 512 | 176 | 375 | **240.3** | 0.965 / 0.971, brood 0.959 |
| titan | titan | `fauna-titan` | walk 90 loop · attack 100 once · `fauna-titan-stomp` 120 once | 512 | 256 | 378 | **346.8** | 0.945 / 0.947, stomp 0.943 |

- Pass the display cell px as `displayPx` to `teamOutline(key, 'hostile', rank)`; the outline is runtime.
- Death sheets were cut by plan: chitin-shard `burst` + corpse fade.
- Visible (alpha-trimmed) size on screen = sizePx along the long edge, by construction.

## 7. Colony motion — `colony-motion`

| key | frames | ms / loop | origin | draw |
|---|---|---|---|---|
| `drone` | 4 | 90, loop | (0.5, 0.5) | ~28 px long edge (body bbox 230×195 of 256 → cell ≈ 31 px). Draw ABOVE the night-grade layer so the amber reads |
| `lander-shuttle` | 4 | 120, loop | (0.5, 0.5) | nose up (−y), flame down; tween y for descent/launch |
| `ark-silhouette` | 1 (512 cell) | static | (0.5, 0.5) | faces +x; visible bbox 440×98 of 512; tween x across the sky |

## 8. FX — `fx` (hd-fx 256 cells, draw with `BlendModes.ADD`, origin (0.5, 0.5) unless noted)

| key | frames | ms | loop | frame meaning / placement |
|---|---|---|---|---|
| `fx-pulse-bolt` | 4 | 80 | no | 0-1 muzzle flash (at barrel) · 2-3 bolt, head +x; rotate to travel angle |
| `fx-arc` | 4 | 80 | no | filament along +x: 0 faint · 1 bright · 2 bright new path · 3 breaking; scaleX to chain distance |
| `fx-flak` | 4 | 80 | no | 0 shell orb in flight (hold) · 1 flash star · 2 ring + shards · 3 debris |
| `fx-acid` | 4 | 80 | no | 0 glob in flight (hold) · 1 impact · 2 splash crown · 3 puddle |
| `fx-leech-sparks` | 4 | 80 | **yes** | crackle loop while latched |
| `fx-bloat-burst` | 4 | 80 | no | sac split → cloud → ring → wisps |
| `fx-frost-creep` | 4 | 80 | no | growth 0→3; hold 3 on dark buildings; origin (0.5, 0.72) |
| `fx-beacon-beam` | 4 | 80 | **yes** | 0 thin · 1 wide + rings · 2 widest · 3 rings risen; origin (0.5, 0.92), scaleY to sky |
| `fx-launch-flare` | 4 | 80 | no | core → 8-ray star → star + ring → fading ring |
| `fx-dusk-arrow` | 4 | 80 | **yes** | pulse; points −y, rotate to edge direction |
| `fx-build-dust` | 4 | 80 | no | puff → lobes → ring → wisps; origin (0.5, 0.6) at footprint base |
| `fx-upgrade-shine` | 4 | 80 | no | glint → streak → glint + 2 → glint + 1 |
| `fx-relic-burst` | 4 | 80 | no | core → rays + shards → ring → thin ring |

## 9. Icons — `ui`, `icons-a`, `icons-b` (hd-fx 256 cells, static, origin (0.5, 0.5))

Render at 96 px (cards) or 44 px (chips/pills); the tag frame/hue behind directive glyphs is chrome
(`ui/primitives.ts`), not art. `ICON.<name> = { key, frame }`.

| sheet (texture key) | grid | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|---|
| `icons` (ui) | 2x2 | `heart` | `star` | `coin` | `bolt` |  |  |  |  |  |
| `icons-b` (ui) | 2x2 | `shield` | `skull` | `clock` | `levelUp` |  |  |  |  |  |
| `icons-goods-a` | 2x2 | `ferrite` | `ice` | `aurelite` | `alloy` |  |  |  |  |  |
| `icons-goods-b` | 3x3 | `rations` | `prism` | `cell` | `power` | `colonists` | `morale` | `temperature` | `data` | `reroll` |
| `icons-tags` | 3x3 | `tag-hearth` | `tag-forge` | `tag-bul` | `tag-fr` | `tag-kin` | `tag-orb` | `alert-relay-dark` | `alert-hab-cold` | `alert-leech` |
| `icons-alerts` | 3x3 | `alert-order-ready` | `alert-idle-crew` | `alert-starving` | `alert-core-hit` | `alert-alpha` | `kit-engineer` | `kit-warden` | `kit-settler` | `kit-surveyor` |
| `icons-ark` | 3x3 | `kit-tinker` | `ark-hab` | `ark-forge` | `ark-grid` | `ark-bul` | `ark-sur` | `ark-cmd` | `ark-ship` | `ark-locked` |
| `icons-bld-1` | 3x3 | `ico-core` | `ico-drill` | `ico-borer` | `ico-harvester` | `ico-venttap` | `ico-sail` | `ico-bank` | `ico-farm` | `ico-smelter` |
| `icons-bld-2` | 3x3 | `ico-cutter` | `ico-foundry` | `ico-relay` | `ico-silo` | `ico-hab` | `ico-commons` | `ico-pulse` | `ico-arc` | `ico-flak` |
| `icons-bld-3` | 2x2 | `ico-wall` | `ico-beacon` | `ico-upgrade` | `ico-demolish` |  |  |  |  |  |
| `icons-dir-1` | 3x3 | `dir-hearth_insulate` | `dir-hearth_overdrive` | `dir-hearth_battery` | `dir-hearth_vents` | `dir-hearth_sunward` | `dir-hearth_dimming` | `dir-forge_quota` | `dir-forge_parts` | `dir-forge_assay` |
| `icons-dir-2` | 3x3 | `dir-forge_pour` | `dir-forge_lens` | `dir-forge_cell` | `dir-bul_plate` | `dir-bul_pulse` | `dir-bul_arc` | `dir-bul_flak` | `dir-bul_mend` | `dir-bul_salvage` |
| `icons-dir-3` | 3x3 | `dir-fr_relay` | `dir-fr_survey` | `dir-fr_prefab` | `dir-fr_muffle` | `dir-fr_sentry` | `dir-fr_claim` | `dir-kin_hatch` | `dir-kin_lean` | `dir-kin_songs` |
| `icons-dir-4` | 3x3 | `dir-kin_medics` | `dir-kin_rota` | `dir-kin_pact` | `dir-orb_manifest` | `dir-orb_pods` | `dir-orb_resonant` | `dir-orb_band` | `dir-orb_decoy` | `dir-orb_window` |
| `icons-proto-1` | 3x3 | `proto-p_warren` | `proto-p_lattice` | `proto-p_bastion` | `proto-p_crucible` | `proto-p_halo` | `proto-p_plaza` | `proto-p_magma` | `proto-p_vault` | `proto-p_aurora` |
| `icons-proto-2` | 3x3 | `proto-p_storm` | `proto-p_sky` | `proto-p_living` | `proto-p_slag` | `proto-p_focus` | `proto-p_lumen` | `proto-p_silent` | `proto-p_geode` | `proto-p_infirm` |
| `icons-proto-3` | 3x3 | `proto-p_choir` | `proto-p_exchange` | spare | spare, **`$` glyph — never wire** | spare | spare | spare | spare | spare |

Content-id coverage: goods 7, stats 6, tags 6, alerts 8 (all `AlertKind`s), kits 5, Ark branches 6 (+ ship,
locked), buildings 20 (+ upgrade, demolish), directives 36, protocols 20 — every id has a frame, zero placeholders.

## 10. Hub and backdrop — `hub`, `bg` (full-bleed, `sprite.png`)

| key | size | use |
|---|---|---|
| `hub-planet-map` | 720×900 | hub saga map, bands bottom→top steppe, rime lake, ember mire, nacre + aurora. Site-node centres: `art/briefs/reports/hub.md`. Labels need the 0.6 band or a panel (ink 2.40:1 on the lightest window) |
| `postcard-<site>` | 600×360 | site ids `halcyon`, `prism_reach`, `rimewater`, `cinder_fen`, `frostcrown`, `sulfur_hollow`, `nacre_shelf`, `aurora_rift`. PRD §5.4's `site-*` texture names do not exist — read these keys |
| `bg-arena` (alias `TEXTURE.backdrop`) | 720×1280 | menu/backdrop, `coverFit`; text over the amber horizon band needs the 0.6 band |
| `logo` (alias `TEXTURE.logo`) | 512×512 | OUTPOST AURELIA wordmark + dome emblem; do not also render the title as text |
