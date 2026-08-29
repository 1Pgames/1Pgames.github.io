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
import { applyInLevelBooster } from '../../core/board/boosters';
import { JAR_KIND, isVined } from '../../core/board/types';
import { mercyPool } from '../../core/board/mercy';
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
  const { cleared } = clearCells(rowBlast, [{ col: 2, row: 1 }]);
  assert.equal(cleared.length, 5, 'the line piece takes its whole row');
  assert.equal(rowBlast.filledCount, 10, '15 - 5 cells left standing');

  // Chain: a bomb caught in a line blast detonates too.
  const chain = Board.fromRows(['abcde', 'abcde', 'abcde'], KIND_OF);
  chain.set({ col: 0, row: 1 }, { kind: 'a', special: 'line-h' });
  chain.set({ col: 3, row: 1 }, { kind: 'd', special: 'bomb' });
  const { cleared: chained } = clearCells(chain, [{ col: 0, row: 1 }]);
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

// --- jars: furniture with hit points, never matchable, never movable, a floor ---
{
  // Picture glyphs: '#' a 1-hp jar, '=' a 2-hp jar, UPPER case a vined piece.
  const jarred = Board.fromRows(['ab#', 'cde', 'aaa'], KIND_OF);
  const jar = jarred.get({ col: 2, row: 0 });
  assert.equal(jar?.kind, JAR_KIND, 'a jar IS the piece at its cell');
  assert.deepEqual(jar?.blocker, { kind: 'jar', hp: 1 });
  assert.equal(jarred.matchKindAt({ col: 2, row: 0 }), null, 'a jar offers nothing to match');
  assert.equal(jarred.kindAt({ col: 2, row: 0 }), JAR_KIND, 'but it is still a piece for rendering');
  assert.deepEqual(jarred.toRows(GLYPHS), ['ab#', 'cde', 'aaa'], 'toRows round-trips a jar');

  // Three jars in a line must not read as a match.
  const wall = Board.fromRows(['###', 'abc', 'bca'], KIND_OF);
  assert.deepEqual(findRuns(wall), [], 'a row of jars is a wall, not a match-3');

  // A jar is never a swap endpoint, and the swap itself refuses.
  const swapGuard = Board.fromRows(['ab#', 'cda', 'eca'], KIND_OF);
  assert.equal(swapProducesMatch(swapGuard, { col: 1, row: 0 }, { col: 2, row: 0 }), false);
  assert.equal(swapGuard.swap({ col: 1, row: 0 }, { col: 2, row: 0 }), false, 'board.swap refuses a jar');
  assert.equal(swapGuard.kindAt({ col: 2, row: 0 }), JAR_KIND, 'and nothing moved');
  for (const move of findValidMoves(swapGuard)) {
    for (const cell of [move.a, move.b]) {
      assert.notEqual(swapGuard.kindAt(cell), JAR_KIND, 'no enumerated move touches a jar');
    }
  }

  // Adjacent clear -> one point of damage; hp 2 needs two separate beats.
  const tough = Board.fromRows(['a=a', 'bab', 'cac'], KIND_OF);
  const firstHit = clearCells(tough, [{ col: 1, row: 1 }]);
  assert.deepEqual(
    firstHit.hits,
    [{ cell: { col: 1, row: 0 }, kind: 'jar', broken: false }],
    'a 2-hp jar only cracks',
  );
  assert.deepEqual(tough.get({ col: 1, row: 0 })?.blocker, { kind: 'jar', hp: 1 });
  assert.equal(firstHit.cleared.length, 1, 'the jar is not in cleared while it lives');
  const secondHit = clearCells(tough, [{ col: 0, row: 0 }]);
  assert.deepEqual(secondHit.hits, [{ cell: { col: 1, row: 0 }, kind: 'jar', broken: true }]);
  assert.equal(tough.get({ col: 1, row: 0 }), null, 'a broken jar empties its cell');
  assert.ok(
    secondHit.cleared.some((entry) => entry.kind === JAR_KIND),
    'and reports itself as cleared under JAR_KIND so a goal can count it',
  );

  // ONE point of damage per pass, however many neighbours clear at once.
  const capped = Board.fromRows(['a=a', 'aaa', 'cbc'], KIND_OF);
  const fat = clearCells(capped, [
    { col: 0, row: 1 },
    { col: 1, row: 1 },
    { col: 2, row: 1 },
  ]);
  assert.equal(fat.hits.length, 1, 'three adjacent clears are still one crack');
  assert.deepEqual(capped.get({ col: 1, row: 0 })?.blocker, { kind: 'jar', hp: 1 });

  // A jar is a floor: nothing falls through it, and it never falls itself.
  // 2 hp, because the clear right under it also cracks it.
  const column = Board.fromRows(['a', 'b', '=', 'c'], KIND_OF);
  clearCells(column, [{ col: 0, row: 3 }]);
  applyGravity(column);
  assert.deepEqual(column.toRows(GLYPHS), ['a', 'b', '#', '_'], 'the jar holds its row and its column');
  const refilled = refillBoard(column, new Rng('jar-refill'));
  assert.equal(refilled.length, 1, 'only the cell under the jar refills');
  assert.equal(column.kindAt({ col: 0, row: 2 }), JAR_KIND, 'the jar is not refilled over');
}

// --- vines: a normal piece, rooted, that absorbs the first clear aimed at it ---
{
  const vined = Board.fromRows(['Aaa', 'bcb', 'cbc'], KIND_OF);
  const piece = vined.get({ col: 0, row: 0 });
  assert.equal(piece?.kind, 'a', 'a vined piece keeps its own kind');
  assert.deepEqual(piece?.blocker, { kind: 'vine', hp: 1 });
  assert.deepEqual(vined.toRows(GLYPHS), ['Aaa', 'bcb', 'cbc'], 'toRows round-trips a vine');

  // It MATCHES as its kind — the run of three is real.
  const runs = findRuns(vined);
  assert.equal(runs.length, 1, 'the vined cell is part of the run');
  assert.equal(runs[0]?.cells.length, 3);

  // ...but the vine eats the clear: the piece survives, freed and uncounted.
  const outcome = clearCells(vined, runs[0]!.cells);
  assert.deepEqual(outcome.hits, [{ cell: { col: 0, row: 0 }, kind: 'vine', broken: true }]);
  assert.equal(outcome.cleared.length, 2, 'the vined cell is NOT counted toward the goals');
  for (const entry of outcome.cleared) {
    assert.notDeepEqual(entry.cell, { col: 0, row: 0 });
  }
  const freed = vined.get({ col: 0, row: 0 });
  assert.equal(freed?.kind, 'a', 'the freed ingredient is still there');
  assert.equal(freed?.blocker ?? null, null, 'and it is an ordinary piece now');

  // A vined piece is never a swap endpoint, but it is still matchable scenery.
  const rooted = Board.fromRows(['Abb', 'cab', 'eca'], KIND_OF);
  assert.equal(swapProducesMatch(rooted, { col: 0, row: 0 }, { col: 1, row: 0 }), false);
  assert.equal(rooted.swap({ col: 0, row: 0 }, { col: 1, row: 0 }), false, 'board.swap refuses a vine');

  // Anchored against gravity: the vine holds its row and the piece above it,
  // while the pieces below it compact as usual. The clear is two cells away so
  // the splash does not free the vine first.
  const hang = Board.fromRows(['a', 'B', 'c', 'd'], KIND_OF);
  clearCells(hang, [{ col: 0, row: 3 }]);
  applyGravity(hang);
  assert.deepEqual(hang.toRows(GLYPHS), ['a', 'B', '_', 'c'], 'a vine does not fall, nor is it fallen past');
  assert.equal(hang.get({ col: 0, row: 1 })?.blocker?.kind, 'vine');

  // An adjacent clear breaks it too, and a reshuffle leaves it exactly where it is.
  const splash = Board.fromRows(['Bcc', 'cbb', 'bcb'], KIND_OF);
  const hit = clearCells(splash, [{ col: 1, row: 0 }]);
  assert.deepEqual(hit.hits, [{ cell: { col: 0, row: 0 }, kind: 'vine', broken: true }]);
  assert.equal(hit.cleared.length, 1, 'only the neighbour cleared');
}

// --- blockers survive a reshuffle, a clone and the cascade loop ---
{
  const board = new Board(
    {
      cols: 6,
      rows: 6,
      kinds: KINDS,
      jars: [{ cell: { col: 2, row: 2 }, hp: 2 }, { cell: { col: 4, row: 1 }, hp: 1 }],
      vines: [{ col: 0, row: 3 }, { col: 5, row: 5 }],
    },
    new Rng('blockers'),
  );
  assert.equal(board.blockerCount, 4, 'two jars and two vines are on the board');
  assert.equal(board.get({ col: 2, row: 2 })?.kind, JAR_KIND);
  assert.equal(board.get({ col: 0, row: 3 })?.blocker?.kind, 'vine');
  assert.equal(board.filledCount, 36, 'a jar still occupies its cell');
  assert.deepEqual(findRuns(board), [], 'a blocker level still deals no free match');

  const probe = board.clone();
  probe.get({ col: 2, row: 2 })!.blocker!.hp = 1;
  assert.equal(board.get({ col: 2, row: 2 })?.blocker?.hp, 2, 'a clone must not share Blocker objects');

  assert.equal(reshuffle(board, new Rng('reshuffle-blockers')), true);
  assert.equal(board.get({ col: 2, row: 2 })?.kind, JAR_KIND, 'the jar did not move');
  assert.deepEqual(board.get({ col: 2, row: 2 })?.blocker, { kind: 'jar', hp: 2 }, 'nor did it take damage');
  assert.equal(board.get({ col: 0, row: 3 })?.blocker?.kind, 'vine', 'the vine stayed on its cell');
  assert.equal(board.blockerCount, 4, 'a reshuffle is not a free obstacle-removal button');

  // The cascade loop reports blockerHits and settles a blocker board to full.
  for (const seed of ['blk-1', 'blk-2', 'blk-3', 'blk-4']) {
    const live = new Board(
      {
        cols: 9,
        rows: 9,
        kinds: KINDS,
        jars: [{ cell: { col: 4, row: 4 }, hp: 2 }, { cell: { col: 1, row: 6 }, hp: 1 }],
        vines: [{ col: 7, row: 2 }, { col: 3, row: 7 }],
      },
      new Rng(seed),
    );
    const rng = new Rng(seed);
    for (let turn = 0; turn < 12; turn += 1) {
      const moves = findValidMoves(live);
      if (moves.length === 0) {
        reshuffle(live, rng);
        continue;
      }
      const move = moves[turn % moves.length]!;
      assert.equal(live.swap(move.a, move.b), true, `${seed}: an enumerated move must be legal`);
      const steps = resolveCascades(live, rng, { origin: move.b });
      for (const step of steps) {
        assert.ok(Array.isArray(step.blockerHits), `${seed}: every step carries blockerHits`);
        // Fill conservation with blockers: cleared cells minus the ones a jar
        // vacated below a floor are still exactly the refilled ones.
        assert.equal(step.cleared.length, step.refills.length, `${seed}: every cleared cell is refilled`);
      }
      assert.equal(live.filledCount, live.playableCount, `${seed}: the board is full at rest`);
      assert.deepEqual(findRuns(live), [], `${seed}: no match survives a settled cascade`);
    }
  }
}

// --- in-level boosters: free of the move budget, one cascade path, ladle beats hp ---
{
  // Ladle: scoops a 2-hp jar out in one hit, which nothing else can do.
  const jarred = Board.fromRows(['ab=de', 'cdeab', 'eabcd', 'bcdea'], KIND_OF);
  const ladled = applyInLevelBooster(jarred, { id: 'ladle', cell: { col: 2, row: 0 } }, new Rng('ladle'));
  assert.ok(ladled.length >= 1, 'the ladle resolves at least one beat');
  assert.deepEqual(
    ladled[0]?.blockerHits,
    [{ cell: { col: 2, row: 0 }, kind: 'jar', broken: true }],
    'a full jar goes in one scoop',
  );
  assert.ok(
    ladled[0]?.cleared.some((entry) => entry.kind === JAR_KIND),
    'and the jar is reported cleared',
  );
  assert.equal(jarred.filledCount, jarred.playableCount, 'the board refills behind it');

  // Ladle on a vined piece takes the piece AND the vine.
  const vined = Board.fromRows(['abCde', 'cdeab', 'eabcd', 'bcdea'], KIND_OF);
  const scooped = applyInLevelBooster(vined, { id: 'ladle', cell: { col: 2, row: 0 } }, new Rng('scoop'));
  assert.deepEqual(scooped[0]?.blockerHits, [{ cell: { col: 2, row: 0 }, kind: 'vine', broken: true }]);
  assert.ok(
    scooped[0]?.cleared.some((entry) => entry.cell.col === 2 && entry.cell.row === 0),
    'a forced clear does count for the goals',
  );

  // Broom: a line-h detonation, so jars in the row only take one point.
  const swept = Board.fromRows(['abcde', 'cd=ab', 'eabcd', 'bcdea'], KIND_OF);
  const steps = applyInLevelBooster(swept, { id: 'broom', row: 1 }, new Rng('broom'));
  const firstStep = steps[0]!;
  assert.equal(firstStep.cleared.filter((entry) => entry.cell.row === 1).length, 4, 'four pieces, not the jar');
  assert.deepEqual(
    firstStep.blockerHits,
    [{ cell: { col: 2, row: 1 }, kind: 'jar', broken: false }],
    'the broom only cracks a 2-hp jar',
  );
  assert.deepEqual(swept.get({ col: 2, row: 1 })?.blocker, { kind: 'jar', hp: 1 });
  assert.equal(swept.filledCount, swept.playableCount, 'and the row refills');

  // A no-op action reports nothing so the caller can refund the charge.
  const idle = Board.fromRows(['abc', 'cde', 'eab'], KIND_OF);
  assert.deepEqual(applyInLevelBooster(idle, { id: 'broom', row: 9 }, new Rng('oob')), []);
  idle.set({ col: 0, row: 0 }, null);
  assert.deepEqual(applyInLevelBooster(idle, { id: 'ladle', cell: { col: 0, row: 0 } }, new Rng('oob')), []);
}

// --- pestle: a line-v detonation on the tapped column ---
{
  const board = Board.fromRows(['abcde', 'cd=ab', 'eabcd', 'bcdea'], KIND_OF);
  const steps = applyInLevelBooster(board, { id: 'pestle', col: 2 }, new Rng('pestle'));
  const firstStep = steps[0]!;
  const inColumn = firstStep.cleared.filter((entry) => entry.cell.col === 2 && entry.kind !== JAR_KIND);
  assert.equal(inColumn.length, 3, 'three pieces of the column, not the 2-hp jar');
  assert.deepEqual(
    firstStep.blockerHits,
    [{ cell: { col: 2, row: 1 }, kind: 'jar', broken: false }],
    'the jar in the lane is only cracked, like any adjacent clear',
  );
  assert.deepEqual(board.get({ col: 2, row: 1 })?.blocker, { kind: 'jar', hp: 1 });
  assert.equal(board.filledCount, board.playableCount, 'and the column refills');

  const clean = Board.fromRows(['abcde', 'cdeab', 'eabcd', 'bcdea'], KIND_OF);
  const ground = applyInLevelBooster(clean, { id: 'pestle', col: 0 }, new Rng('grind'));
  assert.equal(ground[0]!.cleared.filter((entry) => entry.cell.col === 0).length, 4, 'a clean column goes whole');
  assert.deepEqual(applyInLevelBooster(clean, { id: 'pestle', col: 9 }, new Rng('oob')), [], 'oob = no-op');
  assert.deepEqual(applyInLevelBooster(clean, { id: 'pestle', col: -1 }, new Rng('oob')), [], 'oob = no-op');
}

// --- whisk: permutes FREE pieces only, keeps every invariant ---
{
  const rows = ['ab=de', 'cdCab', 'eabcd', 'bcd#a'];
  const board = Board.fromRows(rows, KIND_OF);
  const before = board.toRows(KIND_OF);
  const census = (subject: Board): Record<string, number> => {
    const out: Record<string, number> = {};
    subject.forEachCell((_cell, held) => {
      if (held === null) return;
      out[held.kind] = (out[held.kind] ?? 0) + 1;
    });
    return out;
  };
  const censusBefore = census(board);

  const steps = applyInLevelBooster(board, { id: 'whisk' }, new Rng('whisk'));
  const stir = steps[0]!;
  assert.ok(stir.falls.length > 0, 'the stir actually moves pieces');
  assert.deepEqual(stir.matches, [], 'the permutation step clears nothing');
  assert.deepEqual(stir.cleared, [], 'the permutation step clears nothing');
  assert.deepEqual(stir.refills, [], 'and spawns nothing');
  assert.deepEqual(stir.blockerHits, [], 'and dents nothing');

  // Piece census preserved exactly: a permutation, not a re-deal.
  assert.deepEqual(census(board), censusBefore, 'piece counts preserved');
  // Layout untouched: jars keep their cells and hp, vines keep their cells.
  assert.deepEqual(board.get({ col: 2, row: 0 })?.blocker, { kind: 'jar', hp: 2 }, '2-hp jar stays put');
  assert.deepEqual(board.get({ col: 3, row: 3 })?.blocker, { kind: 'jar', hp: 1 }, '1-hp jar stays put');
  assert.ok(isVined(board.get({ col: 2, row: 1 })), 'the vined cell is still vined');
  assert.equal(board.get({ col: 2, row: 1 })?.kind, 'c', 'and still holds its own ingredient');
  assert.equal(board.blockerCount, 3, 'three blockers before, three after');
  assert.equal(board.filledCount, board.playableCount, 'nothing lost, nothing spawned');

  // Every fall is a free -> free cell move (never onto furniture).
  for (const fall of stir.falls) {
    for (const cell of [fall.from, fall.to]) {
      const glyph = before[cell.row]![cell.col]!;
      assert.ok(glyph !== '#' && glyph !== '=' && glyph !== '.' && glyph === glyph.toLowerCase(), 'free cells only');
    }
  }
  assert.ok(findValidMoves(board).length > 0, 'the result is playable');

  // Determinism: same seed -> same permutation, byte for byte.
  const twin = Board.fromRows(rows, KIND_OF);
  const twinSteps = applyInLevelBooster(twin, { id: 'whisk' }, new Rng('whisk'));
  assert.deepEqual(twin.toRows(KIND_OF), board.toRows(KIND_OF), 'same seed, same board');
  assert.deepEqual(twinSteps[0]!.falls, stir.falls, 'same seed, same falls');
  const other = Board.fromRows(rows, KIND_OF);
  applyInLevelBooster(other, { id: 'whisk' }, new Rng('different'));
  assert.notDeepEqual(other.toRows(KIND_OF), board.toRows(KIND_OF), 'a different seed stirs differently');

  // Nothing to stir -> no-op, so the caller refunds instead of animating.
  const stuck = Board.fromRows(['#=', '=#'], KIND_OF);
  assert.deepEqual(applyInLevelBooster(stuck, { id: 'whisk' }, new Rng('none')), [], 'no free pieces = no-op');
}

// --- whisk: the "every attempt matched" fallback still behaves ---
{
  // 8 free cells holding 6 identical pieces: only a handful of the
  // arrangements dodge a run, so some seeds burn every attempt and accept a
  // match. Both outcomes have to stay legal, which is what this measures.
  const rows = ['aab', 'a#a', 'aca'];
  let fallbacks = 0;
  let clean = 0;
  for (let seed = 0; seed < 40; seed += 1) {
    const board = Board.fromRows(rows, KIND_OF);
    const steps = applyInLevelBooster(board, { id: 'whisk' }, new Rng(`dense-${seed}`));
    if (steps.length === 0) continue;
    const stir = steps[0]!;
    assert.deepEqual(stir.cleared, [], 'the permutation step never clears, matched or not');
    assert.deepEqual(stir.refills, [], 'and never refills');
    assert.ok(stir.falls.length > 0, 'and always moves something');
    // The STIR itself never touches furniture; the cascade a fallback stir
    // starts is an ordinary cascade and may legitimately crack the jar.
    assert.deepEqual(stir.blockerHits, [], 'the permutation step dents nothing');
    if (steps.length === 1) {
      clean += 1;
      assert.equal(findRuns(board).length, 0, 'a single-step whisk left no match');
      assert.deepEqual(board.get({ col: 1, row: 1 })?.blocker, { kind: 'jar', hp: 1 }, 'jar untouched');
      continue;
    }
    fallbacks += 1;
    assert.ok(steps[1]!.matches.length > 0, 'the accepted match cascades as ordinary steps');
    assert.equal(board.filledCount, board.playableCount, 'and the cascade refills to full');
  }
  assert.ok(fallbacks > 0, 'the fallback path is exercised');
  assert.ok(clean > 0, 'and the preferred path still wins sometimes');
}

// --- mercy: goal kinds first, refills obey the pool, null resets ---
{
  const spec = { cols: 5, rows: 5, kinds: KINDS };
  assert.deepEqual(mercyPool(spec, [{ kind: 'd' }, { kind: JAR_KIND }, { kind: 'e' }], 4), ['d', 'e', 'a', 'b']);
  assert.deepEqual(mercyPool(spec, [], 4), ['a', 'b', 'c', 'd'], 'no goals = spec order');
  assert.deepEqual(mercyPool(spec, [{ kind: 'e' }], 2), ['e', 'a', 'b', 'c'], 'min pool is 4');
  assert.deepEqual(mercyPool(spec, [{ kind: 'e' }], 9), KINDS, 'never wider than the level');
  assert.deepEqual(mercyPool(spec, [{ kind: 'zzz' }], 4), ['a', 'b', 'c', 'd'], 'undrawable goals skipped');

  const board = new Board(spec, new Rng('mercy'));
  board.setRefillPool(mercyPool(spec, [{ kind: 'd' }], 4));
  board.forEachCell((cell) => board.set(cell, null));
  const narrowed = refillBoard(board, new Rng('refill'));
  assert.equal(narrowed.length, 25);
  assert.ok(
    !narrowed.some((event) => event.piece.kind === 'e'),
    'the excluded kind never appears in a refill',
  );

  // A clone carries the pool (the solver's lookahead sees the same stream),
  // `fill` ignores it, and `null` restores the level's full kind list.
  const probe = board.clone();
  probe.forEachCell((cell) => probe.set(cell, null));
  assert.ok(
    !refillBoard(probe, new Rng('refill')).some((event) => event.piece.kind === 'e'),
    'clone carries the pool',
  );
  board.fill(new Rng('seed'));
  const seeded = new Set<string>();
  board.forEachCell((_cell, held) => {
    if (held !== null) seeded.add(held.kind);
  });
  assert.ok(seeded.has('e'), 'fill always uses the full kind list');
  board.setRefillPool(null);
  board.forEachCell((cell) => board.set(cell, null));
  assert.ok(
    refillBoard(board, new Rng('wide')).some((event) => event.piece.kind === 'e'),
    'null resets the pool',
  );

  // Junk in, sane out: unknown kinds filtered, an all-junk pool clears itself.
  board.setRefillPool(['e', 'nope', JAR_KIND]);
  board.forEachCell((cell) => board.set(cell, null));
  assert.ok(
    refillBoard(board, new Rng('junk')).every((event) => event.piece.kind === 'e'),
    'unknown kinds filtered out',
  );
  board.setRefillPool([JAR_KIND, 'nope']);
  board.forEachCell((cell) => board.set(cell, null));
  assert.ok(
    new Set(refillBoard(board, new Rng('junk2')).map((event) => event.piece.kind)).size > 1,
    'an empty pool clears',
  );
}

console.log('board.selftest: ok');

// --- spawn invariant: a payload NEVER lands on an occupied (non-free) cell ---
// Playtest report 2026-08-28: "boosters/bombs sometimes spawn on non-free
// cells". The scene's opening-bomb seeder walks past blockers (game.ts), and
// the resolver must uphold the same law for match-earned specials: a special's
// home cell is a member of its own group that is neither a jar nor vined; a
// group with NO free member forfeits its payload.
{
  // A 4-run that is vined end to end earns NOTHING - there is no free home.
  const allVined = Board.fromRows(['AAAA', 'bcbc', 'cbcb'], KIND_OF);
  const smothered = findRuns(allVined);
  assert.equal(smothered.length, 1, 'the vined 4-run still matches');
  assert.equal(smothered[0]?.special ?? null, null, 'but the payload is dropped: every home is occupied');
  assert.equal(smothered[0]?.specialAt, undefined);

  // A partially vined 4-run re-homes its payload onto a free member.
  const halfVined = Board.fromRows(['AAaa', 'bcbc', 'cbcb'], KIND_OF);
  const rehomed = findRuns(halfVined);
  assert.equal(rehomed[0]?.special, 'line-h');
  const home = rehomed[0]?.specialAt;
  assert.ok(home !== undefined && !isVined(halfVined.get(home)), 'the payload home is a free cell of the group');

  // Bulk: seeded random play across blocker levels; after every settled
  // cascade no special may sit on a jar or on any blockered piece.
  const spec = {
    cols: 7,
    rows: 8,
    kinds: KINDS,
    jars: [
      { cell: { col: 2, row: 3 }, hp: 2 as const },
      { cell: { col: 4, row: 3 }, hp: 1 as const },
      { cell: { col: 3, row: 5 }, hp: 1 as const },
    ],
    vines: [
      { col: 1, row: 1 },
      { col: 5, row: 1 },
      { col: 3, row: 6 },
    ],
  };
  for (let s = 0; s < 40; s += 1) {
    const rng = new Rng(`spawn-invariant-${s}`);
    const live = new Board(spec, rng);
    for (let turn = 0; turn < 25; turn += 1) {
      const moves = findValidMoves(live);
      if (moves.length === 0) break;
      const move = moves[rng.int(0, moves.length - 1)]!;
      live.swap(move.a, move.b);
      resolveCascades(live, rng, { origin: move.b });
      live.forEachCell((cell, piece) => {
        if (piece === null || (piece.special ?? null) === null) return;
        assert.notEqual(piece.kind, JAR_KIND, `seed ${s}: a special spawned on a jar at ${cell.col},${cell.row}`);
        assert.equal(
          piece.blocker ?? null,
          null,
          `seed ${s}: a special spawned on a blockered cell at ${cell.col},${cell.row}`,
        );
      });
    }
  }
}
