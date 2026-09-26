/**
 * STARTING WEAPON (Sanctum node "Armsmaster's Leave"): one row used by ARMORY
 * and the Loadout sheet, plus its picker sheet. Before the node is owned the
 * row is dimmed with a padlock and routes to SANCTUM scrolled to the node.
 */
import Phaser from 'phaser';
import { CSS, PALETTE } from '../../config';
import { sfx } from '../../core/audio';
import { ARMSMASTER_ID, selectStartWeapon, startWeaponChoice } from '../../core/progression';
import { CHARMS } from '../../data/charms';
import type { WeaponId } from '../../data/types-v2';
import { WEAPONS, weaponDef } from '../../data/weapons';
import { iconFor } from '../../ui/itemIcon';
import { actionToast, openSheet } from '../../ui/sheet';
import { label, panelAt, tapZone } from '../../ui/widgets';
import { drawPadlock } from './expedition';
import { unlockLevelOf } from './format';
import { hubApi } from './hub';

const LOCKED_COPY = "Unlock in Sanctum — Armsmaster's Leave";

/** Top-left (x, y), 640 wide, `h` tall (≥ 64; hit area grows to 88). */
export function startWeaponRow(scene: Phaser.Scene, x: number, y: number, h: number, onChanged: () => void): Phaser.GameObjects.Container {
  const choice = startWeaponChoice();
  const row = tapZone(scene, x, y, 640, h, () => {
    if (!choice.unlocked) {
      hubApi(scene).goTab('sanctum', ARMSMASTER_ID);
      return;
    }
    openStartWeaponPicker(scene, onChanged);
  });
  row.add(panelAt(scene, 0, 0, 640, h, choice.unlocked ? {} : { strokeAlpha: 0.35 }));
  const cy = h / 2;
  row.add(label(scene, 20, cy, 'STARTING WEAPON', { size: 16, bold: true, color: CSS.inkSoft, origin: [0, 0.5] }));
  const icon = iconFor(scene, `icon-wpn-${choice.effective}`, h - 20, PALETTE.primary, 'disc').setPosition(250, cy);
  row.add(icon);
  if (choice.unlocked) {
    const name = weaponDef(choice.effective).name;
    const suffix = choice.selected === null ? ' · class default' : '';
    const t = label(scene, 250 + h / 2, cy, `${name}${suffix}`, { size: 22, bold: true, origin: [0, 0.5] });
    if (t.width > 320) t.setScale(320 / t.width);
    row.add([t, label(scene, 620, cy, '›', { size: 36, bold: true, color: CSS.inkSoft, origin: [1, 0.5] })]);
  } else {
    icon.setAlpha(0.45);
    const lock = scene.add.graphics();
    drawPadlock(lock, 250 + h / 2 + 12, cy, 26, PALETTE.inkSoft);
    const t = label(scene, 250 + h / 2 + 34, cy, LOCKED_COPY, { size: 18, bold: true, color: CSS.warn, origin: [0, 0.5] });
    if (t.width > 300) t.setScale(300 / t.width);
    row.add([lock, t]);
  }
  return row;
}

/** Picker: Class default + every weapon (ladder-locked ones dimmed with `Unlocks at L<n>`). */
function openStartWeaponPicker(scene: Phaser.Scene, onChanged: () => void): void {
  const sheet = openSheet(scene, { height: 1040, onClose: () => undefined, title: 'STARTING WEAPON' });
  const view = sheet.scroll({ x: 0, y: sheet.top + 100, width: 720, height: 1280 - sheet.top - 100 });
  const choice = startWeaponChoice();
  const pick = (id: WeaponId | null): void => {
    const r = selectStartWeapon(id);
    if (!r.ok) {
      actionToast(scene, r.reason ?? 'Cannot select');
      return;
    }
    sfx('pickup');
    sheet.close();
    onChanged();
  };
  const cards: { id: WeaponId | null; open: boolean }[] = [
    { id: null, open: true },
    // Available first, then locked; each group by ladder level (L1 pairs lead).
    ...WEAPONS.map((w) => ({ id: w.id, open: choice.options.includes(w.id), lv: unlockLevelOf(`weapon:${w.id}`) }))
      .sort((a, b) => Number(b.open) - Number(a.open) || a.lv - b.lv)
      .map(({ id, open }) => ({ id, open })),
  ];
  const CW = 200;
  const CH = 236;
  cards.forEach((c, i) => {
    const x = 40 + (i % 3) * (CW + 20);
    const y = Math.floor(i / 3) * (CH + 16);
    const weapon = c.id ?? choice.classDefault;
    const def = weaponDef(weapon);
    const selected = c.id === choice.selected;
    const card = tapZone(scene, x, y, CW, CH, () => {
      if (!c.open) actionToast(scene, `${def.name} unlocks at L${unlockLevelOf(`weapon:${weapon}`)}.`);
      else pick(c.id);
    });
    view.root.add(card);
    card.add(panelAt(scene, 0, 0, CW, CH, selected ? { stroke: PALETTE.primary, strokeAlpha: 1, strokeWidth: 4 } : c.open ? {} : { strokeAlpha: 0.3 }));
    const icon = iconFor(scene, `icon-wpn-${weapon}`, 72, PALETTE.primary, 'disc').setPosition(CW / 2, 50);
    card.add(icon);
    const title = label(scene, CW / 2, 96, c.id === null ? 'CLASS DEFAULT' : def.name, { size: 18, bold: true, origin: [0.5, 0], align: 'center' });
    if (title.width > CW - 16) title.setScale((CW - 16) / title.width);
    card.add(title);
    if (!c.open) {
      icon.setTint(0x03040b).setTintMode(Phaser.TintModes.FILL).setAlpha(0.6);
      card.add(label(scene, CW / 2, 140, `Unlocks at L${unlockLevelOf(`weapon:${weapon}`)}`, { size: 16, bold: true, color: CSS.warn, origin: [0.5, 0] }));
      return;
    }
    const sub = c.id === null ? def.name : def.pattern;
    card.add(label(scene, CW / 2, 124, sub, { size: 14, color: CSS.inkSoft, origin: [0.5, 0], align: 'center', wrap: CW - 20 }));
    const partner = CHARMS.find((ch) => ch.evolves === weapon);
    if (partner !== undefined) card.add(label(scene, CW / 2, CH - 12, `Evolves with ${partner.name}`, { size: 13, color: CSS.secondary, origin: [0.5, 1], align: 'center', wrap: CW - 16 }));
    if (selected) card.add(label(scene, CW / 2, 8, 'SELECTED', { size: 13, bold: true, color: CSS.primary, origin: [0.5, 0] }));
  });
  view.setContentHeight(Math.ceil(cards.length / 3) * (CH + 16) + 24);
}
