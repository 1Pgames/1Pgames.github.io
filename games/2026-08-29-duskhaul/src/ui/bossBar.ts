import Phaser from 'phaser';
import { CSS, TEXT, bareText } from '../config';
import { HUD_DEPTH, IDENTITY, SCRIM, paintBar } from './duskChrome';

/**
 * PRD-V2 §14.9 boss bar (replaces V1 `wardenMark.ts`'s plate): bar at
 * (80, 328, 560, 20) with the boss name 22 px at y 300 (x ≤ 500), shown for the
 * zone boss and the mid-boss only. It sits on one §14.4 scrim band (text over
 * generated art), so the name goes bare. The "where is it" half of the V1
 * marker is now the compass ring's red chevron (`ui/gateCompass.ts`, §13.2).
 *
 * `Hud.set` drives it from `HudModelV2.boss`; it never reads game state.
 */

const BAR = { x: 80, y: 328, width: 560, height: 20 } as const;
const NAME = { x: 80, y: 300, maxWidth: 420, fontSize: 22 } as const;
/**
 * Scrim band covering name + bar. `split` is the minimap's bottom edge + 4:
 * above it the scrim covers only the name column (x ≤ 516); the bar row ends at
 * 354, clear of the toast lane (360).
 */
const BAND = { top: 286, split: 316, bottom: 354, nameRight: 516 } as const;
const HP_EPSILON = 0.004;
const FADE_MS = 220;

export class BossBar {
  private readonly root: Phaser.GameObjects.Container;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly name: Phaser.GameObjects.Text;
  private shownName: string | null = null;
  private drawnHp = -1;
  private fade: Phaser.Tweens.Tween | null = null;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    const scrim = scene.add.graphics();
    scrim.fillStyle(SCRIM.fill, SCRIM.alpha);
    // Two-step scrim: the name row stops at x 516 so it never reaches under the
    // minimap (520-680 × 152-312, QA #17); the bar row runs full width below it.
    const left = BAR.x - SCRIM.pad;
    const r = SCRIM.radius;
    scrim.fillRoundedRect(left, BAND.top, BAND.nameRight - left, BAND.split - BAND.top, { tl: r, tr: r, bl: 0, br: 0 });
    scrim.fillRoundedRect(left, BAND.split, BAR.width + SCRIM.pad * 2, BAND.bottom - BAND.split, { tl: 0, tr: r, bl: r, br: r });
    this.bar = scene.add.graphics({ x: BAR.x + BAR.width / 2, y: BAR.y + BAR.height / 2 });
    this.name = scene.add
      .text(NAME.x, NAME.y, '', {
        ...TEXT.label,
        fontSize: `${NAME.fontSize}px`,
        color: CSS.warn,
        ...bareText(),
      })
      .setOrigin(0, 0.5);
    this.root = scene.add
      .container(0, 0, [scrim, this.bar, this.name])
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH.boss)
      .setVisible(false)
      .setAlpha(0);
  }

  set(boss: { name: string; hpRatio: number } | null): void {
    if (this.destroyed) return;
    if (boss === null) {
      if (this.shownName !== null) this.hide();
      return;
    }
    if (boss.name !== this.shownName) {
      this.shownName = boss.name;
      this.name.setText(boss.name.toUpperCase()).setFontSize(NAME.fontSize);
      let size = NAME.fontSize;
      while (this.name.width > NAME.maxWidth && size > 16) this.name.setFontSize(--size);
      this.show();
    }
    if (Math.abs(boss.hpRatio - this.drawnHp) > HP_EPSILON) {
      this.drawnHp = boss.hpRatio;
      paintBar(this.bar, BAR.width, BAR.height, boss.hpRatio, IDENTITY.threat);
    }
  }

  private show(): void {
    this.fade?.remove();
    this.root.setVisible(true);
    this.fade = this.scene.tweens.add({
      targets: this.root,
      alpha: 1,
      duration: FADE_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.fade = null;
      },
    });
  }

  private hide(): void {
    this.shownName = null;
    this.drawnHp = -1;
    this.fade?.remove();
    this.fade = this.scene.tweens.add({
      targets: this.root,
      alpha: 0,
      duration: FADE_MS,
      onComplete: () => {
        this.fade = null;
        this.root.setVisible(false);
      },
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fade?.remove();
    this.fade = null;
    this.root.destroy();
  }
}
