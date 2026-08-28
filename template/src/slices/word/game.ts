import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../../config';
import { SCENES, TEX } from '../../core/keys';
import { Rng } from '../../core/rng';
import { sfx } from '../../core/audio';
import { setMusicIntensity, startMusic } from '../../core/music';
import { burst, flash, floatText, pop, shake } from '../../core/juice';
import { LevelDirector } from '../../core/level';
import type { SessionOutcome } from '../../core/session';
import { type TriviaQuestion } from '../../data/trivia';
import { load, save } from '../../core/storage';
import {
  MAX_STARS,
  bestStars,
  boosterCount,
  recordStars,
  spendBooster,
  touchDailyStreak,
} from '../../core/progression';
import { metaCatalogFor } from '../../data/metaCatalog';
import type { ArtSlot } from '../../data/art';
import { addBackground } from '../../ui/background';
import { Button } from '../../ui/button';
import { drawPanel, paintPanel } from '../../ui/primitives';
import { showPauseOverlay, type PauseOverlayHandle } from '../../ui/pauseOverlay';
import { showSagaMap, type SagaMapHandle } from '../../ui/sagaMap';
import { showBoosterPicker, type BoosterPickerHandle } from '../../ui/boosterBar';
import { WORD_TUNING } from './tuning';
import {
  GOAL_ANSWERS,
  WORD_LAST_PACK_KEY,
  WORD_PACK_COUNT,
  WORD_PROGRESS_KEY,
  clampPackIndex,
  drawPack,
  wordPack,
  wordPackSpec,
} from './packs';

/** `fifty-fifty` and `time-plus` booster ids (see `data/metaCatalog.ts`). */
const BOOSTER_FIFTY = 'fifty-fifty';
const BOOSTER_TIME_PLUS = 'time-plus';

/**
 * Art groups `PreloadScene` loads for this slice (see the slice-wiring guide):
 * a quiz is chrome plus type, so `ui` (icon glyphs) + `bg` is the whole set.
 */
export const ART_GROUPS = ['ui', 'bg'] as const;

/**
 * Family H (trivia quiz) slice: 10 correct answers inside the pack's clock, off
 * a seeded question draw that ramps from tier 1 to tier 3. A wrong answer costs
 * clock and burns one of the reserve questions instead of ending the level.
 *
 * The ladder is five PACKS (`packs.ts`) reached through the saga map, each a
 * difficulty window over the shared bank; a win banks stars off the clock left,
 * and the pre-pack picker spends `time-plus` / `fifty-fifty`.
 */
export class GameScene extends Phaser.Scene {
  private seed = '';
  private level!: LevelDirector;
  private quiz: TriviaQuestion[] = [];
  private index = 0;

  private questionText!: Phaser.GameObjects.Text;
  private categoryText!: Phaser.GameObjects.Text;
  private options: Button[] = [];
  private reveal!: Phaser.GameObjects.Graphics;

  private timeText!: Phaser.GameObjects.Text;
  private correctText!: Phaser.GameObjects.Text;
  private streakText!: Phaser.GameObjects.Text;
  private timeShown = '';
  private correctShown = '';
  private streakShown = '';

  private correct = 0;
  private streak = 0;
  private bestStreak = 0;
  private score = 0;
  private locked = false;
  private paused = false;
  private ended = false;
  private pendingOutcome: SessionOutcome | null = null;
  private pauseOverlay: PauseOverlayHandle | null = null;

  private packIndex = 0;
  /** True once a pack is running: the map/picker phase has no clock to tick. */
  private started = false;
  /** Pack asked for explicitly by the caller, bypassing the map. */
  private requestedPack: number | null = null;
  /** A seed in `init` data means "replay this pack", never "pick a new one". */
  private replay = false;
  private sagaMap: SagaMapHandle | null = null;
  private boosterPicker: BoosterPickerHandle | null = null;
  private mapBackdrop: Phaser.GameObjects.Rectangle | null = null;
  /** Armed `fifty-fifty` uses left, and the button that spends them. */
  private fiftyCharges = 0;
  private fiftyButton: Button | null = null;
  /** Question index the current 50:50 was already applied to (once per question). */
  private fiftyAppliedTo = -1;
  private categoryIcon: Phaser.GameObjects.Image | null = null;

  constructor() {
    super(SCENES.game);
  }

  /**
   * `scene.start(SCENES.game, { seed })` replays the pack in
   * `WORD_LAST_PACK_KEY` with the exact same question draw and no map or
   * picker — what RETRY sends. A bare start (from the menu) opens the map;
   * `packIndex` skips straight to one pack.
   */
  init(data: { seed?: string; packIndex?: number } = {}): void {
    this.replay = data.seed !== undefined;
    this.seed = data.seed ?? Date.now().toString(36);
    this.requestedPack = data.packIndex === undefined ? null : clampPackIndex(data.packIndex);
  }

  create(): void {
    this.index = 0;
    this.correct = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.score = 0;
    this.locked = false;
    this.paused = false;
    this.ended = false;
    this.started = false;
    this.pendingOutcome = null;
    this.pauseOverlay = null;
    this.options = [];
    this.timeShown = '';
    this.correctShown = '';
    this.streakShown = '';
    this.fiftyCharges = 0;
    this.fiftyButton = null;
    this.fiftyAppliedTo = -1;
    this.categoryIcon = null;
    this.sagaMap = null;
    this.boosterPicker = null;
    this.mapBackdrop = null;

    addBackground(this);
    this.cameras.main.fadeIn(220, 0, 0, 0);
    startMusic('run');
    setMusicIntensity(0.35);
    this.markDailyStreak();

    const explicit = this.requestedPack;
    if (explicit !== null) {
      this.beginPack(explicit, []);
      return;
    }
    if (this.replay) {
      // Boosters are consumed goods: a replay is the un-boosted pack.
      this.beginPack(clampPackIndex(load<number>(WORD_LAST_PACK_KEY, 0)), []);
      return;
    }
    this.openSagaMap();
  }

  /** Advances the daily streak once per entry; celebrates only real growth. */
  private markDailyStreak(): void {
    const streak = touchDailyStreak();
    if (!streak.extended) return;
    this.time.delayedCall(520, () => {
      floatText(this, VIEW.centerX, SAFE.top + 60, `DAY ${streak.days} STREAK!`, CSS.accent, 46);
      sfx('combo', { volume: 0.5 });
    });
  }

  // --- meta gateway ---------------------------------------------------------

  /** The five packs as a saga map. CLOSE leaves for the menu; nothing is up yet. */
  private openSagaMap(): void {
    this.mapBackdrop = this.add
      .rectangle(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height, PALETTE.bgDeep, 0.72)
      .setScrollFactor(0)
      .setDepth(2100);

    const starsByLevel: Record<string, number> = {};
    for (const pack of WORD_TUNING.packs) starsByLevel[pack.id] = bestStars(pack.id);

    this.sagaMap = showSagaMap(this, {
      levels: WORD_TUNING.packs.map((pack) => ({ id: pack.id, label: pack.label })),
      // Stored progress is the NEXT unplayed pack, so the frontier is one wider.
      unlockedCount: clampPackIndex(load<number>(WORD_PROGRESS_KEY, 0)) + 1,
      starsByLevel,
      onPick: (levelId) => {
        const index = WORD_TUNING.packs.findIndex((pack) => pack.id === levelId);
        this.closeMetaOverlays();
        this.offerBoosters(clampPackIndex(index < 0 ? 0 : index));
      },
      onClose: () => {
        this.closeMetaOverlays();
        this.scene.start(SCENES.menu);
      },
    });
  }

  /**
   * Pre-pack booster offer, off the word catalog in `data/metaCatalog.ts` — it
   * owns the ids and the copy, this reads the counts and spends what is armed.
   * A player who owns nothing never sees the gate.
   */
  private offerBoosters(index: number): void {
    const offers = metaCatalogFor('word')
      .filter((entry) => entry.kind === 'booster' && entry.boosterId !== undefined)
      .map((entry) => ({
        id: entry.boosterId as string,
        name: entry.name.toUpperCase(),
        count: boosterCount(entry.boosterId as string),
      }));

    if (offers.every((offer) => offer.count === 0)) {
      this.beginPack(index, []);
      return;
    }

    this.boosterPicker = showBoosterPicker(this, {
      boosters: offers,
      maxPick: WORD_TUNING.boosters.maxPick,
      onStart: (selected) => {
        this.closeMetaOverlays();
        this.beginPack(index, selected);
      },
    });
  }

  private closeMetaOverlays(): void {
    this.sagaMap?.destroy();
    this.sagaMap = null;
    this.boosterPicker?.destroy();
    this.boosterPicker = null;
    this.mapBackdrop?.destroy();
    this.mapBackdrop = null;
  }

  /**
   * Draws pack `index` and starts its clock. Boosters are spent HERE, because
   * the spend is what commits the pack: a picker the player backs out of costs
   * them nothing.
   */
  private beginPack(index: number, boosters: readonly string[]): void {
    this.packIndex = index;
    let extraSeconds = 0;
    for (const id of boosters) {
      if (!spendBooster(id)) continue;
      if (id === BOOSTER_TIME_PLUS) extraSeconds += WORD_TUNING.boosters.timePlusSeconds;
      if (id === BOOSTER_FIFTY) this.fiftyCharges += 1;
    }
    // Written before the first question so RETRY (seed only) replays THIS pack
    // even after a win advanced the ladder.
    save(WORD_LAST_PACK_KEY, index);

    this.quiz = drawPack(new Rng(`${this.seed}:${wordPack(index).id}`), index);

    this.level = new LevelDirector(wordPackSpec(index, extraSeconds), {
      // Held back until the answer feedback has played out.
      onEnd: (outcome) => {
        this.pendingOutcome = outcome;
      },
    });

    this.buildHud();
    this.buildQuestionPanel();
    this.buildOptions();
    if (this.fiftyCharges > 0) this.buildFiftyButton();

    this.input.keyboard?.on('keydown-ESC', () => this.togglePause());

    this.showQuestion();
    this.refreshHud();
    this.started = true;

    if (extraSeconds > 0) {
      floatText(this, VIEW.centerX, SAFE.top + 110, `+${extraSeconds}s ON THE CLOCK`, CSS.good, 40);
    }
  }

  /**
   * The in-quiz `fifty-fifty` button: one press greys two wrong options of the
   * question on screen. It is a HUD control rather than a picker chip because
   * the player cannot know in advance WHICH question they will be stuck on.
   */
  private buildFiftyButton(): void {
    this.fiftyButton = new Button(
      this,
      VIEW.centerX,
      WORD_TUNING.layout.optionTop - 96,
      `50:50  x${this.fiftyCharges}`,
      () => this.useFiftyFifty(),
      {
        width: 240,
        height: 88,
        fill: PALETTE.bgTop,
        stroke: PALETTE.accent,
        textColor: CSS.accent,
        fontSize: '30px',
      },
    );
    this.fiftyButton.setDepth(1350);
  }

  private useFiftyFifty(): void {
    if (this.fiftyCharges <= 0 || this.locked || this.paused || this.ended) return;
    const question = this.current;
    if (question === undefined || this.fiftyAppliedTo === this.index) return;

    const wrong: number[] = [];
    for (let i = 0; i < this.options.length; i += 1) {
      if (i !== question.answerIndex) wrong.push(i);
    }
    for (let i = 0; i < WORD_TUNING.boosters.fiftyFiftyRemoves && i < wrong.length; i += 1) {
      this.options[wrong[i] as number]?.setAlpha(0.22);
    }

    this.fiftyCharges -= 1;
    this.fiftyAppliedTo = this.index;
    this.fiftyButton?.setLabel(`50:50  x${this.fiftyCharges}`);
    if (this.fiftyCharges <= 0) this.fiftyButton?.setVisible(false);
    sfx('whoosh', { volume: 0.5 });
  }

  update(_time: number, delta: number): void {
    if (!this.started || this.ended || this.paused) return;
    this.level.update(delta);
    this.refreshHud();
    this.settlePending();
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
    this.timeText = this.add
      .text(140, SAFE.top / 2, '', style)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1210);
    this.correctText = this.add
      .text(300, SAFE.top / 2, '', style)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1210);
    this.streakText = this.add
      .text(462, SAFE.top / 2, '', { ...style, color: CSS.accent })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1210);

    new Button(this, VIEW.width - SAFE.side - 44, SAFE.top / 2, 'II', () => this.togglePause(), {
      width: 88,
      height: 88,
      fill: PALETTE.bgTop,
      stroke: PALETTE.primary,
      textColor: '#e8ecf6',
      fontSize: '36px',
    }).setDepth(1500);

    // The pack the player is in, drawn once — it never changes mid-quiz.
    this.add
      .text(SAFE.side, SAFE.top / 2 + 52, `PACK ${this.packIndex + 1}/${WORD_PACK_COUNT}  ${wordPack(this.packIndex).label}`, {
        ...TEXT.label,
        color: CSS.inkSoft,
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(1210);
  }

  private buildQuestionPanel(): void {
    const { panelY, panelWidth, panelHeight } = WORD_TUNING.layout;
    drawPanel(this, panelWidth, panelHeight, {
      fill: PALETTE.bgTop,
      fillAlpha: 0.92,
      stroke: PALETTE.primary,
      radius: 30,
    })
      .setPosition(VIEW.centerX, panelY)
      .setScrollFactor(0);

    this.categoryText = this.add
      .text(VIEW.centerX + 16, panelY - panelHeight / 2 + 34, '', {
        ...TEXT.label,
        fontSize: '24px',
        color: CSS.primary,
      })
      .setOrigin(0.5)
      .setScrollFactor(0);

    // Category glyph: one frame of the shared `ui` icon sheet when its slot
    // resolves, and simply absent otherwise — a stand-in shape next to a
    // category name would be misinformation, not a fallback.
    this.categoryIcon = this.add
      .image(0, panelY - panelHeight / 2 + 34, TEX.disc)
      .setDisplaySize(WORD_TUNING.layout.categoryIconSize, WORD_TUNING.layout.categoryIconSize)
      .setScrollFactor(0)
      .setVisible(false);

    this.questionText = this.add
      .text(VIEW.centerX, panelY + 14, '', {
        ...TEXT.body,
        fontSize: '34px',
        color: CSS.ink,
        align: 'center',
        wordWrap: { width: panelWidth - 72 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setLineSpacing(8);
  }

  private buildOptions(): void {
    const { optionTop, optionGap, optionWidth, optionHeight } = WORD_TUNING.layout;
    // The reveal ring is drawn once and moved onto the right option when a
    // wrong answer needs correcting — never redrawn per frame.
    this.reveal = this.add.graphics().setScrollFactor(0).setDepth(1400).setVisible(false);
    paintPanel(this.reveal, optionWidth + 12, optionHeight + 12, {
      fillAlpha: 0,
      stroke: PALETTE.good,
      strokeAlpha: 1,
      strokeWidth: 7,
      radius: (optionHeight + 12) / 2,
    });

    for (let i = 0; i < 4; i += 1) {
      const button = new Button(
        this,
        VIEW.centerX,
        optionTop + i * optionGap,
        '',
        () => this.answer(i),
        {
          width: optionWidth,
          height: optionHeight,
          fill: PALETTE.bgTop,
          stroke: PALETTE.primary,
          textColor: '#f2f6ff',
          fontSize: '32px',
        },
      );
      button.setDepth(1300);
      this.options.push(button);
    }
  }

  private get current(): TriviaQuestion | undefined {
    return this.quiz[this.index];
  }

  private showQuestion(): void {
    const question = this.current;
    if (question === undefined) {
      // Reserve exhausted: the goal can no longer be met, so this is a loss.
      this.level.fail('out-of-questions');
      this.settlePending();
      return;
    }
    this.reveal.setVisible(false);
    const label = `${question.category.toUpperCase()}  ·  TIER ${question.difficulty}`;
    this.categoryText.setText(label);
    this.paintCategoryIcon(question);
    this.questionText.setText(question.question);
    for (let i = 0; i < this.options.length; i += 1) {
      this.options[i]?.setLabel(question.options[i] ?? '').setAlpha(1);
    }
    this.locked = false;
  }

  /**
   * Moves the category glyph in front of the label, or hides it while that
   * category has no resolvable art slot. Called once per question, never per
   * frame.
   */
  private paintCategoryIcon(question: TriviaQuestion): void {
    const icon = this.categoryIcon;
    if (icon === null) return;
    const slot = this.resolveSlot(WORD_TUNING.art.categories[question.category]);
    if (slot === null) {
      icon.setVisible(false);
      return;
    }
    icon
      .setTexture(slot.key, slot.frame)
      .setDisplaySize(WORD_TUNING.layout.categoryIconSize, WORD_TUNING.layout.categoryIconSize)
      .setPosition(this.categoryText.x - this.categoryText.width / 2 - 28, this.categoryText.y)
      .setVisible(true);
  }

  /**
   * The slot to draw with, or `null` when its texture never loaded (pruned art
   * group, or art that does not exist yet).
   */
  private resolveSlot(slot: ArtSlot | null): ArtSlot | null {
    if (slot === null) return null;
    return this.textures.exists(slot.key) ? slot : null;
  }

  private answer(choice: number): void {
    if (this.locked || this.paused || this.ended || this.level.ended) return;
    const question = this.current;
    if (question === undefined) return;
    this.locked = true;

    if (choice === question.answerIndex) {
      this.onCorrect(question, choice);
    } else {
      this.onWrong(question, choice);
    }
  }

  private onCorrect(question: TriviaQuestion, choice: number): void {
    this.correct += 1;
    this.streak += 1;
    this.bestStreak = Math.max(this.bestStreak, this.streak);

    let gained = WORD_TUNING.score.perDifficulty * question.difficulty;
    const button = this.options[choice];
    if (this.streak >= WORD_TUNING.score.streakThreshold) {
      const bonus = WORD_TUNING.score.streakBonus * this.streak;
      gained += bonus;
      floatText(
        this,
        VIEW.centerX,
        (button?.y ?? VIEW.centerY) - 70,
        `STREAK x${this.streak}  +${bonus}`,
        CSS.accent,
        44,
      );
      sfx('combo', { volume: 0.6, rate: 1 + Math.min(6, this.streak) * 0.05 });
    }
    this.score += gained;

    if (button !== undefined) {
      pop(this, button, 0.12, 180);
      burst(this, button.x, button.y, PALETTE.good, 12, 260);
      floatText(this, button.x + 200, button.y - 20, `+${gained}`, CSS.good, 38);
    }
    flash(this, PALETTE.good, 110);
    sfx('pickup');
    setMusicIntensity(0.35 + 0.5 * (this.correct / WORD_TUNING.quizLength));

    // Progress before the beat: the tenth correct answer must win instantly.
    this.level.recordProgress(GOAL_ANSWERS, 1);
    this.refreshHud();

    this.index += 1;
    this.time.delayedCall(WORD_TUNING.advanceMs, () => this.nextQuestion());
  }

  private onWrong(question: TriviaQuestion, choice: number): void {
    this.streak = 0;
    const button = this.options[choice];
    button?.setAlpha(0.4);
    shake(this, 0.016, 240);
    flash(this, PALETTE.bad, 140);
    sfx('hit', { volume: 0.7 });
    floatText(
      this,
      VIEW.centerX,
      (button?.y ?? VIEW.centerY) - 60,
      `-${WORD_TUNING.wrongPenaltySeconds}s`,
      CSS.bad,
      44,
    );

    const answerButton = this.options[question.answerIndex];
    if (answerButton !== undefined) {
      this.reveal.setPosition(answerButton.x, answerButton.y).setVisible(true);
    }

    // The penalty is charged to the same clock the director runs on, so a wrong
    // answer in the last seconds can genuinely end the level.
    this.level.update(WORD_TUNING.wrongPenaltySeconds * 1000);
    this.refreshHud();

    this.index += 1;
    this.time.delayedCall(WORD_TUNING.revealMs, () => this.nextQuestion());
  }

  private nextQuestion(): void {
    if (this.ended) return;
    if (this.settlePending()) return;
    this.showQuestion();
  }

  /** Ends the scene once the director has resolved. Returns true when it did. */
  private settlePending(): boolean {
    if (this.pendingOutcome === null) return false;
    const outcome = this.pendingOutcome;
    this.pendingOutcome = null;
    this.locked = true;
    this.time.delayedCall(360, () => this.finish(outcome));
    return true;
  }

  /** Text is diffed: an unchanged HUD value never touches `setText`. */
  private refreshHud(): void {
    const time = `TIME ${Math.ceil(this.level.timeLeftSeconds ?? 0)}`;
    if (time !== this.timeShown) {
      this.timeShown = time;
      this.timeText.setText(time);
      this.timeText.setColor((this.level.timeLeftSeconds ?? 0) <= 15 ? CSS.bad : CSS.ink);
    }
    const correct = `${this.correct}/${WORD_TUNING.quizLength}`;
    if (correct !== this.correctShown) {
      this.correctShown = correct;
      this.correctText.setText(correct);
    }
    const streak = this.streak >= 2 ? `x${this.streak}` : '';
    if (streak !== this.streakShown) {
      this.streakShown = streak;
      this.streakText.setText(streak);
    }
  }

  private togglePause(): void {
    if (this.ended) return;
    if (this.paused) {
      this.resumeFromPause();
      return;
    }
    this.paused = true;
    this.level.pause();
    for (const button of this.options) button.setAlpha(0.35);
    this.pauseOverlay = showPauseOverlay(
      this,
      () => this.resumeFromPause(),
      () => {
        this.pauseOverlay?.destroy();
        this.pauseOverlay = null;
        // The same pack, a fresh draw: RESTART is "give me another go at this
        // difficulty", not a replay of the questions just seen.
        this.scene.restart({ seed: Date.now().toString(36), packIndex: this.packIndex });
      },
    );
  }

  private resumeFromPause(): void {
    this.paused = false;
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
    this.level.resume();
    for (const button of this.options) button.setAlpha(1);
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

    const pack = wordPack(this.packIndex);
    const stars = this.level.stars;
    if (outcome.won) {
      // The clock LEFT is the rating (see `wordPackSpec`), so this is what the
      // pack map shows next time.
      recordStars(pack.id, stars);
      save(WORD_PROGRESS_KEY, Math.min(this.packIndex + 1, WORD_PACK_COUNT - 1));
    }

    this.cameras.main.fadeOut(340, 0, 0, 0);
    this.time.delayedCall(360, () => {
      this.scene.start(SCENES.gameOver, {
        won: outcome.won,
        timeMs: this.level.elapsedSeconds * 1000,
        score: this.score,
        currencyEarned: Math.floor(this.score / WORD_TUNING.scorePerCurrency),
        seed: this.seed,
        stats: [
          { label: 'PACK', value: pack.label },
          { label: 'CORRECT', value: `${this.correct}/${WORD_TUNING.quizLength}` },
          { label: 'STARS', value: `${stars}/${MAX_STARS}` },
          { label: 'BEST STREAK', value: `${this.bestStreak}` },
        ],
        headline: outcome.won ? 'QUIZ COMPLETE!' : "TIME'S UP",
        // The clock is a budget the quiz is played AGAINST, not a result to
        // compare between packs: stars carry the fast-finish reward.
        timeLabel: null,
        bestTimeMode: 'off',
      });
    });
  }
}
