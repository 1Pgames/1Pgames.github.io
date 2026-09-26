import Phaser from 'phaser';
import { CSS, PALETTE, TEXT, VIEW, bareText } from '../config';
import { sfx } from '../core/audio';
import { itemValue } from '../systems/bag';
import type { BagAddResult, BagItemView, BagView, CoachBeatId, LootItem } from '../data/types-v2';
import { COACH_EVENT } from './coach';
import {
  BUTTON_STYLE,
  DISABLED_ALPHA,
  HUD_DEPTH,
  IDENTITY,
  PANEL,
  SCRIM,
  drawDuskPanel,
  rarityColor,
  rarityName,
} from './duskChrome';
import { iconFor, lootIconId, lootName } from './itemIcon';
import { drawPanel, paintPanel } from './primitives';
import type { SheetHandle } from './sheet';
import { showToast, type ToastHandle } from './toast';

/**
 * PRD-V2 §14.9 bag widget + §14.11 bag quick-sheet + §5.16 swap prompts;
 * replaces V1 `bagPips.ts`.
 *
 * - `BagStrip` — HUD widget at (360, 80, 196, 44), hit 88 tall: casket icon 36
 *   + `BAG 7/12` + a 5-segment rarity strip (best five carried items); full ⇒
 *   warn `BAG FULL`. Tap → `onTap` (the slice opens the quick-sheet). It
 *   pulses on the `item` coach beat and on `pulse()` (casket nudge).
 * - `BagStrip.announce(result, item)` — the toast lane's pickup / `SWAPPED —
 *   dropped …` / `BAG FULL — … left behind` lines; tapping one opens the sheet.
 * - `openBagSheet` — panel 640×420 at (40, 620): casket column (gilt lock),
 *   4×N grid of 88×88 tiles (icon, rarity ring, value; 2-cell items span two
 *   cells), tap a tile → inline `PIN` / `SWAP PIN` / `UNPIN` / `DROP` (88×64). Closes on
 *   tap outside, the ✕ pill, ESC, or `handle.close()` (bag widget tap). The
 *   slice runs time ×0.2 while it is open and restores it in `actions.close`.
 * - `BagPanel` — the grid itself, shared with the pause overlay (§14.15).
 */

export interface BagSheetActions { pin(uid: string): void; drop(uid: string): void; close(): void }

/** `SheetHandle` plus a repaint hook: after `pin`/`drop` the slice passes the new view. */
export interface BagSheetHandle extends SheetHandle {
  refresh(view: BagView): void;
}

const WIDGET = { x: 360, y: 80, width: 196, height: 44, hit: 88 } as const;
/** Minimum gap between two `BAG FULL — … left behind` toasts. */
const FULL_TOAST_GAP_MS = 4000;
const STRIP = { x: 404, y: 110, segments: 5, seg: 26, gap: 4, height: 8 } as const;

const TILE = 88;
const GAP = 10;
const PITCH = TILE + GAP;
/** Panel-local layout (origin = panel top-left, 640 wide). */
const LAYOUT = {
  width: 640,
  headerY: 24,
  top: 66,
  casketX: 24,
  gridX: 136,
  actionX: 530,
  actionW: 88,
  actionH: 64,
  bottomPad: 12,
} as const;
const SHEET = { x: 40, bottom: 1040, minHeight: 420 } as const;

function rarityOf(item: LootItem): number {
  return item.kind === 'gear' ? item.item.rarity : 0;
}

/** Height a `BagPanel` needs for `rows` grid rows. */
export function bagPanelHeight(view: BagView): number {
  const rows = Math.max(view.rows, 1);
  const casketRows = Math.max(view.casketSlots, 1);
  return LAYOUT.top + Math.max(rows, casketRows) * PITCH - GAP + LAYOUT.bottomPad;
}

// ─────────────────────────────── the grid (sheet + pause) ───────────────────

/**
 * Casket column + bag grid + inline action column, drawn into `root` with its
 * top-left at (0, 0). Rebuilt on `refresh` (only after a pin/drop — never per
 * frame). Every interactive child is pinned at scroll factor 0.
 */
export class BagPanel {
  private selected: string | null = null;
  private view: BagView;
  private readonly body: Phaser.GameObjects.Container;

  constructor(
    private readonly scene: Phaser.Scene,
    root: Phaser.GameObjects.Container,
    view: BagView,
    private readonly actions: { pin(uid: string): void; drop(uid: string): void },
  ) {
    this.view = view;
    this.body = scene.add.container(0, 0).setScrollFactor(0);
    root.add(this.body);
    this.build();
  }

  refresh(view: BagView): void {
    this.view = view;
    const all = [...view.casket, ...view.items];
    if (this.selected !== null && !all.some((i) => i.uid === this.selected)) this.selected = null;
    this.build();
  }

  private build(): void {
    const { scene, view } = this;
    this.body.removeAll(true);
    const parts: Phaser.GameObjects.GameObject[] = [];
    const sel = [...view.casket, ...view.items].find((i) => i.uid === this.selected) ?? null;

    // Header: capacity + shards, or the selected item's identity.
    const header = sel
      ? `${lootName(sel.item)} · ${sel.item.kind === 'gear' ? `${rarityName(sel.rarity)} · ` : ''}${sel.value} ◆`
      : `BAG ${view.used}/${view.cells} · ${Math.floor(view.shards).toLocaleString('en-US')} ◆`;
    const headerText = scene.add
      .text(LAYOUT.casketX, LAYOUT.headerY, header, {
        ...TEXT.label,
        fontSize: '21px',
        color: sel ? CSS.accent : view.full ? CSS.warn : CSS.ink,
        ...bareText(),
      })
      .setOrigin(0, 0.5);
    let size = 21;
    while (headerText.width > LAYOUT.actionX - LAYOUT.casketX - 64 && size > 15) headerText.setFontSize(--size);
    parts.push(headerText);

    // Casket column.
    parts.push(
      scene.add
        .text(LAYOUT.casketX + TILE / 2, LAYOUT.top - 3, 'CASKET', {
          ...TEXT.label,
          fontSize: '15px',
          color: CSS.accent,
          ...bareText(),
        })
        .setOrigin(0.5, 1),
    );
    for (let i = 0; i < Math.max(view.casketSlots, 1); i += 1) {
      const it = view.casket[i];
      const y = LAYOUT.top + i * PITCH;
      if (view.casketSlots === 0) parts.push(this.emptyTile(LAYOUT.casketX, y, TILE, true, 'NONE'));
      else if (it === undefined) parts.push(this.emptyTile(LAYOUT.casketX, y, TILE, true, 'EMPTY'));
      else parts.push(this.itemTile(it, LAYOUT.casketX, y, TILE, true));
    }

    // Grid: empty cells first, items (possibly 2 wide) on top.
    for (let r = 0; r < view.rows; r += 1) {
      for (let c = 0; c < view.cols; c += 1) {
        if (r * view.cols + c >= view.cells) continue;
        parts.push(this.emptyTile(LAYOUT.gridX + c * PITCH, LAYOUT.top + r * PITCH, TILE, false, ''));
      }
    }
    for (const it of view.items) {
      const w = it.cells === 2 ? TILE * 2 + GAP : TILE;
      parts.push(this.itemTile(it, LAYOUT.gridX + it.col * PITCH, LAYOUT.top + it.row * PITCH, w, false));
    }
    if (view.items.length === 0 && view.casket.length === 0) {
      parts.push(
        scene.add
          .text(LAYOUT.gridX + (view.cols * PITCH - GAP) / 2, LAYOUT.top + PITCH, 'Nothing carried yet.\nChests, elites and urns drop items.', {
            ...TEXT.body,
            fontSize: '19px',
            color: CSS.inkSoft,
            align: 'center',
            ...bareText(),
          })
          .setOrigin(0.5),
      );
    }

    // Inline actions for the selection.
    if (sel !== null) {
      const inCasket = view.casket.some((c) => c.uid === sel.uid);
      let y = LAYOUT.top;
      // `pin` toggles in the slice (E22 pin/unpin), so a casket tile offers UNPIN.
      const full = view.casket.length >= view.casketSlots;
      const pinLabel = inCasket ? 'UNPIN' : full ? 'SWAP\nPIN' : 'PIN';
      parts.push(
        this.actionButton(pinLabel, y, inCasket || view.casketSlots > 0, PALETTE.accent, () => this.actions.pin(sel.uid)),
      );
      y += LAYOUT.actionH + GAP;
      parts.push(this.actionButton('DROP', y, true, PALETTE.bad, () => this.actions.drop(sel.uid)));
    }
    this.body.add(parts);
  }

  private emptyTile(x: number, y: number, w: number, casket: boolean, label: string): Phaser.GameObjects.GameObject {
    const g = drawPanel(this.scene, w, TILE, {
      fill: PANEL.fill,
      fillAlpha: 0.45,
      stroke: casket ? IDENTITY.gilt : PANEL.stroke,
      strokeAlpha: casket ? 0.8 : 0.35,
      strokeWidth: 2,
      radius: 12,
    }).setPosition(x + w / 2, y + TILE / 2);
    if (!casket) return g;
    const lock = drawLock(this.scene, x + w / 2, y + TILE / 2 - 8);
    const text = this.scene.add
      .text(x + w / 2, y + TILE - 14, label, { ...TEXT.label, fontSize: '14px', color: CSS.inkSoft, ...bareText() })
      .setOrigin(0.5);
    return this.scene.add.container(0, 0, [g, lock, text]).setScrollFactor(0);
  }

  private itemTile(it: BagItemView, x: number, y: number, w: number, casket: boolean): Phaser.GameObjects.GameObject {
    const { scene } = this;
    const selected = it.uid === this.selected;
    const ring = it.item.kind === 'gear' ? rarityColor(it.rarity) : IDENTITY.gilt;
    const plate = drawPanel(scene, w, TILE, {
      fill: PANEL.fill,
      fillAlpha: 0.95,
      stroke: selected ? PALETTE.ink : ring,
      strokeAlpha: 1,
      strokeWidth: selected ? 4 : 3,
      radius: 12,
    });
    const icon = iconFor(scene, lootIconId(it.item), 60, ring, it.item.kind === 'gear' ? 'square' : 'disc').setY(-6);
    const value = scene.add
      .text(w / 2 - 6, TILE / 2 - 4, `${it.value}`, { ...TEXT.label, fontSize: '15px', color: CSS.accent })
      .setOrigin(1, 1);
    const children: Phaser.GameObjects.GameObject[] = [plate, icon, value];
    if (casket) children.push(drawLock(scene, -w / 2 + 14, -TILE / 2 + 14, 0.6));
    const tile = scene.add.container(x + w / 2, y + TILE / 2, children).setScrollFactor(0);
    tile.setSize(w, TILE).setInteractive({ useHandCursor: true });
    onClick(tile, () => {
      this.selected = selected ? null : it.uid;
      sfx('ui', { volume: 0.5 });
      this.build();
    });
    return tile;
  }

  private actionButton(label: string, y: number, enabled: boolean, tone: number, act: () => void): Phaser.GameObjects.GameObject {
    const { scene } = this;
    const bg = drawPanel(scene, LAYOUT.actionW, LAYOUT.actionH, {
      fill: tone,
      fillAlpha: 0.92,
      stroke: 0x03040b,
      strokeAlpha: 1,
      strokeWidth: 2,
      radius: 12,
    });
    const text = scene.add
      .text(0, 0, label, {
        ...TEXT.button,
        fontSize: label.includes('\n') ? '17px' : '22px',
        color: BUTTON_STYLE.primary.textColor,
        align: 'center',
        ...bareText(),
      })
      .setOrigin(0.5)
      .setLineSpacing(-4);
    const btn = scene.add
      .container(LAYOUT.actionX + LAYOUT.actionW / 2, y + LAYOUT.actionH / 2, [bg, text])
      .setScrollFactor(0)
      .setAlpha(enabled ? 1 : DISABLED_ALPHA);
    btn.setSize(LAYOUT.actionW, LAYOUT.actionH + 16).setInteractive({ useHandCursor: true });
    onClick(btn, () => {
      if (!enabled) {
        sfx('ui', { volume: 0.3, rate: 0.7 });
        return;
      }
      sfx('ui');
      act();
    });
    return btn;
  }
}

/** Click semantics (arm on own POINTER_DOWN, disarm on OUT) + pressed scale ack. */
function onClick(obj: Phaser.GameObjects.Container, act: () => void): void {
  let armed = false;
  obj.on(Phaser.Input.Events.POINTER_DOWN, () => {
    armed = true;
    obj.setScale(0.95);
  });
  obj.on(Phaser.Input.Events.POINTER_OUT, () => {
    armed = false;
    obj.setScale(1);
  });
  obj.on(Phaser.Input.Events.POINTER_UP, () => {
    obj.setScale(1);
    if (!armed) return;
    armed = false;
    act();
  });
}

/** The casket's gilt padlock glyph, primitives only. */
function drawLock(scene: Phaser.Scene, x: number, y: number, scale = 1): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y }).setScale(scale);
  g.lineStyle(4, IDENTITY.gilt, 1);
  g.beginPath();
  g.arc(0, -6, 8, Math.PI, 0, false);
  g.strokePath();
  g.fillStyle(IDENTITY.gilt, 1);
  g.fillRoundedRect(-12, -6, 24, 18, 4);
  g.fillStyle(0x03040b, 1);
  g.fillCircle(0, 2, 3);
  return g;
}

// ─────────────────────────────── HUD widget ─────────────────────────────────

export class BagStrip {
  private readonly root: Phaser.GameObjects.Container;
  private readonly plate: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly strip: Phaser.GameObjects.Graphics;
  private lastKey = '';
  private full = false;
  private lastFullToastAt = -Infinity;
  private fullSkipped = 0;
  private fullToast: ToastHandle | null = null;
  private fullToastItems = 0;
  private pulseTween: Phaser.Tweens.Tween | null = null;
  private destroyed = false;
  private readonly onCoach = (beat: CoachBeatId): void => {
    if (beat === 'item') this.pulse();
  };

  /** §16.1 E41. */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onTap: () => void,
  ) {
    const cx = WIDGET.x + WIDGET.width / 2;
    const cy = WIDGET.y + WIDGET.height / 2;
    this.plate = scene.add.graphics();
    const casket = iconFor(scene, 'casket', 36, IDENTITY.gilt, 'square').setPosition(-WIDGET.width / 2 + 22, 0);
    this.label = scene.add
      .text(STRIP.x - cx, -8, '', { ...TEXT.label, fontSize: '18px', color: CSS.ink, ...bareText() })
      .setOrigin(0, 0.5);
    this.strip = scene.add.graphics();
    this.root = scene.add
      .container(cx, cy, [this.plate, casket, this.label, this.strip])
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH.bagStrip);
    this.root.setSize(WIDGET.width, WIDGET.hit).setInteractive({ useHandCursor: true });
    onClick(this.root, () => {
      sfx('ui');
      this.onTap();
    });
    this.paintPlate();
    scene.events.on(COACH_EVENT, this.onCoach);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** §16.1 E41 — cheap when unchanged (diffed on a small key). */
  set(view: BagView): void {
    if (this.destroyed) return;
    const top = rarityStrip(view);
    const key = `${view.used}/${view.cells}/${view.full ? 1 : 0}/${view.casket.length}/${top.join(',')}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (view.full !== this.full) {
      this.full = view.full;
      this.paintPlate();
    }
    this.label.setText(view.full ? 'BAG FULL' : `BAG ${view.used}/${view.cells}`).setColor(view.full ? CSS.warn : CSS.ink);
    this.strip.clear();
    const x0 = STRIP.x - (WIDGET.x + WIDGET.width / 2);
    const y0 = STRIP.y - (WIDGET.y + WIDGET.height / 2);
    for (let i = 0; i < STRIP.segments; i += 1) {
      const r = top[i];
      const x = x0 + i * (STRIP.seg + STRIP.gap);
      if (r === undefined) {
        this.strip.fillStyle(0x03040b, 0.8).fillRoundedRect(x, y0, STRIP.seg, STRIP.height, 3);
      } else {
        this.strip.fillStyle(r === 0 ? IDENTITY.gilt : rarityColor(r), 1).fillRoundedRect(x, y0, STRIP.seg, STRIP.height, 3);
      }
      this.strip.lineStyle(1, 0x7e7376, 0.8).strokeRoundedRect(x, y0, STRIP.seg, STRIP.height, 3);
    }
  }

  /** One attention pulse (coach `item` beat, §5.16 casket nudge). Never stacks. */
  pulse(): void {
    if (this.destroyed || this.pulseTween !== null) return;
    this.pulseTween = this.scene.tweens.add({
      targets: this.root,
      scale: 1.12,
      duration: 180,
      yoyo: true,
      repeat: 2,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        this.pulseTween = null;
        this.root.setScale(1);
      },
    });
  }

  /**
   * §5.16 toast for a pickup attempt: `+ Gilt Chalice · 260 ◆`,
   * `SWAPPED — dropped Rust Coin Roll (25 ◆)` or `BAG FULL — Gilt Chalice left
   * behind`. Swap/refuse toasts open the quick-sheet on tap.
   */
  announce(result: BagAddResult, item: LootItem): void {
    if (this.destroyed) return;
    const tone = item.kind === 'gear' ? rarityColor(rarityOf(item)) : IDENTITY.gilt;
    if (!result.accepted || result.refused !== null) {
      // Coalesced, ≤ 1 per 4 s (critic: one toast per pickup at 9-12/12). Items
      // refused inside the window are counted into the next one; the widget's
      // own `BAG FULL` state is the sticky readout in between.
      const now = this.scene.time.now;
      if (now - this.lastFullToastAt < FULL_TOAST_GAP_MS) {
        this.fullSkipped += 1;
        return;
      }
      // A previous BAG FULL still queued behind other toasts is replaced by this
      // one (same key), so its items fold into this count instead of vanishing.
      const pending = this.fullToast !== null && !this.fullToast.shown ? this.fullToastItems : 0;
      const total = this.fullSkipped + pending;
      const more = total > 0 ? ` +${total} more` : '';
      this.lastFullToastAt = now;
      this.fullSkipped = 0;
      this.fullToastItems = total + 1;
      this.fullToast = showToast(this.scene, {
        text: `BAG FULL — ${lootName(item)}${more} left behind`,
        tone: PALETTE.warn,
        onTap: this.onTap,
        key: 'bag-full',
      });
      return;
    }
    const dropped = result.dropped[0];
    if (dropped !== undefined) {
      const more = result.dropped.length > 1 ? ` +${result.dropped.length - 1}` : '';
      showToast(this.scene, {
        text: `SWAPPED — dropped ${lootName(dropped)} (${itemValue(dropped)} ◆)${more}`,
        tone: PALETTE.warn,
        onTap: this.onTap,
      });
      return;
    }
    showToast(this.scene, { text: `+ ${lootName(item)} · ${itemValue(item)} ◆`, tone });
  }

  /** Live loop tweens (tween-leak probe): the pulse is finite, so 0 or 1. */
  get liveTweens(): number {
    return this.pulseTween === null ? 0 : 1;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(COACH_EVENT, this.onCoach);
    this.pulseTween?.remove();
    this.pulseTween = null;
    this.root.destroy();
  }

  private paintPlate(): void {
    paintPanel(this.plate, WIDGET.width, WIDGET.height, {
      fill: PANEL.fill,
      fillAlpha: 0.92,
      stroke: this.full ? PALETTE.warn : PANEL.stroke,
      strokeAlpha: this.full ? 1 : 0.8,
      strokeWidth: 2,
      radius: 12,
    });
  }
}

/** Best five carried rarities, highest first (valuables = 0 → gilt). */
function rarityStrip(view: BagView): number[] {
  const out: number[] = [];
  for (const it of view.casket) out.push(rarityOf(it.item));
  for (const it of view.items) out.push(rarityOf(it.item));
  out.sort((a, b) => b - a);
  out.length = Math.min(out.length, STRIP.segments);
  return out;
}

// ─────────────────────────────── quick-sheet ────────────────────────────────

/** §16.1 E41: the in-run bag quick-sheet (not a pause; the slice sets time ×0.2). */
export function openBagSheet(scene: Phaser.Scene, view: BagView, actions: BagSheetActions): BagSheetHandle {
  const root = scene.add.container(0, 0).setScrollFactor(0).setDepth(HUD_DEPTH.channelBar + 20);
  let closed = false;

  // Tap-outside catcher (created FIRST so the panel's controls stay on top).
  const veil = scene.add
    .rectangle(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height, SCRIM.fill, 0.35)
    .setScrollFactor(0)
    .setInteractive();
  let veilArmed = false;
  veil.on(Phaser.Input.Events.POINTER_DOWN, () => {
    veilArmed = true;
  });
  veil.on(Phaser.Input.Events.POINTER_UP, () => {
    if (veilArmed) handle.close();
    veilArmed = false;
  });
  root.add(veil);

  const height = Math.max(SHEET.minHeight, bagPanelHeight(view));
  const top = SHEET.bottom - height;
  const content = scene.add.container(SHEET.x, top).setScrollFactor(0);
  const plate = drawDuskPanel(scene, LAYOUT.width, height).setPosition(LAYOUT.width / 2, height / 2);
  // The plate swallows taps so a miss between tiles is not "outside".
  const blocker = scene.add.zone(LAYOUT.width / 2, height / 2, LAYOUT.width, height).setScrollFactor(0).setInteractive();
  content.add([plate, blocker]);
  const panel = new BagPanel(scene, content, view, actions);

  // Explicit way out: ✕ pill, top-right of the panel (88 px hit).
  const close = scene.add.container(LAYOUT.width - 44, 30).setScrollFactor(0);
  const xBg = drawPanel(scene, 56, 44, {
    fill: BUTTON_STYLE.idle.fill,
    fillAlpha: 0.95,
    stroke: BUTTON_STYLE.idle.stroke,
    strokeAlpha: 0.8,
    strokeWidth: 2,
    radius: 22,
  });
  const xLabel = scene.add.text(0, 0, '✕', { ...TEXT.button, fontSize: '24px', color: CSS.ink, ...bareText() }).setOrigin(0.5);
  close.add([xBg, xLabel]).setSize(88, 60).setInteractive({ useHandCursor: true });
  onClick(close, () => {
    sfx('ui');
    handle.close();
  });
  content.add(close);
  root.add(content);

  content.setAlpha(0).setY(top + 24);
  const enter = scene.tweens.add({ targets: content, alpha: 1, y: top, duration: 160, ease: 'Quad.easeOut' });

  const keyboard = scene.input.keyboard;
  const onEsc = (): void => handle.close();
  keyboard?.on('keydown-ESC', onEsc);

  const teardown = (): void => {
    keyboard?.off('keydown-ESC', onEsc);
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
    enter.remove();
    root.destroy(true);
  };
  const onShutdown = (): void => {
    closed = true;
    teardown();
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown);

  const handle: BagSheetHandle = {
    content,
    close(): void {
      if (closed) return;
      closed = true;
      teardown();
      actions.close();
    },
    refresh(next: BagView): void {
      if (!closed) panel.refresh(next);
    },
  };
  return handle;
}
