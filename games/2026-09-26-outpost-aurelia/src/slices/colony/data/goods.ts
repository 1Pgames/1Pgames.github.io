/**
 * Goods display rows (HUD short labels, ledger order = `GOOD_IDS`).
 * Owned by ContentDev (W3); shapes frozen in `./types.ts`.
 */
import { GOOD_IDS, type GoodId } from './types';

/** Goods in HUD / ledger order. */
export const GOODS: readonly GoodId[] = GOOD_IDS;
export const GOOD_SHORT: Record<GoodId, string> = {
  ferrite: 'Fe',
  ice: 'Ice',
  aurelite: 'Au',
  rations: 'Rat',
  alloy: 'Alloy',
  prism: 'Prism',
  cell: 'Cell',
};
