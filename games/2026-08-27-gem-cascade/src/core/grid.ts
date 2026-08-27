/**
 * Tile-grid navigation via BFS flow fields: the standard way to steer dozens
 * of tower-defense creeps toward a base, or roguelike/tactics units toward a
 * target tile, without per-entity A*. Build one flow field per goal per frame
 * (or whenever the goal/obstacles change) and every entity just reads its
 * current cell's precomputed direction — O(1) per entity per frame instead of
 * O(path length) per entity.
 *
 * Do NOT use this for large open-world pathing with many simultaneous distinct
 * goals (that wants per-agent A-star/navmesh instead) — flow fields shine when
 * many agents share one or a few goals, which is exactly the TD/swarm case.
 *
 * Pure TypeScript, no Phaser import. `worldToCell`/`cellToWorldCenter` assume
 * the grid's origin is world (0, 0); offset world coordinates before calling
 * if the grid is placed elsewhere.
 */

const UNREACHABLE = -1;

export class NavGrid {
  private readonly cols: number;
  private readonly rows: number;
  private readonly tileSize: number;
  private readonly blocked: Uint8Array;
  private readonly dist: Int32Array;
  /** Per-cell steering direction, interleaved [dx0, dy0, dx1, dy1, ...]. */
  private readonly dir: Float32Array;
  private readonly bfsQueue: Int32Array;

  constructor(cols: number, rows: number, tileSize: number) {
    this.cols = cols;
    this.rows = rows;
    this.tileSize = tileSize;
    const cellCount = cols * rows;
    this.blocked = new Uint8Array(cellCount);
    this.dist = new Int32Array(cellCount);
    this.dir = new Float32Array(cellCount * 2);
    this.bfsQueue = new Int32Array(cellCount);
  }

  private index(col: number, row: number): number {
    return row * this.cols + col;
  }

  private inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  setBlocked(col: number, row: number, blockedFlag: boolean): void {
    if (!this.inBounds(col, row)) return;
    this.blocked[this.index(col, row)] = blockedFlag ? 1 : 0;
  }

  isBlocked(col: number, row: number): boolean {
    if (!this.inBounds(col, row)) return true;
    return this.blocked[this.index(col, row)] === 1;
  }

  /**
   * BFS from the goal over 4-neighbours, filling `dist` (steps to goal, -1 if
   * unreachable) and `dir` (unit vector pointing toward the neighbour closest
   * to the goal). Reuses the pre-allocated typed arrays every call.
   */
  buildFlowField(goalCol: number, goalRow: number): void {
    this.dist.fill(UNREACHABLE);
    this.dir.fill(0);
    if (!this.inBounds(goalCol, goalRow) || this.isBlocked(goalCol, goalRow)) return;

    const goalIndex = this.index(goalCol, goalRow);
    this.dist[goalIndex] = 0;
    let head = 0;
    let tail = 0;
    this.bfsQueue[tail] = goalIndex;
    tail += 1;

    while (head < tail) {
      const current = this.bfsQueue[head];
      head += 1;
      if (current === undefined) continue;
      const row = Math.floor(current / this.cols);
      const col = current - row * this.cols;
      const currentDist = this.dist[current] ?? UNREACHABLE;

      tail = this.relaxNeighbour(col + 1, row, col, row, currentDist, tail);
      tail = this.relaxNeighbour(col - 1, row, col, row, currentDist, tail);
      tail = this.relaxNeighbour(col, row + 1, col, row, currentDist, tail);
      tail = this.relaxNeighbour(col, row - 1, col, row, currentDist, tail);
    }
  }

  /** Relaxes one BFS neighbour; returns the (possibly advanced) queue tail. */
  private relaxNeighbour(
    nCol: number,
    nRow: number,
    curCol: number,
    curRow: number,
    currentDist: number,
    tail: number,
  ): number {
    if (!this.inBounds(nCol, nRow) || this.isBlocked(nCol, nRow)) return tail;
    const nIndex = this.index(nCol, nRow);
    if ((this.dist[nIndex] ?? UNREACHABLE) !== UNREACHABLE) return tail;
    this.dist[nIndex] = currentDist + 1;
    // Direction points from the neighbour toward the current cell (closer to goal).
    this.dir[nIndex * 2] = curCol - nCol;
    this.dir[nIndex * 2 + 1] = curRow - nRow;
    this.bfsQueue[tail] = nIndex;
    return tail + 1;
  }

  /**
   * Writes the normalised steering direction for the cell under the given
   * world position into `out`. Returns false (and leaves `out` untouched) if
   * the cell is unreachable or outside the grid.
   */
  steer(worldX: number, worldY: number, out: { x: number; y: number }): boolean {
    const col = Math.floor(worldX / this.tileSize);
    const row = Math.floor(worldY / this.tileSize);
    if (!this.inBounds(col, row)) return false;
    const cellIndex = this.index(col, row);
    if ((this.dist[cellIndex] ?? UNREACHABLE) === UNREACHABLE) return false;
    if (this.dist[cellIndex] === 0) {
      out.x = 0;
      out.y = 0;
      return true;
    }
    const dx = this.dir[cellIndex * 2] ?? 0;
    const dy = this.dir[cellIndex * 2 + 1] ?? 0;
    const len = Math.hypot(dx, dy);
    if (len === 0) return false;
    out.x = dx / len;
    out.y = dy / len;
    return true;
  }

  pathExists(fromCol: number, fromRow: number): boolean {
    if (!this.inBounds(fromCol, fromRow)) return false;
    return (this.dist[this.index(fromCol, fromRow)] ?? UNREACHABLE) !== UNREACHABLE;
  }

  worldToCell(worldX: number, worldY: number, out: { col: number; row: number }): void {
    out.col = Math.floor(worldX / this.tileSize);
    out.row = Math.floor(worldY / this.tileSize);
  }

  cellToWorldCenter(col: number, row: number, out: { x: number; y: number }): void {
    out.x = col * this.tileSize + this.tileSize / 2;
    out.y = row * this.tileSize + this.tileSize / 2;
  }
}
