// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/content.selftest.ts
//
// PRD-V2 content owned by WS-Balance: §5.4 roster, §5.5 affixes, §5.6 bosses, §5.7 waves
// + timeline, §2.1 phases, §6.2 scaling. Weapons, charms, draft rules,
// describeCard, evolution reachability and the §6.1 XP curve are WS-Arsenal's
// sim/kits/arsenal.selftest.ts.
import assert from 'node:assert/strict';
import { TUNING } from '../../config';
import { Rng } from '../../core/rng';
import { ELITE_AFFIXES } from '../../data/eliteAffixes';
import {
  ENEMIES,
  enemiesForZone,
  enemyDef,
  exclusiveEnemies,
  midBossDef,
  scaleEnemy,
  zoneBossDef,
} from '../../data/enemies';
import { PHASES, TIMELINE_EVENTS, WAVES, rollElite, wavesFor } from '../../data/waves';
import { ZONES } from '../../data/zones';

// --- §5.4-5.6 content volume, exactly ---------------------------------------
{
  assert.equal(ELITE_AFFIXES.length, 8, '§5.5: 8 elite affixes');
  assert.equal(ENEMIES.filter((e) => e.rank === 'trash' && e.zone === undefined).length, 16, '§5.4: 16 shared archetypes (12 V1 + 4 new)');
  for (const zone of ZONES) {
    assert.equal(exclusiveEnemies(zone.id).length, 3, `§5.4: ${zone.id} has 3 exclusives`);
    assert.equal(zoneBossDef(zone.id).rank, 'boss', `§5.6: ${zone.id} zone boss`);
    assert.equal(midBossDef(zone.id).rank, 'midboss', `§5.6: ${zone.id} mid-boss`);
  }
  for (const id of ['cryptcrawler', 'lanternmonk', 'bulwark', 'gibbet', 'choirwraith', 'mirehag', 'sandrevenant', 'rimestalker']) {
    assert.ok(enemyDef(id).visiblePx > 0, `§5.4 new archetype ${id} is on the roster`);
  }
  assert.equal(new Set(ENEMIES.map((e) => e.id)).size, ENEMIES.length, 'enemy ids are unique');
}

// --- §5.4 zone exclusives are partitioned ------------------------------------
{
  const seen = new Map<string, string>();
  for (const zone of ZONES) {
    for (const def of exclusiveEnemies(zone.id)) {
      assert.equal(seen.has(def.id), false, `${def.id} is exclusive to one zone only`);
      seen.set(def.id, zone.id);
      assert.equal(def.zone, zone.id);
    }
    const table = enemiesForZone(zone.id);
    for (const other of ZONES) {
      if (other.id === zone.id) continue;
      for (const def of exclusiveEnemies(other.id)) {
        assert.ok(!table.includes(def), `${zone.id}'s spawn table excludes ${other.id}'s ${def.id}`);
      }
    }
  }
}

// --- §5.7 wave table: shape, volume, ids, debut seconds --------------------
{
  assert.ok(WAVES.length >= 22, `§5.7: >= 22 timeline rows (got ${WAVES.length})`);
  for (const wave of WAVES) {
    for (const spawn of wave.spawns) {
      const lane = wave.until !== undefined;
      if (lane) {
        assert.equal(spawn.count, 0, `lane at ${wave.at}s carries count 0 (count is ignored under until)`);
        assert.ok((spawn.everyMs ?? 0) > 0, `lane at ${wave.at}s has a cadence`);
        assert.ok(wave.until! > wave.at, `lane at ${wave.at}s ends after it starts`);
      } else {
        assert.ok(spawn.count > 0, `burst at ${wave.at}s spawns something`);
      }
      const def = enemyDef(spawn.id);
      assert.equal(def.rank, 'trash', `wave rows spawn trash only (${spawn.id}); elites/bosses are beats`);
      assert.equal(def.zone, undefined, `WAVES is the shared table (${spawn.id}); exclusives come from wavesFor`);
    }
  }
  for (const zone of ZONES) {
    const table = wavesFor(zone.id);
    const firstAt = new Map<string, number>();
    for (const wave of table) {
      for (const spawn of wave.spawns) firstAt.set(spawn.id, Math.min(firstAt.get(spawn.id) ?? Infinity, wave.at));
    }
    for (const def of enemiesForZone(zone.id)) {
      const at = firstAt.get(def.id);
      assert.ok(at !== undefined, `§5.7: ${zone.id} spawns ${def.id}`);
      assert.ok(
        at >= def.firstSeenS && at <= def.firstSeenS + 5,
        `§5.7: ${def.id} enters at its firstSeenS ${def.firstSeenS}s in ${zone.id} (got ${at}s)`,
      );
    }
    for (const wave of table) {
      for (const spawn of wave.spawns) {
        const def = enemyDef(spawn.id);
        assert.ok(def.zone === undefined || def.zone === zone.id, `${zone.id} never spawns ${def.id}`);
        assert.ok(wave.at >= def.firstSeenS, `${def.id} never spawns before its firstSeenS`);
      }
    }
    for (let i = 1; i < table.length; i += 1) assert.ok(table[i]!.at >= table[i - 1]!.at, 'wavesFor is sorted');
  }
  const husk = WAVES.find((w) => w.at === 0 && w.spawns.some((s) => s.id === 'husk'));
  assert.ok(husk !== undefined && husk.until !== undefined, '§5.7: 0 s husk drip lane');
  assert.ok(WAVES.some((w) => w.at === 20 && w.spawns.some((s) => s.id === 'cryptcrawler')), '§5.7: crawler swarm from 20 s');
}

// --- §5.7 timeline beats and §2.1 phases ------------------------------------
{
  const at = (kind: string): number[] => TIMELINE_EVENTS.filter((e) => e.kind === kind).map((e) => e.at);
  assert.deepEqual(at('poi-event'), [100, 220, 340], '§5.7: events at 100/220/340 s');
  assert.deepEqual(at('elite'), [150, 270, 390], '§5.7: elites at 150/270/390 s');
  assert.deepEqual(at('boss'), [420], '§5.7: zone boss at 420 s');
  assert.deepEqual(at('den-open'), [TUNING.midboss.opensS], '§5.6: den opens at 240 s');
  assert.deepEqual(at('fence-window'), [TUNING.poi.fence.windowS[0]], '§5.12: Fence window opens 180 s');
  assert.deepEqual(at('breather'), [290, 412], '§5.7: breathers [290, 412] kept');
  for (let i = 1; i < TIMELINE_EVENTS.length; i += 1) {
    assert.ok(TIMELINE_EVENTS[i]!.at >= TIMELINE_EVENTS[i - 1]!.at, 'TIMELINE_EVENTS is sorted for RunDirector');
  }
  assert.deepEqual(
    PHASES.map((p) => [p.fromSeconds, p.difficultyMul]),
    [[0, 1.0], [30, 1.3], [120, 1.7], [240, 2.3], [360, 3.2], [TUNING.collapse.atS, 3.2]],
    '§2.1 phase multipliers',
  );
}

// --- §5.5 elite rolls ---------------------------------------------------------
{
  // Every scripted beat (and a pre-150 s lair/curse roll) promotes a phase
  // archetype of THIS zone that debuted >= 30 s earlier, never a swarm pack,
  // the flee piñata or the harmless aura.
  const pools = new Rng('elite-pool');
  for (const zone of ZONES) {
    for (const atS of [60, ...TUNING.elite.atS]) {
      for (let i = 0; i < 60; i += 1) {
        const def = enemyDef(rollElite(pools, atS, zone.id).defId);
        assert.equal(def.rank, 'trash', `${def.id} is a trash archetype`);
        assert.ok(def.zone === undefined || def.zone === zone.id, `${def.id} belongs to ${zone.id}`);
        assert.ok(def.firstSeenS <= Math.max(atS, TUNING.elite.atS[0]) - 30, `${def.id} debuted >= 30 s before its promotion at ${atS}s`);
        assert.ok(!['swarm', 'flee', 'aura'].includes(def.behaviour), `${def.id} is a duel, not a pack/piñata/aura`);
      }
    }
  }
  const a = rollElite(new Rng('elite'), 270, 'castle');
  const b = rollElite(new Rng('elite'), 270, 'castle');
  assert.deepEqual(a, b, 'rollElite is seeded');
  const rng = new Rng('elite-bulk');
  const seenAffixes = new Set<string>();
  for (let i = 0; i < 400; i += 1) {
    const roll = rollElite(rng, 390, 'winter');
    assert.equal(roll.affixes.length, 1);
    seenAffixes.add(roll.affixes[0]!);
    const forced = rollElite(rng, 390, 'winter', 'warded', true);
    assert.equal(forced.affixes[0], 'warded', 'H5 forced affix leads');
    assert.equal(forced.affixes.length, 2, 'H3+ adds an extra affix');
    assert.notEqual(forced.affixes[1], 'warded', 'the extra affix is distinct');
  }
  assert.deepEqual([...seenAffixes].sort(), ELITE_AFFIXES.map((a) => a.id).sort(), 'rolls cover exactly the §5.5 affix set');
}

// --- §6.2 scaling: HP linear (× enemy.hpMul), damage half-rate, rest fixed -
{
  const husk = enemyDef('husk');
  const [, rampEnd] = TUNING.enemy.hpMulRampS;
  const probe = { ...husk, stats: { ...husk.stats, maxHp: 1000 } };
  assert.equal(scaleEnemy(probe, 1, 0).maxHp, 1000, 'trash hp ×1 in Grace');
  assert.equal(scaleEnemy(probe, 1, rampEnd).maxHp, 1000 * TUNING.enemy.hpMul, 'trash hp ×enemy.hpMul once the ramp completes');
  const s = scaleEnemy(husk, 2.3, rampEnd);
  assert.ok(Math.abs(s.maxHp - husk.stats.maxHp * 2.3 * TUNING.enemy.hpMul) <= 0.5, 'trash hp scales linearly, times enemy.hpMul (rounded)');
  assert.ok(Math.abs(s.damage - husk.stats.damage * (1 + (2.3 - 1) / 2) * TUNING.enemy.dmgMul) <= 0.5, 'trash damage scales at half rate, times enemy.dmgMul (rounded)');
  assert.equal(s.moveSpeed, husk.stats.moveSpeed);
  assert.equal(s.xp, husk.stats.xp);
  assert.equal(s.shards, husk.stats.shards);
}

console.log('content.selftest: OK');
