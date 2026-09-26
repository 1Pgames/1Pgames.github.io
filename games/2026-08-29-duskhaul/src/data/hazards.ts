/**
 * Hazard levels H1-H5 (PRD-V2 §5.21). Extras are cumulative: each rung keeps
 * every extra of the rungs below it. 4 zones × 5 = 20 rungs.
 */
import type { EliteAffixId, HazardLevel } from './types-v2';

export interface HazardDef {
  level: HazardLevel;
  threatMul: number;
  /** Rarity/tier shift points. */
  lootBias: number;
  itemLevel: number;
  /** H2+: elites +N per scripted beat (read by the wave director from `hazardDef(loadout.hazard)`). */
  extraElitesPerBeat: number;
  extraEliteAffix: boolean;
  /** H5: one of these is forced onto every elite (`runLoadout` picks it with the run seed). */
  forcedAffixes: readonly EliteAffixId[];
  /** Collapse ignition second (480 unless H4+). */
  collapseAtS: number;
  /** Zone-boss phase 2 / 3 HP ratios (read by `objects/enemy.ts` through `EnemyHost.bossPhaseAt`). */
  bossPhaseAt: [number, number];
  unlockLevel: number;
  /** Dread Sigils spent once (account-wide) to open this rung. */
  sigilCost: number;
  /** Copy for the hazard selector / zone sheet. */
  extra: string;
}

export const HAZARDS: readonly HazardDef[] = [
  { level: 1, threatMul: 1.0, lootBias: 0, itemLevel: 1, extraElitesPerBeat: 0, extraEliteAffix: false, forcedAffixes: [], collapseAtS: 480, bossPhaseAt: [0.66, 0.33], unlockLevel: 1, sigilCost: 0, extra: '—' },
  { level: 2, threatMul: 1.25, lootBias: 0.5, itemLevel: 3, extraElitesPerBeat: 1, extraEliteAffix: false, forcedAffixes: [], collapseAtS: 480, bossPhaseAt: [0.66, 0.33], unlockLevel: 5, sigilCost: 0, extra: 'Elites +1 per scripted beat' },
  { level: 3, threatMul: 1.55, lootBias: 1, itemLevel: 5, extraElitesPerBeat: 1, extraEliteAffix: true, forcedAffixes: [], collapseAtS: 480, bossPhaseAt: [0.66, 0.33], unlockLevel: 17, sigilCost: 0, extra: 'Every elite has 1 extra affix' },
  { level: 4, threatMul: 1.9, lootBias: 1.5, itemLevel: 7, extraElitesPerBeat: 1, extraEliteAffix: true, forcedAffixes: [], collapseAtS: 450, bossPhaseAt: [0.66, 0.33], unlockLevel: 18, sigilCost: 0, extra: 'Collapse at 450 s' },
  { level: 5, threatMul: 2.4, lootBias: 2, itemLevel: 9, extraElitesPerBeat: 1, extraEliteAffix: true, forcedAffixes: ['warded', 'vampiric'], collapseAtS: 450, bossPhaseAt: [0.75, 0.4], unlockLevel: 27, sigilCost: 3, extra: 'Warded or Vampiric on every elite; boss phases at 75/40%' },
];

/** §16.1 E35. */
export function hazardDef(h: HazardLevel): HazardDef {
  const def = HAZARDS[h - 1];
  if (!def) throw new Error(`hazardDef: unknown hazard ${h}`);
  return def;
}
