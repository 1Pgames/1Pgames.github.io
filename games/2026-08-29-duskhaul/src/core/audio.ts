import { load, save } from './storage';
import { STORE } from './keys';
import { AUDIO } from '../data/audio';

/**
 * Sound. Every voice has a WebAudio synth definition, so a generated game
 * with no audio files still has full game feel; Duskhaul registers an
 * ElevenLabs sample for every voice it uses (`src/data/audio.ts`), and the
 * synth is that sample's failure fallback.
 *
 * A game that DOES ship samples registers them in `src/data/audio.ts`:
 * `initGeneratedAudio()` (called once from `PreloadScene`) fetches and decodes
 * them into the same context, and `sfx()` plays the sample for a registered
 * name and the synth voice for every other one. A fetch/decode failure warns
 * once and stays on the synth voice.
 *
 * Usage:  sfx('pickup')  /  sfx('hit', { rate: 1.2 })  /  toggleMute()
 *
 * Graph: voice → per-instance gain → SFX bus (glue compressor, `SFX_MASTER`)
 * → Settings/mute gain → destination. Music (`core/music.ts`) connects to
 * `musicInput()`, a duck gain → destination, so big beats (`Voice.duck`) dip
 * the score −6 dB for 400 ms without touching its Settings level.
 *
 * Polyphony: every voice has a `poly` cap. A call over the cap STEALS the
 * oldest live instance of that voice (15 ms fade) instead of being dropped, so
 * `requested === played` whenever audio is live; spam RATE is gated at call
 * sites with `allowEffect` (core/juice.ts), which never reaches `sfx()`.
 *
 * T1 tooling (PRD-V2 §12): `?mute=1` / `?mute=true` on the URL forces
 * silence for the page — every sfx/music call is a no-op, no AudioContext is
 * ever created, and the persisted `muted` pref is never written.
 * `installAudioDebug()` exposes `window.__AUDIO__()` → `{ forcedByUrl,
 * requested, played, sfxBus, musicDuck, samplesDecoded, levels }` (`requested` = every sfx/sfxArp/
 * music-start call, `played` = calls that reached the Web Audio graph,
 * `sfxBus` = the live Settings×mute gain on the SFX bus, `levels` = momentary
 * RMS dBFS of both bus outputs, metered lazily on first read).
 */

type Wave = OscillatorType | 'noise';

/** One partial of a voice: an oscillator (or filtered noise) under its own envelope. */
interface Layer {
  wave: Wave;
  /** Start frequency in Hz (noise: filter centre when `filter` is omitted). */
  freq: number;
  /** Frequency at the end of the sweep; omit for a flat tone. */
  freqEnd?: number;
  /** Seconds. */
  attack: number;
  decay: number;
  gain: number;
  /** Seconds after the voice start. */
  delay?: number;
  /** Detuned second oscillator (cents) for thickness. */
  detune?: number;
  /** Filter on this layer; noise defaults to a bandpass at `freq`. */
  filter?: BiquadFilterType;
  cutoff?: number;
  cutoffEnd?: number;
  q?: number;
}

interface Voice {
  layers: readonly Layer[];
  /** Live instances before the oldest is stolen. */
  poly: number;
  /** ± random pitch fraction per call, so repeats never machine-gun. */
  jitter?: number;
  /** ± random volume fraction per call. */
  vary?: number;
  /** Big beat: ducks the music bus −6 dB for 400 ms. */
  duck?: boolean;
  /** Rising chain: each call within `resetMs` of the last climbs `step` semitones, up to `max`. */
  chain?: { step: number; max: number; resetMs: number };
  /**
   * Linear make-up gain for this voice's registered SAMPLE only. Samples are
   * level-matched to their synth voice in the file itself (max momentary
   * loudness); a file that could not take the full boost without passing
   * −1 dBTP carries the rest here.
   */
  sampleGain?: number;
}

/**
 * The palette is grimdark: low thuds, bone clicks, metallic scrapes, choir-ish
 * fifths for the reward beats. Gains are tuned against the music bus so a
 * combat stream sits ~6 dB over the score (measured, see the audio audit).
 */
const VOICES = {
  ui: {
    poly: 3,
    layers: [
      { wave: 'triangle', freq: 660, freqEnd: 880, attack: 0.002, decay: 0.07, gain: 0.32 },
      { wave: 'noise', freq: 4000, attack: 0.001, decay: 0.02, gain: 0.12, filter: 'highpass' },
    ],
  },
  tap: {
    poly: 3,
    jitter: 0.04,
    layers: [
      { wave: 'triangle', freq: 420, freqEnd: 620, attack: 0.002, decay: 0.09, gain: 0.38 },
      { wave: 'noise', freq: 2500, attack: 0.001, decay: 0.03, gain: 0.18, q: 2 },
    ],
  },
  /** Bone chime: item/loot/belt pickups. */
  pickup: {
    poly: 3,
    layers: [
      { wave: 'triangle', freq: 720, freqEnd: 1320, attack: 0.002, decay: 0.16, gain: 0.34, detune: 12 },
      { wave: 'sine', freq: 1760, attack: 0.002, decay: 0.22, gain: 0.12, delay: 0.04 },
    ],
  },
  combo: {
    poly: 3,
    layers: [{ wave: 'triangle', freq: 980, freqEnd: 1760, attack: 0.002, decay: 0.12, gain: 0.3 }],
  },
  jump: {
    poly: 2,
    layers: [{ wave: 'sawtooth', freq: 300, freqEnd: 720, attack: 0.002, decay: 0.16, gain: 0.22, filter: 'lowpass', cutoff: 2400 }],
  },
  /** Flesh thwack: an enemy takes a hit. */
  hit: {
    poly: 4,
    jitter: 0.12,
    vary: 0.15,
    layers: [
      { wave: 'noise', freq: 1800, attack: 0.001, decay: 0.09, gain: 0.6, filter: 'lowpass', cutoff: 2200, cutoffEnd: 400 },
      { wave: 'sine', freq: 180, freqEnd: 60, attack: 0.001, decay: 0.1, gain: 0.55 },
      { wave: 'triangle', freq: 900, freqEnd: 300, attack: 0.001, decay: 0.03, gain: 0.16 },
    ],
  },
  /** Low groan: hero death / elite spawn / failed run. */
  die: {
    poly: 2,
    sampleGain: 1.15,
    layers: [
      { wave: 'sawtooth', freq: 160, freqEnd: 40, attack: 0.01, decay: 0.85, gain: 0.34, filter: 'lowpass', cutoff: 700, cutoffEnd: 200 },
      { wave: 'noise', freq: 600, attack: 0.01, decay: 0.6, gain: 0.3, filter: 'lowpass', cutoff: 900, cutoffEnd: 120 },
      { wave: 'sine', freq: 90, freqEnd: 40, attack: 0.01, decay: 0.7, gain: 0.4 },
    ],
  },
  /** Choir-ish fifth + octave swell with a bright sweep on top: level-up, shrine, boss down. */
  levelup: {
    poly: 4,
    sampleGain: 1.06,
    duck: true,
    layers: [
      { wave: 'triangle', freq: 262, attack: 0.05, decay: 0.9, gain: 0.26, detune: 9, filter: 'lowpass', cutoff: 1800 },
      { wave: 'triangle', freq: 392, attack: 0.07, decay: 0.85, gain: 0.2, detune: -8, filter: 'lowpass', cutoff: 2000 },
      { wave: 'sine', freq: 523, attack: 0.09, decay: 0.8, gain: 0.18, detune: 6 },
      { wave: 'triangle', freq: 520, freqEnd: 1040, attack: 0.004, decay: 0.3, gain: 0.2 },
    ],
  },
  whoosh: {
    poly: 3,
    jitter: 0.06,
    layers: [
      { wave: 'noise', freq: 400, attack: 0.04, decay: 0.3, gain: 0.45, filter: 'bandpass', cutoff: 500, cutoffEnd: 1700, q: 1.2 },
      { wave: 'sine', freq: 180, freqEnd: 90, attack: 0.01, decay: 0.3, gain: 0.14 },
    ],
  },
  /**
   * PRD §12's two authored voices: a rising square fifth for a door opening,
   * and a 1.6 s noise-led sub falling 60→30 Hz for the Collapse igniting. The
   * first layer of each keeps the §12 table's parameters verbatim; the extra
   * layers only give them body on phone speakers.
   */
  gate: {
    poly: 2,
    layers: [
      { wave: 'square', freq: 110, freqEnd: 220, attack: 0.02, decay: 0.9, gain: 0.3, filter: 'lowpass', cutoff: 1800 },
      { wave: 'sine', freq: 220, freqEnd: 440, attack: 0.03, decay: 0.8, gain: 0.25 },
      { wave: 'noise', freq: 900, attack: 0.02, decay: 0.5, gain: 0.15, q: 1 },
    ],
  },
  collapse: {
    poly: 2,
    duck: true,
    layers: [
      { wave: 'sine', freq: 60, freqEnd: 30, attack: 0.1, decay: 1.6, gain: 0.8 },
      { wave: 'noise', freq: 180, attack: 0.1, decay: 1.6, gain: 0.55, filter: 'lowpass', cutoff: 600, cutoffEnd: 90 },
      { wave: 'sawtooth', freq: 120, freqEnd: 45, attack: 0.05, decay: 1.2, gain: 0.16, filter: 'lowpass', cutoff: 500 },
    ],
  },

  // ── weapon families (data/audio.ts WEAPON_VOICE) ──
  /** Projectile: bone click + airy snap (bolt, skull). */
  shoot: {
    poly: 3,
    jitter: 0.08,
    vary: 0.1,
    layers: [
      { wave: 'noise', freq: 3000, attack: 0.001, decay: 0.05, gain: 0.35, filter: 'highpass', cutoff: 2500 },
      { wave: 'triangle', freq: 700, freqEnd: 220, attack: 0.001, decay: 0.07, gain: 0.3 },
    ],
  },
  /** Blade: metallic scrape (scythe, lash, sickle). */
  slash: {
    poly: 3,
    jitter: 0.07,
    layers: [
      { wave: 'noise', freq: 2400, attack: 0.012, decay: 0.16, gain: 0.5, filter: 'bandpass', cutoff: 3200, cutoffEnd: 1100, q: 2.5 },
      { wave: 'sawtooth', freq: 1800, freqEnd: 900, attack: 0.01, decay: 0.12, gain: 0.06, detune: 17, filter: 'bandpass', cutoff: 2600, q: 6 },
    ],
  },
  /** Ricochet disc whirr (chakram). */
  disc: {
    poly: 2,
    jitter: 0.06,
    layers: [
      { wave: 'square', freq: 300, freqEnd: 520, attack: 0.005, decay: 0.18, gain: 0.14, detune: 30, filter: 'lowpass', cutoff: 1400 },
      { wave: 'noise', freq: 1500, attack: 0.005, decay: 0.12, gain: 0.25, q: 2 },
    ],
  },
  /** Burst: low thump + noise bloom (nova, aura pulse, totem pulse). */
  nova: {
    poly: 2,
    sampleGain: 1.45,
    jitter: 0.06,
    layers: [
      { wave: 'sine', freq: 120, freqEnd: 40, attack: 0.002, decay: 0.25, gain: 0.7 },
      { wave: 'noise', freq: 800, attack: 0.004, decay: 0.25, gain: 0.4, filter: 'lowpass', cutoff: 1400, cutoffEnd: 200 },
    ],
  },
  /** Beam: falling zap (rail, breath). */
  beam: {
    poly: 2,
    jitter: 0.05,
    layers: [
      { wave: 'sawtooth', freq: 1400, freqEnd: 200, attack: 0.003, decay: 0.22, gain: 0.2, detune: 12, filter: 'lowpass', cutoff: 3200 },
      { wave: 'noise', freq: 5000, attack: 0.002, decay: 0.12, gain: 0.22, filter: 'highpass', cutoff: 4000 },
    ],
  },
  /** Chain: crackle (hex). */
  chain: {
    poly: 2,
    jitter: 0.1,
    layers: [
      { wave: 'square', freq: 90, freqEnd: 70, attack: 0.002, decay: 0.14, gain: 0.3, filter: 'bandpass', cutoff: 2400, q: 1 },
      { wave: 'noise', freq: 3500, attack: 0.001, decay: 0.1, gain: 0.4, q: 2 },
    ],
  },
  /** Trail/pool: hiss (censer, wake, siphon). */
  pool: {
    poly: 2,
    jitter: 0.08,
    layers: [
      { wave: 'noise', freq: 700, attack: 0.03, decay: 0.35, gain: 0.35, filter: 'lowpass', cutoff: 900 },
      { wave: 'sine', freq: 220, freqEnd: 140, attack: 0.02, decay: 0.3, gain: 0.14 },
    ],
  },
  /** Summon: low moan (thralls). */
  summon: {
    poly: 2,
    jitter: 0.05,
    layers: [
      { wave: 'sawtooth', freq: 110, freqEnd: 82, attack: 0.05, decay: 0.6, gain: 0.3, detune: 9, filter: 'lowpass', cutoff: 500 },
      { wave: 'noise', freq: 300, attack: 0.05, decay: 0.5, gain: 0.2, q: 1.5 },
    ],
  },
  /** Mine/explosion: lob thud (bombs, snares, spears). */
  lob: {
    poly: 3,
    jitter: 0.08,
    layers: [
      { wave: 'sine', freq: 90, freqEnd: 45, attack: 0.002, decay: 0.22, gain: 0.75 },
      { wave: 'noise', freq: 500, attack: 0.002, decay: 0.16, gain: 0.45, filter: 'lowpass', cutoff: 700 },
      { wave: 'triangle', freq: 300, freqEnd: 120, attack: 0.001, decay: 0.05, gain: 0.2 },
    ],
  },

  // ── combat & loot events ──
  /** Trash death: bone crunch. */
  crunch: {
    poly: 4,
    jitter: 0.18,
    vary: 0.15,
    layers: [
      { wave: 'noise', freq: 1200, attack: 0.001, decay: 0.14, gain: 0.55, filter: 'bandpass', cutoff: 1300, cutoffEnd: 500, q: 1.5 },
      { wave: 'square', freq: 140, freqEnd: 55, attack: 0.001, decay: 0.12, gain: 0.18, filter: 'lowpass', cutoff: 800 },
      { wave: 'noise', freq: 6000, attack: 0.001, decay: 0.03, gain: 0.2, filter: 'highpass', cutoff: 5000 },
    ],
  },
  /** Elite / mid-boss / boss falls: heavy crash. */
  slain: {
    poly: 2,
    duck: true,
    jitter: 0.04,
    layers: [
      { wave: 'sine', freq: 70, freqEnd: 28, attack: 0.004, decay: 0.8, gain: 0.9 },
      { wave: 'noise', freq: 700, attack: 0.003, decay: 0.7, gain: 0.6, filter: 'lowpass', cutoff: 1200, cutoffEnd: 120 },
      { wave: 'sawtooth', freq: 220, freqEnd: 55, attack: 0.004, decay: 0.6, gain: 0.2, filter: 'lowpass', cutoff: 700 },
    ],
  },
  /** Hero takes a blow: thud + grunt. */
  hurt: {
    poly: 2,
    jitter: 0.08,
    layers: [
      { wave: 'sine', freq: 150, freqEnd: 70, attack: 0.002, decay: 0.16, gain: 0.7 },
      { wave: 'noise', freq: 600, attack: 0.002, decay: 0.12, gain: 0.35, filter: 'lowpass', cutoff: 900 },
      { wave: 'sawtooth', freq: 240, freqEnd: 160, attack: 0.004, decay: 0.12, gain: 0.12, filter: 'lowpass', cutoff: 900 },
    ],
  },
  /** §13.2 low-HP heartbeat (lub-dub). */
  heartbeat: {
    poly: 1,
    layers: [
      { wave: 'sine', freq: 62, freqEnd: 45, attack: 0.004, decay: 0.12, gain: 0.8 },
      { wave: 'sine', freq: 58, freqEnd: 42, attack: 0.004, decay: 0.14, gain: 0.55, delay: 0.18 },
    ],
  },
  /** XP orb: glassy tick climbing a semitone per orb in a streak. */
  xp: {
    poly: 3,
    chain: { step: 1, max: 12, resetMs: 450 },
    layers: [
      { wave: 'triangle', freq: 1200, freqEnd: 1500, attack: 0.001, decay: 0.06, gain: 0.24 },
      { wave: 'sine', freq: 2400, attack: 0.001, decay: 0.04, gain: 0.08 },
    ],
  },
  /** Shard coin: metallic clink. */
  coin: {
    poly: 3,
    jitter: 0.05,
    layers: [
      { wave: 'square', freq: 1900, attack: 0.001, decay: 0.12, gain: 0.18, filter: 'bandpass', cutoff: 3800, q: 6 },
      { wave: 'triangle', freq: 2850, attack: 0.001, decay: 0.2, gain: 0.16, detune: 7 },
    ],
  },
  /** Breakable smash: wood/bone crash. */
  smash: {
    poly: 3,
    jitter: 0.1,
    layers: [
      { wave: 'noise', freq: 800, attack: 0.001, decay: 0.2, gain: 0.55, q: 0.8 },
      { wave: 'triangle', freq: 220, freqEnd: 80, attack: 0.001, decay: 0.1, gain: 0.3 },
      { wave: 'noise', freq: 4000, attack: 0.001, decay: 0.05, gain: 0.2, filter: 'highpass', cutoff: 3000 },
    ],
  },
  /** Chest/vault opens: lid creak + three rising chimes. */
  chest: {
    poly: 2,
    layers: [
      { wave: 'sawtooth', freq: 90, freqEnd: 140, attack: 0.02, decay: 0.25, gain: 0.2, filter: 'lowpass', cutoff: 600 },
      { wave: 'triangle', freq: 660, attack: 0.002, decay: 0.3, gain: 0.2, delay: 0.12 },
      { wave: 'triangle', freq: 990, attack: 0.002, decay: 0.3, gain: 0.18, delay: 0.18 },
      { wave: 'triangle', freq: 1320, attack: 0.002, decay: 0.4, gain: 0.16, delay: 0.24 },
    ],
  },
  /** Evolution: rising choir swell (fifth + octave, slow attack). */
  choir: {
    poly: 1,
    duck: true,
    layers: [
      { wave: 'triangle', freq: 196, freqEnd: 262, attack: 0.25, decay: 1.3, gain: 0.26, detune: 10, filter: 'lowpass', cutoff: 1600 },
      { wave: 'triangle', freq: 294, freqEnd: 392, attack: 0.3, decay: 1.25, gain: 0.2, detune: -9, filter: 'lowpass', cutoff: 1800 },
      { wave: 'sine', freq: 392, freqEnd: 523, attack: 0.35, decay: 1.2, gain: 0.16, detune: 6 },
      { wave: 'noise', freq: 1200, attack: 0.3, decay: 1.0, gain: 0.08, q: 0.7 },
    ],
  },
  /** Extraction: the gate fifth resolving into the choir. */
  extract: {
    poly: 1,
    duck: true,
    layers: [
      { wave: 'square', freq: 110, freqEnd: 220, attack: 0.02, decay: 0.9, gain: 0.22, filter: 'lowpass', cutoff: 1400 },
      { wave: 'triangle', freq: 330, attack: 0.08, decay: 1.2, gain: 0.24, detune: 9, delay: 0.2 },
      { wave: 'triangle', freq: 440, attack: 0.08, decay: 1.2, gain: 0.2, detune: -9, delay: 0.26 },
      { wave: 'sine', freq: 660, attack: 0.1, decay: 1.2, gain: 0.16, delay: 0.32 },
    ],
  },
} as const satisfies Record<string, Voice>;

export type SfxName = keyof typeof VOICES;

interface PlayOptions {
  /** Pitch multiplier — cheap variation, e.g. rising combo pitch. */
  rate?: number;
  /** Volume multiplier on top of the preset gain. */
  volume?: number;
  /** Seconds of delay before the voice starts. */
  delay?: number;
}

let ctx: AudioContext | null = null;
/** Settings × mute gain at the end of the SFX bus. */
let master: GainNode | null = null;
/** Voices connect here (glue compressor → `SFX_MASTER` → `master`). */
let sfxIn: AudioNode | null = null;
/** Music bus duck gain → destination (`musicInput()`). */
let musicDuck: GainNode | null = null;
let muted = load<boolean>(STORE.muted, false);
type MuteListener = (muted: boolean) => void;
const muteListeners = new Set<MuteListener>();

/** Decoded generated samples; a name in here plays instead of its synth voice. */
const samples = new Map<SfxName, AudioBuffer>();
/** Fetched bytes waiting for a context — `initGeneratedAudio()` runs before the first gesture. */
const fetched = new Map<SfxName, ArrayBuffer>();
let samplesRequested = false;

/** `?mute=1` / `?mute=true`, read ONCE at module init. Never persisted. */
const forcedByUrl = ((): boolean => {
  try {
    if (typeof location === 'undefined') return false;
    const value = new URLSearchParams(location.search).get('mute');
    return value === '1' || value === 'true';
  } catch {
    return false;
  }
})();
let requested = 0;
let played = 0;

export interface AudioSettings { music: number; sfx: number; vibration: boolean; reduceMotion: boolean }
const DEFAULT_SETTINGS: AudioSettings = { music: 1, sfx: 1, vibration: true, reduceMotion: false };

/** The Settings sheet's stored values (`STORE.settings`), defaulted field by field. */
export function audioSettings(): AudioSettings {
  const raw = load<Partial<AudioSettings> | null>(STORE.settings, null);
  const clamp01 = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);
  return {
    music: clamp01(raw?.music, DEFAULT_SETTINGS.music),
    sfx: clamp01(raw?.sfx, DEFAULT_SETTINGS.sfx),
    vibration: typeof raw?.vibration === 'boolean' ? raw.vibration : DEFAULT_SETTINGS.vibration,
    reduceMotion: typeof raw?.reduceMotion === 'boolean' ? raw.reduceMotion : DEFAULT_SETTINGS.reduceMotion,
  };
}

/** SFX bus level from Settings (0..1), applied on the shared master gain. */
let sfxLevel = audioSettings().sfx;
/** Post-compressor SFX make-up gain (the bus's level at Settings 1). */
const SFX_MASTER = 1;
/** Music duck: depth (−6 dB) and hold. */
const DUCK = { level: 0.5, holdS: 0.4, attackTc: 0.03, releaseTc: 0.12 } as const;

/** Re-reads `STORE.settings` and applies the SFX level (music bus: `core/music.ts`). No-op while forced silent by URL. */
export function applyAudioSettings(): void {
  if (forcedByUrl) return;
  sfxLevel = audioSettings().sfx;
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : sfxLevel, ctx.currentTime, 0.02);
}

/** Counts one audio request for `__AUDIO__` (`reached` = it hit the Web Audio graph). Used by `core/music.ts startMusic`. */
export function noteAudioRequest(reached: boolean): void {
  requested += 1;
  if (reached) played += 1;
}

/** Installs `window.__AUDIO__()` (called from `src/main.ts` before `new Phaser.Game`). */
export function installAudioDebug(): void {
  if (typeof window === 'undefined') return;
  Reflect.set(window, '__AUDIO__', () => ({
    forcedByUrl,
    requested,
    played,
    sfxBus: master?.gain.value ?? null,
    musicDuck: musicDuck?.gain.value ?? null,
    samplesDecoded: samples.size,
    levels: busLevels(),
  }));
}

/** Debug meters on the two bus outputs, created on first read so normal play never pays for them. */
let meters: { sfx: AnalyserNode; music: AnalyserNode; buf: Float32Array<ArrayBuffer> } | null = null;

/** Momentary RMS (dBFS, 2048 samples) of the SFX bus after Settings/mute and of the music bus after the duck. */
function busLevels(): { sfxDb: number; musicDb: number } | null {
  if (!ctx || !master || !musicDuck) return null;
  if (meters === null) {
    const sfxMeter = ctx.createAnalyser();
    const musicMeter = ctx.createAnalyser();
    sfxMeter.fftSize = 2048;
    musicMeter.fftSize = 2048;
    master.connect(sfxMeter);
    musicDuck.connect(musicMeter);
    meters = { sfx: sfxMeter, music: musicMeter, buf: new Float32Array(2048) };
  }
  const db = (a: AnalyserNode): number => {
    a.getFloatTimeDomainData(meters!.buf);
    let sum = 0;
    for (const v of meters!.buf) sum += v * v;
    return 10 * Math.log10(sum / meters!.buf.length + 1e-12);
  };
  return { sfxDb: db(meters.sfx), musicDb: db(meters.music) };
}

/**
 * The SFX bus: voices → glue compressor
 * (catches stacked kills without pumping the score) → make-up gain. Returns
 * the input to connect voices to and the output to route onward.
 */
function sfxBus(target: BaseAudioContext): { input: AudioNode; output: AudioNode } {
  const comp = target.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 6;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  const makeup = target.createGain();
  makeup.gain.value = SFX_MASTER;
  comp.connect(makeup);
  return { input: comp, output: makeup };
}

/** Browsers require a user gesture; call once from a pointer/key handler. Forced-silent pages never create a context. */
export function unlockAudio(): void {
  if (forcedByUrl) return;
  if (!ctx) {
    if (typeof window.AudioContext !== 'function') return;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : sfxLevel;
    master.connect(ctx.destination);
    const bus = sfxBus(ctx);
    bus.output.connect(master);
    sfxIn = bus.input;
    musicDuck = ctx.createGain();
    musicDuck.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  void decodeFetched();
}

/** Decode everything fetched so far; a no-op until a context exists. */
async function decodeFetched(): Promise<void> {
  if (!ctx || fetched.size === 0) return;
  const target = ctx;
  for (const [name, bytes] of [...fetched]) {
    // Delete first: decodeAudioData detaches the buffer, so it is single-use.
    fetched.delete(name);
    try {
      samples.set(name, await target.decodeAudioData(bytes));
    } catch (err) {
      console.warn(`audio: sample "${name}" failed to decode, using the synth voice`, err);
    }
  }
}

/**
 * Load the samples registered in `src/data/audio.ts` (empty in the template —
 * then this is a no-op and every voice stays synthesised). Call once from
 * `PreloadScene.create()`: fetching starts immediately and each sample is
 * decoded into the shared context as soon as `unlockAudio()` has created it,
 * so nothing here needs a user gesture. Unreachable or undecodable files warn
 * once and leave that voice on the synth.
 */
export function initGeneratedAudio(): void {
  if (samplesRequested) return;
  samplesRequested = true;
  for (const [name, url] of Object.entries(AUDIO.sfx) as [SfxName, string][]) {
    if (!url) continue;
    void fetch(url)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((bytes) => {
        fetched.set(name, bytes);
        return decodeFetched();
      })
      .catch((err) => {
        console.warn(`audio: sample "${name}" (${url}) unavailable, using the synth voice`, err);
      });
  }
}

/**
 * Shared AudioContext accessor for other synthesised-audio modules (e.g.
 * `core/music.ts`). Returns `null` until `unlockAudio()` has created it —
 * callers should invoke `unlockAudio()` first if they need one guaranteed.
 */
export function getAudioContext(): AudioContext | null {
  return ctx;
}

/** Where the music bus connects (the duck gain); null until `unlockAudio()` created the context. */
export function musicInput(): AudioNode | null {
  return musicDuck;
}

/** Dips the music bus −6 dB for `holdS`, then recovers — big beats cut through the score. */
function duckMusic(holdS: number = DUCK.holdS): void {
  if (!ctx || !musicDuck) return;
  const g = musicDuck.gain;
  const now = ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setTargetAtTime(DUCK.level, now, DUCK.attackTc);
  g.setTargetAtTime(1, now + holdS, DUCK.releaseTc);
}

/**
 * Subscribe to mute toggles so other audio buses (music) can silence
 * themselves in lockstep with sfx. Returns an unsubscribe function.
 */
export function onMuteChange(listener: MuteListener): () => void {
  muteListeners.add(listener);
  return () => muteListeners.delete(listener);
}

/** True when silenced by the player's pref OR forced by `?mute=1`. */
export function isMuted(): boolean {
  return muted || forcedByUrl;
}

/** Flips the persisted pref. Forced-silent pages stay silent and never write the pref. */
export function toggleMute(): boolean {
  if (forcedByUrl) return true;
  muted = !muted;
  save(STORE.muted, muted);
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : sfxLevel, ctx.currentTime, 0.02);
  muteListeners.forEach((listener) => listener(muted));
  return muted;
}

// ─────────────────────────── voices ───────────────────────────

/** 0.4 s of white noise per context, shared by every noise layer. */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseFor(target: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(target);
  if (buf !== undefined) return buf;
  const frames = Math.floor(target.sampleRate * 0.4);
  buf = target.createBuffer(1, frames, target.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
  noiseBuffers.set(target, buf);
  return buf;
}

/** Live instances per voice (oldest first) for polyphony stealing. */
interface Instance { gain: GainNode; end: number }
const live = new Map<SfxName, Instance[]>();
/** Rising-chain state per voice: current step and the time of the last call. */
const chains = new Map<SfxName, { step: number; at: number }>();
/** Steal fade (s): long enough not to click, short enough to free the slot now. */
const STEAL_TC = 0.005;

/**
 * Schedules one voice into `dest` on `target` and returns its instance gain
 * and end time. Pure graph construction; the live path (`sfx`) adds
 * polyphony and ducking on top.
 */
function synthVoice(target: BaseAudioContext, dest: AudioNode, name: SfxName, options: PlayOptions = {}): Instance {
  const voice: Voice = VOICES[name];
  const rate = options.rate ?? 1;
  const vol = options.volume ?? 1;
  const t0 = target.currentTime + (options.delay ?? 0);
  const out = target.createGain();
  out.gain.value = vol;
  out.connect(dest);
  let end = t0;
  for (const layer of voice.layers) {
    const start = t0 + (layer.delay ?? 0);
    const stop = start + layer.attack + layer.decay;
    end = Math.max(end, stop);
    const env = target.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(layer.gain, start + layer.attack);
    env.gain.exponentialRampToValueAtTime(0.0001, stop);
    let head: AudioNode = env;
    const filterType = layer.filter ?? (layer.wave === 'noise' ? 'bandpass' : undefined);
    if (filterType !== undefined) {
      const f = target.createBiquadFilter();
      f.type = filterType;
      const cutoff = (layer.cutoff ?? layer.freq) * rate;
      f.frequency.setValueAtTime(cutoff, start);
      if (layer.cutoffEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(40, layer.cutoffEnd * rate), stop);
      if (layer.q !== undefined) f.Q.value = layer.q;
      f.connect(env);
      head = f;
    }
    env.connect(out);
    if (layer.wave === 'noise') {
      const src = target.createBufferSource();
      src.buffer = noiseFor(target);
      src.loop = true;
      src.connect(head);
      src.start(start, Math.random() * 0.3);
      src.stop(stop + 0.02);
      continue;
    }
    const osc = (detune: number): void => {
      const o = target.createOscillator();
      o.type = layer.wave as OscillatorType;
      o.detune.value = detune;
      o.frequency.setValueAtTime(layer.freq * rate, start);
      if (layer.freqEnd !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, layer.freqEnd * rate), stop);
      o.connect(head);
      o.start(start);
      o.stop(stop + 0.02);
    };
    osc(0);
    if (layer.detune !== undefined) osc(layer.detune);
  }
  return { gain: out, end };
}

export function sfx(name: SfxName, options: PlayOptions = {}): void {
  requested += 1;
  if (playVoice(name, options)) played += 1;
}

/** Plays one voice; true when it reached the Web Audio graph. */
function playVoice(name: SfxName, options: PlayOptions): boolean {
  if (muted || forcedByUrl) return false;
  unlockAudio();
  if (!ctx || !sfxIn) return false;
  const voice: Voice = VOICES[name];
  const now = ctx.currentTime;

  let rate = options.rate ?? 1;
  let volume = options.volume ?? 1;
  if (voice.jitter !== undefined) rate *= 1 + (Math.random() * 2 - 1) * voice.jitter;
  if (voice.vary !== undefined) volume *= 1 + (Math.random() * 2 - 1) * voice.vary;
  if (voice.chain !== undefined) {
    const c = chains.get(name) ?? { step: -1, at: -Infinity };
    c.step = now - c.at <= voice.chain.resetMs / 1000 ? Math.min(voice.chain.max, c.step + 1) : 0;
    c.at = now;
    chains.set(name, c);
    rate *= 2 ** ((c.step * voice.chain.step) / 12);
  }

  // Polyphony: drop finished instances, steal the oldest when full.
  let list = live.get(name);
  if (list === undefined) {
    list = [];
    live.set(name, list);
  }
  for (let i = list.length - 1; i >= 0; i -= 1) if ((list[i]?.end ?? 0) <= now) list.splice(i, 1);
  while (list.length >= voice.poly) {
    const old = list.shift();
    if (old === undefined) break;
    old.gain.gain.cancelScheduledValues(now);
    old.gain.gain.setTargetAtTime(0, now, STEAL_TC);
  }

  const sample = samples.get(name);
  let inst: Instance;
  if (sample) {
    const src = ctx.createBufferSource();
    src.buffer = sample;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume * (voice.sampleGain ?? 1);
    src.connect(gain).connect(sfxIn);
    const t0 = now + (options.delay ?? 0);
    src.start(t0);
    inst = { gain, end: t0 + sample.duration / rate };
  } else {
    inst = synthVoice(ctx, sfxIn, name, { ...options, rate, volume });
  }
  list.push(inst);
  if (voice.duck === true) duckMusic();
  return true;
}

/** Ascending arpeggio — use for combos, level-ups, milestone score. Counts as ONE request. */
export function sfxArp(name: SfxName, steps: number, options: PlayOptions = {}): void {
  requested += 1;
  const capped = Math.min(steps, 6);
  let reached = false;
  for (let i = 0; i < capped; i += 1) {
    const hit = playVoice(name, {
      ...options,
      rate: (options.rate ?? 1) * (1 + i * 0.14),
      delay: (options.delay ?? 0) + i * 0.06,
    });
    reached = reached || hit;
  }
  if (reached) played += 1;
}
