import Phaser from 'phaser';
import { PALETTE, TEXT } from '../config';
import { drawPill } from './primitives';

/**
 * Reusable value bar (HP, XP, cooldown, boss phase, ...): a primitive capsule
 * housing plus a tinted `TEX.square` fill. The fill never redraws a `Graphics`
 * object — `setValue` only tweens `scaleX` on a pre-sized image, which is what
 * keeps this affordable with hundreds of live enemy HP bars on screen.
 *
 * Chrome is drawn, not stretched art: a bar is geometry, so it must follow the
 * palette and any width/height the caller asks for.
 *
 * Use for: any HUD or world-space value readout in a game with lots of
 * simultaneous entities (survivor-like enemy HP, tower-defense cooldowns,
 * roguelike XP/stamina).
 * Do NOT use for: a decorative meter that never changes — a single
 * `drawPill` call is enough there.
 */

/**
 * Housing rim thickness in px. Scaled down for short bars (enemy HP strips)
 * so the rim never eats the whole fill.
 */
const BAR_RIM_MAX = 4;

function rimFor(height: number): number {
  return Math.min(BAR_RIM_MAX, Math.max(1, Math.floor(height * 0.22)));
}

export interface BarOptions {
  color?: number;
  bgColor?: number;
  label?: string;
}

export class Bar extends Phaser.GameObjects.Container {
  private readonly fill: Phaser.GameObjects.Graphics;
  private readonly innerWidth: number;
  private readonly innerHeight: number;
  private readonly fillColor: number;
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

    // Primitive capsule housing: adapts to any size, no texture margins to
    // compensate for, and re-skins with the palette.
    const frame = drawPill(scene, width, height, {
      fill: PALETTE.bgDeep,
      fillAlpha: 0.9,
      stroke: options.color ?? PALETTE.inkSoft,
      strokeAlpha: 0.55,
      strokeWidth: 3,
    });

    // Track and fill both live inside the housing rim. The track is a static
    // capsule; the fill is a Graphics object redrawn on value changes.
    const rim = rimFor(height);
    const innerW = width - rim * 2;
    const innerH = Math.max(4, height - rim * 2);
    this.innerWidth = innerW;
    this.innerHeight = innerH;
    this.fillColor = options.color ?? PALETTE.good;

    const track = drawPill(scene, innerW, innerH, {
      fill: options.bgColor ?? PALETTE.bgDeep,
      fillAlpha: 1,
      strokeWidth: 0,
    });

    this.fill = scene.add.graphics();
    this.paintFill(1);

    this.add([frame, track, this.fill]);

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

  /** Draws the fill as a capsule whose radius never exceeds its own half-size. */
  private paintFill(ratio: number): void {
    this.drawn = ratio;
    const w = this.innerWidth * ratio;
    this.fill.clear();
    if (w <= 0.5) return;
    const radius = Math.min(this.innerHeight / 2, w / 2);
    this.fill.fillStyle(this.fillColor, 1);
    this.fill.fillRoundedRect(-this.innerWidth / 2, -this.innerHeight / 2, w, this.innerHeight, radius);
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
