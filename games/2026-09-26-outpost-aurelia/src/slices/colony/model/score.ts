/**
 * Landing settlement (PRD §9, §10, §16.1 `LandingResult`) and the ONE place a
 * Landing is banked: Data, run stats, stars, the next Severity rung, the
 * daily best and the Hub LOG journal. `settleLanding` (every live ending,
 * abandon included) and `settlePendingLanding` (a recovered checkpoint) both
 * go through `bank`; GameOver only displays the result. `computeLanding` is the
 * non-banking twin for headless runs.
 */
import type { SessionOutcome } from '../../../core/session';
import { COLONY_TUNING } from '../tuning';
import { bestStars, grantCurrency, grantUnlock, hasUnlock, recordRunResult, recordStars } from '../../../core/progression';
import { loadDailyBest, saveDailyBest } from '../../../core/daily';
import { load, save } from '../../../core/storage';
import { KITS, KIT_NONE, SITES } from '../content';
import type { LandingResult, LandingSetup } from '../contracts';
import { colonyStat } from './modifiers';
import type { ColonyState } from './state';

export type { LandingResult } from '../contracts';

/** Storage key of the unbanked in-flight Landing (§14b laws 5-6). */
const ACTIVE_LANDING_KEY = 'colony:activeLanding';
/** Hub LOG journal: newest-first settled Landings (read by `scenes/hub`). */
const LOG_KEY = 'colony:log';
const LOG_CAP = 30;
/** Highest Severity rung (PRD §5.4: r = 1-5). */
const MAX_RUNG = 5;

interface PendingLanding { result: LandingResult; setup: LandingSetup }
interface LogEntry { siteId: string; rung: number; reason: string; won: boolean; sols: number; data: number; stars: number; at: number }

/** A settled checkpoint and the Landing it came from (RETRY replays `setup`). */
export interface SettledLanding { result: LandingResult; setup: LandingSetup }

export function starsFor(state: ColonyState, outcome: SessionOutcome, _elapsedSec: number): 0 | 1 | 2 | 3 {
  if (!outcome.won) return 0;
  const people = state.colonists + state.deathsTotal;
  const saved = people > 0 ? state.colonists / people : 0;
  let stars = 1;
  if (saved >= COLONY_TUNING.meta.starColonistShare) stars += 1;
  if (state.clock.phase !== 'long-night') stars += 1;
  return stars as 1 | 2 | 3;
}

/** True once today's daily Landing has banked its Data (PRD §9: one paid daily per day; replays are practice). */
export function dailyPaid(): boolean {
  return loadDailyBest() !== null;
}

/**
 * Banks a result once. The checkpoint key is cleared FIRST (§14b law 5): a
 * storage failure mid-bank can lose part of one payout but can never re-bank
 * it on the next boot. Then stats, Data (skipped for a practice daily), stars
 * (`newStars`), the next rung (`unlockedRung`), the daily best and the LOG
 * entry. Mutates `result`'s three banking fields.
 */
function bank(result: LandingResult, daily: boolean): LandingResult {
  save(ACTIVE_LANDING_KEY, null);
  result.practice = daily && dailyPaid();
  recordRunResult({ won: result.won, score: result.data.total, timeMs: Math.round(result.timeSec * 1000) }, { bestTimeMode: 'off' });
  if (result.data.total > 0 && !result.practice) grantCurrency(result.data.total);
  const starKey = `${result.siteId}:${result.rung}`;
  const before = bestStars(starKey);
  if (result.stars > before) recordStars(starKey, result.stars);
  result.newStars = Math.max(0, result.stars - before);
  const next = result.rung + 1;
  const rungKey = `rung:${result.siteId}:${next}`;
  if (result.won && next <= MAX_RUNG && !hasUnlock(rungKey)) {
    grantUnlock(rungKey);
    result.unlockedRung = next;
  }
  if (daily) saveDailyBest(result.data.total);
  const log = load<LogEntry[]>(LOG_KEY, []);
  const entry: LogEntry = { siteId: result.siteId, rung: result.rung, reason: result.reason, won: result.won, sols: result.solsSurvived, data: result.practice ? 0 : result.data.total, stars: result.stars, at: Date.now() };
  save(LOG_KEY, [entry, ...(Array.isArray(log) ? log : [])].slice(0, LOG_CAP));
  return result;
}

/**
 * The result a Landing settles to, WITHOUT banking (no storage reads or
 * writes): `newStars` 0, `unlockedRung` null, `practice` false. Headless
 * callers (sims, selftests) use this through `ColonyDirector`'s `{ bank: false }`.
 */
export function computeLanding(state: ColonyState, outcome: SessionOutcome, elapsedSec: number): LandingResult {
  return buildResult(state, outcome, elapsedSec);
}

/** Settles and banks a finished Landing (called once, by `ColonyDirector.finish`). */
export function settleLanding(state: ColonyState, outcome: SessionOutcome, elapsedSec: number): LandingResult {
  return bank(buildResult(state, outcome, elapsedSec), state.setup.daily);
}

/** Writes the result an abandon would settle to, unbanked, plus its setup, so a killed tab still pays out (§14b law 6). */
export function checkpointLanding(state: ColonyState, elapsedSec: number): void {
  const pending: PendingLanding = { result: buildResult(state, { won: false, reason: 'abandoned' }, elapsedSec), setup: state.setup };
  save(ACTIVE_LANDING_KEY, pending);
}

/**
 * Banks a stored checkpoint once (same path as `settleLanding`), clears the
 * key and returns it with its Landing setup; null when none. The site and kit
 * rows are re-resolved by id so a recovered Landing replays today's content.
 */
export function settlePendingLanding(): SettledLanding | null {
  const pending = load<PendingLanding | null>(ACTIVE_LANDING_KEY, null);
  if (pending === null || typeof pending !== 'object' || !('result' in pending) || !('setup' in pending)) {
    if (pending !== null) save(ACTIVE_LANDING_KEY, null);
    return null;
  }
  const stored = pending.setup;
  const setup: LandingSetup = {
    ...stored,
    site: SITES.find((s) => s.id === stored.site.id) ?? stored.site,
    kit: [KIT_NONE, ...KITS].find((k) => k.id === stored.kit.id) ?? stored.kit,
  };
  return { result: bank(pending.result, setup.daily), setup };
}

function buildResult(state: ColonyState, outcome: SessionOutcome, elapsedSec: number): LandingResult {
  const M = COLONY_TUNING.meta;
  const solsSurvived = Math.max(0, state.clock.sol - 1);
  // PRD §9: × (1 + 0.15 × (rung − 1)) × site.dataMul × Ark/Refit `data.mul`.
  const mul = (1 + M.severityDataStep * Math.max(0, state.rung - 1)) * state.site.dataMul * colonyStat(state, 'data.mul', 1);
  const data = {
    base: M.dataBase,
    sols: M.dataPerSol * solsSurvived,
    win: outcome.won ? M.dataWin : 0,
    orders: state.ordersData,
    relics: state.relicData,
    trophies: M.dataMatron * state.matronsKilled,
    mul,
    total: 0,
  };
  data.total = Math.round((data.base + data.sols + data.win + data.orders + data.relics + data.trophies) * data.mul);
  return {
    won: outcome.won,
    reason: outcome.reason,
    siteId: state.site.id,
    rung: state.rung,
    solsSurvived,
    timeSec: elapsedSec,
    colonistsSaved: state.colonists,
    colonistsLost: state.deathsTotal,
    data,
    stars: starsFor(state, outcome, elapsedSec),
    newStars: 0,
    unlockedRung: null,
    practice: false,
    directives: [...state.owned],
    protocols: [...state.evolved],
  };
}
