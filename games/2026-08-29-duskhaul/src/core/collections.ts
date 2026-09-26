import type { Rng } from './rng';
import { ACHIEVEMENTS, type AchievementRule } from '../data/achievements';
import { CHARMS } from '../data/charms';
import { WEAPONS } from '../data/weapons';
import { GEAR_BASES, UNIQUES } from '../data/gear';
import { SANCTUM } from '../data/sanctum';
import type { CharmId, ClassId, MetaSaveV4, RunReport, WeaponId, ZoneId } from '../data/types-v2';

/**
 * Collections: the template "collect-a-set" helpers plus Duskhaul's Codex
 * (PRD-V2 §5.23): Bestiary kill tiers, Arsenal/Armory/Valuables/Lore
 * catalogues, mastery stars and the 60 achievements. Pure TS over the save
 * object it is handed — `core/progression.ts settleRun` owns persistence.
 *
 * Run-derived sets the achievements need live in `meta.collections`:
 * `gatesUsed` (a/b/c/toll/offering/bell), `affixesKilled`, `classesExtracted`,
 * `zonesPlayed`, `milestones` (`mergedHallowed`, `dailyStreak7`, `l40`),
 * `bossFirst` (`<zone>:H<h>` first zone-boss kill per hazard).
 */

export interface CollectionPieceDef {
  id: string;
  name: string;
}

export interface CollectionSetDef {
  id: string;
  name: string;
  /** 3-6 pieces. */
  pieces: CollectionPieceDef[];
}

export interface CollectionProgress {
  owned: number;
  total: number;
  /** 0..1 — safe to feed straight into `ui/bars.ts`. */
  ratio: number;
  complete: boolean;
  /** Piece ids still missing, in definition order. */
  missing: string[];
}

/** Progress of one set against an owned-piece list (unknown ids ignored, each piece counted once). */
export function collectionProgress(def: CollectionSetDef, owned: readonly string[]): CollectionProgress {
  const missing: string[] = [];
  let count = 0;
  for (const piece of def.pieces) {
    if (owned.includes(piece.id)) count += 1;
    else missing.push(piece.id);
  }
  const total = def.pieces.length;
  return { owned: count, total, ratio: total === 0 ? 1 : count / total, complete: missing.length === 0, missing };
}

/** Seeded drop of a piece the player does not own yet; null once the set is complete. */
export function rollMissingPiece(def: CollectionSetDef, owned: readonly string[], rng: Rng): string | null {
  const missing = def.pieces.filter((piece) => !owned.includes(piece.id));
  if (missing.length === 0) return null;
  return rng.pick(missing).id;
}

// ───────────── Codex ─────────────

const ZONES_ORDER: readonly ZoneId[] = ['castle', 'outlands', 'desert', 'winter'];

/** §5.4 roster (28) — Bestiary entries keyed by enemy def id. */
const BESTIARY_ENEMIES: readonly string[] = [
  'husk', 'wretch', 'ratking', 'cryptcrawler', 'bonecaster', 'thornhound', 'paleknight', 'lanternmonk', 'shroudmoth', 'bulwark',
  'gildedghoul', 'pyreling', 'marrowworm', 'gibbet', 'dirgebell', 'ashwraith',
  'chapelghast', 'gargoyle', 'choirwraith', 'kite', 'giant', 'mirehag', 'leech', 'scarab', 'sandrevenant', 'widow', 'yeti', 'rimestalker',
];
/** 4 zone bosses + 4 mid-bosses, keyed by zone (`RunReport.bossKilled/midBossKilled` + `zone`). */
const BESTIARY_BOSSES: readonly string[] = [...ZONES_ORDER.map((z) => `boss:${z}`), ...ZONES_ORDER.map((z) => `mid:${z}`)];
export const BESTIARY: readonly string[] = [...BESTIARY_ENEMIES, ...BESTIARY_BOSSES];

/** Arsenal Codex (§5.8b: 20 weapons, 20 evolutions, 21 charms) — straight from the Arsenal tables. */
const CODEX_WEAPONS: readonly WeaponId[] = WEAPONS.map((w) => w.id);
const CODEX_CHARMS: readonly CharmId[] = CHARMS.map((c) => c.id);
const CODEX_VALUABLES_TOTAL = 24;
/** 6 lore stones × 4 zones. */
const CODEX_LORE_TOTAL = 24;

/** Kill tiers: lore line, lore page, lore + damage. */
export const KILL_TIERS: readonly number[] = [10, 100, 1000];
/** "+2% damage vs that enemy each tier after 100" → tiers ≥ 100 each add 2%. */
export const TIER_DAMAGE_PCT = 2;

export type CodexSet = 'bestiary' | 'arsenal' | 'weapons' | 'evolutions' | 'charms' | 'armory' | 'valuables' | 'lore';

/** Tier reached (0-3) for a Bestiary entry. */
export function killTier(meta: MetaSaveV4, id: string): number {
  const kills = meta.codex.kills[id] ?? 0;
  return KILL_TIERS.filter((t) => kills >= t).length;
}

/** Per-enemy damage multipliers earned from Bestiary tiers (only entries > 1). */
export function bestiaryDamage(meta: MetaSaveV4): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of BESTIARY) {
    const bonusTiers = KILL_TIERS.filter((t) => t >= 100 && (meta.codex.kills[id] ?? 0) >= t).length;
    if (bonusTiers > 0) out[id] = 1 + (TIER_DAMAGE_PCT * bonusTiers) / 100;
  }
  return out;
}

function countSeen(meta: MetaSaveV4, prefix: string, ids: readonly string[]): number {
  return ids.filter((id) => meta.codex.seen[`${prefix}${id}`] === true).length;
}

/** §16.1 E31. */
export function codexProgress(meta: MetaSaveV4, set: string): { found: number; total: number } {
  switch (set as CodexSet) {
    case 'bestiary':
      return { found: BESTIARY.filter((id) => (meta.codex.kills[id] ?? 0) > 0).length, total: BESTIARY.length };
    case 'weapons':
      return { found: countSeen(meta, 'wpn:', CODEX_WEAPONS), total: CODEX_WEAPONS.length };
    case 'evolutions':
      return { found: countSeen(meta, 'evo:', CODEX_WEAPONS), total: CODEX_WEAPONS.length };
    case 'charms':
      return { found: countSeen(meta, 'charm:', CODEX_CHARMS), total: CODEX_CHARMS.length };
    case 'arsenal':
      return {
        found: countSeen(meta, 'wpn:', CODEX_WEAPONS) + countSeen(meta, 'evo:', CODEX_WEAPONS) + countSeen(meta, 'charm:', CODEX_CHARMS),
        total: CODEX_WEAPONS.length * 2 + CODEX_CHARMS.length,
      };
    case 'armory':
      return {
        found: countSeen(meta, 'gear:', GEAR_BASES.map((b) => b.id)) + countSeen(meta, 'uniq:', UNIQUES.map((u) => u.id)),
        total: GEAR_BASES.length + UNIQUES.length,
      };
    case 'valuables':
      return { found: Math.min(CODEX_VALUABLES_TOTAL, Object.keys(meta.codex.seen).filter((k) => k.startsWith('val:')).length), total: CODEX_VALUABLES_TOTAL };
    case 'lore':
      return { found: Math.min(CODEX_LORE_TOTAL, meta.codex.lore.length), total: CODEX_LORE_TOTAL };
    default:
      return { found: 0, total: 0 };
  }
}

/** Adds `value` to the run-derived set `setId` in `meta.collections`; false if already present. */
export function addToSet(meta: MetaSaveV4, setId: string, value: string): boolean {
  const list = meta.collections[setId] ?? (meta.collections[setId] = []);
  if (list.includes(value)) return false;
  list.push(value);
  return true;
}

export function inSet(meta: MetaSaveV4, setId: string, value: string): boolean {
  return (meta.collections[setId] ?? []).includes(value);
}

/**
 * §16.1 E31: folds one run into the Codex and the run-derived sets. Returns
 * the new codex keys: `bestiary:<id>` (first kill), `tier:<id>:<n>` (tier
 * crossed), seen keys (`gear:`/`uniq:`/`val:`/`wpn:`/`evo:`/`charm:`), `lore:<id>`.
 */
export function recordCodex(meta: MetaSaveV4, r: RunReport): string[] {
  const fresh: string[] = [];
  const addKills = (id: string, n: number): void => {
    if (n <= 0) return;
    const before = meta.codex.kills[id] ?? 0;
    const after = before + n;
    meta.codex.kills[id] = after;
    if (before === 0) fresh.push(`bestiary:${id}`);
    for (const t of KILL_TIERS) if (before < t && after >= t) fresh.push(`tier:${id}:${t}`);
  };
  for (const [id, n] of Object.entries(r.killsByEnemy)) addKills(id, n);
  if (r.bossKilled) addKills(`boss:${r.zone}`, 1);
  if (r.midBossKilled) addKills(`mid:${r.zone}`, 1);

  const seeKey = (key: string): void => {
    if (meta.codex.seen[key] === true) return;
    meta.codex.seen[key] = true;
    fresh.push(key);
  };
  for (const key of r.itemsSeen) seeKey(key);
  for (const it of r.settlement.kept) {
    if (it.kind === 'valuable') seeKey(`val:${it.item.id}`);
    else if (it.item.unique !== undefined) seeKey(`uniq:${it.item.unique}`);
    else seeKey(`gear:${it.item.base}`);
  }
  for (const w of Object.keys(r.killsByWeapon)) if ((CODEX_WEAPONS as readonly string[]).includes(w)) seeKey(`wpn:${w}`);
  for (const w of r.evolutions) seeKey(`evo:${w}`);
  for (const id of r.loreRead) {
    if (meta.codex.lore.includes(id)) continue;
    meta.codex.lore.push(id);
    fresh.push(`lore:${id}`);
  }

  // Run-derived sets read by the achievements.
  addToSet(meta, 'zonesPlayed', r.zone);
  for (const [affix, n] of Object.entries(r.affixKills)) if (n > 0) addToSet(meta, 'affixesKilled', affix);
  if (r.outcome === 'extracted') {
    addToSet(meta, 'classesExtracted', r.classId);
    if (r.gate) addToSet(meta, 'gatesUsed', r.gate.kind === 'timed' ? r.gate.id : r.gate.kind);
  }
  return fresh;
}

/** Mastery stars 0-3 for a zone (★1 extract, ★2 Gate C, ★3 boss + extract same run). */
export function masteryStars(meta: MetaSaveV4, zone: ZoneId): number {
  const m = meta.mastery[zone];
  return (m.extract ? 1 : 0) + (m.gateC ? 1 : 0) + (m.bossAndExtract ? 1 : 0);
}

/** Context the meta-side rules need that the save does not store directly. */
export interface AchievementContext { accountLevel: number; classUnlockLevel: Readonly<Record<ClassId, number>> }

const ALL_GATES = ['a', 'b', 'c', 'toll', 'offering', 'bell'] as const;
const ALL_AFFIXES = ['vampiric', 'hasted', 'shielded', 'splitter', 'frenzied', 'warded', 'plagued', 'magnetic'] as const;
const ALL_CLASSES: readonly ClassId[] = ['duskhauler', 'gravewarden', 'ashwitch', 'widowblade'];

function ruleMet(rule: AchievementRule, meta: MetaSaveV4, r: RunReport | null, ctx: AchievementContext): boolean {
  const ext = r !== null && r.outcome === 'extracted';
  switch (rule.kind) {
    case 'run:extract': return ext;
    case 'run:ftueExtract': return ext && r.mode === 'ftue';
    case 'run:extractItems': return ext && r.settlement.kept.length >= rule.n;
    case 'run:extractGreed': return ext && r.settlement.greedMul >= rule.n - 1e-9;
    case 'run:extractAfter': return ext && r.elapsedS > rule.s;
    case 'run:extractGateC': return ext && r.gate?.id === 'c';
    case 'run:extractKind': return ext && r.gate?.kind === rule.gateKind;
    case 'run:extractHazard': return ext && r.hazard >= rule.h;
    case 'run:bossKill': return r !== null && r.bossKilled && r.zone === rule.zone;
    case 'run:midKill': return r !== null && r.midBossKilled && r.zone === rule.zone;
    case 'run:evolve': return r !== null && r.evolutions.includes(rule.weapon);
    case 'run:evolutions': return r !== null && r.evolutions.length >= rule.n;
    case 'run:maxRankWeapons': return r !== null && r.weaponsAtMaxRank >= rule.n;
    case 'run:extractWeekly': return ext && r.mode === 'weekly';
    case 'meta:allGates': return ALL_GATES.every((g) => inSet(meta, 'gatesUsed', g));
    case 'meta:mastery': return masteryStars(meta, rule.zone) >= rule.stars;
    case 'meta:kills': return meta.stats.kills >= rule.n;
    case 'meta:eliteKills': return meta.stats.eliteKills >= rule.n;
    case 'meta:allAffixes': return ALL_AFFIXES.every((a) => inSet(meta, 'affixesKilled', a));
    case 'meta:class': return ctx.accountLevel >= ctx.classUnlockLevel[rule.id] || meta.unlocks.includes(`class:${rule.id}`);
    case 'meta:everyClassExtract': return ALL_CLASSES.every((c) => inSet(meta, 'classesExtracted', c));
    case 'meta:ownRarity': return meta.vault.gear.some((g) => g.rarity >= rule.r);
    case 'meta:mergedHallowed': return inSet(meta, 'milestones', 'mergedHallowed');
    case 'meta:uniques': return new Set(meta.vault.gear.filter((g) => g.unique !== undefined).map((g) => g.unique)).size >= rule.n;
    case 'meta:valuables': return codexProgress(meta, 'valuables').found >= rule.n;
    case 'meta:lore': return meta.codex.lore.length >= rule.n;
    case 'meta:sanctumLevels': return Object.values(meta.upgrades).reduce((a, b) => a + b, 0) >= rule.n;
    case 'meta:keystone': return SANCTUM.some((n) => n.row === 4 && (meta.upgrades[n.id] ?? 0) > 0);
    case 'meta:contracts': return meta.stats.contractsClaimed >= rule.n;
    case 'meta:dailyStreak': return meta.daily.streak >= rule.n || inSet(meta, 'milestones', 'dailyStreak7');
  }
}

/** Marks every newly met achievement `'done'` (claiming is explicit). `r` = the run just settled, or null after a meta-only action. */
export function evaluateAchievements(meta: MetaSaveV4, r: RunReport | null, ctx: AchievementContext): string[] {
  const fresh: string[] = [];
  for (const def of ACHIEVEMENTS) {
    if (meta.achievements[def.id] !== undefined) continue;
    if (!ruleMet(def.rule, meta, r, ctx)) continue;
    meta.achievements[def.id] = 'done';
    fresh.push(def.id);
  }
  return fresh;
}
