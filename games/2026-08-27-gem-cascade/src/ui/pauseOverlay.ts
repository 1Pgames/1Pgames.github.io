import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../config';
import { isMuted, toggleMute } from '../core/audio';
import { Button } from './button';

/**
 * Full-screen pause overlay: dim + "PAUSED" heading, Resume / Restart / Mute
 * buttons. Caller owns actually pausing the run (combat + director) before
 * showing this and resuming after `onResume`/tearing down on restart — this
 * module only draws and listens, same contract as `ui/cards.ts`.
 */
export interface PauseOverlayHandle {
  destroy(): void;
}

export function showPauseOverlay(
  scene: Phaser.Scene,
  onResume: () => void,
  onRestart: () => void,
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

  const resume = new Button(
    scene,
    VIEW.centerX,
    VIEW.centerY - 60,
    'RESUME',
    () => {
      if (resolved) return;
      resolved = true;
      onResume();
    },
    { width: buttonWidth, height: 112 },
  );
  const restart = new Button(
    scene,
    VIEW.centerX,
    VIEW.centerY + 70,
    'RESTART',
    () => {
      if (resolved) return;
      resolved = true;
      onRestart();
    },
    { width: buttonWidth, height: 96, fill: PALETTE.bgTop, stroke: PALETTE.primary, textColor: CSS.ink },
  );
  const muteButton = new Button(
    scene,
    VIEW.centerX,
    VIEW.centerY + 190,
    isMuted() ? 'SOUND: OFF' : 'SOUND: ON',
    () => muteButton.setLabel(toggleMute() ? 'SOUND: OFF' : 'SOUND: ON'),
    { width: buttonWidth, height: 88, fill: PALETTE.bgTop, stroke: PALETTE.primary, textColor: CSS.inkSoft, fontSize: '32px' },
  );
  root.add([resume, restart, muteButton]);

  return {
    destroy(): void {
      root.destroy(true);
    },
  };
}
