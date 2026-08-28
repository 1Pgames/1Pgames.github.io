import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../../config';
import { SCENES, TEX } from '../../core/keys';
import { Rng } from '../../core/rng';
import { load, save } from '../../core/storage';
import { sfx, sfxArp } from '../../core/audio';
import { setMusicIntensity, startMusic } from '../../core/music';
import { burst, flash, floatText, pop, shake } from '../../core/juice';
import { LevelDirector, type LevelGoal } from '../../core/level';
import type { ResultStat, SessionOutcome } from '../../core/session';
import { Board } from '../../core/board/grid';
import {
  findRuns,
  findValidMoves,
  hasDeadBoard,
  reshuffle,
  resolveCascades,
  swapProducesMatch,
} from '../../core/board/resolve';
import type { BoardSpec, CascadeStep, Cell, Piece, SpecialKind, Swap } from '../../core/board/types';
import { JAR_KIND, areAdjacent, isJar, isMovable, isVined, sameCell } from '../../core/board/types';
import { applyInLevelBooster, type InLevelBoosterId } from '../../core/board/boosters';
import { mercyPool } from '../../core/board/mercy';
import {
  MAX_STARS,
  bestStars,
  boosterCount,
  recordStars,
  spendBooster,
  touchDailyStreak,
} from '../../core/progression';
import { metaCatalogFor } from '../../data/metaCatalog';
import { ICON, type ArtSlot } from '../../data/art';
import { addBackground } from '../../ui/background';
import { Button } from '../../ui/button';
import { drawPanel, drawPill } from '../../ui/primitives';
import { showPauseOverlay, type PauseOverlayHandle } from '../../ui/pauseOverlay';
import { showSagaMap, type SagaMapHandle } from '../../ui/sagaMap';
import {
  showBoosterPicker,
  showBoosterTray,
  type BoosterGlyph,
  type BoosterPickerHandle,
  type BoosterTrayHandle,
} from '../../ui/boosterBar';
import {
  hasSeenCoach,
  showCoach,
  type CoachHandle,
  type CoachOptions,
  type CoachRect,
} from '../../ui/coach';
import { BOARD_KIND_STYLES, BOARD_TUNING } from './tuning';
import type { BoardKindStyle } from './tuning';
import {
  BOARD_LAST_LEVEL_KEY,
  BOARD_LEVELS,
  BOARD_PROGRESS_KEY,
  boardSpecFor,
  clampBoardLevel,
} from './levels';

/**
 * Family B reference slice: a move-budgeted match-3 with cascades, line/bomb
 * specials, collect-N goals and a 10-level ladder.
 *
 * The scene owns NO puzzle logic. `core/board/*` resolves a move into a list of
 * `CascadeStep`s and `core/level.ts` owns win/lose; everything here is
 * translation — tweens, particles, sfx and a diffed HUD. That split is what
 * lets the same engine drive the blast, merge, sort and block variants later.
 *
 * The meta layer wraps that loop rather than living inside it: entering from
 * the menu opens the saga map (`ui/sagaMap.ts`) over the backdrop, the pick
 * opens the booster picker (`ui/boosterBar.ts`), and only then is a board
 * dealt. A win writes `recordStars`, so the map the player comes back to shows
 * what they actually earned.
 */

/**
 * Art groups `PreloadScene` loads for this slice (see the slice-wiring guide).
 * `ui` + `bg` are universal (HUD glyphs, menu emblem, `ui/background.ts`);
 * `board-pieces` is where this family's gem sheet and special overlays live.
 */
export const ART_GROUPS = ['ui', 'bg', 'board-pieces'] as const;

interface PieceView {
  root: Phaser.GameObjects.Container;
  badge: Phaser.GameObjects.Image | null;
  /** Vine overlay, present only while this piece is held. */
  vine: Phaser.GameObjects.Image | null;
  /**
   * Looping tweens this view owns. Cascades recycle views constantly, so an
   * infinite tween that outlives its target is a leak that keeps ticking:
   * every one of them is registered here and killed in `releaseView`.
   */
  loops: Phaser.Tweens.Tween[];
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

/**
 * Booster/blocker glyphs by id. `data/art.ts` is generated from the art
 * manifest, so these keys appear only once the icons are actually drawn —
 * reading the registry through a loose index means a missing key is `undefined`
 * and every chip falls back to its primitive instead of failing the build.
 *
 * `bomb-start` is the catalog's id for the opening bomb (`data/metaCatalog.ts`,
 * and the one `beginLevel` arms); `opening-bomb` is what the art sheet calls
 * its frame. The alias is what keeps an ICON-ONLY chip from rendering as a
 * blank disc — there is no label left to carry the meaning.
 */
const ICON_REGISTRY: Readonly<Record<string, ArtSlot | undefined>> = ICON;
const ICON_BY_ID: Readonly<Record<string, ArtSlot | undefined>> = {
  ...ICON_REGISTRY,
  'bomb-start': ICON_REGISTRY['opening-bomb'],
};

/** Procedural fallback per booster/blocker id, used until its icon ships. */
const GLYPH_FALLBACK: Readonly<Record<string, { texture: string; tint: number }>> = {
  'extra-moves': { texture: TEX.star, tint: PALETTE.accent },
  shuffle: { texture: TEX.ring, tint: PALETTE.primary },
  'opening-bomb': { texture: TEX.disc, tint: PALETTE.bad },
  'bomb-start': { texture: TEX.disc, tint: PALETTE.bad },
  ladle: { texture: TEX.disc, tint: PALETTE.accent },
  broom: { texture: TEX.square, tint: PALETTE.primary },
  pestle: { texture: TEX.square, tint: PALETTE.accent },
  whisk: { texture: TEX.ring, tint: PALETTE.primary },
};

/**
 * In-level tray chips: the id is both the icon key and the booster id.
 *
 * Four tools, one per shape of "I cannot get there from here": one cell, one
 * row, one column, and "none of these pieces are where I need them". Two was
 * not a kit — a row-only sweep on a board taller than it is wide left the
 * vertical half of every layout unanswerable, and a stuck-but-legal board had
 * no answer at all short of burning moves on it.
 */
const TRAY_CHIPS: readonly {
  id: InLevelBoosterId;
  label: string;
  prompt: string;
  /** No aim to take: the chip tap is the whole input (see `ui/boosterBar.ts`). */
  immediate?: boolean;
}[] = [
  { id: 'ladle', label: 'LADLE', prompt: 'TAP A PIECE' },
  { id: 'broom', label: 'BROOM', prompt: 'TAP A ROW' },
  { id: 'pestle', label: 'PESTLE', prompt: 'TAP A COLUMN' },
  { id: 'whisk', label: 'WHISK', prompt: 'STIRRING THE POT', immediate: true },
];

/** The three tools that take the next board tap as their target. */
type AimedBoosterId = Exclude<InLevelBoosterId, 'whisk'>;

/**
 * The same ids as a membership table: the pre-level picker offers every board
 * booster EXCEPT these, because a targeted consumable can only be aimed once
 * the board is on screen — and the whisk is only worth spending on a board the
 * player has already read and disliked.
 */
const IN_LEVEL_IDS: Readonly<Record<string, true>> = {
  ladle: true,
  broom: true,
  pestle: true,
  whisk: true,
};

/**
 * Jar fallback colour: the shelf's own bordeaux-walnut trim, so a jar reads as
 * furniture rather than as a sixth ingredient. It is a `PALETTE` key on
 * purpose — a jar is chrome, and chrome re-skins with the UI.
 */
const JAR_FALLBACK_TINT = PALETTE.secondary;

/** Width of the in-level SHUFFLE control, which shares the booster row. */
const SHUFFLE_WIDTH = 160;

/**
 * The one HUD state row: the MOVES pill on the left, the goal chips filling
 * what is left of it. Two stacked rows (budget, then goals) cost 70px of the
 * board's band to say two things that read fine side by side — and the board
 * is what the player is actually looking at.
 */
const HUD_ROW_Y = 196;
const HUD_ROW_HEIGHT = 76;
const MOVES_PILL_WIDTH = 200;
/** Gap between the MOVES pill and the goal chips beside it. */
const HUD_ROW_GAP = 16;
/** Score line, tucked under the level title inside the safe band. */
const SCORE_Y = 118;
/** Below this chip width a goal stacks its count under its glyph. */
const GOAL_CHIP_NARROW_WIDTH = 150;

/**
 * One queued coach beat (`ui/coach.ts`). The options are BUILT when the beat
 * reaches the screen rather than when it is queued: the swap the first-move
 * lesson gates on, and the jar it points at, both have to be read off the board
 * as it is at that moment — a rect captured three beats earlier is a rect over
 * whatever the cascades left behind.
 */
interface CoachBeat {
  id: string;
  /** `null` means "nothing to teach on this board after all": skip the beat. */
  build: () => Omit<CoachOptions, 'id'> | null;
}

/**
 * Tutorial copy, in one block because it is the only writing in the slice the
 * player reads as instruction rather than as flavour. One line each, and each
 * one names the ACTION and not the noun ("match next to them", not "jars are
 * blockers") — a coach mark the player has to interpret has failed.
 */
const COACH_COPY = {
  goals: 'Fill every order before moves run out',
  moves: 'Every swap costs one move',
  firstSwap: 'Swap these two to match 3',
  jar: 'Sealed jars crack when you match NEXT to them',
  vine: 'Vines root a piece — match it or next to it to cut it free',
  tray: 'Tap a tool, then tap the board — tools never cost a move',
} as const;

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
  /**
   * Cell-sized warm glow under the selected piece, in its OWN layer below the
   * pieces — a highlight the board can draw on top of, not a ring that fights
   * the glyph for the same 70px.
   */
  private selectorLayer!: Phaser.GameObjects.Container;
  private selector!: Phaser.GameObjects.Container;
  private selectorPulse: Phaser.Tweens.Tween | null = null;
  private selectedView: PieceView | null = null;
  private selected: Cell | null = null;

  /**
   * Board geometry for the ACTIVE level, derived in `buildBoardLayer` from the
   * dealt board's own dimensions — every level may size its grid differently.
   */
  private cols = 0;
  private rows = 0;
  private cellPx = 0;
  /** `cellPx / layout.styleCellPx`: every piece-sized visual scales by this. */
  private pieceScale = 1;
  private boardTop = 0;
  private originX = 0;
  private boardWidth = 0;
  private boardHeight = 0;

  /** The dealt spec, kept because the mercy pool is drawn from its kinds. */
  private boardSpec!: BoardSpec;
  /** The live goals as `mercyPool` wants them, built once per level. */
  private goalKinds: readonly { kind: string }[] = [];
  /** Mercy narrows the refill pool ONCE per level; this is that latch. */
  private mercyApplied = false;
  /**
   * Scratch for `renderFalls`: a whisk's permutation needs every source view
   * read before any destination is written, and a cascade is far too hot a path
   * to allocate an array per step for that.
   */
  private readonly fallScratch: (PieceView | null)[] = [];

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

  /** Boosters armed for THIS level; each id was spent when the level began. */
  private readonly armedBoosters = new Set<string>();
  private shuffleCharges = 0;
  private shuffleButton: Button | null = null;
  /** In-level consumables: the tray owns the armed state, the scene resolves it. */
  private boosterTray: BoosterTrayHandle | null = null;
  /** True once a board exists: the map/picker phase has no director to tick. */
  private started = false;
  /** Level asked for explicitly by the caller, bypassing the map. */
  private requestedLevel: number | null = null;
  /** A seed in `init` data means "replay a level", never "pick a new one". */
  private replay = false;
  private sagaMap: SagaMapHandle | null = null;
  private boosterPicker: BoosterPickerHandle | null = null;
  private mapBackdrop: Phaser.GameObjects.Rectangle | null = null;

  /**
   * Coach marks, one at a time and never stacked: beats wait in this queue and
   * the one on screen is `activeCoach`. Two overlays teaching two different
   * things at once teach neither, and a level start can legitimately have
   * three lessons due (the ladder's first order, its first jar, the tray).
   */
  private coachQueue: CoachBeat[] = [];
  private activeCoach: CoachHandle | null = null;
  /** True from the first beat of a run of coaches until the last one closes. */
  private coachActive = false;
  /**
   * The ONE swap the first-move lesson accepts. The coach's dim already makes
   * every other cell untappable, so this only has to catch the drag that starts
   * on a gated cell and aims away from its partner.
   */
  private gatedSwap: Swap | null = null;
  /** Union rect of the goal chips, captured by `buildHud` for the goals beat. */
  private goalRowRect: CoachRect | null = null;

  constructor() {
    super(SCENES.game);
  }

  /**
   * `scene.start(SCENES.game, { seed })` replays the level in
   * `BOARD_LAST_LEVEL_KEY` with the exact same deal and NO map or picker —
   * that is what RETRY and the pause overlay's RESTART both send. A bare
   * start (from the menu) opens the map instead; `levelIndex` skips straight
   * to one level.
   */
  init(data: { seed?: string; levelIndex?: number } = {}): void {
    this.replay = data.seed !== undefined;
    this.seed = data.seed ?? Date.now().toString(36);
    this.requestedLevel = data.levelIndex === undefined ? null : clampBoardLevel(data.levelIndex);
  }

  create(): void {
    this.score = 0;
    this.busy = false;
    this.paused = false;
    this.ended = false;
    this.disposed = false;
    this.started = false;
    this.pendingOutcome = null;
    this.selected = null;
    this.selectedView = null;
    this.selectorPulse = null;
    this.downCell = null;
    this.goalChips = [];
    this.shownMoves = '';
    this.shownScore = '';
    this.shuffleCharges = 0;
    this.mercyApplied = false;
    this.shuffleButton = null;
    this.boosterTray = null;
    this.sagaMap = null;
    this.boosterPicker = null;
    this.mapBackdrop = null;
    this.coachQueue = [];
    this.activeCoach = null;
    this.coachActive = false;
    this.gatedSwap = null;
    this.goalRowRect = null;
    this.armedBoosters.clear();
    this.styleByKind.clear();
    for (const style of BOARD_KIND_STYLES) this.styleByKind.set(style.id, style);

    addBackground(this, false);
    this.cameras.main.fadeIn(220, 0, 0, 0);
    startMusic('run');
    setMusicIntensity(0.28);

    // A timer or tween that outlives the scene must not touch it: every
    // deferred callback checks `disposed` first (see AGENTS.md shutdown trap).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.disposed = true;
    });

    this.markDailyStreak();

    const explicit = this.requestedLevel;
    if (explicit !== null) {
      this.beginLevel(explicit, []);
      return;
    }
    if (this.replay) {
      // Boosters are consumed goods: a replay is the un-boosted level, only
      // the same one.
      this.beginLevel(clampBoardLevel(load<number>(BOARD_LAST_LEVEL_KEY, 0)), []);
      return;
    }
    this.openSagaMap();
  }

  /**
   * Advances the daily streak once per scene entry (the menu reads it back on
   * the next visit) and celebrates only the day it actually grew.
   */
  private markDailyStreak(): void {
    const streak = touchDailyStreak();
    if (!streak.extended) return;
    this.time.delayedCall(520, () => {
      if (this.disposed) return;
      floatText(this, VIEW.centerX, SAFE.top + 40, `DAY ${streak.days} STREAK!`, CSS.accent, 46);
      sfx('combo', { volume: 0.5 });
    });
  }

  // ------------------------------------------------------------- meta gateway

  /**
   * The saga map, over a dimmed backdrop: no board exists yet, so the level
   * pick is the first decision of the session. CLOSE walks back to the menu —
   * there is nothing behind the map to return to.
   */
  private openSagaMap(): void {
    this.mapBackdrop = this.add
      .rectangle(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height, PALETTE.bgDeep, 0.72)
      .setScrollFactor(0)
      .setDepth(2100);

    const starsByLevel: Record<string, number> = {};
    for (const level of BOARD_LEVELS) starsByLevel[level.spec.id] = bestStars(level.spec.id);

    this.sagaMap = showSagaMap(this, {
      levels: BOARD_LEVELS.map((level, index) => ({ id: level.spec.id, label: `${index + 1}` })),
      // Stored progress is the NEXT unplayed index, so the frontier is one
      // level wider than it.
      unlockedCount: clampBoardLevel(load<number>(BOARD_PROGRESS_KEY, 0)) + 1,
      starsByLevel,
      onPick: (levelId) => {
        const index = BOARD_LEVELS.findIndex((level) => level.spec.id === levelId);
        this.closeMetaOverlays();
        this.offerBoosters(clampBoardLevel(index < 0 ? 0 : index));
      },
      onClose: () => {
        this.closeMetaOverlays();
        this.scene.start(SCENES.menu);
      },
    });
  }

  /**
   * Glyph for a booster/blocker id: its generated icon once `data/art.ts`
   * carries one, the procedural fallback until then.
   */
  private glyphFor(id: string): BoosterGlyph {
    const fallback = GLYPH_FALLBACK[id] ?? { texture: TEX.disc, tint: PALETTE.primary };
    return { art: ICON_BY_ID[id] ?? null, texture: fallback.texture, tint: fallback.tint };
  }

  /**
   * Pre-level booster offer. The catalog in `data/metaCatalog.ts` owns the ids
   * and the copy; this only reads the owned counts and spends what is armed.
   * A player who owns nothing never sees the gate.
   *
   * In-level consumables are deliberately absent: a ladle armed before the
   * deal would be spent on a board the player has not read yet, so they are
   * bought in the same shop but spent from the tray (`buildBoosterTray`).
   */
  private offerBoosters(index: number): void {
    const offers = metaCatalogFor('board')
      .filter(
        (entry) =>
          entry.kind === 'booster' &&
          entry.boosterId !== undefined &&
          IN_LEVEL_IDS[entry.boosterId] !== true,
      )
      .map((entry) => ({
        id: entry.boosterId as string,
        name: entry.name.toUpperCase(),
        count: boosterCount(entry.boosterId as string),
        glyph: this.glyphFor(entry.boosterId as string),
      }));

    if (offers.every((offer) => offer.count === 0)) {
      this.beginLevel(index, []);
      return;
    }

    this.boosterPicker = showBoosterPicker(this, {
      boosters: offers,
      maxPick: BOARD_TUNING.boosters.maxPick,
      onStart: (selected) => {
        this.closeMetaOverlays();
        this.beginLevel(index, selected);
      },
      // The gate is a decision, not a commitment: closing it walks back to the
      // level pick with nothing spent.
      onClose: () => {
        sfx('ui', { volume: 0.4 });
        this.closeMetaOverlays();
        this.openSagaMap();
      },
    });

    // The picker is the first screen that asks the player to SPEND something,
    // and it is the one gate they can dismiss without understanding it. The
    // coach sits on top of it (`ui/coach.ts` draws above every overlay) and
    // the picker is unreachable until it is dismissed.
    this.queueCoach({
      id: 'picker',
      build: () => {
        const bounds = this.boosterPicker?.bounds ?? null;
        if (bounds === null) return null;
        return {
          target: bounds,
          text: `Pick up to ${BOARD_TUNING.boosters.maxPick} boosters to bring along`,
        };
      },
    });
  }

  private closeMetaOverlays(): void {
    // Any beat teaching one of these overlays goes with it: the thing it points
    // at is about to stop existing.
    this.discardCoaches();
    this.sagaMap?.destroy();
    this.sagaMap = null;
    this.boosterPicker?.destroy();
    this.boosterPicker = null;
    this.mapBackdrop?.destroy();
    this.mapBackdrop = null;
  }

  /**
   * Deals `index` and starts its clock. Boosters are spent HERE — the spend is
   * what commits the level, so a picker that never reaches this point costs
   * the player nothing.
   */
  private beginLevel(index: number, boosters: readonly string[]): void {
    this.levelIndex = index;
    for (const id of boosters) {
      if (spendBooster(id)) this.armedBoosters.add(id);
    }
    // Written before the first move so RETRY (seed only) lands on this level
    // even after the win advances `BOARD_PROGRESS_KEY`.
    save(BOARD_LAST_LEVEL_KEY, index);

    const level = BOARD_LEVELS[index] as (typeof BOARD_LEVELS)[number];
    // One seed per (run, level): the same seed always deals the same puzzle,
    // and RETRY on the results screen replays it move for move.
    this.rng = new Rng(`${this.seed}:${level.seed}`);
    // `boardSpecFor` folds the level's authored dimensions AND its jars/vines
    // into the spec, so the geometry and the blockers are both part of the deal
    // and replay with the seed.
    this.boardSpec = boardSpecFor(level);
    this.board = new Board(this.boardSpec, new Rng(`${this.seed}:${level.seed}:deal`));
    // Mercy is per-level state. The board is fresh here, so this is belt and
    // braces — but it is also the line that documents where the rule resets.
    this.mercyApplied = false;
    this.board.setRefillPool(null);

    // `extra-moves` widens a COPY of the ladder's spec: the authored level data
    // (and the sim gate that reads it) stays exactly as shipped.
    const spec = this.armedBoosters.has('extra-moves')
      ? { ...level.spec, moves: (level.spec.moves ?? 0) + BOARD_TUNING.boosters.extraMoves }
      : level.spec;
    this.director = new LevelDirector(spec, {
      onEnd: (outcome) => {
        this.pendingOutcome = outcome;
      },
    });
    this.goalKinds = spec.goals.map((goal) => ({ kind: goal.id }));

    this.buildBoardLayer();
    if (this.armedBoosters.has('bomb-start')) this.seedOpeningBomb();
    this.buildHud(spec.goals);
    if (this.armedBoosters.has('shuffle')) this.grantShuffleCharge();
    this.buildInput();
    this.buildBoosterTray();
    this.refreshHud();
    this.started = true;

    if (this.armedBoosters.size > 0) {
      floatText(
        this,
        VIEW.centerX,
        this.boardTop - 26,
        `${this.armedBoosters.size} BOOSTER${this.armedBoosters.size > 1 ? 'S' : ''} ARMED`,
        CSS.accent,
        38,
      );
    }

    this.queueLevelCoaches();
  }

  /**
   * `bomb-start`: one bomb on a mid-board cell, seeded from the level's own
   * `Rng` so the same seed opens the same way. Mid-board because a bomb on the
   * bottom row detonates into gravity and reads as a wasted booster.
   */
  private seedOpeningBomb(): void {
    const band = BOARD_TUNING.boosters.bombRowBand;
    const rowMax = Math.min(band.max, this.rows - 1);
    // A short board can put the whole band past its last row; clamping both
    // ends keeps the bomb on the board instead of nowhere.
    const rowMin = Math.min(band.min, rowMax);
    const rowCount = rowMax - rowMin + 1;
    const slots = rowCount * this.cols;
    const first =
      (this.rng.int(rowMin, rowMax) - rowMin) * this.cols + this.rng.int(0, this.cols - 1);

    // Walks the band from the seeded cell rather than taking it blindly: a jar
    // is not a piece and cannot carry a payload, and stamping a vined piece
    // would erase its vine. A bought booster must never land on nothing.
    for (let step = 0; step < slots; step += 1) {
      const at = (first + step) % slots;
      const cell = {
        col: at % this.cols,
        row: rowMin + Math.floor(at / this.cols),
      };
      const piece = this.board.get(cell);
      if (piece === null || !isMovable(piece)) continue;
      this.board.set(cell, { ...piece, special: 'bomb' });
      const view = this.views[this.index(cell)] ?? null;
      if (view !== null) {
        this.markSpecial(view, 'bomb');
        pop(this, view.root, 0.4, 260);
      }
      return;
    }
  }

  /**
   * `shuffle`: a one-tap re-deal docked at the right end of the booster row —
   * every in-level action lives in that one band, and a top-of-ladder order
   * fills the goal row with five chips, leaving no space beside them.
   */
  private grantShuffleCharge(): void {
    this.shuffleCharges = BOARD_TUNING.boosters.shuffleCharges;
    this.shuffleButton = new Button(
      this,
      VIEW.width - SAFE.side - SHUFFLE_WIDTH / 2,
      VIEW.height - SAFE.bottom - 44,
      `SHUFFLE ${this.shuffleCharges}`,
      () => this.spendShuffleCharge(),
      {
        width: SHUFFLE_WIDTH,
        height: 88,
        fill: PALETTE.bgTop,
        stroke: PALETTE.accent,
        textColor: CSS.accent,
        fontSize: '24px',
      },
    );
    this.shuffleButton.setScrollFactor(0).setDepth(1500);
  }

  private spendShuffleCharge(): void {
    if (this.shuffleCharges <= 0 || !this.acceptsInput()) return;
    this.shuffleCharges -= 1;
    this.shuffleButton?.setLabel(`SHUFFLE ${this.shuffleCharges}`);
    if (this.shuffleCharges <= 0) this.shuffleButton?.setVisible(false);
    this.busy = true;
    this.clearSelection();
    this.reshuffleBoard('BOOSTER SHUFFLE');
  }

  update(_time: number, delta: number): void {
    if (!this.started || this.ended || this.paused) return;
    this.director.update(delta);
    this.refreshHud();
    // Any resolution the director reaches on its own (a timed variant of a
    // level, an explicit fail) still ends the scene — but only once the board
    // has stopped animating, so the winning cascade is always seen.
    if (this.pendingOutcome !== null && !this.busy) this.finish(this.pendingOutcome);
  }

  // ---------------------------------------------------------------- rendering

  /**
   * Board geometry for the ACTIVE level, then a view per dealt piece.
   *
   * Nothing here is authored. The dimensions come off the board that was just
   * dealt (`boardSpecFor` honours a per-level override) and the cell size is
   * whatever fits them inside `layout`'s vertical band, capped so a 6x7
   * tutorial does not become six comic tiles. That is what lets the ladder
   * change board size per level — the one lever that stops twelve orders from
   * reading as the same grid with more junk on it — and it is why no visual in
   * this file may hardcode a pixel size for a cell or a piece again.
   */
  private buildBoardLayer(): void {
    const layout = BOARD_TUNING.layout;
    this.cols = this.board.cols;
    this.rows = this.board.rows;

    // Both budgets have the frame's padding taken out of them first, so the
    // panel around the grid can never be the thing that crosses a safe line.
    const widthFit = Math.floor((VIEW.width - SAFE.side * 2 - layout.framePad * 2) / this.cols);
    const heightFit = Math.floor(
      (layout.bandBottom - layout.bandTop - layout.framePad * 2) / this.rows,
    );
    const cell = Math.max(1, Math.min(layout.maxCellPx, widthFit, heightFit));
    this.cellPx = cell;
    this.pieceScale = cell / layout.styleCellPx;

    this.boardWidth = this.cols * cell;
    this.boardHeight = this.rows * cell;
    this.originX = Math.round(VIEW.centerX - this.boardWidth / 2);
    // Centred in the band on BOTH axes: a board that runs out of width before
    // it runs out of band (every level narrower than it is tall) has to sit in
    // the middle of the play area, not pinned to the top of it.
    this.boardTop = Math.round((layout.bandTop + layout.bandBottom - this.boardHeight) / 2);

    const frame = drawPanel(
      this,
      this.boardWidth + layout.framePad * 2,
      this.boardHeight + layout.framePad * 2,
      {
        fill: PALETTE.bgDeep,
        stroke: PALETTE.primary,
        strokeAlpha: 0.4,
        radius: 26,
      },
    );
    frame
      .setPosition(VIEW.centerX, this.boardTop + this.boardHeight / 2)
      .setScrollFactor(0)
      .setDepth(40);

    this.boardLayer = this.add
      .container(this.originX, this.boardTop)
      .setScrollFactor(0)
      .setDepth(50);

    // The selector lives BELOW the pieces in its own layer: cascades add and
    // recycle piece views constantly, so a highlight parked inside
    // `boardLayer` would need re-sorting on every refill to stay underneath.
    this.selectorLayer = this.add
      .container(this.originX, this.boardTop)
      .setScrollFactor(0)
      .setDepth(45);
    const glow = this.add
      .image(0, 0, TEX.square)
      .setTint(PALETTE.accent)
      .setAlpha(0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(cell - 2, cell - 2);
    const outline = drawPanel(this, cell - 8, cell - 8, {
      fill: PALETTE.accent,
      fillAlpha: 0.14,
      stroke: PALETTE.accent,
      strokeAlpha: 0.95,
      strokeWidth: 4,
      radius: Math.round(cell * 0.26),
    });
    this.selector = this.add.container(0, 0, [glow, outline]).setVisible(false);
    this.selectorLayer.add(this.selector);

    this.views = new Array<PieceView | null>(this.cols * this.rows).fill(null);
    this.board.forEachCell((position, piece) => {
      if (piece === null) return;
      this.views[this.index(position)] = this.spawnView(position, piece, 0);
    });
  }

  private index(cell: Cell): number {
    return cell.row * this.cols + cell.col;
  }

  private localX(col: number): number {
    return col * this.cellPx + this.cellPx / 2;
  }

  private localY(row: number): number {
    return row * this.cellPx + this.cellPx / 2;
  }

  /**
   * Screen coordinates of a cell's centre. Bursts, float text and shakes are
   * added to the scene rather than to `boardLayer` (they have to outlive the
   * view they came from), so they need the board's offset applied for them.
   */
  private worldX(col: number): number {
    return this.originX + this.localX(col);
  }

  private worldY(row: number): number {
    return this.boardTop + this.localY(row);
  }

  /**
   * The slot to draw with, or `null` for the procedural fallback. A slot whose
   * texture was never loaded (its art group is pruned, or the art does not
   * exist yet) resolves to `null` here rather than rendering a green box.
   */
  private resolveSlot(slot: ArtSlot | null): ArtSlot | null {
    if (slot === null) return null;
    return this.textures.exists(slot.key) ? slot : null;
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

  /**
   * One piece glyph at `size` px. Generated art is drawn UNTINTED (it carries
   * its own colour); only the procedural primitive takes the kind's tint.
   */
  private drawKindGlyph(style: BoardKindStyle, x: number, y: number, size: number): Phaser.GameObjects.Image {
    const slot = this.resolveSlot(style.art);
    if (slot !== null) {
      return this.add.image(x, y, slot.key, slot.frame).setDisplaySize(size, size);
    }
    return this.add
      .image(x, y, style.texture)
      .setTint(style.tint)
      .setScale(this.scaleFor(style) * (size / style.size));
  }

  /**
   * One cell's view. A jar is not a piece — it has no kind style and never
   * matches — so it takes its own glyph path; a vined piece is a normal glyph
   * plus the overlay that says "not yet".
   */
  private spawnView(cell: Cell, piece: Piece, dropRows: number): PieceView {
    const root = this.add.container(
      this.localX(cell.col),
      this.localY(cell.row) - dropRows * this.cellPx,
    );
    this.boardLayer.add(root);
    const view: PieceView = { root, badge: null, vine: null, loops: [] };

    if (isJar(piece)) {
      this.drawJar(view, piece.blocker?.hp ?? 1);
      return view;
    }

    const style = this.styleByKind.get(piece.kind) as BoardKindStyle;
    root.add(this.drawKindGlyph(style, 0, 0, style.size * this.pieceScale));
    if ((piece.special ?? null) !== null) this.markSpecial(view, piece.special as SpecialKind);
    if (isVined(piece)) this.markVine(view);
    return view;
  }

  /**
   * A jar: the shelf clutter the order has to be dug out from. An hp-2 jar is
   * drawn visibly sturdier (bigger, brighter rim, two pips) so "this one takes
   * two hits" is readable without a tutorial.
   */
  private drawJar(view: PieceView, hp: number): void {
    const sturdy = hp >= 2;
    const size = this.cellPx - Math.round((sturdy ? 6 : 14) * this.pieceScale);
    const slot = this.resolveSlot(ICON_BY_ID.jar ?? null);
    const body =
      slot !== null
        ? this.add.image(0, 0, slot.key, slot.frame)
        : this.add.image(0, 0, TEX.square).setTint(JAR_FALLBACK_TINT);
    view.root.add(body.setDisplaySize(size, size));

    // Hit points are dual coded: size AND one pip per remaining hit, so the
    // two jar tiers never rely on the art alone.
    const pips = sturdy ? 2 : 1;
    const pipSize = Math.max(6, Math.round(12 * this.pieceScale));
    const pipY = Math.round(20 * this.pieceScale);
    const pipSpread = 11 * this.pieceScale;
    for (let pip = 0; pip < pips; pip += 1) {
      view.root.add(
        this.add
          .image(pips === 1 ? 0 : pip * pipSpread * 2 - pipSpread, pipY, TEX.disc)
          .setTint(PALETTE.accent)
          .setAlpha(0.9)
          .setDisplaySize(pipSize, pipSize),
      );
    }
  }

  /** The vine overlay: the piece is there, the player just cannot take it yet. */
  private markVine(view: PieceView): void {
    if (view.vine !== null) return;
    const cellPx = this.cellPx;
    const inset = Math.round(8 * this.pieceScale);
    const slot = this.resolveSlot(ICON_BY_ID.vine ?? null);
    const vine =
      slot !== null
        ? this.add
            .image(0, 0, slot.key, slot.frame)
            .setDisplaySize(cellPx - inset, cellPx - inset)
            .setAlpha(0.9)
        : this.add
            .image(0, 0, TEX.spike)
            .setTint(PALETTE.good)
            .setDisplaySize(cellPx - inset - 2, cellPx - inset - 2)
            .setAngle(45)
            .setAlpha(0.9);
    view.root.add(vine);
    view.vine = vine;
  }

  /**
   * Frees a vined piece: the overlay pops off and the piece underneath is a
   * normal piece from that frame on.
   */
  private clearVine(view: PieceView): void {
    const vine = view.vine;
    if (vine === null) return;
    view.vine = null;
    this.tweens.add({
      targets: vine,
      alpha: 0,
      scale: vine.scale * 1.6,
      angle: vine.angle + 90,
      duration: 220,
      ease: 'Quad.easeOut',
      onComplete: () => vine.destroy(),
    });
  }

  /**
   * Specials are dual coded too: a badge glyph AND a bright ink tint, plus a
   * looping pulse and an additive glow so a charged piece is visibly live on a
   * board where everything else is still.
   */
  private markSpecial(view: PieceView, special: SpecialKind): void {
    if (view.badge !== null) return;
    const slot = this.resolveSlot(BOARD_TUNING.art.specials[special]);
    const badge =
      slot !== null
        ? this.add.image(0, 0, slot.key, slot.frame).setAlpha(0.95)
        : this.add.image(0, 0, SPECIAL_BADGE[special]).setTint(PALETTE.ink).setAlpha(0.9);
    const cellPx = this.cellPx;
    const badgeInset = Math.round(12 * this.pieceScale);
    const barThickness = Math.max(6, Math.round(10 * this.pieceScale));
    if (slot !== null || special === 'bomb') {
      badge.setDisplaySize(cellPx - badgeInset, cellPx - badgeInset);
    } else if (special === 'line-h') {
      badge.setDisplaySize(cellPx - badgeInset - 2, barThickness);
    } else {
      badge.setDisplaySize(barThickness, cellPx - badgeInset - 2);
    }

    const glowSize = cellPx - Math.round(16 * this.pieceScale);
    const glow = this.add
      .image(0, 0, TEX.disc)
      .setTint(PALETTE.accent)
      .setAlpha(0.34)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(glowSize, glowSize);
    // Glow first: it belongs BEHIND the badge, and container order is z order.
    view.root.add([glow, badge]);
    view.badge = badge;

    // Registered so `releaseView` can kill them: an infinite tween whose
    // target a cascade destroyed keeps ticking forever otherwise.
    view.loops.push(
      this.tweens.add({
        targets: badge,
        scale: badge.scale * 1.14,
        duration: 600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }),
      this.tweens.add({
        targets: glow,
        alpha: 0.62,
        scale: glow.scale * 1.2,
        duration: 600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }),
    );
  }

  /**
   * Kills every looping tween a view owns. Call before the root is destroyed
   * OR handed to a destroying tween — Phaser does not stop an infinite tween
   * just because its target went away.
   */
  private releaseView(view: PieceView): void {
    for (const loop of view.loops) loop.remove();
    view.loops.length = 0;
  }

  /** `releaseView` + destroy, for every path that drops a view immediately. */
  private destroyView(view: PieceView): void {
    this.releaseView(view);
    view.root.destroy();
  }

  // ---------------------------------------------------------------------- HUD

  /** `goals` comes from the LIVE spec (a booster may have widened its budget). */
  private buildHud(goals: readonly LevelGoal[]): void {
    // Centered: the site shell's back-link + prompt chips own the top-left
    // corner (dev and published page alike), the pause button owns the
    // top-right — the middle of the safe band is the only clear ground.
    this.add
      .text(VIEW.centerX, SAFE.top / 2, `LEVEL ${this.levelIndex + 1}`, { ...TEXT.heading, fontSize: '40px' })
      .setOrigin(0.5, 0.5)
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

    // Score rides under the title in the safe band rather than in the state
    // row: it is what the player reads AFTER the level, and the row it used to
    // own is worth more as board.
    this.scoreText = this.add
      .text(SAFE.side, SCORE_Y, '', { ...TEXT.score, fontSize: '30px', color: CSS.inkSoft })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(1410);

    const movesPill = drawPill(this, MOVES_PILL_WIDTH, HUD_ROW_HEIGHT, {
      fill: PALETTE.bgTop,
      stroke: PALETTE.accent,
    });
    movesPill
      .setPosition(SAFE.side + MOVES_PILL_WIDTH / 2, HUD_ROW_Y)
      .setScrollFactor(0)
      .setDepth(1400);
    this.add
      .text(SAFE.side + 22, HUD_ROW_Y, 'MOVES', { ...TEXT.label, fontSize: '22px' })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(1410);
    // Right-aligned at the pill's inner edge with the label sized to clear it:
    // a two-digit budget used to collide with 'MOVES'.
    this.movesText = this.add
      .text(SAFE.side + MOVES_PILL_WIDTH - 16, HUD_ROW_Y, '', {
        ...TEXT.score,
        fontSize: '44px',
        color: CSS.accent,
      })
      .setOrigin(1, 0.5)
      .setScrollFactor(0)
      .setDepth(1410);

    // Goal chips share the state row with the budget: the pill says how much is
    // left, the chips say what for. The icon is the piece's own glyph —
    // generated art when its slot resolves, the tinted primitive otherwise — so
    // a goal reads as "collect THESE" without a legend.
    //
    // They size to what the row has left over rather than to a fixed width: one
    // or two orders sit wide, three or more stack the count under the glyph, and
    // no chip can run off the safe edge.
    const chipsLeft = SAFE.side + MOVES_PILL_WIDTH + HUD_ROW_GAP;
    const chipsRight = VIEW.width - SAFE.side;
    const goalCount = goals.length;
    const gap = goalCount >= 4 ? 8 : 12;
    const available = chipsRight - chipsLeft;
    const chipWidth = Math.min(
      goalCount >= 3 ? 156 : 200,
      (available - gap * (goalCount - 1)) / goalCount,
    );
    const narrow = chipWidth < GOAL_CHIP_NARROW_WIDTH;
    const totalWidth = goalCount * chipWidth + (goalCount - 1) * gap;
    let x = (chipsLeft + chipsRight - totalWidth) / 2 + chipWidth / 2;
    // Captured for the 'goals' coach beat: the chip row's width is derived from
    // how many orders this level has, so nothing else can spotlight it.
    this.goalRowRect = {
      x: x - chipWidth / 2,
      y: HUD_ROW_Y - HUD_ROW_HEIGHT / 2,
      w: totalWidth,
      h: HUD_ROW_HEIGHT,
    };
    for (const goal of goals) {
      const style = this.styleByKind.get(goal.id) as BoardKindStyle;
      const chip = drawPill(this, chipWidth, HUD_ROW_HEIGHT, {
        fill: PALETTE.bgTop,
        stroke: style.tint,
        gloss: true,
      });
      chip.setPosition(x, HUD_ROW_Y).setScrollFactor(0).setDepth(1400);
      this.drawKindGlyph(
        style,
        narrow ? x : x - chipWidth / 2 + 34,
        narrow ? HUD_ROW_Y - 15 : HUD_ROW_Y,
        style.size * (narrow ? 0.55 : 0.64),
      )
        .setScrollFactor(0)
        .setDepth(1410);
      const text = this.add
        .text(narrow ? x : x + chipWidth / 2 - 18, narrow ? HUD_ROW_Y + 19 : HUD_ROW_Y, '', {
          ...TEXT.body,
          fontSize: narrow ? '22px' : '32px',
          color: CSS.ink,
        })
        .setOrigin(narrow ? 0.5 : 1, 0.5)
        .setScrollFactor(0)
        .setDepth(1410);
      this.goalChips.push({ text, goalId: goal.id, shown: '' });
      x += chipWidth + gap;
    }

    // The how-to line is NOT a row of its own: the booster tray owns that copy
    // as its idle hint, on the line directly above its chips.
  }

  /**
   * In-level consumables, docked in the bottom band. The tray owns arming and
   * its own hint line; the scene owns the spend and the effect, so a chip that
   * is armed and cancelled costs nothing.
   */
  private buildBoosterTray(): void {
    this.boosterTray = showBoosterTray(this, {
      chips: TRAY_CHIPS.map((chip) => ({
        id: chip.id,
        label: chip.label,
        prompt: chip.prompt,
        immediate: chip.immediate,
        glyph: this.glyphFor(chip.id),
      })),
      countOf: boosterCount,
      idleHint: 'SWIPE OR TAP TWO NEIGHBOURS',
      // Bottom edge of the chip row lands exactly on the safe line; the shuffle
      // charge, when the player armed one, parks at the end of it.
      y: VIEW.height - SAFE.bottom - 44,
      rightReserve: this.shuffleCharges > 0 ? SHUFFLE_WIDTH + 16 : 0,
      canArm: () => this.acceptsInput(),
      onArm: (id) => {
        // Arming is a different verb from swapping: drop any half-made move.
        if (id !== null) this.clearSelection();
      },
      // The whisk has nothing to aim at, so its own tap is the whole input.
      onUse: (id) => {
        if (id === 'whisk') this.useWhisk();
      },
    });
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
      this.scoreText.setText(`SCORE ${score}`);
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
      .zone(VIEW.centerX, this.boardTop + this.boardHeight / 2, this.boardWidth, this.boardHeight)
      .setScrollFactor(0)
      .setInteractive();

    // Click semantics: the move is decided on POINTER_DOWN (and on the drag
    // that follows it), never on release — a pointer-up landing on a freshly
    // opened overlay must not make a move.
    zone.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (!this.acceptsInput()) return;
      const cell = this.cellAt(pointer.x, pointer.y);
      if (cell === null) return;

      // An armed booster claims the next board tap outright — no selection, no
      // swap, and the chip disarms itself once the effect resolves.
      const armed = this.boosterTray?.armed ?? null;
      if (armed !== null) {
        this.downCell = null;
        this.dragResolved = true;
        // Only the aimed tools ever reach an armed state — the whisk fires on
        // its own chip tap — so an armed chip here takes this cell as its aim.
        if (armed === 'ladle' || armed === 'broom' || armed === 'pestle') {
          this.useAimedBooster(armed, cell);
        }
        return;
      }

      // Jars are furniture and vined pieces are rooted: refusing them with a
      // headshake teaches the rule, where a dead tap would read as a bug.
      if (!isMovable(this.board.get(cell))) {
        this.refuseCell(cell);
        return;
      }

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
      if (this.board.isBlocked(target)) return;
      if (!isMovable(this.board.get(target))) {
        this.refuseCell(target);
        return;
      }
      this.attemptSwap(from, target);
    });

    this.input.keyboard?.on('keydown-ESC', () => this.togglePause());
    this.input.keyboard?.on('keydown-P', () => this.togglePause());
  }

  /**
   * Spends one in-level booster, or refuses the use. It costs NO move: the
   * budget is the level's difficulty, and a consumable the player bought is the
   * thing that buys them out of it.
   *
   * The spend is the gate — a failed spend (raced to zero elsewhere) must not
   * fire an effect, and it must never leave the tray showing a count it no
   * longer has.
   */
  private spendInLevel(id: InLevelBoosterId): boolean {
    const spent = spendBooster(id);
    this.boosterTray?.refresh();
    if (!spent) sfx('hit', { volume: 0.3 });
    return spent;
  }

  /**
   * The three aimed tools, resolved against the tapped cell: the ladle takes
   * the cell, the broom its row, the pestle its column. All of them go through
   * `applyInLevelBooster` and come back as ordinary `CascadeStep`s, so a
   * booster animates, scores, counts goals and damages blockers through the
   * exact same path a move does.
   */
  private useAimedBooster(id: AimedBoosterId, cell: Cell): void {
    this.boosterTray?.disarm();
    if (!this.spendInLevel(id)) return;

    this.busy = true;
    this.clearSelection();

    const cellX = this.worldX(cell.col);
    const cellY = this.worldY(cell.row);
    if (id === 'ladle') {
      burst(this, cellX, cellY, PALETTE.accent, 20, 340);
      floatText(this, cellX, cellY - 30, 'LADLE!', CSS.accent, 40);
    } else if (id === 'broom') {
      burst(this, VIEW.centerX, cellY, PALETTE.primary, 28, 480);
      floatText(this, VIEW.centerX, cellY - 30, 'BROOM!', CSS.primary, 40);
    } else {
      // The pestle's FX runs the height of the column it grinds, the way the
      // broom's runs the width of its row.
      burst(this, cellX, this.boardTop + this.boardHeight / 2, PALETTE.accent, 28, 480);
      floatText(this, cellX, this.boardTop + 34, 'PESTLE!', CSS.accent, 40);
    }
    sfx('whoosh', { volume: 0.55 });
    shake(this, 0.007, 170);

    const action =
      id === 'ladle'
        ? { id, cell }
        : id === 'broom'
          ? { id, row: cell.row }
          : { id, col: cell.col };
    this.playStep(applyInLevelBooster(this.board, action, this.rng), 0);
  }

  /**
   * The whisk: no aim, so the chip tap is the whole input.
   *
   * `applyInLevelBooster` reports the permutation as the first step's `falls`,
   * which is the same vocabulary a gravity fall uses — so the stir animates
   * through `playStep` like any other cascade, and the match it may cause is
   * simply the steps after it.
   */
  private useWhisk(): void {
    if (!this.acceptsInput()) return;
    if (!this.spendInLevel('whisk')) return;

    this.busy = true;
    this.clearSelection();
    this.boosterTray?.say('whisk');

    const centreY = this.boardTop + this.boardHeight / 2;
    burst(this, VIEW.centerX, centreY, PALETTE.primary, 34, 520);
    floatText(this, VIEW.centerX, centreY - 40, 'WHISK!', CSS.primary, 44);
    sfx('whoosh', { volume: 0.6 });
    shake(this, 0.006, 200);

    const steps = applyInLevelBooster(this.board, { id: 'whisk' }, this.rng);
    // Nothing loose to stir (a shelf of jars and rooted pieces). The charge is
    // already gone, so say so and hand the beat back rather than leave the scene
    // busy waiting on a cascade that will never arrive.
    if (steps.length === 0) {
      floatText(this, VIEW.centerX, centreY + 40, 'NOTHING TO STIR', CSS.inkSoft, 34);
      this.settleMove();
      return;
    }
    this.playStep(steps, 0);
  }

  /**
   * "Not this one": a short headshake plus a soft thud. Cheaper to read than a
   * message, and it never blocks the next tap.
   */
  private refuseCell(cell: Cell): void {
    sfx('hit', { volume: 0.22 });
    const view = this.views[this.index(cell)] ?? null;
    if (view !== null) this.headshake(view, cell);
  }

  /** Silent side-to-side wobble in place; the caller owns the sound. */
  private headshake(view: PieceView, cell: Cell): void {
    const home = this.localX(cell.col);
    // A second shake mid-wobble would stack into a drift, and the board is at
    // rest whenever this runs, so nothing else owns the root's position.
    this.tweens.killTweensOf(view.root);
    view.root.setPosition(home, this.localY(cell.row));
    this.tweens.add({
      targets: view.root,
      x: home - 8,
      duration: 55,
      yoyo: true,
      repeat: 2,
      ease: 'Sine.easeInOut',
      onComplete: () => view.root.setX(home),
    });
  }

  private acceptsInput(): boolean {
    return !this.busy && !this.paused && !this.ended && !this.director.ended;
  }

  private cellAt(x: number, y: number): Cell | null {
    const col = Math.floor((x - this.originX) / this.cellPx);
    const row = Math.floor((y - this.boardTop) / this.cellPx);
    const cell = { col, row };
    return this.board.isBlocked(cell) ? null : cell;
  }

  /**
   * Selection highlight: a cell-sized warm glow UNDER the piece plus a small
   * lift on the piece itself, both pulsing. The old ring sat on top of the
   * glyph and read as a target reticle rather than "this one is in your hand".
   */
  private select(cell: Cell): void {
    this.clearSelection();
    this.selected = cell;
    this.selector
      .setPosition(this.localX(cell.col), this.localY(cell.row))
      .setVisible(true)
      .setScale(1)
      .setAlpha(0.7);
    this.selectorPulse = this.tweens.add({
      targets: this.selector,
      alpha: 1,
      scale: 1.06,
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    const view = this.views[this.index(cell)] ?? null;
    this.selectedView = view;
    if (view !== null) {
      this.tweens.add({ targets: view.root, scale: 1.08, duration: 140, ease: 'Back.easeOut' });
    }
    sfx('tap', { volume: 0.3 });
  }

  /**
   * Drops the highlight. Both tweens are killed explicitly — the pulse repeats
   * forever, and the lifted piece is about to be swapped, cleared or recycled
   * (see the AGENTS.md shutdown trap: a live tween on a dead object is the
   * thing that black-screens a scene transition).
   */
  private clearSelection(): void {
    this.selected = null;
    this.selectorPulse?.remove();
    this.selectorPulse = null;
    this.selector.setVisible(false).setScale(1).setAlpha(0.7);

    const view = this.selectedView;
    this.selectedView = null;
    if (view === null || !view.root.active) return;
    this.tweens.killTweensOf(view.root);
    view.root.setScale(1);
  }

  // ------------------------------------------------------------------- a move

  private attemptSwap(a: Cell, b: Cell): void {
    if (!this.acceptsInput() || !areAdjacent(a, b)) return;
    // The first-move lesson: the coach's dim already makes every cell outside
    // the pair untappable, so what is left to catch here is the DRAG that
    // starts on a gated cell and aims at a neighbour outside it. Refusing it
    // the same way a jar is refused keeps the lesson wordless.
    const gate = this.gatedSwap;
    if (
      gate !== null &&
      !((sameCell(gate.a, a) && sameCell(gate.b, b)) || (sameCell(gate.a, b) && sameCell(gate.b, a)))
    ) {
      this.refuseCell(b);
      return;
    }
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
    // The taught swap actually happened: close the lesson (and let the queue
    // move on) BEFORE the cascade plays, so the board is the player's again
    // the moment they earned it.
    if (this.gatedSwap !== null) this.completeSwapGate();
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

      // A broken jar clears as `JAR_KIND`, which has no kind style: it is
      // furniture, so its debris takes the shelf's own colour.
      const tint =
        entry.kind === JAR_KIND
          ? JAR_FALLBACK_TINT
          : (this.styleByKind.get(entry.kind) as BoardKindStyle).tint;
      const worldX = this.worldX(entry.cell.col);
      const worldY = this.worldY(entry.cell.row);
      if (view !== null) {
        // Kill the badge pulse NOW, not on the destroy: an infinite tween is
        // not stopped by its target going away.
        this.releaseView(view);
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
      burst(this, worldX, worldY, tint, entry.special === null ? 5 : 16, entry.special === null ? 150 : 330);
      if (entry.special !== null) shake(this, 0.006, 140);
      if (depth > 0 && floats < BOARD_TUNING.floatTextPerStep) {
        floats += 1;
        floatText(this, worldX, worldY, `x${depth + 1}`, CSS.accent, 38);
      }
    });

    // After the clears: a broken jar's view is already gone by now, which is
    // exactly what its break FX expects.
    this.renderBlockerHits(step);

    for (const spawn of step.created) {
      const view = this.views[this.index(spawn.cell)] ?? null;
      if (view === null) continue;
      this.markSpecial(view, spawn.special);
      this.score += BOARD_TUNING.specialCreatedScore;
      pop(this, view.root, 0.5, 240);
      const worldX = this.worldX(spawn.cell.col);
      const worldY = this.worldY(spawn.cell.row);
      burst(this, worldX, worldY, PALETTE.ink, 20, 380);
      floatText(this, worldX, worldY - 20, spawn.special === 'bomb' ? 'BOMB!' : 'LINE!', CSS.ink, 40);
    }

    if (step.created.length > 0) sfxArp('combo', 3);
    else if (step.cleared.length > 0) sfx(depth > 0 ? 'combo' : 'pickup', { rate: 1 + Math.min(depth, 5) * 0.12 });
    if (depth >= 2) shake(this, 0.005, 120);

    this.refreshHud();
    return BOARD_TUNING.clearMs + Math.min(step.cleared.length, 6) * BOARD_TUNING.clearStaggerMs;
  }

  /** Moves pieces to their new cells and drops the refills in from above. */
  private renderFalls(step: CascadeStep): number {
    let longest = 0;
    const falls = step.falls;

    // Gravity reports bottom-up per column, so a destination is always vacated
    // by the time its faller is re-homed — but a WHISK reports a whole
    // permutation in this same list, where a source is very often another
    // fall's destination. So every source view is read out FIRST, then the
    // sources are cleared, then the destinations are written: sequential
    // re-homing would overwrite views a later entry still needs.
    const moved = this.fallScratch;
    moved.length = falls.length;
    let at = 0;
    for (const fall of falls) {
      moved[at] = this.views[this.index(fall.from)] ?? null;
      at += 1;
    }
    for (const fall of falls) this.views[this.index(fall.from)] = null;

    at = 0;
    for (const fall of falls) {
      const view = moved[at] ?? null;
      at += 1;
      this.views[this.index(fall.to)] = view;
      if (view === null) continue;
      // Measured on BOTH axes: a whisk's slides are the only `FallEvent`s in the
      // game that move sideways, and a row distance of 0 would hand every one of
      // them the minimum duration.
      const distance = Math.max(
        Math.abs(fall.to.row - fall.from.row),
        Math.abs(fall.to.col - fall.from.col),
      );
      const duration = Math.max(BOARD_TUNING.fallMinMs, distance * BOARD_TUNING.fallMsPerCell);
      longest = Math.max(longest, duration);
      this.tweenTo(view.root, fall.to, duration, undefined, 'Quad.easeIn');
    }

    const dropIndexByColumn = new Map<number, number>();
    for (const refill of step.refills) {
      const above = (dropIndexByColumn.get(refill.cell.col) ?? 0) + 1;
      dropIndexByColumn.set(refill.cell.col, above);
      const view = this.spawnView(refill.cell, refill.piece, above);
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

  /**
   * Blockers damaged or destroyed this step. A hit shakes and sparks, a break
   * pays off louder — the obstacle IS the level's difficulty, so getting rid of
   * one has to read as progress rather than as a missing match.
   */
  private renderBlockerHits(step: CascadeStep): void {
    for (const hit of step.blockerHits) {
      const worldX = this.worldX(hit.cell.col);
      const worldY = this.worldY(hit.cell.row);
      const slot = this.index(hit.cell);
      const view = this.views[slot] ?? null;

      if (hit.kind === 'vine') {
        // The vine absorbed the clear: the piece is still there, now free, so
        // the FX celebrates the release and never the (absent) clear.
        if (view !== null) {
          this.clearVine(view);
          pop(this, view.root, 0.22, 220);
        }
        burst(this, worldX, worldY, PALETTE.good, hit.broken ? 16 : 6, hit.broken ? 320 : 160);
        sfx(hit.broken ? 'pickup' : 'hit', { volume: 0.45, rate: 1.15 });
        continue;
      }

      if (hit.broken) {
        burst(this, worldX, worldY, JAR_FALLBACK_TINT, 24, 420);
        burst(this, worldX, worldY, PALETTE.accent, 12, 260);
        floatText(this, worldX, worldY - 24, 'SMASH!', CSS.accent, 38);
        shake(this, 0.008, 180);
        sfx('die', { volume: 0.45, rate: 1.3 });
        continue;
      }

      // Survived a hit: re-deal the jar from the model, so its pips show the
      // damage instead of the scene tracking hit points of its own.
      if (view !== null) {
        this.destroyView(view);
        const piece = this.board.get(hit.cell);
        const fresh = piece === null ? null : this.spawnView(hit.cell, piece, 0);
        this.views[slot] = fresh;
        if (fresh !== null) this.headshake(fresh, hit.cell);
      }
      burst(this, worldX, worldY, JAR_FALLBACK_TINT, 8, 200);
      sfx('hit', { volume: 0.4, rate: 0.9 });
    }
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
    this.applyMercy();
    // A booster's own prompt ('STIRRING THE POT') belongs to the beat it was
    // spent on; the board is at rest now, so the tray goes back to its hint.
    if ((this.boosterTray?.armed ?? null) === null) this.boosterTray?.say(null);

    if (this.pendingOutcome !== null) {
      this.finish(this.pendingOutcome);
      return;
    }
    if (hasDeadBoard(this.board)) {
      this.reshuffleBoard('NO MOVES - SHUFFLE');
      return;
    }
    this.busy = false;
  }

  /**
   * MERCY, once per level: with the budget nearly gone, refills stop drawing
   * from every kind and draw from a narrowed pool led by the goal kinds, so the
   * last moves offer matches instead of confetti. A loss should feel like it
   * came up two collects short, not like the board stopped cooperating.
   *
   * The sim applies the identical rule from this same `mercyPool`, which is what
   * keeps the ladder's measured win rates honest: a kindness the scene granted
   * alone would make every level easier than the numbers it was tuned against.
   */
  private applyMercy(): void {
    if (this.mercyApplied) return;
    const movesLeft = this.director.movesLeft;
    if (movesLeft === null || movesLeft > BOARD_TUNING.mercy.movesLeft) return;
    this.mercyApplied = true;
    this.board.setRefillPool(mercyPool(this.boardSpec, this.goalKinds, BOARD_TUNING.mercy.poolSize));
    floatText(
      this,
      VIEW.centerX,
      this.boardTop + this.boardHeight / 2 - 60,
      'THE PANTRY FAVOURS YOU',
      CSS.accent,
      26,
    );
    sfx('pickup', { volume: 0.45, rate: 1.2 });
  }

  private reshuffleBoard(label: string): void {
    const ok = reshuffle(this.board, this.rng);
    for (let slot = 0; slot < this.views.length; slot += 1) {
      const view = this.views[slot] ?? null;
      if (view !== null) this.destroyView(view);
      this.views[slot] = null;
    }
    this.board.forEachCell((cell, piece) => {
      if (piece === null) return;
      const view = this.spawnView(cell, piece, 0);
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
    floatText(this, VIEW.centerX, this.boardTop + this.boardHeight / 2, label, CSS.primary, 44);

    this.time.delayedCall(BOARD_TUNING.shuffleMs + 220, () => {
      if (this.disposed) return;
      // A shuffle that cannot find a playable board is a dead level, not a
      // stuck scene: fail it rather than lock the player out.
      if (!ok || findValidMoves(this.board).length === 0) this.director.fail('no-moves');
      if (this.pendingOutcome !== null) this.finish(this.pendingOutcome);
      else this.busy = false;
    });
  }

  // ------------------------------------------------------------- coach marks

  /**
   * Every lesson this level is allowed to teach, in the order a player meets
   * them. Beats whose flag is already set drop out in `pumpCoach` without ever
   * being built, so this list is cheap to walk on every single level start.
   *
   * The ladder is what decides WHEN each lesson is due: the HUD and the swap on
   * the first order, a blocker the frame it first appears on a board, the tray
   * the first run that has a tool in it. Nothing here is authored per level —
   * `levels.ts` debuts one idea at a time (order 4 is nothing but jars, order 7
   * nothing but vines), so "first board that has one" IS the debut.
   */
  private queueLevelCoaches(): void {
    if (this.levelIndex === 0) {
      this.queueCoach({
        id: 'goals',
        build: () => {
          const rect = this.goalRowRect;
          if (rect === null) return null;
          return { target: rect, text: COACH_COPY.goals };
        },
      });
      this.queueCoach({
        id: 'moves',
        build: () => ({
          target: {
            x: SAFE.side,
            y: HUD_ROW_Y - HUD_ROW_HEIGHT / 2,
            w: MOVES_PILL_WIDTH,
            h: HUD_ROW_HEIGHT,
          },
          text: COACH_COPY.moves,
        }),
      });
      this.queueCoach({ id: 'first-swap', build: () => this.buildFirstSwapBeat() });
    }

    this.queueCoach({
      id: 'jar',
      build: () => {
        const cell = this.findBlockerCell('jar');
        if (cell === null) return null;
        return { target: this.cellsRect([cell]), text: COACH_COPY.jar };
      },
    });
    this.queueCoach({
      id: 'vine',
      build: () => {
        const cell = this.findBlockerCell('vine');
        if (cell === null) return null;
        return { target: this.cellsRect([cell]), text: COACH_COPY.vine };
      },
    });
    this.queueCoach({
      id: 'tray',
      build: () => {
        // Only worth teaching on a run that actually HAS a tool: a tray of four
        // empty slots teaches "these are locked", which is a different lesson.
        if (!TRAY_CHIPS.some((chip) => boosterCount(chip.id) > 0)) return null;
        const bounds = this.boosterTray?.bounds ?? null;
        if (bounds === null) return null;
        return { target: bounds, text: COACH_COPY.tray };
      },
    });
  }

  /**
   * The first-move lesson, gated on a REAL swap this board can make — the
   * pointer hand nudges between two cells that genuinely match, so the very
   * first thing the player does is succeed.
   *
   * A swap that makes the level's own goal kind is preferred: order 1 wants 36
   * ember, and the taught move should be the move the order is asking for
   * rather than a lesson in matching something useless. If the deal offers no
   * goal-kind swap, ANY valid swap teaches the mechanic just as well.
   */
  private buildFirstSwapBeat(): Omit<CoachOptions, 'id'> | null {
    const swap = this.teachableSwap();
    if (swap === null) return null;
    this.gatedSwap = swap;
    return {
      target: this.cellsRect([swap.a, swap.b]),
      // No padding: this rect IS the input gate, and a fat spotlight would hand
      // taps to the neighbouring cells it overlapped.
      pad: 0,
      text: COACH_COPY.firstSwap,
      mode: 'swap-gate',
      nudge: {
        from: { x: this.worldX(swap.a.col), y: this.worldY(swap.a.row) },
        to: { x: this.worldX(swap.b.col), y: this.worldY(swap.b.row) },
      },
      onDone: () => {
        this.gatedSwap = null;
      },
    };
  }

  /** A legal swap, preferring one that clears a kind this level is collecting. */
  private teachableSwap(): Swap | null {
    const moves = findValidMoves(this.board);
    if (moves.length === 0) return null;
    for (const move of moves) {
      // Played on the real board and immediately undone — the same trick
      // `swapProducesMatch` uses, and the board is at rest here.
      this.board.swap(move.a, move.b);
      const runs = findRuns(this.board, move.b);
      this.board.swap(move.a, move.b);
      for (const run of runs) {
        if (this.goalKinds.some((goal) => goal.kind === run.kind)) return move;
      }
    }
    return moves[0] ?? null;
  }

  /** First jar or first vined piece on the board, or `null` if it has none. */
  private findBlockerCell(blocker: 'jar' | 'vine'): Cell | null {
    const probe = { col: 0, row: 0 };
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        probe.col = col;
        probe.row = row;
        const piece = this.board.get(probe);
        if (piece === null) continue;
        if (blocker === 'jar' ? isJar(piece) : isVined(piece)) return { col, row };
      }
    }
    return null;
  }

  /** Screen rect covering `cells`, for a board-side spotlight. */
  private cellsRect(cells: readonly Cell[]): CoachRect {
    let minCol = this.cols;
    let maxCol = 0;
    let minRow = this.rows;
    let maxRow = 0;
    for (const cell of cells) {
      minCol = Math.min(minCol, cell.col);
      maxCol = Math.max(maxCol, cell.col);
      minRow = Math.min(minRow, cell.row);
      maxRow = Math.max(maxRow, cell.row);
    }
    return {
      x: this.originX + minCol * this.cellPx,
      y: this.boardTop + minRow * this.cellPx,
      w: (maxCol - minCol + 1) * this.cellPx,
      h: (maxRow - minRow + 1) * this.cellPx,
    };
  }

  private queueCoach(beat: CoachBeat): void {
    if (hasSeenCoach(beat.id)) return;
    this.coachQueue.push(beat);
    this.pumpCoach();
  }

  /**
   * Shows the next beat that still has something to teach, or leaves coach mode
   * when the queue is dry. One beat is on screen at a time, always: a queue
   * rather than a stack is the whole reason a level can owe three lessons at
   * once without drawing three dims on top of each other.
   */
  private pumpCoach(): void {
    if (this.activeCoach !== null || this.disposed) return;
    while (this.coachQueue.length > 0) {
      const beat = this.coachQueue.shift() as CoachBeat;
      if (hasSeenCoach(beat.id)) continue;
      const options = beat.build();
      if (options === null) continue;

      this.enterCoachMode();
      const handle = showCoach(this, {
        ...options,
        id: beat.id,
        onDone: () => {
          this.activeCoach = null;
          options.onDone?.();
          this.pumpCoach();
        },
      });
      if (handle === null) {
        // Raced (the flag was written between the check and the show): the beat
        // is taught, so whatever it armed has to be given back.
        this.gatedSwap = null;
        continue;
      }
      this.activeCoach = handle;
      return;
    }
    this.exitCoachMode();
  }

  /**
   * A coach beat freezes the level: the director stops (so a timed variant
   * cannot run down behind a tutorial) and the pause button is refused, because
   * the overlay covering it must stay the only thing on screen.
   *
   * `paused` is deliberately NOT set — the swap-gate beat needs the board to
   * accept exactly one move while it is up, and `acceptsInput` reads that flag.
   */
  private enterCoachMode(): void {
    if (this.coachActive) return;
    this.coachActive = true;
    if (this.started) this.director.pause();
  }

  private exitCoachMode(): void {
    if (!this.coachActive) return;
    this.coachActive = false;
    // Never resume out of a pause the PLAYER owns, and never restart a level
    // that already resolved behind the beat.
    if (this.started && !this.paused && !this.ended) this.director.resume();
  }

  /** Drops the beat on screen and everything queued behind it, teaching nothing. */
  private discardCoaches(): void {
    this.coachQueue.length = 0;
    this.activeCoach?.destroy();
    this.activeCoach = null;
    this.gatedSwap = null;
    this.exitCoachMode();
  }

  /** The gated swap landed: the lesson is over and the queue moves on. */
  private completeSwapGate(): void {
    this.gatedSwap = null;
    const coach = this.activeCoach;
    if (coach === null || coach.id !== 'first-swap') return;
    coach.finish();
  }

  // ----------------------------------------------------------------- lifecycle

  private togglePause(): void {
    // A coach beat covers the pause button, so the only way in here while one
    // is up is the ESC/P key — and a pause behind a tutorial would resume the
    // director the moment the beat closes.
    if (this.ended || this.coachActive) return;
    if (this.paused) {
      this.resumeFromPause();
      return;
    }
    this.paused = true;
    this.director.pause();
    this.pauseOverlay = showPauseOverlay(this, {
      onResume: () => this.resumeFromPause(),
      onRestart: () => {
        this.closePauseOverlay();
        this.scene.start(SCENES.game, { seed: this.seed });
      },
      onMenu: () => this.quitToMenu(),
    });
  }

  private closePauseOverlay(): void {
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
  }

  private resumeFromPause(): void {
    this.paused = false;
    this.closePauseOverlay();
    this.director.resume();
  }

  /**
   * Abandons the run for the menu — the exit the level had no door for.
   *
   * Everything still running has to be killed HERE rather than on the way out:
   * a looping badge pulse or a queued cascade beat that fires after
   * `scene.start` touches a scene that no longer exists, which is exactly the
   * black-screen trap in AGENTS.md. `disposed` is latched FIRST, because every
   * deferred callback in this file checks it, so nothing already scheduled can
   * re-enter the teardown it is being torn down by.
   */
  private quitToMenu(): void {
    this.closePauseOverlay();
    this.closeMetaOverlays();
    this.disposed = true;
    this.ended = true;
    this.busy = true;
    this.paused = false;
    this.started = false;
    this.pendingOutcome = null;
    this.director.pause();

    // Named loops first (the selector pulse and every badge/glow tween a view
    // owns register themselves), then the blunt sweep for the one-shots.
    this.clearSelection();
    for (const view of this.views) {
      if (view !== null) this.releaseView(view);
    }
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.boosterTray?.destroy();
    this.boosterTray = null;

    setMusicIntensity(0.2);
    sfx('ui', { volume: 0.4 });
    this.scene.start(SCENES.menu);
  }

  private finish(outcome: SessionOutcome): void {
    if (this.ended) return;
    this.ended = true;
    this.busy = true;
    // The level is over: a lesson still on screen has nothing left to point at.
    this.discardCoaches();
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
    this.director.pause();

    const stars = this.director.stars;
    const movesLeft = this.director.movesLeft ?? 0;

    sfx(outcome.won ? 'levelup' : 'die');
    flash(this, outcome.won ? PALETTE.good : PALETTE.bad, 260);
    shake(this, 0.018, 300);
    setMusicIntensity(0.2);

    // Winning advances the ladder AND banks the star rating the saga map reads
    // back; losing leaves both, so RETRY replays this level with the same seed.
    if (outcome.won) {
      const level = BOARD_LEVELS[this.levelIndex] as (typeof BOARD_LEVELS)[number];
      recordStars(level.spec.id, stars);
      // Monotonic: replaying an early level must never revoke the frontier.
      save(
        BOARD_PROGRESS_KEY,
        Math.max(
          load<number>(BOARD_PROGRESS_KEY, 0),
          Math.min(this.levelIndex + 1, BOARD_LEVELS.length - 1),
        ),
      );
    }

    const stats: ResultStat[] = [
      { label: 'LEVEL', value: `${this.levelIndex + 1}` },
      { label: 'STARS', value: `${stars}/${MAX_STARS}` },
      { label: 'MOVES LEFT', value: `${movesLeft}` },
    ];

    this.cameras.main.fadeOut(340, 0, 0, 0);
    this.time.delayedCall(360, () => {
      this.scene.start(SCENES.gameOver, {
        won: outcome.won,
        timeMs: this.director.elapsedSeconds * 1000,
        score: this.score,
        currencyEarned: stars * BOARD_TUNING.currencyPerStar,
        seed: this.seed,
        // 1-based level reached: PLAY NEXT starts `levelIndex: level`, which is
        // the 0-based index of the one after it.
        level: this.levelIndex + 1,
        // A win with another order on the shelf offers PLAY NEXT instead of a
        // retry — nobody replays a level they just cleared.
        next: outcome.won && this.levelIndex + 1 < BOARD_LEVELS.length,
        stats,
        headline: outcome.won ? 'LEVEL CLEAR!' : 'OUT OF MOVES',
        // A move-budgeted puzzle has no clock to beat: the time row would be
        // noise, and a lifetime "best time" on it means nothing.
        timeLabel: null,
        bestTimeMode: 'off',
      });
    });
  }
}
