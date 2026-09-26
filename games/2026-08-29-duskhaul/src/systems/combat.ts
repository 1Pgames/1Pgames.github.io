import Phaser from 'phaser';
import { TUNING, VIEW } from '../config';
import { TEX } from '../core/keys';
import { Pool } from '../core/pool';
import { SpatialHash } from '../core/spatial';
import { allowEffect, burst, floatText, hitFlash, playFx } from '../core/juice';
import { sfx } from '../core/audio';
import { Rng } from '../core/rng';
import { ACTOR_FX, baseKeyOf } from '../core/outline';
import type { NavGrid } from '../core/grid';
import { ANIM } from '../data/art';
import {
  DEATH_CREDIT_WINDOW_MS,
  ENEMIES,
  SPAWN_RING_TRIES,
  actionScale,
  deathCredit,
  midBossDef,
  spawnRingPoint,
  zoneBossDef,
  type EnemyDef,
  type HitRecord,
} from '../data/enemies';
import type {
  CombatCallbacksV2,
  EliteAffixId,
  GeneratedMap,
  KillReport,
  PoiSpawnSpec,
  RunLoadoutV2,
  WeaponId,
  ZoneId,
} from '../data/types-v2';
import { densityTarget } from '../data/waves';
import type { WaveSpec } from '../core/run';
import type { ChannelContest } from './extraction';
import { depthAt } from './mapgen';
import type { Arena } from './arena';
import { Player } from '../objects/player';
import { Enemy, TELEGRAPH, type EnemyHost, type StrikeSpec } from '../objects/enemy';
import { CorpseFx } from '../objects/corpse';
import { Projectile } from '../objects/projectile';
import { XpOrb, mergeXpOrbs } from '../objects/xporb';
import { Coin } from '../objects/coin';
import type { BreakableField } from '../objects/breakable';
import { WeaponSystem, type ThrallSpec, type WeaponHost } from './weapons';
import { Thrall, type ThrallHost } from '../objects/thrall';
import { createEffectState, type EffectState } from '../core/effects';

/**
 * Combat core of a Duskhaul run (PRD-V2 §3.9, §5.4-5.6, §13): owns the hero,
 * the enemy / hostile-shot / orb / coin pools, the broad-phase hash, spawning
 * on the big map (spawn ring with nav-blocked rejection, POI populations,
 * elites, mid-bosses, zone bosses), steering (WorldGen flow field + boid
 * separation), leash/recycle, stuck detection, contact and telegraphed damage,
 * and the kill pipeline (`KillReport`). Hero weapons live in
 * `systems/weapons.ts` behind `WeaponHost`, which this class implements.
 *
 * Performance contract: one hash rebuild per frame, all hit detection through
 * it, every entity pooled, no allocation in the steady-state `update` path.
 */

const DEFS: Record<string, EnemyDef> = {};
for (const def of ENEMIES) DEFS[def.id] = def;

const COIN_SCATTER_PX = 26;
const SLOW_SOURCE = 'combat:slow';
/** §15: enemy projectile budget; ground zones kept alive at once. */
const MAX_SHOTS = 80;
const MAX_ZONES = 24;
const LEASH_TICK_MS = 250;
/** Heading offsets (rad) probed for a blocker in front of a stuck body. */
const STUCK_PROBE_OFFSETS = [0, 0.8, -0.8] as const;
/** Bodies within this of the hero count as the crowd in a swarm death (critic F5). */
const CROWD_PX = 200;
/** A body counts toward the swarm when within its contact reach plus this margin. */
const CROWD_MARGIN_PX = 40;
/** Trash-death crunch cap: pitch-jittered, so 8/s reads as a pile-up, not a machine gun. */
const DEATH_SFX_PER_S = 8;
/** Hero-hurt thud cap; i-frames already space contact hits. */
const HURT_SFX_PER_S = 4;
/** §6.3 density is measured within this of the hero. */
const DENSITY_RADIUS_PX = 900;
/** §5.8b.1: at most this many Husk Thralls alive; they appear this far from the hero. */
const MAX_THRALLS = 4;
const THRALL_SUMMON_PX = 90;
/** Floor on the visible telegraph of any damaging strike (§13.2). */
const TELEGRAPH_MIN_MS = 500;
/** Critic B2: POI/event bodies stop chasing once the hero is this far from their anchor. */
const POI_LEASH_PX = 1200;
/** Held-off elites orbit at `eliteNearPx + 300`; they stay counted (and held) out to this margin. */
const HOLD_RELEASE_PX = 360;
/** Height of one plate block (name + affix icon + HP bar) — the stacking step. */
const PLATE_STACK_PX = 66;
/** Width of a plate block (name plate / HP bar) for the overlap test. */
const PLATE_W = 190;
/** Anti-pin: moving slower than this share of the input speed for `PIN_MS` triggers a breakout. */
const PIN_SPEED_RATIO = 0.2;
const PIN_MS = 1500;
/** Breakout ring: bodies inside are thrown out to this radius and stunned briefly. */
const BREAKOUT_PX = 260;
const BREAKOUT_STUN_MS = 500;
const ORB_MERGE_MS = 500;
/** Shots live this long before culling. */
const SHOT_LIFE_MS = 2600;
/** Beyond this, a telegraph edge turns lethal red (§13.2 "lethal-strike frames"). */
const LETHAL_EDGE_MS = 180;
/** Hook pull duration. */
const PULL_MS = 260;
/** Sample window for the p95 stuck stat (1 sample/s). */
const STUCK_HISTORY = 600;

interface HostileShot {
  img: Phaser.GameObjects.Image;
  ghosts: Phaser.GameObjects.Image[];
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  lifeMs: number;
  source: string;
  owner: Enemy | null;
  ownerUid: string;
}

interface Strike {
  spec: StrikeSpec;
  gfx: Phaser.GameObjects.Graphics;
  leftMs: number;
  lethalDrawn: boolean;
}

interface GroundZone {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  radius: number;
  slowPct: number;
  dps: number;
  untilMs: number;
  source: string;
}

interface TollRing { gfx: Phaser.GameObjects.Graphics; x: number; y: number; r: number; to: number; speed: number; damage: number; hit: boolean; source: string }
interface Beam { owner: Enemy; gfx: Phaser.GameObjects.Graphics; angle: number; radPerMs: number; length: number; leftMs: number; damage: number; tickMs: number; nextTickMs: number }
interface Wall { imgs: Phaser.GameObjects.Image[]; untilMs: number }
interface Rally { x: number; y: number; r: number; mul: number; untilMs: number; img: Phaser.GameObjects.Image }
interface Egg { img: Phaser.GameObjects.Image; hatch: number; defId: string; atMs: number }

export interface CombatDebugStats {
  live: number;
  poiLive: number;
  stuckEnemies: number;
  stuckP95: number;
  leashReseats: number;
  withinLeashPct: number;
  spawnRejected: number;
  flowRebuilds: number;
  flowMsMax: number;
  /** Balance density rule: live bodies within 900 px, and the target they are held to. */
  near900: number;
  densityTarget: number;
  /** Leash triggers that despawned (over target) instead of re-seating. */
  leashDespawns: number;
  /** Critic B2: POI/event bodies trimmed at the hard cap, and bodies sent home. */
  populationTrimmed: number;
  poiReturns: number;
  /** Critic B3: engaged elites near the hero (≤ eliteNearCap), and anti-pin breakouts fired. */
  elitesNear: number;
  breakouts: number;
}

export class CombatSystem implements WeaponHost, EnemyHost, ThrallHost {
  readonly player: Player;
  readonly effects: EffectState = createEffectState();
  readonly weapons: WeaponSystem;
  private bonuses: { eliteDamageMul: number; vsEnemyMul: Readonly<Record<string, number>> } = { eliteDamageMul: 1, vsEnemyMul: {} };
  readonly scene: Phaser.Scene;
  readonly rng: Rng;
  /** Hero position/velocity view for enemy AI (updated each frame). */
  readonly hero = { x: 0, y: 0, vx: 0, vy: 0 };
  /** EnemyHost: hazard boss phase thresholds (`loadout.hazardExtras.bossPhaseAt`, H5 75/40%). */
  readonly bossPhaseAt: readonly [number, number];
  /** EnemyHost: run-wide enemy move-speed multiplier (Hastened Dead `mu_haste`). */
  enemySpeedMul = 1;
  /** Crowded Graves (`mu_crowded`): live-near target multiplier and the raised body ceiling. */
  private densityMul = 1;
  private maxAlive: number = TUNING.enemy.maxAlive;

  private readonly callbacks: CombatCallbacksV2;
  private readonly arena: Arena;
  private readonly enemyPool: Pool<Enemy>;
  private readonly shotPool: Pool<Projectile>;
  private readonly orbPool: Pool<XpOrb>;
  private readonly coinPool: Pool<Coin>;
  private readonly corpses: CorpseFx;
  private readonly enemies: Enemy[] = [];
  private readonly shots: Projectile[] = [];
  private readonly orbs: XpOrb[] = [];
  private readonly coins: Coin[] = [];
  private readonly hostile: HostileShot[] = [];
  private readonly hostileFree: HostileShot[] = [];
  private readonly strikes: Strike[] = [];
  private readonly gfxFree: Phaser.GameObjects.Graphics[] = [];
  private readonly zones: GroundZone[] = [];
  private readonly rings: TollRing[] = [];
  private readonly beams: Beam[] = [];
  private readonly wallList: Wall[] = [];
  private readonly rallies: Rally[] = [];
  private readonly eggList: Egg[] = [];
  private readonly wallGroup: Phaser.Physics.Arcade.StaticGroup;
  private readonly hash: SpatialHash<Enemy>;
  private readonly near: Enemy[] = [];
  private readonly sepNear: Enemy[] = [];
  private readonly enemyGroup: Phaser.Physics.Arcade.Group;
  private readonly spawnPoint = { x: 0, y: 0 };
  private readonly bossAdds = new Set<Enemy>();

  private nav: NavGrid | null = null;
  private map: GeneratedMap | null = null;
  private breakables: BreakableField | null = null;
  private spawnFilter: ((x: number, y: number) => boolean) | null = null;
  private navCol = -1;
  private navRow = -1;
  private navSinceMs = 0;
  private difficulty = 1;
  private paused = false;
  private dead = false;
  private spawnSilencedUntilMs = -Infinity;
  private lastArcAngle: number | null = null;
  private lastArcAngleAt = -Infinity;
  private leashClockMs = 0;
  private orbClockMs = 0;
  private slowPct = 0;
  private timedSlowPct = 0;
  private timedSlowMs = 0;
  private levelUps = 0;
  private revived = false;
  private lastHitSource = 'the dark';
  /** Blows taken in the last `DEATH_CREDIT_WINDOW_MS` (death credit). */
  private readonly hits: HitRecord[] = [];
  private readonly stats: CombatDebugStats = {
    live: 0, poiLive: 0, near900: 0, densityTarget: 0, stuckEnemies: 0, stuckP95: 0, leashReseats: 0, leashDespawns: 0,
    populationTrimmed: 0, poiReturns: 0, elitesNear: 0, breakouts: 0,
    withinLeashPct: 100, spawnRejected: 0, flowRebuilds: 0, flowMsMax: 0,
  };
  private readonly ftue: boolean;
  private readonly eliteScratch: Enemy[] = [];
  /** §5.8b.1 Husk Thralls: pooled hero allies (never in `enemies`). */
  private readonly thralls: Thrall[] = [];
  private readonly thrallPool: Thrall[] = [];
  private readonly thrallGroup: Phaser.Physics.Arcade.Group;
  private readonly platedScratch: Enemy[] = [];
  /** Anti-pin: ms the hero has moved slower than `PIN_SPEED_RATIO` of its input. */
  private pinnedMs = 0;
  private readonly lastHeroPos = { x: 0, y: 0 };
  private readonly stuckHistory: number[] = [];
  private stuckClockMs = 0;
  private debugKeys: (() => void) | null = null;

  constructor(scene: Phaser.Scene, arena: Arena, callbacks: CombatCallbacksV2, loadout: RunLoadoutV2) {
    this.scene = scene;
    this.arena = arena;
    this.callbacks = callbacks;
    this.rng = new Rng(`combat:${loadout.seed}`);
    this.ftue = loadout.mode === 'ftue';
    this.bossPhaseAt = loadout.hazardExtras.bossPhaseAt;
    this.hash = new SpatialHash<Enemy>(TUNING.caps.spatialCellSize);

    this.player = new Player(scene, arena.spawn.x, arena.spawn.y, loadout.modifiers, loadout.classId);
    this.player.health.invulnMs = TUNING.player.invulnMs + loadout.iframesMsBonus;
    if (loadout.reviveCharges > 0) {
      this.effects.lastGaspCharges = loadout.reviveCharges;
      this.effects.lastGaspReviveRatio = loadout.reviveHpRatio;
      this.effects.lastGaspIframesMs = loadout.reviveImmunityMs;
    }
    scene.physics.add.collider(this.player, arena.obstacles);
    this.enemyGroup = scene.physics.add.group();
    scene.physics.add.collider(this.enemyGroup, arena.obstacles);
    this.wallGroup = scene.physics.add.staticGroup();
    this.thrallGroup = scene.physics.add.group();
    scene.physics.add.collider(this.thrallGroup, arena.obstacles);
    scene.physics.add.collider(this.player, this.wallGroup);
    scene.physics.add.collider(this.enemyGroup, this.wallGroup);

    this.enemyPool = new Pool<Enemy>(() => this.createEnemy(), (e) => e.despawn(), 80);
    this.corpses = new CorpseFx(scene);
    this.shotPool = new Pool<Projectile>(() => new Projectile(scene), (s) => s.despawn(), 64);
    this.orbPool = new Pool<XpOrb>(() => new XpOrb(scene), (o) => o.despawn(), 64);
    this.coinPool = new Pool<Coin>(() => new Coin(scene), (c) => c.despawn(), 16);
    this.weapons = new WeaponSystem(this, loadout);
    this.syncHero();
    this.installDebug();
  }

  // ── wiring (§16.1 E8/E20) ──────────────────────────────────────────────

  /** E4/E8: the run's nav grid (flow field + spawn rejection); `map` enables depth threat (E2). */
  setNav(nav: NavGrid, map?: GeneratedMap): void {
    this.nav = nav;
    this.map = map ?? null;
    this.navCol = -1;
  }

  /** E20: breakables hit by weapons delegate here. */
  setBreakables(field: BreakableField): void {
    this.breakables = field;
  }

  /** Spawn-position veto (open-gate `extract.suppressRadius`, §3.9). */
  setSpawnFilter(filter: ((x: number, y: number) => boolean) | null): void {
    this.spawnFilter = filter;
  }

  /** Mutator `run` params that live in combat (`data/mutators.ts`): enemy speed, Crowded Graves density + ceiling. */
  setRunMutators(p: { enemySpeedMul: number; densityMul: number; maxAliveCap: number }): void {
    this.enemySpeedMul = p.enemySpeedMul;
    this.densityMul = p.densityMul;
    this.maxAlive = Math.max(TUNING.enemy.maxAlive, Math.min(p.maxAliveCap, Math.round(TUNING.enemy.maxAlive * p.densityMul)));
  }

  /** Suppresses ambient `spawn()` for `ms` (breather). */
  silenceSpawns(ms: number): void {
    this.spawnSilencedUntilMs = this.scene.time.now + ms;
  }

  /** §15 low-tier device fallback (fps < `perf.lowTierFps` for `perf.lowTierWindowMs`): trash shadows off. */
  setLowTier(on: boolean): void {
    Enemy.lowTier = on;
    for (const enemy of this.enemies) enemy.applyLowTier();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    for (const enemy of this.enemies) enemy.setVelocity(0, 0);
    if (paused) this.player.setVelocity(0, 0);
    if (paused) this.scene.physics.world.pause();
    else this.scene.physics.world.resume();
  }

  // ── read models ────────────────────────────────────────────────────────

  /** E8: every live enemy. */
  liveCount(): number {
    return this.enemies.length;
  }

  /** §6.3 density plumbing: live bodies within `radius` (default 900 px) of the hero. */
  liveNear(radius = 900): number {
    this.hash.queryCircle(this.player.x, this.player.y, radius, this.near);
    const r2 = radius * radius;
    let n = 0;
    for (const e of this.near) if ((e.x - this.player.x) ** 2 + (e.y - this.player.y) ** 2 <= r2) n += 1;
    return n;
  }

  /**
   * §3.9: ambient budget = maxAlive − active POI bodies. Dormant (unwoken)
   * POI bodies count against nothing.
   */
  ambientBudget(): number {
    let poi = 0;
    for (const e of this.enemies) if (e.source !== null && !e.dormant) poi += 1;
    return this.maxAlive - poi;
  }

  private ambientLive(): number {
    let n = 0;
    for (const e of this.enemies) if (e.source === null) n += 1;
    return n;
  }

  /** E8: channel contest census inside a ring. */
  enemiesInRing(x: number, y: number, r: number): ChannelContest {
    const out: ChannelContest = { enemies: 0, elites: 0 };
    this.hash.queryCircle(x, y, r, this.near);
    const r2 = r * r;
    for (const e of this.near) {
      if ((e.x - x) ** 2 + (e.y - y) ** 2 > r2 || e.dormant) continue;
      out.enemies += 1;
      if (e.affix !== null || e.bossKind !== null) out.elites += 1;
    }
    return out;
  }

  /** HUD boss bar model (`HudModelV2.boss`). */
  bossView(): { name: string; hpRatio: number } | null {
    for (const e of this.enemies) if (e.def.rank === 'boss') return { name: e.displayName, hpRatio: e.health.ratio };
    return null;
  }

  /** Off-screen chevrons: elite / mid-boss / boss positions into `out` (cleared); returns count. */
  threats(out: { x: number; y: number; kind: 'elite' | 'boss' }[]): number {
    out.length = 0;
    for (const e of this.enemies) {
      if (e.def.rank === 'boss' || e.def.rank === 'midboss') out.push({ x: e.x, y: e.y, kind: 'boss' });
      else if (e.affix !== null) out.push({ x: e.x, y: e.y, kind: 'elite' });
    }
    return out.length;
  }

  /** Levels gained since the last call (the scene opens drafts off this). */
  takeLevelUps(): number {
    const n = this.levelUps;
    this.levelUps = 0;
    return n;
  }

  /** True once after Last Gasp / Sanctum revive refused a lethal blow. */
  takeRevived(): boolean {
    const r = this.revived;
    this.revived = false;
    return r;
  }

  /** Rally-banner spawn multiplier at the hero (§5.6 Gibbet Herald): 1 + mul inside an active banner. */
  rallyMul(): number {
    const now = this.scene.time.now;
    let mul = 1;
    for (const r of this.rallies) {
      if (now < r.untilMs && (this.player.x - r.x) ** 2 + (this.player.y - r.y) ** 2 <= r.r * r.r) mul = Math.max(mul, 1 + r.mul);
    }
    return mul;
  }

  /** Dirge Bell pickup: every live orb flies home within `ms`. */
  vacuumOrbs(ms: number): void {
    for (const orb of this.orbs) orb.vacuum(ms);
  }

  debugStats(): Readonly<CombatDebugStats> {
    return this.stats;
  }

  // ── spawning ───────────────────────────────────────────────────────────

  /**
   * Ambient spawn on the §3.9 ring (VIEW/2 + `enemy.spawnMargin` around the
   * hero), rejecting nav-blocked cells, out-of-arena points and filtered
   * (gate-suppressed) points. Threat = `difficultyMul × depthMul(depth)`.
   */
  spawn(id: string, difficultyMul: number, pattern: WaveSpec['pattern'] = 'ring'): Enemy | null {
    if (this.scene.time.now < this.spawnSilencedUntilMs) return null;
    if (this.ambientLive() >= this.ambientBudget()) return null;
    // Balance density throttle (critic F1): no ambient spawn while the ring is already at target.
    if (this.liveNear(DENSITY_RADIUS_PX) >= this.densityTargetNow()) return null;
    // Balance round 3: total ambient bodies are capped too, so a stranded ring at 900-1800 px cannot build up.
    if (this.ambientLive() >= this.ambientTotalCap()) return null;
    const def = DEFS[id];
    if (def === undefined) return null;
    if (!this.pickRingPoint(pattern, this.spawnPoint)) return null;
    return this.spawnEnemyAt(def, this.spawnPoint.x, this.spawnPoint.y, difficultyMul * this.depthMul(this.spawnPoint.x, this.spawnPoint.y));
  }

  /**
   * Scripted spawn at a position (events, gate guards, splits, eggs); cap-checked,
   * depth-scaled, and trimmed at the density hard cap when it would land within
   * 900 px of the hero (critic B2).
   */
  spawnAtPosition(id: string, x: number, y: number, difficultyMul: number): Enemy | null {
    if (this.enemies.length >= this.maxAlive) return null;
    const def = DEFS[id];
    if (def === undefined) return null;
    if (def.rank === 'trash' && this.nearHero(x, y) && this.liveNear(DENSITY_RADIUS_PX) >= this.hardCapNow()) return null;
    return this.spawnEnemyAt(def, x, y, difficultyMul * this.depthMul(x, y));
  }

  /** Balance round 3: ceiling on ALL ambient bodies, `densityTarget × wave.ambientTotalMul`. */
  private ambientTotalCap(): number {
    return Math.ceil(this.densityTargetNow() * TUNING.wave.ambientTotalMul);
  }

  /** Balance's hard ceiling on bodies within 900 px: `densityTarget × wave.densityHardCapMul`. */
  private hardCapNow(): number {
    return Math.ceil(this.densityTargetNow() * TUNING.wave.densityHardCapMul);
  }

  private nearHero(x: number, y: number): boolean {
    return (x - this.player.x) ** 2 + (y - this.player.y) ** 2 <= DENSITY_RADIUS_PX * DENSITY_RADIUS_PX;
  }

  /** E8: promote `defId` with one affix (§5.5). */
  spawnElite(defId: string, affix: EliteAffixId, x: number, y: number): Enemy {
    const enemy = this.spawnEnemyAt(this.defOf(defId), x, y, this.difficulty * this.depthMul(x, y), { elite: affix });
    sfx('gate', { volume: 0.7, rate: 0.8 });
    return enemy;
  }

  /** E8: the zone's Warden skin (§5.6). */
  spawnBoss(zone: ZoneId, x: number, y: number): Enemy {
    sfx('collapse', { volume: 0.8, rate: 0.7 });
    return this.spawnEnemyAt(zoneBossDef(zone), x, y, this.difficulty);
  }

  /** E8: the zone's den mid-boss (§5.6). */
  spawnMidBoss(zone: ZoneId, x: number, y: number): Enemy {
    return this.spawnEnemyAt(midBossDef(zone), x, y, this.difficulty * this.depthMul(x, y));
  }

  /**
   * E8/E19: a POI-owned population spread within `spec.radius`. POI bodies do not
   * count against the ambient budget, but awake (non-dormant) trash is trimmed at
   * the density hard cap when it would land within 900 px of the hero (critic B2);
   * dormant lair guards, elites and mid-bosses always seat. Returns the spawned uids.
   */
  spawnPopulation(spec: PoiSpawnSpec): string[] {
    const uids: string[] = [];
    const cap = this.hardCapNow();
    let near = this.liveNear(DENSITY_RADIUS_PX);
    for (const entry of spec.entries) {
      const def = this.defOf(entry.defId);
      const elite = def.rank === 'trash' ? entry.elite ?? null : null;
      const trimmable = spec.dormant !== true && def.rank === 'trash' && elite === null;
      for (let i = 0; i < entry.count; i += 1) {
        const a = this.rng.float(0, Math.PI * 2);
        const d = spec.radius * Math.sqrt(this.rng.float(0, 1));
        let x = spec.x + Math.cos(a) * d;
        let y = spec.y + Math.sin(a) * d;
        if (this.nav !== null && this.nav.isBlockedAt(x, y)) {
          x = spec.x;
          y = spec.y;
        }
        const close = this.nearHero(x, y);
        if (trimmable && close && near >= cap) {
          this.stats.populationTrimmed += 1;
          continue;
        }
        const e = this.spawnEnemyAt(def, x, y, this.difficulty * this.depthMul(x, y), {
          elite,
          source: spec.source,
          dormant: spec.dormant === true,
        });
        // POI bodies leash back to the anchor, not to wherever they were seated.
        e.homeX = spec.x;
        e.homeY = spec.y;
        if (close) near += 1;
        uids.push(e.uid);
      }
    }
    return uids;
  }

  private defOf(id: string): EnemyDef {
    const def = DEFS[id];
    if (def === undefined) throw new Error(`Unknown enemy id "${id}"`);
    return def;
  }

  private depthMul(x: number, y: number): number {
    if (this.map === null) return 1;
    return TUNING.mapgen.depthMul[depthAt(this.map, x, y)] ?? 1;
  }

  /** Spawn ring point (§3.9, shared `spawnRingPoint`). False when every try was rejected. */
  private pickRingPoint(pattern: WaveSpec['pattern'], out: { x: number; y: number }): boolean {
    this.ringPattern = pattern;
    const rejected = spawnRingPoint(this.player.x, this.player.y, VIEW.width, VIEW.height, this.ringAngle, this.ringLegal, out);
    this.stats.spawnRejected += rejected < 0 ? SPAWN_RING_TRIES : rejected;
    return rejected >= 0;
  }

  private ringPattern: WaveSpec['pattern'] = 'ring';
  private readonly ringAngle = (): number => this.spawnAngle(this.ringPattern);
  private readonly ringLegal = (x: number, y: number): boolean => this.spawnable(x, y);

  /** Legal ground for a new body: inside the arena, not nav-blocked, not vetoed. */
  spawnable(x: number, y: number): boolean {
    if (this.arena.isOutside(x, y, -TUNING.arena.wallThickness - 40)) return false;
    if (this.nav !== null && this.nav.isBlockedAt(x, y)) return false;
    return this.spawnFilter === null || this.spawnFilter(x, y);
  }

  private spawnAngle(pattern: WaveSpec['pattern']): number {
    if (pattern === 'arc' || pattern === 'line' || pattern === 'cluster') {
      const now = this.scene.time.now;
      if (this.lastArcAngle === null || now - this.lastArcAngleAt > 1500) this.lastArcAngle = this.rng.float(0, Math.PI * 2);
      this.lastArcAngleAt = now;
      const spread = pattern === 'line' ? 0 : pattern === 'cluster' ? 0.12 : 0.5;
      return this.lastArcAngle + this.rng.float(-spread, spread);
    }
    return this.rng.float(0, Math.PI * 2);
  }

  private spawnEnemyAt(def: EnemyDef, x: number, y: number, difficultyMul: number, opts: { elite?: EliteAffixId | null; source?: string | null; dormant?: boolean } = {}): Enemy {
    const enemy = this.enemyPool.obtain();
    enemy.spawnWith(this, def, x, y, difficultyMul, this.elapsedMs / 1000, opts);
    this.enemies.push(enemy);
    return enemy;
  }

  private createEnemy(): Enemy {
    const enemy = new Enemy(this.scene);
    this.enemyGroup.add(enemy);
    enemy.despawn();
    return enemy;
  }

  // ── frame ──────────────────────────────────────────────────────────────

  /**
   * Unpaused run time (ms) — the clock `trashHpMul` ramps on. Accumulated
   * here because `update` only runs (unpaused) while the run clock runs.
   */
  private elapsedMs = 0;

  update(deltaMs: number, difficultyMul: number): void {
    if (this.dead) return;
    this.difficulty = difficultyMul;
    this.player.tick(this.paused ? 0 : deltaMs);
    if (this.paused) return;
    this.elapsedMs += deltaMs;
    this.syncHero();
    this.tickPin(deltaMs);
    this.rebuildHash();
    this.tickNav(deltaMs);
    this.tickEnemies(deltaMs);
    this.stackPlates();
    this.weapons.update(deltaMs);
    this.tickThralls(deltaMs);
    this.tickShots(deltaMs);
    this.tickHostile(deltaMs);
    this.tickStrikes(deltaMs);
    this.tickRings(deltaMs);
    this.tickBeams(deltaMs);
    this.tickTimedWorld();
    this.tickOrbs(deltaMs);
    this.tickCoins();
    this.tickContactDamage();
    this.tickGroundZones(deltaMs);
    this.tickLeash(deltaMs);
    this.tickStuckStat(deltaMs);
  }

  private syncHero(): void {
    this.hero.x = this.player.x;
    this.hero.y = this.player.y;
    this.hero.vx = this.player.body?.velocity.x ?? 0;
    this.hero.vy = this.player.body?.velocity.y ?? 0;
  }

  /**
   * Critic B3 anti-pin: when the hero has covered less than `PIN_SPEED_RATIO` of
   * the distance its input asked for over `PIN_MS`, fire a breakout — every body
   * within `BREAKOUT_PX` is thrown out to that ring and stunned, slows and drift
   * are cleared, and the hero gets a short grace.
   */
  private tickPin(deltaMs: number): void {
    const moved = Math.hypot(this.player.x - this.lastHeroPos.x, this.player.y - this.lastHeroPos.y);
    this.lastHeroPos.x = this.player.x;
    this.lastHeroPos.y = this.player.y;
    const asked = (this.player.intentSpeed * deltaMs) / 1000;
    if (asked <= 1 || moved >= asked * PIN_SPEED_RATIO) {
      this.pinnedMs = 0;
      return;
    }
    this.pinnedMs += deltaMs;
    if (this.pinnedMs < PIN_MS) return;
    this.pinnedMs = 0;
    this.breakout();
  }

  private breakout(): void {
    const px = this.player.x;
    const py = this.player.y;
    this.hash.queryCircle(px, py, BREAKOUT_PX, this.near);
    for (const e of this.near) {
      if (e.def.rank === 'boss') continue;
      const dx = e.x - px;
      const dy = e.y - py;
      const d = Math.hypot(dx, dy);
      if (d > BREAKOUT_PX) continue;
      const ux = d > 0.01 ? dx / d : Math.cos(e.orbitHeading());
      const uy = d > 0.01 ? dy / d : Math.sin(e.orbitHeading());
      const nx = px + ux * BREAKOUT_PX;
      const ny = py + uy * BREAKOUT_PX;
      if (this.nav === null || !this.nav.isBlockedAt(nx, ny)) {
        e.setPosition(nx, ny);
        e.body?.reset(nx, ny);
      }
      e.freeze(BREAKOUT_STUN_MS);
    }
    this.timedSlowMs = 0;
    this.player.freeFromDrift(1000);
    this.player.health.grantIframes(BREAKOUT_STUN_MS);
    this.stats.breakouts += 1;
    const ring = this.scene.add.image(px, py, TEX.ring).setTint(0x9bdf9f).setDisplaySize(80, 80).setAlpha(0.9).setDepth(19);
    this.scene.tweens.add({ targets: ring, displayWidth: BREAKOUT_PX * 2, displayHeight: BREAKOUT_PX * 2, alpha: 0, duration: 320, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
    sfx('whoosh', { volume: 0.6 });
  }

  private rebuildHash(): void {
    this.hash.clear();
    for (const enemy of this.enemies) this.hash.insert(enemy.x, enemy.y, enemy);
  }

  /** §3.9: flow-field window rebuilt every `nav.rebuildMs` or when the hero changes cell. */
  private tickNav(deltaMs: number): void {
    if (this.nav === null) return;
    this.navSinceMs += deltaMs;
    const cell = this.nav.tileSize;
    const col = Math.floor(this.player.x / cell);
    const row = Math.floor(this.player.y / cell);
    if (col === this.navCol && row === this.navRow && this.navSinceMs < TUNING.nav.rebuildMs) return;
    this.navCol = col;
    this.navRow = row;
    this.navSinceMs = 0;
    const t0 = performance.now();
    this.nav.buildFlowFieldWindow(col, row, TUNING.nav.windowCells / 2);
    this.stats.flowMsMax = Math.max(this.stats.flowMsMax, performance.now() - t0);
    this.stats.flowRebuilds += 1;
  }

  flowDir(x: number, y: number, out: { x: number; y: number }): boolean {
    return this.nav !== null && this.nav.steer(x, y, out);
  }

  private tickEnemies(deltaMs: number): void {
    const px = this.player.x;
    const py = this.player.y;
    for (const enemy of this.enemies) enemy.tickAi(deltaMs, px, py);
    this.separate();
  }

  /**
   * §3.9 boid separation: each body is pushed away from up to
   * `nav.separationNeighbours` neighbours closer than 1.1 × (rA + rB),
   * strength `nav.separation` × its own speed scale.
   */
  private separate(): void {
    const strength = TUNING.nav.separation;
    const cap = TUNING.nav.separationNeighbours;
    for (const a of this.enemies) {
      if (a.dormant || a.def.rank === 'boss') continue;
      const reach = a.bodyRadius * 2.2 + 40;
      this.hash.queryCircle(a.x, a.y, reach, this.sepNear);
      let px = 0;
      let py = 0;
      let n = 0;
      for (const b of this.sepNear) {
        if (b === a) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const thr = 1.1 * (a.bodyRadius + b.bodyRadius);
        const d2 = dx * dx + dy * dy;
        if (d2 >= thr * thr) continue;
        const d = Math.sqrt(d2) || 0.01;
        const w = 1 - d / thr;
        px += (dx / d) * w;
        py += (dy / d) * w;
        n += 1;
        if (n >= cap) break;
      }
      if (n === 0) continue;
      const body = a.body as Phaser.Physics.Arcade.Body | null;
      if (body === null) continue;
      const push = strength * Math.max(60, a.def.stats.moveSpeed);
      body.velocity.x += px * push;
      body.velocity.y += py * push;
    }
  }

  /**
   * §3.9 leash + Balance density rule (critic F1): an ambient trash body
   * > `enemy.leashPx` from the hero and off-screen for `enemy.leashMs` is
   * re-seated on the spawn ring while `liveNear(900)` is under the density
   * target, else despawned silently (no kill, no drops, no stats) — a re-seat
   * never pushes the near count over the target.
   */
  private tickLeash(deltaMs: number): void {
    this.leashClockMs += deltaMs;
    if (this.leashClockMs < LEASH_TICK_MS) return;
    const step = this.leashClockMs;
    this.leashClockMs = 0;
    const view = this.scene.cameras.main.worldView;
    const leash2 = TUNING.enemy.leashPx * TUNING.enemy.leashPx;
    const target = this.densityTargetNow();
    let near = this.liveNear(DENSITY_RADIUS_PX);
    let ambient = this.ambientLive();
    const totalCap = this.ambientTotalCap();
    let within = 0;
    let poi = 0;
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const e = this.enemies[i];
      if (e === undefined) continue;
      if (e.source !== null) poi += 1;
      const d2 = (e.x - this.player.x) ** 2 + (e.y - this.player.y) ** 2;
      if (e.source !== null && e.def.rank === 'trash' && !e.dormant && this.leashPoiHome(e, i, step, view, near, target)) {
        // Returned home (dormant again) or despawned: either way it no longer presses the hero.
        if (d2 <= DENSITY_RADIUS_PX * DENSITY_RADIUS_PX) near -= 1;
        continue;
      }
      if (e.source !== null || e.def.rank !== 'trash' || e.affix !== null) {
        if (d2 <= leash2) within += 1;
        continue;
      }
      if (d2 > leash2 && !view.contains(e.x, e.y)) e.offscreenMs += step;
      else e.offscreenMs = 0;
      if (e.offscreenMs < TUNING.enemy.leashMs) {
        if (d2 <= leash2) within += 1;
        continue;
      }
      e.offscreenMs = 0;
      if (near < target && ambient <= totalCap && this.pickRingPoint('ring', this.spawnPoint)) {
        e.setPosition(this.spawnPoint.x, this.spawnPoint.y);
        e.body?.reset(this.spawnPoint.x, this.spawnPoint.y);
        e.stuckMs = 0;
        near += 1;
        within += 1;
        this.stats.leashReseats += 1;
        continue;
      }
      this.bossAdds.delete(e);
      this.enemyPool.release(e);
      this.swapRemove(this.enemies, i);
      this.stats.leashDespawns += 1;
      ambient -= 1;
    }
    this.stats.live = this.enemies.length;
    this.stats.poiLive = poi;
    this.stats.near900 = near;
    this.stats.densityTarget = target;
    this.stats.withinLeashPct = this.enemies.length === 0 ? 100 : Math.round((within / this.enemies.length) * 100);
    this.capNearElites();
  }

  /**
   * Critic B2: an awake POI/event body whose hero is > `POI_LEASH_PX` from its
   * anchor, and which has been off-screen for `enemy.leashMs`, stops chasing:
   * over the density target it despawns silently, otherwise it walks home as a
   * dormant guard again (re-wakes at `poi.lair.wakePx`). True when it was handled.
   */
  private leashPoiHome(e: Enemy, index: number, step: number, view: Phaser.Geom.Rectangle, near: number, target: number): boolean {
    const heroFromHome = Math.hypot(this.player.x - e.homeX, this.player.y - e.homeY);
    if (heroFromHome <= POI_LEASH_PX || view.contains(e.x, e.y)) {
      e.offscreenMs = 0;
      return false;
    }
    e.offscreenMs += step;
    if (e.offscreenMs < TUNING.enemy.leashMs) return false;
    e.offscreenMs = 0;
    const homeBlocked = this.nav !== null && this.nav.isBlockedAt(e.homeX, e.homeY);
    // Elites never despawn silently (they carry the Elite Chest); they always go home.
    if ((near > target && e.affix === null) || homeBlocked) {
      this.enemyPool.release(e);
      this.swapRemove(this.enemies, index);
      this.stats.leashDespawns += 1;
      return true;
    }
    e.setPosition(e.homeX, e.homeY);
    e.body?.reset(e.homeX, e.homeY);
    e.setVelocity(0, 0);
    e.dormant = true;
    e.stuckMs = 0;
    this.stats.poiReturns += 1;
    return true;
  }

  /**
   * Critic B3: at most `wave.eliteNearCap` affixed elites within `wave.eliteNearPx`
   * of the hero engage; the rest hold an orbit farther out. Only the engaged ones
   * show plate + HP bar, stacked when their plates would overlap on screen.
   */
  private capNearElites(): void {
    const near = this.eliteScratch;
    near.length = 0;
    const r2 = (TUNING.wave.eliteNearPx + HOLD_RELEASE_PX) ** 2;
    for (const e of this.enemies) {
      if (!e.isElite) continue;
      e.plateSlot = -1;
      e.plateLift = 0;
      if ((e.x - this.player.x) ** 2 + (e.y - this.player.y) ** 2 <= r2) near.push(e);
      else e.holdOff = false;
    }
    near.sort((a, b) => ((a.x - this.player.x) ** 2 + (a.y - this.player.y) ** 2) - ((b.x - this.player.x) ** 2 + (b.y - this.player.y) ** 2));
    const cap = TUNING.wave.eliteNearCap;
    for (let k = 0; k < near.length; k += 1) {
      const e = near[k]!;
      e.holdOff = k >= cap;
      if (k >= cap) continue;
      e.plateSlot = k;
    }
    // Elites far from the hero keep their plate (nothing to collide with on screen).
    for (const e of this.enemies) if (e.isElite && !near.includes(e)) e.plateSlot = 0;
    near.length = Math.min(near.length, cap);
    this.stats.elitesNear = near.length;
    // QA N3: the mid-boss plate stacks with the engaged elites' plates (it is never held off).
    const plated = this.platedScratch;
    plated.length = 0;
    for (const e of this.enemies) if (e.def.rank === 'midboss' && (e.x - this.player.x) ** 2 + (e.y - this.player.y) ** 2 <= r2) plated.push(e);
    plated.push(...near);
  }

  /**
   * Per frame: the engaged elites' plate blocks (name + icon + HP bar) stack
   * instead of overlapping — a later block that would collide with an earlier
   * one is lifted to sit fully above it (critic B3 "plates stack illegibly").
   */
  private stackPlates(): void {
    const engaged = this.platedScratch;
    for (let k = 0; k < engaged.length; k += 1) {
      const e = engaged[k]!;
      e.plateLift = 0;
      if (!e.active || e.plateSlot < 0) continue;
      for (let j = 0; j < k; j += 1) {
        const prev = engaged[j]!;
        if (!prev.active || prev.plateSlot < 0 || Math.abs(prev.x - e.x) >= PLATE_W) continue;
        const prevTop = prev.y - prev.visiblePx / 2 - prev.plateLift;
        const top = e.y - e.visiblePx / 2 - e.plateLift;
        if (Math.abs(prevTop - top) < PLATE_STACK_PX) e.plateLift += top - (prevTop - PLATE_STACK_PX);
      }
    }
  }

  /** Balance's §6.3 live-near target for the current run second (FTUE-scaled). */
  private densityTargetNow(): number {
    return densityTarget(this.elapsedMs / 1000, this.ftue) * this.densityMul;
  }

  /** `stuckEnemies` = bodies pinned against a blocker for > 3 s; p95 over 1 s samples. */
  private tickStuckStat(deltaMs: number): void {
    this.stuckClockMs += deltaMs;
    if (this.stuckClockMs < 1000) return;
    this.stuckClockMs = 0;
    let stuck = 0;
    for (const e of this.enemies) if (e.stuckMs > 3000 && this.againstBlocker(e)) stuck += 1;
    this.stats.stuckEnemies = stuck;
    this.stuckHistory.push(stuck);
    if (this.stuckHistory.length > STUCK_HISTORY) this.stuckHistory.shift();
    const sorted = [...this.stuckHistory].sort((a, b) => a - b);
    this.stats.stuckP95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  }

  /**
   * §19 `stuckEnemies` is about BLOCKERS, not crowds: a body jammed in the
   * horde around a standing hero is waiting its turn. Probes one body radius
   * + half a nav cell ahead and to both sides of its heading.
   */
  private againstBlocker(e: Enemy): boolean {
    if (this.nav === null) return false;
    const reach = e.bodyRadius + this.nav.tileSize / 2;
    for (const off of STUCK_PROBE_OFFSETS) {
      const a = e.facing + off;
      if (this.nav.isBlockedAt(e.x + Math.cos(a) * reach, e.y + Math.sin(a) * reach)) return true;
    }
    return false;
  }

  // ── WeaponHost (§16.1 E11) ─────────────────────────────────────────────

  nearestEnemy(x: number, y: number, radius: number): Enemy | null {
    this.hash.queryCircle(x, y, radius, this.near);
    let best: Enemy | null = null;
    let bestDist = radius * radius;
    for (const enemy of this.near) {
      if (enemy.dormant && enemy.source !== null && enemy.immune) continue;
      const d2 = (enemy.x - x) ** 2 + (enemy.y - y) ** 2;
      if (d2 <= bestDist) {
        bestDist = d2;
        best = enemy;
      }
    }
    return best;
  }

  enemiesInRadius(x: number, y: number, r: number, out: Enemy[]): number {
    this.hash.queryCircle(x, y, r, out);
    return out.length;
  }

  densestPoint(x: number, y: number, r: number, out: { x: number; y: number }): boolean {
    let best: Enemy | null = null;
    let bestCount = -1;
    const scan = Math.max(VIEW.height * 0.6, r * 4);
    this.hash.queryCircle(x, y, scan, this.sepNear);
    for (const enemy of this.sepNear) {
      this.hash.queryCircle(enemy.x, enemy.y, r, this.near);
      if (this.near.length > bestCount) {
        bestCount = this.near.length;
        best = enemy;
      }
    }
    if (best === null) return false;
    out.x = best.x;
    out.y = best.y;
    return true;
  }

  damageEnemy(e: Enemy, amount: number, crit: boolean, source: WeaponId): void {
    this.hitEnemy(e, amount, crit, source, this.player.x, this.player.y);
  }

  hitBreakables(x: number, y: number, r: number): void {
    if (this.breakables === null) return;
    if (this.breakables.hitCircle(x, y, r) > 0) this.callbacks.onBreakableHit(x, y, r);
  }

  fireShot(x: number, y: number, vx: number, vy: number, damage: number, crit: boolean, area: number, pierce?: number): void {
    const shot = this.shotPool.obtain();
    shot.fire(x, y, vx, vy, damage, crit, false, area, pierce);
    this.shots.push(shot);
  }

  onPlayerAttack(_x: number, _y: number): void {
    // Volley voice plays in `WeaponSystem.update` (data/audio.ts WEAPON_VOICE).
  }

  // ── Arsenal 20 host hooks (§5.8b.1) ────────────────────────────────────

  /** Ossuary Disc reflect / Rattle Urn hops: nav-blocked or outside the arena. */
  isBlocked(x: number, y: number): boolean {
    if (this.arena.isOutside(x, y, 0)) return true;
    return this.nav !== null && this.nav.isBlockedAt(x, y);
  }

  /** Marrow Siphon: heals the hero; returns hp actually restored (caps are the caller's). */
  healPlayer(amount: number, _source: WeaponId): number {
    const health = this.player.health;
    if (amount <= 0 || health.hp <= 0) return 0;
    const before = health.hp;
    health.heal(amount);
    return health.hp - before;
  }

  /** Husk Thralls: false at the 4-alive cap or when no free ground is near the hero. */
  spawnThrall(spec: ThrallSpec): boolean {
    if (this.thralls.length >= MAX_THRALLS) return false;
    const angle = (this.thralls.length / MAX_THRALLS) * Math.PI * 2 + this.rng.float(-0.4, 0.4);
    let x = this.player.x;
    let y = this.player.y;
    for (let k = 0; k < 6; k += 1) {
      const a = angle + k * 1.05;
      const cx = this.player.x + Math.cos(a) * THRALL_SUMMON_PX;
      const cy = this.player.y + Math.sin(a) * THRALL_SUMMON_PX;
      if (this.isBlocked(cx, cy)) continue;
      x = cx;
      y = cy;
      break;
    }
    let t = this.thrallPool.pop();
    if (t === undefined) {
      t = new Thrall(this.scene);
      this.thrallGroup.add(t);
    }
    t.summon(spec, x, y, angle);
    this.thralls.push(t);
    return true;
  }

  thrallCount(): number {
    return this.thralls.length;
  }

  clearThralls(): void {
    for (const t of this.thralls) {
      t.park();
      this.thrallPool.push(t);
    }
    this.thralls.length = 0;
  }

  /** ThrallHost: a bite is a weapon hit sourced at the thrall (frontal shields face it). */
  biteEnemy(e: Enemy, amount: number, fromX: number, fromY: number): void {
    this.hitEnemy(e, amount, false, 'thralls', fromX, fromY);
  }

  private tickThralls(deltaMs: number): void {
    for (let i = this.thralls.length - 1; i >= 0; i -= 1) {
      const t = this.thralls[i]!;
      if (t.tick(deltaMs, this, this.player.x, this.player.y)) continue;
      const { x, y } = t;
      const onDeath = t.spec.onDeath;
      t.park();
      this.thrallPool.push(t);
      this.swapRemove(this.thralls, i);
      onDeath?.(x, y);
    }
  }

  // ── E8 area verbs (belt, POIs) ─────────────────────────────────────────

  /** Damages every enemy within `r`; returns how many were hit. */
  damageArea(x: number, y: number, r: number, dmg: number, source: string): number {
    this.hash.queryCircle(x, y, r, this.sepNear);
    const r2 = r * r;
    let n = 0;
    const hits = this.sepNear.filter((e) => (e.x - x) ** 2 + (e.y - y) ** 2 <= r2);
    for (const e of hits) {
      if (!e.active || !e.isElite || e.plateSlot < 0) continue;
      this.hitEnemy(e, dmg, false, source, x, y);
      n += 1;
    }
    return n;
  }

  freezeArea(x: number, y: number, r: number, ms: number): void {
    this.hash.queryCircle(x, y, r, this.near);
    const r2 = r * r;
    for (const e of this.near) if ((e.x - x) ** 2 + (e.y - y) ** 2 <= r2) e.freeze(ms);
  }

  /** Pulls the hero `px` toward (x, y) over a short forced move. */
  pullPlayer(x: number, y: number, px: number): void {
    const dx = x - this.player.x;
    const dy = y - this.player.y;
    const d = Math.hypot(dx, dy) || 1;
    const move = Math.min(px, d);
    this.player.shove((dx / d) * move, (dy / d) * move, PULL_MS);
  }

  // ── EnemyHost ──────────────────────────────────────────────────────────

  shoot(from: Enemy, angle: number, speed: number, sizePx: number, damage: number): void {
    if (this.hostile.length >= MAX_SHOTS) return;
    let s = this.hostileFree.pop();
    if (s === undefined) {
      const img = this.scene.add.image(0, 0, ACTOR_FX.enemyShot).setDepth(14);
      const ghosts = [0.45, 0.28, 0.14].map((a) => this.scene.add.image(0, 0, ACTOR_FX.enemyShot).setDepth(13).setAlpha(a));
      s = { img, ghosts, x: 0, y: 0, vx: 0, vy: 0, radius: 0, damage: 0, lifeMs: 0, source: '', owner: null, ownerUid: '' };
    }
    const size = Math.max(18, sizePx) + 4;
    s.x = from.x;
    s.y = from.y;
    s.vx = Math.cos(angle) * speed;
    s.vy = Math.sin(angle) * speed;
    s.radius = size / 2;
    s.damage = from.damageCap !== null ? Math.min(damage, from.damageCap) : damage;
    s.ownerUid = from.uid;
    s.lifeMs = SHOT_LIFE_MS;
    s.source = from.displayName;
    s.owner = from;
    s.img.setPosition(s.x, s.y).setDisplaySize(size, size).setVisible(true);
    for (const g of s.ghosts) g.setPosition(s.x, s.y).setDisplaySize(size * 0.85, size * 0.85).setVisible(true);
    this.hostile.push(s);
  }

  strike(spec: StrikeSpec): void {
    const gfx = this.gfxFree.pop() ?? this.scene.add.graphics();
    gfx.setDepth(7).setVisible(true).setAlpha(1);
    // §13.2 + Main round 3: every damaging strike is visible for at least TELEGRAPH_MIN_MS before it lands.
    const leftMs = spec.damage > 0 ? Math.max(TELEGRAPH_MIN_MS, spec.telegraphMs) : spec.telegraphMs;
    const s: Strike = { spec, gfx, leftMs, lethalDrawn: false };
    this.drawStrike(s, false);
    this.strikes.push(s);
  }

  groundZone(x: number, y: number, r: number, slowPct: number, lifeMs: number, tint: number, dps: number, source: string): void {
    if (this.zones.length >= MAX_ZONES) this.zones.shift()?.img.destroy();
    const img = this.scene.add.image(x, y, TEX.disc).setTint(tint).setDisplaySize(r * 2, r * 2).setAlpha(dps > 0 ? 0.3 : 0.24).setDepth(5);
    this.zones.push({ img, x, y, radius: r, slowPct, dps, untilMs: this.scene.time.now + lifeMs, source });
  }

  auraPulse(source: Enemy): void {
    const radius = source.def.params?.auraRadiusPx ?? TUNING.enemy.healAuraRadius;
    const speedMul = source.def.params?.auraSpeedMul ?? 0;
    this.hash.queryCircle(source.x, source.y, radius, this.near);
    let touched = false;
    for (const ally of this.near) {
      if (ally === source || speedMul <= 0) continue;
      ally.applyHaste(speedMul);
      touched = true;
    }
    if (!touched) return;
    const ring = this.scene.add.image(source.x, source.y, TEX.ring).setTint(source.def.tint).setDisplaySize(radius * 0.5, radius * 0.5).setAlpha(0.55).setDepth(7);
    this.scene.tweens.add({ targets: ring, displayWidth: radius * 2, displayHeight: radius * 2, alpha: 0, duration: 480, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
  }

  summon(from: Enemy, defId: string, count: number, radius: number): void {
    const def = this.defOf(defId);
    for (let i = 0; i < count; i += 1) {
      if (this.enemies.length >= this.maxAlive + 20) break;
      const a = this.rng.float(0, Math.PI * 2);
      const x = from.x + Math.cos(a) * radius;
      const y = from.y + Math.sin(a) * radius;
      const e = this.spawnEnemyAt(def, x, y, this.difficulty, { source: from.source });
      if (from.def.rank === 'boss') this.bossAdds.add(e);
    }
    burst(this.scene, from.x, from.y, from.def.tint, 14, radius);
  }

  slowHero(pct: number, ms: number): void {
    if (pct >= this.timedSlowPct || this.timedSlowMs <= 0) this.timedSlowPct = pct;
    this.timedSlowMs = Math.max(this.timedSlowMs, ms);
  }

  driftHero(vx: number, vy: number): void {
    this.player.drift(vx, vy);
  }

  tollRings(x: number, y: number, count: number, from: number, to: number, speed: number, damage: number, source: string): void {
    for (let i = 0; i < count; i += 1) {
      const gfx = this.gfxFree.pop() ?? this.scene.add.graphics();
      gfx.setDepth(7).setVisible(true).setAlpha(1);
      // Concentric: each ring starts one band behind the previous.
      this.rings.push({ gfx, x, y, r: from - i * 110, to, speed, damage, hit: false, source });
    }
    sfx('collapse', { volume: 0.5 });
  }

  beam(owner: Enemy, startAngle: number, degPerS: number, length: number, durationMs: number, damage: number, tickMs: number): void {
    const gfx = this.gfxFree.pop() ?? this.scene.add.graphics();
    gfx.setDepth(15).setVisible(true).setAlpha(1);
    this.beams.push({ owner, gfx, angle: startAngle, radPerMs: (degPerS * Math.PI) / 180 / 1000, length, leftMs: durationMs, damage, tickMs, nextTickMs: 0 });
  }

  walls(points: readonly { x: number; y: number }[], radius: number, lifeMs: number, texture: string): void {
    const imgs: Phaser.GameObjects.Image[] = [];
    for (const p of points) {
      if (this.arena.isOutside(p.x, p.y, -radius)) continue;
      const key = this.scene.textures.exists(texture) ? texture : TEX.disc;
      const img = this.scene.add.image(p.x, p.y, key, 0).setDisplaySize(radius * 2.4, radius * 2.4).setDepth(11);
      if (key === TEX.disc) img.setTint(0x8a7a5a);
      this.scene.physics.add.existing(img, true);
      const body = img.body as Phaser.Physics.Arcade.StaticBody;
      body.position.set(p.x - radius, p.y - radius);
      body.setCircle(radius);
      this.wallGroup.add(img);
      imgs.push(img);
    }
    this.wallList.push({ imgs, untilMs: this.scene.time.now + lifeMs });
  }

  rally(x: number, y: number, r: number, mul: number, ms: number): void {
    const img = this.scene.add.image(x, y, this.scene.textures.exists('poi-lair-banner') ? 'poi-lair-banner' : TEX.ring).setDisplaySize(96, 96).setDepth(9);
    this.rallies.push({ x, y, r, mul, untilMs: this.scene.time.now + ms, img });
    floatText(this.scene, x, y - 80, 'RALLY', '#ff6b6b', 34);
  }

  eggs(x: number, y: number, count: number, hatch: number, defId: string, ms: number): void {
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2 + this.rng.float(-0.3, 0.3);
      const img = this.scene.add.image(x + Math.cos(a) * 120, y + Math.sin(a) * 120, TEX.disc).setTint(0xe8c547).setDisplaySize(36, 44).setDepth(9);
      this.scene.tweens.add({ targets: img, alpha: 0.5, duration: 250, yoyo: true, repeat: -1 });
      this.eggList.push({ img, hatch, defId, atMs: this.scene.time.now + ms });
    }
  }

  // ── hazards tick ───────────────────────────────────────────────────────

  private drawStrike(s: Strike, lethal: boolean): void {
    const { spec, gfx } = s;
    gfx.clear();
    gfx.fillStyle(TELEGRAPH.fill, 0.25);
    gfx.lineStyle(3, lethal ? TELEGRAPH.lethal : TELEGRAPH.fill, 0.95);
    if (spec.shape === 'circle') {
      gfx.fillCircle(spec.x, spec.y, spec.r);
      gfx.strokeCircle(spec.x, spec.y, spec.r);
    } else if (spec.shape === 'arc') {
      const half = ((spec.arcDeg ?? 90) * Math.PI) / 360;
      const a = spec.angle ?? 0;
      gfx.beginPath();
      gfx.moveTo(spec.x, spec.y);
      gfx.arc(spec.x, spec.y, spec.r, a - half, a + half, false);
      gfx.closePath();
      gfx.fillPath();
      gfx.strokePath();
    } else {
      const a = spec.angle ?? 0;
      const w = spec.width ?? 20;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const ex = spec.x + cos * spec.r;
      const ey = spec.y + sin * spec.r;
      const nx = -sin * w;
      const ny = cos * w;
      // Hook lines read red for their whole telegraph (§5.4 "red line telegraph").
      if (spec.pullPx !== undefined) gfx.lineStyle(3, TELEGRAPH.lethal, 0.95);
      gfx.beginPath();
      gfx.moveTo(spec.x + nx, spec.y + ny);
      gfx.lineTo(ex + nx, ey + ny);
      gfx.lineTo(ex - nx, ey - ny);
      gfx.lineTo(spec.x - nx, spec.y - ny);
      gfx.closePath();
      gfx.fillPath();
      gfx.strokePath();
    }
  }

  private heroInStrike(spec: StrikeSpec): boolean {
    const hx = this.player.x;
    const hy = this.player.y;
    const hr = TUNING.player.bodyRadius;
    const dx = hx - spec.x;
    const dy = hy - spec.y;
    const d = Math.hypot(dx, dy);
    if (spec.shape === 'circle') return d <= spec.r + hr;
    if (spec.shape === 'arc') {
      if (d > spec.r + hr) return false;
      let diff = Math.abs(Math.atan2(dy, dx) - (spec.angle ?? 0)) % (Math.PI * 2);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      return diff <= ((spec.arcDeg ?? 90) * Math.PI) / 360;
    }
    const a = spec.angle ?? 0;
    const along = dx * Math.cos(a) + dy * Math.sin(a);
    const across = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
    return along >= -hr && along <= spec.r + hr && across <= (spec.width ?? 20) + hr;
  }

  private tickStrikes(deltaMs: number): void {
    for (let i = this.strikes.length - 1; i >= 0; i -= 1) {
      const s = this.strikes[i];
      if (s === undefined) continue;
      s.leftMs -= deltaMs;
      if (!s.lethalDrawn && s.leftMs <= LETHAL_EDGE_MS && s.spec.damage > 0) {
        s.lethalDrawn = true;
        this.drawStrike(s, true);
      }
      if (s.leftMs > 0) continue;
      const spec = s.spec;
      if (this.heroInStrike(spec)) {
        if (spec.damage > 0) this.damagePlayer(spec.damage, spec.source, spec.owner !== undefined && spec.owner.active && spec.owner.uid === spec.ownerUid ? spec.owner : null);
        if (spec.slowPct !== undefined && spec.slowMs !== undefined) this.slowHero(spec.slowPct, spec.slowMs);
        if (spec.pullPx !== undefined) this.pullPlayer(spec.x, spec.y, spec.pullPx);
      }
      if (spec.fx !== undefined) playFx(this.scene, spec.fx, spec.x, spec.y, Math.max(96, spec.shape === 'line' ? 128 : spec.r * 2), 12, false);
      else if (spec.damage > 0 && this.enemies.length <= TUNING.caps.burstEntityLimit) burst(this.scene, spec.x, spec.y, TELEGRAPH.lethal, 8, spec.shape === 'line' ? 160 : spec.r);
      s.gfx.clear().setVisible(false);
      this.gfxFree.push(s.gfx);
      this.strikes.splice(i, 1);
      spec.onFire?.();
    }
  }

  private tickRings(deltaMs: number): void {
    const hr = TUNING.player.bodyRadius;
    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      const ring = this.rings[i];
      if (ring === undefined) continue;
      ring.r += (ring.speed * deltaMs) / 1000;
      ring.gfx.clear();
      if (ring.r > 0) {
        ring.gfx.lineStyle(10, TELEGRAPH.lethal, 0.75);
        ring.gfx.strokeCircle(ring.x, ring.y, ring.r);
        const d = Math.hypot(this.player.x - ring.x, this.player.y - ring.y);
        if (!ring.hit && Math.abs(d - ring.r) <= hr) {
          ring.hit = true;
          this.damagePlayer(ring.damage, ring.source, null);
        }
      }
      if (ring.r < ring.to) continue;
      ring.gfx.clear().setVisible(false);
      this.gfxFree.push(ring.gfx);
      this.rings.splice(i, 1);
    }
  }

  private tickBeams(deltaMs: number): void {
    for (let i = this.beams.length - 1; i >= 0; i -= 1) {
      const b = this.beams[i];
      if (b === undefined) continue;
      b.leftMs -= deltaMs;
      b.angle += b.radPerMs * deltaMs;
      b.nextTickMs -= deltaMs;
      const ox = b.owner.x;
      const oy = b.owner.y;
      const ex = ox + Math.cos(b.angle) * b.length;
      const ey = oy + Math.sin(b.angle) * b.length;
      b.gfx.clear();
      b.gfx.lineStyle(26, 0xff7a3d, 0.55);
      b.gfx.lineBetween(ox, oy, ex, ey);
      b.gfx.lineStyle(10, 0xffe0a0, 0.9);
      b.gfx.lineBetween(ox, oy, ex, ey);
      if (b.nextTickMs <= 0) {
        b.nextTickMs = b.tickMs;
        const spec: StrikeSpec = { shape: 'line', x: ox, y: oy, r: b.length, angle: b.angle, width: 16, telegraphMs: 0, damage: b.damage, source: b.owner.displayName };
        if (this.heroInStrike(spec)) this.damagePlayer(b.damage, spec.source, null);
      }
      if (b.leftMs > 0 && b.owner.active) continue;
      b.gfx.clear().setVisible(false);
      this.gfxFree.push(b.gfx);
      this.beams.splice(i, 1);
    }
  }

  private tickTimedWorld(): void {
    const now = this.scene.time.now;
    for (let i = this.wallList.length - 1; i >= 0; i -= 1) {
      const w = this.wallList[i];
      if (w === undefined || now < w.untilMs) continue;
      for (const img of w.imgs) {
        this.wallGroup.remove(img, true, true);
      }
      this.wallList.splice(i, 1);
    }
    for (let i = this.rallies.length - 1; i >= 0; i -= 1) {
      const r = this.rallies[i];
      if (r === undefined || now < r.untilMs) continue;
      r.img.destroy();
      this.rallies.splice(i, 1);
    }
    for (let i = this.eggList.length - 1; i >= 0; i -= 1) {
      const egg = this.eggList[i];
      if (egg === undefined || now < egg.atMs) continue;
      for (let k = 0; k < egg.hatch; k += 1) this.spawnAtPosition(egg.defId, egg.img.x + this.rng.float(-24, 24), egg.img.y + this.rng.float(-24, 24), this.difficulty);
      this.scene.tweens.killTweensOf(egg.img);
      egg.img.destroy();
      this.eggList.splice(i, 1);
    }
  }

  private tickHostile(deltaMs: number): void {
    const hr = TUNING.player.bodyRadius;
    const dt = deltaMs / 1000;
    for (let i = this.hostile.length - 1; i >= 0; i -= 1) {
      const s = this.hostile[i];
      if (s === undefined) continue;
      s.lifeMs -= deltaMs;
      // 3-ghost trail: each ghost eases toward the one ahead.
      let lx = s.x;
      let ly = s.y;
      for (const g of s.ghosts) {
        g.setPosition(g.x + (lx - g.x) * 0.5, g.y + (ly - g.y) * 0.5);
        lx = g.x;
        ly = g.y;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.img.setPosition(s.x, s.y);
      let done = s.lifeMs <= 0 || this.arena.isOutside(s.x, s.y, 0);
      if (!done && (s.x - this.player.x) ** 2 + (s.y - this.player.y) ** 2 <= (s.radius + hr) ** 2) {
        this.damagePlayer(s.damage, s.source, s.owner !== null && s.owner.active && s.owner.uid === s.ownerUid ? s.owner : null);
        done = true;
      }
      if (!done) continue;
      s.img.setVisible(false);
      for (const g of s.ghosts) g.setVisible(false);
      this.hostile.splice(i, 1);
      this.hostileFree.push(s);
    }
  }

  private tickGroundZones(deltaMs: number): void {
    const now = this.scene.time.now;
    let worst = 0;
    for (let i = this.zones.length - 1; i >= 0; i -= 1) {
      const zone = this.zones[i];
      if (zone === undefined) continue;
      if (now >= zone.untilMs) {
        zone.img.destroy();
        this.zones.splice(i, 1);
        continue;
      }
      const inside = (this.player.x - zone.x) ** 2 + (this.player.y - zone.y) ** 2 <= zone.radius * zone.radius;
      if (!inside) continue;
      if (zone.slowPct > worst) worst = zone.slowPct;
      if (zone.dps > 0) this.drainPlayer((zone.dps * deltaMs) / 1000, zone.source);
    }
    if (this.timedSlowMs > 0) {
      this.timedSlowMs -= deltaMs;
      worst = Math.max(worst, this.timedSlowPct);
    }
    if (worst === this.slowPct) return;
    this.slowPct = worst;
    this.player.stats.removeBySource(SLOW_SOURCE);
    if (worst > 0) this.player.applyModifier({ stat: 'moveSpeed', mul: -worst / 100, source: SLOW_SOURCE });
  }

  private tickShots(deltaMs: number): void {
    for (let i = this.shots.length - 1; i >= 0; i -= 1) {
      const shot = this.shots[i];
      if (shot === undefined) continue;
      shot.lifeMs -= deltaMs;
      let done = shot.lifeMs <= 0 || this.arena.isOutside(shot.x, shot.y, TUNING.enemy.spawnMargin);
      if (!done) {
        // Hero shots break urns/coffins/crates they pass through (Loot: bolt-only builds broke none).
        this.hitBreakables(shot.x, shot.y, shot.hitRadius);
        const hit = this.nearestUnhitEnemy(shot);
        if (hit !== null) {
          this.hitEnemy(hit, shot.damage, shot.crit, 'bolt', shot.x, shot.y);
          shot.hitTargets.add(hit);
          if (shot.pierceRemaining > 0) shot.pierceRemaining -= 1;
          else done = true;
        }
      }
      if (done) {
        this.shotPool.release(shot);
        this.swapRemove(this.shots, i);
      }
    }
  }

  private nearestUnhitEnemy(shot: Projectile): Enemy | null {
    this.hash.queryCircle(shot.x, shot.y, shot.hitRadius + 100, this.near);
    let best: Enemy | null = null;
    let bestDist = Infinity;
    for (const enemy of this.near) {
      if (shot.hitTargets.has(enemy)) continue;
      const reach = shot.hitRadius + enemy.bodyRadius;
      const d2 = (enemy.x - shot.x) ** 2 + (enemy.y - shot.y) ** 2;
      if (d2 <= reach * reach && d2 < bestDist) {
        bestDist = d2;
        best = enemy;
      }
    }
    return best;
  }

  private tickOrbs(deltaMs: number): void {
    this.orbClockMs += deltaMs;
    if (this.orbClockMs >= ORB_MERGE_MS) {
      this.orbClockMs = 0;
      mergeXpOrbs(this.orbs, (o) => this.orbPool.release(o));
    }
    const radius = this.player.stats.get('pickupRadius');
    for (let i = this.orbs.length - 1; i >= 0; i -= 1) {
      const orb = this.orbs[i];
      if (orb === undefined) continue;
      if (!orb.tickMagnet(this.player.x, this.player.y, radius)) continue;
      this.levelUps += this.player.addXp(orb.value);
      this.callbacks.onPickup('xp', orb.value);
      this.orbPool.release(orb);
      this.swapRemove(this.orbs, i);
    }
  }

  private tickCoins(): void {
    const radius = this.player.stats.get('pickupRadius');
    for (let i = this.coins.length - 1; i >= 0; i -= 1) {
      const coin = this.coins[i];
      if (coin === undefined) continue;
      if (!coin.tickMagnet(this.player.x, this.player.y, radius)) continue;
      this.callbacks.onPickup('coin', coin.value);
      this.coinPool.release(coin);
      this.swapRemove(this.coins, i);
    }
  }

  /** §5.4 contact: reach = enemy bodyRadius + hero bodyRadius; Gloam Step may eat the hit. */
  private tickContactDamage(): void {
    const now = this.scene.time.now;
    this.hash.queryCircle(this.player.x, this.player.y, TUNING.boss.visiblePx * 0.36 + TUNING.player.bodyRadius, this.near);
    for (const enemy of this.near) {
      if (enemy.dormant || enemy.contactDamage() <= 0 || enemy.immune) continue;
      const dx = enemy.x - this.player.x;
      const dy = enemy.y - this.player.y;
      if (dx * dx + dy * dy > enemy.contactReach * enemy.contactReach) continue;
      if (now - enemy.lastContactAt < TUNING.enemy.hitMs) continue;
      enemy.lastContactAt = now;
      if (this.weapons.onPlayerContact(enemy.x, enemy.y)) continue;
      this.damagePlayer(enemy.contactDamage(), enemy.displayName, enemy, true);
      this.knockback(enemy, dx, dy);
      if (this.dead) return;
    }
  }

  private knockback(enemy: Enemy, dx: number, dy: number): void {
    const dist = Math.hypot(dx, dy) || 1;
    const impulse = TUNING.player.contactKnockback * this.player.knockbackMul;
    enemy.setVelocity((dx / dist) * impulse, (dy / dist) * impulse);
  }

  // ── damage ─────────────────────────────────────────────────────────────

  /** Every blow to the hero: × `contactDamageMul` stat, i-frames, killer tracking, death. */
  private damagePlayer(amount: number, source: string, attacker: Enemy | null, contact = false): void {
    const before = this.player.health.hp;
    const capped = attacker !== null && attacker.damageCap !== null ? Math.min(amount, attacker.damageCap) : amount;
    const scaled = capped * Math.max(0, this.player.stats.get('contactDamageMul'));
    const died = this.player.health.apply({ amount: scaled, crit: false, source });
    if (this.player.health.hp === before && !died) return;
    this.lastHitSource = source;
    this.recordHit(before - this.player.health.hp, source, contact);
    attacker?.onDealtDamage(before - this.player.health.hp);
    this.player.playAction(ANIM.heroHurt);
    this.callbacks.onPlayerHit(this.player.health.ratio, source);
    if (allowEffect('hurt-sfx', HURT_SFX_PER_S)) sfx('hurt');
    if (died) this.resolveHeroDeath();
  }

  /** Ground DoT (plagued pools): bypasses i-frames like hazard drains. */
  private drainPlayer(amount: number, source: string): void {
    const health = this.player.health;
    if (health.hp <= 0) return;
    const before = health.hp;
    health.hp = Math.max(0, health.hp - amount * Math.max(0, this.player.stats.get('contactDamageMul')));
    this.lastHitSource = source;
    this.recordHit(before - health.hp, source, false);
    if (health.hp > 0) return;
    this.resolveHeroDeath();
  }

  /** Death-credit ring (critic F5): per-frame DoT ticks coalesce into the previous record. */
  private recordHit(amount: number, name: string, contact: boolean): void {
    const now = this.scene.time.now;
    const last = this.hits[this.hits.length - 1];
    if (last !== undefined && last.name === name && last.contact === contact && now - last.t < 250) {
      last.amount += amount;
      last.t = now;
    } else {
      this.hits.push({ t: now, amount, name, contact });
    }
    while (this.hits.length > 0 && now - (this.hits[0]?.t ?? now) > DEATH_CREDIT_WINDOW_MS) this.hits.shift();
  }

  /**
   * Killer label (`Slain by …`): top damage source over the last 5 s, or the
   * swarm pressing the hero when contact damage dominated (critic F5).
   */
  get killer(): string {
    const crowd: string[] = [];
    this.hash.queryCircle(this.player.x, this.player.y, CROWD_PX, this.near);
    for (const e of this.near) {
      if (e.dormant || e.contactDamage() <= 0) continue;
      // Bodies actually in reach (contact reach + a margin), not the whole visible crowd.
      const reach = e.contactReach + CROWD_MARGIN_PX;
      if ((e.x - this.player.x) ** 2 + (e.y - this.player.y) ** 2 <= reach * reach) crowd.push(e.isElite ? e.displayName : e.def.name);
    }
    return deathCredit(this.hits, this.scene.time.now, crowd, this.lastHitSource);
  }

  private resolveHeroDeath(): void {
    if (this.dead || this.consumeLastGasp()) return;
    this.dead = true;
    this.player.setVelocity(0, 0);
    this.player.playAction(ANIM.heroDeath);
    this.callbacks.onPlayerDied(this.killer);
  }

  /**
   * Refuses one lethal blow if a revive charge is armed (Last Gasp card /
   * Sanctum revive). Public: hazard/Collapse drains in the scene consult the
   * same charge. True when the death was refused.
   */
  consumeLastGasp(): boolean {
    const state = this.effects;
    if (state.lastGaspCharges <= 0) return false;
    state.lastGaspCharges -= 1;
    const health = this.player.health;
    health.revive(health.max * state.lastGaspReviveRatio);
    health.hp = Math.max(1, health.max * state.lastGaspReviveRatio);
    health.grantIframes(state.lastGaspIframesMs);
    this.revived = true;
    return true;
  }

  private hitEnemy(enemy: Enemy, amount: number, crit: boolean, source: string, sx: number, sy: number): void {
    if (!enemy.active) return;
    const bonus = this.bonuses;
    const mul = enemy.damageTakenMul(sx, sy) * (enemy.isElite || enemy.bossKind !== null ? bonus.eliteDamageMul : 1) * (bonus.vsEnemyMul[enemy.def.id] ?? 1);
    if (mul <= 0) return;
    const scaled = amount * mul;
    let died = enemy.health.apply({ amount: scaled, crit, source });
    if (died && enemy.interceptDeath()) died = false;
    enemy.syncBar();
    hitFlash(this.scene, enemy, 50);
    if (crit) this.player.onCrit();
    if (allowEffect('enemy-hit-sfx', TUNING.caps.hitSfxPerSecond)) sfx('hit', { volume: 0.6, rate: crit ? 1.25 : 1 });
    if (allowEffect('float', TUNING.caps.floatTextPerSecond)) {
      const damage = Math.max(1, Math.round(scaled));
      floatText(this.scene, enemy.x, enemy.y - enemy.visiblePx * 0.5, crit ? `${damage}!` : `${damage}`, crit ? '#ffd166' : '#e6e0dd', crit ? 39 : 30);
    }
    const perHit = enemy.def.params?.shardsPerHitTaken;
    if (perHit !== undefined && perHit > 0) this.dropCoins(enemy.x, enemy.y, perHit);
    if (died) this.killEnemy(enemy, source);
  }

  /**
   * Meta economy retune: a trash kill pays its ◆ only with the chance from
   * `economy.killShardChanceByS` (last row whose fromS ≤ run seconds), drawn on
   * the combat Rng. Elites, mid-bosses and bosses always pay their own amount.
   */
  private killShards(enemy: Enemy): number {
    if (enemy.def.rank !== 'trash' || enemy.affix !== null) return enemy.shardValue;
    const t = this.elapsedMs / 1000;
    let chance = 1;
    for (const [fromS, c] of TUNING.economy.killShardChanceByS) if (t >= fromS) chance = c;
    return this.rng.float(0, 1) < chance ? enemy.shardValue : 0;
  }

  private killEnemy(enemy: Enemy, source: string): void {
    if (this.bossAdds.delete(enemy) && this.bossAdds.size === 0) {
      for (const other of this.enemies) if (other.def.rank === 'boss') other.shielded = false;
    }
    const plainDeath = baseKeyOf(enemy.deathKey);
    this.corpses.play(enemy.deathKey, enemy.x, enemy.y, enemy.displaySize * actionScale(enemy.artKey, plainDeath), enemy.flipX, enemy.originY);
    const x = enemy.x;
    const y = enemy.y;
    const def = enemy.def;
    const report: KillReport = {
      defId: def.id,
      name: enemy.displayName,
      x,
      y,
      shards: this.killShards(enemy),
      elite: enemy.isElite ? enemy.affix : null,
      boss: enemy.bossKind,
      source,
    };
    const affix = enemy.affix;
    const splitBudget = enemy.splitBudget;
    const xp = enemy.xpValue;
    const index = this.enemies.indexOf(enemy);
    if (index >= 0) {
      this.enemyPool.release(enemy);
      this.swapRemove(this.enemies, index);
    }
    this.dropOrb(x, y, xp);
    const burstRadius = def.params?.burstRadiusPx;
    const burstDamage = def.params?.burstDamage;
    if (burstRadius !== undefined && burstDamage !== undefined) {
      this.strike({ shape: 'circle', x, y, r: burstRadius, telegraphMs: def.params?.burstFlashMs ?? 300, damage: burstDamage, source: def.name });
    }
    if (def.behaviour === 'split' && splitBudget > 0) {
      const count = def.params?.splitCount ?? 0;
      const hpRatio = def.params?.splitHpRatio ?? 1;
      for (let i = 0; i < count; i += 1) {
        const child = this.spawnAtPosition(def.id, x + this.rng.float(-30, 30), y + this.rng.float(-30, 30), this.difficulty * hpRatio);
        if (child !== null) child.splitBudget = splitBudget - 1;
      }
    }
    if (affix === 'splitter') {
      const minions = TUNING.elite.affixes.splitter.minions;
      const base = def.rank === 'trash' ? def.id : 'husk';
      for (let i = 0; i < minions; i += 1) this.spawnAtPosition(base, x + this.rng.float(-50, 50), y + this.rng.float(-50, 50), this.difficulty);
    }
    if (affix === 'plagued') {
      const p = TUNING.elite.affixes.plagued;
      this.groundZone(x, y, p.radius, 0, p.durationMs, 0xe8c547, p.dps, report.name);
    }
    // Critic F17: bosses and mid-bosses fall on the low `collapse` voice, elites on `die`.
    if (def.rank !== 'trash') sfx('slain', { volume: 0.9 });
    else if (affix !== null) sfx('slain', { volume: 0.7, rate: 1.3 });
    else if (allowEffect('enemy-die-sfx', DEATH_SFX_PER_S)) sfx('crunch', { volume: 0.7 });
    this.callbacks.onEnemyKilled(report);
  }

  /** Breakable XP cluster (E20 `onDrop`, wired in game.ts). */
  dropXp(x: number, y: number, orbs: number, value: number): void {
    for (let i = 0; i < orbs; i += 1) this.dropOrb(x + this.rng.float(-COIN_SCATTER_PX, COIN_SCATTER_PX), y + this.rng.float(-COIN_SCATTER_PX, COIN_SCATTER_PX), value);
  }

  /** Breakable shard drop (E20 `onDrop`, wired in game.ts). */
  dropShards(x: number, y: number, total: number): void {
    const count = Math.max(1, Math.min(Math.round(total), this.rng.int(TUNING.elite.coinDropMin, TUNING.elite.coinDropMax)));
    const each = Math.floor(total / count);
    for (let i = 0; i < count; i += 1) {
      const coin = this.coinPool.obtain();
      coin.drop(x + this.rng.float(-COIN_SCATTER_PX, COIN_SCATTER_PX), y + this.rng.float(-COIN_SCATTER_PX, COIN_SCATTER_PX), each + (i === 0 ? total - each * count : 0));
      this.coins.push(coin);
    }
  }

  /** Meta `combatBonuses()` (a_elitedmg affix + Bestiary tiers), set once per run by game.ts. */
  setDamageBonuses(b: { eliteDamageMul: number; vsEnemyMul: Readonly<Record<string, number>> }): void {
    this.bonuses = b;
  }

  private dropOrb(x: number, y: number, value: number): void {
    if (value <= 0) return;
    const orb = this.orbPool.obtain();
    orb.drop(x, y, value);
    this.orbs.push(orb);
  }

  private dropCoins(x: number, y: number, total: number): void {
    const count = this.rng.int(TUNING.elite.coinDropMin, TUNING.elite.coinDropMax);
    const each = Math.max(1, Math.round(total / count));
    for (let i = 0; i < count; i += 1) {
      const coin = this.coinPool.obtain();
      coin.drop(x + this.rng.float(-COIN_SCATTER_PX, COIN_SCATTER_PX), y + this.rng.float(-COIN_SCATTER_PX, COIN_SCATTER_PX), each);
      this.coins.push(coin);
    }
  }

  private swapRemove<T>(list: T[], index: number): void {
    const last = list.pop();
    if (last !== undefined && index < list.length) list[index] = last;
  }

  // ── debug (§19: every boss + mid-boss reachable under `?debug`) ────────

  /** `?debug`: keys 1-4 spawn the castle/outlands/desert/winter boss, 5-8 the mid-bosses, 9 a random elite. */
  private installDebug(): void {
    const w = globalThis as { location?: { search: string }; __ACTORS__?: () => CombatDebugStats };
    w.__ACTORS__ = () => this.debugStats();
    if (w.location === undefined || !new URLSearchParams(w.location.search).has('debug')) return;
    const keyboard = this.scene.input.keyboard;
    if (keyboard === null) return;
    const zones: ZoneId[] = ['castle', 'outlands', 'desert', 'winter'];
    const affixes: EliteAffixId[] = ['vampiric', 'hasted', 'shielded', 'splitter', 'frenzied', 'warded', 'plagued', 'magnetic'];
    const onKey = (event: KeyboardEvent): void => {
      const n = Number(event.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      const x = this.player.x + 320;
      const y = this.player.y - 200;
      if (n <= 4) this.spawnBoss(zones[n - 1] ?? 'castle', x, y);
      else if (n <= 8) this.spawnMidBoss(zones[n - 5] ?? 'castle', x, y);
      else this.spawnElite('husk', affixes[this.rng.int(0, affixes.length - 1)] ?? 'hasted', x, y);
    };
    keyboard.on('keydown', onKey);
    this.debugKeys = () => keyboard.off('keydown', onKey);
  }

  destroy(): void {
    this.debugKeys?.();
    this.debugKeys = null;
    for (const enemy of this.enemies) enemy.despawn();
    for (const shot of this.shots) shot.despawn();
    for (const orb of this.orbs) orb.despawn();
    for (const coin of this.coins) coin.despawn();
    this.weapons.destroy();
    this.corpses.releaseAll();
    this.enemies.length = 0;
    this.shots.length = 0;
    this.orbs.length = 0;
    this.coins.length = 0;
    for (const s of this.hostile) {
      s.img.destroy();
      for (const g of s.ghosts) g.destroy();
    }
    this.hostile.length = 0;
    for (const z of this.zones) z.img.destroy();
    this.zones.length = 0;
    for (const s of this.strikes) s.gfx.destroy();
    this.strikes.length = 0;
    for (const r of this.rings) r.gfx.destroy();
    this.rings.length = 0;
    for (const b of this.beams) b.gfx.destroy();
    this.beams.length = 0;
    for (const r of this.rallies) r.img.destroy();
    this.rallies.length = 0;
    for (const e of this.eggList) e.img.destroy();
    this.eggList.length = 0;
    this.wallGroup.clear(true, true);
    this.wallList.length = 0;
    this.player.stats.removeBySource(SLOW_SOURCE);
    this.bossAdds.clear();
    this.clearThralls();
    for (const t of this.thrallPool) t.destroy();
    this.thrallPool.length = 0;
    this.player.destroyAll();
  }
}
