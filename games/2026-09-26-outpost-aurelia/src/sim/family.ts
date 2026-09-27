// `cli.ts` loads `families/<code>.ts` through a runtime-built specifier the
// consumer-edge gate cannot resolve; this static edge keeps the colony family
// (and the `sim/colony/*` harness it drives) reachable from the sim harness root.
import './families/colony';

/** Default family for `npm run sim` (written by new-game.sh --family). */
export const SIM_FAMILY = 'colony';
