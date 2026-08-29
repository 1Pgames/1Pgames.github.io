import Phaser from 'phaser';
import { TUNING } from '../config';
import { TEX } from '../core/keys';
import type { RelicDef } from '../data/relics';
import { TIER_RING, tierColor } from '../ui/duskChrome';

/**
 * Pooled relic pickup — the loot atom the whole extraction loop is about
 * (PRD §5.5/§5.6). One instance is reused for every relic: `drop` re-skins it
 * from a `RelicDef` and `despawn` parks it, so a 480s run's ~12 relic
 * opportunities cost 16 pooled objects and zero allocation (§15).
 *
 * Three things it owns, none of which belong in the slice:
 * - TIER READ. The relic art is generated and already coloured, so the tier is
 *   carried by an AURA ring behind the body, tinted from `duskChrome`'s
 *   art-locked ladder and carrying the mandatory 2px `TIER_RING` — §11 needs
 *   that ring because tier 2 Burnished sits below the 3:1 graphical floor.
 * - HOVER-BOB. The `relic-hover-t*` sheets animate their own bob; the
 *   procedural fallback bobs numerically. Either way there is NO tween, so a
 *   recycled pickup can never leak a looping tween (AGENTS.md §traps).
 * - MAGNETISM + ARMING. It vacuums in at `pickupRadius` but only after an
 *   arming beat, so an overflow-dropped relic is not instantly re-collected.
 *
 * Art is consumed through the registry keys `art/manifest.json` defines
 * (`relic-hover-t1`..`t4`); a missing sheet degrades to a tinted disc rather
 * than crashing the run.
 */

/** Registry key for a tier's hover sheet. Matches `art/manifest.json` ids. */
function relicArtKey(tier: number): string {
  return `relic-hover-t${Phaser.Math.Clamp(Math.round(tier), 1, 4)}`;
}

/** What `tick` observed this frame. The owner acts on anything but `idle`. */
export type RelicPickupState = 'idle' | 'collected' | 'expired';

/** Body diameter of a relic on the ground, in world px. */
const RELIC_SIZE_PX = 46;
/** The aura reads the tier from a distance; it is wider than the body. */
const AURA_SIZE_PX = 78;
/** Fallback bob: amplitude in px and full cycle in ms. */
const BOB_AMPLITUDE_PX = 7;
const BOB_PERIOD_MS = 1400;
/** Distance at which the magnet counts as a collection. */
const COLLECT_PX = 26;
/** Ground loot sits above the floor and hazards but below actors. */
const RELIC_DEPTH = 8;
const AURA_DEPTH = 7;

export class RelicPickup extends Phaser.Physics.Arcade.Sprite {
  /** The relic this pickup is currently carrying. Valid only while active. */
  def!: RelicDef;

  /** Tier aura — the thing that is tinted; the relic art never is. */
  private readonly aura: Phaser.GameObjects.Image;
  /**
   * The mandatory §11 tier ring. Tier 2 Burnished (`#835d2f`) measures 2.91:1
   * against `bgTop`, BELOW the 3:1 graphical floor, and §11 discharges that
   * with a 2px cooled ring on every tier swatch — so this is a contrast
   * requirement, not decoration, and it is drawn on every tier for consistency.
   */
  private readonly rim: Phaser.GameObjects.Image;
  /** Sim-time ms before which the pickup ignores the player (arming delay). */
  private armedAtMs = 0;
  /** Sim-time ms at which a dropped relic rots away; `null` = permanent. */
  private expiresAtMs: number | null = null;
  /** Bob centre — the y the pickup oscillates around while idle. */
  private restY = 0;
  /** True once the magnet has taken over, which stops the bob. */
  private pulling = false;
  /** Set when the sheet is absent: the fallback disc bobs in code instead. */
  private proceduralBob = false;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, TEX.disc);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(RELIC_DEPTH);
    this.aura = scene.add
      .image(0, 0, TEX.ring)
      .setDisplaySize(AURA_SIZE_PX, AURA_SIZE_PX)
      .setDepth(AURA_DEPTH);
    this.rim = scene.add
      .image(0, 0, TEX.ring)
      .setTint(TIER_RING.color)
      .setDisplaySize(RELIC_SIZE_PX + TIER_RING.width * 2, RELIC_SIZE_PX + TIER_RING.width * 2)
      .setDepth(AURA_DEPTH);
    this.despawn();
  }

  /**
   * Puts `def` on the ground at (x, y). `armMs` is the beat before the magnet
   * engages; `lingerMs` is how long an overflow drop survives for the
   * regret-pickup window (`null` for a relic that waits forever).
   */
  drop(def: RelicDef, x: number, y: number, nowMs: number, armMs: number, lingerMs: number | null): void {
    this.def = def;
    this.armedAtMs = nowMs + armMs;
    this.expiresAtMs = lingerMs === null ? null : nowMs + lingerMs;
    this.restY = y;
    this.pulling = false;

    const key = relicArtKey(def.tier);
    const hasArt = this.scene.textures.exists(key);
    this.proceduralBob = !hasArt;
    this.setTexture(hasArt ? key : TEX.disc);
    this.setDisplaySize(RELIC_SIZE_PX, RELIC_SIZE_PX);
    // Generated art carries its own colour — only the fallback disc is tinted.
    if (hasArt) this.clearTint();
    else this.setTint(tierColor(def.tier));

    this.setPosition(x, y);
    this.setActive(true).setVisible(true);
    this.enableBody(false, x, y, true, true);
    this.setVelocity(0, 0);

    // The aura is the tier read AND the §11 contrast discharge for tier 2.
    this.aura
      .setPosition(x, y)
      .setTint(tierColor(def.tier))
      .setAlpha(0.55)
      .setVisible(true);
    this.rim.setPosition(x, y).setVisible(true);

    // Pooled sprites keep the previous animation's frame: always restart.
    if (this.scene.anims.exists(key)) this.play(key, true);
  }

  /**
   * One frame of ground behaviour. Returns what happened so the owner can
   * bank the relic, respawn a lingering drop, or simply leave it alone.
   *
   * `nowMs` is SIM time (the clock that stops with the run), never wall time,
   * so arming and rot cannot expire behind a pause or an upgrade draft.
   */
  tick(nowMs: number, playerX: number, playerY: number, radius: number): RelicPickupState {
    if (this.expiresAtMs !== null && nowMs >= this.expiresAtMs) return 'expired';

    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const dist = Math.hypot(dx, dy);

    if (nowMs < this.armedAtMs || dist > radius) {
      // Idle: rest on the spot, bobbing if the art is not doing it for us.
      if (this.pulling) {
        this.pulling = false;
        this.setVelocity(0, 0);
        this.restY = this.y;
      }
      if (this.proceduralBob) {
        const phase = (nowMs % BOB_PERIOD_MS) / BOB_PERIOD_MS;
        this.y = this.restY + Math.sin(phase * Math.PI * 2) * BOB_AMPLITUDE_PX;
      }
      this.aura.setPosition(this.x, this.y);
      this.rim.setPosition(this.x, this.y);
      return 'idle';
    }

    if (dist <= COLLECT_PX) return 'collected';

    // Magnetised: the same curve the shard/coin pickups use, so every loot
    // atom in the game accelerates into the player identically.
    this.pulling = true;
    const speed = TUNING.xp.orbSpeed;
    this.setVelocity((dx / dist) * speed, (dy / dist) * speed);
    this.aura.setPosition(this.x, this.y);
    this.rim.setPosition(this.x, this.y);
    return 'idle';
  }

  despawn(): void {
    this.setActive(false).setVisible(false);
    // Guard the body: `despawn()` is called from GameScene.teardown() on
    // SHUTDOWN, which runs AFTER Phaser has torn the Arcade world down.
    //
    // TRUTHINESS, NOT `!== null` — Phaser sets `body` to UNDEFINED on teardown,
    // so a null-check PASSES and `setVelocity` throws inside the SHUTDOWN
    // handler. That aborts `SceneManager.processQueue`, the queued Menu/GameOver
    // start never runs, and the game FREEZES on its last drawn frame with zero
    // active scenes and dead input. It reproduced on every run end that left a
    // relic on the floor. `drop()` already uses `this.body?.setCircle`.
    if (this.body) {
      this.setVelocity(0, 0);
      this.disableBody();
    }
    this.pulling = false;
    this.expiresAtMs = null;
    this.aura.setVisible(false);
    this.rim.setVisible(false);
  }

  /** Scene teardown — the aura is a sibling object, not a child, so it needs this. */
  destroyAll(): void {
    this.aura.destroy();
    this.rim.destroy();
    this.destroy();
  }
}
