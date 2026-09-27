// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/draft.selftest.ts
//   DRAFT_SEEDS (default 500) seeded 10-pick draft sequences per pool;
//   DRAFT_EVOLVE_LANDINGS (default 500) full last-rung Landings of the variety lane.
//
// PRD §19 / §1c build-variety / §8 no-dead-option guarantees, on the REAL
// `model/draft.ts:drawDirectives` with the variety lane's picks:
//   - L1 pool: ≥ 50 distinct 10-directive loadouts over 500 seeds;
//   - last rung (every directive unlocked): each directive ≥ 10 % pick share;
//   - every draw: 3 cards (never short), ≥ 2 tags, no owned directive re-offered;
//     drafts 1-3 always carry a tag the colony owns nothing in;
//   - every protocol evolves ≥ 1× over the last-rung Landings (`runLanding`,
//     the director's own 4th-card path — `evolved` events).
import assert from 'node:assert/strict';
import { Rng } from '../../core/rng';
import { ARK_NODES, DIRECTIVES, PROTOCOLS, type DirectiveDef } from '../../slices/colony/content';
import { COLONY_TUNING } from '../../slices/colony/tuning';
import { drawDirectives, unlockedPool } from '../../slices/colony/model/draft';
import { createLane } from '../colony/bots';
import { playLane } from '../colony/runLanding';

const SEEDS = Number(process.env.DRAFT_SEEDS ?? 500);
const EVOLVE_LANDINGS = Number(process.env.DRAFT_EVOLVE_LANDINGS ?? 500);
/** Directive picks per Landing (§6: one per sol, the landing pick included). */
const PICKS = 10;
const CHOICES = COLONY_TUNING.draft.choices;

/** Plays one 10-pick draft sequence with the variety lane; asserts every draw's guarantees; returns the loadout. */
function draftSequence(pool: readonly DirectiveDef[], seed: string): string[] {
  const rng = new Rng(`${seed}:draft`);
  const lane = createLane('variety', seed);
  const owned: string[] = [];
  for (let i = 0; i < PICKS; i += 1) {
    const cards = drawDirectives(pool, owned, i, rng, CHOICES);
    const where = `${seed} draft ${i + 1}`;
    assert.equal(cards.length, CHOICES, `${where}: short draw (${cards.length} cards)`);
    assert.equal(new Set(cards.map((c) => c.id)).size, cards.length, `${where}: duplicate card`);
    for (const c of cards) assert.ok(!owned.includes(c.id), `${where}: owned directive ${c.id} re-offered`);
    assert.ok(new Set(cards.map((c) => c.tag)).size >= 2, `${where}: one tag only (${cards[0]?.tag})`);
    if (i < COLONY_TUNING.draft.newTagDrafts) {
      const ownedTags = new Set(pool.filter((d) => owned.includes(d.id)).map((d) => d.tag));
      assert.ok(cards.some((c) => !ownedTags.has(c.tag)), `${where}: no card of a tag the colony does not own`);
    }
    const pick = lane.pick(cards.map((c) => c.id), null);
    assert.ok(cards.some((c) => c.id === pick), `${where}: variety lane picked ${pick}, not a card`);
    owned.push(pick);
  }
  return owned;
}

// L1 pool: loadout variety.
const l1 = unlockedPool([]).directives;
assert.ok(l1.length >= 17, `L1 pool holds ${l1.length} directives (PRD §1c: ≥ 17 open at L1)`);
const loadouts = new Set<string>();
for (let s = 0; s < SEEDS; s += 1) loadouts.add([...draftSequence(l1, `draft:l1:${s}`)].sort().join(','));
assert.ok(loadouts.size >= 50, `${loadouts.size} distinct L1 loadouts over ${SEEDS} seeds (must be ≥ 50)`);

// Last rung: every directive unlocked; pick share per directive.
const allUnlocks = [...ARK_NODES.map((n) => n.id), ...ARK_NODES.flatMap((n) => n.unlocks), ...DIRECTIVES.map((d) => d.id), ...PROTOCOLS.map((p) => p.id)];
const last = unlockedPool(allUnlocks).directives;
assert.equal(last.length, DIRECTIVES.length, `last-rung pool holds ${last.length} of ${DIRECTIVES.length} directives`);
const picked: Record<string, number> = {};
for (let s = 0; s < SEEDS; s += 1) for (const id of draftSequence(last, `draft:last:${s}`)) picked[id] = (picked[id] ?? 0) + 1;
const shares = DIRECTIVES.map((d) => ({ id: d.id, share: (picked[d.id] ?? 0) / SEEDS }));
const rare = shares.filter((x) => x.share < 0.1);
assert.equal(rare.length, 0, `directives under 10 % pick share at the last rung: ${rare.map((x) => `${x.id} ${(x.share * 100).toFixed(1)}%`).join(', ')}`);

// Protocol evolutions over full last-rung Landings.
assert.ok(PROTOCOLS.length > 0, 'PROTOCOLS is empty: no evolution to prove');
const runs = playLane('variety', EVOLVE_LANDINGS, 'draft:evolve', { ark: allUnlocks });
const evolvedCount: Record<string, number> = {};
for (const r of runs) for (const id of r.probe.evolved) evolvedCount[id] = (evolvedCount[id] ?? 0) + 1;
const never = PROTOCOLS.filter((p) => (evolvedCount[p.id] ?? 0) === 0).map((p) => p.id);
assert.equal(never.length, 0, `protocols never evolved over ${EVOLVE_LANDINGS} last-rung Landings: ${never.join(', ')}`);

const minShare = Math.min(...shares.map((x) => x.share));
console.log(`L1: ${l1.length} directives, ${loadouts.size} distinct loadouts over ${SEEDS} seeds`);
console.log(`last rung: ${last.length} directives, lowest pick share ${(minShare * 100).toFixed(1)} %`);
console.log(`protocols: ${PROTOCOLS.length}/${PROTOCOLS.length} evolved over ${EVOLVE_LANDINGS} Landings (min ${Math.min(...PROTOCOLS.map((p) => evolvedCount[p.id] ?? 0))}×)`);
console.log('draft OK');
