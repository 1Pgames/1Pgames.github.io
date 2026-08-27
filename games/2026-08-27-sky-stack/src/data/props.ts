import { PALETTE } from '../config';

/**
 * Impassable arena props and flat floor decals. Data only: the arena system
 * places them, gives props a static circular body, and never asks what they are.
 *
 * `texture` keys come from the generated prop art (`assets/generated/props/*`).
 * When a texture is missing the arena falls back to a tinted procedural square,
 * so a game can ship before its art run finishes.
 *
 * Pure data, no Phaser import.
 */

export interface PropDef {
  id: string;
  texture: string;
  /** Display size in px (art is square). */
  size: number;
  /** Collision circle diameter as a fraction of `size` — art has margins. */
  bodyScale: number;
  /** Relative spawn weight. */
  weight: number;
  /** Tint used only by the procedural fallback square. */
  fallbackTint: number;
}

export const PROPS: readonly PropDef[] = [
  { id: 'rock', texture: 'prop-rock', size: 130, bodyScale: 0.62, weight: 40, fallbackTint: PALETTE.inkSoft },
  { id: 'crystal', texture: 'prop-crystal', size: 140, bodyScale: 0.5, weight: 22, fallbackTint: PALETTE.primary },
  { id: 'pillar', texture: 'prop-pillar', size: 150, bodyScale: 0.5, weight: 20, fallbackTint: PALETTE.accent },
  { id: 'stump', texture: 'prop-stump', size: 132, bodyScale: 0.58, weight: 18, fallbackTint: 0x8a5a3b },
] as const;

export interface DecalDef {
  texture: string;
  size: number;
  alpha: number;
  weight: number;
}

/** Flat, non-colliding floor decoration. Purely visual. */
export const DECALS: readonly DecalDef[] = [
  // Kept dim on purpose: floor decoration must never compete with pickups.
  { texture: 'arena-cracks', size: 230, alpha: 0.34, weight: 60 },
  { texture: 'arena-plate', size: 200, alpha: 0.28, weight: 40 },
] as const;
