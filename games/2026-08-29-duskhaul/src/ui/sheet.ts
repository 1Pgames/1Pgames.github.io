/**
 * Bottom sheets, confirm dialogs and the action toast (PRD-V2 §14.2-14.8,
 * §14b; FlowAudit §3.1/§3.4).
 *
 * Every overlay lives on its OWN camera (`ui/scrollView.ts CameraRouter`):
 * camera creation order is z-order, so a sheet covers the hub's scissor list,
 * a confirm covers the sheet under it, and hit-testing follows the same order.
 *
 * Exit law: every sheet closes on ESC (top of the per-scene stack), scrim tap
 * and its 88×88 X. No slide tweens (§14.2 "no slide tweens", #17): sheets
 * cross-fade in 120 ms, so their controls sit at their final rects from frame
 * one.
 */
import Phaser from 'phaser';
import { CSS, PALETTE, TEXT, VIEW, bareText } from '../config';
import { sfx } from '../core/audio';
import { Button, bindTap } from './button';
import { BUTTON_STYLE, DEEP_INK, PANEL } from './duskChrome';
import { cameraRouter, ScrollView, type Rect } from './scrollView';

export interface SheetHandle {
  /** Content root to build into, positioned at the sheet's top-left. */
  content: Phaser.GameObjects.Container;
  close(): void;
}

export interface SheetOptions {
  height: number;
  onClose(): void;
  /** Header line drawn at the sheet top (y +40). */
  title?: string;
}

/** A sheet as built here: the frozen handle plus the sheet's own geometry and scroll hook. */
export interface HubSheet extends SheetHandle {
  /** Screen y of the sheet's top edge (`content` sits here). */
  readonly top: number;
  /** A scissor-clipped scroll band inside the sheet, destroyed with it. Rect in SCREEN px. */
  scroll(rect: Rect): ScrollView;
  readonly closed: boolean;
}

interface Closable {
  close(): void;
  /** Screen y of a sheet's top edge (sheets only) — toasts land above it. */
  readonly top?: number;
}

/** Per-scene ESC stack: ESC closes the most recently opened overlay. */
const STACKS = new WeakMap<Phaser.Scene, Closable[]>();

function stackFor(scene: Phaser.Scene): Closable[] {
  let stack = STACKS.get(scene);
  if (stack !== undefined) return stack;
  const fresh: Closable[] = [];
  STACKS.set(scene, fresh);
  const onEsc = (): void => {
    const top = fresh[fresh.length - 1];
    if (top !== undefined) top.close();
  };
  scene.input.keyboard?.on('keydown-ESC', onEsc);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.input.keyboard?.off('keydown-ESC', onEsc);
    fresh.length = 0;
    STACKS.delete(scene);
  });
  stack = fresh;
  return stack;
}

/** Closes every stacked overlay (tab switch, scene hand-off). */
export function closeAllOverlays(scene: Phaser.Scene): void {
  const stack = STACKS.get(scene);
  if (stack === undefined) return;
  for (let i = stack.length - 1; i >= 0; i--) stack[i]?.close();
}

const SHEET_DEPTH = 3000;
const SCRIM_ALPHA = 0.62;
const FADE_MS = 120;

function overlayCamera(scene: Phaser.Scene, root: Phaser.GameObjects.Container, rect: Rect): Phaser.Cameras.Scene2D.Camera {
  const cam = scene.cameras.add(rect.x, rect.y, rect.width, rect.height);
  cam.setScroll(rect.x, rect.y);
  cameraRouter(scene).own(root, cam);
  return cam;
}

/**
 * Full-width bottom sheet `opts.height` tall, anchored to the bottom of the
 * frame, over a dimming scrim. Scrim tap, ESC and the X all call `close()`,
 * which runs `onClose` exactly once.
 */
export function openSheet(scene: Phaser.Scene, opts: SheetOptions): HubSheet {
  const stack = stackFor(scene);
  const top = VIEW.height - opts.height;
  const root = scene.add.container(0, 0).setDepth(SHEET_DEPTH + stack.length);
  const cam = overlayCamera(scene, root, { x: 0, y: 0, width: VIEW.width, height: VIEW.height });
  const scrolls: ScrollView[] = [];

  const scrim = scene.add
    .rectangle(0, 0, VIEW.width, VIEW.height, DEEP_INK, SCRIM_ALPHA)
    .setOrigin(0, 0)
    .setInteractive();
  const panel = scene.add.graphics();
  panel.fillStyle(PANEL.fill, 1);
  panel.fillRoundedRect(0, top, VIEW.width, opts.height + 24, { tl: 24, tr: 24, bl: 0, br: 0 });
  panel.lineStyle(PANEL.strokeWidth, PANEL.stroke, PANEL.strokeAlpha);
  panel.strokeRoundedRect(1, top + 1, VIEW.width - 2, opts.height + 24, { tl: 24, tr: 24, bl: 0, br: 0 });
  // Drag handle: the affordance that says "this came up from below".
  panel.fillStyle(PALETTE.inkSoft, 0.6);
  panel.fillRoundedRect(VIEW.width / 2 - 40, top + 12, 80, 6, 3);
  // The panel swallows taps so a tap on the sheet body never reaches the scrim.
  const panelHit = scene.add
    .zone(0, top, VIEW.width, opts.height)
    .setOrigin(0, 0)
    .setInteractive();

  const content = scene.add.container(0, top);
  root.add([scrim, panel, panelHit, content]);

  if (opts.title !== undefined) {
    content.add(
      scene.add
        .text(40, 40, opts.title, { ...TEXT.button, fontSize: '30px', color: CSS.ink, ...bareText(), wordWrap: { width: 540 } })
        .setOrigin(0, 0),
    );
  }

  let closed = false;
  const handle: HubSheet = {
    content,
    top,
    get closed() {
      return closed;
    },
    scroll(rect: Rect): ScrollView {
      const view = new ScrollView(scene, rect);
      view.root.setDepth(SHEET_DEPTH + stack.length + 1);
      scrolls.push(view);
      return view;
    },
    close(): void {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(handle);
      if (i >= 0) stack.splice(i, 1);
      for (const view of scrolls) view.destroy();
      cameraRouter(scene).release(root);
      root.destroy();
      scene.cameras.remove(cam, true);
      opts.onClose();
    },
  };

  bindTap(scrim, () => handle.close());
  const closeX = closeButton(scene, VIEW.width - 64, top + 56, () => handle.close());
  root.add(closeX);

  root.setAlpha(0.001);
  scene.tweens.add({ targets: root, alpha: 1, duration: FADE_MS });
  stack.push(handle);
  return handle;
}

/** 88×88 close control (drawn X on a disc). */
function closeButton(scene: Phaser.Scene, x: number, y: number, onTap: () => void): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  const paint = (pressed: boolean): void => {
    g.clear();
    g.fillStyle(pressed ? 0x2c3848 : 0x19212e, 1);
    g.fillCircle(0, 0, 32);
    g.lineStyle(2, PANEL.stroke, 0.8);
    g.strokeCircle(0, 0, 32);
    g.lineStyle(5, PALETTE.ink, 1);
    g.lineBetween(-12, -12, 12, 12);
    g.lineBetween(12, -12, -12, 12);
  };
  paint(false);
  c.add(g);
  c.setSize(88, 88).setInteractive({ useHandCursor: true });
  bindTap(
    c,
    () => {
      sfx('ui');
      onTap();
    },
    paint,
  );
  return c;
}

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm(): void;
  onCancel?(): void;
}

/**
 * Two-button modal (FlowAudit §3.4): default = cancel — ESC and scrim tap
 * cancel, only the explicit confirm button commits.
 */
export function confirmDialog(scene: Phaser.Scene, opts: ConfirmOptions): Closable {
  const stack = stackFor(scene);
  const root = scene.add.container(0, 0).setDepth(SHEET_DEPTH + 50 + stack.length);
  const cam = overlayCamera(scene, root, { x: 0, y: 0, width: VIEW.width, height: VIEW.height });

  const scrim = scene.add.rectangle(0, 0, VIEW.width, VIEW.height, DEEP_INK, 0.7).setOrigin(0, 0).setInteractive();
  const w = 640;
  const bodyText = scene.add
    .text(VIEW.width / 2, 0, opts.body, {
      ...TEXT.body,
      fontSize: '26px',
      color: CSS.ink,
      ...bareText(),
      align: 'center',
      wordWrap: { width: w - 64 },
    })
    .setOrigin(0.5, 0);
  const h = 120 + bodyText.height + 140;
  const top = VIEW.height / 2 - h / 2;
  const panel = scene.add.graphics();
  panel.fillStyle(PANEL.fill, 1);
  panel.fillRoundedRect(40, top, w, h, 16);
  panel.lineStyle(2, opts.destructive === true ? PALETTE.bad : PANEL.stroke, 0.9);
  panel.strokeRoundedRect(40, top, w, h, 16);
  const panelHit = scene.add.zone(40, top, w, h).setOrigin(0, 0).setInteractive();
  const title = scene.add
    .text(VIEW.width / 2, top + 36, opts.title, { ...TEXT.button, fontSize: '34px', color: CSS.ink, ...bareText(), align: 'center', wordWrap: { width: w - 64 } })
    .setOrigin(0.5, 0);
  bodyText.setY(top + 100);
  root.add([scrim, panel, panelHit, title, bodyText]);

  let closed = false;
  const finish = (confirmed: boolean): void => {
    if (closed) return;
    closed = true;
    const i = stack.indexOf(handle);
    if (i >= 0) stack.splice(i, 1);
    cameraRouter(scene).release(root);
    root.destroy();
    scene.cameras.remove(cam, true);
    if (confirmed) opts.onConfirm();
    else opts.onCancel?.();
  };
  const handle: Closable = { close: () => finish(false) };

  const by = top + h - 70;
  const cancel = new Button(scene, 40 + 156, by, opts.cancelLabel ?? 'CANCEL', () => finish(false), {
    width: 292,
    height: 88,
    fontSize: '28px',
    ...BUTTON_STYLE.idle,
  });
  const ok = new Button(scene, 40 + w - 156, by, opts.confirmLabel, () => finish(true), {
    width: 292,
    height: 88,
    fontSize: '28px',
    ...(opts.destructive === true ? BUTTON_STYLE.destructive : BUTTON_STYLE.primary),
  });
  root.add([cancel, ok]);
  bindTap(scrim, () => finish(false));

  stack.push(handle);
  return handle;
}

export interface ToastOptions {
  actionLabel?: string;
  onAction?(): void;
  /** Auto-dismiss after this many ms (default 3000, the §14.7 UNDO window). */
  ms?: number;
  /**
   * Screen y centre of the toast. Default: just above the hub tab bar, or —
   * while a sheet is open — just above the topmost sheet, so a toast never
   * covers the sheet's own buttons (QA 10).
   */
  y?: number;
}

let activeToast: Closable | null = null;

/**
 * Non-modal 640×88 toast with an optional action (the §14.7 `UNDO`). Max one
 * visible; ESC dismisses it (the action does NOT run — "purchase stands",
 * §14b interruption row). Its camera covers only its own rect, so the hub list
 * under it keeps scrolling.
 */
export function actionToast(scene: Phaser.Scene, text: string, opts: ToastOptions = {}): Closable {
  activeToast?.close();
  const stack = stackFor(scene);
  let sheetTop: number | null = null;
  for (const entry of stack) if (entry.top !== undefined) sheetTop = entry.top;
  const cy = opts.y ?? (sheetTop === null ? 1060 : Math.max(184, sheetTop - 56));
  const rect: Rect = { x: 40, y: cy - 48, width: 640, height: 96 };
  const root = scene.add.container(0, 0).setDepth(SHEET_DEPTH + 90);
  const cam = overlayCamera(scene, root, rect);

  const g = scene.add.graphics();
  g.fillStyle(0x2c3848, 0.98);
  g.fillRoundedRect(rect.x, rect.y + 4, rect.width, 88, 12);
  g.lineStyle(2, PALETTE.accent, 0.8);
  g.strokeRoundedRect(rect.x, rect.y + 4, rect.width, 88, 12);
  const hasAction = opts.actionLabel !== undefined;
  const label = scene.add
    .text(rect.x + 24, cy, text, {
      ...TEXT.body,
      fontSize: '24px',
      color: CSS.ink,
      ...bareText(),
      wordWrap: { width: hasAction ? 420 : 590 },
    })
    .setOrigin(0, 0.5);
  root.add([g, label]);

  let closed = false;
  let timer: Phaser.Time.TimerEvent | null = null;
  const handle: Closable = {
    close(): void {
      if (closed) return;
      closed = true;
      timer?.remove();
      if (activeToast === handle) activeToast = null;
      const i = stack.indexOf(handle);
      if (i >= 0) stack.splice(i, 1);
      cameraRouter(scene).release(root);
      if (root.scene) root.destroy();
      scene.cameras.remove(cam, true);
    },
  };
  if (hasAction) {
    root.add(
      new Button(
        scene,
        rect.x + rect.width - 100,
        cy,
        opts.actionLabel ?? '',
        () => {
          handle.close();
          opts.onAction?.();
        },
        { width: 180, height: 88, fontSize: '28px', ...BUTTON_STYLE.primary },
      ).setScrollFactor(1, 1, true),
    );
  }
  timer = scene.time.delayedCall(opts.ms ?? 3000, () => handle.close());
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => handle.close());
  activeToast = handle;
  stack.push(handle);
  return handle;
}
