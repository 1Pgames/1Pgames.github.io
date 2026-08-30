import Phaser from 'phaser';
import { CSS, FONT, PALETTE, VIEW } from '../config';
import { TEX } from './keys';

/**
 * Game feel toolkit. A generated game lives or dies on these 6 effects, so they
 * are pre-wired: use them on every meaningful state change (hit, pickup, death,
 * milestone). Rule of thumb: no gameplay event without at least one of
 * shake / pop / flash / burst / floatText / hitstop.
 */

/**
 * Haptics. On a phone the shake/hitstop pair is felt, not just seen, so both
 * fire a single short buzz. Throttled module-wide: dozens of hits per second
 * would otherwise queue into one continuous, unpleasant vibration (and Chrome
 * drops spammed calls anyway). Absent API (desktop, iOS Safari) — silent no-op.
 */
const HAPTIC_GAP_MS = 120;
let lastHaptic = 0;

function buzz(durationMs: number): void {
  const now = Date.now();
  if (now - lastHaptic < HAPTIC_GAP_MS) return;
  lastHaptic = now;
  try {
    navigator.vibrate?.(durationMs);
  } catch {
    /* vibration blocked by permissions policy — feel degrades, nothing breaks */
  }
}

export function shake(scene: Phaser.Scene, intensity = 0.008, durationMs = 160): void {
  scene.cameras.main.shake(durationMs, intensity);
  buzz(12);
}

/**
 * Full-screen colour flash. Use sparingly: damage, death, milestone.
 *
 * NEVER OPAQUE. Phaser's `Camera.flash` starts its overlay at alpha 1, which
 * paints the ENTIRE frame one flat colour: on the 2026-08-29 build one of six
 * verification screenshots came back as a solid sheet with no game in it, and
 * the same effect hides the frame in which the player is trying to read what
 * just hit them. The peak alpha is therefore authored (`peakAlpha`) and HARD
 * CLAMPED to `MAX_FLASH_ALPHA`, so no call site — and no generated game — can
 * blank a frame. The tint still reads: 0.4 over the play field is a clear
 * colour wash at 24fps capture.
 *
 * Capped in count as well as in strength. `force` is false, so a running flash
 * is never restarted, and `FLASH_GAP_MS` drops any flash that lands too soon
 * after the last one — 30 simultaneous damage events are one flash, not a
 * strobe (same throttle shape as `HAPTIC_GAP_MS` above).
 */
const MAX_FLASH_ALPHA = 0.6;
const FLASH_GAP_MS = 220;
let lastFlash = 0;

export function flash(
  scene: Phaser.Scene,
  color: number = PALETTE.bad,
  durationMs = 140,
  peakAlpha = 0.4,
): void {
  const now = Date.now();
  if (now - lastFlash < FLASH_GAP_MS) return;
  lastFlash = now;
  const c = Phaser.Display.Color.IntegerToRGB(color);
  const effect = scene.cameras.main.flashEffect;
  // `start` snapshots `alpha` as the effect's PEAK and fades from it, so the
  // ceiling has to be written before starting — and rewritten every call,
  // because a completed effect restores whatever peak it last ran with.
  effect.alpha = Phaser.Math.Clamp(peakAlpha, 0, MAX_FLASH_ALPHA);
  effect.start(durationMs, c.r, c.g, c.b, false);
}

/** Squash-and-stretch punch. Returns the tween so callers can chain. */
export function pop(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.GameObject & { scaleX: number; scaleY: number },
  amount = 0.25,
  durationMs = 180,
): Phaser.Tweens.Tween {
  const sx = target.scaleX;
  const sy = target.scaleY;
  return scene.tweens.add({
    targets: target,
    scaleX: sx * (1 + amount),
    scaleY: sy * (1 - amount * 0.5),
    duration: durationMs * 0.35,
    yoyo: true,
    ease: 'Quad.easeOut',
    onComplete: () => {
      target.scaleX = sx;
      target.scaleY = sy;
    },
  });
}

/** Rising, fading score/damage number. */
export function floatText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  color: string = CSS.accent,
  size = 44,
): void {
  const text = scene.add
    .text(x, y, label, { fontFamily: FONT.display, fontSize: `${size}px`, color })
    .setOrigin(0.5)
    .setDepth(900);
  scene.tweens.add({
    targets: text,
    y: y - 110,
    alpha: 0,
    scale: 1.25,
    duration: 620,
    ease: 'Cubic.easeOut',
    onComplete: () => text.destroy(),
  });
}

/** One-shot particle burst at a point. */
export function burst(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: number = PALETTE.accent,
  count = 14,
  speed = 320,
): void {
  const emitter = scene.add.particles(x, y, TEX.particle, {
    speed: { min: speed * 0.4, max: speed },
    lifespan: { min: 220, max: 520 },
    scale: { start: 1.1, end: 0 },
    alpha: { start: 1, end: 0 },
    tint: color,
    blendMode: 'ADD',
    emitting: false,
  });
  emitter.setDepth(880);
  emitter.explode(count);
  scene.time.delayedCall(700, () => emitter.destroy());
}

/**
 * Plays a generated one-shot FX animation at a point (hit spark, level-up
 * shockwave) and destroys the sprite when it finishes. Prefer this over a
 * particle burst whenever real art exists for the effect: it carries the
 * project's art style, particles do not.
 */
export function playFx(
  scene: Phaser.Scene,
  key: string,
  x: number,
  y: number,
  size = 96,
  depth = 890,
): void {
  if (!scene.anims.exists(key)) return;
  const fx = scene.add
    .sprite(x, y, key)
    .setDisplaySize(size, size)
    .setDepth(depth)
    .setBlendMode(Phaser.BlendModes.ADD);
  fx.play(key);
  fx.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => fx.destroy());
}

/**
 * Hitstop: freezes gameplay time for a few frames so impacts land. Scene time
 * scale is restored automatically, tweens/timers included.
 */
export function hitstop(scene: Phaser.Scene, durationMs = 70, slow = 0.05): void {
  buzz(18);
  scene.time.timeScale = slow;
  scene.tweens.timeScale = slow;
  scene.physics.world.timeScale = 1 / Math.max(slow, 0.0001);
  scene.time.delayedCall(durationMs * slow, () => {
    scene.time.timeScale = 1;
    scene.tweens.timeScale = 1;
    scene.physics.world.timeScale = 1;
  });
}

/** Counts a displayed number up/down instead of snapping — reads as "reward". */
export function countTo(
  scene: Phaser.Scene,
  text: Phaser.GameObjects.Text,
  from: number,
  to: number,
  durationMs = 420,
  format: (value: number) => string = (v) => `${Math.round(v)}`,
): void {
  const holder = { value: from };
  scene.tweens.add({
    targets: holder,
    value: to,
    duration: durationMs,
    ease: 'Cubic.easeOut',
    onUpdate: () => text.setText(format(holder.value)),
    onComplete: () => text.setText(format(to)),
  });
}

type Movable = Phaser.GameObjects.GameObject & { x: number; y: number; alpha: number };

/**
 * Slide-in entrance for INERT DECOR ONLY — headings, labels, panels, art.
 *
 * DO NOT USE ON ANYTHING TAPPABLE. This tweens the object's own `y`, and
 * Phaser hit-tests against the live transform, so the tap target slides with
 * the pixels and — because `alpha` starts at 0, which clears `willRender` —
 * the control is not in the hit map at all until the tween moves it off zero.
 * Measured on the 2026-08-29 build: the primary CTA ate the first 1-3 taps
 * across four cold starts, plus one 300s automated hang tapping the button's
 * final rest position.
 *
 * For interactive objects use `ui/entrance.ts`'s `enterPinningHitArea`, which
 * runs the same slide with the hit areas pinned at their landing rects.
 */
export function enterFromBottom(
  scene: Phaser.Scene,
  target: Movable,
  delayMs = 0,
  distance = 80,
): void {
  const endY = target.y;
  target.y = endY + distance;
  target.alpha = 0;
  scene.tweens.add({
    targets: target,
    y: endY,
    alpha: 1,
    duration: 380,
    delay: delayMs,
    ease: 'Back.easeOut',
  });
}

/**
 * Infinite idle breathing — keeps menus from looking like a static PNG.
 *
 * Same hit-area caveat as `enterFromBottom`, permanently: this tweens `y`, so
 * an interactive target's tap rect breathes with it and is up to `amplitude` px
 * off its painted position at any moment. Bob the DECOR (a logo, a plate, an
 * illustration), not the control; if a control has to breathe, bob a child
 * sprite and leave the interactive parent still.
 */
export function idleBob(
  scene: Phaser.Scene,
  target: Movable,
  amplitude = 10,
  durationMs = 1600,
): void {
  scene.tweens.add({
    targets: target,
    y: target.y - amplitude,
    duration: durationMs,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
  });
}

/**
 * Scrolling parallax background built from the gradient texture plus drifting
 * dots. Call once in `create`; returns nothing to manage.
 */
export function starfield(scene: Phaser.Scene, count = 60, speed = 40): void {
  for (let i = 0; i < count; i += 1) {
    const x = Phaser.Math.Between(0, VIEW.width);
    const y = Phaser.Math.Between(0, VIEW.height);
    const depth = Phaser.Math.FloatBetween(0.3, 1);
    const dot = scene.add
      .image(x, y, TEX.particle)
      .setScale(depth * 0.5)
      .setAlpha(depth * 0.5)
      .setTint(PALETTE.primary)
      .setDepth(-100);
    scene.tweens.add({
      targets: dot,
      y: VIEW.height + 20,
      duration: ((VIEW.height + 20 - y) / (speed * depth)) * 1000,
      repeat: -1,
      onRepeat: () => {
        dot.y = -20;
        dot.x = Phaser.Math.Between(0, VIEW.width);
      },
    });
  }
}
