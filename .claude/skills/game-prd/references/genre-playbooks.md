# Genre playbooks

Reference for the `game-prd` skill. All numbers below assume the fixed frame:
portrait 720x1280, `SAFE` top 140px / bottom 220px / side 40px, and a 480s
(8-minute) reference run — the midpoint of the mandated 5-10 minute run length.
Every module name is either a template file that exists today or is written as
`NEW: needs <file>` with a one-line spec. Template modules in scope: `core/config.ts`,
`core/keys.ts`, `core/state.ts` (`RunState`), `core/controls.ts` (`Controls`),
`core/juice.ts`, `core/audio.ts` (`sfx` names: `ui tap pickup combo jump hit die
levelup whoosh`), `core/textures.ts` (`disc ring square spike star particle
panel`), `core/rng.ts` (`Rng`), plus the systems batch landing alongside this
doc: `core/stats.ts`, `core/damage.ts`, `core/pool.ts`, `core/spatial.ts`,
`core/grid.ts`, `core/progression.ts`, `core/run.ts`, `data/enemies.ts`,
`data/upgrades.ts`, `data/waves.ts`, `ui/cards.ts`, `ui/bars.ts`.

Systems batch signatures cited throughout (fixed, do not re-derive):

```ts
// core/stats.ts
type StatKey = string;
interface Modifier { stat: StatKey; add?: number; mul?: number; source: string; }
const SIGNED_STATS: ReadonlySet<StatKey>;
function applyModifiers(base: number, mods: readonly Modifier[], stat: StatKey): number;
class StatBlock {
  constructor(base: Readonly<Record<StatKey, number>>);
  get(stat: StatKey): number;
  addModifier(mod: Modifier): void;
  removeBySource(source: string): void;
  snapshot(): Record<StatKey, number>;
}

// core/damage.ts
interface DamageEvent { amount: number; crit: boolean; source: string; }
class Health {
  constructor(max: number);
  hp: number; max: number; invulnMs: number;
  apply(ev: DamageEvent): boolean;
  heal(n: number): void;
  setMax(n: number, keepRatio?: boolean): void;
  get ratio(): number;
}
function rollDamage(stats: StatBlock, rng: Rng, source: string): DamageEvent;
function applyDot(health: Health, dps: number, deltaMs: number, source: string): boolean;

// core/pool.ts
class Pool<T> {
  constructor(create: () => T, reset: (item: T) => void, initial?: number);
  obtain(): T; release(item: T): void; releaseAll(): void; get active(): number;
}
class SpritePool {
  constructor(scene: Phaser.Scene, texture: string, initial?: number);
  obtain(x: number, y: number): Phaser.Physics.Arcade.Sprite;
  release(sprite: Phaser.Physics.Arcade.Sprite): void;
  releaseAll(): void; get active(): number;
}

// core/spatial.ts
class SpatialHash<T> {
  constructor(cellSize: number);
  clear(): void; insert(x: number, y: number, item: T): void;
  queryCircle(x: number, y: number, radius: number, out: T[]): T[];
  queryRect(minX: number, minY: number, maxX: number, maxY: number, out: T[]): T[];
}

// core/grid.ts
class NavGrid {
  constructor(cols: number, rows: number, tileSize: number);
  setBlocked(col: number, row: number, blocked: boolean): void;
  isBlocked(col: number, row: number): boolean;
  buildFlowField(goalCol: number, goalRow: number): void;
  steer(worldX: number, worldY: number, out: { x: number; y: number }): boolean;
  pathExists(fromCol: number, fromRow: number): boolean;
  worldToCell(worldX: number, worldY: number, out: { col: number; row: number }): void;
  cellToWorldCenter(col: number, row: number, out: { x: number; y: number }): void;
}

// core/progression.ts
interface MetaSave { version: number; currency: number; unlocks: string[]; upgrades: Record<string, number>; stats: { runs: number; wins: number; bestScore: number; bestTimeMs: number }; }
function loadMeta(): MetaSave;
function saveMeta(meta: MetaSave): void;
function resetMeta(): MetaSave;
function grantCurrency(n: number): MetaSave;
function buyUpgrade(id: string): { ok: boolean; meta: MetaSave; reason?: string };
function metaModifiers(): Modifier[];

// core/run.ts
interface WaveSpec { at: number; spawns: Array<{ id: string; count: number; everyMs?: number }>; label?: string; }
interface RunPhase { name: string; fromSeconds: number; difficultyMul: number; }
class RunDirector {
  constructor(scene: Phaser.Scene, waves: readonly WaveSpec[], phases: readonly RunPhase[], onSpawn: (id: string, index: number, total: number) => void, options?: { durationSeconds?: number; onPhaseChange?: (phase: RunPhase) => void });
  update(deltaMs: number): void;
  get elapsedSeconds(): number;
  get phase(): RunPhase;
  get difficulty(): number;
  get remainingSeconds(): number | null;
  pause(): void; resume(): void; get isPaused(): boolean;
}

// data/enemies.ts, data/upgrades.ts, data/waves.ts
interface EnemyDef { /* id, texture, baseStats, ai archetype */ }
const ENEMIES: EnemyDef[]; // 8 archetypes shipped
function scaleEnemy(def: EnemyDef, difficultyMul: number): EnemyDef;
interface UpgradeDef { id: string; name: string; description: string; rarity: string; modifiers: Modifier[]; maxStacks: number; }
interface MetaUpgradeDef { /* persistent shop entry */ }
function rollUpgradeChoices(rng: Rng, taken: string[], count: number): UpgradeDef[];
const META_UPGRADES: MetaUpgradeDef[];
const UPGRADE_CARDS: UpgradeDef[];
const WAVES: WaveSpec[]; // NEW confirm authoring convention per game — see per-genre notes

// ui/cards.ts, ui/bars.ts
function showUpgradeCards(scene: Phaser.Scene, choices: UpgradeDef[], onPick: (choice: UpgradeDef) => void): { destroy(): void };
class Bar extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number, options?: { color?: number; bgColor?: number; label?: string });
  setValue(current: number, max: number): void;
  followTarget(target: Phaser.GameObjects.Sprite | Phaser.GameObjects.Container, offsetY?: number): void;
  stopFollow(): void;
}
```

`data/waves.ts` ships composed `WaveSpec[]` timelines per difficulty tier (not
raw per-enemy tuning); each genre section below states how many timelines it
needs and at what density.

### Shared reference-run phase bands (480s)

All difficulty-scaling formulas below key off this shared phase table (locked
with `references/design-heuristics.md`):

| Phase | Window | Difficulty multiplier | Milestone |
| --- | --- | --- | --- |
| Grace | 0-20s | x1.0 | first threat ~20s |
| Early | 20-120s | x1.3 | first upgrade choice ~45s |
| Mid | 120-240s | x1.7 | first elite ~150s |
| Late | 240-360s | x2.3 | composition shift |
| Climax | 360-450s | x3.2 | boss ~420s |
| Resolution | 450-480s | x3.2 | run ends, results screen |

Content volume floor shared across genres (`min` / `comfortable`): enemy
archetypes 4/8, upgrades 12/24, bosses 1/3, rooms-waves 6/16, towers-units
4/10, items 6/16. Per-genre tables below sit at or above this floor and call
out any genre that needs more.

## Selection table

| # | Genre | Primary verb | Systems weight | Content volume (enemies/upgrades/rooms) | Build sessions | Best-fit pitch keywords |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Survivor-like | Move (drag/axis) | M | 8-12 / 16-24 / n/a (waves) | 1 | swarm, auto-attack, XP, screen-fill chaos |
| 2 | Action roguelike | Move + dodge/attack (hold+tap) | L | 8-10 / 18-24 / 8-14 rooms | 1.5 | room clear, boss gauntlet, dash-dodge |
| 3 | Tower defense | Place/drag towers (tap+drag) | L | 8-12 towers / 8-12 enemy types / 6-10 waves | 1.5 | economy, lane defense, flow field |
| 4 | Roguelike deckbuilder | Tap card, tap target | L | 8-10 enemies / 24-40 cards / 12-16 nodes | 1.5-2 | turn-based, draft, synergy deck |
| 5 | Auto-battler | Drag unit to board, tap ready | L | 8-14 units / 12-18 items / 6-8 rounds | 1.5-2 | draft, watch fight, comp synergy |
| 6 | Survival crafting | Tap gather, hold craft | L | 6-10 resources / 12-18 recipes / day-night | 1.5-2 | gather, craft, night threat |
| 7 | Base builder / defend-core | Tap build, drag placement | L | 8-12 buildings / 8-12 enemy types / 6-10 waves | 1.5-2 | build economy, core defense, waves |
| 8 | Bullet hell | Drag ship | M | 1-2 bosses / 8-14 patterns / 4-6 phases | 1 | pattern dodge, bullet curtain, near-miss |
| 9 | Turn-based tactics | Tap tile, tap ability | L | 8-10 units / 12-16 abilities / 8-12 maps | 1.5-2 | grid combat, ability combos, small squad |
| 10 | Idle/incremental (active layer) | Tap to boost, tap upgrade | M | 8-12 generators / 16-24 upgrades / n/a | 1 | exponential economy, prestige, click-assist |
| 11 | Extraction run | Move + tap loot, hold to extract | M | 8-12 enemies / 12-18 loot tiers / 8-14 rooms | 1-1.5 | risk-reward, bank or push, tension |
| 12 | Dungeon crawler | Tap tile to move/attack | L | 8-12 enemies / 16-24 items / 10-16 rooms | 1.5-2 | fog of war, grid rooms, inventory |

## 1. Survivor-like

Auto-attack, XP orbs, level-up pick-1-of-3 cards, escalating swarms — the
`Vampire Survivors` loop compressed into 480s with a portrait-safe hitbox.

### Core loop and run shape

**Core loop:** move to dodge and collect XP orbs while equipped weapons
auto-fire at the nearest/random targets, leveling up into stronger builds
until the wave composition overwhelms the build or the timer ends.

| Time | Beat |
| --- | --- |
| 0:00-0:20 | Grace. Player + 1 starting weapon visible, 2-4 weak enemies spawn to teach movement and auto-fire. |
| 0:20-0:45 | First real wave; first XP orbs drop; first level-up card at ~0:45. |
| 0:45-2:00 | Early phase (x1.3). 2-3 enemy archetypes on screen, 2-3 more level-ups, build direction emerges. |
| 2:00-4:00 | Mid phase (x1.7). First elite (~2:30) with a telegraphed attack; weapon evolution/synergy unlocks if 2 base items maxed. |
| 4:00-6:00 | Late phase (x2.3). Screen density climbs toward the 300-entity budget; player reads as visibly overwhelmed-but-surviving. |
| 6:00-7:30 | Climax (x3.2). Boss or elite swarm spawns at ~7:00; hardest 60-90s of the run. |
| 7:30-8:00 | Resolution. Boss dies or timer ends; results screen: time survived, kills, level, meta currency earned. |

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Drag / axis move | Player follows finger or WASD/arrows | `Controls.onDrag`, `controls.axisX/axisY` |
| Tap on card | Pick 1 of 3 level-up upgrade | `showUpgradeCards` `onPick` |
| Hold (optional) | Toggle auto-aim priority (nearest vs lowest-HP) | `Controls.onHoldStart/onHoldEnd` |

No manual attack input — the genre's identity is "movement is the whole
skill expression"; weapons fire from `StatBlock` derived cooldowns.

### Systems required

| Module | Use |
| --- | --- |
| `core/stats.ts` | Per-weapon `StatBlock` (damage, cooldown, area, projectile count, crit) fed by `Modifier[]` from cards |
| `core/damage.ts` | `Health` on player and every enemy; `rollDamage` per weapon tick; `applyDot` for burn/poison weapons |
| `core/pool.ts` | `SpritePool` per weapon projectile type and per enemy archetype (5-8 pools) |
| `core/spatial.ts` | `SpatialHash` for nearest-enemy targeting and projectile-enemy overlap (mandatory at this density) |
| `core/run.ts` | `RunDirector` drives `WaveSpec[]` timeline and `RunPhase[]` difficulty multiplier |
| `core/progression.ts` | Meta currency + `metaModifiers()` applied to starting `StatBlock` |
| `data/enemies.ts` | `ENEMIES` + `scaleEnemy(def, difficultyMul)` per phase |
| `data/upgrades.ts` | `UPGRADE_CARDS`, `rollUpgradeChoices` for the level-up draft |
| `data/waves.ts` | Wave timeline feeding `RunDirector` |
| `ui/cards.ts` | `showUpgradeCards` for level-up screen |
| `ui/bars.ts` | `Bar` for player HP and XP-to-next-level |
| NEW: needs `objects/weapon.ts` | Per-weapon controller: owns a `StatBlock`, a `SpritePool`, and a fire-timer; not in the systems batch, this is a game-specific entity built on top of it. |

### Content volume

| Item | Target | Minimum viable |
| --- | --- | --- |
| Enemy archetypes | 8-12 | 5 (grunt, fast, tank, ranged, elite) |
| Weapons | 5-7 | 3 (melee arc, projectile, orbiting) |
| Upgrade cards (incl. weapon evolutions) | 16-24 | 12 |
| Bosses | 1-2 | 1 |
| Meta upgrades | 6-8 | 4 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `player.speed` | 260 | 200-320 | px/s | drag-follow max speed |
| `player.radius` | 28 | 24-34 | px | collision body |
| `player.baseHp` | 100 | 80-140 | HP | `Health` max |
| `player.invulnMs` | 400 | 300-600 | ms | i-frames after contact damage |
| `xp.orbBaseValue` | 3 | 2-5 | XP | per orb |
| `xp.orbMagnetPx` | 90 | 60-140 | px | pickup radius that pulls orbs in |
| `xp.curveBase` | 12 | 10-16 | XP | level-1 requirement |
| `xp.curveGrowth` | 1.28 | 1.2-1.4 | multiplier/level | requirement growth per level |
| `weapon.baseCooldownMs` | 900 | 500-1400 | ms | starting weapon fire interval |
| `weapon.baseDamage` | 8 | 5-14 | HP | pre-modifier hit |
| `enemy.spawnMsStart` | 1400 | 1000-1800 | ms | interval at Grace |
| `enemy.spawnMsFloor` | 140 | 100-200 | ms | hard floor at Climax |
| `enemy.baseSpeed` | 90 | 60-140 | px/s | grunt archetype |
| `enemy.contactDamage` | 8 | 5-15 | HP | per hit, gated by `player.invulnMs` |
| `elite.hpMul` | 6 | 4-10 | multiplier | vs grunt baseline |
| `boss.hpMul` | 40 | 25-60 | multiplier | vs grunt baseline |
| `entityBudgetLive` | 300 | 250-320 | count | hard cap, oldest/offscreen culled first |
| `meta.currencyPerRunBase` | 40 | 25-60 | currency | scales with survival time |

### Progression math

XP-to-next-level: `xpNeeded(L) = curveBase * curveGrowth^(L-1)`.

| Level | xpNeeded | Cumulative XP | Reached at (worked) |
| --- | --- | --- | --- |
| 1 | 12 | 12 | ~0:20 |
| 5 | 12 * 1.28^4 ≈ 32 | ≈98 | ~1:00 |
| 10 | 12 * 1.28^9 ≈ 108 | ≈470 | ~3:00 |
| 16 | 12 * 1.28^15 ≈ 439 | ≈1850 | ~5:00 |
| 20 | 12 * 1.28^19 ≈ 1150 | ≈3600 | ~8:00 |

Difficulty per phase (shared table): `enemySpawnMs(t) = max(floor, start * decay^stepsElapsed)`
with `decay = 0.985` per `rampIntervalMs = 1000ms`, and `enemyHp(t) = baseHp *
difficultyMul(phase)`. Worked: at Mid (t=180s, x1.7) a grunt has `18 * 1.7 =
30.6 HP`; at Climax (t=420s, x3.2) `18 * 3.2 = 57.6 HP` before elite/boss
multipliers.

### Meta progression

Persists via `MetaSave.currency` and `MetaSave.upgrades[id]` (stack counts),
applied every run through `metaModifiers()` folded into starting `StatBlock`.
Currency source: `grantCurrency(floor(survivalSeconds * 0.6) + kills * 0.4)`
at run end via `RunState.end()` hand-off.

| Meta upgrade | Effect | Cost formula |
| --- | --- | --- |
| Vitality | +10 max HP per stack | `cost(n) = 50 * 1.35^n` |
| Haste | +4% move speed per stack | `cost(n) = 60 * 1.4^n` |
| Might | +6% weapon damage per stack | `cost(n) = 70 * 1.4^n` |
| Greed | +8% XP gain per stack | `cost(n) = 55 * 1.35^n` |
| Magnet | +20px pickup radius per stack | `cost(n) = 40 * 1.3^n` |
| Reroll token | +1 free card reroll per run | `cost(n) = 80 * 1.5^n` |
| Starting weapon slot | Unlock a 2nd starting weapon choice | flat 300 |
| Revive | One free revive at 1 HP per run | flat 500 |

### Build variety

Minimum 3 viable strategies, proven in the PRD by naming the synergy chain
for each: (1) area-clear (orbiting + AoE weapons + `area` modifiers stacked),
(2) single-target burst (crit + projectile-count + `might` meta), (3)
sustain/kiting (speed + magnet + regen modifiers, weak weapons but never hit).
The PRD's upgrade-card table must tag each card with which archetype(s) it
serves so a build reviewer can trace at least 3 disjoint paths through 16+
cards without re-using the same 4 cards.

### Portrait UI plan

Player and action stay in the middle 900px vertical band (y 140-1060). HP
bar (`Bar`, 280x28px) pinned top-center at y=SAFE.top-70; XP bar (`Bar`,
640x14px) spans full width at y=SAFE.top-20. Level-up cards (`showUpgradeCards`)
render as 3 stacked full-width panels (640x180px each) centered in the
680-1060 y band when triggered, pausing the run — no thumb occlusion since
input is paused during the choice. No permanent bottom-220 UI; joystick
region if used is a virtual drag zone in the bottom 300px that produces no
visible chrome.

### Performance plan

Peak live entities ~300 (enemies + projectiles + XP orbs + particles) at the
Climax phase. Every enemy, projectile, and XP orb is `SpritePool`-backed
(5-8 enemy pools, 3-5 projectile pools, 1 orb pool). `SpatialHash` is
mandatory: nearest-enemy targeting and projectile-vs-enemy overlap are both
O(1) neighborhood queries at this density; a naive O(n²) scan collapses fps
past ~150 entities. fps risk is highest during the boss phase when the
screen holds boss + 100+ adds + 150+ projectiles simultaneously — cap total
active projectiles per weapon type and cull off-`SAFE`-bounds projectiles
every frame.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Combat core | Player movement, weapon fire loop, damage application | `interface WeaponDef { id: string; cooldownMs: number; fire(scene: Phaser.Scene, from: Phaser.Math.Vector2, stats: StatBlock, targets: SpatialHash<Enemy>): void }` |
| Content/data | `data/enemies.ts` extensions, `data/upgrades.ts` extensions, `data/waves.ts` timeline | `interface EnemyDef { id: string; texture: string; baseStats: Record<StatKey, number>; ai: 'chase' \| 'ranged' \| 'orbit' }` |
| UI/meta | HUD bars, level-up card flow, meta shop scene | `function onLevelUp(choices: UpgradeDef[]): Promise<UpgradeDef>` wrapping `showUpgradeCards` |
| Level/systems | `RunDirector` wiring, `NavGrid`-free (open arena — no pathing needed), `SpatialHash` setup | `function spawnEnemy(id: string, x: number, y: number, difficultyMul: number): Enemy` |
| Balance pass (integrator) | Tunes `TUNING`, phase multipliers, verifies 300-entity budget, wires all workstreams into `game.ts` | consumes all contracts above |

### Pitfalls

1. Open-field auto-fire reads as static on a 720px-wide portrait screen — force enemies to approach from all sides, not just top, or the clip looks like a shooting gallery.
2. XP orb pile-ups near the player without a magnet radius create dead frames where nothing visually changes for 2-3s.
3. Card choice screen pausing physics but not tweens leaves floating text mid-animation — must pause the whole scene, not just `RunDirector`.
4. Difficulty curve tuned for a 60s test run reads as trivial for the first 4 minutes of an 8-minute run — the ramp constant must be validated against the full 480s, not the sprint-testing habit from the base template.
5. Weapon `SpritePool` sized too small causes visible pop-in/out as projectiles are recycled mid-flight — pool size must exceed `weapon.baseCooldownMs`-derived max concurrent count with headroom.

### Video hook

30-60s clip: 0-10s calm grace period (readability), 10-35s visible escalation
as 2-3 more enemy types and a level-up card appear, 35-55s the screen fills
toward the entity budget with the player weaving through a dense swarm,
55-60s payoff — an AoE ultimate or evolved weapon clears the entire visible
swarm in one `burst` + `hitstop` + `shake` beat. Payoff moment: the
screen-clear proc.

## 2. Action roguelike

Room-to-room combat with dodge/attack and a boss finale — a compressed
`Hades`/`Enter the Gungeon` loop for one 480s run.

### Core loop and run shape

**Core loop:** clear a room of enemies with attack and dodge, walk through
the cleared door, pick a reward, repeat through a short branching floor until
a boss room ends the run.

| Time | Beat |
| --- | --- |
| 0:00-0:20 | Grace room: 1-2 weak enemies, teaches attack + dodge. |
| 0:20-1:30 | Rooms 2-3: introduce a second enemy archetype and the first item/upgrade reward. |
| 1:30-3:00 | Rooms 4-6: room density rises (Mid, x1.7), first mini-elite room. |
| 3:00-5:00 | Rooms 7-9: Late phase (x2.3), a "vault" risk room (harder fight, better reward) appears. |
| 5:00-6:30 | Final approach: last reward room, then boss door. |
| 6:30-7:45 | Boss fight (Climax x3.2, 2-3 telegraphed phases). |
| 7:45-8:00 | Resolution: victory/defeat screen, meta currency, run recap. |

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Drag / axis move | Player moves | `Controls.onDrag`, `controls.axisX/axisY` |
| Tap | Primary attack in facing/move direction | `Controls.onTap` |
| Swipe | Dodge-roll in swipe direction, grants i-frames | `Controls.onSwipe` |
| Hold | Charge heavy attack, release to fire | `Controls.onHoldStart/onHoldEnd` |

### Systems required

| Module | Use |
| --- | --- |
| `core/stats.ts` | Player and enemy `StatBlock` (damage, attack speed, dodge cooldown, crit) |
| `core/damage.ts` | `Health`, `rollDamage` for attacks, `applyDot` for status weapons |
| `core/pool.ts` | `SpritePool` for projectiles, enemy archetypes, room-clear particles |
| `core/spatial.ts` | `SpatialHash` for attack-hitbox-vs-enemy and enemy-vs-player queries |
| `core/grid.ts` | `NavGrid` per room for enemy pathing around room obstacles |
| `core/run.ts` | `RunDirector` sequences room `WaveSpec[]` and boss `RunPhase[]` |
| `core/progression.ts` | Meta currency, permanent unlocks (starting weapons, extra reward reroll) |
| `data/enemies.ts` | Room enemy rosters, `scaleEnemy` per room depth |
| `data/upgrades.ts` | In-run reward pool (boons), `rollUpgradeChoices` for reward rooms |
| `ui/cards.ts` | `showUpgradeCards` for reward-room pick |
| `ui/bars.ts` | Player HP bar, boss HP bar |
| NEW: needs `objects/room.ts` | Room container: door state, enemy roster, obstacle layout, clear-condition; not in the systems batch. |
| NEW: needs `core/floorgen.ts` | Deterministic room-graph generator (linear-with-branches, N rooms, `Rng`-seeded); one-line spec: `generateFloor(rng: Rng, roomCount: number): RoomNode[]` where `RoomNode` has `id`, `kind`, `neighbors: string[]`. |

### Content volume

| Item | Target | Minimum viable |
| --- | --- | --- |
| Enemy archetypes | 8-10 | 5 |
| Rooms per run | 8-14 | 6 |
| Boons/upgrades | 18-24 | 12 |
| Bosses | 1-2 | 1 |
| Starting weapons | 3-4 | 2 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `player.speed` | 300 | 240-360 | px/s | |
| `player.baseHp` | 100 | 80-140 | HP | |
| `player.attackDamage` | 14 | 8-20 | HP | base hit |
| `player.attackCooldownMs` | 380 | 250-500 | ms | |
| `player.dodgeSpeed` | 700 | 550-900 | px/s | dash speed during dodge |
| `player.dodgeMs` | 220 | 150-300 | ms | dodge duration |
| `player.dodgeIframesMs` | 220 | 150-300 | ms | i-frames = full dodge duration |
| `player.dodgeCooldownMs` | 650 | 400-900 | ms | |
| `player.heavyChargeMs` | 700 | 400-1000 | ms | full charge time |
| `player.heavyDamageMul` | 2.5 | 2-4 | multiplier | vs base attack |
| `room.clearRadius` | 900 | 700-1100 | px | door unlock trigger area |
| `room.enemiesPerRoomBase` | 3 | 2-5 | count | Grace/Early rooms |
| `room.enemiesPerRoomLate` | 7 | 5-10 | count | Late/Climax rooms |
| `boss.baseHp` | 600 | 400-900 | HP | |
| `boss.phaseCount` | 3 | 2-3 | count | telegraph phases |
| `entityBudgetLive` | 120 | 80-150 | count | per-room cap (rooms are small, not swarm-scale) |
| `meta.currencyPerRunBase` | 60 | 40-90 | currency | scales with rooms cleared |

### Progression math

No XP/level curve; power comes from in-run boon stacking. Room enemy count:
`enemiesInRoom(depth) = round(enemiesPerRoomBase + (enemiesPerRoomLate -
enemiesPerRoomBase) * min(1, depth / totalRooms))`. Worked at `totalRooms=10`:
room 1 → 3, room 5 → 5, room 8 → 6.6→7, room 10 → 7. Boss hp scales with
meta unlocks: `bossHp = baseHp * (1 + 0.05 * metaBossUnlocks)`.

Difficulty multiplier follows the shared phase table applied to `scaleEnemy`
per room's phase: Mid room enemy HP `= baseHp * 1.7`, Climax boss phase
transition triggers at `boss.hp <= baseHp * (1 - phaseIndex/phaseCount)`.

### Meta progression

Persists via `MetaSave.unlocks` (starting weapons, floor variants) and
`MetaSave.upgrades` (permanent stat boosts). Currency source:
`grantCurrency(roomsCleared * 12 + bossDefeated * 100)`.

| Meta upgrade | Effect | Cost formula |
| --- | --- | --- |
| Max HP+ | +15 max HP per stack | `cost(n) = 60 * 1.35^n` |
| Starting weapon B | Unlock 2nd starting weapon | flat 250 |
| Extra reroll | +1 reward reroll per run | `cost(n) = 80 * 1.4^n` |
| Dodge master | -10% dodge cooldown per stack | `cost(n) = 70 * 1.4^n` |
| Vault key | Unlock risk-room access from room 1 | flat 200 |
| Boss preview | Boss HP bar shows phase thresholds | flat 100 |
| Extra life | 1 free revive at 30% HP | flat 400 |
| Curse resistance | -20% negative-boon severity | `cost(n) = 90 * 1.45^n` |

### Build variety

Minimum 3 strategies proven by boon synergy tags: (1) crit-burst (attack
speed + crit chance + crit multiplier boons), (2) dodge-tank (i-frame
extension + on-dodge damage boons, aggressive no-hit play), (3) heavy-charge
(charge-time reduction + heavy-damage boons, slow methodical clears). The PRD
lists each boon's synergy tag(s) so a reviewer can trace 3 non-overlapping
6+-boon chains.

### Portrait UI plan

Combat arena fills y 140-1060 (SAFE-respecting). Player HP `Bar` top-left at
(SAFE.side, SAFE.top-70, 220x24). Boss HP `Bar` full-width at y=SAFE.top-30
only during boss rooms. Reward-room card picker (`showUpgradeCards`) uses the
same paused full-width 3-panel layout as the survivor-like. Dodge/attack
input is gesture-based (tap/swipe/hold) with no on-screen buttons, so nothing
occupies the bottom 220px during combat; a pause button (44x44) sits at
top-right corner within SAFE.

### Performance plan

Peak entities ~80-120 per room (well under the 300 budget — rooms are small
and enclosed, not swarm-scale). `SpritePool` covers enemy archetypes and
attack-hitbox effects. `SpatialHash` is optional at this density but
recommended for consistency with the shared systems batch and to keep
attack-hit queries O(1) during heavy-attack AoE hits. `NavGrid` per room is
the main fps risk: rebuilding `buildFlowField` every frame for 5-7 enemies is
wasteful — rebuild only on player-cell change or every 200ms.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Combat core | Player attack/dodge/heavy, hit detection | `interface AttackHitbox { damage: number; radius: number; knockback: number; ownerFaction: 'player' \| 'enemy' }` |
| Content/data | Enemy rosters, boon pool, boss phase scripts | `interface BossPhase { hpThreshold: number; pattern: 'charge' \| 'sweep' \| 'summon'; telegraphMs: number }` |
| UI/meta | HUD bars, reward-room flow, meta shop | `function onRoomCleared(roomId: string): void` triggers reward/door unlock |
| Level/systems | `floorgen.ts`, `room.ts`, `NavGrid` per room, `RunDirector` room sequencing | `function generateFloor(rng: Rng, roomCount: number): RoomNode[]` |
| Balance pass (integrator) | Tunes room density, boss HP/phase thresholds, wires all workstreams into `game.ts` | consumes all contracts above |

### Pitfalls

1. Room transitions that reset camera/position abruptly break the "one
   continuous run" feel expected in this genre — always fade or scroll, never hard-cut.
2. Dodge i-frames misaligned with the dodge animation duration make hits feel
   unfair ("I dodged and still got hit") — `dodgeIframesMs` must equal `dodgeMs`, not be shorter.
3. `NavGrid` rebuilt every frame per room tanks fps with even 5-7 enemies — cache and rebuild on a timer, not per-tick.
4. A single boss fight for an 8-minute run without phase variety feels like a damage-sponge, not a fight — mandate 2-3 visually distinct phases.
5. Reward-room boon pool without synergy tagging produces builds that all play identically — every boon needs an explicit archetype tag from day one, not retrofitted.

### Video hook

30-60s clip: 0-8s clear a small room with satisfying attack+dodge, 8-20s a
reward pick (visible card choice, juicy `pop`+`sfxArp`), 20-45s a harder room
or vault fight showing dodge-timing tension (near-miss hitstop beats),
45-60s the boss's first phase-transition telegraph and the player's dodge
through it. Payoff moment: the boss phase-transition dodge — biggest visual
spectacle (`shake` + `flash` + particle burst) paired with the closest call.

## 3. Tower defense

Lane/flow-field pathing with a build economy — place towers to stop waves
before they reach the core.

### Core loop and run shape

**Core loop:** spend earned currency to place/upgrade towers along the
enemy's flow-field path, survive a wave, collect wave-clear currency, repeat
against harder waves until a final wave or boss wave ends the run.

| Time | Beat |
| --- | --- |
| 0:00-0:20 | Grace: empty board, starting currency, place first 1-2 towers. |
| 0:20-1:30 | Waves 1-3 (Early, x1.3): single enemy type, teaches placement and targeting. |
| 1:30-3:00 | Waves 4-6 (Mid, x1.7): second enemy type (armored/fast), first tower upgrade. |
| 3:00-5:00 | Waves 7-9 (Late, x2.3): third enemy type, path pressure forces re-optimizing layout. |
| 5:00-6:30 | Waves 10-11: elite wave, economy crunch (upgrade vs. new tower decision). |
| 6:30-7:45 | Final/boss wave (Climax, x3.2): high-HP breaker enemy testing peak DPS. |
| 7:45-8:00 | Resolution: core HP remaining, wave reached, meta currency. |

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Tap empty tile | Open tower-build menu for that tile | `Controls.onTap` |
| Drag from shop icon | Drag-place a tower onto a valid tile | `Controls.onDrag` |
| Tap placed tower | Open upgrade/sell menu | `Controls.onTap` |
| Hold on tower | Preview range ring | `Controls.onHoldStart/onHoldEnd` |

### Systems required

| Module | Use |
| --- | --- |
| `core/grid.ts` | `NavGrid` for enemy flow-field pathing around placed towers (`buildFlowField`, `steer`) — mandatory, this is the genre's core system |
| `core/stats.ts` | Tower `StatBlock` (damage, range, fire rate) and enemy `StatBlock` (HP, speed, armor) |
| `core/damage.ts` | `Health` on enemies and the core; `rollDamage` per tower shot |
| `core/pool.ts` | `SpritePool` for projectiles and enemy archetypes |
| `core/spatial.ts` | `SpatialHash` for tower target-acquisition (nearest/first/strongest-in-range) |
| `core/run.ts` | `RunDirector` with `WaveSpec[]` timeline, `onSpawn` feeding enemies onto the path start cell |
| `core/progression.ts` | Meta currency, unlocked tower types, starting-currency bonus |
| `data/enemies.ts` | Enemy rosters (ground/armored/fast/flying if supported) |
| `data/waves.ts` | Wave composition timelines |
| `ui/bars.ts` | Core HP bar, tower upgrade progress indicator |
| NEW: needs `objects/tower.ts` | Tower entity: placement validity check against `NavGrid.isBlocked`, target acquisition via `SpatialHash`, fire loop; game-specific, not in the systems batch. |
| NEW: needs `ui/towerShop.ts` | Bottom-docked buildable-tower tray with drag-to-place and cost display; one-line spec: `class TowerShop extends Phaser.GameObjects.Container { constructor(scene, defs: TowerDef[], onDragStart: (def: TowerDef) => void) }`. |

### Content volume

| Item | Target | Minimum viable |
| --- | --- | --- |
| Tower types | 8-12 | 4 |
| Enemy types | 8-12 | 5 |
| Waves | 10-14 | 6 |
| Path layouts (maps) | 2-3 | 1 |
| Tower upgrade tiers | 2-3 per tower | 2 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `core.startHp` | 20 | 15-30 | HP | leaks decrement this |
| `economy.startCurrency` | 150 | 100-200 | currency | |
| `economy.waveClearBonus` | 25 | 15-40 | currency | per wave, scales with wave# |
| `economy.killReward` | 3 | 2-6 | currency | per basic enemy |
| `tower.baseCost` | 50 | 30-80 | currency | cheapest tower |
| `tower.baseRange` | 180 | 120-260 | px | |
| `tower.baseFireRateMs` | 700 | 400-1000 | ms | |
| `tower.baseDamage` | 12 | 6-25 | HP | |
| `tower.upgradeCostMul` | 1.6 | 1.4-1.8 | multiplier | per upgrade tier |
| `enemy.baseHp` | 30 | 20-50 | HP | wave 1 grunt |
| `enemy.baseSpeed` | 70 | 50-100 | px/s | grid cells/s equivalent |
| `enemy.armorReduction` | 0.3 | 0.15-0.4 | fraction | armored archetype damage reduction |
| `enemy.leakDamage` | 1 | 1-3 | core HP | per enemy reaching the core |
| `grid.cols` | 9 | 7-11 | tiles | portrait-width board |
| `grid.rows` | 14 | 10-18 | tiles | portrait-height board |
| `grid.tileSize` | 72 | 56-90 | px | 9 cols * 72 = 648px, fits 720 width minus margins |
| `wave.intervalMs` | 3000 | 2000-4000 | ms | gap between waves for shopping |
| `entityBudgetLive` | 150 | 100-200 | count | enemies + projectiles concurrently |

### Progression math

Enemy HP per wave: `hp(wave) = baseHp * difficultyMul(phase) * 1.12^wave`.
Worked (baseHp=30): wave 3 (Early, x1.3) → `30*1.3*1.12^3 ≈ 54.7`; wave 6
(Mid, x1.7) → `30*1.7*1.12^6 ≈ 100.4`; wave 9 (Late, x2.3) → `30*2.3*1.12^9
≈ 191.9`; wave 12 (Climax, x3.2) → `30*3.2*1.12^12 ≈ 373.4`. Economy grows
linearly: `waveClearBonus(wave) = 25 + wave*4`, so by wave 12 a clear pays 73
currency, funding one more tower or two upgrades.

### Meta progression

Persists via `MetaSave.unlocks` (tower types) and `MetaSave.upgrades`
(starting currency bonus, global damage%). Currency source:
`grantCurrency(wavesCleared * 15 + coreHpRemaining * 5)`.

| Meta upgrade | Effect | Cost formula |
| --- | --- | --- |
| Starting funds | +25 starting currency per stack | `cost(n) = 50 * 1.3^n` |
| Unlock Tower C | New tower archetype (e.g. slow/AoE) | flat 200 |
| Unlock Tower D | New tower archetype (e.g. sniper) | flat 300 |
| Core reinforcement | +5 max core HP per stack | `cost(n) = 60 * 1.35^n` |
| Global damage | +3% all tower damage per stack | `cost(n) = 80 * 1.45^n` |
| Interest | +5% currency income per stack | `cost(n) = 90 * 1.4^n` |
| Second map | Unlock alternate path layout | flat 250 |
| Overcharge | Free instant tower upgrade once per run | flat 400 |

### Build variety

Minimum 3 strategies via tower comp, proven by tagging each tower with a role
in the PRD: (1) chokepoint AoE (splash towers stacked at one narrow bend),
(2) sniper focus-fire (high single-target DPS towers picking off armored/elite
enemies before they reach chokepoints), (3) slow-and-swarm (cheap slow towers
everywhere + a few DPS towers, wins on tempo not raw damage). The PRD must
show at least one map layout where each strategy has a distinct viable tile
allocation.

### Portrait UI plan

Board occupies y 140-980 (9x14 grid at 72px tiles = 648x1008, centered
horizontally, clipped to SAFE top/bottom). Core HP `Bar` pinned top-center at
y=SAFE.top-70. Currency counter top-right within SAFE. Tower shop
(`TowerShop`) docks in the bottom 220px as a horizontal scrollable tray of
4-6 tower icons (each ≥64px tap target) — this is the one deliberate
exception to "nothing interactive under 220px" because it is a full-width
persistent tray, matching the PRD template's allowance for full-width bottom
buttons. Drag-to-place previews a range ring and snap-to-grid highlight
before drop.

### Performance plan

Peak entities ~100-150 (enemies + tower projectiles) at Climax waves — under
the 300 budget since towers are static (not pooled as moving sprites) and
only enemies/projectiles churn. `SpritePool` for enemy archetypes and every
tower's projectile type. `SpatialHash` is mandatory for tower targeting
(range queries every fire-cooldown tick across up to 12 towers x 100+
enemies is O(towers*enemies) without it). `NavGrid.buildFlowField` must be
rebuilt only when a tower placement changes the grid, not per frame — this is
the single biggest fps risk if implemented naively.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Combat core | Tower fire loop, projectile damage, target acquisition | `interface TowerDef { id: string; cost: number; range: number; fireRateMs: number; damage: number; targeting: 'nearest' \| 'first' \| 'strongest' }` |
| Content/data | Tower roster, enemy roster, wave timelines | `interface WaveSpec` (from `core/run.ts`) populated per map |
| UI/meta | `TowerShop`, core HP bar, currency display, meta shop scene | `function onTowerSelected(def: TowerDef): void` |
| Level/systems | Map/grid authoring, `NavGrid` setup and flow-field rebuild triggers | `function placeTower(col: number, row: number, def: TowerDef): boolean` (returns false if blocked/invalid) |
| Balance pass (integrator) | Tunes wave HP curve, tower costs/damage, wires all workstreams into `game.ts` | consumes all contracts above |

### Pitfalls

1. Flow-field not rebuilt after every tower placement lets enemies walk
   through towers as if they weren't there — rebuild must be synchronous with placement, not deferred.
2. A 9-13 column grid at readable tile size (≥56px) barely fits 720px width —
   test the grid math against `VIEW.width` before committing to column count.
3. Drag-to-place towers conflicts with `Controls.onDrag` used for camera/board
   panning if both exist — this genre should not add board panning; keep the whole board visible at once.
4. Tower upgrade menus opened via tap can occlude the board under the finger —
   always open the upgrade panel offset from the tapped tower, never centered on it.
5. Wave-clear currency that doesn't scale with wave number makes late waves
   economically unwinnable even with perfect play — verify the worked economy table before locking `TUNING`.

### Video hook

30-60s clip: 0-10s empty board fills with the first few towers (satisfying
build montage), 10-30s a wave visibly dies at the chokepoint with layered
projectile/particle feedback, 30-50s a harder wave nearly breaches (tension,
core HP bar drops), 50-60s payoff — an upgraded/AoE tower one-shots a wave of
armored enemies simultaneously. Payoff moment: the simultaneous multi-kill on
an upgraded AoE tower.

## 4. Roguelike deckbuilder

Turn-based card combat with a run-length draft, in the vein of `Slay the
Spire` compressed to 480s.

### Core loop and run shape

**Core loop:** play cards from a hand against one enemy (or small group) each
turn, spending energy, until the enemy dies or the player does; after each
fight, draft a new card or reward, then move to the next node on a branching
map.

| Time | Beat |
| --- | --- |
| 0:00-0:20 | Grace: starter deck shown, first easy fight begins immediately (readability over mechanics-teaching screen). |
| 0:20-1:30 | Fights 1-2 (Early, x1.3): single enemy, teaches energy/hand/discard. |
| 1:30-3:00 | Fights 3-4 (Mid, x1.7): 2-enemy fights, first card reward choices shape the deck. |
| 3:00-5:00 | Fights 5-6 (Late, x2.3): elite fight with a unique mechanic (e.g. enemy that buffs each turn). |
| 5:00-6:30 | Fight 7 + shop/rest node: last deck-shaping choice before boss. |
| 6:30-7:45 | Boss fight (Climax, x3.2), 2-3 phases via `RunPhase`-driven enemy intent changes. |
| 7:45-8:00 | Resolution: victory/defeat, deck recap, meta currency. |

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Tap card | Select card (shows valid targets if targeted) | `Controls.onTap` |
| Tap target | Confirm play against a target (or auto-resolves if untargeted) | `Controls.onTap` |
| Drag card | Drag card up into a "play zone" to commit (alternative to tap-tap) | `Controls.onDrag` |
| Tap end-turn button | Ends turn, resolves enemy intents | `Controls.onTap` on a `Button` |

Recommend drag-to-play as the primary verb (reads better on video than
tap-tap) with tap-to-confirm as the fallback path for accessibility; the PRD
picks exactly one as primary per the "no adjective, one verb" rule.

### Systems required

| Module | Use |
| --- | --- |
| `core/stats.ts` | Player/enemy `StatBlock` (HP, block, strength, energy); card effects apply `Modifier` for buffs/debuffs |
| `core/damage.ts` | `Health`, `rollDamage` for card damage, `applyDot` for poison/burn cards |
| `core/pool.ts` | `SpritePool` not central here (few sprites); reused for hit-effect particles |
| `core/run.ts` | `RunDirector`-style phase gating repurposed for boss `RunPhase[]` intent scripts (fight-internal turns, not wall-clock) |
| `core/progression.ts` | Meta currency, unlocked starter cards, relic slots |
| `data/upgrades.ts` | Card pool source; `UpgradeDef` reused as `CardDef` (`modifiers: Modifier[]` = card's stat effect), `rollUpgradeChoices` for post-fight draft |
| `ui/cards.ts` | `showUpgradeCards` reused for post-fight card draft (3-of pick) |
| `ui/bars.ts` | Player/enemy HP bars, enemy block/buff icons |
| NEW: needs `core/deck.ts` | Deck/hand/discard/exhaust pile management, draw-N-per-turn, shuffle-on-empty; one-line spec: `class Deck { constructor(cards: CardDef[], rng: Rng); draw(n: number): CardDef[]; discard(cards: CardDef[]): void; shuffleIfEmpty(): void }`. |
| NEW: needs `core/enemyIntent.ts` | Telegraphed enemy turn-intent (attack/defend/buff shown 1 turn ahead); one-line spec: `function nextIntent(enemy: EnemyCombatant, turn: number, rng: Rng): Intent` where `Intent = { kind: 'attack' \| 'defend' \| 'buff'; value: number }`. |
| NEW: needs `objects/handUI.ts` | Renders the hand as a fanned card row in the bottom-safe band; game-specific view over `Deck`. |

### Content volume

| Item | Target | Minimum viable |
| --- | --- | --- |
| Cards (pool) | 24-40 | 18 |
| Enemy types | 8-10 | 5 |
| Relics/passive items | 8-12 | 5 |
| Map nodes | 12-16 | 8 |
| Bosses | 1-2 | 1 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `player.startHp` | 60 | 50-80 | HP | |
| `player.energyPerTurn` | 3 | 3-4 | energy | |
| `player.handSize` | 5 | 4-6 | cards | drawn per turn |
| `card.avgCost` | 1.5 | 1-2 | energy | across the pool |
| `card.baseAttackDamage` | 6 | 4-10 | HP | 1-cost attack card |
| `card.baseBlock` | 5 | 4-8 | block | 1-cost skill card |
| `enemy.baseHp` | 40 | 25-60 | HP | fight 1 |
| `enemy.baseAttack` | 8 | 5-14 | HP | telegraphed intent value |
| `elite.hpMul` | 3 | 2.5-4 | multiplier | vs base enemy |
| `boss.hpMul` | 8 | 6-12 | multiplier | vs base enemy |
| `deck.startingSize` | 10 | 8-12 | cards | |
| `reward.cardChoiceCount` | 3 | 3 | count | pick-1-of-3 |
| `reward.goldPerFight` | 20 | 10-35 | currency | in-run currency for shop nodes |
| `shop.cardCostBase` | 50 | 30-80 | currency | in-run shop |
| `turnTimeoutMs` | 0 | n/a | ms | untimed — turn-based genre has no time pressure |
| `map.nodesPerRun` | 12 | 8-16 | count | |
| `entityBudgetLive` | 20 | 10-30 | count | cards + enemies + particles, low since turn-based |

### Progression math

No XP curve — power grows via deck composition, not a level number. Enemy HP
scales per fight index using the shared phase table:
`enemyHp(fightIndex) = baseHp * difficultyMul(phaseOfFight(fightIndex)) *
1.1^fightIndex`. Worked (baseHp=40): fight 2 (Early, x1.3) → `40*1.3*1.1^2
≈ 62.9`; fight 4 (Mid, x1.7) → `40*1.7*1.1^4 ≈ 99.4`; fight 6 (Late, x2.3)
→ `40*2.3*1.1^6 ≈ 162.9`; boss fight (Climax, x3.2) → `40*3.2*1.1^8*
bossHpMul(8) ≈ 40*3.2*2.14*8 ≈ 2192.6` split across 2-3 phases with distinct
intent scripts. Deck power proxy: `deckDamagePerTurn ≈ sum(card.damage for
card in average hand) * energyPerTurn/avgCost`, used only for internal
balance sanity, not shown to the player.

### Meta progression

Persists via `MetaSave.unlocks` (starter card variants, relic slots) and
`MetaSave.upgrades` (starting gold, starting HP). Currency source:
`grantCurrency(fightsWon * 15 + (bossDefeated ? 100 : 0))`.

| Meta upgrade | Effect | Cost formula |
| --- | --- | --- |
| Starting HP+ | +5 starting HP per stack | `cost(n) = 50 * 1.3^n` |
| Starting gold+ | +15 starting gold per stack | `cost(n) = 40 * 1.3^n` |
| Unlock relic slot | +1 relic slot | flat 300 |
| Unlock rare card pool | Rare-rarity cards can appear in drafts | flat 250 |
| Unlock alt starter deck | New starting archetype deck | flat 400 |
| Shop discount | -10% shop prices per stack | `cost(n) = 70 * 1.4^n` |
| Extra draft option | 4-of pick instead of 3-of, once per run | flat 350 |
| Boss preview | See boss intent pattern before the fight | flat 150 |

### Build variety

Minimum 3 archetypes proven by tagging every card with a synergy tag in the
PRD's card table: (1) block-stack/retaliate (defensive cards + thorns
relics, wins via attrition), (2) burst-damage (high-cost, high-damage cards +
energy relics), (3) status/DoT (poison/burn stacking cards that win over
multiple turns regardless of enemy defense). PRD must show 3 non-overlapping
8+-card chains across the 24-40 card pool.

### Portrait UI plan

Enemy(ies) occupy the top-middle band y 200-560, each with an intent icon
above their `Bar` HP. Player portrait + HP/block `Bar` sits at y 620-700,
centered. Hand renders as a fanned row of cards in the bottom-safe-adjacent
band y 900-1180 (within reach of a thumb, cards ≥120x170px each, slight
overlap, top card of a drag highlighted). End-turn `Button` sits bottom-right
at (VIEW.width-SAFE.side-70, VIEW.height-SAFE.bottom+40), full 88px tap
target, clear of the hand's drag zone. Energy counter sits left of the
end-turn button.

### Performance plan

Peak entities ~10-30 (2-4 enemies, 5-8 hand cards, particles) — far under the
300 budget; this genre is turn-based and entity-light, so `SpatialHash` and
`SpritePool` are optional/low-value here (only worth using for hit-effect
particle pooling). fps risk is near zero from entity count; the actual risk
is animation-heavy card resolution chains (multi-hit cards, chained
triggers) stacking tweens — cap simultaneous tween chains and use `hitstop`
sparingly to avoid perceived lag between cause and effect.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Combat core | Turn resolution, card effect execution, energy/block math | `interface CardDef { id: string; cost: number; kind: 'attack' \| 'skill' \| 'power'; modifiers: Modifier[]; targeted: boolean }` |
| Content/data | Card pool, enemy roster, relic pool, boss intent scripts | `function nextIntent(enemy: EnemyCombatant, turn: number, rng: Rng): Intent` |
| UI/meta | `handUI.ts`, HP/block bars, post-fight draft flow, meta shop | `function onFightWon(rewardChoices: CardDef[]): Promise<CardDef \| null>` |
| Level/systems | Map node graph, node-type gating (fight/elite/shop/rest/boss) | `function generateMap(rng: Rng, nodeCount: number): MapNode[]` |
| Balance pass (integrator) | Tunes enemy HP curve, card costs/damage, wires all workstreams into `game.ts` | consumes all contracts above |

### Pitfalls

1. Untelegraphed enemy intent makes every hit feel random rather than a
   puzzle — `enemyIntent.ts` must show the next intent one full turn ahead, always.
2. A hand-fan UI sized for desktop mouse hover breaks on touch — every card
   must be draggable/tappable at ≥120px width with no hover-dependent info (show card text on tap-and-hold instead).
3. Turn-based pacing with no time pressure can make an 8-minute run feel like
   15 minutes if fights drag — cap enemy count and hand size so an average fight resolves in 4-6 player turns.
4. A deck that always draws its best cards first (small starting deck, no
   shuffle enforcement) trivializes early fights — `Deck.shuffleIfEmpty` must reshuffle discard into draw pile, not reset to a fixed order.
5. Card reward pools that don't scale rarity with fight index frontload all
   the powerful cards or none of them — gate rare cards behind `fightIndex >= N` in `rollUpgradeChoices`.

### Video hook

30-60s clip: 0-8s a fast, clean early fight (readable card play), 8-20s a
reward draft moment (juicy card flip via `showUpgradeCards`), 20-45s an elite
or boss fight showing a big combo turn (multiple cards chained, `countTo`
damage numbers stacking), 45-60s the boss's final blow. Payoff moment: the
single "combo turn" where 4-5 cards chain into lethal damage in one turn.

## 5. Auto-battler

Draft units onto a board, watch them fight automatically, upgrade between
rounds — a compressed `Teamfight Tactics` loop for 480s.

### Core loop and run shape

**Core loop:** spend gold to buy/place units on a board during a shopping
phase, then watch an automatic combat round resolve against an opponent
board; win or lose gold/HP, repeat with a growing roster until the player's
HP hits 0 or all rounds are cleared.

| Time | Beat |
| --- | --- |
| 0:00-0:20 | Grace: intro board, starting gold, first 3-unit shop shown. |
| 0:20-1:30 | Rounds 1-2 (Early, x1.3): teaches drag-to-board placement and combat-watch. |
| 1:30-3:00 | Rounds 3-4 (Mid, x1.7): unit synergies/traits become visible, first upgrade (2-star) likely. |
| 3:00-5:00 | Rounds 5-6 (Late, x2.3): opponent boards scale, itemization matters. |
| 5:00-6:30 | Round 7 + interest/economy crunch decision. |
| 6:30-7:45 | Final round vs. strongest AI board (Climax, x3.2). |
| 7:45-8:00 | Resolution: placement/rounds-survived, meta currency. |

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Drag unit card | Drag from shop/bench onto a board cell | `Controls.onDrag` |
| Tap unit on board | Select for info / sell (via a sell zone) | `Controls.onTap` |
| Tap "ready"/"fight" button | Ends shopping phase, starts auto-combat | `Controls.onTap` on a `Button` |
| Hold on shop unit | Preview stats/traits tooltip | `Controls.onHoldStart/onHoldEnd` |

### Systems required

| Module | Use |
| --- | --- |
| `core/stats.ts` | Unit `StatBlock` (HP, damage, attack speed, range); trait bonuses applied as `Modifier[]` |
| `core/damage.ts` | `Health`, `rollDamage` for the auto-combat resolution |
| `core/pool.ts` | `SpritePool` for unit sprites reused between rounds (avoid re-instantiating each fight) |
| `core/spatial.ts` | `SpatialHash` for auto-combat target acquisition (nearest enemy unit on the opposing side of the board) |
| `core/grid.ts` | `NavGrid` for the board's placement grid (small, e.g. 4x4 per side) — reused for cell validity, not pathing (units mostly stay in a lane and attack in range) |
| `core/run.ts` | `RunDirector` with `WaveSpec[]` mapped to opponent-board rounds, `RunPhase[]` for AI board strength scaling |
| `core/progression.ts` | Meta currency, unlocked starting units/traits |
| `data/enemies.ts` | Reused as opponent unit roster (`ENEMIES` archetypes double as ally units in this genre) |
| `data/upgrades.ts` | Items/augments pool, `rollUpgradeChoices` for round-reward picks |
| `ui/cards.ts` | `showUpgradeCards` for augment/item picks between rounds |
| `ui/bars.ts` | Player HP bar, unit HP bars during combat |
| NEW: needs `core/autobattle.ts` | Deterministic (seeded) simultaneous-combat resolver given two boards; one-line spec: `function resolveCombat(playerBoard: UnitInstance[], enemyBoard: UnitInstance[], rng: Rng): CombatResult` where `CombatResult = { winner: 'player' \| 'enemy'; log: CombatEvent[] }`. |
| NEW: needs `ui/shopTray.ts` | Bottom-docked reroll/shop tray of 3-5 purchasable units; one-line spec similar to `TowerShop` above. |

### Content volume

| Item | Target | Minimum viable |
| --- | --- | --- |
| Unit types | 8-14 | 6 |
| Traits/synergies | 4-6 | 3 |
| Items/augments | 12-18 | 8 |
| Rounds | 6-8 | 5 |
| Board size | 4x4 per side | 3x3 per side |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `player.startHp` | 30 | 20-40 | HP | round losses subtract from this |
| `economy.startGold` | 30 | 20-40 | currency | |
| `economy.goldPerRound` | 10 | 5-15 | currency | base income |
| `economy.interestCap` | 5 | 3-6 | currency | max interest per round (10% of banked gold, capped) |
| `shop.rerollCost` | 2 | 1-3 | currency | |
| `shop.unitCostTier1` | 3 | 2-4 | currency | common unit |
| `shop.unitCostTier5` | 9 | 7-11 | currency | rare unit |
| `unit.baseHp` | 500 | 300-800 | HP | tier-1 unit |
| `unit.baseDamage` | 40 | 25-60 | HP | per attack |
| `unit.baseAttackMs` | 900 | 600-1200 | ms | attack interval |
| `unit.starMul` | 1.8 | 1.6-2 | multiplier | HP/damage per star upgrade (3-of-a-kind) |
| `board.cellSize` | 96 | 80-120 | px | fits 4 cols in ~400px |
| `board.rows` | 4 | 3-4 | rows | per side (player+enemy) |
| `combatDurationMs` | 25000 | 15000-35000 | ms | auto-combat round max length before draw/sudden-death |
| `roundLossHpPenalty` | 3 | 2-5 | HP | base, scales with round |
| `entityBudgetLive` | 60 | 30-80 | count | units + attack VFX during combat |

### Progression math

Opponent board strength scales via the shared phase table:
`opponentPower(round) = basePower * difficultyMul(phaseOfRound(round)) *
1.15^round`. Worked (basePower normalized to 1.0): round 2 (Early, x1.3) →
`1.3*1.15^2 ≈ 1.72`; round 4 (Mid, x1.7) → `1.7*1.15^4 ≈ 2.97`; round 6
(Late, x2.3) → `2.3*1.15^6 ≈ 5.32`; round 8 (Climax, x3.2) →
`3.2*1.15^8 ≈ 9.79`. Economy: gold banked at round end earns
`interest = min(interestCap, floor(banked/10))`, so a 50-gold bank nets +5/round,
compounding toward late-round power spikes for economic play.

### Meta progression

Persists via `MetaSave.unlocks` (starting unit pool, extra augment slot) and
`MetaSave.upgrades` (starting gold, starting HP). Currency source:
`grantCurrency(roundsWon * 20 + placementBonus)` where `placementBonus =
100/finalRank`.

| Meta upgrade | Effect | Cost formula |
| --- | --- | --- |
| Starting gold+ | +5 starting gold per stack | `cost(n) = 50 * 1.3^n` |
| Starting HP+ | +5 starting HP per stack | `cost(n) = 45 * 1.3^n` |
| Unlock trait X | New synergy trait available in shop pool | flat 250 per trait |
| Extra bench slot | +1 unit bench slot | `cost(n) = 80 * 1.4^n` |
| Free reroll | 1 free reroll per round | `cost(n) = 100 * 1.5^n` |
| Augment reroll | 1 free augment reroll per run | flat 200 |
| Unlock tier-5 unit pool | Rare units can appear from round 1 | flat 300 |
| Loss forgiveness | -1 HP penalty on losses per stack | `cost(n) = 90 * 1.45^n` |

### Build variety

Minimum 3 comps proven by trait tagging in the PRD's unit table: (1)
synergy-stack (6+ units sharing 1-2 traits for large trait bonuses), (2)
carry-focused (1-2 high-cost 3-star units + cheap frontline fodder), (3)
economy-rush (low unit investment early, banked gold, buys the best units
late at high star level). PRD must show the trait/cost table supports all 3
without one dominating by round 4.

### Portrait UI plan

Board occupies the center y 300-820 (4x4 grid per side stacked vertically:
enemy board top half, player board bottom half of that band, or side-by-side
compressed — portrait favors a vertically stacked two-board layout with a
clear diagonal-lane split). Player HP `Bar` and gold counter sit at
y=SAFE.top-70. Shop tray (`shopTray.ts`) docks in the bottom 220px, 4-5 unit
cards ≥100px wide, horizontally scrollable, reroll `Button` (64px) at its
left edge. "Fight" `Button` full-width just above the tray during shopping
phase, replaced by a "skip/speed-up" control during combat playback.

### Performance plan

Peak entities ~40-60 (up to 8 units per side + attack VFX) — well under the
300 budget; combat is small-scale and deterministic. `SpritePool` reuses unit
sprites across rounds instead of destroying/recreating. `SpatialHash` is
optional given ≤16 units total but keeps target-acquisition code consistent
with the shared systems batch. Main fps risk is attack-VFX particle spam if
every auto-attack spawns a full `burst` — throttle VFX intensity per attack
tier (basic attacks get a small pop, not a full burst).

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Combat core | `autobattle.ts` resolver, unit AI (target nearest, attack on cooldown) | `function resolveCombat(playerBoard: UnitInstance[], enemyBoard: UnitInstance[], rng: Rng): CombatResult` |
| Content/data | Unit roster, trait definitions, item/augment pool | `interface UnitDef { id: string; cost: number; traits: string[]; baseStats: Record<StatKey, number> }` |
| UI/meta | `shopTray.ts`, board drag-and-drop placement UI, augment picker | `function onPurchase(unitId: string): boolean` |
| Level/systems | Board grid setup (`NavGrid` cell validity), `RunDirector` round sequencing, opponent-board generation | `function generateOpponentBoard(round: number, rng: Rng): UnitInstance[]` |
| Balance pass (integrator) | Tunes opponent power curve, unit costs/stats, wires all workstreams into `game.ts` | consumes all contracts above |

### Pitfalls

1. Auto-combat with no player agency during the fight reads as boring on
   video unless the placement phase before it is visually rich — invest juice in the shop/place phase, not just combat.
2. Non-deterministic combat resolution (using unseeded `Math.random`) makes
   "why did I lose that fight" undebuggable — `resolveCombat` must take an explicit `Rng` seeded per round.
3. A 4x4-per-side board compressed into portrait width can make units too
   small to read at arm's length — verify unit sprite size against `board.cellSize` before finalizing the grid.
4. Reroll spam trivializing itemization if `rerollCost` is too cheap relative
   to `goldPerRound` — worked economy must be checked against the numbers table before shipping.
5. Trait synergy bonuses that don't visibly change unit appearance/behavior
   make comps illegible on video — every active trait needs a visual tell (aura, tint, icon).

### Video hook

30-60s clip: 0-10s a satisfying shop/placement montage (drag several units,
`pop` juice), 10-15s the "fight" button triggers combat, 15-45s the
auto-combat plays out with escalating unit deaths and ability procs, 45-60s
the final round's decisive team wipe. Payoff moment: the final round's board
wipe when a synergy bonus procs simultaneously across multiple units.

## 6. Survival crafting

Gather resources, craft tools/structures, survive an escalating day/night
threat cycle — a compressed `Don't Starve`-style loop for 480s.

### Core loop and run shape

**Core loop:** gather resources scattered around a small open area, craft
tools/defenses/food from a recipe list, and survive nightly threat spikes
that punish an unprepared base, until a final night or timer ends the run.

| Time | Beat |
| --- | --- |
| 0:00-0:20 | Grace: daylight, no threats, teaches gather (tap resource nodes). |
| 0:20-1:30 | Day 1 (Early, x1.3): first crafts (tool, torch), hunger/threat meter introduced. |
| 1:30-2:00 | Night 1: first threat wave, low intensity, tests whatever defense exists. |
| 2:00-3:30 | Day 2 + Night 2 (Mid, x1.7): recipe tree opens up, base defenses matter. |
| 3:30-5:00 | Day 3 + Night 3 (Late, x2.3): resource scarcity forces prioritization. |
| 5:00-6:30 | Day 4: final prep window before the hardest night. |
| 6:30-7:45 | Final night (Climax, x3.2): heaviest threat wave, base must hold. |
| 7:45-8:00 | Resolution: survived/died, resources banked, meta currency. |

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Tap resource node | Gather (with a short gather animation/hold) | `Controls.onTap` or `onHoldStart/onHoldEnd` for multi-tap resources |
| Drag / axis move | Move player around the area | `Controls.onDrag`, `controls.axisX/axisY` |
| Tap craft-menu item | Craft a recipe if resources available | `Controls.onTap` on a UI panel |
| Hold on placement | Place a crafted structure (drag-to-position, release to confirm) | `Controls.onHoldStart` + `onDrag` + `onHoldEnd` |

### Systems required

| Module | Use |
| --- | --- |
| `core/stats.ts` | Player `StatBlock` (hunger drain rate, gather speed, carry capacity) |
| `core/damage.ts` | `Health` for player and structures; `rollDamage` for night-threat attacks |
| `core/pool.ts` | `SpritePool` for threat-creature archetypes and resource-node respawns |
| `core/spatial.ts` | `SpatialHash` for nearest-resource-node queries and threat-creature-vs-structure/player overlap |
| `core/grid.ts` | `NavGrid` for threat creatures pathing toward the player/base around placed structures |
| `core/run.ts` | `RunDirector` with `RunPhase[]` mapped to day/night cycle, `WaveSpec[]` for nightly threat spawns |
| `core/progression.ts` | Meta currency, unlocked starting recipes/tools |
| `data/enemies.ts` | Night-threat creature archetypes |
| `data/upgrades.ts` | Reused as the crafting recipe unlock pool for meta-progression (not in-run cards) |
| `ui/bars.ts` | Hunger bar, player HP bar, base HP bar |
| NEW: needs `core/inventory.ts` | Resource counts + recipe crafting check; one-line spec: `class Inventory { add(id: string, n: number): void; has(recipe: RecipeDef): boolean; consume(recipe: RecipeDef): boolean }`. |
| NEW: needs `data/recipes.ts` | Recipe definitions (inputs, output, craft time); one-line spec: `interface RecipeDef { id: string; inputs: Record<string, number>; output: string; craftMs: number }`. |
| NEW: needs `ui/craftMenu.ts` | Bottom-docked scrollable recipe list with affordability graying; game-specific view over `Inventory`. |

### Content volume

| Item | Target | Minimum viable |
| --- | --- | --- |
| Resource types | 6-10 | 4 |
| Recipes | 12-18 | 8 |
| Threat creature types | 6-8 | 4 |
| Placeable structures | 4-6 | 3 |
| Day/night cycles | 4 | 3 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `player.speed` | 220 | 180-280 | px/s | |
| `player.baseHp` | 80 | 60-100 | HP | |
| `player.hungerMax` | 100 | 80-120 | hunger | |
| `player.hungerDrainPerSec` | 0.6 | 0.4-1.0 | hunger/s | |
| `player.hungerDamageThreshold` | 20 | 10-30 | hunger | below this, HP drains |
| `player.gatherMs` | 500 | 300-800 | ms | per gather action |
| `player.carryCapacity` | 50 | 30-80 | units | total inventory slots-equivalent |
| `day.durationSec` | 90 | 70-110 | s | daylight phase length |
| `night.durationSec` | 45 | 30-60 | s | threat phase length |
| `night.threatSpawnMsStart` | 4000 | 3000-6000 | ms | night 1 |
| `night.threatSpawnMsFloor` | 900 | 600-1200 | ms | final night |
| `threat.baseHp` | 25 | 15-40 | HP | |
| `threat.baseDamage` | 10 | 6-16 | HP | vs player/structure |
| `structure.wallHp` | 60 | 40-90 | HP | basic defense structure |
| `resource.nodeRespawnMs` | 20000 | 15000-30000 | ms | per node |
| `entityBudgetLive` | 150 | 100-200 | count | threats + resource nodes + structures |

### Progression math

Night threat count and HP scale via the shared phase table:
`threatHp(night) = baseHp * difficultyMul(phaseOfNight(night))`,
`threatCount(night) = round(4 + night * 3)`. Worked: night 1 (Early, x1.3) →
`25*1.3=32.5 HP`, 7 threats; night 2 (Mid, x1.7) → `42.5 HP`, 10 threats;
night 3 (Late, x2.3) → `57.5 HP`, 13 threats; final night (Climax, x3.2) →
`80 HP`, 16 threats. Hunger forces a resource-gather cadence:
`hungerAtTime(t) = max(0, hungerMax - hungerDrainPerSec * t)`, reaching the
damage threshold at `t = (100-20)/0.6 ≈ 133s` without eating — roughly one
full day cycle, forcing at least one food-crafting detour per day.

### Meta progression

Persists via `MetaSave.unlocks` (starting recipes, starting tools) and
`MetaSave.upgrades` (hunger drain reduction, carry capacity). Currency
source: `grantCurrency(nightsSurvived * 30 + resourcesBanked * 0.5)`.

| Meta upgrade | Effect | Cost formula |
| --- | --- | --- |
| Slower hunger | -10% hunger drain per stack | `cost(n) = 60 * 1.35^n` |
| Carry capacity+ | +10 capacity per stack | `cost(n) = 50 * 1.3^n` |
| Starting tool | Begin with tier-1 tool crafted | flat 200 |
| Unlock recipe X | Unlock an advanced recipe from run 1 | flat 150 per recipe |
| Faster gather | -15% gather time per stack | `cost(n) = 70 * 1.4^n` |
| Sturdier walls | +20% structure HP per stack | `cost(n) = 65 * 1.35^n` |
| Night vision | Threat telegraphs visible earlier | flat 250 |
| Extra structure slot | +1 placeable structure per run | `cost(n) = 90 * 1.45^n` |

### Build variety

Minimum 3 strategies proven by recipe-tree tagging: (1) turtle (heavy
investment in walls/defenses, minimal offense, survives via base integrity),
(2) mobile-forager (light base, high gather speed/carry capacity, avoids
threats by outrunning them), (3) offense-crafted (crafts weapons/traps to
actively kill threats for resource drops, aggressive night play). PRD shows
which recipes serve each archetype.

### Portrait UI plan

Open play area fills y 140-980. Hunger `Bar` and HP `Bar` stack top-left
under SAFE.top at (SAFE.side, SAFE.top-70) and (SAFE.side, SAFE.top-40),
each 200x20px. Day/night phase indicator (icon + countdown text) top-center.
Craft menu (`craftMenu.ts`) docks in the bottom 220px as a collapsible
scrollable panel (tap a "craft" tab button to expand upward over the play
area, tap again to collapse) so it never permanently blocks thumb movement
during gather/move.

### Performance plan

Peak entities ~100-150 (threat creatures + resource nodes + structures +
particles) during the final night, under the 300 budget. `SpritePool` for
threat-creature archetypes. `SpatialHash` mandatory for nearest-resource-node
queries (frequent, every gather-tap) and threat-vs-structure overlap during
night waves. `NavGrid` needed only if structures can block threat paths;
rebuild on structure placement, not per frame — same risk as tower defense.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Combat core | Threat AI, attack resolution vs. player/structures | `interface ThreatDef { id: string; baseStats: Record<StatKey, number>; ai: 'chase' \| 'raid-structure' }` |
| Content/data | `data/recipes.ts`, resource node roster, threat roster | `interface RecipeDef { id: string; inputs: Record<string, number>; output: string; craftMs: number }` |
| UI/meta | `craftMenu.ts`, hunger/HP bars, meta shop | `function onCraftAttempt(recipeId: string): boolean` |
| Level/systems | `Inventory`, resource node placement/respawn, `NavGrid` for threats around structures | `function gatherNode(nodeId: string): { resource: string; amount: number } \| null` |
| Balance pass (integrator) | Tunes hunger drain, night threat curve, recipe costs, wires all workstreams into `game.ts` | consumes all contracts above |

### Pitfalls

1. A full day/night cycle at real-time pacing (90s day + 45s night) leaves
   only 3-4 cycles in an 8-minute run — every cycle must visibly escalate or the run feels repetitive, not progressive.
2. Resource scarcity tuned for a 20-30 minute session (typical genre norm)
   overwhelms an 8-minute run — recipe costs must be recalibrated down, not ported from PC-genre norms.
3. Crafting menu occluding the play area while threats are active during a
   night phase gets the player killed blind — auto-collapse the craft menu when night begins, or disable crafting-menu-open during active threat proximity.
4. Hunger and HP bars both draining independently without a single glance-able
   "danger" signal makes failure feel arbitrary — combine into one composite threat readout if both are near-critical simultaneously (tint both bars, add `shake`).
5. Structures with no visual damage state (binary alive/destroyed) hide how
   close a base is to falling — structures need at least 2 visible damage stages before destruction.

### Video hook

30-60s clip: 0-10s daytime gathering montage (satisfying tap-to-collect
juice), 10-20s a base/structure being built, 20-35s the first night threat
wave approaching (tension via telegraph), 35-55s the base defending itself
(structures + player fighting off threats), 55-60s payoff — the base
survives the heaviest night wave by a visible margin (last threat dies at the
wall). Payoff moment: the final-night base-holds-the-line beat.

## 7. Base builder / defend-the-core

Build an economy and defenses around a central core, then survive escalating
attack waves — `They Are Billions`-style compressed to 480s.

### Core loop and run shape

**Core loop:** place resource-generating and defensive buildings around a
central core using earned currency, expanding the base's footprint, while
periodic waves attack from the map edges; the core's destruction ends the
run.

| Time | Beat |
| --- | --- |
| 0:00-0:20 | Grace: bare core, starting currency, place first resource building. |
| 0:20-1:30 | Build phase 1 (Early, x1.3): economy buildings established, first wave warning at ~1:00. |
| 1:30-2:00 | Wave 1: light attack, tests whatever defense exists. |
| 2:00-3:30 | Build phase 2 (Mid, x1.7): defensive ring expands, second resource tier unlocked. |
| 3:30-4:00 | Wave 2: moderate attack from a new direction. |
| 4:00-5:30 | Build phase 3 (Late, x2.3): base footprint near max, economy optimization matters. |
| 5:30-6:00 | Wave 3: heavy multi-direction attack. |
| 6:00-7:45 | Final build window + final wave (Climax, x3.2): all sides attacked simultaneously. |
| 7:45-8:00 | Resolution: core survived/destroyed, base size, meta currency. |

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Tap empty tile | Open build menu for that tile | `Controls.onTap` |
| Drag from build tray | Drag-place a building | `Controls.onDrag` |
| Tap placed building | Upgrade/demolish menu | `Controls.onTap` |
| Hold on defense building | Preview attack range | `Controls.onHoldStart/onHoldEnd` |

### Systems required

| Module | Use |
| --- | --- |
| `core/grid.ts` | `NavGrid` for enemy pathing toward the core around the placed base layout (mandatory, same role as tower defense but omnidirectional, not lane-based) |
| `core/stats.ts` | Building/defense `StatBlock` (damage, range, output rate), enemy `StatBlock` |
| `core/damage.ts` | `Health` on core, buildings, enemies |
| `core/pool.ts` | `SpritePool` for enemy archetypes and projectiles |
| `core/spatial.ts` | `SpatialHash` for defense-building target acquisition |
| `core/run.ts` | `RunDirector` with `WaveSpec[]` for attack timing/direction, `RunPhase[]` for build-phase pacing |
| `core/progression.ts` | Meta currency, unlocked building types, starting resources |
| `data/enemies.ts` | Attack-wave enemy archetypes |
| `data/waves.ts` | Wave timelines with direction/composition |
| `ui/bars.ts` | Core HP bar, building HP indicators |
| NEW: needs `objects/building.ts` | Building entity: resource generation tick, defense fire loop, upgrade tiers; game-specific, not in the systems batch. |
| NEW: needs `ui/buildTray.ts` | Bottom-docked buildable-structure tray (economy + defense categories); same shape as `TowerShop` from tower defense, reusable pattern. |

### Content volume

| Item | Target | Minimum viable |
| --- | --- | --- |
| Building types (economy+defense) | 8-12 | 5 |
| Enemy types | 8-10 | 5 |
| Waves | 6-10 | 5 |
| Resource types | 2-3 | 1 |
| Map size (tiles) | 15x15 | 11x11 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `core.startHp` | 200 | 150-300 | HP | |
| `economy.startCurrency` | 100 | 60-150 | currency | |
| `economy.baseIncomePerSec` | 2 | 1-4 | currency/s | from 1 resource building |
| `building.economyCostBase` | 40 | 25-60 | currency | |
| `building.defenseCostBase` | 60 | 40-90 | currency | |
| `defense.baseRange` | 200 | 140-280 | px | |
| `defense.baseDamage` | 15 | 8-25 | HP | |
| `defense.baseFireRateMs` | 800 | 500-1100 | ms | |
| `enemy.baseHp` | 40 | 25-60 | HP | wave 1 |
| `enemy.baseSpeed` | 80 | 60-110 | px/s | |
| `enemy.coreDamage` | 15 | 8-25 | core HP | per hit on core |
| `wave.intervalSec` | 70 | 50-90 | s | gap between waves for building |
| `wave.warningLeadSec` | 15 | 10-20 | s | telegraph before wave arrives |
| `grid.cols` | 13 | 11-17 | tiles | |
| `grid.tileSize` | 56 | 44-64 | px | |
| `entityBudgetLive` | 200 | 150-250 | count | enemies + projectiles + buildings |

### Progression math

Wave enemy count and HP scale via the shared phase table:
`waveHp(waveIndex) = baseHp * difficultyMul(phase) * 1.2^waveIndex`,
`waveCount(waveIndex) = round(6 + waveIndex * 5)`. Worked: wave 1 (Early,
x1.3) → `40*1.3*1.2^1 ≈ 62.4 HP`, 11 enemies; wave 3 (Mid, x1.7) →
`40*1.7*1.2^3 ≈ 117.4 HP`, 21 enemies; wave 5 (Late, x2.3) →
`40*2.3*1.2^5 ≈ 228.6 HP`, 31 enemies; final wave (Climax, x3.2) →
`40*3.2*1.2^7 ≈ 458.1 HP`, 41 enemies attacking from multiple directions
simultaneously. Economy compounds: with 3 resource buildings by t=90s,
income reaches `3 * baseIncomePerSec = 6/s`, funding roughly one defense
building every 10s.

### Meta progression

Persists via `MetaSave.unlocks` (building types) and `MetaSave.upgrades`
(starting currency, core max HP). Currency source:
`grantCurrency(wavesRepelled * 25 + coreHpRemaining * 2)`.

| Meta upgrade | Effect | Cost formula |
| --- | --- | --- |
| Starting funds+ | +20 starting currency per stack | `cost(n) = 50 * 1.3^n` |
| Core reinforcement | +25 max core HP per stack | `cost(n) = 65 * 1.35^n` |
| Unlock building C | New economy building type | flat 200 |
| Unlock building D | New defense building type | flat 250 |
| Faster build | -15% placement cost per stack | `cost(n) = 80 * 1.45^n` |
| Wave preview | See wave direction 30s early instead of 15s | flat 150 |
| Auto-repair | Buildings regen 2% HP/s | flat 300 |
| Second map | Unlock alternate map layout | flat 250 |

### Build variety

Minimum 3 strategies via building-role tagging: (1) turtle-ring (dense
defense ring around the core, minimal economy expansion), (2) economy-rush
(maximize resource buildings early, thin defenses, relies on meta HP buffer
to survive early waves), (3) sprawl (expand footprint outward with mixed
buildings, relies on `NavGrid` chokepoints created by building placement
itself). PRD shows a base layout example for each.

### Portrait UI plan

Map occupies y 140-980 (13x13 grid at 56px ≈ 728x728, centered). Core HP
`Bar` pinned top-center. Currency + income rate top-right within SAFE. Build
tray (`buildTray.ts`) docks in the bottom 220px with two tabs (economy /
defense), 4-5 icons per tab, ≥64px tap targets. Wave warning banner
(full-width, top third) appears `wave.warningLeadSec` before each wave and
auto-dismisses.

### Performance plan

Peak entities ~150-200 (enemies attacking from multiple directions +
building projectiles) at the final wave, under the 300 budget.
`SpritePool` for enemy archetypes and defense projectiles. `SpatialHash`
mandatory for defense-building targeting across a wider omnidirectional map
than lane-based tower defense. `NavGrid.buildFlowField` must support
multiple simultaneous goal directions (enemies approaching from map edges,
not one lane) — rebuild triggers on any building placement, throttled to
once per 200ms if placements are rapid.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Combat core | Defense building fire loop, enemy attack-core resolution | `interface DefenseDef { id: string; range: number; fireRateMs: number; damage: number }` |
| Content/data | Building roster, enemy roster, wave direction/composition timelines | `interface WaveSpec` (from `core/run.ts`) with a `direction: 'N' \| 'S' \| 'E' \| 'W' \| 'all'` extension |
| UI/meta | `buildTray.ts`, core HP/currency HUD, wave warning banner, meta shop | `function onBuildingSelected(def: BuildingDef): void` |
| Level/systems | Map/grid authoring, `NavGrid` multi-goal flow field, `RunDirector` wave sequencing | `function placeBuilding(col: number, row: number, def: BuildingDef): boolean` |
| Balance pass (integrator) | Tunes wave curve, building costs/output, wires all workstreams into `game.ts` | consumes all contracts above |

### Pitfalls

1. Omnidirectional enemy approach (vs. tower defense's single lane) makes
   `NavGrid` flow-field cost higher — profile `buildFlowField` cost against the 200-tile map size before committing to map dimensions.
2. A base that can expand infinitely in every direction has no meaningful
   layout decisions — cap the buildable footprint (e.g. an 11x11 or 13x13 ring around the core) to force chokepoint tradeoffs.
3. Wave warning banners that overlap the build tray during a critical
   pre-wave building decision create a forced choice between reading the warning and finishing a placement — position the banner in the top third, never near the tray.
4. Economy buildings with no visible output tick (silent currency gain) make
   the base feel inert — every income tick needs a small `floatText`/`pop` on the building.
5. Attack waves from multiple directions simultaneously at Climax without a
   readable per-direction threat indicator make the final wave feel chaotic rather than climactic — add directional edge indicators showing incoming enemy count per side.

### Video hook

30-60s clip: 0-10s base-building montage (buildings popping in with juice),
10-20s the wave warning banner and directional indicators appear (tension
build), 20-45s a multi-directional wave attacking the base, defenses firing
in unison, 45-60s payoff — the final wave is repelled with the core at low
but surviving HP. Payoff moment: the core surviving the final simultaneous
multi-direction assault by a visible sliver of HP.

## 8. Bullet hell

Pattern-based projectile dodging in phases against one boss (or a short
sequence of bosses) — a compressed danmaku/curtain-fire loop for 480s.

### Core loop and run shape

**Core loop:** dodge escalating bullet patterns from a boss while returning
fire, surviving each pattern until the boss's HP threshold triggers the next
phase, until the boss dies or the player's HP/lives run out.

| Time | Beat |
| --- | --- |
| 0:00-0:20 | Grace: boss intro, first simple pattern (single-direction stream). |
| 0:20-1:30 | Phase 1 (Early, x1.3): 2-3 pattern types, teaches dodge lanes and the hitbox size. |
| 1:30-3:00 | Phase 2 (Mid, x1.7): patterns overlap (2 simultaneous emitters), first mid-boss or elite pattern. |
| 3:00-5:00 | Phase 3 (Late, x2.3): screen-filling curtain patterns, tight safe-lane threading. |
| 5:00-6:30 | Phase 4: boss enters a "desperation" sub-phase at low HP with its hardest pattern. |
| 6:30-7:45 | Climax (x3.2): final pattern combination, hardest 60-90s. |
| 7:45-8:00 | Resolution: boss defeated or player died, accuracy/time stats, meta currency. |

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Drag | Player ship follows finger (fine 1:1 tracking, not velocity-based) | `Controls.onDrag` |
| Auto-fire | Player fires automatically at a fixed rate (no manual fire input — keeps both hands/thumb free for pure dodging) | driven by a timer, not `Controls` |
| Hold | Focus mode: slows player movement, shrinks hitbox, for precision threading | `Controls.onHoldStart/onHoldEnd` |
| Tap (optional) | Bomb/screen-clear, limited uses per run | `Controls.onTap` |

### Systems required

| Module | Use |
| --- | --- |
| `core/stats.ts` | Player `StatBlock` (fire rate, bomb count); boss `StatBlock` (HP, pattern damage) |
| `core/damage.ts` | `Health` on player (small hitbox, 1-3 hit points) and boss; `rollDamage` for player shots |
| `core/pool.ts` | `SpritePool` for bullets — mandatory, patterns can spawn hundreds of bullets per second |
| `core/spatial.ts` | `SpatialHash` for bullet-vs-player overlap (checking one small player hitbox against hundreds of bullets every frame needs spatial partitioning) |
| `core/run.ts` | `RunPhase[]` maps directly to boss pattern phases (HP-threshold-gated, not time-gated — `RunDirector`'s `onPhaseChange` triggers pattern swaps) |
| `core/progression.ts` | Meta currency, unlocked bomb count, starting lives |
| `ui/bars.ts` | Boss HP bar (prominent, top of screen) |
| NEW: needs `core/bulletPattern.ts` | Declarative pattern scripting (emitter position, angle spread, bullet speed/count, repeat interval); one-line spec: `interface PatternDef { emit(t: number, rng: Rng): BulletSpawn[] }` where `BulletSpawn = { x: number; y: number; vx: number; vy: number }`. This is the genre's defining system and is not covered by the general systems batch — it is purely game-specific. |
| NEW: needs `objects/hitbox.ts` | Small precise player hitbox distinct from the visible sprite (standard bullet-hell convention: sprite ~48px, hitbox ~6-10px); one-line spec: a `Phaser.GameObjects.Zone` sized independently of the ship sprite. |

### Content volume

| Item | Target | Minimum viable |
| --- | --- | --- |
| Bosses | 1-2 | 1 |
| Distinct patterns | 8-14 | 6 |
| Boss phases | 4-6 | 3 |
| Bomb uses per run | 2-3 | 1 |
| Player lives | 3 | 1 (with a generous hitbox instead) |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `player.dragTrackingMs` | 0 | 0-50 | ms | lag on 1:1 drag-follow, near-zero for precision |
| `player.hitboxRadius` | 6 | 4-10 | px | true collision radius, much smaller than sprite |
| `player.spriteRadius` | 24 | 20-30 | px | visible ship size |
| `player.lives` | 3 | 1-3 | count | |
| `player.invulnMs` | 1500 | 1000-2000 | ms | after a hit, generous given precision demands |
| `player.focusSpeedMul` | 0.45 | 0.35-0.55 | multiplier | movement speed while holding (focus mode) |
| `player.fireRateMs` | 120 | 80-200 | ms | auto-fire interval |
| `player.shotDamage` | 4 | 2-8 | HP | per shot |
| `boss.baseHp` | 2000 | 1200-3000 | HP | total across all phases |
| `boss.phaseCount` | 5 | 3-6 | count | |
| `bullet.baseSpeed` | 240 | 150-400 | px/s | |
| `bullet.densityMaxPerPattern` | 120 | 60-200 | count | concurrent bullets in the heaviest pattern |
| `bomb.clearRadius` | 900 | 700-1200 | px | screen-clear radius |
| `bomb.count` | 3 | 1-3 | count | per run |
| `entityBudgetLive` | 300 | 200-320 | count | almost entirely bullets at peak |

### Progression math

No XP curve — this genre's "progression" is the boss HP-gated phase
transition, not a time or level formula. Phase transitions:
`phaseIndex(bossHpRatio) = floor((1 - bossHpRatio) * phaseCount)`. Worked with
`bossHp=2000, phaseCount=5`: phase 0 at 100-80% HP (2000-1600), phase 1 at
80-60% (1600-1200), phase 2 at 60-40% (1200-800), phase 3 at 40-20%
(800-400), phase 4 ("desperation") at 20-0% (400-0). Difficulty multiplier
from the shared table still governs bullet speed/density scaling by wall-clock
time as a secondary axis: `bulletSpeed(t) = baseSpeed * difficultyMul(phase(t))`,
so a fight that runs long (player surviving but not landing damage) still
escalates — worked: at t=200s (Mid, x1.7) bullets move at `240*1.7=408px/s`;
at t=400s (Climax, x3.2) at `240*3.2=768px/s`, which is why the fight must
resolve by ~420s (matches the shared boss milestone).

### Meta progression

Persists via `MetaSave.upgrades` (starting bomb count, starting lives) and
`MetaSave.unlocks` (alternate ship/hitbox skins — cosmetic only, this genre's
balance must stay skill-based, not power-creep-based, so meta upgrades are
capped small). Currency source: `grantCurrency(damageDealt * 0.02 +
(bossDefeated ? 150 : 0))`.

| Meta upgrade | Effect | Cost formula |
| --- | --- | --- |
| Extra life | +1 starting life (max 3) | `cost(n) = 100 * 1.5^n`, capped n≤2 |
| Extra bomb | +1 starting bomb (max 4) | `cost(n) = 80 * 1.4^n`, capped n≤1 |
| Hitbox trainer | Shows hitbox outline permanently (accessibility, not power) | flat 50 |
| Slow-mo practice | Practice mode at 0.7x speed, no currency reward | flat 0 (always available) |
| Continue token | Resume from current phase once on death | flat 300 |
| Cosmetic ship skin | Visual only | flat 150 per skin |
| Graze bonus | +5% currency per near-miss "graze" | `cost(n) = 90 * 1.4^n` |
| Pattern preview | See next pattern's shape 1s before it fires | flat 200 |

### Build variety

Bullet hell has less build variety than other genres by design (skill
expression over deckbuilding); the minimum-3 requirement is satisfied via
playstyle rather than power builds: (1) full-focus threading (spend most of
the fight in focus mode, tight precise movement), (2) hit-and-run (stay
unfocused for speed, dip into focus only for the densest bursts), (3)
bomb-conservation vs. bomb-spam (save all bombs for phase 4 vs. use them
proactively to survive phase 2-3 densities). PRD documents these three as
distinct viable clear strategies rather than card/unit synergies.

### Portrait UI plan

Play area is nearly the full frame, y 140-1060, since bullets must have
maximum room to be dodgeable in a narrow 720px-wide field — this genre is the
most space-constrained of the twelve and should keep HUD chrome minimal.
Boss HP `Bar` full-width at y=SAFE.top-40 (thin, 12px, non-intrusive). Player
lives (small icons) and bomb count top-left/top-right corners within SAFE.
No bottom-220px UI at all except an optional bomb `Button` (88px) at bottom
corner — everything else is drag/hold gesture-only, maximizing dodge space.

### Performance plan

Peak entities ~250-300, almost entirely bullets, at Climax/desperation phase
— this is the genre most likely to hit the 300 budget ceiling by design.
`SpritePool` for bullets is non-negotiable (a single dense pattern spawning
40+ bullets/s would otherwise allocate/GC constantly). `SpatialHash` is
mandatory: checking hundreds of bullets against one player hitbox naively is
cheap (O(n) against 1 point), but checking player shots against the boss and
culling offscreen bullets both benefit from spatial partitioning at this
density. fps risk is the highest of any genre in this document — bullet
patterns must be capped at `bullet.densityMaxPerPattern` and offscreen
bullets released back to the pool every frame, not just on overlap.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Combat core | Player auto-fire, bomb effect, hit resolution | `interface BulletSpawn { x: number; y: number; vx: number; vy: number }` |
| Content/data | `bulletPattern.ts` pattern library, boss phase-to-pattern mapping | `interface PatternDef { emit(t: number, rng: Rng): BulletSpawn[] }` |
| UI/meta | Boss HP bar, lives/bomb HUD, meta shop | `function onPhaseChange(phase: RunPhase): void` swaps active pattern set |
| Level/systems | Bullet pooling/culling pipeline, `SpatialHash` wiring, boss movement scripting | `function spawnBullet(spawn: BulletSpawn): Phaser.Physics.Arcade.Sprite` (pool-backed) |
| Balance pass (integrator) | Tunes bullet density/speed per phase, hitbox size, wires all workstreams into `game.ts` | consumes all contracts above |

### Pitfalls

1. Player hitbox equal to the visible sprite makes the genre unplayably hard
   at any real bullet density — the hitbox must be dramatically smaller than the sprite (convention: ~20-25% of sprite radius).
2. Bullets not culled/pooled the instant they leave the screen bounds
   accumulate and tank fps within 2-3 patterns — cull check must run every frame against `VIEW` bounds with margin.
3. Touch-drag on a phone-sized screen has finger occlusion — the player's
   visible sprite must render above/offset from the actual finger contact point, or the player can't see incoming bullets under their own hand.
4. Time-gated (not HP-gated) phase transitions let a stalling player face
   endlessly increasing bullet density with no progress — phases must be
   HP-threshold-gated so skilled play is always rewarded with phase advancement.
5. A single 8-minute boss fight with no escalating variety becomes a damage
   sponge — mandate visually and mechanically distinct patterns per phase, not the same pattern scaled up.

### Video hook

30-60s clip: 0-8s a readable simple pattern establishing the ship and
hitbox, 8-25s density increasing across 2 phase transitions, 25-45s a
tight near-miss threading sequence through a dense curtain (`hitstop` on
grazes), 45-60s the desperation-phase pattern and the killing blow. Payoff
moment: a single-pixel-margin dodge through the boss's hardest pattern,
followed immediately by the kill shot.

## 9. Turn-based tactics

Small-grid squad combat with unit abilities — a compressed `Into the
Breach`/`Fire Emblem`-skirmish loop for 480s.

### Core loop and run shape

**Core loop:** on a small grid battlefield, move and use one ability per unit
per turn against an enemy squad, alternating turns, until one side's units
are eliminated; win a battle, get a reward, fight again across a short
mission chain.

| Time | Beat |
| --- | --- |
| 0:00-0:20 | Grace: 2-unit squad, 1v1 easy skirmish, teaches move+ability. |
| 0:20-1:30 | Battle 1 (Early, x1.3): 2v2, teaches positioning and terrain. |
| 1:30-3:00 | Battle 2 (Mid, x1.7): 3v3, first ability synergy (e.g. push + hazard combo). |
| 3:00-5:00 | Battle 3 (Late, x2.3): 3v4 or objective battle (defend a tile, not just eliminate). |
| 5:00-6:30 | Battle 4: squad upgrade choice, harder enemy composition. |
| 6:30-7:45 | Final battle (Climax, x3.2): boss unit + reinforcement waves. |
| 7:45-8:00 | Resolution: battles won, squad state, meta currency. |

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Tap unit | Select unit, highlights valid move tiles | `Controls.onTap` |
| Tap tile | Move selected unit (if valid) | `Controls.onTap` |
| Tap ability icon then tap target | Use ability on a valid target/tile | `Controls.onTap` (two-step) |
| Tap "end turn" button | Passes turn to enemy AI | `Controls.onTap` on a `Button` |

### Systems required

| Module | Use |
| --- | --- |
| `core/grid.ts` | `NavGrid` for movement-range calculation and enemy AI pathing (`isBlocked`, `pathExists`, `worldToCell`/`cellToWorldCenter` for tile-to-pixel mapping) — mandatory, this is the genre's board |
| `core/stats.ts` | Unit `StatBlock` (HP, move range, ability damage/cooldown); terrain/status effects as `Modifier[]` |
| `core/damage.ts` | `Health`, `rollDamage` for ability damage, `applyDot` for burn/poison tiles |
| `core/pool.ts` | Low value here (few units); used for hit-effect particles only |
| `core/run.ts` | `RunPhase[]`-style scaling reused per mission for enemy squad strength, not wall-clock (mission-indexed like the deckbuilder's fight index) |
| `core/progression.ts` | Meta currency, unlocked units, permanent squad-level upgrades |
| `data/enemies.ts` | Enemy unit archetypes with grid-appropriate `ai` field |
| `data/upgrades.ts` | Reused as ability/perk unlock pool between missions |
| `ui/bars.ts` | Per-unit HP bars above sprites |
| NEW: needs `core/turnOrder.ts` | Initiative/turn-order queue (who acts next, player-then-enemy or interleaved by speed stat); one-line spec: `class TurnQueue { constructor(units: UnitInstance[]); next(): UnitInstance; peek(n: number): UnitInstance[] }`. |
| NEW: needs `core/abilityRange.ts` | Range/line-of-sight/AoE-shape calculation for ability targeting on `NavGrid`; one-line spec: `function tilesInRange(grid: NavGrid, origin: {col,row}, shape: 'line' \| 'circle' \| 'cone', radius: number): {col,row}[]`. |
| NEW: needs `objects/unitToken.ts` | Grid-unit sprite + selection highlight + HP bar wiring; game-specific view over `StatBlock`/`Health`. |

### Content volume

| Item | Target | Minimum viable |
| --- | --- | --- |
| Unit types (player-usable) | 6-8 | 4 |
| Enemy unit types | 8-10 | 5 |
| Abilities (across all units) | 12-16 | 8 |
| Battle maps | 8-12 | 5 |
| Bosses | 1-2 | 1 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `grid.cols` | 6 | 5-8 | tiles | small tactical grid, portrait-appropriate |
| `grid.rows` | 8 | 6-10 | tiles | |
| `grid.tileSize` | 96 | 72-112 | px | 6*96=576, fits 720 width with margin |
| `unit.baseHp` | 30 | 20-45 | HP | |
| `unit.baseMoveRange` | 3 | 2-4 | tiles | |
| `unit.baseAbilityDamage` | 12 | 8-18 | HP | |
| `unit.abilityCooldownTurns` | 1 | 0-2 | turns | |
| `squadSizePlayer` | 3 | 2-4 | units | |
| `squadSizeEnemyBase` | 2 | 2-3 | units | mission 1 |
| `terrain.hazardDamage` | 8 | 5-12 | HP | per turn standing in hazard tile |
| `terrain.coverDamageReduction` | 0.3 | 0.2-0.4 | fraction | behind cover |
| `boss.hpMul` | 5 | 3-8 | multiplier | vs base unit |
| `mission.rewardChoiceCount` | 3 | 3 | count | pick-1-of-3 between missions |
| `turnTimeoutMs` | 0 | n/a | ms | untimed, turn-based |
| `entityBudgetLive` | 15 | 8-20 | count | units + terrain hazards + particles, low (grid genre) |

### Progression math

No XP curve; enemy squad strength scales per mission index using the shared
phase table: `enemySquadHp(mission) = baseHp * difficultyMul(phaseOfMission(mission))
* 1.15^mission`, `enemySquadSize(mission) = squadSizeEnemyBase +
floor(mission/2)`. Worked (baseHp=30): mission 1 (Early, x1.3) →
`30*1.3*1.15 ≈ 44.9 HP`, 2 units; mission 3 (Mid, x1.7) →
`30*1.7*1.15^3 ≈ 77.6 HP`, 3 units; mission 5 (Late, x2.3) →
`30*2.3*1.15^5 ≈ 138.5 HP`, 4 units; final mission (Climax, x3.2) →
`30*3.2*1.15^7 ≈ 255.9 HP` per unit plus a boss at `5x` that (≈1279.5 HP),
5 units total.

### Meta progression

Persists via `MetaSave.unlocks` (playable unit roster) and `MetaSave.upgrades`
(permanent stat boosts per unit class). Currency source:
`grantCurrency(missionsWon * 30 + unitsLostPenalty)` where losing a unit
mid-run reduces the payout.

| Meta upgrade | Effect | Cost formula |
| --- | --- | --- |
| Unit HP+ | +5 max HP per stack, per unit class | `cost(n) = 60 * 1.35^n` |
| Unlock unit class | New playable unit type | flat 300 per class |
| Extra ability slot | Units can equip a 2nd ability | flat 400 |
| Squad size+ | +1 starting squad slot | flat 350 |
| Reroll reward | 1 free reward reroll per mission | `cost(n) = 70 * 1.4^n` |
| Revive token | Revive 1 fallen unit once per run | flat 300 |
| Terrain insight | See hazard/cover tiles before battle starts | flat 100 |
| Boss preview | See boss ability set before the final battle | flat 150 |

### Build variety

Minimum 3 squad archetypes proven by unit-role tagging: (1) alpha-strike
(high-damage, low-HP units, wins by eliminating threats before they act —
requires favorable turn order), (2) control (push/pull/hazard-creation
abilities that manipulate enemy positioning rather than dealing direct
damage), (3) tank-and-sustain (high-HP frontline + healer/support unit,
wins via attrition). PRD's unit/ability table tags each entry with its
archetype role.

### Portrait UI plan

Grid occupies y 200-968 (6x8 at 96px = 576x768, centered horizontally).
Per-unit HP bars float above each `unitToken` sprite (small `Bar`, 64x10px).
Turn-order preview strip (small portraits) runs horizontally at
y=SAFE.top-70. Ability bar for the selected unit docks in the bottom 220px
as 2-4 icon buttons (≥72px each). "End turn" `Button` sits bottom-right,
88px, clear of the ability bar's tap targets.

### Performance plan

Peak entities ~10-20 (units + hazard tiles + particles) — far under the 300
budget; this genre is entity-light by nature. `SpritePool` and `SpatialHash`
are low-value here (small unit counts don't need spatial partitioning);
`NavGrid` is the only mandatory system, used purely for movement-range BFS
and line-of-sight, not for continuous pathing. fps risk is minimal; the real
risk is UI complexity (range/AoE preview overlays redrawn every hover/drag)
— cache the highlighted-tile set per selection, don't recompute per frame.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Combat core | Turn resolution, ability execution, damage application | `interface AbilityDef { id: string; range: number; shape: 'line' \| 'circle' \| 'cone'; damage: number; cooldownTurns: number }` |
| Content/data | Unit roster, ability pool, mission enemy compositions | `interface UnitDef { id: string; baseStats: Record<StatKey, number>; abilities: string[] }` |
| UI/meta | Grid rendering, ability bar, turn-order strip, mission reward flow | `function onAbilitySelected(ability: AbilityDef, unit: UnitInstance): void` |
| Level/systems | `NavGrid` per map, `turnOrder.ts`, `abilityRange.ts`, terrain/hazard placement | `function tilesInRange(grid: NavGrid, origin: {col,row}, shape: string, radius: number): {col,row}[]` |
| Balance pass (integrator) | Tunes enemy squad curve, ability damage/cooldowns, wires all workstreams into `game.ts` | consumes all contracts above |

### Pitfalls

1. A grid sized for desktop mouse precision (small tiles, dense grid) fails
   on touch — tiles must be ≥72px so a fingertip doesn't ambiguously straddle two cells.
2. Turn-based genres with no time pressure risk running long — cap squad
   sizes (2-4 per side) and battle count (5-8) so an average battle resolves in under 90s of real time to fit the 480s run.
3. Two-step ability targeting (tap ability, then tap target) without a clear
   "targeting mode active" visual state leads to accidental moves being read as ability casts — always show a distinct cursor/highlight color while in targeting mode.
4. Enemy AI that always picks the "optimal" move reads as unbeatable and
   unfun in a short run — bias AI toward telegraphed, learnable patterns rather than perfect play.
5. Terrain/hazard tiles that are visually indistinguishable from normal
   floor tiles cause "unfair" deaths — hazard and cover tiles need distinct textures/tints, not just a tooltip.

### Video hook

30-60s clip: 0-10s a clean small skirmish (readable unit moves), 10-25s a
combo turn showing a control ability (push into hazard) killing 2 enemies at
once, 25-45s the boss battle's ability telegraph and the squad's coordinated
response, 45-60s the final kill on the boss. Payoff moment: the multi-unit
combo kill (push-into-hazard, or a cone/line ability catching several
enemies clustered on one tile).

## 10. Idle/incremental with active layer

Exponential economy with tap-assisted acceleration and a prestige reset — a
compressed `Cookie Clicker`/`Adventure Capitalist` loop for 480s, framed as
one recorded session rather than a persistent background-idle game (idle
accrual continues between recordings via meta save, but the on-screen run
must be an active 480s session, not a wait-and-check loop).

### Core loop and run shape

**Core loop:** tap to generate currency directly and to speed up
generator-building purchases; buy generators that produce currency per
second; when growth stalls, prestige for a permanent multiplier and restart
the curve from a stronger baseline.

| Time | Beat |
| --- | --- |
| 0:00-0:20 | Grace: tap-only currency, first generator affordable almost immediately. |
| 0:20-1:30 | Early (x1.3): first 2-3 generator tiers bought, tap contribution still relevant. |
| 1:30-3:00 | Mid (x1.7): generator income overtakes tap income, first upgrade multiplier bought. |
| 3:00-5:00 | Late (x2.3): higher generator tiers unlock, numbers cross into the thousands/millions. |
| 5:00-6:30 | Approaching prestige threshold: growth visibly slows, prestige option becomes attractive. |
| 6:30-7:45 | Climax: player prestiges (or pushes for one more tier), resets with a visible permanent multiplier banner. |
| 7:45-8:00 | Resolution: total earned, prestige level, meta currency banked. |

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Tap (main button/avatar) | Generates a burst of currency | `Controls.onTap` |
| Tap generator card | Buy/upgrade a generator (if affordable) | `Controls.onTap` |
| Hold on generator card | Buy max-affordable in one hold (bulk-buy) | `Controls.onHoldStart/onHoldEnd` |
| Tap prestige button | Reset run for a permanent multiplier | `Controls.onTap` on a `Button` (confirm dialog) |

### Systems required

| Module | Use |
| --- | --- |
| `core/stats.ts` | Generator `StatBlock` (base output, cost scaling) — reused as a clean container for per-generator numeric state and `Modifier[]` from prestige bonuses |
| `core/progression.ts` | `MetaSave.currency` doubles as the prestige-currency ledger; `metaModifiers()` applies permanent prestige multipliers to `StatBlock.get('output')` |
| `core/rng.ts` | `Rng` for rare "golden" tap bonus events |
| `ui/bars.ts` | Progress-to-next-prestige-threshold bar |
| `core/juice.ts` | `countTo` for the currency display (numbers must visibly climb, not snap), `pop`/`floatText` on every tap and purchase |
| NEW: needs `core/idleEconomy.ts` | Generator cost/output curve math and offline-progress-free active-session accrual; one-line spec: `interface GeneratorDef { id: string; baseCost: number; costGrowth: number; baseOutput: number }`, `function costOf(def: GeneratorDef, owned: number): number`, `function totalOutputPerSec(state: GeneratorState[]): number`. Not covered by the systems batch — this genre's core loop is bespoke. |
| NEW: needs `ui/generatorList.ts` | Scrollable vertical list of generator purchase cards with live cost/output display; game-specific view over `idleEconomy.ts`. |

### Content volume

| Item | Target | Minimum viable |
| --- | --- | --- |
| Generator tiers | 8-12 | 5 |
| Prestige-permanent upgrades | 16-24 | 10 |
| Tap-multiplier upgrades | 4-6 | 3 |
| Prestige resets available in one run | 1-2 | 1 |
| "Golden tap" random event types | 2-3 | 1 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `tap.baseValue` | 1 | 1-3 | currency | per tap |
| `tap.critChance` | 0.05 | 0.03-0.1 | fraction | "golden tap" chance, 10x value |
| `generator.tier1BaseCost` | 15 | 10-25 | currency | |
| `generator.costGrowth` | 1.15 | 1.1-1.2 | multiplier/purchase | standard incremental-genre curve |
| `generator.tier1BaseOutput` | 0.5 | 0.3-1 | currency/s | |
| `generator.tierCostMul` | 12 | 8-18 | multiplier | cost jump between tiers |
| `generator.tierOutputMul` | 8 | 6-12 | multiplier | output jump between tiers |
| `prestige.thresholdCurrency` | 100000 | 50000-200000 | currency | total earned to unlock prestige |
| `prestige.multiplierPerReset` | 1.5 | 1.3-2 | multiplier | permanent output multiplier |
| `prestige.currencyFormula` | sqrt(totalEarned/1e5) | n/a | prestige points | formula, not a flat number |
| `bulkBuy.holdMs` | 600 | 400-900 | ms | hold duration to trigger max-buy |
| `display.numberFormat` | scientific@1e6 | n/a | n/a | switch from plain digits to `1.23e6` past 1 million |
| `entityBudgetLive` | 5 | 1-10 | count | almost no live sprites; this genre is UI/number-driven |

### Progression math

Currency accrual: `total(t) = tapValue*taps(t) + integral(outputPerSec(t) dt)`,
approximated stepwise per generator purchase. Generator cost:
`cost(n) = baseCost * costGrowth^n`. Worked reference curve (tier-1 generator,
baseCost=15, costGrowth=1.15): 1st purchase 15, 10th purchase `15*1.15^10 ≈
60.7`, 25th purchase `15*1.15^25 ≈ 496.8`. Total-earned worked values across
the run (single midline playthrough, generator tiers unlocked progressively):
at 1 minute ≈ 200 currency (tap-dominated); at 3 minutes ≈ 8,000 currency
(2-3 generator tiers active); at 5 minutes ≈ 120,000 currency (crosses
`prestige.thresholdCurrency`, prestige becomes available); at 8 minutes ≈
900,000+ currency post-prestige (with the x1.5 multiplier applied from
minute 6 onward). Prestige points earned: `prestigePoints =
floor(sqrt(totalEarned/1e5))`, worked at totalEarned=120000 →
`floor(sqrt(1.2)) = 1` point, enough for the first permanent multiplier tier.

### Meta progression

This genre's meta layer and in-run layer are the same currency system by
design (`MetaSave.currency` tracks prestige points across sessions,
`MetaSave.upgrades` tracks permanent multiplier tiers purchased with those
points) — persistence is the point of the genre, not a bolt-on.

| Meta upgrade | Effect | Cost formula |
| --- | --- | --- |
| Global output x | +25% all generator output per stack | `cost(n) = 2 * 1.6^n` (prestige points) |
| Tap value x2 | Doubles tap value per stack | `cost(n) = 3 * 1.7^n` |
| Starting generators | Begin next run with N tier-1 generators pre-owned | `cost(n) = 5 * 1.8^n` |
| Faster prestige threshold | -10% threshold requirement per stack | `cost(n) = 4 * 1.7^n` |
| Offline-catchup (session-start bonus) | Grants 60s of accrued output instantly at run start | flat 8 points |
| Golden tap chance+ | +2% golden tap chance per stack | `cost(n) = 3 * 1.6^n` |
| New generator tier unlock | Unlocks tier 9-12 generators | flat 10 points per tier |
| Auto-tapper | Passive tap-equivalent income even without tapping | flat 15 points |

### Build variety

Minimum 3 viable strategies proven by generator-tier tagging: (1) broad
investment (spread currency across all available tiers evenly, steady
compounding growth), (2) tier-rush (dump everything into the single
highest-output-per-cost tier, spikier growth), (3) early-prestige-loop
(prestige as soon as the threshold is reachable, favoring more resets over
one deep run, valuable if `prestige.multiplierPerReset` is tuned high). PRD
must show the worked math for each strategy reaching a comparable total
currency by minute 8.

### Portrait UI plan

Tap target (large avatar/button, ≥200px) centered at y ~500-700, the single
biggest visual element and always reachable one-thumb. Currency total
(`countTo`-animated) pinned at y=SAFE.top-60, full-width, large text.
Generator list (`generatorList.ts`) occupies the bottom two-thirds as a
scrollable vertical list starting at y ~820 down to `VIEW.height -
SAFE.bottom`, each row ≥88px tall for thumb-safe tapping, scroll gesture via
`Controls.onDrag` on the list itself (distinct drag zone from the tap
button). Prestige button appears as a full-width banner directly above the
generator list only once `prestige.thresholdCurrency` progress exceeds 70%.

### Performance plan

Peak live sprites near zero (1-10) — this genre is a UI/number simulation,
not a sprite-density game, so `SpritePool`, `SpatialHash`, and `NavGrid` are
all unnecessary; none should appear in the implementation. The fps risk is
instead UI-side: redrawing the entire generator list or reformatting large
numbers every frame is wasteful — update currency displays via `countTo`
tweens triggered on value change, not per-frame `setText`, and only
re-render generator-list affordability state on purchase events, not on a
timer.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Combat core (economy core) | Tap handling, output accrual per tick, purchase cost math | `interface GeneratorDef { id: string; baseCost: number; costGrowth: number; baseOutput: number }` |
| Content/data | Generator tier roster, prestige multiplier table, golden-tap event definitions | `function costOf(def: GeneratorDef, owned: number): number` |
| UI/meta | `generatorList.ts`, currency display, prestige confirm flow, meta shop | `function onGeneratorPurchase(id: string, count: number): void` |
| Level/systems | Number formatting/scaling, prestige threshold tracking, save-state accrual rules | `function totalOutputPerSec(state: GeneratorState[]): number` |
| Balance pass (integrator) | Tunes cost/output curves, prestige threshold/multiplier, wires all workstreams into `game.ts` | consumes all contracts above |

### Pitfalls

1. A pure idle loop with no active-layer hook (tap-to-boost, bulk-buy
   timing) produces a static screen that is unwatchable on video — the tap
   button and its juice are mandatory, not optional, in this frame.
2. Plain-digit currency display becomes unreadable past 6-7 digits within a
   short session — `display.numberFormat` scientific notation must kick in well before minute 5.
3. A prestige threshold tuned for a multi-hour session (genre norm) never
   triggers in an 8-minute run — the worked progression math above must be
   validated against the actual 480s window, not ported from PC/mobile idle-genre defaults.
4. Generator cost curves that grow faster than output curves stall the game
   into an unwinnable plateau before minute 5 — verify `costGrowth` vs. `tierOutputMul` produces net-positive purchasing power across the whole run.
5. No visible feedback on passive income (numbers just silently climb)
   removes all the genre's satisfaction — every few seconds of accrued
   passive income should still produce small ambient `floatText`/`pop` cues, not just an increasing total.

### Video hook

30-60s clip: 0-10s rapid tapping and first generator purchases (fast visible
growth), 10-30s the number climbing through several magnitude jumps
(`countTo` animating big jumps), 30-45s reaching the prestige threshold
(banner appears, tension of "reset now or push further"), 45-60s the
prestige reset moment — screen flash, multiplier banner, numbers restart
from zero but visibly faster. Payoff moment: the prestige reset itself, the
single biggest state-change spectacle the genre has.

## 11. Extraction run

Risk-reward delving: go deeper for better loot or bank what you have — a
compressed `Risk of Rain`/looter-extraction loop for 480s.

### Core loop and run shape

**Core loop:** move through a procedurally-connected sequence of rooms
fighting enemies and collecting loot, deciding after each room whether to
push deeper (better loot, rising danger) or extract immediately (bank
current loot, end the run safely); dying loses unbanked loot.

| Time | Beat |
| --- | --- |
| 0:00-0:20 | Grace: entry room, no threat, first loot pickup teaches value tiers. |
| 0:20-1:30 | Rooms 1-3 (Early, x1.3): low-danger loot, first extraction point visible but not urgent. |
| 1:30-3:00 | Rooms 4-6 (Mid, x1.7): danger meter rising, loot value increasing, first real extract-or-push decision. |
| 3:00-5:00 | Rooms 7-9 (Late, x2.3): high-value loot rooms appear, danger meter nearing critical. |
| 5:00-6:30 | Rooms 10-11: a guaranteed extraction point plus one optional deep-vault room (highest risk/reward). |
| 6:30-7:45 | Climax (x3.2): if pushing to the vault, hardest enemy density/boss guards the best loot. |
| 7:45-8:00 | Resolution: extracted or died; loot banked (extract) vs. lost (death), meta currency from banked loot only. |

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Drag / axis move | Player moves through rooms | `Controls.onDrag`, `controls.axisX/axisY` |
| Tap | Attack/interact (loot pickup, door open) | `Controls.onTap` |
| Hold at an extraction point | Channel extraction (interruptible by taking damage) | `Controls.onHoldStart/onHoldEnd` |
| Swipe (optional) | Dodge/dash to escape a bad engagement | `Controls.onSwipe` |

### Systems required

| Module | Use |
| --- | --- |
| `core/stats.ts` | Player `StatBlock` (damage, speed, carry capacity); enemy `StatBlock` scaled by depth |
| `core/damage.ts` | `Health` for player and enemies; `rollDamage` for combat |
| `core/pool.ts` | `SpritePool` for enemy archetypes and loot pickups |
| `core/spatial.ts` | `SpatialHash` for enemy-vs-player and loot-pickup-radius queries |
| `core/grid.ts` | `NavGrid` per room for enemy pathing around obstacles |
| `core/run.ts` | `RunDirector` with `RunPhase[]` mapped to depth-based danger scaling (danger meter = phase progress, not wall-clock alone) |
| `core/progression.ts` | Meta currency from banked loot only (never from lost loot); unlocked starting gear |
| `data/enemies.ts` | Depth-scaled enemy rosters via `scaleEnemy` |
| `ui/bars.ts` | Player HP bar, danger-meter bar, extraction-channel progress bar |
| NEW: needs `core/lootTiers.ts` | Loot value tiers and depth-weighted drop tables; one-line spec: `interface LootDef { id: string; tier: 1 \| 2 \| 3 \| 4; value: number }`, `function rollLoot(rng: Rng, depth: number): LootDef`. |
| NEW: needs `core/extraction.ts` | Extraction-point state machine (channel progress, interrupt-on-damage, bank-on-complete); one-line spec: `class ExtractionPoint { constructor(x: number, y: number, channelMs: number); update(deltaMs: number, playerInRange: boolean, interrupted: boolean): 'idle' \| 'channeling' \| 'complete' }`. |
| NEW: needs `objects/room.ts` | Shared with action roguelike's room container (door/enemy roster/obstacle layout); reused pattern, not duplicated systems. |

### Content volume

| Item | Target | Minimum viable |
| --- | --- | --- |
| Enemy archetypes | 8-12 | 5 |
| Loot tiers | 4 | 3 |
| Loot item defs | 12-18 | 8 |
| Rooms per run (max depth) | 8-14 | 8 |
| Extraction points | 2-3 (one mandatory, 1-2 optional deeper) | 1 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `player.speed` | 280 | 220-340 | px/s | |
| `player.baseHp` | 90 | 70-120 | HP | |
| `player.attackDamage` | 12 | 8-18 | HP | |
| `extraction.channelMs` | 4000 | 3000-6000 | ms | hold-still-to-extract duration |
| `extraction.interruptOnHit` | true | n/a | boolean | any damage cancels channel progress |
| `danger.startValue` | 0 | 0 | meter units | |
| `danger.perRoomIncrease` | 8 | 5-12 | meter units | rises each room entered |
| `danger.max` | 100 | 100 | meter units | at max, enemy density/speed hit ceiling |
| `loot.tier1Value` | 10 | 5-15 | currency | common |
| `loot.tier4Value` | 150 | 100-250 | currency | rare, vault-only |
| `loot.depthWeightShift` | 0.15 | 0.1-0.2 | fraction/room | rarer tiers become more likely per room depth |
| `enemy.baseHp` | 35 | 25-50 | HP | room 1 |
| `enemy.baseSpeed` | 85 | 60-120 | px/s | |
| `vault.enemyDensityMul` | 2.5 | 2-3.5 | multiplier | optional deepest room |
| `carryCapacity` | 6 | 4-10 | loot item slots | forces a bank-or-push decision on full inventory |
| `entityBudgetLive` | 120 | 80-160 | count | per-room cap |

### Progression math

Danger meter (the genre's core tension mechanic) rises deterministically:
`danger(roomsEntered) = min(max, roomsEntered * perRoomIncrease)`. Worked:
room 4 (Mid, x1.7 phase) → `danger=32`; room 9 (Late, x2.3) → `danger=72`;
room 12+vault (Climax, x3.2) → `danger=96`, near the ceiling. Enemy HP scales
by both danger meter and the shared phase table:
`enemyHp(room) = baseHp * difficultyMul(phase) * (1 + danger(room)/100)`.
Worked (baseHp=35): room 4 → `35*1.7*(1+0.32) ≈ 78.5 HP`; room 9 →
`35*2.3*(1+0.72) ≈ 138.4 HP`; vault room → `35*3.2*(1+0.96)*vaultMul(2.5)
≈ 548.8 HP` per enemy, justifying the vault's risk. Loot value banked
scales with depth: expected value at extraction after N rooms ≈
`N * avgLootPerRoom * (1 + 0.15*N)` reflecting depth-weighted rarity shift.

### Meta progression

Persists via `MetaSave.currency` (from banked loot converted at run end,
never from loot lost on death) and `MetaSave.unlocks` (starting gear tiers).
Currency source: `grantCurrency(bankedLootValue * 0.5)` — only half converts
to permanent currency, the rest is spendable in-run only, to keep the
risk-reward tension meaningful run to run.

| Meta upgrade | Effect | Cost formula |
| --- | --- | --- |
| Starting HP+ | +10 starting HP per stack | `cost(n) = 55 * 1.3^n` |
| Carry capacity+ | +2 loot slots per stack | `cost(n) = 70 * 1.4^n` |
| Faster extraction | -500ms channel time per stack | `cost(n) = 65 * 1.35^n` |
| Danger dampener | -1 danger per room per stack | `cost(n) = 90 * 1.45^n` |
| Starting weapon+ | Begin with an upgraded weapon | flat 250 |
| Loot insurance | Keep 25% of lost loot value on death | flat 300 |
| Vault map reveal | See vault room location before entering | flat 150 |
| Second extraction point | A 2nd optional extraction point spawns earlier | flat 200 |

### Build variety

Minimum 3 strategies proven by risk-profile tagging: (1) safe-banker (extract
at the first opportunity every run, low variance, steady meta-currency
income), (2) deep-diver (push to the vault every run, high variance, biggest
single-run payouts but frequent total losses), (3) opportunist (extract
threshold decision made dynamically based on danger-meter reading and
current loot value — the PRD documents a concrete decision rule, e.g.
"extract once `danger > 70` unless carrying < 50% capacity"). PRD shows the
expected-value math favoring each strategy under different luck conditions.

### Portrait UI plan

Rooms fill y 140-1060. Danger meter (`Bar`, red-tinted) pinned top-center at
y=SAFE.top-70, full-width, most visually prominent HUD element since it
drives the core decision. Player HP `Bar` top-left. Loot/carry-capacity
indicator (icon row) top-right. Extraction-channel progress ring renders
around the player when standing in an extraction zone (world-space, not
HUD) so channeling never requires looking away from combat-relevant space.
No permanent bottom-220px UI; a "push deeper / extract" choice prompt (two
full-width stacked buttons) appears only at room-transition doors.

### Performance plan

Peak entities ~100-160 (enemies + loot pickups + particles) per room,
scaling toward the vault's `vaultEnemyDensityMul`, under the 300 budget.
`SpritePool` for enemy archetypes and loot pickups. `SpatialHash` mandatory
for enemy-vs-player and loot-pickup-radius queries at vault density.
`NavGrid` per room for enemy pathing, rebuilt once per room load (rooms are
static once generated, no runtime placement to invalidate the flow field
mid-room).

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Combat core | Player attack, enemy AI, damage resolution | `interface EnemyDef` (from `data/enemies.ts`) with depth-scaled `scaleEnemy` |
| Content/data | Loot tables (`lootTiers.ts`), enemy rosters, vault room composition | `function rollLoot(rng: Rng, depth: number): LootDef` |
| UI/meta | Danger meter, HP/carry HUD, extract-or-push prompt, meta shop | `function onExtractComplete(bankedLoot: LootDef[]): void` |
| Level/systems | Room generation/connection graph, `extraction.ts` state machine, `NavGrid` per room | `class ExtractionPoint { update(deltaMs, playerInRange, interrupted): 'idle' \| 'channeling' \| 'complete' }` |
| Balance pass (integrator) | Tunes danger curve, loot value curve, wires all workstreams into `game.ts` | consumes all contracts above |

### Pitfalls

1. A danger meter that only ever goes up with no way to read current risk at
   a glance makes the extract-or-push decision feel arbitrary — the meter must be the single most visually prominent HUD element, not a small corner readout.
2. Loot lost entirely on death with no partial-recovery mechanic can feel
   punishing enough to churn players after one bad run — the `loot insurance` meta upgrade (or an equivalent) should exist from the start, not be an afterthought.
3. Extraction channel interruptible by any damage, including chip damage
   from unavoidable sources, makes late-run extraction feel impossible —
   verify the vault's enemy density doesn't guarantee at least one hit during
   the full `channelMs` window.
4. Procedural room connections that can dead-end without an extraction point
   reachable strand the player with no way to bank loot — the room graph
   generator must guarantee a path to at least one extraction point from
   every generated room.
5. A carry-capacity limit that's never actually reached in normal play
   removes the "what do I drop" tension the genre relies on — tune capacity
   against the worked loot-value math so it binds by mid-run.

### Video hook

30-60s clip: 0-10s early rooms with easy loot grabs, 10-25s the danger meter
visibly climbing as rooms get harder, 25-40s a tense fight in a
high-value/high-risk room, 40-50s the extract-or-push decision moment (player
visibly hesitates at a door, danger meter prominent), 50-60s payoff — either
a successful vault clear with rare loot or a nail-biting extraction channel
completing just as an enemy arrives. Payoff moment: the extraction channel
completing under pressure (enemy closing in, channel bar filling in the last
second).

## 12. Dungeon crawler

Grid-based rooms with fog of war and inventory management — a compressed
`Brogue`/`Shattered Pixel Dungeon` loop for 480s.

### Core loop and run shape

**Core loop:** move tile-by-tile through a fog-of-war dungeon, fighting
enemies encountered on the grid, collecting and managing inventory items,
descending through floors until a final-floor boss or the timer ends the run.

| Time | Beat |
| --- | --- |
| 0:00-0:20 | Grace: floor 1 entry, fog reveals immediate surroundings, first enemy tile encounter. |
| 0:20-1:30 | Floor 1 (Early, x1.3): teaches move/attack-by-move, first item pickup, first inventory decision. |
| 1:30-3:00 | Floor 2 (Mid, x1.7): fog-revealed rooms with locked doors/keys, second enemy archetype. |
| 3:00-5:00 | Floor 3 (Late, x2.3): inventory pressure (limited slots), a trap room. |
| 5:00-6:30 | Floor 4: elite guardian room before the final floor, best-item-of-run choice. |
| 6:30-7:45 | Floor 5 / boss floor (Climax, x3.2): boss encounter in a large revealed arena room. |
| 7:45-8:00 | Resolution: floors reached, items found, meta currency. |

### Primary verb and secondary interactions

| Input | Effect | Template hook |
| --- | --- | --- |
| Tap adjacent tile | Move into it, or attack if it holds an enemy | `Controls.onTap` |
| Swipe | Directional move (alternative/faster input for repeated movement) | `Controls.onSwipe` |
| Tap inventory item | Use/equip item | `Controls.onTap` on a UI panel |
| Hold on floor tile | Preview tile info (trap, loot, enemy stats) before committing | `Controls.onHoldStart/onHoldEnd` |

### Systems required

| Module | Use |
| --- | --- |
| `core/grid.ts` | `NavGrid` for the dungeon floor layout, enemy pathing, and fog-of-war visibility calculation basis (`isBlocked`/`worldToCell`/`cellToWorldCenter`) — mandatory, the entire floor is this grid |
| `core/stats.ts` | Player `StatBlock` (HP, damage, defense) modified by equipped items via `Modifier[]` |
| `core/damage.ts` | `Health` for player and enemies; `rollDamage` for tile-attack resolution |
| `core/pool.ts` | `SpritePool` for enemy archetypes and item pickups |
| `core/spatial.ts` | Low value on a strict grid (tile-indexed lookups suffice); optional for smooth-motion visual interpolation between tiles |
| `core/run.ts` | `RunPhase[]` reused per-floor (floor index instead of wall-clock) for enemy/loot scaling |
| `core/progression.ts` | Meta currency, unlocked starting items/classes |
| `data/enemies.ts` | Floor-scaled enemy rosters via `scaleEnemy` |
| `data/upgrades.ts` | Reused as the permanent-item/perk unlock pool for meta shop |
| `ui/bars.ts` | Player HP bar |
| NEW: needs `core/fogOfWar.ts` | Per-tile visibility state (unseen/seen/visible) and reveal-radius calculation on the `NavGrid`; one-line spec: `class FogOfWar { constructor(grid: NavGrid); reveal(col: number, row: number, radius: number): void; visibility(col: number, row: number): 'unseen' \| 'seen' \| 'visible' }`. |
| NEW: needs `core/inventory.ts` | Shared pattern with survival crafting's inventory module, reused here for equip slots + limited-capacity item bag: `class Inventory { items: ItemInstance[]; capacity: number; add(item: ItemInstance): boolean; equip(item: ItemInstance, slot: string): void }`. |
| NEW: needs `data/floorgen.ts` | Deterministic per-floor room/corridor grid generator (distinct from the action-roguelike's node-graph floorgen — this one produces an actual tile grid, not a room-connection graph); one-line spec: `function generateFloorGrid(rng: Rng, cols: number, rows: number): NavGrid`. |

### Content volume

| Item | Target | Minimum viable |
| --- | --- | --- |
| Enemy archetypes | 8-12 | 5 |
| Items (weapons/armor/consumables) | 16-24 | 10 |
| Floors | 4-6 | 3 |
| Bosses | 1-2 | 1 |
| Trap/hazard tile types | 3-4 | 2 |

### Numbers table

| Key | Value | Range | Unit | Note |
| --- | --- | --- | --- | --- |
| `grid.cols` | 10 | 8-14 | tiles | per floor |
| `grid.rows` | 14 | 10-18 | tiles | per floor |
| `grid.tileSize` | 64 | 48-80 | px | 10*64=640, fits 720 width |
| `fog.revealRadius` | 3 | 2-4 | tiles | around player |
| `player.baseHp` | 70 | 50-100 | HP | |
| `player.baseAttackDamage` | 10 | 6-16 | HP | |
| `player.moveMs` | 160 | 100-220 | ms | tile-to-tile move animation |
| `inventory.capacity` | 8 | 6-12 | slots | |
| `inventory.equipSlots` | 3 | 2-4 | slots (weapon/armor/trinket) | |
| `enemy.baseHp` | 20 | 15-35 | HP | floor 1 |
| `enemy.baseDamage` | 6 | 4-12 | HP | per attack |
| `trap.damageBase` | 8 | 5-15 | HP | |
| `floor.enemyCountBase` | 6 | 4-10 | count | floor 1 |
| `floor.itemCountBase` | 4 | 3-6 | count | floor 1 |
| `boss.hpMul` | 8 | 5-12 | multiplier | vs base enemy |
| `entityBudgetLive` | 60 | 40-100 | count | per-floor cap (fog limits visible entities) |

### Progression math

Enemy and item counts scale per floor using the shared phase table:
`enemyHp(floor) = baseHp * difficultyMul(phaseOfFloor(floor))`,
`enemyCount(floor) = floorEnemyCountBase + floor*2`. Worked (baseHp=20):
floor 1 (Grace/Early, x1.3) → `26 HP`, 8 enemies; floor 2 (Mid, x1.7) →
`34 HP`, 10 enemies; floor 3 (Late, x2.3) → `46 HP`, 12 enemies; boss floor
(Climax, x3.2) → `64 HP` per regular enemy, boss at `64*8 = 512 HP`. Item
rarity weight shifts by floor: `rareChance(floor) = min(0.4, 0.05 * floor)`,
worked floor 4 → `0.2` (20% chance of a rare-tier item drop).

### Meta progression

Persists via `MetaSave.unlocks` (starting classes/items) and
`MetaSave.upgrades` (starting HP, starting inventory capacity). Currency
source: `grantCurrency(floorsCleared * 40 + itemsFound * 5)`.

| Meta upgrade | Effect | Cost formula |
| --- | --- | --- |
| Starting HP+ | +10 starting HP per stack | `cost(n) = 55 * 1.3^n` |
| Inventory capacity+ | +1 slot per stack | `cost(n) = 70 * 1.4^n` |
| Unlock starting class | New starting stat/item loadout | flat 300 per class |
| Identify scroll start | Begin with 1 free item-identify | flat 100 |
| Fog radius+ | +1 reveal radius per stack | `cost(n) = 80 * 1.4^n` |
| Trap sense | Traps show a subtle tell before triggering | flat 200 |
| Extra floor key | Skip one locked-door puzzle per run | flat 150 |
| Revive scroll | 1 free revive at 30% HP | flat 350 |

### Build variety

Minimum 3 strategies proven by item-tag synergy: (1) heavy-armor tank
(equip high-defense items, trade damage output for survivability, wins via
attrition), (2) glass-cannon (high-damage weapon + low-defense trinkets,
relies on avoiding hits via fog-aware positioning), (3) consumable-hoarder
(prioritizes potions/scrolls over equipment, wins via resource management
and tactical item use in tough encounters). PRD's item table tags each entry
with its archetype role.

### Portrait UI plan

Dungeon grid occupies y 200-968 (10x12 visible tiles at 64px ≈ 640x768,
centered; larger floors scroll/follow the player, camera-locked to keep the
player roughly centered). Player HP `Bar` top-left under SAFE.top. Floor
indicator top-center. Inventory bar docks in the bottom 220px as a
horizontal row of 6-8 equip/item slots (≥72px each), tap to use/equip;
tapping a slot never requires looking at the grid simultaneously since combat
is turn-based-by-move (no real-time pressure while the inventory panel is
open).

### Performance plan

Peak entities ~40-100 per floor (limited further by fog-of-war — only
`visible` and recently-`seen` tiles need live enemy sprites; `unseen` tiles
hold no instantiated entities at all), well under the 300 budget.
`SpritePool` for enemy archetypes and item pickups. `NavGrid` is mandatory
(the floor is the grid) but `SpatialHash` is low-value since all lookups are
tile-indexed, not continuous-position. The fog-of-war reveal calculation is
the main fps risk if recomputed every frame — recompute only on player
tile-change, not per tick.

### Parallel build split

| Workstream | Owns | Interface contract |
| --- | --- | --- |
| Combat core | Tile-attack resolution, enemy AI (chase/patrol on `NavGrid`) | `interface EnemyDef` (from `data/enemies.ts`) with grid-appropriate `ai` field |
| Content/data | Enemy roster, item pool, floor-scaling tables | `interface ItemDef { id: string; slot: 'weapon' \| 'armor' \| 'trinket' \| 'consumable'; modifiers: Modifier[] }` |
| UI/meta | Inventory bar, HP HUD, floor-transition flow, meta shop | `function onItemUse(item: ItemInstance): void` |
| Level/systems | `floorgen.ts`, `fogOfWar.ts`, `NavGrid` per floor, `Inventory` | `function generateFloorGrid(rng: Rng, cols: number, rows: number): NavGrid` |
| Balance pass (integrator) | Tunes floor enemy/item curves, item stats, wires all workstreams into `game.ts` | consumes all contracts above |

### Pitfalls

1. Fog-of-war recomputed every frame instead of on tile-change causes
   needless per-tile visibility recalculation across the whole grid — gate the recompute to player-move events only.
2. Tile-by-tile movement animation (`player.moveMs`) too slow makes a 4-6
   floor run feel sluggish within the 480s budget — verify total move-time
   budget against expected tiles-traveled per floor before locking the value.
3. Locked-door/key puzzles without a visible "you need a key" tell on the
   door strand players who don't realize backtracking is required — doors
   must be visually distinct from walls and show a lock icon.
4. Inventory capacity too generous removes the genre's core tension (what to
   carry, what to leave); too stingy makes every pickup a chore — validate
   against the worked item-count table (floor.itemCountBase growth) so
   capacity binds by floor 2-3, not floor 5.
5. Enemies that path through fog-unrevealed tiles as if already visible to
   the player (AI omniscience) breaks the fog-of-war's tactical value — enemy
   AI should only react to the player once the player's tile is in the
   enemy's own vision/aggro radius, not globally.

### Video hook

30-60s clip: 0-10s fog revealing a room as the player enters (visually
satisfying reveal effect), 10-25s a tile-combat encounter with a clear
attack-by-move rhythm, 25-40s an inventory decision moment (picking up a
notably better item, juicy `pop`+`sfx`), 40-55s the boss floor's large
revealed arena and fight, 55-60s the killing blow. Payoff moment: the
boss-floor fog reveal — the single biggest "wow" moment when a large room
opens up all at once via `FogOfWar.reveal`.

## Cross-genre system reuse matrix

`M` mandatory, `O` optional/low-value, `-` unused, `NEW` needs a new module
(named in the genre section above).

| Module | Survivor | Action-RL | Tower-D | Deck-RL | Auto-battler | Survival | Base-builder | Bullet-hell | Tactics | Idle | Extraction | Crawler |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `core/stats.ts` | M | M | M | M | M | M | M | M | M | O | M | M |
| `core/damage.ts` | M | M | M | M | M | M | M | M | M | - | M | M |
| `core/pool.ts` | M | O | M | O | M | M | M | M | O | - | M | M |
| `core/spatial.ts` | M | O | M | - | O | M | M | M | O | - | M | O |
| `core/grid.ts` (`NavGrid`) | - | M | M | - | O | M | M | - | M | - | M | M |
| `core/run.ts` (`RunDirector`) | M | M | M | O | M | M | M | O (phase-only) | O (mission-indexed) | - | M | O (floor-indexed) |
| `core/progression.ts` | M | M | M | M | M | M | M | M | M | M | M | M |
| `data/enemies.ts` | M | M | M | M | M (as units) | M | M | - | M | - | M | M |
| `data/upgrades.ts` | M | M | - | M (as cards) | M (as items) | M (as recipes-adjacent) | - | - | M (as abilities) | - | - | M (as items) |
| `data/waves.ts` | M | O | M | - | M (as rounds) | O | M | - | - | - | O | - |
| `ui/cards.ts` | M | M | - | M | M (augments) | - | - | - | - | - | - | - |
| `ui/bars.ts` | M | M | M | M | M | M | M | M | M | M | M | M |
| NEW modules needed | `weapon.ts` | `floorgen.ts`, `room.ts` | `tower.ts`, `towerShop.ts` | `deck.ts`, `enemyIntent.ts`, `handUI.ts` | `autobattle.ts`, `shopTray.ts` | `inventory.ts`, `recipes.ts`, `craftMenu.ts` | `building.ts`, `buildTray.ts` | `bulletPattern.ts`, `hitbox.ts` | `turnOrder.ts`, `abilityRange.ts`, `unitToken.ts` | `idleEconomy.ts`, `generatorList.ts` | `lootTiers.ts`, `extraction.ts`, `room.ts` | `fogOfWar.ts`, `inventory.ts`, `floorgen.ts` |

Note: `room.ts` (action roguelike, extraction run) and `inventory.ts`
(survival crafting, dungeon crawler) are each shared patterns across two
genres — build once, reuse across both PRDs when both are in the pipeline in
the same period, rather than duplicating.

## Red flags

Things a single-session (or few-session) build must never take on,
regardless of genre pitch:

| Red flag | Why it cannot ship in this pipeline |
| --- | --- |
| Multiplayer (real-time or async PvP/co-op) | Requires a server, matchmaking, and state-sync architecture outside `template/` (client-only Phaser + Vite, no backend). |
| Real-time networking of any kind | Same constraint — no server component exists or is planned; even leaderboards use client-side `submitScore()` against local storage, not a network call. |
| Procedural/branching narrative (dialogue trees, story state machines) | No dialogue/text-authoring pipeline or localization system exists; narrative complexity does not fit a 480s run or a 1-2 session build. |
| 3D rendering or physics | The template is Arcade Physics (2D) on a fixed portrait canvas; 3D requires a different renderer/physics engine entirely, violating "no new dependency without a reason the template cannot cover." |
| Hand-authored illustrated art dependencies (character art, environment art, sprite sheets from an external artist) | The pipeline is procedural-texture-first (`disc ring square spike star particle panel`); illustrated art adds an asset-generation step per `AGENTS.md` that most genres above do not require and that breaks the zero-asset build contract. |
| Save-scumming-dependent designs (permadeath value that assumes the player cannot reload a save to retry) | `storage.ts` persistence is local and player-controlled; any design relying on the player being unable to undo a bad outcome (e.g. permanent multiplayer consequences, server-authoritative loss) does not hold in a client-only, single-player context. |
| Persistent server-side economy or anti-cheat | No backend exists; all currency/progression is `localStorage`-backed `MetaSave`, trivially editable client-side — designs must not assume tamper-resistance. |
| Voice acting, licensed music, or streamed audio assets | Audio is 100% synthesised WebAudio (`core/audio.ts`); adding audio files is an explicit escalation path in `AGENTS.md`, not a default, and voice/licensed music is out of scope entirely. |

