/**
 * Chunked, culled terrain (PRD §15): the static ground — biome floor tiles,
 * blockers on blocked tiles, world props — is stamped into 8 × 8-tile chunk
 * textures. Only chunks under the camera hold a texture; a fixed pool of
 * DynamicTextures is re-stamped when a chunk scrolls into view, so memory is
 * flat whatever the map size and each visible chunk is ONE draw.
 */
import Phaser from 'phaser';
import { buildPrefiltered } from '../../../core/textures';
import type { SiteMap } from '../threat/terrain';
import { ART_TILE, PROP_DRAW_PX } from './artMap';

const CHUNK_TILES = 8;
const CHUNK_PX = CHUNK_TILES * ART_TILE;
/** Chunks visible at the lowest zoom stop (0.7: 4 × 5) plus a scroll margin. */
const POOL = 28;
const PROP_CELL = 128;

interface ChunkSlot { key: string; tex: Phaser.Textures.DynamicTexture; img: Phaser.GameObjects.Image; chunk: number }

export class TerrainLayer {
  private readonly map: SiteMap;
  private readonly chunkCols: number;
  private readonly chunkRows: number;
  private readonly slots: ChunkSlot[] = [];
  /** Chunk index → slot (−1 = not resident). */
  private readonly resident: Int16Array;
  /** Prefiltered floor key per variant (a, b, c). */
  private readonly floors: Array<string | null>;
  /** Blockers and props bucketed by chunk, with prefiltered keys (`map.blockers` / `map.props`, W2). */
  private readonly stamps: Array<{ key: string; frame: number; x: number; y: number; scale: number; chunk: number; prop: boolean }> = [];
  /** Props currently inside resident, visible chunks (cert composition probe). */
  visibleProps = 0;
  /** Per-cull scratch (no allocation per frame). */
  private readonly wanted: number[] = [];
  private keep = new Uint8Array(0);

  constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, map: SiteMap, poolTag: string) {
    this.map = map;
    this.chunkCols = Math.ceil(map.cols / CHUNK_TILES);
    this.chunkRows = Math.ceil(map.rows / CHUNK_TILES);
    this.resident = new Int16Array(this.chunkCols * this.chunkRows).fill(-1);
    this.floors = ['a', 'b', 'c'].map((v) => buildPrefiltered(scene, `${map.artBiome}-floor-${v}`, 512, ART_TILE));
    const chunkOf = (col: number, row: number): number => Math.floor(row / CHUNK_TILES) * this.chunkCols + Math.floor(col / CHUNK_TILES);
    // wiring §4: blockers draw at the footprint size (64 px per tile), centred on the footprint.
    for (const b of map.blockers) {
      const key = buildPrefiltered(scene, b.key, 256, b.size * ART_TILE);
      if (key === null) continue;
      const cx = (b.col + b.size / 2) * ART_TILE;
      const cy = (b.row + b.size / 2) * ART_TILE;
      this.stamps.push({ key, frame: b.frame, x: cx, y: cy, scale: 1, chunk: chunkOf(b.col + b.size / 2, b.row + b.size / 2), prop: false });
    }
    // wiring §5: props at 80 px (reviewed), centred on their tile.
    for (const p of map.props) {
      const key = buildPrefiltered(scene, p.key, 256, PROP_CELL);
      if (key === null) continue;
      this.stamps.push({ key, frame: p.frame, x: (p.col + 0.5) * ART_TILE, y: (p.row + 0.5) * ART_TILE, scale: PROP_DRAW_PX / PROP_CELL, chunk: chunkOf(p.col, p.row), prop: true });
    }
    for (let i = 0; i < POOL; i += 1) {
      const key = `terrain-chunk-${poolTag}-${i}`;
      if (scene.textures.exists(key)) scene.textures.remove(key);
      const tex = scene.textures.addDynamicTexture(key, CHUNK_PX, CHUNK_PX);
      if (tex === null) break;
      const img = scene.add.image(0, 0, key).setOrigin(0, 0).setVisible(false);
      parent.add(img);
      this.slots.push({ key, tex, img, chunk: -1 });
    }
    this.keep = new Uint8Array(this.slots.length);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const s of this.slots) if (scene.textures.exists(s.key)) scene.textures.remove(s.key);
      this.slots.length = 0;
    });
  }

  /** Makes every chunk overlapping the world rect resident; hides the rest. */
  cull(x0: number, y0: number, x1: number, y1: number): void {
    const c0 = Math.max(0, Math.floor(x0 / CHUNK_PX));
    const r0 = Math.max(0, Math.floor(y0 / CHUNK_PX));
    const c1 = Math.min(this.chunkCols - 1, Math.floor(x1 / CHUNK_PX));
    const r1 = Math.min(this.chunkRows - 1, Math.floor(y1 / CHUNK_PX));
    const wanted = this.wanted;
    wanted.length = 0;
    for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) wanted.push(r * this.chunkCols + c);
    const keep = this.keep;
    keep.fill(0);
    for (const chunk of wanted) {
      const s = this.resident[chunk] ?? -1;
      if (s >= 0) keep[s] = 1;
    }
    let props = 0;
    for (const chunk of wanted) {
      let s = this.resident[chunk] ?? -1;
      if (s < 0) {
        s = keep.indexOf(0);
        if (s < 0) continue;
        keep[s] = 1;
        this.fill(s, chunk);
      }
      const slot = this.slots[s];
      if (slot !== undefined && !slot.img.visible) slot.img.setVisible(true);
    }
    for (let i = 0; i < this.slots.length; i += 1) {
      const slot = this.slots[i];
      if (slot !== undefined && keep[i] === 0 && slot.img.visible) slot.img.setVisible(false);
    }
    for (const p of this.stamps) {
      if (!p.prop) continue;
      const s = this.resident[p.chunk] ?? -1;
      if (s >= 0 && this.slots[s]?.img.visible === true) props += 1;
    }
    this.visibleProps = props;
  }

  private fill(slotIndex: number, chunk: number): void {
    const slot = this.slots[slotIndex];
    if (slot === undefined) return;
    if (slot.chunk >= 0) this.resident[slot.chunk] = -1;
    slot.chunk = chunk;
    this.resident[chunk] = slotIndex;
    const cc = chunk % this.chunkCols;
    const cr = Math.floor(chunk / this.chunkCols);
    slot.img.setPosition(cc * CHUNK_PX, cr * CHUNK_PX);
    const tex = slot.tex;
    tex.clear();
    const { cols, rows, floor } = this.map;
    const top = { originX: 0, originY: 0 };
    for (let dr = 0; dr < CHUNK_TILES; dr += 1) {
      const r = cr * CHUNK_TILES + dr;
      if (r >= rows) break;
      for (let dc = 0; dc < CHUNK_TILES; dc += 1) {
        const c = cc * CHUNK_TILES + dc;
        if (c >= cols) break;
        const key = this.floors[floor[r * cols + c] ?? 0] ?? this.floors[0];
        if (key !== null && key !== undefined) tex.stamp(key, '__BASE', dc * ART_TILE, dr * ART_TILE, top);
      }
    }
    // A 2×2 blocker or a prop may overhang its chunk: stamp neighbours' too, clipped by the texture.
    for (const p of this.stamps) {
      const pc = p.chunk % this.chunkCols;
      const pr = Math.floor(p.chunk / this.chunkCols);
      if (Math.abs(pc - cc) > 1 || Math.abs(pr - cr) > 1) continue;
      tex.stamp(p.key, p.frame, p.x - cc * CHUNK_PX, p.y - cr * CHUNK_PX, { scale: p.scale });
    }
    tex.render();
  }
}
