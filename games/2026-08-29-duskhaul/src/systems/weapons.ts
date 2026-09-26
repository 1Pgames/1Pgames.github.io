import type Phaser from 'phaser';
import { TUNING } from '../config';
import { TEX } from '../core/keys';
import { sfx } from '../core/audio';
import { WEAPON_VOICE, WEAPON_VOICE_OPTS } from '../data/audio';
import type { Rng } from '../core/rng';
import { Pool } from '../core/pool';
import type { Player } from '../objects/player';
import type { Enemy } from '../objects/enemy';
import type { Health } from '../core/damage';
import { FxSprite, HERO_FX } from '../objects/blade';
import { Projectile } from '../objects/projectile';
import { charmRankMods, gloamStepCooldownMs } from '../data/charms';
import { classDef } from '../data/classes';
import {
  WEAPON_MAX_RANK,
  createWeaponState,
  evolutionReady,
  uniqueRiders,
  weaponDef,
  weaponRank,
  weaponStats,
  type WeaponState,
  type UniqueRiders,
  type WeaponStats,
} from '../data/weapons';
import type {
  CharmId,
  CharmSlotView,
  DraftContext,
  RunLoadoutV2,
  WeaponId,
  WeaponsView,
} from '../data/types-v2';

/**
 * Every hero weapon pattern, the charm slots and Gloam Step (PRD-V2 §5.8-5.9,
 * §16.1 E10/E11). `CombatSystem` implements `WeaponHost` and owns everything
 * that is not a weapon: enemies, the broad-phase hash, the projectile pool and
 * damage resolution.
 *
 * Numbers come from `data/weapons.ts weaponStats` (shared with the sim) and
 * are scaled here by player stats: `damageMul`/`critChance`/`critMul` per hit,
 * `area` for every radius/length, `cooldownMul` for cadence, `durationMul` for
 * pools/breath/DoTs, `projectileBonus` for bolt/skull/sickle/spears counts.
 *
 * Status riders (DoT, slow, root) are tracked here per enemy body and applied
 * AFTER the enemy AI tick: `update` must run after `CombatSystem.tickEnemies`
 * in the same frame (slow/root scale the velocity the AI just set).
 *
 * Performance: pooled visuals, scratch buffers, one shared Graphics for
 * procedural shapes; no allocation in `update` beyond first-use pool growth.
 */

/** What a weapon may ask of the combat core (§16.1 E11). */
export interface WeaponHost {
  scene: Phaser.Scene;
  player: Player;
  /** Nearest enemy within `max` of (x, y), or null. */
  nearestEnemy(x: number, y: number, max: number): Enemy | null;
  /** Broad-phase candidates around (x, y) into `out` (cleared first); returns the count. Callers filter by exact distance where it matters. */
  enemiesInRadius(x: number, y: number, r: number, out: Enemy[]): number;
  /** Position of the enemy with the most neighbours within `r` into `out`; false when no enemy is alive. */
  densestPoint(x: number, y: number, r: number, out: { x: number; y: number }): boolean;
  damageEnemy(e: Enemy, amount: number, crit: boolean, source: WeaponId): void;
  hitBreakables(x: number, y: number, r: number): void;
  rng: Rng;
  /** Friendly projectile into the combat shot pool. */
  fireShot(x: number, y: number, vx: number, vy: number, damage: number, crit: boolean, area: number, pierce?: number): void;
  /** A targeted auto-attack fired (bolt) — the scene's attack beat. */
  onPlayerAttack(x: number, y: number): void;
  /** Nav-blocked or outside the arena (disc reflection, urn hops). */
  isBlocked(x: number, y: number): boolean;
  /** Heals the hero; returns hp actually restored (Marrow Siphon, Pall of the Dead). */
  healPlayer(amount: number, source: WeaponId): number;
  /** Summons one allied thrall (objects/thrall.ts, WS-Actors); false at the alive cap or with no free ground. */
  spawnThrall(spec: ThrallSpec): boolean;
  thrallCount(): number;
  clearThralls(): void;
}

/** One Husk Thrall (§5.8b.1), consumed by `CombatSystem.spawnThrall` / `objects/thrall.ts`. */
export interface ThrallSpec {
  hp: number;
  speed: number;
  /** Damage per bite, already scaled by the hero's `damageMul`. */
  bite: number;
  biteMs: number;
  /** `Infinity` = permanent (Legion of the Hollow). */
  lifeMs: number;
  bodyRadius: number;
  evolved: boolean;
  /** Fired where the thrall died (hp or life end). */
  onDeath?: (x: number, y: number) => void;
}

/** The weapon inputs a run needs. A full `RunLoadoutV2` satisfies it. */
export type WeaponLoadout = Pick<RunLoadoutV2, 'startWeapon' | 'unlockedWeapons' | 'unlockedCharms' | 'uniques' | 'classId'>;

/** Neighbourhood radius for densest-cluster targeting (rail, Gallows Forest). */
const CLUSTER_RADIUS = 140;
/** Orbit blade / skull / sickle contact radius before `area`. */
const BLADE_HIT_R = 40;
/** Bone Halo blade display size (art cell 96). */
const ORBIT_BLADE_PX = 72;
const SKULL_HIT_R = 34;
const SICKLE_HIT_R = 48;
/** Rail beam half-width before `area`. */
const BEAM_HALF_W = 26;
/** Orbit angular speed (rad/s). */
const ORBIT_RAD_PER_S = 2.2;
/** Status/pool damage cadence. */
const TICK_MS = 250;
/** How long a skull hunts before fizzling; how long one sickle flight lasts. */
const SKULL_LIFE_MS = 3200;
const SICKLE_FLIGHT_MS = 1000;
/** Slow granted by standing in an evolved censer pool is refreshed this long per tick. */
const POOL_SLOW_MS = TICK_MS * 2;
const FX_DEPTH = 15;
/** Ossuary Disc max flight before fizzling (or returning when evolved); urn hop time/arc; bone shard speed. */
const DISC_MAX_TRAVEL = 1400;
const URN_HOP_MS = 420;
const URN_ARC_PX = 60;
const SHARD_SPEED = 900;
/** Weapon-fx lifetimes (one-shot art holds its last frame until faded out). */
const NOVA_FX_MS = 320;
const SCYTHE_FX_MS = 240;
const RAIL_FX_MS = 240;
const HEX_FX_MS = 260;
/** Hex chain-link art thickness on screen. */
const HEX_LINK_PX = 44;
/** Burst art frames barely grow, so the display scale does: from 55% to full over the first 45% of life (ease-out). */
const GROW_FROM = 0.55;
const GROW_SHARE = 0.45;
/**
 * Nova art is an ellipse (3/4 camera): `rim` is its horizontal radius, matched to
 * the round hit radius; the shorter vertical rim reads as perspective.
 * Measured weapon-fx-v1 geometry (ArtWeaponFx, art/briefs/v3-weaponfx/measure.py).
 * Rings/crescents: `origin` = circle centre as cell fractions, `rim` = outer
 * radius as a fraction of the cell side. Strips: opaque x-span `[start, end]`
 * of a +x-pointing strip, so the visible part runs exactly source → target.
 */
const ART_GEOM: Record<string, { originX: number; originY: number; rim: number }> = {
  'wpn-nova': { originX: 0.5, originY: 0.5, rim: 0.43 },
  'wpn-nova-evo': { originX: 0.5, originY: 0.5, rim: 0.43 },
  'wpn-scythe': { originX: 0.36, originY: 0.5, rim: 0.41 },
  'wpn-scythe-evo': { originX: 0.5, originY: 0.5, rim: 0.41 },
  // weapon-fx-v2 (measured: horizontal opaque span 0.07-0.93 of the cell on the widest frame ⇒ rim 0.43).
  'wpn-aura': { originX: 0.5, originY: 0.5, rim: 0.43 },
  'wpn-aura-evo': { originX: 0.5, originY: 0.5, rim: 0.43 },
  'wpn-wake': { originX: 0.5, originY: 0.5, rim: 0.43 },
  'wpn-wake-evo': { originX: 0.5, originY: 0.5, rim: 0.43 },
  'wpn-snares-blast': { originX: 0.5, originY: 0.5, rim: 0.43 },
  'wpn-snares-blast-evo': { originX: 0.5, originY: 0.5, rim: 0.43 },
  'wpn-bombs-blast': { originX: 0.5, originY: 0.5, rim: 0.43 },
  'wpn-bombs-blast-evo': { originX: 0.5, originY: 0.5, rim: 0.43 },
  'wpn-totem-pulse': { originX: 0.5, originY: 0.5, rim: 0.43 },
  'wpn-totem-pulse-evo': { originX: 0.5, originY: 0.5, rim: 0.43 },
};
const STRIP_SPAN: Record<string, readonly [number, number]> = {
  'wpn-rail': [0.07, 0.93],
  'wpn-rail-evo': [0.156, 0.844],
  'wpn-hex': [0.168, 0.84],
  'wpn-hex-evo': [0.164, 0.84],
};
/** Hero fx within this distance of the hero are dimmed so they never bury the body (critic v2d M2). */
const NEAR_HERO_PX = 120;
const NEAR_HERO_ALPHA = 0.5;
/**
 * Procedural ground fields (Pyre Shroud's r 320 burn field has no art): a
 * faint tint only. Measured live at 0.3 the violet disc filled the whole
 * play view for 3 s and buried hero and enemies alike.
 */
const PROC_ZONE_ALPHA = 0.1;

/** Transient procedural shape drawn on the shared Graphics. */
interface Shape {
  kind: 'arc' | 'beam' | 'chain' | 'ring';
  x: number;
  y: number;
  /** arc: facing; beam: end x; rect: width. */
  a: number;
  /** arc: half-angle; beam: end y; rect: height. */
  b: number;
  /** arc/ring: radius; beam: width. */
  r: number;
  color: number;
  lifeMs: number;
  maxMs: number;
  pts: number[];
}

interface TimedFx {
  sprite: FxSprite;
  lifeMs: number;
  maxMs: number;
  fade: boolean;
  /** Full display size; `grow` expands from `GROW_FROM` × this over the first `GROW_SHARE` of life. */
  w: number;
  h: number;
  grow: boolean;
  /** Art with a hollow centre (rings, crescents, beams) anchored on the hero: skip the near-hero dim. */
  undimmed: boolean;
}

interface Skull {
  sprite: FxSprite;
  x: number;
  y: number;
  angle: number;
  lifeMs: number;
  damage: number;
  speed: number;
  turn: number;
  splashR: number;
  splashMul: number;
}

interface Sickle {
  sprite: FxSprite;
  angle: number;
  tMs: number;
  outPx: number;
  damage: number;
  spiral: boolean;
  hit: Set<Enemy>;
}

interface Zone {
  sprite: FxSprite;
  x: number;
  y: number;
  r: number;
  dps: number;
  lifeMs: number;
  maxMs: number;
  tickMs: number;
  slowPct: number;
  source: WeaponId;
}

/** Straight/ricochet mover: Ossuary Disc, and Ossuary Barrage bone shards (`bounces` 0). */
interface Disc {
  sprite: FxSprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  bouncesLeft: number;
  /** Remaining travel before fizzling. */
  travelLeft: number;
  returning: boolean;
  evolved: boolean;
  hitR: number;
  hit: Set<Enemy>;
  source: WeaponId;
}

interface Snare {
  sprite: FxSprite;
  x: number;
  y: number;
  armMs: number;
  /** Set by a chained blast: detonate this frame. */
  chained: boolean;
}

interface Urn {
  sprite: FxSprite;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  tMs: number;
  hopsLeft: number;
  dirX: number;
  dirY: number;
}

interface Totem {
  sprite: FxSprite;
  x: number;
  y: number;
  lifeMs: number;
  pulseMs: number;
}

interface Spike {
  x: number;
  y: number;
  r: number;
  damage: number;
  rootMs: number;
  delayMs: number;
  evolved: boolean;
}

interface Status {
  health: Health;
  dotDps: number;
  dotLeftMs: number;
  dotSource: WeaponId;
  tickMs: number;
  slowPct: number;
  slowLeftMs: number;
  rootLeftMs: number;
}

interface CharmSlot {
  id: CharmId;
  rank: number;
}

export class WeaponSystem {
  private readonly host: WeaponHost;
  private readonly loadout: WeaponLoadout;
  /** Weapon riders from equipped uniques, folded once per run. */
  private readonly riders: UniqueRiders;
  /** Ashwitch Kindling (`burnDurationMul`): every hero DoT and burn field lasts this much longer. */
  private readonly dotMsMul: number;
  private readonly weapons: WeaponState[] = [];
  /** Resolved `weaponStats` per equipped weapon; refreshed on equip/boost/evolve. */
  private readonly resolved = new Map<WeaponId, WeaponStats>();
  private readonly charms: CharmSlot[] = [];

  /** Bone Halo blades: pooled fx sprites (`wpn-orbit` art, tangent-rotated). */
  private readonly blades: FxSprite[] = [];
  private readonly bladeHitAt = new Map<Enemy, number>();
  private readonly fxPool: Pool<FxSprite>;
  private readonly timedFx: TimedFx[] = [];
  private readonly timedFxFree: TimedFx[] = [];
  private readonly shapes: Shape[] = [];
  private readonly shapeFree: Shape[] = [];
  private readonly skulls: Skull[] = [];
  private readonly skullFree: Skull[] = [];
  private readonly sickles: Sickle[] = [];
  private readonly sickleFree: Sickle[] = [];
  private readonly zones: Zone[] = [];
  private readonly zoneFree: Zone[] = [];
  private readonly spikes: Spike[] = [];
  private readonly spikeFree: Spike[] = [];
  private readonly discs: Disc[] = [];
  private readonly snares: Snare[] = [];
  private readonly urns: Urn[] = [];
  private readonly totems: Totem[] = [];
  /** Marrow Siphon: tethered bodies (≤ count) and their beam sprites (same index). */
  private readonly tethers: Enemy[] = [];
  private readonly tetherFx: FxSprite[] = [];
  private tetherTickMs = 0;
  /** Mourning Pall: the persistent field sprite under the hero. */
  private auraFx: FxSprite | null = null;
  /** Gloam Wake: last segment drop point. */
  private wakeX = Number.NaN;
  private wakeY = Number.NaN;
  /** Rolling 1 s heal budget (siphon evo / pall evo caps). */
  private healWindowMs = 0;
  private healedInWindow = 0;
  /** Legion of the Hollow respawn timers (ms left each). */
  private readonly thrallRespawns: number[] = [];
  private readonly statuses = new Map<Enemy, Status>();
  private readonly statusFree: Status[] = [];
  private readonly graphics: Phaser.GameObjects.Graphics;

  /** Scratch buffers reused by every query — never reallocated. */
  private readonly near: Enemy[] = [];
  private readonly near2: Enemy[] = [];
  private readonly chainHit = new Set<Enemy>();
  private readonly cluster = { x: 0, y: 0 };

  /** Weapon clock (ms of unpaused `update`), drives hit cooldowns. */
  private nowMs = 0;
  private faceX = 1;
  private faceY = 0;
  /** Pyre Breath: remaining active ms, tick accumulator, following sprite. */
  private breathLeftMs = 0;
  private breathTickMs = 0;
  private breathAngle = 0;
  private breathFx: FxSprite | null = null;
  /** Gloam Step cooldown left (ms). */
  private gloamCdMs = 0;
  /** How long each weapon has been evolution-eligible without an evolution (§5.8 fallback). */
  private readonly eligibleMs = new Map<WeaponId, number>();
  /** Cached `evolutionReady` result; recomputed whenever a rank or charm changes. */
  private ready: WeaponId[] = [];

  constructor(host: WeaponHost, loadout: WeaponLoadout) {
    this.host = host;
    this.loadout = loadout;
    this.riders = uniqueRiders(loadout.uniques);
    this.dotMsMul = classDef(loadout.classId).passiveParams.burnDurationMul ?? 1;
    this.fxPool = new Pool<FxSprite>(() => new FxSprite(host.scene), (f) => f.despawn(), 16);
    this.graphics = host.scene.add.graphics().setDepth(FX_DEPTH);
    // Static render choice survives scene restarts: reset per run before the start weapon equips.
    Projectile.heroArt = weaponDef('bolt').fx;
    this.equip(loadout.startWeapon);
  }

  // ───────────── slots ─────────────

  /** Equipped weapons in slot order (start weapon first). */
  equipped(): readonly WeaponState[] {
    return this.weapons;
  }

  has(id: WeaponId): boolean {
    return this.weapons.some((w) => w.id === id);
  }

  hasFreeSlot(): boolean {
    return this.weapons.length < TUNING.weapons.maxSlots;
  }

  /** Adds a weapon to a free slot. False if already owned or no slot free. */
  equip(id: WeaponId): boolean {
    if (this.has(id) || !this.hasFreeSlot()) return false;
    this.weapons.push(createWeaponState(id));
    this.refresh(id);
    return true;
  }

  /** +1 rank (max `WEAPON_MAX_RANK`). Evolution is a separate step (§5.8). */
  boost(id: WeaponId): void {
    const weapon = this.weapons.find((w) => w.id === id);
    if (weapon === undefined || weapon.evolved || weaponRank(weapon.boosts) >= WEAPON_MAX_RANK) return;
    weapon.boosts += 1;
    this.refresh(id);
  }

  /** Evolves `id` when it is eligible (rank max + partner charm); no-op otherwise. */
  evolve(id: WeaponId): void {
    if (!this.evolutionEligible().includes(id)) return;
    const weapon = this.weapons.find((w) => w.id === id);
    if (weapon === undefined) return;
    weapon.evolved = true;
    this.eligibleMs.delete(id);
    this.refresh(id);
  }

  /** Elite/Boss Chest delivery: evolves the first eligible weapon (slot order) and returns it, or null. */
  evolveNext(): WeaponId | null {
    const id = this.evolutionEligible()[0];
    if (id === undefined) return null;
    this.evolve(id);
    return id;
  }

  equipCharm(id: CharmId): boolean {
    if (this.charms.length >= TUNING.charms.maxSlots || this.charms.some((c) => c.id === id)) return false;
    this.charms.push({ id, rank: 1 });
    this.applyCharmRank(id, 1);
    return true;
  }

  rankCharm(id: CharmId): void {
    const charm = this.charms.find((c) => c.id === id);
    if (charm === undefined || charm.rank >= TUNING.charms.maxRank) return;
    charm.rank += 1;
    this.applyCharmRank(id, charm.rank);
  }

  /** Weapons at max rank whose partner charm is owned (§5.8), slot order. */
  evolutionEligible(): WeaponId[] {
    return [...this.ready];
  }

  state(): WeaponsView {
    const rank = this.charms.find((c) => c.id === 'c_step')?.rank;
    return {
      weapons: this.slotViews(),
      charms: this.charms.map((c): CharmSlotView => ({ id: c.id, rank: c.rank })),
      maxWeapons: TUNING.weapons.maxSlots,
      maxCharms: TUNING.charms.maxSlots,
      maxRank: WEAPON_MAX_RANK,
      maxCharmRank: TUNING.charms.maxRank,
      evolutionEligible: this.evolutionEligible(),
      gloamStepCdMs: rank === undefined ? null : Math.max(0, this.gloamCdMs),
    };
  }

  /**
   * The view the draft must see (§5.8 delivery): identical to `state()` except
   * `evolutionEligible` lists only evolutions that went `evolution.fallbackS`
   * without a chest delivering them — those enter (and are forced into) the draft.
   */
  draftView(): WeaponsView {
    const view = this.state();
    const dueMs = TUNING.evolution.fallbackS * 1000;
    return { ...view, evolutionEligible: view.evolutionEligible.filter((id) => (this.eligibleMs.get(id) ?? 0) >= dueMs) };
  }

  /** §16.1 E12 context for `rollUpgradeChoices`, built from `draftView()` and the loadout's unlock lists. */
  draftContext(taken: readonly string[], banished: readonly string[]): DraftContext {
    return {
      taken,
      weapons: this.draftView(),
      unlockedWeapons: this.loadout.unlockedWeapons,
      unlockedCharms: this.loadout.unlockedCharms,
      banished,
    };
  }

  /**
   * Gloam Step (§5.9 c_step): call on every enemy contact hit BEFORE applying
   * damage. With the charm owned and its cooldown ready, the hero dashes
   * `charms.gloamStep.dashPx` away from (fromX, fromY) with `iframesMs` of
   * grace and this returns true — the caller skips that contact hit.
   */
  onPlayerContact(fromX: number, fromY: number): boolean {
    const charm = this.charms.find((c) => c.id === 'c_step');
    if (charm === undefined || this.gloamCdMs > 0) return false;
    const cfg = TUNING.charms.gloamStep;
    const player = this.host.player;
    let dx = player.x - fromX;
    let dy = player.y - fromY;
    let len = Math.hypot(dx, dy);
    if (len < 1) {
      dx = -this.faceX;
      dy = -this.faceY;
      len = 1;
    }
    const bounds = this.host.scene.physics.world.bounds;
    const pad = TUNING.player.bodyRadius;
    const tx = Math.min(bounds.right - pad, Math.max(bounds.x + pad, player.x + (dx / len) * cfg.dashPx));
    const ty = Math.min(bounds.bottom - pad, Math.max(bounds.y + pad, player.y + (dy / len) * cfg.dashPx));

    const ghost = this.fxPool.obtain();
    ghost.show(null, player.texture.key, HERO_FX.gloam, player.x, player.y, player.displayWidth, player.displayHeight, 19);
    ghost.setFrame(player.frame.name).setFlipX(player.flipX).setAlpha(0.45);
    ghost.peakAlpha = 0.45;
    this.addTimedFx(ghost, 260, true);
    this.addShape('beam', player.x, player.y, tx, ty, 18, HERO_FX.gloam, 200);

    const body = player.body as Phaser.Physics.Arcade.Body | null;
    if (body !== null) body.reset(tx, ty);
    else player.setPosition(tx, ty);
    player.health.grantIframes(cfg.iframesMs);
    this.gloamCdMs = Math.max(0, gloamStepCooldownMs(charm.rank) - this.riders.stepCdMs);
    sfx('whoosh', { volume: 0.5 });
    return true;
  }

  update(deltaMs: number): void {
    this.nowMs += deltaMs;
    if (this.gloamCdMs > 0) this.gloamCdMs -= deltaMs;
    this.trackFacing();
    this.tickEligibility(deltaMs);

    for (const weapon of this.weapons) {
      const s = this.resolved.get(weapon.id);
      if (s === undefined) continue;
      if (weapon.id === 'orbit') {
        this.tickOrbit(weapon, s, deltaMs);
        continue;
      }
      if (weapon.id === 'wake') {
        this.tickWake(weapon, s);
        continue;
      }
      if (weapon.id === 'siphon') {
        this.tickSiphon(weapon, s, deltaMs);
        continue;
      }
      if (weapon.id === 'aura') this.followAura(weapon, s);
      if (weapon.id === 'breath') this.tickBreathActive(weapon, s, deltaMs);
      weapon.cooldownMs -= deltaMs;
      if (weapon.cooldownMs > 0) continue;
      if (this.fire(weapon, s)) {
        weapon.cooldownMs = s.cooldownMs * this.cooldownMul;
        sfx(WEAPON_VOICE[weapon.id], WEAPON_VOICE_OPTS);
      }
      else weapon.cooldownMs = 0;
    }

    this.tickSkulls(deltaMs);
    this.tickSickles(deltaMs);
    this.tickZones(deltaMs);
    this.tickSpikes(deltaMs);
    this.tickDiscs(deltaMs);
    this.tickSnares(deltaMs);
    this.tickUrns(deltaMs);
    this.tickTotems(deltaMs);
    this.tickThrallRespawns(deltaMs);
    this.healWindowMs -= deltaMs;
    if (this.healWindowMs <= 0) {
      this.healWindowMs = 1000;
      this.healedInWindow = 0;
    }
    this.tickStatuses(deltaMs);
    this.tickTimedFx(deltaMs);
    this.drawShapes(deltaMs);
  }

  destroy(): void {
    for (const blade of this.blades) this.fxPool.release(blade);
    this.blades.length = 0;
    this.bladeHitAt.clear();
    for (const fx of this.timedFx) this.fxPool.release(fx.sprite);
    this.timedFx.length = 0;
    for (const s of this.skulls) this.fxPool.release(s.sprite);
    this.skulls.length = 0;
    for (const s of this.sickles) this.fxPool.release(s.sprite);
    this.sickles.length = 0;
    for (const z of this.zones) this.fxPool.release(z.sprite);
    this.zones.length = 0;
    this.spikes.length = 0;
    this.shapes.length = 0;
    this.statuses.clear();
    if (this.breathFx !== null) this.fxPool.release(this.breathFx);
    this.breathFx = null;
    this.breathLeftMs = 0;
    for (const d of this.discs) this.fxPool.release(d.sprite);
    this.discs.length = 0;
    for (const n of this.snares) this.fxPool.release(n.sprite);
    this.snares.length = 0;
    for (const u of this.urns) this.fxPool.release(u.sprite);
    this.urns.length = 0;
    for (const t of this.totems) this.fxPool.release(t.sprite);
    this.totems.length = 0;
    for (const f of this.tetherFx) this.fxPool.release(f);
    this.tetherFx.length = 0;
    this.tethers.length = 0;
    if (this.auraFx !== null) this.fxPool.release(this.auraFx);
    this.auraFx = null;
    this.thrallRespawns.length = 0;
    this.host.clearThralls();
    this.graphics.clear();
  }

  // ───────────── internals: stats ─────────────

  private slotViews(): { id: WeaponId; rank: number; evolved: boolean }[] {
    return this.weapons.map((w) => ({ id: w.id, rank: weaponRank(w.boosts), evolved: w.evolved }));
  }

  private refresh(id: WeaponId): void {
    const weapon = this.weapons.find((w) => w.id === id);
    if (weapon === undefined) return;
    const stats = weaponStats(id, weapon.boosts, weapon.evolved);
    if (id === 'orbit') stats.count += this.riders.orbitBlades;
    this.resolved.set(id, stats);
    if (id === 'bolt') Projectile.heroArt = weapon.evolved ? weaponDef('bolt').fxEvolved : weaponDef('bolt').fx;
    if (id === 'orbit') this.syncBlades(weapon);
    this.ready = evolutionReady(this.slotViews(), this.charms);
  }

  private applyCharmRank(id: CharmId, rank: number): void {
    for (const mod of charmRankMods(id, rank)) {
      this.host.player.applyModifier({ ...mod, source: `charm:${id}` });
    }
    this.ready = evolutionReady(this.slotViews(), this.charms);
  }

  private tickEligibility(deltaMs: number): void {
    for (const id of this.eligibleMs.keys()) if (!this.ready.includes(id)) this.eligibleMs.delete(id);
    for (const id of this.ready) this.eligibleMs.set(id, (this.eligibleMs.get(id) ?? 0) + deltaMs);
  }

  private get area(): number {
    return Math.max(0.2, this.host.player.stats.get('area'));
  }

  private get cooldownMul(): number {
    return Math.max(0.1, this.host.player.stats.get('cooldownMul'));
  }

  private get durationMul(): number {
    return Math.max(0.1, this.host.player.stats.get('durationMul'));
  }

  private get projectileBonus(): number {
    return Math.max(0, Math.round(this.host.player.stats.get('projectileBonus')));
  }

  /** One weapon hit: base × damageMul, crit from `critChance + critAdd`. Returns whether it crit. */
  private strike(enemy: Enemy, base: number, source: WeaponId, critAdd = 0): boolean {
    const stats = this.host.player.stats;
    const crit = this.host.rng.chance(stats.get('critChance') + critAdd);
    const amount = base * stats.get('damageMul') * (crit ? stats.get('critMul') || 2 : 1);
    this.host.damageEnemy(enemy, amount, crit, source);
    return crit;
  }

  private trackFacing(): void {
    const body = this.host.player.body as Phaser.Physics.Arcade.Body | null;
    if (body === null) return;
    const vx = body.velocity.x;
    const vy = body.velocity.y;
    const len = Math.hypot(vx, vy);
    if (len > 24) {
      this.faceX = vx / len;
      this.faceY = vy / len;
    }
  }

  /** Enemies within exact `r` of (x, y) into `out`; returns count. */
  private query(x: number, y: number, r: number, out: Enemy[]): number {
    this.host.enemiesInRadius(x, y, r, out);
    const r2 = r * r;
    let n = 0;
    for (let i = 0; i < out.length; i += 1) {
      const e = out[i];
      if (e === undefined || !e.active || e.health.hp <= 0) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy <= r2) out[n++] = e;
    }
    out.length = n;
    return n;
  }

  private sortByDistance(list: Enemy[], x: number, y: number): void {
    list.sort((a, b) => (a.x - x) ** 2 + (a.y - y) ** 2 - ((b.x - x) ** 2 + (b.y - y) ** 2));
  }

  /** Fires one weapon; false when it had nothing to aim at (cooldown stays ready). */
  private fire(weapon: WeaponState, s: WeaponStats): boolean {
    switch (weapon.id) {
      case 'bolt':
        return this.fireBolt(weapon, s);
      case 'nova':
        return this.fireNova(weapon, s);
      case 'scythe':
        return this.fireScythe(weapon, s);
      case 'rail':
        return this.fireRail(weapon, s);
      case 'hex':
        return this.fireHex(weapon, s);
      case 'skull':
        return this.fireSkull(weapon, s);
      case 'censer':
        return this.fireCenser(weapon, s);
      case 'sickle':
        return this.fireSickle(weapon, s);
      case 'lash':
        return this.fireLash(weapon, s);
      case 'breath':
        return this.fireBreath(weapon, s);
      case 'spears':
        return this.fireSpears(weapon, s);
      case 'chakram':
        return this.fireChakram(weapon, s);
      case 'snares':
        return this.fireSnare(weapon, s);
      case 'bombs':
        return this.fireBombs(weapon, s);
      case 'totem':
        return this.fireTotem(weapon, s);
      case 'thralls':
        return this.fireThralls(weapon, s);
      case 'aura':
        return this.pulseAura(weapon, s);
      case 'orbit':
      case 'wake':
      case 'siphon':
        return true;
    }
  }

  // ───────────── patterns ─────────────

  /** Rustspike / Coffin Nail: fan of nails at the nearest enemy. */
  private fireBolt(weapon: WeaponState, s: WeaponStats): boolean {
    const host = this.host;
    const player = host.player;
    const target = host.nearestEnemy(player.x, player.y, TUNING.player.range * this.area);
    if (target === null) return false;
    const count = s.count + this.projectileBonus;
    const base = Math.atan2(target.y - player.y, target.x - player.x);
    const spread = 0.2;
    const stats = player.stats;
    for (let i = 0; i < count; i += 1) {
      const angle = base + (count > 1 ? (i - (count - 1) / 2) * spread : 0);
      const crit = host.rng.chance(stats.get('critChance'));
      const damage = s.damage * stats.get('damageMul') * (crit ? stats.get('critMul') || 2 : 1);
      host.fireShot(player.x, player.y, Math.cos(angle) * s.speed, Math.sin(angle) * s.speed, damage, crit, weapon.evolved ? 1.25 : 1, s.pierce);
    }
    host.onPlayerAttack(player.x, player.y);
    return true;
  }

  /** Bone Halo / Marrow Wheel: continuous contact on a per-enemy hit cooldown. */
  private tickOrbit(weapon: WeaponState, s: WeaponStats, deltaMs: number): void {
    if (this.blades.length === 0) return;
    const player = this.host.player;
    const radius = s.radius * this.area;
    weapon.angle += (deltaMs / 1000) * ORBIT_RAD_PER_S;
    const hitR = BLADE_HIT_R * Math.sqrt(this.area);
    for (let i = 0; i < this.blades.length; i += 1) {
      const blade = this.blades[i];
      if (blade === undefined) continue;
      const angle = weapon.angle + (i / this.blades.length) * Math.PI * 2;
      const bx = player.x + Math.cos(angle) * radius;
      const by = player.y + Math.sin(angle) * radius;
      // Tangent to the orbit (art is drawn pointing right; the procedural spike points up).
      blade.setPosition(bx, by).setRotation(angle + (blade.usingArt ? Math.PI / 2 : Math.PI));
      this.query(bx, by, hitR, this.near);
      for (const enemy of this.near) {
        if (this.nowMs - (this.bladeHitAt.get(enemy) ?? -Infinity) < s.cooldownMs) continue;
        this.bladeHitAt.set(enemy, this.nowMs);
        this.strike(enemy, s.damage, 'orbit');
      }
    }
    if (this.bladeHitAt.size > 512) this.bladeHitAt.clear();
  }

  private syncBlades(weapon: WeaponState): void {
    const s = this.resolved.get('orbit');
    const want = s === undefined ? 0 : s.count;
    while (this.blades.length > 0) {
      const blade = this.blades.pop();
      if (blade !== undefined) this.fxPool.release(blade);
    }
    const def = weaponDef('orbit');
    const size = weapon.evolved ? ORBIT_BLADE_PX * 1.35 : ORBIT_BLADE_PX;
    const player = this.host.player;
    for (let i = 0; i < want; i += 1) {
      const blade = this.fxPool.obtain();
      blade.show(weapon.evolved ? def.fxEvolved : def.fx, TEX.spike, weapon.evolved ? HERO_FX.bone : HERO_FX.cyan, player.x, player.y, size, size, FX_DEPTH + 1);
      this.blades.push(blade);
    }
  }

  /** Ash Ring / Pyre Shroud: radial burst with falloff; evolved leaves a burn field. */
  private fireNova(weapon: WeaponState, s: WeaponStats): boolean {
    const player = this.host.player;
    const radius = s.radius * this.area;
    if (this.query(player.x, player.y, radius, this.near) === 0) return false;
    const falloffAt = radius * s.falloff;
    for (const enemy of this.near) {
      const dist = Math.hypot(enemy.x - player.x, enemy.y - player.y);
      const t = dist <= falloffAt ? 1 : Math.max(0, 1 - (dist - falloffAt) / (radius - falloffAt));
      if (t > 0) this.strike(enemy, s.damage * t, 'nova');
    }
    this.host.hitBreakables(player.x, player.y, radius);
    const novaDef = weaponDef('nova');
    const color = weapon.evolved ? HERO_FX.violet : HERO_FX.cyan;
    if (!this.oneShot(weapon.evolved ? novaDef.fxEvolved : novaDef.fx, color, player.x, player.y, radius, 0, NOVA_FX_MS, true)) {
      this.addShape('ring', player.x, player.y, 0, 0, radius, color, NOVA_FX_MS);
    }
    if (weapon.evolved) {
      this.addZone(null, player.x, player.y, s.fieldRadius * this.area, s.dotDps, s.dotMs * this.durationMul, 0, 'nova', HERO_FX.violet);
    }
    return true;
  }

  /** Aim direction: nearest enemy within `reach`, else the way the hero faces. */
  private aimAngle(reach: number): number {
    const player = this.host.player;
    const target = this.host.nearestEnemy(player.x, player.y, reach);
    if (target !== null) return Math.atan2(target.y - player.y, target.x - player.x);
    return Math.atan2(this.faceY, this.faceX);
  }

  /** Gloam Scythe / Dirge Reaper: frontal arc sweep (360° evolved). */
  private fireScythe(weapon: WeaponState, s: WeaponStats): boolean {
    const player = this.host.player;
    const radius = s.radius * this.area;
    if (this.query(player.x, player.y, radius, this.near) === 0) return false;
    const facing = this.aimAngle(radius * 1.5);
    const half = (s.arcDeg * Math.PI) / 360;
    for (const enemy of this.near) {
      if (half < Math.PI) {
        const diff = Math.atan2(enemy.y - player.y, enemy.x - player.x) - facing;
        const wrapped = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (Math.abs(wrapped) > half) continue;
      }
      this.strike(enemy, s.damage, 'scythe');
    }
    this.host.hitBreakables(player.x + Math.cos(facing) * radius * 0.5, player.y + Math.sin(facing) * radius * 0.5, radius * 0.5);
    const scytheDef = weaponDef('scythe');
    const arcColor = weapon.evolved ? HERO_FX.bone : HERO_FX.cyan;
    // Art: ")" crescent convex toward +x; its circle centre (not the cell centre) sits on the swinger.
    if (!this.oneShot(weapon.evolved ? scytheDef.fxEvolved : scytheDef.fx, arcColor, player.x, player.y, radius, facing, SCYTHE_FX_MS)) {
      this.addShape('arc', player.x, player.y, facing, half, radius, arcColor, SCYTHE_FX_MS);
    }
    return true;
  }

  /** Widow's Lance / Sorrow Piercer: instant beam through the densest cluster. */
  private fireRail(weapon: WeaponState, s: WeaponStats): boolean {
    const host = this.host;
    const player = host.player;
    if (!host.densestPoint(player.x, player.y, CLUSTER_RADIUS, this.cluster)) return false;
    const length = s.length * this.area;
    const dx = this.cluster.x - player.x;
    const dy = this.cluster.y - player.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist > length) return false;
    const ux = dx / dist;
    const uy = dy / dist;
    const halfW = BEAM_HALF_W * this.area;
    const cx = player.x + ux * length * 0.5;
    const cy = player.y + uy * length * 0.5;
    this.query(cx, cy, length * 0.5 + halfW, this.near);
    let n = 0;
    for (const enemy of this.near) {
      const px = enemy.x - player.x;
      const py = enemy.y - player.y;
      const along = px * ux + py * uy;
      if (along < 0 || along > length || Math.abs(px * uy - py * ux) > halfW) continue;
      this.near[n++] = enemy;
    }
    this.near.length = n;
    this.sortByDistance(this.near, player.x, player.y);
    const hits = Math.min(this.near.length, 1 + s.pierce);
    for (let i = 0; i < hits; i += 1) {
      const enemy = this.near[i];
      if (enemy !== undefined) this.strike(enemy, s.damage, 'rail', s.critAdd);
    }
    const ex = player.x + ux * length;
    const ey = player.y + uy * length;
    const railDef = weaponDef('rail');
    const beamColor = weapon.evolved ? HERO_FX.violet : HERO_FX.cyan;
    // Art: 384×64 beam pointing right — anchored at its left edge on the hero, stretched to the beam.
    if (!this.segment(weapon.evolved ? railDef.fxEvolved : railDef.fx, player.x, player.y, ex, ey, halfW * 2.4, RAIL_FX_MS)) {
      this.addShape('beam', player.x, player.y, ex, ey, halfW * 1.2, beamColor, RAIL_FX_MS);
    }
    return true;
  }

  /** Thorn Hex / Rot Chorus: chain lightning between nearest unhit enemies. */
  private fireHex(weapon: WeaponState, s: WeaponStats): boolean {
    const host = this.host;
    const player = host.player;
    let current = host.nearestEnemy(player.x, player.y, TUNING.player.range * this.area);
    if (current === null) return false;
    const jumpR = s.radius * this.area;
    this.chainHit.clear();
    const hexDef = weaponDef('hex');
    const hexArt = weapon.evolved ? hexDef.fxEvolved : hexDef.fx;
    const useArt = this.host.scene.textures.exists(hexArt);
    const shape = useArt ? null : this.addShape('chain', player.x, player.y, 0, 0, 5, weapon.evolved ? HERO_FX.gloam : HERO_FX.violet, HEX_FX_MS);
    shape?.pts.push(player.x, player.y);
    let fromX = player.x;
    let fromY = player.y;
    for (let j = 0; j < s.count && current !== null; j += 1) {
      this.chainHit.add(current);
      shape?.pts.push(current.x, current.y);
      // Art: 256×64 chain link, horizontal — one stretched segment per jump.
      if (useArt) this.segment(hexArt, fromX, fromY, current.x, current.y, HEX_LINK_PX, HEX_FX_MS);
      fromX = current.x;
      fromY = current.y;
      this.strike(current, s.damage, 'hex');
      if (s.dotDps > 0) this.applyDot(current, s.dotDps, s.dotMs * this.durationMul, 'hex');
      this.query(current.x, current.y, jumpR, this.near);
      let next: Enemy | null = null;
      let best = Infinity;
      for (const enemy of this.near) {
        if (this.chainHit.has(enemy)) continue;
        const d = (enemy.x - current.x) ** 2 + (enemy.y - current.y) ** 2;
        if (d < best) {
          best = d;
          next = enemy;
        }
      }
      current = next;
    }
    this.chainHit.clear();
    return true;
  }

  /** Wailing Skull / Choir of Skulls: homing skulls, evolved burst on hit. */
  private fireSkull(weapon: WeaponState, s: WeaponStats): boolean {
    const player = this.host.player;
    if (this.host.nearestEnemy(player.x, player.y, TUNING.player.range * this.area * 1.6) === null) return false;
    const count = s.count + this.projectileBonus;
    const size = 56 * Math.sqrt(this.area);
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + this.nowMs * 0.001;
      const sprite = this.fxPool.obtain();
      const skull = this.skullFree.pop() ?? { sprite, x: 0, y: 0, angle: 0, lifeMs: 0, damage: 0, speed: 0, turn: 0, splashR: 0, splashMul: 0 };
      skull.sprite = sprite;
      skull.x = player.x;
      skull.y = player.y;
      skull.angle = angle;
      skull.lifeMs = SKULL_LIFE_MS;
      skull.damage = s.damage;
      skull.speed = s.speed;
      skull.turn = s.turnRadPerS;
      skull.splashR = s.splashRadius * this.area;
      skull.splashMul = s.splashMul;
      const def = weaponDef('skull');
      skull.sprite.show(weapon.evolved ? def.fxEvolved : def.fx, TEX.star, weapon.evolved ? HERO_FX.violet : HERO_FX.cyan, player.x, player.y, size, size, FX_DEPTH + 1);
      this.skulls.push(skull);
    }
    return true;
  }

  private tickSkulls(deltaMs: number): void {
    const dt = deltaMs / 1000;
    const hitR = SKULL_HIT_R * Math.sqrt(this.area);
    for (let i = this.skulls.length - 1; i >= 0; i -= 1) {
      const skull = this.skulls[i];
      if (skull === undefined) continue;
      skull.lifeMs -= deltaMs;
      const target = this.host.nearestEnemy(skull.x, skull.y, TUNING.player.range * 2);
      if (target !== null) {
        const want = Math.atan2(target.y - skull.y, target.x - skull.x);
        const diff = Math.atan2(Math.sin(want - skull.angle), Math.cos(want - skull.angle));
        const maxTurn = skull.turn * dt;
        skull.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));
      }
      skull.x += Math.cos(skull.angle) * skull.speed * dt;
      skull.y += Math.sin(skull.angle) * skull.speed * dt;
      skull.sprite.setPosition(skull.x, skull.y).setRotation(skull.angle).setAlpha(skull.sprite.peakAlpha * this.heroDim(skull.x, skull.y));
      let done = skull.lifeMs <= 0;
      if (!done && this.query(skull.x, skull.y, hitR, this.near) > 0) {
        const victim = this.near[0];
        if (victim !== undefined) this.strike(victim, skull.damage, 'skull');
        if (skull.splashR > 0) {
          this.query(skull.x, skull.y, skull.splashR, this.near2);
          for (const enemy of this.near2) if (enemy !== victim) this.strike(enemy, skull.damage * skull.splashMul, 'skull');
          this.addShape('ring', skull.x, skull.y, 0, 0, skull.splashR, HERO_FX.violet, 200);
        }
        done = true;
      }
      if (done) {
        this.fxPool.release(skull.sprite);
        this.skulls[i] = this.skulls[this.skulls.length - 1] as Skull;
        this.skulls.pop();
        this.skullFree.push(skull);
      }
    }
  }

  /** Plague Censer / Pestilent Thurible: pools under the nearest enemies in range. */
  private fireCenser(weapon: WeaponState, s: WeaponStats): boolean {
    const player = this.host.player;
    const range = s.range * this.area;
    if (this.query(player.x, player.y, range, this.near) === 0) return false;
    this.sortByDistance(this.near, player.x, player.y);
    const count = Math.min(this.near.length, s.count);
    const def = weaponDef('censer');
    for (let i = 0; i < count; i += 1) {
      const enemy = this.near[i];
      if (enemy === undefined) continue;
      this.addZone(weapon.evolved ? def.fxEvolved : def.fx, enemy.x, enemy.y, s.radius * this.area, s.damage, s.durationMs * this.durationMul, s.slowPct, 'censer', HERO_FX.gloam);
    }
    return true;
  }

  /** Grave Sickle / Moon Harvester: out-and-back blades (spiral evolved), pierce ∞. */
  private fireSickle(weapon: WeaponState, s: WeaponStats): boolean {
    const player = this.host.player;
    const out = s.radius * this.area;
    if (this.host.nearestEnemy(player.x, player.y, out * 1.2) === null) return false;
    const aim = this.aimAngle(out * 1.2);
    const count = s.count + this.projectileBonus;
    const def = weaponDef('sickle');
    const size = 84 * Math.sqrt(this.area);
    for (let i = 0; i < count; i += 1) {
      const sprite = this.fxPool.obtain();
      const sickle = this.sickleFree.pop() ?? { sprite, angle: 0, tMs: 0, outPx: 0, damage: 0, spiral: false, hit: new Set<Enemy>() };
      sickle.sprite = sprite;
      sickle.angle = aim + (weapon.evolved ? (i / count) * Math.PI * 2 : (i - (count - 1) / 2) * 0.35);
      sickle.tMs = 0;
      sickle.outPx = out;
      sickle.damage = s.damage;
      sickle.spiral = weapon.evolved;
      sickle.hit.clear();
      sickle.sprite.show(weapon.evolved ? def.fxEvolved : def.fx, TEX.spike, weapon.evolved ? HERO_FX.bone : HERO_FX.cyan, player.x, player.y, size, size, FX_DEPTH + 1);
      this.sickles.push(sickle);
    }
    return true;
  }

  private tickSickles(deltaMs: number): void {
    const player = this.host.player;
    const hitR = SICKLE_HIT_R * Math.sqrt(this.area);
    for (let i = this.sickles.length - 1; i >= 0; i -= 1) {
      const sickle = this.sickles[i];
      if (sickle === undefined) continue;
      sickle.tMs += deltaMs;
      const t = Math.min(1, sickle.tMs / SICKLE_FLIGHT_MS);
      const reach = Math.sin(Math.PI * t) * sickle.outPx;
      const angle = sickle.angle + (sickle.spiral ? t * Math.PI * 1.5 : 0);
      const x = player.x + Math.cos(angle) * reach;
      const y = player.y + Math.sin(angle) * reach;
      sickle.sprite.setPosition(x, y).setRotation(sickle.tMs * 0.02).setAlpha(sickle.sprite.peakAlpha * this.heroDim(x, y));
      this.query(x, y, hitR, this.near);
      for (const enemy of this.near) {
        if (sickle.hit.has(enemy)) continue;
        sickle.hit.add(enemy);
        this.strike(enemy, sickle.damage, 'sickle');
      }
      if (t >= 1) {
        this.fxPool.release(sickle.sprite);
        sickle.hit.clear();
        this.sickles[i] = this.sickles[this.sickles.length - 1] as Sickle;
        this.sickles.pop();
        this.sickleFree.push(sickle);
      }
    }
  }

  /** Thorn Lash / Briar Scourge: rect whip to one flank (alternating) or both. */
  private fireLash(weapon: WeaponState, s: WeaponStats): boolean {
    const player = this.host.player;
    const w = s.length * this.area;
    const h = s.width * this.area;
    if (this.query(player.x, player.y, Math.hypot(w, h / 2), this.near) === 0) return false;
    const both = s.count >= 2;
    weapon.angle = weapon.angle > 0 ? -1 : 1;
    const def = weaponDef('lash');
    for (let side = -1; side <= 1; side += 2) {
      if (!both && side !== weapon.angle) continue;
      const cx = player.x + side * w * 0.5;
      for (const enemy of this.near) {
        if (Math.abs(enemy.x - cx) > w * 0.5 || Math.abs(enemy.y - player.y) > h * 0.5) continue;
        this.strike(enemy, s.damage, 'lash');
        if (s.dotDps > 0) this.applyDot(enemy, s.dotDps, s.dotMs * this.durationMul, 'lash');
      }
      this.host.hitBreakables(cx, player.y, h * 0.5);
      const fx = this.fxPool.obtain();
      // Lash art fills its 384×96 cell; the procedural fallback shows the exact hit rect.
      fx.show(weapon.evolved ? def.fxEvolved : def.fx, TEX.square, weapon.evolved ? HERO_FX.gloam : HERO_FX.bone, cx, player.y, w, h, FX_DEPTH);
      if (fx.usingArt) fx.setDisplaySize(w, h * 1.2);
      fx.setFlipX(side < 0);
      this.addTimedFx(fx, 240, true);
    }
    return true;
  }

  /** Pyre Breath / Cinder Maw: starts a cone in the move direction; ticks in `tickBreathActive`. */
  private fireBreath(weapon: WeaponState, s: WeaponStats): boolean {
    const player = this.host.player;
    const length = s.length * this.area;
    if (this.query(player.x, player.y, length, this.near) === 0) return false;
    this.breathLeftMs = s.durationMs * this.durationMul;
    this.breathTickMs = 0;
    this.breathAngle = Math.atan2(this.faceY, this.faceX);
    const def = weaponDef('breath');
    if (this.breathFx === null) this.breathFx = this.fxPool.obtain();
    const spread = 2 * length * Math.tan(Math.min(80, s.arcDeg / 2) * (Math.PI / 180));
    this.breathFx.show(weapon.evolved ? def.fxEvolved : def.fx, TEX.disc, weapon.evolved ? HERO_FX.violet : HERO_FX.cyan, player.x, player.y, length, Math.min(length * 1.4, spread), FX_DEPTH);
    this.breathFx.setOrigin(0, 0.5);
    // The cone's root sits on the hero: always the near-hero dim.
    this.breathFx.peakAlpha *= NEAR_HERO_ALPHA + (1 - NEAR_HERO_ALPHA) * 0.5;
    this.breathFx.setAlpha(this.breathFx.peakAlpha);
    return true;
  }

  private tickBreathActive(weapon: WeaponState, s: WeaponStats, deltaMs: number): void {
    if (this.breathLeftMs <= 0) return;
    const player = this.host.player;
    this.breathLeftMs -= deltaMs;
    this.breathAngle = Math.atan2(this.faceY, this.faceX);
    const fx = this.breathFx;
    if (fx !== null) fx.setPosition(player.x, player.y).setRotation(this.breathAngle);
    this.breathTickMs -= deltaMs;
    if (this.breathTickMs <= 0) {
      this.breathTickMs += s.tickMs;
      const length = s.length * this.area;
      const half = (s.arcDeg * Math.PI) / 360;
      this.query(player.x, player.y, length, this.near);
      for (const enemy of this.near) {
        const diff = Math.atan2(enemy.y - player.y, enemy.x - player.x) - this.breathAngle;
        if (Math.abs(Math.atan2(Math.sin(diff), Math.cos(diff))) > half) continue;
        this.strike(enemy, s.damage, 'breath');
        if (weapon.evolved && s.dotDps > 0) this.applyDot(enemy, s.dotDps, s.dotMs * this.durationMul, 'breath');
      }
    }
    if (this.breathLeftMs <= 0 && fx !== null) {
      this.fxPool.release(fx);
      this.breathFx = null;
    }
  }

  /** Gallows Spears / Gallows Forest: telegraphed eruptions under enemies (a line to the densest pack evolved). */
  private fireSpears(weapon: WeaponState, s: WeaponStats): boolean {
    const host = this.host;
    const player = host.player;
    const range = s.range * this.area;
    const r = s.radius * this.area;
    const count = s.count + this.projectileBonus;
    if (weapon.evolved) {
      if (!host.densestPoint(player.x, player.y, CLUSTER_RADIUS, this.cluster)) return false;
      const dx = this.cluster.x - player.x;
      const dy = this.cluster.y - player.y;
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.min(dist + r * 2, range * 1.6);
      for (let i = 0; i < count; i += 1) {
        const along = (reach * (i + 1)) / count;
        this.addSpike(player.x + (dx / dist) * along, player.y + (dy / dist) * along, r, s.damage, s.rootMs, s.telegraphMs + i * 40, true);
      }
      return true;
    }
    if (this.query(player.x, player.y, range, this.near) === 0) return false;
    this.sortByDistance(this.near, player.x, player.y);
    for (let i = 0; i < count; i += 1) {
      const enemy = this.near[i % this.near.length];
      if (enemy === undefined) continue;
      const jitter = i >= this.near.length ? r : 0;
      this.addSpike(enemy.x + host.rng.float(-jitter, jitter), enemy.y + host.rng.float(-jitter, jitter), r, s.damage, 0, s.telegraphMs, false);
    }
    return true;
  }

  private addSpike(x: number, y: number, r: number, damage: number, rootMs: number, delayMs: number, evolved: boolean): void {
    const spike = this.spikeFree.pop() ?? { x: 0, y: 0, r: 0, damage: 0, rootMs: 0, delayMs: 0, evolved: false };
    spike.x = x;
    spike.y = y;
    spike.r = r;
    spike.damage = damage;
    spike.rootMs = rootMs;
    spike.delayMs = delayMs;
    spike.evolved = evolved;
    this.spikes.push(spike);
    // §5.8: 350 ms telegraph in hero cyan.
    this.addShape('ring', x, y, 0, 0, r, HERO_FX.cyan, delayMs);
  }

  private tickSpikes(deltaMs: number): void {
    const def = weaponDef('spears');
    for (let i = this.spikes.length - 1; i >= 0; i -= 1) {
      const spike = this.spikes[i];
      if (spike === undefined) continue;
      spike.delayMs -= deltaMs;
      if (spike.delayMs > 0) continue;
      this.query(spike.x, spike.y, spike.r, this.near);
      for (const enemy of this.near) {
        this.strike(enemy, spike.damage, 'spears');
        if (spike.rootMs > 0) this.applyRoot(enemy, spike.rootMs);
      }
      this.host.hitBreakables(spike.x, spike.y, spike.r);
      const fx = this.fxPool.obtain();
      const size = spike.r * 2.4;
      fx.show(spike.evolved ? def.fxEvolved : def.fx, TEX.spike, HERO_FX.bone, spike.x, spike.y - size * 0.3, size, size, FX_DEPTH);
      this.addTimedFx(fx, 420, true);
      this.spikes[i] = this.spikes[this.spikes.length - 1] as Spike;
      this.spikes.pop();
      this.spikeFree.push(spike);
    }
  }


  // ───────────── Arsenal 20 patterns (§5.8b.1) ─────────────

  /** Heals through the host within the rolling per-second cap (`capPerS` 0 = uncapped). */
  private heal(amount: number, capPerS: number, source: WeaponId): void {
    const allowed = capPerS > 0 ? Math.min(amount, capPerS - this.healedInWindow) : amount;
    if (allowed <= 0) return;
    this.healedInWindow += this.host.healPlayer(allowed, source);
  }

  /** Mourning Pall / Pall of the Dead: the field sprite rides under the hero. */
  private followAura(weapon: WeaponState, s: WeaponStats): void {
    const player = this.host.player;
    const def = weaponDef('aura');
    const r = s.radius * this.area;
    if (this.auraFx === null) {
      this.auraFx = this.fxPool.obtain();
      this.auraFx.show(weapon.evolved ? def.fxEvolved : def.fx, TEX.disc, HERO_FX.violet, player.x, player.y, r * 2, r * 2, 4);
      this.auraFx.peakAlpha = this.auraFx.usingArt ? 0.6 : 0.16;
      this.auraFx.setData('evo', weapon.evolved);
    }
    const fx = this.auraFx;
    if (fx.getData('evo') !== weapon.evolved) {
      fx.show(weapon.evolved ? def.fxEvolved : def.fx, TEX.disc, HERO_FX.violet, player.x, player.y, r * 2, r * 2, 4);
      fx.peakAlpha = fx.usingArt ? 0.6 : 0.16;
      fx.setData('evo', weapon.evolved);
    }
    const side = fx.usingArt ? r / (ART_GEOM[fx.texture.key]?.rim ?? 0.5) : r * 2;
    fx.setPosition(player.x, player.y).setDisplaySize(side, side).setAlpha(fx.peakAlpha);
  }

  /** One aura tick: damage + knockback inside the radius; evolved also slows and heals on kills. */
  private pulseAura(_weapon: WeaponState, s: WeaponStats): boolean {
    const player = this.host.player;
    const r = s.radius * this.area;
    this.query(player.x, player.y, r, this.near);
    const push = (TUNING.weapons.aura.knockback * s.tickMs) / 1000;
    for (const enemy of this.near) {
      this.strike(enemy, s.damage, 'aura');
      if (enemy.health.hp <= 0) {
        if (s.healPerKill > 0) this.heal(s.healPerKill, s.healCapPerS, 'aura');
        continue;
      }
      const dx = enemy.x - player.x;
      const dy = enemy.y - player.y;
      const d = Math.hypot(dx, dy) || 1;
      enemy.setPosition(enemy.x + (dx / d) * push, enemy.y + (dy / d) * push);
      if (s.slowPct > 0) this.applySlow(enemy, s.slowPct / 100, s.tickMs * 1.5);
    }
    return true;
  }

  /** Ossuary Disc / Wheel of Sorrows: ricochet discs. */
  private fireChakram(weapon: WeaponState, s: WeaponStats): boolean {
    const player = this.host.player;
    const target = this.host.nearestEnemy(player.x, player.y, TUNING.player.range * this.area);
    if (target === null) return false;
    const def = weaponDef('chakram');
    const count = s.count + this.projectileBonus;
    const base = Math.atan2(target.y - player.y, target.x - player.x);
    const size = s.radius * 1.6 * Math.sqrt(this.area);
    for (let i = 0; i < count; i += 1) {
      const a = base + (i - (count - 1) / 2) * 0.35;
      const sprite = this.fxPool.obtain();
      sprite.show(weapon.evolved ? def.fxEvolved : def.fx, TEX.disc, weapon.evolved ? HERO_FX.bone : HERO_FX.cyan, player.x, player.y, size, size, FX_DEPTH + 1);
      this.discs.push({
        sprite, x: player.x, y: player.y, vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed,
        damage: s.damage, bouncesLeft: s.bounces, travelLeft: DISC_MAX_TRAVEL, returning: false,
        evolved: weapon.evolved, hitR: (s.radius / 2) * Math.sqrt(this.area), hit: new Set<Enemy>(), source: 'chakram',
      });
    }
    return true;
  }

  private tickDiscs(deltaMs: number): void {
    const dt = deltaMs / 1000;
    const host = this.host;
    const player = host.player;
    const bounceRange = TUNING.weapons.chakram.bounceRange * this.area;
    for (let i = this.discs.length - 1; i >= 0; i -= 1) {
      const d = this.discs[i];
      if (d === undefined) continue;
      let done = false;
      if (d.returning) {
        const dx = player.x - d.x;
        const dy = player.y - d.y;
        const dist = Math.hypot(dx, dy);
        const speed = Math.hypot(d.vx, d.vy);
        if (dist < 40) done = true;
        else {
          d.vx = (dx / dist) * speed;
          d.vy = (dy / dist) * speed;
        }
      }
      const nx = d.x + d.vx * dt;
      const ny = d.y + d.vy * dt;
      // Reflect off blockers (§5.8b.1): flip whichever axis crossed into one.
      if (!d.returning && host.isBlocked(nx, ny)) {
        if (host.isBlocked(nx, d.y)) d.vx = -d.vx;
        if (host.isBlocked(d.x, ny)) d.vy = -d.vy;
        if (!host.isBlocked(nx, d.y) && !host.isBlocked(d.x, ny)) {
          d.vx = -d.vx;
          d.vy = -d.vy;
        }
      } else {
        d.travelLeft -= Math.hypot(nx - d.x, ny - d.y);
        d.x = nx;
        d.y = ny;
      }
      d.sprite.setPosition(d.x, d.y).setRotation(d.sprite.rotation + dt * 14);
      if (!done && !d.returning && this.query(d.x, d.y, d.hitR, this.near) > 0) {
        let victim: Enemy | null = null;
        for (const e of this.near) if (!d.hit.has(e)) { victim = e; break; }
        if (victim !== null) {
          d.hit.add(victim);
          const crit = this.strike(victim, d.damage, d.source);
          // Wheel of Sorrows: a crit does not spend a bounce.
          if (!(d.evolved && crit)) d.bouncesLeft -= 1;
          if (d.bouncesLeft < 0) {
            if (d.evolved && d.source === 'chakram') d.returning = true;
            else done = true;
          } else {
            const next = this.nearestUnhit(d.x, d.y, bounceRange, d.hit);
            if (next !== null) {
              const speed = Math.hypot(d.vx, d.vy);
              const dist = Math.hypot(next.x - d.x, next.y - d.y) || 1;
              d.vx = ((next.x - d.x) / dist) * speed;
              d.vy = ((next.y - d.y) / dist) * speed;
            } else if (d.evolved && d.source === 'chakram') d.returning = true;
            else done = true;
          }
        }
      }
      if (d.travelLeft <= 0) {
        if (d.evolved && d.source === 'chakram' && !d.returning) d.returning = true;
        else if (!d.returning) done = true;
      }
      if (done) {
        this.fxPool.release(d.sprite);
        this.discs[i] = this.discs[this.discs.length - 1] as Disc;
        this.discs.pop();
      }
    }
  }

  private nearestUnhit(x: number, y: number, r: number, hit: ReadonlySet<Enemy>): Enemy | null {
    this.query(x, y, r, this.near2);
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of this.near2) {
      if (hit.has(e)) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Gloam Wake / River of Dusk: a cold-fire segment every `length` px moved while moving. */
  private tickWake(weapon: WeaponState, s: WeaponStats): void {
    const player = this.host.player;
    const body = player.body as Phaser.Physics.Arcade.Body | null;
    const speed = body === null ? 0 : Math.hypot(body.velocity.x, body.velocity.y);
    if (Number.isNaN(this.wakeX)) {
      this.wakeX = player.x;
      this.wakeY = player.y;
      return;
    }
    if (speed < TUNING.weapons.wake.minSpeed) return;
    if (Math.hypot(player.x - this.wakeX, player.y - this.wakeY) < s.length) return;
    this.wakeX = player.x;
    this.wakeY = player.y;
    const def = weaponDef('wake');
    this.addZone(weapon.evolved ? def.fxEvolved : def.fx, player.x, player.y, s.radius * this.area,
      s.damage / (s.tickMs / 1000), s.durationMs * this.durationMul, s.slowPct, 'wake', HERO_FX.violet);
  }

  /** Grave Snares / Ossuary Minefield: drop a snare at the hero's feet (max `count` live). */
  private fireSnare(weapon: WeaponState, s: WeaponStats): boolean {
    if (this.snares.length >= s.count) return false;
    const player = this.host.player;
    const def = weaponDef('snares');
    const sprite = this.fxPool.obtain();
    const size = (weapon.evolved ? 60 : 50) * Math.sqrt(this.area);
    sprite.show(weapon.evolved ? def.fxEvolved : def.fx, TEX.star, HERO_FX.bone, player.x, player.y, size, size, 5);
    this.snares.push({ sprite, x: player.x, y: player.y, armMs: s.telegraphMs, chained: false });
    return true;
  }

  private tickSnares(deltaMs: number): void {
    const s = this.resolved.get('snares');
    if (s === undefined || this.snares.length === 0) return;
    const evolved = this.weapons.find((w) => w.id === 'snares')?.evolved === true;
    const blastR = s.radius * this.area;
    const trigger = s.range * Math.sqrt(this.area);
    for (let i = this.snares.length - 1; i >= 0; i -= 1) {
      const n = this.snares[i];
      if (n === undefined) continue;
      if (n.armMs > 0) {
        n.armMs -= deltaMs;
        n.sprite.setAlpha(n.sprite.peakAlpha * 0.5);
        continue;
      }
      n.sprite.setAlpha(n.sprite.peakAlpha);
      if (!n.chained && this.host.nearestEnemy(n.x, n.y, trigger) === null) continue;
      this.query(n.x, n.y, blastR, this.near);
      for (const e of this.near) {
        this.strike(e, s.damage, 'snares');
        if (s.rootMs > 0) this.applyRoot(e, s.rootMs);
      }
      this.host.hitBreakables(n.x, n.y, blastR);
      const blast = evolved ? 'wpn-snares-blast-evo' : 'wpn-snares-blast';
      if (!this.oneShot(blast, HERO_FX.cyan, n.x, n.y, blastR, 0, 320)) this.addShape('ring', n.x, n.y, 0, 0, blastR, HERO_FX.cyan, 320);
      if (s.fieldRadius > 0) {
        const r2 = (s.fieldRadius * this.area) ** 2;
        for (const other of this.snares) {
          if (other !== n && other.armMs <= 0 && (other.x - n.x) ** 2 + (other.y - n.y) ** 2 <= r2) other.chained = true;
        }
      }
      this.fxPool.release(n.sprite);
      this.snares.splice(i, 1);
      // A chained snare may sit at a lower index than this one; the next frame detonates it.
    }
  }

  /** Marrow Siphon / Heartdrinker: tethers lock to the nearest enemies and drain. */
  private tickSiphon(weapon: WeaponState, s: WeaponStats, deltaMs: number): void {
    const player = this.host.player;
    const range = s.range * this.area;
    const r2 = range * range;
    // Drop dead or out-of-range tethers, then refill to `count` (instant retarget on a kill).
    for (let i = this.tethers.length - 1; i >= 0; i -= 1) {
      const t = this.tethers[i] as Enemy;
      if (!t.active || t.health.hp <= 0 || (t.x - player.x) ** 2 + (t.y - player.y) ** 2 > r2) this.tethers.splice(i, 1);
    }
    if (this.tethers.length < s.count) {
      this.query(player.x, player.y, range, this.near);
      this.sortByDistance(this.near, player.x, player.y);
      for (const e of this.near) {
        if (this.tethers.length >= s.count) break;
        if (!this.tethers.includes(e)) this.tethers.push(e);
      }
    }
    this.tetherTickMs -= deltaMs;
    if (this.tetherTickMs <= 0) {
      this.tetherTickMs += s.tickMs;
      if (this.tetherTickMs <= 0) this.tetherTickMs = s.tickMs;
      const dmg = s.damage * player.stats.get('damageMul');
      for (const t of this.tethers) {
        this.strike(t, s.damage, 'siphon');
        this.heal(dmg * s.healPct, s.healCapPerS, 'siphon');
      }
    }
    // Beam visuals: one persistent strip per tether, stretched hero → target.
    const def = weaponDef('siphon');
    const art = weapon.evolved ? def.fxEvolved : def.fx;
    while (this.tetherFx.length > this.tethers.length) this.fxPool.release(this.tetherFx.pop() as FxSprite);
    for (let i = 0; i < this.tethers.length; i += 1) {
      const t = this.tethers[i] as Enemy;
      let fx = this.tetherFx[i];
      if (fx === undefined) {
        fx = this.fxPool.obtain();
        // Above the hero (depth 20): the tether starts under his feet and is short in melee.
        fx.show(art, TEX.square, HERO_FX.violet, player.x, player.y, 8, 8, 21);
        this.tetherFx.push(fx);
      }
      const len = Math.max(8, Math.hypot(t.x - player.x, t.y - player.y));
      const [start, end] = STRIP_SPAN[fx.texture.key] ?? [0, 1];
      fx.setOrigin(start, 0.5).setPosition(player.x, player.y)
        .setDisplaySize(len / (end - start), fx.usingArt ? 40 : 10)
        .setRotation(Math.atan2(t.y - player.y, t.x - player.x));
    }
  }

  /** Rattle Urns / Ossuary Barrage: urns lobbed at the densest point, exploding on every hop. */
  private fireBombs(weapon: WeaponState, s: WeaponStats): boolean {
    const host = this.host;
    const player = host.player;
    const range = s.range * this.area;
    let tx: number;
    let ty: number;
    if (host.densestPoint(player.x, player.y, CLUSTER_RADIUS, this.cluster) && Math.hypot(this.cluster.x - player.x, this.cluster.y - player.y) <= range) {
      tx = this.cluster.x;
      ty = this.cluster.y;
    } else {
      const near = host.nearestEnemy(player.x, player.y, range);
      if (near === null) return false;
      tx = near.x;
      ty = near.y;
    }
    const def = weaponDef('bombs');
    for (let i = 0; i < s.count; i += 1) {
      const jx = i === 0 ? 0 : host.rng.float(-60, 60);
      const jy = i === 0 ? 0 : host.rng.float(-60, 60);
      const sprite = this.fxPool.obtain();
      sprite.show(weapon.evolved ? def.fxEvolved : def.fx, TEX.disc, HERO_FX.bone, player.x, player.y, 44, 44, FX_DEPTH + 1);
      const dist = Math.hypot(tx + jx - player.x, ty + jy - player.y) || 1;
      this.urns.push({
        sprite, fromX: player.x, fromY: player.y, toX: tx + jx, toY: ty + jy, tMs: 0, hopsLeft: s.bounces,
        dirX: (tx + jx - player.x) / dist, dirY: (ty + jy - player.y) / dist,
      });
    }
    return true;
  }

  private tickUrns(deltaMs: number): void {
    const s = this.resolved.get('bombs');
    if (s === undefined) return;
    const evolved = this.weapons.find((w) => w.id === 'bombs')?.evolved === true;
    const blastR = s.radius * this.area;
    for (let i = this.urns.length - 1; i >= 0; i -= 1) {
      const u = this.urns[i];
      if (u === undefined) continue;
      u.tMs += deltaMs;
      const t = Math.min(1, u.tMs / URN_HOP_MS);
      const x = u.fromX + (u.toX - u.fromX) * t;
      const y = u.fromY + (u.toY - u.fromY) * t - Math.sin(Math.PI * t) * URN_ARC_PX;
      u.sprite.setPosition(x, y).setRotation(u.tMs * 0.012);
      if (t < 1) continue;
      // Landed: blast, then hop onward (or die).
      this.query(u.toX, u.toY, blastR, this.near);
      for (const e of this.near) this.strike(e, s.damage, 'bombs');
      this.host.hitBreakables(u.toX, u.toY, blastR);
      const blast = evolved ? 'wpn-bombs-blast-evo' : 'wpn-bombs-blast';
      if (!this.oneShot(blast, HERO_FX.bone, u.toX, u.toY, blastR, 0, 300)) this.addShape('ring', u.toX, u.toY, 0, 0, blastR, HERO_FX.bone, 300);
      for (let k = 0; k < s.shards; k += 1) this.throwShard(u.toX, u.toY, s);
      u.hopsLeft -= 1;
      if (u.hopsLeft < 0) {
        this.fxPool.release(u.sprite);
        this.urns[i] = this.urns[this.urns.length - 1] as Urn;
        this.urns.pop();
        continue;
      }
      let nx = u.toX + u.dirX * s.length;
      let ny = u.toY + u.dirY * s.length;
      if (this.host.isBlocked(nx, ny)) {
        u.dirX = -u.dirX;
        u.dirY = -u.dirY;
        nx = u.toX + u.dirX * s.length;
        ny = u.toY + u.dirY * s.length;
      }
      u.fromX = u.toX;
      u.fromY = u.toY;
      u.toX = nx;
      u.toY = ny;
      u.tMs = 0;
    }
  }

  /** Ossuary Barrage bone shard: straight, `shardRange` px, first enemy hit. */
  private throwShard(x: number, y: number, s: WeaponStats): void {
    const a = this.host.rng.float(0, Math.PI * 2);
    const sprite = this.fxPool.obtain();
    sprite.show('wpn-bombs-shard', TEX.spike, HERO_FX.bone, x, y, 26, 26, FX_DEPTH + 1);
    sprite.setRotation(a);
    this.discs.push({
      sprite, x, y, vx: Math.cos(a) * SHARD_SPEED, vy: Math.sin(a) * SHARD_SPEED, damage: s.shardDamage,
      bouncesLeft: 0, travelLeft: s.shardRange, returning: false, evolved: false, hitR: 22, hit: new Set<Enemy>(), source: 'bombs',
    });
  }

  /** Dirge Totem / Cathedral of Bones: plant a pulsing beacon (oldest replaced past `count`). */
  private fireTotem(weapon: WeaponState, s: WeaponStats): boolean {
    const player = this.host.player;
    if (this.host.nearestEnemy(player.x, player.y, s.radius * this.area * 1.5) === null) return false;
    while (this.totems.length >= s.count) {
      const old = this.totems.shift();
      if (old !== undefined) this.fxPool.release(old.sprite);
    }
    const def = weaponDef('totem');
    const sprite = this.fxPool.obtain();
    sprite.show(weapon.evolved ? def.fxEvolved : def.fx, TEX.spike, HERO_FX.violet, player.x, player.y, 110, 110, 9);
    sprite.setOrigin(0.5, 0.85);
    this.totems.push({ sprite, x: player.x, y: player.y, lifeMs: s.durationMs * this.durationMul, pulseMs: 0 });
    return true;
  }

  private tickTotems(deltaMs: number): void {
    const s = this.resolved.get('totem');
    if (s === undefined || this.totems.length === 0) return;
    const evolved = this.weapons.find((w) => w.id === 'totem')?.evolved === true;
    const r = s.radius * this.area;
    const pull = (s.pullPxPerS * deltaMs) / 1000;
    for (let i = this.totems.length - 1; i >= 0; i -= 1) {
      const t = this.totems[i];
      if (t === undefined) continue;
      t.lifeMs -= deltaMs;
      t.pulseMs -= deltaMs;
      if (pull > 0) {
        this.query(t.x, t.y, r, this.near);
        for (const e of this.near) {
          const d = Math.hypot(t.x - e.x, t.y - e.y);
          if (d > 30) e.setPosition(e.x + ((t.x - e.x) / d) * pull, e.y + ((t.y - e.y) / d) * pull);
        }
      }
      if (t.pulseMs <= 0) {
        t.pulseMs += s.tickMs;
        this.query(t.x, t.y, r, this.near);
        for (const e of this.near) this.strike(e, s.damage, 'totem');
        this.host.hitBreakables(t.x, t.y, r);
        const pulse = evolved ? 'wpn-totem-pulse-evo' : 'wpn-totem-pulse';
        // The pulse frames already expand (0.24 → 0.43 of the cell): no scale tween on top.
        if (!this.oneShot(pulse, HERO_FX.violet, t.x, t.y, r, 0, 360)) this.addShape('ring', t.x, t.y, 0, 0, r, HERO_FX.violet, 360);
      }
      if (t.lifeMs <= 0) {
        this.fxPool.release(t.sprite);
        this.totems.splice(i, 1);
      }
    }
  }

  /** Husk Thralls / Legion of the Hollow: summon up to `count` allied minions (bodies live in CombatSystem). */
  private fireThralls(weapon: WeaponState, s: WeaponStats): boolean {
    let spawned = false;
    while (this.host.thrallCount() + this.thrallRespawns.length < s.count) {
      if (!this.host.spawnThrall(this.thrallSpec(weapon, s))) break;
      spawned = true;
    }
    return spawned || this.host.thrallCount() > 0;
  }

  private thrallSpec(weapon: WeaponState, s: WeaponStats): ThrallSpec {
    const evolved = weapon.evolved;
    return {
      hp: s.hp,
      speed: s.speed,
      bite: s.damage * this.host.player.stats.get('damageMul'),
      biteMs: s.tickMs,
      lifeMs: Number.isFinite(s.durationMs) ? s.durationMs * this.durationMul : Number.POSITIVE_INFINITY,
      bodyRadius: s.radius,
      evolved,
      onDeath: evolved ? (x, y) => this.thrallBurst(x, y) : undefined,
    };
  }

  /** Legion of the Hollow: a dying thrall bursts and returns after `respawnMs`. */
  private thrallBurst(x: number, y: number): void {
    const s = this.resolved.get('thralls');
    if (s === undefined) return;
    const r = s.splashRadius * this.area;
    this.query(x, y, r, this.near2);
    for (const e of this.near2) this.strike(e, s.burstDamage, 'thralls');
    this.addShape('ring', x, y, 0, 0, r, HERO_FX.bone, 280);
    this.thrallRespawns.push(s.respawnMs);
  }

  private tickThrallRespawns(deltaMs: number): void {
    if (this.thrallRespawns.length === 0) return;
    const weapon = this.weapons.find((w) => w.id === 'thralls');
    const s = this.resolved.get('thralls');
    for (let i = this.thrallRespawns.length - 1; i >= 0; i -= 1) {
      const left = (this.thrallRespawns[i] as number) - deltaMs;
      this.thrallRespawns[i] = left;
      if (left > 0) continue;
      this.thrallRespawns.splice(i, 1);
      if (weapon !== undefined && s !== undefined) this.host.spawnThrall(this.thrallSpec(weapon, s));
    }
  }

  // ───────────── zones & statuses ─────────────

  private addZone(art: string | null, x: number, y: number, r: number, dps: number, ms: number, slowPct: number, source: WeaponId, tint: number): void {
    const sprite = this.fxPool.obtain();
    const zone = this.zoneFree.pop() ?? { sprite, x: 0, y: 0, r: 0, dps: 0, lifeMs: 0, maxMs: 0, tickMs: 0, slowPct: 0, source };
    zone.sprite = sprite;
    zone.x = x;
    zone.y = y;
    zone.r = r;
    zone.dps = dps * this.riders.dotMul;
    zone.lifeMs = dps > 0 ? ms * this.dotMsMul : ms;
    zone.maxMs = zone.lifeMs;
    zone.tickMs = 0;
    zone.slowPct = slowPct;
    zone.source = source;
    zone.sprite.show(art, TEX.disc, tint, x, y, r * 2, r * 2, 5);
    // Measured art: size so its visible rim (not the cell edge) lands on the hit radius.
    const rim = zone.sprite.usingArt && art !== null ? ART_GEOM[art]?.rim : undefined;
    if (rim !== undefined) zone.sprite.setDisplaySize(r / rim, r / rim);
    zone.sprite.peakAlpha = zone.sprite.usingArt ? 0.9 : PROC_ZONE_ALPHA;
    zone.sprite.setAlpha(zone.sprite.peakAlpha);
    this.zones.push(zone);
  }

  private tickZones(deltaMs: number): void {
    for (let i = this.zones.length - 1; i >= 0; i -= 1) {
      const zone = this.zones[i];
      if (zone === undefined) continue;
      zone.lifeMs -= deltaMs;
      zone.tickMs -= deltaMs;
      if (zone.tickMs <= 0) {
        zone.tickMs += TICK_MS;
        this.query(zone.x, zone.y, zone.r, this.near);
        for (const enemy of this.near) {
          this.strike(enemy, zone.dps * (TICK_MS / 1000), zone.source);
          if (zone.slowPct > 0) this.applySlow(enemy, zone.slowPct / 100, POOL_SLOW_MS);
        }
      }
      if (zone.lifeMs < 400) zone.sprite.setAlpha(Math.max(0, zone.lifeMs / 400) * zone.sprite.peakAlpha);
      if (zone.lifeMs <= 0) {
        this.fxPool.release(zone.sprite);
        this.zones[i] = this.zones[this.zones.length - 1] as Zone;
        this.zones.pop();
        this.zoneFree.push(zone);
      }
    }
  }

  private status(enemy: Enemy): Status {
    let st = this.statuses.get(enemy);
    if (st === undefined || st.health !== enemy.health) {
      st = st ?? this.statusFree.pop() ?? { health: enemy.health, dotDps: 0, dotLeftMs: 0, dotSource: 'hex', tickMs: 0, slowPct: 0, slowLeftMs: 0, rootLeftMs: 0 };
      st.health = enemy.health;
      st.dotDps = 0;
      st.dotLeftMs = 0;
      st.tickMs = TICK_MS;
      st.slowPct = 0;
      st.slowLeftMs = 0;
      st.rootLeftMs = 0;
      this.statuses.set(enemy, st);
    }
    return st;
  }

  /** DoT: the stronger dps wins, duration refreshes to the longer. */
  private applyDot(enemy: Enemy, rawDps: number, ms: number, source: WeaponId): void {
    const dps = rawDps * this.riders.dotMul;
    const st = this.status(enemy);
    if (dps >= st.dotDps || st.dotLeftMs <= 0) {
      st.dotDps = dps;
      st.dotSource = source;
    }
    st.dotLeftMs = Math.max(st.dotLeftMs, ms * this.dotMsMul);
  }

  private applySlow(enemy: Enemy, pct: number, ms: number): void {
    const st = this.status(enemy);
    st.slowPct = Math.max(st.slowLeftMs > 0 ? st.slowPct : 0, pct);
    st.slowLeftMs = Math.max(st.slowLeftMs, ms);
  }

  private applyRoot(enemy: Enemy, ms: number): void {
    const st = this.status(enemy);
    st.rootLeftMs = Math.max(st.rootLeftMs, ms);
  }

  private tickStatuses(deltaMs: number): void {
    for (const [enemy, st] of this.statuses) {
      if (!enemy.active || enemy.health !== st.health || enemy.health.hp <= 0) {
        this.statuses.delete(enemy);
        this.statusFree.push(st);
        continue;
      }
      if (st.dotLeftMs > 0) {
        st.dotLeftMs -= deltaMs;
        st.tickMs -= deltaMs;
        if (st.tickMs <= 0) {
          st.tickMs += TICK_MS;
          this.host.damageEnemy(enemy, st.dotDps * (TICK_MS / 1000) * this.host.player.stats.get('damageMul'), false, st.dotSource);
        }
      }
      const body = enemy.body as Phaser.Physics.Arcade.Body | null;
      if (st.rootLeftMs > 0) {
        st.rootLeftMs -= deltaMs;
        body?.velocity.set(0, 0);
      } else if (st.slowLeftMs > 0) {
        st.slowLeftMs -= deltaMs;
        body?.velocity.scale(1 - st.slowPct);
      }
      if (st.dotLeftMs <= 0 && st.rootLeftMs <= 0 && st.slowLeftMs <= 0) {
        this.statuses.delete(enemy);
        this.statusFree.push(st);
      }
    }
  }

  // ───────────── visuals ─────────────

  /**
   * One-shot ring/crescent art whose measured circle centre sits on (x, y),
   * scaled so its outer rim lands on `radius`, rotated `angle`, fading over `ms`.
   * False (nothing drawn) when the texture is missing — the caller draws its
   * procedural shape instead.
   */
  private oneShot(art: string, tint: number, x: number, y: number, radius: number, angle: number, ms: number, grow = false): boolean {
    if (!this.host.scene.textures.exists(art)) return false;
    const geom = ART_GEOM[art] ?? { originX: 0.5, originY: 0.5, rim: 0.5 };
    const side = radius / geom.rim;
    const fx = this.fxPool.obtain();
    fx.show(art, TEX.disc, tint, x, y, side, side, FX_DEPTH);
    fx.setOrigin(geom.originX, geom.originY).setRotation(angle);
    this.addTimedFx(fx, ms, true, grow, true);
    return true;
  }

  /**
   * +x-pointing strip art stretched so its OPAQUE span runs from (x1, y1) to
   * (x2, y2), `thick` px tall; false when the texture is missing.
   */
  private segment(art: string, x1: number, y1: number, x2: number, y2: number, thick: number, ms: number): boolean {
    if (!this.host.scene.textures.exists(art)) return false;
    const [start, end] = STRIP_SPAN[art] ?? [0, 1];
    const len = Math.max(8, Math.hypot(x2 - x1, y2 - y1));
    const fx = this.fxPool.obtain();
    fx.show(art, TEX.square, HERO_FX.cyan, x1, y1, len / (end - start), thick, FX_DEPTH);
    fx.setOrigin(start, 0.5).setRotation(Math.atan2(y2 - y1, x2 - x1));
    this.addTimedFx(fx, ms, true, false, true);
    return true;
  }

  /** Alpha factor for fx at (x, y): `NEAR_HERO_ALPHA` within `NEAR_HERO_PX` of the hero, else 1. */
  private heroDim(x: number, y: number): number {
    const p = this.host.player;
    const dx = x - p.x;
    const dy = y - p.y;
    return dx * dx + dy * dy < NEAR_HERO_PX * NEAR_HERO_PX ? NEAR_HERO_ALPHA : 1;
  }

  private addTimedFx(sprite: FxSprite, ms: number, fade: boolean, grow = false, undimmed = false): void {
    const fx = this.timedFxFree.pop() ?? { sprite, lifeMs: 0, maxMs: 0, fade, w: 0, h: 0, grow, undimmed };
    fx.sprite = sprite;
    fx.lifeMs = ms;
    fx.maxMs = ms;
    fx.fade = fade;
    fx.w = sprite.displayWidth;
    fx.h = sprite.displayHeight;
    fx.grow = grow;
    fx.undimmed = undimmed;
    this.timedFx.push(fx);
  }

  private tickTimedFx(deltaMs: number): void {
    for (let i = this.timedFx.length - 1; i >= 0; i -= 1) {
      const fx = this.timedFx[i];
      if (fx === undefined) continue;
      fx.lifeMs -= deltaMs;
      const sp = fx.sprite;
      const fade = fx.fade ? Math.max(0, fx.lifeMs / fx.maxMs) : 1;
      sp.setAlpha(sp.peakAlpha * fade * (fx.undimmed ? 1 : this.heroDim(sp.x, sp.y)));
      if (fx.grow) {
        const t = Math.min(1, (1 - fx.lifeMs / fx.maxMs) / GROW_SHARE);
        const k = GROW_FROM + (1 - GROW_FROM) * t * (2 - t);
        sp.setDisplaySize(fx.w * k, fx.h * k);
      }
      if (fx.lifeMs > 0) continue;
      this.fxPool.release(fx.sprite);
      this.timedFx[i] = this.timedFx[this.timedFx.length - 1] as TimedFx;
      this.timedFx.pop();
      this.timedFxFree.push(fx);
    }
  }

  private addShape(kind: Shape['kind'], x: number, y: number, a: number, b: number, r: number, color: number, ms: number): Shape {
    const shape = this.shapeFree.pop() ?? { kind, x: 0, y: 0, a: 0, b: 0, r: 0, color: 0, lifeMs: 0, maxMs: 0, pts: [] };
    shape.kind = kind;
    shape.x = x;
    shape.y = y;
    shape.a = a;
    shape.b = b;
    shape.r = r;
    shape.color = color;
    shape.lifeMs = ms;
    shape.maxMs = Math.max(1, ms);
    shape.pts.length = 0;
    this.shapes.push(shape);
    return shape;
  }

  /** Redraws every live procedural shape on the shared Graphics (one clear per frame). */
  private drawShapes(deltaMs: number): void {
    const g = this.graphics;
    g.clear();
    for (let i = this.shapes.length - 1; i >= 0; i -= 1) {
      const sh = this.shapes[i];
      if (sh === undefined) continue;
      sh.lifeMs -= deltaMs;
      if (sh.lifeMs <= 0) {
        this.shapes[i] = this.shapes[this.shapes.length - 1] as Shape;
        this.shapes.pop();
        this.shapeFree.push(sh);
        continue;
      }
      const k = (sh.lifeMs / sh.maxMs) * this.heroDim(sh.x, sh.y);
      switch (sh.kind) {
        case 'arc':
          g.fillStyle(sh.color, 0.32 * k);
          g.slice(sh.x, sh.y, sh.r, sh.a - sh.b, sh.a + sh.b, false);
          g.fillPath();
          g.lineStyle(4, sh.color, 0.8 * k);
          g.beginPath();
          g.arc(sh.x, sh.y, sh.r, sh.a - sh.b, sh.a + sh.b, false);
          g.strokePath();
          break;
        case 'beam':
          g.lineStyle(sh.r, sh.color, 0.35 * k);
          g.lineBetween(sh.x, sh.y, sh.a, sh.b);
          g.lineStyle(Math.max(2, sh.r * 0.3), sh.color, 0.7 * k);
          g.lineBetween(sh.x, sh.y, sh.a, sh.b);
          break;
        case 'chain':
          g.lineStyle(sh.r, sh.color, 0.9 * k);
          g.beginPath();
          for (let p = 0; p + 1 < sh.pts.length; p += 2) {
            const px = sh.pts[p] ?? 0;
            const py = sh.pts[p + 1] ?? 0;
            if (p === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
          g.strokePath();
          break;
        case 'ring': {
          // Telegraph rings grow in; blast rings fade out.
          g.fillStyle(sh.color, 0.2 * k);
          g.fillCircle(sh.x, sh.y, sh.r);
          g.lineStyle(3, sh.color, 0.85 * this.heroDim(sh.x, sh.y));
          g.strokeCircle(sh.x, sh.y, sh.r * (1 - 0.3 * k));
          break;
        }
      }
    }
  }
}
