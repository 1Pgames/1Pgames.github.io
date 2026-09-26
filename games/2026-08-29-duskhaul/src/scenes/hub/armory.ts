/**
 * ARMORY tab (PRD-V2 §14.5): hero portrait (green outline), 6 gear slots,
 * per-source stat panel, belt row + consumable sheet, gear picker sheet with
 * compare line. Equip/unequip never confirm (FlowAudit §3.4).
 */
import Phaser from 'phaser';
import { CSS, PALETTE } from '../../config';
import { sfx } from '../../core/audio';
import { outlineKey } from '../../core/outline';
import {
  beltSlotsUnlocked,
  buyConsumable,
  equipItem,
  featureUnlocked,
  loadMeta,
  setBelt,
  statBreakdown,
} from '../../core/progression';
import { classDef } from '../../data/classes';
import { GEAR_SLOTS, gearMods, gearName } from '../../data/gear';
import { CONSUMABLES } from '../../data/pickups';
import type { ConsumableId, GearInstance, GearSlot, MetaSaveV4, PlayerStatKey } from '../../data/types-v2';
import { ACCOUNT_LADDER } from '../../data/sanctum';
import { Button } from '../../ui/button';
import { BUTTON_STYLE, DEEP_INK, PANEL, rarityColor, rarityName } from '../../ui/duskChrome';
import { iconFor, lootIconId } from '../../ui/itemIcon';
import { actionToast, openSheet } from '../../ui/sheet';
import { label, num, panelAt, raritySwatch, tapZone } from '../../ui/widgets';
import { dashedRect, drawPadlock } from './expedition';
import { SLOT_LABEL, compareLine, itemLines, modText, statLine } from './format';
import { hubApi, type HubTab } from './hub';
import { startWeaponRow } from './startWeapon';

const C = 168;

/** §14.5 slot tile origins (screen px), 144×144 each. */
const SLOT_POS: Record<GearSlot, [number, number]> = {
  hood: [40, 184],
  shroud: [40, 344],
  grips: [40, 504],
  boots: [536, 184],
  ring: [536, 344],
  amulet: [536, 504],
};

/** Stats the panel always shows, then any other stat with a non-zero source. */
const CORE_STATS: readonly PlayerStatKey[] = ['maxHp', 'damageMul', 'moveSpeed', 'cooldownMul', 'critChance', 'bagCells'];

function slotUnlockLevel(slot: GearSlot): number {
  return ACCOUNT_LADDER.find((row) => row.unlocks.includes(`slot:${slot}`))?.level ?? 1;
}

function equippedItem(meta: MetaSaveV4, slot: GearSlot): GearInstance | undefined {
  const uid = meta.equipped[slot];
  return uid === null ? undefined : meta.vault.gear.find((g) => g.uid === uid);
}

export function buildArmoryTab(scene: Phaser.Scene, content: Phaser.GameObjects.Container): HubTab {
  const api = hubApi(scene);
  let bob: Phaser.Tweens.Tween | null = null;

  const build = (): void => {
    bob?.remove();
    bob = null;
    content.removeAll(true);
    const meta = loadMeta();

    // Portrait 280×320 at (220,184), green-outlined idle hero (the in-run read).
    content.add(panelAt(scene, 220, 184 - C, 280, 320));
    const heroKey = scene.textures.exists(outlineKey('hero-idle')) ? outlineKey('hero-idle') : 'hero-idle';
    if (scene.textures.exists(heroKey)) {
      const hero = scene.add.sprite(360, 184 - C + 170, heroKey, 0);
      hero.setScale(260 / Math.max(hero.height, 1));
      if (scene.anims.exists(heroKey)) hero.play(heroKey);
      content.add(hero);
      // Designed idle presence: a slow breath, registered here and killed on rebuild/destroy.
      bob = scene.tweens.add({ targets: hero, y: hero.y - 6, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    const cls = classDef(meta.classId);
    content.add(label(scene, 360, 184 - C + 296, cls.name.toUpperCase(), { size: 18, bold: true, color: CSS.inkSoft, origin: [0.5, 0.5] }));

    for (const slot of GEAR_SLOTS) content.add(slotTile(scene, meta, slot, () => openGearPicker(scene, slot, build)));

    // STARTING WEAPON (Armsmaster's Leave) — under the class, above the stats.
    content.add(startWeaponRow(scene, 40, 680 - C, 88, build));

    // Stat panel (40,680,640,260) with per-source deltas.
    content.add(panelAt(scene, 40, 784 - C, 640, 260));
    content.add(label(scene, 64, 800 - C, 'STATS', { size: 20, bold: true, color: CSS.inkSoft }));
    const rows = statBreakdown();
    const shown = rows.filter((r) => CORE_STATS.includes(r.stat) || r.parts.some((p) => p.add !== 0 || p.mul !== 0));
    shown.sort((a, b) => {
      const ia = CORE_STATS.indexOf(a.stat);
      const ib = CORE_STATS.indexOf(b.stat);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    let y = 834 - C;
    for (const row of shown.slice(0, 6)) {
      const parts = row.parts.filter((p) => p.add !== 0 || p.mul !== 0).map((p) => `${p.label} ${modText(row.stat, p.add, p.mul).split(' ').pop() ?? ''}`);
      content.add(label(scene, 64, y, statLine(row.stat, row.base, row.total), { size: 22, bold: true }));
      if (parts.length > 0) {
        // One line per stat: the biggest sources, then `+N more` — never a wrapped paragraph.
        const two = parts.slice(0, 2).join(', ');
        const take = two.length <= 34 ? Math.min(2, parts.length) : 1;
        const more = parts.length > take ? ` +${parts.length - take} more` : '';
        content.add(label(scene, 292, y + 3, `(${parts.slice(0, take).join(', ')}${more})`, { size: 16, color: CSS.inkSoft }));
      }
      y += 34;
    }

    // Belt row (40,960,640,120): 2 slots + BUY.
    content.add(panelAt(scene, 40, 1064 - C, 640, 120));
    content.add(label(scene, 64, 1080 - C, 'BELT', { size: 20, bold: true, color: CSS.inkSoft }));
    const open = beltSlotsUnlocked(meta);
    for (let s = 0 as 0 | 1; s < 2; s = (s + 1) as 0 | 1) {
      const slotIndex = s;
      const x = 160 + s * 112;
      const tile = tapZone(scene, x, 1080 - C, 96, 96, () => {
        if (slotIndex >= open) actionToast(scene, `Belt slot ${slotIndex + 1} unlocks at L${slotIndex === 0 ? 7 : 22}.`);
        else openConsumableSheet(scene, build, slotIndex);
      });
      const g = scene.add.graphics();
      g.fillStyle(DEEP_INK, 0.85);
      g.fillRoundedRect(0, 0, 96, 96, 12);
      tile.add(g);
      const b = meta.belt[slotIndex];
      if (slotIndex >= open) {
        dashedRect(g, 2, 2, 92, 92, PALETTE.inkSoft);
        tile.add(label(scene, 48, 48, `LOCKED\nL${slotIndex === 0 ? 7 : 22}`, { size: 16, bold: true, color: CSS.inkSoft, origin: [0.5, 0.5], align: 'center' }));
      } else if (b === null) {
        dashedRect(g, 2, 2, 92, 92, PALETTE.inkSoft);
        tile.add(label(scene, 48, 48, 'EMPTY\nBUY', { size: 16, bold: true, color: CSS.inkSoft, origin: [0.5, 0.5], align: 'center' }));
      } else {
        g.lineStyle(2, PALETTE.good, 0.9);
        g.strokeRoundedRect(1, 1, 94, 94, 12);
        tile.add(iconFor(scene, `icon-cb-${b.id}`, 70, PALETTE.good, 'disc').setPosition(48, 48));
        tile.add(label(scene, 90, 90, `×${b.charges}`, { size: 20, bold: true, origin: [1, 1] }));
      }
      content.add(tile);
    }
    content.add(
      new Button(scene, 580, 1124 - C, 'BUY', () => openConsumableSheet(scene, build, null), {
        width: 160,
        height: 88,
        fontSize: '30px',
        ...BUTTON_STYLE.primary,
      }),
    );

    api.setContentHeight(1194 - C);
  };

  build();
  return {
    refresh: build,
    destroy(): void {
      bob?.remove();
      bob = null;
      content.removeAll(true);
    },
  };
}

function slotTile(scene: Phaser.Scene, meta: MetaSaveV4, slot: GearSlot, onTap: () => void): Phaser.GameObjects.Container {
  const [x, y] = SLOT_POS[slot];
  const open = featureUnlocked(meta, `slot:${slot}`);
  const item = equippedItem(meta, slot);
  const tile = tapZone(scene, x, y - C, 144, 144, () => {
    if (!open) actionToast(scene, `The ${SLOT_LABEL[slot].toLowerCase()} slot opens at L${slotUnlockLevel(slot)}.`);
    else onTap();
  });
  const g = scene.add.graphics();
  g.fillStyle(DEEP_INK, 0.85);
  g.fillRoundedRect(0, 0, 144, 144, 14);
  tile.add(g);
  if (item !== undefined) {
    g.lineStyle(4, rarityColor(item.rarity), 1);
    g.strokeRoundedRect(2, 2, 140, 140, 14);
    tile.add(iconFor(scene, lootIconId({ kind: 'gear', item }), 88, rarityColor(item.rarity), 'square').setPosition(72, 76));
    tile.add(raritySwatch(scene, 126, 126, item.rarity, 18));
    tile.add(label(scene, 10, 118, `Lv ${item.level}`, { size: 16, bold: true, color: CSS.ink }));
  } else {
    dashedRect(g, 2, 2, 140, 140, PALETTE.inkSoft);
    if (open) tile.add(label(scene, 72, 80, '+', { size: 52, bold: true, color: CSS.inkSoft, origin: [0.5, 0.5] }));
    else {
      // Locked slot: padlock glyph + level, never a bare "L4" (critic F16).
      const lg = scene.add.graphics();
      drawPadlock(lg, 72, 70, 44, PALETTE.inkSoft);
      tile.add([lg, label(scene, 72, 112, `L${slotUnlockLevel(slot)}`, { size: 22, bold: true, color: CSS.inkSoft, origin: [0.5, 0.5] })]);
    }
  }
  // Slot name INSIDE the tile top: the 16 px gap between tiles has no room for a caption.
  tile.add(label(scene, 72, 8, SLOT_LABEL[slot], { size: 15, bold: true, color: CSS.inkSoft, origin: [0.5, 0] }));
  return tile;
}

/**
 * Gear picker (FlowAudit §2.6): 3 columns of 200×260 cards, rarity desc;
 * tapping a card selects it and shows the compare line; EQUIP / UNEQUIP.
 */
function openGearPicker(scene: Phaser.Scene, slot: GearSlot, onChanged: () => void): void {
  const sheet = openSheet(scene, { height: 1040, onClose: () => undefined, title: `${SLOT_LABEL[slot]}` });
  const T = sheet.top;
  const meta = loadMeta();
  const items = meta.vault.gear.filter((g) => g.slot === slot).sort((a, b) => b.rarity - a.rarity || b.level - a.level);
  const current = equippedItem(meta, slot);
  let selected: GearInstance | undefined = current ?? items[0];

  const gridTop = T + 100;
  // Footer = compare line (up to 4 lines) + EQUIP/UNEQUIP row; the grid stops above it.
  const gridH = 1280 - 300 - gridTop;
  const view = sheet.scroll({ x: 0, y: gridTop, width: 720, height: gridH });
  const footer = scene.add.container(0, 0);
  sheet.content.add(footer);

  const paint = (): void => {
    view.root.removeAll(true);
    footer.removeAll(true);
    if (items.length === 0) {
      view.root.add(
        label(scene, 360, 120, `No ${slot} items yet. ${SLOT_LABEL[slot].charAt(0)}${SLOT_LABEL[slot].slice(1).toLowerCase()}s drop in every zone — extract with one to equip it.`, {
          size: 24,
          color: CSS.inkSoft,
          origin: [0.5, 0],
          align: 'center',
          wrap: 560,
        }),
      );
      view.setContentHeight(300);
    }
    items.forEach((item, i) => {
      const x = 40 + (i % 3) * 216;
      const y = Math.floor(i / 3) * 276;
      const card = tapZone(scene, x, y, 200, 260, () => {
        selected = item;
        paint();
      });
      const on = selected?.uid === item.uid;
      card.add(panelAt(scene, 0, 0, 200, 260, on ? { stroke: PALETTE.primary, strokeAlpha: 1, strokeWidth: 4 } : { stroke: rarityColor(item.rarity), strokeAlpha: 0.9 }));
      card.add(iconFor(scene, lootIconId({ kind: 'gear', item }), 80, rarityColor(item.rarity), 'square').setPosition(100, 58));
      card.add(label(scene, 100, 104, gearName(item), { size: 18, bold: true, origin: [0.5, 0], align: 'center', wrap: 184 }));
      card.add(raritySwatch(scene, 22, 150, item.rarity, 16));
      card.add(label(scene, 36, 150, `${rarityName(item.rarity)} · Lv ${item.level}`, { size: 16, color: CSS.inkSoft, origin: [0, 0.5] }));
      card.add(label(scene, 12, 170, itemLines(item).slice(0, 4).join('\n'), { size: 15, color: CSS.ink, wrap: 180 }));
      if (current?.uid === item.uid) card.add(label(scene, 100, 8, 'EQUIPPED', { size: 14, bold: true, color: CSS.primary, origin: [0.5, 0] }));
      view.root.add(card);
    });
    if (items.length > 0) view.setContentHeight(Math.ceil(items.length / 3) * 276 + 20);

    // Footer: compare line + EQUIP / UNEQUIP.
    const fy = 1280 - 290;
    footer.add(scene.add.rectangle(0, fy - T - 10, 720, 300, PANEL.fill, 1).setOrigin(0, 0));
    if (selected !== undefined) {
      const text = current?.uid === selected.uid ? `${gearName(selected)} is equipped.` : compareLine(gearMods(selected), current === undefined ? [] : gearMods(current));
      footer.add(label(scene, 40, fy - T + 4, text, { size: 18, color: CSS.accent, wrap: 640 }));
    }
    const pick = selected;
    const equip = new Button(scene, 40 + 156, fy - T + 190, 'EQUIP', () => {
      if (pick === undefined) return;
      const r = equipItem(slot, pick.uid);
      if (!r.ok) {
        actionToast(scene, r.reason ?? 'Cannot equip');
        return;
      }
      sfx('pickup');
      sheet.close();
      onChanged();
      hubApi(scene).refreshChrome();
    }, { width: 312, height: 88, fontSize: '30px', ...BUTTON_STYLE.primary });
    equip.setEnabled(pick !== undefined && current?.uid !== pick.uid);
    const unequip = new Button(scene, 368 + 156, fy - T + 190, 'UNEQUIP', () => {
      equipItem(slot, null);
      sheet.close();
      onChanged();
    }, { width: 312, height: 88, fontSize: '30px', ...BUTTON_STYLE.idle });
    unequip.setEnabled(current !== undefined);
    footer.add([equip, unequip]);
  };
  paint();
}

/**
 * Consumable sheet (§14.5): 5 rows — icon, effect, `40 ◆`, stock. With a
 * `slot`, rows also assign that belt slot; `CLEAR` empties it.
 */
function openConsumableSheet(scene: Phaser.Scene, onChanged: () => void, slot: 0 | 1 | null): void {
  const title = slot === null ? 'CONSUMABLES' : `BELT SLOT ${slot + 1}`;
  const sheet = openSheet(scene, { height: 900, onClose: () => onChanged(), title });
  const paint = (): void => {
    sheet.content.removeAll(true);
    sheet.content.add(label(scene, 40, 40, title, { size: 30, bold: true }));
    const meta = loadMeta();
    sheet.content.add(label(scene, 680, 110, `${num(meta.currency)} ◆`, { size: 24, bold: true, color: CSS.accent, origin: [1, 0.5] }));
    CONSUMABLES.forEach((def, i) => {
      const y = 150 + i * 128;
      const row = scene.add.container(40, y);
      row.add(panelAt(scene, 0, 0, 640, 116));
      row.add(iconFor(scene, `icon-cb-${def.id}`, 72, PALETTE.good, 'disc').setPosition(52, 58));
      row.add(label(scene, 104, 16, def.name, { size: 22, bold: true }));
      row.add(label(scene, 104, 48, def.effect, { size: 17, color: CSS.inkSoft, wrap: 290 }));
      const stock = meta.consumables[def.id] ?? 0;
      row.add(label(scene, 104, 96, `Stock ×${stock}`, { size: 16, bold: true, color: CSS.ink, origin: [0, 1] }));
      const buy = new Button(scene, slot === null ? 548 : 470, 58, `${def.price} ◆`, () => {
        const r = buyConsumable(def.id);
        if (!r.ok) {
          actionToast(scene, r.reason ?? 'Not enough ◆');
          return;
        }
        sfx('pickup');
        hubApi(scene).refreshChrome();
        paint();
      }, { width: 150, height: 88, fontSize: '24px', ...BUTTON_STYLE.primary });
      buy.setEnabled(meta.currency >= def.price, () => actionToast(scene, `Need ${num(def.price - meta.currency)} more ◆`));
      row.add(buy);
      if (slot !== null) {
        const onBelt = meta.belt[slot]?.id === def.id;
        const set = new Button(scene, 588, 58, onBelt ? 'ON' : 'SET', () => assign(def.id), {
          width: 88,
          height: 88,
          fontSize: '22px',
          ...(onBelt ? BUTTON_STYLE.primary : BUTTON_STYLE.idle),
        });
        set.setEnabled(stock > 0 || onBelt, () => actionToast(scene, 'Buy one first.'));
        row.add(set);
      }
      sheet.content.add(row);
    });
    if (slot !== null) {
      sheet.content.add(
        new Button(scene, 360, 150 + CONSUMABLES.length * 128 + 50, 'CLEAR SLOT', () => {
          setBelt(slot, null);
          paint();
        }, { width: 640, height: 88, fontSize: '26px', ...BUTTON_STYLE.idle }),
      );
    }
  };
  const assign = (id: ConsumableId): void => {
    if (slot === null) return;
    const r = setBelt(slot, id);
    if (!r.ok) actionToast(scene, r.reason ?? 'Cannot set');
    else sfx('pickup');
    paint();
  };
  paint();
}
