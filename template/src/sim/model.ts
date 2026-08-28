import { PLAYER_BASE_STATS, TUNING, VIEW } from '../config';
import { ENEMIES, scaleEnemy, type EnemyDef } from '../data/enemies';
import { PHASES, TIMELINE_EVENTS, WAVES } from '../data/waves';
import { rollUpgradeChoices, type UpgradeDef } from '../data/upgrades';
import { weaponBoostDamageMul, type WeaponPattern } from '../data/weapons';
import { RunDirector, type EventSpec } from '../core/run';
import { StatBlock } from '../core/stats';
import { Health, rollDamage, setDamageClock } from '../core/damage';
import { Rng } from '../core/rng';
import { createDirectorHost } from './director-host';
import { pickUpgrade, type LanePolicy } from './bots';
import type { RunMetrics } from './metrics';

/**
 * Headless balance simulator: replays a full 480s run against the REAL
 * template data (`TUNING`, `ENEMIES`, `PHASES`/`WAVES`/`TIMELINE_EVENTS` via
 * `RunDirector`, `StatBlock`, `Health`, `rollDamage`, `rollUpgradeChoices`)
 * with a scalar spatial abstraction instead of Arcade physics — there is no
 * x/y, only each enemy's straight-line `distance` to the player. That
 * abstraction is the only thing this file invents; every number that affects
 * the outcome (damage, HP, speeds, cadences, thresholds) comes from
 * `src/config.ts` and `src/data/*`, never duplicated here.
 *
 * Weapon parity: the four `data/weapons.ts` patterns are modelled with the
 * exact damage/cooldown formulas `systems/combat.ts` uses — bolt as the aimed
 * shot loop, orbit as an in-radius per-target tick, nova as a periodic
 * falloff pulse, rail as a pierce burst through the nearest cluster (a 1D
 * stand-in for "densest cluster"). Boss parity: `TUNING.boss` phases gate a
 * volley/summon-shield/enrage-ring pressure model. Scripted events
 * (chest/breather/elite-rush) run through the real `RunDirector.onEvent`.
 *
 * The constants below (`KITE_EFFECTIVENESS`, `SHOOT_STANDOFF_PX`, ...) are
 * the sim-only bot/abstraction calibration — they describe how a bot
 * *plays*, not how the game is *balanced*, and must never move into
 * `TUNING`. Some mirror hardcoded numbers baked into `objects/enemy.ts`
 * (standoff distance, charge windup/dash) because those numbers are
 * behaviour, not data.
 */

/** Fraction of the player's raw move speed a skilled bot converts into net evasion against a closing enemy. */
const KITE_EFFECTIVENESS = 0.75;
/**
 * A kiting player does not push enemies off to infinity — they hold slower
 * enemies just inside their own attack range and keep farming them (that is
 * the entire point of kiting). When evasion outruns an enemy, its distance
 * drifts back only up to `range * KITE_HOLD_RANGE_RATIO` and holds there,
 * keeping kills flowing at high skill instead of starving the run — the
 * starvation was an artifact of the collapsed dimension, not real play.
 */
const KITE_HOLD_RANGE_RATIO = 0.45;
/**
 * Skill-scaled dodge chances for AVOIDABLE damage: a slow visible projectile
 * and a telegraphed dash are what a skilled player actually dodges; plain
 * chase contact is priced by the kite model instead. `skill * factor` is the
 * probability one such hit misses.
 */
const RANGED_DODGE = 1.0;
const CHARGE_DODGE = 1.0;
/** Probability one bolt aims at a random in-range target instead of the strict nearest (2D weave reshuffle). */
const BOLT_TARGET_NOISE = 0.35;
/** Post-dash overshoot: a dash that ends (hit or miss) carries the runner past the player. */
const CHARGE_OVERSHOOT_PX = 200;
/** Mirrors `Enemy.tickAi`'s `'shoot'` case: hold this far back, fire on this cadence. */
const SHOOT_STANDOFF_PX = 320;
const SHOOT_CADENCE_MS = 1500;
/**
 * Where a shooter's standoff dance actually SETTLES, as a fraction of its
 * nominal hold distance. `objects/enemy.ts` gives a shooter `approach = -0.5`
 * inside `SHOOT_STANDOFF_PX`, so it only re-opens the gap at half its own
 * 110px/s — a player pushing in at 330px/s wins that argument and drags the
 * dance inside their own weapons, which is how shooters actually die.
 */
const STANDOFF_DRIFT = 0.8;
/**
 * Boss engagement gap: the boss body's contact reach plus this margin.
 *
 * `objects/enemy.ts` `tickBoss` wants a 380px standoff and backs off at 0.5x
 * its 90px/s move speed once the player is inside it — 45px/s of retreat
 * against a 330px/s player. The boss therefore does NOT get to pick the gap;
 * the player does, and the gap a player picks in a 30s finale is the closest
 * one that still eats no contact tick: hugging the boss body maximises how
 * many of their weapons reach it (bolt range 300, nova radius 260, a boosted
 * orbit ~204). Clamping the boss to its nominal standoff instead — as this
 * model used to — parked it outside every weapon but `rail`, which is why
 * `bossHpRemoved` measured 0-2% and the authored phase-2/phase-3 script was
 * unreachable in every run.
 */
const BOSS_ENGAGE_MARGIN_PX = 20;
/**
 * Chance per volley that the player's bolt is aimed at the boss rather than
 * the nearest body, at skill 1 and once the boss is inside bolt range.
 * `CombatSystem.tickBolt` auto-aims at the nearest enemy, but that is a
 * constraint on POSITION, not on choice: walking the crowd off the boss and
 * putting the boss in front of yourself is the entire skill expression of
 * the finale. Scaled by `skill`, so a novice's bolts keep feeding the swarm.
 */
const BOSS_FOCUS_CHANCE = 0.75;
/**
 * Boss ring geometry. `CombatSystem.bossAttack` fires BOTH boss attacks as a
 * radial ring — `shotCount` projectiles spaced evenly over 2π at 340px/s — so
 * what decides whether the player is hit is how much of that circle the shots
 * cover, not a flat per-attack coin flip.
 *
 * Per shot: the lethal corridor is the shot's hit radius (`projectileSize` 18
 * at the 1.2 scale `bossAttack` fires with, so ~11px) plus the player's own,
 * which is deliberately smaller than the 96px sprite — call it ~34px. That is
 * ~45px either side of the shot's line, and at the ~190px this fight is
 * actually fought at (see BOSS_ENGAGE_MARGIN_PX) it subtends ~26°. Trimmed to
 * 20° because the corridor is only lethal while the ring passes THROUGH the
 * player's radius, not for the whole flight.
 */
const RING_SHOT_ARC_DEG = 20;
/** Fraction of the covered arc a skill-1 player still slips out of. */
const RING_DODGE = 0.8;
/**
 * Chance one radial boss attack of `shots` projectiles connects.
 *
 * This replaced a flat `skill * 0.7` dodge on the volley and a flat `skill`
 * dodge on the ring, which priced the SPARSER pattern as the deadlier one:
 * the phase-1 volley is 5 shots (72° apart — a wall you walk through) and
 * the phase-3 ring is 14 (26° apart, plus a 500ms telegraph). Charging one
 * full 65-damage hit per volley at 37% made the 30s finale a guaranteed
 * 4-hit death for every build, which is why no lane could win the reference
 * run while the authored phase-2/phase-3 script was never seen at all.
 */
function ringHitChance(shots: number, skill: number): number {
  const covered = Math.min(1, (shots * RING_SHOT_ARC_DEG) / 360);
  return covered * (1 - skill * RING_DODGE);
}
/**
 * Mirrors `CombatSystem.enemyShoot` + `Projectile.fire`: an enemy shot
 * travels at 420px/s and expires after 1600ms, so it only ever reaches
 * ~672px — a shooter/boss well outside that range fires into nothing.
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
/** 1D stand-in for the rail's line coverage: how deep into the crowd a pierce shot reaches. */
const RAIL_RANGE_PX = 700;

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
  /** Per-target orbit-blade hit gate, mirroring `CombatSystem.bladeHitAt`. */
  orbitHitAt: number;
  /** Phase-2 boss summon, tracked so the boss shield drops when they die. */
  isBossAdd: boolean;
}

interface PendingOrb {
  readyAtMs: number;
  value: number;
}

/** One equipped weapon slot — mirrors `data/weapons.ts` `WeaponState` minus the render-only angle. */
interface SimWeapon {
  id: WeaponPattern;
  boosts: number;
  evolved: boolean;
  cooldownMs: number;
}

/**
 * Enemies spawn on the real elliptical ring `combat.ts spawn()` uses
 * (`rx = VIEW.width/2 + spawnMargin`, `ry = VIEW.height/2 + spawnMargin`) at
 * a uniformly random angle — reimplemented here as a scalar distance instead
 * of an (x, y) point. Randomising per spawn (rather than a single fixed
 * "half-diagonal" distance) desynchronizes same-wave arrivals; without it a
 * wave lands simultaneous contact hits in lockstep, an artifact of the
 * collapsed dimension.
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
  const weapons: SimWeapon[] = [{ id: 'bolt', boosts: 0, evolved: false, cooldownMs: 0 }];

  let level = 1;
  let xp = 0;
  let kills = 0;
  let levelUps = 0;
  let choiceEvents = 0;
  let choicesBy120S = 0;
  let firstUpgradeS: number | null = null;
  let deathS: number | null = null;
  let hpMinPct = 1;
  let glassCannon = false;
  let spawnSilencedUntilMs = -Infinity;
  let bossKilled = false;

  // Boss phase state (null until the boss spawns). `bossHpRemoved` is sampled
  // every tick because the fight's own state is gone once the boss dies or the
  // run ends — it is the finale's only readable outcome besides win/lose.
  let boss: SimEnemy | null = null;
  let bossPhase = 0;
  let bossHpRemoved: number | null = null;
  let bossVolleyCd = 0;
  let bossRingCd = 0;
  let bossAddsAlive = 0;

  const bucketCount = Math.ceil(TUNING.runSeconds / 60);
  const dpsBy60s = new Array<number>(bucketCount).fill(0);

  function currentBucket(elapsedMs: number): number {
    return Math.min(bucketCount - 1, Math.floor(elapsedMs / 1000 / 60));
  }

  function spawnEnemy(id: string, difficultyMul: number, atDistance: number, force = false): void {
    if (!force && simTimeMs < spawnSilencedUntilMs) return; // breather lull, mirrors `CombatSystem.silenceSpawns`.
    if (enemies.length >= TUNING.enemy.maxAlive) return;
    const def = DEFS[id];
    if (def === undefined) return;
    const scaled = scaleEnemy(def, difficultyMul);
    const enemy: SimEnemy = {
      def,
      health: new Health(scaled.maxHp),
      damage: scaled.damage,
      speed: scaled.moveSpeed,
      xp: scaled.xp,
      distance: atDistance,
      lastContactAt: -Infinity,
      stateMs: 0,
      dashMs: 0,
      orbitHitAt: -Infinity,
      isBossAdd: false,
    };
    enemies.push(enemy);
    if (def.id === 'boss' && boss === null) {
      boss = enemy;
      bossPhase = 1;
      bossHpRemoved = 0;
      bossVolleyCd = TUNING.boss.volleyCooldownMs;
      bossRingCd = TUNING.boss.ringCooldownMs;
    }
  }

  const director = new RunDirector(
    createDirectorHost(),
    WAVES,
    PHASES,
    (id) => spawnEnemy(id, director.difficulty, spawnDistance(rng)),
    {
      durationSeconds: TUNING.runSeconds,
      events: TIMELINE_EVENTS,
      onEvent: (event: EventSpec) => onScriptedEvent(event),
    },
  );

  /** Mirrors `GameScene.onScriptedEvent`. */
  function onScriptedEvent(event: EventSpec): void {
    switch (event.kind) {
      case 'chest':
        resolveDraft(simTimeMs / 1000); // bonus draft, no level behind it
        break;
      case 'breather':
        health.heal(health.max * TUNING.events.breatherHealRatio);
        spawnSilencedUntilMs = simTimeMs + TUNING.events.breatherSilenceMs;
        break;
      case 'elite-rush':
        for (let i = 0; i < TUNING.events.eliteRushCount; i += 1) {
          spawnEnemy('elite', director.difficulty, spawnDistance(rng), true);
        }
        break;
    }
  }

  /** Applies one accepted upgrade card, mirroring `GameScene.applyUpgrade` (stats, weapon slots, effect hooks). */
  function acceptCard(card: UpgradeDef): void {
    taken.push(card.id);
    if (card.kind === 'weapon-unlock' && card.weapon !== undefined) {
      weapons.push({ id: card.weapon, boosts: 0, evolved: false, cooldownMs: 0 });
      return;
    }
    if (card.kind === 'weapon-boost' && card.weapon !== undefined) {
      const weapon = weapons.find((w) => w.id === card.weapon);
      if (weapon !== undefined) {
        weapon.boosts += 1;
        if (weapon.boosts >= TUNING.weapons.maxBoosts) weapon.evolved = true;
      }
      return;
    }
    for (const mod of card.modifiers) {
      stats.addModifier({ ...mod, source: `card:${card.id}:${taken.length}` });
      if (mod.stat === 'maxHp') health.setMax(stats.get('maxHp'), true);
    }
    if (card.effect === 'glass-cannon') {
      glassCannon = true;
      health.capRatio = TUNING.effects.glassCannon.hpCapRatio;
      health.heal(0); // clamp current hp down to the new cap, like `core/effects.ts`
    }
    // 'bulwark' is fully covered by its stat modifiers here: knockback has no
    // 1D analogue (it buys contact relief the model prices into i-frames).
  }

  /** One draft: the bot picks among the real offered cards per its lane policy. */
  function resolveDraft(elapsedS: number): void {
    const choices = rollUpgradeChoices(rng, taken, TUNING.draft.choices, {
      ownedWeapons: weapons.map((w) => w.id),
      hasFreeWeaponSlot: weapons.length < TUNING.weapons.maxSlots,
    });
    if (choices.length === 0) return;
    choiceEvents += 1;
    if (simTimeMs <= 120_000) choicesBy120S += 1;
    const choice = pickUpgrade(lane, choices, rng, health.ratio);
    acceptCard(choice);
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
  function damagePlayer(amount: number, dbgSource = 'contact'): void {
    const before = health.hp;
    const died = health.apply({ amount, crit: false, source: 'enemy' });
    if (health.hp === before && !died) return; // i-frames swallowed the hit.
    if (process.env.SIM_DEBUG === '1') {
      console.error(`t=${(simTimeMs / 1000).toFixed(1)} ${dbgSource} -${amount.toFixed(1)} hp=${health.hp.toFixed(1)}`);
    }
    hpMinPct = Math.min(hpMinPct, health.ratio);
    if (died && deathS === null) deathS = simTimeMs / 1000;
  }

  function killEnemy(enemy: SimEnemy, index: number): void {
    kills += 1;
    if (glassCannon) health.grantIframes(TUNING.effects.glassCannon.killIframesMs);
    if (enemy.isBossAdd && bossAddsAlive > 0) bossAddsAlive -= 1;
    if (enemy === boss) {
      boss = null;
      bossKilled = true; // boss kill = immediate win, mirrors `GameScene.finish(true)`
      bossHpRemoved = 1;
    }
    const dropDistance = enemy.distance;
    const delayS =
      Math.max(0, dropDistance - stats.get('pickupRadius')) / (TUNING.xp.orbSpeed * TUNING.xp.driftFactor);
    pendingOrbs.push({ readyAtMs: simTimeMs + delayS * 1000, value: enemy.xp });
    const last = enemies.pop();
    if (last !== undefined && index < enemies.length) enemies[index] = last;
    if (enemy.def.splitInto !== undefined) {
      for (const childId of enemy.def.splitInto) spawnEnemy(childId, director.difficulty, enemy.distance, true);
    }
  }

  /** All player damage funnels through here: boss phase-2 shield, dps buckets, kill handling. */
  function damageEnemy(enemy: SimEnemy, amount: number, crit: boolean): void {
    let dealt = amount;
    if (enemy === boss && bossPhase === 2 && bossAddsAlive > 0) {
      dealt *= TUNING.boss.shieldDamageMul; // mirrors `CombatSystem.hitEnemy`'s shielded branch
    }
    dpsBy60s[currentBucket(simTimeMs)] = (dpsBy60s[currentBucket(simTimeMs)] ?? 0) + dealt;
    const died = enemy.health.apply({ amount: dealt, crit, source: 'player' });
    if (died) {
      const index = enemies.indexOf(enemy);
      if (index >= 0) killEnemy(enemy, index);
    }
  }

  /**
   * Distance is a scalar stand-in for the real 2D chase. Kiting in a BOUNDED
   * arena is circular, not linear flight: every enemy eventually converges on
   * the player's neighbourhood no matter how fast the player is — skill
   * decides what happens inside the engagement bubble, not whether an enemy
   * ever arrives. So: outside the kite-hold band an enemy approaches at its
   * own full speed; inside it, the player's evasion (`moveSpeed * skill *
   * KITE_EFFECTIVENESS`) pushes slower enemies back out to the band edge —
   * they hover at the rim of the player's weapons and get farmed — while
   * faster enemies still push through to contact.
   */
  function tickEnemyDistance(enemy: SimEnemy, deltaMs: number): void {
    enemy.stateMs += deltaMs;
    const deltaS = deltaMs / 1000;
    const evadeSpeed = stats.get('moveSpeed') * skill * KITE_EFFECTIVENESS;
    const holdDistance = stats.get('range') * KITE_HOLD_RANGE_RATIO;

    const approach = (speed: number): void => {
      if (enemy.distance > holdDistance) {
        // Convergence: full own speed down to the band edge.
        enemy.distance = Math.max(holdDistance, enemy.distance - speed * deltaS);
        return;
      }
      const netSpeed = speed - evadeSpeed;
      if (netSpeed >= 0) enemy.distance = Math.max(0, enemy.distance - netSpeed * deltaS);
      else enemy.distance = Math.min(holdDistance, enemy.distance - netSpeed * deltaS);
    };

    switch (enemy.def.behaviour) {
      case 'chase':
      case 'split':
        approach(enemy.speed);
        break;

      case 'charge': {
        const wasDashing = enemy.dashMs > 0;
        enemy.dashMs -= deltaMs;
        if (wasDashing && enemy.dashMs <= 0) {
          // Dash ended: it carried the runner past the player (2D overshoot),
          // so the gap reopens instead of parking the runner in contact.
          enemy.distance = Math.max(enemy.distance, CHARGE_OVERSHOOT_PX);
        }
        if (enemy.dashMs <= 0 && enemy.stateMs > CHARGE_WINDUP_MS) {
          enemy.dashMs = CHARGE_DASH_MS;
          enemy.stateMs = 0;
        }
        // A dash always closes regardless of kiting (that is its job).
        if (enemy.dashMs > 0) {
          enemy.distance = Math.max(0, enemy.distance - enemy.speed * CHARGE_DASH_MUL * deltaS);
        } else {
          approach(enemy.speed * CHARGE_WINDUP_MUL);
        }
        break;
      }

      case 'shoot': {
        // The standoff dance has hysteresis and drift; the player pushing
        // toward a shooter drags the dance just inside their attack range,
        // which is how shooters actually die in the real game.
        const standoff = SHOOT_STANDOFF_PX * STANDOFF_DRIFT;
        if (enemy.distance > standoff) {
          enemy.distance = Math.max(standoff, enemy.distance - enemy.speed * deltaS);
        }
        break;
      }

      case 'orbit':
        if (enemy.distance > ORBIT_RADIUS_PX) {
          enemy.distance = Math.max(ORBIT_RADIUS_PX, enemy.distance - enemy.speed * deltaS);
        }
        break;

      case 'boss': {
        // The player closes this gap, not the boss (see BOSS_ENGAGE_MARGIN_PX):
        // the boss's crawl adds to the closing speed, the player's own
        // movement does the rest, and both stop at the engagement distance.
        const engage = contactReach(enemy) + BOSS_ENGAGE_MARGIN_PX;
        if (enemy.distance > engage) {
          const speedMul = bossPhase === 3 ? TUNING.boss.enrageSpeedMul : 1;
          enemy.distance = Math.max(engage, enemy.distance - (evadeSpeed + enemy.speed * speedMul) * deltaS);
        }
        break;
      }
    }
  }

  function tickRangedAttack(enemy: SimEnemy): void {
    if (enemy.def.behaviour !== 'shoot') return;
    if (enemy.stateMs < SHOOT_CADENCE_MS) return;
    enemy.stateMs = 0;
    if (enemy.distance > ENEMY_SHOT_MAX_RANGE_PX) return; // shot expires before reaching the player.
    // A 420px/s projectile is sidestepped by a skilled player most of the time.
    if (rng.chance(skill * RANGED_DODGE)) return;
    damagePlayer(enemy.damage, `shot:${enemy.def.id}`);
  }

  /** Boss pressure model: phase transitions + volley / summon-shield / enrage-ring, all from `TUNING.boss`. */
  function tickBoss(deltaMs: number): void {
    if (boss === null) return;
    const cfg = TUNING.boss;
    const ratio = boss.health.ratio;
    bossHpRemoved = 1 - ratio;
    if (bossPhase === 1 && ratio <= cfg.phase2At) {
      bossPhase = 2;
      const summons = rng.int(cfg.summonMin, cfg.summonMax);
      for (let i = 0; i < summons; i += 1) {
        spawnEnemy('swarm', director.difficulty, boss.distance, true);
        const added = enemies[enemies.length - 1];
        if (added !== undefined && added.def.id === 'swarm') {
          added.isBossAdd = true;
          bossAddsAlive += 1;
        }
      }
    }
    if (bossPhase === 2 && ratio <= cfg.phase3At) bossPhase = 3;

    // Phases 1-2 fire the 5-shot volley; phase 3 REPLACES it with the
    // telegraphed 14-shot ring — `Enemy.tickBoss` returns into `tickBossRing`
    // before ever reaching the volley branch once the phase flips. One ring
    // is one hit opportunity either way: i-frames make per-shot resolution
    // meaningless inside a 700ms invuln window.
    if (bossPhase < 3) {
      bossVolleyCd -= deltaMs;
      if (bossVolleyCd <= 0) {
        bossVolleyCd = cfg.volleyCooldownMs;
        if (boss.distance <= ENEMY_SHOT_MAX_RANGE_PX && rng.chance(ringHitChance(cfg.volleyShots, skill))) {
          damagePlayer(boss.damage, 'boss-volley');
        }
      }
      return;
    }

    bossRingCd -= deltaMs;
    if (bossRingCd <= 0) {
      // Telegraph then fire: the real cadence is the cooldown plus the wind-up.
      bossRingCd = cfg.ringCooldownMs + cfg.ringTelegraphMs;
      if (rng.chance(ringHitChance(cfg.ringShots, skill))) damagePlayer(boss.damage, 'boss-ring');
    }
  }

  function contactReach(enemy: SimEnemy): number {
    return (enemy.def.size + TUNING.player.size) * 0.45;
  }

  function tickContactDamage(enemy: SimEnemy): void {
    if (enemy.distance > contactReach(enemy)) return;
    if (simTimeMs - enemy.lastContactAt < TUNING.enemy.hitMs) return;
    enemy.lastContactAt = simTimeMs;
    // A telegraphed dash (0.4s windup flash + straight line) is sidestepped
    // by a skilled player; the dash then overshoots past them and the gap
    // reopens to the kite-hold band. Plain chase contact stays unavoidable —
    // the kite-hold model already priced evasion into whether it ever lands.
    if (enemy.def.behaviour === 'charge' && rng.chance(skill * CHARGE_DODGE)) {
      enemy.distance = stats.get('range') * KITE_HOLD_RANGE_RATIO;
      return;
    }
    damagePlayer(enemy.damage, `contact:${enemy.def.id}`);
  }

  /** Healer aura parity: every pulse heals every non-healer enemy inside the (1D) radius band. */
  function tickHealAura(enemy: SimEnemy): void {
    if (enemy.def.healAura !== true) return;
    if (enemy.stateMs < TUNING.enemy.healAuraIntervalMs) return;
    enemy.stateMs = 0;
    for (const other of enemies) {
      if (other === enemy || other.health.hp >= other.health.max) continue;
      // Half the 2D radius: two enemies at the same scalar distance sit on a
      // ring, not at one point — a full-radius band over-credits the aura.
      if (Math.abs(other.distance - enemy.distance) <= TUNING.enemy.healAuraRadius / 2) {
        other.health.heal(TUNING.enemy.healAuraAmount);
      }
    }
  }

  // --- Weapon ticks: formulas mirror `systems/combat.ts` -------------------

  let boltCooldownMs = 0;

  function tickBolt(weapon: SimWeapon, deltaMs: number): void {
    boltCooldownMs -= deltaMs;
    if (boltCooldownMs > 0 || enemies.length === 0) return;
    const range = stats.get('range');
    const inRange = enemies.filter((e) => e.distance <= range).sort((a, b) => a.distance - b.distance);
    if (inRange.length === 0) return;

    const attackSpeed = Math.max(0.1, stats.get('attackSpeed'));
    const boostCooldownMul = 1 - TUNING.weapons.bolt.boostCooldownMul * weapon.boosts;
    boltCooldownMs = (stats.get('attackMs') / attackSpeed) * Math.max(0.4, boostCooldownMul);

    const volleys = weapon.evolved ? 2 : 1;
    const count = Math.max(1, Math.round(stats.get('projectiles')));
    const damageMul = weaponBoostDamageMul('bolt', weapon.boosts);
    // Boss focus: the one fight where the player positions to choose the
    // target instead of letting auto-aim keep the nearest one (see
    // BOSS_FOCUS_CHANCE). Rolled per shot, so the crowd still gets fed.
    const focus =
      boss !== null && boss.distance <= range && rng.chance(skill * BOSS_FOCUS_CHANCE) ? boss : null;
    for (let v = 0; v < volleys; v += 1) {
      for (let i = 0; i < count; i += 1) {
        // 2D "nearest" reshuffles constantly as the player weaves, so the
        // back line (parked shooters, healers) does get aimed at sometimes.
        const target =
          focus ??
          (rng.chance(BOLT_TARGET_NOISE) ? rng.pick(inRange) : inRange[Math.min(v * count + i, inRange.length - 1)]);
        if (target === undefined || target.health.hp <= 0) continue;
        const roll = rollDamage(stats, rng, 'auto');
        damageEnemy(target, roll.amount * damageMul, roll.crit);
      }
    }
  }

  function tickOrbit(weapon: SimWeapon): void {
    const cfg = TUNING.weapons.orbit;
    const radius = cfg.radius * (1 + cfg.boostRadiusMul * weapon.boosts);
    const damage = stats.get('damage') * cfg.damageMul * weaponBoostDamageMul('orbit', weapon.boosts);
    for (let i = enemies.length - 1; i >= 0; i -= 1) {
      const enemy = enemies[i];
      if (enemy === undefined || enemy.distance > radius) continue;
      if (simTimeMs - enemy.orbitHitAt < cfg.hitCooldownMs) continue;
      enemy.orbitHitAt = simTimeMs;
      damageEnemy(enemy, damage, false);
    }
  }

  function tickNova(weapon: SimWeapon, deltaMs: number): void {
    const cfg = TUNING.weapons.nova;
    weapon.cooldownMs -= deltaMs;
    if (weapon.cooldownMs > 0) return;
    const boostCooldownMul = 1 - cfg.boostCooldownMul * weapon.boosts;
    weapon.cooldownMs = cfg.cooldownMs * Math.max(0.4, boostCooldownMul);
    const pulses = weapon.evolved ? 2 : 1;
    const baseDamage = stats.get('damage') * cfg.damageMul * weaponBoostDamageMul('nova', weapon.boosts);
    for (let p = 0; p < pulses; p += 1) {
      for (let i = enemies.length - 1; i >= 0; i -= 1) {
        const enemy = enemies[i];
        if (enemy === undefined || enemy.distance > cfg.radius) continue;
        const falloffAt = cfg.radius * cfg.falloffStart;
        const t =
          enemy.distance <= falloffAt ? 1 : Math.max(0, 1 - (enemy.distance - falloffAt) / (cfg.radius - falloffAt));
        if (t <= 0) continue;
        damageEnemy(enemy, baseDamage * t, false);
      }
    }
  }

  function tickRail(weapon: SimWeapon, deltaMs: number): void {
    const cfg = TUNING.weapons.rail;
    weapon.cooldownMs -= deltaMs;
    if (weapon.cooldownMs > 0 || enemies.length === 0) return;
    weapon.cooldownMs = cfg.cooldownMs;
    const pierce = cfg.pierceCount + cfg.boostPierceAdd * weapon.boosts + (weapon.evolved ? 2 : 0);
    const damage = stats.get('damage') * cfg.damageMul * weaponBoostDamageMul('rail', weapon.boosts);
    // "Through the densest cluster": the line enters the front of the crowd
    // and exits its back — in 1D, the FURTHEST targets in range are the back
    // line the rail exists to reach (parked shooters, healers behind swarms).
    const targets = enemies
      .filter((e) => e.distance <= RAIL_RANGE_PX)
      .sort((a, b) => b.distance - a.distance)
      .slice(0, pierce + 1);
    // `densestClusterCenter` aims at the enemy with the most neighbours, and
    // in the finale that is a 280px boss wearing a crowd — the line goes
    // through it whether or not it is the deepest body in range.
    if (boss !== null && boss.distance <= RAIL_RANGE_PX && !targets.includes(boss)) targets[0] = boss;
    for (const target of targets) damageEnemy(target, damage, false);
  }

  function tickWeapons(deltaMs: number): void {
    for (const weapon of weapons) {
      switch (weapon.id) {
        case 'bolt':
          tickBolt(weapon, deltaMs);
          break;
        case 'orbit':
          tickOrbit(weapon);
          break;
        case 'nova':
          tickNova(weapon, deltaMs);
          break;
        case 'rail':
          tickRail(weapon, deltaMs);
          break;
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
  let steps = 0;
  for (; steps < totalSteps && deathS === null && !bossKilled; steps += 1) {
    simTimeMs += STEP_MS;
    director.update(STEP_MS);
    tickRegen(STEP_MS);

    for (let i = enemies.length - 1; i >= 0; i -= 1) {
      const enemy = enemies[i];
      if (enemy === undefined) continue;
      tickEnemyDistance(enemy, STEP_MS);
      tickRangedAttack(enemy);
      tickHealAura(enemy);
      tickContactDamage(enemy);
      if (deathS !== null) break;
    }
    tickBoss(STEP_MS);

    tickWeapons(STEP_MS);
    tickOrbs();
  }

  const survived = deathS === null;
  const endS = deathS ?? (steps * STEP_MS) / 1000;
  return {
    seed,
    lane,
    skill,
    firstUpgradeS,
    levelUps,
    choiceEvents,
    choicesBy120S,
    kills,
    deathS,
    endS,
    survived,
    hpMinPct,
    dpsBy60s: dpsBy60s.map((total, index) => {
      const bucketSeconds = index === bucketCount - 1 ? TUNING.runSeconds - index * 60 : 60;
      return total / bucketSeconds;
    }),
    bossHpRemoved,
    bossPhase,
  };
}
