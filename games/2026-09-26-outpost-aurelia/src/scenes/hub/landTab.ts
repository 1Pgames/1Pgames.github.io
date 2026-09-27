import Phaser from 'phaser';
import { CSS, PALETTE } from '../../config';
import { loadDailyBest } from '../../core/daily';
import { loadMeta, totalStars } from '../../core/progression';
import { KITS, KIT_NONE, SITES, type LandingKit, type SiteDef } from '../../slices/colony/content';
import { dailyPaid } from '../../slices/colony/model/score';
import { COLONY_TUNING } from '../../slices/colony/tuning';
import { Control, icon, pin, placard } from '../../ui/colony/theme';
import { ScrollView, cameraRouter } from '../../ui/scrollView';
import { actionToast } from '../../ui/sheet';
import { label, num, tapZone } from '../../ui/widgets';
import type { HubApi, HubTab } from './hub';
import { NODE_CENTRE, RUNGS, dailySetup, kitUnlocked, landingSetup, lastSelection, maxRung, saveSelection, siteLock, stars } from './landing';

/**
 * LAND tab (PRD §14 Hub; interface-direction §5): the planet map (720 × 900
 * `hub-planet-map`, scissor-scrolled in y 140-436) with 8 site nodes ≥ 96 px;
 * the selected site's postcard card (y 444-728) with rung chips 88 × 88 and
 * kit chips 120 × 88; DAILY 300 × 88 at (380, 744); LAUNCH 640 × 112 at
 * (40, 844). A locked site / rung / kit answers with its reason, never a dead
 * LAUNCH.
 */
const MAP = { x: 0, y: 140, w: 720, h: 296 } as const;
const CARD = { x: 40, y: 444, w: 640, h: 290 } as const;
/** Reason toasts land over the map, never over LAUNCH / DAILY (§14b 'LAUNCH is never dead'). */
const TOAST_Y = 392;
const NODE_R = 48;

export function buildLandTab(scene: Phaser.Scene, api: HubApi): HubTab {
  const sel = lastSelection();
  let site = sel.site;
  let rung = sel.rung;
  let kit = sel.kit;
  const objs: Phaser.GameObjects.GameObject[] = [];
  const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
    objs.push(o);
    return o;
  };

  // ── map ─────────────────────────────────────────────────────────────
  const map = new ScrollView(scene, { x: MAP.x, y: MAP.y, width: MAP.w, height: MAP.h });
  // Edge fades over the map scissor (its own camera, created after the map's, so it draws on top):
  // labels scrolling past the band edge dissolve instead of reading as cut off (QA#6).
  // Two 28 px strips, each on its own camera sized to the strip, so the map keeps its drag everywhere else.
  const fades: Array<{ root: Phaser.GameObjects.Container; cam: Phaser.Cameras.Scene2D.Camera }> = [];
  for (const top of [true, false]) {
    const y0 = top ? MAP.y : MAP.y + MAP.h - 28;
    const root = scene.add.container(0, 0);
    for (let i = 0; i < 7; i += 1) {
      const y = top ? y0 + i * 4 : y0 + 24 - i * 4;
      root.add(scene.add.rectangle(0, y, MAP.w, 4, PALETTE.bgDeep, 0.85 - i * 0.12).setOrigin(0, 0));
    }
    const cam = scene.cameras.add(MAP.x, y0, MAP.w, 28);
    cam.setScroll(MAP.x, y0);
    cameraRouter(scene).own(root, cam);
    fades.push({ root, cam });
  }
  const nodes = new Map<string, Phaser.GameObjects.Graphics>();
  const buildMap = (): void => {
    map.clear();
    if (scene.textures.exists('hub-planet-map')) map.add(scene.add.image(0, 0, 'hub-planet-map').setOrigin(0, 0));
    map.add(scene.add.rectangle(0, 0, 720, 900, PALETTE.bgDeep, 0.35).setOrigin(0, 0));
    const meta = loadMeta();
    for (const s of SITES) {
      const c = NODE_CENTRE[s.id];
      if (c === undefined) continue;
      const locked = siteLock(s) !== null;
      const zone = tapZone(scene, c.x - NODE_R, c.y - NODE_R, NODE_R * 2, NODE_R * 2, () => pickSite(s));
      const g = scene.add.graphics({ x: NODE_R, y: NODE_R });
      nodes.set(s.id, g);
      paintNode(g, s.id === site.id, locked);
      const parts: Phaser.GameObjects.GameObject[] = [g];
      if (locked) {
        const lock = icon(scene, 'ark-locked', 48);
        if (lock !== null) parts.push(lock.setPosition(NODE_R, NODE_R));
      } else {
        let got = 0;
        for (let r = 1; r <= RUNGS; r += 1) got += meta.stars[`${s.id}:${r}`] ?? 0;
        parts.push(label(scene, NODE_R, NODE_R, `★${got}`, { size: 24, bold: true, color: CSS.accent, origin: [0.5, 0.5] }));
      }
      zone.add(parts);
      // Name on a 0.6 band under the node (text over art needs the band — interface-direction §4).
      const name = label(scene, c.x, c.y + NODE_R + 18, locked ? `${s.name} · ${s.starsToUnlock}★` : s.name, { size: 22, bold: true, origin: [0.5, 0.5] });
      const band = scene.add.rectangle(c.x, c.y + NODE_R + 18, name.width + 20, 32, PALETTE.bgDeep, 0.6);
      map.add(band, name, zone);
    }
    map.setContentHeight(900);
  };

  // ── site card ───────────────────────────────────────────────────────
  const card = add(scene.add.container(0, 0));
  const refreshCard = (): void => {
    card.removeAll(true);
    const post = `postcard-${site.id}`;
    if (scene.textures.exists(post)) {
      const img = scene.add.image(CARD.x, CARD.y, post).setOrigin(0, 0);
      const s = CARD.w / img.width;
      img.setScale(s).setCrop(0, 0, img.width, CARD.h / s);
      card.add(img);
    }
    const frame = scene.add.graphics();
    frame.lineStyle(3, PALETTE.bgDeep, 1).strokeRoundedRect(CARD.x, CARD.y, CARD.w, CARD.h, 18);
    frame.lineStyle(1, PALETTE.accent, 0.35).strokeRoundedRect(CARD.x + 4, CARD.y + 4, CARD.w - 8, CARD.h - 8, 14);
    const band = scene.add.rectangle(CARD.x, CARD.y, CARD.w, 88, PALETTE.bgDeep, 0.6).setOrigin(0, 0);
    const lowBand = scene.add.rectangle(CARD.x, CARD.y + 92, CARD.w, CARD.h - 92, PALETTE.bgDeep, 0.6).setOrigin(0, 0);
    const title = label(scene, CARD.x + 20, CARD.y + 24, site.name, { size: 30, bold: true, origin: [0, 0.5] });
    const desc = label(scene, CARD.x + 20, CARD.y + 62, site.desc, { size: 22, color: CSS.inkSoft, origin: [0, 0.5] });
    if (desc.width > CARD.w - 40) desc.setScale((CARD.w - 40) / desc.width);
    const meta = loadMeta();
    let got = 0;
    for (let r = 1; r <= RUNGS; r += 1) got += stars(site.id, r, meta);
    const best = label(scene, CARD.x + CARD.w - 20, CARD.y + 24, `★ ${got}/${RUNGS * 3}`, { size: 24, bold: true, color: CSS.accent, origin: [1, 0.5] });
    card.add([band, lowBand, frame, title, desc, best]);

    // Rung chips (Severity): 88 × 88; locked rungs explain themselves.
    const top = maxRung(site.id);
    for (let r = 1; r <= RUNGS; r += 1) {
      const x = CARD.x + 16 + (r - 1) * 98;
      const y = CARD.y + 96;
      const zone = tapZone(scene, x, y, 88, 88, () => {
        if (r > top) {
          actionToast(scene, `Win rung ${r - 1} on ${site.name} first`, { ms: 1600, y: TOAST_Y });
          return;
        }
        rung = r;
        saveSelection(site, rung, kit);
        refreshCard();
      });
      const g = scene.add.graphics();
      const on = r === rung;
      g.fillStyle(on ? PALETTE.primary : PALETTE.bgDeep, on ? 1 : 0.82).fillRoundedRect(0, 0, 88, 88, 16);
      g.lineStyle(on ? 3 : 2, on ? PALETTE.bgDeep : 0x3b3040, 1).strokeRoundedRect(0, 0, 88, 88, 16);
      const ink = on ? `#${PALETTE.bgDeep.toString(16).padStart(6, '0')}` : CSS.ink;
      const n = label(scene, 44, 32, `R${r}`, { size: 28, bold: true, color: ink, origin: [0.5, 0.5] });
      const st = stars(site.id, r, meta);
      const s = label(scene, 44, 66, '★'.repeat(st) + '☆'.repeat(3 - st), { size: 22, color: on ? ink : CSS.accent, origin: [0.5, 0.5] });
      const body = scene.add.container(0, 0, [g, n, s]).setAlpha(r > top ? 0.45 : 1);
      zone.add(body);
      card.add(zone);
    }
    const mul = 1 + COLONY_TUNING.meta.severityDataStep * (rung - 1);
    card.add(label(scene, CARD.x + CARD.w - 20, CARD.y + 140, `Data ×${mul.toFixed(2)}`, { size: 22, bold: true, color: CSS.accent, origin: [1, 0.5] }));

    // Kit chips 120 × 88 (5 kits; tap the selected one again for the Standard Crate).
    KITS.forEach((k, i) => {
      const x = CARD.x + 8 + i * 126;
      const y = CARD.y + 192;
      const open = kitUnlocked(k);
      const zone = tapZone(scene, x, y, 120, 88, () => pickKit(k));
      const on = k.id === kit.id;
      const g = scene.add.graphics();
      g.fillStyle(on ? PALETTE.primary : PALETTE.bgDeep, on ? 1 : 0.82).fillRoundedRect(0, 0, 120, 88, 16);
      g.lineStyle(on ? 3 : 2, on ? PALETTE.bgDeep : 0x3b3040, 1).strokeRoundedRect(0, 0, 120, 88, 16);
      const img = icon(scene, open ? `kit-${k.id.replace('kit_', '')}` : 'ark-locked', 48);
      const name = label(scene, 60, 72, k.name.replace(' Crate', ''), { size: 22, bold: true, color: on ? `#${PALETTE.bgDeep.toString(16).padStart(6, '0')}` : CSS.ink, origin: [0.5, 0.5] });
      if (name.width > 112) name.setScale(112 / name.width);
      const body = scene.add.container(0, 0, img === null ? [g, name] : [g, img.setPosition(60, 32), name]).setAlpha(open ? 1 : 0.45);
      zone.add(body);
      card.add(zone);
    });
    pin(card);
    launch.setLabel(`LAUNCH · ${site.name} R${rung}${kit.id === KIT_NONE.id ? '' : ` · ${kit.name.replace(' Crate', '')}`}`);
    launch.text.setScale(Math.min(1, 600 / Math.max(1, launch.text.width)));
  };

  const pickSite = (s: SiteDef): void => {
    const lock = siteLock(s);
    if (lock !== null) {
      actionToast(scene, `${s.name}: ${lock}`, { ms: 1800, y: TOAST_Y });
      return;
    }
    const prev = nodes.get(site.id);
    site = s;
    rung = Math.min(rung, maxRung(s.id));
    saveSelection(site, rung, kit);
    if (prev !== undefined) paintNode(prev, false, false);
    const next = nodes.get(s.id);
    if (next !== undefined) paintNode(next, true, false);
    refreshCard();
  };

  const pickKit = (k: LandingKit): void => {
    if (!kitUnlocked(k)) {
      actionToast(scene, `${k.name}: unlock on the ARK`, { ms: 2400, y: TOAST_Y, actionLabel: 'GO', onAction: () => api.goTab('ark') });
      return;
    }
    kit = kit.id === k.id ? KIT_NONE : k;
    saveSelection(site, rung, kit);
    refreshCard();
  };

  // ── DAILY + LAUNCH ──────────────────────────────────────────────────
  const meta = loadMeta();
  const best = loadDailyBest();
  // Same rule `model/score.ts:bank` pays by: today's daily already banked → a replay is practice.
  const playedToday = dailyPaid();
  // Wallet plate (a placard of its own, same row as DAILY): text sits on the plate, never over the map art.
  add(placard(scene, 40, 744, 330, 88));
  add(label(scene, 60, 772, `◆ ${num(meta.currency)} Data · ★ ${totalStars()}`, { size: 26, bold: true, color: CSS.accent, origin: [0, 0.5] }));
  add(label(scene, 60, 808, meta.streak.days > 0 ? `Daily streak ${meta.streak.days} day${meta.streak.days === 1 ? '' : 's'}` : 'Daily streak —', { size: 22, color: CSS.inkSoft, origin: [0, 0.5] }));
  const daily = new Control(scene, 380, 744, 300, 88, best === null ? 'DAILY' : `DAILY · best ${num(best)}`, 'secondary', () => api.launch(dailySetup(kit)), { size: 24 });
  if (playedToday) daily.setLabel(`DAILY · best ${num(best ?? 0)}\npractice — no Data`);
  daily.text.setScale(Math.min(1, 280 / Math.max(1, daily.text.width)));
  const launch = new Control(scene, 40, 844, 640, 112, 'LAUNCH', 'primary', () => api.launch(landingSetup({ site, rung, kit, daily: false, ftue: false })), { size: 34 });
  add(daily.root);
  add(launch.root);

  buildMap();
  refreshCard();
  const c = NODE_CENTRE[site.id];
  if (c !== undefined) map.scrollTo(c.y - MAP.h / 2);

  const onEnter = (): void => api.launch(landingSetup({ site, rung, kit, daily: false, ftue: false }));
  scene.input.keyboard?.on('keydown-ENTER', onEnter);
  return {
    destroy(): void {
      scene.input.keyboard?.off('keydown-ENTER', onEnter);
      map.destroy();
      for (const f of fades) {
        cameraRouter(scene).release(f.root);
        f.root.destroy();
        scene.cameras.remove(f.cam, true);
      }
      daily.destroy();
      launch.destroy();
      for (const o of objs) if (o.scene) o.destroy();
      objs.length = 0;
    },
  };
}

function paintNode(g: Phaser.GameObjects.Graphics, selected: boolean, locked: boolean): void {
  g.clear();
  g.fillStyle(PALETTE.bgDeep, locked ? 0.7 : 0.85).fillCircle(0, 0, NODE_R);
  g.lineStyle(selected ? 6 : 3, selected ? PALETTE.primary : locked ? 0x3b3040 : PALETTE.accent, 1).strokeCircle(0, 0, NODE_R - 3);
}
