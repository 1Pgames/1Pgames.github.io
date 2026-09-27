import type Phaser from 'phaser';
import { CSS, PALETTE } from '../../config';
import { sfx } from '../../core/audio';
import { load, save } from '../../core/storage';
import { BUILD_SHEET, buildingDef, type BuildingDef, type BuildingId } from '../../slices/colony/content';
import type { ColonyUiHost } from '../../slices/colony/contracts';
import { openSheet, type OverlayHandle } from '../sheet';
import { chip, label, tapZone } from '../widgets';
import { claimSheet, releaseSheet } from './bridge';
import { CHROME, costLabel, icon, missingLabel, paintPlacard } from './theme';

/**
 * Build sheet (§14 BuildSheet; interface-direction: spans y 540-1060, nothing
 * interactive below 1060): category chips + a scissor-clipped 3-column grid of
 * 196 × 180 cards. Picking a card arms it (the dock docks it) and closes the
 * sheet; locked cards read "Sol N", dim, and shake without arming. The first
 * ever opening holds the clock and carries one teaching line (§14 overlays:
 * "first opening pauses for its coach beat").
 */
const SHEET_TOP = 540;
const BAND_BOTTOM = 1060;
/** 3 rows of 104 + 2 gaps of 4 = 320 px fit the 328 px band, so ALL never clips its third row. */
const CARD = { w: 196, h: 104, gap: 26, rowGap: 4 } as const;
const CATS: ReadonlyArray<{ label: string; cats: ReadonlyArray<BuildingDef['category']> | null; ids?: readonly BuildingId[] }> = [
  { label: 'ALL', cats: null },
  { label: 'MINE', cats: ['extract'] },
  { label: 'POWER', cats: ['power'] },
  { label: 'MAKE', cats: ['process'] },
  { label: 'GRID', cats: ['logistics'] },
  { label: 'HOME', cats: ['housing'] },
  { label: 'DEF', cats: ['defense'] },
  /** The win condition's own tab (critic final #3): Spire + Foundry never hide below the fold. */
  { label: 'ARK', cats: ['beacon'], ids: ['beacon_spire', 'lumen_foundry'] },
];
/** Once unlocked, the win-condition buildings lead the ALL tab. */
const WIN_FIRST: readonly BuildingId[] = ['beacon_spire', 'lumen_foundry'];
const FIRST_KEY = 'tut:sheet-build';

export function openBuildSheet(host: ColonyUiHost): OverlayHandle {
  const scene = host.scene;
  const first = !load<boolean>(FIRST_KEY, false);
  if (first) host.holdClock(true);
  const sheet = openSheet(scene, {
    height: 1280 - SHEET_TOP,
    title: 'BUILD',
    onClose: () => {
      timer?.remove();
      teachTimer?.remove();
      if (first) {
        host.holdClock(false);
        save(FIRST_KEY, true);
      }
      releaseSheet(scene, sheet);
    },
  });
  claimSheet(host, 'build', sheet);
  // One layout for every opening (the chips never move): the teaching line is always there, accent on the first opening.
  const TEACH = 'Pick one — it joins the dock and stays armed.';
  const teachColor = first ? CSS.accent : CSS.inkSoft;
  const teach = label(scene, 40, 78, TEACH, { size: 22, color: teachColor, wrap: 560 });
  sheet.content.add(teach);
  let teachTimer: Phaser.Time.TimerEvent | null = null;
  /** A refused card answers on the sheet's own line (the strip is under the sheet): what is missing, for 1.6 s. */
  const refuse = (text: string): void => {
    teach.setText(text).setColor(CSS.bad);
    teachTimer?.remove();
    teachTimer = scene.time.delayedCall(1600, () => {
      if (!sheet.closed) teach.setText(TEACH).setColor(teachColor);
    });
  };

  const chipsY = 116;
  const bandTop = SHEET_TOP + chipsY + 76;
  const list = sheet.scroll({ x: 40, y: bandTop, width: 640, height: BAND_BOTTOM - bandTop });
  let active = 0;
  const chipRow: Phaser.GameObjects.Container[] = [];

  const buildChips = (): void => {
    for (const c of chipRow) c.destroy();
    chipRow.length = 0;
    CATS.forEach((cat, i) => {
      const c = chip(scene, 40 + i * 80, chipsY, 78, cat.label, i === active, () => {
        active = i;
        buildChips();
        buildCards();
      });
      chipRow.push(c);
      sheet.content.add(c);
    });
  };

  const buildCards = (): void => {
    list.clear();
    const model = host.model;
    const cats = CATS[active]?.cats ?? null;
    let i = 0;
    const cat = CATS[active];
    const order: BuildingId[] = [];
    if (cat?.ids !== undefined) order.push(...cat.ids);
    else {
      if (cats === null) for (const id of WIN_FIRST) if (buildingDef(id).unlockSol <= model.clock.sol) order.push(id);
      for (const id of BUILD_SHEET) if (!order.includes(id) && (cats === null || cats.includes(buildingDef(id).category))) order.push(id);
    }
    for (const id of order) {
      const d = buildingDef(id);
      const x = (i % 3) * (CARD.w + CARD.gap);
      const y = Math.floor(i / 3) * (CARD.h + CARD.rowGap);
      i += 1;
      const locked = d.unlockSol > model.clock.sol;
      const cost = model.costOf(id);
      const afford = model.canAfford(cost);
      const zone = tapZone(scene, x, y, CARD.w, CARD.h, () => {
        if (locked || !afford) {
          scene.tweens.killTweensOf(zone);
          zone.setX(x);
          scene.tweens.add({ targets: zone, x: { from: x - 10, to: x }, duration: 260, ease: 'Elastic.easeOut' });
          sfx('deny', { volume: 0.5 });
          if (locked) refuse(`${d.name} unlocks on sol ${d.unlockSol}`);
          else {
            host.want(id);
            refuse(`${missingLabel(model.costOf(id), model.stock) ?? 'Not enough stock'} for ${d.name} — saving for it`);
          }
          return;
        }
        sheet.close();
        host.arm(id);
      });
      const bg = scene.add.graphics({ x: CARD.w / 2, y: CARD.h / 2 });
      paintPlacard(bg, CARD.w, CARD.h, host.armed === id ? PALETTE.primary : PALETTE.bgDeep);
      const img = icon(scene, d.iconKey, 48);
      const name = label(scene, CARD.w / 2, 66, d.name, { size: 22, bold: true, origin: [0.5, 0.5], align: 'center' });
      if (name.width > CARD.w - 16) name.setScale((CARD.w - 16) / name.width);
      const sub = label(scene, CARD.w / 2, 92, locked ? `Sol ${d.unlockSol}` : costLabel(cost), {
        size: 22,
        color: locked ? CSS.inkSoft : afford ? CSS.ink : CSS.bad,
        origin: [0.5, 0.5],
      });
      if (sub.width > CARD.w - 16) sub.setScale((CARD.w - 16) / sub.width);
      // Dim the body, not the zone: the zone's press dip would restore alpha 1 on release.
      const body = scene.add.container(0, 0, img === null ? [bg, name, sub] : [bg, img.setPosition(CARD.w / 2, 28), name, sub]);
      if (locked || !afford) body.setAlpha(CHROME.disabledAlpha);
      zone.add(body);
      list.add(zone);
    }
    list.setContentHeight(Math.ceil(i / 3) * (CARD.h + CARD.rowGap));
    lastSig = affordSig();
  };

  /** Bitmask of the cards currently affordable + unlocked (primitive diff, no allocation). */
  const affordSig = (): number => {
    const model = host.model;
    let sig = model.clock.sol * 2 ** 21;
    BUILD_SHEET.forEach((id, bit) => {
      if (buildingDef(id).unlockSol <= model.clock.sol && model.canAfford(model.costOf(id))) sig += 2 ** bit;
    });
    return sig;
  };
  let lastSig = -1;
  // Affordability stays live while the sheet is open (≤ 4 Hz), keeping the scroll position.
  const timer = scene.time.addEvent({
    delay: 250,
    loop: true,
    callback: () => {
      if (sheet.closed || affordSig() === lastSig) return;
      const at = list.offset;
      buildCards();
      list.scrollTo(at);
    },
  });

  buildChips();
  buildCards();
  return sheet;
}
