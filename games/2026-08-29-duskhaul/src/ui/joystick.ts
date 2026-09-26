import Phaser from 'phaser';
import { PALETTE, SAFE, TUNING, VIEW } from '../config';
import { DEEP_INK, IDENTITY } from './duskChrome';

/**
 * §14.3's authored alpha for the live stick — the same value for ring and thumb
 * so the control never out-values the actors it is steering. Idle is 0, not a
 * dimmed ring: §14.3 reserves the band with "no persistent chrome".
 *
 * `TUNING.joystick` carries no alpha keys any more. It used to hold the
 * template's 0.28/0.75 pair, which this file refused and nothing else read, so
 * the config invited a retune that could not take effect.
 */
const ACTIVE_ALPHA = 0.35;

/**
 * On-screen thumb joystick for portrait games: the movement verb for anything
 * where the player steers continuously (survivor-like, twin-stick, roguelike).
 *
 * Floating: the base jumps to wherever the thumb lands anywhere on the
 * playfield BELOW the HUD band (y ≥ `SAFE.top`, PRD-V2 §14.1/§14.14), so the
 * player never has to find a fixed pad. A press that lands on an interactive
 * UI object (belt buttons, minimap, bag widget, a tappable toast) belongs to
 * that object and never arms the stick (§14.1 "consume pointer before
 * joystick"). It renders NOTHING while idle; the `move` coach beat
 * (`ui/coachBeats.ts`) is the authored teacher and its copy names this zone.
 *
 * Drawn with primitives (`Graphics`), so it scales with `TUNING.joystick`; its
 * tones come from the §14.4 chrome spec (`#7e7376` on `#03040b`), not from
 * `PALETTE` — no art asset, no nine-slice.
 *
 * Read `vector` (already scaled by `strength`) from the scene's `update`; it is
 * a reused object, never allocated per frame.
 *
 * Use for: continuous movement with one thumb.
 * Do NOT use for: tap/swipe-only designs (see `core/controls.ts`) or games whose
 * play field extends into the bottom third of the screen.
 */
export class Joystick {
  /** Direction times throttle, both axes in -1..1. Reused — do not store it. */
  readonly vector = { x: 0, y: 0 };
  /** True while a thumb is on the stick. */
  active = false;

  private readonly scene: Phaser.Scene;
  private readonly base: Phaser.GameObjects.Graphics;
  private readonly knob: Phaser.GameObjects.Graphics;
  private readonly homeX: number;
  private readonly homeY: number;
  private readonly radius: number;
  private readonly knobRadius: number;
  private readonly deadzone: number;
  private baseX: number;
  private baseY: number;
  private pointerId = -1;
  private enabled = true;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.radius = TUNING.joystick.radius;
    this.knobRadius = TUNING.joystick.knobRadius;
    this.deadzone = TUNING.joystick.deadzone;
    this.homeX = TUNING.joystick.homeX;
    this.homeY = VIEW.height - TUNING.joystick.homeBottom;
    this.baseX = this.homeX;
    this.baseY = this.homeY;

    this.base = scene.add.graphics().setDepth(1200).setScrollFactor(0);
    this.knob = scene.add.graphics().setDepth(1201).setScrollFactor(0);
    this.paintBase();
    this.paintKnob();
    this.setIdleAlpha();

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  destroy(): void {
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
  }

  /**
   * The whole playfield below the HUD band is stick input (PRD-V2 §14.14: the
   * move beat's copy must match the zone). The HUD band itself is widgets.
   */
  private inControlZone(y: number): boolean {
    return y >= SAFE.top;
  }

  /**
   * Modal overlays (upgrade draft, pause, shop) cover the control zone, so the
   * stick must stand down while one is open or a card tap also steers.
   *
   * Re-enabling ADOPTS a thumb that is already on the glass. `onDown` was the
   * only arm site, so a pointer already held at the moment the stick came back
   * produced no further POINTER_DOWN and the stick stayed dead until the player
   * lifted and pressed again — input the game had swallowed. Two places that
   * bit: closing a draft with the thumb still down left the player unable to
   * move out of whatever had surrounded them, and the `tut:stick` FTUE beat,
   * which dismisses on the taught drag and on nothing else, HUNG FOREVER for
   * any first-time player already touching the screen when it opened — beat 2
   * of 3 on a wiped save.
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.release();
      return;
    }
    const pointer = this.scene.input.activePointer;
    if (pointer.isDown) this.arm(pointer);
  }

  private onDown(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    // A UI control under the thumb consumes the press (belt, minimap, bag).
    if (over.length > 0) return;
    this.arm(pointer);
  }

  /**
   * Binds the stick to a pointer and jumps the floating base under it. Shared by
   * the press path and the adopt-on-enable path, so both obey the same three
   * refusals (disabled, already bound, outside the control zone).
   */
  private arm(pointer: Phaser.Input.Pointer): void {
    if (!this.enabled || this.active || !this.inControlZone(pointer.y)) return;
    this.active = true;
    this.pointerId = pointer.id;
    this.baseX = Phaser.Math.Clamp(pointer.x, this.radius + 8, VIEW.width - this.radius - 8);
    this.baseY = Phaser.Math.Clamp(pointer.y, this.radius + 8, VIEW.height - this.radius - 8);
    this.base.setPosition(this.baseX, this.baseY).setAlpha(ACTIVE_ALPHA);
    this.knob.setPosition(this.baseX, this.baseY).setAlpha(ACTIVE_ALPHA);
    this.updateVector(pointer.x, pointer.y);
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    if (!this.active || pointer.id !== this.pointerId) return;
    this.updateVector(pointer.x, pointer.y);
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    if (!this.active || pointer.id !== this.pointerId) return;
    this.release();
  }

  /** Drops the stick back home and zeroes movement. */
  private release(): void {
    this.active = false;
    this.pointerId = -1;
    this.vector.x = 0;
    this.vector.y = 0;
    this.baseX = this.homeX;
    this.baseY = this.homeY;
    this.base.setPosition(this.homeX, this.homeY);
    this.knob.setPosition(this.homeX, this.homeY);
    this.setIdleAlpha();
  }

  private updateVector(px: number, py: number): void {
    const dx = px - this.baseX;
    const dy = py - this.baseY;
    const dist = Math.hypot(dx, dy);

    if (dist <= this.deadzone) {
      this.vector.x = 0;
      this.vector.y = 0;
      this.knob.setPosition(this.baseX, this.baseY);
      return;
    }

    // Throttle ramps from 0 at the deadzone edge to 1 at the base radius, so a
    // small nudge is a slow walk and the rim is full speed.
    const clamped = Math.min(dist, this.radius);
    const throttle = (clamped - this.deadzone) / (this.radius - this.deadzone);
    this.vector.x = (dx / dist) * throttle;
    this.vector.y = (dy / dist) * throttle;
    this.knob.setPosition(this.baseX + (dx / dist) * clamped, this.baseY + (dy / dist) * clamped);
  }

  /**
   * §14.3: "Bottom 220px (y 1060-1280): virtual joystick region, NO PERSISTENT
   * CHROME — the dynamic joystick ring renders at `#7e7376` alpha 0.35 only
   * while a touch is active." The template's idle hint ring is therefore off,
   * not dimmed: the arena's generated floor fills the band, and a permanent
   * green disc sitting on it was both unauthorised chrome and the brightest
   * thing in the bottom third of the frame.
   *
   * Discoverability is not lost — the `move` coach toast (`ui/coachBeats.ts`)
   * is the authored teacher for this control.
   */
  private setIdleAlpha(): void {
    this.base.setAlpha(0);
    this.knob.setAlpha(0);
  }

  private paintBase(): void {
    this.base.clear();
    this.base.fillStyle(DEEP_INK, 0.45);
    this.base.fillCircle(0, 0, this.radius);
    this.base.lineStyle(4, IDENTITY.cooled, 1);
    this.base.strokeCircle(0, 0, this.radius);
    this.base.lineStyle(2, IDENTITY.cooled, 0.5);
    this.base.strokeCircle(0, 0, this.deadzone);
    this.base.setPosition(this.homeX, this.homeY);
  }

  private paintKnob(): void {
    this.knob.clear();
    this.knob.fillStyle(IDENTITY.cooled, 0.9);
    this.knob.fillCircle(0, 0, this.knobRadius);
    this.knob.lineStyle(3, PALETTE.ink, 0.7);
    this.knob.strokeCircle(0, 0, this.knobRadius);
    this.knob.setPosition(this.homeX, this.homeY);
  }
}
