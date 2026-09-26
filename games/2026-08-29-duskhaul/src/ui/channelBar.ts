import Phaser from 'phaser';
import { CSS, PALETTE, TEXT } from '../config';
import type { GateId, PoiKind } from '../data/types-v2';
import { HUD_DEPTH, IDENTITY, paintBar } from './duskChrome';

/**
 * The extraction channel readout — the screen-space half of the channel.
 *
 * The world-space arc around the player is spatial truth, but it is a stroke on
 * a 120px ring, and in the decisive measured frame the hero was completely
 * covered by an elite plus the swarm standing in that ring: the single most
 * important number in the game was invisible at the moment it mattered most.
 * This band carries the MAGNITUDE where nothing can stand on it. The slice
 * keeps the arc.
 *
 * PLACEMENT (§14 amendment, authored here because §14 gave this widget no
 * coordinate): §14.4 authors a channel FILL (`#8546dd`) and a channel
 * VIGNETTE, but never a channel BAR position. Two earlier positions were both
 * wrong, for opposite reasons, and the second one is the interesting failure:
 *
 * - (360, 332) sat INSIDE §14.3's Banner band (x 40-680, y 300-400), a band
 *   reserved for Warden-spawn, COLLAPSE-ignition and phase titles — all of
 *   which fire during a channel. Two widgets, one rect.
 * - (360, 440) cleared every authored rect, and was still wrong: a 640x56
 *   opaque bar 160px above a camera-centred player is parked ON THE APPROACH
 *   LANE. It covered the gate arch the player is standing in and the exact
 *   band the horde walks up through, for the 24s of a Gate A hold and the 60s+
 *   of a Collapse hold — i.e. it blocked the sightline the entire run is
 *   staked on, at the one moment that sightline decides the run. "Clear of
 *   every reserved band" is not the same as "clear of the game".
 *
 * The band it takes is x 108-500, y 146-190 (right of the §14.9 `LV` chip at
 * 40-96 × 140-168): the top strip of the playfield,
 * immediately under the §14.1 HUD band (0-140), LEFT of the PRD-V2 §14.10
 * minimap (520-680 × 152-312, 20 px gutter). V1 ran it the full 640 width;
 * the V2 minimap owns the right-hand 160 px of that strip now. It is clear of
 * the boss bar (y 300-348), the toast lane (360-448) and the compass ring
 * (from y 330), and ~450 px from the camera-centred hero, so nothing decisive
 * happens under it.
 *
 * It carries BOTH channels the V2 run has: gate extraction (`kind: 'gate'`)
 * and POI channels — chests, the vault, veins, bells (`kind: 'poi'`, fed from
 * `PoiSystem.channelling()`), each labelled in player language.
 * The coordinate is a CONTRACT value, so this component places itself. The
 * slice does not get to pass one in and drift it.
 * A HIT IS A SETBACK, NOT A RESET (`extract.hitSetbackMs` + `hitStallMs`, with
 * accrual continuing at `contestedRate`), so the fill animates DOWN one small
 * step and briefly freezes. It must never blank: blanking would misrepresent
 * the rule and read as total failure at a moment when the player is in fact
 * still winning.
 *
 * It renders only. It never reads game state.
 */

export interface ChannelBarModel {
  /** False hides the whole widget — no empty housing loitering in the band. */
  active: boolean;
  kind: 'gate' | 'poi';
  /** Gate being extracted through (`kind: 'gate'`). */
  gateId: GateId | null;
  /** POI being channelled (`kind: 'poi'`). */
  poiKind: PoiKind | null;
  /** 0..1. */
  progress: number;
  /** True on the frame a hit set the channel back. Drives the flash only. */
  interrupted: boolean;
  /**
   * The gate hold is KEPT but not advancing: the hero left the ring. The bar
   * greys out and says so — it must never read "extracting" off the gate.
   */
  paused: boolean;
}

const BAR = { width: 392, height: 44 } as const;

/** How long the interrupt flash holds before the bar returns to violet. */
const FLASH_MS = 220;

/** Fill for a paused (hero out of ring) gate hold. */
const PAUSED_FILL = 0x7e7376;

/** Fraction of the remaining gap closed per frame — a visible, not instant, step. */
const EASE = 0.25;

/** The channel bar's band, x 108-500 / y 146-190, expressed as its centre. */
const ANCHOR = { x: 304, y: 168 } as const;

/** Player-language verb per channelled POI (§5.12); unlisted kinds read CHANNELLING. */
const POI_VERB: Partial<Record<PoiKind, string>> = {
  chest_t1: 'OPENING CHEST',
  chest_t2: 'OPENING CHEST',
  chest_t3: 'OPENING CHEST',
  vault: 'OPENING VAULT',
  vein: 'MINING VEIN',
  bell: 'RINGING BELL',
  lore: 'READING',
  shrine_blood: 'BLOOD SHRINE',
  shrine_gilt: 'GILT SHRINE',
  shrine_bone: 'BONE SHRINE',
  shrine_grave: 'GRAVE SHRINE',
  shrine_curse: 'CURSE SHRINE',
};

export class ChannelBar {
  private readonly housing: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;

  /** Rendered progress, eased toward the model so a setback READS as a step back. */
  private shown = 0;
  private lastPainted = -1;
  private flashUntil = 0;
  private visible = false;
  private destroyed = false;

  /**
   * The label is built ONLY when the integer percent or the gate changes.
   * Formatting it every frame to compare it against the last one allocated
   * ~60 strings a second to discover that 59 of them were identical — on the
   * one path §15 exists to protect.
   */
  private lastPercent = -1;
  private lastKey = '';

  constructor(private readonly scene: Phaser.Scene) {
    // Depth, not just scroll factor: pinned to the camera still means drawn in
    // world order, and at depth 0 this bar sits under the exact bodies
    // contesting the ring that it exists to see past.
    this.housing = scene.add
      .graphics({ x: ANCHOR.x, y: ANCHOR.y })
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH.channelBar)
      .setVisible(false);
    // Numerals inside a bar sit on the HOUSING and the fill moves under them,
    // so §14.4 keeps their armour rather than stripping it.
    this.label = scene.add
      .text(ANCHOR.x, ANCHOR.y, '', { ...TEXT.button, fontSize: '24px', color: CSS.ink })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH.channelBar + 1)
      .setVisible(false);
  }

  update(model: ChannelBarModel): void {
    if (this.destroyed) return;

    if (!model.active) {
      if (this.visible) {
        this.visible = false;
        this.shown = 0;
        this.lastPainted = -1;
        this.lastPercent = -1;
        this.lastKey = '';
        this.housing.setVisible(false);
        this.label.setVisible(false);
      }
      return;
    }

    if (!this.visible) {
      this.visible = true;
      this.shown = Phaser.Math.Clamp(model.progress, 0, 1);
      this.housing.setVisible(true);
      this.label.setVisible(true);
    }

    const now = this.scene.time.now;
    if (model.interrupted) this.flashUntil = now + FLASH_MS;

    // Ease toward the target instead of snapping: a 5% step back that lands in
    // one frame is not perceivable, and perceiving the setback is the point.
    const target = Phaser.Math.Clamp(model.progress, 0, 1);
    this.shown += (target - this.shown) * EASE;
    if (Math.abs(target - this.shown) < 0.002) this.shown = target;

    const flashing = now < this.flashUntil;
    // `bad` is used here as a FILL, never as text — exactly how §11 permits it.
    const fill = flashing ? PALETTE.bad : model.paused ? PAUSED_FILL : IDENTITY.gateOpen;
    // Quantise the repaint: a Graphics redraw every frame for a bar that moves
    // a fraction of a percent per frame is waste, and 1% is finer than the eye.
    const step = Math.round(this.shown * 100) + (flashing ? 1000 : 0) + (model.paused ? 2000 : 0);
    if (step !== this.lastPainted) {
      this.lastPainted = step;
      paintBar(this.housing, BAR.width, BAR.height, this.shown, fill);
    }

    const percent = Math.floor(this.shown * 100);
    const key = model.kind === 'gate' ? `g${model.gateId ?? ''}${model.paused ? 'p' : ''}` : `p${model.poiKind ?? ''}`;
    if (percent !== this.lastPercent || key !== this.lastKey) {
      this.lastPercent = percent;
      this.lastKey = key;
      const gate = model.gateId === null ? '' : ` · GATE ${model.gateId.toUpperCase()}`;
      if (model.kind === 'gate' && model.paused) {
        this.label.setText(`HOLD PAUSED ${percent}% · RETURN${model.gateId === null ? '' : ` TO ${model.gateId.toUpperCase()}`}`);
      } else {
        const verb = model.kind === 'gate' ? `EXTRACTING${gate}` : ((model.poiKind !== null ? POI_VERB[model.poiKind] : undefined) ?? 'CHANNELLING');
        this.label.setText(`${verb} ${percent}%`);
      }
      // Long lines shrink to the housing rather than spill past it.
      this.label.setScale(1);
      if (this.label.width > BAR.width - 16) this.label.setScale((BAR.width - 16) / this.label.width);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.housing.destroy();
    this.label.destroy();
  }
}
