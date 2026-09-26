import type { Rng } from '../core/rng';
import type { UpgradeDef } from '../data/upgrades';
import type { CharmId, ClassId, GateId, GateKind, PoiKind, WeaponId } from '../data/types-v2';

/**
 * The four PRD-V2 §8 route bots for Duskhaul's arena sim (Delver, Courier,
 * Duelist, Pyre). In an extraction run the decision that decides the outcome
 * is "when do I leave, and by which gate", and on the V2 map also "which POIs
 * do I spend the clock on"; the draft is downstream of both. So a lane is a
 * whole POLICY: class + weapon line it rushes, POIs it detours for, how much of
 * the horde it fights, how well it kites, which gate it plans to leave by, and
 * what makes it abandon that plan.
 *
 * `src/sim/families/arena.ts` ticks these against the real systems; this file
 * holds only the decisions a player makes, never a balance number. Every
 * constant describes how a bot PLAYS (its skill expression), which is why none
 * of it belongs in `TUNING`.
 *
 * Calibration heritage: `engageRatio`/`evasion` were fitted in V1 to the
 * greybox playtest's persona logs (killing line 0.55-3.7 kills/s by band,
 * avoidant line collapsing to ~0.8/s in Late). Courier keeps the AVOIDANT line
 * by construction; Delver keeps the stand-and-clear line.
 */

export type LanePolicy = 'delver' | 'courier' | 'duelist' | 'pyre';

export const LANES: readonly LanePolicy[] = ['delver', 'courier', 'duelist', 'pyre'];

/**
 * Skill spread every lane is measured at (§18.1 human-anchored calibration):
 * a weak-human FLOOR and a skilled CEILING. The §19 route gates read the
 * CEILING; the FLOOR proves the run is neither hopeless nor a formality.
 */
export const FLOOR_SKILL = 0.35;
export const CEILING_SKILL = 0.9;
/** Skill sweep; ORDER IS LOAD-BEARING (child seeds are drawn sequentially). */
export const SKILL_LEVELS: readonly number[] = [CEILING_SKILL, FLOOR_SKILL];

/** Per-route play profile. Read by `families/arena.ts`; every field is bot behaviour. */
export interface RouteProfile {
  lane: LanePolicy;
  /** §8 route name, printed in the gate table. */
  name: string;
  /** §5.3 class the route plays (start weapon + stat deltas come from `data/classes.ts`). */
  classId: ClassId;
  /** Weapons the route rushes unlock/boost/evolution cards for, in priority order. */
  focusWeapons: readonly WeaponId[];
  /** Charms the route wants (evolution partners first). */
  focusCharms: readonly CharmId[];
  /** Draft appetite per §5.10 synergy tag; absent tag = weight 1. */
  appetite: Partial<Record<UpgradeDef['synergy'], number>>;
  /** Fraction of enemies inside weapon reach the route commits to killing. */
  engageRatio: number;
  /** Damage multiplier against elites/bosses — focus fire. */
  eliteFocus: number;
  /** Contact avoidance at skill 1: probability one contact window is dodged. */
  evasion: number;
  /** Where the route parks relative to its reach while farming (fraction of reach). */
  holdRatio: number;
  /** POI kinds the route detours for, with the deepest region depth it will enter for them. */
  poiAppetite: Partial<Record<PoiKind, number>>;
  /** Max seconds of travel the route spends on one POI detour. */
  poiDetourS: number;
  /**
   * Depth-2 POIs stay off the route's list until BOTH gates of the build are
   * met: the run second and the level. Measured: a Delver that chased depth-2
   * chests and the Vault from 120 s died there in 90% of runs (median end
   * ~180 s, before the Den even opened) — a human deep-runner scales first.
   */
  deepPoiFromS: number;
  deepPoiFromLevel: number;
  /** Takes the scripted events (§5.12.6) when one starts within this travel budget (s); 0 = never. */
  eventDetourS: number;
  /** Gates the route intends to use, in preference order (§8). */
  plan: readonly GateId[];
  /** Conditional kinds the route will use as its 'x' gate. */
  conditionalKinds: readonly GateKind[];
  /** Commits to a planned gate the moment it opens (the loot-and-leave line). */
  commitOnOpen: boolean;
  /** Waits for the zone boss to die before channeling Gate C. */
  bossFirst: boolean;
  /**
   * Holds outside Gate C for the NEXT Greed step (§5.26, ×0.1 per 60 s up to
   * ×1.5 at 480 s) while its own measured hp drain says it survives the wait.
   */
  greedHold: boolean;
  /** Fraction of max HP the greedy hold insists on still holding when it ends. */
  greedReserveRatio: number;
  /** HP ratio below which the route abandons the plan for the nearest gate. */
  bailHpRatio: number;
  /** Max seconds of travel a bail gate may be for bailing to be real. */
  bailTravelS: number;
  /** Seconds of slack wanted on top of travel + channel before a close. */
  travelMarginS: number;
  /** A full bag pulls this route toward the nearest usable gate. */
  leavesOnFullBag: boolean;
}

const ROUTES: Record<LanePolicy, RouteProfile> = {
  // §8 Delver: Gravewarden, Bone Halo → Marrow Wheel (Ossuary Bell), BODY.
  // Depth-2 chests, Vault, boss, Gate C / Offering. Best haul, ~50% death.
  delver: {
    lane: 'delver',
    name: 'Delver',
    classId: 'gravewarden',
    focusWeapons: ['orbit', 'nova', 'scythe'],
    focusCharms: ['c_bell', 'c_heart', 'c_drum', 'c_salve'],
    appetite: { area: 4, sustain: 4, offense: 3, weapon: 2, mobility: 1, burst: 1, loot: 2 },
    engageRatio: 1.0,
    eliteFocus: 1.0,
    evasion: 0.55,
    holdRatio: 0.5,
    poiAppetite: { chest_t1: 1, chest_t2: 2, chest_t3: 2, vault: 2, den: 2, shrine_grave: 2, shrine_blood: 1 },
    poiDetourS: 9,
    deepPoiFromS: 240,
    deepPoiFromLevel: 16,
    eventDetourS: 0,
    plan: ['c', 'x'],
    conditionalKinds: ['offering'],
    commitOnOpen: false,
    bossFirst: false,
    greedHold: true,
    greedReserveRatio: 0.2,
    bailHpRatio: 0.15,
    bailTravelS: 5,
    travelMarginS: 6,
    leavesOnFullBag: false,
  },
  // §8 Courier: Duskhauler, Rustspike + Grave Sickle, Gloam Spur/Step.
  // Veins, breakables, depth 0-1 chests; Gate A or Toll. ~90% extract.
  courier: {
    lane: 'courier',
    name: 'Courier',
    classId: 'duskhauler',
    focusWeapons: ['bolt', 'sickle', 'orbit'],
    focusCharms: ['c_spur', 'c_step', 'c_tongue', 'c_oath'],
    appetite: { mobility: 5, loot: 4, sustain: 3, offense: 1, weapon: 1, area: 1, burst: 1 },
    engageRatio: 0.45,
    eliteFocus: 0.5,
    evasion: 0.88,
    holdRatio: 0.95,
    poiAppetite: { vein: 1, chest_t1: 1, chest_t2: 1, shrine_gilt: 0, shrine_grave: 1, lore: 0 },
    poiDetourS: 7,
    deepPoiFromS: 240,
    deepPoiFromLevel: 16,
    eventDetourS: 0,
    plan: ['a', 'x', 'b'],
    conditionalKinds: ['toll'],
    commitOnOpen: true,
    bossFirst: false,
    greedHold: false,
    greedReserveRatio: 0,
    bailHpRatio: 0.5,
    bailTravelS: 30,
    travelMarginS: 12,
    leavesOnFullBag: true,
  },
  // §8 Duelist: Widowblade, Widow's Lance → Sorrow Piercer (Widow's Eye).
  // Lairs + Den for Elite Chests & Dread Keys, Gate B. Weak to Collapse swarm.
  duelist: {
    lane: 'duelist',
    name: 'Duelist',
    classId: 'widowblade',
    focusWeapons: ['rail', 'bolt', 'hex'],
    focusCharms: ['c_eye', 'c_oath', 'c_tongue', 'c_heart'],
    appetite: { burst: 5, offense: 4, weapon: 3, sustain: 2, mobility: 1, area: 1, loot: 1 },
    engageRatio: 0.8,
    eliteFocus: 1.9,
    evasion: 0.7,
    holdRatio: 0.8,
    poiAppetite: { lair: 2, den: 2, chest_t2: 1, chest_t1: 1, shrine_curse: 1, shrine_grave: 1 },
    poiDetourS: 10,
    deepPoiFromS: 240,
    deepPoiFromLevel: 16,
    eventDetourS: 0,
    plan: ['b'],
    conditionalKinds: [],
    commitOnOpen: false,
    bossFirst: false,
    greedHold: false,
    greedReserveRatio: 0,
    bailHpRatio: 0.3,
    bailTravelS: 12,
    travelMarginS: 8,
    leavesOnFullBag: false,
  },
  // §8 Pyre: Ashwitch, Ash Ring → Pyre Shroud, Plague Censer, Candle of Hours.
  // Events (Vigil, Rising), density farming. Best XP; fragile.
  pyre: {
    lane: 'pyre',
    name: 'Pyre',
    classId: 'ashwitch',
    focusWeapons: ['nova', 'censer', 'orbit'],
    focusCharms: ['c_drum', 'c_candle', 'c_bell', 'c_salve'],
    appetite: { area: 5, offense: 3, sustain: 3, weapon: 2, mobility: 1, burst: 1, loot: 1 },
    engageRatio: 1.0,
    eliteFocus: 1.0,
    evasion: 0.6,
    holdRatio: 0.55,
    poiAppetite: { event_yard: 2, chest_t1: 1, shrine_blood: 1, shrine_grave: 1 },
    poiDetourS: 8,
    deepPoiFromS: 240,
    deepPoiFromLevel: 16,
    eventDetourS: 14,
    plan: ['b', 'c'],
    conditionalKinds: ['bell', 'toll'],
    commitOnOpen: false,
    bossFirst: false,
    greedHold: false,
    greedReserveRatio: 0,
    bailHpRatio: 0.25,
    bailTravelS: 10,
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
  bossAlive: boolean;
  bossKilled: boolean;
  /** Gates present this run (a, b, c + the conditional 'x'). */
  gates: readonly GateId[];
  /** Kind of each gate ('timed' for a/b/c). */
  kind: Partial<Record<GateId, GateKind>>;
  /** Live state of each gate, from the real `ExtractionSystem`. */
  state: Partial<Record<GateId, 'closed' | 'open' | 'closing' | 'spent'>>;
  /** Seconds until each gate opens (<= 0 once open; +Infinity while a bell gate is unrung). */
  opensInS: Partial<Record<GateId, number>>;
  /** Seconds until each gate closes; `null` for a gate that never closes. */
  closesInS: Partial<Record<GateId, number | null>>;
  /** Seconds of PATH travel to each gate at the current move speed. */
  travelS: Partial<Record<GateId, number>>;
  /** True when the gate's condition can be paid right now (toll shards, an offering item). */
  payable: Partial<Record<GateId, boolean>>;
  /** Seconds the channel needs. */
  channelS: number;
  /** Seconds until the Collapse ignites; <= 0 once it has. */
  secondsToCollapseS: number;
  /** Seconds until the next Greed step (Infinity once capped). */
  secondsToGreedStepS: number;
  /** Recent net hp loss as a fraction of max hp per second. */
  hpDrainRatioPerS: number;
}

export interface GateIntent {
  /** Gate the bot is moving to, or null to keep farming. */
  gate: GateId | null;
  /** Why — logged per run; also read by the "decided, not stumbled" gate. */
  reason: string;
}

function usableKind(profile: RouteProfile, ctx: GateContext, gate: GateId): boolean {
  if (gate !== 'x') return true;
  const kind = ctx.kind.x;
  return kind !== undefined && profile.conditionalKinds.includes(kind) && ctx.payable.x === true;
}

/** A gate is worth walking to if it is open now, or opens before the bot arrives. */
function reachable(ctx: GateContext, gate: GateId, marginS: number): boolean {
  const state = ctx.state[gate];
  if (state === undefined || state === 'spent') return false;
  const arrivalS = ctx.travelS[gate] ?? Number.POSITIVE_INFINITY;
  const closesInS = ctx.closesInS[gate] ?? null;
  if (closesInS !== null && closesInS < arrivalS + ctx.channelS + marginS) return false;
  return (ctx.opensInS[gate] ?? Number.POSITIVE_INFINITY) <= arrivalS + marginS;
}

function nearestUsable(
  profile: RouteProfile,
  ctx: GateContext,
  marginS: number,
  maxTravelS = Number.POSITIVE_INFINITY,
): GateId | null {
  let best: GateId | null = null;
  for (const gate of ctx.gates) {
    const travel = ctx.travelS[gate] ?? Number.POSITIVE_INFINITY;
    if (travel > maxTravelS) continue;
    if (!usableKind(profile, ctx, gate)) continue;
    if (!reachable(ctx, gate, marginS)) continue;
    if (best === null || travel < (ctx.travelS[best] ?? Number.POSITIVE_INFINITY)) best = gate;
  }
  return best;
}

/**
 * The route's gate decision. Priority is shared by all routes: dying beats
 * every plan, the Collapse leaves exactly one exit, and only then does the
 * route's own greed profile speak. Nothing in here can return "run over": a
 * route with no reachable gate keeps farming, so lanes end by extraction or
 * death, never by a timer.
 */
export function gateDecision(profile: RouteProfile, ctx: GateContext): GateIntent {
  if (ctx.hpRatio <= profile.bailHpRatio) {
    const bail = nearestUsable(profile, ctx, 0, profile.bailTravelS);
    if (bail !== null) return { gate: bail, reason: `bail-hp-${bail}` };
  }

  if (ctx.collapseActive) {
    if (reachable(ctx, 'c', 0)) return { gate: 'c', reason: 'collapse-gate-c' };
    return { gate: 'c', reason: 'collapse-gate-c-forced' };
  }

  if (profile.leavesOnFullBag && ctx.bagFull) {
    const full = nearestUsable(profile, ctx, profile.travelMarginS);
    if (full !== null) return { gate: full, reason: `bag-full-${full}` };
  }

  for (const gate of profile.plan) {
    if (!ctx.gates.includes(gate) || !usableKind(profile, ctx, gate)) continue;
    if (!reachable(ctx, gate, profile.travelMarginS)) continue;

    if (profile.greedHold && gate === 'c') {
      // Hold outside the ring for the next Greed step while the measured
      // drain says the run survives the wait plus the channel.
      const waitS = Math.min(ctx.secondsToGreedStepS, Math.max(0, ctx.secondsToCollapseS) + 1);
      if (Number.isFinite(waitS) && waitS > 0) {
        const projectedLoss = ctx.hpDrainRatioPerS * (waitS + ctx.channelS);
        if (ctx.hpRatio - projectedLoss >= profile.greedReserveRatio) {
          return { gate: null, reason: 'hold-for-greed' };
        }
      }
      return { gate, reason: `plan-${gate}` };
    }

    if (profile.bossFirst && gate === 'c' && ctx.bossAlive && !ctx.bossKilled) {
      return { gate: null, reason: 'boss-first' };
    }

    if (profile.commitOnOpen) return { gate, reason: `plan-${gate}` };

    // A deep route commits when this is the last window it will get, or when
    // the gate is its final plan.
    const closesInS = ctx.closesInS[gate] ?? null;
    const travel = ctx.travelS[gate] ?? 0;
    const lastChance =
      closesInS !== null && closesInS <= travel + ctx.channelS + profile.travelMarginS * 2;
    const isFinalPlan = gate === profile.plan[profile.plan.length - 1];
    if (gate === 'c' || lastChance || isFinalPlan) return { gate, reason: `plan-${gate}` };
  }

  return { gate: null, reason: 'farm' };
}

/**
 * Draft pick among the cards `rollUpgradeChoices` put on the table (§5.10
 * rules decide WHICH cards; a route only chooses), so a route can be forced
 * off-plan exactly like a human whose hand offers nothing on-lane.
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
  if (card.synergy === 'sustain' && hpRatio < 0.6) weight *= 3;

  if (card.kind === 'weapon-evolution') weight += 60;
  if (card.weapon !== undefined) {
    const rank = profile.focusWeapons.indexOf(card.weapon);
    if (rank >= 0) {
      const focus = 3 - rank;
      if (card.kind === 'weapon-unlock') weight += 12 * focus;
      else weight += 6 * focus;
    } else if (card.kind === 'weapon-unlock') {
      weight += 3;
    }
  }
  if (card.charm !== undefined) {
    const rank = profile.focusCharms.indexOf(card.charm);
    if (rank >= 0) weight += card.kind === 'charm-unlock' ? 14 - 2 * rank : 6 - rank;
  }
  if (card.kind === 'filler') weight *= 0.2;
  return Math.max(0.05, weight);
}
