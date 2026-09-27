# Group `hub` report (owner ArtHubBg)

**Tool probe:** `generate_image` → `xai-oauth / grok-imagine-image`, 1024×1024 JPEG, no marker. OK.
`sprite_check_palette`, `art_review` present and used. Measured transport boundary: 5 concurrent
`generate_image` calls → 4 failed with `urlopen error [Errno 49] Can't assign requested address`
(local socket exhaustion, not the provider); 3 concurrent calls succeeded 5 times out of 5 batches.

Landed: `public/assets/generated/hub/` — all 9 ids. Missing: none.

## Per-asset table

All raws `xai-oauth`, all exports `fullBleed`, `threshold 1 / edgeThreshold 1`, strict QC **passed**
(background-contamination waived by fullBleed, which is structural, not a relaxation).
Processing: `art/exports/hub/fitcrop.py` (frame strip + centred aspect crop + process-sprite full-bleed
re-export; see CRITERIA). meanDistance against `art/style.json` (max 52).

| id | Intent (PRD §5.4) | Raw → export | meanDistance / outliers | Generations | Visual verdict |
| --- | --- | --- | --- | --- | --- |
| hub-planet-map | Aurelia saga map, 4 biome bands bottom→top: steppe, rime lake, ember mire, nacre cliffs + aurora | 1776×2368 → crop 1776×2220 → 720×900 | 25.49 / 0.4% | 4 (3 regens, 3 different symptoms — see below) | accepted: painterly Syd Mead oblique map, every biome legible, broad calm areas for nodes. Residual: faint route hairlines + ~6 px pin dots in the ice band (qcException in delta) |
| postcard-halcyon | Halcyon Flats: mild ochre steppe, mesas, ringed moon, tiny landing dome | 2496×1664 → 2496×1498 → 600×360 | 29.50 / 0.01% | 2 (a1 cel-style + 386 px pink frame, off-set style) | accepted |
| postcard-prism_reach | Prism Reach: violet/nacre crystal forest, violet sky, two moons | same | 22.62 / 0.5% | 2 (a1 cloned halcyon a1 foreground when conditioned on it) | accepted |
| postcard-rimewater | Rimewater: frozen lake of cracked frost-blue plates | same | 30.65 / 2.6% | 2 (a1 clone of halcyon composition) | accepted |
| postcard-cinder_fen | Cinder Fen: steaming rust marsh, glowing vents | same | 19.92 / 0.04% | 1 | accepted |
| postcard-frostcrown | Frostcrown: snowy caldera rim, blown snow | same | 32.84 / 8.5% | 1 | accepted (outliers = pure white snow; the list has no white above #e3dcc4 — a fact about the list) |
| postcard-sulfur_hollow | Sulfur Hollow: yellow terraced sinks, burrow holes | same | 22.48 / 0.01% | 1 | accepted |
| postcard-nacre_shelf | Nacre Shelf: pearl cliffs cut by a narrow pass | same | 27.85 / 0.9% | 1 | accepted |
| postcard-aurora_rift | Aurora Rift: dark canyon, violet aurora, faint lime lights in the rift | same | 18.71 / 0.07% | 1 | accepted (the lime pinpoints are the fauna/Chorus cue, art-only lime per interface-direction) |

Frame maps: every asset is `1x1`, frame 0 = the image. No sheets, no animation.

Contact sheets reviewed: all 8 postcards side by side (one painterly register after the halcyon/prism
rerolls), and the graded map with nodes (`art/exports/hub/graded-hub-map.png`).

## Set gates

- `art_review` set call (12 assets: 9 hub + bg arena + bg logo + cover, `renderScale 256`,
  `fullBleedAssets` = everything but the logo): **passed**, 0 fail findings. Warnings, with scope:
  `value-plan-miss:*` / `value-tier-absent:*` on postcards (rimewater 1% darks, cinder 1% lights,
  nacre 9% darks) and `temperature-single` (halcyon 92% warm, rimewater 96% cool). Scope: the plan's
  value/temperature split was calibrated on ACTOR sprites (buildings/fauna on a floor); a single-biome
  postcard IS one temperature by brief (PRD tint column: halcyon `#c9b48a`, rimewater `#8fb0c4`). Reported,
  not acted on. Silhouette pairs all `exempt: full-bleed` (distance 0.000 is arithmetic on opaque art).
- Planet map value spread 0.606, darks/mids/lights 27/59/15 — closest asset in the group to the plan.
- `figure-ground.py`: **not applicable**. No actor stands on any hub asset (the map carries UI site
  nodes, postcards are card art); running it with no actor cast would be a different criterion.
  The equivalent readability check for this group is the UI one below.

## Site-node plan (for W4 `ui/sagaMap.ts`; measured, not asserted)

Map-local centres (map drawn at 720×900; scale proportionally if drawn smaller). Chosen by a local
search (±40 px) for the lowest 97×97 box-blurred edge density around a zig-zag seed; every 96 px disc
sits in its own biome, min centre spacing 196.9 px (≥ 96). Edge density under the disc vs map mean 15.9:

| site | centre (x, y) | edge density |
| --- | --- | --- |
| halcyon | (168, 812) | 10 |
| prism_reach | (480, 744) | 5 |
| rimewater | (188, 580) | 15 |
| frostcrown | (500, 534) | 12 |
| cinder_fen | (150, 378) | 15 |
| sulfur_hollow | (490, 310) | 12 |
| nacre_shelf | (220, 194) | 10 |
| aurora_rift | (540, 70) | 8 |

Route order on the map follows biome bands (steppe → rime → ember → nacre), so frostcrown (9★) sits
before cinder_fen (6★) along the path; unlock order is data, not geography. Overlay proof:
`art/exports/hub/hub-planet-map-node-plan.png` and `graded-hub-map.png`.

## Wiring contract (consumers)

Group `hub` must be added to the colony slice's `ART_GROUPS`. Registry keys are whatever
`gen-art-registry.mjs` derives from the ids (default: the id); rows are 1 frame, `sprite.png`:
`hub-planet-map` (720×900), `postcard-<site id>` (600×360) for the 8 site ids of PRD §5.4. PRD §5.4's
`Texture` column names `site-halcyon`, `site-prism`, `site-cinder` … — the manifest ids are
`postcard-<id>`; W3/W4 must read the manifest keys (or the art owner adds aliases), not the PRD column.

Text-over-art flags for ui-engineer (graded measurement, `art/exports/hub/scrim_preview.py`): on the
hub map under the 0.35 bgDeep scrim, ink `#efe6d4` is 12.70:1 on the darkest caption window but
**2.40:1 on the lightest** (nacre cliffs / ice), inkSoft 1.13:1 there. Every label on the map (site
names, the selected-site card) needs the 0.6 band or a panel, exactly as interface-direction §4 says.
Postcard captions likewise: rimewater, frostcrown and nacre_shelf are light-dominant (41%, 20%, 27%
lights).

## CRITERIA

- **Retracted for this population: the marker-driven export path for full-bleed portraits.** Measured
  in the plugin source, `extensions/sprite-generate.ts:494-526` (`augmentPrompt`): with an
  `OMP_SPRITE_EXPORT` marker the middleware appends "Create one isolated sprite centered with broad
  empty padding", "central 65-70% safe area" and "fill the complete canvas with #FF00FF" **even when the
  marker sets `fullBleed: true`**. Result on this group: pink frames 386/330 px on a 2496×1664 postcard,
  229-287 px on the cover, 400-485 px and an island-shaped map (a2), and a backdrop painted as a
  520×924 card on a 1584×2816 pink sheet (a1). The plan's §0.4 "85-90 px frame" figure was measured on
  SQUARE tiles and does not transfer to portraits. Filed via `xd://report_issue`. Workaround used for 10
  of the 12 final raws (all 9 hub ids + bg/arena; the logo and cover kept their markers): `generate_image` WITHOUT the marker (so no injection), then the same
  sprite-forge processor (`process-sprite.ts --full-bleed --strict --threshold 1 --edge-threshold 1
  --cell-size W --cell-height H`) via `fitcrop.py ingest`. Provenance is recorded
  (`sprite-metadata.marker.json.source.generatedWithoutMarker: true`, provider, temp file name).
- **Rescoped: sibling-tile-as-Image-1 conditioning** (game-art rule 1) is a TILE rule. On landscape
  postcards it produced composition clones (prism a1 reused halcyon's crystal foreground exactly,
  rimewater a1 reused the hills and crystals). Postcards went text-only with a shared style string;
  coherence then held (one painterly register across all 8 in the contact sheet).
- **deframe.py scope**: detects frames on 8 lines at 1/9..8/9 and takes one uniform inset. On a portrait
  with a 230 px side frame the 1/9 line runs down INSIDE the frame and reports the whole height
  (crash, measured on the cover). `fitcrop.py` samples 7 lines in the central 23-69% band, per side,
  and also skips the dark ink border xai draws just inside the pink frame (≤ 24 px, sum < 150).
- **Processor fact, not a criterion**: `fullBleed` resizes the whole cell to `cellSize × cellHeight`
  without preserving aspect (`process-sprite.ts:716-741`), so a 3:2 raw exported at 600×360 would be
  stretched 11%. `fitcrop.py` centre-crops to the target aspect first.
- `meanDistance` read as distance from the 18-colour LIST only (frostcrown 8.5% outliers = pure snow
  white the list lacks); not used as a quality ranking.
- **Post-review pixel transforms** reviewed through, reproduced by `art/exports/hub/scrim_preview.py`:
  hub map + bgDeep 0.35 flat scrim + 96 px nodes (graded image reviewed, numbers above). No runtime
  tint/grade touches hub art (the night grade is world-camera only per interface-direction §4).

## manifest-delta

```json
{
  "ATTEMPTS": {"hub-planet-map": 4, "postcard-halcyon": 2, "postcard-prism_reach": 2, "postcard-rimewater": 2,
               "postcard-cinder_fen": 1, "postcard-frostcrown": 1, "postcard-sulfur_hollow": 1,
               "postcard-nacre_shelf": 1, "postcard-aurora_rift": 1},
  "qcExceptions": [
    {"id": "hub/hub-planet-map", "reason": "4 generations over 3 distinct symptoms (baked UI discs, island-on-pink from marker injection, parchment edge + pins); accepted take keeps faint route hairlines and ~6 px pin dots in the ice band, negligible under the 0.35 scrim and covered where the 96 px site nodes sit"}
  ],
  "groups.hub.note": "Full-bleed hub art; planet map portrait 720x900, postcards 600x360. Generated marker-less (middleware injects the isolated-sprite/#FF00FF contract even with fullBleed) and processed by art/exports/hub/fitcrop.py (process-sprite --full-bleed --strict). Site-node centres: art/briefs/reports/hub.md."
}
```
