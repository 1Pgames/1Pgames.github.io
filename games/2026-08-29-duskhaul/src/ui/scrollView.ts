import Phaser from 'phaser';
import { TAP_SLOP } from './button';

/**
 * Multi-camera routing + scissor-clipped scrolling (AGENTS.md "Scrolling lists
 * clip, they never hide"; Phaser 4 has no `setMask`, a camera viewport IS the
 * GPU scissor).
 *
 * Every TOP-LEVEL display object belongs to exactly one camera: registered
 * roots to their own camera, everything else to the main camera. Ownership is
 * re-applied as a camera-filter bitmask on every PRE_RENDER, so:
 * - objects added later (toasts, sheets, juice floaters) never render twice,
 * - a removed camera's id being REUSED by the next camera (the trap that
 *   blanked the V1 shop on re-entry) cannot leave stale filters behind — the
 *   mask is recomputed from the live camera list, never accumulated.
 * Children inside a container keep filter 0 and inherit their root's routing
 * (render AND input: `InputManager.inputCandidate` walks the parent chain).
 *
 * Camera creation order is the z-order: later cameras draw on top and are hit-
 * tested first, so a sheet opened after the hub list covers it.
 */
class CameraRouter {
  private readonly owners = new Map<Phaser.GameObjects.GameObject, Phaser.Cameras.Scene2D.Camera>();
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.sync, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.sync, this);
      this.owners.clear();
      ROUTERS.delete(scene);
    });
  }

  own(root: Phaser.GameObjects.GameObject, cam: Phaser.Cameras.Scene2D.Camera): void {
    this.owners.set(root, cam);
    this.sync();
  }

  release(root: Phaser.GameObjects.GameObject): void {
    this.owners.delete(root);
  }

  /** Recomputes every top-level object's camera filter from the live camera list. */
  sync(): void {
    const cams = this.scene.cameras.cameras;
    let all = 0;
    for (const cam of cams) all |= cam.id;
    const main = this.scene.cameras.main;
    for (const child of this.scene.children.list) {
      let owner = this.owners.get(child) ?? main;
      if (!cams.includes(owner)) owner = main;
      child.cameraFilter = all & ~owner.id;
    }
  }
}

const ROUTERS = new WeakMap<Phaser.Scene, CameraRouter>();

/** The scene's router, created on first use and torn down on SHUTDOWN. */
export function cameraRouter(scene: Phaser.Scene): CameraRouter {
  let router = ROUTERS.get(scene);
  if (router === undefined) {
    router = new CameraRouter(scene);
    ROUTERS.set(scene, router);
  }
  return router;
}

/**
 * The topmost camera under a pointer — the one that "owns" the gesture. A
 * scroll view reacts only when it is on top, so a sheet above it deafens it.
 */
function topCamera(scene: Phaser.Scene, pointer: Phaser.Input.Pointer): Phaser.Cameras.Scene2D.Camera | null {
  return scene.cameras.getCamerasBelowPointer(pointer)[0] ?? null;
}

export interface Rect { x: number; y: number; width: number; height: number }

/** Momentum friction per 16.7 ms frame, and the speed (px/ms) under which it stops. */
const FRICTION = 0.94;
const MIN_SPEED = 0.02;

/**
 * Vertical scroll band on its own scissor camera (identity world→screen).
 * Drag from ANYWHERE in the band — including on buttons, which fire only on a
 * tap with travel ≤ `TAP_SLOP` (`ui/button.ts bindTap`) — mouse wheel, and
 * release momentum. Content goes in `root` via `add()`, which restores scroll
 * factor 1 on the whole subtree (a `Button` pins itself at 0, which under an
 * offset camera would render shifted by the viewport origin).
 */
export class ScrollView {
  readonly root: Phaser.GameObjects.Container;
  readonly cam: Phaser.Cameras.Scene2D.Camera;
  readonly rect: Rect;
  private readonly scene: Phaser.Scene;
  private scroll = 0;
  private maxScroll = 0;
  private velocity = 0;
  private tracking = false;
  private dragging = false;
  private downY = 0;
  private lastY = 0;
  private lastT = 0;
  private destroyed = false;

  constructor(scene: Phaser.Scene, rect: Rect) {
    this.scene = scene;
    this.rect = rect;
    this.root = scene.add.container(rect.x, rect.y);
    this.cam = scene.cameras.add(rect.x, rect.y, rect.width, rect.height);
    this.cam.setScroll(rect.x, rect.y);
    cameraRouter(scene).own(this.root, this.cam);

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  /** Adds content and restores scroll factor 1 on the whole subtree. */
  add(...objs: Phaser.GameObjects.GameObject[]): void {
    for (const obj of objs) {
      this.root.add(obj);
      restoreScrollFactor(obj);
    }
  }

  /**
   * Restores scroll factor 1 on everything under `root` — content built
   * straight into `root` (tabs get the container, not the view) is fixed here,
   * which is why every (re)build ends in `setContentHeight`.
   */
  fixScrollFactors(): void {
    restoreScrollFactor(this.root);
  }

  /** Clears content (destroying it) and resets the scroll offset. */
  clear(): void {
    this.root.removeAll(true);
    this.velocity = 0;
    this.scrollTo(0);
  }

  setContentHeight(h: number): void {
    this.maxScroll = Math.max(0, h - this.rect.height);
    this.fixScrollFactors();
    this.scrollTo(this.scroll);
  }

  scrollTo(y: number): void {
    this.scroll = Phaser.Math.Clamp(y, 0, this.maxScroll);
    this.root.y = this.rect.y - this.scroll;
  }

  get offset(): number {
    return this.scroll;
  }

  /** True while the current gesture is a drag — tiles use it to suppress taps. */
  get isDragging(): boolean {
    return this.dragging;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const input = this.scene.input;
    input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    input.off(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    cameraRouter(this.scene).release(this.root);
    if (this.root.scene) this.root.destroy();
    this.scene.cameras.remove(this.cam, true);
  }

  private inside(pointer: Phaser.Input.Pointer): boolean {
    const r = this.rect;
    return pointer.x >= r.x && pointer.x <= r.x + r.width && pointer.y >= r.y && pointer.y <= r.y + r.height;
  }

  private onDown(pointer: Phaser.Input.Pointer): void {
    if (!this.inside(pointer) || topCamera(this.scene, pointer) !== this.cam) return;
    this.tracking = true;
    this.dragging = false;
    this.velocity = 0;
    this.downY = pointer.y;
    this.lastY = pointer.y;
    this.lastT = this.scene.time.now;
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    if (!this.tracking || !pointer.isDown) return;
    if (!this.dragging && Math.abs(pointer.y - this.downY) > TAP_SLOP) this.dragging = true;
    if (!this.dragging) return;
    const now = this.scene.time.now;
    const dy = pointer.y - this.lastY;
    const dt = Math.max(1, now - this.lastT);
    // Low-pass the release velocity so one jittery sample cannot fling the list.
    this.velocity = this.velocity * 0.6 + (-dy / dt) * 0.4;
    this.lastY = pointer.y;
    this.lastT = now;
    this.scrollTo(this.scroll - dy);
  }

  private onUp(): void {
    if (!this.tracking) return;
    this.tracking = false;
    // A drag that ended on a still finger carries no fling.
    if (!this.dragging || this.scene.time.now - this.lastT > 80) this.velocity = 0;
    this.dragging = false;
  }

  private onWheel(pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number): void {
    if (!this.inside(pointer) || topCamera(this.scene, pointer) !== this.cam) return;
    this.velocity = 0;
    this.scrollTo(this.scroll + dy);
  }

  private tick(_time: number, delta: number): void {
    if (this.tracking || this.velocity === 0) return;
    this.scrollTo(this.scroll + this.velocity * delta);
    this.velocity *= Math.pow(FRICTION, delta / 16.7);
    if (Math.abs(this.velocity) < MIN_SPEED || this.scroll <= 0 || this.scroll >= this.maxScroll) this.velocity = 0;
  }
}

function restoreScrollFactor(obj: Phaser.GameObjects.GameObject): void {
  const sf = obj as Partial<Phaser.GameObjects.Components.ScrollFactor>;
  sf.setScrollFactor?.(1, 1);
  const children = (obj as Partial<Phaser.GameObjects.Container>).list;
  if (Array.isArray(children)) for (const child of children) restoreScrollFactor(child);
}
