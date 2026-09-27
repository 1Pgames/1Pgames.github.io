import Phaser from 'phaser';
import { CSS, PALETTE, VIEW } from '../../config';
import { sfx, unlockAudio } from '../../core/audio';
import { SCENES } from '../../core/keys';
import { startMusic } from '../../core/music';
import { loadMeta } from '../../core/progression';
import { track } from '../../core/telemetry';
import { ARK_NODES, refitCost } from '../../slices/colony/content';
import type { LandingSetup } from '../../slices/colony/contracts';
import { settlePendingLanding } from '../../slices/colony/model/score';
import { addBackground } from '../../ui/background';
import { icon } from '../../ui/colony/theme';
import { closeAllOverlays, openSettingsSheet } from '../../ui/sheet';
import { TabBar, TAB_BAR, type TabSpec } from '../../ui/tabBar';
import { label, num, tapZone } from '../../ui/widgets';
import type { GameOverData } from '../gameover';
import { buildArkTab, nodeState } from './arkTab';
import { buildLandTab } from './landTab';
import { ftueSetup, landingLog } from './landing';
import { buildLogTab } from './logTab';
import { ICON } from '../../data/art';

/**
 * The hub (PRD §14 Hub, §14b HubEntry + laws 6-7): LAND / ARK / LOG on the
 * template TabBar (interface-direction: tabs at y 964-1056) with the settings
 * gear 88 × 88 at its right end (inside SAFE), the Data chip top-right; nothing
 * in the shell corner.
 * `create()` first settles a pending `colony:activeLanding` checkpoint
 * (→ GameOver, ABANDONED) and auto-starts the first-ever Landing (0 taps).
 */
export type HubTabId = 'land' | 'ark' | 'log';

export interface HubData {
  tab?: HubTabId;
  /** Set after RESET SAVE: stay on the hub instead of auto-starting Landing 1. */
  stay?: boolean;
}

/** What a tab gets from the hub. */
export interface HubApi {
  goTab(id: HubTabId): void;
  refreshChrome(): void;
  launch(setup: LandingSetup): void;
}

export interface HubTab {
  destroy(): void;
}

const TAB_Y = 964;
const FADE_MS = 180;
/** Tab icons are cells of the Ark icon sheet (`art/wiring.md` icons-ark). */
const TABS: ReadonlyArray<TabSpec<HubTabId>> = [
  { id: 'land', label: 'LAND', icon: ICON['ark-sur'].key, frame: ICON['ark-sur'].frame },
  { id: 'ark', label: 'ARK', icon: ICON['ark-ship'].key, frame: ICON['ark-ship'].frame },
  { id: 'log', label: 'LOG', icon: ICON['ark-cmd'].key, frame: ICON['ark-cmd'].frame },
];
/** Settings gear: the right end of the tab band, inside SAFE (the tabs share the rest). */
const GEAR = { x: 592, y: TAB_Y, size: 88 } as const;

export class HubScene extends Phaser.Scene {
  private tabBar!: TabBar<HubTabId>;
  private tab: HubTab | null = null;
  private tabId: HubTabId = 'land';
  private dataText!: Phaser.GameObjects.Text;
  private starting = false;
  private onEsc: (() => void) | null = null;

  constructor() {
    super(SCENES.hub);
  }

  create(data: HubData = {}): void {
    this.tab = null;
    this.starting = false;
    this.tabId = data.tab ?? 'land';

    // HubEntry (§14b): a reload mid-Landing is settled (banked by settlePendingLanding) and shown as ABANDONED.
    const pending = settlePendingLanding();
    if (pending !== null) {
      const payload: GameOverData = { result: pending.result, setup: pending.setup, recovered: true };
      this.scene.start(SCENES.gameOver, payload);
      return;
    }
    // Law 7: the first-ever boot skips the hub and lands on Halcyon rung 1 in the same frame.
    if (data.stay !== true && loadMeta().stats.runs === 0 && landingLog().length === 0) {
      track('session-start');
      this.scene.start(SCENES.game, { setup: ftueSetup() });
      return;
    }

    addBackground(this, false);
    // Hub scrim over the backdrop (interface-direction §4: bgDeep 0.35 flat).
    this.add.rectangle(0, 0, VIEW.width, VIEW.height, PALETTE.bgDeep, 0.35).setOrigin(0, 0).setDepth(-150);

    // Data chip (display only, top-right; the shell owns the top-left 315 × 75).
    const chip = this.add.graphics();
    chip.fillStyle(PALETTE.bgDeep, 0.82).fillRoundedRect(340, 52, 236, 64, 32);
    chip.lineStyle(2, 0x3b3040, 1).strokeRoundedRect(340, 52, 236, 64, 32);
    const dIcon = icon(this, 'data', 40);
    dIcon?.setPosition(376, 84);
    this.dataText = label(this, 560, 84, '0', { size: 28, bold: true, color: CSS.accent, origin: [1, 0.5] });
    label(this, 404, 84, 'DATA', { size: 22, bold: true, color: CSS.inkSoft, origin: [0, 0.5] });
    const gear = tapZone(this, GEAR.x, GEAR.y, GEAR.size, GEAR.size, () => openSettingsSheet(this, { onReset: () => this.scene.start(SCENES.hub, { stay: true } satisfies HubData) }));
    const g = this.add.graphics();
    g.fillStyle(PALETTE.bgDeep, 0.85).fillCircle(44, 44, 34);
    g.lineStyle(2, PALETTE.inkSoft, 0.7).strokeCircle(44, 44, 34);
    g.fillStyle(PALETTE.ink, 1);
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      g.fillCircle(44 + Math.cos(a) * 18, 44 + Math.sin(a) * 18, 5);
    }
    g.fillCircle(44, 44, 15);
    g.fillStyle(PALETTE.bgDeep, 1).fillCircle(44, 44, 6);
    gear.add(g);
    gear.setDepth(TAB_BAR.depth + 1);

    this.tabBar = new TabBar<HubTabId>(this, TABS, (id) => this.selectTab(id), GEAR.x);
    // Interface-direction §5 moves the bar up into SAFE: y 964 instead of the template's bottom 160.
    this.tabBar.root.setY(TAB_Y - (VIEW.height - TAB_BAR.height));
    // Nothing interactive below SAFE (y 1060): the tabs' hit rects shrink to the 96 px band (QA#4); the plate below stays inert.
    for (const child of this.tabBar.root.list) {
      const hit = (child as Phaser.GameObjects.Container).input?.hitArea as unknown;
      if (hit instanceof Phaser.Geom.Rectangle) hit.height = Math.min(hit.height, 1060 - TAB_Y);
    }

    this.onEsc = (): void => {
      if (this.tabId !== 'land') this.selectTab('land');
    };
    this.input.keyboard?.on('keydown-ESC', this.onEsc);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.onEsc !== null) this.input.keyboard?.off('keydown-ESC', this.onEsc);
      this.onEsc = null;
      this.tab?.destroy();
      this.tab = null;
      this.tabBar.destroy();
    });
    this.input.once(Phaser.Input.Events.POINTER_DOWN, () => unlockAudio());
    startMusic('menu');
    this.selectTab(this.tabId, true);
    this.cameras.main.fadeIn(FADE_MS, 0, 0, 0);
  }

  private api(): HubApi {
    return {
      goTab: (id) => this.selectTab(id),
      refreshChrome: () => this.refreshChrome(),
      launch: (setup) => this.launch(setup),
    };
  }

  private selectTab(id: HubTabId, force = false): void {
    if (!force && id === this.tabId && this.tab !== null) return;
    // Tab change closes every sheet / toast (the ARK UNDO toast dies here, purchase stands — §14b edge states).
    closeAllOverlays(this);
    this.tab?.destroy();
    this.tabId = id;
    this.tabBar.select(id);
    const api = this.api();
    this.tab = id === 'land' ? buildLandTab(this, api) : id === 'ark' ? buildArkTab(this, api) : buildLogTab(this, api);
    this.refreshChrome();
  }

  private refreshChrome(): void {
    const meta = loadMeta();
    this.dataText.setText(num(meta.currency));
    const affordable = ARK_NODES.some((n) => nodeState(meta, n) === 'buyable') || (ARK_NODES.every((n) => meta.unlocks.includes(n.id)) && meta.currency >= refitCost(meta.upgrades.refit ?? 0));
    this.tabBar.setBadge('ark', affordable && this.tabId !== 'ark');
  }

  private launch(setup: LandingSetup): void {
    if (this.starting) return;
    this.starting = true;
    track(setup.daily ? 'daily-start' : 'session-start');
    sfx('launch', { volume: 0.6 });
    closeAllOverlays(this);
    this.cameras.main.fadeOut(FADE_MS, 0, 0, 0);
    this.time.delayedCall(FADE_MS, () => this.scene.start(SCENES.game, { setup }));
  }
}
