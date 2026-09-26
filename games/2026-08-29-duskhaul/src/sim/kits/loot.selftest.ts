// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/loot.selftest.ts
//
// WS-Loot invariants (PRD-V2 §19 Loot row + §5.12-5.14, §5.16, §5.25-5.27):
//   - bag grid packing/unpacking (2-cell items, swap rule, casket) + bulk seeded census,
//   - settle: extracted keeps all, died keeps casket + deathKeepPct of shards,
//   - conditional gates (Toll / Offering / Bell) open, charge and close per §5.25,
//   - greedMul(300) = 1.1, greedMul(480) = 1.5,
//   - breakable drop table, valuable tier shift, belt use side, POI runtime.
import assert from 'node:assert/strict';
import type Phaser from 'phaser';
import { TUNING } from '../../config';
import { Rng } from '../../core/rng';
import { Belt, CONSUMABLES, pickupDef, rollBreakableDrop } from '../../data/pickups';
import { poiDef } from '../../data/pois';
import type {
  EventKind,
  GateCandidate,
  GeneratedMap,
  GearInstance,
  LootItem,
  PoiAnchor,
  PoiKind,
  PoiSpawnSpec,
  Rarity,
  RunLoadoutV2,
} from '../../data/types-v2';
import { VALUABLES, rollValuable, valuableDef } from '../../data/valuables';
import { zoneDef } from '../../data/zones';
import { BreakableField } from '../../objects/breakable';
import { Bag, itemValue } from '../../systems/bag';
import { ExtractionSystem, greedMul, type ExtractionTuning } from '../../systems/extraction';
import { PoiSystem, type PoiCallbacks } from '../../systems/poi';

// ─── fixtures ───

let uidSeq = 0;
function gear(rarity: Rarity): LootItem {
  uidSeq += 1;
  const item: GearInstance = { uid: `g${uidSeq}`, base: 'ash-locket', slot: 'amulet', rarity, level: 1, affixes: [] };
  return { kind: 'gear', item };
}
function valuable(id: string): LootItem {
  uidSeq += 1;
  return { kind: 'valuable', item: { uid: `v${uidSeq}`, id } };
}
const BAG_TUNING = TUNING.bag;
const newBag = (cells = 12, casketSlots = 1): Bag => new Bag({ cells, casketSlots }, BAG_TUNING);

function loadout(over: Partial<RunLoadoutV2> = {}): RunLoadoutV2 {
  return {
    zone: 'castle', hazard: 1, mode: 'normal', seed: 's', mutators: [], classId: 'duskhauler', startWeapon: 'bolt',
    modifiers: [], unlockedWeapons: ['bolt'], unlockedCharms: [], bagCells: 12, casketSlots: 1,
    deathKeepPct: 25, greedMaxMul: 1.5, tollPct: 0.25, rerollsPerRun: 2, banishesPerRun: 0, startLevel: 1, startDreadKeys: 0,
    reviveCharges: 0, reviveHpRatio: 0, reviveImmunityMs: 0, iframesMsBonus: 0, gateWindowBonusS: 0, channelMsDelta: 0,
    contestedRate: 0.7, previewS: 60, minimapRevealPx: 900, speedNearGateMul: 1, gloamwalkMs: 0, gravePact: false,
    fenceChance: 0.6, fenceTrades: 1, veinMul: 1, veinStandMs: 3000, breakableDropMul: 1, eliteExtraValuables: 0,
    belt: [null, null], uniques: [], threatMul: 1, lootBias: 0, itemLevel: 1,
    hazardExtras: { eliteExtraAffix: false, forcedAffix: null, collapseAtS: 480, bossPhaseAt: [0.66, 0.33] }, mercy: false,
    ...over,
  };
}

/** Census invariant: every grid item occupies in-bounds, non-overlapping cells; pairs stay on one row. */
function assertGrid(bag: Bag, label: string): void {
  const v = bag.view();
  const taken = new Set<number>();
  let used = 0;
  for (const it of v.items) {
    assert.ok(it.row >= 0 && it.col >= 0, `${label}: ${it.uid} unplaced`);
    for (let c = 0; c < it.cells; c += 1) {
      const idx = it.row * v.cols + it.col + c;
      assert.ok(it.col + c < v.cols && idx < v.cells, `${label}: ${it.uid} out of grid`);
      assert.ok(!taken.has(idx), `${label}: cell ${idx} double-booked`);
      taken.add(idx);
    }
    used += it.cells;
  }
  assert.equal(v.used, used, `${label}: used census`);
  assert.ok(v.used <= v.cells, `${label}: over capacity`);
  assert.ok(v.casket.length <= v.casketSlots, `${label}: casket over slots`);
  assert.equal(v.full, v.used >= v.cells);
}

// ─── content tables ───

assert.equal(VALUABLES.length, 24, '24 valuables');
assert.equal(new Set(VALUABLES.map((v) => v.id)).size, 24, 'valuable ids unique');
assert.deepEqual([1, 2, 3, 4, 5].map((t) => VALUABLES.filter((v) => v.tier === t).length), [4, 5, 6, 5, 4]);
assert.equal(valuableDef('v_gravecrown').value, 400);
assert.equal(valuableDef('v_ashurn').cells, 2);
for (const id of ['pk_bread', 'pk_bell', 'pk_flask', 'pk_salt'] as const) assert.equal(pickupDef(id).id, id);
assert.deepEqual(CONSUMABLES.map((c) => [c.id, c.price]), [['cb_bread', 40], ['cb_flask', 60], ['cb_salt', 50], ['cb_candle', 120], ['cb_oil', 45]]);
const kinds: PoiKind[] = ['chest_t1', 'chest_t2', 'chest_t3', 'vault', 'lair', 'den', 'shrine_blood', 'shrine_gilt', 'shrine_bone', 'shrine_grave', 'shrine_curse', 'vein', 'lore', 'bell', 'fence', 'event_yard'];
for (const k of kinds) assert.equal(poiDef(k).kind, k, `POI row for ${k}`);

// ─── bag: packing ───
{
  const bag = newBag();
  // Six 2-cell valuables exactly fill a 4×3 grid (2 pairs per row).
  for (let i = 0; i < 6; i += 1) assert.ok(bag.add(valuable('v_ashurn')).accepted, `pair ${i} fits`);
  assertGrid(bag, 'six pairs');
  assert.equal(bag.view().used, 12);
  // A 7th item swaps only when worth more than the cheapest freeing set.
  const tallow = valuable('v_tallowstub');
  const cheap = bag.add(tallow); // 20 < 45 (one pair must go)
  assert.equal(cheap.accepted, false);
  assert.equal(cheap.refused, tallow, 'refused item stays on the ground');
  assert.equal(cheap.dropped.length, 0);
  const rich = bag.add(valuable('v_gildedicon')); // 120 > 45
  assert.ok(rich.accepted);
  assert.equal(rich.dropped.length, 1);
  assert.equal(rich.dropped[0]!.kind === 'valuable' ? valuableDef(rich.dropped[0]!.item.id).cells : 0, 2);
  assertGrid(bag, 'after swap');
  assert.equal(bag.view().used, 11);
}
{
  // Mixed singles fragment rows, but auto-pack always places a pair when counts allow.
  const bag = newBag();
  for (let i = 0; i < 4; i += 1) bag.add(gear(1));
  for (let i = 0; i < 4; i += 1) assert.ok(bag.add(valuable('v_psalter')).accepted);
  assertGrid(bag, 'mixed');
  assert.equal(bag.view().used, 12);
  // Odd-width grid: 13 cells = rows 4/4/4/1 → only 6 pairs fit.
  const odd = newBag(13);
  for (let i = 0; i < 6; i += 1) assert.ok(odd.add(valuable('v_ashurn')).accepted);
  assert.ok(odd.add(gear(1)).accepted, 'single fills the 1-wide row');
  assertGrid(odd, 'odd');
  // Full: swap rule picks the cheapest freeing SET (gear 30 alone cannot free a pair slot).
  const r = odd.add(valuable('v_psalter'));
  assert.ok(r.accepted);
  assert.equal(r.dropped.length, 1, 'one pair (45) is the cheapest freeing set');
  assertGrid(odd, 'odd swap');
}
{
  // Swap rule across singles: 12 Tarnished gear (30 each) vs a 2-cell item.
  const bag = newBag();
  for (let i = 0; i < 12; i += 1) bag.add(gear(1));
  assert.equal(bag.add(valuable('v_ashurn')).accepted, false, '45 ≤ 60 refused');
  const r = bag.add(valuable('v_psalter'));
  assert.ok(r.accepted, '90 > 60 swaps');
  assert.equal(r.dropped.length, 2);
  assertGrid(bag, 'singles swap');
  // Equal value is NOT strictly greater.
  const eq = newBag(2);
  eq.add(gear(1));
  eq.add(gear(1));
  assert.equal(eq.add(gear(2)).accepted, true, '60 > 30');
  assert.equal(eq.add(gear(1)).accepted, false, '30 = 30 refused');
}

// ─── bag: casket ───
{
  const bag = newBag(4, 1);
  const a = valuable('v_giltchalice'); // 2 cells, 260
  const b = gear(1);
  const c = gear(1);
  bag.add(a);
  bag.add(b);
  bag.add(c);
  assert.equal(bag.view().used, 4);
  assert.ok(bag.pin(a.item.uid), 'pin into empty casket');
  assert.equal(bag.view().used, 2, 'pinning frees grid cells');
  assert.equal(bag.view().casket[0]?.uid, a.item.uid);
  // Pinned items are never swap victims.
  bag.add(gear(1));
  bag.add(gear(1));
  const r = bag.add(valuable('v_duskgem'));
  assert.ok(r.accepted);
  assert.ok(!r.dropped.some((d) => d.item.uid === a.item.uid), 'casket item never dropped');
  // Full casket: pin swaps the old pin back only if the grid can hold it (2 cells into a full 4-grid: no).
  assert.equal(bag.pin(b.item.uid), false, 'swap refused when the returning pair cannot fit');
  // takeHighestValue skips the casket.
  const top = bag.takeHighestValue();
  assert.equal(top?.kind === 'valuable' ? top.item.id : '', 'v_duskgem');
  assert.ok(bag.pin(b.item.uid), 'now the returning pair fits');
  assert.equal(bag.view().casket[0]?.uid, b.item.uid);
  assertGrid(bag, 'casket swap');
  bag.unpin(b.item.uid);
  assert.equal(bag.view().casket.length, 1, 'unpin into a full grid keeps the pin');
  assert.ok(bag.drop(b.item.uid) !== null);
  assert.equal(bag.view().casket.length, 0);
  // Casket nudge fires exactly once when a Gilded+ item is carried with an empty casket.
  const n = newBag();
  n.add(gear(2));
  assert.equal(n.casketNudgeDue(), false);
  n.add(gear(4));
  assert.equal(n.casketNudgeDue(), true);
  assert.equal(n.casketNudgeDue(), false);
}

// ─── bag: bulk seeded census (uid conservation, grid law) ───
for (let seed = 0; seed < 200; seed += 1) {
  const rng = new Rng(`bag:${seed}`);
  const bag = newBag(12 + 2 * rng.int(0, 2), 1 + rng.int(0, 1));
  const held = new Set<string>();
  for (let step = 0; step < 60; step += 1) {
    const op = rng.int(0, 9);
    if (op <= 5) {
      const item = rng.chance(0.5) ? gear(rng.int(1, 5) as Rarity) : valuable(rng.pick(VALUABLES).id);
      const res = bag.add(item);
      if (res.accepted) held.add(item.item.uid);
      for (const d of res.dropped) {
        assert.ok(held.delete(d.item.uid), 'dropped item was held');
        assert.ok(!bag.view().casket.some((c) => c.uid === d.item.uid), 'casket never a victim');
      }
      if (res.accepted && res.dropped.length > 0) {
        assert.ok(itemValue(item) > res.dropped.reduce((s, d) => s + itemValue(d), 0), 'swap only when strictly worth more');
      }
    } else {
      const v = bag.view();
      const all = [...v.items, ...v.casket];
      if (all.length === 0) continue;
      const pick = rng.pick(all);
      if (op === 6) bag.pin(pick.uid);
      else if (op === 7) bag.unpin(pick.uid);
      else if (op === 8 && bag.drop(pick.uid) !== null) held.delete(pick.uid);
      else {
        const t = bag.takeHighestValue();
        if (t !== null) held.delete(t.item.uid);
      }
    }
    assertGrid(bag, `seed ${seed} step ${step}`);
    const bv = bag.view();
    const now = [...bv.items, ...bv.casket].map((i) => i.uid);
    assert.equal(now.length, held.size, `seed ${seed}: uid census`);
    for (const u of now) assert.ok(held.has(u));
  }
}

// ─── settle (§2.4, §5.26) ───
{
  const mk = (): { bag: Bag; pinned: LootItem; loose: LootItem[] } => {
    const bag = newBag();
    const pinned = valuable('v_crownshard');
    const loose = [gear(3), valuable('v_psalter'), gear(1)];
    bag.add(pinned);
    for (const l of loose) bag.add(l);
    bag.pin(pinned.item.uid);
    bag.addShards(333);
    return { bag, pinned, loose };
  };
  const rng = new Rng('settle');
  const ex = mk();
  const s1 = ex.bag.settle('extracted', { deathKeepPct: 25, greedMul: 1.3, gravePact: false, rng });
  assert.equal(s1.shardsBanked, Math.floor(333 * 1.3));
  assert.equal(s1.shardsLost, 0);
  assert.equal(s1.kept.length, 4, 'extracted keeps all');
  assert.equal(s1.lost.length, 0);
  assert.equal(s1.greedMul, 1.3);
  for (const outcome of ['died', 'abandoned'] as const) {
    const d = mk();
    const s = d.bag.settle(outcome, { deathKeepPct: 25, greedMul: 1.5, gravePact: false, rng });
    assert.equal(s.shardsBanked, Math.floor(333 * 0.25), `${outcome}: tithe`);
    assert.equal(s.shardsBanked + s.shardsLost, 333);
    assert.equal(s.greedMul, 1, 'greed never applies to a death');
    assert.deepEqual(s.kept.map((k) => k.item.uid), [d.pinned.item.uid], `${outcome}: only casket kept`);
    assert.equal(s.lost.length, 3);
  }
  const g = mk();
  const sg = g.bag.settle('died', { deathKeepPct: 55, greedMul: 1, gravePact: true, rng });
  assert.equal(sg.kept.length, 2, 'Grave Pact keeps one extra bag item');
  assert.equal(sg.lost.length, 2);
  assert.equal(sg.shardsBanked, Math.floor(333 * 0.55));
  // Toll (§5.25): 25% min 40; unaffordable ⇒ 0 and nothing deducted.
  const t = newBag();
  t.addShards(1000);
  assert.equal(t.payToll(0.25, 40), 250);
  assert.equal(t.shards, 750);
  const t2 = newBag();
  t2.addShards(100);
  assert.equal(t2.payToll(0.25, 40), 40);
  const t3 = newBag();
  t3.addShards(30);
  assert.equal(t3.payToll(0.25, 40), 0);
  assert.equal(t3.shards, 30);
}

// ─── greed (§5.26, economy retune: +5% per 48 s after 240 s, cap ×1.25 / ×1.4 with g_greedcap) ───
assert.equal(greedMul(0, TUNING.greed.maxMul), 1);
assert.equal(greedMul(TUNING.greed.startS, TUNING.greed.maxMul), 1);
assert.equal(greedMul(300, TUNING.greed.maxMul), 1.05, 'greedMul(300) = 1.05');
assert.equal(greedMul(480, TUNING.greed.maxMul), 1.25, 'greedMul(480) = 1.25');
assert.equal(greedMul(900, TUNING.greed.maxMul), TUNING.greed.maxMul, 'capped at maxMul');
assert.equal(greedMul(900, 1.4), 1.4, 'g_greedcap cap');
for (let t = 0; t < 800; t += 7) assert.ok(greedMul(t + 7, 1.75) >= greedMul(t, 1.75), 'monotone');

// ─── conditional gates (§5.25) ───
function gates(kind: GateCandidate['kind']): GateCandidate[] {
  const x = kind === 'toll' ? { opensS: TUNING.gates.toll.opensS, closesS: TUNING.gates.toll.closesS }
    : kind === 'offering' ? { opensS: TUNING.gates.offering.opensS, closesS: null }
    : { opensS: 0, closesS: null };
  return [
    { id: 'a', kind: 'timed', x: 1000, y: 0, depth: 0, opensS: TUNING.gate.a.openS, closesS: TUNING.gate.a.closeS },
    { id: 'b', kind: 'timed', x: 2000, y: 0, depth: 1, opensS: TUNING.gate.b.openS, closesS: TUNING.gate.b.closeS },
    { id: 'c', kind: 'timed', x: 4000, y: 0, depth: 2, opensS: TUNING.gate.c.openS, closesS: null },
    { id: 'x', kind, x: 0, y: 3000, depth: 1, ...x },
  ];
}
const XT: ExtractionTuning = { channelMs: TUNING.extract.channelMs, radius: TUNING.gate.radius, collapseAtS: TUNING.collapse.atS, closingWarnS: TUNING.gate.closingWarnS };
function runTo(sys: ExtractionSystem, fromS: number, toS: number, px: number, py: number): void {
  for (let t = fromS; t < toS; t += 0.1) sys.update(100, px, py, false, { enemies: 0, elites: 0 });
}
{
  // Timed windows + closing warn.
  const events: string[] = [];
  const sys = new ExtractionSystem(gates('toll'), XT, loadout(), { payCondition: () => true, onEvent: (e, g) => events.push(`${e}:${g?.id ?? '-'}`) });
  runTo(sys, 0, 89, -5000, -5000);
  assert.equal(sys.state('a'), 'closed');
  assert.equal(sys.state('x'), 'closed');
  runTo(sys, 89, 91, -5000, -5000);
  assert.equal(sys.state('a'), 'open');
  assert.equal(sys.state('x'), 'open', 'toll opens 90 s');
  runTo(sys, 91, 160, -5000, -5000);
  assert.equal(sys.state('a'), 'closing', 'closing inside 25 s');
  runTo(sys, 160, 181, -5000, -5000);
  assert.equal(sys.state('a'), 'spent');
  assert.ok(events.includes('gate-open:a') && events.includes('gate-close:a'));
  assert.match(sys.view().find((g) => g.id === 'x')!.label, /^TOLL 25%/);
}
{
  // Toll: condition charged exactly once at channel START; refusal blocks until re-entry.
  let asks = 0;
  let allow = false;
  const sys = new ExtractionSystem(gates('toll'), XT, loadout(), {
    payCondition: (g) => {
      assert.equal(g.kind, 'toll');
      asks += 1;
      return allow;
    },
    onEvent: () => {},
  });
  runTo(sys, 0, 95, -5000, -5000);
  runTo(sys, 95, 100, 0, 3000);
  assert.equal(asks, 1, 'refused payment asked once while standing');
  assert.equal(sys.channelProgress, 0);
  allow = true;
  runTo(sys, 100, 101, -5000, -5000);
  runTo(sys, 101, 102, 0, 3000);
  assert.equal(asks, 2, 're-entry asks again');
  runTo(sys, 102, 106, 0, 3000);
  assert.ok(sys.extracted, 'paid toll channel completes');
  assert.equal(sys.extractedGate, 'x');
  assert.equal(sys.extractedGateKind, 'toll');
  assert.equal(asks, 2, 'never charged twice');
  // Unused toll closes at 480.
  const late = new ExtractionSystem(gates('toll'), XT, loadout(), { payCondition: () => true, onEvent: () => {} });
  runTo(late, 0, 481, -5000, -5000);
  assert.equal(late.state('x'), 'spent', 'toll closes 480 s');
}
{
  // Offering: opens 180, never closes; condition = sacrifice (hook), charged once.
  let asks = 0;
  const sys = new ExtractionSystem(gates('offering'), XT, loadout(), { payCondition: () => (asks += 1) > 0, onEvent: () => {} });
  runTo(sys, 0, 179, -5000, -5000);
  assert.equal(sys.state('x'), 'closed');
  runTo(sys, 179, 700, -5000, -5000);
  assert.equal(sys.state('x'), 'open', 'offering never closes');
  runTo(sys, 700, 705, 0, 3000);
  assert.ok(sys.extracted);
  assert.equal(asks, 1);
}
{
  // Bell: closed until both bells rung; open 60 s (+ Duskmirror bonus); channel needs no payment.
  let asks = 0;
  const sys = new ExtractionSystem(gates('bell'), XT, loadout({ gateWindowBonusS: 20 }), { payCondition: () => (asks += 1) > 0, onEvent: () => {} });
  runTo(sys, 0, 200, -5000, -5000);
  assert.equal(sys.state('x'), 'closed', 'bell gate ignores the clock');
  sys.ringBell();
  runTo(sys, 200, 201, -5000, -5000);
  assert.equal(sys.state('x'), 'closed', 'one bell is not enough');
  assert.match(sys.view().find((g) => g.id === 'x')!.label, /BELLS 1\/2/);
  sys.ringBell();
  runTo(sys, 201, 202, -5000, -5000);
  assert.equal(sys.state('x'), 'open', 'both bells ⇒ open');
  runTo(sys, 202, 201 + TUNING.gates.bell.openS + 20 - 1, -5000, -5000);
  assert.notEqual(sys.state('x'), 'spent', 'still open just before openS + bonus');
  runTo(sys, 201 + TUNING.gates.bell.openS + 20 - 1, 201 + TUNING.gates.bell.openS + 20 + 0.5, -5000, -5000);
  assert.equal(sys.state('x'), 'spent', 'bell gate closes openS (+bonus) after opening');
  assert.equal(asks, 0);
  // Timed windows come pre-widened from mapgen: the bonus is NOT added a second time.
  const a = new ExtractionSystem(gates('bell'), XT, loadout({ gateWindowBonusS: 20 }), { payCondition: () => true, onEvent: () => {} });
  runTo(a, 0, TUNING.gate.a.closeS + 0.5, -5000, -5000);
  assert.equal(a.state('a'), 'spent', 'candidate closesS is authoritative');
}
{
  // Collapse clamp scaled per TUNING (§2.3): start radius within [minStart, maxStart].
  let collapsed = 0;
  const far = new ExtractionSystem(gates('toll'), XT, loadout(), { payCondition: () => true, onEvent: (e) => { if (e === 'collapse') collapsed += 1; } });
  runTo(far, 0, 481, 0, 6000);
  assert.equal(collapsed, 1);
  assert.equal(far.collapseRingStartRadius, TUNING.collapse.maxStart);
  const near = new ExtractionSystem(gates('toll'), XT, loadout(), { payCondition: () => true, onEvent: () => {} });
  runTo(near, 0, 481, 4000, 400);
  assert.equal(near.collapseRingStartRadius, TUNING.collapse.minStart);
  // The ring only shrinks, never below minRadius (closing-time law lives in extraction.selftest).
  let prev = far.collapse!.ringRadius;
  for (let s = 0; s < 120; s += 1) {
    runTo(far, 481 + s, 482 + s, 0, 6000);
    const r = far.collapse!.ringRadius;
    assert.ok(r <= prev && r >= TUNING.collapse.minRadius, 'ring shrinks monotonically to minRadius');
    prev = r;
  }
  assert.ok(prev < TUNING.collapse.maxStart, 'ring moved');
}

// ─── breakable drop table (§5.13) ───
{
  const tally = (mul: number, seed: string, lowHp = false): Record<string, number> => {
    const rng = new Rng(seed);
    const out: Record<string, number> = {};
    const N = 40000;
    for (let i = 0; i < N; i += 1) {
      const d = rollBreakableDrop(rng, mul, lowHp);
      const k = d === null ? 'none' : d.kind === 'pickup' ? d.id : d.kind;
      out[k] = (out[k] ?? 0) + 1 / N;
      if (d?.kind === 'shards') assert.ok(d.coins >= TUNING.breakable.drops.shards.coins[0] && d.coins <= TUNING.breakable.drops.shards.coins[1]);
      if (d?.kind === 'item') assert.equal(d.tierBias, -1);
    }
    return out;
  };
  const base = tally(1, 'brk');
  const expect: Record<string, number> = { shards: 0.61, xp: 0.15, pk_bread: 0.04, pk_bell: 0.06, pk_flask: 0.05, pk_salt: 0.05, item: 0.04 };
  for (const [k, p] of Object.entries(expect)) assert.ok(Math.abs((base[k] ?? 0) - p) < 0.01, `drop ${k} ≈ ${p} (got ${base[k]})`);
  assert.equal(base.none ?? 0, 0, 'mul 1 always drops');
  const boosted = tally(1.3, 'brk');
  assert.ok(Math.abs((boosted.item ?? 0) - 0.052) < 0.006, 'g_breakable scales non-shard chances');
  assert.ok(Math.abs((boosted.shards ?? 0) - 0.493) < 0.01, 'shards take the remainder');
  // Critic v2c M1: bread chance rises below `lowHpRatio` HP (difficulty pass: 8%).
  const low = tally(1, 'brk', true);
  const lowBread = TUNING.breakable.drops.pk_bread.lowHpChance;
  assert.ok(Math.abs((low.pk_bread ?? 0) - lowBread) < 0.01, `low-HP bread ≈ ${lowBread} (got ${low.pk_bread})`);
  assert.equal(low.none ?? 0, 0);
  const r1 = new Rng('det');
  const r2 = new Rng('det');
  for (let i = 0; i < 500; i += 1) assert.deepEqual(rollBreakableDrop(r1, 1), rollBreakableDrop(r2, 1), 'deterministic');
}

// ─── valuable tier shift (§5.14) ───
{
  const rng = new Rng('val');
  for (let i = 0; i < 2000; i += 1) assert.ok(valuableDef(rollValuable(rng, 3, 'castle').id).tier >= 4, 'bias 3 ⇒ tier ≥ 4');
  for (let i = 0; i < 2000; i += 1) assert.ok(valuableDef(rollValuable(rng, 10, 'castle').id).tier === 5, 'overflow lands on t5');
  const counts = [0, 0, 0, 0, 0];
  for (let i = 0; i < 20000; i += 1) counts[valuableDef(rollValuable(rng, 0, 'castle').id).tier - 1]! += 1;
  // Castle's §5.29 +0.25 loot-bias points move a quarter of each [46,30,16,6,2] weight up one tier.
  assert.equal(zoneDef('castle').lootBias, 0.25);
  [34.5, 34, 19.5, 8.5, 3.5].forEach((p, i) => assert.ok(Math.abs(counts[i]! / 200 - p) < 1.5, `tier ${i + 1} ≈ ${p}%`));
}

// ─── belt use side (§5.27) ───
{
  const belt = new Belt([{ id: 'cb_bread', charges: 2 }, { id: 'cb_candle', charges: 1 }]);
  assert.deepEqual(belt.use(0, { maxHp: 150, itemsPickedUp: 0 }), { kind: 'heal', hp: 60 });
  assert.equal(belt.use(0, { maxHp: 150, itemsPickedUp: 0 }), null, 'lockout blocks the double tap');
  belt.update(1000);
  assert.ok(belt.use(0, { maxHp: 150, itemsPickedUp: 0 }) !== null);
  assert.equal(belt.view()[0], null, 'emptied slot clears');
  assert.equal(belt.use(1, { maxHp: 150, itemsPickedUp: 1 }), null, 'Ward Candle only before the first pickup');
  assert.deepEqual(belt.use(1, { maxHp: 150, itemsPickedUp: 0 }), { kind: 'casket', slots: 1 });
  assert.deepEqual(belt.used(), ['cb_bread', 'cb_bread', 'cb_candle']);
  const bag = newBag(12, 1);
  bag.addCasketSlots(1);
  assert.equal(bag.view().casketSlots, 2);
}

// ─── POI runtime (stub scene; logic only) ───
const stubImage: unknown = new Proxy(() => stubImage, { get: (_t, p) => (p === 'then' ? undefined : () => stubImage) });
const stubScene = {
  textures: { exists: () => false },
  anims: { exists: () => false },
  add: { image: () => stubImage },
} as unknown as Phaser.Scene;

function anchor(id: string, kind: PoiKind, x: number, y: number, depth: 0 | 1 | 2 = 1): PoiAnchor {
  return { id, kind, x, y, radius: poiDef(kind).clearingRadius, depth, region: 0 };
}
function testMap(gateKind: GateCandidate['kind']): GeneratedMap {
  return {
    zone: 'castle',
    width: 6144,
    height: 6144,
    gates: gates(gateKind),
    pois: [
      anchor('c1', 'chest_t1', 500, 500, 0),
      anchor('c3', 'chest_t3', 900, 500, 2),
      anchor('vault', 'vault', 1500, 500, 2),
      anchor('den', 'den', 3000, 3000, 2),
      anchor('lair1', 'lair', 5000, 5000, 1),
      anchor('bell1', 'bell', 100, 4000),
      anchor('bell2', 'bell', 400, 4000),
      anchor('vein', 'vein', 2000, 500),
      anchor('l1', 'lore', 100, 100),
      anchor('l2', 'lore', 200, 100),
      anchor('l3', 'lore', 300, 100),
      anchor('l4', 'lore', 400, 100),
      anchor('fence', 'fence', 2500, 2500),
      anchor('sh', 'shrine_grave', 2700, 500),
      anchor('y1', 'event_yard', 500, 1000),
      anchor('y2', 'event_yard', 5000, 1000),
      anchor('y3', 'event_yard', 5000, 3000),
      anchor('y4', 'event_yard', 1000, 5500),
    ],
  } as unknown as GeneratedMap;
}
interface Log { loot: { items: LootItem[]; shards: number; source: string }[]; spawns: PoiSpawnSpec[]; events: string[]; bells: number[]; lore: string[]; den: boolean[]; fence: number; shrines: string[]; veins: number[]; chests: boolean[] }
function makePoi(seed: string, gateKind: GateCandidate['kind'], lo: RunLoadoutV2 = loadout()): { poi: PoiSystem; log: Log } {
  const log: Log = { loot: [], spawns: [], events: [], bells: [], lore: [], den: [], fence: 0, shrines: [], veins: [], chests: [] };
  const cb: PoiCallbacks = {
    onLoot: (items, shards, _x, _y, source) => log.loot.push({ items, shards, source }),
    onEliteChest: (_x, _y, boss) => log.chests.push(boss),
    onShrine: (k) => log.shrines.push(k),
    onEvent: (k: EventKind, phase) => log.events.push(`${k}:${phase}`),
    onFence: (offers) => (log.fence = offers.length),
    onVein: (s) => log.veins.push(s),
    onLore: (id) => log.lore.push(id),
    onBell: (n) => log.bells.push(n),
    requestSpawn: (spec) => {
      log.spawns.push(spec);
      return [];
    },
    onDenLock: (l) => log.den.push(l),
  };
  const map = testMap(gateKind);
  return { poi: new PoiSystem(stubScene, map, { rng: new Rng(seed), zone: { id: 'castle' } as never, loadout: lo, callbacks: cb }), log };
}
const clear = (): { enemies: number; elites: number } => ({ enemies: 0, elites: 0 });
function tick(poi: PoiSystem, ms: number, x: number, y: number, hit = false): void {
  for (let t = 0; t < ms; t += 50) poi.update(50, { x, y }, clear, hit);
}
{
  const { poi, log } = makePoi('poi:1', 'bell');
  // Chest t1: 1.5 s clean channel ⇒ 1 item + 20-35 ◆.
  tick(poi, 1400, 500, 500);
  assert.equal(log.loot.length, 0, 'not before 1.5 s');
  tick(poi, 200, 500, 500);
  assert.equal(log.loot.length, 1);
  assert.equal(log.loot[0]!.items.length, 1);
  assert.ok(log.loot[0]!.shards >= 20 && log.loot[0]!.shards <= 35);
  tick(poi, 3000, 500, 500);
  assert.equal(log.loot.length, 1, 'a chest opens once');
  // Exploration XP (critic M4): one burst per completed POI, drained once, deeper = bigger.
  const b1 = poi.takeXpBursts();
  assert.equal(b1.length, 1, 'chest t1 queues one XP burst');
  assert.ok(b1[0]!.xp > 0 && b1[0]!.x === 500 && b1[0]!.y === 500);
  assert.deepEqual(poi.takeXpBursts(), [], 'bursts drain once');
  // Chest t3 under hits: setback keeps it open longer than 2.5 s but it completes; 2 items + 4 guards.
  tick(poi, 2500, 900, 500, true);
  assert.equal(log.loot.length, 1, 'constant hits stall the channel');
  tick(poi, 2800, 900, 500);
  assert.equal(log.loot[1]!.items.length, 2);
  assert.equal(log.spawns.at(-1)!.entries[0]!.count, TUNING.poi.chest.t3.guards);
  const b3 = poi.takeXpBursts();
  assert.equal(b3.length, 1);
  assert.ok(b3[0]!.xp > b1[0]!.xp, 'depth-2 gilt chest pays more XP than a depth-0 rusted one');
  // Lore: exactly 3 of 4 stones active, ids distinct.
  for (const x of [100, 200, 300, 400]) tick(poi, 100, x, 100);
  assert.equal(log.lore.length, 3);
  assert.equal(new Set(log.lore).size, 3);
  // Bells (Bell Gate run): stand 2 s each ⇒ onBell(1), onBell(2) + 12-enemy wave each.
  tick(poi, 2100, 100, 4000);
  tick(poi, 2100, 400, 4000);
  assert.deepEqual(log.bells, [1, 2]);
  assert.equal(log.spawns.filter((s) => s.source.startsWith('bell:')).length, 2);
  // Vault without key: 12 s channel inside a density pocket ⇒ 2 Gilded+ gear + 1 t4 valuable.
  tick(poi, 12100, 1500, 500);
  const vault = log.loot.find((l) => l.source === 'vault')!;
  assert.ok(vault, 'vault opened');
  const vGear = vault.items.filter((i) => i.kind === 'gear');
  assert.equal(vGear.length, 2);
  for (const g of vGear) assert.ok(g.kind === 'gear' && g.item.rarity >= 4, 'vault gear min Gilded');
  const vVal = vault.items.find((i) => i.kind === 'valuable')!;
  assert.equal(vVal.kind === 'valuable' ? valuableDef(vVal.item.id).tier : 0, 4);
  assert.ok(log.spawns.some((s) => s.source.startsWith('vault:')), 'density pocket spawned');
  assert.ok(poi.stats().vaultOpened);
  // Elite kill ⇒ ground chest + 1 valuable; walk over ⇒ onEliteChest + 1 gear roll.
  poi.onKill({ defId: 'husk', name: 'Husk', x: 3000, y: 800, shards: 25, elite: 'hasted', boss: null, source: 'bolt' });
  assert.equal(log.loot.at(-1)!.source, 'elite');
  tick(poi, 50, 3000, 800);
  assert.deepEqual(log.chests, [false]);
  assert.equal(log.loot.at(-1)!.source, 'elite-chest');
  // Bread from elites (40%) and t2+ chests (50%) arrives through takePickups, drained once.
  poi.takePickups();
  let breads = 0;
  for (let i = 0; i < 400; i += 1) {
    poi.onKill({ defId: 'husk', name: 'Husk', x: 9000, y: 9000, shards: 25, elite: 'hasted', boss: null, source: 'bolt' });
    breads += poi.takePickups().filter((p) => p.id === 'pk_bread').length;
  }
  assert.ok(Math.abs(breads / 400 - TUNING.pickups.bread.eliteChance) < 0.08, `elite bread ≈ 40% (got ${breads / 400})`);
  assert.deepEqual(poi.takePickups(), []);
  // Den: opens at 240 s; entering r 480 spawns the zone mid-boss and locks 20 s.
  tick(poi, Math.max(0, 239000 - poi.elapsedS * 1000), 5800, 5800);
  tick(poi, 100, 3000, 3000);
  assert.deepEqual(log.den, [], 'den locked shut before 240 s');
  tick(poi, 1500, 5800, 5800);
  tick(poi, 100, 3000, 3000);
  assert.deepEqual(log.den, [true]);
  assert.equal(log.spawns.find((s) => s.source.startsWith('den:'))!.entries[0]!.defId, 'mb_castle');
  assert.ok(poi.denWalls().length === 4);
  tick(poi, TUNING.midboss.lockS * 1000 + 100, 3000, 3000);
  assert.deepEqual(log.den, [true, false], 'bone wall drops after lockS');
  // Events: 3 at eventTimesS, seeded order, all three kinds once.
  const started = log.events.filter((e) => e.endsWith(':start')).map((e) => e.split(':')[0]);
  assert.equal(new Set(started).size, started.length);
  assert.ok(started.length >= 2, 'events at 100 and 220 started');
}
{
  // Determinism: same seed ⇒ same event order, same loot uids.
  const a = makePoi('det', 'toll');
  const b = makePoi('det', 'toll');
  for (const s of [a, b]) {
    tick(s.poi, 1600, 500, 500);
    tick(s.poi, 345000, 6000, 6000);
  }
  assert.deepEqual(a.log.events, b.log.events);
  assert.deepEqual(a.log.loot.map((l) => l.items.map((i) => i.item.uid)), b.log.loot.map((l) => l.items.map((i) => i.item.uid)));
  // Non-bell run: bell anchors are inert.
  tick(a.poi, 2100, 100, 4000);
  assert.deepEqual(a.log.bells, []);
  // Lantern Oil reveal: undiscovered POIs show only while the reveal lasts.
  const f = makePoi('reveal', 'toll', loadout({ startDreadKeys: 1 }));
  tick(f.poi, 1000, 6000, 6000);
  assert.ok(!f.poi.minimap().some((p) => p.id === 'c1'), 'far chest undiscovered');
  f.poi.reveal(60000);
  assert.ok(f.poi.minimap().some((p) => p.id === 'c1'), 'revealed');
  tick(f.poi, 60100, 6000, 6000);
  assert.ok(!f.poi.minimap().some((p) => p.id === 'c1'), 'reveal expires');
  // Key opens the vault instantly.
  tick(f.poi, 50, 1500, 500);
  assert.ok(f.poi.stats().vaultOpened, 'Dread Key = instant vault');
  assert.equal(f.poi.dreadKeys, 0);
  // u_gravekey: vault opens instantly with no key, and no key is consumed.
  const gk = makePoi('gravekey', 'toll', loadout({ uniques: ['u_gravekey'] }));
  tick(gk.poi, 50, 1500, 500);
  assert.ok(gk.poi.stats().vaultOpened, 'Gravekey opens the vault without a Dread Key');
  assert.equal(gk.poi.dreadKeys, 0);
  const nk = makePoi('nokey', 'toll');
  tick(nk.poi, 50, 1500, 500);
  assert.ok(!nk.poi.stats().vaultOpened, 'no key, no Gravekey ⇒ must channel');
}
{
  // Fence visit: stand at the cart during its window.
  for (let s = 0; s < 20; s += 1) {
    const f = makePoi(`fence:${s}`, 'toll', loadout({ fenceChance: 1 }));
    tick(f.poi, 180000, 6000, 6000);
    for (let t = 0; t < 130 && f.log.fence === 0; t += 1) tick(f.poi, 1000, 2500, 2500);
    assert.equal(f.log.fence, 4, `seed ${s}: fence offers all 4 trades`);
    assert.equal(f.poi.stats().poisVisited, 1);
  }
}

{
  // Critic v2c M1: t2+ reliquaries drop Grave Bread 50%; a rusted t1 never does.
  let t3Bread = 0;
  let t1Bread = 0;
  const N = 80;
  for (let s = 0; s < N; s += 1) {
    const { poi } = makePoi(`bread:${s}`, 'toll');
    tick(poi, 1600, 500, 500);
    t1Bread += poi.takePickups().length;
    tick(poi, 2600, 900, 500);
    t3Bread += poi.takePickups().filter((p) => p.id === 'pk_bread').length;
  }
  assert.equal(t1Bread, 0, 't1 chests drop no bread');
  assert.ok(Math.abs(t3Bread / N - TUNING.pickups.bread.chestChance) < 0.15, `t3 bread ≈ 50% (got ${t3Bread / N})`);
}
{
  // BreakableField: lazy chunks, hero body smashes urns (bolt-only builds have no area hit),
  // destroyed state persists across despawn, low HP raises the bread chance.
  const scene = { textures: { exists: () => false }, add: { image: () => stubImage } } as unknown as Phaser.Scene;
  const breakables = Array.from({ length: 400 }, (_, i) => ({ x: 300 + (i % 20) * 10, y: 300 + Math.floor(i / 20) * 10, kind: 'urn' as const }));
  const far = { x: 5000, y: 5000, kind: 'crate' as const };
  const map = { zone: 'castle', width: 6144, height: 6144, breakables: [...breakables, far] } as unknown as GeneratedMap;
  const drops: string[] = [];
  const field = new BreakableField(scene, map, new Rng('field'), 1, (d) => drops.push(d.kind === 'pickup' ? d.id : d.kind));
  field.update({ x: 400, y: 400 });
  assert.equal(field.hitCircle(5000, 5000, 50), 0, 'unspawned chunk cannot be hit');
  field.update({ x: 400, y: 400 });
  assert.ok(field.broken > 0, 'walking into urns breaks them');
  const brokeAtFirst = field.broken;
  field.update({ x: 4000, y: 4000 });
  field.update({ x: 400, y: 400 });
  assert.equal(field.broken, brokeAtFirst, 'broken state persists; nothing re-breaks');
  assert.equal(drops.length, field.broken, 'every break drops something');
  // Low HP: bread share over a large sample.
  const low = { ...map, breakables: Array.from({ length: 4000 }, (_, i) => ({ x: 200 + (i % 60) * 2, y: 200 + Math.floor(i / 60) * 2, kind: 'urn' as const })) } as GeneratedMap;
  const lowDrops: string[] = [];
  const lowField = new BreakableField(scene, low, new Rng('low'), 1, (d) => lowDrops.push(d.kind === 'pickup' ? d.id : d.kind));
  lowField.update({ x: 260, y: 260, hpRatio: 0.3 });
  assert.equal(lowField.hitCircle(260, 260, 200), 4000);
  const share = lowDrops.filter((k) => k === 'pk_bread').length / 4000;
  assert.ok(Math.abs(share - 0.1) < 0.02, `low-HP field bread ≈ 10% (got ${share})`);
}
{
  // 16× map (WorldGen): sprites stream within 2,400 px / out beyond 3,000 px; state survives
  // re-creation; many dens/fences/lore candidates keep per-run singleton semantics.
  let live = 0;
  const alphas: number[] = [];
  const countingImage = (): unknown => {
    live += 1;
    const img: Record<string, unknown> = {};
    const chain = (): unknown => img;
    for (const m of ['setDepth', 'setDisplaySize', 'setTint', 'setFrame', 'setVisible']) img[m] = chain;
    img.setAlpha = (a: number) => {
      alphas.push(a);
      return img;
    };
    img.destroy = () => {
      live -= 1;
    };
    return img;
  };
  const scene = { textures: { exists: () => false }, anims: { exists: () => false }, add: { image: countingImage } } as unknown as Phaser.Scene;
  const W = 24576;
  const pois: PoiAnchor[] = [];
  const grid = 24;
  for (let i = 0; i < grid; i += 1) {
    for (let j = 0; j < grid; j += 1) {
      const x = 500 + i * 1000;
      const y = 500 + j * 1000;
      const kind: PoiKind = (i + j) % 7 === 0 ? 'den' : (i + j) % 5 === 0 ? 'fence' : (i + j) % 3 === 0 ? 'lore' : 'vein';
      pois.push({ id: `p${i}-${j}`, kind, x, y, radius: 80, depth: 1, region: 0 });
    }
  }
  const big = { zone: 'castle', width: W, height: W, gates: gates('toll'), pois } as unknown as GeneratedMap;
  const log: string[] = [];
  const noop = (): void => {};
  const poi = new PoiSystem(scene, big, {
    rng: new Rng('big'), zone: { id: 'castle' } as never, loadout: loadout({ fenceChance: 1 }),
    callbacks: { onLoot: noop, onEliteChest: noop, onShrine: noop, onEvent: noop, onFence: noop, onVein: noop, onLore: (id) => log.push(id), onBell: noop, requestSpawn: () => [], onDenLock: (l) => log.push(`den:${l}`) },
  });
  assert.equal(live, 0, 'no sprite before the first scan');
  poi.update(16, { x: 500, y: 500 }, clear, false);
  const nearCount = pois.filter((a) => a.kind !== 'fence' && (a.kind !== 'lore') && Math.hypot(a.x - 500, a.y - 500) <= 2400).length;
  assert.ok(live >= nearCount && live < 40, `only nearby sprites exist (${live} of ${pois.length})`);
  // Mine the vein at (1500,500), walk away past 3,000 px, come back: re-created sprite keeps the done look.
  tick(poi, 3100, 1500, 500);
  const before = alphas.length;
  tick(poi, 300, 12500, 12500);
  const farLive = live;
  assert.ok(farLive < 40, 'sprites follow the hero');
  tick(poi, 300, 1500, 500);
  assert.ok(alphas.slice(before).includes(0.4), 'mined vein re-created depleted');
  // One fence and 3 lore stones per run however many candidates exist.
  let fences = 0;
  for (const p of poi.minimap()) if (p.kind === 'fence') fences += 1;
  poi.reveal(null);
  assert.equal(poi.minimap().filter((p) => p.kind === 'lore').length, 3, '3 lore stones of many candidates');
  assert.ok(poi.minimap().filter((p) => p.kind === 'fence').length <= 1 && fences <= 1, 'one fence');
  // Many dens: after 240 s the one the hero enters locks; the wall centres on THAT den.
  tick(poi, 240000 - poi.elapsedS * 1000, 12500, 12500);
  const den = pois.find((a) => a.kind === 'den' && Math.hypot(a.x - 12500, a.y - 12500) > 1000)!;
  tick(poi, 100, den.x, den.y);
  assert.ok(log.includes('den:true'));
  const walls = poi.denWalls();
  assert.equal(walls.length, 4);
  assert.ok(Math.abs(Math.hypot(walls[0]!.x - den.x, walls[0]!.y - den.y) - 540) < 1e-6, 'walls ring the entered den');
  poi.destroy();
  assert.equal(live, 0, 'destroy releases every streamed sprite');
}

console.log('loot selftest OK');
