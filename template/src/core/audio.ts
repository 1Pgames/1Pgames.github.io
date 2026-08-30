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
 *
 * SILENCE FOR AUTOMATED RUNS: load the game with `?mute=1` (or a bare `?mute`)
 * and the whole audio stack is inert from the first frame — see `MUTE_PARAM`
 * below. This exists because the alternative (an agent writing the persisted
 * `muted` preference before load) races audio init, is forgotten half the
 * time, and mutates the player's save; both failures happened, audibly, on a
 * user's machine. A driver appends the param to the URL and needs no other
 * cooperation from the game.
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
/**
 * The URL switch that forces silence for one page load.
 *
 * Presence alone is enough (`?mute`), and an explicit truthy value is accepted
 * so a driver can build `?mute=1` mechanically. `?mute=0` / `false` / `off` /
 * `no` mean NOT forced, because a driver that templates the value in must be
 * able to switch it off without rewriting the query string — with a bare
 * `has()` test (the `?debug` convention) `?mute=0` would silence the game,
 * which is the kind of trap that gets discovered during a demo.
 *
 * Name is case-sensitive (`mute`), values are not. There is no alias: one
 * spelling, so five call sites cannot drift.
 *
 * NOT gated on `import.meta.env.DEV` — cert, fuzz and QA drive PRODUCTION
 * builds, and those are exactly the runs that must be silent.
 */
const MUTE_PARAM = 'mute';
/** Values that mean "present but OFF". Static table, so a Record. */
const MUTE_OFF_VALUES: Record<string, true> = { '0': true, false: true, off: true, no: true };

function readUrlMute(): boolean {
  try {
    // `location` is absent when the sim/CLI imports this module under node.
    if (typeof location === 'undefined') return false;
    const value = new URLSearchParams(location.search).get(MUTE_PARAM);
    if (value === null) return false;
    return MUTE_OFF_VALUES[value.trim().toLowerCase()] !== true;
  } catch {
    return false;
  }
}

/**
 * Read ONCE at module init, before any scene exists and therefore before any
 * `sfx()` can fire — that immediacy is the whole point over the localStorage
 * route. A later change to the query string does nothing; a driver keeps the
 * param in every URL it loads.
 */
const forcedMute = readUrlMute();
/** The player's own preference. The URL override NEVER writes to this. */
let storedMute = load<boolean>(STORE.muted, false);
/** What `sfx()` and the music buses obey. */
let muted = forcedMute || storedMute;
let noiseBuffer: AudioBuffer | null = null;
type MuteListener = (muted: boolean) => void;
const muteListeners = new Set<MuteListener>();

/**
 * Playback census, for runs that must be silent without losing coverage: a
 * request is counted BEFORE the mute check, so "did the game ask for the hit
 * sound" is answerable in a forced-silent run, and `sfxPlayed` proves the
 * opposite direction — it must stay 0 for a whole `?mute` session.
 */
let sfxRequested = 0;
let sfxPlayed = 0;
let lastRequested: SfxName | null = null;

/** Decoded generated samples; a name in here plays instead of its synth voice. */
const samples = new Map<SfxName, AudioBuffer>();
/** Fetched bytes waiting for a context — `initGeneratedAudio()` runs before the first gesture. */
const fetched = new Map<SfxName, ArrayBuffer>();
let samplesRequested = false;

/**
 * Browsers require a user gesture; call once from a pointer/key handler.
 *
 * Under `?mute` this returns without ever creating an AudioContext, so a
 * forced-silent run has NO audio graph at all: no oscillator is scheduled, no
 * master gain exists to be ramped back up, and `getAudioContext()` stays
 * `null`, which makes `core/music.ts` bail at its own first line. That is a
 * stronger guarantee than "gain 0" and it is what an automated run should
 * assert (`audioStatus().contextState === null`). A mute that comes from the
 * player's own preference still builds the graph at gain 0, because their next
 * tap on SOUND: ON has to be audible immediately.
 */
export function unlockAudio(): void {
  if (forcedMute) return;
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

/** Effective mute: what `sfx()` and every music bus obey. */
export function isMuted(): boolean {
  return muted;
}

/**
 * Records the player's preference and re-derives the effective mute.
 *
 * The new preference is derived from what the player can SEE (the effective
 * state the label shows), not from the stored value: under `?mute` the label
 * reads SOUND: OFF even when nothing is stored, so a press there means "give
 * me sound" and must record UNMUTED — flipping the stored value blindly would
 * record the opposite of what the button said. Without the param the two are
 * the same value and this is the old behaviour exactly.
 *
 * The URL override still owns the session, so the return value — and therefore
 * the label — stays OFF while it is active. Promising sound the session will
 * not deliver is a worse lie than an unresponsive toggle, and the preference
 * is honoured on the player's next ordinary load.
 */
export function toggleMute(): boolean {
  storedMute = !muted;
  save(STORE.muted, storedMute);
  muted = forcedMute || storedMute;
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02);
  muteListeners.forEach((listener) => listener(muted));
  return muted;
}

/**
 * Everything an automated run needs to prove the audio stack is WIRED while it
 * is silent — the point being that silence must not cost coverage: `requested`
 * counts every `sfx()` call whether or not it made a sound, so a QA pass can
 * assert "the hit sound fires on a hit" without playing it.
 *
 * Also exposed as `window.__AUDIO__()` so a driver on a PRODUCTION bundle can
 * read it without module access (same debug-handle convention as `__GAME__`).
 */
export interface AudioStatus {
  /** Effective: `forcedByUrl || storedPreference`. */
  muted: boolean;
  /** `?mute` was present at load. Read once, at module init. */
  forcedByUrl: boolean;
  /** The persisted `muted` preference. Never written by the URL override. */
  storedPreference: boolean;
  /** Master gain, or `null` when no context exists (always null under `?mute`). */
  masterGain: number | null;
  /** `null` under `?mute`: the context is never created at all. */
  contextState: AudioContextState | null;
  /** `sfx()` calls, silent or not. */
  requested: number;
  /** Calls that actually reached the audio graph. 0 for a whole muted run. */
  played: number;
  lastRequested: SfxName | null;
}

export function audioStatus(): AudioStatus {
  return {
    muted,
    forcedByUrl: forcedMute,
    storedPreference: storedMute,
    masterGain: master === null ? null : master.gain.value,
    contextState: ctx === null ? null : ctx.state,
    requested: sfxRequested,
    played: sfxPlayed,
    lastRequested,
  };
}

// A window WE own, exactly like `main.ts`'s `__GAME__` handle: the cast is a
// declaration of our own property, not an assumption about foreign data.
if (typeof window !== 'undefined') {
  const debugWindow = window as unknown as { __AUDIO__?: () => AudioStatus };
  debugWindow.__AUDIO__ = audioStatus;
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
  sfxRequested += 1;
  lastRequested = name;
  if (muted) return;
  unlockAudio();
  if (!ctx || !master) return;
  sfxPlayed += 1;

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
