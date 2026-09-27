import Phaser from 'phaser';
import { CSS, PALETTE } from '../../config';
import { sfx } from '../../core/audio';
import { ICON } from '../../data/art';
import { GOODS, GOOD_SHORT, type Stock, type TagId } from '../../slices/colony/content';
import { COLONY_TUNING } from '../../slices/colony/tuning';
import { paintPanel } from '../primitives';
import { bindTap, label } from '../widgets';

/**
 * Colony UI chrome (art/interface-direction.md §2-§3, implemented verbatim):
 * NASA-placard panels, capsule HUD chips, primary / secondary / danger
 * buttons, tag hues, and the one diffing text setter every widget uses.
 * Base colours come from `PALETTE`/`CSS` (§1); the chrome-only values below
 * are the §2 table's literals.
 */
export const CHROME = {
  panelAlpha: 0.94,
  panelRadius: 18,
  pinAlpha: 0.35,
  chipAlpha: 0.82,
  chipStroke: 0x3b3040,
  primaryPressed: 0xc38935,
  secondary: 0x3a4a52,
  secondaryPressed: 0x2e3b42,
  danger: 0x8f3a28,
  dangerPressed: 0x74301f,
  dialTrack: 0x3b3040,
  dialNight: 0x8a6fa0,
  cold: 0x7d93b8,
  coldCss: '#7d93b8',
  disabledAlpha: 0.45,
  draftScrim: 0.72,
} as const;

/** Directive tag hues (§2 "Tag chip"). */
export const TAG_HUE: Record<TagId, number> = {
  hearth: 0xe2b450,
  forge: 0xc7783f,
  bulwark: 0xde6a4f,
  frontier: 0x6f9fa6,
  kin: 0x8fb573,
  orbit: 0x7d93b8,
};
export const TAG_ICON: Record<TagId, IconName> = {
  hearth: 'tag-hearth',
  forge: 'tag-forge',
  bulwark: 'tag-bul',
  frontier: 'tag-fr',
  kin: 'tag-kin',
  orbit: 'tag-orb',
};
export const TAG_LABEL: Record<TagId, string> = {
  hearth: 'HEARTH',
  forge: 'FORGE',
  bulwark: 'BULWARK',
  frontier: 'FRONTIER',
  kin: 'KIN',
  orbit: 'ORBIT',
};

/** Colony UI layers on the main camera (sheets/confirms sit on their own cameras above all of these). */
export const UI_DEPTH = { hud: 1000, card: 1100, draft: 2000, coach: 2600 } as const;

export type IconName = keyof typeof ICON;

/** Scroll factor 0 on a whole tree (Container.setScrollFactor only reaches direct children). */
export function pin(obj: Phaser.GameObjects.GameObject): void {
  (obj as Phaser.GameObjects.GameObject & Partial<Phaser.GameObjects.Components.ScrollFactor>).setScrollFactor?.(0);
  if (obj instanceof Phaser.GameObjects.Container) for (const child of obj.list) pin(child);
}

const warned = new Set<string>();

/** A registry icon scaled to fit `size`, or null (one warning) when its sheet is not loaded. */
export function icon(scene: Phaser.Scene, name: string, size: number): Phaser.GameObjects.Image | null {
  const slot = (ICON as Record<string, { key: string; frame: number } | undefined>)[name];
  if (slot === undefined || !scene.textures.exists(slot.key)) {
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`colony ui: icon "${name}" is not loaded — missing art is a defect, nothing drawn`);
    }
    return null;
  }
  const img = scene.add.image(0, 0, slot.key, slot.frame);
  img.setScale(size / Math.max(1, img.width, img.height));
  return img;
}

/** Placard panel from its TOP-LEFT: bgTop 0.94, 3 px bgDeep, 1 px brass pin-line inset 4 px. */
export function placard(scene: Phaser.Scene, x: number, y: number, w: number, h: number, stroke: number = PALETTE.bgDeep): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x: x + w / 2, y: y + h / 2 });
  paintPlacard(g, w, h, stroke);
  return g;
}

export function paintPlacard(g: Phaser.GameObjects.Graphics, w: number, h: number, stroke: number = PALETTE.bgDeep): void {
  paintPanel(g, w, h, { fill: PALETTE.bgTop, fillAlpha: CHROME.panelAlpha, stroke, strokeAlpha: 1, strokeWidth: 3, radius: CHROME.panelRadius });
  g.lineStyle(1, PALETTE.accent, CHROME.pinAlpha);
  g.strokeRoundedRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8, CHROME.panelRadius - 4);
}

/** HUD capsule from its TOP-LEFT: bgDeep 0.82, 2 px #3b3040. */
export function capsule(scene: Phaser.Scene, x: number, y: number, w: number, h: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x: x + w / 2, y: y + h / 2 });
  paintCapsule(g, w, h);
  return g;
}

export function paintCapsule(g: Phaser.GameObjects.Graphics, w: number, h: number, fill: number = PALETTE.bgDeep, stroke: number = CHROME.chipStroke): void {
  paintPanel(g, w, h, { fill, fillAlpha: CHROME.chipAlpha, stroke, strokeAlpha: 1, strokeWidth: 2, radius: h / 2 });
}

export type ControlKind = 'primary' | 'secondary' | 'danger';

const KIND: Record<ControlKind, { fill: number; pressed: number; ink: string }> = {
  primary: { fill: PALETTE.primary, pressed: CHROME.primaryPressed, ink: `#${PALETTE.bgDeep.toString(16).padStart(6, '0')}` },
  secondary: { fill: CHROME.secondary, pressed: CHROME.secondaryPressed, ink: CSS.ink },
  danger: { fill: CHROME.danger, pressed: CHROME.dangerPressed, ink: CSS.ink },
};

export interface ControlOpts {
  size?: number;
  icon?: string;
  iconSize?: number;
  /** Refused taps still reach `onRefused` (dock slots shake + explain); default: deafened. */
  softDisable?: boolean;
  onRefused?: () => void;
}

/**
 * A chrome button (TOP-LEFT x,y): §2 fill / pressed (y +2) / disabled 0.45,
 * 3 px bgDeep stroke, radius 16, label without armour. Click semantics via
 * `bindTap`; the hit rect grows to the 88 px thumb minimum. Pinned at scroll
 * factor 0 (screen furniture over a moving world).
 */
export class Control {
  readonly root: Phaser.GameObjects.Container;
  readonly text: Phaser.GameObjects.Text;
  private img: Phaser.GameObjects.Image | null;
  private readonly iconSize: number;
  private readonly textY: number;
  private readonly homeX: number;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly scene: Phaser.Scene;
  private readonly w: number;
  private readonly h: number;
  private readonly hit: Phaser.Geom.Rectangle;
  private kind: ControlKind;
  private enabled = true;
  private pressed = false;
  private deaf = false;
  private lastLabel: string;
  private readonly soft: boolean;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, text: string, kind: ControlKind, onTap: () => void, opts: ControlOpts = {}) {
    this.scene = scene;
    this.w = w;
    this.h = h;
    this.kind = kind;
    this.lastLabel = text;
    this.soft = opts.softDisable === true;
    this.homeX = x;
    this.root = scene.add.container(x, y).setSize(w, h);
    this.bg = scene.add.graphics({ x: w / 2, y: h / 2 });
    this.iconSize = opts.iconSize ?? 0;
    this.img = opts.icon !== undefined ? icon(scene, opts.icon, this.iconSize) : null;
    // With an icon: icon on top (6 px inset), label on the bottom line.
    this.textY = opts.icon !== undefined ? h - 16 : h / 2;
    this.text = label(scene, w / 2, this.textY, text, {
      size: opts.size ?? 26,
      bold: true,
      color: KIND[kind].ink,
      origin: [0.5, 0.5],
      align: 'center',
    });
    if (this.img !== null) this.img.setPosition(w / 2, 6 + this.iconSize / 2);
    this.root.add(this.img === null ? [this.bg, this.text] : [this.bg, this.img, this.text]);
    const hitW = Math.max(w, 88);
    const hitH = Math.max(h, 88);
    this.hit = new Phaser.Geom.Rectangle(w / 2 - (hitW - w) / 2, h / 2 - (hitH - h) / 2, hitW, hitH);
    this.root.setInteractive(this.hit, Phaser.Geom.Rectangle.Contains);
    if (this.root.input) this.root.input.cursor = 'pointer';
    bindTap(
      this.root,
      () => {
        if (!this.enabled) {
          sfx('deny', { volume: 0.5 });
          this.shake();
          opts.onRefused?.();
          return;
        }
        sfx('ui', { volume: 0.5 });
        onTap();
      },
      (p) => {
        this.pressed = p;
        this.paint();
      },
    );
    this.root.setScrollFactor(0, 0, true);
    this.paint();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Runtime invariant (cert run 10: dock drawn live but input off): a control that is visible, not deaf
   * and enabled (or soft-disabled) must take input. Returns a violation label (and restores input) or null.
   */
  checkLive(name: string): string | null {
    const shouldTake = this.root.visible && !this.deaf && (this.enabled || this.soft);
    if (!shouldTake || this.root.input?.enabled === true) return null;
    this.root.setInteractive(this.hit, Phaser.Geom.Rectangle.Contains);
    return `${name}: drawn live but input was off`;
  }

  setLabel(text: string): this {
    if (text !== this.lastLabel) {
      this.lastLabel = text;
      this.text.setText(text);
    }
    return this;
  }

  setKind(kind: ControlKind): this {
    if (kind === this.kind) return this;
    this.kind = kind;
    this.text.setColor(KIND[kind].ink);
    this.paint();
    return this;
  }

  /** Disabled = alpha 0.45; deafened (`disableInteractive`) unless the control was built `softDisable`. */
  setEnabled(on: boolean): this {
    if (on === this.enabled) return this;
    this.enabled = on;
    this.root.setAlpha(on ? 1 : CHROME.disabledAlpha);
    if (!this.soft && !this.deaf) {
      if (on) this.root.setInteractive(this.hit, Phaser.Geom.Rectangle.Contains);
      else this.root.disableInteractive();
    }
    return this;
  }

  /** Deaf while another owner holds the screen (the draft): input off, look unchanged (the owner's scrim dims it). */
  setDeaf(on: boolean): this {
    if (on === this.deaf) return this;
    this.deaf = on;
    if (on) this.root.disableInteractive();
    else if (this.enabled || this.soft) this.root.setInteractive(this.hit, Phaser.Geom.Rectangle.Contains);
    return this;
  }

  setVisible(on: boolean): this {
    if (this.root.visible !== on) this.root.setVisible(on);
    return this;
  }
  /** Swaps the icon (dock slots re-dock a different building). */
  setIcon(name: string): this {
    this.img?.destroy();
    this.img = icon(this.scene, name, this.iconSize);
    if (this.img !== null) this.root.addAt(this.img.setPosition(this.w / 2, 6 + this.iconSize / 2).setScrollFactor(0), 1);
    return this;
  }

  /** Refusal headshake (≤ 100 ms acknowledgment). */
  shake(): void {
    this.scene.tweens.killTweensOf(this.root);
    this.root.setX(this.homeX);
    this.scene.tweens.add({ targets: this.root, x: { from: this.homeX - 10, to: this.homeX }, duration: 260, ease: 'Elastic.easeOut' });
  }

  private paint(): void {
    const k = KIND[this.kind];
    paintPanel(this.bg, this.w, this.h, {
      fill: this.pressed ? k.pressed : k.fill,
      fillAlpha: 1,
      stroke: PALETTE.bgDeep,
      strokeAlpha: 1,
      strokeWidth: 3,
      radius: 16,
    });
    this.bg.setY(this.h / 2 + (this.pressed ? 2 : 0));
    this.text.setY(this.textY + (this.pressed ? 2 : 0));
  }

  destroy(): void {
    this.scene.tweens.killTweensOf(this.root);
    if (this.root.scene) this.root.destroy();
  }
}

/** `setText` only when the string changed (widgets update at ≤ 10 Hz; unchanged text is never re-rasterised). */
export function setText(t: Phaser.GameObjects.Text, s: string): void {
  if (t.text !== s) t.setText(s);
}

export function setColor(t: Phaser.GameObjects.Text, c: string): void {
  if (t.style.color !== c) t.setColor(c);
}

/** `12 Fe · 5 Alloy` in goods order, or `free`. */
export function costLabel(cost: Stock): string {
  let out = '';
  for (const g of GOODS) {
    const v = cost[g];
    if (v === undefined || v <= 0) continue;
    out += `${out === '' ? '' : ' · '}${Math.ceil(v)} ${GOOD_SHORT[g]}`;
  }
  return out === '' ? 'free' : out;
}

/** The first good `cost` is short of, as "Need 12 Alloy", or null when affordable. */
export function missingLabel(cost: Stock, stock: Readonly<Record<string, number>>): string | null {
  for (const g of GOODS) {
    const need = cost[g] ?? 0;
    const have = stock[g] ?? 0;
    if (need > have) return `Need ${Math.ceil(need - have)} ${GOOD_SHORT[g]}`;
  }
  return null;
}

/** Fe-equivalent of a cost (PRD §2A.1 "alloy = 2 Fe"; values `COLONY_TUNING.mend.*FeValue`, other goods 1:1). */
export function feEquivalent(cost: Stock): number {
  const M = COLONY_TUNING.mend;
  let n = 0;
  for (const g of GOODS) n += (cost[g] ?? 0) * (g === 'alloy' ? M.alloyFeValue : g === 'prism' ? M.prismFeValue : 1);
  return n;
}
