import { TUNING } from '../config';
import type { Modifier } from '../core/stats';
import type { Rng } from '../core/rng';
import { CHARMS, charmDef, charmRankMods } from './charms';
import type {
  CardInfo,
  CardKindLabel,
  CharmId,
  DraftContext,
  PlayerStatKey,
  WeaponId,
  WeaponSlotView,
  WeaponsView,
} from './types-v2';
import { WEAPONS, WEAPON_MAX_RANK, weaponDef, weaponStats, type WeaponStats } from './weapons';

/**
 * In-run level-up draft (PRD-V2 §5.10) and the XP curve that paces it (§6.1).
 *
 * 72 cards: 12 weapon unlocks + 12 weapon boosts + 12 evolutions + 13 charm
 * unlocks + 13 charm ranks + 7 stat cards + `fx_lastgasp` + 2 fillers. Cards
 * are plain data; `describeCard` turns one into the §14.13 card copy against
 * the live `WeaponsView`, and `rollUpgradeChoices` owns every draft rule so the
 * scene and the headless sim deal identical hands from identical seeds.
 *
 * Applying a card (game.ts / sim):
 * - `stat` / `effect` / `filler`: push `modifiers` (source `upgrade:<id>`), run `effect` via `core/effects.ts`.
 * - `weapon-unlock` → `WeaponSystem.equip`, `weapon-boost` → `boost`, `weapon-evolution` → `evolve`.
 * - `charm-unlock` → `WeaponSystem.equipCharm`, `charm-rank` → `rankCharm` (the system applies the
 *   charm's stat mods itself via `charmRankMods`; the card's own `modifiers` are empty).
 */

export type Rarity = 'common' | 'rare' | 'epic';
export type UpgradeKind =
  | 'stat'
  | 'effect'
  | 'filler'
  | 'weapon-unlock'
  | 'weapon-boost'
  | 'weapon-evolution'
  | 'charm-unlock'
  | 'charm-rank';

/** Build-lane hints for the §8 routes and the sim bots. */
export type SynergyTag = 'offense' | 'area' | 'burst' | 'sustain' | 'mobility' | 'loot' | 'weapon';

/** §5.10 rarity weights: common 60 / rare 30 / epic 10 (unchanged). */
const RARITY_WEIGHT: Record<Rarity, number> = { common: 60, rare: 30, epic: 10 };

export interface CardMod {
  stat: PlayerStatKey;
  add?: number;
  mul?: number;
}

export interface UpgradeDef {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  /** Stat changes this card grants; source is `upgrade:<id>`. Empty for weapon and charm cards. */
  modifiers: readonly CardMod[];
  /** Behaviour hook id run by `core/effects.ts applyEffect`. */
  effect?: string;
  /** How many times this card can be taken in one run. */
  maxStacks: number;
  kind: UpgradeKind;
  weapon?: WeaponId;
  charm?: CharmId;
  synergy: SynergyTag;
}

/** §5.10 filler payloads, read by the `fill-bread` / `fill-purse` hooks in `core/effects.ts`. */
export const FILLER = { breadHealPct: 0.3, purseShards: 50 } as const;

const CHARM_SYNERGY: Record<CharmId, SynergyTag> = {
  c_oath: 'offense',
  c_bell: 'area',
  c_drum: 'offense',
  c_heart: 'sustain',
  c_eye: 'burst',
  c_tongue: 'loot',
  c_lodestone: 'loot',
  c_candle: 'area',
  c_spur: 'mobility',
  c_mail: 'sustain',
  c_salve: 'sustain',
  c_pouch: 'offense',
  c_step: 'mobility',
  c_pin: 'sustain',
  c_knuckle: 'burst',
  c_sole: 'mobility',
  c_fuse: 'area',
  c_vial: 'sustain',
  c_powder: 'offense',
  c_hymnal: 'offense',
  c_collar: 'area',
};

/** The 7 V1 stat cards + Last Gasp (values unchanged, §5.10). */
const STAT_CARDS: readonly UpgradeDef[] = [
  { id: 'stat_might', name: 'Grave Might', description: 'Marrow-deep strength for every blow', rarity: 'common', modifiers: [{ stat: 'damageMul', mul: 0.12 }], maxStacks: 5, kind: 'stat', synergy: 'offense' },
  { id: 'stat_haste', name: 'Dirge Tempo', description: 'The dead march faster to your drum', rarity: 'common', modifiers: [{ stat: 'cooldownMul', mul: -0.08 }], maxStacks: 5, kind: 'stat', synergy: 'offense' },
  { id: 'stat_area', name: 'Ashen Reach', description: 'Your curses spread like windblown ash', rarity: 'common', modifiers: [{ stat: 'area', mul: 0.15 }], maxStacks: 5, kind: 'stat', synergy: 'area' },
  { id: 'stat_crit', name: 'Dread Edge', description: 'Sometimes the blade remembers hatred', rarity: 'rare', modifiers: [{ stat: 'critChance', add: 0.06 }], maxStacks: 4, kind: 'stat', synergy: 'burst' },
  { id: 'stat_vital', name: 'Husk Hide', description: 'Leathered skin that forgets pain', rarity: 'common', modifiers: [{ stat: 'maxHp', add: 20 }], maxStacks: 4, kind: 'stat', synergy: 'sustain' },
  { id: 'stat_swift', name: 'Gloam Stride', description: 'Feet that never quite touch the mud', rarity: 'rare', modifiers: [{ stat: 'moveSpeed', mul: 0.08 }], maxStacks: 3, kind: 'stat', synergy: 'mobility' },
  {
    id: 'stat_greed',
    name: 'Gilt Hunger',
    description: 'Shards leap to a hungrier hand',
    rarity: 'rare',
    modifiers: [
      { stat: 'pickupRadius', add: 30 },
      { stat: 'shardsMul', mul: 0.1 },
    ],
    maxStacks: 3,
    kind: 'stat',
    synergy: 'loot',
  },
  { id: 'fx_lastgasp', name: 'Last Gasp', description: 'Once per run, refuse the grave', rarity: 'epic', modifiers: [], effect: 'last-gasp', maxStacks: 1, kind: 'effect', synergy: 'sustain' },
];

/** Offered only when fewer than 3 legal cards remain (§5.10). */
const FILLER_CARDS: readonly UpgradeDef[] = [
  { id: 'fill_bread', name: 'Grave Bread', description: 'Stale, but it holds the marrow in', rarity: 'common', modifiers: [], effect: 'fill-bread', maxStacks: 99, kind: 'filler', synergy: 'sustain' },
  { id: 'fill_purse', name: "Dead Man's Purse", description: 'Nobody will miss it now', rarity: 'common', modifiers: [], effect: 'fill-purse', maxStacks: 99, kind: 'filler', synergy: 'loot' },
];

/** The 72-card pool (§5.10). */
export const UPGRADE_CARDS: readonly UpgradeDef[] = [
  ...WEAPONS.map((w): UpgradeDef => ({
    id: `w_unlock_${w.id}`, name: w.name, description: w.description, rarity: 'common',
    modifiers: [], maxStacks: 1, kind: 'weapon-unlock', weapon: w.id, synergy: 'weapon',
  })),
  ...WEAPONS.map((w): UpgradeDef => ({
    id: `w_boost_${w.id}`, name: `Whetted ${w.name}`, description: `${w.name} +1 rank`, rarity: 'common',
    modifiers: [], maxStacks: TUNING.weapons.maxBoosts, kind: 'weapon-boost', weapon: w.id, synergy: 'weapon',
  })),
  ...WEAPONS.map((w): UpgradeDef => ({
    id: `w_evo_${w.id}`, name: w.evolvedName, description: `${w.name} becomes ${w.evolvedName}: ${w.evolvedDescription}`,
    rarity: 'epic', modifiers: [], maxStacks: 1, kind: 'weapon-evolution', weapon: w.id, synergy: 'weapon',
  })),
  ...CHARMS.map((c): UpgradeDef => ({
    id: `ch_unlock_${c.id}`, name: c.name, description: c.description, rarity: 'rare',
    modifiers: [], maxStacks: 1, kind: 'charm-unlock', charm: c.id, synergy: CHARM_SYNERGY[c.id],
  })),
  ...CHARMS.map((c): UpgradeDef => ({
    id: `ch_rank_${c.id}`, name: `${c.name} +1`, description: c.description, rarity: 'common',
    modifiers: [], maxStacks: TUNING.charms.maxRank - 1, kind: 'charm-rank', charm: c.id, synergy: CHARM_SYNERGY[c.id],
  })),
  ...STAT_CARDS,
  ...FILLER_CARDS,
];

/** §6.1: `xp.base + xp.linear × (L−1) + (L > xp.kneeLevel ? xp.kneeStep × (L − xp.kneeLevel) : 0)`. */
export function xpNeeded(level: number): number {
  const xp = TUNING.xp;
  const knee = level > xp.kneeLevel ? xp.kneeStep * (level - xp.kneeLevel) : 0;
  return xp.base + xp.linear * (level - 1) + knee;
}

function isWeaponCard(card: UpgradeDef): boolean {
  return card.kind === 'weapon-unlock' || card.kind === 'weapon-boost' || card.kind === 'weapon-evolution';
}

function cardLegal(card: UpgradeDef, ctx: DraftContext, taken: ReadonlyMap<string, number>): boolean {
  if ((taken.get(card.id) ?? 0) >= card.maxStacks) return false;
  const view = ctx.weapons;
  switch (card.kind) {
    case 'stat':
    case 'effect':
      return true;
    case 'filler':
      return false;
    case 'weapon-unlock': {
      const id = card.weapon as WeaponId;
      return ctx.unlockedWeapons.includes(id) && view.weapons.length < view.maxWeapons && !view.weapons.some((w) => w.id === id);
    }
    case 'weapon-boost': {
      const slot = view.weapons.find((w) => w.id === card.weapon);
      return slot !== undefined && !slot.evolved && slot.rank < view.maxRank;
    }
    case 'weapon-evolution':
      return view.evolutionEligible.includes(card.weapon as WeaponId);
    case 'charm-unlock': {
      const id = card.charm as CharmId;
      // §5.8b.3: a charm whose weapon is still locked is never offered.
      const evolves = charmDef(id).evolves;
      if (evolves !== null && !ctx.unlockedWeapons.includes(evolves)) return false;
      if (!ctx.unlockedCharms.includes(id) || view.charms.length >= view.maxCharms || view.charms.some((c) => c.id === id)) return false;
      // §5.8b.4.3: the last charm slot is reserved for a missing partner.
      if (view.charms.length === view.maxCharms - 1 && missingPartners(ctx, 1).length > 0) {
        return evolves !== null && view.weapons.some((w) => w.id === evolves);
      }
      return true;
    }
    case 'charm-rank': {
      const slot = view.charms.find((c) => c.id === card.charm);
      return slot !== undefined && slot.rank < view.maxCharmRank;
    }
  }
}

function drawWeighted(rng: Rng, pool: readonly UpgradeDef[], view?: WeaponsView): UpgradeDef {
  return rng.pickWeighted(
    pool,
    pool.map((card) => RARITY_WEIGHT[card.rarity] * (view !== undefined && evoMatchFor(card, view) !== undefined ? EVO_MATCH_WEIGHT : 1)),
  );
}

/** Cards that complete an evolution pair with something already owned draw this much more often. */
const EVO_MATCH_WEIGHT = 1.5;

/**
 * Evolution pairing of `card` with what the hero ALREADY owns (§5.8 partner):
 * a charm card whose weapon is owned and unevolved, or a weapon unlock/boost
 * whose partner charm is owned. `ready` = after taking the card the weapon is
 * at max rank with its partner owned (i.e. the evolution becomes eligible).
 * Evolution cards themselves never match — they ARE the payoff.
 */
function evoMatchFor(card: UpgradeDef, view: WeaponsView): CardInfo['evoMatch'] {
  if (card.charm !== undefined && (card.kind === 'charm-unlock' || card.kind === 'charm-rank')) {
    const weaponId = charmDef(card.charm).evolves;
    const slot = weaponId === null ? undefined : view.weapons.find((w) => w.id === weaponId);
    if (slot === undefined || slot.evolved) return undefined;
    const weapon = weaponDef(slot.id);
    return { partnerName: weapon.name, partnerIcon: `icon-wpn-${slot.id}`, evolvedName: weapon.evolvedName, ready: slot.rank >= view.maxRank };
  }
  if (card.weapon !== undefined && (card.kind === 'weapon-unlock' || card.kind === 'weapon-boost')) {
    const weapon = weaponDef(card.weapon);
    if (!view.charms.some((c) => c.id === weapon.partner)) return undefined;
    const slot = view.weapons.find((w) => w.id === card.weapon);
    if (slot?.evolved === true) return undefined;
    const rankAfter = card.kind === 'weapon-unlock' ? 1 : (slot?.rank ?? 0) + 1;
    return { partnerName: charmDef(weapon.partner).name, partnerIcon: `icon-charm-${weapon.partner}`, evolvedName: weapon.evolvedName, ready: rankAfter >= view.maxRank };
  }
  return undefined;
}

/**
 * Partner charms an owned, unevolved weapon at rank ≥ `minRank` still lacks,
 * restricted to charms the account has unlocked (§5.8b.4 "partner missing").
 */
function missingPartners(ctx: DraftContext, minRank: number): CharmId[] {
  const out: CharmId[] = [];
  for (const w of ctx.weapons.weapons) {
    if (w.evolved || w.rank < minRank) continue;
    const partner = weaponDef(w.id).partner;
    if (ctx.unlockedCharms.includes(partner) && !ctx.weapons.charms.some((c) => c.id === partner)) out.push(partner);
  }
  return out;
}

/**
 * §5.8b.4.2 partner pity, stateless: a partner-missing weapon (rank ≥ 2) gets
 * its partner's unlock card forced into every draft whose index ≡ 2 (mod 3).
 * Any 3 consecutive drafts contain exactly one such index, so "≥ 1 of every 3
 * consecutive drafts" holds without a run-side counter, and a reroll (same
 * `taken`) keeps the guarantee.
 */
const PARTNER_PITY_EVERY = 3;
const PARTNER_PITY_MIN_RANK = 2;

/**
 * Rank pity (added to meet §5.8b.4.5 "evolve by draft 16 in 100% of runs"):
 * drafts whose index ≡ 1 (mod 3) force the boost of the most-advanced
 * unevolved weapon below max rank (ties → slot order). Without it a build's
 * lead weapon can go 16 drafts without its boost appearing (measured: 1 in
 * ~40 seeded runs), which no partner pity can fix.
 */
const RANK_PITY_INDEX = 1;

/** Drafts (counted by `ctx.taken.length`) that always offer a weapon unlock while a slot is free. */
const FORCED_UNLOCK_DRAFTS = 3;

/**
 * §16.1 E12. Weighted, duplicate-free hand of `count` cards:
 * - a card at its stack limit, banished (`ctx.banished`), or illegal for the
 *   live `ctx.weapons` view leaves the pool: unlocks only for account-unlocked
 *   ids while a slot is free (4 weapons / 4 charms), boosts/ranks only for owned
 *   items below max rank;
 * - an evolution listed in `ctx.weapons.evolutionEligible` is FORCED into the
 *   hand (the caller passes `WeaponSystem.draftView()`, whose list holds only
 *   evolutions past `evolution.fallbackS` without a chest — §5.8 delivery);
 * - while a weapon slot is free, each of the first `FORCED_UNLOCK_DRAFTS`
 *   drafts holds one weapon-unlock card chosen UNIFORMLY among the unlocked,
 *   unowned weapons (rarity weights would otherwise let the class start
 *   weapon + the same early picks settle the build);
 * - §5.8b.4 partner pity (see `PARTNER_PITY_EVERY`) and last-charm-slot
 *   reservation, plus rank pity (`RANK_PITY_INDEX`); charms of account-locked
 *   weapons never enter the pool;
 * - fillers fill the hand only when fewer legal cards than `count` remain;
 * - every hand of 2+ holds at least one non-weapon card (never by swapping out
 *   a forced evolution or forced unlock).
 * Every draw goes through `rng`: same seed + same context = same hand.
 */
export function rollUpgradeChoices(rng: Rng, ctx: DraftContext, count: number): UpgradeDef[] {
  if (count <= 0) return [];
  const taken = new Map<string, number>();
  for (const id of ctx.taken) taken.set(id, (taken.get(id) ?? 0) + 1);

  let pool = UPGRADE_CARDS.filter((card) => !ctx.banished.includes(card.id) && cardLegal(card, ctx, taken));
  const choices: UpgradeDef[] = [];
  const take = (card: UpgradeDef): void => {
    choices.push(card);
    pool = pool.filter((c) => c.id !== card.id);
  };

  const evolutions = pool.filter((card) => card.kind === 'weapon-evolution');
  if (evolutions.length > 0) take(drawWeighted(rng, evolutions));
  let forcedUnlock: UpgradeDef | null = null;
  if (ctx.taken.length < FORCED_UNLOCK_DRAFTS && choices.length < count) {
    const unlocks = pool.filter((card) => card.kind === 'weapon-unlock');
    if (unlocks.length > 0) {
      forcedUnlock = rng.pick(unlocks);
      take(forcedUnlock);
    }
  }
  let forcedBoost: UpgradeDef | null = null;
  if (ctx.taken.length % PARTNER_PITY_EVERY === RANK_PITY_INDEX && choices.length < count) {
    let lead: WeaponSlotView | null = null;
    for (const w of ctx.weapons.weapons) {
      if (w.evolved || w.rank >= ctx.weapons.maxRank) continue;
      if (lead === null || w.rank > lead.rank) lead = w;
    }
    const boost = lead === null ? undefined : pool.find((card) => card.kind === 'weapon-boost' && card.weapon === lead?.id);
    if (boost !== undefined) {
      forcedBoost = boost;
      take(boost);
    }
  }
  let forcedPartner: UpgradeDef | null = null;
  if (ctx.taken.length % PARTNER_PITY_EVERY === PARTNER_PITY_EVERY - 1 && choices.length < count) {
    const wanted = missingPartners(ctx, PARTNER_PITY_MIN_RANK);
    const offers = pool.filter((card) => card.kind === 'charm-unlock' && wanted.includes(card.charm as CharmId));
    if (offers.length > 0) {
      forcedPartner = rng.pick(offers);
      take(forcedPartner);
    }
  }
  while (choices.length < count && pool.length > 0) take(drawWeighted(rng, pool, ctx.weapons));

  let fillers = FILLER_CARDS.filter((card) => !ctx.banished.includes(card.id));
  while (choices.length < count && fillers.length > 0) {
    const filler = drawWeighted(rng, fillers);
    choices.push(filler);
    fillers = fillers.filter((c) => c.id !== filler.id);
  }

  if (choices.length > 1 && choices.every(isWeaponCard)) {
    const nonWeapon = pool.filter((card) => !isWeaponCard(card));
    const replacement = nonWeapon.length > 0 ? drawWeighted(rng, nonWeapon) : fillers.length > 0 ? drawWeighted(rng, fillers) : null;
    if (replacement !== null) {
      for (let i = choices.length - 1; i >= 0; i -= 1) {
        if (choices[i]?.kind === 'weapon-evolution' || choices[i] === forcedUnlock || choices[i] === forcedPartner || choices[i] === forcedBoost) continue;
        choices[i] = replacement;
        break;
      }
    }
  }
  return choices;
}

// ───────────── describeCard (§5.10 / §14.13) ─────────────

const STAT_LABEL: Record<PlayerStatKey, string> = {
  maxHp: 'Max health',
  moveSpeed: 'Move speed',
  damageMul: 'Damage',
  cooldownMul: 'Cooldowns',
  area: 'Area',
  critChance: 'Crit chance',
  critMul: 'Crit damage',
  pickupRadius: 'Pickup radius',
  shardsMul: 'Shards',
  channelMs: 'Extract channel',
  bagCells: 'Bag cells',
  projectileBonus: 'Projectiles',
  durationMul: 'Duration',
  regenPerS: 'Regen',
  contactDamageMul: 'Contact damage taken',
  xpMul: 'XP',
  luck: 'Luck',
};

/** Stats whose `add` is a 0..1 fraction shown as percent. */
const FRACTION_STATS: Partial<Record<PlayerStatKey, true>> = { critChance: true, critMul: true };

function num(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function signed(n: number, suffix = ''): string {
  return `${n >= 0 ? '+' : '−'}${num(Math.abs(n))}${suffix}`;
}

/** "Damage +12%" / "Max health +20" / "Crit chance +6%". */
function modLine(mods: readonly CardMod[], times = 1): string {
  return mods
    .map((m) => {
      const label = STAT_LABEL[m.stat];
      if (m.mul !== undefined) return `${label} ${signed(m.mul * 100 * times, '%')}`;
      const add = (m.add ?? 0) * times;
      return FRACTION_STATS[m.stat] === true ? `${label} ${signed(add * 100, '%')}` : `${label} ${signed(add)}`;
    })
    .join(' · ');
}

const COUNT_LABEL: Record<WeaponId, string> = {
  bolt: 'Nails', orbit: 'Blades', nova: 'Bursts', scythe: 'Arcs', rail: 'Beams', hex: 'Jumps',
  skull: 'Skulls', censer: 'Pools', sickle: 'Sickles', lash: 'Sides', breath: 'Breaths', spears: 'Spikes',
  aura: 'Palls', chakram: 'Discs', wake: 'Trails', snares: 'Snares', siphon: 'Tethers', bombs: 'Urns',
  totem: 'Totems', thralls: 'Thralls',
};

/** Weapon stat deltas, most important first: "Damage 8 → 9.6 · Nails 1 → 2". */
function weaponDelta(id: WeaponId, from: WeaponStats, to: WeaponStats): string {
  const parts: string[] = [];
  const pair = (label: string, a: number, b: number, suffix = ''): void => {
    if (Math.abs(a - b) > 1e-6) parts.push(`${label} ${num(a)}${suffix} → ${num(b)}${suffix}`);
  };
  pair(id === 'censer' ? 'Damage/s' : 'Damage', from.damage, to.damage);
  pair(COUNT_LABEL[id], from.count, to.count);
  if (Number.isFinite(from.pierce) && Number.isFinite(to.pierce)) pair('Pierce', from.pierce, to.pierce);
  pair('Arc', from.arcDeg, to.arcDeg, '°');
  pair('Radius', from.radius, to.radius);
  pair('Length', from.length, to.length);
  pair('Bounces', from.bounces, to.bounces);
  pair('Range', from.range, to.range);
  if (Number.isFinite(from.durationMs) && Number.isFinite(to.durationMs)) {
    pair('Duration', from.durationMs / 1000, to.durationMs / 1000, ' s');
  } else if (!Number.isFinite(to.durationMs) && Number.isFinite(from.durationMs)) parts.push('Permanent');
  pair('HP', from.hp, to.hp);
  pair(id === 'aura' || id === 'totem' ? 'Every' : 'Cooldown', from.cooldownMs / 1000, to.cooldownMs / 1000, ' s');
  if (id === 'totem') pair('Pulse', from.tickMs / 1000, to.tickMs / 1000, ' s');
  if (to.healPct > from.healPct) parts.push(`Heal ${num(to.healPct * 100)}% of damage`);
  if (to.pullPxPerS > from.pullPxPerS) parts.push('Pulls enemies in');
  if (to.shards > from.shards) parts.push(`+${to.shards} shards per bounce`);
  if (to.burstDamage > from.burstDamage) parts.push(`Death burst ${num(to.burstDamage)}`);
  if (to.healPerKill > from.healPerKill) parts.push('Kills inside heal');
  if (to.critAdd > from.critAdd) parts.push(`Crit chance +${num(to.critAdd * 100)}%`);
  if (to.dotDps > from.dotDps) parts.push(`${id === 'nova' ? 'Burn field' : id === 'lash' ? 'Bleed' : id === 'breath' ? 'Ignite' : 'Rot'} ${num(to.dotDps)} dps`);
  if (to.slowPct > from.slowPct) parts.push(`Slow ${num(to.slowPct)}%`);
  if (to.rootMs > from.rootMs) parts.push(`Root ${num(to.rootMs / 1000)} s`);
  if (to.splashRadius > from.splashRadius) parts.push(`Burst r ${num(to.splashRadius)} for ${num(to.splashMul * 100)}%`);
  return parts.slice(0, 3).join(' · ');
}

/** "Damage 8 · every 0.9 s" — a fresh weapon's headline. */
function weaponHeadline(id: WeaponId, s: WeaponStats): string {
  const dmg = id === 'censer' ? `Damage ${num(s.damage)}/s` : id === 'breath' ? `Damage ${num(s.damage)} per tick` : `Damage ${num(s.damage)}`;
  const cadence = id === 'orbit' ? `hits every ${num(s.cooldownMs / 1000)} s` : `every ${num(s.cooldownMs / 1000)} s`;
  return `${dmg} · ${cadence}`;
}

function boostsOf(rank: number): number {
  return Math.max(0, rank - 1);
}

const KIND_LABEL: Record<UpgradeKind, CardKindLabel> = {
  'weapon-unlock': 'NEW WEAPON',
  'weapon-boost': 'WEAPON +1',
  'weapon-evolution': 'EVOLUTION',
  'charm-unlock': 'NEW CHARM',
  'charm-rank': 'CHARM +1',
  stat: 'STAT',
  effect: 'EFFECT',
  filler: 'EFFECT',
};

/** §16.1 E13: everything a draft card shows beyond its title art (§14.13). */
export function describeCard(card: UpgradeDef, view: WeaponsView, level: number): CardInfo {
  const slotLine = `WEAPONS ${view.weapons.length}/${view.maxWeapons} · CHARMS ${view.charms.length}/${view.maxCharms} · LV ${level}`;
  const info: CardInfo = {
    id: card.id,
    title: card.name,
    kindLabel: KIND_LABEL[card.kind],
    rankFrom: 0,
    rankTo: 0,
    rankMax: 0,
    deltaLine: '',
    slotLine,
  };

  if (card.weapon !== undefined) {
    const id = card.weapon;
    const def = weaponDef(id);
    const slot = view.weapons.find((w) => w.id === id);
    const rank = slot?.rank ?? 0;
    info.rankMax = view.maxRank;
    if (card.kind === 'weapon-unlock') {
      info.rankTo = 1;
      info.deltaLine = weaponHeadline(id, weaponStats(id, 0, false));
    } else if (card.kind === 'weapon-boost') {
      const from = Math.max(1, Math.min(view.maxRank - 1, rank));
      info.rankFrom = from;
      info.rankTo = from + 1;
      info.deltaLine = weaponDelta(id, weaponStats(id, boostsOf(from), false), weaponStats(id, boostsOf(from + 1), false));
    } else {
      info.rankFrom = rank;
      info.rankTo = rank;
      const boosts = boostsOf(WEAPON_MAX_RANK);
      info.deltaLine = weaponDelta(id, weaponStats(id, boosts, false), weaponStats(id, boosts, true));
    }
    info.evolvesWith = card.kind === 'weapon-evolution' ? charmDef(def.partner).name : `${charmDef(def.partner).name} → ${def.evolvedName}`;
    const match = evoMatchFor(card, view);
    if (match !== undefined) info.evoMatch = match;
    return info;
  }

  if (card.charm !== undefined) {
    const def = charmDef(card.charm);
    const slot = view.charms.find((c) => c.id === card.charm);
    const rank = slot?.rank ?? 0;
    info.rankMax = view.maxCharmRank;
    info.rankFrom = card.kind === 'charm-unlock' ? 0 : rank;
    info.rankTo = Math.min(view.maxCharmRank, info.rankFrom + 1);
    const gained = charmRankMods(def.id, info.rankTo);
    info.deltaLine = gained.length > 0 ? modLine(gained) : def.description;
    if (def.evolves !== null) {
      const weapon = weaponDef(def.evolves);
      info.evolvesWith = `${weapon.name} → ${weapon.evolvedName}`;
    }
    const match = evoMatchFor(card, view);
    if (match !== undefined) info.evoMatch = match;
    return info;
  }

  switch (card.effect) {
    case 'last-gasp':
      info.deltaLine = `Revive once at ${num(TUNING.effects.lastGasp.reviveHpRatio * 100)}% health`;
      break;
    case 'fill-bread':
      info.deltaLine = `Heal ${num(FILLER.breadHealPct * 100)}% of max health`;
      break;
    case 'fill-purse':
      info.deltaLine = `+${FILLER.purseShards} ◆`;
      break;
    default:
      info.deltaLine = modLine(card.modifiers);
  }
  return info;
}

/**
 * `Modifier[]` for a stat card, stamped with its run source — the one place the
 * `upgrade:<id>` source string is built (game.ts and sim).
 */
export function cardModifiers(card: UpgradeDef): Modifier[] {
  return card.modifiers.map((m) => ({ ...m, source: `upgrade:${card.id}` }));
}

/**
 * Boot-time guard (consumer `scenes/preload.ts`): every stat a card touches
 * must be a stat the game reads. Logs instead of throwing so a content typo
 * never blocks a build.
 */
export function validateUpgradeStats(knownStats: readonly string[]): string[] {
  const problems: string[] = [];
  const known = new Set(knownStats);
  for (const card of UPGRADE_CARDS) {
    for (const mod of card.modifiers) {
      if (!known.has(mod.stat)) problems.push(`card ${card.id}: unknown stat "${mod.stat}"`);
    }
  }
  for (const charm of CHARMS) {
    for (let rank = 1; rank <= TUNING.charms.maxRank; rank += 1) {
      for (const mod of charmRankMods(charm.id, rank)) {
        if (!known.has(mod.stat)) problems.push(`charm ${charm.id}: unknown stat "${mod.stat}"`);
      }
    }
  }
  if (problems.length > 0) {
    console.error(`[upgrades] ${problems.length} modifier(s) point at unread stats:`, problems);
  }
  return problems;
}
