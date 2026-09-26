// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/extraction.selftest.ts
//
// Invariants for the extraction layer (PRD-V2 §2.2/§2.3/§5.25/§7) on the V2
// `ExtractionSystem(gates: GateCandidate[], tuning, loadout, hooks)`. These are
// the permanent gates for the two post-greybox blockers:
//   BLOCKER 1 — the channel must be completable under UNBROKEN contact.
//   BLOCKER 2 — the Collapse ring must actually close on the player.
// Bag packing/settlement, conditional-gate conditions and `greedMul` values
// are WS-Loot's `sim/kits/loot.selftest.ts`.
import assert from 'node:assert/strict';
import { TUNING } from '../../config';
import type { ExtractionEvent } from '../../systems/extraction';
import {
  ExtractionSystem,
  channelCompletableUnderContact,
  worstCaseChannelMs,
  type ExtractionTuning,
} from '../../systems/extraction';
import type { GateCandidate, RunLoadoutV2 } from '../../data/types-v2';

/** Ships in `TUNING.player.invulnMs`; the channel law is derived against it. */
const INVULN_MS = TUNING.player.invulnMs;
const GATE_RADIUS = TUNING.gate.radius;

/** V2 schedule (§2.2) on 6144² map geometry: A/B/C at their path bands from a spawn at (600, 3000). */
const SPAWN = { x: 600, y: 3000 };
const GATES: GateCandidate[] = [
  { id: 'a', kind: 'timed', x: 2400, y: 3000, depth: 1, opensS: TUNING.gate.a.openS, closesS: TUNING.gate.a.closeS },
  { id: 'b', kind: 'timed', x: 3500, y: 2000, depth: 1, opensS: TUNING.gate.b.openS, closesS: TUNING.gate.b.closeS },
  { id: 'c', kind: 'timed', x: 5200, y: 3000, depth: 2, opensS: TUNING.gate.c.openS, closesS: TUNING.gate.c.closeS },
];

const tuning = (over: Partial<ExtractionTuning> = {}): ExtractionTuning => ({
  channelMs: TUNING.extract.channelMs,
  radius: GATE_RADIUS,
  collapseAtS: TUNING.collapse.atS,
  closingWarnS: TUNING.gate.closingWarnS,
  channel: TUNING.extract,
  collapse: TUNING.collapse,
  ...over,
});

/** A fresh-meta H1 loadout; only the extraction-facing fields matter here. */
const loadout = (over: Partial<RunLoadoutV2> = {}): RunLoadoutV2 => ({
  zone: 'castle',
  hazard: 1,
  mode: 'normal',
  seed: 'selftest',
  mutators: [],
  classId: 'duskhauler',
  startWeapon: 'bolt',
  modifiers: [],
  unlockedWeapons: ['bolt'],
  unlockedCharms: [],
  bagCells: TUNING.bag.cols * TUNING.bag.rows,
  casketSlots: TUNING.bag.casketSlots,
  deathKeepPct: TUNING.meta.deathKeepPct,
  greedMaxMul: TUNING.greed.maxMul,
  tollPct: TUNING.gates.toll.pct,
  rerollsPerRun: TUNING.draft.rerollsPerRun,
  banishesPerRun: TUNING.draft.banishPerRun,
  startLevel: 1,
  startDreadKeys: 0,
  reviveCharges: 0,
  reviveHpRatio: 0,
  reviveImmunityMs: 0,
  iframesMsBonus: 0,
  gateWindowBonusS: 0,
  channelMsDelta: 0,
  contestedRate: TUNING.extract.contestedRate,
  previewS: TUNING.gate.previewS,
  minimapRevealPx: TUNING.minimap.revealPx,
  speedNearGateMul: 1,
  gloamwalkMs: 0,
  gravePact: false,
  fenceChance: TUNING.poi.fence.chance,
  fenceTrades: 1,
  veinMul: 1,
  veinStandMs: TUNING.poi.vein.standMs,
  breakableDropMul: 1,
  eliteExtraValuables: 0,
  belt: [],
  uniques: [],
  threatMul: 1,
  lootBias: 0,
  itemLevel: 1,
  hazardExtras: { eliteExtraAffix: false, forcedAffix: null, collapseAtS: TUNING.collapse.atS, bossPhaseAt: [0.66, 0.33] },
  mercy: false,
  ...over,
});

const make = (
  opts: { tuning?: Partial<ExtractionTuning>; loadout?: Partial<RunLoadoutV2>; onEvent?: (e: ExtractionEvent) => void } = {},
): ExtractionSystem =>
  new ExtractionSystem(GATES, tuning(opts.tuning), loadout(opts.loadout), {
    payCondition: () => true,
    onEvent: (e) => opts.onEvent?.(e),
  });

const RESOLVED = make();
const CHANNEL = RESOLVED.channelTuning;
const COLLAPSE = RESOLVED.collapseTuning;

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
    const contest = opts.elites === undefined ? undefined : { enemies: Math.max(1, opts.elites), elites: opts.elites };
    sys.update(dt, x, y, hit, contest);
  }
};

// --- the shipped TUNING reaches the system ---------------------------------
{
  assert.equal(CHANNEL.suppressRadius, TUNING.extract.suppressRadius, 'suppressRadius 600 (§2.3) reaches the channel');
  assert.equal(COLLAPSE.maxStart, TUNING.collapse.maxStart, 'Collapse maxStart 2400 (§2.3) reaches the ring');
  assert.equal(COLLAPSE.ringSpeedMax, TUNING.collapse.ringSpeedMax, 'ringSpeedMax 140 reaches the ring');
}

// --- BLOCKER 1: the channel law, and the channel it guarantees --------------
{
  assert.ok(
    channelCompletableUnderContact(CHANNEL, INVULN_MS),
    'the shipped tuning must satisfy (invulnMs - hitStallMs) * minRate > hitSetbackMs',
  );
  assert.equal(channelCompletableUnderContact(CHANNEL, 400), false, 'at invulnMs 400 the trio must be re-derived');

  const gateB = GATES[1]!;
  const sys = make();
  run(sys, TUNING.gate.b.openS + 1, SPAWN.x, SPAWN.y);
  assert.equal(sys.gateState('b'), 'open', 'Gate B is open 1 s after its §2.2 open second');

  const startS = sys.elapsedS;
  let regressions = 0;
  let prev = 0;
  while (!sys.extracted && sys.elapsedS < startS + 90) {
    run(sys, sys.elapsedS + INVULN_MS / 1000, gateB.x, gateB.y, { hitEveryMs: INVULN_MS });
    if (sys.channelProgress < prev) regressions += 1;
    prev = sys.channelProgress;
  }
  assert.equal(regressions, 0, 'no i-frame cycle may end with less fill than the one before');
  assert.ok(sys.extracted, 'the channel COMPLETES under unbroken contact (blocker 1)');
  const measuredMs = (sys.elapsedS - startS) * 1000;
  const predictedMs = worstCaseChannelMs(CHANNEL, INVULN_MS);
  assert.ok(measuredMs <= predictedMs + 32, `measured ${Math.round(measuredMs)}ms never exceeds the closed form ${Math.round(predictedMs)}ms`);
  assert.ok(measuredMs > predictedMs * 0.6, `and stays in the bound's band (${Math.round(measuredMs)} vs ${Math.round(predictedMs)})`);
  assert.equal(
    worstCaseChannelMs({ ...CHANNEL, hitSetbackMs: CHANNEL.channelMs }, INVULN_MS),
    Infinity,
    'a setback big enough to zero the bar is reported as uncompletable',
  );
}

// --- a clear ring pays full rate; the boss ring pays the floor --------------
{
  const gateB = GATES[1]!;
  const clear = make();
  run(clear, TUNING.gate.b.openS + 1, SPAWN.x, SPAWN.y);
  const t0 = clear.elapsedS;
  run(clear, TUNING.gate.b.openS + 20, gateB.x, gateB.y);
  assert.ok(clear.extracted, 'an uncontested channel completes');
  assert.ok(Math.abs((clear.elapsedS - t0) * 1000 - CHANNEL.channelMs) <= 48, 'a clear ring channels in channelMs');

  const gateC = GATES[2]!;
  const boss = make();
  run(boss, TUNING.gate.c.openS + 1, SPAWN.x, SPAWN.y);
  const bossStart = boss.elapsedS;
  run(boss, TUNING.gate.c.openS + 50, gateC.x, gateC.y, { hitEveryMs: INVULN_MS, elites: 4 });
  assert.ok(boss.channelRate >= CHANNEL.minRate - 1e-9, 'the accrual rate never dips below minRate');
  assert.ok(boss.extracted, 'Gate C completes even with four elites contesting the ring');
  assert.ok((boss.elapsedS - bossStart) * 1000 < 35000, 'Gate C under boss contest stays inside 35 s');
}

// --- the channel is dt-invariant and pauses (never resets) outside the ring --
{
  const gateA = GATES[0]!;
  const fine = make();
  const coarse = make();
  run(fine, TUNING.gate.a.openS + 2, gateA.x, gateA.y, { dtMs: 8 });
  run(coarse, TUNING.gate.a.openS + 2, gateA.x, gateA.y, { dtMs: 40 });
  assert.ok(Math.abs(fine.channelProgress - coarse.channelProgress) < 0.02, 'channel fill is tick-size invariant');

  const sys = make();
  run(sys, TUNING.gate.a.openS + 1, gateA.x, gateA.y);
  const parked = sys.channelProgress;
  assert.ok(parked > 0, 'the hold starts inside the ring');
  run(sys, TUNING.gate.a.openS + 3, SPAWN.x, SPAWN.y);
  assert.equal(sys.channelProgress, parked, 'leaving the ring PAUSES the hold, keeping progress');
  assert.equal(sys.channelingGate, 'a', 'the hold stays bound to its gate while outside');

  const before = sys.channelProgress * sys.channelMsEffective;
  sys.update(16, SPAWN.x, SPAWN.y, true);
  assert.equal(sys.channelInterrupted, true, 'channelInterrupted flags the setback frame');
  assert.ok(
    Math.abs(before - CHANNEL.hitSetbackMs - sys.channelProgress * sys.channelMsEffective) < 1e-6,
    'a hit subtracts hitSetbackMs, not the whole bar',
  );
  sys.update(16, SPAWN.x, SPAWN.y, false);
  assert.equal(sys.channelInterrupted, false, 'the interrupt flag lasts exactly one frame');
}

// --- §2.2 schedule, channel delta and spawn suppression -------------------
{
  const a = TUNING.gate.a;
  const sys = make();
  run(sys, a.openS - 1, SPAWN.x, SPAWN.y);
  assert.equal(sys.gateState('a'), 'closed', 'Gate A closed before 90 s');
  run(sys, a.openS + 1, SPAWN.x, SPAWN.y);
  assert.equal(sys.gateState('a'), 'open', 'Gate A open at 90 s');
  run(sys, a.closeS - TUNING.gate.closingWarnS + 1, SPAWN.x, SPAWN.y);
  assert.equal(sys.gateState('a'), 'closing', `Gate A warns ${TUNING.gate.closingWarnS} s before its close`);
  assert.equal(sys.gateState('c'), 'closed', 'Gate C stays shut until 420 s');
  run(sys, a.closeS + 1, SPAWN.x, SPAWN.y);
  assert.equal(sys.gateState('a'), 'spent', 'Gate A is spent past 180 s');
  assert.equal(sys.gateState('b'), 'closed', 'Gate B still closed at 181 s (opens 220 s)');

  // Duskmirror's window bonus is folded into `closesS` by `generateMap(opts.gateWindowBonusS)` (mapgen selftest).

  assert.equal(make({ loadout: { channelMsDelta: -800 } }).channelMsEffective, 3200, 'Gravekey trims 800 ms off the channel');
  assert.equal(make({ loadout: { channelMsDelta: -9000 } }).channelMsEffective, CHANNEL.channelMsFloor, 'the channel floor holds');

  const spawner = make();
  const gateA = GATES[0]!;
  assert.equal(spawner.spawnSuppressed(gateA.x, gateA.y), false, 'a closed gate suppresses nothing');
  run(spawner, a.openS + 5, SPAWN.x, SPAWN.y);
  assert.equal(spawner.spawnSuppressed(gateA.x, gateA.y), true, 'an open gate suppresses its pocket');
  assert.equal(spawner.spawnSuppressed(gateA.x + CHANNEL.suppressRadius + 1, gateA.y), false, 'suppression stops at suppressRadius');
  run(spawner, a.closeS + 1, SPAWN.x, SPAWN.y);
  assert.equal(spawner.spawnSuppressed(gateA.x, gateA.y), false, 'a spent gate stops suppressing');
}

// --- BLOCKER 2: the Collapse ring closes on the player ----------------------
{
  const gateC = GATES[2]!;
  const park = { x: gateC.x - 1500, y: gateC.y };
  let ignitions = 0;
  const sys = make({ onEvent: (e) => { if (e === 'collapse') ignitions += 1; } });
  run(sys, TUNING.collapse.atS - 1, park.x, park.y);
  assert.equal(sys.collapse === null, true, 'no ring before collapseAtS');
  run(sys, TUNING.collapse.atS + 1, park.x, park.y);
  assert.ok(sys.collapse?.active === true, 'the Collapse ignites at collapseAtS');
  assert.equal(ignitions, 1, 'the collapse event fires once');

  const dist = Math.hypot(park.x - gateC.x, park.y - gateC.y);
  const expectedStart = Math.min(COLLAPSE.maxStart, Math.max(COLLAPSE.minStart, dist + COLLAPSE.startPad));
  assert.equal(sys.collapseRingStartRadius, expectedStart, 'the start radius is latched off the player');
  assert.deepEqual(sys.collapseRingCenter, { x: gateC.x, y: gateC.y }, 'the ring is centred on Gate C');

  let contactS = -1;
  let prevRadius = Infinity;
  while (sys.elapsedS < TUNING.collapse.atS + 90) {
    sys.update(16, park.x, park.y, false);
    const ring: { active: boolean; ringRadius: number } = sys.collapse!;
    assert.ok(ring.ringRadius <= prevRadius + 1e-9, 'the ring radius is monotonically non-increasing');
    prevRadius = ring.ringRadius;
    if (contactS < 0 && dist > ring.ringRadius) contactS = sys.collapseElapsedS;
  }
  assert.ok(contactS > 0, 'the fire reaches a stationary player (blocker 2)');
  assert.ok(contactS < 20, `first fire contact reads as an ending (${contactS.toFixed(1)} s past ignition)`);
  assert.equal(sys.collapse!.ringRadius, COLLAPSE.minRadius, 'the ring HOLDS at minRadius');

  // §2.3: a maxStart ring still closes in ≤ 30 s at the ramped speed.
  const far = make();
  run(far, TUNING.collapse.atS + 1, SPAWN.x, SPAWN.y);
  assert.equal(far.collapseRingStartRadius, COLLAPSE.maxStart, 'a far player latches maxStart');
  run(far, TUNING.collapse.atS + 30, SPAWN.x, SPAWN.y);
  assert.ok(far.collapse!.ringRadius <= COLLAPSE.minRadius + 1, `a ${COLLAPSE.maxStart} px ring closes within 30 s`);

  assert.ok(sys.collapseFireDps <= COLLAPSE.fireDpsMax, 'fire dps respects its cap');
  assert.ok(sys.collapseFireDps > COLLAPSE.fireDps, 'fire dps has ramped past its base');
  assert.ok(sys.collapseThreatBonus >= COLLAPSE.threatStep * 8, 'threat keeps climbing, uncapped');
  assert.equal(sys.collapseEliteQuota, Math.floor(sys.collapseElapsedS / COLLAPSE.eliteEveryS), 'the elite quota is pure');

  const fine = make();
  const coarse = make();
  run(fine, TUNING.collapse.atS + 20, park.x, park.y, { dtMs: 8 });
  run(coarse, TUNING.collapse.atS + 20, park.x, park.y, { dtMs: 50 });
  assert.ok(Math.abs(fine.collapse!.ringRadius - coarse.collapse!.ringRadius) < 8, 'ring geometry is tick-size invariant');

  // A player camped ON Gate C is never burned out of the extraction spot.
  const camper = make({ tuning: { collapseAtS: TUNING.gate.c.openS } });
  run(camper, TUNING.gate.c.openS + 60, gateC.x, gateC.y, { hitEveryMs: INVULN_MS });
  assert.ok(camper.extracted, 'Gate C remains extractable inside the held ring');
}

// --- extraction ends the run once, and freezes the system -------------------
{
  const gateA = GATES[0]!;
  let extractions = 0;
  const sys = make({ onEvent: (e) => { if (e === 'extracted') extractions += 1; } });
  run(sys, TUNING.gate.a.openS + 10, gateA.x, gateA.y);
  assert.ok(sys.extracted && sys.extractedGate === 'a', 'Gate A extraction is attributed to Gate A');
  const frozenAt = sys.elapsedS;
  run(sys, 500, gateA.x, gateA.y);
  assert.equal(sys.elapsedS, frozenAt, 'update is inert after extraction');
  assert.equal(extractions, 1, 'the extracted event fires exactly once');
  assert.equal(sys.gateState('a'), 'spent', 'a used gate is spent');
}

console.log('extraction selftest OK');
