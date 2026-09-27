/**
 * Content id → generated art (`art/wiring.md`, measured on the shipped files).
 * The only place the colony view names a texture key; every size, origin and
 * ground inset below is the wiring contract's number, not a guess.
 */
import type { OutlineEntry, OutlinePx } from '../../../core/outline';
import type { BuildingId, DepositKind, FaunaId, RelicId } from '../content';

/** World px of one map tile (= `COLONY_TUNING.map.tilePx`; wiring §4 draws floors at 64). */
export const ART_TILE = 64;

/** wiring §1 stem column. */
const BUILDING_STEM: Record<BuildingId, string> = {
  lander_core: 'bld-core',
  ferrite_drill: 'bld-drill',
  rime_borer: 'bld-borer',
  aurel_harvester: 'bld-harvester',
  vent_tap: 'bld-venttap',
  sun_sail: 'bld-sail',
  charge_bank: 'bld-bank',
  hydro_terrace: 'bld-farm',
  alloy_smelter: 'bld-smelter',
  prism_cutter: 'bld-cutter',
  lumen_foundry: 'bld-foundry',
  relay_pylon: 'bld-relay',
  cargo_silo: 'bld-silo',
  hab_dome: 'bld-hab',
  hearth_commons: 'bld-commons',
  pulse_turret: 'bld-pulse',
  arc_coil: 'bld-arc',
  flak_mortar: 'bld-flak',
  plate_barricade: 'bld-wall',
  beacon_spire: 'bld-beacon',
};

/** Buildings drawn from one un-tiered sheet (no Mk ladder in the art). */
const SINGLE_SHEET: Partial<Record<BuildingId, true>> = { lander_core: true, beacon_spire: true };

/** Buildings whose Mk I / Mk III sheets carry the 4-frame work loop (frame 0 = idle). */
export const WORK_LOOP: Partial<Record<BuildingId, true>> = {
  ferrite_drill: true, rime_borer: true, aurel_harvester: true, vent_tap: true, sun_sail: true, hydro_terrace: true, alloy_smelter: true, prism_cutter: true, lumen_foundry: true,
};

/** Extractors that wear `badge-silent` once `p_silent` is evolved (wiring §1). */
export const SILENT_BADGE: Partial<Record<BuildingId, true>> = { ferrite_drill: true, rime_borer: true, aurel_harvester: true };

/**
 * Texture for a building at a Mk: Mk II reuses the Mk I sheet (rank pips carry
 * it), Mk IV is the apex sprite where one exists, else the Mk III sheet.
 */
export function buildingTexture(def: BuildingId, mk: 1 | 2 | 3 | 4, has: (key: string) => boolean): string {
  const stem = BUILDING_STEM[def];
  if (SINGLE_SHEET[def] === true) return mk === 4 && has(`${stem}-apex`) ? `${stem}-apex` : stem;
  if (mk === 4 && has(`${stem}-apex`)) return `${stem}-apex`;
  return `${stem}-mk${mk >= 3 ? 3 : 1}`;
}

/** Draw size (px) of the building's CELL: 64 per footprint tile (wiring §1). */
export function buildingDrawPx(footprint: 1 | 2 | 3): number {
  return footprint * ART_TILE;
}

/**
 * Ground inset: the sheets are `align bottom` with a transparent pad under the
 * base (13/256, 19/384, walls 4/256). Returned as a fraction of the draw size,
 * so the origin (0.5, 1) sits `inset × draw` below the footprint's bottom edge.
 */
export function groundInset(def: BuildingId, footprint: 1 | 2 | 3): number {
  if (def === 'plate_barricade') return 4 / 256;
  return footprint === 3 ? 19 / 384 : 13 / 256;
}

export function scaffoldKey(footprint: 1 | 2 | 3): string {
  return `state-scaffold-${footprint}x${footprint}`;
}
export function ruinKey(footprint: 1 | 2 | 3): string {
  return `state-ruin-${footprint}x${footprint}`;
}
export function frostKey(footprint: 1 | 2 | 3): string {
  return `state-frost-${footprint}x${footprint}`;
}
export const CRACKS_KEY = 'state-cracks';
/** `state-cracks` frame at ≤ 66 % hp (crack-a) and ≤ 33 % hp (crack-c). */
export const CRACK_FRAME = { light: 0, heavy: 2 } as const;

/** wiring §3: sheet key per deposit kind; frame = purity (3 = depleted). */
export const DEPOSIT_KEY: Record<DepositKind, string> = { ore: 'dep-ore', ice: 'dep-ice', crystal: 'dep-crystal', vent: 'dep-vent' };
export const DEPOSIT_DRAW_PX = 128;

/** wiring §3 `relics` sheet frames: probe, monolith, buoy, geode. */
export const RELIC_FRAME: Record<RelicId, number> = { relic_cache: 0, relic_monolith: 1, relic_archive: 2, relic_geode: 3 };
export const RELICS_KEY = 'relics';
export const RELIC_DRAW_PX = 128;

/** wiring §5: world props draw at 80 px (reviewed), centred on their tile. */
export const PROP_DRAW_PX = 80;

// ── fauna (wiring §6) ────────────────────────────────────────────────────

export interface FaunaArt {
  walk: string;
  attack: string;
  /** On-screen size of the sheet CELL (long-edge scaled). */
  cellPx: number;
  /** Origin y at the creature's ground point (0.5 = centre for fliers). */
  groundY: number;
  /** Baked outline width by rank (PRD §1c: 3 / 4 / 5 px). */
  px: OutlinePx;
  /** One-shot behaviour sheet (Matron brood, Titan stomp; wiring §6), played when the behaviour fires. */
  special?: { key: string; groundY: number; ms: number };
}

export const FAUNA_ART: Record<FaunaId, FaunaArt> = {
  skitter: { walk: 'fauna-skitter', attack: 'fauna-skitter-attack', cellPx: 74.5, groundY: 0.93, px: 3 },
  spitter: { walk: 'fauna-spitter', attack: 'fauna-spitter-attack', cellPx: 100.2, groundY: 0.859, px: 3 },
  brute: { walk: 'fauna-brute', attack: 'fauna-brute-attack', cellPx: 130.3, groundY: 0.93, px: 4 },
  moth: { walk: 'fauna-moth', attack: 'fauna-moth-attack', cellPx: 83.8, groundY: 0.5, px: 3 },
  burrower: { walk: 'fauna-grub', attack: 'fauna-grub-attack', cellPx: 83.8, groundY: 0.93, px: 3 },
  sapper: { walk: 'fauna-leech', attack: 'fauna-leech-attack', cellPx: 104.4, groundY: 0.953, px: 3 },
  bloater: { walk: 'fauna-bloat', attack: 'fauna-bloat-attack', cellPx: 143.7, groundY: 0.941, px: 4 },
  howler: { walk: 'fauna-howler', attack: 'fauna-howler-attack', cellPx: 119.2, groundY: 0.965, px: 4 },
  matron: { walk: 'fauna-matron', attack: 'fauna-matron-attack', cellPx: 240.3, groundY: 0.965, px: 5, special: { key: 'fauna-matron-brood', groundY: 0.959, ms: 480 } },
  titan: { walk: 'fauna-titan', attack: 'fauna-titan-attack', cellPx: 346.8, groundY: 0.945, px: 5, special: { key: 'fauna-titan-stomp', groundY: 0.943, ms: 480 } },
};

/** PRD §1c / interface-direction §1 art-locked fauna identity colours. */
const FAUNA_OUTLINE = 0x3a1712;
const FAUNA_BOSS_GLOW = 0x3a0000;

/** Every fauna sheet with its baked outline (declared once; Preload bakes them). */
export function faunaOutlineEntries(has: (key: string) => boolean): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  for (const art of Object.values(FAUNA_ART)) {
    for (const key of art.special === undefined ? [art.walk, art.attack] : [art.walk, art.attack, art.special.key]) {
      if (!has(key)) continue;
      out.push({ key, px: art.px, color: FAUNA_OUTLINE, displayPx: art.cellPx, glow: art.px === 5 ? FAUNA_BOSS_GLOW : undefined });
    }
  }
  return out;
}

// ── motion + fx (wiring §7, §8) ──────────────────────────────────────────

export const FX = {
  pulseBolt: 'fx-pulse-bolt',
  arc: 'fx-arc',
  flak: 'fx-flak',
  acid: 'fx-acid',
  leechSparks: 'fx-leech-sparks',
  bloatBurst: 'fx-bloat-burst',
  frostCreep: 'fx-frost-creep',
  beaconBeam: 'fx-beacon-beam',
  launchFlare: 'fx-launch-flare',
  duskArrow: 'fx-dusk-arrow',
  buildDust: 'fx-build-dust',
  upgradeShine: 'fx-upgrade-shine',
  relicBurst: 'fx-relic-burst',
} as const;

export const MOTION = { drone: 'drone', shuttle: 'lander-shuttle', ark: 'ark-silhouette', beaconCharging: 'bld-beacon-charging', silentBadge: 'badge-silent' } as const;
/** Drone cell px (≈ 28 px visible long edge, wiring §7). */
export const DRONE_PX = 31;
