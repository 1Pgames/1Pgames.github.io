// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/board.selftest.ts
import assert from 'node:assert/strict';
import { Rng } from '../../core/rng';
import { Board } from '../../core/board/grid';
import {
  applyGravity,
  clearCells,
  detonationCells,
  findRuns,
  findValidMoves,
  groupAt,
  hasDeadBoard,
  refillBoard,
  reshuffle,
  resolveCascades,
  swapProducesMatch,
} from '../../core/board/resolve';
import { MergeGenerator, mergeAll, mergeValue, tryMerge } from '../../core/board/merge';
import { SortPuzzle, dealSortPuzzle, solveSort } from '../../core/board/sort';
import { BLOCK_PIECES, BlockGrid, drawPieceBag } from '../../core/board/block';
import type { BlockPiece } from '../../core/board/block';

const KINDS = ['a', 'b', 'c', 'd', 'e'];
const GLYPHS: Record<string, string> = { a: 'a', b: 'b', c: 'c', d: 'd', e: 'e' };
const KIND_OF: Record<string, string> = { a: 'a', b: 'b', c: 'c', d: 'd', e: 'e' };

const piece = (board: Board, col: number, row: number): string | null => board.kindAt({ col, row });

// --- seeded fill: exact dimensions, every playable cell filled, and no free match ---
{
  for (const seed of ['fill-1', 'fill-2', 'fill-3', 'level-9', 'x']) {
    const board = new Board({ cols: 9, rows: 9, kinds: KINDS }, new Rng(seed));
    assert.equal(board.cols, 9);
    assert.equal(board.rows, 9);
    assert.equal(board.playableCount, 81, 'no holes -> every cell playable');
    assert.equal(board.filledCount, 81, `seed ${seed}: fill must leave no gaps`);
    assert.deepEqual(findRuns(board), [], `seed ${seed}: a fresh board must not resolve itself`);
    assert.ok(findValidMoves(board).length > 0, `seed ${seed}: a fresh board must be playable`);
  }

  // Same seed, same board — the replay guarantee the results screen promises.
  const first = new Board({ cols: 9, rows: 9, kinds: KINDS }, new Rng('replay'));
  const second = new Board({ cols: 9, rows: 9, kinds: KINDS }, new Rng('replay'));
  assert.deepEqual(second.toRows(GLYPHS), first.toRows(GLYPHS), 'one seed must replay one board');

  // Holes are never filled and never move.
  const holed = new Board(
    { cols: 5, rows: 5, kinds: KINDS, blocked: [{ col: 2, row: 2 }, { col: 0, row: 4 }] },
    new Rng('holes'),
  );
  assert.equal(holed.playableCount, 23);
  assert.equal(holed.filledCount, 23);
  assert.equal(holed.get({ col: 2, row: 2 }), null, 'a hole holds no piece');
  assert.equal(holed.isBlocked({ col: 2, row: 2 }), true);
}

// --- Board.fromRows: the picture is authoritative (the fixture the rest relies on) ---
{
  const board = Board.fromRows(['ab.', 'cde', 'aaa'], KIND_OF);
  assert.equal(board.cols, 3);
  assert.equal(board.rows, 3);
  assert.equal(board.isBlocked({ col: 2, row: 0 }), true);
  assert.equal(piece(board, 0, 2), 'a');
  assert.equal(board.filledCount, 8);
}

// --- swap detection: a known one-move match, and a known dud ---
{
  //   0 1 2 3
  // 0 a a b b
  // 1 c d a e
  // 2 e c d c
  const board = Board.fromRows(['aabb', 'cdae', 'ecdc'], KIND_OF);
  assert.deepEqual(findRuns(board), [], 'fixture must start unresolved');

  // Swapping (2,0)=b with (2,1)=a completes the horizontal run a a a at row 0.
  assert.equal(swapProducesMatch(board, { col: 2, row: 0 }, { col: 2, row: 1 }), true);
  assert.equal(piece(board, 2, 0), 'b', 'swapProducesMatch must not mutate the board');
  assert.equal(piece(board, 2, 1), 'a');

  assert.equal(swapProducesMatch(board, { col: 0, row: 0 }, { col: 1, row: 0 }), false, 'a a -> a a is a dud');

  board.swap({ col: 2, row: 0 }, { col: 2, row: 1 });
  const matches = findRuns(board, { col: 2, row: 0 });
  assert.equal(matches.length, 1, 'exactly one group');
  const match = matches[0]!;
  assert.equal(match.kind, 'a');
  assert.equal(match.cells.length, 3);
  assert.equal(match.special ?? null, null, 'a run of 3 earns nothing');
}

// --- special creation: 4-run -> line piece on the axis, L/T and 5-run -> bomb ---
{
  const four = Board.fromRows(['aaaa', 'bcbc', 'cbcb'], KIND_OF);
  const [horizontal] = findRuns(four, { col: 1, row: 0 });
  assert.equal(horizontal?.special, 'line-h', 'a horizontal 4-run earns a row clearer');
  assert.deepEqual(horizontal?.specialAt, { col: 1, row: 0 }, 'the special lands on the cell the player moved');

  const fourDown = Board.fromRows(['abc', 'abc', 'abd', 'aed'], KIND_OF);
  const [vertical] = findRuns(fourDown);
  assert.equal(vertical?.special, 'line-v', 'a vertical 4-run earns a column clearer');

  const five = Board.fromRows(['aaaaa', 'bcbcb', 'cbcbc'], KIND_OF);
  assert.equal(findRuns(five)[0]?.special, 'bomb', 'a 5-run earns a bomb');

  // T shape: row 0 is a a a, column 1 is a a a — one merged group of 5.
  const tee = Board.fromRows(['aaa', 'bab', 'cac'], KIND_OF);
  const [merged] = findRuns(tee);
  assert.equal(merged?.cells.length, 5, 'the two runs merge into ONE group, not two');
  assert.equal(merged?.special, 'bomb', 'an L/T earns a bomb');
  assert.deepEqual(merged?.specialAt, { col: 1, row: 0 }, 'the bomb lands on the corner where the runs cross');
}

// --- detonation: line clears its row/column, bomb clears its 3x3, chains through specials ---
{
  const board = Board.fromRows(['abcde', 'abcde', 'abcde'], KIND_OF);
  assert.equal(detonationCells(board, { col: 2, row: 1 }, 'line-h').length, 5, 'a row of 5');
  assert.equal(detonationCells(board, { col: 2, row: 1 }, 'line-v').length, 3, 'a column of 3');
  assert.equal(detonationCells(board, { col: 2, row: 1 }, 'bomb').length, 9, 'a full 3x3');
  assert.equal(detonationCells(board, { col: 0, row: 0 }, 'bomb').length, 4, 'a corner bomb is clipped');

  const holed = Board.fromRows(['abcde', 'ab.de', 'abcde'], KIND_OF);
  assert.equal(detonationCells(holed, { col: 2, row: 1 }, 'line-h').length, 4, 'a hole is not a clearable cell');

  const rowBlast = Board.fromRows(['abcde', 'abcde', 'abcde'], KIND_OF);
  rowBlast.set({ col: 2, row: 1 }, { kind: 'c', special: 'line-h' });
  const cleared = clearCells(rowBlast, [{ col: 2, row: 1 }]);
  assert.equal(cleared.length, 5, 'the line piece takes its whole row');
  assert.equal(rowBlast.filledCount, 10, '15 - 5 cells left standing');

  // Chain: a bomb caught in a line blast detonates too.
  const chain = Board.fromRows(['abcde', 'abcde', 'abcde'], KIND_OF);
  chain.set({ col: 0, row: 1 }, { kind: 'a', special: 'line-h' });
  chain.set({ col: 3, row: 1 }, { kind: 'd', special: 'bomb' });
  const chained = clearCells(chain, [{ col: 0, row: 1 }]);
  const keys = new Set(chained.map((entry) => `${entry.cell.col},${entry.cell.row}`));
  assert.equal(keys.size, chained.length, 'no cell is reported twice');
  for (const cell of ['2,0', '3,0', '4,0', '2,2', '3,2', '4,2']) {
    assert.ok(keys.has(cell), `the chained bomb must also clear ${cell}`);
  }
  assert.equal(chained.length, 5 + 6, 'row of 5 plus the bomb 3x3 minus the 3 shared row cells');
}

// --- gravity + refill: pieces fall, holes are floors, the board returns to full ---
{
  const board = Board.fromRows(['aaa', 'bbb', 'ccc'], KIND_OF);
  clearCells(board, [{ col: 1, row: 2 }]);
  const falls = applyGravity(board);
  assert.equal(falls.length, 2, 'the two pieces above the gap each fall one row');
  assert.equal(piece(board, 1, 2), 'b');
  assert.equal(piece(board, 1, 1), 'a');
  assert.equal(board.get({ col: 1, row: 0 }), null, 'the gap is now at the top');

  const holed = Board.fromRows(['aaa', 'b.b', 'ccc'], KIND_OF);
  clearCells(holed, [{ col: 1, row: 2 }]);
  applyGravity(holed);
  assert.equal(holed.get({ col: 1, row: 2 }), null, 'nothing falls through a hole');
  assert.equal(piece(holed, 1, 0), 'a', 'the piece above the hole stays put');

  const refills = refillBoard(holed, new Rng('refill'));
  assert.equal(refills.length, 1, 'only the emptied cell is refilled');
  assert.equal(holed.filledCount, holed.playableCount, 'the board is full again');
}

// --- cascades: terminate, conserve the fill, and score every cleared cell once ---
{
  for (const seed of ['casc-1', 'casc-2', 'casc-3', 'casc-4', 'casc-5']) {
    const rng = new Rng(seed);
    const board = new Board({ cols: 9, rows: 9, kinds: KINDS }, new Rng(seed));
    const move = findValidMoves(board)[0]!;
    board.swap(move.a, move.b);
    const steps = resolveCascades(board, rng, { origin: move.b });

    assert.ok(steps.length >= 1, `${seed}: an accepted swap must resolve at least one step`);
    assert.ok(steps.length <= 20, `${seed}: the cascade cap must hold`);
    assert.equal(board.filledCount, 81, `${seed}: the board must be full at rest`);
    assert.deepEqual(findRuns(board), [], `${seed}: no match may survive a settled cascade`);

    for (const step of steps) {
      const created = new Set(step.created.map((entry) => `${entry.cell.col},${entry.cell.row}`));
      for (const entry of step.cleared) {
        assert.ok(
          !created.has(`${entry.cell.col},${entry.cell.row}`),
          `${seed}: a created special must survive the match that made it`,
        );
      }
      // Fill conservation per step: cleared cells are exactly the refilled ones.
      assert.equal(step.cleared.length, step.refills.length, `${seed}: every cleared cell is refilled`);
    }
  }

  // A special created by a cascade really is on the board as a special piece.
  const fixture = Board.fromRows(['aaaab', 'cbcbc', 'bcbcb', 'cbcbc'], KIND_OF);
  const steps = resolveCascades(fixture, new Rng('special'), { origin: { col: 2, row: 0 } });
  assert.equal(steps[0]?.created.length, 1, 'the 4-run creates exactly one special');
  assert.equal(steps[0]?.created[0]?.special, 'line-h');
  assert.deepEqual(steps[0]?.created[0]?.cell, { col: 2, row: 0 }, 'and it lands on the origin cell');
}

// --- tap/blast mode: only the tapped group resolves, and groups are connected ---
{
  const board = Board.fromRows(['aab', 'abb', 'ccc'], KIND_OF);
  const group = groupAt(board, { col: 0, row: 0 }, 2);
  assert.equal(group.length, 3, 'the connected a-group is (0,0) (1,0) (0,1)');
  assert.equal(groupAt(board, { col: 2, row: 0 }, 2).length, 3, 'the b-group is (2,0) (1,1) (2,1)');

  const tapped = Board.fromRows(['aab', 'abb', 'ccc'], KIND_OF);
  const tapSteps = resolveCascades(tapped, new Rng('tap'), { mode: 'tap', detonate: group });
  assert.equal(tapSteps.length, 1, 'tap mode resolves the tapped group and stops');
  assert.equal(tapSteps[0]?.cleared.length, 3);
  assert.equal(tapped.filledCount, tapped.playableCount, 'refill tops the board back up');
}

// --- dead board: detected, and a seeded reshuffle makes it playable again ---
{
  // Diagonal 3-colour stripes: every row and column cycles a-b-c, so no
  // adjacent swap can ever line three up.
  const stuck = Board.fromRows(['abcab', 'bcabc', 'cabca', 'abcab', 'bcabc'], KIND_OF);
  assert.deepEqual(findRuns(stuck), [], 'the dead fixture hands out no free match');
  assert.equal(findValidMoves(stuck).length, 0, 'and no swap on it produces one');
  assert.equal(hasDeadBoard(stuck), true);

  const rng = new Rng('shuffle');
  assert.equal(reshuffle(stuck, rng), true, 'reshuffle must produce a playable board');
  assert.equal(hasDeadBoard(stuck), false, 'and it must not be dead any more');
  assert.deepEqual(findRuns(stuck), [], 'nor may it hand the player free matches');
  assert.equal(stuck.filledCount, stuck.playableCount, 'reshuffle preserves the piece count');

  // A swap that moves a special is always legal, dead board or not.
  const withSpecial = Board.fromRows(['abcab', 'bcabc', 'cabca', 'abcab', 'bcabc'], KIND_OF);
  withSpecial.set({ col: 2, row: 2 }, { kind: 'b', special: 'bomb' });
  assert.ok(findValidMoves(withSpecial).length > 0, 'a special is itself a move');
}

// --- merge chain: only identical kinds merge, the ladder tops out, values double ---
{
  const chain = { kinds: ['seed', 'sprout', 'tree', 'grove'] };
  assert.equal(tryMerge(chain, 'seed', 'seed'), 'sprout');
  assert.equal(tryMerge(chain, 'sprout', 'sprout'), 'tree');
  assert.equal(tryMerge(chain, 'seed', 'sprout'), null, 'different rungs never merge');
  assert.equal(tryMerge(chain, 'grove', 'grove'), null, 'the top rung is the end of the ladder');
  assert.equal(tryMerge(chain, 'rock', 'rock'), null, 'off-ladder kinds never merge');

  assert.equal(mergeValue(chain, 'seed'), 1);
  assert.equal(mergeValue(chain, 'grove'), 8, 'each rung doubles');
  assert.equal(mergeValue(chain, 'rock'), 0);

  // Eight seeds must fold all the way to one grove — the ladder's whole point.
  const folded = mergeAll(chain, ['seed', 'seed', 'seed', 'seed', 'seed', 'seed', 'seed', 'seed']);
  assert.deepEqual(folded.items, ['grove']);
  assert.equal(folded.merges, 4 + 2 + 1);
  const partial = mergeAll(chain, ['seed', 'seed', 'seed', 'rock']);
  assert.deepEqual(partial.items, ['rock', 'seed', 'sprout'], 'the odd seed stays, the rock is untouched');

  const generator = new MergeGenerator(chain, new Rng('gen'), { charges: 2, rechargeMs: 1000 });
  assert.equal(generator.tap(), 'seed');
  assert.equal(generator.tap(), 'seed');
  assert.equal(generator.tap(), null, 'an empty generator yields nothing');
  generator.update(600);
  assert.equal(generator.charges, 0);
  assert.ok(Math.abs(generator.rechargeRatio - 0.6) < 1e-9, 'the radial UI value tracks the recharge');
  generator.update(400);
  assert.equal(generator.charges, 1, 'a full recharge window grants exactly one charge');
  assert.equal(generator.tap(), 'seed');
  generator.update(5000);
  assert.equal(generator.charges, 2, 'charges cap at the spec');
  assert.equal(generator.rechargeRatio, 1);
}

// --- sort model: pour rules, solved detection, and a solvable constructed puzzle ---
{
  const puzzle = new SortPuzzle({ capacity: 4, tubes: [['r', 'g', 'r', 'r'], ['g', 'r', 'g', 'g'], []] });
  assert.equal(puzzle.isSolved, false);
  assert.equal(puzzle.runOnTop(0), 2, 'two reds sit on top of tube 0');
  assert.equal(puzzle.pourAmount(0, 1), 0, 'red onto green is illegal');
  assert.equal(puzzle.pourAmount(0, 2), 2, 'the whole top run pours into the empty tube');
  assert.equal(puzzle.pourAmount(0, 0), 0, 'a tube cannot pour into itself');

  const full = new SortPuzzle({ capacity: 2, tubes: [['r', 'r'], ['g'], ['g']] });
  assert.equal(full.pourAmount(1, 0), 0, 'a full tube takes nothing');
  assert.equal(full.pourAmount(1, 2), 1, 'green onto green is legal');
  const uniform = new SortPuzzle({ capacity: 3, tubes: [['r', 'r'], []] });
  assert.equal(uniform.pourAmount(0, 1), 0, 'pouring a uniform tube into an empty one is a no-op move');

  const solvedState = new SortPuzzle({ capacity: 3, tubes: [['r', 'r', 'r'], ['g', 'g'], []] });
  assert.equal(solvedState.isSolved, true, 'uniform tubes, no split colour');
  const split = new SortPuzzle({ capacity: 3, tubes: [['r', 'r'], ['r'], []] });
  assert.equal(split.isSolved, false, 'one colour in two tubes is not solved');

  const solution = solveSort(puzzle);
  assert.ok(solution !== null, 'the constructed puzzle must be solvable');
  const replay = puzzle.clone();
  for (const pour of solution) {
    assert.ok(replay.pour(pour.from, pour.to) > 0, 'every pour in the solution must be legal');
  }
  assert.equal(replay.isSolved, true, 'replaying the solution must solve the puzzle');

  const dealt = dealSortPuzzle(['r', 'g', 'b'], 4, 2, new Rng('deal'));
  assert.equal(dealt.tubes.length, 5, '3 coloured tubes + 2 spares');
  assert.equal(dealt.isSolved, false, 'a dealt puzzle starts unsolved');
  assert.ok(solveSort(dealt) !== null, 'a dealt puzzle must be provably solvable');
  assert.ok(dealt.validPours().length > 0);
}

// --- block model: placement, simultaneous line clears, and the fit test ---
{
  const grid = new BlockGrid();
  assert.equal(grid.cols, 8);
  assert.equal(grid.rows, 8);
  const square = BLOCK_PIECES.find((p) => p.id === 'square') as BlockPiece;
  const line4 = BLOCK_PIECES.find((p) => p.id === 'line-h4') as BlockPiece;

  assert.equal(grid.place(square, { col: 0, row: 0 }), true);
  assert.equal(grid.occupancy, 4);
  assert.equal(grid.canPlace(square, { col: 1, row: 0 }), false, 'pieces may not overlap');
  assert.equal(grid.canPlace(line4, { col: 5, row: 7 }), false, 'a piece may not hang off the edge');
  assert.equal(grid.place(square, { col: 1, row: 0 }), false, 'a rejected placement changes nothing');
  assert.equal(grid.occupancy, 4);
  assert.equal(grid.clearFullLines(), 0, 'nothing is full yet');

  // Fill row 3 except one cell, then complete it with a single-cell piece.
  const rowGrid = new BlockGrid();
  for (let col = 0; col < 7; col += 1) rowGrid.setFilled({ col, row: 3 });
  assert.equal(rowGrid.clearFullLines(), 0);
  rowGrid.setFilled({ col: 7, row: 3 });
  assert.equal(rowGrid.clearFullLines(), 1, 'one full row clears');
  assert.equal(rowGrid.occupancy, 0);

  // A full row AND a full column crossing it clear together, counted as 2.
  const crossGrid = new BlockGrid();
  for (let col = 0; col < 8; col += 1) crossGrid.setFilled({ col, row: 2 });
  for (let row = 0; row < 8; row += 1) crossGrid.setFilled({ col: 5, row });
  assert.equal(crossGrid.occupancy, 8 + 8 - 1, 'the crossing cell is filled once');
  assert.equal(crossGrid.clearFullLines(), 2, 'a row and a column is two lines');
  assert.equal(crossGrid.occupancy, 0, 'the shared cell is cleared, not double-counted into a leftover');

  // anyFits: a board with only single gaps rejects a 4-line but accepts a dot.
  const tight = new BlockGrid(4, 4);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) tight.setFilled({ col, row });
  }
  tight.setFilled({ col: 1, row: 1 }, false);
  const dot = BLOCK_PIECES.find((p) => p.id === 'dot') as BlockPiece;
  assert.equal(tight.anyFits([line4, square]), false, 'nothing big fits a single gap');
  assert.equal(tight.anyFits([dot]), true, 'a single cell still fits');
  assert.deepEqual(tight.firstFit(dot), { col: 1, row: 1 });
  assert.equal(tight.placements(dot).length, 1);

  const bag = drawPieceBag(new Rng('bag'), 3);
  assert.equal(bag.length, 3);
  const sameBag = drawPieceBag(new Rng('bag'), 3);
  assert.deepEqual(
    sameBag.map((p) => p.id),
    bag.map((p) => p.id),
    'the piece bag is seeded, not random',
  );
  const clone = crossGrid.clone();
  clone.setFilled({ col: 0, row: 0 });
  assert.equal(crossGrid.occupancy, 0, 'a clone must not share storage');
}

console.log('board.selftest: ok');
