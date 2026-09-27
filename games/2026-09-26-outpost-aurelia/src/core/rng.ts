/**
 * Deterministic RNG. Use this (not Math.random) for anything that must be
 * reproducible: daily seeds, replayable runs, level layouts you want to re-record.
 */
export class Rng {
  private state: number;

  constructor(seed: number | string = Date.now()) {
    this.state = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** mulberry32 — 2^32 period, fast, good enough for gameplay. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error('Rng.pick: empty array');
    return item;
  }

  /** Weighted pick. `weights` must match `items` length; zero weights are skipped. */
  pickWeighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i += 1) {
      roll -= weights[i] ?? 0;
      if (roll <= 0) {
        const item = items[i];
        if (item !== undefined) return item;
      }
    }
    return this.pick(items);
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      const a = items[i]!;
      const b = items[j]!;
      items[i] = b;
      items[j] = a;
    }
    return items;
  }
}

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seed shared by everyone playing on the same calendar day (daily-challenge runs). */
export function dailySeed(): string {
  return new Date().toISOString().slice(0, 10);
}
