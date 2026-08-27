import type { Board } from './grid';
import type {
  CascadeStep,
  Cell,
  ClearedCell,
  FallEvent,
  MatchEvent,
  PieceKind,
  RefillEvent,
  SpecialKind,
  Swap,
} from './types';
import { cellKey } from './types';
import type { Rng } from '../rng';

/**
 * The board resolver: match detection, special creation and detonation,
 * gravity, refill and the cascade loop that ties them together.
 *
 * Everything is a pure function over a `Board` plus a seeded `Rng`, and every
 * mutation is reported as a `CascadeStep` the renderer replays as tweens. The
 * scene therefore never re-derives game state from sprites, and the headless
 * sim can resolve a whole level without Phaser.
 */

/** Longest run that still only earns a line piece; 5+ earns a bomb. */
const LINE_RUN = 4;
const BOMB_RUN = 5;
/** Cascade safety valve: a pathological refill can never hang the frame. */
const MAX_CASCADE_STEPS = 20;

export type BoardMode =
  /** Match runs of 3+ after a swap (match-3). */
  | 'swap'
  /** Auto-clear every connected group of `minGroup`+ (collapse puzzles). */
  | 'blast'
  /** Only the caller's seed cells resolve; the rest is gravity + refill (tap-blast). */
  | 'tap';

export interface ResolveOptions {
  mode?: BoardMode;
  /** The cell the player touched — created specials land here when possible. */
  origin?: Cell;
  /** Cells to clear before matching starts: a tapped group or a swapped special. */
  detonate?: readonly Cell[];
  /** Minimum connected-group size in `blast`/`tap` mode. */
  minGroup?: number;
  maxSteps?: number;
}

interface RawRun {
  cells: Cell[];
  kind: PieceKind;
  horizontal: boolean;
}

/** Horizontal and vertical runs of 3+, before any merging. */
function collectRuns(board: Board): RawRun[] {
  const runs: RawRun[] = [];
  for (let row = 0; row < board.rows; row += 1) {
    let col = 0;
    while (col < board.cols) {
      const kind = board.kindAt({ col, row });
      if (kind === null) {
        col += 1;
        continue;
      }
      let end = col + 1;
      while (end < board.cols && board.kindAt({ col: end, row }) === kind) end += 1;
      if (end - col >= 3) {
        const cells: Cell[] = [];
        for (let c = col; c < end; c += 1) cells.push({ col: c, row });
        runs.push({ cells, kind, horizontal: true });
      }
      col = end;
    }
  }
  for (let col = 0; col < board.cols; col += 1) {
    let row = 0;
    while (row < board.rows) {
      const kind = board.kindAt({ col, row });
      if (kind === null) {
        row += 1;
        continue;
      }
      let end = row + 1;
      while (end < board.rows && board.kindAt({ col, row: end }) === kind) end += 1;
      if (end - row >= 3) {
        const cells: Cell[] = [];
        for (let r = row; r < end; r += 1) cells.push({ col, row: r });
        runs.push({ cells, kind, horizontal: false });
      }
      row = end;
    }
  }
  return runs;
}

/**
 * Merged match groups: runs sharing a cell (an L, T or plus) become one group,
 * which is what decides whether the match earns a line piece or a bomb.
 *
 * `origin` biases where a created special lands — the cell the player actually
 * moved, which is the only placement that reads as caused by the player.
 */
export function findRuns(board: Board, origin?: Cell): MatchEvent[] {
  const runs = collectRuns(board);
  if (runs.length === 0) return [];

  // Union runs that share a cell (same kind by construction).
  const parent = runs.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root] as number;
    let walk = index;
    while (parent[walk] !== root) {
      const next = parent[walk] as number;
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  const owner = new Map<number, number>();
  for (let i = 0; i < runs.length; i += 1) {
    for (const cell of (runs[i] as RawRun).cells) {
      const key = cellKey(cell);
      const seen = owner.get(key);
      if (seen === undefined) owner.set(key, i);
      else {
        const a = find(seen);
        const b = find(i);
        if (a !== b) parent[b] = a;
      }
    }
  }

  const groups = new Map<number, RawRun[]>();
  for (let i = 0; i < runs.length; i += 1) {
    const root = find(i);
    const bucket = groups.get(root);
    if (bucket === undefined) groups.set(root, [runs[i] as RawRun]);
    else bucket.push(runs[i] as RawRun);
  }

  const originKey = origin === undefined ? -1 : cellKey(origin);
  const matches: MatchEvent[] = [];
  for (const bucket of groups.values()) {
    const cells: Cell[] = [];
    const seen = new Set<number>();
    let runH = 0;
    let runV = 0;
    const horizontalKeys = new Set<number>();
    const verticalKeys = new Set<number>();
    for (const run of bucket) {
      if (run.horizontal) runH = Math.max(runH, run.cells.length);
      else runV = Math.max(runV, run.cells.length);
      for (const cell of run.cells) {
        const key = cellKey(cell);
        (run.horizontal ? horizontalKeys : verticalKeys).add(key);
        if (seen.has(key)) continue;
        seen.add(key);
        cells.push(cell);
      }
    }

    const longest = Math.max(runH, runV);
    let special: SpecialKind | null = null;
    if (runH >= 3 && runV >= 3) special = 'bomb';
    else if (longest >= BOMB_RUN) special = 'bomb';
    else if (longest === LINE_RUN) special = runH === LINE_RUN ? 'line-h' : 'line-v';

    let specialAt: Cell | undefined;
    if (special !== null) {
      specialAt = cells.find((cell) => cellKey(cell) === originKey);
      if (specialAt === undefined && runH >= 3 && runV >= 3) {
        // The corner of an L/T is where both runs meet; the read is clearest there.
        specialAt = cells.find((cell) => {
          const key = cellKey(cell);
          return horizontalKeys.has(key) && verticalKeys.has(key);
        });
      }
      if (specialAt === undefined) {
        const longestRun = bucket.reduce((best, run) => (run.cells.length > best.cells.length ? run : best));
        specialAt = longestRun.cells[Math.floor(longestRun.cells.length / 2)];
      }
    }

    matches.push({ cells, kind: (bucket[0] as RawRun).kind, special, specialAt, runH, runV });
  }
  return matches;
}

/** Connected same-kind group containing `cell` (blast/tap mode). */
export function groupAt(board: Board, cell: Cell, minSize = 2): Cell[] {
  const kind = board.kindAt(cell);
  if (kind === null) return [];
  const group: Cell[] = [];
  const seen = new Set<number>([cellKey(cell)]);
  const queue: Cell[] = [{ col: cell.col, row: cell.row }];
  while (queue.length > 0) {
    const current = queue.pop() as Cell;
    group.push(current);
    const neighbours: Cell[] = [
      { col: current.col + 1, row: current.row },
      { col: current.col - 1, row: current.row },
      { col: current.col, row: current.row + 1 },
      { col: current.col, row: current.row - 1 },
    ];
    for (const next of neighbours) {
      const key = cellKey(next);
      if (seen.has(key)) continue;
      if (board.kindAt(next) !== kind) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return group.length >= minSize ? group : [];
}

/** Every connected group of `minSize`+ on the board (blast mode cascade). */
export function findGroups(board: Board, minSize = 2): MatchEvent[] {
  const claimed = new Set<number>();
  const matches: MatchEvent[] = [];
  board.forEachCell((cell, piece) => {
    if (piece === null || claimed.has(cellKey(cell))) return;
    const group = groupAt(board, cell, minSize);
    if (group.length === 0) {
      claimed.add(cellKey(cell));
      return;
    }
    for (const member of group) claimed.add(cellKey(member));
    const special: SpecialKind | null =
      group.length >= 7 ? 'bomb' : group.length >= LINE_RUN + 1 ? 'line-h' : null;
    matches.push({
      cells: group,
      kind: piece.kind,
      special,
      specialAt: special === null ? undefined : group[0],
      runH: 0,
      runV: 0,
    });
  });
  return matches;
}

/** The cells a special takes with it: full row, full column or a 3x3 block. */
export function detonationCells(board: Board, at: Cell, special: SpecialKind): Cell[] {
  const cells: Cell[] = [];
  if (special === 'line-h') {
    for (let col = 0; col < board.cols; col += 1) {
      const cell = { col, row: at.row };
      if (!board.isBlocked(cell)) cells.push(cell);
    }
  } else if (special === 'line-v') {
    for (let row = 0; row < board.rows; row += 1) {
      const cell = { col: at.col, row };
      if (!board.isBlocked(cell)) cells.push(cell);
    }
  } else {
    for (let row = at.row - 1; row <= at.row + 1; row += 1) {
      for (let col = at.col - 1; col <= at.col + 1; col += 1) {
        const cell = { col, row };
        if (!board.isBlocked(cell)) cells.push(cell);
      }
    }
  }
  return cells;
}

/**
 * Empties `seeds`, chaining through any special caught in the blast, and
 * returns what was destroyed (the goal counters read this). Cells in
 * `protect` survive — that is how a freshly created special is not eaten by
 * the very match that produced it.
 */
export function clearCells(
  board: Board,
  seeds: readonly Cell[],
  protect?: ReadonlySet<number>,
): ClearedCell[] {
  const cleared: ClearedCell[] = [];
  const done = new Set<number>();
  const queue: Cell[] = seeds.map((cell) => ({ col: cell.col, row: cell.row }));
  while (queue.length > 0) {
    const cell = queue.pop() as Cell;
    const key = cellKey(cell);
    if (done.has(key) || protect?.has(key) === true) continue;
    done.add(key);
    const piece = board.get(cell);
    if (piece === null) continue;
    board.set(cell, null);
    const special = piece.special ?? null;
    cleared.push({ cell, kind: piece.kind, special });
    if (special !== null) {
      for (const next of detonationCells(board, cell, special)) queue.push(next);
    }
  }
  return cleared;
}

/** Slides every piece down its column into the gap below it. Holes are floors. */
export function applyGravity(board: Board): FallEvent[] {
  const falls: FallEvent[] = [];
  for (let col = 0; col < board.cols; col += 1) {
    let write = board.rows - 1;
    for (let row = board.rows - 1; row >= 0; row -= 1) {
      const cell = { col, row };
      if (board.isBlocked(cell)) {
        write = row - 1;
        continue;
      }
      const piece = board.get(cell);
      if (piece === null) continue;
      if (write !== row) {
        board.set({ col, row: write }, piece);
        board.set(cell, null);
        falls.push({ from: cell, to: { col, row: write } });
      }
      write -= 1;
    }
  }
  return falls;
}

/**
 * Spawns new pieces into every empty cell. A column split by holes refills
 * each segment from that segment's own top, so a board with holes still
 * returns to full after a cascade.
 */
export function refillBoard(board: Board, rng: Rng): RefillEvent[] {
  const refills: RefillEvent[] = [];
  for (let col = 0; col < board.cols; col += 1) {
    for (let row = 0; row < board.rows; row += 1) {
      const cell = { col, row };
      if (board.isBlocked(cell) || board.get(cell) !== null) continue;
      const piece = { kind: rng.pick(board.kinds), special: null };
      board.set(cell, piece);
      refills.push({ cell, piece });
    }
  }
  return refills;
}

/**
 * Runs the board to rest: match -> create specials -> clear (chaining
 * detonations) -> gravity -> refill, repeated until nothing matches or the
 * step cap is hit. The returned steps are the animation script.
 */
export function resolveCascades(board: Board, rng: Rng, options: ResolveOptions = {}): CascadeStep[] {
  const mode = options.mode ?? 'swap';
  const minGroup = options.minGroup ?? 2;
  const maxSteps = options.maxSteps ?? MAX_CASCADE_STEPS;
  const steps: CascadeStep[] = [];

  let seeds: readonly Cell[] | null = options.detonate ?? null;
  let origin = options.origin;

  for (let step = 0; step < maxSteps; step += 1) {
    let matches: readonly MatchEvent[] = [];
    const created: { cell: Cell; kind: PieceKind; special: SpecialKind }[] = [];
    const protect = new Set<number>();
    let clearSeeds: readonly Cell[];

    if (seeds !== null) {
      clearSeeds = seeds;
      seeds = null;
      if (clearSeeds.length === 0) break;
    } else {
      if (mode === 'tap') break;
      matches = mode === 'blast' ? findGroups(board, minGroup) : findRuns(board, origin);
      if (matches.length === 0) break;
      const collected: Cell[] = [];
      for (const match of matches) {
        const at = match.specialAt;
        if (match.special !== null && match.special !== undefined && at !== undefined && !protect.has(cellKey(at))) {
          protect.add(cellKey(at));
          created.push({ cell: at, kind: match.kind, special: match.special });
        }
        for (const cell of match.cells) collected.push(cell);
      }
      clearSeeds = collected;
    }

    const cleared = clearCells(board, clearSeeds, protect);
    if (cleared.length === 0 && created.length === 0) break;
    for (const spawn of created) board.set(spawn.cell, { kind: spawn.kind, special: spawn.special });

    const falls = applyGravity(board);
    const refills = refillBoard(board, rng);
    steps.push({ matches, cleared, created, falls, refills });
    origin = undefined;
  }
  return steps;
}

/**
 * True when the two cells hold a run of 3+ around themselves right now —
 * called with the swap already applied, so it answers "was that swap legal".
 * A swap that moves a special is always legal: detonating is the point.
 */
export function isResolvedSwap(board: Board, a: Cell, b: Cell): boolean {
  for (const cell of [a, b]) {
    const piece = board.get(cell);
    if (piece === null) return false;
    if ((piece.special ?? null) !== null) return true;
    if (board.runThrough(cell, piece.kind, 1, 0) >= 3) return true;
    if (board.runThrough(cell, piece.kind, 0, 1) >= 3) return true;
  }
  return false;
}

/** Does swapping these two adjacent cells produce a match? Board unchanged. */
export function swapProducesMatch(board: Board, a: Cell, b: Cell): boolean {
  if (board.isBlocked(a) || board.isBlocked(b)) return false;
  if (board.get(a) === null || board.get(b) === null) return false;
  board.swap(a, b);
  const ok = isResolvedSwap(board, a, b);
  board.swap(a, b);
  return ok;
}

/**
 * Every legal swap on the board. Feeds the shuffle check, the hint button and
 * the sim's solver; each pair is listed once (right and down neighbours only).
 */
export function findValidMoves(board: Board): Swap[] {
  const moves: Swap[] = [];
  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) {
      const a = { col, row };
      if (board.get(a) === null) continue;
      for (const b of [
        { col: col + 1, row },
        { col, row: row + 1 },
      ]) {
        if (swapProducesMatch(board, a, b)) moves.push({ a, b });
      }
    }
  }
  return moves;
}

export function hasDeadBoard(board: Board): boolean {
  return findValidMoves(board).length === 0;
}

/**
 * Re-deals the pieces already on the board (so the piece mix the player earned
 * is preserved) until the result has no free matches and at least one legal
 * move. Falls back to a fresh seeded fill. Returns false only if even that
 * cannot produce a playable board.
 */
export function reshuffle(board: Board, rng: Rng, attempts = 32): boolean {
  const kinds: PieceKind[] = [];
  const cells: Cell[] = [];
  board.forEachCell((cell, piece) => {
    if (piece === null) return;
    kinds.push(piece.kind);
    cells.push({ col: cell.col, row: cell.row });
  });
  if (cells.length === 0) return false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    rng.shuffle(kinds);
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i] as Cell;
      const existing = board.get(cell);
      board.set(cell, { kind: kinds[i] as PieceKind, special: existing?.special ?? null });
    }
    if (findRuns(board).length === 0 && findValidMoves(board).length > 0) return true;
  }
  board.fill(rng);
  return findValidMoves(board).length > 0;
}
