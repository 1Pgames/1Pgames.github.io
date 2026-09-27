/**
 * Dawn Directive draft (PRD §5.3, §7 draft.*): pick 1 of 3; the cards span
 * ≥ 2 tags, never re-offer an owned directive, and drafts 1-3 carry a tag
 * the colony owns nothing in. Seeded by the passed `Rng`.
 */
import type { Rng } from '../../../core/rng';
import { COLONY_TUNING } from '../tuning';
import { DIRECTIVES, PROTOCOLS, buildingDef, type DirectiveDef, type ProtocolDef } from '../content';
import type { ColonyState } from './state';

/** Directives and protocols open at L1 or unlocked by an owned Ark node (`ArkNode.unlocks`, resolved by the caller into `ark`). */
export function unlockedPool(ark: readonly string[]): { directives: readonly DirectiveDef[]; protocols: readonly ProtocolDef[] } {
  return {
    directives: DIRECTIVES.filter((d) => d.openAtL1 || ark.includes(d.id)),
    protocols: PROTOCOLS.filter((p) => p.openAtL1 || ark.includes(p.id)),
  };
}

/** First protocol whose directive is owned and whose building count is met, not yet evolved (PRD §5.3). */
export function protocolReady(state: ColonyState, owned: readonly string[], pool: readonly ProtocolDef[]): ProtocolDef | null {
  for (const p of pool) {
    if (owned.includes(p.id) || !owned.includes(p.directive)) continue;
    let n = 0;
    for (const b of state.buildings.values()) {
      if (p.building === 'extractors' ? buildingDef(b.def).deposit !== null && b.def !== 'vent_tap' : b.def === p.building) n += 1;
    }
    if (n >= p.count) return p;
  }
  return null;
}

export function drawDirectives(pool: readonly DirectiveDef[], owned: readonly string[], draftIndex: number, rng: Rng, choices: number): readonly DirectiveDef[] {
  const D = COLONY_TUNING.draft;
  const ownedTags = new Set(pool.filter((d) => owned.includes(d.id)).map((d) => d.tag));
  let left = pool.filter((d) => !owned.includes(d.id));
  const out: DirectiveDef[] = [];
  const take = (from: readonly DirectiveDef[]): void => {
    if (from.length === 0) return;
    const pick = rng.pickWeighted(from, from.map((d) => (d.rarity === 'prime' ? D.primeWeight : 1 - D.primeWeight)));
    out.push(pick);
    left = left.filter((d) => d.id !== pick.id);
  };
  if (draftIndex < D.newTagDrafts) take(left.filter((d) => !ownedTags.has(d.tag)));
  while (out.length < choices && left.length > 0) {
    const tags = new Set(out.map((d) => d.tag));
    // The last card must open a second tag when the first ones share one.
    const needNewTag = out.length === choices - 1 && tags.size === 1;
    const from = needNewTag ? left.filter((d) => !tags.has(d.tag)) : left;
    take(from.length > 0 ? from : left);
  }
  return out;
}
