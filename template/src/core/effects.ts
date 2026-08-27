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
}

export function createEffectState(): EffectState {
  return { hpCapRatio: null, killIframesMs: 0, knockbackMul: 1 };
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
};

/** Runs the hook for `effectId` if one is registered; no-op otherwise (pure stat cards leave `effect` undefined). */
export function applyEffect(effectId: string, ctx: EffectContext, state: EffectState): void {
  EFFECT_HOOKS[effectId]?.(ctx, state);
}
