import type Phaser from 'phaser';
import { BUILDINGS, buildingDef, type BuildingId } from '../../slices/colony/content';
import type { ColonyUiHost, ColonyView, ColonyWidget } from '../../slices/colony/contracts';
import { stripNotice, uiState } from './bridge';
import { Control, UI_DEPTH, costLabel, missingLabel, pin } from './theme';

/**
 * BuildDock (interface-direction §5: 5 slots 120 × 92 at x 40/170/300/430/560,
 * y 964; icon 56 + cost 22 px). Slot 1 = Ferrite Drill by day, the cheapest
 * affordable turret at dusk/night (pops on the swap; back at dawn). Slot 2 =
 * the Relay Pylon, pinned. Slots 3-4 = the two most recent picks not already
 * shown (seeded Hydro Terrace + Rime Borer); slot 5 is ALL (→ Build sheet). Unaffordable slots sit at 0.45 alpha;
 * a tap shakes and names the missing good on the ContextStrip, never arms.
 */
const SLOT = { y: 964, w: 120, h: 92, xs: [40, 170, 300, 430, 560] } as const;
const DOCKED = 4;
/** Slot 2 is always the Relay Pylon. */
const PINNED: BuildingId = 'relay_pylon';
/** How many recent picks the dock remembers (slots 3-4 show the first two not already on slots 1-2). */
const MRU_KEEP = 6;
/** Slot 1 holds still this long after any dock touch. */
const FREEZE_MS = 2000;
const TURRETS: readonly BuildingId[] = BUILDINGS.filter((d) => d.turret !== null).map((d) => d.id);

export class BuildDock implements ColonyWidget {
  private readonly host: ColonyUiHost;
  private readonly root: Phaser.GameObjects.Container;
  private readonly slots: Control[] = [];
  /** Recently armed buildings, most recent first. */
  private readonly base: BuildingId[] = [];
  /** What each slot shows right now (slot 1 may be the dusk turret). */
  private readonly shown: Array<BuildingId | null> = [null, null, null, null];
  private lastArmed: BuildingId | null = null;
  /** Slot 1's current content (frozen per `touchedUntil` / armed). */
  private context: BuildingId | null = null;
  private touchedUntil = 0;
  private deaf = false;
  private readonly reported = new Set<string>();
  /** What each docked slot shows this update (reused, never reallocated). */
  private readonly layout: Array<BuildingId | null> = [];

  constructor(host: ColonyUiHost) {
    this.host = host;
    const scene = host.scene;
    this.root = scene.add.container(0, 0).setDepth(UI_DEPTH.hud + 3);
    for (let i = 0; i < DOCKED; i += 1) {
      const c = new Control(scene, SLOT.xs[i] as number, SLOT.y, SLOT.w, SLOT.h, '', 'secondary', () => this.onSlot(i), {
        size: 22,
        icon: 'ico-drill',
        iconSize: 56,
        softDisable: true,
        onRefused: () => this.onRefused(i),
      });
      this.slots.push(c);
      this.root.add(c.root);
    }
    const all = new Control(scene, SLOT.xs[4], SLOT.y, SLOT.w, SLOT.h, 'ALL', 'secondary', () => {
      host.disarm();
      host.openSheet('build');
    }, { size: 30 });
    this.slots.push(all);
    this.root.add(all.root);
    pin(this.root);
    this.update(host.view());
  }

  update(v: ColonyView): void {
    if (this.base.length === 0) this.seed(v);
    const armed = this.host.armed;
    // MRU (critic final #9): the dock never reorders while a building is armed — the armed card keeps
    // its slot. A building joins the front of the recents only once it is let go (DONE, disarm, swap).
    const prev = this.lastArmed;
    if (prev !== null && prev !== armed) {
      const at = this.base.indexOf(prev);
      if (at >= 0) this.base.splice(at, 1);
      this.base.unshift(prev);
      if (this.base.length > MRU_KEEP) this.base.length = MRU_KEEP;
    }
    this.lastArmed = armed;
    // The dawn draft owns input: every dock slot (ALL included) is deaf under its scrim.
    const deaf = uiState(this.host.scene).draftOpen;
    if (deaf !== this.deaf) {
      this.deaf = deaf;
      for (const c of this.slots) c.setDeaf(deaf);
    }
    if (!deaf) this.checkInput();
    const layout = this.layout;
    layout.length = 0;
    // Slot 1 = context: the cheapest affordable turret at dusk/night; by day the Hydro Terrace while
    // rations fall, else the Ferrite Drill. Slot 2 = the Relay Pylon, pinned (the grid is the core verb).
    // Slot 1 changes only at the phase edges: the Ferrite Drill by day, the cheapest affordable turret at dusk/night.
    const wanted: BuildingId = v.phase !== 'day' ? this.duskTurret(v) : 'ferrite_drill';
    // Never swap slot 1 under the thumb (critic build3): frozen while armed and for 2 s after any dock touch;
    // a swap that does land pops so it is noticed.
    const now = this.host.scene.time.now;
    const frozen = armed !== null || now < this.touchedUntil;
    if (this.context === null || (!frozen && wanted !== this.context)) {
      if (this.context !== null) this.popSlot0();
      this.context = wanted;
    }
    const context = this.context;
    layout.push(context, PINNED);
    for (const id of this.base) {
      if (layout.length >= DOCKED) break;
      if (!layout.includes(id)) layout.push(id);
    }
    // An armed building from the sheet that is not on the dock shows in slot 3 while armed.
    if (armed !== null && !layout.includes(armed)) {
      layout.splice(2, 0, armed);
      layout.length = DOCKED;
    }
    const model = this.host.model;
    for (let i = 0; i < DOCKED; i += 1) {
      const id = layout[i] ?? null;
      if (id === null) continue;
      const c = this.slots[i] as Control;
      if (id !== this.shown[i]) {
        this.shown[i] = id;
        c.setIcon(buildingDef(id).iconKey);
        c.root.setData('buildingId', id);
      }
      const d = buildingDef(id);
      const locked = d.unlockSol > v.sol;
      const cost = model.costOf(id);
      c.setLabel(locked ? `Sol ${d.unlockSol}` : costLabel(cost));
      c.text.setScale(Math.min(1, (SLOT.w - 8) / Math.max(1, c.text.width)));
      c.setEnabled(!locked && model.canAfford(cost));
      c.setKind(armed === id ? 'primary' : 'secondary');
    }
  }

  /** Slot 1 at dusk/night: the cheapest affordable unlocked turret (else the cheapest unlocked one). */
  private duskTurret(v: ColonyView): BuildingId {
    const model = this.host.model;
    let best: BuildingId = 'pulse_turret';
    let bestFe = Infinity;
    let bestAffordable = false;
    for (const id of TURRETS) {
      const d = buildingDef(id);
      if (d.unlockSol > v.sol) continue;
      const cost = model.costOf(id);
      const ok = model.canAfford(cost);
      const fe = cost.ferrite ?? 0;
      if ((ok && !bestAffordable) || (ok === bestAffordable && fe < bestFe)) {
        best = id;
        bestFe = fe;
        bestAffordable = ok;
      }
    }
    return best;
  }

  /** Initial recent list: the view's suggestion minus turrets and the pinned relay, food and ice first. */
  private seed(v: ColonyView): void {
    // Food stays 2 taps from t = 0: terrace + borer seed slots 3-4.
    for (const id of ['hydro_terrace', 'rime_borer'] as const) this.base.push(id);
    for (const id of v.dockSuggest) if (!TURRETS.includes(id) && id !== PINNED && id !== 'ferrite_drill' && !this.base.includes(id)) this.base.push(id);
    if (this.base.length > MRU_KEEP) this.base.length = MRU_KEEP;
  }

  /** Dock invariant: with no draft up, every live-looking slot takes input. Violations log once per slot. */
  inputViolations(): string[] {
    const out: string[] = [];
    this.slots.forEach((c, i) => {
      const v = c.checkLive(i === DOCKED ? 'dock ALL' : `dock slot ${i + 1}`);
      if (v !== null) out.push(v);
    });
    return out;
  }

  private checkInput(): void {
    for (const v of this.inputViolations()) if (!this.reported.has(v)) {
      this.reported.add(v);
      console.warn(`colony ui invariant: ${v}`);
    }
  }

  private popSlot0(): void {
    const root = (this.slots[0] as Control).root;
    this.host.scene.tweens.killTweensOf(root);
    root.setScale(1);
    this.host.scene.tweens.add({ targets: root, scale: { from: 1.18, to: 1 }, duration: 260, ease: 'Back.easeOut' });
  }

  private onSlot(i: number): void {
    this.touchedUntil = this.host.scene.time.now + FREEZE_MS;
    const id = this.shown[i];
    if (id === null || id === undefined) return;
    if (this.host.armed === id) {
      this.host.disarm();
      return;
    }
    this.host.arm(id);
    // The host refuses arming while the dawn ceremony leads into the draft: never a silent dead tap.
    if (this.host.armed !== id) {
      (this.slots[i] as Control).shake();
      stripNotice(this.host.scene, 'Dawn — pick a directive first');
    }
  }

  private onRefused(i: number): void {
    this.touchedUntil = this.host.scene.time.now + FREEZE_MS;
    const id = this.shown[i];
    if (id === null || id === undefined) return;
    const d = buildingDef(id);
    const model = this.host.model;
    if (d.unlockSol > model.clock.sol) {
      stripNotice(this.host.scene, `${d.name} unlocks on sol ${d.unlockSol}`);
      return;
    }
    this.host.want(id);
    stripNotice(this.host.scene, missingLabel(model.costOf(id), model.stock) ?? d.name);
  }

  destroy(): void {
    for (const c of this.slots) c.destroy();
    if (this.root.scene) this.root.destroy();
  }
}

/** Dock slot rects in screen px (coach beats); slot 5 is ALL. */
export const DOCK_SLOTS = SLOT.xs.map((x) => ({ x, y: SLOT.y, w: SLOT.w, h: SLOT.h }));
