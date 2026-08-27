import Phaser from 'phaser';
import { SCENES } from '../core/keys';
import { buildTextures } from '../core/textures';

/**
 * Runs once. Registers procedural textures and anything the loading screen
 * itself needs to draw. Never load remote assets here.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENES.boot);
  }

  create(): void {
    buildTextures(this);
    this.scene.start(SCENES.preload);
  }
}
