import Phaser from 'phaser';
import { FONT, TUNING } from '../config';
import { TEX } from '../core/keys';
import { playable, safePlay } from '../core/anim';
import { Health } from '../core/damage';
import { ACTOR_FX, ensureOutline, measuredSubjectHeight, outlineKey, shadowTexture, type OutlinePx } from '../core/outline';
import {
  SUBJECT_HEIGHT,
  actionScale,
  actorBaseKey,
  bodyRadiusOf,
  eliteStats,
  frontalMul,
  scaleEnemy,
  visiblePxOf,
  type EnemyDef,
} from '../data/enemies';
import { affixDef } from '../data/eliteAffixes';
import { ICON, artFacesRight, type ArtSlot } from '../data/art';
import type { EliteAffixId, ZoneId } from '../data/types-v2';
import { Bar } from '../ui/bars';
import { compassRects } from '../ui/gateCompass';

/**
 * Pooled enemy body (PRD-V2 §5.4-5.6). One instance is reused for every
 * archetype, elite promotion, den mid-boss and zone boss: `spawnWith` re-skins
 * it, `despawn` parks it. Behaviour is a switch over `EnemyBehaviour`; every
 * number comes from `EnemyDef.params` or `TUNING`.
 *
 * Presentation (§13.1): the body plays BAKED outlined sheets (`-ol` trash,
 * `-ol4` elite/mid-boss, `-ol5` boss), is sized so its silhouette is exactly
 * `visiblePx` tall (sheet subject height from `SUBJECT_HEIGHT` / the bake's
 * own measurement), stands on a pooled `fx-shadow`, and elites carry a
 * `#7a0000` glow pulse ring, a 28 px affix icon and a name plate.
 *
 * Everything this body cannot resolve alone (shots, telegraphed strikes,
 * ground zones, summons, player pulls) goes through `EnemyHost`, implemented
 * by `systems/combat.ts`. Telegraphs are ≥ 500 ms for every hit ≥ 20 dmg.
 */

export type BossPhase = 1 | 2 | 3;

/** A telegraphed hostile strike, resolved by the host when the telegraph ends. */
export interface StrikeSpec {
  shape: 'circle' | 'arc' | 'line';
  x: number;
  y: number;
  /** circle/arc radius, or line length. */
  r: number;
  /** arc facing / line heading (radians). */
  angle?: number;
  arcDeg?: number;
  /** line half-width. */
  width?: number;
  telegraphMs: number;
  damage: number;
  slowPct?: number;
  slowMs?: number;
  /** Pulls the hero this many px toward (x, y) (hook). */
  pullPx?: number;
  /** Killer label for `onPlayerDied`. */
  source: string;
  /** The body that owns the strike (its `damageCap` applies). Set by `Enemy.strike`. */
  owner?: Enemy;
  /** `owner.uid` at strike time — a pooled body recycled meanwhile no longer matches. */
  ownerUid?: string;
  /** One-shot FX animation key played at the strike point when it lands. */
  fx?: string;
  /** Runs when the telegraph resolves (after damage). */
  onFire?: () => void;
}

/** Everything an enemy asks of the combat core. */
export interface EnemyHost {
  readonly scene: Phaser.Scene;
  /** Hero position and velocity (read-only views). */
  readonly hero: { x: number; y: number; vx: number; vy: number };
  /** Zone-boss phase 2 / phase 3 HP-ratio thresholds (hazard `bossPhaseAt`). */
  readonly bossPhaseAt: readonly [number, number];
  /** Run-wide move-speed multiplier on every body (Hastened Dead mutator). */
  readonly enemySpeedMul: number;
  /** Flow-field direction toward the hero at (x, y) into `out`; false = straight-steer. */
  flowDir(x: number, y: number, out: { x: number; y: number }): boolean;
  shoot(from: Enemy, angle: number, speed: number, sizePx: number, damage: number): void;
  strike(spec: StrikeSpec): void;
  groundZone(x: number, y: number, r: number, slowPct: number, lifeMs: number, tint: number, dps: number, source: string): void;
  auraPulse(from: Enemy): void;
  summon(from: Enemy, defId: string, count: number, radius: number): void;
  slowHero(pct: number, ms: number): void;
  /** Adds (vx, vy) px/s of external drift to the hero this frame (magnetic, gust). */
  driftHero(vx: number, vy: number): void;
  /** Toll rings: `count` rings expanding from `from` to `to` px at `speed` px/s. */
  tollRings(x: number, y: number, count: number, from: number, to: number, speed: number, damage: number, source: string): void;
  /** Sweeping beam anchored on `owner`. */
  beam(owner: Enemy, startAngle: number, degPerS: number, length: number, durationMs: number, damage: number, tickMs: number): void;
  /** Temporary static blockers (sand pillars, glacier walls). */
  walls(points: readonly { x: number; y: number }[], radius: number, lifeMs: number, texture: string): void;
  /** Rally banner: +`mul` spawn rate within `r` for `ms` (read by the director via `CombatSystem.rallyMul`). */
  rally(x: number, y: number, r: number, mul: number, ms: number): void;
  /** Eggs that hatch `hatch` × `defId` each after `ms`. */
  eggs(x: number, y: number, count: number, hatch: number, defId: string, ms: number): void;
}

/** §13.2 telegraph palette. */
export const TELEGRAPH = { fill: 0xe8c547, lethal: 0xff2d2d } as const;

const DEFAULT_SUMMON_CD_MS = 14000;
/** Affix icon lookup (§11 `icon-affix-<id>` → sheet cell). */
const AFFIX_ICONS: Readonly<Record<string, ArtSlot>> = ICON;
/** §14.10 minimap window in screen design px (`ui/minimap.ts` WIN); plates keep out of it. */
const MINIMAP_RECT = { x: 520, y: 152, size: 160 } as const;
/** Held-off elites orbit this far beyond `wave.eliteNearPx` (critic B3). */
const HOLD_OFF_EXTRA_PX = 300;
/** Screen centre x (720-wide design): chips left of it push plates right, others left. */
const VIEW_CENTER_X = 360;
/** Pack spread: each swarm member holds this share of its own body per pack member as lateral offset. */
const SWARM_SPREAD = 0.25;
/** Feet line of the generated sheets (`anchorYMean` ≈ 0.846 of the 256 cell). */
const FEET_Y = 0.846;
/** Shadow width as a share of `visiblePx`. */
const SHADOW_W = 0.9;
const STUCK_SAMPLE_MS = 500;
const STUCK_MOVE_PX = 8;

function requireParam(def: EnemyDef, key: string): number {
  const value = def.params?.[key];
  if (value === undefined) throw new Error(`Enemy "${def.id}" (${def.behaviour}) is missing required param "${key}"`);
  return value;
}

function optionalParam(def: EnemyDef, key: string): number | undefined {
  return def.params?.[key];
}

let uidCounter = 0;

export interface SpawnOptions {
  elite?: EliteAffixId | null;
  /** POI population tag (lair/den/vault/event id); null = ambient. */
  source?: string | null;
  /** Lair guards sleep until the hero is within `poi.lair.wakePx`. */
  dormant?: boolean;
}

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  def!: EnemyDef;
  health!: Health;
  host!: EnemyHost;
  /** Unique per spawn (not per pooled instance) — `spawnPopulation` returns these. */
  uid = '';
  damage = 0;
  xpValue = 0;
  shardValue = 0;
  /** §5.4 contact reach = bodyRadius + hero bodyRadius. */
  contactReach = 0;
  bodyRadius = 0;
  visiblePx = 0;
  lastContactAt = 0;
  splitBudget = 0;
  /** Resolved plain loop key (fallback applied). */
  artKey = '';
  /** Outlined death key the corpse plays; plain when no outline was baked. */
  deathKey = '';
  /** Display cell size of the loop sheet (corpse sizing). */
  displaySize = 0;
  affix: EliteAffixId | null = null;
  /** Name as shown on plates and in `Slain by <Name>`. */
  displayName = '';
  /** POI population tag, or null for ambient spawns. */
  source: string | null = null;
  dormant = false;
  /** Boss/mid-boss phase-2 shield while adds live (zone boss only). */
  shielded = false;
  bossPhase: BossPhase = 1;
  /** Leash bookkeeping (combat-owned). */
  offscreenMs = 0;
  /** Stuck detection (combat reads `stuckMs`). */
  stuckMs = 0;
  /** Heading in radians (movement or facing the hero) — frontal DR reads it. */
  facing = 0;
  /**
   * Per-hit damage ceiling for everything this body deals (contact, shots,
   * owned strikes); null = uncapped. Set by the scene (Gate B guard, critic C1).
   */
  damageCap: number | null = null;
  /** Where this body was seated — POI/event bodies leash back here (critic B2). */
  homeX = 0;
  homeY = 0;
  /**
   * Critic B3: set by combat when more than `wave.eliteNearCap` elites are within
   * `wave.eliteNearPx` of the hero — this one holds an orbit farther out instead.
   */
  holdOff = false;
  /** Plate slot among near elites: ≥ 0 shown, −1 hidden (combat-assigned). */
  plateSlot = 0;
  /** Extra lift (px) that stacks this plate above an overlapping one. */
  plateLift = 0;
  private eliteDecor = false;

  private speed = 0;
  private baseSpeed = 0;
  private stateMs = 0;
  private dashMs = 0;
  private orbitAngle = 0;
  private enraged = false;
  private hasteMs = 0;
  private hasteMul = 0;
  private frozenMs = 0;
  private abilityMs = 0;
  private abilityBMs = 0;
  private summonMs = 0;
  private telegraphMs = 0;
  /** revive: remaining collapse ms, and whether the one revive was spent. */
  private collapseMs = 0;
  private revived = false;
  /** warded: cycle clock. */
  private wardMs = 0;
  /** plagued/trail: walking accumulator toward the next pool. */
  private trailMs = 0;
  /** vampiric: healed this second (cap), and the window clock. */
  private leechWindowMs = 0;
  private leechHealed = 0;
  /** Burrow (desert boss): hidden until the surface strike lands. */
  private burrowed = false;
  /** Spiral (outlands boss phase 3) volley state. */
  private spiralMs = 0;
  private spiralTickMs = 0;
  private spiralAngle = 0;
  /** Triple reap (castle mid-boss) remaining sweeps. */
  private reapLeft = 0;
  private sampleMs = 0;
  private sampleX = 0;
  private sampleY = 0;

  private loopKey = '';
  private actionMs = 0;
  private olPx: OutlinePx = 3;
  private readonly steer = { x: 0, y: 0 };

  private bar: Bar | null = null;
  private shadow: Phaser.GameObjects.Image | null = null;
  private eliteRing: Phaser.GameObjects.Image | null = null;
  private affixIcon: Phaser.GameObjects.Image | null = null;
  private plate: Phaser.GameObjects.Text | null = null;
  private stateRing: Phaser.GameObjects.Image | null = null;
  /** Rime Stalker: outline-only companion that stays at 100% while the body fades. */
  private ringSprite: Phaser.GameObjects.Sprite | null = null;
  private ringKey = '';

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, TEX.disc);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setActive(false).setVisible(false).setDepth(10);
    this.disableBody();
  }

  /** Every telegraphed strike this body lands goes through here, tagged with its owner. */
  private strike(spec: StrikeSpec): void {
    // Cap captured now: the body may be recycled before the telegraph resolves.
    const damage = this.damageCap !== null ? Math.min(spec.damage, this.damageCap) : spec.damage;
    this.host.strike({ ...spec, damage, owner: this, ownerUid: this.uid });
  }

  /** Heading used when the body sits exactly on the hero (breakout direction). */
  orbitHeading(): number {
    return this.orbitAngle;
  }

  get isElite(): boolean {
    return this.affix !== null && this.def.rank === 'trash';
  }

  get bossKind(): 'zone' | 'mid' | null {
    return this.def.rank === 'boss' ? 'zone' : this.def.rank === 'midboss' ? 'mid' : null;
  }

  /** True while hits do nothing (warded window, revive collapse, burrowed). */
  get immune(): boolean {
    if (this.collapseMs > 0 || this.burrowed) return true;
    if (this.affix !== 'warded') return false;
    const w = TUNING.elite.affixes.warded;
    return this.wardMs % w.everyMs >= w.everyMs - w.immuneMs;
  }

  spawnWith(host: EnemyHost, def: EnemyDef, x: number, y: number, difficultyMul: number, elapsedS: number, opts: SpawnOptions = {}): void {
    this.host = host;
    this.def = def;
    this.uid = `e${(uidCounter += 1)}`;
    this.affix = opts.elite ?? def.fixedAffix ?? null;
    const elite = this.isElite;
    const stats = elite ? eliteStats(def, difficultyMul) : scaleEnemy(def, difficultyMul, elapsedS);
    this.health = new Health(stats.maxHp);
    this.damage = stats.damage;
    this.baseSpeed = stats.moveSpeed * (this.affix === 'hasted' ? TUNING.elite.affixes.hasted.moveMul : 1);
    this.speed = this.baseSpeed;
    this.xpValue = stats.xp;
    this.shardValue = stats.shards;
    this.visiblePx = visiblePxOf(def, elite);
    this.bodyRadius = bodyRadiusOf(def, elite);
    this.contactReach = this.bodyRadius + TUNING.player.bodyRadius;
    this.source = opts.source ?? null;
    this.dormant = opts.dormant === true;
    this.displayName = this.affix !== null && def.rank === 'trash' ? `${affixDef(this.affix).name} ${def.name}` : def.name;
    this.lastContactAt = 0;
    this.stateMs = 0;
    this.dashMs = 0;
    this.telegraphMs = 0;
    this.enraged = false;
    this.hasteMs = 0;
    this.hasteMul = 0;
    this.frozenMs = 0;
    this.collapseMs = 0;
    this.revived = false;
    this.wardMs = 0;
    this.trailMs = 0;
    this.leechWindowMs = 0;
    this.leechHealed = 0;
    this.burrowed = false;
    this.spiralMs = 0;
    this.reapLeft = 0;
    this.bossPhase = 1;
    this.shielded = false;
    this.offscreenMs = 0;
    this.stuckMs = 0;
    this.sampleMs = 0;
    this.sampleX = x;
    this.sampleY = y;
    this.homeX = x;
    this.homeY = y;
    this.damageCap = null;
    this.holdOff = false;
    this.plateSlot = 0;
    this.plateLift = 0;
    // Bug fix (§5.4): the orbit/pack angle is measured from the HERO, not the screen centre.
    this.orbitAngle = Math.atan2(y - host.hero.y, x - host.hero.x);
    this.facing = this.orbitAngle + Math.PI;
    this.abilityMs = this.initialAbilityMs(def);
    this.abilityBMs = this.abilityMs * 1.5;
    this.summonMs = 0;
    this.splitBudget = def.behaviour === 'split' ? requireParam(def, 'splitGenerations') : 0;

    const scene = this.scene;
    this.artKey = scene.textures.exists(def.texture) || def.fallbackTexture === undefined ? def.texture : def.fallbackTexture;
    this.olPx = def.rank === 'boss' ? (TUNING.outline.bossPx as OutlinePx) : def.rank === 'midboss' || elite ? (TUNING.outline.elitePx as OutlinePx) : (TUNING.outline.enemyPx as OutlinePx);
    const subject = SUBJECT_HEIGHT[this.artKey] ?? measuredSubjectHeight(this.artKey) ?? 160;
    this.displaySize = Math.round((this.visiblePx * 256) / subject);
    this.loopKey = this.artKey;
    this.actionMs = 0;
    const base = actorBaseKey(this.artKey);
    // Corpses keep the 3 px death (§13.1: elite re-bake covers living anims only).
    this.deathKey = this.outlined(`${base}-death`, this.olPx === 4 && def.rank === 'trash' ? 3 : this.olPx);

    this.setPosition(x, y);
    this.clearTint();
    this.setAlpha(1);
    this.setAngle(0);
    this.setActive(true).setVisible(true);
    this.enableBody(false, x, y, true, true);
    this.showAnim(this.loopKey);
    // (x, y) is the SILHOUETTE centre, not the cell centre: sheets are feet-aligned
    // at `FEET_Y`, so a short subject (matron, worm, crawler) sits low in its cell.
    // The origin moves there and the `bodyRadius` hitbox is centred on it.
    const cy = FEET_Y * 256 - subject / 2;
    this.setOrigin(0.5, cy / 256);
    const scale = this.displaySize / 256;
    const rs = this.bodyRadius / scale;
    this.body?.setCircle(rs, 128 - rs, cy - rs);
    this.setVelocity(0, 0);
    const body = this.body as Phaser.Physics.Arcade.Body | null;
    if (body !== null) body.checkCollision.none = def.behaviour === 'drift';

    this.armDecor();
  }

  /** Outlined variant of `key` at this body's px (lazily baked), or the plain key. */
  private outlined(key: string, px: OutlinePx = this.olPx): string {
    if (!this.scene.textures.exists(key)) return key;
    const ol = outlineKey(key, px);
    if (this.scene.textures.exists(ol)) return ol;
    return ensureOutline(this.scene, {
      key,
      px,
      color: TUNING.outline.enemyColor,
      displayPx: this.displaySize * actionScale(this.artKey, key),
      glow: px === 5 ? 0x3a0000 : undefined,
    });
  }

  private armDecor(): void {
    const scene = this.scene;
    const def = this.def;
    this.shadow ??= scene.add.image(0, 0, shadowTexture(scene)).setDepth(8);
    const sw = this.visiblePx * SHADOW_W;
    this.shadow
      .setTexture(shadowTexture(scene))
      .setDisplaySize(sw, sw * 0.4)
      .setAlpha(0.35)
      .setVisible(!Enemy.lowTier || def.rank !== 'trash' || this.affix !== null);

    const elite = this.isElite || def.rank === 'midboss';
    this.eliteDecor = elite;
    if (elite) {
      this.eliteRing ??= scene.add.image(0, 0, ACTOR_FX.eliteRing).setDepth(9);
      this.eliteRing.setTint(TUNING.outline.eliteGlow).setDisplaySize(this.visiblePx * 1.25, this.visiblePx * 1.25).setAlpha(0.35).setVisible(true);
      scene.tweens.killTweensOf(this.eliteRing);
      scene.tweens.add({ targets: this.eliteRing, alpha: 0.85, duration: 400, yoyo: true, repeat: -1 });
      if (this.affix !== null) {
        const slot = AFFIX_ICONS[affixDef(this.affix).icon];
        this.affixIcon ??= scene.add.image(0, 0, TEX.disc).setDepth(12);
        if (slot !== undefined && scene.textures.exists(slot.key)) this.affixIcon.setTexture(slot.key, slot.frame).clearTint();
        else this.affixIcon.setTexture(TEX.disc).setTint(affixDef(this.affix).ring);
        this.affixIcon.setDisplaySize(28, 28).setVisible(true);
      }
      this.plate ??= scene.add.text(0, 0, '', { fontFamily: FONT.family, fontSize: '20px', color: '#ffb3a0', stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5).setDepth(12);
      this.plate.setText(this.displayName).setVisible(true);
      this.bar ??= new Bar(scene, this.x, this.y, 120, 12);
      this.bar.setVisible(true);
      this.bar.setValue(this.health.hp, this.health.max);
      // Positioned by `syncDecor` (not `followTarget`) so it shares the plate's minimap clamp.
      this.bar.stopFollow();
    } else {
      this.hideEliteDecor();
    }
    if (def.rank === 'boss') this.shadow.setDisplaySize(this.visiblePx, this.visiblePx * 0.4);

    if (def.behaviour === 'stalk') {
      const ringKey = ensureOutline(scene, { key: this.artKey, px: this.olPx, color: TUNING.outline.enemyColor, displayPx: this.displaySize, ringOnly: true });
      this.ringKey = ringKey;
      this.ringSprite ??= scene.add.sprite(0, 0, ringKey).setDepth(10.5);
      this.ringSprite.setTexture(ringKey).setVisible(ringKey !== this.artKey);
    } else if (this.ringSprite !== null) {
      this.ringSprite.setVisible(false);
    }
    this.syncDecor();
  }

  private hideEliteDecor(): void {
    this.eliteDecor = false;
    if (this.eliteRing !== null) {
      this.scene.tweens.killTweensOf(this.eliteRing);
      this.eliteRing.setVisible(false);
    }
    this.affixIcon?.setVisible(false);
    this.plate?.setVisible(false);
    if (this.bar !== null) {
      this.bar.stopFollow();
      this.bar.setVisible(false);
    }
  }

  /** Keeps shadow / ring / icon / plate / stalk ring on the body. */
  syncDecor(): void {
    const feet = this.y + this.visiblePx / 2;
    this.shadow?.setPosition(this.x, feet);
    this.eliteRing?.setPosition(this.x, this.y);
    this.stateRing?.setPosition(this.x, this.y);
    const top = this.y - this.visiblePx / 2;
    if (this.plate !== null && this.eliteDecor) {
      // Critic F14: keep the name plate, affix icon and HP bar out of the §14.10 minimap rect.
      const view = this.scene.cameras.main.worldView;
      let px = this.x;
      const lift = this.plateLift;
      const sy = top - 52 - lift - view.y;
      const half = Math.max(this.plate.width / 2, 60);
      if (sy > MINIMAP_RECT.y - 20 && sy < MINIMAP_RECT.y + MINIMAP_RECT.size + 20 && px - view.x + half > MINIMAP_RECT.x - 8) {
        px = view.x + MINIMAP_RECT.x - 8 - half;
      }
      // Critic v2d M2: compass chips keep priority; the plate block (name, icon, bar) moves inboard.
      const top0 = sy - 14;
      const bottom0 = sy + 14 + 60;
      for (const r of compassRects(this.scene)) {
        const left = px - view.x - half;
        const right = px - view.x + half;
        if (right < r.x || left > r.x + r.w || bottom0 < r.y || top0 > r.y + r.h) continue;
        px = r.x < VIEW_CENTER_X ? view.x + r.x + r.w + 8 + half : view.x + r.x - 8 - half;
      }
      // Critic B3: only the nearest `wave.eliteNearCap` elites show plate + bar (slot ≥ 0).
      const shown = this.plateSlot >= 0;
      this.plate.setVisible(shown).setPosition(px, top - 52 - lift);
      this.bar?.setVisible(shown).setPosition(px, top - 8 - lift);
      this.affixIcon?.setPosition(px, top - 26 - lift);
    }
    if (this.ringSprite !== null && this.ringSprite.visible) {
      this.ringSprite
        .setOrigin(this.originX, this.originY)
        .setPosition(this.x, this.y)
        .setDisplaySize(this.displayWidth, this.displayHeight)
        .setFlipX(this.flipX);
      if (this.ringSprite.texture.key === this.ringKey && this.frame.name !== this.ringSprite.frame.name) this.ringSprite.setFrame(this.frame.name);
    }
  }

  private initialAbilityMs(def: EnemyDef): number {
    switch (def.behaviour) {
      case 'ranged':
        return requireParam(def, 'fireEveryMs');
      case 'teleport':
        return requireParam(def, 'blinkEveryS') * 1000;
      case 'aura':
        return TUNING.enemy.healAuraIntervalMs;
      case 'lob':
      case 'hook':
      case 'scream':
        return requireParam(def, 'cdMs') * 0.5;
      case 'trail':
        return requireParam(def, 'dropEveryMs');
      case 'midboss':
      case 'boss':
        return 2500;
      default: {
        const slam = optionalParam(def, 'slamEveryS');
        const dive = optionalParam(def, 'diveEveryS');
        const web = optionalParam(def, 'webEveryS');
        return (slam ?? dive ?? web ?? 0) * 1000;
      }
    }
  }

  despawn(): void {
    this.setActive(false).setVisible(false);
    this.setVelocity(0, 0);
    this.disableBody();
    this.shadow?.setVisible(false);
    this.hideEliteDecor();
    this.ringSprite?.setVisible(false);
    this.clearStateRing();
    this.actionMs = 0;
  }

  /** §15 low-tier fallback: trash bodies drop their ground shadow (elites/bosses keep theirs). */
  static lowTier = false;

  /** Re-applies the low-tier shadow rule to a live body. */
  applyLowTier(): void {
    if (this.def.rank === 'trash' && this.affix === null) this.shadow?.setVisible(!Enemy.lowTier);
  }

  /**
   * Shows `key` (outlined when baked) at this action's display size. The
   * frame is switched FIRST: `setDisplaySize` divides by the current frame's
   * size, and a pooled body may still hold a 128 px placeholder frame.
   */
  private showAnim(key: string): void {
    const size = this.displaySize * actionScale(this.artKey, key);
    const ol = this.outlined(key);
    if (!safePlay(this, ol, true) && !safePlay(this, key, true)) this.setTexture(this.scene.textures.exists(ol) ? ol : key, 0);
    this.setDisplaySize(size, size);
  }

  /** Plays a one-shot action and returns to the loop; false when the sheet does not exist or has no frames. */
  private playAction(suffix: string): boolean {
    const key = `${actorBaseKey(this.artKey)}-${suffix}`;
    const anim = this.scene.anims.get(key);
    if (anim === null || anim === undefined || !playable(this.scene.anims, key)) return false;
    this.actionMs = anim.duration > 0 ? anim.duration : anim.msPerFrame * anim.frames.length;
    this.showAnim(key);
    return true;
  }

  private tickAction(deltaMs: number): void {
    if (this.actionMs <= 0) return;
    this.actionMs -= deltaMs;
    if (this.actionMs <= 0) this.showAnim(this.loopKey);
  }

  syncBar(): void {
    if (this.bar !== null && this.bar.visible) this.bar.setValue(this.health.hp, this.health.max);
  }

  /** Salt / freeze: AI and movement stop for `ms`. */
  freeze(ms: number): void {
    this.frozenMs = Math.max(this.frozenMs, ms);
    this.setVelocity(0, 0);
  }

  applyHaste(speedMul: number): void {
    this.hasteMul = Math.max(this.hasteMul, speedMul);
    this.hasteMs = TUNING.enemy.healAuraIntervalMs * 1.5;
  }

  /** Contact damage this body deals now (frenzied bonus included). */
  contactDamage(): number {
    return this.frenzyActive() ? this.damage * TUNING.elite.affixes.frenzied.damageMul : this.damage;
  }

  /**
   * Multiplier a hit from (sx, sy) takes: immunity windows, bulwark/shielded
   * frontal 180°, zone-boss phase-2 shield. One function, read by every
   * damage route (`CombatSystem.hitEnemy`).
   */
  damageTakenMul(sx: number, sy: number): number {
    if (this.immune) return 0;
    let mul = 1;
    if (this.def.behaviour === 'shield') {
      mul *= frontalMul(this.x, this.y, this.facing, sx, sy, requireParam(this.def, 'frontalArcDeg'), requireParam(this.def, 'frontalDamageMul'));
    }
    if (this.affix === 'shielded') mul *= frontalMul(this.x, this.y, this.facing, sx, sy, 180, TUNING.elite.affixes.shielded.frontalDamageMul);
    if (this.shielded) mul *= TUNING.boss.shieldDamageMul;
    return mul;
  }

  /** Vampiric: heal from damage dealt to the hero, capped per second. */
  onDealtDamage(amount: number): void {
    if (this.affix !== 'vampiric') return;
    const v = TUNING.elite.affixes.vampiric;
    const cap = this.health.max * v.capPctMaxHpPerS - this.leechHealed;
    const heal = Math.min(amount * v.healPct, Math.max(0, cap));
    if (heal <= 0) return;
    this.leechHealed += heal;
    this.health.heal(heal);
    this.syncBar();
  }

  /**
   * Lethal-hit hook (called by combat when `Health.apply` reports death).
   * Returns true when the body refuses to die (Sand Revenant collapses and
   * rises once at `reviveHpRatio`).
   */
  interceptDeath(): boolean {
    if (this.def.behaviour !== 'revive' || this.revived) return false;
    this.revived = true;
    this.collapseMs = requireParam(this.def, 'collapseMs');
    this.setVelocity(0, 0);
    // Art contract: play death, hold its last frame (sand mound) for the collapse.
    this.playAction('death');
    this.actionMs = this.collapseMs + 10;
    return true;
  }

  private frenzyActive(): boolean {
    return this.affix === 'frenzied' && this.health.ratio < TUNING.elite.affixes.frenzied.belowHpRatio;
  }

  tickAi(deltaMs: number, targetX: number, targetY: number): void {
    this.stateMs += deltaMs;
    this.tickAction(deltaMs);
    this.syncDecor();
    if (this.frozenMs > 0) {
      this.frozenMs -= deltaMs;
      this.setVelocity(0, 0);
      return;
    }
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (this.dormant) {
      this.setVelocity(0, 0);
      if (dist <= TUNING.poi.lair.wakePx) this.dormant = false;
      return;
    }
    if (this.collapseMs > 0) {
      this.collapseMs -= deltaMs;
      this.setVelocity(0, 0);
      if (this.collapseMs <= 0) {
        this.health.revive(this.health.max * requireParam(this.def, 'reviveHpRatio'));
        this.syncBar();
        this.actionMs = 0;
        if (!this.playAction('revive')) this.showAnim(this.loopKey);
      }
      return;
    }
    this.tickSpeed(deltaMs);
    this.tickAffix(deltaMs, dx, dy, dist);
    if (this.holdOff) {
      // Critic B3: an elite beyond the near cap circles at `eliteNearPx + 300` and waits its turn.
      const ring = TUNING.wave.eliteNearPx + HOLD_OFF_EXTRA_PX;
      this.orbitAngle += (deltaMs / 1000) * (this.speed / ring) * 0.6;
      const wantX = targetX + Math.cos(this.orbitAngle) * ring - this.x;
      const wantY = targetY + Math.sin(this.orbitAngle) * ring - this.y;
      this.straight(wantX, wantY, Math.hypot(wantX, wantY) || 1, 1);
      this.facing = Math.atan2(dy, dx);
      this.setFlipX(artFacesRight(this.artKey) ? Math.cos(this.facing) < 0 : Math.cos(this.facing) > 0);
      return;
    }
    const cdScale = this.affix === 'hasted' ? 1 / TUNING.elite.affixes.hasted.attackCdMul : 1;
    const abilityDelta = deltaMs * cdScale;

    switch (this.def.behaviour) {
      case 'chase':
        this.chase(dx, dy, dist, 1);
        this.tickOptionalWeb(abilityDelta);
        break;
      case 'swarm':
        this.tickSwarm(dx, dy, dist);
        break;
      case 'ranged':
        this.tickRanged(abilityDelta, dx, dy, dist);
        break;
      case 'orbit-charge':
        this.tickOrbitCharge(deltaMs, abilityDelta, dx, dy, dist, targetX, targetY);
        break;
      case 'tank':
        this.tickTank(abilityDelta, dx, dy, dist);
        break;
      case 'drift':
        this.straight(dx, dy, dist, 1);
        break;
      case 'burst':
      case 'shield':
      case 'revive':
        this.chase(dx, dy, dist, 1);
        break;
      case 'split':
        this.chase(dx, dy, dist, 1);
        break;
      case 'aura':
        this.tickAura(abilityDelta, dx, dy, dist);
        break;
      case 'flee':
        this.straight(-dx, -dy, dist, 1);
        break;
      case 'teleport':
        this.tickTeleport(abilityDelta, dx, dy, dist);
        break;
      case 'lob':
        this.tickLob(abilityDelta, dx, dy, dist, targetX, targetY);
        break;
      case 'hook':
        this.tickHook(abilityDelta, dx, dy, dist);
        break;
      case 'scream':
        this.tickScream(abilityDelta, dx, dy, dist);
        break;
      case 'trail':
        this.chase(dx, dy, dist, 1);
        this.tickTrail(deltaMs);
        break;
      case 'stalk':
        this.chase(dx, dy, dist, 1);
        this.setAlpha(dist <= requireParam(this.def, 'revealPx') ? 1 : requireParam(this.def, 'hiddenAlpha'));
        break;
      case 'midboss':
        this.tickMidBoss(abilityDelta, dx, dy, dist);
        break;
      case 'boss':
        this.tickBoss(abilityDelta, dx, dy, dist);
        break;
    }
    this.tickStuck(deltaMs, dist);
    this.setFlipX(artFacesRight(this.artKey) ? Math.cos(this.facing) < 0 : Math.cos(this.facing) > 0);
  }

  private tickSpeed(deltaMs: number): void {
    if (this.hasteMs > 0) {
      this.hasteMs -= deltaMs;
      if (this.hasteMs <= 0) this.hasteMul = 0;
    }
    let s = this.enraged ? requireParam(this.def, 'enragedMoveSpeed') : this.baseSpeed;
    s *= (1 + this.hasteMul) * this.host.enemySpeedMul;
    if (this.frenzyActive()) s *= TUNING.elite.affixes.frenzied.speedMul;
    if (this.def.rank === 'boss' && this.bossPhase === 3) s *= TUNING.boss.enrageSpeedMul;
    this.speed = s;
  }

  private tickAffix(deltaMs: number, dx: number, dy: number, dist: number): void {
    if (this.affix === null) return;
    this.leechWindowMs += deltaMs;
    if (this.leechWindowMs >= 1000) {
      this.leechWindowMs = 0;
      this.leechHealed = 0;
    }
    switch (this.affix) {
      case 'warded': {
        this.wardMs += deltaMs;
        this.setStateRing(this.immune ? affixDef('warded').ring : null, 1.3);
        break;
      }
      case 'frenzied':
        this.setStateRing(this.frenzyActive() ? affixDef('frenzied').ring : null, 1.2);
        break;
      case 'magnetic': {
        const m = TUNING.elite.affixes.magnetic;
        if (dist <= m.radius) this.host.driftHero((-dx / dist) * m.pullPxPerS, (-dy / dist) * m.pullPxPerS);
        this.setStateRing(affixDef('magnetic').ring, (m.radius * 2) / this.visiblePx, 0.2);
        break;
      }
      case 'plagued': {
        const p = TUNING.elite.affixes.plagued;
        if (Math.abs(this.body?.velocity.x ?? 0) + Math.abs(this.body?.velocity.y ?? 0) > 10) this.trailMs += deltaMs;
        if (this.trailMs >= p.everyMs) {
          this.trailMs = 0;
          this.host.groundZone(this.x, this.y, p.radius, 0, p.durationMs, affixDef('plagued').ring, p.dps, this.displayName);
        }
        break;
      }
      default:
        break;
    }
  }

  /** A persistent coloured ring under the body (warded/frenzied/magnetic state reads). */
  private setStateRing(color: number | null, sizeMul: number, alpha = 0.7): void {
    if (color === null) {
      this.clearStateRing();
      return;
    }
    this.stateRing ??= this.scene.add.image(this.x, this.y, TEX.ring).setDepth(9);
    this.stateRing.setTint(color).setDisplaySize(this.visiblePx * sizeMul, this.visiblePx * sizeMul).setAlpha(alpha).setVisible(true);
  }

  private clearStateRing(): void {
    this.stateRing?.setVisible(false);
  }

  private tickStuck(deltaMs: number, dist: number): void {
    this.sampleMs += deltaMs;
    if (this.sampleMs < STUCK_SAMPLE_MS) return;
    this.sampleMs = 0;
    const moved = Math.hypot(this.x - this.sampleX, this.y - this.sampleY);
    this.sampleX = this.x;
    this.sampleY = this.y;
    const wantsToMove = this.speed > 0 && this.telegraphMs <= 0 && dist > this.contactReach * 1.5 && this.def.behaviour !== 'ranged' && this.def.behaviour !== 'aura' && this.def.behaviour !== 'lob';
    this.stuckMs = wantsToMove && moved < STUCK_MOVE_PX ? this.stuckMs + STUCK_SAMPLE_MS : 0;
  }

  /** Straight-line velocity (drift, flee, orbit, non-hero goals). */
  private straight(dx: number, dy: number, dist: number, mul: number): void {
    this.setVelocity((dx / dist) * this.speed * mul, (dy / dist) * this.speed * mul);
    if (mul > 0 && (dx !== 0 || dy !== 0)) this.facing = Math.atan2(dy, dx);
  }

  /**
   * Toward the hero: the WorldGen flow field when inside its window (routes
   * around blocker clusters), straight otherwise or when already close. A
   * stuck body (> 1 s) side-steps perpendicular to break corner contact.
   */
  private chase(dx: number, dy: number, dist: number, mul: number): void {
    this.facing = Math.atan2(dy, dx);
    if (mul > 0 && dist > 96 && this.host.flowDir(this.x, this.y, this.steer) && (this.steer.x !== 0 || this.steer.y !== 0)) {
      let sx = this.steer.x;
      let sy = this.steer.y;
      if (this.stuckMs >= 1000) {
        const side = (this.stuckMs / 1000) % 2 < 1 ? 1 : -1;
        sx += -this.steer.y * side;
        sy += this.steer.x * side;
        const l = Math.hypot(sx, sy) || 1;
        sx /= l;
        sy /= l;
      }
      this.setVelocity(sx * this.speed * mul, sy * this.speed * mul);
      return;
    }
    this.setVelocity((dx / dist) * this.speed * mul, (dy / dist) * this.speed * mul);
  }

  private tickSwarm(dx: number, dy: number, dist: number): void {
    const packSize = requireParam(this.def, 'packSize');
    if (dist > 400) {
      this.chase(dx, dy, dist, 1);
      return;
    }
    const spread = this.bodyRadius * 2 * packSize * SWARM_SPREAD;
    const wantX = dx + Math.cos(this.orbitAngle) * spread * (dist / 400);
    const wantY = dy + Math.sin(this.orbitAngle) * spread * (dist / 400);
    this.straight(wantX, wantY, Math.hypot(wantX, wantY) || 1, 1);
  }

  private tickRanged(deltaMs: number, dx: number, dy: number, dist: number): void {
    const standoff = requireParam(this.def, 'rangePx');
    if (dist > standoff) this.chase(dx, dy, dist, 1);
    else this.straight(dx, dy, dist, -0.5);
    this.facing = Math.atan2(dy, dx);
    this.abilityMs -= deltaMs;
    if (this.abilityMs > 0 || dist > standoff * 1.4) return;
    this.abilityMs = requireParam(this.def, 'fireEveryMs');
    this.playAction('attack');
    this.host.shoot(this, Math.atan2(dy, dx), requireParam(this.def, 'shotSpeed'), requireParam(this.def, 'shotPx'), this.contactDamage());
  }

  private tickOrbitCharge(deltaMs: number, abilityDelta: number, dx: number, dy: number, dist: number, targetX: number, targetY: number): void {
    if (this.telegraphMs > 0) {
      this.telegraphMs -= deltaMs;
      this.setVelocity(0, 0);
      if (this.telegraphMs <= 0) {
        this.clearStateRing();
        this.dashMs = TUNING.enemy.chargeTelegraphMs;
        this.stateMs = 0;
      }
      return;
    }
    if (this.dashMs > 0) {
      this.dashMs -= deltaMs;
      this.straight(dx, dy, dist, 2.6);
      return;
    }
    const windupMs = requireParam(this.def, 'windupMs');
    const gateMs = (optionalParam(this.def, 'diveEveryS') ?? 0) * 1000;
    const radius = requireParam(this.def, 'orbitRadiusPx');
    if (dist > radius * 1.8) {
      this.chase(dx, dy, dist, 1);
      return;
    }
    let ready = false;
    if (gateMs > 0) {
      this.abilityMs -= abilityDelta;
      if (this.abilityMs <= 0) {
        this.abilityMs = gateMs;
        ready = true;
      }
    } else ready = this.stateMs > windupMs;
    if (ready) {
      this.telegraphMs = windupMs;
      this.playAction('attack');
      this.setStateRing(TELEGRAPH.fill, 1.4, 0.8);
      this.setVelocity(0, 0);
      return;
    }
    this.orbitAngle += (deltaMs / 1000) * (this.speed / radius);
    const wantX = targetX + Math.cos(this.orbitAngle) * radius - this.x;
    const wantY = targetY + Math.sin(this.orbitAngle) * radius - this.y;
    this.straight(wantX, wantY, Math.hypot(wantX, wantY) || 1, 1);
  }

  private tickTank(deltaMs: number, dx: number, dy: number, dist: number): void {
    const enrageBelowPct = optionalParam(this.def, 'enrageBelowPct');
    if (!this.enraged && enrageBelowPct !== undefined && this.health.ratio <= enrageBelowPct / 100) {
      this.enraged = true;
      this.setStateRing(TELEGRAPH.lethal, 1.3, 0.6);
    }
    this.chase(dx, dy, dist, 1);
    const slamRadius = optionalParam(this.def, 'slamRadiusPx');
    const slamEveryS = optionalParam(this.def, 'slamEveryS');
    if (slamRadius === undefined || slamEveryS === undefined) return;
    this.abilityMs -= deltaMs;
    if (this.abilityMs > 0 || dist > slamRadius * 2) return;
    this.abilityMs = slamEveryS * 1000;
    this.playAction('attack');
    this.strike({ shape: 'circle', x: this.x, y: this.y, r: slamRadius, telegraphMs: requireParam(this.def, 'slamTelegraphMs'), damage: this.contactDamage(), source: this.displayName });
  }

  private tickAura(deltaMs: number, dx: number, dy: number, dist: number): void {
    const radius = requireParam(this.def, 'auraRadiusPx');
    if (dist > radius) this.chase(dx, dy, dist, 1);
    else this.straight(dx, dy, dist, -0.6);
    this.abilityMs -= deltaMs;
    if (this.abilityMs > 0) return;
    this.abilityMs = TUNING.enemy.healAuraIntervalMs;
    this.host.auraPulse(this);
  }

  private tickTeleport(deltaMs: number, dx: number, dy: number, dist: number): void {
    this.chase(dx, dy, dist, 1);
    this.abilityMs -= deltaMs;
    if (this.abilityMs > 0) return;
    this.abilityMs = requireParam(this.def, 'blinkEveryS') * 1000;
    const blinkPx = requireParam(this.def, 'blinkPx');
    // Leech surfaces next to (not inside) the hero: contact reach away.
    const step = blinkPx === 0 ? Math.max(0, dist - this.contactReach * 0.9) : Math.min(blinkPx, dist);
    const nx = this.x + (dx / dist) * step;
    const ny = this.y + (dy / dist) * step;
    this.setPosition(nx, ny);
    this.body?.reset(nx, ny);
    this.playAction('attack');
    this.flashArrival();
  }

  private tickLob(deltaMs: number, dx: number, dy: number, dist: number, targetX: number, targetY: number): void {
    const range = requireParam(this.def, 'rangePx');
    if (dist > range * 0.85) this.chase(dx, dy, dist, 1);
    else this.straight(dx, dy, dist, -0.4);
    this.facing = Math.atan2(dy, dx);
    this.abilityMs -= deltaMs;
    if (this.abilityMs > 0 || dist > range) return;
    this.abilityMs = requireParam(this.def, 'cdMs');
    this.playAction('attack');
    this.strike({ shape: 'circle', x: targetX, y: targetY, r: requireParam(this.def, 'lobRadiusPx'), telegraphMs: requireParam(this.def, 'telegraphMs'), damage: this.contactDamage(), source: this.displayName });
  }

  private tickHook(deltaMs: number, dx: number, dy: number, dist: number): void {
    if (this.telegraphMs > 0) {
      this.telegraphMs -= deltaMs;
      this.setVelocity(0, 0);
      return;
    }
    this.chase(dx, dy, dist, 1);
    this.abilityMs -= deltaMs;
    const len = requireParam(this.def, 'lengthPx');
    if (this.abilityMs > 0 || dist > len) return;
    this.abilityMs = requireParam(this.def, 'cdMs');
    const tele = requireParam(this.def, 'telegraphMs');
    this.telegraphMs = tele;
    this.playAction('attack');
    this.strike({ shape: 'line', x: this.x, y: this.y, r: len, angle: Math.atan2(dy, dx), width: 34, telegraphMs: tele, damage: 0, pullPx: requireParam(this.def, 'pullPx'), source: this.displayName });
  }

  private tickScream(deltaMs: number, dx: number, dy: number, dist: number): void {
    this.chase(dx, dy, dist, 1);
    this.abilityMs -= deltaMs;
    const r = requireParam(this.def, 'radiusPx');
    if (this.abilityMs > 0 || dist > r * 1.4) return;
    this.abilityMs = requireParam(this.def, 'cdMs');
    this.playAction('attack');
    this.strike({ shape: 'circle', x: this.x, y: this.y, r, telegraphMs: requireParam(this.def, 'telegraphMs'), damage: 0,
      slowPct: requireParam(this.def, 'slowPct'), slowMs: requireParam(this.def, 'slowMs'), source: this.displayName });
  }

  private tickTrail(deltaMs: number): void {
    this.trailMs += deltaMs;
    const every = requireParam(this.def, 'dropEveryMs');
    if (this.trailMs < every) return;
    this.trailMs = 0;
    this.host.groundZone(this.x, this.y, requireParam(this.def, 'radiusPx'), requireParam(this.def, 'slowPct'), requireParam(this.def, 'lifeMs'), this.def.tint, 0, this.displayName);
  }

  private tickOptionalWeb(deltaMs: number): void {
    const webEveryS = optionalParam(this.def, 'webEveryS');
    if (webEveryS === undefined) return;
    this.abilityMs -= deltaMs;
    if (this.abilityMs > 0) return;
    this.abilityMs = webEveryS * 1000;
    this.playAction('attack');
    this.host.groundZone(this.x, this.y, requireParam(this.def, 'webRadiusPx'), requireParam(this.def, 'webSlowPct'), 6000, this.def.tint, 0, this.displayName);
  }

  private flashArrival(): void {
    const bloom = this.scene.add.image(this.x, this.y, TEX.ring).setTint(this.def.tint).setDisplaySize(this.visiblePx, this.visiblePx).setAlpha(0.8).setDepth(9);
    this.scene.tweens.add({
      targets: bloom,
      displayWidth: this.visiblePx * 2.2,
      displayHeight: this.visiblePx * 2.2,
      alpha: 0,
      duration: 260,
      ease: 'Cubic.easeOut',
      onComplete: () => bloom.destroy(),
    });
  }

  // ── §5.6 den mid-bosses ────────────────────────────────────────────────

  private tickMidBoss(deltaMs: number, dx: number, dy: number, dist: number): void {
    if (this.telegraphMs > 0) {
      this.telegraphMs -= deltaMs;
      this.setVelocity(0, 0);
      return;
    }
    this.chase(dx, dy, dist, 1);
    const p = (k: string): number => requireParam(this.def, k);
    const zone = this.def.zone as ZoneId;
    const hero = this.host.hero;
    this.abilityMs -= deltaMs;
    this.abilityBMs -= deltaMs;
    const angle = Math.atan2(dy, dx);
    switch (zone) {
      case 'castle': {
        if (this.abilityMs <= 0 && dist <= p('reapRadiusPx') * 1.6) {
          this.abilityMs = p('reapCdMs');
          this.reapLeft = p('reapCount');
          this.nextReap();
        }
        if (this.abilityBMs <= 0) {
          this.abilityBMs = p('summonCdMs');
          this.playAction('attack');
          this.host.summon(this, 'husk', p('summonCount'), 220);
        }
        break;
      }
      case 'outlands': {
        if (this.abilityBMs <= 0) {
          this.abilityBMs = p('bannerCdMs');
          this.host.rally(this.x, this.y, p('bannerRadiusPx'), p('bannerSpawnMul'), p('bannerMs'));
        }
        if (this.abilityMs <= 0 && dist <= p('spearLengthPx')) {
          this.abilityMs = p('spearCdMs');
          const tele = p('spearTelegraphMs');
          const len = p('spearLengthPx');
          this.telegraphMs = tele;
          this.playAction('attack');
          const ex = this.x + Math.cos(angle) * len;
          const ey = this.y + Math.sin(angle) * len;
          this.strike({ shape: 'line', x: this.x, y: this.y, r: len, angle, width: this.bodyRadius, telegraphMs: tele, damage: p('spearDamage'), source: this.displayName,
            onFire: () => this.blinkTo(ex, ey) });
        }
        break;
      }
      case 'desert': {
        if (this.abilityMs <= 0) {
          this.abilityMs = p('slickCdMs');
          this.playAction('attack');
          for (let i = 0; i < p('slickCount'); i += 1) {
            const a = angle + ((i - 1) * Math.PI) / 5;
            this.host.groundZone(hero.x + Math.cos(a) * 160, hero.y + Math.sin(a) * 160, p('slickRadiusPx'), p('slickSlowPct'), p('slickMs'), this.def.tint, 0, this.displayName);
          }
        }
        if (this.abilityBMs <= 0) {
          this.abilityBMs = p('eggCdMs');
          this.host.eggs(this.x, this.y, p('eggCount'), p('eggHatch'), 'cryptcrawler', p('eggMs'));
        }
        break;
      }
      case 'winter': {
        if (this.abilityMs <= 0) {
          this.abilityMs = p('blinkCdMs');
          const tele = p('blinkTelegraphMs');
          const tx = hero.x;
          const ty = hero.y;
          this.telegraphMs = tele;
          this.strike({ shape: 'circle', x: tx, y: ty, r: p('sweepRadiusPx'), telegraphMs: tele, damage: p('sweepDamage'), source: this.displayName,
            onFire: () => {
              this.blinkTo(tx, ty);
              this.playAction('attack');
            } });
        }
        this.trailMs += deltaMs;
        if (this.trailMs >= p('trailDropEveryMs')) {
          this.trailMs = 0;
          this.host.groundZone(this.x, this.y, p('trailRadiusPx'), p('trailSlowPct'), p('trailLifeMs'), 0x6fd6ff, 0, this.displayName);
        }
        break;
      }
    }
  }

  /** Sexton's Triple Reap: 3 × 140° sweeps, windups 700 / 500 / 500. */
  private nextReap(): void {
    if (this.reapLeft <= 0 || !this.active) return;
    const p = (k: string): number => requireParam(this.def, k);
    const first = this.reapLeft === p('reapCount');
    const tele = first ? p('reapWindup1Ms') : p('reapWindupNMs');
    this.reapLeft -= 1;
    this.telegraphMs = tele;
    this.playAction('attack');
    const hero = this.host.hero;
    this.strike({ shape: 'arc', x: this.x, y: this.y, r: p('reapRadiusPx'), angle: Math.atan2(hero.y - this.y, hero.x - this.x), arcDeg: p('reapArcDeg'),
      telegraphMs: tele, damage: p('reapDamage'), source: this.displayName, onFire: () => this.nextReap() });
  }

  private blinkTo(x: number, y: number): void {
    if (!this.active) return;
    this.setPosition(x, y);
    this.body?.reset(x, y);
    this.flashArrival();
  }

  // ── §5.6 zone bosses ───────────────────────────────────────────────────

  private tickBoss(deltaMs: number, dx: number, dy: number, dist: number): void {
    const ratio = this.health.ratio;
    const [phase2At, phase3At] = this.host.bossPhaseAt;
    const next: BossPhase = ratio <= phase3At ? 3 : ratio <= phase2At ? 2 : 1;
    if (next !== this.bossPhase) {
      this.bossPhase = next;
      this.abilityMs = 1200;
      this.abilityBMs = 2000;
      this.summonMs = 0;
      if (next === 2) this.playAction('summon');
      if (next === 3) {
        const enrage = `${actorBaseKey(this.artKey)}-enrage`;
        if (playable(this.scene.anims, enrage)) {
          this.loopKey = enrage;
          this.actionMs = 0;
          this.showAnim(enrage);
        }
        this.shielded = false;
      }
    }
    if (this.burrowed) {
      this.setVelocity(0, 0);
      return;
    }
    if (this.telegraphMs > 0) {
      this.telegraphMs -= deltaMs;
      this.setVelocity(0, 0);
    } else {
      const standoff = requireParam(this.def, 'standoffPx');
      if (dist > standoff) this.chase(dx, dy, dist, 1);
      else this.straight(dx, dy, dist, -0.5);
      this.facing = Math.atan2(dy, dx);
    }
    this.abilityMs -= deltaMs;
    this.abilityBMs -= deltaMs;
    this.summonMs -= deltaMs;
    if (this.spiralMs > 0) this.tickSpiral(deltaMs);
    switch (this.def.zone as ZoneId) {
      case 'castle':
        this.bossCastle(dx, dy, dist);
        break;
      case 'outlands':
        this.bossOutlands(dx, dy);
        break;
      case 'desert':
        this.bossDesert(dx, dy);
        break;
      case 'winter':
        this.bossWinter(dx, dy);
        break;
    }
  }

  /** Phase-2 summon on the zone's cadence; the zone boss shields while adds live (combat clears it). */
  private bossSummon(id: string, count: number, cdMs: number): void {
    if (this.summonMs > 0) return;
    this.summonMs = cdMs;
    this.playAction('summon');
    this.host.summon(this, id, count, 260);
    this.shielded = true;
  }

  private bossCastle(dx: number, dy: number, dist: number): void {
    const c = TUNING.boss.castle;
    const hero = this.host.hero;
    const name = this.displayName;
    if (this.bossPhase === 2) this.bossSummon(c.summon.id, c.summon.count, c.summon.cdMs);
    // Toll (all phases; 2.5 s in phase 3).
    if (this.abilityMs <= 0) {
      this.abilityMs = this.bossPhase === 3 ? c.toll.phase3CdMs : c.toll.cdMs;
      this.strike({ shape: 'circle', x: this.x, y: this.y, r: this.visiblePx * 0.5, telegraphMs: c.toll.telegraphMs, damage: 0, source: name, fx: 'fx-bell-ring',
        onFire: () => this.host.tollRings(this.x, this.y, c.toll.rings, c.toll.fromRadius, c.toll.toRadius, c.toll.speed, c.toll.damage, name) });
      return;
    }
    if (this.abilityBMs > 0) return;
    if (this.bossPhase === 1) {
      if (dist > c.chainSweep.radius * 1.3) return;
      this.abilityBMs = 5000;
      this.telegraphMs = c.chainSweep.windupMs;
      this.playAction('sweep');
      this.strike({ shape: 'arc', x: this.x, y: this.y, r: c.chainSweep.radius, angle: Math.atan2(dy, dx), arcDeg: c.chainSweep.arcDeg, telegraphMs: c.chainSweep.windupMs, damage: c.chainSweep.damage, source: name });
    } else if (this.bossPhase === 2) {
      this.abilityBMs = 5000;
      for (let i = 0; i < c.bellDrop.count; i += 1) {
        // Predicted positions: where the hero will be over the telegraph, fanned.
        const lead = (c.bellDrop.telegraphMs / 1000) * (0.4 + i * 0.25);
        this.strike({ shape: 'circle', x: hero.x + hero.vx * lead + (i - 1.5) * 60, y: hero.y + hero.vy * lead, r: c.bellDrop.radius, telegraphMs: c.bellDrop.telegraphMs, damage: c.bellDrop.damage, source: name, fx: 'fx-bell-ring' });
      }
    } else {
      this.abilityBMs = c.bulletRing.cdMs;
      this.strike({ shape: 'circle', x: this.x, y: this.y, r: this.visiblePx * 0.6, telegraphMs: c.bulletRing.telegraphMs, damage: 0, source: name,
        onFire: () => {
          this.playAction('sweep');
          for (let i = 0; i < c.bulletRing.shots; i += 1) this.host.shoot(this, (i / c.bulletRing.shots) * Math.PI * 2, 340, 22, this.contactDamage());
        } });
    }
  }

  private bossOutlands(dx: number, dy: number): void {
    const c = TUNING.boss.outlands;
    const name = this.displayName;
    const hero = this.host.hero;
    if (this.bossPhase === 2) this.bossSummon(c.summon.id, c.summon.count, c.summon.cdMs);
    if (this.abilityMs <= 0) {
      this.abilityMs = this.bossPhase === 3 ? c.geyser.phase3CdMs : 4000;
      const a = Math.atan2(dy, dx);
      this.playAction('sweep');
      for (let i = 0; i < c.geyser.count; i += 1) {
        const d = 140 + i * c.geyser.radius * 1.6;
        this.strike({ shape: 'circle', x: this.x + Math.cos(a) * d, y: this.y + Math.sin(a) * d, r: c.geyser.radius, telegraphMs: c.geyser.windupMs + i * c.geyser.staggerMs, damage: c.geyser.damage, source: name, fx: 'fx-geyser' });
      }
      return;
    }
    if (this.abilityBMs > 0) return;
    if (this.bossPhase === 1) {
      this.abilityBMs = 9000;
      const a = Math.atan2(hero.y - this.y, hero.x - this.x);
      this.strike({ shape: 'line', x: this.x, y: this.y, r: 520, angle: a, width: 90, telegraphMs: c.gust.warnMs, damage: 0, source: name,
        onFire: () => {
          let left = c.gust.durationMs;
          const ev = this.scene.time.addEvent({ delay: 16, loop: true, callback: () => {
            left -= 16;
            this.host.driftHero(Math.cos(a) * c.gust.pushPxPerS, Math.sin(a) * c.gust.pushPxPerS);
            if (left <= 0) ev.remove();
          } });
        } });
    } else if (this.bossPhase === 2) {
      this.abilityBMs = 6000;
      for (let i = 0; i < c.boneRain.count; i += 1) {
        const ang = (i / c.boneRain.count) * Math.PI * 2 + i * 0.7;
        const rr = c.boneRain.areaRadius * Math.sqrt(((i * 7) % c.boneRain.count) / c.boneRain.count);
        this.strike({ shape: 'circle', x: hero.x + Math.cos(ang) * rr, y: hero.y + Math.sin(ang) * rr, r: c.boneRain.radius, telegraphMs: c.boneRain.telegraphMs, damage: c.boneRain.damage, source: name });
      }
    } else {
      this.abilityBMs = c.spiral.cdMs;
      this.strike({ shape: 'circle', x: this.x, y: this.y, r: this.visiblePx * 0.6, telegraphMs: 500, damage: 0, source: name,
        onFire: () => {
          this.spiralMs = c.spiral.durationMs;
          this.spiralTickMs = 0;
        } });
    }
  }

  private tickSpiral(deltaMs: number): void {
    const s = TUNING.boss.outlands.spiral;
    this.spiralMs -= deltaMs;
    this.spiralTickMs -= deltaMs;
    if (this.spiralTickMs > 0) return;
    this.spiralTickMs = s.shotEveryMs / (s.shotsPerArm / 2);
    this.spiralAngle += 0.35;
    for (let arm = 0; arm < s.arms; arm += 1) this.host.shoot(this, this.spiralAngle + (arm / s.arms) * Math.PI * 2, 300, 22, this.contactDamage());
  }

  private bossDesert(dx: number, dy: number): void {
    const c = TUNING.boss.desert;
    const name = this.displayName;
    const hero = this.host.hero;
    if (this.bossPhase === 2) this.bossSummon(c.summon.id, c.summon.count, DEFAULT_SUMMON_CD_MS);
    const burrowCd = this.bossPhase === 3 ? c.burrowCharge.phase3CdMs : 6000;
    if (this.abilityMs <= 0 && this.bossPhase !== 2) {
      this.abilityMs = burrowCd;
      this.burrowCharge();
      return;
    }
    if (this.abilityBMs > 0) return;
    if (this.bossPhase === 1) {
      this.abilityBMs = 10000;
      const a = Math.atan2(dy, dx);
      const mx = (this.x + hero.x) / 2;
      const my = (this.y + hero.y) / 2;
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < c.sandWall.pillars; i += 1) {
        const off = (i - (c.sandWall.pillars - 1) / 2) * c.sandWall.bodyRadius * 2.2;
        pts.push({ x: mx - Math.sin(a) * off, y: my + Math.cos(a) * off });
      }
      this.host.walls(pts, c.sandWall.bodyRadius, c.sandWall.durationMs, 'fx-sand-pillar');
    } else if (this.bossPhase === 2) {
      this.abilityBMs = 9000;
      const a = Math.atan2(dy, dx) - Math.PI / 2;
      this.telegraphMs = c.scorchBeam.telegraphMs;
      this.strike({ shape: 'line', x: this.x, y: this.y, r: c.scorchBeam.length, angle: a, width: 30, telegraphMs: c.scorchBeam.telegraphMs, damage: 0, source: name,
        onFire: () => this.host.beam(this, a, c.scorchBeam.sweepDegPerS, c.scorchBeam.length, c.scorchBeam.durationMs, c.scorchBeam.damage, c.scorchBeam.tickMs) });
    } else {
      this.abilityBMs = 10000;
      for (let i = 0; i < c.sinkholes.count; i += 1) {
        const a = (i / c.sinkholes.count) * Math.PI * 2;
        this.host.groundZone(hero.x + Math.cos(a) * 200, hero.y + Math.sin(a) * 200, c.sinkholes.radius, c.sinkholes.slowPct, c.sinkholes.durationMs, 0xc49a5a, 0, name);
      }
    }
  }

  /** Sinks 600 ms, surfaces under the hero after a 1,200 ms circle telegraph (32 dmg). */
  private burrowCharge(): void {
    const c = TUNING.boss.desert.burrowCharge;
    this.burrowed = true;
    this.setVelocity(0, 0);
    this.scene.tweens.add({ targets: this, alpha: 0, duration: c.sinkMs });
    this.scene.time.delayedCall(c.sinkMs, () => {
      if (!this.active) return;
      const hero = this.host.hero;
      const tx = hero.x;
      const ty = hero.y;
      this.strike({ shape: 'circle', x: tx, y: ty, r: c.radius, telegraphMs: c.telegraphMs, damage: c.damage, source: this.displayName, fx: 'fx-sand-pillar',
        onFire: () => {
          if (!this.active) return;
          this.burrowed = false;
          this.scene.tweens.killTweensOf(this);
          this.setAlpha(1);
          this.blinkTo(tx, ty);
        } });
    });
  }

  private bossWinter(dx: number, dy: number): void {
    const c = TUNING.boss.winter;
    const name = this.displayName;
    const hero = this.host.hero;
    if (this.bossPhase === 2) this.bossSummon(c.summon.id, c.summon.count, DEFAULT_SUMMON_CD_MS);
    const a = Math.atan2(dy, dx);
    if (this.abilityMs <= 0) {
      this.abilityMs = this.bossPhase === 3 ? c.frostNova.phase3CdMs : 8000;
      this.telegraphMs = c.frostNova.windupMs;
      this.playAction('summon');
      this.strike({ shape: 'circle', x: this.x, y: this.y, r: c.frostNova.radius, telegraphMs: c.frostNova.windupMs, damage: 0, slowPct: c.frostNova.slowPct, slowMs: c.frostNova.slowMs, source: name });
      return;
    }
    if (this.abilityBMs > 0) return;
    if (this.bossPhase === 1) {
      this.abilityBMs = 4500;
      this.playAction('sweep');
      for (let i = 0; i < c.iceLance.count; i += 1) {
        const la = a + ((i - (c.iceLance.count - 1) / 2) * c.iceLance.spreadDeg * Math.PI) / 180 / (c.iceLance.count - 1) * 2;
        this.strike({ shape: 'line', x: this.x, y: this.y, r: 520, angle: la, width: 22, telegraphMs: c.iceLance.telegraphMs, damage: c.iceLance.damage, source: name, fx: 'fx-icicle' });
      }
    } else if (this.bossPhase === 2) {
      this.abilityBMs = 10000;
      for (let w = 0; w < c.glacier.walls; w += 1) {
        const wa = a + (w - 1) * 0.5;
        const pts: { x: number; y: number }[] = [];
        for (let k = 1; k <= 4; k += 1) pts.push({ x: this.x + Math.cos(wa) * k * 110, y: this.y + Math.sin(wa) * k * 110 });
        this.host.walls(pts, 55, c.glacier.durationMs, 'fx-ice-wall');
      }
    } else {
      this.abilityBMs = c.blizzard.durationMs + 4000;
      const step = c.blizzard.durationMs / c.blizzard.count;
      for (let i = 0; i < c.blizzard.count; i += 1) {
        this.scene.time.delayedCall(i * step, () => {
          if (!this.active) return;
          const ang = i * 2.39996;
          const rr = 60 + ((i * 53) % 260);
          this.strike({ shape: 'circle', x: hero.x + Math.cos(ang) * rr * 0.6, y: hero.y + Math.sin(ang) * rr * 0.6, r: c.blizzard.radius, telegraphMs: c.blizzard.telegraphMs, damage: 18, source: name, fx: 'fx-icicle' });
        });
      }
    }
  }
}
