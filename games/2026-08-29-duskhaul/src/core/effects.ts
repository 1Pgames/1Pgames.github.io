import { TUNING } from '../config';
import { FILLER } from '../data/upgrades';
import type { Player } from '../objects/player';

/**
 * Data-driven hooks for `UpgradeDef.effect` legendary cards: a stat-only
 * `Modifier` cannot refuse a lethal blow, so a card whose rule is behavioural
 * gets one hook here instead of an `if (effect === '...')` chain in the scene
 * or the combat system.
 *
 * `EFFECT_HOOKS[id]` runs once, immediately when the card is picked
 * (`GameScene.applyUpgrade`); anything that must persist for the rest of the
 * run is read back out of `EffectState` by the system that needs it, keyed by
 * the same id.
 *
 * One hook per behavioural card in the §5.10 pool: `last-gasp`
 * (`fx_lastgasp`) and the two fillers `fill-bread` / `fill-purse`, which are
 * one-shot and keep no state. A future behavioural card adds its hook here
 * and its `effect` id on the row in the same change — never one without the
 * other.
 */

export interface EffectContext {
  player: Player;
  /** Adds run shards (◆) to the carried haul — `fill_purse`. */
  grantShards(amount: number): void;
}

/** Per-run state a hook needs other systems to observe (combat, damage). Reset each run by the scene. */
export interface EffectState {
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
    lastGaspCharges: 0,
    lastGaspReviveRatio: 0,
    lastGaspIframesMs: 0,
  };
}

const EFFECT_HOOKS: Record<string, (ctx: EffectContext, state: EffectState) => void> = {
  'last-gasp': (_ctx, state) => {
    const cfg = TUNING.effects.lastGasp;
    // The card is maxStacks 1, but it ADDS to a Sanctum Last Rite charge (`m_revive`)
    // instead of overwriting it, and never downgrades Undying Husk's (`b_undying`) terms.
    state.lastGaspCharges += 1;
    state.lastGaspReviveRatio = Math.max(state.lastGaspReviveRatio, cfg.reviveHpRatio);
    state.lastGaspIframesMs = Math.max(state.lastGaspIframesMs, cfg.iframesMs);
  },
  'fill-bread': (ctx) => {
    ctx.player.health.heal(ctx.player.health.max * FILLER.breadHealPct);
  },
  'fill-purse': (ctx) => {
    ctx.grantShards(FILLER.purseShards);
  },
};

/** Runs the hook for `effectId` if one is registered; no-op otherwise (pure stat cards leave `effect` undefined). */
export function applyEffect(effectId: string, ctx: EffectContext, state: EffectState): void {
  EFFECT_HOOKS[effectId]?.(ctx, state);
}
