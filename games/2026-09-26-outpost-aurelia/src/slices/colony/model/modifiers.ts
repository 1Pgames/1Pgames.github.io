/**
 * Directive / protocol / Ark effects → effective stats (PRD §4 Modifiers).
 * An effect `{mul: m}` scales the base by (1 + Σm); `{add: a}` adds Σa after.
 */
import { ARK_NODES, COLONY_STATS, type ColonyStat, type Effect } from '../content';
import { COLONY_TUNING } from '../tuning';

export interface StatTotals {
  readonly mul: Record<ColonyStat, number>;
  readonly add: Record<ColonyStat, number>;
}

export function createStatTotals(): StatTotals {
  const mul = {} as Record<ColonyStat, number>;
  const add = {} as Record<ColonyStat, number>;
  for (const stat of COLONY_STATS) {
    mul[stat] = 0;
    add[stat] = 0;
  }
  return { mul, add };
}

export function applyEffects(totals: StatTotals, effects: readonly Effect[]): void {
  for (const e of effects) {
    totals.mul[e.stat] += e.mul ?? 0;
    totals.add[e.stat] += e.add ?? 0;
  }
}

/** Effective value of `stat` for a colony whose totals are `totals`. */
export function colonyStat(state: { readonly stats: StatTotals }, stat: ColonyStat, base: number): number {
  return base * (1 + state.stats.mul[stat]) + state.stats.add[stat];
}

/**
 * Effects of the owned Ark nodes plus Refit (PRD §9: +2 % Data and +1 %
 * production per level). Applied once at `createColony` (W1 wires the call).
 */
export function arkModifiers(ark: readonly string[], refit: number): Effect[] {
  const out: Effect[] = [];
  for (const node of ARK_NODES) if (ark.includes(node.id)) out.push(...node.effects);
  if (refit > 0) {
    out.push({ stat: 'data.mul', mul: COLONY_TUNING.meta.refitDataPerLevel * refit });
    out.push({ stat: 'process.rate', mul: COLONY_TUNING.meta.refitProdPerLevel * refit });
  }
  return out;
}
