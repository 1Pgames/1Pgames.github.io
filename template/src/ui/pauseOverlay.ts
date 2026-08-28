import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../config';
import { isMuted, toggleMute } from '../core/audio';
import { Button } from './button';

/**
 * Full-screen pause overlay: dim + "PAUSED" heading, Resume / Restart /
 * (Menu) / Mute buttons. Caller owns actually pausing the run (combat +
 * director) before showing this, resuming after `onResume`, and tearing the
 * scene down on `onRestart`/`onMenu` — this module only draws and listens,
 * same contract as `ui/cards.ts`.
 *
 * MENU is the run's exit door and the reason the overlay has four rows: a
 * player who is out of patience with a level must not have to lose it (or
 * reload the page) to get back to the map. It is optional only because a
 * family whose run IS the menu (a single endless surface) has nowhere to go;
 * every slice with its own menu scene passes it, and the row is dropped
 * entirely — not greyed — when it is absent.
 */
export interface PauseOverlayHandle {
  destroy(): void;
}

export interface PauseOverlayActions {
  onResume: () => void;
  onRestart: () => void;
  /**
   * Abandons the run for the menu. The caller owns the teardown (stop its own
   * timers/director, then `scene.start(SCENES.menu)`). Absent = no MENU row.
   */
  onMenu?: () => void;
}

export function showPauseOverlay(
  scene: Phaser.Scene,
  actions: PauseOverlayActions,
): PauseOverlayHandle {
  const root = scene.add.container(0, 0).setDepth(2100).setScrollFactor(0);

  const dim = scene.add
    .rectangle(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height, 0x000000, 0.65)
    .setScrollFactor(0)
    .setInteractive();
  root.add(dim);

  const heading = scene.add
    .text(VIEW.centerX, VIEW.centerY - 260, 'PAUSED', { ...TEXT.title, fontSize: '72px' })
    .setOrigin(0.5)
    .setScrollFactor(0);
  root.add(heading);

  const buttonWidth = VIEW.width - SAFE.side * 2;
  let resolved = false;

  // Rows are ordered by how likely they are to be the reason the player
  // paused, with the destructive ones further from the thumb's resting spot.
  // The stack is centred on the heading either way: dropping MENU closes the
  // gap instead of leaving a hole where it was.
  const onMenu = actions.onMenu;
  const resumeY = VIEW.centerY + (onMenu === undefined ? -60 : -110);
  const restartY = VIEW.centerY + (onMenu === undefined ? 70 : 20);
  const muteY = VIEW.centerY + (onMenu === undefined ? 190 : 240);

  const resume = new Button(
    scene,
    VIEW.centerX,
    resumeY,
    'RESUME',
    () => {
      if (resolved) return;
      resolved = true;
      actions.onResume();
    },
    { width: buttonWidth, height: 112 },
  );
  const restart = new Button(
    scene,
    VIEW.centerX,
    restartY,
    'RESTART',
    () => {
      if (resolved) return;
      resolved = true;
      actions.onRestart();
    },
    { width: buttonWidth, height: 96, fill: PALETTE.bgTop, stroke: PALETTE.primary, textColor: CSS.ink },
  );
  root.add([resume, restart]);

  if (onMenu !== undefined) {
    const menu = new Button(
      scene,
      VIEW.centerX,
      VIEW.centerY + 130,
      'MENU',
      () => {
        if (resolved) return;
        resolved = true;
        onMenu();
      },
      { width: buttonWidth, height: 96, fill: PALETTE.bgTop, stroke: PALETTE.secondary, textColor: CSS.ink },
    );
    root.add(menu);
  }

  const muteButton = new Button(
    scene,
    VIEW.centerX,
    muteY,
    isMuted() ? 'SOUND: OFF' : 'SOUND: ON',
    () => muteButton.setLabel(toggleMute() ? 'SOUND: OFF' : 'SOUND: ON'),
    { width: buttonWidth, height: 88, fill: PALETTE.bgTop, stroke: PALETTE.primary, textColor: CSS.inkSoft, fontSize: '32px' },
  );
  root.add(muteButton);

  return {
    destroy(): void {
      root.destroy(true);
    },
  };
}
