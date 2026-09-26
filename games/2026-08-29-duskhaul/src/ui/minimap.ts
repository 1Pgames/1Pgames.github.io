import Phaser from 'phaser';
import { CSS, PALETTE, TEXT, TUNING, VIEW, bareText } from '../config';
import { sfx } from '../core/audio';
import type { EventKind, GeneratedMap, MinimapModel, PoiKind } from '../data/types-v2';
import { HUD_DEPTH, IDENTITY, PANEL } from './duskChrome';
import { iconSlot } from './itemIcon';

/**
 * PRD-V2 §14.10 minimap: 160×160 rounded square at (520, 152), `#03040b` @0.7,
 * 2 px `inkSoft` stroke. The corner window is a LOCAL view, 160 px per
 * `VIEW_WORLD` 6,144 world px (1:38.4), HERO-CENTRED:
 * the terrain scrolls under a fixed hero arrow, whatever the map size (24,576²
 * since the 16× map). Terrain is baked ONCE from `GeneratedMap.nav.blocked`
 * (+ `floor.road`) into a canvas texture at ~32 world px per texel (2 texels
 * per 64 px nav cell); fog of war is a `Uint8Array` of 64 px cells revealed by
 * a `revealPx` disc and written into the same canvas only for newly revealed
 * cells (no per-frame redraw).
 *
 * The window is clipped by `setCrop` on the one terrain image (a true texture
 * crop — no mask, no second camera). Icons are 12 px `mm-*` glyphs; one outside
 * the window or under fog is not drawn (gates and the boss ignore fog).
 *
 * Tap → full-map PEEK 640×640 centred (the WHOLE map, same texture): dims the field 50%, does NOT pause,
 * closes after `minimap.peekMs` (1,500 ms) or on tap / ESC / `closePeek()`.
 */

const WIN = { x: 520, y: 152, size: 160, radius: 14 } as const;
/** World px per terrain texel (2 texels per 64 px nav cell); texture clamped to 384-1024 px. */
const TEXEL_WORLD = 32;
/** World px spanned by the corner window (§14.10 1:38.4 kept after the 16× map). */
const VIEW_WORLD = 6144;
const TEX_MIN = 384;
const TEX_MAX = 1024;
/** World px per fog cell. */
const FOG_CELL_WORLD = 64;
const ICON_PX = 12;
const PEEK = { size: 640, icon: 26, depth: HUD_DEPTH.channelBar + 30 } as const;

const TERRAIN = {
  blocked: 0x2c3848,
  walkable: 0x141b2e,
  road: 0x3a4458,
  /** §14.10: unrevealed = 0.85 black over the terrain. */
  fogKeep: 0.15,
} as const;

const GATE_TONE: Record<MinimapModel['gates'][number]['state'], number> = {
  closed: IDENTITY.cooled,
  open: IDENTITY.gateOpen,
  closing: IDENTITY.hazardAmber,
  spent: IDENTITY.threat,
};

function poiIcon(kind: PoiKind | EventKind): string {
  if (kind.startsWith('chest')) return 'mm-chest';
  if (kind.startsWith('shrine')) return 'mm-shrine';
  if (kind.startsWith('ev_') || kind === 'event_yard' || kind === 'bell') return 'mm-event';
  return `mm-${kind}`;
}

function poiTone(kind: PoiKind | EventKind): number {
  if (kind.startsWith('ev_') || kind === 'event_yard' || kind === 'bell') return IDENTITY.gateOpen;
  if (kind === 'lair' || kind === 'den') return IDENTITY.threat;
  if (kind.startsWith('chest') || kind === 'vault' || kind === 'vein') return IDENTITY.gilt;
  return PALETTE.ink;
}

let textureSerial = 0;

/** Strokes only the segments of a circle inside a rect — a Graphics stroke is not cropped. */
function strokeClippedCircle(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): void {
  const steps = 96;
  const inside = (x: number, y: number): boolean => x >= left && x <= right && y >= top && y <= bottom;
  for (let i = 0; i < steps; i += 1) {
    const a0 = (i / steps) * Math.PI * 2;
    const a1 = ((i + 1) / steps) * Math.PI * 2;
    const x0 = cx + Math.cos(a0) * r;
    const y0 = cy + Math.sin(a0) * r;
    const x1 = cx + Math.cos(a1) * r;
    const y1 = cy + Math.sin(a1) * r;
    if (inside(x0, y0) && inside(x1, y1)) g.lineBetween(x0, y0, x1, y1);
  }
}

interface Glyph {
  img: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Graphics | null;
  pulse: Phaser.Tweens.Tween | null;
  seen: boolean;
}

export class Minimap {
  private readonly key: string;
  private readonly canvas: Phaser.Textures.CanvasTexture;
  private readonly lit: ImageData;
  private readonly texSize: number;
  private readonly fogCells: number;
  private readonly fog: Uint8Array;
  private readonly fogCell: number;
  /** Texels from the hero to the window edge (half the window, in texture px). */
  private readonly viewHalfTex: number;
  private readonly root: Phaser.GameObjects.Container;
  private readonly terrain: Phaser.GameObjects.Image;
  private readonly heroArrow: Phaser.GameObjects.Graphics;
  private readonly collapse: Phaser.GameObjects.Graphics;
  private readonly glyphs = new Map<string, Glyph>();
  private readonly worldToWin: number;
  private peekCb: (() => void) | null = null;
  private peek: { root: Phaser.GameObjects.Container; timer: Phaser.Time.TimerEvent; hero: Phaser.GameObjects.Graphics } | null = null;
  private lastRevealX = Number.NaN;
  private lastRevealY = Number.NaN;
  private lastCollapseKey = '';
  private model: MinimapModel | null = null;
  private destroyed = false;
  private readonly onEsc = (): void => this.closePeek();

  /** §16.1 E40. `revealPx` = `loadout.minimapRevealPx` (default `minimap.revealPx`). */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: GeneratedMap,
    private readonly revealPx: number = TUNING.minimap.revealPx,
  ) {
    this.texSize = Phaser.Math.Clamp(Math.round(map.width / TEXEL_WORLD), TEX_MIN, TEX_MAX);
    this.fogCells = Math.max(1, Math.round(map.width / FOG_CELL_WORLD));
    this.fog = new Uint8Array(this.fogCells * this.fogCells);
    this.fogCell = map.width / this.fogCells;
    this.worldToWin = WIN.size / VIEW_WORLD;
    this.viewHalfTex = (WIN.size / this.worldToWin / 2) * (this.texSize / map.width);
    textureSerial += 1;
    this.key = `minimap-terrain-${textureSerial}`;
    const tex = scene.textures.createCanvas(this.key, this.texSize, this.texSize);
    if (tex === null) throw new Error('Minimap: canvas texture creation failed');
    this.canvas = tex;
    this.lit = this.bakeTerrain();
    this.canvas.context.putImageData(this.fogged(this.lit), 0, 0);
    this.canvas.refresh();

    const frame = scene.add.graphics();
    frame.fillStyle(0x03040b, 0.7).fillRoundedRect(0, 0, WIN.size, WIN.size, WIN.radius);
    this.terrain = scene.add.image(0, 0, this.key).setOrigin(0, 0).setScale(WIN.size / (this.viewHalfTex * 2));
    this.collapse = scene.add.graphics();
    this.heroArrow = scene.add.graphics({ x: WIN.size / 2, y: WIN.size / 2 });
    this.heroArrow.fillStyle(0x39ff6a, 1).lineStyle(2, 0x03040b, 1);
    this.heroArrow.beginPath().moveTo(8, 0).lineTo(-6, -6).lineTo(-3, 0).lineTo(-6, 6).closePath();
    this.heroArrow.fillPath().strokePath();
    const stroke = scene.add.graphics();
    stroke.lineStyle(2, PALETTE.inkSoft, 1).strokeRoundedRect(1, 1, WIN.size - 2, WIN.size - 2, WIN.radius);

    this.root = scene.add
      .container(WIN.x, WIN.y, [frame, this.terrain, this.collapse, this.heroArrow, stroke])
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH.minimap);
    this.root.setSize(WIN.size, WIN.size).setInteractive({ useHandCursor: true });
    // A Container hit-tests in origin-centred space (local + size/2); this one is
    // top-left anchored, so the rect shifts by half its size to cover 520-680.
    const area = this.root.input?.hitArea as Phaser.Geom.Rectangle | undefined;
    area?.setPosition(WIN.size / 2, WIN.size / 2);
    let armed = false;
    this.root.on(Phaser.Input.Events.POINTER_DOWN, () => {
      armed = true;
      stroke.setAlpha(0.5);
    });
    this.root.on(Phaser.Input.Events.POINTER_OUT, () => {
      armed = false;
      stroke.setAlpha(1);
    });
    this.root.on(Phaser.Input.Events.POINTER_UP, () => {
      stroke.setAlpha(1);
      if (!armed) return;
      armed = false;
      this.openPeek();
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** §16.1 E40 — every frame. */
  set(m: MinimapModel): void {
    if (this.destroyed) return;
    this.model = m;
    const { hero } = m;
    if (!(Math.abs(hero.x - this.lastRevealX) < this.fogCell && Math.abs(hero.y - this.lastRevealY) < this.fogCell)) {
      this.lastRevealX = hero.x;
      this.lastRevealY = hero.y;
      this.reveal(hero.x, hero.y);
    }

    // Terrain crop: the window shows 2·viewHalfTex texels centred on the hero.
    const tex = this.texSize;
    const half = this.viewHalfTex;
    const k = tex / this.map.width;
    const hx = hero.x * k;
    const hy = hero.y * k;
    const x0 = Phaser.Math.Clamp(hx - half, 0, tex);
    const y0 = Phaser.Math.Clamp(hy - half, 0, tex);
    const x1 = Phaser.Math.Clamp(hx + half, 0, tex);
    const y1 = Phaser.Math.Clamp(hy + half, 0, tex);
    const s = WIN.size / (half * 2);
    this.terrain.setPosition(WIN.size / 2 - hx * s, WIN.size / 2 - hy * s);
    this.terrain.setCrop(x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
    this.heroArrow.setRotation(hero.angle);

    for (const g of this.glyphs.values()) g.seen = false;
    for (const gate of m.gates) {
      this.place(`g:${gate.id}`, gate.id === 'x' ? 'mm-gate-cond' : 'mm-gate', GATE_TONE[gate.state], gate.x, gate.y, true, 1, GATE_TONE[gate.state], false);
    }
    for (const poi of m.pois) {
      const ev = poi.kind.startsWith('ev_') || poi.kind === 'event_yard';
      this.place(`p:${poi.id}`, poiIcon(poi.kind), poiTone(poi.kind), poi.x, poi.y, false, poi.done ? 0.4 : 1, null, ev && !poi.done);
    }
    if (m.boss !== null) this.place('boss', 'mm-boss', IDENTITY.threat, m.boss.x, m.boss.y, true, 1, null, false);
    for (const [id, g] of this.glyphs) {
      if (g.seen) continue;
      this.dropGlyph(id, g);
    }
    this.drawCollapse(m);
    this.peek?.hero.setPosition(this.peekX(hero.x), this.peekY(hero.y)).setRotation(hero.angle);
  }

  /** §16.1 E40: fired when the full-map peek opens (coach `map` beat, telemetry). */
  onPeek(cb: () => void): void {
    this.peekCb = cb;
  }

  get peeking(): boolean {
    return this.peek !== null;
  }

  /** Closes the peek (the slice calls this before opening pause — §14b interruption row). */
  closePeek(): void {
    const peek = this.peek;
    if (peek === null) return;
    this.peek = null;
    peek.timer.remove(false);
    this.scene.input.keyboard?.off('keydown-ESC', this.onEsc);
    peek.root.destroy(true);
  }

  /** Live loop tweens (event pulses) — tween-leak probe. */
  get liveLoops(): number {
    let n = 0;
    for (const g of this.glyphs.values()) if (g.pulse !== null) n += 1;
    return n;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.closePeek();
    for (const [id, g] of this.glyphs) this.dropGlyph(id, g);
    this.root.destroy(true);
    if (this.scene.textures.exists(this.key)) this.scene.textures.remove(this.key);
  }

  // ───────────────────────────── terrain + fog ──────────────────────────────

  private bakeTerrain(): ImageData {
    const { nav, floor, width, height } = this.map;
    const data = this.canvas.context.createImageData(this.texSize, this.texSize);
    const px = data.data;
    const rgb = (c: number, i: number): void => {
      px[i] = (c >> 16) & 255;
      px[i + 1] = (c >> 8) & 255;
      px[i + 2] = c & 255;
      px[i + 3] = 255;
    };
    const tex = this.texSize;
    for (let ty = 0; ty < tex; ty += 1) {
      const wy = ((ty + 0.5) / tex) * height;
      const nr = Math.min(nav.rows - 1, Math.floor(wy / nav.cell));
      const fr = Math.min(floor.rows - 1, Math.floor(wy / floor.cell));
      for (let tx = 0; tx < tex; tx += 1) {
        const wx = ((tx + 0.5) / tex) * width;
        const nc = Math.min(nav.cols - 1, Math.floor(wx / nav.cell));
        const fc = Math.min(floor.cols - 1, Math.floor(wx / floor.cell));
        const i = (ty * tex + tx) * 4;
        if (nav.blocked[nr * nav.cols + nc] === 1) rgb(TERRAIN.blocked, i);
        else if (floor.road[fr * floor.cols + fc] === 1) rgb(TERRAIN.road, i);
        else rgb(TERRAIN.walkable, i);
      }
    }
    return data;
  }

  private fogged(lit: ImageData): ImageData {
    const out = this.canvas.context.createImageData(this.texSize, this.texSize);
    const src = lit.data;
    const dst = out.data;
    for (let i = 0; i < src.length; i += 4) {
      dst[i] = Math.round((src[i] ?? 0) * TERRAIN.fogKeep);
      dst[i + 1] = Math.round((src[i + 1] ?? 0) * TERRAIN.fogKeep);
      dst[i + 2] = Math.round((src[i + 2] ?? 0) * TERRAIN.fogKeep);
      dst[i + 3] = 255;
    }
    return out;
  }

  private reveal(x: number, y: number): void {
    const cell = this.fogCell;
    const r = this.revealPx;
    const c0 = Math.max(0, Math.floor((x - r) / cell));
    const n = this.fogCells;
    const tex = this.texSize;
    const c1 = Math.min(n - 1, Math.floor((x + r) / cell));
    const r0 = Math.max(0, Math.floor((y - r) / cell));
    const r1 = Math.min(n - 1, Math.floor((y + r) / cell));
    let dirty = false;
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        const i = row * n + col;
        if (this.fog[i] === 1) continue;
        const dx = (col + 0.5) * cell - x;
        const dy = (row + 0.5) * cell - y;
        if (dx * dx + dy * dy > r * r) continue;
        this.fog[i] = 1;
        // Texel rect of this cell (integer edges, so non-integer ratios leave no seams).
        const tx0 = Math.floor((col * tex) / n);
        const ty0 = Math.floor((row * tex) / n);
        const tw = Math.floor(((col + 1) * tex) / n) - tx0;
        const th = Math.floor(((row + 1) * tex) / n) - ty0;
        if (tw > 0 && th > 0) this.canvas.context.putImageData(this.lit, 0, 0, tx0, ty0, tw, th);
        dirty = true;
      }
    }
    if (dirty) this.canvas.refresh();
  }

  private revealed(x: number, y: number): boolean {
    const n = this.fogCells;
    const col = Phaser.Math.Clamp(Math.floor(x / this.fogCell), 0, n - 1);
    const row = Phaser.Math.Clamp(Math.floor(y / this.fogCell), 0, n - 1);
    return this.fog[row * n + col] === 1;
  }

  // ───────────────────────────── icons ──────────────────────────────────────

  private place(
    id: string,
    icon: string,
    tone: number,
    x: number,
    y: number,
    ignoreFog: boolean,
    alpha: number,
    ringTone: number | null,
    pulse: boolean,
  ): void {
    const hero = this.model?.hero;
    if (hero === undefined) return;
    const wx = WIN.size / 2 + (x - hero.x) * this.worldToWin;
    const wy = WIN.size / 2 + (y - hero.y) * this.worldToWin;
    const inside = wx >= 4 && wx <= WIN.size - 4 && wy >= 4 && wy <= WIN.size - 4;
    let g = this.glyphs.get(id);
    if (!inside || (!ignoreFog && !this.revealed(x, y))) {
      // Kept (hidden) while still in the model: no create/destroy churn at the window edge.
      if (g !== undefined) {
        g.seen = true;
        g.img.setVisible(false);
        g.ring?.setVisible(false);
      }
      return;
    }
    if (g === undefined) {
      const img = this.glyphImage(icon, tone, ICON_PX);
      const ring = ringTone === null ? null : this.scene.add.graphics();
      const created: Glyph = { img, ring, pulse: null, seen: true };
      g = created;
      this.glyphs.set(id, created);
      if (ring !== null) this.root.addAt(ring, this.root.getIndex(this.heroArrow));
      this.root.addAt(img, this.root.getIndex(this.heroArrow));
      if (ring !== null) ring.setData('tone', -1);
    }
    g.seen = true;
    g.img.setVisible(true).setPosition(wx, wy).setAlpha(alpha);
    g.ring?.setVisible(true);
    if (g.ring !== null && ringTone !== null) {
      if (g.ring.getData('tone') !== ringTone) {
        g.ring.setData('tone', ringTone);
        g.ring.clear().lineStyle(2, ringTone, 1).strokeCircle(0, 0, ICON_PX / 2 + 3);
      }
      g.ring.setPosition(wx, wy);
    }
    if (pulse && g.pulse === null) {
      g.pulse = this.scene.tweens.add({ targets: g.img, scale: g.img.scale * 1.35, duration: 420, yoyo: true, repeat: -1 });
    } else if (!pulse && g.pulse !== null) {
      g.pulse.remove();
      g.pulse = null;
    }
  }

  private glyphImage(icon: string, tone: number, size: number): Phaser.GameObjects.Image {
    const slot = iconSlot(this.scene, icon);
    const img =
      slot !== null ? this.scene.add.image(0, 0, slot.key, slot.frame) : this.scene.add.image(0, 0, '__WHITE').setTint(tone);
    return img.setScale(size / Math.max(1, img.width, img.height)).setScrollFactor(0);
  }

  private dropGlyph(id: string, g: Glyph): void {
    g.pulse?.remove();
    g.img.destroy();
    g.ring?.destroy();
    this.glyphs.delete(id);
  }

  private drawCollapse(m: MinimapModel): void {
    const c = m.collapse;
    const key = c === null ? '' : `${Math.round(c.x - m.hero.x)}:${Math.round(c.y - m.hero.y)}:${Math.round(c.r)}`;
    if (key === this.lastCollapseKey) return;
    this.lastCollapseKey = key;
    this.collapse.clear();
    if (c === null) return;
    this.collapse.lineStyle(2, IDENTITY.threat, 1);
    strokeClippedCircle(
      this.collapse,
      WIN.size / 2 + (c.x - m.hero.x) * this.worldToWin,
      WIN.size / 2 + (c.y - m.hero.y) * this.worldToWin,
      c.r * this.worldToWin,
      1,
      1,
      WIN.size - 1,
      WIN.size - 1,
    );
  }

  // ───────────────────────────── peek ───────────────────────────────────────

  private peekX(x: number): number {
    return VIEW.centerX - PEEK.size / 2 + (x / this.map.width) * PEEK.size;
  }

  private peekY(y: number): number {
    return VIEW.centerY - PEEK.size / 2 + (y / this.map.height) * PEEK.size;
  }

  private openPeek(): void {
    if (this.peek !== null || this.model === null) {
      this.closePeek();
      return;
    }
    const { scene } = this;
    const m = this.model;
    sfx('ui');
    const root = scene.add.container(0, 0).setScrollFactor(0).setDepth(PEEK.depth);
    const dim = scene.add
      .rectangle(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height, 0x000000, 0.5)
      .setScrollFactor(0)
      .setInteractive();
    dim.on(Phaser.Input.Events.POINTER_DOWN, () => this.closePeek());
    const left = VIEW.centerX - PEEK.size / 2;
    const top = VIEW.centerY - PEEK.size / 2;
    const plate = scene.add.graphics();
    plate.fillStyle(0x03040b, 0.9).fillRoundedRect(left - 8, top - 8, PEEK.size + 16, PEEK.size + 16, 16);
    plate.lineStyle(2, PANEL.stroke, 0.9).strokeRoundedRect(left - 8, top - 8, PEEK.size + 16, PEEK.size + 16, 16);
    const img = scene.add.image(left, top, this.key).setOrigin(0, 0).setScale(PEEK.size / this.texSize);
    root.add([dim, plate, img]);

    const put = (icon: string, tone: number, x: number, y: number, alpha = 1): void => {
      root.add(this.glyphImage(icon, tone, PEEK.icon).setPosition(this.peekX(x), this.peekY(y)).setAlpha(alpha));
    };
    for (const poi of m.pois) if (this.revealed(poi.x, poi.y)) put(poiIcon(poi.kind), poiTone(poi.kind), poi.x, poi.y, poi.done ? 0.4 : 1);
    for (const gate of m.gates) {
      const tone = GATE_TONE[gate.state];
      const ring = scene.add.graphics().lineStyle(3, tone, 1).strokeCircle(this.peekX(gate.x), this.peekY(gate.y), PEEK.icon / 2 + 4);
      root.add(ring);
      put(gate.id === 'x' ? 'mm-gate-cond' : 'mm-gate', tone, gate.x, gate.y);
      const label = scene.add
        .text(this.peekX(gate.x), this.peekY(gate.y) + PEEK.icon / 2 + 8, gate.id === 'x' ? gate.label : `${gate.id.toUpperCase()} · ${gate.label}`, {
          ...TEXT.label,
          fontSize: '16px',
          color: CSS.ink,
        })
        .setOrigin(0.5, 0);
      label.setX(Phaser.Math.Clamp(label.x, left + label.width / 2, left + PEEK.size - label.width / 2));
      root.add(label);
    }
    if (m.boss !== null) put('mm-boss', IDENTITY.threat, m.boss.x, m.boss.y);
    if (m.collapse !== null) {
      const ring = scene.add.graphics().lineStyle(3, IDENTITY.threat, 1);
      strokeClippedCircle(ring, this.peekX(m.collapse.x), this.peekY(m.collapse.y), m.collapse.r * (PEEK.size / this.map.width), left, top, left + PEEK.size, top + PEEK.size);
      root.add(ring);
    }
    const hero = scene.add.graphics();
    hero.fillStyle(0x39ff6a, 1).lineStyle(2, 0x03040b, 1);
    hero.beginPath().moveTo(14, 0).lineTo(-10, -10).lineTo(-5, 0).lineTo(-10, 10).closePath();
    hero.fillPath().strokePath();
    hero.setPosition(this.peekX(m.hero.x), this.peekY(m.hero.y)).setRotation(m.hero.angle);
    const hint = scene.add
      .text(VIEW.centerX, top + PEEK.size + 28, 'TAP TO CLOSE', { ...TEXT.label, fontSize: '20px', color: CSS.inkSoft, ...bareText() })
      .setOrigin(0.5);
    root.add([hero, hint]);

    root.setAlpha(0);
    scene.tweens.add({ targets: root, alpha: 1, duration: 120 });
    const timer = scene.time.delayedCall(TUNING.minimap.peekMs, () => this.closePeek());
    scene.input.keyboard?.on('keydown-ESC', this.onEsc);
    this.peek = { root, timer, hero };
    this.peekCb?.();
  }
}
