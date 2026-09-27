import Phaser from 'phaser';
import { CSS, PALETTE, VIEW } from '../../config';
import { SCENES, TEX } from '../../core/keys';
import { Rng } from '../../core/rng';
import { sessionSeed } from '../../core/daily';
import { DEV_HOOKS, registerDevHook } from '../../core/dev';
import { onSettingsChange, playerSettings, sfx } from '../../core/audio';
import { startMusic, setMusicIntensity, setMusicLayer } from '../../core/music';
import { declareOutlines } from '../../core/outline';
import { burst, flash, shake } from '../../core/juice';
import { TAP_SLOP } from '../../ui/widgets';
import { hasSeenCoach } from '../../ui/coach';
import { actionToast, confirmDialog, type OverlayHandle } from '../../ui/sheet';
import { playAcquire, playRankUp } from '../../ui/progressFx';
import { ColonyHud } from '../../ui/colony/hud';
import { AlertRail } from '../../ui/colony/alerts';
import { ContextStrip } from '../../ui/colony/tray';
import { BuildDock } from '../../ui/colony/dock';
import { BuildingCard } from '../../ui/colony/card';
import { openBuildSheet } from '../../ui/colony/buildSheet';
import { openOrdersSheet } from '../../ui/colony/ordersSheet';
import { openLedgerSheet } from '../../ui/colony/ledgerSheet';
import { showDraft } from '../../ui/colony/draftOverlay';
import { ColonyCoachBeats } from '../../ui/colony/coachBeats';
import { UI_DEPTH, costLabel, missingLabel } from '../../ui/colony/theme';
import { stripNotice, uiState } from '../../ui/colony/bridge';
import type { GameOverData } from '../../scenes/gameover';
import { COLONY_TUNING } from './tuning';
import { BUILDINGS, GOODS, GOOD_SHORT, KIT_NONE, RELICS, SITES, buildingDef, faunaDef, type BuildingId, type DepositKind, type Edge } from './content';
import type { ColonyEvent, ColonyFx, ColonyUiHost, ColonyWidget, LandingResult, LandingSetup, PlaceWhy, SheetKind } from './contracts';
import { createColony, type ColonyState } from './model/state';
import { ColonyDirector } from './model/director';
import { loudestQuadrant } from './model/noise';
import { relayRadius } from './model/field';
import { createThreat, type ColonyThreat } from './threat';
import { ColonyCamera, PLAYFIELD, TAPPABLE } from './view/camera';
import { MapView } from './view/mapView';
import { BuildMode, pickBuilding } from './view/buildMode';
import { ARROW_BAND, WorldFx, arrowLabelAt } from './view/fx';
import { Ceremony, arkFlyby, landerArc, shuttleLaunch } from './view/ceremony';
import { showColonyPause, type ColonyPauseHandle } from './view/pauseMenu';
import { FAUNA_ART, FX, faunaOutlineEntries } from './view/artMap';

/** Art groups PreloadScene loads for this slice (`art/wiring.md` §0 = manifest `integration.artGroups`). */
export const ART_GROUPS = [
  'ui', 'bg', 'hub',
  'buildings-a', 'buildings-b', 'buildings-c', 'apex', 'building-states',
  'deposits', 'relics', 'terrain', 'world-props',
  'fauna-a', 'fauna-b', 'colony-motion', 'fx',
  'icons-a', 'icons-b',
] as const;

const TILE = COLONY_TUNING.map.tilePx;
const EXTRACTOR_FOR: Record<DepositKind, BuildingId> = { ore: 'ferrite_drill', ice: 'rime_borer', crystal: 'aurel_harvester', vent: 'vent_tap' };
const WHY_TEXT: Record<PlaceWhy, string> = {
  dark: 'Outside the grid',
  blocked: 'Blocked',
  deposit: 'Needs its deposit',
  locked: 'Locked',
  afford: 'Not enough stock',
  bounds: 'Off the map',
  unique: 'Only one',
};
const EDGE_DIR: Record<Edge, readonly [number, number]> = { 0: [0, -1], 1: [1, 0], 2: [0, 1], 3: [-1, 0] };
/** Music intensity per phase (§12): day low, night high; the boss layer rides alphas and the Chorus. */
const PHASE_INTENSITY = { day: 0.25, dusk: 0.45, night: 0.75, 'long-night': 0.9 } as const;
/** §13 ceremony spans (ms) and their reduce-motion versions. */
const SPAN = { dawn: 1400, launch: 2400, loss: 1500, calm: 500, fade: 300 } as const;
/** §13 Alpha arrival: no shake above this many live fauna. */
const ALPHA_SHAKE_MAX = 150;
/** HUD widgets refresh at 10 Hz; a tap that changes their content forces the refresh on the same frame. */
const HUD_REFRESH_MS = 100;
/** Camera framing ease (critic build1: dusk framing and the build-mode nudge, 320 ms) and the dusk hands-off window. */
const DUSK_FRAME_MS = 320;
const DUSK_HANDS_OFF_MS = 5000;
/** Screen px kept between the framed core's centre and the band edge (the 192 px core sprite rises above its centre). */
const DUSK_CORE_CLEAR = 60;
/** The unobstructed read window (interface-direction §5: under the alert rail, above the tray). */
const READ_BAND = { x0: 40, x1: 680, y0: 432, y1: 868 } as const;
/** Night fight framing: check cadence, minimum gap between re-frames, screen padding kept around core + fight. */
const FIGHT_CHECK_MS = 250;
const FIGHT_REFRAME_MS = 6000;
const FIGHT_PAD = 70;
/** Dusk arrow body px, minimum centre gap between two arrows, and the margin line used when a band side is all lit / built. */
const ARROW_BODY = 96;
const ARROW_SEP = 170;
const ARROW_MARGIN = { x0: 56, x1: 664, y0: 478, y1: 822 } as const;
/** Toast rows sit in the playfield band, clear of the tray and dock. */
const TOAST_Y = 820;
/** NEW BUILDING beat anchor: low in the read band so its rise never reaches the banner (critic build3 shot 28). */
const UNLOCK_ANCHOR_Y = 740;

interface DragState { id: number; x: number; y: number; t: number; sx: number; sy: number; moved: boolean }
type Chip = { def: BuildingId; col: number; row: number };

/** The FTUE landing (§14b law 7): Halcyon rung 1, default kit, no landing pick. */
function defaultSetup(seed: string | undefined): LandingSetup {
  const site = SITES[0];
  if (site === undefined) throw new Error('colony: no site rows');
  return { site, rung: 1, kit: KIT_NONE, seed: seed ?? sessionSeed(), size: 'frontier', ark: [], refit: 0, daily: false, ftue: true };
}

/**
 * Colony GameScene (PRD §16 W5): ColonyState + ColonyDirector + threat drawn
 * by the map view in the camera's worldRoot, the W4 HUD built on ONE
 * `ColonyUiHost` per visit, sticky build mode, §13 juice and ceremonies, and
 * the §14b flow (pause on hide, checkpoint, terminal order). Public fields are
 * the cert adapter's probe surface and the `ui/colony/bridge.ts` read side.
 */
export class GameScene extends Phaser.Scene {
  setup!: LandingSetup;
  seed = '';
  model!: ColonyState;
  director!: ColonyDirector;
  threat!: ColonyThreat;
  camera!: ColonyCamera;
  /** Player pause (the Pause owner is up). */
  paused = false;
  ended = false;
  started = false;
  speed: 1 | 2 = 1;
  /** Deposit tapped: the ContextStrip's BUILD chip places `def` here. */
  depositChip: Chip | null = null;

  private mapView!: MapView;
  private build!: BuildMode;
  private fx!: WorldFx;
  /** Null until the first `create()` (probes may read the scene before it). */
  private ceremony: Ceremony | null = null;
  private host!: ColonyUiHost;
  private widgets: ColonyWidget[] = [];
  private card: (ColonyWidget & { show(uid: number | null): void; readonly uid: number | null }) | null = null;
  private coach: ColonyCoachBeats | null = null;
  private draft: { destroy(): void } | null = null;
  private pendingDraft: Extract<ColonyEvent, { type: 'draft' }> | null = null;
  private pauseMenu: ColonyPauseHandle | null = null;
  private confirm: OverlayHandle | null = null;
  private reticle: Phaser.GameObjects.Image | null = null;
  private drag: DragState | null = null;
  private pinch: { dist: number; zoom: number } | null = null;
  private lastTap = { t: -1e9, x: 0, y: 0, rootX: 0, rootY: 0 };
  private hudAcc = 0;
  /** Scratch: building screen rects (x0, y0, x1, y1 flat) for dusk arrow placement. */
  private readonly arrowRects: number[] = [];
  /** Per placed dusk arrow: drawn in the margin pointing inward (the lit field filled its band side). */
  private readonly arrowInward: boolean[] = [];
  private readonly arrowLabel = { x: 0, y: 0 };
  private readonly scratch2 = { x: 0, y: 0 };
  /** Scratch: screen rects of the visible dusk arrows (world labels yield to them). */
  private readonly labelAvoid: Array<{ x: number; y: number; w: number; h: number }> = [];
  private fightCheckAt = 0;
  private lastAutoFrameAt = -1e9;
  private transitioning = false;
  private coachWas = false;
  private musicPhase = '';
  private bossLayer = false;
  /** Last `setMusicIntensity` value (feel probe). */
  private musicLevel = 0;
  private arrowField = -1;
  private readonly arrowWorld: Array<{ x: number; y: number }> = [];
  /** Fixed pool of 4 screen points (one per edge), rewritten in place every frame. */
  private readonly arrowPool: ReadonlyArray<{ x: number; y: number }> = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
  private readonly arrowScreen: Array<{ x: number; y: number }> = [];
  /** Nested UI clock holds (`ColonyUiHost.holdClock`: UpgradeAllConfirm, first sheet openings). */
  private clockHolds = 0;
  /** Silo centres (world px), rebuilt when the building set changes. */
  private readonly siloCentres: Array<{ x: number; y: number }> = [];
  private siloVersion = -1;
  private readonly droneTo = { x: 0, y: 0 };
  /** Building whose range ring is up (card RANGE / select), 0 = none. */
  private rangeUid = 0;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private unsub: (() => void) | null = null;
  private readonly scratch = { x: 0, y: 0 };

  constructor() {
    super(SCENES.game);
    // Fauna wear baked outlines in the PRD §1c fauna colour (Preload bakes them once).
    declareOutlines((has) => faunaOutlineEntries(has));
  }

  init(data: { setup?: LandingSetup; seed?: string } = {}): void {
    this.setup = data.setup ?? defaultSetup(data.seed);
    this.seed = this.setup.seed;
  }

  // ── probe surface (cert adapter) ────────────────────────────────────────

  get colony(): ColonyState {
    return this.model;
  }
  /** An input-blocking beat is running (ceremony or scene transition). */
  get busy(): boolean {
    return this.transitioning || this.ceremonyActive;
  }
  private get ceremonyActive(): boolean {
    return this.ceremony?.active === true;
  }
  get coachActive(): boolean {
    return this.coach?.active === true;
  }
  /** The coach beat on screen (cert adapter), null when none. */
  get coachId(): string | null {
    return this.coach?.beatId ?? null;
  }
  /** The building whose placement completes the beat on screen; null = tap / RESUME continues it. */
  get coachGated(): { def: BuildingId; name: string } | null {
    const def = this.coach?.gatedBy ?? null;
    return def === null ? null : { def, name: buildingDef(def).name };
  }
  /** Dock / sheet label per building id (cert adapter taps controls by name). */
  readonly buildingNames: Readonly<Record<BuildingId, string>> = Object.fromEntries(BUILDINGS.map((b) => [b.id, b.name])) as Record<BuildingId, string>;
  get armed(): BuildingId | null {
    return this.started ? this.build.armed : null;
  }
  /** Composition probe: actor sizes on screen, building draw sizes, visible prop density per screen. */
  composition(): Record<string, unknown> {
    const z = this.camera.zoom;
    const screens = 1 / (z * z);
    const c = this.mapView.composition(z);
    return { zoom: z, ...c, drones: this.fx.dronesInFlight, screensVisible: screens, propsPerScreen: c.props / screens };
  }

  tileToScreen(col: number, row: number, out: { x: number; y: number }): void {
    this.camera.worldToScreen((col + 0.5) * TILE, (row + 0.5) * TILE, out);
  }

  create(): void {
    this.paused = false;
    this.ended = false;
    this.started = false;
    this.speed = 1;
    this.depositChip = null;
    this.widgets = [];
    this.card = null;
    this.coach = null;
    this.draft = null;
    this.pendingDraft = null;
    this.pauseMenu = null;
    this.confirm = null;
    this.reticle = null;
    this.drag = null;
    this.pinch = null;
    this.lastTap = { t: -1e9, x: 0, y: 0, rootX: 0, rootY: 0 };
    this.hudAcc = 0;
    this.fightCheckAt = 0;
    this.lastAutoFrameAt = -1e9;
    this.transitioning = false;
    this.coachWas = false;
    this.musicPhase = '';
    this.bossLayer = false;
    this.arrowField = -1;
    this.arrowWorld.length = 0;
    this.arrowScreen.length = 0;
    this.clockHolds = 0;
    this.siloCentres.length = 0;
    this.siloVersion = -1;
    this.rangeUid = 0;

    this.model = createColony(this.setup);
    const rng = new Rng(`${this.seed}:landing`);
    this.threat = createThreat(this.model, rng);
    this.director = new ColonyDirector(this.model, this.threat, this, rng);
    this.unsub = this.director.on((e) => this.onColonyEvent(e));

    this.cameras.main.setBackgroundColor(PALETTE.bgDeep);
    const { cols, rows, core } = this.model.map;
    this.camera = new ColonyCamera(this, cols * TILE, rows * TILE);
    this.mapView = new MapView(this, this.camera.root, this.model, 'game', {
      built: () => this.fx.voice('build', 0.5),
      spawned: (id) => {
        if (id === 'moth') this.fx.voice('moth', 0.5);
      },
      faunaHit: () => this.fx.voice('hit', 0.35),
      latched: () => this.fx.voice('leech', 0.6),
    });
    this.build = new BuildMode(this.model, this.mapView.validGlow);
    this.fx = new WorldFx(this, this.mapView.fxLayer, this.mapView.droneLayer, UI_DEPTH.hud - 5);
    this.fx.calm = playerSettings().reduceMotion;
    // QA#3: Reduce motion applies to the live Landing the moment Settings saves it.
    const offSettings = onSettingsChange((ps) => {
      if (ps.reduceMotion === this.fx.calm) return;
      this.fx.calm = ps.reduceMotion;
      this.mapView.setCalm(ps.reduceMotion);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, offSettings);
    this.ceremony = new Ceremony(this);
    this.focusLanding(core);

    this.host = this.makeHost();
    const host = this.host;
    this.widgets = [new ColonyHud(host), new AlertRail(host), new ContextStrip(host), new BuildDock(host)];
    this.card = new BuildingCard(host);
    this.widgets.push(this.card);
    this.coach = new ColonyCoachBeats(host);
    // Enter places at the screen-centre tile; the reticle shows where while armed (§3).
    this.reticle = this.textures.exists(TEX.ring)
      ? this.add.image(VIEW.width / 2, PLAYFIELD.focusY, TEX.ring).setDisplaySize(TILE, TILE).setTint(PALETTE.primary).setAlpha(0.7).setScrollFactor(0).setDepth(UI_DEPTH.hud - 6).setVisible(false)
      : null;

    this.bindInput();
    this.bindKeys();
    this.registerDev();
    const onHide = (): void => this.onHide();
    this.game.events.on(Phaser.Core.Events.HIDDEN, onHide);
    this.game.events.on(Phaser.Core.Events.BLUR, onHide);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.HIDDEN, onHide);
      this.game.events.off(Phaser.Core.Events.BLUR, onHide);
      this.unsub?.();
      this.unsub = null;
      this.draft?.destroy();
      this.draft = null;
      this.pauseMenu?.destroy();
      this.pauseMenu = null;
      this.coach?.destroy();
      this.coach = null;
      for (const w of this.widgets) w.destroy();
      this.widgets = [];
      this.card = null;
      this.input.off(Phaser.Input.Events.POINTER_DOWN);
      this.input.off(Phaser.Input.Events.POINTER_MOVE);
      this.input.off(Phaser.Input.Events.POINTER_UP);
      this.input.keyboard?.removeAllListeners();
      setMusicLayer('boss', false);
    });

    // §14b law 6: the checkpoint exists from Landing start (a reload settles as abandoned).
    this.director.checkpoint();
    this.cameras.main.fadeIn(SPAN.fade, 0, 0, 0);
    startMusic('run');
    this.setIntensity(PHASE_INTENSITY.day);
    this.started = true;
  }

  /** First frame: centre between the core and the nearest ore patch so the `ore` beat's target is on screen. */
  private focusLanding(core: { col: number; row: number }): void {
    let best: { col: number; row: number } | null = null;
    let bestD = Infinity;
    for (const d of this.model.map.deposits) {
      if (d.kind !== 'ore') continue;
      const dist = Math.hypot(d.col + 1 - core.col, d.row + 1 - core.row);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    const cx = best !== null && bestD < 9 ? (core.col + 0.5 + best.col + 1) / 2 : core.col + 0.5;
    const cy = best !== null && bestD < 9 ? (core.row + 0.5 + best.row + 1) / 2 : core.row + 0.5;
    this.camera.centerOn(cx * TILE, cy * TILE);
  }

  // ── UI host (one per visit) ─────────────────────────────────────────────

  private makeHost(): ColonyUiHost {
    const scene = this;
    return {
      scene: this,
      view: () => this.model.view(),
      get armed(): BuildingId | null {
        return scene.build.armed;
      },
      get speed(): 1 | 2 {
        return scene.speed;
      },
      get paused(): boolean {
        return scene.paused;
      },
      arm: (def) => this.arm(def),
      disarm: () => this.arm(null),
      pick: (id) => {
        this.director.pick(id);
        this.draft = null;
        if (this.director.draftCards === null) this.pendingDraft = null;
        sfx('pick');
      },
      reroll: () => this.director.reroll(),
      ship: (slot) => this.model.shipOrder(slot),
      overdrive: () => this.overdrive(),
      triggerBeacon: () => this.promptBeacon(),
      skipNight: () => {
        const ok = this.director.skipNight();
        if (ok) sfx('dawn', { volume: 0.6 });
        return ok;
      },
      upgrade: (uid) => this.upgrade(uid),
      upgradeAll: (def) => this.upgradeAll(def),
      setPaused: (uid, p) => {
        this.model.setPaused(uid, p);
        sfx('tap', { volume: 0.5 });
      },
      setPinned: (uid, p) => {
        this.model.setPinned(uid, p);
        sfx('tap', { volume: 0.5 });
      },
      demolish: (uid) => this.demolish(uid),
      undoDemolish: () => {
        const ok = this.model.undoDemolish();
        if (ok) this.fx.voice('place', 0.6);
        return ok;
      },
      rebuild: (col, row) => this.rebuild(col, row),
      panTo: (col, row) => this.camera.panTo((col + 0.5) * TILE, (row + 0.5) * TILE),
      setSpeed: (s) => {
        this.speed = s;
        sfx('ui', { volume: 0.3 });
      },
      togglePause: () => this.togglePause(),
      openSheet: (kind) => this.openSheet(kind),
      select: (uid) => this.select(uid),
      get model(): ColonyState {
        return scene.model;
      },
      get validTileCount(): number {
        return scene.started ? scene.build.validCount : 0;
      },
      get depositChip(): Chip | null {
        return scene.depositChip;
      },
      buildDepositChip: () => this.buildDepositChip(),
      tileToScreen: (col, row, out) => this.tileToScreen(col, row, out),
      duskArrowRect: (edge) => this.fx.arrowRect(this.model.tonight?.edges ?? null, edge),
      holdClock: (on) => {
        this.clockHolds = Math.max(0, this.clockHolds + (on ? 1 : -1));
      },
      showRange: (uid) => this.toggleRange(uid),
      want: (def) => this.wantBuilding(def),
    };
  }

  /** Map input is refused while an owner holds the screen. A coach beat is not one: the dusk beat keeps the dock and map live (only the clock is held). */
  private get overlayOpen(): boolean {
    const ui = uiState(this);
    return ui.sheet !== null || ui.draftOpen || this.draft !== null || this.pauseMenu !== null || this.confirm !== null || this.ceremonyActive;
  }

  private openSheet(kind: SheetKind): void {
    if (this.ended || this.pauseMenu !== null || this.draft !== null || this.confirm !== null) return;
    // Law 1: the dawn ceremony that precedes the draft already belongs to it — a sheet opened now would be
    // closed by the draft a moment later and read as a swallowed tap (critic build4 #3). Refuse visibly.
    if (this.director.draftCards !== null) {
      stripNotice(this, 'Dawn — pick a directive first');
      this.fx.voice('deny', 0.5);
      return;
    }
    // Law 1: a sheet closes the card (the opener claims the sheet slot and closes any other).
    this.select(null);
    if (kind === 'build') openBuildSheet(this.host);
    else if (kind === 'orders') openOrdersSheet(this.host);
    else openLedgerSheet(this.host);
    sfx('ui', { volume: 0.4 });
  }

  private select(uid: number | null): void {
    this.card?.show(uid);
    this.depositChip = uid === null ? this.depositChip : null;
    if (uid === null) {
      this.rangeUid = 0;
      this.mapView.showRing(0, 0, null);
      return;
    }
    const b = this.model.buildings.get(uid);
    if (b === undefined) return;
    const c = this.model.centreOf(b);
    // The card sits at y 600-860: ease the building to y ≈ 480 above it (interface-direction §5).
    this.camera.panTo(c.col * TILE, c.row * TILE, 480);
    this.rangeUid = 0;
    this.toggleRange(uid);
  }

  /** Range ring of a turret / relay (drawn on select; the card's RANGE toggles it). */
  private toggleRange(uid: number): void {
    const b = this.model.buildings.get(uid);
    const radius = b === undefined ? null : b.def === 'relay_pylon' ? relayRadius(this.model) : buildingDef(b.def).turret?.rangeTiles ?? null;
    if (b === undefined || radius === null || this.rangeUid === uid) {
      this.rangeUid = 0;
      this.mapView.showRing(0, 0, null);
      return;
    }
    this.rangeUid = uid;
    const c = this.model.centreOf(b);
    this.mapView.showRing(c.col, c.row, radius);
  }

  // ── input ──────────────────────────────────────────────────────────────

  private bindInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (this.ended || this.overlayOpen) return;
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      if (p1.isDown && p2.isDown) {
        this.pinch = { dist: Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y), zoom: this.camera.zoom };
        this.drag = null;
        return;
      }
      if (over.length > 0 || p.y < PLAYFIELD.top || p.y > PLAYFIELD.bottom) return;
      this.camera.stopInertia();
      this.drag = { id: p.id, x: p.x, y: p.y, t: p.time, sx: p.x, sy: p.y, moved: false };
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (this.pinch !== null) {
        const p1 = this.input.pointer1;
        const p2 = this.input.pointer2;
        if (!p1.isDown || !p2.isDown) return;
        const d = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        this.camera.setZoom((this.pinch.zoom * d) / Math.max(1, this.pinch.dist), (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        this.camera.lastUserPanAt = this.time.now;
        return;
      }
      const drag = this.drag;
      if (drag === null || drag.id !== p.id || !p.isDown) return;
      if (!drag.moved && Phaser.Math.Distance.Between(p.x, p.y, drag.sx, drag.sy) > TAP_SLOP) {
        drag.moved = true;
        this.camera.beginDrag(p.time);
      }
      if (!drag.moved) return;
      // Critic build1: the map tracks the finger 1:1 while held (no velocity is applied until release).
      this.camera.dragBy(p.x - drag.x, p.y - drag.y, p.time);
      drag.x = p.x;
      drag.y = p.y;
      drag.t = p.time;
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => {
      if (this.pinch !== null) {
        if (!this.input.pointer1.isDown && !this.input.pointer2.isDown) this.pinch = null;
        this.drag = null;
        return;
      }
      const drag = this.drag;
      this.drag = null;
      // Release: a short damped fling from the last ~80 ms of motion; a finger that rested throws nothing.
      if (drag !== null && drag.moved) this.camera.endDrag(p.time);
      if (drag === null || drag.id !== p.id || drag.moved || this.overlayOpen || this.ended) return;
      this.onMapTap(p.x, p.y, p.time);
    });
  }

  private bindKeys(): void {
    const kb = this.input.keyboard;
    if (kb === null) return;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>;
    kb.on('keydown-SPACE', () => this.togglePause());
    kb.on('keydown-F', () => {
      if (!this.ended) this.host.setSpeed(this.speed === 1 ? 2 : 1);
    });
    kb.on('keydown-O', () => this.openSheet('orders'));
    kb.on('keydown-V', () => this.overdrive());
    kb.on('keydown-B', () => this.promptBeacon());
    kb.on('keydown-ESC', () => this.onEsc());
    kb.on('keydown-PLUS', () => this.camera.stepZoom(1));
    kb.on('keydown-MINUS', () => this.camera.stepZoom(-1));
    kb.on('keydown-ENTER', () => {
      if (this.build.armed !== null && !this.overlayOpen && !this.ended) this.onMapTap(VIEW.width / 2, PLAYFIELD.focusY, -1e9);
    });
  }

  private onEsc(): void {
    if (this.ended || this.coachActive || this.draft !== null || this.confirm !== null) return;
    if (this.pauseMenu !== null) {
      if (!this.pauseMenu.childOpen) this.togglePause();
      return;
    }
    // Sheets close themselves from the template ESC stack.
    if (uiState(this).sheet !== null) return;
    if (this.build.armed !== null) {
      this.arm(null);
      return;
    }
    if (this.card?.uid !== null && this.card?.uid !== undefined) {
      this.select(null);
      return;
    }
    if (this.depositChip !== null) {
      this.depositChip = null;
      return;
    }
    this.togglePause();
  }

  private onMapTap(sx: number, sy: number, time: number): void {
    const w = this.scratch;
    this.camera.screenToWorld(sx, sy, w);
    const I = COLONY_TUNING.input;
    const doubleTap = time - this.lastTap.t <= I.doubleTapMs && Phaser.Math.Distance.Between(sx, sy, this.lastTap.x, this.lastTap.y) <= I.doubleTapPx;
    const before = this.lastTap;
    this.lastTap = { t: doubleTap ? -1e9 : time, x: sx, y: sy, rootX: this.camera.root.x, rootY: this.camera.root.y };
    if (this.build.armed !== null) {
      this.placeArmed(w.x, w.y, sx, sy);
      return;
    }
    if (doubleTap) {
      // Critic build1: zoom about the tap point, never re-centre. The first tap may have started a
      // selection pan (building / card): cancel it and zoom from where the map was when the finger landed.
      this.select(null);
      this.depositChip = null;
      this.camera.stopInertia();
      this.camera.cancelPan();
      this.camera.root.setPosition(before.rootX, before.rootY);
      this.camera.cycleZoom(sx, sy);
      return;
    }
    const col = Math.floor(w.x / TILE);
    const row = Math.floor(w.y / TILE);
    const inMap = col >= 0 && row >= 0 && col < this.model.map.cols && row < this.model.map.rows;
    const tile = inMap ? this.model.tileIndex(col, row) : -1;
    // Tap priority: a ruin on the tapped tile wins (QA#2 — an extractor ruin sits on its deposit, and REBUILD
    // at `mend.rebuildCostRatio` must stay reachable), then an open deposit patch (critic2 #5), then buildings.
    const ruin = inMap
      ? this.model.ruins.find((r) => {
          const f = buildingDef(r.def).footprint;
          return col >= r.col && col < r.col + f && row >= r.row && row < r.row + f;
        })
      : undefined;
    if (ruin !== undefined && (this.model.occ[tile] ?? 0) === 0) {
      this.select(null);
      this.depositChip = null;
      const def = buildingDef(ruin.def);
      const ratio = COLONY_TUNING.mend.rebuildCostRatio;
      const cost = Object.fromEntries(Object.entries(this.model.costOf(ruin.def)).map(([g, n]) => [g, Math.ceil((n ?? 0) * ratio)]));
      const afford = this.model.canAfford(cost);
      const missing = afford ? null : missingLabel(cost, this.model.stock);
      actionToast(this, `${def.name} ruin · ${costLabel(cost)}${missing === null ? '' : ` · ${missing}`}`, {
        actionLabel: 'REBUILD',
        actionEnabled: afford,
        y: TOAST_Y,
        ms: 4000,
        onAction: () => this.rebuild(ruin.col, ruin.row),
      });
      sfx('tap', { volume: 0.4 });
      return;
    }
    const di = tile >= 0 ? this.model.depositAt[tile] ?? 0 : 0;
    const dep = this.model.map.deposits[di - 1];
    if (dep !== undefined && (this.model.occ[tile] ?? 0) === 0 && this.model.revealed[tile] === 1) {
      this.select(null);
      this.depositChip = { def: EXTRACTOR_FOR[dep.kind], col: dep.col, row: dep.row };
      // Critic build4: a chip the player cannot afford yet is still an ask — processors reserve its cost.
      const chipCheck = this.model.canPlace(this.depositChip.def, dep.col, dep.row);
      if (!chipCheck.ok && chipCheck.why === 'afford') this.model.setWant(this.depositChip.def);
      // Input ack ≤ 100 ms (§13 feel budget): outline the patch now and repaint the HUD this frame,
      // so the BUILD chip does not wait for the 10 Hz refresh.
      this.mapView.markPatch(dep.col, dep.row, 2);
      this.hudAcc = HUD_REFRESH_MS;
      sfx('tap', { volume: 0.4 });
      return;
    }
    const b = pickBuilding(this.model, w.x, w.y, this.camera.zoom);
    if (b !== null) {
      this.depositChip = null;
      this.select(b.uid);
      sfx('tap', { volume: 0.4 });
      return;
    }
    this.select(null);
    this.depositChip = null;
  }

  /** Invalid placement (§13): `bad` footprint mark + 6 px shake on the tap frame, the reason floater, `deny`. */
  /**
   * Cert win:spire-not-placed: when the armed building has no whole valid footprint anywhere (a 3×3
   * Spire in a packed ring), say so and why instead of panning to nothing. True when it spoke.
   */
  private noteNoSpace(def: BuildingId): boolean {
    if (this.build.validCount > 0) return false;
    const d = buildingDef(def);
    if (d.deposit !== null) return false;
    const f = d.footprint;
    stripNotice(this, f > 1 ? `No ${f}×${f} lit space — clear/demolish or extend the grid` : 'No lit space — extend the grid with a Relay', 3000);
    return true;
  }

  private refuse(sx: number, sy: number, why: PlaceWhy, at: { col: number; row: number } | null = null): void {
    this.camera.screenToWorld(sx, sy, this.scratch);
    const def = this.build.armed;
    const fp = def === null ? 1 : buildingDef(def).footprint;
    const col = at?.col ?? Math.floor(this.scratch.x / TILE - fp / 2 + 0.5);
    const row = at?.row ?? Math.floor(this.scratch.y / TILE - fp / 2 + 0.5);
    this.fx.deny((col + fp / 2) * TILE, (row + fp / 2) * TILE, fp * TILE);
    this.fx.float(this.scratch.x, this.scratch.y, WHY_TEXT[why], CSS.bad, 26, 30, true);
    stripNotice(this, WHY_TEXT[why]);
    if (def !== null && why !== 'afford') this.noteNoSpace(def);
    this.fx.voice('deny', 0.6);
  }

  private placeArmed(wx: number, wy: number, sx: number, sy: number): void {
    const r = this.build.resolve(wx, wy);
    const def = this.build.armed;
    if (r === null || def === null) {
      this.refuse(sx, sy, 'deposit');
      return;
    }
    if (!r.check.ok) {
      this.refuse(sx, sy, r.check.why, r);
      if (r.check.why === 'afford') {
        this.model.setWant(def);
        this.disarmIfUnaffordable();
      }
      return;
    }
    if (this.model.place(def, r.col, r.row) === null) return;
    // Sticky (§3): stay armed while the next copy is affordable; never move the camera.
    this.disarmIfUnaffordable();
  }

  private buildDepositChip(): void {
    const chip = this.depositChip;
    if (chip === null || this.ended) return;
    const check = this.model.canPlace(chip.def, chip.col, chip.row);
    if (!check.ok) {
      const fp = buildingDef(chip.def).footprint;
      this.fx.deny((chip.col + fp / 2) * TILE, (chip.row + fp / 2) * TILE, fp * TILE);
      stripNotice(this, WHY_TEXT[check.why]);
      if (check.why === 'afford') this.model.setWant(chip.def);
      this.fx.voice('deny', 0.6);
      return;
    }
    // Critic2 #5: BUILD places in place — no camera jump, no card.
    this.model.place(chip.def, chip.col, chip.row);
    this.depositChip = null;
  }

  /** The player asked for `def` and was refused for cost (`ColonyUiHost.want`): processors reserve its cost. */
  private wantBuilding(def: BuildingId): void {
    if (!this.ended) this.model.setWant(def);
  }

  private arm(def: BuildingId | null): void {
    // Law 1: nothing arms while the draft owns the screen, including the dawn ceremony that precedes
    // its overlay (critic build3: dock taps passed through it).
    // `director.draftCards` is the truth (it covers the dawn ceremony before the overlay); a stale
    // `pendingDraft` must never lock the dock once the cards are gone (cert win:spire-not-placed).
    const drafting = this.draft !== null || this.director.draftCards !== null || uiState(this).draftOpen;
    if (def !== null && (this.ended || drafting)) return;
    if (def === this.build.armed) return;
    this.build.arm(def);
    this.reticle?.setVisible(def !== null);
    if (def === null) return;
    // Want-based reserve (ModelDev): processors keep this building's cost in stock for a while.
    this.model.setWant(def);
    this.frameValidTiles();
    this.noteNoSpace(def);
    this.select(null);
    this.depositChip = null;
    sfx('ui', { volume: 0.4 });
  }

  /** Flow F3 (§14b edge): the armed building became unaffordable mid-mode → disarm; the strip names the missing good. */
  private disarmIfUnaffordable(): void {
    const def = this.build.armed;
    if (def === null || this.ended) return;
    const cost = this.model.costOf(def);
    if (this.model.canAfford(cost)) return;
    this.arm(null);
    stripNotice(this, missingLabel(cost, this.model.stock) ?? WHY_TEXT.afford);
  }

  /**
   * Critic build1: when build mode arms and no valid tile is inside the tappable band on screen,
   * ease the nearest valid tile into it (320 ms) instead of leaving the glow under the HUD or dock.
   */
  private frameValidTiles(): void {
    if (this.build.validCount === 0) return;
    const root = this.camera.root;
    const z = this.camera.zoom;
    const top = (TAPPABLE.top - root.y) / z;
    const bottom = (TAPPABLE.bottom - root.y) / z;
    const left = (40 - root.x) / z;
    const right = (VIEW.width - 40 - root.x) / z;
    if (this.build.anyBetween(top, bottom, left, right)) return;
    this.camera.screenToWorld(VIEW.width / 2, PLAYFIELD.focusY, this.scratch);
    const near = this.build.nearestValid(this.scratch.x, this.scratch.y);
    if (near === null) return;
    // Footprint-aware (critic build2: a 3×3 Spire): zoom out if the whole footprint cannot fit the band.
    const fit = (TAPPABLE.bottom - TAPPABLE.top - 40) / near.s;
    this.camera.flyTo(near.x, near.y, VIEW.width / 2, (TAPPABLE.top + TAPPABLE.bottom) / 2, Math.min(z, fit), DUSK_FRAME_MS);
  }

  /**
   * Critic build1 night framing: at dusk, once, frame tonight's first arrow at its band edge with the
   * colony filling the rest of the tappable band — unless the player panned in the last 5 s. The first
   * dusk coach reads the arrow rect in this same event, so that one frames instantly.
   */
  private frameDusk(edges: readonly Edge[]): void {
    const edge = edges[0];
    const at = this.arrowWorld[0];
    if (edge === undefined || at === undefined) return;
    if (!this.autoFrameAllowed()) return;
    const sx = edge === 1 ? ARROW_BAND.x1 : edge === 3 ? ARROW_BAND.x0 : VIEW.width / 2;
    const sy = edge === 0 ? ARROW_BAND.y0 : edge === 2 ? ARROW_BAND.y1 : PLAYFIELD.focusY;
    // Zoom out (never in, never past the lowest stop) until the core also lands inside the band,
    // a core-body clear of the tray / status edge on the far side of the arrow.
    const core = this.model.map.core;
    const coreX = (core.col + 0.5) * TILE;
    const coreY = (core.row + 0.5) * TILE;
    const vertical = edge === 0 || edge === 2;
    const dist = Math.max(1, vertical ? Math.abs(coreY - at.y) : Math.abs(coreX - at.x));
    const avail = vertical ? ARROW_BAND.y1 - ARROW_BAND.y0 - DUSK_CORE_CLEAR : ARROW_BAND.x1 - ARROW_BAND.x0 - DUSK_CORE_CLEAR / 2;
    const zoom = Math.min(this.camera.zoom, avail / dist);
    this.camera.flyTo(at.x, at.y, sx, sy, zoom, this.fx.calm || !hasSeenCoach('dusk') ? 0 : DUSK_FRAME_MS);
  }

  /**
   * Automatic camera moves (dusk, alpha, night fight) never fight the player (critic build2):
   * frozen while a placement is armed (a re-frame ate a Foundry tap) and for 5 s after a pan.
   */
  private autoFrameAllowed(): boolean {
    return this.build.armed === null && this.drag === null && this.pinch === null && this.time.now - this.camera.lastUserPanAt >= DUSK_HANDS_OFF_MS;
  }

  /**
   * Night framing (critic build2): keep the core and the fight nearest it inside the read band all
   * night. Checked ~4×/s; re-frames gently (320 ms) at most once per 6 s — or at once for an alpha
   * arrival (`force`) — and only when `autoFrameAllowed`.
   */
  private frameFight(now: number, force: boolean, focus: { x: number; y: number; half: number } | null = null): void {
    if (this.ended || this.paused || this.ceremonyActive) return;
    if (!force && (now - this.fightCheckAt < FIGHT_CHECK_MS || !this.model.isNight)) return;
    this.fightCheckAt = now;
    if (!force && now - this.lastAutoFrameAt < FIGHT_REFRAME_MS) return;
    if (!this.autoFrameAllowed()) return;
    const core = this.model.map.core;
    const cx = (core.col + 0.5) * TILE;
    const cy = (core.row + 0.5) * TILE;
    let fx = focus?.x ?? NaN;
    let fy = focus?.y ?? NaN;
    if (focus === null) {
      let best = Infinity;
      for (const f of this.threat.fauna.pool) {
        if (!f.alive || f.hidden || f.retreating) continue;
        const d = (f.x - cx) ** 2 + (f.y - cy) ** 2;
        if (d < best) {
          best = d;
          fx = f.x;
          fy = f.y;
        }
      }
      if (!Number.isFinite(fx)) return;
    }
    const z = this.camera.zoom;
    const inBand = (wx: number, wy: number, pad: number): boolean => {
      this.camera.worldToScreen(wx, wy, this.scratch);
      return this.scratch.x >= READ_BAND.x0 + pad && this.scratch.x <= READ_BAND.x1 - pad && this.scratch.y >= READ_BAND.y0 + pad && this.scratch.y <= READ_BAND.y1 - pad;
    };
    // The core sprite rises ~1.5 tiles above its centre: keep a body's clearance for it.
    if (!force && inBand(cx, cy, 1.5 * TILE * z * 0.6) && inBand(fx, fy, 24)) return;
    const w = READ_BAND.x1 - READ_BAND.x0 - 2 * FIGHT_PAD;
    const h = READ_BAND.y1 - READ_BAND.y0 - 2 * FIGHT_PAD;
    const fit = Math.min(w / Math.max(1, Math.abs(fx - cx)), h / Math.max(1, Math.abs(fy - cy)));
    const floor = Math.max(this.camera.zoomFloor, COLONY_TUNING.camera.zoomStops[0]);
    const zoom = Phaser.Math.Clamp(fit, floor, COLONY_TUNING.camera.zoomStops[1]);
    // When core + fight do not both fit at the zoom floor (a far alpha), the core stays in the band and
    // the frame leans as far toward the fight as it can.
    // The 3×3 core sprite reaches ~1.5 tiles from its centre: that much of the band is kept around it.
    // An arriving alpha is the primary subject (critic build3: never half under the power bar); otherwise the core.
    const alphaFirst = force && focus !== null;
    const [px, py, qx, qy] = alphaFirst ? [fx, fy, cx, cy] : [cx, cy, fx, fy];
    const primaryClear = (alphaFirst ? focus.half : 1.6 * TILE) * zoom;
    const halfW = Math.max(0, (READ_BAND.x1 - READ_BAND.x0) / 2 - primaryClear) / zoom;
    const halfH = Math.max(0, (READ_BAND.y1 - READ_BAND.y0) / 2 - primaryClear) / zoom;
    const midX = px + Phaser.Math.Clamp((qx - px) / 2, -halfW, halfW);
    const midY = py + Phaser.Math.Clamp((qy - py) / 2, -halfH, halfH);
    this.lastAutoFrameAt = now;
    this.camera.flyTo(midX, midY, (READ_BAND.x0 + READ_BAND.x1) / 2, (READ_BAND.y0 + READ_BAND.y1) / 2, zoom, this.fx.calm ? 0 : DUSK_FRAME_MS);
  }

  /** A loss outside the read band gets a directional `bad` edge ping (critic build2). */
  private pingLoss(wx: number, wy: number): void {
    this.camera.worldToScreen(wx, wy, this.scratch);
    this.fx.edgePing(this.scratch.x, this.scratch.y);
  }

  private rebuild(col: number, row: number): boolean {
    const b = this.model.rebuild(col, row);
    if (b === null) {
      stripNotice(this, WHY_TEXT.afford);
      this.fx.voice('deny', 0.6);
      return false;
    }
    this.fx.voice('build', 0.6);
    return true;
  }

  private upgrade(uid: number): boolean {
    const ok = this.model.upgrade(uid);
    if (!ok) {
      const b = this.model.buildings.get(uid);
      const cost = this.model.upgradeCost(uid);
      if (b !== undefined && cost !== null && !this.model.canAfford(cost)) this.model.setWant(b.def);
      this.fx.voice('deny', 0.5);
      return false;
    }
    this.rankUpFx(uid, true);
    return true;
  }

  private upgradeAll(def: BuildingId): number {
    const before = new Map<number, number>();
    for (const b of this.model.buildings.values()) if (b.def === def) before.set(b.uid, b.mk);
    const n = this.model.upgradeAll(def);
    if (n === 0) {
      this.fx.voice('deny', 0.5);
      return 0;
    }
    let shown = 0;
    for (const [uid, mk] of before) {
      if (this.model.buildings.get(uid)?.mk === mk || shown >= 6) continue;
      this.rankUpFx(uid, shown === 0);
      shown += 1;
    }
    return n;
  }

  /** Mk rank-up (§13): `playRankUp` pips + shine sweep on the building. */
  private rankUpFx(uid: number, beat: boolean): void {
    const b = this.model.buildings.get(uid);
    if (b === undefined || !this.mapView.anchorOf(uid, this.scratch)) return;
    this.fx.oneShot(FX.upgradeShine, this.scratch.x, this.scratch.y, buildingDef(b.def).footprint * TILE);
    this.fx.voice('upgrade', 0.6);
    if (!beat) return;
    this.camera.worldToScreen(this.scratch.x, this.scratch.y, this.scratch);
    playRankUp(this, { anchor: { x: this.scratch.x, y: this.scratch.y }, rank: b.mk, maxRank: 4 });
  }

  private demolish(uid: number): void {
    const b = this.model.buildings.get(uid);
    if (b === undefined || b.def === 'lander_core') return;
    const name = buildingDef(b.def).name;
    this.model.demolish(uid);
    this.select(null);
    this.fx.voice('demolish', 0.6);
    // §14b confirmation policy: demolish never confirms; a 3 s UNDO toast restores it.
    actionToast(this, `${name} demolished`, {
      actionLabel: 'UNDO',
      y: TOAST_Y,
      ms: COLONY_TUNING.input.undoDemolishSec * 1000,
      onAction: () => this.host.undoDemolish(),
    });
  }

  private overdrive(): boolean {
    if (this.ended || this.overlayOpen || this.model.clock.phase === 'day') return false;
    if (!this.model.overdrive()) {
      this.fx.voice('deny', 0.5);
      return false;
    }
    this.fx.voice('overdrive', 0.8);
    if (!this.fx.calm) shake(this, 0.004, 300);
    const core = this.model.core;
    if (core !== undefined && this.mapView.anchorOf(core.uid, this.scratch, true)) this.fx.float(this.scratch.x, this.scratch.y, 'OVERDRIVE', CSS.primary, 40, 60, true);
    return true;
  }

  private promptBeacon(): void {
    if (this.ended || this.model.beacon !== 'ready' || this.confirm !== null || this.overlayOpen) return;
    this.select(null);
    this.director.pause();
    this.confirm = confirmDialog(this, {
      title: 'CHARGE THE BEACON?',
      body: `The Spire sings for ${Math.round(COLONY_TUNING.beacon.chargeSec)} s and draws ${COLONY_TUNING.beacon.chargeKw} kW.\nThe Chorus comes from every edge.`,
      confirmLabel: 'CHARGE',
      onConfirm: () => {
        this.confirm = null;
        if (!this.paused) this.director.resume();
        this.director.triggerBeacon();
      },
      onCancel: () => {
        this.confirm = null;
        if (!this.paused) this.director.resume();
      },
    });
  }

  private togglePause(): void {
    if (this.ended || this.coachActive || this.uiHolds || this.draft !== null || this.confirm !== null || this.ceremonyActive) return;
    if (this.paused) {
      this.paused = false;
      this.pauseMenu?.destroy();
      this.pauseMenu = null;
      this.director.resume();
      return;
    }
    // Law 1: Pause closes every lower non-pausing overlay (sheet, card); build mode survives.
    uiState(this).sheet?.close();
    this.select(null);
    this.paused = true;
    this.director.pause();
    this.drag = null;
    this.pauseMenu = showColonyPause(this, this.model.clock.sol, {
      onResume: () => this.togglePause(),
      onAbandon: () => {
        this.pauseMenu?.destroy();
        this.pauseMenu = null;
        this.paused = false;
        this.director.resume();
        this.director.abandon();
      },
    });
  }

  /** §14b law 4: hide / blur while running opens Pause first; law 6: checkpoint on the way out. */
  private onHide(): void {
    if (!this.started || this.ended) return;
    this.director.checkpoint();
    if (!this.paused) this.togglePause();
  }

  // ── colony events ─────────────────────────────────────────────────────

  private onColonyEvent(e: ColonyEvent): void {
    switch (e.type) {
      case 'dusk':
        // Only the FTUE Landing's first dusk drops ×2 → ×1 (the coach beat); later dusks keep the player's speed.
        if (this.setup.ftue && e.sol === 1 && this.speed > 1) this.speed = 1;
        this.fx.voice('dusk', 0.8);
        this.arrowField = -1;
        // Project the arrows NOW: the coach reads `duskArrowRect` from this same event, before the next update.
        this.syncArrows(true);
        this.frameDusk(e.plan.edges);
        this.syncArrows(true);
        break;
      case 'nightfall':
        this.mapView.setNight(true, this.fx.calm);
        this.fx.voice('night', 0.7);
        break;
      case 'dawn':
        this.director.checkpoint();
        this.mapView.setNight(false, this.fx.calm);
        this.playDawn(e.arrivals, e.mended, this.model.lastMendCost, this.model.lastRelinked);
        break;
      case 'draft':
        this.draft?.destroy();
        this.draft = null;
        if (this.ceremonyActive) this.pendingDraft = e;
        else this.openDraft(e);
        break;
      case 'brownout':
        this.mapView.flickerField();
        this.mapView.flicker(e.uid);
        this.fx.voice('brownout', 0.7);
        break;
      case 'relic': {
        const relic = RELICS.find((r) => r.id === e.id);
        const x = (e.col + 0.5) * TILE;
        const y = (e.row + 0.5) * TILE;
        this.fx.oneShot(FX.relicBurst, x, y, 192);
        this.fx.voice('relic', 0.8);
        this.camera.worldToScreen(x, y, this.scratch);
        playAcquire(this, { anchor: { x: this.scratch.x, y: this.scratch.y }, name: relic?.name ?? 'Relic', kind: 'RELIC CLAIMED', target: { x: 264, y: 186 }, small: true });
        this.director.checkpoint();
        break;
      }
      case 'unlock':
        this.fx.voice('build', 0.6);
        playAcquire(this, { anchor: { x: VIEW.width / 2, y: UNLOCK_ANCHOR_Y }, name: buildingDef(e.building).name, kind: 'NEW BUILDING', target: { x: 620, y: 1010 } });
        break;
      case 'alpha': {
        this.fx.voice('alpha', 0.9);
        this.setBoss(true);
        const f = this.threat.fauna.pool.find((p) => p.alive && p.def.id === e.id);
        // Frame on the alpha's visual centre (sprites are ground-anchored), with its half-size kept clear.
        if (f !== undefined) {
          const cell = FAUNA_ART[f.def.id].cellPx;
          this.frameFight(this.time.now, true, { x: f.x, y: f.y - cell * 0.45, half: cell * 0.8 });
        }
        if (!this.fx.calm && this.threat.liveCount <= ALPHA_SHAKE_MAX) shake(this, 0.008, 400);
        this.director.checkpoint();
        break;
      }
      case 'evolved':
        this.fx.voice('evolve', 0.8);
        break;
      case 'beacon':
        if (e.state === 'charging') {
          this.fx.voice('charge', 0.9);
          this.setBoss(true);
          this.setIntensity(1);
        }
        break;
      case 'placed':
        this.fx.voice('place', 0.6);
        break;
      case 'destroyed':
        if (this.card?.uid !== null && this.card?.uid !== undefined && !this.model.buildings.has(this.card.uid)) this.select(null);
        break;
      case 'deaths':
        this.fx.voice('loss', 0.7);
        break;
      case 'orders':
        break;
      case 'shipped': {
        const core = this.model.core;
        if (core !== undefined && this.mapView.anchorOf(core.uid, this.scratch)) {
          shuttleLaunch(this, this.mapView.droneLayer, this.scratch);
          this.fx.float(this.scratch.x, this.scratch.y - 80, `+${e.data} Data`, CSS.accent, 34, 70, true);
        }
        this.fx.voice('ship', 0.8);
        this.director.checkpoint();
        break;
      }
      case 'ended':
        this.finish(e.result);
        break;
      default: {
        const never: never = e;
        void never;
      }
    }
    this.coach?.onEvent(e);
  }

  private openDraft(e: Extract<ColonyEvent, { type: 'draft' }>): void {
    if (this.ended) return;
    this.drag = null;
    this.select(null);
    uiState(this).sheet?.close();
    this.fx.voice('draft', 0.6);
    this.draft = showDraft(this.host, e);
  }

  /**
   * Dawn (§13): grade lifts, the lander shuttle arcs onto the core, "+N colonists"; 1.4 s tap-to-skip,
   * then the draft. The dawn mend's Fe is never a silent drop (critic build2): "Mended N · −X Fe".
   */
  private playDawn(arrivals: number, mended: number, mendFe: number, relinked: number): void {
    this.fx.voice('dawn', 0.8);
    const c = this.ceremony;
    if (c === null) return;
    const core = this.model.core;
    const calm = this.fx.calm;
    c.run(calm ? SPAN.calm : SPAN.dawn, () => {
      const pending = this.pendingDraft;
      this.pendingDraft = null;
      if (pending !== null && this.director.draftCards !== null) this.openDraft(pending);
    });
    if (core === undefined || !this.mapView.anchorOf(core.uid, this.scratch)) return;
    const at = { x: this.scratch.x, y: this.scratch.y };
    if (!calm) landerArc(this, this.mapView.droneLayer, at, SPAN.dawn * 0.7, c);
    // The arrival beat rides the ceremony: a tap-to-skip lands it at once instead of dropping it.
    c.at(calm ? 0 : SPAN.dawn * 0.7, () => {
      if (arrivals > 0) this.fx.float(at.x, at.y - 90, `+${arrivals} colonists`, CSS.primary, 40, 80, true);
      const fe = Math.round(mendFe);
      // Auto-rebuilt relays (ModelDev `lastRelinked`) are counted inside `mended`; name them apart.
      const relays = relinked > 0 ? ` · ${relinked} relay${relinked === 1 ? '' : 's'} rebuilt` : '';
      if (fe > 0 || relinked > 0) {
        this.fx.float(at.x, at.y - 30, `Mended ${mended}${relays}${fe > 0 ? ` · −${fe} Fe` : ''}`, CSS.bad, 30, 60, true);
        stripNotice(this, `Dawn mend: ${mended - relinked} repaired${relays}${fe > 0 ? ` · −${fe} Fe` : ''}`, 3000);
      }
      this.fx.voice('lander', 0.7);
    });
  }

  private setBoss(on: boolean): void {
    if (on === this.bossLayer) return;
    this.bossLayer = on;
    setMusicLayer('boss', on);
  }

  /** Score intensity (§12): the value is kept for the feel probe, the music module does not expose it. */
  private setIntensity(v: number): void {
    this.musicLevel = v;
    setMusicIntensity(v);
  }

  /** Feel probe (FeelPass / cert): what the score was last told, and the looping tweens the view registered. */
  get feel(): { music: { intensity: number; boss: boolean }; loops: number; liveTweens: number } {
    return { music: { intensity: this.musicLevel, boss: this.bossLayer }, loops: this.mapView.loops + this.fx.loops, liveTweens: this.tweens.getTweens().length };
  }

  // ── frame ─────────────────────────────────────────────────────────────

  update(time: number, delta: number): void {
    if (!this.started) return;
    const k = this.keys;
    if (!this.ended) {
      const kx = (k.D?.isDown === true || k.RIGHT?.isDown === true ? 1 : 0) - (k.A?.isDown === true || k.LEFT?.isDown === true ? 1 : 0);
      const ky = (k.S?.isDown === true || k.DOWN?.isDown === true ? 1 : 0) - (k.W?.isDown === true || k.UP?.isDown === true ? 1 : 0);
      this.camera.zoomFloor = this.model.isNight && this.threat.liveCount > 0 ? COLONY_TUNING.camera.swarmZoomFloor : COLONY_TUNING.camera.zoomStops[0];
      this.camera.update(delta, kx, ky);
    }

    const coach = this.coachActive;
    // Critic2 #2: sticky build mode disarms when the pausing coach closes (auto or RESUME).
    if (this.coachWas && !coach) this.arm(null);
    this.coachWas = coach;
    // A pausing coach beat or a UI-owned hold (UpgradeAllConfirm, first sheet openings) holds the clock (§14 overlay table).
    const held = coach || this.uiHolds || this.confirm !== null;
    if (!this.ended && !this.paused && !held) {
      if (this.director.isPaused) this.director.resume();
      this.director.update(delta * (this.speed === 2 ? COLONY_TUNING.speed.fastMul : 1));
    } else if (!this.director.isPaused) {
      this.director.pause();
    }

    this.drainFx();
    this.mapView.sync(this.threat.fauna, time);
    this.mapView.setNight(this.model.isNight, this.fx.calm);
    const z = this.camera.zoom;
    const root = this.camera.root;
    this.mapView.cull(-root.x / z, -root.y / z, (VIEW.width - root.x) / z, (VIEW.height - root.y) / z);
    if (this.depositChip === null) this.mapView.clearPatch();
    this.disarmIfUnaffordable();
    this.build.refresh(root.y, z);
    this.syncArrows();
    this.frameFight(time, false);
    this.labelAvoid.length = 0;
    const edges = this.model.tonight?.edges;
    if (edges !== undefined && this.arrowScreen.length > 0) {
      for (const e of edges) {
        const r = this.fx.arrowRect(edges, e);
        if (r !== null) this.labelAvoid.push(r);
      }
    }
    this.mapView.clipLabels(root.x, root.y, z, this.labelAvoid);

    const phase = this.model.clock.phase;
    if (phase !== this.musicPhase && !this.ended) {
      this.musicPhase = phase;
      if (this.model.beacon !== 'charging') this.setIntensity(PHASE_INTENSITY[phase]);
      if (phase === 'day' && this.model.beacon !== 'charging') this.setBoss(false);
    }

    this.hudAcc += delta;
    if (this.hudAcc >= HUD_REFRESH_MS && !this.ended) {
      this.hudAcc = 0;
      const view = this.model.view();
      for (const w of this.widgets) w.update(view);
    }
  }

  /**
   * Dusk arrow placement (critic build2-5): arrows and their counts never overlap each other or any
   * building, and avoid the lit field. Each arrow starts where its field-edge point projects, clamped to
   * the band side FACING its world edge (N top, S bottom, E right, W left), and slides only along that
   * side to the nearest spot that is clear of buildings (arrow body + count), ≥ ARROW_SEP from arrows
   * already placed, and off lit ground. If the side has no such spot with lit ground allowed either, the
   * arrow moves to the screen margin on that side, points inward and sits on a HUD-chip plate.
   */
  private placeArrows(edges: readonly Edge[]): void {
    const z = this.camera.zoom;
    const rects = this.arrowRects;
    rects.length = 0;
    for (const b of this.model.buildings.values()) {
      const f = buildingDef(b.def).footprint;
      this.camera.worldToScreen((b.col + f / 2) * TILE, (b.row + f) * TILE, this.scratch);
      const half = (f * TILE * z) / 2;
      // Sprites are bottom-anchored and about one footprint tall.
      rects.push(this.scratch.x - half, this.scratch.y - 2 * half, this.scratch.x + half, this.scratch.y);
    }
    const { cols, rows } = this.model.map;
    const lit = this.model.lit;
    const w = this.scratch;
    const litAt = (x: number, y: number): boolean => {
      this.camera.screenToWorld(x, y, w);
      const c = Math.floor(w.x / TILE);
      const r = Math.floor(w.y / TILE);
      return c >= 0 && r >= 0 && c < cols && r < rows && lit[r * cols + c] === 1;
    };
    // A box of half-size `h` around (x, y) touches no building sprite.
    const boxClear = (x: number, y: number, h: number): boolean => {
      for (let k = 0; k < rects.length; k += 4) {
        if (x + h > (rects[k] ?? 0) && y + h > (rects[k + 1] ?? 0) && x - h < (rects[k + 2] ?? 0) && y - h < (rects[k + 3] ?? 0)) return false;
      }
      return true;
    };
    const label = this.arrowLabel;
    const placed = this.arrowScreen;
    const sepOk = (x: number, y: number, e: Edge): boolean => {
      arrowLabelAt(e, x, y, label);
      for (let k = 0; k < placed.length; k += 1) {
        const q = placed[k];
        if (q === undefined) continue;
        if (Math.hypot(q.x - x, q.y - y) < ARROW_SEP) return false;
        // Counts never overlap another arrow or its count.
        if (Math.abs(label.x - q.x) < 90 && Math.abs(label.y - q.y) < 70) return false;
        arrowLabelAt(edges[k] ?? 0, q.x, q.y, this.scratch2);
        if (Math.abs(label.x - this.scratch2.x) < 70 && Math.abs(label.y - this.scratch2.y) < 44) return false;
        if (Math.abs(x - this.scratch2.x) < 90 && Math.abs(y - this.scratch2.y) < 70) return false;
      }
      return true;
    };
    const fits = (x: number, y: number, e: Edge, strict: boolean): boolean => {
      if (!boxClear(x, y, ARROW_BODY / 2 + 8) || !sepOk(x, y, e)) return false;
      arrowLabelAt(e, x, y, label);
      if (!boxClear(label.x, label.y, 24)) return false;
      if (!strict) return true;
      const R = 36;
      return !litAt(x, y) && !litAt(x - R, y - R) && !litAt(x + R, y - R) && !litAt(x - R, y + R) && !litAt(x + R, y + R);
    };
    placed.length = 0;
    this.arrowInward.length = 0;
    for (let i = 0; i < edges.length; i += 1) {
      const e = edges[i];
      const p = this.arrowWorld[i];
      const out = this.arrowPool[i];
      if (e === undefined || p === undefined || out === undefined) break;
      this.camera.worldToScreen(p.x, p.y, out);
      const inside = out.x >= ARROW_BAND.x0 && out.x <= ARROW_BAND.x1 && out.y >= ARROW_BAND.y0 && out.y <= ARROW_BAND.y1;
      const vertical = e === 0 || e === 2;
      // Off-screen: pin to the band side that faces the world edge.
      if (!inside) {
        if (e === 0) out.y = ARROW_BAND.y0;
        else if (e === 2) out.y = ARROW_BAND.y1;
        else if (e === 1) out.x = ARROW_BAND.x1;
        else out.x = ARROW_BAND.x0;
      }
      out.x = Phaser.Math.Clamp(out.x, ARROW_BAND.x0, ARROW_BAND.x1);
      out.y = Phaser.Math.Clamp(out.y, ARROW_BAND.y0, ARROW_BAND.y1);
      const [lo, hi] = vertical ? [ARROW_BAND.x0, ARROW_BAND.x1] : [ARROW_BAND.y0, ARROW_BAND.y1];
      const at = vertical ? out.x : out.y;
      let done = false;
      let inward = false;
      const slide = (fixedX: number, fixedY: number, test: (x: number, y: number) => boolean): boolean => {
        for (let d = 0; d <= hi - lo; d += 16) {
          for (const sgn of [1, -1]) {
            const v = at + sgn * d;
            if (v < lo || v > hi) continue;
            const x = vertical ? v : fixedX;
            const y = vertical ? fixedY : v;
            if (test(x, y)) {
              out.x = x;
              out.y = y;
              return true;
            }
          }
        }
        return false;
      };
      done = slide(out.x, out.y, (x, y) => fits(x, y, e, true)) || slide(out.x, out.y, (x, y) => fits(x, y, e, false));
      if (!done) {
        // Margin: outside the band side, pointing inward; only separation from other arrows applies.
        const mx = e === 1 ? ARROW_MARGIN.x1 : e === 3 ? ARROW_MARGIN.x0 : out.x;
        const my = e === 0 ? ARROW_MARGIN.y0 : e === 2 ? ARROW_MARGIN.y1 : out.y;
        done = slide(mx, my, (x, y) => fits(x, y, e, false)) || slide(mx, my, (x, y) => sepOk(x, y, e));
        if (!done) {
          out.x = mx;
          out.y = my;
        }
        inward = true;
      }
      placed.push(out);
      this.arrowInward.push(inward);
    }
  }

  /** Dusk telegraph (§13): arrows at tonight's edges from dusk start until nightfall, clamped into the read window. */
  private syncArrows(duskStart = false): void {
    const tonight = this.model.tonight;
    const show = tonight !== null && (duskStart || this.model.clock.phase === 'dusk' || this.coachActive) && !this.ended;
    if (!show) {
      if (this.arrowScreen.length > 0) {
        this.arrowScreen.length = 0;
        this.fx.setArrows(null, this.arrowScreen, 0);
      }
      return;
    }
    if (this.arrowField !== this.model.fieldVersion || this.arrowWorld.length !== tonight.edges.length) {
      this.arrowField = this.model.fieldVersion;
      this.arrowWorld.length = 0;
      const { cols, rows, core } = this.model.map;
      for (const edge of tonight.edges) {
        const [dx, dy] = EDGE_DIR[edge];
        let last = 0;
        for (let s = 0; s < Math.max(cols, rows); s += 1) {
          const c = core.col + dx * s;
          const r = core.row + dy * s;
          if (c < 0 || r < 0 || c >= cols || r >= rows) break;
          if (this.model.lit[r * cols + c] === 1) last = s;
        }
        this.arrowWorld.push({ x: (core.col + 0.5 + dx * (last + 2)) * TILE, y: (core.row + 0.5 + dy * (last + 2)) * TILE });
      }
    }
    this.placeArrows(tonight.edges);
    this.fx.setArrows(tonight.edges, this.arrowScreen, Math.max(1, Math.round(tonight.totalFauna / Math.max(1, tonight.edges.length))), this.arrowInward);
  }

  /** A pausing coach beat or a UI hold (`ColonyUiHost.holdClock`) owns the clock. */
  private get uiHolds(): boolean {
    return uiState(this).coachOwner || this.clockHolds > 0;
  }

  private drainFx(): void {
    const list = this.model.fx;
    let kills = 0;
    for (const f of list) this.playModelFx(f, kills++ < 6);
    list.length = 0;
  }

  private playModelFx(f: ColonyFx, burstOk: boolean): void {
    switch (f.kind) {
      case 'deliver': {
        const b = this.model.buildings.get(f.uid);
        if (b === undefined || !this.mapView.anchorOf(f.uid, this.scratch)) return;
        const x0 = this.scratch.x;
        const y0 = this.scratch.y;
        const to = this.storageFor(x0, y0);
        this.fx.drone(x0, y0, to.x, to.y, COLONY_TUNING.drones.maxInFlight, COLONY_TUNING.drones.flightMs);
        this.fx.float(x0, y0 - 40, `+1 ${GOOD_SHORT[f.good]}`, CSS.ink, 22, 12);
        return;
      }
      case 'shot':
        this.fx.shot(f.src, f.x0, f.y0, f.x1, f.y1);
        return;
      case 'kill':
        if (burstOk) {
          this.camera.worldToScreen(f.x, f.y, this.scratch);
          burst(this, this.scratch.x, this.scratch.y, PALETTE.inkSoft, f.big ? 16 : 6, f.big ? 340 : 200);
          if (f.big) this.fx.oneShot(FX.bloatBurst, f.x, f.y, 160);
        }
        this.fx.voice('die', 0.4);
        return;
      case 'destroyed': {
        const size = buildingDef(f.def).footprint * TILE;
        this.camera.worldToScreen(f.col * TILE + size / 2, f.row * TILE + size / 2, this.scratch);
        burst(this, this.scratch.x, this.scratch.y, PALETTE.inkSoft, 16, 300);
        this.fx.edgePing(this.scratch.x, this.scratch.y);
        if (!this.fx.calm) shake(this, 0.006, 160);
        this.fx.voice('wreck', 0.7);
        return;
      }
      case 'placed': {
        const b = this.model.buildings.get(f.uid);
        if (b === undefined) return;
        const fp = buildingDef(b.def).footprint;
        this.fx.oneShot(FX.buildDust, (b.col + fp / 2) * TILE, (b.row + fp) * TILE, fp * TILE * 1.3, 0.6);
        return;
      }
      case 'hit':
        this.mapView.jolt(f.uid);
        this.fx.voice('hurt', 0.4);
        return;
      case 'relic':
        this.fx.oneShot(FX.relicBurst, (f.col + 0.5) * TILE, (f.row + 0.5) * TILE, 160);
        return;
      case 'death': {
        this.fx.voice('loss', 0.6);
        // Colonists die in the domes (cold: a dark one): ping the likeliest dome, else the core.
        let at: { col: number; row: number } | null = null;
        for (const b of this.model.buildings.values()) {
          if (b.def !== 'hab_dome') continue;
          if (at === null || (f.reason === 'cold' && !b.lit)) at = this.model.centreOf(b);
          if (f.reason === 'cold' && !b.lit) break;
        }
        at ??= { col: this.model.map.core.col + 0.5, row: this.model.map.core.row + 0.5 };
        this.pingLoss(at.col * TILE, at.row * TILE);
        return;
      }
      case 'shed':
        if (!f.lit) this.mapView.flicker(f.uid);
        this.fx.voice('brownout', 0.5);
        return;
    }
  }

  /** Nearest storage (core or silo) to a world point — the drone's destination (written into a reused point). */
  private storageFor(x: number, y: number): { x: number; y: number } {
    if (this.siloVersion !== this.model.buildVersion) {
      this.siloVersion = this.model.buildVersion;
      this.siloCentres.length = 0;
      for (const s of this.model.buildings.values()) {
        if (s.def !== 'cargo_silo') continue;
        const half = buildingDef(s.def).footprint / 2;
        this.siloCentres.push({ x: (s.col + half) * TILE, y: (s.row + half) * TILE });
      }
    }
    const out = this.droneTo;
    out.x = (this.model.map.core.col + 0.5) * TILE;
    out.y = (this.model.map.core.row + 0.5) * TILE;
    let best = Math.hypot(x - out.x, y - out.y);
    for (const c of this.siloCentres) {
      const d = Math.hypot(x - c.x, y - c.y);
      if (d < best) {
        best = d;
        out.x = c.x;
        out.y = c.y;
      }
    }
    return out;
  }

  // ── terminal (§14b law 5) ─────────────────────────────────────────────

  private finish(result: LandingResult): void {
    if (this.ended) return;
    this.ended = true;
    this.draft?.destroy();
    this.draft = null;
    this.pendingDraft = null;
    this.pauseMenu?.destroy();
    this.pauseMenu = null;
    this.confirm?.close();
    this.confirm = null;
    // Law 1: the terminal Ceremony outranks every owner, the coach included.
    this.coach?.destroy();
    this.coach = null;
    this.coachWas = false;
    uiState(this).sheet?.close();
    this.select(null);
    this.build.arm(null);
    this.reticle?.setVisible(false);
    this.fx.setArrows(null, [], 0);
    this.drag = null;
    const calm = this.fx.calm;
    const span = calm ? SPAN.calm : result.won ? SPAN.launch : SPAN.loss;
    const c = this.ceremony;
    c?.run(span, () => this.leave(result));
    if (result.won && c !== null) this.playLaunch(calm, c);
    else {
      this.fx.voice('fail', 0.9);
      this.mapView.lightsOff(calm ? 200 : 1300);
    }
    this.setBoss(false);
    this.setIntensity(0.2);
  }

  /** Beacon launch payoff (§13): beam to the sky, white flash, the Ark crosses; tap-to-skip. */
  private playLaunch(calm: boolean, c: Ceremony): void {
    this.fx.voice('launch', 1);
    const spire = [...this.model.buildings.values()].find((b) => b.def === 'beacon_spire');
    if (spire !== undefined && this.mapView.anchorOf(spire.uid, this.scratch, true)) {
      this.fx.oneShot(FX.launchFlare, this.scratch.x, this.scratch.y, 320);
      if (!calm) this.camera.panTo(this.scratch.x, this.scratch.y);
      this.threat.retreat();
    }
    if (calm) return;
    flash(this, 0xffffff, 200, 0.3);
    arkFlyby(this, SPAN.launch - 200, c);
  }

  private leave(result: LandingResult): void {
    if (this.transitioning) return;
    this.transitioning = true;
    const data: GameOverData = { result, setup: this.setup, recovered: false };
    this.cameras.main.fadeOut(SPAN.fade, 0, 0, 0);
    this.time.delayedCall(SPAN.fade + 20, () => this.scene.start(SCENES.gameOver, data));
  }

  // ── dev hooks (?debug) ────────────────────────────────────────────────

  private registerDev(): void {
    registerDevHook(
      this,
      'skipTime',
      (seconds?: number) => {
        const s = seconds ?? this.director.secondsToNextBoundary();
        this.director.skip(s);
        return `t=${this.director.elapsedSeconds.toFixed(1)}s sol ${this.model.clock.sol} ${this.model.clock.phase}${this.director.draftCards !== null ? ' (draft open)' : ''}`;
      },
      `${DEV_HOOKS.skipTime}; no arg = jump to the next dusk / dawn`,
    );
    registerDevHook(
      this,
      'spawnBoss',
      (id?: string) => {
        const fauna = id === 'titan' ? 'titan' : 'matron';
        this.threat.spawn(fauna, loudestQuadrant(this.model), this.director.difficulty);
        return `${faunaDef(fauna).name} spawned on the loudest edge`;
      },
      `${DEV_HOOKS.spawnBoss} (arg 'titan' for the Chorus Titan)`,
    );
    registerDevHook(
      this,
      'grant',
      (n?: number) => {
        const amount = n ?? 200;
        const caps = this.model.view().caps;
        for (const g of GOODS) this.model.stock[g] = Math.max(this.model.stock[g], Math.min(caps[g], this.model.stock[g] + amount));
        return `+${amount} of every good (clamped to storage caps)`;
      },
      'grant(n = 200) — add n of every good to colony stock, never past its storage cap',
    );
    registerDevHook(
      this,
      'unlockAll',
      () => {
        const target = this.director.table.find((w) => w.sol === COLONY_TUNING.beacon.unlockSol);
        if (target === undefined || this.director.elapsedSeconds >= target.dayStart) return 'already unlocked';
        // QA#8: skip stops at every dawn draft — auto-pick its first card and keep going to the Spire's sol.
        // An untended colony would lose its core on the way, so the skip runs in 1 s steps that keep the
        // Lander Core at full hp and the colony fed (a dev shortcut, never a play path).
        const picked: string[] = [];
        const caps = this.model.view().caps;
        for (let guard = 0; guard < 4000 && !this.ended && this.director.elapsedSeconds < target.dayStart; guard += 1) {
          const cards = this.director.draftCards;
          if (cards !== null) {
            const id = cards[0]?.id;
            if (id === undefined) break;
            this.draft?.destroy();
            this.draft = null;
            this.pendingDraft = null;
            this.director.pick(id);
            picked.push(id);
            continue;
          }
          if (this.paused || this.director.isPaused) break;
          this.director.skip(Math.min(1, target.dayStart - this.director.elapsedSeconds + 0.05));
          const core = this.model.core;
          if (core !== undefined) core.hp = core.maxHp;
          this.model.stock.rations = Math.max(this.model.stock.rations, caps.rations);
        }
        const open =
          this.director.elapsedSeconds < target.dayStart
            ? ` (stopped early: ${this.paused ? 'game paused' : this.director.isPaused ? 'clock held by an overlay' : 'landing ended'})`
            : this.director.draftCards !== null
              ? `; the sol ${this.model.clock.sol} draft is open`
              : '';
        return `skipped to sol ${this.model.clock.sol} ${this.model.clock.phase}; every building unlocked; auto-picked ${picked.length} draft card(s): ${picked.join(', ') || 'none'}${open}`;
      },
      `${DEV_HOOKS.unlockAll}: skips to sol ${COLONY_TUNING.beacon.unlockSol} (Beacon Spire unlocks), auto-picking the first card of every dawn draft and keeping the core whole and the colony fed on the way`,
    );
  }
}
