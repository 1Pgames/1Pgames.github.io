# Report — `enemies-light` (half B: thornhound, shroudmoth, pyreling, ashwraith)

Owner: GenEnemiesLightB. 9/9 assets exported, all with `sprite-sheet.png` present and
`qc.passed = true`. Half A (husk, wretch, ratking, bonecaster) is reported in
`enemies-light-A.md`; this file exists because `_common.md` names one shared report path for a
group that two agents own.

Output root: `games/2026-08-29-duskhaul/public/assets/generated/enemies-light/`

## Per asset

Provider read from `sprite-metadata.json.source.file` (`.jpg` = xai/grok-imagine,
`.webp` = openai-codex/gpt-5.5), never from a `raw-source.*` glob.

| id | frames | provider | palette meanDistance | cv / anchorYStd | componentMode | gen attempts | posture notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| enemy-thornhound-move | 4 | xai | 22.73 | 0.0078 / 0.0053 | largest | 4 | — |
| enemy-thornhound-attack | 4 | xai | 22.65 | 0.0050 / 0.0630 | largest | 3 | anchor-y-std 0.0630, profile-drift 0.2942, height-drift 0.2981 |
| enemy-thornhound-death | 4 | xai | 22.24 | 0.1433 / 0.0518 | all | 3 | cv 0.1433, anchor-y-std 0.0518 |
| enemy-shroudmoth-move | 4 | codex | 20.35 | 0.2306 / 0.0816 | largest | 3 | — |
| enemy-shroudmoth-death | 4 | xai | 26.18 | 0.2577 / 0.0620 | all | 4 | cv 0.2577, anchor-y-std 0.0620 |
| enemy-pyreling-move | 4 | codex | 27.50 | 0.1505 / 0.0482 | largest | 2 | — |
| enemy-pyreling-death | 4 | xai | 32.08 | 0.1155 / 0.0008 | all | 3 | cv 0.1155 |
| enemy-ashwraith-move | 4 | xai | 23.50 | 0.0016 / 0.0000 | largest | 4 | — |
| enemy-ashwraith-death | 4 | xai | 19.97 | 0.1294 / 0.0547 | all | 3 | cv 0.1294, anchor-y-std 0.0547 |

All nine pass `sprite_check_palette` against `art/style.json` (`maxPaletteDistance` 48; every
sheet is also under the report threshold of 36). Every source grid cell is aspect 1.0 —
512x512 for the seven xai sheets, 627x627 for the two codex ones — so the two mixed chains
(shroudmoth and pyreling: codex base, xai death) bind their scale profiles without a geometry
mismatch. Scale profiles written: `thornhound-scale.json`, `shroudmoth-scale.json`,
`pyreling-scale.json`, `ashwraith-scale.json`.

## Silhouette separation — the group gate

`art_review` SET call, `renderScale` 48.

Across my four `-move` sheets: **silhouettes.passed = true, zero findings**, all 6 pairs
between 0.068 and 0.118.

| pair | distance |
| --- | --- |
| thornhound vs shroudmoth | 0.068 |
| shroudmoth vs pyreling | 0.076 |
| pyreling vs ashwraith | 0.086 |
| thornhound vs ashwraith | 0.093 |
| shroudmoth vs ashwraith | 0.095 |
| thornhound vs pyreling | 0.118 |

Across the full 8-creature roster (both halves), which is the gate the brief actually
specifies: **silhouettes.passed = true, zero findings**, all 28 pairs between 0.068 and 0.218.
Tightest cross-owner pair is bonecaster vs ashwraith at 0.073 — the two tall verticals — and it
still clears. Widest is husk vs pyreling at 0.218 (broad slumped slab against small teardrop).

Verdict: the four masses are doing their job. thornhound is the only ground quadruped
(2.5:1 horizontal, four legs with clear gaps, sawtooth thorn ridge breaking the top edge);
shroudmoth is a wide four-wing X with a soft scalloped outline and no legs; pyreling is the
smallest thing on the roster, a compact teardrop on a black wax stub; ashwraith is a vertical
tatter-column with no legs and a shredded outline. Colour code holds: dried-blood red pinprick
eyes on all four, torch-amber confined to pyreling's flame and ashwraith's ember flecks, no
green and no teal anywhere.

## Group art_review figures

Busiest sheet — `enemy-shroudmoth-death` (34 and 35 detached components in frames 2 and 3):
dark 0.478 / mid 0.326 / light 0.196, lightness spread 0.815, warmShare 0.430,
13789 colours, **zero findings**.

Per-asset value structure on the four `-move` sheets:

| asset | dark | mid | light | spread | warm | cool | findings |
| --- | --- | --- | --- | --- | --- | --- | --- |
| thornhound-move | 0.750 | 0.203 | 0.047 | 0.738 | 0.365 | 0.505 | warn value-plan-miss:dark |
| shroudmoth-move | 0.601 | 0.297 | 0.102 | 0.795 | 0.414 | 0.358 | none |
| pyreling-move | 0.504 | 0.169 | 0.327 | 0.989 | 0.757 | 0.121 | warn miss:mid, warn miss:light (over) |
| ashwraith-move | 0.972 | 0.013 | 0.015 | 0.561 | 0.133 | 0.823 | **fail value-tier-absent:light** |

The SET call therefore reports `passed: false`, and the sole cause is
`ashwraith-move: value-tier-absent:light` (1.5% lights against a planned 8%). Left as-is
deliberately, per the standing instruction not to reroll an accepted sheet to chase the light
tier while the ruling on `plan.valuePlan` is pending — the canonical `enemy-husk-move`
reference sheet fails the same check harder (0.4% lights), and a cinder ghost that is 97% dark
is the intended read. Recorded here rather than hidden. `pyreling-move` misses the same check
from the opposite side (33% lights) because it is the group's only light source, which is what
the brief asks for.

## qcExceptions

**None declared.** Everything that would have needed one was cleared mechanically instead:

- Four sheets carry `qc.postureChange[]` notes rather than exceptions — thornhound-attack,
  thornhound-death, shroudmoth-death, ashwraith-death. Reached by reprocessing the *accepted*
  raw through `process-sprite.ts --posture-change`, which routes only the four scale gates into
  notes and leaves contamination, edge-touch and paste-clamp fatal. Verified by reading
  `qc.postureChange[]` back out of each `sprite-metadata.json` — the flag is honoured, not
  silently dropped, in this checkout
  (`~/homework/oh-my-pi-sprite-forge/skills/sprite-forge/scripts/process-sprite.ts`, switch
  parsed at :273, applied at :854-858). Zero regenerations spent, and the numbers stay visible
  instead of being switched off. A collapse animation cannot satisfy bbox-height invariance by
  construction.
- `enemy-thornhound-move` lost its scale profile to the `writeScaleProfile: true` boolean
  defect. Recovered by reprocessing the accepted raw with the string path: `sprite-sheet.png`
  byte-identical (md5 `3af9d9252ddb3798f6f5304e31463b4b` before and after) and
  `thornhound-scale.json` written from the accepted export's own numbers. No regeneration.
- All four `-death` sheets were re-exported unbound at `componentMode: all` after the first
  pass silently came back `largest`. Connected-component counts per frame prove the debris
  survives: shroudmoth-death 1/34/35/1, ashwraith-death 3/2/11/8, pyreling-death 3/8/7/5,
  thornhound-death 4/1/1/2 (its briar tangle is genuinely one connected mass).

## Three sheets I flag rather than defend silently

- `enemy-pyreling-move` — meanDistance 27.50, 75.7% warm, the least grimy sheet in the group.
  A candle flame legitimately owns the torch-amber, but this is the one asset a critic would
  call clean or cute next to husk-move.
- `enemy-ashwraith-move` — briefed at 2.5:1 tall-and-narrow, rendered nearer 1.5:1, so it reads
  as a hooded tatter-ghost rather than a smoke column. Mechanically the best sheet I own
  (cv 0.0016, anchorYStd 0.0000) and still clearly separable from bonecaster at 0.073, but it
  is not quite the silhouette the brief drew.
- `enemy-shroudmoth-death` — the disintegration peaks in frames 2-3 and frame 4 is a shrunken
  tattered husk, so the burst is not monotonic. Two attempts went into the progression; the
  earlier take was identity-consistent but did not read as a death at all, and this one does.
  Frame 1's thorax carries a bluish cast the other three frames do not.

## Brief / infrastructure notes for the central fix list

- None of my 9 markers carried `"duration": 0`, so that fix was a no-op for this half.
- `"writeScaleProfile": true` did bite `enemy-thornhound-move`; the string-path form works.
- `sprite_check_palette` takes `profile`, not `styleProfile` — used correctly throughout.
- The brief's marker template gates every sibling with `maxProfileScaleDrift: 0.08`. The three
  `-death` sheets are exported unbound from `scaleProfile` + `maxProfileScaleDrift` per the
  build-wide categorical decision, keeping intra-sheet `maxBodyScaleCv` 0.08 and
  `maxAnchorYStd` 0.05. `enemy-thornhound-attack` stays bound and reports its drift as a
  posture note.
- `enemy-ashwraith-move` held both `raw-source.jpg` and `raw-source.webp`; `source.file` named
  the `.jpg`, and the stale `.webp` was deleted so the provider census is unambiguous.
- Prompt-length ceiling confirmed independently on this group: identical prompts at ~3400 chars
  failed with `failed for all credentialed providers: xai` and at ~2250 chars succeeded first
  try, with the marker and `styleProfile` unchanged.
