/**
 * Terrain-only flow field to the Lander Core (PRD §15 Nav): buildings stay
 * passable, fauna attack the building in their path. Built once per Landing;
 * a Continent map floods only `map.navWindow` tiles around the core
 * (`buildFlowFieldWindow`) — fauna outside it steer straight at the core.
 */
import { NavGrid } from '../../../core/grid';
import { COLONY_TUNING } from '../tuning';
import type { SiteMap } from './terrain';

export function buildCoreFlow(map: SiteMap): NavGrid {
  const nav = NavGrid.fromBlocked(map.cols, map.rows, COLONY_TUNING.map.tilePx, map.blocked);
  if (map.navWindow > 0) nav.buildFlowFieldWindow(map.core.col, map.core.row, map.navWindow);
  else nav.buildFlowField(map.core.col, map.core.row);
  return nav;
}
