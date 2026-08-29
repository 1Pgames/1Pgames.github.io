import type { Rng } from '../core/rng';
import type { SynergyTag, UpgradeDef } from '../data/upgrades';
import type { WeaponPattern } from '../data/weapons';
import type { GateState } from '../systems/extraction';

/**
 * The three §8 route bots for Duskhaul's arena sim — NOT three draft
 * heuristics. In an extraction run the decision that decides the outcome is
 * "when do I leave, and by which gate"; the draft is downstream of it. So a
 * lane here is a whole POLICY: which weapon it rushes, how much of the horde
 * it chooses to fight, how well it kites, which gate it plans to leave by,
 * and what makes it abandon that plan.
 *
 * `src/sim/families/arena.ts` ticks these against the real systems; this file
 * holds only the decisions a player makes, never a balance number. Every
 * constant below describes how a bot PLAYS (its skill expression), which is
 * why none of it belongs in `TUNING`: moving one changes what the measurement
 * models, not what the game does.
 *
 * CALIBRATION IS MEASURED, NOT INVENTED. `engageRatio`/`evasion` were fitted
 * to the greybox playtest's five persona logs
 * (`~/.cache/duskhaul-playtest/<persona>-log.json`, 250ms state samples of the
 * real build), band by band:
 *
 * | band     | killing line (veteran/vetkite) | avoidant line (collapse persona) |
 * | 0-30s    | 0.55-0.73 kills/s             | 0.59 kills/s                     |
 * | 30-120s  | 0.96-1.29                     | 1.08                             |
 * | 120-240s | 2.50-2.51                     | 1.30                             |
 * | 240-360s | 3.22-3.68                     | 0.79                             |
 *
 * That fork is the finding the lanes exist to cover: income is kill-driven, so
 * the avoidant line banks ~1/4 of the killing line's shards in Late AND lets
 * the horde accumulate into the wall that later locks it out of a gate. Two
 * aggressive builds with different weapons would hide it, so `gloam-courier`
 * is the AVOIDANT line by construction (`engageRatio` 0.45, `evasion` 0.88),
 * not merely the one that leaves early.
 */

export type LanePolicy = 'ash-reaper' | 'gloam-courier' | 'widows-lance';

export const LANES: readonly LanePolicy[] = ['ash-reaper', 'gloam-courier', 'widows-lance'];

export type GateId = 'a' | 'b' | 'c';

/**
 * Skill spread every lane is measured at (§18.1 human-anchored calibration):
 * a weak-human FLOOR and a skilled CEILING, not an averaged phantom player.
 * The §19 route gates read the CEILING — they describe a competent player
 * executing the route — while the FLOOR proves the run is neither hopeless
 * nor survivable by accident.
 */
export const FLOOR_SKILL = 0.35;
export const CEILING_SKILL = 0.9;
export const SKILL_LEVELS: readonly number[] = [FLOOR_SKILL, CEILING_SKILL];

/** Per-route play profile. Read by `families/arena.ts`; every field is bot behaviour. */
export interface RouteProfile {
  lane: LanePolicy;
  /** §8 route name, printed in the gate table. */
  name: string;
  /** The weapon the route rushes unlock/boost/evolution cards for (§8). */
  focusWeapon: WeaponPattern;
  /** Draft appetite per §5.3 synergy tag; absent tag = weight 1. */
  appetite: Partial<Record<SynergyTag, number>>;
  /**
   * Fraction of the enemies inside weapon reach this route actually commits
   * to killing. 1.0 = stands and fights everything (Ash Reaper); 0.45 = runs
   * the pocket-farm/kite line and lets most of the horde live (Gloam Courier).
   */
  engageRatio: number;
  /** Damage multiplier against elites and the Warden — the duelist's focus fire. */
  eliteFocus: number;
  /** Contact avoidance at skill 1: probability one contact window is dodged. */
  evasion: number;
  /**
   * Where the route parks relative to its own reach while farming, as a
   * fraction of weapon range. Lower = hugs the horde (more targets, more
   * contact); higher = fights at the edge.
   */
  holdRatio: number;
  /** Gates the route intends to use, in preference order (§8). */
  plan: readonly GateId[];
  /** Commits to a planned gate the moment it opens (the loot-and-leave line). */
  commitOnOpen: boolean;
  /** Waits for the Warden to die before channeling Gate C (the duelist line). */
  wardenFirst: boolean;
  /**
   * Values `extract.collapseHaulBonus`: once Gate C is open this route camps
   * just OUTSIDE the ring and lets the Collapse ignite before it channels,
   * because extracting at or after ignition pays a premium on banked shards.
   *
   * It is an EV decision, not a flag-driven ritual: the route only waits while
   * its own measured hp drain says it will still be standing when the hold
   * finishes, and it steps in the moment that stops being true. An earlier
   * unconditional version of this was measured and rejected — camping through
   * the Warden fight regardless of health cost the deep lane 10-15 points of
   * extraction. Only ONE deep route carries it: §8's duelist extracts right
   * after the Warden kill, and if both deep lanes camped, the variety the
   * spread gate measures would be gone.
   */
  collapseGreed: boolean;
  /** Fraction of max HP the greedy route insists on still holding when the hold ENDS. */
  collapseReserveRatio: number;
  /** HP ratio below which the route abandons the plan for the nearest gate. */
  bailHpRatio: number;
  /**
   * How far the bail gate may be, in seconds of travel, for bailing to be a
   * real option. Without this bound a greed route bails the moment it dips —
   * measured, that turned the deep lane into an early leaver that extracted at
   * Gate A/B in 88% of runs and never once met the Warden, erasing the §8 axis
   * the lane exists to prove. A route 20s from a gate at 15% hp is not bailing,
   * it is dying on the way.
   */
  bailTravelS: number;
  /** Seconds of slack the route wants on top of travel + channel before a close. */
  travelMarginS: number;
  /** A full bag pulls this route toward the nearest open gate (greed satisfied). */
  leavesOnFullBag: boolean;
}

export const ROUTES: Record<LanePolicy, RouteProfile> = {
  // §8 row 1: full-clock greed, kills the Warden, extracts Gate C. Highest
  // haul EV, highest death rate — it only ever plans for C.
  'ash-reaper': {
    lane: 'ash-reaper',
    name: 'Ash Reaper',
    focusWeapon: 'nova',
    appetite: { area: 5, offense: 3, sustain: 2, weapon: 2, mobility: 1, burst: 1, loot: 1 },
    engageRatio: 1.0,
    eliteFocus: 1.0,
    evasion: 0.55,
    holdRatio: 0.55,
    plan: ['c'],
    commitOnOpen: false,
    wardenFirst: false,
    collapseGreed: true,
    collapseReserveRatio: 0.3,
    bailHpRatio: 0.15,
    bailTravelS: 5,
    travelMarginS: 6,
    leavesOnFullBag: false,
  },
  // §8 row 2: the AVOIDANT line. Farms density pockets without clearing them,
  // extracts A/B every run, never sees t4 relics. Its low kill rate is the
  // point (see the header's income fork), not a weaker build.
  'gloam-courier': {
    lane: 'gloam-courier',
    name: 'Gloam Courier',
    focusWeapon: 'bolt',
    appetite: { mobility: 5, loot: 4, sustain: 3, offense: 1, weapon: 1, area: 1, burst: 1 },
    engageRatio: 0.45,
    eliteFocus: 0.5,
    evasion: 0.88,
    holdRatio: 0.95,
    plan: ['a', 'b'],
    commitOnOpen: true,
    wardenFirst: false,
    collapseGreed: false,
    collapseReserveRatio: 0,
    bailHpRatio: 0.5,
    bailTravelS: 30,
    travelMarginS: 12,
    leavesOnFullBag: true,
  },
  // §8 row 3: burst duelist. Thins the horde, deletes elites and the Warden,
  // extracts immediately after the kill — weak against Collapse density, so it
  // does not linger once the Warden is down.
  'widows-lance': {
    lane: 'widows-lance',
    name: "Widow's Lance",
    focusWeapon: 'rail',
    appetite: { burst: 5, offense: 4, weapon: 3, sustain: 1, mobility: 1, area: 1, loot: 1 },
    engageRatio: 0.8,
    eliteFocus: 1.9,
    evasion: 0.7,
    holdRatio: 0.8,
    // Plans for C ONLY: an emergency exit at B is the bail rule's job, not the
    // plan's, or the duelist commits to B at 240s and never fights the Warden.
    plan: ['c'],
    commitOnOpen: false,
    wardenFirst: true,
    collapseGreed: false,
    collapseReserveRatio: 0,
    bailHpRatio: 0.3,
    bailTravelS: 12,
    travelMarginS: 8,
    leavesOnFullBag: false,
  },
};

export function routeProfile(lane: LanePolicy): RouteProfile {
  return ROUTES[lane];
}

/** Everything the gate decision reads. One snapshot per tick, no history. */
export interface GateContext {
  elapsedS: number;
  hpRatio: number;
  bagFull: boolean;
  collapseActive: boolean;
  wardenAlive: boolean;
  wardenKilled: boolean;
  /** Live state of each gate, from the real `ExtractionSystem`. */
  state: Record<GateId, GateState>;
  /** Seconds until each gate opens (<= 0 once open). */
  opensInS: Record<GateId, number>;
  /** Seconds until each gate closes; `null` for a gate that never closes. */
  closesInS: Record<GateId, number | null>;
  /** Seconds of travel to each gate at the player's CURRENT move speed. */
  travelS: Record<GateId, number>;
  /** Seconds the channel still needs, from `TUNING.extract.channelMs` + stats. */
  channelS: number;
  /** Seconds until the Collapse ignites; <= 0 once it has. */
  secondsToCollapseS: number;
  /** Recent net hp loss as a FRACTION of max hp per second — the survival estimate's input. */
  hpDrainRatioPerS: number;
}

export interface GateIntent {
  /** Gate the bot is moving to, or null to keep farming. */
  gate: GateId | null;
  /** Why — printed in the per-run trace and used by the "no timer end" gate. */
  reason: string;
}

const GATE_IDS: readonly GateId[] = ['a', 'b', 'c'];

/** A gate is worth walking to if it is open now, or opens before the bot arrives. */
function reachable(ctx: GateContext, gate: GateId, marginS: number): boolean {
  const state = ctx.state[gate];
  if (state === 'spent') return false;
  const arrivalS = ctx.travelS[gate];
  const closesInS = ctx.closesInS[gate];
  // Must still be open when the channel FINISHES, not merely on arrival.
  if (closesInS !== null && closesInS < arrivalS + ctx.channelS + marginS) return false;
  // Standing in a closed ring does nothing, so only walk early if it opens by
  // roughly the time the walk ends.
  return ctx.opensInS[gate] <= arrivalS + marginS;
}

function nearestUsable(ctx: GateContext, marginS: number, maxTravelS = Number.POSITIVE_INFINITY): GateId | null {
  let best: GateId | null = null;
  for (const gate of GATE_IDS) {
    if (ctx.travelS[gate] > maxTravelS) continue;
    if (!reachable(ctx, gate, marginS)) continue;
    if (best === null || ctx.travelS[gate] < ctx.travelS[best]) best = gate;
  }
  return best;
}

/**
 * The route's gate decision — the choice this whole family is about.
 *
 * Priority is deliberate and shared by all three routes: dying beats every
 * plan, the Collapse leaves exactly one exit, and only then does the route's
 * own greed profile speak. A route that has no reachable gate keeps farming,
 * which is how a lane ends by DEATH rather than by a timer: nothing in here
 * can ever return "run over".
 */
export function gateDecision(profile: RouteProfile, ctx: GateContext): GateIntent {
  if (ctx.hpRatio <= profile.bailHpRatio) {
    const bail = nearestUsable(ctx, 0, profile.bailTravelS);
    if (bail !== null) return { gate: bail, reason: `bail-hp-${bail}` };
  }

  if (ctx.collapseActive) {
    // Gate C is the Collapse's only exit (§2A) — margin 0: there is no later
    // option to save slack for.
    if (reachable(ctx, 'c', 0)) return { gate: 'c', reason: 'collapse-gate-c' };
    return { gate: 'c', reason: 'collapse-gate-c-forced' };
  }

  if (profile.leavesOnFullBag && ctx.bagFull) {
    const full = nearestUsable(ctx, profile.travelMarginS);
    if (full !== null) return { gate: full, reason: `bag-full-${full}` };
  }

  for (const gate of profile.plan) {
    if (!reachable(ctx, gate, profile.travelMarginS)) continue;

    if (profile.collapseGreed && gate === 'c' && !ctx.collapseActive) {
      // Hold for the premium only while the arithmetic says the run survives the
      // wait plus the hold. Standing IN the ring would auto-channel and forfeit
      // the bonus (§2A starts the channel on entry), so the caller camps outside.
      const exposureS = Math.max(0, ctx.secondsToCollapseS) + ctx.channelS;
      const projectedLoss = ctx.hpDrainRatioPerS * exposureS;
      if (ctx.hpRatio - projectedLoss >= profile.collapseReserveRatio) {
        return { gate: null, reason: 'hold-for-premium' };
      }
      // Estimate turned: take the gate now rather than die 40 seconds richer.
      return { gate, reason: 'premium-abandoned-c' };
    }

    if (profile.wardenFirst && gate === 'c' && ctx.wardenAlive && !ctx.wardenKilled) {
      // The duelist wants the Warden dead first: keep fighting, but do it AT
      // the gate rather than out in the field.
      return { gate: null, reason: 'warden-first' };
    }

    if (profile.commitOnOpen) return { gate, reason: `plan-${gate}` };

    // A deep route only commits when the gate it is holding for is the one in
    // front of it, or when this is the last window that will ever be open.
    const closesInS = ctx.closesInS[gate];
    const lastChance =
      closesInS !== null && closesInS <= ctx.travelS[gate] + ctx.channelS + profile.travelMarginS * 2;
    const isFinalPlan = gate === profile.plan[profile.plan.length - 1];
    if (gate === 'c' || lastChance || isFinalPlan) return { gate, reason: `plan-${gate}` };
  }

  return { gate: null, reason: 'farm' };
}

/**
 * Draft pick. `rollUpgradeChoices` already decides WHICH cards are on the
 * table (§8 no-dead-draft rules); a route only chooses among them, so it can
 * be forced off-plan exactly like a human whose hand offers nothing on-lane.
 */
export function pickUpgrade(
  lane: LanePolicy,
  choices: readonly UpgradeDef[],
  rng: Rng,
  hpRatio = 1,
): UpgradeDef {
  const profile = ROUTES[lane];
  const weights = choices.map((card) => cardWeight(profile, card, hpRatio));
  return rng.pickWeighted(choices, weights);
}

function cardWeight(profile: RouteProfile, card: UpgradeDef, hpRatio: number): number {
  let weight = profile.appetite[card.synergy] ?? 1;

  // Adaptive drafting: anyone bleeding out takes sustain regardless of plan.
  if (card.synergy === 'sustain' && hpRatio < 0.6) weight *= 3;

  // A route's own weapon line is what makes it that route (§8).
  if (card.weapon === profile.focusWeapon) {
    if (card.kind === 'weapon-unlock') weight += 40;
    else if (card.kind === 'weapon-evolution') weight += 30;
    else weight += 15;
  } else if (card.kind === 'weapon-unlock') {
    // A second damage source is still nearly always worth a slot.
    weight += 3;
  }
  return Math.max(0.05, weight);
}
