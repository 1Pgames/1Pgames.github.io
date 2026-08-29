import Phaser from 'phaser';
import { PALETTE } from '../config';

/**
 * UI chrome drawn with primitives (Graphics), not stretched art. Panels,
 * buttons and bar housings are geometry: they must adapt to any size, follow the
 * palette when a game is re-skinned, and stay crisp at every scale — all of
 * which a nine-sliced PNG fights.
 *
 * Generated art is still used for content that is *drawing* rather than
 * geometry: icons, the title emblem, the backdrop, and every entity.
 *
 * Cost note: each helper draws once and produces a static `Graphics` object.
 * Never call these from `update` — that is the one way to make them expensive.
 */

export interface ChromeStyle {
  /** Body fill. */
  fill?: number;
  fillAlpha?: number;
  /** Border colour; defaults to a brightened `fill`. */
  stroke?: number;
  strokeAlpha?: number;
  strokeWidth?: number;
  /** Corner radius; a value >= height/2 gives a pill. */
  radius?: number;
  /** Adds a soft top-edge highlight, which reads as a glossy surface. */
  gloss?: boolean;
}

/** Rounded panel/card: dialogs, list rows, HUD plates. */
export function drawPanel(
  scene: Phaser.Scene,
  width: number,
  height: number,
  style: ChromeStyle = {},
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  paintPanel(g, width, height, style);
  return g;
}

/** Repaints an existing Graphics — use for state changes, never per frame. */
export function paintPanel(
  g: Phaser.GameObjects.Graphics,
  width: number,
  height: number,
  style: ChromeStyle = {},
): void {
  const fill = style.fill ?? PALETTE.bgTop;
  const stroke = style.stroke ?? PALETTE.primary;
  const strokeWidth = style.strokeWidth ?? 3;
  const radius = Math.min(style.radius ?? 28, height / 2);
  const x = -width / 2;
  const y = -height / 2;

  g.clear();
  g.fillStyle(fill, style.fillAlpha ?? 1);
  g.fillRoundedRect(x, y, width, height, radius);

  if (style.gloss === true) {
    // One highlight band along the top third: the cheapest way to read "glossy"
    // without a gradient texture.
    const inset = strokeWidth + 2;
    const glossHeight = Math.max(6, height * 0.34);
    g.fillStyle(0xffffff, 0.12);
    g.fillRoundedRect(
      x + inset,
      y + inset,
      width - inset * 2,
      glossHeight,
      Math.min(radius, glossHeight / 2),
    );
  }

  if (strokeWidth > 0) {
    g.lineStyle(strokeWidth, stroke, style.strokeAlpha ?? 0.85);
    g.strokeRoundedRect(
      x + strokeWidth / 2,
      y + strokeWidth / 2,
      width - strokeWidth,
      height - strokeWidth,
      radius,
    );
  }
}

/** Fully rounded capsule: buttons, bar housings, tags. */
export function drawPill(
  scene: Phaser.Scene,
  width: number,
  height: number,
  style: ChromeStyle = {},
): Phaser.GameObjects.Graphics {
  return drawPanel(scene, width, height, { ...style, radius: height / 2 });
}

export function paintPill(
  g: Phaser.GameObjects.Graphics,
  width: number,
  height: number,
  style: ChromeStyle = {},
): void {
  paintPanel(g, width, height, { ...style, radius: height / 2 });
}
