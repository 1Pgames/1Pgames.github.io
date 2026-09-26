import { LANDMARK_IDS, propDef } from './props';
import type { PoiKind, ZoneId } from './types-v2';

/**
 * Prop stamps (PRD-V2 §3.5): fixed compositions mapgen places BEFORE the
 * cluster scatter — one landmark per region and one stamp per POI/gate.
 *
 * Stamp = `{ id, radius, props: {propId, dx, dy, bodyRadius?, rot?}[], doorways }`.
 * `radius` is the stamp's OUTER extent (farthest body edge from its centre);
 * the POI's open interior is `POI_CLEARING[kind]` (§5.12). Ring stamps (lair,
 * den, vault) put their pieces just outside the clearing and leave `doorways`
 * (angle in radians, +y = south; width = free gap between the flanking
 * bodies, px). Consecutive ring pieces abut sprite to sprite and sit 28 px
 * apart body to body, below the 64 px nav seal, so a ring is a wall with doors.
 *
 * Stamps are authored per zone because prop ids are per zone; the geometry
 * is shared, only the palette differs (`PALETTES`). `STAMP_SETS[zone.stampSet]`
 * names a zone's 9 landmark stamps (region slot order) + its POI stamps.
 *
 * Pure data, no Phaser import.
 */

export interface StampProp { propId: string; dx: number; dy: number; bodyRadius?: number; rot?: number }
export interface StampDoorway { angle: number; width: number }
export interface StampDef { id: string; radius: number; props: StampProp[]; doorways: StampDoorway[] }

export type PoiStampKind = 'chest' | 'lair' | 'den' | 'shrine' | 'vault' | 'gateApron' | 'fence' | 'eventYard';
export interface StampSet { landmarks: readonly string[]; poi: Readonly<Record<PoiStampKind, string>> }

/** §5.12 clearing radius per POI kind: no blocker body may intrude. */
export const POI_CLEARING: Readonly<Record<PoiKind, number>> = {
  chest_t1: 180, chest_t2: 180, chest_t3: 180,
  vault: 260, lair: 360, den: 480,
  shrine_blood: 140, shrine_gilt: 140, shrine_bone: 140, shrine_grave: 140, shrine_curse: 140,
  vein: 80, lore: 60, bell: 120, fence: 200, event_yard: 420,
};

/** Which stamp a POI kind wears (null = bare clearing). */
export const POI_STAMP: Readonly<Record<PoiKind, PoiStampKind | null>> = {
  chest_t1: 'chest', chest_t2: 'chest', chest_t3: 'chest',
  vault: 'vault', lair: 'lair', den: 'den',
  shrine_blood: 'shrine', shrine_gilt: 'shrine', shrine_bone: 'shrine', shrine_grave: 'shrine', shrine_curse: 'shrine',
  vein: null, lore: null, bell: null, fence: 'fence', event_yard: 'eventYard',
};

/**
 * Large-footprint POIs (clearing ≥ 200 or guarded) keep `mapgen.poiMinSpacing`
 * between each other; any two anchors keep `mapgen.poiMinorSpacing` (and
 * never overlap a clearing).
 */
export const MAJOR_POIS: readonly PoiKind[] = ['den', 'vault', 'lair', 'event_yard', 'fence', 'chest_t3'];

/** Gate apron (§3.5): r 400, no blockers. */
export const GATE_APRON_RADIUS = 400;


interface Palette { fence: string; post: string; grave: string; rubble: string; campA: string; campB: string }

const PALETTES: Record<ZoneId, Palette> = {
  castle: { fence: 'castle-ironfence', post: 'castle-pillar', grave: 'castle-gravestone', rubble: 'castle-rubble-heap', campA: 'coffin', campB: 'pew' },
  outlands: { fence: 'outlands-bonefence', post: 'outlands-gibbetpost', grave: 'outlands-gravemarker', rubble: 'outlands-stonepile', campA: 'cart', campB: 'tent' },
  desert: { fence: 'desert-ribfence', post: 'desert-cagepost', grave: 'desert-stele', rubble: 'desert-sandrubble', campA: 'wreck', campB: 'awning' },
  winter: { fence: 'winter-icefence', post: 'winter-lanternpost', grave: 'winter-frostgrave', rubble: 'winter-snowrubble', campA: 'sled', campB: 'frozenwell' },
};

const round = (n: number): number => Math.round(n);

function outerRadius(props: readonly StampProp[], zone: ZoneId, floor: number): number {
  let r = floor;
  for (const p of props) r = Math.max(r, Math.hypot(p.dx, p.dy) + (p.bodyRadius ?? propDef(zone, p.propId).bodyRadius));
  return Math.ceil(r);
}

/**
 * Ring/arc piece geometry for a zone: pieces abut sprite to sprite (pitch =
 * the wider of the fence/post art + 4 px, so art never overlaps), and each
 * body is `pitch/2 − 14` so neighbouring bodies stay sealed (28 px apart,
 * below the 64 px hero seal). The ring radius puts the art — not just the
 * body — outside the clearing.
 */
function pieceGeometry(zone: ZoneId): { pitch: number; r: number; vr: number } {
  const pal = PALETTES[zone];
  const vr = Math.max(propDef(zone, pal.fence).visualR, propDef(zone, pal.post).visualR);
  const pitch = 2 * vr + 4;
  return { pitch, r: Math.round(pitch / 2 - 14), vr };
}

/**
 * A single-course ring of wall pieces just outside a clearing, broken by
 * doorways. Along the top/bottom (tangent near horizontal) pieces are the
 * zone's fence cell; on the flanks, its post cell — 3/4-view art is never
 * rotated.
 */
function ring(zone: ZoneId, clearing: number, doorways: readonly StampDoorway[]): StampProp[] {
  const pal = PALETTES[zone];
  const { pitch, r, vr } = pieceGeometry(zone);
  const R = clearing + vr + 4;
  const step = 2 * Math.asin(pitch / (2 * R));
  // Angular half-opening that leaves `width` px free between flanking bodies.
  const gaps = doorways
    .map((d) => ({ at: d.angle, half: Math.asin(Math.min(1, (d.width + 2 * r) / (2 * R))) }))
    .sort((a, b) => a.at - b.at);
  const arcs: Array<[number, number]> = [];
  if (gaps.length === 0) arcs.push([0, Math.PI * 2 - step]);
  for (let i = 0; i < gaps.length; i += 1) {
    const g = gaps[i]!;
    const next = gaps[(i + 1) % gaps.length]!;
    const from = g.at + g.half;
    let to = next.at - next.half;
    if (to <= from) to += Math.PI * 2;
    arcs.push([from, to]);
  }
  const props: StampProp[] = [];
  for (const [from, to] of arcs) {
    // Pieces spaced at ≥ `step` (sprites never overlap); the run is centred in its arc.
    const n = Math.max(1, Math.floor((to - from) / step) + 1);
    const used = (n - 1) * step;
    const start = from + ((to - from) - used) / 2;
    for (let k = 0; k < n; k += 1) {
      const a = start + k * step;
      props.push({ propId: Math.abs(Math.sin(a)) >= 0.6 ? pal.fence : pal.post, dx: round(Math.cos(a) * R), dy: round(Math.sin(a) * R), bodyRadius: r });
    }
  }
  return props;
}

/** Single pieces at the given bearings (degrees), art just outside the clearing. */
function arc(zone: ZoneId, clearing: number, angles: readonly number[], propId: string, bodyRadius?: number): StampProp[] {
  const R = clearing + propDef(zone, propId).visualR + 4;
  return angles.map((deg) => {
    const a = (deg * Math.PI) / 180;
    return { propId, dx: round(Math.cos(a) * R), dy: round(Math.sin(a) * R), ...(bodyRadius === undefined ? {} : { bodyRadius }) };
  });
}

function buildZoneStamps(zone: ZoneId): { stamps: StampDef[]; set: StampSet } {
  const pal = PALETTES[zone];
  const stamps: StampDef[] = [];
  const add = (key: string, clearing: number, props: StampProp[], doorways: StampDoorway[]): string => {
    const id = `${zone}/${key}`;
    stamps.push({ id, radius: outerRadius(props, zone, clearing), props, doorways });
    return id;
  };

  // Landmarks stand alone on their plaza: nothing is heaped onto them.
  const landmarks = LANDMARK_IDS[zone].map((lm) => add(lm, propDef(zone, lm).bodyRadius, [{ propId: lm, dx: 0, dy: 0 }], []));
  const piece = pieceGeometry(zone);

  const poi: Record<PoiStampKind, string> = {
    // Chest nook: three abutting fence pieces behind (north of) the chest,
    // 45° apart so the art never overlaps and the bodies stay sealed.
    chest: add('chest-nook', POI_CLEARING.chest_t1, arc(zone, POI_CLEARING.chest_t1, [-135, -90, -45], pal.fence, piece.r), []),
    // Lair ring: two doorways ≥ 240 facing west/east.
    lair: add('lair-ring', POI_CLEARING.lair, ring(zone, POI_CLEARING.lair, [{ angle: 0, width: 260 }, { angle: Math.PI, width: 260 }]), [
      { angle: 0, width: 260 },
      { angle: Math.PI, width: 260 },
    ]),
    // Den arena: four diagonal doorways ≥ 260 (the bone wall closes them at runtime).
    den: add('den-arena', POI_CLEARING.den, ring(zone, POI_CLEARING.den, DEN_DOORS), DEN_DOORS),
    // Shrine plinth: two flanking posts.
    shrine: add('shrine-plinth', POI_CLEARING.shrine_grave, arc(zone, POI_CLEARING.shrine_grave, [-170, -10], pal.post), []),
    // Vault court: one south doorway (§3.5 ≥ 220; authored 240).
    vault: add('vault-court', POI_CLEARING.vault, ring(zone, POI_CLEARING.vault, [{ angle: Math.PI / 2, width: 240 }]), [
      { angle: Math.PI / 2, width: 240 },
    ]),
    gateApron: add('gate-apron', GATE_APRON_RADIUS, [], []),
    // Fence camp: cart + tent behind the fence's standing spot.
    fence: add('fence-camp', POI_CLEARING.fence, [...arc(zone, POI_CLEARING.fence, [-150], pal.campA), ...arc(zone, POI_CLEARING.fence, [-30], pal.campB)], []),
    // Event yard: a lone grave on each diagonal.
    eventYard: add('event-yard', POI_CLEARING.event_yard, arc(zone, POI_CLEARING.event_yard, [45, 135, 225, 315], pal.grave), []),
  };
  return { stamps, set: { landmarks, poi } };
}

const DEN_DOORS: StampDoorway[] = [1, 3, 5, 7].map((k) => ({ angle: (k * Math.PI) / 4, width: 280 }));

const BUILT = (['castle', 'outlands', 'desert', 'winter'] as const).map((z) => [z, buildZoneStamps(z)] as const);

const STAMPS: readonly StampDef[] = BUILT.flatMap(([, b]) => b.stamps);

/** Stamp sets by `ZoneDef.stampSet` key. */
export const STAMP_SETS: Readonly<Record<string, StampSet>> = Object.fromEntries(BUILT.map(([z, b]) => [z, b.set]));

const STAMP_INDEX: Readonly<Record<string, StampDef>> = Object.fromEntries(STAMPS.map((s) => [s.id, s]));

/** Stamp by id. Throws on an unknown id (authoring bug). */
export function stampDef(id: string): StampDef {
  const def = STAMP_INDEX[id];
  if (def === undefined) throw new Error(`Unknown stamp "${id}"`);
  return def;
}
