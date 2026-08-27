/**
 * Health pool and damage resolution shared by anything that can take damage:
 * player, enemies (survivor-like swarms, roguelike rooms), towers/base HP in
 * tower defense, units in tactics. Pairs with `core/stats.ts` — `rollDamage`
 * reads the attacker's `damage` / `critChance` / `critMul` stat keys so a
 * build's crit stacking "just works" without bespoke combat code per game.
 *
 * Do NOT use this for pure UI health bars with no gameplay consequence (a
 * cosmetic loading bar) — this is specifically damage/death/heal state.
 *
 * Pure TypeScript, no Phaser import.
 */

import type { StatBlock } from './stats';
import type { Rng } from './rng';

export interface DamageEvent {
  amount: number;
  crit: boolean;
  source: string;
}

export class Health {
  hp: number;
  max: number;

  /** Duration of post-hit invulnerability, in ms. 0 disables i-frames. */
  invulnMs = 0;
  private lastHitAt = -Infinity;
  private dead = false;

  constructor(max: number) {
    this.max = max;
    this.hp = max;
  }

  /**
   * Applies damage. Returns true the call that brings hp to 0 (death), false
   * otherwise — including every call after death, so it is safe to call again
   * on an already-dead entity without side effects.
   */
  apply(ev: DamageEvent): boolean {
    if (this.dead) return false;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.invulnMs > 0 && now - this.lastHitAt < this.invulnMs) return false;
    this.lastHitAt = now;
    this.hp = Math.max(0, this.hp - ev.amount);
    if (this.hp === 0) {
      this.dead = true;
      return true;
    }
    return false;
  }

  heal(n: number): void {
    if (this.dead) return;
    this.hp = Math.min(this.max, this.hp + n);
  }

  /** Raises/lowers the cap. `keepRatio` rescales current hp to match the new cap. */
  setMax(n: number, keepRatio = true): void {
    const ratio = keepRatio && this.max > 0 ? this.hp / this.max : 1;
    this.max = n;
    this.hp = this.dead ? 0 : Math.min(n, n * ratio);
  }

  get ratio(): number {
    return this.max > 0 ? this.hp / this.max : 0;
  }
}

/**
 * Rolls one hit from an attacker's stats: base `damage`, then `critChance`
 * (0..1) to double-or-multiply by `critMul` (default 2x if the stat is absent).
 */
export function rollDamage(stats: StatBlock, rng: Rng, source: string): DamageEvent {
  const base = stats.get('damage');
  const critChance = stats.get('critChance');
  const crit = rng.chance(critChance);
  const critMul = stats.get('critMul') || 2;
  const amount = crit ? base * critMul : base;
  return { amount, crit, source };
}

/** Applies one damage-over-time tick scaled to elapsed time (poison, burn, bleed). */
export function applyDot(health: Health, dps: number, deltaMs: number, source: string): boolean {
  const amount = dps * (deltaMs / 1000);
  return health.apply({ amount, crit: false, source });
}
