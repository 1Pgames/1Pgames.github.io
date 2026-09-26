/**
 * Player-language copy for stats, item lines and deltas — shared by ARMORY,
 * VAULT, the Loadout sheet and Results so one stat never reads two ways.
 */
import { CHARMS } from '../../data/charms';
import { gearMods } from '../../data/gear';
import { ACCOUNT_LADDER, unlockLabel } from '../../data/sanctum';
import { WEAPONS } from '../../data/weapons';
import { affixDef, affixLabel, hasAffix } from '../../data/affixes';
import type { GearInstance, GearSlot, PlayerStatKey, StatMod } from '../../data/types-v2';

export const SLOT_LABEL: Record<GearSlot, string> = {
  hood: 'HOOD',
  shroud: 'SHROUD',
  grips: 'GRIPS',
  boots: 'BOOTS',
  ring: 'RING',
  amulet: 'AMULET',
};

const STAT_LABEL: Record<PlayerStatKey, string> = {
  maxHp: 'Health',
  moveSpeed: 'Speed',
  damageMul: 'Damage',
  cooldownMul: 'Cooldown',
  area: 'Area',
  critChance: 'Crit Chance',
  critMul: 'Crit Damage',
  pickupRadius: 'Pickup Range',
  shardsMul: 'Shards',
  channelMs: 'Extract Time',
  bagCells: 'Bag',
  projectileBonus: 'Projectiles',
  durationMul: 'Duration',
  regenPerS: 'Regen',
  contactDamageMul: 'Contact Damage',
  xpMul: 'XP',
  luck: 'Luck',
};

/**
 * Stats whose ADD is a fraction shown as a percentage (`damageMul` add 0.06 =
 * `+6%`); every other stat's add is in its own unit (hp, px, cells, ms).
 * `critMul` is NOT here: the §5.15 tables author it as a flat multiplier step
 * (`Crit Damage +0.3`), so it reads `+0.15` on every surface.
 */
const FRACTION_STATS: ReadonlySet<PlayerStatKey> = new Set<PlayerStatKey>([
  'damageMul',
  'cooldownMul',
  'area',
  'critChance',
  'shardsMul',
  'durationMul',
  'contactDamageMul',
  'xpMul',
]);

/** Decimal places for a flat add. */
const DIGITS: Partial<Record<PlayerStatKey, number>> = { regenPerS: 1, critMul: 2 };

const UNIT: Partial<Record<PlayerStatKey, string>> = { channelMs: ' ms', regenPerS: '/s', pickupRadius: '', bagCells: '' };

function signed(v: number, digits = 0): string {
  const r = Number(v.toFixed(digits));
  return `${r >= 0 ? '+' : '−'}${Math.abs(r)}`;
}

/** One stat contribution as copy: `Damage +6%`, `Health +10`, `Speed +4%`. */
export function modText(stat: PlayerStatKey, add: number, mul: number): string {
  const parts: string[] = [];
  if (add !== 0) {
    parts.push(FRACTION_STATS.has(stat) ? `${signed(add * 100)}%` : `${signed(add, DIGITS[stat] ?? 0)}${UNIT[stat] ?? ''}`);
  }
  if (mul !== 0) parts.push(`${signed(mul * 100)}%`);
  return `${STAT_LABEL[stat]} ${parts.join(' ') || '+0'}`;
}

/** Just the value part of `modText` (for compare lines). */
function modValue(stat: PlayerStatKey, add: number, mul: number): string {
  return modText(stat, add, mul).slice(STAT_LABEL[stat].length + 1);
}

/**
 * An item's stat lines, ONE per stat (implicit and affixes on the same stat are
 * summed, QA 12), in the same units as the compare line and the stat panel;
 * then its behavioural affixes by label.
 */
export function itemLines(item: GearInstance): string[] {
  const lines: string[] = [];
  for (const [stat, v] of sumMods(gearMods(item))) lines.push(modText(stat, v.add, v.mul));
  for (const a of item.affixes) if (hasAffix(a.id) && affixDef(a.id).stat === null) lines.push(affixLabel(a));
  return lines;
}

/** Sums a mod list per stat. */
function sumMods(mods: readonly StatMod[]): Map<PlayerStatKey, { add: number; mul: number }> {
  const out = new Map<PlayerStatKey, { add: number; mul: number }>();
  for (const m of mods) {
    const cur = out.get(m.stat) ?? { add: 0, mul: 0 };
    cur.add += m.add ?? 0;
    cur.mul += m.mul ?? 0;
    out.set(m.stat, cur);
  }
  return out;
}

/**
 * FlowAudit §2.6 compare line: `vs current: Damage +3% → +7%` for EVERY stat
 * that differs, in stat-list order (units differ per stat, so no stat is
 * ranked out of the line — the dropped `Cooldown −2%`, QA 12).
 */
export function compareLine(candidate: readonly StatMod[], current: readonly StatMod[]): string {
  const a = sumMods(candidate);
  const b = sumMods(current);
  const order = Object.keys(STAT_LABEL) as PlayerStatKey[];
  const diffs: string[] = [];
  for (const stat of order) {
    if (!a.has(stat) && !b.has(stat)) continue;
    const na = a.get(stat) ?? { add: 0, mul: 0 };
    const nb = b.get(stat) ?? { add: 0, mul: 0 };
    if (Math.abs(na.add - nb.add) + Math.abs(na.mul - nb.mul) < 1e-9) continue;
    // A stat only one side has reads `—` on the other, not a fake `+0`.
    const from = b.has(stat) ? modValue(stat, nb.add, nb.mul) : '—';
    const to = a.has(stat) ? modValue(stat, na.add, na.mul) : '—';
    diffs.push(`${STAT_LABEL[stat]} ${from} → ${to}`);
  }
  return diffs.length === 0 ? 'vs current: no change' : `vs current: ${diffs.join(' · ')}`;
}

/** Stat total line for the Loadout/Armory panels. */
export function statLine(stat: PlayerStatKey, base: number, total: number): string {
  switch (stat) {
    case 'maxHp':
      return `Health ${Math.round(total)}`;
    case 'bagCells':
      return `Bag ${Math.round(total)} cells`;
    case 'pickupRadius':
      return `Pickup Range ${Math.round(total)}`;
    case 'regenPerS':
      return `Regen ${total.toFixed(1)}/s`;
    case 'critChance':
      return `Crit Chance ${Math.round(total * 100)}%`;
    default:
      if (FRACTION_STATS.has(stat) || stat === 'moveSpeed') {
        const f = base !== 0 ? total / base - 1 : total;
        return `${STAT_LABEL[stat]} ${signed(f * 100)}%`;
      }
      return `${STAT_LABEL[stat]} ${Math.round(total * 10) / 10}`;
  }
}

/**
 * Account level that opens a ladder key (`weapon:<id>`, `charm:<id>`, …): the
 * first `ACCOUNT_LADDER` rung listing it. A charm with no rung of its own opens
 * with its partner weapon (§5.8b pairs); anything unlisted is open from L1.
 */
export function unlockLevelOf(key: string): number {
  const row = ACCOUNT_LADDER.find((r) => r.unlocks.includes(key));
  if (row !== undefined) return row.level;
  if (key.startsWith('charm:')) {
    const partner = CHARMS.find((c) => c.id === key.slice(6))?.evolves;
    if (partner) return unlockLevelOf(`weapon:${partner}`);
  }
  return 1;
}

/** One unlock as displayed: copy + the icon ids drawn before it (weapon/charm art). */
export interface UnlockEntry {
  text: string;
  icons: string[];
}

/**
 * Ladder keys → display entries. A weapon and its partner charm unlocked
 * together collapse into one `<weapon> + <charm>` entry with both icons
 * (§5.8b pair rungs); other weapon/charm keys get their single icon; every
 * other key renders via `unlockLabel`.
 */
export function groupUnlocks(keys: readonly string[]): UnlockEntry[] {
  const out: UnlockEntry[] = [];
  const used = new Set<string>();
  for (const key of keys) {
    if (!key.startsWith('weapon:')) continue;
    const id = key.slice(7);
    const w = WEAPONS.find((d) => d.id === id);
    const partner = CHARMS.find((c) => c.evolves === id);
    used.add(key);
    if (partner !== undefined && keys.includes(`charm:${partner.id}`)) {
      used.add(`charm:${partner.id}`);
      out.push({ text: `${w?.name ?? id} + ${partner.name}`, icons: [`icon-wpn-${id}`, `icon-charm-${partner.id}`] });
    } else {
      out.push({ text: w?.name ?? unlockLabel(key), icons: [`icon-wpn-${id}`] });
    }
  }
  for (const key of keys) {
    if (used.has(key)) continue;
    if (key.startsWith('charm:')) {
      const c = CHARMS.find((d) => d.id === key.slice(6));
      out.push({ text: c?.name ?? unlockLabel(key), icons: [`icon-charm-${key.slice(6)}`] });
    } else {
      out.push({ text: unlockLabel(key), icons: [] });
    }
  }
  return out;
}
