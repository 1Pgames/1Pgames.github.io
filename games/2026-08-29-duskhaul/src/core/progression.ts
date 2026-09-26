import { TUNING } from '../config';
import { applyModifiers } from './stats';
import { load, save } from './storage';
import { Rng } from './rng';
import { addToSet, evaluateAchievements, inSet, recordCodex, bestiaryDamage, type AchievementContext } from './collections';
import { ingestRunReport, ingestWeekly, rollContracts, rollOneContract, bumpContracts, contractEligible, contractSlots, type ContractDomain } from './contracts';
import { dailyInfo, isoWeekKey, localDayKey, previousDayKey, riteMutators, weeklyInfo } from './daily';
import { ACHIEVEMENTS } from '../data/achievements';
import { CHARMS } from '../data/charms';
import { CLASSES, classDef } from '../data/classes';
import { WEAPONS } from '../data/weapons';
import { STARTER_UNTIL_LEVEL, WEEKLY_REWARD, contractDef, type ContractReward } from '../data/contracts';
import {
  GEAR_SLOTS,
  MAX_ITEM_LEVEL,
  LEGACY_RELIC_MAP,
  gearBehaviour,
  gearMods,
  gearName,
  rarityDef,
  rollGear,
  rollNewAffix,
} from '../data/gear';
import { hazardDef } from '../data/hazards';
import { mutatorDef } from '../data/mutators';
import { CONSUMABLES } from '../data/pickups';
import { ACCOUNT_LADDER, ACCOUNT_MAX_LEVEL, ROW_SPEND, SANCTUM, nodeCost, sanctumNode, type SanctumBranch } from '../data/sanctum';
import { valuableDef } from '../data/valuables';
import { zoneDef } from '../data/zones';
import type {
  CharmId,
  ClassId,
  ConsumableId,
  GearAffix,
  GearInstance,
  GearSlot,
  HazardLevel,
  LootItem,
  MetaResult,
  MetaSaveV4,
  MutatorId,
  PlayerStatKey,
  Rarity,
  RunJournalV2,
  RunLoadoutV2,
  RunMode,
  RunReport,
  SettlementReport,
  StatMod,
  ValuableInstance,
  WeaponId,
  ZoneId,
} from '../data/types-v2';

/**
 * Persistent meta-progression (PRD-V2 §5.15-5.28 meta side, §9, §10): the
 * v4 save, its deterministic v3 → v4 migration, the account ladder, zone and
 * hazard unlock rules, the Vault (equip/salvage/sell/merge/level/lock), the
 * Sanctum, the consumable belt, contracts/achievements claiming, the run
 * loadout the scene reads once in `create()`, and `settleRun`, the single
 * run → meta hand-off. The only reader/writer of the `meta` and `run`
 * storage slots.
 *
 * Every mutator returns `MetaResult` (§16.1 E29): on refusal nothing is
 * written and `reason` says why in player copy.
 */

const META_KEY = 'meta';
const JOURNAL_KEY = 'run';
const META_VERSION = 4;

const ZONE_ORDER: readonly ZoneId[] = ['castle', 'outlands', 'desert', 'winter'];
/** §5.20 zone unlock rule: account level AND ≥ 1 extraction in the previous zone (any hazard). */
const ZONE_UNLOCK: Readonly<Record<ZoneId, { level: number; prev: ZoneId | null }>> = {
  castle: { level: 1, prev: null },
  outlands: { level: 5, prev: 'castle' },
  desert: { level: 12, prev: 'outlands' },
  winter: { level: 20, prev: 'desert' },
};
/** Arsenal tables are the source of every weapon id and every weapon ↔ partner pair (`CharmDef.evolves`). */
const ALL_WEAPONS: readonly WeaponId[] = WEAPONS.map((w) => w.id);

/**
 * §5.8b.3 migration table: the weapons the PREVIOUS ladder gave at each
 * level (8 at L1, then censer L2, lash L3, breath L4, spears L5). A save that
 * played under it keeps them (with their partners) even where the pair
 * ladder unlocks them later. Literal ids on purpose: the old ladder is gone.
 */
const PRE_PAIR_WEAPONS: readonly [number, readonly WeaponId[]][] = [
  [1, ['bolt', 'orbit', 'nova', 'scythe', 'rail', 'hex', 'skull', 'sickle']],
  [2, ['censer']], [3, ['lash']], [4, ['breath']], [5, ['spears']],
];
/** Marker in `unlocks`: the pre-pair weapon grant has been applied (or the save started under the pair ladder). */
const PAIR_LADDER_MARK = 'migrated:pair-ladder';
const CONSUMABLE_IDS: readonly ConsumableId[] = ['cb_bread', 'cb_flask', 'cb_salt', 'cb_candle', 'cb_oil'];
const HAZARD_LEVELS: readonly HazardLevel[] = [1, 2, 3, 4, 5];
/** Account-wide flag: the H5 rung's 3 ✦ were paid (§9 "H5 unlock (3)"). */
const H5_PAID = 'hazard5:paid';

// ───────────── Save shape ─────────────

function emptyZoneRecord<T>(make: () => T): Record<ZoneId, T> {
  return { castle: make(), outlands: make(), desert: make(), winter: make() };
}

function defaultMeta(): MetaSaveV4 {
  return {
    version: 4,
    currency: 0,
    dust: 0,
    sigils: 0,
    account: { xp: 0 },
    unlocks: [PAIR_LADDER_MARK],
    upgrades: {},
    vault: { gear: [], valuables: [] },
    equipped: { hood: null, shroud: null, grips: null, boots: null, ring: null, amulet: null },
    classId: 'duskhauler',
    startWeapon: null,
    belt: [null, null],
    consumables: { cb_bread: 0, cb_flask: 0, cb_salt: 0, cb_candle: 0, cb_oil: 0 },
    selection: { zone: 'castle', hazard: emptyZoneRecord<HazardLevel>(() => 1), lastLoadoutHash: '' },
    stats: {
      runs: 0, extracts: 0, deaths: 0, bestHaul: {}, fastestExtractS: 0, latestExtractS: 0,
      kills: 0, eliteKills: 0, bossKills: {}, chests: 0, contractsClaimed: 0, deathStreak: 0,
    },
    mastery: emptyZoneRecord(() => ({ extract: false, gateC: false, bossAndExtract: false })),
    codex: { kills: {}, seen: {}, lore: [] },
    achievements: {},
    contracts: { active: [], rerollDay: '', rerollsLeft: 0, weekly: { week: '', step: 0, progress: 0 } },
    daily: { day: '', played: false, rewarded: false, streak: 0, lastDay: '' },
    weekly: { week: '', rewarded: false, best: 0 },
    flags: { ftueDone: false, ftueTries: 0, seenCoach: [], newBadges: [] },
    collections: {},
  };
}

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const numRecord = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isObj(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
  return out;
};
const isZone = (v: unknown): v is ZoneId => typeof v === 'string' && (ZONE_ORDER as readonly string[]).includes(v);
const isHazard = (v: unknown): v is HazardLevel => typeof v === 'number' && v >= 1 && v <= 5 && Number.isInteger(v);
const isClass = (v: unknown): v is ClassId => typeof v === 'string' && CLASSES.some((c) => c.id === v);
const isConsumable = (v: unknown): v is ConsumableId => typeof v === 'string' && (CONSUMABLE_IDS as readonly string[]).includes(v);

function coerceGear(v: unknown): GearInstance | null {
  if (!isObj(v) || typeof v.uid !== 'string' || typeof v.base !== 'string') return null;
  if (typeof v.slot !== 'string' || !(GEAR_SLOTS as readonly string[]).includes(v.slot)) return null;
  const rarity = num(v.rarity, 1);
  if (rarity < 1 || rarity > 6) return null;
  const affixes: GearAffix[] = Array.isArray(v.affixes)
    ? v.affixes.filter((a): a is GearAffix => isObj(a) && typeof a.id === 'string' && typeof a.value === 'number').map((a) => ({ id: a.id, value: a.value }))
    : [];
  const item: GearInstance = { uid: v.uid, base: v.base, slot: v.slot as GearSlot, rarity: rarity as Rarity, level: Math.max(1, Math.min(MAX_ITEM_LEVEL, num(v.level, 1))), affixes };
  if (typeof v.unique === 'string') item.unique = v.unique;
  if (v.locked === true) item.locked = true;
  const rerolls = num(v.rerolls, 0);
  if (rerolls > 0) (item as GearInstance & { rerolls?: number }).rerolls = Math.floor(rerolls);
  return item;
}

function coerceBeltSlot(v: unknown): { id: ConsumableId; charges: number } | null {
  if (!isObj(v) || !isConsumable(v.id)) return null;
  return { id: v.id, charges: Math.max(0, num(v.charges, 0)) };
}

/** Fills every field of a (possibly partial / hand-edited) v4 blob, dropping malformed entries. Never shares containers with the input. */
function coerceMeta(raw: Loose): MetaSaveV4 {
  const d = defaultMeta();
  const m: MetaSaveV4 = d;
  m.currency = Math.max(0, num(raw.currency, 0));
  m.dust = Math.max(0, num(raw.dust, 0));
  m.sigils = Math.max(0, num(raw.sigils, 0));
  m.account.xp = isObj(raw.account) ? Math.max(0, num(raw.account.xp, 0)) : 0;
  m.unlocks = strs(raw.unlocks);
  m.upgrades = numRecord(raw.upgrades);
  if (isObj(raw.vault)) {
    m.vault.gear = (Array.isArray(raw.vault.gear) ? raw.vault.gear : []).map(coerceGear).filter((g): g is GearInstance => g !== null);
    m.vault.valuables = (Array.isArray(raw.vault.valuables) ? raw.vault.valuables : [])
      .filter((x): x is ValuableInstance => isObj(x) && typeof x.uid === 'string' && typeof x.id === 'string')
      .map((x) => ({ uid: x.uid, id: x.id }));
  }
  if (isObj(raw.equipped)) {
    for (const slot of GEAR_SLOTS) {
      const uid = raw.equipped[slot];
      m.equipped[slot] = typeof uid === 'string' && m.vault.gear.some((g) => g.uid === uid && g.slot === slot) ? uid : null;
    }
  }
  if (isClass(raw.classId)) m.classId = raw.classId;
  if (typeof raw.startWeapon === 'string' && ALL_WEAPONS.includes(raw.startWeapon as WeaponId)) m.startWeapon = raw.startWeapon as WeaponId;
  if (Array.isArray(raw.belt)) m.belt = [coerceBeltSlot(raw.belt[0]), coerceBeltSlot(raw.belt[1])];
  if (isObj(raw.consumables)) for (const id of CONSUMABLE_IDS) m.consumables[id] = Math.max(0, num(raw.consumables[id], 0));
  if (isObj(raw.selection)) {
    if (isZone(raw.selection.zone)) m.selection.zone = raw.selection.zone;
    if (isObj(raw.selection.hazard)) for (const z of ZONE_ORDER) if (isHazard(raw.selection.hazard[z])) m.selection.hazard[z] = raw.selection.hazard[z] as HazardLevel;
    if (typeof raw.selection.lastLoadoutHash === 'string') m.selection.lastLoadoutHash = raw.selection.lastLoadoutHash;
  }
  if (isObj(raw.stats)) {
    const s = raw.stats;
    const t = m.stats;
    t.runs = num(s.runs, 0); t.extracts = num(s.extracts, 0); t.deaths = num(s.deaths, 0);
    t.bestHaul = numRecord(s.bestHaul); t.fastestExtractS = num(s.fastestExtractS, 0); t.latestExtractS = num(s.latestExtractS, 0);
    t.kills = num(s.kills, 0); t.eliteKills = num(s.eliteKills, 0); t.bossKills = numRecord(s.bossKills);
    t.chests = num(s.chests, 0); t.contractsClaimed = num(s.contractsClaimed, 0); t.deathStreak = num(s.deathStreak, 0);
  }
  if (isObj(raw.mastery)) {
    for (const z of ZONE_ORDER) {
      const r = raw.mastery[z];
      if (isObj(r)) m.mastery[z] = { extract: r.extract === true, gateC: r.gateC === true, bossAndExtract: r.bossAndExtract === true };
    }
  }
  if (isObj(raw.codex)) {
    m.codex.kills = numRecord(raw.codex.kills);
    if (isObj(raw.codex.seen)) for (const [k, v] of Object.entries(raw.codex.seen)) if (v === true) m.codex.seen[k] = true;
    m.codex.lore = strs(raw.codex.lore);
  }
  if (isObj(raw.achievements)) for (const [k, v] of Object.entries(raw.achievements)) if (v === 'done' || v === 'claimed') m.achievements[k] = v;
  if (isObj(raw.contracts)) {
    const c = raw.contracts;
    m.contracts.active = (Array.isArray(c.active) ? c.active : [])
      .filter((a): a is Loose => isObj(a) && typeof a.id === 'string' && contractDef(a.id) !== undefined)
      .map((a) => ({
        id: a.id as string,
        progress: Math.max(0, num(a.progress, 0)),
        target: num(a.target, contractDef(a.id as string)!.target),
        params: isObj(a.params) ? Object.fromEntries(Object.entries(a.params).filter((e): e is [string, string] => typeof e[1] === 'string')) : {},
      }));
    m.contracts.rerollDay = typeof c.rerollDay === 'string' ? c.rerollDay : '';
    m.contracts.rerollsLeft = num(c.rerollsLeft, 0);
    if (isObj(c.weekly)) {
      const step = num(c.weekly.step, 0);
      m.contracts.weekly = { week: typeof c.weekly.week === 'string' ? c.weekly.week : '', step: (step >= 0 && step <= 3 ? step : 0) as 0 | 1 | 2 | 3, progress: num(c.weekly.progress, 0) };
    }
  }
  if (isObj(raw.daily)) {
    const x = raw.daily;
    m.daily = { day: typeof x.day === 'string' ? x.day : '', played: x.played === true, rewarded: x.rewarded === true, streak: num(x.streak, 0), lastDay: typeof x.lastDay === 'string' ? x.lastDay : '' };
  }
  if (isObj(raw.weekly)) m.weekly = { week: typeof raw.weekly.week === 'string' ? raw.weekly.week : '', rewarded: raw.weekly.rewarded === true, best: num(raw.weekly.best, 0) };
  if (isObj(raw.flags)) {
    const f = raw.flags;
    m.flags = { ftueDone: f.ftueDone === true, ftueTries: num(f.ftueTries, 0), seenCoach: strs(f.seenCoach), newBadges: strs(f.newBadges) };
  }
  if (isObj(raw.collections)) for (const [k, v] of Object.entries(raw.collections)) if (Array.isArray(v)) m.collections[k] = strs(v);
  return m;
}

// ───────────── v3 → v4 migration (§10) ─────────────

/** The V1-V3 blob (`version` 1-3; v1/v2 lack the later additive fields — every read defaults). */
interface LegacyMetaSave {
  version?: number;
  currency?: number;
  unlocks?: string[];
  upgrades?: Record<string, number>;
  stats?: { runs?: number; wins?: number; bestScore?: number; bestTimeMs?: number; wardenKills?: number };
  stars?: Record<string, number>;
  streak?: unknown;
  collections?: Record<string, string[]>;
  boosters?: Record<string, number>;
  stash?: string[];
  gear?: { blade?: string | null; shroud?: string | null; trinket?: string | null };
}

/** V1 coach storage flags (`tut:<id>`) → V2 coach beat keys (step 8). */
const V1_COACH_MAP: Readonly<Record<string, string>> = { stick: 'coach:move', goal: 'coach:attack', gate: 'coach:gate' };

/**
 * `MIGRATIONS[3]`: deterministic, idempotent v3 → v4 (§10 steps 1-9). Pure:
 * `v1CoachSeen` is the list of V1 coach ids whose `tut:<id>` flag was set
 * (the caller reads storage). v1/v2 saves take the same path — every V3
 * field they lack defaults exactly as the v1→v2→v3 steps did (additively).
 */
function migrateV3toV4(raw: LegacyMetaSave, v1CoachSeen: readonly string[] = []): MetaSaveV4 {
  const m = defaultMeta();
  const stats = raw.stats ?? {};
  const runs = num(stats.runs, 0);
  const wins = num(stats.wins, 0);
  // 1.
  m.currency = Math.max(0, num(raw.currency, 0));
  // 2. ids unchanged; unknown dropped; clamped to the V2 max (m_tithe 1 = 40%).
  for (const [id, lvl] of Object.entries(raw.upgrades ?? {})) {
    const def = sanctumNode(id);
    if (!def || typeof lvl !== 'number' || lvl <= 0) continue;
    m.upgrades[id] = Math.min(def.max, Math.floor(lvl));
  }
  // 3.
  m.unlocks = [...new Set((raw.unlocks ?? []).filter((u) => typeof u === 'string' && u.startsWith('zone:')))];
  for (const key of ['class:duskhauler', 'weapon:bolt', 'weapon:orbit', 'weapon:nova', 'weapon:scythe']) if (!m.unlocks.includes(key)) m.unlocks.push(key);
  // 4.
  m.account.xp = runs * 150 + wins * 100;
  // 5. + 6.
  const stash = Array.isArray(raw.stash) ? raw.stash : [];
  const firstUidByRelic: Record<string, string> = {};
  stash.forEach((relicId, index) => {
    const item = convertLegacyRelic(relicId, `m3-${index}`);
    if (!item) return;
    m.vault.gear.push(item);
    if (firstUidByRelic[relicId] === undefined) firstUidByRelic[relicId] = item.uid;
  });
  const gear = raw.gear ?? {};
  for (const v1slot of ['blade', 'shroud', 'trinket'] as const) {
    const relicId = gear[v1slot];
    if (typeof relicId !== 'string') continue;
    const uid = firstUidByRelic[relicId];
    if (uid === undefined) continue;
    const item = m.vault.gear.find((g) => g.uid === uid)!;
    if (m.equipped[item.slot] === null) m.equipped[item.slot] = uid;
  }
  // 7.
  m.stats.runs = runs;
  m.stats.extracts = wins;
  m.stats.deaths = Math.max(0, runs - wins);
  m.stats.bestHaul = { castle: num(stats.bestScore, 0) };
  m.stats.bossKills = { castle: num(stats.wardenKills, 0) };
  // 8.
  m.flags.ftueDone = runs > 0;
  m.flags.seenCoach = [...new Set(v1CoachSeen.map((id) => V1_COACH_MAP[id]).filter((k): k is string => k !== undefined))];
  // 9. stars/streak/boosters dropped; collections kept.
  if (raw.collections) for (const [k, v] of Object.entries(raw.collections)) if (Array.isArray(v)) m.collections[k] = strs(v);
  return m;
}

const MIGRATIONS: Readonly<Record<number, (raw: LegacyMetaSave, coach?: readonly string[]) => MetaSaveV4>> = { 3: migrateV3toV4 };

function readV1CoachFlags(): string[] {
  return Object.keys(V1_COACH_MAP).filter((id) => load<boolean>(`tut:${id}`, false) === true);
}

/** A journal younger than this (s) is a reload, not an abandoned run. */
const ABANDON_GRACE_S = 5;

/** Converts one V1 relic id into a level-1 item via `LEGACY_RELIC_MAP`, or null for an unknown id. */
function convertLegacyRelic(relicId: string, uid: string): GearInstance | null {
  const c = LEGACY_RELIC_MAP[relicId];
  if (!c) return null;
  const item: GearInstance = { uid, base: c.base, slot: c.slot, rarity: c.rarity, level: 1, affixes: c.affixes.map((a) => ({ ...a })) };
  if (c.unique !== undefined) item.unique = c.unique;
  return item;
}

/** Tops the contract board up to the save's slot count (deterministic draw from save state). True when it changed. */
function fillContracts(meta: MetaSaveV4): boolean {
  const domain = contractDomain(meta);
  const before = meta.contracts.active.map((c) => `${c.id}:${c.target}`).join(',');
  // Untouched contracts the board may no longer offer (a save rolled before
  // the starter pool / feature gates, e.g. `m_sell` at L2) are re-dealt.
  meta.contracts.active = meta.contracts.active.filter((c) => {
    const def = contractDef(c.id);
    return def !== undefined && (c.progress > 0 || contractEligible(def, domain));
  });
  if (meta.contracts.active.length < domain.slots) {
    rollContracts(meta, new Rng(`contracts:${meta.stats.contractsClaimed}:${meta.stats.runs}:${meta.contracts.active.map((c) => c.id).join(',')}`));
  }
  return meta.contracts.active.map((c) => `${c.id}:${c.target}`).join(',') !== before;
}

/** §16.1 E29: reads the save, migrating (and persisting) any pre-v4 blob. */
export function loadMeta(): MetaSaveV4 {
  const raw = load<unknown>(META_KEY, null);
  let meta: MetaSaveV4;
  let dirty = false;
  if (!isObj(raw)) {
    meta = defaultMeta();
  } else if (num(raw.version, 0) < META_VERSION) {
    meta = coerceMeta(MIGRATIONS[3]!(raw as LegacyMetaSave, readV1CoachFlags()) as unknown as Loose);
    dirty = true;
  } else {
    meta = coerceMeta(raw);
  }
  if (migratePairLadder(meta)) dirty = true;
  if (fillContracts(meta)) dirty = true;
  if (featureUnlocked(meta, 'feature:contracts') && refreshRerolls(meta)) dirty = true;
  if (dirty) saveMeta(meta);
  return meta;
}

function saveMeta(meta: MetaSaveV4): void {
  save(META_KEY, meta);
}

/** Settings "Reset save": a fresh v4 save (FTUE runs again). Clears the run journal too. */
export function resetMeta(): MetaSaveV4 {
  const meta = defaultMeta();
  saveMeta(meta);
  save(JOURNAL_KEY, null);
  lastNode = null;
  return meta;
}

// ───────────── Account ladder & unlock rules ─────────────

/** XP from level L to L+1: `xpBase + xpStep × (L−1)`. */
function xpToNext(level: number): number {
  return TUNING.account.xpBase + TUNING.account.xpStep * (level - 1);
}

/** §16.1 E29. At L40 `xpNeeded` is 0 (ladder complete) and `xpInto` is the overflow. */
export function accountLevel(m: MetaSaveV4): { level: number; xpInto: number; xpNeeded: number } {
  let level = 1;
  let rest = m.account.xp;
  while (level < ACCOUNT_MAX_LEVEL && rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level += 1;
  }
  return { level, xpInto: rest, xpNeeded: level >= ACCOUNT_MAX_LEVEL ? 0 : xpToNext(level) };
}

/** Every ladder key reached at `level`. */
function ladderKeys(level: number): string[] {
  return ACCOUNT_LADDER.filter((row) => row.level <= level).flatMap((row) => row.unlocks);
}

/** Ladder/persisted unlock query (keys: see `data/sanctum.ts ACCOUNT_LADDER`). */
export function featureUnlocked(meta: MetaSaveV4, key: string): boolean {
  return meta.unlocks.includes(key) || ladderKeys(accountLevel(meta).level).includes(key);
}

/** Highest hazard extracted at in any zone (0 before the first extraction). */
function highestHazardCleared(meta: MetaSaveV4): number {
  let best = 0;
  for (const z of ZONE_ORDER) for (const h of HAZARD_LEVELS) if (h > best && extractedAt(meta, z, h)) best = h;
  return best;
}

/** Max item level: `10 + 2 × highest hazard cleared` (H1 → 12 … H5 → 20). Raising hazard is what opens the top of the item-level sink. */
export function itemLevelCap(meta: MetaSaveV4): number {
  const c = TUNING.gear.levelCap;
  return Math.min(MAX_ITEM_LEVEL, c.base + c.perHazard * highestHazardCleared(meta));
}

/** Highest rarity a merge may produce (Gilded until L19, Dread until L26, then Hallowed); 0 before Vault MERGE. */
function mergeRarityCap(meta: MetaSaveV4): number {
  if (!featureUnlocked(meta, 'feature:merge')) return 0;
  if (featureUnlocked(meta, 'merge:6')) return 6;
  if (featureUnlocked(meta, 'merge:5')) return 5;
  return 4;
}

export function beltSlotsUnlocked(meta: MetaSaveV4): 0 | 1 | 2 {
  if (featureUnlocked(meta, 'belt:2')) return 2;
  return featureUnlocked(meta, 'belt:1') ? 1 : 0;
}

/** True when an extraction at hazard ≥ h is on record in `zone`. */
function extractedAt(meta: MetaSaveV4, zone: ZoneId, h: HazardLevel): boolean {
  if (h === 1 && meta.mastery[zone].extract) return true;
  for (let k = h; k <= 5; k += 1) if (meta.stats.bestHaul[`${zone}:H${k}`] !== undefined) return true;
  return false;
}

/** §16.1 E29 zone rule: level + prior-zone extraction; V1 purchases (`zone:<id>` in unlocks) grandfathered. */
export function zoneStatus(z: ZoneId, meta: MetaSaveV4 = loadMeta()): { unlocked: boolean; reason: string } {
  const rule = ZONE_UNLOCK[z];
  if (rule.prev === null || meta.unlocks.includes(`zone:${z}`)) return { unlocked: true, reason: '' };
  const level = accountLevel(meta).level;
  const prevExtract = meta.mastery[rule.prev].extract;
  if (level >= rule.level && prevExtract) return { unlocked: true, reason: '' };
  const prevName = zoneDef(rule.prev).name;
  if (level < rule.level && !prevExtract) return { unlocked: false, reason: `Reach L${rule.level} and extract in ${prevName}` };
  if (level < rule.level) return { unlocked: false, reason: `Reach L${rule.level}` };
  return { unlocked: false, reason: `Extract in ${prevName}` };
}

/** §16.1 E29 hazard rule (§5.21). H5 reads unlocked once its 3 ✦ are paid or affordable (paid on first `selectZone`). */
export function hazardStatus(z: ZoneId, h: HazardLevel, meta: MetaSaveV4 = loadMeta()): { unlocked: boolean; reason: string } {
  const zone = zoneStatus(z, meta);
  if (!zone.unlocked) return { unlocked: false, reason: zone.reason };
  if (h === 1) return { unlocked: true, reason: '' };
  const def = hazardDef(h);
  const level = accountLevel(meta).level;
  if (level < def.unlockLevel) return { unlocked: false, reason: `Reach L${def.unlockLevel}` };
  if (!extractedAt(meta, z, (h - 1) as HazardLevel)) return { unlocked: false, reason: `Extract at H${h - 1} to unlock` };
  if (def.sigilCost > 0 && !meta.unlocks.includes(H5_PAID) && meta.sigils < def.sigilCost) {
    return { unlocked: false, reason: `Needs ${def.sigilCost} ✦` };
  }
  return { unlocked: true, reason: '' };
}

export function highestUnlockedHazard(zone: ZoneId, meta: MetaSaveV4 = loadMeta()): HazardLevel {
  let best: HazardLevel = 1;
  for (const h of HAZARD_LEVELS) if (hazardStatus(zone, h, meta).unlocked) best = h;
  return best;
}

/** Skip rule (§14.4): true once any run in `z` has settled. */
export function zonePlayed(z: ZoneId, meta: MetaSaveV4 = loadMeta()): boolean {
  return inSet(meta, 'zonesPlayed', z);
}

/** §5.8b.3: account-unlocked weapons (ladder rung or persisted grant). */
function unlockedWeapons(meta: MetaSaveV4 = loadMeta()): WeaponId[] {
  return ALL_WEAPONS.filter((w) => featureUnlocked(meta, `weapon:${w}`));
}

/**
 * §5.8b.3 offer rule: the partners of unlocked weapons, plus Gloam Step
 * (`charm:c_step`, L6). A charm whose weapon is locked is never included.
 */
function unlockedCharms(meta: MetaSaveV4 = loadMeta()): CharmId[] {
  const weapons = unlockedWeapons(meta);
  return CHARMS.filter((c) => (c.evolves === null ? featureUnlocked(meta, `charm:${c.id}`) : weapons.includes(c.evolves))).map((c) => c.id);
}

/**
 * Grants a pre-pair save every weapon the old ladder had given it at its
 * level, as persisted `weapon:<id>` + `charm:<partner>` keys (nothing is
 * revoked). Runs once per save; fresh saves are marked without a grant.
 */
function migratePairLadder(meta: MetaSaveV4): boolean {
  if (meta.unlocks.includes(PAIR_LADDER_MARK)) return false;
  const played = meta.stats.runs > 0 || meta.account.xp > 0;
  if (played) {
    const level = accountLevel(meta).level;
    for (const [at, ids] of PRE_PAIR_WEAPONS) {
      if (at > level) continue;
      for (const w of ids) {
        if (!meta.unlocks.includes(`weapon:${w}`)) meta.unlocks.push(`weapon:${w}`);
        const partner = CHARMS.find((c) => c.evolves === w);
        if (partner && !meta.unlocks.includes(`charm:${partner.id}`)) meta.unlocks.push(`charm:${partner.id}`);
      }
    }
  }
  meta.unlocks.push(PAIR_LADDER_MARK);
  return true;
}

function unlockedZones(meta: MetaSaveV4): ZoneId[] {
  return ZONE_ORDER.filter((z) => zoneStatus(z, meta).unlocked);
}

/** Param domains + board size for `core/contracts.ts rollContracts`. */
export function contractDomain(meta: MetaSaveV4): ContractDomain {
  const zones = unlockedZones(meta);
  const maxHazard = zones.reduce<HazardLevel>((best, z) => Math.max(best, highestUnlockedHazard(z, meta)) as HazardLevel, 1);
  const level = accountLevel(meta).level;
  const features = ['feature:sell', 'feature:merge'].filter((k) => featureUnlocked(meta, k));
  return { weapons: unlockedWeapons(meta), zones, maxHazard, slots: contractSlots(level), starter: level < STARTER_UNTIL_LEVEL, features };
}

// ───────────── Sanctum ─────────────

/** Shards spent in a branch (sum of every bought level's price). */
export function branchSpent(meta: MetaSaveV4, branch: SanctumBranch): number {
  let total = 0;
  for (const node of SANCTUM) {
    if (node.branch !== branch || node.currency !== 'shards') continue;
    const lvl = meta.upgrades[node.id] ?? 0;
    for (let i = 0; i < lvl; i += 1) total += nodeCost(node, i).shards;
  }
  return total;
}

export function nodeUnlocked(meta: MetaSaveV4, id: string): { unlocked: boolean; reason: string } {
  const node = sanctumNode(id);
  if (!node) return { unlocked: false, reason: 'Unknown node' };
  if (node.row > 1) {
    const need = ROW_SPEND[node.row - 1]!;
    if (branchSpent(meta, node.branch) < need) return { unlocked: false, reason: `Spend ${need.toLocaleString('en-US')} ◆ in ${node.branch} to open` };
  }
  if (node.requires !== undefined && (meta.upgrades[node.requires] ?? 0) === 0) {
    return { unlocked: false, reason: `Needs ${sanctumNode(node.requires)?.flavor ?? node.requires}` };
  }
  return { unlocked: true, reason: '' };
}

/** Per-level StatMod contributions of the stat-bearing nodes (non-stat nodes are folded into loadout scalars). */
const NODE_MODS: Readonly<Record<string, readonly { stat: PlayerStatKey; add?: number; mul?: number }[]>> = {
  n_oath: [{ stat: 'maxHp', add: 10 }, { stat: 'pickupRadius', add: 10 }],
  m_vitality: [{ stat: 'maxHp', add: 10 }],
  m_might: [{ stat: 'damageMul', add: 0.06 }],
  m_haste: [{ stat: 'moveSpeed', mul: 0.04 }],
  b_regen: [{ stat: 'regenPerS', add: 0.2 }],
  b_armor: [{ stat: 'contactDamageMul', add: -0.04 }],
  b_crit: [{ stat: 'critChance', add: 0.02 }],
  b_area: [{ stat: 'area', add: 0.05 }],
  b_cool: [{ stat: 'cooldownMul', add: -0.03 }],
  b_proj: [{ stat: 'projectileBonus', add: 1 }],
  m_greed: [{ stat: 'shardsMul', add: 0.08 }],
  m_magnet: [{ stat: 'pickupRadius', add: 20 }],
  g_luck: [{ stat: 'luck', add: 1 }],
};

/** In-session undo slot for the last Sanctum purchase (§14.7 3 s UNDO toast). Cleared by any other mutation. */
let lastNode: { id: string; shards: number; sigils: number } | null = null;

// ───────────── Loadout ─────────────

interface ResolvedLoadout { loadout: RunLoadoutV2; eliteDamagePct: number; labels: Record<string, string> }

function lvl(meta: MetaSaveV4, id: string): number {
  return meta.upgrades[id] ?? 0;
}

function equippedItems(meta: MetaSaveV4): GearInstance[] {
  const out: GearInstance[] = [];
  for (const slot of GEAR_SLOTS) {
    const uid = meta.equipped[slot];
    if (uid === null || !featureUnlocked(meta, `slot:${slot}`)) continue;
    const item = meta.vault.gear.find((g) => g.uid === uid);
    if (item) out.push(item);
  }
  return out;
}

function beltCap(meta: MetaSaveV4): number {
  return 1 + lvl(meta, 'e_belt');
}

function resolveLoadout(meta: MetaSaveV4, sel: { zone: ZoneId; hazard: HazardLevel; mode: RunMode; seed: string; mutators: MutatorId[] }): ResolvedLoadout {
  const labels: Record<string, string> = {};
  const hz = hazardDef(sel.hazard);
  const classId = featureUnlocked(meta, `class:${meta.classId}`) ? meta.classId : 'duskhauler';
  const cls = classDef(classId);
  const muts = sel.mutators.map(mutatorDef);

  // Order law (§16.1): class → sanctum → gear → mercy; mutator mods last.
  const modifiers: StatMod[] = [];
  for (const m of cls.mods) modifiers.push({ ...m });
  labels[`class:${classId}`] = cls.name;
  for (const node of SANCTUM) {
    const level = lvl(meta, node.id);
    const per = NODE_MODS[node.id];
    if (level === 0 || per === undefined) continue;
    const source = `sanctum:${node.id}`;
    labels[source] = node.flavor;
    for (const p of per) {
      const mod: StatMod = { stat: p.stat, source };
      if (p.add !== undefined) mod.add = p.add * level;
      if (p.mul !== undefined) mod.mul = p.mul * level;
      modifiers.push(mod);
    }
  }
  const ascension = lvl(meta, ASCENSION_ID);
  if (ascension > 0) {
    const source = `sanctum:${ASCENSION_ID}`;
    labels[source] = 'Dread Ascension';
    const per = TUNING.ascension.perRankPct / 100;
    modifiers.push({ stat: 'damageMul', add: per * ascension, source }, { stat: 'shardsMul', add: per * ascension, source });
  }

  let gearBag = 0;
  let gearChannel = 0;
  let gearProj = 0;
  let iframesMsBonus = 80 * lvl(meta, 'b_iframes');
  let gateWindowBonusS = 15 * lvl(meta, 'm_ward');
  let eliteDamagePct = 0;
  const uniques: string[] = [];
  const gearOn = !muts.some((m) => m.loadout.gearDisabled === true);
  if (gearOn) {
    for (const item of equippedItems(meta)) {
      labels[`gear:${item.uid}`] = gearName(item);
      for (const mod of gearMods(item)) {
        if (mod.stat === 'bagCells') gearBag += mod.add ?? 0;
        else if (mod.stat === 'channelMs') gearChannel += mod.add ?? 0;
        else if (mod.stat === 'projectileBonus') gearProj += mod.add ?? 0;
        else modifiers.push(mod);
      }
      const b = gearBehaviour(item);
      iframesMsBonus += b.iframesMs;
      gateWindowBonusS += b.gateWindowS;
      eliteDamagePct += b.eliteDamagePct;
      if (item.unique !== undefined) uniques.push(item.unique);
    }
    // §5.15.3 clamp: gear projectiles ≤ 1, gear bag cells ≤ 2.
    if (gearProj > 0) {
      modifiers.push({ stat: 'projectileBonus', add: Math.min(1, gearProj), source: 'gear:projectiles' });
      labels['gear:projectiles'] = 'Gear';
    }
  }

  const mercy = sel.mode !== 'ftue' && meta.stats.deathStreak >= TUNING.mercy.deathStreak;
  if (mercy) {
    modifiers.push({ stat: 'maxHp', mul: TUNING.mercy.hpBonus, source: 'mercy' });
    labels.mercy = "Grave's Pity";
  }

  let lootBias = hz.lootBias;
  let minimapRevealPx = TUNING.minimap.revealPx + 300 * lvl(meta, 'e_compass');
  let collapseAtS = hz.collapseAtS;
  const ladder = ladderKeys(accountLevel(meta).level);
  const ladderCount = (prefix: string): number => ladder.filter((k) => k.startsWith(prefix)).length;
  let casketSlots = TUNING.bag.casketSlots + lvl(meta, 'm_casket') + ladderCount('casket:');
  let deathKeepPct: number = lvl(meta, 'm_tithe') > 0 ? TUNING.meta.tithePct[Math.min(TUNING.meta.tithePct.length, lvl(meta, 'm_tithe')) - 1]! : TUNING.meta.deathKeepPct;
  let breakableDropMul = 1 + 0.1 * lvl(meta, 'g_breakable');
  for (const m of muts) {
    const p = m.loadout;
    const source = `mutator:${m.id}`;
    labels[source] = m.name;
    if (p.lootBias !== undefined) lootBias += p.lootBias;
    if (p.shardsMul !== undefined) modifiers.push({ stat: 'shardsMul', mul: p.shardsMul - 1, source });
    if (p.damageMul !== undefined) modifiers.push({ stat: 'damageMul', mul: p.damageMul - 1, source });
    if (p.maxHpMul !== undefined) modifiers.push({ stat: 'maxHp', mul: p.maxHpMul - 1, source });
    if (p.xpMul !== undefined) modifiers.push({ stat: 'xpMul', mul: p.xpMul - 1, source });
    if (p.regenMul !== undefined) modifiers.push({ stat: 'regenPerS', mul: p.regenMul - 1, source });
    if (p.minimapRevealPx !== undefined) minimapRevealPx = p.minimapRevealPx;
    if (p.collapseAtS !== undefined) collapseAtS = Math.min(collapseAtS, p.collapseAtS);
    if (p.casketSlots !== undefined) casketSlots = p.casketSlots;
    if (p.deathKeepPct !== undefined) deathKeepPct = p.deathKeepPct;
    if (p.breakableDropMul !== undefined) breakableDropMul *= p.breakableDropMul;
  }

  const forced = hz.forcedAffixes.length > 0 ? new Rng(`affix:${sel.seed}`).pick(hz.forcedAffixes) : null;
  const weapons = unlockedWeapons(meta);
  const startWeapon = effectiveStartWeapon(meta, cls.startWeapon);
  if (!weapons.includes(startWeapon)) weapons.unshift(startWeapon);
  const slots = beltSlotsUnlocked(meta);
  const belt: RunLoadoutV2['belt'] = [0, 1].map((i) => {
    const slot = meta.belt[i];
    if (i >= slots || !slot) return null;
    const charges = Math.min(meta.consumables[slot.id], beltCap(meta));
    return charges > 0 ? { id: slot.id, charges } : null;
  });

  const loadout: RunLoadoutV2 = {
    zone: sel.zone, hazard: sel.hazard, mode: sel.mode, seed: sel.seed, mutators: [...sel.mutators],
    classId, startWeapon,
    modifiers,
    unlockedWeapons: weapons,
    unlockedCharms: unlockedCharms(meta),
    bagCells: TUNING.bag.cols * TUNING.bag.rows + 2 * lvl(meta, 'm_bag') + (gearOn ? Math.min(2, gearBag) : 0),
    casketSlots,
    deathKeepPct,
    greedMaxMul: TUNING.greed.maxMul + (lvl(meta, 'g_greedcap') > 0 ? 0.15 : 0),
    tollPct: lvl(meta, 'e_toll') > 0 ? 0.15 : TUNING.gates.toll.pct,
    rerollsPerRun: TUNING.draft.rerollsPerRun + lvl(meta, 'm_reroll') + ladderCount('draft:reroll'),
    banishesPerRun: TUNING.draft.banishPerRun + lvl(meta, 'e_banish') + ladderCount('draft:banish'),
    startLevel: lvl(meta, 'b_startlevel') > 0 ? 2 : 1,
    startDreadKeys: lvl(meta, 'g_startkey'),
    reviveCharges: lvl(meta, 'm_revive') > 0 ? 1 : 0,
    reviveHpRatio: lvl(meta, 'b_undying') > 0 ? 0.5 : 0.3,
    reviveImmunityMs: lvl(meta, 'b_undying') > 0 ? 3000 : 0,
    iframesMsBonus,
    gateWindowBonusS,
    channelMsDelta: -500 * lvl(meta, 'm_extract') + (gearOn ? gearChannel : 0),
    contestedRate: lvl(meta, 'e_contest') > 0 ? 0.8 : TUNING.extract.contestedRate,
    previewS: lvl(meta, 'e_beacon') > 0 ? 120 : TUNING.gate.previewS,
    minimapRevealPx,
    speedNearGateMul: lvl(meta, 'e_speedgate') > 0 ? 1.2 : 1,
    gloamwalkMs: lvl(meta, 'e_gloamwalk') > 0 ? 1500 : 0,
    gravePact: lvl(meta, 'e_gravepact') > 0,
    fenceChance: lvl(meta, 'g_fence') > 0 ? 1 : TUNING.poi.fence.chance,
    fenceTrades: 1 + lvl(meta, 'g_fence'),
    veinMul: (1 + 0.25 * lvl(meta, 'g_vein')) * (cls.passiveParams.veinShardsMul ?? 1),
    veinStandMs: lvl(meta, 'g_vein') > 0 ? 2000 : TUNING.poi.vein.standMs,
    breakableDropMul,
    eliteExtraValuables: lvl(meta, 'g_midas'),
    belt,
    uniques,
    threatMul: hz.threatMul * (sel.mode === 'ftue' ? TUNING.ftue.threatMul : 1),
    lootBias,
    itemLevel: hz.itemLevel,
    hazardExtras: { eliteExtraAffix: hz.extraEliteAffix, forcedAffix: forced, collapseAtS, bossPhaseAt: [hz.bossPhaseAt[0], hz.bossPhaseAt[1]] },
    mercy,
  };
  return { loadout, eliteDamagePct, labels };
}

function runSelection(meta: MetaSaveV4, sel: { zone: ZoneId; hazard: HazardLevel; mode: RunMode; seed?: string }): { zone: ZoneId; hazard: HazardLevel; mode: RunMode; seed: string; mutators: MutatorId[] } {
  if (sel.mode === 'ftue') return { zone: 'castle', hazard: 1, mode: 'ftue', seed: 'wicket', mutators: [] };
  if (sel.mode === 'daily') {
    const d = dailyInfo(new Date());
    return { zone: d.zone, hazard: d.hazard, mode: 'daily', seed: d.seed, mutators: d.mutators };
  }
  if (sel.mode === 'weekly') {
    const w = weeklyInfo(new Date());
    return { zone: w.zone, hazard: w.hazard, mode: 'weekly', seed: w.seed, mutators: w.mutators };
  }
  void meta;
  return { zone: sel.zone, hazard: sel.hazard, mode: 'normal', seed: sel.seed ?? new Date().getTime().toString(36), mutators: [] };
}

/**
 * §16.1 E29: everything the save contributes to ONE run, resolved in one
 * read (call once in `create()`). Daily/weekly/ftue modes override zone,
 * hazard, seed and mutators with the period's rite. Records the loadout hash
 * for the hub's one-tap skip rule.
 *
 * Contract for consumers: `modifiers` never carry `bagCells`, `channelMs` or
 * gear `projectileBonus` beyond its clamp — those arrive resolved in
 * `bagCells`, `channelMsDelta` and one clamped `gear:projectiles` mod.
 * Mutator `loadout` params (data/mutators.ts) are folded here; their `run`
 * params are the scene's.
 */
export function runLoadout(sel: { zone: ZoneId; hazard: HazardLevel; mode: RunMode; seed?: string }): RunLoadoutV2 {
  const meta = loadMeta();
  const { loadout } = resolveLoadout(meta, runSelection(meta, sel));
  meta.selection.lastLoadoutHash = loadoutHashOf(meta);
  saveMeta(meta);
  return loadout;
}

/** Combat valves with no RunLoadoutV2 field: gear `a_elitedmg` and Bestiary tier bonuses (approved addition). Read once at run start. */
export function combatBonuses(): { eliteDamageMul: number; vsEnemyMul: Record<string, number> } {
  const meta = loadMeta();
  const sel = runSelection(meta, { zone: meta.selection.zone, hazard: meta.selection.hazard[meta.selection.zone], mode: 'normal', seed: 'bonus' });
  return { eliteDamageMul: 1 + resolveLoadout(meta, sel).eliteDamagePct / 100, vsEnemyMul: bestiaryDamage(meta) };
}

interface StatBreakdownRow { stat: PlayerStatKey; base: number; total: number; parts: { source: string; label: string; add: number; mul: number }[] }

/** ARMORY per-source stat panel for the current selection (normal mode). */
export function statBreakdown(meta: MetaSaveV4 = loadMeta()): StatBreakdownRow[] {
  const zone = meta.selection.zone;
  const { loadout, labels } = resolveLoadout(meta, runSelection(meta, { zone, hazard: meta.selection.hazard[zone], mode: 'normal', seed: 'breakdown' }));
  const rows: StatBreakdownRow[] = [];
  for (const [stat, base] of Object.entries(TUNING_BASE) as [PlayerStatKey, number][]) {
    const mods = loadout.modifiers.filter((m) => m.stat === stat);
    if (stat === 'bagCells') {
      rows.push({ stat, base, total: loadout.bagCells, parts: loadout.bagCells !== base ? [{ source: 'meta', label: 'Sanctum & gear', add: loadout.bagCells - base, mul: 0 }] : [] });
      continue;
    }
    if (stat === 'channelMs') {
      const total = base + loadout.channelMsDelta;
      rows.push({ stat, base, total, parts: loadout.channelMsDelta !== 0 ? [{ source: 'meta', label: 'Sanctum & gear', add: loadout.channelMsDelta, mul: 0 }] : [] });
      continue;
    }
    rows.push({
      stat, base, total: applyModifiers(base, mods, stat),
      parts: mods.map((m) => ({ source: m.source, label: labels[m.source] ?? m.source, add: m.add ?? 0, mul: m.mul ?? 0 })),
    });
  }
  return rows;
}

/** §5.2 base values (mirrors `PLAYER_BASE_STATS` for the union keys). */
const TUNING_BASE: Readonly<Record<PlayerStatKey, number>> = {
  maxHp: TUNING.player.maxHp, moveSpeed: TUNING.player.moveSpeed, damageMul: 1, cooldownMul: 1, area: 1,
  critChance: TUNING.player.critChance, critMul: TUNING.player.critMul, pickupRadius: TUNING.player.pickupRadius, shardsMul: 1,
  channelMs: TUNING.extract.channelMs, bagCells: TUNING.bag.cols * TUNING.bag.rows, projectileBonus: 0, durationMul: 1,
  regenPerS: TUNING.player.regenPerSecond, contactDamageMul: 1, xpMul: 1, luck: 0,
};

function fnv(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function loadoutHashOf(meta: MetaSaveV4): string {
  const zone = meta.selection.zone;
  const gear = GEAR_SLOTS.map((s) => {
    const item = meta.vault.gear.find((g) => g.uid === meta.equipped[s]);
    return item ? `${item.uid}:${item.level}:${item.rarity}:${item.affixes.length}` : '-';
  });
  const belt = meta.belt.map((b) => (b ? `${b.id}` : '-'));
  const nodes = Object.keys(meta.upgrades).sort().map((k) => `${k}${meta.upgrades[k]}`);
  return fnv([meta.classId, meta.startWeapon ?? '-', zone, meta.selection.hazard[zone], ...gear, ...belt, ...nodes].join('|'));
}

/** §16.1 E29: hash of class + gear + belt + sanctum + zone/hazard; equal to `selection.lastLoadoutHash` ⇒ nothing changed since the last run. */
export function loadoutHash(): string {
  return loadoutHashOf(loadMeta());
}

// ───────────── Rewards ─────────────

function grantReward(meta: MetaSaveV4, reward: ContractReward, seed: string): LootItem[] {
  meta.currency += reward.shards ?? 0;
  meta.dust += reward.dust ?? 0;
  meta.sigils += reward.sigils ?? 0;
  meta.account.xp += reward.xp ?? 0;
  const items: LootItem[] = [];
  const rng = new Rng(`reward:${seed}`);
  for (let i = 0; i < (reward.items ?? 0); i += 1) {
    const zone = meta.selection.zone;
    const item = rollGear(rng, { tierBias: reward.itemTierBias ?? 0, luck: 0, lootBias: 0, itemLevel: hazardDef(meta.selection.hazard[zone]).itemLevel, uniqueChance: 0, zone });
    meta.vault.gear.push(item);
    meta.codex.seen[`gear:${item.base}`] = true;
    items.push({ kind: 'gear', item });
  }
  return items;
}

function achievementCtx(meta: MetaSaveV4): AchievementContext {
  return {
    accountLevel: accountLevel(meta).level,
    classUnlockLevel: { duskhauler: 1, gravewarden: classDef('gravewarden').unlockLevel, ashwitch: classDef('ashwitch').unlockLevel, widowblade: classDef('widowblade').unlockLevel },
  };
}

// ───────────── Settlement ─────────────

function bankItem(meta: MetaSaveV4, it: LootItem): LootItem {
  const taken = (uid: string): boolean => meta.vault.gear.some((g) => g.uid === uid) || meta.vault.valuables.some((v) => v.uid === uid);
  let uid = it.item.uid;
  for (let n = 1; taken(uid); n += 1) uid = `${it.item.uid}~${n}`;
  if (it.kind === 'gear') {
    const item: GearInstance = { ...it.item, uid, affixes: it.item.affixes.map((a) => ({ ...a })) };
    meta.vault.gear.push(item);
    return { kind: 'gear', item };
  }
  const item: ValuableInstance = { uid, id: it.item.id };
  meta.vault.valuables.push(item);
  return { kind: 'valuable', item };
}

/** Hauler XP for one run (§5.20 + §5.21 hazard bonus). */
function haulerXp(r: RunReport): number {
  const a = TUNING.account;
  const extracted = r.outcome === 'extracted';
  const bosses = (r.bossKilled ? 1 : 0) + (r.midBossKilled ? 1 : 0);
  const base = r.kills * a.perKill + r.elapsedS * a.perSecond + r.poisVisited * a.perPoi + (extracted ? a.extractBonus : 0) + bosses * a.perBoss;
  return Math.round(base * (extracted ? 1 : a.deathMul) * (1 + TUNING.hazard.xpPerLevel * (r.hazard - 1)));
}

function zoneAndHazardKeys(meta: MetaSaveV4): string[] {
  const out: string[] = [];
  for (const z of ZONE_ORDER) {
    if (!zoneStatus(z, meta).unlocked) continue;
    out.push(`zone:${z}`);
    for (const h of HAZARD_LEVELS) if (h > 1 && hazardStatus(z, h, meta).unlocked) out.push(`hazard:${z}:${h}`);
  }
  return out;
}

/**
 * §16.1 E29 / §2.4: the single run → meta hand-off. Banks the settlement
 * (shards + kept items), folds stats/records/mastery/codex/contracts/
 * achievements/daily/weekly/FTUE/mercy/belt use, grants Hauler XP (always),
 * clears the run journal, persists, and returns the Results payload.
 */
export function settleRun(r: RunReport): SettlementReport {
  const meta = loadMeta();
  lastNode = null;
  const now = new Date();
  const extracted = r.outcome === 'extracted';
  const levelBefore = accountLevel(meta).level;
  const keysBefore = new Set(zoneAndHazardKeys(meta));
  const firstExtraction = extracted && meta.stats.extracts === 0;

  // Bank.
  meta.currency += Math.max(0, Math.floor(r.settlement.shardsBanked));
  const itemsBanked = r.settlement.kept.map((it) => bankItem(meta, it));

  // Stats & records.
  const s = meta.stats;
  s.runs += 1;
  if (extracted) s.extracts += 1;
  else s.deaths += 1;
  s.deathStreak = extracted ? 0 : s.deathStreak + 1;
  s.kills += r.kills;
  s.eliteKills += r.eliteKills;
  s.chests += r.chestsOpened;
  if (r.bossKilled) s.bossKills[r.zone] = (s.bossKills[r.zone] ?? 0) + 1;
  let bestHaul = false;
  if (extracted) {
    const haul = Math.floor(r.settlement.shardsBanked);
    const key = `${r.zone}:H${r.hazard}`;
    bestHaul = s.bestHaul[key] === undefined || haul > s.bestHaul[key]!;
    s.bestHaul[key] = Math.max(s.bestHaul[key] ?? 0, haul);
    s.bestHaul[r.zone] = Math.max(s.bestHaul[r.zone] ?? 0, haul);
    s.fastestExtractS = s.fastestExtractS === 0 ? r.elapsedS : Math.min(s.fastestExtractS, r.elapsedS);
    s.latestExtractS = Math.max(s.latestExtractS, r.elapsedS);
    const m = meta.mastery[r.zone];
    m.extract = true;
    if (r.gate?.id === 'c') m.gateC = true;
    if (r.bossKilled) m.bossAndExtract = true;
  }
  // First zone-boss kill per zone per hazard ⇒ 1 ✦ (§5.6).
  if (r.bossKilled && addToSet(meta, 'bossFirst', `${r.zone}:H${r.hazard}`)) meta.sigils += 1;

  // Codex.
  const codexNew = recordCodex(meta, r);

  // Belt: used charges leave the stock; loaded charges refresh.
  for (const id of r.beltUsed) meta.consumables[id] = Math.max(0, meta.consumables[id] - 1);
  meta.belt = [0, 1].map((i) => {
    const slot = meta.belt[i];
    return slot ? { id: slot.id, charges: Math.min(meta.consumables[slot.id], beltCap(meta)) } : null;
  }) as MetaSaveV4['belt'];

  // FTUE.
  if (r.mode === 'ftue') {
    if (extracted) meta.flags.ftueDone = true;
    else {
      meta.flags.ftueTries += 1;
      if (meta.flags.ftueTries > TUNING.ftue.maxRetries) meta.flags.ftueDone = true;
    }
  }

  // Daily Rite.
  let dailyReward: number | null = null;
  if (r.mode === 'daily') {
    const day = r.seed.startsWith('daily:') ? r.seed.slice(6) : localDayKey(now);
    const d = meta.daily;
    if (d.day !== day) {
      d.day = day;
      d.played = false;
      d.rewarded = false;
    }
    if (!d.played) {
      d.played = true;
      d.streak = d.lastDay === previousDayKey(day) ? d.streak + 1 : 1;
      d.lastDay = day;
      if (d.streak >= 7) {
        meta.sigils += 1;
        addToSet(meta, 'milestones', 'dailyStreak7');
        d.streak = 0;
      }
    }
    if (extracted && !d.rewarded) {
      d.rewarded = true;
      meta.currency += 200;
      meta.dust += 30;
      dailyReward = 200;
    }
  }

  // Weekly Rift.
  let weeklyReward: number | null = null;
  if (r.mode === 'weekly') {
    const week = r.seed.startsWith('weekly:') ? r.seed.slice(7) : isoWeekKey(now);
    const w = meta.weekly;
    if (w.week !== week) {
      w.week = week;
      w.rewarded = false;
      w.best = 0;
      meta.unlocks = meta.unlocks.filter((u) => !u.startsWith('weekly-attempt:'));
    }
    if (extracted) {
      if (!w.rewarded) {
        w.rewarded = true;
        meta.sigils += 3;
        meta.currency += 400;
        weeklyReward = 400;
      } else if (featureUnlocked(meta, 'weekly:attempt') && !meta.unlocks.includes(`weekly-attempt:${week}`)) {
        meta.unlocks.push(`weekly-attempt:${week}`);
        meta.currency += 150;
        weeklyReward = 150;
      }
      w.best = Math.max(w.best, Math.floor(r.settlement.shardsBanked));
    }
  }

  // Contracts (board + weekly chain).
  let contracts: SettlementReport['contracts'] = [];
  if (featureUnlocked(meta, 'feature:contracts')) {
    fillContracts(meta);
    contracts = ingestRunReport(meta, r);
    // The weekly chain opens with the Weekly Rift (L15): its first step needs H2+.
    if (featureUnlocked(meta, 'feature:weekly')) {
      const stepBefore = meta.contracts.weekly.step;
      contracts.push(...ingestWeekly(meta, r, isoWeekKey(now)));
      if (stepBefore < 3 && meta.contracts.weekly.step === 3) grantReward(meta, WEEKLY_REWARD, `weekly:${meta.contracts.weekly.week}`);
    }
  }

  // Hauler XP — always.
  // The Wicket's first escape always reaches L2 (contracts board + hood slot), so the first Results bar crosses a level.
  const ftueFloor = r.mode === 'ftue' && extracted ? Math.max(0, xpToNext(1) - meta.account.xp) : 0;
  const xpGained = Math.max(haulerXp(r), ftueFloor);
  meta.account.xp += xpGained;
  const levelAfter = accountLevel(meta).level;
  if (featureUnlocked(meta, 'feature:contracts')) fillContracts(meta);

  // Unlocks reached by this settlement.
  const unlocks = ACCOUNT_LADDER.filter((row) => row.level > levelBefore && row.level <= levelAfter).flatMap((row) => row.unlocks);
  // Ladder ✦ rungs (L14, L28, L40) pay once, on the settlement that crosses them (XP never decreases).
  for (const key of unlocks) {
    if (key.startsWith('sigils:')) meta.sigils += Number(key.slice(7));
    else if (key.startsWith('dust:')) meta.dust += Number(key.slice(5));
  }
  let zoneUnlocked: ZoneId | null = null;
  for (const key of zoneAndHazardKeys(meta)) {
    if (keysBefore.has(key)) continue;
    unlocks.push(key);
    if (zoneUnlocked === null && key.startsWith('zone:')) zoneUnlocked = key.slice(5) as ZoneId;
  }

  const achievements = evaluateAchievements(meta, r, achievementCtx(meta));
  if (achievements.length > 0 && !meta.flags.newBadges.includes('codex')) meta.flags.newBadges.push('codex');

  save(JOURNAL_KEY, null);
  saveMeta(meta);
  return {
    shardsBanked: Math.floor(r.settlement.shardsBanked), itemsBanked, lost: r.settlement.lost.map((it) => it), xpGained, levelBefore, levelAfter,
    unlocks, zoneUnlocked, contracts, achievements, codexNew, dailyReward, weeklyReward, bestHaul, firstExtraction,
  };
}

// ───────────── Run journal (§14b abandon rule) ─────────────

/** §16.1 E29: in-flight marker; write at run start, on pickups/pins, and ≤ 1 Hz for shards. Cleared by `settleRun`. */
export function writeRunJournal(j: RunJournalV2): void {
  save(JOURNAL_KEY, j);
}

interface RunJournalV1 { zone?: string; seed?: string; casket?: string[]; shards?: number }

function journalFrom(raw: unknown): RunJournalV2 | null {
  if (!isObj(raw)) return null;
  if (raw.version === 2) {
    const items = (Array.isArray(raw.items) ? raw.items : []).filter(
      (it): it is LootItem => isObj(it) && (it.kind === 'gear' ? coerceGear(it.item) !== null : it.kind === 'valuable' && isObj(it.item) && typeof it.item.uid === 'string' && typeof it.item.id === 'string'),
    );
    return {
      version: 2,
      zone: isZone(raw.zone) ? raw.zone : 'castle', hazard: isHazard(raw.hazard) ? (raw.hazard as HazardLevel) : 1,
      mode: raw.mode === 'daily' || raw.mode === 'weekly' || raw.mode === 'ftue' ? raw.mode : 'normal',
      seed: typeof raw.seed === 'string' ? raw.seed : '', classId: isClass(raw.classId) ? raw.classId : 'duskhauler',
      items, shards: Math.max(0, num(raw.shards, 0)), elapsedS: Math.max(0, num(raw.elapsedS, 0)),
    };
  }
  // V1 journal: casket relic ids converted by the §10 table.
  const v1 = raw as RunJournalV1;
  const items: LootItem[] = [];
  strs(v1.casket).forEach((id, i) => {
    const item = convertLegacyRelic(id, `j1-${i}`);
    if (item) items.push({ kind: 'gear', item });
  });
  return { version: 2, zone: isZone(v1.zone) ? v1.zone : 'castle', hazard: 1, mode: 'normal', seed: typeof v1.seed === 'string' ? v1.seed : '', classId: 'duskhauler', items, shards: Math.max(0, num(v1.shards, 0)), elapsedS: ABANDON_GRACE_S }; // V1 journals had no clock: they were real runs
}

/**
 * §16.1 E29: resolves a stale in-flight marker as an ABANDONED run (death
 * rules: casket items + tithe shards, Hauler XP ×0.6). `run` is the
 * synthesized RunReport so preload can start Results with E45 data
 * (approved additive field). Null when there was nothing to settle.
 */
export function settleAbandonedRun(): { report: SettlementReport; journal: RunJournalV2; run: RunReport } | null {
  const journal = journalFrom(load<unknown>(JOURNAL_KEY, null));
  if (journal === null) return null;
  // A reload in the first seconds is not a run: nothing was at stake, so no death, pity streak, FTUE retry or XP.
  if (journal.elapsedS < ABANDON_GRACE_S) {
    save(JOURNAL_KEY, null);
    return null;
  }
  const meta = loadMeta();
  const mutators = journal.mode === 'daily' ? riteMutators(journal.seed, 2) : journal.mode === 'weekly' ? riteMutators(journal.seed, 3) : [];
  const { loadout } = resolveLoadout(meta, { zone: journal.zone, hazard: journal.hazard, mode: journal.mode, seed: journal.seed, mutators });
  const banked = Math.floor((journal.shards * loadout.deathKeepPct) / 100);
  const run: RunReport = {
    outcome: 'abandoned', killer: null, zone: journal.zone, hazard: journal.hazard, mode: journal.mode, seed: journal.seed, classId: journal.classId,
    elapsedS: journal.elapsedS, gate: null,
    settlement: { outcome: 'abandoned', shardsBanked: banked, shardsLost: journal.shards - banked, greedMul: 1, kept: journal.items, lost: [] },
    kills: 0, killsByEnemy: {}, killsByWeapon: {}, eliteKills: 0, affixKills: {},
    bossKilled: false, midBossKilled: false, chestsOpened: 0, vaultOpened: false, shrinesUsed: 0, lairsCleared: 0, eventsCompleted: 0,
    veinsMined: 0, breakablesBroken: 0, loreRead: [], fenceTrades: 0, poisVisited: 0,
    evolutions: [], maxLevel: 1, charmsOwned: 0, weaponsAtMaxRank: 0, minHpRatio: 0, beltUsed: [], itemsSeen: [],
  };
  return { report: settleRun(run), journal, run };
}

// ───────────── Mutators (§16.1 E29) ─────────────

/** Runs `fn` on a fresh save; a returned string refuses (nothing written), `null` commits. */
function mutate(fn: (meta: MetaSaveV4) => string | null, keepUndo = false): MetaResult {
  const meta = loadMeta();
  const reason = fn(meta);
  if (reason !== null) return { ok: false, meta: loadMeta(), reason };
  if (!keepUndo) lastNode = null;
  evaluateAchievements(meta, null, achievementCtx(meta));
  saveMeta(meta);
  return { ok: true, meta };
}

function findGear(meta: MetaSaveV4, uid: string): GearInstance | undefined {
  return meta.vault.gear.find((g) => g.uid === uid);
}

function unequipUid(meta: MetaSaveV4, uid: string): void {
  for (const slot of GEAR_SLOTS) if (meta.equipped[slot] === uid) meta.equipped[slot] = null;
}

export function equipItem(slot: GearSlot, uid: string | null): MetaResult {
  return mutate((meta) => {
    if (!featureUnlocked(meta, `slot:${slot}`)) return `${slot.toUpperCase()} slot locked`;
    if (uid === null) {
      meta.equipped[slot] = null;
      return null;
    }
    const item = findGear(meta, uid);
    if (!item) return 'Item not in the Vault';
    if (item.slot !== slot) return `Goes in the ${item.slot} slot`;
    meta.equipped[slot] = uid;
    return null;
  });
}

/** Bone Dust one salvage pays (×1.15 per `g_dust` level). */
export function salvageValue(item: GearInstance, meta: MetaSaveV4 = loadMeta()): number {
  return Math.round(rarityDef(item.rarity).dust * (1 + 0.15 * lvl(meta, 'g_dust')));
}

/** ◆ one valuable sells for (×1.1 per `g_sell` level); 0 for an unknown id. */
export function sellValue(v: ValuableInstance, meta: MetaSaveV4 = loadMeta()): number {
  let value = 0;
  try {
    value = valuableDef(v.id).value;
  } catch {
    return 0;
  }
  return Math.round(value * TUNING.economy.sellMul * (1 + 0.1 * lvl(meta, 'g_sell')));
}

export function salvageItems(uids: string[]): MetaResult {
  return mutate((meta) => {
    const items = uids.map((uid) => findGear(meta, uid));
    if (items.length === 0) return 'Nothing selected';
    if (items.some((it) => it === undefined)) return 'Item not in the Vault';
    if (new Set(uids).size !== uids.length) return 'Duplicate item';
    if (items.some((it) => it!.locked === true)) return 'Locked items cannot be salvaged';
    let dust = 0;
    for (const it of items) {
      dust += salvageValue(it!, meta);
      unequipUid(meta, it!.uid);
    }
    meta.vault.gear = meta.vault.gear.filter((g) => !uids.includes(g.uid));
    meta.dust += dust;
    bumpContracts(meta, 'm_salvage', items.length);
    return null;
  });
}

export function sellItems(uids: string[]): MetaResult {
  return mutate((meta) => {
    if (!featureUnlocked(meta, 'feature:sell')) return 'Vault SELL opens at L3';
    const items = uids.map((uid) => meta.vault.valuables.find((v) => v.uid === uid));
    if (items.length === 0) return 'Nothing selected';
    if (items.some((it) => it === undefined)) return 'Item not in the Vault';
    if (new Set(uids).size !== uids.length) return 'Duplicate item';
    let shards = 0;
    for (const it of items) shards += sellValue(it!, meta);
    meta.vault.valuables = meta.vault.valuables.filter((v) => !uids.includes(v.uid));
    meta.currency += shards;
    for (const done of bumpContracts(meta, 'm_sell', shards)) void done;
    return null;
  });
}

/** Other vault items that could merge with `uid` (same base + rarity, unlocked, not itself). */
export function mergeCandidates(uid: string, meta: MetaSaveV4 = loadMeta()): string[] {
  const item = findGear(meta, uid);
  if (!item) return [];
  return meta.vault.gear.filter((g) => g.uid !== uid && g.base === item.base && g.rarity === item.rarity && g.locked !== true).map((g) => g.uid);
}

/** Why a merge of these three would be refused, or null when it is legal. */
export function mergeRefusal(uids: readonly string[], meta: MetaSaveV4 = loadMeta()): string | null {
  const cap = mergeRarityCap(meta);
  if (cap === 0) return 'Vault MERGE opens at L4';
  if (uids.length !== 3 || new Set(uids).size !== 3) return 'Pick 3 different items';
  const items = uids.map((u) => findGear(meta, u));
  if (items.some((it) => it === undefined)) return 'Item not in the Vault';
  const [a, b, c] = items as [GearInstance, GearInstance, GearInstance];
  if (a.base !== b.base || a.base !== c.base || a.rarity !== b.rarity || a.rarity !== c.rarity) return 'Needs 3 of the same item and rarity';
  if (a.rarity >= 6) return 'Hallowed is the top rarity';
  if (a.rarity + 1 > cap) return cap === 4 ? 'Merge to Dread opens at L19' : 'Merge to Hallowed opens at L26';
  if (items.some((it) => it!.locked === true)) return 'Unlock the items first';
  return null;
}

export function mergeItems(uids: [string, string, string]): MetaResult {
  return mutate((meta) => {
    const refusal = mergeRefusal(uids, meta);
    if (refusal !== null) return refusal;
    const items = uids.map((u) => findGear(meta, u)!);
    const first = items[0]!;
    const rarity = (first.rarity + 1) as Rarity;
    const rng = new Rng(`merge:${uids.join(':')}`);
    const affixes = first.affixes.map((a) => ({ ...a }));
    const fresh = rollNewAffix(rng, rarity, affixes, rarity === 6);
    if (fresh) affixes.push(fresh);
    const result: GearInstance = {
      uid: `mg-${Math.floor(rng.next() * 0x7fffffff).toString(36)}${Math.floor(rng.next() * 0x7fffffff).toString(36)}`,
      base: first.base, slot: first.slot, rarity, level: Math.max(...items.map((i) => i.level)), affixes,
    };
    if (first.unique !== undefined) result.unique = first.unique;
    const equippedSlot = GEAR_SLOTS.find((s) => items.some((i) => meta.equipped[s] === i.uid));
    for (const u of uids) unequipUid(meta, u);
    meta.vault.gear = meta.vault.gear.filter((g) => !uids.includes(g.uid));
    meta.vault.gear.push(result);
    if (equippedSlot !== undefined) meta.equipped[equippedSlot] = result.uid;
    if (rarity === 6) addToSet(meta, 'milestones', 'mergedHallowed');
    bumpContracts(meta, 'm_merge', 1);
    return null;
  });
}

/** Cost to raise `item` one level (`4 + 3L` dust, `10L` ◆), or null at the account's item-level cap. */
export function levelCost(item: GearInstance, meta: MetaSaveV4 = loadMeta()): { dust: number; shards: number } | null {
  if (item.level >= itemLevelCap(meta)) return null;
  return levelStepCost(item.level);
}

/** Price of L → L+1 (steep: ◆ `shardsBase × shardsGrowth^(L−1)`, dust `dustBase + dustPerLevel·L`). */
function levelStepCost(level: number): { dust: number; shards: number } {
  const c = TUNING.gear.levelCost;
  return { dust: c.dustBase + c.dustPerLevel * level, shards: Math.round(c.shardsBase * c.shardsGrowth ** (level - 1)) };
}

/** Stored per-item affix reroll count (optional extra field on vault gear; absent = 0). */
type VaultGear = GearInstance & { rerolls?: number };

/** Price of the next affix reroll on `item` (escalates ×`growth` per reroll of that item), or null when it has no affix. */
export function affixRerollCost(item: GearInstance): { shards: number; dust: number } | null {
  if (item.affixes.length === 0) return null;
  const c = TUNING.gear.affixReroll;
  const n = (item as VaultGear).rerolls ?? 0;
  return { shards: Math.round(c.shardsBase * rarityDef(item.rarity).implicitMul * c.growth ** n), dust: c.dust };
}

/** Rerolls affix `index` of a vault item into a different affix (new id, new value at the item's rarity). */
export function rerollAffix(uid: string, index: number): MetaResult {
  return mutate((meta) => {
    const item = findGear(meta, uid) as VaultGear | undefined;
    if (!item) return 'Item not in the Vault';
    if (item.locked === true) return 'Unlock the item first';
    const cost = affixRerollCost(item);
    if (cost === null || item.affixes[index] === undefined) return 'No affix to reroll';
    if (meta.currency < cost.shards) return 'Not enough shards';
    if (meta.dust < cost.dust) return 'Not enough Bone Dust';
    const rng = new Rng(`affix:${uid}:${item.rerolls ?? 0}:${index}`);
    const next = rollNewAffix(rng, item.rarity, item.affixes, false);
    if (next === null) return 'No other affix can roll here';
    meta.currency -= cost.shards;
    meta.dust -= cost.dust;
    item.affixes[index] = next;
    item.rerolls = (item.rerolls ?? 0) + 1;
    return null;
  });
}

export function levelItem(uid: string): MetaResult {
  return mutate((meta) => {
    const item = findGear(meta, uid);
    if (!item) return 'Item not in the Vault';
    const cost = levelCost(item, meta);
    if (cost === null) return item.level >= MAX_ITEM_LEVEL ? 'Max item level' : `Item levels above ${itemLevelCap(meta)} unlock later`;
    if (meta.dust < cost.dust) return 'Not enough Bone Dust';
    if (meta.currency < cost.shards) return 'Not enough shards';
    meta.dust -= cost.dust;
    meta.currency -= cost.shards;
    item.level += 1;
    return null;
  });
}

export function lockItem(uid: string, locked: boolean): MetaResult {
  return mutate((meta) => {
    const item = findGear(meta, uid);
    if (!item) return 'Item not in the Vault';
    if (locked) item.locked = true;
    else delete item.locked;
    return null;
  });
}

/** Post-Sanctum infinite node (saved in `upgrades` under this id; not one of the 40 SANCTUM rows). */
const ASCENSION_ID = 'n_ascension';

/** Dread Ascension ranks bought. */
export function ascensionRank(meta: MetaSaveV4 = loadMeta()): number {
  return lvl(meta, ASCENSION_ID);
}

/** True once every one of the 40 Sanctum nodes is at max (V1/V3 saves that already maxed get it at once). */
export function ascensionOpen(meta: MetaSaveV4 = loadMeta()): boolean {
  return SANCTUM.every((n) => lvl(meta, n.id) >= n.max);
}

/** ◆ for the next Ascension rank: `base × growth^rank`. */
export function ascensionCost(rank: number): number {
  return Math.round(TUNING.ascension.base * TUNING.ascension.growth ** rank);
}

/** Dread Ascension: +1% damage and +1% shards per rank, repeatable forever. */
export function buyAscension(): MetaResult {
  return mutate((meta) => {
    if (!ascensionOpen(meta)) return 'Max every Sanctum node first';
    const rank = lvl(meta, ASCENSION_ID);
    const cost = ascensionCost(rank);
    if (meta.currency < cost) return 'Not enough shards';
    meta.currency -= cost;
    meta.upgrades[ASCENSION_ID] = rank + 1;
    return null;
  });
}

export function buyNode(id: string): MetaResult {
  let paid: { shards: number; sigils: number } | null = null;
  const result = mutate((meta) => {
    const node = sanctumNode(id);
    if (!node) return 'Unknown node';
    const level = lvl(meta, id);
    if (level >= node.max) return 'MAXED';
    const open = nodeUnlocked(meta, id);
    if (!open.unlocked) return open.reason;
    const cost = nodeCost(node, level);
    if (meta.currency < cost.shards) return 'Not enough shards';
    if (meta.sigils < cost.sigils) return 'Not enough Dread Sigils';
    meta.currency -= cost.shards;
    meta.sigils -= cost.sigils;
    meta.upgrades[id] = level + 1;
    paid = cost;
    return null;
  });
  if (result.ok && paid !== null) lastNode = { id, ...(paid as { shards: number; sigils: number }) };
  return result;
}

/** Refunds the last Sanctum purchase in full (only while it is still the last mutation). */
export function undoLastNode(): boolean {
  const undo = lastNode;
  if (undo === null) return false;
  const result = mutate((meta) => {
    const level = lvl(meta, undo.id);
    if (level <= 0) return 'Nothing to undo';
    if (level === 1) delete meta.upgrades[undo.id];
    else meta.upgrades[undo.id] = level - 1;
    meta.currency += undo.shards;
    meta.sigils += undo.sigils;
    return null;
  });
  lastNode = null;
  return result.ok;
}

/** Sanctum node that unlocks choosing the run's start weapon. */
export const ARMSMASTER_ID = 'b_armsmaster';
const ARMSMASTER_LOCKED = "Unlock in Sanctum — Armsmaster's Leave";

/** The saved choice when it is still usable (node owned + weapon unlocked), else null = class default. */
function validStartWeapon(meta: MetaSaveV4): WeaponId | null {
  const id = meta.startWeapon;
  if (id === null || lvl(meta, ARMSMASTER_ID) === 0) return null;
  return unlockedWeapons(meta).includes(id) ? id : null;
}

function effectiveStartWeapon(meta: MetaSaveV4, classDefault: WeaponId): WeaponId {
  return validStartWeapon(meta) ?? classDefault;
}

/** Start-weapon picker model (ARMORY / Loadout). */
export function startWeaponChoice(meta: MetaSaveV4 = loadMeta()): { unlocked: boolean; selected: WeaponId | null; options: WeaponId[]; effective: WeaponId; classDefault: WeaponId } {
  const classDefault = classDef(featureUnlocked(meta, `class:${meta.classId}`) ? meta.classId : 'duskhauler').startWeapon;
  return {
    unlocked: lvl(meta, ARMSMASTER_ID) > 0,
    selected: validStartWeapon(meta),
    options: unlockedWeapons(meta),
    effective: effectiveStartWeapon(meta, classDefault),
    classDefault,
  };
}

/** Picks the run's start weapon (null = class default). Needs `b_armsmaster` and an account-unlocked weapon. */
export function selectStartWeapon(id: WeaponId | null): MetaResult {
  return mutate((meta) => {
    if (lvl(meta, ARMSMASTER_ID) === 0) return ARMSMASTER_LOCKED;
    if (id !== null && !unlockedWeapons(meta).includes(id)) return 'Weapon locked';
    meta.startWeapon = id;
    return null;
  });
}

export function selectClass(id: ClassId): MetaResult {
  return mutate((meta) => {
    if (!CLASSES.some((c) => c.id === id)) return 'Unknown class';
    if (!featureUnlocked(meta, `class:${id}`)) return `Unlocks at L${classDef(id).unlockLevel}`;
    meta.classId = id;
    return null;
  });
}

export function selectZone(z: ZoneId, h: HazardLevel): MetaResult {
  return mutate((meta) => {
    const zs = zoneStatus(z, meta);
    if (!zs.unlocked) return zs.reason;
    const hs = hazardStatus(z, h, meta);
    if (!hs.unlocked) return hs.reason;
    const cost = hazardDef(h).sigilCost;
    if (cost > 0 && !meta.unlocks.includes(H5_PAID)) {
      meta.sigils -= cost;
      meta.unlocks.push(H5_PAID);
    }
    meta.selection.zone = z;
    meta.selection.hazard[z] = h;
    return null;
  });
}

export function buyConsumable(id: ConsumableId): MetaResult {
  return mutate((meta) => {
    if (beltSlotsUnlocked(meta) === 0) return 'Consumable belt opens at L7';
    const def = CONSUMABLES.find((c) => c.id === id);
    if (!def) return 'Unknown consumable';
    if (meta.currency < def.price) return 'Not enough shards';
    meta.currency -= def.price;
    meta.consumables[id] += 1;
    for (const slot of meta.belt) if (slot && slot.id === id) slot.charges = Math.min(meta.consumables[id], beltCap(meta));
    return null;
  });
}

export function setBelt(slot: 0 | 1, id: ConsumableId | null): MetaResult {
  return mutate((meta) => {
    if (slot >= beltSlotsUnlocked(meta)) return slot === 0 ? 'Belt slot 1 opens at L7' : 'Belt slot 2 opens at L22';
    if (id === null) {
      meta.belt[slot] = null;
      return null;
    }
    if (!isConsumable(id)) return 'Unknown consumable';
    if (meta.consumables[id] <= 0) return 'None owned — buy one first';
    const other = meta.belt[slot === 0 ? 1 : 0];
    if (other && other.id === id) return 'Already on the belt';
    meta.belt[slot] = { id, charges: Math.min(meta.consumables[id], beltCap(meta)) };
    return null;
  });
}

/** Resets the free daily rerolls at local midnight; true when it changed the save. */
function refreshRerolls(meta: MetaSaveV4): boolean {
  const today = localDayKey(new Date());
  if (meta.contracts.rerollDay === today) return false;
  meta.contracts.rerollDay = today;
  meta.contracts.rerollsLeft = 1 + (featureUnlocked(meta, 'contracts:reroll2') ? 1 : 0);
  return true;
}

export function claimContract(id: string): MetaResult {
  return mutate((meta) => {
    const index = meta.contracts.active.findIndex((c) => c.id === id);
    if (index < 0) return 'Not on the board';
    const c = meta.contracts.active[index]!;
    if (c.progress < c.target) return 'Not finished yet';
    const def = contractDef(id)!;
    meta.contracts.active.splice(index, 1);
    grantReward(meta, def.reward, `${id}:${meta.stats.contractsClaimed}`);
    meta.stats.contractsClaimed += 1;
    // The replacement never re-deals the contract just claimed (it rolls in the claimed row's place).
    const next = rollOneContract([...meta.contracts.active, c], new Rng(`claim:${id}:${meta.stats.contractsClaimed}:${meta.stats.runs}`), contractDomain(meta));
    if (next !== null && meta.contracts.active.length < contractDomain(meta).slots) meta.contracts.active.splice(index, 0, next);
    fillContracts(meta);
    return null;
  });
}

export function rerollContract(id: string): MetaResult {
  return mutate((meta) => {
    refreshRerolls(meta);
    const index = meta.contracts.active.findIndex((c) => c.id === id);
    if (index < 0) return 'Not on the board';
    if (meta.contracts.rerollsLeft <= 0) return 'No rerolls left today';
    const rest = meta.contracts.active.filter((_, i) => i !== index);
    // The rerolled id is excluded too: a reroll must change the contract.
    const next = rollOneContract([...rest, meta.contracts.active[index]!], new Rng(`reroll:${id}:${meta.contracts.rerollDay}:${meta.stats.runs}:${meta.contracts.rerollsLeft}`), contractDomain(meta));
    if (next === null) return 'No other contract available';
    meta.contracts.active[index] = next;
    meta.contracts.rerollsLeft -= 1;
    return null;
  });
}

export function claimAchievement(id: string): MetaResult {
  return mutate((meta) => {
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (!def) return 'Unknown achievement';
    if (meta.achievements[id] !== 'done') return meta.achievements[id] === 'claimed' ? 'Already claimed' : 'Not earned yet';
    meta.achievements[id] = 'claimed';
    meta.currency += def.reward.shards ?? 0;
    meta.sigils += def.reward.sigils ?? 0;
    return null;
  });
}

/** Coach beats (`coach:<id>`) and hub badges: records `key` as seen and clears it from `newBadges`. ok=false if already seen. */
export function markSeen(key: string): MetaResult {
  return mutate((meta) => {
    const badge = meta.flags.newBadges.indexOf(key);
    if (badge >= 0) meta.flags.newBadges.splice(badge, 1);
    if (meta.flags.seenCoach.includes(key)) return badge >= 0 ? null : 'Already seen';
    meta.flags.seenCoach.push(key);
    return null;
  }, true);
}

export function hasSeen(key: string): boolean {
  return loadMeta().flags.seenCoach.includes(key);
}
