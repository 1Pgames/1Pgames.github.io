import Phaser from 'phaser';
import { TUNING } from '../config';
import { TEX } from '../core/keys';
import { hitFlash } from '../core/juice';
import { THRALL_FALLBACK_KEY, THRALL_VISIBLE_PX, outlineKey, shadowTexture } from '../core/outline';
import { artFacesRight } from '../data/art';
import { actionScale, displaySizeFor } from '../data/enemies';
import type { ThrallSpec } from '../systems/weapons';
import type { Enemy } from './enemy';

/**
 * Husk Thrall (PRD-V2 §5.8b.1): a hero-allied minion summoned by Arsenal's
 * `thralls` weapon through `WeaponHost.spawnThrall`. Pooled by
 * `systems/combat.ts`. It chases the nearest enemy, bites through the weapon
 * damage path (`damageEnemy(e, bite, false, 'thralls')`), takes enemy contact
 * damage, and never hurts, blocks or collides with the hero. It is not an
 * `Enemy`: it never enters the hash, density, threat, leash or gate contest.
 * Art: `wpn-thralls-*` (evolved: `wpn-thralls-evo-*`) with the baked 2 px hero
 * green outline at 0.7 alpha; falls back to the husk sheet when that art is absent.
 */

/** What a thrall needs from the combat core each tick. */
export interface ThrallHost {
  readonly scene: Phaser.Scene;
  nearestEnemy(x: number, y: number, max: number): Enemy | null;
  enemiesInRadius(x: number, y: number, r: number, out: Enemy[]): number;
  /** A bite from (fromX, fromY): the weapon damage path with source `thralls`. */
  biteEnemy(e: Enemy, amount: number, fromX: number, fromY: number): void;
}

/** Enemy targeting range; beyond it (or with no enemy) the thrall heels to the hero. */
const HUNT_PX = 900;
/** A thrall farther than this from the hero is recalled next to it. */
const RECALL_PX = 1500;
/** Idle heel distance around the hero. */
const HEEL_PX = 110;
/** Most enemies that can hurt one thrall per contact tick. */
const MAX_HITTERS = 3;

export class Thrall extends Phaser.Physics.Arcade.Sprite {
  spec!: ThrallSpec;
  hp = 0;
  private lifeMs = 0;
  private biteMs = 0;
  private hurtMs = 0;
  private displaySize = 0;
  private moveKey = '';
  private biteKey = '';
  private biteAnimMs = 0;
  private heelAngle = 0;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly near: Enemy[] = [];

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, TEX.disc);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.shadow = scene.add.image(0, 0, shadowTexture(scene)).setDepth(8).setAlpha(0.35).setVisible(false);
    this.setDepth(15).setActive(false).setVisible(false);
    this.disableBody();
  }

  summon(spec: ThrallSpec, x: number, y: number, heelAngle: number): void {
    this.spec = spec;
    this.hp = spec.hp;
    this.lifeMs = spec.lifeMs;
    this.biteMs = 0;
    this.hurtMs = 0;
    this.biteAnimMs = 0;
    this.heelAngle = heelAngle;
    const tex = this.scene.textures;
    const base = spec.evolved ? 'wpn-thralls-evo' : 'wpn-thralls';
    this.moveKey = tex.exists(`${base}-move`) ? `${base}-move` : tex.exists('wpn-thralls-move') ? 'wpn-thralls-move' : THRALL_FALLBACK_KEY;
    this.biteKey = tex.exists(`${base}-bite`) ? `${base}-bite` : this.moveKey;
    this.displaySize = displaySizeFor(this.moveKey, THRALL_VISIBLE_PX);
    this.setPosition(x, y).setAlpha(1).clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    this.setActive(true).setVisible(true);
    this.enableBody(false, x, y, true, true);
    this.show(this.moveKey);
    const rs = spec.bodyRadius / (this.displaySize / 256);
    this.body?.setCircle(rs, 128 - rs, 128 - rs);
    this.shadow.setDisplaySize(THRALL_VISIBLE_PX * 0.8, THRALL_VISIBLE_PX * 0.32).setVisible(true);
  }

  park(): void {
    this.setActive(false).setVisible(false);
    this.setVelocity(0, 0);
    this.disableBody();
    this.shadow.setVisible(false);
  }

  /** Plays the 2 px green-outlined variant when baked. Frame first, then size. */
  private show(key: string): void {
    const ol = outlineKey(key, 2);
    const anims = this.scene.anims;
    if (anims.exists(ol)) this.play(ol, true);
    else if (anims.exists(key)) this.play(key, true);
    else this.setTexture(this.scene.textures.exists(ol) ? ol : key, 0);
    const size = this.displaySize * actionScale(this.moveKey, key);
    this.setDisplaySize(size, size);
  }

  /** One tick. Returns false when the thrall died or expired this tick (the caller parks it). */
  tick(deltaMs: number, host: ThrallHost, heroX: number, heroY: number): boolean {
    if (Number.isFinite(this.lifeMs)) {
      this.lifeMs -= deltaMs;
      if (this.lifeMs <= 0) return false;
    }
    if (this.biteAnimMs > 0) {
      this.biteAnimMs -= deltaMs;
      if (this.biteAnimMs <= 0) this.show(this.moveKey);
    }
    if (Math.hypot(this.x - heroX, this.y - heroY) > RECALL_PX) {
      const x = heroX + Math.cos(this.heelAngle) * HEEL_PX;
      const y = heroY + Math.sin(this.heelAngle) * HEEL_PX;
      this.setPosition(x, y);
      this.body?.reset(x, y);
    }

    const target = host.nearestEnemy(this.x, this.y, HUNT_PX);
    let tx = heroX + Math.cos(this.heelAngle) * HEEL_PX;
    let ty = heroY + Math.sin(this.heelAngle) * HEEL_PX;
    let reach = 0;
    if (target !== null) {
      tx = target.x;
      ty = target.y;
      reach = this.spec.bodyRadius + target.bodyRadius + 6;
    }
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (target === null && dist < 24) this.setVelocity(0, 0);
    else if (dist > reach) this.setVelocity((dx / dist) * this.spec.speed, (dy / dist) * this.spec.speed);
    else this.setVelocity(0, 0);
    if (Math.abs(dx) > 2) this.setFlipX(artFacesRight(this.moveKey) ? dx < 0 : dx > 0);

    this.biteMs -= deltaMs;
    if (target !== null && dist <= reach && this.biteMs <= 0) {
      this.biteMs = this.spec.biteMs;
      host.biteEnemy(target, this.spec.bite, this.x, this.y);
      if (this.biteKey !== this.moveKey) {
        this.show(this.biteKey);
        const anim = this.scene.anims.get(outlineKey(this.biteKey, 2)) ?? this.scene.anims.get(this.biteKey);
        this.biteAnimMs = anim !== undefined && anim !== null ? anim.duration : 300;
      }
    }

    // Enemies touching the thrall wear it down on the enemy contact cadence.
    this.hurtMs -= deltaMs;
    if (this.hurtMs <= 0) {
      this.hurtMs = TUNING.enemy.hitMs;
      host.enemiesInRadius(this.x, this.y, this.spec.bodyRadius + 90, this.near);
      let taken = 0;
      let hitters = 0;
      for (const e of this.near) {
        if (hitters >= MAX_HITTERS) break;
        if (e.dormant || !e.active) continue;
        const r = e.bodyRadius + this.spec.bodyRadius;
        if ((e.x - this.x) ** 2 + (e.y - this.y) ** 2 > r * r) continue;
        taken += e.contactDamage();
        hitters += 1;
      }
      if (taken > 0) {
        this.hp -= taken;
        // Same soft overlay flash as enemies — never a FILL tint on the body itself.
        hitFlash(this.scene, this, 50);
        if (this.hp <= 0) return false;
      }
    }
    this.shadow.setPosition(this.x, this.y + THRALL_VISIBLE_PX / 2);
    return true;
  }
}
