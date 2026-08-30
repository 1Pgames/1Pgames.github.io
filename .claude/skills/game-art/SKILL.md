---
name: game-art
description: >-
  Produces the complete art set for a generated game — animated characters,
  enemies, bosses, pickups, FX, UI kit (panels, buttons, bars, icons) and
  backgrounds — in one coherent style, using native generate_image through the
  sprite-forge pipeline, then wires the assets into a Phaser 4 project (texture
  keys, spritesheets, animation configs, nine-slice UI). Defines the style
  profile first so a whole asset run looks like one game, parallelises generation
  across asset groups, and gates every asset with background preflight, palette
  distance and art review — then gates the SET against itself with a manifest lint
  before fan-out and a backdrop-vs-actor figure/ground measurement before any group
  is accepted. Use for "generate graphics for the game", "make the
  art", "chibi/pixel/anime style assets", "animate the hero", "UI kit", or when a
  game looks like flat placeholder shapes.
---

# Game art (style lock → parallel generation → engine wiring)

Art is the difference between a generated game and a screenshot of coloured
rectangles. This skill turns a game project into a full asset set without
hand-drawing anything and without the set drifting into 20 unrelated styles.

Fixed pipeline decisions:

| Decision | Value |
| --- | --- |
| Generator | native `generate_image` via `skill://sprite-forge` markers only |
| Cleanup/export | sprite-forge deterministic processing (magenta key, slicing, atlas) |
| Style contract | one `sprite-forge.style.v1` profile per project, in `art/style.json` |
| Canvas | `1024x1024`, `aspect_ratio: "1:1"` for every asset |
| Grids | square cells only come from `NxN` (`1x1`, `2x2`, `3x3`, `4x4`); `2x4` gives 2:1-tall cells and cannot share a scale profile with them |
| Body profile | `hd-body` (feet anchor, largest component, strict QC) |
| FX/UI profile | `hd-fx` (centred fit, all components, strict QC) |
| Output root | `public/assets/generated/<group>/<asset-id>/` |
| Pre-fan-out gate | `skill://game-art/references/manifest-lint.py` exits 0 — style lock rewritten, anchors locked, one owner per group, every bound scale profile actually written |
| Set-level gate | `skill://game-art/references/figure-ground.py` clean per scene — figure/ground clash ≤ 15%, busyRatio ≤ 1.20x, C1 foreground ownership, committed read direction |
| Exception record | `art/manifest.json.qcExceptions[]` only; a report line is not a record |
| Retry budget | 2 regenerations per asset per symptom, counted in the manifest's `attempts`; the exception is WRITTEN before a third attempt |

## Non-negotiable rules

0. **Step 0 — tool precondition check, before anything else.** Confirm you hold
   `generate_image` (and, if the manifest slice needs them, `sprite_preflight_background`,
   `sprite_check_palette`, `art_review`, `sprite_anchor_guide`). Prove it by making
   ONE cheap probe call — a 512x512 throwaway with no export marker — and report the
   probe result in the first line of your report. If a required tool is absent,
   **STOP and report `blocked: required tool missing — <tool>`**. That is a named,
   reportable failure and the correct deliverable; the orchestrator respawns you with
   the tool. Working around it is PROHIBITED: shelling out to a nested `omp`/
   `--auto-approve` session, calling a provider CLI directly, or hand-writing pixels
   are all defects, not resourcefulness. Measured: one generation agent shipped a
   whole group through nested `omp -p --auto-approve` sessions with 0
   `generate_image` calls, which is unauditable, unreproducible and invisible to
   every gate in this skill.
1. **Style profile before any generation, and the scaffold default is a landmine.**
   Write `art/style.json` from the PRD and pass `styleProfile` in every export
   marker. The scaffold ships `template/art/style.json` — a working
   **`vibrant-chibi`** profile carrying `scaffold: true`, `scaffoldNote`, and the
   name `scaffold-placeholder-vibrant-chibi`. It does not fail loudly; it succeeds
   at producing a coherent asset set for the WRONG GAME. **If the style lock has not
   been rewritten, generation MUST NOT START.** The mechanical gate:
   `references/manifest-lint.py` errors `style-lock-not-rewritten`
   while any scaffold marker key survives, and `release-check.mjs` fails the release
   for the same reason. Measured: the art-director died mid-rewrite on the Duskhaul
   run; ten minutes earlier the run would have generated 103 chibi assets into a
   grimdark game and every per-asset gate would have passed them.
   The profile's `references` array names the LOCKED VISION ANCHORS (Step 1b).
   **Scope split, measured — do not restore the blanket version.** Anchors are
   mandatory on ACTOR-class calls (characters, enemies, bosses, props, icons,
   cover): a text-only actor call after the lock is a defect. FULL-BLEED subjects
   (seamless tiles, floors, backdrops, parallax layers) are the exception: xai
   redraws the anchor subject INTO the tile — a floor request came back as a full
   reaper portrait on magenta, and the brief's "ground and nothing else" line did not
   clear it. For those, either go text-only or pass an ACCEPTED SIBLING TILE as
   explicit Image 1, which demotes the vision anchor to Image 2 (that cleared it
   first try), then visually confirm no anchor subject landed in the tile.
2. **Never draw art with code.** No Canvas, SVG, CSS, procedural shapes or
   ASCII. Placeholder procedural textures stay only for particles and debug.
3. **One `generate_image` call per coherent asset**, one `OMP_SPRITE_EXPORT`
   marker per call. Never pack unrelated actions as rows of one sheet.
4. **Cell aspect is measured, not requested.** On a square canvas only `NxN`
   grids yield square cells: a `2x4` sheet has 256x512 cells and the processor
   hard-rejects locking it to a `2x2` scale profile. Keep frame counts on `NxN`
   grids when a character's actions must share one scale profile; when an
   8-frame action needs `2x4`, gate it with `maxBodyScaleCv`/`maxAnchorYStd` and
   an anchor guide instead. Run `sprite_preflight_background` when an export
   fails and regenerate — never rescale a mismatched sheet, never relax QC.
5. **Silhouette brief per asset.** Every enemy/prop states its mass and outline
   difference from its siblings. Sets generated without it come back as
   variations of one blob, visible only at `renderScale`.
6. **Colour coding is gameplay.** Threat / player / reward hues are fixed in the
   style profile's `temperature` and `saturationHierarchy` and must not be
   negotiated per asset.
7. **Split UI by kind.** Chrome — panels, buttons, bar housings, frames — is
   *geometry*: draw it with primitives (`ui/primitives.ts`) so it adapts to any
   size and re-skins with `PALETTE`. Generate art only for UI that is genuinely
   *drawing*: icon glyphs, the title emblem, badges, portraits. Stretched
   nine-sliced PNG chrome is banned: it carries transparent margins, breaks at
   sizes it was not drawn for, and locks the palette into the pixels.
8. **Gate every asset, then gate the SET.** Per asset: background preflight
   (automatic in export), `sprite_check_palette` against the profile, `art_review`
   per group plus one multi-asset set call for silhouette variety. **Then the two
   set-level gates, which are the only ones that can see a defect living BETWEEN
   two assets:**
   - `references/manifest-lint.py` — BEFORE fan-out (rule 11).
   - `references/figure-ground.py` — before a group is accepted
     (rule 9).
   Never sign off a group on per-asset numbers alone. Measured: 103 of 103 assets
   passed individually, the 103-asset audit returned an EMPTY reject list and the
   verdict "Yes. I would ship this set." — and the desert floor was at 27.45%
   figure/ground clash and 2.39x the hero-sprite readability ceiling. Every gate
   compared ONE asset to a PROFILE; nothing compared two assets to each other.
9. **Figure/ground is a gate, not taste.** Every backdrop, floor/terrain tile and
   parallax layer is measured against the ACTUAL actor sprites that will be drawn
   on it, in the scene where that pairing occurs, through the runtime grade tint:

   ```bash
   REPO="$(git rev-parse --show-toplevel)"        # cwd during an art wave is games/<slug>/
   python3 "$REPO/.claude/skills/game-art/references/figure-ground.py" \
     --scene <zone> --actors <that scene's COMPLETE cast sheets> \
     --fields <that scene's floor/backdrop sheets> --grade <runtime tint hex> \
     --manifest art/manifest.json
   ```

   Thresholds and their calibration are in the script's header: clash > 15% FAILS,
   8-15% ships only on a written `qcExceptions[]` entry, `busyRatio` > 1.20x FAILS,
   plus C1 foreground ownership and a committed read direction. `--actors` MUST be
   the complete cast for that scene — with 2 of the desert's 4 actor sheets the
   accepted floor flips from 12.85% (pass) to 20.04% (fail), so a partial cast is a
   different criterion, not a safer one. Arena borders and walls are NOT fields;
   no actor stands on them.
10. **A criterion states its population, and is validated against the ACCEPTED set
   before it may reject anything.** Run your new rule over the assets already
   accepted. **If the canon fails your rule, the rule is wrong.** Provenance, so
   nobody "helpfully" restores the wrong versions:
   - RETIRED after measuring the canon: *"no visible pixel grid"* and *"missing 1px
     outline"* — the accepted set fails both.
   - RETIRED as a fidelity proxy: `sprite_check_palette`'s **`meanDistance` is
     anti-correlated with style fidelity** — an off-style sheet measured 20.58 while
     a correct cold-blue snow tile measured 44.48, because the profile's 18-colour
     list contained no cold blue. Read `meanDistance` as "distance from the palette
     list", never as "quality"; a high figure on a zone whose identity needs a hue
     the list lacks is a fact about the LIST.
   - Five audit heuristics (sheet-only output test, `minAlpha`, glob provenance,
     glow-area-share, provider census) were wrong on **POPULATION, not metric**, and
     every correction came from re-measuring finished work rather than reviewing the
     rule. So: state the scope in the rule text itself, and never sweep a
     full-bleed-only or sprite-only check tree-wide.
   - `art_review` known false positives, scope them when you quote them:
     `value-tier-absent:light` rejects the canon at 0.4% lights (floor 3.75%);
     silhouette-collision fires on SAME-character actions (0.034, 0.041) while
     cross-character pairs pass (0.088+); silhouette distance reads 0.000 on opaque
     full-bleed tiles because their occupancy is identically 1.0. A full-bleed asset
     is NOT judged on silhouette metrics.
11. **Manifest lint before fan-out.** `references/manifest-lint.py`
    must exit 0 before Step 3 spawns a single generation agent. A manifest defect is
    multiplied by the fan-out width: one `writeScaleProfile` mistake was
    independently rediscovered by 3 of 12 agents, each burning a full investigation.
    The lint is also the machine check for rule 1's style lock.
12. **Every exception is WRITTEN to the manifest, not reported.** `qcExceptions[]`
    in `art/manifest.json` is the only record that counts. Measured: 26 asset-level
    exceptions existed only in prose reports while the manifest held 6, because the
    batch instruction said report-don't-write and nobody reconciled. Both
    `manifest-lint.py` and `figure-ground.py --manifest` fail an unrecorded waiver.
13. **Parallelise by group, integrate serially.** Generation agents own disjoint
    output directories and touch no source file; one integrator wires everything
    into the engine afterwards. **One group = one owner = one output directory = one
    report path.** A group that needs two agents is SPLIT into two groups;
    `manifest-lint.py` errors `two-owners-one-group`, because two agents writing one
    report path lose half of it.
14. **Inspect the pixels.** Never claim quality from metadata. Look at the
    exported sheet/GIF, and at the game running with the assets in place.

## Workflow

### Step 1 — Style profile (`art/style.json`), REWRITTEN from the PRD

The scaffold hands you `template/art/style.json`: a real, working **vibrant-chibi**
profile carrying `"scaffold": true`, a `"scaffoldNote"`, and the name
`scaffold-placeholder-vibrant-chibi`. It is a landmine, not a starting point — it
produces a perfectly coherent asset set for a game that is not yours, and every
per-asset gate passes it. **Rewrite it from the PRD before Step 1b, and do not start
generation until the rewrite lands.**

Rewrite means all of this:

- `artStyle`: proportions, shading steps, outline, finish, camera — as sentences,
  not adjectives. Byte-identical scaffold prose fails the release gate.
- `name`: a new kebab id for THIS game (`duskhaul-grit`, not
  `scaffold-placeholder-*`).
- **DELETE the `scaffold` and `scaffoldNote` keys.** They are the machine markers:
  `manifest-lint.py` errors `style-lock-not-rewritten` and
  `scripts/release-check.mjs` fails the release while either survives.
- `palette`: 12-18 hex values, including the project's UI palette so art and
  interface agree. **The list is the gate's yardstick**: `sprite_check_palette`
  measures distance FROM THIS LIST, so a zone whose identity needs a hue the list
  lacks cannot score well — a correct cold-blue snow tile measured 44.48 against a
  list with no cold blue, while an off-style sheet measured 20.58. Put every zone's
  identity hue in the list, or expect and pre-authorise the exception.
- `camera`, `lighting`, `outline`: one sentence each, they are prompt-merged.
- `plan.valuePlan`: dark/mid/light shares (a set with no lights reads flat).
- `plan.temperature` + `plan.saturationHierarchy`: the gameplay colour code.
- `plan.focal`: what the eye lands on, reads next, rests on.
- `plan.materials`: material → substance and surface behaviour, never a colour.
- `plan.renderScale`: the pixel size the asset is actually drawn at in game. This is
  also the `--render-scale` the figure/ground gate measures busyness at.
- `maxPaletteDistance`: 48-56 for stylised sets.
- `references`: filled by Step 1b, as **repo-root-relative** paths
  (`games/<slug>/art/refs/vision-1.png`); a game-relative path only warns but is
  ambiguous to every consumer.

`references/style-profiles.md` holds ready-made profiles (vibrant chibi, gritty
pixel, flat vector, painterly, neon retro) to adapt — adapt one, never ship one
unedited.

### Step 1b — Art vision board (choose the vision, lock the anchors)

Text profiles hold a set together; REFERENCE IMAGES hold it together better.
The art-director chooses one visual vision and every asset is generated
UNDER it:

1. **Candidates.** Generate 2-3 vision candidates — one full key-art frame
   each, SAME subject brief (the game's hero moment from PRD §1/§11),
   deliberately different art directions (pick from
   `references/style-profiles.md` + the §1b dossier's genre visual bar).
   One `generate_image` call per candidate, no export marker (these are
   reference material, not assets).
2. **Choose.** The art-director picks ONE against explicit criteria: the
   dossier's reference-title bar, readability at `plan.renderScale`,
   palette compatibility with the UI, and one distinctive trait that is not
   a clone of the reference games. Record the choice AND the rejections
   with one-line reasons in the report; losing candidates are deleted.
3. **Lock, with a hard cap of 2.** Save the winner (and at most ONE detail crop —
   e.g. a face/prop close-up for material rendering) to `art/refs/vision-*.png`, as
   **repo-root-relative** paths in `art/style.json.references`; align the profile's
   prose fields (artStyle/palette/lighting) to what the winner actually shows — the
   IMAGE is now the truth, the prose is its description. **Never more than 2
   anchors.** The middleware appends every listed reference to every call's `input`
   with no cap and no dedupe, and xai's total image cap is 3, so a third anchor
   leaves no room for an anchor guide and pushes guide-bearing calls into
   `failed for all credentialed providers: xai`. Duskhaul cut its anchor set from 2
   to 1 mid-run for exactly this reason and inherited a temporal coherence seam —
   sheets generated before the cut carry a material anchor that later ones do not.
   Decide the final count at lock time; changing it mid-run splits your set.
4. **Condition every ACTOR call.** From this point every ACTOR-class generation
   (characters, enemies, bosses, props, icons, cover) passes the anchors via the
   native `input` array with the fixing clause (exact wording in
   `references/prompt-contract.md`): Image 1 fixes rendering style, palette,
   lighting and finish; the prompt describes only the NEW subject. Characters with
   multiple actions add their own accepted base frame as the next input (the
   existing `sprite_anchor_guide` flow) so identity AND style are both pinned.
   **FULL-BLEED subjects are the measured exception** — see rule 1: a tile/floor/
   backdrop call either goes text-only or passes an ACCEPTED SIBLING TILE as
   explicit Image 1 so the vision anchor is demoted to Image 2, then gets a visual
   check that no anchor subject was redrawn into the tile.
5. **Gates unchanged.** `sprite_check_palette` and `art_review` still run
   on every export — anchors are how the set PASSES them coherently, not a
   replacement for them.

### Step 1c — Interface direction (UI palette + HUD plan; art-director owns)

The interface is part of the vision. Immediately after the vision lock —
BEFORE sheet generation fans out — the art-director authors the UI
direction; ui-engineer implements it verbatim and never re-derives it:

1. **UI palette from the anchors.** Sample the locked vision image(s) and
   derive every `PALETTE`/`CSS` role: bg tones (deep/top/bottom), ink +
   inkSoft, primary/secondary/accent, good/bad. Each ink/text colour is
   CHECKED with real contrast math against `bgTop` (≥4.5:1) and each
   role's hex is written down with its source ("sampled from the cauldron
   glow", "anchor shadow tone"). Gameplay identity colours (piece kinds,
   teams) stay art-locked literals in the slice tuning, never palette
   references.
2. **HUD plan (PRD §14 revision).** Author the pixel plan on the game's
   real frame: every HUD element with coordinates and sizes inside SAFE
   and clear of the shell corner (315x75), visual hierarchy (what reads
   first at arm's length), 88px tap targets, and the reserved bands for
   coach cards / banners / floaters so juice never collides with chrome.
   **Carry the PRD's band-ownership table forward** (band → y-range → owner →
   arbitration move) rather than replacing it, keep the ≤7-widget ceiling and the
   one-scrim-or-panel-per-overlay decision, and RE-VALIDATE every rect you move
   against the real HUD — a screenshot or a CDP display-list dump, never an
   asserted coordinate. This step revises the plan; it does not get to drop its
   constraints.
3. **Chrome spec.** Panel fill/stroke/alpha/radius, button fills per state,
   text armour (the stroke + shadow the game's `TEXT` presets in
   `src/config.ts` carry, derived from the darkest anchor tone; labels that
   sit on their own pill/panel/disc strip it), scrim strength for
   text-over-art bands.
4. **Deliverable.** The PRD's §11 palette table and §14 HUD plan updated to
   the authored values (they were the game-designer's DRAFT until now) —
   this is the contract ui-engineer codes against; disagreements route
   back here, not into ad-hoc code values.

### Step 1d — Audio identity (music + sfx brief; art-director owns)

Sound is part of the same identity, and it is briefed from the SAME locked
profile — right after the style/vision/UI lock, before generation fans out, so
the audio brief cannot drift from what the art turned out to be. A game with
no audio files is still finished (`core/audio.ts` synthesises every voice and
`core/music.ts` the score); this step is how a game gets a VOICE of its own.

1. **Brief from `art/style.json`.** Translate the locked profile into audio
   terms and write the brief down: mood (from `artStyle` + `lighting`), tempo
   (from the PRD's session pacing — menu calm, run pressure), instrumentation
   and timbre (from `plan.materials` and `plan.temperature`: chunky wooden
   percussion for a rustic set, glassy synths for neon retro). One paragraph
   per track, one line per sfx.
2. **Music (`generate_music`).** Three stems at most, all seamless loops,
   30-60s, mono, ~96 kbps: `menu` (calm, under the menu mood), `game-low` and
   `game-high` (same key, same tempo, same bar length — `core/music.ts`
   crossfades them on `setMusicIntensity` around 0.55, so they MUST be
   interchangeable at any bar). Shipping only `game-low` is fine: its level
   then tracks intensity.
3. **SFX (`generate_sfx`).** One short file per event name in `SfxName`
   (`core/audio.ts`): `ui`, `tap`, `pickup`, `combo`, `jump`, `hit`, `die`,
   `levelup`, `whoosh`. Generate only the ones the genre actually fires; every
   name left unregistered keeps its synth voice, so a partial set is a valid
   deliverable. Keep them dry and short (<0.5s for taps/hits) — `juice.ts`
   layers them, the file must not carry its own tail or reverb.
4. **Files + registry.** Write everything under `public/assets/audio/`
   (`music/`, `sfx/`), then register the paths in `src/data/audio.ts` —
   relative to `public/`, one file per entry. That registry is the ONLY switch:
   a registered name plays its file, an unregistered one synthesises.
   Registration is fx-artist's integration step (it owns `src/data/audio.ts`),
   handed over with the file list; the art-director does not edit engine code.
5. **Budget <= 6 MB total.** `node scripts/release-check.mjs <slug>` reports
   the tree as the `audio` finding and WARNS above 6 MB. Music loops are the
   weight — re-encode (shorter loop, mono, lower bitrate) rather than dropping
   the sfx set.
6. **No audio provider, offline, or a failed generation?** Ship no files and
   leave the registry empty: the synth score and voices are the designed
   fallback, not a defect. FLAG it in the Step 7 report ("audio: synth only,
   reason") so the integrator knows the silence is intentional.

### Step 2 — Asset manifest (`art/manifest.json`), then LINT IT

Enumerate every asset before generating: id, group, **exactly one owner agent**,
kind (`body`/`fx`/`ui`/`bg`), grid, action description, cell size, duration, and any
`writeScaleProfile`/`scaleProfile` link. Volume targets and grid choices per asset
class are in `references/asset-plan.md`; the field-by-field schema, including the
three bookkeeping fields below, is in that file's "Manifest schema" section.

Three fields carry the mechanical budgets:

- `writeScaleProfile: true` on each character's base sheet, plus `profileName`. Pass
  the BOOLEAN — the tool derives the canonical `<profileName>-scale.json` next to
  the sheet. A hand-written path is the typo class that 3 of 12 agents each
  rediscovered independently.
- `attempts`: an integer the generation agent INCREMENTS in the manifest after each
  regeneration of that asset. It is the regeneration counter, not a note.
- `qcExceptions[]` at the top level: `{ "id", "reason" }`, where `id` may be an
  fnmatch pattern and `reason` is a one-line VISUAL justification. This array is the
  only record of an accepted defect that counts.

**Then run the lint, and do not fan out until it exits 0:**

```bash
# Run from the GAME project root (games/<slug>/); the manifest path defaults to
# art/manifest.json.
REPO="$(git rev-parse --show-toplevel)"
python3 "$REPO/.claude/skills/game-art/references/manifest-lint.py"
```

**Resolve the skill path with `git rev-parse`, and do not "simplify" it to
`$(realpath skill://game-art)`.** Measured: `realpath` does not understand
`skill://` at all — the form only appears to work because omp's `bash` tool rewrites
internal URIs before the shell sees them. In any plain shell (a raw child process, a
script, a subagent shelling out) `realpath skill://game-art` fails with
`No such file or directory`, the substitution expands to EMPTY, and the command
becomes `python3 "/references/manifest-lint.py"`. That exits 2 under the contract
below, so it fails safe rather than falsely passing — but a pre-fan-out gate that
silently never runs is the whole ballgame. `git rev-parse --show-toplevel` is
verified in both environments. (A skill in ANOTHER repo — `skill://sprite-forge`
lives in the sprite-forge tool repo, not under `.claude/skills/` — has no
`$REPO`-relative path and must be located by the harness, which is a real
constraint, not a counter-example.)

It is the cheapest gate in the pipeline and it catches, before twelve agents each
pay for it: an un-rewritten style lock, unlocked or missing vision anchors, a
two-owner group, duplicate ids/aliases, a `scaleProfile` bound to a file nobody
writes, a `writeScaleProfile` path that disagrees with its `profileName`, a
`strict:false` or `attempts >= 3` asset with no written exception, a negative
`duration`, and a frame count that contradicts its own action text. Warnings are
allowed but must be answered in the Step 7 report.

**Exit codes are load-bearing in both gate scripts.** `0` clean, `1` real findings
(always printed above the exit), `2` bad invocation or unreadable input — a typo'd
flag, a missing file, a malformed manifest. A `2` means fix your command; only a `1`
means fix the art or the manifest. Never treat `2` as a finding.

### Step 2b — World geometry (`skill://map-forge`)

When the genre needs authored space instead of a seeded scatter — tower
defense paths, rooms, tactics grids, or a parallax stage — run
`skill://map-forge` before generation, not after: the map bundle's props and
terrain drive part of the manifest.

- Output lands under `public/assets/generated/map/`, alongside the entity
  groups, so one `gen-art-registry.mjs` pass sees everything.
- Map bundle → `ArenaLayout` (`src/systems/arena.ts`) field mapping: bundle
  `width`/`height` → `ArenaLayout.width`/`height`; the floor/terrain layer's
  texture key → `floorKey`; placed prop instances → `ArenaLayout.props[]`
  (`id` matches a `PropDef.id` from `data/props.ts`, unmatched ids fall back to
  a tinted square); static decoration → `ArenaLayout.decals[]`; the bundle's
  walkable rectangle → `ArenaLayout.walkable`.
- Collision comes from `xd://map_trace_geometry` measurement on the generated
  terrain layer, never estimated coordinates — the same "measure, don't guess"
  rule as sprite frame geometry.
- Parallax backgrounds register as `bg-layer-0` (back) through `bg-layer-2`
  (front) in `art/manifest.json`'s `bg` group; `ui/background.ts` picks them up
  automatically ahead of the single `bg-arena` fallback.

### Step 3 — Parallel generation

One `task` agent per group (typically hero, light enemies, heavy enemies,
pickups/FX, UI, background), **one owner per group, one output directory per
group, one report path per group.** A group needing two agents is split into two
groups in the manifest first — a shared report path silently loses one owner's
half, which is exactly how a group brief that named a single
`art/briefs/reports/<group>.md` for a two-owner group lost its bookkeeping.

Every spawned agent gets, explicitly:

- the skill references, the style profile path, its manifest slice, its output
  directory, its own report path, and the ownership rule;
- **the tool precondition list** (rule 0). Its FIRST action is the probe call and its
  first report line is the probe result. An agent that finds `generate_image` absent
  returns `blocked: required tool missing — generate_image` and stops. It never
  substitutes a nested `omp -p --auto-approve` session, a provider CLI, or
  hand-drawn pixels: those bypass the export markers, so nothing is preflighted,
  palette-checked, registered or reproducible. This happened; the group had to be
  redone.
- the regeneration budget as a COUNTER, not advice (Step 4);
- the manifest-lint result for its slice, so it does not rediscover a manifest bug
  the lint already named.

Multi-action characters follow the scale-profile sequence: accept idle →
`writeScaleProfile: true` + `profileName` → siblings bind via `scaleProfile` with
the drift gates. Only NxN grids may bind a profile.

### Step 4 — QC

**Per asset:** strict export QC (automatic), `sprite_check_palette` (`meanDistance`
< profile max — read it as distance from the palette LIST, not as quality; see rule
10). Reject and regenerate on: identity drift, clipped limbs, welded ground strip,
scale/anchor drift, collapsed lightness range, duplicate silhouettes. Change exactly
one thing per regeneration and use `qc.retryHints`.

**Per group:** `art_review` on the busiest asset and one set call across the group's
sheets. Scope the known false positives rather than acting on them (rule 10).

**Per scene, before the group is accepted — the cross-asset gate.** No group that
contains a floor, terrain tile, backdrop or parallax layer is accepted until
`skill://game-art/references/figure-ground.py` is clean (rule 9). It exits 1 on a figure/ground clash
above 15%, on a busyRatio above 1.20x, on a field that out-highlights its actors, and
on a warn-band finding with no written manifest exception. This is the gate that was
missing when 103/103 assets passed and the desert floor shipped at 27.45% clash.

**Retry budget: at most 2 regenerations per asset per symptom, enforced as a
counter.** After each regeneration, increment that asset's `attempts` in
`art/manifest.json`. **Before attempting a third generation of the same asset you
MUST first write its `qcExceptions[]` entry** — `{ id, reason }` with a one-line
visual justification (not "QC failed", but why the failure is acceptable or
unfixable). `manifest-lint.py` errors `attempt-budget-exceeded` on any asset at
`attempts >= 3` without that entry, so the write is not optional and cannot be
deferred to the report. Then stop: a slightly imperfect asset the pipeline finished
beats a slot that burns the whole run chasing one QC line. Measured: this budget
existed as advisory prose and was reasoned past to a SEVENTH variant (v7b) on a
single tile; the counter exists because the prose did not hold.

A `strict: false` export that ships with `qc.passed: false` (a full-bleed backdrop
or a seamless tile touching its canvas edge on purpose) REQUIRES the same one-line
`qcExceptions` entry, even on the first attempt — the template itself ships
`arena/floor` and `bg/arena` this way; cite them as the motivating case for when
`strict:false` is the correct call versus a QC dodge. A full-bleed asset is not
judged on silhouette metrics.

**Exceptions live in the manifest FILE.** A report line is not a record. Measured:
26 asset-level exceptions existed only in prose while `art/manifest.json` held 6,
because a batch instruction said report-don't-write and nobody reconciled. Both
`manifest-lint.py` and `figure-ground.py --manifest art/manifest.json` fail on an
unrecorded waiver, so run them after the last regeneration, not only before the
first.

### Step 5 — Key art (required for release)

A game with no cover is a grey card in the catalog, and the release gate
(`node scripts/release-check.mjs <slug>`) treats the scaffolded placeholder
`cover.svg` as unfinished. Every game therefore gets **one** generated cover
illustration — not a screenshot, not a montage: the game's hero moment, in the
project's own style profile.

1. **Brief.** Portrait, `aspect_ratio: "3:4"`, `image_size: "1024x1536"`. The
   player character (or the genre's signature object) mid-action, with the
   game's threat and reward colours in frame. No text, no logo, no UI, no
   border; a title treatment is allowed only if the game's own `logo` emblem is
   composited later by the store page, never rendered into the illustration by
   the provider.
2. **Export.** One `generate_image` call, one export marker, single frame,
   full-bleed like a backdrop:
   `OMP_SPRITE_EXPORT:{"outputDir":"art/exports/cover","rows":1,"cols":1,"profile":"hd-fx","styleProfile":"art/style.json","strict":false}`.
   `art/exports/` is reference material (the scaffold excludes it), so the cover
   never enters `art/manifest.json` and `gen-art-registry.mjs` never sees it:
   the cover is store media, not a game texture.
3. **Measure, then place.** Read the export's `sprite-metadata.json`
   `source.width`/`source.height`; accept a ratio of `0.66-0.80` (3:4 = 0.75)
   and regenerate outside that band. Then:
   - copy the exported single frame to `games/<slug>/public/cover.png`
   - set `game.json` `"cover": "cover.png"` (replacing `cover.svg`) and delete
     `public/cover.svg`
4. **Open Graph variant.** The store page's `og:image` is
   `games/<slug>/shots/og.png` when it exists. Produce it from the same hero
   moment as a landscape call (`aspect_ratio: "16:9"`,
   `image_size: "1536x1024"`) with `cover.png` passed as `input` (state in the
   prompt that Image 1 fixes composition, palette and character identity), then
   crop it to the Open Graph frame deterministically with the repo script:

   ```bash
   scripts/og-crop.sh games/<slug>/shots/og.raw.png games/<slug>/shots/og.png
   ```

   If the script reports its tool missing, ship the uncropped landscape as
   `shots/og.png`: Open Graph consumers rescale, and a hand-guessed crop
   loses the subject. Never crop the portrait cover into a landscape og —
   it decapitates the hero.
5. **Look at it.** Open both files. A cover that does not read at catalog-card
   size (≈300px wide) is a failed cover, regardless of QC numbers, and the
   `qcExceptions[]` entry a `strict: false` export requires still applies.

   Note the reserved store slot next to it: an optional looping
   `games/<slug>/shots/preview.webm` becomes the store page's autoplaying
   preview. It is captured from the running game, never generated.

### Step 6 — Engine wiring (the integrator)

`src/data/art.ts` is generated, not hand-edited. Follow
`references/phaser-integration.md`:

- Run `node scripts/gen-art-registry.mjs` from the current game project root
  (`games/<slug>/` during a build; `template/` only when editing the template
  itself) after every export or manifest edit; it reads `art/manifest.json`
  plus every asset's `sprite-metadata.json` and writes the registry — texture
  key, sheet path, frame geometry, animation key, duration, loop flag,
  per-action `scale` and `facesRight`. Never hand-edit `src/data/art.ts`; a
  manual edit is silently overwritten by the next regeneration and
  `verify.sh`'s `gen-art-registry.mjs --check` step fails the build the moment
  it drifts from the manifest.
- `PreloadScene` loads a registry row only when its `group` is listed in the
  active slice's `ART_GROUPS` (re-exported through `src/scenes/game.ts`), and
  creates animations in one loop; the loading bar already exists. **New art for
  a slice means a new manifest group AND that group's name added to the slice's
  `ART_GROUPS`** — otherwise the sheets export, the registry lists them, and
  nothing ever loads them. Per-family group names and the art-slot contract are
  in `references/slice-wiring.md`.
- Entities switch from tinted primitives to `sprite.play(ANIM.x)`; keep
  `setDisplaySize` driven by `TUNING` so balance and art stay decoupled.
- UI: `this.add.nineslice(...)` for panels/bars, idle/pressed textures for
  buttons, icon frames for HUD. Procedural textures stay for particles only.
- Verify: `npm run build` clean, then drive the running game in a browser and
  screenshot menu, run, level-up overlay and results. Generated art is
  brighter and busier than the template gradient the UI was designed against:
  after wiring, the build MUST run `game-build` Step 5.5 (UI adaptation +
  overlap/readability audit) — palette re-fit, text contrast armour, backdrop
  scrim, and an every-screen overlap pass — before store screenshots are
  taken. Swapping in a busy background without that audit is a known way to
  ship unreadable copy.

### Step 7 — Report

**One report path per owner.** A group with two owners was split at Step 2; if you
are writing into a path a sibling also owns, stop and split it.

Each generation agent's report opens with the **tool precondition probe result**
(rule 0), then per asset: output dir, frame count, cell size, palette
`meanDistance`, `attempts` used, and each accepted QC exception WITH the manifest id
it was written under — a justification that is not in `art/manifest.json.qcExceptions[]`
does not count as recorded, and the lint will say so.

The art-director's group sign-off adds:

- the `art_review` set figures, with the scope of any criterion quoted;
- the `figure-ground.py` output for every scene the group touches, including the
  actor sheet list it was run against (a partial cast is a different criterion);
- the final `manifest-lint.py` exit status and an answer to every remaining warning;
- then the integration diff summary and the browser screenshots proving the game
  renders with the new art.

A group is not "accepted" until those four are in the report. "Yes, I would ship
this set" is not a verdict; it is what was said about the set that shipped a 27.45%
figure/ground clash.

## References

| File | Use |
| --- | --- |
| `references/style-profiles.md` | Ready-made `sprite-forge.style.v1` profiles + field checklist |
| `references/asset-plan.md` | What a game needs, per genre: asset classes, counts, grids, durations; manifest schema |
| `references/prompt-contract.md` | The exact prompt/marker contract each generation agent must follow |
| `references/phaser-integration.md` | Registry, preload, animations, nine-slice UI, verification |
| `references/slice-wiring.md` | Per-family art slots, manifest group names, `ART_GROUPS` rule |
| `references/manifest-lint.py` | **Run before fan-out.** Style-lock, anchor, ownership, scale-profile and bookkeeping lint over `art/manifest.json` |
| `references/figure-ground.py` | **Run before a group is accepted.** Backdrop-vs-actor figure/ground clash, readability ceiling, cross-asset set spread |
| `skill://sprite-forge` | The generation and export contract itself |
| `skill://sprite-forge/references/art-direction.md` | How to write prompts that produce art, not diagrams |
