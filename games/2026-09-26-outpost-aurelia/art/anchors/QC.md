# Anchor QC (art-director, vision-lock pass)

Tool probe: `generate_image` → xai-oauth / grok-imagine-image, 1024×1024 JPEG. OK.
Every raw is `raw-source.jpg`. The marker export's metadata is `sprite-metadata.marker.json`; the
shipped `sprite-metadata.json` is the re-key (`rekey` field names the script).

| Asset (staged path) | Intent | Grid / cell | Attempts (regens) | meanDistance | Export QC | Visual verdict |
| --- | --- | --- | --- | --- | --- | --- |
| buildings-a/bld-core | Lander Core 3×3 | 1x1 / 384 | 1 (contamination: pink key) | 26.12 | strict pass, h 291 | accepted: cream dome, amber window ring, teal ramp, heavy ink outline |
| buildings-a/bld-drill-mk1 | Ferrite Drill Mk I, 4f work loop | 2x2 / 256 | 2 (pink key; subject too small → wider brief + fit 0.9 re-process) | 25.39 | strict pass, h 230, bodyScaleCv 0.000 | accepted with note: it reads as a dome-base rig with a lattice mast and the piston motion is subtle. Budget spent |
| buildings-c/bld-pulse-mk1 | Pulse Turret Mk I idle | 1x1 / 256 | 1 (pink key) | 24.86 | strict pass, h 204 | accepted: twin amber emitters on a teal ring; the pink muzzle halo was removed by the re-key |
| fauna-a/fauna-skitter-walk | Glass Skitter 4f walk + `fauna-skitter-scale.json` | 2x2 / 256 | 1 (pink key) | 26.72 | strict pass, h 95, bodyScaleCv 0.002 | accepted: glass-violet chitin, lime lens eyes, clear leg alternation. **Small in its cell** (95/256), so the fauna agents should process with fit or size by `visiblePx` at runtime |
| icons-a/icons-goods-a | ferrite, ice, aurelite, alloy | 2x2 / 256 | 1 (pink key) | 30.38 | strict pass | accepted after the re-key: the pink halo on aurelite is gone |
| terrain/steppe-floor-a | Glass Steppe floor | 1x1 / 512 full-bleed | 1 (value-spread-flat 0.03 → mottled brief) | 6.57 (1st take) | strict pass; frame 85 px stripped (deframe) | accepted: L* p5/mean/p95 21.0/24.6/29.0, no visible seam in a 2×2 tiling, mild repetition |

Set gates:
- `art_review` (6 assets, renderScale 128): silhouettes pass, cross pairs 0.128-0.485. Value-plan
  misses are warnings only (the core runs 53% lights against a planned 15%: cream hulls are light by
  design). The 1st floor failed `value-spread-flat` (0.03); that was the reroll reason.
- `figure-ground.py --scene glass-steppe`, actors = core + drill + pulse + skitter, field =
  steppe-floor-a, renderScale 128: clash 0.00%, busyRatio 0.08×, C1 PASS, read recessive, exit 0.
  The cast is partial: the rest of the buildings and fauna do not exist yet. Re-run after wave 1.

Post-review pixel transforms, not yet reviewed through (no build): the night grade (#2c2640 at alpha
0.55, world camera), lit ground +12% lightness, the runtime fauna outline #3a1712, and the
building dim-to-night tint. Re-run figure-ground with `--grade` once the runtime values are final.
