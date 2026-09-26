/**
 * Tile-grid navigation via BFS flow fields: the standard way to steer many
 * swarm enemies toward one goal (the hero) without per-entity A*. Build one
 * flow field per goal (or whenever the goal cell changes) and every entity
 * reads its current cell's precomputed direction — O(1) per entity per frame.
 *
 * Big-map mode: `buildFlowFieldWindow` only floods a square window of
 * `radiusCells` around the goal (28 cells = 1,792 px at 64 px/cell), so a
 * rebuild costs ≤ 57² cells regardless of world size. Outside the window
 * `steer` returns false and the caller steers straight at the goal. The
 * arena slice rebuilds it whenever the hero changes cell (`systems/combat.ts`)
 * over `GeneratedWorld.nav` (`systems/mapgen.ts`). Also the tower-defense /
 * base-builder grid (`systems/placement.ts`): whole-grid `buildFlowField`.
 *
 * Validity is tracked with a per-build generation stamp instead of clearing
 * the distance array, so a rebuild touches only the cells it floods.
 *
 * Directions come from the 8-neighbour of lowest BFS distance (diagonals only
 * when both orthogonal sides are open — no corner cutting through blockers),
 * which gives smooth 45° steering instead of 4-way staircase motion.
 *
 * Pure TypeScript, no Phaser import. The grid origin is world (0, 0).
 */

const UNREACHABLE = -1;
const DIAG = Math.SQRT1_2;

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly tileSize: number;
  private readonly blocked: Uint8Array;
  private readonly dist: Int32Array;
  /** Generation that wrote `dist[i]`; a cell is valid only when it equals `generation`. */
  private readonly stamp: Uint32Array;
  /** Per-cell unit steering direction, interleaved [dx0, dy0, dx1, dy1, ...]. */
  private readonly dir: Float32Array;
  private readonly bfsQueue: Int32Array;
  private generation = 0;
  private winMinCol = 0;
  private winMaxCol = -1;
  private winMinRow = 0;
  private winMaxRow = -1;
  private goalIndex = -1;

  constructor(cols: number, rows: number, tileSize: number) {
    this.cols = cols;
    this.rows = rows;
    this.tileSize = tileSize;
    const cellCount = cols * rows;
    this.blocked = new Uint8Array(cellCount);
    this.dist = new Int32Array(cellCount);
    this.stamp = new Uint32Array(cellCount);
    this.dir = new Float32Array(cellCount * 2);
    this.bfsQueue = new Int32Array(cellCount);
  }

  /** A grid over a pre-rasterised blocked mask (`GeneratedMap.nav`). The mask is copied. */
  static fromBlocked(cols: number, rows: number, cell: number, blocked: Uint8Array): NavGrid {
    if (blocked.length !== cols * rows) {
      throw new Error(`NavGrid.fromBlocked: mask has ${blocked.length} cells, expected ${cols * rows}`);
    }
    const grid = new NavGrid(cols, rows, cell);
    grid.blocked.set(blocked);
    return grid;
  }

  private inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  setBlocked(col: number, row: number, blockedFlag: boolean): void {
    if (!this.inBounds(col, row)) return;
    this.blocked[row * this.cols + col] = blockedFlag ? 1 : 0;
  }

  /** Out-of-bounds cells count as blocked. */
  isBlocked(col: number, row: number): boolean {
    if (!this.inBounds(col, row)) return true;
    return this.blocked[row * this.cols + col] === 1;
  }

  /** `isBlocked` for a world point (spawn-ring rejection). Outside the grid = blocked. */
  isBlockedAt(worldX: number, worldY: number): boolean {
    return this.isBlocked(Math.floor(worldX / this.tileSize), Math.floor(worldY / this.tileSize));
  }

  /** Whole-grid flow field toward a goal cell. */
  buildFlowField(goalCol: number, goalRow: number): void {
    this.buildFlowFieldWindow(goalCol, goalRow, Math.max(this.cols, this.rows));
  }

  /**
   * BFS from the goal over 4-neighbours, restricted to the square
   * window `goal ± radiusCells` (clamped to the grid), then resolves one
   * steering direction per reached cell. Allocation-free.
   */
  buildFlowFieldWindow(goalCol: number, goalRow: number, radiusCells: number): void {
    this.generation = (this.generation + 1) >>> 0;
    if (this.generation === 0) {
      this.stamp.fill(0);
      this.generation = 1;
    }
    const gen = this.generation;
    this.winMinCol = Math.max(0, goalCol - radiusCells);
    this.winMaxCol = Math.min(this.cols - 1, goalCol + radiusCells);
    this.winMinRow = Math.max(0, goalRow - radiusCells);
    this.winMaxRow = Math.min(this.rows - 1, goalRow + radiusCells);
    this.goalIndex = -1;
    if (!this.inBounds(goalCol, goalRow) || this.isBlocked(goalCol, goalRow)) return;

    const cols = this.cols;
    const goal = goalRow * cols + goalCol;
    this.goalIndex = goal;
    this.dist[goal] = 0;
    this.stamp[goal] = gen;
    const queue = this.bfsQueue;
    let head = 0;
    let tail = 0;
    queue[tail++] = goal;

    while (head < tail) {
      const cur = queue[head++]!;
      const row = (cur / cols) | 0;
      const col = cur - row * cols;
      const nd = this.dist[cur]! + 1;
      if (col < this.winMaxCol) tail = this.relax(cur + 1, nd, tail);
      if (col > this.winMinCol) tail = this.relax(cur - 1, nd, tail);
      if (row < this.winMaxRow) tail = this.relax(cur + cols, nd, tail);
      if (row > this.winMinRow) tail = this.relax(cur - cols, nd, tail);
    }

    // Direction pass over the flooded cells only (the queue holds them all).
    for (let q = 1; q < tail; q += 1) this.resolveDir(queue[q]!);
    this.dir[goal * 2] = 0;
    this.dir[goal * 2 + 1] = 0;
  }

  private relax(n: number, nd: number, tail: number): number {
    if (this.blocked[n] === 1 || this.stamp[n] === this.generation) return tail;
    this.stamp[n] = this.generation;
    this.dist[n] = nd;
    this.bfsQueue[tail] = n;
    return tail + 1;
  }

  /** Distance of a neighbour, or +∞ when it is outside the flood. */
  private distOf(col: number, row: number): number {
    if (col < this.winMinCol || col > this.winMaxCol || row < this.winMinRow || row > this.winMaxRow) {
      return Number.POSITIVE_INFINITY;
    }
    const i = row * this.cols + col;
    return this.stamp[i] === this.generation ? this.dist[i]! : Number.POSITIVE_INFINITY;
  }

  private resolveDir(i: number): void {
    const row = (i / this.cols) | 0;
    const col = i - row * this.cols;
    const e = this.distOf(col + 1, row);
    const w = this.distOf(col - 1, row);
    const s = this.distOf(col, row + 1);
    const n = this.distOf(col, row - 1);
    let best = this.dist[i]!;
    let dx = 0;
    let dy = 0;
    // Orthogonal first; a diagonal must be strictly better and needs both sides open.
    if (e < best) { best = e; dx = 1; dy = 0; }
    if (w < best) { best = w; dx = -1; dy = 0; }
    if (s < best) { best = s; dx = 0; dy = 1; }
    if (n < best) { best = n; dx = 0; dy = -1; }
    const d = best - 1;
    if (e !== Infinity && s !== Infinity) { const v = this.distOf(col + 1, row + 1); if (v <= d) { best = v; dx = DIAG; dy = DIAG; } }
    if (w !== Infinity && s !== Infinity) { const v = this.distOf(col - 1, row + 1); if (v < best && v <= d) { best = v; dx = -DIAG; dy = DIAG; } }
    if (e !== Infinity && n !== Infinity) { const v = this.distOf(col + 1, row - 1); if (v < best && v <= d) { best = v; dx = DIAG; dy = -DIAG; } }
    if (w !== Infinity && n !== Infinity) { const v = this.distOf(col - 1, row - 1); if (v < best && v <= d) { best = v; dx = -DIAG; dy = -DIAG; } }
    this.dir[i * 2] = dx;
    this.dir[i * 2 + 1] = dy;
  }

  private reached(i: number): boolean {
    return this.stamp[i] === this.generation && this.generation !== 0;
  }

  /**
   * Writes the unit steering direction for the cell under a world position
   * into `out`. Returns false (leaving `out` untouched) outside the grid, the
   * last built window, or the reachable flood. At the goal cell `out` = (0,0).
   */
  steer(worldX: number, worldY: number, out: { x: number; y: number }): boolean {
    const col = Math.floor(worldX / this.tileSize);
    const row = Math.floor(worldY / this.tileSize);
    if (col < this.winMinCol || col > this.winMaxCol || row < this.winMinRow || row > this.winMaxRow) return false;
    const i = row * this.cols + col;
    if (!this.reached(i)) return false;
    if (i === this.goalIndex) {
      out.x = 0;
      out.y = 0;
      return true;
    }
    const dx = this.dir[i * 2]!;
    const dy = this.dir[i * 2 + 1]!;
    if (dx === 0 && dy === 0) return false;
    out.x = dx;
    out.y = dy;
    return true;
  }

  /** BFS steps from a cell to the last goal, or -1 when outside the flood. */
  distanceAt(col: number, row: number): number {
    if (col < this.winMinCol || col > this.winMaxCol || row < this.winMinRow || row > this.winMaxRow) return UNREACHABLE;
    const i = row * this.cols + col;
    return this.reached(i) ? this.dist[i]! : UNREACHABLE;
  }

  pathExists(fromCol: number, fromRow: number): boolean {
    return this.distanceAt(fromCol, fromRow) !== UNREACHABLE;
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
