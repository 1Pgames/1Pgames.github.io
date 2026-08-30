import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, TUNING, VIEW } from '../../config';
import { SCENES } from '../../core/keys';
import { Controls } from '../../core/controls';
import { Joystick } from '../../ui/joystick';
import { Rng } from '../../core/rng';
import { isDailyMode, saveDailyBest, sessionSeed } from '../../core/daily';
import { resetDamageClock, setDamageClock } from '../../core/damage';
import { Pool } from '../../core/pool';
import { RunDirector, type EventSpec, type WaveSpec } from '../../core/run';
import {
  bankRelics,
  clearRunJournal,
  grantCurrency,
  loadMeta,
  recordRunResult,
  recordWardenKill,
  runLoadout,
  settleAbandonedRun,
  touchDailyStreak,
  writeRunJournal,
  type RunLoadout,
} from '../../core/progression';
import { track } from '../../core/telemetry';
import { rollUpgradeChoices, type UpgradeDef, type UpgradeRollContext } from '../../data/upgrades';
import { PHASES, WAVES, TIMELINE_EVENTS } from '../../data/waves';
import { ANIM, TEXTURE } from '../../data/art';
import { eliteEnemies, type EnemyDef } from '../../data/enemies';
import { relicDef, rollRelic, type RelicDef } from '../../data/relics';
import { STARTING_ZONE, zoneDef, type ZoneDef } from '../../data/zones';
import { applyEffect } from '../../core/effects';
import { sfx, sfxArp } from '../../core/audio';
import { startMusic, setMusicIntensity, setMusicLayer } from '../../core/music';
import {
  allowEffect,
  banner,
  burst,
  desaturate,
  edgeFlash,
  flash,
  floatText,
  hitstop,
  pop,
  shake,
  toast,
} from '../../core/juice';
import { Arena } from '../../systems/arena';
import { CombatSystem } from '../../systems/combat';
import { ZoneSystem, zoneArenaLayout, type ZoneHazardKind } from '../../systems/zone';
import { Hud, type HudModel } from '../../ui/hud';
import { showUpgradeCards, type UpgradeCardsHandle } from '../../ui/cards';
import { showPauseOverlay, type PauseBagRelic, type PauseOverlayHandle } from '../../ui/pauseOverlay';
import { Button } from '../../ui/button';
import { GateCompass, type GateCompassGate, type GateCompassModel } from '../../ui/gateCompass';
import { BagPips, type BagPipsModel } from '../../ui/bagPips';
import { ChannelBar, type ChannelBarModel } from '../../ui/channelBar';
import { BUTTON_STYLE, IDENTITY, tierColor, tierColorCss } from '../../ui/duskChrome';
import { hasSeenCoach, type CoachHandle, type CoachRect } from '../../ui/coach';
import { showGateCoach, startOpeningCoach, type OpeningCoach } from '../../ui/coachBeats';
import {
  ExtractionSystem,
  type ExtractionEvent,
  type GateSpec,
  type GateState,
} from '../../systems/extraction';
import { Bag, resolveBagCapacity } from '../../systems/bag';
import type { GameOverData, HaulRelic } from '../../scenes/gameover';
import { RelicPickup } from '../../objects/relic';

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
] as const;

/** A ground-spawned relic arms after this beat so an overflow drop isn't instantly re-vacuumed. */
const RELIC_PICKUP_ARM_MS = 1200;
/** §15: relic pickup pool. A run sees ~12 relic opportunities; 16 covers overlap. */
const RELIC_POOL_SIZE = 16;
/** At most this many shard caches sit on the field at once (§15 entity budget). */
const MAX_CACHES = 3;
/** World-space gate ring styling per gate state. */
const GATE_RING_STYLE: Record<GateState, { color: number; alpha: number }> = {
  closed: { color: IDENTITY.cooled, alpha: 0.35 },
  open: { color: IDENTITY.gateOpen, alpha: 0.95 },
  closing: { color: IDENTITY.hazardAmber, alpha: 0.95 },
  spent: { color: IDENTITY.cooled, alpha: 0.2 },
};
/**
 * Gate arch display size as a multiple of `TUNING.gate.radius`. The art is a
 * free-standing archway drawn ~62% of its square cell, so 2.4x the radius puts
 * a ~180px-wide arch on a 120px-radius ring — read as a structure you walk to,
 * without covering the bodies contesting it.
 */
const GATE_ART_SCALE = 2.4;
/**
 * Cross-fade for the `gate-opening` -> `gate-open` handoff. Measured: the two
 * sheets are geometrically identical to within 1px (bbox 87x110 in both) but
 * `gate-opening` ends a mean 43 RGB points BRIGHTER than every frame of the
 * `gate-open` loop, so a hard cut steps down visibly. A start-frame search does
 * not help (all four frames sit within 1.2 of each other); a short fade over
 * identical geometry does, with no ghosting to betray it.
 */
const GATE_HANDOFF_MS = 100;
/** A spent gate keeps its dead arch but drops back — it is scenery now. */
const GATE_SPENT_ALPHA = 0.4;
/** World height of one Collapse curtain segment. Never stretched to the cell. */
const COLLAPSE_SEGMENT_H = 150;
/** Nominal world width of one segment; the real width is the arc step it covers. */
const COLLAPSE_SEGMENT_W = 130;
/**
 * Segments widened against their arc step so neighbours overlap by ~3px. The
 * sheet's alpha width varies 97.7%-100.0% of the cell across its four frames,
 * so an exact 1.0x spacing opens and closes a dotted seam as the loop cycles.
 */
const COLLAPSE_SEGMENT_OVERLAP = 1.03;
/** Enough segments for the widest ring that fits the camera at once (§15). */
const COLLAPSE_SEGMENT_POOL = 32;
/** Warden zone skins (§11): four generated idle sheets, one per zone. */
const WARDEN_SKIN: Record<string, string> = {
  castle: ANIM.wardenIdle,
  outlands: ANIM.wardenIdleOutlands,
  desert: ANIM.wardenIdleDesert,
  winter: ANIM.wardenIdleWinter,
};
/**
 * The §5.4 Gate B guard pack: one elite plus `TUNING.elite.gateGuardAdds`
 * trash, which is the composition the 250s wave row authors ("reaper + 8
 * husks"). The adds go through `ZoneSystem.pickSpawnId`, so a zone may
 * substitute its own exclusive for the husk — the elite is the pack's identity
 * and is not substituted.
 */
const GATE_GUARD_ELITE_ID = 'elite_reaper';
const GATE_GUARD_ADD_ID = 'husk';

/**
 * §14.2's authored compass ring, vertically: an arrow never leaves this band,
 * so the `tut:gate` spotlight is clamped to it too — a spotlight cut over the
 * HUD band or the joystick would teach the wrong widget.
 */
const COACH_GATE_RING = { top: 200, bottom: 1000 } as const;
/** Spotlight size: the 48px arrow plus its countdown chip, with room to breathe. */
const COACH_GATE_SPOT = 160;

/** Ids the Collapse injects; cycled so the finale is not one elite on repeat. */
const COLLAPSE_ELITE_IDS: readonly string[] = eliteEnemies().map((def) => def.id);

/** One shard cache on the ground — the non-kill income floor (§6, `loot.cache*`). */
interface ShardCache {
  img: Phaser.GameObjects.Image;
  value: number;
  expiresAtMs: number;
}

/**
 * Integrator scene for Duskhaul: wires the director, combat, the zone and its
 * hazard, the extraction gates, the bag and the HUD components together, and
 * translates their callbacks into feedback.
 *
 * The one rule this scene exists to protect: THE RUN RESOLVES ONLY BY
 * EXTRACTION OR DEATH. There is no timer win anywhere in this file — past
 * `collapse.atS` the dusk-fire ring makes death inevitable, but it is still a
 * death, and the only other exit is a completed gate channel.
 */
export class GameScene extends Phaser.Scene {
  private rng!: Rng;
  private seed = '';
  private simTimeMs = 0;
  private arena!: Arena;
  private controls!: Controls;
  private joystick!: Joystick;
  private combat!: CombatSystem;
  private director!: RunDirector;
  private hud!: Hud;
  private pauseButton!: Button;

  private kills = 0;
  private taken: string[] = [];
  private drafting = false;
  /**
   * Draft requests deferred because one was already on screen, or because the
   * player is mid-channel — see `queueDraft`. Never dropped, only delayed.
   */
  private pendingDrafts = 0;
  private paused = false;
  private ended = false;
  private cards: UpgradeCardsHandle | null = null;
  private pauseOverlay: PauseOverlayHandle | null = null;
  private rerollsUsedThisDraft = 0;
  /**
   * Mirrors whether the pause icon is currently tappable, so the enable/disable
   * pair runs on TRANSITIONS rather than every frame (`syncPauseAffordance`).
   */
  private pauseAffordanceLive = true;
  private bossActive = false;

  /**
   * Everything the meta save contributes to THIS run, read exactly once in
   * `create()` (PRD §10). Nothing here is re-read per frame and nothing mutates
   * `TUNING`: the run's numbers are latched at run start, which is what keeps a
   * seed reproducible while the shop is being bought out between runs.
   */
  private loadout!: RunLoadout;

  // --- §14b FTUE beats -----------------------------------------------------
  private openingCoach: OpeningCoach | null = null;
  private gateCoach: CoachHandle | null = null;
  /** True while a coach beat is holding the run (a superset of `paused`). */
  private coachHold = false;
  /** True once the `tut:stick` beat is the live one, so the stick is unlocked. */
  private coachStickLive = false;
  /** True while `teardown` is running: the beats must not resume a dead scene. */
  private tearingDown = false;

  /**
   * §14b interruption matrix: a tab-hidden/wake on a LIVE combat state must
   * auto-pause, so the player is never dropped back into an ambush frame they
   * did not see coming — the arena they left is not the arena they return to.
   * `main.ts` sleeps and wakes the loop around the same event; this decides
   * whether the run is allowed to be running once it is awake.
   *
   * A class-property arrow so the identity is stable and `teardown` can take it
   * off the document: a DOM listener is the one subscription that outlives a
   * Phaser scene without complaint.
   */
  private readonly onTabVisibility = (): void => {
    if (document.hidden) return;
    // Something else already owns the screen (a draft, a coach beat, PAUSED
    // itself, or the results fade) — waking must not stack a second overlay on
    // it, which is the exact §14b violation `togglePause` now refuses.
    if (this.ended || this.paused || this.drafting || this.coachHold) return;
    this.togglePause();
  };

  // --- §14b abandon rule journal ------------------------------------------
  /** ms since the shard checkpoint was last written (refresh is capped at 1Hz). */
  private journalAccMs = 0;

  // --- §2A Gate B guard pack ----------------------------------------------
  /** Latched once the pack has been placed, so it can never spawn twice. */
  private gateGuardPlaced = false;
  /** Scheduled spawns still to be absorbed by the pack that already landed. */
  private gateGuardAbsorb = 0;

  /** Scratch for the pause overlay's bag row — rebuilt per read, never per frame. */
  private readonly bagRowRelics: PauseBagRelic[] = [];

  // --- zone, extraction and loot state (every field re-reset in `create`; the
  // --- scene instance survives `scene.start` round-trips) ---
  private zoneId = STARTING_ZONE.id;
  private zone!: ZoneDef;
  private zoneSystem!: ZoneSystem;
  private zoneGates: GateSpec[] = [];
  private extraction!: ExtractionSystem;
  private bag!: Bag;
  private tookHitSinceTick = false;
  private collapseBonus = 0;
  private collapseElitesSpawned = 0;
  private fireFlashAccMs = 0;
  private relicDripAccMs = 0;
  private firstRelicDone = false;
  private cacheAccMs = 0;
  private caches: ShardCache[] = [];
  private relicPool!: Pool<RelicPickup>;
  private relics: RelicPickup[] = [];
  private gateRings: Record<GateSpec['id'], Phaser.GameObjects.Arc> | null = null;
  /**
   * The generated gate arch per gate, one sprite driven by gate state (§11: the
   * gate is gameplay, so it is art, not a primitive). Null when the
   * `gates-collapse` group is not loaded, in which case `gateRings` stays
   * visible as the crash-safe fallback.
   */
  private gateSprites: Record<GateSpec['id'], Phaser.GameObjects.Sprite> | null = null;
  /**
   * Tangential segments of the generated Collapse curtain. Only the ones inside
   * the camera view are given a position each frame, so a 1200px-radius ring
   * costs ~24 sprites instead of ~58 (§15 entity budget). Empty when the art is
   * absent, in which case `collapseGfx` strokes the ring instead.
   */
  private collapseSegments: Phaser.GameObjects.Sprite[] = [];
  private gateRingState: Record<GateSpec['id'], GateState | null> = { a: null, b: null, c: null };
  private gatePreviewed: Record<GateSpec['id'], boolean> = { a: false, b: false, c: false };
  private channelGfx!: Phaser.GameObjects.Graphics;
  private collapseGfx!: Phaser.GameObjects.Graphics;
  private channelVignette!: Phaser.GameObjects.Graphics;
  private shrineMarker: Phaser.GameObjects.Image | null = null;
  private shrineX = 0;
  private shrineY = 0;
  private shrineArmed = false;
  private shrineSpawnAccMs = 0;
  /** Composition ramp: next run-second at which a trash spawn becomes an elite. */
  private nextEliteSwapS = 0;
  private eliteSwapIndex = 0;

  // --- HUD components (owned by UiMeta, fed from here) ---
  private compass!: GateCompass;
  private bagPips!: BagPips;
  private channelBar!: ChannelBar;

  /** Reused HUD models — the HUD is diffed, so these are never reallocated. */
  private readonly compassGates: GateCompassGate[] = [];
  private readonly compassModel: GateCompassModel = {
    playerX: 0,
    playerY: 0,
    elapsedS: 0,
    gates: this.compassGates,
  };
  private readonly bagRelicTiers: number[] = [];
  private readonly bagCasketTiers: number[] = [];
  private readonly bagModel: BagPipsModel = {
    slots: TUNING.bag.slots,
    used: 0,
    relicTiers: this.bagRelicTiers,
    casketSlots: TUNING.bag.casketSlots,
    casketTiers: this.bagCasketTiers,
    shards: 0,
  };
  private readonly channelModel: ChannelBarModel = {
    active: false,
    gateId: null,
    progress: 0,
    interrupted: false,
  };
  /**
   * §13 "Channel progress — per 25% `tap` pitch-up". The last quarter that
   * sounded, so the four ticks fire once each on the way up and RE-arm after a
   * setback drops the fill back below a line the player had already passed.
   */
  private channelQuarter = 0;
  /** True on the frames a channel is up — drives the one-shot start beat. */
  private channelWasActive = false;
  /** Scratch for the in-ring enemy census fed to the channel. */
  private readonly contest = { enemies: 0, elites: 0 };

  private readonly model: HudModel = {
    hp: TUNING.player.maxHp,
    hpMax: TUNING.player.maxHp,
    level: 1,
    xp: 0,
    xpNeeded: 1,
    timeMs: 0,
    runSeconds: TUNING.runSeconds,
    phase: '',
    collapsing: false,
  };

  constructor() {
    super(SCENES.game);
  }

  /** `scene.start(SCENES.game, { seed, zone })` reruns the exact same run. */
  init(data: { seed?: string; zone?: string } = {}): void {
    this.seed = data.seed ?? sessionSeed();
    this.zoneId = (data.zone ?? STARTING_ZONE.id) as ZoneDef['id'];
  }

  create(): void {
    this.kills = 0;
    this.taken = [];
    this.drafting = false;
    this.pendingDrafts = 0;
    this.paused = false;
    this.ended = false;
    this.cards = null;
    this.pauseOverlay = null;
    this.rerollsUsedThisDraft = 0;
    // A fresh `Button` is built below and is interactive, so the mirror starts
    // true — scene instances survive `scene.start`, and a stale `false` here
    // would leave the icon permanently deaf on the second run.
    this.pauseAffordanceLive = true;
    this.bossActive = false;
    this.simTimeMs = 0;
    this.tookHitSinceTick = false;
    this.collapseBonus = 0;
    this.collapseElitesSpawned = 0;
    this.fireFlashAccMs = 0;
    this.relicDripAccMs = 0;
    this.firstRelicDone = false;
    this.cacheAccMs = 0;
    this.shrineMarker = null;
    this.shrineArmed = false;
    this.shrineSpawnAccMs = 0;
    this.nextEliteSwapS = TUNING.wave.compositionFromS;
    this.eliteSwapIndex = 0;
    // The previous visit's display objects died with the scene — only the
    // instance-level references need dropping.
    this.relics = [];
    this.caches = [];
    this.gateRings = null;
    this.gateSprites = null;
    this.collapseSegments = [];
    this.gateRingState = { a: null, b: null, c: null };
    this.gatePreviewed = { a: false, b: false, c: false };
    this.compassGates.length = 0;
    this.bagRelicTiers.length = 0;
    this.bagCasketTiers.length = 0;
    this.openingCoach = null;
    this.gateCoach = null;
    this.coachHold = false;
    this.coachStickLive = false;
    this.tearingDown = false;
    this.journalAccMs = 0;
    this.gateGuardPlaced = false;
    this.gateGuardAbsorb = 0;
    this.bagRowRelics.length = 0;

    // One seed drives the entire run — arena layout, hazard sites, spawns and
    // upgrade rolls — so the same seed always replays identically.
    this.rng = new Rng(this.seed);
    // The damage clock ticks only while the run is actually advancing (see
    // `update`), so i-frames can't be swallowed by wall-clock time passing
    // during a paused run or an upgrade draft.
    setDamageClock(() => this.simTimeMs);

    // The meta save is read HERE and only here (§10): one parse, one latch.
    this.loadout = runLoadout();

    this.zone = zoneDef(this.zoneId);
    // The arena owns the field: floor, walls, props and the world/camera
    // bounds. The zone supplies its own floor art.
    this.arena = new Arena(this, this.seed, zoneArenaLayout(this.zone));

    // === BEGIN replaceable gameplay ===
    this.combat = new CombatSystem(
      this,
      this.rng,
      this.arena,
      {
        onEnemyKilled: (def, x, y, shards) => this.onEnemyKilled(def, x, y, shards),
        onPlayerHit: (ratio) => this.onPlayerHit(ratio),
        onPlayerDied: () => this.die(),
        onPlayerRevived: () => this.onPlayerRevived(),
        onLevelUp: (_level, gained) => this.onLevelUp(gained),
        onPlayerAttack: () => sfx('tap', { volume: 0.25 }),
        onBossSpawned: () => this.onBossSpawned(),
        onBossKilled: () => this.onWardenDown(),
        onWeaponEvolved: (name) => this.onWeaponEvolved(name),
        onCoinCollected: (value) => this.onCoinCollected(value),
      },
      this.loadout.modifiers,
    );
    // The Warden wears this zone's own generated idle sheet (§11: four real
    // skins with a shoulder/crown silhouette swap, not a recolour). An unloaded
    // key falls back to the castle base inside `Enemy.spawnWith`.
    this.combat.setBossSkin(WARDEN_SKIN[this.zone.id] ?? null);

    // Equipped-gear riders that are not stats (§5.5): Widow's Veil lengthens
    // contact i-frames, Sorrowplate scales the blow itself, Last Rite arms one
    // refusal of the grave. Applied to the systems that own each rule, so the
    // relic works through the same path the card of the same name does.
    this.combat.player.health.invulnMs = TUNING.player.invulnMs + this.loadout.iframesMsBonus;
    this.combat.setContactDamageMul(this.loadout.contactDamageMul);
    if (this.loadout.reviveCharges > 0) {
      const effects = this.combat.effects;
      effects.lastGaspCharges = this.loadout.reviveCharges;
      effects.lastGaspReviveRatio = this.loadout.reviveHpRatio;
      effects.lastGaspIframesMs = TUNING.effects.lastGasp.iframesMs;
    }

    this.cameras.main.startFollow(
      this.combat.player,
      true,
      TUNING.arena.cameraLerp,
      TUNING.arena.cameraLerp,
    );
    // Bias the view upward so the player sits below the HUD band instead of
    // disappearing behind it at the arena's top edge.
    this.cameras.main.setFollowOffset(0, TUNING.arena.cameraOffsetY);

    this.hud = new Hud(this);

    // The zone owns its hazard, its gate positions and its spawn-table bias.
    this.zoneSystem = new ZoneSystem(this, this.rng, this.arena, this.zone, this.combat.player, {
      onHazardHit: (amount, x, y) => this.onHazardHit(amount, x, y),
      onHazardDrain: (amount) => this.onHazardDrain(amount),
      onHazardTelegraph: (kind, x, y) => this.onHazardTelegraph(kind, x, y),
      onHazardStrike: (kind, x, y) => this.onHazardStrike(kind, x, y),
    });
    this.zoneGates = [...this.zoneSystem.gates];

    this.director = new RunDirector(
      this,
      WAVES,
      PHASES,
      (id, _index, _total, pattern) => this.onDirectorSpawn(id, pattern),
      {
        durationSeconds: TUNING.runSeconds,
        onPhaseChange: (phase) => {
          this.model.phase = phase.name;
          sfx('whoosh', { volume: 0.5 });
        },
        onEvent: (event) => this.onScriptedEvent(event),
        events: TIMELINE_EVENTS,
      },
    );

    // Extraction twist: gates + bag + Collapse. The run ends ONLY through a
    // completed gate channel or death — there is no timer win (PRD §2A).
    //
    // The bag's size and the channel's length are the player's PURCHASES, not
    // constants: `bagSlots` and `channelMs` are frozen §16.1 stat keys, so
    // Marrow Sack, Bleak Haste and the Gravekey all arrive as modifiers on the
    // player's own `StatBlock` and are read back out here as DELTAS from the
    // authored base. That is the single application point `data/relics.ts`
    // names — nothing mutates `TUNING`, which is shared and frozen.
    const stats = this.combat.player.stats;
    const capacity = resolveBagCapacity(TUNING.bag, {
      bagSlotsBonus: Math.round(stats.get('bagSlots')) - TUNING.bag.slots,
      casketSlotsBonus: this.loadout.casketSlotsBonus,
    });
    this.bag = new Bag(capacity.slots, capacity.casketSlots);
    this.extraction = new ExtractionSystem(this.zoneGates, {
      channelMs: TUNING.extract.channelMs,
      radius: TUNING.gate.radius,
      collapseAtS: TUNING.collapse.atS,
      closingWarnS: TUNING.gate.closingWarnS,
      gateWindowBonusS: TUNING.extract.gateWindowBonusS + this.loadout.gateWindowBonusS,
      channel: {
        ...TUNING.extract,
        channelMsDelta:
          TUNING.extract.channelMsDelta + (stats.get('channelMs') - TUNING.extract.channelMs),
      },
      collapse: TUNING.collapse,
    });
    this.extraction.onEvent((e, id) => this.onExtractionEvent(e, id));
    // Spawn policy lives here, not in combat: nothing NEW appears inside
    // `extract.suppressRadius` of a live gate, so "clear the ring, then hold"
    // is a real plan instead of a race against an infinite faucet.
    this.combat.setSpawnFilter((x, y) => !this.extraction.spawnSuppressed(x, y));

    this.relicPool = new Pool<RelicPickup>(
      () => new RelicPickup(this),
      (pickup) => pickup.despawn(),
      RELIC_POOL_SIZE,
    );

    this.buildGateVisuals();
    this.buildHudComponents();
    // === END replaceable gameplay ===

    // Movement is the joystick; `Controls` stays for keyboard parity.
    this.joystick = new Joystick(this);
    this.controls = new Controls(this);

    // §14.1 row 2: 88x88 hit area at (592, 0), i.e. centred (636, 44). The
    // template centred it on `SAFE.top / 2` = y 70, which put the capsule at
    // y 26-114 and dropped its bottom 32px straight onto the §14.1 shard
    // counter (x 550-680, y 82-118). Chrome is §14.4 `BUTTON.idle`, not the
    // template's stray `#e8ecf6`.
    this.pauseButton = new Button(this, 636, 44, 'II', () => this.togglePause(), {
      width: 88,
      height: 88,
      fill: BUTTON_STYLE.idle.fill,
      stroke: BUTTON_STYLE.idle.stroke,
      textColor: BUTTON_STYLE.idle.textColor,
      fontSize: '36px',
    });
    // Above the draft overlay (2000) and below the pause overlay (2100). It
    // stays above the draft dim NOT so pause-over-draft is reachable — that
    // stack is now refused outright (see `togglePause`) — but so the icon can
    // be SEEN going dim and deaf while the cards are up, instead of silently
    // vanishing under the dim and leaving the player tapping a shape they can
    // no longer see. Measured in the browser.
    this.pauseButton.setDepth(2050);

    this.input.keyboard?.on('keydown-ESC', () => this.togglePause());
    this.input.keyboard?.on('keydown-P', () => this.togglePause());

    // Auto-pause on tab wake (§14b). Registered on the DOCUMENT, so it is
    // removed in `teardown` rather than left to the scene's own event bus.
    document.addEventListener('visibilitychange', this.onTabVisibility);

    // Scene instances survive `scene.start`, so every long-lived subsystem is
    // unhooked here rather than trusting the next `create` to overwrite it.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());

    this.cameras.main.fadeIn(220, 0, 0, 0);
    this.markDailyStreak();

    startMusic('run');
    setMusicIntensity(0.25);

    // §14b abandon rule: the marker goes down BEFORE the first frame, so even a
    // reload one second into the run settles as a death instead of vanishing.
    this.refreshJournal();

    // §14b FTUE: the opening sequence runs before the director's first tick.
    // The hooks hold the whole run (not just the director) and the joystick is
    // gated until the drag the beat is teaching actually happens.
    this.openingCoach = startOpeningCoach(this, {
      pause: () => this.holdForCoach(true),
      resume: () => this.holdForCoach(false),
    });
    if (this.openingCoach !== null) this.joystick.setEnabled(false);
  }

  /**
   * Freezes/thaws the whole run for a coach beat. A beat must stop the DIRECTOR
   * and the extraction clock, not just the spawner: a gate window that ticks
   * away while the tutorial explains gates is the tutorial killing the run.
   */
  private holdForCoach(hold: boolean): void {
    if (this.tearingDown || this.ended) return;
    this.coachHold = hold;
    if (hold) {
      this.director.pause();
      this.combat.setPaused(true);
      return;
    }
    this.openingCoach = null;
    this.gateCoach = null;
    this.coachStickLive = false;
    // A pause overlay or a draft opened over the beat owns the run now.
    if (this.paused || this.drafting) return;
    this.director.resume();
    this.combat.setPaused(false);
    this.joystick.setEnabled(true);
  }

  /**
   * Drives the opening sequence from `update`. The stick beat is `swap-gate`:
   * it ends on the taught DRAG and on nothing else, so the run is safe to sit
   * in forever (§14b "run 1, player never moves").
   */
  private tickOpeningCoach(): void {
    const coach = this.openingCoach;
    if (coach === null) return;
    if (!this.coachStickLive) {
      // `showCoach` writes `tut:<id>` the moment a beat APPEARS, so this flag
      // flipping is the goal beat handing over to the stick beat.
      if (!hasSeenCoach('stick')) return;
      this.coachStickLive = true;
      this.joystick.setEnabled(true);
      return;
    }
    // ANY supported movement input clears the beat, not just the stick. Gating
    // on `joystick.vector` alone soft-locked keyboard-only players FOREVER: the
    // beat never dismissed, the run clock stayed frozen at 0.00s, and the run
    // could not be started at all — on the first screen of the game, with WASD
    // a documented input (§3) that the very next lines use to drive the player.
    const stick = this.joystick.vector;
    const moving =
      stick.x !== 0 || stick.y !== 0 || this.controls.axisX !== 0 || this.controls.axisY !== 0;
    if (!moving) return;
    coach.finishStick();
  }

  /** Kills everything that outlives a scene swap: components, pools, hazards. */
  private teardown(): void {
    this.tearingDown = true;
    // A document listener does not belong to the scene's bus and will happily
    // fire into a dead scene, which is the black-screen trap in AGENTS.md.
    document.removeEventListener('visibilitychange', this.onTabVisibility);
    // A live beat must not resume a scene that is being destroyed, which is why
    // the flag above is set first: `destroy()` calls back into `holdForCoach`.
    this.openingCoach?.destroy();
    this.openingCoach = null;
    this.gateCoach?.destroy();
    this.gateCoach = null;
    this.compass?.destroy();
    this.bagPips?.destroy();
    this.channelBar?.destroy();
    this.zoneSystem?.destroy();
    for (const pickup of this.relics) pickup.despawn();
    this.relics.length = 0;
    // The damage clock is a MODULE-level closure over this scene's sim time.
    // Left installed, the next scene's `Health` reads a frozen clock and every
    // i-frame window it opens never closes.
    resetDamageClock();
  }

  /**
   * Advances the daily streak once per run (the menu chip reads it back on the
   * next visit) and celebrates only the day it actually grew.
   */
  private markDailyStreak(): void {
    const streak = touchDailyStreak();
    if (!streak.extended) return;
    this.time.delayedCall(600, () => {
      floatText(this, VIEW.centerX, SAFE.top + 60, `DAY ${streak.days} STREAK!`, '#ffd166', 46);
      sfx('combo', { volume: 0.5 });
    });
  }

  update(_time: number, delta: number): void {
    if (this.ended) return;

    this.controls.update();
    const player = this.combat.player;
    // Keyboard wins while a key is held; otherwise the stick drives movement.
    if (this.controls.axisX !== 0 || this.controls.axisY !== 0) {
      player.setAxis(this.controls.axisX, this.controls.axisY);
    } else {
      player.setAxis(this.joystick.vector.x, this.joystick.vector.y);
    }

    // A live coach beat holds the run exactly as a draft does, so the beats are
    // part of THIS gate rather than a special case inside each subsystem.
    const running = !this.drafting && !this.paused && !this.coachHold;
    if (this.openingCoach !== null) this.tickOpeningCoach();

    if (running) {
      this.director.update(delta);
      this.combat.update(delta, this.runDifficulty);
      this.zoneSystem.update(delta, this.director.elapsedSeconds);

      // §12: the score tracks the SESSION's pressure curve, not just the
      // difficulty ramp. The Warden and the Collapse are the two peaks the §2
      // architecture is built around, and both pin it to full — otherwise the
      // music is still playing mid-run mood over the finale.
      const pressure =
        this.bossActive || this.extraction.collapse?.active === true
          ? 1
          : 0.25 + 0.75 * Math.min(1, this.runDifficulty / 2.6);
      setMusicIntensity(pressure);

      // No timer win: past 480s the Collapse (ticked below) ends the run
      // through fire, never through the clock.
      this.tickExtraction(delta);
      if (this.ended) return;
      this.tickBeats(delta);
      if (this.ended) return;

      // A level-up earned mid-channel waits here until the hold ends, so the
      // draft never yanks the player out of the rite (see `queueDraft`).
      this.drainDeferredDrafts();
      if (this.ended) return;

      // §14b: the shard checkpoint refreshes at most once a second. Relic and
      // casket mutations refresh immediately, from where they happen.
      this.journalAccMs += delta;
      if (this.journalAccMs >= 1000) {
        this.journalAccMs = 0;
        this.refreshJournal();
      }
    }

    // Sim time backs the damage clock's i-frames: it must not advance while
    // paused, drafting or reading a coach beat, or any of those would silently
    // expire i-frames.
    if (running && !this.director.isPaused) {
      this.simTimeMs += delta;
    }

    // Cheap enough to run unconditionally and correct from anywhere: this is a
    // boolean compare that only touches the Button on a transition, so no
    // caller has to remember to re-sync when a draft or a beat opens or closes.
    this.syncPauseAffordance();

    // The §13 floater cap moved into `juice.allowEffect('float')`, which is
    // shared with `combat.ts`'s damage floaters: §13 caps floatText "12/s
    // scene-wide", and two independent per-second budgets in two files is not
    // one scene-wide cap.

    this.model.hp = Math.ceil(player.health.hp);
    this.model.hpMax = player.health.max;
    this.model.level = player.level;
    this.model.xp = player.xp;
    this.model.xpNeeded = player.xpNeeded();
    this.model.timeMs = this.director.elapsedSeconds * 1000;
    // §14.1: the clock escalates to `warn` and reads COLLAPSE once the ring is
    // live. Shards and kills are NOT HUD rows — the shard counter is
    // `ui/bagPips.ts` (§14.1 row 5) and kills are a results `ResultStat`.
    this.model.collapsing = this.extraction.collapse?.active === true;
    this.hud.set(this.model);
  }

  // === spawning =============================================================

  /** Phase difficulty x zone threat base, plus the uncapped Collapse ramp. */
  private get runDifficulty(): number {
    return this.director.difficulty * this.zone.threatBase + this.collapseBonus;
  }

  /**
   * §14b abandon rule: writes the in-flight marker. Called at run start, from
   * every relic/casket mutation, and from `update`'s 1Hz shard tick — the
   * marker is small and idempotent, so there is one writer and no diffing. The
   * casket is journalled by ID because those are exactly the relics a death
   * settlement banks.
   */
  private refreshJournal(): void {
    if (this.ended) return;
    writeRunJournal({
      zone: this.zoneId,
      seed: this.seed,
      casket: this.bag.casket.map((relic) => relic.id),
      shards: this.bag.shards,
    });
  }

  /**
   * Every scheduled spawn passes through here, which is where the run's three
   * spatial rules live: the Warden is placed AT Gate C, the Gate B guard pack
   * has already been placed at Gate B (so its scheduled bodies are absorbed
   * here rather than spawned twice), and the zone gets to substitute one of its
   * own exclusives for ordinary trash (§5.7).
   *
   * During the Collapse the trash drip stops entirely (`collapse.stopTrashDrip`)
   * — the finale escalates by COMPOSITION, not by a count the 220-enemy cap has
   * already saturated.
   */
  private onDirectorSpawn(id: string, pattern: WaveSpec['pattern']): void {
    // The row id, not the gate letter: `TUNING.warden.gate` is 'c', and
    // comparing a spawn id against a GATE id means any zone whose gate letters
    // ever change starts summoning the Warden off a husk row.
    if (id === 'warden') {
      this.spawnWarden();
      return;
    }
    const collapsing = this.extraction.collapse?.active === true;
    if (collapsing && TUNING.collapse.stopTrashDrip) return;

    // The guard pack landed as ONE burst at the gate (`tickGateGuard`); the
    // wave table's own bodies for it are consumed here so the §15 entity budget
    // is unchanged and the pack is not doubled.
    if (this.gateGuardAbsorb > 0) {
      this.gateGuardAbsorb -= 1;
      return;
    }

    const resolved = this.maybeUpgradeToElite(this.zoneSystem.pickSpawnId(id));
    this.combat.spawn(resolved, this.runDifficulty, pattern);
  }

  /**
   * Composition ramp (PRD §7 `wave.*`). From `compositionFromS` the live pool
   * is pinned at the entity cap, so the only honest escalation left is what the
   * pool is MADE OF: every `eliteSwapEveryS` the next scheduled trash spawn is
   * upgraded to an elite, consuming that spawn's budget rather than adding to
   * it. Capped at `eliteShareMax` of the live pool so it stays a horde.
   */
  private maybeUpgradeToElite(id: string): string {
    const nowS = this.director.elapsedSeconds;
    if (nowS < this.nextEliteSwapS) return id;
    const alive = this.combat.aliveEnemies();
    const elites = COLLAPSE_ELITE_IDS.length;
    if (elites === 0 || alive <= 0) return id;
    this.contest.enemies = 0;
    this.contest.elites = 0;
    this.combat.countNear(this.combat.player.x, this.combat.player.y, VIEW.height, this.contest);
    if (this.contest.elites / Math.max(1, this.contest.enemies) >= TUNING.wave.eliteShareMax) return id;

    this.nextEliteSwapS = nowS + TUNING.wave.eliteSwapEveryS;
    const pick = COLLAPSE_ELITE_IDS[this.eliteSwapIndex % elites] ?? id;
    this.eliteSwapIndex += 1;
    return pick;
  }

  /**
   * The Gate B guard (PRD §2A/§5.4: "reaper + 8 husks at Gate B"): at
   * `elite.gateGuardAtS` the pack lands ON the gate as ONE burst, on the ring
   * between `gate.radius` and `elite.gateGuardRadiusPx` — so the mid gate is a
   * fight you walk into instead of a door you stroll through, and the pack
   * exists as a pack rather than as a trickle whose bodies happen to be nearby.
   *
   * Latched, so it can never fire twice, and the wave table's own bodies for
   * this beat are absorbed in `onDirectorSpawn`: the pack SPENDS the schedule's
   * budget instead of adding to it.
   */
  private tickGateGuard(nowS: number): void {
    if (this.gateGuardPlaced || nowS < TUNING.elite.gateGuardAtS) return;
    this.gateGuardPlaced = true;
    const gate = this.zoneGates.find((g) => g.id === TUNING.elite.gateGuardGate);
    if (gate === undefined) return;

    this.spawnOnGateRing(gate, GATE_GUARD_ELITE_ID);
    for (let i = 0; i < TUNING.elite.gateGuardAdds; i += 1) {
      this.spawnOnGateRing(gate, this.zoneSystem.pickSpawnId(GATE_GUARD_ADD_ID));
    }
    this.gateGuardAbsorb = 1 + TUNING.elite.gateGuardAdds;

    sfx('die', { volume: 0.4 });
    floatText(
      this,
      this.combat.player.x,
      this.combat.player.y - 160,
      `GATE ${gate.id.toUpperCase()} IS GUARDED`,
      CSS.bad,
      42,
    );
  }

  private spawnOnGateRing(gate: GateSpec, id: string): void {
    const angle = this.rng.float(0, Math.PI * 2);
    const dist = this.rng.float(TUNING.gate.radius, TUNING.elite.gateGuardRadiusPx);
    this.combat.spawnAtPosition(
      id,
      gate.x + Math.cos(angle) * dist,
      gate.y + Math.sin(angle) * dist,
      this.runDifficulty,
    );
  }

  /** The Warden takes station on Gate C — the Bleak Arch is what it guards. */
  private spawnWarden(): void {
    const gate = this.zoneGates.find((g) => g.id === TUNING.warden.gate) ?? this.zoneGates[2];
    if (gate === undefined) return;
    const angle = this.rng.float(0, Math.PI * 2);
    this.combat.spawnAtPosition(
      'warden',
      gate.x + Math.cos(angle) * TUNING.warden.spawnOffsetPx,
      gate.y + Math.sin(angle) * TUNING.warden.spawnOffsetPx,
      this.runDifficulty,
    );
  }

  // === rewards and feedback =================================================

  /** Rewards, feedback and the effect caps that keep 200+ entities at 60fps. */
  private onEnemyKilled(def: EnemyDef, x: number, y: number, shards: number): void {
    this.kills += 1;

    // Shards are the one currency: everything routes through the bag and is
    // only banked by the settlement in `finish` (extract keeps, death loses).
    // Elites and the Warden pay out as pooled coins instead (`eliteDrop`), so
    // only the flat per-kill value is granted here — through `shardsMul`, which
    // is where Gilt Sense and the Gilt Skull actually land (and the same place
    // `sim/families/arena.ts` applies them).
    if (def.eliteDrop !== true) this.bag.addShards(this.scaleShards(shards));

    // The greed dial: elites and the Warden drop relics, and any row carrying
    // `relicRolls` (the Gilded Ghoul) drops its own.
    if (def.behaviour === 'boss') this.dropRelics(x, y, TUNING.loot.eliteRelics, TUNING.loot.bossTierBias);
    else if (def.behaviour === 'elite') this.dropRelics(x, y, TUNING.loot.eliteRelics, TUNING.loot.eliteTierBias);
    else {
      const rolls = def.params?.relicRolls;
      if (rolls !== undefined && rolls > 0) this.dropRelics(x, y, rolls, def.params?.relicTierBias ?? 0);
    }

    const big = def.behaviour === 'boss' || def.behaviour === 'elite';
    // §13 "enemy death": burst + shard fling, 6 particles, `die` at 4/s, and
    // NO burst above `caps.burstEntityLimit` live bodies. The count is 6 for a
    // husk exactly as authored (it was 8); an elite or the Warden is a
    // once-a-run beat and keeps its bigger 26.
    const live = this.combat.aliveEnemies();
    if (big || live <= TUNING.caps.burstEntityLimit) {
      burst(this, x, y, def.tint, big ? 26 : 6, big ? 460 : 260);
    }
    if (big) {
      this.punch(0.014, 220);
      sfx('levelup', { volume: 0.7 });
      floatText(this, x, y, def.name.toUpperCase(), '#ffd166', 52);
    } else {
      // A normal kill was previously SILENT — the most repeated payoff in the
      // run had no audio channel at all, which is the ≥2-channel rule failing
      // on the beat it matters most on.
      if (allowEffect('enemy-die-sfx', TUNING.caps.dieSfxPerSecond)) {
        sfx('die', { volume: 0.4, rate: 1.15 });
      }
      if (allowEffect('float', TUNING.caps.floatTextPerSecond)) {
        floatText(this, x, y, `+${shards}`, '#8fa1c7', 34);
      }
    }
  }

  /**
   * Every shard payout in the run passes through the frozen §16.1 `shardsMul`
   * stat — kills, elite coins and caches alike. One application point, matching
   * `sim/families/arena.ts`, so the sim's income curve is the game's.
   */
  private scaleShards(value: number): number {
    return Math.round(value * this.combat.player.stats.get('shardsMul'));
  }

  private onCoinCollected(value: number): void {
    this.bag.addShards(this.scaleShards(value));
    sfx('pickup', { volume: 0.35 });
  }

  private onPlayerHit(ratio: number): void {
    this.hud.flashDamage();
    // Any hit sets the extraction channel back (consumed by `tickExtraction`).
    this.tookHitSinceTick = true;
    // §13 "player hurt": shake 0.012/180ms + red flash 120ms + hitstop 60ms.
    // The flash stretches to 200ms below 30% hp — the one place this row
    // deviates from §13, deliberately: at that point the flash IS the low-hp
    // warning and the §14.1 hierarchy puts that read above tempo.
    this.bloom(PALETTE.bad, ratio < 0.3 ? 200 : 120);
    // §13 caps player-hurt shake at 1/s. Without this a three-body pile-up
    // fires three overlapping camera shakes and the arena becomes unreadable
    // at exactly the moment the player is trying to escape it.
    if (allowEffect('shake', TUNING.caps.hurtShakePerSecond)) this.punch(0.012, 180);
    hitstop(this, 60);
    // §12: the hurt voice is the hit voice pitched down 30% at 0.7, so being
    // hit never sounds like hitting. Capped at 2/s.
    if (allowEffect('hurt-sfx', 2)) sfx('hit', { rate: 0.7, volume: 0.7 });
  }

  /** Shake is suppressed at high entity counts — it reads as noise, not impact. */
  private punch(intensity: number, durationMs: number): void {
    if (this.combat.aliveEnemies() > TUNING.caps.shakeEntityLimit) return;
    shake(this, intensity, durationMs);
  }

  /**
   * `punch`'s twin for the full-screen wash: above `caps.shakeEntityLimit` live
   * bodies a wash over the whole playfield costs more legibility than the beat
   * is worth, so the news moves to the screen BORDERS instead and the arena
   * stays clear. `flash` itself caps opacity and rate scene-wide (see
   * `FLASH_MAX_ALPHA`); this is the entity-count half, and the two are
   * independent — the alpha cap is what makes ordinary contact readable, this is
   * what makes a Collapse frame readable.
   */
  private bloom(color: number, durationMs: number): void {
    if (this.combat.aliveEnemies() > TUNING.caps.shakeEntityLimit) {
      edgeFlash(this, color, durationMs);
      return;
    }
    flash(this, color, durationMs);
  }

  private onLevelUp(gained: number): void {
    sfx('levelup', { volume: 0.7 });
    // §13 "level up": accent flash at 160ms, then the card sweep — `ui/cards.ts`
    // brings the three cards in from the bottom, which is the sweep half.
    this.bloom(PALETTE.accent, 160);
    // §13 authors `flash` + the card sweep for a level; the shockwave is a
    // procedural particle burst (§11 permits primitives for particles), not an
    // art slot — the hero's art set carries no burst sheet.
    burst(this, this.combat.player.x, this.combat.player.y, PALETTE.accent, 18, 320);
    this.queueDraft(gained);
  }

  /**
   * `last-gasp` refused the grave. This has to read as the biggest beat in the
   * run — the player just spent an epic card and did not notice the moment it
   * paid out would be the moment the card was pointless.
   */
  private onPlayerRevived(): void {
    sfx('levelup', { volume: 1 });
    // `force`: this fires at most once a run, immediately after the hit that
    // would have killed the player — i.e. always inside the hurt flash's rate
    // window, which would otherwise swallow the whole beat.
    flash(this, PALETTE.good, 320, { force: true });
    shake(this, 0.02, 320);
    burst(this, this.combat.player.x, this.combat.player.y, PALETTE.good, 26, 420);
    floatText(this, this.combat.player.x, this.combat.player.y - 120, 'LAST GASP', CSS.good, 56);
  }

  /**
   * §13 "Warden spawn": shake 0.015/300ms + banner + the boss bar sliding in.
   * The bar is the Warden's own HP bar (`objects/enemy.ts` gives `boss` bodies
   * one); this owns the shake, the banner and the `whoosh`.
   */
  private onBossSpawned(): void {
    this.bossActive = true;
    setMusicLayer('boss', true);
    this.punch(0.015, 300);
    // `warn` amber, not `bad`: `duskChrome.textToneIsLegal` bars `bad` as a
    // text tone over art, and this banner lands over the arena.
    banner(this, 'THE WARDEN', CSS.warn, 520);
    sfx('whoosh', { volume: 0.8 });
  }

  private onWeaponEvolved(name: string): void {
    sfx('levelup', { volume: 0.8 });
    floatText(this, this.combat.player.x, this.combat.player.y - 80, `${name.toUpperCase()}!`, '#ffd166', 46);
  }

  // === zone hazard ==========================================================

  /** A hazard strike connected: a real hit, so i-frames and the channel react. */
  private onHazardHit(amount: number, x: number, y: number): void {
    const health = this.combat.player.health;
    const before = health.hp;
    const died = health.apply({ amount, crit: false, source: 'hazard' });
    if (health.hp === before && !died) return;
    this.onPlayerHit(health.ratio);
    burst(this, x, y, IDENTITY.threat, 12, 180);
    if (died) this.die();
  }

  /**
   * Environmental drain (ash dots, the desert scorch). Deliberately BYPASSES
   * `Health.apply` and its i-frames: a field you can stand in for free is not
   * a field. It cannot be dodged by being hit — only by leaving.
   */
  private onHazardDrain(amount: number): void {
    const health = this.combat.player.health;
    health.hp = Math.max(0, health.hp - amount);
    this.fireFlashAccMs += amount;
    if (this.fireFlashAccMs >= 2) {
      this.fireFlashAccMs = 0;
      this.hud.flashDamage();
    }
    // A drain death is still a death `last-gasp` may refuse: the revive lives
    // in one place so the card cannot be silently bypassed by the fire ring.
    if (health.hp > 0) return;
    if (this.combat.consumeLastGasp()) return;
    this.die();
  }

  /**
   * The one death path. Plays the §11 death cycle (6f collapse, pack spills)
   * before settling the run, so the hero's last beat is drawn rather than a cut
   * to the results screen. `finish` owns everything else and is not touched.
   */
  private die(): void {
    if (this.ended) return;
    this.combat.player.setChannelling(false);
    this.combat.player.playAction(ANIM.heroDeath);
    // §13 "Death": desaturate + hitstop 120ms + the LOST list (the results
    // screen owns the list). The colour drains out of the arena over the same
    // window the death cycle plays in, so the run visibly ENDS here instead of
    // cutting to a screen that then tells you it ended. Both fire before
    // `finish`, whose 340ms camera fade lands on an already-grey world.
    desaturate(this, 380);
    hitstop(this, 120);
    this.finish(false);
  }

  private onHazardTelegraph(kind: ZoneHazardKind, x: number, y: number): void {
    if (!this.onScreen(x, y)) return;
    sfx('whoosh', { volume: 0.3 });
    void kind;
  }

  private onHazardStrike(kind: ZoneHazardKind, x: number, y: number): void {
    if (!this.onScreen(x, y)) return;
    burst(this, x, y, IDENTITY.hazardAmber, 10, 200);
    void kind;
  }

  /** Cheap off-camera cull so an off-screen hazard costs no particles or sfx. */
  private onScreen(x: number, y: number): boolean {
    const view = this.cameras.main.worldView;
    return Phaser.Geom.Rectangle.Contains(view, x, y);
  }

  // === scripted beats =======================================================

  /** Chest/breather/elite-rush timeline events, wired into `RunDirector.onEvent`. */
  private onScriptedEvent(event: EventSpec): void {
    switch (event.kind) {
      case 'chest': {
        sfx('pickup', { volume: 0.6 });
        floatText(this, this.combat.player.x, this.combat.player.y - 100, 'CHEST!', '#ffd166', 48);
        this.playChestOpen(this.combat.player.x, this.combat.player.y + 40);
        // A chest is a GUARANTEED relic at a tier bias, plus the draft — its
        // whole job is to fill the bag ahead of a gate window (§5.4).
        this.dropRelics(this.combat.player.x, this.combat.player.y, TUNING.chest.relics, TUNING.chest.tierBias);
        this.queueDraft(1);
        break;
      }
      case 'breather':
        sfx('whoosh', { volume: 0.4 });
        floatText(this, this.combat.player.x, this.combat.player.y - 100, 'BREATHER', '#8fe3a5', 40);
        this.combat.player.health.heal(this.combat.player.health.max * TUNING.events.breatherHealRatio);
        this.combat.silenceSpawns(TUNING.events.breatherSilenceMs);
        break;
      case 'elite-rush': {
        sfx('die', { volume: 0.3 });
        floatText(this, this.combat.player.x, this.combat.player.y - 100, 'ELITE RUSH', '#ff6b6b', 44);
        const baseAngle = this.rng.float(0, Math.PI * 2);
        const count = TUNING.events.eliteRushCount;
        for (let i = 0; i < count; i += 1) {
          const angle = baseAngle + (i - (count - 1) / 2) * 0.5;
          const dist = VIEW.width / 2 + TUNING.enemy.spawnMargin + 60;
          this.combat.spawnAtPosition(
            COLLAPSE_ELITE_IDS[i % COLLAPSE_ELITE_IDS.length] ?? 'elite_reaper',
            this.combat.player.x + Math.cos(angle) * dist,
            this.combat.player.y + Math.sin(angle) * dist,
            this.runDifficulty,
          );
        }
        break;
      }
    }
  }

  /**
   * The coffin-chest opening on the spot, held on its last frame and then fading
   * out. The chest beat is an instant in the timeline, but §11 authors art for
   * it and a reward the player never sees open reads as a toast, not a chest.
   * One sprite per beat (~4 a run), destroyed with its tween.
   */
  private playChestOpen(x: number, y: number): void {
    if (!this.anims.exists(TEXTURE.chest)) return;
    const chest = this.add.sprite(x, y, TEXTURE.chest).setDisplaySize(96, 96).setDepth(7);
    chest.play(TEXTURE.chest);
    this.tweens.add({
      targets: chest,
      alpha: 0,
      delay: 1100,
      duration: 420,
      onComplete: () => chest.destroy(),
    });
  }

  /**
   * The set pieces the wave table cannot express: the Dread Shrine, the shard
   * caches, the relic drip and the Collapse's elite injection.
   */
  private tickBeats(deltaMs: number): void {
    const nowS = this.director.elapsedSeconds;
    this.tickGateGuard(nowS);
    this.tickShrine(deltaMs, nowS);
    this.tickCaches(deltaMs);
    this.tickRelicDrip(deltaMs, nowS);
    this.tickCollapseElites();
  }

  /**
   * The Dread Shrine (PRD §5.4/§7): from `shrine.atS` a marked pocket holds a
   * guaranteed high-tier relic inside a `densityMul` density bubble. It is the
   * vault analogue — the greedy detour that is worth exactly what it costs.
   */
  private tickShrine(deltaMs: number, nowS: number): void {
    if (!this.shrineArmed) {
      if (nowS < TUNING.shrine.atS) return;
      this.armShrine();
      return;
    }
    const player = this.combat.player;
    const dx = player.x - this.shrineX;
    const dy = player.y - this.shrineY;
    if (dx * dx + dy * dy > TUNING.shrine.radiusPx * TUNING.shrine.radiusPx) return;

    // Inside the pocket the spawn rate is multiplied — that is the price of
    // the relic, paid in bodies rather than in a warning.
    this.shrineSpawnAccMs += deltaMs * (TUNING.shrine.densityMul - 1);
    // The pocket drips at the game's authored MINIMUM spawn interval — it is
    // explicitly the densest square of ground in the run (§7 `shrine.densityMul`).
    const step = TUNING.collapse.spawnFloorMs;
    while (this.shrineSpawnAccMs >= step) {
      this.shrineSpawnAccMs -= step;
      this.onDirectorSpawn(this.zoneSystem.pickSpawnId('husk'), 'cluster');
    }
  }

  /** Places the shrine and its guaranteed relic somewhere worth walking to. */
  private armShrine(): void {
    this.shrineArmed = true;
    const angle = this.rng.float(0, Math.PI * 2);
    const dist = this.rng.float(TUNING.shrine.radiusPx * 2, TUNING.shrine.radiusPx * 3.5);
    const point = { x: 0, y: 0 };
    this.arena.clamp(
      this.combat.player.x + Math.cos(angle) * dist,
      this.combat.player.y + Math.sin(angle) * dist,
      TUNING.arena.wallThickness + TUNING.shrine.radiusPx * 0.25,
      point,
    );
    this.shrineX = point.x;
    this.shrineY = point.y;

    const key = `props-${this.zone.id}-b`;
    const hasArt = this.textures.exists(key);
    this.shrineMarker = this.add
      .image(point.x, point.y, hasArt ? key : 'tex-ring', hasArt ? 6 : undefined)
      .setDisplaySize(140, 140)
      .setDepth(6);
    if (!hasArt) this.shrineMarker.setTint(IDENTITY.gateOpen);
    this.add
      .image(point.x, point.y, 'tex-ring')
      .setTint(IDENTITY.gateOpen)
      .setDisplaySize(TUNING.shrine.radiusPx * 2, TUNING.shrine.radiusPx * 2)
      .setAlpha(0.18)
      .setDepth(4);

    // The reward is placed, not promised: the relic is already on the ground.
    this.dropRelics(point.x, point.y, 1, TUNING.shrine.tierBias, TUNING.shrine.minTier);
    sfx('levelup', { volume: 0.5 });
    floatText(this, this.combat.player.x, this.combat.player.y - 140, 'DREAD SHRINE', CSS.secondary, 46);
  }

  /**
   * Shard caches (PRD §6/§7 `loot.cache*`): the income floor for a player who
   * evades instead of clearing. Measured income was a fork, not a curve — this
   * is the branch that does not require killing anything.
   */
  private tickCaches(deltaMs: number): void {
    for (let i = this.caches.length - 1; i >= 0; i -= 1) {
      const cache = this.caches[i];
      if (cache === undefined) continue;
      const dx = this.combat.player.x - cache.img.x;
      const dy = this.combat.player.y - cache.img.y;
      const radius = this.combat.player.stats.get('pickupRadius');
      if (dx * dx + dy * dy <= radius * radius) {
        const value = this.scaleShards(cache.value);
        this.bag.addShards(value);
        floatText(this, cache.img.x, cache.img.y, `+${value}`, CSS.accent, 40);
        sfx('pickup', { volume: 0.5 });
        cache.img.destroy();
        this.caches.splice(i, 1);
        continue;
      }
      if (this.simTimeMs < cache.expiresAtMs) continue;
      cache.img.destroy();
      this.caches.splice(i, 1);
    }

    this.cacheAccMs += deltaMs;
    if (this.cacheAccMs < TUNING.loot.cacheEveryS * 1000) return;
    this.cacheAccMs = 0;
    if (this.caches.length >= MAX_CACHES) return;

    const angle = this.rng.float(0, Math.PI * 2);
    const dist = this.rng.float(TUNING.loot.cacheMinDist, TUNING.loot.cacheMaxDist);
    const point = { x: 0, y: 0 };
    this.arena.clamp(
      this.combat.player.x + Math.cos(angle) * dist,
      this.combat.player.y + Math.sin(angle) * dist,
      TUNING.arena.wallThickness + 40,
      point,
    );
    const hasArt = this.textures.exists('shard-glint');
    const img = this.add
      .image(point.x, point.y, hasArt ? 'shard-glint' : 'tex-disc')
      .setDisplaySize(52, 52)
      .setDepth(8);
    if (!hasArt) img.setTint(IDENTITY.gilt);
    this.caches.push({
      img,
      value: TUNING.loot.cacheValue,
      expiresAtMs: this.simTimeMs + TUNING.loot.cacheLingerS * 1000,
    });
  }

  /**
   * Ambient relic drip. The first one lands at `loot.firstRelicS` — the
   * measured cold open was two full minutes with no loot, no bag event and no
   * gate event, which is the same as the extraction layer not existing.
   */
  private tickRelicDrip(deltaMs: number, nowS: number): void {
    if (!this.firstRelicDone) {
      if (nowS < TUNING.loot.firstRelicS) return;
      this.firstRelicDone = true;
      this.dropRelicNearPlayer();
      return;
    }
    this.relicDripAccMs += deltaMs;
    const periodMs = TUNING.loot.relicDripS * 1000;
    if (this.relicDripAccMs < periodMs) return;
    this.relicDripAccMs -= periodMs;
    this.dropRelicNearPlayer();
  }

  private dropRelicNearPlayer(): void {
    const angle = this.rng.float(0, Math.PI * 2);
    const dist = this.rng.float(160, 320);
    this.dropRelics(
      this.combat.player.x + Math.cos(angle) * dist,
      this.combat.player.y + Math.sin(angle) * dist,
      1,
      0,
    );
  }

  /**
   * Collapse escalation 3 of 3 (PRD §7): one elite injected at the ring edge
   * every `eliteEveryS`, against a STOPPED trash drip. Live count therefore
   * FALLS as the player clears while elite share rises — the opposite of the
   * flat, saturated line the greybox measured.
   */
  private tickCollapseElites(): void {
    const quota = this.extraction.collapseEliteQuota;
    if (quota <= this.collapseElitesSpawned) return;
    this.collapseElitesSpawned = quota;
    if (COLLAPSE_ELITE_IDS.length === 0) return;

    const centre = this.extraction.collapseRingCenter;
    const radius = this.extraction.collapse?.ringRadius ?? 0;
    const angle = this.rng.float(0, Math.PI * 2);
    const point = { x: 0, y: 0 };
    this.arena.clamp(
      centre.x + Math.cos(angle) * radius,
      centre.y + Math.sin(angle) * radius,
      TUNING.arena.wallThickness + 60,
      point,
    );
    if (this.extraction.spawnSuppressed(point.x, point.y)) return;
    const id = COLLAPSE_ELITE_IDS[this.collapseElitesSpawned % COLLAPSE_ELITE_IDS.length];
    if (id === undefined) return;
    this.combat.spawnAtPosition(id, point.x, point.y, this.runDifficulty);
  }

  // === draft, pause, teardown ==============================================

  /**
   * ONE draft at a time, and none lost (§14b: overlays never stack).
   *
   * Two callers can ask for a draft — a level-up and the scripted `chest`
   * event — and the Step 5.5 audit caught both halves of the bug: the chest
   * path called `openDraft` with no guard at all, so a chest landing on an
   * open draft built a SECOND full-screen overlay whose dim multiplied with
   * the first (the field went black) and whose predecessor leaked, container
   * and entry tweens included; while the level-up path guarded with
   * `if (this.drafting) return`, which silently THREW AWAY the card the player
   * had just earned.
   *
   * The counter fixes both: a request arriving mid-draft is deferred, and the
   * pick handler drains it.
   *
   * The SECOND deferral reason is the extraction channel. The channel is the
   * run's most sustained tension beat and it is held with the thumb; a draft
   * opening over it (observed at t=126.0s with the channel at 63.7%) tears the
   * player out of a decision they are physically in the middle of, roughly
   * every other channel. Nothing ticks under the overlay so nothing is lost
   * mechanically — what is lost is the beat. So a level-up earned inside the
   * ring QUEUES, and `drainDeferredDrafts` opens it the frame the hold ends,
   * whether it ended by completing, by a step out of the ring, or by the gate
   * shutting. Queued, never dropped: the card was earned.
   */
  private queueDraft(levels: number): void {
    if (this.drafting || this.channelIsLive) {
      this.pendingDrafts += levels;
      return;
    }
    this.openDraft(levels);
  }

  /**
   * True while the extraction hold is ACTUALLY accruing — bound to a gate AND
   * standing in its ring.
   *
   * `channelingGate` alone is not that test: it stays bound after the player
   * walks out (progress is kept so re-entry resumes), and is only cleared when
   * the gate goes spent. Deferring on the bare gate id would therefore starve
   * a queued draft for as long as the player wandered the arena. `channelRate`
   * is the system's own answer to "did the last ticking frame accrue": it is
   * set to 0 on any frame the player is outside every open ring, and to a
   * positive accrual multiplier on any frame inside one.
   */
  private get channelIsLive(): boolean {
    return (
      !this.extraction.extracted &&
      this.extraction.channelingGate !== null &&
      this.extraction.channelRate > 0
    );
  }

  /**
   * Opens a draft that `queueDraft` held back. Called from `update`'s running
   * branch only, so it cannot fire under a pause overlay or a coach beat, and
   * runs AFTER `tickExtraction` so the channel state it reads is this frame's.
   */
  private drainDeferredDrafts(): void {
    if (this.pendingDrafts === 0 || this.drafting || this.channelIsLive) return;
    const queued = this.pendingDrafts;
    this.pendingDrafts = 0;
    this.openDraft(queued);
  }

  /** Pauses the run (not the scene) and shows the pick-1-of-N overlay. */
  private openDraft(pendingLevels: number): void {
    const context: UpgradeRollContext = {
      ownedWeapons: this.combat.equippedWeapons().map((w) => w.id),
      hasFreeWeaponSlot: this.combat.hasFreeWeaponSlot(),
    };
    const choices = rollUpgradeChoices(this.rng, this.taken, TUNING.draft.choices, context);
    if (choices.length === 0) return;

    this.drafting = true;
    this.rerollsUsedThisDraft = 0;
    this.combat.setPaused(true);
    this.director.pause();
    this.joystick.setEnabled(false);

    this.cards = showUpgradeCards(
      this,
      choices,
      (choice: UpgradeDef) => {
        this.applyUpgrade(choice);
        this.cards?.destroy();
        this.cards = null;
        // Own pending levels first, then anything a chest or a second level-up
        // deferred while this overlay was up.
        if (pendingLevels > 1) {
          this.openDraft(pendingLevels - 1);
          return;
        }
        if (this.pendingDrafts > 0) {
          const queued = this.pendingDrafts;
          this.pendingDrafts = 0;
          this.openDraft(queued);
          return;
        }
        this.drafting = false;
        // A coach beat that started under the cards still owns the run: closing
        // the draft must not hand movement back while a tutorial card is up.
        // A pause cannot be stacked here at all any more (`togglePause`).
        if (this.coachHold) return;
        this.combat.setPaused(false);
        this.director.resume();
        this.joystick.setEnabled(true);
      },
      {
        rerollCost: TUNING.draft.rerollCost,
        // §10 `m_reroll` "Second Dirge": one free reroll by default, +1 per
        // purchased level. This is the row's only consumer.
        canReroll: () =>
          this.rerollsUsedThisDraft < this.loadout.rerollsPerDraft &&
          this.bag.shards >= TUNING.draft.rerollCost,
        onReroll: () => {
          this.rerollsUsedThisDraft += 1;
          // Reroll is free (`TUNING.draft.rerollCost` = 0) — no shard spend.
          const excluded = [...this.taken, ...choices.map((c) => c.id)];
          return rollUpgradeChoices(this.rng, excluded, TUNING.draft.choices, context);
        },
      },
      // The run's pick history, so each card can print "RANK n/m". Read-only
      // downstream. The array IDENTITY is reused for the whole run and
      // `applyUpgrade` pushes to it, so `ui/cards.ts` must read it while
      // BUILDING a card — a stashed reference re-read later would show a
      // chained draft the pick that was just made.
      this.taken,
    );
  }

  private applyUpgrade(choice: UpgradeDef): void {
    this.taken.push(choice.id);
    if (choice.kind === 'weapon-unlock' && choice.weapon !== undefined) {
      this.combat.unlockWeapon(choice.weapon);
    } else if (choice.kind === 'weapon-boost' && choice.weapon !== undefined) {
      this.combat.boostWeapon(choice.weapon);
    }
    for (const mod of choice.modifiers) {
      this.combat.player.applyModifier({ ...mod, source: `card:${choice.id}:${this.taken.length}` });
    }
    if (choice.effect !== undefined) {
      applyEffect(choice.effect, { player: this.combat.player }, this.combat.effects);
    }
    // §13's biggest beat in the draft — "Evolution pick: full-screen flash +
    // burst 24 + hitstop 90ms, `sfxArp`, 1/draft". A `weapon-evolution` card
    // is a once-a-build decision and it previously landed with the exact same
    // 18-particle puff as a +10% damage stat card. Every other kind keeps the
    // ordinary card puff.
    if (choice.kind === 'weapon-evolution') {
      // `force`: a once-a-build beat landing a second or two after the level-up
      // wash that opened this very draft, so the rate gate would eat it. Safe
      // to force — nothing is moving under a draft overlay.
      flash(this, PALETTE.secondary, 220, { force: true });
      burst(this, VIEW.centerX, VIEW.centerY, PALETTE.secondary, 24, 420);
      hitstop(this, 90);
      sfxArp('combo', 5, { volume: 0.8 });
      // The BEAT is violet (flash + burst); the TEXT is accent, because
      // `duskChrome.textToneIsLegal` bars `secondary` as a text tone over art.
      banner(this, `${choice.name.toUpperCase()} EVOLVED`, CSS.accent, 420);
      return;
    }
    burst(this, VIEW.centerX, VIEW.centerY, PALETTE.accent, 18, 340);
  }

  /**
   * EXACTLY ONE overlay owns the screen at a time. §14b's original PauseDraft
   * flow allowed a pause ON TOP of a live draft, and shipping it proved that
   * unreadable: PAUSED / RESUME / RESTART / MENU draw at depth 2100 straight
   * through the cards at 2000, so "CHOOSE AN UPGRADE" and its card text bleed
   * out between the pause buttons and neither overlay can be read. The player
   * enters a draft ~13 times a run and the icon sits at 2050 (above the draft
   * dim, so reachable), which put that collision one tap away all run.
   *
   * So a draft REFUSES the pause, exactly as a coach beat already did — both
   * already hold the run's clock, so nothing is lost by waiting: the draft is
   * itself a stopped-clock screen, and the fight resumes only when a card is
   * picked. `syncPauseAffordance` dims and deafens the icon for the duration,
   * so the tap is not merely ignored — it cannot be aimed.
   */
  private togglePause(): void {
    if (this.ended) return;
    if (this.coachHold || this.drafting) return;
    if (this.paused) {
      this.resumeFromPause();
      return;
    }
    this.paused = true;
    this.director.pause();
    this.combat.setPaused(true);
    this.joystick.setEnabled(false);
    this.pauseOverlay = showPauseOverlay(this, {
      onResume: () => this.resumeFromPause(),
      onRestart: () => {
        this.pauseOverlay?.destroy();
        this.pauseOverlay = null;
        this.cards?.destroy();
        this.cards = null;
        // Restart ABANDONS the haul, so it settles as a death right here (§14b
        // abandon rule) rather than leaving the marker for boot: `create()`
        // journals the new run immediately, and a marker that survived into it
        // would later settle that run's zone with this run's loot.
        settleAbandonedRun();
        this.scene.start(SCENES.game, { zone: this.zoneId });
      },
      onMenu: () => this.quitToMenu(),
      bag: {
        casketSlots: this.bag.casketSlots,
        read: () => this.readBagRow(),
        pin: (id) => this.pinRelic(id),
        unpin: (id) => this.unpinRelic(id),
      },
      // §14b: a bag holding loot makes RESTART and MENU destructive.
      armDestructive: () => this.bag.relics.length + this.bag.casket.length > 0,
    });
  }

  /**
   * The pause overlay's bag row, fed from the SAME model the HUD pips read:
   * casket first, then the bag, both in acquisition order. Rebuilt into one
   * reused array — the row reads it on open and after every pin, never per
   * frame.
   */
  private readBagRow(): readonly PauseBagRelic[] {
    this.bagRowRelics.length = 0;
    for (const relic of this.bag.casket) {
      this.bagRowRelics.push({ id: relic.id, name: relic.name, tier: relic.tier, pinned: true });
    }
    for (const relic of this.bag.relics) {
      this.bagRowRelics.push({ id: relic.id, name: relic.name, tier: relic.tier, pinned: false });
    }
    return this.bagRowRelics;
  }

  /**
   * The ONE route into the Gravekeeper's Casket (§5.6: `autoPinHighest` is
   * false by law). A full casket gives up its oldest pin, which returns to the
   * bag — or falls to the ground with the usual regret window when the bag has
   * no room, since the player chose the swap.
   */
  private pinRelic(relicId: string): void {
    const result = this.bag.pinCasket(relicId);
    if (!result.pinned) return;
    sfx('pickup', { volume: 0.6 });
    const player = this.combat.player;
    floatText(this, player.x, player.y - 90, 'PINNED TO CASKET', CSS.accent, 38);
    if (result.unpinned !== null) {
      floatText(this, player.x, player.y - 130, `UNPINNED: ${result.unpinned.name}`, CSS.warn, 32);
    }
    if (result.dropped !== null) {
      const angle = this.rng.float(0, Math.PI * 2);
      this.spawnRelicPickup(
        relicDef(result.dropped.id),
        player.x + Math.cos(angle) * 140,
        player.y + Math.sin(angle) * 140,
        result.dropLingerMs,
      );
    }
    // A casket mutation is journalled immediately (§14b): the casket is the
    // only thing a death settlement banks, so it must never be a second stale.
    this.refreshJournal();
  }

  /**
   * Releases a pin back into the bag — the other half of the same decision.
   * Without it a pinned pip was a one-way door: the player could commit a slot
   * and never reconsider, which is the opposite of the choice §5.6 is about.
   * The relic returns to the bag (the casket does not occupy bag slots, so a
   * release can push the bag over its count; the next pickup resolves that
   * through the ordinary drop-lowest rule).
   */
  private unpinRelic(relicId: string): void {
    if (!this.bag.unpinCasket(relicId)) return;
    sfx('ui', { volume: 0.5 });
    const player = this.combat.player;
    floatText(this, player.x, player.y - 90, 'RELEASED FROM CASKET', CSS.warn, 34);
    this.refreshJournal();
  }

  private resumeFromPause(): void {
    this.paused = false;
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
    // A coach beat can still start while PAUSED is up (`tickOpeningCoach` runs
    // outside the running gate), and it owns the run when it does. A DRAFT
    // cannot: `togglePause` refuses to open over one, and nothing can level the
    // player up while combat is paused, so there is no draft to return into.
    if (this.coachHold) return;
    this.director.resume();
    this.combat.setPaused(false);
    this.joystick.setEnabled(true);
  }

  /**
   * Keeps the pause icon's TAPPABILITY equal to whether pausing is legal.
   *
   * `togglePause` refuses the illegal tap on its own, but a lit, full-opacity
   * icon sitting above the draft dim is a promise the game will not keep: the
   * player aims at it, taps, and nothing happens. Dimming it and dropping its
   * hit area makes "not now" readable before the tap.
   *
   * Driven from `update` off a mirrored boolean, so the Button is touched only
   * on a transition — roughly 26 times a run rather than 60 times a second.
   */
  private syncPauseAffordance(): void {
    const legal = !this.drafting && !this.coachHold && !this.ended;
    if (legal === this.pauseAffordanceLive) return;
    this.pauseAffordanceLive = legal;
    this.pauseButton.setAlpha(legal ? 1 : 0.28);
    if (legal) this.pauseButton.setInteractive({ useHandCursor: true });
    else this.pauseButton.disableInteractive();
  }

  /**
   * Abandons the run for the menu — the exit the pause overlay's MENU row is.
   *
   * Everything still running has to be killed HERE rather than on the way out:
   * a looping tween or a queued timer that fires after `scene.start` touches a
   * scene that no longer exists, which is exactly the black-screen trap in
   * AGENTS.md.
   */
  private quitToMenu(): void {
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
    this.cards?.destroy();
    this.cards = null;
    this.ended = true;
    this.paused = false;
    this.director.pause();
    this.combat.setPaused(true);
    this.tweens.killAll();
    this.time.removeAllEvents();
    setMusicIntensity(0.2);
    sfx('ui', { volume: 0.4 });
    // Walking out is an abandon, and an abandon settles as a death (§14b) —
    // otherwise the menu this starts would render a stash that is one run stale
    // and the marker would be resolved on some later boot instead.
    settleAbandonedRun();
    this.scene.start(SCENES.menu);
  }

  private finish(won: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.cards?.destroy();
    this.pauseOverlay?.destroy();
    this.openingCoach?.destroy();
    this.openingCoach = null;
    this.gateCoach?.destroy();
    this.gateCoach = null;
    this.combat.setPaused(true);
    this.director.pause();
    this.joystick.setEnabled(false);

    // §12/§13: extraction gets `sfxArp` at 0.8 — the game's biggest positive
    // voice for its biggest positive moment. It used to share `levelup` with
    // every card draft, which flattened the one beat the whole loop is built
    // toward. Death keeps `die` and the shake; the desaturate is `die()`'s.
    if (won) sfxArp('combo', 6, { volume: 0.8 });
    else sfx('die');
    // `force`: the run's last frame. A hurt flash from the very hit that ended
    // the run is always inside the rate window, and the outcome sting is not
    // something the strobe cap gets to eat.
    flash(this, won ? PALETTE.good : PALETTE.bad, 260, { force: true });
    if (won) shake(this, 0.02, 300);

    if (this.bossActive) setMusicLayer('boss', false);
    setMusicIntensity(0.2);

    const timeMs = this.director.elapsedSeconds * 1000;
    // Settlement is THE banking moment: extraction keeps everything, death
    // keeps the casket plus the resolved death-keep % (`TUNING.meta.deathKeepPct`
    // plus §10's Rot Tithe, resolved once at run start in `runLoadout`).
    const carriedShards = this.bag.shards;
    const settlement = this.bag.settle(won ? 'extracted' : 'died', this.loadout.deathKeepPct);
    // Haul premium for walking out THROUGH the Collapse. The sim proved that
    // Gate C opening at 420s with an immediately-startable channel meant an
    // optimal deep run always ended before 480, so the Collapse was content no
    // player ever saw. Paying for the risk — rather than barring the door
    // until ignition, which was measured and rejected — keeps the decision the
    // player's. Applied here and not in `Bag.settle`, whose §16.1 signature is
    // frozen and must stay pure.
    const inCollapse = won && this.director.elapsedSeconds >= TUNING.collapse.atS;
    const collapseBonus = inCollapse
      ? Math.round(settlement.shards * TUNING.extract.collapseHaulBonus)
      : 0;
    const bankedShards = settlement.shards + collapseBonus;

    // THE PAYLOAD IS TYPED AT THE CALL SITE. `scene.start` takes `object` and
    // `GameOverScene.init` takes a `Partial`, so a field this scene forgets to
    // send silently defaults there — which is exactly how a perfect Gate C
    // extraction banked zero. Annotating the object is what makes `tsc` the
    // guard on this seam instead of a playtest.
    const data: GameOverData = {
      won,
      timeMs,
      kills: this.kills,
      level: this.combat.player.level,
      seed: this.seed,
      zone: this.zoneId,
      bankedShards,
      carriedShards,
      banked: settlement.relics.map(haulRelic),
      lost: settlement.lost.map(haulRelic),
      // A subset of `banked` on both outcomes: the casket is what survives a
      // death, and on an extraction it is simply part of the haul.
      casketSaved: this.bag.casket.map(haulRelic),
      gateUsed: this.extraction.extractedGate,
      // The loop-fit line on the results screen already reads "SURVIVED 4:12
      // KILLS 318 LEVEL 9", and the hero number plus "SHARDS BANKED / n LOST"
      // plus the relic list already say the rest in English. BANKED and LOST
      // restated all of it in jargon ("408sh 0rl"), so they are gone. DUSK
      // TITHE stays: it is the only number on this screen that nothing else
      // says, and it only exists on a Collapse extraction.
      stats: collapseBonus > 0 ? [{ label: 'DUSK TITHE', value: `+${collapseBonus}sh` }] : [],
      // Decided BEFORE the meta write below, which is the only moment the
      // previous best still exists.
      bestHaul: bankedShards > loadMeta().stats.bestScore,
    };

    // SETTLE FIRST, CLEAR LAST.
    //
    // The meta write used to live in `GameOverScene.create`, on the far side of
    // a 360ms fade and a `scene.start` — and `clearRunJournal` ran BEFORE that
    // fade. So for 360ms plus a scene boot the §14b in-flight marker was gone
    // and the haul was not yet banked, and any throw in that window deleted the
    // player's run with nothing left to recover it from. Not theoretical: a
    // throw in a shutdown path is precisely the freeze this build shipped with.
    //
    // So the banking happens here, synchronously, while the marker is still on
    // disk; the marker is torn down only once the save has taken. A throw
    // BETWEEN them now costs a double-settle on the next boot (the abandon rule
    // pays the death share a second time), which is a bounded over-payment
    // instead of an unbounded loss — that is the right way for this to fail.
    recordRunResult({ won, score: bankedShards, timeMs }, { bestTimeMode: 'max' });
    if (bankedShards > 0) grantCurrency(bankedShards);
    if (settlement.relics.length > 0) bankRelics(settlement.relics.map((relic) => relic.id));
    track(won ? 'win' : 'loss');
    if (isDailyMode()) saveDailyBest(bankedShards);

    // The run has settled, so the §14b in-flight marker is spent: leaving it
    // would make the NEXT boot bank this haul a second time.
    clearRunJournal();

    this.cameras.main.fadeOut(340, 0, 0, 0);
    this.time.delayedCall(360, () => this.scene.start(SCENES.gameOver, data));
  }

  // === extraction ===========================================================

  /**
   * The finale boss dying is a reward beat, NOT a win — the run still resolves
   * only through a gate or a death. Its relic drop lands via `onEnemyKilled`.
   */
  private onWardenDown(): void {
    this.bossActive = false;
    setMusicLayer('boss', false);
    this.punch(0.02, 300);
    sfx('levelup', { volume: 0.9 });
    // §10 lifetime counter. Banked HERE and not in `finish()`: the Warden dying
    // is not a win, and a run that kills it and then dies in the Collapse still
    // killed it. The counter never resets, so it must be written on the event.
    recordWardenKill();
  }

  private onExtractionEvent(e: ExtractionEvent, id?: string): void {
    const px = this.combat.player.x;
    const py = this.combat.player.y;
    switch (e) {
      case 'gate-open':
        // §13 "Gate opens": violet EDGE flash at 200ms + the compass arrow
        // appearing, and §12's authored `gate` voice — a rising square fifth
        // that belongs to nothing else in the game. It used to borrow
        // `levelup`, so the door opening and a card draft sounded identical.
        sfx('gate', { volume: 0.5 });
        edgeFlash(this, IDENTITY.gateOpen, 200);
        floatText(this, px, py - 120, `GATE ${(id ?? '').toUpperCase()} OPEN`, CSS.good, 44);
        this.showFirstGateCoach(id);
        break;
      case 'gate-close':
        sfx('whoosh', { volume: 0.6, rate: 0.8 });
        // `warn`, not `bad`: `bad` is not a legal text tone over art (§11).
        floatText(this, px, py - 120, `GATE ${(id ?? '').toUpperCase()} CLOSED`, CSS.warn, 44);
        break;
      case 'collapse':
        // §13 "Collapse starts", ONCE: screen-wide shake 0.02/400ms + the ring
        // igniting (the curtain, drawn in `redrawExtractionVisuals`) + §12's
        // authored `collapse` voice, a 1.6s noise-led sub falling 60→30Hz. It
        // used to borrow `die`, so the world ending sounded like a husk dying.
        sfx('collapse');
        edgeFlash(this, IDENTITY.threat, 520, 150);
        banner(this, 'THE COLLAPSE', CSS.warn, 700);
        setMusicLayer('boss', true);
        // Unconditional, NOT `punch`: §13 authors this shake as screen-wide and
        // once-per-run, so the entity-count suppression that protects the
        // per-kill shakes must not silence the one beat that announces the
        // finale — and the Collapse is exactly when the count is highest.
        shake(this, 0.02, 400);
        break;
      case 'extracted':
        // §11's 6f dissolve into violet light. `finish` fades the camera over
        // 340ms, which covers the tail of the 660ms cycle.
        this.combat.player.setChannelling(false);
        this.combat.player.playAction(ANIM.heroExtract);
        this.finish(true);
        break;
    }
  }

  /**
   * §14b `tut:gate` — the first gate decision, taught once ever. The spotlight
   * is that gate's compass arrow: the arrow is clamped to §14.2's authored
   * screen ring, so the rect is derived from the SAME projection the compass
   * does rather than read back out of it (`ui/gateCompass.ts` owns its own
   * geometry and exposes no positions, which is the right boundary — this needs
   * a region, not a widget).
   */
  private showFirstGateCoach(gateId?: string): void {
    if (this.gateCoach !== null || gateId === undefined) return;
    const gate = this.zoneGates.find((g) => g.id === gateId);
    if (gate === undefined) return;

    const view = this.cameras.main.worldView;
    const projecting = view.width > 0 && view.height > 0;
    const screenX = projecting ? gate.x - view.x : VIEW.centerX;
    const screenY = projecting ? gate.y - view.y : VIEW.centerY;
    const spotlight: CoachRect = {
      x: Phaser.Math.Clamp(screenX - COACH_GATE_SPOT / 2, SAFE.side, VIEW.width - SAFE.side - COACH_GATE_SPOT),
      y: Phaser.Math.Clamp(screenY - COACH_GATE_SPOT / 2, COACH_GATE_RING.top, COACH_GATE_RING.bottom - COACH_GATE_SPOT),
      w: COACH_GATE_SPOT,
      h: COACH_GATE_SPOT,
    };
    this.gateCoach = showGateCoach(
      this,
      { pause: () => this.holdForCoach(true), resume: () => this.holdForCoach(false) },
      spotlight,
    );
  }

  /**
   * World-space gate art + ring fallback + labels, and the channel/collapse
   * layers.
   *
   * §11 makes the gate ART, not a primitive: the three states are told apart by
   * hue AND by grille position on the generated sheets, which is a far stronger
   * read at a 48px glance than a stroked circle. The Arc survives only as the
   * crash-safe fallback for a build whose `gates-collapse` group did not load —
   * when the art is present the Arc is hidden, because a visible procedural
   * gameplay surface is a release defect.
   */
  private buildGateVisuals(): void {
    const rings = {} as Record<GateSpec['id'], Phaser.GameObjects.Arc>;
    const hasGateArt = this.textures.exists(TEXTURE.gateClosed);
    const sprites = hasGateArt ? ({} as Record<GateSpec['id'], Phaser.GameObjects.Sprite>) : null;
    const artSize = TUNING.gate.radius * GATE_ART_SCALE;

    for (const gate of this.zoneGates) {
      rings[gate.id] = this.add
        .circle(gate.x, gate.y, TUNING.gate.radius)
        .setStrokeStyle(6, GATE_RING_STYLE.closed.color, GATE_RING_STYLE.closed.alpha)
        .setFillStyle(GATE_RING_STYLE.closed.color, 0.03)
        .setDepth(5)
        .setVisible(!hasGateArt);
      if (sprites !== null) {
        // Untinted: the sheet already carries the state's colour code, and a
        // tint would fight the palette the art review gated.
        sprites[gate.id] = this.add
          .sprite(gate.x, gate.y, TEXTURE.gateClosed)
          .setDisplaySize(artSize, artSize)
          .setDepth(5);
      }
      this.add
        .text(gate.x, gate.y, gate.id.toUpperCase(), { ...TEXT.heading, color: CSS.inkSoft })
        .setOrigin(0.5)
        .setAlpha(0.6)
        .setDepth(6);
    }
    this.gateRings = rings;
    this.gateSprites = sprites;
    this.buildCollapseCurtain();
    this.channelGfx = this.add.graphics().setDepth(40);
    this.collapseGfx = this.add.graphics().setDepth(45);

    // Channel vignette (§14): drawn ONCE, then toggled. A per-frame Graphics
    // redraw at this size is exactly what the performance plan forbids.
    //
    // The fill goes down at alpha 1 and the OBJECT's alpha carries the whole
    // value, so `tickChannelFeedback` can drive it from channel progress with
    // one field write. Baking 0.3 into the fill would multiply against that and
    // silently cap the escalation at a third of its intended brightness.
    this.channelVignette = this.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(1100)
      .setAlpha(0.3)
      .setVisible(false);
    const band = 90;
    this.channelVignette.fillStyle(IDENTITY.gateOpen, 1);
    this.channelVignette.fillRect(0, SAFE.top, band, VIEW.height - SAFE.top);
    this.channelVignette.fillRect(VIEW.width - band, SAFE.top, band, VIEW.height - SAFE.top);
    this.channelVignette.fillRect(0, VIEW.height - band, VIEW.width, band);
    this.channelVignette.fillRect(0, SAFE.top, VIEW.width, band * 0.5);
  }

  /**
   * Pool for the generated Collapse curtain. Built once per run and parked
   * invisible: the ring only exists after `collapse.atS`, but allocating 32
   * sprites mid-fight during the loudest beat of the run is exactly the hitch
   * §15 pools to avoid.
   */
  private buildCollapseCurtain(): void {
    this.collapseSegments = [];
    if (!this.anims.exists(ANIM.collapseRing)) return;
    for (let i = 0; i < COLLAPSE_SEGMENT_POOL; i += 1) {
      const segment = this.add
        .sprite(0, 0, ANIM.collapseRing)
        .setDisplaySize(COLLAPSE_SEGMENT_W, COLLAPSE_SEGMENT_H)
        .setDepth(45)
        .setVisible(false);
      segment.play(ANIM.collapseRing);
      this.collapseSegments.push(segment);
    }
  }

  /**
   * The three HUD components UiMeta owns. This scene positions them at their
   * contracted anchors and feeds them plain data — it never draws them, and
   * they never read game state.
   */
  private buildHudComponents(): void {
    this.compass = new GateCompass(this, 360, 600);
    this.bagPips = new BagPips(this, 360, 88);
    // Self-placing at its §14.3 contract coordinate (UiMeta owns the band).
    this.channelBar = new ChannelBar(this);
  }

  /** One ticking-frame step of the whole extraction loop. */
  private tickExtraction(deltaMs: number): void {
    const player = this.combat.player;

    // Contest census: the channel accrues slower while the ring is held, and
    // an elite in the ring costs more than a husk (PRD §7 `extract.*`).
    const gateId = this.extraction.channelingGate;
    this.contest.enemies = 0;
    this.contest.elites = 0;
    if (gateId !== null) {
      const gate = this.zoneGates.find((g) => g.id === gateId);
      if (gate !== undefined) this.combat.countNear(gate.x, gate.y, TUNING.gate.radius, this.contest);
    }

    this.extraction.update(deltaMs, player.x, player.y, this.tookHitSinceTick, this.contest);
    this.tookHitSinceTick = false;
    // 'extracted' may have ended the run synchronously inside update().
    if (this.ended) return;

    this.tickCollapse(deltaMs);
    if (this.ended) return;

    this.collectRelicPickups();
    this.redrawExtractionVisuals();
    this.feedHudComponents();
  }

  /** Threat ramp and dusk-fire drain while the Collapse runs. */
  private tickCollapse(deltaMs: number): void {
    const collapse = this.extraction.collapse;
    if (collapse === null || !collapse.active) return;

    this.collapseBonus = this.extraction.collapseThreatBonus;

    // Dusk-fire: outside the shrinking ring, hp drains DIRECTLY — this
    // deliberately bypasses `Health.apply` so i-frames cannot shield idling.
    const centre = this.extraction.collapseRingCenter;
    const player = this.combat.player;
    const dx = player.x - centre.x;
    const dy = player.y - centre.y;
    if (dx * dx + dy * dy <= collapse.ringRadius * collapse.ringRadius) return;
    this.onHazardDrain((this.extraction.collapseFireDps * deltaMs) / 1000);
  }

  /**
   * Rolls `count` relics and lands them as ground pickups. `minTier` floors the
   * roll for the sources that promise a tier (the Shrine, the Warden).
   */
  private dropRelics(x: number, y: number, count: number, tierBias: number, minTier = 0): void {
    for (let i = 0; i < count; i += 1) {
      let def = rollRelic(this.rng, this.zone.id, tierBias);
      // A guaranteed tier is guaranteed: re-roll rather than hand over a
      // Tarnished trinket from the vault the player fought through a pocket for.
      for (let attempt = 0; attempt < 8 && def.tier < minTier; attempt += 1) {
        def = rollRelic(this.rng, this.zone.id, tierBias + 1);
      }
      const angle = this.rng.float(0, Math.PI * 2);
      const spread = count > 1 ? this.rng.float(30, 90) : 0;
      this.spawnRelicPickup(def, x + Math.cos(angle) * spread, y + Math.sin(angle) * spread, null);
    }
  }

  private spawnRelicPickup(def: RelicDef, x: number, y: number, lingerMs: number | null): void {
    const point = { x: 0, y: 0 };
    this.arena.clamp(x, y, TUNING.arena.wallThickness + 24, point);
    const pickup = this.relicPool.obtain();
    pickup.drop(def, point.x, point.y, this.simTimeMs, RELIC_PICKUP_ARM_MS, lingerMs);
    this.relics.push(pickup);
  }

  /** Arming, magnetism, expiry and overflow handling for ground relics. */
  private collectRelicPickups(): void {
    const player = this.combat.player;
    const radius = player.stats.get('pickupRadius');
    for (let i = this.relics.length - 1; i >= 0; i -= 1) {
      const pickup = this.relics[i];
      if (pickup === undefined) continue;
      const state = pickup.tick(this.simTimeMs, player.x, player.y, radius);
      if (state === 'idle') continue;

      const def = pickup.def;
      const x = pickup.x;
      const y = pickup.y;
      this.relicPool.release(pickup);
      this.relics.splice(i, 1);
      if (state === 'expired') continue;

      const result = this.bag.addRelic(def);
      if (!result.accepted) {
        // §13 "Bag overflow drop": grey pop + toast at 300ms + a low `tap`,
        // capped 1/s. A world floater over the player was the whole feedback
        // for the single most consequential refusal in the run — the bag
        // saying no to loot you walked into a gate window for.
        if (allowEffect('overflow', 1)) {
          toast(this, `BAG FULL · ${def.name.toUpperCase()} DROPPED`, CSS.warn, 560, 300);
          burst(this, x, y, IDENTITY.cooled, 8, 160);
          sfx('tap', { volume: 0.25, rate: 0.6 });
        }
        this.spawnRelicPickup(def, x, y, TUNING.bag.dropLingerS * 1000);
        continue;
      }
      // §13 "Relic pickup": tier-coloured pop at 200ms + the name floater +
      // `combo` at 0.6, capped 1/s. The pop lands on the HERO, which is the
      // object that just absorbed the relic — the pickup sprite is already
      // back in the pool by this line, so it has nothing left to squash.
      const tint = tierColor(def.tier);
      pop(this, player, 0.22, 200);
      burst(this, player.x, player.y, tint, 10, 200);
      if (allowEffect('relic-sfx', 1)) sfx('combo', { volume: 0.6 });
      else sfx('pickup', { volume: 0.4 });
      // Over the arena, so over lit ART: tier 4 Dread is `secondary`, which is
      // not a legal text tone there and degrades to ink by contract.
      floatText(this, player.x, player.y - 90, def.name, tierColorCss(def.tier, 'art'), 38);
      if (result.dropped !== null) {
        floatText(this, player.x, player.y - 130, `DROPPED: ${result.dropped.name}`, CSS.bad, 32);
        const angle = this.rng.float(0, Math.PI * 2);
        this.spawnRelicPickup(
          relicDef(result.dropped.id),
          player.x + Math.cos(angle) * 140,
          player.y + Math.sin(angle) * 140,
          TUNING.bag.dropLingerS * 1000,
        );
      }
    }
  }

  /** Gate art + ring fallback (state-diffed), channel arc, Collapse curtain, vignette. */
  private redrawExtractionVisuals(): void {
    if (this.gateRings !== null) {
      for (const gate of this.zoneGates) {
        const state = this.extraction.gateState(gate.id);
        const previous = this.gateRingState[gate.id];
        if (previous === state) continue;
        this.gateRingState[gate.id] = state;
        const style = GATE_RING_STYLE[state];
        this.gateRings[gate.id]
          .setStrokeStyle(6, style.color, style.alpha)
          .setFillStyle(style.color, state === 'open' || state === 'closing' ? 0.08 : 0.03);
        const sprite = this.gateSprites?.[gate.id];
        if (sprite !== undefined) this.paintGate(sprite, state, previous);
      }
    }

    // The hero holds the rite while the channel runs (§11 hero cycle). Driven
    // off `channelingGate` rather than progress, so entering the ring commits
    // the pose on the same frame the accrual starts.
    this.combat.player.setChannelling(
      !this.extraction.extracted && this.extraction.channelingGate !== null,
    );

    // Channel progress ring around the player — spatial truth. The MAGNITUDE
    // lives in the screen-space ChannelBar, because in a crowded ring the
    // world arc is completely covered by the bodies contesting it.
    //
    // THE CHANNEL IS THE MOST IMPORTANT THING ON SCREEN WHILE IT RUNS. The
    // playtest critic's finding was that "the thing telling you whether you
    // live is the thinnest mark on screen": a flat 10px stroke and a flat 0.3
    // vignette read as ambience next to a 40-body fight. Three fixes, all
    // driven off progress so the beat ESCALATES instead of sitting there:
    // the arc thickens 10→18px, the vignette brightens with the fill on top of
    // an 0.8s breath (§11 motion identity: "gate light breathes at 0.8s"), and
    // a leading-edge pip marks where the fill actually is.
    this.channelGfx.clear();
    const progress = this.extraction.channelProgress;
    const channelling = !this.extraction.extracted && this.extraction.channelingGate !== null && progress > 0;
    if (channelling) {
      const player = this.combat.player;
      const sweep = progress * Math.PI * 2;
      const from = -Math.PI / 2;
      this.channelGfx.lineStyle(10 + 8 * progress, IDENTITY.gateOpen, 0.95);
      this.channelGfx.beginPath();
      this.channelGfx.arc(player.x, player.y, 74, from, from + sweep);
      this.channelGfx.strokePath();
      // The pip: the eye tracks a moving point far better than it reads the
      // end of an arc, and this one accelerates visibly as the contest clears.
      this.channelGfx.fillStyle(0xffffff, 0.9);
      this.channelGfx.fillCircle(
        player.x + Math.cos(from + sweep) * 74,
        player.y + Math.sin(from + sweep) * 74,
        7 + 3 * progress,
      );
    }
    this.tickChannelFeedback(channelling, progress);

    const collapse = this.extraction.collapse;
    const centre = this.extraction.collapseRingCenter;
    const radius = collapse !== null && collapse.active ? collapse.ringRadius : 0;
    this.paintCollapseCurtain(centre.x, centre.y, radius);
  }

  /**
   * The audio and screen-edge half of the channel: §13's "Channel progress"
   * and "Channel interrupted" rows.
   *
   * The vignette's alpha is written per frame from progress plus an 0.8s
   * breath. That is one field write, NOT a looping tween: a repeat:-1 tween on
   * a Graphics owned by the scene is the exact leak class AGENTS.md calls out,
   * and it would have to be killed on interrupt, on leaving the ring, on
   * extraction, on death and on shutdown — five kill sites for an effect a
   * cosine computes for free.
   */
  private tickChannelFeedback(channelling: boolean, progress: number): void {
    if (!channelling) {
      if (this.channelWasActive) {
        this.channelWasActive = false;
        this.channelVignette.setVisible(false);
      }
      // Re-armed rather than kept: walking out of the ring and back in should
      // sound like starting again, because mechanically it is.
      this.channelQuarter = 0;
      return;
    }

    if (!this.channelWasActive) {
      this.channelWasActive = true;
      this.channelVignette.setVisible(true);
      // The start beat: the rite is the one action in the game that cannot be
      // taken by accident, so it announces itself.
      sfx('tap', { volume: 0.5, rate: 0.9 });
      edgeFlash(this, IDENTITY.gateOpen, 180, 70);
    }

    // 0.3 floor rising to 0.62 at a full fill, breathing ±0.08 on the §11
    // 0.8s gate-light cycle. At 100% this is twice the alpha the flat 0.3
    // vignette had, so the screen edge is unmistakably violet by the end.
    const breath = Math.sin((this.time.now / 800) * Math.PI * 2) * 0.08;
    this.channelVignette.setAlpha(Phaser.Math.Clamp(0.3 + 0.32 * progress + breath, 0.2, 0.75));

    // §13: one `tap` per 25%, pitching up — the run's clearest "you are three
    // quarters of the way out" cue, and audible with your eyes on the horde.
    const quarter = Math.min(4, Math.floor(progress * 4) + (progress >= 1 ? 0 : 1));
    if (quarter > this.channelQuarter) {
      this.channelQuarter = quarter;
      sfx('tap', { volume: 0.5, rate: 0.9 + 0.22 * quarter });
      edgeFlash(this, IDENTITY.gateOpen, 160, 80);
    } else if (quarter < this.channelQuarter) {
      // A setback dropped the fill below a line already crossed: re-arm it, so
      // re-earning that quarter sounds like progress rather than like silence.
      this.channelQuarter = quarter;
    }

    // §13 "Channel interrupted": the ring shatters (burst 10) + shake 0.008 +
    // `hit`. `channelInterrupted` is a single-frame flag on the system, so this
    // is edge-triggered already. Capped through the shared shake gate: a hit
    // that interrupts also fires the player-hurt shake, and two camera shakes
    // on one frame is one unreadable frame.
    if (this.extraction.channelInterrupted) {
      const player = this.combat.player;
      burst(this, player.x, player.y, IDENTITY.threat, 10, 260);
      if (allowEffect('shake', TUNING.caps.hurtShakePerSecond)) shake(this, 0.008, 140);
      sfx('hit', { volume: 0.45, rate: 1.4 });
    }
  }

  /**
   * One gate arch, driven by state. `gate-opening` is a one-shot grind that
   * hands off to the `gate-open` breathe loop; every other state is a direct
   * swap. Untinted throughout — the sheets carry their own colour code.
   */
  private paintGate(
    sprite: Phaser.GameObjects.Sprite,
    state: GateState,
    previous: GateState | null,
  ): void {
    sprite.setAlpha(state === 'spent' ? GATE_SPENT_ALPHA : 1);
    switch (state) {
      case 'open':
        // Only the closed -> open transition earns the grind; coming back from
        // 'closing' (a gate that got its window extended) just resumes.
        if (previous === 'closed' || previous === null) {
          this.openGateWithGrind(sprite);
          return;
        }
        sprite.play(ANIM.gateOpen, true);
        return;
      case 'closing':
        sprite.play(ANIM.gateClosing, true);
        return;
      case 'closed':
      case 'spent':
        sprite.stop();
        sprite.setTexture(TEXTURE.gateClosed);
        return;
    }
  }

  /**
   * Plays the 6f grind and cross-fades into the open loop. The fade exists
   * because the two sheets are geometrically identical but `gate-opening` ends
   * measurably brighter than the whole `gate-open` cycle — see
   * `GATE_HANDOFF_MS`. The temporary sprite dies with the tween, or with the
   * scene if the run ends mid-fade.
   */
  private openGateWithGrind(sprite: Phaser.GameObjects.Sprite): void {
    sprite.play(ANIM.gateOpening, true);
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (!sprite.active) return;
      const incoming = this.add
        .sprite(sprite.x, sprite.y, ANIM.gateOpen)
        .setDisplaySize(sprite.displayWidth, sprite.displayHeight)
        .setDepth(sprite.depth)
        .setAlpha(0);
      incoming.play(ANIM.gateOpen);
      this.tweens.add({ targets: incoming, alpha: 1, duration: GATE_HANDOFF_MS });
      this.tweens.add({
        targets: sprite,
        alpha: 0,
        duration: GATE_HANDOFF_MS,
        onComplete: () => {
          sprite.play(ANIM.gateOpen, true);
          // Inherit the loop phase so the hand-back is invisible too.
          sprite.anims.setProgress(incoming.anims.getProgress());
          sprite.setAlpha(1);
          incoming.destroy();
        },
      });
    });
  }

  /**
   * Lays the generated dusk-fire curtain around the Collapse ring, or strokes
   * the fallback circle when the art is absent.
   *
   * Only segments inside the camera view get a sprite, so the cost tracks the
   * screen rather than the ring: a 1200px-radius ring needs ~58 segments to
   * close, but at most ~24 are ever visible at once (§15).
   *
   * Rotation is `angle + PI/2`, which points the sheet's local +y — measured as
   * the hot base carrying all of the dried-blood heat line — INWARD at the
   * player. The far edge is the dark fade, so the closing wall reads hot on the
   * side the player is actually looking at (§11 threat coding).
   */
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
      const marginX = COLLAPSE_SEGMENT_H;
      const count = Math.max(12, Math.ceil((Math.PI * 2 * radius) / COLLAPSE_SEGMENT_W));
      const step = (Math.PI * 2) / count;
      const width = radius * step * COLLAPSE_SEGMENT_OVERLAP;
      for (let i = 0; i < count && used < segments.length; i += 1) {
        const angle = i * step;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (x < view.x - marginX || x > view.right + marginX) continue;
        if (y < view.y - marginX || y > view.bottom + marginX) continue;
        const segment = segments[used];
        if (segment === undefined) break;
        used += 1;
        segment
          .setVisible(true)
          .setPosition(x, y)
          .setRotation(angle + Math.PI / 2)
          .setDisplaySize(width, COLLAPSE_SEGMENT_H);
      }
    }
    for (let i = used; i < segments.length; i += 1) segments[i]?.setVisible(false);
  }

  /**
   * Feeds UiMeta's three components. Every model object and array here is
   * reused: the HUD is diffed downstream, so this must not allocate.
   */
  private feedHudComponents(): void {
    const player = this.combat.player;
    const nowS = this.extraction.elapsedS;

    // A dead gate is news exactly once — at the moment it dies. Past that its
    // SPENT arrow burns the same screen corner the LIVE gate needs: at 7:03 two
    // spent arrows were still lit while the one open gate competed with them for
    // the ring, which is the compass telling the player about the two exits that
    // no longer exist as loudly as about the one that does.
    //
    // So a spent gate is RETIRED from the feed as soon as any gate is live, and
    // OMISSION is the retirement signal — `ui/gateCompass.ts` hides an arrow
    // whose id it was not fed this frame (contract agreed with UiMeta). While
    // nothing is live a spent gate is still fed: "your exit is gone" is the
    // whole answer to why the player cannot leave.
    let anyGateLive = false;
    for (const gate of this.zoneGates) {
      const state = this.extraction.gateState(gate.id);
      if (state === 'open' || state === 'closing') {
        anyGateLive = true;
        break;
      }
    }

    this.compassGates.length = 0;
    for (const gate of this.zoneGates) {
      const state = this.extraction.gateState(gate.id);
      if (state !== 'spent' || !anyGateLive) {
        this.compassGates.push({
          id: gate.id,
          x: gate.x,
          y: gate.y,
          state,
          opensS: gate.opensS,
          closesS: gate.closesS,
        });
      }
      // The early tell: a gate entering its preview window announces itself
      // once, so the extraction clock is legible well before it matters.
      if (
        !this.gatePreviewed[gate.id] &&
        state === 'closed' &&
        gate.opensS - nowS <= TUNING.gate.previewS
      ) {
        this.gatePreviewed[gate.id] = true;
        sfx('ui', { volume: 0.4 });
        floatText(
          this,
          player.x,
          player.y - 160,
          `GATE ${gate.id.toUpperCase()} OPENS ${Math.max(0, Math.ceil(gate.opensS - nowS))}s`,
          CSS.accent,
          38,
        );
      }
      // §13 "Gate closing ≤30s": the compass chip already pulses amber on an
      // 0.8s cycle (`ui/gateCompass.ts` owns that half). This is the row's
      // AUDIO half, which was missing entirely — a door shutting on your only
      // exit was a silent visual on a widget at the edge of the frame. Capped
      // at 1/5s per §13, and shared across all three gates so two closing at
      // once is still one tick.
      if (state === 'closing' && allowEffect('gate-closing-tick', 0.2)) {
        sfx('tap', { volume: 0.4, rate: 1.5 });
      }
    }
    this.compassModel.playerX = player.x;
    this.compassModel.playerY = player.y;
    this.compassModel.elapsedS = nowS;
    this.compass.update(this.compassModel);

    this.bagRelicTiers.length = 0;
    for (const relic of this.bag.relics) this.bagRelicTiers.push(relic.tier);
    this.bagCasketTiers.length = 0;
    for (const relic of this.bag.casket) this.bagCasketTiers.push(relic.tier);
    // The bag's OWN capacity, not the tuned base: a Marrow Sack run has 10 or
    // 12 slots and the pips have to show all of them.
    this.bagModel.slots = this.bag.slots;
    this.bagModel.used = this.bag.relics.length;
    this.bagModel.casketSlots = this.bag.casketSlots;
    this.bagModel.shards = this.bag.shards;
    this.bagPips.update(this.bagModel);

    this.channelModel.active =
      !this.extraction.extracted && this.extraction.channelingGate !== null;
    this.channelModel.gateId = this.extraction.channelingGate;
    this.channelModel.progress = this.extraction.channelProgress;
    this.channelModel.interrupted = this.extraction.channelInterrupted;
    this.channelBar.update(this.channelModel);
  }
}

/**
 * One carried relic as the results screen's `HaulRelic` — id, name, tier and
 * nothing else, so `scenes/gameover.ts` never depends on the content table.
 * Typed on the fields it reads rather than on a `RelicDef`, because the bag
 * carries the narrow `systems/bag.ts` shape and the ground pickups carry the
 * full `data/relics.ts` one.
 */
function haulRelic(def: { id: string; name: string; tier: number }): HaulRelic {
  return { id: def.id, name: def.name, tier: def.tier };
}
