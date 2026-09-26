import Phaser from 'phaser';
import { PALETTE, TEXT } from '../config';
import { sfx } from '../core/audio';
import { paintPanel, paintPill } from './primitives';

interface ButtonOptions {
  width?: number;
  height?: number;
  /** Body colour of the capsule. */
  fill?: number;
  /** Border colour; defaults to a lighter relative of `fill`. */
  stroke?: number;
  textColor?: string;
  fontSize?: string;
  /** Corner radius; defaults to a full capsule (height / 2). */
  radius?: number;
}

/**
 * Travel (design px) past which a press is a DRAG, not a tap (PRD-V2 §14.2:
 * "tap = travel ≤ 12 px"). A scroll that starts on a control must not fire it.
 */
export const TAP_SLOP = 12;

/**
 * Click semantics for any interactive object: arm on its own POINTER_DOWN,
 * disarm on POINTER_OUT, fire on POINTER_UP only if armed AND the pointer
 * travelled ≤ `TAP_SLOP` (so a drag-scroll that began on the object is not a
 * tap). `onPress` gives the ≤100 ms acknowledgment hook (pressed repaint).
 * The object must already be interactive.
 */
export function bindTap(
  obj: Phaser.GameObjects.GameObject,
  onTap: () => void,
  onPress?: (pressed: boolean) => void,
): void {
  let armed = false;
  obj.on(Phaser.Input.Events.POINTER_DOWN, () => {
    armed = true;
    onPress?.(true);
  });
  obj.on(Phaser.Input.Events.POINTER_OUT, () => {
    if (armed) onPress?.(false);
    armed = false;
  });
  obj.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
    if (!armed) return;
    armed = false;
    onPress?.(false);
    if (pointer.getDistance() > TAP_SLOP) return;
    onTap();
  });
}

/**
 * Chunky tappable capsule sized for thumbs (>= 88px tall), drawn with
 * primitives so it adapts to any width/height and follows `PALETTE` when a game
 * is re-skinned. Pressed state repaints once on pointer events — never per
 * frame.
 */
export class Button extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly boxWidth: number;
  private readonly boxHeight: number;
  private fillColor: number;
  private strokeColor: number;
  private readonly radius: number | undefined;
  private enabled = true;
  /** Fired instead of `onClick` while disabled — the refusal-with-feedback path. */
  private onRefuse: (() => void) | null = null;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    onClick: () => void,
    options: ButtonOptions = {},
  ) {
    super(scene, x, y);
    this.boxWidth = options.width ?? 420;
    this.boxHeight = options.height ?? 112;
    this.fillColor = options.fill ?? PALETTE.primary;
    this.strokeColor = options.stroke ?? PALETTE.ink;
    this.radius = options.radius;

    this.bg = scene.add.graphics();
    this.paint(false);

    // The pill IS the contrast surface: the global TEXT armour (stroke +
    // shadow, tuned for text on the raw backdrop) reads as grime on top of
    // it, so strip both.
    this.label = scene.add
      .text(0, 0, text, {
        ...TEXT.button,
        color: options.textColor ?? '#05070d',
        stroke: undefined,
        strokeThickness: 0,
        shadow: undefined,
        align: 'center',
        ...(options.fontSize ? { fontSize: options.fontSize } : {}),
      })
      .setOrigin(0.5);

    this.add([this.bg, this.label]);
    this.setSize(this.boxWidth, this.boxHeight);
    // Buttons are screen furniture: pin them so a scrolling camera cannot move
    // the hit area away from the pixels (Phaser hit-tests each interactive
    // object against the camera scroll on its own).
    this.setScrollFactor(0);
    this.setInteractive({ useHandCursor: true });

    this.on(Phaser.Input.Events.POINTER_OVER, () => {
      if (this.enabled) this.scene.tweens.add({ targets: this, scale: 1.04, duration: 120, ease: 'Quad.easeOut' });
    });
    this.on(Phaser.Input.Events.POINTER_OUT, () => {
      this.scene.tweens.add({ targets: this, scale: 1, duration: 120 });
    });

    // Click semantics: only a release that began on this button — and did not
    // travel into a drag — fires it.
    bindTap(
      this,
      () => {
        if (!this.enabled) {
          sfx('hit', { volume: 0.4 });
          this.onRefuse?.();
          this.scene.tweens.add({ targets: this, x: this.x + 6, duration: 50, yoyo: true, repeat: 1 });
          return;
        }
        sfx('ui');
        onClick();
      },
      (pressed) => {
        this.paint(pressed);
        this.setScale(pressed ? 0.97 : 1);
      },
    );

    scene.add.existing(this);
  }

  setLabel(text: string): this {
    this.label.setText(text);
    return this;
  }

  /**
   * Disabled buttons stay hit-testable so a tap is REFUSED with feedback
   * (headshake + soft sfx + optional `onRefuse`), never swallowed silently.
   */
  setEnabled(on: boolean, onRefuse?: () => void): this {
    this.enabled = on;
    this.onRefuse = onRefuse ?? null;
    this.setAlpha(on ? 1 : 0.4);
    return this;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Repaint with a new fill/stroke/label colour (state changes only). */
  setStyle(style: { fill: number; stroke: number; textColor: string }): this {
    this.fillColor = style.fill;
    this.strokeColor = style.stroke;
    this.label.setColor(style.textColor);
    this.paint(false);
    return this;
  }

  /** Pressed state darkens the body and drops the gloss — one repaint per event. */
  private paint(pressed: boolean): void {
    const style = {
      fill: pressed ? darken(this.fillColor, 0.72) : this.fillColor,
      stroke: this.strokeColor,
      strokeAlpha: pressed ? 0.5 : 0.9,
      // §14.4 BUTTON.strokeWidth: 2. At 4 px a primary's deep-ink rim read as a
      // dark plate behind the pill (QA 8).
      strokeWidth: 2,
      // Gloss only on light fills: on the dark idle fill the white band reads
      // as a grey slab across the top half of the button (QA-v2b N4).
      gloss: !pressed && luminance(this.fillColor) > 0.35,
    };
    if (this.radius === undefined) {
      paintPill(this.bg, this.boxWidth, this.boxHeight, style);
    } else {
      paintPanel(this.bg, this.boxWidth, this.boxHeight, { ...style, strokeWidth: 2, radius: this.radius });
    }
  }
}

/** Relative luminance (0..1, sRGB-weighted, no gamma) of a packed 0xRRGGBB colour. */
function luminance(color: number): number {
  return (0.2126 * ((color >> 16) & 0xff) + 0.7152 * ((color >> 8) & 0xff) + 0.0722 * (color & 0xff)) / 255;
}

/** Multiplies a packed 0xRRGGBB colour's channels — used for pressed states. */
function darken(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8) & 0xff) * factor);
  const b = Math.round((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}
