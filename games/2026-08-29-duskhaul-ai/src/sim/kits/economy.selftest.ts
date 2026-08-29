// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/economy.selftest.ts
import assert from 'node:assert/strict';
import { Economy, type EconomySpec } from '../../core/economy';

const SPEC: EconomySpec = {
  generators: [
    { id: 'a', name: 'A', baseCost: 10, costGrowth: 1.09, baseIncomePerSec: 0.5, cycleMs: 1000 },
    { id: 'b', name: 'B', baseCost: 120, costGrowth: 1.12, baseIncomePerSec: 4, cycleMs: 3000, unlockAtTotalEarned: 200 },
  ],
  managers: [
    { id: 'm-a', generatorId: 'a', name: 'Manager A', cost: 400 },
    { id: 'm-b', generatorId: 'b', name: 'Manager B', cost: 2000 },
  ],
  prestige: { unlockAtTotalEarned: 5000, multiplierPerReset: 0.02, earningsPerStep: 1000 },
};

const near = (actual: number, expected: number, message: string, epsilon = 1e-9): void => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon * Math.max(1, Math.abs(expected)),
    `${message}: got ${actual}, expected ${expected}`,
  );
};

// --- buyCost is the geometric sum of the individual unit prices -------------
{
  const eco = new Economy(SPEC);
  const def = SPEC.generators[0]!;

  near(eco.buyCost('a', 1), def.baseCost, 'first unit costs baseCost');

  // Closed form must equal the naive per-unit sum from any owned count.
  eco.cash = 1e9;
  assert.ok(eco.buy('a', 7), 'bulk buy of 7 succeeds with cash on hand');
  assert.equal(eco.ownedOf('a'), 7);

  let manual = 0;
  for (let i = 0; i < 5; i += 1) manual += def.baseCost * Math.pow(def.costGrowth, 7 + i);
  near(eco.buyCost('a', 5), manual, 'geometric sum matches per-unit sum');

  // Buying 5 at once must cost exactly what five single buys cost.
  const bulk = eco.buyCost('a', 5);
  const stepwise = new Economy(SPEC);
  stepwise.cash = 1e9;
  stepwise.buy('a', 7);
  let sum = 0;
  for (let i = 0; i < 5; i += 1) {
    sum += stepwise.buyCost('a', 1);
    stepwise.buy('a', 1);
  }
  near(bulk, sum, 'bulk cost equals five sequential single buys', 1e-12);

  // Locked generators cannot be bought regardless of cash.
  const locked = new Economy(SPEC, 1e9);
  assert.equal(locked.isUnlocked('b'), false, 'b is gated behind 200 earned');
  assert.equal(locked.buy('b', 1), false, 'locked generator refuses purchase');
}

// --- 10 simulated minutes of automated income match the analytic total -----
{
  const eco = new Economy(SPEC, 1e6);
  eco.buy('a', 10);
  // Starting cash is not "earned", so the unlock gate still blocks b.
  eco.buy('b', 3);
  assert.equal(eco.ownedOf('b'), 0, 'b stays locked until 200 has been EARNED');

  assert.ok(eco.buyManager('m-a'), 'manager for a is affordable');
  assert.equal(eco.isAutomated('a'), true);
  assert.equal(eco.isAutomated('b'), false);

  const rate = eco.incomePerSec();
  near(rate, 10 * 0.5 * 1, 'automated rate = owned * base * prestigeMult');

  const before = eco.cash;
  const totalBefore = eco.totalEarned;
  const durationMs = 600_000;
  const dt = 16.666;
  let elapsed = 0;
  while (elapsed + dt <= durationMs) {
    eco.update(dt);
    elapsed += dt;
  }
  eco.update(durationMs - elapsed);

  const analytic = (rate * durationMs) / 1000;
  near(eco.cash - before, analytic, '10 minutes of accrual matches rate * time', 1e-9);
  near(eco.totalEarned - totalBefore, analytic, 'totalEarned tracks accrual');
  near(eco.lifetimeEarned, eco.totalEarned, 'lifetime equals total before any prestige');

  // b is now unlocked by earnings, and its manual cycle is the only payout.
  assert.equal(eco.isUnlocked('b'), true, 'earnings unlocked b');
  assert.ok(eco.buy('b', 2), 'b affordable after ten minutes');
  near(eco.collectReadyRatio('b'), 1, 'a freshly bought generator is tap-ready');
  const manual = eco.collect('b');
  near(manual, 2 * 4 * 1 * 3, 'manual collect pays one full cycle');
  assert.equal(eco.collect('b'), 0, 'a second tap inside the cycle pays nothing');
  eco.update(1500);
  assert.equal(eco.collect('b'), 0, 'half a cycle is still not ready');
  near(eco.collectReadyRatio('b'), 0.5, 'ratio reports partial fill');
  eco.update(1500);
  near(eco.collect('b'), 24, 'a full cycle later the tap pays again');

  // A manager pays the same rate — it removes tapping, not the balance curve.
  const tapped = new Economy(SPEC, 1e6);
  tapped.buy('a', 4);
  const automated = new Economy(SPEC, 1e6);
  automated.buy('a', 4);
  automated.buyManager('m-a');
  for (let i = 0; i < 60; i += 1) {
    tapped.update(1000);
    tapped.collect('a');
    automated.update(1000);
  }
  near(tapped.totalEarned, automated.totalEarned, 'tapping every cycle equals automation');
  assert.equal(automated.collect('a'), 0, 'an automated generator ignores taps');
}

// --- offline earnings are passive-only and capped ---------------------------
{
  const eco = new Economy(SPEC, 1e6);
  eco.buy('a', 20);
  assert.equal(eco.offlineEarnings(3600_000, 4), 0, 'no manager means no offline income');

  eco.buyManager('m-a');
  const rate = eco.incomePerSec();
  near(eco.offlineEarnings(3600_000, 4), rate * 3600, 'one hour away pays one hour');
  near(eco.offlineEarnings(10 * 3600_000, 4), rate * 4 * 3600, 'ten hours away is capped at four');
  assert.equal(eco.offlineEarnings(-5, 4), 0, 'a backwards clock pays nothing');

  const before = eco.cash;
  const granted = eco.grantOffline(10 * 3600_000, 4);
  near(granted, rate * 4 * 3600, 'grantOffline returns the capped amount');
  near(eco.cash - before, granted, 'grantOffline credits exactly what it returns');
}

// --- prestige wipes the run, keeps and compounds the multiplier -------------
{
  const eco = new Economy(SPEC, 1e6);
  eco.buy('a', 10);
  eco.buyManager('m-a');
  assert.equal(eco.prestigeAvailable(), false, 'prestige is gated on earnings');
  assert.equal(eco.prestige(), 0, 'an unavailable prestige is a no-op');

  // Earn exactly enough to clear the 5000 gate.
  const rate = eco.incomePerSec();
  eco.update((6000 / rate) * 1000);
  near(eco.totalEarned, 6000, 'earned the prestige threshold');
  assert.equal(eco.prestigeAvailable(), true);

  const expectedGain = (6000 / 1000) * 0.02; // formula from prestigeGain()
  near(eco.prestigeGain(), expectedGain, 'gain = earned/step * multiplierPerReset');

  const lifetimeBefore = eco.lifetimeEarned;
  const gain = eco.prestige();
  near(gain, expectedGain, 'prestige returns the granted multiplier');
  assert.equal(eco.cash, 0, 'prestige wipes cash');
  assert.equal(eco.totalEarned, 0, 'prestige wipes cycle earnings');
  assert.equal(eco.ownedOf('a'), 0, 'prestige wipes generators');
  assert.equal(eco.hasManager('m-a'), false, 'prestige wipes managers');
  assert.equal(eco.isAutomated('a'), false);
  assert.equal(eco.prestigeCount, 1);
  near(eco.lifetimeEarned, lifetimeBefore, 'lifetime earnings survive the reset');
  near(eco.prestigeMult, 1 + expectedGain, 'multiplier kept and raised');
  assert.equal(eco.incomePerSec(), 0, 'nothing owned means nothing passive');

  // The same purchase now earns more than it did in the first cycle.
  const fresh = new Economy(SPEC, 1e6);
  fresh.buy('a', 10);
  eco.cash = 1e6;
  eco.buy('a', 10);
  near(eco.buyCost('a', 1), fresh.buyCost('a', 1), 'cost curve restarts identically');
  assert.ok(
    eco.generatorIncomePerSec('a') > fresh.generatorIncomePerSec('a'),
    'the kept multiplier raises income for the same count',
  );
  near(
    eco.generatorIncomePerSec('a'),
    fresh.generatorIncomePerSec('a') * (1 + expectedGain),
    'income scales exactly by the prestige multiplier',
  );

  // A second prestige compounds additively onto the first.
  eco.buyManager('m-a');
  eco.update((5000 / eco.incomePerSec()) * 1000);
  const secondGain = eco.prestigeGain();
  eco.prestige();
  near(eco.prestigeMult, 1 + expectedGain + secondGain, 'prestige gains are additive');
  assert.equal(eco.prestigeCount, 2);
}

// --- snapshot / restore roundtrip ------------------------------------------
{
  const eco = new Economy(SPEC, 1e6);
  eco.buy('a', 13);
  eco.buyManager('m-a');
  eco.update(120_000);
  eco.buy('b', 4);
  eco.update(1200);

  const snap = eco.snapshot();
  // Must survive the storage boundary (JSON.stringify/parse), not just a copy.
  const wire = JSON.parse(JSON.stringify(snap)) as unknown;

  const restored = new Economy(SPEC);
  restored.restore(wire);
  assert.deepEqual(restored.snapshot(), snap, 'restore(snapshot()) is an identity');
  near(restored.incomePerSec(), eco.incomePerSec(), 'restored income matches');
  near(restored.collectReadyRatio('b'), eco.collectReadyRatio('b'), 'restored cycle fill matches');

  // Both continue identically from here.
  eco.update(30_000);
  restored.update(30_000);
  assert.deepEqual(restored.snapshot(), eco.snapshot(), 'restored economy ticks identically');

  // Corrupt/foreign saves degrade to a playable state instead of throwing.
  const junk = new Economy(SPEC, 50);
  junk.restore({ cash: 'lots', owned: { ghost: 9, a: 3 }, managers: ['m-ghost', 'm-a'], prestigeMult: -4 });
  assert.equal(junk.cash, 0, 'a non-numeric cash falls back to 0');
  assert.equal(junk.ownedOf('a'), 3, 'known generators are kept');
  assert.equal(junk.hasManager('m-a'), true, 'known managers are kept');
  assert.equal(junk.hasManager('m-ghost'), false, 'unknown manager ids are dropped');
  assert.equal(junk.prestigeMult, 1, 'multiplier never drops below 1');
  junk.restore(null);
  junk.restore(undefined);
  assert.equal(junk.ownedOf('a'), 3, 'a missing save leaves state untouched');
}

console.log('economy.selftest: ok');
