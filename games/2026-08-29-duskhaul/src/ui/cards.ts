import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW, bareText, type PlayerStatKey } from '../config';
import { drawPill } from './primitives';
import { enterFromBottom } from '../core/juice';
import { enterPinningHitArea } from './entrance';
import { sfx } from '../core/audio';
import {
  BUTTON_STYLE,
  DEEP_INK_CSS,
  DISABLED_ALPHA,
  IDENTITY,
  PANEL,
  drawDuskPanel,
} from './duskChrome';
import { WEAPON_MAX_RANK, weaponDef, weaponRank } from '../data/weapons';
import type { UpgradeDef, Rarity } from '../data/upgrades';

/**
 * The level-up draft (§14.5): "pick 1 of 3" with a one-per-draft reroll.
 *
 * This is the player's main in-run decision surface, so its job is not merely
 * to be tappable — it is to make the CHOICE legible in one glance. Rarity
 * therefore reads on three channels at once (border colour, a filled rarity
 * chip, and the chip's label) rather than on a border alone, because a border
 * tint at arm's length across a dimmed arena is a single weak signal.
 *
 * THE CARD SHOWS ITS NUMBERS. That is a correction of the build's biggest
 * gameplay gap: the shipped card rendered title + rarity + flavour only, so a
 * live draft read "Ashen Reach — Your curses spread like windblown ash" and
 * nothing on screen said it was +15% area, that it was a stat rather than a
 * weapon, or which of the two stackable cards was already at its cap. The
 * player is asked for this decision ~13 times a run, and reading what a pick
 * DOES is the entire mid-run loop of the genre.
 *
 * Three additions, all DERIVED and never hand-authored a second time:
 *
 * - the **effect line** is computed from the card's own `modifiers` (or, for
 *   weapon cards, from its `WeaponDef`), so it cannot drift from the values
 *   the run actually applies — a hand-written duplicate would silently lie the
 *   first time a number is tuned;
 * - the **kind chip** names what the card is (WEAPON / EVOLUTION / STAT /
 *   EFFECT) — the taxonomy the §8 build routes are written in, and previously
 *   invisible;
 * - **RANK n/m** is the rank this pick GRANTS out of the card's cap, computed
 *   from the run's pick history. That is what makes §5.3's evolution rule
 *   (weapon at max rank + its tagged stat card owned) discoverable at all:
 *   without a rank read, "at max rank" named a state the player could not see.
 *
 * The reroll affordance is equally load-bearing. §8's no-dead-draft rules live
 * in the ROLLER (cards at their stack limit leave the pool, weapon-unlocks
 * disappear once every slot is filled, evolutions surface only while their gate
 * holds), but the player can only TRUST them if the reroll says which of its
 * three states it is in — available, already spent, or unaffordable. A greyed
 * button with no label change is indistinguishable from a broken one.
 *
 * Layout is authored: cards 640x130 at y 620 / 770 / 920, reroll chip 200x60 at
 * (260, 548), field dimmed to 15%. Cards carry their own panels, so the dim is
 * NOT a scrim and no card text takes armour.
 */

/**
 * §5.3 fixes the pool at common 60 / rare 30 / epic 10 — three tiers, and each
 * gets a visibly different treatment rather than only a different hue.
 */
const RARITY: Record<Rarity, { tone: number; css: string; filled: boolean }> = {
  common: { tone: PALETTE.inkSoft, css: CSS.inkSoft, filled: false },
  rare: { tone: PALETTE.primary, css: CSS.primary, filled: false },
  // Epic's chip is a FILL carrying a deep-ink label: the loudest treatment for
  // the rarest card, and the §11-legal way to use a saturated tone at size.
  epic: { tone: PALETTE.accent, css: DEEP_INK_CSS, filled: true },
};

export interface UpgradeCardsHandle {
  destroy(): void;
}

/** Optional one-shot reroll: draws a fresh set of choices, replacing the ones on screen. */
export interface UpgradeCardsOptions {
  rerollCost: number;
  /** Whether the reroll is tappable right now (affordability + not already used). */
  canReroll: () => boolean;
  /** Draws a new choice set excluding whatever is currently shown. */
  onReroll: () => readonly UpgradeDef[];
}

/**
 * §14.5's card coordinates are TOP EDGES, not centres: "3 cards 640x130
 * stacked at y 620 / 770 / 920 (20px gaps, inside the 620-1060 band)" is
 * arithmetically consistent only that way — 620+130=750, +20 gap = 770;
 * 770+130=900, +20 = 920; 920+130=1050, inside 1060. Read as centres (which
 * the first implementation did) card 1 started at y 555, i.e. 65px ABOVE the
 * band it is specified to sit inside, and its panel top ran into the reroll
 * chip's authored rect — which is exactly the "overlap" that got the chip
 * moved off its authored y as a workaround. Reading the spec correctly puts
 * every rect back where §14.5 wrote it, chip included.
 */
const CARD = { width: VIEW.width - SAFE.side * 2, height: 130, firstTop: 620, pitch: 150 } as const;

/**
 * §14.5 authors the reroll chip at 200x60 centred on (260, 548) — restored to
 * its authored y now that card 1's top edge is at the authored 620. 60 is under
 * the 88px tap floor, so the CHIP keeps its authored size and an invisible
 * 200x88 zone carries the tap (rect 504-592, 28px clear of card 1).
 */
const REROLL = { x: 260, y: 548, width: 200, height: 60, tapHeight: 88 } as const;

/**
 * The heading's own row, above the reroll chip's 88px tap rect (y 504-592).
 * §14.5 authors the cards and the chip but not the heading, so this is a
 * derived coordinate — derived from the chip, not guessed.
 */
const HEADING_Y = 468;

/** §14.5: the field is dimmed to 15%, so the veil is the other 85%. */
const DIM_ALPHA = 0.85;

const RARITY_CHIP = { width: 132, height: 30 } as const;

/** The kind chip: neutral chrome, so the COLOUR channel stays rarity's alone. */
const KIND_CHIP = { minWidth: 100, height: 26, padX: 24 } as const;

/** Card-local rows. Origin is the card centre; the panel spans -65..65. */
const ROW = { title: -57, chip: -39, effect: -4, flavour: 18, padX: 22 } as const;

export function showUpgradeCards(
  scene: Phaser.Scene,
  choices: readonly UpgradeDef[],
  onPick: (choice: UpgradeDef) => void,
  reroll?: UpgradeCardsOptions,
  /**
   * The run's pick history (one entry per resolved draft), used only to derive
   * each card's rank. Read SYNCHRONOUSLY at build time: the slice reuses one
   * array for the whole run, so a stashed reference would show a chained draft
   * the pick that was just made instead of the state the decision was made in.
   */
  taken: readonly string[] = [],
): UpgradeCardsHandle {
  // Every object here is screen-space. With a following camera, `scrollFactor`
  // must be set on each interactive object and not only on the parent: Phaser
  // hit-tests a child against the camera scroll on its own, so a card inside a
  // pinned container renders centred but accepts clicks at the camera's offset.
  const root = scene.add.container(0, 0).setDepth(2000).setScrollFactor(0);

  const dim = scene.add
    .rectangle(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height, 0x000000, DIM_ALPHA)
    .setScrollFactor(0)
    .setInteractive();
  root.add(dim);

  // Its OWN row above the reroll chip. It used to be right-anchored inside the
  // chip's row on the theory that the chip owns x 160-360 and the heading
  // takes the free half — but at 34px the string measures 429px against a
  // 320px free half, so it ran back under the chip. The row is now centred and
  // clear: y 451-485 against the chip's tap rect starting at 504.
  const heading = scene.add
    .text(VIEW.centerX, HEADING_Y, 'CHOOSE AN UPGRADE', {
      ...TEXT.heading,
      fontSize: '34px',
      color: CSS.ink,
    })
    .setOrigin(0.5)
    .setScrollFactor(0);
  root.add(heading);
  enterFromBottom(scene, heading);

  let resolved = false;
  let cardGroup: Phaser.GameObjects.Container[] = [];
  let rerollChip: Phaser.GameObjects.Container | null = null;

  function layout(current: readonly UpgradeDef[]): void {
    for (const card of cardGroup) card.destroy();
    cardGroup = current.map((choice, index) => {
      const centerY = CARD.firstTop + CARD.height / 2 + index * CARD.pitch;
      const card = buildCard(scene, VIEW.centerX, centerY, choice, taken, () => {
        if (resolved) return;
        resolved = true;
        sfx('ui');
        onPick(choice);
      });
      root.add(card);
      // Pinned, not `enterFromBottom`: the slide must not carry the tap target.
      enterPinningHitArea(scene, card, index * 70);
      return card;
    });

    if (reroll === undefined) return;
    if (rerollChip === null) {
      rerollChip = buildRerollChip(scene, () => {
        if (resolved || !reroll.canReroll()) return;
        layout(reroll.onReroll());
      });
      root.add(rerollChip);
      enterPinningHitArea(scene, rerollChip, current.length * 70);
    }
    // Re-read after every draw: one reroll per draft means using it is exactly
    // what changes what the chip should say.
    refreshRerollChip(rerollChip, reroll);
  }

  layout(choices);

  return {
    destroy(): void {
      root.destroy(true);
    },
  };
}

/**
 * The chip's three honest states. A disabled control that does not say WHY is
 * indistinguishable from a bug, so the label carries the reason.
 */
function refreshRerollChip(
  chip: Phaser.GameObjects.Container | null,
  reroll: UpgradeCardsOptions,
): void {
  if (chip === null) return;
  const label = chip.getData('label') as Phaser.GameObjects.Text | undefined;
  const zone = chip.getData('zone') as Phaser.GameObjects.Zone | undefined;
  const usable = reroll.canReroll();

  label?.setText(
    usable ? (reroll.rerollCost > 0 ? `REROLL ${reroll.rerollCost}` : 'REROLL') : 'REROLLED',
  );
  chip.setAlpha(usable ? 1 : DISABLED_ALPHA);
  if (usable) zone?.setInteractive({ useHandCursor: true });
  else zone?.disableInteractive();
}

function buildRerollChip(
  scene: Phaser.Scene,
  onTap: () => void,
): Phaser.GameObjects.Container {
  const chip = scene.add.container(REROLL.x, REROLL.y).setScrollFactor(0);

  const bg = drawPill(scene, REROLL.width, REROLL.height, {
    fill: BUTTON_STYLE.idle.fill,
    fillAlpha: 0.95,
    stroke: BUTTON_STYLE.idle.stroke,
    strokeAlpha: 0.8,
    strokeWidth: 2,
  });
  // The chip is its own contrast surface, so its label strips the armour.
  const label = scene.add
    .text(0, 0, '', { ...TEXT.button, fontSize: '26px', color: CSS.ink, ...bareText() })
    .setOrigin(0.5)
    .setScrollFactor(0);

  const zone = scene.add
    .zone(0, 0, REROLL.width, REROLL.tapHeight)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });
  // Click semantics: arm on our own POINTER_DOWN, disarm on POINTER_OUT.
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
    sfx('ui');
    onTap();
  });

  chip.add([bg, label, zone]);
  chip.setData('label', label);
  chip.setData('zone', zone);
  return chip;
}

/**
 * Player-facing name and add-unit for every stat an upgrade may touch.
 *
 * Typed against the frozen §16.1 `PlayerStatKey` union rather than `string`, so
 * a stat added to `PLAYER_BASE_STATS` fails the build here instead of shipping
 * a card whose effect line silently reads `SHARDSMUL`. `addAs` only describes
 * `add` deltas — a `mul` is always a percentage, whatever the stat.
 */
const STAT_COPY: Record<PlayerStatKey, { label: string; addAs: 'flat' | 'percent' | 'seconds' }> = {
  maxHp: { label: 'MAX HP', addAs: 'flat' },
  moveSpeed: { label: 'MOVE SPEED', addAs: 'flat' },
  damageMul: { label: 'DAMAGE', addAs: 'percent' },
  cooldownMul: { label: 'COOLDOWN', addAs: 'percent' },
  area: { label: 'AREA', addAs: 'percent' },
  critChance: { label: 'CRIT CHANCE', addAs: 'percent' },
  critMul: { label: 'CRIT DAMAGE', addAs: 'percent' },
  pickupRadius: { label: 'PICKUP RANGE', addAs: 'flat' },
  shardsMul: { label: 'SHARDS', addAs: 'percent' },
  channelMs: { label: 'CHANNEL', addAs: 'seconds' },
  bagSlots: { label: 'BAG SLOTS', addAs: 'flat' },
};

/** `+12%` / `-8%` — the sign is the whole point, so it is never dropped. */
function signedPercent(fraction: number): string {
  const percent = Math.round(fraction * 100);
  return `${percent >= 0 ? '+' : '-'}${Math.abs(percent)}%`;
}

function signedFlat(value: number): string {
  return `${value >= 0 ? '+' : '-'}${Math.abs(Math.round(value))}`;
}

/**
 * One modifier as one clause. Both `add` and `mul` can be set on a single
 * modifier, so both are emitted rather than the first one found.
 */
function modifierClauses(
  mod: { stat: string; add?: number; mul?: number },
  out: string[],
): void {
  const copy = STAT_COPY[mod.stat as PlayerStatKey];
  // A modifier whose key is not in the frozen list is a bug `validateUpgradeStats`
  // already logs at boot; the card still has to say something honest about it.
  const label = copy?.label ?? mod.stat.toUpperCase();
  if (mod.add !== undefined && mod.add !== 0) {
    const unit = copy?.addAs ?? 'flat';
    const value =
      unit === 'percent'
        ? signedPercent(mod.add)
        : unit === 'seconds'
          ? `${mod.add >= 0 ? '+' : '-'}${(Math.abs(mod.add) / 1000).toFixed(1)}S`
          : signedFlat(mod.add);
    out.push(`${value} ${label}`);
  }
  if (mod.mul !== undefined && mod.mul !== 0) {
    out.push(`${signedPercent(mod.mul)} ${label}`);
  }
}

/**
 * The card's effect line, DERIVED from the card's own data every time. Stat
 * cards read their `modifiers`; weapon cards read their `WeaponDef`, which is
 * where the numbers combat actually uses live.
 */
function effectLine(def: UpgradeDef): string {
  if (def.weapon !== undefined) {
    const weapon = weaponDef(def.weapon);
    switch (def.kind) {
      case 'weapon-unlock': {
        const cadence =
          weapon.cooldownMs === null
            ? 'CONTINUOUS'
            : `EVERY ${(weapon.cooldownMs / 1000).toFixed(1)}S`;
        return `${weapon.baseDamage} DMG  ·  ${cadence}`;
      }
      case 'weapon-boost': {
        const growth = weapon.rankGrowth;
        return growth.damageStep > 0
          ? `${signedPercent(growth.damageStep)} DAMAGE PER RANK`
          : `+${growth.countStep ?? 0} PROJECTILE PER RANK`;
      }
      case 'weapon-evolution':
        // The evolution's own effect column, verbatim from the weapon row.
        return weapon.evolvedDescription.toUpperCase();
      default:
        break;
    }
  }

  const clauses: string[] = [];
  for (const mod of def.modifiers) modifierClauses(mod, clauses);
  if (clauses.length > 0) return clauses.join('  ·  ');
  // Behaviour cards (`effect`, no modifiers) have no numbers to print, and
  // inventing some would be the drifting second copy this whole function
  // exists to avoid. The kind chip already says EFFECT; the flavour says what.
  return '';
}

/**
 * The bottom row. Normally the card's authored flavour, which is the reason
 * this row exists — but an evolution card has no authored flavour: its
 * `description` is GENERATED as
 * `Replaces <weapon>: <evolvedDescription>.`, and `evolvedDescription` is
 * exactly what the effect row now prints. Rendering both put "pierce 3, dmg
 * 20" on the same card twice. So the one piece of information the generated
 * string carries that the effect row does not — WHICH weapon it replaces — is
 * kept, and the duplicated half is dropped. Still derived, still one source.
 */
function flavourLine(def: UpgradeDef): string {
  if (def.kind === 'weapon-evolution' && def.weapon !== undefined) {
    return `Replaces ${weaponDef(def.weapon).name}.`;
  }
  return def.description;
}

const KIND_LABEL: Record<UpgradeDef['kind'], string> = {
  'weapon-unlock': 'WEAPON',
  'weapon-boost': 'WEAPON',
  'weapon-evolution': 'EVOLUTION',
  stat: 'STAT',
};

function kindLabel(def: UpgradeDef): string {
  // A `stat`-kind card with a behaviour hook and no modifiers is not a stat
  // card to the player — it changes a RULE, and the §8 routes treat it that way.
  if (def.kind === 'stat' && def.effect !== undefined && def.modifiers.length === 0) return 'EFFECT';
  return KIND_LABEL[def.kind];
}

function countTaken(taken: readonly string[], id: string): number {
  let n = 0;
  for (const entry of taken) if (entry === id) n += 1;
  return n;
}

/**
 * `RANK n/m` — the rank this pick GRANTS, out of the cap. That is the number
 * the decision turns on: "RANK 4/4" says this is the last stack of a maxed
 * lane, and on a weapon-boost card it says the evolution gate is about to open.
 * One-of-a-kind cards return `''`: `RANK 1/1` is noise.
 */
function rankLine(def: UpgradeDef, taken: readonly string[]): string {
  if (def.kind === 'weapon-evolution') return 'MAX RANK';
  if (def.weapon !== undefined) {
    // A weapon's rank is 1 at unlock and +1 per boost card, so the rank this
    // card grants is one above whatever its boosts already bought. The rule
    // itself is `data/weapons.weaponRank`, never re-derived here.
    const boosts = countTaken(taken, `w_boost_${def.weapon}`);
    const granted = def.kind === 'weapon-unlock' ? weaponRank(0) : weaponRank(boosts + 1);
    return `RANK ${Math.min(granted, WEAPON_MAX_RANK)}/${WEAPON_MAX_RANK}`;
  }
  if (def.maxStacks <= 1) return '';
  const granted = Math.min(countTaken(taken, def.id) + 1, def.maxStacks);
  return `RANK ${granted}/${def.maxStacks}`;
}

function buildCard(
  scene: Phaser.Scene,
  x: number,
  y: number,
  def: UpgradeDef,
  taken: readonly string[],
  onTap: () => void,
): Phaser.GameObjects.Container {
  const container = scene.add.container(x, y);
  const rarity = RARITY[def.rarity];

  // Primitive card on the §14.4 panel spec with the rarity tone as its stroke:
  // a new rarity needs no new asset. Drawn once per overlay, never per frame.
  const bg = drawDuskPanel(scene, CARD.width, CARD.height, {
    stroke: rarity.tone,
    strokeAlpha: 0.95,
    strokeWidth: 4,
  });

  const left = -CARD.width / 2;
  const textLeft = left + ROW.padX;
  const textRight = CARD.width / 2 - ROW.padX;
  const parts: Phaser.GameObjects.GameObject[] = [bg];

  // Channel two: a chip, filled for epic and outlined otherwise, so rarity
  // survives being GLANCED at rather than read.
  const chipX = CARD.width / 2 - RARITY_CHIP.width / 2 - 20;
  parts.push(
    drawPill(scene, RARITY_CHIP.width, RARITY_CHIP.height, {
      fill: rarity.filled ? rarity.tone : PALETTE.bgTop,
      fillAlpha: rarity.filled ? 0.92 : 0.85,
      stroke: rarity.tone,
      strokeAlpha: 1,
      strokeWidth: 2,
    }).setPosition(chipX, ROW.chip),
    scene.add
      .text(chipX, ROW.chip, def.rarity.toUpperCase(), {
        ...TEXT.label,
        fontSize: '19px',
        color: rarity.css,
        ...bareText(),
      })
      .setOrigin(0.5),
  );

  // Cards carry their own panels, so NO card text takes armour (§14.5).
  const title = scene.add
    .text(textLeft, ROW.title, def.name, {
      ...TEXT.button,
      fontSize: '28px',
      color: CSS.ink,
      ...bareText(),
    })
    .setOrigin(0, 0);
  // The title shares its row with the rarity chip, and names run from
  // "Last Gasp" to "Whetted Widow's Lance". Shrink to fit rather than let a
  // long name run under the chip — a name is content, the layout absorbs it.
  fitLabel(title, chipX - RARITY_CHIP.width / 2 - 12 - textLeft, 28);
  parts.push(title);

  // --- the effect row: kind chip, the numbers, and the rank ----------------

  const kindText = scene.add
    .text(0, ROW.effect, kindLabel(def), {
      ...TEXT.label,
      fontSize: '18px',
      color: CSS.ink,
      ...bareText(),
    })
    .setOrigin(0, 0.5);
  const kindWidth = Math.max(KIND_CHIP.minWidth, Math.ceil(kindText.width) + KIND_CHIP.padX);
  kindText.setX(textLeft + (kindWidth - kindText.width) / 2);
  parts.push(
    drawPill(scene, kindWidth, KIND_CHIP.height, {
      fill: PANEL.fill,
      fillAlpha: 0.95,
      stroke: IDENTITY.cooled,
      strokeAlpha: 0.8,
      strokeWidth: 2,
    }).setPosition(textLeft + kindWidth / 2, ROW.effect),
    kindText,
  );

  const rank = rankLine(def, taken);
  let rankWidth = 0;
  if (rank !== '') {
    const rankText = scene.add
      .text(textRight, ROW.effect, rank, {
        ...TEXT.label,
        fontSize: '21px',
        color: CSS.inkSoft,
        ...bareText(),
      })
      .setOrigin(1, 0.5);
    rankWidth = Math.ceil(rankText.width) + 16;
    parts.push(rankText);
  }

  const effect = effectLine(def);
  if (effect !== '') {
    const effectX = textLeft + kindWidth + 14;
    const effectText = scene.add
      .text(effectX, ROW.effect, effect, {
        ...TEXT.button,
        fontSize: '23px',
        // The numbers are the payload, so they take the brightest legal tone on
        // the panel (`accent` measures 10.97:1 against the §14.4 panel fill).
        color: CSS.accent,
        ...bareText(),
      })
      .setOrigin(0, 0.5);
    fitLabel(effectText, textRight - rankWidth - effectX, 23);
    parts.push(effectText);
  }

  // The flavour line keeps its place — it is good writing and it is what makes
  // the card memorable — but it is now the BOTTOM row, under the numbers,
  // because the numbers are what the decision is made on.
  parts.push(
    scene.add
      .text(textLeft, ROW.flavour, flavourLine(def), {
        ...TEXT.body,
        fontSize: '19px',
        color: CSS.inkSoft,
        wordWrap: { width: CARD.width - ROW.padX * 2 },
        maxLines: 2,
        ...bareText(),
      })
      .setOrigin(0, 0)
      .setLineSpacing(-2),
  );

  container.add(parts);
  container.setSize(CARD.width, CARD.height);
  container.setScrollFactor(0);
  container.setInteractive({ useHandCursor: true });

  // Click semantics, not release semantics: Phaser fires POINTER_UP on whatever
  // sits under the pointer, so a release that STARTED elsewhere (holding the
  // joystick as the overlay opened) would otherwise pick a card by itself.
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

/**
 * Shrinks a label until it fits `maxWidth`. Card content — names, effect
 * clauses — varies far more than the 640px card does, so the layout absorbs it
 * one size step at a time rather than clipping or wrapping a row that has one
 * line of vertical room.
 */
function fitLabel(text: Phaser.GameObjects.Text, maxWidth: number, from: number): void {
  let size = from;
  text.setFontSize(size);
  while (text.width > maxWidth && size > 16) {
    size -= 1;
    text.setFontSize(size);
  }
}
