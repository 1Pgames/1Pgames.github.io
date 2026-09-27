import Phaser from 'phaser';
import { CSS, PALETTE, TEXT, VIEW } from '../config';
import { isMuted, playerSettings, savePlayerSettings, sfx, toggleMute } from '../core/audio';
import { resetMeta } from '../core/progression';
import { Button } from './button';
import { paintPanel } from './primitives';
import { cameraRouter, ScrollView, type Rect } from './scrollView';
import { TAB_BAR } from './tabBar';
import { bindTap, INK_ON_PRIMARY, label, PANEL, slider, toggleRow } from './widgets';

/**
 * Bottom sheets, confirm dialogs, the action toast and the Settings sheet
 * (ported from Duskhaul's tabbed hub).
 *
 * Every overlay lives on its OWN camera (`ui/scrollView.ts cameraRouter`):
 * camera creation order is z-order, so a sheet covers a hub scroll list, a
 * confirm covers the sheet under it, and hit-testing follows the same order.
 *
 * Exit law: every sheet closes on ESC (top of the per-scene stack), scrim tap
 * and its 88×88 X. No slide tweens: sheets cross-fade in 120 ms, so their
 * controls sit at their final rects from frame one.
 */

export interface OverlayHandle {
  close(): void;
  /** Screen y of a sheet's top edge (sheets only) — toasts land above it. */
  readonly top?: number;
}

export interface SheetOptions {
  height: number;
  onClose(): void;
  /** Header line drawn at the sheet top (y +40). */
  title?: string;
}

export interface Sheet extends OverlayHandle {
  /** Content root to build into, positioned at the sheet's top-left. */
  readonly content: Phaser.GameObjects.Container;
  /** Screen y of the sheet's top edge (`content` sits here). */
  readonly top: number;
  /** A scissor-clipped scroll band inside the sheet, destroyed with it. Rect in SCREEN px. */
  scroll(rect: Rect): ScrollView;
  readonly closed: boolean;
}

/** Per-scene ESC stack: ESC closes the most recently opened overlay. */
const STACKS = new WeakMap<Phaser.Scene, OverlayHandle[]>();

function stackFor(scene: Phaser.Scene): OverlayHandle[] {
  const existing = STACKS.get(scene);
  if (existing !== undefined) return existing;
  const stack: OverlayHandle[] = [];
  STACKS.set(scene, stack);
  const onEsc = (): void => stack[stack.length - 1]?.close();
  scene.input.keyboard?.on('keydown-ESC', onEsc);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.input.keyboard?.off('keydown-ESC', onEsc);
    stack.length = 0;
    STACKS.delete(scene);
  });
  return stack;
}

/** Closes every stacked overlay (tab switch, scene hand-off). */
export function closeAllOverlays(scene: Phaser.Scene): void {
  const stack = STACKS.get(scene);
  if (stack === undefined) return;
  for (let i = stack.length - 1; i >= 0; i -= 1) stack[i]?.close();
}

const SHEET_DEPTH = 3000;
const SCRIM_ALPHA = 0.62;
const FADE_MS = 120;
const BUTTON_IDLE = { fill: PALETTE.bgTop, stroke: PALETTE.inkSoft, textColor: CSS.ink } as const;
const BUTTON_PRIMARY = { fill: PALETTE.primary, stroke: PALETTE.ink, textColor: INK_ON_PRIMARY } as const;
const BUTTON_DESTRUCTIVE = { fill: PALETTE.bad, stroke: PALETTE.ink, textColor: INK_ON_PRIMARY } as const;

function overlayCamera(scene: Phaser.Scene, root: Phaser.GameObjects.Container, rect: Rect): Phaser.Cameras.Scene2D.Camera {
  const cam = scene.cameras.add(rect.x, rect.y, rect.width, rect.height);
  cam.setScroll(rect.x, rect.y);
  cameraRouter(scene).own(root, cam);
  return cam;
}

function detach(scene: Phaser.Scene, stack: OverlayHandle[], handle: OverlayHandle, root: Phaser.GameObjects.Container, cam: Phaser.Cameras.Scene2D.Camera): void {
  const i = stack.indexOf(handle);
  if (i >= 0) stack.splice(i, 1);
  cameraRouter(scene).release(root);
  if (root.scene) root.destroy();
  scene.cameras.remove(cam, true);
}

/**
 * Full-width bottom sheet `opts.height` tall, anchored to the bottom of the
 * frame, over a dimming scrim. Scrim tap, ESC and the X all call `close()`,
 * which runs `onClose` exactly once.
 */
export function openSheet(scene: Phaser.Scene, opts: SheetOptions): Sheet {
  const stack = stackFor(scene);
  const top = VIEW.height - opts.height;
  const root = scene.add.container(0, 0).setDepth(SHEET_DEPTH + stack.length);
  const cam = overlayCamera(scene, root, { x: 0, y: 0, width: VIEW.width, height: VIEW.height });
  const scrolls: ScrollView[] = [];

  const scrim = scene.add.rectangle(0, 0, VIEW.width, VIEW.height, PALETTE.bgDeep, SCRIM_ALPHA).setOrigin(0, 0).setInteractive();
  const panel = scene.add.graphics();
  panel.fillStyle(PANEL.fill, 1);
  panel.fillRoundedRect(0, top, VIEW.width, opts.height + 24, { tl: 24, tr: 24, bl: 0, br: 0 });
  panel.lineStyle(PANEL.strokeWidth, PANEL.stroke, PANEL.strokeAlpha);
  panel.strokeRoundedRect(1, top + 1, VIEW.width - 2, opts.height + 24, { tl: 24, tr: 24, bl: 0, br: 0 });
  // Drag handle: the affordance that says "this came up from below".
  panel.fillStyle(PALETTE.inkSoft, 0.6);
  panel.fillRoundedRect(VIEW.width / 2 - 40, top + 12, 80, 6, 3);
  // The panel swallows taps so a tap on the sheet body never reaches the scrim.
  const panelHit = scene.add.zone(0, top, VIEW.width, opts.height).setOrigin(0, 0).setInteractive();
  const content = scene.add.container(0, top);
  root.add([scrim, panel, panelHit, content]);
  if (opts.title !== undefined) content.add(label(scene, 40, 40, opts.title, { size: 30, bold: true, wrap: 540 }));

  let closed = false;
  const handle: Sheet = {
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
      for (const view of scrolls) view.destroy();
      detach(scene, stack, handle, root, cam);
      opts.onClose();
    },
  };

  bindTap(scrim, () => handle.close());
  root.add(closeButton(scene, VIEW.width - 64, top + 56, () => handle.close()));
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
    g.fillStyle(pressed ? PALETTE.bgBottom : PALETTE.bgDeep, 1);
    g.fillCircle(0, 0, 32);
    g.lineStyle(2, PALETTE.inkSoft, 0.8);
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

/** Two-button modal: default = cancel — ESC and scrim tap cancel, only the explicit confirm button commits. */
export function confirmDialog(scene: Phaser.Scene, opts: ConfirmOptions): OverlayHandle {
  const stack = stackFor(scene);
  const root = scene.add.container(0, 0).setDepth(SHEET_DEPTH + 50 + stack.length);
  const cam = overlayCamera(scene, root, { x: 0, y: 0, width: VIEW.width, height: VIEW.height });
  const w = 640;
  const scrim = scene.add.rectangle(0, 0, VIEW.width, VIEW.height, PALETTE.bgDeep, 0.7).setOrigin(0, 0).setInteractive();
  const body = label(scene, VIEW.width / 2, 0, opts.body, { size: 26, align: 'center', wrap: w - 64, origin: [0.5, 0] });
  const h = 120 + body.height + 140;
  const top = VIEW.height / 2 - h / 2;
  const panel = scene.add.graphics({ x: VIEW.width / 2, y: top + h / 2 });
  paintPanel(panel, w, h, { ...PANEL, stroke: opts.destructive === true ? PALETTE.bad : PANEL.stroke, strokeAlpha: 0.9 });
  const panelHit = scene.add.zone(40, top, w, h).setOrigin(0, 0).setInteractive();
  const title = label(scene, VIEW.width / 2, top + 36, opts.title, { size: 34, bold: true, align: 'center', wrap: w - 64, origin: [0.5, 0] });
  body.setY(top + 100);
  root.add([scrim, panel, panelHit, title, body]);

  let closed = false;
  const finish = (confirmed: boolean): void => {
    if (closed) return;
    closed = true;
    detach(scene, stack, handle, root, cam);
    if (confirmed) opts.onConfirm();
    else opts.onCancel?.();
  };
  const handle: OverlayHandle = { close: () => finish(false) };
  const by = top + h - 70;
  const size = { width: 292, height: 88, fontSize: '28px' };
  root.add([
    new Button(scene, 40 + 156, by, opts.cancelLabel ?? 'CANCEL', () => finish(false), { ...size, ...BUTTON_IDLE }),
    new Button(scene, 40 + w - 156, by, opts.confirmLabel, () => finish(true), {
      ...size,
      ...(opts.destructive === true ? BUTTON_DESTRUCTIVE : BUTTON_PRIMARY),
    }),
  ]);
  bindTap(scrim, () => finish(false));
  stack.push(handle);
  return handle;
}

export interface ToastOptions {
  actionLabel?: string;
  onAction?(): void;
  /** False renders the action refused: dimmed (0.45) and deaf, the toast still explains (e.g. an unaffordable REBUILD). */
  actionEnabled?: boolean;
  /** Auto-dismiss after this many ms (default 3000 — an UNDO window). */
  ms?: number;
  /**
   * Screen y centre. Default: just above the tab bar, or — while a sheet is
   * open — just above the topmost sheet, so a toast never covers the sheet's
   * own buttons.
   */
  y?: number;
}

let activeToast: OverlayHandle | null = null;

/**
 * Non-modal 640×88 toast with an optional action (UNDO). Max one visible; ESC
 * dismisses it WITHOUT running the action. Its camera covers only its own
 * rect, so a list under it keeps scrolling.
 */
export function actionToast(scene: Phaser.Scene, text: string, opts: ToastOptions = {}): OverlayHandle {
  activeToast?.close();
  const stack = stackFor(scene);
  let sheetTop: number | null = null;
  for (const entry of stack) if (entry.top !== undefined) sheetTop = entry.top;
  const cy = opts.y ?? (sheetTop === null ? VIEW.height - TAB_BAR.height - 60 : Math.max(184, sheetTop - 56));
  const rect: Rect = { x: 40, y: cy - 48, width: 640, height: 96 };
  const root = scene.add.container(0, 0).setDepth(SHEET_DEPTH + 90);
  const cam = overlayCamera(scene, root, rect);

  const g = scene.add.graphics();
  g.fillStyle(PALETTE.bgTop, 0.98);
  g.fillRoundedRect(rect.x, rect.y + 4, rect.width, 88, 12);
  g.lineStyle(2, PALETTE.accent, 0.8);
  g.strokeRoundedRect(rect.x, rect.y + 4, rect.width, 88, 12);
  const hasAction = opts.actionLabel !== undefined;
  const line = scene.add
    .text(rect.x + 24, cy, text, { ...TEXT.body, fontSize: '24px', color: CSS.ink, wordWrap: { width: hasAction ? 420 : 590 } })
    .setOrigin(0, 0.5);
  root.add([g, line]);

  let closed = false;
  let timer: Phaser.Time.TimerEvent | null = null;
  const handle: OverlayHandle = {
    close(): void {
      if (closed) return;
      closed = true;
      timer?.remove();
      if (activeToast === handle) activeToast = null;
      detach(scene, stack, handle, root, cam);
    },
  };
  if (hasAction) {
    const action = new Button(
      scene,
      rect.x + rect.width - 100,
      cy,
      opts.actionLabel ?? '',
      () => {
        handle.close();
        opts.onAction?.();
      },
      { width: 180, height: 88, fontSize: '28px', ...BUTTON_PRIMARY },
    );
    // The toast camera is offset to its own rect: a pinned (scroll factor 0) button would render shifted.
    root.add(action.setScrollFactor(1, 1, true));
    if (opts.actionEnabled === false) action.setAlpha(0.45).disableInteractive();
  }
  timer = scene.time.delayedCall(opts.ms ?? 3000, () => handle.close());
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => handle.close());
  activeToast = handle;
  stack.push(handle);
  return handle;
}

export interface SettingsSheetOptions {
  /** Renders RESET SAVE behind a destructive confirm; called after `resetMeta()` wiped the save. */
  onReset?(): void;
  onClose?(): void;
}

/**
 * The Settings sheet every hub and pause overlay opens: Music + SFX sliders
 * that apply LIVE while dragged (`savePlayerSettings` re-levels both buses),
 * Sound (the mute preference), Reduce motion (read by `ui/progressFx.ts`),
 * and — only when `onReset` is passed — RESET SAVE.
 */
export function openSettingsSheet(scene: Phaser.Scene, opts: SettingsSheetOptions = {}): Sheet {
  const onReset = opts.onReset;
  // Every row ends above SAFE.bottom (y 1060): nothing interactive in the bottom 220 px.
  const sheet = openSheet(scene, { height: onReset === undefined ? 720 : 820, title: 'SETTINGS', onClose: () => opts.onClose?.() });
  const rows: Phaser.GameObjects.GameObject[] = [];
  const build = (): void => {
    for (const row of rows) row.destroy();
    rows.length = 0;
    const s = playerSettings();
    rows.push(
      slider(scene, 40, 110, 'Music', s.music, (v) => savePlayerSettings({ music: v })),
      slider(scene, 40, 210, 'SFX', s.sfx, (v) => savePlayerSettings({ sfx: v })),
      toggleRow(scene, 40, 310, 'Sound', !isMuted(), () => {
        toggleMute();
        build();
      }),
      toggleRow(scene, 40, 410, 'Reduce motion', s.reduceMotion, () => {
        savePlayerSettings({ reduceMotion: !playerSettings().reduceMotion });
        build();
      }),
    );
    if (onReset !== undefined) {
      rows.push(
        new Button(
          scene,
          VIEW.width / 2,
          554,
          'RESET SAVE',
          () =>
            confirmDialog(scene, {
              title: 'Reset save?',
              body: 'Every currency, unlock and upgrade is erased. This cannot be undone.',
              confirmLabel: 'RESET',
              destructive: true,
              onConfirm: () => {
                resetMeta();
                sheet.close();
                onReset();
              },
            }),
          { width: 640, height: 88, fontSize: '28px', ...BUTTON_DESTRUCTIVE },
        ),
      );
    }
    sheet.content.add(rows);
  };
  build();
  return sheet;
}
