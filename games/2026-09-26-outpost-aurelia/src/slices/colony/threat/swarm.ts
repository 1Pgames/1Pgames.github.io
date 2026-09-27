/**
 * Swarm planner (PRD §4 Swarms, §5.4): nightly ceilings × noise scale × site
 * `ceilingMul`, the loudest quadrant as the lead edge (+1 edge from Severity
 * rung 4), the Long Night drip and the Chorus (all four edges; the Titan row
 * is scheduled by the director at trigger + `swarm.titanDelaySec`).
 *
 * Off-axis trickle (critic2 #3): from sol 2 a night that does not already
 * use every edge gets one extra edge perpendicular to the lead, appended to
 * `plan.edges` so the dusk telegraph shows it. The director deals units to
 * `plan.edges` round-robin; `SwarmRouter` caps what actually lands on the
 * trickle edge at ≈ 25 % of the non-alpha units and re-routes the surplus to
 * the main edges, so the trickle stays a second, smaller front.
 */
import type { Rng } from '../../../core/rng';
import { CHORUS, LONG_NIGHT, SWARM_NIGHTS, type Edge, type FaunaId, type SiteDef, type SwarmNight } from '../content';
import type { NightPlan } from '../contracts';
import { COLONY_TUNING } from '../tuning';

const SW = COLONY_TUNING.swarm;
/** Critic2 #3: the off-axis trickle opens on this sol. */
const TRICKLE_FROM_SOL = SW.trickleFromSol;
/** Share of tonight's non-alpha units the trickle edge receives. */
const TRICKLE_SHARE = SW.trickleShare;
const TRICKLE_MIN = SW.trickleMin;
/** PRD §5.4 Severity: +1 edge per night from this rung. */
const RUNG_EXTRA_EDGE_FROM = SW.rungExtraEdgeFrom;

const ALL_EDGES: readonly Edge[] = [0, 1, 2, 3];

/** Debut ceiling per fauna: its count in the first nightly row that spawns it (a site's `earlyFauna` brings that debut forward). */
const DEBUT = new Map<FaunaId, number>();
for (const n of SWARM_NIGHTS) for (const s of n.spawns) if (!DEBUT.has(s.id)) DEBUT.set(s.id, s.count);

type Counts = Array<{ id: FaunaId; count: number }>;

function scaledCounts(night: SwarmNight, scale: number, site: SiteDef): Counts {
  const counts: Counts = [];
  for (const s of night.spawns) {
    const count = Math.max(1, Math.ceil(s.count * scale * (site.ceilingMul[s.id] ?? 1)));
    counts.push({ id: s.id, count });
  }
  // Site rules (PRD §5.4): a fauna the row lacks joins at its debut ceiling from `fromSol`.
  for (const early of site.earlyFauna) {
    const debut = DEBUT.get(early.id);
    if (night.sol < early.fromSol || debut === undefined || night.spawns.some((s) => s.id === early.id)) continue;
    counts.push({ id: early.id, count: Math.max(1, Math.ceil(debut * scale * (site.ceilingMul[early.id] ?? 1))) });
  }
  if (night.alpha !== null) counts.push({ id: night.alpha, count: 1 });
  return counts;
}

function total(counts: Counts): number {
  let n = 0;
  for (const c of counts) n += c.count;
  return n;
}

/** Tonight's routing state: which edge is the trickle and how many units it may still take. */
export class SwarmRouter {
  private main: readonly Edge[] = [];
  private trickle: Edge | -1 = -1;
  private budget = 0;
  private cursor = 0;

  /** Nightly plan; arms the trickle router for its units. */
  planNight(night: SwarmNight, scale: number, loudest: Edge, rng: Rng, site: SiteDef, rung: number): NightPlan {
    const want = Math.min(4, night.edges + (rung >= RUNG_EXTRA_EDGE_FROM ? 1 : 0));
    const others = rng.shuffle(ALL_EDGES.filter((e) => e !== loudest));
    const main: Edge[] = [loudest, ...others].slice(0, want);
    const counts = scaledCounts(night, scale, site);
    const edges: Edge[] = [...main];
    this.main = main;
    this.trickle = -1;
    this.budget = 0;
    this.cursor = 0;
    if (night.sol >= TRICKLE_FROM_SOL && main.length < 4) {
      const side: Edge[] = [((loudest + 1) % 4) as Edge, ((loudest + 3) % 4) as Edge].filter((e) => !main.includes(e));
      const pool = side.length > 0 ? side : ALL_EDGES.filter((e) => !main.includes(e));
      const trickle = pool[rng.int(0, pool.length - 1)];
      if (trickle !== undefined) {
        const trash = total(counts) - (night.alpha !== null ? 1 : 0);
        this.trickle = trickle;
        this.budget = Math.max(TRICKLE_MIN, Math.round(trash * TRICKLE_SHARE));
        edges.push(trickle);
      }
    }
    return { edges, counts, totalFauna: total(counts) };
  }

  /** Sol 10 drip from all four edges (`LONG_NIGHT` row); no trickle. */
  planLongNight(): NightPlan {
    this.disarm();
    const counts: Counts = LONG_NIGHT.spawns.map((s) => ({ id: s.id, count: s.count }));
    return { edges: ALL_EDGES, counts, totalFauna: total(counts) };
  }

  /** The Chorus (`CHORUS` row × `chorus.scale` × site `chorusMul`, site ceilings); the Titan is never scaled. */
  planChorus(scaleMul: number, site: SiteDef): NightPlan {
    this.disarm();
    const mul = scaleMul * site.chorusMul;
    const counts: Counts = CHORUS.spawns.map((s) => ({ id: s.id, count: Math.max(1, Math.ceil(s.count * mul * (site.ceilingMul[s.id] ?? 1))) }));
    if (CHORUS.alpha !== null) counts.push({ id: CHORUS.alpha, count: 1 });
    return { edges: ALL_EDGES, counts, totalFauna: total(counts) };
  }

  /** The edge a unit dealt to `edge` actually emerges from (trickle cap applied). */
  route(edge: Edge): Edge {
    if (edge !== this.trickle) return edge;
    if (this.budget > 0) {
      this.budget -= 1;
      return edge;
    }
    const e = this.main[this.cursor % Math.max(1, this.main.length)] ?? edge;
    this.cursor += 1;
    return e;
  }

  private disarm(): void {
    this.main = [];
    this.trickle = -1;
    this.budget = 0;
  }
}
