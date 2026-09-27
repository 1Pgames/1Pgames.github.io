import type Phaser from 'phaser';
import { CSS } from '../../config';
import { GOODS, type GoodId } from '../../slices/colony/content';
import type { ColonyUiHost, ColonyView } from '../../slices/colony/contracts';
import { openSheet, type OverlayHandle } from '../sheet';
import { label } from '../widgets';
import { claimSheet, releaseSheet } from './bridge';
import { capsule, icon, setColor, setText } from './theme';

/**
 * Ledger sheet (§14 Ledger; interface-direction: y 540-1060): 7 goods rows +
 * a power row, 640 × 56 each: icon, name, stock / cap, net rate per second and
 * per minute; a good at cap reads "FULL · wasting N/min". Live at 4 Hz while
 * open; does not pause.
 */
const SHEET_TOP = 540;
const ROW = { x: 40, y0: 96, w: 640, h: 56, gap: 6 } as const;
const NAME: Record<GoodId, string> = {
  ferrite: 'Ferrite',
  ice: 'Ice',
  aurelite: 'Aurelite',
  rations: 'Rations',
  alloy: 'Alloy',
  prism: 'Prism',
  cell: 'Lumen Cells',
};

export function openLedgerSheet(host: ColonyUiHost): OverlayHandle {
  const scene = host.scene;
  let timer: Phaser.Time.TimerEvent | null = null;
  const sheet = openSheet(scene, {
    height: 1280 - SHEET_TOP,
    title: 'LEDGER',
    onClose: () => {
      timer?.remove();
      timer = null;
      releaseSheet(scene, sheet);
    },
  });
  claimSheet(host, 'ledger', sheet);

  const rows: Array<{ good: GoodId | null; stock: Phaser.GameObjects.Text; rate: Phaser.GameObjects.Text }> = [];
  const keys: Array<GoodId | null> = [...GOODS, null];
  keys.forEach((good, i) => {
    const y = ROW.y0 + i * (ROW.h + ROW.gap);
    const img = icon(scene, good ?? 'power', 40);
    const stock = label(scene, 280, y + ROW.h / 2, '', { size: 24, bold: true, origin: [0, 0.5] });
    const rate = label(scene, ROW.x + ROW.w - 20, y + ROW.h / 2, '', { size: 22, origin: [1, 0.5] });
    sheet.content.add([
      capsule(scene, ROW.x, y, ROW.w, ROW.h),
      label(scene, 108, y + ROW.h / 2, good === null ? 'Power' : NAME[good], { size: 24, bold: true, origin: [0, 0.5] }),
      stock,
      rate,
    ]);
    if (img !== null) sheet.content.add(img.setPosition(ROW.x + 36, y + ROW.h / 2));
    rows.push({ good, stock, rate });
  });

  const sync = (v: ColonyView): void => {
    for (const row of rows) {
      syncRow(row, v);
      // Rate text never runs into the stock column (right-aligned, fit into x 420-660).
      row.rate.setScale(Math.min(1, 240 / Math.max(1, row.rate.width)));
    }
  };
  const syncRow = (row: (typeof rows)[number], v: ColonyView): void => {
    if (row.good === null) {
      const net = v.kwSupply - v.kwDemand;
      setText(row.stock, `${v.kwSupply.toFixed(1)}/${v.kwDemand.toFixed(1)} kW`);
      setText(row.rate, `now ${net >= 0 ? '+' : '−'}${Math.abs(net).toFixed(1)} · night ${v.kwNightForecast >= 0 ? '+' : '−'}${Math.abs(v.kwNightForecast).toFixed(1)}${v.bankCapKj > 0 ? ` · ▮ ${Math.round(v.bankKj)} kJ` : ''}`);
      setColor(row.rate, net < 0 || v.kwNightForecast < 0 ? CSS.bad : CSS.ink);
      return;
    }
    const g = row.good;
    const stock = v.stock[g];
    const cap = v.caps[g];
    const r = v.rates[g];
    setText(row.stock, `${Math.floor(stock)} / ${cap}`);
    const full = cap > 0 && stock >= cap && r > 0;
    const sign = r > 0 ? '+' : r < 0 ? '−' : '±';
    setText(row.rate, full ? `FULL · wasting ${Math.round(r * 60)}/min` : `${sign}${Math.abs(r).toFixed(1)}/s · ${sign}${Math.abs(Math.round(r * 60))}/min`);
    setColor(row.rate, full ? CSS.primary : r <= 0 ? CSS.bad : CSS.good);
  };
  sync(host.view());
  timer = scene.time.addEvent({ delay: 250, loop: true, callback: () => sync(host.view()) });
  return sheet;
}
