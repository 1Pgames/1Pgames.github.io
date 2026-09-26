import { PALETTE } from '../config';
import type { ArtSlot } from './art';
import type { ZoneId } from './types-v2';

/**
 * Blocking props, landmarks and flat floor decals, PER ZONE (PRD-V2 §3.5,
 * §11). Data only: `systems/mapgen.ts` decides WHERE (by role), `systems/arena.ts`
 * draws them and gives each a static circular body; neither asks what a prop IS.
 *
 * Every row addresses one cell of a generated sheet (`props-<zone>-a|b` V1
 * sheets, `props-<zone>-c` V2 wall/pillar/monolith sheet, `landmarks-<zone>`
 * 512 px landmark sheet). Geometry is measured, not guessed: `cell` is the
 * frame's `alignedBox` [w, h] from that sheet's `sprite-metadata.json` (V2
 * values: `art/briefs/v2-world/tables.md`), `footprint` the on-field length of
 * the art's LONG axis. From those, `size` (display size of the whole cell) and
 * `bodyRadius` (collision circle following the art's SHORT axis) fall out.
 *
 * `role` is what mapgen composes with (§3.5 archetypes): wall runs use
 * `wall`/`fence` segments capped by `post`s, groves/rubble use `rubble` +
 * `misc`, graveyards `grave`, monolith clusters `monolith` (the large `-l`
 * variants only). `top` is the frame-exact upper half on
 * `props-<zone>-tall-top` for Y-sort occlusion (§3.7), drawn with the SAME
 * position/size/rotation as the base. `light` marks light-emitting props that
 * receive a lighting pool (§3.7).
 *
 * Cells a hazard owns (braziers, pits, ice, torch rings, vents, mud, webs)
 * are RESERVED and appear nowhere here — scenery must never fake a mechanic.
 *
 * Pure data, no Phaser import.
 */

export type PropRole = 'wall' | 'fence' | 'post' | 'corner' | 'rubble' | 'grave' | 'monolith' | 'misc' | 'landmark';

export interface PropDef {
  id: string;
  texture: string;
  frame?: string | number;
  /** Display size in px of the whole (square) sheet cell. */
  size: number;
  /** Collision circle radius in world px (≤ `TUNING.mapgen.maxBodyRadius`). */
  bodyRadius: number;
  /**
   * Radius of the drawn art (half its long-axis footprint): mapgen keeps
   * these circles apart so blocker sprites never overlap.
   */
  visualR: number;
  role: PropRole;
  /** Silhouette class for the variety rules (no two of a class crowd a chunk). */
  shape: string;
  /** Relative pick weight inside its role. */
  weight: number;
  /** Y-sort upper half (§3.7); present ⇒ the prop is `tall`. */
  top?: ArtSlot;
  /** Tall without a separate top sheet (landmark towers): Y-sorted only. */
  tall: boolean;
  light: boolean;
  /** Tint used only by the procedural fallback square. */
  fallbackTint: number;
}

/**
 * Where a decal belongs (mapgen composes debris, it never scatters it):
 * `road` — beside a road (cart wheels); `prop` — at the foot of blocking
 * masses and landmarks (bones, fallen banners, shards); `any` — either, plus
 * the open-floor debris spots the cluster pass marks.
 */
export type DecalNear = 'road' | 'prop' | 'any';

export interface DecalDef {
  id: string;
  texture: string;
  frame?: string | number;
  size: number;
  alpha: number;
  weight: number;
  near: DecalNear;
  /** `free`: any rotation (bones, rubble, drifts); `upright`: an object with an obvious up, ±15° only. */
  spin: 'free' | 'upright';
}

interface DecalRow {
  id: string;
  art: ArtSlot;
  cell: readonly [number, number];
  footprint: number;
  weight: number;
  near: DecalNear;
  spin: 'free' | 'upright';
}

interface CellRow {
  id: string;
  art: ArtSlot;
  cell: readonly [number, number];
  footprint: number;
  weight: number;
  role: PropRole;
  top?: ArtSlot;
  tall?: boolean;
  light?: boolean;
  /** Silhouette class; defaults to the role (each `misc` prop is its own class). */
  shape?: string;
  /** Measured collision radius from the art table; else derived from the cell. */
  body?: number;
}

/** Widest / narrowest sensible collision circle, as a fraction of display size. */
const MAX_BODY_SCALE = 0.68;
const MIN_BODY_SCALE = 0.34;
/** §3.2 hard rule: no single blocker body radius > 190 px. */
const MAX_BODY_RADIUS = 170;

function toProp(row: CellRow, cellPx: number, fallbackTint: number): PropDef {
  const [w, h] = row.cell;
  const size = Math.round((row.footprint * cellPx) / Math.max(w, h));
  // Body follows the SHORT axis so a wide low prop does not block empty air.
  const bodyScale = Math.min(MAX_BODY_SCALE, Math.max(MIN_BODY_SCALE, Math.min(w, h) / cellPx));
  return {
    id: row.id,
    texture: row.art.key,
    ...(row.art.frame === undefined ? {} : { frame: row.art.frame }),
    size,
    bodyRadius: Math.min(MAX_BODY_RADIUS, row.body ?? Math.round((size * bodyScale) / 2)),
    visualR: Math.round(row.footprint / 2),
    role: row.role,
    shape: row.shape ?? (row.role === 'misc' ? row.id : row.role),
    weight: row.weight,
    ...(row.top === undefined ? {} : { top: row.top }),
    tall: row.top !== undefined || row.tall === true,
    light: row.light === true,
    fallbackTint,
  };
}

function toDecal(row: DecalRow, alpha: number): DecalDef {
  const [w, h] = row.cell;
  return {
    id: row.id,
    texture: row.art.key,
    ...(row.art.frame === undefined ? {} : { frame: row.art.frame }),
    size: Math.round((row.footprint * 256) / Math.max(w, h)),
    alpha,
    weight: row.weight,
    near: row.near,
    spin: row.spin,
  };
}

/**
 * Floor decoration alpha (user bug: decals read as noise competing with
 * enemies). At 0.4 over the graded floor, debris stays inside the floor's
 * value band; `systems/arena.ts` also bakes decals desaturated and darkened.
 */
const DECAL_ALPHA = 0.4;

const slot = (key: string, frame: number): ArtSlot => ({ key, frame });

/**
 * The V2 `props-<zone>-c` sheet in its fixed cell order (tables.md): wall,
 * wall-corner, wall-broken, tall pillar/tree, rubble, grave, monolith, post,
 * fence. `tops` maps a -c cell to its tall-top frame; the large monolith
 * variant (`-l`, §3.2 "monolith (1 large)") reuses cell 6 at 260 px.
 */
function cSheet(
  zone: ZoneId,
  ids: readonly [string, string, string, string, string, string, string, string, string],
  cells: readonly (readonly [number, number])[],
  footprints: readonly number[],
  tops: Readonly<Record<number, number>>,
  lightCells: readonly number[],
): CellRow[] {
  const roles: readonly PropRole[] = ['wall', 'corner', 'wall', 'post', 'rubble', 'grave', 'misc', 'post', 'fence'];
  const rows: CellRow[] = ids.map((id, i) => {
    const topFrame = tops[i];
    return {
      id: `${zone}-${id}`,
      art: slot(`props-${zone}-c`, i),
      cell: cells[i]!,
      footprint: footprints[i]!,
      weight: 10,
      role: roles[i]!,
      ...(topFrame === undefined ? {} : { top: slot(`props-${zone}-tall-top`, topFrame) }),
      ...(lightCells.includes(i) ? { light: true } : {}),
    };
  });
  const mono = rows[6]!;
  rows.push({ ...mono, id: `${mono.id}-l`, footprint: 260, role: 'monolith' });
  return rows;
}

// --- Bleakspire Keep -------------------------------------------------------
// Reserved for hazards: props-castle-a 0 `brazier-lit` / 1 `brazier-cold`.
const CASTLE_PROPS: readonly CellRow[] = [
  ...cSheet(
    'castle',
    ['wall-straight', 'wall-corner', 'wall-broken', 'pillar', 'rubble-heap', 'gravestone', 'monolith', 'lamppost', 'ironfence'],
    [[216, 139], [201, 124], [161, 152], [88, 186], [212, 121], [110, 149], [112, 163], [83, 185], [198, 135]],
    [190, 180, 165, 165, 135, 115, 170, 130, 160],
    { 0: 0, 1: 1, 3: 2, 6: 3, 7: 4 },
    [7],
  ),
  { id: 'coffin', art: slot('props-castle-a', 3), cell: [207, 101], footprint: 160, weight: 10, role: 'misc' },
  { id: 'pew', art: slot('props-castle-a', 4), cell: [206, 124], footprint: 150, weight: 10, role: 'misc' },
  { id: 'rubble', art: slot('props-castle-a', 5), cell: [200, 87], footprint: 115, weight: 16, role: 'rubble' },
  { id: 'torch', art: slot('props-castle-a', 6), cell: [82, 181], footprint: 130, weight: 12, role: 'post', top: slot('props-castle-tall-top', 5), light: true },
  { id: 'statue', art: slot('props-castle-a', 7), cell: [132, 175], footprint: 170, weight: 8, role: 'misc', top: slot('props-castle-tall-top', 6) },
  { id: 'font', art: slot('props-castle-b', 0), cell: [182, 138], footprint: 140, weight: 8, role: 'misc' },
  { id: 'candles', art: slot('props-castle-b', 2), cell: [170, 164], footprint: 125, weight: 8, role: 'misc', light: true },
  { id: 'tomb', art: slot('props-castle-b', 3), cell: [220, 147], footprint: 175, weight: 6, role: 'grave' },
  { id: 'fence', art: slot('props-castle-b', 4), cell: [206, 123], footprint: 155, weight: 10, role: 'fence' },
  { id: 'column', art: slot('props-castle-b', 5), cell: [142, 184], footprint: 165, weight: 9, role: 'post', top: slot('props-castle-tall-top', 7) },
  { id: 'shrine', art: slot('props-castle-b', 6), cell: [152, 151], footprint: 135, weight: 5, role: 'misc' },
  { id: 'hook', art: slot('props-castle-b', 7), cell: [147, 169], footprint: 125, weight: 7, role: 'misc', top: slot('props-castle-tall-top', 8) },
  { id: 'shield', art: slot('props-castle-b', 8), cell: [160, 152], footprint: 130, weight: 8, role: 'misc' },
];
// `gatepiece` (props-castle-b 1) reads as a solid object: dropped from the floor.
const CASTLE_DECALS: readonly DecalRow[] = [
  { id: 'banner', art: slot('props-castle-a', 2), cell: [220, 92], footprint: 150, weight: 34, near: 'prop', spin: 'upright' },
  { id: 'bones', art: slot('props-castle-a', 8), cell: [207, 94], footprint: 130, weight: 50, near: 'any', spin: 'free' },
];

// --- Ashen Outlands --------------------------------------------------------
// Reserved: props-outlands-a 7 `mudpool`, props-outlands-b 2 `vent`.
const OUTLANDS_PROPS: readonly CellRow[] = [
  ...cSheet(
    'outlands',
    ['logwall', 'palisade-corner', 'palisade-broken', 'deadtree', 'stonepile', 'gravemarker', 'spiralstone', 'gibbetpost', 'bonefence'],
    [[205, 86], [220, 135], [201, 123], [173, 209], [217, 90], [108, 143], [154, 144], [130, 182], [203, 111]],
    [180, 180, 170, 175, 135, 115, 165, 150, 160],
    { 1: 0, 2: 1, 3: 2, 6: 3, 7: 4 },
    [],
  ),
  { id: 'ribcage', art: slot('props-outlands-a', 0), cell: [217, 129], footprint: 175, weight: 8, role: 'misc' },
  { id: 'gibbet', art: slot('props-outlands-a', 1), cell: [142, 192], footprint: 165, weight: 8, role: 'post', top: slot('props-outlands-tall-top', 5) },
  { id: 'bramble', art: slot('props-outlands-a', 2), cell: [220, 127], footprint: 145, weight: 14, role: 'rubble' },
  { id: 'cart', art: slot('props-outlands-a', 4), cell: [216, 152], footprint: 175, weight: 7, role: 'misc' },
  { id: 'cairn', art: slot('props-outlands-a', 5), cell: [187, 167], footprint: 140, weight: 12, role: 'rubble' },
  { id: 'tree', art: slot('props-outlands-a', 6), cell: [174, 177], footprint: 170, weight: 10, role: 'misc', top: slot('props-outlands-tall-top', 6) },
  { id: 'cage', art: slot('props-outlands-b', 0), cell: [215, 110], footprint: 150, weight: 8, role: 'misc' },
  { id: 'scarecrow', art: slot('props-outlands-b', 1), cell: [150, 158], footprint: 150, weight: 7, role: 'misc', top: slot('props-outlands-tall-top', 7) },
  { id: 'bonefence', art: slot('props-outlands-b', 3), cell: [199, 107], footprint: 150, weight: 10, role: 'fence' },
  { id: 'milestone', art: slot('props-outlands-b', 4), cell: [184, 137], footprint: 120, weight: 12, role: 'grave' },
  { id: 'perch', art: slot('props-outlands-b', 5), cell: [122, 152], footprint: 130, weight: 9, role: 'post', top: slot('props-outlands-tall-top', 8) },
  { id: 'tent', art: slot('props-outlands-b', 6), cell: [220, 125], footprint: 155, weight: 8, role: 'misc' },
  { id: 'firepit', art: slot('props-outlands-b', 7), cell: [220, 166], footprint: 145, weight: 6, role: 'misc', light: true },
  { id: 'shrine-ash', art: slot('props-outlands-b', 8), cell: [180, 134], footprint: 130, weight: 5, role: 'misc', light: true },
];
// The cart wheel is an object: it only lies beside roads, nearly upright.
const OUTLANDS_DECALS: readonly DecalRow[] = [
  { id: 'dune', art: slot('props-outlands-a', 3), cell: [214, 79], footprint: 170, weight: 55, near: 'any', spin: 'upright' },
  { id: 'wheel', art: slot('props-outlands-a', 8), cell: [182, 142], footprint: 120, weight: 30, near: 'road', spin: 'upright' },
];

// --- Sorrow Dunes ----------------------------------------------------------
// Reserved: props-desert-a 4 `pit` (sinksand).
const DESERT_PROPS: readonly CellRow[] = [
  ...cSheet(
    'desert',
    ['mudwall', 'mudwall-corner', 'mudwall-broken', 'lotuscolumn', 'sandrubble', 'stele', 'sunidol', 'cagepost', 'ribfence'],
    [[215, 105], [210, 142], [219, 102], [135, 181], [220, 99], [187, 126], [182, 146], [125, 171], [219, 131]],
    [185, 180, 160, 165, 135, 115, 165, 150, 160],
    { 0: 0, 1: 1, 3: 2, 6: 3, 7: 4 },
    [],
  ),
  { id: 'statuehead', art: slot('props-desert-a', 0), cell: [183, 118], footprint: 170, weight: 8, role: 'misc' },
  { id: 'well', art: slot('props-desert-a', 1), cell: [182, 113], footprint: 140, weight: 9, role: 'misc' },
  { id: 'canopy', art: slot('props-desert-a', 2), cell: [184, 138], footprint: 165, weight: 8, role: 'misc' },
  { id: 'ribs', art: slot('props-desert-a', 3), cell: [185, 107], footprint: 160, weight: 9, role: 'rubble' },
  { id: 'obelisk', art: slot('props-desert-a', 5), cell: [161, 141], footprint: 170, weight: 8, role: 'post', top: slot('props-desert-tall-top', 5) },
  { id: 'urns', art: slot('props-desert-a', 6), cell: [182, 109], footprint: 115, weight: 14, role: 'rubble' },
  { id: 'palm', art: slot('props-desert-a', 7), cell: [168, 142], footprint: 155, weight: 10, role: 'misc', top: slot('props-desert-tall-top', 6) },
  { id: 'skulls', art: slot('props-desert-a', 8), cell: [187, 101], footprint: 115, weight: 14, role: 'rubble' },
  { id: 'wreck', art: slot('props-desert-b', 0), cell: [214, 120], footprint: 180, weight: 6, role: 'misc' },
  { id: 'sunbanner', art: slot('props-desert-b', 1), cell: [167, 151], footprint: 155, weight: 8, role: 'post', top: slot('props-desert-tall-top', 7), light: true },
  { id: 'mound', art: slot('props-desert-b', 2), cell: [220, 89], footprint: 160, weight: 10, role: 'rubble' },
  { id: 'lintel', art: slot('props-desert-b', 4), cell: [210, 139], footprint: 170, weight: 8, role: 'misc' },
  { id: 'vulture', art: slot('props-desert-b', 6), cell: [181, 138], footprint: 130, weight: 8, role: 'misc', top: slot('props-desert-tall-top', 8) },
  { id: 'awning', art: slot('props-desert-b', 7), cell: [208, 134], footprint: 160, weight: 7, role: 'misc' },
  { id: 'shrine-sun', art: slot('props-desert-b', 8), cell: [197, 139], footprint: 135, weight: 5, role: 'misc', light: true },
];
// `cistern` (props-desert-b 3) reads as a solid object: dropped from the floor.
const DESERT_DECALS: readonly DecalRow[] = [
  { id: 'salt', art: slot('props-desert-b', 5), cell: [212, 65], footprint: 160, weight: 50, near: 'any', spin: 'free' },
];

// --- Widow's Crown ---------------------------------------------------------
// Reserved: props-winter-a 0 `torchring`, 3 `icesheet`; props-winter-b 5 `webpatch`.
const WINTER_PROPS: readonly CellRow[] = [
  ...cSheet(
    'winter',
    ['frostwall', 'frostwall-corner', 'frostwall-broken', 'snowpine', 'snowrubble', 'frostgrave', 'icemonolith', 'lanternpost', 'icefence'],
    [[215, 121], [217, 135], [192, 126], [142, 206], [220, 111], [149, 138], [145, 177], [113, 177], [211, 150]],
    [185, 180, 160, 180, 135, 115, 170, 130, 160],
    { 0: 0, 1: 1, 3: 2, 6: 3, 7: 4 },
    [7],
  ),
  { id: 'frozencorpse', art: slot('props-winter-a', 1), cell: [193, 174], footprint: 150, weight: 10, role: 'misc' },
  { id: 'frozenwell', art: slot('props-winter-a', 5), cell: [216, 136], footprint: 145, weight: 9, role: 'misc' },
  { id: 'pine', art: slot('props-winter-a', 6), cell: [192, 184], footprint: 180, weight: 10, role: 'misc', top: slot('props-winter-tall-top', 5) },
  { id: 'sled', art: slot('props-winter-a', 7), cell: [213, 106], footprint: 170, weight: 8, role: 'misc' },
  { id: 'icicle', art: slot('props-winter-a', 8), cell: [217, 130], footprint: 120, weight: 14, role: 'rubble' },
  { id: 'bellshrine', art: slot('props-winter-b', 0), cell: [219, 176], footprint: 175, weight: 6, role: 'misc', top: slot('props-winter-tall-top', 6), light: true },
  { id: 'frostcairn', art: slot('props-winter-b', 1), cell: [218, 154], footprint: 140, weight: 12, role: 'rubble' },
  { id: 'fountain', art: slot('props-winter-b', 2), cell: [206, 154], footprint: 160, weight: 7, role: 'misc' },
  { id: 'buriedgate', art: slot('props-winter-b', 3), cell: [219, 152], footprint: 170, weight: 6, role: 'misc' },
  { id: 'lantern', art: slot('props-winter-b', 4), cell: [144, 176], footprint: 130, weight: 9, role: 'post', top: slot('props-winter-tall-top', 7), light: true },
  { id: 'bonetree', art: slot('props-winter-b', 6), cell: [159, 174], footprint: 165, weight: 9, role: 'misc', top: slot('props-winter-tall-top', 8) },
  { id: 'stormstone', art: slot('props-winter-b', 7), cell: [217, 162], footprint: 180, weight: 7, role: 'rubble' },
  { id: 'shrine-ice', art: slot('props-winter-b', 8), cell: [216, 139], footprint: 135, weight: 5, role: 'misc' },
];
const WINTER_DECALS: readonly DecalRow[] = [
  { id: 'drift', art: slot('props-winter-a', 4), cell: [220, 101], footprint: 180, weight: 60, near: 'any', spin: 'free' },
  { id: 'wallshard', art: slot('props-winter-a', 2), cell: [208, 139], footprint: 130, weight: 40, near: 'prop', spin: 'free' },
];

/**
 * Landmarks (§3.5): one 512 px cell per stamp id, sheet order = §3.5 table
 * order, footprints from tables.md (towers 380 and Y-sorted, the rest 440).
 */
function landmarkRows(zone: ZoneId, ids: readonly string[], cells: readonly (readonly [number, number])[], tall: readonly number[]): CellRow[] {
  return ids.map((id, i) => ({
    id,
    art: slot(`landmarks-${zone}`, i),
    cell: cells[i]!,
    footprint: tall.includes(i) ? 380 : 440,
    weight: 1,
    role: 'landmark' as const,
    tall: tall.includes(i),
    light: true,
  }));
}

export const LANDMARK_IDS: Record<ZoneId, readonly string[]> = {
  castle: ['lm-belltower', 'lm-ossuary', 'lm-chapelruin', 'lm-barracks', 'lm-cistern', 'lm-gallowsyard', 'lm-cryptmouth', 'lm-rampartbreach', 'lm-thronecourt'],
  outlands: ['lm-gibbetrow', 'lm-ribcage', 'lm-mudcamp', 'lm-windmill', 'lm-carrionfield', 'lm-bonebridge', 'lm-burnedfarm', 'lm-standingstones', 'lm-ashpit'],
  desert: ['lm-sunkenhead', 'lm-drywell', 'lm-shadecanopy', 'lm-obelisk', 'lm-caravanwreck', 'lm-tombgate', 'lm-dunespine', 'lm-saltflat', 'lm-scarabmound'],
  winter: ['lm-frozenshrine', 'lm-torchcircle', 'lm-icecavern', 'lm-widowspire', 'lm-corpselake', 'lm-brokenwall', 'lm-pineclutch', 'lm-yetiden', 'lm-crownsteps'],
};

const LANDMARK_ROWS: Record<ZoneId, CellRow[]> = {
  castle: landmarkRows('castle', LANDMARK_IDS.castle, [[256, 371], [383, 319], [322, 354], [440, 340], [348, 262], [379, 363], [262, 356], [368, 348], [300, 357]], [0]),
  outlands: landmarkRows('outlands', LANDMARK_IDS.outlands, [[410, 389], [439, 316], [437, 300], [319, 434], [440, 287], [424, 310], [421, 359], [436, 362], [432, 265]], [0, 3]),
  desert: landmarkRows('desert', LANDMARK_IDS.desert, [[420, 260], [369, 272], [392, 291], [294, 361], [424, 253], [406, 312], [403, 298], [440, 216], [430, 242]], [3]),
  winter: landmarkRows('winter', LANDMARK_IDS.winter, [[308, 330], [370, 321], [370, 312], [216, 397], [430, 225], [440, 305], [366, 375], [384, 305], [320, 336]], [3, 6]),
};

/** Fallback tint per zone, used only when a sheet is absent (crash-safety, not a look). */
const ZONE_FALLBACK_TINT: Record<ZoneId, number> = {
  castle: PALETTE.inkSoft,
  outlands: PALETTE.bgBottom,
  desert: PALETTE.accent,
  winter: PALETTE.primary,
};

/**
 * Standalone blockers (user request: more, different, single blockers) —
 * `props-<zone>-d|e` sheets, rows from `art/briefs/v3-props-{a,b}/tables.md`
 * (footprint, measured body radius, shape class, tall-top pair). All are
 * `misc` so mapgen places them singly through its variety picker.
 */
const V3_ROWS: Record<ZoneId, readonly CellRow[]> = {
  castle: [
    { id: 'castle-obelisk', art: slot('props-castle-d', 0), cell: [99, 187], footprint: 120, weight: 10, role: 'misc', shape: 'tall', body: 48, top: slot('props-castle-d-tall-top', 0) },
    { id: 'castle-fallen-column', art: slot('props-castle-d', 1), cell: [191, 134], footprint: 190, weight: 10, role: 'misc', shape: 'wide', body: 90 },
    { id: 'castle-cauldron', art: slot('props-castle-d', 2), cell: [124, 142], footprint: 130, weight: 10, role: 'misc', shape: 'round', body: 60 },
    { id: 'castle-stocks', art: slot('props-castle-d', 3), cell: [197, 117], footprint: 110, weight: 10, role: 'misc', shape: 'wide', body: 50 },
    { id: 'castle-gargoyle', art: slot('props-castle-d', 4), cell: [114, 202], footprint: 125, weight: 10, role: 'misc', shape: 'tall', body: 55, top: slot('props-castle-d-tall-top', 1) },
    { id: 'castle-trough', art: slot('props-castle-d', 5), cell: [220, 129], footprint: 170, weight: 10, role: 'misc', shape: 'wide', body: 80 },
    { id: 'castle-boulder', art: slot('props-castle-d', 6), cell: [148, 149], footprint: 150, weight: 10, role: 'misc', shape: 'round', body: 70 },
    { id: 'castle-bollard', art: slot('props-castle-d', 7), cell: [110, 190], footprint: 95, weight: 10, role: 'misc', shape: 'small', body: 40, top: slot('props-castle-d-tall-top', 2) },
    { id: 'castle-stair-ruin', art: slot('props-castle-d', 8), cell: [173, 167], footprint: 170, weight: 10, role: 'misc', shape: 'irregular', body: 80 },
    { id: 'castle-barrels', art: slot('props-castle-e', 0), cell: [167, 137], footprint: 140, weight: 10, role: 'misc', shape: 'round', body: 62 },
    { id: 'castle-spear-rack', art: slot('props-castle-e', 1), cell: [188, 165], footprint: 165, weight: 10, role: 'misc', shape: 'wide', body: 75 },
    { id: 'castle-banner-pole', art: slot('props-castle-e', 2), cell: [95, 194], footprint: 100, weight: 10, role: 'misc', shape: 'tall', body: 30, top: slot('props-castle-e-tall-top', 0) },
    { id: 'castle-anvil', art: slot('props-castle-e', 3), cell: [118, 138], footprint: 105, weight: 10, role: 'misc', shape: 'small', body: 48 },
    { id: 'castle-iron-maiden', art: slot('props-castle-e', 4), cell: [121, 199], footprint: 120, weight: 10, role: 'misc', shape: 'tall', body: 55, top: slot('props-castle-e-tall-top', 1) },
    { id: 'castle-grave-cross', art: slot('props-castle-e', 5), cell: [84, 155], footprint: 90, weight: 10, role: 'misc', shape: 'small', body: 36, top: slot('props-castle-e-tall-top', 2) },
    { id: 'castle-ballista', art: slot('props-castle-e', 6), cell: [220, 174], footprint: 190, weight: 10, role: 'misc', shape: 'wide', body: 90 },
    { id: 'castle-millstone', art: slot('props-castle-e', 7), cell: [133, 110], footprint: 115, weight: 10, role: 'misc', shape: 'round', body: 55 },
    { id: 'castle-wall-corner-ruin', art: slot('props-castle-e', 8), cell: [212, 148], footprint: 185, weight: 10, role: 'misc', shape: 'irregular', body: 88 },
  ],
  outlands: [
    { id: 'outlands-split-tree', art: slot('props-outlands-d', 0), cell: [118, 209], footprint: 125, weight: 10, role: 'misc', shape: 'tall', body: 45, top: slot('props-outlands-d-tall-top', 0) },
    { id: 'outlands-hollow-log', art: slot('props-outlands-d', 1), cell: [220, 124], footprint: 190, weight: 10, role: 'misc', shape: 'wide', body: 88 },
    { id: 'outlands-stone-idol', art: slot('props-outlands-d', 2), cell: [148, 167], footprint: 105, weight: 10, role: 'misc', shape: 'small', body: 48 },
    { id: 'outlands-crag', art: slot('props-outlands-d', 3), cell: [197, 147], footprint: 175, weight: 10, role: 'misc', shape: 'irregular', body: 82 },
    { id: 'outlands-axe-stump', art: slot('props-outlands-d', 4), cell: [146, 147], footprint: 105, weight: 10, role: 'misc', shape: 'small', body: 48 },
    { id: 'outlands-signpost', art: slot('props-outlands-d', 5), cell: [113, 181], footprint: 100, weight: 10, role: 'misc', shape: 'tall', body: 32, top: slot('props-outlands-d-tall-top', 1) },
    { id: 'outlands-beast-skull', art: slot('props-outlands-d', 6), cell: [176, 155], footprint: 150, weight: 10, role: 'misc', shape: 'irregular', body: 68 },
    { id: 'outlands-trough', art: slot('props-outlands-d', 7), cell: [216, 132], footprint: 175, weight: 10, role: 'misc', shape: 'wide', body: 82 },
    { id: 'outlands-bird-totem', art: slot('props-outlands-d', 8), cell: [104, 185], footprint: 90, weight: 10, role: 'misc', shape: 'tall', body: 30, top: slot('props-outlands-d-tall-top', 2) },
    { id: 'outlands-menhir', art: slot('props-outlands-e', 0), cell: [132, 174], footprint: 115, weight: 10, role: 'misc', shape: 'tall', body: 50, top: slot('props-outlands-e-tall-top', 0) },
    { id: 'outlands-plough', art: slot('props-outlands-e', 1), cell: [220, 142], footprint: 175, weight: 10, role: 'misc', shape: 'wide', body: 80 },
    { id: 'outlands-cauldron', art: slot('props-outlands-e', 2), cell: [194, 121], footprint: 150, weight: 10, role: 'misc', shape: 'round', body: 70 },
    { id: 'outlands-root-tangle', art: slot('props-outlands-e', 3), cell: [193, 216], footprint: 180, weight: 10, role: 'misc', shape: 'irregular', body: 85 },
    { id: 'outlands-toadstool', art: slot('props-outlands-e', 4), cell: [105, 113], footprint: 90, weight: 10, role: 'misc', shape: 'small', body: 40 },
    { id: 'outlands-barrel', art: slot('props-outlands-e', 5), cell: [122, 133], footprint: 100, weight: 10, role: 'misc', shape: 'small', body: 46 },
    { id: 'outlands-wayshrine', art: slot('props-outlands-e', 6), cell: [136, 196], footprint: 110, weight: 10, role: 'misc', shape: 'tall', body: 44, top: slot('props-outlands-e-tall-top', 1) },
    { id: 'outlands-antler-totem', art: slot('props-outlands-e', 7), cell: [119, 214], footprint: 110, weight: 10, role: 'misc', shape: 'tall', body: 42, top: slot('props-outlands-e-tall-top', 2) },
    { id: 'outlands-wattle-corner', art: slot('props-outlands-e', 8), cell: [206, 127], footprint: 180, weight: 10, role: 'misc', shape: 'irregular', body: 85 },
  ],
  desert: [
    { id: 'desert-sarcophagus', art: slot('props-desert-d', 0), cell: [213, 115], footprint: 190, weight: 10, role: 'misc', shape: 'wide', body: 51 },
    { id: 'desert-ramtotem', art: slot('props-desert-d', 1), cell: [121, 178], footprint: 140, weight: 10, role: 'misc', shape: 'tall', body: 48, top: slot('props-desert-d-tall-top', 0) },
    { id: 'desert-boulder', art: slot('props-desert-d', 2), cell: [201, 113], footprint: 145, weight: 10, role: 'misc', shape: 'round', body: 41 },
    { id: 'desert-amphora', art: slot('props-desert-d', 3), cell: [139, 134], footprint: 100, weight: 10, role: 'misc', shape: 'small', body: 48 },
    { id: 'desert-fallencolumn', art: slot('props-desert-d', 4), cell: [197, 121], footprint: 160, weight: 10, role: 'misc', shape: 'wide', body: 49 },
    { id: 'desert-deadcactus', art: slot('props-desert-d', 5), cell: [134, 189], footprint: 150, weight: 10, role: 'misc', shape: 'tall', body: 53, top: slot('props-desert-d-tall-top', 1) },
    { id: 'desert-hoodoo', art: slot('props-desert-d', 6), cell: [172, 176], footprint: 185, weight: 10, role: 'misc', shape: 'irregular', body: 90, top: slot('props-desert-d-tall-top', 2) },
    { id: 'desert-beastskull', art: slot('props-desert-d', 7), cell: [172, 110], footprint: 110, weight: 10, role: 'misc', shape: 'small', body: 35 },
    { id: 'desert-milestone', art: slot('props-desert-d', 8), cell: [163, 122], footprint: 100, weight: 10, role: 'misc', shape: 'small', body: 37 },
    { id: 'desert-trough', art: slot('props-desert-e', 0), cell: [196, 94], footprint: 155, weight: 10, role: 'misc', shape: 'wide', body: 37 },
    { id: 'desert-sundial', art: slot('props-desert-e', 1), cell: [138, 115], footprint: 105, weight: 10, role: 'misc', shape: 'small', body: 44 },
    { id: 'desert-handcart', art: slot('props-desert-e', 2), cell: [180, 125], footprint: 160, weight: 10, role: 'misc', shape: 'wide', body: 56 },
    { id: 'desert-deadacacia', art: slot('props-desert-e', 3), cell: [193, 185], footprint: 200, weight: 10, role: 'misc', shape: 'tall', body: 90, top: slot('props-desert-e-tall-top', 0) },
    { id: 'desert-crate', art: slot('props-desert-e', 4), cell: [155, 99], footprint: 100, weight: 10, role: 'misc', shape: 'small', body: 32 },
    { id: 'desert-tusk', art: slot('props-desert-e', 5), cell: [210, 140], footprint: 150, weight: 10, role: 'misc', shape: 'irregular', body: 50 },
    { id: 'desert-ziggurat', art: slot('props-desert-e', 6), cell: [202, 140], footprint: 190, weight: 10, role: 'misc', shape: 'irregular', body: 66 },
    { id: 'desert-barrel', art: slot('props-desert-e', 7), cell: [147, 113], footprint: 95, weight: 10, role: 'misc', shape: 'round', body: 36 },
    { id: 'desert-petrifiedstump', art: slot('props-desert-e', 8), cell: [171, 92], footprint: 105, weight: 10, role: 'misc', shape: 'small', body: 28 },
  ],
  winter: [
    { id: 'winter-frozenlog', art: slot('props-winter-d', 0), cell: [200, 126], footprint: 160, weight: 10, role: 'misc', shape: 'wide', body: 50 },
    { id: 'winter-signpost', art: slot('props-winter-d', 1), cell: [99, 153], footprint: 110, weight: 10, role: 'misc', shape: 'tall', body: 36, top: slot('props-winter-d-tall-top', 0) },
    { id: 'winter-boulder', art: slot('props-winter-d', 2), cell: [151, 109], footprint: 140, weight: 10, role: 'misc', shape: 'round', body: 50 },
    { id: 'winter-barrel', art: slot('props-winter-d', 3), cell: [123, 131], footprint: 95, weight: 10, role: 'misc', shape: 'round', body: 45 },
    { id: 'winter-sarcophagus', art: slot('props-winter-d', 4), cell: [220, 140], footprint: 190, weight: 10, role: 'misc', shape: 'wide', body: 60 },
    { id: 'winter-stump', art: slot('props-winter-d', 5), cell: [160, 105], footprint: 105, weight: 10, role: 'misc', shape: 'small', body: 34 },
    { id: 'winter-outcrop', art: slot('props-winter-d', 6), cell: [207, 164], footprint: 190, weight: 10, role: 'misc', shape: 'irregular', body: 75 },
    { id: 'winter-crate', art: slot('props-winter-d', 7), cell: [163, 111], footprint: 100, weight: 10, role: 'misc', shape: 'small', body: 34 },
    { id: 'winter-sapling', art: slot('props-winter-d', 8), cell: [120, 191], footprint: 115, weight: 10, role: 'misc', shape: 'tall', body: 36, top: slot('props-winter-d-tall-top', 1) },
    { id: 'winter-woodpile', art: slot('props-winter-e', 0), cell: [220, 137], footprint: 155, weight: 10, role: 'misc', shape: 'wide', body: 48 },
    { id: 'winter-obelisk', art: slot('props-winter-e', 1), cell: [153, 190], footprint: 190, weight: 10, role: 'misc', shape: 'tall', body: 76, top: slot('props-winter-e-tall-top', 0) },
    { id: 'winter-cauldron', art: slot('props-winter-e', 2), cell: [127, 136], footprint: 130, weight: 10, role: 'misc', shape: 'round', body: 61 },
    { id: 'winter-mammothskull', art: slot('props-winter-e', 3), cell: [180, 143], footprint: 160, weight: 10, role: 'misc', shape: 'irregular', body: 64 },
    { id: 'winter-anvil', art: slot('props-winter-e', 4), cell: [147, 126], footprint: 100, weight: 10, role: 'misc', shape: 'small', body: 43 },
    { id: 'winter-fallencolumn', art: slot('props-winter-e', 5), cell: [204, 124], footprint: 155, weight: 10, role: 'misc', shape: 'wide', body: 47 },
    { id: 'winter-weaponrack', art: slot('props-winter-e', 6), cell: [206, 184], footprint: 160, weight: 10, role: 'misc', shape: 'wide', body: 68, top: slot('props-winter-e-tall-top', 1) },
    { id: 'winter-gravecross', art: slot('props-winter-e', 7), cell: [105, 187], footprint: 110, weight: 10, role: 'misc', shape: 'tall', body: 31, top: slot('props-winter-e-tall-top', 2) },
    { id: 'winter-helm', art: slot('props-winter-e', 8), cell: [208, 134], footprint: 185, weight: 10, role: 'misc', shape: 'round', body: 60 },
  ],
};

const ZONE_ROWS: Record<ZoneId, readonly CellRow[]> = {
  castle: CASTLE_PROPS,
  outlands: OUTLANDS_PROPS,
  desert: DESERT_PROPS,
  winter: WINTER_PROPS,
};

function build(zone: ZoneId): PropDef[] {
  return [
    ...ZONE_ROWS[zone].map((row) => toProp(row, 256, ZONE_FALLBACK_TINT[zone])),
    ...V3_ROWS[zone].map((row) => toProp(row, 256, ZONE_FALLBACK_TINT[zone])),
    ...LANDMARK_ROWS[zone].map((row) => toProp(row, 512, ZONE_FALLBACK_TINT[zone])),
  ];
}

/** Every blocking prop + landmark of a zone. */
export const PROPS_BY_ZONE: Record<ZoneId, readonly PropDef[]> = {
  castle: build('castle'),
  outlands: build('outlands'),
  desert: build('desert'),
  winter: build('winter'),
};

const INDEX: Record<ZoneId, Record<string, PropDef>> = {
  castle: Object.fromEntries(PROPS_BY_ZONE.castle.map((p) => [p.id, p])),
  outlands: Object.fromEntries(PROPS_BY_ZONE.outlands.map((p) => [p.id, p])),
  desert: Object.fromEntries(PROPS_BY_ZONE.desert.map((p) => [p.id, p])),
  winter: Object.fromEntries(PROPS_BY_ZONE.winter.map((p) => [p.id, p])),
};

/** Prop by id within a zone. Throws: a stamp naming a prop the zone lacks is an authoring bug. */
export function propDef(zone: ZoneId, id: string): PropDef {
  const def = INDEX[zone][id];
  if (def === undefined) throw new Error(`Zone "${zone}" has no prop "${id}"`);
  return def;
}

/** A zone's props of one role (mapgen cluster palettes). */
export function propsWithRole(zone: ZoneId, role: PropRole): readonly PropDef[] {
  return PROPS_BY_ZONE[zone].filter((p) => p.role === role);
}

/** Flat, non-colliding floor decoration, per zone. Purely visual. */
export const DECALS_BY_ZONE: Record<ZoneId, readonly DecalDef[]> = {
  castle: CASTLE_DECALS.map((row) => toDecal(row, DECAL_ALPHA)),
  outlands: OUTLANDS_DECALS.map((row) => toDecal(row, DECAL_ALPHA)),
  desert: DESERT_DECALS.map((row) => toDecal(row, DECAL_ALPHA)),
  winter: WINTER_DECALS.map((row) => toDecal(row, DECAL_ALPHA)),
};

/** Splat decal texture keys (§3.7 `splat-<zone>-a|b|c`, 512 px). */
export const SPLAT_KEYS: Record<ZoneId, readonly string[]> = {
  castle: ['splat-castle-a', 'splat-castle-b', 'splat-castle-c'],
  outlands: ['splat-outlands-a', 'splat-outlands-b', 'splat-outlands-c'],
  desert: ['splat-desert-a', 'splat-desert-b', 'splat-desert-c'],
  winter: ['splat-winter-a', 'splat-winter-b', 'splat-winter-c'],
};
export const SPLAT_PX = 512;
/** Splat alpha (≤ 0.45: soft ground tone, never a visible shape). */
export const SPLAT_ALPHA = 0.4;
