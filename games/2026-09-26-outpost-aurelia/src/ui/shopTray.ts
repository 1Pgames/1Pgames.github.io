import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../config';
import { drawPanel, paintPanel, drawPill, paintPill } from './primitives';
import { Button } from './button';

/**
 * Bottom-docked shop tray for auto-battlers: 3-5 offer slots each showing a
 * unit/item, a per-slot lock toggle (locked offers survive `reroll`), and a
 * reroll `Button` with its cost label. `buy(slot)` only fires the caller's
 * callback when `canAfford` says yes for that offer's cost; the tray never
 * mutates gold/currency itself.
 *
 * Repaints only on `setOffers()`/`refreshAffordability()` — never from
 * `update`. Slot chrome is `primitives` (panel + pill), reroll is the shared
 * `Button` component, matching every other piece of UI chrome in the
 * template.
 *
 * Use for: auto-battler shop/reroll phases.
 * Do NOT use for: a one-time pick-N overlay (see `ui/cards.ts`) or an
 * in-combat hand of cards (see `ui/hand.ts`).
 */

export interface ShopOffer {
  slot: number;
  id: string;
  name: string;
  cost: number;
  locked: boolean;
}

export interface ShopTrayOptions {
  rerollCost: number;
  canAfford(cost: number): boolean;
  onBuy(slot: number): void;
  onToggleLock(slot: number): void;
  onReroll(): void;
}

const SLOT_WIDTH = 128;
const SLOT_HEIGHT = 168;
const SLOT_GAP = 14;

interface SlotEntry {
  offer: ShopOffer;
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  lockPill: Phaser.GameObjects.Graphics;
}

export class ShopTray {
  private readonly scene: Phaser.Scene;
  private readonly opts: ShopTrayOptions;
  private readonly root: Phaser.GameObjects.Container;
  private readonly rerollButton: Button;
  private slots: SlotEntry[] = [];

  constructor(scene: Phaser.Scene, opts: ShopTrayOptions) {
    this.scene = scene;
    this.opts = opts;

    const dockY = VIEW.height - SAFE.bottom / 2;
    this.root = scene.add.container(0, 0).setDepth(400).setScrollFactor(0);

    this.rerollButton = new Button(
      scene,
      VIEW.width - SAFE.side - 90,
      dockY - SLOT_HEIGHT / 2 - 70,
      `REROLL ${opts.rerollCost}`,
      () => opts.onReroll(),
      { width: 180, height: 88, fill: PALETTE.secondary },
    );
    this.root.add(this.rerollButton);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  /** Rebuilds the tray for a new set of offers (after a reroll or a buy). */
  setOffers(offers: readonly ShopOffer[]): void {
    for (const slot of this.slots) slot.container.destroy();
    this.slots = [];

    const dockY = VIEW.height - SAFE.bottom / 2;
    const totalWidth = offers.length * SLOT_WIDTH + Math.max(0, offers.length - 1) * SLOT_GAP;
    const startX = VIEW.centerX - totalWidth / 2 + SLOT_WIDTH / 2 - 60;

    offers.forEach((offer, index) => {
      const x = startX + index * (SLOT_WIDTH + SLOT_GAP);
      const entry = this.buildSlot(offer, x, dockY);
      this.root.add(entry.container);
      this.slots.push(entry);
    });
  }

  /**
   * Dims slots the player can no longer afford — call whenever available
   * currency changes (a state change, not a per-frame poll).
   */
  refreshAffordability(): void {
    for (const slot of this.slots) {
      const affordable = this.opts.canAfford(slot.offer.cost);
      paintPanel(slot.bg, SLOT_WIDTH, SLOT_HEIGHT, {
        fill: PALETTE.bgTop,
        fillAlpha: affordable ? 0.96 : 0.6,
        stroke: PALETTE.primary,
        strokeAlpha: affordable ? 0.55 : 0.2,
        radius: 18,
      });
    }
  }

  /** Sets the reroll button's cost label — call whenever `rerollCost` changes. */
  setRerollCost(cost: number): void {
    this.rerollButton.setLabel(`REROLL ${cost}`);
  }

  destroy(): void {
    this.root.destroy(true);
  }

  private buildSlot(offer: ShopOffer, x: number, y: number): SlotEntry {
    const container = this.scene.add.container(x, y);

    const bg = drawPanel(this.scene, SLOT_WIDTH, SLOT_HEIGHT, {
      fill: PALETTE.bgTop,
      fillAlpha: 0.96,
      stroke: PALETTE.primary,
      strokeAlpha: 0.55,
      radius: 18,
    });

    const name = this.scene.add
      .text(0, -SLOT_HEIGHT / 2 + 28, offer.name, {
        ...TEXT.label,
        color: CSS.ink,
        wordWrap: { width: SLOT_WIDTH - 16 },
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);

    const costLabel = this.scene.add
      .text(0, SLOT_HEIGHT / 2 - 50, `${offer.cost}`, { ...TEXT.label, color: CSS.accent })
      .setOrigin(0.5)
      .setScrollFactor(0);

    const lockPill = drawPill(this.scene, 44, 32, {
      fill: offer.locked ? PALETTE.accent : PALETTE.bgBottom,
      strokeAlpha: 0.6,
    });
    lockPill.setPosition(SLOT_WIDTH / 2 - 30, -SLOT_HEIGHT / 2 + 22);
    lockPill.setInteractive(
      new Phaser.Geom.Rectangle(-22, -16, 44, 32),
      Phaser.Geom.Rectangle.Contains,
    );
    lockPill.setScrollFactor(0);

    container.add([bg, name, costLabel, lockPill]);
    container.setSize(SLOT_WIDTH, SLOT_HEIGHT);
    container.setScrollFactor(0);
    container.setInteractive({ useHandCursor: true });

    const entry: SlotEntry = { offer, container, bg, lockPill };

    // Click semantics: buy arms on the slot's own POINTER_DOWN, disarms on
    // POINTER_OUT, exactly like `ui/button.ts` — a release that only ends
    // here (e.g. dragging the tray's own scroll, if ever added) must not
    // buy the unit underneath it.
    let armed = false;
    container.on(Phaser.Input.Events.POINTER_DOWN, () => {
      armed = true;
    });
    container.on(Phaser.Input.Events.POINTER_OUT, () => {
      armed = false;
    });
    container.on(Phaser.Input.Events.POINTER_UP, () => {
      if (!armed) return;
      armed = false;
      if (!this.opts.canAfford(offer.cost)) return;
      this.opts.onBuy(offer.slot);
    });

    let lockArmed = false;
    lockPill.on(Phaser.Input.Events.POINTER_DOWN, () => {
      lockArmed = true;
    });
    lockPill.on(Phaser.Input.Events.POINTER_OUT, () => {
      lockArmed = false;
    });
    lockPill.on(Phaser.Input.Events.POINTER_UP, () => {
      if (!lockArmed) return;
      lockArmed = false;
      this.opts.onToggleLock(offer.slot);
      paintPill(lockPill, 44, 32, { fill: offer.locked ? PALETTE.bgBottom : PALETTE.accent, strokeAlpha: 0.6 });
    });

    return entry;
  }
}
