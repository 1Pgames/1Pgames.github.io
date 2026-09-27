import Phaser from 'phaser';
import { PALETTE } from '../../config';
import { buildingDef } from '../../slices/colony/content';
import type { AlertKind, ColonyUiHost, ColonyView, ColonyWidget } from '../../slices/colony/contracts';
import { relayRadius } from '../../slices/colony/model/field';
import { bindTap, label } from '../widgets';
import { stripNotice, uiState } from './bridge';
import { CHROME, UI_DEPTH, icon, paintCapsule, pin, setText } from './theme';

/**
 * AlertRail (interface-direction §5: pills 312 × 88 at (40,336) and
 * (368,336)): icon + one line; tap pans (and selects the building); a pill
 * auto-dismisses after 6 s or when its alert resolves; a third alert queues.
 * The rail hides while any coach spotlight is up so it never covers the
 * coach target (critic2 #5).
 */
const PILL = { w: 312, h: 88, y: 336, xs: [40, 368] } as const;
const DISMISS_MS = 6000;
/** Model alerts plus the UI's own nudges (tonight's power deficit, the rations ETA). */
type PillKind = AlertKind | 'power' | 'rations' | 'beds';
const KINDS: readonly PillKind[] = ['dark', 'cold', 'leech', 'order', 'starve', 'alpha', 'core', 'idle', 'power', 'rations', 'beds'];
const NUDGES: ReadonlySet<PillKind> = new Set<PillKind>(['power', 'rations', 'beds']);
/** A dismissed nudge whose condition still holds comes back after this long. */
const NUDGE_REARM_MS = 30000;
/** The rations nudge appears when the stock lasts less than this at the current burn. */
const RATIONS_WARN_SEC = 90;
const ICON_OF: Record<PillKind, string> = {
  power: 'power',
  rations: 'rations',
  beds: 'ico-hab',
  dark: 'alert-relay-dark',
  cold: 'alert-hab-cold',
  leech: 'alert-leech',
  order: 'alert-order-ready',
  starve: 'alert-starving',
  alpha: 'alert-alpha',
  core: 'alert-core-hit',
  idle: 'alert-idle-crew',
};
const TEXT_OF: Record<AlertKind, string> = {
  dark: 'Relay dark',
  cold: 'Hab cold',
  leech: 'Leech!',
  order: 'Order ready',
  starve: 'Starving',
  alpha: 'Alpha',
  core: 'Core hit',
  idle: 'Idle crew',
};
/** Urgency order for the two visible pills. */
const RANK: Record<PillKind, number> = { core: 0, alpha: 1, starve: 2, rations: 3, power: 4, beds: 5, cold: 6, leech: 7, dark: 8, order: 9, idle: 10 };
/** Kinds that are not danger (neutral capsule instead of the rust pill). */
const CALM: ReadonlySet<PillKind> = new Set<PillKind>(['order', 'idle']);

interface Alert { kind: PillKind; col: number; row: number; uid: number | null }

interface Pill {
  root: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  icons: Map<PillKind, Phaser.GameObjects.Image>;
  text: Phaser.GameObjects.Text;
  key: number;
  alert: Alert | null;
}

function alertKey(a: Alert): number {
  return KINDS.indexOf(a.kind) * 1e7 + (a.uid ?? a.col * 1000 + a.row);
}

export class AlertRail implements ColonyWidget {
  private readonly host: ColonyUiHost;
  private readonly root: Phaser.GameObjects.Container;
  private readonly pills: Pill[] = [];
  /** Alert key → scene ms it first showed; dropped when the alert resolves. */
  private readonly seen = new Map<number, number>();
  private readonly live = new Set<number>();
  private readonly order: Alert[] = [];
  /** Reused nudge rows (never reallocated per update). */
  private readonly nudgePower: Alert = { kind: 'power', col: 0, row: 0, uid: null };
  private readonly nudgeRations: Alert = { kind: 'rations', col: 0, row: 0, uid: null };
  private readonly nudgeBeds: Alert = { kind: 'beds', col: 0, row: 0, uid: null };
  private idleCursor = 0;
  private lastIdle = -1;
  private view: ColonyView;

  constructor(host: ColonyUiHost) {
    this.host = host;
    this.view = host.view();
    const scene = host.scene;
    this.root = scene.add.container(0, 0).setDepth(UI_DEPTH.hud + 5);
    PILL.xs.forEach((x, i) => {
      const root = scene.add.container(x, PILL.y).setSize(PILL.w, PILL.h).setVisible(false);
      const bg = scene.add.graphics({ x: PILL.w / 2, y: PILL.h / 2 });
      const icons = new Map<PillKind, Phaser.GameObjects.Image>();
      root.add(bg);
      for (const k of KINDS) {
        const img = icon(scene, ICON_OF[k], 44);
        if (img === null) continue;
        img.setPosition(40, PILL.h / 2).setVisible(false);
        icons.set(k, img);
        root.add(img);
      }
      const text = label(scene, 72, PILL.h / 2, '', { size: 26, bold: true, origin: [0, 0.5] });
      root.add(text);
      root.setInteractive(new Phaser.Geom.Rectangle(0, 0, PILL.w, PILL.h), Phaser.Geom.Rectangle.Contains);
      bindTap(
        root,
        () => this.onTap(i),
        (p) => bg.setAlpha(p ? 0.75 : 1),
      );
      this.pills.push({ root, bg, icons, text, key: -1, alert: null });
      this.root.add(root);
    });
    pin(this.root);
  }

  update(v: ColonyView): void {
    this.view = v;
    const now = this.host.scene.time.now;
    this.live.clear();
    const order = this.order;
    order.length = 0;
    for (const a of v.alerts) order.push(a);
    // Nudges (priority below core / alpha / starving): tonight's power deficit by day, the rations ETA.
    if ((v.phase === 'day' || v.phase === 'dusk') && v.kwNightForecast < 0) order.push(this.nudgePower);
    if (v.rates.rations < 0 && v.stock.rations / -v.rates.rations < RATIONS_WARN_SEC) order.push(this.nudgeRations);
    // Crew is capped by beds (critic build4: 10/10 all game on 1 hab): beds full while seats stand empty.
    const bedsFull = v.colonists >= v.beds && v.staffing.idle === 0 && v.staffing.unstaffed.length > 0;
    if (bedsFull) order.push(this.nudgeBeds);
    for (const a of order) this.live.add(alertKey(a));
    for (const k of this.seen.keys()) if (!this.live.has(k)) this.seen.delete(k);

    const hidden = uiState(this.host.scene).coachRect !== null;
    let slot = 0;
    if (!hidden) {
      // Most urgent first (a core hit never waits behind 'Relay dark' / 'Idle crew'); stable within a kind.
      order.sort((a, b) => RANK[a.kind] - RANK[b.kind]);
      for (const a of order) {
        if (slot >= this.pills.length) break;
        const k = alertKey(a);
        // The 6 s dismiss clock starts when the pill is first SHOWN, not when the alert was raised
        // (an alert raised under a coach spotlight still gets its full 6 s on screen).
        const at = this.seen.get(k);
        if (at === undefined || (NUDGES.has(a.kind) && now - at > NUDGE_REARM_MS)) this.seen.set(k, now);
        else if (now - at > DISMISS_MS) continue;
        this.show(this.pills[slot] as Pill, a, k, v);
        slot += 1;
      }
    }
    for (let i = slot; i < this.pills.length; i += 1) {
      const p = this.pills[i] as Pill;
      if (p.alert !== null) {
        p.alert = null;
        p.key = -1;
        p.root.setVisible(false);
      }
    }
  }

  private show(p: Pill, a: Alert, key: number, v: ColonyView): void {
    const idle = a.kind === 'idle' ? v.staffing.idle : -1;
    if (p.key === key && idle === this.lastIdle && !NUDGES.has(a.kind)) {
      p.alert = a;
      return;
    }
    if (a.kind === 'idle') this.lastIdle = idle;
    const prevKind = p.alert?.kind ?? null;
    p.alert = a;
    p.key = key;
    if (prevKind !== a.kind) {
      paintCapsule(p.bg, PILL.w, PILL.h, CALM.has(a.kind) ? PALETTE.bgDeep : CHROME.danger, CALM.has(a.kind) ? CHROME.chipStroke : PALETTE.bgDeep);
      for (const [k, img] of p.icons) img.setVisible(k === a.kind);
    }
    setText(p.text, a.kind === 'power' ? powerText(this.host, v) : pillText(a.kind, v));
    p.text.setScale(Math.min(1, (PILL.w - 84) / Math.max(1, p.text.width)));
    p.root.setVisible(true);
  }

  private onTap(i: number): void {
    const a = this.pills[i]?.alert ?? null;
    if (a === null) return;
    const host = this.host;
    if (a.kind === 'order') {
      host.openSheet('orders');
      return;
    }
    if (a.kind === 'idle') {
      this.onIdle();
      return;
    }
    if (a.kind === 'power') {
      const risk = turretAtRisk(host);
      if (risk !== null) {
        // One tap from PIN LIT: open the relay that carries the turret.
        stripNotice(host.scene, `Tonight: turret ${risk.dir} will go dark — add power or PIN LIT this relay`, 3000);
        host.panTo(risk.col, risk.row);
        host.select(risk.uid);
        return;
      }
      stripNotice(host.scene, 'Night power short — add a Sun Sail + Charge Bank, or PIN LIT key relays', 2600);
      host.openSheet('ledger');
      return;
    }
    if (a.kind === 'beds') {
      if (host.model.canAfford(host.model.costOf('hab_dome'))) host.arm('hab_dome');
      else host.want('hab_dome');
      stripNotice(host.scene, 'A Hab Dome adds 6 beds — new colonists arrive at dawn', 2600);
      return;
    }
    if (a.kind === 'rations') {
      if (host.model.canAfford(host.model.costOf('hydro_terrace'))) host.arm('hydro_terrace');
      stripNotice(host.scene, 'Food: a Hydro Terrace needs ice — pair it with a Rime Borer', 2600);
      return;
    }
    host.panTo(a.col, a.row);
    if (a.uid !== null) host.select(a.uid);
  }

  /**
   * 'Idle crew' is actionable (critic2 #1/#5): with unstaffed seats, each tap
   * pans to the next unstaffed building; with none, the strip explains that
   * idle hands need a workplace.
   */
  private onIdle(): void {
    const v = this.view;
    const list = v.staffing.unstaffed;
    const model = this.host.model;
    if (list.length > 0) {
      const uid = list[this.idleCursor % list.length] as number;
      this.idleCursor += 1;
      const b = model.buildings.get(uid);
      if (b !== undefined) {
        const c = model.centreOf(b);
        this.host.panTo(c.col, c.row);
        this.host.select(uid);
        return;
      }
    }
    stripNotice(this.host.scene, v.colonists >= v.beds ? `Beds full (${v.colonists}/${v.beds}) — build a Hab Dome to grow the crew` : `${v.staffing.idle} idle — build a drill, borer, terrace or smelter to employ them`, 2600);
  }

  destroy(): void {
    this.seen.clear();
    if (this.root.scene) this.root.destroy();
  }
}

function pillText(kind: PillKind, v: ColonyView): string {
  if (kind === 'idle') return `${v.staffing.idle} idle crew`;
  if (kind === 'power') return `Tonight ${v.kwNightForecast.toFixed(1).replace('-', '−')} kW`;
  if (kind === 'beds') return 'Beds full — Hab Dome';
  if (kind === 'rations') return `Rations ~${Math.max(0, Math.round(v.stock.rations / Math.max(1e-6, -v.rates.rations)))} s`;
  return TEXT_OF[kind];
}

const COMPASS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;

/**
 * The relay tonight's brownout will shed first that still carries a turret (mirrors the model's
 * shed order: unpinned, lit, a turret within radius + 1), with the turret's bearing from the core.
 */
function turretAtRisk(host: ColonyUiHost): { uid: number; col: number; row: number; dir: string } | null {
  const m = host.model;
  const radius = relayRadius(m);
  const core = m.map.core;
  let best: { uid: number; col: number; row: number; dir: string } | null = null;
  let bestDist = -1;
  for (const b of m.buildings.values()) {
    if (b.def !== 'relay_pylon' || b.pinned || !b.lit || b.shed) continue;
    for (const o of m.buildings.values()) {
      if (buildingDef(o.def).turret === null) continue;
      const c = m.centreOf(o);
      if (Math.hypot(c.col - b.col - 0.5, c.row - b.row - 0.5) > radius + 1) continue;
      // Outermost first, like the shed order.
      const dist = Math.hypot(b.col - core.col, b.row - core.row);
      if (dist > bestDist) {
        bestDist = dist;
        const oct = ((Math.round(Math.atan2(c.row - core.row, c.col - core.col) / (Math.PI / 4)) % 8) + 8) % 8;
        best = { uid: b.uid, col: b.col, row: b.row, dir: COMPASS[oct] ?? 'N' };
      }
      break;
    }
  }
  return best;
}

function powerText(host: ColonyUiHost, v: ColonyView): string {
  const risk = turretAtRisk(host);
  return risk !== null ? `Turret ${risk.dir} dark tonight` : pillText('power', v);
}
