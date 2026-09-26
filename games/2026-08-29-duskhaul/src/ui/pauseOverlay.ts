import Phaser from 'phaser';
import { CSS, PALETTE, TEXT, VIEW, bareText } from '../config';
import type { BagView, HazardLevel, WeaponsView } from '../data/types-v2';
import { BagPanel, bagPanelHeight } from './bagStrip';
import { Button } from './button';
import { BUTTON_STYLE, IDENTITY, PANEL, drawDuskPanel } from './duskChrome';
import { charmIconId, iconFor, weaponIconId } from './itemIcon';
import { drawPanel } from './primitives';
import { CHARMS } from '../data/charms';
import { confirmDialog } from './sheet';
import { openSettingsSheet } from './settingsSheet';
import { suspendToasts } from './toast';

type Closable = ReturnType<typeof confirmDialog>;

/**
 * PRD-V2 §14.15 pause (FlowAudit §2.11): header `PAUSED` + `Bleakspire Keep ·
 * H2 · 3:42 · LV 9`; build panel (4 weapon + 4 charm icons 72 px with rank
 * pips); gate timetable; bag panel (the quick-sheet grid, pin/drop live);
 * `RESUME` 640×96 at y 900; `SETTINGS` 312×88 at (40, 1010); `ABANDON RUN`
 * 312×88 at (368, 1010), destructive, confirmed when carrying ≥ 1 item or
 * ≥ 50 ◆. RESTART is gone. ESC is the slice's key: it calls `back()` first so
 * ESC on the confirm backs out to pause instead of closing both layers.
 */

export interface PauseModel {
  zone: string;
  hazard: HazardLevel;
  elapsedS: number;
  level: number;
  weapons: WeaponsView;
  gates: string[];
  bag: BagView;
  carrying: { items: number; shards: number };
}

export interface PauseActions {
  resume(): void;
  abandon(): void;
  pin(uid: string): void;
  drop(uid: string): void;
}

export interface PauseOverlayHandle {
  /** Repaint after a pin/drop (bag + carrying) — the slice passes the fresh model. */
  refresh(model: PauseModel): void;
  /**
   * ESC/back, one layer at a time: closes the ABANDON confirm or the Settings
   * sheet and returns true when one is open; returns false when the pause itself is the top layer (the
   * slice then resumes). The slice owns the ESC/P key and must ask this first.
   */
  back(): boolean;
  destroy(): void;
}

const HEADER_Y = 176;
const SUB_Y = 234;
const BUILD = { top: 266, height: 196, labelX: 64, iconX0: 208, pitch: 96, rows: [316, 406], icon: 72 } as const;
const GATES_Y = 486;
const BAG = { top: 526, maxHeight: 364 } as const;
const RESUME = { top: 900, width: 640, height: 96 } as const;
const SMALL = { top: 1010, width: 312, height: 88, leftX: 40, rightX: 368 } as const;
/** §14.15 confirm threshold. */
const CONFIRM = { items: 1, shards: 50 } as const;

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** §16.1 E44. */
export function showPauseOverlay(scene: Phaser.Scene, model: PauseModel, actions: PauseActions): PauseOverlayHandle {
  const root = scene.add.container(0, 0).setDepth(2100).setScrollFactor(0);
  suspendToasts(scene, true);
  let current = model;
  let resolved = false;
  /** The one layer above the pause (ABANDON confirm or Settings sheet); ESC/back closes it first. */
  let confirm: Closable | null = null;

  const dim = scene.add
    .rectangle(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height, 0x000000, 0.8)
    .setScrollFactor(0)
    .setInteractive();
  root.add(dim);
  root.add(
    scene.add
      .text(VIEW.centerX, HEADER_Y, 'PAUSED', { ...TEXT.heading, fontSize: '60px' })
      .setOrigin(0.5)
      .setScrollFactor(0),
  );
  const sub = scene.add
    .text(VIEW.centerX, SUB_Y, '', { ...TEXT.label, fontSize: '24px', color: CSS.inkSoft })
    .setOrigin(0.5)
    .setScrollFactor(0);
  root.add(sub);

  // Build panel.
  const build = scene.add.container(0, 0).setScrollFactor(0);
  root.add(build);
  const gatesText = scene.add
    .text(VIEW.centerX, GATES_Y, '', {
      ...TEXT.label,
      fontSize: '20px',
      color: CSS.ink,
      align: 'center',
      wordWrap: { width: 640 },
    })
    .setOrigin(0.5)
    .setScrollFactor(0);
  root.add(gatesText);

  // Bag panel (shared grid with the quick-sheet).
  const bagRoot = scene.add.container(40, BAG.top).setScrollFactor(0);
  root.add(bagRoot);
  // Bags past 3 rows (m_bag / a_bag) scale down to keep RESUME at its authored y.
  const bagH = bagPanelHeight(model.bag);
  bagRoot.add(drawDuskPanel(scene, 640, bagH).setPosition(320, bagH / 2));
  bagRoot.setScale(Math.min(1, BAG.maxHeight / bagH));
  const bag = new BagPanel(scene, bagRoot, model.bag, {
    pin: (uid) => actions.pin(uid),
    drop: (uid) => actions.drop(uid),
  });

  const resume = (): void => {
    if (resolved || confirm !== null) return;
    resolved = true;
    actions.resume();
  };
  root.add(
    new Button(scene, VIEW.centerX, RESUME.top + RESUME.height / 2, 'RESUME', resume, {
      width: RESUME.width,
      height: RESUME.height,
      ...BUTTON_STYLE.primary,
    }),
  );
  root.add(
    new Button(scene, SMALL.leftX + SMALL.width / 2, SMALL.top + SMALL.height / 2, 'SETTINGS', () => {
      if (resolved || confirm !== null) return;
      // The real Settings sheet, over the pause (user report: the button did
      // nothing — it only queued a toast the pause itself hides). RESET SAVE is
      // hub-only, so no `onReset` here.
      const sheet = openSettingsSheet(scene, {
        onClose: () => {
          if (confirm === sheet) confirm = null;
        },
      });
      confirm = sheet;
    }, { width: SMALL.width, height: SMALL.height, fontSize: '30px', ...BUTTON_STYLE.idle }),
  );
  root.add(
    new Button(scene, SMALL.rightX + SMALL.width / 2, SMALL.top + SMALL.height / 2, 'ABANDON RUN', () => {
      if (resolved || confirm !== null) return;
      const { items, shards } = current.carrying;
      if (items < CONFIRM.items && shards < CONFIRM.shards) {
        resolved = true;
        actions.abandon();
        return;
      }
      confirm = confirmDialog(scene, {
        title: 'ABANDON RUN?',
        body: `You carry ${items} item${items === 1 ? '' : 's'} and ${Math.floor(shards)} ◆. Only your casket is kept.`,
        confirmLabel: 'ABANDON',
        cancelLabel: 'KEEP GOING',
        destructive: true,
        onConfirm: () => {
          confirm = null;
          resolved = true;
          actions.abandon();
        },
        onCancel: () => {
          confirm = null;
        },
      });
    }, { width: SMALL.width, height: SMALL.height, fontSize: '28px', ...BUTTON_STYLE.destructive }),
  );

  const paint = (m: PauseModel): void => {
    sub.setText(`${m.zone} · H${m.hazard} · ${clock(m.elapsedS)} · LV ${m.level}`);
    gatesText.setText(m.gates.join(' · '));
    paintBuild(scene, build, m.weapons);
  };
  paint(model);

  let tornDown = false;
  const teardown = (): void => {
    if (tornDown) return;
    tornDown = true;
    suspendToasts(scene, false);
    confirm?.close();
    confirm = null;
    root.destroy(true);
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown);

  return {
    refresh(next: PauseModel): void {
      if (resolved) return;
      current = next;
      paint(next);
      bag.refresh(next.bag);
    },
    back(): boolean {
      if (confirm === null) return false;
      confirm.close();
      confirm = null;
      return true;
    },
    destroy(): void {
      resolved = true;
      scene.events.off(Phaser.Scenes.Events.SHUTDOWN, teardown);
      teardown();
    },
  };
}

/** 4 weapon + 4 charm slots, 72 px icons, rank pips under each (evolved = gilt ring). */
function paintBuild(scene: Phaser.Scene, build: Phaser.GameObjects.Container, view: WeaponsView): void {
  build.removeAll(true);
  const panel = drawDuskPanel(scene, 640, BUILD.height).setPosition(VIEW.centerX, BUILD.top + BUILD.height / 2);
  build.add(panel);
  const rows: { label: string; max: number; rankMax: number; slots: { icon: string; rank: number; evolved: boolean }[] }[] = [
    {
      label: 'WEAPONS',
      max: view.maxWeapons,
      rankMax: view.maxRank,
      slots: view.weapons.map((w) => ({ icon: weaponIconId(w.id, w.evolved), rank: w.rank, evolved: w.evolved })),
    },
    {
      label: 'CHARMS',
      max: view.maxCharms,
      rankMax: view.maxCharmRank,
      slots: view.charms.map((c) => ({ icon: charmIconId(c.id), rank: c.rank, evolved: false })),
    },
  ];
  // Evolution pairs (user request): a violet link from each owned weapon to its
  // owned partner charm; a gilt ring on a weapon whose evolution is ready now.
  const links = scene.add.graphics();
  build.add(links);
  view.weapons.forEach((w, wi) => {
    const wx = BUILD.iconX0 + wi * BUILD.pitch;
    const wy = (BUILD.rows[0] ?? 316) - 6;
    if (view.evolutionEligible.includes(w.id)) {
      links.lineStyle(3, IDENTITY.gilt, 1).strokeRoundedRect(wx - BUILD.icon / 2 - 8, wy - BUILD.icon / 2 - 8, BUILD.icon + 16, BUILD.icon + 16, 14);
    }
    if (w.evolved) return;
    view.charms.forEach((c, ci) => {
      if (CHARMS.find((d) => d.id === c.id)?.evolves !== w.id) return;
      const cx = BUILD.iconX0 + ci * BUILD.pitch;
      const cy = (BUILD.rows[1] ?? 406) - 6;
      links.lineStyle(4, IDENTITY.gateOpen, 0.95).lineBetween(wx, wy + BUILD.icon / 2 - 10, cx, cy - BUILD.icon / 2 + 10);
      links.fillStyle(IDENTITY.gateOpen, 1).fillCircle(wx, wy + BUILD.icon / 2 - 10, 5).fillCircle(cx, cy - BUILD.icon / 2 + 10, 5);
    });
  });
  rows.forEach((row, r) => {
    const y = BUILD.rows[r] ?? BUILD.rows[0];
    build.add(
      scene.add
        .text(BUILD.labelX, y, `${row.label}\n${row.slots.length}/${row.max}`, {
          ...TEXT.label,
          fontSize: '18px',
          color: CSS.inkSoft,
          ...bareText(),
        })
        .setOrigin(0, 0.5),
    );
    for (let i = 0; i < Math.max(row.max, 4); i += 1) {
      const x = BUILD.iconX0 + i * BUILD.pitch;
      const slot = row.slots[i];
      const tile = drawPanel(scene, BUILD.icon + 8, BUILD.icon + 8, {
        fill: PANEL.fill,
        fillAlpha: slot ? 0.95 : 0.4,
        stroke: slot?.evolved ? IDENTITY.gilt : PANEL.stroke,
        strokeAlpha: slot ? 0.9 : 0.4,
        strokeWidth: slot?.evolved ? 3 : 2,
        radius: 12,
      }).setPosition(x, y - 6);
      build.add(tile);
      if (slot === undefined) continue;
      build.add(iconFor(scene, slot.icon, BUILD.icon - 8, r === 0 ? PALETTE.primary : PALETTE.secondary).setPosition(x, y - 6));
      const pips = scene.add.graphics();
      const pitch = 12;
      const x0 = x - ((row.rankMax - 1) * pitch) / 2;
      for (let p = 0; p < row.rankMax; p += 1) {
        if (p < slot.rank) pips.fillStyle(PALETTE.accent, 1).fillCircle(x0 + p * pitch, y + 38, 4);
        else pips.lineStyle(1.5, IDENTITY.cooled, 1).strokeCircle(x0 + p * pitch, y + 38, 4);
      }
      build.add(pips);
    }
  });
  build.bringToTop(links);
}
