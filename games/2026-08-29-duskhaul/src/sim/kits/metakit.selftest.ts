// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/metakit.selftest.ts
import assert from 'node:assert/strict';
import { TUNING } from '../../config';
import { save } from '../../core/storage';
import { Rng } from '../../core/rng';
import { applyModifiers } from '../../core/stats';
import {
  accountLevel,
  buyConsumable,
  buyNode,
  claimAchievement,
  claimContract,
  featureUnlocked,
  hazardStatus,
  levelCost,
  selectStartWeapon,
  startWeaponChoice,
  affixRerollCost,
  rerollAffix,
  ascensionCost,
  ascensionOpen,
  buyAscension,
  ascensionRank,
  itemLevelCap,
  levelItem,
  loadMeta,
  lockItem,
  markSeen,
  hasSeen,
  mergeItems,
  rerollContract,
  resetMeta,
  runLoadout,
  selectClass,
  selectZone,
  sellItems,
  setBelt,
  settleAbandonedRun,
  settleRun,
  salvageItems,
  undoLastNode,
  equipItem,
  writeRunJournal,
  zoneStatus,
  nodeUnlocked,
  loadoutHash,
} from '../../core/progression';
import { collectionProgress, codexProgress, killTier, rollMissingPiece, type CollectionSetDef } from '../../core/collections';
import { contractText, ingestRunReport } from '../../core/contracts';
import { dailyInfo, weeklyInfo } from '../../core/daily';
import { ACHIEVEMENTS } from '../../data/achievements';
import { CHARMS } from '../../data/charms';
import { classDef } from '../../data/classes';
import { WEAPONS } from '../../data/weapons';
import { AFFIXES, affixDef, affixLabel, affixRange } from '../../data/affixes';
import { CONTRACTS, STARTER_TARGETS } from '../../data/contracts';
import { GEAR_BASES, GEAR_SLOTS, LEGACY_RELIC_MAP, UNIQUES, gearMods, rarityDef, rollGear, rarityOdds } from '../../data/gear';
import { HAZARDS } from '../../data/hazards';
import { MUTATORS } from '../../data/mutators';
import { ACCOUNT_LADDER, SANCTUM, nodeCost, unlockLabel } from '../../data/sanctum';
import type { GearInstance, MetaSaveV4, RunReport } from '../../data/types-v2';

/**
 * WS-Meta guards (PRD-V2 §19 Meta row + conservation laws of the meta layer):
 * the v3 fixture migration, Sanctum pricing, loadout folding, gear-roll
 * invariants, Vault actions, contracts, settlement, daily/weekly, abandon
 * journal and the T1 `?mute=1` audio probe. Headless: a Map-backed
 * `localStorage` gives the real persistence path.
 */
const store = new Map<string, string>();
Reflect.set(globalThis, 'localStorage', {
  getItem: (key: string): string | null => store.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    store.set(key, value);
  },
  removeItem: (key: string): void => {
    store.delete(key);
  },
  clear: (): void => store.clear(),
});

/** Storage namespace probed through core/storage.ts (never hardcoded). */
const NS = ((): string => {
  store.clear();
  save('ns-probe', 1);
  const probed = [...store.keys()].find((k) => k.endsWith('ns-probe'));
  store.clear();
  if (probed === undefined) throw new Error('storage probe failed');
  return probed.slice(0, -'ns-probe'.length);
})();

const NOW = new Date(2026, 8, 25, 12, 0, 0);

/** Row gate / prerequisite open for a Sanctum node. */
function buyable(meta: MetaSaveV4, id: string): boolean {
  return nodeUnlocked(meta, id).unlocked;
}

/** XP needed to reach `level` from 0. */
function xpFor(level: number): number {
  let xp = 0;
  for (let l = 1; l < level; l += 1) xp += 200 + 75 * (l - 1);
  return xp;
}

/** A fresh v4 save object (what `resetMeta` writes). */
function defaultMeta(): MetaSaveV4 {
  store.clear();
  return resetMeta();
}

function saveMeta(m: MetaSaveV4): void {
  store.set(`${NS}meta`, JSON.stringify(m));
}

function freshWith(edit: (m: MetaSaveV4) => void): MetaSaveV4 {
  const m = defaultMeta();
  m.flags.ftueDone = true;
  edit(m);
  saveMeta(m);
  return m;
}

function report(p: Partial<RunReport> = {}): RunReport {
  return {
    outcome: 'extracted', killer: null, zone: 'castle', hazard: 1, mode: 'normal', seed: 's', classId: 'duskhauler',
    elapsedS: 300, gate: { id: 'a', kind: 'timed' },
    settlement: { outcome: 'extracted', shardsBanked: 0, shardsLost: 0, greedMul: 1, kept: [], lost: [] },
    kills: 0, killsByEnemy: {}, killsByWeapon: {}, eliteKills: 0, affixKills: {},
    bossKilled: false, midBossKilled: false, chestsOpened: 0, vaultOpened: false, shrinesUsed: 0, lairsCleared: 0, eventsCompleted: 0,
    veinsMined: 0, breakablesBroken: 0, loreRead: [], fenceTrades: 0, poisVisited: 0,
    evolutions: [], maxLevel: 1, charmsOwned: 0, weaponsAtMaxRank: 0, minHpRatio: 1, beltUsed: [], itemsSeen: [],
    ...p,
  };
}

// ───────── content tables ─────────
{
  assert.equal(SANCTUM.length, 41, '40 §5.18 nodes + Armsmaster\'s Leave');
  const byBranch = (b: string): number => SANCTUM.filter((n) => n.branch === b).length;
  assert.deepEqual([byBranch('ROOT'), byBranch('BODY'), byBranch('GREED'), byBranch('ESCAPE')], [1, 14, 13, 13]);
  assert.equal(new Set(SANCTUM.map((n) => n.id)).size, 41);
  for (const v1 of ['m_vitality', 'm_haste', 'm_might', 'm_greed', 'm_magnet', 'm_bag', 'm_extract', 'm_casket', 'm_reroll', 'm_revive', 'm_tithe', 'm_ward']) {
    assert.ok(SANCTUM.some((n) => n.id === v1), `V1 node ${v1} retained`);
  }
  let shards = 0;
  let sigils = 0;
  for (const node of SANCTUM) for (let l = 0; l < node.max; l += 1) {
    const c = nodeCost(node, l);
    shards += c.shards;
    sigils += c.sigils;
  }
  assert.ok(shards >= 80000 && shards <= 90000, `Sanctum shard total ${shards} in 80,000-90,000 (economy retune)`);
  assert.equal(sigils, 18, 'six keystones × 3 ✦');

  assert.equal(GEAR_BASES.length, 30);
  for (const slot of GEAR_SLOTS) assert.equal(GEAR_BASES.filter((b) => b.slot === slot).length, 5, `5 bases in ${slot}`);
  assert.equal(AFFIXES.length, 20);
  assert.equal(UNIQUES.length, 8);
  assert.equal(CONTRACTS.length, 36);
  assert.equal(new Set(CONTRACTS.map((c) => c.id)).size, 36);
  assert.equal(ACHIEVEMENTS.length, 60);
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, 60);
  assert.equal(HAZARDS.length, 5);
  assert.equal(MUTATORS.length, 12);
  assert.equal(ACCOUNT_LADDER.length, 40);
  assert.deepEqual(ACCOUNT_LADDER.map((r) => r.level), Array.from({ length: 40 }, (_, i) => i + 1));
  assert.equal(xpFor(40), 63375, '§5.20 L40 cumulative XP');
  for (const c of Object.values(LEGACY_RELIC_MAP)) {
    assert.ok(c.unique !== undefined || GEAR_BASES.some((b) => b.id === c.base && b.slot === c.slot), `legacy → ${c.base}`);
    assert.equal(c.affixes.length, rarityDef(c.rarity).affixes === 4 ? 0 : c.affixes.length);
  }
  // Greed rewards must be earnable with the base cap (no g_greedcap).
  assert.ok(CONTRACTS.find((c) => c.id === 'x_extract_greed')!.threshold! <= TUNING.greed.maxMul, 'x_extract_greed reachable');
  const greedy = ACHIEVEMENTS.find((x) => x.id === 'a04')!.rule;
  assert.ok(greedy.kind === 'run:extractGreed' && greedy.n <= TUNING.greed.maxMul, 'a04 reachable');
  assert.equal(affixLabel({ id: 'a_dmg', value: 3 }), 'Damage +3%');
  assert.equal(affixLabel({ id: 'a_channel', value: 100 }), 'Extract −100 ms');
}

// ───────── Arsenal 20 pair ladder (§5.8b.3): 6 pairs at L1, all 20 by L30, charms only with their weapon ─────────
{
  const pool = (level: number): { weapons: string[]; charms: string[] } => {
    freshWith((m) => {
      m.account.xp = xpFor(level);
    });
    const lo = runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 'w' });
    return { weapons: [...lo.unlockedWeapons], charms: [...lo.unlockedCharms] };
  };
  const partnerOf = (w: string): string => CHARMS.find((c) => c.evolves === w)!.id;
  for (const level of [1, 2, 5, 6, 11, 29, 30, 40]) {
    const { weapons, charms } = pool(level);
    for (const w of weapons) assert.ok(charms.includes(partnerOf(w)), `L${level}: ${w} brings its partner`);
    for (const c of charms) {
      const evolves = CHARMS.find((x) => x.id === c)!.evolves;
      assert.ok(evolves === null ? level >= 6 : weapons.includes(evolves), `L${level}: ${c} offered only with its weapon`);
    }
    assert.equal(charms.includes('c_step'), level >= 6, `L${level}: Gloam Step from L6`);
  }
  assert.deepEqual(pool(1).weapons.sort(), ['aura', 'bolt', 'nova', 'orbit', 'rail', 'scythe'], 'L1 = exactly the 6 starter pairs');
  assert.equal(pool(1).charms.length, 6);
  assert.equal(pool(29).weapons.length, 19);
  assert.equal(pool(30).weapons.length, 20, 'all 20 pairs by L30');
  assert.equal(pool(30).charms.length, 21, '20 partners + Gloam Step');
  assert.equal(WEAPONS.length, 20);
  assert.equal(CHARMS.length, 21);
  // Every ladder weapon key sits in the same rung as its partner's charm key; every weapon appears once.
  const seen: string[] = [];
  for (const row of ACCOUNT_LADDER) {
    for (const key of row.unlocks) {
      if (!key.startsWith('weapon:')) continue;
      const w = key.slice(7);
      seen.push(w);
      assert.ok(row.unlocks.includes(`charm:${partnerOf(w)}`), `L${row.level}: ${w} + partner in one rung`);
    }
    assert.ok(row.unlocks.length > 0 && row.text.length > 0, `L${row.level} rung has a reward`);
    for (const key of row.unlocks) assert.notEqual(unlockLabel(key), key, `L${row.level} ${key} has copy`);
  }
  assert.deepEqual(seen.sort(), WEAPONS.map((w) => w.id).sort(), 'each weapon on exactly one rung');
  // Class start weapons are open before their class.
  for (const cls of ['gravewarden', 'ashwitch', 'widowblade'] as const) {
    freshWith((m) => {
      m.account.xp = xpFor(40);
    });
    assert.ok(pool(1).weapons.includes(classDef(cls).startWeapon), `${cls} start weapon is an L1 pair`);
  }
  // Codex: 20 weapons / 20 evolutions / 21 charms.
  assert.equal(codexProgress(loadMeta(), 'weapons').total, 20);
  assert.equal(codexProgress(loadMeta(), 'evolutions').total, 20);
  assert.equal(codexProgress(loadMeta(), 'charms').total, 21);
  assert.equal(codexProgress(loadMeta(), 'arsenal').total, 61);

  // Migration: an L1 save that played under the old ladder (8 weapons at L1) keeps them + partners; nothing is revoked.
  freshWith((m) => {
    m.account.xp = 50;
    m.stats.runs = 3;
    m.unlocks = m.unlocks.filter((u) => u !== 'migrated:pair-ladder');
  });
  const kept = runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 'm' });
  for (const w of ['bolt', 'orbit', 'nova', 'scythe', 'rail', 'hex', 'skull', 'sickle', 'aura'] as const) {
    assert.ok(kept.unlockedWeapons.includes(w), `migrated save keeps ${w}`);
    assert.ok(kept.unlockedCharms.includes(partnerOf(w) as never), `and gets ${partnerOf(w)}`);
  }
  assert.equal(kept.unlockedWeapons.includes('censer'), false, 'old L2 weapon not granted at L1');
  assert.ok(loadMeta().unlocks.includes('migrated:pair-ladder'));
  assert.deepEqual(runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 'm' }).unlockedWeapons, kept.unlockedWeapons, 'grant is idempotent');
  // A fresh save gets no legacy grant.
  store.clear();
  assert.deepEqual(runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 'f' }).unlockedWeapons.sort(), ['aura', 'bolt', 'nova', 'orbit', 'rail', 'scythe']);
}
{
  const rerolls = (level: number): [number, number, number] => {
    freshWith((m) => {
      m.account.xp = xpFor(level);
    });
    const lo = runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 'r' });
    return [lo.rerollsPerRun, lo.banishesPerRun, lo.casketSlots];
  };
  assert.deepEqual(rerolls(5), [2, 0, 1]);
  assert.deepEqual(rerolls(8), [3, 1, 1], 'L6 reroll, L8 banish');
  assert.deepEqual(rerolls(40), [4, 2, 2], 'L20 reroll, L32 banish, L36 casket');
  // Ladder ✦ rungs pay once when crossed: L14 (+1), L28 (+2), L40 (+5).
  freshWith((m) => {
    m.account.xp = xpFor(14) - 1;
  });
  settleRun(report({ kills: 10 }));
  assert.equal(loadMeta().sigils, 1, 'L14 pays 1 ✦');
  settleRun(report({ kills: 10 }));
  assert.equal(loadMeta().sigils, 1, 'and only once');
  freshWith((m) => {
    m.account.xp = xpFor(40) - 1;
  });
  settleRun(report({ kills: 10 }));
  assert.equal(loadMeta().sigils, 5, 'L40 pays 5 ✦');
}

// ───────── gear roll invariants (bulk seeded) ─────────
{
  const rarityCounts = [0, 0, 0, 0, 0, 0, 0];
  for (let seed = 0; seed < 4000; seed += 1) {
    const ctx = { tierBias: seed % 4, luck: seed % 3, lootBias: (seed % 5) * 0.5, itemLevel: 1 + 2 * (seed % 5), uniqueChance: seed % 7 === 0 ? 0.08 : 0, zone: 'castle' as const };
    const item = rollGear(new Rng(`g:${seed}`), ctx);
    const again = rollGear(new Rng(`g:${seed}`), ctx);
    assert.deepEqual(again, item, 'same seed ⇒ same item');
    rarityCounts[item.rarity]! += 1;
    assert.ok(item.rarity >= 1 && item.rarity <= 5, 'rolls never produce Hallowed');
    assert.equal(item.level, ctx.itemLevel);
    if (item.unique !== undefined) {
      assert.equal(item.rarity, 5);
      assert.equal(item.affixes.length, 0);
      assert.ok(UNIQUES.some((u) => u.id === item.unique && u.slot === item.slot));
      continue;
    }
    assert.ok(GEAR_BASES.some((b) => b.id === item.base && b.slot === item.slot));
    assert.equal(item.affixes.length, rarityDef(item.rarity).affixes, 'affix count = rarity');
    assert.equal(new Set(item.affixes.map((a) => a.id)).size, item.affixes.length, 'one of each affix');
    for (const a of item.affixes) {
      const def = affixDef(a.id);
      const range = affixRange(def, item.rarity);
      assert.ok(range !== null, `${a.id} legal at r${item.rarity}`);
      assert.ok(a.value >= range[0] - 1e-9 && a.value <= range[1] + 1e-9, `${a.id} ${a.value} in range`);
      if (a.id === 'a_proj') assert.ok(item.rarity >= 5);
      if (a.id === 'a_bag' || a.id === 'a_luck') assert.ok(item.rarity >= 4);
    }
    if (ctx.tierBias >= 3) assert.ok(item.rarity >= 4, 'tierBias 3 ⇒ Gilded+');
  }
  assert.ok(rarityCounts.slice(1, 6).every((n) => n > 0), 'every droppable rarity appears');
  for (const shift of [-2, -1, -0.5, 0, 0.5, 1, 2.5, 7]) {
    const odds = rarityOdds(shift);
    assert.ok(Math.abs(odds.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'rarity shift conserves mass');
  }
  assert.deepEqual(rarityOdds(-1).map((p) => Math.round(p * 100)), [78, 14, 6, 2, 0]);
  assert.deepEqual(rarityOdds(0).map((p) => Math.round(p * 100)), [50, 28, 14, 6, 2]);
  assert.equal(rarityOdds(3)[0]! + rarityOdds(3)[1]! + rarityOdds(3)[2]!, 0, 'shift 3 ⇒ Gilded+ only');
}

// ───────── §19: v3 fixture migrates to v4 exactly per §10 ─────────
const V3_FIXTURE = {
  version: 3,
  currency: 800,
  unlocks: ['zone:outlands', 'skin:old'],
  upgrades: { m_vitality: 3, m_tithe: 1, meta_broom: 2 },
  stats: { runs: 10, wins: 4, bestScore: 520, bestTimeMs: 400000, wardenKills: 1 },
  stars: { l1: 3 },
  streak: { days: 2, lastDayKey: '2026-08-01' },
  collections: { relics: ['a'] },
  boosters: { b: 1 },
  stash: ['r_thornring', 'r_ashlocket', 'r_dreadcrown', 'r_thornring'],
  gear: { blade: 'r_dreadcrown', shroud: 'r_thornring', trinket: 'r_ashlocket' },
};
{
  const expected = defaultMeta();
  expected.currency = 800;
  expected.upgrades = { m_vitality: 3, m_tithe: 1 };
  expected.unlocks = ['zone:outlands', 'class:duskhauler', 'weapon:bolt', 'weapon:orbit', 'weapon:nova', 'weapon:scythe'];
  expected.account.xp = 10 * 150 + 4 * 100;
  expected.vault.gear = [
    { uid: 'm3-0', base: 'thornband', slot: 'ring', rarity: 2, level: 1, affixes: [{ id: 'a_dmg', value: 3 }] },
    { uid: 'm3-1', base: 'ash-locket', slot: 'amulet', rarity: 2, level: 1, affixes: [{ id: 'a_hp', value: 8 }] },
    { uid: 'm3-2', base: 'u_dreadcrown', slot: 'hood', rarity: 5, level: 1, affixes: [], unique: 'u_dreadcrown' },
    { uid: 'm3-3', base: 'thornband', slot: 'ring', rarity: 2, level: 1, affixes: [{ id: 'a_dmg', value: 3 }] },
  ];
  expected.equipped = { hood: 'm3-2', shroud: null, grips: null, boots: null, ring: 'm3-0', amulet: 'm3-1' };
  expected.stats.runs = 10;
  expected.stats.extracts = 4;
  expected.stats.deaths = 6;
  expected.stats.bestHaul = { castle: 520 };
  expected.stats.bossKills = { castle: 1 };
  expected.flags.ftueDone = true;
  expected.flags.seenCoach = ['coach:move', 'coach:gate'];
  expected.collections = { relics: ['a'] };

  // Through storage: loadMeta migrates, persists v4, and a second load is identical (idempotent).
  store.clear();
  store.set(`${NS}meta`, JSON.stringify(V3_FIXTURE));
  store.set(`${NS}tut:stick`, 'true');
  store.set(`${NS}tut:gate`, 'true');
  const loaded = loadMeta();
  store.set(`${NS}meta`, JSON.stringify(V3_FIXTURE));
  assert.deepEqual(loadMeta(), loaded, 'migration deterministic');
  assert.equal(JSON.parse(store.get(`${NS}meta`)!).version, 4, 'persisted as v4');
  assert.equal(accountLevel(loaded).level, 6);
  assert.equal(loaded.contracts.active.length, 3, 'L2+ board fills to 3');
  assert.equal(new Set(loaded.contracts.active.map((c) => c.id)).size, 3, 'contracts roll 3 distinct');
  // §10 migration, then the §5.8b.3 pre-pair grant: the old ladder's L1-L5 weapons (+ partners) at L6.
  const pairGrant = ['bolt', 'orbit', 'nova', 'scythe', 'rail', 'hex', 'skull', 'sickle', 'censer', 'lash', 'breath', 'spears'];
  for (const w of pairGrant) {
    assert.ok(loaded.unlocks.includes(`weapon:${w}`), `v3 player keeps ${w}`);
    assert.ok(loaded.unlocks.includes(`charm:${CHARMS.find((c) => c.evolves === w)!.id}`), `v3 player gets ${w}'s partner`);
  }
  assert.ok(expected.unlocks.every((u) => loaded.unlocks.includes(u)), 'migration unlocks kept');
  assert.deepEqual({ ...loaded, contracts: expected.contracts, unlocks: expected.unlocks }, expected, 'loaded save = migration + board + pair grant');
  assert.deepEqual(loadMeta(), loaded, 'reload idempotent');
  assert.equal(zoneStatus('outlands', loaded).unlocked, true, 'V1 zone purchase grandfathered');
  assert.equal(runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 'x' }).deathKeepPct, 40, 'm_tithe 1 = 40%');
}

// ───────── §19: runLoadout sums class + sanctum + gear mods ─────────
{
  const thornband: GearInstance = { uid: 'g1', base: 'thornband', slot: 'ring', rarity: 2, level: 1, affixes: [{ id: 'a_dmg', value: 3 }, ] };
  const locket: GearInstance = { uid: 'g2', base: 'ash-locket', slot: 'amulet', rarity: 3, level: 5, affixes: [{ id: 'a_channel', value: 120 }, { id: 'a_iframes', value: 25 }] };
  const bag: GearInstance = { uid: 'g3', base: 'tin-band', slot: 'ring', rarity: 4, level: 1, affixes: [{ id: 'a_bag', value: 1 }, { id: 'a_luck', value: 1 }, { id: 'a_hp', value: 20 }] };
  freshWith((m) => {
    m.account.xp = xpFor(10);
    m.classId = 'gravewarden';
    m.upgrades = { m_vitality: 2, m_might: 1, m_bag: 1, m_extract: 1, b_iframes: 1, m_casket: 1 };
    m.vault.gear = [thornband, locket, bag];
    m.equipped.ring = 'g1';
    m.equipped.amulet = 'g2';
  });
  const lo = runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 'sum' });
  assert.equal(lo.classId, 'gravewarden');
  assert.equal(lo.startWeapon, 'orbit');
  const sources = lo.modifiers.map((m) => m.source.split(':')[0]);
  const order = sources.filter((s, i) => sources.indexOf(s) === i);
  assert.deepEqual(order, ['class', 'sanctum', 'gear'], 'class → sanctum → gear order');
  const base = 110;
  const locketHp = Math.round(8 * 1.3 * 1.2 * 1000) / 1000;
  assert.ok(Math.abs(applyModifiers(base, lo.modifiers, 'maxHp') - (base + 20 + locketHp) * 1.3) < 1e-9, 'maxHp = (base + sanctum + gear) × class');
  const dmg = 1 + 0.06 + 0.0345 + 0.03;
  assert.ok(Math.abs(applyModifiers(1, lo.modifiers, 'damageMul') - dmg) < 1e-9, 'damageMul = sanctum + implicit + affix');
  assert.equal(lo.bagCells, 12 + 2, 'm_bag +2 cells');
  assert.equal(lo.casketSlots, 2);
  assert.equal(lo.channelMsDelta, -500 - 120, 'channel delta: m_extract + a_channel');
  assert.equal(lo.iframesMsBonus, 80 + 25);
  assert.ok(lo.modifiers.every((m) => m.stat !== 'bagCells' && m.stat !== 'channelMs'), 'bag/channel resolved into scalars');
  assert.equal(lo.mercy, false);

  // Gear bag clamp and slot gating.
  const m = loadMeta();
  m.equipped.ring = 'g3';
  saveMeta(m);
  assert.equal(runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 'x' }).bagCells, 12 + 2 + 1);
  assert.equal(gearMods(bag).filter((x) => x.stat === 'luck').length, 1);

  // Mercy after 2 deaths; hazard + mutator folding.
  const m2 = loadMeta();
  m2.stats.deathStreak = 2;
  saveMeta(m2);
  const merciful = runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 'x' });
  assert.equal(merciful.mercy, true);
  assert.equal(merciful.modifiers.at(-1)!.source, 'mercy');
  assert.equal(runLoadout({ zone: 'castle', hazard: 1, mode: 'ftue' }).mercy, false, 'no mercy in the Wicket');
  assert.equal(runLoadout({ zone: 'castle', hazard: 1, mode: 'ftue' }).threatMul, 0.7);
  assert.equal(loadMeta().selection.lastLoadoutHash, loadoutHash(), 'runLoadout records the skip-rule hash');
}

// ───────── Vault: salvage / sell / merge / level / lock ─────────
{
  const worn = (uid: string, affix: string, value: number): GearInstance => ({ uid, base: 'thornband', slot: 'ring', rarity: 2, level: uid === 'w3' ? 4 : 1, affixes: [{ id: affix, value }] });
  freshWith((m) => {
    m.account.xp = xpFor(4);
    m.currency = 1000;
    m.dust = 0;
    m.vault.gear = [worn('w1', 'a_dmg', 3), worn('w2', 'a_hp', 7), worn('w3', 'a_cd', 1), { uid: 't1', base: 'tin-band', slot: 'ring', rarity: 1, level: 1, affixes: [] }];
    m.vault.valuables = [{ uid: 'v1', id: 'v_tallowstub' }, { uid: 'v2', id: 'v_duskgem' }];
    m.equipped.ring = 'w2';
  });
  const r = mergeItems(['w1', 'w2', 'w3']);
  assert.ok(r.ok, r.reason ?? "");
  assert.equal(r.meta.vault.gear.length, 2, '3 → 1');
  const merged = r.meta.vault.gear.find((g) => g.rarity === 3)!;
  assert.equal(merged.base, 'thornband');
  assert.equal(merged.level, 4, 'item level = max of the 3');
  assert.deepEqual(merged.affixes[0], { id: 'a_dmg', value: 3 }, "keeps the 1st item's affixes");
  assert.equal(merged.affixes.length, 2, 'rolls one new affix');
  assert.notEqual(merged.affixes[1]!.id, 'a_dmg');
  assert.equal(r.meta.equipped.ring, merged.uid, 'merging an equipped item equips the result');
  assert.equal(mergeItems(['w1', 'w2', 'w3']).ok, false, 'consumed items cannot merge again');

  const cost = levelCost(merged, r.meta)!;
  assert.deepEqual(cost, { dust: 16, shards: Math.round(60 * 1.22 ** 3) });
  assert.equal(levelItem(merged.uid).ok, false, 'no dust yet');
  const s = salvageItems(['t1']);
  assert.ok(s.ok);
  assert.equal(s.meta.dust, 1, 'Tarnished salvages for 1 dust');
  const m = loadMeta();
  m.dust = 100;
  saveMeta(m);
  const lv = levelItem(merged.uid);
  assert.ok(lv.ok, lv.reason ?? "");
  assert.equal(lv.meta.vault.gear.find((g) => g.uid === merged.uid)!.level, 5);
  assert.equal(lv.meta.dust, 100 - 16);
  assert.equal(lv.meta.currency, 1000 - cost.shards);
  const maxed = { ...lv.meta.vault.gear.find((g) => g.uid === merged.uid)!, level: 10 };
  assert.equal(levelCost(maxed, lv.meta), null, 'item level cap 10 before any extraction');

  assert.ok(lockItem(merged.uid, true).ok);
  assert.equal(salvageItems([merged.uid]).ok, false, 'locked items refuse salvage');
  assert.ok(lockItem(merged.uid, false).ok);

  const sold = sellItems(['v1', 'v2']);
  assert.ok(sold.ok, sold.reason ?? "");
  assert.equal(sold.meta.currency, 1000 - cost.shards + Math.round(20 * 0.5) + Math.round(340 * 0.5), 'sell value = valuable value × sellMul');
  assert.equal(sold.meta.vault.valuables.length, 0);
}

// ───────── Economy pacing (user: "maxed Sanctum very fast") + endless sinks ─────────
{
  /**
   * Deterministic income model = Balance's MEASURED seed-econ MEANS after the
   * retune (sim, ceiling bot): banked shards + banked valuables × sellMul
   * (gear is salvage-only, not ◆). Gate A 287, B 984 + 81, C 2,147 + 206,
   * death 211, Offering 631. 20-run cycle matching the measured gate mix
   * (5 A / 7 B / 1 C / 6 deaths / 1 Offering) ≈ 657 ◆/run, scaled by the
   * save's own shardsMul.
   */
  const CYCLE = [287, 1065, 211, 1065, 287, 211, 1065, 2353, 287, 1065, 211, 631, 1065, 287, 211, 1065, 211, 1065, 211, 287];
  freshWith(() => undefined);
  const levelsTotal = SANCTUM.filter((n) => n.currency === 'shards').reduce((a, n) => a + n.max, 0);
  let bought = 0;
  let firstBuyRun = 0;
  let r50 = 0;
  let r100 = 0;
  for (let run = 1; run <= 400 && r100 === 0; run += 1) {
    const mul = applyModifiers(1, runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 'p' }).modifiers, 'shardsMul');
    const m = loadMeta();
    m.currency += Math.round(CYCLE[(run - 1) % CYCLE.length]! * (run === 1 ? 1 : mul));
    saveMeta(m);
    for (;;) {
      const meta = loadMeta();
      const open = SANCTUM.filter((n) => n.currency === 'shards' && (meta.upgrades[n.id] ?? 0) < n.max && buyable(meta, n.id));
      if (open.length === 0) break;
      open.sort((a, b) => nodeCost(a, meta.upgrades[a.id] ?? 0).shards - nodeCost(b, meta.upgrades[b.id] ?? 0).shards);
      if (!buyNode(open[0]!.id).ok) break;
      bought += 1;
      if (firstBuyRun === 0) firstBuyRun = run;
      if (r50 === 0 && bought >= levelsTotal / 2) r50 = run;
      if (bought >= levelsTotal) r100 = run;
    }
  }
  assert.equal(firstBuyRun, 1, 'first Sanctum node purchasable after run 1 (even a death)');
  assert.ok(r50 >= 25 && r50 <= 35, `50% of Sanctum levels in 25-35 runs (got ${r50})`);
  assert.ok(r100 >= 80 && r100 <= 120, `100% of Sanctum shard levels in 80-120 runs (got ${r100})`);

  // Dread Ascension: closed until every node (keystones too) is maxed; then infinite at 5,000 × 1.15^rank.
  assert.equal(ascensionOpen(loadMeta()), false, 'keystones still unbought');
  assert.deepEqual([0, 1, 10].map(ascensionCost), [5000, 5750, Math.round(5000 * 1.15 ** 10)]);
  const full = loadMeta();
  for (const n of SANCTUM) full.upgrades[n.id] = n.max;
  full.currency = 20000;
  saveMeta(full);
  assert.ok(ascensionOpen(loadMeta()), 'grandfathered/maxed save gets Ascension at once');
  assert.ok(buyAscension().ok && buyAscension().ok);
  assert.equal(ascensionRank(), 2);
  assert.equal(loadMeta().currency, 20000 - 5000 - 5750);
  const asc = runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 'a' }).modifiers.filter((x) => x.source === 'sanctum:n_ascension');
  assert.deepEqual(asc.map((x) => [x.stat, x.add]), [['damageMul', 0.02], ['shardsMul', 0.02]], '+1% damage and loot per rank');

  // Item level: steep ◆ curve; cap 10 + 2 × highest hazard cleared (H5 ⇒ 20).
  let sum = 0;
  const steps: number[] = [];
  for (let l = 1; l < 20; l += 1) steps.push(levelCost({ uid: 'x', base: 'thornband', slot: 'ring', rarity: 1, level: l, affixes: [] }, { ...loadMeta(), stats: { ...loadMeta().stats, bestHaul: { 'castle:H5': 1 } } })!.shards);
  for (const x of steps) sum += x;
  assert.ok(sum > 10000, `one item L1 → L20 is a real sink (${sum} ◆)`);
  assert.ok(steps[18]! > 20 * steps[0]!, 'curve is steep');
  const cap = loadMeta();
  assert.equal(itemLevelCap(cap), 10);
  cap.stats.bestHaul['castle:H3'] = 1;
  assert.equal(itemLevelCap(cap), 16);
  cap.stats.bestHaul['winter:H5'] = 1;
  assert.equal(itemLevelCap(cap), 20);

  // Affix reroll: escalating per item, changes the affix, persists the count.
  const rr = loadMeta();
  rr.currency = 100000;
  rr.dust = 1000;
  rr.vault.gear.push({ uid: 'rr1', base: 'thornband', slot: 'ring', rarity: 3, level: 1, affixes: [{ id: 'a_dmg', value: 3 }, { id: 'a_hp', value: 12 }] });
  saveMeta(rr);
  const c0 = affixRerollCost(loadMeta().vault.gear.find((g) => g.uid === 'rr1')!)!;
  assert.ok(rerollAffix('rr1', 0).ok);
  const after1 = loadMeta().vault.gear.find((g) => g.uid === 'rr1')!;
  assert.notEqual(after1.affixes[0]!.id, 'a_dmg');
  assert.equal(after1.affixes[1]!.id, 'a_hp', 'other affixes untouched');
  assert.equal(new Set(after1.affixes.map((a) => a.id)).size, 2);
  const c1 = affixRerollCost(after1)!;
  assert.ok(c1.shards > c0.shards, 'reroll price escalates per item');
  assert.equal(loadMeta().currency, 100000 - c0.shards);
}

// ───────── Start weapon choice (Armsmaster's Leave) ─────────
{
  freshWith((m) => {
    m.account.xp = xpFor(2);
    m.currency = 1000;
    m.startWeapon = 'skull';
  });
  assert.equal(runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 's' }).startWeapon, 'bolt', 'saved choice ignored until the node is owned');
  const locked = selectStartWeapon('nova');
  assert.equal(locked.ok, false);
  assert.equal(locked.reason, "Unlock in Sanctum — Armsmaster's Leave");
  assert.equal(startWeaponChoice().unlocked, false);
  assert.equal(buyNode('b_armsmaster').ok, false, 'needs the root node');
  assert.ok(buyNode('n_oath').ok);
  const bought = buyNode('b_armsmaster');
  assert.ok(bought.ok, bought.reason ?? '');
  assert.equal(bought.meta.currency, 1000 - 45 - 150, "Armsmaster's Leave costs 150 ◆");
  // The stale pick (skull, unlocked at L2) now applies; a ladder-locked weapon is refused.
  assert.equal(runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 's' }).startWeapon, 'skull');
  assert.equal(selectStartWeapon('spears').reason, 'Weapon locked');
  assert.ok(selectStartWeapon('nova').ok);
  const lo = runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 's' });
  assert.equal(lo.startWeapon, 'nova', 'chosen weapon starts the run');
  assert.ok(lo.unlockedWeapons.includes('nova'));
  const choice = startWeaponChoice();
  assert.deepEqual([choice.unlocked, choice.selected, choice.effective, choice.classDefault], [true, 'nova', 'nova', 'bolt']);
  assert.deepEqual(choice.options, lo.unlockedWeapons);
  assert.ok(selectStartWeapon(null).ok);
  assert.equal(runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 's' }).startWeapon, 'bolt', 'null = class default');
  // A pick that is no longer valid (hand-edited / not unlocked) falls back to the class default.
  const m = loadMeta();
  m.startWeapon = 'thralls';
  saveMeta(m);
  assert.equal(startWeaponChoice().selected, null);
  assert.equal(runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 's' }).startWeapon, 'bolt', 'invalid pick → class default');
  // v3 migration and fresh saves default to null.
  store.clear();
  assert.equal(loadMeta().startWeapon, null);
}

// ───────── Sanctum purchase rules + undo ─────────
{
  freshWith((m) => {
    m.currency = 1000;
  });
  assert.equal(buyNode('b_regen').ok, false, 'row 2 locked below 1,000 ◆ spent in BODY');
  const b = buyNode('m_vitality');
  assert.ok(b.ok);
  assert.equal(b.meta.currency, 1000 - nodeCost(SANCTUM.find((n) => n.id === 'm_vitality')!, 0).shards, 'm_vitality L1 price');
  assert.ok(undoLastNode(), 'undo refunds');
  const after = loadMeta();
  assert.equal(after.currency, 1000);
  assert.equal(after.upgrades.m_vitality, undefined);
  assert.equal(undoLastNode(), false, 'undo is single-shot');
  assert.equal(buyNode('b_undying').ok, false);
}

// ───────── Starter board (critic F9, QA 16): L2-L4 deals only Keep-H1 1-2-run contracts ─────────
{
  for (let seed = 0; seed < 60; seed += 1) {
    for (const level of [2, 3, 4]) {
      freshWith((m) => {
        m.account.xp = xpFor(level) + seed;
        m.stats.runs = seed;
      });
      const board = loadMeta().contracts.active;
      assert.equal(board.length, 3);
      for (const c of board) {
        assert.ok(STARTER_TARGETS[c.id] !== undefined, `L${level} board offers only starters (got ${c.id})`);
        assert.equal(c.target, STARTER_TARGETS[c.id], `${c.id} uses its starter target`);
      }
    }
  }
  // A board dealt before the gates (m_sell at L2, mid-boss) is re-dealt; touched contracts stay.
  freshWith((m) => {
    m.account.xp = xpFor(2);
    m.contracts.active = [
      { id: 'm_sell', progress: 0, target: 800, params: {} },
      { id: 'k_kill_mid', progress: 0, target: 1, params: {} },
      { id: 'k_kill_any', progress: 40, target: 800, params: {} },
    ];
  });
  const redealt = loadMeta();
  assert.ok(!redealt.contracts.active.some((c) => c.id === 'm_sell' || c.id === 'k_kill_mid'));
  assert.ok(redealt.contracts.active.some((c) => c.id === 'k_kill_any' && c.progress === 40));
  assert.equal(redealt.contracts.active.length, 3);
  assert.equal(redealt.contracts.rerollsLeft, 1, 'day 1 has its free reroll');
  // Two short novice runs (~100 s, Gate A) clear the whole starter board.
  const novice = report({ elapsedS: 100, kills: 130, chestsOpened: 2, veinsMined: 1, breakablesBroken: 16, shrinesUsed: 1, loreRead: ['castle:1'] });
  freshWith((m) => {
    m.account.xp = xpFor(2);
  });
  settleRun(novice);
  const s2 = settleRun({ ...novice, loreRead: ['castle:2'] });
  const after = loadMeta();
  assert.ok(after.contracts.active.every((c) => c.progress >= c.target), 'starter board done in 2 runs');
  assert.ok(!s2.contracts.some((c) => c.id.startsWith('wk_')), 'no weekly progress before L15');
  assert.equal(after.contracts.weekly.week, '', 'weekly chain untouched before L15');
  freshWith((m) => {
    m.account.xp = xpFor(5);
  });
  assert.ok(loadMeta().contracts.active.every((c) => c.target === CONTRACTS.find((d) => d.id === c.id)!.target), 'L5+ uses table targets');
}

// ───────── Contracts ─────────
{
  freshWith((m) => {
    m.account.xp = xpFor(3);
  });
  const meta = loadMeta();
  assert.equal(meta.contracts.active.length, 3);
  const killAny = { id: 'k_kill_any', progress: 0, target: 800, params: {} };
  const probe = structuredClone(meta);
  probe.contracts.active = [killAny, { id: 'x_extract_c', progress: 0, target: 1, params: {} }, { id: 'k_kill_weapon', progress: 0, target: 300, params: { weapon: 'bolt' } }];
  const deltas = ingestRunReport(probe, report({ kills: 900, killsByWeapon: { bolt: 120 }, gate: { id: 'c', kind: 'timed' } }));
  assert.deepEqual(deltas.map((d) => [d.id, d.to, d.done]), [['k_kill_any', 800, true], ['x_extract_c', 1, true], ['k_kill_weapon', 120, false]]);
  assert.equal(contractText(probe.contracts.active[2]!), 'Kill 300 enemies with Rustspike');
  assert.equal(contractText({ id: 'x_extract_any', progress: 0, target: 1, params: {} }), 'Extract once');
  assert.equal(contractText({ id: 'x_extract_any', progress: 0, target: 2, params: {} }), 'Extract 2 times');

  const m = loadMeta();
  m.contracts.active = [{ id: 'k_kill_any', progress: 800, target: 800, params: {} }, ...m.contracts.active.filter((x) => x.id !== 'k_kill_any').slice(0, 2)];
  saveMeta(m);
  const before = m.currency;
  const c = claimContract('k_kill_any');
  assert.ok(c.ok);
  assert.equal(c.meta.currency, before + 120);
  assert.equal(c.meta.contracts.active.length, 3, 'claim rolls a replacement');
  assert.ok(!c.meta.contracts.active.some((x) => x.id === 'k_kill_any'));
  assert.equal(new Set(c.meta.contracts.active.map((x) => x.id)).size, 3);
  const target = c.meta.contracts.active[1]!.id;
  const rr = rerollContract(target);
  assert.ok(rr.ok, rr.reason ?? "");
  assert.ok(!rr.meta.contracts.active.some((x) => x.id === target), 'reroll changes the contract');
  assert.equal(rerollContract(rr.meta.contracts.active[0]!.id).ok, false, '1 free reroll per day');
}

// ───────── settleRun: XP always, banking, mastery, zone unlock, mercy, boss sigil ─────────
{
  freshWith((m) => {
    m.account.xp = xpFor(5) - 10;
  });
  const gearItem: GearInstance = { uid: 'run-1', base: 'mud-boots', slot: 'boots', rarity: 4, level: 3, affixes: [] };
  const r = report({
    kills: 200, elapsedS: 300, poisVisited: 4, bossKilled: true, gate: { id: 'c', kind: 'timed' },
    settlement: { outcome: 'extracted', shardsBanked: 640, shardsLost: 0, greedMul: 1.1, kept: [{ kind: 'gear', item: gearItem }, { kind: 'valuable', item: { uid: 'val-1', id: 'v_rustcoin' } }], lost: [] },
    killsByEnemy: { husk: 150, wretch: 50 },
  });
  const sr = settleRun(r);
  const expectXp = Math.round(200 + 300 * 0.5 + 4 * 25 + 100 + 150);
  assert.equal(sr.xpGained, expectXp);
  assert.equal(sr.levelBefore, 4);
  assert.ok(sr.levelAfter >= 5);
  assert.equal(sr.shardsBanked, 640);
  assert.equal(sr.firstExtraction, true);
  assert.equal(sr.zoneUnlocked, 'outlands', 'L5 + Keep extraction opens the Outlands');
  assert.ok(sr.unlocks.includes('zone:outlands'));
  assert.ok(sr.unlocks.includes('hazard:castle:2'), 'L5 + H1 extract opens H2');
  assert.ok(sr.achievements.includes('a01') && sr.achievements.includes('a09') && sr.achievements.includes('a15'));
  assert.ok(sr.codexNew.includes('bestiary:husk') && sr.codexNew.includes('tier:husk:100'));
  const m = loadMeta();
  assert.equal(m.currency, 640);
  assert.equal(m.sigils, 1, 'first boss kill per zone/hazard pays 1 ✦');
  assert.deepEqual(m.mastery.castle, { extract: true, gateC: true, bossAndExtract: true });
  assert.equal(m.vault.gear.length, 1);
  assert.equal(m.vault.valuables.length, 1);
  assert.equal(killTier(m, 'husk'), 2);
  assert.equal(codexProgress(m, 'bestiary').found, 3, 'husk, wretch, boss:castle');
  assert.equal(codexProgress(m, 'bestiary').total, 36);
  assert.equal(store.get(`${NS}run`), 'null', 'settlement clears the journal');

  const a = claimAchievement('a01');
  assert.ok(a.ok);
  assert.equal(a.meta.currency, 740);
  assert.equal(claimAchievement('a01').ok, false);

  // Same boss again: no second sigil. Deaths keep paying XP and arm mercy.
  settleRun(report({ bossKilled: true, outcome: 'died', gate: null, settlement: { outcome: 'died', shardsBanked: 50, shardsLost: 150, greedMul: 1, kept: [], lost: [] } }));
  const died = loadMeta();
  assert.equal(died.sigils, 1);
  const xpDeath = settleRun(report({ outcome: 'died', gate: null, kills: 100, elapsedS: 200, hazard: 3, settlement: { outcome: 'died', shardsBanked: 0, shardsLost: 0, greedMul: 1, kept: [], lost: [] } })).xpGained;
  assert.equal(xpDeath, Math.round((100 + 100) * 0.6 * 1.3), 'death ×0.6, H3 ×1.3');
  assert.equal(loadMeta().stats.deathStreak, 2);
  assert.equal(runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 'm' }).mercy, true);
  settleRun(report());
  assert.equal(loadMeta().stats.deathStreak, 0, 'extraction resets the pity streak');
}

// ───────── FTUE, class/zone/hazard selection, belt ─────────
{
  store.clear();
  assert.equal(loadMeta().flags.ftueDone, false, 'fresh save runs the Wicket');
  const died = report({ mode: 'ftue', outcome: 'died', gate: null, settlement: { outcome: 'died', shardsBanked: 0, shardsLost: 0, greedMul: 1, kept: [], lost: [] } });
  settleRun(died);
  settleRun(died);
  assert.equal(loadMeta().flags.ftueDone, false, 'two retries allowed');
  settleRun(died);
  assert.equal(loadMeta().flags.ftueDone, true, 'then the Wicket ends anyway');
  store.clear();
  const ext = settleRun(report({ mode: 'ftue', kills: 5, elapsedS: 60, poisVisited: 0 }));
  assert.equal(ext.levelAfter, 2, 'Wicket first escape always reaches L2 (NEW-4)');
  assert.equal(ext.xpGained, 200, 'XP floor = exactly the L1 → L2 step');
  assert.ok(ext.achievements.includes('a02'));
  assert.equal(loadMeta().flags.ftueDone, true);

  freshWith((m) => {
    m.account.xp = xpFor(7);
    m.currency = 200;
  });
  assert.equal(selectClass('gravewarden').ok, false, 'locked class refused');
  assert.ok(selectClass('duskhauler').ok);
  assert.equal(selectZone('outlands', 1).ok, false);
  assert.equal(hazardStatus('castle', 2).reason, 'Extract at H1 to unlock');
  assert.equal(setBelt(0, 'cb_bread').ok, false, 'nothing owned');
  assert.ok(buyConsumable('cb_bread').ok);
  assert.equal(loadMeta().currency, 160);
  assert.ok(setBelt(0, 'cb_bread').ok);
  assert.equal(setBelt(1, 'cb_flask').ok, false, 'belt slot 2 at L22');
  assert.deepEqual(runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 'b' }).belt, [{ id: 'cb_bread', charges: 1 }, null]);
  settleRun(report({ beltUsed: ['cb_bread'] }));
  assert.equal(loadMeta().consumables.cb_bread, 0, 'used charge leaves the stock');
  assert.deepEqual(runLoadout({ zone: 'castle', hazard: 1, mode: 'normal', seed: 'b' }).belt, [null, null]);
  assert.ok(featureUnlocked(loadMeta(), 'belt:1'));

  assert.equal(hasSeen('coach:move'), false);
  assert.ok(markSeen('coach:move').ok);
  assert.equal(hasSeen('coach:move'), true);
  assert.equal(markSeen('coach:move').ok, false, 'idempotent');
  assert.ok(equipItem('hood', null).ok);
}

// ───────── Daily Rite / Weekly Rift ─────────
{
  freshWith((m) => {
    m.account.xp = xpFor(15);
  });
  const d1 = dailyInfo(NOW);
  assert.deepEqual(dailyInfo(NOW), d1, 'daily deterministic');
  assert.equal(d1.day, '2026-09-25');
  assert.equal(d1.mutators.length, 2);
  assert.notEqual(d1.mutators[0], d1.mutators[1]);
  assert.equal(d1.hazard, 1);
  assert.notEqual(dailyInfo(new Date(2026, 8, 26, 12)).zone, d1.zone, 'zone rotates by day');
  const w = weeklyInfo(NOW);
  assert.equal(w.week, '2026-W39');
  assert.equal(w.mutators.length, 3);
  assert.equal(w.hazard, 3, 'H3 while H4 locked');

  const today = dailyInfo(new Date());
  const lo = runLoadout({ zone: 'castle', hazard: 1, mode: 'daily' });
  assert.equal(lo.seed, today.seed);
  assert.deepEqual(lo.mutators, today.mutators);
  const dailyRun = report({ mode: 'daily', seed: lo.seed, zone: lo.zone });
  const first = settleRun(dailyRun);
  assert.equal(first.dailyReward, 200);
  assert.equal(settleRun(dailyRun).dailyReward, null, 'reward once per day');
  assert.equal(loadMeta().daily.streak, 1);
  const wk = settleRun(report({ mode: 'weekly', seed: w.seed, zone: w.zone }));
  assert.equal(wk.weeklyReward, 400);
  assert.ok(wk.achievements.includes('a60'));
}

// ───────── Abandoned run journal (§14b) ─────────
{
  freshWith(() => undefined);
  const pinned: GearInstance = { uid: 'pin-1', base: 'ash-locket', slot: 'amulet', rarity: 3, level: 1, affixes: [] };
  // NEW-2: a reload in the first seconds is not a death.
  const fresh = loadMeta();
  writeRunJournal({ version: 2, zone: 'castle', hazard: 1, mode: 'ftue', seed: 'j', classId: 'duskhauler', items: [], shards: 0, elapsedS: 3 });
  assert.equal(settleAbandonedRun(), null, 'journal < 5 s ⇒ nothing settles');
  assert.deepEqual(loadMeta().stats, fresh.stats, 'no death, no pity streak');
  assert.equal(loadMeta().flags.ftueTries, fresh.flags.ftueTries, 'no FTUE retry consumed');
  assert.equal(store.get(`${NS}run`), 'null', 'journal cleared');
  writeRunJournal({ version: 2, zone: 'castle', hazard: 1, mode: 'normal', seed: 'j', classId: 'duskhauler', items: [{ kind: 'gear', item: pinned }], shards: 400, elapsedS: 120 });
  const res = settleAbandonedRun()!;
  assert.equal(res.run.outcome, 'abandoned');
  assert.equal(res.report.shardsBanked, 100, 'abandon = death tithe 25%');
  assert.equal(loadMeta().vault.gear[0]!.uid, 'pin-1', 'casket items banked');
  assert.equal(settleAbandonedRun(), null, 'journal cleared');
  // V1 journal converts relic ids.
  store.set(`${NS}run`, JSON.stringify({ zone: 'castle', seed: 'v1', casket: ['r_gravekey'], shards: 80 }));
  const v1 = settleAbandonedRun()!;
  assert.equal(v1.report.itemsBanked[0]!.kind === 'gear' && v1.report.itemsBanked[0]!.item.unique, 'u_gravekey');
  resetMeta();
  assert.equal(loadMeta().flags.ftueDone, false);
}

// ───────── template collections kit ─────────
{
  const set: CollectionSetDef = { id: 's', name: 'S', pieces: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] };
  assert.deepEqual(collectionProgress(set, ['a', 'zz']).missing, ['b', 'c']);
  const owned: string[] = [];
  const rng = new Rng('pieces');
  for (let i = 0; i < 3; i += 1) owned.push(rollMissingPiece(set, owned, rng)!);
  assert.equal(new Set(owned).size, 3);
  assert.equal(rollMissingPiece(set, owned, rng), null);
}

// ───────── T1: ?mute=1 forces silence without writing the pref ─────────
{
  store.clear();
  Reflect.set(globalThis, 'location', { search: '?mute=1' });
  Reflect.set(globalThis, 'window', globalThis);
  // Dynamic on purpose: audio.ts reads `location.search` once at module init, so the URL must exist before the module loads.
  const audio = await import('../../core/audio');
  audio.installAudioDebug();
  audio.sfx('pickup');
  audio.sfxArp('levelup', 3);
  assert.equal(audio.isMuted(), true);
  assert.equal(audio.toggleMute(), true, 'forced mute cannot be toggled off');
  const probe = (Reflect.get(globalThis, '__AUDIO__') as () => { forcedByUrl: boolean; requested: number; played: number })();
  assert.deepEqual({ forcedByUrl: probe.forcedByUrl, requested: probe.requested, played: probe.played }, { forcedByUrl: true, requested: 2, played: 0 });
  assert.ok(![...store.keys()].some((k) => k.endsWith('muted')), 'persisted muted pref never written');
}

console.log('metakit selftest: OK');
