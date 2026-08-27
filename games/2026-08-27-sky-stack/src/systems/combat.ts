import Phaser from 'phaser';
import { TUNING, VIEW } from '../config';
import { Pool } from '../core/pool';
import { SpatialHash } from '../core/spatial';
import { rollDamage } from '../core/damage';
import { playFx, floatText, burst } from '../core/juice';
import { sfx } from '../core/audio';
import { ANIM } from '../data/art';
import type { Rng } from '../core/rng';
import type { Modifier } from '../core/stats';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import type { WaveSpec } from '../core/run';
import type { Arena } from './arena';
import { Player } from '../objects/player';
import { Enemy } from '../objects/enemy';
import { Projectile } from '../objects/projectile';
import { XpOrb } from '../objects/xporb';
import { Coin } from '../objects/coin';
import { Blade } from '../objects/blade';
import {
  createWeaponState,
  weaponBoostDamageMul,
  weaponDef,
  type WeaponPattern,
  type WeaponState,
} from '../data/weapons';
import { createEffectState, type EffectState } from '../core/effects';

/**
 * The combat core of a survivor-like run: owns the player, every weapon
 * (bolt/orbit/nova/rail), the enemy/projectile/orb/coin pools, the
 * broad-phase hash, boss-phase attacks, heal-aura pulses, damage resolution
 * and XP/currency collection. The scene only feeds it a delta and the
 * current difficulty, and reacts to callbacks — so a different game can swap
 * this file out without touching UI, waves or meta progression.
 *
 * Performance contract: one `SpatialHash` rebuild per frame, all hit detection
 * through it (no Arcade colliders for enemies or projectiles), every entity
 * pooled, no allocation in `update`.
 *
 * Do NOT use for: turn-based combat, or physics-driven games that genuinely
 * need Arcade collision response (this system resolves hits by distance).
 */

export interface CombatCallbacks {
  onEnemyKilled(def: EnemyDef, x: number, y: number): void;
  onPlayerHit(hpRatio: number): void;
  onPlayerDied(): void;
  onLevelUp(level: number, levelsGained: number): void;
  onPlayerAttack(x: number, y: number): void;
  /** Boss entered the scene (first `boss` spawn) — the scene layers boss music on. */
  onBossSpawned(): void;
  /** The `boss` archetype died specifically — an immediate win, distinct from `onEnemyKilled`. */
  onBossKilled(): void;
  /** A weapon just evolved (all its boost cards maxed) — the scene shows floatText + plays a sfx. */
  onWeaponEvolved(name: string): void;
  /** A coin pickup reached the player — the scene grants run currency for it. */
  onCoinCollected(value: number): void;
}

const DEFS: Record<string, EnemyDef> = {};
for (const def of ENEMIES) DEFS[def.id] = def;

/** Contact reach + hit radius scratch, in world px, per `dropOrb`/coin spawn spread. */
const COIN_SCATTER_PX = 26;

export class CombatSystem {
  readonly player: Player;
  /** Legendary `effect` card state (glass-cannon / bulwark), consumed by combat + damage. */
  readonly effects: EffectState = createEffectState();

  private readonly scene: Phaser.Scene;
  private readonly rng: Rng;
  private readonly callbacks: CombatCallbacks;

  private readonly enemyPool: Pool<Enemy>;
  private readonly shotPool: Pool<Projectile>;
  private readonly orbPool: Pool<XpOrb>;
  private readonly coinPool: Pool<Coin>;
  private readonly bladePool: Pool<Blade>;

  private readonly enemies: Enemy[] = [];
  private readonly shots: Projectile[] = [];
  private readonly orbs: XpOrb[] = [];
  private readonly coins: Coin[] = [];
  private readonly blades: Blade[] = [];

  private readonly hash: SpatialHash<Enemy>;
  /** Scratch buffer reused by every query — never reallocated. */
  private readonly near: Enemy[] = [];
  /** Per-blade last-hit timestamp per enemy, keyed by `blade index * 100000 + enemy` bucket via a Map<Enemy, number>. */
  private readonly bladeHitAt = new Map<Enemy, number>();

  private readonly arena: Arena;
  private readonly enemyGroup: Phaser.Physics.Arcade.Group;
  private readonly spawnPoint = { x: 0, y: 0 };
  private readonly weapons: WeaponState[] = [createWeaponState('bolt')];
  private attackCooldownMs = 0;
  private difficulty = 1;
  private paused = false;
  private dead = false;
  private bossSeen = false;
  /** Enemies summoned by the boss's phase-2 shield; shield drops once this set empties. */
  private readonly bossAdds = new Set<Enemy>();
  /** Cached heading for `'arc'`/`'line'` spawn patterns, expired after a gap so the next burst gets a fresh side. */
  private lastArcAngle: number | null = null;
  private lastArcAngleAt = -Infinity;
  /** Cached heading for `'cluster'` spawn patterns, same expiry rule. */
  private lastClusterAngle: number | null = null;
  private lastClusterAngleAt = -Infinity;
  /** Cached-angle expiry: a gap this long between spawns of the same pattern starts a fresh heading. */
  private static readonly ANGLE_CACHE_MS = 1500;
  /** Absolute `scene.time.now` timestamp until which `spawn()` no-ops (breather scripted event). */
  private spawnSilencedUntilMs = -Infinity;

  constructor(
    scene: Phaser.Scene,
    rng: Rng,
    arena: Arena,
    callbacks: CombatCallbacks,
    metaMods: readonly Modifier[] = [],
  ) {
    this.scene = scene;
    this.rng = rng;
    this.arena = arena;
    this.callbacks = callbacks;
    this.hash = new SpatialHash<Enemy>(TUNING.caps.spatialCellSize);

    this.player = new Player(scene, arena.centerX, arena.centerY, metaMods);
    scene.physics.add.collider(this.player, arena.obstacles);

    // Enemies live in a physics group purely so ONE collider handles every
    // enemy-versus-prop contact; enemy-versus-enemy and hit detection still go
    // through the spatial hash.
    this.enemyGroup = scene.physics.add.group();
    scene.physics.add.collider(this.enemyGroup, arena.obstacles);

    this.enemyPool = new Pool<Enemy>(
      () => this.createEnemy(),
      (enemy) => enemy.despawn(),
      Math.min(80, TUNING.enemy.maxAlive),
    );
    this.shotPool = new Pool<Projectile>(
      () => new Projectile(scene),
      (shot) => shot.despawn(),
      64,
    );
    this.orbPool = new Pool<XpOrb>(
      () => new XpOrb(scene),
      (orb) => orb.despawn(),
      64,
    );
    this.coinPool = new Pool<Coin>(
      () => new Coin(scene),
      (coin) => coin.despawn(),
      16,
    );
    this.bladePool = new Pool<Blade>(
      () => new Blade(scene),
      (blade) => blade.despawn(),
      4,
    );
  }

  /** Live enemy count — the scene uses it to suppress shake at high density. */
  aliveEnemies(): number {
    return this.enemies.length;
  }

  /** Weapons currently equipped (bolt is always first). Read-only for UI/upgrade gating. */
  equippedWeapons(): readonly WeaponState[] {
    return this.weapons;
  }

  /** True while a free weapon slot remains (see `TUNING.weapons.maxSlots`). */
  hasFreeWeaponSlot(): boolean {
    return this.weapons.length < TUNING.weapons.maxSlots;
  }

  hasWeapon(id: WeaponPattern): boolean {
    return this.weapons.some((w) => w.id === id);
  }

  /** Adds a new weapon to a free slot. No-op if already equipped or no slot free. */
  unlockWeapon(id: WeaponPattern): void {
    if (this.hasWeapon(id) || !this.hasFreeWeaponSlot()) return;
    this.weapons.push(createWeaponState(id));
    if (id === 'orbit') this.syncBladeCount();
  }

  /**
   * Adds one boost to an equipped weapon; evolves it once boosts reach
   * `TUNING.weapons.maxBoosts`, announcing via the evolution callback.
   */
  boostWeapon(id: WeaponPattern): void {
    const weapon = this.weapons.find((w) => w.id === id);
    if (weapon === undefined) return;
    weapon.boosts += 1;
    if (id === 'orbit') this.syncBladeCount();
    if (!weapon.evolved && weapon.boosts >= TUNING.weapons.maxBoosts) {
      weapon.evolved = true;
      this.callbacks.onWeaponEvolved(weaponDef(id).evolvedName);
    }
  }

  /** Suppresses `spawn()` for `ms` — the `breather` scripted event's lull. */
  silenceSpawns(ms: number): void {
    this.spawnSilencedUntilMs = this.scene.time.now + ms;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    for (const enemy of this.enemies) enemy.setVelocity(0, 0);
    if (paused) this.player.setVelocity(0, 0);
    // The Arcade world keeps integrating while the run is paused, so bullets and
    // orbs would drift on across a draft overlay — and, since `update` is not
    // running, never get culled. Freeze the world with the run.
    if (paused) this.scene.physics.world.pause();
    else this.scene.physics.world.resume();
  }

  /**
   * Spawns one enemy just outside the camera view, clamped inside the arena, so
   * threats always walk in from off-screen but never from outside the field.
   * No-ops at `TUNING.enemy.maxAlive`, or while a `breather` scripted event's
   * silence window is active — dropping spawns is how both the frame budget
   * and the scripted lull are kept; the run director keeps its timeline either way.
   */
  spawn(id: string, difficultyMul: number, pattern: WaveSpec['pattern'] = 'ring'): void {
    if (this.enemies.length >= TUNING.enemy.maxAlive) return;
    if (this.scene.time.now < this.spawnSilencedUntilMs) return;
    const def = DEFS[id];
    if (def === undefined) return;
    const angle = this.spawnAngle(pattern);
    const rx = VIEW.width / 2 + TUNING.enemy.spawnMargin;
    const ry = VIEW.height / 2 + TUNING.enemy.spawnMargin;
    this.arena.clamp(
      this.player.x + Math.cos(angle) * rx,
      this.player.y + Math.sin(angle) * ry,
      TUNING.arena.wallThickness + def.size,
      this.spawnPoint,
    );
    this.spawnEnemyAt(def, this.spawnPoint.x, this.spawnPoint.y, difficultyMul);
  }

  /**
   * Picks the spawn-ring angle for a wave's geometry. `'ring'` (default) is
   * the original uniform-random angle; `'arc'`/`'line'` narrow the angle to
   * one deterministic-per-wave direction (a fresh random heading captured
   * once and reused, so a whole burst arrives from the same side instead of
   * surrounding the player); `'cluster'` is `'ring'` with a tightened spread
   * so the wave still lands as one loose group rather than one exact point.
   */
  private spawnAngle(pattern: WaveSpec['pattern']): number {
    const now = this.scene.time.now;
    if (pattern === 'arc' || pattern === 'line') {
      if (this.lastArcAngle === null || now - this.lastArcAngleAt > CombatSystem.ANGLE_CACHE_MS) {
        this.lastArcAngle = this.rng.float(0, Math.PI * 2);
      }
      this.lastArcAngleAt = now;
      const spread = pattern === 'line' ? 0 : 0.5;
      return this.lastArcAngle + this.rng.float(-spread, spread);
    }
    if (pattern === 'cluster') {
      if (this.lastClusterAngle === null || now - this.lastClusterAngleAt > CombatSystem.ANGLE_CACHE_MS) {
        this.lastClusterAngle = this.rng.float(0, Math.PI * 2);
      }
      this.lastClusterAngleAt = now;
      return this.lastClusterAngle + this.rng.float(-0.12, 0.12);
    }
    return this.rng.float(0, Math.PI * 2);
  }

  /** Spawns one enemy at an explicit world position — used for scripted events (elite-rush arcs). */
  spawnAtPosition(id: string, x: number, y: number, difficultyMul: number): void {
    if (this.enemies.length >= TUNING.enemy.maxAlive) return;
    const def = DEFS[id];
    if (def === undefined) return;
    this.spawnEnemyAt(def, x, y, difficultyMul);
  }

  private spawnEnemyAt(def: EnemyDef, x: number, y: number, difficultyMul: number): void {
    const enemy = this.enemyPool.obtain();
    enemy.spawnWith(def, x, y, difficultyMul);
    enemy.onShoot = this.enemyShoot;
    enemy.onHealPulse = this.healPulse;
    enemy.onBossAttack = this.bossAttack;
    this.enemies.push(enemy);
    if (def.behaviour === 'boss' && !this.bossSeen) {
      this.bossSeen = true;
      this.callbacks.onBossSpawned();
    }
  }

  private createEnemy(): Enemy {
    const enemy = new Enemy(this.scene);
    this.enemyGroup.add(enemy);
    enemy.despawn();
    return enemy;
  }

  update(deltaMs: number, difficultyMul: number): void {
    if (this.dead) return;
    this.difficulty = difficultyMul;
    this.player.tick(this.paused ? 0 : deltaMs);
    if (this.paused) return;

    this.rebuildHash();
    this.tickEnemies(deltaMs);
    this.tickShots(deltaMs);
    this.tickOrbs();
    this.tickCoins();
    this.tickWeapons(deltaMs);
    this.tickContactDamage();
  }

  destroy(): void {
    for (const enemy of this.enemies) enemy.despawn();
    for (const shot of this.shots) shot.despawn();
    for (const orb of this.orbs) orb.despawn();
    for (const coin of this.coins) coin.despawn();
    for (const blade of this.blades) blade.despawn();
    this.enemies.length = 0;
    this.shots.length = 0;
    this.orbs.length = 0;
    this.coins.length = 0;
    this.blades.length = 0;
    this.bladeHitAt.clear();
    this.bossAdds.clear();
    this.player.destroyAll();
  }

  private rebuildHash(): void {
    this.hash.clear();
    for (const enemy of this.enemies) this.hash.insert(enemy.x, enemy.y, enemy);
  }

  private tickEnemies(deltaMs: number): void {
    const px = this.player.x;
    const py = this.player.y;
    for (const enemy of this.enemies) enemy.tickAi(deltaMs, px, py);
  }

  /** Enemy ranged attack, wired into `Enemy.onShoot` at spawn time. */
  private readonly enemyShoot = (enemy: Enemy): void => {
    const dx = this.player.x - enemy.x;
    const dy = this.player.y - enemy.y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = 420;
    const shot = this.shotPool.obtain();
    shot.fire(
      enemy.x,
      enemy.y,
      (dx / dist) * speed,
      (dy / dist) * speed,
      enemy.damage,
      false,
      true,
    );
    this.shots.push(shot);
  };

  /** `healAura` archetypes (healer) pulse HP into nearby enemies, wired into `Enemy.onHealPulse`. */
  private readonly healPulse = (source: Enemy): void => {
    this.hash.queryCircle(source.x, source.y, TUNING.enemy.healAuraRadius, this.near);
    let healedAny = false;
    for (const ally of this.near) {
      if (ally === source || ally.health.hp >= ally.health.max) continue;
      ally.health.heal(TUNING.enemy.healAuraAmount);
      ally.syncBar();
      healedAny = true;
    }
    if (!healedAny) return;
    const ring = this.scene.add
      .image(source.x, source.y, 'tex-ring')
      .setTint(0x7fe0a0)
      .setDisplaySize(TUNING.enemy.healAuraRadius * 0.5, TUNING.enemy.healAuraRadius * 0.5)
      .setAlpha(0.55)
      .setDepth(7);
    this.scene.tweens.add({
      targets: ring,
      displayWidth: TUNING.enemy.healAuraRadius * 2,
      displayHeight: TUNING.enemy.healAuraRadius * 2,
      alpha: 0,
      duration: 480,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  };

  /** Boss phase1/phase3 attacks and phase2 summon, wired into `Enemy.onBossAttack`. */
  private readonly bossAttack = (
    boss: Enemy,
    kind: 'volley' | 'ring' | 'phase2' | 'phase3',
  ): void => {
    if (kind === 'phase2') {
      const count = this.rng.int(TUNING.boss.summonMin, TUNING.boss.summonMax);
      for (let i = 0; i < count; i += 1) {
        const angle = this.rng.float(0, Math.PI * 2);
        const dist = 200 + this.rng.float(0, 160);
        const before = this.enemies.length;
        this.spawnEnemyAt(DEFS.swarm!, boss.x + Math.cos(angle) * dist, boss.y + Math.sin(angle) * dist, this.difficulty);
        const spawned = this.enemies[this.enemies.length - 1];
        if (this.enemies.length > before && spawned !== undefined) this.bossAdds.add(spawned);
      }
      boss.shielded = true;
      flashBoss(this.scene, boss);
      return;
    }
    if (kind === 'phase3') {
      boss.shielded = false;
      flashBoss(this.scene, boss);
      return;
    }
    const shotCount = kind === 'ring' ? TUNING.boss.ringShots : TUNING.boss.volleyShots;
    for (let i = 0; i < shotCount; i += 1) {
      const angle = (i / shotCount) * Math.PI * 2;
      const speed = 340;
      const shot = this.shotPool.obtain();
      shot.fire(boss.x, boss.y, Math.cos(angle) * speed, Math.sin(angle) * speed, boss.damage, false, true, 1.2);
      this.shots.push(shot);
    }
    sfx('whoosh', { volume: 0.6 });
  };

  private tickWeapons(deltaMs: number): void {
    for (const weapon of this.weapons) {
      switch (weapon.id) {
        case 'bolt':
          this.tickBolt(weapon, deltaMs);
          break;
        case 'orbit':
          this.tickOrbit(weapon, deltaMs);
          break;
        case 'nova':
          this.tickNova(weapon, deltaMs);
          break;
        case 'rail':
          this.tickRail(weapon, deltaMs);
          break;
      }
    }
  }

  private tickBolt(weapon: WeaponState, deltaMs: number): void {
    this.attackCooldownMs -= deltaMs;
    if (this.attackCooldownMs > 0) return;

    const range = this.player.stats.get('range');
    const target = this.nearestEnemy(this.player.x, this.player.y, range);
    if (target === null) return;

    // `attackSpeed` is a multiplier on rate, so it divides the interval; a card
    // that reads "+12% attack speed" must not add 12% to a millisecond value.
    const attackSpeed = Math.max(0.1, this.player.stats.get('attackSpeed'));
    const boostCooldownMul = 1 - TUNING.weapons.bolt.boostCooldownMul * weapon.boosts;
    this.attackCooldownMs = (this.player.stats.get('attackMs') / attackSpeed) * Math.max(0.4, boostCooldownMul);

    // Evolution "Twin Volley": one extra volley aimed at the next-nearest target.
    const volleys = weapon.evolved ? 2 : 1;
    const count = Math.max(1, Math.round(this.player.stats.get('projectiles')));
    const speed = this.player.stats.get('projectileSpeed');
    const area = Math.max(0.2, this.player.stats.get('areaMul'));
    const boostDamageMul = weaponBoostDamageMul('bolt', weapon.boosts);

    this.hash.queryCircle(this.player.x, this.player.y, range, this.near);
    this.near.sort((a, b) => this.distSq(a) - this.distSq(b));

    for (let v = 0; v < volleys; v += 1) {
      const volleyTarget = this.near[v] ?? target;
      const baseAngle = Math.atan2(volleyTarget.y - this.player.y, volleyTarget.x - this.player.x);
      const spread = count > 1 ? 0.22 : 0;
      for (let i = 0; i < count; i += 1) {
        const offset = count > 1 ? (i / (count - 1) - 0.5) * spread * (count - 1) : 0;
        const angle = baseAngle + offset;
        const roll = rollDamage(this.player.stats, this.rng, 'auto');
        const shot = this.shotPool.obtain();
        shot.fire(
          this.player.x,
          this.player.y,
          Math.cos(angle) * speed,
          Math.sin(angle) * speed,
          roll.amount * boostDamageMul,
          roll.crit,
          false,
          area,
        );
        this.shots.push(shot);
      }
    }
    this.player.playAction(ANIM.heroAttack);
    this.callbacks.onPlayerAttack(this.player.x, this.player.y);
  }

  private distSq(enemy: Enemy): number {
    const dx = enemy.x - this.player.x;
    const dy = enemy.y - this.player.y;
    return dx * dx + dy * dy;
  }

  /** Circling blade(s) with contact damage on a per-target cooldown. */
  private tickOrbit(weapon: WeaponState, deltaMs: number): void {
    const cfg = TUNING.weapons.orbit;
    this.syncBladeCount();
    if (this.blades.length === 0) return;

    const radius = cfg.radius * (1 + cfg.boostRadiusMul * weapon.boosts);
    weapon.angle += (deltaMs / 1000) * 2.2;
    const now = this.scene.time.now;
    const damage = this.player.stats.get('damage') * cfg.damageMul * weaponBoostDamageMul('orbit', weapon.boosts);

    for (let i = 0; i < this.blades.length; i += 1) {
      const blade = this.blades[i];
      if (blade === undefined) continue;
      const angle = weapon.angle + (i / this.blades.length) * Math.PI * 2;
      const bx = this.player.x + Math.cos(angle) * radius;
      const by = this.player.y + Math.sin(angle) * radius;
      blade.moveTo(bx, by);

      this.hash.queryCircle(bx, by, radius * 0.22, this.near);
      for (const enemy of this.near) {
        const lastHit = this.bladeHitAt.get(enemy) ?? -Infinity;
        if (now - lastHit < cfg.hitCooldownMs) continue;
        this.bladeHitAt.set(enemy, now);
        this.hitEnemy(enemy, damage, false);
      }
    }
  }

  /** Keeps the pooled blade count in sync with `orbit.blades` (+1 if evolved). */
  private syncBladeCount(): void {
    if (!this.hasWeapon('orbit')) return;
    const weapon = this.weapons.find((w) => w.id === 'orbit');
    if (weapon === undefined) return;
    const want = TUNING.weapons.orbit.blades + (weapon.evolved ? 1 : 0);
    while (this.blades.length < want) {
      const blade = this.bladePool.obtain();
      blade.activate(TUNING.weapons.orbit.radius * (1 + TUNING.weapons.orbit.boostRadiusMul * weapon.boosts));
      this.blades.push(blade);
    }
    while (this.blades.length > want) {
      const blade = this.blades.pop();
      if (blade !== undefined) this.bladePool.release(blade);
    }
  }

  /** Periodic radial burst around the player; damage falls off with distance, no per-particle sprites. */
  private tickNova(weapon: WeaponState, deltaMs: number): void {
    const cfg = TUNING.weapons.nova;
    weapon.cooldownMs -= deltaMs;
    if (weapon.cooldownMs > 0) return;
    const boostCooldownMul = 1 - cfg.boostCooldownMul * weapon.boosts;
    weapon.cooldownMs = cfg.cooldownMs * Math.max(0.4, boostCooldownMul);

    const pulses = weapon.evolved ? 2 : 1;
    const radius = cfg.radius;
    const baseDamage = this.player.stats.get('damage') * cfg.damageMul * weaponBoostDamageMul('nova', weapon.boosts);

    for (let p = 0; p < pulses; p += 1) {
      this.hash.queryCircle(this.player.x, this.player.y, radius, this.near);
      for (const enemy of this.near) {
        const dist = Math.sqrt(this.distSq(enemy));
        const falloffAt = radius * cfg.falloffStart;
        const t = dist <= falloffAt ? 1 : Math.max(0, 1 - (dist - falloffAt) / (radius - falloffAt));
        if (t <= 0) continue;
        this.hitEnemy(enemy, baseDamage * t, false);
      }
      burst(this.scene, this.player.x, this.player.y, 0x8fd7ff, 20, radius * 1.1);
    }
    sfx('hit', { volume: 0.5 });
  }

  /** Piercing line shot through the densest cluster of enemies (found via spatial-hash counts). */
  private tickRail(weapon: WeaponState, deltaMs: number): void {
    const cfg = TUNING.weapons.rail;
    weapon.cooldownMs -= deltaMs;
    if (weapon.cooldownMs > 0) return;
    weapon.cooldownMs = cfg.cooldownMs;
    if (this.enemies.length === 0) return;

    const clusterCenter = this.densestClusterCenter();
    if (clusterCenter === null) return;
    const dx = clusterCenter.x - this.player.x;
    const dy = clusterCenter.y - this.player.y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = this.player.stats.get('projectileSpeed');
    const area = Math.max(0.2, this.player.stats.get('areaMul')) * (weapon.evolved ? 1.6 : 1);
    const pierce = cfg.pierceCount + cfg.boostPierceAdd * weapon.boosts;
    const damage = this.player.stats.get('damage') * cfg.damageMul * weaponBoostDamageMul('rail', weapon.boosts);

    const shot = this.shotPool.obtain();
    shot.fire(this.player.x, this.player.y, (dx / dist) * speed, (dy / dist) * speed, damage, false, false, area, pierce);
    this.shots.push(shot);
    sfx('tap', { volume: 0.4 });
  }

  /** Finds the enemy with the most neighbours within a fixed radius — the "densest cluster" target. */
  private densestClusterCenter(): { x: number; y: number } | null {
    let best: Enemy | null = null;
    let bestCount = -1;
    for (const enemy of this.enemies) {
      this.hash.queryCircle(enemy.x, enemy.y, 140, this.near);
      if (this.near.length > bestCount) {
        bestCount = this.near.length;
        best = enemy;
      }
    }
    return best === null ? null : { x: best.x, y: best.y };
  }

  private nearestEnemy(x: number, y: number, radius: number): Enemy | null {
    this.hash.queryCircle(x, y, radius, this.near);
    let best: Enemy | null = null;
    let bestDist = radius * radius;
    for (const enemy of this.near) {
      const dx = enemy.x - x;
      const dy = enemy.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestDist) {
        bestDist = d2;
        best = enemy;
      }
    }
    return best;
  }

  private tickShots(deltaMs: number): void {
    for (let i = this.shots.length - 1; i >= 0; i -= 1) {
      const shot = this.shots[i];
      if (shot === undefined) continue;
      shot.lifeMs -= deltaMs;

      let done = shot.lifeMs <= 0 || this.outOfBounds(shot.x, shot.y);

      if (!done && shot.hostile) {
        const dx = shot.x - this.player.x;
        const dy = shot.y - this.player.y;
        if (dx * dx + dy * dy <= 40 * 40) {
          this.damagePlayer(shot.damage);
          done = true;
        }
      } else if (!done) {
        // Hit radius travels with the shot, so `areaMul` widens real contact.
        const hit = this.nearestUnhitEnemy(shot);
        if (hit !== null) {
          this.hitEnemy(hit, shot.damage, false);
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

  /** Like `nearestEnemy`, but skips targets a piercing shot already hit this flight. */
  private nearestUnhitEnemy(shot: Projectile): Enemy | null {
    this.hash.queryCircle(shot.x, shot.y, shot.hitRadius + 12, this.near);
    let best: Enemy | null = null;
    let bestDist = Infinity;
    for (const enemy of this.near) {
      if (shot.hitTargets.has(enemy)) continue;
      const dx = enemy.x - shot.x;
      const dy = enemy.y - shot.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestDist) {
        bestDist = d2;
        best = enemy;
      }
    }
    return best;
  }

  private tickOrbs(): void {
    const radius = this.player.stats.get('pickupRadius');
    let gainedLevels = 0;
    for (let i = this.orbs.length - 1; i >= 0; i -= 1) {
      const orb = this.orbs[i];
      if (orb === undefined) continue;
      if (!orb.tickMagnet(this.player.x, this.player.y, radius)) continue;
      gainedLevels += this.player.addXp(orb.value);
      this.orbPool.release(orb);
      this.swapRemove(this.orbs, i);
    }
    if (gainedLevels > 0) this.callbacks.onLevelUp(this.player.level, gainedLevels);
  }

  private tickCoins(): void {
    const radius = this.player.stats.get('pickupRadius');
    for (let i = this.coins.length - 1; i >= 0; i -= 1) {
      const coin = this.coins[i];
      if (coin === undefined) continue;
      if (!coin.tickMagnet(this.player.x, this.player.y, radius)) continue;
      this.callbacks.onCoinCollected(coin.value);
      this.coinPool.release(coin);
      this.swapRemove(this.coins, i);
    }
  }

  private tickContactDamage(): void {
    const now = this.scene.time.now;
    this.hash.queryCircle(this.player.x, this.player.y, 90, this.near);
    for (const enemy of this.near) {
      const dx = enemy.x - this.player.x;
      const dy = enemy.y - this.player.y;
      const reach = (enemy.def.size + TUNING.player.size) * 0.45;
      if (dx * dx + dy * dy > reach * reach) continue;
      if (now - enemy.lastContactAt < TUNING.enemy.hitMs) continue;
      enemy.lastContactAt = now;
      this.damagePlayer(enemy.damage);
      this.knockback(enemy, dx, dy);
      if (this.dead) return;
    }
  }

  /** Pushes `enemy` away from the player on contact; `bulwark` doubles the impulse. */
  private knockback(enemy: Enemy, dx: number, dy: number): void {
    const dist = Math.hypot(dx, dy) || 1;
    const impulse = TUNING.player.contactKnockback * this.effects.knockbackMul;
    enemy.setVelocity((dx / dist) * impulse, (dy / dist) * impulse);
    this.scene.time.delayedCall(TUNING.player.contactKnockbackMs, () => {
      if (enemy.active) enemy.setVelocity(0, 0);
    });
  }

  private damagePlayer(amount: number): void {
    const before = this.player.health.hp;
    const died = this.player.health.apply({ amount, crit: false, source: 'enemy' });
    // i-frames swallowed the hit: no feedback, no death check.
    if (this.player.health.hp === before && !died) return;
    this.player.playAction(ANIM.heroHurt);
    this.callbacks.onPlayerHit(this.player.health.ratio);
    if (died && !this.dead) {
      this.dead = true;
      this.callbacks.onPlayerDied();
    }
  }

  private hitEnemy(enemy: Enemy, amount: number, crit: boolean): void {
    const scaled = enemy.shielded ? amount * TUNING.boss.shieldDamageMul : amount;
    const died = enemy.health.apply({ amount: scaled, crit, source: 'player' });
    enemy.syncBar();
    playFx(this.scene, ANIM.hitSpark, enemy.x, enemy.y, enemy.def.size * 1.4);
    if (!died) return;

    if (this.bossAdds.delete(enemy) && this.bossAdds.size === 0) {
      for (const other of this.enemies) if (other.def.behaviour === 'boss') other.shielded = false;
    }

    const index = this.enemies.indexOf(enemy);
    if (index >= 0) {
      this.enemyPool.release(enemy);
      this.swapRemove(this.enemies, index);
    }

    if (this.effects.killIframesMs > 0) this.player.health.grantIframes(this.effects.killIframesMs);

    this.dropOrb(enemy.x, enemy.y, enemy.xpValue);
    const def = enemy.def;
    if (def.splitInto !== undefined) {
      for (const childId of def.splitInto) this.spawnAt(childId, enemy.x, enemy.y);
    }
    if (def.eliteDrop === true) this.dropCoins(enemy.x, enemy.y, TUNING.economy.currencyPerElite);
    if (def.behaviour === 'boss') this.callbacks.onBossKilled();
    this.callbacks.onEnemyKilled(def, enemy.x, enemy.y);
  }

  /** Split children spawn where the parent died, not on the off-screen ring. */
  private spawnAt(id: string, x: number, y: number): void {
    if (this.enemies.length >= TUNING.enemy.maxAlive) return;
    const def = DEFS[id];
    if (def === undefined) return;
    this.spawnEnemyAt(def, x + this.rng.float(-30, 30), y + this.rng.float(-30, 30), this.difficulty);
  }

  private dropOrb(x: number, y: number, value: number): void {
    if (value <= 0) return;
    const orb = this.orbPool.obtain();
    orb.drop(x, y, value);
    this.orbs.push(orb);
  }

  /** Splits `total` currency across `TUNING.elite.coinDropMin..Max` pickups so it reads as a burst. */
  private dropCoins(x: number, y: number, total: number): void {
    const count = this.rng.int(TUNING.elite.coinDropMin, TUNING.elite.coinDropMax);
    const each = Math.max(1, Math.round(total / count));
    for (let i = 0; i < count; i += 1) {
      const coin = this.coinPool.obtain();
      coin.drop(x + this.rng.float(-COIN_SCATTER_PX, COIN_SCATTER_PX), y + this.rng.float(-COIN_SCATTER_PX, COIN_SCATTER_PX), each);
      this.coins.push(coin);
    }
  }

  private outOfBounds(x: number, y: number): boolean {
    return this.arena.isOutside(x, y, TUNING.enemy.spawnMargin);
  }

  /** O(1) removal from an unordered active list. */
  private swapRemove<T>(list: T[], index: number): void {
    const last = list.pop();
    if (last !== undefined && index < list.length) list[index] = last;
  }
}

/** One-shot red flash on a boss when it changes phase — shared by phase2/phase3 announcements. */
function flashBoss(scene: Phaser.Scene, boss: Enemy): void {
  boss.setTint(0xffffff);
  scene.time.delayedCall(120, () => {
    if (boss.active) boss.clearTint();
  });
  floatText(scene, boss.x, boss.y - boss.def.size * 0.6, 'PHASE', '#ffd166', 40);
}
