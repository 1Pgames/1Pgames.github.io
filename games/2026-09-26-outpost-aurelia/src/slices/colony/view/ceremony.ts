/**
 * Ceremonies over 700 ms (PRD §13 feel budget): dawn lander arc, Beacon
 * launch cinematic, Landing-lost lights-out. Each runs for a fixed span with
 * tap-to-skip (a full-screen catcher above the HUD); skipping jumps every
 * running tween to its end and fires `onDone` exactly once. Reduce-motion
 * callers pass the short span and skip the travel tweens.
 */
import Phaser from 'phaser';
import { VIEW } from '../../../config';
import { safePlay } from '../../../core/anim';
import { MOTION } from './artMap';

const CATCHER_DEPTH = 2450;

export class Ceremony {
  private readonly scene: Phaser.Scene;
  private catcher: Phaser.GameObjects.Zone | null = null;
  private timer: Phaser.Time.TimerEvent | null = null;
  private done: (() => void) | null = null;
  private readonly tweens: Phaser.Tweens.Tween[] = [];
  private readonly props: Phaser.GameObjects.GameObject[] = [];
  /** Timed beats inside the span; a skip fires the pending ones at once (same code path, never a state jump). */
  private readonly beats: Array<{ timer: Phaser.Time.TimerEvent; fn: () => void }> = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  get active(): boolean {
    return this.done !== null;
  }

  /** Starts a span; tweens / props registered via `track` finish or vanish on skip. */
  run(ms: number, onDone: () => void): void {
    this.finish();
    this.done = onDone;
    this.catcher = this.scene.add.zone(0, 0, VIEW.width, VIEW.height).setOrigin(0, 0).setScrollFactor(0).setDepth(CATCHER_DEPTH).setInteractive();
    this.catcher.on(Phaser.Input.Events.POINTER_UP, () => this.finish());
    this.timer = this.scene.time.delayedCall(ms, () => this.finish());
  }

  track(t: Phaser.Tweens.Tween | null, prop?: Phaser.GameObjects.GameObject): void {
    if (t !== null) this.tweens.push(t);
    if (prop !== undefined) this.props.push(prop);
  }

  /** Schedules `fn` at `ms` into the span; skipping the ceremony runs it immediately instead. */
  at(ms: number, fn: () => void): void {
    const beat = { timer: this.scene.time.delayedCall(ms, () => {
      const i = this.beats.indexOf(beat);
      if (i >= 0) this.beats.splice(i, 1);
      fn();
    }), fn };
    this.beats.push(beat);
  }

  /** Ends the span now (tap-to-skip, or its timer). */
  finish(): void {
    const cb = this.done;
    this.done = null;
    this.timer?.remove();
    this.timer = null;
    this.catcher?.destroy();
    this.catcher = null;
    for (const t of this.tweens) if (t.isPlaying() || t.isPaused()) t.complete();
    this.tweens.length = 0;
    const pending = this.beats.splice(0);
    for (const b of pending) {
      b.timer.remove();
      b.fn();
    }
    for (const p of this.props) p.destroy();
    this.props.length = 0;
    cb?.();
  }
}

/** Dawn (§13): the lander shuttle arcs down from the sky onto the core, nose up. */
export function landerArc(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, to: { x: number; y: number }, ms: number, c: Ceremony): void {
  if (!scene.textures.exists(MOTION.shuttle)) return;
  const s = scene.add.sprite(to.x + 360, to.y - 900, MOTION.shuttle).setDisplaySize(96, 96);
  layer.add(s);
  safePlay(s, MOTION.shuttle);
  c.track(scene.tweens.add({ targets: s, x: to.x, duration: ms, ease: 'Sine.easeOut' }), s);
  c.track(scene.tweens.add({ targets: s, y: to.y - 40, duration: ms, ease: 'Quad.easeIn' }));
  c.track(scene.tweens.add({ targets: s, alpha: { from: 1, to: 0 }, delay: ms * 0.85, duration: ms * 0.15, ease: 'Quad.easeIn' }));
}

/** Order shipped (§13): the shuttle lifts off the core (700 ms). */
export function shuttleLaunch(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, from: { x: number; y: number }): void {
  if (!scene.textures.exists(MOTION.shuttle)) return;
  const s = scene.add.sprite(from.x, from.y - 40, MOTION.shuttle).setDisplaySize(96, 96);
  layer.add(s);
  safePlay(s, MOTION.shuttle);
  scene.tweens.add({ targets: s, y: from.y - 760, alpha: { from: 1, to: 0 }, duration: 700, ease: 'Quad.easeIn', onComplete: () => s.destroy() });
}

/** Launch payoff (§13): the Ark silhouette crosses the sky, screen space. */
export function arkFlyby(scene: Phaser.Scene, ms: number, c: Ceremony): void {
  if (!scene.textures.exists(MOTION.ark)) return;
  // Below the HUD band (y ≤ 400): the Ark crosses the playfield sky, over the colony.
  const ark = scene.add.image(-320, 640, MOTION.ark).setDisplaySize(512, 512).setScrollFactor(0).setDepth(CATCHER_DEPTH - 10);
  c.track(scene.tweens.add({ targets: ark, x: VIEW.width + 320, y: 520, duration: ms, ease: 'Sine.easeInOut' }), ark);
}
