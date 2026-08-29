# Group `elites-warden` — Gate Warden (8 sheets, GenWarden)

Owner: GenWarden. Scope: the 8 `boss-warden-*` assets only. The 3 elites (`elite-reaper-*`,
`elite-matron-*`, `elite-herald-*`) belong to GenElites and are not covered here.

**8 of 8 accepted. 1 qcException.**

## Per-asset

| id | frames | grid | cell / aspect | qc.passed | cv | anchorYStd | profile drift | meanDistance | retries | provider (source.file) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| boss-warden-idle | 4 | 2x2 | 627x627 / 1.0 | true | 0.0000 | 0.0303 | — (base) | 18.91 | 4 | codex (.webp) |
| boss-warden-sweep | 6 | 2x3 | 341x512 / 0.667 | true | 0.0457 | 0.0678 | n/a (unbound) | 18.87 | 5 | xai (.jpg) |
| boss-warden-summon | 4 | 2x2 | 627x627 / 1.0 | true | 0.0011 | 0.0000 | 0.0096 | 19.11 | 2 | codex (.webp) |
| boss-warden-enrage | 4 | 2x2 | 627x627 / 1.0 | true | 0.0170 | 0.0024 | 0.0266 | 18.47 | 0 | codex (.webp) |
| boss-warden-death | 8 | 2x4 | 256x512 / 0.5 | true | 0.2072* | 0.0890* | n/a (unbound) | 17.23 | 2 | xai (.jpg) |
| boss-warden-idle-outlands | 4 | 2x2 | 512x512 / 1.0 | true | 0.0026 | 0.0303 | 0.0031 | 17.32 | 0 | xai (.jpg) |
| boss-warden-idle-desert | 4 | 2x2 | 512x512 / 1.0 | true | 0.0238 | 0.0303 | 0.0429 | 19.97 | 1 | xai (.jpg) |
| boss-warden-idle-winter | 4 | 2x2 | 512x512 / 1.0 | true | 0.0152 | 0.0303 | 0.0142 | 29.62 | 0 | xai (.jpg) |

Output root: `games/2026-08-29-duskhaul/public/assets/generated/elites-warden/<id>/`.
All 8 have `sprite-sheet.png` present (every asset is rows*cols > 1, so `sprite.png` does not apply).
All 8 are discrete sprites, so `minAlpha` 0 / `fit` 0.86 are the CORRECT values for this class — the
full-bleed tile test (`minAlpha` 255 / `fit` 1) does not apply to any asset in this group.

`*` reported as `qc.postureChange[]` notes rather than failures — see qcExceptions.
Provider read from `sprite-metadata.json.source.file`, not from a `raw-source.*` glob. Every dir holds
exactly one `raw-source.*`; the dual-raw ambiguity in `boss-warden-sweep` was swept (stale `.webp` from a
discarded codex attempt deleted; the shipped sheet md5-matches the `.jpg`).

## Scale profile

`public/assets/generated/elites-warden/warden-scale.json`, `profileName: warden`, written from the
accepted `boss-warden-idle` export: `bodyScaleMean` 0.7496, `anchorYMean` 0.8549, source cell 627x627,
`threshold` 150 / `edgeThreshold` 150.

Reused with `maxBodyScaleCv` 0.08 / `maxAnchorYStd` 0.05 / `maxProfileScaleDrift` 0.08 by summon, enrage
and all three zone skins — max observed drift 0.0429, i.e. every bound sibling landed at roughly half the
gate or better. sweep (2x3) and death (2x4) are unbound per the brief and the build-wide death unbind;
they carry the intra-sheet gates only.

The three zone skins were rendered on xai at 512x512 cells while the profile was built on codex at
627x627. Aspect matches at 1.0, which is all the profile binder checks, so they bind correctly — a
mixed-provider chain is mechanically fine.

## qcExceptions (reported only — shared manifest not edited)

- `{ "id": "elites-warden/boss-warden-sweep", "reason": "anchorYStd 0.0678 vs gate 0.05. The take that
  cleared the gate mechanically had lost the action entirely — six near-identical rest poses, no swing,
  no telegraph — so the correct sweep was kept instead. The overage is a uniform row offset (top row
  anchors y=434, bottom row y=365), not per-frame jitter, so the feet line is stable within each row and
  the animation does not visibly bob." }`

`boss-warden-death` needs **no** exception: `--posture-change` routes its two scale overages into
`qc.postureChange[]` while contamination and edge-touch stay fatal, so `qc.passed=true` honestly. The
overages come solely from frame 8 collapsing to `bodyScale` 0.219 — frames 0-6 hold 0.514-0.529, which is
the character scale staying constant while the silhouette legitimately falls.

## Group art_review

Mandated cross-character SET call (elite `-move` sheets + `boss-warden-idle`) — **silhouette variety
PASSED**, no collisions. Mass hierarchy holds: warden-idle vs reaper-move 0.092, vs matron-move 0.170,
reaper vs matron 0.123.

| sheet | dark | mid | light | spread | warmShare | coolShare |
| --- | --- | --- | --- | --- | --- | --- |
| boss-warden-idle | 0.944 | 0.055 | 0.002 | 0.444 | 0.142 | 0.809 |
| boss-warden-summon | 0.918 | 0.077 | 0.006 | 0.506 | 0.091 | 0.850 |
| boss-warden-enrage | 0.910 | 0.083 | 0.007 | 0.536 | 0.172 | 0.763 |
| boss-warden-idle-outlands | 0.957 | 0.043 | 0.000 | 0.384 | 0.172 | 0.802 |
| boss-warden-idle-desert | 0.829 | 0.081 | 0.090 | 0.719 | 0.159 | 0.798 |
| boss-warden-idle-winter | 0.747 | 0.181 | 0.072 | 0.892 | 0.027 | 0.948 |

Independent per-pixel audit over opaque pixels (warm = hue 15-55 deg at sat > 0.20 among mid-tones):

| sheet | warmFrac | coolFrac | edgeNearBlack | threat-red px | violet px |
| --- | --- | --- | --- | --- | --- |
| idle | 0.005 | 0.828 | 0.713 | 39 | 269 |
| sweep | 0.111 | 0.825 | 0.624 | 743 | 3 |
| summon | 0.001 | 0.895 | 0.560 | 20 | 308 |
| enrage | 0.000 | 0.833 | 0.634 | 1786 | 0 |
| death | 0.001 | 0.945 | 0.677 | 23 | 21 |
| outlands | 0.078 | 0.817 | 0.586 | 35 | 378 |
| desert | 0.026 | 0.888 | 0.644 | 29 | 257 |
| winter | 0.000 | 0.928 | 0.701 | 22 | 0 |

No warm/brown drift anywhere in the group (max 0.111, and that is the sweep's torch-amber telegraph doing
its job). For calibration the off-style `paleknight` sheet measured 0.371 and canonical `hero-idle` 0.448
— warmFrac is a within-subject metric and this subject is black iron, so the group sits cold by design.

## Honest weaknesses

- **`boss-warden-idle-outlands` is the weakest sheet on value**: light tier 0.0%, the only sheet in the
  group with no light tier at all, because rain-black gibbet timber and dirty rope offer nothing bright.
  It passes the reference-pair test; not rerolled, per the standing instruction against chasing the light
  tier on accepted sheets.
- **`boss-warden-idle-winter` reports `temperature-single`** (95% one side of neutral) and violet px 0 —
  the blue-white ice glaze absorbs the violet seam flare the brief asks for in frame 3. The head-tip
  still reads; the seam colour does not. Deliberate trade: the ice is what makes the skin legible.
- **Castle idle and outlands still fail `value-tier-absent:light`.** Canonical `husk-move` fails the same
  check harder (0.4% light), so this is a set-wide characteristic rather than a warden defect. The two
  skins generated *after* the BROAD-highlight value clause was adopted (desert 9.0% light, winter 7.2%)
  both PASS it — measurable evidence the clause works.

## Zone-skin consistency verdict

**PASS — the three skins read as the same character wearing the zone.** Each was generated with the
accepted castle `boss-warden-idle` raw as Image 1, and each reproduces the base's four idle poses (slack
chains, chest-heave, head-tip with seam flare, settle), the same square mass, the same upright gate-bar
with its grating block at boot level, and the same hanging chains.

Measured occupancy distance at renderScale 48 across all six pairs among the four idles: **0.007-0.032**.
`art_review` reports these as `silhouette-collision` failures, which is the **correct and desired** result
here — that check exists to catch *different* subjects reading alike ("six props come back as six
variations of one mass"), so for four skins of one character a near-identical silhouette is the
requirement, not a defect. Read as a same-character test it is an unambiguous pass; the real variety gate
for this group is the cross-character call above, which passed.

Skin swaps land as specified and are the only changes: outlands = gibbet-timber shoulder yokes with
hanging rope loops + rope-wrapped crown; desert = bleached-bone pauldrons + cracked sun-disc crown with
grit in the rivet lines; winter = ice-sheathed shoulders with icicle fringe + icicle crown + frost-rimed
chains. Desert needed one regeneration because its first take applied the swap to only 3 of 4 frames
(frame 1 kept plain iron shoulders), which would have popped on loop.

## Notes for the ArtDirector / integrator

- `duration:0` did **not** apply to this group; all 8 markers carry positive durations (100-160).
- `writeScaleProfile: true` did hit this group. Fixed with **no** regeneration by reprocessing the
  accepted raw through `process-sprite.ts` with `--write-scale-profile <path>`; the pixel params passed
  are the `pixel-art-body` defaults, so the sheet stayed byte-equivalent.
- The chroma key gutting dusk-violet hit this group hardest, since violet is the Warden's signature hue.
  Recovered by reprocessing at `--threshold 150 --edge-threshold 150`: idle 75 -> 269 violet px,
  summon 1 -> 308. Both thresholds are also accepted **inside the export marker**, so every later sheet
  had it baked in and needed no recovery pass.
- `componentMode: "all"` + `minComponentArea: 12` on `boss-warden-death` preserved the detached debris:
  connected components per frame are `[1,7,6,1,1,2,1,1]`, where a forced `largest` collapses every frame
  to 1. The snapping chain links in frames 2-3 are that debris.
- New xai signature found here: an instruction for a "telegraph arc" makes xai draw a literal **arrow
  with an arrowhead** — UI annotation instead of light. Re-briefing as "a glowing SMEAR of light, not an
  arrow, no arrowhead, no diagram" fixed it.
- Mid-chain provider identity risk, observed: the first xai sweep silently dropped the crenellated crown,
  the gate-grating block and the violet seams and turned the iron navy while still producing plausible QC.
  Naming the 2-3 signature features explicitly in the prompt fixed it. Caught by eye, not by any metric.
- Anchor guides used (built from the accepted idle frame, deliberately kept out of `public/`):
  `art/guides/warden-anchor-2x2.png`, `-2x3.png`, `-2x4.png`. The 2x3 guide had to be rebuilt at the real
  cell aspect (341x512, not square) before it helped.
- Probe dir `art/guides/_probe-styleprofile/` is a throwaway from isolating the prompt-length ceiling and
  can be deleted.
