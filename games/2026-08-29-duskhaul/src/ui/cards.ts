import Phaser from 'phaser';
import { CSS, PALETTE, TEXT, VIEW, bareText } from '../config';
import { sfx } from '../core/audio';
import { enterFromBottom } from '../core/juice';
import type { CardInfo } from '../data/types-v2';
import { markSeen } from '../core/progression';
import { COACH_BEATS, coachKey } from './coachBeats';
import { hasSeenCoach } from './coach';
import { BUTTON_STYLE, DISABLED_ALPHA, IDENTITY, PANEL, drawDuskPanel } from './duskChrome';
import { enterPinningHitArea } from './entrance';
import { cardIconId, iconFor } from './itemIcon';
import { drawPill } from './primitives';
import { suspendToasts } from './toast';

/**
 * PRD-V2 §14.13 level-up draft. Everything the card says comes from
 * `describeCard` (E13 `CardInfo`) — this module derives no numbers, so the
 * V1 bug where the effect line and the flavour line BOTH printed the damage
 * (derived twice, from two sources) cannot recur: one `deltaLine`, printed once.
 *
 * Layout (design px): title `CHOOSE AN UPGRADE` y 420; slot line y 470
 * (`WEAPONS 2/4 · CHARMS 1/4 · LV 9`); chips y 520: `REROLL (2)` 200×72 at
 * (150, 520), `BANISH (0)` 200×72 at (370, 520) — each hidden while 0 and never
 * owned this run. Cards 640×140 at y 600 / 748 / 896 with 8 px gaps whose HIT
 * RECTS INCLUDE THE GAPS (FlowAudit D4: no dead strip between cards). Card:
 * icon 96 at (56, +22), title 30 px, kind pill, rank pips `●●○○`, delta line
 * 22 px `accent`, `Evolves with: …` 20 px `secondary`; evolutions carry a 4 px
 * gilt border. First draft ever: the §14.14 `draft` coach line at y 372.
 *
 * BANISH is a mode: tap the chip, then a card (cards turn red); tap the chip
 * again to cancel. Reroll/banish results come back through `handle.refresh`.
 */

export interface UpgradeCardsOptions {
  rerolls: number;
  banishes: number;
  onPick(i: number): void;
  onReroll(): void;
  onBanish(i: number): void;
}

export interface UpgradeCardsHandle {
  /** New hand after a reroll/banish, with the remaining counts. */
  refresh(cards: CardInfo[], rerolls: number, banishes: number): void;
  destroy(): void;
}

const TITLE_Y = 420;
const SLOT_Y = 470;
const COACH_Y = 372;
const CHIP = { y: 520, width: 200, height: 72, rerollX: 150, banishX: 370 } as const;
const CARD = { x: 40, width: 640, height: 140, tops: [600, 748, 896], gap: 8 } as const;
const CARD_ICON = { x: 56, dy: 22, size: 96 } as const;
const TEXT_X = 168;
const DIM_ALPHA = 0.85;

/** Per-scene memory of which chips were ever owned this run (hide-while-never-owned rule). */
const owned = new WeakMap<Phaser.Scene, { reroll: boolean; banish: boolean }>();

/**
 * The overlay currently on screen per scene. A draft opened while another is
 * still up (chained level-ups) REPLACES it instantly: two hands never render
 * at once, and no half-faded previous hand sits over the new one.
 */
const current = new WeakMap<Phaser.Scene, UpgradeCardsHandle>();

/** §16.1 E42. */
export function showUpgradeCards(scene: Phaser.Scene, cards: CardInfo[], opts: UpgradeCardsOptions): UpgradeCardsHandle {
  current.get(scene)?.destroy();
  const root = scene.add.container(0, 0).setDepth(2000).setScrollFactor(0);
  // §14.14 max one coach line: the toast lane (and any live coach toast) hides
  // while the draft is up; the draft's own coach line is the only one shown.
  suspendToasts(scene, true);
  const dim = scene.add
    .rectangle(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height, 0x000000, DIM_ALPHA)
    .setScrollFactor(0)
    .setInteractive();
  root.add(dim);

  const title = scene.add
    .text(VIEW.centerX, TITLE_Y, 'CHOOSE AN UPGRADE', { ...TEXT.heading, fontSize: '34px', color: CSS.ink })
    .setOrigin(0.5)
    .setScrollFactor(0);
  const slotLine = scene.add
    .text(VIEW.centerX, SLOT_Y, '', { ...TEXT.label, fontSize: '22px', color: CSS.inkSoft })
    .setOrigin(0.5)
    .setScrollFactor(0);
  root.add([title, slotLine]);
  enterFromBottom(scene, title);

  if (!hasSeenCoach('draft')) {
    markSeen(coachKey('draft'));
    const coach = scene.add
      .text(VIEW.centerX, COACH_Y, COACH_BEATS.draft.copy, {
        ...TEXT.label,
        fontSize: '21px',
        color: CSS.accent,
        align: 'center',
        wordWrap: { width: 600 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    root.add(coach);
  }

  const memory = owned.get(scene) ?? { reroll: false, banish: false };
  owned.set(scene, memory);

  let resolved = false;
  let closed = false;
  let banishMode = false;
  let rerolls = opts.rerolls;
  let banishes = opts.banishes;
  let cardViews: Phaser.GameObjects.Container[] = [];

  const reroll = buildChip(scene, CHIP.rerollX, () => {
    if (resolved) return;
    if (rerolls <= 0) return refuse(scene, reroll);
    banishMode = false;
    paintMode();
    opts.onReroll();
  });
  const banish = buildChip(scene, CHIP.banishX, () => {
    if (resolved) return;
    if (banishes <= 0) return refuse(scene, banish);
    banishMode = !banishMode;
    paintMode();
  });
  root.add([reroll, banish]);

  function paintChips(): void {
    if (rerolls > 0) memory.reroll = true;
    if (banishes > 0) memory.banish = true;
    setChip(reroll, `REROLL (${rerolls})`, memory.reroll, rerolls > 0, false);
    setChip(banish, banishMode ? 'CANCEL' : `BANISH (${banishes})`, memory.banish, banishes > 0, banishMode);
  }

  function paintMode(): void {
    title.setText(banishMode ? 'TAP A CARD TO BANISH' : 'CHOOSE AN UPGRADE');
    title.setColor(banishMode ? CSS.warn : CSS.ink);
    for (const view of cardViews) {
      const frame = view.getData('banishFrame') as Phaser.GameObjects.Graphics | undefined;
      frame?.setVisible(banishMode);
    }
    paintChips();
  }

  /** Cards whose build is deferred to their entrance slot (PERF: one card per frame, not three). */
  let pendingBuilds: Phaser.Time.TimerEvent[] = [];

  function layout(hand: CardInfo[], animate: boolean): void {
    for (const t of pendingBuilds) t.remove(false);
    pendingBuilds = [];
    for (const view of cardViews) view.destroy();
    cardViews = [];
    slotLine.setText(hand[0]?.slotLine ?? '');
    hand.forEach((info, index) => {
      // Card i enters at i×70 ms anyway, so it is BUILT then too: the open
      // frame builds one card instead of three (cert: the open frame was the
      // single longest frame of the draft window).
      if (animate && index > 0) pendingBuilds.push(scene.time.delayedCall(index * 70, () => place(info, index, true)));
      else place(info, index, animate);
    });
    paintMode();
  }

  function place(info: CardInfo, index: number, animate: boolean): void {
    const top = CARD.tops[index] ?? CARD.tops[0] + index * (CARD.height + CARD.gap);
    const view = buildCard(scene, info, top, () => {
      if (resolved) return;
      if (banishMode) {
        banishMode = false;
        sfx('hit', { volume: 0.5 });
        opts.onBanish(index);
        paintMode();
        return;
      }
      resolved = true;
      sfx('ui');
      opts.onPick(index);
    });
    root.add(view);
    (view.getData('banishFrame') as Phaser.GameObjects.Graphics | undefined)?.setVisible(banishMode);
    if (animate) enterPinningHitArea(scene, view, 0);
    cardViews.push(view);
  }

  layout(cards, true);

  const handle: UpgradeCardsHandle = {
    refresh(next: CardInfo[], nextRerolls: number, nextBanishes: number): void {
      if (resolved) return;
      rerolls = nextRerolls;
      banishes = nextBanishes;
      banishMode = false;
      layout(next, false);
      for (const view of cardViews) {
        view.setAlpha(0.3);
        scene.tweens.add({ targets: view, alpha: 1, duration: 140 });
      }
    },
    destroy(): void {
      if (closed) return;
      closed = true;
      resolved = true;
      suspendToasts(scene, false);
      for (const t of pendingBuilds) t.remove(false);
      pendingBuilds = [];
      for (const view of cardViews) scene.tweens.killTweensOf(view);
      scene.tweens.killTweensOf([title, reroll, banish]);
      root.destroy(true);
      if (current.get(scene) === handle) current.delete(scene);
    },
  };
  current.set(scene, handle);
  return handle;
}

function buildChip(scene: Phaser.Scene, x: number, onTap: () => void): Phaser.GameObjects.Container {
  const chip = scene.add.container(x + CHIP.width / 2, CHIP.y + CHIP.height / 2).setScrollFactor(0);
  const bg = drawPill(scene, CHIP.width, CHIP.height, {
    fill: BUTTON_STYLE.idle.fill,
    fillAlpha: 0.95,
    stroke: BUTTON_STYLE.idle.stroke,
    strokeAlpha: 0.8,
    strokeWidth: 2,
  });
  const label = scene.add
    .text(0, 0, '', { ...TEXT.button, fontSize: '24px', color: CSS.ink, ...bareText() })
    .setOrigin(0.5);
  chip.add([bg, label]);
  chip.setSize(CHIP.width, 88).setInteractive({ useHandCursor: true });
  chip.setData('label', label).setData('bg', bg);
  let armed = false;
  chip.on(Phaser.Input.Events.POINTER_DOWN, () => {
    armed = true;
    chip.setScale(0.96);
  });
  chip.on(Phaser.Input.Events.POINTER_OUT, () => {
    armed = false;
    chip.setScale(1);
  });
  chip.on(Phaser.Input.Events.POINTER_UP, () => {
    chip.setScale(1);
    if (!armed) return;
    armed = false;
    sfx('ui');
    onTap();
  });
  return chip;
}

function setChip(chip: Phaser.GameObjects.Container, text: string, visible: boolean, usable: boolean, active: boolean): void {
  chip.setVisible(visible);
  (chip.getData('label') as Phaser.GameObjects.Text).setText(text).setColor(active ? CSS.warn : CSS.ink);
  chip.setAlpha(usable || active ? 1 : DISABLED_ALPHA);
}

/** Refused WITH feedback (headshake + soft sfx), never silently dropped. */
function refuse(scene: Phaser.Scene, obj: Phaser.GameObjects.Container): void {
  scene.tweens.add({ targets: obj, x: obj.x + 6, duration: 50, yoyo: true, repeat: 2 });
  sfx('ui', { volume: 0.3, rate: 0.7 });
}

function buildCard(scene: Phaser.Scene, info: CardInfo, top: number, onTap: () => void): Phaser.GameObjects.Container {
  const w = CARD.width;
  const h = CARD.height;
  const left = -w / 2;
  const evo = info.kindLabel === 'EVOLUTION';
  const kindTone =
    evo ? IDENTITY.gilt : info.kindLabel.includes('WEAPON') ? PALETTE.primary : info.kindLabel.includes('CHARM') ? PALETTE.secondary : PANEL.stroke;

  const bg = drawDuskPanel(scene, w, h, {
    stroke: evo ? IDENTITY.gilt : kindTone,
    strokeAlpha: evo ? 1 : 0.8,
    strokeWidth: evo ? 4 : 2,
  });
  const banishFrame = drawDuskPanel(scene, w, h, {
    fill: PALETTE.bad,
    fillAlpha: 0.12,
    stroke: PALETTE.bad,
    strokeAlpha: 1,
    strokeWidth: 4,
  }).setVisible(false);

  // Every card resolves to registry art (`cardIconId`); the gilt star is only the missing-texture fallback.
  const icon = iconFor(scene, cardIconId(info.id), CARD_ICON.size, kindTone === PANEL.stroke ? PALETTE.accent : kindTone, 'star').setPosition(
    left + (CARD_ICON.x - CARD.x) + CARD_ICON.size / 2,
    -h / 2 + CARD_ICON.dy + CARD_ICON.size / 2,
  );

  // Kind pill, top-right; rank pips under it.
  const kind = scene.add
    .text(0, 0, info.kindLabel, { ...TEXT.label, fontSize: '16px', color: CSS.ink, ...bareText() })
    .setOrigin(0.5);
  const pillW = Math.ceil(kind.width) + 24;
  const pillX = w / 2 - 16 - pillW / 2;
  const pillY = -h / 2 + 26;
  kind.setPosition(pillX, pillY);
  const pill = drawPill(scene, pillW, 28, {
    fill: evo ? IDENTITY.gilt : PANEL.fill,
    fillAlpha: 0.95,
    stroke: kindTone,
    strokeAlpha: 0.9,
    strokeWidth: 2,
  }).setPosition(pillX, pillY);
  if (evo) kind.setColor('#03040b');

  const parts: Phaser.GameObjects.GameObject[] = [bg, icon, pill, kind];
  const textLeft = left + TEXT_X;
  const title = scene.add
    .text(textLeft, -h / 2 + 14, info.title, { ...TEXT.button, fontSize: '30px', color: CSS.ink, ...bareText() })
    .setOrigin(0, 0);
  fitLabel(title, pillX - pillW / 2 - 12 - textLeft, 30);
  parts.push(title);

  if (info.rankMax > 0) {
    const pips = scene.add.graphics();
    const r = 7;
    const pitch = 20;
    const x0 = w / 2 - 16 - (info.rankMax - 1) * pitch - r;
    const y = pillY + 32;
    for (let i = 1; i <= info.rankMax; i += 1) {
      const x = x0 + (i - 1) * pitch;
      if (i <= info.rankFrom) pips.fillStyle(PALETTE.ink, 1).fillCircle(x, y, r);
      else if (i <= info.rankTo) pips.fillStyle(PALETTE.accent, 1).fillCircle(x, y, r);
      pips.lineStyle(2, i <= info.rankTo ? PALETTE.ink : IDENTITY.cooled, 0.9).strokeCircle(x, y, r);
    }
    parts.push(pips);
  }

  const delta = scene.add
    .text(textLeft, -h / 2 + 62, info.deltaLine, { ...TEXT.label, fontSize: '22px', color: CSS.accent, ...bareText() })
    .setOrigin(0, 0);
  fitLabel(delta, w / 2 - 16 - textLeft, 22);
  parts.push(delta);

  const pair = info.evoMatch;
  if (pair !== undefined) {
    // EVOLUTION PAIR (user request): this pick pairs with a piece the hero OWNS.
    // Three channels so it reads at a glance: pulsing violet-gilt glow, a corner
    // badge with the owned partner's icon + link glyph, and the pair line.
    const badge = pairBadge(scene, pair.partnerIcon, pair.ready);
    badge.setPosition(w / 2 - 16 - badge.width / 2, h / 2 - 12 - PAIR_BADGE.height / 2);
    const line = scene.add
      // Ready: the wide EVOLUTION READY badge takes the room, so the line drops "Pairs with".
      .text(textLeft, -h / 2 + 96, `${pair.ready ? 'Your' : 'Pairs with your'} ${pair.partnerName} → ${pair.evolvedName}`, {
        ...TEXT.label,
        fontSize: '20px',
        color: pair.ready ? CSS.accent : CSS.secondary,
        ...bareText(),
      })
      .setOrigin(0, 0);
    fitLabel(line, w / 2 - 16 - badge.width - 12 - textLeft, 20);
    parts.push(line, badge);
  } else if (info.evolvesWith !== undefined && info.evolvesWith !== '') {
    const evolves = scene.add
      .text(textLeft, -h / 2 + 96, `Evolves with: ${info.evolvesWith}`, {
        ...TEXT.label,
        fontSize: '20px',
        color: CSS.secondary,
        ...bareText(),
      })
      .setOrigin(0, 0);
    fitLabel(evolves, w / 2 - 16 - textLeft, 20);
    parts.push(evolves);
  }
  // PERF (cert: first-draft window 52.9 fps median): a Graphics is re-tessellated
  // on EVERY frame it renders and each Text is its own texture bind, so a live
  // card cost ~12 draw objects per frame for pixels that never change. The
  // static visuals are drawn ONCE into a texture and the card renders as one
  // Image. Only the banish frame (toggled) and the glow (alpha-pulsed) stay apart.
  const face = bake(scene, parts, w, h) ?? scene.add.container(0, 0, parts);
  const container = scene.add.container(CARD.x + w / 2, top + h / 2, [face, banishFrame]).setScrollFactor(0);
  container.setData('banishFrame', banishFrame);
  // Card identity for harnesses: the baked face carries no Text to read (cert reroll check).
  container.setData('cardId', info.id).setData('cardTitle', info.title);
  if (pair !== undefined) {
    const g = scene.add.graphics();
    g.lineStyle(10, IDENTITY.gateOpen, 0.55).strokeRoundedRect(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10, 20);
    g.lineStyle(3, IDENTITY.gilt, 1).strokeRoundedRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2, 16);
    const glow = bake(scene, [g], w + GLOW_PAD * 2, h + GLOW_PAD * 2) ?? g;
    container.addAt(glow, 0);
    // The one loop tween per marked card dies with its card (reroll, pick, destroy).
    const pulse = scene.tweens.add({ targets: glow, alpha: 0.35, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    container.once(Phaser.GameObjects.Events.DESTROY, () => pulse.remove());
  }
  // Hit rect spans the 8 px gaps (4 above + 4 below): no dead strip between cards.
  container.setSize(w, h + CARD.gap).setInteractive({ useHandCursor: true });
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
    container.setScale(0.98);
  });
  container.on(Phaser.Input.Events.POINTER_UP, () => {
    container.setScale(1);
    if (!armed) return;
    armed = false;
    onTap();
  });
  return container;
}

const PAIR_BADGE = { height: 44, icon: 34, glyph: 22, pad: 8 } as const;

/** Corner badge: link glyph + the OWNED partner's icon; `EVOLUTION READY` in gilt when ready (§5.8: eligible, delivered by the next Elite/Boss Chest). */
function pairBadge(scene: Phaser.Scene, partnerIcon: string, ready: boolean): Phaser.GameObjects.Container {
  const { height, icon, glyph, pad } = PAIR_BADGE;
  const label = ready
    ? scene.add.text(0, 0, 'EVOLUTION READY', { ...TEXT.label, fontSize: '15px', color: '#03040b', ...bareText() }).setOrigin(0, 0.5)
    : null;
  const width = pad + glyph + 4 + icon + pad + (label === null ? 0 : Math.ceil(label.width) + pad);
  const plate = drawPill(scene, width, height, {
    fill: ready ? IDENTITY.gilt : PANEL.fill,
    fillAlpha: 0.95,
    stroke: ready ? IDENTITY.gilt : IDENTITY.gateOpen,
    strokeAlpha: 1,
    strokeWidth: 2,
  });
  let x = -width / 2 + pad;
  const link = scene.add
    .text(x + glyph / 2, 0, '⇄', { ...TEXT.button, fontSize: '22px', color: ready ? '#03040b' : CSS.secondary, ...bareText() })
    .setOrigin(0.5);
  x += glyph + 4;
  const partner = iconFor(scene, partnerIcon, icon, IDENTITY.gateOpen).setPosition(x + icon / 2, 0);
  x += icon + pad;
  label?.setPosition(x, 0);
  const badge = scene.add.container(0, 0, label === null ? [plate, link, partner] : [plate, link, partner, label]);
  badge.setSize(width, height);
  return badge;
}

/** Border room around a card for the evolution-pair glow stroke (10 px line at −5). */
const GLOW_PAD = 12;
let bakeSerial = 0;

/**
 * Draws `objects` (laid out around 0,0) into a `width`×`height` texture ONCE and
 * returns an Image of it centred on 0,0; the objects are destroyed. The texture
 * is removed with the Image. `null` (no dynamic texture) → caller keeps them live.
 */
function bake(scene: Phaser.Scene, objects: Phaser.GameObjects.GameObject[], width: number, height: number): Phaser.GameObjects.Image | null {
  bakeSerial += 1;
  const key = `draft-card-${bakeSerial}`;
  const texture = scene.textures.addDynamicTexture(key, Math.ceil(width), Math.ceil(height));
  if (texture === null) return null;
  const temp = scene.add.container(0, 0, objects).setVisible(false);
  texture.draw(temp, width / 2, height / 2).render();
  temp.destroy(true);
  const image = scene.add.image(0, 0, key).setScrollFactor(0);
  image.once(Phaser.GameObjects.Events.DESTROY, () => {
    if (scene.textures.exists(key)) scene.textures.remove(key);
  });
  return image;
}

/** Shrinks a label one px at a time until it fits `maxWidth` (floor 15 px). */
function fitLabel(text: Phaser.GameObjects.Text, maxWidth: number, from: number): void {
  let size = from;
  text.setFontSize(size);
  while (text.width > maxWidth && size > 15) text.setFontSize(--size);
}
