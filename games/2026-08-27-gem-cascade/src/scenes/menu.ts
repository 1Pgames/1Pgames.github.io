import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../config';
import { SCENES } from '../core/keys';
import { isMuted, sfx, toggleMute, unlockAudio } from '../core/audio';
import { startMusic } from '../core/music';
import { enterFromBottom, idleBob } from '../core/juice';
import { loadMeta } from '../core/progression';
import { Button } from '../ui/button';
import { addBackground } from '../ui/background';
import { ICON, TEXTURE } from '../data/art';

/** mm:ss clock for the best-run readout. */
function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Title screen for the survivor-like slice: name, lifetime best score/time,
 * current meta currency, and the three doors into the loop — play, the meta
 * shop, and mute. Buttons are stacked full-width in the bottom safe area so
 * the whole screen stays one-thumb reachable.
 */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super(SCENES.menu);
  }

  create(): void {
    addBackground(this);
    const meta = loadMeta();

    // Generated crest above the title; the engine draws the wordmark itself.
    const emblem = this.add
      .image(VIEW.centerX, VIEW.centerY - 440, TEXTURE.logo)
      .setDisplaySize(260, 260);
    idleBob(this, emblem, 10, 2200);

    const title = this.add
      .text(VIEW.centerX, VIEW.centerY - 300, 'GEM\nCASCADE', {
        ...TEXT.title,
        align: 'center',
        color: CSS.primary,
      })
      .setOrigin(0.5)
      .setLineSpacing(-16);
    idleBob(this, title, 12);

    const bestText = this.add
      .text(
        VIEW.centerX,
        VIEW.centerY - 100,
        `BEST SCORE  ${meta.stats.bestScore}\nBEST TIME  ${formatClock(meta.stats.bestTimeMs)}`,
        { ...TEXT.heading, fontSize: '40px', align: 'center' },
      )
      .setOrigin(0.5)
      .setLineSpacing(8);

    const currencyIcon = this.add
      .image(VIEW.centerX - 46, VIEW.centerY + 30, ICON.coin.key, ICON.coin.frame)
      .setDisplaySize(38, 38);
    const currencyText = this.add
      .text(VIEW.centerX + 4, VIEW.centerY + 30, `${meta.currency}`, {
        ...TEXT.body,
        color: CSS.accent,
      })
      .setOrigin(0, 0.5);

    const howTo = this.add
      .text(VIEW.centerX, VIEW.centerY + 90, 'Swap gems. Hit every goal before moves run out.', {
        ...TEXT.body,
        align: 'center',
      })
      .setOrigin(0.5);

    const buttonWidth = VIEW.width - SAFE.side * 2;
    const playY = VIEW.height - SAFE.bottom - 220;
    const upgradesY = VIEW.height - SAFE.bottom - 100;
    const muteY = VIEW.height - SAFE.bottom;

    const play = new Button(this, VIEW.centerX, playY, 'PLAY', () => {
      this.cameras.main.fadeOut(180, 0, 0, 0);
      this.time.delayedCall(190, () => this.scene.start(SCENES.game));
    }, { width: buttonWidth, height: 112 });

    const upgrades = new Button(
      this,
      VIEW.centerX,
      upgradesY,
      'UPGRADES',
      () => this.scene.start(SCENES.meta),
      { width: buttonWidth, height: 96, fill: PALETTE.bgTop, stroke: PALETTE.primary, textColor: CSS.ink },
    );

    const muteButton = new Button(
      this,
      VIEW.centerX,
      muteY,
      isMuted() ? 'SOUND: OFF' : 'SOUND: ON',
      () => muteButton.setLabel(toggleMute() ? 'SOUND: OFF' : 'SOUND: ON'),
      { width: buttonWidth, height: 88, fill: PALETTE.bgTop, stroke: PALETTE.primary, textColor: CSS.inkSoft, fontSize: '32px' },
    );

    enterFromBottom(this, bestText, 40);
    enterFromBottom(this, currencyIcon, 80);
    enterFromBottom(this, currencyText, 80);
    enterFromBottom(this, howTo, 120);
    enterFromBottom(this, play, 160);
    enterFromBottom(this, upgrades, 200);
    enterFromBottom(this, muteButton, 240);

    // Any key/tap also starts the game — fewer taps means better retention.
    this.input.keyboard?.once('keydown-SPACE', () => this.scene.start(SCENES.game));
    this.input.once(Phaser.Input.Events.POINTER_DOWN, () => {
      unlockAudio();
      sfx('ui', { volume: 0.5 });
    });

    this.cameras.main.fadeIn(240, 0, 0, 0);

    startMusic('menu');
  }
}
