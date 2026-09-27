import Phaser from 'phaser';
import { CSS, PALETTE, VIEW } from '../config';
import { sfx } from '../core/audio';
import { countTo } from '../core/juice';
import { SCENES } from '../core/keys';
import { startMusic } from '../core/music';
import { track } from '../core/telemetry';
import type { LandingResult, LandingSetup } from '../slices/colony/contracts';
import { SITES } from '../slices/colony/content';
import { COLONY_TUNING } from '../slices/colony/tuning';
import { addBackground } from '../ui/background';
import { Control, icon, paintPlacard } from '../ui/colony/theme';
import { enterPinningHitArea } from '../ui/entrance';
import { label, num } from '../ui/widgets';
import { landingSetup } from './hub/landing';

/**
 * Landing results (PRD §14 Results, §14b law 5 step 6): DISPLAY ONLY. Data,
 * stars, rungs, stats and the daily best were banked by `settleLanding` /
 * `settlePendingLanding` (model/score.ts) before this scene started — this
 * scene never banks. Headline per reason, sols, colonists saved/lost, the
 * Data rows, stars, the new rung; primary CTA matches the outcome (loss →
 * RETRY same site/rung/kit/seed; win → NEXT RUNG when one opened, else LAND
 * AGAIN) and HUB, both 300 × 100 at y 944 (interface-direction §5).
 */
export interface GameOverData {
  result: LandingResult;
  /** The Landing to replay on RETRY (a reload-settled result carries the setup stored in its checkpoint). */
  setup: LandingSetup;
  /** Settled from a reload checkpoint (headline ABANDONED, "Signal lost"). */
  recovered: boolean;
}

const HEADLINE: Record<string, string> = {
  beacon: 'LAUNCHED',
  'core-lost': 'CORE LOST',
  'colony-lost': 'COLONY LOST',
  frozen: 'FROZEN',
  abandoned: 'ABANDONED',
};
const SUBLINE: Record<string, string> = {
  beacon: 'The Ark heard the Spire. The colony is going home.',
  'core-lost': 'The Lander Core fell. The lights went out.',
  'colony-lost': 'No one left to keep the lamps lit.',
  frozen: 'The long night outlasted the grid.',
  abandoned: 'Landing abandoned — the Ark banks what it saw.',
};
const PANEL = { x: 40, y: 330, w: 640, h: 590 } as const;
const ARMOUR = { color: '#1a1418', thick: 6 } as const;

export class GameOverScene extends Phaser.Scene {
  /** The settled result on screen (cert adapter reads it). */
  result: LandingResult | null = null;
  private setup: LandingSetup | null = null;
  private recovered = false;
  private leaving = false;
  private onEsc: (() => void) | null = null;

  constructor() {
    super(SCENES.gameOver);
  }

  init(result: GameOverData): void {
    this.result = result.result;
    this.setup = result.setup;
    this.recovered = result.recovered;
  }

  create(): void {
    this.leaving = false;
    const r = this.result;
    const setup = this.setup;
    if (r === null || setup === null) {
      this.scene.start(SCENES.hub, {});
      return;
    }
    if (!this.recovered) track(r.won ? 'win' : 'loss');
    startMusic('menu');
    addBackground(this, false);
    // Results scrim (interface-direction §4): bgDeep 0.2 at the top → 0.75 behind the button band.
    const grad = this.add.graphics().setDepth(-150);
    grad.fillGradientStyle(PALETTE.bgDeep, PALETTE.bgDeep, PALETTE.bgDeep, PALETTE.bgDeep, 0.2, 0.2, 0.75, 0.75);
    grad.fillRect(0, 0, VIEW.width, VIEW.height);

    const siteName = SITES.find((s) => s.id === r.siteId)?.name ?? r.siteId;
    const headline = HEADLINE[r.reason] ?? r.reason.toUpperCase();
    const head = label(this, VIEW.width / 2, 196, headline, { size: 64, bold: true, color: r.won ? CSS.primary : CSS.bad, origin: [0.5, 0.5] });
    head.setStroke(ARMOUR.color, ARMOUR.thick).setShadow(0, 2, ARMOUR.color, 0, true, true);
    const subText = this.recovered ? `Signal lost — settled at sol ${r.solsSurvived}` : (SUBLINE[r.reason] ?? '');
    const sub = label(this, VIEW.width / 2, 262, `${siteName} · rung ${r.rung}${setup.daily ? ' · DAILY' : ''}\n${subText}`, { size: 24, align: 'center', origin: [0.5, 0.5] });
    sub.setStroke(ARMOUR.color, 4).setShadow(0, 2, ARMOUR.color, 0, true, true);
    this.tweens.add({ targets: head, scale: { from: 1.25, to: 1 }, alpha: { from: 0.001, to: 1 }, duration: 320, ease: 'Back.easeOut' });

    // Painted once the rows are laid out, so the plate hugs its content.
    const plate = this.add.graphics().setDepth(-1);
    let y = PANEL.y + 36;
    const row = (left: string, right: string, color: string = CSS.ink, size = 26): Phaser.GameObjects.Text => {
      label(this, PANEL.x + 28, y, left, { size, bold: true, origin: [0, 0.5] });
      const t = label(this, PANEL.x + PANEL.w - 28, y, right, { size, bold: true, color, origin: [1, 0.5] });
      y += size + 16;
      return t;
    };
    row('Sols survived', `${r.solsSurvived} / ${COLONY_TUNING.sol.count}`);
    row('Colonists saved', `${r.colonistsSaved}`, CSS.good);
    row('Colonists lost', `${r.colonistsLost}`, r.colonistsLost > 0 ? CSS.bad : CSS.inkSoft);
    y += 6;
    const d = r.data;
    const parts: Array<[string, number]> = [
      ['Landing', d.base],
      ['Sols', d.sols],
      ['Launch', d.win],
      ['Orders', d.orders],
      ['Relics', d.relics],
      ['Trophies', d.trophies],
    ];
    for (const [name, v] of parts) if (v > 0) row(name, `+${num(v)}`, CSS.inkSoft, 22);
    if (d.mul !== 1) row('Multiplier', `×${d.mul.toFixed(2)}`, CSS.inkSoft, 22);
    y += 8;
    const dataIcon = icon(this, 'data', 40);
    dataIcon?.setPosition(PANEL.x + 48, y);
    label(this, PANEL.x + 80, y, r.practice ? 'DATA · PRACTICE' : 'DATA', { size: 30, bold: true, color: CSS.accent, origin: [0, 0.5] });
    const total = label(this, PANEL.x + PANEL.w - 28, y, '0', { size: 40, bold: true, color: r.practice ? CSS.inkSoft : CSS.accent, origin: [1, 0.5] });
    // A replayed daily shows what it earned but banks none of it (PRD §9: one paid daily per day).
    if (r.practice) total.setText(`${num(d.total)} · not banked`).setFontSize(28);
    else countTo(this, total, 0, d.total, 700, (v) => `+${num(v)}`);
    y += 60;

    // Stars: three discs, the earned ones pop in.
    for (let i = 0; i < 3; i += 1) {
      const on = i < r.stars;
      const star = label(this, VIEW.width / 2 - 80 + i * 80, y, on ? '★' : '☆', { size: 56, bold: true, color: on ? CSS.primary : CSS.inkSoft, origin: [0.5, 0.5] });
      if (on) this.tweens.add({ targets: star, scale: { from: 0.2, to: 1 }, delay: 420 + i * 160, duration: 260, ease: 'Back.easeOut' });
    }
    y += 52;
    const extra: string[] = [];
    if (r.newStars > 0) extra.push(`+${r.newStars} new ★`);
    if (r.unlockedRung !== null) extra.push(`Rung ${r.unlockedRung} opened`);
    if (setup.daily) extra.push(r.practice ? 'Daily replay — practice, no Data' : 'Daily Landing');
    if (extra.length > 0) {
      label(this, VIEW.width / 2, y, extra.join(' · '), { size: 24, bold: true, color: CSS.accent, origin: [0.5, 0.5] });
      y += 30;
    }
    const plateH = Math.min(PANEL.h, y - PANEL.y + 12);
    plate.setPosition(PANEL.x + PANEL.w / 2, PANEL.y + plateH / 2);
    paintPlacard(plate, PANEL.w, plateH);

    // CTA matches the outcome (AGENTS: never RETRY as the primary on a win).
    const next = r.won && r.unlockedRung !== null;
    const primaryLabel = r.won ? (next ? 'NEXT RUNG' : 'LAND AGAIN') : 'RETRY';
    const primary = new Control(this, 40, 944, 300, 100, primaryLabel, 'primary', () => {
      if (!r.won) track('retry');
      const again: LandingSetup = next
        ? landingSetup({ site: setup.site, rung: r.unlockedRung ?? setup.rung, kit: setup.kit, daily: false, ftue: false })
        : r.won
          ? landingSetup({ site: setup.site, rung: setup.rung, kit: setup.kit, daily: setup.daily, ftue: false })
          : { ...setup, ftue: false };
      this.leave(SCENES.game, { setup: again });
    }, { size: 30 });
    const hub = new Control(this, 380, 944, 300, 100, 'HUB', 'secondary', () => this.leave(SCENES.hub, {}), { size: 30 });
    enterPinningHitArea(this, primary.root, { delayMs: 120, distance: 60, durationMs: 300 });
    enterPinningHitArea(this, hub.root, { delayMs: 180, distance: 60, durationMs: 300 });

    this.onEsc = (): void => this.leave(SCENES.hub, {});
    this.input.keyboard?.on('keydown-ESC', this.onEsc);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.onEsc !== null) this.input.keyboard?.off('keydown-ESC', this.onEsc);
      this.onEsc = null;
    });
    sfx(r.won ? 'launch' : 'loss', { volume: 0.5 });
    this.cameras.main.fadeIn(220, 0, 0, 0);
  }

  private leave(key: string, data: object): void {
    if (this.leaving) return;
    this.leaving = true;
    this.cameras.main.fadeOut(180, 0, 0, 0);
    this.time.delayedCall(180, () => this.scene.start(key, data));
  }
}
