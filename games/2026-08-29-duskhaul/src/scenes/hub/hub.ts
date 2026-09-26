/**
 * The V2 hub frame (PRD-V2 §14.2 / FlowAudit §2.3), replacing MenuScene +
 * MetaScene:
 *
 * | Band | Rect | Owner |
 * |---|---|---|
 * | shell corner | 0,0,315,75 | NOTHING (site shell) |
 * | top bar | 315,0,405,96 | Shards chip 180×64 @ (420,16) · `LV n` badge 64×64 @ (612,16) with XP ring → CODEX/RECORDS |
 * | tab title | 40,96,640,72 | title left; right slot: cog 72×72 @ (608,96) on EXPEDITION, Dust/Sigil chips on VAULT/SANCTUM |
 * | content | 0,168,720,952 | active tab on a scissor `ScrollView` (drag from anywhere, wheel, momentum) |
 * | tab bar | 0,1120,720,160 | `ui/tabBar.ts` |
 *
 * Entrance fade 180 ms; tab switch cross-fade 120 ms (alpha only — NO slide
 * tweens, which caused the V1 overlap bug #17). Nothing in the frame moves.
 */
import Phaser from 'phaser';
import { CSS, PALETTE, VIEW } from '../../config';
import { sfx, unlockAudio } from '../../core/audio';
import { SCENES } from '../../core/keys';
import { startMusic } from '../../core/music';
import { accountLevel, loadMeta, nodeUnlocked } from '../../core/progression';
import { track } from '../../core/telemetry';
import { SANCTUM, nodeCost } from '../../data/sanctum';
import type { HazardLevel, MetaSaveV4, RunMode, ZoneId } from '../../data/types-v2';
import { addBackground } from '../../ui/background';
import { DEEP_INK, SCRIM } from '../../ui/duskChrome';
import { iconFor } from '../../ui/itemIcon';
import { ScrollView, cameraRouter } from '../../ui/scrollView';
import { closeAllOverlays } from '../../ui/sheet';
import { TabBar } from '../../ui/tabBar';
import { label, num, tapZone } from '../../ui/widgets';
import { buildArmoryTab } from './armory';
import { buildCodexTab } from './codex';
import { buildExpeditionTab, openLoadoutSheet } from './expedition';
import { openSettingsSheet } from '../../ui/settingsSheet';
import { buildSanctumTab } from './sanctum';
import { buildVaultTab } from './vault';

export type HubTabId = 'expedition' | 'armory' | 'vault' | 'sanctum' | 'codex';

/** One tab's content, built into the hub's scrolling content container. */
export interface HubTab {
  /** Re-reads the meta save and redraws. */
  refresh(): void;
  destroy(): void;
}

export type HubTabFactory = (scene: Phaser.Scene, content: Phaser.GameObjects.Container) => HubTab;

/** Run hand-off: exactly E29 `runLoadout(sel)`'s selection; `GameScene` receives it as scene data. */
export interface RunStart {
  zone: ZoneId;
  hazard: HazardLevel;
  mode: RunMode;
  seed?: string;
}

/** Scene data for `scene.start(SCENES.hub, data)` (Results CONTINUE / RUN AGAIN / RETRY). */
export interface HubData {
  tab?: HubTabId;
  /** Opens the Loadout sheet on arrival (RUN AGAIN / RETRY SAME MAP). */
  loadout?: RunStart;
  /** Segment to open inside the target tab (e.g. CODEX `RECORDS`). */
  segment?: string;
  /** uids banked by the run just settled — NEW badges + VAULT banner. */
  newItems?: string[];
  /** One-time banner line for the target tab (FlowAudit §2.12 "To vault"). */
  banner?: string;
}

/** What tabs and sheets call back into. */
export interface HubApi {
  /** Declares the active tab's content height (drives scroll range). */
  setContentHeight(h: number): void;
  goTab(id: HubTabId, segment?: string): void;
  /** Rebuilds the active tab and repaints top bar + badges. */
  refreshAll(): void;
  /** Repaints the top bar / title chips / badges only. */
  refreshChrome(): void;
  startRun(sel: RunStart): void;
  /** Segment requested for the tab being built (consumed once). */
  takeSegment(): string | null;
  /** uids banked by the last run (NEW badges), until the vault is left. */
  readonly newItems: readonly string[];
  /** One-shot banner for the tab being built. */
  takeBanner(): string | null;
  /** Content scroll offset (to restore after a rebuild). */
  scrollView(): ScrollView;
}

const APIS = new WeakMap<Phaser.Scene, HubApi>();

/** The hub API for a scene built by HubScene (tabs and sheets call this). */
export function hubApi(scene: Phaser.Scene): HubApi {
  const api = APIS.get(scene);
  if (api === undefined) throw new Error('hubApi: scene is not the HubScene');
  return api;
}

const FACTORIES: Record<HubTabId, HubTabFactory> = {
  expedition: buildExpeditionTab,
  armory: buildArmoryTab,
  vault: buildVaultTab,
  sanctum: buildSanctumTab,
  codex: buildCodexTab,
};

const TITLES: Record<HubTabId, string> = {
  expedition: 'EXPEDITION',
  armory: 'ARMORY',
  vault: 'VAULT',
  sanctum: 'SANCTUM',
  codex: 'CODEX',
};

const CONTENT = { x: 0, y: 168, width: 720, height: 952 } as const;
const ENTRANCE_MS = 180;
const TAB_FADE_MS = 120;

export class HubScene extends Phaser.Scene {
  private scroll!: ScrollView;
  private tabBar!: TabBar;
  private tab: HubTab | null = null;
  private tabId: HubTabId = 'expedition';
  private segment: string | null = null;
  private banner: string | null = null;
  private newItems: string[] = [];
  private shardText!: Phaser.GameObjects.Text;
  private shardChip!: Phaser.GameObjects.Container;
  private lvText!: Phaser.GameObjects.Text;
  private lvRing!: Phaser.GameObjects.Graphics;
  private titleText!: Phaser.GameObjects.Text;
  private titleRight!: Phaser.GameObjects.Container;
  private starting = false;

  constructor() {
    super(SCENES.hub);
  }

  create(data: HubData = {}): void {
    // A Scene INSTANCE survives scene.start(): reset per-visit state first.
    this.tab = null;
    this.segment = data.segment ?? null;
    this.banner = data.banner ?? null;
    this.newItems = [...(data.newItems ?? [])];
    this.starting = false;

    addBackground(this);
    // Content-band veil (§14.4 scrim): hub rows sit on panels, but the gaps
    // between them would otherwise show the lit backdrop horizon.
    this.add
      .rectangle(0, CONTENT.y, VIEW.width, CONTENT.height, SCRIM.fill, SCRIM.alpha)
      .setOrigin(0, 0)
      .setDepth(-100);

    this.buildTopBar();
    this.titleText = label(this, 40, 132, '', { size: 40, bold: true, origin: [0, 0.5] });
    this.titleRight = this.add.container(0, 0);
    const scene = this;

    // The scroll view is created BEFORE the tab bar so its camera exists when
    // tabs build; the tab bar lives on the main camera below the content band.
    this.scroll = new ScrollView(this, CONTENT);
    // Bottom edge fade over the list (QA 18): rows scrolling under the tab bar
    // dissolve into it instead of butting a control flush against its edge.
    // Its own camera, created after the list's, so it draws over the list.
    const fadeRect = { x: 0, y: CONTENT.y + CONTENT.height - 28, width: VIEW.width, height: 28 };
    const fade = this.add.container(0, 0);
    for (let i = 0; i < 7; i++) {
      fade.add(this.add.rectangle(0, fadeRect.y + i * 4, VIEW.width, 4, DEEP_INK, 0.1 + i * 0.13).setOrigin(0, 0));
    }
    const fadeCam = this.cameras.add(fadeRect.x, fadeRect.y, fadeRect.width, fadeRect.height);
    fadeCam.setScroll(fadeRect.x, fadeRect.y);
    cameraRouter(this).own(fade, fadeCam);
    this.tabBar = new TabBar(this, (id) => this.selectTab(id));

    const api: HubApi = {
      setContentHeight: (h) => this.scroll.setContentHeight(h),
      goTab: (id, segment) => {
        this.segment = segment ?? null;
        this.selectTab(id, true);
      },
      refreshAll: () => {
        const at = this.scroll.offset;
        this.tab?.refresh();
        this.scroll.scrollTo(at);
        this.refreshChrome();
      },
      refreshChrome: () => this.refreshChrome(),
      startRun: (sel) => this.startRun(sel),
      takeSegment: () => {
        const s = this.segment;
        this.segment = null;
        return s;
      },
      get newItems() {
        return scene.newItems;
      },
      takeBanner: () => {
        const b = this.banner;
        this.banner = null;
        return b;
      },
      scrollView: () => this.scroll,
    };
    APIS.set(this, api);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.tab?.destroy();
      this.tab = null;
      this.tabBar.destroy();
      APIS.delete(this);
    });

    this.input.once(Phaser.Input.Events.POINTER_DOWN, () => unlockAudio());
    startMusic('menu');

    this.selectTab(data.tab ?? 'expedition', true);
    if (data.loadout !== undefined) openLoadoutSheet(this, data.loadout);

    this.cameras.main.fadeIn(ENTRANCE_MS, 0, 0, 0);
    this.scroll.cam.fadeIn(ENTRANCE_MS, 0, 0, 0);
  }

  private buildTopBar(): void {
    // Shards chip 180×64 at (420,16): icon + count, right-aligned inside.
    this.shardChip = tapZone(this, 420, 16, 180, 64, () => this.selectTab('vault'), true);
    const g = this.add.graphics();
    g.fillStyle(DEEP_INK, 0.85);
    g.fillRoundedRect(0, 0, 180, 64, 32);
    g.lineStyle(2, PALETTE.accent, 0.7);
    g.strokeRoundedRect(1, 1, 178, 62, 32);
    // The ◆ glyph every price and reward line uses — one shard mark everywhere (critic F16).
    const icon = label(this, 34, 32, '◆', { size: 30, bold: true, color: CSS.accent, origin: [0.5, 0.5] });
    this.shardText = label(this, 160, 32, '0', { size: 28, bold: true, color: CSS.accent, origin: [1, 0.5] });
    this.shardChip.add([g, icon, this.shardText]);

    // Account badge 64×64 at (612,16) with XP ring; hit rect grown to 88×88.
    const badge = tapZone(this, 600, 4, 88, 88, () => {
      this.segment = 'RECORDS';
      this.selectTab('codex', true);
    });
    const disc = this.add.graphics();
    disc.fillStyle(DEEP_INK, 0.9);
    disc.fillCircle(44, 44, 32);
    this.lvRing = this.add.graphics();
    this.lvText = label(this, 44, 44, 'LV 1', { size: 18, bold: true, origin: [0.5, 0.5] });
    badge.add([disc, this.lvRing, this.lvText]);
  }

  private refreshChrome(): void {
    const meta = loadMeta();
    this.shardText.setText(num(meta.currency)).setScale(1);
    // Six-figure totals (endless sinks era) must not run into the ◆ glyph: fit 56..164.
    if (this.shardText.width > 108) this.shardText.setScale(108 / this.shardText.width);
    const lv = accountLevel(meta);
    this.lvText.setText(`LV ${lv.level}`);
    const t = lv.xpNeeded > 0 ? Phaser.Math.Clamp(lv.xpInto / lv.xpNeeded, 0, 1) : 1;
    this.lvRing.clear();
    this.lvRing.lineStyle(5, PALETTE.inkSoft, 0.35);
    this.lvRing.strokeCircle(44, 44, 30);
    if (t > 0) {
      this.lvRing.lineStyle(5, PALETTE.primary, 1);
      this.lvRing.beginPath();
      this.lvRing.arc(44, 44, 30, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2, false);
      this.lvRing.strokePath();
    }
    this.paintTitleRight(meta);
    this.paintBadges(meta);
  }

  /** Right slot of the title row: cog (EXPEDITION), Dust (VAULT), Dust + Sigils (SANCTUM). */
  private paintTitleRight(meta: MetaSaveV4): void {
    this.titleRight.removeAll(true);
    if (this.tabId === 'expedition') {
      const cog = tapZone(this, 608, 96, 72, 72, () =>
        openSettingsSheet(this, {
          // Reset save is Hub-only; after the wipe, re-land on a fresh EXPEDITION.
          onReset: () => this.selectTab('expedition', true),
        }),
      );
      const g = this.add.graphics();
      g.fillStyle(DEEP_INK, 0.85);
      g.fillCircle(36, 36, 30);
      g.lineStyle(2, PALETTE.inkSoft, 0.7);
      g.strokeCircle(36, 36, 30);
      // Drawn cog: 8 teeth + hub.
      g.fillStyle(PALETTE.ink, 1);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.fillCircle(36 + Math.cos(a) * 16, 36 + Math.sin(a) * 16, 5);
      }
      g.fillCircle(36, 36, 14);
      g.fillStyle(DEEP_INK, 1);
      g.fillCircle(36, 36, 6);
      cog.add(g);
      this.titleRight.add(cog);
      return;
    }
    const chips: { icon: string; text: string; tone: number; color: string }[] = [];
    if (this.tabId === 'vault' || this.tabId === 'sanctum') {
      chips.push({ icon: 'icon-cur-dust', text: num(meta.dust), tone: PALETTE.ink, color: CSS.ink });
    }
    if (this.tabId === 'sanctum') {
      chips.push({ icon: 'icon-cur-sigil', text: `${meta.sigils}`, tone: PALETTE.secondary, color: CSS.ink });
    }
    let right = 680;
    for (const chip of chips) {
      const t = label(this, right - 12, 132, chip.text, { size: 26, bold: true, color: chip.color, origin: [1, 0.5] });
      const ic = iconFor(this, chip.icon, 32, chip.tone, 'disc').setPosition(t.x - t.width - 24, 132);
      this.titleRight.add([ic, t]);
      right = ic.x - 28;
    }
  }

  private paintBadges(meta: MetaSaveV4): void {
    this.tabBar.setBadge('vault', this.newItems.length > 0 && this.tabId !== 'vault');
    const affordable = SANCTUM.some((node) => {
      const lvl = meta.upgrades[node.id] ?? 0;
      if (lvl >= node.max || !nodeUnlocked(meta, node.id).unlocked) return false;
      const cost = nodeCost(node, lvl);
      return cost.shards <= meta.currency && cost.sigils <= meta.sigils;
    });
    this.tabBar.setBadge('sanctum', affordable && this.tabId !== 'sanctum');
    const claimable =
      meta.contracts.active.some((c) => c.progress >= c.target) ||
      Object.values(meta.achievements).some((s) => s === 'done');
    this.tabBar.setBadge('codex', claimable && this.tabId !== 'codex');
  }

  private selectTab(id: HubTabId, force = false): void {
    if (!force && id === this.tabId && this.tab !== null) return;
    closeAllOverlays(this);
    // Leaving the vault clears its NEW badges (seen).
    if (this.tabId === 'vault' && id !== 'vault') this.newItems = [];
    this.tab?.destroy();
    this.tab = null;
    this.scroll.clear();
    this.tabId = id;
    this.titleText.setText(TITLES[id]);
    this.tabBar.select(id);
    this.tab = FACTORIES[id](this, this.scroll.root);
    this.refreshChrome();
    // Cross-fade (alpha only): the content never moves.
    this.scroll.root.setAlpha(0.001);
    this.tweens.add({ targets: this.scroll.root, alpha: 1, duration: TAB_FADE_MS });
  }

  private startRun(sel: RunStart): void {
    if (this.starting) return;
    this.starting = true;
    track(sel.mode === 'daily' ? 'daily-start' : 'session-start');
    sfx('whoosh');
    closeAllOverlays(this);
    this.cameras.main.fadeOut(ENTRANCE_MS, 0, 0, 0);
    this.scroll.cam.fadeOut(ENTRANCE_MS, 0, 0, 0);
    this.time.delayedCall(ENTRANCE_MS, () => this.scene.start(SCENES.game, sel));
  }
}
