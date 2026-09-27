// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/colonyThreat.selftest.ts
//
// W2 threat (`slices/colony/threat/**`) invariants and behaviour fixtures:
//   sites      all 8 sites × 3 sizes generate; every open tile and every
//              deposit / relic reachable from the core; all 4 relic kinds past
//              their distance floor; chokepoint sites get 3-5 ridge passes;
//              blocker/prop art ids name real sheet frames; same seed ⇒ same map
//   swarm      trickle: sol 1 one edge; from sol 2 a perpendicular extra edge
//              whose routed share is ≈ 25 % under the director's round-robin;
//              site ceilingMul and rung ≥ 4 extra edge; Chorus carries the Titan
//   fixtures   burst (AoE + brood), latch (relay dark + bank drain + release),
//              burrow (untargetable while dug in), wall.reflect, arc stun
//   night      one scripted night with every one of the 10 behaviours observed,
//              and per-frame census: live count == alive slots, walkers never on
//              rock, nobody outside the map margin, hp ≤ maxHp, latched set only
//              holds relays a living leech holds; deterministic replay.
import assert from 'node:assert/strict';
import { Rng } from '../../core/rng';
import { KIT_NONE, SITES, SWARM_NIGHTS, buildingDef, type BuildingId, type FaunaDef, type SiteDef } from '../../slices/colony/content';
import type { LandingSetup } from '../../slices/colony/contracts';
import { COLONY_TUNING } from '../../slices/colony/tuning';
import { createColony, type ColonyState } from '../../slices/colony/model/state';
import { applyEffects } from '../../slices/colony/model/modifiers';
import { createThreat } from '../../slices/colony/threat/index';
import { generateSite, type MapSize, type SiteMap } from '../../slices/colony/threat/terrain';
import type { Fauna } from '../../slices/colony/threat/fauna';

const TILE = COLONY_TUNING.map.tilePx;
const SIZES: readonly MapSize[] = ['frontier', 'expanse', 'continent'];
const RELIC_FLOOR: Record<string, number> = { relic_cache: 8, relic_monolith: 12, relic_archive: 14, relic_geode: 16 };

function siteById(id: string): SiteDef {
  const s = SITES.find((x) => x.id === id);
  assert.ok(s !== undefined, `site ${id}`);
  return s;
}

function reach(map: SiteMap): Uint8Array {
  const seen = new Uint8Array(map.cols * map.rows);
  const stack = [map.core.row * map.cols + map.core.col];
  seen[stack[0] ?? 0] = 1;
  while (stack.length > 0) {
    const cur = stack.pop() ?? 0;
    const r = Math.floor(cur / map.cols);
    const c = cur - r * map.cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const cc = c + dc;
      const rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= map.cols || rr >= map.rows) continue;
      const i = rr * map.cols + cc;
      if (map.blocked[i] === 1 || seen[i] === 1) continue;
      seen[i] = 1;
      stack.push(i);
    }
  }
  return seen;
}

// ── sites ────────────────────────────────────────────────────────────────
assert.equal(SITES.length, 8, 'eight sites');
const biomes = new Set(SITES.map((s) => s.biome));
assert.equal(biomes.size, 4, 'four biomes');
for (const site of SITES) {
  for (const size of SIZES) {
    for (let k = 0; k < 4; k += 1) {
      const map = generateSite(site, 1, `threat-site-${k}`, size);
      const tag = `${site.id}/${size}/${k}`;
      const seen = reach(map);
      for (let i = 0; i < seen.length; i += 1) assert.ok(map.blocked[i] === 1 || seen[i] === 1, `${tag}: open tile ${i} sealed off`);
      for (const d of map.deposits) {
        for (let dr = 0; dr < 2; dr += 1) for (let dc = 0; dc < 2; dc += 1) assert.equal(seen[(d.row + dr) * map.cols + d.col + dc], 1, `${tag}: deposit unreachable`);
      }
      const kinds = new Set<string>();
      for (const r of map.relics) {
        kinds.add(r.id);
        assert.equal(seen[r.row * map.cols + r.col], 1, `${tag}: relic unreachable`);
        assert.ok(Math.hypot(r.col - map.core.col, r.row - map.core.row) >= (RELIC_FLOOR[r.id] ?? 0), `${tag}: ${r.id} inside its distance floor`);
      }
      assert.equal(kinds.size, 4, `${tag}: all 4 relic kinds`);
      assert.ok(map.relics.length >= 12, `${tag}: ${map.relics.length} relics < 12`);
      if (site.chokepoints) assert.ok(map.passes.length >= 3 && map.passes.length <= 5, `${tag}: ${map.passes.length} passes`);
      else assert.equal(map.passes.length, 0, `${tag}: passes on a non-chokepoint site`);
      for (const b of map.blockers) {
        assert.equal(b.key, `${map.artBiome}-blockers`, `${tag}: blocker key`);
        assert.ok(b.frame >= 0 && b.frame <= 8, `${tag}: blocker frame ${b.frame}`);
        for (let dr = 0; dr < b.size; dr += 1) for (let dc = 0; dc < b.size; dc += 1) assert.equal(map.blocked[(b.row + dr) * map.cols + b.col + dc], 1, `${tag}: blocker sprite on open ground`);
      }
      for (const p of map.props) {
        const m = /^prop-(shared|steppe|rime|ember|nacre)-(\d+)$/.exec(p.id);
        assert.ok(m !== null, `${tag}: prop id ${p.id}`);
        const n = Number(m[2]) - 1;
        assert.ok(m[1] === 'shared' || m[1] === map.artBiome, `${tag}: foreign biome prop ${p.id}`);
        assert.equal(p.key, `props-${m[1]}-${Math.floor(n / 9)}`, `${tag}: prop sheet`);
        assert.equal(p.frame, n % 9, `${tag}: prop frame`);
      }
      assert.equal(map.navWindow > 0, size === 'continent', `${tag}: nav window only on the continent`);
    }
  }
}
{
  const a = generateSite(siteById('nacre_shelf'), 1, 'det', 'frontier');
  const b = generateSite(siteById('nacre_shelf'), 1, 'det', 'frontier');
  assert.deepEqual(a.blocked, b.blocked, 'same seed ⇒ same terrain');
  assert.deepEqual(a.props, b.props, 'same seed ⇒ same props');
  assert.deepEqual(a.deposits, b.deposits, 'same seed ⇒ same deposits');
}
// Site depositMul: Cinder Fen doubles vents, Frostcrown keeps the 2 guaranteed.
{
  const vents = (id: string): number => generateSite(siteById(id), 1, 'vents', 'frontier').deposits.filter((d) => d.kind === 'vent').length;
  assert.ok(vents('cinder_fen') > vents('halcyon'), 'cinder fen has more vents');
  assert.ok(vents('frostcrown') <= 2, 'frostcrown ≤ 2 vents');
}

// ── colony fixture ───────────────────────────────────────────────────────
function landing(seed: string, siteId = 'halcyon', rung = 1): ColonyState {
  const setup: LandingSetup = { site: siteById(siteId), rung, kit: KIT_NONE, seed, size: 'frontier', ark: [], refit: 0, daily: false, ftue: false };
  return createColony(setup);
}

/** First open, lit, deposit-free f×f spot on the ring at `dist` tiles from the core, scanning angles from `angle`. */
function put(state: ColonyState, def: BuildingId, dist: number, angle: number): number {
  const f = buildingDef(def).footprint;
  const { core, cols } = state.map;
  for (let d = dist; d < dist + 6; d += 0.5) {
    for (let a = 0; a < 64; a += 1) {
      const t = angle + (a * Math.PI * 2) / 64;
      const c = Math.round(core.col + Math.cos(t) * d);
      const r = Math.round(core.row + Math.sin(t) * d);
      let ok = true;
      for (let dr = 0; dr < f && ok; dr += 1) {
        for (let dc = 0; dc < f && ok; dc += 1) {
          const i = (r + dr) * cols + c + dc;
          if (c + dc < 0 || r + dr < 0 || c + dc >= cols || r + dr >= state.map.rows) ok = false;
          else if (state.map.blocked[i] === 1 || state.occ[i] !== 0 || state.depositAt[i] !== 0 || state.lit[i] !== 1) ok = false;
        }
      }
      if (ok) return state.spawnBuilding(def, c, r).uid;
    }
  }
  throw new Error(`no spot for ${def} at ${dist}`);
}

// ── swarm planner + trickle ──────────────────────────────────────────────
{
  const state = landing('trickle');
  const threat = createThreat(state, new Rng('trickle'));
  const n1 = SWARM_NIGHTS.find((n) => n.sol === 1);
  const n2 = SWARM_NIGHTS.find((n) => n.sol === 2);
  assert.ok(n1 !== undefined && n2 !== undefined);
  const p1 = threat.planNight(n1, 1, 2, new Rng('p1'));
  assert.deepEqual(p1.edges, [2], 'night 1: the loudest edge only');
  const p2 = threat.planNight(n2, 1, 2, new Rng('p2'));
  assert.equal(p2.edges.length, 2, 'night 2: main + trickle edge');
  assert.equal(p2.edges[0], 2, 'lead edge is the loudest');
  assert.ok(p2.edges[1] === 1 || p2.edges[1] === 3, 'trickle is off-axis (perpendicular)');
  const units = p2.totalFauna;
  const before = threat.liveCount;
  const perEdge = new Map<number, number>();
  // Director round-robin: unit i → plan.edges[i % len]; measure where they emerge.
  const sim = threat as unknown as { fauna: { pool: Fauna[] } };
  for (let i = 0; i < units; i += 1) threat.spawn('skitter', p2.edges[i % p2.edges.length] ?? 2, 1);
  assert.equal(threat.liveCount - before, units);
  const core = state.map.core;
  for (const f of sim.fauna.pool) {
    if (!f.alive) continue;
    const dx = f.x / TILE - core.col;
    const dy = f.y / TILE - core.row;
    const edge = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
    perEdge.set(edge, (perEdge.get(edge) ?? 0) + 1);
  }
  const trickle = perEdge.get(p2.edges[1] ?? -1) ?? 0;
  assert.ok(trickle >= 2 && trickle <= Math.ceil(units * 0.3), `trickle share ${trickle}/${units}`);
  assert.ok((perEdge.get(2) ?? 0) > trickle, 'main edge carries the bulk');
  const chorus = threat.planChorus(1);
  assert.deepEqual([...chorus.edges].sort(), [0, 1, 2, 3], 'chorus from all four edges');
  assert.ok(chorus.counts.some((c) => c.id === 'titan' && c.count === 1), 'chorus carries one titan');
  const longNight = threat.planLongNight();
  assert.equal(longNight.edges.length, 4, 'long night from all four edges');
  // Rung 4 adds an edge.
  const r4 = createThreat(landing('rung4', 'halcyon', 4), new Rng('r4'));
  assert.equal(r4.planNight(n1, 1, 0, new Rng('r4p')).edges.length, 2, 'rung 4: night 1 gets a second edge');
}

// ── behaviour fixtures ───────────────────────────────────────────────────
{
  // Spore Bloat burst: AoE to buildings + brood.
  const state = landing('burst');
  const threat = createThreat(state, new Rng('burst'));
  const wall = put(state, 'plate_barricade', 4, 0);
  const b = state.buildings.get(wall);
  assert.ok(b !== undefined);
  const hp0 = b.hp;
  const fauna = threat.fauna;
  const bloat = fauna.spawnAt('bloater', (b.col + 0.5) * TILE, (b.row + 1.5) * TILE, 1);
  const live0 = fauna.liveCount;
  assert.ok(fauna.hurt(bloat, 1e6, 0), 'bloat dies');
  assert.equal(fauna.liveCount, live0 - 1 + 4, 'burst broods 4 skitters');
  assert.ok(b.hp <= hp0 - 40 + 1e-6, 'burst damages the nearby building');

  // Tunnel Grub: untargetable while dug in.
  const grub = fauna.spawnAt('burrower', (state.map.core.col + 0.5) * TILE, (state.map.core.row - 5.5) * TILE, 1);
  threat.tick(1 / 60, state);
  assert.ok(grub.hidden, 'grub dug in on lit ground');
  assert.equal(fauna.hurt(grub, 1e6, 0), false, 'hidden grub cannot be hurt');

  // Static Leech: relay dark, bank drain, release on death.
  const relay = put(state, 'relay_pylon', 5, 1);
  const rb = state.buildings.get(relay);
  assert.ok(rb !== undefined && rb.lit, 'relay lit');
  const leech = fauna.spawnAt('sapper', (rb.col + 0.5) * TILE, (rb.row + 0.5) * TILE, 1);
  state.bankKj = 10;
  threat.tick(1 / 60, state);
  threat.tick(1, state);
  assert.equal(leech.latched, relay, 'leech holds the relay');
  assert.ok(state.latched.has(relay) && !rb.lit, 'latched relay goes dark');
  assert.ok(state.bankKj < 10, 'banks drain while latched');
  fauna.hurt(leech, 1e6, 0);
  assert.ok(!state.latched.has(relay) && rb.lit, 'relay relit once the leech dies');
  // Halo Pylons: relay.leechImmune refuses the latch.
  applyEffects(state.stats, [{ stat: 'relay.leechImmune', add: 1 }]);
  const leech2 = fauna.spawnAt('sapper', (rb.col + 0.5) * TILE, (rb.row + 0.5) * TILE, 1);
  threat.tick(1 / 60, state);
  assert.equal(leech2.latched, 0, 'leech-immune relays cannot be held');
  fauna.hurt(leech2, 1e6, 0);
}
{
  // Bastion Plate: walls reflect a share of melee damage.
  const state = landing('reflect');
  const threat = createThreat(state, new Rng('reflect'));
  applyEffects(state.stats, [{ stat: 'wall.reflect', add: 0.2 }]);
  const wall = state.buildings.get(put(state, 'plate_barricade', 4, 0));
  assert.ok(wall !== undefined);
  const sk = threat.fauna.spawnAt('skitter', (wall.col + 0.5) * TILE, (wall.row + 0.5) * TILE, 1);
  threat.tick(1, state);
  assert.ok(sk.hp < sk.maxHp, 'chewing a wall hurts the chewer under wall.reflect');

  // Storm Coil: arc hits stun for arc.stunSec.
  applyEffects(state.stats, [{ stat: 'arc.stunSec', add: 0.6 }]);
  const coil = state.buildings.get(put(state, 'arc_coil', 3, 2));
  assert.ok(coil !== undefined);
  const target = threat.fauna.spawnAt('brute', (coil.col + 3) * TILE, (coil.row + 1) * TILE, 10);
  threat.tick(1 / 60, state);
  assert.ok(target.stunSec > 0.5, 'arc hit stuns');
  const x0 = target.x;
  threat.tick(0.2, state);
  assert.equal(target.x, x0, 'stunned fauna do not move');
}
{
  // Dawn retreat clears the field (critic build3): fauna far from the field leave at once; fauna at the walls stop
  // attacking, cannot be hurt, and are gone (small puff) 6 s after dawn — no kill credit, no salvage.
  const state = landing('dawn');
  const threat = createThreat(state, new Rng('dawn'));
  applyEffects(state.stats, [{ stat: 'kill.ferrite', add: 5 }]);
  const wall = state.buildings.get(put(state, 'plate_barricade', 5, 0));
  const relay = state.buildings.get(put(state, 'relay_pylon', 5, 2));
  assert.ok(wall !== undefined && relay !== undefined);
  const fauna = threat.fauna;
  const biters = [
    fauna.spawnAt('brute', (wall.col + 0.5) * TILE, (wall.row + 0.5) * TILE, 1),
    fauna.spawnAt('matron', (wall.col + 0.5) * TILE, (wall.row + 1.5) * TILE, 1),
    fauna.spawnAt('sapper', (relay.col + 0.5) * TILE, (relay.row + 0.5) * TILE, 1),
  ];
  const far = fauna.spawnAt('skitter', TILE * 1.5, TILE * 1.5, 1);
  for (let i = 0; i < 30; i += 1) threat.tick(1 / 30, state);
  assert.ok(state.latched.has(relay.uid), 'leech latched before dawn');
  assert.ok(wall.hp < wall.maxHp, 'the wall is being chewed before dawn');
  const kills = state.kills;
  const fe = state.stock.ferrite;
  threat.retreat();
  assert.equal(far.alive, false, 'fauna beyond the near-field band leave at dawn');
  assert.ok(!state.latched.has(relay.uid) && relay.lit, 'dawn releases the latched relay');
  const hp = new Map([...state.buildings.values()].map((b) => [b.uid, b.hp]));
  let t = 0;
  let puffs = 0;
  while (threat.liveCount > 0 && t < 10) {
    for (const f of biters) if (f.alive) assert.equal(fauna.hurt(f, 1e6, 0), false, 'retreating fauna cannot be hurt');
    threat.tick(1 / 30, state);
    t += 1 / 30;
    for (const fx of state.fx) if (fx.kind === 'kill') puffs += fx.big ? 100 : 1;
    state.fx.length = 0;
    for (const b of state.buildings.values()) assert.equal(b.hp, hp.get(b.uid), `${b.def} damaged during the dawn retreat`);
  }
  assert.equal(threat.liveCount, 0, 'the field is clear after the retreat window');
  assert.ok(t <= 6 + 0.1, `retreat took ${t.toFixed(2)} s`);
  assert.ok(puffs >= 1 && puffs < 100, 'despawns show a small puff, never a big kill');
  assert.equal(state.kills, kills, 'despawns are not kills');
  assert.equal(state.stock.ferrite, fe, 'despawns pay no salvage');
}

// ── scripted night: every behaviour observed + census ────────────────────
function scriptedNight(seed: string): { seen: Set<FaunaDef['behaviour']>; checksum: number } {
  const state = landing(seed);
  const rng = new Rng(`${seed}:landing`);
  const threat = createThreat(state, rng);
  const fauna = threat.fauna;
  put(state, 'beacon_spire', 3, 4);
  for (let a = 0; a < 4; a += 1) put(state, 'pulse_turret', 3.5, a * 1.57);
  put(state, 'arc_coil', 4.5, 0.6);
  put(state, 'flak_mortar', 4.5, 2.4);
  for (let a = 0; a < 3; a += 1) put(state, 'relay_pylon', 5.5, a * 2.1 + 0.3);
  for (let a = 0; a < 48; a += 1) put(state, 'plate_barricade', 5.5, (a * Math.PI) / 24);
  // The director would end the Landing on core loss; here the core holds so the night keeps running.
  const core = state.core;
  assert.ok(core !== undefined);
  core.hp = 1e9;
  core.maxHp = 1e9;
  const hard = 4;
  const wave: Array<[Parameters<typeof threat.spawn>[0], number]> = [
    ['skitter', 12], ['spitter', 3], ['brute', 2], ['moth', 4], ['burrower', 3], ['sapper', 3], ['bloater', 2], ['howler', 2], ['matron', 1], ['titan', 1],
  ];
  wave.forEach(([id, count], k) => {
    for (let i = 0; i < count; i += 1) threat.spawn(id, ((k + i) % 4) as 0 | 1 | 2 | 3, hard);
  });
  const seen = new Set<FaunaDef['behaviour']>();
  const dt = 1 / 60;
  const { cols, rows } = state.map;
  let lastBroodCd = Infinity;
  for (let frame = 0; frame < 60 * 120; frame += 1) {
    const hpBefore = new Map<number, number>();
    for (const b of state.buildings.values()) hpBefore.set(b.uid, b.hp);
    threat.tick(dt, state);
    let alive = 0;
    const holders = new Set<number>();
    for (const f of fauna.pool) {
      if (!f.alive) continue;
      alive += 1;
      assert.ok(f.hp <= f.maxHp + 1e-6, 'hp ≤ maxHp');
      assert.ok(f.x > -TILE * 2 && f.y > -TILE * 2 && f.x < (cols + 2) * TILE && f.y < (rows + 2) * TILE, `${f.def.id} left the map`);
      if (!f.def.flying && !f.hidden && !f.retreating) {
        assert.equal(state.map.blocked[Math.floor(f.y / TILE) * cols + Math.floor(f.x / TILE)], 0, `${f.def.id} walked onto rock`);
      }
      if (f.latched !== 0) holders.add(f.latched);
      const target = f.chewing !== 0 ? state.buildings.get(f.chewing) : undefined;
      switch (f.def.behaviour) {
        case 'chew':
          if (target !== undefined) seen.add('chew');
          break;
        case 'shell':
          if (target !== undefined && buildingDef(target.def).turret !== null) seen.add('shell');
          break;
        case 'ram':
          if (target?.def === 'plate_barricade' && (hpBefore.get(target.uid) ?? 0) - target.hp > f.def.dps * f.dmgMul * dt * 2.5) seen.add('ram');
          break;
        case 'lamp':
          if (target?.def === 'relay_pylon') seen.add('lamp');
          break;
        case 'burrow':
          if (f.hidden) seen.add('burrow');
          break;
        case 'latch':
          if (f.latched !== 0) seen.add('latch');
          break;
        case 'rally':
          break;
        case 'brood':
          if (f.cd > lastBroodCd + 1) seen.add('brood');
          lastBroodCd = f.cd;
          break;
        case 'titan':
          if (target !== undefined && (hpBefore.get(target.uid) ?? 0) > target.hp) seen.add('titan');
          break;
        default:
          break;
      }
      if (f.rallied && f.def.behaviour !== 'rally') seen.add('rally');
    }
    for (const uid of state.latched) assert.ok(holders.has(uid), `relay ${uid} latched without a living leech`);
    assert.equal(alive, fauna.liveCount, 'live count == alive slots');
    for (const fx of state.fx) if (fx.kind === 'kill' && fx.big) {
      // A bloat death is the only big kill that broods; count it once seen.
      if (fauna.pool.some((f) => f.alive && f.def.id === 'skitter' && Math.hypot(f.x - fx.x, f.y - fx.y) < 30)) seen.add('burst');
    }
    state.fx.length = 0;
    if (seen.size === 10 && frame > 60 * 30) break;
  }
  let checksum = 0;
  for (const f of fauna.pool) if (f.alive) checksum += f.x * 3 + f.y * 7 + f.hp;
  return { seen, checksum: checksum + state.kills };
}

const night = scriptedNight('night-a');
const all: FaunaDef['behaviour'][] = ['chew', 'shell', 'ram', 'lamp', 'burrow', 'latch', 'burst', 'rally', 'brood', 'titan'];
const missing = all.filter((b) => !night.seen.has(b));
assert.deepEqual(missing, [], `behaviours never observed: ${missing.join(', ')}`);
assert.equal(scriptedNight('night-a').checksum, night.checksum, 'same seed ⇒ same night');

console.log(`colonyThreat OK — 8 sites × 3 sizes, trickle, fixtures, all 10 behaviours observed (${[...night.seen].join(', ')})`);
