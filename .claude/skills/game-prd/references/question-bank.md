# Question bank

Questions for the `ask` tool, tuned for portrait browser games across the ten
gameplay families (A real-time-arena, B board-puzzle, C side-view-physics,
D turn-based-cards-tactics, E track-vehicle, F idle-tycoon, G table-dice,
H word-trivia, J hypercasual, plus the I composition pattern). Every question
below is asked verbatim in `interactive` mode and resolved silently via its
`Auto rule:` in `auto` mode (see `SKILL.md` §Modes) — the two modes answer the
same 15 questions, they differ only in whether the user is asked.

Rules:

- **Q2 resolves the family first.** Every other question's `Auto rule:`
  branches on that family code, and on the subgenre inside it. Resolve Q2
  before touching any other question.
- Round 1 and Round 2 are always resolved (`interactive`: one `ask` call each,
  4-6 questions per call; `auto`: every `Auto rule:` applied, no call — a
  question the family marks `n/a` is recorded as `n/a — <family reason>` in
  Assumptions rather than answered). Round 3 only when a structural decision is
  still open (`interactive`) or always, silently, in `auto`.
- Max 6 questions per call. Labels ≤ 4 words; the tradeoff goes in `description`.
  Every question has a `recommended` index.
- Never ask about the fixed decisions: portrait 720x1280, Phaser 4 template,
  one-thumb + keyboard, parallel build, or anything in `SKILL.md` §Step 0b
  (session shape, input profile, camera, director, default meta shape — all
  fixed by the family). Never ask what a playbook or `design-heuristics.md`
  already answers.
- If the pitch already answers a question, replace it with the next most valuable
  one from the same round's pool (`interactive`), or simply record the pitch's
  own answer (`auto`).
- "You decide" answers (interactive) and every `Auto rule:` application (auto)
  become PRD **Assumptions** entries with the chosen value; `auto` additionally
  logs the one-line rationale.

---

## Round 1 — the six axes (always)

### Q1 `fantasy` — Setting and tone

Offer 3-4 concrete settings derived from the pitch, each one line, e.g.
"derelict space station, cold and tense", "neon night city, arcade-aggressive",
"cursed forest, folk-horror", "toy factory, comedic". Recommend the one closest
to the pitch's own words.

**Auto rule:** if the pitch names a concrete setting/noun phrase, use it
verbatim as the recommended option (still offer 2-3 nearby variants for the
record, but the pitch's own words win). If the pitch is a bare one-word or
generic theme with no setting detail (e.g. "make a space game", "a game about
cats", "zombie game"), pick the closest cluster below **by meaning** — the
trigger words are illustrative English examples, and a pitch in another language
maps to a cluster just as well —
then add exactly one flavor twist drawn from the pitch's specific noun (e.g.
"cats" → the fallback setting plus "the swarm are stray cats, not monsters").

| Keyword cluster | Trigger words in the pitch | Fallback setting (one line) |
| --- | --- | --- |
| nature | forest, jungle, garden, plant, vine, grove | Overgrown ruin garden reclaimed by feral growth |
| tech/space | space, robot, cyber, station, ship, satellite | Derelict space station, cold and tense |
| horror/dark | horror, curse, dark, demon, ghost, haunted | Cursed forest, folk-horror |
| cute/food | cute, food, candy, kitchen, pet, bakery | Toy factory, comedic |
| ancient/desert | desert, pyramid, ancient, ruin, sand, tomb | Sunken desert temple, sun-bleached mystery |
| ocean/ice | ocean, sea, ice, arctic, frozen, deep | Frozen trench, deep-sea bioluminescent dread |
| inferno | fire, hell, volcano, lava, ember, forge | Volcanic underworld forge, molten and hostile |
| steampunk | steam, gear, clockwork, brass, airship, cog | Clockwork sky-city, brass-and-steam intrigue |

If no cluster matches, default to "neon night city, arcade-aggressive" (the
safest generic default — high contrast, reads on video, fits any verb).

### Q2 `family` — Family first, then subgenre

Ask one question with the family options grouped by what the player physically
does; the subgenre is a follow-up line inside the chosen option's
`description`, never a separate question.

| Label | Family | Description (what the session feels like) |
| --- | --- | --- |
| Arena survival | A | You move one avatar, threats escalate, a timer or boss ends the run. Subgenres: survivor-like, action roguelike, bullet hell, tower defense, base defence. |
| Board puzzle | B | A static grid; every move mutates it toward a goal in 45-120s. Subgenres: blast, merge-2, sort, block, screw, tile-match, match-swap. |
| Side-view action | C | Gravity and momentum; you time one input against terrain. Subgenres: platformer levels, endless runner, physics driving. |
| Turn-based cards/tactics | D | Nothing moves until you commit. Subgenres: deckbuilder, grid tactics, auto-battler. |
| Racing | E | Steer a vehicle around a circuit for 3-5 laps against rivals. Subgenres: top-down racing, drift, time trial. |
| Idle tycoon | F | Numbers grow while you watch; you reinvest and prestige every 15-30 min. Subgenres: generators, manager automation, shop tycoon. |
| Table/dice | G | A deal, a roll or a stack drives small decisions. Subgenres: solitaire family, dice-board, ludo. |
| Word/trivia | H | Language is the content. Subgenres: word-connect, crossword-lite, quiz. |
| One-mechanic arcade | J | One mechanic learned in 10 seconds, 30-120s runs, instant retry. Subgenres: tap-timing, stacking, swerve, rise/drop, io-lite (offline bots). |
| Casual + meta (hybrid) | I | A casual core (J, B or F) wrapped in a saga map, collections and a reward track — the 2026 default when the pitch names a fantasy but no verb. |

Offer the 3 families that plausibly describe the pitch's loop plus, whenever the
pitch is casual and verb-less, **I**. Recommended: the closest reading.

**Auto rule:** read the pitch in its original language and decide semantically
which family's loop it describes, per `SKILL.md` §Step 0 Tier 1 — what the
player does second to second and what resolves the session. No keyword count, no
points: the `Keyword hints` column there is illustrative English vocabulary and
a tiebreak aid only. Then read the family's playbook
(`genre-playbooks.md` for A/D/E, `casual-playbooks.md` for B/C/F/G/H/J) and pick
the subgenre that matches the pitch's loop. Break a genuine tie with `SKILL.md`
§Step 0 Tier 1's order — anchor over modifier, then specificity, then earliest
mention, then mechanic-over-setting (so "deckbuilding roguelike about vampires"
→ **D**, not a hybrid). Only a pitch that names **no loop at all** — brand-less,
verb-less, "cozy"/"relaxing"/"collect" — goes to the **HYBRID DEFAULT** rule
(`SKILL.md` §Step 0): compose pattern **I** with its casual core chosen as F
(pitch names a place/business) / B (pitch names objects to organise) / J (pitch
names a single motion), never mid-core-by-default and never pure match-swap. A
pitch that names "match 3" resolves to **B** but with the subgenre swapped to
sort, block, merge or screw and the swap logged with its numbers (match-swap
new-title success ~0.8%; sort +170-229%, block +176%, merge +65-74% YoY) — keep
match-swap only when the user names it twice or names a specific competitor.
Out-of-scope pitches (real-time multiplayer, gacha LiveOps, social
casino/real-money) are refused with a counter-proposal; "io" resolves to
**J io-lite** with offline bots.

### Q3 `session_architecture` — How does one session start, escalate and end?

| Label | Description |
| --- | --- |
| Timed run 480s | Fixed 8-minute run, phases every ~120s, boss at 450s. Family A default. |
| Goal levels | 30-120s levels with a goal + move/time limit, 4-12 per sitting, stars on clear. Families B/G/H, C-levels. |
| Endless ramp | No win state; difficulty ramps with score/distance, retry under 2s. Families J, C-endless. |
| Lap race | 3-5 laps against rivals and a target time, 120-200s per race. Family E. |
| Fight/round chain | 8-16 discrete fights or rounds with a draft between them. Family D. |
| Continuous economy | Never ends; the beat is the prestige cycle (15-30 min) plus offline progress. Family F. |

**Auto rule:** read straight off `SKILL.md` §Step 0b for Q2's family —
A → **Timed run 480s**; B/G/H → **Goal levels**; C → **Goal levels** when the
pitch names levels/stages/worlds, else **Endless ramp**; D → **Fight/round
chain**; E → **Lap race**; F → **Continuous economy**; J → **Endless ramp**;
I → the chosen core's row. This is a deterministic lookup, never a judgment
call. Never mix two rows in one game (a "levels *and* endless" pitch resolves
to the one the pitch mentions first and logs the other on the Cut list).

### Q4 `verbs` — Primary verb and secondary interaction

| Label | Description |
| --- | --- |
| Drag to move + auto-attack | `Controls.onDrag`; offense is automatic. Lowest input load, best for swarms. |
| Tap a cell / piece | Board families: tap to swap, blast, pop or select. |
| Drag a piece / stack | Merge, sort, screw, block-placement and solitaire card moves. |
| Tap to time one action | Jump, flip, release, stack — the single-verb arcade input. |
| Swipe to steer / connect | Lane changes, dashes, letter chains. |
| Drag to steer + tap boost | Vehicles: steering line plus one discrete action. |
| Tap cards / units | Turn-based: all interaction through UI cards or a grid. |
| Tap to place + drag to pan | Building games: place towers/units, drag the field. |

Exactly one primary verb; secondary interactions must live in UI
buttons/overlays.

**Auto rule:** read the input profile from `SKILL.md` §Step 0b for Q2's family,
then the subgenre's "Primary verb" cell in its playbook — a 1:1 lookup, never a
judgment call. A → drag/axis move + auto-attack (tap + drag to place for tower
defense/base defence); B → tap for swap/blast/tile-match, drag for
merge/sort/screw/block; C → tap for jump/flip, drag for physics driving;
D → tap card + tap target (drag-to-play as the video-legible alternative);
E → drag to steer + tap boost; F → tap; G → tap with drag for card moves;
H → tap, plus swipe for letter-connect; J → exactly one of tap/swipe/drag, and
a J spec that names two input verbs is a defect (§Anti-patterns).

### Q5 `art_direction` — Look, with hex values

| Label | Palette (bgDeep / ink / primary / secondary / accent / bad) |
| --- | --- |
| Neon void | `#05070d` `#f2f6ff` `#4de1ff` `#ff5da2` `#ffd166` `#ff4d5e` |
| Rust survival | `#12100e` `#f0e6d8` `#d9822b` `#6b8f71` `#e8c547` `#b3402f` |
| Folk horror | `#0d1410` `#e8f0e4` `#7fd18a` `#5b4bff` `#f2e394` `#c0392b` |
| Cold station | `#070b12` `#eef4ff` `#7fb2ff` `#b98cff` `#ffe066` `#ff5566` |
| Mono brutalist | `#111111` `#fafafa` `#fafafa` `#8c8c8c` `#ffe600` `#ff2d2d` |

Also confirm shape language: template procedural primitives (free, ships today)
vs generated illustrated sprites via the `game-art` skill (adds an asset
pipeline step and a parallel art workstream, does not replace the procedural
UI chrome).

**Auto rule:** map Q1's setting to a theme cluster, then read its style
profile + palette anchors from the table below — this keys directly into
`game-art`'s five `sprite-forge.style.v1` profiles
(`../game-art/references/style-profiles.md`) so the PRD's §11 art direction
and the eventual `art/style.json` never disagree. Default shape language:
generated illustrated sprites (the `game-art` pipeline is the default asset
path for a game meant to ship with its own look); fall back to template
procedural primitives only when the pitch explicitly asks for "no art"/"keep
it simple"/"placeholder".

| Theme cluster | Style profile | Palette anchors (bgDeep / ink / primary / secondary / accent / bad) |
| --- | --- | --- |
| nature | painterly | `#0c150d` `#eef5e6` `#6fae52` `#3f7d4a` `#d9c25c` `#b23a3a` |
| tech/space | neon retro | `#05070d` `#f2f6ff` `#4de1ff` `#7fb2ff` `#ffd166` `#ff4d5e` |
| horror/dark | gritty pixel | `#0d1410` `#e8f0e4` `#7fd18a` `#5b4bff` `#f2e394` `#c0392b` |
| cute/food | vibrant chibi | `#1a0f14` `#fff3e6` `#ff8fb3` `#ffd166` `#7fd8c0` `#ff5566` |
| ancient/desert | painterly | `#1c130a` `#f4e6c8` `#d9a24b` `#8a5a3a` `#e8c547` `#b3402f` |
| ocean/ice | flat vector | `#061018` `#eaf6ff` `#4fb8e0` `#7fc9ff` `#d6f5ff` `#ff5566` |
| inferno | gritty pixel | `#150705` `#f5e3d0` `#ff7a3c` `#b3402f` `#ffcf5c` `#6b1a1a` |
| steampunk | flat vector | `#14100a` `#f0e2c8` `#c98a3e` `#6b5a3f` `#d4af37` `#b3402f` |

No cluster match → default to **vibrant chibi** with the "Neon void" palette
above (highest thumbnail contrast, `game-art`'s recommended default for
hundreds of small entities on a dark field). Board/table/word families
additionally lock a piece-face set: one legible silhouette per piece type at
96px, distinguishable by shape as well as hue (colour-blind safety on a 6+
piece board).

### Q6 `meta` — What persists between sessions?

| Label | Description |
| --- | --- |
| Shop (currency + upgrade tree) | Earn every session, buy permanent upgrades. `core/progression.ts` supports it. |
| Saga map + stars | Linear/branching level map, 1-3 stars per level, gates on star totals. |
| Collections | Sets of cards/skins/decor completed by playing; the strongest casual retention hook. |
| Prestige tree | Reset the economy for a permanent multiplier; the idle family's entire retention curve. |
| Unlocks only | New characters/vehicles/decks unlock at milestones; no stat creep. |
| Nothing | Pure skill sessions; every session identical. Cheapest, weakest retention. |

**Auto rule:** default to the family's meta shape in `SKILL.md` §Step 0b —
A/D/E → **Shop**; B/H → **Saga map + stars** plus **Collections**;
C → **Saga map + stars** (levels) or **Shop + Collections** (endless);
F → **Prestige tree**; G → **Collections** (plus saga map for the dice-board
loop); J → **Collections** (10-15 skins) with a light prestige layer;
I → 2-3 meta-kit layers over the core, at least one of them **Collections**
(the 5-20x LTV multiplier the hybrid pattern is chosen for). Only deviate when
the pitch is explicit: "no progression"/"pure skill"/"same every time" →
**Nothing**; "unlock new characters/vehicles" with no grind language →
**Unlocks only**.

---

## Round 2 — systems and content (always)

`interactive` asks 4-6, prioritising whatever the family playbook flags as
critical. `auto` resolves all of them; a question the family marks `n/a` is
recorded as such.

### Q7 `roster` — Content-atom set

The family decides what the atoms are:

| Family | Atom set the question is about |
| --- | --- |
| A | Enemy archetypes (swarm, runner, tank, shooter, splitter, healer, elite, boss) |
| B | Piece types + specials + boosters |
| C | Obstacle/hazard archetypes + terrain segment kit |
| D | Units/cards/enemy intents |
| E | Vehicles + track segment kit + rival AI tiers |
| F | Generators + managers + upgrade tiers |
| G | Tile-event types (dice-board) or deal variants (solitaire) |
| H | Question categories (trivia) or word-list themes (word) |
| J | The one mechanic's obstacle variants + collectible skins |

Offer 2-3 pre-composed sets, e.g. "8 enemy archetypes: swarm-heavy, elite at
150s and 330s, boss at 450s" or "6 piece types + 3 specials + 2 boosters".
Ask which set, not which individual item.

**Auto rule:** read the family's row in `prd-template.md` §5.0's
content-volume gate table. Systems weight **L** (from the family playbook's
selection table) → the "comfortable" column; weight **M** → the "minimum"
column plus whatever the subgenre's playbook marks mandatory (e.g. A: 1 elite
plus 1 boss; B: 3 specials; F: 1 prestige layer; J: 1 mechanic + 1-2 twists).
Never go below the minimum column — that is a defect, not a scope choice.

### Q8 `power` — Where does progress inside a session come from?

| Label | Description |
| --- | --- |
| Level-up cards | XP → pick 1 of 3 every level; pool of 18-24 upgrades. `ui/cards.ts` ready. |
| Board specials + boosters | Combos create specials; boosters are the spend-to-win valve. |
| Build placement | Towers/units placed and upgraded with in-session currency. |
| Deck construction | Draft cards into a deck used by the combat system. |
| Loot / equipment | Drops with stat rolls and slots. Needs an inventory UI (extra workstream). |
| Reinvestment | Buy the next generator/upgrade; the curve is the gameplay. |
| Nothing in-session | Skill only; all progression is meta (J, most G/H). |

**Auto rule:** derive from Q2's family and subgenre. A → **Level-up cards**
(**Build placement** for tower defense/base defence); B → **Board specials +
boosters**; C → **Nothing in-session** for endless, **Board specials +
boosters**-equivalent per-level power-ups for levels (per the C playbook);
D → **Deck construction** (deckbuilder/auto-battler) or **Level-up
cards**-equivalent ability unlocks (tactics); E → **Build
placement**-equivalent pre-race loadout, no mid-race power; F →
**Reinvestment**; G/H/J → **Nothing in-session**. Dungeon-crawler and
survival-crafting subgenres of A/D → **Loot / equipment**.

### Q9 `economy` — Currencies and sinks

| Label | Description |
| --- | --- |
| One in-session currency | Spent during play (towers, rerolls, heals). Simple, readable. |
| In-session + meta | Session currency for tactics, meta currency for permanent upgrades. |
| Soft + boosters + lives | Casual standard: coins, consumable boosters, a lives/energy gate. |
| Exponential single currency | Idle: one number with `cost(level) = base * growth^level` and a prestige currency on top. |
| Resources + crafting | Multiple materials with recipes. Adds a crafting UI workstream. |

**Auto rule:** A/D/E → **In-session + meta** (matches
`design-heuristics.md` §4's worked formulas); B/G/H → **Soft + boosters +
lives**, with the lives gate specified as *generous* (5 lives, 20-minute
refill) because a punishing gate on a browser game with no store just ends the
session; C-levels → **Soft + boosters + lives**, C-endless/J →
**In-session + meta** with the session currency spent on the retry-loop
collection; F → **Exponential single currency** (`growth` 1.07-1.15 per level,
`design-heuristics.md` §17); Survival-crafting subgenre → **Resources +
crafting** (its `data/recipes.ts`/`core/inventory.ts` are mandatory, not
optional).

### Q10 `scaling` — Difficulty curve

| Label | Description |
| --- | --- |
| Phase-stepped | Threat multiplier jumps at 0/120/240/360/450s. Most predictable, easiest to tune. |
| Level curve (win-rate band) | Per-level target win-rate: L1-5 95-99%, L10 85%, L20 70%, marked spikes. Moves are the dial. |
| Score ramp | Speed/density grow with score toward a median session length; monotone, no cliffs. |
| Cost growth | The curve *is* the economy: `cost(level) = base * growth^level`, prestige resets it. |
| Geometric | Continuous exponential growth in HP/spawn rate. Smooth but easy to break. |
| Adaptive | Scales with the player's clear rate. Fairest, hardest to test. |

**Auto rule:** A/D/E → **Phase-stepped** (`design-heuristics.md` §2.3;
re-indexed per fight/lap exactly as the family playbook documents, never
switched to Geometric or Adaptive without an explicit request — both are harder
to balance and to test, §2.2/§2.4). B/C-levels/G/H → **Level curve
(win-rate band)** per `design-heuristics.md` §15, with the moves/time limit as
the exponential difficulty dial and every spike level marked. C-endless/J →
**Score ramp** per §16. F → **Cost growth** per §17.

### Q11 `ui_density` — Portrait UI plan

| Label | Description |
| --- | --- |
| Minimal HUD | Goal, counter, score only. Field/board stays fully visible. |
| HUD + bottom bar | Adds 2-4 ability/build/booster buttons in the bottom 220px. |
| HUD + overlays | Adds full-screen shop/inventory/card/level-complete overlays that pause the session. |

**Auto rule:** J → **Minimal HUD** (a second widget on a 30-120s run is
noise); B/G/H → **HUD + bottom bar** for the booster tray plus the
level-complete overlay (that overlay is mandatory: goal, stars, next-level
button); A → **HUD + bottom bar** (**HUD + overlays** for the place-defence
subgenres); C → **Minimal HUD** for endless, **HUD + bottom bar** for levels;
D/E/F → **HUD + overlays** (draft/shop/garage/upgrade-list moments per their
playbooks). Never exceed the 7-widget noise ceiling
(`design-heuristics.md` §7.6).

### Q12 `finale` — How does a session resolve?

| Label | Description |
| --- | --- |
| Boss at 450s | Single pattern-based boss; clear = win. Strongest video payoff. |
| Survive the timer | Reaching the run's end alive is the win. Cheapest to build. |
| Goal met / moves out | Level clears on goal completion, fails when moves or time run out. |
| Death, score is the result | Endless: no win state; the score screen is the payoff. |
| Finish line | Final lap crossed inside the target time; placement is the result. |
| Prestige threshold | The "win" is the offer to reset for a permanent multiplier. |
| Extraction choice | Bank rewards or push deeper for more. |

**Auto rule:** A → **Boss at 450s** (**Extraction choice** for the extraction
subgenre); B/C-levels/G/H → **Goal met / moves out**; C-endless/J → **Death,
score is the result**; D → **Boss at 450s**-equivalent final fight of the
chain; E → **Finish line**; F → **Prestige threshold**;
I → the core's row plus the meta-kit's between-session beat (star payout,
collection card, reward-track tick).

### Q13 `juice_level` — Feedback intensity at scale

| Label | Description |
| --- | --- |
| Loud | Shake, flash, hitstop, particles, damage numbers. Best on video; needs the spam caps from the heuristics doc. |
| Balanced | Impact effects on hits/clears/level-ups, capped floating numbers. |
| Restrained | Motion and sound only; no shake. For tactics/deckbuilders/word games. |

**Auto rule:** **Balanced** for A, C, E, J and the action subgenres of A —
entity counts and event frequency justify capped impact effects (§9).
**Loud** for B and G's clear/cascade moments only: a board family's cascade is
its entire reward loop, so the cascade chain gets escalating pitch, particles
and a combo counter while the rest of the board stays quiet. **Restrained** for
D, F and H — low-entity-count, deliberate-pace families where shake/particle
spam reads as noise rather than impact.

### Q14 `content_curve` — Level count and curve preference (B/C-levels/G/H; `n/a` for A/D/E/F/J)

| Label | Description |
| --- | --- |
| 20 levels, long ramp | Minimum shippable set. Win-rate slides smoothly 99% → 70% by L20; one spike at L10. |
| 50 levels, long ramp | Comfortable set. Smooth slide to 65% by L50, spikes every 10th level. |
| 20-25 levels, short spikes | Sawtooth: 3-4 easy levels then a hard gate; higher churn, stronger booster pull. |
| Generated + curve-fit | Levels generated from the piece set and auto-fit to the §15 win-rate band by the board solver. |

**Auto rule:** **Generated + curve-fit at 20 levels minimum, 50 comfortable**,
with a long ramp and spikes every 10th level. Generation plus the
`npm run sim -- --family <slice>` board-solver gate is what makes 50 levels
affordable in one build; hand-authoring 50 levels is not. Switch to **short
spikes** only when the pitch explicitly asks for a hard/punishing game, and
record that it raises early churn. Levels beyond the shipped set are a Cut-list
entry ("levels 51+ generated post-launch"), never a promise inside §5.

### Q15 `session_length` — Session-length target

Pin the exact number inside the family's window; the window itself is fixed by
`SKILL.md` §Step 0b and is never up for discussion.

| Family | Window | Default to recommend | Unit of a "session" |
| --- | --- | --- | --- |
| A | 300-600s | 480s | one run |
| B | 45-120s per level | 90s, 4-8 levels per sitting | one level |
| C | 20-45s per level / 45-150s endless | 35s level (8-20 per sitting), 90s endless | one level / one run |
| D | 300-600s | 480s across 8-16 fights | one match |
| E | 120-200s per race | 160s (4 laps x ~40s), 2-4 races per sitting | one race |
| F | continuous | 6-10 min first sitting, 60-180s check-ins, first prestige 15-30 min | one prestige cycle |
| G | 60-150s | 120s per deal, 3-6 per sitting | one deal |
| H | 30-90s | 60s per puzzle, 5-12 per sitting | one puzzle |
| J | 30-120s | 45s median, retry under 2s | one run |

**Auto rule:** take the "Default to recommend" cell for Q2's family. Deviate
only on an explicit pitch instruction ("really short", "long sessions"), stay
inside the window, and re-scale everything keyed to it — A/D scale phase
boundaries by `targetSeconds/480` (`design-heuristics.md` §1.4); B/G/H scale
the move budget, not the level count; J's ramp constants scale so the median
session stays inside 30-120s (§16). A session-length number outside its
family's window without rescaling is anti-pattern #18.

---

## Round 3 — structural blockers only (skip when possible)

Ask at most 3, only when the answer changes file structure or systems:

- Persistent hub/base/home scene between sessions? (adds a scene + save schema)
- Generated levels/boards/tracks or fixed hand-authored layouts? (adds a
  generator + a solver/validator, or a level data format)
- Inventory with equipment slots? (adds inventory UI + item generation)
- Multiple playable characters/vehicles/decks? (multiplies balance work per unit)
- Real art/audio assets, or fully procedural? (adds an asset pipeline workstream)

**Auto rule (all of them, in `auto` mode):** always choose the cheapest option
that satisfies the pitch and Q2's family, and record it in Assumptions:

| Blocker | Auto resolution |
| --- | --- |
| Hub scene | **No hub scene** unless the family's meta shape is a saga map or prestige tree (B/C-levels/G/H/F/I) — those need a map/home scene, so it lands as `src/scenes/map.ts` |
| Generated vs authored | **Generated + validated** for B/G/H/E tracks and C-endless terrain (the generator plus its `src/sim/families/<family>.ts` validator is cheaper than authoring 50 levels and is the family's sim gate); **procedurally generated** for the action-roguelike/extraction/dungeon subgenres of A/D (their playbooks mandate `floorgen.ts`/room graphs); **fixed hand-authored layouts** for everything else |
| Inventory slots | **No** unless Q8 resolved to "Loot / equipment" → **yes** |
| Multiple characters | **No** — one character/vehicle/deck kit is always cheaper (anti-pattern table, §14); extra ones are collection skins with no stat deltas, which is what J's 10-15 skins are |
| Art/audio | **Generated** art (per Q5's default — the `game-art` pipeline); audio stays 100% synthesised `core/audio.ts` plus the generative `core/music.ts` layer, never licensed/streamed |

If the user defers (interactive mode), choose the cheapest option that
satisfies the pitch and put it in Assumptions.

---

## Anti-patterns in interviewing

| Do not | Instead |
| --- | --- |
| Ask any other question before the family is resolved | Q2 first; every other `Auto rule:` branches on the family code. |
| Ask open-ended "what do you want?" | Offer concrete options with defaults. |
| Ask one question per message | Batch 4-6 in one `ask` call. |
| Ask about engine/frame/session shape/camera/director | Fixed by the skill and by the family (`SKILL.md` §Step 0b); never ask. |
| Ask for numbers the heuristics doc has | Use the recommended value; confirm only when unusual. |
| Ask for content lists item by item | Offer pre-composed rosters and pool sizes. |
| Run more than 3 rounds | Two is the target; a third only for structural blockers. |
| Accept "make it deep" as an answer | Convert it into pool size, roster size, level count and synergy count. |
| Default a vague casual pitch to match-3 swap | HYBRID DEFAULT (pattern I) with a sort/block/merge/screw core; match-swap succeeds at ~0.8% for new titles. |
| Default a vague casual pitch to a mid-core family | A verb-less pitch is not a survivor-like; compose pattern I. |
| Give a family-J spec two input verbs, or a second HUD widget | One mechanic, one verb, minimal HUD — that is the family's entire definition. |
| Mix "levels" and "endless" in one session architecture | Pick one (Q3); the other goes on the Cut list. |
| Call `ask` at all in `auto` mode | Apply every question's `Auto rule:` and log the result in Assumptions instead. |
