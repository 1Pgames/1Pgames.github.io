import Phaser from 'phaser';
import { PALETTE, TUNING } from '../config';
import { TEX } from '../core/keys';
import { Rng } from '../core/rng';
import { buildGroundTile } from '../core/textures';
import { DECALS, PROPS, type PropDef } from '../data/props';

/**
 * Bounded arena (Brotato-style): a fixed play field several screens wide, a
 * camera that follows the player inside those bounds, a tiled floor, scattered
 * flat decals and impassable props with static circular bodies.
 *
 * Bounded, not infinite, on purpose: a known field means the player can read
 * where the pressure is coming from, spawn rings can be clamped to real space,
 * and the run has a shape instead of an endless plain.
 *
 * Layout is deterministic from the run seed, so a replay of the same seed is the
 * same arena, and nothing needs saving.
 *
 * Use for: survivor-like / twin-stick runs on one field.
 * Do NOT use for: room-based roguelikes or tower defense, where the geometry is
 * the design and must be authored.
 */

const GROUND_TEXTURE = 'arena-ground';

export class Arena {
  /** Static bodies every mover collides with. */
  readonly obstacles: Phaser.Physics.Arcade.StaticGroup;
  readonly width: number;
  readonly height: number;

  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, seed: string) {
    this.scene = scene;
    this.width = TUNING.arena.width;
    this.height = TUNING.arena.height;
    this.obstacles = scene.physics.add.staticGroup();

    const rng = new Rng(`arena:${seed}`);

    this.addFloor();
    this.addDecals(rng);
    this.addWalls();
    this.addProps(rng);

    scene.physics.world.setBounds(0, 0, this.width, this.height);
    scene.cameras.main.setBounds(0, 0, this.width, this.height);
  }

  get centerX(): number {
    return this.width / 2;
  }

  get centerY(): number {
    return this.height / 2;
  }

  /** Keeps a spawn point inside the field, away from the walls. */
  clamp(x: number, y: number, margin: number, out: { x: number; y: number }): void {
    out.x = Phaser.Math.Clamp(x, margin, this.width - margin);
    out.y = Phaser.Math.Clamp(y, margin, this.height - margin);
  }

  /** True when a point is far enough outside the field to be culled. */
  isOutside(x: number, y: number, margin: number): boolean {
    return x < -margin || y < -margin || x > this.width + margin || y > this.height + margin;
  }

  private addFloor(): void {
    const generated = 'arena-floor';
    let texture = generated;
    if (!this.scene.textures.exists(generated)) {
      buildGroundTile(this.scene, GROUND_TEXTURE, TUNING.arena.tileSize);
      texture = GROUND_TEXTURE;
    }
    this.scene.add
      .tileSprite(0, 0, this.width, this.height, texture)
      .setOrigin(0, 0)
      .setDepth(-300);
  }

  private addDecals(rng: Rng): void {
    const available = DECALS.filter((decal) => this.scene.textures.exists(decal.texture));
    if (available.length === 0) return;
    const weights = available.map((decal) => decal.weight);

    for (let i = 0; i < TUNING.arena.decalCount; i += 1) {
      const def = rng.pickWeighted(available, weights);
      this.scene.add
        .image(rng.float(120, this.width - 120), rng.float(120, this.height - 120), def.texture)
        .setDisplaySize(def.size, def.size)
        .setAlpha(def.alpha)
        .setAngle(rng.float(0, 360))
        .setDepth(-280);
    }
  }

  /**
   * Walls are primitives: a glowing inner border plus four static bodies just
   * outside it. Drawing them keeps the field readable at any arena size and
   * needs no seamless wall art.
   */
  private addWalls(): void {
    const t = TUNING.arena.wallThickness;
    const g = this.scene.add.graphics().setDepth(-270);

    g.fillStyle(PALETTE.bgDeep, 0.9);
    g.fillRect(0, 0, this.width, t);
    g.fillRect(0, this.height - t, this.width, t);
    g.fillRect(0, 0, t, this.height);
    g.fillRect(this.width - t, 0, t, this.height);

    g.lineStyle(4, PALETTE.primary, 0.7);
    g.strokeRect(t / 2, t / 2, this.width - t, this.height - t);
    g.lineStyle(2, PALETTE.primary, 0.25);
    g.strokeRect(t * 1.8, t * 1.8, this.width - t * 3.6, this.height - t * 3.6);

    // Corner posts read as structure and mark the field's extent on video.
    for (const [px, py] of [
      [t, t],
      [this.width - t, t],
      [t, this.height - t],
      [this.width - t, this.height - t],
    ] as const) {
      g.fillStyle(PALETTE.primary, 0.85);
      g.fillCircle(px, py, t * 0.7);
      g.fillStyle(PALETTE.bgDeep, 0.9);
      g.fillCircle(px, py, t * 0.35);
    }

    const addWall = (x: number, y: number, w: number, h: number): void => {
      const wall = this.scene.add.rectangle(x, y, w, h, 0x000000, 0);
      this.scene.physics.add.existing(wall, true);
      this.obstacles.add(wall);
    };
    addWall(this.width / 2, t / 2, this.width, t);
    addWall(this.width / 2, this.height - t / 2, this.width, t);
    addWall(t / 2, this.height / 2, t, this.height);
    addWall(this.width - t / 2, this.height / 2, t, this.height);
  }

  private addProps(rng: Rng): void {
    const count = rng.int(TUNING.arena.propsMin, TUNING.arena.propsMax);
    const weights = PROPS.map((prop) => prop.weight);
    const placed: Array<{ x: number; y: number; r: number }> = [];
    const edge = TUNING.arena.wallThickness + 90;

    for (let i = 0; i < count; i += 1) {
      const def = rng.pickWeighted(PROPS, weights);
      const radius = (def.size * def.bodyScale) / 2;

      // Rejection sampling: props may not overlap each other, block the start
      // pocket, or hug a wall where they would trap the player.
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const x = rng.float(edge, this.width - edge);
        const y = rng.float(edge, this.height - edge);
        if (Math.hypot(x - this.centerX, y - this.centerY) < TUNING.arena.spawnClearRadius) continue;
        let blocked = false;
        for (const other of placed) {
          if (Math.hypot(x - other.x, y - other.y) < radius + other.r + 70) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
        this.placeProp(def, x, y);
        placed.push({ x, y, r: radius });
        break;
      }
    }
  }

  private placeProp(def: PropDef, x: number, y: number): void {
    const hasArt = this.scene.textures.exists(def.texture);
    const sprite = this.scene.physics.add.staticSprite(x, y, hasArt ? def.texture : TEX.square);
    sprite.setDisplaySize(def.size, def.size).setDepth(6);
    if (!hasArt) sprite.setTint(def.fallbackTint);

    const body = sprite.body as Phaser.Physics.Arcade.StaticBody | null;
    if (body !== null) {
      // A StaticBody's circle is in WORLD px and its centre is derived as
      // `position + halfWidth`, so the position must be written first and
      // `setCircle` called last: `setCircle` is what re-inserts the body into
      // the static RTree. Doing it the other way round leaves a stale tree
      // entry — the prop then blocks nothing, which is exactly how enemies end
      // up walking through rocks. Never call `updateFromGameObject` afterwards:
      // it overwrites the radius with the sprite's display size.
      const radius = (def.size * def.bodyScale) / 2;
      body.position.set(x - radius, y - radius);
      body.setCircle(radius);
    }
    this.obstacles.add(sprite);
  }
}
