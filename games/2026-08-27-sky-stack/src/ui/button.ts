import Phaser from 'phaser';
import { PALETTE, TEXT } from '../config';
import { sfx } from '../core/audio';
import { paintPill } from './primitives';

interface ButtonOptions {
  width?: number;
  height?: number;
  /** Body colour of the capsule. */
  fill?: number;
  /** Border colour; defaults to a lighter relative of `fill`. */
  stroke?: number;
  textColor?: string;
  fontSize?: string;
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
  private readonly fillColor: number;
  private readonly strokeColor: number;

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

    this.bg = scene.add.graphics();
    this.paint(false);

    this.label = scene.add
      .text(0, 0, text, {
        ...TEXT.button,
        color: options.textColor ?? '#05070d',
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

    // Click semantics: only a release that began on this button fires it.
    // Phaser dispatches POINTER_UP to whatever is under the pointer, so a drag
    // that ends here (thumb stick, scroll) must not count as a tap.
    let armed = false;

    this.on(Phaser.Input.Events.POINTER_OVER, () =>
      this.scene.tweens.add({ targets: this, scale: 1.04, duration: 120, ease: 'Quad.easeOut' }),
    );
    this.on(Phaser.Input.Events.POINTER_OUT, () => {
      armed = false;
      this.paint(false);
      this.scene.tweens.add({ targets: this, scale: 1, duration: 120 });
    });
    this.on(Phaser.Input.Events.POINTER_DOWN, () => {
      armed = true;
      this.paint(true);
      this.setScale(0.97);
    });
    this.on(Phaser.Input.Events.POINTER_UP, () => {
      this.paint(false);
      this.setScale(1);
      if (!armed) return;
      armed = false;
      sfx('ui');
      onClick();
    });

    scene.add.existing(this);
  }

  setLabel(text: string): this {
    this.label.setText(text);
    return this;
  }

  /** Pressed state darkens the body and drops the gloss — one repaint per event. */
  private paint(pressed: boolean): void {
    paintPill(this.bg, this.boxWidth, this.boxHeight, {
      fill: pressed ? darken(this.fillColor, 0.72) : this.fillColor,
      stroke: this.strokeColor,
      strokeAlpha: pressed ? 0.5 : 0.9,
      strokeWidth: 4,
      gloss: !pressed,
    });
  }
}

/** Multiplies a packed 0xRRGGBB colour's channels — used for pressed states. */
function darken(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8) & 0xff) * factor);
  const b = Math.round((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}
