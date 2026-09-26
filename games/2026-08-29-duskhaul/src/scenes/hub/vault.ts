/**
 * VAULT tab (PRD-V2 §14.6): filter chips, sort, count line, 4-column grid,
 * item sheet (equip / level up / merge / lock / salvage / sell), multi-select
 * with a pinned action bar, bulk actions and §3.4 confirmations. The vault has
 * no capacity cap in V2.
 */
import Phaser from 'phaser';
import { CSS, PALETTE } from '../../config';
import { sfx } from '../../core/audio';
import {
  mergeRefusal,
  affixRerollCost,
  itemLevelCap,
  rerollAffix,
  equipItem,
  featureUnlocked,
  levelCost,
  levelItem,
  loadMeta,
  lockItem,
  mergeCandidates,
  mergeItems,
  salvageItems,
  salvageValue,
  sellItems,
  sellValue,
} from '../../core/progression';
import { MAX_ITEM_LEVEL, gearName } from '../../data/gear';
import { affixLabel } from '../../data/affixes';
import type { GearInstance, GearSlot, LootItem, MetaSaveV4, ValuableInstance } from '../../data/types-v2';
import { valuableDef } from '../../data/valuables';
import { itemRarity, itemValue } from '../../systems/bag';
import { Button } from '../../ui/button';
import { BUTTON_STYLE, DEEP_INK, PANEL, rarityName } from '../../ui/duskChrome';
import { cameraRouter } from '../../ui/scrollView';
import { actionToast, confirmDialog, openSheet } from '../../ui/sheet';
import { chip, itemTile, label, num, panelAt, raritySwatch, tapZone } from '../../ui/widgets';
import { SLOT_LABEL, itemLines } from './format';
import { hubApi, type HubTab } from './hub';

const C = 168;
type Kind = 'gear' | 'valuables';
type Sort = 'rarity' | 'value' | 'new';
const SORT_LABEL: Record<Sort, string> = { rarity: 'RARITY ▾', value: 'VALUE ▾', new: 'NEW ▾' };
const SORT_NEXT: Record<Sort, Sort> = { rarity: 'value', value: 'new', new: 'rarity' };
const SLOTS: readonly (GearSlot | 'all')[] = ['all', 'hood', 'shroud', 'grips', 'boots', 'ring', 'amulet'];

interface Entry {
  loot: LootItem;
  uid: string;
  rarity: number;
  value: number;
  /** Position in the save's list — later = newer (the NEW sort key). */
  order: number;
}

/** Vault state that survives a rebuild within one hub visit. */
interface VaultState {
  kind: Kind;
  slot: GearSlot | 'all';
  sort: Sort;
  selecting: boolean;
  selected: Set<string>;
}

function entries(meta: MetaSaveV4, kind: Kind): Entry[] {
  if (kind === 'gear') {
    return meta.vault.gear.map((item, order) => {
      const loot: LootItem = { kind: 'gear', item };
      return { loot, uid: item.uid, rarity: item.rarity, value: itemValue(loot), order };
    });
  }
  return meta.vault.valuables.map((item, order) => {
    const loot: LootItem = { kind: 'valuable', item };
    return { loot, uid: item.uid, rarity: itemRarity(loot), value: sellValue(item), order };
  });
}

function isEquipped(meta: MetaSaveV4, uid: string): boolean {
  return Object.values(meta.equipped).includes(uid);
}

function lootName(loot: LootItem): string {
  return loot.kind === 'gear' ? gearName(loot.item) : valuableDef(loot.item.id).name;
}

export function buildVaultTab(scene: Phaser.Scene, content: Phaser.GameObjects.Container): HubTab {
  const api = hubApi(scene);
  const state: VaultState = { kind: 'gear', slot: 'all', sort: 'rarity', selecting: false, selected: new Set() };
  const banner = api.takeBanner();

  // Pinned action bar (40,1016,640,96) on its own camera above the list.
  const barRect = { x: 40, y: 1016, width: 640, height: 100 };
  const bar = scene.add.container(0, 0);
  const barCam = scene.cameras.add(barRect.x, barRect.y, barRect.width, barRect.height);
  barCam.setScroll(barRect.x, barRect.y);
  cameraRouter(scene).own(bar, barCam);

  const build = (): void => {
    content.removeAll(true);
    bar.removeAll(true);
    const meta = loadMeta();
    const all = entries(meta, state.kind);
    let y = 184 - C;

    // Row 1: GEAR / VALUABLES, SELECT toggle, sort (40,184).
    content.add(chip(scene, 40, y, 150, 'GEAR', state.kind === 'gear', () => switchKind('gear')));
    content.add(chip(scene, 202, y, 170, 'VALUABLES', state.kind === 'valuables', () => switchKind('valuables')));
    content.add(
      chip(scene, 384, y, 120, state.selecting ? 'DONE' : 'SELECT', state.selecting, () => {
        state.selecting = !state.selecting;
        state.selected.clear();
        build();
      }),
    );
    content.add(
      chip(scene, 516, y, 164, SORT_LABEL[state.sort], false, () => {
        state.sort = SORT_NEXT[state.sort];
        build();
      }),
    );
    y += 76;
    if (state.kind === 'gear') {
      SLOTS.forEach((s, i) => {
        content.add(chip(scene, 40 + i * 92, y, 88, s === 'all' ? 'ALL' : SLOT_LABEL[s], state.slot === s, () => {
          state.slot = s;
          build();
        }, 56));
      });
      y += 68;
    }

    // Count line.
    const vals = meta.vault.valuables;
    const valTotal = vals.reduce((sum, v) => sum + sellValue(v), 0);
    content.add(label(scene, 40, y + 4, `${meta.vault.gear.length + vals.length} items · ${vals.length} valuables (${num(valTotal)} ◆)`, { size: 22, color: CSS.inkSoft }));
    y += 44;
    if (banner !== null) {
      content.add(panelAt(scene, 40, y, 640, 64, { stroke: PALETTE.accent }));
      content.add(label(scene, 60, y + 32, banner, { size: 20, color: CSS.accent, origin: [0, 0.5], wrap: 600 }));
      y += 76;
    }

    const shown = all.filter((e) => state.kind !== 'gear' || state.slot === 'all' || (e.loot.kind === 'gear' && e.loot.item.slot === state.slot));
    shown.sort((a, b) => {
      if (state.sort === 'value') return b.value - a.value;
      if (state.sort === 'new') return b.order - a.order;
      return b.rarity - a.rarity || b.value - a.value;
    });

    if (meta.vault.gear.length + vals.length === 0) {
      content.add(label(scene, 360, y + 80, 'Your vault is empty.', { size: 30, bold: true, origin: [0.5, 0] }));
      content.add(label(scene, 360, y + 130, 'Items you carry out through a gate are stored here.', { size: 22, color: CSS.inkSoft, origin: [0.5, 0], align: 'center', wrap: 560 }));
      content.add(new Button(scene, 360, y + 250, 'GO TO EXPEDITION', () => api.goTab('expedition'), { width: 480, height: 96, fontSize: '30px', ...BUTTON_STYLE.primary }));
      api.setContentHeight(y + 320);
      return;
    }
    if (shown.length === 0) {
      const what = state.kind === 'valuables' ? 'valuables' : state.slot === 'all' ? 'gear' : `${state.slot}s`;
      content.add(label(scene, 360, y + 80, `No ${what} yet.`, { size: 26, bold: true, color: CSS.inkSoft, origin: [0.5, 0] }));
    }

    // Grid: 4 columns 150×180 (tile 150 + caption).
    const gap = (640 - 4 * 150) / 3;
    shown.forEach((e, i) => {
      const x = 40 + (i % 4) * (150 + gap);
      const ty = y + Math.floor(i / 4) * 196;
      const tap = tapZone(scene, x, ty, 150, 180, () => {
        if (state.selecting) {
          if (state.selected.has(e.uid)) state.selected.delete(e.uid);
          else state.selected.add(e.uid);
          build();
        } else openItemSheet(scene, e.loot, build);
      });
      const locked = e.loot.kind === 'gear' && e.loot.item.locked === true;
      tap.add(
        itemTile(scene, 0, 0, 150, e.loot, e.rarity, {
          caption: lootName(e.loot),
          locked,
          equipped: isEquipped(meta, e.uid),
          isNew: api.newItems.includes(e.uid),
          selected: state.selected.has(e.uid),
          badge: e.loot.kind === 'gear' ? `Lv ${e.loot.item.level}` : `${num(e.value)} ◆`,
        }),
      );
      content.add(tap);
    });
    const gridEnd = y + Math.ceil(shown.length / 4) * 196;

    paintBar(meta, all);
    // Leave room so the last row scrolls clear of the pinned bar.
    api.setContentHeight(gridEnd + (bar.length > 0 ? 120 : 20));
  };

  const switchKind = (kind: Kind): void => {
    state.kind = kind;
    state.slot = 'all';
    state.selected.clear();
    build();
  };

  /** Multi-select actions, else bulk actions, in the pinned bar. */
  const paintBar = (meta: MetaSaveV4, all: Entry[]): void => {
    const by = barRect.y + 50;
    const addButton = (x: number, w: number, text: string, style: keyof typeof BUTTON_STYLE, onTap: () => void, enabled = true, refuse?: () => void): void => {
      const b = new Button(scene, x + w / 2, by, text, onTap, { width: w, height: 88, fontSize: '20px', ...BUTTON_STYLE[style] }).setScrollFactor(1, 1, true);
      b.setEnabled(enabled, refuse);
      bar.add(b);
    };
    // The bar is its own opaque surface: capsules floating over the grid read as part of it.
    const surface = (): void => {
      const g = scene.add.graphics();
      g.fillStyle(DEEP_INK, 0.96);
      g.fillRoundedRect(barRect.x - 8, barRect.y, barRect.width + 16, barRect.height, 14);
      g.lineStyle(2, PANEL.stroke, 0.8);
      g.strokeRoundedRect(barRect.x - 8, barRect.y, barRect.width + 16, barRect.height, 14);
      bar.addAt(g, 0);
    };
    if (state.selecting) {
      surface();
      const picked = all.filter((e) => state.selected.has(e.uid));
      if (state.kind === 'gear') {
        const gear = picked.flatMap((e) => (e.loot.kind === 'gear' ? [e.loot.item] : []));
        const dust = gear.reduce((s, g) => s + salvageValue(g), 0);
        const salvageable = gear.filter((g) => g.locked !== true);
        addButton(40, 262, `SALVAGE ${salvageable.length} · ${num(dust)} dust`, 'destructive', () => confirmSalvage(scene, salvageable, meta, done), salvageable.length > 0);
        const allLocked = gear.length > 0 && gear.every((g) => g.locked === true);
        addButton(312, 136, allLocked ? 'UNLOCK' : 'LOCK', 'idle', () => {
          for (const g of gear) lockItem(g.uid, !allLocked);
          sfx('ui');
          done();
        }, gear.length > 0);
        // Refuse BEFORE the confirm, with the real reason (QA 9).
        const refusal = gear.length === 3 ? mergeRefusal(gear.map((g) => g.uid)) : 'Select 3 of the same item and rarity.';
        addButton(458, 222, 'MERGE (3)', 'primary', () => confirmMerge(scene, gear, done), refusal === null, () =>
          actionToast(scene, refusal ?? ''),
        );
      } else {
        const vals = picked.flatMap((e) => (e.loot.kind === 'valuable' ? [e.loot.item] : []));
        const total = vals.reduce((s, v) => s + sellValue(v), 0);
        addButton(40, 640, `SELL (${vals.length}) · ${num(total)} ◆`, 'primary', () => confirmSell(scene, vals, total, done, vals.length === meta.vault.valuables.length), vals.length > 0 && featureUnlocked(meta, 'feature:sell'), () =>
          actionToast(scene, featureUnlocked(meta, 'feature:sell') ? 'Select valuables to sell.' : 'Selling unlocks at L3.'),
        );
      }
      return;
    }
    if (state.kind === 'gear') {
      const tarnished = meta.vault.gear.filter((g) => g.rarity === 1 && g.locked !== true && !isEquipped(meta, g.uid));
      if (tarnished.length >= 3) {
        surface();
        const dust = tarnished.reduce((s, g) => s + salvageValue(g), 0);
        addButton(40, 640, `SALVAGE ALL TARNISHED (${tarnished.length}) · ${num(dust)} dust`, 'idle', () => confirmSalvage(scene, tarnished, meta, done, true));
      }
    } else if (meta.vault.valuables.length > 0 && featureUnlocked(meta, 'feature:sell')) {
      surface();
      const total = meta.vault.valuables.reduce((s, v) => s + sellValue(v), 0);
      addButton(40, 640, `SELL ALL VALUABLES (${meta.vault.valuables.length}) · ${num(total)} ◆`, 'primary', () =>
        confirmSell(scene, [...meta.vault.valuables], total, done, true),
      );
    }
  };

  const done = (): void => {
    state.selected.clear();
    state.selecting = false;
    api.refreshAll();
  };

  build();
  return {
    refresh: build,
    destroy(): void {
      cameraRouter(scene).release(bar);
      bar.destroy();
      scene.cameras.remove(barCam, true);
      content.removeAll(true);
    },
  };
}

/** §3.4: salvage confirms when bulk, when any item is equipped, or when any is ≥ Gilded. */
function confirmSalvage(scene: Phaser.Scene, items: GearInstance[], meta: MetaSaveV4, onDone: () => void, bulk = false): void {
  const dust = items.reduce((s, g) => s + salvageValue(g), 0);
  const run = (): void => {
    const r = salvageItems(items.map((g) => g.uid));
    if (!r.ok) {
      actionToast(scene, r.reason ?? 'Cannot salvage');
      return;
    }
    sfx('pickup');
    actionToast(scene, `Salvaged ${items.length} · +${num(dust)} dust`);
    onDone();
  };
  const equipped = items.filter((g) => isEquipped(meta, g.uid));
  const precious = items.some((g) => g.rarity >= 4);
  if (!bulk && items.length === 1 && equipped.length === 0 && !precious) {
    run();
    return;
  }
  const first = items[0];
  const body =
    items.length === 1 && first !== undefined
      ? `${equipped.length > 0 ? 'Unequip and salvage' : 'Salvage'} ${gearName(first)} (${rarityName(first.rarity)}) for ${num(dust)} dust?`
      : `Salvage ${items.length} items for ${num(dust)} dust?${equipped.length > 0 ? ` ${equipped.length} equipped item(s) will be unequipped.` : ''}`;
  confirmDialog(scene, { title: 'Salvage?', body, confirmLabel: 'SALVAGE', destructive: true, onConfirm: run });
}

function confirmSell(scene: Phaser.Scene, vals: ValuableInstance[], total: number, onDone: () => void, all: boolean): void {
  const run = (): void => {
    const r = sellItems(vals.map((v) => v.uid));
    if (!r.ok) {
      actionToast(scene, r.reason ?? 'Cannot sell');
      return;
    }
    sfx('pickup');
    actionToast(scene, `Sold ${vals.length} · +${num(total)} ◆`);
    onDone();
  };
  if (vals.length === 1) {
    run();
    return;
  }
  confirmDialog(scene, { title: all ? 'Sell all?' : `Sell ${vals.length}?`, body: `Sell ${vals.length} valuables for ${num(total)} ◆?`, confirmLabel: 'SELL', onConfirm: run });
}

/** MERGE confirm shows the result rarity (§14b added confirm). Refused merges toast their reason and never confirm. */
function confirmMerge(scene: Phaser.Scene, items: GearInstance[], onDone: () => void): void {
  const first = items[0];
  if (first === undefined || items.length !== 3) return;
  const refusal = mergeRefusal(items.map((g) => g.uid));
  if (refusal !== null) {
    actionToast(scene, refusal);
    return;
  }
  const next = Math.min(6, first.rarity + 1);
  confirmDialog(scene, {
    title: 'Merge?',
    body: `3 × ${gearName(first)} (${rarityName(first.rarity)}) become 1 ${rarityName(next)} ${gearName(first)} at item level ${Math.max(...items.map((g) => g.level))}.`,
    confirmLabel: 'MERGE',
    onConfirm: () => {
      const r = mergeItems([items[0]?.uid ?? '', items[1]?.uid ?? '', items[2]?.uid ?? '']);
      if (!r.ok) {
        actionToast(scene, r.reason ?? 'Cannot merge');
        return;
      }
      sfx('levelup');
      actionToast(scene, `Merged into ${rarityName(next)} ${gearName(first)}`);
      onDone();
    },
  });
}

/** Item sheet (§14.6). */
function openItemSheet(scene: Phaser.Scene, loot: LootItem, onChanged: () => void): void {
  // 980 tall: three button rows (equip/level, merge/lock/salvage, reroll affix).
  const SHEET_H = 980;
  const sheet = openSheet(scene, { height: SHEET_H, onClose: () => undefined });
  const paint = (): void => {
    sheet.content.removeAll(true);
    const meta = loadMeta();
    const fresh: LootItem | null =
      loot.kind === 'gear'
        ? (() => {
            const g = meta.vault.gear.find((x) => x.uid === loot.item.uid);
            return g === undefined ? null : { kind: 'gear', item: g };
          })()
        : meta.vault.valuables.some((v) => v.uid === loot.item.uid)
          ? loot
          : null;
    if (fresh === null) {
      sheet.close();
      return;
    }
    const rarity = itemRarity(fresh);
    sheet.content.add(itemTile(scene, 40, 40, 128, fresh, rarity));
    sheet.content.add(label(scene, 192, 44, lootName(fresh), { size: 32, bold: true, wrap: 420 }));
    sheet.content.add(raritySwatch(scene, 204, 110, rarity, 20));
    sheet.content.add(label(scene, 222, 110, `${rarityName(rarity).toUpperCase()} · Rarity ${rarity} of 6`, { size: 22, color: CSS.ink, origin: [0, 0.5] }));
    let y = 196;
    const line = (text: string, size = 22, color: string = CSS.ink): void => {
      const t = label(scene, 40, y, text, { size, color, wrap: 640 });
      sheet.content.add(t);
      y += t.height + 10;
    };

    if (fresh.kind === 'gear') {
      const g = fresh.item;
      line(`${SLOT_LABEL[g.slot]} · Item level ${g.level}`, 22, CSS.inkSoft);
      for (const text of itemLines(g)) line(text, 24);
      line(`Salvage: ${num(salvageValue(g))} dust · Value ${num(itemValue(fresh))} ◆`, 20, CSS.inkSoft);
      const equipped = isEquipped(meta, g.uid);
      const cost = levelCost(g);
      const capped = cost === null && g.level < MAX_ITEM_LEVEL;
      const capCopy = `Max Lv ${itemLevelCap(meta)} · extract at higher hazards to raise it`;
      if (capped) line(capCopy, 20, CSS.warn);
      const candidates = mergeCandidates(g.uid);
      const trio = [g.uid, ...candidates.slice(0, 2)];
      const mergeBlock = candidates.length < 2 ? (featureUnlocked(meta, 'feature:merge') ? 'Needs 2 more of the same item and rarity.' : 'Merge unlocks at L4.') : mergeRefusal(trio);
      const row1 = SHEET_H - 340;
      const eq = new Button(scene, 40 + 156, row1, equipped ? 'EQUIPPED' : 'EQUIP', () => {
        const r = equipItem(g.slot, g.uid);
        if (!r.ok) actionToast(scene, r.reason ?? 'Cannot equip');
        else {
          sfx('pickup');
          onChanged();
          paint();
        }
      }, { width: 312, height: 88, fontSize: '28px', ...BUTTON_STYLE.primary });
      eq.setEnabled(!equipped && featureUnlocked(meta, `slot:${g.slot}`), () => actionToast(scene, equipped ? 'Already equipped.' : `The ${g.slot} slot is locked.`));
      const lv = new Button(scene, 368 + 156, row1, cost === null ? (capped ? `MAX LV ${g.level}` : 'MAX LEVEL') : `LEVEL UP · ${num(cost.shards)} ◆ ${cost.dust} dust`, () => {
        // LEVEL UP never confirms (§14b).
        const r = levelItem(g.uid);
        if (!r.ok) actionToast(scene, r.reason ?? 'Cannot level up');
        else {
          sfx('levelup');
          hubApi(scene).refreshChrome();
          onChanged();
          paint();
        }
      }, { width: 312, height: 88, fontSize: '20px', ...BUTTON_STYLE.idle });
      lv.setEnabled(cost !== null && meta.dust >= cost.dust && meta.currency >= cost.shards, () =>
        actionToast(scene, cost === null ? (capped ? capCopy : 'Max item level.') : 'Not enough dust or ◆.'),
      );
      const row2 = row1 + 104;
      const merge = new Button(scene, 40 + 100, row2, 'MERGE', () => {
        const picks = [g, ...candidates.slice(0, 2).map((uid) => meta.vault.gear.find((x) => x.uid === uid))].filter((x): x is GearInstance => x !== undefined);
        confirmMerge(scene, picks, () => {
          sheet.close();
          onChanged();
        });
      }, { width: 200, height: 88, fontSize: '24px', ...BUTTON_STYLE.idle });
      merge.setEnabled(mergeBlock === null, () => actionToast(scene, mergeBlock ?? ''));
      const lock = new Button(scene, 256 + 100, row2, g.locked === true ? 'UNLOCK' : 'LOCK', () => {
        lockItem(g.uid, g.locked !== true);
        onChanged();
        paint();
      }, { width: 200, height: 88, fontSize: '24px', ...BUTTON_STYLE.idle });
      const salv = new Button(scene, 472 + 104, row2, `SALVAGE · ${num(salvageValue(g))} dust`, () => {
        confirmSalvage(scene, [g], meta, () => {
          sheet.close();
          onChanged();
        });
      }, { width: 208, height: 88, fontSize: '18px', ...BUTTON_STYLE.destructive });
      salv.setEnabled(g.locked !== true, () => actionToast(scene, 'Unlock it first.'));
      sheet.content.add([eq, lv, merge, lock, salv]);
      // REROLL AFFIX (endless ◆ sink; price escalates per reroll of this item).
      const rr = affixRerollCost(g);
      if (rr !== null) {
        const reroll = new Button(scene, 360, row2 + 104, `REROLL AFFIX · ${num(rr.shards)} ◆ ${rr.dust} dust`, () =>
          openAffixPicker(scene, g, () => {
            hubApi(scene).refreshChrome();
            onChanged();
            paint();
          }),
        { width: 640, height: 88, fontSize: '22px', ...BUTTON_STYLE.idle });
        if (g.locked === true) reroll.setEnabled(false, () => actionToast(scene, 'Unlock the item first'));
        else if (meta.currency < rr.shards || meta.dust < rr.dust) reroll.setEnabled(false, () => actionToast(scene, 'Not enough ◆ or dust.'));
        sheet.content.add(reroll);
      }
    } else {
      const v = fresh.item;
      const def = valuableDef(v.id);
      line(`Valuable · ${def.cells} cell${def.cells > 1 ? 's' : ''}`, 22, CSS.inkSoft);
      line(def.flavor, 22, CSS.inkSoft);
      line(`Sells for ${num(sellValue(v))} ◆`, 26, CSS.accent);
      const sellOpen = featureUnlocked(meta, 'feature:sell');
      const sell = new Button(scene, 360, SHEET_H - 160, `SELL · ${num(sellValue(v))} ◆`, () =>
        confirmSell(scene, [v], sellValue(v), () => {
          hubApi(scene).refreshChrome();
          sheet.close();
          onChanged();
        }, false),
      { width: 640, height: 96, fontSize: '30px', ...BUTTON_STYLE.primary });
      sell.setEnabled(sellOpen, () => actionToast(scene, 'Selling unlocks at L3.'));
      sheet.content.add(sell);
    }
  };
  paint();
}

/** Pick which affix line to reroll; one tap rerolls it (the price is on the Vault button). */
function openAffixPicker(scene: Phaser.Scene, item: GearInstance, onDone: () => void): void {
  const sheet = openSheet(scene, { height: 200 + item.affixes.length * 104, onClose: () => undefined, title: 'REROLL WHICH AFFIX?' });
  item.affixes.forEach((a, i) => {
    sheet.content.add(
      new Button(scene, 360, 150 + i * 104, affixLabel(a), () => {
        const r = rerollAffix(item.uid, i);
        if (!r.ok) {
          actionToast(scene, r.reason ?? 'Cannot reroll');
          return;
        }
        sfx('levelup');
        const fresh = r.meta.vault.gear.find((g) => g.uid === item.uid);
        const next = fresh?.affixes[i];
        sheet.close();
        if (next !== undefined) actionToast(scene, `${affixLabel(a)} → ${affixLabel(next)}`);
        onDone();
      }, { width: 640, height: 88, fontSize: '24px', ...BUTTON_STYLE.idle }),
    );
  });
}
