import { DECALS, PROPS, type DecalDef, type PropDef } from './props';

/**
 * What a generated world is made of — the data `systems/mapgen.ts
 * generateWorld` composes. Numbers (size, densities, spacings) live in
 * `TUNING.arena`; this file names the CONTENT: which props and decals exist,
 * whether roads are laid, which landmarks and POI anchors the game wants.
 *
 * Regions/roads/landmarks/POIs are optional BY DATA. The template has no
 * landmark art and no POI gameplay, so `landmarks` and `pois` are empty and the
 * generator lays roads, props, decals and the floor only. A game fills them:
 *   - `pois`: anchor rules (chest, shrine, lair, …) — the generator returns
 *     `GeneratedWorld.pois` placed along roads, ~2-3 screens apart, each inside
 *     its own clearing, in its depth band; the game's scene spawns the actual
 *     object at each anchor;
 *   - `landmarks`: big single props at road junctions, each on a plaza.
 *
 * Pure data, no Phaser import.
 */

export interface PoiRule {
  /** Game-defined anchor kind (`'chest'`, `'shrine'`, …); copied onto every anchor. */
  kind: string;
  count: number;
  /** Clearing radius kept free of props and decals around the anchor. */
  radius: number;
  /**
   * Depth band the anchor may sit in (`depthAt`: 0 = spawn, 1 = world edge).
   * Richer/deadlier kinds go deeper: loot and danger rise toward the edges.
   */
  depth: readonly [min: number, max: number];
}

export interface LandmarkDef {
  /** A `PropDef.id` from `WorldDef.props` — a big, unique silhouette. */
  propId: string;
  /** Plaza radius kept free around it. */
  plaza: number;
}

export interface WorldDef {
  id: string;
  props: readonly PropDef[];
  decals: readonly DecalDef[];
  /** Lay a road network (MST over spawn + road nodes + landmarks, a few loops). */
  roads: boolean;
  landmarks: readonly LandmarkDef[];
  pois: readonly PoiRule[];
}

/** The template arena's world: roads, the placeholder prop/decal rows, no landmarks, no POIs. */
export const WORLD: WorldDef = {
  id: 'arena',
  props: PROPS,
  decals: DECALS,
  roads: true,
  landmarks: [],
  pois: [],
};
