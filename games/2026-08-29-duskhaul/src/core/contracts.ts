/**
 * Contracts runtime (PRD-V2 §5.22): board rolls, run-report progress, copy.
 * Pure over the save object it is handed (no storage) — `core/progression.ts`
 * owns persistence, claiming, rerolling and the meta-action progress
 * (`m_salvage`, `m_merge`, `m_sell` via `bumpContracts`).
 */
import type { Rng } from './rng';
import { CONTRACT_SLOTS, CONTRACTS, STARTER_TARGETS, WEEKLY_STEPS, ZONE_LOCALS, contractDef, type ContractDef } from '../data/contracts';
import { WEAPONS } from '../data/weapons';
import { zoneDef } from '../data/zones';
import type { EliteAffixId, HazardLevel, MetaSaveV4, RunReport, SettlementReport, WeaponId, ZoneId } from '../data/types-v2';
import { contractDomain } from './progression';

export type ActiveContract = MetaSaveV4['contracts']['active'][number];

const ELITE_AFFIX_IDS: readonly EliteAffixId[] = ['vampiric', 'hasted', 'shielded', 'splitter', 'frenzied', 'warded', 'plagued', 'magnetic'];

/** Param domains the roller may use, resolved from the save by the caller (progression knows the unlock rules). */
export interface ContractDomain {
  weapons: readonly WeaponId[]; zones: readonly ZoneId[]; maxHazard: HazardLevel; slots: number;
  /** Below L5: roll only the `STARTER_TARGETS` rows at their starter targets. */
  starter: boolean;
  /** Account features unlocked (gates `ContractDef.requires`). */
  features: readonly string[];
}

/** Whether `def` may roll for this domain (starter pool / feature gate). */
export function contractEligible(def: ContractDef, domain: ContractDomain): boolean {
  if (domain.starter && STARTER_TARGETS[def.id] === undefined) return false;
  return def.requires === undefined || domain.features.includes(def.requires);
}

/** Board size for an account level. */
export function contractSlots(level: number): number {
  if (level < 2) return 0;
  return level >= 24 ? CONTRACT_SLOTS.atL24 : CONTRACT_SLOTS.base;
}

function rollParams(def: ContractDef, rng: Rng, domain: ContractDomain): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (const p of def.params ?? []) {
    if (p === 'weapon') params.weapon = rng.pick(domain.weapons);
    else if (p === 'zone') params.zone = rng.pick(domain.zones);
    else if (p === 'affix') params.affix = rng.pick(ELITE_AFFIX_IDS);
    else {
      if (domain.maxHazard < 2) return null; // "H{h}+" needs a rung above H1 to mean anything
      params.h = String(rng.int(2, domain.maxHazard));
    }
  }
  return params;
}

/** One fresh contract not already on the board (distinct ids), or null when the pool is exhausted. */
export function rollOneContract(active: readonly ActiveContract[], rng: Rng, domain: ContractDomain): ActiveContract | null {
  const pool = CONTRACTS.filter((c) => !active.some((a) => a.id === c.id) && contractEligible(c, domain));
  rng.shuffle(pool);
  for (const def of pool) {
    const params = rollParams(def, rng, domain);
    if (params === null) continue;
    const target = domain.starter ? (STARTER_TARGETS[def.id] ?? def.target) : def.target;
    return { id: def.id, progress: 0, target, params };
  }
  return null;
}

/**
 * §16.1 E30: fills `meta.contracts.active` up to the board size for the
 * save's account level with distinct contracts; params are drawn only from
 * what the save has unlocked (weapons, zones, hazard rungs).
 */
export function rollContracts(meta: MetaSaveV4, rng: Rng): void {
  const domain = contractDomain(meta);
  const active = meta.contracts.active;
  while (active.length < domain.slots) {
    const next = rollOneContract(active, rng, domain);
    if (next === null) return;
    active.push(next);
  }
}

/** Progress a run contributes to one contract (before clamping). */
function runProgress(c: ActiveContract, r: RunReport): number {
  const def = contractDef(c.id);
  if (!def) return 0;
  const extracted = r.outcome === 'extracted';
  const threshold = def.threshold ?? 0;
  const kept = r.settlement.kept;
  switch (c.id) {
    case 'k_kill_any': return r.kills;
    case 'k_kill_elite': return r.eliteKills;
    case 'k_kill_boss': return r.bossKilled ? 1 : 0;
    case 'k_kill_mid': return r.midBossKilled ? 1 : 0;
    case 'k_kill_weapon': return r.killsByWeapon[c.params.weapon ?? ''] ?? 0;
    case 'k_kill_zoneex': {
      const locals = ZONE_LOCALS[(c.params.zone ?? 'castle') as ZoneId] ?? [];
      return locals.reduce((sum, id) => sum + (r.killsByEnemy[id] ?? 0), 0);
    }
    case 'k_kill_affix': return r.affixKills[c.params.affix ?? ''] ?? 0;
    case 'x_extract_any': return extracted ? 1 : 0;
    case 'x_extract_zone': return extracted && r.zone === c.params.zone ? 1 : 0;
    case 'x_extract_b': return extracted && r.gate?.id === 'b' ? 1 : 0;
    case 'x_extract_c': return extracted && r.gate?.id === 'c' ? 1 : 0;
    case 'x_extract_toll': return extracted && r.gate?.kind === 'toll' ? 1 : 0;
    case 'x_extract_offer': return extracted && r.gate?.kind === 'offering' ? 1 : 0;
    case 'x_extract_bell': return extracted && r.gate?.kind === 'bell' ? 1 : 0;
    case 'x_extract_hazard': return extracted && r.hazard >= Number(c.params.h ?? 2) ? 1 : 0;
    case 'x_extract_greed': return extracted && r.settlement.greedMul >= threshold ? 1 : 0;
    case 'x_extract_haul': return extracted && r.settlement.shardsBanked >= threshold ? 1 : 0;
    case 'x_extract_items': return extracted && kept.length >= threshold ? 1 : 0;
    case 'x_extract_gilded': return extracted && kept.filter((it) => it.kind === 'gear' && it.item.rarity >= 4).length >= threshold ? 1 : 0;
    case 'x_extract_nohit': return extracted && r.minHpRatio >= threshold ? 1 : 0;
    case 'p_chests': return r.chestsOpened;
    case 'p_vault': return extracted && r.vaultOpened ? 1 : 0;
    case 'p_shrines': return r.shrinesUsed;
    case 'p_lairs': return r.lairsCleared;
    case 'p_events': return r.eventsCompleted;
    case 'p_veins': return r.veinsMined;
    case 'p_breakables': return r.breakablesBroken;
    case 'p_lore': return r.loreRead.length;
    case 'p_fence': return r.fenceTrades;
    case 'b_evolve':
    case 'b_evolve_two': return r.evolutions.length >= threshold ? 1 : 0;
    case 'b_level': return r.maxLevel >= threshold ? 1 : 0;
    case 'b_charms': return r.charmsOwned >= threshold ? 1 : 0;
    default: return 0; // m_* progress comes from Vault actions, not runs
  }
}

/** Adds `amount` to every active contract with `id` (Vault actions). Returns the progress deltas. */
export function bumpContracts(meta: MetaSaveV4, id: string, amount: number): SettlementReport['contracts'] {
  const out: SettlementReport['contracts'] = [];
  for (const c of meta.contracts.active) {
    if (c.id !== id || c.progress >= c.target || amount <= 0) continue;
    const from = c.progress;
    c.progress = Math.min(c.target, from + amount);
    out.push({ id: c.id, from, to: c.progress, target: c.target, done: c.progress >= c.target });
  }
  return out;
}

/** Weekly chain progress for one run; returns the step entries that moved. Resets on a new ISO week. */
export function ingestWeekly(meta: MetaSaveV4, r: RunReport, week: string): SettlementReport['contracts'] {
  const w = meta.contracts.weekly;
  if (w.week !== week) {
    w.week = week;
    w.step = 0;
    w.progress = 0;
  }
  if (w.step >= 3) return [];
  const extracted = r.outcome === 'extracted';
  const gain = [extracted && r.hazard >= 2 ? 1 : 0, r.bossKilled ? 1 : 0, extracted && r.gate?.id === 'c' ? 1 : 0][w.step]!;
  if (gain === 0) return [];
  const step = WEEKLY_STEPS[w.step]!;
  const from = w.progress;
  w.progress = Math.min(step.target, from + gain);
  const done = w.progress >= step.target;
  const entry = { id: step.id, from, to: w.progress, target: step.target, done };
  if (done) {
    w.step = (w.step + 1) as 0 | 1 | 2 | 3;
    w.progress = 0;
  }
  return [entry];
}

/** §16.1 E30: progress every active board contract by one run. Contracts cap at target; claiming is explicit. */
export function ingestRunReport(meta: MetaSaveV4, r: RunReport): SettlementReport['contracts'] {
  const out: SettlementReport['contracts'] = [];
  for (const c of meta.contracts.active) {
    if (c.progress >= c.target) continue;
    const gain = runProgress(c, r);
    if (gain <= 0) continue;
    const from = c.progress;
    c.progress = Math.min(c.target, from + gain);
    out.push({ id: c.id, from, to: c.progress, target: c.target, done: c.progress >= c.target });
  }
  return out;
}

/** §16.1 E30: board copy with params filled (`Kill 300 enemies with Rustspike`). */
export function contractText(c: ActiveContract): string {
  const def = contractDef(c.id);
  if (!def) return c.id;
  const n = def.threshold ?? c.target;
  const zone = c.params.zone;
  let zoneName = zone ?? '';
  if (zone !== undefined) {
    try {
      zoneName = zoneDef(zone).name;
    } catch {
      zoneName = zone;
    }
  }
  const affix = c.params.affix ?? '';
  return def.text
    .replace('{times}', n === 1 ? 'once' : `${n} times`)
    .replace('{n}', String(n))
    .replace('{weapon}', WEAPONS.find((w) => w.id === c.params.weapon)?.name ?? c.params.weapon ?? '')
    .replace('{zone}', zoneName)
    .replace('{affix}', affix.charAt(0).toUpperCase() + affix.slice(1))
    .replace('{h}', c.params.h ?? '2');
}
