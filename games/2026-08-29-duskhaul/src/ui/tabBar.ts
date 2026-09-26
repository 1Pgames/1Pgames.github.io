/**
 * Hub bottom tab bar (PRD-V2 §14.2 / FlowAudit §2.3): (0,1120,720,160), five
 * 144-wide tabs, icon 56 at y 1160, label 22 px at y 1222, active = 6 px
 * `primary` underline + ink label, inactive = inkSoft, red NEW dot 16 px at the
 * icon's top-right. Tab changes never confirm and never move layout.
 */
import Phaser from 'phaser';
import { CSS, PALETTE } from '../config';
import type { HubTabId } from '../scenes/hub/hub';
import { DEEP_INK } from './duskChrome';
import { iconFor } from './itemIcon';
import { label, tapZone } from './widgets';

const TAB_ORDER: readonly HubTabId[] = ['expedition', 'armory', 'vault', 'sanctum', 'codex'];
const TAB_LABEL: Record<HubTabId, string> = {
  expedition: 'EXPEDITION',
  armory: 'ARMORY',
  vault: 'VAULT',
  sanctum: 'SANCTUM',
  codex: 'CODEX',
};

const BAR = { y: 1120, h: 160, tabW: 144, iconY: 1160, labelY: 1222, icon: 56 } as const;

interface TabView {
  text: Phaser.GameObjects.Text;
  icon: Phaser.GameObjects.Image;
  dot: Phaser.GameObjects.Arc;
}

export class TabBar {
  readonly root: Phaser.GameObjects.Container;
  private readonly views = new Map<HubTabId, TabView>();
  private readonly underline: Phaser.GameObjects.Rectangle;
  private active: HubTabId | null = null;

  constructor(scene: Phaser.Scene, onSelect: (id: HubTabId) => void) {
    this.root = scene.add.container(0, 0).setDepth(900);
    const bg = scene.add.rectangle(0, BAR.y, 720, BAR.h, DEEP_INK, 0.94).setOrigin(0, 0);
    const edge = scene.add.rectangle(0, BAR.y, 720, 2, PALETTE.inkSoft, 0.35).setOrigin(0, 0);
    this.root.add([bg, edge]);
    this.underline = scene.add.rectangle(0, BAR.y + 2, BAR.tabW - 40, 6, PALETTE.primary).setOrigin(0.5, 0);
    this.root.add(this.underline);

    TAB_ORDER.forEach((id, i) => {
      const x = i * BAR.tabW;
      const zone = tapZone(scene, x, BAR.y, BAR.tabW, BAR.h, () => onSelect(id));
      const cx = BAR.tabW / 2;
      const icon = iconFor(scene, `icon-tab-${id}`, BAR.icon, PALETTE.inkSoft, 'square');
      icon.setPosition(cx, BAR.iconY - BAR.y);
      const text = label(scene, cx, BAR.labelY - BAR.y, TAB_LABEL[id], { size: 22, bold: true, color: CSS.inkSoft, origin: [0.5, 0.5] });
      const dot = scene.add.circle(cx + BAR.icon / 2, BAR.iconY - BAR.y - BAR.icon / 2 + 4, 8, PALETTE.bad).setVisible(false);
      zone.add([icon, text, dot]);
      this.root.add(zone);
      // 22 px display type overruns a 144 cell for EXPEDITION; scale to fit, never clip.
      if (text.width > BAR.tabW - 12) text.setScale((BAR.tabW - 12) / text.width);
      icon.setAlpha(0.7);
      this.views.set(id, { text, icon, dot });
    });
  }

  select(id: HubTabId): void {
    if (this.active !== null) {
      const prev = this.views.get(this.active);
      prev?.text.setColor(CSS.inkSoft);
      prev?.icon.setAlpha(0.7);
    }
    this.active = id;
    const view = this.views.get(id);
    view?.text.setColor(CSS.ink);
    view?.icon.setAlpha(1);
    this.underline.setX(TAB_ORDER.indexOf(id) * BAR.tabW + BAR.tabW / 2);
  }

  /** Red NEW dot on a tab (unviewed vault item, affordable node, claimable contract). */
  setBadge(id: HubTabId, on: boolean): void {
    this.views.get(id)?.dot.setVisible(on);
  }

  destroy(): void {
    this.views.clear();
    if (this.root.scene) this.root.destroy();
  }
}
