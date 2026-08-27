import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../../config';
import { EVENTS, SCENES, TEX } from '../../core/keys';
import { Rng } from '../../core/rng';
import { Pool } from '../../core/pool';
import { RampDirector } from '../../core/ramp';
import { sfx } from '../../core/audio';
import { setMusicIntensity, startMusic } from '../../core/music';
import { flash, floatText, hitstop, pop, shake } from '../../core/juice';
import { buildGradient } from '../../core/textures';
import { Button } from '../../ui/button';
import { showPauseOverlay, type PauseOverlayHandle } from '../../ui/pauseOverlay';
import { HYPER_TUNING } from './tuning';
import { createTower, placeSlab, slabSpeed, travelBounds, type StackTower } from './stack';

const SKY = 'hyper-sky';
/** Screen y the tower top is pinned to: the tower scrolls, the action line never moves. */
const ACTION_Y = Math.round(VIEW.height * HYPER_TUNING.actionLineRatio);

/**
 * STACK TOWER — the hypercasual (family J) reference slice.
 *
 * One verb, whole screen: a slab slides across the action line and a tap drops
 * it. Overlap becomes the new top, the overhang shears off, a miss ends the
 * run. `RampDirector` turns score into slide speed, so difficulty comes from the
 * player's own progress rather than a clock, and the death → results → retry
 * loop stays under ~600ms.
 *
 * All geometry decisions live in `stack.ts` (pure, headless-testable), all
 * numbers in `tuning.ts`. This scene only renders them and adds feel.
 */
export class GameScene extends Phaser.Scene {
  private rng!: Rng;
  private seed = '';
  private director!: RampDirector;
  private tower!: StackTower;

  /** Everything that scrolls: placed slabs, the sliding slab, falling overhang. */
  private layer!: Phaser.GameObjects.Container;
  private mover!: Phaser.GameObjects.Image;
  private slabPool!: Pool<Phaser.GameObjects.Image>;
  private piecePool!: Pool<Phaser.GameObjects.Image>;
  private readonly rows: Phaser.GameObjects.Image[] = [];

  private scoreText!: Phaser.GameObjects.Text;
  private statText!: Phaser.GameObjects.Text;
  private pauseButton!: Button;
  private pauseOverlay: PauseOverlayHandle | null = null;

  private direction = 1;
  private shownScore = -1;
  private shownStats = '';
  private paused = false;
  private ended = false;

  constructor() {
    super(SCENES.game);
  }

  /** `scene.start(SCENES.game, { seed })` replays the same run (RETRY on results). */
  init(data: { seed?: string } = {}): void {
    this.seed = data.seed ?? Date.now().toString(36);
  }

  create(): void {
    // A previous run may have died mid-hitstop; scene restart keeps the Time
    // system's timeScale, so a stale 0.05 would freeze the fresh run.
    this.time.timeScale = 1;
    this.tweens.timeScale = 1;

    this.rng = new Rng(this.seed);
    this.rows.length = 0;
    this.pauseOverlay = null;
    this.paused = false;
    this.ended = false;
    this.shownScore = -1;
    this.shownStats = '';

    this.drawBackdrop();

    this.tower = createTower(HYPER_TUNING.stack, VIEW.centerX);
    this.layer = this.add.container(0, 0).setDepth(10);

    this.slabPool = new Pool<Phaser.GameObjects.Image>(
      () => this.makeSlab(),
      (slab) => slab.setVisible(false).setActive(false),
      HYPER_TUNING.visibleRows,
    );
    this.piecePool = new Pool<Phaser.GameObjects.Image>(
      () => this.makeSlab(),
      (piece) => piece.setVisible(false).setActive(false).setAlpha(1).setAngle(0),
      HYPER_TUNING.maxFallingPieces,
    );

    // Row 0 is the foundation: it is placed, not dropped, and never scores.
    this.addRow(0, this.tower.topX, this.tower.width);

    this.mover = this.makeSlab();
    this.armMover();

    this.director = new RampDirector(HYPER_TUNING.ramp, {
      onStep: (_step, difficulty) => {
        // Only on a step, never per frame: setMusicIntensity re-mixes the bed.
        setMusicIntensity(Math.min(1, 0.3 + difficulty * 0.2));
        sfx('whoosh', { volume: 0.35 });
      },
      onEnd: () => this.finish(),
    });

    this.buildHud();

    // The whole screen is the button. Arm on POINTER_DOWN so the drop lands on
    // the frame the finger touches (release semantics would cost ~80ms of
    // timing precision), and keep the HUD band out of it so the pause button's
    // own tap cannot also drop a slab.
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (pointer.y < SAFE.top) return;
      this.drop();
    });
    this.input.keyboard?.on('keydown-SPACE', () => this.drop());
    this.input.keyboard?.on('keydown-ESC', () => this.togglePause());
    this.input.keyboard?.on('keydown-P', () => this.togglePause());

    this.game.events.emit(EVENTS.runStarted);
    this.cameras.main.fadeIn(200, 0, 0, 0);

    startMusic('run');
    setMusicIntensity(0.5);
  }

  update(_time: number, delta: number): void {
    if (this.ended || this.paused) return;

    this.director.update(delta);

    const speed = slabSpeed(HYPER_TUNING.baseSpeed, HYPER_TUNING.speedPerDifficulty, this.director.difficulty);
    const bounds = travelBounds(this.tower.width, VIEW.width);
    let x = this.mover.x + this.direction * speed * (delta / 1000);
    if (x <= bounds.minX) {
      x = bounds.minX;
      this.direction = 1;
    } else if (x >= bounds.maxX) {
      x = bounds.maxX;
      this.direction = -1;
    }
    this.mover.x = x;

    this.refreshHud();
  }

  // --- gameplay -------------------------------------------------------------

  private drop(): void {
    if (this.ended || this.paused) return;

    const dropX = this.mover.x;
    const dropW = this.tower.width;
    const result = placeSlab(this.tower, HYPER_TUNING.stack, dropX);

    if (result.miss) {
      this.mover.setVisible(false);
      this.spawnPiece(dropX, this.mover.y, dropW, result.trimSide, this.rowColor(this.tower.height + 1));
      this.director.fail(this.tower.failure);
      return;
    }

    const row = this.tower.height;
    const slab = this.addRow(row, result.overlapX, this.tower.width);
    this.scrollTo(row);

    if (result.perfect) {
      this.director.addScore(HYPER_TUNING.scorePerDrop + HYPER_TUNING.scorePerPerfect);
      sfx('combo');
      flash(this, PALETTE.good, 90);
      pop(this, slab, 0.16, 200);
      floatText(this, result.overlapX, ACTION_Y - HYPER_TUNING.slabHeight * 1.6, 'PERFECT', CSS.good, 46);
    } else {
      this.director.addScore(HYPER_TUNING.scorePerDrop);
      sfx('tap', { volume: 0.45 });
      pop(this, slab, 0.08, 140);
      this.spawnPiece(result.trimX, slab.y, result.trimmed, result.trimSide, this.rowColor(row));
    }

    if (!this.tower.alive) {
      // Trimmed below minWidth: the tower topples on the drop that shaved it.
      this.mover.setVisible(false);
      this.director.fail(this.tower.failure);
      return;
    }

    this.armMover();
  }

  /** Adds (or recycles) a placed slab at tower row `row`. */
  private addRow(row: number, x: number, width: number): Phaser.GameObjects.Image {
    const slab = this.slabPool.obtain();
    slab
      .setActive(true)
      .setVisible(true)
      .setPosition(x, ACTION_Y - row * HYPER_TUNING.slabHeight)
      .setDisplaySize(width, HYPER_TUNING.slabHeight)
      .setTint(this.rowColor(row))
      .setAlpha(1);
    this.rows.push(slab);
    // Rows scrolled off the bottom go back to the pool instead of piling up.
    while (this.rows.length > HYPER_TUNING.visibleRows) {
      const oldest = this.rows.shift();
      if (oldest) this.slabPool.release(oldest);
    }
    return slab;
  }

  /** Slides the tower down one row so the new top sits on the action line. */
  private scrollTo(row: number): void {
    const target = row * HYPER_TUNING.slabHeight;
    this.tweens.killTweensOf(this.layer);
    this.tweens.add({ targets: this.layer, y: target, duration: 120, ease: 'Quad.easeOut' });
  }

  /** Re-widths the sliding slab, parks it on the far side and lets it run. */
  private armMover(): void {
    const bounds = travelBounds(this.tower.width, VIEW.width);
    this.direction = this.mover.x > VIEW.centerX ? -1 : 1;
    this.mover
      .setActive(true)
      .setVisible(true)
      .setPosition(this.direction === 1 ? bounds.minX : bounds.maxX, this.moverRowY())
      .setDisplaySize(this.tower.width, HYPER_TUNING.slabHeight)
      .setTint(this.rowColor(this.tower.height + 1))
      .setAlpha(1);
  }

  /** Local y of the row above the current top — where the sliding slab lives. */
  private moverRowY(): number {
    return ACTION_Y - (this.tower.height + 1) * HYPER_TUNING.slabHeight;
  }

  /** Pooled overhang: a quick fall + fade, capped so a fast player cannot flood it. */
  private spawnPiece(x: number, y: number, width: number, side: -1 | 0 | 1, tint: number): void {
    if (width <= 1 || this.piecePool.active >= HYPER_TUNING.maxFallingPieces) return;
    const piece = this.piecePool.obtain();
    piece
      .setActive(true)
      .setVisible(true)
      .setPosition(x, y)
      .setDisplaySize(width, HYPER_TUNING.slabHeight)
      .setTint(tint)
      .setAlpha(1)
      .setAngle(0);
    this.tweens.add({
      targets: piece,
      y: y + VIEW.height * 0.7,
      x: x + side * 40,
      angle: side * 60,
      alpha: 0,
      duration: HYPER_TUNING.fallMs,
      ease: 'Quad.easeIn',
      onComplete: () => this.piecePool.release(piece),
    });
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
    this.pauseButton.setVisible(false);

    sfx('die');
    flash(this, PALETTE.bad, 200);
    shake(this, 0.02, 220);
    hitstop(this, HYPER_TUNING.hitstopMs);
    setMusicIntensity(0.15);

    const score = this.director.score;
    const timeMs = this.director.elapsedSeconds * 1000;
    this.game.events.emit(EVENTS.runEnded, { won: false, score });

    // Camera effects run on the raw frame delta, so the transition is not
    // stretched by the hitstop's time scale — death to results stays < 600ms.
    this.cameras.main.fadeOut(HYPER_TUNING.fadeOutMs, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(SCENES.gameOver, {
        won: false,
        timeMs,
        score,
        currencyEarned: Math.floor(score / HYPER_TUNING.scorePerCurrency),
        seed: this.seed,
        stats: [
          { label: 'HEIGHT', value: `${this.tower.height}` },
          { label: 'PERFECT', value: `${this.tower.perfects}` },
        ],
      });
    });
  }

  // --- shell ----------------------------------------------------------------

  private drawBackdrop(): void {
    buildGradient(this, SKY, PALETTE.bgTop, PALETTE.bgDeep);
    this.add.image(VIEW.centerX, VIEW.centerY, SKY).setDisplaySize(VIEW.width, VIEW.height).setDepth(-100);

    // Seeded drifting motes: the only randomness on screen, so the same seed
    // replays the same picture as well as the same run.
    for (let i = 0; i < 10; i += 1) {
      const depth = this.rng.float(0.35, 1);
      const mote = this.add
        .image(this.rng.float(0, VIEW.width), this.rng.float(0, VIEW.height), TEX.particle)
        .setScale(depth * 0.6)
        .setAlpha(depth * 0.22)
        .setTint(PALETTE.primary)
        .setDepth(-90);
      this.tweens.add({
        targets: mote,
        y: mote.y - VIEW.height,
        duration: (VIEW.height / (12 * depth)) * 1000,
        repeat: -1,
        onRepeat: () => {
          mote.y = VIEW.height + 20;
        },
      });
    }

    // The action line: where the tower top always is, so the eye has an anchor.
    this.add
      .rectangle(VIEW.centerX, ACTION_Y - HYPER_TUNING.slabHeight / 2, VIEW.width, 2, PALETTE.primary, 0.12)
      .setDepth(5);
  }

  private makeSlab(): Phaser.GameObjects.Image {
    const slab = this.add.image(0, 0, TEX.square).setVisible(false).setActive(false);
    this.layer.add(slab);
    return slab;
  }

  private rowColor(row: number): number {
    const colors = HYPER_TUNING.colors;
    return colors[((row % colors.length) + colors.length) % colors.length] ?? colors[0];
  }

  private buildHud(): void {
    this.scoreText = this.add
      .text(VIEW.centerX, SAFE.top / 2 - 6, '0', TEXT.score)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1400);
    this.statText = this.add
      .text(VIEW.centerX, SAFE.top / 2 + 46, '', TEXT.label)
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

    this.refreshHud();
  }

  /** Text is only touched when its value actually changed. */
  private refreshHud(): void {
    const score = this.director.score;
    if (score !== this.shownScore) {
      this.shownScore = score;
      this.scoreText.setText(`${score}`);
    }
    const stats = `HEIGHT ${this.tower.height}   PERFECT ${this.tower.perfects}`;
    if (stats !== this.shownStats) {
      this.shownStats = stats;
      this.statText.setText(stats);
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
    this.game.events.emit(EVENTS.paused);
    this.pauseOverlay = showPauseOverlay(
      this,
      () => this.resumeRun(),
      () => {
        this.pauseOverlay?.destroy();
        this.pauseOverlay = null;
        this.scene.start(SCENES.game);
      },
    );
  }

  private resumeRun(): void {
    this.paused = false;
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
    this.director.resume();
    this.game.events.emit(EVENTS.resumed);
  }
}
