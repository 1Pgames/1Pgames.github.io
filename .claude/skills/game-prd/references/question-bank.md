# Question bank

Questions for the `ask` tool, tuned for **complex** portrait games (roguelike /
survivor-like / tower defense / survival / tactics / deckbuilder / auto-battler)
with 5-10 minute runs and meta progression. Every question below is asked
verbatim in `interactive` mode and resolved silently via its `Auto rule:` in
`auto` mode (see `SKILL.md` §Modes) — the two modes answer the same 13
questions, they differ only in whether the user is asked.

Rules:

- Round 1 and Round 2 are always resolved (`interactive`: one `ask` call each;
  `auto`: all `Auto rule:`s applied, no call). Round 3 only when a structural
  decision is still open (`interactive`) or always, silently, in `auto`.
- Max 6 questions per call. Labels ≤ 4 words; the tradeoff goes in `description`.
  Every question has a `recommended` index.
- Never ask about the fixed decisions (portrait 720x1280, Phaser 4 template,
  5-10 min runs, one-thumb + keyboard, parallel build). Never ask what
  `genre-playbooks.md` or `design-heuristics.md` already answers.
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
cats", "zombie game"), fall back to the nearest cluster below by keyword match,
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

**Auto rule:** score all 12 rows of `genre-playbooks.md`'s §Selection table
against the pitch by counting keyword overlaps with each row's "Best-fit pitch
keywords" cell; take the highest-scoring row. Break ties, or a pitch with zero
keyword matches, by picking **Survivor-like** (row 1 — lowest systems weight,
most forgiving default for an underspecified pitch).

### Q3 `run_architecture` — How does a run start, escalate and end?

| Label | Description |
| --- | --- |
| Timed survival 480s | Fixed 8-minute run, phases every ~120s, boss at 450s. Easiest to balance. |
| Wave count | N discrete waves with build/shop breaks between them. Clear pacing beats. |
| Room progression | 8-12 rooms, reward after each, boss room last. Strong sense of progress. |
| Extraction | Go deeper for better loot, bank it or lose it. Highest tension, most systems. |

**Auto rule:** derive from Q2's genre: Tower defense / Base builder →
**Wave count**; Action roguelike / Dungeon crawler → **Room progression**;
Extraction run → **Extraction**; every other genre (Survivor-like,
Deckbuilder, Auto-battler, Survival crafting, Bullet hell, Tactics, Idle) →
**Timed survival 480s** (the recommended default; it is also the shape the
shared phase table in `design-heuristics.md` §1.1 and `genre-playbooks.md`
already assume).

### Q4 `verbs` — Primary verb and secondary interaction

| Label | Description |
| --- | --- |
| Drag to move + auto-attack | `Controls.onDrag`; offense is automatic. Lowest input load, best for swarms. |
| Drag to move + tap ability | Movement plus one cooldown ability button in the bottom bar. |
| Tap to place + drag to pan | Building games: place towers/units, drag the field. |
| Tap cards / units | Turn-based: all interaction through UI cards or a grid. |

Exactly one primary verb; secondary interactions must live in UI buttons/overlays.

**Auto rule:** read directly off `genre-playbooks.md`'s §Selection table
"Primary verb" column for Q2's chosen genre — this is a deterministic 1:1
lookup, never a judgment call (e.g. Survivor-like → drag/axis move +
auto-attack; Tower defense → place/drag; Deckbuilder → tap card, tap target).

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
hundreds of small entities on a dark field).

### Q6 `meta` — What persists between runs?

| Label | Description |
| --- | --- |
| Currency + upgrade tree | Earn on every run, buy permanent stat upgrades. Default; `core/progression.ts` supports it. |
| Unlocks only | New characters/weapons/towers unlock at milestones; no stat creep. |
| Currency + unlocks | Both. Longest retention, most balancing work. |
| Nothing | Pure skill runs; every run identical. Cheapest, weakest retention. |

**Auto rule:** default **Currency + upgrade tree** (recommended;
`core/progression.ts` and `design-heuristics.md` §4.2-4.3 are built around
it). Only deviate when the pitch is explicit: "no progression"/"pure
skill"/"same every time" → **Nothing**; "unlock new characters/weapons" with
no stat-grind language → **Unlocks only**.

---

## Round 2 — systems and content (always)

Pick 4-6, prioritising whatever the genre playbook flags as genre-critical.

### Q7 `roster` — Enemy/unit roster shape

Offer 2-3 pre-composed rosters from `data/enemies.ts` archetypes (swarm, runner,
tank, shooter, splitter, healer, elite, boss), e.g. "8 archetypes: swarm-heavy,
one elite at 150s and 330s, boss at 450s" vs "5 archetypes, two elites, no boss".
Ask which roster, not which individual enemies.

**Auto rule:** read the genre's Content Volume table in `genre-playbooks.md`
(enemy/unit archetype row). Systems weight **L** (from the §Selection table)
→ the "comfortable" count with 2 elites + 1 boss; systems weight **M** → the
"minimum viable" count with 1 elite + 1 boss (or the genre's documented
finale shape from Q12 if it has no boss, e.g. idle/incremental).

### Q8 `power` — Where does player power come from?

| Label | Description |
| --- | --- |
| Level-up cards | XP → pick 1 of 3 every level; pool of 18-24 upgrades. `ui/cards.ts` ready. |
| Loot / equipment | Drops with stat rolls and slots. Needs an inventory UI (extra workstream). |
| Build placement | Towers/units placed and upgraded with in-run currency. |
| Deck construction | Draft cards into a deck used by the combat system. |

**Auto rule:** derive from Q2's genre via its §Systems required table:
Tower defense / Base builder → **Build placement**; Roguelike deckbuilder →
**Deck construction**; Dungeon crawler / Survival crafting → **Loot /
equipment**; every other genre (Survivor-like, Action roguelike, Auto-battler,
Bullet hell, Tactics, Idle, Extraction run) → **Level-up cards** (the
recommended default — `ui/cards.ts` and `data/upgrades.ts` are ready for it
with zero new modules).

### Q9 `economy` — Currencies and sinks

| Label | Description |
| --- | --- |
| One in-run currency | Spent during the run (towers, rerolls, heals). Simple, readable. |
| In-run + meta | Run currency for tactics, meta currency for permanent upgrades. Recommended. |
| Resources + crafting | Multiple materials with recipes. Adds a crafting UI workstream. |

**Auto rule:** default **In-run + meta** (recommended; matches
`design-heuristics.md` §4's worked formulas) for every genre. Escalate to
**Resources + crafting** only when Q2's genre is Survival crafting (the
playbook's `data/recipes.ts`/`core/inventory.ts` are mandatory there, not
optional).

### Q10 `scaling` — Difficulty curve

| Label | Description |
| --- | --- |
| Phase-stepped | Difficulty multiplier jumps at 0/120/240/360/450s. Most predictable, easiest to tune. |
| Geometric | Continuous exponential growth in HP/spawn rate. Smooth but easy to break. |
| Adaptive | Scales with the player's clear rate. Fairest, hardest to test. |

**Auto rule:** always **Phase-stepped** (recommended; `design-heuristics.md`
§2.3 default, and every genre playbook's shared phase-band table in
`genre-playbooks.md` already keys off it). For genres whose progression index
is not wall-clock (bullet hell: boss-HP-threshold phases; deckbuilder/tactics:
fight/mission-indexed), the phase-stepped table is still used, re-indexed
exactly as that genre's §Progression math section documents — never switch to
Geometric or Adaptive without an explicit user request, both are harder to
balance and to test (§2.4, §2.2).

### Q11 `ui_density` — Portrait UI plan

| Label | Description |
| --- | --- |
| Minimal HUD | HP, XP, timer, score only. Field stays fully visible. |
| HUD + bottom bar | Adds 2-4 ability/build buttons in the bottom 220px. |
| HUD + overlays | Adds full-screen shop/inventory/card overlays that pause the run. |

**Auto rule:** derive from Q2's genre systems weight in the §Selection table:
weight **M** (Survivor-like, Bullet hell, Idle) → **HUD + bottom bar**; weight
**L** (Action roguelike, Tower defense, Deckbuilder, Auto-battler, Survival
crafting, Base builder, Tactics, Extraction run, Dungeon crawler) → **HUD +
overlays** (these genres all have a draft/shop/inventory/card moment per
their §Systems required table).

### Q12 `finale` — How does a run resolve?

| Label | Description |
| --- | --- |
| Boss at 450s | Single pattern-based boss; clear = win. Strongest video payoff. |
| Survive the timer | Reaching 480s alive is the win. Cheapest to build. |
| Endless with score | No win state; the run ends when you die, score is the result. |
| Extraction choice | Bank rewards or push deeper for more. |

**Auto rule:** derive from Q2's genre: Extraction run → **Extraction choice**;
Idle/incremental → **Survive the timer** (its finale is the prestige
threshold, not a fight, per `genre-playbooks.md` §10); every other genre →
**Boss at 450s** (the recommended default; every other playbook's beat sheet
already ends on a named boss/final-wave/final-fight moment at or near the
Climax phase).

### Q13 `juice_level` — Feedback intensity at scale

| Label | Description |
| --- | --- |
| Loud | Shake, flash, hitstop, particles, damage numbers. Best on video; needs the spam caps from the heuristics doc. |
| Balanced | Impact effects on hits and level-ups, capped damage numbers. |
| Restrained | Motion and sound only; no shake. For tactics/deckbuilders. |

**Auto rule:** default **Balanced** ("Standard" feedback intensity) for every
action-paced genre — Survivor-like, Action roguelike, Tower defense, Base
builder, Bullet hell, Extraction run, Survival crafting, Auto-battler — where
entity counts and hit frequency justify capped impact effects (§9 of
`design-heuristics.md`). Switch to **Restrained** for Turn-based tactics,
Roguelike deckbuilder, and Idle/incremental — low-entity-count, deliberate-pace
genres where `shake`/particle spam reads as noise rather than impact.

---

## Round 3 — structural blockers only (skip when possible)

Ask at most 3, only when the answer changes file structure or systems:

- Persistent hub/base scene between runs? (adds a scene + save schema)
- Procedurally generated map or fixed hand-authored layouts? (adds a generator or
  a level data format)
- Inventory with equipment slots? (adds inventory UI + item generation)
- Multiple playable characters/classes? (multiplies balance work per character)
- Real art/audio assets, or fully procedural? (adds an asset pipeline workstream)

**Auto rule (all three, in `auto` mode):** always choose the cheapest option
that satisfies the pitch and Q2's genre, and record it in Assumptions:
persistent hub scene only if the genre playbook mandates one (none of the 12
do by default) → **no hub scene**; map generation → **fixed hand-authored
layouts** unless Q2's genre is Action roguelike/Extraction run/Dungeon crawler
(their playbooks mandate `floorgen.ts`/room graphs) → **procedurally
generated**; inventory with equipment slots → **no** unless Q8 resolved to
"Loot / equipment" → **yes**; multiple playable characters → **no** (single
character/unit kit is always the cheaper default; multiplies balance work per
§14 anti-pattern table); art/audio assets → **generated** (per Q5's default —
`game-art` pipeline; audio stays 100% synthesised `core/audio.ts` plus the
generative `core/music.ts` layer, never licensed/streamed, per
`genre-playbooks.md`'s Red flags).

If the user defers (interactive mode), choose the cheapest option that
satisfies the pitch and put it in Assumptions.

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
| Call `ask` at all in `auto` mode | Apply every question's `Auto rule:` and log the result in Assumptions instead. |
