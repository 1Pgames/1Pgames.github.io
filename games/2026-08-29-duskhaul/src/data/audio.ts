import type { SfxName } from '../core/audio';
import type { WeaponId } from './types-v2';

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
 * SFX: every `core/audio.ts` voice except the unused `jump` ships as an
 * ElevenLabs text-to-sound-effects sample (prompts, durations and the raw MP3s
 * in `art/briefs/sfx-elevenlabs/`). Shipped form: lead trimmed at the first
 * sample above −50 dBFS minus 5 ms, trailing silence trimmed with a 20 ms
 * fade-out, mono 44.1 kHz OGG Vorbis q3. Each file is level-matched to its
 * synth voice's max momentary loudness (EBU R128 M) so the measured mix
 * (combat SFX ≈ −20.5 LUFS, music ≈ 0.5× of it) is unchanged; the files
 * that hit the −1 dBTP cap (`die`, `nova`, `levelup`) carry the remainder as `sampleGain` in VOICES.
 * Polyphony, jitter, vary, the xp rising chain and music ducking all apply
 * to samples (rate → playbackRate, volume → gain). The synth voices stay as
 * the FAILURE path: a sample that 404s or fails to decode keeps its synth
 * voice with one console warning.
 *
 * Music: the two stems below; `core/music.ts` synthesises the score only for
 * a mood with no usable stem.
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
  sfx: {
    ui: 'assets/audio/sfx/ui.ogg',
    tap: 'assets/audio/sfx/tap.ogg',
    pickup: 'assets/audio/sfx/pickup.ogg',
    combo: 'assets/audio/sfx/combo.ogg',
    hit: 'assets/audio/sfx/hit.ogg',
    die: 'assets/audio/sfx/die.ogg',
    // Option G (war drum + rising wind), picked by the user over the choir swell and candidates A-C.
    levelup: 'assets/audio/sfx/levelup.ogg',
    whoosh: 'assets/audio/sfx/whoosh.ogg',
    gate: 'assets/audio/sfx/gate.ogg',
    collapse: 'assets/audio/sfx/collapse.ogg',
    shoot: 'assets/audio/sfx/shoot.ogg',
    slash: 'assets/audio/sfx/slash.ogg',
    disc: 'assets/audio/sfx/disc.ogg',
    nova: 'assets/audio/sfx/nova.ogg',
    beam: 'assets/audio/sfx/beam.ogg',
    chain: 'assets/audio/sfx/chain.ogg',
    pool: 'assets/audio/sfx/pool.ogg',
    summon: 'assets/audio/sfx/summon.ogg',
    lob: 'assets/audio/sfx/lob.ogg',
    crunch: 'assets/audio/sfx/crunch.ogg',
    slain: 'assets/audio/sfx/slain.ogg',
    hurt: 'assets/audio/sfx/hurt.ogg',
    heartbeat: 'assets/audio/sfx/heartbeat.ogg',
    xp: 'assets/audio/sfx/xp.ogg',
    coin: 'assets/audio/sfx/coin.ogg',
    smash: 'assets/audio/sfx/smash.ogg',
    chest: 'assets/audio/sfx/chest.ogg',
    choir: 'assets/audio/sfx/choir.ogg',
    extract: 'assets/audio/sfx/extract.ogg',
  },
};

/**
 * Fire voice per weapon, by pattern class (PRD-V2 §5.8 "Pattern" column):
 * projectile `shoot`, blade `slash`, disc `disc`, burst `nova`, beam `beam`,
 * chain `chain`, trail/pool `pool`, summon `summon`, mine/explosion `lob`.
 * `WeaponSystem.update` plays it once per volley. Orbit, Grave Wake and
 * Siphon never "fire" (continuous), so theirs sound only through hits.
 */
export const WEAPON_VOICE: Readonly<Record<WeaponId, SfxName>> = {
  bolt: 'shoot',
  skull: 'shoot',
  orbit: 'slash',
  scythe: 'slash',
  sickle: 'slash',
  lash: 'slash',
  chakram: 'disc',
  nova: 'nova',
  aura: 'nova',
  totem: 'nova',
  rail: 'beam',
  breath: 'beam',
  hex: 'chain',
  censer: 'pool',
  wake: 'pool',
  siphon: 'pool',
  thralls: 'summon',
  bombs: 'lob',
  snares: 'lob',
  spears: 'lob',
};

/** Weapon volleys sit under hits and deaths: they are the most frequent voice. */
export const WEAPON_VOICE_OPTS = { volume: 0.6 } as const;
