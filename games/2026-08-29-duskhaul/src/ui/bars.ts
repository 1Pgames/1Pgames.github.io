import Phaser from 'phaser';
import { PALETTE, TEXT } from '../config';
import { paintBar } from './duskChrome';

/**
 * Reusable value bar (HP, XP, channel, cooldown, boss phase, ...). Housing and
 * fill are ONE `Graphics` painted by `duskChrome.paintBar`, which owns the
 * §14.4 "Bar housings" spec: fill `#03040b` at alpha 0.85, stroke 2px
 * `#7e7376` at alpha 0.60, radius 6.
 *
 * The fill is REDRAWN on value changes, never scaled: scaling a rounded shape
 * turns its caps into ellipses and a nearly-empty bar into a smear. The fill's
 * radius shrinks with its width, so 5% is a dot and 100% is a capsule. The
 * repaint happens only while a value animates.
 *
 * Chrome is drawn, not stretched art: a bar is geometry, so it must follow the
 * authored chrome spec and any width/height the caller asks for.
 *
 * Use for: any HUD or world-space value readout in a game with lots of
 * simultaneous entities (survivor-like enemy HP, tower-defense cooldowns,
 * roguelike XP/stamina).
 * Do NOT use for: a decorative meter that never changes — a single
 * `drawPill` call is enough there.
 */

export interface BarOptions {
  /** Fill colour at and above `lowAt`. */
  color?: number;
  /**
   * Fill colour the bar lerps to as it empties. §14.4: HP is `#9bdf9f` and
   * turns `#ff4739` below 30%. Omitted = a single-colour fill.
   */
  lowColor?: number;
  /** Ratio at which `lowColor` is fully reached. Default 0.3 (§14.4). */
  lowAt?: number;
  label?: string;
}

export class Bar extends Phaser.GameObjects.Container {
  /**
   * Housing + fill in ONE `Graphics`. `duskChrome.paintBar` owns the §14.4
   * geometry (fill `#03040b` @0.85, stroke 2px `#7e7376` @0.60, radius 6) and
   * REDRAWS the fill instead of scaling it, so a 5% bar is a dot and a 100%
   * bar is a capsule.
   */
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly barHeight: number;
  private readonly fillColor: number;
  private readonly lowColor: number | null;
  private readonly lowAt: number;
  private readonly width_: number;
  /** Value actually drawn; the tween walks `drawn` toward `ratio`. */
  private ratio = 1;
  private drawn = 1;
  private fillTween: Phaser.Tweens.Tween | null = null;

  /**
   * Phaser nulls `GameObject#scene` on destroy, and scene shutdown destroys
   * children before every SHUTDOWN listener has run — so a listener that
   * touched `this.scene` threw and aborted the rest of the shutdown (which is
   * how a game-over transition turns into a black screen). Hold our own
   * reference and treat `destroyed` as the single guard.
   */
  private readonly ownScene: Phaser.Scene;
  private destroyed = false;

  private followTargetObj: (Phaser.GameObjects.Sprite | Phaser.GameObjects.Container) | null = null;
  private followOffsetY = 0;
  private readonly followUpdate = (): void => this.applyFollow();
  private readonly onShutdown = (): void => this.stopFollow();

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    options: BarOptions = {},
  ) {
    super(scene, x, y);
    this.ownScene = scene;
    this.width_ = width;

    this.barHeight = height;
    this.fillColor = options.color ?? PALETTE.good;
    this.lowColor = options.lowColor ?? null;
    this.lowAt = options.lowAt ?? 0.3;

    this.g = scene.add.graphics();
    this.paintFill(1);

    this.add([this.g]);

    if (options.label) {
      const label = scene.add
        .text(-width / 2, -height / 2 - 18, options.label, TEXT.label)
        .setOrigin(0, 1);
      this.add(label);
    }

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown);
    scene.add.existing(this);
  }

  /** Tweens the fill to `current / max` (clamped to [0, 1]). */
  setValue(current: number, max: number): void {
    if (this.destroyed) return;
    const target = max > 0 ? Phaser.Math.Clamp(current / max, 0, 1) : 0;
    if (target === this.ratio) return;
    this.ratio = target;

    // The fill is REDRAWN, not scaled: scaling a rounded texture stretches its
    // corners into ellipses. Redrawing keeps the cap radius constant and lets a
    // nearly-empty bar shrink into a dot instead of a smear. Repaints happen
    // only while a value animates, and only a handful of bars exist at once.
    this.fillTween?.remove();
    this.fillTween = this.ownScene.tweens.addCounter({
      from: this.drawn,
      to: target,
      duration: 180,
      ease: 'Quad.easeOut',
      onUpdate: (tween) => this.paintFill(tween.getValue() ?? target),
      onComplete: () => {
        this.fillTween = null;
        this.paintFill(target);
      },
    });
  }

  /**
   * Repaints housing + fill at `ratio`. §14.4: HP lerps `#9bdf9f` -> `#ff4739`
   * below 30%, so the fill tone is a function of the value, not of
   * construction.
   */
  private paintFill(ratio: number): void {
    this.drawn = ratio;
    paintBar(this.g, this.width_, this.barHeight, ratio, this.toneAt(ratio));
  }

  private toneAt(ratio: number): number {
    if (this.lowColor === null || ratio >= this.lowAt) return this.fillColor;
    const t = this.lowAt > 0 ? Phaser.Math.Clamp(ratio / this.lowAt, 0, 1) : 0;
    return Phaser.Display.Color.ObjectToColor(
      Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.IntegerToColor(this.lowColor),
        Phaser.Display.Color.IntegerToColor(this.fillColor),
        100,
        Math.round(t * 100),
      ),
    ).color;
  }

  /** Sticks this bar above `target` every frame — use for enemy HP bars. */
  followTarget(target: Phaser.GameObjects.Sprite | Phaser.GameObjects.Container, offsetY = -40): void {
    if (this.destroyed) return;
    this.followTargetObj = target;
    this.followOffsetY = offsetY;
    this.ownScene.events.off(Phaser.Scenes.Events.UPDATE, this.followUpdate, this);
    this.ownScene.events.on(Phaser.Scenes.Events.UPDATE, this.followUpdate, this);
    this.applyFollow();
  }

  stopFollow(): void {
    this.followTargetObj = null;
    this.ownScene.events.off(Phaser.Scenes.Events.UPDATE, this.followUpdate, this);
  }

  override destroy(fromScene?: boolean): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopFollow();
    this.ownScene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown);
    super.destroy(fromScene);
  }

  private applyFollow(): void {
    const target = this.followTargetObj;
    if (!target) return;
    this.setPosition(target.x, target.y + this.followOffsetY);
  }

  /** Bar width in px, for callers laying out several bars side by side. */
  get barWidth(): number {
    return this.width_;
  }
}
