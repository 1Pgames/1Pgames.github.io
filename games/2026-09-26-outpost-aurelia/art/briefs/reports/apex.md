# apex — Mk IV protocol evolutions + silent badge (owner: ArtApex)

**Tool probe:** `generate_image` 1024x1024 no-marker probe → `xai-oauth / grok-imagine-image`, OK.
Every call was served by `xai-oauth` (`sprite-metadata.json.source.provider` on all 17 exports).

**Status: landed complete.** 17/17 ids in `public/assets/generated/apex/<id>/`, 0 missing, 0 placeholders.
Staging: `art/exports/apex/` — `_ref/` (Image 1 inputs), `_raw/` (every raw, numbered by attempt),
`_rejected/` (rejected exports), `prep_refs.py`, `process_raw.py`, `compare.py`,
`qc-apex-vs-mk3.png` (every Mk III frame 0 beside its apex), `qc-render-64.png`.

## How the set was made

- Image 1 = frame 0 of the accepted Mk III (`frames/frame-000.png`; for the beacon, `bld-beacon`), flattened
  onto #FF00FF and scaled 2x (`prep_refs.py`). Single frame, never the whole sheet. Image 2 = the vision
  anchor, appended by the `styleProfile` middleware.
- **Measured: with the Mk III as Image 1, xai draws a near-copy.** First pass, 16 building calls: hab, pulse,
  sail, arc, flak and harvester came back as the Mk III plus one or two small details (see `_rejected/`),
  and the brief's "a redesign, NOT a copy of Image 1" did not stop it. The fix was a **text-only call**
  (vision anchor only, building identity described in words). All 7 text-only rerolls (sail, arc, flak,
  harvester, relay, beacon, foundry-a2) came back distinct; 6 of 7 kept the building's identity (foundry-a2 did not).
- **Measured: putting a quoted protocol name in the prompt ("Mk IV APEX model 'Focus Array'") made xai paint
  the text "Mk IV APEX" on cutter a1.** The rerolls dropped the quoted names and added "no lettering,
  no labels, no numbers". Text scan: the 10 accepted raws from named-prompt calls were checked in a 420 px-per-raw
  montage, and cutter a2 at full 1024 px; the text-only ones only in the 200 px compare sheet. No lettering was found.
- Common apex visual language (every building): gilded brass trim, extra sodium-amber lamps, brass fins, and a
  violet-nacre crystal "protocol core" lamp. Each building also gets a feature from its protocol effect (table below).

## Per-asset table

Processing is the same on all 16 buildings: `hd-body`, `scale fit`, `fit 0.9` (wall 0.97), `align bottom`,
threshold 150 / feather 55 / edgeThreshold 170, smooth, componentMode all, strict, chroma guard OFF
(`rekey.py` on marker-passed exports, `process_raw.py` on marker-failed raws; the two apply identical params).
Every export: `qc.passed: true`, `metadata.output.scaleMode: "fit"`, `qc.notes` empty.
meanDistance limit is 52. Area = visible (alpha ≥ 128) px of apex ÷ Mk III frame 0, both after fit. Brass share = the
fraction of visible px that are brass/amber (hue 29-61°, sat > .45, val > .45).

| id | protocol (PRD §5.3) | apex read | cell | gens | meanDistance / outlier | area vs Mk III | brass apex / Mk III | own-pair occupancy dist | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bld-hab-apex | p_warren Warren Dome | quilted rime bolster, brass ribs, lantern cupola, side heat fins | 256 | 2 | 27.50 / .029 | 1.01 | .219 / .129 | .059 | a2 accepted (a1 near-copy) |
| bld-pulse-apex | p_lattice Pulse Lattice | same egg + 4 barrels, brass bands, back fins, lattice sensor mast | 256 | 3 | 28.26 / .090 | 0.83 | .199 / .083 | .090 | a3 accepted (a1 near-copy; a2 lost the 4 barrels = identity drift) |
| bld-wall-apex | p_bastion / p_living | brass wedge spikes along the crest, lamp window strip | 256, fit .97 | 1 | 27.52 / .027 | 1.08 | .184 / .183 | **.048** | accepted: plate footprint is locked by wall tiling (see CRITERIA) |
| bld-smelter-apex | p_crucible / p_slag | twin molten crucibles under brass hoods, twin chimney, lamp plinth | 256 | 1 | 28.58 / .034 | 0.63 | .233 / .086 | .230 | accepted |
| bld-relay-apex | p_halo Halo Pylons | two wide brass halo rings with warning lamps, crystal antenna | 256 | 2 | 29.99 / .059 | 0.69 | .400 / .171 | .140 | a2 accepted (a1 slimmer than Mk III) |
| bld-venttap-apex | p_magma Magma Well | drum sunk in a molten magma ring, 4 brass stacks, cream/brass cladding | 256 | 1 | 28.31 / .035 | 0.97 | .377 / .121 | **.044** | accepted: grey-steel → cream/brass + magma ring (see CRITERIA) |
| bld-bank-apex | p_vault Capacitor Vault | two-tier rack, twice the cells, brass bus bars, crystal regulator | 256 | 1 | 36.51 / .160 | 1.29 | .148 / .087 | .145 | accepted (teal charge glow = highest meanDistance, inside 52) |
| bld-sail-apex | p_aurora Aurora Sails | 8-petal flower with violet-nacre aurora panels, amber hub | 256 | 2 | 30.32 / .068 | 1.21 | .131 / .381 | .113 | a2 accepted (a1 near-copy) |
| bld-arc-apex | p_storm Storm Coil | brass-caged coil, stacked torus, crystal spike, swept brass wings | 256 | 2 | 29.47 / .067 | 0.71 | .209 / .068 | .142 | a2 accepted (a1 near-copy) |
| bld-flak-apex | p_sky Skyshatter | 3-tube fan mount, brass sleeves, lamp-rimmed bunker | 256 | 2 | 22.45 / .019 | 0.82 | .092 / .061 | .129 | a2 accepted (a1 near-copy); the tubes are lower than on the Mk III |
| bld-cutter-apex | p_focus Focus Array | two brass lens arms on the crystal, lens turret, brass lamp plinth | 256 | 2 | 28.90 / .049 | 1.14 | .297 / .024 | .135 | a2 accepted (a1 had "Mk IV APEX" painted on it) |
| bld-foundry-apex | p_lumen Lumen Forge | twin brass lamp spires with lumen cells, radiator fins, crystal tip | 256 | 2 | 26.06 / .033 | 1.07 | .119 / .011 | **.049** | a1 accepted; the a2 twin-tower gate lost the tower identity (in `_rejected/`) |
| bld-harvester-apex | p_geode Geode Rig | raised brass saw arms with crystal-tooth blades, sensor mast | 256 | 2 | 26.88 / .035 | 0.85 | .120 / .106 | .253 | a2 accepted (a1 near-copy) |
| bld-commons-apex | p_infirm Infirmary | two-wing ward, glass clinic dome, teal cross sign (0 green px), crystal lamp | 256 | 1 | 31.73 / .059 | 0.99 | .212 / .122 | .074 | accepted |
| bld-beacon-apex | p_choir Choir Spire | 3 brass resonance rings, 4 tuning-fork pylons flaring into a crown | 384 | 2 | 28.59 / .053 | 1.88 | .226 / .040 | a1 .039 → a2 ≥ .10 | a2 accepted (a1 same silhouette) |
| bld-silo-apex | p_exchange Orbital Exchange | tank cluster + brass gantry with cargo pod, fins | 256 | 1 | 27.00 / .036 | 0.83 | .158 / .029 | .156 | accepted |
| badge-silent | p_silent Silent Bore (drill/borer/harvester overlay) | brass-rimmed plum enamel disc: cream drill bit, teal sound arcs, brass strike bar | 256 hd-fx centred | 1 | 23.05 / .005 | — | — | — | accepted; reads at 32 px |

Area < 1 on some ids comes from `fit` normalisation: a taller apex (mast, halo, sensor) scales the whole sprite
down so it fits 0.9 of the cell. The extra height is the bigger silhouette. Not rerolled.

Residual key tint: share of visible px with `min(r,b)-g>40 & r>150 & b>120`. Apex range 0.00-0.13 %; the canon band
from the buildings-a CRITERIA is 0.00-0.44 %. Nothing rejected.

## Frame map

All 17 are single-frame `sprite.png` (+ `sprite-sheet.png`, identical 1x1), duration 0.
Buildings are 256×256; `bld-beacon-apex` is 384×384. Frame 0 = the only frame.
They are static, and there is no multi-action character in this group, so no frame-0 consistency sheet is
needed. The identity check between tiers is `qc-apex-vs-mk3.png`: each Mk III frame 0 beside its apex.

## Content-id coverage (this group)

| protocol | building art key (PRD `apexArtKey`) | icon | world fx |
| --- | --- | --- | --- |
| p_warren, p_plaza | bld-hab-apex (both hab protocols share one sprite) | icons-b `icons-proto-*` | — |
| p_lattice | bld-pulse-apex | icons-b | pulse bolt (fx group) |
| p_bastion, p_living | bld-wall-apex | icons-b | — |
| p_crucible, p_slag | bld-smelter-apex | icons-b | — |
| p_halo | bld-relay-apex | icons-b | — |
| p_magma | bld-venttap-apex | icons-b | — |
| p_vault | bld-bank-apex | icons-b | — |
| p_aurora | bld-sail-apex | icons-b | — |
| p_storm | bld-arc-apex | icons-b | arc segment (fx group) |
| p_sky | bld-flak-apex | icons-b | flak shell/burst (fx group) |
| p_focus | bld-cutter-apex | icons-b | — |
| p_lumen | bld-foundry-apex | icons-b | — |
| p_geode | bld-harvester-apex | icons-b | — |
| p_infirm | bld-commons-apex | icons-b | — |
| p_choir | bld-beacon-apex | icons-b | beacon beam (fx group) |
| p_exchange | bld-silo-apex | icons-b | — |
| p_silent | badge-silent (overlay on drill / borer / harvester) | icons-b | — |

That is 20 protocols → 16 building sprites + 1 badge: all covered, zero placeholders.

## Wiring contract (registry keys = manifest ids, group `apex`)

| key | file | frame | frames | duration | draw |
| --- | --- | --- | --- | --- | --- |
| bld-{hab,pulse,wall,smelter,relay,venttap,bank,sail,arc,flak,cutter,foundry,harvester,commons,silo}-apex | sprite.png | 256×256 | 1 | 0 | same footprint/draw size as that building's Mk III |
| bld-beacon-apex | sprite.png | 384×384 | 1 | 0 | 3×3, 192 px, like bld-beacon |
| badge-silent | sprite.png | 256×256 | 1 | 0 | overlay ~24-32 px at the top-right of every drill/borer/harvester once p_silent is evolved |

- Buildings are bottom-aligned with the same pad as the Mk III, so origin (0.5, 1) is the ground contact. Walls
  use fit 0.97 (4 px pad), so segments butt exactly like `bld-wall-mk3`.
- Apex sprites are static. While an apex building works, the integrator plays no Mk III work loop over it.
  If a work pulse is wanted, use a tint/scale pulse (runtime transform, see CRITERIA).
- `apex` must be listed in the colony slice's `ART_GROUPS`, or nothing loads it.

## Set gates

**art_review** (32 assets = 16 apex + their 16 Mk III frame-0 images, renderScale 128, each asset its own
character, so every apex-vs-own-Mk III pair is gated):
- Cross-building pairs: minimum apex-vs-apex 0.086 (arc × beacon), next 0.098 (relay × beacon). No cross-building
  collision finding.
- Apex vs own Mk III: 4 findings at the tool's gate, all on this pair type: beacon a1 .039 (rerolled, a2 passes), venttap .044,
  wall .048, foundry .049. The remaining 12 pairs are .059-.253. The criterion is scoped in CRITERIA.
- Per-asset: value spread 0.77-0.90 on every apex (no collapsed range). The only other findings are
  `value-plan-miss:*` (all cream-hulled buildings, including the canon) and `temperature-single` on venttap
  (92 % warm: magma and brass).
**sprite_check_palette:** 17/17 pass, meanDistance 22.45-36.51 (limit 52).
**figure-ground.py:** this group has no field (no floor, tile or backdrop), so it is not this group's gate. The
buildings share the scene cast with the buildings-a/b/c groups, and those groups ran it (clash 0.00 %).
Not re-run here.
**manifest-lint:** not run. I edit no manifest; the delta below needs the owner's merge + lint.

## CRITERIA

- **Silhouette occupancy "apex vs own Mk III ≥ tool gate" is retracted as a reject criterion.** It was quoted
  only because the brief asks that each apex be distinct from its Mk III. Scope: the tool calibrated
  silhouette-collision on DIFFERENT characters; an apex is by design the same building on the same footprint.
  Tested against the accepted canon, the same pair type (Mk I vs Mk III of one building) measures 0.003-0.086
  (buildings-b report; the wall pair is 0.008), so the rule rejects the canon and is wrong for this population. Used instead:
  visual side-by-side (`qc-apex-vs-mk3.png`), brass share (up on 15 of 16; sail's Mk III is already gold
  petals) and visible area. It was still used as a tie-breaker to reroll the beacon (a2 is clearly broader). The
  other three stay, each distinct by a named visual: venttap changes hue family (grey steel → cream/brass +
  magma ring); wall keeps the plate by design (tiling); foundry keeps its tower identity (the silhouette-changing a2 lost it).
- **Provider behaviour (measured this wave, xai, 28 calls):** with an explicit Image 1 input the marker export failed strict QC
  on 15 of 20 calls (14 `source-edge-touch`, 1 `background-contamination`). Text-only calls failed on 1 of 8 (foundry-a2). That failure
  is the chroma-guard failure the buildings-a/-c reports record. Every one was recovered with the guard-free processing
  of the same raw (`process_raw.py`); no regeneration was spent on it. One raw (foundry a1) came back
  with a dusty-pink key `rgb(204,95,150)` and failed `background-contamination`. It was fixed by
  `art/exports/buildings-b/degrid.py --no-grid` (key normalised to #FF00FF within radius 60), then processed.
  As a result, `public/.../bld-foundry-apex/raw-source.jpg` holds the key-normalised PNG bytes; the untouched raw is
  `_raw/bld-foundry-apex-1.jpg`.
- **Pixel transforms before review (part of the shipped asset, reviewed through):** guard-free keying on all 17;
  key normalisation on foundry. Scripts: `art/exports/apex/process_raw.py`, `art/tools/rekey.py`,
  `art/exports/buildings-b/degrid.py`.
- **Pixel transforms after review (runtime), not reviewed through:** night grade `#2c2640` @ 0.55, the building
  dim-to-night tint, the baked ink outline from `core/outline.ts`, and any evolve-cinematic tint. They are open for the
  same reason as in buildings-a/b/c: the runtime values are not final. Offline repro of the grade = multiply by #2c2640, blend 0.55
  (buildings-b `frame0-night-grade.png` recipe).
- meanDistance is read as distance from the 18-colour list, not as quality.

## Regeneration counts

28 generation calls + 1 probe. hab 2, pulse 3, relay 2, sail 2, arc 2, flak 2, cutter 2, foundry 2 (a1 kept),
harvester 2, beacon 2; wall, smelter, venttap, bank, commons, silo and badge 1 each. Pulse reached attempt 3 on a
different symptom (a1 copy → a2 identity drift → a3 accepted). Its `qcExceptions` entry is in the delta: this agent
cannot write the manifest.

## manifest-delta

```json
{
  "group": "apex",
  "note": "Mk IV protocol variants. Image 1 = single-frame Mk III crop flattened on #FF00FF (or text-only when Image 1 was copied), Image 2 = vision anchor. hd-body, marker \"scale\":\"fit\", fit 0.9 (wall 0.97), align bottom, cellSize 256 (beacon 384), threshold 150, chroma guard off (rekey / art/exports/apex/process_raw.py). badge-silent: hd-fx centred 256.",
  "attempts": {
    "bld-hab-apex": 2, "bld-pulse-apex": 3, "bld-wall-apex": 1, "bld-smelter-apex": 1,
    "bld-relay-apex": 2, "bld-venttap-apex": 1, "bld-bank-apex": 1, "bld-sail-apex": 2,
    "bld-arc-apex": 2, "bld-flak-apex": 2, "bld-cutter-apex": 2, "bld-foundry-apex": 2,
    "bld-harvester-apex": 2, "bld-commons-apex": 1, "bld-beacon-apex": 2, "bld-silo-apex": 1,
    "badge-silent": 1
  },
  "qcExceptions": [
    { "id": "bld-pulse-apex", "reason": "3rd attempt on a new symptom: a1 near-copied the Mk III, a2 dropped the four emitter barrels; a3 keeps egg + 4 barrels with brass bands, fins and sensor mast" },
    { "id": "bld-wall-apex", "reason": "art_review own-pair occupancy 0.048 vs Mk III: plate outline is locked by side-by-side tiling; apex reads by brass crest spikes + lamp strip" },
    { "id": "bld-venttap-apex", "reason": "art_review own-pair occupancy 0.044 vs Mk III: same drum footprint, but grey steel became cream/brass cladding over a glowing magma ring" },
    { "id": "bld-foundry-apex", "reason": "art_review own-pair occupancy 0.049 vs Mk III: kept tower identity (a2 gate redesign lost it); apex reads by twin amber-lamp brass spires + radiator fins" }
  ]
}
```
