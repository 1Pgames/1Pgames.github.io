# Group `bg` report (owner ArtHubBg) + store key art

**Tool probe:** `generate_image` → `xai-oauth / grok-imagine-image`, 1024×1024, no marker. OK.
(Transport boundary and the full-bleed marker defect are measured in `art/briefs/reports/hub.md`
§CRITERIA; they apply here unchanged.)

Landed: `public/assets/generated/bg/arena`, `public/assets/generated/bg/logo` (the template's
vibrant-chibi `bg` pair was replaced; both ids and aliases kept). Missing: none.
Store media: `public/cover.png` (1024×1536) and `shots/og.png` (1200×630).

## Per-asset table

| id | Intent | Pipeline | Export QC | meanDistance / outliers | Generations | Visual verdict |
| --- | --- | --- | --- | --- | --- | --- |
| bg/arena (key `bg-arena`, alias `backdrop`) | dusk-violet Aurelia sky: ringed gas giant, amber horizon, nacre crystal spires, mesas, one tiny lit dome; calm sky for a title, dark bottom third for buttons | text-only, marker-less raw 1584×2816 (9:16) → `fitcrop.py` → 720×1280 full-bleed | strict **pass** (fullBleed, threshold 1) | 25.06 / 0.03% | 2 (a1 via marker: painted as a 520×924 card on pink, see hub.md) | accepted: the most Moebius/Syd Mead frame in the set; lights only 1.6% so it sits quietly behind UI |
| bg/logo (alias `logo`) | title wordmark "OUTPOST AURELIA", two stacked lines, retro 1970s NASA-era rounded caps, cream + amber inline + ink outline, small dome-under-planet emblem | marker, `hd-fx`, cell 512, threshold 150, `styleProfile` (vision anchor appended) → `art/tools/rekey.py` | strict **pass** | 19.46 / 0.6% | 1 (one earlier call died on the transport error before generating; not counted) | accepted: spelled correctly, every letter crisp at 260 px; 0 pinkish opaque pixels after re-key (measured) |
| cover (store media, not in the manifest) | the lit colony dome at dusk, the Beacon Spire rising, fauna lens-eyes at the fog edge, ringed planet | marker 3:4 with `styleProfile`, `fullBleed`; xai pink frame 229/206/287/248 px + inner ink border stripped by `fitcrop.py` → 1024×1536 | strict **pass** | 42.05 / 40.6% | 1 | accepted: reads at catalog-card size (spire silhouette + amber windows + lime eyes). Outliers = saturated sky violet (~#8a5fd6) the 18-colour list lacks; list fact, not drift |
| og (store media) | same moment, landscape | marker-less 16:9 with `public/cover.png` as Image 1 (composition/identity fixed) → raw 2816×1584 → `scripts/og-crop.sh` → 1200×630 | — | — | 1 | accepted: spire, three domes, crystals, ringed planet, lime-eyed fauna both corners; the spire's antenna tip is cropped by the centre crop, the amber beacon stays in frame |

Frame maps: every asset is `1x1`, frame 0 = the image.

## Set gates

- `art_review` set call (shared with hub, 12 assets): **passed**. bg/arena warns
  `value-tier-absent:light` (1.6%) — the known false-positive class for this criterion (canon ships
  0.4% lights); for a backdrop under UI a quiet light tier is the intent. Logo warns
  `value-plan-miss:light` 46% — lettering is cream by design; the plan's split is actor-calibrated.
- `figure-ground.py`: **not applicable** — no actor is drawn over the menu/results backdrop.

## Wiring contract

Unchanged keys: `bg-arena` (texture alias `backdrop`, 720×1280 portrait, `ui/background.ts`
`coverFit` fills 720×1280 exactly) and `logo` (512×512, square). The logo is now a WORDMARK:
`scenes/menu.ts` draws it at 260×260, fine for a square lockup; if a hub/menu also renders the title
as text, drop the text or the emblem, not both.

Text-over-art (graded with `art/exports/hub/scrim_preview.py`): menu backdrop + 0.35 bgDeep flat
scrim: ink 14.63:1 darkest / **2.96:1 lightest** (the amber horizon band) → text over the horizon band
needs the 0.6 band. Results gradient scrim (0.2 → 0.75): ink 4.19:1 on the lightest window, inkSoft
1.98:1 → results headline armour or panel required, as interface-direction §4 already specifies.

**Not done by me (outside my ownership, for Main/integrator):** `game.json` still says
`"cover": "cover.svg"` → set `"cover": "cover.png"` and delete `public/cover.svg` (game-art Step 5.3).

## CRITERIA

Same as `hub.md` (marker full-bleed injection, deframe portrait scope, fullBleed aspect stretch,
meanDistance-as-list-distance). Specific to this group:
- The existing `qcExceptions` entry `bg/arena` (strict:false) is **no longer needed**: the regenerated
  backdrop exports STRICT with `fullBleed` (fullBleed waives only the structural contamination verdict;
  every other gate stayed live). Keeping it is harmless; removing it is correct.
- Logo brief conflict, resolved in favour of the task: the manifest action says "wordless crest
  emblem"; the assignment says a legible "OUTPOST AURELIA" wordmark. The manifest text is updated in
  the delta.
- Post-review transforms reviewed: menu 0.35 flat scrim and results 0.2→0.75 gradient on bg/arena
  (`graded-menu-backdrop.png`, `graded-results-backdrop.png`).

## manifest-delta

```json
{
  "ATTEMPTS": {"arena": 2, "logo": 1},
  "groups.bg.note": "arena = dusk Aurelia sky backdrop, full-bleed 720x1280 (9:16), strict + fullBleed; logo = OUTPOST AURELIA wordmark (stacked) over a dome emblem, 512 cell, re-keyed.",
  "groups.bg.assets.arena.action": "dusk-violet Aurelia sky backdrop, full-bleed 720x1280, strict with fullBleed",
  "groups.bg.assets.logo.action": "title wordmark OUTPOST AURELIA (two stacked lines, retro NASA caps) over a small dome emblem, on magenta, 512 cell",
  "qcExceptions.remove": ["bg/arena"]
}
```
