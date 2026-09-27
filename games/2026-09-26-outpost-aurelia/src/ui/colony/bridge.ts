import type Phaser from 'phaser';
import type { ColonyUiHost, SheetKind } from '../../slices/colony/contracts';
import type { CoachRect } from '../coach';
import type { OverlayHandle } from '../sheet';

/**
 * Per-visit UI arbitration state (PRD §14b law 1: one named overlay owns the
 * screen). Keyed by scene so a `scene.start` round-trip starts clean.
 */
export interface ColonyUiState {
  sheet: OverlayHandle | null;
  sheetKind: SheetKind | null;
  /** True while any draft overlay is alive — derived from `drafts`, never written directly. */
  draftOpen: boolean;
  /** Live draft overlays' destroyers: the ONE owner of `draftOpen` (open = size > 0). */
  drafts: Set<() => void>;
  /** A pausing coach beat owns the screen (CoachDusk / sheet first-opening). */
  coachOwner: boolean;
  /** Any coach spotlight is up (alert pills hide so they never cover its target). */
  coachRect: CoachRect | null;
  cardUid: number | null;
  /** Transient ContextStrip line ("Need 12 Alloy") and when it expires (scene ms). */
  notice: string | null;
  noticeUntil: number;
}

const STATES = new WeakMap<Phaser.Scene, ColonyUiState>();

export function uiState(scene: Phaser.Scene): ColonyUiState {
  let s = STATES.get(scene);
  if (s === undefined) {
    s = { sheet: null, sheetKind: null, draftOpen: false, drafts: new Set(), coachOwner: false, coachRect: null, cardUid: null, notice: null, noticeUntil: 0 };
    STATES.set(scene, s);
    const state = s;
    scene.events.once('shutdown', () => {
      state.sheet = null;
      state.drafts.clear();
      state.draftOpen = false;
      STATES.delete(scene);
    });
  }
  return s;
}

/** Shows `text` on the ContextStrip for `ms` (dock refusals, auto-disarm reasons). */
export function stripNotice(scene: Phaser.Scene, text: string, ms = 1500): void {
  const s = uiState(scene);
  s.notice = text;
  s.noticeUntil = scene.time.now + ms;
}

/** A sheet opening: law 1 closes the card and any other sheet first. */
export function claimSheet(host: ColonyUiHost, kind: SheetKind, handle: OverlayHandle): void {
  const s = uiState(host.scene);
  const prev = s.sheet;
  s.sheet = handle;
  s.sheetKind = kind;
  if (prev !== null && prev !== handle) prev.close();
  if (s.cardUid !== null) host.select(null);
}

export function releaseSheet(scene: Phaser.Scene, handle: OverlayHandle): void {
  const s = uiState(scene);
  if (s.sheet !== handle) return;
  s.sheet = null;
  s.sheetKind = null;
}

/** True while any colony overlay owns the screen (non-pausing coach hints hide under it). */
export function overlayOwned(host: ColonyUiHost): boolean {
  const s = uiState(host.scene);
  return s.sheet !== null || s.draftOpen || s.coachOwner || host.paused;
}

