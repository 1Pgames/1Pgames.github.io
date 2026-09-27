/**
 * Colony sim seam (PRD §16.1). FROZEN at the contract wave (owner: seam);
 * SimDev (W6) implements `runLanding` in `src/sim/colony/runLanding.ts` and
 * the lanes against these shapes.
 */
import type { Rng } from '../../core/rng';
import type { ColonyView, LandingResult, LandingSetup } from '../../slices/colony/contracts';
import type { RelicId } from '../../slices/colony/data/types';
import type { ColonyState } from '../../slices/colony/model/state';

export type LaneId = 'bastion' | 'sprawl' | 'spire' | 'kin' | 'novice' | 'novice-noturret' | 'variety';

export interface LanePolicy {
  id: LaneId;
  /** Called on every model tick of a day/dusk window; places, upgrades, ships, pins through `state`. */
  onDay(state: ColonyState, view: ColonyView, rng: Rng): void;
  /** Returns one of `cards` (or `protocol` when offered). */
  pick(cards: readonly string[], protocol: string | null): string;
  /** True when the lane charges the Beacon now. */
  triggerWhen(view: ColonyView): boolean;
}

export interface LandingTrace {
  /** Seconds of every placement / upgrade / ship / pick / pin (decision-cadence gate §2A). */
  actionsAtSec: number[];
  /** Seconds of every payoff beat (§2A payoff list). */
  payoffsAtSec: number[];
  brownoutNights: number;
  /** Sols whose night lost ≥ 1 building. */
  nightsLost: number[];
  ordersDone: string[];
  relics: RelicId[];
}

/** `src/sim/colony/runLanding.ts` — the headless Landing every lane and selftest runs. */
export type RunLanding = (setup: LandingSetup, lane: LanePolicy) => { result: LandingResult; trace: LandingTrace };
