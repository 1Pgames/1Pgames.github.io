import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../../config';
import { EVENTS, SCENES, TEX } from '../../core/keys';
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
import { SIDE_TUNING } from './tuning';
import { SIDE_LEVEL_COUNT, SIDE_PROGRESS_KEY, buildSideLevel, clampLevelIndex, sideLevelSpec } from './levels';
import type { SideLevel } from './gen';

const SIDE_SKY = 'side-sky';

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

  constructor() {
    super(SCENES.game);
  }

  /** `scene.start(SCENES.game, { seed })` replays the exact same level layout. */
  init(data: { seed?: string } = {}): void {
    this.seed = data.seed ?? Date.now().toString(36);
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
    this.pauseOverlay = null;

    this.levelIndex = clampLevelIndex(load<number>(SIDE_PROGRESS_KEY, 0));
    // One layout per (run seed, level): a retry replays it jump for jump, and
    // the sim generates the identical level from the same two numbers.
    this.level = buildSideLevel(this.levelIndex, this.seed);
    this.rng = new Rng(`${this.seed}:side:${this.levelIndex}:view`);
    this.director = new LevelDirector(sideLevelSpec(this.levelIndex), {
      onEnd: (outcome) => this.resolve(outcome),
    });

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
    this.buildWorld();
    this.buildPlayer();
    this.buildHud();
    this.buildInput();
    this.refreshHud();

    this.game.events.emit(EVENTS.runStarted);
    this.cameras.main.fadeIn(180, 0, 0, 0);
    startMusic('run');
    setMusicIntensity(0.35 + (this.levelIndex / SIDE_LEVEL_COUNT) * 0.4);
  }

  update(time: number, delta: number): void {
    if (this.ended || this.paused) return;

    this.director.update(delta);
    if (this.ended) return;

    // Auto-run: re-asserted every frame because a collision separation can
    // zero the x velocity against a platform wall.
    this.player.setVelocityX(SIDE_TUNING.motion.moveSpeed);

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const grounded = body.blocked.down || body.touching.down;
    if (grounded) this.lastGroundedAt = time;

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

    // Instant retry of the SAME level: the fade runs on the raw frame delta, so
    // death → playing again stays inside the 600ms budget. `reason` is only
    // feedback here; the level index in storage is untouched.
    floatText(this, this.player.x, this.player.y - 60, reason === 'void' ? 'MISSED' : 'OUCH', CSS.bad, 44);
    this.cameras.main.fadeOut(SIDE_TUNING.deathHoldMs, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ seed: this.seed });
    });
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

  /** Called by `LevelDirector.onEnd` — the only place a run resolves. */
  private resolve(outcome: SessionOutcome): void {
    if (this.ended) return;
    if (!outcome.won) {
      // Out of time: the same instant-retry loop as a hazard death.
      this.die(outcome.reason);
      return;
    }
    this.ended = true;
    this.pauseButton.setVisible(false);
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;

    const nextIndex = Math.min(this.levelIndex + 1, SIDE_LEVEL_COUNT - 1);
    save(SIDE_PROGRESS_KEY, nextIndex);

    const timeMs = this.director.elapsedSeconds * 1000;
    const score = this.coins * SIDE_TUNING.coin.score + SIDE_TUNING.exitScore;
    this.game.events.emit(EVENTS.runEnded, { won: true, score });

    this.cameras.main.fadeOut(SIDE_TUNING.fadeOutMs, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(SCENES.gameOver, {
        won: true,
        timeMs,
        score,
        currencyEarned: Math.floor(this.coins / SIDE_TUNING.coin.perCurrency) + this.director.stars * 2,
        seed: this.seed,
        stats: [
          { label: 'LEVEL', value: `${this.levelIndex + 1}/${SIDE_LEVEL_COUNT}` },
          { label: 'COINS', value: `${this.coins}/${this.level.coins.length}` },
          { label: 'TIME', value: `${this.director.elapsedSeconds.toFixed(1)}s` },
        ],
      });
    });
  }

  // --- world ----------------------------------------------------------------

  private buildWorld(): void {
    const level = this.level;
    this.physics.world.setBounds(0, 0, level.worldWidth, level.worldHeight);
    this.cameras.main.setBounds(0, 0, level.worldWidth, level.worldHeight);

    this.platforms = this.physics.add.staticGroup();
    for (const platform of level.platforms) {
      const body = this.physics.add
        .staticImage(platform.x + platform.w / 2, platform.y + platform.h / 2, TEX.square)
        // STATIC BODY TRAP: the body is rebuilt from `displayWidth/Height`, so
        // the size must be set BEFORE `refreshBody()` — the other order leaves
        // a 96x96 body on a 400x240 platform and the hero walks on thin air.
        .setDisplaySize(platform.w, platform.h)
        .refreshBody();
      body.setTint(platform.ground ? PALETTE.bgTop : PALETTE.primary).setDepth(10);
      if (platform.ground) body.setAlpha(0.95);
      this.platforms.add(body);

      // A bright lip on the walkable surface: the one line the eye reads while
      // running, drawn once as a static rectangle (never a per-frame redraw).
      this.add
        .rectangle(platform.x + platform.w / 2, platform.y + 3, platform.w, 6, PALETTE.primary, 0.85)
        .setDepth(11);
    }

    this.hazards = this.physics.add.staticGroup();
    for (const spike of level.spikes) {
      const image = this.physics.add
        .staticImage(spike.x + spike.w / 2, spike.y + spike.h / 2, TEX.spike)
        .setDisplaySize(spike.w, spike.h)
        .refreshBody();
      image.setTint(PALETTE.bad).setDepth(12);
      this.hazards.add(image);
    }

    this.pickups = this.physics.add.staticGroup();
    for (const coin of level.coins) {
      const image = this.physics.add
        .staticImage(coin.x, coin.y, TEX.star)
        .setDisplaySize(SIDE_TUNING.coin.size, SIDE_TUNING.coin.size)
        .refreshBody();
      image.setTint(PALETTE.accent).setDepth(14);
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
    this.door = this.physics.add
      .staticImage(level.exit.x, level.exit.y - exit.height / 2, TEX.square)
      .setDisplaySize(exit.width, exit.height)
      .refreshBody();
    this.door.setTint(PALETTE.good).setDepth(9).setAlpha(0.9);
    this.add
      .image(level.exit.x, level.exit.y - exit.height / 2, TEX.ring)
      .setDisplaySize(exit.width * 0.7, exit.width * 0.7)
      .setTint(PALETTE.ink)
      .setDepth(10);
  }

  private buildPlayer(): void {
    const size = SIDE_TUNING.player.size;
    // The generator models the hero as a POINT AT ITS FEET, so the sprite
    // centre sits half a body above the surface it spawns on.
    this.player = this.physics.add.image(this.level.spawn.x, this.level.spawn.y - size / 2, TEX.square);
    this.player.setDisplaySize(size, size).setVisible(false);
    this.skin = this.add
      .image(this.player.x, this.player.y, TEX.square)
      .setDisplaySize(size, size)
      .setTint(PALETTE.secondary)
      .setDepth(20);
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
    this.game.events.emit(EVENTS.paused);
    this.pauseOverlay = showPauseOverlay(
      this,
      () => this.resumeRun(),
      () => {
        this.pauseOverlay?.destroy();
        this.pauseOverlay = null;
        this.scene.restart({ seed: this.seed });
      },
    );
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
    this.game.events.emit(EVENTS.resumed);
  }
}
