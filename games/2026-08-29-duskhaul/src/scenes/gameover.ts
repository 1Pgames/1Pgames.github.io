/**
 * Results V2 (PRD-V2 §14.12 / FlowAudit §2.12, §3.2 edge copy).
 *
 * Headlines are kept for cert (`HAULED OUT` / `SWALLOWED BY THE DARK`). Blocks
 * reveal in order — KEPT · LOST (death only) · PROGRESS — and ANY tap outside
 * the buttons skips straight to the final state. The Hauler XP bar always
 * moves (from the pre-run total to the settled one), crossing level-ups with a
 * flash + unlock line.
 *
 * The settlement is already committed when this scene starts (`game.ts
 * finish()` calls `settleRun` before `scene.start`), so every exit is safe.
 * CONTINUE → Hub (VAULT when items were banked, else EXPEDITION);
 * RUN AGAIN (extracted) / RETRY SAME MAP (died/abandoned) → Hub with the
 * Loadout sheet open for the same zone/hazard (RETRY keeps the seed).
 */
import Phaser from 'phaser';
import { CSS, PALETTE, VIEW } from '../config';
import { sfx, sfxArp } from '../core/audio';
import { SCENES } from '../core/keys';
import { accountLevel, loadMeta } from '../core/progression';
import { shareResult } from '../core/share';
import { track } from '../core/telemetry';
import { contractText } from '../core/contracts';
import { contractDef } from '../data/contracts';
import { gearName } from '../data/gear';
import type { LootItem, RunReport, SettlementReport } from '../data/types-v2';
import { valuableDef } from '../data/valuables';
import { zoneDef } from '../data/zones';
import { itemCodexKey, itemRarity } from '../systems/bag';
import { addBackground } from '../ui/background';
import { Button, bindTap } from '../ui/button';
import { BUTTON_STYLE, DEEP_INK, SCRIM, paintBar } from '../ui/duskChrome';
import { clock, iconLine, itemTile, label, num, panelAt } from '../ui/widgets';
import { groupUnlocks } from './hub/format';
import type { HubData, RunStart } from './hub/hub';

/** E45 scene data: started by `game.ts finish()` and by `preload.ts` for an abandoned journal. */
export interface GameOverData {
  report: RunReport;
  settlement: SettlementReport;
}

const GATE_COPY: Record<string, string> = { toll: 'the Toll Gate', offering: 'the Offering Altar', bell: 'the Bell Gate' };
const REVEAL_MS = 260;
const XP_MS = 700;

function lootName(item: LootItem): string {
  return item.kind === 'gear' ? gearName(item.item) : valuableDef(item.item.id).name;
}

export class GameOverScene extends Phaser.Scene {
  /** Everything that animates — `skip()` completes them all. */
  private revealTweens: Phaser.Tweens.Tween[] = [];
  private finals: (() => void)[] = [];
  private skipped = false;

  constructor() {
    super(SCENES.gameOver);
  }

  create(data: GameOverData): void {
    this.revealTweens = [];
    this.finals = [];
    this.skipped = false;
    const { report, settlement } = data;
    const extracted = report.outcome === 'extracted';
    track(extracted ? 'win' : 'loss');

    addBackground(this);
    this.add.rectangle(0, 0, VIEW.width, VIEW.height, SCRIM.fill, 0.55).setOrigin(0, 0).setDepth(-100);

    // Tap anywhere (not on a control) skips to the final state. Created FIRST
    // so every button above it keeps its taps (z-order contract).
    const skipZone = this.add.zone(0, 0, VIEW.width, VIEW.height).setOrigin(0, 0).setInteractive();
    bindTap(skipZone, () => this.skip());

    const zone = zoneDef(report.zone);
    const cy = 200;
    if (settlement.bestHaul && extracted) {
      const pill = this.add.graphics();
      pill.fillStyle(PALETTE.accent, 1);
      pill.fillRoundedRect(VIEW.centerX - 120, 108, 240, 40, 20);
      label(this, VIEW.centerX, 128, 'BEST HAUL YET', { size: 20, bold: true, color: '#03040b', origin: [0.5, 0.5] });
    }
    // Headlines (cert-stable).
    const headline = this.add
      .text(VIEW.centerX, cy, extracted ? 'HAULED OUT' : 'SWALLOWED BY THE DARK', {
        fontFamily: '"Arial Black", system-ui, sans-serif',
        fontSize: extracted ? '64px' : '56px',
        color: extracted ? CSS.accent : CSS.ink,
        stroke: '#03040b',
        strokeThickness: 6,
      })
      .setOrigin(0.5);
    // The death headline at 56 px overruns 720; scale to the 640 content width, never clip.
    if (headline.width > 640) headline.setScale(640 / headline.width);
    const nothingHappened = !extracted && settlement.lost.length === 0 && report.settlement.shardsLost === 0 && settlement.shardsBanked === 0 && settlement.itemsBanked.length === 0;
    let sub: string;
    if (extracted) {
      const g = report.gate;
      const where = g === null ? 'a gate' : g.kind === 'timed' ? `Gate ${g.id.toUpperCase()}` : (GATE_COPY[g.kind] ?? g.kind);
      sub = `through ${where} at ${clock(report.elapsedS)}`;
    } else if (report.outcome === 'abandoned') sub = 'You left mid-run.';
    else sub = `Slain by ${report.killer ?? 'the dark'} at ${clock(report.elapsedS)}`;
    if (nothingHappened) sub += '\nIt took nothing you hadn\'t already lost.';
    label(this, VIEW.centerX, cy + 52, `${sub}\n${zone.name} · H${report.hazard}`, { size: 24, color: CSS.ink, origin: [0.5, 0], align: 'center' });

    // Share icon 72×72 top-right (outside the shell corner).
    const share = this.add.container(644, 52);
    const sg = this.add.graphics();
    sg.fillStyle(DEEP_INK, 0.85);
    sg.fillCircle(0, 0, 32);
    sg.lineStyle(4, PALETTE.ink, 1);
    sg.strokeCircle(-10, 0, 6);
    sg.strokeCircle(12, -12, 6);
    sg.strokeCircle(12, 12, 6);
    sg.lineBetween(-5, -3, 7, -10);
    sg.lineBetween(-5, 3, 7, 10);
    share.add(sg);
    share.setSize(88, 88).setInteractive({ useHandCursor: true });
    bindTap(share, () => {
      sfx('ui');
      void shareResult({ score: `${num(settlement.shardsBanked)} shards`, won: extracted });
    }, (p) => share.setScale(p ? 0.92 : 1));

    // ── KEPT (from y 320; 220 tall with item tiles, 150 without) ──
    // Blocks size to their content so PROGRESS always has room above the CTAs
    // (critic v2b: an empty KEPT/LOST pair pushed PROGRESS under CONTINUE).
    const keptH = settlement.itemsBanked.length > 0 ? 220 : 150;
    const kept = this.add.container(0, 0);
    kept.add(panelAt(this, 40, 320, 640, keptH));
    kept.add(label(this, 60, 334, 'KEPT', { size: 22, bold: true, color: CSS.primary }));
    const banked = settlement.shardsBanked;
    const greed = report.settlement.greedMul;
    const shardLine =
      extracted && greed > 1.001
        ? `${num(Math.round(banked / greed))} ◆ × HAUL ${greed.toFixed(1)} = ${num(banked)} ◆`
        : extracted
          ? `${num(banked)} ◆`
          : `Rot Tithe: ${num(banked)} ◆`;
    const shardText = label(this, 60, 364, shardLine, { size: 30, bold: true, color: CSS.accent });
    kept.add(shardText);
    const keptItems = settlement.itemsBanked;
    // One truthful line per state (QA 15 / critic F10): never "nothing" under a
    // banked tithe, never "your items are in the Vault" with no items.
    if (keptItems.length === 0) {
      let empty: string;
      if (extracted) empty = settlement.firstExtraction ? 'First escape! Items you carry out are stored in the Vault.' : 'No items this time.';
      // The casket hint only when items were actually carried and lost; a run
      // that never picked anything up gets no advice about pinning (critic v2c).
      else if (settlement.lost.length > 0) empty = 'No items kept — pin one to your casket next time.';
      else empty = banked > 0 ? 'You carried no items this run.' : 'Nothing was kept.';
      kept.add(label(this, 60, 420, empty, { size: 22, color: settlement.firstExtraction ? CSS.primary : CSS.inkSoft, bold: settlement.firstExtraction, wrap: 600 }));
    } else {
      this.tiles(kept, keptItems, 60, 408, false, settlement.codexNew);
      if (!extracted) kept.add(label(this, 660, 334, 'Casket saved', { size: 18, color: CSS.ink, origin: [1, 0] }));
      if (extracted && settlement.firstExtraction) kept.add(label(this, 660, 334, 'First escape! Stored in the Vault.', { size: 18, bold: true, color: CSS.primary, origin: [1, 0] }));
    }
    // Count-up on the hero number.
    if (banked > 0) {
      const counter = { v: 0 };
      this.revealTweens.push(
        this.tweens.add({
          targets: counter,
          v: banked,
          duration: 600,
          delay: REVEAL_MS,
          ease: 'Quad.easeOut',
          onUpdate: () => shardText.setText(shardLine.replace(new RegExp(`${num(banked)} ◆$`), `${num(Math.round(counter.v))} ◆`)),
          onComplete: () => shardText.setText(shardLine),
        }),
      );
      this.finals.push(() => shardText.setText(shardLine));
    }
    this.reveal(kept, 0);

    // ── LOST (death only; 212 tall with tiles, 110 without) ──
    let y = 320 + keptH + 16;
    if (!extracted && (settlement.lost.length > 0 || report.settlement.shardsLost > 0)) {
      const lost = this.add.container(0, 0);
      const lostH = settlement.lost.length > 0 ? 212 : 110;
      lost.add(panelAt(this, 40, y, 640, lostH, { stroke: PALETTE.bad, strokeAlpha: 0.8 }));
      // `bad` as a FILL label, never as text (§11 restriction).
      const tag = this.add.graphics();
      tag.fillStyle(PALETTE.bad, 1);
      tag.fillRoundedRect(60, y + 14, 84, 32, 8);
      lost.add([tag, label(this, 102, y + 30, 'LOST', { size: 20, bold: true, color: '#03040b', origin: [0.5, 0.5] })]);
      const n = settlement.lost.length;
      lost.add(label(this, 160, y + 30, n > 0 ? `${num(report.settlement.shardsLost)} ◆ and ${n} item${n === 1 ? '' : 's'}` : `${num(report.settlement.shardsLost)} ◆`, { size: 22, bold: true, origin: [0, 0.5] }));
      this.tiles(lost, settlement.lost, 60, y + 52, true, []);
      const hint = n > 0 ? 'Pin your best item before a fight you might lose.' : 'Shards in your bag are lost when you fall.';
      lost.add(label(this, 60, y + lostH - 14, hint, { size: 18, color: CSS.warn, origin: [0, 0.5] }));
      this.reveal(lost, 1);
      y += lostH + 16;
    }

    // ── PROGRESS ──
    this.buildProgress(y, settlement, 2);

    // ── Buttons ──
    const hubData = (extra: HubData): HubData => ({
      ...extra,
      newItems: settlement.itemsBanked.map((i) => i.item.uid),
    });
    const toVault = settlement.itemsBanked.length > 0 && extracted;
    const onContinue = (): void => {
      const n = settlement.itemsBanked.length;
      this.leave(
        hubData(
          toVault
            ? { tab: 'vault', banner: `${n} item${n === 1 ? '' : 's'} stored. Equip them in the Armory or salvage for dust.` }
            : { tab: 'expedition' },
        ),
      );
    };
    new Button(this, VIEW.centerX, 1048, 'CONTINUE', onContinue, { width: 640, height: 96, fontSize: '40px', ...BUTTON_STYLE.primary });
    const sel: RunStart = extracted
      ? { zone: report.zone, hazard: report.hazard, mode: report.mode === 'ftue' ? 'normal' : report.mode, ...(report.mode === 'normal' || report.mode === 'ftue' ? {} : { seed: report.seed }) }
      : report.mode === 'ftue' && loadMeta().flags.ftueDone
        ? // §5.28: the Wicket's retries are spent — the retry is a normal run of the Keep.
          { zone: report.zone, hazard: report.hazard, mode: 'normal' }
        : { zone: report.zone, hazard: report.hazard, mode: report.mode, seed: report.seed };
    new Button(
      this,
      VIEW.centerX,
      1154,
      extracted ? 'RUN AGAIN' : 'RETRY SAME MAP',
      () => {
        if (!extracted) track('retry');
        this.leave(hubData({ tab: 'expedition', loadout: sel }));
      },
      { width: 640, height: 88, fontSize: '32px', ...BUTTON_STYLE.idle },
    );
    this.input.keyboard?.once('keydown-SPACE', onContinue);

    if (extracted) sfxArp('pickup', 4);
    else sfx('die', { volume: 0.5 });
    this.cameras.main.fadeIn(180, 0, 0, 0);
  }

  /**
   * Up to 5 item tiles (88×88, 104 apart) each NAMED underneath (critic F10:
   * a bare icon says nothing about what you kept), then `+N`.
   */
  private tiles(parent: Phaser.GameObjects.Container, items: readonly LootItem[], x: number, y: number, dim: boolean, codexNew: readonly string[]): void {
    items.slice(0, 5).forEach((item, i) => {
      const tx = x + i * 104;
      parent.add(itemTile(this, tx, y, 88, item, itemRarity(item), { dim, isNew: codexNew.includes(itemCodexKey(item)) }));
      const name = label(this, tx + 44, y + 92, lootName(item), { size: 14, color: dim ? CSS.inkSoft : CSS.ink, origin: [0.5, 0], align: 'center', wrap: 100 });
      // Two lines max: a longer name scales down rather than running into the next block.
      if (name.height > 36) name.setScale(36 / name.height);
      parent.add(name);
    });
    if (items.length > 5) parent.add(label(this, x + 530, y + 44, `+${items.length - 5}`, { size: 24, bold: true, origin: [0, 0.5] }));
  }

  private buildProgress(top: number, s: SettlementReport, order: number): void {
    const block = this.add.container(0, 0);
    const h = Math.min(990 - top, 250);
    block.add(panelAt(this, 40, top, 640, h));
    block.add(label(this, 60, top + 14, 'PROGRESS', { size: 22, bold: true, color: CSS.inkSoft }));
    block.add(label(this, 660, top + 14, `+${num(s.xpGained)} XP`, { size: 22, bold: true, color: CSS.primary, origin: [1, 0] }));

    // Hauler XP bar: animate from the pre-run total to the settled total.
    const meta = loadMeta();
    const after = accountLevel(meta);
    const before = accountLevel({ ...meta, account: { xp: Math.max(0, meta.account.xp - s.xpGained) } });
    const lvText = label(this, 60, top + 50, `HAULER LV ${before.level}`, { size: 22, bold: true });
    const bar = this.add.graphics({ x: 360, y: top + 94 });
    const fracOf = (l: { xpInto: number; xpNeeded: number }): number => (l.xpNeeded > 0 ? l.xpInto / l.xpNeeded : 1);
    paintBar(bar, 600, 20, fracOf(before), PALETTE.primary);
    block.add([lvText, bar]);
    const levels = after.level - before.level;
    const state = { t: 0 };
    const total = levels + fracOf(after) - fracOf(before);
    const setAt = (t: number): void => {
      // Position in "levels": p0 = start fraction, p1 = levels gained + end fraction.
      const pos = fracOf(before) + t * total;
      const whole = Math.min(levels, Math.floor(pos));
      paintBar(bar, 600, 20, Math.min(1, pos - whole), PALETTE.primary);
      lvText.setText(`HAULER LV ${before.level + whole}`);
    };
    this.revealTweens.push(
      this.tweens.add({
        targets: state,
        t: 1,
        duration: XP_MS,
        delay: REVEAL_MS * (order + 1),
        ease: 'Sine.easeInOut',
        onUpdate: () => setAt(state.t),
        onComplete: () => {
          setAt(1);
          if (levels > 0) {
            sfx('levelup');
            this.cameras.main.flash(160, 155, 223, 159);
          }
        },
      }),
    );
    this.finals.push(() => setAt(1));

    // Lines: level-up unlocks, zone unlock, contracts, codex, achievements, rite rewards.
    const lines: { text: string; color: string; icons?: string[] }[] = [];
    if (levels > 0) {
      // Arsenal pairs get their own `<weapon> + <charm>` line with both icons;
      // every other unlock stays on the LEVEL UP line.
      const entries = groupUnlocks(s.unlocks);
      const plain = entries.filter((e) => e.icons.length === 0).map((e) => e.text);
      lines.push({ text: `LEVEL UP!${plain.length > 0 ? ` Unlocked: ${plain.join(', ')}` : ''}`, color: CSS.primary });
      for (const e of entries) if (e.icons.length > 0) lines.push({ text: `New: ${e.text}`, color: CSS.primary, icons: e.icons });
    }
    if (s.zoneUnlocked !== null) lines.push({ text: `${zoneDef(s.zoneUnlocked).name} unlocked!`, color: CSS.accent });
    const active = meta.contracts.active;
    for (const c of s.contracts.slice(0, 3)) {
      const live = active.find((a) => a.id === c.id);
      const def = contractDef(c.id);
      const text = live !== undefined ? contractText(live) : (def?.text.replace('{n}', `${c.target}`) ?? c.id);
      lines.push({ text: `${text} ${c.from} → ${Math.min(c.to, c.target)}/${c.target}${c.done ? ' ✓' : ''}`, color: c.done ? CSS.accent : CSS.ink });
    }
    const codex = s.codexNew.length;
    if (codex > 0) lines.push({ text: `Codex: ${codex} new entr${codex === 1 ? 'y' : 'ies'}`, color: CSS.ink });
    if (s.achievements.length > 0) lines.push({ text: `${s.achievements.length} achievement${s.achievements.length === 1 ? '' : 's'} to claim in the Codex`, color: CSS.accent });
    if (s.dailyReward !== null) lines.push({ text: `Daily Rite reward: +${num(s.dailyReward)} ◆`, color: CSS.accent });
    if (s.weeklyReward !== null) lines.push({ text: `Weekly Rift reward: +${num(s.weeklyReward)} ◆`, color: CSS.accent });
    let ly = top + 118;
    const OVERFLOW_H = 24;
    for (const [i, l] of lines.entries()) {
      const { line: t, height: th } = iconLine(this, 60, ly, l.icons ?? [], l.text, { size: 19, color: l.color, iconSize: 24, width: 600 });
      // Never draw past the panel: a line only fits if the "+N more" line
      // still fits under it whenever more lines follow (critic v2b clipping).
      const reserve = i < lines.length - 1 ? OVERFLOW_H : 0;
      if (ly + th + reserve > top + h - 10) {
        t.destroy();
        block.add(label(this, 60, ly, `+${lines.length - i} more in the Codex`, { size: 17, color: CSS.inkSoft }));
        break;
      }
      block.add(t);
      ly += th + 6;
    }
    this.reveal(block, order);
  }

  /** Fades a block in at its slot in the sequence (alpha only — no layout motion). */
  private reveal(block: Phaser.GameObjects.Container, order: number): void {
    block.setAlpha(0.001);
    this.revealTweens.push(this.tweens.add({ targets: block, alpha: 1, duration: 200, delay: REVEAL_MS * order }));
    this.finals.push(() => block.setAlpha(1));
  }

  private skip(): void {
    if (this.skipped) return;
    this.skipped = true;
    for (const t of this.revealTweens) t.complete();
    for (const f of this.finals) f();
  }

  private leave(data: HubData): void {
    this.skip();
    this.cameras.main.fadeOut(180, 0, 0, 0);
    this.time.delayedCall(180, () => this.scene.start(SCENES.hub, data));
  }
}
