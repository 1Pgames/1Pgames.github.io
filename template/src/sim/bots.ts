import type { Rng } from '../core/rng';
import type { UpgradeDef } from '../data/upgrades';

/**
 * Lane policies for the headless balance bot: each one is a different
 * heuristic for which of the 3 offered upgrade cards to take on level-up.
 * `rollUpgradeChoices` already decides WHICH cards are offered (rarity
 * weighting, no-repeat-past-`maxStacks`); a lane only decides among the
 * options actually on the table, so it can end up taking an off-lane card
 * when nothing on-lane is offered — the same situation a human player is in.
 */
export type LanePolicy = 'damage' | 'defense' | 'speed' | 'balanced' | 'random';

export const LANES: readonly LanePolicy[] = ['damage', 'defense', 'speed', 'balanced', 'random'];

type StatCategory = 'offense' | 'survive' | 'utility';

/** Every stat key an upgrade card can touch (see `PLAYER_BASE_STATS`), bucketed by intent. */
const STAT_CATEGORY: Record<string, StatCategory> = {
  damage: 'offense',
  attackSpeed: 'offense',
  projectiles: 'offense',
  critChance: 'offense',
  critMul: 'offense',
  areaMul: 'offense',
  maxHp: 'survive',
  regenPerSecond: 'survive',
  moveSpeed: 'utility',
  pickupRadius: 'utility',
  xpGain: 'utility',
};

/** Category weight per lane — how eagerly it seeks each bucket among the offered cards. */
const LANE_WEIGHT: Record<LanePolicy, Record<StatCategory, number>> = {
  damage: { offense: 5, survive: 1, utility: 1 },
  defense: { offense: 1, survive: 5, utility: 1 },
  speed: { offense: 1, survive: 1, utility: 5 },
  balanced: { offense: 2, survive: 2, utility: 2 },
  random: { offense: 1, survive: 1, utility: 1 },
};

function cardWeight(lane: LanePolicy, card: UpgradeDef): number {
  const weights = LANE_WEIGHT[lane];
  let weight = 1;
  for (const mod of card.modifiers) {
    const category = STAT_CATEGORY[mod.stat] ?? 'utility';
    weight += weights[category];
  }
  return weight;
}

/** Picks one of the offered choices per the lane's heuristic. Never returns undefined given a non-empty array. */
export function pickUpgrade(lane: LanePolicy, choices: readonly UpgradeDef[], rng: Rng): UpgradeDef {
  if (lane === 'random') return rng.pick(choices);
  const weights = choices.map((card) => cardWeight(lane, card));
  return rng.pickWeighted(choices, weights);
}
