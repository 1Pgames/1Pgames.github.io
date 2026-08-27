import type { Rng } from '../core/rng';
import type { UpgradeDef } from '../data/upgrades';
import type { WeaponPattern } from '../data/weapons';

/**
 * Lane policies for the headless balance bot: each one is a different
 * heuristic for which of the 3 offered upgrade cards to take on level-up.
 * `rollUpgradeChoices` already decides WHICH cards are offered (rarity
 * weighting, weapon-slot gating, no-repeat-past-`maxStacks`); a lane only
 * decides among the options actually on the table, so it can end up taking
 * an off-lane card when nothing on-lane is offered — the same situation a
 * human player is in.
 *
 * The three `*-build` lanes exist to prove weapon-build variety: each one
 * rushes its weapon's unlock card, then its boost cards, then generic
 * offense. If one of them dominates the winrate spread, that weapon's
 * numbers are the problem (see the dominance gate in `cli.ts`).
 */
export type LanePolicy =
  | 'damage'
  | 'defense'
  | 'speed'
  | 'balanced'
  | 'random'
  | 'orbit-build'
  | 'nova-build'
  | 'rail-build';

export const LANES: readonly LanePolicy[] = [
  'damage',
  'defense',
  'speed',
  'balanced',
  'random',
  'orbit-build',
  'nova-build',
  'rail-build',
];

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
  'orbit-build': { offense: 2, survive: 1, utility: 1 },
  'nova-build': { offense: 2, survive: 1, utility: 1 },
  'rail-build': { offense: 2, survive: 1, utility: 1 },
};

const LANE_WEAPON: Partial<Record<LanePolicy, WeaponPattern>> = {
  'orbit-build': 'orbit',
  'nova-build': 'nova',
  'rail-build': 'rail',
};

/**
 * A new weapon is nearly always worth a card slot (it is a whole extra
 * damage source), so every non-random lane values unlock/boost cards above
 * a plain stat tweak; weapon lanes rush their own weapon's cards outright.
 */
function cardWeight(lane: LanePolicy, card: UpgradeDef, hpRatio: number): number {
  const weights = LANE_WEIGHT[lane];
  let weight = 1;
  for (const mod of card.modifiers) {
    const category = STAT_CATEGORY[mod.stat] ?? 'utility';
    let w = weights[category];
    // Adaptive drafting: any human bleeding out prioritizes sustain on the
    // next draft regardless of their build plan. Below 60% hp survive cards
    // triple in appeal; this is play modelling, not balance.
    if (category === 'survive' && hpRatio < 0.6) w *= 3;
    weight += w;
  }
  if (card.kind === 'weapon-unlock') weight += 3;
  if (card.kind === 'weapon-boost') weight += 2;
  const focus = LANE_WEAPON[lane];
  if (focus !== undefined && card.weapon === focus) {
    weight += card.kind === 'weapon-unlock' ? 40 : 15;
  }
  return weight;
}

/** Picks one of the offered choices per the lane's heuristic. Never returns undefined given a non-empty array. */
export function pickUpgrade(
  lane: LanePolicy,
  choices: readonly UpgradeDef[],
  rng: Rng,
  hpRatio = 1,
): UpgradeDef {
  if (lane === 'random') return rng.pick(choices);
  const weights = choices.map((card) => cardWeight(lane, card, hpRatio));
  return rng.pickWeighted(choices, weights);
}
