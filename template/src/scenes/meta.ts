import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../config';
import { SCENES } from '../core/keys';
import { sfx } from '../core/audio';
import { floatText } from '../core/juice';
import {
  boosterPrice,
  buyBooster,
  buyMetaLevel,
  buyUpgrade,
  loadMeta,
} from '../core/progression';
import { upgradeCost } from '../data/upgrades';
import { metaCatalogFor, type MetaEntry } from '../data/metaCatalog';
import { SIM_FAMILY } from '../sim/family';
import { Button } from '../ui/button';
import { addBackground } from '../ui/background';
import { ICON } from '../data/art';
import { drawPanel } from '../ui/primitives';

/**
 * Between-run shop: spend meta currency on permanent levels of whatever
 * `metaCatalogFor(SIM_FAMILY)` (see `data/metaCatalog.ts`) offers this
 * family — arena stat upgrades, board boosters, idle perks. The scene is
 * family-agnostic: it dispatches on `MetaEntry.kind` and never names a
 * specific upgrade.
 *
 * Rows are laid out in a single scrolling column rather than paginated — a
 * handful of purchasables is a small, fixed catalog that reads better as one
 * continuous list you flick through than as numbered pages, and a
 * drag-clamped container plus a scissor camera is the smallest amount of code
 * that gets there without a plugin.
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
  def: MetaEntry;
  /** `OWNED n` for a consumable, `LEVEL n/N` for a capped stat or perk. */
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
  private readonly rowContainers: Phaser.GameObjects.Container[] = [];
  private dragging = false;
  private lastPointerY = 0;

  constructor() {
    super(SCENES.meta);
  }

  create(): void {
    // A Phaser Scene instance survives scene.start() round-trips: every field
    // above outlives the children it described. Reset the per-visit state, or
    // a second visit scrolls a list of destroyed rows from a stale offset.
    this.rows.length = 0;
    this.rowContainers.length = 0;
    this.scrollY = 0;
    this.dragging = false;

    addBackground(this);

    // Heading sits at SAFE.top, not above it: the site shell's back-link and
    // prompt chips own the top strip of the viewport on every published page.
    this.add
      .text(VIEW.centerX, SAFE.top, 'SHOP', TEXT.heading)
      .setOrigin(0.5);

    this.add
      .image(VIEW.centerX - 40, SAFE.top + 58, ICON.coin.key, ICON.coin.frame)
      .setDisplaySize(36, 36);
    this.currencyText = this.add
      .text(VIEW.centerX + 2, SAFE.top + 58, '0', { ...TEXT.body, color: CSS.accent })
      .setOrigin(0, 0.5);

    this.viewportTop = SAFE.top + 124;
    // Stop the list above the BACK button's footprint (button height plus the
    // generated chrome's transparent margin), otherwise rows show through it.
    const viewportBottom = VIEW.height - SAFE.bottom - 96;
    const viewportHeight = viewportBottom - this.viewportTop;

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

    // Phaser 4 removed GeometryMask/`setMask`, and a Filter mask per list is
    // overkill — but a CAMERA VIEWPORT is a true GPU scissor. The list lives
    // on its own camera whose viewport is exactly the list band: rows scroll
    // continuously and are CLIPPED at the band's edges (never hidden, never
    // faded), so the heading above and BACK below stay clean at all times.
    // The camera's scroll matches its viewport origin, so world->screen is
    // identity — the same coordinates, hit areas and drag math as before.
    this.content = this.add.container(VIEW.centerX, this.viewportTop);

    const entries = metaCatalogFor(SIM_FAMILY);
    entries.forEach((def, index) => {
      const y = index * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2;
      const row = this.buildRow(def, y);
      this.content.add(row);
      this.rowContainers.push(row);
    });

    // A family that has not authored a catalog yet still gets a coherent
    // screen instead of an empty scroll area.
    if (entries.length === 0) {
      this.add
        .text(
          VIEW.centerX,
          this.viewportTop + 140,
          'NOTHING TO BUY YET\n\nCoins keep piling up\nfor the next unlock.',
          { ...TEXT.body, align: 'center', color: CSS.inkSoft },
        )
        .setOrigin(0.5)
        .setLineSpacing(6);
    }

    const contentHeight = entries.length * (ROW_HEIGHT + ROW_GAP) - ROW_GAP;
    this.maxScroll = Math.max(0, contentHeight - viewportHeight);

    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (!this.dragging) return;
      const dy = pointer.y - this.lastPointerY;
      this.lastPointerY = pointer.y;
      this.scrollY = Phaser.Math.Clamp(this.scrollY - dy, 0, this.maxScroll);
      this.content.y = this.viewportTop - this.scrollY;
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

    // Scissor camera goes in LAST so it can ignore every non-list object
    // built above; the main camera ignores the list in return. Objects born
    // later (buy floats) belong to the main camera only.
    const listCam = this.cameras.add(SAFE.side, this.viewportTop, ROW_WIDTH, viewportHeight);
    listCam.setScroll(SAFE.side, this.viewportTop);
    this.cameras.main.ignore(this.content);
    for (const child of this.children.list) {
      if (child !== this.content) listCam.ignore(child);
    }
    // Scene events OUTLIVE a scene.start() round-trip: an ADDED_TO_SCENE
    // listener left behind would keep ignoring objects against the DESTROYED
    // camera's id on the next visit — whose id the fresh list camera reuses,
    // which blanks the whole shop. Unhook it with the scene shutdown.
    const onAdded = (obj: Phaser.GameObjects.GameObject) => {
      if (obj !== this.content && obj.parentContainer === null) listCam.ignore(obj);
    };
    this.events.on(Phaser.GameObjects.Events.ADDED_TO_SCENE, onAdded);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.GameObjects.Events.ADDED_TO_SCENE, onAdded);
    });

    this.refresh();
    this.cameras.main.fadeIn(240, 0, 0, 0);
    listCam.fadeIn(240, 0, 0, 0);
  }

  private buildRow(def: MetaEntry, y: number): Phaser.GameObjects.Container {
    const row = this.add.container(0, y);

    const bg = drawPanel(this, ROW_WIDTH, ROW_HEIGHT, {
      fill: PALETTE.bgTop,
      fillAlpha: 0.92,
      stroke: PALETTE.primary,
      strokeAlpha: 0.4,
      strokeWidth: 3,
      radius: 26,
    });
    row.add(bg);

    // The booster's own icon anchors the card; the name sits beside it. An id
    // and its icon key can disagree ('bomb-start' fires the 'opening-bomb'
    // art), hence the alias — and `data/art.ts` only names icons that were
    // actually drawn, so reading the registry through a loose index means a
    // missing key is `undefined` and the card simply falls back to text.
    let nameX = -ROW_WIDTH / 2 + 24;
    const iconKey = def.boosterId === 'bomb-start' ? 'opening-bomb' : def.boosterId;
    const slot = iconKey !== undefined ? (ICON as Record<string, { key: string; frame: number } | undefined>)[iconKey] : undefined;
    if (slot !== undefined && this.textures.exists(slot.key)) {
      row.add(
        this.add
          .image(-ROW_WIDTH / 2 + 46, -ROW_HEIGHT / 2 + 40, slot.key, slot.frame)
          .setDisplaySize(44, 44),
      );
      nameX = -ROW_WIDTH / 2 + 78;
    }

    const name = this.add
      .text(nameX, -ROW_HEIGHT / 2 + 18, def.name, { ...TEXT.button, fontSize: '34px' })
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

    const buyX = ROW_WIDTH / 2 - BUY_WIDTH / 2 - 20;
    const buyButton = new Button(this, buyX, 0, '', () => this.onBuy(def), {
      width: BUY_WIDTH,
      height: BUY_HEIGHT,
      fontSize: '30px',
    });
    // Button pins itself with scrollFactor 0 ("screen furniture"), which is
    // right under the main camera but WRONG inside the list camera: that
    // camera's base scroll equals its viewport origin, so a factor-0 object
    // renders offset by exactly that origin. Rows scroll WITH the content —
    // restore factor 1 on the whole button tree.
    buyButton.setScrollFactor(1, 1, true);

    // Price is coins: say so with the coin glyph pinned inside the pill's left
    // pad (non-interactive, so the button underneath keeps the whole tap).
    const coin = this.add
      .image(buyX - BUY_WIDTH / 2 + 30, 0, ICON.coin.key, ICON.coin.frame)
      .setDisplaySize(30, 30);

    row.add([name, levelText, description, buyButton, coin]);

    this.rows.push({ def, levelText, buyButton });
    return row;
  }

  private onBuy(def: MetaEntry): void {
    const boosterId = def.boosterId;
    if (def.kind === 'booster' && boosterId !== undefined) {
      // Consumables are UNCAPPED: `buyBooster` pays the escalating price and
      // stocks the bag in one write, so there is no second grant here (and no
      // 'max level reached' branch to render).
      const result = buyBooster({
        id: def.id,
        boosterId,
        baseCost: def.baseCost,
        costGrowth: def.costGrowth,
        boosterPerLevel: def.boosterPerLevel,
      });
      if (result.ok) {
        sfx('ui');
        floatText(this, VIEW.centerX, this.viewportTop - 40, `-${result.cost}`, CSS.accent);
      } else {
        sfx('hit');
        floatText(this, VIEW.centerX, this.viewportTop - 40, 'NOT ENOUGH COINS', CSS.bad);
      }
      this.refresh();
      return;
    }

    const level = loadMeta().upgrades[def.id] ?? 0;
    const cost = upgradeCost(def, level);
    // `stat` entries route through `buyUpgrade` so the id is checked against
    // `META_UPGRADES` — a stat level nothing turns into a `Modifier` is an
    // authoring bug, and it should read as UNAVAILABLE, not sell silently.
    const result = def.kind === 'stat' ? buyUpgrade(def.id) : buyMetaLevel(def);
    if (result.ok) {
      sfx('ui');
      floatText(this, VIEW.centerX, this.viewportTop - 40, `-${cost}`, CSS.accent);
    } else {
      sfx('hit');
      const message =
        result.reason === 'max level reached'
          ? 'MAXED'
          : result.reason === 'not enough currency'
            ? 'NOT ENOUGH COINS'
            : 'UNAVAILABLE';
      floatText(this, VIEW.centerX, this.viewportTop - 40, message, CSS.bad);
    }
    this.refresh();
  }

  /** Re-reads meta state and repaints currency + every row's stock/price/affordability. */
  private refresh(): void {
    const meta = loadMeta();
    this.currencyText.setText(`${meta.currency}`);

    for (const row of this.rows) {
      const boosterId = row.def.boosterId;
      if (row.def.kind === 'booster' && boosterId !== undefined) {
        // A consumable's row shows the STOCK, never a purchase cap: "BOUGHT
        // 3/10" cannot tell you whether you already spent them, and the price
        // escalates on what is in the bag, so it falls back down as you play.
        const cost = boosterPrice({
          boosterId,
          baseCost: row.def.baseCost,
          costGrowth: row.def.costGrowth,
        });
        row.levelText.setText(`OWNED ${meta.boosters[boosterId] ?? 0}`);
        row.buyButton.setLabel(`${cost}`);
        row.buyButton.setAlpha(meta.currency >= cost ? 1 : 0.5);
        continue;
      }

      const level = meta.upgrades[row.def.id] ?? 0;
      row.levelText.setText(`LEVEL ${level}/${row.def.maxLevel}`);
      if (level >= row.def.maxLevel) {
        row.buyButton.setLabel('MAXED');
        row.buyButton.setAlpha(0.4);
        continue;
      }
      const cost = upgradeCost(row.def, level);
      row.buyButton.setLabel(`${cost}`);
      row.buyButton.setAlpha(meta.currency >= cost ? 1 : 0.5);
    }
  }
}
