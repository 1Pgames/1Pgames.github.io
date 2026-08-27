import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../config';
import { sfx } from '../core/audio';
import { pop } from '../core/juice';
import { Button } from './button';
import { drawPanel, drawPill, paintPill } from './primitives';

/**
 * Pre-level booster picker: the row of "start this level with a head start"
 * chips every level-based casual game shows between the map and the board.
 * Chips toggle, at most `maxPick` can be armed at once, and a booster the
 * player owns none of is visible but inert — the offer is part of the
 * economy's pressure, so it is never hidden.
 *
 * Pure presentation: the caller receives the armed ids in `onStart` and does
 * the spending itself (`progression.spendBooster`), which keeps the "did the
 * level actually begin" decision — and therefore the refund question — in one
 * place instead of half in the UI.
 *
 * Use for: the pre-level gate of a level-based family.
 * Do NOT use for: in-run consumables (that is a HUD button on the run scene).
 */

export interface BoosterOffer {
  id: string;
  name: string;
  count: number;
}

export interface BoosterPickerOptions {
  boosters: readonly BoosterOffer[];
  onStart: (selected: string[]) => void;
  /** Default 2 — three pre-level boosters trivialise a tuned level. */
  maxPick?: number;
}

export interface BoosterPickerHandle {
  destroy(): void;
}

const CHIP_HEIGHT = 96; // >= 88px tap target
const CHIP_GAP = 18;
const CHIPS_PER_ROW = 3;
const ROW_GAP = 16;
const START_HEIGHT = 112;

export function showBoosterPicker(scene: Phaser.Scene, opts: BoosterPickerOptions): BoosterPickerHandle {
  const maxPick = opts.maxPick ?? 2;
  const root = scene.add.container(0, 0).setDepth(2300).setScrollFactor(0);

  const dim = scene.add
    .rectangle(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height, 0x000000, 0.6)
    .setScrollFactor(0)
    .setInteractive();
  root.add(dim);

  const panelWidth = VIEW.width - SAFE.side * 2;
  const rows = Math.max(1, Math.ceil(opts.boosters.length / CHIPS_PER_ROW));
  const chipsHeight = rows * CHIP_HEIGHT + (rows - 1) * ROW_GAP;
  const panelHeight = chipsHeight + START_HEIGHT + 190;
  const panelCenterY = VIEW.centerY + 60;
  const panelTop = panelCenterY - panelHeight / 2;

  const panel = drawPanel(scene, panelWidth, panelHeight, {
    fill: PALETTE.bgTop,
    fillAlpha: 0.97,
    stroke: PALETTE.primary,
    strokeAlpha: 0.45,
    strokeWidth: 4,
    radius: 30,
  })
    .setPosition(VIEW.centerX, panelCenterY)
    .setScrollFactor(0);
  root.add(panel);

  const heading = scene.add
    .text(VIEW.centerX, panelTop + 46, 'BOOSTERS', { ...TEXT.heading, fontSize: '44px' })
    .setOrigin(0.5)
    .setScrollFactor(0);
  const hint = scene.add
    .text(VIEW.centerX, panelTop + 96, `PICK UP TO ${maxPick}`, { ...TEXT.label, color: CSS.inkSoft })
    .setOrigin(0.5)
    .setScrollFactor(0);
  root.add([heading, hint]);

  const selected: string[] = [];
  const chipWidth = (panelWidth - 48 - CHIP_GAP * (CHIPS_PER_ROW - 1)) / CHIPS_PER_ROW;
  const chipsTop = panelTop + 140;

  opts.boosters.forEach((offer, index) => {
    const row = Math.floor(index / CHIPS_PER_ROW);
    const column = index % CHIPS_PER_ROW;
    const inRow = Math.min(CHIPS_PER_ROW, opts.boosters.length - row * CHIPS_PER_ROW);
    const rowWidth = inRow * chipWidth + (inRow - 1) * CHIP_GAP;
    const x = VIEW.centerX - rowWidth / 2 + chipWidth / 2 + column * (chipWidth + CHIP_GAP);
    const y = chipsTop + row * (CHIP_HEIGHT + ROW_GAP) + CHIP_HEIGHT / 2;

    const chip = buildChip(scene, x, y, chipWidth, offer, (setArmed) => {
      const already = selected.indexOf(offer.id);
      if (already >= 0) {
        selected.splice(already, 1);
        setArmed(false);
        sfx('ui');
        return;
      }
      if (selected.length >= maxPick) {
        // Refusing is clearer than silently dropping someone else's pick.
        pop(scene, chip, 0.12, 140);
        sfx('hit');
        return;
      }
      selected.push(offer.id);
      setArmed(true);
      sfx('pickup');
    });
    root.add(chip);
  });

  const start = new Button(
    scene,
    VIEW.centerX,
    panelTop + panelHeight - START_HEIGHT / 2 - 28,
    'START',
    () => opts.onStart([...selected]),
    { width: panelWidth - 48, height: START_HEIGHT },
  );
  root.add(start);

  // Scene shutdown destroys children before SHUTDOWN listeners run, and a
  // listener touching a dead scene aborts the whole transition — own the scene
  // reference and guard against a second teardown (see `ui/bars.ts`).
  let destroyed = false;
  const host = scene;
  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    host.events.off(Phaser.Scenes.Events.SHUTDOWN, destroy);
    root.destroy(true);
  }
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, destroy);

  return { destroy };
}

function buildChip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  offer: BoosterOffer,
  onToggle: (setArmed: (armed: boolean) => void) => void,
): Phaser.GameObjects.Container {
  const chip = scene.add.container(x, y);
  const owned = offer.count > 0;

  const bg = drawPill(scene, width, CHIP_HEIGHT, {
    fill: PALETTE.bgBottom,
    stroke: PALETTE.inkSoft,
    strokeAlpha: 0.6,
    strokeWidth: 3,
  });
  const name = scene.add
    .text(0, -12, offer.name, { ...TEXT.label, color: CSS.ink, fontSize: '24px' })
    .setOrigin(0.5);
  const badge = scene.add
    .text(0, 22, `x${offer.count}`, { ...TEXT.label, color: owned ? CSS.accent : CSS.inkSoft })
    .setOrigin(0.5);

  chip.add([bg, name, badge]);
  chip.setSize(width, CHIP_HEIGHT);

  if (!owned) {
    chip.setAlpha(0.34);
    return chip;
  }

  // One repaint per state change, never per frame.
  const paint = (picked: boolean): void => {
    paintPill(bg, width, CHIP_HEIGHT, {
      fill: picked ? PALETTE.primary : PALETTE.bgBottom,
      stroke: picked ? PALETTE.accent : PALETTE.inkSoft,
      strokeAlpha: picked ? 0.95 : 0.6,
      strokeWidth: picked ? 5 : 3,
      gloss: picked,
    });
    name.setColor(picked ? '#05070d' : CSS.ink);
  };

  chip.setScrollFactor(0);
  chip.setInteractive({ useHandCursor: true });

  // Click semantics: arm on our own POINTER_DOWN, disarm on POINTER_OUT.
  let pressed = false;
  chip.on(Phaser.Input.Events.POINTER_DOWN, () => {
    pressed = true;
    chip.setScale(0.96);
  });
  chip.on(Phaser.Input.Events.POINTER_OUT, () => {
    pressed = false;
    chip.setScale(1);
  });
  chip.on(Phaser.Input.Events.POINTER_UP, () => {
    chip.setScale(1);
    if (!pressed) return;
    pressed = false;
    onToggle(paint);
  });

  return chip;
}
