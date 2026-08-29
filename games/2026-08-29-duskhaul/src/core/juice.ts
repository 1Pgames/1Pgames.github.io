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

/**
 * Scene-wide spam gate for the §13 juice table's per-second caps.
 *
 * §13 authors caps as rates ("4/s", "12 floatTexts/s scene-wide", "1 shake/s"),
 * and a rate cap has two possible readings: a refilling window budget, or a
 * minimum gap. This is the MINIMUM GAP, deliberately: a window budget spends
 * its whole allowance on the first frame of a kill spike and then starves the
 * next 900ms, so the effect fires 12 times on one frame and never again — the
 * exact "20 things on one frame" the tempo rules forbid. A gap spreads the same
 * budget across the second, which is also what the 20-40ms stagger rule wants.
 *
 * Keys are the §13 events themselves, as a closed union rather than free
 * strings: a typo in a cap key silently uncaps the effect, and a spam cap that
 * quietly stops capping is invisible until a Collapse frame drops to 20fps.
 * Timed off `performance.now()` rather than a scene clock, so hitstop (which
 * scales `scene.time`) cannot stretch a cap, and a scene restart cannot hand
 * out a fresh allowance mid-second.
 */
export type EffectCap =
  | 'enemy-die-sfx'
  | 'enemy-hit-sfx'
  | 'float'
  | 'flash'
  | 'shake'
  | 'hurt-sfx'
  | 'pickup-sfx'
  | 'relic-sfx'
  | 'overflow'
  | 'gate-closing-tick';

const lastFiredMs: Record<EffectCap, number> = {
  'enemy-die-sfx': -Infinity,
  'enemy-hit-sfx': -Infinity,
  float: -Infinity,
  flash: -Infinity,
  shake: -Infinity,
  'hurt-sfx': -Infinity,
  'pickup-sfx': -Infinity,
  'relic-sfx': -Infinity,
  overflow: -Infinity,
  'gate-closing-tick': -Infinity,
};

export function allowEffect(key: EffectCap, perSecond: number): boolean {
  const now = performance.now();
  if (now - lastFiredMs[key] < 1000 / perSecond) return false;
  lastFiredMs[key] = now;
  return true;
}

export function shake(scene: Phaser.Scene, intensity = 0.008, durationMs = 160): void {
  scene.cameras.main.shake(durationMs, intensity);
  buzz(12);
}

/**
 * Peak opacity a full-screen flash is ever allowed to reach.
 *
 * This used to be `cameras.main.flash()`, which is opaque at t=0 by
 * construction: for a frame or two the entire playfield IS the flash colour.
 * Harmless as a once-per-run death sting; ruinous as the response to every
 * player hit, which fires at up to ~1.4/s under sustained contact (120ms, or
 * 200ms below 30% hp, against 700ms of i-frames). Measured, roughly one frame
 * in six was a solid single colour during heavy contact — the frame-by-frame
 * reason the late game read as unplayable noise, and a photosensitivity hazard
 * at that rate.
 *
 * 0.38 is a wash: the damage read (§14.1 puts it above tempo) survives intact,
 * the arena underneath stays legible, and no frame is ever solid.
 */
const FLASH_MAX_ALPHA = 0.38;

/**
 * Scene-wide flash rate. Overlapping washes ADD, so two 0.38 quads alive on one
 * frame would be the near-opaque frame this cap exists to prevent; at 2/s
 * against the 320ms longest flash in the game, two can never overlap.
 */
const FLASH_PER_SECOND = 2;

export interface FlashOptions {
  /** Peak opacity. Clamped to `FLASH_MAX_ALPHA` — a caller cannot opt out. */
  alpha?: number;
  /**
   * Skips the scene-wide rate gate. ONCE-PER-RUN beats only (death, extraction,
   * Last Gasp): those must not be swallowed by a hurt flash 200ms earlier.
   */
  force?: boolean;
}

/**
 * Full-screen colour wash. Use sparingly: damage, death, milestone.
 *
 * A screen-space quad rather than the camera effect, because the camera effect
 * exposes no way to cap its opacity (see `FLASH_MAX_ALPHA`). Depth 1140 — under
 * the HUD (1500) and under `edgeFlash` (1150), so a wash can never bury the
 * numbers the player is reading, which the camera effect always did.
 */
export function flash(
  scene: Phaser.Scene,
  color: number = PALETTE.bad,
  durationMs = 140,
  options: FlashOptions = {},
): void {
  if (options.force !== true && !allowEffect('flash', FLASH_PER_SECOND)) return;
  const peak = Math.min(options.alpha ?? FLASH_MAX_ALPHA, FLASH_MAX_ALPHA);
  const gfx = scene.add.graphics().setScrollFactor(0).setDepth(1140).setAlpha(peak);
  gfx.fillStyle(color, 1);
  gfx.fillRect(0, 0, VIEW.width, VIEW.height);
  scene.tweens.add({
    targets: gfx,
    alpha: { from: peak, to: 0 },
    duration: durationMs,
    ease: 'Quad.easeOut',
    onComplete: () => gfx.destroy(),
  });
}

/**
 * The 80ms white hit flash §13 authors for "enemy hit" ("white `flash` on
 * sprite"). A FILL-mode tint paints the sprite's silhouette solid white
 * regardless of its art, so one call reads on every body in the roster without
 * a per-enemy hit-spark sheet.
 *
 * Phaser 4: `setTintFill()` is gone (AGENTS.md §Phaser 4 traps) — the mode is
 * set explicitly, and explicitly put BACK to `MULTIPLY` on clear, because
 * `clearTint()` resets the colour and not the mode.
 *
 * On the AGENTS.md §Generated art rule "do not `setTint` a character sprite":
 * that rule is about art SUBSTITUTION — using a tint to express a state the
 * art should carry, which is why `objects/enemy.ts` draws the enrage rim as its
 * own object and `flashBoss` draws a bloom ring rather than washing the
 * Warden's crown out. Both of those are PERSISTENT reads held for seconds. An
 * 80ms impact flash is not a state, it is the acknowledgment of a frame, and
 * §13 authors it on the sprite in as many words.
 *
 * This deliberately replaces a particle burst on the hit path. A burst builds a
 * ParticleEmitter and tears it down 700ms later on EVERY connected hit, which
 * at the Warden beat is dozens of emitters a second — and §13 does not even ask
 * for particles there. The tint is one field write and one timer.
 *
 * Safe on a pooled body: `Enemy.reset` clears the tint when the sprite is
 * recycled, and a late clear on an already-recycled sprite clears a tint that
 * is already clear.
 */
export function hitFlash(
  scene: Phaser.Scene,
  sprite: Phaser.GameObjects.Sprite,
  durationMs = 80,
): void {
  sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
  scene.time.delayedCall(durationMs, () => {
    sprite.clearTint();
    sprite.setTintMode(Phaser.TintModes.MULTIPLY);
  });
}

/**
 * Screen-space announcement for the run's once-per-run beats — the Warden
 * taking station, the Collapse igniting. §13 asks for "banner text" on both,
 * and a world-space `floatText` is the wrong instrument: it rises off a body
 * the camera is about to leave behind, and both of these are statements about
 * the RUN, not about a point in the arena.
 *
 * Placed at y=350, inside §14.3's banner band (x 40-680 / y 300-400), which
 * `ui/channelBar.ts` documents as reserved for exactly these two beats plus
 * phase titles — and which is why the channel bar took its own band at 412-468
 * rather than sitting here.
 *
 * In on `Back.easeOut` (a launch), out on a straight fade after a hold: the
 * whole thing is 200 + hold + 240ms, so a 340ms hold keeps it inside the 700ms
 * ceremony ceiling without a skip path.
 */
export function banner(
  scene: Phaser.Scene,
  label: string,
  color: string = CSS.bad,
  holdMs = 340,
): void {
  const text = scene.add
    .text(VIEW.centerX, 350, label, { fontFamily: FONT.display, fontSize: '58px', color })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(1120)
    .setAlpha(0);
  /**
   * §14's side SAFE band is 40, so the usable width is 640. A long label at
   * 58px is wider than that — "BOLT STORM EVOLVED" measured 780px and ran off
   * BOTH edges in the browser — so the resting scale is whatever fits, and the
   * entrance and exit are expressed relative to it. Scaling beats wrapping
   * here: a two-line banner at y=350 would reach down into the channel bar's
   * 412-468 band, which is the one widget this must never cover.
   */
  const fit = Math.min(1, (VIEW.width - 80) / Math.max(1, text.width));
  text.setScale(fit * 0.8);
  scene.tweens.add({
    targets: text,
    alpha: 1,
    scale: fit,
    duration: 200,
    ease: 'Back.easeOut',
    onComplete: () => {
      scene.tweens.add({
        targets: text,
        alpha: 0,
        scale: fit * 1.12,
        duration: 240,
        delay: holdMs,
        ease: 'Quad.easeIn',
        onComplete: () => text.destroy(),
      });
    },
  });
}

/**
 * Violet EDGE flash — §13's "gate opens" visual. A full-screen `flash` is the
 * wrong instrument for a gate: it whites out the fight you are in the middle
 * of, and this game fires it while 40 bodies are on screen. This lights the
 * four screen borders instead, so the news arrives in peripheral vision and the
 * playfield stays legible.
 *
 * One Graphics built, tweened and destroyed per call — a gate opens three times
 * a run, so this is not a hot path.
 */
export function edgeFlash(
  scene: Phaser.Scene,
  color: number = PALETTE.secondary,
  durationMs = 200,
  band = 110,
): void {
  const gfx = scene.add.graphics().setScrollFactor(0).setDepth(1150).setAlpha(0);
  gfx.fillStyle(color, 1);
  gfx.fillRect(0, 0, VIEW.width, band);
  gfx.fillRect(0, VIEW.height - band, VIEW.width, band);
  gfx.fillRect(0, 0, band, VIEW.height);
  gfx.fillRect(VIEW.width - band, 0, band, VIEW.height);
  scene.tweens.add({
    targets: gfx,
    alpha: { from: 0, to: 0.55 },
    // In on a launch curve, out on a landing curve: the news snaps on and
    // decays, which is what an opening door sounds like.
    duration: durationMs * 0.3,
    ease: 'Quad.easeIn',
    yoyo: true,
    hold: 0,
    onComplete: () => gfx.destroy(),
  });
}

/**
 * Screen-space toast — §13's "bag overflow drop" needs a message the player
 * reads while looking at the HUD, not a world-space floater over a body that
 * is about to walk off camera.
 */
export function toast(
  scene: Phaser.Scene,
  label: string,
  color: string = CSS.warn,
  y = 560,
  durationMs = 300,
): void {
  const text = scene.add
    .text(VIEW.centerX, y, label, { fontFamily: FONT.display, fontSize: '34px', color })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(1140)
    .setAlpha(0);
  scene.tweens.add({
    targets: text,
    alpha: 1,
    y: y - 26,
    duration: durationMs,
    ease: 'Back.easeOut',
    onComplete: () => {
      scene.tweens.add({
        targets: text,
        alpha: 0,
        duration: 260,
        delay: 620,
        ease: 'Quad.easeIn',
        onComplete: () => text.destroy(),
      });
    },
  });
}

/**
 * Drains the colour out of the camera — §13's death visual. Ramped rather than
 * snapped, so the moment reads as the world going out rather than as a shader
 * bug, and left in place: the caller is about to leave the scene.
 *
 * Phaser 4 removed `postFX` (AGENTS.md §Phaser 4 traps): this is the Filters
 * API, and `filters.internal` is the right half — an INTERNAL filter runs on
 * what the camera drew, so the HUD drawn by the same camera desaturates with
 * the arena instead of staying colour-correct over a grey world.
 *
 * `hitstop` scales `scene.tweens.timeScale`, and death does both at once, so
 * the ramp is driven from a tween deliberately: it slows down with the freeze
 * rather than racing ahead of it.
 */
export function desaturate(scene: Phaser.Scene, durationMs = 420): void {
  const filter = scene.cameras.main.filters.internal.addColorMatrix();
  const matrix = filter.colorMatrix;
  const holder = { value: 0 };
  scene.tweens.add({
    targets: holder,
    value: 1,
    duration: durationMs,
    ease: 'Quad.easeOut',
    onUpdate: () => matrix.grayscale(holder.value, false),
    onComplete: () => matrix.grayscale(1, false),
  });
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

/**
 * Counts a displayed number up/down instead of snapping — reads as "reward".
 *
 * Returns the tween so a ceremony longer than the tempo budget can be SKIPPED
 * through the same code path it would have finished on: `tween.complete()`
 * runs `onComplete`, which is where the final value is written. A skip that
 * set the label itself would be a second source of truth for the number.
 */
export function countTo(
  scene: Phaser.Scene,
  text: Phaser.GameObjects.Text,
  from: number,
  to: number,
  durationMs = 420,
  format: (value: number) => string = (v) => `${Math.round(v)}`,
): Phaser.Tweens.Tween {
  const holder = { value: from };
  return scene.tweens.add({
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
 * Slide-in entrance for INERT chrome — headings, labels, stat lines, rows.
 *
 * NEVER use it on anything tappable. It tweens the object's own `y` from
 * `alpha: 0`, and Phaser hit-tests against the live transform and skips
 * hit-testing entirely while `willRender` is false: an 80px slide drags the tap
 * target along with the pixels, and the `delayMs` window leaves the control
 * absent from the hit map altogether. Measured cost on the menu was 1-3 taps to
 * start a run across four cold starts. `ui/entrance.ts` `enterPinningHitArea`
 * is the same slide, tempo and easing with the hit rects pinned at their final
 * position and the object kept renderable throughout — that is the one to use
 * for buttons, cards, chips and any other control.
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

/** Infinite idle breathing — keeps menus from looking like a static PNG. */
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
