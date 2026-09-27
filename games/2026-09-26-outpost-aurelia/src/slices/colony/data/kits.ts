/**
 * Landing Kits (PRD §5.3): one start crate per Landing, picked on the LAND tab.
 * Owned by ContentDev (W3); shapes frozen in `./types.ts`. `grant` is the
 * crate's payload; `model/state.ts:createColony` applies it generically (only
 * the placement rule per building lives in code). `unlockNode` is the Ark charter.
 */
import type { LandingKit } from './types';

/** The empty crate: the Landing with no kit (FTUE Landing 1, sims). */
export const KIT_NONE: LandingKit = { id: 'kit_none', name: 'Standard Crate', desc: 'The Ark manifest, nothing extra.', openAtL1: true, unlockNode: null, grant: {} };

/** The five kits (PRD §5.3): 2 open at L1, 3 via Ark charters. */
export const KITS: readonly LandingKit[] = [
  { id: 'kit_engineer', name: 'Engineer Crate', desc: 'A free Ferrite Drill on the nearest ore, plus 40 Fe.', openAtL1: true, unlockNode: null, grant: { fe: 40, place: { id: 'ferrite_drill', count: 1 } } },
  { id: 'kit_warden', name: 'Warden Crate', desc: 'Two Pulse Turrets pre-placed on the loudest side.', openAtL1: true, unlockNode: null, grant: { place: { id: 'pulse_turret', count: 2 } } },
  { id: 'kit_settler', name: 'Settler Crate', desc: 'Four more sleepers and a Hab Dome to wake them in.', openAtL1: false, unlockNode: 'hab_kit', grant: { colonists: 4, place: { id: 'hab_dome', count: 1 } } },
  { id: 'kit_surveyor', name: 'Surveyor Crate', desc: 'Fog reveal +3 tiles; every pure deposit pinged.', openAtL1: false, unlockNode: 'sur_kit', grant: { fogTiles: 3, pingPure: true } },
  { id: 'kit_tinker', name: 'Tinker Crate', desc: '+1 reroll; your first 3 Mk II upgrades are free.', openAtL1: false, unlockNode: 'cmd_kit', grant: { rerolls: 1, mk2Tokens: 3 } },
];
