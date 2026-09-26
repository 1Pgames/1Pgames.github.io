import Phaser from 'phaser';
import { CSS, PALETTE, TEXT, TUNING, VIEW } from '../../config';
import { SCENES } from '../../core/keys';
import { Controls } from '../../core/controls';
import { Rng } from '../../core/rng';
import { NavGrid } from '../../core/grid';
import { resetDamageClock, setDamageClock } from '../../core/damage';
import { Pool } from '../../core/pool';
import { playable, safePlay } from '../../core/anim';
import { RunDirector, type EventSpec, type WaveSpec } from '../../core/run';
import { combatBonuses, loadMeta, runLoadout, settleRun, writeRunJournal } from '../../core/progression';
import { applyEffect } from '../../core/effects';
import { sfx } from '../../core/audio';
import { setMusicIntensity, setMusicLayer, startMusic } from '../../core/music';
import { allowEffect, banner, burst, deathBeat, edgeFlash, floatText, setTimeDilation, shake, timeDilation } from '../../core/juice';
import { charmName, evolutionInfo, evolutionPlaying, playEvolution, playNewCharm, playNewWeapon, playRankUp } from '../../ui/evolveFx';
import { cardModifiers, describeCard, rollUpgradeChoices, type UpgradeDef } from '../../data/upgrades';
import { PHASES, TIMELINE_EVENTS, rollElite, wavesFor } from '../../data/waves';
import { ANIM, TEXTURE } from '../../data/art';
import { weaponDef } from '../../data/weapons';
import { zoneDef, type ZoneDef } from '../../data/zones';
import { rollGear } from '../../data/gear';
import { hazardDef } from '../../data/hazards';
import { mutatorDef, type MutatorRunParams } from '../../data/mutators';
import { Belt } from '../../data/pickups';
import type {
  BagSettlement,
  ConsumableId,
  EventKind,
  FenceOffer,
  GateCandidate,
  GateId,
  GeneratedMap,
  HudModelV2,
  KillReport,
  LootItem,
  MinimapModel,
  PoiKind,
  RunLoadoutV2,
  RunReport,
  WeaponId,
} from '../../data/types-v2';
import { generateMap } from '../../systems/mapgen';
import { Arena } from '../../systems/arena';
import { CombatSystem } from '../../systems/combat';
import { ZoneSystem } from '../../systems/zone';
import { ExtractionSystem, greedMul, type ExtractionEvent, type GateState } from '../../systems/extraction';
import { Bag, itemCodexKey } from '../../systems/bag';
import { PoiSystem } from '../../systems/poi';
import { BreakableField } from '../../objects/breakable';
import type { Enemy } from '../../objects/enemy';
import { LootPickup, type LootPayload } from '../../objects/relic';
import { Hud } from '../../ui/hud';
import { BagStrip, openBagSheet, type BagSheetHandle } from '../../ui/bagStrip';
import { Minimap } from '../../ui/minimap';
import { GateCompass, type CompassModel } from '../../ui/gateCompass';
import { ChannelBar, type ChannelBarModel } from '../../ui/channelBar';
import { showUpgradeCards, type UpgradeCardsHandle } from '../../ui/cards';
import { showPauseOverlay, type PauseModel, type PauseOverlayHandle } from '../../ui/pauseOverlay';
import { coachToast, endCoach } from '../../ui/coach';
import { holdToasts, showToast } from '../../ui/toast';
import { openSheet } from '../../ui/sheet';
import { Button } from '../../ui/button';
import { Joystick } from '../../ui/joystick';
import { BUTTON_STYLE, HUD_DEPTH, IDENTITY } from '../../ui/duskChrome';
import type { GameOverData } from '../../scenes/gameover';
import type { RunStart } from '../../scenes/hub/hub';

/**
 * `art/manifest.json` groups this slice loads. `PreloadScene` downloads only
 * these, so a game never ships another family's art. Names must match the
 * manifest `group` fields exactly; adding art for this slice means adding its
 * group here too.
 */
export const ART_GROUPS = [
  'hero',
  'enemies-light',
  'enemies-heavy',
  'elites-warden',
  'pickups-fx',
  'gates-collapse',
  'zone-castle',
  'zone-outlands',
  'zone-desert',
  'zone-winter',
  'ui-icons',
  'floors-v2',
  'props-v2',
  'landmarks',
  'enemies-v2',
  'icons-v2',
  'poi',
  'gates-v2',
  'breakables',
  'pickups-v2',
  'weapon-fx',
  'boss-fx',
  'fx-v2',
  'icons-v3',
  'weapon-fx-v1',
  'weapon-fx-v2',
  'icons-v4',
  'props-v3a',
  'props-v3b',
] as const;

/** Ground loot arms after this beat so an overflow drop is not re-vacuumed at once. */
const LOOT_ARM_MS = 400;
/** Gate-open identity violet (#8546dd) as a CSS colour, for the callout stroke. */
const GATE_OPEN_CSS = `#${IDENTITY.gateOpen.toString(16).padStart(6, '0')}`;
/** A kept-but-paused gate hold (hero outside the ring) is drawn in this grey. */
const CHANNEL_PAUSED_TINT = 0x7e7376;
/**
 * §5.28 Wicket: the Ash Locket lies this far from spawn, ON SCREEN (critic
 * v2b M5: at 400 px it sat at the screen edge under the Gate A chip).
 */
const WICKET_LOCKET_PX = 240;
/** The locket is collected by walking onto it (not vacuumed), so run 1 teaches the pickup. */
const LOCKET_COLLECT_PX = 110;
/** Screen band the locket must land in (design px): clear of the HUD band, compass chips and the stick. */
const LOCKET_SCREEN = { left: 180, right: 540, top: 470, bottom: 1000 } as const;
/** …and never under the joystick's resting ring (bottom-left). */
const LOCKET_STICK_KEEPOUT = { right: 300, top: 950 } as const;
/** Beacon art over the locket until it is picked up. */
const LOCKET_BEACON = 'fx-chest-beam';
/** Minimum angle between the locket and the Gate A bearing from spawn. */
const LOCKET_OFF_GATE_RAD = Math.PI / 3;
/** Beacon draws above tall props (≤ 11) and prop tops (30), below HUD. */
const LOCKET_BEACON_DEPTH = 31;
/** Screen box (design px) inside which the locket counts as visible; the arrow rides its edge otherwise. */
const LOCKET_ARROW_BOX = { left: 70, right: 650, top: 470, bottom: 1010 } as const;
const WICKET_LOCKET_UID = 'wicket-ash-locket';
/** The 'Grab the Ash Locket' coach beat shows this many seconds into the Wicket. */
const WICKET_LOCKET_COACH_S = 2;
/** §13.2 low-HP heartbeat below this HP ratio (one beat per 1.2 s). */
const LOW_HP_RATIO = 0.3;
/** A POI XP burst drops as this many orbs (Loot sizes the burst in `takeXpBursts`). */
const XP_BURST_ORBS = 6;
/** Modifier tag for the low-level orb vacuum (`TUNING.xp.earlyVacuum`). */
const EARLY_VACUUM_SOURCE = 'early:vacuum';
/** Channel coach fires when the hero first comes this close to an open gate. */
const CHANNEL_COACH_PX = 300;
/** Breather toast only when the hero is actually clear: fewer than this many bodies within `BREATHER_CLEAR_PX`. */
const BREATHER_TOAST_MAX_NEAR = 8;
const BREATHER_CLEAR_PX = 300;
/** Gate callout on-screen life (hold + fade), during which the toast lane waits. */
const GATE_CALLOUT_MS = 1200;
/** Draft-time world still: texture key and depth (under every world object's replacement, above nothing). */
const FREEZE_KEY = 'draft-world-still';
const FREEZE_DEPTH = -1000;
/** Minimum spacing between two gate callouts' start times. */
const CALLOUT_GAP_MS = 800;
/** Zone boss arrives this far from the hero, on the way to Gate C, when Gate C is far. */
const BOSS_NEAR_PX = 900;
/** Gate C counts as "near" (boss spawns at the arch) inside this range of the hero. */
const BOSS_AT_GATE_PX = 1600;
/** Gate arch display size as a multiple of `TUNING.gate.radius`. */
const GATE_ART_SCALE = 2.4;
const GATE_SPENT_ALPHA = 0.4;
/** Collapse curtain segment geometry (see `paintCollapseCurtain`). */
const COLLAPSE_SEGMENT_H = 150;
const COLLAPSE_SEGMENT_W = 130;
const COLLAPSE_SEGMENT_OVERLAP = 1.03;
const COLLAPSE_SEGMENT_POOL = 32;
/** Bag quick-sheet runs the world at this fraction (§14.11, not a pause). */
const BAG_SHEET_TIMESCALE = 0.2;
/** Arena prop culling cadence (§16.1 E3). */
const CULL_EVERY_MS = 250;
/** Candidate park bearings around Gate B (the one farthest from the hero wins). */
const GUARD_BEARINGS = 16;
/** Gate B guard pack adds (the elite is rolled). */
const GATE_GUARD_ADD_ID = 'husk';
/** §5.15.4 Rimeheart: Frost Salt pickups freeze this long. */
const RIMEHEART_FREEZE_MS = 5000;
/** Sanctum Homeward (`e_speedgate`): `loadout.speedNearGateMul` applies within this range of an open gate. */
const SPEED_GATE_PX = 600;
const SPEED_GATE_SOURCE = 'sanctum:e_speedgate';
/** Den bone walls use this texture when loaded. */
const DEN_WALL_TEXTURE = 'poi-den-wall';

const GATE_RING_STYLE: Record<GateState, { color: number; alpha: number }> = {
  closed: { color: 0x7e7376, alpha: 0.5 },
  open: { color: IDENTITY.gateOpen, alpha: 0.95 },
  closing: { color: 0xe8c547, alpha: 0.95 },
  spent: { color: 0x3a3440, alpha: 0.4 },
};

const SHRINE_COPY: Partial<Record<PoiKind, string>> = {
  shrine_blood: 'BLOOD SHRINE — 2 UPGRADES',
  shrine_gilt: 'GILT SHRINE — SHARDS +30%',
  shrine_bone: 'BONE SHRINE',
  shrine_grave: 'GRAVE SHRINE — HEALED',
  shrine_curse: 'CURSE SHRINE — ELITES COME',
};

const EVENT_COPY: Record<EventKind, string> = {
  ev_caravan: 'GILDED CARAVAN',
  ev_vigil: 'BELL VIGIL',
  ev_rising: 'GRAVE RISING',
};

interface GateVisual {
  gate: GateCandidate;
  ring: Phaser.GameObjects.Arc;
  sprite: Phaser.GameObjects.Sprite | null;
  state: GateState | null;
}

interface GroundLoot {
  pickup: LootPickup;
  payload: LootPayload;
}

/**
 * Integrator scene for Duskhaul V2 (PRD-V2 §16.2 step 3): wires mapgen →
 * Arena → NavGrid → Zone → Combat (+Weapons, breakables) → POI → Bag →
 * Extraction → HUD/minimap/bag strip/compass/cards/pause/coach → finish
 * (`bag.settle` → `settleRun` → Results). Every system owns its rules; this
 * file only routes callbacks and feeds read models.
 *
 * Public fields are the cert driver's / `window.__GAME__` probes.
 */
export class GameScene extends Phaser.Scene {
  map!: GeneratedMap;
  arena!: Arena;
  nav!: NavGrid;
  combat!: CombatSystem;
  zoneSystem!: ZoneSystem;
  extraction!: ExtractionSystem;
  bag!: Bag;
  poi!: PoiSystem;
  field!: BreakableField;
  belt!: Belt;
  director!: RunDirector;
  loadout!: RunLoadoutV2;
  zone!: ZoneDef;

  /** False until `build` has run (map generation is deferred one frame). */
  built = false;
  paused = false;
  ended = false;
  drafting = false;
  pendingDrafts = 0;
  bossActive = false;
  kills = 0;
  taken: string[] = [];
  banished: string[] = [];

  private start: RunStart = { zone: 'castle', hazard: 1, mode: 'normal' };
  private rng!: Rng;
  private simTimeMs = 0;
  private controls!: Controls;
  private joystick!: Joystick;
  private hud!: Hud;
  private bagStrip!: BagStrip;
  private minimap!: Minimap;
  private compass!: GateCompass;
  private channelBar!: ChannelBar;
  private cards: UpgradeCardsHandle | null = null;
  private pauseOverlay: PauseOverlayHandle | null = null;
  private bagSheet: BagSheetHandle | null = null;
  private fenceOpen = false;
  private rerolls = 0;
  private banishes = 0;
  private mutRun: MutatorRunParams = {};
  private gates: GateCandidate[] = [];
  private gateVisuals: GateVisual[] = [];
  private collapseSegments: Phaser.GameObjects.Sprite[] = [];
  private channelGfx!: Phaser.GameObjects.Graphics;
  private collapseGfx!: Phaser.GameObjects.Graphics;
  private lootPool!: Pool<LootPickup>;
  private ground: GroundLoot[] = [];

  private tookHit = false;
  private collapseBonus = 0;
  private collapseElitesSpawned = 0;
  private nextEliteSwapS = 0;
  private gateGuardPlaced = false;
  private giltUntilS = -1;
  private nextBellWaveS = Infinity;
  private journalAccMs = 0;
  private cullAccMs = 0;
  private lowFpsMs = 0;
  private lowTier = false;
  private fireFlashAcc = 0;
  private movedPx = 0;
  private lastX = 0;
  private lastY = 0;
  private attackCoached = false;
  private gateCoached = false;
  private channelCoached = false;
  private locketBeacon: Phaser.GameObjects.Sprite | null = null;
  /** Where the Wicket Ash Locket lies until it is picked up. */
  private locketAt: { x: number; y: number } | null = null;
  private locketArrow: Phaser.GameObjects.Container | null = null;
  private locketCoached = false;
  /** World objects hidden behind the draft still (`freezeWorld`). */
  private readonly frozenWorld: (Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Visible)[] = [];
  private freezeImage: Phaser.GameObjects.Image | null = null;
  private calloutQueue: { label: string; strokeColor: string }[] = [];
  private calloutBusyUntil = 0;
  private earlyVacuum = false;
  private mapCoached = false;
  private itemCoached = false;
  private channelWasActive = false;
  private channelQuarter = 0;
  /** Homeward speed mod currently applied (toggled on gate proximity). */
  private speedGateOn = false;
  /** Gates whose channel already granted Gloamwalk (`e_gloamwalk`, once per gate). */
  private readonly gloamwalked = new Set<GateId>();

  // RunReport tallies
  private killsByEnemy: Record<string, number> = {};
  private killsByWeapon: Record<string, number> = {};
  private affixKills: Record<string, number> = {};
  private eliteKills = 0;
  private bossKilled = false;
  private minHpRatio = 1;
  private itemsSeen = new Set<string>();
  private evolutions: WeaponId[] = [];

  private readonly threatBuf: { x: number; y: number; kind: 'elite' | 'boss' }[] = [];
  private readonly compassThreats: { x: number; y: number; boss: boolean }[] = [];
  private readonly channelModel: ChannelBarModel = { active: false, kind: 'gate', gateId: null, poiKind: null, progress: 0, interrupted: false, paused: false };

  private readonly onTabVisibility = (): void => {
    if (document.hidden) return;
    if (this.ended || this.paused || this.drafting) return;
    this.togglePause();
  };

  constructor() {
    super(SCENES.game);
  }

  /** `scene.start(SCENES.game, RunStart)` — the Hub's DESCEND, preload's Wicket route. */
  init(data: Partial<RunStart> = {}): void {
    const meta = loadMeta();
    // §5.28: until the Wicket is done (extracted, or `ftue.maxRetries` deaths),
    // every run IS the Wicket, whatever route asked for a run.
    if (!meta.flags.ftueDone) {
      this.start = { zone: 'castle', hazard: 1, mode: 'ftue', seed: 'wicket' };
      return;
    }
    const zone = data.zone ?? meta.selection.zone;
    this.start = {
      zone,
      hazard: data.hazard ?? meta.selection.hazard[zone] ?? 1,
      mode: data.mode ?? 'normal',
      ...(data.seed !== undefined ? { seed: data.seed } : {}),
    };
  }

  /**
   * Map generation on the 24576² world takes ~300-550 ms, so the scene first
   * paints a GENERATING MAP label, lets one frame render it, and only then
   * builds the run (`build`). `update` is inert until `built`.
   */
  create(): void {
    this.resetState();
    this.built = false;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    const label = this.add
      .text(VIEW.width / 2, VIEW.height / 2, 'GENERATING MAP…', { ...TEXT.heading, fontSize: '40px', color: CSS.inkSoft })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(5000);
    // After the frame that drew the label, wait two animation frames so the
    // browser has composited it before generateMap blocks the main thread.
    this.game.events.once(Phaser.Core.Events.POST_RENDER, () => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!this.sys.isActive()) return;
          label.destroy();
          this.build();
          this.built = true;
        }),
      );
    });
  }

  private build(): void {
    setDamageClock(() => this.simTimeMs);

    // Meta is read HERE and only here (§10): one latch per run.
    this.loadout = runLoadout(this.start);
    const loadout = this.loadout;
    this.zone = zoneDef(loadout.zone);
    this.rng = new Rng(`run:${loadout.seed}`);
    for (const id of loadout.mutators) Object.assign(this.mutRun, mutatorDef(id).run);
    this.rerolls = loadout.rerollsPerRun;
    this.banishes = loadout.banishesPerRun;
    const ftue = loadout.mode === 'ftue';

    // E1 → E3 → E4
    this.map = generateMap(this.zone, loadout.seed, { ftue, gateWindowBonusS: loadout.gateWindowBonusS });
    this.gates = this.runGates(this.map.gates, ftue);
    this.arena = new Arena(this, this.map, this.zone);
    this.nav = NavGrid.fromBlocked(this.map.nav.cols, this.map.nav.rows, this.map.nav.cell, this.map.nav.blocked);

    // E8/E9 combat (+ weapons inside)
    this.combat = new CombatSystem(
      this,
      this.arena,
      {
        onEnemyKilled: (k) => this.onEnemyKilled(k),
        onPlayerHit: (ratio) => this.onPlayerHit(ratio),
        onPlayerDied: (killer) => this.die(killer),
        onPickup: (kind, value) => this.onPickup(kind, value),
        onBreakableHit: () => {
          if (allowEffect('smash-sfx', 6)) sfx('smash', { volume: 0.7 });
        },
      },
      loadout,
    );
    this.combat.setDamageBonuses(combatBonuses());
    this.combat.setNav(this.nav, this.map);
    this.combat.setRunMutators({
      enemySpeedMul: this.mutRun.enemySpeedMul ?? 1,
      densityMul: this.mutRun.maxAliveMul ?? 1,
      maxAliveCap: this.mutRun.maxAliveCap ?? TUNING.enemy.maxAlive,
    });
    this.itemsSeen.add(`wpn:${loadout.startWeapon}`);

    const player = this.combat.player;
    // Sanctum 'Fore-Rite' (b_startlevel): start above L1 and cash in each skipped level as a draft.
    if (loadout.startLevel > player.level) {
      const levels = loadout.startLevel - player.level;
      player.level = loadout.startLevel;
      this.queueDraft(levels);
    }
    this.cameras.main.startFollow(player, true, TUNING.arena.cameraLerp, TUNING.arena.cameraLerp);
    this.cameras.main.setFollowOffset(0, TUNING.arena.cameraOffsetY);
    this.arena.setFocus(player);
    this.arena.updateCulling(this.cameras.main);
    this.lastX = player.x;
    this.lastY = player.y;

    // E6 zone hazards
    this.zoneSystem = new ZoneSystem(this, this.zone, this.map, {
      onHazardHit: (amount, x, y) => this.onHazardHit(amount, x, y),
      onHazardDrain: (amount) => this.onHazardDrain(amount, 'the dark'),
      onHazardTelegraph: (_kind, x, y) => {
        if (this.onScreen(x, y)) sfx('whoosh', { volume: 0.3 });
      },
      onHazardStrike: (_kind, x, y) => {
        if (this.onScreen(x, y)) burst(this, x, y, IDENTITY.hazardAmber, 10, 200);
      },
    });
    this.zoneSystem.setSubject(player);

    // E22 bag + belt, E20 breakables
    this.bag = new Bag({ cells: loadout.bagCells, casketSlots: loadout.casketSlots }, TUNING.bag);
    this.belt = new Belt(loadout.belt);
    this.field = new BreakableField(this, this.map, new Rng(`breakables:${loadout.seed}`), loadout.breakableDropMul, (drop, x, y) => {
      switch (drop.kind) {
        case 'shards':
          this.combat.dropShards(x, y, drop.coins);
          return;
        case 'xp':
          this.combat.dropXp(x, y, drop.orbs, drop.value);
          return;
        case 'pickup':
          if (drop.id === 'pk_bread' && this.mutRun.noGraveBread === true) return;
          this.dropLoot({ kind: 'pickup', id: drop.id }, x, y, null);
          return;
        case 'item':
          this.dropLoot({ kind: 'item', item: { kind: 'gear', item: this.rollItem(drop.tierBias, 0) } }, x, y, null);
          return;
      }
    });
    this.combat.setBreakables(this.field);

    // E18/E19 POIs
    this.poi = new PoiSystem(this, this.map, {
      rng: new Rng(`poi:${loadout.seed}`),
      zone: this.zone,
      loadout,
      callbacks: {
        onLoot: (items, shards, x, y) => {
          sfx('chest', { volume: 0.9 });
          if (shards > 0) this.bankShards(shards, x, y);
          items.forEach((item, i) => this.dropLoot({ kind: 'item', item }, x + (i - (items.length - 1) / 2) * 60, y + 40, null));
        },
        onEliteChest: (x, y, boss) => this.onEliteChest(x, y, boss),
        onShrine: (kind) => this.onShrine(kind),
        onEvent: (kind, phase) => this.onPoiEvent(kind, phase),
        onFence: (offers) => this.openFence(offers),
        onVein: (shards) => {
          sfx('smash', { rate: 0.7 });
          sfx('coin');
          this.bankShards(shards, this.combat.player.x, this.combat.player.y);
        },
        onLore: () => {
          sfx('pickup', { volume: 0.5, rate: 0.8 });
          showToast(this, { text: 'LORE STONE READ — see CODEX', key: 'lore' });
        },
        onBell: (rung) => {
          this.extraction.ringBell();
          sfx('gate', { volume: 0.5, rate: 0.8 });
          showToast(this, { text: `BELL ${rung}/${TUNING.gates.bell.bells} RUNG`, key: 'bell' });
        },
        requestSpawn: (spec) => this.combat.spawnPopulation(spec),
        onDenLock: (locked) => {
          if (!locked) return;
          const walls = this.poi.denWalls();
          if (walls.length === 0) return;
          const tex = this.textures.exists(DEN_WALL_TEXTURE) ? DEN_WALL_TEXTURE : TEXTURE.gateClosed;
          this.combat.walls(walls, walls[0]?.r ?? 130, TUNING.midboss.lockS * 1000, tex);
          banner(this, 'THE DEN SEALS', CSS.warn, 500);
        },
      },
    });

    // E27 extraction
    this.extraction = new ExtractionSystem(
      this.gates,
      {
        channelMs: TUNING.extract.channelMs,
        radius: TUNING.gate.radius,
        collapseAtS: ftue ? TUNING.ftue.runS : loadout.hazardExtras.collapseAtS,
        closingWarnS: TUNING.gate.closingWarnS,
        channel: TUNING.extract,
        collapse: TUNING.collapse,
      },
      loadout,
      {
        payCondition: (gate) => {
          if (gate.kind === 'toll') {
            const paid = this.bag.payToll(loadout.tollPct, TUNING.gates.toll.min);
            if (paid > 0) floatText(this, gate.x, gate.y - 120, `TOLL −${paid} ◆`, CSS.warn, 36);
            else showToast(this, { text: `TOLL NEEDS ${TUNING.gates.toll.min} ◆`, key: 'toll' });
            return paid > 0;
          }
          if (gate.kind === 'offering') {
            const given = this.bag.takeHighestValue();
            if (given === null) showToast(this, { text: 'THE ALTAR WANTS AN ITEM', key: 'offering' });
            return given !== null;
          }
          return true;
        },
        onEvent: (e, gate) => this.onExtractionEvent(e, gate),
      },
    );
    this.combat.setSpawnFilter((x, y) => !this.extraction.spawnSuppressed(x, y));

    // E38 director
    this.director = new RunDirector(
      this,
      wavesFor(this.zone.id),
      PHASES,
      (id, _index, _total, pattern) => this.onDirectorSpawn(id, pattern),
      {
        onPhaseChange: () => sfx('whoosh', { volume: 0.5 }),
        onEvent: (event) => this.onScriptedEvent(event),
        events: ftue ? TIMELINE_EVENTS.filter((e) => e.kind === 'breather') : TIMELINE_EVENTS,
      },
    );
    if (this.mutRun.bellWaveEveryS !== undefined) this.nextBellWaveS = this.mutRun.bellWaveEveryS;

    this.lootPool = new Pool<LootPickup>(() => new LootPickup(this), (p) => p.despawn(), 16);
    this.buildWorldVisuals();
    this.tickEarlyVacuum();
    if (ftue) this.placeWicketLocket();

    // E39-E44 UI
    this.hud = new Hud(this, {
      onPause: () => this.togglePause(),
      onBelt: (slot) => this.useBelt(slot),
      gateTicksS: this.gates.filter((g) => g.id !== 'x').map((g) => g.opensS),
      collapseAtS: ftue ? TUNING.ftue.runS : loadout.hazardExtras.collapseAtS,
    });
    this.bagStrip = new BagStrip(this, () => this.toggleBagSheet());
    this.minimap = new Minimap(this, this.map, loadout.minimapRevealPx);
    this.minimap.onPeek(() => coachToast(this, 'map'));
    this.compass = new GateCompass(this, loadout.previewS);
    this.channelBar = new ChannelBar(this);
    this.joystick = new Joystick(this);
    this.controls = new Controls(this);

    this.input.keyboard?.on('keydown-ESC', () => this.togglePause());
    this.input.keyboard?.on('keydown-P', () => this.togglePause());
    document.addEventListener('visibilitychange', this.onTabVisibility);

    this.cameras.main.fadeIn(220, 0, 0, 0);
    startMusic('run');
    setMusicIntensity(0.25);
    this.refreshJournal();

    if (ftue) coachToast(this, 'move');
    if (loadout.belt.some((b) => b !== null)) coachToast(this, 'belt');
    this.installDebugHandle();
  }

  private resetState(): void {
    this.paused = false;
    this.ended = false;
    this.dying = false;
    this.drafting = false;
    this.pendingDrafts = 0;
    this.bossActive = false;
    this.kills = 0;
    this.taken = [];
    this.banished = [];
    this.simTimeMs = 0;
    this.cards = null;
    this.pauseOverlay = null;
    this.bagSheet = null;
    this.fenceOpen = false;
    this.mutRun = {};
    this.gateVisuals = [];
    this.collapseSegments = [];
    this.ground = [];
    this.tookHit = false;
    this.collapseBonus = 0;
    this.collapseElitesSpawned = 0;
    this.nextEliteSwapS = TUNING.wave.compositionFromS;
    this.gateGuardPlaced = false;
    this.giltUntilS = -1;
    this.nextBellWaveS = Infinity;
    this.journalAccMs = 0;
    this.cullAccMs = 0;
    this.lowFpsMs = 0;
    this.lowTier = false;
    this.fireFlashAcc = 0;
    this.movedPx = 0;
    this.attackCoached = false;
    this.gateCoached = false;
    this.channelCoached = false;
    this.locketBeacon = null;
    this.locketAt = null;
    this.locketArrow = null;
    this.locketCoached = false;
    this.calloutQueue = [];
    this.frozenWorld.length = 0;
    this.freezeImage = null;
    this.calloutBusyUntil = 0;
    this.earlyVacuum = false;
    this.mapCoached = false;
    this.itemCoached = false;
    this.channelWasActive = false;
    this.channelQuarter = 0;
    this.speedGateOn = false;
    this.gloamwalked.clear();
    this.killsByEnemy = {};
    this.killsByWeapon = {};
    this.affixKills = {};
    this.eliteKills = 0;
    this.bossKilled = false;
    this.minHpRatio = 1;
    this.itemsSeen = new Set();
    this.evolutions = [];
  }

  /**
   * §5.28: the Wicket's first item, a Worn Ash Locket, lies ~400 px ahead of
   * spawn toward Gate A, so run 1 teaches pickup → bag → casket.
   */
  private placeWicketLocket(): void {
    const player = this.combat.player;
    const a = this.gates.find((g) => g.id === 'a');
    // Offset ≥ 60° from the Gate A bearing so the beacon never covers the
    // Gate A compass marker at spawn (QA v2c NEW-5); try both sides.
    const gateBearing = a === undefined ? Math.PI / 2 : Math.atan2(a.y - player.y, a.x - player.x);
    const view = this.cameras.main;
    // Where the hero sits on screen once the follow settles (camera centre + offset).
    const heroSX = view.width / 2;
    const heroSY = view.height / 2 + TUNING.arena.cameraOffsetY;
    let spot: { x: number; y: number } | null = null;
    // Prefer the direction of Gate A, then fan out ±30° steps until a walkable
    // spot lands inside the on-screen band.
    for (let step = 0; step < 16 && spot === null; step += 1) {
      const off = LOCKET_OFF_GATE_RAD + Math.floor(step / 2) * (Math.PI / 12);
      const angle = gateBearing + (step % 2 === 0 ? off : -off);
      for (let d = WICKET_LOCKET_PX; d >= 180; d -= 20) {
        const sx = heroSX + Math.cos(angle) * d;
        const sy = heroSY + Math.sin(angle) * d;
        if (sx < LOCKET_SCREEN.left || sx > LOCKET_SCREEN.right || sy < LOCKET_SCREEN.top || sy > LOCKET_SCREEN.bottom) continue;
        if (sx < LOCKET_STICK_KEEPOUT.right && sy > LOCKET_STICK_KEEPOUT.top) continue;
        const x = player.x + Math.cos(angle) * d;
        const y = player.y + Math.sin(angle) * d;
        if (!this.combat.spawnable(x, y)) continue;
        spot = { x, y };
        break;
      }
    }
    const at = spot ?? { x: player.x, y: player.y + 200 };
    const locket: LootItem = {
      kind: 'gear',
      item: { uid: WICKET_LOCKET_UID, base: 'ash-locket', slot: 'amulet', rarity: 2, level: 1, affixes: [{ id: 'a_hp', value: 8 }] },
    };
    this.dropLoot({ kind: 'item', item: locket }, at.x, at.y, null);
    this.locketAt = at;
    this.buildLocketArrow();
    if (this.textures.exists(LOCKET_BEACON)) {
      // Above tall props and their tops (critic v2d: novices never saw the light).
      this.locketBeacon = this.add.sprite(at.x, at.y - 90, LOCKET_BEACON).setOrigin(0.5, 0.65).setDepth(LOCKET_BEACON_DEPTH).setAlpha(0.95);
      safePlay(this.locketBeacon, LOCKET_BEACON);
    }
  }

  /** Screen-edge gilt arrow + "LOCKET" chip toward the Wicket locket while it is off screen. */
  private buildLocketArrow(): void {
    const g = this.add.graphics();
    g.fillStyle(IDENTITY.gilt, 1);
    g.lineStyle(3, 0x03040b, 1);
    g.beginPath();
    g.moveTo(22, 0);
    g.lineTo(-14, -16);
    g.lineTo(-14, 16);
    g.closePath();
    g.fillPath();
    g.strokePath();
    const chip = this.add
      .text(0, 34, 'LOCKET', { ...TEXT.label, fontSize: '22px', color: CSS.ink, stroke: '#03040b', strokeThickness: 6 })
      .setOrigin(0.5);
    this.locketArrow = this.add.container(0, 0, [g, chip]).setScrollFactor(0).setDepth(HUD_DEPTH.compass).setVisible(false);
  }

  private tickLocketArrow(): void {
    const arrow = this.locketArrow;
    const at = this.locketAt;
    if (arrow === null || at === null) return;
    const view = this.cameras.main.worldView;
    const sx = at.x - view.x;
    const sy = at.y - view.y;
    const m = LOCKET_ARROW_BOX;
    const onScreen = sx >= m.left && sx <= m.right && sy >= m.top && sy <= m.bottom;
    arrow.setVisible(!onScreen);
    if (onScreen) return;
    const cx = VIEW.width / 2;
    const cy = (m.top + m.bottom) / 2;
    const angle = Math.atan2(sy - cy, sx - cx);
    // Clamp onto the box edge along the bearing.
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const tx = dx === 0 ? Infinity : ((dx > 0 ? m.right : m.left) - cx) / dx;
    const ty = dy === 0 ? Infinity : ((dy > 0 ? m.bottom : m.top) - cy) / dy;
    const t = Math.min(tx, ty);
    arrow.setPosition(cx + dx * t, cy + dy * t);
    (arrow.list[0] as Phaser.GameObjects.Graphics).setRotation(angle);
  }

  /** FTUE keeps only Gate A (§5.28); Early Dusk shifts timed gates earlier (§5.24). */
  private runGates(gates: readonly GateCandidate[], ftue: boolean): GateCandidate[] {
    const shift = this.mutRun.gateShiftS ?? 0;
    return gates
      .filter((g) => !ftue || g.id === 'a')
      .map((g) =>
        shift === 0 || g.kind !== 'timed'
          ? g
          : { ...g, opensS: Math.max(0, g.opensS + shift), closesS: g.closesS === null ? null : Math.max(0, g.closesS + shift) },
      );
  }

  /** `window.__GAME__.scene.getScene('Game')` already exposes this scene; this names the run's handles for the cert driver. */
  private installDebugHandle(): void {
    Reflect.set(window, '__RUN__', () => ({
      map: this.map,
      arena: this.arena,
      nav: this.nav,
      combat: this.combat,
      extraction: this.extraction,
      bag: this.bag,
      poi: this.poi,
    }));
  }

  private teardown(): void {
    document.removeEventListener('visibilitychange', this.onTabVisibility);
    if (!this.built) {
      resetDamageClock();
      return;
    }
    this.cards?.destroy();
    this.pauseOverlay?.destroy();
    this.bagSheet?.close();
    this.minimap?.destroy();
    this.compass?.destroy();
    this.channelBar?.destroy();
    this.bagStrip?.destroy();
    this.zoneSystem?.destroy();
    this.poi?.destroy();
    this.field?.destroy();
    for (const g of this.ground) g.pickup.despawn();
    this.ground.length = 0;
    // Combat/Arena bodies die with the scene's physics world (which shuts down
    // before this listener runs); their destroy() is for in-scene rebuilds only.
    this.time.timeScale = 1;
    resetDamageClock();
  }

  // === frame ================================================================

  update(_time: number, rawDelta: number): void {
    if (!this.built || this.ended) return;
    // Every slow-mo source (bag sheet, evolution peak, hitstop) composes in core/juice.
    const delta = rawDelta * timeDilation(this);

    this.controls.update();
    const player = this.combat.player;
    if (this.controls.axisX !== 0 || this.controls.axisY !== 0) player.setAxis(this.controls.axisX, this.controls.axisY);
    else player.setAxis(this.joystick.vector.x, this.joystick.vector.y);

    const running = !this.drafting && !this.paused && !this.fenceOpen;
    if (running) {
      this.simTimeMs += delta;
      this.director.update(delta);
      this.combat.update(delta, this.runDifficulty);
      if (this.ended) return;
      this.zoneSystem.update(delta, this.director.elapsedSeconds);

      const hero = { x: player.x, y: player.y, hpRatio: player.health.ratio };
      this.field.update(hero);
      this.poi.update(delta, hero, (x, y, r) => this.combat.enemiesInRing(x, y, r), this.tookHit);
      const gate = this.extraction.channelingGate;
      const g = gate === null ? undefined : this.gates.find((c) => c.id === gate);
      const contest = g === undefined ? undefined : this.combat.enemiesInRing(g.x, g.y, TUNING.gate.radius);
      this.extraction.update(delta, player.x, player.y, this.tookHit, contest);
      this.tookHit = false;
      this.tickGateBoons();
      if (this.ended) return;
      this.belt.update(delta);
      this.tickCollapse(delta);
      if (this.ended) return;
      this.tickBeats();
      this.tickGround();
      this.tickPoiXp();
      for (const pk of this.poi.takePickups()) {
        if (pk.id === 'pk_bread' && this.mutRun.noGraveBread === true) continue;
        this.dropLoot({ kind: 'pickup', id: pk.id }, pk.x, pk.y, null);
      }
      this.tickEarlyVacuum();

      if (player.health.ratio < LOW_HP_RATIO && player.health.hp > 0 && allowEffect('heartbeat', 1 / 1.2)) sfx('heartbeat');
      const levels = this.combat.takeLevelUps();
      if (levels > 0) this.queueDraft(levels);
      if (this.combat.takeRevived()) {
        banner(this, 'LAST RITE', CSS.good, 500);
        sfx('levelup', { volume: 0.5, rate: 0.8 });
      }
      this.drainDrafts();

      this.journalAccMs += delta;
      if (this.journalAccMs >= 1000) {
        this.journalAccMs = 0;
        this.refreshJournal();
      }
      const pressure = this.bossActive || this.extraction.collapse?.active === true ? 1 : 0.25 + 0.75 * Math.min(1, this.director.difficulty / 2.6);
      setMusicIntensity(pressure);
      this.tickCoach(player.x, player.y);
    }

    if (this.freezeImage === null) this.cullAccMs += rawDelta;
    if (this.cullAccMs >= CULL_EVERY_MS) {
      this.cullAccMs = 0;
      this.arena.updateCulling(this.cameras.main);
    }
    if (this.freezeImage === null) this.tickPerf(rawDelta);
    if (this.calloutQueue.length > 0) this.pumpCallouts();
    this.tickLocketArrow();
    this.redrawWorld();
    this.feedUi();
  }

  private get runDifficulty(): number {
    return this.director.difficulty * this.zone.threatBase * this.loadout.threatMul * (this.mutRun.enemyHpMul ?? 1) + this.collapseBonus;
  }

  private get collapseAtS(): number {
    return this.loadout.mode === 'ftue' ? TUNING.ftue.runS : this.loadout.hazardExtras.collapseAtS;
  }

  private get elapsedS(): number {
    return this.extraction.elapsedS;
  }

  private tickPerf(deltaMs: number): void {
    if (this.lowTier) return;
    if (this.game.loop.actualFps < TUNING.perf.lowTierFps) this.lowFpsMs += deltaMs;
    else this.lowFpsMs = 0;
    if (this.lowFpsMs < TUNING.perf.lowTierWindowMs) return;
    this.lowTier = true;
    this.arena.setLowTier(true);
    this.combat.setLowTier(true);
  }

  /**
   * Gate-side Sanctum boons folded into the loadout: Homeward (`speedNearGateMul`
   * within `SPEED_GATE_PX` of an open gate) and Gloamwalk (`gloamwalkMs` of
   * i-frames when a gate channel starts, once per gate).
   */
  private tickGateBoons(): void {
    const player = this.combat.player;
    if (this.loadout.speedNearGateMul !== 1) {
      const near = !this.extraction.extracted && this.extraction.nearOpenGate(player.x, player.y, SPEED_GATE_PX);
      if (near !== this.speedGateOn) {
        this.speedGateOn = near;
        if (near) player.applyModifier({ stat: 'moveSpeed', mul: this.loadout.speedNearGateMul - 1, source: SPEED_GATE_SOURCE });
        else player.stats.removeBySource(SPEED_GATE_SOURCE);
      }
    }
    const gate = this.extraction.channelingGate;
    if (this.loadout.gloamwalkMs > 0 && gate !== null && this.extraction.channelProgress > 0 && !this.gloamwalked.has(gate)) {
      this.gloamwalked.add(gate);
      player.health.grantIframes(this.loadout.gloamwalkMs);
      floatText(this, player.x, player.y - 100, 'GLOAMWALK', GATE_OPEN_CSS, 34);
    }
  }

  private tickCoach(x: number, y: number): void {
    this.movedPx += Math.hypot(x - this.lastX, y - this.lastY);
    this.lastX = x;
    this.lastY = y;
    if (this.movedPx >= 200) endCoach(this, 'move');
    const t = this.elapsedS;
    if (!this.locketCoached && this.locketAt !== null && t >= WICKET_LOCKET_COACH_S) {
      this.locketCoached = true;
      coachToast(this, 'locket');
    }
    if (!this.attackCoached && t >= 3) {
      this.attackCoached = true;
      coachToast(this, 'attack');
    }
    const a = this.gates.find((g) => g.id === 'a');
    if (!this.gateCoached && a !== undefined && t >= a.opensS - 30) {
      this.gateCoached = true;
      coachToast(this, 'gate');
    }
    // Channel coach on first APPROACH to an open gate (critic v2b M5), not at open time.
    if (!this.channelCoached) {
      for (const g of this.gates) {
        const st = this.extraction.state(g.id);
        if (st !== 'open' && st !== 'closing') continue;
        if ((x - g.x) ** 2 + (y - g.y) ** 2 > CHANNEL_COACH_PX * CHANNEL_COACH_PX) continue;
        this.channelCoached = true;
        coachToast(this, 'channel');
        break;
      }
    }
    if (!this.mapCoached && this.poi.minimap().length > 0) {
      this.mapCoached = true;
      coachToast(this, 'map');
    }
  }

  private refreshJournal(): void {
    if (this.ended) return;
    const view = this.bag.view();
    writeRunJournal({
      version: 2,
      zone: this.loadout.zone,
      hazard: this.loadout.hazard,
      mode: this.loadout.mode,
      seed: this.loadout.seed,
      classId: this.loadout.classId,
      items: view.casket.map((c) => c.item),
      shards: this.bag.shards,
      elapsedS: this.elapsedS,
    });
  }

  // === spawning =============================================================

  private onDirectorSpawn(id: string, pattern: WaveSpec['pattern']): void {
    if (this.extraction.collapse?.active === true && TUNING.collapse.stopTrashDrip) return;
    const resolved = this.zoneSystem.pickSpawnId(id);
    if (this.maybeSwapToElite()) return;
    this.combat.spawn(resolved, this.runDifficulty, pattern);
    // Gilt Shrine ×1.5, Rally banner and Crowded Graves ride the same drip.
    const extra = (this.elapsedS < this.giltUntilS ? TUNING.poi.shrines.gilt.spawnMul : 1) * this.combat.rallyMul() * (this.mutRun.maxAliveMul ?? 1) - 1;
    if (extra > 0 && this.rng.chance(Math.min(1, extra))) this.combat.spawn(resolved, this.runDifficulty, pattern);
  }

  /** Composition ramp (§5.5): from `wave.compositionFromS`, one trash spawn every `eliteSwapEveryS` becomes an elite. */
  private maybeSwapToElite(): boolean {
    const t = this.elapsedS;
    if (t < this.nextEliteSwapS) return false;
    // Elite share cap (§5.5 `wave.eliteShareMax`): while affixed bodies already
    // make up that share of the live pool, the slot stays ordinary trash.
    const elites = this.combat.threats(this.threatBuf);
    if (elites >= TUNING.wave.eliteShareMax * this.combat.liveCount()) return false;
    this.nextEliteSwapS = t + TUNING.wave.eliteSwapEveryS / (this.mutRun.eliteFreqMul ?? 1);
    return this.spawnRolledElite(null) !== null;
  }

  /** Rolls an elite for this second/zone/hazard and seats it on the spawn ring (or at `at`). */
  private spawnRolledElite(at: { x: number; y: number } | null): boolean | null {
    return this.spawnRolledEliteBody(at) === null ? null : true;
  }

  private spawnRolledEliteBody(at: { x: number; y: number } | null): Enemy | null {
    const extras = this.loadout.hazardExtras;
    const roll = rollElite(this.rng, this.elapsedS, this.zone.id, extras.forcedAffix, extras.eliteExtraAffix);
    const affix = roll.affixes[0];
    if (affix === undefined) return null;
    const p = at ?? this.ringPoint();
    if (p === null) return null;
    return this.combat.spawnElite(roll.defId, affix, p.x, p.y);
  }

  private ringPoint(): { x: number; y: number } | null {
    const player = this.combat.player;
    const dist = VIEW.height / 2 + TUNING.enemy.spawnMargin;
    for (let i = 0; i < 8; i += 1) {
      const a = this.rng.float(0, Math.PI * 2);
      const x = player.x + Math.cos(a) * dist;
      const y = player.y + Math.sin(a) * dist;
      if (this.combat.spawnable(x, y)) return { x, y };
    }
    return null;
  }

  private onScriptedEvent(event: EventSpec): void {
    switch (event.kind) {
      case 'elite': {
        const beats = 1 + hazardDef(this.loadout.hazard).extraElitesPerBeat;
        const count = Math.max(1, Math.round(beats * (this.mutRun.eliteFreqMul ?? 1)));
        for (let i = 0; i < count; i += 1) this.spawnRolledElite(null);
        sfx('die', { volume: 0.3 });
        showToast(this, { text: 'AN ELITE HUNTS YOU', tone: PALETTE.bad, key: 'elite' });
        break;
      }
      case 'boss':
        this.spawnZoneBoss();
        break;
      case 'breather':
        this.beginBreather();
        break;
      // 'poi-event' / 'den-open' / 'fence-window' are scheduled inside
      // `PoiSystem` on its own clock (same seconds); the timeline rows exist
      // for the sim and the HUD ticks.
      default:
        break;
    }
  }

  private spawnZoneBoss(): void {
    if (this.bossActive) return;
    const c = this.gates.find((g) => g.id === TUNING.warden.gate) ?? this.gates[0];
    if (c === undefined) return;
    // Near Gate C the boss guards the arch; far from it, the boss comes to the
    // hero on the line toward C, so the climax is a fight and not a rumour
    // 2 km away (critic v2b B3).
    const player = this.combat.player;
    const dist = Math.hypot(c.x - player.x, c.y - player.y);
    let at = { x: c.x + TUNING.warden.spawnOffsetPx, y: c.y };
    if (dist > BOSS_AT_GATE_PX) {
      const a = Math.atan2(c.y - player.y, c.x - player.x);
      for (let i = 0; i < 12; i += 1) {
        const ang = a + (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * 0.35;
        const x = player.x + Math.cos(ang) * BOSS_NEAR_PX;
        const y = player.y + Math.sin(ang) * BOSS_NEAR_PX;
        if (!this.combat.spawnable(x, y)) continue;
        at = { x, y };
        break;
      }
    }
    this.combat.spawnBoss(this.zone.id, at.x, at.y);
    this.bossActive = true;
    setMusicLayer('boss', true);
    sfx('collapse', { volume: 0.5 });
    shake(this, 0.012, 300);
    banner(this, this.zone.bossName.toUpperCase(), CSS.bad, 800);
  }

  private beginBreather(): void {
    this.combat.silenceSpawns(TUNING.events.breatherSilenceMs);
    const player = this.combat.player;
    const before = player.health.hp;
    player.health.heal(player.health.max * TUNING.events.breatherHealRatio);
    const healed = Math.round(player.health.hp - before);
    sfx('whoosh', { volume: 0.35, rate: 1.25 });
    floatText(this, player.x, player.y - 100, healed > 0 ? `+${healed} HP` : 'HP FULL', healed > 0 ? CSS.good : CSS.inkSoft, 42);
    // Only claim relief when the hero is actually clear (critic v2b B3).
    if (this.combat.liveNear(BREATHER_CLEAR_PX) < BREATHER_TOAST_MAX_NEAR) {
      showToast(this, { text: 'THE DUSK DRAWS BACK', tone: PALETTE.good, ms: TUNING.events.breatherSilenceMs, key: 'breather' });
    }
  }

  /** Gate B guard pack, Collapse elite injection, Tolling Bells waves. */
  private tickBeats(): void {
    const t = this.elapsedS;
    if (!this.gateGuardPlaced && t >= TUNING.elite.gateGuardAtS) {
      this.gateGuardPlaced = true;
      const b = this.gates.find((g) => g.id === TUNING.elite.gateGuardGate);
      if (b !== undefined) this.placeGateGuard(b);
    }
    if (t >= this.nextBellWaveS && this.mutRun.bellWaveEveryS !== undefined) {
      this.nextBellWaveS = t + this.mutRun.bellWaveEveryS;
      const p = this.combat.player;
      this.combat.spawnPopulation({ source: 'mu_bells', x: p.x, y: p.y, radius: 420, entries: [{ defId: 'husk', count: TUNING.poi.events.vigil.waveSize }] });
    }
    const collapse = this.extraction.collapse;
    if (collapse?.active === true) {
      const centre = this.extraction.collapseRingCenter;
      while (this.collapseElitesSpawned < this.extraction.collapseEliteQuota) {
        this.collapseElitesSpawned += 1;
        const a = this.rng.float(0, Math.PI * 2);
        const r = Math.max(TUNING.gate.radius + 60, collapse.ringRadius - 80);
        const x = centre.x + Math.cos(a) * r;
        const y = centre.y + Math.sin(a) * r;
        if (this.combat.spawnable(x, y)) this.spawnRolledElite({ x, y });
      }
    }
  }

  /**
   * Gate B guard (critic C1): at gate open the pack is parked OUTSIDE the
   * apron, on the side facing the hero, under a red ground telegraph, so the
   * fight comes before the channel instead of landing on it. Nothing spawns
   * inside `extract.suppressRadius` of the gate; every guard hit is capped.
   */
  private placeGateGuard(gate: GateCandidate): void {
    const player = this.combat.player;
    const [minPark, maxPark] = TUNING.elite.gateGuardParkPx;
    const minDist = Math.max(TUNING.extract.suppressRadius, TUNING.mapgen.gateClear) + 1;
    const d = Math.max(minDist, TUNING.mapgen.gateClear + this.rng.float(minPark, maxPark));
    // Of the bearings around the gate, take the walkable one FARTHEST from the
    // hero (QA v2c NEW-1: a hero approaching from the park side was spawned on).
    let park: { x: number; y: number } | null = null;
    let best = -1;
    for (let i = 0; i < GUARD_BEARINGS; i += 1) {
      const angle = (i / GUARD_BEARINGS) * Math.PI * 2;
      const x = gate.x + Math.cos(angle) * d;
      const y = gate.y + Math.sin(angle) * d;
      if (!this.combat.spawnable(x, y)) continue;
      const fromHero = Math.hypot(x - player.x, y - player.y);
      if (fromHero > best) {
        best = fromHero;
        park = { x, y };
      }
    }
    if (park === null || best < TUNING.elite.gateGuardHeroClearPx) return;
    const cap = TUNING.elite.gateGuardDmgCap * hazardDef(this.loadout.hazard).threatMul;
    const spread = TUNING.elite.gateGuardRadiusPx;
    const guards: Enemy[] = [];
    const elite = this.spawnRolledEliteBody(park);
    if (elite !== null) guards.push(elite);
    for (let i = 0; i < TUNING.elite.gateGuardAdds; i += 1) {
      const a = (i / TUNING.elite.gateGuardAdds) * Math.PI * 2;
      const x = park.x + Math.cos(a) * spread;
      const y = park.y + Math.sin(a) * spread;
      if (Math.hypot(x - gate.x, y - gate.y) <= TUNING.extract.suppressRadius) continue;
      const add = this.combat.spawnAtPosition(GATE_GUARD_ADD_ID, x, y, this.runDifficulty);
      if (add !== null) guards.push(add);
    }
    // Dormant (no move, no attack) for the whole telegraph, then all wake at once.
    for (const g of guards) {
      g.damageCap = cap;
      g.dormant = true;
    }
    this.time.delayedCall(TUNING.elite.gateGuardTelegraphMs, () => {
      for (const g of guards) if (g.active && g.damageCap === cap) g.dormant = false;
    });
    this.guardTelegraph(park.x, park.y, spread + 60);
    this.gateCallout(`GATE ${gate.id.toUpperCase()} GUARDED`, CSS.warn);
  }

  /** Amber ground ring (telegraph colour, §13.2) under the parked guard pack for `elite.gateGuardTelegraphMs`. */
  private guardTelegraph(x: number, y: number, r: number): void {
    const g = this.add.graphics().setDepth(4);
    g.fillStyle(IDENTITY.hazardAmber, 0.18);
    g.fillCircle(x, y, r);
    g.lineStyle(6, IDENTITY.hazardAmber, 0.9);
    g.strokeCircle(x, y, r);
    this.tweens.add({ targets: g, alpha: 0, delay: TUNING.elite.gateGuardTelegraphMs - 500, duration: 500, onComplete: () => g.destroy() });
  }

  private tickCollapse(deltaMs: number): void {
    const collapse = this.extraction.collapse;
    if (collapse === null || !collapse.active) return;
    this.collapseBonus = this.extraction.collapseThreatBonus;
    const centre = this.extraction.collapseRingCenter;
    const player = this.combat.player;
    const dx = player.x - centre.x;
    const dy = player.y - centre.y;
    if (dx * dx + dy * dy <= collapse.ringRadius * collapse.ringRadius) return;
    this.onHazardDrain((this.extraction.collapseFireDps * deltaMs) / 1000, 'the Collapse');
  }

  // === combat callbacks =====================================================

  private onEnemyKilled(k: KillReport): void {
    this.kills += 1;
    this.killsByEnemy[k.defId] = (this.killsByEnemy[k.defId] ?? 0) + 1;
    this.killsByWeapon[k.source] = (this.killsByWeapon[k.source] ?? 0) + 1;
    if (k.elite !== null) {
      this.eliteKills += 1;
      this.affixKills[k.elite] = (this.affixKills[k.elite] ?? 0) + 1;
    }
    if (k.shards > 0) this.combat.dropShards(k.x, k.y, k.shards);
    this.poi.onKill(k);
    if (k.boss === 'zone') {
      this.bossKilled = true;
      this.bossActive = false;
      setMusicLayer('boss', false);
      banner(this, `${k.name.toUpperCase()} FALLS`, CSS.good, 800);
      sfx('levelup', { volume: 0.6 });
    } else if (k.boss === 'mid') {
      banner(this, `${k.name.toUpperCase()} FALLS`, CSS.good, 600);
    }
  }

  private onPickup(kind: 'xp' | 'coin', value: number): void {
    if (allowEffect(kind === 'xp' ? 'pickup-sfx' : 'coin-sfx', kind === 'xp' ? 14 : 10)) sfx(kind, { volume: 0.8 });
    if (kind !== 'coin') return;
    this.bankShards(value, null, null);
  }

  /** Every shard source goes through `shardsMul` (+ Gilt Shrine) once, here. */
  private bankShards(value: number, x: number | null, y: number | null): void {
    const gilt = this.elapsedS < this.giltUntilS ? TUNING.poi.shrines.gilt.shardsMul : 1;
    const amount = Math.max(1, Math.round(value * this.combat.player.stats.get('shardsMul') * gilt));
    this.bag.addShards(amount);
    if (x !== null && y !== null && amount >= 10) floatText(this, x, y - 60, `+${amount} ◆`, '#ffd166', 34);
  }

  private onPlayerHit(ratio: number): void {
    this.tookHit = true;
    this.minHpRatio = Math.min(this.minHpRatio, ratio);
    this.hud.flashDamage();
    if (allowEffect('shake', TUNING.caps.hurtShakePerSecond)) shake(this, 0.006, 120);
  }

  private onHazardHit(amount: number, x: number, y: number): void {
    const health = this.combat.player.health;
    const before = health.hp;
    const died = health.apply({ amount, crit: false, source: 'hazard' });
    if (health.hp === before && !died) return;
    this.onPlayerHit(health.ratio);
    burst(this, x, y, IDENTITY.threat, 12, 180);
    // `onHazardHit` is only raised by cursed-brazier strikes (zone.ts); name the hazard, not the zone.
    if (died && !this.combat.consumeLastGasp()) this.die('a cursed brazier');
  }

  /** Drains bypass i-frames (hazards, dusk-fire), but Last Gasp still refuses the death. */
  private onHazardDrain(amount: number, source: string): void {
    const health = this.combat.player.health;
    health.hp = Math.max(0, health.hp - amount);
    this.minHpRatio = Math.min(this.minHpRatio, health.ratio);
    this.fireFlashAcc += amount;
    if (this.fireFlashAcc >= 2) {
      this.fireFlashAcc = 0;
      this.hud.flashDamage();
    }
    if (health.hp > 0 || this.combat.consumeLastGasp()) return;
    this.die(source);
  }

  private dying = false;

  private die(killer: string): void {
    if (this.ended || this.dying) return;
    this.dying = true;
    this.combat.player.setChannelling(false);
    this.combat.setPaused(true);
    this.director.pause();
    this.joystick.setEnabled(false);
    deathBeat(this, killer, () => this.finish('died', killer));
  }

  private onScreen(x: number, y: number): boolean {
    return Phaser.Geom.Rectangle.Contains(this.cameras.main.worldView, x, y);
  }

  // === POI callbacks ========================================================

  private onEliteChest(x: number, y: number, boss: boolean): void {
    const evo = this.combat.weapons.evolveNext();
    if (evo !== null) {
      this.noteEvolution(evo);
      this.playEvolutionFx(evo);
      return;
    }
    sfx('chest', { volume: 0.9 });
    floatText(this, x, y - 80, boss ? 'BOSS CHEST' : 'ELITE CHEST', '#ffd166', 40);
    if (!boss) this.queueDraft(1);
  }

  /** POI completion XP (critic v2b M4): PoiSystem sizes each burst; it lands as orbs at the POI. */
  private tickPoiXp(): void {
    for (const b of this.poi.takeXpBursts()) {
      const per = Math.max(1, Math.round(b.xp / XP_BURST_ORBS));
      this.combat.dropXp(b.x, b.y, Math.max(1, Math.round(b.xp / per)), per);
    }
  }

  /** Low-level orb vacuum: extra pickup radius until `TUNING.xp.earlyVacuum.untilLevel`. */
  private tickEarlyVacuum(): void {
    const player = this.combat.player;
    const want = player.level < TUNING.xp.earlyVacuum.untilLevel;
    if (want === this.earlyVacuum) return;
    this.earlyVacuum = want;
    if (want) player.applyModifier({ stat: 'pickupRadius', add: TUNING.xp.earlyVacuum.radiusAdd, source: EARLY_VACUUM_SOURCE });
    else player.stats.removeBySource(EARLY_VACUUM_SOURCE);
  }

  private onShrine(kind: PoiKind): void {
    const player = this.combat.player;
    sfx('levelup', { volume: 0.5, rate: 0.9 });
    showToast(this, { text: SHRINE_COPY[kind] ?? 'SHRINE', tone: PALETTE.accent, key: 'shrine' });
    switch (kind) {
      case 'shrine_blood':
        player.applyModifier({ stat: 'maxHp', mul: -TUNING.poi.shrines.blood.maxHpPenalty, source: 'shrine:blood' });
        this.queueDraft(TUNING.poi.shrines.blood.drafts);
        break;
      case 'shrine_gilt':
        this.giltUntilS = this.elapsedS + TUNING.poi.shrines.gilt.durationS;
        break;
      case 'shrine_grave':
        player.health.heal(player.health.max);
        break;
      default:
        break;
    }
  }

  private onPoiEvent(kind: EventKind, phase: 'start' | 'success' | 'fail'): void {
    const name = EVENT_COPY[kind];
    if (phase === 'start') {
      sfx('whoosh', { volume: 0.5 });
      showToast(this, { text: `${name} — follow the ! arrow`, tone: IDENTITY.gateOpen, key: 'event' });
    } else if (phase === 'success') {
      sfx('levelup', { volume: 0.5 });
      showToast(this, { text: `${name} COMPLETE`, tone: PALETTE.good, key: 'event' });
    } else {
      showToast(this, { text: `${name} LOST`, tone: PALETTE.bad, key: 'event' });
    }
  }

  /** The Wandering Fence (§5.12.7): pick up to `loadout.fenceTrades` offers; the run holds while the sheet is up. */
  private openFence(offers: FenceOffer[]): void {
    if (this.ended || this.fenceOpen) return;
    this.fenceOpen = true;
    this.joystick.setEnabled(false);
    this.combat.setPaused(true);
    this.director.pause();
    let tradesLeft = this.loadout.fenceTrades;
    const sheet = openSheet(this, {
      height: 200 + offers.length * 110,
      title: 'THE WANDERING FENCE',
      onClose: () => {
        this.fenceOpen = false;
        if (this.ended) return;
        this.joystick.setEnabled(true);
        if (!this.drafting && !this.paused) {
          this.combat.setPaused(false);
          this.director.resume();
        }
      },
    });
    offers.forEach((offer, i) => {
      const button = new Button(this, VIEW.width / 2, 120 + i * 110, offer.label, () => {
        if (tradesLeft <= 0) return;
        const result = this.poi.fenceTrade(offer.id, this.bag);
        if (!result.ok) {
          sfx('hit', { volume: 0.4 });
          return;
        }
        tradesLeft -= 1;
        const player = this.combat.player;
        if (result.effect === 'heal') player.health.heal(player.health.max * 0.5);
        if (result.effect === 'rerolls') this.rerolls += 2;
        if (result.item !== null) this.addToBag(result.item);
        sfx('pickup', { volume: 0.6 });
        if (tradesLeft <= 0) sheet.close();
      }, { width: 600, height: 92, fill: BUTTON_STYLE.idle.fill, stroke: BUTTON_STYLE.idle.stroke, textColor: BUTTON_STYLE.idle.textColor, fontSize: '26px' });
      sheet.content.add(button);
    });
  }

  // === extraction ===========================================================

  /** Gate open/close callout: ink text on a gate-violet / warn stroke (§11 text-tone rule), readable over any floor. */
  private gateCallout(label: string, strokeColor: string): void {
    this.calloutQueue.push({ label, strokeColor });
    this.pumpCallouts();
  }

  /**
   * One callout at a time: callouts fired on the same frame (GATE A OPEN and
   * TOLL GATE OPEN both open at 90 s) are shown `CALLOUT_GAP_MS` apart
   * instead of printing over each other (critic v2d).
   */
  private pumpCallouts(): void {
    const now = this.time.now;
    if (now < this.calloutBusyUntil) return;
    const next = this.calloutQueue.shift();
    if (next === undefined) return;
    this.calloutBusyUntil = now + CALLOUT_GAP_MS;
    const player = this.combat.player;
    const text = this.add
      .text(player.x, player.y - 150, next.label, { ...TEXT.heading, fontSize: '46px', color: CSS.ink, stroke: next.strokeColor, strokeThickness: 10 })
      .setOrigin(0.5)
      .setDepth(900);
    holdToasts(this, GATE_CALLOUT_MS);
    this.tweens.add({ targets: text, y: text.y - 90, alpha: 0, delay: 500, duration: GATE_CALLOUT_MS - 500, ease: 'Cubic.easeIn', onComplete: () => text.destroy() });
  }

  /** True while the hero stands inside the ring of the gate the channel belongs to. */
  private inChannelRing(): boolean {
    const id = this.extraction.channelingGate;
    const gate = id === null ? undefined : this.gates.find((g) => g.id === id);
    if (gate === undefined) return false;
    const player = this.combat.player;
    return (player.x - gate.x) ** 2 + (player.y - gate.y) ** 2 <= TUNING.gate.radius * TUNING.gate.radius;
  }

  private onExtractionEvent(e: ExtractionEvent, gate: GateCandidate | null): void {
    const player = this.combat.player;
    const label = gate === null ? '' : gate.id === 'x' ? `${gate.kind.toUpperCase()} GATE` : `GATE ${gate.id.toUpperCase()}`;
    switch (e) {
      case 'gate-open':
        sfx('gate', { volume: 0.5 });
        edgeFlash(this, IDENTITY.gateOpen, 200);
        this.gateCallout(`${label} OPEN`, GATE_OPEN_CSS);
        break;
      case 'gate-close':
        sfx('whoosh', { volume: 0.6, rate: 0.8 });
        this.gateCallout(`${label} CLOSED`, CSS.warn);
        break;
      case 'collapse':
        sfx('collapse');
        edgeFlash(this, IDENTITY.threat, 520, 150);
        setMusicLayer('boss', true);
        shake(this, 0.02, 400);
        banner(this, 'THE COLLAPSE', CSS.warn, 700);
        break;
      case 'extracted':
        sfx('extract');
        player.setChannelling(false);
        player.playAction(ANIM.heroExtract);
        this.finish('extracted', null);
        break;
    }
  }

  // === ground loot ==========================================================

  private dropLoot(payload: LootPayload, x: number, y: number, lingerMs: number | null): void {
    const pickup = this.lootPool.obtain();
    pickup.drop(payload, x, y, this.simTimeMs, LOOT_ARM_MS, lingerMs);
    this.ground.push({ pickup, payload });
  }

  private tickGround(): void {
    const player = this.combat.player;
    const radius = player.stats.get('pickupRadius');
    for (let i = this.ground.length - 1; i >= 0; i -= 1) {
      const g = this.ground[i];
      if (g === undefined) continue;
      const own = g.payload.kind === 'item' && g.payload.item.item.uid === WICKET_LOCKET_UID;
      const state = g.pickup.tick(this.simTimeMs, player.x, player.y, own ? LOCKET_COLLECT_PX : radius);
      if (state === 'idle') continue;
      this.lootPool.release(g.pickup);
      const last = this.ground.pop();
      if (last !== undefined && i < this.ground.length) this.ground[i] = last;
      if (state === 'collected') this.collect(g.payload, g.pickup.x, g.pickup.y);
    }
  }

  private collect(payload: LootPayload, x: number, y: number): void {
    switch (payload.kind) {
      case 'item':
        this.addToBag(payload.item, x, y);
        return;
      case 'key':
        sfx('pickup', { volume: 0.6 });
        floatText(this, x, y - 60, 'DREAD KEY', '#ad6eef', 34);
        return;
      case 'pickup': {
        sfx('pickup', { volume: 0.6 });
        const player = this.combat.player;
        const pk = TUNING.pickups;
        if (payload.id === 'pk_bread') player.health.heal(pk.bread.heal);
        else if (payload.id === 'pk_bell') this.combat.vacuumOrbs(pk.bell.vacuumMs);
        else if (payload.id === 'pk_flask') this.combat.damageArea(player.x, player.y, pk.flask.radius, pk.flask.damage, 'pk_flask');
        else this.combat.freezeArea(player.x, player.y, pk.salt.radius, this.loadout.uniques.includes('u_rimeheart') ? RIMEHEART_FREEZE_MS : pk.salt.freezeMs);
        return;
      }
    }
  }

  private addToBag(item: LootItem, x = this.combat.player.x, y = this.combat.player.y): void {
    if (item.item.uid === WICKET_LOCKET_UID) {
      this.locketBeacon?.destroy();
      this.locketBeacon = null;
      this.locketAt = null;
      this.locketArrow?.destroy();
      this.locketArrow = null;
      endCoach(this, 'locket');
      // §5.28 / critic v2c M2: the Wicket's Gate A opens 10 s after the locket
      // is picked up if that is sooner than `ftue.gateAOpenS`, never before 20 s.
      this.extraction.openEarly('a', Math.max(TUNING.ftue.gateAEarliestS, this.elapsedS + TUNING.ftue.gateAAfterLocketS));
    }
    const result = this.bag.add(item);
    this.bagStrip.announce(result, item);
    this.itemsSeen.add(itemCodexKey(item));
    sfx(item.kind === 'gear' && item.item.rarity >= 4 ? 'chest' : 'pickup', { volume: 0.7, rate: 0.85 + 0.06 * (item.kind === 'gear' ? item.item.rarity : 2) });
    for (const dropped of result.dropped) this.dropLoot({ kind: 'item', item: dropped }, x + 50, y, this.bag.dropLingerMs);
    if (result.refused !== null) this.dropLoot({ kind: 'item', item: result.refused }, x, y + 50, this.bag.dropLingerMs);
    if (result.accepted && !this.itemCoached) {
      this.itemCoached = true;
      coachToast(this, 'item');
    }
    if (this.bag.casketNudgeDue()) {
      this.bagStrip.pulse();
      showToast(this, { text: 'Pin your Gilded item — tap the bag', onTap: () => this.toggleBagSheet(), key: 'casket' });
    }
    this.refreshJournal();
  }

  private rollItem(tierBias: number, uniqueChance: number) {
    return rollGear(this.rng, {
      tierBias,
      luck: this.combat.player.stats.get('luck'),
      lootBias: this.zone.lootBias + this.loadout.lootBias,
      itemLevel: this.loadout.itemLevel,
      uniqueChance,
      zone: this.zone.id,
    });
  }

  // === belt =================================================================

  private useBelt(slot: number): void {
    const player = this.combat.player;
    const fx = this.belt.use(slot, { maxHp: player.health.max, itemsPickedUp: this.bag.itemsPickedUp });
    if (fx === null) return;
    endCoach(this, 'belt');
    sfx('pickup', { volume: 0.6, rate: 1.1 });
    switch (fx.kind) {
      case 'heal':
        player.health.heal(fx.hp);
        break;
      case 'damage':
        this.combat.damageArea(player.x, player.y, fx.radius, fx.amount, 'belt');
        break;
      case 'freeze':
        this.combat.freezeArea(player.x, player.y, fx.radius, fx.ms);
        break;
      case 'casket':
        this.bag.addCasketSlots(fx.slots);
        break;
      case 'reveal':
        this.poi.reveal(fx.ms);
        break;
    }
  }

  // === drafts ===============================================================

  private queueDraft(levels: number): void {
    this.pendingDrafts += levels;
  }

  /** A level-up earned mid-channel waits until the hold ends. */
  private drainDrafts(): void {
    // A draft never opens over the evolution cinematic; it follows once the icon lands.
    if (this.pendingDrafts <= 0 || this.drafting || this.paused || this.ended || this.fenceOpen || evolutionPlaying(this)) return;
    if (this.extraction.channelingGate !== null || this.poi.channelling() !== null) return;
    this.pendingDrafts -= 1;
    this.openDraft();
  }

  private rollHand(): UpgradeDef[] {
    const ctx = this.combat.weapons.draftContext(this.taken, this.banished);
    return rollUpgradeChoices(this.rng, ctx, TUNING.draft.choices + (this.mutRun.draftChoicesBonus ?? 0));
  }

  private describe(hand: readonly UpgradeDef[]) {
    const view = this.combat.weapons.state();
    const level = this.combat.player.level;
    return hand.map((c) => describeCard(c, view, level));
  }

  private openDraft(): void {
    let hand = this.rollHand();
    if (hand.length === 0) return;
    this.drafting = true;
    this.director.pause();
    this.combat.setPaused(true);
    this.joystick.setEnabled(false);
    this.freezeWorld();
    sfx('levelup', { volume: 0.6 });
    const handle = showUpgradeCards(this, this.describe(hand), {
      rerolls: this.rerolls,
      banishes: this.banishes,
      onPick: (i) => {
        const card = hand[i];
        this.closeDraft();
        if (card !== undefined) this.applyCard(card);
      },
      onReroll: () => {
        if (this.rerolls <= 0) return;
        this.rerolls -= 1;
        hand = this.rollHand();
        handle.refresh(this.describe(hand), this.rerolls, this.banishes);
      },
      onBanish: (i) => {
        const card = hand[i];
        if (this.banishes <= 0 || card === undefined) return;
        this.banishes -= 1;
        this.banished.push(card.id);
        hand = this.rollHand();
        handle.refresh(this.describe(hand), this.rerolls, this.banishes);
      },
    });
    this.cards = handle;
  }

  private closeDraft(): void {
    this.cards?.destroy();
    this.cards = null;
    this.drafting = false;
    this.thawWorld();
    if (this.ended || this.paused) return;
    this.director.resume();
    this.combat.setPaused(false);
    this.joystick.setEnabled(true);
  }

  /**
   * Draft perf (cert: first-draft fps under 6× CPU throttle): the run is frozen
   * under a 0.85 dim, so the ~400 world objects are drawn ONCE into a
   * screen-sized DynamicTexture through the main camera, shown as one static
   * image, and hidden until the draft closes. HUD (scroll factor 0) stays live.
   */
  private freezeWorld(): void {
    if (this.frozenWorld.length > 0) return;
    const cam = this.cameras.main;
    const existing = this.textures.exists(FREEZE_KEY) ? this.textures.get(FREEZE_KEY) : null;
    const dt = existing instanceof Phaser.Textures.DynamicTexture ? existing : this.textures.addDynamicTexture(FREEZE_KEY, cam.width, cam.height);
    if (dt === null) return;
    dt.clear();
    this.children.depthSort();
    for (const obj of this.children.list) {
      const o = obj as Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Visible & Partial<Phaser.GameObjects.Components.ScrollFactor>;
      if (!o.visible || (o.scrollFactorX === 0 && o.scrollFactorY === 0)) continue;
      if (!o.willRender(cam)) continue;
      dt.capture(o, { camera: cam });
      o.setVisible(false);
      this.frozenWorld.push(o);
    }
    dt.render();
    this.freezeImage = this.add.image(0, 0, FREEZE_KEY).setOrigin(0, 0).setScrollFactor(0).setDepth(FREEZE_DEPTH);
  }

  /** Restores every object `freezeWorld` hid (skipping any destroyed meanwhile) and drops the still. */
  private thawWorld(): void {
    for (const o of this.frozenWorld) if (o.scene !== undefined && o.active) o.setVisible(true);
    this.frozenWorld.length = 0;
    this.freezeImage?.destroy();
    this.freezeImage = null;
  }

  private applyCard(card: UpgradeDef): void {
    this.taken.push(card.id);
    const weapons = this.combat.weapons;
    const player = this.combat.player;
    switch (card.kind) {
      case 'weapon-unlock':
        if (card.weapon !== undefined && weapons.equip(card.weapon)) {
          this.itemsSeen.add(`wpn:${card.weapon}`);
          playNewWeapon(this, { weaponId: card.weapon, name: weaponDef(card.weapon).name, hero: player });
        }
        break;
      case 'weapon-boost':
        if (card.weapon !== undefined) {
          const id = card.weapon;
          const rankOf = (): number => weapons.state().weapons.find((w) => w.id === id)?.rank ?? 0;
          const before = rankOf();
          weapons.boost(id);
          const rank = rankOf();
          if (rank > before) playRankUp(this, { weaponId: id, rank, maxRank: weapons.state().maxRank, hero: player });
        }
        break;
      case 'weapon-evolution':
        if (card.weapon !== undefined) {
          const before = weapons.state().weapons.find((w) => w.id === card.weapon)?.evolved === true;
          weapons.evolve(card.weapon);
          const after = weapons.state().weapons.find((w) => w.id === card.weapon)?.evolved === true;
          if (!before && after) {
            this.noteEvolution(card.weapon);
            this.playEvolutionFx(card.weapon);
          }
        }
        break;
      case 'charm-unlock':
        if (card.charm !== undefined && weapons.equipCharm(card.charm)) {
          this.itemsSeen.add(`charm:${card.charm}`);
          playNewCharm(this, { charmId: card.charm, name: charmName(card.charm), hero: player });
        }
        break;
      case 'charm-rank':
        if (card.charm !== undefined) weapons.rankCharm(card.charm);
        break;
      default:
        for (const mod of cardModifiers(card)) player.applyModifier(mod);
        if (card.effect !== undefined) {
          applyEffect(card.effect, { player, grantShards: (n) => this.bag.addShards(n) }, this.combat.effects);
        }
        break;
    }
  }

  /** Evolution cinematic (EvolveFx): slows the fight at its peak via the 'evolve' dilation source. */
  private playEvolutionFx(id: WeaponId): void {
    playEvolution(this, { ...evolutionInfo(id), hero: this.combat.player, enemies: this.combat, weapons: this.combat.weapons });
  }

  private noteEvolution(id: WeaponId): void {
    if (this.evolutions.includes(id)) return;
    this.evolutions.push(id);
    this.itemsSeen.add(`evo:${id}`);
  }

  // === pause & bag sheet ====================================================

  private pauseModel(): PauseModel {
    const view = this.bag.view();
    return {
      zone: this.zone.name,
      hazard: this.loadout.hazard,
      elapsedS: this.elapsedS,
      level: this.combat.player.level,
      weapons: this.combat.weapons.state(),
      gates: this.extraction.view().map((g) => (g.id === 'x' ? g.label : `${g.id.toUpperCase()} · ${g.label}`)),
      bag: view,
      carrying: { items: view.items.length + view.casket.length, shards: this.bag.shards },
    };
  }

  private togglePause(): void {
    if (this.ended || this.dying) return;
    if (this.bagSheet !== null) {
      this.bagSheet.close();
      return;
    }
    if (this.pauseOverlay !== null) {
      // One layer per press: an open ABANDON confirm closes first (QA #14).
      if (!this.pauseOverlay.back()) this.resume();
      return;
    }
    if (this.drafting || this.fenceOpen) return;
    this.minimap.closePeek();
    this.paused = true;
    this.director.pause();
    this.combat.setPaused(true);
    this.joystick.setEnabled(false);
    this.pauseOverlay = showPauseOverlay(this, this.pauseModel(), {
      resume: () => this.resume(),
      abandon: () => this.finish('abandoned', null),
      pin: (uid) => {
        this.togglePin(uid);
        this.refreshJournal();
        this.pauseOverlay?.refresh(this.pauseModel());
      },
      drop: (uid) => {
        const item = this.bag.drop(uid);
        if (item !== null) this.dropLoot({ kind: 'item', item }, this.combat.player.x, this.combat.player.y + 60, this.bag.dropLingerMs);
        this.pauseOverlay?.refresh(this.pauseModel());
      },
    });
  }

  /** PIN on a casket tile takes it back out (E22 `unpin`); on a bag tile it pins. */
  private togglePin(uid: string): void {
    if (this.bag.view().casket.some((c) => c.uid === uid)) this.bag.unpin(uid);
    else this.bag.pin(uid);
  }

  private resume(): void {
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
    this.paused = false;
    if (this.ended || this.drafting) return;
    this.director.resume();
    this.combat.setPaused(false);
    this.joystick.setEnabled(true);
  }

  private toggleBagSheet(): void {
    endCoach(this, 'item');
    if (this.bagSheet !== null) {
      this.bagSheet.close();
      return;
    }
    if (this.ended || this.paused || this.drafting) return;
    const sheet = openBagSheet(this, this.bag.view(), {
      pin: (uid) => {
        this.togglePin(uid);
        this.refreshJournal();
        sheet.refresh(this.bag.view());
      },
      drop: (uid) => {
        const item = this.bag.drop(uid);
        if (item !== null) this.dropLoot({ kind: 'item', item }, this.combat.player.x, this.combat.player.y + 60, this.bag.dropLingerMs);
        sheet.refresh(this.bag.view());
      },
      close: () => {
        this.bagSheet = null;
        setTimeDilation(this, 'bag', 1);
      },
    });
    this.bagSheet = sheet;
    setTimeDilation(this, 'bag', BAG_SHEET_TIMESCALE);
  }

  // === finish ===============================================================

  private finish(outcome: BagSettlement['outcome'], killer: string | null): void {
    if (this.ended) return;
    this.ended = true;
    this.cards?.destroy();
    this.cards = null;
    this.thawWorld();
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
    this.bagSheet?.close();
    this.joystick.setEnabled(false);
    this.combat.setPaused(true);
    this.director.pause();

    const elapsedS = this.elapsedS;
    const settlement = this.bag.settle(outcome, {
      deathKeepPct: this.loadout.deathKeepPct,
      greedMul: outcome === 'extracted' ? greedMul(elapsedS, this.loadout.greedMaxMul) : 1,
      gravePact: this.loadout.gravePact,
      rng: this.rng,
    });
    const stats = this.poi.stats();
    const view = this.combat.weapons.state();
    const gateId: GateId | null = this.extraction.extractedGate;
    const gateKind = this.extraction.extractedGateKind;
    const report: RunReport = {
      outcome,
      killer: outcome === 'died' ? killer : null,
      zone: this.loadout.zone,
      hazard: this.loadout.hazard,
      mode: this.loadout.mode,
      seed: this.loadout.seed,
      classId: this.loadout.classId,
      elapsedS,
      gate: gateId !== null && gateKind !== null ? { id: gateId, kind: gateKind } : null,
      settlement,
      kills: this.kills,
      killsByEnemy: this.killsByEnemy,
      killsByWeapon: this.killsByWeapon,
      eliteKills: this.eliteKills,
      affixKills: this.affixKills,
      bossKilled: this.bossKilled,
      midBossKilled: stats.midBossKilled,
      chestsOpened: stats.chestsOpened,
      vaultOpened: stats.vaultOpened,
      shrinesUsed: stats.shrinesUsed,
      lairsCleared: stats.lairsCleared,
      eventsCompleted: stats.eventsCompleted,
      veinsMined: stats.veinsMined,
      breakablesBroken: this.field.broken,
      loreRead: stats.loreRead,
      fenceTrades: stats.fenceTrades,
      poisVisited: stats.poisVisited,
      evolutions: this.evolutions,
      maxLevel: this.combat.player.level,
      charmsOwned: view.charms.length,
      weaponsAtMaxRank: view.weapons.filter((w) => w.rank >= view.maxRank).length,
      minHpRatio: this.minHpRatio,
      beltUsed: this.belt.used() as ConsumableId[],
      itemsSeen: [...this.itemsSeen],
    };
    const data: GameOverData = { report, settlement: settleRun(report) };

    setTimeDilation(this, 'bag', 1);
    setTimeDilation(this, 'evolve', 1);
    setMusicLayer('boss', false);
    this.cameras.main.fadeOut(340, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start(SCENES.gameOver, data));
  }

  // === world visuals ========================================================

  private buildWorldVisuals(): void {
    const artSize = TUNING.gate.radius * GATE_ART_SCALE;
    for (const gate of this.gates) {
      const closedKey = gate.kind === 'timed' ? TEXTURE.gateClosed : `gate-${gate.kind}-closed`;
      const ring = this.add
        .circle(gate.x, gate.y, TUNING.gate.radius)
        .setStrokeStyle(6, GATE_RING_STYLE.closed.color, GATE_RING_STYLE.closed.alpha)
        .setFillStyle(GATE_RING_STYLE.closed.color, 0.03)
        .setDepth(5);
      const sprite = this.textures.exists(closedKey) ? this.add.sprite(gate.x, gate.y, closedKey).setDisplaySize(artSize, artSize).setDepth(5) : null;
      this.add
        .text(gate.x, gate.y + artSize * 0.45, gate.id === 'x' ? gate.kind.toUpperCase() : gate.id.toUpperCase(), { ...TEXT.heading, color: CSS.inkSoft })
        .setOrigin(0.5)
        .setAlpha(0.7)
        .setDepth(6);
      this.gateVisuals.push({ gate, ring, sprite, state: null });
    }
    if (playable(this.anims, ANIM.collapseRing)) {
      for (let i = 0; i < COLLAPSE_SEGMENT_POOL; i += 1) {
        const segment = this.add.sprite(0, 0, ANIM.collapseRing).setDisplaySize(COLLAPSE_SEGMENT_W, COLLAPSE_SEGMENT_H).setDepth(45).setVisible(false);
        safePlay(segment, ANIM.collapseRing);
        this.collapseSegments.push(segment);
      }
    }
    this.channelGfx = this.add.graphics().setDepth(40);
    this.collapseGfx = this.add.graphics().setDepth(45);
  }

  private redrawWorld(): void {
    for (const v of this.gateVisuals) {
      const state = this.extraction.gateState(v.gate.id);
      if (state === v.state) continue;
      const previous = v.state;
      v.state = state;
      const style = GATE_RING_STYLE[state];
      v.ring.setStrokeStyle(6, style.color, style.alpha).setFillStyle(style.color, state === 'open' || state === 'closing' ? 0.08 : 0.03);
      if (v.sprite !== null) this.paintGate(v.sprite, v.gate, state, previous);
    }

    const player = this.combat.player;
    const gateId = this.extraction.extracted ? null : this.extraction.channelingGate;
    const gate = gateId === null ? undefined : this.gates.find((g) => g.id === gateId);
    const inRing = gate !== undefined && this.inChannelRing();
    player.setChannelling(inRing);
    this.channelGfx.clear();
    const progress = this.extraction.channelProgress;
    // The hold's progress lives ON THE GATE (spatial truth); away from the ring
    // it is drawn grey — kept, but not advancing.
    if (gate !== undefined && progress > 0) {
      const from = -Math.PI / 2;
      const sweep = progress * Math.PI * 2;
      this.channelGfx.lineStyle(10 + 8 * progress, inRing ? IDENTITY.gateOpen : CHANNEL_PAUSED_TINT, inRing ? 0.95 : 0.7);
      this.channelGfx.beginPath();
      this.channelGfx.arc(gate.x, gate.y, TUNING.gate.radius + 14, from, from + sweep);
      this.channelGfx.strokePath();
    }
    this.tickChannelFeedback(inRing && progress > 0, progress);

    const collapse = this.extraction.collapse;
    const centre = this.extraction.collapseRingCenter;
    this.paintCollapseCurtain(centre.x, centre.y, collapse !== null && collapse.active ? collapse.ringRadius : 0);
  }

  private tickChannelFeedback(channelling: boolean, progress: number): void {
    if (!channelling) {
      this.channelWasActive = false;
      this.channelQuarter = 0;
      return;
    }
    if (!this.channelWasActive) {
      this.channelWasActive = true;
      endCoach(this, 'channel');
      sfx('tap', { volume: 0.5, rate: 0.9 });
      edgeFlash(this, IDENTITY.gateOpen, 180, 70);
    }
    const quarter = Math.min(4, Math.floor(progress * 4) + (progress >= 1 ? 0 : 1));
    if (quarter > this.channelQuarter) {
      this.channelQuarter = quarter;
      sfx('tap', { volume: 0.5, rate: 0.9 + 0.22 * quarter });
    } else if (quarter < this.channelQuarter) {
      this.channelQuarter = quarter;
    }
    if (this.extraction.channelInterrupted) {
      const player = this.combat.player;
      burst(this, player.x, player.y, IDENTITY.threat, 10, 260);
      sfx('hit', { volume: 0.45, rate: 1.4 });
    }
  }

  private paintGate(sprite: Phaser.GameObjects.Sprite, gate: GateCandidate, state: GateState, previous: GateState | null): void {
    sprite.setAlpha(state === 'spent' ? GATE_SPENT_ALPHA : 1);
    const timed = gate.kind === 'timed';
    const openKey = timed ? ANIM.gateOpen : `gate-${gate.kind}-open`;
    const closedKey = timed ? TEXTURE.gateClosed : `gate-${gate.kind}-closed`;
    if (state === 'open' || state === 'closing') {
      if (timed && state === 'closing' && safePlay(sprite, ANIM.gateClosing, true)) return;
      if (timed && (previous === 'closed' || previous === null) && playable(this.anims, ANIM.gateOpen) && safePlay(sprite, ANIM.gateOpening, true)) {
        sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
          if (sprite.active) safePlay(sprite, ANIM.gateOpen, true);
        });
        return;
      }
      safePlay(sprite, openKey, true);
      return;
    }
    sprite.stop();
    if (this.textures.exists(closedKey)) sprite.setTexture(closedKey);
  }

  private paintCollapseCurtain(cx: number, cy: number, radius: number): void {
    this.collapseGfx.clear();
    const segments = this.collapseSegments;
    if (segments.length === 0) {
      if (radius <= 0) return;
      this.collapseGfx.lineStyle(16, IDENTITY.threat, 0.9);
      this.collapseGfx.strokeCircle(cx, cy, radius);
      return;
    }
    let used = 0;
    if (radius > 0) {
      const view = this.cameras.main.worldView;
      const count = Math.max(12, Math.ceil((Math.PI * 2 * radius) / COLLAPSE_SEGMENT_W));
      const step = (Math.PI * 2) / count;
      const width = radius * step * COLLAPSE_SEGMENT_OVERLAP;
      for (let i = 0; i < count && used < segments.length; i += 1) {
        const angle = i * step;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (x < view.x - COLLAPSE_SEGMENT_H || x > view.right + COLLAPSE_SEGMENT_H) continue;
        if (y < view.y - COLLAPSE_SEGMENT_H || y > view.bottom + COLLAPSE_SEGMENT_H) continue;
        const segment = segments[used];
        if (segment === undefined) break;
        used += 1;
        segment.setVisible(true).setPosition(x, y).setRotation(angle + Math.PI / 2).setDisplaySize(width, COLLAPSE_SEGMENT_H);
      }
    }
    for (let i = used; i < segments.length; i += 1) segments[i]?.setVisible(false);
  }

  // === UI feed ==============================================================

  private nextGate(): HudModelV2['nextGate'] {
    let best: HudModelV2['nextGate'] = null;
    for (const g of this.gates) {
      const state = this.extraction.state(g.id);
      // A closed Bell Gate opens on its condition, not a clock: never the headline.
      if (state === 'spent' || (g.kind === 'bell' && state === 'closed')) continue;
      // A gate that never closes (C) counts down to the Collapse instead of reading 0:00.
      const secondsTo = this.extraction.secondsTo(g.id) ?? Math.max(0, this.collapseAtS - this.elapsedS);
      const live = state === 'open' || state === 'closing';
      const cand = { id: g.id, kind: g.kind, state, secondsTo };
      if (best === null) {
        best = cand;
        continue;
      }
      const bestLive = best.state === 'open' || best.state === 'closing';
      if ((live && !bestLive) || (live === bestLive && secondsTo < best.secondsTo)) best = cand;
    }
    return best;
  }

  private feedUi(): void {
    const player = this.combat.player;
    const t = this.elapsedS;
    const collapse = this.extraction.collapse;
    const collapsing = collapse?.active === true;
    this.hud.set({
      hp: Math.ceil(player.health.hp),
      hpMax: player.health.max,
      level: player.level,
      xp: player.xp,
      xpNeeded: player.xpNeeded(),
      nextGate: this.nextGate(),
      darkMeter: this.extraction.darkMeter,
      collapse: collapsing,
      bag: this.bag.hud(),
      shards: this.bag.shards,
      greedMul: greedMul(t, this.loadout.greedMaxMul),
      belt: this.belt.view(),
      boss: this.combat.bossView(),
    });
    const bagView = this.bag.view();
    this.bagStrip.set(bagView);

    const gates = this.extraction.view();
    this.combat.threats(this.threatBuf);
    this.compassThreats.length = 0;
    let boss: { x: number; y: number } | null = null;
    for (const th of this.threatBuf) {
      this.compassThreats.push({ x: th.x, y: th.y, boss: th.kind === 'boss' });
      if (th.kind === 'boss' && boss === null) boss = { x: th.x, y: th.y };
    }
    const pois = this.poi.minimap();
    const near = this.poi.nearestUndiscovered(player.x, player.y);
    const event = pois.find((p) => p.kind.startsWith('ev_') && !p.done) ?? null;
    const compass: CompassModel = {
      hero: { x: player.x, y: player.y },
      elapsedS: this.elapsedS,
      heroSpeed: player.stats.get('moveSpeed'),
      gates,
      chest: near !== null && near.kind.startsWith('chest') ? { x: near.x, y: near.y } : null,
      event: event === null ? null : { x: event.x, y: event.y },
      threats: this.compassThreats,
    };
    this.compass.update(compass);
    const body = player.body;
    const angle = body !== null && (body.velocity.x !== 0 || body.velocity.y !== 0) ? Math.atan2(body.velocity.y, body.velocity.x) : 0;
    const centre = this.extraction.collapseRingCenter;
    const mm: MinimapModel = {
      hero: { x: player.x, y: player.y, angle },
      gates,
      pois,
      boss,
      collapse: collapsing && collapse !== null ? { x: centre.x, y: centre.y, r: collapse.ringRadius } : null,
    };
    this.minimap.set(mm);

    const poiChannel = this.poi.channelling();
    const gateChannel = this.extraction.channelingGate;
    const m = this.channelModel;
    const gateHeld = gateChannel !== null && !this.extraction.extracted && this.extraction.channelProgress > 0;
    const inRing = gateHeld && this.inChannelRing();
    if (inRing || (gateHeld && poiChannel === null)) {
      m.active = true;
      m.kind = 'gate';
      m.gateId = gateChannel;
      m.poiKind = null;
      m.progress = this.extraction.channelProgress;
      m.interrupted = this.extraction.channelInterrupted;
      m.paused = !inRing;
    } else if (poiChannel !== null) {
      m.active = true;
      m.kind = 'poi';
      m.gateId = null;
      m.poiKind = this.map.pois.find((p) => p.id === poiChannel.poiId)?.kind ?? null;
      m.progress = poiChannel.progress;
      m.interrupted = false;
      m.paused = false;
    } else {
      m.active = false;
      m.interrupted = false;
    }
    this.channelBar.update(m);
  }
}
