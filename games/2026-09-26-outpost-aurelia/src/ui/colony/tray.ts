import Phaser from 'phaser';
import { CSS, PALETTE } from '../../config';
import { buildingDef, type BuildingId } from '../../slices/colony/content';
import type { ColonyUiHost, ColonyView, ColonyWidget } from '../../slices/colony/contracts';
import { COLONY_TUNING } from '../../slices/colony/tuning';
import { bindTap, label } from '../widgets';
import { stripNotice, uiState } from './bridge';
import { CHROME, Control, UI_DEPTH, costLabel, icon, missingLabel, paintCapsule, pin, placard, setColor, setText } from './theme';

/**
 * ContextStrip (interface-direction §5: x 40, y 872, 640 × 84; action button
 * 160 × 84 at x 520, hit area grown to 88). One mode at a time:
 * build mode (icon + name + cost + "tap tiles · N valid" + DONE) → deposit
 * BUILD chip → power row (net kW, tonight's forecast, bank, supply/demand bar)
 * with BEACON by day, OVERDRIVE (3 stress pips) or SKIP TO DAWN at night.
 * A transient notice ("Need 12 Alloy") replaces the info line for 1.5 s.
 */
const TRAY = { x: 40, y: 872, w: 640, h: 84 } as const;
const BTN = { x: 520, w: 160 } as const;
const BAR = { x: 56, y: 918, w: 440, h: 26 } as const;
const DEPOSIT_NAME: Record<string, string> = { ore: 'ore', ice: 'ice', crystal: 'crystal', vent: 'vent' };

type Mode = 'build' | 'chip' | 'power';
type Action = 'done' | 'beacon' | 'overdrive' | 'skip' | null;

export class ContextStrip implements ColonyWidget {
  private readonly host: ColonyUiHost;
  private readonly root: Phaser.GameObjects.Container;
  private readonly powerText: Phaser.GameObjects.Text;
  private readonly notice: Phaser.GameObjects.Text;
  private lastNoticeUntil = 0;
  private readonly barHousing: Phaser.GameObjects.Graphics;
  private readonly barFill: Phaser.GameObjects.Rectangle;
  private readonly barTick: Phaser.GameObjects.Rectangle;
  private readonly buildName: Phaser.GameObjects.Text;
  private readonly buildHint: Phaser.GameObjects.Text;
  private readonly swallow: Phaser.GameObjects.Zone;
  private ping: { col: number; row: number; dist: number; dir: string } | null = null;
  private buildIcon: Phaser.GameObjects.Image | null = null;
  private readonly chip: Control;
  private readonly action: Control;
  private readonly pips: Phaser.GameObjects.Arc[] = [];
  private mode: Mode | null = null;
  /** `undefined` until the first sync, so the initial mode always paints the button's visibility. */
  private act: Action | undefined = undefined;
  private lastIconFor: BuildingId | null = null;
  private lastPowerKey = Number.NaN;
  private lastBarKey = Number.NaN;
  private lastPips = -1;
  private lastOd = -1;

  constructor(host: ColonyUiHost) {
    this.host = host;
    const scene = host.scene;
    this.root = scene.add.container(0, 0).setDepth(UI_DEPTH.hud + 2);
    // The tray swallows taps on its plate so they never fall through to the map.
    const plate = placard(scene, TRAY.x, TRAY.y, TRAY.w, TRAY.h);
    const swallow = scene.add.zone(TRAY.x, TRAY.y, TRAY.w, TRAY.h).setOrigin(0, 0).setInteractive();
    this.swallow = swallow;
    swallow.setData('noop', 'tray plate: absorbs taps between tray controls');

    this.powerText = label(scene, 56, 886, '', { size: 24, bold: true, origin: [0, 0.5] }).setY(893);
    this.barHousing = scene.add.graphics({ x: BAR.x + BAR.w / 2, y: BAR.y + BAR.h / 2 });
    paintCapsule(this.barHousing, BAR.w, BAR.h, PALETTE.bgDeep, CHROME.chipStroke);
    this.barFill = scene.add.rectangle(BAR.x + 4, BAR.y + 4, BAR.w - 8, BAR.h - 8, PALETTE.primary).setOrigin(0, 0);
    this.barTick = scene.add.rectangle(BAR.x, BAR.y - 4, 4, BAR.h + 8, PALETTE.inkSoft).setOrigin(0.5, 0);

    this.buildName = label(scene, 128, 892, '', { size: 26, bold: true, origin: [0, 0.5] });
    this.buildHint = label(scene, 128, 932, '', { size: 22, color: CSS.inkSoft, origin: [0, 0.5] });
    this.notice = label(scene, 56, 893, '', { size: 24, bold: true, color: CSS.primary, origin: [0, 0.5] }).setVisible(false);

    // The plate is the tap target of the '0 valid' line: while that line names a deposit, a tap pans there.
    bindTap(swallow, () => {
      if (this.ping !== null) host.panTo(this.ping.col + 1, this.ping.row + 1);
    });
    this.chip = new Control(scene, TRAY.x, TRAY.y, TRAY.w, TRAY.h, '', 'primary', () => host.buildDepositChip(), { size: 26, softDisable: true, onRefused: () => host.buildDepositChip() });
    this.action = new Control(scene, BTN.x, TRAY.y, BTN.w, TRAY.h, '', 'primary', () => this.onAction(), { size: 24, softDisable: true, onRefused: () => this.onRefused() });
    for (let i = 0; i < 3; i += 1) {
      const pip = scene.add.circle(BTN.w / 2 - 24 + i * 24, TRAY.h - 14, 7, CHROME.dialTrack).setStrokeStyle(2, PALETTE.bgDeep);
      this.pips.push(pip);
      this.action.root.add(pip);
    }
    this.root.add([plate, swallow, this.powerText, this.barHousing, this.barFill, this.barTick, this.buildName, this.buildHint, this.chip.root, this.action.root, this.notice]);
    pin(this.root);
    this.update(host.view());
  }

  update(v: ColonyView): void {
    const host = this.host;
    const bridge = host;
    // Auto-disarm on unaffordable + its "Need N X" notice are game.ts's (disarmIfUnaffordable → stripNotice); the strip only displays it.
    const armed = host.armed;

    const chip = bridge.depositChip;
    const mode: Mode = armed !== null ? 'build' : chip !== null ? 'chip' : 'power';
    if (mode !== this.mode) {
      this.mode = mode;
      const power = mode === 'power';
      this.powerText.setVisible(power);
      this.barHousing.setVisible(power);
      this.barFill.setVisible(power);
      this.barTick.setVisible(power);
      this.buildName.setVisible(mode === 'build');
      this.buildHint.setVisible(mode === 'build');
      if (mode !== 'build') this.ping = null;
      this.buildIcon?.setVisible(mode === 'build');
      this.chip.setVisible(mode === 'chip');
    }

    if (mode === 'build' && armed !== null) this.syncBuild(armed, v);
    else if (mode === 'chip' && chip !== null) this.syncChip(chip);
    else this.syncPower(v);

    const s = uiState(host.scene);
    const noticeOn = s.notice !== null && host.scene.time.now < s.noticeUntil;
    // A new notice (refused placement, deny, nudge) shakes the strip: the reason never arrives silently.
    if (noticeOn && s.noticeUntil !== this.lastNoticeUntil) {
      this.lastNoticeUntil = s.noticeUntil;
      host.scene.tweens.killTweensOf(this.root);
      this.root.setX(0);
      host.scene.tweens.add({ targets: this.root, x: { from: -8, to: 0 }, duration: 260, ease: 'Elastic.easeOut' });
    }
    if (!noticeOn && s.notice !== null) s.notice = null;
    this.notice.setVisible(noticeOn && mode !== 'chip');
    if (noticeOn && s.notice !== null) {
      setText(this.notice, s.notice);
      // Never under the action button: fit into the space left of it (or the whole plate when none shows).
      const room = this.action.root.visible ? BTN.x - 56 - 8 : TRAY.w - 32;
      this.notice.setScale(Math.min(1, room / Math.max(1, this.notice.width)));
    }
    if (mode === 'power') this.powerText.setVisible(!noticeOn);
    if (mode === 'build') this.buildName.setVisible(!noticeOn);
  }

  private syncBuild(def: BuildingId, v: ColonyView): void {
    const d = buildingDef(def);
    const model = this.host.model;
    if (this.lastIconFor !== def) {
      this.lastIconFor = def;
      this.buildIcon?.destroy();
      this.buildIcon = icon(this.host.scene, d.iconKey, 64);
      if (this.buildIcon !== null) {
        this.buildIcon.setPosition(88, TRAY.y + TRAY.h / 2).setScrollFactor(0);
        this.root.addAt(this.buildIcon, 2);
      }
    }
    // The title never runs under DONE (x 520): name + cost when it fits the 384 px, else the name alone
    // (the cost stays on the dock slot); never shrunk below ~22 px.
    setText(this.buildName, `${d.name} · ${costLabel(model.costOf(def))}`);
    if (this.buildName.width > 384 / 0.85) setText(this.buildName, d.name);
    this.buildName.setScale(Math.min(1, 384 / Math.max(1, this.buildName.width)));
    const n = this.host.validTileCount;
    let hint: string;
    if (n > 0) hint = `tap tiles · ${n} valid`;
    else if (d.deposit !== null) {
      // Ping the nearest dark matching deposit: the line names where it is, a tap pans there.
      const t = nearestDark(model, d.deposit);
      this.ping = t;
      hint = t === null ? `0 valid · no ${DEPOSIT_NAME[d.deposit] ?? d.deposit} seen — add a Relay` : `0 valid · ${DEPOSIT_NAME[d.deposit] ?? d.deposit} ${t.dist} tiles past the grid, ${t.dir} — tap to look`;
    } else hint = '0 valid · extend the field with a Relay';
    if (n > 0 || d.deposit === null) this.ping = null;
    const noop = this.ping === null ? 'tray plate: absorbs taps between tray controls' : null;
    if (this.swallow.getData('noop') !== noop) this.swallow.setData('noop', noop);
    setText(this.buildHint, hint);
    // The hint never runs under DONE (x 520): it fits the 380 px left of it.
    this.buildHint.setScale(Math.min(1, 380 / Math.max(1, this.buildHint.width)));
    this.setAction('done', v);
  }

  private syncChip(chip: { def: BuildingId; col: number; row: number }): void {
    const model = this.host.model;
    const d = buildingDef(chip.def);
    const check = model.canPlace(chip.def, chip.col, chip.row);
    const why: Record<string, string> = {
      dark: 'outside the grid — extend with a Relay',
      blocked: 'blocked',
      deposit: 'needs its deposit',
      locked: `unlocks on sol ${d.unlockSol}`,
      afford: missingLabel(model.costOf(chip.def), model.stock) ?? 'Not enough stock',
      bounds: 'off the map',
      unique: 'only one allowed',
    };
    this.chip.setLabel(check.ok ? `BUILD ${d.name} · ${costLabel(check.cost)}` : `${d.name} — ${why[check.why] ?? check.why}`).setEnabled(check.ok);
    this.chip.text.setScale(Math.min(1, (TRAY.w - 32) / Math.max(1, this.chip.text.width)));
    this.setAction(null, null);
  }

  private syncPower(v: ColonyView): void {
    const net = v.kwSupply - v.kwDemand;
    const n10 = Math.round(net * 10);
    const f10 = Math.round(v.kwNightForecast * 10);
    const bank = Math.round(v.bankKj);
    const key = n10 * 1e8 + f10 * 1e4 + bank + (v.bankCapKj > 0 ? 0.5 : 0);
    if (key !== this.lastPowerKey) {
      this.lastPowerKey = key;
      const sign = (x: number): string => (x >= 0 ? `+${(x / 10).toFixed(1)}` : `−${(-x / 10).toFixed(1)}`);
      const bankPart = v.bankCapKj > 0 ? `   ▮ ${bank}/${Math.round(v.bankCapKj)} kJ` : '';
      setText(this.powerText, `⚡ ${sign(n10)} kW   night ${sign(f10)}${bankPart}`);
      // Never clip (critic2: 'night −0.1 · ▮60kJ' overflowed): fit into the 456 px left of the button.
      this.powerText.setScale(Math.min(1, 456 / Math.max(1, this.powerText.width)));
      setColor(this.powerText, n10 < 0 || f10 < 0 ? CSS.bad : CSS.ink);
    }
    const scale = Math.max(v.kwSupply, v.kwDemand, 1);
    const load = Math.min(1, v.kwDemand / scale);
    const tick = Phaser.Math.Clamp((v.kwSupply - v.kwNightForecast) / scale, 0, 1);
    const barKey = Math.round(load * 200) * 1000 + Math.round(tick * 200) + (v.kwSupply + 1e-6 >= v.kwDemand ? 0.5 : 0);
    if (barKey !== this.lastBarKey) {
      this.lastBarKey = barKey;
      this.barFill.setScale(Math.max(0.001, load), 1).setFillStyle(v.kwSupply + 1e-6 >= v.kwDemand ? PALETTE.primary : PALETTE.bad);
      this.barTick.setX(BAR.x + 4 + (BAR.w - 8) * tick);
    }

    const night = v.phase === 'night' || v.phase === 'long-night';
    let act: Action = null;
    if (night && v.canSkipNight) act = 'skip';
    else if (night) act = 'overdrive';
    else if (v.beaconState === 'ready' && v.stock.cell >= v.cellsNeeded) act = 'beacon';
    this.setAction(act, v);
  }

  private setAction(act: Action, v: ColonyView | null): void {
    if (act === null && this.act === undefined) this.action.setVisible(false);
    if (act !== this.act) {
      this.act = act;
      this.action.setVisible(act !== null);
      for (const p of this.pips) p.setVisible(act === 'overdrive');
      this.action.text.setScale(1);
      if (act === 'done') this.action.setLabel('DONE').setKind('secondary').setEnabled(true);
      if (act === 'beacon') this.action.setLabel('BEACON').setKind('primary').setEnabled(true);
      if (act === 'skip') this.action.setLabel('SKIP TO\nDAWN').setKind('primary').setEnabled(true);
      if (act === 'overdrive') this.lastOd = -1;
    }
    if (act === 'overdrive' && v !== null) {
      const model = this.host.model;
      const left = Math.ceil(model.overdriveLeft);
      const pips = Math.min(3, Math.round(v.stress * 3));
      if (left !== this.lastOd || pips !== this.lastPips) {
        this.lastOd = left;
        this.lastPips = pips;
        this.action.setLabel(left > 0 ? `OVERDRIVE ${left}s` : 'OVERDRIVE').setKind('danger').setEnabled(left === 0 && pips < 3);
        this.action.text.setScale(Math.min(1, (BTN.w - 16) / Math.max(1, this.action.text.width)));
        this.pips.forEach((p, i) => p.setFillStyle(i < pips ? PALETTE.bad : CHROME.dialTrack));
      }
    }
  }

  private onAction(): void {
    const host = this.host;
    switch (this.act ?? null) {
      case 'done':
        host.disarm();
        break;
      case 'beacon':
        host.triggerBeacon();
        break;
      case 'skip':
        if (!host.skipNight()) stripNotice(host.scene, 'Fauna still near the field');
        break;
      case 'overdrive':
        if (!host.overdrive()) this.onRefused();
        break;
      case null:
        break;
    }
  }

  private onRefused(): void {
    if (this.act !== 'overdrive') return;
    const left = Math.ceil(this.host.model.overdriveLeft);
    stripNotice(this.host.scene, left > 0 ? `Overdrive running · ${left}s left` : 'Core stress at 3 — another overdrive breaks it', 1500);
  }

  destroy(): void {
    this.chip.destroy();
    this.action.destroy();
    if (this.root.scene) this.root.destroy();
  }
}

export const TRAY_RECT = { x: TRAY.x, y: TRAY.y, w: TRAY.w, h: TRAY.h } as const;

const COMPASS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;

/** The nearest unlit, unbuilt deposit of `kind` (revealed ones first), with its distance and compass bearing from the core. */
function nearestDark(model: ColonyUiHost['model'], kind: string): { col: number; row: number; dist: number; dir: string } | null {
  // Nearest to the FIELD, not the core (critic build4: a vent 3 tiles past the grid edge lost to one 24 tiles SW).
  // Only deposits the map shows (revealed, or a silhouette within `field.pingRadiusTiles` of lit ground) are named.
  const { cols, rows } = model.map;
  const ping = COLONY_TUNING.field.pingRadiusTiles;
  const core = model.map.core;
  let best: { col: number; row: number } | null = null;
  let bestDist = Infinity;
  for (const dep of model.map.deposits) {
    if (dep.kind !== kind) continue;
    const i = model.tileIndex(dep.col, dep.row);
    if (model.lit[i] === 1 || model.occ[i] !== 0) continue;
    let d = Infinity;
    for (let dr = -ping; dr <= ping; dr += 1) {
      for (let dc = -ping; dc <= ping; dc += 1) {
        const c = dep.col + dc;
        const r = dep.row + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows || model.lit[r * cols + c] !== 1) continue;
        const e = Math.hypot(dc, dr);
        if (e < d) d = e;
      }
    }
    // Revealed but beyond ping: ranked after every visible silhouette, by core distance.
    if (d === Infinity) {
      if (model.revealed[i] !== 1) continue;
      d = ping + Math.hypot(dep.col - core.col, dep.row - core.row);
    }
    if (d < bestDist) {
      bestDist = d;
      best = dep;
    }
  }
  if (best === null) return null;
  const dx = best.col - core.col;
  const dy = best.row - core.row;
  const oct = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
  return { col: best.col, row: best.row, dist: Math.max(1, Math.round(bestDist > ping ? bestDist - ping : bestDist)), dir: COMPASS[oct] ?? 'N' };
}
