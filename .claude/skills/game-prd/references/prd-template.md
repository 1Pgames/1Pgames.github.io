# PRD template (complex indie game, portrait, 5-10 min runs)

Fill every section. No placeholders, no "TBD", no adjective without a number.
Target length 500-900 lines: this document is the only input 4-6 parallel build
agents get. Write it to `games/<slug>/PRD.md`.

---

```markdown
# <Game Title>

One-sentence pitch: <what the player does, what threatens them, what makes a run
different from the last one>.

- Slug: `<slug>`
- Genre: <genre from genre-playbooks.md>
- Primary verb: <drag | tap | hold | swipe> (+ secondary: <UI buttons/overlays>)
- Run length: <480>s target, phases at <0/120/240/360/450>s
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
tables (enemies, upgrades, units, items) draws its name from this lexicon —
this is what keeps 40+ generated names feeling like one game's vocabulary
instead of a random word generator.

## 2. Run architecture

Beat sheet for the reference run, one row per phase:

| Phase | Window | Threat | Player power | Player experience |
| --- | --- | --- | --- | --- |
| Onboarding | 0-30s | 1 archetype, low density | base stats | learn the verb |
| Build-up | 30-120s | 2-3 archetypes | 2-3 upgrades | first real pressure |
| Escalation | 120-240s | +elite at 150s | 5-6 upgrades | build identity forms |
| Peak | 240-450s | max density, elite at 330s | 8-10 upgrades | power fantasy window |
| Finale | 450-480s | boss | full build | win or die |

Then: how the run ends (win / death / extraction), what the player sees, and what
carries into the meta layer.

## 3. Controls

| Input | Effect | Template hook |
| --- | --- | --- |
| Drag | move the player | `Controls.onDrag` |
| Keyboard WASD/arrows | same as drag | `controls.axisX/axisY` in `update` |
| Tap bottom button | ability / build | `Button` in `src/ui/button.ts` |

- Dead zones, clamping, forbidden regions (pixels).
- Behaviour during overlays (run paused? field visible?).
- Keyboard parity for every touch interaction.
- Banned: tilt, multi-touch gestures, anything needing two thumbs.

## 4. Systems map

One row per system. `Module` must be a real template module or
`NEW: <path> — <one-line spec>`.

| System | Module | Responsibility | Notes |
| --- | --- | --- | --- |
| Stats & modifiers | `core/stats.ts` | player/enemy stat resolution | keys listed in §7 |
| Damage & health | `core/damage.ts` | hits, crits, DoT, i-frames | |
| Pooling | `core/pool.ts` | bullets, enemies, pickups | mandatory above 50 spawns/min |
| Broad-phase | `core/spatial.ts` | hit queries at 200+ entities | cell size <N> |
| Navigation | `core/grid.ts` | flow-field pathing | grid <cols>x<rows>, tile <N>px |
| Run director | `core/run.ts` | waves, phases, difficulty | waves in `data/waves.ts` |
| Meta save | `core/progression.ts` | currency, unlocks, upgrades | schema in §10 |
| Upgrade draft | `ui/cards.ts` | pick 1 of 3 | pool in `data/upgrades.ts` |
| Bars | `ui/bars.ts` | HP/XP/boss bars | |

## 5. Entities and content tables

### 5.1 Player

| Stat | Base | Unit | Notes |
| --- | --- | --- | --- |
| `maxHp` | 100 | hp | |
| `damage` | 10 | per hit | |
| `attackMs` | 600 | ms | |
| `moveSpeed` | 330 | px/s | |
| `critChance` | 0.05 | 0-1 | |
| `critMul` | 2.0 | multiplier | |
| `pickupRadius` | 90 | px | |

### 5.2 Enemies / units / towers

Every entry complete. `Texture` from `core/keys.ts` or `NEW`. `Flavor name`
and `Flavor desc` are mandatory: an evocative name (≤18 chars, drawn from
§1's naming lexicon) and a one-line description tying the entry to the
fantasy — never the raw stat-block id.

| id | Flavor name | Flavor desc | Texture | Size px | HP | Damage | Speed px/s | Behaviour | XP | Currency | Tint | First seen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| swarm | Cinder Mote | A drifting ember that swarms toward warmth and light | disc | 34 | 12 | 6 | 120 | chase | 1 | 1 | `PALETTE.bad` | 0s |
| … | | | | | | | | | | | | |

Minimum roster size for this genre: <N> (from the playbook).

### 5.3 Upgrades / items / cards

`Flavor name` and `Flavor desc` are mandatory, same rule as §5.2 — no raw
stat-block id or generic label ("dmg_up", "Sharpened") stands in for a name.

| id | Flavor name | Flavor desc | Rarity | Effect (modifiers) | Stack limit | Synergy tag |
| --- | --- | --- | --- | --- | --- | --- |
| dmg_up | Quenched Edge | A blade cooled in forge-oil, biting deeper on every swing | common | `damage +4` | 5 | offense |
| … | | | | | | |

Pool size: <N> (must be ≥ 4x the number of choices offered in one run).
Choices offered per run: <N>. Rarity weights: common <x> / rare <y> / epic <z>.

### 5.4 Waves

Reference `data/waves.ts`. Table of wave entries: `at` seconds, spawn ids and
counts, `everyMs`, label (elite/boss). ~16-20 entries for a 480s run.

## 6. Progression math

- XP curve: formula + worked thresholds for levels 1-12 and the level the player
  should reach at 120s / 240s / 480s.
- Difficulty scaling: formula per phase with worked enemy HP/damage/spawn values
  at 60/180/300/480s.
- Power vs threat: target ratio per phase and the intentional power-fantasy
  window (seconds).

## 7. Balance table → `TUNING`

Every key the code reads, with units. Maps 1:1 onto `TUNING` in `src/config.ts`.
Group by system (player, enemy, economy, waves, feel). Minimum 25 keys for a
complex game; every key that appears in code must appear here.

| Key | Value | Unit | Note |
| --- | --- | --- | --- |
| `player.moveSpeed` | 330 | px/s | |
| `enemy.hpScalePerPhase` | 1.35 | multiplier | applied by `RunDirector.difficulty` |
| `economy.currencyPerElite` | 25 | coins | |
| … | | | |

## 8. Build variety

At least three named strategies:

| Strategy | Enabling upgrades/units | Playstyle | Why it is not dominated |
| --- | --- | --- | --- |
| Glass cannon | crit + damage + attack speed | high risk | dies to swarm density |
| … | | | |

Plus: how the draft guarantees no dead choice (reroll rules, banned duplicates,
guaranteed category coverage).

## 9. Economy

- In-run currency: sources, income per minute, sinks and prices.
- Meta currency: earned per run (win vs loss), `cost(level) = base * growth^level`
  with base/growth and the resulting grind length in runs (worked numbers).
- Inflation control: caps, diminishing returns, price scaling.

## 10. Meta progression and save schema

```ts
interface MetaSave {
  version: 1;
  currency: number;
  unlocks: string[];
  upgrades: Record<string, number>;
  stats: { runs: number; wins: number; bestScore: number; bestTimeMs: number };
}
```

- Meta upgrade list with maxLevel, cost params, and the `Modifier` each level grants.
- Unlock pacing: runs to first unlock, runs to full clear.
- Migration rule for `version` bumps.

## 11. Art direction

- Palette: exact hex for every `PALETTE` key used.
- Shape language: which template primitives; any new ones with the `Graphics`
  calls needed in `core/textures.ts`.
- Background, motion identity (2-3 signature motions), typography (`TEXT` presets).
- Colour coding: danger / reward / neutral / player, tied to palette keys.

## 12. Audio

Only `sfx()` names that exist: `ui tap pickup combo jump hit die levelup whoosh`.
New sound = a `Voice` entry spec (wave, freq, freqEnd, attack, decay, gain, noise).

| Event | sfx | Params | Voice cap |
| --- | --- | --- | --- |
| Enemy hit | `hit` | volume 0.5 | max 6/s |
| … | | | |

## 13. Juice table

Every gameplay event: at least one visual and one sound, with values and spam caps.

| Event | Visual | Values | Sound | Cap |
| --- | --- | --- | --- | --- |
| Level up | `flash` + `burst` + cards overlay | `accent`/160ms, 24 particles | `levelup` | — |
| Enemy death | `burst` + `floatText` | 8 particles | `hit` | 8 floatTexts/s |
| Player hit | `shake` + `flash` + `hitstop` | 0.012/180ms, 120ms, 60ms | `die`/`hit` | no shake above 200 entities |

## 14. UI and HUD (pixel plan)

- HUD inventory with coordinates in the 720x1280 frame, respecting SAFE.
- Bottom bar: buttons, sizes (min 88px), spacing.
- Overlays: which pause the run, how the field stays visible, how they are dismissed.
- Menu, pause, results and meta screens: copy and element list.

## 15. Performance plan

- Peak counts: enemies, projectiles, particles, texts, tweens.
- What is pooled and with which pool sizes.
- `SpatialHash` cell size and query radius; collision strategy per entity count.
- Per-frame prohibitions (Graphics redraw, new tweens, text churn).
- Verification: fps + entity counter readout in `?debug`.

## 16. Build plan (parallel workstreams)

4-6 workstreams that can run simultaneously. One owner per file — no shared files.

| Workstream | Owns files | Delivers | Depends on contract |
| --- | --- | --- | --- |
| Combat core | `src/objects/player.ts`, `src/objects/enemy.ts`, `src/systems/combat.ts` | movement, attacks, damage | §16.1 |
| Content data | `src/data/*.ts` | enemies, upgrades, waves | §16.1 |
| UI/meta | `src/ui/*.ts`, `src/scenes/meta.ts` | HUD, cards, results, shop | §16.1 |
| Director/level | `src/systems/director.ts`, `src/objects/spawner.ts` | waves, phases, spawning | §16.1 |
| Integration/balance | `src/scenes/game.ts`, `src/config.ts` | wiring, TUNING, playtest | all |

### 16.1 Interface contracts (real TypeScript)

```ts
// Agreed up front; no mid-flight renegotiation.
export interface EnemyDef { id: string; texture: string; size: number;
  stats: { maxHp: number; damage: number; moveSpeed: number; xp: number; currency: number };
  behaviour: 'chase' | 'orbit' | 'shoot' | 'charge' | 'split'; tint: number; }

export interface SpawnRequest { id: string; x: number; y: number; difficultyMul: number; }
export type SpawnFn = (req: SpawnRequest) => void;

export interface CombatApi { damageEnemy(id: number, amount: number, crit: boolean): void;
  damagePlayer(amount: number): void; }
```

These contracts **must also freeze the design-heuristics §12.2 drift surface**:
the full `TUNING` key list (§7), the `StatKey` union, every event name in
`core/keys.ts`, and every content id set (enemy/upgrade/wave/unit ids). The
integrator (Integration/balance workstream above) is the **only** editor of
that surface once the batch starts — every other workstream requests an
addition through the integrator rather than editing `src/config.ts` or
`core/keys.ts` directly (§12.3). `src/data/art.ts` is a **generated**
artifact (`scripts/gen-art-registry.mjs`, produced by the art pipeline's
integration step) and is never a workstream deliverable to hand-author.

Integration order: contracts → data + core systems in parallel → integrator wires
`GameScene` → balance pass.

### 16.2 Integrator checklist

- [ ] `npm run build` clean (tsc + vite).
- [ ] Full loop: menu → run → level-up draft → boss/finale → results → meta → retry.
- [ ] All numbers live in `TUNING`; no inline balance values.
- [ ] Save round-trips and migrates.
- [ ] 60fps at peak entity count (`?debug` readout).
- [ ] Every juice-table row observed once in a real run.

## 17. Cut list (not now)

Minimum 5 excluded features with the reason. An empty cut list means the scope is
unbounded — do not ship the PRD.

## 18. Assumptions

Every deferred decision with the value chosen. One line each (interactive
mode); in `auto` mode every axis's `Auto rule:` outcome, one line each in
`axis → chosen value — one-line rationale` form.

## 19. Acceptance criteria

- [ ] `npm run verify` passes (typecheck + `npm run sim` hard/soft gates +
  `node scripts/gen-art-registry.mjs --check` + every `src/sim/kits/*.selftest.ts`).
- [ ] Sim report attached: per-lane winrates, `firstUpgradeS`, decision
  cadence, for every named build lane (§8).
- [ ] Browser-bot loop completed with a screenshot at each state: menu → run
  → draft → pause → death/win → retry.
- [ ] A full 480s run is completable; win and loss both reachable.
- [ ] Primary verb works with touch and keyboard.
- [ ] Roster and upgrade pool match the content tables exactly, every entry
  carries a Flavor name and description (§5).
- [ ] At least 3 named strategies are playable and none trivially dominates.
- [ ] Meta save persists, migrates, and visibly changes the next run.
- [ ] 60fps at <N> entities; no unpooled hot spawns.
- [ ] Every juice-table event produces its visual and sound.
- [ ] Nothing interactive under the bottom 220px except full-width controls.
- Advisory only, not a gate: a muted 30s clip of the run should read as a
  game with escalating stakes.
```

---

## Definition of done for the PRD itself

Refuse to hand off until all hold:

1. Sections 1-19 present, no placeholder text.
2. Content tables meet the genre playbook's minimum viable volumes.
3. Balance table has ≥ 25 keys, every key with a unit.
4. Progression and scaling formulas present with worked values at 60/180/300/480s.
5. ≥ 3 named strategies with a non-domination argument each.
6. Build plan has 4-6 workstreams, one owner per file, and real TS contracts.
7. Juice table covers every gameplay event named anywhere in the PRD, with caps.
8. UI plan gives pixel coordinates inside SAFE and ≥ 88px tap targets.
9. Performance plan states peak counts and pooling mandates.
10. Cut list ≥ 5 entries; Assumptions lists every deferred decision.
11. All module/texture/sfx names exist in the template or are marked
    `NEW: <path> — <spec>`.
12. Every §5 content-table entry has a Flavor name (≤18 chars, drawn from
    §1's naming lexicon) and one-line description — no bare stat-block id or
    placeholder label (`dmg_up`, `Sharpened`, `enemy_02`) stands in for a name.
