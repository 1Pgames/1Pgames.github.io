import { Economy } from '../../core/economy';
import type { GeneratorDef } from '../../core/economy';
import { Rng } from '../../core/rng';
import { ECONOMY_SPEC, MANAGER_BY_GENERATOR } from '../../slices/idle/content';
import { IDLE_TUNING } from '../../slices/idle/tuning';
import { finishFamily, hard, median, num, printTable, soft } from './types';
import type { FamilySimOptions, GateResult } from './types';

/**
 * Family F (idle tycoon) economy-curve gate. Run: `npm run sim -- --family idle`.
 *
 * WHAT IT GATES — that the curve in `slices/idle/tuning.ts` is a curve and not
 * a wall:
 *  - the first PRESTIGE is reachable in one sitting (15-35 minutes),
 *  - no DEAD AIR in the first ten minutes: there is always either something
 *    affordable to buy or a manual collect ready, so the player always has a
 *    verb (a >90s gap is the idle-game failure mode),
 *  - income keeps DOUBLING through the first twelve minutes,
 *  - offline earnings are non-zero at the cap (i.e. the run actually reaches
 *    automation — `Economy.incomePerSec` only counts managed tiers).
 *
 * HOW IT PLAYS — the floor strategy, on purpose: a greedy buyer that always
 * spends on the CHEAPEST affordable generator unit or manager, and taps every
 * un-managed tier whose manual cycle is full, throttled to 5 taps/second (the
 * fastest a thumb sustains). Taps roll `tapCritChance`/`tapCritMult` exactly as
 * `slices/idle/game.ts` does, which is the only randomness in the family — so
 * runs differ by seed only in crit luck.
 *
 * The clock ticks in 100ms steps, which is the granularity the cycle fills and
 * the tap throttle are measured at.
 */

/** Simulation step; also the resolution of the tap throttle and dead-air clock. */
const STEP_MS = 100;
/** Sustained manual tapping ceiling — one tap per 200ms. */
const TAP_INTERVAL_MS = 200;
/** Simulated ceiling: past this a "reachable in one sitting" prestige is moot. */
const HORIZON_MIN = 45;

/**
 * Prestige window, HARD at both ends.
 *
 * This bot plays the FASTEST possible first cycle — it spends every coin the
 * instant it can afford the cheapest thing and taps at the sustained human
 * ceiling of 5/s — so its time is a LOWER bound on a real player's. That is
 * exactly what makes both ends gateable:
 *  - ceiling: if optimal play cannot prestige in one sitting, nobody can;
 *  - floor: if optimal play prestiges EARLIER than the design floor, the
 *    unlock is trivial, because every slower player is bounded below by this
 *    bot's time, not above it.
 *
 * The floor used to be gated at `PRESTIGE_MIN / 2` — 6 bot-minutes — with the
 * real floor demoted to a soft warning "because an optimal bot beating it is
 * expected". That reasoning is backwards: the bot is the lower bound, so it is
 * the ONE player whose time the floor can be stated against. Halving it gated
 * nothing a human would ever notice.
 *
 * Human design floor is 15 min; the bot's instant spending and 5/s tapping
 * measure ~20-25% faster than sustained human play, so the bot-adjusted floor
 * is 12 bot-minutes ≈ 15 human-minutes.
 */
const PRESTIGE_MIN = 12;
const PRESTIGE_MAX = 35;
/**
 * Dead air is measured as consecutive steps in which the bot took NO action:
 * nothing was affordable and no manual cycle came up ready. (Sampling the
 * state AFTER the bot has spent its cash and drained every ready cycle would
 * report the busiest minute of the run as dead.)
 */
const MAX_DEAD_AIR_MS = 90_000;
/** Only the opening minutes are gated: that is where a stall loses the player. */
const DEAD_AIR_WINDOW_MIN = 10;
/** Income must at least double across every window this wide, for 12 minutes. */
const DOUBLING_WINDOW_MIN = 4;
const DOUBLING_HORIZON_MIN = 12;

interface MinuteSample {
  minute: number;
  cash: number;
  /** What every owned tier produces per second, manual tiers included. */
  incomePerSec: number;
  /** Automated share of that income — what offline earnings are paid from. */
  passivePerSec: number;
  purchases: number;
  managers: number;
}

interface RunResult {
  /** Minutes until `Economy.prestigeAvailable()`; `null` if never within the horizon. */
  prestigeMin: number | null;
  longestDeadAirMs: number;
  samples: MinuteSample[];
  offlineAtCap: number;
  managers: number;
  purchases: number;
}

/** Cheapest thing worth buying right now, or `null` when nothing is affordable. */
function cheapestPurchase(eco: Economy): { kind: 'generator' | 'manager'; id: string; cost: number } | null {
  let best: { kind: 'generator' | 'manager'; id: string; cost: number } | null = null;
  for (const def of eco.spec.generators) {
    if (!eco.isUnlocked(def.id)) continue;
    const cost = eco.buyCost(def.id, 1);
    if (cost <= eco.cash && (best === null || cost < best.cost)) best = { kind: 'generator', id: def.id, cost };
    const manager = MANAGER_BY_GENERATOR[def.id];
    if (manager === undefined || !eco.canBuyManager(manager.id)) continue;
    if (best === null || manager.cost < best.cost) best = { kind: 'manager', id: manager.id, cost: manager.cost };
  }
  return best;
}

/** Ready un-managed tier with the biggest pending payout, or `null`. */
function bestCollect(eco: Economy): GeneratorDef | null {
  let best: GeneratorDef | null = null;
  let bestValue = 0;
  for (const def of eco.spec.generators) {
    if (eco.ownedOf(def.id) <= 0 || eco.isAutomated(def.id)) continue;
    if (eco.collectReadyRatio(def.id) < 1) continue;
    const value = eco.generatorIncomePerSec(def.id) * (def.cycleMs / 1000);
    if (value > bestValue) {
      bestValue = value;
      best = def;
    }
  }
  return best;
}

function playRun(seed: string): RunResult {
  const eco = new Economy(ECONOMY_SPEC, IDLE_TUNING.startingCash);
  const rng = new Rng(seed);
  const samples: MinuteSample[] = [];

  let elapsedMs = 0;
  let sinceTapMs = TAP_INTERVAL_MS;
  let deadAirMs = 0;
  let longestDeadAirMs = 0;
  let purchases = 0;
  let prestigeMin: number | null = null;

  const sample = (): void => {
    samples.push({
      minute: elapsedMs / 60_000,
      cash: eco.cash,
      incomePerSec: eco.potentialIncomePerSec(),
      passivePerSec: eco.incomePerSec(),
      purchases,
      managers: eco.spec.managers.filter((def) => eco.hasManager(def.id)).length,
    });
  };
  sample();

  while (elapsedMs < HORIZON_MIN * 60_000) {
    eco.update(STEP_MS);
    elapsedMs += STEP_MS;
    sinceTapMs += STEP_MS;

    let acted = false;
    const ready = bestCollect(eco);
    if (ready !== null) {
      // A ready cycle is a verb even while the tap throttle holds it back.
      acted = true;
      if (sinceTapMs >= TAP_INTERVAL_MS) {
        sinceTapMs = 0;
        const base = eco.collect(ready.id);
        // Same crit roll the scene applies on a manual tap.
        if (base > 0 && rng.chance(IDLE_TUNING.tapCritChance)) {
          eco.credit(base * (IDLE_TUNING.tapCritMult - 1));
        }
      }
    }

    let purchase = cheapestPurchase(eco);
    while (purchase !== null) {
      const bought =
        purchase.kind === 'generator' ? eco.buy(purchase.id, 1) : eco.buyManager(purchase.id);
      if (!bought) break;
      acted = true;
      purchases += 1;
      purchase = cheapestPurchase(eco);
    }

    if (acted) {
      deadAirMs = 0;
    } else {
      deadAirMs += STEP_MS;
      if (deadAirMs > longestDeadAirMs && elapsedMs <= DEAD_AIR_WINDOW_MIN * 60_000) {
        longestDeadAirMs = deadAirMs;
      }
    }

    if (elapsedMs % 60_000 === 0) sample();
    if (prestigeMin === null && eco.prestigeAvailable()) {
      prestigeMin = elapsedMs / 60_000;
      break;
    }
  }

  if (samples[samples.length - 1]?.minute !== elapsedMs / 60_000) sample();

  return {
    prestigeMin,
    longestDeadAirMs,
    samples,
    offlineAtCap: eco.offlineEarnings(IDLE_TUNING.offlineCapHours * 3_600_000, IDLE_TUNING.offlineCapHours),
    managers: eco.spec.managers.filter((def) => eco.hasManager(def.id)).length,
    purchases,
  };
}

/** Compact money for a table cell: 1.2k, 340M, 5.1B. */
function money(value: number): string {
  const units: readonly [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k'],
  ];
  for (const [scale, suffix] of units) {
    if (value >= scale) return `${(value / scale).toFixed(1)}${suffix}`;
  }
  return value.toFixed(0);
}

/** Income at a whole-minute mark, or the last sample before it. */
function incomeAt(samples: readonly MinuteSample[], minute: number): number {
  let value = 0;
  for (const entry of samples) {
    if (entry.minute > minute + 1e-9) break;
    value = entry.incomePerSec;
  }
  return value;
}

export default function runFamilySim(options: FamilySimOptions): number {
  // Crit luck is the only stochastic input, so a handful of seeds already
  // brackets the curve; more would only re-measure the same purchase order.
  const runs = Math.max(1, Math.min(Math.floor(options.runs), 8));
  const results: RunResult[] = [];
  for (let run = 0; run < runs; run += 1) results.push(playRun(`${options.seed}:idle:${run}`));

  const reference = results[0] as RunResult;
  const prestigeTimes = results.map((result) => result.prestigeMin).filter((value): value is number => value !== null);
  const gates: GateResult[] = [];

  const prestigeMedian = median(prestigeTimes);
  gates.push(
    hard(
      prestigeTimes.length === results.length && prestigeMedian >= PRESTIGE_MIN && prestigeMedian <= PRESTIGE_MAX,
      `optimal-bot first prestige at ${num(prestigeMedian, 1)} min in ${prestigeTimes.length}/${results.length} ` +
        `runs (must be within [${PRESTIGE_MIN}, ${PRESTIGE_MAX}] bot-min; the floor is ≈15 human-min — ` +
        `move it with prestige.unlockAtTotalEarned, now ${IDLE_TUNING.prestige.unlockAtTotalEarned})`,
    ),
  );

  const worstDeadAir = Math.max(...results.map((result) => result.longestDeadAirMs));
  gates.push(
    hard(
      worstDeadAir <= MAX_DEAD_AIR_MS,
      `longest dead air in the first ${DEAD_AIR_WINDOW_MIN} min = ${num(worstDeadAir / 1000, 1)}s ` +
        `(must stay under ${MAX_DEAD_AIR_MS / 1000}s)`,
    ),
  );

  const stalledWindows: string[] = [];
  for (let minute = 0; minute + DOUBLING_WINDOW_MIN <= DOUBLING_HORIZON_MIN; minute += DOUBLING_WINDOW_MIN) {
    const from = incomeAt(reference.samples, minute);
    const to = incomeAt(reference.samples, minute + DOUBLING_WINDOW_MIN);
    if (!(to >= from * 2)) {
      stalledWindows.push(`${minute}-${minute + DOUBLING_WINDOW_MIN}min x${num(from > 0 ? to / from : 0, 1)}`);
    }
  }
  gates.push(
    soft(
      stalledWindows.length === 0,
      stalledWindows.length === 0
        ? `income at least doubles every ${DOUBLING_WINDOW_MIN} min through minute ${DOUBLING_HORIZON_MIN}`
        : `income failed to double in: ${stalledWindows.join(', ')}`,
    ),
  );

  const offline = median(results.map((result) => result.offlineAtCap));
  gates.push(
    soft(
      offline > 0,
      `offline earnings at the ${IDLE_TUNING.offlineCapHours}h cap = ${money(offline)} from ` +
        `${median(results.map((result) => result.managers))} manager(s) (0 means automation was never bought)`,
    ),
  );

  const render = (): void => {
    printTable(
      ['minute', 'cash', 'income/s', 'passive/s', 'purchases', 'managers'],
      reference.samples
        .filter((_entry, index) => index % 2 === 0 || index === reference.samples.length - 1)
        .map((entry) => [
          num(entry.minute, 1),
          money(entry.cash),
          money(entry.incomePerSec),
          money(entry.passivePerSec),
          String(entry.purchases),
          String(entry.managers),
        ]),
    );
    console.log(
      `\n${runs} run(s), seed '${options.seed}'; curve above is run 0. ` +
        `Prestige (${IDLE_TUNING.prestige.unlockAtTotalEarned} earned) at ` +
        `${prestigeTimes.map((value) => num(value, 1)).join(' / ')} min.`,
    );
  };

  return finishFamily(options, gates, render, {
    family: 'idle',
    runs,
    prestigeMinutes: results.map((result) => result.prestigeMin),
    longestDeadAirMs: worstDeadAir,
    offlineAtCap: offline,
    samples: reference.samples,
  });
}
