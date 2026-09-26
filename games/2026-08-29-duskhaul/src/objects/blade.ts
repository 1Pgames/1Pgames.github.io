import Phaser from 'phaser';
import { TEX } from '../core/keys';
import { safePlay } from '../core/anim';

/**
 * Hero weapon visuals (PRD-V2 §5.8). Hit resolution never lives here: every
 * weapon resolves damage through `WeaponHost` in `systems/weapons.ts`; these
 * objects are pure position + look, pooled and recycled by that system.
 *
 * Hero palette is cool only (§5.8): cyan, violet, bone, gloam green.
 */
export const HERO_FX = {
  cyan: 0x6fd6ff,
  violet: 0xad6eef,
  bone: 0xeae1bf,
  gloam: 0x9bdf9f,
} as const;

/** Ceiling for procedural hero fx and bone tints (bone #eae1bf at ≤ 0.8 never reads as white). */
const FX_PEAK_ALPHA = 0.8;

/**
 * One pooled weapon-fx sprite. `show` uses the §11 art id when its texture is
 * loaded (and plays its animation when the registry made one), else the
 * procedural fallback texture tinted with a hero colour — a pruned art group
 * degrades, never crashes or draws a missing-texture box.
 */
export class FxSprite extends Phaser.GameObjects.Sprite {
  /** True when the art texture (not the fallback) is showing. */
  usingArt = false;
  /** Full-strength alpha for the current look; fades and the near-hero dim scale from it. */
  peakAlpha = FX_PEAK_ALPHA;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, TEX.disc);
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
  }

  show(artKey: string | null, fallback: string, tint: number, x: number, y: number, w: number, h: number, depth: number): this {
    const scene = this.scene;
    this.usingArt = artKey !== null && scene.textures.exists(artKey);
    if (this.usingArt && artKey !== null) {
      this.setTexture(artKey, 0);
      this.clearTint();
      safePlay(this, artKey, true);
    } else {
      this.stop();
      this.setTexture(fallback);
      this.setTint(tint);
    }
    // NORMAL blend always: additive hero fx stacked over hit flashes read as a
    // white blob on the hero at high level (critic v2d M2). Procedural fallbacks
    // are capped at FX_PEAK_ALPHA so bone never approaches white.
    this.peakAlpha = this.usingArt ? 0.9 : FX_PEAK_ALPHA;
    this.setOrigin(0.5, 0.5).setPosition(x, y).setDisplaySize(w, h).setDepth(depth).setRotation(0).setAlpha(this.peakAlpha).setFlipX(false);
    this.setBlendMode(Phaser.BlendModes.NORMAL);
    this.setActive(true).setVisible(true);
    return this;
  }

  despawn(): void {
    this.stop();
    this.scene.tweens.killTweensOf(this);
    this.setActive(false).setVisible(false);
  }
}
