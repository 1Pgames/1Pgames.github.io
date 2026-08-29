import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW, bareText } from '../config';
import { SCENES } from '../core/keys';
import { sfx } from '../core/audio';
import { floatText } from '../core/juice';
import {
  buyMetaLevel,
  buyUpgrade,
  equipGear,
  loadMeta,
  salvageFromStash,
  type MetaSave,
} from '../core/progression';
import { upgradeCost } from '../data/upgrades';
import { metaCatalogFor, type MetaEntry } from '../data/metaCatalog';
import { SIM_FAMILY } from '../sim/family';
import { Button } from '../ui/button';
import { addBackground } from '../ui/background';
import { ICON } from '../data/art';
import {
  BUTTON_STYLE,
  DISABLED_ALPHA,
  IDENTITY,
  PANEL,
  SCRIM,
  drawDuskPanel,
  tierColor,
} from '../ui/duskChrome';
import { RELICS, TIER_NAMES, relicDef, salvageFor, type RelicSlot } from '../data/relics';
import { ZONES } from '../data/zones';

/**
 * The stash and shop (§14.5 "Meta stash/shop"), three groups down one
 * drag-scrolled list:
 *
 * - **GEAR** — 3 slots as 200x200 cells; a tap cycles the banked relics that
 *   fit that slot, including back to empty. Reversible in place, so it never
 *   confirms (§14b).
 * - **STASH** — one row per banked relic with a SALVAGE button. Gilded and
 *   Dread salvage ARMS first ("SURE? TAP AGAIN", 3s) because a Dread relic is
 *   minutes of play plus a Warden kill; Tarnished and Burnished commit at once,
 *   because confirming a 10-shard trinket is a tax on taps.
 * - **UPGRADES** — the 12-row §10 tree: name, effect, stack pips, cost button.
 *
 * The list is CLIPPED by its own camera viewport — a real GPU scissor, since
 * Phaser 4 has no `setMask` — with identity scroll and mutual `ignore`. Rows
 * scroll continuously and are cut at the band's edges; nothing is hidden or
 * faded at the boundary, which reads as broken.
 *
 * Three template traps are live here and all three are load-bearing:
 * 1. The scroll zone is created BEFORE the rows it scrolls. Phaser hands the
 *    pointer to the TOPMOST interactive object only, so a zone created after
 *    the buttons swallows every tap in the list.
 * 2. `ui/button.ts` pins itself at scrollFactor 0, which renders offset by the
 *    list camera's origin — every button inside the list restores factor 1.
 * 3. The `ADDED_TO_SCENE` listener that keeps the list camera honest OUTLIVES a
 *    `scene.start()` round-trip, and the fresh camera REUSES the destroyed
 *    camera's id — so it is unhooked on `SHUTDOWN`, or the second visit comes
 *    up blank.
 */

const LIST_WIDTH = VIEW.width - SAFE.side * 2;

/** §14.5: shard total pinned top-right at (680, 24) — right of the shell corner. */
const SHARDS = { x: 680, y: 24 } as const;

/** §14.5 cell/button geometry. */
const GEAR_CELL = 200;
const GEAR_GAP = 20;
const SALVAGE = { width: 160, height: 88 } as const;
const STASH_ROW = 104;
const UPGRADE_ROW = 140;
const GROUP_HEADER = 68;
const ROW_GAP = 16;

/** §14b confirmation policy: an arm decays silently after 3s. */
const ARM_MS = 3000;

/** Salvaging one of these arms first — minutes of play, not seconds. */
const CONFIRM_TIERS = new Set([3, 4]);

const SLOT_ORDER: readonly RelicSlot[] = ['blade', 'shroud', 'trinket'];

interface UpgradeRow {
  def: MetaEntry;
  pips: Phaser.GameObjects.Graphics;
  buyButton: Button;
  levelText: Phaser.GameObjects.Text;
}

export class MetaScene extends Phaser.Scene {
  private shardText!: Phaser.GameObjects.Text;
  /** Null when the icon sheet is unloaded — the count alone still reads. */
  private shardIcon: Phaser.GameObjects.Image | null = null;
  private headerText!: Phaser.GameObjects.Text;
  private content!: Phaser.GameObjects.Container;
  private listCam!: Phaser.Cameras.Scene2D.Camera;

  private upgradeRows: UpgradeRow[] = [];
  private maxScroll = 0;
  private scrollY = 0;
  private viewportTop = 0;
  private viewportHeight = 0;
  private dragging = false;
  private lastPointerY = 0;

  /** Stash index -> the time this row's SALVAGE arm expires. */
  private armed = new Map<number, number>();
  /**
   * Stash index -> that row's SALVAGE button, so the ARM STATE LIVES ON THE
   * BUTTON. The confirmation used to be a `floatText` at the top of the
   * viewport: a "SURE? TAP AGAIN" warning floating hundreds of pixels away
   * from the control it referred to, with nothing tying the two together. This
   * is the only two-tap confirm in the game and it guards permanently
   * destroying a Dread relic — the most valuable object a player owns — so the
   * thing that is about to happen and the thing you tap to make it happen have
   * to be the same object.
   *
   * Cleared on every `rebuild`: the buttons it holds are destroyed with the
   * list content.
   */
  private salvageButtons = new Map<number, Button>();
  private armTimers: Phaser.Time.TimerEvent[] = [];

  /**
   * True while `rebuild` runs. The `ADDED_TO_SCENE` hook must not claim objects
   * that are about to be parented INTO the list.
   */
  private building = false;

  constructor() {
    super(SCENES.meta);
  }

  create(): void {
    // A Scene INSTANCE survives scene.start(): every field above outlives the
    // children it described. Reset per-visit state at the top of create.
    this.upgradeRows = [];
    this.scrollY = 0;
    this.dragging = false;
    this.armed = new Map();
    this.salvageButtons = new Map();
    this.armTimers = [];
    this.building = false;

    addBackground(this);
    const meta = loadMeta();

    this.headerText = this.add
      .text(VIEW.centerX, SAFE.top - 28, this.headerFor(meta), {
        ...TEXT.heading,
        fontSize: '44px',
        color: CSS.ink,
        align: 'center',
      })
      .setOrigin(0.5);

    // Right-aligned CLUSTER: the count grows leftwards from 680, so the glyph
    // is placed against the text's measured left edge rather than at a fixed
    // x. It used to sit at 680-96, which left a 68px hole beside a 1-digit
    // total and read as a stray floating icon.
    this.shardIcon =
      this.textures.exists(ICON.shard.key)
        ? this.add.image(0, SHARDS.y + 18, ICON.shard.key, ICON.shard.frame).setDisplaySize(30, 30)
        : null;
    this.shardText = this.add
      .text(SHARDS.x, SHARDS.y, `${meta.currency}`, {
        ...TEXT.heading,
        fontSize: '34px',
        color: CSS.accent,
      })
      .setOrigin(1, 0);
    this.layoutShardCluster();

    this.viewportTop = SAFE.top + 60;
    // Stop the list clear of the BACK button's footprint, or rows show through it.
    this.viewportHeight = VIEW.height - SAFE.bottom - 96 - this.viewportTop;

    // §14.4 scrim for the list band. The generated `bg-menu` backdrop's lit
    // horizon runs straight through y 600-800, so the group headers, the empty
    // hints and the 0.92-alpha row panels all sat on the brightest art in the
    // game — the mountains were visible THROUGH the upgrade rows. The veil is
    // a plain rect (not `paintScrim`) because the band is the camera viewport,
    // not a text-block-sized region, and it must not scroll with the content:
    // it goes on the MAIN camera, under the list camera's scissor.
    this.add
      .rectangle(
        VIEW.centerX,
        this.viewportTop + this.viewportHeight / 2,
        LIST_WIDTH + SCRIM.pad * 2,
        this.viewportHeight,
        SCRIM.fill,
        SCRIM.alpha,
      )
      .setDepth(-100);

    // TRAP 1: the scroll zone goes in BEFORE the rows.
    const scrollZone = this.add
      .zone(SAFE.side, this.viewportTop, LIST_WIDTH, this.viewportHeight)
      .setOrigin(0, 0)
      .setInteractive();
    scrollZone.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      this.dragging = true;
      this.lastPointerY = pointer.y;
    });

    this.content = this.add.container(VIEW.centerX, this.viewportTop);

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

    new Button(
      this,
      VIEW.centerX,
      VIEW.height - SAFE.bottom,
      'BACK',
      () => this.scene.start(SCENES.menu),
      { width: LIST_WIDTH, height: 96, ...BUTTON_STYLE.idle },
    );

    // The scissor camera goes in LAST so it can ignore every non-list object
    // built above; the main camera ignores the list in return.
    this.listCam = this.cameras.add(SAFE.side, this.viewportTop, LIST_WIDTH, this.viewportHeight);
    this.listCam.setScroll(SAFE.side, this.viewportTop);
    for (const child of this.children.list) {
      if (child !== this.content) this.listCam.ignore(child);
    }

    // TRAP 3: this listener outlives a scene.start() round-trip, and the next
    // visit's camera reuses this one's id — which blanks the shop. Unhook it,
    // and take the arm timers down with it so a pending callback cannot fire
    // into a destroyed scene.
    const onAdded = (obj: Phaser.GameObjects.GameObject): void => {
      if (this.building) return;
      if (obj !== this.content && obj.parentContainer === null) this.listCam.ignore(obj);
    };
    this.events.on(Phaser.GameObjects.Events.ADDED_TO_SCENE, onAdded);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.GameObjects.Events.ADDED_TO_SCENE, onAdded);
      for (const timer of this.armTimers) timer.remove();
      this.armTimers = [];
    });

    // Built after the cameras exist, so `rebuild`'s own filter fix-up is the
    // one code path that ever has to get this right — including on re-entry.
    this.rebuild();

    this.cameras.main.fadeIn(240, 0, 0, 0);
    this.listCam.fadeIn(240, 0, 0, 0);
  }

  /** §14b: full tree + every zone unlocked swaps the header. */
  private headerFor(meta: MetaSave): string {
    const catalog = metaCatalogFor(SIM_FAMILY);
    const treeMaxed =
      catalog.length > 0 && catalog.every((def) => (meta.upgrades[def.id] ?? 0) >= def.maxLevel);
    const zonesOwned = ZONES.every(
      (zone) => zone.unlockShards === 0 || meta.unlocks.includes(`zone:${zone.id}`),
    );
    return treeMaxed && zonesOwned ? 'THE DARK REMEMBERS YOU' : 'STASH';
  }

  /**
   * Keeps the shard glyph welded to the left edge of the count. The number is
   * right-aligned to the authored (680, 24), so its left edge MOVES with the
   * digit count and a fixed icon x cannot stay attached to it.
   */
  private layoutShardCluster(): void {
    if (this.shardIcon === null) return;
    this.shardIcon.setX(this.shardText.getBounds().left - 8 - this.shardIcon.displayWidth / 2);
  }

  /**
   * Rebuilds the whole list. Structural actions (equip, salvage) change the ROW
   * COUNT, so a repaint-in-place would have to reconcile two orderings;
   * rebuilding a ~30-row list on a tap the player just made is cheaper than the
   * bug reconciliation would eventually hide. The scroll offset is preserved so
   * the row you tapped stays where you tapped it.
   */
  private rebuild(): void {
    this.building = true;
    for (const timer of this.armTimers) timer.remove();
    this.armTimers = [];
    // The buttons in here are about to be destroyed with the list content.
    this.salvageButtons.clear();
    this.upgradeRows = [];
    this.content.removeAll(true);

    const meta = loadMeta();
    let y = 0;

    y = this.addGroupHeader('GEAR', y);
    y = this.addGearRow(meta, y);
    y = this.addGroupHeader('STASH', y);
    y = this.addStashRows(meta, y);
    y = this.addGroupHeader('UPGRADES', y);
    y = this.addUpgradeRows(meta, y);

    this.maxScroll = Math.max(0, y - this.viewportHeight);
    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, this.maxScroll);
    this.content.y = this.viewportTop - this.scrollY;

    this.building = false;
    // Re-apply the main camera's ignore: it is recursive AT CALL TIME, so
    // children added after an earlier call would otherwise render twice — once
    // correctly inside the list camera and once offset in the main one.
    this.cameras.main.ignore(this.content);

    this.headerText.setText(this.headerFor(meta));
    this.shardText.setText(`${meta.currency}`);
    this.layoutShardCluster();
  }

  private addGroupHeader(label: string, y: number): number {
    this.content.add(
      this.add
        .text(-LIST_WIDTH / 2, y + 18, label, {
          ...TEXT.button,
          fontSize: '30px',
          color: CSS.inkSoft,
        })
        .setOrigin(0, 0),
    );
    return y + GROUP_HEADER;
  }

  // --- GEAR ----------------------------------------------------------------

  private addGearRow(meta: MetaSave, y: number): number {
    const centerY = y + GEAR_CELL / 2;
    SLOT_ORDER.forEach((slot, index) => {
      const x = (index - 1) * (GEAR_CELL + GEAR_GAP);
      this.content.add(this.buildGearCell(meta, slot, x, centerY));
    });
    return y + GEAR_CELL + ROW_GAP;
  }

  private buildGearCell(
    meta: MetaSave,
    slot: RelicSlot,
    x: number,
    y: number,
  ): Phaser.GameObjects.Container {
    const cell = this.add.container(x, y);
    const equippedId = meta.gear[slot];
    const equipped = equippedId === null ? null : relicDef(equippedId);

    cell.add(
      drawDuskPanel(this, GEAR_CELL, GEAR_CELL, {
        stroke: equipped === null ? PANEL.stroke : PALETTE.accent,
        strokeAlpha: equipped === null ? PANEL.strokeAlpha : 0.9,
      }),
    );
    cell.add(
      this.add
        .text(0, -GEAR_CELL / 2 + 20, slot.toUpperCase(), {
          ...TEXT.label,
          fontSize: '22px',
          color: CSS.inkSoft,
          ...bareText(),
        })
        .setOrigin(0.5),
    );

    if (equipped === null) {
      // §14b edge state: an empty cell is a designed ghost, not a blank panel —
      // and the ghost has to tell the TRUTH. "NO RELIC BANKED" was printed
      // whenever the slot was merely EMPTY, so a player with a Dread Crown
      // listed in the STASH group directly below read "NO RELIC BANKED" on the
      // BLADE cell that would equip it. Empty-and-nothing-to-put-in-it and
      // empty-but-one-tap-away are different states and get different copy.
      const hasOption = meta.stash.some((id) => relicDef(id).slot === slot);
      cell.add(
        this.add
          .text(0, 6, hasOption ? 'TAP TO\nEQUIP' : 'NO RELIC\nBANKED', {
            ...TEXT.label,
            fontSize: '22px',
            color: CSS.inkSoft,
            align: 'center',
            ...bareText(),
          })
          .setOrigin(0.5)
          .setAlpha(0.6),
      );
    } else {
      const swatch = this.add.graphics();
      swatch.fillStyle(tierColor(equipped.tier), 1);
      swatch.fillCircle(0, -28, 18);
      // The mandatory 2px tier ring — tier 2 Burnished is 2.91:1 unringed.
      swatch.lineStyle(2, IDENTITY.cooled, 1);
      swatch.strokeCircle(0, -28, 18);
      cell.add(swatch);
      cell.add(
        this.add
          .text(0, 0, equipped.name, {
            ...TEXT.body,
            fontSize: '22px',
            color: CSS.ink,
            align: 'center',
            wordWrap: { width: GEAR_CELL - 24 },
            ...bareText(),
          })
          .setOrigin(0.5, 0),
      );
      cell.add(
        this.add
          .text(0, GEAR_CELL / 2 - 32, this.gearEffectLine(equipped.id), {
            ...TEXT.label,
            fontSize: '19px',
            color: CSS.primary,
            align: 'center',
            ...bareText(),
          })
          .setOrigin(0.5),
      );
    }

    const zone = this.add.zone(0, 0, GEAR_CELL, GEAR_CELL).setInteractive({ useHandCursor: true });
    // Click semantics: arm on our own POINTER_DOWN, disarm on POINTER_OUT. A
    // release that merely ENDED here (a flick-scroll) must not equip.
    let armed = false;
    zone.on(Phaser.Input.Events.POINTER_DOWN, () => {
      armed = true;
    });
    zone.on(Phaser.Input.Events.POINTER_OUT, () => {
      armed = false;
    });
    zone.on(Phaser.Input.Events.POINTER_UP, () => {
      if (!armed) return;
      armed = false;
      this.cycleGear(slot);
    });
    cell.add(zone);
    return cell;
  }

  /**
   * The relic's gear effect in the player's terms, from its own mods.
   *
   * The sign comes from the VALUE, not from a hardcoded '+': `cooldownMul` is
   * authored as -0.06 because less cooldown is the buff, and a naive prefix
   * rendered that as "+-6%".
   */
  private gearEffectLine(relicId: string): string {
    const def = relicDef(relicId);
    const parts = def.gear.map((mod) => {
      const amount = mod.mul !== undefined ? Math.round(mod.mul * 100) : (mod.add ?? 0);
      const unit = mod.mul !== undefined ? '%' : '';
      return `${mod.stat} ${amount < 0 ? '' : '+'}${amount}${unit}`;
    });
    return parts.join('\n');
  }

  /**
   * Cycles this slot through [nothing, ...banked relics that fit it]. Cycling
   * rather than opening a picker is the §14.5 contract, and it keeps the whole
   * interaction at one tap with no modal to escape from.
   */
  private cycleGear(slot: RelicSlot): void {
    const meta = loadMeta();
    const banked = new Set(meta.stash);
    const options: (string | null)[] = [null];
    for (const relic of RELICS) {
      if (relic.slot === slot && banked.has(relic.id)) options.push(relic.id);
    }

    if (options.length === 1) {
      // Nothing to cycle to: refuse WITH feedback and name the reason, rather
      // than eating the tap (a silent control reads as broken).
      sfx('hit', { volume: 0.4 });
      floatText(
        this,
        VIEW.centerX,
        this.viewportTop + 40,
        'NOTHING BANKED FOR THIS SLOT',
        CSS.inkSoft,
      );
      return;
    }

    const current = options.indexOf(meta.gear[slot]);
    const next = options[(current + 1) % options.length] ?? null;
    equipGear(slot, next);
    sfx('ui');
    this.rebuild();
  }

  // --- STASH ---------------------------------------------------------------

  private addStashRows(meta: MetaSave, y: number): number {
    if (meta.stash.length === 0) {
      // §14b edge state: a one-line hint, not an empty frame.
      this.content.add(
        this.add
          .text(-LIST_WIDTH / 2, y + 8, 'Relics you extract land here.', {
            ...TEXT.body,
            fontSize: '26px',
            color: CSS.inkSoft,
          })
          .setOrigin(0, 0),
      );
      return y + 56 + ROW_GAP;
    }

    let cursor = y;
    meta.stash.forEach((relicId, index) => {
      this.content.add(this.buildStashRow(relicId, index, cursor + STASH_ROW / 2));
      cursor += STASH_ROW + ROW_GAP;
    });
    return cursor;
  }

  private buildStashRow(
    relicId: string,
    stashIndex: number,
    centerY: number,
  ): Phaser.GameObjects.Container {
    const def = relicDef(relicId);
    const row = this.add.container(0, centerY);
    row.add(drawDuskPanel(this, LIST_WIDTH, STASH_ROW));

    const left = -LIST_WIDTH / 2;
    const swatch = this.add.graphics();
    swatch.fillStyle(tierColor(def.tier), 1);
    swatch.fillCircle(left + 40, 0, 15);
    swatch.lineStyle(2, IDENTITY.cooled, 1);
    swatch.strokeCircle(left + 40, 0, 15);
    row.add(swatch);

    row.add(
      this.add
        .text(left + 70, -30, def.name, {
          ...TEXT.button,
          fontSize: '28px',
          color: CSS.ink,
          ...bareText(),
        })
        .setOrigin(0, 0),
    );
    // Tier NAME renders in inkSoft on the panel, never in the tier colour (§11).
    row.add(
      this.add
        .text(
          left + 70,
          4,
          `${(TIER_NAMES[def.tier - 1] ?? '').toUpperCase()}  ·  ${this.gearEffectLine(def.id).replace('\n', ', ')}`,
          { ...TEXT.label, fontSize: '21px', color: CSS.inkSoft, ...bareText() },
        )
        .setOrigin(0, 0),
    );

    const value = salvageFor(def.tier);
    const buttonX = LIST_WIDTH / 2 - SALVAGE.width / 2 - 16;
    const button = new Button(
      this,
      buttonX,
      0,
      // Two lines inside the pill rather than a caption above it: the row is
      // 104px tall and an 88px button leaves no band for a separate label —
      // the first attempt overlapped the pill by 18px.
      `SALVAGE\n${value}`,
      () => this.trySalvage(stashIndex, def.tier, value),
      {
        width: SALVAGE.width,
        height: SALVAGE.height,
        ...BUTTON_STYLE.destructive,
        fontSize: '24px',
      },
    );
    // TRAP 2: `Button` pins itself at scrollFactor 0, which is right under the
    // main camera and WRONG inside the list camera, whose base scroll equals
    // its viewport origin. Rows scroll WITH the content: restore factor 1.
    button.setScrollFactor(1, 1, true);
    row.add(button);
    this.salvageButtons.set(stashIndex, button);

    return row;
  }

  /**
   * §14b confirmation policy: a Gilded or Dread salvage arms for 3s and commits
   * on the second tap; Tarnished and Burnished never confirm. Arming is
   * idempotent and decays silently.
   *
   * The armed state is rendered ON THE BUTTON — the label becomes the question
   * and the button pops once so the first tap is acknowledged inside a frame.
   * A detached warning floater (what this used to be) leaves the player reading
   * "SURE? TAP AGAIN" with no indication of WHAT to tap again, on the one
   * irreversible action in the game.
   */
  private trySalvage(stashIndex: number, tier: number, value: number): void {
    if (CONFIRM_TIERS.has(tier)) {
      const armedUntil = this.armed.get(stashIndex) ?? 0;
      if (this.time.now > armedUntil) {
        this.armed.set(stashIndex, this.time.now + ARM_MS);
        sfx('ui');
        const button = this.salvageButtons.get(stashIndex);
        button?.setLabel('SURE?\nTAP AGAIN');
        if (button !== undefined) {
          this.tweens.add({
            targets: button,
            scale: { from: 1.12, to: 1 },
            duration: 200,
            ease: 'Back.easeOut',
          });
        }
        this.armTimers.push(
          this.time.delayedCall(ARM_MS, () => {
            this.armed.delete(stashIndex);
            // The arm decayed, so the button says what it does again. The timer
            // is removed on `rebuild` and on SHUTDOWN, so this can never run
            // against a destroyed button.
            this.salvageButtons.get(stashIndex)?.setLabel(`SALVAGE\n${value}`);
          }),
        );
        return;
      }
    }

    const result = salvageFromStash(stashIndex, value);
    if (!result.ok) return;
    this.armed.delete(stashIndex);
    sfx('pickup');
    floatText(this, VIEW.centerX, this.viewportTop + 40, `+${value}`, CSS.accent);
    this.rebuild();
  }

  // --- UPGRADES ------------------------------------------------------------

  private addUpgradeRows(meta: MetaSave, y: number): number {
    let cursor = y;
    for (const def of metaCatalogFor(SIM_FAMILY)) {
      this.content.add(this.buildUpgradeRow(def, cursor + UPGRADE_ROW / 2, meta));
      cursor += UPGRADE_ROW + ROW_GAP;
    }
    return cursor;
  }

  private buildUpgradeRow(
    def: MetaEntry,
    centerY: number,
    meta: MetaSave,
  ): Phaser.GameObjects.Container {
    const row = this.add.container(0, centerY);
    row.add(drawDuskPanel(this, LIST_WIDTH, UPGRADE_ROW));

    const left = -LIST_WIDTH / 2;
    row.add(
      this.add
        .text(left + 24, -UPGRADE_ROW / 2 + 14, def.name, {
          ...TEXT.button,
          fontSize: '30px',
          color: CSS.ink,
          ...bareText(),
        })
        .setOrigin(0, 0),
    );
    row.add(
      this.add
        .text(left + 24, -UPGRADE_ROW / 2 + 54, def.description, {
          ...TEXT.label,
          fontSize: '22px',
          color: CSS.inkSoft,
          wordWrap: { width: LIST_WIDTH - SALVAGE.width - 72 },
          ...bareText(),
        })
        .setOrigin(0, 0),
    );

    // Pips and the n/N readout share ONE line at the row's foot, side by side.
    // Stacking the readout ABOVE the pips cost a whole line, and a two-line
    // description ("-500ms extraction channel per level, down to the tuned
    // floor.") then ran straight through it.
    const footY = UPGRADE_ROW / 2 - 24;
    const pips = this.add.graphics({ x: left + 32, y: footY });
    row.add(pips);

    const levelText = this.add
      .text(left + 32 + def.maxLevel * 22 + 6, footY, '', {
        ...TEXT.label,
        fontSize: '20px',
        color: CSS.primary,
        ...bareText(),
      })
      .setOrigin(0, 0.5);
    row.add(levelText);

    const buyButton = new Button(
      this,
      LIST_WIDTH / 2 - SALVAGE.width / 2 - 16,
      0,
      '',
      () => this.onBuy(def),
      {
        width: SALVAGE.width,
        height: SALVAGE.height,
        ...BUTTON_STYLE.idle,
        fontSize: '28px',
      },
    );
    buyButton.setScrollFactor(1, 1, true);
    row.add(buyButton);

    const entry: UpgradeRow = { def, pips, buyButton, levelText };
    this.upgradeRows.push(entry);
    this.paintUpgradeRow(entry, meta);
    return row;
  }

  /** Stack pips + price. Repainted on purchase only, never per frame. */
  private paintUpgradeRow(row: UpgradeRow, meta: MetaSave): void {
    const level = meta.upgrades[row.def.id] ?? 0;
    const max = row.def.maxLevel;

    row.pips.clear();
    for (let i = 0; i < max; i += 1) {
      const cx = i * 22;
      if (i < level) {
        row.pips.fillStyle(PALETTE.primary, 1);
        row.pips.fillCircle(cx, 0, 7);
      }
      row.pips.lineStyle(2, IDENTITY.cooled, i < level ? 1 : 0.6);
      row.pips.strokeCircle(cx, 0, 7);
    }

    row.levelText.setText(`${level}/${max}`);

    if (level >= max) {
      // §14b edge state: a maxed row keeps its place in the list and swaps the
      // button for a MAX tag rather than vanishing.
      row.buyButton.setLabel('MAX');
      row.buyButton.setAlpha(DISABLED_ALPHA);
      return;
    }
    const cost = upgradeCost(row.def, level);
    row.buyButton.setLabel(`${cost}`);
    // An unaffordable price stays LEGIBLE at 40% — never hide the goal.
    row.buyButton.setAlpha(meta.currency >= cost ? 1 : DISABLED_ALPHA);
  }

  private onBuy(def: MetaEntry): void {
    const level = loadMeta().upgrades[def.id] ?? 0;
    const cost = upgradeCost(def, level);
    // A `stat` row routes through `buyUpgrade` so its id is checked against
    // META_UPGRADES: a stat level nothing turns into a `Modifier` is an
    // authoring bug and must read as UNAVAILABLE, not sell silently.
    const result = def.kind === 'stat' ? buyUpgrade(def.id) : buyMetaLevel(def);

    if (result.ok) {
      sfx('levelup', { volume: 0.5 });
      floatText(this, VIEW.centerX, this.viewportTop + 40, `-${cost}`, CSS.accent);
    } else {
      sfx('hit', { volume: 0.4 });
      const message =
        result.reason === 'max level reached'
          ? 'MAXED'
          : result.reason === 'not enough currency'
            ? 'NOT ENOUGH SHARDS'
            : 'UNAVAILABLE';
      floatText(this, VIEW.centerX, this.viewportTop + 40, message, CSS.bad);
    }

    // A purchase changes no row COUNT, so this repaints in place: rebuilding
    // would throw away the scroll position the player is reading from.
    const meta = loadMeta();
    this.shardText.setText(`${meta.currency}`);
    this.layoutShardCluster();
    this.headerText.setText(this.headerFor(meta));
    for (const row of this.upgradeRows) this.paintUpgradeRow(row, meta);
  }
}
