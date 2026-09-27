/**
 * Pooled headless fauna (PRD §4 Fauna, §5.2 behaviours, §15 Nav). Walkers
 * follow the core flow field and attack the first building they enter (walls
 * × `wallMul`); the ten behaviours layer on top:
 *
 *   chew     skitter — the base walker
 *   shell    Acid Lobber — stops at range of the nearest turret and shells it
 *   ram      Carapace Ram — the base walker at × 3 vs walls
 *   lamp     Lumen Moth — flies straight (over walls and rock) at the nearest relay
 *   burrow   Tunnel Grub — untargetable for its first `rangeTiles` inside the
 *            field, then surfaces beside the next building
 *   latch    Static Leech — holds the nearest relay (dark, `state.latched`)
 *            and drains the banks; `relay.leechImmune` refuses the latch
 *   burst    Spore Bloat — on death: AoE to buildings + a skitter brood
 *   rally    Dusk Howler — aura: + speed / + damage; keeps off turret range
 *   brood    Hive Matron — skitters every `swarm.matronBroodEverySec`
 *   titan    Chorus Titan — beelines at the Beacon Spire, periodic stomp AoE
 *
 * Slots are reused through a free-list; `gen` tells the view a slot was
 * recycled. The per-frame loop allocates nothing (scratch arrays are kept).
 */
import type { NavGrid } from '../../../core/grid';
import type { Rng } from '../../../core/rng';
import { COLONY_TUNING } from '../tuning';
import { buildingDef, faunaDef, type FaunaDef, type FaunaId } from '../content';
import { colonyStat } from '../model/modifiers';
import { computeField } from '../model/field';
import type { BuildingInst, ColonyState } from '../model/state';

export interface Fauna {
  readonly slot: number;
  gen: number;
  alive: boolean;
  def: FaunaDef;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** The spawn's difficulty multiplier (broods inherit it). */
  diff: number;
  dmgMul: number;
  retreating: boolean;
  retreatSec: number;
  /** Behaviour timer: Matron brood, Titan stomp. */
  cd: number;
  /** Uid of the building being attacked (0 = walking). */
  chewing: number;
  /** Burrowed: untargetable (Tunnel Grub underground). */
  hidden: boolean;
  /** Px a Tunnel Grub has dug inside the field. */
  dug: number;
  /** Arc stun seconds left: no move, no attack. */
  stunSec: number;
  /** Relay uid a Static Leech holds (0 = none). */
  latched: number;
  /** Inside a Dusk Howler aura this frame. */
  rallied: boolean;
  /** Last move direction (the view flips sprites by `faceX`). */
  faceX: number;
}

const TILE = COLONY_TUNING.map.tilePx;
/**
 * Dawn retreat (critic build3: 5-12 fauna still alive into the day): every fauna still inside or near the lit
 * field this many seconds after dawn despawns (small puff, no salvage, no kill credit).
 */
const RETREAT_DESPAWN_SEC = COLONY_TUNING.swarm.retreatDespawnSec;
/** Presentation cadence of an Acid Lobber's visible shell (its damage is continuous dps). */
const ACID_VOLLEY_SEC = 1.5;

// PRD §5.2 fauna rules, tuned in `COLONY_TUNING.fauna`.
const FT = COLONY_TUNING.fauna;
/** Spore Bloat burst: damage to buildings within `rangeTiles` + skitters. */
const BURST_DAMAGE = FT.burstDamage;
const BURST_BROOD = FT.burstBrood;
/** Dusk Howler aura; holds this many tiles from any turret. */
const RALLY_SPEED_MUL = FT.rallySpeedMul;
const RALLY_DMG_MUL = FT.rallyDmgMul;
const HOWLER_KEEP_TILES = FT.howlerKeepTiles;
/** Chorus Titan: one stomp (dps × period) every this many seconds. */
const STOMP_EVERY_SEC = FT.stompEverySec;
/** Static Leech: bank kJ/s lost per latched leech. */
const LEECH_DRAIN_KJ_PER_SEC = FT.leechDrainKjPerSec;
/** PRD §5.4 Severity: fauna hp step per rung above 1. */
const RUNG_HP_STEP = FT.rungHpStep;
/** ColonyView.canSkipNight: "none within N tiles of the field". */
const NEAR_FIELD_TILES = FT.nearFieldTiles;
/** Tunnel Grub safety: surfaces unconditionally after this many × its dig length. */
const BURROW_MAX_MUL = FT.burrowMaxMul;

export class FaunaSim {
  readonly pool: Fauna[] = [];
  private live = 0;
  private readonly free: number[] = [];
  private readonly dir = { x: 0, y: 0 };
  private readonly turrets: BuildingInst[] = [];
  private readonly relays: BuildingInst[] = [];
  private readonly hitUids: number[] = [];
  private spire: BuildingInst | null = null;
  /** Lit field dilated by NEAR_FIELD_TILES (rebuilt when `fieldVersion` moves). */
  private readonly near: Uint8Array;
  private readonly nearTmp: Uint8Array;
  private nearVersion = -1;
  private readonly hpMul: number;

  private readonly nav: NavGrid;
  private readonly rng: Rng;
  private readonly state: ColonyState;

  constructor(nav: NavGrid, rng: Rng, state: ColonyState) {
    this.nav = nav;
    this.rng = rng;
    this.state = state;
    const n = state.map.cols * state.map.rows;
    this.near = new Uint8Array(n);
    this.nearTmp = new Uint8Array(n);
    this.hpMul = 1 + RUNG_HP_STEP * Math.max(0, state.rung - 1);
  }

  get liveCount(): number {
    return this.live;
  }

  spawnAt(id: FaunaId, x: number, y: number, difficultyMul: number): Fauna {
    const def = faunaDef(id);
    const slot = this.free.pop();
    let f = slot === undefined ? undefined : this.pool[slot];
    if (f === undefined) {
      f = {
        slot: this.pool.length, gen: 0, alive: false, def, x: 0, y: 0, hp: 0, maxHp: 0, diff: 1, dmgMul: 1,
        retreating: false, retreatSec: 0, cd: 0, chewing: 0, hidden: false, dug: 0, stunSec: 0, latched: 0, rallied: false, faceX: 1,
      };
      this.pool.push(f);
    }
    f.gen += 1;
    f.alive = true;
    f.def = def;
    f.x = x;
    f.y = y;
    f.diff = difficultyMul;
    f.maxHp = def.hp * difficultyMul * this.hpMul;
    f.hp = f.maxHp;
    f.dmgMul = 1 + (difficultyMul - 1) * COLONY_TUNING.fauna.dmgScaleShare;
    f.retreating = false;
    f.retreatSec = 0;
    f.cd = def.behaviour === 'brood' ? COLONY_TUNING.swarm.matronBroodEverySec : STOMP_EVERY_SEC;
    f.chewing = 0;
    f.hidden = false;
    f.dug = 0;
    f.stunSec = 0;
    f.latched = 0;
    f.rallied = false;
    f.faceX = 1;
    this.live += 1;
    return f;
  }

  /** Combat damage from turrets, sentries, reflect, choir. Returns true when it killed. Retreating fauna are out of the fight. */
  hurt(f: Fauna, amount: number, stunSec: number): boolean {
    if (!f.alive || f.hidden || f.retreating || amount <= 0) return false;
    f.hp -= amount;
    if (stunSec > f.stunSec) f.stunSec = stunSec;
    if (f.hp > 0) return false;
    this.die(f);
    return true;
  }

  /**
   * Dawn (and Beacon launch): every fauna, alphas included (PRD §5.4 "retreats at dawn"), stops fighting.
   * Anything already beyond the near-field band (≥ `fauna.nearFieldTiles` from the lit field, under fog) leaves
   * at once; the rest walk outward at `swarm.retreatSpeedMul` and despawn after RETREAT_DESPAWN_SEC.
   */
  retreat(): void {
    this.refreshNear();
    const { cols, rows } = this.state.map;
    for (const f of this.pool) {
      if (!f.alive) continue;
      f.retreating = true;
      f.retreatSec = 0;
      f.hidden = false;
      f.stunSec = 0;
      f.chewing = 0;
      this.unlatch(f);
      const tc = Math.floor(f.x / TILE);
      const tr = Math.floor(f.y / TILE);
      const near = tc >= 0 && tr >= 0 && tc < cols && tr < rows && this.near[tr * cols + tc] === 1;
      if (!near) this.despawn(f);
    }
  }

  /** Death with its hooks: tallies, Chitin Salvage, Matron trophy, Spore Bloat burst, leech release. */
  private die(f: Fauna): void {
    const state = this.state;
    this.despawn(f);
    state.kills += 1;
    if (f.def.id === 'matron') state.matronsKilled += 1;
    const salvage = Math.round(colonyStat(state, 'kill.ferrite', 0));
    if (salvage > 0) state.stock.ferrite += salvage;
    state.pushFx({ kind: 'kill', x: f.x, y: f.y, big: f.def.rank !== 'trash' || f.def.behaviour === 'burst' });
    if (f.def.behaviour === 'burst') {
      this.areaDamage(f.x, f.y, f.def.rangeTiles * TILE, BURST_DAMAGE * f.dmgMul, 1);
      this.brood(f, BURST_BROOD, 24);
    }
  }

  /** `count` skitters scattered within `spread` px of a parent, never onto rock (they fall back to the parent's spot). */
  private brood(parent: Fauna, count: number, spread: number): void {
    for (let i = 0; i < count; i += 1) {
      let x = parent.x + this.rng.float(-spread, spread);
      let y = parent.y + this.rng.float(-spread, spread);
      if (this.nav.isBlockedAt(x, y)) {
        x = parent.x;
        y = parent.y;
      }
      this.spawnAt('skitter', x, y, parent.diff);
    }
  }

  private despawn(f: Fauna): void {
    if (!f.alive) return;
    this.unlatch(f);
    f.alive = false;
    f.chewing = 0;
    this.live -= 1;
    this.free.push(f.slot);
  }

  private unlatch(f: Fauna): void {
    if (f.latched === 0) return;
    const uid = f.latched;
    f.latched = 0;
    for (const o of this.pool) if (o.alive && o.latched === uid) return;
    if (this.state.latched.delete(uid)) computeField(this.state);
  }

  tick(dt: number): void {
    const state = this.state;
    this.refreshTargets();
    this.refreshNear();
    const { cols, rows } = state.map;
    const coreX = (state.map.core.col + 0.5) * TILE;
    const coreY = (state.map.core.row + 0.5) * TILE;
    const S = COLONY_TUNING.swarm;
    const pool = this.pool;
    const n = pool.length;

    // Howler auras (few howlers × pool).
    for (let i = 0; i < n; i += 1) {
      const f = pool[i];
      if (f !== undefined) f.rallied = false;
    }
    for (let i = 0; i < n; i += 1) {
      const h = pool[i];
      if (h === undefined || !h.alive || h.retreating || h.def.behaviour !== 'rally') continue;
      const r2 = (h.def.rangeTiles * TILE) ** 2;
      for (let j = 0; j < n; j += 1) {
        const f = pool[j];
        if (f === undefined || !f.alive || f === h) continue;
        if ((f.x - h.x) ** 2 + (f.y - h.y) ** 2 <= r2) f.rallied = true;
      }
    }

    let nearField = 0;
    const immune = colonyStat(state, 'relay.leechImmune', 0) > 0;
    for (let i = 0; i < n; i += 1) {
      const f = pool[i];
      if (f === undefined || !f.alive) continue;
      if (f.retreating) {
        const dx = f.x - coreX;
        const dy = f.y - coreY;
        const len = Math.hypot(dx, dy) || 1;
        const v = f.def.speedPx * S.retreatSpeedMul * dt;
        f.x += (dx / len) * v;
        f.y += (dy / len) * v;
        if (dx !== 0) f.faceX = dx > 0 ? 1 : -1;
        f.retreatSec += dt;
        f.chewing = 0;
        if (f.x < -TILE || f.y < -TILE || f.x > cols * TILE + TILE || f.y > rows * TILE + TILE) this.despawn(f);
        else if (f.retreatSec >= RETREAT_DESPAWN_SEC) {
          // Small puff where it vanishes (a non-big 'kill' fx): no salvage, no kill tally.
          state.pushFx({ kind: 'kill', x: f.x, y: f.y, big: false });
          this.despawn(f);
        }
        continue;
      }
      const tc = Math.floor(f.x / TILE);
      const tr = Math.floor(f.y / TILE);
      if (tc >= 0 && tr >= 0 && tc < cols && tr < rows && this.near[tr * cols + tc] === 1) nearField += 1;
      if (f.stunSec > 0) {
        f.stunSec -= dt;
        continue;
      }
      const speed = f.def.speedPx * (f.rallied ? RALLY_SPEED_MUL : 1) * dt;
      const dps = f.def.dps * f.dmgMul * (f.rallied ? RALLY_DMG_MUL : 1);
      switch (f.def.behaviour) {
        case 'brood':
          f.cd -= dt;
          if (f.cd <= 0) {
            f.cd += S.matronBroodEverySec;
            this.brood(f, S.matronBroodCount, 40);
          }
          this.walk(f, speed, dps * dt, coreX, coreY);
          break;
        case 'shell': {
          const target = this.nearestIn(this.turrets, f.x, f.y, f.def.rangeTiles * TILE);
          if (target !== null) {
            this.attack(f, target, dps * dt);
            // Cosmetic lob (damage above stays continuous): one acid shell per volley period.
            f.cd -= dt;
            if (f.cd <= 0) {
              f.cd = ACID_VOLLEY_SEC;
              const half = (buildingDef(target.def).footprint * TILE) / 2;
              state.pushFx({ kind: 'shot', src: 'acid', x0: f.x, y0: f.y, x1: target.col * TILE + half, y1: target.row * TILE + half });
            }
          } else this.walk(f, speed, dps * dt, coreX, coreY);
          break;
        }
        case 'lamp': {
          const target = this.nearestIn(this.relays, f.x, f.y, Infinity) ?? state.core ?? null;
          if (target === null) break;
          this.flyAt(f, target, speed, dps * dt);
          break;
        }
        case 'burrow':
          this.burrow(f, speed, dps * dt, coreX, coreY);
          break;
        case 'latch':
          this.latch(f, speed, immune, coreX, coreY, dt);
          break;
        case 'rally':
          if (this.nearestIn(this.turrets, f.x, f.y, HOWLER_KEEP_TILES * TILE) !== null) {
            f.chewing = 0;
            break;
          }
          this.walk(f, speed, dps * dt, coreX, coreY);
          break;
        case 'titan':
          this.titan(f, speed, dps, dt, coreX, coreY);
          break;
        default:
          this.walk(f, speed, dps * dt, coreX, coreY);
      }
    }
    state.faunaNearField = nearField;
  }

  // ── movement + attack primitives ─────────────────────────────────────────

  /** Flow-field walker: attack the building underfoot or one reach ahead, else step. */
  private walk(f: Fauna, speed: number, dmg: number, coreX: number, coreY: number): void {
    const dir = this.flowDir(f, coreX, coreY);
    const target = this.buildingAhead(f, dir.x, dir.y);
    if (target !== undefined) {
      this.attack(f, target, dmg);
      return;
    }
    f.chewing = 0;
    this.stepGround(f, dir.x * speed, dir.y * speed);
  }

  private flowDir(f: Fauna, coreX: number, coreY: number): { x: number; y: number } {
    const dir = this.dir;
    if (!this.nav.steer(f.x, f.y, dir) || (dir.x === 0 && dir.y === 0)) {
      const dx = coreX - f.x;
      const dy = coreY - f.y;
      const len = Math.hypot(dx, dy) || 1;
      dir.x = dx / len;
      dir.y = dy / len;
    }
    return dir;
  }

  private buildingAhead(f: Fauna, dx: number, dy: number): BuildingInst | undefined {
    const reach = COLONY_TUNING.fauna.attackReachPx;
    const state = this.state;
    return (
      state.buildingAt(Math.floor(f.x / TILE), Math.floor(f.y / TILE)) ??
      state.buildingAt(Math.floor((f.x + dx * reach) / TILE), Math.floor((f.y + dy * reach) / TILE))
    );
  }

  /** Moves on the ground, sliding along rock; never leaves the map. */
  private stepGround(f: Fauna, mx: number, my: number): void {
    const nav = this.nav;
    const nx = f.x + mx;
    const ny = f.y + my;
    if (!nav.isBlockedAt(nx, ny)) {
      f.x = nx;
      f.y = ny;
    } else if (!nav.isBlockedAt(nx, f.y)) f.x = nx;
    else if (!nav.isBlockedAt(f.x, ny)) f.y = ny;
    if (mx !== 0) f.faceX = mx > 0 ? 1 : -1;
  }

  /** Damage to one building (walls × wallMul; `wall.reflect` bites back). */
  private attack(f: Fauna, b: BuildingInst, dmg: number): void {
    f.chewing = b.uid;
    if (dmg <= 0) return;
    const state = this.state;
    const wall = b.def === 'plate_barricade';
    const amount = dmg * (wall ? f.def.wallMul : 1);
    const before = b.hp;
    state.damage(b, amount);
    if (Math.floor(before / 20) !== Math.floor(b.hp / 20)) state.pushFx({ kind: 'hit', uid: b.uid });
    if (wall) {
      const reflect = colonyStat(state, 'wall.reflect', 0);
      if (reflect > 0) this.hurt(f, amount * reflect, 0);
    }
  }

  /** Lumen Moth: straight flight over walls and rock; attacks only its target. */
  private flyAt(f: Fauna, b: BuildingInst, speed: number, dmg: number): void {
    const fp = buildingDef(b.def).footprint;
    const tx = (b.col + fp / 2) * TILE;
    const ty = (b.row + fp / 2) * TILE;
    const dx = tx - f.x;
    const dy = ty - f.y;
    const d = Math.hypot(dx, dy);
    if (d <= COLONY_TUNING.fauna.attackReachPx + (fp * TILE) / 2) {
      this.attack(f, b, dmg);
      return;
    }
    f.chewing = 0;
    const k = Math.min(speed, d) / (d || 1);
    f.x += dx * k;
    f.y += dy * k;
    if (dx !== 0) f.faceX = dx > 0 ? 1 : -1;
  }

  /** Tunnel Grub: walks to the field, digs `rangeTiles` untargetable, surfaces beside the next building. */
  private burrow(f: Fauna, speed: number, dmg: number, coreX: number, coreY: number): void {
    const state = this.state;
    const limit = f.def.rangeTiles * TILE;
    const tc = Math.floor(f.x / TILE);
    const tr = Math.floor(f.y / TILE);
    if (!f.hidden && f.dug === 0 && state.lit[tr * state.map.cols + tc] === 1) f.hidden = true;
    if (!f.hidden) {
      this.walk(f, speed, dmg, coreX, coreY);
      return;
    }
    const dx = coreX - f.x;
    const dy = coreY - f.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    if (f.dug >= limit && (this.buildingAhead(f, ux, uy) !== undefined || f.dug >= limit * BURROW_MAX_MUL || len < TILE)) {
      // Surface on open ground beside the building.
      f.hidden = false;
      if (this.nav.isBlockedAt(f.x, f.y)) this.stepGround(f, -ux * TILE, -uy * TILE);
      return;
    }
    const v = Math.min(speed, len);
    f.x += ux * v;
    f.y += uy * v;
    f.dug += v;
    f.chewing = 0;
  }

  /** Static Leech: walks to the nearest free relay and holds it dark while it lives. */
  private latch(f: Fauna, speed: number, immune: boolean, coreX: number, coreY: number, dt: number): void {
    const state = this.state;
    if (f.latched !== 0) {
      if (state.buildings.has(f.latched) && !immune) {
        state.bankKj = Math.max(0, state.bankKj - LEECH_DRAIN_KJ_PER_SEC * dt);
        return;
      }
      this.unlatch(f);
    }
    let target: BuildingInst | null = null;
    if (!immune) {
      let best = Infinity;
      for (const r of this.relays) {
        if (state.latched.has(r.uid)) continue;
        const d = ((r.col + 0.5) * TILE - f.x) ** 2 + ((r.row + 0.5) * TILE - f.y) ** 2;
        if (d < best) {
          best = d;
          target = r;
        }
      }
    }
    if (target === null) {
      this.walk(f, speed, 0, coreX, coreY);
      return;
    }
    const tx = (target.col + 0.5) * TILE;
    const ty = (target.row + 0.5) * TILE;
    const dx = tx - f.x;
    const dy = ty - f.y;
    const d = Math.hypot(dx, dy);
    if (d <= COLONY_TUNING.fauna.attackReachPx + TILE / 2) {
      f.latched = target.uid;
      f.chewing = target.uid;
      state.latched.add(target.uid);
      computeField(state);
      state.pushFx({ kind: 'hit', uid: target.uid });
      return;
    }
    f.chewing = 0;
    const k = Math.min(speed, d) / (d || 1);
    this.stepGround(f, dx * k, dy * k);
  }

  /** Chorus Titan: straight at the Beacon Spire (or the core), stomping every building within `rangeTiles`. */
  private titan(f: Fauna, speed: number, dps: number, dt: number, coreX: number, coreY: number): void {
    const spire = this.spire;
    let tx = coreX;
    let ty = coreY;
    if (spire !== null) {
      tx = (spire.col + 1.5) * TILE;
      ty = (spire.row + 1.5) * TILE;
    }
    const dx = tx - f.x;
    const dy = ty - f.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    f.cd -= dt;
    const blocking = this.buildingAhead(f, ux, uy);
    if (blocking !== undefined || len < f.def.rangeTiles * TILE) {
      f.chewing = blocking?.uid ?? spire?.uid ?? 0;
      if (f.cd <= 0) {
        f.cd = STOMP_EVERY_SEC;
        this.areaDamage(f.x, f.y, f.def.rangeTiles * TILE, dps * STOMP_EVERY_SEC, f.def.wallMul);
      }
      return;
    }
    f.chewing = 0;
    if (this.nav.isBlockedAt(f.x + ux * speed, f.y + uy * speed)) {
      const dir = this.flowDir(f, coreX, coreY);
      this.stepGround(f, dir.x * speed, dir.y * speed);
      return;
    }
    f.x += ux * speed;
    f.y += uy * speed;
    f.faceX = ux >= 0 ? 1 : -1;
  }

  /** Damage every building with a tile inside the circle once (walls × wallMul). */
  private areaDamage(x: number, y: number, radius: number, amount: number, wallMul: number): void {
    const state = this.state;
    const { cols, rows } = state.map;
    const hit = this.hitUids;
    hit.length = 0;
    const r = Math.ceil(radius / TILE);
    const c0 = Math.floor(x / TILE);
    const r0 = Math.floor(y / TILE);
    for (let dr = -r; dr <= r; dr += 1) {
      for (let dc = -r; dc <= r; dc += 1) {
        const c = c0 + dc;
        const rr = r0 + dr;
        if (c < 0 || rr < 0 || c >= cols || rr >= rows) continue;
        if (((c + 0.5) * TILE - x) ** 2 + ((rr + 0.5) * TILE - y) ** 2 > radius * radius) continue;
        const uid = state.occ[rr * cols + c] ?? 0;
        if (uid === 0 || hit.includes(uid)) continue;
        hit.push(uid);
      }
    }
    for (const uid of hit) {
      const b = state.buildings.get(uid);
      if (b === undefined) continue;
      state.damage(b, amount * (b.def === 'plate_barricade' ? wallMul : 1));
      state.pushFx({ kind: 'hit', uid });
    }
  }

  private nearestIn(list: readonly BuildingInst[], x: number, y: number, range: number): BuildingInst | null {
    let best: BuildingInst | null = null;
    let bestD = range * range;
    for (const b of list) {
      const fp = buildingDef(b.def).footprint;
      const d = ((b.col + fp / 2) * TILE - x) ** 2 + ((b.row + fp / 2) * TILE - y) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private refreshTargets(): void {
    const turrets = this.turrets;
    const relays = this.relays;
    turrets.length = 0;
    relays.length = 0;
    this.spire = null;
    for (const b of this.state.buildings.values()) {
      const def = buildingDef(b.def);
      if (def.turret !== null) turrets.push(b);
      else if (b.def === 'relay_pylon') relays.push(b);
      else if (b.def === 'beacon_spire') this.spire = b;
    }
  }

  /** Lit field dilated by NEAR_FIELD_TILES (separable square max), rebuilt on field change only. */
  private refreshNear(): void {
    const state = this.state;
    if (state.fieldVersion === this.nearVersion) return;
    this.nearVersion = state.fieldVersion;
    const { cols, rows } = state.map;
    const k = NEAR_FIELD_TILES;
    const tmp = this.nearTmp;
    const out = this.near;
    // Rows: within k of a lit tile left or right; then columns: within k of such a row mark.
    for (let r = 0; r < rows; r += 1) {
      let prev = -Infinity;
      for (let c = 0; c < cols; c += 1) {
        if (state.lit[r * cols + c] === 1) prev = c;
        tmp[r * cols + c] = c - prev <= k ? 1 : 0;
      }
      let after = Infinity;
      for (let c = cols - 1; c >= 0; c -= 1) {
        if (state.lit[r * cols + c] === 1) after = c;
        if (after - c <= k) tmp[r * cols + c] = 1;
      }
    }
    for (let c = 0; c < cols; c += 1) {
      let prev = -Infinity;
      for (let r = 0; r < rows; r += 1) {
        if (tmp[r * cols + c] === 1) prev = r;
        out[r * cols + c] = r - prev <= k ? 1 : 0;
      }
      let after = Infinity;
      for (let r = rows - 1; r >= 0; r -= 1) {
        if (tmp[r * cols + c] === 1) after = r;
        if (after - r <= k) out[r * cols + c] = 1;
      }
    }
  }
}
