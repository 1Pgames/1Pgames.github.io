import { load, save } from './storage';
import { STORE } from './keys';
import { AUDIO } from '../data/audio';

/**
 * Sound. Every voice has a WebAudio synth definition, so a generated game with
 * no audio files still has full game feel.
 *
 * A game that DOES ship samples registers them in `src/data/audio.ts`:
 * `initGeneratedAudio()` (called once from `PreloadScene`) fetches and decodes
 * them into the same context, and `sfx()` plays the sample for a registered
 * name and the synth voice for every other one. A fetch/decode failure warns
 * once and stays on the synth voice. Generated samples are the default for a
 * shipped game; the synth is their failure fallback.
 *
 * Usage:  sfx('pickup')  /  sfx('hit', { rate: 1.2 })  /  toggleMute()
 *
 * Mixing (ported from the Duskhaul audio audit): voice → instance gain → SFX
 * bus (glue compressor → make-up) → Settings×mute master → destination. Music
 * (`core/music.ts`) connects to `musicInput()`, a duck gain → destination, so
 * a voice flagged `duck` dips the score −6 dB for 400 ms without touching its
 * Settings level. Each voice has a `poly` cap; a call over the cap STEALS the
 * oldest live instance of that voice (5 ms fade) instead of being dropped, so
 * a kill spike never stacks 40 identical transients into clipping. Spam RATE
 * belongs at the call site, never here.
 *
 * Settings: `playerSettings()` / `savePlayerSettings(patch)` own the persisted
 * Music level, SFX level and Reduce-motion flag (`STORE.settings`). Saving
 * applies to the audio playing NOW — the SFX bus here, the music bus through
 * `onSettingsChange` in `core/music.ts` — so a slider is heard while dragged.
 *
 * SILENCE FOR AUTOMATED RUNS: load the game with `?mute=1` (or a bare `?mute`)
 * and the whole audio stack is inert from the first frame — see `MUTE_PARAM`
 * below. This exists because the alternative (an agent writing the persisted
 * `muted` preference before load) races audio init, is forgotten half the
 * time, and mutates the player's save; both failures happened, audibly, on a
 * user's machine. A driver appends the param to the URL and needs no other
 * cooperation from the game.
 */

type Wave = OscillatorType | 'noise';

/** One partial of a voice: an oscillator (or filtered noise) under its own envelope. */
interface Layer {
  wave: Wave;
  /** Start frequency in Hz (noise: filter centre when `cutoff` is omitted). */
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
  /** Filter on this layer; noise defaults to a bandpass at `cutoff ?? freq`. */
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
   * Linear make-up gain for this voice's registered SAMPLE only. Level-match a
   * sample to its synth voice in the file itself; a file that cannot take the
   * full boost without passing −1 dBTP carries the rest here.
   */
  sampleGain?: number;
}

const VOICES = {
  ui: { poly: 3, layers: [{ wave: 'square', freq: 660, freqEnd: 880, attack: 0.002, decay: 0.07, gain: 0.18 }] },
  tap: { poly: 3, layers: [{ wave: 'triangle', freq: 420, freqEnd: 620, attack: 0.002, decay: 0.09, gain: 0.22 }] },
  pickup: {
    poly: 3,
    layers: [{ wave: 'square', freq: 720, freqEnd: 1320, attack: 0.002, decay: 0.14, gain: 0.2, detune: 12 }],
  },
  combo: { poly: 3, layers: [{ wave: 'square', freq: 980, freqEnd: 1760, attack: 0.002, decay: 0.12, gain: 0.18 }] },
  jump: { poly: 2, layers: [{ wave: 'sawtooth', freq: 300, freqEnd: 720, attack: 0.002, decay: 0.16, gain: 0.2 }] },
  hit: {
    poly: 4,
    jitter: 0.08,
    layers: [
      { wave: 'sawtooth', freq: 260, freqEnd: 70, attack: 0.001, decay: 0.24, gain: 0.3 },
      { wave: 'noise', freq: 780, cutoffEnd: 260, attack: 0.001, decay: 0.24, gain: 0.105 },
    ],
  },
  die: {
    poly: 2,
    duck: true,
    layers: [
      { wave: 'triangle', freq: 340, freqEnd: 48, attack: 0.004, decay: 0.75, gain: 0.34 },
      { wave: 'noise', freq: 1020, cutoffEnd: 340, attack: 0.004, decay: 0.75, gain: 0.061 },
    ],
  },
  levelup: {
    poly: 4,
    duck: true,
    layers: [{ wave: 'square', freq: 520, freqEnd: 1040, attack: 0.004, decay: 0.3, gain: 0.2 }],
  },
  whoosh: {
    poly: 3,
    layers: [
      { wave: 'sine', freq: 180, freqEnd: 90, attack: 0.01, decay: 0.3, gain: 0.12 },
      { wave: 'noise', freq: 540, cutoffEnd: 180, attack: 0.01, decay: 0.3, gain: 0.06 },
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

// ─────────────────────────── settings ───────────────────────────

/** The player's persisted Settings (`STORE.settings`). Levels are 0..1. */
export interface PlayerSettings {
  music: number;
  sfx: number;
  /** Progression beats and other ceremony run calm (`ui/progressFx.ts`). Defaults to the OS preference. */
  reduceMotion: boolean;
}

function systemReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const clamp01 = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;

/** Stored Settings, defaulted field by field (a partial or stale blob never throws). */
export function playerSettings(): PlayerSettings {
  const raw = load<Partial<PlayerSettings> | null>(STORE.settings, null);
  return {
    music: clamp01(raw?.music, 1),
    sfx: clamp01(raw?.sfx, 1),
    reduceMotion: typeof raw?.reduceMotion === 'boolean' ? raw.reduceMotion : systemReducedMotion(),
  };
}

type SettingsListener = (settings: PlayerSettings) => void;
const settingsListeners = new Set<SettingsListener>();

/** Subscribe to Settings saves (the music bus re-levels itself here). Returns an unsubscribe function. */
export function onSettingsChange(listener: SettingsListener): () => void {
  settingsListeners.add(listener);
  return () => settingsListeners.delete(listener);
}

/**
 * Persists a Settings change and applies it to what is playing NOW: the SFX
 * bus directly, the music bus through `onSettingsChange`. Call on every slider
 * step, not only on release — the player must hear the level while dragging.
 */
export function savePlayerSettings(patch: Partial<PlayerSettings>): PlayerSettings {
  const merged = { ...playerSettings(), ...patch };
  const next: PlayerSettings = {
    music: clamp01(merged.music, 1),
    sfx: clamp01(merged.sfx, 1),
    reduceMotion: merged.reduceMotion === true,
  };
  save(STORE.settings, next);
  sfxLevel = next.sfx;
  applyMasterGain();
  settingsListeners.forEach((listener) => listener(next));
  return next;
}

// ─────────────────────────── state ───────────────────────────

let ctx: AudioContext | null = null;
/** Settings × mute gain at the end of the SFX bus. */
let master: GainNode | null = null;
/** Voices connect here (glue compressor → make-up → `master`). */
let sfxIn: AudioNode | null = null;
/** Music bus duck gain → destination (`musicInput()`). */
let musicDuck: GainNode | null = null;
/** SFX master at Settings 1 — `audioStatus().masterGain` reads 0.9 on an unmuted default run. */
const MASTER_LEVEL = 0.9;
/** Glue compressor make-up gain. */
const SFX_MAKEUP = 1;
/** Music duck: depth (−6 dB) and hold. */
const DUCK = { level: 0.5, holdS: 0.4, attackTc: 0.03, releaseTc: 0.12 } as const;
/** Steal fade (s): long enough not to click, short enough to free the slot now. */
const STEAL_TC = 0.005;
/** Longest `sfxArp`: more steps read as a glissando, not a reward. */
const ARP_MAX_STEPS = 6;
let sfxLevel = playerSettings().sfx;

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

function applyMasterGain(): void {
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL * sfxLevel, ctx.currentTime, 0.02);
}

/**
 * The SFX bus: voices → glue compressor (catches stacked kills without
 * pumping the score) → make-up gain. Returns the input voices connect to and
 * the output to route onward.
 */
function sfxBus(target: BaseAudioContext): { input: AudioNode; output: AudioNode } {
  const comp = target.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 6;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  const makeup = target.createGain();
  makeup.gain.value = SFX_MAKEUP;
  comp.connect(makeup);
  return { input: comp, output: makeup };
}

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
    if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_LEVEL * sfxLevel;
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

/** Dips the music bus −6 dB for `DUCK.holdS`, then recovers — big beats cut through the score. */
function duckMusic(): void {
  if (!ctx || !musicDuck) return;
  const g = musicDuck.gain;
  const now = ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setTargetAtTime(DUCK.level, now, DUCK.attackTc);
  g.setTargetAtTime(1, now + DUCK.holdS, DUCK.releaseTc);
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
  applyMasterGain();
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
  /** SFX master gain (0.9 × Settings SFX when unmuted), or `null` when no context exists (always null under `?mute`). */
  masterGain: number | null;
  /** `null` under `?mute`: the context is never created at all. */
  contextState: AudioContextState | null;
  /** `sfx()` calls (one per `sfxArp` step), silent or not. */
  requested: number;
  /** Calls that actually reached the audio graph. 0 for a whole muted run. */
  played: number;
  lastRequested: SfxName | null;
  /** Live music duck gain (1 = no duck, 0.5 during a big beat); `null` without a context. */
  musicDuck: number | null;
  /** Registered samples decoded so far — 0 means every voice is on its synth fallback. */
  samplesDecoded: number;
  /** The stored Settings the buses are applying. */
  settings: PlayerSettings;
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
    musicDuck: musicDuck === null ? null : musicDuck.gain.value,
    samplesDecoded: samples.size,
    settings: playerSettings(),
  };
}

// A window WE own, exactly like `main.ts`'s `__GAME__` handle: the cast is a
// declaration of our own property, not an assumption about foreign data.
if (typeof window !== 'undefined') {
  const debugWindow = window as unknown as { __AUDIO__?: () => AudioStatus };
  debugWindow.__AUDIO__ = audioStatus;
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

/** A live voice (or one whole arpeggio): its gain is what a steal fades. */
interface Instance {
  gain: GainNode;
  end: number;
}
/** Live instances per voice, oldest first. */
const live = new Map<SfxName, Instance[]>();
/** Rising-chain state per voice: current step and the time of the last call. */
const chains = new Map<SfxName, { step: number; at: number }>();

/**
 * Schedules one voice — its decoded sample if registered, else its synth
 * layers — into `dest`, starting `delay` s from now. Returns the end time.
 */
function scheduleVoice(target: AudioContext, dest: AudioNode, name: SfxName, rate: number, delay: number): number {
  const voice: Voice = VOICES[name];
  const t0 = target.currentTime + delay;
  const sample = samples.get(name);
  if (sample) {
    const src = target.createBufferSource();
    src.buffer = sample;
    src.playbackRate.value = rate;
    const gain = target.createGain();
    gain.gain.value = voice.sampleGain ?? 1;
    src.connect(gain).connect(dest);
    src.start(t0);
    return t0 + sample.duration / rate;
  }
  let end = t0;
  for (const layer of voice.layers) {
    const start = t0 + (layer.delay ?? 0);
    const stop = start + layer.attack + layer.decay;
    end = Math.max(end, stop);
    const env = target.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(layer.gain, start + layer.attack);
    env.gain.exponentialRampToValueAtTime(0.0001, stop);
    env.connect(dest);
    let head: AudioNode = env;
    const filterType = layer.filter ?? (layer.wave === 'noise' ? 'bandpass' : undefined);
    if (filterType !== undefined) {
      const f = target.createBiquadFilter();
      f.type = filterType;
      f.frequency.setValueAtTime((layer.cutoff ?? layer.freq) * rate, start);
      if (layer.cutoffEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(40, layer.cutoffEnd * rate), stop);
      if (layer.q !== undefined) f.Q.value = layer.q;
      f.connect(env);
      head = f;
    }
    if (layer.wave === 'noise') {
      const src = target.createBufferSource();
      src.buffer = noiseFor(target);
      src.loop = true;
      src.connect(head);
      src.start(start, Math.random() * 0.3);
      src.stop(stop + 0.02);
      continue;
    }
    const wave = layer.wave;
    const osc = (detune: number): void => {
      const o = target.createOscillator();
      o.type = wave;
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
  return end;
}

/** Per-call pitch: jitter plus the rising-chain step. */
function voiceRate(name: SfxName, voice: Voice, base: number, now: number): number {
  let rate = base;
  if (voice.jitter !== undefined) rate *= 1 + (Math.random() * 2 - 1) * voice.jitter;
  if (voice.chain !== undefined) {
    const c = chains.get(name) ?? { step: -1, at: -Infinity };
    c.step = now - c.at <= voice.chain.resetMs / 1000 ? Math.min(voice.chain.max, c.step + 1) : 0;
    c.at = now;
    chains.set(name, c);
    rate *= 2 ** ((c.step * voice.chain.step) / 12);
  }
  return rate;
}

/** Frees a slot for `name`: drops finished instances, steals the oldest while at the cap. */
function claimSlot(name: SfxName, voice: Voice, now: number): Instance[] {
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
  return list;
}

/**
 * Plays `steps` notes of `name` (1 = a plain voice) as ONE polyphony instance,
 * so an arpeggio never steals its own later notes. True when it reached the
 * graph.
 */
function playVoice(name: SfxName, options: PlayOptions, steps: number): boolean {
  if (muted) return false;
  unlockAudio();
  if (!ctx || !sfxIn) return false;
  const voice: Voice = VOICES[name];
  const now = ctx.currentTime;
  const list = claimSlot(name, voice, now);
  let volume = options.volume ?? 1;
  if (voice.vary !== undefined) volume *= 1 + (Math.random() * 2 - 1) * voice.vary;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  gain.connect(sfxIn);
  const rate = voiceRate(name, voice, options.rate ?? 1, now);
  const delay = options.delay ?? 0;
  let end = now;
  for (let i = 0; i < steps; i += 1) {
    end = Math.max(end, scheduleVoice(ctx, gain, name, rate * (1 + i * 0.14), delay + i * 0.06));
  }
  list.push({ gain, end });
  if (voice.duck === true) duckMusic();
  return true;
}

export function sfx(name: SfxName, options: PlayOptions = {}): void {
  sfxRequested += 1;
  lastRequested = name;
  if (playVoice(name, options, 1)) sfxPlayed += 1;
}

/** Ascending arpeggio — use for combos, level-ups, milestone score. Counts one request per step. */
export function sfxArp(name: SfxName, steps: number, options: PlayOptions = {}): void {
  const capped = Math.max(0, Math.min(steps, ARP_MAX_STEPS));
  if (capped === 0) return;
  sfxRequested += capped;
  lastRequested = name;
  if (playVoice(name, options, capped)) sfxPlayed += capped;
}
