/**
 * Deterministic fixed-timestep auto-battle resolver for auto-battler/tactics
 * board fights: given two boards of placed units, simulates the whole
 * encounter in one call and returns a full event log (moves, hits, deaths)
 * that UI code can replay as animation afterward, frame by frame, instead of
 * needing to re-run gameplay logic during playback.
 *
 * Determinism is the point: `resolveCombat(a, b, rng)` called twice with the
 * same boards and the same seeded `Rng` produces byte-identical logs, so a
 * fight can be simulated once (e.g. server-authoritative or to preview a
 * shop decision) and replayed visually as many times as needed.
 *
 * Pure TypeScript, no Phaser import. Positions are in grid cell space
 * (`col`/`row`), not world pixels — the caller's rendering layer maps cells
 * to screen coordinates.
 *
 * Use for: auto-battler combat resolution, tactics "simulate this turn"
 * previews.
 * Do NOT use for: real-time player-controlled combat (this has no input) or
 * anything needing sub-50ms timing precision — the sim steps in fixed 50ms
 * ticks, which is coarse on purpose (deterministic, cheap, plenty for
 * board-game-paced fights).
 */

import type { Rng } from './rng';

export type Side = 'player' | 'enemy';

export interface UnitInstance {
  id: string;
  defId: string;
  side: Side;
  col: number;
  row: number;
  hp: number;
  maxHp: number;
  damage: number;
  attackMs: number;
  rangeCells: number;
  speedCellsPerS: number;
}

export type CombatEventKind = 'move' | 'hit' | 'death' | 'end';

export interface CombatEvent {
  tMs: number;
  kind: CombatEventKind;
  actor: string;
  target?: string;
  amount?: number;
}

export type CombatWinner = 'player' | 'enemy' | 'draw';

export interface CombatResult {
  winner: CombatWinner;
  log: CombatEvent[];
  durationMs: number;
}

const TICK_MS = 50;
const HARD_CAP_MS = 30000;

/** Live simulation state for one unit; `hp`/`col`/`row` mutate as the fight runs. */
interface SimUnit {
  readonly src: UnitInstance;
  col: number;
  row: number;
  hp: number;
  cooldownMs: number;
  alive: boolean;
}

function cellDistance(a: SimUnit, b: SimUnit): number {
  return Math.hypot(a.col - b.col, a.row - b.row);
}

/** Nearest living enemy by cell distance; ties broken by `rng` so replays with a different seed vary. */
function pickTarget(unit: SimUnit, enemies: readonly SimUnit[], rng: Rng): SimUnit | null {
  let best: SimUnit[] = [];
  let bestDist = Infinity;
  for (const candidate of enemies) {
    if (!candidate.alive) continue;
    const dist = cellDistance(unit, candidate);
    if (dist < bestDist - 1e-9) {
      bestDist = dist;
      best = [candidate];
    } else if (Math.abs(dist - bestDist) <= 1e-9) {
      best.push(candidate);
    }
  }
  if (best.length === 0) return null;
  return best.length === 1 ? best[0]! : rng.pick(best);
}

/** Moves `unit` one tick's worth of distance toward `target`, clamped so it never overshoots. */
function stepToward(unit: SimUnit, target: SimUnit, deltaMs: number): boolean {
  const dx = target.col - unit.col;
  const dy = target.row - unit.row;
  const dist = Math.hypot(dx, dy);
  if (dist <= unit.src.rangeCells) return false;
  const travel = unit.src.speedCellsPerS * (deltaMs / 1000);
  const step = Math.min(travel, dist - unit.src.rangeCells);
  if (step <= 0) return false;
  unit.col += (dx / dist) * step;
  unit.row += (dy / dist) * step;
  return true;
}

/** Total remaining HP across a side — the sudden-death tiebreak once the hard cap is hit. */
function totalHp(units: readonly SimUnit[]): number {
  let sum = 0;
  for (const unit of units) if (unit.alive) sum += unit.hp;
  return sum;
}

/**
 * Runs the fixed-dt simulation described in the module doc. `playerBoard`/
 * `enemyBoard` are copied internally (input instances are never mutated).
 */
export function resolveCombat(
  playerBoard: readonly UnitInstance[],
  enemyBoard: readonly UnitInstance[],
  rng: Rng,
): CombatResult {
  const players: SimUnit[] = playerBoard.map((src) => ({
    src,
    col: src.col,
    row: src.row,
    hp: src.hp,
    cooldownMs: 0,
    alive: src.hp > 0,
  }));
  const enemies: SimUnit[] = enemyBoard.map((src) => ({
    src,
    col: src.col,
    row: src.row,
    hp: src.hp,
    cooldownMs: 0,
    alive: src.hp > 0,
  }));
  const all: SimUnit[] = [...players, ...enemies];
  const log: CombatEvent[] = [];

  let tMs = 0;
  const playerAlive = (): boolean => players.some((u) => u.alive);
  const enemyAlive = (): boolean => enemies.some((u) => u.alive);

  while (tMs < HARD_CAP_MS && playerAlive() && enemyAlive()) {
    tMs += TICK_MS;
    for (const unit of all) {
      if (!unit.alive) continue;
      const enemySide = unit.src.side === 'player' ? enemies : players;
      const target = pickTarget(unit, enemySide, rng);
      if (target === null) continue;

      if (cellDistance(unit, target) > unit.src.rangeCells) {
        if (stepToward(unit, target, TICK_MS)) {
          log.push({ tMs, kind: 'move', actor: unit.src.id });
        }
        continue;
      }

      unit.cooldownMs -= TICK_MS;
      if (unit.cooldownMs > 0) continue;
      unit.cooldownMs += unit.src.attackMs;

      target.hp -= unit.src.damage;
      log.push({ tMs, kind: 'hit', actor: unit.src.id, target: target.src.id, amount: unit.src.damage });
      if (target.hp <= 0 && target.alive) {
        target.alive = false;
        log.push({ tMs, kind: 'death', actor: target.src.id });
      }
    }
  }

  let winner: CombatWinner;
  if (playerAlive() && !enemyAlive()) winner = 'player';
  else if (enemyAlive() && !playerAlive()) winner = 'enemy';
  else if (!playerAlive() && !enemyAlive()) winner = 'draw';
  else {
    // Hard cap reached with both sides still standing: sudden death by total HP.
    const playerHp = totalHp(players);
    const enemyHp = totalHp(enemies);
    if (playerHp > enemyHp) winner = 'player';
    else if (enemyHp > playerHp) winner = 'enemy';
    else winner = 'draw';
  }

  log.push({ tMs, kind: 'end', actor: winner });
  return { winner, log, durationMs: tMs };
}
