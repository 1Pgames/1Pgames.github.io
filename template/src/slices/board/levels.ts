import type { LevelSpec } from '../../core/level';
import type { BoardSpec, Cell, PieceKind } from '../../core/board/types';
import { BOARD_KINDS, BOARD_TUNING } from './tuning';

/**
 * The board slice's level ladder — twelve "orders" of placeholder flavour a
 * scaffolded game rethemes. Each entry is a
 * `LevelSpec` for `LevelDirector`, the order name the customer pinned to the
 * shelf, the seed that deals its starting board, and the board size, ingredient
 * set and blocker layout the shelf came with, so order 7 is the same puzzle for
 * every player and a retry replays it exactly.
 *
 * Goal ids ARE piece kind ids (see `tuning.ts`) — the resolver reports cleared
 * cells by kind, so a "collect 24 leaf" order needs no extra plumbing.
 *
 * ── HOW THIS LADDER IS BUILT ─────────────────────────────────────────────────
 *
 * Round 1 shipped a ladder whose every blocker level had a TWELVE move budget.
 * It tested as solvable because the sim's greedy solver reads the whole board;
 * it played as a wall, and a player who could not pass order 4 was right to
 * stop. The rebuild follows the genre's actual economics (Royal Match, which is
 * the most-measured example of this exact loop):
 *
 *  - MOVES ARE NEVER THE DIFFICULTY. The budget buys enough turns to execute a
 *    plan: 30-38 on the teaching band, 26-32 in the middle, 24-28 at the top
 *    and 22+ even in the finale. A level is hard because of what is IN THE WAY,
 *    never because the player ran out of turns before they could start.
 *  - ONE NEW IDEA PER DEBUT, AND THE DEBUT IS EASY. Order 4 is the first jar
 *    and contains nothing but jars, four of them, one hit point each, on a
 *    small board with a fat budget. Order 7 is the first vine and likewise
 *    contains nothing but vines. The player meets each obstacle alone before
 *    they ever meet it in company.
 *  - THE BOARD IS A DIAL. 6x7 for the first two orders (short columns, four
 *    kinds, so matches are everywhere), 7x7 for the small ones, 7x8 through the
 *    middle and 8x8 for the last two. A smaller board has fewer legal swaps and
 *    denser blockers per cell; a bigger one has longer cascades. Both are
 *    difficulty, and neither
 *    costs the player a single move.
 *  - THE INGREDIENT COUNT IS A DIAL TOO. Orders 1-2 deal FOUR kinds, not five:
 *    the teaching band should feel like the board wants to be matched. From
 *    order 3 on it is all five.
 *  - GOALS ARE SIZED FOR THE NEAR MISS. A lost run should end a few bottles
 *    short, not half an order short — that is the difference between "one more
 *    go" and "this is rigged". The sim gate measures exactly that (median
 *    shortfall on a loss, as a fraction of the order).
 *
 * ── THE ATTEMPT TIERS ────────────────────────────────────────────────────────
 *
 *  - Orders 1-3, TUTORIAL: won on the first attempt by anyone who understands
 *    swapping. There is nothing here to lose to.
 *  - Orders 4-7, NORMAL (~1.2 attempts): one obstacle idea each, generous
 *    budget, goals that need most of it. A reading player clears these; a
 *    careless one loses one now and then and immediately sees why.
 *  - Orders 8-11, HARD (~1.6 attempts), with order 10 a deliberate BREATHER
 *    back down to normal — an unbroken climb reads as a paywall, and the dip
 *    is what makes 11 feel like a step up rather than more of the same.
 *  - Order 12, SUPER-HARD (~2.5 attempts): every obstacle at its worst density
 *    on the biggest board. This is the order the shop exists for, and it still
 *    hands out 24 moves.
 *
 * The in-level boosters (`ladle`, `broom`, `pestle`, `whisk`) cost no move at
 * all, so they answer the specific board that went wrong without paying for it
 * out of the budget. The ladder is authored as if the player owns none of them.
 *
 * Star bands stay at the `LevelDirector` default (any win = 1, 20% of the move
 * budget left = 2, 45% = 3), so 3-starring the top end is a real ask.
 */
export interface BoardLevel {
  spec: LevelSpec;
  /**
   * The order name on the shelf tag ("Widow Maple's Tonic"). Player-facing
   * flavor for the level, distinct from `spec.id` (save key) and from the saga
   * node's ordinal.
   */
  label: string;
  /** Seeds the starting deal; the run seed is mixed in for daily variety. */
  seed: string;
  /**
   * Ingredients this order deals, defaulting to all of `BOARD_KINDS`.
   *
   * A subset is the cheapest difficulty dial in the genre and the one the
   * teaching band needs: four kinds instead of five raises the chance that any
   * given swap matches something by about a third, so orders 1-2 feel like the
   * board is helping. Every goal id MUST be in here — `boardSpecFor` throws
   * otherwise, because an order for an ingredient the board never deals is
   * unwinnable and would only be discovered by a player.
   */
  kinds?: readonly PieceKind[];
  /**
   * Blocker layout as a PICTURE, one string per board row, exactly the level's
   * own `spec.board` dimensions (defaulting to `BOARD_TUNING.cols/rows`):
   *
   *  - `'#'` a 1-hp jar, `'='` a 2-hp jar,
   *  - `'v'` a vine on whatever the deal puts in that cell,
   *  - `'.'` (or any other glyph) nothing.
   *
   * A picture rather than a coordinate list because the shape IS the design —
   * a wall, a ring, a diagonal and a scatter of four jars all read instantly
   * here and are invisible as `{col, row}` pairs. Parsed by `boardSpecFor`,
   * which throws on wrong dimensions so a typo cannot ship as a silently
   * empty level.
   */
  blockers?: readonly string[];
}

/** Orders 1-2 deal four ingredients; the fifth kind joins from order 3. */
const FOUR_KINDS: readonly PieceKind[] = ['ember', 'leaf', 'spark', 'tide'];

export const BOARD_LEVELS: readonly BoardLevel[] = [
  {
    // Nothing but the swap, on the smallest board with the smallest ingredient
    // set. 32 moves against an order the swap alone finishes in about ten: the
    // budget is visible on purpose, so the player learns the counter exists
    // before it ever matters.
    spec: {
      id: 'w-01',
      goals: [{ id: 'ember', target: 36 }],
      moves: 32,
      board: { cols: 6, rows: 7 },
    },
    label: "Widow Maple's Tonic",
    seed: 'brew-01',
    kinds: FOUR_KINDS,
  },
  {
    // Two goals, so the goal HUD starts meaning something: the player has to
    // notice which chip is still short instead of matching whatever is nearest.
    spec: {
      id: 'w-02',
      goals: [
        { id: 'leaf', target: 36 },
        { id: 'tide', target: 28 },
      ],
      moves: 32,
      board: { cols: 6, rows: 7 },
    },
    label: 'Thistle Sprig Cordial',
    seed: 'brew-02',
    kinds: FOUR_KINDS,
  },
  {
    // Fifth ingredient AND a wider board: the same two-goal shape as order 2,
    // now diluted. This is the last order with nothing in the way, so it is
    // the one that has to make the fifth colour feel like the change.
    spec: {
      id: 'w-03',
      goals: [
        { id: 'spark', target: 34 },
        { id: 'bloom', target: 26 },
      ],
      moves: 34,
      board: { cols: 7, rows: 7 },
    },
    label: 'Moonwisp Phial',
    seed: 'brew-03',
  },
  {
    // JAR DEBUT. Four 1-hp jars, spread wide, nothing else on the board. Any
    // clear that touches a jar breaks it, so the lesson lands on the first
    // accidental match and costs the player nothing. The budget is the same
    // 30 the band uses everywhere — the new idea is never also a squeeze.
    spec: {
      id: 'w-04',
      goals: [
        { id: 'ember', target: 36 },
        { id: 'leaf', target: 34 },
      ],
      moves: 30,
      board: { cols: 7, rows: 7 },
    },
    label: 'Emberleaf Simmer',
    seed: 'brew-04',
    blockers: [
      '.......',
      '.......',
      '..#.#..',
      '.......',
      '..#.#..',
      '.......',
      '.......',
    ],
  },
  {
    // Six jars in two bands on a taller board: the field is now cut into three
    // horizontal strips, so the long vertical clears order 3 taught stop
    // paying and the player has to work inside a strip.
    spec: {
      id: 'w-05',
      goals: [
        { id: 'leaf', target: 42 },
        { id: 'tide', target: 38 },
      ],
      moves: 30,
      board: { cols: 7, rows: 8 },
    },
    label: 'Honeydrop Salve',
    seed: 'brew-05',
    blockers: [
      '.......',
      '.......',
      '.#.#.#.',
      '.......',
      '.......',
      '.#.#.#.',
      '.......',
      '.......',
    ],
  },
  {
    // First 2-hp jars. Two separate beats each, so a jar stops being something
    // that happens to you and becomes something you come back to — the first
    // order that cannot be won by only ever taking the best move.
    spec: {
      id: 'w-06',
      goals: [
        { id: 'ember', target: 38 },
        { id: 'spark', target: 34 },
      ],
      moves: 30,
      board: { cols: 7, rows: 8 },
    },
    label: 'Corked Sunrise Brew',
    seed: 'brew-06',
    blockers: [
      '.......',
      '.......',
      '..=.=..',
      '.......',
      '.#...#.',
      '.......',
      '...=...',
      '...#...',
    ],
  },
  {
    // VINE DEBUT. Five vines and not one jar: the opposite lesson to the jar,
    // and it needs its own board to land. A vined piece still matches as its
    // own colour but cannot be picked up, so it is a tool that turned into
    // terrain — and freeing it costs a clear, not a move.
    spec: {
      id: 'w-07',
      goals: [
        { id: 'spark', target: 42 },
        { id: 'bloom', target: 40 },
      ],
      moves: 30,
      board: { cols: 7, rows: 8 },
    },
    label: 'Threefold Hex Vial',
    seed: 'brew-07',
    blockers: [
      '.......',
      '.......',
      '...v...',
      '..v.v..',
      '...v...',
      '.......',
      '...v...',
      '.......',
    ],
  },
  {
    // First MIX, and the first three-goal order: four jars and four vines, with
    // the vines above the jars so the piece that would open the jar is the one
    // that is rooted. Everything on this board has already been taught alone.
    spec: {
      id: 'w-08',
      goals: [
        { id: 'ember', target: 40 },
        { id: 'leaf', target: 38 },
        { id: 'tide', target: 38 },
      ],
      moves: 28,
      board: { cols: 7, rows: 8 },
    },
    label: "The Cauldron Keeper's Order",
    seed: 'brew-08',
    blockers: [
      '.......',
      '..v.v..',
      '.#...#.',
      '.......',
      '...#...',
      '.......',
      '..v.v..',
      '...#...',
    ],
  },
  {
    // Same mix, escalated the way the genre escalates: not more blockers but
    // TOUGHER ones — four of the six jars now take two hits, and the fifth vine
    // pair straddles the middle row, where the swap that reaches a cracked jar
    // wants to be.
    spec: {
      id: 'w-09',
      goals: [
        { id: 'leaf', target: 38 },
        { id: 'spark', target: 36 },
        { id: 'bloom', target: 36 },
      ],
      moves: 28,
      board: { cols: 7, rows: 8 },
    },
    label: 'Midnight Bloom Draught',
    seed: 'brew-09',
    blockers: [
      '...v...',
      '..=.=..',
      '.......',
      '.v.#.v.',
      '.......',
      '..=.=..',
      '...#...',
      '..v.v..',
    ],
  },
  {
    // BREATHER, and it is load-bearing. An unbroken climb from 8 to 12 reads as
    // a wall being built in front of the player; one order that hands back a
    // small board, two goals and a ring of 1-hp jars is what makes order 11
    // feel like a step up instead of more of the same.
    spec: {
      id: 'w-10',
      goals: [
        { id: 'ember', target: 34 },
        { id: 'tide', target: 30 },
      ],
      moves: 28,
      board: { cols: 7, rows: 7 },
    },
    label: "Grandmother Hex's Standing Order",
    seed: 'brew-10',
    blockers: [
      '.......',
      '.......',
      '.#...#.',
      '..v.v..',
      '.#...#.',
      '.......',
      '.......',
    ],
  },
  {
    // The big board arrives with the dense layout: eight jars, five of them
    // 2-hp, in two staggered rows, plus six vines in three ranks. 8x8 gives
    // longer cascades than 7x8 did, which is the point — the extra room is
    // what makes a board this cluttered playable at 26 moves.
    spec: {
      id: 'w-11',
      goals: [
        { id: 'ember', target: 36 },
        { id: 'spark', target: 36 },
        { id: 'tide', target: 36 },
      ],
      moves: 26,
      board: { cols: 8, rows: 8 },
    },
    label: "The Apothecary's Audit",
    seed: 'brew-11',
    blockers: [
      '........',
      '..v..v..',
      '.=....=.',
      '...###..',
      '..v..v..',
      '.=....=.',
      '...=....',
      '..v..v..',
    ],
  },
  {
    // FINALE: ten jars (six of them 2-hp) and seven vines on the full 8x8, in a
    // lattice with a 2-hp pair plugging the middle. Every idea on the ladder at
    // its worst density — and still 26 moves, because a super-hard level should
    // lose to the layout, never to the clock.
    //
    // The only FOUR-chip order on the ladder, and it is here for a reason
    // beyond flavour: an order that wants four of the five ingredients makes
    // almost every clear count, which is what keeps a level this hard losing by
    // a few bottles instead of by half an order. Being one chip short of a
    // finished board is the loss that gets retried.
    spec: {
      id: 'w-12',
      goals: [
        { id: 'ember', target: 37 },
        { id: 'leaf', target: 37 },
        { id: 'spark', target: 37 },
        { id: 'bloom', target: 37 },
      ],
      moves: 26,
      board: { cols: 8, rows: 8 },
    },
    label: 'Last Call at the Witchbrew',
    seed: 'brew-12',
    blockers: [
      '...vv...',
      '.=....=.',
      '..#..#..',
      '.v.==.v.',
      '..#..#..',
      '.=....=.',
      '...vv...',
      '...v....',
    ],
  },
];

/**
 * The `BoardSpec` a level is played on: that level's dimensions, ingredient set
 * and parsed blocker picture.
 *
 * Every `new Board(...)` for the board slice goes through here — the scene, the
 * sim and any future replay tool. A level's size, colours and obstacles are all
 * part of the puzzle's identity, so a construction site that skipped any of
 * them would be playing a different level than the one the ladder was tuned on.
 */
export function boardSpecFor(level: BoardLevel): BoardSpec {
  const { cols, rows } = level.spec.board ?? { cols: BOARD_TUNING.cols, rows: BOARD_TUNING.rows };
  const kinds = level.kinds ?? BOARD_KINDS;
  for (const goal of level.spec.goals) {
    if (!kinds.includes(goal.id)) {
      throw new Error(`${level.spec.id}: goal '${goal.id}' is not among the level's kinds`);
    }
  }

  const picture = level.blockers;
  if (picture === undefined) return { cols, rows, kinds };
  if (picture.length !== rows) {
    throw new Error(`${level.spec.id}: blocker picture has ${picture.length} rows, expected ${rows}`);
  }

  const jars: { cell: Cell; hp: 1 | 2 }[] = [];
  const vines: Cell[] = [];
  for (let row = 0; row < rows; row += 1) {
    const line = picture[row] as string;
    if (line.length !== cols) {
      throw new Error(`${level.spec.id}: blocker row ${row} is ${line.length} wide, expected ${cols}`);
    }
    for (let col = 0; col < cols; col += 1) {
      const glyph = line[col];
      if (glyph === '#') jars.push({ cell: { col, row }, hp: 1 });
      else if (glyph === '=') jars.push({ cell: { col, row }, hp: 2 });
      else if (glyph === 'v') vines.push({ col, row });
    }
  }
  return { cols, rows, kinds, jars, vines };
}

/** Namespaced `core/storage` key holding the next unplayed level index. */
export const BOARD_PROGRESS_KEY = 'board:level';

/**
 * Index of the level actually being played, written the moment a level starts.
 *
 * `GameOverScene` hands RETRY nothing but the run seed, so without this the
 * retry of a WON level would re-read `BOARD_PROGRESS_KEY` — which the win just
 * advanced — and silently start the next level instead of replaying the one the
 * player asked for.
 */
export const BOARD_LAST_LEVEL_KEY = 'board:last';

/** Clamps any stored/derived index into the ladder. */
export function clampBoardLevel(index: number): number {
  return Math.max(0, Math.min(BOARD_LEVELS.length - 1, Math.floor(index)));
}
