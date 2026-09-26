import Phaser from 'phaser';
import { CSS, TEXT, bareText } from '../config';
import { sfx } from '../core/audio';
import { HUD_DEPTH, PANEL, drawDuskPanel } from './duskChrome';

/**
 * The run's toast lane (PRD-V2 §14.1 playfield row, §14.9 "Toasts"): ONE rect
 * at (80, 360, 560, 88), max one visible, queued, 2.5 s each. Pickups
 * (`+ Gilt Chalice · 260 ◆`), bag swaps and every §14.14 coach beat share it,
 * which is what keeps the coach non-modal: a coach line is just a toast.
 *
 * A toast never blocks input unless it has an `onTap` (the swap toast opens the
 * bag quick-sheet); a tappable toast arms on its own POINTER_DOWN.
 */

const RECT = { x: 80, y: 360, width: 560, height: 88 } as const;

/**
 * Scene event a screen banner emits with its on-screen duration in ms
 * (`scene.events.emit(BANNER_EVENT, ms)`): the toast lane hides and holds its
 * queue for that long, so a toast never stacks on a boss/gate/Collapse banner
 * in the same band (critic M1). `Hud` creates the lane at run start
 * (`ensureToastLane`), so the first banner is heard too.
 */
export const BANNER_EVENT = 'ui-banner';
const DEFAULT_MS = 2500;
/** A sticky (`ms: null`) toast yields to a queued one after this long on screen. */
const STICKY_YIELD_MS = 6000;
const FADE_MS = 160;
/** Toasts below this depth sit under the draft/pause modal stack (2000+). */
const DEPTH = HUD_DEPTH.channelBar + 10;

export interface ToastOptions {
  text: string;
  /** Stroke tone of the plate; default neutral chrome. */
  tone?: number;
  /** Lifetime in ms; `null` = stays until `dismiss()` (condition-dismissed coach beats). */
  ms?: number | null;
  onTap?: () => void;
  /** Dedup key: a queued toast with the same key is replaced, not stacked. */
  key?: string;
}

export interface ToastHandle {
  dismiss(): void;
  readonly done: boolean;
  /** True once it has been on screen (a queued toast replaced by `key` never is). */
  readonly shown: boolean;
}

interface Entry {
  opts: ToastOptions;
  handle: ToastHandle & { done: boolean; shown: boolean };
  view: Phaser.GameObjects.Container | null;
  timer: Phaser.Time.TimerEvent | null;
}

class ToastLane {
  private readonly queue: Entry[] = [];
  private live: Entry | null = null;
  private destroyed = false;
  /** Modal overlays (draft, pause) open; the lane hides and its clock stops. */
  private suspended = 0;

  /** Banner hold (critic M1): the lane stays suspended until this timer fires. */
  private holdTimer: Phaser.Time.TimerEvent | null = null;
  private holdUntil = 0;
  private readonly onBanner = (ms: number): void => this.hold(ms);

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.on(BANNER_EVENT, this.onBanner);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** Suspends the lane for `ms` (extends a running hold, never stacks two). */
  hold(ms: number): void {
    if (this.destroyed || ms <= 0) return;
    const until = this.scene.time.now + ms;
    if (until <= this.holdUntil) return;
    this.holdUntil = until;
    if (this.holdTimer === null) this.suspend(true);
    else this.holdTimer.remove(false);
    this.holdTimer = this.scene.time.delayedCall(until - this.scene.time.now, () => {
      this.holdTimer = null;
      this.holdUntil = 0;
      this.suspend(false);
    });
  }

  push(opts: ToastOptions): ToastHandle {
    if (opts.key !== undefined) {
      const i = this.queue.findIndex((e) => e.opts.key === opts.key);
      const replaced = this.queue[i];
      if (replaced !== undefined) {
        replaced.handle.done = true;
        this.queue.splice(i, 1);
      }
    }
    const entry: Entry = {
      opts,
      view: null,
      timer: null,
      handle: {
        done: false,
        shown: false,
        dismiss: () => this.finish(entry),
      },
    };
    this.queue.push(entry);
    // A sticky toast whose yield window already passed gives way now.
    const live = this.live;
    if (live !== null && live.timer === null && live.opts.ms === null) this.finish(live);
    this.pump();
    return entry.handle;
  }

  /** True while a toast is on screen (the compass keeps its chips out of the lane). */
  get showing(): boolean {
    return this.live !== null && this.suspended === 0;
  }

  suspend(on: boolean): void {
    if (this.destroyed) return;
    this.suspended = Math.max(0, this.suspended + (on ? 1 : -1));
    const hidden = this.suspended > 0;
    const live = this.live;
    if (live !== null) {
      live.view?.setVisible(!hidden);
      if (live.timer !== null) live.timer.paused = hidden;
    }
    if (!hidden) this.pump();
  }

  private pump(): void {
    if (this.destroyed || this.live !== null || this.suspended > 0) return;
    const next = this.queue.shift();
    if (next === undefined) return;
    this.live = next;
    next.handle.shown = true;
    next.view = this.build(next);
    const ms = next.opts.ms === undefined ? DEFAULT_MS : next.opts.ms;
    // A condition-dismissed (sticky) toast must not starve the lane: after
    // STICKY_YIELD_MS on screen it gives way to anything queued behind it
    // (measured: the move coach line held back every pickup/BAG FULL toast).
    next.timer = this.scene.time.delayedCall(ms ?? STICKY_YIELD_MS, () => {
      if (ms !== null || this.queue.length > 0) this.finish(next);
      else next.timer = null;
    });
  }

  private build(entry: Entry): Phaser.GameObjects.Container {
    const { scene } = this;
    const plate = drawDuskPanel(scene, RECT.width, RECT.height, {
      stroke: entry.opts.tone ?? PANEL.stroke,
      strokeAlpha: 0.95,
    });
    const label = scene.add
      .text(0, 0, entry.opts.text, {
        ...TEXT.body,
        fontSize: '26px',
        color: CSS.ink,
        align: 'center',
        wordWrap: { width: RECT.width - 40 },
        maxLines: 2,
        ...bareText(),
      })
      .setOrigin(0.5);
    const root = scene.add
      .container(RECT.x + RECT.width / 2, RECT.y + RECT.height / 2, [plate, label])
      .setScrollFactor(0)
      .setDepth(DEPTH)
      .setAlpha(0);
    const onTap = entry.opts.onTap;
    if (onTap !== undefined) {
      root.setSize(RECT.width, RECT.height).setInteractive({ useHandCursor: true });
      let armed = false;
      root.on(Phaser.Input.Events.POINTER_DOWN, () => {
        armed = true;
        root.setScale(0.97);
      });
      root.on(Phaser.Input.Events.POINTER_OUT, () => {
        armed = false;
        root.setScale(1);
      });
      root.on(Phaser.Input.Events.POINTER_UP, () => {
        root.setScale(1);
        if (!armed) return;
        armed = false;
        sfx('ui');
        this.finish(entry);
        onTap();
      });
    }
    scene.tweens.add({ targets: root, alpha: 1, duration: FADE_MS, ease: 'Quad.easeOut' });
    return root;
  }

  private finish(entry: Entry): void {
    if (entry.handle.done) return;
    entry.handle.done = true;
    entry.timer?.remove(false);
    entry.timer = null;
    const qi = this.queue.indexOf(entry);
    if (qi >= 0) this.queue.splice(qi, 1);
    if (this.live !== entry) return;
    this.live = null;
    const view = entry.view;
    entry.view = null;
    if (view !== null && !this.destroyed) {
      view.disableInteractive();
      this.scene.tweens.add({
        targets: view,
        alpha: 0,
        duration: FADE_MS,
        onComplete: () => view.destroy(),
      });
    } else view?.destroy();
    this.pump();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(BANNER_EVENT, this.onBanner);
    this.holdTimer?.remove(false);
    this.holdTimer = null;
    for (const e of this.queue) e.handle.done = true;
    this.queue.length = 0;
    if (this.live !== null) {
      this.live.handle.done = true;
      this.live.timer?.remove(false);
      this.live.view?.destroy();
      this.live = null;
    }
    lanes.delete(this.scene);
  }
}

const lanes = new Map<Phaser.Scene, ToastLane>();

function laneFor(scene: Phaser.Scene): ToastLane {
  let lane = lanes.get(scene);
  if (lane === undefined) {
    lane = new ToastLane(scene);
    lanes.set(scene, lane);
  }
  return lane;
}

/** Queues a toast in the scene's single toast lane. */
export function showToast(scene: Phaser.Scene, opts: ToastOptions): ToastHandle {
  return laneFor(scene).push(opts);
}

/**
 * Modal overlays call this on open (`true`) and close (`false`); nested opens
 * count. While suspended the live toast is hidden with its timer frozen and
 * nothing new is shown, so a toast never sits under/over a draft or pause.
 */
export function suspendToasts(scene: Phaser.Scene, on: boolean): void {
  laneFor(scene).suspend(on);
}

/**
 * Creates the scene's lane up front so it hears `BANNER_EVENT` before the first
 * toast (`Hud` calls this in its constructor).
 */
export function ensureToastLane(scene: Phaser.Scene): void {
  laneFor(scene);
}

/** Holds the toast lane for `ms` (banner on screen). Same as emitting `BANNER_EVENT`. */
export function holdToasts(scene: Phaser.Scene, ms: number): void {
  laneFor(scene).hold(ms);
}

/** True while a toast is visible. */
export function toastShowing(scene: Phaser.Scene): boolean {
  return lanes.get(scene)?.showing === true;
}

/** §14.9 toast lane rect (design px). */
export const TOAST_RECT = RECT;
