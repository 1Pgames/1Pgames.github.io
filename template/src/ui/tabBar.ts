import Phaser from 'phaser';
import { CSS, PALETTE, VIEW } from '../config';
import { badgeDot, iconImage, label, tapZone } from './widgets';

/**
 * Bottom tab bar for a mid-core TABBED HUB (one screen, one job: play / equip /
 * store / improve / learn). Ported from Duskhaul's hub: a `TAB_BAR.height`
 * band at the bottom of the frame, equal-width tabs, icon 56 over a 22 px
 * label, active = 6 px `primary` underline + ink label, inactive = inkSoft,
 * red NEW dot at the icon's top-right. Tab changes never confirm and never
 * move layout; the caller swaps the content above the bar in `onSelect`.
 *
 * Icons are texture keys; a tab without one (or with a key that is not
 * loaded) centres its label instead of drawing a stand-in.
 */
export const TAB_BAR = { height: 160, icon: 56, depth: 900 } as const;

export interface TabSpec<Id extends string> {
  id: Id;
  label: string;
  /** Texture key of the tab icon. */
  icon?: string;
}

interface TabView {
  text: Phaser.GameObjects.Text;
  icon: Phaser.GameObjects.Image | null;
  dot: Phaser.GameObjects.Arc;
  index: number;
}

export class TabBar<Id extends string> {
  readonly root: Phaser.GameObjects.Container;
  /** Screen y of the bar's top edge — content above it ends here. */
  readonly top = VIEW.height - TAB_BAR.height;
  private readonly views = new Map<Id, TabView>();
  private readonly underline: Phaser.GameObjects.Rectangle;
  private readonly tabW: number;
  private active: Id | null = null;

  constructor(scene: Phaser.Scene, tabs: readonly TabSpec<Id>[], onSelect: (id: Id) => void) {
    this.tabW = VIEW.width / Math.max(1, tabs.length);
    const top = this.top;
    this.root = scene.add.container(0, 0).setDepth(TAB_BAR.depth);
    const bg = scene.add.rectangle(0, top, VIEW.width, TAB_BAR.height, PALETTE.bgDeep, 0.94).setOrigin(0, 0);
    const edge = scene.add.rectangle(0, top, VIEW.width, 2, PALETTE.inkSoft, 0.35).setOrigin(0, 0);
    this.underline = scene.add.rectangle(0, top + 2, this.tabW - 40, 6, PALETTE.primary).setOrigin(0.5, 0);
    this.root.add([bg, edge, this.underline]);

    tabs.forEach((tab, index) => {
      const zone = tapZone(scene, index * this.tabW, top, this.tabW, TAB_BAR.height, () => onSelect(tab.id));
      const cx = this.tabW / 2;
      const icon = tab.icon === undefined ? null : iconImage(scene, tab.icon, TAB_BAR.icon);
      const iconY = 40;
      if (icon !== null) zone.add(icon.setPosition(cx, iconY).setAlpha(0.7));
      const text = label(scene, cx, icon === null ? TAB_BAR.height / 2 : 102, tab.label, {
        size: 22,
        bold: true,
        color: CSS.inkSoft,
        origin: [0.5, 0.5],
      });
      // Long labels scale to fit the cell, never clip.
      if (text.width > this.tabW - 12) text.setScale((this.tabW - 12) / text.width);
      const dot = badgeDot(scene, cx + TAB_BAR.icon / 2, iconY - TAB_BAR.icon / 2 + 4).setVisible(false);
      zone.add([text, dot]);
      this.root.add(zone);
      this.views.set(tab.id, { text, icon, dot, index });
    });
  }

  /** Paints `id` as the active tab (call from `onSelect` once the content swapped). */
  select(id: Id): void {
    if (this.active !== null) {
      const prev = this.views.get(this.active);
      prev?.text.setColor(CSS.inkSoft);
      prev?.icon?.setAlpha(0.7);
    }
    const view = this.views.get(id);
    if (view === undefined) return;
    this.active = id;
    view.text.setColor(CSS.ink);
    view.icon?.setAlpha(1);
    this.underline.setX(view.index * this.tabW + this.tabW / 2);
  }

  /** Red NEW dot on a tab (unviewed item, affordable upgrade, claimable reward). */
  setBadge(id: Id, on: boolean): void {
    this.views.get(id)?.dot.setVisible(on);
  }

  destroy(): void {
    this.views.clear();
    if (this.root.scene) this.root.destroy();
  }
}
