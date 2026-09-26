import Phaser from 'phaser';
import { TUNING } from '../config';
import { ANIM } from '../data/art';

/**
 * Pooled XP pickup. Idles where the enemy died, then magnetises to the player
 * once inside the `pickupRadius` stat — the pull is what makes clearing a swarm
 * feel rewarding, so keep it snappy.
 *
 * V2 additions (PRD-V2 §5.13): `vacuum(ms)` for the Dirge Bell pickup (every
 * orb on the 6144² map reaches the hero within `pickups.bell` ms), and
 * `mergeXpOrbs` so a dense map never holds hundreds of live orb bodies.
 *
 * Use for: XP, coins, any small collectible dropped in bulk.
 * Do NOT use for: unique quest items or drops with bespoke pickup rules.
 */
export class XpOrb extends Phaser.Physics.Arcade.Sprite {
  value = 0;
  /** Scene time (ms) by which a vacuumed orb must arrive; 0 = not vacuumed. */
  private vacuumUntil = 0;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, ANIM.xpOrb);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setActive(false).setVisible(false).setDepth(8);
    this.disableBody();
  }

  drop(x: number, y: number, value: number): void {
    this.value = value;
    this.vacuumUntil = 0;
    this.setPosition(x, y);
    this.resize();
    this.clearTint();
    this.setActive(true).setVisible(true);
    this.play(ANIM.xpOrb, true);
    this.enableBody(false, x, y, true, true);
    this.body?.setCircle(64, 0, 0);
    this.setVelocity(0, 0);
  }

  /** Display size grows with value, capped, so a merged orb reads as "more". */
  private resize(): void {
    const size = 14 + Math.min(18, this.value);
    this.setDisplaySize(size * 1.8, size * 1.8);
  }

  /** Dirge Bell: fly to the hero regardless of distance, arriving within `ms`. */
  vacuum(ms: number): void {
    this.vacuumUntil = this.scene.time.now + ms;
  }

  /** Takes `other`'s value (merge); the caller releases `other` to the pool. */
  absorb(other: XpOrb): void {
    this.value += other.value;
    this.resize();
  }

  /**
   * Returns true when the orb reached the player and should be collected.
   * Outside `radius` the orb still drifts in slowly: drops land far enough
   * away that a hard radius cut-off would strand most of a run's XP. A
   * vacuumed orb ignores the radius and speeds up to meet its deadline.
   */
  tickMagnet(playerX: number, playerY: number, radius: number): boolean {
    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 26) return true;
    let speed = TUNING.xp.orbSpeed * (dist > radius ? TUNING.xp.driftFactor : 1);
    if (this.vacuumUntil > 0) {
      const leftS = Math.max(0.05, (this.vacuumUntil - this.scene.time.now) / 1000);
      speed = Math.max(TUNING.xp.orbSpeed, dist / leftS);
    }
    this.setVelocity((dx / dist) * speed, (dy / dist) * speed);
    return false;
  }

  despawn(): void {
    this.vacuumUntil = 0;
    this.setActive(false).setVisible(false);
    this.setVelocity(0, 0);
    this.disableBody();
  }
}

/** Orbs closer than this merge into one (px). */
const MERGE_RADIUS = 72;
/** Merging only runs above this many live orbs — below it every orb stays a separate glint. */
const MERGE_ABOVE = 80;

/** Reused bucket map: cell key → first orb seen in that cell this pass. */
const buckets = new Map<number, XpOrb>();

/**
 * Merges orbs sharing a `MERGE_RADIUS` grid cell into the first one seen
 * (value conserved exactly). Mutates `orbs` in place (swap-remove) and hands
 * every absorbed orb to `release` for the pool. Returns how many were merged.
 * Call at a low cadence (e.g. every 500 ms) from the system that owns the pool.
 */
export function mergeXpOrbs(orbs: XpOrb[], release: (orb: XpOrb) => void): number {
  if (orbs.length <= MERGE_ABOVE) return 0;
  buckets.clear();
  let merged = 0;
  for (let i = orbs.length - 1; i >= 0; i -= 1) {
    const orb = orbs[i];
    if (orb === undefined) continue;
    const key = Math.floor(orb.x / MERGE_RADIUS) * 65536 + Math.floor(orb.y / MERGE_RADIUS);
    const keeper = buckets.get(key);
    if (keeper === undefined) {
      buckets.set(key, orb);
      continue;
    }
    keeper.absorb(orb);
    release(orb);
    const last = orbs.pop();
    if (last !== undefined && i < orbs.length) orbs[i] = last;
    merged += 1;
  }
  buckets.clear();
  return merged;
}
