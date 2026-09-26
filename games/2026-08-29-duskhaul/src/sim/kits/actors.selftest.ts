// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/actors.selftest.ts
//   ACTORS_SEEDS=20 for a quick pass (default 200 seeds × 4 zones).
//
// WS-Actors laws (PRD-V2 §5.4-5.6, §3.9, §13): the roster census and its
// §5.4 numbers, `visiblePx` → cell size / body radius / contact reach, elite
// promotion (×8 hp from the RAW row, trash-only `enemy.hpMul`, 170 px cap),
// the 8 affixes, frontal damage reduction, the telegraph floor (every hostile
// hit ≥ 20 dmg telegraphs ≥ 500 ms), and — bulk, seeded, on real maps — the
// spawn ring never seats a body on nav-blocked ground or outside the arena.
import assert from 'node:assert/strict';
import { artScale } from '../../data/art';
import { TUNING } from '../../config';
import { Rng } from '../../core/rng';
import { NavGrid } from '../../core/grid';
import {
  ENEMIES,
  SPAWN_RING_TRIES,
  actionScale,
  actorBaseKey,
  bodyRadiusOf,
  contactReachOf,
  displaySizeFor,
  eliteStats,
  enemiesForZone,
  frontalMul,
  deathCredit,
  midBossDef,
  scaleEnemy,
  spawnRingPoint,
  visiblePxOf,
  zoneBossDef,
  type EnemyDef,
} from '../../data/enemies';
import { ELITE_AFFIXES, affixDef } from '../../data/eliteAffixes';
import { ZONES } from '../../data/zones';
import type { EliteAffixId, ZoneId } from '../../data/types-v2';
import { generateMap } from '../../systems/mapgen';

const SEEDS = Number(process.env.ACTORS_SEEDS ?? 200);
const ZONE_IDS: readonly ZoneId[] = ['castle', 'outlands', 'desert', 'winter'];

// ── §5.4 roster census and numbers ──────────────────────────────────────
const TABLE: Record<string, [visiblePx: number, hp: number, dmg: number, spd: number, xp: number, zone: ZoneId | null]> = {
  husk: [76, 18, 6, 88, 4, null], wretch: [70, 12, 5, 165, 4, null], ratking: [64, 8, 4, 132, 3, null],
  cryptcrawler: [60, 6, 3, 190, 2, null], bonecaster: [80, 24, 8, 66, 6, null], thornhound: [84, 30, 10, 143, 6, null],
  paleknight: [110, 90, 14, 60, 12, null], lanternmonk: [84, 30, 10, 60, 7, null], shroudmoth: [72, 16, 7, 110, 5, null],
  bulwark: [112, 120, 12, 55, 14, null], gildedghoul: [84, 50, 6, 176, 10, null], pyreling: [64, 14, 12, 121, 5, null],
  marrowworm: [100, 40, 9, 77, 8, null], gibbet: [96, 45, 14, 99, 9, null], dirgebell: [90, 35, 0, 77, 10, null],
  ashwraith: [78, 22, 9, 99, 6, null], chapelghast: [80, 28, 9, 105, 6, 'castle'], gargoyle: [110, 60, 12, 110, 10, 'castle'],
  choirwraith: [84, 34, 8, 94, 7, 'castle'], kite: [76, 20, 8, 187, 5, 'outlands'], giant: [150, 140, 16, 50, 14, 'outlands'],
  mirehag: [96, 60, 10, 66, 8, 'outlands'], leech: [84, 26, 10, 99, 6, 'desert'], scarab: [70, 45, 6, 154, 8, 'desert'],
  sandrevenant: [88, 50, 12, 110, 8, 'desert'], widow: [120, 70, 14, 94, 10, 'winter'], yeti: [160, 180, 20, 66, 16, 'winter'],
  rimestalker: [92, 55, 13, 154, 8, 'winter'],
};
const trash = ENEMIES.filter((e) => e.rank === 'trash');
assert.deepEqual(trash.map((e) => e.id).sort(), Object.keys(TABLE).sort(), '§5.4: exactly the 28 trash archetypes');
assert.equal(trash.filter((e) => e.zone === undefined).length, 16, '16 shared');
for (const def of trash) {
  const [vpx, hp, dmg, spd, xp, zone] = TABLE[def.id]!;
  assert.equal(def.visiblePx, vpx, `${def.id} visiblePx`);
  assert.deepEqual([def.stats.maxHp, def.stats.damage, def.stats.moveSpeed, def.stats.xp], [hp, dmg, spd, xp], `${def.id} stats`);
  assert.equal(def.zone ?? null, zone, `${def.id} zone`);
  assert.equal(def.size, displaySizeFor(def.texture, def.visiblePx), `${def.id} size is derived`);
  assert.equal(bodyRadiusOf(def), Math.round(0.36 * vpx), `${def.id} bodyRadius`);
  assert.equal(contactReachOf(def), Math.round(0.36 * vpx) + TUNING.player.bodyRadius, `${def.id} contact reach`);
  assert.ok(def.name.length > 0 && def.desc.length > 0, `${def.id} copy`);
}
// §5.4 worked sizes: husk 76 × 256 / 157, hero 112 × 256 / 177.5 = 162 (= TUNING.player.size).
assert.equal(displaySizeFor('enemy-husk-move', 76), 124);
assert.equal(displaySizeFor('hero-idle', TUNING.player.visiblePx), TUNING.player.size);
for (const z of ZONE_IDS) {
  assert.equal(enemiesForZone(z).length, 19, `${z}: 16 shared + 3 exclusives`);
  assert.ok(enemiesForZone(z).every((e) => e.rank === 'trash'), `${z}: spawn table is trash only`);
  const boss = zoneBossDef(z);
  assert.equal(boss.rank, 'boss');
  assert.equal(boss.visiblePx, TUNING.boss.visiblePx);
  assert.equal(boss.stats.maxHp, 18 * TUNING.boss.hpMul);
  const mid = midBossDef(z);
  assert.equal(mid.rank, 'midboss');
  assert.equal(mid.visiblePx, TUNING.midboss.visiblePx);
  assert.equal(mid.stats.maxHp, 18 * TUNING.midboss.hpMul);
  assert.ok(mid.fixedAffix !== undefined, `${z} mid-boss carries a fixed affix`);
  assert.ok(mid.texture.startsWith('elite-'), `${z} mid-boss reuses elite art`);
}
assert.deepEqual(ZONE_IDS.map((z) => midBossDef(z).fixedAffix), ['shielded', 'splitter', 'plagued', 'hasted'], '§5.6 fixed affixes');
assert.equal(actorBaseKey('boss-warden-idle-desert'), 'boss-warden');
assert.equal(actorBaseKey('enemy-husk-move'), 'enemy-husk');
assert.equal(actionScale('hero-idle', 'hero-run'), artScale('hero-run'), 'registry action scale wins');
assert.equal(actionScale('enemy-husk-move', 'enemy-husk-death'), 1, 'unregistered deaths keep 1');

// ── behaviour params: every verb's required keys exist on its rows ───────
const REQUIRED: Partial<Record<EnemyDef['behaviour'], readonly string[]>> = {
  swarm: ['packSize'], ranged: ['rangePx', 'fireEveryMs', 'shotPx', 'shotSpeed'], 'orbit-charge': ['orbitRadiusPx', 'windupMs'],
  teleport: ['blinkPx', 'blinkEveryS'], aura: ['auraRadiusPx', 'auraSpeedMul'], split: ['splitCount', 'splitHpRatio', 'splitGenerations'],
  burst: ['burstDamage', 'burstRadiusPx', 'burstFlashMs'], lob: ['lobRadiusPx', 'telegraphMs', 'cdMs', 'rangePx'],
  shield: ['frontalDamageMul', 'frontalArcDeg'], hook: ['telegraphMs', 'lengthPx', 'pullPx', 'cdMs'],
  scream: ['radiusPx', 'slowPct', 'slowMs', 'cdMs', 'telegraphMs'], trail: ['slowPct', 'radiusPx', 'lifeMs', 'dropEveryMs'],
  revive: ['collapseMs', 'reviveHpRatio'], stalk: ['hiddenAlpha', 'revealPx'], boss: ['standoffPx'],
};
for (const def of ENEMIES) {
  for (const key of REQUIRED[def.behaviour] ?? []) assert.ok(def.params?.[key] !== undefined, `${def.id} (${def.behaviour}) needs ${key}`);
  if (def.params?.slamRadiusPx !== undefined) assert.ok((def.params.slamTelegraphMs ?? 0) >= 500, `${def.id} slam telegraph`);
}
// Exact §5.4 new-behaviour numbers.
const p = (id: string, k: string): number | undefined => ENEMIES.find((e) => e.id === id)?.params?.[k];
assert.deepEqual([p('lanternmonk', 'lobRadiusPx'), p('lanternmonk', 'telegraphMs'), p('lanternmonk', 'cdMs'), p('lanternmonk', 'rangePx')], [90, 900, 3500, 380]);
assert.deepEqual([p('gibbet', 'telegraphMs'), p('gibbet', 'lengthPx'), p('gibbet', 'pullPx'), p('gibbet', 'cdMs')], [1400, 420, 160, 6000]);
assert.deepEqual([p('choirwraith', 'slowPct'), p('choirwraith', 'radiusPx'), p('choirwraith', 'slowMs'), p('choirwraith', 'cdMs'), p('choirwraith', 'telegraphMs')], [25, 160, 2000, 5000, 600]);
assert.deepEqual([p('rimestalker', 'hiddenAlpha'), p('rimestalker', 'revealPx')], [0.25, 260]);
assert.deepEqual([p('bulwark', 'frontalDamageMul'), p('bulwark', 'frontalArcDeg')], [0.3, 180]);
assert.ok((p('pyreling', 'burstFlashMs') ?? 0) >= 500, 'pyreling death burst telegraph ≥ 500 ms (round 3 floor)');

// ── §5.5 elites ─────────────────────────────────────────────────────────
const AFFIX_IDS: readonly EliteAffixId[] = ['vampiric', 'hasted', 'shielded', 'splitter', 'frenzied', 'warded', 'plagued', 'magnetic'];
assert.deepEqual(ELITE_AFFIXES.map((a) => a.id), AFFIX_IDS, '8 affixes, §5.5 order');
for (const id of AFFIX_IDS) {
  const a = affixDef(id);
  assert.equal(a.icon, `icon-affix-${id}`);
  assert.ok(a.name.length > 0 && a.effect.length > 0 && a.telegraph.length > 0);
}
const husk = ENEMIES.find((e) => e.id === 'husk')!;
const yeti = ENEMIES.find((e) => e.id === 'yeti')!;
assert.equal(visiblePxOf(husk, true), Math.round(76 * 1.6));
assert.equal(visiblePxOf(yeti, true), TUNING.elite.sizeCap, 'elite size capped at 170');
assert.equal(bodyRadiusOf(yeti, true), Math.round(0.36 * 170));

// Trash HP ramp (spec formula, restated here): ×1 through hpMulRampS[0], ×hpMul from hpMulRampS[1], linear between.
const expectedRamp = (t: number): number => {
  const [from, to] = TUNING.enemy.hpMulRampS;
  return 1 + (TUNING.enemy.hpMul - 1) * Math.min(1, Math.max(0, (t - from) / (to - from)));
};
{
  // A 1000-hp probe row makes rounding negligible, so the ramp is observable through scaleEnemy alone.
  const probe = { ...husk, stats: { ...husk.stats, maxHp: 1000 } };
  const [from, to] = TUNING.enemy.hpMulRampS;
  assert.equal(scaleEnemy(probe, 1, 0).maxHp, 1000);
  assert.equal(scaleEnemy(probe, 1, from).maxHp, 1000);
  assert.equal(scaleEnemy(probe, 1, to).maxHp, 1000 * TUNING.enemy.hpMul);
  assert.equal(scaleEnemy(probe, 1, 480).maxHp, 1000 * TUNING.enemy.hpMul);
  assert.equal(scaleEnemy(probe, 1, (from + to) / 2).maxHp, Math.round(1000 * (1 + TUNING.enemy.hpMul) / 2), 'linear midpoint');
  for (let t = 0; t < 600; t += 1) assert.ok(scaleEnemy(probe, 1, t + 1).maxHp >= scaleEnemy(probe, 1, t).maxHp, 'ramp never falls');
}

// Scaling laws over every trash row × threat multipliers × run times.
for (const def of trash) {
  for (const mul of [1, 1.5, 2.3, 4.2, 7.76]) {
    for (const t of [0, 60, 150, 240, 420]) {
      const s = scaleEnemy(def, mul, t);
      assert.equal(s.maxHp, Math.round(def.stats.maxHp * mul * expectedRamp(t)), `${def.id} trash hp × ramp(${t})`);
      assert.equal(s.damage, Math.round(def.stats.damage * (1 + (mul - 1) / 2) * TUNING.enemy.dmgMul), `${def.id} dmg at half rate × enemy.dmgMul`);
      assert.equal(s.moveSpeed, def.stats.moveSpeed, 'speed never scales');
    }
    const e = eliteStats(def, mul);
    assert.equal(e.maxHp, Math.round(def.stats.maxHp * mul * TUNING.elite.hpMul), `${def.id} elite hp from the raw row`);
    assert.equal(e.damage, Math.round(Math.round(def.stats.damage * (1 + (mul - 1) / 2)) * TUNING.elite.dmgMul), `${def.id} elite dmg from the raw row`);
    assert.equal(e.shards, TUNING.elite.shards);
  }
}
for (const z of ZONE_IDS) {
  assert.equal(scaleEnemy(zoneBossDef(z), 1, 420).maxHp, 18 * TUNING.boss.hpMul, 'boss hp does not take the trash ramp');
  assert.equal(scaleEnemy(zoneBossDef(z), 1, 420).damage, TUNING.boss.contactDamage, 'boss dmg does not take enemy.dmgMul');
  assert.equal(scaleEnemy(midBossDef(z), 1, 420).maxHp, 18 * TUNING.midboss.hpMul, 'mid-boss hp does not take the trash ramp');
}

// Frontal DR: a body facing +x takes ×mul from the front half-plane, ×1 from behind.
{
  const rng = new Rng('actors:frontal');
  for (let i = 0; i < 2000; i += 1) {
    const facing = rng.float(-Math.PI, Math.PI);
    const off = rng.float(-Math.PI, Math.PI);
    const got = frontalMul(0, 0, facing, Math.cos(facing + off) * 100, Math.sin(facing + off) * 100, 180, 0.3);
    assert.equal(got, Math.abs(off) <= Math.PI / 2 + 1e-9 ? 0.3 : 1, `frontal at offset ${off.toFixed(3)}`);
  }
}

// ── §13.2 telegraph floor: every zone-boss hit ≥ 20 dmg telegraphs ≥ 500 ms ──
for (const z of ZONE_IDS) {
  const set: Readonly<Record<string, Readonly<Record<string, number | string>>>> = TUNING.boss[z];
  for (const [attack, cfg] of Object.entries(set)) {
    const num = (k: string): number | undefined => {
      const v = cfg[k];
      return typeof v === 'number' ? v : undefined;
    };
    const dmg = num('damage') ?? 0;
    const tele = num('telegraphMs') ?? num('windupMs') ?? num('warnMs');
    if (dmg >= 20) assert.ok(tele !== undefined && tele >= 500, `${z}.${attack}: ${dmg} dmg needs ≥ 500 ms telegraph, has ${tele}`);
  }
}
for (const z of ZONE_IDS) {
  const mp = midBossDef(z).params!;
  const pairs: [string, string][] = [['reapDamage', 'reapWindupNMs'], ['spearDamage', 'spearTelegraphMs'], ['sweepDamage', 'blinkTelegraphMs']];
  for (const [d, t] of pairs) if ((mp[d] ?? 0) >= 20) assert.ok((mp[t] ?? 0) >= 500, `${z} mid-boss ${d} telegraph`);
}

// ── §3.9 spawn ring on real maps (bulk, seeded) ──────────────────────────
{
  let spawned = 0;
  let abandoned = 0;
  const out = { x: 0, y: 0 };
  for (const zone of ZONES) {
    for (let s = 0; s < SEEDS; s += 1) {
      const map = generateMap(zone, `actors-${s}`);
      const nav = NavGrid.fromBlocked(map.nav.cols, map.nav.rows, map.nav.cell, map.nav.blocked);
      const rng = new Rng(`ring:${zone.id}:${s}`);
      // Hero walks the spawn plus a few random reachable cells.
      const heroes = [map.spawn];
      for (let k = 0; k < 4; k += 1) {
        const c = rng.int(0, map.nav.cols - 1);
        const r = rng.int(0, map.nav.rows - 1);
        if (!nav.isBlocked(c, r)) heroes.push({ x: (c + 0.5) * map.nav.cell, y: (r + 0.5) * map.nav.cell });
      }
      const legal = (x: number, y: number): boolean => x > 0 && y > 0 && x < map.width && y < map.height && !nav.isBlockedAt(x, y);
      for (const hero of heroes) {
        for (let n = 0; n < 12; n += 1) {
          const rejected = spawnRingPoint(hero.x, hero.y, 720, 1280, () => rng.float(0, Math.PI * 2), legal, out);
          if (rejected < 0) {
            abandoned += 1;
            continue;
          }
          assert.ok(rejected < SPAWN_RING_TRIES);
          assert.ok(legal(out.x, out.y), `${zone.id}/${s}: ring seat (${out.x.toFixed(0)},${out.y.toFixed(0)}) is legal`);
          const ex = (out.x - hero.x) / (360 + TUNING.enemy.spawnMargin);
          const ey = (out.y - hero.y) / (640 + TUNING.enemy.spawnMargin);
          assert.ok(Math.abs(ex * ex + ey * ey - 1) < 1e-6, 'seat lies on the §3.9 ring');
          spawned += 1;
        }
      }
    }
  }
  const total = spawned + abandoned;
  console.log(`spawn ring: ${spawned}/${total} seated (${((abandoned / total) * 100).toFixed(2)}% abandoned after ${SPAWN_RING_TRIES} tries)`);
  assert.ok(abandoned / total < 0.02, 'fewer than 2% of spawn requests abandoned');
}

// ── Critic F5 death credit ───────────────────────────────────────────────
{
  const hit = (t: number, amount: number, name: string, contact: boolean) => ({ t, amount, name, contact });
  const husks = (n: number): string[] => Array.from({ length: n }, () => 'Grave Husk');
  // Swarm: contact dominates and 14 bodies press → the swarm, even though a Bonecaster landed the last hit.
  const swarm = [hit(1000, 9, 'Grave Husk', true), hit(2000, 9, 'Gloam Wretch', true), hit(3000, 9, 'Grave Husk', true), hit(4000, 8, 'Bonecaster', false)];
  assert.equal(deathCredit(swarm, 4000, [...husks(10), 'Gloam Wretch', 'Gloam Wretch', 'Gloam Wretch', 'Gloam Wretch'], 'x'), 'a swarm of 14 Grave Husks');
  assert.equal(deathCredit(swarm, 4000, [...husks(3), 'Gloam Wretch', 'Gloam Wretch', 'Gloam Wretch', 'Rot Ratking'], 'x'), 'a mixed swarm of 7');
  // Few bodies near → top damage source, not the last hit.
  assert.equal(deathCredit(swarm, 4000, husks(2), 'Bonecaster'), 'Grave Husk');
  // Ranged dominates → the shooter, whatever the crowd.
  const shot = [hit(1000, 8, 'Bonecaster', false), hit(2000, 8, 'Bonecaster', false), hit(3000, 6, 'Grave Husk', true)];
  assert.equal(deathCredit(shot, 3000, husks(9), 'Grave Husk'), 'Bonecaster');
  // Older than the 5 s window is forgotten; an empty window falls back.
  assert.equal(deathCredit([hit(0, 50, 'Pale Knight', true), hit(6000, 5, 'Pyreling', false)], 6000, [], 'x'), 'Pyreling');
  assert.equal(deathCredit([], 6000, husks(20), 'the dark'), 'the dark');
  // Critic v2b plural bug: every roster name pluralises as English ('Gloam Wretches', not 'Wretchs').
  const PLURALS: Record<string, string> = {
    husk: 'Grave Husks', wretch: 'Gloam Wretches', ratking: 'Rot Ratkings', cryptcrawler: 'Crypt Crawlers', bonecaster: 'Bonecasters',
    thornhound: 'Thornhounds', paleknight: 'Pale Knights', lanternmonk: 'Lantern Monks', shroudmoth: 'Shroudmoths', bulwark: 'Bone Bulwarks',
    gildedghoul: 'Gilded Ghouls', pyreling: 'Pyrelings', marrowworm: 'Marrowworms', gibbet: 'Gibbet Wights', dirgebell: 'Dirgebells',
    ashwraith: 'Ashwraiths', chapelghast: 'Chapel Ghasts', gargoyle: 'Rust Gargoyles', choirwraith: 'Choir Wraiths', kite: 'Carrion Kites',
    giant: 'Sloughed Giants', mirehag: 'Mire Hags', leech: 'Dune Leeches', scarab: 'Gilt Scarabs', sandrevenant: 'Sand Revenants',
    widow: 'Frost Widows', yeti: 'Hollow Yetis', rimestalker: 'Rime Stalkers',
  };
  for (const def of trash) {
    const got = deathCredit([hit(0, 10, def.name, true)], 0, Array.from({ length: 6 }, () => def.name), 'x');
    assert.equal(got, `a swarm of 6 ${PLURALS[def.id]}`, `${def.id} plural`);
  }
  assert.equal(deathCredit([hit(0, 10, 'x', true)], 0, Array.from({ length: 5 }, () => 'Frenzied Gloam Wretch'), 'x'), 'a swarm of 5 Frenzied Gloam Wretches');
}

console.log('actors selftest OK');
