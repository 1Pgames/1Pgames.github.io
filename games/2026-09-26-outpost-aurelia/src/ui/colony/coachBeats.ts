import Phaser from 'phaser';
import { PALETTE } from '../../config';
import { save } from '../../core/storage';
import { buildingDef, type BuildingId, type DepositKind } from '../../slices/colony/content';
import type { CoachBeats, ColonyEvent, ColonyUiHost } from '../../slices/colony/contracts';
import { hasSeenCoach, showCoach, type CoachHandle, type CoachRect } from '../coach';
import { label } from '../widgets';
import { overlayOwned, uiState } from './bridge';
import { DOCK_SLOTS } from './dock';
import { TRAY_RECT } from './tray';
import { Control, UI_DEPTH, pin, placard } from './theme';

/**
 * FTUE coach beats (PRD §14 table, §14b law 3), all through `ui/coach.ts`:
 *
 * | id    | gate                   | completes when                                  | kind |
 * | ore   | first Landing, t = 0   | first Ferrite Drill placed                      | gated 2-step: deposit → BUILD chip |
 * | dock  | after `ore`            | a second building placed                        | hint |
 * | vent  | t ≥ 20 s (live clock)  | Vent Tap placed                                 | hint |
 * | dusk  | first dusk (pauses)    | turret exists + RESUME, or RESUME when none is affordable | owner |
 * | draft | first draft            | a card picked (the draft overlay writes the flag) | hint |
 * | grid  | sol 4 dawn             | first relay placed                              | hint |
 *
 * `tut:<id>` is written when a beat COMPLETES (law 3): `showCoach` writes it on
 * show, so it is cleared again right after; a shown-but-uncompleted beat
 * returns at its gate next Landing. Hints hide while any overlay owns the
 * screen and re-show when it closes; one beat at a time, queued. The dusk
 * beat spotlights the REAL world edge arrow (`duskArrowRect`, edges known at
 * dusk start) and every way out of it disarms build mode.
 */
type BeatId = 'ore' | 'dock' | 'vent' | 'dusk' | 'draft' | 'grid' | 'feed';
const COPY: Record<BeatId, string> = {
  ore: 'Tap the glowing ore to drill it.',
  dock: 'Build from the dock — tap it, then tap tiles. It stays armed.',
  vent: 'Nights cost power. Cap the Ember Vent.',
  dusk: 'They come from the arrow. Place a turret, then resume.',
  draft: 'Pick a directive — it shapes the whole Landing.',
  grid: 'Relays reach richer ground — but the dark is paid in power.',
  feed: 'Feed the crew — ice → terrace. Borer on ice, then a Hydro Terrace.',
};
const DUSK_BROKE = 'Save Fe for a turret — resume.';
const PLAYFIELD: CoachRect = { x: 40, y: 432, w: 640, h: 436 };
const DOCK_ROW: CoachRect = { x: 40, y: 964, w: 640, h: 92 };
const DRAFT_CARDS: CoachRect = { x: 40, y: 340, w: 640, h: 420 };
/** Status band (resource strip + TimeControls, interface-direction §5): always live under a gated beat. */
const STATUS_BAND = { y: 140, h: 96 } as const;
const POLL_MS = 250;
/** A non-pausing hint (law 3: never an input owner) steps aside after this long; its flag stays unset, so it returns next Landing. */
const HINT_MS = 8000;
const VENT_AT_SEC = 20;
/** FTUE `feed` hint (critic final #8): at ≈ 15 s of live clock, while rations fall and no terrace stands. */
const FEED_AT_SEC = 15;
/** A gated beat that has not completed in this long retires (never holds a live colony hostage). */
const GATE_TIMEOUT_MS = 45000;
/** The dusk beat's RESUME panel (interface-direction §5: coach cards anchor at y 440, max 180 tall). */
/** The dusk RESUME panel sits in the alert-rail band (pills hide under a coach): off the map, the arrows and every valid tile. */
const PANEL = { x: 40, y: 336, w: 640, h: 88 } as const;

export class ColonyCoachBeats implements CoachBeats {
  private readonly host: ColonyUiHost;
  private readonly scene: Phaser.Scene;
  private readonly queue: BeatId[] = [];
  private current: { id: BeatId; handle: CoachHandle | null; step: number; rect: CoachRect | null; since: number } | null = null;
  /** Tonight's spotlit edge and its copy while the dusk beat's step 0 is up. */
  private duskEdge: 0 | 1 | 2 | 3 | null = null;
  private duskText = '';
  private readonly timer: Phaser.Time.TimerEvent;
  private readonly visitDone = new Set<BeatId>();
  private liveSec = 0;
  private placements = 0;
  private duskPanel: { root: Phaser.GameObjects.Container; resume: Control; ring: Phaser.Tweens.Tween } | null = null;
  private tearingDown = false;

  constructor(host: ColonyUiHost) {
    this.host = host;
    this.scene = host.scene;
    this.timer = this.scene.time.addEvent({ delay: POLL_MS, loop: true, callback: () => this.poll(true) });
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    if (!hasSeenCoach('ore')) this.enqueue('ore');
    else if (!hasSeenCoach('dock')) this.enqueue('dock');
  }

  get active(): boolean {
    return uiState(this.scene).coachOwner;
  }

  /** The beat on screen (cert adapter: GameScene.coachId), null when none. */
  get beatId(): BeatId | null {
    if (this.duskPanel !== null) return 'dusk';
    return this.current !== null && (this.current.handle !== null || this.current.id === 'dusk') ? this.current.id : null;
  }

  /** The building whose placement completes the showing beat; null = a tap / RESUME continues it. */
  get gatedBy(): BuildingId | null {
    return this.beatId === 'ore' ? 'ferrite_drill' : null;
  }

  onEvent(e: ColonyEvent): void {
    switch (e.type) {
      case 'placed':
        this.placements += 1;
        if (e.building === 'ferrite_drill') this.complete('ore');
        if (this.placements >= 2) this.complete('dock');
        if (e.building === 'vent_tap') this.complete('vent');
        if (e.building === 'relay_pylon') this.complete('grid');
        if (e.building === 'hydro_terrace') this.complete('feed');
        break;
      case 'dusk':
        if (!hasSeenCoach('dusk')) this.openDusk(e.plan.edges[0] ?? 0);
        break;
      case 'draft':
        if (!hasSeenCoach('draft')) {
          this.enqueue('draft', true);
          // game.ts opens the draft overlay right after this event: start the beat the next frame, not the next poll.
          this.scene.time.delayedCall(1, () => this.poll(false));
        }
        break;
      case 'dawn':
        if (e.sol >= 4 && !hasSeenCoach('grid')) this.enqueue('grid');
        break;
      default:
        break;
    }
  }

  private enqueue(id: BeatId, front = false): void {
    if (this.visitDone.has(id) || this.queue.includes(id) || this.current?.id === id) return;
    if (front) this.queue.unshift(id);
    else this.queue.push(id);
  }

  /** Marks a beat taught: flag written, handle finished, queue advanced. */
  private complete(id: BeatId): void {
    // The taught action ALWAYS records the beat as taught, even when its hint already stepped aside
    // this Landing (cert ftue:repeat 'vent'): only the handle / queue cleanup is once-per-visit.
    save(`tut:${id}`, true);
    if (this.visitDone.has(id)) return;
    this.visitDone.add(id);
    const i = this.queue.indexOf(id);
    if (i >= 0) this.queue.splice(i, 1);
    if (this.current?.id === id) {
      const h = this.current.handle;
      this.current = null;
      h?.finish();
      this.clearRect();
      if (id === 'ore' && !hasSeenCoach('dock')) this.enqueue('dock', true);
    }
  }

  /** Ends the showing beat without teaching it (flag stays unset → returns next Landing). */
  private drop(): void {
    const c = this.current;
    if (c === null) return;
    this.current = null;
    c.handle?.destroy();
    this.clearRect();
  }

  private clearRect(): void {
    uiState(this.scene).coachRect = null;
  }

  private poll(tick = true): void {
    if (this.tearingDown) return;
    const host = this.host;
    if (tick && !host.paused && !overlayOwned(host)) this.liveSec += POLL_MS / 1000;
    if (this.liveSec >= VENT_AT_SEC && !hasSeenCoach('vent')) this.enqueue('vent');
    if (this.liveSec >= FEED_AT_SEC && !hasSeenCoach('feed') && this.needsFood()) this.enqueue('feed', true);

    const c = this.current;
    if (c !== null) {
      // The dusk beat is itself the owner: it is never hidden by the ownership it creates.
      if (c.id === 'dusk') {
        this.syncDusk(c);
        return;
      }
      // Non-pausing hints step aside on their own (never re-shown this visit; the flag stays unset).
      if (c.id !== 'ore' && c.handle !== null && this.scene.time.now - c.since > HINT_MS) {
        this.drop();
        this.visitDone.add(c.id);
        return;
      }
      if (c.id === 'draft') {
        if (!uiState(this.scene).draftOpen) {
          this.drop();
          this.visitDone.add('draft');
        }
        return;
      }
      // Hints hide under an owning overlay. A hint the player already SAW is done for this Landing (cert
      // ftue:repeat: a beat shows once); only one that never reached the screen, or the ore gate, re-queues.
      if (overlayOwned(host)) {
        const seen = c.handle !== null && c.id !== 'ore';
        this.drop();
        if (seen) this.visitDone.add(c.id);
        else this.queue.unshift(c.id);
        return;
      }
      if (c.id === 'ore') this.syncOre(c);
      if (this.current !== null && this.scene.time.now - c.since > GATE_TIMEOUT_MS && c.id === 'ore') {
        this.drop();
        this.visitDone.add('ore');
      }
      return;
    }
    // First startable beat wins: the draft beat needs its draft open, every other beat needs the screen free.
    const draftOpen = uiState(this.scene).draftOpen;
    const owned = overlayOwned(host);
    const i = this.queue.findIndex((id) => (id === 'draft' ? draftOpen : !owned && (id !== 'vent' || this.visibleVent() !== null)));
    if (i < 0) return;
    const [next] = this.queue.splice(i, 1);
    if (next !== undefined) this.start(next);
  }

  private start(id: BeatId): void {
    this.current = { id, handle: null, step: 0, rect: null, since: this.scene.time.now };
    if (id === 'ore') this.syncOre(this.current);
    else if (id === 'vent') {
      // No camera jump mid-build (critic2 #5): the vent hint waits until the vent is in the playfield.
      const rect = this.visibleVent();
      if (rect === null) {
        this.current = null;
        this.queue.push('vent');
        return;
      }
      this.show('vent', rect, 'hint');
    } else if (id === 'feed') {
      if (!this.needsFood()) this.current = null;
      else {
        this.show('feed', DOCK_ROW, 'hint');
        // Once per save (orchestrator): shown = taught, it never returns on a later Landing.
        save('tut:feed', true);
      }
    } else if (id === 'dock') this.show('dock', DOCK_ROW, 'hint');
    else if (id === 'grid') this.show('grid', DOCK_ROW, 'hint');
    else if (id === 'draft') this.show('draft', DRAFT_CARDS, 'hint');
  }

  private show(id: BeatId, rect: CoachRect, mode: 'tap' | 'swap-gate' | 'hint', text = COPY[id]): void {
    const c = this.current;
    if (c === null || c.id !== id) return;
    c.handle?.destroy();
    const handle = showCoach(this.scene, {
      id,
      target: rect,
      text,
      mode,
      pad: mode === 'swap-gate' ? 0 : 12,
      // The gate never owns the status band: pause and ×1/×2 stay live during the ore beat (critic build4).
      passBands: [STATUS_BAND],
      // A tapped-away hint leaves the flag unset: it is taught by the action, not by the tap.
      onDone: () => {
        if (this.current?.handle === handle) {
          this.current = null;
          this.clearRect();
        }
      },
    });
    // Law 3: the flag is written on COMPLETION, not on show.
    save(`tut:${id}`, false);
    c.handle = handle;
    c.rect = rect;
    uiState(this.scene).coachRect = rect;
  }

  /** Ore: step 0 spotlights the nearest in-field ore (gated); once its BUILD chip is up, step 1 spotlights the tray. */
  private syncOre(c: NonNullable<ColonyCoachBeats['current']>): void {
    const bridge = this.host;
    const chip = bridge.depositChip;
    if (chip !== null && chip.def === 'ferrite_drill') {
      if (c.step !== 1) {
        const ok = bridge.model.canPlace(chip.def, chip.col, chip.row).ok;
        if (!ok) return;
        c.step = 1;
        this.show('ore', { x: TRAY_RECT.x, y: TRAY_RECT.y, w: TRAY_RECT.w, h: TRAY_RECT.h }, 'swap-gate', 'Now tap BUILD — the drill runs itself.');
      }
      return;
    }
    const dep = this.nearestDeposit('ore');
    if (dep === null) {
      this.drop();
      this.visitDone.add('ore');
      return;
    }
    if (c.step !== 0 || c.handle === null) {
      if (c.step === 1 || c.rect === null) {
        c.step = 0;
        this.host.panTo(dep.col + 1, dep.row + 1);
        c.rect = { x: -1, y: -1, w: 0, h: 0 };
        c.handle?.destroy();
        c.handle = null;
        return;
      }
    }
    // Re-cut the spotlight when the camera moved the deposit (pan, zoom).
    const rect = this.depositRect(dep.col, dep.row);
    const r = c.rect;
    if (r === null || c.handle === null || Math.abs(r.x - rect.x) > 12 || Math.abs(r.y - rect.y) > 12 || Math.abs(r.w - rect.w) > 12) {
      this.show('ore', rect, 'swap-gate');
    }
  }

  /** Rations falling and no Hydro Terrace standing (the `feed` gate). */
  private needsFood(): boolean {
    const m = this.host.model;
    if (this.host.view().rates.rations >= 0) return false;
    for (const b of m.buildings.values()) if (b.def === 'hydro_terrace') return false;
    return true;
  }

  /** Screen rect of the nearest open vent when it sits inside the playfield band, else null. */
  private visibleVent(): CoachRect | null {
    const dep = this.nearestDeposit('vent');
    if (dep === null) return null;
    const r = this.depositRect(dep.col, dep.row);
    const inside = r.x >= PLAYFIELD.x && r.y >= PLAYFIELD.y && r.x + r.w <= PLAYFIELD.x + PLAYFIELD.w && r.y + r.h <= PLAYFIELD.y + PLAYFIELD.h;
    return inside ? r : null;
  }

  /** The nearest lit, revealed, unbuilt deposit of a kind to the core. */
  private nearestDeposit(kind: DepositKind): { col: number; row: number } | null {
    const model = this.host.model;
    const core = model.map.core;
    let best: { col: number; row: number } | null = null;
    let bestD = Infinity;
    for (const d of model.map.deposits) {
      if (d.kind !== kind) continue;
      const i = model.tileIndex(d.col, d.row);
      if (model.lit[i] !== 1 || model.revealed[i] !== 1 || model.occ[i] !== 0) continue;
      const dist = Math.hypot(d.col - core.col, d.row - core.row);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best;
  }

  private depositRect(col: number, row: number): CoachRect {
    const bridge = this.host;
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    bridge.tileToScreen(col, row, a);
    bridge.tileToScreen(col + 1, row + 1, b);
    const tile = Math.max(8, b.x - a.x);
    return { x: a.x - tile / 2, y: a.y - tile / 2, w: tile * 2, h: tile * 2 };
  }

  // ── dusk (pausing owner) ──────────────────────────────────────────────

  private openDusk(edge: 0 | 1 | 2 | 3): void {
    if (this.visitDone.has('dusk') || uiState(this.scene).coachOwner) return;
    const host = this.host;
    const s = uiState(this.scene);
    // CoachDusk outranks sheets and the card (law 1); a showing hint steps aside.
    s.sheet?.close();
    if (s.cardUid !== null) host.select(null);
    if (this.current !== null) {
      const id = this.current.id;
      // A hint the player already saw is done for this Landing (it never re-shows after the dusk beat).
      const seen = this.current.handle !== null && id !== 'ore';
      this.drop();
      if (seen) this.visitDone.add(id);
      else if (id !== 'dusk') this.queue.unshift(id);
    }
    s.coachOwner = true;
    const model = host.model;
    const affordable = model.canAfford(model.costOf('pulse_turret')) && buildingDef('pulse_turret').unlockSol <= model.clock.sol;
    // duskArrowRect already spans the arrow plus its "×N" count label, so ui/coach's hand (placed outside the spotlight) never covers the count.
    const arrow = host.duskArrowRect(edge) ?? edgeFallback(edge);
    this.duskEdge = edge;
    this.duskText = affordable ? COPY.dusk : DUSK_BROKE;
    this.current = { id: 'dusk', handle: null, step: 0, rect: arrow, since: this.scene.time.now };
    this.show('dusk', arrow, 'tap', this.duskText);
    const handle = this.current.handle;
    if (handle === null) {
      this.openDuskPanel(affordable);
      return;
    }
    // After the spotlight is read (tap), the map and dock go live under a RESUME panel.
    const scene = this.scene;
    const wait = scene.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => {
        // Still on the spotlight (re-cut handles included when the arrow moved): keep waiting for its tap.
        if (this.current?.id === 'dusk' && this.current.step === 0 && this.current.handle !== null) return;
        wait.remove();
        if (!this.tearingDown && this.duskPanel === null && !this.visitDone.has('dusk')) this.openDuskPanel(affordable);
      },
    });
  }

  /** Dusk spotlight follows tonight's arrow AS DRAWN (the camera can still pan while the clock is held). */
  private syncDusk(c: NonNullable<ColonyCoachBeats['current']>): void {
    if (c.step !== 0 || c.handle === null || this.duskEdge === null) return;
    const rect = this.host.duskArrowRect(this.duskEdge);
    const r = c.rect;
    if (rect === null || r === null) return;
    if (Math.abs(r.x - rect.x) > 12 || Math.abs(r.y - rect.y) > 12 || Math.abs(r.w - rect.w) > 12 || Math.abs(r.h - rect.h) > 12) {
      this.show('dusk', rect, 'tap', this.duskText);
    }
  }

  private openDuskPanel(affordable: boolean): void {
    const scene = this.scene;
    const py = PANEL.y;
    this.current = { id: 'dusk', handle: null, step: 1, rect: DOCK_SLOTS[0] ?? null, since: scene.time.now };
    uiState(scene).coachRect = DOCK_SLOTS[0] ?? null;
    const root = scene.add.container(0, 0).setDepth(UI_DEPTH.coach);
    const text = affordable ? 'Place a turret from slot 1, then RESUME.' : DUSK_BROKE;
    const plate = placard(scene, PANEL.x, py, PANEL.w, PANEL.h, PALETTE.accent);
    const copy = label(scene, PANEL.x + 24, py + PANEL.h / 2, text, { size: 24, bold: true, wrap: 390, origin: [0, 0.5] });
        const resume = new Control(scene, PANEL.x + PANEL.w - 204, py, 196, 88, 'RESUME', 'primary', () => this.resumeDusk(), { size: 28 });
    const slot = DOCK_SLOTS[0];
    const ringG = scene.add.graphics();
    if (slot !== undefined) ringG.lineStyle(6, PALETTE.accent, 1).strokeRoundedRect(slot.x - 6, slot.y - 6, slot.w + 12, slot.h + 12, 20);
    const ring = scene.tweens.add({ targets: ringG, alpha: { from: 1, to: 0.35 }, duration: 520, yoyo: true, repeat: -1 });
    root.add([plate, copy, resume.root, ringG]);
    pin(root);
    this.duskPanel = { root, resume, ring };
  }

  /** RESUME completes the beat when a turret stands, or when none was affordable (no paused-coach deadlock). */
  private resumeDusk(): void {
    const model = this.host.model;
    let turrets = 0;
    for (const b of model.buildings.values()) if (buildingDef(b.def).turret !== null) turrets += 1;
    const affordable = model.canAfford(model.costOf('pulse_turret'));
    this.closeDusk(turrets > 0 || !affordable);
  }

  private closeDusk(taught: boolean): void {
    const p = this.duskPanel;
    this.duskPanel = null;
    if (p !== null) {
      p.ring.remove();
      p.resume.destroy();
      if (p.root.scene) p.root.destroy();
    }
    if (this.current?.id === 'dusk') {
      this.current.handle?.destroy();
      this.current = null;
    }
    this.clearRect();
    uiState(this.scene).coachOwner = false;
    if (taught) this.complete('dusk');
    else this.visitDone.add('dusk');
    // Coach close disarms sticky build mode (critic2 #2) — no armed turret left behind the resumed clock.
    if (!this.tearingDown) this.host.disarm();
  }

  destroy(): void {
    if (this.tearingDown) return;
    this.tearingDown = true;
    this.timer.remove();
    if (this.duskPanel !== null) this.closeDusk(false);
    this.current?.handle?.destroy();
    this.current = null;
    this.queue.length = 0;
    uiState(this.scene).coachOwner = false;
    this.clearRect();
  }
}

/** Where the arrow sits when the view could not report it: the playfield band edge (interface-direction §5). */
function edgeFallback(edge: 0 | 1 | 2 | 3): CoachRect {
  const size = 96;
  const spots = [
    { x: 360, y: PLAYFIELD.y + 48 },
    { x: PLAYFIELD.x + PLAYFIELD.w - 48, y: PLAYFIELD.y + PLAYFIELD.h / 2 },
    { x: 360, y: PLAYFIELD.y + PLAYFIELD.h - 48 },
    { x: PLAYFIELD.x + 48, y: PLAYFIELD.y + PLAYFIELD.h / 2 },
  ] as const;
  const s = spots[edge];
  return { x: s.x - size / 2, y: s.y - size / 2, w: size, h: size };
}
