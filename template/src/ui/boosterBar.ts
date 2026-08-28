import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../config';
import { sfx } from '../core/audio';
import { pop } from '../core/juice';
import type { ArtSlot } from '../data/art';
import { Button } from './button';
import { drawPanel, paintPanel } from './primitives';

/**
 * Two booster surfaces for a level-based family, sharing one SLOT look:
 *
 * - `showBoosterPicker` — the PRE-level gate between the map and the board:
 *   "start this level with a head start". Slots toggle, at most `maxPick` can
 *   be armed at once, and a booster the player owns none of is visible but
 *   inert (the offer is part of the economy's pressure, so it is never
 *   hidden). A close control cancels the whole gate.
 * - `showBoosterTray` — the IN-level tray docked in the bottom band: one dark
 *   housing panel holding square slots that arm a targeting mode ("tap a
 *   piece", "tap a row", "tap a column") which the scene resolves against the
 *   board, plus slots that need no aim at all (`immediate`, e.g. a board-wide
 *   shuffle) and fire on their own tap. The tray owns the armed state and its
 *   own hint line, and nothing else: it never spends a booster or touches the
 *   board.
 *
 * Both surfaces are ICON-ONLY. A booster's NAME and what it does live in the
 * tooltip that pops when it is selected, never as a permanent label: four
 * words in the bottom band could not be set large enough to read while also
 * leaving a tappable slot, and a word the player has already learnt is noise
 * on every subsequent level. The tooltip is the teaching surface, the icon is
 * the recall surface.
 *
 * Pure presentation in both cases: the caller receives ids and does the
 * spending itself (`progression.spendBooster`), which keeps the "did this
 * actually happen" decision — and therefore the refund question — in one
 * place instead of half in the UI.
 *
 * Use for: the pre-level gate and the in-level consumable tray of a
 * level-based family.
 * Do NOT use for: permanent purchases (that is `scenes/meta.ts`).
 */

/** Glyph for a slot: generated art when its slot resolves, a tinted primitive otherwise. */
export interface BoosterGlyph {
  /** Generated-art slot; drawn UNTINTED when `scene.textures.exists(key)`. */
  art: ArtSlot | null;
  /** Procedural texture key (`core/keys.ts` `TEX`) used when `art` is absent or unloaded. */
  texture: string;
  /** Tint for the procedural fallback only. */
  tint: number;
}

/**
 * One-line "what does this do" per booster id, shared by both surfaces.
 *
 * It lives here rather than in the catalog because it is UI copy sized to the
 * tooltip, not economy data: the shop's own blurb is a sales line, this is the
 * instruction the player needs at the moment they arm the thing.
 *
 * Ids are the booster ids the game spends (`data/metaCatalog.ts`). A game whose
 * ICON key and booster id disagree registers BOTH, as `bomb-start` /
 * `opening-bomb` do here, so either spelling resolves.
 */
export const BOOSTER_BLURB: Readonly<Record<string, string>> = {
  'extra-moves': '+3 moves for this level.',
  shuffle: 'One board reshuffle when you are stuck.',
  'bomb-start': 'Start with a bomb already on the board.',
  'opening-bomb': 'Start with a bomb already on the board.',
  'extra-life': 'Carry on once after a fatal hit.',
  'fifty-fifty': 'Reveals half of the remaining letters.',
  'time-plus': '+20 seconds on the clock.',
  'extra-rolls': 'One extra reroll this game.',
};

/** Rect a coach mark can spotlight, in design px, top-left origin. */
export interface BoosterSurfaceBounds {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface BoosterOffer {
  id: string;
  name: string;
  count: number;
  /** Optional glyph; a slot without one shows its empty square and count only. */
  glyph?: BoosterGlyph;
  /** Tooltip one-liner; defaults to `BOOSTER_BLURB[id]`. */
  blurb?: string;
}

export interface BoosterPickerOptions {
  boosters: readonly BoosterOffer[];
  onStart: (selected: string[]) => void;
  /**
   * Cancels the gate — the picker is a decision point, not a wall, so it must
   * be escapable (X pill and ESC). Absent means no close control at all.
   */
  onClose?: () => void;
  /** Default 2 — three pre-level boosters trivialise a tuned level. */
  maxPick?: number;
}

export interface BoosterPickerHandle {
  /** The chip-row rect (the block of slots, NOT the whole panel). */
  readonly bounds: BoosterSurfaceBounds;
  destroy(): void;
}

/** Picker slot: square, >= the 88px tap target, icon-only. */
const CHIP_HEIGHT = 96;
const CHIP_GAP = 24;
const CHIPS_PER_ROW = 3;
const ROW_GAP = 16;
const START_HEIGHT = 112;
const CLOSE_SIZE = 88; // 88px tap target

/** Corner radius shared by every slot, on both surfaces. */
const SLOT_RADIUS = 22;
/** Icon side as a share of the slot: leaves room for the count badge. */
const SLOT_ICON_SCALE = 0.56;
/** Count-badge disc radius; the disc overhangs the slot corner by 4px. */
const BADGE_RADIUS = 16;
/**
 * An empty slot dims twice — plate alpha AND a grey icon — so both numbers
 * have to be gentler than a single dim would be, or the tool inside vanishes
 * and the shop loses its pitch.
 */
const EMPTY_SLOT_ALPHA = 0.55;
const EMPTY_ICON_TINT = 0x8a8f9e;

/**
 * The slot IS the contrast surface, so the global `TEXT` armour (stroke +
 * shadow, tuned for text on the raw backdrop) reads as grime on top of it.
 * Every label a slot surfaces itself strips both (same rule as `ui/button.ts`).
 */
function chipLabel(size: number, color: string): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    ...TEXT.label,
    fontSize: `${size}px`,
    color,
    stroke: undefined,
    strokeThickness: 0,
    shadow: undefined,
  };
}

/** An icon plus the tint to restore it to — `null` means "untinted art". */
interface SlotIcon {
  image: Phaser.GameObjects.Image;
  baseTint: number | null;
}

/** Draws a slot glyph at `size` px, or returns null when the slot has none. */
function drawGlyph(
  scene: Phaser.Scene,
  glyph: BoosterGlyph | undefined,
  x: number,
  y: number,
  size: number,
): SlotIcon | null {
  if (glyph === undefined) return null;
  // One `textures.exists` check per slot, at construction: a slot naming art
  // that was never loaded (pruned group, art not generated yet) degrades to
  // the primitive instead of rendering a missing-texture box.
  if (glyph.art !== null && scene.textures.exists(glyph.art.key)) {
    const image = scene.add
      .image(x, y, glyph.art.key, glyph.art.frame)
      .setDisplaySize(size, size);
    return { image, baseTint: null };
  }
  const image = scene.add
    .image(x, y, glyph.texture)
    .setTint(glyph.tint)
    .setDisplaySize(size, size);
  return { image, baseTint: glyph.tint };
}

// ------------------------------------------------------------------- slot

/**
 * One square booster slot: glow, plate, icon, count badge. Both surfaces build
 * theirs from this, so an armed slot looks identical wherever it lives.
 */
interface Slot {
  container: Phaser.GameObjects.Container;
  glow: Phaser.GameObjects.Graphics;
  plate: Phaser.GameObjects.Graphics;
  icon: SlotIcon | null;
  badgeDisc: Phaser.GameObjects.Graphics;
  badgeText: Phaser.GameObjects.Text;
  size: number;
  /** The armed-state pulse, alive only while this slot is armed. */
  pulse: Phaser.Tweens.Tween | null;
}

function buildSlot(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  glyph: BoosterGlyph | undefined,
): Slot {
  const container = scene.add.container(x, y).setScrollFactor(0);

  // Armed halo, drawn once and toggled: additive so it reads as light bleeding
  // off the plate rather than as a second, paler border.
  const glow = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
  glow.fillStyle(PALETTE.accent, 0.22);
  glow.fillRoundedRect(-size / 2 - 9, -size / 2 - 9, size + 18, size + 18, SLOT_RADIUS + 6);

  const plate = scene.add.graphics();
  const icon = drawGlyph(scene, glyph, 0, 0, Math.round(size * SLOT_ICON_SCALE));

  const badgeDisc = scene.add.graphics().setPosition(size / 2 - 12, size / 2 - 12);
  const badgeText = scene.add
    .text(size / 2 - 12, size / 2 - 12, '', chipLabel(22, '#05070d'))
    .setOrigin(0.5);

  container.add(glow);
  container.add(plate);
  if (icon !== null) container.add(icon.image);
  container.add([badgeDisc, badgeText]);
  container.setSize(size, size);

  return { container, glow, plate, icon, badgeDisc, badgeText, size, pulse: null };
}

function paintSlot(slot: Slot, picked: boolean, count: number): void {
  const owned = count > 0;
  paintPanel(slot.plate, slot.size, slot.size, {
    fill: picked ? PALETTE.primary : PALETTE.bgBottom,
    stroke: picked ? PALETTE.accent : PALETTE.inkSoft,
    strokeAlpha: picked ? 0.95 : 0.4,
    strokeWidth: picked ? 5 : 3,
    radius: SLOT_RADIUS,
    gloss: picked,
  });
  slot.glow.setVisible(picked);

  if (slot.icon !== null) {
    // A slot with nothing in it greys its icon instead of hiding it: the empty
    // slot is the shop's pitch, and an invisible tool cannot be missed.
    if (owned) {
      if (slot.icon.baseTint === null) slot.icon.image.clearTint();
      else slot.icon.image.setTint(slot.icon.baseTint);
    } else {
      slot.icon.image.setTint(EMPTY_ICON_TINT);
    }
  }

  slot.badgeDisc.clear();
  slot.badgeDisc.fillStyle(owned ? PALETTE.accent : PALETTE.inkSoft, 1);
  slot.badgeDisc.fillCircle(0, 0, BADGE_RADIUS);
  slot.badgeDisc.lineStyle(3, PALETTE.bgDeep, 0.9);
  slot.badgeDisc.strokeCircle(0, 0, BADGE_RADIUS);
  slot.badgeText.setText(`${count}`);

  slot.container.setAlpha(owned ? 1 : EMPTY_SLOT_ALPHA);
}

/** Starts/stops the armed pulse. Idempotent, and safe to call on teardown. */
function setSlotPulse(scene: Phaser.Scene, slot: Slot, on: boolean): void {
  if (on) {
    if (slot.pulse !== null) return;
    slot.pulse = scene.tweens.add({
      targets: slot.container,
      scale: 1.05,
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    return;
  }
  if (slot.pulse === null) return;
  slot.pulse.remove();
  slot.pulse = null;
  slot.container.setScale(1);
}

// ---------------------------------------------------------------- tooltip

const TOOLTIP_MAX_WIDTH = 460;
const TOOLTIP_MIN_WIDTH = 260;
const TOOLTIP_PAD = 18;
/** Height of the pointer nub, and the gap it leaves to the thing it points at. */
const TOOLTIP_NUB = 12;
const TOOLTIP_NUB_HALF_WIDTH = 13;
const TOOLTIP_TITLE_ROW = 38;
const TOOLTIP_TITLE_GAP = 10;
/** A tooltip is a nudge, not a modal: it leaves on its own. */
const TOOLTIP_HIDE_MS = 3000;

interface TooltipRequest {
  /** Anchor x — the centre of the slot the tooltip belongs to. */
  x: number;
  /** Preferred placement: the bubble's BOTTOM sits `TOOLTIP_NUB` above this. */
  aboveY: number;
  /** Flipped placement: the bubble's TOP sits `TOOLTIP_NUB` below this. */
  belowY: number;
  title: string;
  body: string;
  glyph?: BoosterGlyph;
}

interface Tooltip {
  show(req: TooltipRequest): void;
  hide(): void;
  destroy(): void;
}

/**
 * The one tooltip both surfaces use. It is a CHILD of the surface root, added
 * last so it draws over the slots, and it is NEVER made interactive — Phaser
 * only hit-tests interactive objects, so a bubble hanging over a button cannot
 * swallow its taps.
 */
function createTooltip(scene: Phaser.Scene, parent: Phaser.GameObjects.Container): Tooltip {
  const box = scene.add.container(0, 0).setScrollFactor(0).setVisible(false);
  const panel = scene.add.graphics();
  const nub = scene.add.graphics();
  const title = scene.add.text(0, 0, '', chipLabel(26, CSS.accent)).setOrigin(0, 0.5);
  const body = scene.add
    .text(0, 0, '', {
      ...chipLabel(22, CSS.ink),
      wordWrap: { width: TOOLTIP_MAX_WIDTH - TOOLTIP_PAD * 2 },
    })
    .setOrigin(0, 0);
  box.add([panel, nub, title, body]);
  parent.add(box);

  let icon: Phaser.GameObjects.Image | null = null;
  let timer: Phaser.Time.TimerEvent | null = null;
  let dead = false;

  function clearTimer(): void {
    timer?.remove();
    timer = null;
  }

  function hide(): void {
    clearTimer();
    if (dead) return;
    box.setVisible(false);
  }

  function show(req: TooltipRequest): void {
    if (dead) return;
    clearTimer();

    icon?.destroy();
    icon = null;
    const glyphIcon = drawGlyph(scene, req.glyph, 0, 0, 34);
    if (glyphIcon !== null) {
      icon = glyphIcon.image;
      box.add(icon);
    }

    title.setText(req.title);
    body.setText(req.body);

    const titleRowWidth = (icon === null ? 0 : 34 + 12) + title.width;
    const width = Math.max(
      TOOLTIP_MIN_WIDTH,
      Math.min(TOOLTIP_MAX_WIDTH, Math.ceil(Math.max(titleRowWidth, body.width)) + TOOLTIP_PAD * 2),
    );
    const height = Math.ceil(
      TOOLTIP_PAD * 2 + TOOLTIP_TITLE_ROW + TOOLTIP_TITLE_GAP + body.height,
    );

    // Above by default; flip below only when the bubble would leave the top
    // safe band, which is the one case where "above" is unreadable.
    let top = req.aboveY - TOOLTIP_NUB - height;
    let below = false;
    if (top < SAFE.top) {
      top = req.belowY + TOOLTIP_NUB;
      below = true;
    }

    const centerX = Phaser.Math.Clamp(
      req.x,
      SAFE.side + width / 2,
      VIEW.width - SAFE.side - width / 2,
    );
    box.setPosition(centerX, top + height / 2);

    paintPanel(panel, width, height, {
      fill: PALETTE.bgDeep,
      fillAlpha: 0.97,
      stroke: PALETTE.accent,
      strokeAlpha: 0.75,
      strokeWidth: 3,
      radius: 20,
    });

    // The nub tracks the anchor, but never runs off the bubble's rounded ends.
    const nubX = Phaser.Math.Clamp(
      req.x - centerX,
      -width / 2 + SLOT_RADIUS + TOOLTIP_NUB_HALF_WIDTH,
      width / 2 - SLOT_RADIUS - TOOLTIP_NUB_HALF_WIDTH,
    );
    const edge = below ? -height / 2 : height / 2;
    const tip = below ? edge - TOOLTIP_NUB : edge + TOOLTIP_NUB;
    nub.clear();
    nub.fillStyle(PALETTE.bgDeep, 0.97);
    nub.fillTriangle(
      nubX - TOOLTIP_NUB_HALF_WIDTH,
      edge - (below ? -1 : 1),
      nubX + TOOLTIP_NUB_HALF_WIDTH,
      edge - (below ? -1 : 1),
      nubX,
      tip,
    );
    nub.lineStyle(3, PALETTE.accent, 0.75);
    nub.beginPath();
    nub.moveTo(nubX - TOOLTIP_NUB_HALF_WIDTH, edge);
    nub.lineTo(nubX, tip);
    nub.lineTo(nubX + TOOLTIP_NUB_HALF_WIDTH, edge);
    nub.strokePath();

    const left = -width / 2 + TOOLTIP_PAD;
    const titleY = -height / 2 + TOOLTIP_PAD + TOOLTIP_TITLE_ROW / 2;
    icon?.setPosition(left + 17, titleY);
    title.setPosition(left + (icon === null ? 0 : 34 + 12), titleY);
    body.setPosition(left, -height / 2 + TOOLTIP_PAD + TOOLTIP_TITLE_ROW + TOOLTIP_TITLE_GAP);

    // Last child of the surface, re-asserted on every show: the caller may
    // have added buttons after us, and the bubble has to draw over them. It is
    // never interactive, so being on top costs those buttons no taps.
    parent.bringToTop(box);
    box.setVisible(true);
    timer = scene.time.delayedCall(TOOLTIP_HIDE_MS, hide);
  }

  return {
    show,
    hide,
    destroy(): void {
      clearTimer();
      dead = true;
      // `box` is a child of `parent`; the surface's own teardown destroys it.
    },
  };
}

// ------------------------------------------------------------------ picker

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
  // Square slots, centred per row: an icon-only chip has no word to stretch
  // for, so a full-width pill would be a big empty plate around a small glyph.
  const chipsTop = panelTop + 140;
  const widestRow = Math.min(CHIPS_PER_ROW, opts.boosters.length);
  const widestRowWidth = widestRow * CHIP_HEIGHT + (widestRow - 1) * CHIP_GAP;

  // The tooltip is built before the slots because their tap handlers close
  // over it; it re-asserts its own z-order every time it is shown.
  const tooltip = createTooltip(scene, root);

  /** Kept only so teardown can kill every armed pulse. */
  const slots: Slot[] = [];

  opts.boosters.forEach((offer, index) => {
    const row = Math.floor(index / CHIPS_PER_ROW);
    const column = index % CHIPS_PER_ROW;
    const inRow = Math.min(CHIPS_PER_ROW, opts.boosters.length - row * CHIPS_PER_ROW);
    const rowWidth = inRow * CHIP_HEIGHT + (inRow - 1) * CHIP_GAP;
    const x = VIEW.centerX - rowWidth / 2 + CHIP_HEIGHT / 2 + column * (CHIP_HEIGHT + CHIP_GAP);
    const y = chipsTop + row * (CHIP_HEIGHT + ROW_GAP) + CHIP_HEIGHT / 2;

    const slot = buildSlot(scene, x, y, CHIP_HEIGHT, offer.glyph);
    paintSlot(slot, false, offer.count);
    root.add(slot.container);
    slots.push(slot);

    if (offer.count <= 0) return;

    slot.container.setInteractive({ useHandCursor: true });

    // Click semantics: arm on our own POINTER_DOWN, disarm on POINTER_OUT.
    let pressed = false;
    slot.container.on(Phaser.Input.Events.POINTER_DOWN, () => {
      pressed = true;
      slot.container.setScale(0.96);
    });
    slot.container.on(Phaser.Input.Events.POINTER_OUT, () => {
      pressed = false;
      slot.container.setScale(1);
    });
    slot.container.on(Phaser.Input.Events.POINTER_UP, () => {
      slot.container.setScale(1);
      if (!pressed) return;
      pressed = false;

      const already = selected.indexOf(offer.id);
      if (already >= 0) {
        selected.splice(already, 1);
        paintSlot(slot, false, offer.count);
        setSlotPulse(scene, slot, false);
        tooltip.hide();
        sfx('ui');
        return;
      }
      if (selected.length >= maxPick) {
        // Refusing is clearer than silently dropping someone else's pick.
        pop(scene, slot.container, 0.12, 140);
        sfx('hit');
        return;
      }
      selected.push(offer.id);
      paintSlot(slot, true, offer.count);
      setSlotPulse(scene, slot, true);
      tooltip.show({
        x,
        aboveY: y - CHIP_HEIGHT / 2,
        belowY: y + CHIP_HEIGHT / 2,
        title: offer.name,
        body: offer.blurb ?? BOOSTER_BLURB[offer.id] ?? '',
        glyph: offer.glyph,
      });
      sfx('pickup');
    });
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

  // Close LAST: Phaser hit-tests interactive objects by depth then child
  // index, descending, so the X has to be added after the dim rectangle and
  // the panel it sits on or those would swallow its taps.
  const onClose = opts.onClose;
  let close: Button | null = null;
  if (onClose !== undefined) {
    close = new Button(
      scene,
      VIEW.centerX + panelWidth / 2 - CLOSE_SIZE / 2 - 6,
      panelTop + CLOSE_SIZE / 2 + 2,
      'X',
      () => onClose(),
      {
        width: CLOSE_SIZE,
        height: CLOSE_SIZE,
        fill: PALETTE.bgBottom,
        stroke: PALETTE.secondary,
        textColor: CSS.ink,
        fontSize: '38px',
      },
    );
    root.add(close);
  }

  // Scene shutdown destroys children before SHUTDOWN listeners run, and a
  // listener touching a dead scene aborts the whole transition — own the scene
  // reference and guard against a second teardown (see `ui/bars.ts`).
  let destroyed = false;
  const host = scene;
  const keyboard = scene.input.keyboard ?? null;
  const escape = onClose === undefined ? null : (): void => onClose();
  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    host.events.off(Phaser.Scenes.Events.SHUTDOWN, destroy);
    if (escape !== null) keyboard?.off('keydown-ESC', escape);
    tooltip.destroy();
    // Loop tweens outlive the objects they drive: kill them before the scene
    // tears those out from under them.
    for (const held of slots) setSlotPulse(host, held, false);
    root.destroy(true);
  }
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, destroy);
  // ESC parity with the X pill: the scene has not built its own ESC binding
  // yet (that happens with the board), so nothing else claims the key here.
  if (escape !== null) keyboard?.on('keydown-ESC', escape);

  return {
    bounds: {
      x: VIEW.centerX - widestRowWidth / 2,
      y: chipsTop,
      w: widestRowWidth,
      h: chipsHeight,
    },
    destroy,
  };
}

// ------------------------------------------------------------ in-level tray

export interface BoosterTrayChip {
  id: string;
  /** Tooltip title. NOT drawn on the slot — the tray is icon-only. */
  label: string;
  glyph?: BoosterGlyph;
  /** One-line targeting prompt shown while this chip is armed ('TAP A PIECE'). */
  prompt: string;
  /**
   * A chip that needs NO aim: the tap itself is the whole input, so it never
   * enters targeting mode and fires `onUse` straight away. Its `prompt` is
   * still the copy shown while the effect resolves.
   */
  immediate?: boolean;
  /** Tooltip one-liner; defaults to `BOOSTER_BLURB[id]`. */
  blurb?: string;
}

export interface BoosterTrayOptions {
  chips: readonly BoosterTrayChip[];
  /** Owned count per id; re-read on every `refresh()`. */
  countOf: (id: string) => number;
  /**
   * Line shown when nothing is armed. The tray docks where a how-to hint
   * would otherwise sit, so it carries that copy itself rather than fighting
   * it for the same band.
   */
  idleHint: string;
  /**
   * Slot-row centre y, as it was when the tray was a row of 88px pills: the
   * housing is grown UPWARDS from that row's bottom edge so the tray keeps the
   * exact vertical envelope its callers reserved (bottom edge on the safe
   * line). Must sit inside `SAFE`. The hint takes its own line ABOVE the
   * housing (see `TRAY_HINT_GAP`), so a caller sizing a board has to clear
   * that line too and not just the slots.
   */
  y: number;
  /** Fired on every arm/disarm, including a cancel — `null` means disarmed. */
  onArm: (id: string | null) => void;
  /**
   * Fired when an `immediate` chip is tapped with stock and `canArm()` true.
   * The scene spends and resolves; the tray only reports the tap.
   */
  onUse: (id: string) => void;
  /** True while the scene will accept a targeted booster (not busy/paused/ended). */
  canArm: () => boolean;
  /**
   * Px reserved at the RIGHT end of the tray row for a control the scene owns
   * (e.g. a shuffle charge). The housing takes what is left. Default 0.
   */
  rightReserve?: number;
}

export interface BoosterTrayHandle {
  /** Currently armed chip id, or `null`. The scene reads this on a board tap. */
  readonly armed: string | null;
  /** The housing panel rect, for a coach mark to spotlight. */
  readonly bounds: BoosterSurfaceBounds;
  /** Re-reads the counts and repaints. Call after a spend. */
  refresh(): void;
  /** Disarms without firing `onArm` — for the scene's own "booster used" path. */
  disarm(): void;
  /** Shows `chip.prompt` (or the idle line) without arming; for an immediate chip. */
  say(id: string | null): void;
  destroy(): void;
}

/**
 * The row the caller reserves is 88px tall centred on `opts.y` (that is what
 * a control beside it is). The housing grows up from that row's BOTTOM edge,
 * so the tray never crosses the bottom safe line no matter how tall its
 * chrome gets.
 */
const TRAY_ROW_HALF = 44;
const TRAY_SLOT_MAX = 88; // 88px tap target
const TRAY_SLOT_MIN = 64;
const TRAY_SLOT_GAP = 14;
const TRAY_PANEL_PAD_X = 12;
const TRAY_PANEL_PAD_Y = 6;

/**
 * Gap from the housing's top edge up to the hint line's centre. The tray
 * therefore occupies `TRAY_ROW_HALF + housing growth + a line` above `opts.y`,
 * and a caller sizing a board has to clear all of it — the hint used to share
 * the row with the chips, which stopped working the moment there were four of
 * them.
 */
const TRAY_HINT_GAP = 15;
const TRAY_HINT_SIZE = 22;

interface TrayEntry {
  chip: BoosterTrayChip;
  slot: Slot;
  x: number;
  count: number;
}

export function showBoosterTray(scene: Phaser.Scene, opts: BoosterTrayOptions): BoosterTrayHandle {
  const root = scene.add.container(0, 0).setDepth(1500).setScrollFactor(0);
  const entries: TrayEntry[] = [];
  let armed: string | null = null;

  // The housing is one strip, the hint owns the line above it. Four tools plus
  // a reserved control cannot fit one row beside a readable how-to line, and
  // the hint is the only part of the tray that has to be legible at a glance.
  const count = Math.max(1, opts.chips.length);
  const rowLeft = SAFE.side;
  const rowWidth = VIEW.width - SAFE.side * 2 - (opts.rightReserve ?? 0);
  const inner = rowWidth - TRAY_PANEL_PAD_X * 2;
  const slotSize = Math.round(
    Math.max(
      TRAY_SLOT_MIN,
      Math.min(TRAY_SLOT_MAX, (inner - TRAY_SLOT_GAP * (count - 1)) / count),
    ),
  );
  const panelWidth = count * slotSize + TRAY_SLOT_GAP * (count - 1) + TRAY_PANEL_PAD_X * 2;
  const panelHeight = slotSize + TRAY_PANEL_PAD_Y * 2;
  const panelLeft = rowLeft + Math.max(0, Math.round((rowWidth - panelWidth) / 2));
  const panelBottom = opts.y + TRAY_ROW_HALF;
  const panelTop = panelBottom - panelHeight;
  const panelCenterY = panelTop + panelHeight / 2;
  // A slot's hit area never bleeds into its neighbour's, whatever the row
  // maths produced: the pitch is the hard ceiling on it.
  const hitSize = Math.min(Math.max(88, slotSize), slotSize + TRAY_SLOT_GAP);

  const housing = drawPanel(scene, panelWidth, panelHeight, {
    fill: PALETTE.bgDeep,
    fillAlpha: 0.92,
    stroke: PALETTE.primary,
    strokeAlpha: 0.35,
    strokeWidth: 3,
    radius: SLOT_RADIUS + 8,
  })
    .setPosition(panelLeft + panelWidth / 2, panelCenterY)
    .setScrollFactor(0);
  root.add(housing);

  const hint = scene.add
    .text(VIEW.centerX, panelTop - TRAY_HINT_GAP, opts.idleHint, {
      ...TEXT.label,
      fontSize: `${TRAY_HINT_SIZE}px`,
      align: 'center',
    })
    .setOrigin(0.5)
    .setScrollFactor(0);
  root.add(hint);

  const tooltip = createTooltip(scene, root);
  /** Top of the hint line: the tooltip points at the tray, not over its prompt. */
  const tooltipAboveY = panelTop - TRAY_HINT_GAP - TRAY_HINT_SIZE;

  function paintEntry(entry: TrayEntry): void {
    const picked = armed === entry.chip.id;
    paintSlot(entry.slot, picked, entry.count);
    setSlotPulse(scene, entry.slot, picked);
  }

  function say(id: string | null): void {
    const chip = entries.find((entry) => entry.chip.id === id)?.chip;
    hint.setText(chip === undefined ? opts.idleHint : chip.prompt);
    hint.setColor(chip === undefined ? CSS.inkSoft : CSS.accent);
  }

  function setArmed(id: string | null): void {
    if (armed === id) return;
    armed = id;
    for (const entry of entries) paintEntry(entry);
    say(id);
    if (id === null) tooltip.hide();
  }

  opts.chips.forEach((chip, index) => {
    const x = panelLeft + TRAY_PANEL_PAD_X + slotSize / 2 + index * (slotSize + TRAY_SLOT_GAP);
    const slot = buildSlot(scene, x, panelCenterY, slotSize, chip.glyph);
    slot.container.setSize(hitSize, hitSize);
    slot.container.setInteractive({ useHandCursor: true });

    const entry: TrayEntry = { chip, slot, x, count: opts.countOf(chip.id) };
    entries.push(entry);

    // Click semantics: arm on our own POINTER_DOWN, disarm on POINTER_OUT —
    // a pointer-up that started on the board must never toggle a slot.
    let pressed = false;
    slot.container.on(Phaser.Input.Events.POINTER_DOWN, () => {
      pressed = true;
      slot.container.setScale(0.96);
    });
    slot.container.on(Phaser.Input.Events.POINTER_OUT, () => {
      pressed = false;
      slot.container.setScale(1);
    });
    slot.container.on(Phaser.Input.Events.POINTER_UP, () => {
      slot.container.setScale(1);
      if (!pressed) return;
      pressed = false;
      if (armed === chip.id) {
        // Tapping the armed slot again cancels the targeting mode.
        setArmed(null);
        sfx('ui', { volume: 0.4 });
        opts.onArm(null);
        return;
      }
      if (entry.count <= 0 || !opts.canArm()) {
        sfx('hit', { volume: 0.3 });
        pop(scene, slot.container, 0.1, 140);
        return;
      }
      // An aimless tool has nothing to arm FOR: arming it would be a mode the
      // player has to leave again for no gain, so the tap IS the use. It still
      // says what it is — the tooltip rides out its 3s while the effect plays.
      const immediate = chip.immediate === true;
      setArmed(immediate ? null : chip.id);
      tooltip.show({
        x,
        aboveY: tooltipAboveY,
        belowY: panelBottom,
        title: chip.label,
        body: chip.blurb ?? BOOSTER_BLURB[chip.id] ?? '',
        glyph: chip.glyph,
      });
      pop(scene, slot.container, immediate ? 0.14 : 0.12, 180);
      if (immediate) {
        opts.onUse(chip.id);
        return;
      }
      sfx('pickup', { volume: 0.5 });
      opts.onArm(chip.id);
    });

    root.add(slot.container);
    paintEntry(entry);
  });

  let destroyed = false;
  const host = scene;
  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    host.events.off(Phaser.Scenes.Events.SHUTDOWN, destroy);
    tooltip.destroy();
    // Loop tweens outlive their target's container: kill them before the
    // scene tears the objects out from under them.
    for (const entry of entries) setSlotPulse(host, entry.slot, false);
    root.destroy(true);
  }
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, destroy);

  return {
    get armed(): string | null {
      return armed;
    },
    bounds: { x: panelLeft, y: panelTop, w: panelWidth, h: panelHeight },
    refresh(): void {
      if (destroyed) return;
      for (const entry of entries) {
        entry.count = opts.countOf(entry.chip.id);
        if (armed === entry.chip.id && entry.count <= 0) armed = null;
        paintEntry(entry);
      }
      if (armed === null) {
        say(null);
        tooltip.hide();
      }
    },
    disarm(): void {
      if (destroyed) return;
      setArmed(null);
      tooltip.hide();
    },
    say(id: string | null): void {
      if (destroyed) return;
      say(id);
    },
    destroy,
  };
}
