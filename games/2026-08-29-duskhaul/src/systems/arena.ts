import Phaser from 'phaser';
import { PALETTE, TUNING } from '../config';
import { TEX } from '../core/keys';
import { buildGroundTile } from '../core/textures';
import { DECALS_BY_ZONE, PROPS_BY_ZONE, SPLAT_PX, type DecalDef, type PropDef } from '../data/props';
import type { GeneratedMap } from '../data/types-v2';
import type { ZoneDef } from '../data/zones';
import { FLOOR_GRADE } from '../ui/duskChrome';

/**
 * Renders a `GeneratedMap` (PRD-V2 §3.7, §15; §16.1 E3) and owns its static
 * collision: the bounded 24576² field the camera follows.
 *
 * Layers (depth):
 *   -300 floor — ONE Phaser Tilemap layer, 96×96 tiles of 256 px of variant
 *        a, ground grade × `lighting.gradeMul` baked in, camera-culled
 *   -299 soft blend brushes for variants b/c (`addFloor`: no tile seams)
 *   -295 roads — soft `road-<zone>` brushes along mapgen's road curves
 *        (decals with id `road-<zone>`), so roads are smooth bands, not tiles
 *   -290 splats (512 px, alpha 0.4) · -280 decals (baked desaturated, alpha 0.4) · -270 border band
 *   -260 light pools (additive `fx-lightpool`, zone tint, 1.2 s flicker)
 *      6 props · 10 + y/height tall-prop bases (Y-sorted among actors)
 *     30 tall-prop tops (alpha 0.6 while the focus stands behind them)
 *
 * Lazy chunks (24576² map, ~5,000 props + ~15,000 decals/splats/lights):
 * the map's content is bucketed as DATA into 1024² chunks. `updateCulling`
 * (every 250 ms from the scene) materialises the chunks within
 * `ACTIVE_RING` chunks of the camera's centre chunk — sprites, the props'
 * static bodies, tall tops, light pools — and destroys the ones beyond
 * `RELEASE_RING` (hysteresis, so walking along a chunk edge never churns).
 * The ring reaches ≥ 2,048 px from the camera centre, past the enemy leash
 * (1,800 px) and spawn ring, so every body an actor can touch exists; farther
 * actors steer on the nav grid, which already knows every blocker. Inside the
 * live chunks, only objects meeting the padded camera view are visible.
 * Counts: `stats()` (§19: visible props ≤ 80; plus live bodies).
 *
 * Missing art never crashes: floors fall back to the V1 `floor-<zone>` tile
 * and then the procedural ground tile, props to a tinted square, splats and
 * decals are skipped, light pools use the procedural disc.
 */

const CHUNK = 1024;
/** Chunks within this Chebyshev ring of the camera's chunk are live. */
const ACTIVE_RING = 2;
/** Live chunks beyond this ring are destroyed. */
const RELEASE_RING = 3;
const CULL_PAD = 128;
const FLOOR_TILESET = 'arena-floorset';
const GROUND_TEXTURE = 'arena-ground';
const LIGHT_KEY = 'fx-lightpool';
const ROAD_BRUSH = 'arena-roadbrush';
/** Extra darkening baked into decals on top of the ground grade. */
const DECAL_DARKEN = 0.8;
const LIGHT_FLICKER_MS = 1200;
const TOP_DEPTH = 30;
const TOP_BEHIND_ALPHA = 0.6;
const PROP_DEPTH = 6;
/** Low-tier device mode (§15): keep one in N decals/splats/light pools. */
const LOW_TIER_KEEP = 2;

interface Culled {
  obj: Phaser.GameObjects.Image;
  /** World-space half extent used for the view test. */
  half: number;
  kind: 'prop' | 'top' | 'decal' | 'light';
  /** Low-tier devices draw only objects with `lowTierKeep`. */
  lowTierKeep: boolean;
}

/** One cosmetic/prop entry of a chunk, as data until the chunk goes live. */
type Spec =
  | { t: 'splat'; x: number; y: number; key: string; rot: number; alpha: number; keep: boolean }
  | { t: 'road'; x: number; y: number; rot: number }
  | { t: 'blend'; x: number; y: number; key: string; size: number }
  | { t: 'decal'; x: number; y: number; key: string; size: number; rot: number; alpha: number; keep: boolean }
  | { t: 'light'; x: number; y: number; r: number; phase: number; keep: boolean }
  | { t: 'prop'; x: number; y: number; bodyRadius: number; tall: boolean; rot: number; def: PropDef | undefined };

interface LiveChunk {
  items: Culled[];
  tops: TallTop[];
  lights: Light[];
  props: Phaser.Physics.Arcade.Sprite[];
}

interface TallTop {
  top: Phaser.GameObjects.Image;
  x: number;
  y: number;
  /** Half width and height of the drawn art, for the "focus is behind" test. */
  halfW: number;
  height: number;
}

interface Light {
  img: Phaser.GameObjects.Image;
  phase: number;
}

export class Arena {
  /** Static bodies every mover collides with. */
  readonly obstacles: Phaser.Physics.Arcade.StaticGroup;
  readonly width: number;
  readonly height: number;
  /** Player start (`GeneratedMap.spawn`). */
  readonly spawn: { x: number; y: number };
  readonly map: GeneratedMap;

  private readonly scene: Phaser.Scene;
  private readonly walkable: { x: number; y: number; w: number; h: number };
  private readonly grade: number;
  private readonly specs: Spec[][];
  private readonly chunkCols: number;
  private readonly chunkRows: number;
  private readonly live = new Map<number, LiveChunk>();
  private readonly shown = new Set<Culled>();
  private readonly lightTint: number;
  private readonly roadBrushKey: string | null;
  private readonly roadBrushPx = TUNING.mapgen.roadWidth * 1.35;
  private readonly hasLightArt: boolean;
  private readonly lightAlpha = TUNING.lighting.poolAlpha;
  private focus: { x: number; y: number } | null = null;
  private lowTier = false;
  private visibleCounts = { props: 0, decals: 0, lights: 0, liveChunks: 0, bodies: 0 };

  constructor(scene: Phaser.Scene, map: GeneratedMap, zone: ZoneDef) {
    this.scene = scene;
    this.map = map;
    this.width = map.width;
    this.height = map.height;
    this.spawn = { x: map.spawn.x, y: map.spawn.y };
    const band = TUNING.mapgen.borderBand;
    this.walkable = { x: band, y: band, w: this.width - band * 2, h: this.height - band * 2 };
    this.grade = scaleColor(FLOOR_GRADE[zone.id], TUNING.lighting.gradeMul);
    this.obstacles = scene.physics.add.staticGroup();
    this.chunkCols = Math.ceil(this.width / CHUNK);
    this.chunkRows = Math.ceil(this.height / CHUNK);
    this.specs = Array.from({ length: this.chunkCols * this.chunkRows }, () => []);
    this.lightTint = zone.lightTint;
    this.hasLightArt = scene.textures.exists(LIGHT_KEY);

    this.addFloor(zone);
    this.roadBrushKey = this.roadBrush(zone);
    this.indexSplats();
    this.indexDecals(zone);
    this.addBorder(zone);
    this.indexLights();
    this.indexProps(zone);
    // Bodies around the spawn exist before the first `updateCulling`.
    this.activateAround(this.spawn.x, this.spawn.y);

    scene.physics.world.setBounds(0, 0, this.width, this.height);
    // Camera bounds padded by half a view of void (QA #2 / critic F8): at the
    // walls the camera keeps the hero centred instead of clamping it under
    // the HUD band, the minimap or the thumb. The pad continues the zone's
    // border stone and fades to dark (`paintPad`).
    const cam = scene.cameras.main;
    const padX = cam.width / (2 * cam.zoom);
    const padY = cam.height / (2 * cam.zoom) + Math.abs(TUNING.arena.cameraOffsetY);
    cam.setBounds(-padX, -padY, this.width + padX * 2, this.height + padY * 2);
    this.paintPad(zone, padX, padY);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  /** Keeps a point inside the walkable field (inside the border band) with a margin. */
  clamp(x: number, y: number, margin: number, out: { x: number; y: number }): void {
    out.x = Phaser.Math.Clamp(x, this.walkable.x + margin, this.walkable.x + this.walkable.w - margin);
    out.y = Phaser.Math.Clamp(y, this.walkable.y + margin, this.walkable.y + this.walkable.h - margin);
  }

  /** True when a point is farther than `margin` outside the walkable field. */
  isOutside(x: number, y: number, margin: number): boolean {
    return (
      x < this.walkable.x - margin ||
      y < this.walkable.y - margin ||
      x > this.walkable.x + this.walkable.w + margin ||
      y > this.walkable.y + this.walkable.h + margin
    );
  }

  /** The actor tall-prop tops fade for when it stands behind them (normally the hero). */
  setFocus(target: { x: number; y: number } | null): void {
    this.focus = target;
  }

  /** §15 low-tier fallback: halves visible decals, splats and light pools. */
  setLowTier(on: boolean): void {
    if (this.lowTier === on) return;
    this.lowTier = on;
    for (const c of this.shown) {
      if (c.kind === 'decal' || c.kind === 'light') c.obj.setVisible(!on || c.lowTierKeep);
    }
  }

  /** Visible-object counters (debug / §19 "visible props ≤ 80"), plus live chunks and static prop bodies. */
  stats(): { props: number; decals: number; lights: number; liveChunks: number; bodies: number } {
    return { ...this.visibleCounts };
  }

  /**
   * §16.1 E3: shows exactly the cosmetic objects whose bounds meet the camera
   * view (padded), hides those that left it. Call every ~250 ms and once after
   * the camera first centres on the spawn.
   */
  updateCulling(camera: Phaser.Cameras.Scene2D.Camera): void {
    const v = camera.worldView;
    this.activateAround(v.centerX, v.centerY);
    const x0 = v.x - CULL_PAD;
    const y0 = v.y - CULL_PAD;
    const x1 = v.right + CULL_PAD;
    const y1 = v.bottom + CULL_PAD;
    const next = new Set<Culled>();
    const c0 = Math.max(0, Math.floor((x0 - CHUNK / 2) / CHUNK));
    const c1 = Math.min(this.chunkCols - 1, Math.floor((x1 + CHUNK / 2) / CHUNK));
    const r0 = Math.max(0, Math.floor((y0 - CHUNK / 2) / CHUNK));
    const r1 = Math.min(this.chunkRows - 1, Math.floor((y1 + CHUNK / 2) / CHUNK));
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const chunk = this.live.get(r * this.chunkCols + c);
        if (chunk === undefined) continue;
        for (const item of chunk.items) {
          const o = item.obj;
          if (o.x + item.half < x0 || o.x - item.half > x1 || o.y + item.half < y0 || o.y - item.half > y1) continue;
          next.add(item);
        }
      }
    }
    for (const item of this.shown) if (!next.has(item) && item.obj.active) item.obj.setVisible(false);
    let props = 0;
    let decals = 0;
    let lights = 0;
    for (const item of next) {
      const on = !this.lowTier || item.kind === 'prop' || item.kind === 'top' || item.lowTierKeep;
      item.obj.setVisible(on);
      if (!on) continue;
      if (item.kind === 'prop') props += 1;
      else if (item.kind === 'decal') decals += 1;
      else if (item.kind === 'light') lights += 1;
    }
    this.shown.clear();
    for (const item of next) this.shown.add(item);
    let bodies = 0;
    for (const chunk of this.live.values()) bodies += chunk.props.length;
    this.visibleCounts = { props, decals, lights, liveChunks: this.live.size, bodies };
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this);
    this.shown.clear();
    this.live.clear();
    this.focus = null;
  }

  /** Materialises the chunks within `ACTIVE_RING` of a world point; releases those beyond `RELEASE_RING`. */
  private activateAround(x: number, y: number): void {
    const cc = Phaser.Math.Clamp(Math.floor(x / CHUNK), 0, this.chunkCols - 1);
    const cr = Phaser.Math.Clamp(Math.floor(y / CHUNK), 0, this.chunkRows - 1);
    for (const [key, chunk] of this.live) {
      const c = key % this.chunkCols;
      const r = (key - c) / this.chunkCols;
      if (Math.max(Math.abs(c - cc), Math.abs(r - cr)) <= RELEASE_RING) continue;
      this.release(chunk);
      this.live.delete(key);
    }
    for (let r = Math.max(0, cr - ACTIVE_RING); r <= Math.min(this.chunkRows - 1, cr + ACTIVE_RING); r += 1) {
      for (let c = Math.max(0, cc - ACTIVE_RING); c <= Math.min(this.chunkCols - 1, cc + ACTIVE_RING); c += 1) {
        const key = r * this.chunkCols + c;
        if (!this.live.has(key)) this.live.set(key, this.materialise(this.specs[key]!));
      }
    }
  }

  private release(chunk: LiveChunk): void {
    for (const item of chunk.items) {
      this.shown.delete(item);
      item.obj.destroy();
    }
  }

  private materialise(specs: readonly Spec[]): LiveChunk {
    const chunk: LiveChunk = { items: [], tops: [], lights: [], props: [] };
    const add = (obj: Phaser.GameObjects.Image, half: number, kind: Culled['kind'], lowTierKeep: boolean): void => {
      obj.setVisible(false);
      chunk.items.push({ obj, half, kind, lowTierKeep });
    };
    for (const sp of specs) {
      switch (sp.t) {
        case 'splat':
          add(
            this.scene.add.image(sp.x, sp.y, sp.key).setDisplaySize(SPLAT_PX, SPLAT_PX).setRotation(sp.rot).setAlpha(sp.alpha).setTint(this.grade).setDepth(-290),
            SPLAT_PX * 0.71,
            'decal',
            sp.keep,
          );
          break;
        case 'blend':
          add(this.scene.add.image(sp.x, sp.y, sp.key).setDepth(-299), sp.size * 0.71, 'decal', true);
          break;
        case 'road':
          add(
            this.scene.add.image(sp.x, sp.y, this.roadBrushKey!).setDisplaySize(this.roadBrushPx, this.roadBrushPx).setRotation(sp.rot).setDepth(-295),
            this.roadBrushPx * 0.71,
            'decal',
            true,
          );
          break;
        case 'decal':
          add(
            this.scene.add.image(sp.x, sp.y, sp.key).setDisplaySize(sp.size, sp.size).setRotation(sp.rot).setAlpha(sp.alpha).setDepth(-280),
            sp.size * 0.71,
            'decal',
            sp.keep,
          );
          break;
        case 'light': {
          const img = this.scene.add
            .image(sp.x, sp.y, this.hasLightArt ? LIGHT_KEY : TEX.disc)
            .setDisplaySize(sp.r * 2, sp.r * 2)
            .setTint(this.lightTint)
            .setAlpha(this.lightAlpha)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setDepth(-260);
          chunk.lights.push({ img, phase: sp.phase });
          add(img, sp.r, 'light', sp.keep);
          break;
        }
        case 'prop':
          this.buildProp(sp, chunk, add);
          break;
      }
    }
    return chunk;
  }

  // === per-frame: flicker + occlusion (visible objects only) ================

  private tick(time: number): void {
    const f = this.focus;
    for (const chunk of this.live.values()) {
      for (const l of chunk.lights) {
        if (!l.img.visible) continue;
        const t = ((time + l.phase) / LIGHT_FLICKER_MS) * Math.PI * 2;
        l.img.setAlpha(this.lightAlpha + TUNING.lighting.flicker * Math.sin(t));
      }
      for (const t of chunk.tops) {
        if (!t.top.visible) continue;
        // Behind = the focus stands above the prop's foot line, inside its drawn silhouette.
        const behind = f !== null && f.y < t.y && f.y > t.y - t.height && Math.abs(f.x - t.x) < t.halfW;
        t.top.setAlpha(behind ? TOP_BEHIND_ALPHA : 1);
      }
    }
  }

  // === construction =========================================================

  private index(spec: Spec): void {
    const col = Phaser.Math.Clamp(Math.floor(spec.x / CHUNK), 0, this.chunkCols - 1);
    const row = Phaser.Math.Clamp(Math.floor(spec.y / CHUNK), 0, this.chunkRows - 1);
    this.specs[row * this.chunkCols + col]!.push(spec);
  }

  /**
   * Floor without seams (user bug: variants switched on hard tile/chunk
   * edges). The Tilemap layer (96×96 × 256 px, camera-culled) draws ONLY
   * variant a. Variants b and c are laid over it as soft 1024 px blend
   * brushes — the variant tile repeated 4×4 under a radial alpha mask (opaque
   * to 30% of the radius, fading to 0 at the rim) — one per 2×2 tile block
   * where `map.floor.variant` has that variant dominant. Brushes are centred
   * on tile corners and never rotated, so their stones stay on the same 256 px
   * grid as the tiles: overlapping brushes of one variant add opacity, never a
   * doubled pattern, and every transition is a ~300 px feather, not an edge.
   * Brushes are lazy chunk items like every other floor overlay.
   */
  private addFloor(zone: ZoneDef): void {
    const tile = this.map.floor.cell;
    const keys = [`floor-${zone.id}-a`, `floor-${zone.id}-b`, `floor-${zone.id}-c`];
    const v1 = `floor-${zone.id}`;
    const fallback = this.scene.textures.exists(v1) ? v1 : GROUND_TEXTURE;
    if (fallback === GROUND_TEXTURE) buildGroundTile(this.scene, GROUND_TEXTURE, tile);
    const srcOf = (i: number): CanvasImageSource =>
      this.scene.textures.get(this.scene.textures.exists(keys[i]!) ? keys[i]! : fallback).getSourceImage() as CanvasImageSource;
    const gradeHex = `#${this.grade.toString(16).padStart(6, '0')}`;

    if (this.scene.textures.exists(FLOOR_TILESET)) this.scene.textures.remove(FLOOR_TILESET);
    const canvas = this.scene.textures.createCanvas(FLOOR_TILESET, tile, tile);
    const ctx = canvas?.getContext();
    if (canvas === null || ctx === undefined) return;
    ctx.drawImage(srcOf(0), 0, 0, tile, tile);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = gradeHex;
    ctx.fillRect(0, 0, tile, tile);
    ctx.globalCompositeOperation = 'source-over';
    canvas.refresh();

    const { cols, rows, variant } = this.map.floor;
    const data: number[][] = [];
    for (let r = 0; r < rows; r += 1) data.push(new Array<number>(cols).fill(0));
    const tilemap = this.scene.make.tilemap({ data, tileWidth: tile, tileHeight: tile });
    const tileset = tilemap.addTilesetImage(FLOOR_TILESET, FLOOR_TILESET, tile, tile, 0, 0);
    if (tileset === null) return;
    tilemap.createLayer(0, tileset, 0, 0)?.setDepth(-300);

    // Blend brushes for variants b and c.
    const brushKeys = [1, 2].map((v) => {
      const key = `arena-floorblend-${v}`;
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
      const size = tile * 4;
      const bc = this.scene.textures.createCanvas(key, size, size);
      const bx = bc?.getContext();
      if (bc === null || bx === undefined) return null;
      for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) bx.drawImage(srcOf(v), x * tile, y * tile, tile, tile);
      bx.globalCompositeOperation = 'multiply';
      bx.fillStyle = gradeHex;
      bx.fillRect(0, 0, size, size);
      bx.globalCompositeOperation = 'destination-in';
      const g = bx.createRadialGradient(size / 2, size / 2, size * 0.15, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.35, 'rgba(0,0,0,0.85)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      bx.fillStyle = g;
      bx.fillRect(0, 0, size, size);
      bx.globalCompositeOperation = 'source-over';
      bc.refresh();
      return key;
    });
    for (let r = 0; r + 1 < rows; r += 2) {
      for (let c = 0; c + 1 < cols; c += 2) {
        const n = [0, 0, 0];
        for (const i of [r * cols + c, r * cols + c + 1, (r + 1) * cols + c, (r + 1) * cols + c + 1]) n[variant[i]!] = (n[variant[i]!] ?? 0) + 1;
        const v = n[1]! >= 2 ? 1 : n[2]! >= 2 ? 2 : 0;
        const key = v === 0 ? null : brushKeys[v - 1];
        if (key === null || key === undefined) continue;
        this.index({ t: 'blend', x: (c + 1) * tile, y: (r + 1) * tile, key, size: tile * 4 });
      }
    }
  }

  private indexSplats(): void {
    let n = 0;
    for (const sp of this.map.splats) {
      if (!this.scene.textures.exists(sp.id)) continue;
      this.index({ t: 'splat', x: sp.x, y: sp.y, key: sp.id, rot: sp.rot, alpha: sp.alpha, keep: n++ % LOW_TIER_KEEP === 0 });
    }
  }

  /**
   * Soft round road brush baked from `road-<zone>` (or a darkened floor tile):
   * the tile masked by a radial alpha falloff, graded like the floor.
   */
  private roadBrush(zone: ZoneDef): string | null {
    const src = [`road-${zone.id}`, `floor-${zone.id}-a`, `floor-${zone.id}`].find((k) => this.scene.textures.exists(k));
    if (src === undefined) return null;
    if (this.scene.textures.exists(ROAD_BRUSH)) this.scene.textures.remove(ROAD_BRUSH);
    const px = 256;
    const canvas = this.scene.textures.createCanvas(ROAD_BRUSH, px, px);
    const ctx = canvas?.getContext();
    if (canvas === null || ctx === undefined) return null;
    ctx.drawImage(this.scene.textures.get(src).getSourceImage() as CanvasImageSource, 0, 0, px, px);
    if (src !== `road-${zone.id}`) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, 0, px, px);
    }
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `#${this.grade.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, px, px);
    ctx.globalCompositeOperation = 'destination-in';
    const g = ctx.createRadialGradient(px / 2, px / 2, px * 0.22, px / 2, px / 2, px / 2);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, px, px);
    ctx.globalCompositeOperation = 'source-over';
    canvas.refresh();
    return ROAD_BRUSH;
  }

  /**
   * Bakes a decal cell into floor value (user bug: decals competed with
   * enemies): 70% desaturated — so no decal carries the red/green outline
   * hues — then multiplied by the ground grade × `DECAL_DARKEN`, keeping the
   * cell's own alpha. Drawn at the data alpha (0.4), debris stays inside the
   * floor's value band and below every actor's key forms.
   */
  private bakeDecal(def: DecalDef): string | null {
    if (!this.scene.textures.exists(def.texture)) return null;
    const key = `arena-decal-${def.id}`;
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    const frame = this.scene.textures.getFrame(def.texture, def.frame);
    if (frame === null) return null;
    const w = frame.cutWidth;
    const h = frame.cutHeight;
    const canvas = this.scene.textures.createCanvas(key, w, h);
    const ctx = canvas?.getContext();
    if (canvas === null || ctx === undefined) return null;
    const src = frame.source.image as CanvasImageSource;
    ctx.drawImage(src, frame.cutX, frame.cutY, w, h, 0, 0, w, h);
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `#${scaleColor(this.grade, DECAL_DARKEN).toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, w, h);
    // Restore the cell's own silhouette (the fills above painted the transparent margin).
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(src, frame.cutX, frame.cutY, w, h, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    canvas.refresh();
    return key;
  }

  private indexDecals(zone: ZoneDef): void {
    const defs: Record<string, DecalDef> = {};
    for (const d of DECALS_BY_ZONE[zone.id]) defs[d.id] = d;
    const roadId = `road-${zone.id}`;
    const baked: Record<string, string | null> = {};
    let n = 0;
    for (const d of this.map.decals) {
      if (d.id === roadId) {
        if (this.roadBrushKey !== null) this.index({ t: 'road', x: d.x, y: d.y, rot: d.rot });
        continue;
      }
      const def = defs[d.id];
      if (def === undefined) continue;
      const key = baked[def.id] !== undefined ? baked[def.id]! : (baked[def.id] = this.bakeDecal(def));
      if (key === null) continue;
      this.index({ t: 'decal', x: d.x, y: d.y, key, size: def.size, rot: d.rot, alpha: d.alpha, keep: n++ % LOW_TIER_KEEP === 0 });
    }
  }

  /**
   * The border band (`mapgen.borderBand`, never walkable): the zone's own
   * `border-<id>` tile, deliberately UNGRADED (it is already the art run's
   * shadow value), else a procedural band — plus four static wall bodies.
   */
  /**
   * The camera pad beyond the walls (critic v2b): the zone's own `border-<zone>`
   * stone continues outward, then fades to `bgDeep` through a baked gradient,
   * so the wall reads as the edge of a larger ruin instead of a flat band.
   * Without border art the pad is plain `bgDeep`.
   */
  private paintPad(zone: ZoneDef, padX: number, padY: number): void {
    const key = `border-${zone.id}`;
    const W = this.width;
    const H = this.height;
    const bands: Array<[number, number, number, number]> = [
      [-padX, -padY, W + padX * 2, padY],
      [-padX, H, W + padX * 2, padY],
      [-padX, 0, padX, H],
      [W, 0, padX, H],
    ];
    if (!this.scene.textures.exists(key)) {
      const g = this.scene.add.graphics().setDepth(-310);
      g.fillStyle(PALETTE.bgDeep, 1);
      for (const [x, y, w, h] of bands) g.fillRect(x, y, w, h);
      return;
    }
    for (const [x, y, w, h] of bands) this.scene.add.tileSprite(x, y, w, h, key).setOrigin(0, 0).setDepth(-310);
    // Fade: transparent at the wall → bgDeep at 70% of the pad. One vertical
    // and one horizontal 1-D gradient texture, stretched and flipped per side.
    const fadeV = this.padFade('arena-padfade-v', false);
    const fadeH = this.padFade('arena-padfade-h', true);
    const at = (tex: string, x: number, y: number, w: number, h: number, flipX: boolean, flipY: boolean): void => {
      this.scene.add.image(x, y, tex).setOrigin(0, 0).setDisplaySize(w, h).setFlip(flipX, flipY).setDepth(-305);
    };
    at(fadeV, -padX, -padY, W + padX * 2, padY, false, false);
    at(fadeV, -padX, H, W + padX * 2, padY, false, true);
    at(fadeH, -padX, 0, padX, H, false, false);
    at(fadeH, W, 0, padX, H, true, false);
  }

  /** 1-D alpha ramp: opaque `bgDeep` at the outer end (0), clear at the wall end (1). */
  private padFade(key: string, horizontal: boolean): string {
    if (this.scene.textures.exists(key)) return key;
    const len = 256;
    const canvas = this.scene.textures.createCanvas(key, horizontal ? len : 4, horizontal ? 4 : len);
    const ctx = canvas?.getContext();
    if (canvas === null || ctx === undefined) return key;
    const grad = horizontal ? ctx.createLinearGradient(0, 0, len, 0) : ctx.createLinearGradient(0, 0, 0, len);
    const c = `${(PALETTE.bgDeep >> 16) & 0xff},${(PALETTE.bgDeep >> 8) & 0xff},${PALETTE.bgDeep & 0xff}`;
    grad.addColorStop(0, `rgba(${c},1)`);
    grad.addColorStop(0.3, `rgba(${c},1)`);
    grad.addColorStop(0.75, `rgba(${c},0.45)`);
    grad.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, horizontal ? len : 4, horizontal ? 4 : len);
    canvas.refresh();
    return key;
  }

  private addBorder(zone: ZoneDef): void {
    const t = TUNING.mapgen.borderBand;
    const key = `border-${zone.id}`;
    if (this.scene.textures.exists(key)) {
      const band = (x: number, y: number, w: number, h: number): void => {
        this.scene.add.tileSprite(x, y, w, h, key).setOrigin(0, 0).setDepth(-270);
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

  private indexLights(): void {
    let n = 0;
    for (const l of this.map.lightPools) {
      this.index({ t: 'light', x: l.x, y: l.y, r: l.r, phase: (n * 397) % LIGHT_FLICKER_MS, keep: n % LOW_TIER_KEEP === 0 });
      n += 1;
    }
  }

  private indexProps(zone: ZoneDef): void {
    const defs: Record<string, PropDef> = {};
    for (const d of PROPS_BY_ZONE[zone.id]) defs[d.id] = d;
    for (const p of this.map.props) {
      this.index({ t: 'prop', x: p.x, y: p.y, bodyRadius: p.bodyRadius, tall: p.tall === true, rot: p.rot ?? 0, def: defs[p.id] });
    }
  }

  private buildProp(
    p: Extract<Spec, { t: 'prop' }>,
    chunk: LiveChunk,
    add: (obj: Phaser.GameObjects.Image, half: number, kind: Culled['kind'], keep: boolean) => void,
  ): void {
    const def = p.def;
    const size = def?.size ?? p.bodyRadius * 2.6;
    const hasArt = def !== undefined && this.scene.textures.exists(def.texture);
    const sprite = hasArt
      ? this.scene.physics.add.staticSprite(p.x, p.y, def.texture, def.frame)
      : this.scene.physics.add.staticSprite(p.x, p.y, TEX.square);
    sprite.setDisplaySize(size, size).setRotation(p.rot);
    // Scenery is ground: it takes the floor's grade; the fallback carries its own tint.
    sprite.setTint(hasArt ? this.grade : def?.fallbackTint ?? PALETTE.inkSoft);
    sprite.setDepth(p.tall ? 10 + p.y / this.height : PROP_DEPTH);

    const body = sprite.body as Phaser.Physics.Arcade.StaticBody | null;
    if (body !== null) {
      // Position first, `setCircle` last: `setCircle` re-inserts the static
      // body into the RTree (a stale entry blocks nothing). Never call
      // `updateFromGameObject` afterwards — it resets the radius.
      body.position.set(p.x - p.bodyRadius, p.y - p.bodyRadius);
      body.setCircle(p.bodyRadius);
    }
    this.obstacles.add(sprite);
    chunk.props.push(sprite);
    add(sprite, size / 2, 'prop', true);

    if (p.tall && def?.top !== undefined && this.scene.textures.exists(def.top.key)) {
      const top = this.scene.add
        .image(p.x, p.y, def.top.key, def.top.frame)
        .setDisplaySize(size, size)
        .setRotation(p.rot)
        .setTint(this.grade)
        .setDepth(TOP_DEPTH);
      chunk.tops.push({ top, x: p.x, y: p.y, halfW: size * 0.35, height: size * 0.5 });
      add(top, size / 2, 'top', true);
    }
  }
}

function scaleColor(color: number, mul: number): number {
  const r = Math.round(((color >> 16) & 0xff) * mul);
  const g = Math.round(((color >> 8) & 0xff) * mul);
  const b = Math.round((color & 0xff) * mul);
  return (r << 16) | (g << 8) | b;
}
