/**
 * Orbital Request templates (PRD §5.3): board of `requests.slots` from sol
 * `requests.firstSol`, refilled at dawn, each expiring after
 * `requests.expirySols`. Goods orders deduct stock on SHIP; condition orders
 * (colonists / clean night / kill alpha) auto-complete.
 * Owned by ContentDev (W3); shapes frozen in `./types.ts`.
 *
 * rq_trophy is only meaningful while a Matron night (sol 5 or 9) falls inside
 * its expiry window; the board filter lives in `model/requests.ts`.
 */
import type { OrderTemplate } from './types';

export const ORDERS: readonly OrderTemplate[] = [
  { id: 'rq_samples', name: 'Survey Samples', desc: 'Orbit wants raw aurelite for the labs.', solMin: 3, solMax: 5, need: { goods: { aurelite: 20 } }, data: 10, bonus: { pingPure: 1 } },
  { id: 'rq_plating', name: 'Hull Plating', desc: 'The shuttle bay needs patching.', solMin: 3, solMax: 10, need: { goods: { alloy: 30 } }, data: 14, bonus: { colonists: 2 } },
  { id: 'rq_cryo', name: 'Cryo Stock', desc: 'Coolant for the sleeper pods.', solMin: 3, solMax: 7, need: { goods: { ice: 40 } }, data: 10, bonus: { fe: 40 } },
  { id: 'rq_rations', name: 'Ration Crates', desc: 'The crew in orbit are eating foil.', solMin: 3, solMax: 10, need: { goods: { rations: 30 } }, data: 12, bonus: { morale: 10 } },
  { id: 'rq_lens', name: 'Lens Order', desc: 'Replacement optics for the Ark telescope.', solMin: 4, solMax: 10, need: { goods: { prism: 12 } }, data: 16, bonus: { freeBuild: { id: 'arc_coil', count: 1 } } },
  { id: 'rq_cellsample', name: 'Cell Sample', desc: 'Proof the foundry works.', solMin: 6, solMax: 10, need: { goods: { cell: 4 } }, data: 20, bonus: { rerolls: 1 } },
  { id: 'rq_tithe', name: 'Ore Tithe', desc: 'Ballast for the return burn.', solMin: 3, solMax: 6, need: { goods: { ferrite: 120 } }, data: 8, bonus: { mk2Tokens: 1 } },
  { id: 'rq_mixed', name: 'Mixed Freight', desc: 'A full pallet for the next drop.', solMin: 5, solMax: 10, need: { goods: { alloy: 20, prism: 10 } }, data: 22, bonus: { colonists: 3 } },
  { id: 'rq_deepcore', name: 'Deep Core', desc: 'Mixed cores for the geology deck.', solMin: 4, solMax: 9, need: { goods: { ferrite: 60, aurelite: 20, alloy: 10 } }, data: 18, bonus: { refillBanks: true } },
  { id: 'rq_array', name: 'Prism Array', desc: 'A new orbital mirror.', solMin: 6, solMax: 10, need: { goods: { prism: 20 } }, data: 26, bonus: { freeBuild: { id: 'relay_pylon', count: 2 } } },
  { id: 'rq_lumen', name: 'Lumen Batch', desc: "Power for the Ark's own engines.", solMin: 7, solMax: 10, need: { goods: { cell: 10 } }, data: 34, bonus: { beaconSecs: 10 } },
  { id: 'rq_census', name: 'Colony Census', desc: 'Orbit wants proof of life: 20 colonists alive at dawn.', solMin: 5, solMax: 10, need: { colonists: 20 }, data: 16, bonus: { colonists: 2 } },
  { id: 'rq_watch', name: 'Night Watch', desc: 'Hold one night without losing a building.', solMin: 3, solMax: 9, need: { cleanNight: true }, data: 18, bonus: { freeBuild: { id: 'pulse_turret', count: 2 } } },
  { id: 'rq_trophy', name: 'Trophy Chitin', desc: 'Bring down a Hive Matron while this is listed.', solMin: 5, solMax: 9, need: { killAlpha: 'matron' }, data: 30, bonus: { rerolls: 1 } },
];
