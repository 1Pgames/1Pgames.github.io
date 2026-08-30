import type { EventSpec, RunPhase, WaveSpec } from '../core/run';
import { TUNING } from '../config';
import { sharedEnemies } from './enemies';

/**
 * Duskhaul's run timeline (PRD §5.4): 18 wave entries plus the scripted beats.
 * Feed straight into `new RunDirector(scene, WAVES, PHASES, onSpawn)`; enemy
 * ids reference `data/enemies.ts`.
 *
 * Two wave shapes, and a wave is one or the other — never both, because
 * `WaveSpec.until` makes the director ignore `count` for every slot in the
 * wave:
 *  - BURST: `count` (+ `everyMs` as intra-burst spacing). Set-piece entries.
 *  - LANE: `until` + `everyMs`, `count: 0`. Sustained pressure that keeps the
 *    screen populated between set pieces.
 * §5.4 rows quoted as "everyMs N" are lanes; rows quoted with an explicit
 * count are bursts. Where §5.4 gives BOTH ("dirgebell x2 + horde, everyMs
 * 500"), the row is a lane and the finite part rides a slow cadence that
 * delivers the stated count inside the lane's window — noted per row.
 *
 * WHAT IS NOT HERE, on purpose:
 *  - Gate open/close and the Collapse are NOT `EventSpec`s. `ExtractionSystem`
 *    owns that schedule (§4) and emits `gate-open`/`gate-close`/`collapse`
 *    itself, so restating the seconds here would create a second source of
 *    truth for the run's resolution surface. A wave row that coincides with a
 *    gate beat only supplies that beat's SPAWNS.
 *  - The Dread Shrine's POCKET. Its second is `TUNING.shrine.atS` (the wave row
 *    below reads that key, and so does the slice), but the marked pocket itself
 *    is a spatial set piece `slices/arena/game.ts` builds from
 *    `shrine.densityMul`/`radiusPx`/`tierBias` — those are not spawn rows and
 *    have no wave-table expression.
 */

/**
 * NO WAVE LABELS. `WaveSpec.label` used to be set on nine rows here and read by
 * NOTHING: `RunDirector.onSpawn(id, index, total, pattern)` never carries it, so
 * the slice structurally cannot see a label, and every beat the labels named is
 * already announced by the slice from its own timeline — `TUNING.shrine.atS`,
 * `TUNING.warden.atS`, `TUNING.elite.gateGuardAtS` and `ExtractionSystem`'s own
 * `gate-open`/`gate-close`/`collapse` events. Delivering them a second way
 * would mean widening the frozen `onSpawn` signature to carry a redundant
 * announce source. The comment above each row is the row's name.
 */

/**
 * §2A phase table x §7 `phase.multipliers` (1.0/1.3/1.7/2.3/3.2 at
 * 0/30/120/240/360s), plus the Collapse. The Collapse's own +0.4-per-10s
 * growth is NOT a phase: it is unbounded, so `RunDirector`/`ExtractionSystem`
 * apply it on top of this base (§2A — "the §2.5 fairness cap is deliberately
 * lifted here"). The zone's `threatBase` multiplies whatever this returns.
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
 * The Collapse floors the spawn interval at `TUNING.collapse.spawnFloorMs`
 * AGGREGATED across every lane, so each shared archetype runs at
 * `floor * laneCount` and the combined drip lands on the floor.
 */
const COLLAPSE_LANES = sharedEnemies();
const COLLAPSE_LANE_MS = TUNING.collapse.spawnFloorMs * COLLAPSE_LANES.length;

/**
 * The three §5.4 elite entrances, read from `TUNING.elite.atS` instead of typed
 * three times below. The seconds were duplicated here as literals while the
 * TUNING key nothing read sat in `config.ts` — a retune of the elite schedule
 * moved the key and left the timeline exactly where it was.
 *
 * Throws rather than defaulting: an `atS` array that has lost an entry is a
 * MISSING SCRIPTED BEAT, and silently spawning nothing is how §5.4 content
 * goes unshipped with every gate green.
 */
function eliteAt(index: number): number {
  const at = TUNING.elite.atS[index];
  if (at === undefined) {
    throw new Error(
      `TUNING.elite.atS has no entry ${index}: §5.4 authors three scripted elite entrances`,
    );
  }
  return at;
}

/** 18 entries, one per §5.4 row, in run order. */
export const WAVES: readonly WaveSpec[] = [
  // 1. 0s — grace trickle: a single-archetype husk drip for the whole grace
  // window. MEASURED FIX: four husks 1400ms apart is 4 bodies in 30s = 0.13
  // bodies/s, against the 0.55-0.73 kills/s the greybox build actually
  // playtested FUN — the run opened on an empty screen. One husk every 1800ms
  // restores that density (0.56/s) while keeping §2A's "x1.0, one archetype,
  // sparse": 18hp bodies arriving one at a time teach the verb, they do not
  // threaten.
  {
    at: 0,
    until: 30,
    spawns: [{ id: 'husk', count: 0, everyMs: 1800 }],
  },
  // 2. 30s — first pressure: husk + wretch lane through the Early phase.
  {
    at: 30,
    until: 120,
    spawns: [
      { id: 'husk', count: 0, everyMs: 1200 },
      { id: 'wretch', count: 0, everyMs: 1200 },
    ],
  },
  // 3. 45s — swarm teach: one ratking PACK every 20s. Pack size lives on the
  // archetype (`params.packSize`, behaviour `swarm`), so one spawn call here is
  // one 6-pack.
  {
    at: 45,
    until: TUNING.collapse.atS,
    pattern: 'cluster',
    spawns: [{ id: 'ratking', count: 0, everyMs: 20000 }],
  },
  // 4. 90s — ranged teach: opens the ranged lane. The stated pair lands inside
  // the first ~18s, then the lane holds roughly two bonecasters alive.
  {
    at: 90,
    until: TUNING.collapse.atS,
    spawns: [{ id: 'bonecaster', count: 0, everyMs: 9000 }],
  },
  // 5. 120s — Gate A opens: a ring of 12 wretches, so the first gate decision
  // is made while surrounded.
  {
    at: 120,
    pattern: 'ring',
    spawns: [{ id: 'wretch', count: 12, everyMs: 120 }],
  },
  // 6. elite 1, at `TUNING.elite.atS[0]`.
  {
    at: eliteAt(0),
    pattern: 'cluster',
    spawns: [{ id: 'elite_reaper', count: 1 }],
  },
  // 7. 180s — prop-ignoring pressure.
  {
    at: 180,
    until: TUNING.collapse.atS,
    spawns: [{ id: 'shroudmoth', count: 0, everyMs: 1100 }],
  },
  // 8. 200s — loot pinata: one Gilded Ghoul per 60s.
  {
    at: 200,
    until: TUNING.collapse.atS,
    spawns: [{ id: 'gildedghoul', count: 0, everyMs: 60000 }],
  },
  // 9. 210s — Gate A closes: four thornhounds from one direction.
  {
    at: 210,
    pattern: 'arc',
    spawns: [{ id: 'thornhound', count: 4, everyMs: 500 }],
  },
  // 10. 240s — Gate B opens: three Pale Knights in a line.
  {
    at: 240,
    pattern: 'line',
    spawns: [{ id: 'paleknight', count: 3, everyMs: 800 }],
  },
  // 11. gate guard: a reaper plus eight husks land ON Gate B (§2A: the elite
  // pack spawns within 300px of the gate). Same second the slice places the
  // pack on the ring, from the one key both read.
  {
    at: TUNING.elite.gateGuardAtS,
    pattern: 'cluster',
    spawns: [
      { id: 'elite_reaper', count: 1 },
      { id: 'husk', count: 8, everyMs: 250 },
    ],
  },
  // 12. elite 2, at `TUNING.elite.atS[1]`.
  {
    at: eliteAt(1),
    pattern: 'cluster',
    spawns: [{ id: 'elite_matron', count: 1 }],
  },
  // 13. Dread Shrine unlocks: a marrowworm cluster guards the pocket.
  {
    at: TUNING.shrine.atS,
    pattern: 'cluster',
    spawns: [{ id: 'marrowworm', count: 4, everyMs: 600 }],
  },
  // 14. 330s — burst pressure. Cadence 1100ms, not 700: see the Climax budget
  // note on row 15.
  {
    at: 330,
    until: TUNING.collapse.atS,
    spawns: [{ id: 'pyreling', count: 0, everyMs: 1100 }],
  },
  // 15. 360s — Gate B closes: the horde changes CHARACTER rather than thickening.
  //
  // MEASURED FIX (arena sim, 120 runs/seed x 3 seeds). The old Climax scheduled
  // 5.27 bodies/s against a ceiling build's ~4.4/s clear rate, so the pool grew
  // ~0.9/s and damage taken hit 3.05/s against ~1/s of regen: every deep lane
  // died at 284-341s, Gate C was reached in 5 of 120 runs, the Warden was never
  // killed once, and no run ever saw the Collapse. Bodies/s by band was
  // 0.13 / 1.95 / 1.11 / 2.04 / 5.27 — a 2.6x step in one phase.
  //
  // The budget is now spent on WEIGHT instead of COUNT, which is the lever §7
  // `wave.compositionFromS`/`eliteSwapEveryS`/`eliteShareMax` already provides
  // and the one the entity budget can absorb (the 420s beat peaked at 98 live
  // against §15's 180-enemy share): the wretch drip halves to 900ms and a Pale
  // Knight lane (90 base hp, wide swing) opens at 7s. Same pressure, fewer and
  // heavier bodies, and the picture keeps changing instead of just filling up.
  //
  // Final tune, best of three measured iterations: 3.80 bodies/s. Thinning
  // further to 3.61 and then 3.10 made the deep lanes WORSE, not better (45% ->
  // 35% -> 30% extraction), because a thinner Climax also starves the XP and
  // shard curve the deep build needs to survive the Warden. 3.80 is the peak of
  // that curve.
  {
    at: 360,
    until: TUNING.collapse.atS,
    spawns: [
      { id: 'dirgebell', count: 0, everyMs: 30000 },
      { id: 'wretch', count: 0, everyMs: 900 },
      { id: 'ashwraith', count: 0, everyMs: 4000 },
      { id: 'paleknight', count: 0, everyMs: 7000 },
    ],
  },
  // 16. elite 3, at `TUNING.elite.atS[2]`.
  {
    at: eliteAt(2),
    pattern: 'cluster',
    spawns: [{ id: 'elite_herald', count: 1 }],
  },
  // 17. the Gate Warden, at Gate C.
  {
    at: TUNING.warden.atS,
    pattern: 'cluster',
    spawns: [{ id: 'warden', count: 1 }],
  },
  // 18. 480s — the Collapse: every shared archetype at the aggregate floor,
  // running past the 480s frame because the run only ends by gate or death.
  {
    at: TUNING.collapse.atS,
    until: TUNING.collapse.atS + 600,
    spawns: COLLAPSE_LANES.map((def) => ({ id: def.id, count: 0, everyMs: COLLAPSE_LANE_MS })),
  },
];

/**
 * Scripted one-shot beats layered on the wave drip: one chest per entry in
 * `TUNING.chest.atS` (§5.4 authors two, at 165s / 345s), each a guaranteed
 * relic roll at `TUNING.chest.tierBias` — the same +1 the §5.5 drop rule
 * quotes for chests and elites.
 *
 * DERIVED from the key, not retyped: the seconds used to be literals here
 * while `TUNING.chest.atS` was read by nothing, so adding a third chest to the
 * key would have shipped no third chest.
 *
 * Gate, Collapse, Shrine, elite and Warden beats are deliberately absent: see
 * the file header. `EventSpec.kind` is a `core/run.ts` union owned by the
 * engine, and nothing here needs to widen it.
 */
export const TIMELINE_EVENTS: readonly EventSpec[] = TUNING.chest.atS.map(
  (at): EventSpec => ({ at, kind: 'chest' }),
);
