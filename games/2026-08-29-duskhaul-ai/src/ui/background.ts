import Phaser from 'phaser';
import { PALETTE, TUNING, VIEW } from '../config';
import { starfield } from '../core/juice';
import { buildGradient } from '../core/textures';
import { TEXTURE } from '../data/art';

/** Registry keys for up to three parallax layers, back to front. */
const LAYER_KEYS = ['bg-layer-0', 'bg-layer-1', 'bg-layer-2'] as const;
/** Back-to-front scroll speed: the frontmost layer drifts fastest. */
const LAYER_SCROLL_FACTORS = [0, 0.05, 0.12] as const;

const GRADIENT_KEY = 'bg-gradient';

/**
 * Backdrop for the SHELL scenes (Menu / Stash / Results) — the only callers.
 * The arena has no single backdrop: `systems/zone.ts` hands `Arena` a per-zone
 * `ArenaLayout` whose `floorKey` is the zone's own generated floor tile, so the
 * run's ground is zone art, not one image.
 *
 * Priority order: registered parallax layers (`bg-layer-0/1/2`), else the
 * full-bleed generated `bg-menu` portrait image, else a procedural gradient —
 * so a scene always has a background even before an art run finishes. Drifting
 * motes are layered on top for parallax. One call per shell scene keeps Menu /
 * Stash / Results visually continuous, which is what makes a 30-second video
 * look like one product instead of three screens.
 *
 * Every layer is uniform-cover-fit (`scale = max(view/w, view/h)`, centred,
 * overflow cropped) — never non-uniformly stretched, which visibly distorts
 * a portrait sheet. Generated art is deliberately dark and low-contrast so
 * saturated sprites read against it; do not swap in a busy background
 * without re-checking readability.
 */
export function addBackground(scene: Phaser.Scene, withStars = true): void {
  const layers = LAYER_KEYS.filter((key) => scene.textures.exists(key));

  if (layers.length > 0) {
    // Overscan covers the full range a following camera can pan through the
    // bounded arena (see `TUNING.arena`), so a parallaxing layer never
    // reveals its edge.
    const rangeX = Math.max(0, TUNING.arena.width - VIEW.width);
    const rangeY = Math.max(0, TUNING.arena.height - VIEW.height);
    layers.forEach((key, i) => {
      const factor = LAYER_SCROLL_FACTORS[Math.min(i, LAYER_SCROLL_FACTORS.length - 1)] ?? 0;
      coverFit(scene, key, VIEW.width + rangeX * factor, VIEW.height + rangeY * factor)
        .setScrollFactor(factor)
        .setDepth(-200 + i);
    });
  } else if (scene.textures.exists(TEXTURE.bgMenu)) {
    coverFit(scene, TEXTURE.bgMenu, VIEW.width, VIEW.height).setDepth(-200);
    addScrim(scene);
  } else {
    if (!scene.textures.exists(GRADIENT_KEY)) {
      buildGradient(scene, GRADIENT_KEY, PALETTE.bgTop, PALETTE.bgBottom, 8, VIEW.height);
    }
    scene.add
      .image(VIEW.centerX, VIEW.centerY, GRADIENT_KEY)
      .setDisplaySize(VIEW.width, VIEW.height)
      .setDepth(-200);
  }

  if (withStars) starfield(scene);
}

/**
 * Readability veil over the generated backdrop: generated art is far brighter
 * and busier than the procedural gradient the UI was designed against, so text
 * drawn straight onto the scene needs a guaranteed dark surface. One full-frame
 * veil plus heavier top/bottom bands (where HUD, menu copy and results stats
 * live) keeps the art visible mid-frame while restoring >= 4.5:1 contrast for
 * ink text. Depth -190 sits above the backdrop (-200) and below starfield
 * motes and all gameplay.
 */
function addScrim(scene: Phaser.Scene): void {
  const veil = (y: number, h: number, alpha: number) =>
    scene.add.rectangle(VIEW.centerX, y, VIEW.width, h, PALETTE.bgDeep, alpha).setDepth(-190);
  veil(VIEW.centerY, VIEW.height, 0.45);
  veil(150, 300, 0.3);
  veil(VIEW.height - 190, 380, 0.3);
}

/**
 * Places `key` centred at the view, scaled so it covers a `w`x`h` area with
 * no stretch: `scale = max(w/sourceWidth, h/sourceHeight)`, so overflow is
 * cropped symmetrically instead of squashing the aspect ratio.
 */
function coverFit(scene: Phaser.Scene, key: string, w: number, h: number): Phaser.GameObjects.Image {
  const image = scene.add.image(VIEW.centerX, VIEW.centerY, key);
  return image.setScale(Math.max(w / image.width, h / image.height));
}
