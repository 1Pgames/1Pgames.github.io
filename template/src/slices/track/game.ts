import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../../config';
import { EVENTS, SCENES, TEX } from '../../core/keys';
import { Rng } from '../../core/rng';
import { LapDirector } from '../../core/lap';
import type { SessionOutcome } from '../../core/session';
import { sfx } from '../../core/audio';
import { setMusicIntensity, startMusic } from '../../core/music';
import { burst, flash, floatText, pop, shake } from '../../core/juice';
import { Button } from '../../ui/button';
import { addBackground } from '../../ui/background';
import { showPauseOverlay, type PauseOverlayHandle } from '../../ui/pauseOverlay';
import { TRACK_TUNING } from './tuning';
import {
  TRACK_SHAPES,
  advanceRaceProgress,
  botInput,
  buildTrack,
  checkpointHit,
  createRaceProgress,
  createTrackHit,
  isOffTrack,
  nearestOnTrack,
  scaleCarSpec,
  startGrid,
  stepCar,
  trackForwardness,
  type BotProfile,
  type CarInput,
  type CarSpec,
  type CarState,
  type RaceProgress,
  type Track,
  type TrackHit,
  type TrackShapeId,
  type Vec2,
} from './math';

/** Everything one car needs, allocated once in `create` and reused per frame. */
interface Racer {
  label: string;
  car: CarState;
  sprite: Phaser.GameObjects.Image;
  spec: CarSpec;
  /** null for the player's car — it is driven by the thumb. */
  profile: BotProfile | null;
  director: LapDirector;
  hit: TrackHit;
  aim: Vec2;
  input: CarInput;
  progress: RaceProgress;
  /** Mirror of the director's expected checkpoint (it exposes no getter). */
  expected: number;
}

const TRACK_TEXTURE = 'track-surface';

/**
 * LAP RACER — the top-down racing (family E) reference slice.
 *
 * The whole track fits the portrait screen, so the camera never moves: at any
 * moment the player can see the corner they are about to take, every rival, and
 * the line they are missing. That single decision is what makes a one-thumb
 * racer readable, and it is why `tuning.ts` sizes the ellipse to `SAFE`.
 *
 * One thumb, one axis: throttle is automatic and holding the left or right half
 * of the screen steers. Speed is lost by cornering hard and by leaving the
 * tarmac, never by crashing — a stuck car is worse than a slow one.
 *
 * `LapDirector` owns the race: eight ordered checkpoints, three laps, lap
 * times. `math.ts` owns the geometry and the kinematics (pure, headless,
 * raced by `sim/families/track.ts`), and the surface is baked into ONE texture
 * at `create` — a per-frame `Graphics` redraw of a 2k-px polyline is the
 * fastest way to lose the frame budget.
 */
export class GameScene extends Phaser.Scene {
  private seed = '';
  private rng!: Rng;
  private track!: Track;
  private racers: Racer[] = [];
  private player!: Racer;
  private playerMarker!: Phaser.GameObjects.Image;

  private lapText!: Phaser.GameObjects.Text;
  private positionText!: Phaser.GameObjects.Text;
  private lapTimeText!: Phaser.GameObjects.Text;
  private pauseButton!: Button;
  private pauseOverlay: PauseOverlayHandle | null = null;

  private steer = 0;
  /** Pointer id currently holding a steering side, so a second finger cannot fight it. */
  private steerPointer = -1;
  private shownLap = '';
  private shownPosition = '';
  private shownLapTime = '';
  private wrongWayAt = -Number.MAX_VALUE;
  private offTrackPuffAt = 0;
  private paused = false;
  private ended = false;

  constructor() {
    super(SCENES.game);
  }

  /** `scene.start(SCENES.game, { seed })` replays the same track and field. */
  init(data: { seed?: string } = {}): void {
    this.seed = data.seed ?? Date.now().toString(36);
  }

  create(): void {
    this.time.timeScale = 1;
    this.tweens.timeScale = 1;

    this.racers = [];
    this.steer = 0;
    this.steerPointer = -1;
    this.shownLap = '';
    this.shownPosition = '';
    this.shownLapTime = '';
    this.wrongWayAt = -Number.MAX_VALUE;
    this.offTrackPuffAt = 0;
    this.paused = false;
    this.ended = false;
    this.pauseOverlay = null;

    this.rng = new Rng(`${this.seed}:track`);
    const shape: TrackShapeId = this.rng.pick(TRACK_SHAPES);
    this.track = buildTrack(TRACK_TUNING.track, shape);

    addBackground(this, false);
    this.paintTrack();
    this.buildField();
    this.buildHud();
    this.buildInput();
    this.refreshHud();

    this.game.events.emit(EVENTS.runStarted);
    this.cameras.main.fadeIn(220, 0, 0, 0);
    floatText(this, VIEW.centerX, VIEW.centerY, shape.toUpperCase(), CSS.primary, 64);
    startMusic('run');
    setMusicIntensity(0.4);
  }

  update(_time: number, delta: number): void {
    if (this.ended || this.paused) return;

    // Clamped so a dropped frame cannot teleport a car through a checkpoint
    // ring (the only place this sim is discrete rather than continuous).
    const dtS = Math.min(delta, 50) / 1000;
    const timeS = this.player.director.elapsedSeconds;

    for (const racer of this.racers) {
      if (racer.profile === null) {
        racer.input.throttle = 1;
        racer.input.steer = this.steer;
        nearestOnTrack(this.track, racer.car.x, racer.car.y, racer.hit);
      } else {
        botInput(this.track, racer.car, racer.spec, racer.profile, timeS, racer.hit, racer.aim, racer.input);
      }

      stepCar(racer.car, racer.input, racer.spec, this.track, racer.hit, dtS);
      racer.director.update(delta);
      advanceRaceProgress(this.track, racer.hit, racer.progress);
      racer.sprite.setPosition(racer.car.x, racer.car.y).setRotation(racer.car.heading);

      if (checkpointHit(this.track, racer.expected, racer.car)) {
        const passed = racer.director.passCheckpoint(racer.expected);
        if (passed) {
          const wasLine = racer.expected === 0;
          racer.expected = (racer.expected + 1) % TRACK_TUNING.race.checkpoints;
          if (racer.profile === null) this.onPlayerCheckpoint(wasLine);
        }
      }
    }

    this.playerMarker.setPosition(this.player.car.x, this.player.car.y);
    this.watchPlayerSurface();
    this.refreshHud();
    if (this.player.director.ended) this.finish(this.player.director.outcome);
  }

  // --- gameplay -------------------------------------------------------------

  private onPlayerCheckpoint(completedLap: boolean): void {
    if (completedLap) {
      const lap = this.player.director.lap;
      sfx('levelup', { volume: 0.6 });
      flash(this, PALETTE.good, 90);
      floatText(this, VIEW.centerX, VIEW.centerY - 120, `LAP ${lap}`, CSS.good, 56);
      // The race tightens as it runs out: intensity is the lap counter.
      setMusicIntensity(0.4 + ((lap - 1) / TRACK_TUNING.race.laps) * 0.5);
      return;
    }
    sfx('ui', { volume: 0.22, rate: 1.1 });
    pop(this, this.player.sprite, 0.12, 120);
  }

  /**
   * Off-track and wrong-way feedback. Both are throttled: an every-frame puff
   * is a particle flood, and an every-frame nag is unreadable.
   */
  private watchPlayerSurface(): void {
    const now = this.time.now;
    if (isOffTrack(this.track, this.player.hit)) {
      if (now - this.offTrackPuffAt > 180) {
        this.offTrackPuffAt = now;
        burst(this, this.player.car.x, this.player.car.y, PALETTE.inkSoft, 5, 90);
      }
    }

    const forwardness = trackForwardness(this.player.car, this.player.hit);
    if (forwardness < TRACK_TUNING.wrongWayDot && now - this.wrongWayAt > TRACK_TUNING.wrongWayCooldownMs) {
      this.wrongWayAt = now;
      sfx('hit', { volume: 0.3, rate: 0.8 });
      floatText(this, VIEW.centerX, SAFE.top + 80, 'WRONG WAY', CSS.bad, 48);
    }
  }

  /** Race positions: centreline distance covered, highest first. */
  private position(): number {
    let ahead = 0;
    for (const racer of this.racers) {
      if (racer !== this.player && racer.progress.distance > this.player.progress.distance) ahead += 1;
    }
    return ahead + 1;
  }

  private finish(outcome: SessionOutcome | null): void {
    if (this.ended) return;
    this.ended = true;
    this.pauseButton.setVisible(false);
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;

    const position = this.position();
    const won = outcome?.won === true && position === 1;
    const lapTimes = this.player.director.lapTimesMs;
    const bestLapMs = lapTimes.length > 0 ? Math.min(...lapTimes) : 0;
    const score =
      (TRACK_TUNING.scoreByPosition[position - 1] ?? 0) + lapTimes.length * TRACK_TUNING.scorePerLap;
    const currencyEarned = TRACK_TUNING.currencyByPosition[position - 1] ?? 0;

    if (won) {
      sfx('levelup');
      flash(this, PALETTE.good, 220);
      burst(this, this.player.car.x, this.player.car.y, PALETTE.accent, 26, 340);
    } else {
      sfx('die', { volume: 0.5 });
      shake(this, 0.012, 180);
    }
    setMusicIntensity(0.2);
    this.game.events.emit(EVENTS.runEnded, { won, score });

    this.cameras.main.fadeOut(TRACK_TUNING.fadeOutMs, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(SCENES.gameOver, {
        won,
        timeMs: this.player.director.elapsedSeconds * 1000,
        score,
        currencyEarned,
        seed: this.seed,
        stats: [
          { label: 'POSITION', value: `${position}/${this.racers.length}` },
          { label: 'BEST LAP', value: bestLapMs > 0 ? `${(bestLapMs / 1000).toFixed(2)}s` : '-' },
        ],
      });
    });
  }

  // --- world ----------------------------------------------------------------

  /**
   * Bakes the whole surface into one texture: an outer edge band, the tarmac,
   * centre dashes and the start grid. Every join is a filled circle at the
   * waypoint, so the band is smooth without depending on a renderer's line-join
   * behaviour.
   */
  private paintTrack(): void {
    if (this.textures.exists(TRACK_TEXTURE)) this.textures.remove(TRACK_TEXTURE);
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const half = this.track.halfWidth;
    // `fillPoints` wants real Vector2s; this is a one-time bake, so four fresh
    // ones per quad costs nothing that matters.
    const quad = (
      ax: number,
      ay: number,
      bx: number,
      by: number,
      cx: number,
      cy: number,
      dx: number,
      dy: number,
    ): void => {
      g.fillPoints(
        [
          new Phaser.Math.Vector2(ax, ay),
          new Phaser.Math.Vector2(bx, by),
          new Phaser.Math.Vector2(cx, cy),
          new Phaser.Math.Vector2(dx, dy),
        ],
        true,
      );
    };

    const band = (width: number, color: number, alpha: number): void => {
      g.fillStyle(color, alpha);
      for (const segment of this.track.segments) {
        const nx = -segment.dirY * width;
        const ny = segment.dirX * width;
        quad(
          segment.ax + nx,
          segment.ay + ny,
          segment.bx + nx,
          segment.by + ny,
          segment.bx - nx,
          segment.by - ny,
          segment.ax - nx,
          segment.ay - ny,
        );
      }
      // A disc at every waypoint is the join: no reliance on a renderer's
      // line-join behaviour, and the band stays smooth around a hairpin.
      for (const waypoint of this.track.waypoints) g.fillCircle(waypoint.x, waypoint.y, width);
    };

    band(half + 7, PALETTE.primary, 0.5); // kerb
    band(half, TRACK_TUNING.surface.tarmac, 1); // tarmac

    // Centre dashes: cheap motion reference while the camera stays still.
    g.fillStyle(TRACK_TUNING.surface.centreLine, 0.16);
    for (const segment of this.track.segments) {
      const steps = Math.max(2, Math.floor(segment.length / 46));
      for (let i = 0; i < steps; i += 1) {
        const along = ((i + 0.5) / steps) * segment.length;
        g.fillCircle(segment.ax + segment.dirX * along, segment.ay + segment.dirY * along, 3);
      }
    }
    // Every checkpoint gets a marker, so the route the director expects is
    // visible rather than something the player has to infer.
    g.fillStyle(PALETTE.accent, 0.55);
    for (const waypoint of this.track.waypoints) g.fillCircle(waypoint.x, waypoint.y, 6);

    // Start/finish grid: a chequered band across the line.
    const line = this.track.segments[0]!;
    const nx = -line.dirY;
    const ny = line.dirX;
    const cell = (half * 2) / 6;
    for (let i = -3; i < 3; i += 1) {
      g.fillStyle(i % 2 === 0 ? PALETTE.ink : PALETTE.bgDeep, 0.85);
      const near = i * cell;
      const far = near + cell;
      quad(
        line.ax + nx * near,
        line.ay + ny * near,
        line.ax + nx * far,
        line.ay + ny * far,
        line.ax + nx * far + line.dirX * 14,
        line.ay + ny * far + line.dirY * 14,
        line.ax + nx * near + line.dirX * 14,
        line.ay + ny * near + line.dirY * 14,
      );
    }

    g.generateTexture(TRACK_TEXTURE, VIEW.width, VIEW.height);
    g.destroy();
    this.add.image(VIEW.centerX, VIEW.centerY, TRACK_TEXTURE).setDepth(-50);
  }

  private buildField(): void {
    const tints = [PALETTE.primary, PALETTE.secondary, PALETTE.accent, PALETTE.good];
    const profiles: (BotProfile | null)[] = [
      null,
      ...TRACK_TUNING.bots.map((bot) => ({ ...bot, phase: bot.phase + this.rng.float(0, TRACK_TUNING.phaseJitter) })),
    ];
    const grid = startGrid(this.track, profiles.length, []);

    this.racers = profiles.map((profile, index) => {
      const car = grid[index]!;
      const sprite = this.add
        .image(car.x, car.y, TEX.square)
        .setDisplaySize(TRACK_TUNING.car2d.width, TRACK_TUNING.car2d.height)
        .setTint(tints[index] ?? PALETTE.ink)
        .setRotation(car.heading)
        .setDepth(profile === null ? 30 : 20);
      const hit = createTrackHit();
      nearestOnTrack(this.track, car.x, car.y, hit);
      return {
        label: profile === null ? 'YOU' : `CPU${index}`,
        car,
        sprite,
        spec: scaleCarSpec(TRACK_TUNING.car, profile?.speedMul ?? 1),
        profile,
        director: new LapDirector(TRACK_TUNING.race),
        hit,
        aim: { x: 0, y: 0 },
        input: { throttle: 0, steer: 0 },
        progress: createRaceProgress(hit),
        // The race starts ON the line, so checkpoint 1 is what comes next.
        expected: 1,
      };
    });

    this.player = this.racers[0]!;
    // A ring under the player's car: with four near-identical rectangles on
    // screen, "which one am I" has to be answerable at a glance. It is moved
    // with the car every frame — a marker left on the start line is worse than
    // no marker at all.
    this.playerMarker = this.add
      .image(this.player.car.x, this.player.car.y, TEX.ring)
      .setDisplaySize(58, 58)
      .setTint(PALETTE.ink)
      .setAlpha(0.35)
      .setDepth(29);
  }

  // --- shell ----------------------------------------------------------------

  private buildHud(): void {
    this.lapText = this.add
      .text(SAFE.side, SAFE.top / 2, '', { ...TEXT.heading, fontSize: '40px' })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(1400);
    this.positionText = this.add
      .text(SAFE.side, SAFE.top / 2 + 46, '', TEXT.label)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(1400);
    this.lapTimeText = this.add
      .text(VIEW.width - SAFE.side - 100, SAFE.top / 2 + 46, '', TEXT.label)
      .setOrigin(1, 0.5)
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

    this.add
      .text(VIEW.centerX, VIEW.height - SAFE.bottom / 2, 'HOLD LEFT / RIGHT TO STEER', TEXT.label)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setAlpha(0.5)
      .setDepth(1400);
  }

  private buildInput(): void {
    // Steering is a HOLD, so it arms on POINTER_DOWN (release semantics would
    // make every corner start late) and only the pointer that armed it can
    // change or release it — a second thumb must not steal the wheel.
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (this.ended || this.paused || pointer.y < SAFE.top) return;
      this.steerPointer = pointer.id;
      this.steer = pointer.x < VIEW.centerX ? -1 : 1;
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.steerPointer || !pointer.isDown) return;
      this.steer = pointer.x < VIEW.centerX ? -1 : 1;
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.steerPointer) return;
      this.steerPointer = -1;
      this.steer = 0;
    });

    const keyboard = this.input.keyboard;
    keyboard?.on('keydown-LEFT', () => {
      this.steer = -1;
    });
    keyboard?.on('keydown-RIGHT', () => {
      this.steer = 1;
    });
    keyboard?.on('keyup-LEFT', () => {
      if (this.steer < 0) this.steer = 0;
    });
    keyboard?.on('keyup-RIGHT', () => {
      if (this.steer > 0) this.steer = 0;
    });
    keyboard?.on('keydown-ESC', () => this.togglePause());
    keyboard?.on('keydown-P', () => this.togglePause());
  }

  /** Text is only touched when its value actually changed. */
  private refreshHud(): void {
    const lap = `LAP ${this.player.director.lap}/${TRACK_TUNING.race.laps}`;
    if (lap !== this.shownLap) {
      this.shownLap = lap;
      this.lapText.setText(lap);
    }
    const position = `POS ${this.position()}/${this.racers.length}`;
    if (position !== this.shownPosition) {
      this.shownPosition = position;
      this.positionText.setText(position);
    }
    const lapTime = `${(this.player.director.currentLapMs / 1000).toFixed(1)}s`;
    if (lapTime !== this.shownLapTime) {
      this.shownLapTime = lapTime;
      this.lapTimeText.setText(lapTime);
    }
  }

  private togglePause(): void {
    if (this.ended) return;
    if (this.paused) {
      this.resumeRun();
      return;
    }
    this.paused = true;
    this.steer = 0;
    this.steerPointer = -1;
    for (const racer of this.racers) racer.director.pause();
    this.game.events.emit(EVENTS.paused);
    this.pauseOverlay = showPauseOverlay(
      this,
      () => this.resumeRun(),
      () => {
        // RESTART from the pause overlay is the only DNF in this slice.
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
    for (const racer of this.racers) racer.director.resume();
    this.game.events.emit(EVENTS.resumed);
  }
}
