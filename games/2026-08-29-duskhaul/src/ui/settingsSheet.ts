/**
 * Settings sheet (PRD-V2 §14.2 Hub cog; §14.15 pause SETTINGS): Music + SFX
 * sliders, Sound, Vibration, Reduce motion, and — only where the caller
 * passes `onReset` (the Hub) — Reset save behind a confirm.
 *
 * Scene-agnostic: it depends on nothing but `ui/sheet.ts`, so the run's
 * pause overlay opens the exact same sheet. Every change is persisted to
 * `STORE.settings` and applied to the audio that is playing NOW: sliders
 * write + apply on every drag step (music via `core/music.ts
 * applyMusicVolume`, SFX via `core/audio.ts applyAudioSettings`), so the
 * level is heard while dragging and survives every scene change (both
 * buses re-read the stored value whenever they start).
 */
import Phaser from 'phaser';
import { CSS, PALETTE } from '../config';
import { applyAudioSettings, audioSettings, isMuted, sfx, toggleMute, type AudioSettings } from '../core/audio';
import { STORE } from '../core/keys';
import { applyMusicVolume } from '../core/music';
import { resetMeta } from '../core/progression';
import { save } from '../core/storage';
import { Button } from './button';
import { BUTTON_STYLE } from './duskChrome';
import { confirmDialog, openSheet, type HubSheet } from './sheet';
import { label, panelAt, tapZone } from './widgets';

export interface SettingsSheetOptions {
  /** Renders RESET SAVE; called after the save is wiped (the Hub re-lands on EXPEDITION). */
  onReset?(): void;
  onClose?(): void;
}

export interface SettingsSheetHandle {
  close(): void;
  readonly closed: boolean;
}

/** Persists the settings and applies both audio buses to whatever is playing. */
function commit(next: AudioSettings): void {
  save(STORE.settings, next);
  applyAudioSettings();
  applyMusicVolume();
}

export function openSettingsSheet(scene: Phaser.Scene, opts: SettingsSheetOptions = {}): SettingsSheetHandle {
  const withReset = opts.onReset !== undefined;
  const sheet: HubSheet = openSheet(scene, { height: withReset ? 800 : 700, onClose: () => opts.onClose?.() });
  const build = (): void => {
    sheet.content.removeAll(true);
    sheet.content.add(label(scene, 40, 40, 'SETTINGS', { size: 30, bold: true }));
    const s = audioSettings();
    slider(scene, sheet.content, 130, 'Music', s.music, (v) => commit({ ...audioSettings(), music: v }));
    slider(scene, sheet.content, 250, 'SFX', s.sfx, (v) => commit({ ...audioSettings(), sfx: v }));
    toggleRow(scene, sheet.content, 370, 'Sound', !isMuted(), () => {
      toggleMute();
      build();
    });
    toggleRow(scene, sheet.content, 470, 'Vibration', s.vibration, () => {
      commit({ ...audioSettings(), vibration: !audioSettings().vibration });
      build();
    });
    toggleRow(scene, sheet.content, 570, 'Reduce motion', s.reduceMotion, () => {
      commit({ ...audioSettings(), reduceMotion: !audioSettings().reduceMotion });
      build();
    });
    if (opts.onReset === undefined) return;
    const onReset = opts.onReset;
    sheet.content.add(
      new Button(
        scene,
        360,
        710,
        'RESET SAVE',
        () =>
          confirmDialog(scene, {
            title: 'Reset save?',
            body: 'Every shard, item, level and unlock is erased. This cannot be undone.',
            confirmLabel: 'RESET',
            destructive: true,
            onConfirm: () => {
              resetMeta();
              sheet.close();
              onReset();
            },
          }),
        { width: 640, height: 88, fontSize: '28px', ...BUTTON_STYLE.destructive },
      ),
    );
  };
  build();
  return sheet;
}

function toggleRow(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, y: number, name: string, on: boolean, onTap: () => void): void {
  const row = tapZone(scene, 40, y, 640, 88, onTap);
  row.add(panelAt(scene, 0, 0, 640, 88));
  row.add(label(scene, 24, 44, name, { size: 26, bold: true, origin: [0, 0.5] }));
  const g = scene.add.graphics();
  g.fillStyle(on ? PALETTE.primary : 0x303e41, 1);
  g.fillRoundedRect(520, 24, 96, 40, 20);
  g.fillStyle(PALETTE.ink, 1);
  g.fillCircle(on ? 596 : 540, 44, 16);
  row.add(g);
  parent.add(row);
}

/**
 * Horizontal 0..1 slider; the track is the drag target. `onChange` fires on
 * EVERY step (live), and once more on release with the ack sound.
 */
function slider(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, y: number, name: string, value: number, onChange: (v: number) => void): void {
  const row = scene.add.container(40, y);
  row.add(panelAt(scene, 0, 0, 640, 88));
  row.add(label(scene, 24, 44, name, { size: 26, bold: true, origin: [0, 0.5] }));
  const trackX = 210;
  const trackW = 390;
  const g = scene.add.graphics();
  const pctText = label(scene, 180, 44, '', { size: 18, bold: true, color: CSS.inkSoft, origin: [1, 0.5] });
  let v = Phaser.Math.Clamp(value, 0, 1);
  const paint = (): void => {
    g.clear();
    g.fillStyle(0x303e41, 1);
    g.fillRoundedRect(trackX, 40, trackW, 8, 4);
    g.fillStyle(PALETTE.primary, 1);
    g.fillRoundedRect(trackX, 40, Math.max(8, trackW * v), 8, 4);
    g.fillStyle(PALETTE.ink, 1);
    g.fillCircle(trackX + trackW * v, 44, 18);
    pctText.setText(`${Math.round(v * 100)}%`);
  };
  paint();
  row.add([g, pctText]);
  const hit = scene.add.zone(trackX - 20, 0, trackW + 40, 88).setOrigin(0, 0).setInteractive({ useHandCursor: true });
  row.add(hit);
  let dragging = false;
  const setFrom = (p: Phaser.Input.Pointer): void => {
    // Pointer x is in design px and the sheet is full-width at x 0, so the
    // row's own x (40) is the only offset.
    const next = Phaser.Math.Clamp((p.x - 40 - trackX) / trackW, 0, 1);
    if (next === v) return;
    v = next;
    paint();
    onChange(v);
  };
  hit.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
    dragging = true;
    setFrom(p);
  });
  const onMove = (p: Phaser.Input.Pointer): void => {
    if (dragging && p.isDown) setFrom(p);
  };
  const onUp = (): void => {
    if (!dragging) return;
    dragging = false;
    onChange(v);
    sfx('ui');
  };
  scene.input.on(Phaser.Input.Events.POINTER_MOVE, onMove);
  scene.input.on(Phaser.Input.Events.POINTER_UP, onUp);
  row.once(Phaser.GameObjects.Events.DESTROY, () => {
    scene.input.off(Phaser.Input.Events.POINTER_MOVE, onMove);
    scene.input.off(Phaser.Input.Events.POINTER_UP, onUp);
  });
  parent.add(row);
}
