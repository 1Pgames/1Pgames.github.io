/**
 * Stack-tower math (family J, hypercasual tap-timing).
 *
 * A slab of the current tower width slides across the screen; a tap drops it
 * onto the tower top. Everything that decides the outcome of that tap lives
 * here as pure functions over plain records, so the slice scene only renders
 * the result and the headless sim / ramp bot can play the same game without
 * Phaser.
 *
 * Pure TypeScript, no Phaser import, no `Math.random` — deterministic given the
 * drop positions.
 */

export interface StackSpec {
  /** Width of the base slab, and the ceiling a perfect-drop bonus can restore to. */
  startWidth: number;
  /** Below this the tower is too thin to stand on: the run ends ('toppled'). */
  minWidth: number;
  /** |dropX - topX| within this counts as a perfect drop (no trim, width bonus). */
  perfectEpsilon: number;
  /** Width handed back on a perfect drop, capped at `startWidth`. */
  widthBonusOnPerfect: number;
}

export interface DropResult {
  /** Center x of the surviving overlap — the new tower top. */
  overlapX: number;
  /** Width of the overlap. `<= 0` means the slab missed the tower entirely. */
  overlapW: number;
  /** True when the drop landed within `perfectEpsilon` of the tower top center. */
  perfect: boolean;
  /** Total width sheared off the dropped slab. 0 on a perfect drop. */
  trimmed: number;
  /** Side the (dominant) overhang fell off: -1 left, +1 right, 0 none. */
  trimSide: -1 | 0 | 1;
  /** Center x of the dominant overhang piece; only meaningful when `trimmed > 0`. */
  trimX: number;
  /** Convenience mirror of `overlapW <= 0`. */
  miss: boolean;
}

export interface StackTower {
  /** Center x of the top slab. */
  topX: number;
  /** Width of the top slab — also the width of the next sliding slab. */
  width: number;
  /** Slabs stacked above the base (the score-bearing height). */
  height: number;
  /** Perfect drops so far. */
  perfects: number;
  alive: boolean;
  /** '' while alive, then 'missed' or 'toppled'. */
  failure: string;
}

/**
 * Intersect the dropped slab with the tower top.
 *
 * A perfect drop snaps to the tower top instead of shaving off the epsilon
 * pixels of drift — otherwise "perfect" would still narrow the tower and the
 * reward would be invisible.
 */
export function dropSlab(
  topX: number,
  topW: number,
  dropX: number,
  dropW: number,
  perfectEpsilon = 0,
): DropResult {
  const dx = dropX - topX;
  const left = Math.max(topX - topW / 2, dropX - dropW / 2);
  const right = Math.min(topX + topW / 2, dropX + dropW / 2);
  const span = right - left;

  if (span <= 0) {
    return {
      overlapX: dropX,
      overlapW: 0,
      perfect: false,
      trimmed: dropW,
      trimSide: dx >= 0 ? 1 : -1,
      trimX: dropX,
      miss: true,
    };
  }

  if (Math.abs(dx) <= perfectEpsilon) {
    return {
      overlapX: topX,
      overlapW: Math.min(topW, dropW),
      perfect: true,
      trimmed: 0,
      trimSide: 0,
      trimX: topX,
      miss: false,
    };
  }

  // Both sides are measured so a slab wider than the tower top (which straddles
  // it) still reports the correct total trim and the bigger falling piece.
  const overhangLeft = Math.max(0, left - (dropX - dropW / 2));
  const overhangRight = Math.max(0, dropX + dropW / 2 - right);
  const trimmed = overhangLeft + overhangRight;
  const trimSide: -1 | 0 | 1 = overhangRight >= overhangLeft ? 1 : -1;
  const trimX = trimSide === 1 ? right + overhangRight / 2 : left - overhangLeft / 2;

  return {
    overlapX: (left + right) / 2,
    overlapW: span,
    perfect: false,
    trimmed,
    trimSide,
    trimX,
    miss: false,
  };
}

export function createTower(spec: StackSpec, centerX: number): StackTower {
  return {
    topX: centerX,
    width: spec.startWidth,
    height: 0,
    perfects: 0,
    alive: true,
    failure: '',
  };
}

/**
 * Drops a slab of the current tower width at `dropX` and folds the outcome into
 * the tower. Mutates `tower`; returns the drop for the renderer (overhang piece,
 * perfect flash, new top geometry).
 */
export function placeSlab(tower: StackTower, spec: StackSpec, dropX: number): DropResult {
  const result = dropSlab(tower.topX, tower.width, dropX, tower.width, spec.perfectEpsilon);
  if (!tower.alive) return result;

  if (result.miss) {
    tower.alive = false;
    tower.failure = 'missed';
    return result;
  }

  tower.height += 1;

  if (result.perfect) {
    tower.perfects += 1;
    tower.width = Math.min(spec.startWidth, tower.width + spec.widthBonusOnPerfect);
    return result;
  }

  tower.topX = result.overlapX;
  tower.width = result.overlapW;
  if (tower.width < spec.minWidth) {
    tower.alive = false;
    tower.failure = 'toppled';
  }
  return result;
}

/** Slide speed in px/s for a `RampDirector.difficulty` (1 at the start of a run). */
export function slabSpeed(baseSpeed: number, speedPerDifficulty: number, difficulty: number): number {
  return baseSpeed + Math.max(0, difficulty - 1) * speedPerDifficulty;
}

/**
 * Travel limits for the slab center: it stops when its edge touches the screen
 * edge, so a narrow tower gets a wide miss window while a full-width one is
 * near-impossible to miss.
 */
export function travelBounds(width: number, viewWidth: number): { minX: number; maxX: number } {
  const half = Math.min(width / 2, viewWidth / 2);
  return { minX: half, maxX: viewWidth - half };
}
