/**
 * Additive/multiplicative stat system for build-crafting games (roguelike,
 * survivor-like, tower defense, tactics). One `StatBlock` per entity (player,
 * enemy, tower) holds base numbers; equipment, meta upgrades, buffs and debuffs
 * each push a `Modifier` tagged with a `source` so they can be revoked in bulk
 * (item unequipped, buff expired) without recomputing anything by hand.
 *
 * Do NOT use this for one-off constants that never change at runtime (e.g. a
 * fixed screen width) — plain `TUNING` values are cheaper and clearer there.
 *
 * Pure TypeScript, no Phaser import. `get()` is called hundreds of times per
 * frame (damage calc, movement, AI queries) so results are cached per stat and
 * only recomputed when a modifier is added or removed.
 */

export type StatKey = string;

export interface Modifier {
  stat: StatKey;
  add?: number;
  mul?: number;
  source: string;
}

/**
 * Stats allowed to resolve negative (e.g. `armorPenetration`, screen-shake
 * offsets pulled through the stat system). Every other stat is clamped to a
 * minimum of 0 — health, damage, speed etc. can never go negative from a
 * modifier stack gone wrong.
 */
export const SIGNED_STATS: ReadonlySet<StatKey> = new Set();

/** value = (base + Σadd) * Π(1 + mul), clamped to >= 0 unless in SIGNED_STATS. */
export function applyModifiers(base: number, mods: readonly Modifier[], stat: StatKey): number {
  let addSum = 0;
  let mulProduct = 1;
  for (const mod of mods) {
    if (mod.stat !== stat) continue;
    if (mod.add !== undefined) addSum += mod.add;
    if (mod.mul !== undefined) mulProduct *= 1 + mod.mul;
  }
  const value = (base + addSum) * mulProduct;
  return SIGNED_STATS.has(stat) ? value : Math.max(0, value);
}

export class StatBlock {
  private readonly base: Readonly<Record<StatKey, number>>;
  private readonly modifiers: Modifier[] = [];
  private readonly cache = new Map<StatKey, number>();

  constructor(base: Readonly<Record<StatKey, number>>) {
    this.base = base;
  }

  /** Cached — safe to call every frame. Invalidated only by modifier changes. */
  get(stat: StatKey): number {
    const cached = this.cache.get(stat);
    if (cached !== undefined) return cached;
    const computed = applyModifiers(this.base[stat] ?? 0, this.modifiers, stat);
    this.cache.set(stat, computed);
    return computed;
  }

  addModifier(mod: Modifier): void {
    this.modifiers.push(mod);
    this.cache.delete(mod.stat);
  }

  /** Removes every modifier tagged with `source` (item unequipped, buff expired). */
  removeBySource(source: string): void {
    let i = this.modifiers.length;
    while (i > 0) {
      i -= 1;
      const mod = this.modifiers[i];
      if (mod !== undefined && mod.source === source) {
        this.modifiers.splice(i, 1);
        this.cache.delete(mod.stat);
      }
    }
  }

  /** Resolved value for every base stat, e.g. for save files or debug overlays. */
  snapshot(): Record<StatKey, number> {
    const out: Record<StatKey, number> = {};
    for (const stat of Object.keys(this.base)) out[stat] = this.get(stat);
    return out;
  }
}
