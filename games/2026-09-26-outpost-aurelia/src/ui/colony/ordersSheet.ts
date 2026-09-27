import type Phaser from 'phaser';
import { CSS } from '../../config';
import { load, save } from '../../core/storage';
import { ORDERS, type OrderBonus, type OrderTemplate } from '../../slices/colony/content';
import type { ColonyUiHost, ColonyView } from '../../slices/colony/contracts';
import { COLONY_TUNING } from '../../slices/colony/tuning';
import { openSheet, type OverlayHandle } from '../sheet';
import { label } from '../widgets';
import { claimSheet, releaseSheet } from './bridge';
import { Control, costLabel, icon, missingLabel, placard } from './theme';

/**
 * Orders sheet (§14 OrdersSheet; interface-direction: y 500-1060): up to 4
 * rows 640 × 150 with SHIP 160 × 88. SHIP keeps the sheet open for the next
 * one; a short order dims SHIP and names the missing amount on the row; an
 * order that expires while open fades out "Expired"; an empty board reads
 * "Next drop at dawn". First ever opening holds the clock with one line.
 */
const SHEET_TOP = 500;
const ROW = { x: 40, y0: 140, w: 640, h: 150, gap: 8 } as const;
const FIRST_KEY = 'tut:sheet-orders';
/** A SHIP that leaves less than this many seconds of rations at the current burn is flagged on its row. */
const FOOD_WARN_SEC = 60;

function bonusLabel(b: OrderBonus): string {
  const parts: string[] = [];
  if (b.fe !== undefined) parts.push(`+${b.fe} Fe`);
  if (b.alloy !== undefined) parts.push(`+${b.alloy} Alloy`);
  if (b.colonists !== undefined) parts.push(`+${b.colonists} colonists`);
  if (b.morale !== undefined) parts.push(`+${b.morale} morale`);
  if (b.rerolls !== undefined) parts.push(`+${b.rerolls} reroll`);
  if (b.mk2Tokens !== undefined) parts.push(`${b.mk2Tokens} free Mk II`);
  if (b.freeBuild !== undefined) parts.push(`${b.freeBuild.count} free build`);
  if (b.beaconSecs !== undefined) parts.push(`Beacon −${b.beaconSecs}s`);
  if (b.refillBanks === true) parts.push('banks refilled');
  if (b.pingPure !== undefined) parts.push(`${b.pingPure} pure deposit pinged`);
  return parts.join(' · ');
}

function needLabel(t: OrderTemplate): string {
  const n = t.need;
  if ('goods' in n) return `Ship ${costLabel(n.goods)}`;
  if ('colonists' in n) return `Reach ${n.colonists} colonists`;
  if ('cleanNight' in n) return 'A night with no building lost';
  return 'Kill the Hive Matron';
}

export function openOrdersSheet(host: ColonyUiHost): OverlayHandle {
  const scene = host.scene;
  const first = !load<boolean>(FIRST_KEY, false);
  if (first) host.holdClock(true);
  let timer: Phaser.Time.TimerEvent | null = null;
  const sheet = openSheet(scene, {
    height: 1280 - SHEET_TOP,
    title: 'ORBIT ORDERS',
    onClose: () => {
      timer?.remove();
      timer = null;
      if (first) {
        host.holdClock(false);
        save(FIRST_KEY, true);
      }
      releaseSheet(scene, sheet);
    },
  });
  claimSheet(host, 'orders', sheet);
  if (first) sheet.content.add(label(scene, 40, 80, 'Orbit pays Data for goods. SHIP when the stock is in — the sheet stays open.', { size: 22, color: CSS.accent, wrap: 540 }));

  const rows = new Map<number, { root: Phaser.GameObjects.Container; ship: Control | null; note: Phaser.GameObjects.Text; templateId: string }>();
  const empty = label(scene, 360, ROW.y0 + 120, 'Next drop at dawn', { size: 28, bold: true, color: CSS.inkSoft, origin: [0.5, 0.5] });
  sheet.content.add(empty);

  const sync = (v: ColonyView): void => {
    const model = host.model;
    // Rows whose order left the board fade out as "Expired" (or vanish right after a SHIP).
    for (const [slot, row] of rows) {
      if (v.board.some((o) => o.slot === slot && o.templateId === row.templateId)) continue;
      rows.delete(slot);
      row.ship?.setEnabled(false);
      row.note.setText('Expired').setColor(CSS.bad);
      scene.tweens.add({ targets: row.root, alpha: 0.001, duration: 400, onComplete: () => row.root.destroy() });
    }
    v.board.forEach((o, i) => {
      const t = ORDERS.find((x) => x.id === o.templateId);
      if (t === undefined) return;
      let row = rows.get(o.slot);
      const y = ROW.y0 + i * (ROW.h + ROW.gap);
      if (row === undefined) {
        const root = scene.add.container(0, 0);
        const need = t.need;
        const goods = 'goods' in need ? need.goods : null;
        const ship = goods !== null
          ? new Control(scene, ROW.x + ROW.w - 176, y + 46, 160, 88, 'SHIP', 'primary', () => {
              if (host.ship(o.slot)) return;
              const miss = missingLabel(goods, model.stock);
              if (miss !== null) note.setText(miss).setColor(CSS.bad);
            }, { size: 28, softDisable: true })
          : null;
        const data = icon(scene, 'data', 36);
        const note = label(scene, ROW.x + 24, y + 124, '', { size: 22, color: CSS.inkSoft, origin: [0, 0.5] });
        root.add([
          placard(scene, ROW.x, y, ROW.w, ROW.h),
          label(scene, ROW.x + 24, y + 28, t.name, { size: 26, bold: true, origin: [0, 0.5] }),
          label(scene, ROW.x + 24, y + 62, needLabel(t), { size: 22, origin: [0, 0.5], wrap: 420 }),
          label(scene, ROW.x + 64, y + 94, `+${t.data} Data${bonusLabel(t.bonus) === '' ? '' : ` · ${bonusLabel(t.bonus)}`}`, { size: 22, color: CSS.accent, origin: [0, 0.5], wrap: 380 }),
          note,
        ]);
        if (data !== null) root.add(data.setPosition(ROW.x + 40, y + 94));
        if (ship !== null) root.add(ship.root.setScrollFactor(1, 1, true));
        sheet.content.add(root);
        row = { root, ship, note, templateId: o.templateId };
        rows.set(o.slot, row);
      }
      const need = t.need;
      if ('goods' in need) {
        const miss = missingLabel(need.goods, v.stock);
        row.ship?.setEnabled(o.shippable);
        // Food guard: shipping rations below a minute of burn warns on the row (SHIP itself never confirms, §14b).
        const food = need.goods.rations ?? 0;
        const burn = v.colonists * COLONY_TUNING.colonists.rationPerSec;
        const left = v.stock.rations - food;
        const short = miss === null && food > 0 && burn > 0 && left < burn * FOOD_WARN_SEC;
        const note = miss ?? (short ? `Leaves ${Math.max(0, Math.floor(left))} rations — food for ~${Math.max(0, Math.round(left / burn))} s` : `Expires after sol ${o.expiresSol}`);
        row.note.setText(note).setColor(miss === null && !short ? CSS.inkSoft : CSS.bad);
      } else {
        row.note.setText(`Completes by itself · expires after sol ${o.expiresSol}`).setColor(CSS.inkSoft);
      }
    });
    empty.setVisible(v.board.length === 0);
  };
  sync(host.view());
  timer = scene.time.addEvent({ delay: 250, loop: true, callback: () => sync(host.view()) });
  return sheet;
}
