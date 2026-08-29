import { PALETTE } from '../config';
import type { ArtSlot } from './art';
import type { ZoneId } from './zones';

/**
 * Impassable arena props and flat floor decals, PER ZONE (§11: no procedural
 * art for gameplay). Data only: the arena system places them, gives props a
 * static circular body, and never asks what they are.
 *
 * Every row addresses one cell of a real generated 3x3 prop sheet through the
 * same `{ key, frame }` `ArtSlot` shape `systems/zone.ts` uses for hazard art,
 * so a prop is a drawn object with mass rather than a tinted rectangle. The
 * eighteen authored cells of a zone (`art/briefs/zone-<id>.md`) are split by
 * what the brief says each cell IS: masses with a footprint become `props`
 * (they block), ground-level flats become `decals` (they do not). Cells the
 * hazard system already owns are RESERVED and appear in neither list — a
 * brazier or an ice sheet scattered as scenery would lie about danger.
 *
 * Geometry is measured, not guessed: `cell` is the frame's `alignedBox` from
 * that sheet's `sprite-metadata.json` — the pixels the art actually occupies
 * inside its 256px cell. `footprint` is the intended on-field size of the
 * art's LONG axis in world px, authored from the brief's mass language
 * (strongest occluder / largest mass ~175, smallest blocker ~115). From those
 * two, `size` (the display size of the whole cell) and `bodyScale` (collision
 * diameter as a fraction of `size`) fall out, so the circle body matches the
 * sprite's SHORT axis instead of its transparent margins.
 *
 * `fallbackTint` survives for crash-safety only: with the sheet absent the
 * arena still draws a tinted square rather than a missing-texture box. The
 * shipping path resolves real art.
 *
 * Pure data, no Phaser import.
 */

export interface PropDef {
  id: string;
  texture: string;
  /** Cell of the prop sheet, absent for a single-image texture. */
  frame?: string | number;
  /** Display size in px of the whole (square) sheet cell. */
  size: number;
  /** Collision circle diameter as a fraction of `size` — art has margins. */
  bodyScale: number;
  /** Relative spawn weight. */
  weight: number;
  /** Tint used only by the procedural fallback square. */
  fallbackTint: number;
}

export interface DecalDef {
  id: string;
  texture: string;
  frame?: string | number;
  size: number;
  alpha: number;
  weight: number;
}

/** Side length of one prop-sheet cell, from the sheets' `cellSize` export. */
const CELL_PX = 256;

/**
 * A prop-sheet cell as authored: which frame, the pixels it occupies inside
 * the cell, how big its long axis should read on the field, and how often it
 * is drawn.
 */
interface CellRow {
  id: string;
  art: ArtSlot;
  /** `alignedBox` [width, height] from the sheet's `sprite-metadata.json`. */
  cell: readonly [number, number];
  /** Intended on-field length of the art's LONG axis, in world px. */
  footprint: number;
  weight: number;
}

/**
 * Widest sensible collision circle for a prop. A cell whose art is nearly
 * square would otherwise take a body as wide as its whole display size, and
 * pixel art keeps a little air around its silhouette.
 */
const MAX_BODY_SCALE = 0.68;
/** Narrowest body: a long thin prop must still be worth walking around. */
const MIN_BODY_SCALE = 0.34;

const round2 = (n: number): number => Math.round(n * 100) / 100;

function toProp(row: CellRow, fallbackTint: number): PropDef {
  const [w, h] = row.cell;
  // Display the cell so the art's long axis lands on the authored footprint.
  const size = Math.round((row.footprint * CELL_PX) / Math.max(w, h));
  // Body follows the SHORT axis: a wide low prop should not block the empty
  // space above and below its own silhouette.
  const bodyScale = round2(Math.min(MAX_BODY_SCALE, Math.max(MIN_BODY_SCALE, Math.min(w, h) / CELL_PX)));
  return {
    id: row.id,
    texture: row.art.key,
    ...(row.art.frame === undefined ? {} : { frame: row.art.frame }),
    size,
    bodyScale,
    weight: row.weight,
    fallbackTint,
  };
}

function toDecal(row: CellRow, alpha: number): DecalDef {
  const [w, h] = row.cell;
  return {
    id: row.id,
    texture: row.art.key,
    ...(row.art.frame === undefined ? {} : { frame: row.art.frame }),
    size: Math.round((row.footprint * CELL_PX) / Math.max(w, h)),
    alpha,
    weight: row.weight,
  };
}

/**
 * Floor decoration is dimmed, but not much: these are drawn objects with their
 * own outline and values, and below ~0.5 they wash out into pale ghosts that
 * read as film over the floor rather than debris lying ON it. Kept under 1 so
 * decoration still sits behind pickups and props in the read.
 */
const DECAL_ALPHA = 0.62;

// --- Bleakspire Keep -------------------------------------------------------
// Reserved for hazards: props-castle-a 0 `brazier-lit` / 1 `brazier-cold`.
const CASTLE_PROPS: readonly CellRow[] = [
  { id: 'coffin', art: { key: 'props-castle-a', frame: 3 }, cell: [207, 101], footprint: 160, weight: 10 },
  { id: 'pew', art: { key: 'props-castle-a', frame: 4 }, cell: [206, 124], footprint: 150, weight: 10 },
  { id: 'rubble', art: { key: 'props-castle-a', frame: 5 }, cell: [200, 87], footprint: 115, weight: 16 },
  { id: 'torch', art: { key: 'props-castle-a', frame: 6 }, cell: [82, 181], footprint: 130, weight: 12 },
  { id: 'statue', art: { key: 'props-castle-a', frame: 7 }, cell: [132, 175], footprint: 170, weight: 8 },
  { id: 'font', art: { key: 'props-castle-b', frame: 0 }, cell: [182, 138], footprint: 140, weight: 8 },
  { id: 'candles', art: { key: 'props-castle-b', frame: 2 }, cell: [170, 164], footprint: 125, weight: 8 },
  { id: 'tomb', art: { key: 'props-castle-b', frame: 3 }, cell: [220, 147], footprint: 175, weight: 6 },
  { id: 'fence', art: { key: 'props-castle-b', frame: 4 }, cell: [206, 123], footprint: 155, weight: 10 },
  { id: 'column', art: { key: 'props-castle-b', frame: 5 }, cell: [142, 184], footprint: 165, weight: 9 },
  { id: 'shrine', art: { key: 'props-castle-b', frame: 6 }, cell: [152, 151], footprint: 135, weight: 5 },
  { id: 'hook', art: { key: 'props-castle-b', frame: 7 }, cell: [147, 169], footprint: 125, weight: 7 },
  { id: 'shield', art: { key: 'props-castle-b', frame: 8 }, cell: [160, 152], footprint: 130, weight: 8 },
];
const CASTLE_DECALS: readonly CellRow[] = [
  { id: 'banner', art: { key: 'props-castle-a', frame: 2 }, cell: [220, 92], footprint: 170, weight: 34 },
  { id: 'bones', art: { key: 'props-castle-a', frame: 8 }, cell: [207, 94], footprint: 150, weight: 40 },
  { id: 'gatepiece', art: { key: 'props-castle-b', frame: 1 }, cell: [218, 108], footprint: 175, weight: 26 },
];

// --- Ashen Outlands --------------------------------------------------------
// Reserved for hazards: props-outlands-a 7 `mudpool` (bonestorm slick) and
// props-outlands-b 2 `vent` (the ash source itself).
const OUTLANDS_PROPS: readonly CellRow[] = [
  { id: 'ribcage', art: { key: 'props-outlands-a', frame: 0 }, cell: [217, 129], footprint: 175, weight: 8 },
  { id: 'gibbet', art: { key: 'props-outlands-a', frame: 1 }, cell: [142, 192], footprint: 165, weight: 8 },
  { id: 'bramble', art: { key: 'props-outlands-a', frame: 2 }, cell: [220, 127], footprint: 145, weight: 14 },
  { id: 'cart', art: { key: 'props-outlands-a', frame: 4 }, cell: [216, 152], footprint: 175, weight: 7 },
  { id: 'cairn', art: { key: 'props-outlands-a', frame: 5 }, cell: [187, 167], footprint: 140, weight: 12 },
  { id: 'tree', art: { key: 'props-outlands-a', frame: 6 }, cell: [174, 177], footprint: 170, weight: 10 },
  { id: 'cage', art: { key: 'props-outlands-b', frame: 0 }, cell: [215, 110], footprint: 150, weight: 8 },
  { id: 'scarecrow', art: { key: 'props-outlands-b', frame: 1 }, cell: [150, 158], footprint: 150, weight: 7 },
  { id: 'bonefence', art: { key: 'props-outlands-b', frame: 3 }, cell: [199, 107], footprint: 150, weight: 10 },
  { id: 'milestone', art: { key: 'props-outlands-b', frame: 4 }, cell: [184, 137], footprint: 120, weight: 12 },
  { id: 'perch', art: { key: 'props-outlands-b', frame: 5 }, cell: [122, 152], footprint: 130, weight: 9 },
  { id: 'tent', art: { key: 'props-outlands-b', frame: 6 }, cell: [220, 125], footprint: 155, weight: 8 },
  { id: 'firepit', art: { key: 'props-outlands-b', frame: 7 }, cell: [220, 166], footprint: 145, weight: 6 },
  { id: 'shrine-ash', art: { key: 'props-outlands-b', frame: 8 }, cell: [180, 134], footprint: 130, weight: 5 },
];
const OUTLANDS_DECALS: readonly CellRow[] = [
  { id: 'dune', art: { key: 'props-outlands-a', frame: 3 }, cell: [214, 79], footprint: 190, weight: 55 },
  { id: 'wheel', art: { key: 'props-outlands-a', frame: 8 }, cell: [182, 142], footprint: 150, weight: 45 },
];

// --- Sorrow Dunes ----------------------------------------------------------
// Reserved for hazards: props-desert-a 4 `pit` (sinksand).
const DESERT_PROPS: readonly CellRow[] = [
  { id: 'statuehead', art: { key: 'props-desert-a', frame: 0 }, cell: [183, 118], footprint: 170, weight: 8 },
  { id: 'well', art: { key: 'props-desert-a', frame: 1 }, cell: [182, 113], footprint: 140, weight: 9 },
  { id: 'canopy', art: { key: 'props-desert-a', frame: 2 }, cell: [184, 138], footprint: 165, weight: 8 },
  { id: 'ribs', art: { key: 'props-desert-a', frame: 3 }, cell: [185, 107], footprint: 160, weight: 9 },
  { id: 'obelisk', art: { key: 'props-desert-a', frame: 5 }, cell: [161, 141], footprint: 170, weight: 8 },
  { id: 'urns', art: { key: 'props-desert-a', frame: 6 }, cell: [182, 109], footprint: 115, weight: 14 },
  { id: 'palm', art: { key: 'props-desert-a', frame: 7 }, cell: [168, 142], footprint: 155, weight: 10 },
  { id: 'skulls', art: { key: 'props-desert-a', frame: 8 }, cell: [187, 101], footprint: 115, weight: 14 },
  { id: 'wreck', art: { key: 'props-desert-b', frame: 0 }, cell: [214, 120], footprint: 180, weight: 6 },
  { id: 'sunbanner', art: { key: 'props-desert-b', frame: 1 }, cell: [167, 151], footprint: 155, weight: 8 },
  { id: 'mound', art: { key: 'props-desert-b', frame: 2 }, cell: [220, 89], footprint: 160, weight: 10 },
  { id: 'lintel', art: { key: 'props-desert-b', frame: 4 }, cell: [210, 139], footprint: 170, weight: 8 },
  { id: 'vulture', art: { key: 'props-desert-b', frame: 6 }, cell: [181, 138], footprint: 130, weight: 8 },
  { id: 'awning', art: { key: 'props-desert-b', frame: 7 }, cell: [208, 134], footprint: 160, weight: 7 },
  { id: 'shrine-sun', art: { key: 'props-desert-b', frame: 8 }, cell: [197, 139], footprint: 135, weight: 5 },
];
const DESERT_DECALS: readonly CellRow[] = [
  { id: 'cistern', art: { key: 'props-desert-b', frame: 3 }, cell: [214, 81], footprint: 165, weight: 50 },
  // Salt crust is the widest flat in the game; drawn at 200px and randomly
  // rotated it reads as debris rather than ground, so it is kept short.
  { id: 'salt', art: { key: 'props-desert-b', frame: 5 }, cell: [212, 65], footprint: 170, weight: 50 },
];

// --- Widow's Crown ---------------------------------------------------------
// Reserved: props-winter-a 0 `torchring` (gale shelter) and 3 `icesheet`
// (slide hazard), plus props-winter-b 5 `webpatch`, which is the Frost Widow's
// slow field — scattering it as scenery would fake a live mechanic.
const WINTER_PROPS: readonly CellRow[] = [
  { id: 'frozencorpse', art: { key: 'props-winter-a', frame: 1 }, cell: [193, 174], footprint: 150, weight: 10 },
  { id: 'frozenwell', art: { key: 'props-winter-a', frame: 5 }, cell: [216, 136], footprint: 145, weight: 9 },
  { id: 'pine', art: { key: 'props-winter-a', frame: 6 }, cell: [192, 184], footprint: 180, weight: 10 },
  { id: 'sled', art: { key: 'props-winter-a', frame: 7 }, cell: [213, 106], footprint: 170, weight: 8 },
  { id: 'icicle', art: { key: 'props-winter-a', frame: 8 }, cell: [217, 130], footprint: 120, weight: 14 },
  { id: 'bellshrine', art: { key: 'props-winter-b', frame: 0 }, cell: [219, 176], footprint: 175, weight: 6 },
  { id: 'frostcairn', art: { key: 'props-winter-b', frame: 1 }, cell: [218, 154], footprint: 140, weight: 12 },
  { id: 'fountain', art: { key: 'props-winter-b', frame: 2 }, cell: [206, 154], footprint: 160, weight: 7 },
  { id: 'buriedgate', art: { key: 'props-winter-b', frame: 3 }, cell: [219, 152], footprint: 170, weight: 6 },
  { id: 'lantern', art: { key: 'props-winter-b', frame: 4 }, cell: [144, 176], footprint: 130, weight: 9 },
  { id: 'bonetree', art: { key: 'props-winter-b', frame: 6 }, cell: [159, 174], footprint: 165, weight: 9 },
  { id: 'stormstone', art: { key: 'props-winter-b', frame: 7 }, cell: [217, 162], footprint: 180, weight: 7 },
  { id: 'shrine-ice', art: { key: 'props-winter-b', frame: 8 }, cell: [216, 139], footprint: 135, weight: 5 },
];
const WINTER_DECALS: readonly CellRow[] = [
  { id: 'drift', art: { key: 'props-winter-a', frame: 4 }, cell: [220, 101], footprint: 195, weight: 60 },
  { id: 'wallshard', art: { key: 'props-winter-a', frame: 2 }, cell: [208, 139], footprint: 150, weight: 40 },
];

/**
 * Fallback tint per zone, used only when that zone's prop sheets are absent.
 * One tone per zone is enough: this path is crash-safety, not a look.
 */
const ZONE_FALLBACK_TINT: Record<ZoneId, number> = {
  castle: PALETTE.inkSoft,
  outlands: PALETTE.bgBottom,
  desert: PALETTE.accent,
  winter: PALETTE.primary,
};

/** Impassable props, per zone. `systems/zone.ts` hands the right set to `Arena`. */
export const PROPS_BY_ZONE: Record<ZoneId, readonly PropDef[]> = {
  castle: CASTLE_PROPS.map((row) => toProp(row, ZONE_FALLBACK_TINT.castle)),
  outlands: OUTLANDS_PROPS.map((row) => toProp(row, ZONE_FALLBACK_TINT.outlands)),
  desert: DESERT_PROPS.map((row) => toProp(row, ZONE_FALLBACK_TINT.desert)),
  winter: WINTER_PROPS.map((row) => toProp(row, ZONE_FALLBACK_TINT.winter)),
};

/** Flat, non-colliding floor decoration, per zone. Purely visual. */
export const DECALS_BY_ZONE: Record<ZoneId, readonly DecalDef[]> = {
  castle: CASTLE_DECALS.map((row) => toDecal(row, DECAL_ALPHA)),
  outlands: OUTLANDS_DECALS.map((row) => toDecal(row, DECAL_ALPHA)),
  desert: DESERT_DECALS.map((row) => toDecal(row, DECAL_ALPHA)),
  winter: WINTER_DECALS.map((row) => toDecal(row, DECAL_ALPHA)),
};

/**
 * What `Arena` scatters when no zone supplied a set (a bare `new Arena` with
 * no layout, e.g. a harness or a non-zone slice). The starting zone's set:
 * real art, and the one set every build is guaranteed to have loaded.
 */
export const PROPS: readonly PropDef[] = PROPS_BY_ZONE.castle;
export const DECALS: readonly DecalDef[] = DECALS_BY_ZONE.castle;
