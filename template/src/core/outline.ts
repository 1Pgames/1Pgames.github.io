import type Phaser from 'phaser';

/**
 * Baked team outlines — the READABILITY default for any horde genre (arena,
 * survivor, extraction, tower defense): hostiles red, hero/allies green, px by
 * rank, so a 40-enemy swarm reads against any floor. Ported from Duskhaul.
 *
 * Phaser 4 has no Outline filter and a per-sprite Glow at 250 bodies is a perf
 * risk, so outlines are BAKED once: for every sheet in the set, per frame, the
 * alpha mask is dilated by `d = ceil(px × cellPx / displayPx)` source px (a
 * chamfer distance transform, so the ring stays solid around thin limbs where
 * 8 stamped copies gap), filled with the outline colour, and the original
 * frame is composited on top. The result is a CanvasTexture with IDENTICAL
 * frame geometry under `outlineKey(key, px)`, plus an animation of the same
 * rate/loop when the base key has one. Actors play the outlined keys; the
 * plain keys stay loaded for portraits and hit-flash overlays.
 *
 * Opt in (dormant until a slice does):
 *   1. declare the set once, e.g. in the GameScene constructor:
 *      `declareOutlines((has) => [teamOutline('hero-idle', 'ally', 'trash', 128), ...])`
 *      — `PreloadScene` bakes every declared set after textures load;
 *   2. play `outlineKey(key, px)` instead of `key` (or call
 *      `ensureOutline(scene, entry)` for a sheet first needed mid-run).
 * One colour per key+px: the baked key does not encode the colour.
 */

export type OutlinePx = 2 | 3 | 4 | 5;
export type OutlineTeam = 'hostile' | 'ally';
export type OutlineRank = 'trash' | 'elite' | 'boss';

/** Team colours (red/green hues are RESERVED for outlines — keep them out of floors and props) and px per rank. */
export const OUTLINE = {
  color: { hostile: 0xff2d2d, ally: 0x39ff6a },
  px: { trash: 3, elite: 4, boss: 5 },
  /** Outer glow baked around hostile bosses. */
  bossGlow: 0x3a0000,
} as const satisfies {
  color: Record<OutlineTeam, number>;
  px: Record<OutlineRank, OutlinePx>;
  bossGlow: number;
};

export interface OutlineEntry {
  key: string;
  px: OutlinePx;
  color: number;
  /** Glow colour baked `GLOW_PX` screen px outside the outline. */
  glow?: number;
  /** On-screen size of the sheet CELL this key is drawn at (turns screen px into source px). Default 128. */
  displayPx?: number;
  /** Bake the outline band alone (key suffix `r`), for bodies whose fill fades while the ring must stay. */
  ringOnly?: boolean;
  /** Outline band opacity 0..1 (default 1; e.g. 0.7 for summoned allies). */
  alpha?: number;
}

/** The standard entry for a team + rank (hostile bosses get the dark glow). */
export function teamOutline(key: string, team: OutlineTeam, rank: OutlineRank = 'trash', displayPx?: number): OutlineEntry {
  return {
    key,
    px: OUTLINE.px[rank],
    color: OUTLINE.color[team],
    displayPx,
    glow: team === 'hostile' && rank === 'boss' ? OUTLINE.bossGlow : undefined,
  };
}

/** `key + '-ol'` (3 px) / `'-ol2'` / `'-ol4'` / `'-ol5'`. */
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
  return /^[245]?r?$/.test(key.slice(at + 3)) ? key.slice(0, at) : key;
}

/** Glow band width in screen px. */
const GLOW_PX = 6;
/** Alpha at or above which a source pixel counts as silhouette. */
const SOLID_ALPHA = 24;
const DEFAULT_DISPLAY_PX = 128;

const measured: Record<string, number> = {};
const stats = { sheets: 0, frames: 0, ms: 0, lazy: 0 };
const declared: Array<(has: (key: string) => boolean) => readonly OutlineEntry[]> = [];

/**
 * Registers an outline set for `PreloadScene` to bake once textures load.
 * `has` tells the set which keys are loaded, so a pruned art group simply
 * contributes nothing.
 */
export function declareOutlines(set: (has: (key: string) => boolean) => readonly OutlineEntry[]): void {
  declared.push(set);
}

/** Bakes every declared set (called once by `PreloadScene.create`; a no-op until a slice declares one). */
export function bakeDeclaredOutlines(scene: Phaser.Scene): void {
  const has = (key: string): boolean => scene.textures.exists(key);
  for (const set of declared) bakeOutlines(scene, set(has));
}

/** Mean opaque-bbox height (source px) of a baked sheet's frames — sizes a sheet to its visible height; undefined until baked. */
export function measuredSubjectHeight(key: string): number | undefined {
  return measured[key];
}

/** Bake census for budget logs and debug overlays. */
export function outlineStats(): Readonly<typeof stats> {
  return stats;
}

/**
 * Bakes `<key>-ol*` textures + animations for every entry whose base texture
 * is loaded. Already-baked keys and missing textures are skipped (never
 * throws: a pruned art group degrades to the plain sheet).
 */
export function bakeOutlines(scene: Phaser.Scene, entries: readonly OutlineEntry[]): void {
  const t0 = performance.now();
  for (const entry of entries) bakeOne(scene, entry);
  stats.ms += performance.now() - t0;
}

/**
 * Lazy path for a sheet the declared set did not cover (an elite first
 * promoted mid-run). Returns the outlined key, or the plain key when the base
 * texture does not exist.
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

let scratchDist = new Float32Array(0);

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

  const frameNames = texture.getFrameNames();
  const cellPx = frameNames.length > 0 ? texture.get(frameNames[0]).cutHeight : h;
  const perSource = cellPx / (entry.displayPx ?? DEFAULT_DISPLAY_PX);
  const d = Math.max(1, Math.ceil(entry.px * perSource));
  const dg = entry.glow === undefined ? 0 : Math.ceil(GLOW_PX * perSource);
  const ringOnly = entry.ringOnly === true;
  if (ringOnly) dst.fill(0);

  let heightSum = 0;
  let heightFrames = 0;
  const frames = frameNames.length > 0 ? frameNames : ['__BASE'];
  for (const name of frames) {
    const frame = texture.get(name);
    const fh = dilateFrame(src, dst, w, frame, d, dg, entry.color, entry.glow ?? 0, ringOnly, entry.alpha ?? 1);
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
  if (anim !== undefined && anim !== null && !scene.anims.exists(olKey)) {
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
  frame: { cutX: number; cutY: number; cutWidth: number; cutHeight: number },
  d: number,
  dg: number,
  color: number,
  glow: number,
  ringOnly: boolean,
  bandAlpha: number,
): number {
  const fx = frame.cutX;
  const fy = frame.cutY;
  const fw = frame.cutWidth;
  const fh = frame.cutHeight;
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
