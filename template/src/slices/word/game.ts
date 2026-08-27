import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../../config';
import { SCENES } from '../../core/keys';
import { Rng } from '../../core/rng';
import { sfx } from '../../core/audio';
import { setMusicIntensity, startMusic } from '../../core/music';
import { burst, flash, floatText, pop, shake } from '../../core/juice';
import { LevelDirector } from '../../core/level';
import type { SessionOutcome } from '../../core/session';
import { drawQuiz, type TriviaQuestion } from '../../data/trivia';
import { addBackground } from '../../ui/background';
import { Button } from '../../ui/button';
import { drawPanel, paintPanel } from '../../ui/primitives';
import { showPauseOverlay, type PauseOverlayHandle } from '../../ui/pauseOverlay';
import { WORD_TUNING } from './tuning';

const GOAL_ANSWERS = 'answers';

/**
 * Family H (trivia quiz) slice: 10 correct answers inside 90 seconds, off a
 * seeded question draw that ramps from tier 1 to tier 3. A wrong answer costs
 * clock and burns one of the reserve questions instead of ending the level.
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

  constructor() {
    super(SCENES.game);
  }

  /** `scene.start(SCENES.game, { seed })` replays the exact same question set. */
  init(data: { seed?: string } = {}): void {
    this.seed = data.seed ?? Date.now().toString(36);
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
    this.pendingOutcome = null;
    this.pauseOverlay = null;
    this.options = [];
    this.timeShown = '';
    this.correctShown = '';
    this.streakShown = '';

    const rng = new Rng(this.seed);
    this.quiz = drawQuiz(rng, WORD_TUNING.poolSize);

    addBackground(this);

    this.level = new LevelDirector(
      {
        id: 'word-quiz',
        goals: [{ id: GOAL_ANSWERS, target: WORD_TUNING.quizLength }],
        timeSeconds: WORD_TUNING.timeSeconds,
      },
      {
        // Held back until the answer feedback has played out.
        onEnd: (outcome) => {
          this.pendingOutcome = outcome;
        },
      },
    );

    this.buildHud();
    this.buildQuestionPanel();
    this.buildOptions();

    this.input.keyboard?.on('keydown-ESC', () => this.togglePause());

    this.showQuestion();
    this.refreshHud();
    this.cameras.main.fadeIn(220, 0, 0, 0);
    startMusic('run');
    setMusicIntensity(0.35);
  }

  update(_time: number, delta: number): void {
    if (this.ended || this.paused) return;
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
      .text(VIEW.centerX, panelY - panelHeight / 2 + 34, '', {
        ...TEXT.label,
        fontSize: '24px',
        color: CSS.primary,
      })
      .setOrigin(0.5)
      .setScrollFactor(0);

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
    this.categoryText.setText(`${question.category.toUpperCase()}  ·  TIER ${question.difficulty}`);
    this.questionText.setText(question.question);
    for (let i = 0; i < this.options.length; i += 1) {
      this.options[i]?.setLabel(question.options[i] ?? '').setAlpha(1);
    }
    this.locked = false;
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
        this.scene.restart({ seed: Date.now().toString(36) });
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

    this.cameras.main.fadeOut(340, 0, 0, 0);
    this.time.delayedCall(360, () => {
      this.scene.start(SCENES.gameOver, {
        won: outcome.won,
        timeMs: this.level.elapsedSeconds * 1000,
        score: this.score,
        currencyEarned: Math.floor(this.score / WORD_TUNING.scorePerCurrency),
        seed: this.seed,
        stats: [
          { label: 'CORRECT', value: `${this.correct}/${WORD_TUNING.quizLength}` },
          { label: 'BEST STREAK', value: `${this.bestStreak}` },
        ],
      });
    });
  }
}
