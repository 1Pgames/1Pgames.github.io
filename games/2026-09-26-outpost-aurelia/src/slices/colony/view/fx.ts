/**
 * World fx (PRD §13 juice table, `art/wiring.md` §7-§8): turret bolts, arcs,
 * flak and acid shells, bursts, drones, rank-up shines, relic bursts,
 * armoured floaters and the world-projected dusk edge arrows. Every sprite is
 * pooled; every voice and floater is rate-capped per the §13 caps.
 */
import Phaser from 'phaser';
import { ARMOUR, CSS, FONT, PALETTE, VIEW } from '../../../config';
import { safePlay } from '../../../core/anim';
import { sfx, type SfxName } from '../../../core/audio';
import type { Edge } from '../content';
import type { ShotSrc } from '../contracts';
import { DRONE_PX, FX, MOTION } from './artMap';

const FX_POOL_MAX = 96;
const DRONE_MS_DEFAULT = 900;
const BOLT_PX_PER_SEC = 900;

/** Sliding window: at most `count` passes per `windowMs`. */
class RateGate {
  private readonly stamps: number[] = [];
  private readonly count: number;
  private readonly windowMs: number;
  constructor(count: number, windowMs = 1000) {
    this.count = count;
    this.windowMs = windowMs;
  }
  allow(now: number): boolean {
    while (this.stamps.length > 0 && now - (this.stamps[0] ?? 0) >= this.windowMs) this.stamps.shift();
    if (this.stamps.length >= this.count) return false;
    this.stamps.push(now);
    return true;
  }
}

/** §12 per-voice caps: [plays, per ms]. */
const VOICE_CAP: Partial<Record<SfxName, readonly [number, number]>> = {
  place: [6, 1000], build: [4, 1000], drone: [4, 1000], deny: [3, 1000], upgrade: [2, 1000], relic: [1, 1000], ship: [1, 1000],
  pulse: [8, 1000], arc: [5, 1000], flak: [4, 1000], hit: [8, 1000], die: [6, 1000], hurt: [4, 1000], wreck: [2, 1000],
  brownout: [2, 1000], leech: [2, 1000], moth: [2, 1000], loss: [1, 2000], overdrive: [1, 10000],
};

/** §13 Dusk telegraph: 8 % `bad` vignette, breathing while the arrows show. */
const DUSK_VIGNETTE = { alpha: 0.08, bands: 6, bandPx: 22, pulseMs: 900 } as const;
/** §13 Invalid placement: `bad` tile mark with a 6 px horizontal shake over 160 ms. */
const DENY = { shakePx: 6, ms: 160, holdMs: 260 } as const;

/** Screen clamp band for off-screen dusk arrows (interface-direction §5: playfield read window). */
export const ARROW_BAND = { x0: 88, x1: 632, y0: 480, y1: 820 } as const;
const ARROW_PX = 96;
/** Bottom of the alert-rail band (interface-direction §5): dusk counts never draw above it. */
const ALERT_BAND_BOTTOM = 432;
/** Loss pings sit inside the tappable read band (interface-direction §5), 56 px arrows, ≤ 4 at once. */
const PING_BAND = { x0: 64, x1: 656, y0: 372, y1: 828 } as const;
const PING_PX = 56;
const PING_POOL = 4;
const EDGE_ROT: Record<Edge, number> = { 0: 0, 1: Math.PI / 2, 2: Math.PI, 3: -Math.PI / 2 };

/**
 * Where a dusk arrow's "×N" count sits (shared with game.ts placement so both agree): it rides ON its
 * own arrow's flank, never toward the core — beside N/S arrows (away from the screen's right edge),
 * above E/W arrows unless that enters the alert band (y < 432), then below.
 */
export function arrowLabelAt(edge: Edge, x: number, y: number, out: { x: number; y: number }): void {
  const side = x + ARROW_PX / 2 + 30 > VIEW.width - 20 ? -1 : 1;
  const above = y - (ARROW_PX / 2 + 18);
  out.x = edge === 0 || edge === 2 ? x + side * (ARROW_PX / 2 + 26) : x;
  out.y = edge === 0 || edge === 2 ? y : above - 18 < ALERT_BAND_BOTTOM ? y + (ARROW_PX / 2 + 18) : above;
}

export class WorldFx {
  private readonly labelAt = { x: 0, y: 0 };
  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Container;
  private readonly droneLayer: Phaser.GameObjects.Container;
  private readonly free: Phaser.GameObjects.Sprite[] = [];
  private live = 0;
  private readonly drones: Phaser.GameObjects.Sprite[] = [];
  private readonly voices = new Map<SfxName, RateGate>();
  private readonly floatGate = new RateGate(12);
  private readonly arrows: Array<{ sprite: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text; plate: Phaser.GameObjects.Graphics }> = [];
  private readonly has: (key: string) => boolean;
  private readonly boundsA = new Phaser.Geom.Rectangle();
  private readonly boundsB = new Phaser.Geom.Rectangle();
  private readonly vignette: Phaser.GameObjects.Graphics;
  private vignettePulse: Phaser.Tweens.Tween | null = null;
  private readonly denyMark: Phaser.GameObjects.Graphics;
  calm = false;

  /** Off-screen loss pings (pooled small arrows at the band edge pointing at the loss). */
  private readonly pings: Phaser.GameObjects.Sprite[] = [];
  private readonly pingDepth: number;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, droneLayer: Phaser.GameObjects.Container, arrowDepth: number) {
    this.pingDepth = arrowDepth;
    this.scene = scene;
    this.layer = layer;
    this.droneLayer = droneLayer;
    this.has = (key) => scene.textures.exists(key);
    for (let i = 0; i < 4; i += 1) {
      const sprite = scene.add.sprite(0, 0, FX.duskArrow).setDisplaySize(ARROW_PX, ARROW_PX).setScrollFactor(0).setDepth(arrowDepth).setVisible(false);
      const label = scene.add
        .text(0, 0, '', { fontFamily: FONT.display, fontSize: '28px', color: CSS.bad, ...ARMOUR.small })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(arrowDepth)
        .setVisible(false);
      // HUD-chip backing (interface-direction §2 chip: bgDeep 0.82, 2 px #3b3040) for a margin arrow
      // that could find no spot clear of buildings: it then reads as HUD, not as a mark on the base.
      const plate = scene.add.graphics().setScrollFactor(0).setDepth(arrowDepth - 0.5).setVisible(false);
      plate.fillStyle(PALETTE.bgDeep, 0.82).fillRoundedRect(-ARROW_PX / 2 - 4, -ARROW_PX / 2 - 4, ARROW_PX + 8, ARROW_PX + 8, 22);
      plate.lineStyle(2, 0x3b3040, 1).strokeRoundedRect(-ARROW_PX / 2 - 4, -ARROW_PX / 2 - 4, ARROW_PX + 8, ARROW_PX + 8, 22);
      this.arrows.push({ sprite, label, plate });
    }
    this.vignette = scene.add.graphics().setScrollFactor(0).setDepth(arrowDepth - 1).setVisible(false);
    for (let i = 0; i < DUSK_VIGNETTE.bands; i += 1) {
      const inset = i * DUSK_VIGNETTE.bandPx + DUSK_VIGNETTE.bandPx / 2;
      this.vignette.lineStyle(DUSK_VIGNETTE.bandPx, PALETTE.bad, DUSK_VIGNETTE.alpha * (1 - i / DUSK_VIGNETTE.bands));
      this.vignette.strokeRect(inset, inset, VIEW.width - inset * 2, VIEW.height - inset * 2);
    }
    this.denyMark = scene.add.graphics().setVisible(false);
    layer.add(this.denyMark);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.vignettePulse?.remove();
      this.vignettePulse = null;
    });
  }

  /** Live looping tweens WorldFx registered (tween-hygiene probe). */
  get loops(): number {
    return this.vignettePulse === null ? 0 : 1;
  }

  /**
   * Invalid placement (§13): the refused footprint outlines in `bad` and
   * shakes 6 px horizontally for 160 ms on the tap frame, then fades.
   */
  deny(x: number, y: number, px: number): void {
    const g = this.denyMark;
    this.scene.tweens.killTweensOf(g);
    g.clear();
    g.fillStyle(PALETTE.bad, 0.28).fillRect(-px / 2, -px / 2, px, px);
    g.lineStyle(4, PALETTE.bad, 1).strokeRect(-px / 2, -px / 2, px, px);
    g.setPosition(x, y).setAlpha(1).setVisible(true);
    if (this.calm) {
      this.scene.tweens.add({ targets: g, alpha: 0, delay: DENY.holdMs, duration: DENY.ms, onComplete: () => g.setVisible(false) });
      return;
    }
    this.scene.tweens.add({ targets: g, x: { from: x - DENY.shakePx, to: x + DENY.shakePx }, duration: DENY.ms / 4, ease: 'Sine.easeInOut', yoyo: true, repeat: 1, onComplete: () => g.setX(x) });
    this.scene.tweens.add({ targets: g, alpha: 0, delay: DENY.holdMs, duration: DENY.ms, ease: 'Quad.easeIn', onComplete: () => g.setVisible(false) });
  }

  /** Plays a voice under its §13 cap. */
  voice(name: SfxName, volume = 1, rate = 1): void {
    const cap = VOICE_CAP[name];
    if (cap !== undefined) {
      let gate = this.voices.get(name);
      if (gate === undefined) {
        gate = new RateGate(cap[0], cap[1]);
        this.voices.set(name, gate);
      }
      if (!gate.allow(this.scene.time.now)) return;
    }
    sfx(name, { volume, rate });
  }

  private obtain(key: string): Phaser.GameObjects.Sprite | null {
    if (!this.has(key)) return null;
    let s = this.free.pop();
    if (s === undefined) {
      if (this.live >= FX_POOL_MAX) return null;
      s = this.scene.add.sprite(0, 0, key);
      this.layer.add(s);
    }
    this.live += 1;
    s.setTexture(key, 0).clearTint().setVisible(true).setAlpha(1).setRotation(0).setScale(1).setOrigin(0.5, 0.5).setBlendMode(Phaser.BlendModes.ADD);
    return s;
  }

  private release(s: Phaser.GameObjects.Sprite): void {
    if (!s.visible) return;
    this.scene.tweens.killTweensOf(s);
    s.stop();
    s.setVisible(false);
    this.live -= 1;
    this.free.push(s);
  }

  /** One-shot fx sheet at a world point, released when its animation completes. */
  oneShot(key: string, x: number, y: number, px: number, originY = 0.5): void {
    const s = this.obtain(key);
    if (s === null) return;
    s.setPosition(x, y).setOrigin(0.5, originY).setDisplaySize(px, px);
    if (!safePlay(s, key)) {
      this.scene.time.delayedCall(320, () => this.release(s));
      return;
    }
    s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.release(s));
  }

  /**
   * Shot by source (§13): Pulse bolt, Arc filament, Flak / Acid shell; relay
   * sentries draw a thin filament, the Choir Spire a large bolt in the accent.
   */
  shot(kind: ShotSrc, x0: number, y0: number, x1: number, y1: number): void {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const angle = Math.atan2(y1 - y0, x1 - x0);
    if (kind === 'arc' || kind === 'sentry') {
      const s = this.obtain(FX.arc);
      if (s === null) return;
      s.setPosition((x0 + x1) / 2, (y0 + y1) / 2).setRotation(angle).setDisplaySize(Math.max(48, dist), kind === 'arc' ? 64 : 28);
      if (!safePlay(s, FX.arc)) this.release(s);
      else s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.release(s));
      this.voice('arc', kind === 'arc' ? 0.5 : 0.2);
      return;
    }
    if (kind === 'pulse' || kind === 'choir') {
      const px = kind === 'pulse' ? 64 : 112;
      this.oneShot(FX.pulseBolt, x0, y0, kind === 'pulse' ? 56 : 120);
      const s = this.obtain(FX.pulseBolt);
      if (s === null) return;
      s.setFrame(2).setPosition(x0, y0).setRotation(angle).setDisplaySize(px, px);
      if (kind === 'choir') s.setTint(PALETTE.accent);
      // Launch ease: the bolt leaves the barrel and accelerates onto the target (mean speed stays 900 px/s).
      this.scene.tweens.add({ targets: s, x: x1, y: y1, duration: (dist / BOLT_PX_PER_SEC) * 1000, ease: 'Sine.easeIn', onComplete: () => this.release(s) });
      this.voice('pulse', kind === 'pulse' ? 0.35 : 0.6);
      return;
    }
    const key = kind === 'flak' ? FX.flak : FX.acid;
    // Flak muzzle (§13 turret fire): a small mortar blast at the barrel before the shell arcs.
    if (kind === 'flak') this.oneShot(FX.flak, x0, y0, 56);
    const s = this.obtain(key);
    if (s === null) return;
    s.setFrame(0).setPosition(x0, y0).setDisplaySize(48, 48);
    const peak = Math.min(y0, y1) - Math.min(160, dist * 0.4);
    const ms = Math.max(260, (dist / 520) * 1000);
    // Ballistic: constant horizontal speed is what makes the eased y read as an arc.
    this.scene.tweens.add({ targets: s, x: x1, duration: ms, ease: 'Linear' });
    this.scene.tweens.add({
      targets: s,
      y: { from: y0, to: peak },
      duration: ms / 2,
      ease: 'Quad.easeOut',
      onComplete: () =>
        this.scene.tweens.add({
          targets: s,
          y: y1,
          duration: ms / 2,
          ease: 'Quad.easeIn',
          onComplete: () => {
            this.release(s);
            this.oneShot(key, x1, y1, kind === 'flak' ? 120 : 88);
          },
        }),
    });
    if (kind === 'flak') this.voice('flak', 0.45);
  }

  /** Drone delivery (§13): amber drone slides building → storage over `ms`; ≤ `max` in flight. */
  drone(x0: number, y0: number, x1: number, y1: number, max: number, ms = DRONE_MS_DEFAULT): void {
    if (!this.has(MOTION.drone)) return;
    let d = this.drones.find((s) => !s.visible);
    if (d === undefined) {
      if (this.drones.length >= max) return;
      d = this.scene.add.sprite(0, 0, MOTION.drone).setDisplaySize(DRONE_PX, DRONE_PX);
      this.droneLayer.add(d);
      this.drones.push(d);
    }
    const s = d;
    s.setVisible(true).setPosition(x0, y0).setFlipX(x1 < x0);
    safePlay(s, MOTION.drone, true);
    this.scene.tweens.add({
      targets: s,
      x: x1,
      y: y1,
      duration: ms,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        s.stop();
        s.setVisible(false);
      },
    });
    this.voice('drone', 0.25);
  }

  get dronesInFlight(): number {
    let n = 0;
    for (const d of this.drones) if (d.visible) n += 1;
    return n;
  }

  /** Armoured rising world floater (interface-direction §3), ≤ 12/s scene-wide unless `force`. */
  float(x: number, y: number, label: string, color: string, size = 26, rise = 40, force = false): void {
    if (!force && !this.floatGate.allow(this.scene.time.now)) return;
    const text = this.scene.add
      .text(x, y, label, { fontFamily: FONT.display, fontSize: `${size}px`, color, ...(size >= 40 ? ARMOUR.display : ARMOUR.small) })
      .setOrigin(0.5);
    this.layer.add(text);
    this.scene.tweens.add({
      targets: text,
      y: y - (this.calm ? 0 : rise),
      alpha: { from: 1, to: 0 },
      duration: this.calm ? 700 : Math.max(500, rise * 9),
      ease: 'Cubic.easeOut',
      onComplete: () => text.destroy(),
    });
  }

  /**
   * Dusk telegraph (§13): one pulsing arrow per edge at `points` (screen px,
   * already clamped into ARROW_BAND), with the incoming count. `null` hides.
   */
  setArrows(edges: readonly Edge[] | null, points: ReadonlyArray<{ x: number; y: number }>, count: number, inward?: readonly boolean[]): void {
    const shown = edges !== null && edges.length > 0 && points.length > 0;
    if (shown !== this.vignette.visible) {
      this.vignettePulse?.remove();
      this.vignettePulse = null;
      this.vignette.setVisible(shown).setAlpha(1);
      if (shown && !this.calm) {
        this.vignettePulse = this.scene.tweens.add({ targets: this.vignette, alpha: { from: 1, to: 0.45 }, duration: DUSK_VIGNETTE.pulseMs, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
      }
    }
    this.arrows.forEach((a, i) => {
      const edge = edges?.[i];
      const p = points[i];
      const on = edge !== undefined && p !== undefined;
      if (!on) {
        if (a.sprite.visible) {
          a.sprite.setVisible(false).stop();
          a.plate.setVisible(false);
          a.label.setVisible(false);
        }
        return;
      }
      if (!a.sprite.visible) {
        a.sprite.setVisible(true);
        safePlay(a.sprite, FX.duskArrow, true);
        a.label.setVisible(true);
      }
      // Tonight's edges / count can change while shown (mid-night reveal, trickle): refresh on change only.
      // A margin arrow (lit field fills the band) points inward, the way the swarm will travel.
      const rot = EDGE_ROT[edge] + (inward?.[i] === true ? Math.PI : 0);
      if (a.sprite.rotation !== rot) a.sprite.setRotation(rot);
      const text = `×${count}`;
      if (a.label.text !== text) a.label.setText(text);
      a.sprite.setPosition(p.x, p.y);
      const plated = inward?.[i] === true;
      if (a.plate.visible !== plated) a.plate.setVisible(plated);
      if (plated) a.plate.setPosition(p.x, p.y);
      arrowLabelAt(edge, p.x, p.y, this.labelAt);
      a.label.setPosition(this.labelAt.x, this.labelAt.y);
    });
  }

  /**
   * Screen rect of the arrow drawn for `edge` AND its "×N" count label, taken
   * from their rendered bounds (rotation, display size and origin included) —
   * the coach cut-out target. Null when hidden.
   */
  arrowRect(edges: readonly Edge[] | null, edge: Edge): { x: number; y: number; w: number; h: number } | null {
    const i = edges?.indexOf(edge) ?? -1;
    const a = i >= 0 ? this.arrows[i] : undefined;
    if (a === undefined || !a.sprite.visible) return null;
    const pad = 6;
    const s = a.sprite.getBounds(this.boundsA);
    const l = a.label.getBounds(this.boundsB);
    const x0 = Math.min(s.x, l.x - pad);
    const y0 = Math.min(s.y, l.y - pad);
    const x1 = Math.max(s.right, l.right + pad);
    const y1 = Math.max(s.bottom, l.bottom + pad);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * A loss outside the visible read band (critic build2): a small `bad` arrow at the band edge,
   * pointing at the screen point of the loss, fading over 1.4 s. Nothing when the loss is on screen.
   */
  edgePing(sx: number, sy: number): void {
    const inside = sx >= PING_BAND.x0 && sx <= PING_BAND.x1 && sy >= PING_BAND.y0 && sy <= PING_BAND.y1;
    if (inside || !this.has(FX.duskArrow)) return;
    let s = this.pings.find((p) => !p.visible);
    if (s === undefined) {
      if (this.pings.length >= PING_POOL) return;
      s = this.scene.add.sprite(0, 0, FX.duskArrow).setScrollFactor(0).setDepth(this.pingDepth).setVisible(false);
      this.pings.push(s);
    }
    const px = Phaser.Math.Clamp(sx, PING_BAND.x0, PING_BAND.x1);
    const py = Phaser.Math.Clamp(sy, PING_BAND.y0, PING_BAND.y1);
    const sprite = s;
    sprite.setPosition(px, py).setDisplaySize(PING_PX, PING_PX).setTint(PALETTE.bad).setAlpha(1).setVisible(true);
    // The arrow art points −y: rotate it toward the loss.
    sprite.setRotation(Math.atan2(sy - py, sx - px) + Math.PI / 2);
    this.scene.tweens.killTweensOf(sprite);
    this.scene.tweens.add({ targets: sprite, alpha: 0, delay: 600, duration: 800, onComplete: () => sprite.setVisible(false) });
  }
}
