# Question bank

Questions for the `ask` tool, tuned for **complex** portrait games (roguelike /
survivor-like / tower defense / survival / tactics / deckbuilder / auto-battler)
with 5-10 minute runs and meta progression.

Rules:

- Round 1 and Round 2 are always asked (one `ask` call each). Round 3 only when a
  structural decision is still open.
- Max 6 questions per call. Labels ≤ 4 words; the tradeoff goes in `description`.
  Every question has a `recommended` index.
- Never ask about the fixed decisions (portrait 720x1280, Phaser 4 template,
  5-10 min runs, one-thumb + keyboard, parallel build). Never ask what
  `genre-playbooks.md` or `design-heuristics.md` already answers.
- If the pitch already answers a question, replace it with the next most valuable
  one from the same round's pool.
- "You decide" answers become PRD **Assumptions** entries with the chosen value.

---

## Round 1 — the six axes (always)

### Q1 `fantasy` — Setting and tone

Offer 3-4 concrete settings derived from the pitch, each one line, e.g.
"derelict space station, cold and tense", "neon night city, arcade-aggressive",
"cursed forest, folk-horror", "toy factory, comedic". Recommend the one closest
to the pitch's own words.

### Q2 `genre` — Confirm the genre skeleton

Offer the 3 closest genres from `genre-playbooks.md`, each described by its run
shape rather than its name, e.g.

| Label | Description |
| --- | --- |
| Survivor-like | Swarms escalate, you auto-attack, level up and pick upgrades every ~45s. |
| Action roguelike | Room by room: clear, choose a reward, fight a boss at the end. |
| Tower defense | Build and upgrade on a path, waves escalate, core must survive. |
| Auto-battler | Draft units between short automatic fights, economy decides the run. |

Recommended: the playbook entry whose keywords match the pitch.

### Q3 `run_architecture` — How does a run start, escalate and end?

| Label | Description |
| --- | --- |
| Timed survival 480s | Fixed 8-minute run, phases every ~120s, boss at 450s. Easiest to balance. |
| Wave count | N discrete waves with build/shop breaks between them. Clear pacing beats. |
| Room progression | 8-12 rooms, reward after each, boss room last. Strong sense of progress. |
| Extraction | Go deeper for better loot, bank it or lose it. Highest tension, most systems. |

### Q4 `verbs` — Primary verb and secondary interaction

| Label | Description |
| --- | --- |
| Drag to move + auto-attack | `Controls.onDrag`; offense is automatic. Lowest input load, best for swarms. |
| Drag to move + tap ability | Movement plus one cooldown ability button in the bottom bar. |
| Tap to place + drag to pan | Building games: place towers/units, drag the field. |
| Tap cards / units | Turn-based: all interaction through UI cards or a grid. |

Exactly one primary verb; secondary interactions must live in UI buttons/overlays.

### Q5 `art_direction` — Look, with hex values

| Label | Palette (bgDeep / ink / primary / secondary / accent / bad) |
| --- | --- |
| Neon void | `#05070d` `#f2f6ff` `#4de1ff` `#ff5da2` `#ffd166` `#ff4d5e` |
| Rust survival | `#12100e` `#f0e6d8` `#d9822b` `#6b8f71` `#e8c547` `#b3402f` |
| Folk horror | `#0d1410` `#e8f0e4` `#7fd18a` `#5b4bff` `#f2e394` `#c0392b` |
| Cold station | `#070b12` `#eef4ff` `#7fb2ff` `#b98cff` `#ffe066` `#ff5566` |
| Mono brutalist | `#111111` `#fafafa` `#fafafa` `#8c8c8c` `#ffe600` `#ff2d2d` |

Also confirm shape language: template procedural primitives (free, ships today)
vs generated illustrated sprites (adds an asset pipeline step and a build agent).

### Q6 `meta` — What persists between runs?

| Label | Description |
| --- | --- |
| Currency + upgrade tree | Earn on every run, buy permanent stat upgrades. Default; `core/progression.ts` supports it. |
| Unlocks only | New characters/weapons/towers unlock at milestones; no stat creep. |
| Currency + unlocks | Both. Longest retention, most balancing work. |
| Nothing | Pure skill runs; every run identical. Cheapest, weakest retention. |

---

## Round 2 — systems and content (always)

Pick 4-6, prioritising whatever the genre playbook flags as genre-critical.

### Q7 `roster` — Enemy/unit roster shape

Offer 2-3 pre-composed rosters from `data/enemies.ts` archetypes (swarm, runner,
tank, shooter, splitter, healer, elite, boss), e.g. "8 archetypes: swarm-heavy,
one elite at 150s and 330s, boss at 450s" vs "5 archetypes, two elites, no boss".
Ask which roster, not which individual enemies.

### Q8 `power` — Where does player power come from?

| Label | Description |
| --- | --- |
| Level-up cards | XP → pick 1 of 3 every level; pool of 18-24 upgrades. `ui/cards.ts` ready. |
| Loot / equipment | Drops with stat rolls and slots. Needs an inventory UI (extra workstream). |
| Build placement | Towers/units placed and upgraded with in-run currency. |
| Deck construction | Draft cards into a deck used by the combat system. |

### Q9 `economy` — Currencies and sinks

| Label | Description |
| --- | --- |
| One in-run currency | Spent during the run (towers, rerolls, heals). Simple, readable. |
| In-run + meta | Run currency for tactics, meta currency for permanent upgrades. Recommended. |
| Resources + crafting | Multiple materials with recipes. Adds a crafting UI workstream. |

### Q10 `scaling` — Difficulty curve

| Label | Description |
| --- | --- |
| Phase-stepped | Difficulty multiplier jumps at 0/120/240/360/450s. Most predictable, easiest to tune. |
| Geometric | Continuous exponential growth in HP/spawn rate. Smooth but easy to break. |
| Adaptive | Scales with the player's clear rate. Fairest, hardest to test. |

### Q11 `ui_density` — Portrait UI plan

| Label | Description |
| --- | --- |
| Minimal HUD | HP, XP, timer, score only. Field stays fully visible. |
| HUD + bottom bar | Adds 2-4 ability/build buttons in the bottom 220px. |
| HUD + overlays | Adds full-screen shop/inventory/card overlays that pause the run. |

### Q12 `finale` — How does a run resolve?

| Label | Description |
| --- | --- |
| Boss at 450s | Single pattern-based boss; clear = win. Strongest video payoff. |
| Survive the timer | Reaching 480s alive is the win. Cheapest to build. |
| Endless with score | No win state; the run ends when you die, score is the result. |
| Extraction choice | Bank rewards or push deeper for more. |

### Q13 `juice_level` — Feedback intensity at scale

| Label | Description |
| --- | --- |
| Loud | Shake, flash, hitstop, particles, damage numbers. Best on video; needs the spam caps from the heuristics doc. |
| Balanced | Impact effects on hits and level-ups, capped damage numbers. |
| Restrained | Motion and sound only; no shake. For tactics/deckbuilders. |

---

## Round 3 — structural blockers only (skip when possible)

Ask at most 3, only when the answer changes file structure or systems:

- Persistent hub/base scene between runs? (adds a scene + save schema)
- Procedurally generated map or fixed hand-authored layouts? (adds a generator or
  a level data format)
- Inventory with equipment slots? (adds inventory UI + item generation)
- Multiple playable characters/classes? (multiplies balance work per character)
- Real art/audio assets, or fully procedural? (adds an asset pipeline workstream)

If the user defers, choose the cheapest option that satisfies the pitch and put
it in Assumptions.

---

## Anti-patterns in interviewing

| Do not | Instead |
| --- | --- |
| Ask open-ended "what do you want?" | Offer concrete options with defaults. |
| Ask one question per message | Batch 4-6 in one `ask` call. |
| Ask about engine/frame/run length | Fixed by the skill; never ask. |
| Ask for numbers the heuristics doc has | Use the recommended value; confirm only when unusual. |
| Ask for content lists item by item | Offer pre-composed rosters and pool sizes. |
| Run more than 3 rounds | Two is the target; a third only for structural blockers. |
| Accept "make it deep" as an answer | Convert it into upgrade pool size, roster size and synergy count. |
