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
 * - Ship `.ogg` (Vorbis) for MUSIC. Each stem plays as a looping
 *   `AudioBufferSourceNode` after `decodeAudioData`, and MP3 bakes encoder
 *   delay and end-padding into the decoded buffer, so an MP3 loop gaps
 *   audibly every pass. Vorbis stores exact sample counts and loops
 *   sample-accurate. `.mp3` is fine for one-shot sfx, where the padding is
 *   inaudible. One file per entry, no fallback lists.
 * - Total download budget <= 6 MB — `scripts/release-check.mjs` warns above
 *   it. ~96 kbps mono is the target; a 3-minute stem lands near 1.6 MB.
 * - The tighter limit is RAM, not download: a stem decodes to raw f32 at the
 *   AudioContext rate whatever it compressed to, so ~33 MB per 3 minutes.
 *   The cache is keyed by URL, so one file registered against several moods
 *   costs one buffer — but two different 3-minute tracks cost ~66 MB. Prefer
 *   30-60s loops when the music can carry the repetition; reach for a full
 *   composed track only when it earns the memory.
 * - Author the LOOP, not the track. A composed piece typically arrives with a
 *   silent head and tail and will gap every pass: trim the silence, then
 *   overlap the outro fade onto the intro fade with a short equal-power
 *   crossfade. Verify by concatenating the loop to itself and measuring
 *   across the wrap — no energy dip, and no peak spike toward 0 (a click).
 * - Match levels across stems or a mood change jumps: same integrated LUFS,
 *   and leave >= 1 dB true-peak headroom so lossy encoding cannot overshoot.
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
