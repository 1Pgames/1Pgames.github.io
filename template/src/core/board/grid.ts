import type { Blocker, BoardSpec, Cell, Piece, PieceKind } from './types';
import { JAR_KIND, isJar, isMovable } from './types';
import { Rng } from '../rng';

/**
 * The board itself: a flat row-major array of pieces with permanent holes.
 *
 * Pure TypeScript with an injected `Rng`, so the same seed always produces the
 * same starting board in the browser, in the sim and in the selftest. Row 0 is
 * the TOP row; gravity moves pieces toward increasing `row`.
 *
 * BLOCKERS live in the cells, not beside them (see `types.ts`): a jar IS the
 * piece at its cell (kind `JAR_KIND`), a vine is a flag on an ordinary piece.
 * Keeping them in the one array is what makes every existing traversal —
 * gravity, refill, reshuffle, clone — a single pass that cannot desync a
 * parallel blocker map from the pieces it decorates.
 */
export class Board {
  readonly cols: number;
  readonly rows: number;
  readonly kinds: readonly PieceKind[];

  private readonly cellsArr: (Piece | null)[];
  private readonly blockedArr: boolean[];
  /**
   * The narrowed kind list refills draw from, or `null` for "the level's own
   * kinds". Set by the mercy rule (`board/mercy.ts`) once the move budget runs
   * low, and by nothing else.
   */
  private refillPool: PieceKind[] | null = null;

  constructor(spec: BoardSpec, rng: Rng) {
    if (spec.cols < 1 || spec.rows < 1) throw new Error('Board: cols/rows must be >= 1');
    if (spec.kinds.length < 3) throw new Error('Board: needs at least 3 kinds for match-3');
    if (spec.kinds.includes(JAR_KIND)) throw new Error('Board: JAR_KIND is reserved and never drawn');
    this.cols = spec.cols;
    this.rows = spec.rows;
    this.kinds = spec.kinds.slice();
    const size = spec.cols * spec.rows;
    this.cellsArr = new Array<Piece | null>(size).fill(null);
    this.blockedArr = new Array<boolean>(size).fill(false);
    for (const hole of spec.blocked ?? []) {
      if (this.inBounds(hole)) this.blockedArr[hole.row * this.cols + hole.col] = true;
    }
    // Jars go down BEFORE the fill so the fill sees them as run-breakers and
    // never has to be told to skip a cell it has already written.
    for (const jar of spec.jars ?? []) {
      if (!this.inBounds(jar.cell) || this.isBlocked(jar.cell)) continue;
      this.cellsArr[jar.cell.row * this.cols + jar.cell.col] = {
        kind: JAR_KIND,
        special: null,
        blocker: { kind: 'jar', hp: jar.hp },
      };
    }
    this.fill(rng);
    // Vines decorate whatever the fill dealt, so a vined level is still a
    // legal starting board: same pieces, same no-free-match guarantee.
    for (const cell of spec.vines ?? []) {
      const piece = this.get(cell);
      if (piece === null || isJar(piece)) continue;
      piece.blocker = { kind: 'vine', hp: 1 };
    }
  }

  /**
   * Builds a board from a literal picture. `'.'` marks a permanent hole,
   * `' '` an empty playable cell, `'#'` a 1-hp jar and `'='` a 2-hp jar; a
   * glyph in UPPER case is the lower-case kind wearing a vine. Used by levels
   * with fixed layouts and by the selftest to construct exact
   * match/detonation/blocker/dead-board situations.
   */
  static fromRows(rows: readonly string[], kindOf: Readonly<Record<string, PieceKind>>): Board {
    const height = rows.length;
    const width = rows[0]?.length ?? 0;
    if (height === 0 || width === 0) throw new Error('Board.fromRows: empty picture');
    const kinds = Array.from(new Set(Object.values(kindOf)));
    const blocked: Cell[] = [];
    for (let row = 0; row < height; row += 1) {
      const line = rows[row] ?? '';
      if (line.length !== width) throw new Error('Board.fromRows: ragged picture');
      for (let col = 0; col < width; col += 1) {
        if (line[col] === '.') blocked.push({ col, row });
      }
    }
    // The seeded fill is thrown away immediately; the picture is authoritative.
    const board = new Board({ cols: width, rows: height, kinds, blocked }, new Rng(1));
    for (let row = 0; row < height; row += 1) {
      const line = rows[row] ?? '';
      for (let col = 0; col < width; col += 1) {
        const glyph = line[col] ?? ' ';
        if (glyph === '.') continue;
        const cell = { col, row };
        if (glyph === '#' || glyph === '=') {
          board.set(cell, {
            kind: JAR_KIND,
            special: null,
            blocker: { kind: 'jar', hp: glyph === '#' ? 1 : 2 },
          });
          continue;
        }
        const kind = kindOf[glyph];
        if (kind !== undefined) {
          board.set(cell, { kind, special: null, blocker: null });
          continue;
        }
        const vined = kindOf[glyph.toLowerCase()];
        board.set(
          cell,
          vined === undefined ? null : { kind: vined, special: null, blocker: { kind: 'vine', hp: 1 } },
        );
      }
    }
    return board;
  }

  inBounds(cell: Cell): boolean {
    return cell.col >= 0 && cell.col < this.cols && cell.row >= 0 && cell.row < this.rows;
  }

  isBlocked(cell: Cell): boolean {
    return !this.inBounds(cell) || this.blockedArr[cell.row * this.cols + cell.col] === true;
  }

  /**
   * Narrows what REFILLS draw from, or clears the narrowing with `null` —
   * the mercy rule's only lever (`board/mercy.ts`).
   *
   * Refills only, deliberately: `fill` seeds and reshuffles from the level's
   * full `kinds` either way, because a whole board dealt from four kinds is a
   * different level rather than a merciful one. Kinds the level does not draw
   * (and `JAR_KIND`, which nothing ever draws) are dropped, and an empty
   * result clears the pool instead of leaving a board that cannot refill.
   */
  setRefillPool(kinds: readonly PieceKind[] | null): void {
    if (kinds === null) {
      this.refillPool = null;
      return;
    }
    const pool = kinds.filter((kind) => kind !== JAR_KIND && this.kinds.includes(kind));
    this.refillPool = pool.length === 0 ? null : pool;
  }

  /** What a refill draws from right now: the mercy pool if one is set, else `kinds`. */
  get refillKinds(): readonly PieceKind[] {
    return this.refillPool ?? this.kinds;
  }

  /** `null` for an empty or blocked cell. */
  get(cell: Cell): Piece | null {
    if (!this.inBounds(cell)) return null;
    return this.cellsArr[cell.row * this.cols + cell.col] ?? null;
  }

  set(cell: Cell, piece: Piece | null): void {
    if (!this.inBounds(cell) || this.isBlocked(cell)) return;
    this.cellsArr[cell.row * this.cols + cell.col] = piece;
  }

  kindAt(cell: Cell): PieceKind | null {
    return this.get(cell)?.kind ?? null;
  }

  /**
   * The kind this cell offers to MATCHING, which is `kindAt` for every piece
   * a player can line up and `null` for a jar. A jar's `JAR_KIND` is only
   * ever a rendering/goal token: three jars in a row must not read as a
   * match, and no run may be traced through one.
   */
  matchKindAt(cell: Cell): PieceKind | null {
    const piece = this.get(cell);
    if (piece === null || piece.kind === JAR_KIND) return null;
    return piece.kind;
  }

  /**
   * Exchanges two cells' pieces. Refuses when either endpoint is a hole, a
   * jar or a vined piece — the one gate that keeps immovable furniture
   * immovable for the input layer, the move solver and the bots alike.
   * Returns whether the exchange happened.
   */
  swap(a: Cell, b: Cell): boolean {
    if (this.isBlocked(a) || this.isBlocked(b)) return false;
    const ai = a.row * this.cols + a.col;
    const bi = b.row * this.cols + b.col;
    if (!isMovable(this.cellsArr[ai] ?? null) || !isMovable(this.cellsArr[bi] ?? null)) return false;
    const tmp = this.cellsArr[ai] ?? null;
    this.cellsArr[ai] = this.cellsArr[bi] ?? null;
    this.cellsArr[bi] = tmp;
    return true;
  }

  /** Every playable cell, top-left to bottom-right. */
  forEachCell(visit: (cell: Cell, piece: Piece | null) => void): void {
    const cell = { col: 0, row: 0 };
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        if (this.blockedArr[row * this.cols + col] === true) continue;
        cell.col = col;
        cell.row = row;
        visit(cell, this.cellsArr[row * this.cols + col] ?? null);
      }
    }
  }

  /** Playable cells that currently hold a piece. */
  get filledCount(): number {
    let n = 0;
    for (const piece of this.cellsArr) if (piece !== null) n += 1;
    return n;
  }

  /** Playable (non-blocked) cell count — the target `filledCount` at rest. */
  get playableCount(): number {
    let n = 0;
    for (const blocked of this.blockedArr) if (!blocked) n += 1;
    return n;
  }

  /** Playable cells holding a live blocker — the "obstacles left" HUD number. */
  get blockerCount(): number {
    let n = 0;
    for (const piece of this.cellsArr) if ((piece?.blocker ?? null) !== null) n += 1;
    return n;
  }

  /**
   * Seeds every playable cell, rerolling any kind that would complete a run of
   * three with the two cells already written to its left or above — so a fresh
   * board never resolves before the player's first move.
   *
   * Jars are furniture: the fill leaves them exactly where they are, which is
   * also what makes the reshuffle fallback safe (it re-deals PIECES, and must
   * never resurrect a jar the player already broke). A vine survives its
   * cell's re-deal — the plant is what is stuck, not the ingredient under it.
   */
  fill(rng: Rng): void {
    const probe = { col: 0, row: 0 };
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        const index = row * this.cols + col;
        if (this.blockedArr[index] === true) {
          this.cellsArr[index] = null;
          continue;
        }
        const existing = this.cellsArr[index] ?? null;
        if (isJar(existing)) continue;
        const candidates = rng.shuffle(this.kinds.slice());
        let chosen = candidates[0] as PieceKind;
        for (const kind of candidates) {
          probe.col = col;
          probe.row = row;
          if (!this.completesTriple(probe, kind)) {
            chosen = kind;
            break;
          }
        }
        const blocker = existing?.blocker ?? null;
        this.cellsArr[index] = {
          kind: chosen,
          special: null,
          blocker: blocker === null ? null : { ...blocker },
        };
      }
    }
  }

  /**
   * True when placing `kind` at `cell` would give it two same-kind neighbours
   * in a row on either axis (the fill-time and reshuffle-time match guard).
   */
  completesTriple(cell: Cell, kind: PieceKind): boolean {
    return this.runThrough(cell, kind, 1, 0) >= 3 || this.runThrough(cell, kind, 0, 1) >= 3;
  }

  /**
   * Length of the same-kind run through `cell` along one axis, counting `cell`
   * itself as holding `kind`. Blocked, empty and jar cells break the run.
   */
  runThrough(cell: Cell, kind: PieceKind, dCol: number, dRow: number): number {
    let length = 1;
    for (const sign of [-1, 1]) {
      let col = cell.col + dCol * sign;
      let row = cell.row + dRow * sign;
      while (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
        const piece = this.cellsArr[row * this.cols + col] ?? null;
        if (piece === null || piece.kind !== kind || piece.kind === JAR_KIND) break;
        length += 1;
        col += dCol * sign;
        row += dRow * sign;
      }
    }
    return length;
  }

  /**
   * Independent copy, holes and blockers included — used by move search and
   * the solver. `Blocker` is a nested object, so it is copied too: a shallow
   * piece spread would let a probe's damage bleed into the real board.
   *
   * The mercy pool comes along: a solver that probes the endgame has to see
   * the refill distribution the endgame actually has.
   */
  clone(): Board {
    const blocked: Cell[] = [];
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        if (this.blockedArr[row * this.cols + col] === true) blocked.push({ col, row });
      }
    }
    const copy = new Board({ cols: this.cols, rows: this.rows, kinds: this.kinds, blocked }, new Rng(1));
    for (let i = 0; i < this.cellsArr.length; i += 1) {
      const piece = this.cellsArr[i] ?? null;
      if (piece === null) {
        copy.cellsArr[i] = null;
        continue;
      }
      const blocker: Blocker | null = piece.blocker ?? null;
      copy.cellsArr[i] = { ...piece, blocker: blocker === null ? null : { ...blocker } };
    }
    copy.refillPool = this.refillPool === null ? null : this.refillPool.slice();
    return copy;
  }

  /**
   * Debug/selftest picture, the inverse of `fromRows`: `.` for holes, `_` for
   * empty, `#`/`=` for a 1/2-hp jar and an UPPER-CASE glyph for a vined piece.
   */
  toRows(glyphOf: Readonly<Record<PieceKind, string>>): string[] {
    const out: string[] = [];
    for (let row = 0; row < this.rows; row += 1) {
      let line = '';
      for (let col = 0; col < this.cols; col += 1) {
        const index = row * this.cols + col;
        if (this.blockedArr[index] === true) {
          line += '.';
          continue;
        }
        const piece = this.cellsArr[index] ?? null;
        if (piece === null) {
          line += '_';
          continue;
        }
        const blocker = piece.blocker ?? null;
        if (blocker !== null && blocker.kind === 'jar') {
          line += blocker.hp >= 2 ? '=' : '#';
          continue;
        }
        const glyph = glyphOf[piece.kind] ?? '?';
        line += blocker === null ? glyph : glyph.toUpperCase();
      }
      out.push(line);
    }
    return out;
  }
}
