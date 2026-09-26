/**
 * CODEX tab (PRD-V2 §14.8): CONTRACTS (weekly card + active rows, CLAIM /
 * REROLL), BESTIARY (silhouette grid → entry sheet), COLLECTION (ARSENAL /
 * ARMORY / VALUABLES / LORE with found/total), RECORDS (account ladder, zone
 * mastery + bests, achievements with CLAIM).
 */
import Phaser from 'phaser';
import { CSS, PALETTE } from '../../config';
import { sfx } from '../../core/audio';
import { BESTIARY, KILL_TIERS, TIER_DAMAGE_PCT, codexProgress, killTier, masteryStars } from '../../core/collections';
import { contractText } from '../../core/contracts';
import {
  accountLevel,
  claimAchievement,
  claimContract,
  featureUnlocked,
  loadMeta,
  rerollContract,
} from '../../core/progression';
import { ACHIEVEMENTS } from '../../data/achievements';
import { CHARMS } from '../../data/charms';
import { WEEKLY_REWARD, WEEKLY_STEPS, contractDef, type ContractReward } from '../../data/contracts';
import { enemyDef } from '../../data/enemies';
import { GEAR_BASES, UNIQUES } from '../../data/gear';
import { ACCOUNT_LADDER } from '../../data/sanctum';
import type { MetaSaveV4, ZoneId } from '../../data/types-v2';
import { VALUABLES } from '../../data/valuables';
import { WEAPONS } from '../../data/weapons';
import { ZONES, zoneDef } from '../../data/zones';
import { Button } from '../../ui/button';
import { BUTTON_STYLE, DEEP_INK } from '../../ui/duskChrome';
import { iconFor } from '../../ui/itemIcon';
import { actionToast, openSheet } from '../../ui/sheet';
import { chip, clock, iconLine, label, num, panelAt, progressBar, segmented, tapZone } from '../../ui/widgets';
import { groupUnlocks, unlockLevelOf } from './format';
import { hubApi, type HubTab } from './hub';

const C = 168;
const SEGMENTS = ['CONTRACTS', 'BESTIARY', 'COLLECTION', 'RECORDS'] as const;
type Segment = (typeof SEGMENTS)[number];
const SUBSETS = ['ARSENAL', 'ARMORY', 'VALUABLES', 'LORE'] as const;

/** One collection tile. `lockLv` = ladder level that opens it (absent = always open). */
interface Entry {
  icon: string;
  name: string;
  seen: boolean;
  tone: number;
  lockLv?: number;
}

/** 5-column collection grid; returns the y under it. */
function drawEntries(scene: Phaser.Scene, content: Phaser.GameObjects.Container, entries: readonly Entry[], y: number, level: number): number {
  const gap = (640 - 5 * 116) / 4;
  entries.forEach((e, i) => {
    const x = 40 + (i % 5) * (116 + gap);
    const ey = y + Math.floor(i / 5) * 156;
    const locked = e.lockLv !== undefined && e.lockLv > level;
    content.add(panelAt(scene, x, ey, 116, 116, locked ? { strokeAlpha: 0.35 } : {}));
    const icon = iconFor(scene, e.icon, 88, e.tone, 'disc').setPosition(x + 58, ey + 58);
    if (!e.seen) icon.setTint(DEEP_INK).setTintMode(Phaser.TintModes.FILL).setAlpha(locked ? 0.55 : 0.85);
    content.add(icon);
    const caption = locked ? `Unlocks at L${e.lockLv}` : e.seen || e.lockLv !== undefined ? e.name : '???';
    content.add(label(scene, x + 58, ey + 120, caption, { size: 14, bold: locked, color: e.seen ? CSS.ink : locked ? CSS.warn : CSS.inkSoft, origin: [0.5, 0], align: 'center', wrap: 124 }));
  });
  return y + Math.ceil(entries.length / 5) * 156;
}
type SubSet = (typeof SUBSETS)[number];

function rewardText(r: ContractReward): string {
  const parts: string[] = [];
  if (r.shards !== undefined) parts.push(`${num(r.shards)} ◆`);
  if (r.dust !== undefined) parts.push(`${r.dust} dust`);
  if (r.sigils !== undefined) parts.push(`${r.sigils} ✦`);
  if (r.items !== undefined) parts.push(`${r.items} item${r.items > 1 ? 's' : ''}`);
  if (r.xp !== undefined) parts.push(`${r.xp} XP`);
  return parts.join(' + ');
}

/** Bestiary entry display (enemy rows + `boss:<zone>` / `mid:<zone>` keys). */
function bestiaryEntry(id: string): { name: string; texture: string | null; desc: string } {
  const [kind, zone] = id.split(':') as [string, ZoneId | undefined];
  if ((kind === 'boss' || kind === 'mid') && zone !== undefined) {
    const z = zoneDef(zone);
    const defId = kind === 'boss' ? z.bossId : z.midBossId;
    const name = kind === 'boss' ? z.bossName : z.midBossName;
    try {
      const def = enemyDef(defId);
      return { name, texture: def.texture, desc: def.desc };
    } catch {
      return { name, texture: null, desc: '' };
    }
  }
  try {
    const def = enemyDef(id);
    return { name: def.name, texture: def.texture, desc: def.desc };
  } catch {
    return { name: id, texture: null, desc: '' };
  }
}

export function buildCodexTab(scene: Phaser.Scene, content: Phaser.GameObjects.Container): HubTab {
  const api = hubApi(scene);
  const requested = api.takeSegment();
  // Land on the segment that has something to claim (critic F9): the tab's red
  // dot must lead to the CLAIM button, not to an unrelated list.
  const claimables = (meta: MetaSaveV4): Record<Segment, boolean> => ({
    CONTRACTS: featureUnlocked(meta, 'feature:contracts') && meta.contracts.active.some((c) => c.progress >= c.target),
    BESTIARY: false,
    COLLECTION: false,
    RECORDS: Object.values(meta.achievements).some((s) => s === 'done'),
  });
  const initial = claimables(loadMeta());
  let segment: Segment = (SEGMENTS as readonly string[]).includes(requested ?? '')
    ? (requested as Segment)
    : (SEGMENTS.find((s) => initial[s]) ?? 'CONTRACTS');
  let subset: SubSet = 'ARSENAL';
  // Set on landing / segment entry: bring the first CLAIM row fully into view
  // once, so it never sits clipped under the tab bar (QA 18).
  let revealClaim = true;

  const build = (): void => {
    content.removeAll(true);
    const meta = loadMeta();
    const badges = claimables(meta);
    content.add(
      segmented(
        scene,
        40,
        184 - C,
        640,
        72,
        SEGMENTS,
        SEGMENTS.indexOf(segment),
        (i) => {
          segment = SEGMENTS[i] ?? 'CONTRACTS';
          api.scrollView().scrollTo(0);
          revealClaim = true;
          build();
        },
        SEGMENTS.map((s) => badges[s] && s !== segment),
      ),
    );
    const top = 272 - C;
    let end = top;
    if (segment === 'CONTRACTS') end = buildContracts(scene, content, meta, top, build);
    else if (segment === 'BESTIARY') end = buildBestiary(scene, content, meta, top);
    else if (segment === 'COLLECTION')
      end = buildCollection(scene, content, meta, top, subset, (s) => {
        subset = s;
        build();
      });
    const claimRow = { top: -1, bottom: -1 };
    if (segment === 'RECORDS') end = buildRecords(scene, content, meta, top, build, claimRow);
    api.setContentHeight(end + 24);
    if (revealClaim && claimRow.top >= 0) {
      const view = api.scrollView();
      // Content-local y → keep [top, bottom] inside the band with a 24 px margin.
      const visibleH = view.rect.height - 24;
      if (claimRow.bottom - view.offset > visibleH) view.scrollTo(Math.min(claimRow.top - 24, claimRow.bottom - visibleH));
    }
    revealClaim = false;
  };

  build();
  return { refresh: build, destroy: () => content.removeAll(true) };
}

function buildContracts(scene: Phaser.Scene, content: Phaser.GameObjects.Container, meta: MetaSaveV4, top: number, rebuild: () => void): number {
  const api = hubApi(scene);
  let y = top;
  if (!featureUnlocked(meta, 'feature:contracts')) {
    content.add(label(scene, 360, y + 60, 'Contracts unlock at L2.', { size: 26, bold: true, color: CSS.inkSoft, origin: [0.5, 0] }));
    return y + 140;
  }

  // Weekly card on top — only once the Weekly board is unlocked (L15, §5.20).
  if (featureUnlocked(meta, 'feature:weekly')) {
    const wk = meta.contracts.weekly;
    content.add(panelAt(scene, 40, y, 640, 140, { stroke: PALETTE.secondary, strokeAlpha: 0.9 }));
    content.add(label(scene, 60, y + 16, 'WEEKLY CONTRACT', { size: 20, bold: true, color: CSS.inkSoft }));
    const step = WEEKLY_STEPS[wk.step];
    if (step === undefined) {
      content.add(label(scene, 60, y + 56, 'All 3 steps done this week.', { size: 24, bold: true }));
    } else {
      content.add(label(scene, 60, y + 50, `Step ${wk.step + 1}/3 · ${step.text.replace('{n}', `${step.target}`)}`, { size: 22, bold: true, wrap: 600 }));
      content.add(progressBar(scene, 60, y + 96, 400, 16, wk.progress / step.target, PALETTE.secondary));
      content.add(label(scene, 476, y + 104, `${Math.min(wk.progress, step.target)}/${step.target}`, { size: 20, origin: [0, 0.5] }));
    }
    content.add(label(scene, 660, y + 16, rewardText(WEEKLY_REWARD), { size: 20, bold: true, color: CSS.accent, origin: [1, 0] }));
    y += 156;
  } else {
    content.add(panelAt(scene, 40, y, 640, 72));
    content.add(label(scene, 60, y + 36, 'WEEKLY CONTRACT · unlocks at L15', { size: 20, bold: true, color: CSS.inkSoft, origin: [0, 0.5] }));
    y += 88;
  }

  if (meta.contracts.active.length === 0) {
    content.add(label(scene, 360, y + 40, 'New contracts at dawn', { size: 26, bold: true, color: CSS.inkSoft, origin: [0.5, 0] }));
    return y + 120;
  }
  for (const c of meta.contracts.active) {
    const done = c.progress >= c.target;
    const def = contractDef(c.id);
    content.add(panelAt(scene, 40, y, 640, 140, done ? { stroke: PALETTE.accent, strokeAlpha: 1 } : {}));
    content.add(label(scene, 60, y + 16, contractText(c), { size: 22, bold: true, wrap: 390 }));
    content.add(progressBar(scene, 60, y + 96, 300, 16, c.progress / c.target, done ? PALETTE.accent : PALETTE.primary));
    content.add(label(scene, 372, y + 104, `${Math.min(c.progress, c.target)}/${c.target}`, { size: 20, origin: [0, 0.5] }));
    if (def !== undefined) content.add(label(scene, 60, y + 124, rewardText(def.reward), { size: 16, color: CSS.accent, origin: [0, 0.5] }));
    const id = c.id;
    if (done) {
      content.add(
        new Button(scene, 580, y + 70, 'CLAIM', () => {
          const r = claimContract(id);
          if (!r.ok) actionToast(scene, r.reason ?? 'Cannot claim');
          else {
            sfx('levelup');
            actionToast(scene, `Claimed · ${def !== undefined ? rewardText(def.reward) : ''}`);
            rebuild();
            api.refreshChrome();
          }
        }, { width: 180, height: 88, fontSize: '28px', ...BUTTON_STYLE.primary }),
      );
    } else if (meta.contracts.rerollsLeft > 0) {
      content.add(
        new Button(scene, 580, y + 70, `REROLL (${meta.contracts.rerollsLeft})`, () => {
          const r = rerollContract(id);
          if (!r.ok) actionToast(scene, r.reason ?? 'No rerolls left today');
          else {
            sfx('ui');
            rebuild();
          }
        }, { width: 180, height: 88, fontSize: '20px', ...BUTTON_STYLE.idle }),
      );
    }
    // No rerolls left: no dead button (critic F9); the board footer says when they return.
    y += 152;
  }
  if (meta.contracts.rerollsLeft <= 0) {
    content.add(label(scene, 40, y, 'Rerolls refresh at dawn.', { size: 20, color: CSS.inkSoft }));
    y += 40;
  }
  return y;
}

function buildBestiary(scene: Phaser.Scene, content: Phaser.GameObjects.Container, meta: MetaSaveV4, top: number): number {
  const p = codexProgress(meta, 'bestiary');
  content.add(label(scene, 40, top, `${p.found}/${p.total} discovered`, { size: 22, color: CSS.inkSoft }));
  const y0 = top + 44;
  const gap = (640 - 4 * 150) / 3;
  BESTIARY.forEach((id, i) => {
    const x = 40 + (i % 4) * (150 + gap);
    const y = y0 + Math.floor(i / 4) * 196;
    const kills = meta.codex.kills[id] ?? 0;
    const e = bestiaryEntry(id);
    const tile = tapZone(scene, x, y, 150, 180, () => openBestiaryEntry(scene, id));
    tile.add(panelAt(scene, 0, 0, 150, 150));
    if (e.texture !== null && scene.textures.exists(e.texture)) {
      const img = scene.add.image(75, 75, e.texture, 0);
      img.setScale(120 / Math.max(img.width, img.height));
      // Unseen = silhouette: a FILL tint in deep ink keeps the shape, hides the read.
      if (kills === 0) img.setTint(DEEP_INK).setTintMode(Phaser.TintModes.FILL).setAlpha(0.9);
      tile.add(img);
    }
    tile.add(label(scene, 75, 156, kills > 0 ? e.name : '???', { size: 15, bold: kills > 0, color: kills > 0 ? CSS.ink : CSS.inkSoft, origin: [0.5, 0], align: 'center', wrap: 170 }));
    const tier = killTier(meta, id);
    for (let t = 0; t < tier; t++) {
      const dot = scene.add.circle(14 + t * 16, 14, 6, PALETTE.accent);
      tile.add(dot);
    }
    content.add(tile);
  });
  return y0 + Math.ceil(BESTIARY.length / 4) * 196;
}

function openBestiaryEntry(scene: Phaser.Scene, id: string): void {
  const meta = loadMeta();
  const kills = meta.codex.kills[id] ?? 0;
  const e = bestiaryEntry(id);
  const sheet = openSheet(scene, { height: 760, onClose: () => undefined, title: kills > 0 ? e.name.toUpperCase() : 'UNKNOWN' });
  let y = 110;
  const add = (text: string, size = 22, color: string = CSS.ink, bold = false): void => {
    const t = label(scene, 40, y, text, { size, color, bold, wrap: 640 });
    sheet.content.add(t);
    y += t.height + 14;
  };
  add(`Kills: ${num(kills)}`, 26, CSS.accent, true);
  const tier = killTier(meta, id);
  const names = ['Lore line', 'Lore page', 'Mastery'];
  KILL_TIERS.forEach((t, i) => {
    const reached = tier > i;
    const bonus = t >= 100 ? ` · +${TIER_DAMAGE_PCT}% damage vs ${kills > 0 ? e.name : 'it'}` : '';
    add(`${reached ? '●' : '○'} ${num(t)} kills — ${names[i] ?? ''}${bonus}`, 20, reached ? CSS.ink : CSS.inkSoft, reached);
  });
  y += 10;
  if (tier >= 1 && e.desc !== '') add(e.desc, 22, CSS.ink);
  else add('Kill it 10 times to learn its story.', 20, CSS.inkSoft);
  const bonusTiers = KILL_TIERS.filter((t) => t >= 100 && kills >= t).length;
  if (bonusTiers > 0) add(`+${bonusTiers * TIER_DAMAGE_PCT}% damage vs this enemy`, 24, CSS.primary, true);
}

function buildCollection(
  scene: Phaser.Scene,
  content: Phaser.GameObjects.Container,
  meta: MetaSaveV4,
  top: number,
  subset: SubSet,
  onSubset: (s: SubSet) => void,
): number {
  const setKey: Record<SubSet, string> = { ARSENAL: 'arsenal', ARMORY: 'armory', VALUABLES: 'valuables', LORE: 'lore' };
  SUBSETS.forEach((s, i) => {
    const p =
      s === 'ARSENAL'
        ? {
            found: [...WEAPONS.map((w) => `wpn:${w.id}`), ...WEAPONS.map((w) => `evo:${w.id}`), ...CHARMS.map((c) => `charm:${c.id}`)].filter((k) => meta.codex.seen[k] === true).length,
            total: WEAPONS.length * 2 + CHARMS.length,
          }
        : codexProgress(meta, setKey[s]);
    content.add(chip(scene, 40 + i * 164, top, 152, `${s} ${p.found}/${p.total}`, s === subset, () => onSubset(s), 72));
  });
  let y = top + 96;
  const entries: { icon: string; name: string; seen: boolean; tone: number }[] = [];
  const seen = (key: string): boolean => meta.codex.seen[key] === true;
  if (subset === 'ARSENAL') {
    // Driven by the content tables (20 weapons · 20 evolutions · 21 charms,
    // §5.8b), each gated by its ladder rung. Locked: silhouette + `Unlocks at
    // L<n>`; unlocked but not yet found: silhouette + name; found: full art.
    const level = accountLevel(meta).level;
    const sections: { title: string; items: Entry[] }[] = [
      {
        title: 'WEAPONS',
        items: WEAPONS.map((w) => ({ icon: `icon-wpn-${w.id}`, name: w.name, seen: seen(`wpn:${w.id}`), tone: PALETTE.primary, lockLv: unlockLevelOf(`weapon:${w.id}`) })),
      },
      {
        title: 'EVOLUTIONS',
        items: WEAPONS.map((w) => ({ icon: `icon-evo-${w.id}`, name: w.evolvedName, seen: seen(`evo:${w.id}`), tone: PALETTE.accent, lockLv: unlockLevelOf(`weapon:${w.id}`) })),
      },
      {
        title: 'CHARMS',
        items: CHARMS.map((c) => ({ icon: `icon-charm-${c.id}`, name: c.name, seen: seen(`charm:${c.id}`), tone: PALETTE.secondary, lockLv: unlockLevelOf(`charm:${c.id}`) })),
      },
    ];
    for (const sec of sections) {
      // Ladder order (open entries naturally lead), not table order: the 8
      // Arsenal-20 additions sit at the end of WEAPONS/CHARMS.
      sec.items.sort((a, b) => (a.lockLv ?? 1) - (b.lockLv ?? 1));
      const found = sec.items.filter((e) => e.seen).length;
      content.add(label(scene, 40, y, `${sec.title} ${found}/${sec.items.length}`, { size: 20, bold: true, color: CSS.inkSoft }));
      y += 36;
      y = drawEntries(scene, content, sec.items, y, level) + 12;
    }
    return y;
  } else if (subset === 'ARMORY') {
    for (const b of GEAR_BASES) entries.push({ icon: `icon-gear-${b.id}`, name: b.name, seen: seen(`gear:${b.id}`), tone: PALETTE.inkSoft });
    for (const u of UNIQUES) entries.push({ icon: `icon-uniq-${u.id}`, name: u.name, seen: seen(`uniq:${u.id}`), tone: PALETTE.secondary });
  } else if (subset === 'VALUABLES') {
    for (const v of VALUABLES) entries.push({ icon: `icon-val-${v.id}`, name: v.name, seen: seen(`val:${v.id}`), tone: PALETTE.accent });
  } else {
    const found = meta.codex.lore;
    ZONES.forEach((z) => {
      const n = found.filter((id) => id.includes(z.id)).length;
      content.add(panelAt(scene, 40, y, 640, 72));
      content.add(label(scene, 60, y + 36, z.name, { size: 22, bold: true, origin: [0, 0.5] }));
      content.add(label(scene, 660, y + 36, `${n}/6 stones read`, { size: 20, color: n > 0 ? CSS.accent : CSS.inkSoft, origin: [1, 0.5] }));
      y += 84;
    });
    if (found.length === 0) content.add(label(scene, 40, y + 8, 'Lore stones glow in the dark between gates. Read one to start the chronicle.', { size: 20, color: CSS.inkSoft, wrap: 640 }));
    return y + 80;
  }
  return drawEntries(scene, content, entries, y, Number.POSITIVE_INFINITY);
}

function buildRecords(
  scene: Phaser.Scene,
  content: Phaser.GameObjects.Container,
  meta: MetaSaveV4,
  top: number,
  rebuild: () => void,
  claimRow: { top: number; bottom: number },
): number {
  const api = hubApi(scene);
  let y = top;
  // Account ladder: level, XP bar, next 3 unlocks.
  const lv = accountLevel(meta);
  content.add(panelAt(scene, 40, y, 640, 250));
  content.add(label(scene, 60, y + 20, `HAULER LV ${lv.level}`, { size: 30, bold: true }));
  content.add(progressBar(scene, 60, y + 70, 600, 20, lv.xpNeeded > 0 ? lv.xpInto / lv.xpNeeded : 1, PALETTE.primary));
  content.add(label(scene, 660, y + 20, `${num(lv.xpInto)} / ${num(lv.xpNeeded)} XP`, { size: 20, color: CSS.inkSoft, origin: [1, 0] }));
  const next = ACCOUNT_LADDER.filter((row) => row.level > lv.level).slice(0, 3);
  content.add(label(scene, 60, y + 106, next.length === 0 ? 'Every rung climbed.' : 'NEXT UNLOCKS', { size: 18, bold: true, color: CSS.inkSoft }));
  next.forEach((row, i) => {
    const entries = groupUnlocks(row.unlocks);
    const icons = entries.flatMap((e) => e.icons);
    // Arsenal rungs read `<weapon> + <charm>` with both glyphs; other rungs keep the ladder copy.
    const text = icons.length > 0 ? entries.map((e) => e.text).join('; ') : row.text;
    const { line } = iconLine(scene, 60, y + 132 + i * 34, icons, `L${row.level} · ${text}`, { size: 20, iconSize: 26, width: 600, fit: true });
    content.add(line);
  });
  y += 266;

  // Zone mastery + bests.
  content.add(label(scene, 40, y, 'ZONES', { size: 20, bold: true, color: CSS.inkSoft }));
  y += 36;
  for (const z of ZONES) {
    const stars = masteryStars(meta, z.id);
    const best = Math.max(0, ...Object.entries(meta.stats.bestHaul).filter(([k]) => k.startsWith(`${z.id}:`)).map(([, v]) => v));
    content.add(panelAt(scene, 40, y, 640, 80));
    content.add(label(scene, 60, y + 40, z.name, { size: 22, bold: true, origin: [0, 0.5] }));
    content.add(label(scene, 360, y + 40, `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`, { size: 26, color: CSS.accent, origin: [0, 0.5] }));
    content.add(label(scene, 660, y + 40, `Best ${num(best)} ◆`, { size: 20, color: CSS.ink, origin: [1, 0.5] }));
    y += 92;
  }
  const s = meta.stats;
  content.add(
    label(
      scene,
      40,
      y + 4,
      `Runs ${s.runs} · Extracts ${s.extracts} · Deaths ${s.deaths}\nFastest extract ${s.fastestExtractS > 0 ? clock(s.fastestExtractS) : '—'} · Latest extract ${s.latestExtractS > 0 ? clock(s.latestExtractS) : '—'}`,
      { size: 20, color: CSS.inkSoft, wrap: 640 },
    ),
  );
  y += 80;

  // Achievements.
  const doneCount = Object.keys(meta.achievements).length;
  content.add(label(scene, 40, y, `ACHIEVEMENTS ${doneCount}/${ACHIEVEMENTS.length}`, { size: 20, bold: true, color: CSS.inkSoft }));
  y += 36;
  const order = (id: string): number => (meta.achievements[id] === 'done' ? 0 : meta.achievements[id] === undefined ? 1 : 2);
  const list = [...ACHIEVEMENTS].sort((a, b) => order(a.id) - order(b.id));
  for (const a of list) {
    const state = meta.achievements[a.id];
    content.add(panelAt(scene, 40, y, 640, 104, state === 'done' ? { stroke: PALETTE.accent, strokeAlpha: 1 } : {}));
    content.add(label(scene, 60, y + 14, a.name, { size: 22, bold: true, color: state === undefined ? CSS.inkSoft : CSS.ink }));
    content.add(label(scene, 60, y + 46, a.condition, { size: 18, color: CSS.inkSoft, wrap: 400 }));
    const reward = [a.reward.shards !== undefined ? `${num(a.reward.shards)} ◆` : '', a.reward.sigils !== undefined ? `${a.reward.sigils} ✦` : ''].filter((t) => t !== '').join(' + ');
    if (state === 'done') {
      if (claimRow.top < 0) {
        claimRow.top = y;
        claimRow.bottom = y + 104;
      }
      const id = a.id;
      content.add(
        new Button(scene, 580, y + 52, 'CLAIM', () => {
          const r = claimAchievement(id);
          if (!r.ok) actionToast(scene, r.reason ?? 'Cannot claim');
          else {
            sfx('levelup');
            actionToast(scene, `${a.name} · +${reward}`);
            rebuild();
            api.refreshChrome();
          }
        }, { width: 180, height: 88, fontSize: '26px', ...BUTTON_STYLE.primary }),
      );
    } else {
      content.add(label(scene, 660, y + 52, state === 'claimed' ? `✓ ${reward}` : reward, { size: 18, bold: true, color: state === 'claimed' ? CSS.primary : CSS.inkSoft, origin: [1, 0.5] }));
    }
    y += 114;
  }
  return y;
}
