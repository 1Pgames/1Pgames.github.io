import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../../config';
import { EVENTS, SCENES, TEX } from '../../core/keys';
import { Rng } from '../../core/rng';
import { load, save } from '../../core/storage';
import { sfx, sfxArp } from '../../core/audio';
import { setMusicIntensity, startMusic } from '../../core/music';
import { burst, flash, floatText, pop, shake } from '../../core/juice';
import { LevelDirector } from '../../core/level';
import type { ResultStat, SessionOutcome } from '../../core/session';
import { Board } from '../../core/board/grid';
import {
  findValidMoves,
  hasDeadBoard,
  reshuffle,
  resolveCascades,
  swapProducesMatch,
} from '../../core/board/resolve';
import type { CascadeStep, Cell, SpecialKind } from '../../core/board/types';
import { areAdjacent, sameCell } from '../../core/board/types';
import { addBackground } from '../../ui/background';
import { Button } from '../../ui/button';
import { drawPanel, drawPill } from '../../ui/primitives';
import { showPauseOverlay, type PauseOverlayHandle } from '../../ui/pauseOverlay';
import { BOARD_KINDS, BOARD_KIND_STYLES, BOARD_TUNING } from './tuning';
import type { BoardKindStyle } from './tuning';
import { BOARD_LEVELS, BOARD_PROGRESS_KEY } from './levels';

/**
 * Family B reference slice: a move-budgeted match-3 with cascades, line/bomb
 * specials, collect-N goals and a 10-level ladder.
 *
 * The scene owns NO puzzle logic. `core/board/*` resolves a move into a list of
 * `CascadeStep`s and `core/level.ts` owns win/lose; everything here is
 * translation — tweens, particles, sfx and a diffed HUD. That split is what
 * lets the same engine drive the blast, merge, sort and block variants later.
 */

interface PieceView {
  root: Phaser.GameObjects.Container;
  badge: Phaser.GameObjects.Image | null;
}

interface GoalChip {
  text: Phaser.GameObjects.Text;
  goalId: string;
  shown: string;
}

const SPECIAL_BADGE: Record<SpecialKind, string> = {
  'line-h': TEX.square,
  'line-v': TEX.square,
  bomb: TEX.ring,
};

export class GameScene extends Phaser.Scene {
  private seed = '';
  private rng!: Rng;
  private board!: Board;
  private director!: LevelDirector;

  private levelIndex = 0;
  private score = 0;
  private busy = false;
  private paused = false;
  private ended = false;
  private disposed = false;
  private pendingOutcome: SessionOutcome | null = null;

  private boardLayer!: Phaser.GameObjects.Container;
  private views: (PieceView | null)[] = [];
  private selector!: Phaser.GameObjects.Image;
  private selected: Cell | null = null;

  private originX = 0;
  private boardWidth = 0;
  private boardHeight = 0;

  private movesText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private goalChips: GoalChip[] = [];
  private shownMoves = '';
  private shownScore = '';
  private pauseButton!: Button;
  private pauseOverlay: PauseOverlayHandle | null = null;

  /** Native-size scale per kind, resolved once so pieces keep their aspect. */
  private readonly scaleByKind = new Map<string, number>();
  private readonly styleByKind = new Map<string, BoardKindStyle>();

  private downCell: Cell | null = null;
  private downX = 0;
  private downY = 0;
  private dragResolved = false;

  constructor() {
    super(SCENES.game);
  }

  /** `scene.start(SCENES.game, { seed })` replays the exact same deal. */
  init(data: { seed?: string } = {}): void {
    this.seed = data.seed ?? Date.now().toString(36);
  }

  create(): void {
    this.score = 0;
    this.busy = false;
    this.paused = false;
    this.ended = false;
    this.disposed = false;
    this.pendingOutcome = null;
    this.selected = null;
    this.downCell = null;
    this.goalChips = [];
    this.shownMoves = '';
    this.shownScore = '';
    this.styleByKind.clear();
    for (const style of BOARD_KIND_STYLES) this.styleByKind.set(style.id, style);

    const stored = load<number>(BOARD_PROGRESS_KEY, 0);
    this.levelIndex = Math.max(0, Math.min(BOARD_LEVELS.length - 1, Math.floor(stored)));
    const level = BOARD_LEVELS[this.levelIndex] as (typeof BOARD_LEVELS)[number];

    // One seed per (run, level): the same seed always deals the same puzzle,
    // and RETRY on the results screen replays it move for move.
    this.rng = new Rng(`${this.seed}:${level.seed}`);
    this.board = new Board(
      { cols: BOARD_TUNING.cols, rows: BOARD_TUNING.rows, kinds: BOARD_KINDS },
      new Rng(`${this.seed}:${level.seed}:deal`),
    );

    this.director = new LevelDirector(level.spec, {
      onEnd: (outcome) => {
        this.pendingOutcome = outcome;
      },
    });

    addBackground(this, false);
    this.buildBoardLayer();
    this.buildHud(level.spec.goals.length);
    this.buildInput();
    this.refreshHud();

    this.game.events.emit(EVENTS.runStarted);
    this.cameras.main.fadeIn(220, 0, 0, 0);
    startMusic('run');
    setMusicIntensity(0.28);

    // A timer or tween that outlives the scene must not touch it: every
    // deferred callback checks `disposed` first (see AGENTS.md shutdown trap).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.disposed = true;
    });
  }

  update(_time: number, delta: number): void {
    if (this.ended || this.paused) return;
    this.director.update(delta);
    this.refreshHud();
    // Any resolution the director reaches on its own (a timed variant of a
    // level, an explicit fail) still ends the scene — but only once the board
    // has stopped animating, so the winning cascade is always seen.
    if (this.pendingOutcome !== null && !this.busy) this.finish(this.pendingOutcome);
  }

  // ---------------------------------------------------------------- rendering

  private buildBoardLayer(): void {
    const cell = BOARD_TUNING.cellPx;
    this.boardWidth = BOARD_TUNING.cols * cell;
    this.boardHeight = BOARD_TUNING.rows * cell;
    this.originX = Math.round(VIEW.centerX - this.boardWidth / 2);

    const frame = drawPanel(this, this.boardWidth + 24, this.boardHeight + 24, {
      fill: PALETTE.bgDeep,
      stroke: PALETTE.primary,
      strokeAlpha: 0.4,
      radius: 26,
    });
    frame
      .setPosition(VIEW.centerX, BOARD_TUNING.boardTop + this.boardHeight / 2)
      .setScrollFactor(0)
      .setDepth(40);

    this.boardLayer = this.add
      .container(this.originX, BOARD_TUNING.boardTop)
      .setScrollFactor(0)
      .setDepth(50);

    this.selector = this.add
      .image(0, 0, TEX.ring)
      .setTint(PALETTE.ink)
      .setDisplaySize(cell - 4, cell - 4)
      .setVisible(false);
    this.boardLayer.add(this.selector);

    this.views = new Array<PieceView | null>(BOARD_TUNING.cols * BOARD_TUNING.rows).fill(null);
    this.board.forEachCell((position, piece) => {
      if (piece === null) return;
      this.views[this.index(position)] = this.spawnView(position, piece.kind, piece.special ?? null, 0);
    });
  }

  private index(cell: Cell): number {
    return cell.row * BOARD_TUNING.cols + cell.col;
  }

  private localX(col: number): number {
    return col * BOARD_TUNING.cellPx + BOARD_TUNING.cellPx / 2;
  }

  private localY(row: number): number {
    return row * BOARD_TUNING.cellPx + BOARD_TUNING.cellPx / 2;
  }

  /** Scale that fits a texture's longest axis to the kind's target size. */
  private scaleFor(style: BoardKindStyle): number {
    const cached = this.scaleByKind.get(style.id);
    if (cached !== undefined) return cached;
    const source = this.textures.get(style.texture).getSourceImage();
    const longest = Math.max(source.width, source.height);
    const scale = longest > 0 ? style.size / longest : 1;
    this.scaleByKind.set(style.id, scale);
    return scale;
  }

  private spawnView(cell: Cell, kind: string, special: SpecialKind | null, dropRows: number): PieceView {
    const style = this.styleByKind.get(kind) as BoardKindStyle;
    const glyph = this.add.image(0, 0, style.texture).setTint(style.tint);
    glyph.setScale(this.scaleFor(style));
    const root = this.add.container(this.localX(cell.col), this.localY(cell.row) - dropRows * BOARD_TUNING.cellPx, [
      glyph,
    ]);
    this.boardLayer.add(root);
    const view: PieceView = { root, badge: null };
    if (special !== null) this.markSpecial(view, special);
    return view;
  }

  /** Specials are dual coded too: a badge glyph AND a bright ink tint. */
  private markSpecial(view: PieceView, special: SpecialKind): void {
    if (view.badge !== null) return;
    const badge = this.add
      .image(0, 0, SPECIAL_BADGE[special])
      .setTint(PALETTE.ink)
      .setAlpha(0.9);
    if (special === 'bomb') badge.setDisplaySize(BOARD_TUNING.cellPx - 12, BOARD_TUNING.cellPx - 12);
    else if (special === 'line-h') badge.setDisplaySize(BOARD_TUNING.cellPx - 14, 10);
    else badge.setDisplaySize(10, BOARD_TUNING.cellPx - 14);
    view.root.add(badge);
    view.badge = badge;
  }

  // ---------------------------------------------------------------------- HUD

  private buildHud(goalCount: number): void {
    const level = BOARD_LEVELS[this.levelIndex] as (typeof BOARD_LEVELS)[number];

    this.add
      .text(SAFE.side, SAFE.top / 2, `LEVEL ${this.levelIndex + 1}`, { ...TEXT.heading, fontSize: '40px' })
      .setOrigin(0, 0.5)
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
    this.pauseButton.setScrollFactor(0).setDepth(1500);

    const movesPill = drawPill(this, 200, 76, { fill: PALETTE.bgTop, stroke: PALETTE.accent });
    movesPill.setPosition(SAFE.side + 100, 196).setScrollFactor(0).setDepth(1400);
    this.add
      .text(SAFE.side + 24, 196, 'MOVES', TEXT.label)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(1410);
    this.movesText = this.add
      .text(SAFE.side + 176, 196, '', { ...TEXT.score, fontSize: '48px', color: CSS.accent })
      .setOrigin(1, 0.5)
      .setScrollFactor(0)
      .setDepth(1410);

    this.scoreText = this.add
      .text(VIEW.width - SAFE.side, 196, '', { ...TEXT.score, fontSize: '44px' })
      .setOrigin(1, 0.5)
      .setScrollFactor(0)
      .setDepth(1410);

    // Goal chips: the icon is the piece's real texture and tint, so the goal
    // reads as "collect THESE" without a legend.
    const chipWidth = goalCount >= 3 ? 190 : 230;
    const gap = 12;
    const totalWidth = goalCount * chipWidth + (goalCount - 1) * gap;
    let x = VIEW.centerX - totalWidth / 2 + chipWidth / 2;
    for (const goal of level.spec.goals) {
      const style = this.styleByKind.get(goal.id) as BoardKindStyle;
      const chip = drawPill(this, chipWidth, 82, { fill: PALETTE.bgTop, stroke: style.tint, gloss: true });
      chip.setPosition(x, 268).setScrollFactor(0).setDepth(1400);
      const icon = this.add.image(x - chipWidth / 2 + 40, 268, style.texture).setTint(style.tint);
      icon.setScale(this.scaleFor(style) * 0.72).setScrollFactor(0).setDepth(1410);
      const text = this.add
        .text(x + chipWidth / 2 - 22, 268, '', { ...TEXT.body, fontSize: '34px', color: CSS.ink })
        .setOrigin(1, 0.5)
        .setScrollFactor(0)
        .setDepth(1410);
      this.goalChips.push({ text, goalId: goal.id, shown: '' });
      x += chipWidth + gap;
    }

    this.add
      .text(VIEW.centerX, BOARD_TUNING.boardTop + this.boardHeight + 48, 'SWIPE OR TAP TWO NEIGHBOURS', TEXT.label)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1400);
  }

  /** Diffed: nothing is re-set unless its rendered string actually changed. */
  private refreshHud(): void {
    const moves = `${this.director.movesLeft ?? 0}`;
    if (moves !== this.shownMoves) {
      this.shownMoves = moves;
      this.movesText.setText(moves);
    }
    const score = `${this.score}`;
    if (score !== this.shownScore) {
      this.shownScore = score;
      this.scoreText.setText(score);
    }
    for (const chip of this.goalChips) {
      const progress = this.director.goalProgress(chip.goalId);
      const label = `${Math.min(progress.current, progress.target)}/${progress.target}`;
      if (label !== chip.shown) {
        chip.shown = label;
        chip.text.setText(label);
      }
    }
  }

  // -------------------------------------------------------------------- input

  private buildInput(): void {
    const zone = this.add
      .zone(VIEW.centerX, BOARD_TUNING.boardTop + this.boardHeight / 2, this.boardWidth, this.boardHeight)
      .setScrollFactor(0)
      .setInteractive();

    // Click semantics: the move is decided on POINTER_DOWN (and on the drag
    // that follows it), never on release — a pointer-up landing on a freshly
    // opened overlay must not make a move.
    zone.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (!this.acceptsInput()) return;
      const cell = this.cellAt(pointer.x, pointer.y);
      if (cell === null) return;
      this.downCell = cell;
      this.downX = pointer.x;
      this.downY = pointer.y;
      this.dragResolved = false;

      const selected = this.selected;
      if (selected !== null && areAdjacent(selected, cell)) {
        this.dragResolved = true;
        this.attemptSwap(selected, cell);
        return;
      }
      if (selected !== null && sameCell(selected, cell)) {
        this.clearSelection();
        return;
      }
      this.select(cell);
    });

    zone.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown || this.dragResolved || this.downCell === null) return;
      if (!this.acceptsInput()) return;
      const dx = pointer.x - this.downX;
      const dy = pointer.y - this.downY;
      if (Math.abs(dx) < BOARD_TUNING.dragCommitPx && Math.abs(dy) < BOARD_TUNING.dragCommitPx) return;
      const from = this.downCell;
      const target =
        Math.abs(dx) >= Math.abs(dy)
          ? { col: from.col + (dx > 0 ? 1 : -1), row: from.row }
          : { col: from.col, row: from.row + (dy > 0 ? 1 : -1) };
      this.dragResolved = true;
      this.clearSelection();
      if (!this.board.isBlocked(target)) this.attemptSwap(from, target);
    });

    this.input.keyboard?.on('keydown-ESC', () => this.togglePause());
    this.input.keyboard?.on('keydown-P', () => this.togglePause());
  }

  private acceptsInput(): boolean {
    return !this.busy && !this.paused && !this.ended && !this.director.ended;
  }

  private cellAt(x: number, y: number): Cell | null {
    const col = Math.floor((x - this.originX) / BOARD_TUNING.cellPx);
    const row = Math.floor((y - BOARD_TUNING.boardTop) / BOARD_TUNING.cellPx);
    const cell = { col, row };
    return this.board.isBlocked(cell) ? null : cell;
  }

  private select(cell: Cell): void {
    this.selected = cell;
    this.selector
      .setPosition(this.localX(cell.col), this.localY(cell.row))
      .setVisible(true)
      .setScale(1);
    this.boardLayer.bringToTop(this.selector);
    pop(this, this.selector, 0.18, 160);
    sfx('tap', { volume: 0.3 });
  }

  private clearSelection(): void {
    this.selected = null;
    this.selector.setVisible(false);
  }

  // ------------------------------------------------------------------- a move

  private attemptSwap(a: Cell, b: Cell): void {
    if (!this.acceptsInput() || !areAdjacent(a, b)) return;
    const viewA = this.views[this.index(a)] ?? null;
    const viewB = this.views[this.index(b)] ?? null;
    if (viewA === null || viewB === null) return;

    this.busy = true;
    this.clearSelection();
    const legal = swapProducesMatch(this.board, a, b);

    this.boardLayer.bringToTop(viewA.root);
    this.tweenTo(viewA.root, b, BOARD_TUNING.swapMs);
    this.tweenTo(viewB.root, a, BOARD_TUNING.swapMs, () => {
      if (this.disposed) return;
      if (!legal) {
        // Bounce back: the swap is never committed to the model.
        sfx('hit', { volume: 0.25 });
        shake(this, 0.004, 110);
        this.tweenTo(viewA.root, a, BOARD_TUNING.rejectMs);
        this.tweenTo(viewB.root, b, BOARD_TUNING.rejectMs, () => {
          if (!this.disposed) this.busy = false;
        });
        return;
      }
      this.commitSwap(a, b, viewA, viewB);
    });
  }

  private commitSwap(a: Cell, b: Cell, viewA: PieceView, viewB: PieceView): void {
    this.board.swap(a, b);
    this.views[this.index(b)] = viewA;
    this.views[this.index(a)] = viewB;
    this.director.useMove();
    sfx('whoosh', { volume: 0.35 });

    // A swapped special detonates even when the swap itself makes no run.
    const detonate: Cell[] = [];
    for (const cell of [a, b]) {
      const piece = this.board.get(cell);
      if (piece !== null && (piece.special ?? null) !== null) detonate.push(cell);
    }

    const steps = resolveCascades(this.board, this.rng, {
      origin: b,
      detonate: detonate.length > 0 ? detonate : undefined,
    });

    setMusicIntensity(0.25 + 0.55 * (1 - this.director.budgetLeftRatio));
    this.playStep(steps, 0);
  }

  /** Plays one cascade beat, then schedules the next; `settle` ends the move. */
  private playStep(steps: readonly CascadeStep[], index: number): void {
    if (this.disposed) return;
    const step = steps[index];
    if (step === undefined) {
      this.settleMove();
      return;
    }

    const clearMs = this.renderClear(step, index);
    this.time.delayedCall(clearMs, () => {
      if (this.disposed) return;
      const fallMs = this.renderFalls(step);
      this.time.delayedCall(fallMs + BOARD_TUNING.stepGapMs, () => this.playStep(steps, index + 1));
    });
  }

  /** Clears pieces, banks score and goals, upgrades created specials. */
  private renderClear(step: CascadeStep, depth: number): number {
    const multiplier = 1 + depth * BOARD_TUNING.cascadeStepBonus;
    let floats = 0;

    step.cleared.forEach((entry, order) => {
      const slot = this.index(entry.cell);
      const view = this.views[slot] ?? null;
      this.views[slot] = null;
      this.director.recordProgress(entry.kind, 1);
      this.score += Math.round(BOARD_TUNING.scorePerCell * multiplier);

      const style = this.styleByKind.get(entry.kind) as BoardKindStyle;
      const worldX = this.originX + this.localX(entry.cell.col);
      const worldY = BOARD_TUNING.boardTop + this.localY(entry.cell.row);
      if (view !== null) {
        this.tweens.add({
          targets: view.root,
          scale: 0,
          alpha: 0,
          duration: BOARD_TUNING.clearMs,
          delay: Math.min(order, 6) * BOARD_TUNING.clearStaggerMs,
          ease: 'Back.easeIn',
          onComplete: () => view.root.destroy(),
        });
      }
      burst(this, worldX, worldY, style.tint, entry.special === null ? 5 : 16, entry.special === null ? 150 : 330);
      if (entry.special !== null) shake(this, 0.006, 140);
      if (depth > 0 && floats < BOARD_TUNING.floatTextPerStep) {
        floats += 1;
        floatText(this, worldX, worldY, `x${depth + 1}`, CSS.accent, 38);
      }
    });

    for (const spawn of step.created) {
      const view = this.views[this.index(spawn.cell)] ?? null;
      if (view === null) continue;
      this.markSpecial(view, spawn.special);
      this.score += BOARD_TUNING.specialCreatedScore;
      pop(this, view.root, 0.5, 240);
      const worldX = this.originX + this.localX(spawn.cell.col);
      const worldY = BOARD_TUNING.boardTop + this.localY(spawn.cell.row);
      burst(this, worldX, worldY, PALETTE.ink, 20, 380);
      floatText(this, worldX, worldY - 20, spawn.special === 'bomb' ? 'BOMB!' : 'LINE!', CSS.ink, 40);
    }

    if (step.created.length > 0) sfxArp('combo', 3);
    else if (step.cleared.length > 0) sfx(depth > 0 ? 'combo' : 'pickup', { rate: 1 + Math.min(depth, 5) * 0.12 });
    if (depth >= 2) shake(this, 0.005, 120);

    this.refreshHud();
    return BOARD_TUNING.clearMs + Math.min(step.cleared.length, 6) * BOARD_TUNING.clearStaggerMs;
  }

  /** Moves survivors down and drops the refills in from above. */
  private renderFalls(step: CascadeStep): number {
    let longest = 0;

    // Gravity reports bottom-up per column, so a destination slot is always
    // already vacated by the time its faller is re-homed.
    for (const fall of step.falls) {
      const view = this.views[this.index(fall.from)] ?? null;
      this.views[this.index(fall.from)] = null;
      this.views[this.index(fall.to)] = view;
      if (view === null) continue;
      const distance = fall.to.row - fall.from.row;
      const duration = Math.max(BOARD_TUNING.fallMinMs, distance * BOARD_TUNING.fallMsPerCell);
      longest = Math.max(longest, duration);
      this.tweenTo(view.root, fall.to, duration, undefined, 'Quad.easeIn');
    }

    const dropIndexByColumn = new Map<number, number>();
    for (const refill of step.refills) {
      const above = (dropIndexByColumn.get(refill.cell.col) ?? 0) + 1;
      dropIndexByColumn.set(refill.cell.col, above);
      const view = this.spawnView(refill.cell, refill.piece.kind, refill.piece.special ?? null, above);
      this.views[this.index(refill.cell)] = view;
      const duration = Math.max(
        BOARD_TUNING.fallMinMs,
        (refill.cell.row + above) * BOARD_TUNING.fallMsPerCell,
      );
      longest = Math.max(longest, duration);
      this.tweenTo(view.root, refill.cell, duration, undefined, 'Quad.easeIn');
    }
    return longest;
  }

  private tweenTo(
    target: Phaser.GameObjects.Container,
    cell: Cell,
    duration: number,
    onComplete?: () => void,
    ease = 'Quad.easeOut',
  ): void {
    this.tweens.add({
      targets: target,
      x: this.localX(cell.col),
      y: this.localY(cell.row),
      duration,
      ease,
      onComplete,
    });
  }

  /**
   * The board is at rest: resolve the move budget (so a final move that
   * completes the goals still wins), then unstick a dead board.
   */
  private settleMove(): void {
    if (this.disposed) return;
    this.director.settleMove();
    this.refreshHud();

    if (this.pendingOutcome !== null) {
      this.finish(this.pendingOutcome);
      return;
    }
    if (hasDeadBoard(this.board)) {
      this.reshuffleBoard();
      return;
    }
    this.busy = false;
  }

  private reshuffleBoard(): void {
    const ok = reshuffle(this.board, this.rng);
    for (let slot = 0; slot < this.views.length; slot += 1) {
      this.views[slot]?.root.destroy();
      this.views[slot] = null;
    }
    this.board.forEachCell((cell, piece) => {
      if (piece === null) return;
      const view = this.spawnView(cell, piece.kind, piece.special ?? null, 0);
      view.root.setScale(0);
      this.tweens.add({
        targets: view.root,
        scale: 1,
        duration: BOARD_TUNING.shuffleMs,
        delay: (cell.col + cell.row) * 12,
        ease: 'Back.easeOut',
      });
      this.views[this.index(cell)] = view;
    });

    flash(this, PALETTE.primary, 200);
    sfx('whoosh');
    floatText(this, VIEW.centerX, BOARD_TUNING.boardTop + this.boardHeight / 2, 'NO MOVES - SHUFFLE', CSS.primary, 44);

    this.time.delayedCall(BOARD_TUNING.shuffleMs + 220, () => {
      if (this.disposed) return;
      // A shuffle that cannot find a playable board is a dead level, not a
      // stuck scene: fail it rather than lock the player out.
      if (!ok || findValidMoves(this.board).length === 0) this.director.fail('no-moves');
      if (this.pendingOutcome !== null) this.finish(this.pendingOutcome);
      else this.busy = false;
    });
  }

  // ----------------------------------------------------------------- lifecycle

  private togglePause(): void {
    if (this.ended) return;
    if (this.paused) {
      this.resumeFromPause();
      return;
    }
    this.paused = true;
    this.director.pause();
    this.game.events.emit(EVENTS.paused);
    this.pauseOverlay = showPauseOverlay(
      this,
      () => this.resumeFromPause(),
      () => {
        this.pauseOverlay?.destroy();
        this.pauseOverlay = null;
        this.scene.start(SCENES.game, { seed: this.seed });
      },
    );
  }

  private resumeFromPause(): void {
    this.paused = false;
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
    this.director.resume();
    this.game.events.emit(EVENTS.resumed);
  }

  private finish(outcome: SessionOutcome): void {
    if (this.ended) return;
    this.ended = true;
    this.busy = true;
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
    this.director.pause();

    const stars = this.director.stars;
    const movesLeft = this.director.movesLeft ?? 0;

    sfx(outcome.won ? 'levelup' : 'die');
    flash(this, outcome.won ? PALETTE.good : PALETTE.bad, 260);
    shake(this, 0.018, 300);
    setMusicIntensity(0.2);

    // Winning advances the ladder; losing leaves it, so RETRY replays this
    // level with the same seed.
    if (outcome.won) {
      save(BOARD_PROGRESS_KEY, Math.min(this.levelIndex + 1, BOARD_LEVELS.length - 1));
    }

    const stats: ResultStat[] = [
      { label: 'LEVEL', value: `${this.levelIndex + 1}` },
      { label: 'STARS', value: `${stars}/3` },
      { label: 'MOVES LEFT', value: `${movesLeft}` },
    ];
    this.game.events.emit(EVENTS.runEnded, { won: outcome.won, score: this.score });

    this.cameras.main.fadeOut(340, 0, 0, 0);
    this.time.delayedCall(360, () => {
      this.scene.start(SCENES.gameOver, {
        won: outcome.won,
        timeMs: this.director.elapsedSeconds * 1000,
        score: this.score,
        currencyEarned: stars * BOARD_TUNING.currencyPerStar,
        seed: this.seed,
        stats,
      });
    });
  }
}
