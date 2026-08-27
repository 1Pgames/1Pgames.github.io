import Phaser from 'phaser';
import { PALETTE } from '../config';
import { TEX } from './keys';

/**
 * Zero-asset art. Every shape the template needs is drawn once into a texture
 * at boot, so sprites/particles/physics bodies work without any image files.
 *
 * Add new shapes here rather than drawing Graphics every frame — a texture is
 * one draw call, a Graphics redraw is not.
 */
export function buildTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  // Soft-edged disc: player, pickups, bullets.
  const R = 64;
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillCircle(R, R, R);
  g.generateTexture(TEX.disc, R * 2, R * 2);

  // Ring: shields, telegraphs, radial UI.
  g.clear();
  g.lineStyle(10, 0xffffff, 1);
  g.strokeCircle(R, R, R - 6);
  g.generateTexture(TEX.ring, R * 2, R * 2);

  // Rounded square: blocks, platforms, cards.
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillRoundedRect(0, 0, 96, 96, 18);
  g.generateTexture(TEX.square, 96, 96);

  // Triangle spike: hazards read instantly as "do not touch".
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillTriangle(48, 0, 96, 84, 0, 84);
  g.generateTexture(TEX.spike, 96, 84);

  // Four-point star: score pickups, celebration bursts.
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillPoints(starPoints(48, 48, 46, 18, 5), true);
  g.generateTexture(TEX.star, 96, 96);

  // Small dot for particle emitters.
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillCircle(8, 8, 8);
  g.generateTexture(TEX.particle, 16, 16);

  // 9-slice-able panel for dialogs.
  g.clear();
  g.fillStyle(PALETTE.bgTop, 1);
  g.fillRoundedRect(0, 0, 128, 128, 28);
  g.lineStyle(4, PALETTE.primary, 0.55);
  g.strokeRoundedRect(2, 2, 124, 124, 26);
  g.generateTexture(TEX.panel, 128, 128);

  g.destroy();
}

function starPoints(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points: number,
): Phaser.Math.Vector2[] {
  const out: Phaser.Math.Vector2[] = [];
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + i * step;
    out.push(new Phaser.Math.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return out;
}

/**
 * Vertical gradient backdrop as a real texture (cheaper and smoother than a
 * stack of Graphics rectangles, and it survives camera zoom).
 */
export function buildGradient(
  scene: Phaser.Scene,
  key: string,
  top: number,
  bottom: number,
  width = 8,
  height = 256,
): void {
  if (scene.textures.exists(key)) return;
  const canvasTex = scene.textures.createCanvas(key, width, height);
  const ctx = canvasTex?.getContext();
  if (!canvasTex || !ctx) return;
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, `#${top.toString(16).padStart(6, '0')}`);
  grad.addColorStop(1, `#${bottom.toString(16).padStart(6, '0')}`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  canvasTex.refresh();
}

/**
 * Seamless ground tile for an infinite scrolling world, drawn once into a
 * texture and shown through a `TileSprite`. Everything is drawn twice at the
 * wrap offset so the tile edges match: a hairline seam is instantly visible
 * once the world scrolls.
 */
export function buildGroundTile(scene: Phaser.Scene, key: string, size = 256): void {
  if (scene.textures.exists(key)) return;
  const canvasTex = scene.textures.createCanvas(key, size, size);
  const ctx = canvasTex?.getContext();
  if (!canvasTex || !ctx) return;

  const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = hex(PALETTE.bgBottom);
  ctx.fillRect(0, 0, size, size);

  // Grid: lines on the tile boundary only, so tiling reproduces one lattice.
  ctx.strokeStyle = 'rgba(77, 225, 255, 0.07)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0.5, 0);
  ctx.lineTo(0.5, size);
  ctx.moveTo(0, 0.5);
  ctx.lineTo(size, 0.5);
  ctx.stroke();

  // A few static motes, kept clear of the edges so no dot is cut in half.
  ctx.fillStyle = 'rgba(143, 161, 199, 0.16)';
  const motes = [
    [46, 78, 3],
    [122, 30, 2],
    [196, 104, 2.5],
    [70, 168, 2],
    [168, 200, 3],
    [232, 156, 2],
  ] as const;
  for (const [x, y, r] of motes) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  canvasTex.refresh();
}
