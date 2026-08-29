import { TUNING } from '../config';
import type { Player } from '../objects/player';

/**
 * Data-driven hooks for `UpgradeDef.effect` legendary cards: a stat-only
 * `Modifier` can't lock max HP to a ratio or grant temporary i-frames on
 * kill, so those two cards each get one behavioral hook here instead of an
 * `if (effect === '...')` chain in the scene or combat system.
 *
 * `EFFECT_HOOKS[id]` runs once, immediately when the card is picked
 * (`GameScene.applyUpgrade`); anything that must persist for the rest of the
 * run (glass-cannon's HP cap, glass-cannon's kill i-frames, bulwark's
 * knockback multiplier) is read back out of `EffectState` by the systems
 * that need it, keyed by the same id.
 */

export interface EffectContext {
  player: Player;
}

/** Per-run state a hook needs other systems to observe (combat, damage). Reset each run by the scene. */
export interface EffectState {
  /** Set by `glass-cannon`: max HP is locked to this ratio of the base cap; heals never exceed it. */
  hpCapRatio: number | null;
  /** Set by `glass-cannon`: i-frame duration granted for `TUNING.effects.glassCannon.killIframesMs` after a kill. */
  killIframesMs: number;
  /** Set by `bulwark`: multiplies `TUNING.player.contactKnockback`. */
  knockbackMul: number;
  /**
   * Set by `last-gasp`: how many lethal blows are still refusable. Consumed by
   * `CombatSystem.damagePlayer`, which is the ONLY place a run can end by
   * damage — a revive registered anywhere else would be bypassable by the
   * hazard and Collapse drains that write `health.hp` directly.
   */
  lastGaspCharges: number;
  /** Fraction of max HP the revive restores. */
  lastGaspReviveRatio: number;
  /** Grace period granted on revive, so the blow that killed you cannot re-kill you. */
  lastGaspIframesMs: number;
}

export function createEffectState(): EffectState {
  return {
    hpCapRatio: null,
    killIframesMs: 0,
    knockbackMul: 1,
    lastGaspCharges: 0,
    lastGaspReviveRatio: 0,
    lastGaspIframesMs: 0,
  };
}

const EFFECT_HOOKS: Record<string, (ctx: EffectContext, state: EffectState) => void> = {
  'glass-cannon': (ctx, state) => {
    const cfg = TUNING.effects.glassCannon;
    state.hpCapRatio = cfg.hpCapRatio;
    state.killIframesMs = cfg.killIframesMs;
    const cap = ctx.player.health.max * cfg.hpCapRatio;
    if (ctx.player.health.hp > cap) ctx.player.health.hp = cap;
  },
  bulwark: (_ctx, state) => {
    state.knockbackMul = TUNING.effects.bulwark.knockbackMul;
  },
  'last-gasp': (_ctx, state) => {
    const cfg = TUNING.effects.lastGasp;
    // Stack limit 1 (§5.3), so this is a set, not an increment.
    state.lastGaspCharges = 1;
    state.lastGaspReviveRatio = cfg.reviveHpRatio;
    state.lastGaspIframesMs = cfg.iframesMs;
  },
};

/** Runs the hook for `effectId` if one is registered; no-op otherwise (pure stat cards leave `effect` undefined). */
export function applyEffect(effectId: string, ctx: EffectContext, state: EffectState): void {
  EFFECT_HOOKS[effectId]?.(ctx, state);
}
