import { TUNING } from '../config';
import type { Modifier } from './stats';
import { load, save } from './storage';
import { META_UPGRADES, upgradeCost, type MetaUpgradeDef } from '../data/upgrades';
import { RELICS, type RelicDef, type RelicSlot } from '../data/relics';

/** The three §5.5 equip slots, in the order the GEAR row draws them. */
const GEAR_SLOTS: readonly RelicSlot[] = ['blade', 'shroud', 'trinket'];

/**
 * Relic table by id, for the equipped-gear read in `runLoadout`. Built once:
 * `relicDef()` throws on an unknown id, and a stale gear pointer in an old save
 * must degrade to "no bonus", never to a crashed run.
 */
const RELICS_BY_ID: Record<string, RelicDef> = {};
for (const relic of RELICS) RELICS_BY_ID[relic.id] = relic;

/**
 * Persistent meta-progression: currency earned across runs, permanent
 * unlocks, and leveled meta-upgrades bought between runs. This is the only
 * place that reads/writes the `meta` storage slot — everything else asks it
 * for numbers instead of touching `localStorage` directly.
 *
 * Use for: roguelike / survivor-like / tactics games with a hub between runs
 * where power should persist even after a death.
 * Do NOT use for: in-run-only state (that is `RunState` / `StatBlock`) or for
 * anything that must reset every run — meta state is explicitly the opposite.
 */

const META_KEY = 'meta';
const META_VERSION = 3;

/** A calendar day in local time, `YYYY-MM-DD` — the granularity a daily streak counts in. */
export interface StreakSave {
  days: number;
  lastDayKey: string;
}

export interface MetaSave {
  version: number;
  currency: number;
  unlocks: string[];
  upgrades: Record<string, number>;
  /**
   * Lifetime counters. Duskhaul reads three of them under its own names
   * (§10): `runs` IS sessions, `wins` IS extractions, and `bestScore` IS the
   * best BANKED HAUL — never an arcade score, because a screen that crowns
   * kills-plus-seconds on a run that lost its loot teaches the player to
   * ignore extraction. `deaths` is deliberately not stored: it is `runs -
   * wins` and a second counter could only ever disagree with that.
   */
  stats: {
    runs: number;
    wins: number;
    bestScore: number;
    bestTimeMs: number;
    /** §10: killing the Warden is the build's proudest moment; it persists. */
    wardenKills: number;
  };
  /** Level id -> best star rating (0-3). Written by `recordStars`, read by the saga map. */
  stars: Record<string, number>;
  /** Consecutive-day login/play streak. */
  streak: StreakSave;
  /** Collection set id -> owned piece ids (see `core/collections.ts`). */
  collections: Record<string, string[]>;
  /** Booster id -> owned count. Spent by the pre-level booster picker. */
  boosters: Record<string, number>;
  /**
   * Banked relic ids, dupes allowed (§10 `stash`). Written by `bankRelics` on
   * a settlement, spent by `salvageFromStash`, and the pool the GEAR cells
   * cycle through.
   */
  stash: string[];
  /**
   * Equipped relic id per slot (§5.5: one relic each, so gear power is capped
   * by slot count). An equipped relic stays IN `stash` — equipping is a
   * pointer, not a move — so `salvageFromStash` must also clear any slot
   * pointing at the entry it removes, or a save round-trip resurrects a
   * dangling reference.
   */
  gear: { blade: string | null; shroud: string | null; trinket: string | null };
}

export const DEFAULT_META: MetaSave = {
  version: META_VERSION,
  currency: 0,
  unlocks: [],
  upgrades: {},
  stats: { runs: 0, wins: 0, bestScore: 0, bestTimeMs: 0, wardenKills: 0 },
  stars: {},
  streak: { days: 0, lastDayKey: '' },
  collections: {},
  boosters: {},
  stash: [],
  gear: { blade: null, shroud: null, trinket: null },
};

/** Highest star rating a level can be worth. */
export const MAX_STARS = 3;

/**
 * One entry per historical version bump: `MIGRATIONS[v]` upgrades an
 * already-coerced save sitting at version `v` into version `v + 1`. Never
 * mutate `DEFAULT_META` retroactively — add a step here instead.
 *
 * v1 -> v2 added the meta-kit slots (`stars`, `streak`, `collections`,
 * `boosters`). `coerceMeta` already defaults anything missing, so the step
 * only has to be explicit about *which* defaults a v1 save inherits and must
 * leave every v1 field (currency, unlocks, upgrades, stats) untouched.
 *
 * v2 -> v3 added Duskhaul's `stash` + `gear` (§10) and the `wardenKills`
 * counter. Purely additive: an existing v2 save keeps every shard, unlock and
 * upgrade it had and simply starts with an empty stash and nothing equipped.
 */
const MIGRATIONS: Record<number, (meta: MetaSave) => MetaSave> = {
  1: (meta) => ({
    ...meta,
    stars: meta.stars ?? {},
    streak: meta.streak ?? { days: 0, lastDayKey: '' },
    collections: meta.collections ?? {},
    boosters: meta.boosters ?? {},
  }),
  2: (meta) => ({
    ...meta,
    stash: meta.stash ?? [],
    gear: meta.gear ?? { blade: null, shroud: null, trinket: null },
    stats: { ...meta.stats, wardenKills: meta.stats.wardenKills ?? 0 },
  }),
};

/** Fills every field from a possibly-partial/stale stored blob, defaulting anything missing or malformed. */
function coerceMeta(raw: Partial<MetaSave>): MetaSave {
  return {
    version: typeof raw.version === 'number' ? raw.version : DEFAULT_META.version,
    currency: typeof raw.currency === 'number' ? raw.currency : DEFAULT_META.currency,
    // Records and arrays are always copied: a fresh save reads `DEFAULT_META`
    // itself as the storage fallback, and handing its containers out by
    // reference would let the first mutation rewrite the defaults.
    unlocks: Array.isArray(raw.unlocks) ? [...raw.unlocks] : [...DEFAULT_META.unlocks],
    upgrades: typeof raw.upgrades === 'object' && raw.upgrades !== null ? { ...raw.upgrades } : { ...DEFAULT_META.upgrades },
    stats:
      typeof raw.stats === 'object' && raw.stats !== null
        ? { ...DEFAULT_META.stats, ...raw.stats }
        : { ...DEFAULT_META.stats },
    stars: typeof raw.stars === 'object' && raw.stars !== null ? { ...raw.stars } : { ...DEFAULT_META.stars },
    streak:
      typeof raw.streak === 'object' && raw.streak !== null
        ? { ...DEFAULT_META.streak, ...raw.streak }
        : { ...DEFAULT_META.streak },
    collections: copySets(raw.collections),
    boosters:
      typeof raw.boosters === 'object' && raw.boosters !== null
        ? { ...raw.boosters }
        : { ...DEFAULT_META.boosters },
    stash: Array.isArray(raw.stash) ? [...raw.stash] : [...DEFAULT_META.stash],
    // Gear is spread over the defaults rather than copied wholesale so a save
    // written before a slot existed reads as "nothing equipped there", not
    // `undefined` — a missing slot would crash the GEAR cells' cycle.
    gear:
      typeof raw.gear === 'object' && raw.gear !== null
        ? { ...DEFAULT_META.gear, ...raw.gear }
        : { ...DEFAULT_META.gear },
  };
}

/** Deep-copies the owned-piece lists so a stored blob and the returned save never share arrays. */
function copySets(raw: Record<string, string[]> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [setId, pieces] of Object.entries(raw)) {
    if (Array.isArray(pieces)) out[setId] = [...pieces];
  }
  return out;
}

function migrate(raw: Partial<MetaSave>): MetaSave {
  let meta = coerceMeta(raw);
  while (meta.version < META_VERSION) {
    const step = MIGRATIONS[meta.version];
    meta = { ...(step ? step(meta) : meta), version: meta.version + 1 };
  }
  return meta;
}

/** Reads the meta-save, transparently migrating and persisting old versions. */
export function loadMeta(): MetaSave {
  const raw = load<Partial<MetaSave>>(META_KEY, DEFAULT_META);
  if (raw.version !== META_VERSION) {
    const migrated = migrate(raw);
    saveMeta(migrated);
    return migrated;
  }
  return coerceMeta(raw);
}

export function saveMeta(meta: MetaSave): void {
  save(META_KEY, meta);
}

/** Wipes meta-progression back to a fresh `DEFAULT_META` (e.g. a "reset save" menu option). */
export function resetMeta(): MetaSave {
  const meta: MetaSave = {
    version: DEFAULT_META.version,
    currency: DEFAULT_META.currency,
    unlocks: [],
    upgrades: {},
    stats: { ...DEFAULT_META.stats },
    stars: {},
    streak: { ...DEFAULT_META.streak },
    collections: {},
    boosters: {},
    stash: [],
    gear: { ...DEFAULT_META.gear },
  };
  saveMeta(meta);
  return meta;
}

export function grantCurrency(n: number): MetaSave {
  const meta = loadMeta();
  meta.currency = Math.max(0, meta.currency + n);
  saveMeta(meta);
  return meta;
}

export function hasUnlock(id: string): boolean {
  return loadMeta().unlocks.includes(id);
}

/** Permanently unlocks a piece of content (character, tower type, biome, ...). */
export function grantUnlock(id: string): MetaSave {
  const meta = loadMeta();
  if (!meta.unlocks.includes(id)) meta.unlocks.push(id);
  saveMeta(meta);
  return meta;
}

/**
 * Spends currency, refusing rather than going negative — the zone-unlock
 * purchase path (§5.7: 0 / 300 / 800 / 1600 shards), which has no cost curve
 * and so cannot route through `buyMetaLevel`. A refusal writes nothing, so a
 * caller can gate the unlock on the spend instead of checking the balance
 * first and racing itself.
 */
export function spendCurrency(n: number): { ok: boolean; meta: MetaSave } {
  const meta = loadMeta();
  const cost = Math.max(0, Math.round(n));
  if (meta.currency < cost) return { ok: false, meta };
  meta.currency -= cost;
  saveMeta(meta);
  return { ok: true, meta };
}

/**
 * Banks extracted relics into the stash (§5.6: on extract, all carried relics
 * land in the stash; on death, only the casket-pinned one does). Dupes are
 * allowed — the stash is a pile, not a set — so this appends and never
 * de-duplicates. Called once per settlement, BEFORE the results scene renders
 * (§14b abandon rule).
 */
export function bankRelics(ids: readonly string[]): MetaSave {
  const meta = loadMeta();
  if (ids.length === 0) return meta;
  meta.stash.push(...ids);
  saveMeta(meta);
  return meta;
}

/**
 * Equips a banked relic in one of the three §5.5 gear slots, or clears the
 * slot with `null`. Equipping is a POINTER into the stash, not a move: the
 * relic stays banked, which is what lets an equip be reversible in place with
 * no confirmation (§14b confirmation policy).
 *
 * A relic that is not in the stash is refused silently by clearing the slot
 * instead — the alternative is a slot pointing at loot the player does not
 * own, which would grant its gear effect for free.
 */
export function equipGear(slot: 'blade' | 'shroud' | 'trinket', relicId: string | null): MetaSave {
  const meta = loadMeta();
  meta.gear[slot] = relicId !== null && meta.stash.includes(relicId) ? relicId : null;
  saveMeta(meta);
  return meta;
}

/**
 * Salvages one stash entry for shards (§5.5 salvage ladder 10/30/80/200,
 * priced by the caller from `salvageFor(tier)`).
 *
 * Indexed rather than id-keyed on purpose: the stash allows duplicates, so an
 * id identifies a KIND and not the copy the player tapped — salvaging by id
 * would delete an arbitrary one of three Bone Dice and desync the row the
 * player was looking at.
 *
 * If the salvaged copy was the one equipped, the slot is cleared. Skipping
 * that leaves a dangling gear reference that survives a save round-trip and
 * keeps paying out a relic the player sold. The slot is only cleared when NO
 * other copy of that id remains banked.
 */
export function salvageFromStash(
  stashIndex: number,
  shards: number,
): { ok: boolean; meta: MetaSave } {
  const meta = loadMeta();
  const id = meta.stash[stashIndex];
  if (id === undefined) return { ok: false, meta };

  meta.stash.splice(stashIndex, 1);
  meta.currency = Math.max(0, meta.currency + Math.max(0, Math.round(shards)));
  if (!meta.stash.includes(id)) {
    for (const slot of ['blade', 'shroud', 'trinket'] as const) {
      if (meta.gear[slot] === id) meta.gear[slot] = null;
    }
  }
  saveMeta(meta);
  return { ok: true, meta };
}

/** Lifetime Warden kills (§10). One call per kill; the counter never resets. */
export function recordWardenKill(): MetaSave {
  const meta = loadMeta();
  meta.stats.wardenKills += 1;
  saveMeta(meta);
  return meta;
}

/**
 * How `MetaSave.stats.bestTimeMs` is scored. Survivor-likes want the LONGEST
 * run ever (`max`); a speedrun, a puzzle timer or a racer wants the FASTEST
 * (`min`); a turn-based or untimed game wants the field left alone (`off`).
 * The stored field is one number either way — its meaning is per game, which
 * is why no save migration is involved.
 */
export type BestTimeMode = 'max' | 'min' | 'off';

/** Folds a finished run's outcome into lifetime stats. Call once when a run ends. */
export function recordRunResult(
  result: { won: boolean; score: number; timeMs: number },
  options: { bestTimeMode?: BestTimeMode } = {},
): MetaSave {
  const meta = loadMeta();
  meta.stats.runs += 1;
  if (result.won) meta.stats.wins += 1;
  meta.stats.bestScore = Math.max(meta.stats.bestScore, result.score);

  const bestTimeMode = options.bestTimeMode ?? 'max';
  if (bestTimeMode === 'max') {
    meta.stats.bestTimeMs = Math.max(meta.stats.bestTimeMs, result.timeMs);
  } else if (bestTimeMode === 'min' && result.timeMs > 0) {
    // A stored 0 means "no time yet", not "instant": without this guard the
    // default save would beat every real run forever.
    meta.stats.bestTimeMs =
      meta.stats.bestTimeMs === 0 ? result.timeMs : Math.min(meta.stats.bestTimeMs, result.timeMs);
  }

  saveMeta(meta);
  return meta;
}

/**
 * Spends currency on the next level of a purchasable defined by its cost
 * curve — either a `MetaUpgradeDef` from `data/upgrades.ts` or a `MetaEntry`
 * from `data/metaCatalog.ts`. Cost follows `cost(level) = round(baseCost *
 * growth^level)` (see `upgradeCost`), so each level is a flat percentage more
 * expensive than the last — cheap early, deliberate later.
 *
 * A successful purchase only ever bumps `upgrades[id]`. What that level MEANS
 * is the caller's business: arena stat levels are read by `metaModifiers()`,
 * booster levels are paired with a `grantBooster` call by the shop, perk
 * levels are read straight out of the save by the slice.
 */
export function buyMetaLevel(entry: {
  id: string;
  maxLevel: number;
  baseCost: number;
  costGrowth: number;
}): { ok: boolean; meta: MetaSave; reason?: string } {
  const meta = loadMeta();
  const level = meta.upgrades[entry.id] ?? 0;
  if (level >= entry.maxLevel) return { ok: false, meta, reason: 'max level reached' };
  const cost = upgradeCost(entry, level);
  if (meta.currency < cost) return { ok: false, meta, reason: 'not enough currency' };
  meta.currency -= cost;
  meta.upgrades[entry.id] = level + 1;
  saveMeta(meta);
  return { ok: true, meta };
}

/**
 * A consumable's next price, escalating on the STOCKPILE the player is
 * sitting on rather than on lifetime purchases.
 *
 * That distinction is the whole reason boosters are sold without a cap.
 * Pricing off `upgrades[id]` (purchases ever made) is a soft cap wearing a
 * different hat: the twentieth ladle costs `70 * 1.35^19`, so the shop
 * eventually stops selling whether or not it says so. Pricing off
 * `boosters[boosterId]` (what is in the bag right now) makes the curve mean
 * something the player can act on — hoarding gets expensive, spending makes
 * the next one cheap again — and it can never lock the shelf.
 */
export function boosterPrice(entry: {
  boosterId: string;
  baseCost: number;
  costGrowth: number;
}): number {
  return upgradeCost(entry, loadMeta().boosters[entry.boosterId] ?? 0);
}

/**
 * Buys one consumable: pays `boosterPrice`, adds `boosterPerLevel` (default
 * 1) to the bag, and keeps `upgrades[id]` as the lifetime purchase counter so
 * existing saves and any "bought ever" display keep working.
 *
 * There is no cap and no `maxLevel` read. The only failure is not affording
 * the price, which the caller can show as a greyed price tag rather than as a
 * dead BOUGHT badge.
 */
export function buyBooster(entry: {
  id: string;
  boosterId: string;
  baseCost: number;
  costGrowth: number;
  boosterPerLevel?: number;
}): { ok: boolean; meta: MetaSave; cost: number; reason?: string } {
  const meta = loadMeta();
  const owned = meta.boosters[entry.boosterId] ?? 0;
  const cost = upgradeCost(entry, owned);
  if (meta.currency < cost) return { ok: false, meta, cost, reason: 'not enough currency' };
  meta.currency -= cost;
  meta.boosters[entry.boosterId] = owned + Math.max(1, Math.floor(entry.boosterPerLevel ?? 1));
  meta.upgrades[entry.id] = (meta.upgrades[entry.id] ?? 0) + 1;
  saveMeta(meta);
  return { ok: true, meta, cost };
}

/** `buyMetaLevel` for an id in `META_UPGRADES` — the arena stat-upgrade path. */
export function buyUpgrade(id: string): { ok: boolean; meta: MetaSave; reason?: string } {
  const def: MetaUpgradeDef | undefined = META_UPGRADES.find((u) => u.id === id);
  if (!def) return { ok: false, meta: loadMeta(), reason: 'unknown upgrade' };
  return buyMetaLevel(def);
}

/**
 * Turns every purchased meta-upgrade level into `Modifier`s a fresh
 * `StatBlock` can absorb at run start. Call once when a run begins; the
 * source string (`meta:<id>`) lets a respec clear only meta-sourced mods.
 *
 * `meta` is optional so a caller that has already read the save (`runLoadout`)
 * does not parse it a second time.
 */
export function metaModifiers(meta: MetaSave = loadMeta()): Modifier[] {
  const mods: Modifier[] = [];
  for (const def of META_UPGRADES) {
    const level = meta.upgrades[def.id] ?? 0;
    for (let i = 0; i < level; i += 1) {
      mods.push({ ...def.perLevel, source: `meta:${def.id}` });
    }
  }
  return mods;
}

/**
 * §10 perk magnitudes for the five rows that have NO `StatKey` and therefore
 * cannot live in `META_UPGRADES` (`m_reroll`, `m_casket`, `m_tithe`, `m_ward`,
 * `m_revive`). `data/metaCatalog.ts` owns their names, prices and level caps;
 * these are the numbers their descriptions promise, in the one place the run
 * reads them. Kept here rather than in `TUNING` because they are not balance
 * dials the sim sweeps — they are the definition of what the shop row sold.
 */
const PERKS = {
  /** `m_reroll` "Second Dirge": +1 free draft reroll per level. */
  rerollsPerLevel: 1,
  /** `m_casket` "Widow's Casket": +1 secure casket slot per level. */
  casketSlotsPerLevel: 1,
  /** `m_tithe` "Rot Tithe": keep this % of carried shards on death. */
  tithePct: 25,
  /** `m_ward` "Gate Ward": every gate stays open this many seconds longer, per level. */
  gateWindowSPerLevel: 15,
  /** `m_revive` "Last Rite": rise once per run at this fraction of max HP. */
  reviveHpRatio: 0.3,
} as const;

/**
 * Everything the meta save contributes to ONE run, resolved in ONE read.
 *
 * The run reads this exactly once, in `create()`. That is the contract: a
 * `loadMeta()` per frame parses the whole save per frame, and a run whose
 * numbers could change mid-flight is not reproducible from its seed.
 *
 * `modifiers` is the flat `StatBlock` feed — purchased meta levels AND the
 * three equipped relics' `gear` entries, which is what makes an equipped relic
 * actually do something. Everything else here is a NON-stat valve: the frozen
 * §16.1 `StatKey` union has no key for a casket slot, a gate window or a
 * revive, so those arrive as plain numbers the systems take as tuning.
 */
export interface RunLoadout {
  /** Meta-upgrade + equipped-gear stat modifiers, in that order. */
  modifiers: Modifier[];
  /** Extra secure casket slots (`m_casket`). Feeds `resolveBagCapacity`. */
  casketSlotsBonus: number;
  /** Seconds added to every gate's window (`m_ward` + Duskmirror's rider). */
  gateWindowBonusS: number;
  /** % of carried shards a death banks (`TUNING.meta.deathKeepPct` + `m_tithe`). */
  deathKeepPct: number;
  /** Free rerolls allowed in one draft (1 by default, +1 per `m_reroll` level). */
  rerollsPerDraft: number;
  /** Lethal blows refusable this run (`m_revive`), and the HP it rises at. */
  reviveCharges: number;
  reviveHpRatio: number;
  /** ms added to contact invulnerability (Widow's Veil rider). */
  iframesMsBonus: number;
  /** Contact-damage shift as a +fraction (Sorrowplate rider, -0.2). */
  contactDamageMul: number;
}

export function runLoadout(): RunLoadout {
  const meta = loadMeta();
  const modifiers = metaModifiers(meta);

  const loadout: RunLoadout = {
    modifiers,
    casketSlotsBonus: (meta.upgrades.m_casket ?? 0) * PERKS.casketSlotsPerLevel,
    gateWindowBonusS: (meta.upgrades.m_ward ?? 0) * PERKS.gateWindowSPerLevel,
    deathKeepPct: Math.min(
      100,
      TUNING.meta.deathKeepPct + ((meta.upgrades.m_tithe ?? 0) > 0 ? PERKS.tithePct : 0),
    ),
    rerollsPerDraft: 1 + (meta.upgrades.m_reroll ?? 0) * PERKS.rerollsPerLevel,
    reviveCharges: (meta.upgrades.m_revive ?? 0) > 0 ? 1 : 0,
    reviveHpRatio: PERKS.reviveHpRatio,
    iframesMsBonus: 0,
    contactDamageMul: 0,
  };

  // Equipped gear: one relic per §5.5 slot. Its `gear` entries are stat
  // modifiers; its optional `effect` is a rider that lands in the single slot
  // the owning system reads (`data/relics.ts` documents which).
  for (const slot of GEAR_SLOTS) {
    const id = meta.gear[slot];
    if (id === null) continue;
    // A slot may point at a relic the save no longer holds (a hand-edited or
    // partially-migrated save); an unknown id must not take the run down.
    const def = RELICS_BY_ID[id];
    if (def === undefined) continue;
    for (const mod of def.gear) {
      modifiers.push({ stat: mod.stat, add: mod.add, mul: mod.mul, source: `gear:${id}` });
    }
    const effect = def.effect;
    if (effect === undefined) continue;
    switch (effect.kind) {
      case 'iframesMs':
        loadout.iframesMsBonus += effect.value;
        break;
      case 'contactDamageMul':
        loadout.contactDamageMul += effect.value;
        break;
      case 'gateWindowS':
        loadout.gateWindowBonusS += effect.value;
        break;
    }
  }
  return loadout;
}

/**
 * §14b abandon rule: the in-flight marker that makes settlement undodgeable.
 *
 * A run that is closed, reloaded or crashed out of never reaches `finish()`,
 * so without this the player keeps a full bag by killing the tab — which, once
 * banking actually works, is strictly better than extracting. The marker is
 * written at run start, refreshed on every relic/casket mutation and at most
 * once a second for shards, and CLEARED by every settlement; a marker still
 * present at boot is by definition a run that ended without one.
 */
export interface RunJournal {
  zone: string;
  seed: string;
  /** Casket-pinned relic ids — the only relics a death settlement banks. */
  casket: string[];
  /** Shard checkpoint. Deliberately lossy (<=1Hz): the tithe is a fraction. */
  shards: number;
}

const JOURNAL_KEY = 'run';

export function writeRunJournal(journal: RunJournal): void {
  save(JOURNAL_KEY, journal);
}

export function clearRunJournal(): void {
  save(JOURNAL_KEY, null);
}

/**
 * Resolves a stale in-flight marker as a DEATH settlement (casket banked, Rot
 * Tithe honoured) and clears it. Returns what was settled, or `null` when there
 * was nothing to settle — the normal case. Called from `BootScene`, before any
 * scene that reads the stash renders.
 */
export function settleAbandonedRun(): { shards: number; relics: string[] } | null {
  const journal = load<RunJournal | null>(JOURNAL_KEY, null);
  if (journal === null || typeof journal !== 'object') return null;
  clearRunJournal();

  const casket = Array.isArray(journal.casket) ? journal.casket.filter((id) => typeof id === 'string') : [];
  const carried = typeof journal.shards === 'number' && journal.shards > 0 ? journal.shards : 0;
  // The SAME rule the live settlement uses (`Bag.settle('died', keepPct)`), so
  // abandoning cannot pay better or worse than dying on the floor.
  const banked = Math.floor((carried * runLoadout().deathKeepPct) / 100);
  recordRunResult({ won: false, score: banked, timeMs: 0 }, { bestTimeMode: 'max' });
  if (banked > 0) grantCurrency(banked);
  if (casket.length > 0) bankRelics(casket);
  return { shards: banked, relics: casket };
}

/**
 * Records a level's star rating, keeping the best one ever earned — a replay
 * that goes worse must never take stars away. Ratings are clamped to
 * `0..MAX_STARS` so a caller that hands over a raw score cannot inflate the
 * saga map.
 */
export function recordStars(levelId: string, stars: number): MetaSave {
  const meta = loadMeta();
  const clamped = Math.max(0, Math.min(MAX_STARS, Math.floor(stars)));
  const best = meta.stars[levelId] ?? 0;
  if (clamped > best) {
    meta.stars[levelId] = clamped;
    saveMeta(meta);
  }
  return meta;
}

export function bestStars(levelId: string): number {
  return loadMeta().stars[levelId] ?? 0;
}

/** Lifetime star total — the currency saga-map gates and star-chests unlock against. */
export function totalStars(): number {
  let total = 0;
  for (const stars of Object.values(loadMeta().stars)) {
    if (typeof stars === 'number') total += stars;
  }
  return total;
}

/**
 * Advances the consecutive-day streak. Idempotent within one local calendar
 * day (a session that opens the app twice does not count twice), extends when
 * the last touch was *yesterday*, and restarts at 1 after any longer gap.
 * `now` is injectable so the transitions are testable without waiting a day.
 *
 * `extended` is true only on the day the streak actually grew — that is the
 * signal for "show the streak reward", not `days`.
 */
export function touchDailyStreak(now: Date = new Date()): { days: number; extended: boolean } {
  const meta = loadMeta();
  const today = localDayKey(now);
  if (meta.streak.lastDayKey === today) return { days: meta.streak.days, extended: false };

  const yesterday = localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const extended = meta.streak.lastDayKey === yesterday;
  meta.streak = { days: extended ? meta.streak.days + 1 : 1, lastDayKey: today };
  saveMeta(meta);
  return { days: meta.streak.days, extended };
}

/**
 * Local calendar day, not UTC: a streak must break at the player's midnight,
 * otherwise anyone west of Greenwich loses a day early.
 */
function localDayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Adds a collection piece (see `core/collections.ts`). `added` is false for a
 * duplicate, so the caller knows whether to play the "new piece" celebration.
 * `completed` needs the set's size — pass `setSize` (usually
 * `def.pieces.length`) to get it; without it the answer is always false,
 * because progression deliberately does not know the game's content tables.
 */
export function addToCollection(
  setId: string,
  pieceId: string,
  setSize?: number,
): { added: boolean; completed: boolean } {
  const meta = loadMeta();
  const owned = meta.collections[setId] ?? [];
  const added = !owned.includes(pieceId);
  if (added) {
    owned.push(pieceId);
    meta.collections[setId] = owned;
    saveMeta(meta);
  }
  return { added, completed: setSize !== undefined && owned.length >= setSize };
}

export function ownedPieces(setId: string): string[] {
  return loadMeta().collections[setId] ?? [];
}

/** Grants `n` boosters (rewards, streak payouts, IAP). Counts never go below zero. */
export function grantBooster(id: string, n: number): MetaSave {
  const meta = loadMeta();
  meta.boosters[id] = Math.max(0, Math.floor((meta.boosters[id] ?? 0) + n));
  saveMeta(meta);
  return meta;
}

export function boosterCount(id: string): number {
  return loadMeta().boosters[id] ?? 0;
}

/**
 * Counts for several boosters in ONE save read. An in-level tray shows every
 * consumable at once and re-reads them after every spend; asking
 * `boosterCount` per chip parses the whole save once per chip per repaint.
 */
export function boosterCounts(ids: readonly string[]): Record<string, number> {
  const owned = loadMeta().boosters;
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = owned[id] ?? 0;
  return out;
}

/**
 * Consumes one booster. Returns false and writes nothing when the player has
 * none, so a caller can gate the effect on the spend instead of checking the
 * count first and racing itself.
 */
export function spendBooster(id: string): boolean {
  const meta = loadMeta();
  const count = meta.boosters[id] ?? 0;
  if (count <= 0) return false;
  meta.boosters[id] = count - 1;
  saveMeta(meta);
  return true;
}
