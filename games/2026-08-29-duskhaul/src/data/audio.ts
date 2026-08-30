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
 * THIS BUILD SHIPS SYNTH-ONLY, DELIBERATELY. No audio provider was available
 * for the `game-art` audio step, so `public/assets/audio/` does not exist and
 * both maps below are empty. That is the DESIGNED fallback, not a gap: every
 * §12 voice is synthesised, including the two the PRD authors specifically for
 * this game (`gate`, `collapse`, both in `core/audio.ts` VOICES), and
 * `core/music.ts` synthesises the score that `setMusicIntensity()` drives.
 * Dropping files under `public/assets/audio/` and adding a row here is the
 * whole switch — per entry, with no other code change anywhere.
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
  music: {
    // "Iron Chapel" — the run score. Registered as the LOW stem with no
    // `game-high` sibling, so per this module's contract its level simply
    // tracks `setMusicIntensity()` instead of crossfading against a second
    // stem: it swells as the horde thickens and the Collapse closes in.
    //
    // Source was a 179.6s 48kHz stereo master with a 0.49s silent head and a
    // 0.71s silent tail — a composed piece, NOT a loop. Looped raw it would
    // gap for ~1.2s every pass. Shipped form: silence trimmed, downmixed to
    // mono, and the outro fade overlapped onto the intro fade with a 4s
    // equal-power crossfade, so the wrap is continuous (measured -16.1 ->
    // -14.3 -> -16.2 dB across the seam, no dip and no click). 174.4s.
    'game-low': 'assets/audio/iron-chapel.ogg',
  },
  sfx: {},
};
