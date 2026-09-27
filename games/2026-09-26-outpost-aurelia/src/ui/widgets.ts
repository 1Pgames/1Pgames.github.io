import Phaser from 'phaser';
import { CSS, FONT, PALETTE } from '../config';
import { sfx } from '../core/audio';
import { paintPanel, type ChromeStyle } from './primitives';

/**
 * Hub/meta building blocks (ported from Duskhaul's tabbed hub): tap semantics
 * that survive scrolling, top-left panels and tap zones (design rects are
 * top-left), segmented controls, chips, pips, item tiles, Settings sliders and
 * toggles. Everything sits on its own panel, palette-driven, ≥ 88 px hit
 * rects. Pair with `ui/tabBar.ts`, `ui/sheet.ts` and `ui/scrollView.ts`.
 *
 * Icons are TEXTURE KEYS. A key that is not loaded draws nothing and warns
 * once — a procedural stand-in would hide a missing-art defect from every
 * gate that counts icons.
 */

/** Travel (design px) past which a press is a DRAG, not a tap. A scroll that starts on a control must not fire it. */
export const TAP_SLOP = 12;

/**
 * Click semantics for any interactive object: arm on its own POINTER_DOWN,
 * disarm on POINTER_OUT, fire on POINTER_UP only if armed AND the pointer
 * travelled ≤ `TAP_SLOP`. `onPress` is the ≤ 100 ms acknowledgment hook
 * (pressed repaint). The object must already be interactive.
 */
export function bindTap(obj: Phaser.GameObjects.GameObject, onTap: () => void, onPress?: (pressed: boolean) => void): void {
  let armed = false;
  obj.on(Phaser.Input.Events.POINTER_DOWN, () => {
    armed = true;
    onPress?.(true);
  });
  obj.on(Phaser.Input.Events.POINTER_OUT, () => {
    if (armed) onPress?.(false);
    armed = false;
  });
  obj.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
    if (!armed) return;
    armed = false;
    onPress?.(false);
    if (pointer.getDistance() > TAP_SLOP) return;
    onTap();
  });
}

/** Panel chrome every hub surface shares (sheets, rows, segmented housings). */
export const PANEL = { fill: PALETTE.bgTop, stroke: PALETTE.inkSoft, strokeAlpha: 0.45, strokeWidth: 2, radius: 16 } as const satisfies ChromeStyle;
/** Label ink on a `primary`-filled surface (active segment/chip). */
export const INK_ON_PRIMARY = `#${PALETTE.bgDeep.toString(16).padStart(6, '0')}`;

export interface TextOpts {
  size?: number;
  color?: string;
  bold?: boolean;
  origin?: [number, number];
  wrap?: number;
  align?: 'left' | 'center' | 'right';
}

/** Plain panel-surface text (no stroke/shadow armour: the panel is the contrast surface). */
export function label(scene: Phaser.Scene, x: number, y: number, text: string, opts: TextOpts = {}): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, text, {
    fontFamily: opts.bold === true ? FONT.display : FONT.family,
    fontSize: `${opts.size ?? 24}px`,
    color: opts.color ?? CSS.ink,
    align: opts.align ?? 'left',
    ...(opts.wrap !== undefined ? { wordWrap: { width: opts.wrap } } : {}),
  });
  const [ox, oy] = opts.origin ?? [0, 0];
  return t.setOrigin(ox, oy);
}

/** A `PANEL` drawn from its TOP-LEFT corner. */
export function panelAt(scene: Phaser.Scene, x: number, y: number, w: number, h: number, over: ChromeStyle = {}): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x: x + w / 2, y: y + h / 2 });
  paintPanel(g, w, h, { ...PANEL, ...over });
  return g;
}

/**
 * A tappable rect container (top-left at x,y) with `bindTap` semantics and an
 * alpha-dip press acknowledgment. The hit rect grows symmetrically to the
 * 88 px thumb minimum when the drawn control is smaller.
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
  // position — top-left semantics like every design rect.
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

const warnedIcons = new Set<string>();

/**
 * A loaded texture scaled to fit a `size` square, or `null` (with one console
 * warning per key) when the key is not loaded. Never a placeholder glyph.
 */
export function iconImage(scene: Phaser.Scene, key: string, size: number, frame?: number): Phaser.GameObjects.Image | null {
  if (!scene.textures.exists(key)) {
    if (!warnedIcons.has(key)) {
      warnedIcons.add(key);
      console.warn(`widgets: icon texture "${key}" is not loaded — missing art is a defect, nothing drawn`);
    }
    return null;
  }
  const img = scene.add.image(0, 0, key, frame);
  img.setScale(size / Math.max(1, img.width, img.height));
  return img;
}

/** The 16 px red NEW/attention dot (tab bar, segments, tiles use the same one). */
export function badgeDot(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Arc {
  return scene.add.circle(x, y, 8, PALETTE.bad);
}

/**
 * Segmented control: equal cells in one housing, the active cell filled
 * `primary`. Height ≥ 72. `badges[i]` draws the NEW dot on that segment so a
 * tab badge always points at the segment that earned it; `icons[i]` (texture
 * key) sits left of the label.
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
  opts: { badges?: readonly boolean[]; icons?: readonly string[] } = {},
): Phaser.GameObjects.Container {
  const c = scene.add.container(0, 0);
  c.add(panelAt(scene, x, y, w, h));
  const cw = w / labels.length;
  labels.forEach((text, i) => {
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
    const t = label(scene, cw / 2, h / 2, text, { size: labels.length > 3 ? 20 : 24, bold: true, color: on ? INK_ON_PRIMARY : CSS.inkSoft, origin: [0.5, 0.5] });
    const iconSize = Math.min(40, h - 24);
    const iconKey = opts.icons?.[i];
    const icon = iconKey === undefined ? null : iconImage(scene, iconKey, iconSize);
    if (icon !== null) {
      const groupW = iconSize + 8 + t.width;
      icon.setPosition(cw / 2 - groupW / 2 + iconSize / 2, h / 2).setAlpha(on ? 1 : 0.8);
      t.setX(cw / 2 - groupW / 2 + iconSize + 8).setOrigin(0, 0.5);
      cell.add(icon);
    }
    // Scale to fit the cell, never clip.
    if (t.displayWidth > cw - 12) t.setScale((cw - 12) / t.width);
    cell.add(t);
    if (opts.badges?.[i] === true) cell.add(badgeDot(scene, cw - 12, 12));
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
  g.fillStyle(active ? PALETTE.primary : PALETTE.bgTop, active ? 0.92 : 0.95);
  g.fillRoundedRect(0, 0, w, h, h / 2);
  g.lineStyle(2, active ? PALETTE.bgDeep : PALETTE.inkSoft, 0.8);
  g.strokeRoundedRect(1, 1, w - 2, h - 2, h / 2);
  const t = label(scene, w / 2, h / 2, text, { size: 20, bold: true, color: active ? INK_ON_PRIMARY : CSS.ink, origin: [0.5, 0.5] });
  if (t.width > w - 14) t.setScale((w - 14) / t.width);
  c.add([g, t]);
  return c;
}

/** Level pips `●●○○` as drawn discs (left-aligned at x, centred on y). */
export function pips(scene: Phaser.Scene, x: number, y: number, n: number, max: number, color: number = PALETTE.primary): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  for (let i = 0; i < max; i += 1) {
    const cx = x + 8 + i * 22;
    if (i < n) {
      g.fillStyle(color, 1);
      g.fillCircle(cx, y, 8);
    }
    g.lineStyle(2, i < n ? color : PALETTE.inkSoft, 0.9);
    g.strokeCircle(cx, y, 8);
  }
  return g;
}

export interface TileOpts {
  /** Ring colour (rarity/tier); defaults to `inkSoft`. */
  ring?: number;
  /** Small caption under the tile (name / value). */
  caption?: string;
  /** Bottom-left overlay text (level, count). */
  badge?: string;
  dim?: boolean;
  selected?: boolean;
  locked?: boolean;
  equipped?: boolean;
  isNew?: boolean;
}

/**
 * Item tile (top-left x,y; `size` square + optional caption): ring, icon,
 * lock / EQUIPPED / NEW marks. Not interactive — wrap in `tapZone` when the
 * surface needs taps.
 */
export function itemTile(scene: Phaser.Scene, x: number, y: number, size: number, iconKey: string, opts: TileOpts = {}): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  g.fillStyle(PALETTE.bgDeep, 0.85);
  g.fillRoundedRect(0, 0, size, size, 12);
  g.lineStyle(opts.selected === true ? 5 : 3, opts.selected === true ? PALETTE.primary : (opts.ring ?? PALETTE.inkSoft), 1);
  g.strokeRoundedRect(2, 2, size - 4, size - 4, 12);
  c.add(g);
  const icon = iconImage(scene, iconKey, size * 0.72);
  if (icon !== null) c.add(icon.setPosition(size / 2, size / 2));
  if (opts.locked === true) {
    const lg = scene.add.graphics();
    lg.fillStyle(PALETTE.accent, 1);
    lg.fillRoundedRect(8, 12, 18, 14, 3);
    lg.lineStyle(3, PALETTE.accent, 1);
    lg.strokeCircle(17, 11, 6);
    c.add(lg);
  }
  if (opts.equipped === true) c.add(label(scene, size / 2, 8, 'EQUIPPED', { size: 14, bold: true, color: CSS.primary, origin: [0.5, 0] }));
  if (opts.isNew === true) {
    const ng = scene.add.graphics();
    ng.fillStyle(PALETTE.bad, 1);
    ng.fillRoundedRect(size - 50, -6, 52, 22, 11);
    c.add([ng, label(scene, size - 24, 5, 'NEW', { size: 14, bold: true, color: INK_ON_PRIMARY, origin: [0.5, 0.5] })]);
  }
  if (opts.badge !== undefined) c.add(label(scene, 8, size - 28, opts.badge, { size: 16, bold: true }));
  if (opts.caption !== undefined) {
    c.add(label(scene, size / 2, size + 6, opts.caption, { size: 16, color: CSS.inkSoft, origin: [0.5, 0], align: 'center', wrap: size + 30 }));
  }
  if (opts.dim === true) c.setAlpha(0.45);
  return c;
}

/** Settings row with an on/off switch (640 × 88 from top-left). The whole row is the tap target. */
export function toggleRow(scene: Phaser.Scene, x: number, y: number, name: string, on: boolean, onTap: () => void): Phaser.GameObjects.Container {
  const row = tapZone(scene, x, y, 640, 88, onTap);
  row.add(panelAt(scene, 0, 0, 640, 88));
  row.add(label(scene, 24, 44, name, { size: 26, bold: true, origin: [0, 0.5] }));
  const g = scene.add.graphics();
  g.fillStyle(on ? PALETTE.primary : PALETTE.bgBottom, 1);
  g.fillRoundedRect(520, 24, 96, 40, 20);
  g.fillStyle(PALETTE.ink, 1);
  g.fillCircle(on ? 596 : 540, 44, 16);
  row.add(g);
  return row;
}

/**
 * Horizontal 0..1 slider row (640 × 88 from top-left). `onChange` fires on
 * EVERY drag step — wire it to something that applies live (e.g.
 * `savePlayerSettings`) — and once more on release with the ack sound. A
 * drag sets the value; a tap steps it ±10 % toward the tapped side.
 * Pointer x is read in screen px, so the row must sit unscrolled at `x`
 * (true inside a sheet).
 */
export function slider(scene: Phaser.Scene, x: number, y: number, name: string, value: number, onChange: (v: number) => void): Phaser.GameObjects.Container {
  const row = scene.add.container(x, y);
  row.add(panelAt(scene, 0, 0, 640, 88));
  row.add(label(scene, 24, 44, name, { size: 26, bold: true, origin: [0, 0.5] }));
  const trackX = 210;
  const trackW = 390;
  const g = scene.add.graphics();
  const pct = label(scene, 180, 44, '', { size: 18, bold: true, color: CSS.inkSoft, origin: [1, 0.5] });
  let v = Phaser.Math.Clamp(value, 0, 1);
  const paint = (): void => {
    g.clear();
    g.fillStyle(PALETTE.bgBottom, 1);
    g.fillRoundedRect(trackX, 40, trackW, 8, 4);
    g.fillStyle(PALETTE.primary, 1);
    g.fillRoundedRect(trackX, 40, Math.max(8, trackW * v), 8, 4);
    g.fillStyle(PALETTE.ink, 1);
    g.fillCircle(trackX + trackW * v, 44, 18);
    pct.setText(`${Math.round(v * 100)}%`);
  };
  paint();
  const hit = scene.add.zone(trackX - 20, 0, trackW + 40, 88).setOrigin(0, 0).setInteractive({ useHandCursor: true });
  row.add([g, pct, hit]);
  // A press only moves the knob once it becomes a drag (> TAP_SLOP); a plain tap steps ±10 % toward
  // the tapped side, so a stray tap (or a masher) can never slam the volume to one end.
  let pressX: number | null = null;
  let dragging = false;
  const apply = (next: number): void => {
    const c = Phaser.Math.Clamp(next, 0, 1);
    if (c === v) return;
    v = c;
    paint();
    onChange(v);
  };
  hit.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
    pressX = p.x;
    dragging = false;
  });
  const onMove = (p: Phaser.Input.Pointer): void => {
    if (pressX === null || !p.isDown) return;
    if (!dragging && Math.abs(p.x - pressX) <= TAP_SLOP) return;
    dragging = true;
    apply((p.x - row.x - trackX) / trackW);
  };
  const onUp = (p: Phaser.Input.Pointer): void => {
    if (pressX === null) return;
    if (!dragging) {
      const knob = row.x + trackX + trackW * v;
      apply(Math.round((v + (p.x >= knob ? 0.1 : -0.1)) * 10) / 10);
    }
    pressX = null;
    dragging = false;
    onChange(v);
    sfx('ui');
  };
  scene.input.on(Phaser.Input.Events.POINTER_MOVE, onMove);
  scene.input.on(Phaser.Input.Events.POINTER_UP, onUp);
  row.once(Phaser.GameObjects.Events.DESTROY, () => {
    scene.input.off(Phaser.Input.Events.POINTER_MOVE, onMove);
    scene.input.off(Phaser.Input.Events.POINTER_UP, onUp);
  });
  return row;
}

/** Thousands separator for currency amounts (`1,240`). */
export function num(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** `m:ss` from seconds. */
export function clock(s: number): string {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
