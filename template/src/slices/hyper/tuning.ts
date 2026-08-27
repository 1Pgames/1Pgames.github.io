import type { RampSpec } from '../../core/ramp';
import type { StackSpec } from './stack';

/**
 * Every balance number of the stack-tower slice. Slice-local by design: the
 * shared `TUNING` in `src/config.ts` stays the arena's, so swapping slices
 * never touches global config.
 */
export const HYPER_TUNING = {
  /** Row height in px; also the camera step per drop. */
  slabHeight: 64,
  /** Slab geometry + perfect-drop economy (see `stack.ts`). */
  stack: {
    startWidth: 420,
    minWidth: 36,
    perfectEpsilon: 10,
    widthBonusOnPerfect: 18,
  } satisfies StackSpec,
  /** Slide speed at difficulty 1, and the px/s added per difficulty point. */
  baseSpeed: 185,
  speedPerDifficulty: 55,
  /** Endless score-chase ramp: difficulty climbs with score, never with time. */
  ramp: {
    scorePerStep: 6,
    difficultyPerStep: 0.1,
    maxDifficulty: 3.2,
  } satisfies RampSpec,
  /** Score awarded per landed drop, and the bonus on top for a perfect one. */
  scorePerDrop: 1,
  scorePerPerfect: 3,
  /** Fraction of screen height the action line sits at — the tower top never moves. */
  actionLineRatio: 0.55,
  /** Overhang pieces alive at once, and how long their fall reads for. */
  maxFallingPieces: 6,
  fallMs: 520,
  /** Slabs kept rendered below the action line before the oldest is recycled. */
  visibleRows: 14,
  /** Death → results transition, kept short for instant-retry feel. */
  hitstopMs: 70,
  fadeOutMs: 240,
  /** Score needed for one unit of meta currency. */
  scorePerCurrency: 5,
  /** Slab tints cycled by height so the tower reads as banded progress. */
  colors: [0x4de1ff, 0x5df2a0, 0xffd166, 0xff5da2, 0xa88bff, 0xff8f5d] as const,
} as const;
