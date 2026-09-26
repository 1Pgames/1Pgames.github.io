import { Rng } from './rng';
import { MUTATORS } from '../data/mutators';
import type { HazardLevel, MutatorId, ZoneId } from '../data/types-v2';
import { highestUnlockedHazard } from './progression';

/**
 * Daily Rite & Weekly Rift (PRD-V2 §5.24): the period key, zone, hazard,
 * mutators and seed of today's / this week's shared run. Pure given `now`
 * and the save (`highestUnlockedHazard` reads it); rewards and streaks are
 * settled by `core/progression.ts settleRun`.
 *
 * - Daily: seed = local date; zone rotates castle → outlands → desert →
 *   winter by day index; hazard = highest unlocked in that zone − 1 (min H1);
 *   2 seeded mutators.
 * - Weekly: seed = ISO week; zone = week % 4; H4 (H3 if H4 locked there);
 *   3 seeded mutators.
 */

const ZONE_ROTATION: readonly ZoneId[] = ['castle', 'outlands', 'desert', 'winter'];

export interface RiteInfo { zone: ZoneId; hazard: HazardLevel; mutators: MutatorId[]; seed: string }

/** Local calendar day `YYYY-MM-DD` — a streak breaks at the player's midnight, not UTC's. */
export function localDayKey(now: Date): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/** Whole days since 1970-01-01 for a local date (DST-proof: computed on the calendar date, not the clock). */
function dayIndex(now: Date): number {
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
}

/** Local day key of the day before `day` (`YYYY-MM-DD`). */
export function previousDayKey(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return localDayKey(new Date(y, m - 1, d - 1));
}

/** ISO-8601 week of the local date: `{ year, week }` (weeks start Monday; week 1 holds the year's first Thursday). */
function isoWeek(now: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

/** `YYYY-Www`, e.g. `2026-W39`. */
export function isoWeekKey(now: Date): string {
  const { year, week } = isoWeek(now);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The seeded mutator draw of a Rite/Rift seed (`daily:<day>` → 2, `weekly:<week>` → 3). */
export function riteMutators(seed: string, count: number): MutatorId[] {
  const pool = MUTATORS.map((m) => m.id);
  new Rng(`mutators:${seed}`).shuffle(pool);
  return pool.slice(0, count);
}

/** §16.1 E32. */
export function dailyInfo(now: Date): RiteInfo & { day: string } {
  const day = localDayKey(now);
  const zone = ZONE_ROTATION[dayIndex(now) % ZONE_ROTATION.length]!;
  const hazard = Math.max(1, highestUnlockedHazard(zone) - 1) as HazardLevel;
  const seed = `daily:${day}`;
  return { day, zone, hazard, mutators: riteMutators(seed, 2), seed };
}

/** §16.1 E32. */
export function weeklyInfo(now: Date): RiteInfo & { week: string } {
  const week = isoWeekKey(now);
  const zone = ZONE_ROTATION[isoWeek(now).week % ZONE_ROTATION.length]!;
  const hazard: HazardLevel = highestUnlockedHazard(zone) >= 4 ? 4 : 3;
  const seed = `weekly:${week}`;
  return { week, zone, hazard, mutators: riteMutators(seed, 3), seed };
}
