import type { SfxName } from '../core/audio';

/**
 * Generated-audio registry: the only place that knows audio file paths. Empty
 * in the template — `core/audio.ts` synthesises every sfx and `core/music.ts`
 * synthesises the score, so a game with no audio files still sounds finished.
 *
 * The `game-art` skill's audio-identity step fills this in: it briefs mood,
 * tempo and instrumentation off `art/style.json`, generates the tracks
 * (`generate_music`) and samples (`generate_sfx`), writes them under
 * `public/assets/audio/`, and registers them here. Adding a row is the ONLY
 * switch — `initGeneratedAudio()` picks up the samples and `startMusic()`
 * plays the loops instead of the synth, per entry: a registry with only
 * `music.menu` still uses synth sfx.
 *
 * Rules:
 * - Paths are relative to `public/` (`assets/audio/...`), like `data/art.ts`.
 * - Ship `.mp3` (universal) or `.ogg`; one file per entry, no fallback lists.
 * - Total budget <= 6 MB — `scripts/release-check.mjs` warns above it. Music
 *   loops are the weight: 30-60s at ~96 kbps mono, seamless.
 * - A missing or unplayable file degrades to the synth voice/score with one
 *   console warning; it never breaks the game.
 *
 * Pure data, no Phaser import.
 */

/**
 * Music stems. `menu` plays under the menu mood; the run mood crossfades
 * `game-low` into `game-high` as `setMusicIntensity()` rises. Register one
 * game stem and its level simply tracks intensity.
 */
export type MusicTrack = 'menu' | 'game-low' | 'game-high';

export const AUDIO: {
  music: Partial<Record<MusicTrack, string>>;
  sfx: Partial<Record<SfxName, string>>;
} = {
  music: {},
  sfx: {},
};
