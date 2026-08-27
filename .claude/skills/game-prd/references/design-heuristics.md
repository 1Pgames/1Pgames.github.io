# Design heuristics — portrait browser games, ten gameplay families

Numeric defaults for the PRD agent. Every number here is a **default to
recommend**, not a fact to re-derive; only deviate when the user's pitch or a
family playbook overrides it, and record the override in the PRD's
Assumptions. All helper/module names are verified against `template/` as of
this writing; anything not yet in the template is marked `NEW: needs <file>`.

Scope map — read the section your family needs, not all of them:

| Sections | Apply to |
| --- | --- |
| §1-§5, §6 | Families A, D, E (timed/fight/lap sessions with in-session power growth) |
| §15 | Families B, G, H and C-levels (level curves, win-rate bands, move budgets) |
| §16 | Family J and C-endless (score ramps, session length, near misses) |
| §17 | Family F (cost growth, prestige sizing, offline progress) |
| §7-§14, §18 | All families (UI density, input, feel, performance, meta, parallel build, verification map) |

Shared contract with `references/genre-playbooks.md` and
`references/casual-playbooks.md`: portrait **720x1280**; `SAFE` top **140px** /
bottom **220px** / side **40px**; reference run for families A/D **480s**
(8 min, inside the 5-10 min / 300-600s band) while every other family's session
window is fixed in `SKILL.md` §Step 0b; entity budget **300 live sprites at
60fps**; every session driven by a `SessionDirector` (`core/session.ts`);
build split into **5 parallel layers** (core mechanic, content/data, UI/meta,
director/generation, integration/balance) plus the sim/verification layer of
§12.1 where the family's gate is a generator validator.

---

## 1. Run architecture (families A and D; E per race index)

A timed run is not one escalating variable — it has named phases, each with its
own pressure target, so the build agent can drive `core/run.ts`'s
`RunDirector` (`WaveSpec[]` per `RunPhase`) instead of a single ramp timer.
Level-based families use §15 instead, endless families §16, idle §17.

### 1.1 Reference run: 480s (8 min), 6 phases

| Phase | Window (s) | Duration (s) | Threat multiplier | Design intent |
| --- | --- | --- | --- | --- |
| Grace | 0-20 | 20 | 1.0 | Zero-risk onboarding; read controls and first entity |
| Early | 20-120 | 100 | 1.3 | First real threat, first upgrade loop teaches the meta |
| Mid | 120-240 | 120 | 1.7 | First elite; build identity must be legible by phase end |
| Late | 240-360 | 120 | 2.3 | Composition variety peaks; power/threat race tightens |
| Climax/Boss | 360-450 | 90 | 3.2 | Boss telegraph + fight; the clip-worthy peak |
| Resolution | 450-480 | 30 | 3.2 (held) | Cooldown, reward screen, extract-or-continue decision |

Threat multiplier is the phase's value of the phase-stepped curve in §2 and
is the single number `WaveSpec` entries read to scale `data/enemies.ts`
archetypes for that phase.

### 1.2 Landing points (seconds into the 480s run)

| Milestone | Time (s) | Rationale |
| --- | --- | --- |
| First threat visible | 20 | End of grace window; matches the template's onboarding rule ("first 3s readable") scaled up for a longer run |
| First upgrade choice (`ui/cards.ts`) | 45 | First XP-level threshold (`xp(1)=13`, see §3.2) reached at typical early kill rate |
| First elite | 150 | Mid-phase wave 4 of a ~35-40s wave cadence; first test of the build so far |
| Boss spawn | 420 | 60s into the Climax/Boss phase — enough telegraph + ramp before the fight |
| Run resolution | 450-480 | Reward tally, meta currency payout (§4), extract choice |

### 1.3 Run endings

| Ending | Trigger | What happens |
| --- | --- | --- |
| Win | Boss/final wave cleared at or before the phase-6 deadline | Full meta payout (§4), `RunState.end()` analog fires `run:ended` with `win: true` |
| Lose | `Health.apply()` returns true (hp hits 0) before the run ends | Partial meta payout scaled by elapsed phase reached |
| Extract | Player opts out after an extract-eligible checkpoint (recommended: end of Mid phase, t ≥ 180s) | Banks current run rewards at a discount (recommended 70%) instead of risking Late/Climax |

A run needs exactly one of these three outcomes reachable from every phase;
a PRD that only specifies "lose" for a 480s run is under-specified.

### 1.4 Implications of the 5-10 minute band

The 480s table is the reference point; scale every phase boundary by
`ratio = targetRunSeconds / 480`:

| Target run length | Ratio | Effect |
| --- | --- | --- |
| 300s (5 min, band floor) | 0.625 | Grace 0-13s, Early 13-75s, Mid 75-150s, Late 150-225s, Climax 225-281s, Resolution 281-300s. Merge Late+Climax if a genre playbook needs fewer than 6 distinct phases below 360s. |
| 480s (reference) | 1.0 | Table above, unmodified. |
| 600s (10 min, band ceiling) | 1.25 | Grace 0-25s, Early 25-150s, Mid 150-300s, Late 300-450s, Climax 450-563s, Resolution 563-600s. Add a second Mid-tier wave set rather than stretching Climax — a 113s-long Climax reads as padding on video. |

A run under 5 minutes reads as a casual game (out of scope here); a run over
10 minutes needs its own content-volume pass (§6) or it will feel thin in
the back half.

---

## 2. Difficulty scaling math

Four named curves. All are expressed as a single scalar `threatMult(t)`
that the build agent multiplies into enemy HP/damage/spawn-rate — the same
role `TUNING.hazard.speedGainPerSecond` plays in the demo scene, generalized
to a build-crafting game.

### 2.1 Linear

`threatMult(t) = 1 + a * t`, recommended `a = 0.0025 /s`.

| t (s) | 60 | 180 | 300 | 480 |
| --- | --- | --- | --- | --- |
| threatMult | 1.15 | 1.45 | 1.75 | 2.20 |

Predictable, easy to balance by hand, but feels flat by the Climax phase —
use only for short (≤5 min) or low-complexity runs.

### 2.2 Geometric

`threatMult(t) = b^(t/T)`, recommended `b = 1.22`, `T = 60s` (22% harder
every 60s of survival).

| t (s) | 60 | 180 | 300 | 480 |
| --- | --- | --- | --- | --- |
| threatMult | 1.22 | 1.82 | 2.70 | 4.91 |

Uncapped geometric growth reaches 4.91x by 480s — steeper than the
phase-stepped ceiling below. This is why every curve in this document is
run through the fairness ceiling in §2.5 before it reaches `data/enemies.ts`.

### 2.3 Phase-stepped (recommended default for complex runs)

`threatMult(t) = stepTable[phase(t)]`, using the phases from §1.1:

| Phase | Window (s) | threatMult |
| --- | --- | --- |
| Grace | 0-20 | 1.0 |
| Early | 20-120 | 1.3 |
| Mid | 120-240 | 1.7 |
| Late | 240-360 | 2.3 |
| Climax/Boss | 360-450 | 3.2 |
| Resolution | 450-480 | 3.2 (held, no new ramp) |

| t (s) | 60 | 180 | 300 | 480 |
| --- | --- | --- | --- | --- |
| threatMult | 1.3 | 1.7 | 2.3 | 3.2 |

Recommended default because it lets `data/waves.ts` author each phase's
`WaveSpec` composition explicitly instead of only scaling stats, which is
what makes a run feel like it has content rather than one dial turning.

### 2.4 Adaptive / rubber-band

Modulates a base curve (recommended: phase-stepped) by recent player
performance so a struggling or dominant run gets nudged back toward the
target:

`threatMult(t) = stepTable[phase(t)] * clamp(1 + kr*(perf - target), floor, ceiling)`

with `kr = 0.5`, `target = 0.6` (60% of a rolling window spent healthy),
`floor = 0.75`, `ceiling = 1.35`.

Worked at t=180s (`stepTable = 1.7`):

| `perf` (recent healthy-time ratio) | Adjustment | Resulting threatMult |
| --- | --- | --- |
| 0.9 (dominating) | `1 + 0.5*(0.9-0.6) = 1.15` | 1.955 |
| 0.6 (on target) | `1.0` | 1.7 |
| 0.3 (struggling) | `1 + 0.5*(0.3-0.6) = 0.85` | 1.445 |

Only recommend adaptive for runs with meta stat-tracking already in place
(`core/stats.ts` modifiers feeding the same pipeline) — it is the most
expensive curve to test and tune.

### 2.5 Fairness floor / ceiling rule

- **Ceiling:** no curve may push `threatMult` above **3.2x** its Grace-phase
  value inside the reference 480s run. This is why §2.2's raw 4.91x at 480s
  must be capped: `min(rawCurve(t), 3.2)`.
- **Floor:** spawn interval never drops below a hard floor (recommended
  **260ms**, matching `TUNING.hazard.spawnMsFloor` in the demo) regardless of
  curve — below that, spawns are unreadable and deaths feel like RNG, not
  skill.
- Fairness ceiling exists for readability, not mercy: at 300 live entities
  (§10), a threatMult above 3.2x on top of HP/damage growth produces enemy
  density the player physically cannot parse on a 720px-wide screen.

### 2.6 Enemy HP/damage/spawn-rate per phase (worked example)

Baseline enemy (`data/enemies.ts` "grunt" archetype): HP 20, damage 6,
spawn interval 1400ms. HP scales linearly with `threatMult`; damage scales
by `sqrt(threatMult)` (damage growing slower than HP keeps time-to-kill from
exploding while HP growth still makes the player feel their build's power);
spawn interval scales inversely, floored at 260ms.

| Phase | threatMult | HP | Damage | Spawn interval (ms) |
| --- | --- | --- | --- | --- |
| Grace | 1.0 | 20 | 6.0 | 1400 |
| Early | 1.3 | 26 | 6.8 | 1077 |
| Mid | 1.7 | 34 | 7.8 | 824 |
| Late | 2.3 | 46 | 9.1 | 609 |
| Climax/Boss | 3.2 | 64 | 10.7 | 438 |
| Resolution | 3.2 | 64 | 10.7 | 438 |

---

## 3. Power curve vs threat curve

### 3.1 Target power ratio per phase

`powerRatio(t) = playerPower(t) / threatMult(t)`, where `playerPower` is a
composite of level, equipped upgrades, and gear read through
`core/stats.ts`'s `StatBlock`. Target ratios, by design intent:

| Phase | Target `powerRatio` | Why |
| --- | --- | --- |
| Grace | 1.3 | Deliberate overshoot — teaches systems risk-free (power fantasy) |
| Early | 1.1 | Still ahead; first upgrade choices should feel like they matter |
| Mid | 1.0 | Parity — the build must be developing or the player falls behind |
| Late | 0.95 | Threat edges ahead; forces engagement with remaining upgrade choices |
| Climax/Boss | 0.85 | Threat ahead of a generic build; only a coherent build (§5) closes the gap |
| Resolution | 1.0+ | Boss-drop power spike restores parity for the reward/extract beat |

If `powerRatio` never drops below 1.0, the run has no tension in its back
half — this is the numeric definition of "too easy" for this genre band.

### 3.2 XP / level threshold formula

`xpToLevel(level) = round(base * growth^level)`, recommended `base = 10`,
`growth = 1.28`.

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| XP required | 13 | 16 | 21 | 27 | 34 | 44 | 56 | 72 | 92 | 118 | 151 | 193 |

Cumulative XP to reach level 12 is **837**. A 480s run at a typical
2-3 XP/kill, 1 kill per ~4-5s outside Grace, yields roughly level 10-12 by
Resolution — i.e. roughly one level-up (and one upgrade choice) every
35-45s of active play.

### 3.3 Upgrade choice count for a 480s run

Target **10-14 upgrade-choice events** per 480s run, each a pick-1-of-3
draw through `ui/cards.ts` — one per level-up from §3.2's ~12-level curve.
That is 30-42 individual card draws per run, which sets the minimum upgrade
pool size in §5 (pool ≥ 4x the *choices per event*, i.e. ≥ 12 distinct
upgrades minimum, 24 comfortable — matching §6).

### 3.4 When power outscales threat — the power fantasy window

A deliberate, time-boxed window (recommended **15-30s**) where
`powerRatio` spikes above 1.3-1.5 — typically right after a boss drop, a
rare-upgrade combo landing, or clearing an elite pack. During this window:

- Enemy density and telegraphs stay unchanged (do not secretly buff enemies
  to compensate — that reads as broken, not challenging).
- Juice response scales up (§9): bigger `burst` counts, `sfxArp` on kill
  chains, `countTo` on score — this is the highlight moment §13 clips around.
- The window self-corrects because the *next* phase step raises
  `threatMult` on its own schedule (§2.3); no runtime nerf is needed.

---

## 4. Economy design

### 4.1 In-run currency

| Flow | Source/sink | Value | Unit |
| --- | --- | --- | --- |
| Income | Grunt kill | 1-3 | currency/kill |
| Income | Elite kill | 15 | currency |
| Income | Chest/pickup | 25 | currency |
| Sink | Card reroll (after the first free one) | 10 | currency |
| Sink | In-run shop item | 20-60 | currency |

Recommended: **1 free reroll per upgrade-choice event** (§5.3), further
rerolls cost the sink value above — this keeps rerolling a real decision,
not a free action.

### 4.2 Meta currency per run

| Outcome | Base payout | Formula |
| --- | --- | --- |
| Loss | 8 + 2 per completed phase | `8 + 2*phasesCleared` (0-12) |
| Extract | 70% of the win payout at the extract phase | `0.7 * winPayout(phaseAtExtract)` |
| Win | 25 | flat, plus any unspent in-run currency converted at 1:1 |

### 4.3 Meta upgrade cost formula and grind length

`cost(level) = base * growth^level`, recommended `base = 20`, `growth =
1.35`.

| Level | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cost | 20 | 27 | 36 | 49 | 66 | 90 | 121 | 163 |

Worked grind length at an average blended income of **18 currency/run**
(loss/win/extract mix at a plausible 50% early winrate):

| Target level | Cumulative cost | Runs to reach it |
| --- | --- | --- |
| 1 | 20 | 1.1 |
| 3 | 83 | 4.6 |
| 5 | 199 | 11.1 |
| 8 | 573 | 31.8 |
| 10 | 1092 | 60.7 |

A full 3-stat meta track to level 8 each costs ~1720 currency, ≈ **96
runs** — recommended as the "full clear" pacing target (§11.3). If a
playbook wants a shorter grind, raise `avgIncome` or lower `growth` to
1.25-1.30 rather than changing the formula shape.

### 4.4 Inflation control

- Cap meta currency payout per calendar day (recommended: full payout for
  the first 5 runs/day, 50% payout after) so the grind length above is not
  trivially bypassed by run-farming.
- Never let in-run currency persist between runs — only the meta-currency
  conversion at run-end crosses the boundary, otherwise the in-run economy
  (§4.1) inflates every subsequent run and its sinks stop mattering.

---

## 5. Build variety and synergy math

### 5.1 Minimum viable strategies

At least **3** independently viable archetypes per game, e.g. aggro/DPS,
defensive/sustain, utility/kiting. "Viable" means each has a plausible path
to a Climax-phase `powerRatio` ≥ 0.85 (§3.1) using only upgrades from its
own lane plus generically-useful shared upgrades.

### 5.2 Choices vs pool size

| Quantity | Value |
| --- | --- |
| Choices offered per upgrade event (`ui/cards.ts`) | 3 |
| Upgrade events per 480s run (§3.3) | 10-14 |
| Minimum upgrade pool size | 12 (= 4x choices per event) |
| Comfortable upgrade pool size | 24 |

Pool size is measured **after** filtering already-maxed and mutually
exclusive upgrades (§5.4) — the 4x multiplier exists specifically so that
filtering never collapses the pool below the 3 needed for one draw.

### 5.3 Draft and reroll rules

- 1 free reroll per upgrade-choice event; further rerolls cost 10 in-run
  currency (§4.1).
- Pity rule: at least 1 of every 3 upgrade-choice events must offer an
  upgrade tagged to the player's currently-dominant build lane (tracked via
  `source` tags on `Modifier`s already applied through `core/stats.ts`).

### 5.4 Rarity weights and no-dead-draft guarantee

| Rarity | Weight | Cumulative |
| --- | --- | --- |
| Common | 60% | 60% |
| Rare | 30% | 90% |
| Epic | 9% | 99% |
| Legendary | 1% | 100% |

Legendary pity timer: guarantee at least one legendary-tier offer by the
level-8 upgrade event if none has appeared naturally (`Rng.pickWeighted`
against the table above, with a forced re-roll into the legendary tier once
the pity counter trips).

No-dead-draft guarantee: filter the pool of already-maxed upgrades and
upgrades mutually exclusive with one already taken *before* drawing 3; if
the filtered pool would drop below 3, fall back to offering duplicates of
the player's strongest current upgrade at a diminished (recommended -40%)
value rather than presenting fewer than 3 choices.

### 5.5 Detecting a dominant strategy numerically — `npm run sim`

This is no longer a manual playtest estimate: `npm run sim` (`src/sim/cli.ts`)
runs every build lane named in the PRD's §8 Build variety headlessly and
reports the numbers below directly. Invocation: `npm run sim -- --runs N
--seed S --lane name|all [--json] [--strict]`; `--lane all` runs every named
lane, `--strict` turns every gate into a hard failure (exit non-zero).

Per lane, across `--runs N` seeded simulated runs, `npm run sim` reports:

- **Win-rate proxy:** clears (win + extract) / total runs for that lane.
- **Time-to-clear proxy:** median seconds from run start to boss defeat for
  that lane.

**Hard gates** (fail the run regardless of `--strict`): a lane must be
winnable (win-rate > 0) and must be losable (loss-rate > 0) — a lane that
always wins or always dies is not a lane, it is a broken sim; and the
first-upgrade-choice timing (§1.2's ~45s landing point) must fall inside a
tolerance band, not be skipped or arrive at t=0.

**Soft gates** (advisory unless `--strict`): flag a lane as dominant if
either

- its win-rate exceeds the mean win-rate across all lanes by more than
  **2 standard deviations**, or
- its median time-to-clear is **≥ 15% faster** than the average of every
  other lane —

equivalently, the report's win-rate spread across lanes must stay within
**≤ 0.35** (max minus min), and the median decision cadence (upgrade-choice
events per run, §3.3) must land in **10-14**. A flagged lane needs its
strongest upgrade's `mul`/`add` values reduced in the next balance pass, not
a mid-run nerf.

**The balance pass is a loop, not a one-shot:** run `npm run sim -- --lane
all`, read the report, edit the offending values in `TUNING`
(`src/config.ts`), re-run the sim. Repeat for a maximum of **3 iterations**;
if gates still fail after 3, ship the best iteration and flag the remaining
gate failures explicitly in the PRD/report rather than iterating unbounded.

---

## 6. Content volume budgets

Baseline for a family-A/D 480s run (scale counts by the §1.4 ratio for other
run lengths; subgenre overrides live in `genre-playbooks.md`). **Per-family
content volumes — including the B/C/F/G/H/J minimums — are the gate table in
`prd-template.md` §5.0**; this section is the A/D detail behind that table's
first row.

| Content type | Minimum viable | Comfortable | Per-item build effort | Home |
| --- | --- | --- | --- | --- |
| Enemy archetypes | 4 | 8 | S (stats + texture tint) | `data/enemies.ts` |
| Upgrades | 12 | 24 | S-M (stat modifier + card art) | `data/upgrades.ts` |
| Bosses | 1 | 3 | L (unique kit + telegraphs) | `data/enemies.ts` + a boss-specific behaviour file |
| Rooms/waves | 6 | 16 | M (`WaveSpec` composition + pacing) | `data/waves.ts` |
| Towers/units (if applicable) | 4 | 10 | M (stats + placement rules) | `data/upgrades.ts` or a dedicated `data/units.ts` (NEW: needs `data/units.ts` if the genre is tower-defense/auto-battler) |
| Items/relics | 6 | 16 | S (stat modifier, no new art required) | `data/upgrades.ts` |

Effort key: **S** = under an hour of agent time (data entry + reuse of
existing textures/stats plumbing); **M** = a few hours (new behaviour or
composition logic); **L** = a full subagent slice (unique kit, multiple
integration points).

Below "minimum viable" for the chosen run length, the back half of the run
repeats content the player already saw in the front half — this is the
numeric definition of "feels short" independent of the timer.

---

## 7. Portrait UI density

### 7.1 Pixel budgets per zone (720x1280 = 921,600 px² total)

| Zone | Bounds | Area (px²) | Share of frame | Interactive? |
| --- | --- | --- | --- | --- |
| Top (readout) | y 0-140 | 100,800 | 10.9% | No — HUD text only |
| Bottom (controls) | y 1060-1280 | 158,400 | 17.2% | Yes — primary buttons only |
| Side margins (both) | x 0-40, x 680-720, full height | 102,400 | 11.1% | No |
| Playfield (safe interactive) | x 40-680, y 140-1060 | 588,800 | 63.9% | Yes — gameplay |

### 7.2 HUD element inventory

| Element | Zone | Position (x, y) | Size (px) | Driven by |
| --- | --- | --- | --- | --- |
| HP bar | Top | `SAFE.side, 30` | 200x12 | `ui/bars.ts`, backed by `core/damage.ts` `Health.ratio` |
| XP bar | Top | `SAFE.side, 48` | 200x8 | `ui/bars.ts`, backed by §3.2's threshold table |
| Run timer | Top, centered | `VIEW.centerX, 30` | text, `TEXT.score` | phase clock from `core/run.ts` `RunDirector` |
| Currency | Top-right | `720 - SAFE.side - 90, 30` | text + icon, 32px icon | in-run currency counter (§4.1) |
| Wave/phase counter | Top-right, below currency | `720 - SAFE.side - 90, 66` | text, `TEXT.label` | `RunPhase` name from `RunDirector` |
| Ability cooldown icons | Bottom | `VIEW.centerX ± 100, 1150` | 88x88 each | secondary-verb buttons (§8) |
| Boss HP bar (Climax phase only) | Top, replaces player HP temporarily or stacks below it | `SAFE.side, 66` | 640x14 | `ui/bars.ts` |

### 7.3 Modal overlay rules (`ui/cards.ts`)

- Upgrade-choice draws are **full-screen overlays**: pause the `RunDirector`
  clock and physics, dim the playfield to ≤15% opacity beneath a
  `TEX.panel` backdrop, but keep the top-third HUD (HP/timer/wave) rendered
  at full opacity above the dim so the player never loses situational
  awareness mid-decision.
- Entrance/exit use `enterFromBottom` on each of the 3 cards, staggered by
  ~60ms, so the draw itself reads as a beat rather than a hard cut.

### 7.4 Tap targets and thumb occlusion

- Minimum tap target: **88x88px** for any interactive element (buttons,
  cards, cooldown icons). The template's `Button` default (112px tall)
  already clears this; 88px is the floor for secondary/smaller controls.
- Thumb occlusion: holding the phone one-handed covers roughly the **bottom
  35%** of the frame, i.e. y ≥ 832 (1280 * 0.65). This zone is larger than
  `SAFE.bottom` (220px, y ≥ 1060) — the extra 228px (y 832-1060) is
  visually occluded even though it is not flagged unsafe by `SAFE`.
  Recommendation: keep HP/timer/wave readouts above y = 832, not just
  above y = 1060, so a viewer's own thumb never hides the numbers that
  matter for the video (§13).

### 7.5 Bottom sheet vs full-screen overlay

| Use case | Pattern | Why |
| --- | --- | --- |
| Reroll confirm, quick info tooltip (≤3 options, dismiss < 3s) | Bottom sheet, height ≤ 320px, slides up from y=1280 | Keeps the playfield and HUD visible; low-stakes decision |
| Upgrade choice, shop, pause menu (structural decision, needs full attention) | Full-screen overlay via `ui/cards.ts` pattern (§7.3) | High-stakes decision; player must not misread a partially-visible option |

### 7.6 Noise ceiling

Maximum **7 simultaneous distinct HUD widgets** on screen at once
(excluding transient `floatText`/`burst` combat feedback, which is capped
separately in §9). Above 7, group secondary readouts (e.g. combine wave +
phase into one label) rather than adding an 8th persistent widget.

---

## 8. Input for complex games

### 8.1 Verb mapping

| Interaction | Mechanism | `Controls` hook |
| --- | --- | --- |
| Primary verb (move/aim/attack — pick exactly one per PRD) | Continuous | `Controls.onDrag` + `axisX`/`axisY` read in `update`, or `Controls.onTap` for a discrete primary verb |
| Secondary actions (ability activate, pause) | Discrete, low-frequency | `ui/button.ts` `Button` instances, not `Controls` — these are UI, not world input |
| Drag-to-place (towers, wards) | Composite gesture | `onHoldStart` (pick up a ghost placement), `onDrag` (move the ghost, snap to `core/grid.ts` `NavGrid` cells), `onHoldEnd` (commit placement if the cell is unblocked) |
| Long-press for info (inspect enemy/upgrade) | Timed hold | `onHoldStart` + a caller-tracked elapsed-time check (recommended threshold **350ms**) before opening a tooltip; `onHoldEnd` before the threshold cancels it as a normal tap |

Exactly one **primary** verb per game, matching the PRD template's rule —
"deep" comes from what that verb interacts with (build, terrain, enemy
type), not from stacking input methods.

### 8.2 Banned input

- **Tilt/gyroscope:** unreliable permission prompts across mobile browsers,
  and unusable while the phone is propped up for screen recording — the
  exact context this game is built for.
- **Multi-touch/pinch gestures:** `Controls` has no multi-pointer API by
  design (single `Phaser.Input.Pointer` tracked per interaction); adding one
  is out of scope and multi-touch is unreliable under most screen-recording
  overlays anyway.
- **Complex gesture recognizers** (circles, multi-stroke swipes): raise
  misinput rate on a 640px-wide safe area and add recognition latency the
  5-10 minute pacing in §1 cannot absorb.

### 8.3 Keyboard parity

| Action | Keyboard | Source |
| --- | --- | --- |
| Move/aim axes | Arrow keys / WASD | `Controls.axisX`, `axisY` |
| Primary action | SPACE | `Controls.justPressed('SPACE')` |
| Pause | ESC or P | `Controls.justPressed('ESC' \| 'P')` |
| Mute | M | `Controls.justPressed('M')` |

Every primary and secondary verb must have a keyboard equivalent before the
PRD is handed off — this is already a template convention
(`AGENTS.md` §"one API for touch and desktop"), not a new requirement.

### 8.4 Keeping the play field visible during a menu

Same rule as §7.3: a modal never fully replaces the playfield render — dim
it under a translucent `TEX.panel`, keep the top-third HUD at full opacity,
and pause `RunDirector`/physics/timers rather than tearing down the scene.
This lets a player check "what's about to kill me" before committing to an
upgrade choice, which is load-bearing for a genre this complex.

---

## 9. Game feel budget at scale

### 9.1 Required feedback per event class

| Event class | Visual | Values | Sound |
| --- | --- | --- | --- |
| Trash-kill | `floatText` + `burst` (small) | `+N`, 6 particles, 220px/s | `sfx('hit')` |
| Elite-kill | `floatText` + `burst` (large) + `pop(player)` | `+N`, 18 particles, 320px/s, pop 0.25/180ms | `sfx('hit', {volume:1})` then `sfx('die')` |
| Player hit | `shake` + `flash` | intensity 0.008/160ms, `PALETTE.bad`/140ms | `sfx('hit')` |
| Level-up | `countTo` on XP/level readout + `burst` | 420ms count, 14 particles | `sfxArp('levelup', 3)` |
| Upgrade drafted | `pop` on chosen card + `enterFromBottom` exit for the other two | 0.3/180ms | `sfx('ui')` |
| Boss telegraph | `flash` (low intensity, repeating) | `PALETTE.secondary`/100ms, repeat 3x over 1.5s | `sfx('whoosh')` |
| Boss death | `shake` + `flash` + `hitstop` + fade | 0.02/320ms, `bad`/240ms, hitstop 120ms/slow 0.05 | `sfx('die')` then `sfxArp('levelup', 4)` |
| Run end (win/lose/extract) | `flash` + fade to GameOver-equivalent scene | 240ms flash, 300ms fade | `sfx('die')` (lose) or `sfxArp('levelup', 5)` (win) |

### 9.2 Damage-number spam limit

Cap **12 `floatText` calls/second** scene-wide. When more than 12 damage
events land in a 1s window, aggregate: sum simultaneous hits on the same
target within a 50ms window into one `floatText` ("+42" instead of 6
separate "+7"s). At 300 live entities this is not optional — uncapped
`floatText` spam is the single most common cause of an unreadable frame in
this genre.

### 9.3 When not to shake

Suppress `shake` (keep `flash`/`pop` only) when either:

- live entity count exceeds **150**, or
- more than **5 hits land in a single frame**.

At high entity counts, camera shake amplifies visual noise faster than it
communicates impact, and repeated shake calls fight each other's camera
offset resets.

### 9.4 Hitstop throttling

`hitstop` freezes scene time — calling it once per simultaneous kill during
a screen-clear moment stacks freezes and makes the game feel like it is
stuttering, not landing hits. Rule: at most **one `hitstop` call per 100ms**
scene-wide (a simple `lastHitstopAt` timestamp guard); every kill still gets
its `floatText`/`burst`/sound, only the time-freeze is rate-limited.

### 9.5 Audio voice limits

`sfx()` creates fresh WebAudio oscillator/gain nodes per call with no
built-in polyphony cap. At 300 entities, unthrottled `sfx('hit')` calls can
spawn dozens of simultaneous nodes per frame. Rule: cap **8 concurrent
`sfx()` triggers per 100ms window** per event name; dedupe by event type
inside that window (only the first `hit` in 50ms plays, the rest are
suppressed) so combat noise reads as "a lot of hits" rather than clipping
distortion.

---

## 10. Performance budget

Target: **300 live sprites at 60fps** (16.67ms/frame).

### 10.1 Pooling mandates

Any entity class exceeding **20 concurrent instances** or spawning faster
than **50/min** must use `core/pool.ts` — `Pool<T>` for plain data/logic
objects, `SpritePool` for `Phaser.Physics.Arcade.Sprite`s. `new`/`destroy`
churn is the documented cause of GC hitches at this entity count; the
player, a boss, or any object created a handful of times per run may stay
plain-constructed.

### 10.2 `SpatialHash` cell sizing

`cellSize ≈ 1.5-2x the largest common query radius` for that hash instance.

| Query use case | Typical radius | Recommended `cellSize` |
| --- | --- | --- |
| Melee swing hit-check | 80px | 128-160px |
| Tower/ranged attack range | 240px | 360-480px |
| AoE explosion | 120px | 180-240px |

Too small and a query touches many buckets for overhead with no payoff;
too large and each bucket degrades back toward an O(n) scan. Use a separate
`SpatialHash` instance per query radius class rather than one shared
instance sized for the largest case.

### 10.3 Collision strategy by entity count

| Live entity count (of the class being checked) | Strategy | Why |
| --- | --- | --- |
| ≤ 30 | `physics.add.overlap` between Arcade groups | O(n*m) pairwise cost is trivial (≤900 checks/frame) |
| 30-150 | Arcade overlap for actual collision response, plus `SpatialHash.queryCircle`/`queryRect` to prune candidate pairs before any AoE/aggro logic runs | Keeps Arcade's broad phase from doing wasted work on entities that can't possibly interact this frame |
| 150-300 | Skip Arcade group overlap for that class entirely; do manual distance checks against `SpatialHash` query results only | Arcade's pairwise overlap is O(n*m) — at 300x300 that is 90,000 checks/frame, already over budget; a spatial-hash query bounds the check count to local density (typically 5-10 neighbours), not total population |

### 10.4 Tween/particle/text caps

| Resource | Cap (concurrent) |
| --- | --- |
| Tweens | 120 |
| Particle instances alive | 250 |
| `floatText` instances alive | 20 (destroy on fade-complete, do not let them queue) |

### 10.5 Per-frame prohibitions

Must never happen inside `update()` or any per-frame callback:

- Allocating new arrays/objects in a hot loop (spawn, damage roll, AI
  query) — reuse the caller-provided `out` array pattern `SpatialHash`
  already follows.
- `Graphics.clear()` + redraw for anything that did not change this frame —
  draw once into a texture (`core/textures.ts` pattern) instead.
- Iterating every sprite via `group.getChildren()` when a `SpatialHash`
  query already narrows the candidate set.
- Constructing a new `Phaser.Math.Vector2` (or similar) per call instead of
  reusing a scratch instance.

### 10.6 Measurement method

- FPS: `scene.game.loop.actualFps`, sampled and displayed behind the
  existing `?debug` flag (matching `AGENTS.md`'s debug-physics convention).
- Entity count: sum of `.active` across every live `Pool`/`SpritePool`
  instance, displayed alongside FPS in the same debug overlay. A build that
  cannot report both numbers on demand cannot be verified against the
  300-entity/60fps target.

---

## 11. Meta progression and retention

### 11.1 What persists (`core/progression.ts` `MetaSave`)

| Field | Contents |
| --- | --- |
| `version` | schema version integer (§11.2) |
| `currency` | meta-currency balance (§4.2) |
| `unlocks` | unlocked archetypes/bosses/cosmetics, keyed by id |
| `upgrades` | per-meta-upgrade level, read by `metaModifiers()` |
| `stats` | best run, total runs, per-lane win-rate proxy (§5.5) |

`metaModifiers()` returns `Modifier[]` sourced `'meta'`, applied to the
run's `StatBlock`s at run start via `addModifier` — meta progression is
just another modifier source, not a parallel stat system.

### 11.2 Versioned save and migration

`MetaSave.version` is bumped on every schema change. The loader checks the
stored version against the current one and runs a chain of `migrate(from →
from+1)` steps up to current; if no migration path exists for a stored
version, reset that save with a logged warning — never throw, never silently
drop fields the player earned.

### 11.3 Unlock pacing

| Milestone | Target |
| --- | --- |
| Runs to first unlock | 2-3 (early dopamine hit, before the grind math in §4.3 has set expectations) |
| Runs to a full meta-track clear | 60-100 (matches §4.3's worked 96-run full-clear estimate) |

### 11.4 Daily-seed pattern

`new Rng(dailySeed())` seeds anything that should be identical for every
player on a given calendar day: wave layout, elite placement, boss variant.
`dailySeed()` already exists in `core/rng.ts` and returns the ISO date —
reuse it verbatim rather than rolling a custom date key.

### 11.5 When meta becomes scope creep

Flag as out of scope for a single-session build (move to Cut list) when:

- the unlock tree exceeds **20 nodes**, or
- the meta layer needs a dedicated shop/tree scene beyond `MenuScene`
  (**NEW: needs a `MetaScene`** plus its own save-schema section in the PRD).

A daily-seed layout and a currency/unlock counter fit in one session; a
full talent-tree UI does not.

---

## 12. Parallel build methodology

### 12.1 The 5 layers

| Layer | Owns | Depends on | Produces |
| --- | --- | --- | --- |
| Combat core | Player/enemy entity classes, `core/damage.ts` wiring, `core/stats.ts` wiring, collision (§10.3) | Interface contract only | Working hit/death loop against placeholder content |
| Content/data | `data/enemies.ts`, `data/upgrades.ts`, `data/waves.ts` (and `data/units.ts` if needed) | Interface contract only | Populated, typed data tables matching §6's volume targets |
| UI/meta | `ui/cards.ts`, `ui/bars.ts`, HUD layout (§7), `core/progression.ts` wiring | Interface contract only | Draft flow, HP/XP bars, meta save read/write |
| Level/systems | `core/run.ts` `RunDirector`, `core/grid.ts` `NavGrid` (if pathing is needed), phase/wave sequencing (§1, §2) | Interface contract only | Phase clock driving waves from the content layer |
| Integration/balance | Wires all four layers into `src/scenes/game.ts`, runs the §5.5 dominant-strategy check, tunes `TUNING` | All four above | The playable, balanced build |

Layer files live where the family puts them: the core-mechanic layer owns
`src/slices/<family>/` (the starter scene + data the `--family <code>`
scaffold copied in) plus `src/objects/*`, and the verification layer owns
`src/sim/families/<family>.ts` — the family's bot/solver and its gate (§18).
A sixth layer (sim/verification) is added whenever the family's gate is a
generator validator rather than a play bot (B, G, H, and E track generation):
the generator and its validator are one ownership unit, because a generator
whose output nobody proved solvable is not content.

### 12.2 Interface-contract rule

Every cross-layer type — `StatKey` names, `WaveSpec`/`RunPhase` shapes,
upgrade ids, `Modifier.source` tags — is frozen in the PRD **before** any
layer starts building. A layer that discovers it needs a new shared type
mid-build raises it to the integrator rather than renegotiating with a
sibling layer directly; contracts do not change after the batch starts. The
full frozen-contract surface a PRD must lock before the batch starts: the
`TUNING` key list (§7 of the PRD template), the `StatKey` union, every event
name in `core/keys.ts`, and every content id set (enemy/upgrade/wave/unit
ids) — these four are the drift surface the integrator alone may edit
(§12.3). `src/data/art.ts` is a **generated** artifact
(`scripts/gen-art-registry.mjs`, owned by the art pipeline's output step) and
is never a workstream deliverable to hand-author or freeze as a contract.

### 12.3 File ownership

One file, one owning layer, stated explicitly in the PRD. Shared files
(`src/config.ts`, `core/keys.ts`) are edited only by the integration layer,
after the other four have landed — never mid-flight by two layers at once.
The integrator is the **only** editor of the frozen-contract surface named in
§12.2 (`TUNING` keys, `StatKey` union, `core/keys.ts` event names, content id
sets) once the batch starts; a layer that needs an addition there requests it
through the integrator, never edits it directly.

### 12.4 Why every layer skips build/lint/test until integration

Four layers editing concurrently means `npm run build`/`npm run typecheck`
will fail on any half-finished sibling's code, not on the running layer's
own mistake. Validating mid-flight produces false failures and blocks
agents on each other; each layer proves its own slice with a narrow smoke
check (e.g. the entity class instantiates, the data table type-checks in
isolation) and defers the project-wide build to integration.

### 12.5 Integrator's checklist

- [ ] Every `TUNING` key used by any layer exists exactly once, no
  duplicated definitions.
- [ ] `npm run typecheck` clean across all four layers' files together.
- [ ] Phase table (§1.1) values match between the level/systems layer's
  `RunDirector` config and the content layer's `WaveSpec` scaling.
- [ ] Upgrade pool size (§5.2) matches what the content layer actually
  shipped, not just what the PRD specified.
- [ ] `npm run sim -- --family <code>` passes every hard gate for the family
  (§18) and reports its soft-gate numbers — for A/D the per-lane win-rate
  spread ≤ 0.35 and decision cadence 10-14 (§5.5); for the other families the
  numbers named in that family's §18 row. Run at least once before claiming
  the build balanced, and re-run through the sim→TUNING→re-sim loop (§5.5, max
  3 iterations) if any gate fails.
- [ ] `node scripts/gen-art-registry.mjs --check` passes (art.ts matches the
  generated asset manifest).
- [ ] Full menu → run → (win/lose/extract) → retry loop played once in a
  browser end to end.

---

## 13. Vertical video framing for long runs (families A, D, E)

### 13.1 What stays visible in the top third

Top third = y 0-427 (of 1280). At arm's length, this is the region a viewer
reads without leaning in. HP bar, run timer/phase name, and (during a boss)
the boss HP bar must render here or immediately below it (§7.2) and must
never be covered by a modal (§7.3, §8.4).

### 13.2 Turning a 5-10 minute run into a 30-60s clip

A run this long is not filmed in full; the deliverable is a highlight reel
built from moments already instrumented by the run's own events:

| Highlight moment | Trigger | Typical timestamp in a 480s run |
| --- | --- | --- |
| Level-up | Any `xpToLevel` threshold crossed (§3.2) | Recurring, every 35-45s |
| Elite kill | First elite death | ~150s (§1.2) |
| Near-death | `Health.ratio` drops below 0.15 and recovers | Late/Climax phase, situational |
| Boss fight | Boss spawn through boss death | 420s-450s (§1.2) |
| Screen-clear | A wave's last enemy dies with ≥10 enemies cleared in the preceding 3s | Late/Climax phase |

### 13.3 Clip beat structure (30-60s output, recommended 45s)

| Beat | Window (s) | Content |
| --- | --- | --- |
| Hook | 0-5 | A level-up or elite-kill moment, already mid-action |
| Escalation | 5-35 | The boss-fight climb, cut to keep only hits/near-misses |
| Payoff | 35-45 | Boss death + reward burst (`countTo`, `sfxArp`) |
| Tag | 45-50/55 | Final score/level readout, run outcome (win/lose/extract) |

### 13.4 On-screen readouts needed sound-off

A viewer watching without audio must be able to follow the fight from HUD
alone: HP bar depletion/recovery, boss HP bar during Climax, the big `+N`
`floatText` on kills, and visible `shake`/`flash` on hits. If any of those
four is missing, the clip is unwatchable muted — the exact failure mode
`AGENTS.md`'s "readable with sound off" rule exists to prevent, scaled to a
480s run instead of a 3-second opening.

---

## 14. Anti-patterns

| # | Mistake | Corrective rule |
| --- | --- | --- |
| 1 | Upgrade pool smaller than the choices offered per draw | Pool ≥ 4x choices per event; 12 minimum for 3-choice draws (§5.2) |
| 2 | Bullets/enemies spawned unpooled above 50/min | Mandatory `Pool`/`SpritePool` above that rate (§10.1) |
| 3 | Unreadable 6px HP bars | Minimum bar 8px tall x 48px wide via `ui/bars.ts` (§7.2) |
| 4 | Naive O(n²) overlap checks above 150 entities | `SpatialHash` broad-phase required past 150 (§10.3) |
| 5 | Meta grind requiring 150+ runs to the first unlock | Retune `cost()` base/growth so first unlock lands within 2-3 runs (§11.3) |
| 6 | Uncapped geometric difficulty curve with no ceiling | Cap at 3.2x via the fairness ceiling rule (§2.5) |
| 7 | Tilt/gyroscope controls on a portrait mobile game | Banned; use `Controls` tap/drag/swipe/hold only (§8.2) |
| 8 | Interactive elements placed under the bottom-220px `SAFE` zone but outside the button-sized allowance | Confine interaction to `SAFE`; anything in the bottom 220px must be a full-size button (§7.4) |
| 9 | Camera `shake` fired on every hit with 300 entities on screen | Suppress shake above 150 entities or 5 hits/frame; keep `flash`/`pop` only (§9.3) |
| 10 | `hitstop` stacked once per simultaneous kill during a screen-clear | Throttle to one `hitstop` call per 100ms scene-wide (§9.4) |
| 11 | Full-screen modal (`ui/cards.ts`) hides HP/timer entirely | Keep top-third HUD visible above the dim layer during any overlay (§7.3, §13.1) |
| 12 | One build lane dominates with no detection or counter-balance | Track win-rate/time-to-clear proxies; flag at 2σ or 15% faster clears (§5.5) |
| 13 | Flat XP thresholds (same cost every level) | Exponential `xpToLevel(level) = base*growth^level` so late levels feel earned (§3.2) |
| 14 | `MetaSave` shipped with no version field | Always version the save and provide a migration chain, never a silent reset without a fallback (§11.2) |
| 15 | Damage numbers spamming past 12/second at high entity counts | Aggregate simultaneous hits into one `floatText` (§9.2) |
| 16 | Content volume below the minimum viable count for the chosen run length | Hit §6's minimum-viable counts before shipping; scale by the §1.4 ratio for non-480s runs |
| 17 | Two parallel build agents editing `config.ts`/`keys.ts` simultaneously | One owner per file; other layers request additions through the integrator, not by editing directly (§12.3) |
| 18 | Run length outside the 5-10 minute band without rescaling phases/content | Scale phase boundaries (§1.4) and content volume (§6) by `targetRunSeconds/480` rather than reusing the 480s table unmodified |
| 19 | A 480s beat sheet written for a board, table, word or idle game | Use the family's §2 variant in `prd-template.md` (level curve / ramp table / economy curve), never the run beat sheet (§15, §16, §17) |
| 20 | Level difficulty tuned by rebuilding the board content instead of the move budget | Moves are the exponential dial; retune `k` moves over par first, content second (§15.2) |
| 21 | Generated levels shipped without a solver verdict | 100% solvability and the win-rate band are hard gates, not soft ones (§15.5, §18) |
| 22 | A family-J spec with two input verbs, a second HUD widget, or a retry longer than 2s | One mechanic, one verb, minimal HUD, sub-2s retry — that is the family's definition (§16.4) |
| 23 | Idle economy whose income growth matches or beats its cost growth | Keep `rate growth / cost growth` in 0.55-0.75 so the prestige offer is what breaks the wall (§17.2) |
| 24 | A ramp band easier than the band before it | All three ramp dials monotone; the ramp bot fails on any inversion (§16.1, §16.4) |
| 25 | A vague or brand-less casual pitch defaulted to match-3 swap | HYBRID DEFAULT (`SKILL.md` §Step 0): compose pattern I over a sort/block/merge/screw or J/F core; new match-swap titles succeed at ~0.8% |
| 26 | `npm run sim` run without `--family <code>` and called a balance proof | The family gate is the proof; a sim run with the wrong family's bot measures nothing (§18) |

---

## 15. Level-curve math (families B, G, H, and C-levels)

### 15.1 Win-rate is the difficulty currency

For a level-based family, difficulty is not a threat multiplier — it is the
probability that a competent player clears the level on the current attempt.
That number is the design surface, and every other dial exists to hit it.

| Level band | Target win-rate | Role |
| --- | --- | --- |
| L1-L3 | 95-99% | Onboarding; failure here is a defect, not difficulty |
| L4-L9 | 88-97% | Teaching band: one new element every 2-3 levels |
| L10 | 82-86% | First spike; first level where a special is required |
| L11-L19 | 74-88% | Main body |
| L20 | 66-72% | Second spike; booster-solvable gate |
| L21-L50 | slide 72% → 62-68%, spike every 10th | Long ramp |

- **Floor:** never below **55%** for a generated level. Below that the level
  reads as broken rather than hard and the retry loop stops converting.
- **Ceiling:** never above **99%** after L3. A level nobody can fail is not
  content.

### 15.2 Moves as the exponential dial

Each extra move above the solver's par reduces effective difficulty
exponentially — the Playrix-style practice this document standardises on:

`winRate(par + k) = 1 - (1 - w0) * d^k`, recommended `d = 0.62`, where `w0` is
the measured win-rate at par moves.

Worked at `w0 = 0.35` (a par-move board):

| k (moves over par) | 0 | 1 | 2 | 3 | 4 | 6 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| winRate | 0.35 | 0.60 | 0.75 | 0.85 | 0.91 | 0.96 | 0.985 |

The entire 66%-99% design band is **six moves wide**. Two consequences:

- Tune by moves first, content second. Changing `k` is a one-number edit that
  needs no re-solve; changing the board re-runs the generator and the solver.
- Inverse form, for hitting a target win-rate `w` from a measured `w0`:
  `k = ceil( log((1 - w) / (1 - w0)) / log d )`.

Time-limited variant (G's dice/deal timers, H's quiz timers): the same formula
with `k` = (seconds granted over par-time) / 5s.

### 15.3 Spike placement and the booster valve

- One spike every 10th level, its win-rate **8-14 points** below the
  neighbouring band.
- A spike must be **booster-solvable**: one booster from the PRD's booster set
  raises its win-rate by **≥ 15 points**. That is what makes a spike a valve
  instead of a wall.
- Never two spikes in a row; never a spike inside L1-L9.

### 15.4 Star thresholds

1 star = clear; 2 stars = ≥25% of the budget unspent; 3 stars = ≥45% unspent.
On the §15.2 curve a par+4 board yields 3-star rates around 20-30% — enough
headroom for saga-map star gates to pace unlocks without forcing replay
grinding.

### 15.5 Generation + solver loop

Levels are generated, then curve-fit:

1. Generate from the piece set with the band's element list.
2. Solve for par (the solver's minimum move count on that seed).
3. Set the budget to `par + k`, with `k` from §15.2 for the band's target
   win-rate.
4. Verify with the bot: solvability, then measured win-rate inside the band.

**100% solvability is a hard gate. The win-rate band is a hard gate.** Content
variety (elements per band, silhouette spread) is a soft gate.

---

## 16. Ramp math (family J and C-endless)

### 16.1 Dials and growth per score

Three dials, all monotone in score `s`:

- `speed(s) = min(speedCap, 1 + ks * s)`, recommended `ks = 0.009 /point`,
  `speedCap = 1.70`.
- `gap(s) = max(gapFloor, 1 - kg * s)`, recommended `kg = 0.0045 /point`,
  `gapFloor = 0.70` (gap scales spacing, window size and reaction time
  together).
- `spawnMs(s) = max(260, spawnBase * gap(s))` — the 260ms floor is the same
  readability floor as §2.5; below it, failure reads as RNG.

| s | 0 | 10 | 25 | 50 | 80 | 120 |
| --- | --- | --- | --- | --- | --- | --- |
| speed | 1.00 | 1.09 | 1.23 | 1.45 | 1.70 (cap) | 1.70 |
| gap | 1.00 | 0.96 | 0.89 | 0.78 | 0.70 (floor) | 0.70 |

Only these three dials ramp. Adding a fourth (new obstacle types on a timer,
layered modifiers) is what turns a 45s arcade loop into an unreadable one; new
content enters as the **twists** in §16.5, gated on score bands, not as a
continuous dial.

### 16.2 Median session length falls out of the hazard rate

Model: one obstacle every ~1.2s; per-obstacle death probability
`q(s) = min(0.10, q0 + kq * s)` with `q0 = 0.008`. Cumulative hazard to score
`n` is `H(n) = q0*n + kq*n²/2`; the median score solves `H(n) = ln 2 = 0.693`.

| `kq` | Median score | Median session (at 1.2s/obstacle) |
| --- | --- | --- |
| 0.0008 | 33 | 39s |
| 0.0011 (recommended) | 29 | 35s |
| 0.0016 | 25 | 30s |

Target the family window — **30-120s** for J, **45-150s** for C-endless — with
a median of **40-50s** (J) or **80-100s** (C-endless): long enough that a run
has a shape, short enough that "one more" costs nothing. `kq` is the
single knob for it — do not chase the median by editing `ks`/`kg`, which change
what the game feels like rather than how long it lasts.

### 16.3 Near-miss frequency

A near miss is clearing an obstacle within the fail margin (recommended: 12px
or 120ms of the fail condition). It is this family's entire tension signal, so
it is instrumented and juiced, not merely logged.

| Band (from the PRD's §2C ramp table) | Target near-misses |
| --- | --- |
| Learn | ~0 per 10s |
| Flow | 1 per 10s |
| Pressure | 2-3 per 10s |
| Edge | 4-5 per 10s |

Cap near-miss feedback at **1 per 400ms** (§9's spam discipline); above that
the signal stops meaning "that was close".

### 16.4 Monotonicity and retry latency

- **Monotonicity:** every dial moves in one direction only, and no band is
  easier than the band before it. The ramp bot fails the build on any
  inversion.
- **Retry:** fail → playable again in **under 2s**. Recommended budget: 350ms
  fail juice, 250ms fade, restart on the next tap. No interstitial, no
  confirmation, no menu round-trip — the retry loop *is* the retention
  mechanic for a 35s session.

### 16.5 One mechanic, one verb, two twists

The family's content budget is **1 mechanic + 1-2 twists + 10-15 skins**.
A twist enters at a fixed score band (see §2C's Pressure and Edge bands),
changes one rule (moving obstacle, mirrored input, shrinking window), and never
adds an input verb. A J spec with two input verbs is a defect (§14 #22).

---

## 17. Idle economy math (family F)

### 17.1 Cost growth

`cost(n) = base * growth^n`. The classic band is `growth` **1.07-1.15**:
1.07 generous, **1.10 recommended default**, 1.15 grindy. Cumulative cost at
`base = 10`:

| growth | to level 10 | to level 25 | to level 50 |
| --- | --- | --- | --- |
| 1.07 | 138 | 632 | 4,066 |
| 1.10 | 159 | 983 | 11,640 |
| 1.15 | 203 | 2,128 | 72,180 |

Growth above 1.15 pushes the late levels of a single generator past what one
prestige cycle can fund, which reads as a broken wall rather than a goal.

### 17.2 Rate growth vs cost growth

Income per generator level must grow **slower** than its cost, or the economy
solves itself and the prestige offer has nothing to fix:
`rate(n) = baseRate * n` (linear) against exponential cost.

Ratio rule: `rate growth per purchase / cost growth per purchase` in
**0.55-0.75**. Under 0.55 the game stalls before the prestige window; over 0.75
the player never needs to prestige.

### 17.3 Time-to-next-purchase and the dead-air rule

`ttnp(n) = cost(n) / income(n)`. Design targets (the PRD's §2D curve): 3-8s in
the first minute, 15-45s at 1-5 min, 45-90s at 5-12 min.

**Dead-air rule: no gap over 90s between affordable purchases in the first 10
minutes.** This is a hard gate in the family's economy sim — a 3-minute stare
at a filling bar in the first session is the single most common idle-game
failure mode.

### 17.4 Prestige multiplier sizing

`mult(p) = 1 + kp * sqrt(totalEarned(p) / T)`, sized so that cycle `p+1`
reaches cycle `p`'s endpoint in **20-35%** of the time — i.e. **2.5-4x**
effective income per prestige.

| Cycle | Target duration |
| --- | --- |
| 1 (first prestige) | 15-30 min |
| 2 | 6-10 min |
| 3 | 4-6 min |
| 4+ | flattens — add a **second prestige layer** rather than inflating the first |

A first prestige later than 30 min loses the player before the mechanic that
makes the family work is ever seen; earlier than 15 min and the reset feels
like it cost nothing.

### 17.5 Offline progress

- Rate: **40-60%** of active income (never 100% — full-rate offline removes the
  reason to open the game).
- Cap: **8 hours** recommended.
- Return screen: one `countTo` payout, one tap to collect, no modal chain.

---

## 18. Family → verification map

Every family's balance proof is `npm run sim -- --family <code>`, driven by the
bot in `src/sim/families/<code>.ts`. The hard gates below fail the build; the
soft gates are reported and reviewed.

| Code | Director | Sim bot | Hard gates | Soft gates |
| --- | --- | --- | --- | --- |
| A | `RunDirector` | arena bot | Run completable; win and loss both reachable; 300-entity budget held at 60fps | Per-lane win-rate spread ≤ 0.35; decision cadence 10-14 (§5.5); `firstUpgradeS` ≈ 45 |
| B | `LevelDirector` | board solver | 100% of generated levels solvable; every level's win-rate inside its §15.1 band; spikes booster-solvable (+≥15 points) | 3-star rate 20-30%; element variety per band |
| C | `LevelDirector` / `RampDirector` | level bot / ramp bot | Levels: as B (20-45s each). Endless: median session inside 45-150s, monotone dials | Near-miss rate per band (§16.3) |
| D | `RunDirector` (fight-indexed) | fight bot | Every fight in the chain winnable from a legal deck/board; final fight loseable | Win-rate spread ≤ 0.35 across named routes |
| E | `LapDirector` | lap bot | Every track completed inside the target lap time; every checkpoint reachable; no geometry trap | Rival-tier finish spread; drift-line usage |
| F | none in the core loop (`LevelDirector` for milestone chapters) | economy sim | First prestige 15-30 min; no dead-air gap > 90s in the first 10 min; cycle 2 at 20-35% of cycle 1 | `ttnp` curve matching §17.3; offline payout sanity |
| G | `LevelDirector` | deal/board validator | Every generated deal solvable; dice-board loop terminates; tile-event payouts inside the economy budget | Deal-length distribution; collection completion pace |
| H | `LevelDirector` | content validator | Every question/word entry validated against its answer key; no duplicates; no unanswerable entry | Category balance; difficulty-tier spread |
| J | `RampDirector` | ramp bot | Median session 30-120s; monotone difficulty (no band inversion); retry latency < 2s | Near-miss rate per band; skin coverage 10-15 |
| I | the core's director | the core's bot | the core family's hard gates, unchanged | plus meta-kit pacing: star/collection gates reachable in the sessions §11.3 predicts |
