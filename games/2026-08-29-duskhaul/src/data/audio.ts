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
    // Every mood is registered on purpose. `core/music.ts` synthesises a
    // procedural score for any mood with no usable stem, so a blank row does
    // not mean "silence", it means "a second, generated track". The two files
    // below are the only music in this game.
    //
    // Both were composed pieces, NOT loops: each arrived as a ~3min 48kHz
    // stereo master with a silent head and tail (Iron Chapel 0.49s/0.71s,
    // Ashen 0.64s/1.84s), so looping either raw would gap every pass. Shipped
    // form for both: silence trimmed, downmixed to mono, and the outro fade
    // overlapped onto the intro fade with a 4s equal-power crossfade, so the
    // wrap is continuous. Seams measured by concatenating each loop to itself
    // — no energy dip and no click (peaks hold ~-4dB across the join, where a
    // click would spike toward 0).
    //
    // Levels are matched so the menu -> run transition does not jump:
    // -16.30 LUFS vs -16.31 LUFS, both limited to <= -1.6 dBTP. Ashen needed
    // a normalisation pass for this (it arrived at -17.24 LUFS with a -0.58
    // dBTP peak, too hot to encode safely once matched).
    //
    // OGG rather than MP3 is load-bearing, not taste: each stem plays as a
    // looping AudioBufferSourceNode after decodeAudioData, and MP3 bakes
    // encoder delay and end-padding into the decoded buffer — reintroducing a
    // gap at exactly the seam the crossfade exists to remove.
    //
    // The synth engine stays in the build as the FAILURE path only: if a file
    // 404s or fails to decode, that mood falls back to it with one console
    // warning rather than going silent. It is unreachable on a healthy build.
    menu: 'assets/audio/ashen-menu-hall.ogg',
    // No `game-high` sibling, so this stem's LEVEL rides setMusicIntensity()
    // instead of crossfading: it swells as the horde thickens.
    'game-low': 'assets/audio/iron-chapel.ogg',
  },
  sfx: {},
};
