/**
 * Colony content types, id unions and the stat vocabulary (PRD §16.1). FROZEN
 * at the contract wave: owned by the seam (Greybox); workstreams consume, the
 * orchestrator amends. Data-only, Phaser-free.
 */

/** Goods in HUD / ledger order. */
export const GOOD_IDS = ['ferrite', 'ice', 'aurelite', 'rations', 'alloy', 'prism', 'cell'] as const;
export type GoodId = (typeof GOOD_IDS)[number];
export type TagId = 'hearth' | 'forge' | 'bulwark' | 'frontier' | 'kin' | 'orbit';
export type DepositKind = 'ore' | 'ice' | 'crystal' | 'vent';
/** impure, normal, pure → `COLONY_TUNING.production.purityMul`. */
export type Purity = 0 | 1 | 2;
export type BuildingId =
  | 'lander_core' | 'ferrite_drill' | 'rime_borer' | 'aurel_harvester' | 'vent_tap'
  | 'sun_sail' | 'charge_bank' | 'hydro_terrace' | 'alloy_smelter' | 'prism_cutter' | 'lumen_foundry'
  | 'relay_pylon' | 'cargo_silo' | 'hab_dome' | 'hearth_commons' | 'pulse_turret' | 'arc_coil'
  | 'flak_mortar' | 'plate_barricade' | 'beacon_spire';
export type FaunaId = 'skitter' | 'spitter' | 'brute' | 'moth' | 'burrower' | 'sapper' | 'bloater' | 'howler' | 'matron' | 'titan';
export type RelicId = 'relic_cache' | 'relic_monolith' | 'relic_archive' | 'relic_geode';
/** 0 north, 1 east, 2 south, 3 west. */
export type Edge = 0 | 1 | 2 | 3;
export type Stock = Partial<Record<GoodId, number>>;
export interface Recipe { inputs: Stock; outputs: Stock; cycleSec: number }
export interface TurretSpec {
  rangeTiles: number; minRangeTiles: number; damage: number; cooldownSec: number;
  chain: number; splashTiles: number; hitsAir: boolean; airMul: number;
}
export interface BuildingDef {
  id: BuildingId; name: string; desc: string;
  category: 'core' | 'extract' | 'process' | 'power' | 'logistics' | 'housing' | 'defense' | 'beacon';
  footprint: 1 | 2 | 3; cost: Stock; workers: number; kw: number; noise: number; hp: number; unlockSol: number;
  deposit: DepositKind | null; recipe: Recipe | null; kwOut: number; dayOnly: boolean; storeKj: number;
  beds: number; storage: number; fieldRadius: number; turret: TurretSpec | null; artKey: string; iconKey: string;
}
export interface FaunaDef {
  id: FaunaId; name: string; desc: string; hp: number; dps: number; speedPx: number;
  flying: boolean; wallMul: number; rangeTiles: number; sizePx: number; rank: 'trash' | 'elite' | 'alpha'; artKey: string;
  behaviour: 'chew' | 'shell' | 'ram' | 'lamp' | 'burrow' | 'latch' | 'burst' | 'rally' | 'brood' | 'titan';
}
export interface SwarmNight {
  sol: number; atSec: number; edges: 1 | 2 | 3 | 4; label: string;
  spawns: ReadonlyArray<{ id: FaunaId; count: number }>; alpha: FaunaId | null;
}

/**
 * Every stat a directive (§5.3), protocol (§5.3) or Ark node (§10) touches.
 * `Effect.mul` scales the base by (1 + Σmul); `Effect.add` adds Σadd after
 * (`model/modifiers.ts:colonyStat`). Each entry needs a model reader.
 */
export const COLONY_STATS = [
  // hearth: field, power, banks, sails, vents
  'field.heatUpkeep',
  'field.shedIntervalSec',
  'field.freezeAfterSec',
  'power.overdriveSec',
  'power.overdriveStress',
  'bank.capacity',
  'bank.dischargeUncapped',
  'bank.turretHealPerSec',
  'sail.kw',
  'sail.nightShare',
  'venttap.kw',
  'venttap.noise',
  'core.kw',
  'core.radius',
  'core.hp',
  'hab.brownoutLitRadius',
  'smelter.heatFreeRadius',
  // forge: production
  'process.rate',
  'process.workers',
  'smelter.rate',
  'smelter.noise',
  'cutter.rate',
  'harvester.rate',
  'foundry.cycleSec',
  'foundry.cellsPerCycle',
  'purity.impureFloor',
  'upgrade.cost',
  'upgrade.freeMk2',
  // bulwark: defense
  'pulse.damage',
  'pulse.cost',
  'pulse.extraTargets',
  'turret.range',
  'arc.chain',
  'arc.stunSec',
  'flak.splash',
  'flak.airMul',
  'flak.split',
  'wall.hp',
  'wall.reflect',
  'wall.dawnRebuild',
  'building.nightRegenPct',
  'kill.ferrite',
  // frontier: grid, fog, extraction
  'relay.radius',
  'relay.cost',
  'relay.sentryDps',
  'relay.leechImmune',
  'fog.revealTiles',
  'deposit.purePerSite',
  'extract.noise',
  'extract.pureFirstFree',
  // kin: people
  'hab.beds',
  'hab.cost',
  'arrivals',
  'arrivals.staffSameDawn',
  'rations.use',
  'morale.perDawn',
  'morale.floor',
  'morale.start',
  'commons.morale',
  'cold.deathRate',
  'colonist.deathRate',
  // orbit: orders, beacon, draft, meta
  'request.data',
  'request.bonusFe',
  'request.bonusAlloy',
  'request.slots',
  'request.autoShip',
  'beacon.chargeSec',
  'beacon.unlockSol',
  'beacon.cost',
  'beacon.choirDamage',
  'chorus.scale',
  'draft.choices',
  'draft.rerolls',
  'start.ferrite',
  'data.mul',
] as const;
export type ColonyStat = (typeof COLONY_STATS)[number];
export interface Effect { stat: ColonyStat; add?: number; mul?: number }
export interface DirectiveDef {
  id: string; name: string; desc: string; tag: TagId; rarity: 'standard' | 'prime';
  openAtL1: boolean; effects: readonly Effect[]; iconKey: string;
}
export interface ProtocolDef {
  id: string; name: string; desc: string; directive: string;
  building: BuildingId | 'extractors'; count: number; openAtL1: boolean; effects: readonly Effect[]; apexArtKey: string;
}
export type OrderNeed = { goods: Stock } | { colonists: number } | { cleanNight: true } | { killAlpha: 'matron' };
export interface OrderBonus {
  fe?: number; alloy?: number; colonists?: number; morale?: number; rerolls?: number;
  mk2Tokens?: number; freeBuild?: { id: BuildingId; count: number }; beaconSecs?: number; refillBanks?: boolean; pingPure?: number;
}
export interface OrderTemplate {
  id: string; name: string; desc: string; solMin: number; solMax: number;
  need: OrderNeed; data: number; bonus: OrderBonus;
}
export interface SiteDef {
  id: string; name: string; desc: string; biome: 'steppe' | 'rime' | 'mire' | 'nacre';
  starsToUnlock: number; requiresNode: string | null; tempOffsetC: number; dataMul: number;
  depositMul: Partial<Record<DepositKind, number>>; purityShift: Partial<Record<DepositKind, number>>;
  ceilingMul: Partial<Record<FaunaId, number>>; noiseMul: number; extraMatronSol: number | null; chokepoints: boolean;
  /** Chorus unit counts × this (PRD §5.4 Aurora Rift ×1.25). */
  chorusMul: number;
  /** Fauna that join the night swarm from `fromSol` even when that night's row lacks them (PRD §5.4 site rules). */
  earlyFauna: ReadonlyArray<{ id: FaunaId; fromSol: number }>;
}
export interface ArkNode {
  id: string; name: string; desc: string; branch: 'hab' | 'forge' | 'grid' | 'bul' | 'sur' | 'cmd';
  ring: 0 | 1 | 2 | 3 | 4 | 5; cost: number; effects: readonly Effect[]; unlocks: readonly string[];
}
/**
 * A Landing Kit's crate (PRD §5.3), applied generically by `model/state.ts:createColony`.
 * `place` pre-builds `count` free buildings where the model's placement rule for that
 * building puts them (extractor → nearest matching deposit, Hab Dome → beside the core,
 * turret → the side with the most deposits in the field).
 */
export interface KitGrant {
  fe?: number; colonists?: number; fogTiles?: number; rerolls?: number; mk2Tokens?: number;
  pingPure?: boolean; place?: { id: BuildingId; count: number };
}
export interface LandingKit { id: string; name: string; desc: string; openAtL1: boolean; unlockNode: string | null; grant: KitGrant }
/** Relic payload row (PRD §5.2 Relic Sites). */
export interface RelicDef {
  id: RelicId; name: string; desc: string; count: number; minDistTiles: number; firstSol: number;
  grant: { stock?: Stock; rerolls?: number; data?: number };
}
