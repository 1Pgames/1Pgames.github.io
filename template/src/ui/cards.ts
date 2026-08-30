import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../config';
import { drawPanel } from './primitives';
import { enterFromBottom } from '../core/juice';
import { enterPinningHitArea } from './entrance';
import { sfx } from '../core/audio';
import { Button } from './button';
import type { UpgradeDef, Rarity } from '../data/upgrades';

/**
 * "Pick 1 of 3" level-up overlay: three rarity-tinted upgrade cards stacked
 * inside the portrait safe area, each tappable once. The caller owns pausing
 * the run (this module only draws and listens) and gets back a handle whose
 * `destroy()` tears the whole overlay down — call it from `onPick` once the
 * chosen upgrade has been applied.
 *
 * Use for: roguelike / survivor-like level-up choices, or any "offer a
 * small weighted set of options" moment (relic pick, room reward).
 * Do NOT use for: shop screens with more than ~4 options or persistent
 * meta-upgrade trees — those need scroll/pagination this overlay doesn't do.
 */

const RARITY_COLOR: Record<Rarity, number> = {
  common: PALETTE.inkSoft,
  uncommon: PALETTE.good,
  rare: PALETTE.primary,
  legendary: PALETTE.accent,
};

export interface UpgradeCardsHandle {
  destroy(): void;
}

/** Optional one-shot reroll: draws a fresh set of choices, replacing the ones on screen. */
export interface UpgradeCardsOptions {
  rerollCost: number;
  /** Whether the reroll button should be tappable right now (affordability + not already used). */
  canReroll: () => boolean;
  /** Draws a new choice set excluding whatever is currently shown. */
  onReroll: () => readonly UpgradeDef[];
}

const CARD_WIDTH = VIEW.width - SAFE.side * 2;
const CARD_HEIGHT = 220;
const CARD_GAP = 28;
const REROLL_BUTTON_HEIGHT = 88;

/**
 * Shows `choices` (expected length 3, but any count fits) as stacked cards
 * centered in the safe area. `onPick` fires once per overlay, for the
 * tapped card only; the other cards are torn down immediately after.
 * `reroll`, when supplied, adds a one-shot "REROLL" button below the cards
 * that redraws the card set in place via `reroll.onReroll`.
 */
export function showUpgradeCards(
  scene: Phaser.Scene,
  choices: readonly UpgradeDef[],
  onPick: (choice: UpgradeDef) => void,
  reroll?: UpgradeCardsOptions,
): UpgradeCardsHandle {
  // Every object here is screen-space. With a scrolling camera, `scrollFactor`
  // must be set on each interactive object, not just the parent container:
  // Phaser hit-tests a child against the camera scroll on its own, so cards
  // inside a pinned container would render centred but only accept clicks at
  // the camera's world offset.
  const root = scene.add.container(0, 0).setDepth(2000).setScrollFactor(0);

  const dim = scene.add
    .rectangle(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height, 0x000000, 0.55)
    .setScrollFactor(0)
    .setInteractive();
  root.add(dim);

  const heading = scene.add
    .text(0, 0, 'CHOOSE AN UPGRADE', TEXT.heading)
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setFontSize(44);
  root.add(heading);
  enterFromBottom(scene, heading);

  let resolved = false;
  let cardGroup: Phaser.GameObjects.Container[] = [];
  let rerollButton: Button | null = null;

  function layout(current: readonly UpgradeDef[]): void {
    const totalHeight = current.length * CARD_HEIGHT + (current.length - 1) * CARD_GAP;
    const startY = VIEW.centerY - totalHeight / 2 + CARD_HEIGHT / 2;
    heading.setPosition(VIEW.centerX, startY - CARD_HEIGHT / 2 - 60);

    for (const card of cardGroup) card.destroy();
    cardGroup = current.map((choice, index) => {
      const y = startY + index * (CARD_HEIGHT + CARD_GAP);
      const card = buildCard(scene, VIEW.centerX, y, choice, () => {
        if (resolved) return;
        resolved = true;
        sfx('ui');
        onPick(choice);
      });
      root.add(card);
      // A card is interactive the moment `buildCard` returns it, so the pinned
      // entrance can collect its hit area: the cards are tappable through the
      // whole stagger instead of only after the last one lands.
      enterPinningHitArea(scene, card, { delayMs: index * 70 });
      return card;
    });

    if (reroll === undefined) return;
    const rerollY = startY + current.length * (CARD_HEIGHT + CARD_GAP) - CARD_GAP + REROLL_BUTTON_HEIGHT / 2 + 16;
    const freshChip = rerollButton === null;
    if (rerollButton === null) {
      rerollButton = new Button(
        scene,
        VIEW.centerX,
        rerollY,
        rerollLabel(reroll.rerollCost),
        () => {
          if (resolved || !reroll.canReroll()) return;
          const fresh = reroll.onReroll();
          layout(fresh);
        },
        { width: CARD_WIDTH, height: REROLL_BUTTON_HEIGHT, fill: PALETTE.bgTop, stroke: PALETTE.primary, textColor: CSS.ink, fontSize: '32px' },
      );
      root.add(rerollButton);
    } else {
      rerollButton.setPosition(VIEW.centerX, rerollY);
    }
    rerollButton.setAlpha(reroll.canReroll() ? 1 : 0.4);
    rerollButton.disableInteractive();
    if (reroll.canReroll()) rerollButton.setInteractive({ useHandCursor: true });
    // Entrance LAST, and only for a chip that did not exist yet: the three
    // states above (affordable / spent / unaffordable) replace the input object,
    // and a pinned entrance only pins the hit areas that exist when it runs.
    // `fadeTo` carries the chip's own resting alpha, so a chip that arrives
    // unaffordable lands dim instead of being faded up to look available.
    if (freshChip) {
      enterPinningHitArea(scene, rerollButton, {
        delayMs: current.length * 70,
        fadeTo: rerollButton.alpha,
      });
    }
  }

  layout(choices);

  return {
    destroy(): void {
      root.destroy(true);
    },
  };
}

function rerollLabel(cost: number): string {
  return cost > 0 ? `REROLL (${cost})` : 'REROLL (FREE)';
}

function buildCard(
  scene: Phaser.Scene,
  x: number,
  y: number,
  def: UpgradeDef,
  onTap: () => void,
): Phaser.GameObjects.Container {
  const container = scene.add.container(x, y);
  const color = RARITY_COLOR[def.rarity];

  // Primitive card: the rarity colour is the border, so a new rarity needs no
  // new asset. Drawn once per overlay, never per frame.
  const bg = drawPanel(scene, CARD_WIDTH, CARD_HEIGHT, {
    fill: PALETTE.bgTop,
    fillAlpha: 0.96,
    stroke: color,
    strokeAlpha: 0.95,
    strokeWidth: 5,
    radius: 28,
    gloss: true,
  });

  const rarityTag = scene.add
    .text(-CARD_WIDTH / 2 + 24, -CARD_HEIGHT / 2 + 18, def.rarity.toUpperCase(), {
      ...TEXT.label,
      color: Phaser.Display.Color.IntegerToColor(color).rgba,
    })
    .setOrigin(0, 0);

  const title = scene.add
    .text(-CARD_WIDTH / 2 + 24, -CARD_HEIGHT / 2 + 56, def.name, {
      ...TEXT.button,
      color: CSS.ink,
    })
    .setOrigin(0, 0);

  const description = scene.add
    .text(-CARD_WIDTH / 2 + 24, 12, def.description, {
      ...TEXT.body,
      wordWrap: { width: CARD_WIDTH - 48 },
    })
    .setOrigin(0, 0);

  container.add([bg, rarityTag, title, description]);
  container.setSize(CARD_WIDTH, CARD_HEIGHT);
  container.setScrollFactor(0);
  container.setInteractive({ useHandCursor: true });

  // Click semantics, not release semantics: Phaser fires POINTER_UP on whatever
  // sits under the pointer, so a release that *started* elsewhere (dragging the
  // joystick when the overlay opened) would otherwise pick a card by itself.
  let armed = false;

  container.on(Phaser.Input.Events.POINTER_OVER, () => {
    scene.tweens.add({ targets: container, scale: 1.02, duration: 120, ease: 'Quad.easeOut' });
  });
  container.on(Phaser.Input.Events.POINTER_OUT, () => {
    armed = false;
    scene.tweens.add({ targets: container, scale: 1, duration: 120 });
  });
  container.on(Phaser.Input.Events.POINTER_DOWN, () => {
    armed = true;
  });
  container.on(Phaser.Input.Events.POINTER_UP, () => {
    if (!armed) return;
    armed = false;
    onTap();
  });

  return container;
}
