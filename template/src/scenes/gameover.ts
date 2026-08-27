import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../config';
import { SCENES } from '../core/keys';
import { countTo, enterFromBottom } from '../core/juice';
import { sfx } from '../core/audio';
import { grantCurrency, loadMeta, recordRunResult } from '../core/progression';
import { Button } from '../ui/button';
import { addBackground } from '../ui/background';

/** Data `GameScene` passes via `scene.start(SCENES.gameOver, data)`. */
export interface GameOverData {
  won: boolean;
  timeMs: number;
  kills: number;
  score: number;
  currencyEarned: number;
  level: number;
  /** Run seed, replayed by RETRY (`GameScene.init` reruns the same run when given a seed). */
  seed: string;
}

/** mm:ss clock for the survived-time readout. */
function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Run-results screen. This is the ONLY place that folds a finished run into
 * meta-progression: it calls `recordRunResult` and `grantCurrency` from
 * `core/progression.ts` exactly once per scene instance, guarded by a flag
 * checked before any state is touched. `GameScene` must only pass data here
 * — it must never call those two functions itself, or currency/stats would
 * be double-counted.
 */
export class GameOverScene extends Phaser.Scene {
  private result: GameOverData = {
    won: false,
    timeMs: 0,
    kills: 0,
    score: 0,
    currencyEarned: 0,
    level: 1,
    seed: '',
  };

  private settled = false;

  constructor() {
    super(SCENES.gameOver);
  }

  init(data: Partial<GameOverData>): void {
    this.result = {
      won: data.won ?? false,
      timeMs: data.timeMs ?? 0,
      kills: data.kills ?? 0,
      score: data.score ?? 0,
      currencyEarned: data.currencyEarned ?? 0,
      level: data.level ?? 1,
      seed: data.seed ?? '',
    };
    this.settled = false;
  }

  create(): void {
    addBackground(this, false);

    // Settle meta-progression exactly once for this run, before any stat
    // is read for display (so "NEW BEST" reflects this run's outcome).
    const before = loadMeta();
    const wasBestScore = this.result.score > before.stats.bestScore;
    const wasBestTime = this.result.timeMs > before.stats.bestTimeMs;

    if (!this.settled) {
      this.settled = true;
      recordRunResult({ won: this.result.won, score: this.result.score, timeMs: this.result.timeMs });
      if (this.result.currencyEarned > 0) grantCurrency(this.result.currencyEarned);
    }

    const heading = this.add
      .text(VIEW.centerX, VIEW.centerY - 380, this.result.won ? 'RUN COMPLETE' : 'YOU DIED', {
        ...TEXT.heading,
        color: this.result.won ? CSS.accent : CSS.bad,
      })
      .setOrigin(0.5);

    const scoreText = this.add
      .text(VIEW.centerX, VIEW.centerY - 260, '0', { ...TEXT.title, fontSize: '80px', color: CSS.ink })
      .setOrigin(0.5);
    countTo(this, scoreText, 0, this.result.score, 700);

    const bestBadge = this.add
      .text(VIEW.centerX, VIEW.centerY - 190, wasBestScore ? 'NEW BEST SCORE' : '', {
        ...TEXT.label,
        color: CSS.accent,
      })
      .setOrigin(0.5);

    const stats = this.add
      .text(
        VIEW.centerX,
        VIEW.centerY - 90,
        `SURVIVED ${formatClock(this.result.timeMs)}${wasBestTime ? '  (NEW BEST)' : ''}\n` +
          `LEVEL ${this.result.level}   KILLS ${this.result.kills}`,
        { ...TEXT.body, align: 'center' },
      )
      .setOrigin(0.5)
      .setLineSpacing(10);

    const currencyText = this.add
      .text(VIEW.centerX, VIEW.centerY + 20, `+${this.result.currencyEarned} COINS`, {
        ...TEXT.heading,
        fontSize: '44px',
        color: CSS.accent,
      })
      .setOrigin(0.5);

    const seedText = this.add
      .text(VIEW.centerX, VIEW.centerY + 70, `seed ${this.result.seed}`, { ...TEXT.label, color: CSS.inkSoft })
      .setOrigin(0.5);

    const buttonWidth = VIEW.width - SAFE.side * 2;
    const retryY = VIEW.height - SAFE.bottom - 220;
    const upgradesY = VIEW.height - SAFE.bottom - 100;
    const menuY = VIEW.height - SAFE.bottom;

    const retry = new Button(this, VIEW.centerX, retryY, 'RETRY', () =>
      this.scene.start(SCENES.game),
      { width: buttonWidth, height: 112 },
    );
    const upgrades = new Button(
      this,
      VIEW.centerX,
      upgradesY,
      'UPGRADES',
      () => this.scene.start(SCENES.meta),
      { width: buttonWidth, height: 96, fill: PALETTE.bgTop, stroke: PALETTE.primary, textColor: CSS.ink },
    );
    const menu = new Button(
      this,
      VIEW.centerX,
      menuY,
      'MENU',
      () => this.scene.start(SCENES.menu),
      { width: buttonWidth, height: 88, fill: PALETTE.bgTop, stroke: PALETTE.primary, textColor: CSS.inkSoft, fontSize: '32px' },
    );

    enterFromBottom(this, heading, 0);
    enterFromBottom(this, bestBadge, 80);
    enterFromBottom(this, stats, 120);
    enterFromBottom(this, currencyText, 160);
    enterFromBottom(this, seedText, 180);
    enterFromBottom(this, retry, 200);
    enterFromBottom(this, upgrades, 240);
    enterFromBottom(this, menu, 280);

    sfx(this.result.won ? 'levelup' : 'die', { volume: 0.7 });

    // Space / tap anywhere = retry.
    this.input.keyboard?.once('keydown-SPACE', () => this.scene.start(SCENES.game));
    this.cameras.main.fadeIn(240, 0, 0, 0);
  }
}
