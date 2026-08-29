import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../config';
import { drawPanel, paintPanel } from './primitives';

/**
 * Bottom-docked fan of hand cards for deckbuilders: each card is a >=88px tap
 * target drawn with primitives, tap-selects (highlight + `onNeedTarget` for
 * cards that require an aimed target) and drag-up past a threshold plays it
 * immediately via `onPlay` — the two most common deckbuilder card verbs.
 *
 * Redraws only on `setHand()` (a new hand array), never per frame; card
 * chrome is `drawPanel`/`paintPanel` so it re-skins with `PALETTE` and needs
 * no card-frame art asset. Every card is inside `SAFE` and every interactive
 * child gets `setScrollFactor(0)` individually, per the template's screen-UI
 * rule (a following camera hit-tests children against scroll independently).
 *
 * Use for: deckbuilder / roguelike-with-cards hand management.
 * Do NOT use for: a fixed small choice set shown once (see `ui/cards.ts`) or
 * a shop offer row (see `ui/shopTray.ts`).
 */

export interface HandCardDef {
  id: string;
  name: string;
  description: string;
  /** True if playing this card needs the player to pick a target before it resolves. */
  needsTarget?: boolean;
}

export interface HandViewOptions {
  onPlay(cardId: string): void;
  onNeedTarget(cardId: string): void;
  cardWidth?: number;
  cardHeight?: number;
}

const DRAG_PLAY_THRESHOLD_PX = 90;

interface CardEntry {
  def: HandCardDef;
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
}

export class HandView {
  private readonly scene: Phaser.Scene;
  private readonly opts: HandViewOptions;
  private readonly cardWidth: number;
  private readonly cardHeight: number;
  private readonly root: Phaser.GameObjects.Container;
  private entries: CardEntry[] = [];
  private selectedId: string | null = null;

  constructor(scene: Phaser.Scene, opts: HandViewOptions) {
    this.scene = scene;
    this.opts = opts;
    this.cardWidth = opts.cardWidth ?? 168;
    this.cardHeight = Math.max(88, opts.cardHeight ?? 236);
    this.root = scene.add.container(0, 0).setDepth(400).setScrollFactor(0);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  /** Rebuilds the fan for a new hand. Called only when the hand contents change. */
  setHand(cards: readonly HandCardDef[]): void {
    for (const entry of this.entries) entry.container.destroy();
    this.entries = [];
    this.selectedId = null;

    const gap = 18;
    const totalWidth = cards.length * this.cardWidth + Math.max(0, cards.length - 1) * gap;
    const dockY = VIEW.height - SAFE.bottom / 2;
    const startX = VIEW.centerX - totalWidth / 2 + this.cardWidth / 2;
    const maxWidth = VIEW.width - SAFE.side * 2;
    const overflow = totalWidth > maxWidth ? (totalWidth - maxWidth) / Math.max(1, cards.length - 1) : 0;

    cards.forEach((def, index) => {
      const x = startX + index * (this.cardWidth + gap - overflow);
      const entry = this.buildCard(def, x, dockY);
      this.root.add(entry.container);
      this.entries.push(entry);
    });
  }

  destroy(): void {
    this.root.destroy(true);
  }

  private buildCard(def: HandCardDef, x: number, y: number): CardEntry {
    const container = this.scene.add.container(x, y);
    const homeX = x;
    const homeY = y;

    const bg = drawPanel(this.scene, this.cardWidth, this.cardHeight, {
      fill: PALETTE.bgTop,
      fillAlpha: 0.97,
      stroke: PALETTE.primary,
      strokeAlpha: 0.6,
      radius: 20,
      gloss: true,
    });

    const title = this.scene.add
      .text(0, -this.cardHeight / 2 + 34, def.name, { ...TEXT.label, color: CSS.ink, fontSize: '24px' })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);

    const description = this.scene.add
      .text(0, -this.cardHeight / 2 + 74, def.description, {
        ...TEXT.label,
        wordWrap: { width: this.cardWidth - 24 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);

    container.add([bg, title, description]);
    container.setSize(this.cardWidth, this.cardHeight);
    container.setScrollFactor(0);
    container.setInteractive({ useHandCursor: true, draggable: true });
    this.scene.input.setDraggable(container);

    const entry: CardEntry = { def, container, bg };

    // Click semantics: arm on our own POINTER_DOWN, disarm on POINTER_OUT —
    // a release that only ends here (e.g. dragging the hand's own neighbour
    // card) must not count as a tap. Drag tracks its own start position
    // instead, since DRAG_START fires only once real movement is detected.
    let armed = false;
    let dragStartY = y;

    container.on(Phaser.Input.Events.POINTER_DOWN, () => {
      armed = true;
    });
    container.on(Phaser.Input.Events.POINTER_OUT, () => {
      armed = false;
    });
    container.on(Phaser.Input.Events.POINTER_UP, () => {
      if (!armed) return;
      armed = false;
      this.selectCard(entry);
    });

    container.on(Phaser.Input.Events.DRAG_START, () => {
      armed = false;
      dragStartY = container.y;
      container.setDepth(50);
    });
    container.on(Phaser.Input.Events.DRAG, (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      container.setPosition(dragX, dragY);
    });
    container.on(Phaser.Input.Events.DRAG_END, () => {
      container.setDepth(0);
      if (dragStartY - container.y >= DRAG_PLAY_THRESHOLD_PX) {
        this.playCard(entry);
        return;
      }
      container.setPosition(homeX, homeY);
    });

    return entry;
  }

  private selectCard(entry: CardEntry): void {
    if (entry.def.needsTarget === true) {
      this.selectedId = this.selectedId === entry.def.id ? null : entry.def.id;
      this.repaintSelection();
      if (this.selectedId === entry.def.id) this.opts.onNeedTarget(entry.def.id);
      return;
    }
    this.playCard(entry);
  }

  private playCard(entry: CardEntry): void {
    entry.container.destroy();
    this.entries = this.entries.filter((e) => e !== entry);
    this.opts.onPlay(entry.def.id);
  }

  private repaintSelection(): void {
    for (const entry of this.entries) {
      const isSelected = entry.def.id === this.selectedId;
      paintPanel(entry.bg, this.cardWidth, this.cardHeight, {
        fill: PALETTE.bgTop,
        fillAlpha: 0.97,
        stroke: isSelected ? PALETTE.accent : PALETTE.primary,
        strokeAlpha: isSelected ? 0.95 : 0.6,
        strokeWidth: isSelected ? 5 : 3,
        radius: 20,
        gloss: true,
      });
    }
  }
}
