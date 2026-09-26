/**
 * POI content (PRD-V2 §5.12): per-kind rows, shrine/event/fence copy, lore ids.
 * Numbers that tune behaviour live in `TUNING.poi`; this file holds the
 * content columns (names, counts, radii, depths, art ids, copy).
 */
import type { Depth, FenceOffer, PoiKind, ZoneId } from './types-v2';

export interface PoiDef {
  kind: PoiKind;
  name: string;
  perRun: number;
  clearingRadius: number;
  depths: readonly Depth[];
  /** §11 art id (degrades to a procedural marker when the texture is absent). */
  art: string;
  /** §11 minimap icon id. */
  mmIcon: string;
}

const POIS: readonly PoiDef[] = [
  { kind: 'chest_t1', name: 'Rusted Reliquary', perRun: 6, clearingRadius: 180, depths: [0, 1], art: 'poi-chest-t1', mmIcon: 'mm-chest' },
  { kind: 'chest_t2', name: 'Bronze Reliquary', perRun: 4, clearingRadius: 180, depths: [1, 2], art: 'poi-chest-t2', mmIcon: 'mm-chest' },
  { kind: 'chest_t3', name: 'Gilt Reliquary', perRun: 3, clearingRadius: 180, depths: [1, 2], art: 'poi-chest-t3', mmIcon: 'mm-chest' },
  { kind: 'vault', name: 'Dread Vault', perRun: 1, clearingRadius: 260, depths: [2], art: 'poi-vault', mmIcon: 'mm-vault' },
  { kind: 'lair', name: 'Elite Lair', perRun: 3, clearingRadius: 360, depths: [1, 2], art: 'poi-lair-banner', mmIcon: 'mm-lair' },
  { kind: 'den', name: 'Mid-boss Den', perRun: 1, clearingRadius: 480, depths: [2], art: 'poi-den-wall', mmIcon: 'mm-den' },
  { kind: 'shrine_blood', name: 'Blood Shrine', perRun: 1, clearingRadius: 140, depths: [0, 1, 2], art: 'poi-shrine-blood', mmIcon: 'mm-shrine' },
  { kind: 'shrine_gilt', name: 'Gilt Shrine', perRun: 1, clearingRadius: 140, depths: [0, 1, 2], art: 'poi-shrine-gilt', mmIcon: 'mm-shrine' },
  { kind: 'shrine_bone', name: 'Bone Shrine', perRun: 1, clearingRadius: 140, depths: [0, 1, 2], art: 'poi-shrine-bone', mmIcon: 'mm-shrine' },
  { kind: 'shrine_grave', name: 'Grave Shrine', perRun: 1, clearingRadius: 140, depths: [0, 1, 2], art: 'poi-shrine-grave', mmIcon: 'mm-shrine' },
  { kind: 'shrine_curse', name: 'Curse Shrine', perRun: 1, clearingRadius: 140, depths: [0, 1, 2], art: 'poi-shrine-curse', mmIcon: 'mm-shrine' },
  { kind: 'vein', name: 'Ossuary Pile', perRun: 24, clearingRadius: 80, depths: [0, 1, 2], art: 'poi-vein', mmIcon: 'mm-chest' },
  { kind: 'lore', name: 'Lore Stone', perRun: 3, clearingRadius: 60, depths: [0, 1, 2], art: 'poi-lore', mmIcon: 'mm-shrine' },
  { kind: 'bell', name: 'Dirge Bell', perRun: 2, clearingRadius: 120, depths: [1, 2], art: 'poi-bell', mmIcon: 'mm-gate-cond' },
  { kind: 'fence', name: 'Wandering Fence', perRun: 1, clearingRadius: 200, depths: [1], art: 'npc-fence', mmIcon: 'mm-fence' },
  { kind: 'event_yard', name: 'Event Yard', perRun: 3, clearingRadius: 420, depths: [1, 2], art: '', mmIcon: 'mm-event' },
];

const POI_BY_KIND: Record<string, PoiDef> = Object.fromEntries(POIS.map((p) => [p.kind, p]));

export function poiDef(kind: PoiKind): PoiDef {
  const def = POI_BY_KIND[kind];
  if (def === undefined) throw new Error(`Unknown POI kind "${kind}"`);
  return def;
}

/** Compass warning lead before an event spawns (§5.12.6 "compass arrow 20 s before"). */
export const EVENT_WARN_S = 20;
/** Event yards closer than this to the hero are skipped (§5.12.6). */
export const EVENT_MIN_DIST = 1200;

/** §5.12.7 Wandering Fence trades. */
export const FENCE_TRADES: readonly FenceOffer[] = [
  { id: 'fence_heal', label: 'Give 1 gear ⇒ heal 50%', cost: { gear: 1 } },
  { id: 'fence_rerolls', label: 'Give 1 valuable ⇒ +2 rerolls', cost: { valuables: 1 } },
  { id: 'fence_reveal', label: 'Pay 60 ◆ ⇒ reveal all POIs', cost: { shards: 60 } },
  { id: 'fence_upgrade', label: 'Give 2 items ⇒ 1 item tier +1', cost: { items: 2 } },
];

/** §5.23 Lore: 6 stones per zone, 3 placed per run; codex id `lore-<zone>-<n>`. */
const LORE_PER_ZONE = 6;
export function loreIds(zone: ZoneId): string[] {
  return Array.from({ length: LORE_PER_ZONE }, (_, i) => `lore-${zone}-${i + 1}`);
}
