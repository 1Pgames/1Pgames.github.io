/**
 * Uniform-grid spatial hash for broad-phase queries: "which enemies are near
 * this explosion", "what's in range of this tower", "who can this melee swing
 * hit". Needed the moment naive O(n²) distance checks show up in the profiler
 * — i.e. essentially every survivor-like (hundreds of enemies) and any tower
 * defense with area attacks.
 *
 * Do NOT use this for a handful of entities (<30) that already fit in a plain
 * array scan, and do NOT use it in place of Arcade physics overlap for actual
 * collision response — this is for read-only proximity queries.
 *
 * Pure TypeScript, no Phaser import. Rebuild once per frame with `clear` +
 * `insert` for every tracked entity, then query as many times as needed;
 * `queryCircle`/`queryRect` write into the caller's `out` array instead of
 * allocating, so they can run inside hot loops (e.g. once per enemy per frame).
 */

export class SpatialHash<T> {
  private readonly cellSize: number;
  private readonly buckets = new Map<number, T[]>();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  clear(): void {
    this.buckets.clear();
  }

  insert(x: number, y: number, item: T): void {
    const key = this.cellKey(x, y);
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    bucket.push(item);
  }

  /** Fills `out` with every item whose cell overlaps the circle. Truncates and returns `out`. */
  queryCircle(x: number, y: number, radius: number, out: T[]): T[] {
    let n = 0;
    const minCol = Math.floor((x - radius) / this.cellSize);
    const maxCol = Math.floor((x + radius) / this.cellSize);
    const minRow = Math.floor((y - radius) / this.cellSize);
    const maxRow = Math.floor((y + radius) / this.cellSize);
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const bucket = this.buckets.get(this.packCell(col, row));
        if (bucket === undefined) continue;
        for (const item of bucket) {
          if (n < out.length) out[n] = item;
          else out.push(item);
          n += 1;
        }
      }
    }
    out.length = n;
    return out;
  }

  /** Fills `out` with every item whose cell overlaps the axis-aligned rect. */
  queryRect(minX: number, minY: number, maxX: number, maxY: number, out: T[]): T[] {
    let n = 0;
    const minCol = Math.floor(minX / this.cellSize);
    const maxCol = Math.floor(maxX / this.cellSize);
    const minRow = Math.floor(minY / this.cellSize);
    const maxRow = Math.floor(maxY / this.cellSize);
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const bucket = this.buckets.get(this.packCell(col, row));
        if (bucket === undefined) continue;
        for (const item of bucket) {
          if (n < out.length) out[n] = item;
          else out.push(item);
          n += 1;
        }
      }
    }
    out.length = n;
    return out;
  }

  private cellKey(x: number, y: number): number {
    return this.packCell(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize));
  }

  /** Packs signed col/row into one integer key without allocating a string. */
  private packCell(col: number, row: number): number {
    return (col + 0x8000) * 0x10000 + (row + 0x8000);
  }
}
