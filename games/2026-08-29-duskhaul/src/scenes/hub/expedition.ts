/**
 * EXPEDITION tab (PRD-V2 §14.3), Zone sheet (§14.3 / FlowAudit §2.4), Loadout
 * sheet (§14.4 / FlowAudit §2.5) and Settings sheet (§14.2).
 *
 * Rects are the spec's SCREEN rects; content-local y = screen y − 168 (the
 * content band origin). Sheets use sheet-local y = screen y − sheet top.
 */
import Phaser from 'phaser';
import { masteryStars } from '../../core/collections';
import { CSS, PALETTE, TUNING } from '../../config';
import { sfx } from '../../core/audio';
import { contractText } from '../../core/contracts';
import { dailyInfo, weeklyInfo } from '../../core/daily';
import {
  beltSlotsUnlocked,
  featureUnlocked,
  hazardStatus,
  loadMeta,
  loadoutHash,
  selectClass,
  selectZone,
  startWeaponChoice,
  statBreakdown,
  zonePlayed,
  zoneStatus,
} from '../../core/progression';
import { CLASSES, classDef } from '../../data/classes';
import { CONTRACTS } from '../../data/contracts';
import { enemyDef } from '../../data/enemies';
import { rarityOdds } from '../../data/gear';
import { HAZARDS, hazardDef } from '../../data/hazards';
import { MUTATORS } from '../../data/mutators';
import type { HazardLevel, MetaSaveV4, MutatorId, ZoneId } from '../../data/types-v2';
import { weaponDef } from '../../data/weapons';
import { ZONES, zoneDef, type ZoneDef } from '../../data/zones';
import { Button } from '../../ui/button';
import { BUTTON_STYLE, DEEP_INK, PANEL, rarityColor, rarityName } from '../../ui/duskChrome';
import { iconFor, lootIconId } from '../../ui/itemIcon';
import { actionToast, openSheet, type HubSheet } from '../../ui/sheet';
import { chip, label, num, panelAt, progressBar, raritySwatch, tapZone } from '../../ui/widgets';
import { hubApi, type HubTab, type RunStart } from './hub';
import { startWeaponRow } from './startWeapon';
import { SLOT_LABEL, statLine } from './format';
import { GEAR_SLOTS as SLOT_ORDER } from '../../data/gear';

const C = 168;

/** FlowAudit §2.4: threatBase 1.00/1.15/1.30/1.50 → 1-4 skulls + word. */
function danger(zone: ZoneDef): { skulls: number; word: string } {
  const t = zone.threatBase;
  if (t >= 1.5) return { skulls: 4, word: 'DEADLY' };
  if (t >= 1.3) return { skulls: 3, word: 'HIGH' };
  if (t >= 1.15) return { skulls: 2, word: 'MODERATE' };
  return { skulls: 1, word: 'LOW' };
}

function mutatorName(id: MutatorId): string {
  return MUTATORS.find((m) => m.id === id)?.name ?? id;
}


function drawStar(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, filled: boolean): void {
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(new Phaser.Math.Vector2(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr));
  }
  if (filled) {
    g.fillStyle(PALETTE.accent, 1);
    g.fillPoints(pts, true);
  }
  g.lineStyle(2, filled ? PALETTE.accent : PALETTE.inkSoft, 1);
  g.strokePoints(pts, true, true);
}

function drawSkull(g: Phaser.GameObjects.Graphics, cx: number, cy: number, on: boolean): void {
  g.fillStyle(on ? PALETTE.bad : 0x303e41, 1);
  g.fillCircle(cx, cy - 3, 11);
  g.fillRoundedRect(cx - 7, cy + 4, 14, 9, 2);
  g.fillStyle(DEEP_INK, 1);
  g.fillCircle(cx - 4, cy - 3, 3);
  g.fillCircle(cx + 4, cy - 3, 3);
}

export function drawPadlock(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number, tone: number = PALETTE.ink): void {
  g.lineStyle(Math.max(3, s * 0.12), tone, 1);
  g.beginPath();
  g.arc(cx, cy - s * 0.15, s * 0.28, Math.PI, 0, false);
  g.strokePath();
  g.fillStyle(tone, 1);
  g.fillRoundedRect(cx - s * 0.4, cy - s * 0.12, s * 0.8, s * 0.6, s * 0.08);
}

/** Cover-crops a 640×300 zone key art into `w`×`h` at (x,y) top-left; null when missing. */
function keyArt(scene: Phaser.Scene, zone: ZoneId, x: number, y: number, w: number, h: number): Phaser.GameObjects.Image | null {
  const key = `zone-key-${zone}`;
  if (!scene.textures.exists(key)) return null;
  const img = scene.add.image(x, y, key).setOrigin(0, 0);
  const scale = Math.max(w / img.width, h / img.height);
  img.setScale(scale);
  const cropY = (img.height * scale - h) / 2 / scale;
  img.setCrop(0, cropY, w / scale, h / scale);
  img.setY(y - cropY * scale);
  return img;
}

function currentHazard(meta: MetaSaveV4, zone: ZoneId): HazardLevel {
  const h = meta.selection.hazard[zone];
  return hazardStatus(zone, h).unlocked ? h : 1;
}

export function buildExpeditionTab(scene: Phaser.Scene, content: Phaser.GameObjects.Container): HubTab {
  const api = hubApi(scene);
  let swipeStart: { x: number; y: number } | null = null;

  // A locked zone can be VIEWED (its lock reason on the tile) but not selected,
  // so the carousel keeps its own index while one is on screen.
  let viewedLocked: number | null = null;
  const selectedIndex = (): number => {
    if (viewedLocked !== null) return viewedLocked;
    const zone = loadMeta().selection.zone;
    return Math.max(0, ZONES.findIndex((z) => z.id === zone));
  };

  const setZone = (index: number): void => {
    const i = (index + ZONES.length) % ZONES.length;
    const zone = ZONES[i];
    if (zone === undefined) return;
    const meta = loadMeta();
    viewedLocked = selectZone(zone.id, currentHazard(meta, zone.id)).ok ? null : i;
    build();
  };

  const build = (): void => {
    content.removeAll(true);
    const meta = loadMeta();
    const zi = selectedIndex();
    const zone = ZONES[zi] ?? ZONES[0];
    if (zone === undefined) return;
    const status = zoneStatus(zone.id);
    const hazard = currentHazard(meta, zone.id);

    // ── Zone tile (40,184,640,470) ──
    const tileY = 184 - C;
    content.add(panelAt(scene, 40, tileY, 640, 470));
    const art = keyArt(scene, zone.id, 40, tileY, 640, 260);
    if (art !== null) {
      if (!status.unlocked) art.setTint(0x555566);
      content.add(art);
    } else {
      content.add(scene.add.rectangle(40, tileY, 640, 260, zone.lightTint, 0.25).setOrigin(0, 0));
    }
    // Tapping the tile opens the zone sheet (locked tiles explain their rule there).
    const tileTap = tapZone(scene, 40, tileY, 640, 260, () => openZoneSheet(scene, zone.id), true);
    content.add(tileTap);
    if (!status.unlocked) {
      const lock = scene.add.graphics();
      drawPadlock(lock, 360, tileY + 120, 64);
      content.add(lock);
      content.add(label(scene, 360, tileY + 200, status.reason, { size: 22, bold: true, origin: [0.5, 0.5], align: 'center', wrap: 560 }));
    }
    // INFO 104×56 at (560,200); hit grown to 104×88.
    const info = tapZone(scene, 560, 200 - C - 16, 104, 88, () => openZoneSheet(scene, zone.id));
    const ig = scene.add.graphics();
    ig.fillStyle(DEEP_INK, 0.85);
    ig.fillRoundedRect(0, 16, 104, 56, 28);
    ig.lineStyle(2, PALETTE.ink, 0.7);
    ig.strokeRoundedRect(1, 17, 102, 54, 28);
    info.add([ig, label(scene, 52, 44, 'INFO', { size: 22, bold: true, origin: [0.5, 0.5] })]);
    content.add(info);
    // Chevrons 88×88 at (40,380)/(592,380).
    for (const dir of [-1, 1] as const) {
      const x = dir < 0 ? 40 : 592;
      const chev = tapZone(scene, x, 380 - C, 88, 88, () => setZone(zi + dir));
      const cg = scene.add.graphics();
      cg.fillStyle(DEEP_INK, 0.7);
      cg.fillCircle(44, 44, 36);
      cg.lineStyle(6, PALETTE.ink, 1);
      cg.beginPath();
      cg.moveTo(44 - dir * 8, 26);
      cg.lineTo(44 + dir * 10, 44);
      cg.lineTo(44 - dir * 8, 62);
      cg.strokePath();
      chev.add(cg);
      content.add(chev);
    }
    // Name 44 px + mastery stars (3×36, right).
    const nameY = tileY + 260 + 44;
    content.add(label(scene, 64, nameY, zone.name.toUpperCase(), { size: 40, bold: true, origin: [0, 0.5] }));
    const stars = scene.add.graphics();
    const lit = masteryStars(meta, zone.id);
    for (let i = 0; i < 3; i++) drawStar(stars, 560 + i * 40, nameY, 17, i < lit);
    content.add(stars);
    // DANGER skulls + word.
    const d = danger(zone);
    const dy = nameY + 56;
    content.add(label(scene, 64, dy, 'DANGER', { size: 20, bold: true, color: CSS.inkSoft, origin: [0, 0.5] }));
    const sk = scene.add.graphics();
    for (let i = 0; i < 4; i++) drawSkull(sk, 180 + i * 30, dy, i < d.skulls);
    content.add([sk, label(scene, 310, dy, d.word, { size: 22, bold: true, origin: [0, 0.5] })]);
    // BEST LOOT: 5 swatch bars from the same odds rollGear uses.
    const ly = dy + 52;
    const odds = rarityOdds(zone.lootBias + hazardDef(hazard).lootBias);
    let best = 1;
    odds.forEach((p, i) => {
      if (p > 0) best = i + 1;
    });
    content.add(label(scene, 64, ly, `BEST LOOT: ${rarityName(best).toUpperCase()}`, { size: 20, bold: true, color: CSS.inkSoft, origin: [0, 0.5] }));
    const maxP = Math.max(...odds, 0.0001);
    const bars = scene.add.graphics();
    odds.slice(0, 5).forEach((p, i) => {
      const bx = 400 + i * 54;
      const h = 8 + 32 * (p / maxP);
      bars.fillStyle(rarityColor(i + 1), 1);
      bars.fillRoundedRect(bx, ly + 20 - h, 40, h, 4);
      bars.lineStyle(2, 0x7e7376, 1);
      bars.strokeRoundedRect(bx, ly + 20 - h, 40, h, 4);
    });
    content.add(bars);

    // Pager dots y 664.
    const dots = scene.add.graphics();
    ZONES.forEach((_, i) => {
      dots.fillStyle(i === zi ? PALETTE.ink : PALETTE.inkSoft, i === zi ? 1 : 0.4);
      dots.fillCircle(360 + (i - (ZONES.length - 1) / 2) * 28, 664 - C, i === zi ? 7 : 5);
    });
    content.add(dots);

    // ── Hazard selector (40,680,640,72) ──
    const hz = scene.add.container(0, 0);
    hz.add(panelAt(scene, 40, 680 - C, 640, 72));
    const allCleared = HAZARDS.length > 0 && meta.mastery[zone.id].extract && hazardStatus(zone.id, 5).unlocked && (meta.stats.bestHaul[`${zone.id}:5`] ?? 0) > 0;
    for (let h = 1 as HazardLevel; h <= 5; h = (h + 1) as HazardLevel) {
      const hs = hazardStatus(zone.id, h);
      const x = 40 + (h - 1) * 128;
      const lvl = h;
      const cell = tapZone(scene, x, 680 - C - 8, 128, 88, () => {
        if (!hs.unlocked) {
          actionToast(scene, hs.reason);
          return;
        }
        selectZone(zone.id, lvl);
        build();
      });
      const on = lvl === hazard;
      if (on) cell.setData('noop', 'hazard already selected');
      if (on) {
        const g = scene.add.graphics();
        g.fillStyle(PALETTE.primary, 0.92);
        g.fillRoundedRect(4, 12, 120, 64, 10);
        cell.add(g);
      }
      if (hs.unlocked) {
        cell.add(label(scene, 64, 44, `H${lvl}`, { size: 26, bold: true, color: on ? '#03040b' : CSS.ink, origin: [0.5, 0.5] }));
      } else {
        const lg = scene.add.graphics();
        drawPadlock(lg, 44, 46, 26, PALETTE.inkSoft);
        cell.add([lg, label(scene, 76, 44, `H${lvl}`, { size: 22, bold: true, color: CSS.inkSoft, origin: [0.5, 0.5] })]);
      }
      hz.add(cell);
    }
    content.add(hz);
    if (allCleared) {
      content.add(label(scene, 680, 672 - C, 'H5 MASTERED', { size: 16, bold: true, color: CSS.accent, origin: [1, 1] }));
    }

    // ── Daily Rite (40,764,312,120) / Weekly Rift (368,764,312,120) ──
    const now = new Date();
    const daily = dailyInfo(now);
    const dailyOpen = featureUnlocked(meta, 'feature:daily');
    const dailyPlayed = meta.daily.day === daily.day && meta.daily.played;
    const dailyState = !dailyOpen ? 'Locked · L8' : dailyPlayed ? (meta.daily.rewarded ? 'Played today · reward taken' : 'Played today') : `${num(200)} ◆ + 30 dust`;
    content.add(
      riteCard(scene, 40, 764 - C, 'DAILY RITE', daily.mutators.map(mutatorName).join(' · '), dailyState, dailyOpen, () =>
        openLoadoutSheet(scene, { zone: daily.zone, hazard: daily.hazard, mode: 'daily', seed: daily.seed }),
      ),
    );
    const weekly = weeklyInfo(now);
    const weeklyOpen = featureUnlocked(meta, 'feature:weekly');
    const weeklyDone = meta.weekly.week === weekly.week && meta.weekly.rewarded;
    const weeklyState = !weeklyOpen ? 'Unlocks at L15' : weeklyDone ? 'Cleared this week' : '3 ✦ + 400 ◆';
    content.add(
      riteCard(scene, 368, 764 - C, 'WEEKLY RIFT', weekly.mutators.map(mutatorName).join(' · '), weeklyState, weeklyOpen, () =>
        openLoadoutSheet(scene, { zone: weekly.zone, hazard: weekly.hazard, mode: 'weekly', seed: weekly.seed }),
      ),
    );

    // ── Contract strip (40,896,640,88) — 88 tall (not 96) so a 16 px gap
    //    separates it from EMBARK; at 8 px the CTA's dark rim read as a plate
    //    tucked under the strip (QA 8). ──
    content.add(panelAt(scene, 40, 896 - C, 640, 88));
    const contractsOpen = featureUnlocked(meta, 'feature:contracts');
    const top = [...meta.contracts.active].sort((a, b) => b.progress / b.target - a.progress / a.target)[0];
    if (!contractsOpen) {
      content.add(label(scene, 64, 940 - C, 'Contracts unlock at L2', { size: 24, color: CSS.inkSoft, origin: [0, 0.5] }));
    } else if (top === undefined) {
      content.add(label(scene, 64, 940 - C, 'New contracts at dawn', { size: 24, color: CSS.inkSoft, origin: [0, 0.5] }));
    } else {
      const def = CONTRACTS.find((c) => c.id === top.id);
      const reward = def?.reward.shards !== undefined ? ` · ${num(def.reward.shards)} ◆` : '';
      const line = label(scene, 64, 922 - C, contractText(top), { size: 22, bold: true, origin: [0, 0.5] });
      if (line.width > 470) line.setScale(470 / line.width);
      content.add(line);
      content.add(label(scene, 64, 958 - C, `${Math.min(top.progress, top.target)}/${top.target}${reward}`, { size: 20, color: CSS.inkSoft, origin: [0, 0.5] }));
      content.add(progressBar(scene, 250, 951 - C, 260, 14, top.progress / top.target, PALETTE.accent));
    }
    // ALL: a 56 px chip drawn INSIDE the strip (hit rect grown to 88 by tapZone),
    // so its ring never spills over the strip edges (QA 8).
    content.add(chip(scene, 560, 912 - C, 104, 'ALL', false, () => api.goTab('codex', 'CONTRACTS'), 56));

    // ── EMBARK (40,1004,640,106) ──
    const embark = new Button(
      scene,
      360,
      1057 - C,
      status.unlocked ? 'EMBARK' : `LOCKED · ${status.reason}`,
      () => {
        const m = loadMeta();
        // §5.28: until the Wicket is done (extracted, or retries used up), every
        // embark IS the Wicket — the Hub never bypasses the FTUE (QA 5).
        if (!m.flags.ftueDone) {
          api.startRun({ zone: 'castle', hazard: 1, mode: 'ftue', seed: 'wicket' });
          return;
        }
        const sel: RunStart = { zone: zone.id, hazard, mode: 'normal' };
        // Skip rule (FlowAudit §2.5): unchanged loadout + zone played before ⇒ 1 tap.
        if (loadoutHash() === m.selection.lastLoadoutHash && zonePlayed(zone.id)) api.startRun(sel);
        else openLoadoutSheet(scene, sel);
      },
      { width: 640, height: 106, fontSize: status.unlocked ? '44px' : '22px', ...(status.unlocked ? BUTTON_STYLE.primary : BUTTON_STYLE.disabled) },
    );
    if (!status.unlocked) embark.setEnabled(false, () => actionToast(scene, status.reason));
    content.add(embark);

    api.setContentHeight(1110 - C + 10);
  };

  // Horizontal swipe on the tile changes zone (vertical drags scroll the tab).
  const onDown = (p: Phaser.Input.Pointer): void => {
    const localY = p.y - C + api.scrollView().offset;
    swipeStart = p.x >= 40 && p.x <= 680 && localY >= 184 - C && localY <= 654 - C ? { x: p.x, y: p.y } : null;
  };
  const onUp = (p: Phaser.Input.Pointer): void => {
    if (swipeStart === null) return;
    const dx = p.x - swipeStart.x;
    const dy = p.y - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) setZone(selectedIndex() + (dx < 0 ? 1 : -1));
  };
  scene.input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
  scene.input.on(Phaser.Input.Events.POINTER_UP, onUp);

  build();
  return {
    refresh: build,
    destroy(): void {
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
      scene.input.off(Phaser.Input.Events.POINTER_UP, onUp);
      content.removeAll(true);
    },
  };
}

function riteCard(
  scene: Phaser.Scene,
  x: number,
  y: number,
  title: string,
  mutators: string,
  state: string,
  open: boolean,
  onTap: () => void,
): Phaser.GameObjects.Container {
  const c = tapZone(scene, x, y, 312, 120, () => {
    if (open) onTap();
    else actionToast(scene, `${title}: ${state}`);
  });
  const g = scene.add.graphics();
  g.fillStyle(PANEL.fill, PANEL.fillAlpha);
  g.fillRoundedRect(0, 0, 312, 120, 12);
  g.lineStyle(2, open ? PALETTE.secondary : PANEL.stroke, 0.8);
  g.strokeRoundedRect(1, 1, 310, 118, 12);
  c.add(g);
  c.add(label(scene, 18, 16, title, { size: 22, bold: true }));
  c.add(label(scene, 18, 48, open ? mutators : '', { size: 18, color: CSS.inkSoft, wrap: 280 }));
  c.add(label(scene, 18, 104, state, { size: 18, bold: true, color: open ? CSS.accent : CSS.inkSoft, origin: [0, 1] }));
  if (!open) c.setAlpha(0.6);
  return c;
}

/** Zone detail sheet (FlowAudit §2.4 + hazard list + boss names + gate kinds). No purchase. */
function openZoneSheet(scene: Phaser.Scene, zoneId: ZoneId): void {
  const zone = zoneDef(zoneId);
  const meta = loadMeta();
  const sheet = openSheet(scene, { height: 880, onClose: () => undefined, title: zone.name.toUpperCase() });
  const status = zoneStatus(zoneId);
  const view = sheet.scroll({ x: 0, y: sheet.top + 100, width: 720, height: 780 });
  const add = (obj: Phaser.GameObjects.GameObject): void => {
    view.root.add(obj);
  };
  let y = 0;
  const line = (text: string, size = 24, color: string = CSS.ink, bold = false): void => {
    const t = label(scene, 40, y, text, { size, color, bold, wrap: 640 });
    add(t);
    y += t.height + 14;
  };
  const d = danger(zone);
  const pct = Math.round((zone.threatBase - 1) * 100);
  line(`Danger: ${d.word.charAt(0)}${d.word.slice(1).toLowerCase()} — ${pct === 0 ? 'enemies at normal strength' : `Enemies +${pct}% health and damage`}`, 24, CSS.ink, true);
  if (!status.unlocked) line(status.reason, 24, CSS.warn, true);
  line(`Hazard: ${HAZARD_COPY[zone.hazard.kind]}`);
  line(`Locals: ${zone.exclusives.map((id) => enemyName(id)).join(', ')}`);
  line(`Boss: ${zone.bossName} · Mid-boss: ${zone.midBossName}`);
  const cond = new Set<string>();
  for (const s of zone.gateSlots) if (s.id === 'x') for (const k of s.kinds) cond.add(GATE_KIND[k] ?? k);
  line(`Gates: A opens ${clockS(TUNING.gate.a.openS)}, B ${clockS(TUNING.gate.b.openS)}, C ${clockS(TUNING.gate.c.openS)} · plus one of ${[...cond].join(' / ')}`);
  y += 8;
  line('HAZARD LEVELS', 22, CSS.inkSoft, true);
  for (const h of HAZARDS) {
    const hs = hazardStatus(zoneId, h.level);
    const best = meta.stats.bestHaul[`${zoneId}:${h.level}`] ?? 0;
    line(`H${h.level} · threat ×${h.threatMul.toFixed(2)} · item level ${h.itemLevel}${hs.unlocked ? (best > 0 ? ` · best ${num(best)} ◆` : '') : ` · ${hs.reason}`}`, 20, hs.unlocked ? CSS.ink : CSS.inkSoft);
  }
  y += 8;
  line('LOOT ODDS', 22, CSS.inkSoft, true);
  const odds = rarityOdds(zone.lootBias + hazardDef(currentHazard(meta, zoneId)).lootBias);
  odds.forEach((p, i) => {
    add(raritySwatch(scene, 52, y + 12, i + 1, 20));
    add(label(scene, 76, y, `${rarityName(i + 1)} ${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`, { size: 20 }));
    y += 34;
  });
  const bestZone = Math.max(0, ...Object.entries(meta.stats.bestHaul).filter(([k]) => k.startsWith(`${zoneId}:`)).map(([, v]) => v));
  y += 8;
  line(`Best haul: ${num(bestZone)} ◆ · Mastery ${masteryStars(meta, zoneId)}/3`, 22, CSS.accent, true);
  view.setContentHeight(y + 40);
}

const HAZARD_COPY: Record<ZoneDef['hazard']['kind'], string> = {
  braziers: 'Cursed braziers pulse fire every 5s. Stand clear of the ring.',
  bonestorm: 'Bonestorm gusts push you every 45s; ash zones burn on the roads.',
  sinksand: 'Sinksand pits slow and drag; the sun scorches outside shade late.',
  gale: 'The gale slows you 30% away from torches; ice sheets slide.',
};

const GATE_KIND: Record<string, string> = { timed: 'Timed', toll: 'Toll Gate', offering: 'Offering Altar', bell: 'Bell Gate' };

function enemyName(id: string): string {
  try {
    return enemyDef(id).name;
  } catch {
    return id;
  }
}

function clockS(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

/**
 * Loadout sheet (§14.4): 720×960 from y 320. Never confirms; DESCEND starts
 * the run, CHANGE GEAR goes to ARMORY.
 */
export function openLoadoutSheet(scene: Phaser.Scene, sel: RunStart): HubSheet {
  const api = hubApi(scene);
  const sheet = openSheet(scene, { height: 960, onClose: () => undefined });
  const T = sheet.top;
  const build = (): void => {
    sheet.content.removeAll(true);
    const meta = loadMeta();
    const zone = zoneDef(sel.zone);
    const mode = sel.mode === 'daily' ? 'DAILY RITE · ' : sel.mode === 'weekly' ? 'WEEKLY RIFT · ' : '';
    // One line, scaled to clear the 88 px close X (QA 13) — never wrapped.
    const header = label(scene, 40, 360 - T, `${mode}DESCEND INTO ${zone.name.toUpperCase()} · H${sel.hazard}`, { size: 26, bold: true, origin: [0, 0.5] });
    if (header.width > 540) header.setScale(540 / header.width);
    sheet.content.add(header);

    // Class chip 640×88 at y 410.
    const cls = classDef(meta.classId);
    const chipC = tapZone(scene, 40, 410 - T, 640, 88, () => openClassPicker(scene, build));
    chipC.add(panelAt(scene, 0, 0, 640, 88));
    chipC.add(iconFor(scene, `icon-class-${cls.id}`, 64, PALETTE.primary, 'disc').setPosition(48, 44));
    const clsText = label(scene, 96, 44, `${cls.name.toUpperCase()} · starts with ${weaponDef(startWeaponChoice().effective).name}`, { size: 24, bold: true, origin: [0, 0.5] });
    // Long weapon names must not run under the chevron.
    if (clsText.width > 490) clsText.setScale(490 / clsText.width);
    chipC.add(clsText);
    chipC.add(label(scene, 620, 44, '›', { size: 40, bold: true, color: CSS.inkSoft, origin: [1, 0.5] }));
    sheet.content.add(chipC);

    // Gear row y 510-690: 6 tiles 96×96 at x 40 + i×108.
    SLOT_ORDER.forEach((slot, i) => {
      const x = 40 + i * 108;
      const uid = meta.equipped[slot];
      const item = uid === null ? undefined : meta.vault.gear.find((g) => g.uid === uid);
      const open = featureUnlocked(meta, `slot:${slot}`);
      const tile = tapZone(scene, x, 510 - T, 96, 96, () => {
        sheet.close();
        api.goTab('armory');
      });
      const g = scene.add.graphics();
      g.fillStyle(DEEP_INK, 0.85);
      g.fillRoundedRect(0, 0, 96, 96, 12);
      if (item !== undefined) {
        g.lineStyle(3, rarityColor(item.rarity), 1);
        g.strokeRoundedRect(2, 2, 92, 92, 12);
        tile.add([g, iconFor(scene, lootIconId({ kind: 'gear', item }), 70, rarityColor(item.rarity), 'square').setPosition(48, 48)]);
        tile.add(raritySwatch(scene, 80, 80, item.rarity, 14));
      } else {
        dashedRect(g, 2, 2, 92, 92, PALETTE.inkSoft);
        tile.add(g);
        if (open) tile.add(label(scene, 48, 48, '+', { size: 44, bold: true, color: CSS.inkSoft, origin: [0.5, 0.5] }));
        else {
          const lg = scene.add.graphics();
          drawPadlock(lg, 48, 44, 34, PALETTE.inkSoft);
          tile.add(lg);
        }
      }
      tile.add(label(scene, 48, 104, SLOT_LABEL[slot], { size: 16, bold: true, color: CSS.inkSoft, origin: [0.5, 0] }));
      sheet.content.add(tile);
    });
    const anyGear = SLOT_ORDER.some((s) => meta.equipped[s] !== null);
    // STARTING WEAPON (y 636-700) under the gear row.
    sheet.content.add(startWeaponRow(scene, 40, 636 - T, 64, build));
    if (!anyGear) sheet.content.add(label(scene, 40, 704 - T, 'EMPTY — equip in Armory', { size: 16, color: CSS.inkSoft }));

    // Stats y 710-820, two columns.
    const stats = statBreakdown();
    const lines: string[] = [];
    for (const key of ['maxHp', 'damageMul', 'moveSpeed', 'bagCells'] as const) {
      const s = stats.find((r) => r.stat === key);
      if (s !== undefined) lines.push(statLine(key, s.base, s.total));
    }
    const casket = TUNING.bag.casketSlots + (meta.upgrades.m_casket ?? 0);
    lines.push(`Casket ${casket}`);
    lines.push(`Revives ${meta.upgrades.m_revive ?? 0}`);
    lines.forEach((text, i) => {
      sheet.content.add(label(scene, i % 2 === 0 ? 40 : 380, 728 - T + Math.floor(i / 2) * 36, text, { size: 24 }));
    });

    // Belt y 840: 2 slots 96×96.
    const beltOpen = beltSlotsUnlocked(meta);
    for (let s = 0; s < 2; s++) {
      const x = 40 + s * 108;
      const slot = meta.belt[s as 0 | 1];
      const tile = tapZone(scene, x, 840 - T, 96, 96, () => {
        sheet.close();
        api.goTab('armory');
      });
      const g = scene.add.graphics();
      g.fillStyle(DEEP_INK, 0.85);
      g.fillRoundedRect(0, 0, 96, 96, 12);
      g.lineStyle(2, PANEL.stroke, 0.8);
      g.strokeRoundedRect(1, 1, 94, 94, 12);
      tile.add(g);
      if (s >= beltOpen) tile.add(label(scene, 48, 48, s === 0 ? 'LOCKED\nL7' : 'LOCKED\nL22', { size: 16, bold: true, color: CSS.inkSoft, origin: [0.5, 0.5], align: 'center' }));
      else if (slot === null) tile.add(label(scene, 48, 48, 'EMPTY\nBUY', { size: 16, bold: true, color: CSS.inkSoft, origin: [0.5, 0.5], align: 'center' }));
      else {
        tile.add(iconFor(scene, `icon-cb-${slot.id}`, 70, PALETTE.good, 'disc').setPosition(48, 48));
        tile.add(label(scene, 88, 88, `×${slot.charges}`, { size: 20, bold: true, origin: [1, 1] }));
      }
      sheet.content.add(tile);
    }
    sheet.content.add(label(scene, 270, 888 - T, 'BELT', { size: 20, bold: true, color: CSS.inkSoft, origin: [0, 0.5] }));

    // Risk line y 956.
    const tithe = meta.upgrades.m_tithe ?? 0;
    const keep = tithe > 0 ? TUNING.meta.tithePct[Math.min(tithe, TUNING.meta.tithePct.length) - 1] : TUNING.meta.deathKeepPct;
    sheet.content.add(label(scene, 40, 956 - T, `Death keeps ${keep}% of shards and your casket.`, { size: 22, color: CSS.warn, origin: [0, 0.5] }));

    sheet.content.add(
      new Button(scene, 40 + 156, 1040 - T + 44, 'CHANGE GEAR', () => {
        sheet.close();
        api.goTab('armory');
      }, { width: 312, height: 88, fontSize: '28px', ...BUTTON_STYLE.idle }),
    );
    sheet.content.add(
      new Button(scene, 368 + 156, 1040 - T + 44, 'DESCEND', () => api.startRun(sel), {
        width: 312,
        height: 88,
        fontSize: '32px',
        ...BUTTON_STYLE.primary,
      }),
    );
  };
  build();
  return sheet;
}

export function dashedRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.lineStyle(2, color, 0.8);
  const dash = 10;
  for (let i = 0; i < w; i += dash * 2) {
    g.lineBetween(x + i, y, x + Math.min(i + dash, w), y);
    g.lineBetween(x + i, y + h, x + Math.min(i + dash, w), y + h);
  }
  for (let i = 0; i < h; i += dash * 2) {
    g.lineBetween(x, y + i, x, y + Math.min(i + dash, h));
    g.lineBetween(x + w, y + i, x + w, y + Math.min(i + dash, h));
  }
}

/** Class picker (from the Loadout class chip): locked classes show `L10`. */
function openClassPicker(scene: Phaser.Scene, onChanged: () => void): void {
  const sheet = openSheet(scene, { height: 760, onClose: () => undefined, title: 'CHOOSE YOUR HAULER' });
  const meta = loadMeta();
  CLASSES.forEach((cls, i) => {
    const y = 110 + i * 150;
    const unlocked = featureUnlocked(meta, `class:${cls.id}`);
    const selected = meta.classId === cls.id;
    const row = tapZone(scene, 40, y, 640, 136, () => {
      if (!unlocked) {
        actionToast(scene, `${cls.name} unlocks at L${cls.unlockLevel}.`);
        return;
      }
      const r = selectClass(cls.id);
      if (!r.ok) {
        actionToast(scene, r.reason ?? 'Locked');
        return;
      }
      sfx('pickup');
      sheet.close();
      onChanged();
    });
    row.add(panelAt(scene, 0, 0, 640, 136, selected ? { stroke: PALETTE.primary, strokeAlpha: 1, strokeWidth: 3 } : {}));
    row.add(iconFor(scene, `icon-class-${cls.id}`, 96, PALETTE.primary, 'disc').setPosition(68, 68));
    row.add(label(scene, 132, 18, cls.name.toUpperCase(), { size: 28, bold: true }));
    row.add(label(scene, 132, 56, `Starts with ${weaponDef(cls.startWeapon).name}`, { size: 20, color: CSS.inkSoft }));
    row.add(label(scene, 132, 84, cls.passive, { size: 18, color: CSS.ink, wrap: 490 }));
    if (!unlocked) {
      row.setAlpha(0.55);
      row.add(label(scene, 620, 18, `L${cls.unlockLevel}`, { size: 26, bold: true, color: CSS.warn, origin: [1, 0] }));
    } else if (selected) {
      row.add(label(scene, 620, 18, 'SELECTED', { size: 18, bold: true, color: CSS.primary, origin: [1, 0] }));
    }
    sheet.content.add(row);
  });
}
