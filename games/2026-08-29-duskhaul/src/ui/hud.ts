import Phaser from 'phaser';
import { CSS, PALETTE, TEXT, TUNING, bareText } from '../config';
import { sfx } from '../core/audio';
import type { ConsumableId, GateId, GateKind, HudModelV2 } from '../data/types-v2';
import { Bar } from './bars';
import { BossBar } from './bossBar';
import { BUTTON_STYLE, DEEP_INK, DISABLED_ALPHA, HUD_DEPTH, IDENTITY, PANEL, SCRIM, paintBar } from './duskChrome';
import { beltIconId, setIcon } from './itemIcon';
import { drawPanel, drawPill, paintPanel } from './primitives';
import { ensureToastLane } from './toast';

/**
 * PRD-V2 §14.9 run HUD — every widget at its authored rect, nothing in the
 * shell corner (x 0-315, y 0-75):
 *
 * | Widget | Rect |
 * |---|---|
 * | Next-gate line + dark meter | 336,12,244,56 |
 * | Pause `II` | 592,0,88,88 |
 * | HP bar `87/110` | 40,84,300,28 |
 * | Shards | right-aligned x 680, y 82 |
 * | Greed chip `HAUL ×1.2` | right-aligned x 680, y 106 (hidden at ×1) |
 * | XP bar + `LV 9` chip | 40,124,640,12 + 56×28 at (40,140) |
 * | Boss bar | `ui/bossBar.ts` (80,328,560,20) |
 * | Belt | 600,820,88,88 and 600,920,88,88 |
 *
 * The bag widget (360,80,196,44) is `ui/bagStrip.ts` (E41, fed a `BagView`),
 * so `HudModelV2.bag` is not drawn here; the minimap is `ui/minimap.ts`.
 *
 * `set(model)` runs every frame and is a no-op for every unchanged field: no
 * `setText` with an unchanged value, no Graphics repaint unless the value moved.
 */

const GATE_LINE = { x: 336, y: 12, width: 244, height: 56, fontSize: 22 } as const;
const DARK_METER = { x: 336, y: 52, width: 244, height: 10 } as const;
const PAUSE = { x: 592, y: 0, size: 88, disc: 64 } as const;
const HP_BAR = { x: 40, y: 84, width: 300, height: 28 } as const;
const SHARDS = { right: 680, y: 80, fontSize: 24 } as const;
const GREED = { right: 680, y: 106, height: 18, fontSize: 16 } as const;
const XP_BAR = { x: 40, y: 124, width: 640, height: 12 } as const;
const LV_CHIP = { x: 40, y: 140, width: 56, height: 28 } as const;
/** §14.9: belt cooldown sweep is 300 ms. */
const BELT = { x: 600, ys: [820, 920], size: 88, sweepMs: 300 } as const;

/** Beat sheet tick marks on the dark meter (§2.2 gate schedule), 0..1 of the collapse clock. */
const DEFAULT_TICKS_S = [TUNING.gate.a.openS, TUNING.gate.b.openS, TUNING.gate.c.openS];

export interface HudOptions {
  onPause(): void;
  /** Belt slot tapped (0 or 1); the HUD already refused empty/cooling slots. */
  onBelt(slot: number): void;
  /** Run seconds of the dark meter's tick marks (gate opens); default §2.2 A/B/C. */
  gateTicksS?: readonly number[];
  /** Seconds the dark meter spans (`loadout.hazardExtras.collapseAtS`); default `collapse.atS`. */
  collapseAtS?: number;
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** `GATE A` for timed gates, the condition word for the conditional one. */
function gateWord(id: GateId, kind: GateKind): string {
  if (id !== 'x') return `GATE ${id.toUpperCase()}`;
  return kind === 'toll' ? 'TOLL GATE' : kind === 'offering' ? 'OFFERING GATE' : 'BELL GATE';
}

interface BeltSlot {
  root: Phaser.GameObjects.Container;
  plate: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Image;
  count: Phaser.GameObjects.Text;
  sweep: Phaser.GameObjects.Graphics;
  id: ConsumableId | null;
  charges: number;
  cooling: number;
}

export class Hud extends Phaser.GameObjects.Container {
  private readonly hpBar: Bar;
  private readonly hpText: Phaser.GameObjects.Text;
  private readonly hpFlash: Phaser.GameObjects.Graphics;
  private readonly xpBar: Bar;
  private readonly lvText: Phaser.GameObjects.Text;
  private readonly gateText: Phaser.GameObjects.Text;
  private readonly darkMeter: Phaser.GameObjects.Graphics;
  private readonly shardsText: Phaser.GameObjects.Text;
  private readonly greed: Phaser.GameObjects.Container;
  private readonly greedText: Phaser.GameObjects.Text;
  private readonly greedPlate: Phaser.GameObjects.Graphics;
  private readonly boss: BossBar;
  private readonly belt: BeltSlot[] = [];
  private readonly collapseAtS: number;
  private destroyedHud = false;

  private hp = -1;
  private hpMax = -1;
  private xp = -1;
  private xpNeeded = -1;
  private level = -1;
  private gateLabel = '';
  private gateTone = '';
  private darkStep = -1;
  private shards = -1;
  private greedMul = -1;

  constructor(scene: Phaser.Scene, private readonly opts: HudOptions) {
    super(scene, 0, 0);
    this.setDepth(HUD_DEPTH.hud).setScrollFactor(0);
    this.collapseAtS = opts.collapseAtS ?? TUNING.collapse.atS;

    // Next-gate line + dark meter on one §14.4 scrim (text over art).
    const gateScrim = scene.add.graphics();
    gateScrim.fillStyle(SCRIM.fill, SCRIM.alpha);
    gateScrim.fillRoundedRect(GATE_LINE.x - 8, GATE_LINE.y - 4, GATE_LINE.width + 16, GATE_LINE.height + 12, SCRIM.radius);
    this.gateText = scene.add
      .text(GATE_LINE.x, GATE_LINE.y + 18, '', {
        ...TEXT.label,
        fontSize: `${GATE_LINE.fontSize}px`,
        color: CSS.ink,
        ...bareText(),
      })
      .setOrigin(0, 0.5);
    this.darkMeter = scene.add.graphics({
      x: DARK_METER.x + DARK_METER.width / 2,
      y: DARK_METER.y + DARK_METER.height / 2,
    });
    const ticks = scene.add.graphics();
    ticks.lineStyle(2, PALETTE.ink, 0.8);
    for (const t of opts.gateTicksS ?? DEFAULT_TICKS_S) {
      const x = DARK_METER.x + DARK_METER.width * Phaser.Math.Clamp(t / this.collapseAtS, 0, 1);
      ticks.lineBetween(x, DARK_METER.y - 3, x, DARK_METER.y + DARK_METER.height + 3);
    }

    // Pause: 88×88 hit at (592,0), a 64 px disc, label `II` (cert label).
    const pause = this.buildPause(scene);

    // HP: §14.4 `primary` lerping to `bad` below 30%; numerals keep armour (on the housing).
    this.hpBar = new Bar(scene, HP_BAR.x + HP_BAR.width / 2, HP_BAR.y + HP_BAR.height / 2, HP_BAR.width, HP_BAR.height, {
      color: PALETTE.primary,
      lowColor: PALETTE.bad,
      lowAt: 0.3,
    });
    this.hpText = scene.add
      .text(HP_BAR.x + HP_BAR.width / 2, HP_BAR.y + HP_BAR.height / 2, '', {
        ...TEXT.label,
        fontSize: '20px',
        color: CSS.ink,
      })
      .setOrigin(0.5);
    this.hpFlash = scene.add.graphics();
    this.hpFlash.fillStyle(0xffffff, 1).fillRoundedRect(HP_BAR.x, HP_BAR.y, HP_BAR.width, HP_BAR.height, 6);
    this.hpFlash.setAlpha(0);

    // Shards: accent numerals, armoured (bare over art). Greed chip under it.
    this.shardsText = scene.add
      .text(SHARDS.right, SHARDS.y, '', { ...TEXT.label, fontSize: `${SHARDS.fontSize}px`, color: CSS.accent })
      .setOrigin(1, 0);
    this.greedPlate = scene.add.graphics();
    this.greedText = scene.add
      .text(0, 0, '', { ...TEXT.label, fontSize: `${GREED.fontSize}px`, color: CSS.accent, ...bareText() })
      .setOrigin(0.5);
    this.greed = scene.add.container(0, GREED.y + GREED.height / 2, [this.greedPlate, this.greedText]).setVisible(false);

    // XP: `secondary` fill, thinnest row; level chip beneath its left end.
    this.xpBar = new Bar(scene, XP_BAR.x + XP_BAR.width / 2, XP_BAR.y + XP_BAR.height / 2, XP_BAR.width, XP_BAR.height, {
      color: PALETTE.secondary,
    });
    const lvPlate = drawPill(scene, LV_CHIP.width, LV_CHIP.height, {
      fill: PANEL.fill,
      fillAlpha: 0.95,
      stroke: PALETTE.secondary,
      strokeAlpha: 0.9,
      strokeWidth: 2,
    }).setPosition(LV_CHIP.x + LV_CHIP.width / 2, LV_CHIP.y + LV_CHIP.height / 2);
    this.lvText = scene.add
      .text(LV_CHIP.x + LV_CHIP.width / 2, LV_CHIP.y + LV_CHIP.height / 2, '', {
        ...TEXT.label,
        fontSize: '17px',
        color: CSS.ink,
        ...bareText(),
      })
      .setOrigin(0.5);

    this.add([
      gateScrim,
      this.darkMeter,
      ticks,
      this.gateText,
      pause,
      this.hpBar,
      this.hpText,
      this.hpFlash,
      this.shardsText,
      this.greed,
      this.xpBar,
      lvPlate,
      this.lvText,
    ]);
    for (let i = 0; i < BELT.ys.length; i += 1) this.belt.push(this.buildBeltSlot(scene, i));

    this.boss = new BossBar(scene);
    ensureToastLane(scene);
    scene.add.existing(this);
  }

  /** §16.1 E39 — called every frame from `game.ts update()`. */
  set(m: HudModelV2): void {
    if (this.destroyedHud) return;
    if (m.hp !== this.hp || m.hpMax !== this.hpMax) {
      this.hp = m.hp;
      this.hpMax = m.hpMax;
      this.hpBar.setValue(m.hp, m.hpMax);
      this.hpText.setText(`${Math.max(0, Math.ceil(m.hp))}/${Math.ceil(m.hpMax)}`);
    }
    if (m.xp !== this.xp || m.xpNeeded !== this.xpNeeded) {
      this.xp = m.xp;
      this.xpNeeded = m.xpNeeded;
      this.xpBar.setValue(m.xp, m.xpNeeded);
    }
    if (m.level !== this.level) {
      this.level = m.level;
      this.lvText.setText(`LV ${m.level}`);
    }

    this.setGateLine(m);
    const step = Math.round(Phaser.Math.Clamp(m.darkMeter, 0, 1) * 244) + (m.collapse ? 1000 : 0);
    if (step !== this.darkStep) {
      this.darkStep = step;
      paintBar(this.darkMeter, DARK_METER.width, DARK_METER.height, m.darkMeter, m.collapse ? IDENTITY.threat : PALETTE.secondary);
    }

    const shards = Math.floor(m.shards);
    if (shards !== this.shards) {
      this.shards = shards;
      this.shardsText.setText(`${shards.toLocaleString('en-US')} ◆`);
    }
    if (m.greedMul !== this.greedMul) {
      this.greedMul = m.greedMul;
      this.setGreed(m.greedMul);
    }

    for (let i = 0; i < this.belt.length; i += 1) {
      const slot = this.belt[i];
      if (slot !== undefined) this.setBeltSlot(slot, m.belt[i] ?? null);
    }
    this.boss.set(m.boss);
  }

  /** Brief white pulse on the HP bar for a hit; call from `onPlayerHit`. */
  flashDamage(): void {
    if (this.destroyedHud) return;
    this.scene.tweens.killTweensOf(this.hpFlash);
    this.scene.tweens.add({ targets: this.hpFlash, alpha: { from: 0.7, to: 0 }, duration: 220, ease: 'Quad.easeOut' });
  }

  override destroy(fromScene?: boolean): void {
    if (this.destroyedHud) return;
    this.destroyedHud = true;
    this.boss.destroy();
    for (const slot of this.belt) slot.root.destroy();
    this.belt.length = 0;
    super.destroy(fromScene);
  }

  private setGateLine(m: HudModelV2): void {
    let label: string;
    let tone: string;
    const g = m.nextGate;
    if (m.collapse) {
      label = 'COLLAPSE — REACH GATE C';
      tone = CSS.warn;
    } else if (g === null) {
      label = 'NO GATE LEFT';
      tone = CSS.inkSoft;
    } else {
      const word = gateWord(g.id, g.kind);
      const time = Number.isFinite(g.secondsTo) ? ` ${clock(g.secondsTo)}` : '';
      if (g.state === 'open' && g.id === 'c' && TUNING.gate.c.closeS === null) {
        // Gate C never closes — the Collapse is its clock (critic M1: "0:00" read as closing now).
        label = `${word} OPEN · UNTIL COLLAPSE`;
        tone = CSS.primary;
      } else if (g.state === 'open') {
        label = `${word} OPEN${time}`;
        tone = CSS.primary;
      } else if (g.state === 'closing') {
        label = `${word} CLOSING${time}`;
        tone = CSS.warn;
      } else if (g.state === 'spent') {
        label = `${word} SPENT`;
        tone = CSS.inkSoft;
      } else {
        label = `NEXT ${word}${time}`;
        tone = CSS.ink;
      }
    }
    if (label !== this.gateLabel) {
      this.gateLabel = label;
      this.gateText.setText(label).setFontSize(GATE_LINE.fontSize);
      let size = GATE_LINE.fontSize;
      while (this.gateText.width > GATE_LINE.width && size > 14) this.gateText.setFontSize(--size);
    }
    if (tone !== this.gateTone) {
      this.gateTone = tone;
      this.gateText.setColor(tone);
    }
  }

  private setGreed(mul: number): void {
    if (mul <= 1.0001) {
      this.greed.setVisible(false);
      return;
    }
    this.greedText.setText(`HAUL ×${mul.toFixed(1)}`);
    const w = Math.ceil(this.greedText.width) + 16;
    this.greed.setX(GREED.right - w / 2).setVisible(true);
    paintPanel(this.greedPlate, w, GREED.height, {
      fill: PANEL.fill,
      fillAlpha: 0.95,
      stroke: PALETTE.accent,
      strokeAlpha: 0.9,
      strokeWidth: 2,
      radius: GREED.height / 2,
    });
    this.scene.tweens.killTweensOf(this.greed);
    this.greed.setScale(1.2);
    this.scene.tweens.add({ targets: this.greed, scale: 1, duration: 220, ease: 'Back.easeOut' });
  }

  private buildPause(scene: Phaser.Scene): Phaser.GameObjects.Container {
    const cx = PAUSE.x + PAUSE.size / 2;
    const cy = PAUSE.y + PAUSE.size / 2;
    const disc = scene.add.graphics();
    const paint = (pressed: boolean): void => {
      disc.clear();
      disc.fillStyle(pressed ? 0x2c3848 : BUTTON_STYLE.idle.fill, 0.95);
      disc.fillCircle(0, 0, PAUSE.disc / 2);
      disc.lineStyle(2, pressed ? PALETTE.ink : BUTTON_STYLE.idle.stroke, 0.85);
      disc.strokeCircle(0, 0, PAUSE.disc / 2);
    };
    paint(false);
    const label = scene.add
      .text(0, 0, 'II', { ...TEXT.button, fontSize: '28px', color: CSS.ink, ...bareText() })
      .setOrigin(0.5);
    const root = scene.add.container(cx, cy, [disc, label]).setScrollFactor(0);
    root.setSize(PAUSE.size, PAUSE.size).setInteractive({ useHandCursor: true });
    root.setData('label', 'II');
    let armed = false;
    root.on(Phaser.Input.Events.POINTER_DOWN, () => {
      armed = true;
      paint(true);
    });
    root.on(Phaser.Input.Events.POINTER_OUT, () => {
      armed = false;
      paint(false);
    });
    root.on(Phaser.Input.Events.POINTER_UP, () => {
      paint(false);
      if (!armed) return;
      armed = false;
      sfx('ui');
      this.opts.onPause();
    });
    return root;
  }

  private buildBeltSlot(scene: Phaser.Scene, index: number): BeltSlot {
    const size = BELT.size;
    const plate = drawPanel(scene, size, size, {
      fill: PANEL.fill,
      fillAlpha: 0.92,
      stroke: PANEL.stroke,
      strokeAlpha: 0.8,
      strokeWidth: 2,
      radius: 16,
    });
    const icon = scene.add.image(0, -4, '__WHITE');
    const sweep = scene.add.graphics();
    const count = scene.add
      .text(size / 2 - 8, size / 2 - 6, '', { ...TEXT.label, fontSize: '20px', color: CSS.ink })
      .setOrigin(1, 1);
    const root = scene.add
      .container(BELT.x + size / 2, (BELT.ys[index] ?? 0) + size / 2, [plate, icon, sweep, count])
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH.hud)
      .setVisible(false);
    root.setSize(size, size).setInteractive({ useHandCursor: true });
    const slot: BeltSlot = { root, plate, icon, count, sweep, id: null, charges: -1, cooling: -1 };
    let armed = false;
    root.on(Phaser.Input.Events.POINTER_DOWN, () => {
      armed = true;
      root.setScale(0.94);
    });
    root.on(Phaser.Input.Events.POINTER_OUT, () => {
      armed = false;
      root.setScale(1);
    });
    root.on(Phaser.Input.Events.POINTER_UP, () => {
      root.setScale(1);
      if (!armed) return;
      armed = false;
      if (slot.charges <= 0 || slot.cooling > 0) {
        // Refused WITH feedback: a headshake, never a silent drop.
        scene.tweens.killTweensOf(root);
        scene.tweens.add({ targets: root, x: root.x + 6, duration: 50, yoyo: true, repeat: 2 });
        sfx('ui', { volume: 0.3, rate: 0.7 });
        return;
      }
      sfx('ui');
      this.opts.onBelt(index);
    });
    return slot;
  }

  private setBeltSlot(slot: BeltSlot, v: HudModelV2['belt'][number]): void {
    if (v === null) {
      if (slot.id !== null) {
        slot.id = null;
        slot.root.setVisible(false);
      }
      return;
    }
    if (v.id !== slot.id) {
      slot.id = v.id;
      setIcon(slot.icon, beltIconId(v.id), 60, PALETTE.accent);
      slot.root.setVisible(true);
      slot.charges = -1;
    }
    if (v.charges !== slot.charges) {
      slot.charges = v.charges;
      slot.count.setText(`×${v.charges}`);
      slot.root.setAlpha(v.charges > 0 ? 1 : DISABLED_ALPHA);
    }
    // Cooldown sweep: repainted only while cooling (≤ 300 ms per use).
    const cooling = Math.max(0, v.coolingMs);
    if (cooling !== slot.cooling) {
      slot.cooling = cooling;
      slot.sweep.clear();
      if (cooling > 0) {
        const frac = Phaser.Math.Clamp(cooling / BELT.sweepMs, 0, 1);
        slot.sweep.fillStyle(DEEP_INK, 0.6);
        slot.sweep.slice(0, 0, BELT.size / 2 - 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false);
        slot.sweep.fillPath();
      }
    }
  }
}
