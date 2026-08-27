# PRD template (portrait browser game, any of the ten families)

Fill every section. No placeholders, no "TBD", no adjective without a number.
Target length 500-900 lines: this document is the only input 4-6 parallel build
agents get. Write it to `games/<slug>/PRD.md`.

Sections marked **variant** have one version per family — write the one your
family code selects and delete the others. Family codes and their fixed
decisions come from `../SKILL.md` §Step 0/§Step 0b.

---

```markdown
# <Game Title>

One-sentence pitch: <what the player does, what threatens or constrains them,
what makes one session different from the last>.

- Slug: `<slug>`
- Family: `<A|B|C|D|E|F|G|H|J>` <family name> (+ `I` composition pattern if used)
- Subgenre: <subgenre from the family's playbook>
- Session shape: <e.g. "90s goal levels, 4-8 per sitting" | "480s run" | "45s endless run">
- Director: `<RunDirector | LevelDirector | RampDirector | LapDirector>` (`core/session.ts`; family F: none in the core loop, `LevelDirector` for milestone chapters)
- Input profile: `<joystick | tap | swipe | drag>` (+ secondary: <UI buttons/overlays>)
- Camera: `<follow-arena | static-board | side-follow | track>`
- Meta shape: `<shop | saga-map | collections | prestige tree>` (+ meta-kit layers used)
- Slice: `src/slices/<family>/`
- Frame: portrait 720x1280, SAFE top 140 / bottom 220 / side 40
- Built from: `template/` (Phaser 4 + Vite + TS)
- Peak entity budget: <N> live sprites at 60fps

## 1. Fantasy, tone, references

3-5 sentences: who the player is, the setting, the emotional register. One named
reference game for feel, one for systems, and one thing this game deliberately
does differently.

**Naming lexicon:** 10-15 theme words/morphemes drawn from the fantasy above
(e.g. for a volcanic-forge setting: `ember, cinder, forge, slag, brand, coal,
kiln, ash, molten, temper, anvil, quench`). Every named entity in §5's content
tables (enemies, upgrades, pieces, generators, vehicles, question categories)
draws its name from this lexicon — this is what keeps 40+ generated names
feeling like one game's vocabulary instead of a random word generator.

## 2. Session architecture — **variant** (write exactly one of 2A-2E)

### 2A. Timed run beat sheet — families A and D

One row per phase of the reference run (`RunDirector`; D indexes phases by
fight/node instead of seconds and says so in the Window column):

| Phase | Window | Threat | Player power | Player experience |
| --- | --- | --- | --- | --- |
| Onboarding | 0-30s | 1 archetype, low density | base stats | learn the verb |
| Build-up | 30-120s | 2-3 archetypes | 2-3 upgrades | first real pressure |
| Escalation | 120-240s | +elite at 150s | 5-6 upgrades | build identity forms |
| Peak | 240-450s | max density, elite at 330s | 8-10 upgrades | power fantasy window |
| Finale | 450-480s | boss | full build | win or die |

Then: how the run ends (win / death / extraction), what the player sees, and
what carries into the meta layer.

### 2B. Level curve — families B, G, H and C-levels

`LevelDirector`. The curve is expressed as a **target win-rate band per level**
(the family's difficulty currency, `design-heuristics.md` §15); the move or
time budget is the dial that hits it. Every spike level is marked; a spike is
a deliberate booster-pull moment, not an accident.

| Level | Goal | Moves/time budget | Target win-rate band | Spike | New element |
| --- | --- | --- | --- | --- | --- |
| L1-L3 | tutorial goal, single objective | generous (+8 over solver par) | 95-99% | | the core verb |
| L4-L5 | 2 objectives | +6 over par | 93-97% | | piece type 4 |
| L6-L9 | 2 objectives + blocker | +4 over par | 88-93% | | first blocker |
| L10 | 3 objectives + blocker | +1 over par | 82-86% | **spike** | first special required |
| L11-L15 | 3 objectives | +3 over par | 80-88% | | piece type 5-6 |
| L16-L19 | 3 objectives + 2 blockers | +2 over par | 74-82% | | specials combo |
| L20 | boss-board (all objectives) | par | 66-72% | **spike** | booster-solvable gate |
| L21-L50 | rotate the L11-L20 shape | par +0..+3 | slide 72% → 62-68% | every 10th | 1 new element per 5 levels |

- Solver par: the move count the `npm run sim -- --family <code>` board solver
  needs on the level's seed; every budget in the table is stated as an offset
  from it, never as a raw number pulled from nowhere.
- Fail state: moves/time exhausted with the goal unmet. Retry cost, lives and
  booster offer are specified in §9.
- Star rule: 1 star = clear, 2 = clear with ≥25% of the budget unspent, 3 =
  ≥45% unspent (or the family's playbook equivalent).

### 2C. Ramp table — family J and C-endless

`RampDirector`. No win state; the curve is intensity vs score/time toward a
median session target.

| Band | Trigger (score or t) | Intensity dial values | Near-miss frequency | Player experience |
| --- | --- | --- | --- | --- |
| Learn | 0-5 (or 0-8s) | speed 1.00x, gap 1.00x, spawn 1.00x | ~0/10s | cannot lose without trying |
| Flow | 5-20 | speed 1.15x, gap 0.92x | 1/10s | the loop clicks |
| Pressure | 20-45 | speed 1.35x, gap 0.82x, +twist A | 2-3/10s | first genuine deaths |
| Edge | 45-80 | speed 1.55x, gap 0.74x, +twist B | 4-5/10s | personal-best territory |
| Cap | 80+ | speed 1.70x (hard cap), gap 0.70x (floor) | 5/10s | difficulty holds, score keeps counting |

- Median session target: **<45>s** (family window 30-120s), verified by the
  ramp bot (§19).
- Death → playable again in **under 2s**, one tap, no interstitial.
- Monotonicity: every dial moves in one direction only; no band is easier than
  the band before it (the sim gate fails on any inversion).

### 2D. Economy curve — family F

No `SessionDirector` drives the core loop — the economy runs continuously and
`LevelDirector` is used only for milestone chapters (`casual-playbooks.md`
§Family frame). The beat sheet is the *purchase cadence*, not a clock, and the
"progress" the HUD shows is the fraction of the way to the next prestige
threshold.

| Stage | Elapsed (first cycle) | Time-to-next-purchase | Unlocked | Player experience |
| --- | --- | --- | --- | --- |
| Onboarding | 0-60s | 3-8s | generators 1-2 | every tap buys something |
| Ramp | 1-5 min | 15-45s | generators 3-5, first manager | automation replaces tapping |
| Mid | 5-12 min | 45-90s | generators 6-9, upgrade tier 2 | choosing *which* number to grow |
| Prestige window | 15-30 min | 90s (ceiling) | prestige offer | reset for the multiplier |
| Cycle 2+ | — | same shape, ~3-5x faster | prestige upgrades | the multiplier is felt in 60s |

- Cost growth: `cost(n) = base * growth^n`, `growth` in **1.07-1.15**
  (`design-heuristics.md` §17); state base and growth per generator.
- Dead-air rule: no gap over **90s** between affordable purchases in the first
  10 minutes — the idle-economy sim gate fails on it.
- First prestige: **15-30 min**; prestige multiplier sized so cycle 2 reaches
  cycle 1's endpoint in 20-35% of the time.
- Offline progress: rate, cap (hours), and the return-to-game payout screen.

### 2E. Race structure — family E

`LapDirector`.

| Element | Value |
| --- | --- |
| Laps per race | 3-5 |
| Target lap time | <40>s (race 120-200s, 2-4 races per sitting) |
| Checkpoints per lap | 3-5, each a rescue point on crash |
| Rival count and AI tiers | <5> rivals across <3> tiers with named speed/aggression values |
| Escalation across a session | race index raises rival tier and track complexity per the phase table |
| Fail/finish | finish line crossed; placement + lap-time deltas are the result |

## 3. Controls

| Input | Effect | Template hook |
| --- | --- | --- |
| Drag | move the player / drag a piece | `Controls.onDrag` |
| Tap | primary verb (swap, jump, buy, place, answer) | `Controls.onTap` |
| Keyboard WASD/arrows | same as drag/steer | `controls.axisX/axisY` in `update` |
| Tap bottom button | ability / booster / build | `Button` in `src/ui/button.ts` |

- Only the family's input profile (`../SKILL.md` §Step 0b) is primary; family J
  has exactly one input verb.
- Dead zones, clamping, forbidden regions (pixels).
- Behaviour during overlays (session paused via `SessionDirector.pause()`?
  field/board visible?).
- Keyboard parity for every touch interaction.
- Banned: tilt, multi-touch gestures, anything needing two thumbs.

## 4. Systems map

One row per system. `Module` must be a real template module, a file in the
family slice, or `NEW: <path> — <one-line spec>`.

| System | Module | Responsibility | Notes |
| --- | --- | --- | --- |
| Session driver | `core/session.ts` | `SessionDirector`: `update/elapsedMs/ended/outcome/progress/pause/resume` | family director named in the header |
| Family slice | `src/slices/<family>/` | starter scene + data for this family | scaffolded by `--family <code>` |
| Stats & modifiers | `core/stats.ts` | player/enemy/unit stat resolution | keys listed in §7 |
| Damage & health | `core/damage.ts` | hits, crits, DoT, i-frames | A/D/E only |
| Pooling | `core/pool.ts` | bullets, enemies, pieces, particles | mandatory above 50 spawns/min |
| Broad-phase | `core/spatial.ts` | hit queries at 200+ entities | cell size <N> |
| Grid / board | `core/grid.ts` | board addressing, flow-field pathing | grid <cols>x<rows>, tile <N>px |
| Meta save | `core/progression.ts` | currency, unlocks, stars, collections | schema in §10 |
| Choice UI | `ui/cards.ts` | pick 1 of 3 / booster tray / draft | pool in `data/upgrades.ts` |
| Bars | `ui/bars.ts` | HP/XP/goal/lap/progress bars | |

## 5. Entities and content tables

### 5.0 Content volume floor — **variant** (this family's row is a gate, not a target)

| Family | Content atoms and minimum / comfortable volumes |
| --- | --- |
| A | Enemy archetypes 4/8 · upgrades 12/24 · bosses 1/3 · waves 6/16 |
| B | **20+ generated levels / 50+** · 6+ piece types · 3+ specials · 2+ boosters · 3+ blocker types |
| C | 12/25 levels (or 8/20 terrain segment types if endless) · 5/10 hazard archetypes · 4/8 power-ups |
| D | Cards 18/40 · enemy types 5/10 · relics 5/12 · map nodes 8/16 · bosses 1/2 |
| E | Vehicles 3/8 · tracks 3/8 · rival AI tiers 3/5 · upgrade lines 4/8 |
| F | **8-12 generators** · **10-20 upgrades** · **1 prestige layer** (2 comfortable) · 6/12 managers |
| G | 20+ generated deals/boards · **3+ tile event types** (dice-board) or 1/3 deal variants (solitaire) · 2/5 collection sets |
| H | **100+ trivia questions** or **200+ word puzzles**, generated **and validated** against an answer key · 5/10 categories |
| J | **1 mechanic + 1-2 twists** · 3/6 obstacle variants · **10-15 collectible skins** |

Below the minimum column the back half of the session repeats what the front
half already showed — a PRD under it is a defect, not a scope decision.

### 5.1 Player / avatar / board

| Stat | Base | Unit | Notes |
| --- | --- | --- | --- |
| `maxHp` | 100 | hp | A/C/D/E; omit for B/F/G/H/J |
| `damage` | 10 | per hit | |
| `attackMs` | 600 | ms | |
| `moveSpeed` | 330 | px/s | |
| `critChance` | 0.05 | 0-1 | |
| `critMul` | 2.0 | multiplier | |
| `pickupRadius` | 90 | px | |

Board/table/word families replace this table with the board spec: grid size
(cols x rows), tile px, spawn distribution per piece type, gravity/refill rule,
and the deterministic seed source (`Rng`).

### 5.2 Primary atom table (enemies / pieces / units / generators / vehicles / questions)

Every entry complete. `Texture` from `core/keys.ts` or `NEW`. `Flavor name`
and `Flavor desc` are mandatory: an evocative name (≤18 chars, drawn from
§1's naming lexicon) and a one-line description tying the entry to the
fantasy — never the raw stat-block id.

| id | Flavor name | Flavor desc | Texture | Size px | Key stats | Behaviour/effect | Value | Tint | First seen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| swarm | Cinder Mote | A drifting ember that swarms toward warmth and light | disc | 34 | hp 12, dmg 6, spd 120 | chase | 1 xp / 1 coin | `PALETTE.bad` | 0s |
| … | | | | | | | | | |

Per-family required columns:

| Family | Required extra columns |
| --- | --- |
| B | match group, spawn weight, special it creates, blocker interaction |
| F | `baseCost`, `growth`, `baseRate`, manager cost, unlock threshold |
| G | tile event type, payout/penalty, frequency per board loop |
| H | category, difficulty tier, answer key source, validation rule |
| J | obstacle variant, spawn band from §2C, skin id it belongs to |
| E | top speed, accel, grip, drift threshold, upgrade line |

### 5.3 Upgrades / specials / boosters / cards

`Flavor name` and `Flavor desc` are mandatory, same rule as §5.2 — no raw
stat-block id or generic label ("dmg_up", "Sharpened") stands in for a name.

| id | Flavor name | Flavor desc | Rarity | Effect (modifiers) | Stack limit | Synergy tag |
| --- | --- | --- | --- | --- | --- | --- |
| dmg_up | Quenched Edge | A blade cooled in forge-oil, biting deeper on every swing | common | `damage +4` | 5 | offense |
| … | | | | | | |

Pool size: <N> (must be ≥ 4x the number of choices offered at once).
Choices offered per event: <N>. Rarity weights: common <x> / rare <y> / epic <z>.
Board families additionally list each special's creation rule (what shape/count
creates it) and its clear pattern, and each booster's price and effect.

### 5.4 Session content — **variant**

- A/D: `data/waves.ts` — `at` seconds (or fight index), spawn ids and counts,
  `everyMs`, label (elite/boss). ~16-20 entries for a 480s run.
- B/G/H: the generated level/deal/puzzle set — generator parameters per level
  band, seed policy, and the validator that proves 100% solvability plus the
  §2B win-rate band.
- C/J: the terrain/obstacle segment kit with each segment's spawn band from
  §2C and its difficulty weight.
- E: track definitions — segment sequence, checkpoint positions, surface
  types, target lap time per track.
- F: the generator/upgrade unlock ladder with thresholds and the prestige
  threshold formula.

## 6. Progression math — **variant**

- A/D: XP curve formula + worked thresholds for levels 1-12 and the level the
  player should reach at 120s / 240s / 480s; difficulty scaling per phase with
  worked HP/damage/spawn values at 60/180/300/480s; power vs threat ratio per
  phase and the power-fantasy window (seconds).
- B/G/H/C-levels: solver par per level band, move budget offsets, and the
  resulting win-rate band (§2B) with the difficulty formula from
  `design-heuristics.md` §15 (each extra move above par reduces effective
  difficulty exponentially — state the constant used).
- C-endless/J: the ramp formulas (`speed(score)`, `gap(score)`,
  `spawnMs(score)`) with their caps/floors, plus the worked median session
  length they produce (§16).
- E: rival speed per tier per race index, lap-time targets, catch-up rules
  (bounded — state the cap).
- F: `cost(n)`, `rate(n)`, income integral, time-to-next-purchase at stages
  from §2D, prestige multiplier formula and worked cycle-2 speedup (§17).

## 7. Balance table → `TUNING`

Every key the code reads, with units. Maps 1:1 onto `TUNING` in `src/config.ts`.
Group by system (player/board, threat, economy, curve, feel). Minimum 25 keys;
every key that appears in code must appear here.

| Key | Value | Unit | Note |
| --- | --- | --- | --- |
| `player.moveSpeed` | 330 | px/s | |
| `curve.movesOverPar` | 4 | moves | per level band (§2B) |
| `ramp.speedCap` | 1.70 | multiplier | hard cap (§2C) |
| `economy.costGrowth` | 1.12 | multiplier | per generator level (§2D) |
| … | | | |

## 8. Variety proof

At least three named routes, per the family's rule (`../SKILL.md` rule 8):

| Route | What enables it | Playstyle | Why it is not dominated |
| --- | --- | --- | --- |
| Glass cannon | crit + damage + attack speed | high risk | dies to swarm density |
| Cascade farmer | specials chained on the bottom row | slow, high-scoring | fails the 2-objective spike levels |
| … | | | |

Plus: how the choice moment guarantees no dead option (reroll rules, banned
duplicates, guaranteed category coverage, board-shuffle-on-no-moves).

## 9. Economy

- In-session currency: sources, income per minute, sinks and prices.
- Meta currency: earned per session (win vs loss), `cost(level) = base *
  growth^level` with base/growth and the resulting grind length in sessions
  (worked numbers).
- Casual families: lives/energy gate (count, refill minutes), booster prices,
  the retry offer after a fail, and the star→gate thresholds on the saga map.
- Idle family: prestige currency conversion rate and what it buys.
- Inflation control: caps, diminishing returns, price scaling.

## 10. Meta progression and save schema

```ts
interface MetaSave {
  version: 1;
  currency: number;
  unlocks: string[];
  upgrades: Record<string, number>;
  levels: Record<string, { stars: number; best: number }>;   // saga-map families
  collections: Record<string, string[]>;                      // collection families
  prestige: { count: number; multiplier: number };            // family F
  stats: { sessions: number; wins: number; bestScore: number; bestTimeMs: number };
}
```

Keep only the fields the meta shape uses; delete the rest rather than shipping
dead schema.

- Meta upgrade / star-gate / collection-set list with maxLevel, cost params,
  and the `Modifier` or unlock each level grants.
- Unlock pacing: sessions to first unlock, sessions to full clear.
- Migration rule for `version` bumps.

## 11. Art direction

- Palette: exact hex for every `PALETTE` key used.
- Shape language: which template primitives; any new ones with the `Graphics`
  calls needed in `core/textures.ts`.
- Board/table/word families: the piece-face set — one legible silhouette per
  piece type at 96px, distinguishable by shape as well as hue.
- Background, motion identity (2-3 signature motions), typography (`TEXT` presets).
- Colour coding: danger / reward / neutral / player, tied to palette keys.

## 12. Audio

Only `sfx()` names that exist: `ui tap pickup combo jump hit die levelup whoosh`.
New sound = a `Voice` entry spec (wave, freq, freqEnd, attack, decay, gain, noise).

| Event | sfx | Params | Voice cap |
| --- | --- | --- | --- |
| Enemy hit / piece clear | `hit` | volume 0.5 | max 6/s |
| … | | | |

## 13. Juice table

Every gameplay event: at least one visual and one sound, with values and spam caps.

| Event | Visual | Values | Sound | Cap |
| --- | --- | --- | --- | --- |
| Level up / cascade step | `flash` + `burst` + rising pitch | `accent`/160ms, 24 particles | `levelup`/`combo` | 8 steps/chain |
| Enemy death / piece pop | `burst` + `floatText` | 8 particles | `hit` | 8 floatTexts/s |
| Player hit / level fail | `shake` + `flash` + `hitstop` | 0.012/180ms, 120ms, 60ms | `die` | no shake above 200 entities |

## 14. UI and HUD (pixel plan)

- HUD inventory with coordinates in the 720x1280 frame, respecting SAFE.
- Board families: the board's rect inside the playfield band, tile px at the
  chosen grid size, and proof it needs no scrolling.
- Bottom bar: buttons, sizes (min 88px), spacing.
- Overlays: which pause the session, how the field stays visible, how they are
  dismissed. The level-complete overlay (goal, stars, next) is mandatory for
  saga-map families.
- Menu, pause, results, saga-map and meta screens: copy and element list.

## 15. Performance plan

- Peak counts: entities, projectiles, pieces in flight, particles, texts, tweens.
- What is pooled and with which pool sizes.
- `SpatialHash` cell size and query radius; collision strategy per entity count.
- Per-frame prohibitions (Graphics redraw, new tweens, text churn).
- Verification: fps + entity counter readout in `?debug`.

## 16. Build plan (parallel workstreams)

4-6 workstreams that can run simultaneously. One owner per file — no shared files.

| Workstream | Owns files | Delivers | Depends on contract |
| --- | --- | --- | --- |
| Core mechanic | `src/slices/<family>/*`, `src/objects/*` | the family's verb + rules loop | §16.1 |
| Content data | `src/data/*.ts` | atoms, upgrades, levels/waves/tracks | §16.1 |
| UI/meta | `src/ui/*.ts`, `src/scenes/meta.ts`, `src/scenes/map.ts` | HUD, overlays, saga map, results, shop | §16.1 |
| Director/generation | `src/systems/director.ts`, generator + validator | session driver, level/board/track generation | §16.1 |
| Sim/verification | `src/sim/families/<family>.ts` | the family bot/solver and its gate | §16.1 |
| Integration/balance | `src/scenes/game.ts`, `src/config.ts` | wiring, TUNING, playtest | all |

### 16.1 Interface contracts (real TypeScript)

```ts
// Agreed up front; no mid-flight renegotiation.
export interface SessionDirector {
  update(deltaMs: number): void;
  readonly elapsedMs: number;
  readonly ended: boolean;
  readonly outcome: { won: boolean; reason: string } | null;
  readonly progress: number; // 0..1
  pause(): void;
  resume(): void;
}

export interface EnemyDef { id: string; texture: string; size: number;
  stats: { maxHp: number; damage: number; moveSpeed: number; xp: number; currency: number };
  behaviour: 'chase' | 'orbit' | 'shoot' | 'charge' | 'split'; tint: number; }

export interface SpawnRequest { id: string; x: number; y: number; difficultyMul: number; }
export type SpawnFn = (req: SpawnRequest) => void;

export interface CombatApi { damageEnemy(id: number, amount: number, crit: boolean): void;
  damagePlayer(amount: number): void; }
```

Replace/extend the domain contracts with the family's own (board move + result,
level def + solver verdict, generator params, ramp dial set, generator/prestige
economy state, question + answer key) — `SessionDirector` is fixed and shared.

These contracts **must also freeze the design-heuristics §12.2 drift surface**:
the full `TUNING` key list (§7), the `StatKey` union, every event name in
`core/keys.ts`, and every content id set (atom/upgrade/level/track ids). The
integrator (Integration/balance workstream above) is the **only** editor of
that surface once the batch starts — every other workstream requests an
addition through the integrator rather than editing `src/config.ts` or
`core/keys.ts` directly (§12.3). `src/data/art.ts` is a **generated**
artifact (`scripts/gen-art-registry.mjs`, produced by the art pipeline's
integration step) and is never a workstream deliverable to hand-author.

Integration order: contracts → data + core mechanic + director in parallel →
integrator wires `GameScene` → balance pass driven by the family sim gate.

### 16.2 Integrator checklist

- [ ] `npm run build` clean (tsc + vite).
- [ ] Full loop: menu → session → mid-session decision → win/lose → results →
  meta/map → retry.
- [ ] All numbers live in `TUNING`; no inline balance values.
- [ ] Save round-trips and migrates.
- [ ] 60fps at peak entity count (`?debug` readout).
- [ ] Every juice-table row observed once in a real session.

## 17. Cut list (not now)

Minimum 5 excluded features with the reason. An empty cut list means the scope is
unbounded — do not ship the PRD.

## 18. Assumptions

Every deferred decision with the value chosen. One line each (interactive
mode); in `auto` mode every axis's `Auto rule:` outcome, one line each in
`axis → chosen value — one-line rationale` form. The family classification and,
if pattern I was used, the HYBRID DEFAULT rationale (with its numbers) are the
first two entries.

## 19. Acceptance criteria

- [ ] `npm run verify` passes: typecheck + `npm run sim -- --family <code>`
  gates + `node scripts/gen-art-registry.mjs --check` + every
  `src/sim/kits/*.selftest.ts`.
- [ ] The family gate passes (`src/sim/families/<family>.ts`):
  - A/D: arena/fight bot — per-lane winrates, `firstUpgradeS`, decision
    cadence for every named route (§8); win-rate spread ≤ 0.35.
  - B (and G/H generated sets): board solver — **100% of generated levels
    solvable**, and each level's measured win-rate inside its §2B band.
  - C-endless/J: ramp bot — **median session inside the family window**
    (J: 30-120s) and a **monotone** difficulty curve with no band inversion.
  - E: lap bot — completes every track inside the target lap time, no
    geometry trap, every checkpoint reachable.
  - F: economy sim — **first prestige in 15-30 min**, **no dead-air gap over
    90s in the first 10 minutes**, cycle 2 reaching cycle 1's endpoint in
    20-35% of the time.
  - H: generator validation — every question/word entry validated against its
    answer key; no duplicate, no unanswerable entry.
- [ ] Browser-bot loop completed with a screenshot at each state: menu →
  session → mid-session decision → pause → win/lose → retry.
- [ ] A full session is completable at the §Session-shape target; win and loss
  (or, for F, the prestige offer) both reachable.
- [ ] Primary verb works with touch and keyboard; J uses exactly one verb.
- [ ] Content tables match §5.0's minimum column exactly or exceed it, every
  entry carries a Flavor name and description (§5).
- [ ] The family's variety proof holds (§8): 3 named routes, none dominant.
- [ ] Meta save persists, migrates, and visibly changes the next session.
- [ ] 60fps at <N> entities; no unpooled hot spawns.
- [ ] Every juice-table event produces its visual and sound.
- [ ] Nothing interactive under the bottom 220px except full-width controls.
- [ ] Retry latency measured: J/C-endless under 2s from fail to playable.
- Advisory only, not a gate: a muted 30s clip of the session should read as a
  game with escalating stakes.
```

---

## Definition of done for the PRD itself

Refuse to hand off until all hold:

1. Sections 1-19 present, no placeholder text; the header names family,
   subgenre, director, input profile, camera, meta shape and slice.
2. §2 contains exactly one variant (2A-2E), the one the family selects — a PRD
   with a 480s beat sheet for a board or idle game is a defect.
3. Content tables meet §5.0's minimum column for the family.
4. Balance table has ≥ 25 keys, every key with a unit.
5. §6's family formulas are present with worked values (A/D at
   60/180/300/480s; B/G/H per level band; C-endless/J at the §2C band edges;
   E per rival tier; F at the §2D stages).
6. ≥ 3 named routes with a non-domination argument each.
7. Build plan has 4-6 workstreams, one owner per file, real TS contracts, and
   the `SessionDirector` contract verbatim.
8. Juice table covers every gameplay event named anywhere in the PRD, with caps.
9. UI plan gives pixel coordinates inside SAFE and ≥ 88px tap targets; board
   families prove the board fits without scrolling.
10. Performance plan states peak counts and pooling mandates.
11. Cut list ≥ 5 entries; Assumptions lists every deferred decision, with the
    family classification (and the HYBRID DEFAULT rationale if pattern I) first.
12. All module/texture/sfx names exist in the template or the family slice, or
    are marked `NEW: <path> — <spec>`.
13. Every §5 content-table entry has a Flavor name (≤18 chars, drawn from
    §1's naming lexicon) and one-line description — no bare stat-block id or
    placeholder label (`dmg_up`, `Sharpened`, `enemy_02`) stands in for a name.
14. §19 names the family's sim gate with its numeric thresholds, not a generic
    "sim passes".
