import Phaser from 'phaser';
import { PALETTE, TUNING } from '../config';
import { TEX } from '../core/keys';
import { Rng } from '../core/rng';
import { buildGroundTile } from '../core/textures';
import { DECALS, PROPS, type DecalDef, type PropDef } from '../data/props';

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
 * are texture-registry keys, `props[].id` matches `PropDef.id` and
 * `decals[].id` a `DecalDef.id` from the layout's own `propSet`/`decalSet`
 * (or `data/props.ts`'s defaults) — an unmatched prop id falls back to the
 * same tinted procedural square a missing texture gets, an unmatched decal id
 * is skipped, decals being purely cosmetic.
 *
 * `propSet`/`decalSet` replace the default scatter content, which is how a
 * zone ships its OWN props: the seeded scatter still chooses placement, but
 * only from the zone's cells (see `systems/zone.ts`).
 *
 * `walkable` narrows the in-bounds rectangle `clamp`/`isOutside` use when the
 * authored field is larger than the playable room (e.g. background overscan);
 * it defaults to the full `width`/`height` rectangle.
 */
export type ArenaLayout = {
  width: number;
  height: number;
  /** Texture key of the floor tile; falls back to the procedural ground tile. */
  floorKey?: string;
  /** Texture key of the field-edge band tile drawn over the wall thickness. */
  borderKey?: string;
  /**
   * Multiply tint applied to the GROUND layer — floor tile, flat decals and
   * scenery props. This is a lighting grade (`ui/duskChrome.ts#FLOOR_GRADE`),
   * not a repaint: the art keeps its own colour, the zone's light level is set
   * here so the actors stay the lightest, most contrasted things in the frame.
   * Omitted = ungraded (`0xffffff`).
   */
  grade?: number;
  walkable?: { x: number; y: number; w: number; h: number };
  propSet?: readonly PropDef[];
  decalSet?: readonly DecalDef[];
  props?: ReadonlyArray<{ id: string; x: number; y: number; bodyRadius?: number }>;
  decals?: ReadonlyArray<{ id: string; x: number; y: number }>;
};

const GROUND_TEXTURE = 'arena-ground';
/** Display size and collision fraction used for a prop id absent from the set. */
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
  /** The prop and decal content this field draws from — the zone's, or the defaults. */
  private readonly propSet: readonly PropDef[];
  private readonly decalSet: readonly DecalDef[];
  /**
   * Ground-layer lighting grade (Step 5.5). `0xffffff` is ungraded; anything
   * darker multiplies the floor tile, the flat decals and the scenery props
   * down so the actors stay the lightest things in the frame.
   */
  private readonly grade: number;

  constructor(scene: Phaser.Scene, seed: string, layout?: ArenaLayout) {
    this.scene = scene;
    this.width = layout?.width ?? TUNING.arena.width;
    this.height = layout?.height ?? TUNING.arena.height;
    this.walkable = layout?.walkable ?? { x: 0, y: 0, w: this.width, h: this.height };
    this.propSet = layout?.propSet ?? PROPS;
    this.decalSet = layout?.decalSet ?? DECALS;
    this.grade = layout?.grade ?? 0xffffff;
    this.obstacles = scene.physics.add.staticGroup();

    const rng = new Rng(`arena:${seed}`);

    this.addFloor(layout?.floorKey);
    if (layout?.decals) this.addAuthoredDecals(layout.decals);
    else this.addDecals(rng);
    this.addWalls(layout?.borderKey);
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
      .setTint(this.grade)
      .setDepth(-300);
  }

  private addDecals(rng: Rng): void {
    const available = this.decalSet.filter((decal) => this.scene.textures.exists(decal.texture));
    if (available.length === 0) return;
    const weights = available.map((decal) => decal.weight);

    for (let i = 0; i < TUNING.arena.decalCount; i += 1) {
      const def = rng.pickWeighted(available, weights);
      this.addDecal(def, rng.float(120, this.width - 120), rng.float(120, this.height - 120), rng.float(0, 360));
    }
  }

  /** Fixed-position decals from an `ArenaLayout`; an id with no `DecalDef` match is skipped. */
  private addAuthoredDecals(decals: NonNullable<ArenaLayout['decals']>): void {
    for (const decal of decals) {
      const def = this.decalSet.find((d) => d.id === decal.id);
      if (!def || !this.scene.textures.exists(def.texture)) continue;
      this.addDecal(def, decal.x, decal.y, 0);
    }
  }

  private addDecal(def: DecalDef, x: number, y: number, angle: number): void {
    this.scene.add
      .image(x, y, def.texture, def.frame)
      .setDisplaySize(def.size, def.size)
      .setAlpha(def.alpha)
      .setAngle(angle)
      .setTint(this.grade)
      .setDepth(-280);
  }

  /**
   * The field edge. When the zone ships a `border-<id>` band tile it is drawn
   * as the wall: §11 forbids procedural art in gameplay, and the generated
   * band is ALREADY the art run's authored shadow value for that stone
   * (castle mean relative luminance 0.0168 against its floor's 0.0848), so it
   * is deliberately left UNGRADED — grading the zone's own shadow twice would
   * crush it to black. Without the tile it falls back to the procedural band.
   *
   * Either way the four static bodies are unchanged: this method paints the
   * edge and never moves collision.
   */
  private addWalls(borderKey?: string): void {
    const t = TUNING.arena.wallThickness;

    if (borderKey !== undefined && this.scene.textures.exists(borderKey)) {
      const band = (x: number, y: number, w: number, h: number): void => {
        this.scene.add.tileSprite(x, y, w, h, borderKey).setOrigin(0, 0).setDepth(-270);
      };
      band(0, 0, this.width, t);
      band(0, this.height - t, this.width, t);
      band(0, t, t, this.height - t * 2);
      band(this.width - t, t, t, this.height - t * 2);
    } else {
      const g = this.scene.add.graphics().setDepth(-270);
      g.fillStyle(PALETTE.bgDeep, 0.9);
      g.fillRect(0, 0, this.width, t);
      g.fillRect(0, this.height - t, this.width, t);
      g.fillRect(0, 0, t, this.height);
      g.fillRect(this.width - t, 0, t, this.height);
      g.lineStyle(4, PALETTE.inkSoft, 0.35);
      g.strokeRect(t / 2, t / 2, this.width - t, this.height - t);
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
    const weights = this.propSet.map((prop) => prop.weight);
    const placed: Array<{ x: number; y: number; r: number }> = [];
    const edge = TUNING.arena.wallThickness + 90;

    for (let i = 0; i < count; i += 1) {
      const def = rng.pickWeighted(this.propSet, weights);
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
      const def = this.propSet.find((p) => p.id === prop.id) ?? {
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
    const sprite = hasArt
      ? this.scene.physics.add.staticSprite(x, y, def.texture, def.frame)
      : this.scene.physics.add.staticSprite(x, y, TEX.square);
    sprite.setDisplaySize(def.size, def.size).setDepth(6);
    // Scenery is GROUND, so it takes the same per-zone lighting grade as the
    // floor it stands on: a coffin lit brighter than the flagstone under it is
    // incoherent, and an ungraded prop would become the brightest mass in the
    // frame the moment the floor receded. Actors are never tinted.
    sprite.setTint(hasArt ? this.grade : def.fallbackTint);

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
