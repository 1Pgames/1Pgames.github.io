// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/content.selftest.ts
import assert from 'node:assert/strict';
import { TUNING } from '../../config';
import { Rng } from '../../core/rng';
import {
  ENEMIES,
  enemiesForZone,
  exclusiveEnemies,
  eliteEnemies,
  scaleEnemy,
  sharedEnemies,
  WARDEN_SUMMON_ID,
  type EnemyDef,
} from '../../data/enemies';
import {
  WEAPONS,
  WEAPON_MAX_RANK,
  weaponBoostDamageMul,
  weaponRankCount,
  type WeaponPattern,
} from '../../data/weapons';
import { UPGRADE_CARDS, rollUpgradeChoices, type UpgradeDef } from '../../data/upgrades';
import { PHASES, TIMELINE_EVENTS, WAVES } from '../../data/waves';
import { ZONES, zoneGates } from '../../data/zones';
import { RELICS, relicTierWeights, rollRelic, salvageFor, type RelicTier } from '../../data/relics';

/**
 * Content-table invariants for Duskhaul (PRD §5). These are CONSERVATION laws,
 * not balance opinions: the §5.0 volume floors, id uniqueness, every referenced
 * id resolving, the §5.5 tier-weight guarantees, the §6 scaling formula, and
 * the §8 no-dead-draft rules under bulk seeded play.
 *
 * A balance pass is free to move any number in the tables. It is NOT free to
 * break a floor, orphan an id, or open a dead draft — that is what this
 * fixture defends.
 */

const OWNED_ALL = WEAPONS.map((w) => w.id);

/**
 * The §5.3 evolution gate, read AT THE SURFACE THE GAME READS IT: would a
 * draft in this state be allowed to offer `weapon`'s evolution?
 *
 * `evolutionEligible` is internal to `data/upgrades.ts` — the scene and the sim
 * only ever consult the rule through `rollUpgradeChoices`, so testing the
 * predicate directly proved a function no shipped code path called. Asking the
 * roller for the whole pool DRAINS it (it loops until the pool is empty), so
 * the returned hand IS the eligible set and membership is an exact answer
 * rather than a sampled one. No `UpgradeRollContext` is passed on purpose:
 * `cardEligible` resolves an evolution card before it consults the context, so
 * the probe sees the gate alone, with the unlock/boost cards out of the way.
 */
function evolutionOffered(taken: readonly string[], weapon: WeaponPattern): boolean {
  const pool = rollUpgradeChoices(new Rng('evolution-gate-probe'), taken, UPGRADE_CARDS.length);
  return pool.some((card) => card.id === `w_evo_${weapon}`);
}

// --- §5.0 content volume floors, exactly -----------------------------------
{
  assert.equal(sharedEnemies().length, 12, '12 shared archetypes (§5.2)');
  assert.equal(ENEMIES.filter((e) => e.zone !== undefined).length, 8, '8 zone-exclusive (§5.7)');
  assert.equal(eliteEnemies().length, 3, '3 elites (§5.2b)');
  assert.equal(ENEMIES.filter((e) => e.behaviour === 'boss').length, 1, '1 Gate Warden');
  assert.equal(WEAPONS.length, 6, '6 weapons (§5.3)');
  assert.equal(UPGRADE_CARDS.length, 26, '26 upgrade cards (§5.3)');
  assert.equal(RELICS.length, 16, '16 relics (§5.5)');
  assert.equal(WAVES.length, 18, '18 wave timeline entries (§5.4)');
  assert.equal(ZONES.length, 4, '4 zones (§5.7)');

  const kinds = (kind: UpgradeDef['kind']): number =>
    UPGRADE_CARDS.filter((c) => c.kind === kind).length;
  assert.equal(kinds('weapon-unlock'), 6, '6 weapon-unlock cards');
  assert.equal(kinds('weapon-boost'), 6, '6 weapon-boost cards');
  assert.equal(kinds('weapon-evolution'), 6, '6 evolution cards, one per weapon');
  assert.equal(kinds('stat'), 8, '8 stat/effect cards');

  for (const tier of [1, 2, 3, 4] as const) {
    assert.equal(
      RELICS.filter((r) => r.tier === tier).length,
      4,
      `4 relics at tier ${tier} — the tier ladder must stay even`,
    );
  }
}

// --- every id is unique and every referenced id resolves -------------------
{
  const ids = [
    ...ENEMIES.map((e) => e.id),
    ...UPGRADE_CARDS.map((c) => c.id),
    ...RELICS.map((r) => r.id),
    ...ZONES.map((z) => z.id),
  ];
  assert.equal(new Set(ids).size, ids.length, 'no duplicate content id anywhere');

  const enemyIds = new Set(ENEMIES.map((e) => e.id));
  for (const wave of WAVES) {
    for (const slot of wave.spawns) {
      assert.ok(enemyIds.has(slot.id), `wave at ${wave.at}s spawns unknown enemy "${slot.id}"`);
    }
  }
  assert.ok(enemyIds.has(WARDEN_SUMMON_ID), 'the Warden summons an archetype that exists');

  const cardIds = new Set(UPGRADE_CARDS.map((c) => c.id));
  for (const weapon of WEAPONS) {
    assert.ok(
      cardIds.has(weapon.evolutionRequiresCard),
      `${weapon.id}'s evolution gate names a card that does not exist`,
    );
    assert.ok(
      cardIds.has(`w_evo_${weapon.id}`) && cardIds.has(`w_boost_${weapon.id}`),
      `${weapon.id} is missing a boost or evolution card`,
    );
  }
}

// --- wave shape contract: a wave is a BURST or a LANE, never both ----------
{
  for (const wave of WAVES) {
    assert.ok(wave.spawns.length > 0, `wave at ${wave.at}s has no spawns`);
    if (wave.until === undefined) continue;
    assert.ok(wave.until > wave.at, `lane at ${wave.at}s ends at or before it starts`);
    for (const slot of wave.spawns) {
      // `until` makes the director ignore `count`, so a non-zero count on a
      // lane is a silent authoring lie about what the wave delivers.
      assert.equal(slot.count, 0, `lane at ${wave.at}s carries a count for "${slot.id}"`);
      assert.ok((slot.everyMs ?? 0) > 0, `lane at ${wave.at}s has no cadence for "${slot.id}"`);
    }
  }
  assert.equal(WAVES[0]?.at, 0, 'the timeline opens at 0s');
  for (let i = 1; i < WAVES.length; i += 1) {
    assert.ok((WAVES[i]?.at ?? 0) >= (WAVES[i - 1]?.at ?? 0), 'waves are authored in run order');
  }
  assert.equal(TIMELINE_EVENTS.length, 2, 'two chests (§5.4)');
  for (const event of TIMELINE_EVENTS) assert.equal(event.kind, 'chest');
}

// --- §2A phases, and the Collapse is the last one --------------------------
{
  assert.equal(PHASES.length, 6, 'Grace/Early/Mid/Late/Climax/Collapse');
  for (let i = 1; i < PHASES.length; i += 1) {
    const prev = PHASES[i - 1];
    const curr = PHASES[i];
    assert.ok(prev !== undefined && curr !== undefined);
    assert.ok(curr.fromSeconds > prev.fromSeconds, 'phase starts strictly increase');
    assert.ok(curr.difficultyMul >= prev.difficultyMul, 'threat never decreases');
  }
  assert.equal(
    PHASES[PHASES.length - 1]?.fromSeconds,
    TUNING.collapse.atS,
    'the last phase begins exactly when the Collapse does',
  );
}

// --- §6 scaling: HP linear, damage half-rate, rewards and speed fixed ------
{
  const husk = ENEMIES.find((e) => e.id === 'husk');
  assert.ok(husk !== undefined, 'the grunt reference archetype exists');

  // §6 worked example, castle x1.0: 60s -> 23, 180s -> 31, 300s -> 41, 480s -> 58.
  assert.equal(scaleEnemy(husk, 1.3).maxHp, 23);
  assert.equal(scaleEnemy(husk, 1.7).maxHp, 31);
  assert.equal(scaleEnemy(husk, 2.3).maxHp, 41);
  assert.equal(scaleEnemy(husk, 3.2).maxHp, 58);
  // §6 Collapse 540s -> 68, and winter x1.5 at 480s -> 86.
  assert.equal(scaleEnemy(husk, 3.8).maxHp, 68);
  assert.equal(scaleEnemy(husk, 4.8).maxHp, 86);

  for (const def of ENEMIES) {
    const scaled = scaleEnemy(def, 3.2);
    assert.equal(scaled.moveSpeed, def.stats.moveSpeed, `${def.id}: move speed must not scale`);
    assert.equal(scaled.xp, def.stats.xp, `${def.id}: xp must not scale`);
    assert.equal(scaled.shards, def.stats.shards, `${def.id}: shards must not scale`);
    // Damage scales at half rate, so it always lags HP's multiplier.
    assert.ok(
      scaled.damage <= Math.round(def.stats.damage * 3.2),
      `${def.id}: damage must scale slower than HP`,
    );
    assert.equal(scaleEnemy(def, 1).maxHp, def.stats.maxHp, `${def.id}: x1 is the identity`);
  }
}

// --- roster wellformedness -------------------------------------------------
{
  const seenTexture = new Set<string>();
  for (const def of ENEMIES) {
    assert.ok(def.name.length > 0 && def.desc.length > 0, `${def.id}: needs §5 flavor copy`);
    assert.ok(def.size > 0, `${def.id}: needs a display size`);
    assert.ok(def.stats.maxHp > 0, `${def.id}: needs positive HP`);
    assert.ok(def.stats.xp > 0, `${def.id}: every kill must be worth XP`);
    assert.ok(def.firstSeenS >= 0 && def.firstSeenS <= TUNING.collapse.atS, `${def.id}: entry time`);
    assert.ok(!seenTexture.has(def.texture), `${def.id}: texture key "${def.texture}" is reused`);
    seenTexture.add(def.texture);
  }
  // Only the Warden and the elites hand out pooled drops.
  const droppers = ENEMIES.filter((e) => e.eliteDrop === true).map((e) => e.id);
  assert.deepEqual(
    [...droppers].sort(),
    ['elite_herald', 'elite_matron', 'elite_reaper', 'warden'],
    'elite drops belong to the elites and the Warden, nobody else',
  );
}

// --- §5.7 zones: gates land in the live arena, exclusives partitioned ------
{
  assert.deepEqual(ZONES.map((z) => z.unlockShards), [0, 300, 800, 1600], '§5.7 unlock ladder');
  assert.deepEqual(ZONES.map((z) => z.threatBase), [1.0, 1.15, 1.3, 1.5], '§5.7 threat ladder');

  const hazardKinds = new Set<string>();
  for (const zone of ZONES) {
    assert.equal(zone.gates.length, 3, `${zone.id}: three gates (§2A)`);
    assert.deepEqual(zone.gates.map((g) => g.id), ['a', 'b', 'c'], `${zone.id}: gate ids a/b/c`);
    // The property that matters is not the authoring space, it is where the
    // SCALER puts a gate: `zoneGates` maps §5.7's 1600x1600 coordinates into
    // `TUNING.arena`, and a gate outside those bounds is unreachable content.
    // Asserting the raw design-space numbers instead only proved the table was
    // typed the way it was typed.
    for (const gate of zoneGates(zone)) {
      assert.ok(
        gate.x > 0 && gate.x < TUNING.arena.width && gate.y > 0 && gate.y < TUNING.arena.height,
        `${zone.id}: gate ${gate.id} scales to (${Math.round(gate.x)}, ${Math.round(gate.y)}), ` +
          `outside the live ${TUNING.arena.width}x${TUNING.arena.height} arena`,
      );
    }
    // Gate C never closes; the Collapse is its closing mechanism (§2A).
    assert.equal(zone.gates[2].closesS, null, `${zone.id}: Gate C must never close`);
    assert.ok(zone.backdropKey.length > 0, `${zone.id}: needs a backdrop key`);

    assert.ok(!hazardKinds.has(zone.hazard.kind), `hazard kind "${zone.hazard.kind}" is reused`);
    hazardKinds.add(zone.hazard.kind);
    assert.ok(Object.keys(zone.hazard.params).length > 0, `${zone.id}: hazard has no params`);

    assert.equal(exclusiveEnemies(zone.id).length, 2, `${zone.id}: exactly 2 exclusives (§5.7)`);
    const table = enemiesForZone(zone.id);
    assert.equal(table.length, 12 + 2 + 3 + 1, `${zone.id}: spawn table is shared + its own 2`);
    for (const def of table) {
      assert.ok(
        def.zone === undefined || def.zone === zone.id,
        `${zone.id}: spawn table leaked "${def.id}" from another zone`,
      );
    }
    // One light entrant at 60s and one heavy at 240s (§5.7).
    const entries = exclusiveEnemies(zone.id).map((e: EnemyDef) => e.firstSeenS);
    assert.deepEqual([...entries].sort((a, b) => a - b), [60, 240], `${zone.id}: 60s/240s entrants`);
  }
}

// --- §5.5 relic table and the tier-weight guarantees -----------------------
{
  const slots = new Set<string>();
  for (const relic of RELICS) {
    assert.ok(relic.name.length > 0 && relic.desc.length > 0, `${relic.id}: needs §5.5 copy`);
    assert.equal(relic.salvage, salvageFor(relic.tier), `${relic.id}: salvage must follow §7`);
    assert.ok(
      relic.gear.length > 0 || relic.effect !== undefined,
      `${relic.id}: a relic that does nothing when equipped is a dead reward`,
    );
    for (const mod of relic.gear) {
      assert.ok(
        mod.add !== undefined || mod.mul !== undefined,
        `${relic.id}: gear entry for "${mod.stat}" changes nothing`,
      );
    }
    slots.add(relic.slot);
  }
  assert.equal(slots.size, 3, 'all three gear slots (§5.5) are represented');

  // Salvage strictly increases with tier, or the bag's drop-lowest rule and the
  // stash's salvage screen are both lying about value.
  for (const tier of [2, 3, 4] as const) {
    assert.ok(salvageFor(tier) > salvageFor((tier - 1) as RelicTier), `tier ${tier} salvage rises`);
  }

  assert.deepEqual(
    relicTierWeights('nope', 0),
    [...TUNING.loot.tierWeights],
    'an unknown zone contributes no bias',
  );

  for (const zone of ZONES) {
    const unbiased = relicTierWeights(zone.id, 0);
    const total = unbiased.reduce((a, b) => a + b, 0);
    for (const bias of [1, 2, 3] as const) {
      const shifted = relicTierWeights(zone.id, bias);
      assert.equal(
        shifted.reduce((a, b) => a + b, 0),
        total,
        `${zone.id}: a +${bias} source shift must conserve total weight`,
      );
      for (let i = 0; i < bias && i < shifted.length; i += 1) {
        assert.equal(shifted[i], 0, `${zone.id}: +${bias} bias must vacate tier ${i + 1}`);
      }
    }
    // §5.4/§5.5: the Shrine and the Warden roll at +2, which must be
    // Gilded-or-Dread in EVERY zone, not only the ones without a low-tier bias.
    const shrine = relicTierWeights(zone.id, TUNING.loot.bossTierBias);
    assert.equal(shrine[0], 0, `${zone.id}: a Shrine roll must never produce Tarnished`);
    assert.equal(shrine[1], 0, `${zone.id}: a Shrine roll must never produce Burnished`);
  }
}

// --- rollRelic: seeded, in-table, and honours the weights ------------------
{
  // Same seed, same haul — replays and the balance sim depend on it.
  const a = new Rng('haul');
  const b = new Rng('haul');
  for (let i = 0; i < 200; i += 1) {
    assert.equal(rollRelic(a, 'winter', i % 3).id, rollRelic(b, 'winter', i % 3).id);
  }

  const ids = new Set(RELICS.map((r) => r.id));
  const rng = new Rng('bulk');
  const tally = [0, 0, 0, 0];
  for (let i = 0; i < 20000; i += 1) {
    const relic = rollRelic(rng, 'castle', 0);
    assert.ok(ids.has(relic.id), 'rollRelic must only return table entries');
    tally[relic.tier - 1] = (tally[relic.tier - 1] ?? 0) + 1;
  }
  // Ordering, not exact frequency: the ladder must stay monotonically rarer.
  const [t1 = 0, t2 = 0, t3 = 0, t4 = 0] = tally;
  assert.ok(t1 > t2 && t2 > t3 && t3 > t4, 'higher tiers stay rarer than lower ones');

  // The +2 guarantee holds under bulk sampling in every zone, including the
  // ones whose lootBias touches a low tier.
  for (const zone of ZONES) {
    const shrineRng = new Rng(`shrine-${zone.id}`);
    for (let i = 0; i < 4000; i += 1) {
      assert.ok(
        rollRelic(shrineRng, zone.id, TUNING.loot.bossTierBias).tier >= 3,
        `${zone.id}: a +2 roll produced below Gilded`,
      );
    }
  }
}

// --- §5.3 weapon ranks -----------------------------------------------------
{
  assert.equal(WEAPON_MAX_RANK, TUNING.weapons.maxBoosts + 1, 'rank 1 is the unlock');
  for (const weapon of WEAPONS) {
    assert.ok(weapon.baseDamage > 0, `${weapon.id}: needs damage`);
    assert.ok(
      weapon.cooldownMs === null || weapon.cooldownMs > 0,
      `${weapon.id}: cadence is positive or null (continuous)`,
    );
    assert.ok(weapon.evolvedName.length > 0, `${weapon.id}: needs an evolution`);
    assert.equal(weaponBoostDamageMul(weapon.id, 0), 1, `${weapon.id}: rank 1 is unmodified`);

    const growth = weapon.rankGrowth;
    if (growth.damageStep > 0) {
      assert.ok(
        weaponBoostDamageMul(weapon.id, TUNING.weapons.maxBoosts) > 1,
        `${weapon.id}: a damage-growth weapon must gain damage per rank`,
      );
    } else {
      // §5.3's "or": a weapon that gains no damage MUST gain count instead, or
      // its boost card is a dead pick.
      assert.ok((growth.countStep ?? 0) > 0, `${weapon.id}: gains neither damage nor count`);
      const key = weapon.id === 'orbit' ? 'bones' : 'jumps';
      assert.ok(
        weaponRankCount(weapon.id, TUNING.weapons.maxBoosts, key) >
          weaponRankCount(weapon.id, 0, key),
        `${weapon.id}: count must rise with rank`,
      );
    }
  }
}

// --- §8 no-dead-draft rules, bulk seeded -----------------------------------
{
  let handsWithoutStat = 0;
  let guaranteeMisses = 0;
  let eligibleDrafts = 0;
  let unlockAtFullSlots = 0;
  let duplicateInHand = 0;
  let overStacked = 0;
  let emptyHands = 0;

  for (let seed = 0; seed < 400; seed += 1) {
    const rng = new Rng(`draft-${seed}`);
    const taken: string[] = ['w_unlock_orbit', 'w_unlock_nova', 'w_unlock_rail'];
    const eligibleAt: boolean[] = [];
    const offeredAt: boolean[] = [];

    for (let draft = 0; draft < 14; draft += 1) {
      eligibleAt[draft] = WEAPONS.some((weapon) => evolutionOffered(taken, weapon.id));
      const hand = rollUpgradeChoices(rng, taken, TUNING.draft.choices, {
        ownedWeapons: OWNED_ALL,
        hasFreeWeaponSlot: false,
      });
      if (hand.length === 0) {
        emptyHands += 1;
        break;
      }

      if (new Set(hand.map((c) => c.id)).size !== hand.length) duplicateInHand += 1;
      if (hand.length > 1 && !hand.some((c) => c.kind === 'stat')) handsWithoutStat += 1;
      if (hand.some((c) => c.kind === 'weapon-unlock')) unlockAtFullSlots += 1;
      for (const card of hand) {
        if (taken.filter((t) => t === card.id).length >= card.maxStacks) overStacked += 1;
      }
      offeredAt[draft] = hand.some((c) => c.kind === 'weapon-evolution');

      // A bot that NEVER takes an evolution: the guarantee under test belongs to
      // the roller, not to any lane's preference.
      const pick =
        hand.find((c) => c.id === 'w_boost_bolt') ??
        hand.find((c) => c.id === 'stat_might') ??
        hand.find((c) => c.kind !== 'weapon-evolution') ??
        hand[0];
      if (pick === undefined) break;
      taken.push(pick.id);
    }

    for (let d = 0; d < eligibleAt.length; d += 1) {
      if (eligibleAt[d] !== true) continue;
      eligibleDrafts += 1;
      if (offeredAt[d + 1] === undefined) continue; // no next draft to check.
      if (offeredAt[d] !== true && offeredAt[d + 1] !== true) guaranteeMisses += 1;
    }
  }

  assert.equal(emptyHands, 0, 'the pool never runs dry inside a 14-draft run');
  assert.equal(duplicateInHand, 0, 'a hand never offers the same card twice');
  assert.equal(overStacked, 0, 'a card at its stack limit never reappears');
  assert.equal(unlockAtFullSlots, 0, 'weapon-unlock cards vanish once every slot is filled');
  assert.equal(handsWithoutStat, 0, 'every hand of 2+ carries a non-weapon stat card (§8)');
  assert.ok(eligibleDrafts > 0, 'the fixture actually reached evolution eligibility');
  assert.equal(guaranteeMisses, 0, 'an eligible evolution is offered within 2 drafts (§8)');
}

// --- the evolution gate is exactly §5.3's, and nothing weaker --------------
{
  const gate = WEAPONS.find((w) => w.id === 'bolt')?.evolutionRequiresCard;
  assert.ok(gate !== undefined);

  const maxBoosts = Array.from({ length: TUNING.weapons.maxBoosts }, () => 'w_boost_bolt');
  assert.equal(evolutionOffered([], 'bolt'), false, 'rank 1 with no gate card is not offered');
  assert.equal(evolutionOffered(maxBoosts, 'bolt'), false, 'max rank alone is not enough');
  assert.equal(evolutionOffered([gate], 'bolt'), false, 'the gate card alone is not enough');
  assert.equal(evolutionOffered([...maxBoosts, gate], 'bolt'), true, 'both conditions: offered');
  assert.equal(
    evolutionOffered([...maxBoosts, gate, 'w_evo_bolt'], 'bolt'),
    false,
    'an evolved weapon is never offered its evolution again',
  );
  // An unowned weapon can never be eligible, however many cards are in `taken`.
  const hexGate = WEAPONS.find((w) => w.id === 'hex')?.evolutionRequiresCard;
  assert.ok(hexGate !== undefined);
  assert.equal(
    evolutionOffered(
      [...Array.from({ length: TUNING.weapons.maxBoosts }, () => 'w_boost_hex'), hexGate],
      'hex',
    ),
    false,
    'a weapon that was never unlocked cannot evolve',
  );
  // One boost short of max rank, gate card owned: the last stack is the gate.
  const oneShort = Array.from({ length: TUNING.weapons.maxBoosts - 1 }, () => 'w_boost_bolt');
  assert.equal(
    evolutionOffered([...oneShort, gate], 'bolt'),
    false,
    `rank ${TUNING.weapons.maxBoosts} of ${WEAPON_MAX_RANK} is not max rank`,
  );
}

console.log('content.selftest: OK');
