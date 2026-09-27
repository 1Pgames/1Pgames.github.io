import Phaser from 'phaser';
import { unlockAudio } from './audio';

export type SwipeDir = 'up' | 'down' | 'left' | 'right';

interface ControlHandlers {
  /** Quick press with little movement — the primary action on mobile. */
  onTap?: (x: number, y: number) => void;
  /** Directional flick. Threshold is 60px / 350ms by default. */
  onSwipe?: (dir: SwipeDir) => void;
  onHoldStart?: (x: number, y: number) => void;
  onHoldEnd?: (x: number, y: number) => void;
  /** Pointer moved while pressed. dx/dy are since the previous move event. */
  onDrag?: (x: number, y: number, dx: number, dy: number) => void;
}

/**
 * One input surface for touch, mouse and keyboard so gameplay code never
 * branches on device. Instantiate once in `create`, read `axisX/axisY` in
 * `update`, and pass callbacks for discrete actions.
 *
 *   this.controls = new Controls(this, { onTap: () => this.player.jump() });
 *   // update(): this.player.move(this.controls.axisX);
 */
export class Controls {
  /** -1..1 horizontal intent (A/D, arrows, or pointer side-of-screen while held). */
  axisX = 0;
  /** -1..1 vertical intent. */
  axisY = 0;
  /** True while any pointer or the action key is held. */
  isDown = false;
  /** Latest pointer position in world coordinates. */
  pointerX = 0;
  pointerY = 0;

  private readonly scene: Phaser.Scene;
  private readonly handlers: ControlHandlers;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private downAt = 0;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;

  private static readonly TAP_MAX_MS = 260;
  private static readonly TAP_MAX_DIST = 24;
  private static readonly SWIPE_MIN_DIST = 60;
  private static readonly SWIPE_MAX_MS = 400;

  constructor(scene: Phaser.Scene, handlers: ControlHandlers = {}) {
    this.scene = scene;
    this.handlers = handlers;

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.handleDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.handleMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.handleUp, this);

    const kb = scene.input.keyboard;
    if (kb) {
      this.keys = kb.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT,SPACE,ESC,P,M') as Record<
        string,
        Phaser.Input.Keyboard.Key
      >;
    }

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  /** Call from the scene's `update`. Keeps axes in sync with held keys. */
  update(): void {
    const k = this.keys;
    const left = this.held(k['A']) || this.held(k['LEFT']);
    const right = this.held(k['D']) || this.held(k['RIGHT']);
    const up = this.held(k['W']) || this.held(k['UP']);
    const down = this.held(k['S']) || this.held(k['DOWN']);
    this.axisX = (right ? 1 : 0) - (left ? 1 : 0);
    this.axisY = (down ? 1 : 0) - (up ? 1 : 0);
  }

  /** True on the frame a key transitions to down. */
  justPressed(key: 'SPACE' | 'ESC' | 'P' | 'M'): boolean {
    const k = this.keys[key];
    return k !== undefined && Phaser.Input.Keyboard.JustDown(k);
  }

  destroy(): void {
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.handleDown, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.handleMove, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.handleUp, this);
  }

  private held(key: Phaser.Input.Keyboard.Key | undefined): boolean {
    return key !== undefined && key.isDown;
  }

  private handleDown(pointer: Phaser.Input.Pointer): void {
    unlockAudio(); // first gesture — required for WebAudio
    this.isDown = true;
    this.downAt = this.scene.time.now;
    this.downX = pointer.worldX;
    this.downY = pointer.worldY;
    this.lastX = pointer.worldX;
    this.lastY = pointer.worldY;
    this.pointerX = pointer.worldX;
    this.pointerY = pointer.worldY;
    this.handlers.onHoldStart?.(pointer.worldX, pointer.worldY);
  }

  private handleMove(pointer: Phaser.Input.Pointer): void {
    this.pointerX = pointer.worldX;
    this.pointerY = pointer.worldY;
    if (!this.isDown) return;
    const dx = pointer.worldX - this.lastX;
    const dy = pointer.worldY - this.lastY;
    this.lastX = pointer.worldX;
    this.lastY = pointer.worldY;
    this.handlers.onDrag?.(pointer.worldX, pointer.worldY, dx, dy);
  }

  private handleUp(pointer: Phaser.Input.Pointer): void {
    if (!this.isDown) return;
    this.isDown = false;
    const dt = this.scene.time.now - this.downAt;
    const dx = pointer.worldX - this.downX;
    const dy = pointer.worldY - this.downY;
    const dist = Math.hypot(dx, dy);

    this.handlers.onHoldEnd?.(pointer.worldX, pointer.worldY);

    if (dt <= Controls.TAP_MAX_MS && dist <= Controls.TAP_MAX_DIST) {
      this.handlers.onTap?.(pointer.worldX, pointer.worldY);
      return;
    }
    if (dt <= Controls.SWIPE_MAX_MS && dist >= Controls.SWIPE_MIN_DIST) {
      const horizontal = Math.abs(dx) > Math.abs(dy);
      const dir: SwipeDir = horizontal
        ? dx > 0
          ? 'right'
          : 'left'
        : dy > 0
          ? 'down'
          : 'up';
      this.handlers.onSwipe?.(dir);
    }
  }
}
