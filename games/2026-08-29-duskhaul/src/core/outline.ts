/**
 * Baked sprite outlines (PRD-V2 §13.1).
 *
 * Phaser 4 has no Outline filter and a per-sprite Glow at 250 bodies is a
 * perf risk, so outlines are BAKED once at preload: for every actor sheet in
 * the outline set, per frame, the alpha mask is dilated by
 * `d = ceil(px × 256 / displayPx)` source px (a chamfer distance transform,
 * so a 7 px ring stays solid around thin limbs where 8 stamped copies gap),
 * filled with the outline colour, and the original frame is composited on
 * top. The result is a CanvasTexture with IDENTICAL frame geometry under
 * `outlineKey(key, px)`, plus an animation of the same rate/loop. Actors
 * play the outlined keys; the plain keys stay loaded for Codex portraits and
 * for the white hit-flash overlay (`core/juice.ts hitFlash`).
 *
 * The same pass measures each sheet's silhouette height (mean opaque bbox
 * height over its frames), so a sheet the registry has no metadata for still
 * sizes to its `visiblePx`.
 */
import type Phaser from 'phaser';
import { TUNING } from '../config';
import { playable } from './anim';
import { ANIM } from '../data/art';
import { ACTION_SUFFIXES, ENEMIES, actionScale, actorBaseKey, displaySizeFor, visiblePxOf } from '../data/enemies';

export type OutlinePx = 2 | 3 | 4 | 5;
/**
 * `displayPx` (additive to the §16.1 shape): the on-screen size of the sheet
 * CELL this key is drawn at, which turns screen px into source px. Absent =
 * 128 (d = 2 × px). `ringOnly` bakes the outline band alone (key suffix
 * `r`), for bodies whose fill fades while the outline must stay at 100%
 * (§5.4 Rime Stalker).
 */
export interface OutlineEntry { key: string; px: OutlinePx; color: number; glow?: number; displayPx?: number; ringOnly?: boolean; /** Outline band opacity 0..1 (default 1; §5.8b.1 thralls 0.7). */ alpha?: number }

/** §16.1 E17: `key + '-ol'` (3 px) / `'-ol4'` / `'-ol5'`. */
export function outlineKey(key: string, px: OutlinePx = 3): string {
  return px === 3 ? `${key}-ol` : `${key}-ol${px}`;
}

function bakedKey(entry: OutlineEntry): string {
  return entry.ringOnly === true ? `${outlineKey(entry.key, entry.px)}r` : outlineKey(entry.key, entry.px);
}

/** Inverse of `outlineKey`: the plain sheet an outlined key was baked from. */
export function baseKeyOf(key: string): string {
  const at = key.lastIndexOf('-ol');
  if (at < 0) return key;
  const tail = key.slice(at + 3);
  return /^[245]?r?$/.test(tail) ? key.slice(0, at) : key;
}

/** Glow band width (screen px) baked outside the outline when `glow` is set (§13.1 boss: 6 px). */
const GLOW_PX = 6;
/** Alpha at or above which a source pixel counts as silhouette. */
const SOLID_ALPHA = 24;
const DEFAULT_DISPLAY_PX = 128;

const measured: Record<string, number> = {};
const stats = { sheets: 0, frames: 0, ms: 0, lazy: 0 };

/** §5.8b.1 Husk Thrall sheets (Arsenal's `wpn-thralls-*`), their outline, and the fallback sheet when art is absent. */
const THRALL_KEYS = ['wpn-thralls-move', 'wpn-thralls-bite', 'wpn-thralls-evo-move', 'wpn-thralls-evo-bite'] as const;
export const THRALL_FALLBACK_KEY = 'enemy-husk-move';
/** Thrall silhouette height: body r 26 / `enemy.bodyRadiusRatio` 0.36 ≈ 72 px. */
export const THRALL_VISIBLE_PX = 72;
const THRALL_OUTLINE_ALPHA = 0.7;

/** §13.1 zone boss outer glow. */
const BOSS_GLOW = 0x3a0000;

/**
 * §13.1 `OUTLINE_SET`: hero anims (green 3 px), every trash sheet family
 * (red 3 px) and its elite variant (red 4 px, living anims only — corpses
 * reuse the 3 px death), mid-boss elite sheets (4 px) and the Warden skins
 * (5 px + `#3a0000` glow). Each entry carries the display size its key is
 * drawn at, so `d` is the spec's screen px. Only loaded textures enter; a
 * row's `fallbackTexture` family enters only when its own sheet is missing.
 */
export function actorOutlineSet(has: (key: string) => boolean): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const seen = new Set<string>();
  const push = (key: string, px: OutlinePx, color: number, displayPx: number, glow?: number): void => {
    const id = `${key}|${px}`;
    if (seen.has(id) || !has(key)) return;
    seen.add(id);
    out.push({ key, px, color, displayPx, glow });
  };
  const family = (loop: string, px: OutlinePx, color: number, visiblePx: number, living: boolean, glow?: number): void => {
    const size = displaySizeFor(loop, visiblePx);
    push(loop, px, color, size, glow);
    const base = actorBaseKey(loop);
    for (const suffix of ACTION_SUFFIXES) {
      if (living && suffix === 'death') continue;
      const key = `${base}-${suffix}`;
      push(key, px, color, size * actionScale(loop, key), glow);
    }
  };

  const heroSize = displaySizeFor(ANIM.heroIdle, TUNING.player.visiblePx);
  for (const key of [ANIM.heroIdle, ANIM.heroRun, ANIM.heroHurt, ANIM.heroChannel, ANIM.heroDeath, ANIM.heroExtract]) {
    push(key, TUNING.outline.heroPx as OutlinePx, TUNING.outline.heroColor, heroSize * actionScale(ANIM.heroIdle, key));
  }
  // §5.8b.1 Husk Thralls (hero allies): 2 px hero green at 0.7 alpha.
  const thrallSize = displaySizeFor(THRALL_FALLBACK_KEY, THRALL_VISIBLE_PX);
  for (const key of [...THRALL_KEYS, THRALL_FALLBACK_KEY]) {
    const id = `${key}|2`;
    if (seen.has(id) || !has(key)) continue;
    seen.add(id);
    out.push({ key, px: 2, color: TUNING.outline.heroColor, displayPx: thrallSize, alpha: THRALL_OUTLINE_ALPHA });
  }
  const red = TUNING.outline.enemyColor;
  for (const def of ENEMIES) {
    const loop = has(def.texture) || def.fallbackTexture === undefined ? def.texture : def.fallbackTexture;
    if (def.rank === 'trash') {
      family(loop, TUNING.outline.enemyPx as OutlinePx, red, def.visiblePx, false);
      family(loop, TUNING.outline.elitePx as OutlinePx, red, visiblePxOf(def, true), true);
    } else if (def.rank === 'midboss') {
      family(loop, TUNING.outline.elitePx as OutlinePx, red, def.visiblePx, false);
    } else {
      family(loop, TUNING.outline.bossPx as OutlinePx, red, def.visiblePx, false, BOSS_GLOW);
    }
  }
  return out;
}

/** Mean opaque-bbox height (source px) of a baked sheet's frames; undefined until baked. */
export function measuredSubjectHeight(key: string): number | undefined {
  return measured[key];
}

/** Bake census for the budget log and the debug overlay. */
export function outlineStats(): Readonly<typeof stats> {
  return stats;
}

let scratchDist = new Float32Array(0);

/**
 * §16.1 E17: bakes `<key>-ol*` textures + animations for every entry whose
 * base texture is loaded. Already-baked keys and missing textures are
 * skipped (never throws: a pruned art group degrades to the plain sheet).
 */
export function bakeOutlines(scene: Phaser.Scene, entries: readonly OutlineEntry[]): void {
  const t0 = performance.now();
  for (const entry of entries) bakeOne(scene, entry);
  stats.ms += performance.now() - t0;
}

/**
 * Lazy path for a key the preload set did not cover (a fallback sheet, an
 * elite of an archetype first promoted mid-run). Returns the outlined key, or
 * the plain key when the base texture does not exist.
 */
export function ensureOutline(scene: Phaser.Scene, entry: OutlineEntry): string {
  const olKey = bakedKey(entry);
  if (scene.textures.exists(olKey)) return olKey;
  if (!scene.textures.exists(entry.key)) return entry.key;
  const t0 = performance.now();
  bakeOne(scene, entry);
  stats.ms += performance.now() - t0;
  stats.lazy += 1;
  return scene.textures.exists(olKey) ? olKey : entry.key;
}

function bakeOne(scene: Phaser.Scene, entry: OutlineEntry): void {
  const olKey = bakedKey(entry);
  if (scene.textures.exists(olKey) || !scene.textures.exists(entry.key)) return;
  const texture = scene.textures.get(entry.key);
  const source = texture.getSourceImage() as CanvasImageSource & { width: number; height: number };
  const w = source.width;
  const h = source.height;
  if (w <= 0 || h <= 0) return;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return;
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, w, h);
  const src = new Uint8ClampedArray(image.data);
  const dst = image.data;

  const displayPx = entry.displayPx ?? DEFAULT_DISPLAY_PX;
  const frameNames = texture.getFrameNames();
  const cellPx = frameNames.length > 0 ? texture.get(frameNames[0]).cutHeight : h;
  const perSource = cellPx / displayPx;
  const d = Math.max(1, Math.ceil(entry.px * perSource));
  const dg = entry.glow === undefined ? 0 : Math.ceil(GLOW_PX * perSource);

  let heightSum = 0;
  let heightFrames = 0;
  const frames = frameNames.length > 0 ? frameNames : ['__BASE'];
  const ringOnly = entry.ringOnly === true;
  if (ringOnly) dst.fill(0);
  for (const name of frames) {
    const frame = texture.get(name);
    const fh = dilateFrame(src, dst, w, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, d, dg, entry.color, entry.glow ?? 0, ringOnly, entry.alpha ?? 1);
    if (fh > 0) {
      heightSum += fh;
      heightFrames += 1;
    }
  }
  if (heightFrames > 0) measured[entry.key] = heightSum / heightFrames;
  ctx.putImageData(image, 0, 0);

  const baked = scene.textures.addCanvas(olKey, canvas);
  if (baked === null) return;
  for (const name of frameNames) {
    const frame = texture.get(name);
    baked.add(name, 0, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight);
  }
  stats.sheets += 1;
  stats.frames += frames.length;

  const anim = scene.anims.get(entry.key);
  if (anim !== undefined && anim !== null && playable(scene.anims, entry.key) && !scene.anims.exists(olKey)) {
    scene.anims.create({
      key: olKey,
      frames: anim.frames.map((f) => ({ key: olKey, frame: f.textureFrame })),
      frameRate: anim.frameRate,
      repeat: anim.repeat,
    });
  }
}

/**
 * Dilates one frame rect in place (reads `src`, writes `dst`). Returns the
 * frame's opaque bbox height (0 when the frame is empty).
 */
function dilateFrame(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  stride: number,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
  d: number,
  dg: number,
  color: number,
  glow: number,
  ringOnly: boolean,
  bandAlpha: number,
): number {
  let minX = fx + fw;
  let minY = fy + fh;
  let maxX = -1;
  let maxY = -1;
  for (let y = fy; y < fy + fh; y += 1) {
    let i = (y * stride + fx) * 4 + 3;
    for (let x = fx; x < fx + fw; x += 1, i += 4) {
      if (src[i]! < SOLID_ALPHA) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return 0;

  const reach = d + dg + 1;
  const x0 = Math.max(fx, minX - reach);
  const y0 = Math.max(fy, minY - reach);
  const x1 = Math.min(fx + fw - 1, maxX + reach);
  const y1 = Math.min(fy + fh - 1, maxY + reach);
  const rw = x1 - x0 + 1;
  const rh = y1 - y0 + 1;
  if (scratchDist.length < rw * rh) scratchDist = new Float32Array(rw * rh);
  const dist = scratchDist;
  const INF = 1e6;
  for (let y = 0; y < rh; y += 1) {
    let i = ((y0 + y) * stride + x0) * 4 + 3;
    for (let x = 0; x < rw; x += 1, i += 4) dist[y * rw + x] = src[i]! >= SOLID_ALPHA ? 0 : INF;
  }
  // Chamfer (1, √2) two-pass distance transform.
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let y = 0; y < rh; y += 1) {
    for (let x = 0; x < rw; x += 1) {
      const k = y * rw + x;
      let v = dist[k]!;
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, dist[k - 1]! + D1);
      if (y > 0) {
        v = Math.min(v, dist[k - rw]! + D1);
        if (x > 0) v = Math.min(v, dist[k - rw - 1]! + D2);
        if (x < rw - 1) v = Math.min(v, dist[k - rw + 1]! + D2);
      }
      dist[k] = v;
    }
  }
  for (let y = rh - 1; y >= 0; y -= 1) {
    for (let x = rw - 1; x >= 0; x -= 1) {
      const k = y * rw + x;
      let v = dist[k]!;
      if (v === 0) continue;
      if (x < rw - 1) v = Math.min(v, dist[k + 1]! + D1);
      if (y < rh - 1) {
        v = Math.min(v, dist[k + rw]! + D1);
        if (x < rw - 1) v = Math.min(v, dist[k + rw + 1]! + D2);
        if (x > 0) v = Math.min(v, dist[k + rw - 1]! + D2);
      }
      dist[k] = v;
    }
  }

  const or = (color >> 16) & 0xff;
  const og = (color >> 8) & 0xff;
  const ob = color & 0xff;
  const gr = (glow >> 16) & 0xff;
  const gg = (glow >> 8) & 0xff;
  const gb = glow & 0xff;
  for (let y = 0; y < rh; y += 1) {
    let i = ((y0 + y) * stride + x0) * 4;
    for (let x = 0; x < rw; x += 1, i += 4) {
      const dd = dist[y * rw + x]!;
      let baseA = 0;
      let br = or;
      let bg = og;
      let bb = ob;
      if (dd <= d) baseA = bandAlpha;
      else if (dd < d + 1) baseA = (d + 1 - dd) * bandAlpha;
      if (dg > 0 && dd > d && dd <= d + dg) {
        const glowA = 0.85 * (1 - (dd - d) / dg);
        if (glowA > baseA) {
          // Blend the fading outline edge into the glow band.
          br = gr;
          bg = gg;
          bb = gb;
          baseA = glowA;
        }
      }
      if (baseA <= 0) continue;
      const a = src[i + 3]! / 255;
      if (ringOnly) {
        dst[i] = br;
        dst[i + 1] = bg;
        dst[i + 2] = bb;
        dst[i + 3] = baseA * (1 - a) * 255;
        continue;
      }
      const outA = a + baseA * (1 - a);
      const wBase = (baseA * (1 - a)) / outA;
      const wSrc = a / outA;
      dst[i] = src[i]! * wSrc + br * wBase;
      dst[i + 1] = src[i + 1]! * wSrc + bg * wBase;
      dst[i + 2] = src[i + 2]! * wSrc + bb * wBase;
      dst[i + 3] = outA * 255;
    }
  }
  return maxY - minY + 1;
}

/** Procedural actor-FX textures (always generated; art ids take precedence where they exist). */
export const ACTOR_FX = {
  /** Enemy projectile: hot `#ff7a3d` core + `#ffd27a` glint inside a 3 px `#ff2d2d` rim (32 px cell). Critic F15: the §13.1 pale `#ffb3a0` core read as the hero's bone VFX. */
  enemyShot: 'enemy-shot-ol',
  /** Soft ground ellipse used when `fx-shadow` art is not loaded. */
  shadowFallback: 'actor-shadow-fallback',
  /** Elite glow pulse ring (§13.1, `#7a0000` 3 px) — white, tinted in code. */
  eliteRing: 'elite-glow-ring',
} as const;

/** Generates the `ACTOR_FX` textures once per game (idempotent). */
export function ensureActorFxTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(ACTOR_FX.enemyShot)) {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const g = c.getContext('2d');
    if (g !== null) {
      g.fillStyle = '#ff2d2d';
      g.beginPath();
      g.arc(16, 16, 14, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ff7a3d';
      g.beginPath();
      g.arc(16, 16, 11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffd27a';
      g.beginPath();
      g.arc(14, 14, 4, 0, Math.PI * 2);
      g.fill();
      scene.textures.addCanvas(ACTOR_FX.enemyShot, c);
    }
  }
  if (!scene.textures.exists(ACTOR_FX.shadowFallback)) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const g = c.getContext('2d');
    if (g !== null) {
      const grad = g.createRadialGradient(64, 32, 4, 64, 32, 62);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.55, 'rgba(0,0,0,0.7)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.setTransform(1, 0, 0, 0.5, 0, 16);
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      scene.textures.addCanvas(ACTOR_FX.shadowFallback, c);
    }
  }
  if (!scene.textures.exists(ACTOR_FX.eliteRing)) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    if (g !== null) {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 6;
      g.beginPath();
      g.arc(64, 64, 58, 0, Math.PI * 2);
      g.stroke();
      scene.textures.addCanvas(ACTOR_FX.eliteRing, c);
    }
  }
}

/** Shadow texture: the §11 `fx-shadow` art when loaded, else the procedural ellipse. */
export function shadowTexture(scene: Phaser.Scene): string {
  return scene.textures.exists('fx-shadow') ? 'fx-shadow' : ACTOR_FX.shadowFallback;
}
