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
 * same arena, and nothing needs saving — unless an `ArenaLayout` is supplied, in
 * which case geometry is authored instead (see `skill://map-forge`) and the
 * seed only still drives ordinary props/decals if the layout omits them.
 *
 * Use for: survivor-like / twin-stick runs on one field, or any genre whose
 * space came from a map-forge bundle via `ArenaLayout`.
 */

/**
 * Authored space produced outside the seeded scatter below — typically a
 * map-forge bundle mapped field-for-field: `floorKey`/prop and decal `id`s
 * are texture-registry keys, `props[].id` matches `PropDef.id` from
 * `data/props.ts` (unmatched ids fall back to the same tinted procedural
 * square a missing texture gets today), `decals[].id` matches a `DecalDef`'s
 * `texture` (unmatched ids are skipped — decals are purely cosmetic).
 * `walkable` narrows the in-bounds rectangle `clamp`/`isOutside` use when the
 * authored field is larger than the playable room (e.g. background overscan);
 * it defaults to the full `width`/`height` rectangle.
 */
export type ArenaLayout = {
  width: number;
  height: number;
  floorKey?: string;
  props?: Array<{ id: string; x: number; y: number; bodyRadius?: number }>;
  decals?: Array<{ id: string; x: number; y: number }>;
  walkable?: { x: number; y: number; w: number; h: number };
};

const GROUND_TEXTURE = 'arena-ground';
/** Display size and collision fraction used for a prop id absent from `PROPS`. */
const FALLBACK_PROP_SIZE = 128;
const FALLBACK_PROP_BODY_SCALE = 0.5;

export class Arena {
  /** Static bodies every mover collides with. */
  readonly obstacles: Phaser.Physics.Arcade.StaticGroup;
  readonly width: number;
  readonly height: number;

  private readonly scene: Phaser.Scene;
  /** In-bounds rectangle for `clamp`/`isOutside`; the full field unless a layout narrows it. */
  private readonly walkable: { x: number; y: number; w: number; h: number };

  constructor(scene: Phaser.Scene, seed: string, layout?: ArenaLayout) {
    this.scene = scene;
    this.width = layout?.width ?? TUNING.arena.width;
    this.height = layout?.height ?? TUNING.arena.height;
    this.walkable = layout?.walkable ?? { x: 0, y: 0, w: this.width, h: this.height };
    this.obstacles = scene.physics.add.staticGroup();

    const rng = new Rng(`arena:${seed}`);

    this.addFloor(layout?.floorKey);
    if (layout?.decals) this.addAuthoredDecals(layout.decals);
    else this.addDecals(rng);
    this.addWalls();
    if (layout?.props) this.addAuthoredProps(layout.props);
    else this.addProps(rng);

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
    out.x = Phaser.Math.Clamp(x, this.walkable.x + margin, this.walkable.x + this.walkable.w - margin);
    out.y = Phaser.Math.Clamp(y, this.walkable.y + margin, this.walkable.y + this.walkable.h - margin);
  }

  /** True when a point is far enough outside the field to be culled. */
  isOutside(x: number, y: number, margin: number): boolean {
    return (
      x < this.walkable.x - margin ||
      y < this.walkable.y - margin ||
      x > this.walkable.x + this.walkable.w + margin ||
      y > this.walkable.y + this.walkable.h + margin
    );
  }

  private addFloor(floorKey?: string): void {
    const generated = floorKey ?? 'arena-floor';
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

  /** Fixed-position decals from an `ArenaLayout`; an id with no `DecalDef` match is skipped. */
  private addAuthoredDecals(decals: NonNullable<ArenaLayout['decals']>): void {
    for (const decal of decals) {
      const def = DECALS.find((d) => d.texture === decal.id);
      if (!def || !this.scene.textures.exists(def.texture)) continue;
      this.scene.add
        .image(decal.x, decal.y, def.texture)
        .setDisplaySize(def.size, def.size)
        .setAlpha(def.alpha)
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

  /** Fixed-position props from an `ArenaLayout`; an id with no `PropDef` match falls back like a missing texture does. */
  private addAuthoredProps(props: NonNullable<ArenaLayout['props']>): void {
    for (const prop of props) {
      const def = PROPS.find((p) => p.id === prop.id) ?? {
        id: prop.id,
        texture: `prop-${prop.id}`,
        size: FALLBACK_PROP_SIZE,
        bodyScale: FALLBACK_PROP_BODY_SCALE,
        weight: 0,
        fallbackTint: PALETTE.inkSoft,
      };
      const radius = prop.bodyRadius ?? (def.size * def.bodyScale) / 2;
      this.placeProp(def, prop.x, prop.y, radius);
    }
  }

  private placeProp(def: PropDef, x: number, y: number, radiusOverride?: number): void {
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
      const radius = radiusOverride ?? (def.size * def.bodyScale) / 2;
      body.position.set(x - radius, y - radius);
      body.setCircle(radius);
    }
    this.obstacles.add(sprite);
  }
}
