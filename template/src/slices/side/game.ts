import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../../config';
import { SCENES, TEX } from '../../core/keys';
import { Rng } from '../../core/rng';
import { LevelDirector } from '../../core/level';
import type { SessionOutcome } from '../../core/session';
import { load, save } from '../../core/storage';
import { sfx } from '../../core/audio';
import { setMusicIntensity, startMusic } from '../../core/music';
import { burst, flash, floatText, shake } from '../../core/juice';
import { buildGradient } from '../../core/textures';
import { Button } from '../../ui/button';
import { addBackground } from '../../ui/background';
import { showPauseOverlay, type PauseOverlayHandle } from '../../ui/pauseOverlay';
import { showSagaMap, type SagaMapHandle } from '../../ui/sagaMap';
import {
  MAX_STARS,
  bestStars,
  boosterCount,
  loadMeta,
  recordStars,
  spendBooster,
  touchDailyStreak,
} from '../../core/progression';
import type { ArtSlot } from '../../data/art';
import { SIDE_TUNING } from './tuning';
import {
  SIDE_LAST_LEVEL_KEY,
  SIDE_LEVEL_COUNT,
  SIDE_PROGRESS_KEY,
  buildSideLevel,
  clampLevelIndex,
  sideLevelSpec,
} from './levels';
import type { SideLevel } from './gen';

const SIDE_SKY = 'side-sky';

/** `meta_coin_magnet` in the side catalog (`data/metaCatalog.ts`). */
const PERK_COIN_MAGNET = 'meta_coin_magnet';
/** `extra-life` booster id, spent for one in-level revive. */
const BOOSTER_EXTRA_LIFE = 'extra-life';

/**
 * Art groups `PreloadScene` loads for this slice (see the slice-wiring guide):
 * `ui` + `bg` are universal, `side-hero` carries the hero actions plus the
 * platform/spike tiles.
 */
export const ART_GROUPS = ['ui', 'bg', 'side-hero'] as const;

/**
 * SIDE RUNNER — the authored-level platformer (family C) reference slice.
 *
 * One thumb, one verb: the hero auto-runs right and a tap jumps. Holding the
 * tap keeps the jump climbing, releasing it early cuts the arc — which is the
 * whole skill ceiling, since `gen.ts` builds every level out of exactly that
 * jump family. Coyote time (100ms) and a jump buffer (120ms) mean an input
 * near the edge or near the ground does what the player meant.
 *
 * Death is instant retry of the SAME level (scene restart with the same seed,
 * under 600ms), so failure costs a heartbeat rather than a session. Reaching
 * the door banks the next level index and goes to the results screen.
 *
 * All geometry decisions live in `gen.ts` (pure, headless-testable, and
 * reachability-proved), the ladder in `levels.ts`, the numbers in `tuning.ts`.
 * This scene only renders them and adds feel.
 *
 * The meta layer wraps the loop: a bare start opens the saga map, a win banks
 * `recordStars` off the time left, an owned `extra-life` booster buys one
 * in-level revive, and `meta_coin_magnet` widens the pickup bodies.
 */
export class GameScene extends Phaser.Scene {
  private rng!: Rng;
  private seed = '';
  private levelIndex = 0;
  private level!: SideLevel;
  private director!: LevelDirector;

  private player!: Phaser.Physics.Arcade.Image;
  /**
   * The hero the player SEES. Squash-and-stretch on the physics image itself
   * would resize its body (an Arcade body tracks its game object's scale), so
   * the collider stays a clean untouched 44px box and every bit of juice goes
   * on this skin instead.
   */
  private skin!: Phaser.GameObjects.Image;
  private skinScaleX = 1;
  private skinScaleY = 1;
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private hazards!: Phaser.Physics.Arcade.StaticGroup;
  private pickups!: Phaser.Physics.Arcade.StaticGroup;
  private door!: Phaser.Physics.Arcade.Image;

  private coinText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private pauseButton!: Button;
  private pauseOverlay: PauseOverlayHandle | null = null;

  private coins = 0;
  private shownCoins = -1;
  private shownTime = '';
  /** Scene time (ms) of the last frame the hero had ground under it. */
  private lastGroundedAt = 0;
  /** Scene time (ms) of the last unconsumed jump press. */
  private jumpPressedAt = -1;
  private jumpHeld = false;
  private wasGrounded = true;
  /** Scene time (ms) the hero left the ground; gates the landing feedback. */
  private airborneSince = 0;
  private paused = false;
  private ended = false;
  /** True once a level is built: the saga-map phase has no world to tick. */
  private started = false;
  /** Level asked for explicitly by the caller, bypassing the map. */
  private requestedLevel: number | null = null;
  /** A seed in `init` data means "replay this level", never "pick a new one". */
  private replay = false;
  private sagaMap: SagaMapHandle | null = null;
  private mapBackdrop: Phaser.GameObjects.Rectangle | null = null;
  /** World position of the last frame the hero stood on something solid. */
  private lastGroundX = 0;
  private lastGroundY = 0;
  /** One `extra-life` per level, no matter how many the player owns. */
  private reviveUsed = false;
  private revivePrompt: Phaser.GameObjects.Container | null = null;
  /** Pickup body inflation from `meta_coin_magnet`, resolved once per level. */
  private magnetScale = 1;

  constructor() {
    super(SCENES.game);
  }

  /**
   * `scene.start(SCENES.game, { seed })` replays the level in
   * `SIDE_LAST_LEVEL_KEY` with the exact same layout and no map — what the
   * death restart, RETRY and the pause overlay's RESTART all send. A bare
   * start (from the menu) opens the saga map; `levelIndex` skips to one level.
   */
  init(data: { seed?: string; levelIndex?: number } = {}): void {
    this.replay = data.seed !== undefined;
    this.seed = data.seed ?? Date.now().toString(36);
    this.requestedLevel = data.levelIndex === undefined ? null : clampLevelIndex(data.levelIndex);
  }

  create(): void {
    this.time.timeScale = 1;
    this.tweens.timeScale = 1;
    this.physics.world.timeScale = 1;

    this.coins = 0;
    this.shownCoins = -1;
    this.shownTime = '';
    this.jumpPressedAt = -1;
    this.jumpHeld = false;
    this.wasGrounded = true;
    this.airborneSince = 0;
    this.paused = false;
    this.ended = false;
    this.started = false;
    this.reviveUsed = false;
    this.revivePrompt = null;
    this.sagaMap = null;
    this.mapBackdrop = null;
    this.pauseOverlay = null;

    // `addBackground` draws in WORLD space, and this world is 5600px wide, so
    // the scrolling camera would leave its single screen-sized backdrop behind
    // and stare into black. One pinned gradient underneath covers the whole
    // scroll range, and the parallax layers/motes on top of it now read as
    // depth rather than as the only thing there is.
    buildGradient(this, SIDE_SKY, PALETTE.bgTop, PALETTE.bgDeep, 8, VIEW.height);
    this.add
      .image(VIEW.centerX, VIEW.centerY, SIDE_SKY)
      .setDisplaySize(VIEW.width, VIEW.height)
      .setScrollFactor(0)
      .setDepth(-300);
    addBackground(this);

    this.cameras.main.fadeIn(180, 0, 0, 0);
    startMusic('run');
    this.markDailyStreak();

    const explicit = this.requestedLevel;
    if (explicit !== null) {
      this.beginLevel(explicit);
      return;
    }
    if (this.replay) {
      this.beginLevel(clampLevelIndex(load<number>(SIDE_LAST_LEVEL_KEY, 0)));
      return;
    }
    this.openSagaMap();
  }

  /** Advances the daily streak once per entry; celebrates only real growth. */
  private markDailyStreak(): void {
    const streak = touchDailyStreak();
    if (!streak.extended) return;
    this.time.delayedCall(520, () => {
      floatText(this, VIEW.centerX, SAFE.top + 40, `DAY ${streak.days} STREAK!`, CSS.accent, 46);
      sfx('combo', { volume: 0.5 });
    });
  }

  // --- meta gateway ---------------------------------------------------------

  /**
   * The 8-level saga map over a dimmed sky. Nothing is built behind it yet, so
   * CLOSE goes back to the menu rather than to a level.
   */
  private openSagaMap(): void {
    this.mapBackdrop = this.add
      .rectangle(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height, PALETTE.bgDeep, 0.72)
      .setScrollFactor(0)
      .setDepth(2100);

    const starsByLevel: Record<string, number> = {};
    const levels = [];
    for (let index = 0; index < SIDE_LEVEL_COUNT; index += 1) {
      const id = sideLevelSpec(index).id;
      starsByLevel[id] = bestStars(id);
      levels.push({ id, label: `${index + 1}` });
    }

    this.sagaMap = showSagaMap(this, {
      levels,
      // Stored progress is the NEXT unplayed index, so the frontier is one
      // level wider than it.
      unlockedCount: clampLevelIndex(load<number>(SIDE_PROGRESS_KEY, 0)) + 1,
      starsByLevel,
      onPick: (levelId) => {
        let picked = 0;
        for (let index = 0; index < SIDE_LEVEL_COUNT; index += 1) {
          if (sideLevelSpec(index).id === levelId) picked = index;
        }
        this.closeSagaMap();
        this.beginLevel(picked);
      },
      onClose: () => {
        this.closeSagaMap();
        this.scene.start(SCENES.menu);
      },
    });
  }

  private closeSagaMap(): void {
    this.sagaMap?.destroy();
    this.sagaMap = null;
    this.mapBackdrop?.destroy();
    this.mapBackdrop = null;
  }

  /** Generates level `index`, builds it and starts its clock. */
  private beginLevel(index: number): void {
    this.levelIndex = index;
    // Written before the first jump so a death restart or RETRY (seed only)
    // lands on this level even after a win advanced the ladder.
    save(SIDE_LAST_LEVEL_KEY, index);

    // One layout per (run seed, level): a retry replays it jump for jump, and
    // the sim generates the identical level from the same two numbers.
    this.level = buildSideLevel(index, this.seed);
    this.rng = new Rng(`${this.seed}:side:${index}:view`);
    this.director = new LevelDirector(sideLevelSpec(index), {
      onEnd: (outcome) => this.resolve(outcome),
    });

    // `meta_coin_magnet` is reach, not size: the body grows, the coin does not.
    const magnetLevel = loadMeta().upgrades[PERK_COIN_MAGNET] ?? 0;
    this.magnetScale = 1 + magnetLevel * SIDE_TUNING.coin.magnetPerPerkLevel;

    this.buildWorld();
    this.buildPlayer();
    this.buildHud();
    this.buildInput();
    this.refreshHud();
    this.started = true;

    setMusicIntensity(0.35 + (index / SIDE_LEVEL_COUNT) * 0.4);
    if (magnetLevel > 0) {
      floatText(this, VIEW.centerX, SAFE.top + 96, `COIN MAGNET +${Math.round((this.magnetScale - 1) * 100)}%`, CSS.accent, 34);
    }
  }

  update(time: number, delta: number): void {
    if (!this.started || this.ended || this.paused) return;

    this.director.update(delta);
    if (this.ended) return;

    // Auto-run: re-asserted every frame because a collision separation can
    // zero the x velocity against a platform wall.
    this.player.setVelocityX(SIDE_TUNING.motion.moveSpeed);

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const grounded = body.blocked.down || body.touching.down;
    if (grounded) {
      this.lastGroundedAt = time;
      // Where an `extra-life` revive puts the hero back: the last surface it
      // actually stood on, never the spot it died in.
      this.lastGroundX = this.player.x;
      this.lastGroundY = this.player.y;
    }

    // Landing feedback only after a REAL flight: Arcade re-separates a resting
    // body every frame, so `blocked.down` can blink and a naive edge trigger
    // would fire the landing puff dozens of times a second.
    if (grounded && !this.wasGrounded && time - this.airborneSince >= 90) this.onLand();
    if (!grounded && this.wasGrounded) this.airborneSince = time;
    this.wasGrounded = grounded;

    this.skin.setPosition(this.player.x, this.player.y);

    // Jump buffer + coyote time: a press up to `jumpBufferMs` early still
    // fires on touchdown, and a press up to `coyoteMs` after leaving an edge
    // still counts as grounded. Both are what make a one-tap platformer feel
    // fair rather than twitchy.
    const buffered = this.jumpPressedAt >= 0 && time - this.jumpPressedAt <= SIDE_TUNING.player.jumpBufferMs;
    const coyote = time - this.lastGroundedAt <= SIDE_TUNING.player.coyoteMs;
    if (buffered && coyote) {
      this.jumpPressedAt = -1;
      this.lastGroundedAt = -Number.MAX_VALUE;
      this.jump();
    }

    // Void: below the world is a death, not a fall through the floor.
    if (this.player.y > this.level.worldHeight + 80) this.die('void');

    this.refreshHud();
  }

  // --- gameplay -------------------------------------------------------------

  private jump(): void {
    this.player.setVelocityY(-SIDE_TUNING.motion.jumpVel);
    sfx('jump', { volume: 0.5 });
    this.squash(-0.16, 170);
    this.puff(this.player.x, this.player.y + SIDE_TUNING.player.size / 2, PALETTE.inkSoft, 5);
  }

  /** Pointer/key release cuts the climb — the variable-height jump. */
  private cutJump(): void {
    this.jumpHeld = false;
    if (this.ended || this.paused) return;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    if (body.velocity.y < 0) this.player.setVelocityY(body.velocity.y * SIDE_TUNING.motion.cutFactor);
  }

  private onLand(): void {
    sfx('tap', { volume: 0.28 });
    this.squash(0.22, 150);
    this.puff(this.player.x, this.player.y + SIDE_TUNING.player.size / 2, PALETTE.ink, 6);
  }

  /**
   * Squash (`amount > 0`: wide and flat, landing) or stretch (`amount < 0`:
   * tall and thin, takeoff), always relaxing back to the ONE known base scale.
   * `juice.pop` reads the current scale as its base, so two overlapping pops
   * ratchet a sprite bigger every time — which on a 60fps runner that lands and
   * jumps constantly is a hero that grows off the screen.
   */
  private squash(amount: number, durationMs: number): void {
    this.tweens.killTweensOf(this.skin);
    this.skin.setScale(this.skinScaleX * (1 + amount), this.skinScaleY * (1 - amount * 0.6));
    this.tweens.add({
      targets: this.skin,
      scaleX: this.skinScaleX,
      scaleY: this.skinScaleY,
      duration: durationMs,
      ease: 'Back.easeOut',
    });
  }

  private collectCoin(coin: Phaser.GameObjects.GameObject): void {
    const image = coin as Phaser.Physics.Arcade.Image;
    if (!image.active) return;
    image.disableBody(true, true);
    this.coins += 1;
    sfx('pickup', { rate: 1 + Math.min(0.5, this.coins * 0.03) });
    burst(this, image.x, image.y, PALETTE.accent, 10, 220);
    floatText(this, image.x, image.y - 20, `+${SIDE_TUNING.coin.score}`, CSS.accent, 34);
  }

  /**
   * A fatal hit. With an `extra-life` in stock the player is offered one
   * revive per level before the level restarts; without one this is the
   * template's instant retry (death → playing again inside 600ms).
   */
  private die(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.pauseButton.setVisible(false);
    this.player.setVelocity(0, 0);
    (this.player.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);

    sfx('die');
    flash(this, PALETTE.bad, 160);
    shake(this, 0.02, 200);
    setMusicIntensity(0.2);
    floatText(this, this.player.x, this.player.y - 60, reason === 'void' ? 'MISSED' : 'OUCH', CSS.bad, 44);

    if (!this.reviveUsed && boosterCount(BOOSTER_EXTRA_LIFE) > 0) {
      this.offerRevive();
      return;
    }
    this.restartLevel();
  }

  /**
   * Instant retry of the SAME level: the fade runs on the raw frame delta, so
   * death → playing again stays inside the 600ms budget, and the stored level
   * index is untouched.
   */
  private restartLevel(): void {
    this.cameras.main.fadeOut(SIDE_TUNING.deathHoldMs, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ seed: this.seed });
    });
  }

  /**
   * The revive offer: one screen-wide capsule, live for `revive.promptMs`, and
   * the level restarts by itself when it lapses — a dead run must never wait
   * on a decision the player has walked away from. Click semantics come from
   * `ui/button.ts`; the director's clock is frozen while this is up because
   * `update` returns early on `ended`.
   */
  private offerRevive(): void {
    const root = this.add.container(0, 0).setDepth(2400).setScrollFactor(0);
    const dim = this.add
      .rectangle(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height, 0x000000, 0.55)
      .setScrollFactor(0);
    const heading = this.add
      .text(VIEW.centerX, VIEW.centerY - 120, 'EXTRA LIFE?', { ...TEXT.heading, color: CSS.good })
      .setOrigin(0.5)
      .setScrollFactor(0);
    const blurb = this.add
      .text(
        VIEW.centerX,
        VIEW.centerY - 50,
        `${boosterCount(BOOSTER_EXTRA_LIFE)} IN STOCK  ·  ONE PER LEVEL`,
        { ...TEXT.label, color: CSS.inkSoft },
      )
      .setOrigin(0.5)
      .setScrollFactor(0);

    let resolved = false;
    const button = new Button(
      this,
      VIEW.centerX,
      VIEW.centerY + 60,
      'REVIVE',
      () => {
        if (resolved) return;
        resolved = true;
        // Gate the effect on the SPEND, not on the count read a moment ago.
        if (spendBooster(BOOSTER_EXTRA_LIFE)) this.revive();
        else this.restartLevel();
      },
      { width: VIEW.width - SAFE.side * 2, height: 112, fill: PALETTE.good, stroke: PALETTE.ink },
    );
    button.setScrollFactor(0);

    root.add([dim, heading, blurb, button]);
    this.revivePrompt = root;

    this.time.delayedCall(SIDE_TUNING.revive.promptMs, () => {
      if (resolved) return;
      resolved = true;
      this.closeRevivePrompt();
      this.restartLevel();
    });
  }

  private closeRevivePrompt(): void {
    this.revivePrompt?.destroy(true);
    this.revivePrompt = null;
  }

  /** Puts the hero back on the last surface it stood on and un-ends the level. */
  private revive(): void {
    this.closeRevivePrompt();
    this.reviveUsed = true;
    this.ended = false;
    this.pauseButton.setVisible(true);

    this.player.setPosition(this.lastGroundX, this.lastGroundY - SIDE_TUNING.revive.liftPx);
    this.player.setVelocity(0, 0);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(true);
    this.player.setVelocityX(SIDE_TUNING.motion.moveSpeed);
    this.skin.setPosition(this.player.x, this.player.y);

    // A queued jump from before the death must not fire on the respawn frame.
    this.jumpPressedAt = -1;
    this.jumpHeld = false;
    this.wasGrounded = true;
    this.airborneSince = this.time.now;
    this.lastGroundedAt = this.time.now;

    sfx('levelup', { volume: 0.7 });
    flash(this, PALETTE.good, 180);
    burst(this, this.player.x, this.player.y, PALETTE.good, 18, 300);
    floatText(this, this.player.x, this.player.y - 70, 'REVIVED', CSS.good, 46);
    setMusicIntensity(0.35 + (this.levelIndex / SIDE_LEVEL_COUNT) * 0.4);
  }

  private reachExit(): void {
    if (this.ended) return;
    sfx('levelup');
    flash(this, PALETTE.good, 180);
    burst(this, this.door.x, this.door.y, PALETTE.good, 22, 320);
    floatText(this, this.door.x, this.door.y - 90, 'CLEAR!', CSS.good, 56);
    // The win is the director's to declare: it owns the clock and the goals.
    this.director.recordProgress('exit');
  }

  /** Called by `LevelDirector.onEnd` — the only place a level resolves. */
  private resolve(outcome: SessionOutcome): void {
    if (this.ended) return;
    this.ended = true;
    this.pauseButton.setVisible(false);
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;

    const stars = this.director.stars;
    const spec = sideLevelSpec(this.levelIndex);
    if (outcome.won) {
      // The time left on the win IS the rating (see `sideLevelSpec`), so this
      // is what the saga map shows next time.
      recordStars(spec.id, stars);
      // Monotonic: replaying an early level must never revoke the frontier.
      save(
        SIDE_PROGRESS_KEY,
        Math.max(
          load<number>(SIDE_PROGRESS_KEY, 0),
          Math.min(this.levelIndex + 1, SIDE_LEVEL_COUNT - 1),
        ),
      );
      sfx('levelup');
    } else {
      // Running the 90s budget out is a session outcome, not a twitch mistake:
      // it goes to the results screen. Hazard and void deaths keep the
      // instant-retry loop in `die`.
      sfx('die', { volume: 0.6 });
      flash(this, PALETTE.bad, 200);
      setMusicIntensity(0.2);
    }

    const timeMs = this.director.elapsedSeconds * 1000;
    const score = outcome.won ? this.coins * SIDE_TUNING.coin.score + SIDE_TUNING.exitScore : this.coins * SIDE_TUNING.coin.score;

    this.cameras.main.fadeOut(SIDE_TUNING.fadeOutMs, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(SCENES.gameOver, {
        won: outcome.won,
        timeMs,
        score,
        currencyEarned: Math.floor(this.coins / SIDE_TUNING.coin.perCurrency) + stars * 2,
        seed: this.seed,
        stats: [
          { label: 'LEVEL', value: `${this.levelIndex + 1}/${SIDE_LEVEL_COUNT}` },
          { label: 'STARS', value: `${stars}/${MAX_STARS}` },
          { label: 'COINS', value: `${this.coins}/${this.level.coins.length}` },
        ],
        headline: outcome.won ? 'LEVEL COMPLETE!' : 'WIPED OUT',
        timeLabel: 'TIME',
        // Per-level runs are not comparable to each other, so a lifetime "best
        // time" across the whole ladder would be meaningless: stars carry the
        // fast-clear reward instead.
        bestTimeMode: 'off',
      });
    });
  }

  // --- world ----------------------------------------------------------------

  /**
   * The slot to draw with, or `null` for the procedural primitive. A slot whose
   * texture never loaded (pruned art group, art not generated yet) resolves to
   * `null` here, so the slice stays playable without its art.
   */
  private resolveSlot(slot: ArtSlot | null): ArtSlot | null {
    if (slot === null) return null;
    return this.textures.exists(slot.key) ? slot : null;
  }

  private buildWorld(): void {
    const level = this.level;
    this.physics.world.setBounds(0, 0, level.worldWidth, level.worldHeight);
    this.cameras.main.setBounds(0, 0, level.worldWidth, level.worldHeight);

    const platformSlot = this.resolveSlot(SIDE_TUNING.art.platform);
    this.platforms = this.physics.add.staticGroup();
    for (const platform of level.platforms) {
      const body = this.physics.add
        .staticImage(
          platform.x + platform.w / 2,
          platform.y + platform.h / 2,
          platformSlot?.key ?? TEX.square,
          platformSlot?.frame,
        )
        // STATIC BODY TRAP: the body is rebuilt from `displayWidth/Height`, so
        // the size must be set BEFORE `refreshBody()` — the other order leaves
        // a 96x96 body on a 400x240 platform and the hero walks on thin air.
        .setDisplaySize(platform.w, platform.h)
        .refreshBody();
      body.setDepth(10);
      // Tint is the FALLBACK's readability trick (ground vs float); generated
      // tiles carry their own colour and must not be tinted.
      if (platformSlot === null) body.setTint(platform.ground ? PALETTE.bgTop : PALETTE.primary);
      if (platform.ground) body.setAlpha(0.95);
      this.platforms.add(body);

      // A bright lip on the walkable surface: the one line the eye reads while
      // running, drawn once as a static rectangle (never a per-frame redraw).
      this.add
        .rectangle(platform.x + platform.w / 2, platform.y + 3, platform.w, 6, PALETTE.primary, 0.85)
        .setDepth(11);
    }

    const spikeSlot = this.resolveSlot(SIDE_TUNING.art.spike);
    this.hazards = this.physics.add.staticGroup();
    for (const spike of level.spikes) {
      const image = this.physics.add
        .staticImage(spike.x + spike.w / 2, spike.y + spike.h / 2, spikeSlot?.key ?? TEX.spike, spikeSlot?.frame)
        .setDisplaySize(spike.w, spike.h)
        .refreshBody();
      image.setDepth(12);
      if (spikeSlot === null) image.setTint(PALETTE.bad);
      this.hazards.add(image);
    }

    const coinSlot = this.resolveSlot(SIDE_TUNING.art.coin);
    const coinSize = SIDE_TUNING.coin.size;
    this.pickups = this.physics.add.staticGroup();
    for (const coin of level.coins) {
      const image = this.physics.add
        .staticImage(coin.x, coin.y, coinSlot?.key ?? TEX.star, coinSlot?.frame)
        .setDisplaySize(coinSize, coinSize)
        .refreshBody();
      image.setDepth(14);
      if (coinSlot === null) image.setTint(PALETTE.accent);
      // `meta_coin_magnet`: the pickup BODY grows, the drawn coin does not.
      // `setSize` re-inserts the body into the static RTree and re-centres it
      // on the coin, which `refreshBody` alone would undo.
      if (this.magnetScale > 1) {
        const reach = coinSize * this.magnetScale;
        (image.body as Phaser.Physics.Arcade.StaticBody).setSize(reach, reach, true);
      }
      this.pickups.add(image);
      // Idle spin so a coin never reads as scenery.
      this.tweens.add({
        targets: image,
        angle: 360,
        duration: this.rng.int(1800, 2600),
        repeat: -1,
      });
    }

    const exit = SIDE_TUNING.exit;
    const exitSlot = this.resolveSlot(SIDE_TUNING.art.exit);
    this.door = this.physics.add
      .staticImage(level.exit.x, level.exit.y - exit.height / 2, exitSlot?.key ?? TEX.square, exitSlot?.frame)
      .setDisplaySize(exit.width, exit.height)
      .refreshBody();
    this.door.setDepth(9).setAlpha(0.9);
    if (exitSlot === null) {
      this.door.setTint(PALETTE.good);
      this.add
        .image(level.exit.x, level.exit.y - exit.height / 2, TEX.ring)
        .setDisplaySize(exit.width * 0.7, exit.width * 0.7)
        .setTint(PALETTE.ink)
        .setDepth(10);
    }
  }

  private buildPlayer(): void {
    const size = SIDE_TUNING.player.size;
    // The generator models the hero as a POINT AT ITS FEET, so the sprite
    // centre sits half a body above the surface it spawns on.
    this.player = this.physics.add.image(this.level.spawn.x, this.level.spawn.y - size / 2, TEX.square);
    this.player.setDisplaySize(size, size).setVisible(false);
    const heroSlot = this.resolveSlot(SIDE_TUNING.art.hero);
    this.skin = this.add
      .image(this.player.x, this.player.y, heroSlot?.key ?? TEX.square, heroSlot?.frame)
      .setDisplaySize(size, size)
      .setDepth(20);
    // A generated hero is already coloured (AGENTS.md): only the placeholder
    // block takes a tint.
    if (heroSlot === null) this.skin.setTint(PALETTE.secondary);
    this.skinScaleX = this.skin.scaleX;
    this.skinScaleY = this.skin.scaleY;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(true);
    body.setGravityY(SIDE_TUNING.motion.gravity);
    // Never clamp to the world: falling out of the bottom is a death.
    this.player.setCollideWorldBounds(false);
    this.player.setVelocityX(SIDE_TUNING.motion.moveSpeed);
    this.lastGroundedAt = 0;

    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.overlap(this.player, this.pickups, (_player, coin) => this.collectCoin(coin as never));
    this.physics.add.overlap(this.player, this.hazards, () => this.die('hazard'));
    this.physics.add.overlap(this.player, this.door, () => this.reachExit());

    const camera = this.cameras.main;
    camera.startFollow(this.player, true, SIDE_TUNING.camera.lerp, SIDE_TUNING.camera.lerp);
    // The camera centres on `follow.x - followOffset.x`, so a NEGATIVE offset
    // pushes the view ahead of the hero — the run-up to the next gap has to be
    // on screen before the jump, not after it.
    camera.setFollowOffset(-SIDE_TUNING.camera.lookAhead, 0);
    camera.setDeadzone(SIDE_TUNING.camera.deadzoneWidth, VIEW.height);
  }

  private puff(x: number, y: number, tint: number, count: number): void {
    burst(this, x, y, tint, count, 140);
  }

  // --- shell ----------------------------------------------------------------

  private buildHud(): void {
    // The level label never changes during a run, so it is drawn, not kept.
    this.add
      .text(SAFE.side, SAFE.top / 2, `LEVEL ${this.levelIndex + 1}/${SIDE_LEVEL_COUNT}`, {
        ...TEXT.heading,
        fontSize: '36px',
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(1400);
    this.coinText = this.add
      .text(SAFE.side, SAFE.top / 2 + 44, '', TEXT.label)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(1400);
    this.timeText = this.add
      .text(VIEW.centerX, SAFE.top / 2, '', { ...TEXT.score, fontSize: '48px' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1400);

    this.pauseButton = new Button(this, VIEW.width - SAFE.side - 44, SAFE.top / 2, 'II', () => this.togglePause(), {
      width: 88,
      height: 88,
      fill: PALETTE.bgTop,
      stroke: PALETTE.primary,
      textColor: CSS.ink,
      fontSize: '36px',
    });
    this.pauseButton.setDepth(1500);
  }

  private buildInput(): void {
    // The whole screen is the jump button, minus the HUD band so the pause
    // button's own tap cannot also launch a jump. Click semantics: the press
    // starts the jump (release semantics would cost ~80ms of precision) and
    // the release cuts it.
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (pointer.y < SAFE.top || this.ended || this.paused) return;
      this.jumpPressedAt = this.time.now;
      this.jumpHeld = true;
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      if (this.jumpHeld) this.cutJump();
    });

    const keyboard = this.input.keyboard;
    keyboard?.on('keydown-SPACE', () => this.pressJumpKey());
    keyboard?.on('keydown-UP', () => this.pressJumpKey());
    keyboard?.on('keyup-SPACE', () => this.cutJump());
    keyboard?.on('keyup-UP', () => this.cutJump());
    keyboard?.on('keydown-ESC', () => this.togglePause());
    keyboard?.on('keydown-P', () => this.togglePause());
  }

  private pressJumpKey(): void {
    if (this.ended || this.paused) return;
    this.jumpPressedAt = this.time.now;
    this.jumpHeld = true;
  }

  /** Text is only touched when its value actually changed. */
  private refreshHud(): void {
    if (this.coins !== this.shownCoins) {
      this.shownCoins = this.coins;
      this.coinText.setText(`COINS ${this.coins}/${this.level.coins.length}`);
    }
    const left = this.director.timeLeftSeconds ?? 0;
    const clock = left >= 10 ? `${Math.ceil(left)}` : left.toFixed(1);
    if (clock !== this.shownTime) {
      this.shownTime = clock;
      this.timeText.setText(clock);
      this.timeText.setColor(left <= 10 ? CSS.bad : CSS.ink);
    }
  }

  private togglePause(): void {
    if (this.ended) return;
    if (this.paused) {
      this.resumeRun();
      return;
    }
    this.paused = true;
    this.director.pause();
    this.physics.world.pause();
    this.pauseOverlay = showPauseOverlay(this, {
      onResume: () => this.resumeRun(),
      onRestart: () => {
        this.pauseOverlay?.destroy();
        this.pauseOverlay = null;
        this.scene.restart({ seed: this.seed });
      },
      onMenu: () => this.quitToMenu(),
    });
  }

  private resumeRun(): void {
    this.paused = false;
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
    this.director.resume();
    this.physics.world.resume();
    // A pause must not bank a jump the player queued before opening it.
    this.jumpPressedAt = -1;
    this.jumpHeld = false;
  }

  /**
   * Abandons the level for the map/menu — the exit the pause overlay's MENU
   * row is. Loops and queued timers die HERE: one firing after `scene.start`
   * touches a scene that no longer exists (the black-screen trap in
   * AGENTS.md).
   */
  private quitToMenu(): void {
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
    this.closeSagaMap();
    this.ended = true;
    this.paused = false;
    this.started = false;
    this.director.pause();
    this.tweens.killAll();
    this.time.removeAllEvents();
    setMusicIntensity(0.2);
    sfx('ui', { volume: 0.4 });
    this.scene.start(SCENES.menu);
  }
}
