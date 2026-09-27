/**
 * Colony `Pause` owner (PRD §14 overlay table, §14b): RESUME, SETTINGS and
 * ABANDON LANDING (behind a confirm) — no RESTART, because a restart must
 * settle (ABANDON → results → RETRY). Chrome per interface-direction §2:
 * panel bgTop 0.94 with the brass pin-line, scrim bgDeep 0.6, danger button
 * badFill with ink label.
 */
import Phaser from 'phaser';
import { CSS, PALETTE, TEXT, VIEW } from '../../../config';
import { Button } from '../../../ui/button';
import { confirmDialog, openSettingsSheet, type OverlayHandle } from '../../../ui/sheet';

export interface ColonyPauseActions {
  onResume(): void;
  onAbandon(): void;
}

export interface ColonyPauseHandle {
  destroy(): void;
  /** SETTINGS or the abandon confirm is open (ESC belongs to it, not to RESUME). */
  readonly childOpen: boolean;
}

const DEPTH = 2100;
const W = 560;
const H = 520;

export function showColonyPause(scene: Phaser.Scene, sol: number, actions: ColonyPauseActions): ColonyPauseHandle {
  const root = scene.add.container(0, 0).setDepth(DEPTH).setScrollFactor(0);
  const scrim = scene.add.rectangle(0, 0, VIEW.width, VIEW.height, PALETTE.bgDeep, 0.6).setOrigin(0, 0).setScrollFactor(0).setInteractive();
  const x0 = (VIEW.width - W) / 2;
  const y0 = (VIEW.height - H) / 2 - 40;
  const panel = scene.add.graphics().setScrollFactor(0);
  panel.fillStyle(PALETTE.bgTop, 0.94).fillRoundedRect(x0, y0, W, H, 18);
  panel.lineStyle(3, PALETTE.bgDeep, 1).strokeRoundedRect(x0, y0, W, H, 18);
  panel.lineStyle(1, PALETTE.accent, 0.35).strokeRoundedRect(x0 + 4, y0 + 4, W - 8, H - 8, 14);
  const title = scene.add
    .text(VIEW.centerX, y0 + 64, 'PAUSED', { ...TEXT.heading, strokeThickness: 0, shadow: undefined })
    .setOrigin(0.5)
    .setScrollFactor(0);
  const sub = scene.add
    .text(VIEW.centerX, y0 + 116, `SOL ${sol} · the colony holds its breath`, { ...TEXT.label, color: CSS.inkSoft, strokeThickness: 0, shadow: undefined })
    .setOrigin(0.5)
    .setScrollFactor(0);
  root.add([scrim, panel, title, sub]);

  let child: OverlayHandle | null = null;
  let done = false;
  const bw = W - 80;
  const resume = new Button(scene, VIEW.centerX, y0 + 210, 'RESUME', () => {
    if (done || child !== null) return;
    actions.onResume();
  }, { width: bw, height: 96, fill: PALETTE.primary, stroke: PALETTE.bgDeep, textColor: CSS.bgDeep, fontSize: '34px' });
  const settings = new Button(scene, VIEW.centerX, y0 + 320, 'SETTINGS', () => {
    if (done || child !== null) return;
    child = openSettingsSheet(scene, { onClose: () => (child = null) });
  }, { width: bw, height: 88, fill: 0x3a4a52, stroke: PALETTE.bgDeep, textColor: CSS.ink, fontSize: '30px' });
  const abandon = new Button(scene, VIEW.centerX, y0 + 430, 'ABANDON LANDING', () => {
    if (done || child !== null) return;
    child = confirmDialog(scene, {
      title: 'ABANDON THIS LANDING?',
      body: 'The Landing ends now and settles as a loss.\nData for the sols survived is still banked.',
      confirmLabel: 'ABANDON',
      destructive: true,
      onConfirm: () => {
        child = null;
        actions.onAbandon();
      },
      onCancel: () => (child = null),
    });
  }, { width: bw, height: 88, fill: PALETTE.badFill, stroke: PALETTE.bgDeep, textColor: CSS.ink, fontSize: '30px' });
  root.add([resume, settings, abandon]);

  return {
    get childOpen(): boolean {
      return child !== null;
    },
    destroy(): void {
      if (done) return;
      done = true;
      child?.close();
      child = null;
      root.destroy();
    },
  };
}
