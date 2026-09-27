/**
 * Colony map rendering (PRD §4 Rendering, §11, `art/wiring.md`) inside the
 * camera's worldRoot, every content id drawn with generated art:
 *
 *   terrain chunks → deposits → relics → night grade → lit glow (ADD) → field
 *   edge → ruins → buildings (y-sorted) → range ring → fog → valid glow →
 *   fauna → fx → drones
 *
 * Nothing redraws per frame: the lit glow and fog are cols × rows canvas
 * textures stretched 64× (bilinear = feathered edges) rewritten only when
 * `fieldVersion` changes; buildings diff their state before touching a
 * sprite; fauna sprites are pooled per sim slot.
 */
import Phaser from 'phaser';
import { NIGHT_GRADE_ALPHA, PALETTE } from '../../../config';
import { safePlay } from '../../../core/anim';
import { outlineKey, type OutlinePx } from '../../../core/outline';
import { COLONY_TUNING } from '../tuning';
import { buildingDef, type BuildingId, type FaunaId } from '../content';
import type { BuildingInst, ColonyState } from '../model/state';
import type { Fauna, FaunaSim } from '../threat/fauna';
import { TerrainLayer } from './terrain';
import {
  CRACKS_KEY,
  CRACK_FRAME,
  DEPOSIT_DRAW_PX,
  DEPOSIT_KEY,
  FAUNA_ART,
  FX,
  MOTION,
  RELICS_KEY,
  RELIC_DRAW_PX,
  RELIC_FRAME,
  SILENT_BADGE,
  WORK_LOOP,
  buildingDrawPx,
  buildingTexture,
  frostKey,
  groundInset,
  ruinKey,
  scaffoldKey,
} from './artMap';

const TILE = COLONY_TUNING.map.tilePx;
/** Field edge: art-locked literal (interface-direction §1: #e0a458 at alpha 0.6). */
const FIELD_EDGE = 0xe0a458;
const FIELD_EDGE_ALPHA = 0.6;
/** Lit ground brightening (§13 Nightfall: +12 %) by day / night. */
const GLOW_DAY = 0.1;
const GLOW_NIGHT = 0.24;
const FOG_ALPHA = 0.86;
const DARK_TINT = 0x6d6878;
const FROST_ALPHA = 0.6;
const SCAFFOLD_MS = 380;
/** §13 Building completes: amber additive flash on the footprint. */
const COMPLETE_FLASH_MS = 120;
const COMPLETE_FLASH = 0xe0a458;
/** §13 Fauna hit: white fill flash; Fauna death: corpse fade. */
const HIT_FLASH_MS = 60;
const CORPSE_FADE_MS = 400;
const CORPSE_TINT = 0x8a8090;
/** Night readability: the field edge breathes between these alphas (yoyo, 1.2 s half-period). */
const EDGE_BREATH = { lo: 0.35, hi: 0.95, ms: 1200 } as const;
/** §13 Beacon trigger: the charge ring around the Spire. */
const CHARGE_RING = { width: 8, pad: 18 } as const;
const BEACON_RISE = 'beacon-rise';
/** Screen bands owned by the HUD (interface-direction §5): shell + status + banner + alert rail edge, and tray + dock. */
const HUD_BANDS: ReadonlyArray<readonly [number, number]> = [[0, 332], [868, 1060]];

const ARMOUR_TEXT = {
  fontFamily: '"Arial Black", system-ui, sans-serif',
  fontSize: '22px',
  color: '#efe6d4',
  stroke: '#1a1418',
  strokeThickness: 4,
  align: 'center',
} as const;

interface BuildingView {
  uid: number;
  def: BuildingId;
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Sprite;
  draw: number;
  frost: Phaser.GameObjects.Image | null;
  crack: Phaser.GameObjects.Image | null;
  pips: Phaser.GameObjects.Graphics | null;
  badge: Phaser.GameObjects.Image | null;
  beam: Phaser.GameObjects.Sprite | null;
  mark: Phaser.GameObjects.Text | null;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFill: Phaser.GameObjects.Rectangle;
  /** scene time the scaffold hands over to the building (0 = done). */
  scaffoldUntil: number;
  lastTex: string;
  lastHp: number;
  lastDark: boolean | null;
  lastMk: number;
  lastMark: string;
  lastWork: boolean | null;
  lastCrack: number;
  lastCharging: boolean;
  /** Scene time the completion flash ends (0 = none). */
  flashUntil: number;
  /** Beacon charge ring (Spire only, while charging); `lastRing` = last drawn percent. */
  ring: Phaser.GameObjects.Graphics | null;
  lastRing: number;
  /** Loss ceremony forced the lights off. */
  off: boolean;
}

interface FaunaView {
  sprite: Phaser.GameObjects.Sprite;
  sparks: Phaser.GameObjects.Sprite | null;
  gen: number;
  attacking: boolean;
  sizePx: number;
  /** HP seen last sync (a drop = a hit). */
  lastHp: number;
  /** Scene time the white hit flash ends (0 = none). */
  flashUntil: number;
  /** Scene time the corpse started fading (0 = alive / hidden). */
  diedAt: number;
  /** A Static Leech held a relay last sync (the latch edge fires the `leech` voice). */
  latched: boolean;
  /** Behaviour timer seen last sync: a jump UP means the brood / stomp just fired. */
  lastCd: number;
  /** Scene time the one-shot brood / stomp sheet ends (0 = none playing). */
  specialUntil: number;
}

interface DepositView { img: Phaser.GameObjects.Image | null; hint: Phaser.GameObjects.Text | null }

/** Audio hooks the scene plays for view-detected beats (§13: building completes, moths inbound, fauna hit, leech latch). */
export interface MapViewHooks {
  built(uid: number): void;
  spawned(id: FaunaId): void;
  faunaHit(): void;
  latched(): void;
}

export class MapView {
  private readonly scene: Phaser.Scene;
  private readonly state: ColonyState;
  private readonly has: (key: string) => boolean;
  readonly terrain: TerrainLayer;
  private readonly nightGrade: Phaser.GameObjects.Rectangle;
  private readonly glowTex: Phaser.Textures.CanvasTexture | null;
  private readonly glowImg: Phaser.GameObjects.Image | null;
  private readonly fogTex: Phaser.Textures.CanvasTexture | null;
  private readonly edge: Phaser.GameObjects.Graphics;
  /** Build mode's valid-tile glow: drawn ABOVE the fog so relay tiles at the field edge read (critic2 #5). */
  readonly validGlow: Phaser.GameObjects.Graphics;
  readonly rangeRing: Phaser.GameObjects.Graphics;
  private readonly ruinLayer: Phaser.GameObjects.Container;
  private readonly buildingLayer: Phaser.GameObjects.Container;
  private readonly faunaLayer: Phaser.GameObjects.Container;
  /** World-space fx (bolts, bursts, floaters) — `view/fx.ts` draws here. */
  readonly fxLayer: Phaser.GameObjects.Container;
  /** Drones fly above the night grade so the amber reads (wiring §7). */
  readonly droneLayer: Phaser.GameObjects.Container;
  private readonly depositViews: DepositView[] = [];
  private readonly relicViews: Array<Phaser.GameObjects.Image | null> = [];
  private readonly ruinViews = new Map<string, Phaser.GameObjects.Image>();
  private readonly buildingViews = new Map<number, BuildingView>();
  private readonly faunaViews: FaunaView[] = [];
  private fieldVersion = -1;
  private buildVersion = -1;
  private ruinStamp = '';
  private patchMarked = false;
  private readonly clipAt = { x: NaN, y: NaN, z: NaN, n: -1, avoid: '' };
  /** Bumps when a hint or mark label is created (re-runs `clipLabels`). */
  private labelCount = 0;
  private nightOn = false;
  /** Night field-edge breathing loop (the one looping tween MapView owns; killed at dawn / lights-out / shutdown). */
  private breath: Phaser.Tweens.Tween | null = null;
  private ready = false;
  private readonly cullRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** Live fauna drawn last sync (cert composition probe). */
  liveFauna = 0;

  private readonly hooks: MapViewHooks;

  constructor(scene: Phaser.Scene, root: Phaser.GameObjects.Container, state: ColonyState, poolTag: string, hooks: MapViewHooks) {
    this.scene = scene;
    this.state = state;
    this.hooks = hooks;
    this.has = (key) => scene.textures.exists(key);
    const { cols, rows } = state.map;
    const worldW = cols * TILE;
    const worldH = rows * TILE;

    const terrainRoot = scene.add.container(0, 0);
    root.add(terrainRoot);
    this.terrain = new TerrainLayer(scene, terrainRoot, state.map, poolTag);

    const depositLayer = scene.add.container(0, 0);
    for (const d of state.map.deposits) {
      const key = DEPOSIT_KEY[d.kind];
      const img = this.has(key)
        ? scene.add.image((d.col + 1) * TILE, (d.row + 1) * TILE, key, d.purity).setDisplaySize(DEPOSIT_DRAW_PX, DEPOSIT_DRAW_PX).setVisible(false)
        : null;
      if (img !== null) depositLayer.add(img);
      this.depositViews.push({ img, hint: null });
    }
    for (const relic of state.map.relics) {
      const img = this.has(RELICS_KEY)
        ? scene.add.image((relic.col + 0.5) * TILE, (relic.row + 0.5) * TILE, RELICS_KEY, RELIC_FRAME[relic.id]).setDisplaySize(RELIC_DRAW_PX, RELIC_DRAW_PX).setVisible(false)
        : null;
      if (img !== null) depositLayer.add(img);
      this.relicViews.push(img);
    }

    this.nightGrade = scene.add.rectangle(0, 0, worldW, worldH, PALETTE.night, 1).setOrigin(0, 0).setAlpha(0);

    const tag = `${poolTag}-${cols}x${rows}`;
    this.glowTex = this.fieldCanvas(`field-glow-${tag}`, cols, rows);
    this.glowImg = this.glowTex === null ? null : scene.add.image(0, 0, this.glowTex.key).setOrigin(0, 0).setDisplaySize(worldW, worldH).setBlendMode(Phaser.BlendModes.ADD).setAlpha(GLOW_DAY);
    this.fogTex = this.fieldCanvas(`field-fog-${tag}`, cols, rows);
    const fogImg = this.fogTex === null ? null : scene.add.image(0, 0, this.fogTex.key).setOrigin(0, 0).setDisplaySize(worldW, worldH);
    this.edge = scene.add.graphics();
    this.ruinLayer = scene.add.container(0, 0);
    this.buildingLayer = scene.add.container(0, 0);
    this.rangeRing = scene.add.graphics();
    this.validGlow = scene.add.graphics();
    this.faunaLayer = scene.add.container(0, 0);
    this.fxLayer = scene.add.container(0, 0);
    this.droneLayer = scene.add.container(0, 0);
    root.add([depositLayer, this.nightGrade]);
    if (this.glowImg !== null) root.add(this.glowImg);
    root.add([this.edge, this.ruinLayer, this.buildingLayer, this.rangeRing]);
    if (fogImg !== null) root.add(fogImg);
    root.add([this.validGlow, this.faunaLayer, this.fxLayer, this.droneLayer]);

    if (!scene.anims.exists(BEACON_RISE) && this.has(MOTION.beaconCharging)) {
      // wiring §1: frames [2, 1, 0, 3] read as a monotonic rise.
      scene.anims.create({ key: BEACON_RISE, frames: scene.anims.generateFrameNumbers(MOTION.beaconCharging, { frames: [2, 1, 0, 3] }), frameRate: 1000 / 150, repeat: -1 });
    }
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.stopBreath();
      for (const t of [this.glowTex, this.fogTex]) if (t !== null && scene.textures.exists(t.key)) scene.textures.remove(t.key);
    });
  }

  private fieldCanvas(key: string, cols: number, rows: number): Phaser.Textures.CanvasTexture | null {
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    return this.scene.textures.createCanvas(key, cols, rows);
  }

  /** Night grade eases in at nightfall (600 ms) and out at dawn (800 ms); lit ground brightens; the field edge breathes all night. */
  setNight(on: boolean, calm: boolean): void {
    if (on === this.nightOn) return;
    this.nightOn = on;
    const duration = calm ? 0 : on ? 600 : 800;
    const ease = on ? 'Quad.easeIn' : 'Sine.easeOut';
    this.scene.tweens.add({ targets: this.nightGrade, alpha: on ? NIGHT_GRADE_ALPHA : 0, duration, ease });
    if (this.glowImg !== null) this.scene.tweens.add({ targets: this.glowImg, alpha: on ? GLOW_NIGHT : GLOW_DAY, duration, ease });
    this.stopBreath();
    if (on && !calm) this.startBreath();
  }

  /** Reduce motion toggled mid-Landing (QA#3): the night breathing loop stops or resumes at once. */
  setCalm(calm: boolean): void {
    if (calm) this.stopBreath();
    else if (this.nightOn && this.breath === null) this.startBreath();
  }

  private startBreath(): void {
    this.breath = this.scene.tweens.add({ targets: this.edge, alpha: { from: EDGE_BREATH.hi, to: EDGE_BREATH.lo }, duration: EDGE_BREATH.ms, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
  }

  /**
   * World labels never render inside the HUD bands (flow F7): a deposit hint or
   * building mark whose screen rect touches the status + banner band or the
   * tray + dock band is hidden (alpha 0) until the camera moves it out.
   * Re-evaluated only when the camera transform changed.
   */
  clipLabels(rootX: number, rootY: number, zoom: number, avoid: ReadonlyArray<{ x: number; y: number; w: number; h: number }>): void {
    const c = this.clipAt;
    let key = '';
    for (const a of avoid) key += `${Math.round(a.x)},${Math.round(a.y)};`;
    if (c.x === rootX && c.y === rootY && c.z === zoom && c.n === this.labelCount && c.avoid === key) return;
    c.x = rootX;
    c.y = rootY;
    c.z = zoom;
    c.n = this.labelCount;
    c.avoid = key;
    // Screen-space test: HUD bands, and (critic build4) world labels yield to the dusk arrows + their counts.
    const blocked = (worldLeft: number, worldTop: number, worldRight: number, worldBottom: number): boolean => {
      const left = rootX + worldLeft * zoom;
      const right = rootX + worldRight * zoom;
      const top = rootY + worldTop * zoom;
      const bottom = rootY + worldBottom * zoom;
      if (HUD_BANDS.some(([b0, b1]) => bottom > b0 && top < b1)) return true;
      return avoid.some((a) => right > a.x && left < a.x + a.w && bottom > a.y && top < a.y + a.h);
    };
    for (const v of this.depositViews) {
      const h = v.hint;
      if (h === null) continue;
      h.setAlpha(blocked(h.x - h.width / 2, h.y, h.x + h.width / 2, h.y + h.height) ? 0 : 0.9);
    }
    for (const v of this.buildingViews.values()) {
      const m = v.mark;
      if (m === null) continue;
      const x = v.root.x + m.x;
      const y = v.root.y + m.y;
      m.setAlpha(blocked(x - m.width / 2, y - m.height / 2, x + m.width / 2, y + m.height / 2) ? 0 : 1);
    }
  }

  private stopBreath(): void {
    this.breath?.remove();
    this.breath = null;
    this.edge.setAlpha(1);
  }

  /** Live looping tweens MapView registered (tween-hygiene probe). */
  get loops(): number {
    return this.breath === null ? 0 : 1;
  }

  /** Brownout: the field glow flickers three times (the redraw then contracts it). */
  flickerField(): void {
    if (this.glowImg === null) return;
    const base = this.nightOn ? GLOW_NIGHT : GLOW_DAY;
    this.scene.tweens.add({ targets: this.glowImg, alpha: { from: base * 0.2, to: base }, duration: 70, repeat: 2, ease: 'Expo.easeIn', onComplete: () => this.glowImg?.setAlpha(base) });
  }

  /** World-space camera rect → terrain chunk residency (re-culled only when the rect moved a tile). */
  cull(x0: number, y0: number, x1: number, y1: number): void {
    const r = this.cullRect;
    if (Math.abs(r.x0 - x0) < TILE / 2 && Math.abs(r.y0 - y0) < TILE / 2 && Math.abs(r.x1 - x1) < TILE / 2 && Math.abs(r.y1 - y1) < TILE / 2 && this.ready) return;
    r.x0 = x0;
    r.y0 = y0;
    r.x1 = x1;
    r.y1 = y1;
    this.terrain.cull(x0, y0, x1, y1);
  }

  sync(fauna: FaunaSim, now: number): void {
    if (this.state.fieldVersion !== this.fieldVersion) {
      this.fieldVersion = this.state.fieldVersion;
      this.redrawField();
    }
    if (this.state.buildVersion !== this.buildVersion) {
      this.buildVersion = this.state.buildVersion;
      this.syncBuildingSet(now);
      this.syncDepositHints();
    }
    const ruins = this.state.ruins;
    const ruinStamp = `${ruins.length}:${ruins[ruins.length - 1]?.col ?? -1}:${ruins[0]?.row ?? -1}`;
    if (ruinStamp !== this.ruinStamp) {
      this.ruinStamp = ruinStamp;
      this.syncRuins();
    }
    for (const b of this.state.buildings.values()) this.syncBuilding(b, now);
    this.syncFauna(fauna.pool, now);
    this.ready = true;
  }

  private redrawField(): void {
    const { cols, rows } = this.state.map;
    const { lit, revealed } = this.state;
    const n = cols * rows;
    if (this.glowTex !== null) {
      const ctx = this.glowTex.getContext();
      const img = ctx.createImageData(cols, rows);
      for (let i = 0; i < n; i += 1) {
        if (lit[i] !== 1) continue;
        img.data[i * 4] = 0xe0;
        img.data[i * 4 + 1] = 0xa4;
        img.data[i * 4 + 2] = 0x58;
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      this.glowTex.refresh();
    }
    if (this.fogTex !== null) {
      const ctx = this.fogTex.getContext();
      const img = ctx.createImageData(cols, rows);
      const a = Math.round(FOG_ALPHA * 255);
      for (let i = 0; i < n; i += 1) {
        if (revealed[i] === 1) continue;
        img.data[i * 4] = 0x1a;
        img.data[i * 4 + 1] = 0x14;
        img.data[i * 4 + 2] = 0x18;
        img.data[i * 4 + 3] = a;
      }
      ctx.putImageData(img, 0, 0);
      this.fogTex.refresh();
    }
    // Hard amber line where lit meets dark: the dome boundary.
    const g = this.edge;
    g.clear();
    g.lineStyle(3, FIELD_EDGE, FIELD_EDGE_ALPHA);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (lit[r * cols + c] !== 1) continue;
        if (c + 1 >= cols || lit[r * cols + c + 1] !== 1) g.lineBetween((c + 1) * TILE, r * TILE, (c + 1) * TILE, (r + 1) * TILE);
        if (c === 0 || lit[r * cols + c - 1] !== 1) g.lineBetween(c * TILE, r * TILE, c * TILE, (r + 1) * TILE);
        if (r + 1 >= rows || lit[(r + 1) * cols + c] !== 1) g.lineBetween(c * TILE, (r + 1) * TILE, (c + 1) * TILE, (r + 1) * TILE);
        if (r === 0 || lit[(r - 1) * cols + c] !== 1) g.lineBetween(c * TILE, r * TILE, (c + 1) * TILE, r * TILE);
      }
    }
    // Deposits: full art on revealed ground, a dark silhouette within ping range of the field, hidden beyond.
    const ping = COLONY_TUNING.field.pingRadiusTiles;
    this.state.map.deposits.forEach((d, i) => {
      const img = this.depositViews[i]?.img;
      if (img === null || img === undefined) return;
      const seen = revealed[d.row * cols + d.col] === 1;
      let near = seen;
      for (let dr = -ping; dr <= ping && !near; dr += 2) {
        for (let dc = -ping; dc <= ping; dc += 2) {
          const c = d.col + dc;
          const r = d.row + dr;
          if (c >= 0 && r >= 0 && c < cols && r < rows && lit[r * cols + c] === 1 && dc * dc + dr * dr <= ping * ping) {
            near = true;
            break;
          }
        }
      }
      img.setVisible(near);
      if (seen) img.clearTint().setAlpha(1);
      else img.setTint(0x2b2230).setAlpha(0.7);
    });
    this.state.map.relics.forEach((relic, i) => {
      this.relicViews[i]?.setVisible(!relic.claimed && revealed[relic.row * cols + relic.col] === 1);
    });
    this.syncDepositHints();
  }

  /** Revealed deposits the field does not cover say so on the map (critic2 #5: grid-edge deposits legible). */
  private syncDepositHints(): void {
    const { cols } = this.state.map;
    const { lit, revealed, occ } = this.state;
    this.state.map.deposits.forEach((d, i) => {
      const v = this.depositViews[i];
      if (v === undefined) return;
      const at = d.row * cols + d.col;
      let allLit = true;
      for (let dr = 0; dr < 2; dr += 1) for (let dc = 0; dc < 2; dc += 1) if (lit[at + dr * cols + dc] !== 1) allLit = false;
      const show = revealed[at] === 1 && !allLit && (occ[at] ?? 0) === 0;
      if (show && v.hint === null) {
        v.hint = this.scene.add.text((d.col + 1) * TILE, (d.row + 2) * TILE + 4, 'OUTSIDE\nTHE GRID', ARMOUR_TEXT).setOrigin(0.5, 0).setAlpha(0.9);
        this.labelCount += 1;
        this.fxLayer.parentContainer?.addAt(v.hint, this.fxLayer.parentContainer.getIndex(this.validGlow));
      }
      v.hint?.setVisible(show);
    });
  }

  private syncRuins(): void {
    const live = new Set<string>();
    for (const r of this.state.ruins) {
      const id = `${r.col}:${r.row}`;
      live.add(id);
      if (this.ruinViews.has(id)) continue;
      const f = buildingDef(r.def).footprint;
      const key = ruinKey(f);
      if (!this.has(key)) continue;
      const draw = buildingDrawPx(f);
      const img = this.scene.add
        .image((r.col + f / 2) * TILE, (r.row + f) * TILE + groundInset(r.def, f) * draw, key)
        .setOrigin(0.5, 1)
        .setDisplaySize(draw, draw)
        .setAlpha(0.8);
      this.ruinLayer.add(img);
      this.ruinViews.set(id, img);
    }
    for (const [id, img] of this.ruinViews) {
      if (live.has(id)) continue;
      img.destroy();
      this.ruinViews.delete(id);
    }
  }

  private syncBuildingSet(now: number): void {
    for (const [uid, v] of this.buildingViews) {
      if (this.state.buildings.has(uid)) continue;
      this.scene.tweens.killTweensOf([v.root, v.body]);
      v.root.destroy();
      this.buildingViews.delete(uid);
    }
    let added = false;
    for (const b of this.state.buildings.values()) {
      if (this.buildingViews.has(b.uid)) continue;
      added = true;
      const f = buildingDef(b.def).footprint;
      const draw = buildingDrawPx(f);
      const root = this.scene.add.container((b.col + f / 2) * TILE, (b.row + f) * TILE);
      const inset = groundInset(b.def, f) * draw;
      const body = this.scene.add.sprite(0, inset, buildingTexture(b.def, b.mk, this.has)).setOrigin(0.5, 1).setDisplaySize(draw, draw);
      const barW = Math.min(draw - 16, 96);
      const hpBg = this.scene.add.rectangle(-barW / 2, -draw * 0.86, barW, 8, PALETTE.bgDeep, 0.85).setOrigin(0, 0).setVisible(false);
      const hpFill = this.scene.add.rectangle(-barW / 2 + 1, -draw * 0.86 + 1, barW - 2, 6, PALETTE.good, 1).setOrigin(0, 0).setVisible(false);
      root.add([body, hpBg, hpFill]);
      this.buildingLayer.add(root);
      const v: BuildingView = {
        uid: b.uid, def: b.def, root, body, draw, frost: null, crack: null, pips: null, badge: null, beam: null, mark: null, hpBg, hpFill,
        scaffoldUntil: 0, lastTex: '', lastHp: -1, lastDark: null, lastMk: 0, lastMark: '', lastWork: null, lastCrack: -1, lastCharging: false,
        flashUntil: 0, ring: null, lastRing: -1, off: false,
      };
      // Placement (§13): scaffold unfolds scale-Y 0.2 → 1 in 220 ms, then hands over to the building with a pop.
      const scaffold = scaffoldKey(f);
      if (this.ready && this.has(scaffold)) {
        v.scaffoldUntil = now + SCAFFOLD_MS;
        body.setTexture(scaffold).setDisplaySize(draw, draw);
        v.lastTex = scaffold;
        const sy = body.scaleY;
        body.setScale(body.scaleX, sy * 0.2);
        this.scene.tweens.add({ targets: body, scaleY: sy, duration: 220, ease: 'Back.easeOut' });
      }
      this.buildingViews.set(b.uid, v);
    }
    if (added) this.buildingLayer.sort('y');
  }

  private syncBuilding(b: BuildingInst, now: number): void {
    const v = this.buildingViews.get(b.uid);
    if (v === undefined) return;
    if (v.scaffoldUntil > 0) {
      if (now < v.scaffoldUntil) return;
      v.scaffoldUntil = 0;
      v.lastTex = '';
      // Completion (§13): pop 1.12 over 120 ms + amber flash on the footprint + the `build` voice.
      this.scene.tweens.add({ targets: v.root, scale: { from: 1.12, to: 1 }, duration: 120, ease: 'Quad.easeOut' });
      v.flashUntil = now + COMPLETE_FLASH_MS;
      this.hooks.built(b.uid);
    }
    // The beam holds through the launch payoff (§13 "beam to sky"), not just the charge.
    const charging = b.def === 'beacon_spire' && (this.state.beacon === 'charging' || this.state.beacon === 'launched');
    const tex = charging && this.has(MOTION.beaconCharging) ? MOTION.beaconCharging : buildingTexture(b.def, b.mk, this.has);
    if (tex !== v.lastTex) {
      v.lastTex = tex;
      v.lastWork = null;
      v.body.stop();
      v.body.setTexture(tex, 0).setDisplaySize(v.draw, v.draw);
    }
    if (charging !== v.lastCharging) {
      v.lastCharging = charging;
      if (charging) {
        safePlay(v.body, BEACON_RISE);
        if (v.beam === null && this.has(FX.beaconBeam)) {
          v.beam = this.scene.add.sprite(0, -v.draw * 0.7, FX.beaconBeam).setOrigin(0.5, 0.92).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(v.draw * 0.9, v.draw * 3);
          v.root.add(v.beam);
          safePlay(v.beam, FX.beaconBeam);
        }
        if (v.ring === null) {
          v.ring = this.scene.add.graphics();
          v.root.add(v.ring);
        }
      } else {
        v.beam?.destroy();
        v.beam = null;
        v.ring?.destroy();
        v.ring = null;
        v.lastRing = -1;
      }
    }
    if (v.ring !== null) {
      // §13 Beacon trigger: the charge ring fills around the Spire (redrawn per whole percent).
      const pct = Math.floor(this.state.beaconCharge * 100);
      if (pct !== v.lastRing) {
        v.lastRing = pct;
        const r = v.draw * 0.5 + CHARGE_RING.pad;
        const cy = -v.draw * 0.45;
        const start = -Math.PI / 2;
        v.ring.clear();
        v.ring.lineStyle(CHARGE_RING.width + 6, PALETTE.bgDeep, 0.8).strokeCircle(0, cy, r);
        v.ring.lineStyle(CHARGE_RING.width, PALETTE.accent, 1).beginPath().arc(0, cy, r, start, start + (Math.PI * 2 * pct) / 100, false).strokePath();
      }
    }
    const work = WORK_LOOP[b.def] === true && b.lit && b.working && !b.paused && b.staffed > 0 && !v.off;
    if (work !== v.lastWork && !charging) {
      v.lastWork = work;
      if (work) safePlay(v.body, tex, true);
      else v.body.stop().setFrame(0);
    }
    const dark = !b.lit || v.off;
    if (dark !== v.lastDark) {
      v.lastDark = dark;
      if (dark) v.body.setTint(DARK_TINT);
      else v.body.clearTint();
      const fk = frostKey(buildingDef(b.def).footprint);
      if (dark && this.state.isNight && v.frost === null && this.has(fk)) {
        v.frost = this.scene.add.image(0, v.body.y, fk).setOrigin(0.5, 1).setDisplaySize(v.draw, v.draw).setAlpha(0.001);
        v.root.addAt(v.frost, v.root.getIndex(v.body) + 1);
      }
      if (v.frost !== null) this.scene.tweens.add({ targets: v.frost, alpha: dark && this.state.isNight ? FROST_ALPHA : 0.001, duration: 400, ease: 'Sine.easeOut' });
    }
    if (v.flashUntil !== 0) {
      if (now < v.flashUntil) v.body.setTint(COMPLETE_FLASH).setTintMode(Phaser.TintModes.ADD);
      else {
        v.flashUntil = 0;
        v.body.setTintMode(Phaser.TintModes.MULTIPLY);
        if (dark) v.body.setTint(DARK_TINT);
        else v.body.clearTint();
      }
    }
    const ratio = b.maxHp > 0 ? b.hp / b.maxHp : 1;
    const hpKey = Math.round(ratio * 40);
    if (hpKey !== v.lastHp) {
      v.lastHp = hpKey;
      const damaged = ratio < 0.995;
      v.hpBg.setVisible(damaged);
      v.hpFill.setVisible(damaged).setScale(Math.max(0, ratio), 1).setFillStyle(ratio < 0.35 ? PALETTE.bad : PALETTE.good);
      const crack = ratio <= 0.33 ? CRACK_FRAME.heavy : ratio <= 0.66 ? CRACK_FRAME.light : -1;
      if (crack !== v.lastCrack) {
        v.lastCrack = crack;
        if (crack >= 0 && v.crack === null && this.has(CRACKS_KEY)) {
          v.crack = this.scene.add.image(0, -v.draw * 0.4, CRACKS_KEY, crack).setDisplaySize(v.draw * 0.6, v.draw * 0.6);
          v.root.addAt(v.crack, v.root.getIndex(v.body) + 1);
        }
        if (v.crack !== null) {
          v.crack.setVisible(crack >= 0);
          if (crack >= 0) v.crack.setFrame(crack);
        }
      }
    }
    if (b.mk !== v.lastMk) {
      v.lastMk = b.mk;
      if (b.mk > 1) {
        v.pips ??= this.scene.add.graphics();
        if (v.pips.parentContainer !== v.root) v.root.add(v.pips);
        v.pips.clear();
        const n = b.mk - 1;
        const x0 = -v.draw / 2 + 10;
        const y0 = -v.draw * 0.82;
        for (let i = 0; i < n; i += 1) {
          const x = x0 + i * 16;
          v.pips.fillStyle(PALETTE.bgDeep, 1).fillCircle(x, y0, 8);
          v.pips.fillStyle(PALETTE.primary, 1).fillCircle(x, y0, 5.5);
        }
      }
      const silent = b.mk === 4 && SILENT_BADGE[b.def] === true && this.state.evolved.includes('p_silent');
      if (silent && v.badge === null && this.has(MOTION.silentBadge)) {
        v.badge = this.scene.add.image(v.draw * 0.32, -v.draw * 0.78, MOTION.silentBadge).setDisplaySize(30, 30);
        v.root.add(v.badge);
      }
    }
    const mark = b.paused ? 'II' : b.shed ? 'OFF' : b.pinned ? 'PIN' : '';
    if (mark !== v.lastMark) {
      v.lastMark = mark;
      if (mark !== '' && v.mark === null) {
        v.mark = this.scene.add.text(0, -v.draw * 0.5, '', ARMOUR_TEXT).setOrigin(0.5);
        this.labelCount += 1;
        v.root.add(v.mark);
      }
      v.mark?.setText(mark).setVisible(mark !== '');
    }
  }

  private syncFauna(pool: readonly Fauna[], now: number): void {
    let live = 0;
    for (let i = 0; i < pool.length; i += 1) {
      const f = pool[i];
      if (f === undefined) continue;
      let v = this.faunaViews[i];
      if (v === undefined) {
        const sprite = this.scene.add.sprite(0, 0, FAUNA_ART.skitter.walk).setVisible(false);
        this.faunaLayer.add(sprite);
        v = { sprite, sparks: null, gen: -1, attacking: false, sizePx: 0, lastHp: 0, flashUntil: 0, diedAt: 0, latched: false, lastCd: 0, specialUntil: 0 };
        this.faunaViews[i] = v;
      }
      if (!f.alive) {
        if (!v.sprite.visible) continue;
        // Fauna death (§13): the corpse stops, greys and fades over 400 ms (no hitstop).
        if (v.diedAt === 0) {
          v.diedAt = now;
          v.flashUntil = 0;
          v.latched = false;
          v.sprite.stop().setTintMode(Phaser.TintModes.MULTIPLY).setTint(CORPSE_TINT);
          v.sparks?.setVisible(false).stop();
        }
        const t = (now - v.diedAt) / CORPSE_FADE_MS;
        if (t >= 1) {
          v.sprite.setVisible(false);
          v.diedAt = 0;
        } else v.sprite.setAlpha(Math.min(v.sprite.alpha, 1 - t));
        continue;
      }
      live += 1;
      const art = FAUNA_ART[f.def.id];
      if (v.gen !== f.gen) {
        v.gen = f.gen;
        v.attacking = false;
        v.sizePx = f.def.sizePx;
        v.lastHp = f.hp;
        v.flashUntil = 0;
        v.diedAt = 0;
        v.latched = false;
        v.lastCd = f.cd;
        v.specialUntil = 0;
        const walk = this.actorKey(art.walk, art.px);
        v.sprite.setTexture(walk, 0).setOrigin(0.5, art.groundY).setVisible(true).setAlpha(1).setFlipX(false).setTintMode(Phaser.TintModes.MULTIPLY).clearTint();
        v.sprite.setScale(art.cellPx / Math.max(1, v.sprite.frame.width));
        safePlay(v.sprite, walk);
        if (this.ready) this.hooks.spawned(f.def.id);
      }
      // Fauna hit (§13): white fill flash for 60 ms + the `hit` voice (capped by the scene).
      if (f.hp < v.lastHp) {
        if (v.flashUntil === 0) v.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
        v.flashUntil = now + HIT_FLASH_MS;
        this.hooks.faunaHit();
      } else if (v.flashUntil !== 0 && now >= v.flashUntil) {
        v.flashUntil = 0;
        v.sprite.setTintMode(Phaser.TintModes.MULTIPLY).clearTint();
      }
      v.lastHp = f.hp;
      if ((f.faceX < 0) !== v.sprite.flipX) v.sprite.setFlipX(f.faceX < 0);
      v.sprite.setPosition(f.x, f.y);
      // A burrowed Tunnel Grub reads as a faint shape under the dust; retreaters fade.
      const alpha = f.hidden ? 0.3 : f.retreating ? 0.55 : 1;
      if (v.sprite.alpha !== alpha) v.sprite.setAlpha(alpha);
      const attacking = f.chewing !== 0 && !f.retreating && f.stunSec <= 0;
      // Matron brood / Titan stomp (wiring §6): the sim re-arms `cd` the tick the behaviour fires, so a
      // jump up in `cd` is the moment — play the one-shot sheet, then hand back to walk / attack.
      const special = art.special;
      if (special !== undefined && f.cd > v.lastCd + 0.25 && !f.retreating) {
        v.specialUntil = now + special.ms;
        v.sprite.setOrigin(0.5, special.groundY);
        safePlay(v.sprite, this.actorKey(special.key, art.px));
      }
      v.lastCd = f.cd;
      if (v.specialUntil !== 0) {
        if (now < v.specialUntil) {
          v.attacking = attacking;
        } else {
          v.specialUntil = 0;
          v.sprite.setOrigin(0.5, art.groundY);
          safePlay(v.sprite, this.actorKey(attacking ? art.attack : art.walk, art.px));
          v.attacking = attacking;
        }
      } else {
        const key = this.actorKey(attacking ? art.attack : art.walk, art.px);
        if (attacking) safePlay(v.sprite, key, true);
        else if (v.attacking) safePlay(v.sprite, key);
        v.attacking = attacking;
      }
      // Leech latch (§13): sparks crackle on the relay while a Static Leech holds it; the latch itself is voiced.
      const leeching = f.latched !== 0;
      if (leeching && !v.latched) this.hooks.latched();
      v.latched = leeching;
      if (leeching && v.sparks === null && this.has(FX.leechSparks)) {
        v.sparks = this.scene.add.sprite(0, 0, FX.leechSparks).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(72, 72);
        this.faunaLayer.add(v.sparks);
      }
      if (v.sparks !== null) {
        if (leeching !== v.sparks.visible) {
          v.sparks.setVisible(leeching);
          if (leeching) safePlay(v.sparks, FX.leechSparks);
          else v.sparks.stop();
        }
        if (leeching) v.sparks.setPosition(f.x + (v.sprite.flipX ? -28 : 28), f.y - 20);
      }
    }
    this.liveFauna = live;
  }

  /** The outlined twin of a sheet when baked (Preload), else the plain sheet. */
  private actorKey(key: string, px: OutlinePx): string {
    const ol = outlineKey(key, px);
    return this.has(ol) ? ol : key;
  }

  /** Building's world anchor (footprint centre, or its top for beams / floaters). */
  anchorOf(uid: number, out: { x: number; y: number }, top = false): boolean {
    const v = this.buildingViews.get(uid);
    if (v === undefined) return false;
    out.x = v.root.x;
    out.y = top ? v.root.y - v.draw * 0.8 : v.root.y - v.draw * 0.45;
    return true;
  }

  /** Damage read (§13): 3 px sprite shake on the building. */
  jolt(uid: number): void {
    const v = this.buildingViews.get(uid);
    if (v === undefined || v.scaffoldUntil > 0) return;
    this.scene.tweens.add({ targets: v.body, x: { from: -3, to: 0 }, duration: 120, ease: 'Sine.easeOut' });
  }

  /** Brownout shed: the relay flickers three times, then settles dark (sync applies the dark tint). */
  flicker(uid: number): void {
    const v = this.buildingViews.get(uid);
    if (v === undefined) return;
    this.scene.tweens.add({ targets: v.body, alpha: { from: 0.25, to: 1 }, duration: 110, repeat: 2, ease: 'Expo.easeIn', onComplete: () => v.body.setAlpha(1) });
  }

  /** Loss ceremony: buildings go dark one by one from the map edges inward over `spanMs`. */
  lightsOff(spanMs: number): void {
    const { cols, rows } = this.state.map;
    const views = [...this.buildingViews.values()];
    const edgeDist = (v: BuildingView): number => {
      const c = v.root.x / TILE;
      const r = v.root.y / TILE;
      return Math.min(c, r, cols - c, rows - r);
    };
    views.sort((a, b) => edgeDist(a) - edgeDist(b));
    const step = views.length > 1 ? spanMs / views.length : 0;
    views.forEach((v, i) => {
      this.scene.time.delayedCall(i * step, () => {
        v.off = true;
        v.lastDark = null;
      });
    });
    this.stopBreath();
    this.scene.tweens.add({ targets: this.edge, alpha: 0, duration: spanMs, ease: 'Quad.easeIn' });
    if (this.glowImg !== null) this.scene.tweens.add({ targets: this.glowImg, alpha: 0, duration: spanMs, ease: 'Quad.easeIn' });
  }

  /** Tap acknowledgement: a primary outline around a tapped deposit patch (cleared by the next `showRing`). */
  markPatch(col: number, row: number, size: number): void {
    this.patchMarked = true;
    this.rangeRing.clear();
    this.rangeRing.lineStyle(4, PALETTE.primary, 0.95).strokeRoundedRect(col * TILE + 2, row * TILE + 2, size * TILE - 4, size * TILE - 4, 10);
  }

  /** Drops the patch outline once its chip is gone (no redraw when none is shown). */
  clearPatch(): void {
    if (!this.patchMarked) return;
    this.patchMarked = false;
    this.rangeRing.clear();
  }

  showRing(col: number, row: number, radiusTiles: number | null): void {
    this.patchMarked = false;
    this.rangeRing.clear();
    if (radiusTiles === null) return;
    this.rangeRing.lineStyle(3, PALETTE.primary, 0.85).strokeCircle(col * TILE, row * TILE, radiusTiles * TILE);
    this.rangeRing.fillStyle(PALETTE.primary, 0.06).fillCircle(col * TILE, row * TILE, radiusTiles * TILE);
  }

  /** Composition probe (cert): what is drawn right now; fauna by visible long edge (= sizePx by construction), in on-screen px at `zoom`. */
  composition(zoom: number): { fauna: number; faunaLongEdgePx: number[]; buildings: number; buildingPx: number[]; props: number; ruins: number } {
    const sizes: number[] = [];
    for (const v of this.faunaViews) if (v.sprite.visible) sizes.push(Math.round(v.sizePx * zoom));
    const bpx: number[] = [];
    for (const v of this.buildingViews.values()) bpx.push(Math.round(v.draw * zoom));
    return { fauna: this.liveFauna, faunaLongEdgePx: sizes, buildings: this.buildingViews.size, buildingPx: bpx, props: this.terrain.visibleProps, ruins: this.ruinViews.size };
  }
}
