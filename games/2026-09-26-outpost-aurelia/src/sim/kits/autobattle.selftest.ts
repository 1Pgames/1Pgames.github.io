// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/autobattle.selftest.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveCombat } from '../../core/autobattle';
import type { UnitInstance, CombatEvent } from '../../core/autobattle';
import { Rng } from '../../core/rng';

function unit(overrides: Partial<UnitInstance> & Pick<UnitInstance, 'id' | 'side' | 'col' | 'row'>): UnitInstance {
  return {
    defId: 'grunt',
    hp: 20,
    maxHp: 20,
    damage: 5,
    attackMs: 500,
    rangeCells: 1,
    speedCellsPerS: 2,
    ...overrides,
  };
}

function hashLog(log: readonly CombatEvent[]): string {
  return createHash('sha256').update(JSON.stringify(log)).digest('hex');
}

// --- Determinism: identical seed + boards produce a byte-identical log ---
{
  const makeBoards = (): [UnitInstance[], UnitInstance[]] => [
    [unit({ id: 'p1', side: 'player', col: 0, row: 0 }), unit({ id: 'p2', side: 'player', col: 0, row: 1 })],
    [unit({ id: 'e1', side: 'enemy', col: 4, row: 0 }), unit({ id: 'e2', side: 'enemy', col: 4, row: 1 })],
  ];

  const [p1, e1] = makeBoards();
  const resultA = resolveCombat(p1, e1, new Rng(1234));
  const [p2, e2] = makeBoards();
  const resultB = resolveCombat(p2, e2, new Rng(1234));

  assert.equal(hashLog(resultA.log), hashLog(resultB.log), 'same seed must produce an identical event log');
  assert.equal(resultA.winner, resultB.winner);
  assert.equal(resultA.durationMs, resultB.durationMs);

  const [p3, e3] = makeBoards();
  const resultC = resolveCombat(p3, e3, new Rng(9999));
  // Different seed only affects nearest-enemy tiebreaks; with these two
  // boards distances are unambiguous (0 vs 1 row offset from each target),
  // so the outcome is expected to match — the important guarantee is that a
  // *changed* seed does not corrupt the sim (still terminates, still valid).
  assert.ok(resultC.winner === 'player' || resultC.winner === 'enemy' || resultC.winner === 'draw');
}

// --- Asymmetric boards: stronger side should win, and every event references a real unit ---
{
  const playerBoard: UnitInstance[] = [
    unit({ id: 'tank', side: 'player', col: 0, row: 0, hp: 100, maxHp: 100, damage: 12 }),
    unit({ id: 'dps', side: 'player', col: 0, row: 1, hp: 40, maxHp: 40, damage: 20 }),
  ];
  const enemyBoard: UnitInstance[] = [unit({ id: 'weak', side: 'enemy', col: 3, row: 0, hp: 15, maxHp: 15, damage: 3 })];

  const result = resolveCombat(playerBoard, enemyBoard, new Rng(5));
  assert.equal(result.winner, 'player', 'a much stronger player board should win');

  const knownIds = new Set(['tank', 'dps', 'weak', 'player', 'enemy']);
  for (const event of result.log) {
    assert.ok(knownIds.has(event.actor), `event actor ${event.actor} must reference a real unit or winner tag`);
    if (event.target !== undefined) assert.ok(knownIds.has(event.target));
  }
  assert.ok(result.log.some((e) => e.kind === 'death' && e.actor === 'weak'), 'the outmatched unit should die');
  assert.equal(result.log[result.log.length - 1]!.kind, 'end');
}

// --- Hard cap reached with both sides still standing resolves by sudden-death total HP ---
{
  // Units far enough apart, with range 0 and speed 0, never reach each other:
  // the fight is guaranteed to hit the 30000ms hard cap with everyone alive.
  const playerBoard: UnitInstance[] = [
    unit({ id: 'p1', side: 'player', col: 0, row: 0, hp: 50, maxHp: 50, rangeCells: 0, speedCellsPerS: 0 }),
  ];
  const enemyBoard: UnitInstance[] = [
    unit({ id: 'e1', side: 'enemy', col: 99, row: 99, hp: 10, maxHp: 10, rangeCells: 0, speedCellsPerS: 0 }),
  ];

  const result = resolveCombat(playerBoard, enemyBoard, new Rng(1));
  assert.equal(result.durationMs, 30000, 'must run to the full hard cap when neither side can reach the other');
  assert.equal(result.winner, 'player', 'higher total remaining HP wins the sudden-death tiebreak');
  assert.equal(result.log.filter((e) => e.kind === 'hit').length, 0, 'units that never reach range never hit');

  // Equal total HP at the cap resolves as a draw.
  const evenPlayer: UnitInstance[] = [
    unit({ id: 'p1', side: 'player', col: 0, row: 0, hp: 10, maxHp: 10, rangeCells: 0, speedCellsPerS: 0 }),
  ];
  const evenEnemy: UnitInstance[] = [
    unit({ id: 'e1', side: 'enemy', col: 99, row: 99, hp: 10, maxHp: 10, rangeCells: 0, speedCellsPerS: 0 }),
  ];
  const drawResult = resolveCombat(evenPlayer, evenEnemy, new Rng(1));
  assert.equal(drawResult.winner, 'draw');
}

// --- Empty board on either side resolves immediately without a hard-cap grind ---
{
  const onlyPlayer: UnitInstance[] = [unit({ id: 'p1', side: 'player', col: 0, row: 0 })];
  const result = resolveCombat(onlyPlayer, [], new Rng(1));
  assert.equal(result.winner, 'player');
  assert.equal(result.durationMs, 0, 'nothing to simulate when one side starts empty');
}

console.log('autobattle.selftest: ok');
