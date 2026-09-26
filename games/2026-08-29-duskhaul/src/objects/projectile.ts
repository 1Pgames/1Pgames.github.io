import Phaser from 'phaser';
import { PALETTE, TUNING } from '../config';
import { TEXTURE } from '../data/art';
import type { Enemy } from './enemy';

/**
 * MEASURED drawn content of `bolt-arcane`: 110x43 opaque pixels inside its
 * 128px cell — a 2.56:1 body with the mass and the bright head forward (right)
 * and the tail thinning back, verified as asymmetric rather than mirrored.
 */
const BOLT_CONTENT = { w: 110, h: 43, cell: 128 } as const;

/**
 * The on-screen bolt the brief specifies, in multiples of the projectile
 * `size` stat: a ~3:1 dart, not a laser streak.
 *
 * Why this is derived rather than a literal `setDisplaySize(size * 2.2, size)`.
 * That call assumed art drawn square in its cell. Against art that is already
 * 2.56:1 it multiplies out to 5.6:1 — a sliver under 5px thick at the shipped
 * `projectileSize`. Correcting the STRETCH alone (2.2 -> 1.2) fixes the ratio
 * but shrinks the bolt to ~1.0x `size` long and 0.34x thick, which is thinner
 * still. So both axes are solved from the measurement instead: the factors
 * below make the DRAWN content land on the target, whatever the cell padding.
 */
const BOLT_TARGET = { length: 1.9, thickness: 0.62 } as const;

const BOLT_LENGTH_MUL = (BOLT_TARGET.length * BOLT_CONTENT.cell) / BOLT_CONTENT.w;
const BOLT_THICKNESS_MUL = (BOLT_TARGET.thickness * BOLT_CONTENT.cell) / BOLT_CONTENT.h;

/** Hero violet `#ad6eef` (PRD-V2 §5.8 hero VFX palette). */
const HERO_CRIT_TINT = 0xad6eef;

/** On-screen side of the square `wpn-bolt` cell, in multiples of the shot `size`. */
const NAIL_CELL_MUL = 3;

/**
 * Pooled projectile for auto-attacks and enemy shots. Carries its own damage
 * payload so a hit needs no lookup back into the shooter (which may already be
 * dead by the time the shot lands).
 *
 * Use for: any bullet-like entity spawned in bulk.
 * Do NOT use for: persistent orbiting weapons or beams — those want their own
 * object with a lifetime tied to the owner.
 */
export class Projectile extends Phaser.Physics.Arcade.Sprite {
  damage = 0;
  crit = false;
  /** true when fired by an enemy: it damages the player instead of enemies. */
  hostile = false;
  lifeMs = 0;
  /** Remaining enemies this shot can still pass through after a hit (rail weapon). 0 = normal bolt. */
  pierceRemaining = 0;
  /** Enemies already hit this flight, so a piercing shot never double-hits the same target. */
  readonly hitTargets: Set<Enemy> = new Set();

  /**
   * Hero nail art (`wpn-bolt` / `wpn-bolt-evo` once Coffin Nail evolves), set
   * by `WeaponSystem` per run. Missing texture ⇒ the V1 `bolt-arcane` dart.
   */
  static heroArt = 'wpn-bolt';

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, TEXTURE.bullet);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setActive(false).setVisible(false).setDepth(15);
    this.disableBody();
  }

  /** Radius used for hit tests, in world px. Scales with the `areaMul` stat. */
  hitRadius = 0;

  fire(
    x: number,
    y: number,
    vx: number,
    vy: number,
    damage: number,
    crit: boolean,
    hostile: boolean,
    area = 1,
    pierce = 0,
  ): void {
    this.damage = damage;
    this.crit = crit;
    this.hostile = hostile;
    this.lifeMs = 1600;
    this.pierceRemaining = pierce;
    this.hitTargets.clear();

    // Hero shots are Rustspike nails (`weapons.bolt.size`, §5.8); hostile shots keep the V1 size.
    const base = hostile ? TUNING.player.projectileSize * 1.3 : TUNING.weapons.bolt.size;
    const size = base * (crit ? 1.6 : 1) * area;
    this.hitRadius = size;
    this.setPosition(x, y);
    const art = Projectile.heroArt;
    if (!hostile && this.scene.textures.exists(art)) {
      // `wpn-bolt` is a nail pointing right in a square 64 cell.
      this.setTexture(art, 0);
      if (this.scene.anims.exists(art)) this.play(art, true);
      this.setDisplaySize(size * NAIL_CELL_MUL, size * NAIL_CELL_MUL);
    } else {
      this.stop();
      this.setTexture(TEXTURE.bullet);
      this.setDisplaySize(size * BOLT_LENGTH_MUL, size * BOLT_THICKNESS_MUL);
    }
    // The bolt art is drawn head-first to the RIGHT (measured: mass +26.9% and
    // value +25.4 on the right), so rotation 0 is travelling right.
    this.setRotation(Math.atan2(vy, vx));
    // Hostile shots are recoloured so the player can read incoming danger;
    // friendly shots keep the generated cyan, crits get the hero violet
    // (§5.8: hero VFX palette is cool — never red/amber).
    if (hostile) this.setTint(PALETTE.bad);
    else if (crit) this.setTint(HERO_CRIT_TINT);
    else this.clearTint();
    this.setActive(true).setVisible(true);
    this.enableBody(false, x, y, true, true);
    this.body?.setCircle(this.frame.width / 2, 0, 0);
    this.setVelocity(vx, vy);
  }

  despawn(): void {
    this.setActive(false).setVisible(false);
    this.setVelocity(0, 0);
    this.disableBody();
    this.hitTargets.clear();
    this.pierceRemaining = 0;
  }
}
