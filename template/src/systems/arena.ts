import Phaser from 'phaser';
import { PALETTE, TUNING, VIEW } from '../config';
import { NavGrid } from '../core/grid';
import { TEX } from '../core/keys';
import { buildGroundTile } from '../core/textures';
import { propArtRadius, propBodyRadius, type DecalDef, type PropDef } from '../data/props';
import { WORLD } from '../data/world';
import { buildNav, depthAt, generateWorld, type GeneratedWorld } from './mapgen';

/**
 * The bounded, camera-scrolled world of an action run: renders a
 * `GeneratedWorld` (`systems/mapgen.ts` — the default, ~36 screens with the
 * composition budgets baked in) and owns its static collision and nav grid.
 *
 * Layers (depth):
 *   -300 floor — one TileSprite of `arena-floor` (procedural ground fallback)
 *   -299 floor-variant blend brushes: soft radial MULTIPLY discs, one per tile
 *        of variant 1/2, overlapping so every transition is a ~600 px feather,
 *        never a tile edge (variant ART would swap these for duskhaul-style
 *        pattern brushes, `games/2026-08-29-duskhaul/src/systems/arena.ts`)
 *   -295 roads — the same soft disc, darker, every `ROAD_STEP` px along the
 *        road polylines, so a road is one smooth band
 *   -280 decals — baked desaturated + darkened into the floor band
 *   -270 wall band · 6 props (static circular bodies)
 *
 * Lazy chunks: every floor overlay, decal and prop is bucketed as DATA into
 * `CHUNK`² chunks; the chunks within `ACTIVE_RING` of the camera's chunk are
 * materialised (sprites + prop bodies) and those beyond `RELEASE_RING` are
 * destroyed (hysteresis, so walking along a chunk edge never churns). The live
 * ring reaches ≥ 2,048 px from the camera centre — past the enemy leash
 * (`TUNING.enemy.leashPx`) and the spawn ring — so every body an actor can
 * touch exists; farther actors steer on `nav`, which knows every blocker.
 *
 * An `ArenaLayout` (map-forge bundle) replaces generation with authored
 * geometry through the same renderer, nav raster and collision.
 *
 * Missing art never crashes: the floor falls back to the procedural ground
 * tile, props to a tinted square, decals are skipped.
 */

/**
 * Authored space produced outside the generator — typically a map-forge
 * bundle mapped field-for-field: `floorKey`/prop and decal `id`s are
 * texture-registry keys, `props[].id` matches `PropDef.id` from
 * `data/props.ts` (unmatched ids fall back to a tinted procedural square),
 * `decals[].id` matches a `DecalDef`'s `texture` (unmatched ids are skipped —
 * decals are purely cosmetic). `walkable` narrows the in-bounds rectangle
 * `clamp`/`isOutside`/the nav raster use when the authored field is larger
 * than the playable room (e.g. background overscan); it defaults to the full
 * `width`/`height` rectangle. The hero starts at the walkable centre.
 */
export type ArenaLayout = {
  width: number;
  height: number;
  floorKey?: string;
  props?: Array<{ id: string; x: number; y: number; bodyRadius?: number }>;
  decals?: Array<{ id: string; x: number; y: number }>;
  walkable?: { x: number; y: number; w: number; h: number };
};

const CHUNK = 1024;
/** Chunks within this Chebyshev ring of the camera's chunk are live. */
const ACTIVE_RING = 2;
/** Live chunks beyond this ring are destroyed. */
const RELEASE_RING = 3;
const CULL_EVERY_MS = 250;
const GROUND_TEXTURE = 'arena-ground';
const BRUSH_TEXTURE = 'arena-softbrush';
const BRUSH_PX = 256;
/** Floor-variant grades (neutral hues: red/green belong to the team outlines). */
const VARIANT_GRADE = [0, 0x8e96a8, 0xa89c88] as const;
const VARIANT_ALPHA = 0.42;
/** A variant brush spans this many floor tiles, so neighbours overlap into a feather. */
const VARIANT_SPAN = 2.4;
const ROAD_GRADE = 0x5c5854;
const ROAD_ALPHA = 0.5;
const ROAD_STEP = 70;
/** Decals: 70% desaturated, then multiplied by this grey (stays in the floor's value band). */
const DECAL_GRADE = '#9a9a9a';
const PROP_DEPTH = 6;
/** Display size and collision fraction used for an authored prop id absent from `PROPS`. */
const FALLBACK_PROP: Omit<PropDef, 'id' | 'texture'> = {
  size: 128,
  bodyScale: 0.5,
  artScale: 1,
  weight: 0,
  fallbackTint: PALETTE.inkSoft,
};

/** One floor overlay / decal / prop of a chunk, as data until the chunk goes live. */
type Spec =
  | { t: 'brush'; x: number; y: number; size: number; tint: number; alpha: number; depth: number }
  | { t: 'decal'; x: number; y: number; key: string; size: number; rot: number; alpha: number }
  | { t: 'prop'; x: number; y: number; bodyRadius: number; def: PropDef };

interface LiveChunk {
  objects: Phaser.GameObjects.GameObject[];
}

export class Arena {
  /** Static bodies every mover collides with. */
  readonly obstacles: Phaser.Physics.Arcade.StaticGroup;
  readonly width: number;
  readonly height: number;
  /** Where the hero starts (`GeneratedWorld.spawn`). */
  readonly spawn: { x: number; y: number };
  readonly world: GeneratedWorld;
  /** Flow-field grid over `world.nav` — `systems/combat.ts` steers enemies with it. */
  readonly nav: NavGrid;

  private readonly scene: Phaser.Scene;
  /** In-bounds rectangle for `clamp`/`isOutside`. */
  private readonly walkable: { x: number; y: number; w: number; h: number };
  private readonly propDefs: Record<string, PropDef>;
  private readonly specs: Spec[][];
  private readonly chunkCols: number;
  private readonly chunkRows: number;
  private readonly live = new Map<number, LiveChunk>();
  private cullAt = 0;

  constructor(scene: Phaser.Scene, seed: string, layout?: ArenaLayout) {
    this.scene = scene;
    this.propDefs = {};
    for (const def of WORLD.props) this.propDefs[def.id] = def;
    this.world = layout === undefined ? generateWorld(WORLD, seed) : this.worldFromLayout(layout);
    this.width = this.world.width;
    this.height = this.world.height;
    this.spawn = { x: this.world.spawn.x, y: this.world.spawn.y };
    const t = TUNING.arena.wallThickness;
    this.walkable = layout?.walkable ?? { x: t, y: t, w: this.width - t * 2, h: this.height - t * 2 };
    const { cols, rows, cell, blocked } = this.world.nav;
    this.nav = NavGrid.fromBlocked(cols, rows, cell, blocked);
    this.obstacles = scene.physics.add.staticGroup();
    this.chunkCols = Math.ceil(this.width / CHUNK);
    this.chunkRows = Math.ceil(this.height / CHUNK);
    this.specs = Array.from({ length: this.chunkCols * this.chunkRows }, () => []);

    this.addFloor(layout?.floorKey);
    this.indexRoads();
    this.indexDecals();
    this.indexProps();
    this.addWalls();
    // Bodies around the spawn exist before the first cull tick.
    this.activateAround(this.spawn.x, this.spawn.y);

    scene.physics.world.setBounds(0, 0, this.width, this.height);
    scene.cameras.main.setBounds(0, 0, this.width, this.height);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  /** Keeps a point inside the walkable field with a margin. */
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

  /** World depth under a point: 0 at the spawn, 1 at the walls (`systems/mapgen.ts depthAt`). */
  depthAt(x: number, y: number): number {
    return depthAt(this.world, x, y);
  }

  /** Live chunk / static body census (debug overlays, perf budgets). */
  stats(): { liveChunks: number; objects: number; bodies: number } {
    let objects = 0;
    for (const chunk of this.live.values()) objects += chunk.objects.length;
    return { liveChunks: this.live.size, objects, bodies: this.obstacles.getLength() };
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this);
    this.live.clear();
  }

  private tick(time: number): void {
    if (time < this.cullAt) return;
    this.cullAt = time + CULL_EVERY_MS;
    const view = this.scene.cameras.main.worldView;
    this.activateAround(view.centerX, view.centerY);
  }

  /** Materialises the chunks within `ACTIVE_RING` of a world point; releases those beyond `RELEASE_RING`. */
  private activateAround(x: number, y: number): void {
    const cc = Phaser.Math.Clamp(Math.floor(x / CHUNK), 0, this.chunkCols - 1);
    const cr = Phaser.Math.Clamp(Math.floor(y / CHUNK), 0, this.chunkRows - 1);
    for (const [key, chunk] of this.live) {
      const c = key % this.chunkCols;
      const r = (key - c) / this.chunkCols;
      if (Math.max(Math.abs(c - cc), Math.abs(r - cr)) <= RELEASE_RING) continue;
      for (const obj of chunk.objects) obj.destroy();
      this.live.delete(key);
    }
    for (let r = Math.max(0, cr - ACTIVE_RING); r <= Math.min(this.chunkRows - 1, cr + ACTIVE_RING); r += 1) {
      for (let c = Math.max(0, cc - ACTIVE_RING); c <= Math.min(this.chunkCols - 1, cc + ACTIVE_RING); c += 1) {
        const key = r * this.chunkCols + c;
        if (!this.live.has(key)) this.live.set(key, this.materialise(this.specs[key]!));
      }
    }
  }

  private materialise(specs: readonly Spec[]): LiveChunk {
    const objects: Phaser.GameObjects.GameObject[] = [];
    for (const sp of specs) {
      switch (sp.t) {
        case 'brush':
          objects.push(
            this.scene.add
              .image(sp.x, sp.y, BRUSH_TEXTURE)
              .setDisplaySize(sp.size, sp.size)
              .setTint(sp.tint)
              .setAlpha(sp.alpha)
              .setBlendMode(Phaser.BlendModes.MULTIPLY)
              .setDepth(sp.depth),
          );
          break;
        case 'decal':
          objects.push(
            this.scene.add.image(sp.x, sp.y, sp.key).setDisplaySize(sp.size, sp.size).setRotation(sp.rot).setAlpha(sp.alpha).setDepth(-280),
          );
          break;
        case 'prop':
          objects.push(this.buildProp(sp));
          break;
      }
    }
    return { objects };
  }

  private index(spec: Spec): void {
    const col = Phaser.Math.Clamp(Math.floor(spec.x / CHUNK), 0, this.chunkCols - 1);
    const row = Phaser.Math.Clamp(Math.floor(spec.y / CHUNK), 0, this.chunkRows - 1);
    this.specs[row * this.chunkCols + col]!.push(spec);
  }

  /** Base tile layer plus one feathered MULTIPLY brush per variant-1/2 tile (no seams). */
  private addFloor(floorKey?: string): void {
    const tile = this.world.floor.cell;
    let texture = floorKey ?? 'arena-floor';
    if (!this.scene.textures.exists(texture)) {
      buildGroundTile(this.scene, GROUND_TEXTURE, tile);
      texture = GROUND_TEXTURE;
    }
    this.scene.add.tileSprite(0, 0, this.width, this.height, texture).setOrigin(0, 0).setDepth(-300);
    this.softBrush();
    const { cols, rows, variant } = this.world.floor;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const v = variant[r * cols + c]!;
        if (v === 0) continue;
        this.index({ t: 'brush', x: (c + 0.5) * tile, y: (r + 0.5) * tile, size: tile * VARIANT_SPAN, tint: VARIANT_GRADE[v as 1 | 2], alpha: VARIANT_ALPHA, depth: -299 });
      }
    }
  }

  /** White disc, opaque to 30% of the radius and fading to 0 at the rim — the floor and road brush. */
  private softBrush(): void {
    if (this.scene.textures.exists(BRUSH_TEXTURE)) return;
    const canvas = this.scene.textures.createCanvas(BRUSH_TEXTURE, BRUSH_PX, BRUSH_PX);
    const ctx = canvas?.getContext();
    if (canvas === null || ctx === undefined) return;
    const half = BRUSH_PX / 2;
    const g = ctx.createRadialGradient(half, half, half * 0.3, half, half, half);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, BRUSH_PX, BRUSH_PX);
    canvas.refresh();
  }

  private indexRoads(): void {
    const size = this.world.roadWidth * 1.5;
    if (size <= 0) return;
    for (const s of this.world.roads) {
      const len = Math.hypot(s.bx - s.ax, s.by - s.ay);
      const steps = Math.max(1, Math.round(len / ROAD_STEP));
      for (let k = 0; k < steps; k += 1) {
        const t = k / steps;
        this.index({ t: 'brush', x: s.ax + (s.bx - s.ax) * t, y: s.ay + (s.by - s.ay) * t, size, tint: ROAD_GRADE, alpha: ROAD_ALPHA, depth: -295 });
      }
    }
  }

  /**
   * Bakes a decal into the floor's value band once (70% desaturated, then
   * multiplied by `DECAL_GRADE`, keeping the art's own alpha) so no decal
   * carries the outline hues or competes with actors and pickups.
   */
  private bakeDecal(def: DecalDef): string | null {
    if (!this.scene.textures.exists(def.texture)) return null;
    const key = `arena-decal-${def.id}`;
    if (this.scene.textures.exists(key)) return key;
    const src = this.scene.textures.get(def.texture).getSourceImage() as CanvasImageSource & { width: number; height: number };
    const canvas = this.scene.textures.createCanvas(key, src.width, src.height);
    const ctx = canvas?.getContext();
    if (canvas === null || ctx === undefined) return null;
    ctx.drawImage(src, 0, 0);
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, src.width, src.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = DECAL_GRADE;
    ctx.fillRect(0, 0, src.width, src.height);
    // Restore the art's silhouette (the fills above painted its transparent margin).
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(src, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    canvas.refresh();
    return key;
  }

  private indexDecals(): void {
    const baked: Record<string, string | null> = {};
    for (const d of this.world.decals) {
      const def = WORLD.decals.find((row) => row.id === d.id);
      if (def === undefined) continue;
      baked[def.id] ??= this.bakeDecal(def);
      const key = baked[def.id];
      if (key === null || key === undefined) continue;
      this.index({ t: 'decal', x: d.x, y: d.y, key, size: def.size, rot: d.rot, alpha: d.alpha });
    }
  }

  private indexProps(): void {
    for (const p of this.world.props) {
      const def = this.propDefs[p.id] ?? { ...FALLBACK_PROP, id: p.id, texture: `prop-${p.id}` };
      this.index({ t: 'prop', x: p.x, y: p.y, bodyRadius: p.bodyRadius, def });
    }
  }

  private buildProp(p: Extract<Spec, { t: 'prop' }>): Phaser.Physics.Arcade.Sprite {
    const def = p.def;
    const hasArt = this.scene.textures.exists(def.texture);
    const sprite = this.scene.physics.add.staticSprite(p.x, p.y, hasArt ? def.texture : TEX.square);
    sprite.setDisplaySize(def.size, def.size).setDepth(PROP_DEPTH).setFlipX(def.flipX === true);
    if (!hasArt) sprite.setTint(def.fallbackTint);
    else if (def.grade !== undefined) sprite.setTint(def.grade);

    const body = sprite.body as Phaser.Physics.Arcade.StaticBody | null;
    if (body !== null) {
      // A StaticBody's circle is in WORLD px and its centre is derived as
      // `position + halfWidth`, so the position must be written first and
      // `setCircle` called last: `setCircle` is what re-inserts the body into
      // the static RTree. Doing it the other way round leaves a stale tree
      // entry — the prop then blocks nothing, which is exactly how enemies end
      // up walking through rocks. Never call `updateFromGameObject` afterwards:
      // it overwrites the radius with the sprite's display size.
      body.position.set(p.x - p.bodyRadius, p.y - p.bodyRadius);
      body.setCircle(p.bodyRadius);
    }
    this.obstacles.add(sprite);
    return sprite;
  }

  /**
   * Walls are primitives: a glowing inner border plus four static bodies just
   * outside it. Drawing them keeps the field readable at any world size and
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

  /** An authored layout as a `GeneratedWorld`: its props/decals, one floor variant, no roads/POIs, the same nav raster. */
  private worldFromLayout(layout: ArenaLayout): GeneratedWorld {
    const walkable = layout.walkable ?? { x: 0, y: 0, w: layout.width, h: layout.height };
    const spawn = { x: Math.round(walkable.x + walkable.w / 2), y: Math.round(walkable.y + walkable.h / 2) };
    const props = (layout.props ?? []).map((p) => {
      const def = this.propDefs[p.id] ?? { ...FALLBACK_PROP, id: p.id, texture: `prop-${p.id}` };
      return { id: p.id, x: p.x, y: p.y, bodyRadius: p.bodyRadius ?? propBodyRadius(def), artRadius: propArtRadius(def) };
    });
    const decals = (layout.decals ?? []).flatMap((d) => {
      const def = WORLD.decals.find((row) => row.texture === d.id);
      return def === undefined ? [] : [{ id: def.id, x: d.x, y: d.y, rot: 0, alpha: def.alpha, radius: def.size / 2 }];
    });
    const tile = TUNING.arena.tileSize;
    const cols = Math.ceil(layout.width / tile);
    const rows = Math.ceil(layout.height / tile);
    const { nav, sealed } = buildNav(layout.width, layout.height, walkable, props, spawn);
    return {
      seed: 'layout',
      world: 'layout',
      width: layout.width,
      height: layout.height,
      spawn,
      floor: { cell: tile, cols, rows, variant: new Uint8Array(cols * rows) },
      roads: [],
      roadWidth: 0,
      props,
      decals,
      pois: [],
      nav,
      metrics: { screens: (layout.width * layout.height) / (VIEW.width * VIEW.height), sealedCells: sealed, ms: 0 },
    };
  }
}
