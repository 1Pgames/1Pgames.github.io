// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/extraction.selftest.ts
//
// Invariants for the extraction/banking layer (PRD §2A/§5.6/§7). These are the
// permanent gates for the two post-greybox blockers:
//   BLOCKER 1 — the channel must be completable under UNBROKEN contact.
//   BLOCKER 2 — the Collapse ring must actually close on the player.
// plus the manual-pin-only casket and the drop-lowest/linger overflow path.
import assert from 'node:assert/strict';
import {
  CHANNEL_DEFAULTS,
  COLLAPSE_DEFAULTS,
  ExtractionSystem,
  channelCompletableUnderContact,
  worstCaseChannelMs,
  type ExtractionTuning,
  type GateSpec,
} from '../../systems/extraction';
import { Bag, resolveBagCapacity, type RelicDef } from '../../systems/bag';

/** Ships in `TUNING.player.invulnMs`; the channel law is derived against it. */
const INVULN_MS = 700;
const GATE_RADIUS = 120;

const GATES: GateSpec[] = [
  { id: 'a', x: 420, y: 300, opensS: 120, closesS: 210 },
  { id: 'b', x: 1200, y: 900, opensS: 240, closesS: 360 },
  { id: 'c', x: 1450, y: 1450, opensS: 420, closesS: null },
];

const tuning = (over: Partial<ExtractionTuning> = {}): ExtractionTuning => ({
  channelMs: CHANNEL_DEFAULTS.channelMs,
  radius: GATE_RADIUS,
  collapseAtS: COLLAPSE_DEFAULTS.atS,
  closingWarnS: 15,
  channel: CHANNEL_DEFAULTS,
  collapse: COLLAPSE_DEFAULTS,
  ...over,
});

const relic = (id: string, tier: 1 | 2 | 3 | 4): RelicDef => ({
  id,
  name: id,
  tier,
  salvage: [0, 10, 30, 80, 200][tier]!,
});

/** Ticks the system to `untilS`, holding the player at (x, y). */
const run = (
  sys: ExtractionSystem,
  untilS: number,
  x: number,
  y: number,
  opts: { hitEveryMs?: number; dtMs?: number; elites?: number } = {},
): void => {
  const dt = opts.dtMs ?? 16;
  let sinceHit = 0;
  while (sys.elapsedS < untilS && !sys.extracted) {
    let hit = false;
    if (opts.hitEveryMs !== undefined) {
      sinceHit += dt;
      if (sinceHit >= opts.hitEveryMs) {
        hit = true;
        sinceHit = 0;
      }
    }
    const contest =
      opts.elites === undefined ? undefined : { enemies: Math.max(1, opts.elites), elites: opts.elites };
    sys.update(dt, x, y, hit, contest);
  }
};

// --- BLOCKER 1: the channel law, and the channel it guarantees --------------
{
  assert.ok(
    channelCompletableUnderContact(CHANNEL_DEFAULTS, INVULN_MS),
    'the shipped tuning must satisfy (invulnMs - hitStallMs) * minRate > hitSetbackMs',
  );
  // The law is what makes it completable — break invulnMs and it must fail loudly.
  assert.equal(
    channelCompletableUnderContact(CHANNEL_DEFAULTS, 400),
    false,
    'at invulnMs 400 the setback/stall/minRate trio must be re-derived',
  );

  const gateB = GATES[1]!;
  const sys = new ExtractionSystem(GATES, tuning());
  run(sys, 240, 0, 0);
  assert.equal(sys.gateState('b'), 'open', 'Gate B is open at 240s');

  const startS = sys.elapsedS;
  let regressions = 0;
  let prev = 0;
  while (!sys.extracted && sys.elapsedS < startS + 120) {
    // One i-frame cycle of unbroken contact inside Gate B's ring.
    run(sys, sys.elapsedS + INVULN_MS / 1000, gateB.x, gateB.y, { hitEveryMs: INVULN_MS });
    if (sys.channelProgress < prev) regressions += 1;
    prev = sys.channelProgress;
  }
  assert.equal(regressions, 0, 'no i-frame cycle may end with less fill than the one before');
  assert.ok(sys.extracted, 'the channel COMPLETES under unbroken contact (blocker 1)');

  const measuredMs = (sys.elapsedS - startS) * 1000;
  const predictedMs = worstCaseChannelMs(CHANNEL_DEFAULTS, INVULN_MS);
  // The closed form is the steady-state BOUND; a real hold gets one uncontested
  // cycle before the first hit lands, so it must finish no slower than the bound.
  assert.ok(
    measuredMs <= predictedMs + 32,
    `measured worst case ${Math.round(measuredMs)}ms never exceeds the closed form ${Math.round(predictedMs)}ms`,
  );
  assert.ok(
    measuredMs > predictedMs * 0.6,
    `and stays in the same band as the bound (${Math.round(measuredMs)}ms vs ${Math.round(predictedMs)}ms)`,
  );
  assert.ok(measuredMs < 25000, `contested Gate B extraction stays under 25s (got ${Math.round(measuredMs)}ms)`);

  // The greybox rule is what the closed form rejects: a full reset never completes.
  assert.equal(
    worstCaseChannelMs({ ...CHANNEL_DEFAULTS, hitSetbackMs: CHANNEL_DEFAULTS.channelMs }, INVULN_MS),
    Infinity,
    'a setback big enough to zero the bar is reported as uncompletable',
  );
}

// --- a clear ring pays full rate; the Warden's ring pays the floor ----------
{
  const gateB = GATES[1]!;
  const clear = new ExtractionSystem(GATES, tuning());
  run(clear, 241, 0, 0);
  const t0 = clear.elapsedS;
  run(clear, 260, gateB.x, gateB.y);
  assert.ok(clear.extracted, 'an uncontested channel completes');
  const clearMs = (clear.elapsedS - t0) * 1000;
  assert.ok(
    Math.abs(clearMs - CHANNEL_DEFAULTS.channelMs) <= 48,
    `a clear ring channels in channelMs (got ${Math.round(clearMs)}ms)`,
  );

  // Boss in the ring: the rate floors at minRate, never below.
  const gateC = GATES[2]!;
  const boss = new ExtractionSystem(GATES, tuning());
  run(boss, 421, 0, 0);
  const bossStart = boss.elapsedS;
  run(boss, 470, gateC.x, gateC.y, { hitEveryMs: INVULN_MS, elites: 4 });
  assert.ok(boss.channelRate >= CHANNEL_DEFAULTS.minRate - 1e-9, 'the accrual rate never dips below minRate');
  assert.ok(boss.extracted, 'Gate C completes even with four elites contesting the ring');
  assert.ok(
    (boss.elapsedS - bossStart) * 1000 < 35000,
    'Gate C under boss contest stays inside the 35s design bound',
  );
}

// --- the channel is dt-invariant and pauses (never resets) outside the ring --
{
  const gateA = GATES[0]!;
  const fine = new ExtractionSystem(GATES, tuning());
  const coarse = new ExtractionSystem(GATES, tuning());
  run(fine, 122, gateA.x, gateA.y, { dtMs: 8 });
  run(coarse, 122, gateA.x, gateA.y, { dtMs: 40 });
  assert.ok(
    Math.abs(fine.channelProgress - coarse.channelProgress) < 0.02,
    'channel fill is tick-size invariant',
  );

  const sys = new ExtractionSystem(GATES, tuning());
  run(sys, 121, gateA.x, gateA.y);
  const parked = sys.channelProgress;
  assert.ok(parked > 0, 'the hold starts inside the ring');
  run(sys, 123, 0, 0);
  assert.equal(sys.channelProgress, parked, 'leaving the ring PAUSES the hold, keeping progress');
  assert.equal(sys.channelingGate, 'a', 'the hold stays bound to its gate while outside');

  // A hit costs exactly hitSetbackMs of accrual and flags one interrupt frame.
  const before = sys.channelProgress * sys.channelMsEffective;
  sys.update(16, 0, 0, true);
  assert.equal(sys.channelInterrupted, true, 'channelInterrupted flags the setback frame');
  assert.ok(
    Math.abs(before - CHANNEL_DEFAULTS.hitSetbackMs - sys.channelProgress * sys.channelMsEffective) < 1e-6,
    'a hit subtracts hitSetbackMs, not the whole bar',
  );
  sys.update(16, 0, 0, false);
  assert.equal(sys.channelInterrupted, false, 'the interrupt flag lasts exactly one frame');
}

// --- gate schedule, Duskmirror windows, Gravekey and spawn suppression ------
{
  const sys = new ExtractionSystem(GATES, tuning());
  run(sys, 100, 0, 0);
  assert.equal(sys.gateState('a'), 'closed');
  run(sys, 150, 0, 0);
  assert.equal(sys.gateState('a'), 'open', 'Gate A open at 150s');
  run(sys, 200, 0, 0);
  assert.equal(sys.gateState('a'), 'closing', 'Gate A warns for closingWarnS before 210s');
  assert.equal(sys.gateState('c'), 'closed', 'Gate C stays shut until 420s');
  run(sys, 215, 0, 0);
  assert.equal(sys.gateState('a'), 'spent', 'Gate A is spent past its close');

  const mirrored = new ExtractionSystem(GATES, tuning({ gateWindowBonusS: 20 }));
  run(mirrored, 215, 0, 0);
  assert.equal(mirrored.gateState('a'), 'closing', 'Duskmirror keeps Gate A alive 20s longer');
  run(mirrored, 231, 0, 0);
  assert.equal(mirrored.gateState('a'), 'spent', 'and it closes at 230s, not 210s');
  assert.equal(mirrored.gates[2]!.closesS, null, 'Gate C has no window to extend');

  const keyed = new ExtractionSystem(
    GATES,
    tuning({ channel: { ...CHANNEL_DEFAULTS, channelMsDelta: -800 } }),
  );
  assert.equal(keyed.channelMsEffective, 3200, 'Gravekey trims 800ms off the channel');
  const overGeared = new ExtractionSystem(
    GATES,
    tuning({ channel: { ...CHANNEL_DEFAULTS, channelMsDelta: -9000 } }),
  );
  assert.equal(overGeared.channelMsEffective, CHANNEL_DEFAULTS.channelMsFloor, 'the channel floor holds');

  const spawner = new ExtractionSystem(GATES, tuning());
  const gateA = GATES[0]!;
  assert.equal(spawner.spawnSuppressed(gateA.x, gateA.y), false, 'a closed gate suppresses nothing');
  run(spawner, 130, 0, 0);
  assert.equal(spawner.spawnSuppressed(gateA.x, gateA.y), true, 'an open gate suppresses its pocket');
  assert.equal(
    spawner.spawnSuppressed(gateA.x + CHANNEL_DEFAULTS.suppressRadius + 1, gateA.y),
    false,
    'suppression stops exactly at suppressRadius',
  );
  run(spawner, 215, 0, 0);
  assert.equal(spawner.spawnSuppressed(gateA.x, gateA.y), false, 'a spent gate stops suppressing');
}

// --- BLOCKER 2: the Collapse ring closes on the player ----------------------
{
  const gateC = GATES[2]!;
  // Player parked at the arena spawn (800, 800) — the greybox's non-event case.
  const sys = new ExtractionSystem(GATES, tuning());
  let ignitedAt = -1;
  sys.onEvent((e) => {
    if (e === 'collapse') ignitedAt = sys.elapsedS;
  });
  run(sys, 479, 800, 800);
  assert.equal(sys.collapse === null, true, 'no ring before collapseAtS');
  run(sys, 481, 800, 800);
  const collapse = sys.collapse;
  assert.ok(collapse !== null && collapse.active, 'the Collapse ignites at 480s');
  assert.ok(ignitedAt >= 480 && ignitedAt < 481, 'the collapse event fires once, on time');

  const dist = Math.hypot(800 - gateC.x, 800 - gateC.y);
  const expectedStart = Math.min(
    COLLAPSE_DEFAULTS.maxStart,
    Math.max(COLLAPSE_DEFAULTS.minStart, dist + COLLAPSE_DEFAULTS.startPad),
  );
  assert.equal(sys.collapseRingStartRadius, expectedStart, 'the start radius is latched off the player');
  assert.ok(
    sys.collapseRingStartRadius <= COLLAPSE_DEFAULTS.maxStart,
    'the ring never starts at the old corner span (2340px)',
  );
  assert.equal(sys.collapseRingCenter.x, gateC.x, 'the ring is centred on Gate C');
  assert.equal(sys.collapseRingCenter.y, gateC.y);

  // The fire must REACH a stationary player, inside the design window.
  let contactS = -1;
  let prevRadius = Infinity;
  while (sys.elapsedS < 480 + 90) {
    sys.update(16, 800, 800, false);
    const ring = sys.collapse!;
    assert.ok(ring.ringRadius <= prevRadius + 1e-9, 'the ring radius is monotonically non-increasing');
    prevRadius = ring.ringRadius;
    if (contactS < 0 && dist > ring.ringRadius) contactS = sys.collapseElapsedS;
  }
  assert.ok(contactS > 0, 'the fire reaches a stationary player (blocker 2)');
  assert.ok(contactS < 20, `first fire contact reads as an ending (${contactS.toFixed(1)}s past 480s)`);
  assert.equal(
    sys.collapse!.ringRadius,
    COLLAPSE_DEFAULTS.minRadius,
    'the ring HOLDS at minRadius so Gate C stays standable',
  );
  assert.ok(COLLAPSE_DEFAULTS.minRadius > GATE_RADIUS, 'minRadius clears the gate ring: extraction stays possible');

  // Ramps: fire dps caps, threat does not, the elite quota is pure.
  assert.ok(sys.collapseFireDps <= COLLAPSE_DEFAULTS.fireDpsMax, 'fire dps respects its cap');
  assert.ok(sys.collapseFireDps > COLLAPSE_DEFAULTS.fireDps, 'fire dps has ramped past its base');
  assert.ok(sys.collapseThreatBonus >= COLLAPSE_DEFAULTS.threatStep * 8, 'threat keeps climbing, uncapped');
  assert.equal(
    sys.collapseEliteQuota,
    Math.floor(sys.collapseElapsedS / COLLAPSE_DEFAULTS.eliteEveryS),
    'the elite quota is a pure function of collapse time',
  );

  // Ring geometry is closed form: tick size cannot move the fire.
  const fine = new ExtractionSystem(GATES, tuning());
  const coarse = new ExtractionSystem(GATES, tuning());
  run(fine, 520, 800, 800, { dtMs: 8 });
  run(coarse, 520, 800, 800, { dtMs: 50 });
  assert.ok(
    Math.abs(fine.collapse!.ringRadius - coarse.collapse!.ringRadius) < 8,
    'ring geometry is tick-size invariant',
  );
  assert.ok(fine.collapseRingSpeed <= COLLAPSE_DEFAULTS.ringSpeedMax, 'the shrink speed respects ringSpeedMax');
  assert.ok(fine.collapseRingSpeed > COLLAPSE_DEFAULTS.ringSpeedPxPerS, 'the shrink speed ramps up');

  // A player camped ON Gate C is never burned out of the extraction spot.
  const camper = new ExtractionSystem(GATES, tuning({ collapseAtS: 420 }));
  run(camper, 500, gateC.x, gateC.y, { hitEveryMs: INVULN_MS });
  assert.ok(camper.extracted, 'Gate C remains extractable inside the held ring');
}

// --- extraction ends the run once, and freezes the system -------------------
{
  const gateA = GATES[0]!;
  const sys = new ExtractionSystem(GATES, tuning());
  let extractions = 0;
  sys.onEvent((e) => {
    if (e === 'extracted') extractions += 1;
  });
  run(sys, 130, gateA.x, gateA.y);
  assert.ok(sys.extracted && sys.extractedGate === 'a', 'Gate A extraction is attributed to Gate A');
  const frozenAt = sys.elapsedS;
  run(sys, 500, gateA.x, gateA.y);
  assert.equal(sys.elapsedS, frozenAt, 'update is inert after extraction');
  assert.equal(extractions, 1, 'the extracted event fires exactly once');
  assert.equal(sys.gateState('a'), 'spent', 'a used gate is spent');
}

// --- BANKING: the casket is manual-pin only (PRD §5.6) ----------------------
{
  const bag = new Bag(8, 1);
  bag.addShards(448);
  bag.addRelic(relic('r_dreadcrown', 4));
  bag.addRelic(relic('r_toothcharm', 1));
  assert.equal(bag.casket.length, 0, 'the casket starts EMPTY and auto-pins nothing');

  const died = bag.settle('died', 0);
  assert.equal(died.relics.length, 0, 'nothing survives a death the player never insured');
  assert.equal(died.lost.length, 2, 'both carried relics are lost');
  assert.equal(died.shards, 0, 'no Rot Tithe means no shards survive');
  assert.equal(bag.settle('died', 25).shards, 112, '25% of 448 shards survive with Rot Tithe');

  assert.equal(bag.pinCasket('nope'), false, 'pinning an uncarried relic fails');
  assert.equal(bag.pinCasket('r_dreadcrown'), true, 'the player pins deliberately');
  assert.equal(bag.casket.length, 1);
  assert.equal(bag.relics.length, 1, 'a pinned relic leaves the ordinary bag');
  const insured = bag.settle('died', 0);
  assert.equal(insured.relics[0]!.id, 'r_dreadcrown', 'the pin survives death');
  assert.equal(insured.lost.length, 1, 'everything unpinned is lost');
  assert.equal(bag.settle('extracted', 0).relics.length, 2, 'extraction banks casket AND bag');

  const swap = bag.repin('r_toothcharm');
  assert.equal(swap.pinned, true);
  assert.equal(swap.unpinned!.id, 'r_dreadcrown', 'a full casket gives up its oldest pin');
  assert.equal(swap.dropped, null, 'the displaced relic returns to a bag with room');
  assert.equal(bag.casket[0]!.id, 'r_toothcharm');
  assert.equal(bag.unpinCasket('r_toothcharm'), true, 'a pin can be released');
  assert.equal(bag.casket.length, 0);

  // The legacy auto-pin stays available as a pure tuning flip.
  const legacy = new Bag(8, 1, { autoPinHighest: true });
  legacy.addRelic(relic('r_waxseal', 1));
  legacy.addRelic(relic('r_gravekey', 4));
  assert.equal(legacy.casket[0]!.id, 'r_gravekey', 'autoPinHighest restores the greybox behaviour');
}

// --- BANKING: drop-lowest overflow and the linger window --------------------
{
  const bag = new Bag(3, 1, { dropLingerS: 10 });
  bag.addRelic(relic('mid', 2));
  bag.addRelic(relic('low', 1));
  bag.addRelic(relic('high', 3));
  assert.equal(bag.full, true, '3 of 3 bag slots used');

  const overflow = bag.addRelic(relic('gilded', 3));
  assert.equal(overflow.accepted, true);
  assert.equal(overflow.dropped!.id, 'low', 'overflow drops the LOWEST tier');
  assert.equal(overflow.dropLingerMs, 10000, 'the regret window comes from bag.dropLingerS');
  assert.equal(bag.relics.length, 3, 'capacity is never exceeded');

  const refused = bag.addRelic(relic('trash', 1));
  assert.equal(refused.accepted, false, 'the worst thing carried can be the new relic itself');
  assert.equal(refused.dropped, null, 'a refused pickup is not reported as a drop');
  assert.equal(refused.dropLingerMs, 10000, 'and it still lingers for regret pickup');
  assert.equal(bag.relics.length, 3);

  // A casket pin is NEVER an overflow victim, even when it is the worst carried.
  const pinned = new Bag(2, 1);
  pinned.addRelic(relic('cheap', 1));
  assert.equal(pinned.pinCasket('cheap'), true);
  pinned.addRelic(relic('t2', 2));
  pinned.addRelic(relic('t3', 3));
  const push = pinned.addRelic(relic('t4', 4));
  assert.equal(push.dropped!.id, 't2', 'the lowest UNPINNED relic falls out');
  assert.equal(pinned.casket[0]!.id, 'cheap', 'the pinned relic is untouchable');
  assert.equal(pinned.settle('died', 0).relics[0]!.id, 'cheap');

  // Duplicates of the same table def must not conflate (greybox identity bug).
  const table = relic('r_bonedice', 1);
  const dupes = new Bag(4, 1);
  dupes.addRelic(table);
  dupes.addRelic(table);
  assert.equal(dupes.pinCasket('r_bonedice'), true);
  assert.equal(dupes.casket.length, 1, 'one copy is pinned');
  assert.equal(dupes.relics.length, 1, 'the other copy stays visible in the bag');

  // Bulk invariant: capacity, census and settlement conservation.
  const bulk = new Bag(8, 1);
  let lost = 0;
  for (let i = 0; i < 200; i += 1) {
    const tier = ((i % 4) + 1) as 1 | 2 | 3 | 4;
    const result = bulk.addRelic(relic(`r${i}`, tier));
    if (result.dropped !== null || !result.accepted) lost += 1;
    assert.ok(bulk.relics.length <= 8, 'bag slots never overflow');
    assert.ok(bulk.casket.length <= 1, 'casket slots never overflow');
  }
  assert.equal(bulk.relics.length + bulk.casket.length, 200 - lost, 'every relic is either carried or dropped');
  const settled = bulk.settle('extracted', 0);
  assert.equal(settled.relics.length, bulk.relics.length + bulk.casket.length, 'extraction banks the whole census');
  assert.equal(settled.lost.length, 0);
}

// --- BANKING: meta capacity hooks ------------------------------------------
{
  const base = { slots: 8, casketSlots: 1 };
  assert.deepEqual(resolveBagCapacity(base), base, 'no meta = shipped capacity');
  assert.deepEqual(
    resolveBagCapacity(base, { bagSlotsBonus: 4, casketSlotsBonus: 1 }),
    { slots: 12, casketSlots: 2 },
    "Marrow Sack x2 and Widow's Casket resolve additively",
  );
  const wide = resolveBagCapacity(base, { bagSlotsBonus: 2, casketSlotsBonus: 1 });
  const bag = new Bag(wide.slots, wide.casketSlots);
  for (let i = 0; i < 12; i += 1) bag.addRelic(relic(`m${i}`, 2));
  assert.equal(bag.relics.length, 10, 'the widened bag holds 10');
  assert.equal(bag.relics[0]!.id, 'm2', 'the two earliest same-tier relics overflowed out');
  assert.equal(bag.pinCasket('m2'), true);
  assert.equal(bag.pinCasket('m3'), true);
  assert.equal(bag.casket.length, 2, 'the second casket slot is real');
  assert.equal(bag.pinCasket('m4'), true);
  assert.equal(bag.casket.length, 2, 'a third pin displaces the oldest');
  assert.equal(bag.casket[0]!.id, 'm3');
}

console.log('extraction/bag selftest OK');
