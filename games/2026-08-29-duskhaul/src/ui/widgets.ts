/**
 * Small hub/results building blocks on the §14.4 chrome (`duskChrome.ts`):
 * panel-surface text, top-left panels, segmented controls, chips, tap zones,
 * rank pips, progress bars and item tiles. Everything here sits on its own
 * panel, so labels go bare (armour-strip rule).
 */
import Phaser from 'phaser';
import { CSS, FONT, PALETTE, bareText } from '../config';
import { sfx } from '../core/audio';
import type { LootItem } from '../data/types-v2';
import { bindTap } from './button';
import { PANEL, TIER_RING, panelStyle, paintBar, rarityColor } from './duskChrome';
import { iconFor, lootIconId } from './itemIcon';
import { paintPanel } from './primitives';

export interface TextOpts {
  size?: number;
  color?: string;
  bold?: boolean;
  origin?: [number, number];
  wrap?: number;
  align?: 'left' | 'center' | 'right';
}

/** Bare (armour-stripped) text for panel surfaces. */
export function label(scene: Phaser.Scene, x: number, y: number, text: string, opts: TextOpts = {}): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, text, {
    fontFamily: opts.bold === true ? FONT.display : FONT.family,
    fontSize: `${opts.size ?? 24}px`,
    color: opts.color ?? CSS.ink,
    align: opts.align ?? 'left',
    ...(opts.wrap !== undefined ? { wordWrap: { width: opts.wrap } } : {}),
    ...bareText(),
  });
  const [ox, oy] = opts.origin ?? [0, 0];
  return t.setOrigin(ox, oy);
}

/** §14.4 panel drawn from its TOP-LEFT corner (the design rects are top-left). */
export function panelAt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  over: Parameters<typeof panelStyle>[1] = {},
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x: x + w / 2, y: y + h / 2 });
  paintPanel(g, w, h, panelStyle(w, over));
  return g;
}

/**
 * A tappable rect container (top-left at x,y) with click semantics and a
 * pressed acknowledgment (alpha dip) inside the ≤100 ms budget.
 */
export function tapZone(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  onTap: () => void,
  silent = false,
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  c.setSize(w, h);
  // A Container's hit test adds its display origin (w/2, h/2) to the local
  // point, so a rect at (w/2, h/2) spans (0,0)-(w,h) from the container's
  // position — top-left semantics like every design rect. The hit rect is
  // then grown symmetrically to the 88 px thumb minimum (AGENTS.md) when the
  // drawn control is smaller (64 px chips, 72 px segments).
  const hitW = Math.max(w, 88);
  const hitH = Math.max(h, 88);
  c.setInteractive(new Phaser.Geom.Rectangle(w / 2 - (hitW - w) / 2, h / 2 - (hitH - h) / 2, hitW, hitH), Phaser.Geom.Rectangle.Contains);
  if (c.input) c.input.cursor = 'pointer';
  bindTap(
    c,
    () => {
      if (!silent) sfx('ui');
      onTap();
    },
    (pressed) => c.setAlpha(pressed ? 0.75 : 1),
  );
  return c;
}

/**
 * Segmented control (§14.7/§14.8): equal cells in one housing, the active cell
 * filled `primary` with a deep-ink label. Height ≥ 72; tap targets ≥ 88 wide.
 * `badges[i]` draws the red NEW dot on that segment (same 16 px dot as the
 * tab bar), so a tab badge always points at the segment that earned it.
 * `icons[i]` (an §11 icon id) sits left of the label; missing art degrades to
 * `iconFor`'s tinted glyph.
 */
export function segmented(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  labels: readonly string[],
  active: number,
  onSelect: (i: number) => void,
  badges: readonly boolean[] = [],
  icons: readonly string[] = [],
): Phaser.GameObjects.Container {
  const c = scene.add.container(0, 0);
  c.add(panelAt(scene, x, y, w, h));
  const cw = w / labels.length;
  labels.forEach((text0, i) => {
    const on = i === active;
    const cell = tapZone(scene, x + i * cw, y, cw, h, () => {
      if (i !== active) onSelect(i);
    });
    if (on) {
      const g = scene.add.graphics();
      g.fillStyle(PALETTE.primary, 0.92);
      g.fillRoundedRect(4, 4, cw - 8, h - 8, 10);
      cell.add(g);
    }
    const size = labels.length > 3 ? 20 : 24;
    const text = label(scene, cw / 2, h / 2, text0, { size, bold: true, color: on ? '#03040b' : CSS.inkSoft, origin: [0.5, 0.5] });
    const iconId = icons[i];
    if (iconId !== undefined) {
      const iconSize = Math.min(40, h - 24);
      const icon = iconFor(scene, iconId, iconSize, on ? PALETTE.bgDeep : PALETTE.inkSoft, 'disc');
      const groupW = iconSize + 8 + text.width;
      icon.setPosition(cw / 2 - groupW / 2 + iconSize / 2, h / 2).setAlpha(on ? 1 : 0.8);
      text.setX(cw / 2 - groupW / 2 + iconSize + 8).setOrigin(0, 0.5);
      cell.add(icon);
    }
    cell.add(text);
    if (badges[i] === true) cell.add(scene.add.circle(cw - 12, 12, 8, PALETTE.bad));
    c.add(cell);
  });
  return c;
}

/** Filter/sort chip (≥ 88 wide × 64 tall): outlined idle, filled when active. */
export function chip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  text: string,
  active: boolean,
  onTap: () => void,
  h = 64,
): Phaser.GameObjects.Container {
  const c = tapZone(scene, x, y, w, h, onTap);
  const g = scene.add.graphics();
  g.fillStyle(active ? PALETTE.primary : PANEL.fill, active ? 0.92 : 0.95);
  g.fillRoundedRect(0, 0, w, h, h / 2);
  g.lineStyle(2, active ? 0x03040b : PANEL.stroke, 0.8);
  g.strokeRoundedRect(1, 1, w - 2, h - 2, h / 2);
  const t = label(scene, w / 2, h / 2, text, { size: 20, bold: true, color: active ? '#03040b' : CSS.ink, origin: [0.5, 0.5] });
  // Scale to fit the chip, never clip (SHROUD / AMULET in an 88 px chip).
  if (t.width > w - 14) t.setScale((w - 14) / t.width);
  c.add([g, t]);
  return c;
}

/** Level pips `●●○○` as drawn discs (left-aligned at x, centred on y). */
export function pips(scene: Phaser.Scene, x: number, y: number, n: number, max: number, color: number = PALETTE.primary): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  for (let i = 0; i < max; i++) {
    const cx = x + 8 + i * 22;
    if (i < n) {
      g.fillStyle(color, 1);
      g.fillCircle(cx, y, 8);
    }
    g.lineStyle(2, i < n ? color : PANEL.stroke, 0.9);
    g.strokeCircle(cx, y, 8);
  }
  return g;
}

/** Progress bar (housing + redrawn fill) from its top-left corner. */
export function progressBar(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  progress: number,
  fill: number = PALETTE.primary,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x: x + w / 2, y: y + h / 2 });
  paintBar(g, w, h, progress, fill);
  return g;
}

/** Rarity swatch (filled square + the 2 px `TIER_RING`), centred on (x, y). */
export function raritySwatch(scene: Phaser.Scene, x: number, y: number, rarity: number, size = 20): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(rarityColor(rarity), 1);
  g.fillRoundedRect(x - size / 2, y - size / 2, size, size, 4);
  g.lineStyle(TIER_RING.width, TIER_RING.color, 1);
  g.strokeRoundedRect(x - size / 2, y - size / 2, size, size, 4);
  return g;
}

export interface TileOpts {
  /** Small caption under the icon (name / value). */
  caption?: string;
  badge?: string;
  /** Greyed (lost items on Results). */
  dim?: boolean;
  selected?: boolean;
  locked?: boolean;
  equipped?: boolean;
  isNew?: boolean;
}

/**
 * Item tile (top-left x,y; `size` square + optional caption): rarity ring,
 * icon, lock/equipped/NEW marks. Not interactive by itself — wrap in
 * `tapZone` when the surface needs taps.
 */
export function itemTile(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  item: LootItem,
  rarity: number,
  opts: TileOpts = {},
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const tone = rarityColor(rarity);
  const g = scene.add.graphics();
  g.fillStyle(0x03040b, 0.85);
  g.fillRoundedRect(0, 0, size, size, 12);
  g.lineStyle(opts.selected === true ? 5 : 3, opts.selected === true ? PALETTE.primary : tone, 1);
  g.strokeRoundedRect(2, 2, size - 4, size - 4, 12);
  c.add(g);
  const icon = iconFor(scene, lootIconId(item), size * 0.72, tone, item.kind === 'gear' ? 'square' : 'disc');
  icon.setPosition(size / 2, size / 2);
  c.add(icon);
  c.add(raritySwatch(scene, size - 16, size - 16, rarity, 16));
  if (opts.locked === true) {
    const lg = scene.add.graphics();
    lg.fillStyle(PALETTE.accent, 1);
    lg.fillRoundedRect(8, 12, 18, 14, 3);
    lg.lineStyle(3, PALETTE.accent, 1);
    lg.strokeCircle(17, 11, 6);
    c.add(lg);
  }
  if (opts.equipped === true) {
    c.add(label(scene, size / 2, 8, 'EQUIPPED', { size: 14, bold: true, color: CSS.primary, origin: [0.5, 0] }));
  }
  if (opts.isNew === true) {
    const ng = scene.add.graphics();
    ng.fillStyle(PALETTE.bad, 1);
    ng.fillRoundedRect(size - 50, -6, 52, 22, 11);
    c.add([ng, label(scene, size - 24, 5, 'NEW', { size: 14, bold: true, color: '#03040b', origin: [0.5, 0.5] })]);
  }
  if (opts.badge !== undefined) {
    c.add(label(scene, 8, size - 28, opts.badge, { size: 16, bold: true, color: CSS.ink }));
  }
  if (opts.caption !== undefined) {
    c.add(label(scene, size / 2, size + 6, opts.caption, { size: 16, color: CSS.inkSoft, origin: [0.5, 0], align: 'center', wrap: size + 30 }));
  }
  if (opts.dim === true) c.setAlpha(0.45);
  return c;
}

/** Thousands separator for ◆ amounts (`1,240`). */
export function num(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** `m:ss` from seconds. */
export function clock(s: number): string {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * A line of copy led by small icons (unlock rows: `<weapon> + <charm>` with
 * both glyphs). Top-left at (x, y); returns the container and its height.
 */
export function iconLine(
  scene: Phaser.Scene,
  x: number,
  y: number,
  icons: readonly string[],
  text: string,
  /** `fit`: one line scaled down to the width instead of wrapping (fixed-pitch lists). */
  opts: TextOpts & { iconSize?: number; width?: number; fit?: boolean } = {},
): { line: Phaser.GameObjects.Container; height: number } {
  const c = scene.add.container(x, y);
  const size = opts.iconSize ?? 28;
  let tx = 0;
  for (const id of icons) {
    c.add(iconFor(scene, id, size, PALETTE.primary, 'disc').setPosition(tx + size / 2, size / 2));
    tx += size + 4;
  }
  if (icons.length > 0) tx += 4;
  const width = opts.width ?? 600;
  const t = label(scene, tx, Math.max(0, (size - (opts.size ?? 20) * 1.25) / 2), text, opts.fit === true ? opts : { ...opts, wrap: width - tx });
  if (opts.fit === true && t.width > width - tx) t.setScale((width - tx) / t.width);
  c.add(t);
  return { line: c, height: Math.max(size, t.y + t.height) };
}
