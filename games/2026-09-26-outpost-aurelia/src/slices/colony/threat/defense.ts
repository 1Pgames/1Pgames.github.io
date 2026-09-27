/**
 * Turret defense (PRD §4 Defense, §5.2 turret rows, §5.3 bulwark stats): lit,
 * unpaused turrets fire on a cooldown throttled by the power ratio, targets
 * found through one `SpatialHash` of the targetable fauna rebuilt per frame.
 *
 *   Pulse  nearest target (+ `pulse.extraTargets` when another Pulse stands
 *          within 3 tiles — Pulse Lattice), `pulse.damage`, air × airMul
 *   Arc    chains to `arc.chain` targets hopping ≤ 2 tiles, hits air,
 *          stuns `arc.stunSec`
 *   Flak   min/max range, splash `flak.splash`, air × `flak.airMul`,
 *          `flak.split` extra bursts around the impact
 *   Relay sentries (`relay.sentryDps`, 2.5 tiles) and the Choir Spire pulse
 *   (`beacon.choirDamage` within 6 tiles every 8 s while charging).
 *
 * Every shot pushes a `shot` fx; kills/hits come from `FaunaSim.hurt`.
 */
import { SpatialHash } from '../../../core/spatial';
import { COLONY_TUNING } from '../tuning';
import { buildingDef, type TurretSpec } from '../content';
import { colonyStat } from '../model/modifiers';
import { mkIndex } from '../model/production';
import type { BuildingInst, ColonyState } from '../model/state';
import type { Fauna, FaunaSim } from './fauna';

const TILE = COLONY_TUNING.map.tilePx;
/** PRD §15: SpatialHash cell 192 px. */
const HASH_CELL = 192;

// PRD §5.3 prose rules, tuned in `COLONY_TUNING.defense`.
const D = COLONY_TUNING.defense;
/** Pulse Lattice: another Pulse within this many tiles unlocks `pulse.extraTargets`. */
const LATTICE_TILES = D.latticeTiles;
/** Arc Coil: each chain hop reaches this far from the last target. */
const ARC_HOP_TILES = D.arcHopTiles;
/** Pylon Sentries: range and damage tick. */
const SENTRY_RANGE_TILES = D.sentryRangeTiles;
const SENTRY_PERIOD_SEC = D.sentryPeriodSec;
/** Choir Spire: range and period while charging. */
const CHOIR_RANGE_TILES = D.choirRangeTiles;
const CHOIR_EVERY_SEC = D.choirEverySec;

export class Defense {
  private readonly hash = new SpatialHash<Fauna>(HASH_CELL);
  private readonly found: Fauna[] = [];
  private readonly picked: Fauna[] = [];
  private readonly pulses: BuildingInst[] = [];
  private choirCd = CHOIR_EVERY_SEC;

  private readonly state: ColonyState;
  private readonly fauna: FaunaSim;

  constructor(state: ColonyState, fauna: FaunaSim) {
    this.state = state;
    this.fauna = fauna;
  }

  tick(dt: number): void {
    const state = this.state;
    if (this.fauna.liveCount === 0) {
      this.choirCd = CHOIR_EVERY_SEC;
      return;
    }
    const hash = this.hash;
    hash.clear();
    for (const f of this.fauna.pool) if (f.alive && !f.retreating && !f.hidden) hash.insert(f.x, f.y, f);

    const pulses = this.pulses;
    pulses.length = 0;
    for (const b of state.buildings.values()) if (b.def === 'pulse_turret' && b.lit && !b.paused) pulses.push(b);

    const sentryDps = colonyStat(state, 'relay.sentryDps', 0);
    const mkMul = COLONY_TUNING.production.mkRateMul;
    for (const b of state.buildings.values()) {
      if (!b.lit || b.paused) continue;
      if (b.def === 'relay_pylon') {
        if (sentryDps > 0) this.sentry(b, sentryDps, dt);
        continue;
      }
      const turret = buildingDef(b.def).turret;
      if (turret === null) continue;
      b.fireCd -= dt * state.powerRatio;
      if (b.fireCd > 0) continue;
      const fp = buildingDef(b.def).footprint;
      const x = (b.col + fp / 2) * TILE;
      const y = (b.row + fp / 2) * TILE;
      const mk = mkMul[mkIndex(b.mk)] ?? 1;
      const fired =
        b.def === 'arc_coil' ? this.arc(turret, x, y, mk)
        : b.def === 'flak_mortar' ? this.flak(turret, x, y, mk)
        : this.pulse(b, turret, x, y, mk);
      b.fireCd = fired ? turret.cooldownSec : 0;
    }

    this.choir(dt);
  }

  /** Nearest targetable fauna within [minR, maxR] of (x, y), skipping `picked`; air only when `air`. */
  private nearest(x: number, y: number, minR: number, maxR: number, air: boolean): Fauna | null {
    const found = this.hash.queryCircle(x, y, maxR, this.found);
    let best: Fauna | null = null;
    let bestD = maxR * maxR;
    const min2 = minR * minR;
    for (const f of found) {
      if (!f.alive || (f.def.flying && !air) || this.picked.includes(f)) continue;
      const d = (f.x - x) ** 2 + (f.y - y) ** 2;
      if (d < min2 || d > bestD) continue;
      bestD = d;
      best = f;
    }
    return best;
  }

  private pulse(b: BuildingInst, turret: TurretSpec, x: number, y: number, mk: number): boolean {
    const state = this.state;
    const range = colonyStat(state, 'turret.range', turret.rangeTiles) * TILE;
    const damage = colonyStat(state, 'pulse.damage', turret.damage) * mk;
    let targets = 1;
    const extra = Math.round(colonyStat(state, 'pulse.extraTargets', 0));
    if (extra > 0) {
      const lattice2 = (LATTICE_TILES * TILE) ** 2;
      for (const o of this.pulses) {
        if (o !== b && ((o.col - b.col) * TILE) ** 2 + ((o.row - b.row) * TILE) ** 2 <= lattice2) {
          targets += extra;
          break;
        }
      }
    }
    const picked = this.picked;
    picked.length = 0;
    for (let k = 0; k < targets; k += 1) {
      const f = this.nearest(x, y, 0, range, turret.hitsAir);
      if (f === null) break;
      picked.push(f);
    }
    for (const f of picked) {
      state.pushFx({ kind: 'shot', src: 'pulse', x0: x, y0: y, x1: f.x, y1: f.y });
      this.fauna.hurt(f, damage * (f.def.flying ? turret.airMul : 1), 0);
    }
    const fired = picked.length > 0;
    picked.length = 0;
    return fired;
  }

  private arc(turret: TurretSpec, x: number, y: number, mk: number): boolean {
    const state = this.state;
    const range = colonyStat(state, 'turret.range', turret.rangeTiles) * TILE;
    const links = Math.max(1, Math.round(colonyStat(state, 'arc.chain', turret.chain)));
    const stun = colonyStat(state, 'arc.stunSec', 0);
    const damage = turret.damage * mk;
    const picked = this.picked;
    picked.length = 0;
    let fx = x;
    let fy = y;
    for (let k = 0; k < links; k += 1) {
      const f = k === 0 ? this.nearest(x, y, 0, range, true) : this.nearest(fx, fy, 0, ARC_HOP_TILES * TILE, true);
      if (f === null) break;
      picked.push(f);
      state.pushFx({ kind: 'shot', src: 'arc', x0: fx, y0: fy, x1: f.x, y1: f.y });
      fx = f.x;
      fy = f.y;
    }
    for (const f of picked) this.fauna.hurt(f, damage * (f.def.flying ? turret.airMul : 1), stun);
    const fired = picked.length > 0;
    picked.length = 0;
    return fired;
  }

  private flak(turret: TurretSpec, x: number, y: number, mk: number): boolean {
    const state = this.state;
    const range = colonyStat(state, 'turret.range', turret.rangeTiles) * TILE;
    const target = this.nearest(x, y, turret.minRangeTiles * TILE, range, turret.hitsAir);
    if (target === null) return false;
    const splash = colonyStat(state, 'flak.splash', turret.splashTiles) * TILE;
    const airMul = colonyStat(state, 'flak.airMul', turret.airMul);
    const split = Math.max(0, Math.round(colonyStat(state, 'flak.split', 0)));
    const damage = turret.damage * mk;
    const tx = target.x;
    const ty = target.y;
    state.pushFx({ kind: 'shot', src: 'flak', x0: x, y0: y, x1: tx, y1: ty });
    this.burst(tx, ty, splash, damage, airMul);
    // Skyshatter: the shell blooms into `split` more bursts on a ring one splash radius out.
    for (let k = 0; k < split; k += 1) {
      const a = (k / split) * Math.PI * 2;
      const bx = tx + Math.cos(a) * splash;
      const by = ty + Math.sin(a) * splash;
      state.pushFx({ kind: 'shot', src: 'flak', x0: tx, y0: ty, x1: bx, y1: by });
      this.burst(bx, by, splash, damage, airMul);
    }
    return true;
  }

  private burst(x: number, y: number, radius: number, damage: number, airMul: number): void {
    const found = this.hash.queryCircle(x, y, radius, this.found);
    const r2 = radius * radius;
    for (const f of found) {
      if (!f.alive || (f.x - x) ** 2 + (f.y - y) ** 2 > r2) continue;
      this.fauna.hurt(f, damage * (f.def.flying ? airMul : 1), 0);
    }
  }

  /** Pylon Sentries: a lit relay zaps the nearest fauna within 2.5 tiles every 0.5 s. */
  private sentry(b: BuildingInst, dps: number, dt: number): void {
    b.fireCd -= dt * this.state.powerRatio;
    if (b.fireCd > 0) return;
    const x = (b.col + 0.5) * TILE;
    const y = (b.row + 0.5) * TILE;
    const f = this.nearest(x, y, 0, SENTRY_RANGE_TILES * TILE, true);
    if (f === null) {
      b.fireCd = 0;
      return;
    }
    b.fireCd = SENTRY_PERIOD_SEC;
    this.state.pushFx({ kind: 'shot', src: 'sentry', x0: x, y0: y, x1: f.x, y1: f.y });
    this.fauna.hurt(f, dps * SENTRY_PERIOD_SEC, 0);
  }

  /** Choir Spire: while the Beacon charges, every fauna within 6 tiles of the Spire takes `beacon.choirDamage` every 8 s. */
  private choir(dt: number): void {
    const state = this.state;
    const damage = colonyStat(state, 'beacon.choirDamage', 0);
    if (damage <= 0 || state.beacon !== 'charging') {
      this.choirCd = CHOIR_EVERY_SEC;
      return;
    }
    this.choirCd -= dt;
    if (this.choirCd > 0) return;
    this.choirCd = CHOIR_EVERY_SEC;
    for (const b of state.buildings.values()) {
      if (b.def !== 'beacon_spire') continue;
      const x = (b.col + 1.5) * TILE;
      const y = (b.row + 1.5) * TILE;
      const radius = CHOIR_RANGE_TILES * TILE;
      const found = this.hash.queryCircle(x, y, radius, this.found);
      for (const f of found) {
        if (!f.alive || (f.x - x) ** 2 + (f.y - y) ** 2 > radius * radius) continue;
        state.pushFx({ kind: 'shot', src: 'choir', x0: x, y0: y, x1: f.x, y1: f.y });
        this.fauna.hurt(f, damage, 0);
      }
    }
  }
}
