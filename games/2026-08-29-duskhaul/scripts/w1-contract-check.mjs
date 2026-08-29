/**
 * W1 scoped smoke check — the runtime contracts the slice cannot express in
 * types. `systems/zone.ts` and `objects/enemy.ts` deliberately THROW on a
 * missing content param rather than defaulting, and the slice reads ~40 TUNING
 * paths that only exist if W6 landed them, so both classes of failure are
 * invisible to `tsc` and fatal at run start.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/w1-contract-check.mjs
 *
 * Imports only the Phaser-free data modules, so it runs in plain Node.
 */
import { TUNING } from '../src/config.ts';
import { ZONES } from '../src/data/zones.ts';
import { ENEMIES } from '../src/data/enemies.ts';
import { WAVES, TIMELINE_EVENTS } from '../src/data/waves.ts';

const failures = [];
const notes = [];

/** Params `systems/zone.ts` calls `requireParam` for, per hazard kind. */
const HAZARD_REQUIRED = {
  braziers: ['count', 'radius', 'intervalS', 'telegraphS', 'damage'],
  bonestorm: ['dotZones', 'dotRadius', 'intervalS', 'gustS', 'pushPxPerS', 'dotDps'],
  sinksand: ['pits', 'radius', 'slowPct', 'scorchFromS', 'scorchToS', 'scorchDps', 'shadeRadius'],
  gale: ['iceSheets', 'iceRadius', 'torches', 'torchRadius', 'slowPct', 'iceFriction'],
};

/** Params `objects/enemy.ts` calls `requireParam` for, per behaviour verb. */
const VERB_REQUIRED = {
  chase: [],
  swarm: ['packSize'],
  ranged: ['rangePx', 'fireEveryMs'],
  'orbit-charge': ['orbitRadiusPx', 'windupMs'],
  tank: [],
  drift: [],
  burst: [],
  split: ['splitGenerations'],
  aura: ['auraRadiusPx'],
  flee: [],
  teleport: ['blinkPx', 'blinkEveryS'],
  elite: [],
  boss: ['standoffPx'],
};

/** Conditional params: present one, and the rest of the group is required. */
const VERB_CONDITIONAL = [
  { trigger: 'slamEveryS', requires: ['slamRadiusPx'] },
  { trigger: 'enrageBelowPct', requires: ['enragedMoveSpeed'] },
  { trigger: 'webEveryS', requires: ['webRadiusPx', 'webSlowPct'] },
  { trigger: 'slickEveryS', requires: ['slickRadiusPx', 'slickSlowPct'] },
  { trigger: 'sweepEveryS', requires: ['telegraphMs', 'sweepReachPx'] },
];

/** Every TUNING path the slice, zone system and enemy body actually read. */
const TUNING_PATHS = [
  'runSeconds',
  'player.maxHp', 'player.size',
  'arena.width', 'arena.height', 'arena.wallThickness', 'arena.spawnClearRadius',
  'arena.cameraLerp', 'arena.cameraOffsetY',
  'enemy.spawnMargin', 'enemy.maxAlive', 'enemy.healAuraIntervalMs', 'enemy.healAuraRadius',
  'enemy.healAuraAmount', 'enemy.chargeTelegraphMs', 'enemy.hitMs',
  'boss.phase2At', 'boss.phase3At', 'boss.volleyCooldownMs', 'boss.ringCooldownMs',
  'boss.ringTelegraphMs', 'boss.enrageSpeedMul', 'boss.shieldDamageMul',
  'elite.atS', 'elite.gateGuardAtS', 'elite.gateGuardGate', 'elite.gateGuardRadiusPx',
  'elite.gateGuardAdds', 'elite.coinDropMin', 'elite.coinDropMax',
  'gate.radius', 'gate.closingWarnS', 'gate.previewS',
  'extract.channelMs', 'extract.suppressRadius', 'extract.gateWindowBonusS',
  'collapse.atS', 'collapse.centerGate', 'collapse.minRadius', 'collapse.ringSpeedPxPerS',
  'collapse.ringAccel', 'collapse.ringSpeedMax', 'collapse.fireDps', 'collapse.fireDpsStep',
  'collapse.fireDpsMax', 'collapse.eliteEveryS', 'collapse.stopTrashDrip',
  'collapse.threatStep', 'collapse.stepEveryS', 'collapse.spawnFloorMs',
  'bag.slots', 'bag.casketSlots', 'bag.dropLingerS',
  'loot.firstRelicS', 'loot.relicDripS', 'loot.eliteRelics', 'loot.eliteTierBias',
  'loot.bossTierBias', 'loot.cacheEveryS', 'loot.cacheValue', 'loot.cacheMinDist',
  'loot.cacheMaxDist', 'loot.cacheLingerS',
  'chest.atS', 'chest.tierBias', 'chest.relics',
  'shrine.atS', 'shrine.densityMul', 'shrine.radiusPx', 'shrine.tierBias', 'shrine.minTier',
  'warden.atS', 'warden.gate', 'warden.spawnOffsetPx',
  'wave.compositionFromS', 'wave.eliteSwapEveryS', 'wave.eliteShareMax',
  'draft.choices', 'draft.rerollCost', 'meta.deathKeepPct',
  'economy.scorePerKill', 'economy.scorePerSecond', 'economy.winBonus',
  'economy.currencyPerElite',
  'events.breatherSilenceMs', 'events.breatherHealRatio', 'events.eliteRushCount',
  'caps.floatTextPerSecond', 'caps.shakeEntityLimit',
  // §13 juice-table spam caps, read by the slice's feedback layer.
  'caps.burstEntityLimit', 'caps.dieSfxPerSecond', 'caps.hitSfxPerSecond',
  'caps.hurtShakePerSecond',
  'xp.orbSpeed',
  'effects.lastGasp.reviveHpRatio', 'effects.lastGasp.iframesMs',
  'effects.glassCannon.hpCapRatio', 'effects.glassCannon.killIframesMs',
  'effects.bulwark.knockbackMul',
];

function read(path) {
  let node = TUNING;
  for (const key of path.split('.')) {
    if (node === undefined || node === null) return undefined;
    node = node[key];
  }
  return node;
}

// --- 1. every TUNING path the wave's code reads must exist -----------------
for (const path of TUNING_PATHS) {
  if (read(path) === undefined) failures.push(`TUNING.${path} is missing`);
}

// --- 2. every zone hazard carries the params zone.ts requires --------------
for (const zone of ZONES) {
  const required = HAZARD_REQUIRED[zone.hazard.kind];
  if (required === undefined) {
    failures.push(`zone ${zone.id}: hazard kind "${zone.hazard.kind}" has no implementation`);
    continue;
  }
  for (const key of required) {
    if (zone.hazard.params[key] === undefined) {
      failures.push(`zone ${zone.id} (${zone.hazard.kind}): missing hazard param "${key}"`);
    }
  }
  if (zone.gates.length !== 3) failures.push(`zone ${zone.id}: expected 3 gates`);
}

// --- 3. every enemy carries the params its verb requires -------------------
const verbsSeen = new Set();
for (const def of ENEMIES) {
  verbsSeen.add(def.behaviour);
  const required = VERB_REQUIRED[def.behaviour];
  if (required === undefined) {
    failures.push(`enemy ${def.id}: behaviour "${def.behaviour}" has no implementation`);
    continue;
  }
  for (const key of required) {
    if (def.params?.[key] === undefined) {
      failures.push(`enemy ${def.id} (${def.behaviour}): missing param "${key}"`);
    }
  }
  for (const rule of VERB_CONDITIONAL) {
    if (def.params?.[rule.trigger] === undefined) continue;
    for (const key of rule.requires) {
      if (def.params[key] === undefined) {
        failures.push(`enemy ${def.id}: has "${rule.trigger}" but is missing "${key}"`);
      }
    }
  }
}
for (const verb of Object.keys(VERB_REQUIRED)) {
  if (!verbsSeen.has(verb)) notes.push(`verb "${verb}" is implemented but unused by the roster`);
}

// --- 4. the schedule the slice promises actually exists in the data ---------
const spawnIds = new Set();
let lastWaveS = 0;
for (const wave of WAVES) {
  lastWaveS = Math.max(lastWaveS, wave.at);
  for (const slot of wave.spawns) spawnIds.add(slot.id);
}
const roster = new Set(ENEMIES.map((d) => d.id));
for (const id of spawnIds) {
  if (!roster.has(id)) failures.push(`waves.ts spawns unknown enemy id "${id}"`);
}
if (!spawnIds.has('warden')) failures.push('waves.ts never spawns the Warden');
for (const eliteId of ['elite_reaper', 'elite_matron', 'elite_herald']) {
  if (!spawnIds.has(eliteId)) failures.push(`waves.ts never spawns ${eliteId}`);
}
const chestTimes = TIMELINE_EVENTS.filter((e) => e.kind === 'chest').map((e) => e.at);
for (const at of TUNING.chest.atS) {
  if (!chestTimes.includes(at)) failures.push(`no chest event at ${at}s (TUNING.chest.atS)`);
}

// --- 5. the Collapse must leave Gate C standable ---------------------------
if (TUNING.collapse.minRadius <= TUNING.gate.radius) {
  failures.push(
    `collapse.minRadius ${TUNING.collapse.minRadius} <= gate.radius ${TUNING.gate.radius}: ` +
      'the ring would close over Gate C and make extraction impossible',
  );
}
if (TUNING.collapse.stopTrashDrip !== true) {
  notes.push('collapse.stopTrashDrip is false: the finale escalates by count again');
}

console.log(`checked ${TUNING_PATHS.length} TUNING paths, ${ZONES.length} zones, ${ENEMIES.length} enemies, ${WAVES.length} waves`);
for (const note of notes) console.log(`note: ${note}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  throw new Error(`${failures.length} contract failure(s)`);
}
console.log('W1 contract check: OK');
