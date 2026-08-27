import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../../config';
import { SCENES, TEX } from '../../core/keys';
import { Rng } from '../../core/rng';
import { sfx } from '../../core/audio';
import { setMusicIntensity, startMusic } from '../../core/music';
import { burst, countTo, flash, floatText, pop, shake } from '../../core/juice';
import { Economy } from '../../core/economy';
import type { GeneratorDef } from '../../core/economy';
import type { ResultStat } from '../../core/session';
import { load, save } from '../../core/storage';
import { Button } from '../../ui/button';
import { drawPanel } from '../../ui/primitives';
import { ECONOMY_SPEC, GENERATOR_VIEW, MANAGER_BY_GENERATOR } from './content';
import { IDLE_TUNING } from './tuning';

/**
 * Family F starter slice: idle tycoon (generators / managers / prestige).
 *
 * All the maths lives in `core/economy.ts`; this scene is a renderer plus an
 * input surface. Three things make it different from the arena slice:
 *
 *  - **No fail state.** The session ends only when the player ASCENDs
 *    (prestige → results screen) or walks back to the menu, so there is no
 *    `SessionDirector` here — nothing can resolve the session against the
 *    player's wishes.
 *  - **The save IS the run.** Progress is persisted (`core/storage.ts`) every
 *    `autosaveMs` and on shutdown, with a wall-clock stamp so returning players
 *    are paid capped offline income. RETRY from the results screen therefore
 *    continues the empire rather than wiping it.
 *  - **Rows repaint on state change only.** The list is eight panels with text;
 *    a per-frame `setText` on all of them would be the whole frame budget, so
 *    each row caches the numbers it displayed and diffs before touching Phaser.
 */

const ROW_WIDTH = VIEW.width - SAFE.side * 2;
const ROW_HEIGHT = IDLE_TUNING.ui.rowHeight;
const ROW_GAP = IDLE_TUNING.ui.rowGap;
const ROW_STRIDE = ROW_HEIGHT + ROW_GAP;
const TEXT_LEFT = -ROW_WIDTH / 2 + 104;
/** Ready meter stops well short of the BUY/AUTOMATE column. */
const BAR_WIDTH = 300;
const BAR_HEIGHT = 12;

const VIEWPORT_TOP = 224;
const VIEWPORT_BOTTOM = 890;
const VIEWPORT_HEIGHT = VIEWPORT_BOTTOM - VIEWPORT_TOP;

/** Draw order: backdrop < scrolling list < edge curtains < HUD < footer. */
const DEPTH_BACKDROP = 0;
const DEPTH_LIST = 10;
const DEPTH_CURTAIN = 20;
const DEPTH_HUD = 30;
const DEPTH_FOOTER = 40;

const STORE_ECONOMY = 'idle:economy';
const STORE_STAMP = 'idle:stamp';

const CASH_UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx'] as const;

/** Compact idle-game money: 1 234 567 reads as `1.23M`, never as 7 digits. */
function formatCash(value: number): string {
  const whole = Math.floor(value);
  if (whole < 1000) return `${whole}`;
  let scaled = whole;
  let unit = 0;
  while (scaled >= 1000 && unit < CASH_UNITS.length - 1) {
    scaled /= 1000;
    unit += 1;
  }
  const digits = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  return `${scaled.toFixed(digits)}${CASH_UNITS[unit]}`;
}

/**
 * Money that can legitimately be fractional — per-second rates and a single
 * tap payout. `formatCash` floors, so the first generator's 0.6 would read as
 * a flat "0" and the tier would look broken.
 */
function formatRate(value: number): string {
  if (value < 10) return value.toFixed(1);
  return formatCash(value);
}

interface Row {
  def: GeneratorDef;
  container: Phaser.GameObjects.Container;
  icon: Phaser.GameObjects.Image;
  nameText: Phaser.GameObjects.Text;
  ownedText: Phaser.GameObjects.Text;
  rateText: Phaser.GameObjects.Text;
  track: Phaser.GameObjects.Rectangle;
  fill: Phaser.GameObjects.Rectangle;
  buy: Button;
  automate: Button | null;
  /** Row accent, reused by burst particles so feedback matches the icon. */
  tint: number;
  /** Cached display state — the diff that keeps this list off the frame budget. */
  shownOwned: number;
  shownUnlocked: boolean;
  shownAutomated: boolean;
  shownMult: number;
  shownAffordable: boolean;
  shownManagerAffordable: boolean;
  shownReadyStep: number;
}

interface OverlayHandle {
  destroy(): void;
}

export class GameScene extends Phaser.Scene {
  private seed = '';
  private rng!: Rng;
  private eco!: Economy;
  private sessionMs = 0;
  private ended = false;
  private destroyed = false;

  private cashText!: Phaser.GameObjects.Text;
  private rateText!: Phaser.GameObjects.Text;
  private goalText!: Phaser.GameObjects.Text;
  private prestigeButton!: Button;
  private content!: Phaser.GameObjects.Container;
  private readonly rows: Row[] = [];

  private shownCash = -1;
  private shownRate = -1;
  /** NaN so the first `refreshHud` always paints: step 0 is a legal value. */
  private shownGoal = Number.NaN;
  private countingUntilMs = 0;
  private shownIntensity = -1;

  private scrollY = 0;
  private maxScroll = 0;
  private pointerDown = false;
  private pointerStartY = 0;
  private lastPointerY = 0;
  private scrolling = false;
  private armedRow = -1;
  private overlay: OverlayHandle | null = null;

  constructor() {
    super(SCENES.game);
  }

  /** `scene.start(SCENES.game, { seed })` fixes the tap-crit rolls for a replay. */
  init(data: { seed?: string } = {}): void {
    this.seed = data.seed ?? Date.now().toString(36);
  }

  create(): void {
    this.sessionMs = 0;
    this.ended = false;
    this.destroyed = false;
    this.rows.length = 0;
    this.shownCash = -1;
    this.shownRate = -1;
    this.shownGoal = Number.NaN;
    this.shownIntensity = -1;
    this.countingUntilMs = 0;
    this.scrollY = 0;
    this.armedRow = -1;
    this.overlay = null;

    // The seed only drives tap crits here — an idle economy is otherwise fully
    // deterministic — but it keeps the family's replay contract intact.
    this.rng = new Rng(this.seed);

    this.eco = new Economy(ECONOMY_SPEC, IDLE_TUNING.startingCash);
    this.eco.restore(load<unknown>(STORE_ECONOMY, null));
    const offline = this.grantOfflineIncome();

    this.buildBackdrop();
    this.buildHud();
    this.buildList();
    this.buildFooter();
    this.bindScroll();

    // Autosave on a timer AND on shutdown: the timer covers a tab that is
    // killed without a lifecycle event, shutdown covers scene transitions.
    this.time.addEvent({
      delay: IDLE_TUNING.autosaveMs,
      loop: true,
      callback: () => this.persist(),
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);

    if (offline > 0) {
      this.time.delayedCall(320, () => {
        if (this.destroyed) return;
        floatText(
          this,
          VIEW.centerX,
          VIEWPORT_TOP - 6,
          `WHILE AWAY +${formatCash(offline)}`,
          CSS.good,
          46,
        );
        sfx('levelup', { volume: 0.5 });
      });
    }

    this.refreshHud();
    this.cullRows();
    for (const row of this.rows) this.refreshRow(row, true);

    startMusic('run');
    setMusicIntensity(0.2);
    this.cameras.main.fadeIn(220, 0, 0, 0);
  }

  update(_time: number, delta: number): void {
    if (this.ended) return;
    this.sessionMs += delta;
    // The economy freezes behind the ASCEND confirm so the previewed gain
    // cannot shift between reading it and tapping it.
    if (!this.overlay) this.eco.update(delta);

    this.refreshHud();
    for (const row of this.rows) {
      if (row.container.visible) this.refreshRow(row, false);
    }
  }

  // --- construction -------------------------------------------------------

  /**
   * Explicit depths instead of creation order: the list scrolls BETWEEN two
   * opaque curtains (`DEPTH_CURTAIN`) that clip the partially-visible first and
   * last rows, while the HUD and footer sit above them. Phaser 4 removed
   * geometry masks, and one rectangle per edge is cheaper than a filter.
   */
  private buildBackdrop(): void {
    this.add
      .rectangle(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height, PALETTE.bgBottom)
      .setScrollFactor(0)
      .setDepth(DEPTH_BACKDROP);

    const topHeight = VIEWPORT_TOP;
    this.add
      .rectangle(VIEW.centerX, topHeight / 2, VIEW.width, topHeight, PALETTE.bgTop)
      .setScrollFactor(0)
      .setDepth(DEPTH_CURTAIN);
    const bottomHeight = VIEW.height - VIEWPORT_BOTTOM;
    this.add
      .rectangle(VIEW.centerX, VIEWPORT_BOTTOM + bottomHeight / 2, VIEW.width, bottomHeight, PALETTE.bgBottom)
      .setScrollFactor(0)
      .setDepth(DEPTH_CURTAIN);

    for (const edgeY of [VIEWPORT_TOP, VIEWPORT_BOTTOM]) {
      this.add
        .rectangle(VIEW.centerX, edgeY, VIEW.width, 3, PALETTE.primary, 0.35)
        .setScrollFactor(0)
        .setDepth(DEPTH_CURTAIN);
    }
  }

  private buildHud(): void {
    this.add
      .text(VIEW.centerX, 48, 'THE IDLE SPIRE', { ...TEXT.heading, fontSize: '38px', color: CSS.inkSoft })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD);

    this.cashText = this.add
      .text(VIEW.centerX, 116, '0', { ...TEXT.title, fontSize: '66px', color: CSS.accent })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD);

    this.rateText = this.add
      .text(VIEW.centerX, 166, '', { ...TEXT.body, fontSize: '28px', color: CSS.primary })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD);

    this.goalText = this.add
      .text(VIEW.centerX, 198, '', { ...TEXT.label, color: CSS.inkSoft })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD);
  }

  private buildList(): void {
    this.content = this.add.container(VIEW.centerX, VIEWPORT_TOP).setDepth(DEPTH_LIST);

    ECONOMY_SPEC.generators.forEach((def, index) => {
      const row = this.buildRow(def, index, index * ROW_STRIDE + ROW_HEIGHT / 2);
      this.content.add(row.container);
      this.rows.push(row);
    });

    const contentHeight = ECONOMY_SPEC.generators.length * ROW_STRIDE - ROW_GAP;
    this.maxScroll = Math.max(0, contentHeight - VIEWPORT_HEIGHT);
  }

  private buildRow(def: GeneratorDef, index: number, y: number): Row {
    const container = this.add.container(0, y);
    const view = GENERATOR_VIEW[def.id] ?? { tex: TEX.disc, tint: PALETTE.primary, blurb: '' };

    const bg = drawPanel(this, ROW_WIDTH, ROW_HEIGHT, {
      fill: PALETTE.bgTop,
      fillAlpha: 0.94,
      stroke: PALETTE.primary,
      strokeAlpha: 0.35,
      strokeWidth: 3,
      radius: 26,
    });

    const icon = this.add
      .image(-ROW_WIDTH / 2 + 56, -14, view.tex)
      .setDisplaySize(IDLE_TUNING.ui.iconSize, IDLE_TUNING.ui.iconSize)
      .setTint(view.tint);

    const nameText = this.add
      .text(TEXT_LEFT, -70, def.name, { ...TEXT.button, fontSize: '34px' })
      .setOrigin(0, 0.5);

    const ownedText = this.add
      .text(TEXT_LEFT, -24, '', { ...TEXT.label, fontSize: '28px', color: CSS.primary })
      .setOrigin(0, 0.5);

    const rateText = this.add
      .text(TEXT_LEFT, 20, '', { ...TEXT.body, fontSize: '26px' })
      .setOrigin(0, 0.5);

    // Ready meter for the manual-collect cycle. A plain rectangle scaled from
    // its left edge — no rounded caps to smear, no per-frame Graphics redraw.
    // Hidden until the tier is owned AND un-managed; `refreshRow` owns the
    // visibility from there (`shownReadyStep` starts NaN so it always paints).
    const track = this.add
      .rectangle(TEXT_LEFT, 62, BAR_WIDTH, BAR_HEIGHT, PALETTE.bgDeep, 0.9)
      .setOrigin(0, 0.5)
      .setVisible(false);
    const fill = this.add
      .rectangle(TEXT_LEFT, 62, BAR_WIDTH, BAR_HEIGHT, PALETTE.accent)
      .setOrigin(0, 0.5)
      .setVisible(false);

    const buttonX = ROW_WIDTH / 2 - IDLE_TUNING.ui.buyWidth / 2 - 16;
    const buy = new Button(this, buttonX, -50, '', () => this.onBuy(index), {
      width: IDLE_TUNING.ui.buyWidth,
      height: IDLE_TUNING.ui.buyHeight,
      fontSize: '30px',
    });

    const managerDef = MANAGER_BY_GENERATOR[def.id];
    const automate = managerDef
      ? new Button(this, buttonX, 50, '', () => this.onAutomate(index), {
          width: IDLE_TUNING.ui.buyWidth,
          height: IDLE_TUNING.ui.buyHeight,
          fill: PALETTE.bgTop,
          stroke: PALETTE.secondary,
          textColor: CSS.ink,
          fontSize: '26px',
        })
      : null;

    // Tap-to-collect zone covers the row body only, so it never fights the
    // BUY/AUTOMATE capsules for the same pointer.
    const tapZone = this.add
      .zone(-(IDLE_TUNING.ui.buyWidth + 40) / 2, 0, ROW_WIDTH - IDLE_TUNING.ui.buyWidth - 40, ROW_HEIGHT)
      .setInteractive();
    // Click semantics: arm on this row's own POINTER_DOWN, act on the release
    // (see `bindScroll`), and disarm if the pointer leaves or starts scrolling.
    tapZone.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (this.overlay) return;
      this.armedRow = index;
    });
    tapZone.on(Phaser.Input.Events.POINTER_OUT, () => {
      if (this.armedRow === index) this.armedRow = -1;
    });

    container.add([bg, tapZone, icon, nameText, ownedText, rateText, track, fill, buy]);
    if (automate) container.add(automate);

    return {
      def,
      container,
      icon,
      nameText,
      ownedText,
      rateText,
      track,
      fill,
      buy,
      automate,
      tint: view.tint,
      shownOwned: -1,
      shownUnlocked: false,
      shownAutomated: false,
      shownMult: -1,
      shownAffordable: false,
      shownManagerAffordable: false,
      shownReadyStep: Number.NaN,
    };
  }

  private buildFooter(): void {
    const buttonWidth = VIEW.width - SAFE.side * 2;

    this.prestigeButton = new Button(
      this,
      VIEW.centerX,
      VIEW.height - SAFE.bottom - 108,
      'ASCEND',
      () => this.onAscendPressed(),
      { width: buttonWidth, height: 96, fill: PALETTE.secondary, stroke: PALETTE.accent, fontSize: '36px' },
    );
    this.prestigeButton.setVisible(false).setDepth(DEPTH_FOOTER);

    new Button(this, VIEW.centerX, VIEW.height - SAFE.bottom, 'MENU', () => this.leaveToMenu(), {
      width: buttonWidth,
      height: 96,
      fill: PALETTE.bgTop,
      stroke: PALETTE.primary,
      textColor: CSS.ink,
      fontSize: '34px',
    }).setDepth(DEPTH_FOOTER);
  }

  /**
   * Drag-scroll on the scene's pointer stream rather than a scroll zone: the
   * row tap targets stay hit-testable, and a drag that started on a row is
   * still recognised as a scroll (and cancels that row's armed tap).
   */
  private bindScroll(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      this.pointerDown = true;
      this.scrolling = false;
      this.pointerStartY = pointer.y;
      this.lastPointerY = pointer.y;
    });

    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (!this.pointerDown || this.overlay) return;
      const dy = pointer.y - this.lastPointerY;
      this.lastPointerY = pointer.y;
      if (Math.abs(pointer.y - this.pointerStartY) > IDLE_TUNING.ui.dragSlopPx) {
        this.scrolling = true;
        this.armedRow = -1;
      }
      if (!this.scrolling) return;
      this.scrollY = Phaser.Math.Clamp(this.scrollY - dy, 0, this.maxScroll);
      this.content.y = VIEWPORT_TOP - this.scrollY;
      this.cullRows();
    });

    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      this.pointerDown = false;
      const armed = this.armedRow;
      this.armedRow = -1;
      if (armed < 0 || this.scrolling || this.overlay || this.ended) return;
      this.onCollect(armed);
    });
  }

  /** Hides rows outside the viewport: cheaper than a mask filter, and an
   * off-list row can no longer swallow a tap meant for the footer. */
  private cullRows(): void {
    for (const row of this.rows) {
      const worldY = this.content.y + row.container.y;
      const visible = worldY + ROW_HEIGHT / 2 > VIEWPORT_TOP && worldY - ROW_HEIGHT / 2 < VIEWPORT_BOTTOM;
      if (row.container.visible !== visible) row.container.setVisible(visible);
    }
  }

  // --- player actions -----------------------------------------------------

  private onBuy(index: number): void {
    const row = this.rows[index];
    if (!row || this.overlay || this.ended) return;

    const cost = this.eco.buyCost(row.def.id, 1);
    if (!this.eco.buy(row.def.id, 1)) {
      sfx('hit', { volume: 0.3 });
      this.floatOnRow(row, this.eco.isUnlocked(row.def.id) ? 'NEED MORE' : 'LOCKED', CSS.bad, 34);
      return;
    }

    const owned = this.eco.ownedOf(row.def.id);
    if (owned === 1) {
      sfx('levelup', { volume: 0.6 });
      burst(this, VIEW.centerX - 200, this.rowWorldY(row), row.tint, 16, 240);
    } else {
      sfx('tap', { volume: 0.45 });
    }
    pop(this, row.icon, 0.22);
    this.floatOnRow(row, `-${formatCash(cost)}`, CSS.inkSoft, 34);
    this.refreshRow(row, true);
    this.refreshHud();
  }

  private onAutomate(index: number): void {
    const row = this.rows[index];
    if (!row || this.overlay || this.ended) return;
    const managerDef = MANAGER_BY_GENERATOR[row.def.id];
    if (!managerDef) return;

    if (!this.eco.buyManager(managerDef.id)) {
      sfx('hit', { volume: 0.3 });
      this.floatOnRow(row, 'NEED MORE', CSS.bad, 34);
      return;
    }

    sfx('levelup');
    burst(this, VIEW.centerX, this.rowWorldY(row), PALETTE.secondary, 22, 300);
    pop(this, row.icon, 0.35);
    this.floatOnRow(row, `${managerDef.name.toUpperCase()} HIRED`, CSS.secondary, 34);
    this.refreshRow(row, true);
    this.refreshHud();
  }

  /** Manual payout for an un-managed tier, with a seeded crit for texture. */
  private onCollect(index: number): void {
    const row = this.rows[index];
    if (!row) return;

    const base = this.eco.collect(row.def.id);
    if (base <= 0) {
      // Nothing owned, already automated, or the cycle is still filling.
      sfx('tap', { volume: 0.18, rate: 0.8 });
      pop(this, row.icon, 0.1, 120);
      return;
    }

    const before = this.eco.cash - base;
    const crit = this.rng.chance(IDLE_TUNING.tapCritChance);
    if (crit) this.eco.credit(base * (IDLE_TUNING.tapCritMult - 1));
    const total = crit ? base * IDLE_TUNING.tapCritMult : base;

    sfx('pickup', { rate: crit ? 1.35 : 1 });
    pop(this, row.icon, crit ? 0.42 : 0.26);
    this.floatOnRow(
      row,
      crit ? `CRIT +${formatRate(total)}` : `+${formatRate(total)}`,
      crit ? CSS.secondary : CSS.accent,
      crit ? 52 : 40,
    );
    if (crit) {
      burst(this, VIEW.centerX, this.rowWorldY(row), PALETTE.secondary, 18, 320);
      shake(this, 0.004, 120);
    }
    this.animateCash(before, this.eco.cash);
    this.refreshRow(row, true);
  }

  private onAscendPressed(): void {
    if (this.overlay || this.ended || !this.eco.prestigeAvailable()) return;
    const gain = this.eco.prestigeGain();
    const nextMult = this.eco.prestigeMult + gain;
    this.overlay = this.showAscendConfirm(gain, nextMult);
  }

  private ascend(): void {
    const gain = this.eco.prestige();
    if (gain <= 0) return;

    this.ended = true;
    sfx('levelup');
    flash(this, PALETTE.secondary, 260);
    shake(this, 0.01, 260);
    this.persist();

    const stats: ResultStat[] = [
      { label: 'PRESTIGE MULT', value: `x${this.eco.prestigeMult.toFixed(2)}` },
      { label: 'LIFETIME', value: formatCash(this.eco.lifetimeEarned) },
    ];

    this.cameras.main.fadeOut(280, 0, 0, 0);
    this.time.delayedCall(300, () => {
      this.scene.start(SCENES.gameOver, {
        won: true,
        timeMs: this.sessionMs,
        score: Math.round(this.eco.lifetimeEarned),
        // The prestige multiplier IS the run's reward, so it is also the coin
        // payout the results screen settles into meta progression.
        currencyEarned: Math.max(1, Math.round(gain)),
        seed: this.seed,
        stats,
      });
    });
  }

  private leaveToMenu(): void {
    if (this.ended) return;
    this.ended = true;
    this.persist();
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.time.delayedCall(220, () => this.scene.start(SCENES.menu));
  }

  // --- overlays -----------------------------------------------------------

  /**
   * Slice-local confirm dialog. `ui/pauseOverlay.ts` is the run-pause modal and
   * is not parameterisable; this is the same primitives recipe (dim + panel +
   * two capsules) for a destructive one-off choice.
   */
  private showAscendConfirm(gain: number, nextMult: number): OverlayHandle {
    const root = this.add.container(0, 0).setDepth(2100).setScrollFactor(0);

    const dim = this.add
      .rectangle(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height, 0x000000, 0.68)
      .setScrollFactor(0)
      .setInteractive();

    // `drawPanel` paints around its own origin, so the Graphics sits at the
    // panel's CENTRE, not its top-left corner.
    const panelWidth = VIEW.width - SAFE.side * 2;
    const panelHeight = 480;
    const panelCenterY = VIEW.centerY - 40;
    const panel = drawPanel(this, panelWidth, panelHeight, {
      fill: PALETTE.bgTop,
      fillAlpha: 0.98,
      stroke: PALETTE.secondary,
      strokeAlpha: 0.8,
      strokeWidth: 4,
      radius: 30,
    })
      .setPosition(VIEW.centerX, panelCenterY)
      .setScrollFactor(0);

    const heading = this.add
      .text(VIEW.centerX, panelCenterY - 190, 'ASCEND?', {
        ...TEXT.title,
        fontSize: '64px',
        color: CSS.secondary,
      })
      .setOrigin(0.5)
      .setScrollFactor(0);

    const body = this.add
      .text(
        VIEW.centerX,
        panelCenterY - 82,
        `Trade the whole estate for power.\n` +
          `+${gain.toFixed(2)} MULTIPLIER  ->  x${nextMult.toFixed(2)}\n` +
          `LOSE all cash, holdings and managers`,
        { ...TEXT.body, fontSize: '28px', color: CSS.ink, align: 'center' },
      )
      .setOrigin(0.5)
      .setLineSpacing(10)
      .setScrollFactor(0);

    let resolved = false;
    const close = (): void => {
      root.destroy(true);
      this.overlay = null;
    };

    const confirm = new Button(
      this,
      VIEW.centerX,
      panelCenterY + 62,
      'ASCEND',
      () => {
        if (resolved) return;
        resolved = true;
        close();
        this.ascend();
      },
      { width: panelWidth - 60, height: 104, fill: PALETTE.secondary, stroke: PALETTE.accent },
    );

    const cancel = new Button(
      this,
      VIEW.centerX,
      panelCenterY + 176,
      'NOT YET',
      () => {
        if (resolved) return;
        resolved = true;
        sfx('whoosh', { volume: 0.4 });
        close();
      },
      {
        width: panelWidth - 60,
        height: 96,
        fill: PALETTE.bgTop,
        stroke: PALETTE.primary,
        textColor: CSS.inkSoft,
        fontSize: '34px',
      },
    );

    root.add([dim, panel, heading, body, confirm, cancel]);
    return { destroy: close };
  }

  // --- rendering ----------------------------------------------------------

  private refreshHud(): void {
    const cashStep = Math.floor(this.eco.cash);
    if (cashStep !== this.shownCash && this.time.now >= this.countingUntilMs) {
      this.shownCash = cashStep;
      this.cashText.setText(formatCash(cashStep));
    }

    // Rate/goal are quantised so a fast economy does not re-layout text every
    // frame for a change nobody can read.
    const rate = this.eco.incomePerSec();
    const rateStep = Math.round(rate * 10);
    const multStep = Math.round(this.eco.prestigeMult * 100);
    const rateKey = rateStep * 100000 + multStep;
    if (rateKey !== this.shownRate) {
      this.shownRate = rateKey;
      this.rateText.setText(`+${formatRate(rate)}/s    x${this.eco.prestigeMult.toFixed(2)} MULT`);
    }

    const target = ECONOMY_SPEC.prestige.unlockAtTotalEarned;
    const available = this.eco.prestigeAvailable();
    const progress = Math.min(1, this.eco.totalEarned / target);
    // One quantised key drives the goal line AND the ASCEND label: 0.1 of a
    // multiplier when ready, 0.5% of the climb while locked. The locked branch
    // is encoded negative so the two step spaces can never collide.
    const goalStep = available
      ? Math.round(this.eco.prestigeGain() * 10)
      : -1 - Math.round(progress * 200);
    if (goalStep !== this.shownGoal) {
      this.shownGoal = goalStep;
      const gainLabel = `+${this.eco.prestigeGain().toFixed(2)} MULT`;
      this.goalText.setText(
        available
          ? `ASCEND READY   ${gainLabel}`
          : `EARNED ${formatCash(this.eco.totalEarned)} / ${formatCash(target)} TO ASCEND`,
      );
      if (available) this.prestigeButton.setLabel(`ASCEND  ${gainLabel}`);
    }
    if (this.prestigeButton.visible !== available) {
      this.prestigeButton.setVisible(available);
      if (available) {
        sfx('combo');
        pop(this, this.prestigeButton, 0.12, 260);
      }
    }

    // Music rides the climb toward the next ascension.
    const intensity = Math.round((0.2 + progress * 0.7) * 10) / 10;
    if (intensity !== this.shownIntensity) {
      this.shownIntensity = intensity;
      setMusicIntensity(intensity);
    }
  }

  private refreshRow(row: Row, force: boolean): void {
    const id = row.def.id;
    const owned = this.eco.ownedOf(id);
    const unlocked = this.eco.isUnlocked(id);
    const automated = this.eco.isAutomated(id);
    const mult = this.eco.prestigeMult;

    const structural =
      force ||
      owned !== row.shownOwned ||
      unlocked !== row.shownUnlocked ||
      automated !== row.shownAutomated ||
      mult !== row.shownMult;

    if (structural) {
      row.shownOwned = owned;
      row.shownUnlocked = unlocked;
      row.shownAutomated = automated;
      row.shownMult = mult;
      this.paintRowState(row, owned, unlocked, automated);
    }

    const cost = this.eco.buyCost(id, 1);
    const affordable = unlocked && this.eco.cash >= cost;
    if (affordable !== row.shownAffordable || structural) {
      row.shownAffordable = affordable;
      row.buy.setAlpha(unlocked ? (affordable ? 1 : 0.5) : 0.25);
    }

    if (row.automate) {
      const managerDef = MANAGER_BY_GENERATOR[id];
      const wanted = managerDef !== undefined && !automated && owned > 0;
      if (row.automate.visible !== wanted) row.automate.setVisible(wanted);
      if (wanted && managerDef) {
        const canAfford = this.eco.cash >= managerDef.cost;
        if (canAfford !== row.shownManagerAffordable || structural) {
          row.shownManagerAffordable = canAfford;
          row.automate.setAlpha(canAfford ? 1 : 0.45);
        }
      }
    }

    // Ready meter in 24 steps — a scale change per ~4% of the cycle.
    const manual = unlocked && owned > 0 && !automated;
    const step = manual ? Math.round(this.eco.collectReadyRatio(id) * 24) : -1;
    if (step !== row.shownReadyStep) {
      row.shownReadyStep = step;
      if (step < 0) {
        row.track.setVisible(false);
        row.fill.setVisible(false);
      } else {
        row.track.setVisible(true);
        row.fill.setVisible(true);
        row.fill.setDisplaySize(Math.max(2, (BAR_WIDTH * step) / 24), BAR_HEIGHT);
        row.fill.setFillStyle(step >= 24 ? PALETTE.good : PALETTE.accent);
      }
    }
  }

  /** The expensive half of a row repaint: strings and button labels. */
  private paintRowState(row: Row, owned: number, unlocked: boolean, automated: boolean): void {
    const id = row.def.id;
    const view = GENERATOR_VIEW[id];

    row.container.setAlpha(unlocked ? 1 : 0.55);
    row.icon.setAlpha(unlocked ? 1 : 0.35);
    row.nameText.setText(unlocked ? row.def.name : `${row.def.name}  (LOCKED)`);

    if (!unlocked) {
      row.ownedText.setText(`UNLOCKS AT ${formatCash(row.def.unlockAtTotalEarned ?? 0)} EARNED`);
      row.rateText.setText(view?.blurb ?? '');
      row.rateText.setColor(CSS.inkSoft);
      row.buy.setLabel('---');
      return;
    }

    row.ownedText.setText(`OWNED ${owned}`);

    if (owned <= 0) {
      row.rateText.setText(`${formatRate(row.def.baseIncomePerSec * this.eco.prestigeMult)}/s PER UNIT`);
      row.rateText.setColor(CSS.inkSoft);
    } else if (automated) {
      row.rateText.setText(`AUTO  +${formatRate(this.eco.generatorIncomePerSec(id))}/s`);
      row.rateText.setColor(CSS.good);
    } else {
      const perTap = this.eco.generatorIncomePerSec(id) * (row.def.cycleMs / 1000);
      row.rateText.setText(`TAP +${formatRate(perTap)} / ${(row.def.cycleMs / 1000).toFixed(0)}s`);
      row.rateText.setColor(CSS.accent);
    }

    row.buy.setLabel(`BUY ${formatCash(this.eco.buyCost(id, 1))}`);
    const managerDef = MANAGER_BY_GENERATOR[id];
    if (row.automate && managerDef) row.automate.setLabel(`AUTO ${formatCash(managerDef.cost)}`);
  }

  /** Counts the purse up instead of snapping when a payout is a real event. */
  private animateCash(from: number, to: number): void {
    const gained = to - from;
    if (gained <= 0) return;
    if (gained < Math.max(1, from * IDLE_TUNING.cashCountThreshold)) return;
    this.countingUntilMs = this.time.now + 420;
    this.shownCash = Math.floor(to);
    countTo(this, this.cashText, Math.floor(from), Math.floor(to), 400, formatCash);
  }

  private floatOnRow(row: Row, label: string, color: string, size: number): void {
    floatText(this, VIEW.centerX - 40, this.rowWorldY(row), label, color, size);
  }

  private rowWorldY(row: Row): number {
    return Phaser.Math.Clamp(this.content.y + row.container.y, VIEWPORT_TOP + 40, VIEWPORT_BOTTOM - 40);
  }

  // --- persistence --------------------------------------------------------

  private grantOfflineIncome(): number {
    const stamp = load<number>(STORE_STAMP, 0);
    if (typeof stamp !== 'number' || stamp <= 0) return 0;
    const elapsed = Date.now() - stamp;
    if (elapsed <= 0) return 0;
    return this.eco.grantOffline(elapsed, IDLE_TUNING.offlineCapHours);
  }

  private persist(): void {
    save(STORE_ECONOMY, this.eco.snapshot());
    save(STORE_STAMP, Date.now());
  }

  /**
   * Scene shutdown destroys children before every listener has run, so this
   * handler touches nothing but the economy and storage (see AGENTS.md).
   */
  private handleShutdown(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.persist();
  }
}
