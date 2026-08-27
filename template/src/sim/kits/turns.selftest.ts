// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/turns.selftest.ts
import assert from 'node:assert/strict';
import { TurnManager } from '../../core/turns';
import type { TurnState } from '../../core/turns';

// --- Phase order follows the configured list, wrapping into a new round ---
{
  const seen: TurnState[] = [];
  const turns = new TurnManager({
    phases: ['player', 'resolve', 'enemy', 'resolve'],
    apPerRound: { player: 3, enemy: 3 },
  });
  turns.onPhase((state) => seen.push({ ...state }));
  turns.begin();

  assert.deepEqual(turns.current(), { round: 1, phase: 'player', side: 'player' });
  turns.endPhase();
  assert.deepEqual(turns.current(), { round: 1, phase: 'resolve', side: null });
  turns.endPhase();
  assert.deepEqual(turns.current(), { round: 1, phase: 'enemy', side: 'enemy' });
  turns.endPhase();
  assert.deepEqual(turns.current(), { round: 1, phase: 'resolve', side: null });
  turns.endPhase();
  assert.deepEqual(turns.current(), { round: 2, phase: 'player', side: 'player' });

  // Five phase transitions from begin(): 4 explicit endPhase() calls plus the
  // initial phase emitted by begin() itself.
  assert.equal(seen.length, 5);
  assert.deepEqual(
    seen.map((s) => s.phase),
    ['player', 'resolve', 'enemy', 'resolve', 'player'],
  );
}

// --- AP is granted per round and cannot be spent outside a side's own phase, or overspent ---
{
  const turns = new TurnManager({
    phases: ['player', 'resolve', 'enemy', 'resolve'],
    apPerRound: { player: 3, enemy: 2 },
  });
  turns.begin();

  assert.equal(turns.canAct('enemy'), false, 'enemy cannot act during the player phase');
  assert.equal(turns.spend('enemy', 1), false, 'enemy cannot spend during the player phase');

  assert.equal(turns.spend('player', 2), true);
  assert.equal(turns.canAct('player'), true, '1 AP still left');
  assert.equal(turns.spend('player', 2), false, 'only 1 AP left, cannot spend 2');
  assert.equal(turns.spend('player', 1), true);
  assert.equal(turns.canAct('player'), false, '0 AP left');

  turns.endPhase(); // -> resolve
  turns.endPhase(); // -> enemy
  assert.equal(turns.spend('enemy', 3), false, 'enemy only has 2 AP this round');
  assert.equal(turns.spend('enemy', 2), true);

  turns.endPhase(); // -> resolve
  turns.endPhase(); // -> player, round 2: AP refilled from apPerRound, not carried over
  assert.equal(turns.canAct('player'), true);
  assert.equal(turns.spend('player', 3), true, 'full 3 AP available again in round 2');
}

// --- A neutral phase not named in apPerRound never grants a side control ---
{
  const turns = new TurnManager({ apPerRound: { player: 1 } }); // default phases include 'enemy', not in budget
  turns.begin();
  turns.endPhase(); // resolve
  turns.endPhase(); // enemy
  assert.equal(turns.current().side, null, "'enemy' phase has no AP budget entry, so no side owns it");
  assert.equal(turns.canAct('player'), false);
}

console.log('turns.selftest: ok');
