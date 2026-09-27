/**
 * Colony camera (PRD §3, §4 Camera): the world lives in ONE `worldRoot`
 * container that this class pans and scales; the main camera never scrolls
 * or zooms, so the HUD, template overlays (pause, sheets, confirm) and every
 * scrollFactor-0 widget stay pixel-exact at any zoom. Drag-pan with inertia,
 * double-tap zoom stops, optional pinch, bounds = map + 2 tiles. The map
 * renders full-screen; map input is accepted between the status band and the
 * dock (interface-direction §5), and focus points centre in the unobstructed
 * read window (y 432-868).
 */
import Phaser from 'phaser';
import { VIEW } from '../../../config';
import { COLONY_TUNING } from '../tuning';

const CAM = COLONY_TUNING.camera;
const TILE = COLONY_TUNING.map.tilePx;

export const PLAYFIELD = { top: 232, bottom: 964, focusY: 650 } as const;
/**
 * The band the map can be TAPPED in: below the status + banner bands, above the
 * tray + dock (interface-direction §5). Bounds clamp so every map edge tile can
 * be brought inside it; build mode and dusk framing aim into it.
 */
export const TAPPABLE = { top: 332, bottom: 868 } as const;

/** Release fling: px/frame cap, and the decay per 60 Hz frame (short and damped: ≤ ~130 px of travel). */
const FLING_CAP = 20;
const FLING_DECAY = CAM.panInertia * CAM.panInertia;
/** A finger that rested this long before lifting throws nothing. */
const FLING_REST_MS = 60;
/** Release velocity is measured over the last this-many ms of movement. */
const FLING_WINDOW_MS = 80;


export class ColonyCamera {
  readonly root: Phaser.GameObjects.Container;
  private readonly worldW: number;
  private readonly worldH: number;
  zoom = 1;
  /** Lowest zoom allowed right now (raised to the swarm floor while fauna are close). */
  zoomFloor: number = CAM.zoomStops[0];
  private vx = 0;
  private vy = 0;
  /** A finger is dragging: the map tracks it 1:1 and no inertia runs. */
  private dragging = false;
  /** Recent drag samples (scene ms, cumulative screen px) for the release velocity. */
  private readonly samples: Array<{ t: number; x: number; y: number }> = [];
  private sumX = 0;
  private sumY = 0;
  /** Scene time of the last player pan (drag, keys, pinch); dusk framing respects it. */
  lastUserPanAt = -1e9;
  private tween: Phaser.Tweens.Tween | null = null;
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, worldW: number, worldH: number) {
    this.scene = scene;
    this.worldW = worldW;
    this.worldH = worldH;
    this.root = scene.add.container(0, 0).setDepth(0);
  }

  screenToWorld(sx: number, sy: number, out: { x: number; y: number }): void {
    out.x = (sx - this.root.x) / this.zoom;
    out.y = (sy - this.root.y) / this.zoom;
  }

  worldToScreen(wx: number, wy: number, out: { x: number; y: number }): void {
    out.x = this.root.x + wx * this.zoom;
    out.y = this.root.y + wy * this.zoom;
  }

  /** Centre a world point in the playfield band. */
  centerOn(wx: number, wy: number): void {
    this.root.x = VIEW.width / 2 - wx * this.zoom;
    this.root.y = PLAYFIELD.focusY - wy * this.zoom;
    this.clamp();
  }

  /** Eased pan so a world point lands at a screen point (alert pills, building card, dusk framing). */
  panTo(wx: number, wy: number, screenY: number = PLAYFIELD.focusY, screenX: number = VIEW.width / 2, durationMs: number = CAM.alertPanMs): void {
    this.tween?.stop();
    this.vx = 0;
    this.vy = 0;
    const tx = screenX - wx * this.zoom;
    const ty = screenY - wy * this.zoom;
    this.tween = this.scene.tweens.add({
      targets: this.root,
      x: tx,
      y: ty,
      duration: durationMs,
      ease: 'Sine.easeInOut',
      onUpdate: () => this.clamp(),
      onComplete: () => {
        this.tween = null;
      },
    });
  }

  /** A drag passed the tap slop: kill any tween / fling and start tracking the finger. */
  beginDrag(time: number): void {
    this.tween?.stop();
    this.tween = null;
    this.vx = 0;
    this.vy = 0;
    this.dragging = true;
    this.samples.length = 0;
    this.sumX = 0;
    this.sumY = 0;
    this.samples.push({ t: time, x: 0, y: 0 });
  }

  /** Moves the map exactly by the finger's screen delta (1:1, no velocity applied while held). */
  dragBy(dx: number, dy: number, time: number): void {
    this.root.x += dx;
    this.root.y += dy;
    this.sumX += dx;
    this.sumY += dy;
    this.samples.push({ t: time, x: this.sumX, y: this.sumY });
    while (this.samples.length > 2 && time - (this.samples[0]?.t ?? time) > FLING_WINDOW_MS) this.samples.shift();
    this.lastUserPanAt = this.scene.time.now;
    this.clamp();
  }

  /** Finger up: a short, damped fling from the last ~80 ms of motion; none after a rest. */
  endDrag(time: number): void {
    if (!this.dragging) return;
    this.dragging = false;
    const last = this.samples[this.samples.length - 1];
    const first = this.samples[0];
    this.samples.length = 0;
    if (last === undefined || first === undefined || time - last.t > FLING_REST_MS || last.t - first.t < 1) return;
    const frame = 1000 / 60;
    const span = Math.max(last.t - first.t, frame);
    this.vx = Phaser.Math.Clamp(((last.x - first.x) / span) * frame, -FLING_CAP, FLING_CAP);
    this.vy = Phaser.Math.Clamp(((last.y - first.y) / span) * frame, -FLING_CAP, FLING_CAP);
  }

  /**
   * Puts a world point at a screen point at `zoom` (clamped to the stops and the swarm floor):
   * eased over `durationMs`, or at once when 0. Zoom and pan ease together.
   */
  flyTo(wx: number, wy: number, screenX: number, screenY: number, zoom: number, durationMs: number): void {
    this.cancelPan();
    this.stopInertia();
    const z1 = Phaser.Math.Clamp(zoom, Math.max(CAM.zoomStops[0], this.zoomFloor), CAM.zoomStops[2]);
    const apply = (z: number, x: number, y: number): void => {
      this.zoom = z;
      this.root.setScale(z);
      this.root.x = x;
      this.root.y = y;
      this.clamp();
    };
    if (durationMs <= 0) {
      apply(z1, screenX - wx * z1, screenY - wy * z1);
      return;
    }
    const from = { z: this.zoom, x: this.root.x, y: this.root.y };
    const to = { z: z1, x: screenX - wx * z1, y: screenY - wy * z1 };
    const p = { t: 0 };
    this.tween = this.scene.tweens.add({
      targets: p,
      t: 1,
      duration: durationMs,
      ease: 'Sine.easeInOut',
      onUpdate: () => apply(from.z + (to.z - from.z) * p.t, from.x + (to.x - from.x) * p.t, from.y + (to.y - from.y) * p.t),
      onComplete: () => {
        this.tween = null;
      },
    });
  }

  /** Stops an eased pan where it is. */
  cancelPan(): void {
    this.tween?.stop();
    this.tween = null;
  }

  stopInertia(): void {
    this.vx = 0;
    this.vy = 0;
    this.dragging = false;
  }

  setZoom(z: number, anchorX: number, anchorY: number): void {
    const next = Phaser.Math.Clamp(z, Math.max(CAM.zoomStops[0], this.zoomFloor), CAM.zoomStops[2]);
    const wx = (anchorX - this.root.x) / this.zoom;
    const wy = (anchorY - this.root.y) / this.zoom;
    this.zoom = next;
    this.root.setScale(next);
    this.root.x = anchorX - wx * next;
    this.root.y = anchorY - wy * next;
    this.clamp();
  }

  /** Double-tap: cycle 1.0 → 1.4 → 0.7 → 1.0 around the tap point. */
  cycleZoom(anchorX: number, anchorY: number): void {
    const [low, mid, high] = CAM.zoomStops;
    const next = Math.abs(this.zoom - mid) < 0.05 ? high : Math.abs(this.zoom - high) < 0.05 ? low : mid;
    this.setZoom(next, anchorX, anchorY);
  }

  stepZoom(dir: 1 | -1): void {
    const stops = CAM.zoomStops;
    let i = stops.findIndex((s) => Math.abs(s - this.zoom) < 0.05);
    if (i < 0) i = 1;
    const next = stops[Phaser.Math.Clamp(i + dir, 0, stops.length - 1)] ?? 1;
    this.setZoom(next, VIEW.width / 2, PLAYFIELD.focusY);
  }

  update(deltaMs: number, keyX: number, keyY: number): void {
    if (this.zoom < this.zoomFloor - 1e-3) this.setZoom(this.zoomFloor, VIEW.width / 2, PLAYFIELD.focusY);
    if (keyX !== 0 || keyY !== 0) {
      const step = (CAM.keyPanPxPerSec * deltaMs) / 1000;
      this.root.x -= keyX * step;
      this.root.y -= keyY * step;
      this.lastUserPanAt = this.scene.time.now;
      this.clamp();
      return;
    }
    if (this.dragging || (Math.abs(this.vx) < 0.05 && Math.abs(this.vy) < 0.05)) return;
    const frames = deltaMs / (1000 / 60);
    this.root.x += this.vx * frames;
    this.root.y += this.vy * frames;
    const decay = FLING_DECAY ** frames;
    this.vx *= decay;
    this.vy *= decay;
    this.clamp();
  }

  private clamp(): void {
    const pad = CAM.boundsPadTiles * TILE * this.zoom;
    const w = this.worldW * this.zoom;
    const h = this.worldH * this.zoom;
    const minX = VIEW.width - w - pad;
    const maxX = pad;
    const minY = TAPPABLE.bottom - h - pad;
    const maxY = TAPPABLE.top + pad;
    this.root.x = minX > maxX ? (minX + maxX) / 2 : Phaser.Math.Clamp(this.root.x, minX, maxX);
    this.root.y = minY > maxY ? (minY + maxY) / 2 : Phaser.Math.Clamp(this.root.y, minY, maxY);
  }
}
