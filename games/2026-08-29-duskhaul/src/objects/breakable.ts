/**
 * Breakable urns/coffins/crates (PRD-V2 §5.13, §16.1 E20).
 *
 * `map.breakables` (~600 per map, placed by mapgen) is bucketed into
 * `breakable.chunk`² chunks. A chunk's sprites exist only while the hero is
 * within `breakable.spawnPx` of it and are returned to a pool beyond
 * `breakable.despawnPx` (hysteresis); the destroyed flag lives in a per-map
 * `Uint8Array`, so a broken urn stays broken (rendered as debris) for the run.
 * Every drop is rolled through the passed run `Rng` (`rollBreakableDrop`).
 */
import type Phaser from 'phaser';
import { TUNING } from '../config';
import { TEX } from '../core/keys';
import type { Rng } from '../core/rng';
import { rollBreakableDrop } from '../data/pickups';
import type { GeneratedMap, PickupDrop } from '../data/types-v2';

const KIND_FRAME: Record<'urn' | 'coffin' | 'crate', number> = { urn: 0, coffin: 1, crate: 2 };
/** Sheet layout (ArtPOI batch 5): frames 0-2 intact urn/coffin/crate, +3 broken. */
const BROKEN_FRAME_OFFSET = 3;
const DISPLAY_PX = 88;
/** Hit radius of one breakable body, world px. */
const BREAKABLE_BODY_PX = 30;
/** Ground props sit with the floor decals, under pickups (8) and actors. */
const BREAKABLE_DEPTH = 6;
const FALLBACK_TINT: Record<'urn' | 'coffin' | 'crate', number> = { urn: 0x8a6a4a, coffin: 0x5a4a3e, crate: 0x7a5a36 };

interface Chunk {
  /** Indices into `map.breakables`. */
  members: number[];
  /** Live sprites while the chunk is spawned; null while despawned. */
  sprites: Phaser.GameObjects.Image[] | null;
  cx: number;
  cy: number;
}

export class BreakableField {
  private readonly scene: Phaser.Scene;
  private readonly map: GeneratedMap;
  private readonly rng: Rng;
  private readonly dropMul: number;
  private readonly onDrop: (drop: PickupDrop, x: number, y: number) => void;
  private readonly texture: string;
  private readonly hasArt: boolean;
  private readonly destroyed: Uint8Array;
  private readonly chunks: Chunk[] = [];
  private readonly chunkCols: number;
  private readonly chunkSize: number;
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private brokenCount = 0;
  /** Hero below `drops.pk_bread.lowHpRatio` at the last `update` — raises the bread chance. */
  private heroLowHp = false;

  constructor(
    scene: Phaser.Scene,
    map: GeneratedMap,
    rng: Rng,
    dropMul: number,
    onDrop: (drop: PickupDrop, x: number, y: number) => void,
  ) {
    this.scene = scene;
    this.map = map;
    this.rng = rng;
    this.dropMul = dropMul;
    this.onDrop = onDrop;
    this.texture = `brk-${map.zone}`;
    this.hasArt = scene.textures.exists(this.texture);
    this.destroyed = new Uint8Array(map.breakables.length);
    this.chunkSize = TUNING.breakable.chunk;
    this.chunkCols = Math.max(1, Math.ceil(map.width / this.chunkSize));
    const chunkRows = Math.max(1, Math.ceil(map.height / this.chunkSize));
    for (let r = 0; r < chunkRows; r += 1) {
      for (let c = 0; c < this.chunkCols; c += 1) {
        this.chunks.push({ members: [], sprites: null, cx: (c + 0.5) * this.chunkSize, cy: (r + 0.5) * this.chunkSize });
      }
    }
    map.breakables.forEach((b, i) => this.chunkAt(b.x, b.y)?.members.push(i));
  }

  /** Breakables destroyed this run (`RunReport.breakablesBroken`). */
  get broken(): number {
    return this.brokenCount;
  }

  /** Chunks currently holding sprites (debug/perf readout). */
  get liveChunks(): number {
    return this.chunks.reduce((n, c) => n + (c.sprites === null ? 0 : 1), 0);
  }

  /** Spawns chunks within `spawnPx` of the hero, despawns those beyond `despawnPx`; `hpRatio` feeds the low-HP bread chance. */
  update(hero: { x: number; y: number; hpRatio?: number }): void {
    this.heroLowHp = (hero.hpRatio ?? 1) < TUNING.breakable.drops.pk_bread.lowHpRatio;
    // The hero's body smashes what it walks into: bolt-only builds have no area
    // hit, and the in-run heal (bread) must not depend on the weapon draft.
    this.hitCircle(hero.x, hero.y, TUNING.player.bodyRadius);
    const { spawnPx, despawnPx } = TUNING.breakable;
    const half = this.chunkSize / 2;
    for (const chunk of this.chunks) {
      if (chunk.members.length === 0) continue;
      // Distance from the hero to the chunk RECT (0 inside it).
      const dx = Math.max(0, Math.abs(hero.x - chunk.cx) - half);
      const dy = Math.max(0, Math.abs(hero.y - chunk.cy) - half);
      const d = Math.hypot(dx, dy);
      if (chunk.sprites === null && d <= spawnPx) this.spawnChunk(chunk);
      else if (chunk.sprites !== null && d > despawnPx) this.despawnChunk(chunk);
    }
  }

  /** Breaks every intact breakable of a spawned chunk touching the circle; returns how many broke. */
  hitCircle(x: number, y: number, r: number): number {
    const reach = r + BREAKABLE_BODY_PX;
    const reach2 = reach * reach;
    const c0 = Math.floor((x - reach) / this.chunkSize);
    const c1 = Math.floor((x + reach) / this.chunkSize);
    const r0 = Math.floor((y - reach) / this.chunkSize);
    const r1 = Math.floor((y + reach) / this.chunkSize);
    let hits = 0;
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        if (col < 0 || row < 0 || col >= this.chunkCols) continue;
        const chunk = this.chunks[row * this.chunkCols + col];
        if (chunk === undefined || chunk.sprites === null) continue;
        chunk.members.forEach((index, slot) => {
          if (this.destroyed[index] === 1) return;
          const b = this.map.breakables[index]!;
          const dx = b.x - x;
          const dy = b.y - y;
          if (dx * dx + dy * dy > reach2) return;
          this.destroyed[index] = 1;
          this.brokenCount += 1;
          hits += 1;
          this.skin(chunk.sprites![slot]!, b.kind, true);
          const drop = rollBreakableDrop(this.rng, this.dropMul, this.heroLowHp);
          if (drop !== null) this.onDrop(drop, b.x, b.y);
        });
      }
    }
    return hits;
  }

  /** Scene SHUTDOWN: pooled images are scene-owned; drop references. */
  destroy(): void {
    for (const chunk of this.chunks) if (chunk.sprites !== null) this.despawnChunk(chunk);
    for (const img of this.pool) img.destroy();
    this.pool.length = 0;
  }

  private chunkAt(x: number, y: number): Chunk | undefined {
    const col = Math.min(this.chunkCols - 1, Math.max(0, Math.floor(x / this.chunkSize)));
    const row = Math.max(0, Math.floor(y / this.chunkSize));
    return this.chunks[row * this.chunkCols + col];
  }

  private spawnChunk(chunk: Chunk): void {
    chunk.sprites = chunk.members.map((index) => {
      const b = this.map.breakables[index]!;
      const img = this.pool.pop() ?? this.scene.add.image(0, 0, TEX.disc);
      img.setPosition(b.x, b.y).setDepth(BREAKABLE_DEPTH).setVisible(true).setActive(true);
      this.skin(img, b.kind, this.destroyed[index] === 1);
      return img;
    });
  }

  private despawnChunk(chunk: Chunk): void {
    for (const img of chunk.sprites ?? []) {
      img.setVisible(false).setActive(false);
      this.pool.push(img);
    }
    chunk.sprites = null;
  }

  private skin(img: Phaser.GameObjects.Image, kind: 'urn' | 'coffin' | 'crate', broken: boolean): void {
    if (this.hasArt) {
      img.setTexture(this.texture, KIND_FRAME[kind] + (broken ? BROKEN_FRAME_OFFSET : 0));
      img.clearTint().setAlpha(1).setDisplaySize(DISPLAY_PX, DISPLAY_PX);
      return;
    }
    // Procedural fallback: a tinted disc; debris reads as a flat, faded chip.
    img.setTexture(TEX.disc).setTint(FALLBACK_TINT[kind]);
    img.setDisplaySize(broken ? DISPLAY_PX * 0.6 : DISPLAY_PX * 0.55, broken ? DISPLAY_PX * 0.3 : DISPLAY_PX * 0.55);
    img.setAlpha(broken ? 0.45 : 1);
  }
}
