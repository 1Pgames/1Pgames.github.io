import type { EventSpec, RunPhase, WaveSpec } from '../core/run';
import type { Rng } from '../core/rng';
import { TUNING } from '../config';
import { enemiesForZone, exclusiveEnemies, type EnemyDef } from './enemies';
import type { EliteAffixId, ZoneId } from './types-v2';

/**
 * Duskhaul V2 run timeline (PRD-V2 §2.1 beat sheet, §5.7 wave rows, §6.3
 * density curve). Owner WS-Balance. Consumers (§16.1 E38): `slices/arena/
 * game.ts` director setup and `sim/families/arena.ts`.
 *
 * Two wave shapes, and a wave is one or the other — never both, because
 * `WaveSpec.until` makes the director ignore `count` for every slot:
 *  - BURST: `count` (+ `everyMs` as intra-burst spacing). Set pieces.
 *  - LANE: `until` + `everyMs`, `count: 0`. Sustained pressure.
 *
 * DENSITY. §6.3 quotes a live-count target (10 s → 12, 60 → 30, 120 → 70,
 * 240 → 120, 360 → 170, 420-480 → 200-230, cap `enemy.maxAlive` 250) and an
 * aggregate spawn-interval guide (700 / 420 / 260 / 170 / 130 / 110 ms). The
 * lanes below are authored so the SUM of bodies/s across every live lane
 * tracks that guide. One spawn call is ONE body, swarms included
 * (`params.packSize` only shapes swarm steering in `objects/enemy.ts`), so a
 * swarm row authors its pack as a burst count or a fast lane. The
 * `densityTarget` curve below then caps what actually lands near the hero.
 *
 * WHAT IS NOT HERE, on purpose:
 *  - Gate open/close and the Collapse: `ExtractionSystem` owns that schedule.
 *  - The Gate B guard pack (elite + 8 adds within 300 px of Gate B at
 *    `TUNING.elite.gateGuardAtS`): positional, so `game.ts` places it from the
 *    `TUNING.elite.gateGuard*` keys.
 *  - POI-owned populations (lairs, den, vault, events): `systems/poi.ts`
 *    requests them through `CombatSystem.spawnPopulation`; the timeline only
 *    carries the BEATS that start them (`poi-event`, `den-open`,
 *    `fence-window`).
 */

/**
 * §2.1 phase table (×1.0 / 1.3 / 1.7 / 2.3 / 3.2 at 0 / 30 / 120 / 240 /
 * 360 s) plus the Collapse. The Collapse's +0.4 per 3 s growth is applied by
 * `ExtractionSystem.collapseThreatBonus` on top of this base; zone
 * `threatBase`, hazard `threatMul` and region `depthMul` multiply whatever
 * this returns (§2.1 threat formula).
 */
export const PHASES: readonly RunPhase[] = [
  { name: 'Grace', fromSeconds: 0, difficultyMul: 1.0 },
  { name: 'Early', fromSeconds: 30, difficultyMul: 1.3 },
  { name: 'Mid', fromSeconds: 120, difficultyMul: 1.7 },
  { name: 'Late', fromSeconds: 240, difficultyMul: 2.3 },
  { name: 'Climax', fromSeconds: 360, difficultyMul: 3.2 },
  { name: 'Collapse', fromSeconds: TUNING.collapse.atS, difficultyMul: 3.2 },
] as const;

/**
 * Near-hero density target (`TUNING.wave.densityTarget`, Wicket ×
 * `ftueDensityMul`): the most ambient bodies allowed within 900 px of the hero
 * at run second `elapsedS`. `CombatSystem.spawn` and its leash re-seat refuse
 * to add a body at or above it; the sim applies the same gate. The wave table
 * below is the SUPPLY; this curve is the ceiling a struggling player sees.
 */
export function densityTarget(elapsedS: number, ftue: boolean): number {
  const knots = TUNING.wave.densityTarget;
  let target = knots[knots.length - 1]![1];
  for (let i = 1; i < knots.length; i += 1) {
    const [t1, n1] = knots[i]!;
    if (elapsedS > t1) continue;
    const [t0, n0] = knots[i - 1]!;
    target = n0 + ((n1 - n0) * Math.max(0, elapsedS - t0)) / (t1 - t0);
    break;
  }
  return Math.round(target * (ftue ? TUNING.wave.ftueDensityMul : 1));
}

/** Every ambient lane ends when the Collapse ignites (`collapse.stopTrashDrip`). */
const END = TUNING.collapse.atS;
/**
 * The Climax's heavy lanes stop at `warden.beatFromS` so the zone boss at
 * 420 s walks into a thinning field (and the 412 s breather lands on it); the
 * light ambient lanes run on to the Collapse so the arena is never empty.
 */
const BOSS_BEAT = TUNING.warden.beatFromS;

/**
 * Shared-roster timeline: 26 rows, run order. Every shared archetype enters at
 * its §5.4 `firstSeenS`. Zone exclusives are appended per zone by `wavesFor`.
 */
export const WAVES: readonly WaveSpec[] = [
  // 1. 0 s — husk drip: the grace verb. One body at a time, 18 hp.
  { at: 0, until: 30, spawns: [{ id: 'husk', count: 0, everyMs: 700 }] },
  // 2. 0 s — opening burst so the first draft lands inside 10 s (§6.1).
  { at: 1, pattern: 'arc', spawns: [{ id: 'husk', count: 8, everyMs: 200 }] },
  // 3. 20 s — crypt crawler swarm teach (§5.7 mandatory): an 8-body burst.
  { at: 20, pattern: 'cluster', spawns: [{ id: 'cryptcrawler', count: 8, everyMs: 80 }] },
  // 4. 30 s — Early: husk + wretch lanes.
  {
    at: 30,
    until: 120,
    spawns: [
      { id: 'husk', count: 0, everyMs: 800 },
      { id: 'wretch', count: 0, everyMs: 1100 },
    ],
  },
  // 4b. 60 s — user playtest ("too easy"): after the welcoming first minute a
  // second wretch lane lands before Gate A opens, so a novice arrives at the
  // gate having spent real HP. The density curve still caps what reaches them.
  { at: 60, until: 120, spawns: [{ id: 'wretch', count: 0, everyMs: 1200 }] },
  // 5. 32 s — crawler lane through Early/Mid (one body per 1.4 s ≈ a ×8 pack per 11 s).
  { at: 32, until: 240, pattern: 'cluster', spawns: [{ id: 'cryptcrawler', count: 0, everyMs: 1400 }] },
  // 6. 45 s — ratking swarm (one body per 2.7 s ≈ a ×6 pack per 16 s), ambient to the Collapse.
  { at: 45, until: END, pattern: 'cluster', spawns: [{ id: 'ratking', count: 0, everyMs: 2700 }] },
  // 7. 90 s — Gate A opens: ranged teach.
  { at: 90, until: END, spawns: [{ id: 'bonecaster', count: 0, everyMs: 6000 }] },
  // 8. 90 s — a ring of 10 wretches: the first gate decision is made surrounded.
  { at: 90, pattern: 'ring', spawns: [{ id: 'wretch', count: 10, everyMs: 120 }] },
  // 9. 120 s — Mid: the core lanes thicken.
  {
    at: 120,
    until: 240,
    spawns: [
      { id: 'husk', count: 0, everyMs: 550 },
      { id: 'wretch', count: 0, everyMs: 700 },
    ],
  },
  // 10. 120 s — thornhound orbit-chargers.
  { at: 120, until: BOSS_BEAT, spawns: [{ id: 'thornhound', count: 0, everyMs: 7000 }] },
  // 11. 150 s — Pale Knight tank lane (punctuation, not a wall).
  { at: 150, until: BOSS_BEAT, pattern: 'line', spawns: [{ id: 'paleknight', count: 0, everyMs: 20000 }] },
  // 12. 150 s — Lantern Monk lob debut, alone and slow.
  { at: 150, until: BOSS_BEAT, spawns: [{ id: 'lanternmonk', count: 0, everyMs: 12000 }] },
  // 13. 180 s — Gate A closes: prop-ignoring shroudmoths.
  { at: 180, until: END, spawns: [{ id: 'shroudmoth', count: 0, everyMs: 2600 }] },
  // 14. 200 s — Bone Bulwark shield debut.
  { at: 200, until: BOSS_BEAT, spawns: [{ id: 'bulwark', count: 0, everyMs: 24000 }] },
  // 15. 200 s — loot piñata: one Gilded Ghoul per 50 s.
  { at: 200, until: END, spawns: [{ id: 'gildedghoul', count: 0, everyMs: 50000 }] },
  // 16. 210 s — Pyreling burst debut: slow cadence first, thickens at 360 s.
  { at: 210, until: 360, spawns: [{ id: 'pyreling', count: 0, everyMs: 5000 }] },
  // 17. 240 s — Late: core lanes at their Late weight.
  {
    at: 240,
    until: 360,
    spawns: [
      { id: 'husk', count: 0, everyMs: 450 },
      { id: 'wretch', count: 0, everyMs: 550 },
      { id: 'cryptcrawler', count: 0, everyMs: 1100 },
    ],
  },
  // 18. 240 s — Marrowworm split lane.
  { at: 240, until: BOSS_BEAT, spawns: [{ id: 'marrowworm', count: 0, everyMs: 9000 }] },
  // 19. 250 s — Gibbet Wight hook debut.
  { at: 250, until: BOSS_BEAT, spawns: [{ id: 'gibbet', count: 0, everyMs: 14000 }] },
  // 20. 270 s — Dirgebell haste aura.
  { at: 270, until: BOSS_BEAT, spawns: [{ id: 'dirgebell', count: 0, everyMs: 30000 }] },
  // 21. 300 s — Ashwraith blinkers.
  { at: 300, until: END, spawns: [{ id: 'ashwraith', count: 0, everyMs: 4500 }] },
  // 22. 340 s — Gate B closes: thornhound arc from one direction.
  { at: 340, pattern: 'arc', spawns: [{ id: 'thornhound', count: 5, everyMs: 400 }] },
  // 23. 360 s — Climax: light bodies carry the density; heavies stay punctuation.
  {
    at: 360,
    until: BOSS_BEAT,
    spawns: [
      { id: 'husk', count: 0, everyMs: 380 },
      { id: 'wretch', count: 0, everyMs: 420 },
      { id: 'cryptcrawler', count: 0, everyMs: 900 },
      { id: 'pyreling', count: 0, everyMs: 3500 },
    ],
  },
  // 24. 405 s — boss beat: thinner light drip to the Collapse so the field
  // never empties while the zone boss holds Gate C.
  {
    at: BOSS_BEAT,
    until: END,
    spawns: [
      { id: 'husk', count: 0, everyMs: 600 },
      { id: 'wretch', count: 0, everyMs: 700 },
    ],
  },
  // 25. 420 s — Gate C opens under the boss: a crawler ring.
  { at: TUNING.warden.atS, pattern: 'ring', spawns: [{ id: 'cryptcrawler', count: 16, everyMs: 80 }] },
  // 26. 450 s — last push before the Collapse.
  { at: 450, pattern: 'arc', spawns: [{ id: 'paleknight', count: 2, everyMs: 900 }] },
];

/**
 * Zone-exclusive lane cadence by the exclusive's weight class (ordered by
 * `firstSeenS`: the §5.4 table debuts each zone's light exclusive at 60 s,
 * the special at 90-120 s and the heavy at 240 s).
 */
const EXCLUSIVE_LANE_MS: readonly number[] = [3500, 7000, 14000];

/**
 * The run timeline for one zone: the shared rows plus that zone's three
 * exclusives, each entering at its own `firstSeenS` (§5.7). Hand this — not
 * `WAVES` — to `RunDirector` so the exclusives spawn.
 */
export function wavesFor(zone: ZoneId): readonly WaveSpec[] {
  const exclusives = [...exclusiveEnemies(zone)].sort((a, b) => a.firstSeenS - b.firstSeenS);
  const rows: WaveSpec[] = exclusives.map((def, index) => ({
    at: def.firstSeenS,
    until: index === exclusives.length - 1 ? BOSS_BEAT : END,
    spawns: [
      {
        id: def.id,
        count: 0,
        everyMs: EXCLUSIVE_LANE_MS[Math.min(index, EXCLUSIVE_LANE_MS.length - 1)]!,
      },
    ],
  }));
  return [...WAVES, ...rows].sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------
// Elites (§5.5): scripted affix beats at `TUNING.elite.atS`.
// ---------------------------------------------------------------------------

const ELITE_AFFIX_IDS: readonly EliteAffixId[] = [
  'vampiric',
  'hasted',
  'shielded',
  'splitter',
  'frenzied',
  'warded',
  'plagued',
  'magnetic',
];

/**
 * Archetypes a scripted elite beat (or a composition swap) may promote at
 * second `atS` in `zone`: the PHASE archetypes — every trash row already in
 * the spawn table for ≥ 30 s (a threat debuts alone before it is promoted),
 * excluding swarm packs, the flee piñata and the zero-damage aura, since an
 * affixed ratking/ghoul/dirgebell is not a duel.
 */
function eliteArchetypes(atS: number, zone: ZoneId): readonly EnemyDef[] {
  return enemiesForZone(zone).filter(
    (def) =>
      def.firstSeenS <= atS - 30 &&
      def.behaviour !== 'swarm' &&
      def.behaviour !== 'flee' &&
      def.stats.damage > 0,
  );
}

/**
 * One elite roll: archetype weighted toward the heaviest eligible bodies (the
 * beat should read as a spike) and a uniform affix. `forced` is the H5
 * `hazardExtras.forcedAffix`; `extraAffix` (H3+) returns a second, distinct
 * affix. Consumed by `game.ts` for the `'elite'` beats, composition swaps,
 * lairs and the Curse Shrine (→ `CombatSystem.spawnElite(defId, affix, x,
 * y)`), and by the sim. A lair woken or a shrine cursed before the first
 * scripted beat promotes from that beat's pool (`elite.atS[0]`), so an early
 * elite is never a husk-only duel and never an empty pool.
 */
export function rollElite(
  rng: Rng,
  atS: number,
  zone: ZoneId,
  forced: EliteAffixId | null = null,
  extraAffix = false,
): { defId: string; affixes: EliteAffixId[] } {
  const pool = eliteArchetypes(Math.max(atS, TUNING.elite.atS[0]), zone);
  if (pool.length === 0) throw new Error(`no elite archetype eligible at ${atS}s in ${zone}`);
  const def = rng.pickWeighted(
    pool,
    pool.map((entry) => Math.sqrt(entry.stats.maxHp)),
  );
  const first = forced ?? rng.pick(ELITE_AFFIX_IDS);
  const affixes: EliteAffixId[] = [first];
  if (extraAffix) affixes.push(rng.pick(ELITE_AFFIX_IDS.filter((id) => id !== first)));
  return { defId: def.id, affixes };
}

/**
 * Scripted one-shot beats (§2.1, §5.7), sorted because `RunDirector` walks
 * them with a single advancing index:
 *  - `poi-event` at `poi.eventTimesS` (100/220/340): `systems/poi.ts` starts
 *    the next event of the run's random order;
 *  - `elite` at `elite.atS` (150/270/390): `rollElite` → `spawnElite`;
 *  - `fence-window` at `poi.fence.windowS[0]` (180): Wandering Fence may appear;
 *  - `den-open` at `midboss.opensS` (240): Mid-boss Den unlocks;
 *  - `boss` at `warden.atS` (420): zone boss 260 px from Gate C;
 *  - `breather` at `events.breatherAtS` (290/412): heal + spawn silence.
 */
export const TIMELINE_EVENTS: readonly EventSpec[] = [
  ...TUNING.poi.eventTimesS.map((at): EventSpec => ({ at, kind: 'poi-event' })),
  ...TUNING.elite.atS.map((at): EventSpec => ({ at, kind: 'elite' })),
  { at: TUNING.poi.fence.windowS[0], kind: 'fence-window' } satisfies EventSpec,
  { at: TUNING.midboss.opensS, kind: 'den-open' } satisfies EventSpec,
  { at: TUNING.warden.atS, kind: 'boss' } satisfies EventSpec,
  ...TUNING.events.breatherAtS.map((at): EventSpec => ({ at, kind: 'breather' })),
].sort((left, right) => left.at - right.at);
