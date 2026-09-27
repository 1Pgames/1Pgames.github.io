/**
 * Colony seam contracts (PRD §16.1). FROZEN at the contract wave: owned by the
 * seam (Greybox); a signature change goes through the orchestrator, never
 * mid-flight. Producers implement, consumers import from HERE:
 *
 *   model/**  (W1)  ColonyState, ColonyDirector, settle/checkpoint → ColonyView, ColonyEvent, LandingResult
 *   threat/** (W2)  createThreat(state, rng)                        → ThreatPort, NightPlan
 *   game.ts   (W5)  implements ColonyUiHost, drives every UI module below
 *   src/ui/colony/** (W4) implements the UI module signatures below
 *   src/sim/colony/** (W6) drives ColonyState + ColonyDirector headless
 *
 * Type-only module (plus the ColonyFx/ColonyEvent unions); no runtime code.
 */
import type Phaser from 'phaser';
import type { Rng } from '../../core/rng';
import type { SessionOutcome } from '../../core/session';
import type { OverlayHandle } from '../../ui/sheet';
import type {
  BuildingId,
  Edge,
  FaunaId,
  GoodId,
  LandingKit,
  RelicId,
  SiteDef,
  Stock,
  SwarmNight,
} from './data/types';
import type { ColonyState } from './model/state';

// ── model state ─────────────────────────────────────────────────────────

export interface BuildingInst {
  uid: number; def: BuildingId; col: number; row: number; mk: 1 | 2 | 3 | 4;
  hp: number; lit: boolean; darkSec: number; staffed: number; paused: boolean; pinned: boolean; cycle: number;
  /** Max hp at the current Mk (after `wall.hp` etc.). */
  maxHp: number;
  /** Relay switched off by brownout shedding (§5.2 cascade). */
  shed: boolean;
  /** Froze after `field.freezeAfterSec` dark at night (−20 % hp once). */
  frozen: boolean;
  /** Recipe inputs consumed for the running cycle. */
  working: boolean;
  /** Purity of the deposit under an extractor / vent tap (1 otherwise). */
  purity: 0 | 1 | 2;
  /** Turret cooldown seconds. */
  fireCd: number;
  /** Hab Dome: seconds dark at night since the last cold death. */
  coldSec: number;
}

export type PlaceWhy = 'dark' | 'blocked' | 'deposit' | 'locked' | 'afford' | 'bounds' | 'unique';
export type PlaceCheck = { ok: true; cost: Stock } | { ok: false; why: PlaceWhy };

export interface LandingSetup {
  site: SiteDef; rung: number; kit: LandingKit; seed: string; size: 'frontier' | 'expanse' | 'continent';
  ark: readonly string[]; refit: number; daily: boolean; ftue: boolean;
}

export type ColonyPhase = 'day' | 'dusk' | 'night' | 'long-night';
export type AlertKind = 'dark' | 'cold' | 'leech' | 'order' | 'starve' | 'alpha' | 'core' | 'idle';
export type BeaconState = 'locked' | 'unbuilt' | 'ready' | 'charging' | 'launched';

/** A destroyed building's ghost: tap → REBUILD at `mend.rebuildCostRatio` × cost. */
export interface Ruin { def: BuildingId; col: number; row: number; mk: 1 | 2 | 3 | 4 }

/** Snapshot every HUD widget renders (§14). Built by `ColonyState.view()`; never mutated by readers. */
export interface ColonyView {
  sol: number; phase: ColonyPhase; phaseLeftSec: number; tempC: number;
  stock: Record<GoodId, number>; caps: Record<GoodId, number>;
  /** Net production − consumption per second per good, `hud.rateWindowSec` rolling mean. */
  rates: Record<GoodId, number>;
  kwSupply: number; kwDemand: number;
  /** Tonight's kW margin at the current build (banks and overdrive excluded). */
  kwNightForecast: number;
  bankKj: number; bankCapKj: number;
  colonists: number; beds: number; morale: number; stress: number; litTiles: number; noise: number;
  /** Staffing: seats wanted by lit, unpaused buildings; colonists seated; free hands. */
  staffing: { needed: number; staffed: number; idle: number; unstaffed: readonly number[] };
  beaconState: BeaconState; beaconCharge: number; cellsNeeded: number;
  /** Tonight's swarm, known from dusk START (before any coach pauses) until dawn; null by day. */
  tonight: { edges: readonly Edge[]; totalFauna: number } | null;
  alerts: ReadonlyArray<{ kind: AlertKind; col: number; row: number; uid: number | null }>;
  board: ReadonlyArray<{ slot: number; templateId: string; expiresSol: number; shippable: boolean }>;
  ruins: readonly Ruin[];
  /** A demolish is inside its UNDO window. */
  canUndoDemolish: boolean;
  /** Night dead-air answer (critic2 #4): true at night once every fauna of tonight's plan is dead or retreated and none is within 8 tiles of the field; the ContextStrip then offers SKIP TO DAWN. */
  canSkipNight: boolean;
  dockSuggest: readonly BuildingId[];
}

/** Which weapon fired a `shot` fx (the view draws its bolt / filament / shell). */
export type ShotSrc = 'pulse' | 'arc' | 'flak' | 'sentry' | 'choir' | 'acid';

/** Cosmetic outbox the view drains every frame (drones, bolts, deaths). Headless callers may ignore it. */
export type ColonyFx =
  | { kind: 'deliver'; uid: number; good: GoodId }
  | { kind: 'shot'; src: ShotSrc; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'kill'; x: number; y: number; big: boolean }
  | { kind: 'destroyed'; def: BuildingId; col: number; row: number }
  | { kind: 'placed'; uid: number }
  | { kind: 'hit'; uid: number }
  | { kind: 'relic'; col: number; row: number }
  | { kind: 'death'; count: number; reason: 'cold' | 'starve' }
  | { kind: 'shed'; uid: number; lit: boolean };

// ── director / threat ───────────────────────────────────────────────────

export interface NightPlan { edges: readonly Edge[]; counts: ReadonlyArray<{ id: FaunaId; count: number }>; totalFauna: number }

/** Implemented by `threat/index.ts:createThreat(state, rng)` (W2); driven by `ColonyDirector` (W1). */
export interface ThreatPort {
  planNight(night: SwarmNight, scale: number, loudest: Edge, rng: Rng): NightPlan;
  planLongNight(): NightPlan;
  planChorus(scaleMul: number): NightPlan;
  spawn(id: FaunaId, edge: Edge, difficultyMul: number): void;
  retreat(): void;
  /** Fauna move/attack + turret fire + death hooks. */
  tick(dtSec: number, state: ColonyState): void;
  readonly liveCount: number;
}
export type CreateThreat = (state: ColonyState, rng: Rng) => ThreatPort;

export type ColonyEvent =
  | { type: 'dawn'; sol: number; arrivals: number; deaths: number; mended: number }
  | { type: 'draft'; sol: number; cards: readonly string[]; protocol: string | null; rerolls: number }
  /** Fired at dusk START; `plan.edges` are final (the telegraph + coach read them). */
  | { type: 'dusk'; sol: number; plan: NightPlan }
  | { type: 'nightfall'; sol: number; tempC: number }
  | { type: 'brownout'; uid: number }
  | { type: 'relic'; id: RelicId; col: number; row: number }
  | { type: 'unlock'; building: BuildingId }
  | { type: 'alpha'; id: FaunaId }
  | { type: 'evolved'; protocol: string }
  | { type: 'beacon'; state: BeaconState }
  /** A player placement (coach beats `ore`, `dock`, `vent`, `dusk`, `grid` complete on these). */
  | { type: 'placed'; building: BuildingId; uid: number }
  | { type: 'destroyed'; building: BuildingId; col: number; row: number }
  | { type: 'deaths'; count: number; reason: 'cold' | 'starve' }
  /** The order board refilled (dawn from `requests.firstSol`). */
  | { type: 'orders'; sol: number }
  | { type: 'shipped'; slot: number; templateId: string; data: number }
  | { type: 'ended'; result: LandingResult };

/** Director fields every consumer may read (the class in `model/director.ts` implements this). */
export interface ColonyDirectorApi {
  on(listener: (e: ColonyEvent) => void): () => void;
  /** Directive or protocol card id from the open draft. */
  pick(directiveOrProtocolId: string): void;
  reroll(): boolean;
  triggerBeacon(): boolean;
  abandon(): void;
  /** Writes the `colony:activeLanding` checkpoint (§14b law 6); W5 calls it on hide/blur and each dawn. */
  checkpoint(): void;
  /** Jumps the clock to dawn when `view().canSkipNight`; false otherwise. */
  skipNight(): boolean;
  readonly sol: number;
  readonly elapsedSeconds: number;
  readonly remainingSeconds: number;
  readonly isPaused: boolean;
  readonly ended: boolean;
  readonly outcome: SessionOutcome | null;
  readonly progress: number | null;
}

// ── settlement ──────────────────────────────────────────────────────────

export interface LandingResult {
  won: boolean; reason: string; siteId: string; rung: number;
  solsSurvived: number; timeSec: number; colonistsSaved: number; colonistsLost: number;
  data: { base: number; sols: number; win: number; orders: number; relics: number; trophies: number; mul: number; total: number };
  stars: 0 | 1 | 2 | 3; newStars: number; unlockedRung: number | null; directives: readonly string[]; protocols: readonly string[];
  /** A replayed daily (today's daily already banked): `data` is shown but was NOT granted (PRD §9). */
  practice: boolean;
}
/** `model/score.ts` (W1): banks. `computeLanding` is the same result without banking (headless). */
export type SettleLanding = (state: ColonyState, outcome: SessionOutcome, elapsedSec: number) => LandingResult;
/** `model/score.ts` (W1): stores the unbanked abandoned-result AND its `LandingSetup` under `colony:activeLanding`. */
export type CheckpointLanding = (state: ColonyState, elapsedSec: number) => void;
/** `model/score.ts` (W1): banks a stored checkpoint once, clears the key, returns it with its setup; null when none. */
export type SettlePendingLanding = () => { result: LandingResult; setup: LandingSetup } | null;

// ── UI host API (W5 game.ts → W4 src/ui/colony/*) ────────────────────────

export type SheetKind = 'build' | 'orders' | 'ledger';

/**
 * The only surface a `src/ui/colony/*` component talks to. `game.ts` builds
 * one per visit and passes it to every UI constructor / opener. Actions are
 * player intents: the host routes them to ColonyState / ColonyDirector /
 * camera / build mode and plays their feedback.
 */
export interface ColonyUiHost {
  readonly scene: Phaser.Scene;
  view(): ColonyView;
  readonly armed: BuildingId | null;
  readonly speed: 1 | 2;
  readonly paused: boolean;
  arm(def: BuildingId): void;
  disarm(): void;
  pick(id: string): void;
  reroll(): boolean;
  ship(slot: number): boolean;
  overdrive(): boolean;
  triggerBeacon(): void;
  skipNight(): boolean;
  upgrade(uid: number): boolean;
  upgradeAll(def: BuildingId): number;
  setPaused(uid: number, paused: boolean): void;
  setPinned(uid: number, pinned: boolean): void;
  demolish(uid: number): void;
  undoDemolish(): boolean;
  rebuild(col: number, row: number): boolean;
  panTo(col: number, row: number): void;
  setSpeed(speed: 1 | 2): void;
  togglePause(): void;
  openSheet(kind: SheetKind): void;
  /** Building currently shown in the BuildingCard (null = closed). */
  select(uid: number | null): void;

  // Read side + UI-owned holds (§18 amendment: folded in from the old `ui/colony/bridge.ts` cast).
  /** The live colony, READ ONLY for UI (stock, costs, buildings, map); every mutation goes through the intents above. */
  readonly model: ColonyState;
  /** Valid tiles for the armed building (0 when disarmed). */
  readonly validTileCount: number;
  /** Deposit tapped on the map: the ContextStrip BUILD chip places `def` there. */
  readonly depositChip: { def: BuildingId; col: number; row: number } | null;
  buildDepositChip(): void;
  /** Screen position of a tile's centre, written into `out`. */
  tileToScreen(col: number, row: number, out: { x: number; y: number }): void;
  /** Screen rect of tonight's arrow for `edge` AS DRAWN this frame, unioned with its "×N" label; null when not shown. */
  duskArrowRect(edge: Edge): { x: number; y: number; w: number; h: number } | null;
  /** A UI overlay holds (true) / releases (false) the director clock; holds nest. */
  holdClock(on: boolean): void;
  /** Toggles the range ring of a turret / relay (card RANGE). */
  showRange(uid: number): void;
  /** The player wants `def` but was refused for cost: processors hold its price (`ColonyState.setWant`). */
  want(def: BuildingId): void;
}

/** A persistent HUD widget: `update` runs at ≤ 10 Hz with a fresh view; it must diff before touching text. */
export interface ColonyWidget {
  update(view: ColonyView): void;
  destroy(): void;
}

/** Constructor signatures game.ts (W5) calls; W4 implements them in `src/ui/colony/*`. */
export type ColonyHudCtor = new (host: ColonyUiHost) => ColonyWidget; // ui/colony/hud.ts: ResourceStrip + TimeControls + SolBanner
export type AlertRailCtor = new (host: ColonyUiHost) => ColonyWidget; // ui/colony/alerts.ts
export type ContextStripCtor = new (host: ColonyUiHost) => ColonyWidget; // ui/colony/tray.ts
export type BuildDockCtor = new (host: ColonyUiHost) => ColonyWidget; // ui/colony/dock.ts
export type BuildingCardCtor = new (host: ColonyUiHost) => ColonyWidget & { show(uid: number | null): void; readonly uid: number | null }; // ui/colony/card.ts
export type OpenBuildSheet = (host: ColonyUiHost) => OverlayHandle; // ui/colony/buildSheet.ts
export type OpenOrdersSheet = (host: ColonyUiHost) => OverlayHandle; // ui/colony/ordersSheet.ts
export type OpenLedgerSheet = (host: ColonyUiHost) => OverlayHandle; // ui/colony/ledgerSheet.ts
export type ShowDraft = (host: ColonyUiHost, draft: Extract<ColonyEvent, { type: 'draft' }>) => { destroy(): void }; // ui/colony/draftOverlay.ts
/** ui/colony/coachBeats.ts: one instance per visit; pausing beats pause through `host`. */
export interface CoachBeats {
  onEvent(e: ColonyEvent): void;
  /** True while a pausing beat owns the screen (ESC / pause are ignored). */
  readonly active: boolean;
  destroy(): void;
}
export type CoachBeatsCtor = new (host: ColonyUiHost) => CoachBeats;
