import Phaser from 'phaser';
import { SCENES } from '../core/keys';
import { buildTextures } from '../core/textures';
import { settleAbandonedRun } from '../core/progression';

/**
 * Runs once. Registers procedural textures and anything the loading screen
 * itself needs to draw. Never load remote assets here.
 *
 * It also closes the §14b ABANDON RULE: `GameScene` journals an in-flight
 * marker at run start and every settlement clears it, so a marker still present
 * here belongs to a run that was reloaded, backgrounded or crashed out of. It is
 * resolved as a DEATH settlement (casket banked, Rot Tithe honoured) before any
 * scene that reads the stash exists — otherwise killing the tab with a full bag
 * would be strictly better than extracting with it.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENES.boot);
  }

  create(): void {
    buildTextures(this);
    settleAbandonedRun();
    this.scene.start(SCENES.preload);
  }
}
