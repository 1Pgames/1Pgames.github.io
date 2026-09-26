// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/arsenal.selftest.ts
// PRD-V2 §5.8-5.10 / §6.1 / §19 Arsenal row: content census, evolution
// reachability, describeCard completeness, draft invariants, XP curve.
import assert from 'node:assert/strict';
import { TUNING } from '../../config';
import { Rng } from '../../core/rng';
import { CHARMS, charmDef, charmRankMods, gloamStepCooldownMs } from '../../data/charms';
import {
  UPGRADE_CARDS,
  describeCard,
  rollUpgradeChoices,
  xpNeeded,
  type UpgradeDef,
  type UpgradeKind,
} from '../../data/upgrades';
import { WEAPONS, WEAPON_MAX_RANK, evolutionReady, uniqueRiders, weaponDef, weaponStats } from '../../data/weapons';
import { UNIQUES } from '../../data/gear';
import { ACCOUNT_LADDER } from '../../data/sanctum';

/** Level whose ladder row unlocks `weapon:<id>` (the ladder is the single source, §5.20). */
const unlockLevel = (id: WeaponId): number | undefined => ACCOUNT_LADDER.find((row) => row.unlocks.includes(`weapon:${id}`))?.level;
import type { CharmId, CharmSlotView, DraftContext, WeaponId, WeaponSlotView, WeaponsView } from '../../data/types-v2';

const ALL_WEAPONS = WEAPONS.map((w) => w.id);
const ALL_CHARMS = CHARMS.map((c) => c.id);

function view(weapons: WeaponSlotView[], charms: CharmSlotView[], eligible?: WeaponId[]): WeaponsView {
  return {
    weapons,
    charms,
    maxWeapons: TUNING.weapons.maxSlots,
    maxCharms: TUNING.charms.maxSlots,
    maxRank: WEAPON_MAX_RANK,
    maxCharmRank: TUNING.charms.maxRank,
    evolutionEligible: eligible ?? evolutionReady(weapons, charms),
    gloamStepCdMs: null,
  };
}

function ctxOf(v: WeaponsView, taken: string[] = [], banished: string[] = []): DraftContext {
  return { taken, weapons: v, unlockedWeapons: [...ALL_WEAPONS], unlockedCharms: [...ALL_CHARMS], banished };
}

// ── census (§5.8, §5.9, §5.10) ──
{
  assert.equal(WEAPONS.length, 20, '20 weapons (§5.8b)');
  assert.equal(new Set(WEAPONS.map((w) => w.evolvedName)).size, 20, '20 distinct evolutions');
  assert.equal(CHARMS.length, 21, '21 charms');
  assert.equal(UPGRADE_CARDS.length, 112, '112 draft cards');
  assert.equal(new Set(UPGRADE_CARDS.map((c) => c.id)).size, 112, 'card ids unique');
  const count = (kind: UpgradeKind): number => UPGRADE_CARDS.filter((c) => c.kind === kind).length;
  assert.equal(count('weapon-unlock'), 20);
  assert.equal(count('weapon-boost'), 20);
  assert.equal(count('weapon-evolution'), 20);
  assert.equal(count('charm-unlock'), 21);
  assert.equal(count('charm-rank'), 21);
  // Exactly one partner per weapon, and it is distinct.
  assert.equal(new Set(WEAPONS.map((w) => w.partner)).size, WEAPONS.length, 'partners distinct');
  assert.equal(count('stat'), 7);
  assert.equal(count('effect'), 1);
  assert.equal(count('filler'), 2);
  // Partner bijection: each non-step charm evolves exactly the weapon that names it.
  for (const w of WEAPONS) assert.equal(charmDef(w.partner).evolves, w.id, `${w.id} ↔ ${w.partner}`);
  assert.equal(CHARMS.filter((c) => c.evolves === null).map((c) => c.id).join(), 'c_step');
  // Every weapon is reachable on the account ladder (single source: ACCOUNT_LADDER).
  for (const w of WEAPONS) assert.ok(unlockLevel(w.id) !== undefined, `${w.id} unlocks somewhere on the ladder`);
}

// ── weapon rank rule (§5.8 growth column; rank-1 and evolved numbers from TUNING) ──
{
  const T = TUNING.weapons;
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
  const bolt4 = weaponStats('bolt', 3, false);
  assert.equal(bolt4.count, 3, 'Rustspike +1 nail at boosts 1 and 3');
  assert.ok(near(bolt4.damage, T.bolt.baseDamage * 1.2), 'Rustspike +20% at boost 2');
  assert.equal(weaponStats('orbit', 3, false).count, T.orbit.blades + 3, 'Bone Halo +1 blade per boost');
  const nova4 = weaponStats('nova', 3, false);
  assert.ok(near(nova4.damage, T.nova.baseDamage * 1.75) && near(nova4.cooldownMs, T.nova.cooldownMs * 0.7), 'Ash Ring +25% dmg −10% cd per boost');
  assert.ok(near(weaponStats('scythe', 3, false).damage, T.scythe.baseDamage * 1.75), 'Gloam Scythe +25% per boost');
  assert.equal(weaponStats('rail', 3, false).pierce, T.rail.pierceCount + 3, "Widow's Lance +1 pierce per boost");
  assert.equal(weaponStats('hex', 3, false).count, T.hex.jumps + 3, 'Thorn Hex +1 jump per boost');
  assert.equal(weaponStats('skull', 3, false).count, T.skull.skulls + 2, 'Wailing Skull +1 at boosts 1 and 3');
  assert.equal(weaponStats('censer', 3, false).count, T.censer.pools + 3, 'Plague Censer +1 pool per boost');
  assert.equal(weaponStats('sickle', 3, false).count, T.sickle.sickles + 1, 'Grave Sickle +1 at boost 3');
  assert.equal(weaponStats('lash', 0, false).count, 1, 'Thorn Lash one side at rank 1');
  assert.equal(weaponStats('lash', 1, false).count, 2, 'Thorn Lash both sides at boost 1');
  assert.equal(weaponStats('breath', 2, false).arcDeg, T.breath.coneDeg + 30, 'Pyre Breath +15° per boost');
  assert.equal(weaponStats('spears', 3, false).count, T.spears.spikes + 3, 'Gallows Spears +1 spike per boost');
  // Evolution riders exist exactly where §5.8 names them.
  assert.equal(weaponStats('scythe', 3, true).arcDeg, 360, 'Dirge Reaper 360°');
  assert.ok(weaponStats('rail', 3, true).critAdd > 0, 'Sorrow Piercer crit');
  assert.ok(weaponStats('hex', 3, true).dotDps > 0 && weaponStats('nova', 3, true).dotDps > 0, 'Rot Chorus / Pyre Shroud DoT');
  assert.ok(weaponStats('skull', 3, true).splashRadius > 0, 'Choir burst');
  assert.ok(weaponStats('censer', 3, true).slowPct > 0 && weaponStats('spears', 3, true).rootMs > 0, 'slow / root');
  assert.ok(weaponStats('lash', 3, true).dotDps > 0 && weaponStats('breath', 3, true).dotDps > 0, 'bleed / ignite');
  for (const id of ALL_WEAPONS) {
    for (let b = 0; b <= TUNING.weapons.maxBoosts; b += 1) {
      for (const evo of [false, true]) {
        const s = weaponStats(id, b, evo);
        assert.ok(s.damage > 0 && s.cooldownMs > 0 && s.count >= 1, `${id} b${b} evo=${evo} sane`);
      }
    }
    // An evolution is never a downgrade of the rank-max weapon (survives any retune).
    const top = weaponStats(id, TUNING.weapons.maxBoosts, false);
    const evo = weaponStats(id, TUNING.weapons.maxBoosts, true);
    for (const key of ['damage', 'count', 'radius', 'pierce', 'arcDeg', 'length', 'durationMs'] as const) {
      assert.ok(evo[key] >= top[key], `${id} evolution keeps ${key} (${top[key]} → ${evo[key]})`);
    }
    assert.ok(evo.cooldownMs <= top.cooldownMs, `${id} evolution never slows`);
  }
}

// ── charm rank rule (§5.9) ──
{
  let proj = 0;
  let dmg = 0;
  for (let r = 1; r <= TUNING.charms.maxRank; r += 1) {
    for (const m of charmRankMods('c_pouch', r)) {
      if (m.stat === 'projectileBonus') proj += m.add ?? 0;
      if (m.stat === 'damageMul') dmg += m.mul ?? 0;
    }
  }
  assert.equal(proj, 2, 'Nail Pouch +1 projectile at ranks 2 and 4');
  assert.ok(Math.abs(dmg - 0.15) < 1e-9, 'Nail Pouch +5% dmg at ranks 1, 3, 5');
  assert.deepEqual(charmRankMods('c_step', 1), [], 'Gloam Step has no stat');
  assert.deepEqual([1, 2, 3, 4, 5].map(gloamStepCooldownMs), [6000, 5000, 4200, 3600, 3000], 'Gloam Step cd');
  for (const c of CHARMS) {
    if (c.id === 'c_step') continue;
    for (let r = 1; r <= 5; r += 1) assert.equal(charmRankMods(c.id, r).length, 1, `${c.id} rank ${r} grants one mod`);
  }
}

// ── every evolution reachable through the draft (rank max + partner, any rank) ──
{
  for (const w of WEAPONS) {
    const partner: CharmSlotView = { id: w.partner, rank: 1 };
    // Not eligible below max rank, nor without the partner, nor once evolved.
    assert.deepEqual(evolutionReady([{ id: w.id, rank: WEAPON_MAX_RANK - 1, evolved: false }], [partner]), []);
    assert.deepEqual(evolutionReady([{ id: w.id, rank: WEAPON_MAX_RANK, evolved: false }], []), []);
    assert.deepEqual(evolutionReady([{ id: w.id, rank: WEAPON_MAX_RANK, evolved: true }], [partner]), []);
    const wrong = CHARMS.find((c) => c.id !== w.partner) as { id: CharmId };
    assert.deepEqual(evolutionReady([{ id: w.id, rank: WEAPON_MAX_RANK, evolved: false }], [{ id: wrong.id, rank: 5 }]), []);

    // Walk the real card path from nothing: unlock → 3 boosts → partner unlock.
    let weapons: WeaponSlotView[] = [];
    let charms: CharmSlotView[] = [];
    const taken: string[] = [];
    const rng = new Rng(`evo:${w.id}`);
    const want = [`w_unlock_${w.id}`, `w_boost_${w.id}`, `w_boost_${w.id}`, `w_boost_${w.id}`, `ch_unlock_${w.partner}`];
    for (const id of want) {
      const pool = rollUpgradeChoices(rng, ctxOf(view(weapons, charms), taken), UPGRADE_CARDS.length);
      assert.ok(pool.some((c) => c.id === id), `${id} legal on the path to ${w.evolvedName}`);
      taken.push(id);
      if (id.startsWith('w_unlock_')) weapons = [{ id: w.id, rank: 1, evolved: false }];
      else if (id.startsWith('w_boost_')) weapons = [{ id: w.id, rank: (weapons[0]?.rank ?? 0) + 1, evolved: false }];
      else charms = [partner];
    }
    assert.deepEqual(evolutionReady(weapons, charms), [w.id], `${w.evolvedName} eligible`);
    // Draft delivery (§5.8 fallback): an eligible evolution is FORCED into a 3-card hand.
    for (let seed = 0; seed < 20; seed += 1) {
      const hand = rollUpgradeChoices(new Rng(`force:${w.id}:${seed}`), ctxOf(view(weapons, charms), taken), 3);
      assert.ok(hand.some((c) => c.id === `w_evo_${w.id}`), `${w.evolvedName} forced into the hand`);
    }
    // Without the draft fallback flag (chest-first window) it is not offered.
    const quiet = rollUpgradeChoices(rng, ctxOf(view(weapons, charms, []), taken), UPGRADE_CARDS.length);
    assert.ok(!quiet.some((c) => c.kind === 'weapon-evolution'), 'evolution waits for the chest while not overdue');
  }
}

// ── describeCard: every field populated for all 112 cards, empty and full builds ──
{
  const empty = view([{ id: 'bolt', rank: 1, evolved: false }], []);
  const full = view(
    ALL_WEAPONS.slice(0, 4).map((id) => ({ id, rank: 3, evolved: false })),
    ALL_CHARMS.slice(0, 4).map((id) => ({ id, rank: 2 })),
  );
  for (const v of [empty, full]) {
    for (const card of UPGRADE_CARDS) {
      const info = describeCard(card, v, 9);
      assert.equal(info.id, card.id);
      for (const key of ['title', 'kindLabel', 'deltaLine', 'slotLine'] as const) {
        assert.ok(info[key].length > 0, `${card.id}.${key} non-empty`);
      }
      assert.ok(info.rankTo >= info.rankFrom && info.rankMax >= info.rankTo, `${card.id} rank pips ordered`);
      if (card.weapon !== undefined) assert.ok((info.evolvesWith ?? '').length > 0, `${card.id} names its partner`);
    }
  }
  const boost = describeCard(UPGRADE_CARDS.find((c) => c.id === 'w_boost_bolt') as UpgradeDef, empty, 3);
  assert.equal(boost.kindLabel, 'WEAPON +1');
  assert.deepEqual([boost.rankFrom, boost.rankTo, boost.rankMax], [1, 2, 4]);
  assert.equal(boost.deltaLine, 'Nails 1 → 2');
  assert.equal(boost.evolvesWith, 'Grave Oath → Coffin Nail');
  assert.equal(boost.slotLine, 'WEAPONS 1/4 · CHARMS 0/4 · LV 3');
  const might = describeCard(UPGRADE_CARDS.find((c) => c.id === 'stat_might') as UpgradeDef, empty, 3);
  assert.equal(might.deltaLine, 'Damage +12%');
  const oath = describeCard(UPGRADE_CARDS.find((c) => c.id === 'ch_rank_c_oath') as UpgradeDef, view([], [{ id: 'c_oath', rank: 2 }]), 3);
  assert.deepEqual([oath.kindLabel, oath.rankFrom, oath.rankTo, oath.rankMax, oath.deltaLine], ['CHARM +1', 2, 3, 5, 'Damage +8%']);
}

// ── draft invariants over seeded random builds ──
{
  const rng = new Rng('draft-invariants');
  const unlockedWeapons: WeaponId[] = ['bolt', 'orbit', 'nova', 'scythe', 'rail', 'hex'];
  for (let run = 0; run < 300; run += 1) {
    const weapons: WeaponSlotView[] = [{ id: 'bolt', rank: 1, evolved: false }];
    const charms: CharmSlotView[] = [];
    const taken: string[] = [];
    const banished = run % 3 === 0 ? ['stat_might', 'w_unlock_orbit'] : [];
    for (let draft = 0; draft < 40; draft += 1) {
      const v = view(weapons, charms);
      const ctx: DraftContext = { taken, weapons: v, unlockedWeapons, unlockedCharms: [...ALL_CHARMS], banished };
      const hand = rollUpgradeChoices(rng, ctx, 3);
      const again = rollUpgradeChoices(new Rng(`det:${run}:${draft}`), ctx, 3).map((c) => c.id);
      assert.deepEqual(rollUpgradeChoices(new Rng(`det:${run}:${draft}`), ctx, 3).map((c) => c.id), again, 'deterministic');
      assert.equal(hand.length, 3, 'always a full hand (fillers cover)');
      assert.equal(new Set(hand.map((c) => c.id)).size, 3, 'no duplicate in a hand');
      assert.ok(hand.some((c) => !c.kind.startsWith('weapon-')), '≥ 1 non-weapon card');
      for (const card of hand) {
        assert.ok(!banished.includes(card.id), 'banished never offered');
        if (card.kind === 'weapon-unlock') {
          assert.ok(weapons.length < 4 && unlockedWeapons.includes(card.weapon as WeaponId), 'weapon unlock legal');
        }
        if (card.kind === 'charm-unlock') assert.ok(charms.length < 4, 'charm unlock legal');
        if (card.kind === 'filler') {
          const legal: UpgradeDef[] = rollUpgradeChoices(new Rng('probe'), ctx, UPGRADE_CARDS.length).filter((c) => c.kind !== 'filler');
          assert.ok(legal.length < 3, 'fillers only when < 3 legal cards');
        }
      }
      const pick = hand[draft % hand.length] as UpgradeDef;
      taken.push(pick.id);
      if (pick.kind === 'weapon-unlock') weapons.push({ id: pick.weapon as WeaponId, rank: 1, evolved: false });
      if (pick.kind === 'weapon-boost') {
        const slot = weapons.find((w) => w.id === pick.weapon) as WeaponSlotView;
        weapons[weapons.indexOf(slot)] = { ...slot, rank: slot.rank + 1 };
      }
      if (pick.kind === 'weapon-evolution') {
        const slot = weapons.find((w) => w.id === pick.weapon) as WeaponSlotView;
        weapons[weapons.indexOf(slot)] = { ...slot, evolved: true };
      }
      if (pick.kind === 'charm-unlock') charms.push({ id: pick.charm as CharmId, rank: 1 });
      if (pick.kind === 'charm-rank') {
        const slot = charms.find((c) => c.id === pick.charm) as CharmSlotView;
        charms[charms.indexOf(slot)] = { ...slot, rank: slot.rank + 1 };
      }
      // Conservation: slot caps and rank caps hold after every pick.
      assert.ok(weapons.length <= 4 && charms.length <= 4, 'slot caps');
      assert.ok(weapons.every((w) => w.rank <= WEAPON_MAX_RANK), 'weapon rank cap');
      assert.ok(charms.every((c) => c.rank <= TUNING.charms.maxRank), 'charm rank cap');
      assert.ok(weapons.every((w) => unlockedWeapons.includes(w.id)), 'only account-unlocked weapons');
    }
  }
}

// ── XP curve (§6.1 formula, coefficients from TUNING.xp) ──
{
  const { base, linear, kneeLevel, kneeStep } = TUNING.xp;
  for (let level = 1; level <= 60; level += 1) {
    const knee = level > kneeLevel ? kneeStep * (level - kneeLevel) : 0;
    assert.equal(xpNeeded(level), base + linear * (level - 1) + knee, `xpNeeded(${level})`);
    if (level > 1) assert.ok(xpNeeded(level) > xpNeeded(level - 1), 'curve strictly increasing');
  }
  // The knee bends the slope exactly once, at kneeLevel.
  assert.equal(xpNeeded(kneeLevel) - xpNeeded(kneeLevel - 1), linear);
  assert.equal(xpNeeded(kneeLevel + 1) - xpNeeded(kneeLevel), linear + kneeStep);
}

// ── weapon-side uniques (§5.15.4 Bell-Ringer's Rope, Gibbet Boots, Sun-Eater's Sigil) ──
{
  const ids = new Set(UNIQUES.map((u) => u.id));
  for (const id of ['u_bellrope', 'u_gibbetboots', 'u_suneater']) assert.ok(ids.has(id), `${id} is a real unique`);
  const none = uniqueRiders([]);
  assert.deepEqual(none, { orbitBlades: 0, stepCdMs: 0, dotMul: 1 }, 'no uniques ⇒ neutral riders');
  assert.equal(uniqueRiders(['u_bellrope']).orbitBlades, 2);
  assert.equal(uniqueRiders(['u_gibbetboots']).stepCdMs, 1000);
  assert.ok(Math.abs(uniqueRiders(['u_suneater']).dotMul - 1.4) < 1e-9);
  assert.deepEqual(uniqueRiders(['u_dreadcrown', 'u_nope']), none, 'non-weapon / unknown uniques ignored');
}

// ── account-level pools from the ladder (§5.8b.3: pairs unlock together) ──
const poolAt = (level: number): { weapons: WeaponId[]; charms: CharmId[] } => {
  const keys = ACCOUNT_LADDER.filter((row) => row.level <= level).flatMap((row) => row.unlocks);
  return {
    weapons: ALL_WEAPONS.filter((id) => keys.includes(`weapon:${id}`)),
    charms: ALL_CHARMS.filter((id) => keys.includes(`charm:${id}`)),
  };
};

type Picker = (hand: readonly UpgradeDef[], weapons: readonly WeaponSlotView[], charms: readonly CharmSlotView[]) => UpgradeDef;

/** Plays `drafts` drafts of one seeded run with `pick`; applies the card to the views. Returns per-draft snapshots. */
function playRun(seed: string, level: number, drafts: number, pick: Picker, onHand?: (d: number, hand: readonly UpgradeDef[], ctx: DraftContext) => void) {
  const pool = poolAt(level);
  const rng = new Rng(seed);
  const weapons: WeaponSlotView[] = [{ id: 'bolt', rank: 1, evolved: false }];
  const charms: CharmSlotView[] = [];
  const taken: string[] = [];
  let eligibleAt = -1;
  for (let d = 0; d < drafts; d += 1) {
    const eligible = evolutionReady(weapons, charms);
    const ctx: DraftContext = { taken, weapons: view(weapons, charms, eligible), unlockedWeapons: pool.weapons, unlockedCharms: pool.charms, banished: [] };
    const hand = rollUpgradeChoices(rng, ctx, 3);
    onHand?.(d, hand, ctx);
    const card = pick(hand, weapons, charms);
    taken.push(card.id);
    const wi = weapons.findIndex((w) => w.id === card.weapon);
    if (card.kind === 'weapon-unlock') weapons.push({ id: card.weapon as WeaponId, rank: 1, evolved: false });
    if (card.kind === 'weapon-boost' && wi >= 0) weapons[wi] = { ...(weapons[wi] as WeaponSlotView), rank: (weapons[wi] as WeaponSlotView).rank + 1 };
    if (card.kind === 'weapon-evolution' && wi >= 0) weapons[wi] = { ...(weapons[wi] as WeaponSlotView), evolved: true };
    const ci = charms.findIndex((c) => c.id === card.charm);
    if (card.kind === 'charm-unlock') charms.push({ id: card.charm as CharmId, rank: 1 });
    if (card.kind === 'charm-rank' && ci >= 0) charms[ci] = { ...(charms[ci] as CharmSlotView), rank: (charms[ci] as CharmSlotView).rank + 1 };
    if (eligibleAt < 0 && evolutionReady(weapons, charms).length > 0) eligibleAt = d;
  }
  return { weapons, charms, eligibleAt };
}

// ── pools: charms of locked weapons are never offered (§5.8b.3) ──
{
  assert.deepEqual(poolAt(1).weapons, ['bolt', 'orbit', 'nova', 'scythe', 'rail', 'aura'], '6 starter pairs at L1');
  assert.equal(poolAt(30).weapons.length, 20, 'all 20 by L30');
  for (let level = 1; level <= 30; level += 1) {
    const pool = poolAt(level);
    for (let r = 0; r < 20; r += 1) {
      const leakRng = new Rng(`leak:${level}:${r}`);
      // Hand the roller EVERY charm id: the partner filter must still hold.
      const ctx: DraftContext = { taken: [], weapons: view([{ id: 'bolt', rank: 1, evolved: false }], []), unlockedWeapons: pool.weapons, unlockedCharms: [...ALL_CHARMS], banished: [] };
      const offered: UpgradeDef[] = rollUpgradeChoices(leakRng, ctx, UPGRADE_CARDS.length);
      for (const card of offered) {
        if (card.charm === undefined) continue;
        const evolves = charmDef(card.charm).evolves;
        assert.ok(evolves === null || pool.weapons.includes(evolves), `L${level}: ${card.charm} offered while ${evolves} is locked`);
      }
    }
  }
}

// ── §5.8b.4 starter guarantee: L1 account evolves ≥ 1 weapon by draft 16 in 100% of 200 runs ──
{
  // Bot per §5.8b.4.5: take the evolution, else the first-owned weapon's partner, else its boost, else a weapon unlock, else the first card.
  const guaranteeBot: Picker = (hand, weapons) => {
    const first = weapons[0] as WeaponSlotView;
    const partner = weaponDef(first.id).partner;
    return (
      hand.find((c) => c.kind === 'weapon-evolution') ??
      hand.find((c) => c.kind === 'charm-unlock' && c.charm === partner) ??
      hand.find((c) => c.kind === 'weapon-boost' && c.weapon === first.id) ??
      hand.find((c) => c.kind === 'weapon-unlock') ??
      (hand[0] as UpgradeDef)
    );
  };
  let worst = -1;
  for (let r = 0; r < 200; r += 1) {
    const run = playRun(`starter:${r}`, 1, 22, guaranteeBot, (d, hand, ctx) => {
      if (d < 3 && ctx.weapons.weapons.length < 4) assert.ok(hand.some((c) => c.kind === 'weapon-unlock'), `run ${r} draft ${d}: weapon unlock offered`);
      // Partner pity: with a partner missing at rank ≥ 2, the draft at index ≡ 2 (mod 3) offers it.
      const missing = ctx.weapons.weapons.filter((w) => !w.evolved && w.rank >= 2 && !ctx.weapons.charms.some((c) => c.id === weaponDef(w.id).partner) && ctx.weapons.charms.length < 4);
      if (missing.length > 0 && d % 3 === 2) {
        assert.ok(hand.some((c) => c.kind === 'charm-unlock' && missing.some((w) => weaponDef(w.id).partner === c.charm)), `run ${r} draft ${d}: partner pity`);
      }
    });
    assert.ok(run.eligibleAt >= 0 && run.eligibleAt < 16, `run ${r}: evolution eligible by draft 16 (got ${run.eligibleAt})`);
    worst = Math.max(worst, run.eligibleAt);
  }
  assert.ok(worst < 16);
}

// ── charm slot reservation (§5.8b.4.3) ──
{
  const pool = poolAt(30);
  const weapons: WeaponSlotView[] = [{ id: 'scythe', rank: 2, evolved: false }];
  const charms: CharmSlotView[] = [{ id: 'c_oath', rank: 1 }, { id: 'c_bell', rank: 1 }, { id: 'c_drum', rank: 1 }];
  const ctx: DraftContext = { taken: ['a'], weapons: view(weapons, charms), unlockedWeapons: pool.weapons, unlockedCharms: pool.charms, banished: [] };
  const offered = rollUpgradeChoices(new Rng('reserve'), ctx, UPGRADE_CARDS.length).filter((c) => c.kind === 'charm-unlock').map((c) => c.charm);
  assert.deepEqual(offered, ['c_heart'], 'last charm slot reserved for the missing partner');
}

// ── weapon-set variety at L30: every weapon in ≥ 10% of 500 random-picker runs ──
{
  const appear: Record<string, number> = {};
  for (let r = 0; r < 500; r += 1) {
    const picker = new Rng(`picker30:${r}`);
    const run = playRun(`variety30:${r}`, 30, 12, (hand) => hand[Math.floor(picker.next() * hand.length)] as UpgradeDef);
    for (const w of run.weapons) appear[w.id] = (appear[w.id] ?? 0) + 1;
  }
  for (const id of ALL_WEAPONS) {
    if (id === 'bolt') continue;
    assert.ok((appear[id] ?? 0) / 500 >= 0.1, `L30: ${id} in ${(appear[id] ?? 0) / 5}% of runs (≥ 10%)`);
  }
}

// ── evoMatch: cards pairing with an OWNED piece are marked (user request) ──
{
  const card = (id: string): UpgradeDef => UPGRADE_CARDS.find((c) => c.id === id) as UpgradeDef;
  const scythe2 = view([{ id: 'scythe', rank: 2, evolved: false }], []);
  const heart = describeCard(card('ch_unlock_c_heart'), scythe2, 5).evoMatch;
  assert.deepEqual(heart, { partnerName: 'Gloam Scythe', partnerIcon: 'icon-wpn-scythe', evolvedName: 'Dirge Reaper', ready: false }, 'owned scythe marks Husk Heart');
  assert.equal(describeCard(card('ch_unlock_c_heart'), view([{ id: 'scythe', rank: WEAPON_MAX_RANK, evolved: false }], []), 5).evoMatch?.ready, true, 'ready at max rank');
  assert.equal(describeCard(card('ch_unlock_c_heart'), view([{ id: 'scythe', rank: WEAPON_MAX_RANK, evolved: true }], []), 5).evoMatch, undefined, 'evolved weapon: no mark');
  assert.equal(describeCard(card('ch_unlock_c_oath'), scythe2, 5).evoMatch, undefined, 'unrelated charm unmarked');
  assert.equal(describeCard(card('stat_might'), scythe2, 5).evoMatch, undefined, 'stat card unmarked');

  const withHeart = view([{ id: 'bolt', rank: 1, evolved: false }], [{ id: 'c_heart', rank: 1 }]);
  const unlock = describeCard(card('w_unlock_scythe'), withHeart, 5).evoMatch;
  assert.deepEqual(unlock, { partnerName: 'Husk Heart', partnerIcon: 'icon-charm-c_heart', evolvedName: 'Dirge Reaper', ready: false }, 'owned charm marks its weapon unlock');
  assert.equal(describeCard(card('w_unlock_orbit'), withHeart, 5).evoMatch, undefined, 'unrelated weapon unlocked unmarked');
  const boosts = [1, 2, 3].map((rank) =>
    describeCard(card('w_boost_scythe'), view([{ id: 'scythe', rank, evolved: false }], [{ id: 'c_heart', rank: 1 }]), 5).evoMatch?.ready);
  assert.deepEqual(boosts, [false, false, true], 'boost ready only when it reaches max rank');
  assert.equal(describeCard(card('w_evo_scythe'), view([{ id: 'scythe', rank: 4, evolved: false }], [{ id: 'c_heart', rank: 1 }]), 5).evoMatch, undefined, 'evolution card itself unmarked');

  // Draft bias: with an owned weapon, its partner charm shows up more often than a peer charm of the same rarity.
  let partner = 0;
  let peer = 0;
  const ctx: DraftContext = { taken: ['x', 'x', 'x'], weapons: scythe2, unlockedWeapons: [...ALL_WEAPONS], unlockedCharms: [...ALL_CHARMS], banished: [] };
  for (let i = 0; i < 4000; i += 1) {
    const hand = rollUpgradeChoices(new Rng(`evo-bias:${i}`), ctx, 3).map((c) => c.id);
    if (hand.includes('ch_unlock_c_heart')) partner += 1;
    if (hand.includes('ch_unlock_c_oath')) peer += 1;
  }
  assert.ok(partner > peer * 1.25, `partner charm favoured (${partner} vs ${peer})`);
}

console.log('arsenal selftest: ok');
