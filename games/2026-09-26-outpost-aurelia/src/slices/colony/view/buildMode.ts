/**
 * Sticky build mode (PRD §3, §4 Placement input): arm once, every tap on a
 * valid tile places another copy until DONE / ESC / dock re-tap /
 * unaffordable. Valid tiles glow; extractors glow only on matching lit
 * deposits. The template PlacementSystem is not used (1×1 only, rejects
 * path-sealing).
 */
import Phaser from 'phaser';
import { PALETTE } from '../../../config';
import { COLONY_TUNING } from '../tuning';
import { buildingDef, type BuildingId } from '../content';
import { TAPPABLE } from './camera';
import type { BuildingInst, ColonyState, PlaceCheck } from '../model/state';

const TILE = COLONY_TUNING.map.tilePx;

export class BuildMode {
  armed: BuildingId | null = null;
  /** Valid anchors for the armed building (top-left tiles). */
  validCount = 0;
  private readonly state: ColonyState;
  private readonly glow: Phaser.GameObjects.Graphics;
  private stamp = '';
  /** Valid glow rects (world px, top-left + size), rebuilt only when the stamp changes. */
  private readonly rects: Array<{ x: number; y: number; s: number }> = [];
  /** Whole valid footprints (world px top-left + size): framing aims at a placeable anchor, not a lone glowing tile. */
  private readonly anchors: Array<{ x: number; y: number; s: number }> = [];
  private affordable = false;
  /** World-y window the glow was last drawn for (tappable band projected into the world). */
  private drawnWindow = '';
  private readonly view = { rootY: 0, zoom: 1 };

  constructor(state: ColonyState, glow: Phaser.GameObjects.Graphics) {
    this.state = state;
    this.glow = glow;
  }

  arm(def: BuildingId | null): void {
    this.armed = def;
    this.stamp = '';
    this.refresh(this.view.rootY, this.view.zoom);
  }

  /**
   * Rebuilds the valid set when the armed id, occupancy, field or affordability
   * changed, and redraws the glow when that set or the camera's tappable window
   * (TAPPABLE band in world rows) changed. Tiles outside the band — under the
   * HUD, tray or dock — never glow (critic build1: no valid tile in a dead zone).
   */
  refresh(rootY: number, zoom: number): void {
    this.view.rootY = rootY;
    this.view.zoom = zoom;
    const def = this.armed;
    const affordable = def !== null && this.state.canAfford(this.state.costOf(def));
    const stamp = `${def}:${this.state.buildVersion}:${this.state.fieldVersion}:${affordable}:${this.state.clock.sol}`;
    if (stamp !== this.stamp) {
      this.stamp = stamp;
      this.affordable = affordable;
      this.rebuild(def);
      this.drawnWindow = '';
    }
    const top = (TAPPABLE.top - rootY) / zoom;
    const bottom = (TAPPABLE.bottom - rootY) / zoom;
    const win = `${Math.floor(top / 8)}:${Math.floor(bottom / 8)}`;
    if (win === this.drawnWindow) return;
    this.drawnWindow = win;
    this.glow.clear();
    if (this.rects.length === 0) return;
    const good = this.affordable ? PALETTE.good : PALETTE.inkSoft;
    this.glow.fillStyle(good, this.affordable ? 0.34 : 0.18);
    this.glow.lineStyle(2, good, 0.85);
    for (const r of this.rects) {
      if (r.y < top || r.y + r.s > bottom) continue;
      this.glow.fillRect(r.x, r.y, r.s, r.s);
      this.glow.strokeRect(r.x + 2, r.y + 2, r.s - 4, r.s - 4);
    }
  }

  /** World centre of the valid FOOTPRINT nearest a world point, with its size, or null when none. */
  nearestValid(wx: number, wy: number): { x: number; y: number; s: number } | null {
    let best: { x: number; y: number; s: number } | null = null;
    let bd = Infinity;
    for (const r of this.anchors) {
      const x = r.x + r.s / 2;
      const y = r.y + r.s / 2;
      const d = (x - wx) ** 2 + (y - wy) ** 2;
      if (d < bd) {
        bd = d;
        best = { x, y, s: r.s };
      }
    }
    return best;
  }

  /** True when some whole valid footprint lies inside the world rect. */
  anyBetween(top: number, bottom: number, left: number, right: number): boolean {
    return this.anchors.some((r) => r.y >= top && r.y + r.s <= bottom && r.x >= left && r.x + r.s <= right);
  }

  private rebuild(def: BuildingId | null): void {
    this.rects.length = 0;
    this.anchors.length = 0;
    this.validCount = 0;
    if (def === null) return;
    const d = buildingDef(def);
    const { cols, rows } = this.state.map;
    const size = d.footprint * TILE;
    if (d.deposit !== null) {
      for (const dep of this.state.map.deposits) {
        if (dep.kind !== d.deposit) continue;
        const check = this.state.canPlace(def, dep.col, dep.row);
        if (!check.ok && check.why !== 'afford') continue;
        this.validCount += 1;
        this.rects.push({ x: dep.col * TILE + 2, y: dep.row * TILE + 2, s: size - 4 });
        this.anchors.push({ x: dep.col * TILE, y: dep.row * TILE, s: size });
      }
      return;
    }
    // Per-tile glow: a tile glows when some anchor covering it is valid.
    const on = new Uint8Array(cols * rows);
    for (let r = 0; r <= rows - d.footprint; r += 1) {
      for (let c = 0; c <= cols - d.footprint; c += 1) {
        const check = this.state.canPlace(def, c, r);
        if (!check.ok && check.why !== 'afford') continue;
        this.validCount += 1;
        this.anchors.push({ x: c * TILE, y: r * TILE, s: size });
        for (let dr = 0; dr < d.footprint; dr += 1) for (let dc = 0; dc < d.footprint; dc += 1) on[(r + dr) * cols + c + dc] = 1;
      }
    }
    // Fill + outline per tile: valid relay tiles at the fog edge stay legible (critic2 #5).
    for (let i = 0; i < on.length; i += 1) if (on[i] === 1) this.rects.push({ x: (i % cols) * TILE + 3, y: Math.floor(i / cols) * TILE + 3, s: TILE - 6 });
  }

  /**
   * Best anchor for a tap at a world point: the footprint centred on the
   * finger, else any anchor covering the tapped tile that passes.
   */
  resolve(wx: number, wy: number): { col: number; row: number; check: PlaceCheck } | null {
    const def = this.armed;
    if (def === null) return null;
    const d = buildingDef(def);
    const tc = Math.floor(wx / TILE);
    const tr = Math.floor(wy / TILE);
    if (d.deposit !== null) {
      const di = tc >= 0 && tr >= 0 && tc < this.state.map.cols && tr < this.state.map.rows ? this.state.depositAt[this.state.tileIndex(tc, tr)] ?? 0 : 0;
      const dep = this.state.map.deposits[di - 1];
      if (dep === undefined) return null;
      return { col: dep.col, row: dep.row, check: this.state.canPlace(def, dep.col, dep.row) };
    }
    const f = d.footprint;
    const cc = Math.round(wx / TILE - f / 2);
    const cr = Math.round(wy / TILE - f / 2);
    const first = this.state.canPlace(def, cc, cr);
    if (first.ok) return { col: cc, row: cr, check: first };
    for (let dr = 0; dr < f; dr += 1) {
      for (let dc = 0; dc < f; dc += 1) {
        const check = this.state.canPlace(def, tc - dc, tr - dr);
        if (check.ok) return { col: tc - dc, row: tr - dr, check };
      }
    }
    return { col: cc, row: cr, check: first };
  }
}

/** Nearest building whose inflated (≥ 88 screen px) hit area holds the world point. */
export function pickBuilding(state: ColonyState, wx: number, wy: number, zoom: number): BuildingInst | null {
  const minHalf = COLONY_TUNING.input.hitMinPx / 2 / zoom;
  let best: BuildingInst | null = null;
  let bestD = Infinity;
  for (const b of state.buildings.values()) {
    const f = buildingDef(b.def).footprint;
    const c = state.centreOf(b);
    const half = Math.max((f * TILE) / 2, minHalf);
    const dx = Math.abs(wx - c.col * TILE);
    const dy = Math.abs(wy - c.row * TILE);
    if (dx > half || dy > half) continue;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}
