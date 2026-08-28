import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../../config';
import { SCENES, TEX } from '../../core/keys';
import { Rng } from '../../core/rng';
import { Pool } from '../../core/pool';
import { RampDirector } from '../../core/ramp';
import { sfx } from '../../core/audio';
import { setMusicIntensity, startMusic } from '../../core/music';
import { flash, floatText, hitstop, pop, shake } from '../../core/juice';
import { buildGradient } from '../../core/textures';
import { Button } from '../../ui/button';
import { showPauseOverlay, type PauseOverlayHandle } from '../../ui/pauseOverlay';
import { drawPanel } from '../../ui/primitives';
import { addToCollection, loadMeta, ownedPieces, touchDailyStreak } from '../../core/progression';
import { load, save } from '../../core/storage';
import type { ArtSlot } from '../../data/art';
import { HYPER_SKIN_SET, HYPER_TUNING, type HyperSkin } from './tuning';
import { createTower, placeSlab, slabSpeed, travelBounds, type StackTower } from './stack';

/** `meta_skin_pack` in the hyper catalog (`data/metaCatalog.ts`). */
const PERK_SKIN_PACK = 'meta_skin_pack';
/** `meta_slow_start` in the same catalog. */
const PERK_SLOW_START = 'meta_slow_start';

/**
 * Art groups `PreloadScene` loads for this slice (see the slice-wiring guide).
 * `hyper-skins` is the slab sheet; while that group ships no art the tower's
 * banding comes from the skin palettes instead.
 */
export const ART_GROUPS = ['ui', 'bg', 'hyper-skins'] as const;

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
 *
 * Meta layer: the six slab colourways are a collection set. Beating a
 * milestone score grants the next one, the `meta_skin_pack` perk unlocks one
 * per level outright, and a small picker before the first tap lets the player
 * choose between the ones they own (the choice is persisted, so it survives
 * the instant-retry loop).
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

  /** Skin chosen for this run; its palette bands the tower. */
  private skin: HyperSkin = HYPER_TUNING.skins[0] as HyperSkin;
  /** Resolved once per run: null means "tint the procedural slab". */
  private slabSlot: ArtSlot | null = null;
  /** Multiplier applied to the slide speed for the first `slowStart.seconds`. */
  private slowStartMul = 1;
  /** While the picker is open the run is armed but not live. */
  private awaitingSkinPick = false;

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
    this.awaitingSkinPick = false;

    // The default colourway is owned by definition; granting it on entry keeps
    // the collection screen honest instead of showing 0/6 to a new player.
    const firstSkin = HYPER_TUNING.skins[0] as HyperSkin;
    addToCollection(HYPER_SKIN_SET.id, firstSkin.id, HYPER_SKIN_SET.pieces.length);
    this.applySkinPackPerk();
    this.skin = this.storedSkin();
    this.slabSlot = this.resolveSlot(HYPER_TUNING.art.slab);

    // `meta_slow_start` only touches the opening seconds; the ceiling — where a
    // score-chase run is actually decided — is untouched.
    const slowLevel = loadMeta().upgrades[PERK_SLOW_START] ?? 0;
    this.slowStartMul = Math.max(0.4, 1 - slowLevel * HYPER_TUNING.slowStart.speedMulPerLevel);

    this.markDailyStreak();

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

    this.cameras.main.fadeIn(200, 0, 0, 0);

    startMusic('run');
    setMusicIntensity(0.5);

    // The picker only appears when there is a choice to make.
    if (ownedPieces(HYPER_SKIN_SET.id).length > 1) this.openSkinPicker();
  }

  /** Advances the daily streak once per entry; celebrates only real growth. */
  private markDailyStreak(): void {
    const streak = touchDailyStreak();
    if (!streak.extended) return;
    this.time.delayedCall(480, () => {
      floatText(this, VIEW.centerX, SAFE.top + 90, `DAY ${streak.days} STREAK!`, CSS.accent, 46);
      sfx('combo', { volume: 0.5 });
    });
  }

  // --- skins ----------------------------------------------------------------

  /**
   * `meta_skin_pack`: each purchased level hands over the next locked
   * colourway outright, in definition order, so the perk is a shortcut through
   * the milestone ladder rather than a second currency.
   */
  private applySkinPackPerk(): void {
    const levels = loadMeta().upgrades[PERK_SKIN_PACK] ?? 0;
    if (levels <= 0) return;
    let granted = 0;
    for (const skin of HYPER_TUNING.skins) {
      if (granted >= levels) return;
      const result = addToCollection(HYPER_SKIN_SET.id, skin.id, HYPER_SKIN_SET.pieces.length);
      if (result.added) granted += 1;
    }
  }

  /** The persisted choice, falling back to the default when it is not owned. */
  private storedSkin(): HyperSkin {
    const owned = ownedPieces(HYPER_SKIN_SET.id);
    const storedId = load<string>(HYPER_TUNING.skinStoreKey, '');
    const stored = HYPER_TUNING.skins.find((skin) => skin.id === storedId && owned.includes(skin.id));
    return stored ?? (HYPER_TUNING.skins[0] as HyperSkin);
  }

  /**
   * Pre-run colourway picker: one row of owned swatches, tapped to choose. The
   * run is armed behind it (`awaitingSkinPick` swallows the drop) so the first
   * tap after the pick is a slab, not a wasted one.
   */
  private openSkinPicker(): void {
    this.awaitingSkinPick = true;
    const owned = ownedPieces(HYPER_SKIN_SET.id);
    const choices = HYPER_TUNING.skins.filter((skin) => owned.includes(skin.id));

    const root = this.add.container(0, 0).setDepth(2300).setScrollFactor(0);
    const dim = this.add
      .rectangle(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height, 0x000000, 0.6)
      .setScrollFactor(0)
      .setInteractive();
    const panelHeight = 300;
    const panel = drawPanel(this, VIEW.width - SAFE.side * 2, panelHeight, {
      fill: PALETTE.bgTop,
      fillAlpha: 0.97,
      stroke: PALETTE.primary,
      radius: 30,
    })
      .setPosition(VIEW.centerX, VIEW.centerY)
      .setScrollFactor(0);
    const heading = this.add
      .text(VIEW.centerX, VIEW.centerY - panelHeight / 2 + 46, 'COLOURWAY', {
        ...TEXT.heading,
        fontSize: '40px',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    root.add([dim, panel, heading]);

    const close = (): void => {
      root.destroy(true);
      this.awaitingSkinPick = false;
    };

    // Swatch chips: three per row, each a 96px tap target (>= the 88px floor).
    const perRow = 3;
    const chip = 96;
    const gap = 24;
    choices.forEach((skin, index) => {
      const row = Math.floor(index / perRow);
      const column = index % perRow;
      const rowCount = Math.min(perRow, choices.length - row * perRow);
      const rowWidth = rowCount * chip + (rowCount - 1) * gap;
      const x = VIEW.centerX - rowWidth / 2 + chip / 2 + column * (chip + gap);
      const y = VIEW.centerY - 10 + row * (chip + gap);
      const swatch = this.add
        .image(x, y, TEX.square)
        .setDisplaySize(chip, chip)
        .setTint(skin.colors[0] ?? PALETTE.primary)
        .setScrollFactor(0)
        .setInteractive();
      const ring = this.add
        .image(x, y, TEX.ring)
        .setDisplaySize(chip + 14, chip + 14)
        .setTint(PALETTE.ink)
        .setAlpha(skin.id === this.skin.id ? 0.9 : 0.15)
        .setScrollFactor(0);
      // Click semantics (AGENTS.md): arm on this chip's own POINTER_DOWN and
      // disarm on POINTER_OUT, so releasing a stray drag never picks a skin.
      let armed = false;
      swatch.on(Phaser.Input.Events.POINTER_DOWN, () => {
        armed = true;
      });
      swatch.on(Phaser.Input.Events.POINTER_OUT, () => {
        armed = false;
      });
      swatch.on(Phaser.Input.Events.POINTER_UP, () => {
        if (!armed) return;
        armed = false;
        this.chooseSkin(skin);
        close();
      });
      root.add([swatch, ring]);
    });

    const keep = new Button(this, VIEW.centerX, VIEW.centerY + panelHeight / 2 + 76, 'PLAY', () => close(), {
      width: VIEW.width - SAFE.side * 2,
      height: 104,
    });
    keep.setScrollFactor(0);
    root.add(keep);
  }

  /** Applies and PERSISTS a pick, then repaints the tower that is already up. */
  private chooseSkin(skin: HyperSkin): void {
    this.skin = skin;
    save(HYPER_TUNING.skinStoreKey, skin.id);
    sfx('ui');
    for (let row = 0; row < this.rows.length; row += 1) {
      this.paintSlab(this.rows[row] as Phaser.GameObjects.Image, row);
    }
    this.paintSlab(this.mover, this.tower.height + 1);
    floatText(this, VIEW.centerX, ACTION_Y - HYPER_TUNING.slabHeight * 2, skin.name, CSS.accent, 44);
  }

  /**
   * The slot to draw a slab with, or `null` for the procedural square. A slot
   * whose texture never loaded resolves to `null`, so a pruned art group leaves
   * the palette-tinted fallback rather than a green box.
   */
  private resolveSlot(slot: ArtSlot | null): ArtSlot | null {
    if (slot === null) return null;
    return this.textures.exists(slot.key) ? slot : null;
  }

  update(_time: number, delta: number): void {
    if (this.ended || this.paused || this.awaitingSkinPick) return;

    this.director.update(delta);

    // The opening seconds can be slowed by `meta_slow_start`; everything past
    // them runs at the ramp's own speed.
    const opening = this.director.elapsedSeconds < HYPER_TUNING.slowStart.seconds;
    const speed =
      slabSpeed(HYPER_TUNING.baseSpeed, HYPER_TUNING.speedPerDifficulty, this.director.difficulty) *
      (opening ? this.slowStartMul : 1);
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
    if (this.ended || this.paused || this.awaitingSkinPick) return;

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
      .setAlpha(1);
    this.paintSlab(slab, row);
    slab.setDisplaySize(width, HYPER_TUNING.slabHeight);
    this.rows.push(slab);
    // Rows scrolled off the bottom go back to the pool instead of piling up.
    while (this.rows.length > HYPER_TUNING.visibleRows) {
      const oldest = this.rows.shift();
      if (oldest) this.slabPool.release(oldest);
    }
    return slab;
  }

  /**
   * Skins one slab for its row. With the art slot resolved the slab wears the
   * generated texture and NO tint (generated art carries its own colour, see
   * AGENTS.md); otherwise it is the procedural square banded by the active
   * skin's palette. A pooled slab is re-textured on every reuse, or it would
   * keep the previous run's skin.
   */
  private paintSlab(slab: Phaser.GameObjects.Image, row: number): void {
    const slot = this.slabSlot;
    if (slot !== null) {
      slab.setTexture(slot.key, slot.frame).clearTint();
      return;
    }
    slab.setTexture(TEX.square).setTint(this.rowColor(row));
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
      .setAlpha(1);
    this.paintSlab(this.mover, this.tower.height + 1);
    this.mover.setDisplaySize(this.tower.width, HYPER_TUNING.slabHeight);
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
    const unlocked = this.grantMilestoneSkins(score);

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
          ...(unlocked === null ? [] : [{ label: 'UNLOCKED', value: unlocked }]),
        ],
        // A score chase has no win state: the tower coming down IS the result.
        headline: 'TOWER DOWN',
        timeLabel: 'SURVIVED',
        bestTimeMode: 'max',
      });
    });
  }

  /**
   * Grants every colourway this run's score reached. Milestone `n` pays out
   * `skins[n + 1]`, so the ladder is the same for everyone and a big run can
   * clear several rungs at once. Returns the last skin unlocked, for the
   * results row.
   */
  private grantMilestoneSkins(score: number): string | null {
    let unlocked: string | null = null;
    HYPER_TUNING.skinMilestones.forEach((threshold, index) => {
      if (score < threshold) return;
      const skin = HYPER_TUNING.skins[index + 1];
      if (skin === undefined) return;
      const result = addToCollection(HYPER_SKIN_SET.id, skin.id, HYPER_SKIN_SET.pieces.length);
      if (!result.added) return;
      unlocked = skin.name;
      floatText(this, VIEW.centerX, VIEW.centerY - 60, `${skin.name} UNLOCKED!`, CSS.accent, 50);
      sfx('levelup', { volume: 0.7 });
    });
    return unlocked;
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

  /** Band tint for a row, cycled through the ACTIVE skin's palette. */
  private rowColor(row: number): number {
    const colors = this.skin.colors;
    return colors[((row % colors.length) + colors.length) % colors.length] ?? PALETTE.primary;
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
  }
}
