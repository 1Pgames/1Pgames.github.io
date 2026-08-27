import Phaser from 'phaser';
import { TUNING, VIEW } from '../config';
import { Pool } from '../core/pool';
import { SpatialHash } from '../core/spatial';
import { rollDamage } from '../core/damage';
import { playFx } from '../core/juice';
import { ANIM } from '../data/art';
import type { Rng } from '../core/rng';
import type { Modifier } from '../core/stats';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import type { Arena } from './arena';
import { Player } from '../objects/player';
import { Enemy } from '../objects/enemy';
import { Projectile } from '../objects/projectile';
import { XpOrb } from '../objects/xporb';

/**
 * The combat core of a survivor-like run: owns the player, the enemy/projectile/
 * orb pools, the broad-phase hash, auto-attack timing, damage resolution and XP
 * collection. The scene only feeds it a delta and the current difficulty, and
 * reacts to callbacks — so a different game can swap this file out without
 * touching UI, waves or meta progression.
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
}

const DEFS: Record<string, EnemyDef> = {};
for (const def of ENEMIES) DEFS[def.id] = def;

export class CombatSystem {
  readonly player: Player;

  private readonly scene: Phaser.Scene;
  private readonly rng: Rng;
  private readonly callbacks: CombatCallbacks;

  private readonly enemyPool: Pool<Enemy>;
  private readonly shotPool: Pool<Projectile>;
  private readonly orbPool: Pool<XpOrb>;

  private readonly enemies: Enemy[] = [];
  private readonly shots: Projectile[] = [];
  private readonly orbs: XpOrb[] = [];

  private readonly hash: SpatialHash<Enemy>;
  /** Scratch buffer reused by every query — never reallocated. */
  private readonly near: Enemy[] = [];

  private readonly arena: Arena;
  private readonly enemyGroup: Phaser.Physics.Arcade.Group;
  private readonly spawnPoint = { x: 0, y: 0 };
  private attackCooldownMs = 0;
  private difficulty = 1;
  private paused = false;
  private dead = false;

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
  }

  /** Live enemy count — the scene uses it to suppress shake at high density. */
  aliveEnemies(): number {
    return this.enemies.length;
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
   * No-ops at `TUNING.enemy.maxAlive`: dropping spawns is how the frame budget
   * is kept, and the run director keeps its timeline either way.
   */
  spawn(id: string, difficultyMul: number): void {
    if (this.enemies.length >= TUNING.enemy.maxAlive) return;
    const def = DEFS[id];
    if (def === undefined) return;

    const angle = this.rng.float(0, Math.PI * 2);
    const rx = VIEW.width / 2 + TUNING.enemy.spawnMargin;
    const ry = VIEW.height / 2 + TUNING.enemy.spawnMargin;
    this.arena.clamp(
      this.player.x + Math.cos(angle) * rx,
      this.player.y + Math.sin(angle) * ry,
      TUNING.arena.wallThickness + def.size,
      this.spawnPoint,
    );

    const enemy = this.enemyPool.obtain();
    enemy.spawnWith(def, this.spawnPoint.x, this.spawnPoint.y, difficultyMul);
    enemy.onShoot = this.enemyShoot;
    this.enemies.push(enemy);
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
    this.tickAutoAttack(deltaMs);
    this.tickContactDamage();
  }

  destroy(): void {
    for (const enemy of this.enemies) enemy.despawn();
    for (const shot of this.shots) shot.despawn();
    for (const orb of this.orbs) orb.despawn();
    this.enemies.length = 0;
    this.shots.length = 0;
    this.orbs.length = 0;
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

  private tickAutoAttack(deltaMs: number): void {
    this.attackCooldownMs -= deltaMs;
    if (this.attackCooldownMs > 0) return;

    const range = this.player.stats.get('range');
    const target = this.nearestEnemy(this.player.x, this.player.y, range);
    if (target === null) return;

    // `attackSpeed` is a multiplier on rate, so it divides the interval; a card
    // that reads "+12% attack speed" must not add 12% to a millisecond value.
    const attackSpeed = Math.max(0.1, this.player.stats.get('attackSpeed'));
    this.attackCooldownMs = this.player.stats.get('attackMs') / attackSpeed;

    const count = Math.max(1, Math.round(this.player.stats.get('projectiles')));
    const speed = this.player.stats.get('projectileSpeed');
    const area = Math.max(0.2, this.player.stats.get('areaMul'));
    const baseAngle = Math.atan2(target.y - this.player.y, target.x - this.player.x);
    // Total fan stays constant per extra projectile, so a 5-shot build sprays
    // wide instead of stacking five bullets on one line.
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
        roll.amount,
        roll.crit,
        false,
        area,
      );
      this.shots.push(shot);
    }
    this.player.playAction(ANIM.heroAttack);
    this.callbacks.onPlayerAttack(this.player.x, this.player.y);
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
        const hit = this.nearestEnemy(shot.x, shot.y, shot.hitRadius + 12);
        if (hit !== null) {
          this.hitEnemy(hit, shot.damage);
          done = true;
        }
      }

      if (done) {
        this.shotPool.release(shot);
        this.swapRemove(this.shots, i);
      }
    }
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
      if (this.dead) return;
    }
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

  private hitEnemy(enemy: Enemy, amount: number): void {
    const died = enemy.health.apply({ amount, crit: false, source: 'player' });
    enemy.syncBar();
    playFx(this.scene, ANIM.hitSpark, enemy.x, enemy.y, enemy.def.size * 1.4);
    if (!died) return;

    const index = this.enemies.indexOf(enemy);
    if (index >= 0) {
      this.enemyPool.release(enemy);
      this.swapRemove(this.enemies, index);
    }

    this.dropOrb(enemy.x, enemy.y, enemy.xpValue);
    const def = enemy.def;
    if (def.splitInto !== undefined) {
      for (const childId of def.splitInto) this.spawnAt(childId, enemy.x, enemy.y);
    }
    this.callbacks.onEnemyKilled(def, enemy.x, enemy.y);
  }

  /** Split children spawn where the parent died, not on the off-screen ring. */
  private spawnAt(id: string, x: number, y: number): void {
    if (this.enemies.length >= TUNING.enemy.maxAlive) return;
    const def = DEFS[id];
    if (def === undefined) return;
    const enemy = this.enemyPool.obtain();
    enemy.spawnWith(def, x + this.rng.float(-30, 30), y + this.rng.float(-30, 30), this.difficulty);
    enemy.onShoot = this.enemyShoot;
    this.enemies.push(enemy);
  }

  private dropOrb(x: number, y: number, value: number): void {
    if (value <= 0) return;
    const orb = this.orbPool.obtain();
    orb.drop(x, y, value);
    this.orbs.push(orb);
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
