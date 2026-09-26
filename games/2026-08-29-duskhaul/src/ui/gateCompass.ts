import Phaser from 'phaser';
import { CSS, TEXT, TUNING, bareText } from '../config';
import type { GateId, MinimapModel } from '../data/types-v2';
import { paintPill } from './primitives';
import { TOAST_RECT, toastShowing } from './toast';
import { DEEP_INK, DEEP_INK_CSS, HUD_DEPTH, IDENTITY, PANEL } from './duskChrome';

/**
 * PRD-V2 §14.10 compass ring + §13.2 off-screen chevrons.
 *
 * ≤ 5 ARROWS: up to 3 gates, the nearest undiscovered chest and the active
 * event, each with a chip `B · 42m · 1:12` (64 world px = 1 m). Arrows clamp
 * to the ring x 40-680 / y 330-1000 (§14.1 playfield) and skip the belt rect
 * (600-688 × 820-1008). A target comfortably on screen drops its arrow head;
 * a gate keeps its chip there (the arch is the "where", the chip the clock),
 * a chest/event hides entirely (its art is visible).
 *
 * CHEVRONS: off-screen elites and the boss get red 40 px chevrons on the same
 * ring (boss 52 px). They carry no chip and never count toward the 5 arrows.
 *
 * Gate looks, from `ExtractionSystem.view()` state + label:
 *
 * | State | Arrow | Chip |
 * | --- | --- | --- |
 * | closed, opens within `previewS` | violet, 0.6 alpha | `A · 42m · 0:35` |
 * | open | violet, full | `A · 42m · 1:12` (C: no time) |
 * | closing | amber, PULSING | `A · 42m · 0:11` |
 * | just closed | cooled grey, 2 s then drops | `A · CLOSED` |
 * | spent / closed beyond preview | hidden | — |
 *
 * It RENDERS ONLY: the slice feeds a plain data object every frame.
 */

export interface CompassModel {
  hero: { x: number; y: number };
  /** `ExtractionSystem.view()` verbatim — the same feed the minimap takes. */
  gates: MinimapModel['gates'];
  /** `PoiSystem.nearestUndiscovered` when it is a chest; else null. */
  chest: { x: number; y: number } | null;
  /** The active POI event, if any. */
  event: { x: number; y: number } | null;
  /** Elites and the boss (world px); only off-screen ones draw a chevron. */
  threats: readonly { x: number; y: number; boss: boolean }[];
  /** Run seconds; from `ETA_FROM_S` gate chips add a travel estimate (critic v2d M1). */
  elapsedS: number;
  /** Hero move speed, world px/s (current stat, so boots and shrines count). */
  heroSpeed: number;
}

/** A screen rect (design px, top-left) a compass unit occupies this frame. */
export interface CompassRect { x: number; y: number; w: number; h: number }

/** Live compass rects per scene, for world labels (elite plates) to keep clear of. */
const occupied = new WeakMap<Phaser.Scene, CompassRect[]>();

/**
 * Screen rects of every visible compass arrow+chip this frame (critic v2d M2:
 * right-edge chips over elite name plates). Updated by `GateCompass.update`;
 * empty when no compass exists. Callers must not keep the array.
 */
export function compassRects(scene: Phaser.Scene): readonly CompassRect[] {
  return occupied.get(scene) ?? [];
}

/**
 * §14.1 compass ring, screen px — x 40-680 / y 330-1000, with the TOP lowered
 * to 380: the authored §14.9 boss bar + its scrim occupy 286-354, and an arrow
 * clamped at 330 drew underneath it (measured in the harness screenshot).
 */
const RING = { left: 40, right: 680, top: 380, bottom: 1000 } as const;
/**
 * While a toast is visible the ring's top drops below the toast lane (360-448)
 * so no arrow or chip is drawn under it (critic F11). Set once per `update`.
 */
const RING_TOP_UNDER_TOAST = TOAST_RECT.y + TOAST_RECT.height + 12;
let ringTop: number = RING.top;
/** §14.1 belt rect — arrows are pushed out of it. */
const BELT = { left: 600, right: 688, top: 820, bottom: 1008 } as const;
const ARROW_SIZE = 48;
const CHEVRON = { elite: 40, boss: 52 } as const;
const MAX_CHEVRONS = 8;
const MAX_GATE_ARROWS = 3;
const CHIP = { minWidth: 60, height: 26, padX: 20, fontSize: '18px' } as const;
const CLOSED_FLASH_MS = 2000;
const CHIP_OFFSET = 38;
const ONSCREEN_INSET = 150;
const CHIP_GAP = 6;
/** §14.10: 64 world px = 1 m. */
const PX_PER_M = 64;
/** Gate chips show a travel ETA from this run second (critic v2d M1). */
const ETA_FROM_S = 300;
/** Walked path ≈ straight line × this (blockers, roads). */
const PATH_FACTOR = 1.2;

/** `42m` under 1 km, else `6.8km`. */
function distance(worldPx: number): string {
  const m = worldPx / PX_PER_M;
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

/** `~22s` under a minute, else `~2:10`. */
function travel(seconds: number): string {
  const t = Math.max(1, Math.round(seconds));
  return t < 60 ? `${t}s` : clock(t);
}

type Look = 'preview' | 'open' | 'closing' | 'closed' | 'chest' | 'event';

const LOOK: Record<Look, { tone: number; alpha: number; pulse: boolean }> = {
  preview: { tone: IDENTITY.gateOpen, alpha: 0.6, pulse: false },
  open: { tone: IDENTITY.gateOpen, alpha: 1, pulse: false },
  closing: { tone: IDENTITY.hazardAmber, alpha: 1, pulse: true },
  closed: { tone: IDENTITY.cooled, alpha: 0.85, pulse: false },
  chest: { tone: IDENTITY.gilt, alpha: 0.95, pulse: false },
  event: { tone: IDENTITY.gateOpen, alpha: 1, pulse: true },
};

interface Placement {
  arrow: Arrow;
  x: number;
  y: number;
  angle: number;
  showHead: boolean;
  chipWidth: number;
  chipX: number;
  chipY: number;
}

/** Vertical gap between two stacked arrow+chip units (critic M2: ≥ 44 px chip pitch). */
const UNIT_GAP = 14;
/** Lowest y any unit may reach (chip bottom), just above the stick band. */
const UNIT_FLOOR = RING.bottom + CHIP.height / 2;
/**
 * Units that reach into the belt column (x ≥ BELT.left) must end above the belt
 * (critic v2c: B / TOLL / X stacked beside the belt, under the stick thumb). They
 * reflow UP the right edge instead of sliding in toward the stick.
 */
const BELT_COLUMN_FLOOR = BELT.top - UNIT_GAP;

function floorFor(p: Placement): number {
  return unitRight(p) > BELT.left - CHIP_GAP ? BELT_COLUMN_FLOOR : UNIT_FLOOR;
}

/** A placement's arrow + chip as one block: x-range and y-range, screen px. */
function unitLeft(p: Placement): number {
  return Math.min(p.showHead ? p.x - ARROW_SIZE / 2 : Infinity, p.chipX - p.chipWidth / 2);
}
function unitRight(p: Placement): number {
  return Math.max(p.showHead ? p.x + ARROW_SIZE / 2 : -Infinity, p.chipX + p.chipWidth / 2);
}
function unitTop(p: Placement): number {
  return Math.min(p.showHead ? p.y - ARROW_SIZE / 2 : Infinity, p.chipY - CHIP.height / 2);
}
function unitBottom(p: Placement): number {
  return Math.max(p.showHead ? p.y + ARROW_SIZE / 2 : -Infinity, p.chipY + CHIP.height / 2);
}
function sharesColumn(a: Placement, b: Placement): boolean {
  return unitLeft(a) < unitRight(b) + CHIP_GAP && unitLeft(b) < unitRight(a) + CHIP_GAP;
}
/** Moves an edge unit (arrow AND chip) — the arrow keeps pointing at its target. */
function shiftUnit(p: Placement, dy: number): void {
  if (p.showHead) p.y += dy;
  p.chipY += dy;
}

/**
 * Stacks arrow+chip units that share a column along the edge (critic M2: three
 * chips fused into one block at the bottom-right). Each unit is a single
 * block, so a chip can no longer land on a neighbour's arrow head either.
 * Pass 1 pushes down in ascending order; pass 2 pushes back up from the floor.
 * The belt slide can change a chip's x, so the stack is resolved twice around
 * it. ≤ 5 units, so the pairwise loops are a handful of comparisons.
 */
function declutterChips(shown: Placement[]): void {
  for (const p of shown) if (p.chipY - CHIP.height / 2 < ringTop) shiftUnit(p, ringTop - (p.chipY - CHIP.height / 2));
  for (let pass = 0; pass < 2; pass += 1) {
    shown.sort((a, b) => unitTop(a) - unitTop(b));
    for (let i = 1; i < shown.length; i += 1) {
      const unit = shown[i];
      if (unit === undefined) continue;
      for (let j = 0; j < i; j += 1) {
        const other = shown[j];
        if (other === undefined || !sharesColumn(unit, other)) continue;
        const need = unitBottom(other) + UNIT_GAP - unitTop(unit);
        if (need > 0) {
          shiftUnit(unit, need);
          j = -1; // re-check against everything above after moving
        }
      }
    }
    for (let i = shown.length - 1; i >= 0; i -= 1) {
      const unit = shown[i];
      if (unit === undefined) continue;
      let limit = floorFor(unit);
      for (let k = i + 1; k < shown.length; k += 1) {
        const below = shown[k];
        if (below !== undefined && sharesColumn(unit, below)) limit = Math.min(limit, unitTop(below) - UNIT_GAP);
      }
      const over = unitBottom(unit) - limit;
      if (over > 0) shiftUnit(unit, -over);
    }
  }
}

/** Seconds from a `m:ss` token anywhere in an extraction label (`OPENS 1:12`); null if none. */
function labelSeconds(label: string): number | null {
  const match = /(\d+):(\d\d)/.exec(label);
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

/** Clamp a screen point onto the ring; in the belt column it moves UP the right edge. */
function clampToRing(x: number, y: number, half: number, out: { x: number; y: number }): void {
  const cx = Phaser.Math.Clamp(x, RING.left + half, RING.right - half);
  let cy = Phaser.Math.Clamp(y, ringTop, RING.bottom);
  if (cx + half > BELT.left && cy + half > BELT.top - UNIT_GAP) cy = BELT.top - UNIT_GAP - half;
  out.x = cx;
  out.y = cy;
}

function paintTriangle(g: Phaser.GameObjects.Graphics, size: number, tone: number, chevron: boolean): void {
  const h = size / 2;
  g.clear();
  g.fillStyle(tone, 1);
  g.beginPath();
  g.moveTo(h, 0);
  g.lineTo(-h * 0.7, -h * 0.85);
  if (chevron) g.lineTo(-h * 0.25, 0);
  g.lineTo(-h * 0.7, h * 0.85);
  g.closePath();
  g.fillPath();
  g.lineStyle(2, DEEP_INK, 0.9);
  g.strokePath();
}

/** One arrow + chip; the pulse tween has exactly one owner and one kill site. */
class Arrow {
  private readonly head: Phaser.GameObjects.Graphics;
  private readonly letter: Phaser.GameObjects.Text;
  private readonly chipBg: Phaser.GameObjects.Graphics;
  private readonly chipText: Phaser.GameObjects.Text;
  private look: Look | null = null;
  private chipWidth = 0;
  private chipLabel = '';
  private pulse: Phaser.Tweens.Tween | null = null;
  private visible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    glyph: string,
  ) {
    this.head = scene.add.graphics().setScrollFactor(0).setDepth(HUD_DEPTH.compass).setVisible(false);
    // The letter sits ON the arrow fill (a fill carrying a deep-ink label), so it goes bare.
    this.letter = scene.add
      .text(0, 0, glyph, { ...TEXT.button, fontSize: '20px', color: DEEP_INK_CSS, ...bareText() })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH.compass + 1)
      .setVisible(false);
    this.chipBg = scene.add.graphics().setScrollFactor(0).setDepth(HUD_DEPTH.compass).setVisible(false);
    this.chipText = scene.add
      .text(0, 0, '', { ...TEXT.label, fontSize: CHIP.fontSize, color: CSS.ink, ...bareText() })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH.compass + 1)
      .setVisible(false);
  }

  prepare(look: Look, label: string): number {
    if (this.look !== look) {
      this.look = look;
      const { tone, alpha } = LOOK[look];
      paintTriangle(this.head, ARROW_SIZE, tone, false);
      this.head.setAlpha(alpha);
      this.letter.setAlpha(alpha);
      this.chipBg.setAlpha(alpha);
      this.chipText.setAlpha(alpha);
      this.chipWidth = 0;
    }
    if (label !== this.chipLabel) {
      this.chipLabel = label;
      this.chipText.setText(label);
      this.chipWidth = 0;
    }
    if (this.chipWidth === 0) {
      this.chipWidth = Math.max(CHIP.minWidth, Math.ceil(this.chipText.width) + CHIP.padX);
      paintPill(this.chipBg, this.chipWidth, CHIP.height, {
        fill: PANEL.fill,
        fillAlpha: 0.95,
        stroke: LOOK[look].tone,
        strokeAlpha: 0.85,
        strokeWidth: 2,
      });
    }
    return this.chipWidth;
  }

  /** Commits geometry; owns the pulse (a suppressed head never keeps a tween). */
  place(p: Placement): void {
    this.head.setPosition(p.x, p.y).setRotation(p.angle).setVisible(p.showHead);
    this.letter.setPosition(p.x, p.y).setVisible(p.showHead);
    this.setPulsing(p.showHead && this.look !== null && LOOK[this.look].pulse);
    this.chipBg.setPosition(p.chipX, p.chipY).setVisible(true);
    this.chipText.setPosition(p.chipX, p.chipY).setVisible(true);
    this.visible = true;
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.setPulsing(false);
    this.head.setVisible(false);
    this.letter.setVisible(false);
    this.chipBg.setVisible(false);
    this.chipText.setVisible(false);
  }

  private setPulsing(on: boolean): void {
    if (on === (this.pulse !== null)) return;
    if (!on) {
      this.pulse?.remove();
      this.pulse = null;
      this.head.setScale(1);
      return;
    }
    this.pulse = this.scene.tweens.add({
      targets: this.head,
      scale: 1.18,
      duration: 320,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** Live loop tweens owned by this arrow (tween-leak probe). */
  get loops(): number {
    return this.pulse === null ? 0 : 1;
  }

  destroy(): void {
    this.setPulsing(false);
    this.head.destroy();
    this.letter.destroy();
    this.chipBg.destroy();
    this.chipText.destroy();
  }
}

export class GateCompass {
  private readonly gateArrows = new Map<GateId, Arrow>();
  private readonly chestArrow: Arrow;
  private readonly eventArrow: Arrow;
  private readonly chevrons: Phaser.GameObjects.Graphics[] = [];
  /** Tone+size each chevron was last painted with, to repaint only on change. */
  private readonly chevronLook: boolean[] = [];
  /** `scene.time.now` a gate was last seen live — drives the 2 s CLOSED flash. */
  private readonly lastLiveAt = new Map<GateId, number>();
  private readonly shown: Placement[] = [];
  private readonly point = { x: 0, y: 0 };
  private readonly picks: MinimapModel['gates'][number][] = [];
  private readonly pickLooks: Look[] = [];
  private readonly live = new Set<GateId>();
  private destroyed = false;

  /** @param previewS - `loadout.previewS` (60, or 120 with `e_beacon`). */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly previewS: number = TUNING.gate.previewS,
  ) {
    this.chestArrow = new Arrow(scene, '');
    this.eventArrow = new Arrow(scene, '!');
    for (let i = 0; i < MAX_CHEVRONS; i += 1) {
      this.chevrons.push(scene.add.graphics().setScrollFactor(0).setDepth(HUD_DEPTH.compass).setVisible(false));
      this.chevronLook.push(false);
    }
  }

  update(model: CompassModel): void {
    if (this.destroyed) return;
    const view = this.scene.cameras.main.worldView;
    // A camera that has not rendered yet reports a zero-size view.
    if (view.width <= 0 || view.height <= 0) return;
    const heroX = model.hero.x - view.x;
    const heroY = model.hero.y - view.y;
    const now = this.scene.time.now;
    ringTop = toastShowing(this.scene) ? RING_TOP_UNDER_TOAST : RING.top;
    this.shown.length = 0;

    // --- gates: up to 3, live ones first, then soonest preview ------------
    // Reused arrays, ranked by insertion: no map/filter/sort garbage per frame.
    const picks = this.picks;
    const looks = this.pickLooks;
    picks.length = 0;
    looks.length = 0;
    for (const g of model.gates) {
      const look = this.gateLook(g, now);
      if (look === null) continue;
      let at = picks.length;
      while (at > 0 && rank(looks[at - 1] ?? 'preview') > rank(look)) at -= 1;
      picks.splice(at, 0, g);
      looks.splice(at, 0, look);
    }
    this.live.clear();
    for (let i = 0; i < picks.length && i < MAX_GATE_ARROWS; i += 1) {
      const g = picks[i];
      const look = looks[i];
      if (g === undefined || look === undefined) continue;
      this.live.add(g.id);
      const arrow = this.gateArrow(g.id);
      const prefix = g.id === 'x' ? (g.label.split(' · ')[0] ?? 'GATE') : g.id.toUpperCase();
      const dist = Math.hypot(g.x - model.hero.x, g.y - model.hero.y);
      const secs = labelSeconds(g.label);
      // From ETA_FROM_S the chip adds `~travel time` (path ≈ straight × PATH_FACTOR);
      // with the 24,576² map the remaining clock alone no longer says "can I make it".
      const eta = model.elapsedS >= ETA_FROM_S && model.heroSpeed > 0 ? ` · ~${travel((dist * PATH_FACTOR) / model.heroSpeed)}` : '';
      const label =
        look === 'closed' ? `${prefix} · CLOSED` : `${prefix} · ${distance(dist)}${secs === null ? '' : ` · ${clock(secs)}`}${eta}`;
      this.project(arrow, look, label, g.x - view.x, g.y - view.y, heroX, heroY, view, true);
    }
    for (const [id, arrow] of this.gateArrows) if (!this.live.has(id)) arrow.hide();

    // --- chest + event ------------------------------------------------------
    if (model.chest === null) this.chestArrow.hide();
    else {
      const d = distance(Math.hypot(model.chest.x - model.hero.x, model.chest.y - model.hero.y));
      this.project(this.chestArrow, 'chest', `CHEST · ${d}`, model.chest.x - view.x, model.chest.y - view.y, heroX, heroY, view, false);
    }
    if (model.event === null) this.eventArrow.hide();
    else {
      const d = distance(Math.hypot(model.event.x - model.hero.x, model.event.y - model.hero.y));
      this.project(this.eventArrow, 'event', `EVENT · ${d}`, model.event.x - view.x, model.event.y - view.y, heroX, heroY, view, false);
    }

    declutterChips(this.shown);
    for (const p of this.shown) p.arrow.place(p);
    let rects = occupied.get(this.scene);
    if (rects === undefined) {
      rects = [];
      occupied.set(this.scene, rects);
    }
    rects.length = this.shown.length;
    for (let i = 0; i < this.shown.length; i += 1) {
      const p = this.shown[i];
      if (p === undefined) continue;
      const left = unitLeft(p);
      const top = unitTop(p);
      const r = rects[i] ?? { x: 0, y: 0, w: 0, h: 0 };
      r.x = left;
      r.y = top;
      r.w = unitRight(p) - left;
      r.h = unitBottom(p) - top;
      rects[i] = r;
    }

    // --- chevrons -----------------------------------------------------------
    let used = 0;
    for (const t of model.threats) {
      if (used >= MAX_CHEVRONS) break;
      const sx = t.x - view.x;
      const sy = t.y - view.y;
      if (sx > 0 && sx < view.width && sy > 0 && sy < view.height) continue;
      const g = this.chevrons[used];
      if (g === undefined) break;
      if (this.chevronLook[used] !== t.boss || !g.visible) {
        this.chevronLook[used] = t.boss;
        paintTriangle(g, t.boss ? CHEVRON.boss : CHEVRON.elite, IDENTITY.threat, true);
      }
      clampToRing(sx, sy, (t.boss ? CHEVRON.boss : CHEVRON.elite) / 2, this.point);
      g.setPosition(this.point.x, this.point.y)
        .setRotation(Math.atan2(sy - heroY, sx - heroX))
        .setVisible(true);
      used += 1;
    }
    for (let i = used; i < this.chevrons.length; i += 1) this.chevrons[i]?.setVisible(false);
  }

  /** Live loop tweens this widget owns (tween-leak probe for the integrator/QA). */
  get liveLoops(): number {
    let n = this.chestArrow.loops + this.eventArrow.loops;
    for (const a of this.gateArrows.values()) n += a.loops;
    return n;
  }

  private project(
    arrow: Arrow,
    look: Look,
    label: string,
    sx: number,
    sy: number,
    heroX: number,
    heroY: number,
    view: Phaser.Geom.Rectangle,
    keepChipOnScreen: boolean,
  ): void {
    const onScreen =
      sx > ONSCREEN_INSET && sx < view.width - ONSCREEN_INSET && sy > ONSCREEN_INSET && sy < view.height - ONSCREEN_INSET;
    if (onScreen && !keepChipOnScreen) {
      arrow.hide();
      return;
    }
    const chipWidth = arrow.prepare(look, label);
    if (onScreen) {
      this.point.x = sx;
      this.point.y = sy;
    } else clampToRing(sx, sy, ARROW_SIZE / 2, this.point);
    const { x, y } = this.point;
    const half = chipWidth / 2;
    const arrowHalf = ARROW_SIZE / 2;
    // A head clamped to a SIDE edge takes its chip beside it, inboard: the unit is
    // then one arrow tall, so five of them stack along the edge between the toast
    // lane and the belt (critic v2c: units stacked 93 px tall overflowed both).
    const onLeft = !onScreen && x <= RING.left + arrowHalf;
    const onRight = !onScreen && x >= RING.right - arrowHalf;
    let chipX: number;
    let chipY: number;
    if (onLeft || onRight) {
      chipX = onLeft ? x + arrowHalf + CHIP_GAP + half : x - arrowHalf - CHIP_GAP - half;
      chipY = y;
    } else {
      // Top/bottom edge: chip below the arrow, above it near the floor of its column.
      const columnFloor = x + arrowHalf > BELT.left - CHIP_GAP ? BELT_COLUMN_FLOOR : RING.bottom;
      chipX = Phaser.Math.Clamp(x, RING.left + half, RING.right - half);
      chipY = y > columnFloor - CHIP_OFFSET * 2 ? y - CHIP_OFFSET : y + CHIP_OFFSET;
    }
    this.shown.push({
      arrow,
      x,
      y,
      angle: Math.atan2(sy - heroY, sx - heroX),
      showHead: !onScreen,
      chipWidth,
      chipX,
      chipY,
    });
  }

  private gateArrow(id: GateId): Arrow {
    let arrow = this.gateArrows.get(id);
    if (arrow === undefined) {
      arrow = new Arrow(this.scene, id.toUpperCase());
      this.gateArrows.set(id, arrow);
    }
    return arrow;
  }

  /** `null` = no arrow for this gate now. */
  private gateLook(g: MinimapModel['gates'][number], now: number): Look | null {
    if (g.state === 'open' || g.state === 'closing') {
      this.lastLiveAt.set(g.id, now);
      return g.state;
    }
    // A gate that was live and is not any more flashes CLOSED for 2 s, then retires.
    const lastLive = this.lastLiveAt.get(g.id);
    if (lastLive !== undefined) return now - lastLive <= CLOSED_FLASH_MS ? 'closed' : null;
    if (g.state === 'spent') return null;
    const secs = labelSeconds(g.label);
    // Conditional gates without a clock (offering/bell before their condition) always show.
    if (secs === null) return g.id === 'x' ? 'preview' : null;
    return secs <= this.previewS ? 'preview' : null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const arrow of this.gateArrows.values()) arrow.destroy();
    this.gateArrows.clear();
    this.chestArrow.destroy();
    this.eventArrow.destroy();
    for (const g of this.chevrons) g.destroy();
    occupied.delete(this.scene);
    this.chevrons.length = 0;
    this.lastLiveAt.clear();
  }
}

function rank(look: Look): number {
  return look === 'closing' ? 0 : look === 'open' ? 1 : look === 'closed' ? 2 : 3;
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
