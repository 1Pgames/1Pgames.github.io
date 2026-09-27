import type Phaser from 'phaser';
import { CSS, PALETTE } from '../../config';
import { loadMeta, totalStars } from '../../core/progression';
import { SITES } from '../../slices/colony/content';
import { paintPlacard } from '../../ui/colony/theme';
import { ScrollView } from '../../ui/scrollView';
import { label, num } from '../../ui/widgets';
import type { HubApi, HubTab } from './hub';
import { landingLog } from './landing';

/**
 * LOG tab (PRD §10: lifetime stats, best Data per site, streak) + the recent
 * Landings from the `colony:log` journal `settleLanding` writes. Read-only.
 */
const BAND = { x: 40, y: 140, w: 640, h: 816 } as const;
const REASON: Record<string, string> = { beacon: 'LAUNCHED', 'core-lost': 'CORE LOST', 'colony-lost': 'COLONY LOST', frozen: 'FROZEN', abandoned: 'ABANDONED' };

export function buildLogTab(scene: Phaser.Scene, _api: HubApi): HubTab {
  const list = new ScrollView(scene, { x: BAND.x, y: BAND.y, width: BAND.w, height: BAND.h });
  const meta = loadMeta();
  const log = landingLog();
  let y = 0;
  const section = (title: string): void => {
    list.add(label(scene, 8, y + 20, title, { size: 28, bold: true, color: CSS.accent, origin: [0, 0.5] }));
    y += 48;
  };
  const row = (left: string, right: string, color: string = CSS.ink): void => {
    const g = scene.add.graphics({ x: BAND.w / 2, y: y + 28 });
    paintPlacard(g, BAND.w, 56);
    list.add(g);
    list.add(label(scene, 24, y + 28, left, { size: 24, bold: true, origin: [0, 0.5] }));
    const r = label(scene, BAND.w - 24, y + 28, right, { size: 24, color, origin: [1, 0.5] });
    list.add(r);
    y += 62;
  };

  section('RECORDS');
  row('Landings', num(meta.stats.runs));
  row('Launches (wins)', num(meta.stats.wins));
  row('Best Landing', `◆ ${num(meta.stats.bestScore)} Data`, CSS.accent);
  row('Stars', `★ ${totalStars()} / ${SITES.length * 15}`, CSS.accent);
  row('Daily streak', meta.streak.days > 0 ? `${meta.streak.days} day${meta.streak.days === 1 ? '' : 's'}` : '—');
  row('Ark Refit', `Lv ${meta.upgrades.refit ?? 0}`);

  y += 16;
  section('BEST DATA PER SITE');
  for (const s of SITES) {
    let best = -1;
    for (const e of log) if (e.siteId === s.id && e.data > best) best = e.data;
    row(s.name, best < 0 ? 'not landed' : `◆ ${num(best)}`, best < 0 ? CSS.inkSoft : CSS.accent);
  }

  y += 16;
  section('RECENT LANDINGS');
  if (log.length === 0) {
    list.add(label(scene, BAND.w / 2, y + 40, 'No Landings logged', { size: 26, bold: true, color: CSS.inkSoft, origin: [0.5, 0.5] }));
    y += 80;
  }
  for (const e of log.slice(0, 12)) {
    const name = SITES.find((s) => s.id === e.siteId)?.name ?? e.siteId;
    row(`${name} R${e.rung} · sol ${e.sols}`, `${REASON[e.reason] ?? e.reason.toUpperCase()} · ◆${num(e.data)} · ${'★'.repeat(e.stars)}`, e.won ? CSS.good : CSS.bad);
  }
  list.setContentHeight(y + 16);
  const veil = scene.add.rectangle(BAND.x, BAND.y, BAND.w, BAND.h, PALETTE.bgDeep, 0.35).setOrigin(0, 0).setDepth(-50);
  return {
    destroy(): void {
      list.destroy();
      veil.destroy();
    },
  };
}
