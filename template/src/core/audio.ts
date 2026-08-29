import { load, save } from './storage';
import { STORE } from './keys';
import { AUDIO } from '../data/audio';

/**
 * Sound. Every voice is synthesised with WebAudio at runtime, so a generated
 * game ships with no audio files and still has full game feel.
 *
 * A game that DOES ship samples registers them in `src/data/audio.ts`:
 * `initGeneratedAudio()` (called once from `PreloadScene`) fetches and decodes
 * them into the same context, and `sfx()` plays the sample for a registered
 * name and the synth voice for every other one. A fetch/decode failure warns
 * once and stays on the synth voice.
 *
 * Usage:  sfx('pickup')  /  sfx('hit', { rate: 1.2 })  /  toggleMute()
 */

type Wave = OscillatorType;

interface Voice {
  wave: Wave;
  /** Start frequency in Hz. */
  freq: number;
  /** Frequency at the end of the sweep; omit for a flat tone. */
  freqEnd?: number;
  /** Seconds. */
  attack: number;
  decay: number;
  gain: number;
  /** Adds a filtered noise burst on top — reads as impact/whoosh. */
  noise?: number;
  /** Detuned second oscillator for thickness. */
  detune?: number;
}

const VOICES = {
  ui: { wave: 'square', freq: 660, freqEnd: 880, attack: 0.002, decay: 0.07, gain: 0.18 },
  tap: { wave: 'triangle', freq: 420, freqEnd: 620, attack: 0.002, decay: 0.09, gain: 0.22 },
  pickup: {
    wave: 'square',
    freq: 720,
    freqEnd: 1320,
    attack: 0.002,
    decay: 0.14,
    gain: 0.2,
    detune: 12,
  },
  combo: { wave: 'square', freq: 980, freqEnd: 1760, attack: 0.002, decay: 0.12, gain: 0.18 },
  jump: { wave: 'sawtooth', freq: 300, freqEnd: 720, attack: 0.002, decay: 0.16, gain: 0.2 },
  hit: {
    wave: 'sawtooth',
    freq: 260,
    freqEnd: 70,
    attack: 0.001,
    decay: 0.24,
    gain: 0.3,
    noise: 0.35,
  },
  die: {
    wave: 'triangle',
    freq: 340,
    freqEnd: 48,
    attack: 0.004,
    decay: 0.75,
    gain: 0.34,
    noise: 0.18,
  },
  levelup: { wave: 'square', freq: 520, freqEnd: 1040, attack: 0.004, decay: 0.3, gain: 0.2 },
  whoosh: { wave: 'sine', freq: 180, freqEnd: 90, attack: 0.01, decay: 0.3, gain: 0.12, noise: 0.5 },
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
let master: GainNode | null = null;
let muted = load<boolean>(STORE.muted, false);
let noiseBuffer: AudioBuffer | null = null;
type MuteListener = (muted: boolean) => void;
const muteListeners = new Set<MuteListener>();

/** Decoded generated samples; a name in here plays instead of its synth voice. */
const samples = new Map<SfxName, AudioBuffer>();
/** Fetched bytes waiting for a context — `initGeneratedAudio()` runs before the first gesture. */
const fetched = new Map<SfxName, ArrayBuffer>();
let samplesRequested = false;

/** Browsers require a user gesture; call once from a pointer/key handler. */
export function unlockAudio(): void {
  if (!ctx) {
    if (typeof window.AudioContext !== 'function') return;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);

    const frames = Math.floor(ctx.sampleRate * 0.4);
    noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
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

/**
 * Subscribe to mute toggles so other audio buses (music) can silence
 * themselves in lockstep with sfx. Returns an unsubscribe function.
 */
export function onMuteChange(listener: MuteListener): () => void {
  muteListeners.add(listener);
  return () => muteListeners.delete(listener);
}

export function isMuted(): boolean {
  return muted;
}

export function toggleMute(): boolean {
  muted = !muted;
  save(STORE.muted, muted);
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02);
  muteListeners.forEach((listener) => listener(muted));
  return muted;
}

/**
 * One-shot playback of a decoded sample. `rate` retunes it (playbackRate),
 * `volume` scales it; mute is already handled by the shared master gain.
 */
function playSample(target: AudioContext, destination: AudioNode, buffer: AudioBuffer, options: PlayOptions): void {
  const src = target.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = options.rate ?? 1;
  const gain = target.createGain();
  gain.gain.value = options.volume ?? 1;
  src.connect(gain).connect(destination);
  src.start(target.currentTime + (options.delay ?? 0));
}

export function sfx(name: SfxName, options: PlayOptions = {}): void {
  if (muted) return;
  unlockAudio();
  if (!ctx || !master) return;

  const sample = samples.get(name);
  if (sample) {
    playSample(ctx, master, sample, options);
    return;
  }

  const voice: Voice = VOICES[name];
  const rate = options.rate ?? 1;
  const t0 = ctx.currentTime + (options.delay ?? 0);
  const peak = voice.gain * (options.volume ?? 1);
  const end = t0 + voice.attack + voice.decay;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(peak, t0 + voice.attack);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  env.connect(master);

  const startOsc = (detune: number): void => {
    const osc = ctx!.createOscillator();
    osc.type = voice.wave;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(voice.freq * rate, t0);
    if (voice.freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, voice.freqEnd * rate), end);
    }
    osc.connect(env);
    osc.start(t0);
    osc.stop(end + 0.02);
  };

  startOsc(0);
  if (voice.detune !== undefined) startOsc(voice.detune);

  if (voice.noise !== undefined && noiseBuffer) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(voice.freq * 3 * rate, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, voice.freq * rate), end);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, t0);
    noiseGain.gain.exponentialRampToValueAtTime(peak * voice.noise, t0 + voice.attack);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, end);
    src.connect(filter).connect(noiseGain).connect(master);
    src.start(t0);
    src.stop(end + 0.02);
  }
}

/** Ascending arpeggio — use for combos, level-ups, milestone score. */
export function sfxArp(name: SfxName, steps: number, options: PlayOptions = {}): void {
  const capped = Math.min(steps, 6);
  for (let i = 0; i < capped; i += 1) {
    sfx(name, {
      ...options,
      rate: (options.rate ?? 1) * (1 + i * 0.14),
      delay: (options.delay ?? 0) + i * 0.06,
    });
  }
}
