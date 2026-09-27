import Phaser from 'phaser';
import { CSS, PALETTE } from '../../config';
import { sfx } from '../../core/audio';
import { loadMeta, saveMeta, type MetaSave } from '../../core/progression';
import { ARK_NODES, refitCost, type ArkNode } from '../../slices/colony/content';
import { COLONY_TUNING } from '../../slices/colony/tuning';
import { Control, icon, paintPlacard } from '../../ui/colony/theme';
import { ScrollView } from '../../ui/scrollView';
import { actionToast } from '../../ui/sheet';
import { label, num, tapZone } from '../../ui/widgets';
import type { HubApi, HubTab } from './hub';

/**
 * ARK tab (PRD §10 Orbital Ark: 36 nodes = 6 branches × rings 0-5, endless
 * Refit; §14b: tap = buy + UNDO toast until the tab changes, never a
 * confirm). A ring-r node needs one owned ring r−1 node of its branch; a node
 * the player cannot take says why (toast) and never buys.
 */
const BRANCHES: ReadonlyArray<{ id: ArkNode['branch']; label: string; icon: string }> = [
  { id: 'hab', label: 'KIN', icon: 'ark-hab' },
  { id: 'forge', label: 'FORGE', icon: 'ark-forge' },
  { id: 'grid', label: 'HEARTH', icon: 'ark-grid' },
  { id: 'bul', label: 'BULWARK', icon: 'ark-bul' },
  { id: 'sur', label: 'FRONTIER', icon: 'ark-sur' },
  { id: 'cmd', label: 'ORBIT', icon: 'ark-cmd' },
];
const BAND = { x: 40, y: 228, w: 640, h: 728 } as const;
/**
 * 3 branches per band, 2 bands stacked in the scroll view: tiles 200 px wide so
 * every node name sets at the 22 px text floor (longest word "Schematics").
 */
const TILE = { w: 200, h: 140, dx: 220, dy: 150, top: 92 } as const;
const PER_BAND = 3;
const BAND_H = TILE.top + 6 * TILE.dy + 24;
/** Toasts land just above the tab bar (y 964), never on it. */
const TOAST_Y = 904;

export type NodeState = 'owned' | 'buyable' | 'poor' | 'gated';

export function nodeState(meta: MetaSave, n: ArkNode): NodeState {
  if (meta.unlocks.includes(n.id)) return 'owned';
  if (n.ring > 0 && !ARK_NODES.some((p) => p.branch === n.branch && p.ring === n.ring - 1 && meta.unlocks.includes(p.id))) return 'gated';
  return meta.currency >= n.cost ? 'buyable' : 'poor';
}

export function buildArkTab(scene: Phaser.Scene, api: HubApi): HubTab {
  const objs: Phaser.GameObjects.GameObject[] = [];
  const headBand = scene.add.rectangle(40, 140, 640, 80, PALETTE.bgDeep, 0.6).setOrigin(0, 0);
  const head = label(scene, 60, 164, '', { size: 28, bold: true, color: CSS.accent, origin: [0, 0.5] });
  const sub = label(scene, 60, 200, '', { size: 22, color: CSS.inkSoft, origin: [0, 0.5] });
  objs.push(headBand, head, sub);
  const list = new ScrollView(scene, { x: BAND.x, y: BAND.y, width: BAND.w, height: BAND.h });
  const controls: Control[] = [];

  const buy = (n: ArkNode): void => {
    const meta = loadMeta();
    const st = nodeState(meta, n);
    if (st === 'owned') {
      actionToast(scene, `${n.name} — ${n.desc}`, { ms: 2200, y: TOAST_Y });
      return;
    }
    if (st === 'gated') {
      sfx('deny', { volume: 0.5 });
      actionToast(scene, `Needs a ring ${n.ring - 1} node in this branch`, { ms: 1800, y: TOAST_Y });
      return;
    }
    if (st === 'poor') {
      sfx('deny', { volume: 0.5 });
      actionToast(scene, `${n.name}: need ${num(n.cost - meta.currency)} more Data`, { ms: 1800, y: TOAST_Y });
      return;
    }
    meta.currency -= n.cost;
    meta.unlocks.push(n.id);
    saveMeta(meta);
    sfx('upgrade', { volume: 0.6 });
    actionToast(scene, `${n.name} — ${n.desc}`, {
      y: TOAST_Y,
      actionLabel: 'UNDO',
      ms: 60000,
      onAction: () => {
        const m = loadMeta();
        const i = m.unlocks.indexOf(n.id);
        if (i < 0) return;
        m.unlocks.splice(i, 1);
        m.currency += n.cost;
        saveMeta(m);
        render();
      },
    });
    render();
  };

  const buyRefit = (): void => {
    const meta = loadMeta();
    const level = meta.upgrades.refit ?? 0;
    const cost = refitCost(level);
    if (meta.currency < cost) {
      sfx('deny', { volume: 0.5 });
      actionToast(scene, `Refit: need ${num(cost - meta.currency)} more Data`, { ms: 1800, y: TOAST_Y });
      return;
    }
    meta.currency -= cost;
    meta.upgrades.refit = level + 1;
    saveMeta(meta);
    sfx('upgrade', { volume: 0.6 });
    actionToast(scene, `Ark Refit Lv ${level + 1}`, {
      y: TOAST_Y,
      actionLabel: 'UNDO',
      ms: 60000,
      onAction: () => {
        const m = loadMeta();
        if ((m.upgrades.refit ?? 0) !== level + 1) return;
        m.upgrades.refit = level;
        m.currency += cost;
        saveMeta(m);
        render();
      },
    });
    render();
  };

  const render = (): void => {
    const at = list.offset;
    for (const c of controls) c.destroy();
    controls.length = 0;
    list.clear();
    const meta = loadMeta();
    const level = meta.upgrades.refit ?? 0;
    head.setText(`◆ ${num(meta.currency)} Data · Refit Lv ${level}`);
    const open = ARK_NODES.filter((n) => nodeState(meta, n) !== 'owned' && nodeState(meta, n) !== 'gated');
    const cheapest = open.reduce<number>((m, n) => Math.min(m, n.cost), Infinity);
    const anyBuy = open.some((n) => n.cost <= meta.currency);
    sub.setText(
      anyBuy
        ? 'Tap a node to buy · UNDO on the toast'
        : Number.isFinite(cheapest)
          ? `Next: ${num(cheapest)} Data — land again`
          : `Tree complete · next Refit ${num(refitCost(level))} Data`,
    );

    BRANCHES.forEach((b, i) => {
      const x = (i % PER_BAND) * TILE.dx;
      const top = Math.floor(i / PER_BAND) * BAND_H;
      const img = icon(scene, b.icon, 48);
      if (img !== null) list.add(img.setPosition(x + TILE.w / 2, top + 28));
      const t = label(scene, x + TILE.w / 2, top + 70, b.label, { size: 22, bold: true, origin: [0.5, 0.5] });
      if (t.width > TILE.w) t.setScale(TILE.w / t.width);
      list.add(t);
    });
    for (const n of ARK_NODES) {
      const col = BRANCHES.findIndex((b) => b.id === n.branch);
      if (col < 0) continue;
      const st = nodeState(meta, n);
      const x = (col % PER_BAND) * TILE.dx;
      const y = Math.floor(col / PER_BAND) * BAND_H + TILE.top + n.ring * TILE.dy;
      const zone = tapZone(scene, x, y, TILE.w, TILE.h, () => buy(n), true).setData('nodeId', n.id);
      const g = scene.add.graphics({ x: TILE.w / 2, y: TILE.h / 2 });
      paintPlacard(g, TILE.w, TILE.h, st === 'owned' ? PALETTE.primary : st === 'buyable' ? PALETTE.accent : PALETTE.bgDeep);
      const img = icon(scene, st === 'gated' ? 'ark-locked' : BRANCHES[col]?.icon ?? 'ark-ship', 40);
      // 22 px floor: names wrap to at most two lines inside the 200 px tile, never scale down.
      const name = label(scene, TILE.w / 2, 50, n.name, { size: 22, bold: true, origin: [0.5, 0], align: 'center', wrap: TILE.w - 16 });
      const price = label(scene, TILE.w / 2, TILE.h - 18, st === 'owned' ? 'OWNED' : `◆${num(n.cost)}`, {
        size: 22,
        bold: true,
        color: st === 'owned' ? CSS.primary : st === 'buyable' ? CSS.accent : CSS.inkSoft,
        origin: [0.5, 0.5],
      });
      if (price.width > TILE.w - 8) price.setScale((TILE.w - 8) / price.width);
      const body = scene.add.container(0, 0, img === null ? [g, name, price] : [g, img.setPosition(TILE.w / 2, 26), name, price]);
      if (st === 'gated' || st === 'poor') body.setAlpha(0.45);
      zone.add(body);
      list.add(zone);
    }

    // Refit: the endless Data sink (+2 % Data, +1 % production per level).
    const ry = 2 * BAND_H;
    const plate = scene.add.graphics({ x: 320, y: ry + 60 });
    paintPlacard(plate, 640, 120);
    const cost = refitCost(level);
    const M = COLONY_TUNING.meta;
    list.add(plate);
    list.add(label(scene, 24, ry + 36, `ARK REFIT · Lv ${level}`, { size: 26, bold: true, origin: [0, 0.5] }));
    list.add(label(scene, 24, ry + 80, `+${Math.round(M.refitDataPerLevel * 100)} % Data, +${Math.round(M.refitProdPerLevel * 100)} % production per level`, { size: 22, color: CSS.inkSoft, origin: [0, 0.5], wrap: 390 }));
    const btn = new Control(scene, 420, ry + 16, 200, 88, `◆ ${num(cost)}`, meta.currency >= cost ? 'primary' : 'secondary', buyRefit, { size: 26 });
    btn.root.setData('refit', level);
    controls.push(btn);
    list.add(btn.root);
    list.setContentHeight(ry + 140);
    list.scrollTo(at);
    api.refreshChrome();
  };

  render();
  return {
    destroy(): void {
      for (const c of controls) c.destroy();
      list.destroy();
      for (const o of objs) if (o.scene) o.destroy();
    },
  };
}
