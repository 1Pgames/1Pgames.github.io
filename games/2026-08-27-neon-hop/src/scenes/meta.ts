import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../config';
import { SCENES } from '../core/keys';
import { sfx } from '../core/audio';
import { floatText } from '../core/juice';
import { buyUpgrade, loadMeta } from '../core/progression';
import { META_UPGRADES, upgradeCost, type MetaUpgradeDef } from '../data/upgrades';
import { Button } from '../ui/button';
import { addBackground } from '../ui/background';
import { ICON } from '../data/art';
import { drawPanel } from '../ui/primitives';

/**
 * Between-run shop: spend meta currency on permanent `META_UPGRADES` levels
 * via `core/progression.ts`'s `buyUpgrade`. Rows are laid out in a single
 * scrolling column rather than paginated — six upgrades is a small, fixed
 * catalog that reads better as one continuous list you flick through than as
 * numbered pages, and a drag-clamped container is the smallest amount of
 * code that gets there without a plugin (Phaser ships `GeometryMask` and
 * pointer events natively; no scroll plugin needed).
 *
 * Use for: the permanent meta-upgrade shop between runs.
 * Do NOT use for: the in-run "pick 1 of 3" draft — that is `ui/cards.ts`.
 */

const ROW_WIDTH = VIEW.width - SAFE.side * 2;
const ROW_HEIGHT = 176;
const ROW_GAP = 22;
const BUY_WIDTH = 168;
const BUY_HEIGHT = 76;

interface Row {
  def: MetaUpgradeDef;
  levelText: Phaser.GameObjects.Text;
  buyButton: Button;
}

export class MetaScene extends Phaser.Scene {
  private currencyText!: Phaser.GameObjects.Text;
  private content!: Phaser.GameObjects.Container;
  private readonly rows: Row[] = [];
  private maxScroll = 0;
  private scrollY = 0;
  private viewportTop = 0;
  private viewportBottom = 0;
  private readonly rowContainers: Phaser.GameObjects.Container[] = [];
  private dragging = false;
  private lastPointerY = 0;

  constructor() {
    super(SCENES.meta);
  }

  create(): void {
    addBackground(this);

    this.add
      .text(VIEW.centerX, SAFE.top - 60, 'UPGRADES', TEXT.heading)
      .setOrigin(0.5);

    this.add
      .image(VIEW.centerX - 40, SAFE.top, ICON.coin.key, ICON.coin.frame)
      .setDisplaySize(36, 36);
    this.currencyText = this.add
      .text(VIEW.centerX + 2, SAFE.top, '0', { ...TEXT.body, color: CSS.accent })
      .setOrigin(0, 0.5);

    this.viewportTop = SAFE.top + 70;
    // Stop the list above the BACK button's footprint (button height plus the
    // generated chrome's transparent margin), otherwise rows show through it.
    const viewportBottom = VIEW.height - SAFE.bottom - 96;
    const viewportHeight = viewportBottom - this.viewportTop;

    this.viewportBottom = viewportBottom;

    // Phaser 4 removed GeometryMask/`setMask`: masks are Filters now, and a
    // filter per scrolling list is not worth it for six rows. Rows outside the
    // viewport are simply hidden on scroll (see `cullRows`).
    this.content = this.add.container(VIEW.centerX, this.viewportTop);

    META_UPGRADES.forEach((def, index) => {
      const y = index * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2;
      const row = this.buildRow(def, y);
      this.content.add(row);
      this.rowContainers.push(row);
    });

    const contentHeight = META_UPGRADES.length * (ROW_HEIGHT + ROW_GAP) - ROW_GAP;
    this.maxScroll = Math.max(0, contentHeight - viewportHeight);

    // Drag-scroll: a zone under the rows catches drags anywhere that isn't a
    // buy button (rows themselves are non-interactive), so scrolling and
    // tapping never fight over the same pointer event.
    const scrollZone = this.add
      .zone(SAFE.side, this.viewportTop, ROW_WIDTH, viewportHeight)
      .setOrigin(0, 0)
      .setInteractive();
    scrollZone.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      this.dragging = true;
      this.lastPointerY = pointer.y;
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (!this.dragging) return;
      const dy = pointer.y - this.lastPointerY;
      this.lastPointerY = pointer.y;
      this.scrollY = Phaser.Math.Clamp(this.scrollY - dy, 0, this.maxScroll);
      this.content.y = this.viewportTop - this.scrollY;
      this.cullRows();
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      this.dragging = false;
    });

    const buttonWidth = VIEW.width - SAFE.side * 2;
    new Button(this, VIEW.centerX, VIEW.height - SAFE.bottom, 'BACK', () => this.scene.start(SCENES.menu), {
      width: buttonWidth,
      height: 96,
      fill: PALETTE.bgTop, stroke: PALETTE.primary,
      textColor: CSS.ink,
    });

    this.cullRows();
    this.refresh();
    this.cameras.main.fadeIn(240, 0, 0, 0);
  }

  /**
   * Hides rows that scrolled out of the viewport. Cheaper and more predictable
   * than a mask filter, and it also stops off-list buy buttons from swallowing
   * taps meant for the BACK button.
   */
  private cullRows(): void {
    for (const row of this.rowContainers) {
      const worldY = this.content.y + row.y;
      const visible =
        worldY + ROW_HEIGHT / 2 > this.viewportTop && worldY - ROW_HEIGHT / 2 < this.viewportBottom;
      if (row.visible !== visible) row.setVisible(visible);
    }
  }

  private buildRow(def: MetaUpgradeDef, y: number): Phaser.GameObjects.Container {
    const row = this.add.container(0, y);

    const bg = drawPanel(this, ROW_WIDTH, ROW_HEIGHT, {
      fill: PALETTE.bgTop,
      fillAlpha: 0.92,
      stroke: PALETTE.primary,
      strokeAlpha: 0.4,
      strokeWidth: 3,
      radius: 26,
    });

    const name = this.add
      .text(-ROW_WIDTH / 2 + 24, -ROW_HEIGHT / 2 + 18, def.name, { ...TEXT.button, fontSize: '34px' })
      .setOrigin(0, 0);

    const levelText = this.add
      .text(-ROW_WIDTH / 2 + 24, -ROW_HEIGHT / 2 + 64, '', { ...TEXT.label, color: CSS.primary })
      .setOrigin(0, 0);

    const description = this.add
      .text(-ROW_WIDTH / 2 + 24, -ROW_HEIGHT / 2 + 100, def.description, {
        ...TEXT.body,
        fontSize: '26px',
        wordWrap: { width: ROW_WIDTH - BUY_WIDTH - 80 },
      })
      .setOrigin(0, 0);

    const buyButton = new Button(this, ROW_WIDTH / 2 - BUY_WIDTH / 2 - 20, 0, '', () => this.onBuy(def), {
      width: BUY_WIDTH,
      height: BUY_HEIGHT,
      fontSize: '30px',
    });

    row.add([bg, name, levelText, description, buyButton]);
    this.rows.push({ def, levelText, buyButton });
    return row;
  }

  private onBuy(def: MetaUpgradeDef): void {
    const before = loadMeta();
    const level = before.upgrades[def.id] ?? 0;
    const cost = upgradeCost(def, level);
    const result = buyUpgrade(def.id);
    if (result.ok) {
      sfx('ui');
      floatText(this, VIEW.centerX, this.viewportTop - 40, `-${cost}`, CSS.accent);
    } else {
      sfx('hit');
      floatText(
        this,
        VIEW.centerX,
        this.viewportTop - 40,
        result.reason === 'max level reached' ? 'MAXED' : 'NOT ENOUGH COINS',
        CSS.bad,
      );
    }
    this.refresh();
  }

  /** Re-reads meta state and repaints currency + every row's level/price/affordability. */
  private refresh(): void {
    const meta = loadMeta();
    this.currencyText.setText(`${meta.currency}`);

    for (const row of this.rows) {
      const level = meta.upgrades[row.def.id] ?? 0;
      const maxed = level >= row.def.maxLevel;
      row.levelText.setText(`LEVEL ${level}/${row.def.maxLevel}`);

      if (maxed) {
        row.buyButton.setLabel('MAXED');
        row.buyButton.setAlpha(0.4);
        continue;
      }
      const cost = upgradeCost(row.def, level);
      const affordable = meta.currency >= cost;
      row.buyButton.setLabel(`${cost}`);
      row.buyButton.setAlpha(affordable ? 1 : 0.5);
    }
  }
}
