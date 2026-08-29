import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../../config';
import { SCENES, TEX } from '../../core/keys';
import { Rng } from '../../core/rng';
import { sessionSeed } from '../../core/daily';
import { sfx } from '../../core/audio';
import { setMusicIntensity, startMusic } from '../../core/music';
import { burst, flash, floatText, pop, shake } from '../../core/juice';
import type { SessionOutcome } from '../../core/session';
import { addBackground } from '../../ui/background';
import { Button } from '../../ui/button';
import { drawPanel } from '../../ui/primitives';
import { showPauseOverlay, type PauseOverlayHandle } from '../../ui/pauseOverlay';
import {
  showBoosterPicker,
  type BoosterGlyph,
  type BoosterPickerHandle,
} from '../../ui/boosterBar';
import { boosterCount, loadMeta, spendBooster, touchDailyStreak } from '../../core/progression';
import { metaCatalogFor } from '../../data/metaCatalog';
import { ICON, type ArtSlot } from '../../data/art';
import { DiceLoop, GOAL_SETS, PIECE_NAMES, buildRing, type RollEvent, type TileType } from './board';
import { TABLE_TUNING } from './tuning';

/** `extra-rolls` booster and `meta_loaded_dice` perk (`data/metaCatalog.ts`). */
const BOOSTER_EXTRA_ROLLS = 'extra-rolls';
const PERK_LOADED_DICE = 'meta_loaded_dice';

/**
 * Booster art by id, for the icon-only picker slots. `data/art.ts` only names
 * icons that were actually drawn, so reading the registry through a loose
 * index means a missing key is `undefined` and the slot falls back to its
 * primitive instead of failing the build.
 */
const BOOSTER_ICON: Record<string, ArtSlot | undefined> = {
  [BOOSTER_EXTRA_ROLLS]: ICON.star,
};

/** Primitive per booster id when its art slot has not resolved. */
const BOOSTER_FALLBACK: Record<string, { texture: string; tint: number }> = {
  [BOOSTER_EXTRA_ROLLS]: { texture: TEX.star, tint: PALETTE.accent },
};

/**
 * Art groups `PreloadScene` loads for this slice (see the slice-wiring guide):
 * `table-icons` is the tile/dice icon sheet, addressed by frame.
 */
export const ART_GROUPS = ['ui', 'bg', 'table-icons'] as const;

/** Per-tile-type presentation. Rules live in `board.ts`, colours live here. */
const TILE_STYLE: Record<string, { fill: number; icon: string; tint: number; label: string }> = {
  coin: { fill: 0x1b2740, icon: TEX.disc, tint: PALETTE.accent, label: '+' },
  chest: { fill: 0x2b2340, icon: TEX.star, tint: PALETTE.accent, label: 'CHEST' },
  loss: { fill: 0x3a1b26, icon: TEX.spike, tint: PALETTE.bad, label: 'LOSS' },
  rollagain: { fill: 0x14313d, icon: TEX.ring, tint: PALETTE.primary, label: 'AGAIN' },
  collect: { fill: 0x18342a, icon: TEX.square, tint: PALETTE.good, label: 'SET' },
};

/**
 * Family G (dice-board) slice: tap ROLL, the token hops around a 20-tile ring,
 * and the tile it lands on pays out. Win by collecting three set pieces before
 * the roll budget runs out.
 *
 * The scene owns no rules — `DiceLoop` resolves a roll synchronously and this
 * class replays it as hops, juice and HUD.
 */
export class GameScene extends Phaser.Scene {
  private rng!: Rng;
  private seed = '';
  private loop!: DiceLoop;

  private token!: Phaser.GameObjects.Image;
  private tileX: number[] = [];
  private tileY: number[] = [];
  private piecePips: Phaser.GameObjects.Image[] = [];
  private rollButton!: Button;
  private pauseButton!: Button;

  private rollsText!: Phaser.GameObjects.Text;
  private setsText!: Phaser.GameObjects.Text;
  private coinsText!: Phaser.GameObjects.Text;
  private rollsShown = '';
  private setsShown = '';
  private coinsShown = '';

  private animating = false;
  private paused = false;
  private ended = false;
  /** True once the ring is dealt: the picker phase has no loop to tick. */
  private started = false;
  /** A seed in `init` data means "replay this session" — no picker. */
  private replay = false;
  private boosterPicker: BoosterPickerHandle | null = null;
  /** Loaded-dice rerolls this session was granted, for the results row. */
  private loadedRerolls = 0;
  private pendingOutcome: SessionOutcome | null = null;
  private pauseOverlay: PauseOverlayHandle | null = null;

  constructor() {
    super(SCENES.game);
  }

  /**
   * `scene.start(SCENES.game, { seed })` replays the exact same board and dice
   * with no pre-session picker — boosters are consumed goods, so a replay is
   * the un-boosted session.
   */
  init(data: { seed?: string } = {}): void {
    this.replay = data.seed !== undefined;
    this.seed = data.seed ?? sessionSeed();
  }

  create(): void {
    this.animating = false;
    this.paused = false;
    this.ended = false;
    this.started = false;
    this.pendingOutcome = null;
    this.pauseOverlay = null;
    this.boosterPicker = null;
    this.loadedRerolls = 0;
    this.rollsShown = '';
    this.setsShown = '';
    this.coinsShown = '';
    this.tileX = [];
    this.tileY = [];
    this.piecePips = [];

    // One seed drives the ring layout AND every dice face, so a replay of the
    // same seed plays out identically.
    this.rng = new Rng(this.seed);

    addBackground(this);
    this.markDailyStreak();

    if (this.replay) this.beginSession([]);
    else this.offerBoosters();
  }

  /** Advances the daily streak once per entry; celebrates only real growth. */
  private markDailyStreak(): void {
    const streak = touchDailyStreak();
    if (!streak.extended) return;
    this.time.delayedCall(520, () => {
      floatText(this, VIEW.centerX, SAFE.top + 70, `DAY ${streak.days} STREAK!`, CSS.accent, 46);
      sfx('combo', { volume: 0.5 });
    });
  }

  /**
   * Pre-session booster offer off the table catalog (`data/metaCatalog.ts`).
   * There is no level ladder in this family, so the picker IS the meta gate —
   * and a player who owns nothing never sees it.
   */
  private offerBoosters(): void {
    const offers = metaCatalogFor('table')
      .filter((entry) => entry.kind === 'booster' && entry.boosterId !== undefined)
      .map((entry) => ({
        id: entry.boosterId as string,
        name: entry.name.toUpperCase(),
        count: boosterCount(entry.boosterId as string),
        glyph: this.glyphFor(entry.boosterId as string),
      }));

    if (offers.every((offer) => offer.count === 0)) {
      this.beginSession([]);
      return;
    }

    this.boosterPicker = showBoosterPicker(this, {
      boosters: offers,
      maxPick: TABLE_TUNING.meta.maxPick,
      onStart: (selected) => {
        this.boosterPicker?.destroy();
        this.boosterPicker = null;
        this.beginSession(selected);
      },
      // The gate is a decision, not a commitment: this family has no map to
      // walk back to, so closing it deals the session with nothing spent.
      onClose: () => {
        sfx('ui', { volume: 0.4 });
        this.boosterPicker?.destroy();
        this.boosterPicker = null;
        this.beginSession([]);
      },
    });
  }

  /**
   * The icon a booster slot draws: generated art when its slot resolves, the
   * tinted primitive otherwise.
   */
  private glyphFor(id: string): BoosterGlyph {
    const fallback = BOOSTER_FALLBACK[id] ?? { texture: TEX.disc, tint: PALETTE.primary };
    return { art: BOOSTER_ICON[id] ?? null, texture: fallback.texture, tint: fallback.tint };
  }

  /**
   * Deals the ring and starts the roll budget. Boosters are spent HERE, so a
   * picker the player backs out of costs them nothing.
   */
  private beginSession(boosters: readonly string[]): void {
    let extraRolls = 0;
    for (const id of boosters) {
      if (!spendBooster(id)) continue;
      if (id === BOOSTER_EXTRA_ROLLS) extraRolls += TABLE_TUNING.meta.rollsPerBooster;
    }

    // `meta_loaded_dice` is a standing perk: rerolls are stocked per session,
    // and the pure loop defaults to zero of them (so the gated balance of an
    // un-perked session is untouched).
    this.loadedRerolls =
      (loadMeta().upgrades[PERK_LOADED_DICE] ?? 0) * TABLE_TUNING.meta.loadedDiceRerollsPerLevel;

    // `extra-rolls` widens a COPY of the rules the sim gates, never the data.
    const rules =
      extraRolls > 0
        ? { ...TABLE_TUNING.rules, rolls: TABLE_TUNING.rules.rolls + extraRolls }
        : TABLE_TUNING.rules;

    this.loop = new DiceLoop(buildRing(this.rng, TABLE_TUNING.tiles), rules, {
      // The model resolves a roll instantly; the outcome is held back until the
      // token has finished hopping so the player sees what killed the run.
      onEnd: (outcome) => {
        this.pendingOutcome = outcome;
      },
      loadedRerolls: this.loadedRerolls,
    });

    this.buildRingView();
    this.buildHud();

    const tokenSlot = this.resolveSlot(TABLE_TUNING.art.token);
    this.token = this.add
      .image(this.tileX[0] ?? VIEW.centerX, this.tileY[0] ?? VIEW.centerY, tokenSlot?.key ?? TEX.disc, tokenSlot?.frame)
      .setDisplaySize(TABLE_TUNING.ring.tokenSize, TABLE_TUNING.ring.tokenSize)
      .setDepth(40);
    if (tokenSlot === null) this.token.setTint(PALETTE.primary);

    this.rollButton = new Button(
      this,
      VIEW.centerX,
      VIEW.height - SAFE.bottom / 2 - 30,
      'ROLL',
      () => this.doRoll(),
      {
        width: TABLE_TUNING.roll.buttonWidth,
        height: TABLE_TUNING.roll.buttonHeight,
        fill: PALETTE.primary,
        stroke: PALETTE.ink,
        fontSize: '52px',
      },
    );
    this.rollButton.setDepth(1500);

    this.pauseButton = new Button(
      this,
      VIEW.width - SAFE.side - 44,
      SAFE.top / 2,
      'II',
      () => this.togglePause(),
      {
        width: 88,
        height: 88,
        fill: PALETTE.bgTop,
        stroke: PALETTE.primary,
        textColor: '#e8ecf6',
        fontSize: '36px',
      },
    );
    this.pauseButton.setDepth(1500);

    this.input.keyboard?.on('keydown-ESC', () => this.togglePause());
    this.input.keyboard?.on('keydown-SPACE', () => this.doRoll());

    this.refreshHud();
    this.started = true;
    this.cameras.main.fadeIn(220, 0, 0, 0);
    startMusic('run');
    setMusicIntensity(0.3);

    if (extraRolls > 0) {
      floatText(this, VIEW.centerX, SAFE.top + 118, `+${extraRolls} ROLLS`, CSS.accent, 40);
    }
    if (this.loadedRerolls > 0) {
      floatText(this, VIEW.centerX, SAFE.top + 160, `LOADED DICE x${this.loadedRerolls}`, CSS.good, 36);
    }
  }

  update(_time: number, delta: number): void {
    if (!this.started || this.ended || this.paused) return;
    // No time budget on this family — the clock only feeds the results screen.
    this.loop.level.update(delta);
  }

  /** Tiles on an ellipse, tile 0 at the top, clockwise. */
  private buildRingView(): void {
    const { centerY, radiusX, radiusY, tileSize, iconScale } = TABLE_TUNING.ring;
    const count = this.loop.tiles.length;
    for (let i = 0; i < count; i += 1) {
      const angle = -Math.PI / 2 + (i / count) * Math.PI * 2;
      const x = VIEW.centerX + Math.cos(angle) * radiusX;
      const y = centerY + Math.sin(angle) * radiusY;
      this.tileX.push(x);
      this.tileY.push(y);

      const tile: TileType = this.loop.tiles[i] ?? 'coin';
      const style = TILE_STYLE[tile] ?? TILE_STYLE.coin!;
      // Plate and ring are chrome and stay procedural; only the tile ICON has
      // an art slot, drawn untinted once it resolves.
      this.add
        .image(x, y, TEX.square)
        .setDisplaySize(tileSize, tileSize)
        .setTint(style.fill)
        .setDepth(10);
      this.add
        .image(x, y, TEX.ring)
        .setDisplaySize(tileSize, tileSize)
        .setTint(style.tint)
        .setAlpha(0.5)
        .setDepth(11);
      const iconSlot = this.resolveSlot(TABLE_TUNING.art.tiles[tile]);
      const icon = this.add
        .image(x, y, iconSlot?.key ?? style.icon, iconSlot?.frame)
        .setDepth(12);
      if (iconSlot === null) icon.setScale(iconScale).setTint(style.tint);
      else icon.setDisplaySize(tileSize * 0.6, tileSize * 0.6);
    }
  }

  private buildHud(): void {
    const plate = drawPanel(this, 480, 92, {
      fill: PALETTE.bgTop,
      fillAlpha: 0.9,
      stroke: PALETTE.primary,
      radius: 26,
    });
    plate.setPosition(300, SAFE.top / 2).setScrollFactor(0).setDepth(1200);

    const style = { ...TEXT.body, fontSize: '28px', color: CSS.ink };
    this.rollsText = this.add
      .text(140, SAFE.top / 2, '', style)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1210);
    this.setsText = this.add
      .text(300, SAFE.top / 2, '', style)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1210);
    this.coinsText = this.add
      .text(462, SAFE.top / 2, '', { ...style, color: CSS.accent })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1210);

    // Set pieces read as three sockets that light up — the goal at a glance.
    const pipY = VIEW.height - SAFE.bottom - 80;
    for (let i = 0; i < TABLE_TUNING.rules.piecesTarget; i += 1) {
      const x = VIEW.centerX + (i - 1) * 120;
      this.add.image(x, pipY, TEX.ring).setDisplaySize(78, 78).setTint(PALETTE.inkSoft).setAlpha(0.4);
      const pip = this.add
        .image(x, pipY, TEX.star)
        .setDisplaySize(50, 50)
        .setTint(PALETTE.inkSoft)
        .setAlpha(0.25);
      this.piecePips.push(pip);
      this.add
        .text(x, pipY + 54, PIECE_NAMES[i] ?? '', { ...TEXT.label, fontSize: '20px' })
        .setOrigin(0.5);
    }
  }

  private doRoll(): void {
    if (!this.started || this.animating || this.paused || this.ended || this.loop.level.ended) return;

    const event = this.loop.roll(this.rng);
    if (event === null) return;

    this.animating = true;
    this.rollButton.setAlpha(TABLE_TUNING.roll.disabledAlpha);
    this.refreshHud();

    sfx('whoosh', { volume: 0.35 });
    this.showDiceFace(event);

    this.hop(event, this.loop.path(event.from, event.roll), 0);
  }

  /**
   * The rolled face: the art slot for that face when the dice sheet is loaded,
   * and the big number otherwise. A rerolled natural 1 says so, or the perk
   * would look like the dice cheating in the player's favour by accident.
   */
  private showDiceFace(event: RollEvent): void {
    const faceSlot = this.resolveSlot(TABLE_TUNING.art.faces[event.roll - 1] ?? null);
    const y = TABLE_TUNING.ring.centerY - 40;
    if (faceSlot === null) {
      floatText(this, VIEW.centerX, y, `${event.roll}`, CSS.primary, 110);
    } else {
      const pip = this.add
        .image(VIEW.centerX, y, faceSlot.key, faceSlot.frame)
        .setDisplaySize(TABLE_TUNING.ring.tileSize, TABLE_TUNING.ring.tileSize)
        .setDepth(1300);
      this.tweens.add({
        targets: pip,
        y: y - 60,
        alpha: 0,
        duration: 620,
        ease: 'Quad.easeOut',
        onComplete: () => pip.destroy(),
      });
    }
    if (event.rerolled) {
      floatText(this, VIEW.centerX, y + 70, 'LOADED DICE', CSS.good, 36);
    }
  }

  /**
   * The slot to draw with, or `null` when its texture never loaded (pruned art
   * group, or art that does not exist yet).
   */
  private resolveSlot(slot: ArtSlot | null): ArtSlot | null {
    if (slot === null) return null;
    return this.textures.exists(slot.key) ? slot : null;
  }

  /** One tween per tile, chained — never a tween per frame. */
  private hop(event: RollEvent, path: readonly number[], index: number): void {
    const target = path[index];
    if (target === undefined) {
      this.time.delayedCall(TABLE_TUNING.settleMs, () => this.payout(event));
      return;
    }
    this.tweens.add({
      targets: this.token,
      x: this.tileX[target] ?? this.token.x,
      y: this.tileY[target] ?? this.token.y,
      duration: TABLE_TUNING.hopMs,
      ease: 'Quad.easeInOut',
      onComplete: () => {
        if (this.ended) return;
        sfx('tap', { volume: 0.2, rate: 1 + index * 0.06 });
        this.hop(event, path, index + 1);
      },
    });
  }

  /** Replays the already-resolved tile effect as feedback. */
  private payout(event: RollEvent): void {
    if (this.ended) return;
    const x = this.tileX[event.to] ?? VIEW.centerX;
    const y = this.tileY[event.to] ?? VIEW.centerY;
    pop(this, this.token, 0.35, 200);

    switch (event.tile) {
      case 'coin':
        burst(this, x, y, PALETTE.accent, 8, 200);
        floatText(this, x, y - 40, `+${event.delta}`, CSS.accent, 40);
        sfx('pickup', { volume: 0.4 });
        break;
      case 'chest':
        burst(this, x, y, PALETTE.accent, 24, 420);
        flash(this, PALETTE.accent, 150);
        floatText(this, x, y - 40, `CHEST +${event.delta}`, CSS.accent, 46);
        sfx('levelup', { volume: 0.7 });
        break;
      case 'loss':
        shake(this, 0.016, 240);
        floatText(
          this,
          x,
          y - 40,
          event.delta === 0 ? 'EMPTY' : `${event.delta}`,
          CSS.bad,
          46,
        );
        sfx('hit', { volume: 0.6 });
        break;
      case 'rollagain':
        burst(this, x, y, PALETTE.primary, 12, 260);
        floatText(this, x, y - 40, 'ROLL AGAIN', CSS.primary, 40);
        sfx('combo', { volume: 0.6 });
        break;
      case 'collect':
        burst(this, x, y, PALETTE.good, 20, 360);
        flash(this, PALETTE.good, 130);
        floatText(this, x, y - 40, `${PIECE_NAMES[event.piece ?? 0] ?? 'SET'}!`, CSS.good, 48);
        sfx('levelup');
        this.lightPip(event.piece ?? 0);
        setMusicIntensity(0.3 + 0.6 * (this.loop.pieces / TABLE_TUNING.rules.piecesTarget));
        break;
    }

    this.animating = false;
    this.rollButton.setAlpha(1);
    this.refreshHud();

    if (this.pendingOutcome !== null) {
      const outcome = this.pendingOutcome;
      this.time.delayedCall(520, () => this.finish(outcome));
    }
  }

  private lightPip(index: number): void {
    const pip = this.piecePips[index];
    if (pip === undefined) return;
    pip.setTint(PALETTE.good).setAlpha(1);
    pop(this, pip, 0.6, 260);
  }

  /** Text is diffed: an unchanged HUD value never touches `setText`. */
  private refreshHud(): void {
    const rolls = `ROLLS ${this.loop.level.movesLeft ?? 0}`;
    if (rolls !== this.rollsShown) {
      this.rollsShown = rolls;
      this.rollsText.setText(rolls);
    }
    const goal = this.loop.level.goalProgress(GOAL_SETS);
    const sets = `SETS ${goal.current}/${goal.target}`;
    if (sets !== this.setsShown) {
      this.setsShown = sets;
      this.setsText.setText(sets);
    }
    const coins = `${this.loop.coins}c`;
    if (coins !== this.coinsShown) {
      this.coinsShown = coins;
      this.coinsText.setText(coins);
    }
  }

  private togglePause(): void {
    if (this.ended || this.animating) return;
    if (this.paused) {
      this.resumeFromPause();
      return;
    }
    this.paused = true;
    this.loop.level.pause();
    this.rollButton.setAlpha(TABLE_TUNING.roll.disabledAlpha);
    this.pauseOverlay = showPauseOverlay(this, {
      onResume: () => this.resumeFromPause(),
      onRestart: () => {
        this.pauseOverlay?.destroy();
        this.pauseOverlay = null;
        this.scene.restart({ seed: Date.now().toString(36) });
      },
      onMenu: () => this.quitToMenu(),
    });
  }

  private resumeFromPause(): void {
    this.paused = false;
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
    this.loop.level.resume();
    this.rollButton.setAlpha(1);
  }

  /**
   * Abandons the session for the menu — the exit the pause overlay's MENU row
   * is. Loops and queued timers die HERE: one firing after `scene.start`
   * touches a scene that no longer exists (the black-screen trap in
   * AGENTS.md).
   */
  private quitToMenu(): void {
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
    this.boosterPicker?.destroy();
    this.boosterPicker = null;
    this.ended = true;
    this.paused = false;
    this.started = false;
    this.loop.level.pause();
    this.tweens.killAll();
    this.time.removeAllEvents();
    setMusicIntensity(0.2);
    sfx('ui', { volume: 0.4 });
    this.scene.start(SCENES.menu);
  }

  private finish(outcome: SessionOutcome): void {
    if (this.ended) return;
    this.ended = true;
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;

    sfx(outcome.won ? 'levelup' : 'die');
    flash(this, outcome.won ? PALETTE.good : PALETTE.bad, 260);
    shake(this, 0.018, 280);
    setMusicIntensity(0.2);

    const level = this.loop.level;
    const goal = level.goalProgress(GOAL_SETS);
    const score = this.loop.coins + this.loop.pieces * TABLE_TUNING.scorePerPiece;

    this.cameras.main.fadeOut(340, 0, 0, 0);
    this.time.delayedCall(360, () => {
      this.scene.start(SCENES.gameOver, {
        won: outcome.won,
        timeMs: level.elapsedSeconds * 1000,
        score,
        currencyEarned: Math.floor(this.loop.coins / TABLE_TUNING.coinsPerCurrency),
        seed: this.seed,
        stats: [
          { label: 'ROLLS LEFT', value: `${level.movesLeft ?? 0}` },
          { label: 'SETS', value: `${goal.current}/${goal.target}` },
          { label: 'COINS', value: `${this.loop.coins}` },
          ...(this.loadedRerolls > 0
            ? [{ label: 'REROLLS LEFT', value: `${this.loop.rerollsLeft}` }]
            : []),
        ],
        headline: outcome.won ? 'SET COMPLETE!' : 'OUT OF ROLLS',
        // A roll budget, not a clock: elapsed time is not a result here.
        timeLabel: null,
        bestTimeMode: 'off',
      });
    });
  }
}
