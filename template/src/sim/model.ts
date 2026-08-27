import { PLAYER_BASE_STATS, TUNING, VIEW } from '../config';
import { ENEMIES, scaleEnemy, type EnemyDef } from '../data/enemies';
import { PHASES, WAVES } from '../data/waves';
import { rollUpgradeChoices } from '../data/upgrades';
import { RunDirector } from '../core/run';
import { StatBlock } from '../core/stats';
import { Health, rollDamage, setDamageClock } from '../core/damage';
import { Rng } from '../core/rng';
import { createDirectorHost } from './director-host';
import { pickUpgrade, type LanePolicy } from './bots';
import type { RunMetrics } from './metrics';

/**
 * Headless balance simulator: replays a full 480s run against the REAL
 * template data (`TUNING`, `ENEMIES`, `PHASES`/`WAVES` via `RunDirector`,
 * `StatBlock`, `Health`, `rollDamage`, `rollUpgradeChoices`) with a scalar
 * spatial abstraction instead of Arcade physics — there is no x/y, only each
 * enemy's straight-line `distance` to the player. That abstraction is the
 * only thing this file invents; every number that affects the outcome
 * (damage, HP, speeds, cadences, thresholds) comes from `src/config.ts` and
 * `src/data/*`, never duplicated here.
 *
 * The constants below (`KITE_EFFECTIVENESS`, `SHOOT_STANDOFF_PX`, ...) are
 * the sim-only bot/abstraction calibration the assignment asks for — they
 * describe how a bot *plays*, not how the game is *balanced*, and must never
 * move into `TUNING`. Some mirror hardcoded numbers already baked into
 * `objects/enemy.ts` (standoff distance, charge windup/dash) because those
 * numbers are behaviour, not data — enemy.ts hardcodes them too, so copying
 * them here is copying source-of-truth constants, not re-tuning balance.
 */

/** Fraction of the player's raw move speed a skilled bot converts into net evasion against a closing enemy. */
const KITE_EFFECTIVENESS = 0.6;
/** Mirrors `Enemy.tickAi`'s `'shoot'` case: hold this far back, fire on this cadence. */
const SHOOT_STANDOFF_PX = 320;
const SHOOT_CADENCE_MS = 1500;
/**
 * Mirrors `CombatSystem.enemyShoot` + `Projectile.fire`: an enemy shot
 * travels at 420px/s and expires after 1600ms, so it only ever reaches
 * ~672px — a shooter/boss well outside that range fires into nothing. The
 * real system has no distance gate on when `onShoot` fires; the shot's own
 * finite lifetime is what makes range matter.
 */
const ENEMY_SHOT_SPEED = 420;
const ENEMY_SHOT_LIFE_MS = 1600;
const ENEMY_SHOT_MAX_RANGE_PX = ENEMY_SHOT_SPEED * (ENEMY_SHOT_LIFE_MS / 1000);
/** Mirrors `Enemy.tickAi`'s `'charge'` case: 1600ms windup at 0.6x, then 400ms dash at 2.6x. */
const CHARGE_WINDUP_MS = 1600;
const CHARGE_DASH_MS = 400;
const CHARGE_DASH_MUL = 2.6;
const CHARGE_WINDUP_MUL = 0.6;
/** Mirrors `Enemy.tickAi`'s `'orbit'` case: holds station at this radius, rarely reaching contact. */
const ORBIT_RADIUS_PX = 240;

const STEP_MS = 100;

const DEFS: Record<string, EnemyDef> = {};
for (const def of ENEMIES) DEFS[def.id] = def;

interface SimEnemy {
  def: EnemyDef;
  health: Health;
  damage: number;
  speed: number;
  xp: number;
  distance: number;
  lastContactAt: number;
  /** Behaviour-local state timer, reused per-behaviour like `Enemy.stateMs`. */
  stateMs: number;
  dashMs: number;
}

interface PendingOrb {
  readyAtMs: number;
  value: number;
}

/**
 * Enemies spawn on the real elliptical ring `combat.ts spawn()` uses
 * (`rx = VIEW.width/2 + spawnMargin`, `ry = VIEW.height/2 + spawnMargin`) at
 * a uniformly random angle — reimplemented here as a scalar distance instead
 * of an (x, y) point. Randomising per spawn (rather than a single fixed
 * "half-diagonal" distance) matters for more than realism: without it every
 * enemy in the same wave shares one distance and one speed, so they arrive
 * in lockstep and land simultaneous contact hits the instant they're all in
 * reach — an artifact of the collapsed dimension, not the template's real
 * spatial spread.
 */
function spawnDistance(rng: Rng): number {
  const angle = rng.float(0, Math.PI * 2);
  const rx = VIEW.width / 2 + TUNING.enemy.spawnMargin;
  const ry = VIEW.height / 2 + TUNING.enemy.spawnMargin;
  return Math.hypot(Math.cos(angle) * rx, Math.sin(angle) * ry);
}

/** `Player.xpNeeded()`'s formula, reimplemented — the real method lives on a Phaser sprite. */
function xpNeeded(level: number): number {
  return Math.round(TUNING.xp.base * Math.pow(TUNING.xp.growth, level - 1));
}

export interface SimOptions {
  seed: string;
  lane: LanePolicy;
  skill: number;
}

export function simulateRun(options: SimOptions): RunMetrics {
  const { seed, lane, skill } = options;
  const rng = new Rng(seed);

  const stats = new StatBlock(PLAYER_BASE_STATS);
  const health = new Health(stats.get('maxHp'));
  health.invulnMs = TUNING.player.invulnMs;

  let simTimeMs = 0;
  setDamageClock(() => simTimeMs);

  const enemies: SimEnemy[] = [];
  const pendingOrbs: PendingOrb[] = [];
  const taken: string[] = [];

  let level = 1;
  let xp = 0;
  let kills = 0;
  let levelUps = 0;
  let firstUpgradeS: number | null = null;
  let deathS: number | null = null;
  let hpMinPct = 1;
  let attackCooldownMs = 0;

  const bucketCount = Math.ceil(TUNING.runSeconds / 60);
  const dpsBy60s = new Array<number>(bucketCount).fill(0);

  function currentBucket(elapsedMs: number): number {
    return Math.min(bucketCount - 1, Math.floor(elapsedMs / 1000 / 60));
  }

  function spawnEnemy(id: string, difficultyMul: number, atDistance: number): void {
    if (enemies.length >= TUNING.enemy.maxAlive) return;
    const def = DEFS[id];
    if (def === undefined) return;
    const scaled = scaleEnemy(def, difficultyMul);
    enemies.push({
      def,
      health: new Health(scaled.maxHp),
      damage: scaled.damage,
      speed: scaled.moveSpeed,
      xp: scaled.xp,
      distance: atDistance,
      lastContactAt: -Infinity,
      stateMs: 0,
      dashMs: 0,
    });
  }

  const director = new RunDirector(
    createDirectorHost(),
    WAVES,
    PHASES,
    (id) => spawnEnemy(id, director.difficulty, spawnDistance(rng)),
    { durationSeconds: TUNING.runSeconds },
  );

  /** Applies one accepted upgrade card's modifiers, mirroring `Player.applyModifier`. */
  function applyUpgrade(mods: readonly { stat: string; add?: number; mul?: number }[], sourceTag: string): void {
    for (const mod of mods) {
      stats.addModifier({ ...mod, source: sourceTag });
      if (mod.stat === 'maxHp') health.setMax(stats.get('maxHp'), true);
    }
  }

  /** One draft: the bot picks among the offered cards per its lane policy, mirroring `openDraft`. */
  function resolveDraft(elapsedS: number): void {
    const choices = rollUpgradeChoices(rng, taken, TUNING.draft.choices);
    if (choices.length === 0) return;
    const choice = pickUpgrade(lane, choices, rng);
    taken.push(choice.id);
    applyUpgrade(choice.modifiers, `card:${choice.id}:${taken.length}`);
    if (firstUpgradeS === null) firstUpgradeS = elapsedS;
  }

  /** Grants XP (scaled by `xpGain`), resolving every level gained — mirrors `Player.addXp` + `openDraft`. */
  function grantXp(amount: number, elapsedS: number): void {
    xp += amount * stats.get('xpGain');
    let needed = xpNeeded(level);
    while (xp >= needed) {
      xp -= needed;
      level += 1;
      levelUps += 1;
      resolveDraft(elapsedS);
      needed = xpNeeded(level);
    }
  }

  /** Player i-frame-aware hit resolution, mirroring `CombatSystem.damagePlayer`. */
  function damagePlayer(amount: number): void {
    const before = health.hp;
    const died = health.apply({ amount, crit: false, source: 'enemy' });
    if (health.hp === before && !died) return; // i-frames swallowed the hit.
    hpMinPct = Math.min(hpMinPct, health.ratio);
    if (died && deathS === null) deathS = simTimeMs / 1000;
  }

  function killEnemy(enemy: SimEnemy, index: number): void {
    kills += 1;
    const dropDistance = enemy.distance;
    const delayS =
      Math.max(0, dropDistance - stats.get('pickupRadius')) / (TUNING.xp.orbSpeed * TUNING.xp.driftFactor);
    pendingOrbs.push({ readyAtMs: simTimeMs + delayS * 1000, value: enemy.xp });
    const last = enemies.pop();
    if (last !== undefined && index < enemies.length) enemies[index] = last;
    if (enemy.def.splitInto !== undefined) {
      for (const childId of enemy.def.splitInto) spawnEnemy(childId, director.difficulty, enemy.distance);
    }
  }

  /**
   * Distance is a scalar stand-in for the real 2D chase: an enemy's own
   * speed closes it, the player's `moveSpeed` (scaled by `skill` and
   * `KITE_EFFECTIVENESS`) opens it back up as `netSpeed`. This return path is
   * the abstraction's load-bearing piece: without it, every enemy that isn't
   * one-shot eventually converges on contact and stays there forever
   * (nothing in a 1D distance model ever "walks past" or "loses" the
   * player), which a real player's move-speed advantage (330 vs a swarm's
   * 140, a tank's 70, ...) routinely prevents by simply out-walking anything
   * slower. `netSpeed` can go negative — the enemy falls behind and the gap
   * widens back toward the spawn ring — exactly how a skilled player
   * permanently evades slow archetypes instead of merely postponing
   * contact. `contactReach`/`hitMs` (unchanged) still gate whether a landed
   * approach actually deals damage on schedule.
   */
  function tickEnemyDistance(enemy: SimEnemy, deltaMs: number): void {
    enemy.stateMs += deltaMs;
    const deltaS = deltaMs / 1000;
    const evadeSpeed = stats.get('moveSpeed') * skill * KITE_EFFECTIVENESS;

    switch (enemy.def.behaviour) {
      case 'chase':
      case 'split': {
        const netSpeed = enemy.speed - evadeSpeed;
        enemy.distance = Math.max(0, enemy.distance - netSpeed * deltaS);
        break;
      }

      case 'charge': {
        enemy.dashMs -= deltaMs;
        if (enemy.dashMs <= 0 && enemy.stateMs > CHARGE_WINDUP_MS) {
          enemy.dashMs = CHARGE_DASH_MS;
          enemy.stateMs = 0;
        }
        const mul = enemy.dashMs > 0 ? CHARGE_DASH_MUL : CHARGE_WINDUP_MUL;
        const netSpeed = enemy.speed * mul - evadeSpeed;
        enemy.distance = Math.max(0, enemy.distance - netSpeed * deltaS);
        break;
      }

      case 'shoot': {
        // Mirrors `Enemy.tickAi`'s standoff dance: approaches when too far,
        // backs off at half speed when too close. Evasion only matters
        // while it is trying to approach.
        const approaching = enemy.distance > SHOOT_STANDOFF_PX;
        const netSpeed = approaching ? enemy.speed - evadeSpeed : -enemy.speed * 0.5;
        enemy.distance = Math.max(0, enemy.distance - netSpeed * deltaS);
        break;
      }

      case 'orbit':
        if (enemy.distance > ORBIT_RADIUS_PX) {
          const netSpeed = enemy.speed - evadeSpeed;
          enemy.distance = Math.max(ORBIT_RADIUS_PX, enemy.distance - netSpeed * deltaS);
        }
        break;
    }
  }

  function tickRangedAttack(enemy: SimEnemy): void {
    if (enemy.def.behaviour !== 'shoot') return;
    if (enemy.stateMs < SHOOT_CADENCE_MS) return;
    enemy.stateMs = 0;
    if (enemy.distance > ENEMY_SHOT_MAX_RANGE_PX) return; // shot expires before reaching the player.
    damagePlayer(enemy.damage);
  }

  function contactReach(enemy: SimEnemy): number {
    return (enemy.def.size + TUNING.player.size) * 0.45;
  }

  function tickContactDamage(enemy: SimEnemy): void {
    if (enemy.distance > contactReach(enemy)) return;
    if (simTimeMs - enemy.lastContactAt < TUNING.enemy.hitMs) return;
    enemy.lastContactAt = simTimeMs;
    damagePlayer(enemy.damage);
  }

  function tickAutoAttack(deltaMs: number): void {
    attackCooldownMs -= deltaMs;
    if (attackCooldownMs > 0) return;
    if (enemies.length === 0) return;

    const range = stats.get('range');
    const inRange = enemies.filter((enemy) => enemy.distance <= range).sort((a, b) => a.distance - b.distance);
    if (inRange.length === 0) return;

    const attackSpeed = Math.max(0.1, stats.get('attackSpeed'));
    attackCooldownMs = stats.get('attackMs') / attackSpeed;
    const count = Math.max(1, Math.round(stats.get('projectiles')));
    const bucket = currentBucket(simTimeMs);

    for (let i = 0; i < count; i += 1) {
      const target = inRange[Math.min(i, inRange.length - 1)];
      if (target === undefined) continue;
      const roll = rollDamage(stats, rng, 'auto');
      dpsBy60s[bucket] = (dpsBy60s[bucket] ?? 0) + roll.amount;
      const died = target.health.apply({ amount: roll.amount, crit: roll.crit, source: 'player' });
      if (died) {
        const index = enemies.indexOf(target);
        if (index >= 0) killEnemy(target, index);
      }
    }
  }

  function tickOrbs(): void {
    for (let i = pendingOrbs.length - 1; i >= 0; i -= 1) {
      const orb = pendingOrbs[i];
      if (orb === undefined || orb.readyAtMs > simTimeMs) continue;
      grantXp(orb.value, simTimeMs / 1000);
      const last = pendingOrbs.pop();
      if (last !== undefined && i < pendingOrbs.length) pendingOrbs[i] = last;
    }
  }

  function tickRegen(deltaMs: number): void {
    const regen = stats.get('regenPerSecond');
    if (regen <= 0 || health.hp >= health.max) return;
    health.heal((regen * deltaMs) / 1000);
  }

  const totalSteps = Math.ceil((TUNING.runSeconds * 1000) / STEP_MS);
  for (let step = 0; step < totalSteps && deathS === null; step += 1) {
    simTimeMs += STEP_MS;
    director.update(STEP_MS);
    tickRegen(STEP_MS);

    for (let i = enemies.length - 1; i >= 0; i -= 1) {
      const enemy = enemies[i];
      if (enemy === undefined) continue;
      tickEnemyDistance(enemy, STEP_MS);
      tickRangedAttack(enemy);
      tickContactDamage(enemy);
      if (deathS !== null) break;
    }

    tickAutoAttack(STEP_MS);
    tickOrbs();
  }

  const survived = deathS === null;
  return {
    seed,
    lane,
    skill,
    firstUpgradeS,
    levelUps,
    kills,
    deathS,
    survived,
    hpMinPct,
    dpsBy60s: dpsBy60s.map((total, index) => {
      const bucketSeconds = index === bucketCount - 1 ? TUNING.runSeconds - index * 60 : 60;
      return total / bucketSeconds;
    }),
  };
}
