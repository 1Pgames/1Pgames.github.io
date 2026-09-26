import { PALETTE } from '../config';

/**
 * Impassable world props and flat floor decals. Data only: `systems/mapgen.ts`
 * places them (singly, never heaped — see its header), `systems/arena.ts`
 * draws them and gives props a static circular body.
 *
 * A prop KIND is one `id`: the variety rules (same kind ≥ `arena.sameKindPx`
 * apart, ≥ 3 kinds per screen) count ids. The template ships 4 placeholder
 * sheets as 8 kinds (base + a larger, regraded, mirrored variant each); a game's
 * art run replaces these rows with its own sheets — the composition floor is
 * ≥ 40 kinds per zone (`game-prd` genre-playbooks §Taste floors), which only
 * real art can meet.
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
  /**
   * Drawn-art circle diameter as a fraction of `size` (the sheet's opaque bbox,
   * measured). Mapgen keeps ≥ `arena.propGap` between these circles: sprite
   * overlap is 0 by construction.
   */
  artScale: number;
  /** Relative spawn weight. */
  weight: number;
  /** Tint used only by the procedural fallback square. */
  fallbackTint: number;
  /** Multiply grade for a variant row (neutral hues only: red/green belong to outlines). */
  grade?: number;
  /** Variant rows mirror the sheet so they do not read as a copy. */
  flipX?: boolean;
}

/** Opaque-bbox share of the 256 px cell for the four template prop sheets (all ~220 px). */
const PROP_ART = 0.86;

export const PROPS: readonly PropDef[] = [
  { id: 'rock', texture: 'prop-rock', size: 130, bodyScale: 0.62, artScale: PROP_ART, weight: 40, fallbackTint: PALETTE.inkSoft },
  { id: 'boulder', texture: 'prop-rock', size: 188, bodyScale: 0.6, artScale: PROP_ART, weight: 24, fallbackTint: PALETTE.inkSoft, grade: 0xb4b2b8, flipX: true },
  { id: 'crystal', texture: 'prop-crystal', size: 140, bodyScale: 0.5, artScale: PROP_ART, weight: 22, fallbackTint: PALETTE.primary },
  { id: 'crystal-spire', texture: 'prop-crystal', size: 196, bodyScale: 0.46, artScale: PROP_ART, weight: 14, fallbackTint: PALETTE.primary, grade: 0xa8b0c8, flipX: true },
  { id: 'pillar', texture: 'prop-pillar', size: 150, bodyScale: 0.5, artScale: PROP_ART, weight: 20, fallbackTint: PALETTE.accent },
  { id: 'obelisk', texture: 'prop-pillar', size: 206, bodyScale: 0.46, artScale: PROP_ART, weight: 12, fallbackTint: PALETTE.accent, grade: 0xbab4ac, flipX: true },
  { id: 'stump', texture: 'prop-stump', size: 132, bodyScale: 0.58, artScale: PROP_ART, weight: 18, fallbackTint: 0x8a5a3b },
  { id: 'old-stump', texture: 'prop-stump', size: 178, bodyScale: 0.56, artScale: PROP_ART, weight: 12, fallbackTint: 0x8a5a3b, grade: 0xa8a4a0, flipX: true },
] as const;

export interface DecalDef {
  id: string;
  texture: string;
  size: number;
  /** ≤ 0.45 (composition floor): decals sit in the floor's value band, never over actors' key forms. */
  alpha: number;
  weight: number;
}

/** Flat, non-colliding floor decoration. Purely visual; the arena bakes them desaturated into the floor grade. */
export const DECALS: readonly DecalDef[] = [
  // Kept dim on purpose: floor decoration must never compete with pickups.
  { id: 'cracks', texture: 'arena-cracks', size: 230, alpha: 0.34, weight: 60 },
  { id: 'plate', texture: 'arena-plate', size: 200, alpha: 0.28, weight: 40 },
] as const;

/** Art-circle radius of a prop kind (what the no-overlap rule keeps apart). */
export function propArtRadius(def: PropDef): number {
  return (def.size * def.artScale) / 2;
}

/** Collision radius of a prop kind. */
export function propBodyRadius(def: PropDef): number {
  return (def.size * def.bodyScale) / 2;
}
