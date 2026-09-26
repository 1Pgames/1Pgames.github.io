/**
 * Gear (PRD-V2 §5.15): 6 rarities, 30 bases (5 per slot), 8 uniques, the
 * seeded roll, item-level scaling, value, and the §10 v3 → v4 relic
 * conversion table. Pure TS (no Phaser, no storage).
 *
 * Base ids are the kebab-cased §5.15.2 names and match the art ids
 * (`icon-gear-<base>`). A unique carries `unique: 'u_*'` AND `base: 'u_*'`
 * (uniques have no underlying base; `icon-uniq-<unique>`).
 */
import { TUNING } from '../config';
import type { Rng } from '../core/rng';
import {
  AFFIXES,
  CAPSTONE_WEIGHT_PROJ,
  affixDef,
  hasAffix,
  affixRange,
  affixStatMod,
  affixWeight,
  roundAffix,
  unitMod,
  type AffixDef,
  type AffixUnit,
} from './affixes';
import type { GearAffix, GearInstance, GearSlot, PlayerStatKey, Rarity, StatMod, ZoneId } from './types-v2';

export interface RarityDef {
  r: Rarity;
  name: string;
  /** Swatch colour (CSS) and its 0xRRGGBB twin; swatches carry a 2 px `#7e7376` ring (UI). */
  color: string;
  colorHex: number;
  /** Affix count at this rarity (Hallowed adds a capstone on merge). */
  affixes: number;
  weight: number;
  dust: number;
  implicitMul: number;
}

const RARITIES: readonly RarityDef[] = [
  { r: 1, name: 'Tarnished', color: '#a5a38b', colorHex: 0xa5a38b, affixes: 0, weight: TUNING.gear.rarityWeights[0], dust: TUNING.gear.dustByRarity[0], implicitMul: 1.0 },
  { r: 2, name: 'Worn', color: '#6f8fa6', colorHex: 0x6f8fa6, affixes: 1, weight: TUNING.gear.rarityWeights[1], dust: TUNING.gear.dustByRarity[1], implicitMul: 1.15 },
  { r: 3, name: 'Burnished', color: '#c07a3a', colorHex: 0xc07a3a, affixes: 2, weight: TUNING.gear.rarityWeights[2], dust: TUNING.gear.dustByRarity[2], implicitMul: 1.3 },
  { r: 4, name: 'Gilded', color: '#f3ca67', colorHex: 0xf3ca67, affixes: 3, weight: TUNING.gear.rarityWeights[3], dust: TUNING.gear.dustByRarity[3], implicitMul: 1.5 },
  { r: 5, name: 'Dread', color: '#ad6eef', colorHex: 0xad6eef, affixes: 4, weight: TUNING.gear.rarityWeights[4], dust: TUNING.gear.dustByRarity[4], implicitMul: 1.75 },
  { r: 6, name: 'Hallowed', color: '#e8f0ff', colorHex: 0xe8f0ff, affixes: 5, weight: TUNING.gear.rarityWeights[5], dust: TUNING.gear.dustByRarity[5], implicitMul: 2.0 },
];

export function rarityDef(r: Rarity): RarityDef {
  return RARITIES[r - 1]!;
}

export const GEAR_SLOTS: readonly GearSlot[] = ['hood', 'shroud', 'grips', 'boots', 'ring', 'amulet'];

export const MAX_ITEM_LEVEL = 20;

/** One implicit line: `value` in the unit its label prints (see `data/affixes.ts`). */
export interface ImplicitDef { stat: PlayerStatKey; unit: AffixUnit; value: number }
export interface GearBaseDef { id: string; name: string; slot: GearSlot; implicit: readonly ImplicitDef[] }

const hp = (value: number): ImplicitDef => ({ stat: 'maxHp', unit: 'flat', value });
const pickup = (value: number): ImplicitDef => ({ stat: 'pickupRadius', unit: 'flat', value });
const armor = (pct: number): ImplicitDef => ({ stat: 'contactDamageMul', unit: 'pctAddNeg', value: pct });
const speed = (pct: number): ImplicitDef => ({ stat: 'moveSpeed', unit: 'pctMul', value: pct });
const crit = (pct: number): ImplicitDef => ({ stat: 'critChance', unit: 'pctAdd', value: pct });
const area = (pct: number): ImplicitDef => ({ stat: 'area', unit: 'pctAdd', value: pct });
const dmg = (pct: number): ImplicitDef => ({ stat: 'damageMul', unit: 'pctAdd', value: pct });
const cd = (pct: number): ImplicitDef => ({ stat: 'cooldownMul', unit: 'pctAddNeg', value: pct });
const dur = (pct: number): ImplicitDef => ({ stat: 'durationMul', unit: 'pctAdd', value: pct });
const critMul = (value: number): ImplicitDef => ({ stat: 'critMul', unit: 'flat', value });
const regen = (value: number): ImplicitDef => ({ stat: 'regenPerS', unit: 'flat', value });
const shards = (pct: number): ImplicitDef => ({ stat: 'shardsMul', unit: 'pctAdd', value: pct });
const xp = (pct: number): ImplicitDef => ({ stat: 'xpMul', unit: 'pctAdd', value: pct });
const luck = (value: number): ImplicitDef => ({ stat: 'luck', unit: 'flat', value });

/** §5.15.2 — implicit at rarity 1, level 1. */
export const GEAR_BASES: readonly GearBaseDef[] = [
  { id: 'sackcloth-hood', name: 'Sackcloth Hood', slot: 'hood', implicit: [hp(8)] },
  { id: 'gravediggers-cap', name: "Gravedigger's Cap", slot: 'hood', implicit: [pickup(15)] },
  { id: 'plague-mask', name: 'Plague Mask', slot: 'hood', implicit: [armor(4)] },
  { id: 'iron-coif', name: 'Iron Coif', slot: 'hood', implicit: [hp(12), speed(-2)] },
  { id: 'mourning-veil', name: 'Mourning Veil', slot: 'hood', implicit: [crit(2)] },
  { id: 'burial-shroud', name: 'Burial Shroud', slot: 'shroud', implicit: [hp(10)] },
  { id: 'rust-brigandine', name: 'Rust Brigandine', slot: 'shroud', implicit: [armor(6)] },
  { id: 'pilgrim-cloak', name: 'Pilgrim Cloak', slot: 'shroud', implicit: [speed(3)] },
  { id: 'bone-lamellar', name: 'Bone Lamellar', slot: 'shroud', implicit: [hp(16), speed(-3)] },
  { id: 'ash-mantle', name: 'Ash Mantle', slot: 'shroud', implicit: [area(4)] },
  { id: 'gut-wrap-gloves', name: 'Gut-Wrap Gloves', slot: 'grips', implicit: [dmg(3)] },
  { id: 'iron-gauntlets', name: 'Iron Gauntlets', slot: 'grips', implicit: [dmg(4), speed(-1)] },
  { id: 'thiefs-grips', name: "Thief's Grips", slot: 'grips', implicit: [cd(3)] },
  { id: 'hexbinder-wraps', name: 'Hexbinder Wraps', slot: 'grips', implicit: [dur(5)] },
  { id: 'butchers-mitts', name: "Butcher's Mitts", slot: 'grips', implicit: [critMul(0.1)] },
  { id: 'mud-boots', name: 'Mud Boots', slot: 'boots', implicit: [speed(3)] },
  { id: 'grave-treads', name: 'Grave Treads', slot: 'boots', implicit: [speed(2), hp(5)] },
  { id: 'ashwalker-soles', name: 'Ashwalker Soles', slot: 'boots', implicit: [regen(0.1)] },
  { id: 'courier-boots', name: 'Courier Boots', slot: 'boots', implicit: [speed(5), hp(-5)] },
  { id: 'iron-sabatons', name: 'Iron Sabatons', slot: 'boots', implicit: [armor(5)] },
  { id: 'tin-band', name: 'Tin Band', slot: 'ring', implicit: [shards(3)] },
  { id: 'thornband', name: 'Thornband', slot: 'ring', implicit: [dmg(3)] },
  { id: 'bone-dice-ring', name: 'Bone Dice Ring', slot: 'ring', implicit: [crit(2)] },
  { id: 'signet-of-hours', name: 'Signet of Hours', slot: 'ring', implicit: [cd(2)] },
  { id: 'lodestone-loop', name: 'Lodestone Loop', slot: 'ring', implicit: [pickup(20)] },
  { id: 'rat-tooth-charm', name: 'Rat-Tooth Charm', slot: 'amulet', implicit: [shards(4)] },
  { id: 'ash-locket', name: 'Ash Locket', slot: 'amulet', implicit: [hp(8)] },
  { id: 'dirge-pipe', name: 'Dirge Pipe', slot: 'amulet', implicit: [pickup(20)] },
  { id: 'saints-knuckle', name: "Saint's Knuckle", slot: 'amulet', implicit: [xp(4)] },
  { id: 'gloam-talisman', name: 'Gloam Talisman', slot: 'amulet', implicit: [luck(1)] },
];

/**
 * §5.15.4 uniques (Dread, fixed). `mods` are the stat half of "Fixed effects";
 * `runLoadout` folds `gateWindowS` / `channelMs`; every other rider in
 * `effects` is applied by its owning system keyed by the unique id in
 * `RunLoadoutV2.uniques` (vault key: poi, gate reveal: minimap, blades /
 * Gloam Step / DoT: weapons, Frost Salt: game.ts).
 */
export interface UniqueDef {
  id: string;
  name: string;
  slot: GearSlot;
  /** Display copy of every fixed effect. */
  effects: string;
  mods: readonly ImplicitDef[];
  /** Folded by `runLoadout` into `gateWindowBonusS` / `channelMsDelta`. */
  gateWindowS?: number;
  channelMs?: number;
  source: string;
}

export const UNIQUES: readonly UniqueDef[] = [
  { id: 'u_dreadcrown', name: 'Dread Crown', slot: 'hood', effects: 'Damage +12%, Crit Damage +0.3', mods: [dmg(12), critMul(0.3)], source: 'legacy r_dreadcrown' },
  { id: 'u_sorrowplate', name: 'Sorrowplate', slot: 'shroud', effects: 'Max Health +30, Contact Damage −20%', mods: [hp(30), armor(20)], source: 'legacy r_sorrowplate' },
  { id: 'u_gravekey', name: 'Gravekey', slot: 'amulet', effects: 'Extract −800 ms, vault opens without a key', mods: [], channelMs: -800, source: 'legacy r_gravekey' },
  { id: 'u_duskmirror', name: 'Duskmirror', slot: 'ring', effects: 'Gate windows +20 s, minimap shows all gates from 0 s', mods: [], gateWindowS: 20, source: 'legacy r_duskmirror' },
  { id: 'u_bellrope', name: "Bell-Ringer's Rope", slot: 'grips', effects: 'Bone Halo/Marrow Wheel +2 blades, Area +8%', mods: [area(8)], source: 'castle boss' },
  { id: 'u_gibbetboots', name: 'Gibbet Boots', slot: 'boots', effects: 'Move Speed +10%, Gloam Step cd −1 s if owned', mods: [speed(10)], source: 'outlands boss' },
  { id: 'u_suneater', name: "Sun-Eater's Sigil", slot: 'amulet', effects: 'Burn/DoT damage +40%, Duration +15%', mods: [dur(15)], source: 'desert boss' },
  { id: 'u_rimeheart', name: 'Rimeheart', slot: 'ring', effects: 'Frost Salt pickups freeze 5 s; Regen +0.5/s', mods: [regen(0.5)], source: 'winter boss' },
];

/** Boss-zone → unique the Boss Chest/Vault unique roll prefers (legacy uniques are Vault-only). */
const ZONE_UNIQUES: Readonly<Record<ZoneId, readonly string[]>> = {
  castle: ['u_bellrope', 'u_dreadcrown', 'u_sorrowplate', 'u_gravekey', 'u_duskmirror'],
  outlands: ['u_gibbetboots', 'u_dreadcrown', 'u_sorrowplate', 'u_gravekey', 'u_duskmirror'],
  desert: ['u_suneater', 'u_dreadcrown', 'u_sorrowplate', 'u_gravekey', 'u_duskmirror'],
  winter: ['u_rimeheart', 'u_dreadcrown', 'u_sorrowplate', 'u_gravekey', 'u_duskmirror'],
};

const BASE_BY_ID: Record<string, GearBaseDef> = Object.fromEntries(GEAR_BASES.map((b) => [b.id, b]));
const UNIQUE_BY_ID: Record<string, UniqueDef> = Object.fromEntries(UNIQUES.map((u) => [u.id, u]));

/** Display name: base or unique name. Unknown ids (stale save) show the raw id. */
export function gearName(item: GearInstance): string {
  if (item.unique !== undefined) return UNIQUE_BY_ID[item.unique]?.name ?? item.unique;
  return BASE_BY_ID[item.base]?.name ?? item.base;
}

/** Item-level factor on implicits (and unique fixed stats): `1 + 0.05·(lvl − 1)`. */
function levelFactor(level: number): number {
  return 1 + 0.05 * (Math.max(1, Math.min(MAX_ITEM_LEVEL, level)) - 1);
}

/** The implicit lines at the item's rarity and level, rounded for display/stacking. */
function implicitLines(item: GearInstance): ImplicitDef[] {
  if (item.unique !== undefined) {
    const def = UNIQUE_BY_ID[item.unique];
    if (!def) return [];
    const f = levelFactor(item.level);
    return def.mods.map((m) => ({ ...m, value: roundAffix(m.value * f) }));
  }
  const base = BASE_BY_ID[item.base];
  if (!base) return [];
  const f = rarityDef(item.rarity).implicitMul * levelFactor(item.level);
  return base.implicit.map((m) => ({ ...m, value: roundAffix(m.value * f) }));
}

/** §16.1 E25: every stat contribution of one item (implicit/unique fixed + stat affixes). Source = `gear:<uid>`. */
export function gearMods(item: GearInstance): StatMod[] {
  const source = `gear:${item.uid}`;
  const mods: StatMod[] = implicitLines(item).map((m) => unitMod(m.stat, m.unit, m.value, source));
  const unique = item.unique !== undefined ? UNIQUE_BY_ID[item.unique] : undefined;
  if (unique?.channelMs !== undefined) mods.push({ stat: 'channelMs', add: unique.channelMs, source });
  for (const a of item.affixes) {
    if (!hasAffix(a.id)) continue;
    const mod = affixStatMod(affixDef(a.id), a.value, source);
    if (mod) mods.push(mod);
  }
  return mods;
}

/** Non-stat affix/unique totals of one item (behavioural valves). */
export function gearBehaviour(item: GearInstance): { iframesMs: number; gateWindowS: number; eliteDamagePct: number } {
  let iframesMs = 0;
  let gateWindowS = item.unique !== undefined ? (UNIQUE_BY_ID[item.unique]?.gateWindowS ?? 0) : 0;
  let eliteDamagePct = 0;
  for (const a of item.affixes) {
    if (a.id === 'a_iframes') iframesMs += a.value;
    else if (a.id === 'a_gatewin') gateWindowS += a.value;
    else if (a.id === 'a_elitedmg') eliteDamagePct += a.value;
  }
  return { iframesMs, gateWindowS, eliteDamagePct };
}

/** Bag/vault value in ◆ (`gear.valueByRarity`), read by `systems/bag.ts itemValue`. */
export function gearValue(item: GearInstance): number {
  return TUNING.gear.valueByRarity[item.rarity - 1] ?? 0;
}

/** One affix value inside `def`'s range at `rarity`; `max` forces the top of the range (Hallowed capstone). */
function rollAffixValue(rng: Rng, def: AffixDef, rarity: Rarity, max = false): number {
  const range = affixRange(def, rarity);
  if (range === null) throw new Error(`rollAffixValue: ${def.id} cannot roll at rarity ${rarity}`);
  const [lo, hi] = range;
  if (max) return hi;
  const steps = Math.round((hi - lo) / def.step);
  return roundAffix(lo + def.step * rng.int(0, steps));
}

/**
 * Draws one affix not already on the item. `capstone` switches to the
 * Hallowed capstone pool (every r6 affix, `a_proj` at full weight, max roll).
 * Returns null when nothing is left to draw.
 */
export function rollNewAffix(rng: Rng, rarity: Rarity, taken: readonly GearAffix[], capstone = false): GearAffix | null {
  const pool: AffixDef[] = [];
  const weights: number[] = [];
  for (const def of AFFIXES) {
    if (taken.some((a) => a.id === def.id)) continue;
    let w = affixWeight(def, rarity);
    if (capstone && def.id === 'a_proj') w = CAPSTONE_WEIGHT_PROJ;
    if (w <= 0) continue;
    pool.push(def);
    weights.push(w);
  }
  if (pool.length === 0) return null;
  const def = rng.pickWeighted(pool, weights);
  return { id: def.id, value: rollAffixValue(rng, def, rarity, capstone) };
}

export interface GearRollContext { tierBias: number; luck: number; lootBias: number; itemLevel: number; uniqueChance: number; zone: ZoneId }

/**
 * Rarity weights shifted by `shift` points: each whole point moves every
 * rollable tier's weight one step up (negative: down), mass conserved, so a
 * shift of k ≥ 0 never yields rarity < 1 + k. The fractional remainder moves
 * that share one more step. Mass piles on Dread at the top (Hallowed is
 * merge-only) and on Tarnished at the bottom.
 */
function shiftedRarityWeights(shift: number): number[] {
  const base = RARITIES.slice(0, 5).map((r) => r.weight);
  const whole = Math.floor(shift);
  const frac = shift - whole;
  const moveBy = (w: readonly number[], k: number): number[] => {
    const out = [0, 0, 0, 0, 0];
    for (let i = 0; i < 5; i += 1) out[Math.max(0, Math.min(4, i + k))]! += w[i]!;
    return out;
  };
  const lo = moveBy(base, whole);
  if (frac === 0) return lo;
  const hi = moveBy(base, whole + 1);
  return lo.map((w, i) => w * (1 - frac) + hi[i]! * frac);
}

/** r1..r5 probabilities (sum 1) for a total shift (`tierBias + luck×0.5 + lootBias`) — same weights `rollGear` draws from. */
export function rarityOdds(shift: number): number[] {
  const w = shiftedRarityWeights(shift);
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / total);
}

/**
 * §16.1 E25 seeded item roll. The uid comes from the same rng stream (two
 * 31-bit draws), so the same seed reproduces the same item, uid included.
 */
export function rollGear(rng: Rng, ctx: GearRollContext): GearInstance {
  const uid = `g-${Math.floor(rng.next() * 0x7fffffff).toString(36)}${Math.floor(rng.next() * 0x7fffffff).toString(36)}`;
  const level = Math.max(1, Math.min(MAX_ITEM_LEVEL, Math.round(ctx.itemLevel)));

  if (ctx.uniqueChance > 0 && rng.chance(ctx.uniqueChance)) {
    const id = rng.pick(ZONE_UNIQUES[ctx.zone]);
    const def = UNIQUE_BY_ID[id]!;
    return { uid, base: id, slot: def.slot, rarity: 5, level, affixes: [], unique: id };
  }

  const shift = ctx.tierBias + ctx.luck * 0.5 + ctx.lootBias;
  const rarities: Rarity[] = [1, 2, 3, 4, 5];
  const rarity = rng.pickWeighted(rarities, shiftedRarityWeights(shift));
  const base = rng.pick(GEAR_BASES);
  const affixes: GearAffix[] = [];
  for (let i = 0; i < rarityDef(rarity).affixes; i += 1) {
    const a = rollNewAffix(rng, rarity, affixes);
    if (a === null) break;
    affixes.push(a);
  }
  return { uid, base: base.id, slot: base.slot, rarity, level, affixes };
}

export interface LegacyRelicConversion { base: string; slot: GearSlot; rarity: Rarity; affixes: GearAffix[]; unique?: string }

/** §10 v3 → v4 relic conversion, keyed by V1 relic id (literal ids; no import from `data/relics.ts`). */
export const LEGACY_RELIC_MAP: Readonly<Record<string, LegacyRelicConversion>> = {
  r_toothcharm: { base: 'rat-tooth-charm', slot: 'amulet', rarity: 1, affixes: [] },
  r_rustbuckle: { base: 'burial-shroud', slot: 'shroud', rarity: 1, affixes: [] },
  r_waxseal: { base: 'gut-wrap-gloves', slot: 'grips', rarity: 1, affixes: [] },
  r_bonedice: { base: 'bone-dice-ring', slot: 'ring', rarity: 1, affixes: [] },
  r_thornring: { base: 'thornband', slot: 'ring', rarity: 2, affixes: [{ id: 'a_dmg', value: 3 }] },
  r_ashlocket: { base: 'ash-locket', slot: 'amulet', rarity: 2, affixes: [{ id: 'a_hp', value: 8 }] },
  r_gloamboot: { base: 'mud-boots', slot: 'boots', rarity: 2, affixes: [{ id: 'a_speed', value: 2 }] },
  r_dirgepipe: { base: 'dirge-pipe', slot: 'amulet', rarity: 2, affixes: [{ id: 'a_pickup', value: 10 }] },
  r_marrowidol: { base: 'thiefs-grips', slot: 'grips', rarity: 3, affixes: [{ id: 'a_cd', value: 3 }, { id: 'a_dmg', value: 4 }] },
  r_widowveil: { base: 'mourning-veil', slot: 'hood', rarity: 3, affixes: [{ id: 'a_hp', value: 12 }, { id: 'a_iframes', value: 25 }] },
  r_giltskull: { base: 'rat-tooth-charm', slot: 'amulet', rarity: 3, affixes: [{ id: 'a_shards', value: 5 }, { id: 'a_xp', value: 4 }] },
  r_pyreheart: { base: 'ash-mantle', slot: 'shroud', rarity: 3, affixes: [{ id: 'a_area', value: 5 }, { id: 'a_dmg', value: 3 }] },
  r_dreadcrown: { base: 'u_dreadcrown', slot: 'hood', rarity: 5, affixes: [], unique: 'u_dreadcrown' },
  r_sorrowplate: { base: 'u_sorrowplate', slot: 'shroud', rarity: 5, affixes: [], unique: 'u_sorrowplate' },
  r_gravekey: { base: 'u_gravekey', slot: 'amulet', rarity: 5, affixes: [], unique: 'u_gravekey' },
  r_duskmirror: { base: 'u_duskmirror', slot: 'ring', rarity: 5, affixes: [], unique: 'u_duskmirror' },
};
