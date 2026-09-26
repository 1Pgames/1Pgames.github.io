/**
 * Duskhaul V2 shared types (PRD-V2 §16.1). TYPE-ONLY: no runtime values.
 *
 * Section 1 is the §16.1 block verbatim. Section 2 holds the types the §16.1
 * edge table names but the block does not define (WeaponsView, CardInfo,
 * KillReport, BagView, MetaSaveV4, …) — they are shared by ≥ 2 workstreams,
 * so they live here instead of in any one producer file. Producers import
 * (and may re-export) them; nobody redeclares them.
 */
import type { ExtractionEvent } from '../systems/extraction';

// ───────────── §16.1 block (verbatim) ─────────────
export type ZoneId = 'castle' | 'outlands' | 'desert' | 'winter';
export type HazardLevel = 1 | 2 | 3 | 4 | 5;
export type Depth = 0 | 1 | 2;
export type ClassId = 'duskhauler' | 'gravewarden' | 'ashwitch' | 'widowblade';
export type WeaponId = 'bolt' | 'orbit' | 'nova' | 'scythe' | 'rail' | 'hex' | 'skull' | 'censer' | 'sickle' | 'lash' | 'breath' | 'spears'
  | 'aura' | 'chakram' | 'wake' | 'snares' | 'siphon' | 'bombs' | 'totem' | 'thralls';
export type CharmId = 'c_oath' | 'c_bell' | 'c_drum' | 'c_heart' | 'c_eye' | 'c_tongue' | 'c_lodestone' | 'c_candle' | 'c_spur' | 'c_mail' | 'c_salve' | 'c_pouch' | 'c_step'
  | 'c_pin' | 'c_knuckle' | 'c_sole' | 'c_fuse' | 'c_vial' | 'c_powder' | 'c_hymnal' | 'c_collar';
export type EliteAffixId = 'vampiric' | 'hasted' | 'shielded' | 'splitter' | 'frenzied' | 'warded' | 'plagued' | 'magnetic';
export type GearSlot = 'hood' | 'shroud' | 'grips' | 'boots' | 'ring' | 'amulet';
export type Rarity = 1 | 2 | 3 | 4 | 5 | 6;
export type ConsumableId = 'cb_bread' | 'cb_flask' | 'cb_salt' | 'cb_candle' | 'cb_oil';
export type MutatorId = 'mu_bloodmoon' | 'mu_famine' | 'mu_gilded' | 'mu_fog' | 'mu_haste' | 'mu_glass' | 'mu_crowded' | 'mu_earlydusk' | 'mu_armory' | 'mu_pact' | 'mu_bells' | 'mu_lucky';
export type GateId = 'a' | 'b' | 'c' | 'x';
export type GateKind = 'timed' | 'toll' | 'offering' | 'bell';
export type PoiKind = 'chest_t1' | 'chest_t2' | 'chest_t3' | 'vault' | 'lair' | 'den' | 'shrine_blood' | 'shrine_gilt' | 'shrine_bone' | 'shrine_grave' | 'shrine_curse' | 'vein' | 'lore' | 'bell' | 'fence' | 'event_yard';
export type EventKind = 'ev_caravan' | 'ev_vigil' | 'ev_rising';
export type RunMode = 'normal' | 'daily' | 'weekly' | 'ftue';
export type PlayerStatKey = 'maxHp' | 'moveSpeed' | 'damageMul' | 'cooldownMul' | 'area' | 'critChance' | 'critMul' | 'pickupRadius' | 'shardsMul' | 'channelMs' | 'bagCells' | 'projectileBonus' | 'durationMul' | 'regenPerS' | 'contactDamageMul' | 'xpMul' | 'luck';

export interface StatMod { stat: PlayerStatKey; add?: number; mul?: number; source: string }
export interface GearAffix { id: string; value: number }
export interface GearInstance { uid: string; base: string; slot: GearSlot; rarity: Rarity; level: number; affixes: GearAffix[]; unique?: string; locked?: boolean }
export interface ValuableInstance { uid: string; id: string }
export type LootItem = { kind: 'gear'; item: GearInstance } | { kind: 'valuable'; item: ValuableInstance };

export interface PoiAnchor { id: string; kind: PoiKind; x: number; y: number; radius: number; depth: Depth; region: number }
export interface GateCandidate { id: GateId; kind: GateKind; x: number; y: number; depth: Depth; opensS: number; closesS: number | null }
export interface RegionInfo { index: number; cx: number; cy: number; depth: Depth; landmark: string }
export interface PlacedProp { id: string; x: number; y: number; bodyRadius: number; tall?: boolean; rot?: number }
export interface PlacedDecal { id: string; x: number; y: number; rot: number; alpha: number }
export interface MapMetrics { coverage: number; minCorridor: number; narrowShare: number; maxPathFactor: number; poiCount: number; reseeds: number; ms: number }
export interface GeneratedMap {
  seed: string; zone: ZoneId; width: number; height: number;
  spawn: { x: number; y: number };
  floor: { cols: number; rows: number; cell: number; variant: Uint8Array /* 0..2 */; road: Uint8Array /* 0|1 */ };
  props: PlacedProp[]; decals: PlacedDecal[]; splats: PlacedDecal[];
  lightPools: { x: number; y: number; r: number }[];
  breakables: { x: number; y: number; kind: 'urn' | 'coffin' | 'crate' }[];
  nav: { cols: number; rows: number; cell: number; blocked: Uint8Array };
  regions: RegionInfo[]; regionAt: Uint8Array; /* maskCell raster, value = region index */
  gates: GateCandidate[];          /* exactly a, b, c + one 'x' conditional */
  pois: PoiAnchor[];
  hazardAnchors: { x: number; y: number }[];
  metrics: MapMetrics;
}

export interface RunLoadoutV2 {
  zone: ZoneId; hazard: HazardLevel; mode: RunMode; seed: string; mutators: MutatorId[];
  classId: ClassId; startWeapon: WeaponId;
  modifiers: StatMod[];                          // class + sanctum + gear (+ mercy), in that order
  unlockedWeapons: WeaponId[]; unlockedCharms: CharmId[];
  bagCells: number; casketSlots: number;
  deathKeepPct: number; greedMaxMul: number; tollPct: number;
  rerollsPerRun: number; banishesPerRun: number; startLevel: number; startDreadKeys: number;
  reviveCharges: number; reviveHpRatio: number; reviveImmunityMs: number;
  iframesMsBonus: number; gateWindowBonusS: number; channelMsDelta: number; contestedRate: number;
  previewS: number; minimapRevealPx: number; speedNearGateMul: number; gloamwalkMs: number; gravePact: boolean;
  fenceChance: number; fenceTrades: number; veinMul: number; veinStandMs: number; breakableDropMul: number; eliteExtraValuables: number;
  belt: ({ id: ConsumableId; charges: number } | null)[];
  uniques: string[];                             // equipped unique ids (effects keyed by id)
  threatMul: number; lootBias: number; itemLevel: number; hazardExtras: { eliteExtraAffix: boolean; forcedAffix: EliteAffixId | null; collapseAtS: number; bossPhaseAt: [number, number] };
  mercy: boolean;
}

export interface BagSettlement { outcome: 'extracted' | 'died' | 'abandoned'; shardsBanked: number; shardsLost: number; greedMul: number; kept: LootItem[]; lost: LootItem[] }
export interface RunReport {
  outcome: 'extracted' | 'died' | 'abandoned'; killer: string | null; zone: ZoneId; hazard: HazardLevel; mode: RunMode; seed: string; classId: ClassId;
  elapsedS: number; gate: { id: GateId; kind: GateKind } | null; settlement: BagSettlement;
  kills: number; killsByEnemy: Record<string, number>; killsByWeapon: Record<string, number>; eliteKills: number; affixKills: Record<string, number>;
  bossKilled: boolean; midBossKilled: boolean; chestsOpened: number; vaultOpened: boolean; shrinesUsed: number; lairsCleared: number; eventsCompleted: number;
  veinsMined: number; breakablesBroken: number; loreRead: string[]; fenceTrades: number; poisVisited: number;
  evolutions: WeaponId[]; maxLevel: number; charmsOwned: number; weaponsAtMaxRank: number; minHpRatio: number; beltUsed: ConsumableId[];
  itemsSeen: string[];                           // codex keys 'gear:<base>' | 'uniq:<id>' | 'val:<id>'
}
export interface SettlementReport {
  shardsBanked: number; itemsBanked: LootItem[]; lost: LootItem[]; xpGained: number; levelBefore: number; levelAfter: number;
  unlocks: string[]; zoneUnlocked: ZoneId | null; contracts: { id: string; from: number; to: number; target: number; done: boolean }[];
  achievements: string[]; codexNew: string[]; dailyReward: number | null; weeklyReward: number | null; bestHaul: boolean; firstExtraction: boolean;
}

export interface HudModelV2 {
  hp: number; hpMax: number; level: number; xp: number; xpNeeded: number;
  nextGate: { id: GateId; kind: GateKind; state: 'closed' | 'open' | 'closing' | 'spent'; secondsTo: number } | null;
  darkMeter: number; /* 0..1 to collapse */ collapse: boolean;
  bag: { used: number; cells: number; casketUsed: number; casketSlots: number; rarityStrip: Rarity[]; full: boolean };
  shards: number; greedMul: number; /* 1 before greed.startS */
  belt: ({ id: ConsumableId; charges: number; coolingMs: number } | null)[];
  boss: { name: string; hpRatio: number } | null;
}
export interface MinimapModel {
  hero: { x: number; y: number; angle: number };
  gates: { id: GateId; kind: GateKind; x: number; y: number; state: 'closed' | 'open' | 'closing' | 'spent'; label: string }[];
  pois: { id: string; kind: PoiKind | EventKind; x: number; y: number; done: boolean }[];
  boss: { x: number; y: number } | null; collapse: { x: number; y: number; r: number } | null;
}

// ───────────── Auxiliary shared types (named by §16.1 edges, defined here) ─────────────

/** E10 `WeaponSystem.state()`; read by `data/upgrades.ts`, `ui/cards.ts`, `ui/pauseOverlay.ts`. */
export interface WeaponSlotView { id: WeaponId; rank: number; evolved: boolean }
export interface CharmSlotView { id: CharmId; rank: number }
export interface WeaponsView {
  weapons: readonly WeaponSlotView[]; charms: readonly CharmSlotView[];
  maxWeapons: number; maxCharms: number; maxRank: number; maxCharmRank: number;
  evolutionEligible: readonly WeaponId[];
  /** Gloam Step (c_step) cooldown left in ms; null when the charm is not owned. */
  gloamStepCdMs: number | null;
}

/** E12 `rollUpgradeChoices` context. */
export interface DraftContext { taken: readonly string[]; weapons: WeaponsView; unlockedWeapons: WeaponId[]; unlockedCharms: CharmId[]; banished: readonly string[] }

/** E13 `describeCard` output (§5.10); `id` is the card id (icon lookup). */
export type CardKindLabel = 'NEW WEAPON' | 'WEAPON +1' | 'EVOLUTION' | 'NEW CHARM' | 'CHARM +1' | 'STAT' | 'EFFECT';
export interface CardInfo {
  id: string; title: string; kindLabel: CardKindLabel;
  rankFrom: number; rankTo: number; rankMax: number;
  deltaLine: string; evolvesWith?: string; slotLine: string;
  /**
   * Set when this card completes an evolution pair with something the hero
   * already owns (a charm for an owned weapon, or a weapon for an owned charm).
   * `partnerIcon` is the owned piece's icon id; `ready` = picking this card
   * makes the evolution immediately eligible (weapon already at max rank).
   */
  evoMatch?: { partnerName: string; partnerIcon: string; evolvedName: string; ready: boolean };
}

/** E9 kill payload + callbacks implemented in `game.ts create()`. */
export interface KillReport { defId: string; name: string; x: number; y: number; shards: number; elite: EliteAffixId | null; boss: 'zone' | 'mid' | null; source: string }
export interface CombatCallbacksV2 {
  onEnemyKilled(k: KillReport): void;
  onPlayerHit(hpRatio: number, source: string): void;
  onPlayerDied(killer: string): void;
  onPickup(kind: 'xp' | 'coin', value: number): void;
  onBreakableHit(x: number, y: number, r: number): void;
}

/** E8/E19 `spawnPopulation` / `PoiCallbacks.requestSpawn` request; returns spawned enemy uids. */
export interface PoiSpawnSpec {
  source: string; x: number; y: number; radius: number;
  entries: { defId: string; count: number; elite?: EliteAffixId | null }[];
  /** Lair guards: spawned asleep until the hero is within `poi.lair.wakePx`. */
  dormant?: boolean;
}

/** E19 `onFence` offers (§5.12.7). */
export type FenceTradeId = 'fence_heal' | 'fence_rerolls' | 'fence_reveal' | 'fence_upgrade';
export interface FenceOffer { id: FenceTradeId; label: string; cost: { gear?: number; valuables?: number; items?: number; shards?: number } }

/** E20/E21 breakable drop (§5.13). */
export type PickupId = 'pk_bread' | 'pk_bell' | 'pk_flask' | 'pk_salt';
export type PickupDrop =
  | { kind: 'shards'; coins: number }
  | { kind: 'xp'; orbs: number; value: number }
  | { kind: 'pickup'; id: PickupId }
  | { kind: 'item'; tierBias: number };

/** E22 bag surface; read by `ui/bagStrip.ts`, `ui/pauseOverlay.ts`, HUD model. */
export interface BagItemView { uid: string; item: LootItem; cells: 1 | 2; value: number; rarity: Rarity; pinned: boolean; col: number; row: number }
export interface BagView {
  cols: number; rows: number; cells: number; used: number; full: boolean;
  shards: number; casketSlots: number; casket: BagItemView[]; items: BagItemView[];
}
export interface BagAddResult { accepted: boolean; dropped: LootItem[]; refused: LootItem | null }

/** E27 hooks passed to `ExtractionSystem`. */
export interface ExtractionHooks {
  payCondition(gate: GateCandidate): boolean;
  onEvent(e: ExtractionEvent, gate: GateCandidate | null): void;
}

/** E43 coach beats (§14.14). */
export type CoachBeatId = 'move' | 'attack' | 'draft' | 'item' | 'gate' | 'channel' | 'map' | 'belt' | 'locket';

/** §10 save schema (moved here from `core/progression.ts` so hub, contracts and codex share one declaration). */
export interface MetaSaveV4 {
  version: 4;
  currency: number;
  dust: number;
  sigils: number;
  account: { xp: number };
  unlocks: string[];
  upgrades: Record<string, number>;
  vault: { gear: GearInstance[]; valuables: ValuableInstance[] };
  equipped: Record<GearSlot, string | null>;
  classId: ClassId;
  /** Run start weapon chosen via Sanctum `b_armsmaster`; null = the class's start weapon. */
  startWeapon: WeaponId | null;
  belt: [{ id: ConsumableId; charges: number } | null, { id: ConsumableId; charges: number } | null];
  consumables: Record<ConsumableId, number>;
  selection: { zone: ZoneId; hazard: Record<ZoneId, HazardLevel>; lastLoadoutHash: string };
  stats: { runs: number; extracts: number; deaths: number; bestHaul: Record<string, number>; fastestExtractS: number; latestExtractS: number;
           kills: number; eliteKills: number; bossKills: Record<string, number>; chests: number; contractsClaimed: number; deathStreak: number };
  mastery: Record<ZoneId, { extract: boolean; gateC: boolean; bossAndExtract: boolean }>;
  codex: { kills: Record<string, number>; seen: Record<string, true>; lore: string[] };
  achievements: Record<string, 'done' | 'claimed'>;
  contracts: { active: { id: string; progress: number; target: number; params: Record<string, string> }[]; rerollDay: string; rerollsLeft: number;
               weekly: { week: string; step: 0 | 1 | 2 | 3; progress: number } };
  daily: { day: string; played: boolean; rewarded: boolean; streak: number; lastDay: string };
  weekly: { week: string; rewarded: boolean; best: number };
  flags: { ftueDone: boolean; ftueTries: number; seenCoach: string[]; newBadges: string[] };
  collections: Record<string, string[]>;
}

/** §10 in-flight run marker v2 (E29 `writeRunJournal` / `settleAbandonedRun`). */
export interface RunJournalV2 {
  version: 2;
  zone: ZoneId; hazard: HazardLevel; mode: RunMode; seed: string; classId: ClassId;
  /** Casket-pinned items — the only items an abandoned run banks. */
  items: LootItem[];
  /** Shard checkpoint (≤ 1 Hz). */
  shards: number;
  elapsedS: number;
}

/** E29 mutator return shape. */
export interface MetaResult { ok: boolean; meta: MetaSaveV4; reason?: string }
