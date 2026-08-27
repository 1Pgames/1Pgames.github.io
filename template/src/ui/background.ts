import Phaser from 'phaser';
import { VIEW } from '../config';
import { starfield } from '../core/juice';
import { TEXTURE } from '../data/art';

/**
 * Standard backdrop: the generated arena art (`bg-arena`) stretched to the
 * frame, plus drifting motes for parallax. One call per scene keeps Menu /
 * Game / GameOver visually continuous, which is what makes a 30-second video
 * look like one product instead of three screens.
 *
 * The art is deliberately dark and low-contrast so saturated sprites read
 * against it; do not swap in a busy background without re-checking readability.
 */
export function addBackground(scene: Phaser.Scene, withStars = true): void {
  scene.add
    .image(VIEW.centerX, VIEW.centerY, TEXTURE.backdrop)
    .setDisplaySize(VIEW.width, VIEW.height)
    .setDepth(-200);
  if (withStars) starfield(scene);
}
