import Phaser from 'phaser';
import { PALETTE, TEXT, VIEW } from '../config';
import { initGeneratedAudio } from '../core/audio';
import { bakeDeclaredOutlines } from '../core/outline';
import { SCENES } from '../core/keys';
import { IMAGES, SPRITES } from '../data/art';
import { ART_GROUPS } from './game';

/**
 * The active slice's art groups, widened so a registry row's `group` (a plain
 * string) can be tested against it. A handful of entries, scanned once at
 * preload — no lookup structure worth building.
 */
const LOADED_GROUPS: readonly string[] = ART_GROUPS;

/**
 * Loads the generated art set (see `src/data/art.ts`) and registers one
 * animation per animated sheet on the global animation manager, so every scene
 * can `play()` them afterwards.
 *
 * Only rows whose `group` is in the active slice's `ART_GROUPS` are loaded: a
 * game downloads the art its gameplay uses and nothing else. Rows from a
 * pruned group are absent from the registry entirely (see
 * `scripts/gen-art-registry.mjs`), so this filter only matters while the full
 * template asset set is still on disk.
 *
 * Add assets by adding a row to `art/manifest.json` + regenerating — never by
 * hand-coding a `load` call here.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super(SCENES.preload);
  }

  preload(): void {
    const barWidth = 420;
    const x = VIEW.centerX - barWidth / 2;
    const y = VIEW.centerY;

    this.add.text(VIEW.centerX, y - 70, 'LOADING', TEXT.label).setOrigin(0.5);

    const track = this.add.graphics();
    track.fillStyle(PALETTE.bgTop, 1);
    track.fillRoundedRect(x, y, barWidth, 16, 8);

    const fill = this.add.graphics();
    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      fill.clear();
      fill.fillStyle(PALETTE.primary, 1);
      fill.fillRoundedRect(x, y, Math.max(16, barWidth * value), 16, 8);
    });

    for (const asset of SPRITES) {
      if (!LOADED_GROUPS.includes(asset.group)) continue;
      this.load.spritesheet(asset.key, asset.path, {
        frameWidth: asset.frameWidth,
        frameHeight: asset.frameHeight,
      });
    }
    for (const asset of IMAGES) {
      if (!LOADED_GROUPS.includes(asset.group)) continue;
      this.load.image(asset.key, asset.path);
    }
  }

  create(): void {
    for (const asset of SPRITES) {
      if (!LOADED_GROUPS.includes(asset.group)) continue;
      if (asset.duration <= 0 || asset.frames < 2 || this.anims.exists(asset.key)) continue;
      // A sheet whose download failed has no texture: registering its key would
      // make an anim with ZERO frames that `anims.exists` still reports, and
      // playing it throws inside Phaser (`reading 'duration'`). Leave it
      // unregistered so every guard sees "no anim" and falls back to static art.
      if (!this.textures.exists(asset.key)) {
        console.warn(`[preload] sheet "${asset.key}" did not load; its animation is skipped`);
        continue;
      }
      this.anims.create({
        key: asset.key,
        frames: this.anims.generateFrameNumbers(asset.key, { start: 0, end: asset.frames - 1 }),
        frameRate: 1000 / asset.duration,
        repeat: asset.loop ? -1 : 0,
      });
    }

    // Team outlines a slice declared (`core/outline.ts declareOutlines`) bake
    // once here, after their base sheets and animations exist (colony: every
    // fauna sheet in the §1c fauna outline colour).
    bakeDeclaredOutlines(this);

    // Registered audio samples (none in the template) start downloading here and
    // decode into the shared context; every unregistered voice stays synthesised.
    initGeneratedAudio();

    // The Hub routes (§14b HubEntry): pending checkpoint → results, first boot → Landing, else LAND.
    this.scene.start(SCENES.hub, {});
  }
}
