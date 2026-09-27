import Phaser from 'phaser';
import { CSS } from '../../config';
import { GOODS, buildingDef, type BuildingId, type Stock } from '../../slices/colony/content';
import type { BuildingInst, ColonyUiHost, ColonyView, ColonyWidget } from '../../slices/colony/contracts';
import { rateOf, statusOf, type BuildingStatus } from '../../slices/colony/model/production';
import type { ColonyState } from '../../slices/colony/model/state';
import { COLONY_TUNING } from '../../slices/colony/tuning';
import { confirmDialog } from '../sheet';
import { label } from '../widgets';
import { stripNotice, uiState } from './bridge';
import { Control, UI_DEPTH, costLabel, feEquivalent, missingLabel, paintPlacard, pin, placard, setColor, setText } from './theme';

/**
 * BuildingCard (interface-direction §5 x 40 w 640; y 588-864, bottom-docked
 * above the tray; the camera eases the building to y ≈ 480). Title + Mk,
 * crew x/y, a flow line ("−2.00 Fe/s → +1.00 Alloy/s"), a reason line
 * (`model/production.ts:statusOf`: why it is not working and what fixes it), UPGRADE / PAUSE (PIN LIT on relays) / DEMOLISH
 * (host shows the 3 s UNDO toast, never a confirm), then UPGRADE ALL
 * (confirm above `input.upgradeAllConfirmFe` Fe-eq). The plate swallows taps so nothing under the
 * card reaches the map (critic2 #5: no deposit taps land on PAUSE/DEMOLISH by
 * accident — the card is compact and only ever covers y 588-864).
 */
const CARD = { x: 40, y: 588, w: 640, h: 276 } as const;
/** PRD §14b confirmation policy: UPGRADE ALL above this Fe-equivalent confirms. */
const UPGRADE_ALL_CONFIRM_FE = COLONY_TUNING.input.upgradeAllConfirmFe;
const MK = ['', 'I', 'II', 'III', 'IV'] as const;
/** Height the UPGRADE ALL row adds to the card. */
const ROW2_H = 84;

export class BuildingCard implements ColonyWidget {
  private readonly host: ColonyUiHost;
  private readonly root: Phaser.GameObjects.Container;
  private readonly title: Phaser.GameObjects.Text;
  private readonly crew: Phaser.GameObjects.Text;
  private readonly flow: Phaser.GameObjects.Text;
  private readonly status: Phaser.GameObjects.Text;
  private readonly upgrade: Control;
  private readonly toggle: Control;
  private readonly demolish: Control;
  private readonly upgradeAll: Control;
  /** PRD §14 card RANGE: toggles the turret / relay range ring (`host.showRange`). */
  private readonly range: Control;
  private current: number | null = null;
  private readonly plate: Phaser.GameObjects.Graphics;
  private readonly swallow: Phaser.GameObjects.Zone;
  private compact: boolean | null = null;
  private lastFlow = '';
  private lastReason = '';

  constructor(host: ColonyUiHost) {
    this.host = host;
    const scene = host.scene;
    this.root = scene.add.container(0, 0).setDepth(UI_DEPTH.card).setVisible(false);
    const plate = placard(scene, CARD.x, CARD.y, CARD.w, CARD.h);
    const swallow = scene.add.zone(CARD.x, CARD.y, CARD.w, CARD.h).setOrigin(0, 0).setInteractive();
    swallow.setData('noop', 'card plate: absorbs taps so they never reach the map under it');
    this.plate = plate;
    this.swallow = swallow;
    this.title = label(scene, CARD.x + 24, CARD.y + 24, '', { size: 30, bold: true, origin: [0, 0.5] });
    this.crew = label(scene, CARD.x + CARD.w - 24, CARD.y + 24, '', { size: 24, bold: true, origin: [1, 0.5] });
    this.flow = label(scene, CARD.x + 24, CARD.y + 53, '', { size: 22, color: CSS.ink, origin: [0, 0.5] });
    this.status = label(scene, CARD.x + 24, CARD.y + 79, '', { size: 22, color: CSS.inkSoft, origin: [0, 0.5] });
    const by = CARD.y + 98;
    this.upgrade = new Control(scene, 56, by, 200, 88, 'UPGRADE', 'primary', () => this.onUpgrade(), { size: 22, softDisable: true, onRefused: () => this.onUpgradeRefused() });
    this.toggle = new Control(scene, 260, by, 200, 88, 'PAUSE', 'secondary', () => this.onToggle(), { size: 24 });
    this.demolish = new Control(scene, 464, by, 200, 88, 'DEMOLISH', 'danger', () => this.onDemolish(), { size: 24 });
    this.upgradeAll = new Control(scene, 56, CARD.y + 196, 300, 72, 'UPGRADE ALL', 'secondary', () => this.onUpgradeAll(), { size: 22 });
    this.range = new Control(scene, 464, CARD.y + 196, 200, 72, 'RANGE', 'secondary', () => {
      if (this.current !== null) this.host.showRange(this.current);
    }, { size: 22 });
    this.root.add([plate, swallow, this.title, this.crew, this.flow, this.status, this.upgrade.root, this.toggle.root, this.demolish.root, this.upgradeAll.root, this.range.root]);
    pin(this.root);
  }

  get uid(): number | null {
    return this.current;
  }

  show(uid: number | null): void {
    this.current = uid;
    uiState(this.host.scene).cardUid = uid;
    this.root.setVisible(uid !== null);
    if (uid !== null) this.update(this.host.view());
  }

  update(v: ColonyView): void {
    if (this.current === null) return;
    const model = this.host.model;
    const b = model.buildings.get(this.current);
    // Destroyed while open (§14b): the card closes; the ruin is tappable for REBUILD.
    if (b === undefined) {
      this.host.select(null);
      return;
    }
    const def = buildingDef(b.def);
    const core = b.def === 'lander_core';
    setText(this.title, core ? def.name : `${def.name} · Mk ${MK[b.mk]}`);
    setText(this.crew, def.workers > 0 ? `Crew ${b.staffed}/${def.workers}` : '');
    setColor(this.crew, def.workers > 0 && b.staffed < def.workers ? CSS.bad : CSS.ink);
    // Source strings are diffed, so a line shortened by `fit` is not re-rasterised every update.
    const flow = flowLine(model, b, v);
    if (flow !== this.lastFlow) {
      this.lastFlow = flow;
      fit(this.flow, flow);
    }
    const reason = reasonLine(b, statusOf(model, b.uid));
    if (reason.text !== this.lastReason) {
      this.lastReason = reason.text;
      fit(this.status, reason.text);
    }
    setColor(this.status, reason.bad ? CSS.bad : CSS.inkSoft);

    const up = model.upgradeCost(b.uid);
    this.upgrade.setVisible(!core || up !== null);
    this.upgrade.setLabel(up === null ? 'MAX' : `UPGRADE\n${costLabel(up)}`).setEnabled(up !== null && model.canAfford(up));
    this.upgrade.text.setScale(Math.min(1, 188 / Math.max(1, this.upgrade.text.width)));
    const relay = b.def === 'relay_pylon';
    this.toggle.setVisible(!core);
    this.toggle.setLabel(relay ? (b.pinned ? 'UNPIN' : 'PIN LIT') : b.paused ? 'RESUME' : 'PAUSE');
    this.demolish.setVisible(!core && !(b.def === 'beacon_spire' && v.beaconState === 'charging'));

    const all = upgradeAllPlan(model, b.def);
    const many = !core && all.count > 1;
    const ranged = relay || def.turret !== null;
    const row2 = many || ranged;
    this.upgradeAll.setVisible(many);
    this.upgradeAll.setLabel(`UPGRADE ALL · ${all.count}`).setEnabled(many);
    this.range.setVisible(ranged);
    // Compact (critic2 #5): without the second row the card shrinks to 176 px and stays docked on the tray (y 684-860).
    if (this.compact !== !row2) {
      this.compact = !row2;
      const h = row2 ? CARD.h : CARD.h - ROW2_H;
      paintPlacard(this.plate, CARD.w, h);
      this.plate.setY(CARD.y + h / 2);
      this.swallow.setSize(CARD.w, h);
      this.swallow.input?.hitArea.setTo(0, 0, CARD.w, h);
      this.root.setY(row2 ? 0 : ROW2_H);
    }
  }

  private building(): BuildingInst | null {
    if (this.current === null) return null;
    return this.host.model.buildings.get(this.current) ?? null;
  }

  private onUpgrade(): void {
    const b = this.building();
    if (b !== null && !this.host.upgrade(b.uid)) this.onUpgradeRefused();
  }

  private onUpgradeRefused(): void {
    const b = this.building();
    if (b === null) return;
    const model = this.host.model;
    const up = model.upgradeCost(b.uid);
    stripNotice(this.host.scene, up === null ? 'Already at its top Mk' : missingLabel(up, model.stock) ?? 'Cannot upgrade now');
  }

  private onToggle(): void {
    const b = this.building();
    if (b === null) return;
    if (b.def === 'relay_pylon') this.host.setPinned(b.uid, !b.pinned);
    else this.host.setPaused(b.uid, !b.paused);
    this.update(this.host.view());
  }

  private onDemolish(): void {
    const b = this.building();
    if (b === null) return;
    this.host.select(null);
    this.host.demolish(b.uid);
  }

  private onUpgradeAll(): void {
    const b = this.building();
    if (b === null) return;
    const model = this.host.model;
    const plan = upgradeAllPlan(model, b.def);
    if (feEquivalent(plan.total) <= UPGRADE_ALL_CONFIRM_FE) {
      if (this.host.upgradeAll(b.def) === 0) stripNotice(this.host.scene, missingLabel(plan.total, model.stock) ?? 'Nothing to upgrade');
      return;
    }
    this.host.holdClock(true);
    const release = (): void => {
      this.host.holdClock(false);
    };
    const name = buildingDef(b.def).name;
    confirmDialog(this.host.scene, {
      title: 'UPGRADE ALL?',
      body: `${plan.count} × ${name}\nTotal ${costLabel(plan.total)}\nCheapest first, while stock lasts.`,
      confirmLabel: 'CONFIRM',
      onConfirm: () => {
        release();
        const n = this.host.upgradeAll(b.def);
        if (n === 0) stripNotice(this.host.scene, missingLabel(plan.total, model.stock) ?? 'Nothing to upgrade');
      },
      onCancel: release,
    });
  }

  destroy(): void {
    uiState(this.host.scene).cardUid = null;
    this.upgrade.destroy();
    this.toggle.destroy();
    this.demolish.destroy();
    this.upgradeAll.destroy();
    this.range.destroy();
    if (this.root.scene) this.root.destroy();
  }
}

/** Every building of `def` below its top Mk and the summed next-Mk cost. */
function upgradeAllPlan(model: ColonyState, def: BuildingId): { count: number; total: Stock } {
  const total: Stock = {};
  let count = 0;
  for (const b of model.buildings.values()) {
    if (b.def !== def) continue;
    const up = model.upgradeCost(b.uid);
    if (up === null) continue;
    count += 1;
    for (const g of GOODS) {
      const n = up[g];
      if (n !== undefined) total[g] = (total[g] ?? 0) + n;
    }
  }
  return { count, total };
}

const GOOD_NAME = { ferrite: 'Fe', ice: 'Ice', aurelite: 'Aurelite', rations: 'Rations', alloy: 'Alloy', prism: 'Prism', cell: 'Cells' } as const;

/** Sets a line that never shrinks below the 22 px floor: past the card width it is shortened with an ellipsis. */
function fit(t: Phaser.GameObjects.Text, text: string): void {
  const max = CARD.w - 48;
  t.setText(text);
  let s = text;
  while (s.length > 4 && t.width > max) {
    s = s.slice(0, -2).trimEnd();
    t.setText(`${s}…`);
  }
}

/** What the building draws and makes per second at its current rate ("−2.00 Fe/s → +1.00 Alloy/s"), or what it does. */
function flowLine(model: ColonyState, b: BuildingInst, v: ColonyView): string {
  const def = buildingDef(b.def);
  const hp = `hp ${Math.ceil(b.hp)}/${Math.round(b.maxHp)}`;
  if (b.def === 'beacon_spire') {
    return v.beaconState === 'charging' ? `CHARGING ${Math.floor(v.beaconCharge * 100)} % · ${hp}` : `Cells ${Math.floor(v.stock.cell)}/${v.cellsNeeded} to charge · ${hp}`;
  }
  if (def.recipe !== null) {
    const perCycle = rateOf(model, b) / def.recipe.cycleSec;
    const side = (st: Stock, sign: string): string => {
      let out = '';
      for (const g of GOODS) {
        const n = st[g];
        if (n === undefined || n <= 0) continue;
        out += `${out === '' ? '' : ' '}${sign}${(n * perCycle).toFixed(2)} ${GOOD_NAME[g]}/s`;
      }
      return out;
    };
    const ins = side(def.recipe.inputs, '−');
    const outs = side(def.recipe.outputs, '+');
    const purity = def.deposit !== null ? ` · purity ×${COLONY_TUNING.production.purityMul[b.purity]}` : '';
    return `${ins === '' ? '' : `${ins} → `}${outs}${purity}`;
  }
  if (def.turret !== null) return `Range ${def.turret.rangeTiles} · ${def.turret.damage} dmg / ${def.turret.cooldownSec}s · ${hp}`;
  if (b.def === 'relay_pylon') return `${b.pinned ? 'Pinned: never shed' : 'Sheds first in a brownout'} · ${hp}`;
  if (def.beds > 0) return `${def.beds} beds · ${v.colonists}/${v.beds} colonists · ${hp}`;
  if (def.kwOut > 0) return `+${def.kwOut} kW${def.dayOnly ? ' by day' : ''}${def.kw > 0 ? ` · −${def.kw} kW` : ''} · ${hp}`;
  return def.kw > 0 ? `−${def.kw} kW · ${hp}` : hp;
}

/** Why the building is (not) working and the one thing that fixes it (`statusOf`, PRD §5.1 staffing order). */
function reasonLine(b: BuildingInst, st: BuildingStatus | null): { text: string; bad: boolean } {
  const hp = `hp ${Math.ceil(b.hp)}/${Math.round(b.maxHp)}`;
  const good = st?.good !== null && st?.good !== undefined ? GOOD_NAME[st.good] : '';
  const prio = st?.priority != null ? ` · crew priority #${st.priority}` : '';
  switch (st?.reason ?? 'working') {
    case 'paused':
      return { text: 'PAUSED — tap RESUME', bad: true };
    case 'dark':
      return { text: b.shed ? 'SHED in a brownout — add power or a Charge Bank' : 'DARK — outside the grid: extend with a Relay', bad: true };
    case 'frozen':
      return { text: 'FROZEN — relight it before dawn', bad: true };
    case 'unstaffed-no-colonists':
      return { text: `No free colonists — ${st?.arrivalsAtDawn ?? 0} arrive at dawn${prio}`, bad: true };
    case 'unstaffed-no-beds':
      return { text: `No beds — build a Hab Dome for more colonists${prio}`, bad: true };
    case 'unstaffed-waking':
      return { text: `Crew waking — staffed shortly${prio}`, bad: true };
    case 'input-short':
      return { text: `Waiting for ${good} — build its extractor`, bad: true };
    case 'input-reserve':
      return { text: `Waiting: keeping ${Math.round(st?.reserve ?? 0)} ${good} for ${st?.reserveFor != null ? buildingDef(st.reserveFor).name : 'building'}`, bad: true };
    case 'shed':
      return { text: 'SHED by the brownout — back when power allows', bad: true };
    case 'storage-full':
      return { text: `${good} storage full — ship an order or build a Cargo Silo`, bad: true };
    case 'working':
      return { text: b.def === 'lander_core' ? `Powers, heats and stores the colony · ${hp}` : `Working${st !== null && st.seats > 0 ? ` · crew ${st.staffed}/${st.seats}` : ''} · ${hp}`, bad: false };
  }
}
