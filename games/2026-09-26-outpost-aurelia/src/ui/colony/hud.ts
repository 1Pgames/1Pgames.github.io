import Phaser from 'phaser';
import { CSS, PALETTE } from '../../config';
import { GOODS, GOOD_SHORT, buildingDef, type GoodId } from '../../slices/colony/content';
import type { ColonyUiHost, ColonyView, ColonyWidget } from '../../slices/colony/contracts';
import { COLONY_TUNING } from '../../slices/colony/tuning';
import { label, tapZone } from '../widgets';
import { claimSheet, releaseSheet, stripNotice, uiState } from './bridge';
import { openSheet } from '../sheet';
import { CHROME, Control, UI_DEPTH, capsule, costLabel, icon, missingLabel, pin, placard, setColor, setText } from './theme';

/**
 * Status + Banner bands (interface-direction §5): ResourceStrip (x 40, y 144,
 * 448 × 84: 2 rows × 4 capsule chips 106 × 38), TimeControls (II at 496,144 and
 * ×1/×2 at 592,144, 88 × 88) and SolBanner (x 40, y 240, 640 × 88: dial,
 * sol/phase, weather/colonists, the Beacon objective (tap → its explanation),
 * ORBIT 96 × 88). Nothing in the host-shell corner (x < 315,
 * y < 75). Net kW + tonight's forecast live on the ContextStrip power row.
 */
const STRIP = { x: 40, y: 144, chipW: 106, chipH: 38, gap: 8 } as const;
const CHIP_ORDER: ReadonlyArray<GoodId | 'cap'> = ['ferrite', 'ice', 'aurelite', 'rations', 'alloy', 'prism', 'cell', 'cap'];
/** Goods whose chip carries the trend mark (PRD §14: raw goods + rations show the stall). */
const TREND: ReadonlySet<GoodId> = new Set<GoodId>(['ferrite', 'ice', 'aurelite', 'rations']);
const BANNER = { x: 40, y: 240, w: 640, h: 88 } as const;
const DIAL = { cx: 84, cy: 284, r: 34 } as const;
const PHASE_NAME = { day: 'DAY', dusk: 'DUSK', night: 'NIGHT', 'long-night': 'LONG NIGHT' } as const;

interface Chip {
  key: GoodId | 'cap';
  value: Phaser.GameObjects.Text;
  trend: Phaser.GameObjects.Text | null;
  last: number;
  lastTrend: number;
  lastFull: boolean;
}

export class ColonyHud implements ColonyWidget {
  private readonly host: ColonyUiHost;
  private readonly root: Phaser.GameObjects.Container;
  private readonly chips: Chip[] = [];
  private readonly pause: Control;
  private readonly speed: Control;
  private readonly orbit: Control;
  private readonly orbitBadge: Phaser.GameObjects.Container;
  private readonly orbitCount: Phaser.GameObjects.Text;
  private readonly line1: Phaser.GameObjects.Text;
  private readonly line2: Phaser.GameObjects.Text;
  /** The Beacon objective tracker (critic build1: goal clarity from sol 1). */
  private readonly line3: Phaser.GameObjects.Text;
  private lastGoal = '';
  private readonly dial: Phaser.GameObjects.Graphics;
  private readonly dialSol: Phaser.GameObjects.Text;
  private lastSec = -1;
  private lastPhase = '';
  private lastSol = -1;
  private lastLine2 = '';
  /** Core HP readout (critic build2: no core HP anywhere). */
  private readonly core: Phaser.GameObjects.Text;
  private lastCorePct = -1;
  /** "−N colonists" flash when colonists die (in-run loss signal). */
  private readonly lost: Phaser.GameObjects.Text;
  private lostTween: Phaser.Tweens.Tween | null = null;
  private lastColonists = -1;
  private phaseMax = 1;
  private lastDialStep = -1;
  private lastOrbit = -2;
  private lastSpeed = 0;
  private lastLocked: boolean | null = null;

  constructor(host: ColonyUiHost) {
    this.host = host;
    const scene = host.scene;
    this.root = scene.add.container(0, 0).setDepth(UI_DEPTH.hud);

    // ResourceStrip: one tap target (→ Ledger) under eight inert chips.
    const strip = tapZone(scene, STRIP.x, STRIP.y, 448, 84, () => host.openSheet('ledger'), true);
    this.root.add(strip);
    CHIP_ORDER.forEach((key, i) => {
      const x = (i % 4) * (STRIP.chipW + STRIP.gap);
      const y = Math.floor(i / 4) * (STRIP.chipH + STRIP.gap);
      strip.add(capsule(scene, x, y, STRIP.chipW, STRIP.chipH));
      const img = key === 'cap' ? null : icon(scene, key, 30);
      if (img !== null) strip.add(img.setPosition(x + 21, y + STRIP.chipH / 2));
      const value = label(scene, key === 'cap' ? x + 12 : x + 36, y + STRIP.chipH / 2, key === 'cap' ? '▣ 0' : '0', { size: 24, bold: true, origin: [0, 0.5] });
      const trend = key !== 'cap' && TREND.has(key) ? label(scene, x + STRIP.chipW - 8, y + STRIP.chipH / 2, '', { size: 18, bold: true, origin: [1, 0.5] }) : null;
      strip.add(trend === null ? value : [value, trend]);
      this.chips.push({ key, value, trend, last: -1, lastTrend: 2, lastFull: false });
    });


    // TimeControls.
    this.pause = new Control(scene, 496, 144, 88, 88, 'II', 'secondary', () => host.togglePause(), { size: 34 });
    this.speed = new Control(scene, 592, 144, 88, 88, '×1', 'secondary', () => host.setSpeed(host.speed === 2 ? 1 : 2), { size: 30 });

    // SolBanner.
    this.root.add(placard(scene, BANNER.x, BANNER.y, BANNER.w, BANNER.h));
    this.dial = scene.add.graphics();
    this.dialSol = label(scene, DIAL.cx, DIAL.cy, '1', { size: 30, bold: true, origin: [0.5, 0.5] });
    // The banner's text area is the Beacon objective's tap target (→ the goal explained); ORBIT sits above it.
    const goalZone = tapZone(scene, 128, BANNER.y, 452, BANNER.h, () => openBeaconSheet(host), true);
    this.line1 = label(scene, 136, BANNER.y + 4, '', { size: 26, bold: true });
    this.core = label(scene, 136, BANNER.y + 34, '', { size: 22, bold: true, color: CSS.ink });
    this.line2 = label(scene, 136, BANNER.y + 34, '', { size: 22, color: CSS.inkSoft });
    this.lost = label(scene, 572, BANNER.y + 6, '', { size: 24, bold: true, color: CSS.bad, origin: [1, 0] }).setAlpha(0.001);
    this.line3 = label(scene, 136, BANNER.y + 60, '', { size: 22, color: CSS.accent });
    this.root.add([goalZone, this.dial, this.dialSol, this.line1, this.core, this.line2, this.line3, this.lost]);
    this.orbit = new Control(scene, 584, 240, 96, 88, 'ORBIT', 'secondary', () => host.openSheet('orders'), { size: 22 });
    this.orbitCount = label(scene, 0, 0, '', { size: 22, bold: true, color: `#${PALETTE.bgDeep.toString(16).padStart(6, '0')}`, origin: [0.5, 0.5] });
    const badgeBg = scene.add.circle(0, 0, 16, PALETTE.primary).setStrokeStyle(2, PALETTE.bgDeep);
    this.orbitBadge = scene.add.container(90, 6, [badgeBg, this.orbitCount]).setVisible(false);
    this.orbit.root.add(this.orbitBadge);

    this.root.add([this.pause.root, this.speed.root, this.orbit.root]);
    pin(this.root);
    this.update(host.view());
  }

  update(v: ColonyView): void {
    this.syncChips(v);
    this.syncControls();
    this.syncBanner(v);
  }

  private syncChips(v: ColonyView): void {
    let anyFull = false;
    for (const g of GOODS) if (v.caps[g] > 0 && v.stock[g] >= 0.9 * v.caps[g]) anyFull = true;
    for (const chip of this.chips) {
      if (chip.key === 'cap') {
        const cap = v.caps.ferrite;
        if (cap !== chip.last) {
          chip.last = cap;
          setText(chip.value, `▣ ${cap}`);
        }
        if (anyFull !== chip.lastFull) {
          chip.lastFull = anyFull;
          setColor(chip.value, anyFull ? CSS.primary : CSS.ink);
        }
        continue;
      }
      const n = Math.floor(v.stock[chip.key]);
      if (n !== chip.last) {
        chip.last = n;
        setText(chip.value, n >= 10000 ? `${Math.floor(n / 1000)}k` : `${n}`);
        // Never run into the trend mark: fit the numeral into the space left of it.
        // Numeral x+36 … trend mark x+84: 4 px clear of the ▲/▼ (critic: digit/arrow overlap).
        const room = STRIP.chipW - 36 - (chip.trend === null ? 8 : 26);
        chip.value.setScale(Math.min(1, room / Math.max(1, chip.value.width)));
      }
      const full = v.caps[chip.key] > 0 && v.stock[chip.key] >= v.caps[chip.key];
      if (full !== chip.lastFull) {
        chip.lastFull = full;
        setColor(chip.value, full ? CSS.primary : CSS.ink);
      }
      if (chip.trend !== null) {
        // PRD §14: net rate ≤ 0.0 (1 decimal) is the visible stall → rust ▼.
        const r = Math.round(v.rates[chip.key] * 10);
        const t = r > 0 ? 1 : r < 0 ? -1 : 0;
        if (t !== chip.lastTrend) {
          chip.lastTrend = t;
          setText(chip.trend, t > 0 ? '▲' : '▼');
          setColor(chip.trend, t > 0 ? CSS.good : CSS.bad);
        }
      }
    }
  }

  private syncControls(): void {
    const s = uiState(this.host.scene);
    // Draft / pausing coach already hold the clock: II is refused (dim + deaf), §14b matrix.
    this.pause.setEnabled(!s.draftOpen && !s.coachOwner);
    for (const [c, n] of [[this.pause, 'HUD II'], [this.speed, 'HUD speed']] as const) {
      const v = c.checkLive(n);
      if (v !== null) console.warn(`colony ui invariant: ${v}`);
    }
    if (this.host.speed !== this.lastSpeed) {
      this.lastSpeed = this.host.speed;
      this.speed.setLabel(this.host.speed === 2 ? '×2' : '×1').setKind(this.host.speed === 2 ? 'primary' : 'secondary');
    }
  }

  private syncBanner(v: ColonyView): void {
    const sec = Math.max(0, Math.ceil(v.phaseLeftSec));
    if (v.phase !== this.lastPhase) {
      this.lastPhase = v.phase;
      this.phaseMax = Math.max(1, v.phaseLeftSec);
      this.lastDialStep = -1;
    }
    this.phaseMax = Math.max(this.phaseMax, v.phaseLeftSec);
    if (sec !== this.lastSec || v.sol !== this.lastSol) {
      this.lastSec = sec;
      setText(this.line1, `SOL ${v.sol} · ${PHASE_NAME[v.phase]} ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
    }
    if (v.sol !== this.lastSol) {
      this.lastSol = v.sol;
      setText(this.dialSol, `${v.sol}`);
    }
    // Ring = share of the current phase elapsed, in 2 % steps (redrawn ≤ 50 times a phase).
    const step = Math.round((1 - v.phaseLeftSec / this.phaseMax) * 50);
    if (step !== this.lastDialStep) {
      this.lastDialStep = step;
      const day = v.phase === 'day' || v.phase === 'dusk';
      this.dial.clear();
      this.dial.lineStyle(8, CHROME.dialTrack, 1);
      this.dial.strokeCircle(DIAL.cx, DIAL.cy, DIAL.r);
      if (step > 0) {
        this.dial.lineStyle(8, day ? PALETTE.primary : CHROME.dialNight, 1);
        this.dial.beginPath();
        this.dial.arc(DIAL.cx, DIAL.cy, DIAL.r, -Math.PI / 2, -Math.PI / 2 + (step / 50) * Math.PI * 2, false);
        this.dial.strokePath();
      }
    }
    // By day the site offset is `tempC − dayC`, so tonight's temperature is exact before dusk.
    const T = COLONY_TUNING.temp;
    const day = v.phase === 'day' || v.phase === 'dusk';
    const tonight = day ? T.nightBaseC + T.perSolC * (v.sol - 1) + (v.tempC - T.dayC) : v.tempC;
    const line2 = `${day ? 'Tonight' : 'Now'} ${String(Math.round(tonight)).replace('-', '−')} °C · ${v.colonists}/${v.beds} crew · ♥ ${Math.round(v.morale)}`;
    const core = this.host.model.core;
    const pct = core === undefined ? 0 : Math.max(0, Math.ceil((core.hp / Math.max(1, core.maxHp)) * 100));
    const coreMoved = pct !== this.lastCorePct;
    if (coreMoved) {
      this.lastCorePct = pct;
      setText(this.core, `Core ${pct}% ·`);
      setColor(this.core, pct < 50 ? CSS.bad : pct < 100 ? CSS.primary : CSS.ink);
    }
    if (this.lastColonists >= 0 && v.colonists < this.lastColonists) this.flashLost(this.lastColonists - v.colonists);
    this.lastColonists = v.colonists;
    if (line2 !== this.lastLine2 || coreMoved) {
      this.lastLine2 = line2;
      setText(this.line2, line2);
      this.line2.setX(this.core.x + this.core.width + 8);
      this.line2.setScale(Math.min(1, (580 - this.line2.x) / Math.max(1, this.line2.width / this.line2.scaleX)));
    }
    const goal = beaconGoal(this.host, v);
    if (goal !== this.lastGoal) {
      this.lastGoal = goal;
      setText(this.line3, goal);
      this.line3.setScale(Math.min(1, 440 / Math.max(1, this.line3.width)));
    }
    // ORBIT: dimmed with "Sol N" and deaf before the board opens (§14b edge states).
    const locked = v.sol < COLONY_TUNING.requests.firstSol;
    if (locked !== this.lastLocked) {
      this.lastLocked = locked;
      this.orbit.setLabel(locked ? `Sol ${COLONY_TUNING.requests.firstSol}` : 'ORBIT').setEnabled(!locked);
    }
    let ready = 0;
    for (const o of v.board) if (o.shippable) ready += 1;
    const count = locked ? -1 : ready;
    if (count !== this.lastOrbit) {
      this.lastOrbit = count;
      this.orbitBadge.setVisible(count > 0);
      if (count > 0) setText(this.orbitCount, `${count}`);
    }
  }

  /** Colonists died: a rust "−N crew" flashes at the end of the banner line (1.6 s). */
  private flashLost(n: number): void {
    this.lostTween?.remove();
    // Short enough to sit right of "SOL n · NIGHT m:ss" (line 1 ends ≈ x 450).
    setText(this.lost, `−${n} crew`);
    this.lost.setAlpha(1).setScale(1.25);
    this.lostTween = this.host.scene.tweens.add({ targets: this.lost, scale: 1, alpha: { from: 1, to: 0.001 }, delay: 1200, duration: 400, onComplete: () => (this.lostTween = null) });
  }

  destroy(): void {
    this.lostTween?.remove();
    this.pause.destroy();
    this.speed.destroy();
    this.orbit.destroy();
    if (this.root.scene) this.root.destroy();
  }
}

/** "Alloy 30/100 · Prism 0/20" for the Spire's cost. */
function spireProgress(host: ColonyUiHost, v: ColonyView): string {
  const cost = host.model.costOf('beacon_spire');
  let parts = '';
  for (const g of GOODS) {
    const n = cost[g];
    if (n !== undefined && n > 0) parts += `${parts === '' ? '' : ' · '}${GOOD_SHORT[g]} ${Math.min(n, Math.floor(v.stock[g]))}/${n}`;
  }
  return parts;
}

/** One-line Beacon objective for the banner's third line: the next step toward calling the Ark. */
function beaconGoal(host: ColonyUiHost, v: ColonyView): string {
  const spire = buildingDef('beacon_spire');
  switch (v.beaconState) {
    // Live progress from sol 1 (critic build2 novice: "no live progress numbers"): Spire goods + cells.
    case 'locked':
      return `◈ GOAL sol ${spire.unlockSol} · ${spireProgress(host, v)} · Cells ${Math.floor(v.stock.cell)}/${v.cellsNeeded}`;
    case 'unbuilt':
      return `◈ SPIRE · ${spireProgress(host, v)} · Cells ${Math.floor(v.stock.cell)}/${v.cellsNeeded}`;
    case 'ready':
      return v.stock.cell >= v.cellsNeeded ? '◈ Charge ready — tap BEACON' : `◈ Lumen Cells ${Math.floor(v.stock.cell)}/${v.cellsNeeded} to charge`;
    case 'charging':
      return `◈ Charging ${Math.floor(v.beaconCharge * 100)} % — hold the Spire`;
    case 'launched':
      return '◈ Launched — the Ark is coming';
  }
}

/** Top of the GOAL sheet: buttons + 5 steps end above SAFE.bottom (y 1060). */
const GOAL_TOP = 440;

/** The goal, explained (tap the banner): the four Beacon steps with the live numbers from content + tuning. */
function openBeaconSheet(host: ColonyUiHost): void {
  const scene = host.scene;
  const v = host.view();
  const spire = buildingDef('beacon_spire');
  const B = COLONY_TUNING.beacon;
  const done = (on: boolean): string => (on ? '✓' : '○');
  const built = v.beaconState === 'ready' || v.beaconState === 'charging' || v.beaconState === 'launched';
  const steps: Array<[boolean, string, string]> = [
    [v.sol >= spire.unlockSol, `Survive to sol ${spire.unlockSol}`, 'The Beacon Spire unlocks in the build sheet.'],
    [built, `Build the Beacon Spire · ${costLabel(host.model.costOf('beacon_spire'))}`, 'Alloy from Alloy Smelters, Prism from Prism Cutters.'],
    [built && v.stock.cell >= v.cellsNeeded, `Stock ${v.cellsNeeded} Lumen Cells`, 'Lumen Foundry: 2 Alloy + 1 Prism → 1 Cell.'],
    [v.beaconState === 'charging' || v.beaconState === 'launched', `Tap BEACON · ${B.chargeKw} kW for ${B.chargeSec} s`, 'Every edge attacks while it charges. Hold the Spire and the Ark lands.'],
  ];
  const sheet = openSheet(scene, { height: 1280 - GOAL_TOP, title: 'GOAL · CALL THE ARK', onClose: () => releaseSheet(scene, sheet) });
  claimSheet(host, 'ledger', sheet);
  // Charge window (critic build4): the Beacon draws `chargeKw` on top of today's load for `chargeSec`.
  const dayMargin = v.kwSupply - v.kwDemand;
  const night = v.kwNightForecast;
  const fmt = (x: number): string => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;
  const shortBy = B.chargeKw - Math.max(dayMargin, night);
  // Banks discharge during the charge: kJ over the charge time is the extra kW they can hold up.
  const bankKw = v.bankKj / Math.max(1, B.chargeSec);
  const covered = shortBy > 0 && shortBy <= bankKw;
  let window: string;
  if (shortBy <= 0) window = ' — enough to charge';
  else if (covered) window = ` — banks cover −${shortBy.toFixed(1)} kW (${Math.round(v.bankKj)} kJ stored)`;
  else window = ` — short ${shortBy.toFixed(1)} kW: add Vent Taps, Sails + Charge Banks`;
  // Never ticked before a Spire stands: the window only matters once there is something to charge.
  steps.push([built && (shortBy <= 0 || covered), `Charge window · needs ${B.chargeKw} kW spare`, `Spare now ${fmt(dayMargin)} kW · tonight ${fmt(night)} kW${window}`]);
  // The two BUILD buttons lead the sheet (under the title); the steps follow, ending above SAFE (y 1060).
  let y = 190;
  for (const [ok, head, body] of steps) {
    const h = label(scene, 96, y, head, { size: 24, bold: true, wrap: 560 });
    const t = label(scene, 96, y + h.height + 6, body, { size: 22, color: CSS.inkSoft, wrap: 560 });
    sheet.content.add([label(scene, 48, y, done(ok), { size: 30, bold: true, color: ok ? CSS.good : CSS.accent }), h, t]);
    y += h.height + t.height + 30;
  }
  // One-tap arms for the two win-condition buildings (critic final #3), refused with a reason when not yet possible.
  const arm = (id: 'beacon_spire' | 'lumen_foundry'): void => {
    const d = buildingDef(id);
    const m = host.model;
    if (d.unlockSol > m.clock.sol) {
      stripNotice(scene, `${d.name} unlocks on sol ${d.unlockSol}`);
      return;
    }
    if (!m.canAfford(m.costOf(id))) {
      host.want(id);
      stripNotice(scene, `${missingLabel(m.costOf(id), m.stock) ?? 'Not enough stock'} for ${d.name} — saving for it`, 2400);
      sheet.close();
      return;
    }
    sheet.close();
    host.arm(id);
  };
  const by = 84;
  const spireBtn = new Control(scene, 40, GOAL_TOP + by, 310, 88, 'BUILD SPIRE', built ? 'secondary' : 'primary', () => arm('beacon_spire'), { size: 24 });
  const foundryBtn = new Control(scene, 370, GOAL_TOP + by, 310, 88, 'BUILD FOUNDRY', 'secondary', () => arm('lumen_foundry'), { size: 24 });
  spireBtn.setEnabled(!built);
  for (const c of [spireBtn, foundryBtn]) sheet.content.add(c.root.setPosition(c.root.x, c.root.y - GOAL_TOP).setScrollFactor(1, 1, true));
}
