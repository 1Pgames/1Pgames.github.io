/**
 * SANCTUM tab (PRD-V2 §14.7 / FlowAudit §2.8): BODY / GREED / ESCAPE branch
 * segments, the root node pinned on top, rows grouped by tier with lock
 * headers, one-tap purchase (price on the button) + 3 s UNDO toast (full
 * refund). No confirm (§3.4).
 */
import Phaser from 'phaser';
import { CSS, PALETTE } from '../../config';
import { sfx } from '../../core/audio';
import { ARMSMASTER_ID, ascensionCost, ascensionOpen, ascensionRank, branchSpent, buyAscension, buyNode, loadMeta, nodeUnlocked, undoLastNode } from '../../core/progression';
import { classDef } from '../../data/classes';
import { ROW_SPEND, SANCTUM, nodeCost, type SanctumBranch, type SanctumNodeDef } from '../../data/sanctum';
import type { MetaSaveV4 } from '../../data/types-v2';
import { Button } from '../../ui/button';
import { BUTTON_STYLE, DISABLED_ALPHA } from '../../ui/duskChrome';
import { iconFor } from '../../ui/itemIcon';
import { actionToast } from '../../ui/sheet';
import { label, num, panelAt, pips, segmented } from '../../ui/widgets';
import { hubApi, type HubTab } from './hub';

const C = 168;
const BRANCHES: readonly SanctumBranch[] = ['BODY', 'GREED', 'ESCAPE'];
const ROW_H = 150;

/** §11 v3 branch icons (ArtIcons3); `iconFor` falls back to a tinted glyph until the registry has them. */
function branchIcon(b: SanctumBranch): string {
  return `icon-branch-${b.toLowerCase()}`;
}
const BRANCH_TONE: Record<SanctumBranch, number> = {
  ROOT: PALETTE.ink,
  BODY: PALETTE.good,
  GREED: PALETTE.accent,
  ESCAPE: PALETTE.secondary,
};

/**
 * Next-level preview from the node's effect-first title (`Max Health +10` is
 * the per-level step): `+20 → +30`. Titles without a per-level number
 * (behaviours, keystones) preview the level instead.
 */
function preview(node: SanctumNodeDef, level: number): string {
  if (level >= node.max) return 'MAXED';
  const m = /([+−-])(\d+(?:\.\d+)?)\s*(%|ms|\/s)?/.exec(node.title);
  if (m === null || node.max === 1) return `Lv ${level} → ${level + 1}`;
  const sign = m[1] === '+' ? '+' : '−';
  const step = Number(m[2]);
  const unit = m[3] === undefined ? '' : m[3] === 'ms' ? ' ms' : m[3];
  const fmt = (n: number): string => `${sign}${Math.round(n * 10) / 10}${unit}`;
  return `${fmt(step * level)} → ${fmt(step * (level + 1))}`;
}

function spentOn(meta: MetaSaveV4): { shards: number; levels: number; maxLevels: number } {
  let shards = 0;
  let levels = 0;
  let maxLevels = 0;
  for (const node of SANCTUM) {
    const lvl = meta.upgrades[node.id] ?? 0;
    maxLevels += node.max;
    levels += Math.min(lvl, node.max);
    for (let l = 0; l < lvl; l++) shards += nodeCost(node, l).shards;
  }
  return { shards, levels, maxLevels };
}

export function buildSanctumTab(scene: Phaser.Scene, content: Phaser.GameObjects.Container): HubTab {
  const api = hubApi(scene);
  // A node id as segment (e.g. ARMSMASTER_ID from a locked STARTING WEAPON row)
  // opens that node's branch and scrolls its row into view once, highlighted.
  const focusId = api.takeSegment();
  const focusNode = SANCTUM.find((n) => n.id === focusId) ?? null;
  let branch: SanctumBranch = focusNode !== null && focusNode.branch !== 'ROOT' ? focusNode.branch : 'BODY';
  let focusY: number | null = null;
  let focusPending = focusNode !== null;

  const build = (): void => {
    content.removeAll(true);
    const meta = loadMeta();
    const bi = BRANCHES.indexOf(branch);
    content.add(
      segmented(
        scene,
        40,
        184 - C,
        640,
        72,
        BRANCHES,
        bi,
        (i) => {
          branch = BRANCHES[i] ?? 'BODY';
          build();
        },
        [],
        BRANCHES.map(branchIcon),
      ),
    );

    // Root node row pinned at y 268 — preceded by Dread Ascension once open.
    let y = 268 - C;
    if (ascensionOpen(meta)) {
      content.add(ascensionRow(scene, meta, y, build));
      y += ROW_H + 12;
    }
    for (const root of SANCTUM.filter((n) => n.branch === 'ROOT')) {
      content.add(nodeRow(scene, meta, root, y, build));
      y += ROW_H + 12;
    }

    const spent = spentOn(meta);
    const allMaxed = spent.levels >= spent.maxLevels && spent.maxLevels > 0;
    const header = allMaxed
      ? 'THE DARK REMEMBERS YOU'
      : meta.currency === 0 && meta.sigils === 0
        ? `Extract to earn ◆ · ${spent.levels}/${spent.maxLevels} levels`
        : `Spent ${num(spent.shards)} ◆ · ${spent.levels}/${spent.maxLevels} levels`;
    content.add(label(scene, 680, y + 4, header, { size: 22, bold: true, color: allMaxed ? CSS.accent : CSS.inkSoft, origin: [1, 0] }));
    y += 48;
    if (!ascensionOpen(meta)) {
      content.add(label(scene, 40, y - 44, 'Max every node to open Dread Ascension', { size: 16, color: CSS.inkSoft }));
    }

    const nodes = SANCTUM.filter((n) => n.branch === branch);
    const rows = [...new Set(nodes.map((n) => n.row))].sort((a, b) => a - b);
    const bSpent = branchSpent(meta, branch);
    for (const row of rows) {
      const inRow = nodes.filter((n) => n.row === row);
      const first = inRow[0];
      const gate = first === undefined ? { unlocked: true, reason: '' } : nodeUnlocked(meta, first.id);
      const need = ROW_SPEND[Math.max(0, row - 1)] ?? 0;
      const title = row === 4 ? 'KEYSTONES' : `TIER ${row}`;
      const lockText = gate.unlocked ? '' : ` · ${gate.reason || `Spend ${num(need)} ◆ in ${branch} to open`}`;
      content.add(label(scene, 40, y + 6, `${title}${lockText}`, { size: 20, bold: true, color: gate.unlocked ? CSS.inkSoft : CSS.warn, wrap: 640 }));
      if (!gate.unlocked && need > 0) {
        content.add(label(scene, 680, y + 6, `${num(bSpent)} / ${num(need)} ◆`, { size: 18, color: CSS.inkSoft, origin: [1, 0] }));
      }
      y += 40;
      for (const node of inRow) {
        if (focusNode?.id === node.id) focusY = y;
        content.add(nodeRow(scene, meta, node, y, build));
        if (focusNode?.id === node.id && focusPending) {
          const ring = scene.add.graphics();
          ring.lineStyle(4, PALETTE.accent, 1);
          ring.strokeRoundedRect(36, y - 4, 648, ROW_H + 8, 18);
          content.add(ring);
        }
        y += ROW_H + 12;
      }
      y += 8;
    }
    api.setContentHeight(y + 20);
    if (focusPending && focusY !== null) api.scrollView().scrollTo(focusY - 120);
    focusPending = false;
  };

  build();
  return { refresh: build, destroy: () => content.removeAll(true) };
}

function nodeRow(scene: Phaser.Scene, meta: MetaSaveV4, node: SanctumNodeDef, y: number, rebuild: () => void): Phaser.GameObjects.Container {
  const api = hubApi(scene);
  const row = scene.add.container(40, y);
  const level = meta.upgrades[node.id] ?? 0;
  const maxed = level >= node.max;
  const gate = nodeUnlocked(meta, node.id);
  const cost = maxed ? { shards: 0, sigils: 0 } : nodeCost(node, level);
  const sigil = node.currency === 'sigils';
  const affordable = sigil ? meta.sigils >= cost.sigils : meta.currency >= cost.shards;

  row.add(panelAt(scene, 0, 0, 640, ROW_H, node.row === 4 ? { stroke: PALETTE.secondary, strokeAlpha: 0.9 } : maxed ? { stroke: PALETTE.accent } : {}));
  // Branch icon at the row's left (ROOT uses BODY's, its first branch).
  // Armsmaster's Leave shows the class start weapon; every other node its branch glyph.
  const iconId = node.id === ARMSMASTER_ID ? `icon-wpn-${classDef(meta.classId).startWeapon}` : branchIcon(node.branch === 'ROOT' ? 'BODY' : node.branch);
  row.add(iconFor(scene, iconId, 56, BRANCH_TONE[node.branch], 'disc').setPosition(46, ROW_H / 2));
  const tx = 88;
  const title = label(scene, tx, 14, node.title, { size: node.title.length > 24 ? 22 : 26, bold: true, wrap: 322 });
  row.add(title);
  row.add(label(scene, tx, title.y + title.height + 2, node.flavor, { size: 18, color: CSS.inkSoft }));
  row.add(pips(scene, tx, 118, Math.min(level, node.max), node.max, maxed ? PALETTE.accent : PALETTE.primary));
  const pv = label(scene, tx + 20 + node.max * 22, 118, preview(node, level), { size: 20, bold: true, color: maxed ? CSS.accent : CSS.ink, origin: [0, 0.5] });
  // Keep the preview clear of the 200 px price button (starts at x 420).
  if (pv.x + pv.width > 408) pv.setScale((408 - pv.x) / pv.width);
  row.add(pv);

  const price = maxed ? 'MAXED' : sigil ? `${cost.sigils} ✦` : `${num(cost.shards)} ◆`;
  const btn = new Button(
    scene,
    640 - 20 - 100,
    ROW_H / 2,
    price,
    () => {
      const r = buyNode(node.id);
      if (!r.ok) {
        actionToast(scene, r.reason ?? 'Cannot buy');
        return;
      }
      sfx('levelup');
      rebuild();
      api.refreshChrome();
      actionToast(scene, `${node.title} · Lv ${level + 1}`, {
        actionLabel: 'UNDO',
        onAction: () => {
          if (undoLastNode()) {
            sfx('ui');
            rebuild();
            api.refreshChrome();
          }
        },
      });
    },
    { width: 200, height: 88, fontSize: '28px', ...(maxed ? BUTTON_STYLE.idle : BUTTON_STYLE.primary) },
  );
  if (maxed) btn.setEnabled(false, () => actionToast(scene, 'Already maxed.'));
  else if (!gate.unlocked) btn.setEnabled(false, () => actionToast(scene, gate.reason));
  else if (!affordable) btn.setEnabled(false, () => actionToast(scene, sigil ? `Need ${cost.sigils - meta.sigils} more ✦` : `Need ${num(cost.shards - meta.currency)} more ◆`));
  row.add(btn);
  if (!gate.unlocked) row.setAlpha(DISABLED_ALPHA + 0.25);
  return row;
}

/** Dread Ascension: the endless row after the tree is maxed (+1% damage & shards per rank). */
function ascensionRow(scene: Phaser.Scene, meta: MetaSaveV4, y: number, rebuild: () => void): Phaser.GameObjects.Container {
  const api = hubApi(scene);
  const rank = ascensionRank(meta);
  const cost = ascensionCost(rank);
  const row = scene.add.container(40, y);
  row.add(panelAt(scene, 0, 0, 640, ROW_H, { stroke: PALETTE.secondary, strokeAlpha: 1, strokeWidth: 3 }));
  row.add(iconFor(scene, 'icon-branch-ascension', 56, PALETTE.secondary, 'star').setPosition(46, ROW_H / 2));
  row.add(label(scene, 88, 12, 'DREAD ASCENSION', { size: 24, bold: true, color: CSS.secondary }));
  row.add(label(scene, 88, 44, 'Damage +1% · Shards +1% per rank', { size: 18, color: CSS.ink }));
  row.add(label(scene, 88, 70, 'The dark remembers every debt.', { size: 16, color: CSS.inkSoft }));
  row.add(label(scene, 88, 118, `Rank ${rank} · +${rank}% damage & shards`, { size: 20, bold: true, color: CSS.accent, origin: [0, 0.5] }));
  const btn = new Button(scene, 520, ROW_H / 2, `${num(cost)} ◆`, () => {
    const r = buyAscension();
    if (!r.ok) {
      actionToast(scene, r.reason ?? 'Cannot ascend');
      return;
    }
    sfx('levelup');
    rebuild();
    api.refreshChrome();
    actionToast(scene, `Dread Ascension · Rank ${rank + 1}`);
  }, { width: 200, height: 88, fontSize: '26px', ...BUTTON_STYLE.primary });
  if (meta.currency < cost) btn.setEnabled(false, () => actionToast(scene, `Need ${num(cost - meta.currency)} more ◆`));
  row.add(btn);
  return row;
}
