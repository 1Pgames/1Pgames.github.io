// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/diceloop.selftest.ts
import assert from 'node:assert/strict';
import { Rng } from '../../core/rng';
import { buildRing, DiceLoop, GOAL_SETS, SPECIAL_TILES } from '../../slices/table/board';
import type { RollEvent, TileType } from '../../slices/table/board';
import { TABLE_TUNING } from '../../slices/table/tuning';

const { tiles: TILE_COUNT, rules: RULES } = TABLE_TUNING;

function countTiles(ring: readonly TileType[]): Record<string, number> {
  const counts: Record<string, number> = { coin: 0, loss: 0, chest: 0, rollagain: 0, collect: 0 };
  for (const tile of ring) counts[tile] = (counts[tile] ?? 0) + 1;
  return counts;
}

/** Plays a whole session out; returns the outcome plus the roll log. */
function playOut(seed: string): { won: boolean; reason: string; log: RollEvent[]; loop: DiceLoop } {
  const rng = new Rng(seed);
  const loop = new DiceLoop(buildRing(rng, TILE_COUNT), RULES);
  const log: RollEvent[] = [];
  for (let guard = 0; guard < 500 && !loop.level.ended; guard += 1) {
    const event = loop.roll(rng);
    if (event === null) break;
    log.push(event);
  }
  const outcome = loop.level.outcome;
  assert.ok(outcome !== null, `seed ${seed} must resolve`);
  return { won: outcome.won, reason: outcome.reason, log, loop };
}

// --- layout guarantees: every seed keeps the coin majority and the 2-3 special spread ---
{
  for (let i = 0; i < 200; i += 1) {
    const ring = buildRing(new Rng(`layout-${i}`), TILE_COUNT);
    assert.equal(ring.length, TILE_COUNT, 'ring length is the tile count');
    const counts = countTiles(ring);
    assert.ok(
      (counts.coin ?? 0) >= 10,
      `seed layout-${i}: at least 10 coin tiles, got ${counts.coin}`,
    );
    for (const type of SPECIAL_TILES) {
      const n = counts[type] ?? 0;
      assert.ok(n >= 2 && n <= 3, `seed layout-${i}: ${type} appears 2-3 times, got ${n}`);
    }
    assert.equal(ring[0], 'coin', 'the start tile is always plain');
    assert.equal(
      (counts.coin ?? 0) + (counts.loss ?? 0) + (counts.chest ?? 0) + (counts.rollagain ?? 0) + (counts.collect ?? 0),
      TILE_COUNT,
      'no tile falls outside the five types',
    );
  }
}

// --- determinism: one seed, one session, byte-for-byte the same roll log ---
{
  const a = playOut('determinism');
  const b = playOut('determinism');
  assert.equal(a.won, b.won);
  assert.equal(a.reason, b.reason);
  assert.deepEqual(a.log, b.log, 'same seed replays the same rolls and tile effects');
  assert.equal(a.loop.coins, b.loop.coins);
  assert.equal(a.loop.pieces, b.loop.pieces);

  const other = playOut('determinism-2');
  assert.notDeepEqual(a.log, other.log, 'a different seed produces a different session');
}

// --- movement: the token walks the dice face around the ring, wrapping at the end ---
{
  const loop = new DiceLoop(buildRing(new Rng('walk'), TILE_COUNT), RULES);
  assert.deepEqual(loop.path(18, 4), [19, 0, 1, 2], 'the hop path wraps past the start tile');
  const rng = new Rng('walk-rolls');
  let expected = 0;
  for (let i = 0; i < 12; i += 1) {
    const event = loop.roll(rng);
    if (event === null) break;
    assert.ok(event.roll >= 1 && event.roll <= RULES.diceFaces, 'dice face is 1..6');
    expected = (expected + event.roll) % TILE_COUNT;
    assert.equal(event.to, expected, 'landing tile is start + face, modulo the ring');
    assert.equal(loop.position, expected, 'the loop tracks the token position');
  }
}

// --- loss tiles take a share of the purse and never push it negative ---
{
  let sawLoss = false;
  let sawEmptyLoss = false;
  for (let i = 0; i < 200 && !(sawLoss && sawEmptyLoss); i += 1) {
    const { log } = playOut(`loss-${i}`);
    let purse = 0;
    for (const event of log) {
      const before = purse;
      purse = Math.max(0, purse + event.delta);
      assert.equal(event.coins, purse, 'the event reports the settled purse');
      assert.ok(event.coins >= 0, 'the purse never goes negative');
      if (event.tile === 'loss') {
        assert.equal(
          event.delta,
          -Math.round(before * RULES.lossRatio),
          'a loss tile takes exactly its share of the purse before it',
        );
        if (before === 0) {
          sawEmptyLoss = true;
          assert.equal(event.effect, 'loss-empty', 'a loss on an empty purse is flagged');
        } else {
          sawLoss = true;
        }
      }
    }
  }
  assert.ok(sawLoss, 'the sample must contain a real loss-tile landing');
  assert.ok(sawEmptyLoss, 'the sample must contain a loss landing on an empty purse');
}

// --- rollagain refunds the roll it consumed instead of eating the budget ---
{
  const rng = new Rng('refund');
  const ring: TileType[] = new Array<TileType>(TILE_COUNT).fill('coin');
  ring[3] = 'rollagain';
  const loop = new DiceLoop(ring, RULES);
  // Face is unknown, so roll until the token lands on tile 3.
  let refunds = 0;
  let rolls = 0;
  while (!loop.level.ended && rolls < 200) {
    const before = loop.level.movesLeft ?? 0;
    const event = loop.roll(rng);
    if (event === null) break;
    rolls += 1;
    const after = loop.level.movesLeft ?? 0;
    if (event.tile === 'rollagain') {
      refunds += 1;
      assert.equal(event.refunded, true, 'a rollagain landing reports the refund');
      assert.equal(after, before, 'a refunded roll leaves the budget untouched');
    } else {
      assert.equal(event.refunded, false);
      assert.equal(after, before - 1, 'every other tile spends one roll');
    }
  }
  assert.ok(refunds > 0, 'the sample must contain a rollagain landing');
  // No collect tiles on this ring, so the only exit is the budget.
  assert.equal(loop.level.outcome?.won, false);
  assert.equal(loop.level.outcome?.reason, 'out-of-moves');
  assert.equal(rolls, RULES.rolls + refunds, 'refunds buy extra rolls one-for-one');
}

// --- collect tiles grant the three set pieces and win on the third ---
{
  const ring: TileType[] = new Array<TileType>(TILE_COUNT).fill('collect');
  ring[0] = 'coin';
  const loop = new DiceLoop(ring, RULES);
  const rng = new Rng('collect');
  const granted: number[] = [];
  while (!loop.level.ended) {
    const event = loop.roll(rng);
    if (event === null) break;
    if (event.piece !== null) granted.push(event.piece);
  }
  assert.deepEqual(granted, [0, 1, 2], 'pieces are granted in order, one per collect landing');
  assert.equal(loop.pieces, RULES.piecesTarget);
  assert.equal(loop.level.outcome?.won, true);
  assert.equal(loop.level.outcome?.reason, 'goals');
  assert.deepEqual(loop.level.goalProgress(GOAL_SETS), { current: 3, target: 3 });
  assert.ok(loop.level.stars >= 1 && loop.level.stars <= 3, 'a win rates 1-3 stars');
}

// --- the goal is reachable inside the budget for the large majority of seeds ---
{
  const SEEDS = 50;
  let wins = 0;
  for (let i = 0; i < SEEDS; i += 1) {
    const { won, reason } = playOut(`balance-${i}`);
    if (won) {
      assert.equal(reason, 'goals');
      wins += 1;
    } else {
      assert.equal(reason, 'out-of-moves');
    }
  }
  assert.ok(
    wins >= Math.ceil(SEEDS * 0.8),
    `the set goal must be reachable within the roll budget for >=80% of seeds, got ${wins}/${SEEDS}`,
  );
  assert.ok(wins < SEEDS, 'a loss must stay reachable too');
}

console.log('diceloop.selftest: ok');
