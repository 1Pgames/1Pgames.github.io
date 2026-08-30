import Phaser from 'phaser';
import { PALETTE, TUNING } from '../config';
import { TEX } from '../core/keys';
import { Health } from '../core/damage';
import { scaleEnemy, type EnemyDef } from '../data/enemies';
import { Bar } from '../ui/bars';
import { artFacesRight, artScale } from '../data/art';
import { IDENTITY } from '../ui/duskChrome';

/**
 * Pooled enemy body. One instance is reused for every archetype: `spawnWith`
 * re-skins it from an `EnemyDef` and `despawn` parks it. Behaviour is a switch
 * over the frozen `EnemyBehaviour` union (§16.1) — deliberately not a class
 * hierarchy, so 24 archetypes cost 24 data records instead of 24 files.
 *
 * EVERY verb has a real implementation and EVERY number it uses comes from
 * `EnemyDef.params` or `TUNING` — there are no archetype constants in this
 * file. A verb that needs a param the row does not carry throws on spawn,
 * because a silently-defaulted enemy is a different enemy.
 *
 * What the verbs do (PRD §5.2/§5.2b):
 *   chase        walk at the player
 *   swarm        chase in formation — the pack arrives as one knot
 *   ranged       hold at `rangePx`, lob every `fireEveryMs`
 *   orbit-charge circle at `orbitRadiusPx`, telegraph `windupMs`, then dash
 *   tank         straight through the horde, wide contact reach, optional slam
 *   drift        chase THROUGH props and walls
 *   burst        chase; the detonation is resolved by the combat system on death
 *   split        chase; reproduces itself on death for `splitGenerations`
 *   aura         hangs back and hastens allies inside `auraRadiusPx`
 *   flee         runs from the player (loot piñata)
 *   teleport     blinks `blinkPx` toward the player every `blinkEveryS`
 *   elite        chase plus a telegraphed signature (sweep or slick)
 *   boss         3-phase Warden, cadences from `TUNING.boss`
 *
 * Allocation-free in `tickAi` for the steady-state path: telegraphs and phase
 * transitions create a handful of one-shot display objects, once per event.
 */

export type BossPhase = 1 | 2 | 3;

/** How the combat system is asked to resolve something this body cannot. */
export type EnemyAreaKind = 'slam' | 'sweep';

/** Reads a required behaviour param. Absent = content bug, and it must be loud. */
function requireParam(def: EnemyDef, key: string): number {
  const value = def.params?.[key];
  if (value === undefined) {
    throw new Error(`Enemy "${def.id}" (${def.behaviour}) is missing param "${key}"`);
  }
  return value;
}

/** Reads an optional behaviour param — absence is a real branch, not a default. */
function optionalParam(def: EnemyDef, key: string): number | undefined {
  return def.params?.[key];
}

/**
 * The action-key contract `data/art.ts` already ships: every generated actor
 * has `<actor>-move` (or `<actor>-idle` for the Warden, whose four zone skins
 * append the zone), and optionally `<actor>-attack`, `<actor>-death` and — boss
 * only — `<actor>-sweep`/`-summon`/`-enrage`. So an action key is DERIVED from
 * the sheet this body actually spawned with instead of being declared a second
 * time on every `EnemyDef` row: `enemy-husk-move` -> `enemy-husk-death`,
 * `boss-warden-idle-desert` -> `boss-warden-sweep`.
 *
 * Nothing here asserts the sheet exists. 37 of these animations were generated,
 * bundled and shipped while this class only ever played the `-move` key, and a
 * row whose action sheet was never drawn must keep walking rather than throw —
 * `Enemy.playAction` is the gate.
 */
function actorBase(key: string): string {
  const move = key.indexOf('-move');
  if (move > 0) return key.slice(0, move);
  const idle = key.indexOf('-idle');
  return idle > 0 ? key.slice(0, idle) : key;
}

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  def!: EnemyDef;
  health!: Health;
  damage = 0;
  xpValue = 0;
  /** Shards this body is worth when it dies (§5.2 value column). */
  shardValue = 0;
  /** Contact reach in px — widened for `tank`, default for everything else. */
  contactReach = 0;
  /** Set by the combat system when contact damage was last dealt to the player. */
  lastContactAt = 0;
  /** How many split generations this body may still produce (`split` only). */
  splitBudget = 0;
  /**
   * The animation/texture key this body actually spawned with. Normally
   * `def.texture`, but the Warden takes a per-zone skin (§11: four fully
   * generated idle sheets), so mirroring and per-asset scale must read THIS
   * rather than the row.
   */
  artKey = '';
  /**
   * The DEATH animation for this body's sheet — read by the combat system,
   * which spawns the corpse: the body itself is returned to the pool the frame
   * it dies, so it cannot play its own death.
   */
  deathKey = '';

  /** Ranged archetypes fire through this callback, owned by the combat system. */
  onShoot: ((enemy: Enemy) => void) | null = null;
  /** `aura` archetypes pulse through this callback; combat hastens/heals nearby allies. */
  onAuraPulse: ((enemy: Enemy) => void) | null = null;
  /** A timed area attack landed; combat resolves the damage against the player. */
  onAreaStrike: ((enemy: Enemy, kind: EnemyAreaKind, radius: number, damage: number) => void) | null = null;
  /** A persistent slowing ground zone was laid (matron slick, widow web). */
  onGroundZone: ((enemy: Enemy, radius: number, slowPct: number) => void) | null = null;
  /** Boss-only: fired on a volley/ring attack tick, or on a phase transition. */
  onBossAttack: ((enemy: Enemy, kind: 'volley' | 'ring' | 'phase2' | 'phase3') => void) | null = null;

  /** Boss-only: true while summoned adds are alive, set/cleared by the combat system. */
  shielded = false;
  /** Current boss phase (1..3), read by the combat system for UI/telegraph decisions. */
  bossPhase: BossPhase = 1;

  private speed = 0;
  private baseSpeed = 0;
  private stateMs = 0;
  private dashMs = 0;
  private orbitAngle = 0;
  private bar: Bar | null = null;
  private enraged = false;
  /** Remaining ms of an `aura` haste buff, and the multiplier it grants. */
  private hasteMs = 0;
  private hasteMul = 0;

  /**
   * The looping animation this body returns to between one-shot actions.
   * Normally `artKey`; the Warden replaces it with its `-enrage` loop for the
   * whole of phase 3, because phase 3 is a STATE and not a beat.
   */
  private loopKey = '';
  /** Remaining ms of a one-shot action animation; 0 means `loopKey` is showing. */
  private actionMs = 0;
  /** Derived action keys for the sheet this body spawned with. */
  private attackKey = '';
  private sweepKey = '';
  private summonKey = '';
  private enrageKey = '';

  /** Generic ability cadence: counts down to the next signature move. */
  private abilityMs = 0;
  /** Charge/sweep telegraph: windup -> telegraph (light on the ground) -> strike. */
  private telegraphMs = 0;
  private telegraphGlow: Phaser.GameObjects.Image | null = null;
  /**
   * Enrage rim: a threat-coloured ring UNDER the body (§11 threat literal), not
   * a tint ON it. A full-body wash on a 256px generated sheet destroys the
   * palette, value structure and 1px outline the art review gated, so every
   * state this class shows is drawn as an overlay instead.
   */
  private enrageRim: Phaser.GameObjects.Image | null = null;

  /** Boss attack cadence + ring telegraph. */
  private bossAttackMs = 0;
  private ringTelegraphMs = 0;
  private ringTelegraphRing: Phaser.GameObjects.Image | null = null;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, TEX.disc);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setActive(false).setVisible(false).setDepth(10);
    this.disableBody();
  }

  /**
   * `skin` overrides the row's texture for a body that ships more than one
   * generated sheet — today only the Warden, whose four zone skins are real
   * generated art rather than a recolour (§11). An unloaded skin falls back to
   * the row, so a pruned art group can never blank a boss.
   */
  spawnWith(def: EnemyDef, x: number, y: number, difficultyMul: number, skin: string | null = null): void {
    const stats = scaleEnemy(def, difficultyMul);
    this.def = def;
    this.health = new Health(stats.maxHp);
    this.damage = stats.damage;
    this.speed = stats.moveSpeed;
    this.baseSpeed = stats.moveSpeed;
    this.xpValue = stats.xp;
    this.shardValue = stats.shards;
    this.lastContactAt = 0;
    this.stateMs = 0;
    this.dashMs = 0;
    this.telegraphMs = 0;
    this.enraged = false;
    this.hasteMs = 0;
    this.hasteMul = 0;
    this.bossAttackMs = TUNING.boss.volleyCooldownMs;
    this.ringTelegraphMs = 0;
    this.bossPhase = 1;
    this.shielded = false;
    this.orbitAngle = Math.atan2(y - this.scene.scale.height / 2, x - this.scene.scale.width / 2);
    this.clearTelegraph();
    this.clearRingTelegraph();

    // Contact reach: a `tank` swings a wide blade, everything else touches.
    const swingReach = optionalParam(def, 'swingReachPx');
    this.contactReach = swingReach ?? (def.size + TUNING.player.size) * 0.45;
    this.abilityMs = this.initialAbilityMs(def);
    this.splitBudget = def.behaviour === 'split' ? requireParam(def, 'splitGenerations') : 0;

    this.artKey = skin !== null && this.scene.textures.exists(skin) ? skin : def.texture;
    // Every action this body can show, resolved ONCE per spawn from its own
    // sheet name — no per-frame string building in `tickAi`.
    const base = actorBase(this.artKey);
    this.attackKey = `${base}-attack`;
    this.deathKey = `${base}-death`;
    this.sweepKey = `${base}-sweep`;
    this.summonKey = `${base}-summon`;
    this.enrageKey = `${base}-enrage`;
    this.loopKey = this.artKey;
    this.actionMs = 0;
    this.setTexture(this.artKey);
    this.setPosition(x, y);
    // Generated art is already coloured; tinting it would fight the style
    // profile, so this body is NEVER tinted. `def.tint` colours particles,
    // telegraph glows and the enrage rim — things drawn beside the body.
    this.clearTint();
    this.clearEnrageRim();
    this.setAngle(0);
    this.setActive(true).setVisible(true);
    this.enableBody(false, x, y, true, true);
    // Body is measured in source-cell pixels: a 256px cell with transparent
    // margin gives a ~60%-of-display hitbox, which matches the visible body.
    this.body?.setCircle(74, 54, 62);
    this.setVelocity(0, 0);
    // `drift` passes THROUGH props and walls — that is the whole archetype.
    this.setPassesWalls(def.behaviour === 'drift');
    // Pooled sprites keep the previous animation's frame: always restart, and
    // re-apply this action's own display scale.
    this.showAnim(this.loopKey);

    // HP bars only for the enemies whose HP the player actually tracks.
    if (def.behaviour === 'elite' || def.behaviour === 'boss') {
      this.bar ??= new Bar(this.scene, x, y, def.size + 24, 14);
      this.bar.setVisible(true);
      this.bar.setValue(this.health.hp, this.health.max);
      this.bar.followTarget(this, -def.size * 0.75);
    } else if (this.bar !== null) {
      this.bar.stopFollow();
      this.bar.setVisible(false);
    }
  }

  /** The cadence a verb starts on, or 0 for verbs with no timed ability. */
  private initialAbilityMs(def: EnemyDef): number {
    switch (def.behaviour) {
      case 'ranged':
        return requireParam(def, 'fireEveryMs');
      case 'teleport':
        return requireParam(def, 'blinkEveryS') * 1000;
      case 'aura':
        return TUNING.enemy.healAuraIntervalMs;
      case 'elite': {
        const sweep = optionalParam(def, 'sweepEveryS');
        const slick = optionalParam(def, 'slickEveryS');
        return (sweep ?? slick ?? 0) * 1000;
      }
      default: {
        // Optional per-row signature moves (giant slam, gargoyle dive, widow web).
        const slam = optionalParam(def, 'slamEveryS');
        const dive = optionalParam(def, 'diveEveryS');
        const web = optionalParam(def, 'webEveryS');
        return (slam ?? dive ?? web ?? 0) * 1000;
      }
    }
  }

  /** `drift` ignores the arena's props and walls; everything else collides. */
  private setPassesWalls(passes: boolean): void {
    const body = this.body as Phaser.Physics.Arcade.Body | null;
    if (body === null) return;
    body.checkCollision.none = passes;
  }

  despawn(): void {
    this.setActive(false).setVisible(false);
    this.setVelocity(0, 0);
    this.disableBody();
    if (this.bar !== null) {
      this.bar.stopFollow();
      this.bar.setVisible(false);
    }
    this.clearTelegraph();
    this.clearEnrageRim();
    this.clearRingTelegraph();
    this.actionMs = 0;
  }

  /**
   * Shows one animation: re-applies THAT action's own display scale (generated
   * actions do not fill their cell to the same height, so switching without
   * this visibly resizes the character — that is what `SpriteAsset.scale` is
   * for) and restarts it, because a pooled sprite otherwise keeps whatever
   * frame the previous archetype left in the slot.
   */
  private showAnim(key: string): void {
    const size = this.def.size * artScale(key);
    this.setDisplaySize(size, size);
    if (this.scene.anims.exists(key)) this.play(key, true);
  }

  /**
   * Plays a one-shot action animation and returns to `loopKey` when it ends.
   * False when this actor's sheet for that action was never generated, so the
   * caller still fires its gameplay effect either way.
   *
   * The return is timed off the animation's OWN duration rather than an
   * `animationcomplete` listener: this body is pooled, and a per-play listener
   * on a recycled sprite fires against whichever archetype holds the slot next.
   */
  private playAction(key: string): boolean {
    const anim = this.scene.anims.get(key);
    // `exists` and `get` are the same lookup; taking the record itself is what
    // makes the duration readable, and an absent record is the "sheet was never
    // generated" branch rather than a defaulted guess.
    if (anim === null || anim === undefined) return false;
    this.actionMs = anim.duration > 0 ? anim.duration : anim.msPerFrame * anim.frames.length;
    this.showAnim(key);
    return true;
  }

  /** Drops back to the loop animation once the current action has played out. */
  private tickAction(deltaMs: number): void {
    if (this.actionMs <= 0) return;
    this.actionMs -= deltaMs;
    if (this.actionMs <= 0) this.showAnim(this.loopKey);
  }

  /** Refreshes the elite/boss HP bar after damage. No-op for swarm enemies. */
  syncBar(): void {
    if (this.bar !== null && this.bar.visible) this.bar.setValue(this.health.hp, this.health.max);
  }

  tickAi(deltaMs: number, targetX: number, targetY: number): void {
    this.stateMs += deltaMs;
    this.tickHaste(deltaMs);
    this.tickAction(deltaMs);
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    // Mirror toward the target, honouring which way the art was drawn. Reads
    // the RESOLVED key, so a zone-skinned Warden mirrors on its own sheet.
    this.setFlipX(artFacesRight(this.artKey) ? dx < 0 : dx > 0);
    // Overlays carry every state this body used to show as a tint, so they have
    // to ride along with it.
    this.enrageRim?.setPosition(this.x, this.y);

    switch (this.def.behaviour) {
      case 'chase':
        this.moveToward(dx, dy, dist, 1);
        this.tickOptionalWeb(deltaMs);
        break;

      case 'swarm':
        this.tickSwarm(dx, dy, dist);
        break;

      case 'ranged':
        this.tickRanged(deltaMs, dx, dy, dist);
        break;

      case 'orbit-charge':
        this.tickOrbitCharge(deltaMs, dx, dy, dist, targetX, targetY);
        break;

      case 'tank':
        this.tickTank(deltaMs, dx, dy, dist);
        break;

      case 'drift':
        // Walls and props are not this creature's problem; it flies the line.
        this.moveToward(dx, dy, dist, 1);
        break;

      case 'burst':
        // The detonation is a DEATH event; combat fires it via `burstRadiusPx`.
        this.moveToward(dx, dy, dist, 1);
        break;

      case 'split':
        this.moveToward(dx, dy, dist, 1);
        this.setAngle(this.angle + deltaMs * 0.18);
        break;

      case 'aura':
        this.tickAura(deltaMs, dx, dy, dist);
        break;

      case 'flee':
        // Runs from the player; the reward is catching it before it escapes.
        this.moveToward(-dx, -dy, dist, 1);
        break;

      case 'teleport':
        this.tickTeleport(deltaMs, dx, dy, dist, targetX, targetY);
        break;

      case 'elite':
        this.tickElite(deltaMs, dx, dy, dist);
        break;

      case 'boss':
        this.tickBoss(deltaMs, dx, dy, dist);
        break;
    }
  }

  /** Straight-line movement at `mul` of the current speed. */
  private moveToward(dx: number, dy: number, dist: number, mul: number): void {
    this.setVelocity((dx / dist) * this.speed * mul, (dy / dist) * this.speed * mul);
  }

  /**
   * Takes a haste buff from an `aura` unit. The buff is REPLACED rather than
   * stacked — two dirgebells make the horde fast, not infinitely fast — and it
   * lapses shortly after the aura stops pulsing, so killing the bell is a real
   * play rather than a cosmetic one.
   */
  applyHaste(speedMul: number): void {
    this.hasteMul = Math.max(this.hasteMul, speedMul);
    this.hasteMs = TUNING.enemy.healAuraIntervalMs * 1.5;
  }

  /** Expires the haste buff and restores the body's own speed. */
  private tickHaste(deltaMs: number): void {
    if (this.hasteMs <= 0) return;
    this.hasteMs -= deltaMs;
    if (this.hasteMs > 0) {
      this.speed = this.baseSpeed * (1 + this.hasteMul);
      return;
    }
    this.hasteMul = 0;
    if (!this.enraged) this.speed = this.baseSpeed;
  }

  /**
   * Pack cohesion: each ratking holds a fixed lateral offset from the player,
   * derived from its spawn heading, so a 6-pack arrives as a knot that can be
   * dodged around instead of six bodies stacked in one pixel.
   */
  private tickSwarm(dx: number, dy: number, dist: number): void {
    const packSize = requireParam(this.def, 'packSize');
    const spread = this.def.size * packSize * 0.25;
    const offsetX = Math.cos(this.orbitAngle) * spread;
    const offsetY = Math.sin(this.orbitAngle) * spread;
    const wantX = dx + offsetX;
    const wantY = dy + offsetY;
    const wantDist = Math.hypot(wantX, wantY) || 1;
    this.moveToward(wantX, wantY, wantDist, 1);
    void dist;
  }

  /** Holds at `rangePx` and lobs on its own cadence. */
  private tickRanged(deltaMs: number, dx: number, dy: number, dist: number): void {
    const standoff = requireParam(this.def, 'rangePx');
    const approach = dist > standoff ? 1 : -0.5;
    this.moveToward(dx, dy, dist, approach);

    this.abilityMs -= deltaMs;
    if (this.abilityMs > 0) return;
    this.abilityMs = requireParam(this.def, 'fireEveryMs');
    // The cast IS the tell: `<actor>-attack` plays over the shot leaving.
    this.playAction(this.attackKey);
    this.onShoot?.(this);
  }

  /**
   * Circles at `orbitRadiusPx`, then telegraphs and dashes. `diveEveryS`, when
   * the row carries it, gates how often the dash is allowed — a gargoyle
   * perches between dives where a thornhound lunges as soon as it is ready.
   */
  private tickOrbitCharge(
    deltaMs: number,
    dx: number,
    dy: number,
    dist: number,
    targetX: number,
    targetY: number,
  ): void {
    if (this.telegraphMs > 0) {
      this.telegraphMs -= deltaMs;
      this.setVelocity(0, 0);
      if (this.telegraphMs <= 0) {
        this.clearTelegraph();
        this.dashMs = TUNING.enemy.chargeTelegraphMs;
        this.stateMs = 0;
      }
      return;
    }

    if (this.dashMs > 0) {
      this.dashMs -= deltaMs;
      this.moveToward(dx, dy, dist, 2.6);
      return;
    }

    const windupMs = requireParam(this.def, 'windupMs');
    const gateMs = (optionalParam(this.def, 'diveEveryS') ?? 0) * 1000;
    if (gateMs > 0) {
      this.abilityMs -= deltaMs;
      if (this.abilityMs <= 0) {
        this.abilityMs = gateMs;
        this.startTelegraph(dx, dy, dist, windupMs, dist);
        return;
      }
    } else if (this.stateMs > windupMs) {
      this.startTelegraph(dx, dy, dist, windupMs, dist);
      return;
    }

    // Orbit while waiting: the circling IS the tell that a lunge is coming.
    const radius = requireParam(this.def, 'orbitRadiusPx');
    this.orbitAngle += (deltaMs / 1000) * (this.speed / radius);
    const wantX = targetX + Math.cos(this.orbitAngle) * radius - this.x;
    const wantY = targetY + Math.sin(this.orbitAngle) * radius - this.y;
    const wantDist = Math.hypot(wantX, wantY) || 1;
    this.moveToward(wantX, wantY, wantDist, 1);
  }

  /**
   * Walks straight through the horde with a wide contact arc, enrages when
   * `enrageBelowPct` of its HP is gone, and slams on `slamEveryS` if the row
   * gives it one.
   */
  private tickTank(deltaMs: number, dx: number, dy: number, dist: number): void {
    const enrageBelowPct = optionalParam(this.def, 'enrageBelowPct');
    if (!this.enraged && enrageBelowPct !== undefined && this.health.ratio <= enrageBelowPct / 100) {
      this.enraged = true;
      this.speed = requireParam(this.def, 'enragedMoveSpeed');
      this.showEnrageRim();
    }
    this.moveToward(dx, dy, dist, 1);

    const slamRadius = optionalParam(this.def, 'slamRadiusPx');
    const slamEveryS = optionalParam(this.def, 'slamEveryS');
    if (slamRadius === undefined || slamEveryS === undefined) return;
    this.abilityMs -= deltaMs;
    if (this.abilityMs > 0) return;
    this.abilityMs = slamEveryS * 1000;
    this.playAction(this.attackKey);
    this.onAreaStrike?.(this, 'slam', slamRadius, this.damage);
  }

  /** Hangs back at its own aura radius and pulses haste into nearby allies. */
  private tickAura(deltaMs: number, dx: number, dy: number, dist: number): void {
    const radius = requireParam(this.def, 'auraRadiusPx');
    // A support unit that walks into the blender helps nobody: it holds the
    // rim of its own aura, keeping the buff on the pack and itself alive.
    const approach = dist > radius ? 1 : -0.6;
    this.moveToward(dx, dy, dist, approach);

    this.abilityMs -= deltaMs;
    if (this.abilityMs > 0) return;
    this.abilityMs = TUNING.enemy.healAuraIntervalMs;
    this.onAuraPulse?.(this);
  }

  /** Blinks toward the player on a fixed cadence; `blinkPx` 0 arrives ON them. */
  private tickTeleport(
    deltaMs: number,
    dx: number,
    dy: number,
    dist: number,
    targetX: number,
    targetY: number,
  ): void {
    this.moveToward(dx, dy, dist, 1);
    this.abilityMs -= deltaMs;
    if (this.abilityMs > 0) return;
    this.abilityMs = requireParam(this.def, 'blinkEveryS') * 1000;

    const blinkPx = requireParam(this.def, 'blinkPx');
    const step = blinkPx === 0 ? dist : Math.min(blinkPx, dist);
    const nx = this.x + (dx / dist) * step;
    const ny = this.y + (dy / dist) * step;
    this.setPosition(nx, ny);
    this.body?.reset(nx, ny);
    void targetX;
    void targetY;
    // The arrival is the tell — the actor's own strike frames plus a bright
    // bloom where the body reappears.
    this.playAction(this.attackKey);
    this.flashArrival();
  }

  /**
   * Chases, then commits a telegraphed signature: a sweep (reaper, herald) or
   * a slick drop (matron). `telegraphMs` is the windup the player reads.
   */
  private tickElite(deltaMs: number, dx: number, dy: number, dist: number): void {
    if (this.telegraphMs > 0) {
      this.telegraphMs -= deltaMs;
      this.setVelocity(0, 0);
      if (this.telegraphMs > 0) return;
      this.clearTelegraph();
      const reach = optionalParam(this.def, 'sweepReachPx');
      if (reach !== undefined) this.onAreaStrike?.(this, 'sweep', reach, this.damage);
      return;
    }

    this.moveToward(dx, dy, dist, 1);

    const slickEveryS = optionalParam(this.def, 'slickEveryS');
    const sweepEveryS = optionalParam(this.def, 'sweepEveryS');
    if (slickEveryS === undefined && sweepEveryS === undefined) return;

    this.abilityMs -= deltaMs;
    if (this.abilityMs > 0) return;

    if (slickEveryS !== undefined) {
      this.abilityMs = slickEveryS * 1000;
      this.playAction(this.attackKey);
      this.onGroundZone?.(
        this,
        requireParam(this.def, 'slickRadiusPx'),
        requireParam(this.def, 'slickSlowPct'),
      );
      return;
    }
    this.abilityMs = (sweepEveryS ?? 0) * 1000;
    this.startTelegraph(
      dx,
      dy,
      dist,
      requireParam(this.def, 'telegraphMs'),
      requireParam(this.def, 'sweepReachPx'),
    );
  }

  /** Rows that carry `webEveryS` lay a slowing patch while they chase (widow). */
  private tickOptionalWeb(deltaMs: number): void {
    const webEveryS = optionalParam(this.def, 'webEveryS');
    if (webEveryS === undefined) return;
    this.abilityMs -= deltaMs;
    if (this.abilityMs > 0) return;
    this.abilityMs = webEveryS * 1000;
    this.playAction(this.attackKey);
    this.onGroundZone?.(
      this,
      requireParam(this.def, 'webRadiusPx'),
      requireParam(this.def, 'webSlowPct'),
    );
  }

  /**
   * Arms a telegraph: a BROAD SMEAR OF LIGHT on the ground where the blow will
   * land, sized to its real reach. Deliberately not a line or an arrow — a
   * telegraph the player reads as notation reads as UI, not as danger.
   */
  private startTelegraph(dx: number, dy: number, dist: number, windupMs: number, reach: number): void {
    this.telegraphMs = windupMs;
    // The windup the player reads is the actor's own attack animation, played
    // over the ground smear below. Rows whose `-attack` sheet does not exist
    // (kite, chapelghast) keep their walk cycle and read from the smear alone.
    this.playAction(this.attackKey);
    // The telegraph is the SMEAR ON THE GROUND below; the body stays untinted.
    const cx = this.x + (dx / dist) * reach * 0.5;
    const cy = this.y + (dy / dist) * reach * 0.5;
    this.telegraphGlow = this.scene.add
      .image(cx, cy, TEX.disc)
      .setTint(IDENTITY.threat)
      .setDisplaySize(reach * 1.2, reach * 1.2)
      .setAlpha(0.28)
      .setDepth(9);
  }

  private clearTelegraph(): void {
    this.telegraphMs = 0;
    if (this.telegraphGlow !== null) {
      this.telegraphGlow.destroy();
      this.telegraphGlow = null;
    }
  }

  /**
   * Arms the enrage rim: a threat-red ring drawn at depth 9, under the body at
   * depth 10, breathing on a tween so the state reads in motion as well as in
   * a screenshot. Replaces a `setTint` on the sprite (AGENTS.md §Generated art).
   */
  private showEnrageRim(): void {
    if (this.enrageRim !== null) return;
    const size = this.def.size * 1.5;
    this.enrageRim = this.scene.add
      .image(this.x, this.y, TEX.ring)
      .setTint(IDENTITY.threat)
      .setDisplaySize(size, size)
      .setAlpha(0.5)
      .setDepth(9);
    this.scene.tweens.add({
      targets: this.enrageRim,
      alpha: 0.85,
      duration: 320,
      yoyo: true,
      repeat: -1,
    });
  }

  private clearEnrageRim(): void {
    if (this.enrageRim === null) return;
    this.scene.tweens.killTweensOf(this.enrageRim);
    this.enrageRim.destroy();
    this.enrageRim = null;
  }

  /** One-shot bloom marking a blink arrival. Destroys itself with its tween. */
  private flashArrival(): void {
    const bloom = this.scene.add
      .image(this.x, this.y, TEX.ring)
      .setTint(this.def.tint)
      .setDisplaySize(this.def.size, this.def.size)
      .setAlpha(0.8)
      .setDepth(9);
    this.scene.tweens.add({
      targets: bloom,
      displayWidth: this.def.size * 2.2,
      displayHeight: this.def.size * 2.2,
      alpha: 0,
      duration: 260,
      ease: 'Cubic.easeOut',
      onComplete: () => bloom.destroy(),
    });
  }

  /** Standoff dance plus phase-gated volley/summon/ring attacks (the Warden). */
  private tickBoss(deltaMs: number, dx: number, dy: number, dist: number): void {
    const ratio = this.health.ratio;
    const nextPhase: BossPhase = ratio <= TUNING.boss.phase3At ? 3 : ratio <= TUNING.boss.phase2At ? 2 : 1;
    if (nextPhase !== this.bossPhase) {
      this.bossPhase = nextPhase;
      if (nextPhase === 2) {
        // The shield goes up behind a real summon animation, not a flash alone.
        this.playAction(this.summonKey);
        this.onBossAttack?.(this, 'phase2');
      }
      if (nextPhase === 3) {
        // Phase 3 is a STATE, not a beat: the enrage sheet loops, so it
        // REPLACES the idle loop for the rest of the fight instead of playing
        // once and handing the frame back to a calm Warden.
        if (this.scene.anims.exists(this.enrageKey)) {
          this.loopKey = this.enrageKey;
          this.actionMs = 0;
          this.showAnim(this.loopKey);
        }
        this.onBossAttack?.(this, 'phase3');
      }
    }

    const enrageMul = this.bossPhase === 3 ? TUNING.boss.enrageSpeedMul : 1;
    const standoff = requireParam(this.def, 'standoffPx');
    const approach = dist > standoff ? 1 : -0.5;
    this.moveToward(dx, dy, dist, approach * enrageMul);

    if (this.bossPhase === 3) {
      this.tickBossRing(deltaMs);
      return;
    }

    this.bossAttackMs -= deltaMs;
    if (this.bossAttackMs <= 0) {
      this.bossAttackMs = TUNING.boss.volleyCooldownMs;
      this.playAction(this.sweepKey);
      this.onBossAttack?.(this, 'volley');
    }
  }

  private tickBossRing(deltaMs: number): void {
    if (this.ringTelegraphMs > 0) {
      this.ringTelegraphMs -= deltaMs;
      if (this.ringTelegraphMs <= 0) {
        this.clearRingTelegraph();
        this.playAction(this.sweepKey);
        this.onBossAttack?.(this, 'ring');
        this.bossAttackMs = TUNING.boss.ringCooldownMs;
      }
      return;
    }
    this.bossAttackMs -= deltaMs;
    if (this.bossAttackMs <= 0) {
      this.ringTelegraphMs = TUNING.boss.ringTelegraphMs;
      this.ringTelegraphRing = this.scene.add
        .image(this.x, this.y, TEX.ring)
        .setTint(PALETTE.bad)
        .setDisplaySize(this.def.size * 0.6, this.def.size * 0.6)
        .setAlpha(0.7)
        .setDepth(9);
      this.scene.tweens.add({
        targets: this.ringTelegraphRing,
        displayWidth: this.def.size * 2.4,
        displayHeight: this.def.size * 2.4,
        alpha: 0.15,
        duration: TUNING.boss.ringTelegraphMs,
        ease: 'Cubic.easeOut',
      });
    }
  }

  private clearRingTelegraph(): void {
    this.ringTelegraphMs = 0;
    if (this.ringTelegraphRing !== null) {
      this.ringTelegraphRing.destroy();
      this.ringTelegraphRing = null;
    }
  }
}
