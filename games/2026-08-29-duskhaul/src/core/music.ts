import { getAudioContext, isMuted, onMuteChange, unlockAudio } from './audio';
import { AUDIO, type MusicTrack } from '../data/audio';

/**
 * Zero-asset background music. Everything is synthesised with WebAudio using
 * a lookahead scheduler (Chris Wilson's "tale of two clocks" pattern): a
 * `setInterval` tick every 100ms looks 200ms ahead on `ctx.currentTime` and
 * schedules notes there, so playback stays sample-accurate even if the tab
 * throttles timers (a suspended context during a background tab is fine —
 * nothing is lost, it just resumes on the next `unlockAudio()`/gesture).
 *
 * Content: a deterministic 4-bar minor-key loop (i–VI–III–VII) built from a
 * fixed chord table, layered as:
 *   - bass:  a triangle pulse on the chord root, once per beat
 *   - pad:   a sustained detuned saw+triangle pair per bar, through a
 *            lowpass filter that brightens with intensity
 *   - arp:   a 16th-note square pluck cycling the chord tones, denser and
 *            brighter as intensity rises
 *   - perc:  a filtered noise tick on the offbeat, only above ~0.45 intensity
 *   - boss:  an optional tritone ostinato pulse toggled by `setMusicLayer`
 *
 * API: `startMusic(mood)`, `setMusicIntensity(0..1)`, `setMusicLayer('boss',
 * on)`, `stopMusic(fadeMs?)`. All music is summed through one master gain
 * (≤ ~0.1) so it always sits under `core/audio.ts` sfx, and that master gain
 * is wired to the same mute state via `onMuteChange` so a single mute toggle
 * silences both buses.
 *
 * When the game DOES ship music files (registered in `src/data/audio.ts`, empty
 * in the template) this module plays those loops instead of synthesising: the
 * 'menu' stem under the menu mood, and a `game-low` <-> `game-high` equal-power
 * crossfade driven by `setMusicIntensity` under the run mood (a single game
 * stem just rides its level with intensity). Each stem is a looping
 * `AudioBufferSourceNode` on the SAME context — decoded up front, so a loop is
 * gapless where an `<audio>` element would tick — on its own gain, summed
 * through a stem bus that mirrors the synth bus. Same API, same mute wiring,
 * same fade-out; the synth scheduler simply never starts. Both engines are
 * per-mood: a game may ship a menu loop and synthesise its run.
 *
 * Do NOT: schedule anything from `update`/`requestAnimationFrame` — the
 * lookahead timer is the only clock. Do NOT reference `window`/`AudioContext`
 * at module scope; the context is created lazily by `core/audio.ts` on the
 * first user gesture and every stem node is created with it, so importing this
 * module in a non-browser environment (Node, tests) is safe.
 */

export type MusicMood = 'menu' | 'run';
export type MusicLayer = 'boss';

interface Chord {
  /** MIDI note for the bass pulse. */
  bass: number;
  /** MIDI notes for the pad/arp triad, low to high. */
  tones: readonly number[];
}

/** i - VI - III - VII in A minor, one chord per bar, four bars per loop. */
const PROGRESSION: readonly Chord[] = [
  { bass: 45, tones: [57, 60, 64] }, // i    A minor
  { bass: 41, tones: [53, 57, 60] }, // VI   F major
  { bass: 48, tones: [60, 64, 67] }, // III  C major
  { bass: 43, tones: [55, 59, 62] }, // VII  G major
];

const STEPS_PER_BAR = 16;
const LOOP_STEPS = STEPS_PER_BAR * PROGRESSION.length;
const BASE_BPM = 92;
const BPM_SPREAD = 8;
const PERC_THRESHOLD = 0.45;
const MENU_INTENSITY = 0.12;

const LOOKAHEAD_MS = 100;
const SCHEDULE_AHEAD_S = 0.2;
const MIX_RAMP_TC = 0.13; // 3x time constant ~= 0.4s settle, matches the crossfade budget

const MASTER_GAIN = 0.1;
const BASS_LEVEL = 0.9;
const PAD_LEVEL = 0.75;
const ARP_LEVEL = 0.8;
const PERC_LEVEL = 0.6;
const BOSS_LEVEL = 0.85;

const BASS_PEAK = 0.9;
const PAD_TONE_PEAK = 0.32;
const ARP_PEAK = 0.6;
const PERC_PEAK = 0.8;
const BOSS_PEAK = 0.7;

/**
 * File-stem bus level. Generated loops arrive near full scale, so they need a
 * far lower bus than the synth's summed peaks to sit under sfx the same way.
 */
const STEM_MASTER_GAIN = 0.5;
/** Intensity at which the run mood is half `game-low`, half `game-high`. */
const STEM_CROSSFADE_CENTER = 0.55;
/** Intensity span the crossfade takes: full low below 0.35, full high above 0.75. */
const STEM_CROSSFADE_WIDTH = 0.4;
/** Boss layer has no stem of its own, so it drives the mix as near-peak pressure. */
const STEM_BOSS_DRIVE = 0.85;

/** MIDI note number to frequency in Hz (A4 = 69 = 440Hz). */
export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Which chord (of the 4-bar loop) a given absolute bar index falls on. */
export function chordForBar(bar: number): Chord {
  return PROGRESSION[((bar % PROGRESSION.length) + PROGRESSION.length) % PROGRESSION.length]!;
}

/** Tempo drifts ±`BPM_SPREAD` around `BASE_BPM` as intensity rises 0..1. */
export function bpmForIntensity(intensity: number): number {
  const clamped = Math.min(1, Math.max(0, intensity));
  return BASE_BPM - BPM_SPREAD + clamped * BPM_SPREAD * 2;
}

/** Steps between arp notes: quarter notes at low intensity, 16ths at high. */
export function arpStepDiv(intensity: number): number {
  if (intensity < 0.3) return 4;
  if (intensity < 0.7) return 2;
  return 1;
}

/** Percussion only kicks in once intensity crosses the threshold. */
export function percActive(intensity: number): boolean {
  return intensity >= PERC_THRESHOLD;
}

/** Lowpass cutoff (Hz) for pad/arp brightness; the menu mood stays duller. */
export function lowpassHzForIntensity(intensity: number, calm: boolean): number {
  const clamped = Math.min(1, Math.max(0, intensity));
  const base = calm ? 500 : 900;
  const span = calm ? 500 : 3400;
  return base + clamped * span;
}

/**
 * Equal-power `game-low`/`game-high` weights around the crossfade threshold:
 * the pair always sums to constant power, so the run mood gets a smooth
 * handover instead of a dip in the middle or a jump at the threshold.
 */
export function stemCrossfade(intensity: number): { low: number; high: number } {
  const clamped = Math.min(1, Math.max(0, intensity));
  const start = STEM_CROSSFADE_CENTER - STEM_CROSSFADE_WIDTH / 2;
  const t = Math.min(1, Math.max(0, (clamped - start) / STEM_CROSSFADE_WIDTH));
  return { low: Math.cos((t * Math.PI) / 2), high: Math.sin((t * Math.PI) / 2) };
}

/** A lone game stem has nothing to trade against, so intensity rides its level. */
export function soloStemLevel(intensity: number): number {
  return 0.6 + Math.min(1, Math.max(0, intensity)) * 0.4;
}

interface MusicNodes {
  master: GainNode;
  bassGain: GainNode;
  padGain: GainNode;
  arpGain: GainNode;
  percGain: GainNode;
  bossGain: GainNode;
  percBuffer: AudioBuffer;
}

/**
 * The file-stem engine: one looping `AudioBufferSourceNode` per registered
 * stem, each on its own gain so the run mood can crossfade, all summed through
 * one bus that mirrors the synth bus (mute, fade-out, "under the sfx").
 */
interface StemNodes {
  master: GainNode;
  gains: Map<MusicTrack, GainNode>;
  sources: Map<MusicTrack, AudioBufferSourceNode>;
}

/** Which stems each mood plays, in `stemCrossfade` order (low then high). */
const MOOD_TRACKS: Record<MusicMood, readonly MusicTrack[]> = {
  menu: ['menu'],
  run: ['game-low', 'game-high'],
};

let nodes: MusicNodes | null = null;
let stems: StemNodes | null = null;
/** Decoded loops, kept across `stopMusic` so a restart is instant. */
const stemBuffers = new Map<MusicTrack, AudioBuffer>();
/** Fetched or fetching, so a mood switch never re-requests a file. */
const stemRequested = new Set<MusicTrack>();
/** Unreachable or undecodable stems — treated as unregistered, so the mood synthesises. */
const stemFailed = new Set<MusicTrack>();
let mood: MusicMood | null = null;
let intensity = 0.3;
let bossOn = false;
let timerId: number | null = null;
let nextStepTime = 0;
let currentStep = 0;
let muteSubscribed = false;

/**
 * Registered, still-usable stems for a mood. Empty means "synthesise this
 * mood": no registry rows, or every candidate failed to load. Both engines are
 * per-mood, so a game may ship only a menu loop and synthesise its run.
 */
function moodStems(target: MusicMood): MusicTrack[] {
  return MOOD_TRACKS[target].filter((track) => AUDIO.music[track] !== undefined && !stemFailed.has(track));
}

function ensureMuteSubscription(): void {
  if (muteSubscribed) return;
  muteSubscribed = true;
  onMuteChange((mutedNow) => {
    const ctx = getAudioContext();
    if (!ctx) return;
    const silent = mutedNow || mood === null;
    if (nodes) nodes.master.gain.setTargetAtTime(silent ? 0 : MASTER_GAIN, ctx.currentTime, 0.02);
    if (stems) stems.master.gain.setTargetAtTime(silent ? 0 : STEM_MASTER_GAIN, ctx.currentTime, 0.02);
  });
}

function ensureGraph(ctx: AudioContext): MusicNodes {
  if (nodes) return nodes;
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const bassGain = ctx.createGain();
  const padGain = ctx.createGain();
  const arpGain = ctx.createGain();
  const percGain = ctx.createGain();
  const bossGain = ctx.createGain();
  for (const gain of [bassGain, padGain, arpGain, percGain, bossGain]) {
    gain.gain.value = 0;
    gain.connect(master);
  }

  const frames = Math.floor(ctx.sampleRate * 0.15);
  const percBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = percBuffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;

  nodes = { master, bassGain, padGain, arpGain, percGain, bossGain, percBuffer };
  return nodes;
}

function playPulse(
  ctx: AudioContext,
  destination: AudioNode,
  freq: number,
  time: number,
  wave: OscillatorType,
  peak: number,
  decay: number,
): void {
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, time);
  env.gain.exponentialRampToValueAtTime(peak, time + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  env.connect(destination);

  const osc = ctx.createOscillator();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, time);
  osc.connect(env);
  osc.start(time);
  osc.stop(time + decay + 0.02);
}

function playPad(
  ctx: AudioContext,
  destination: AudioNode,
  tones: readonly number[],
  time: number,
  duration: number,
  cutoffHz: number,
): void {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cutoffHz, time);
  filter.connect(destination);

  const attack = Math.min(0.6, duration * 0.3);
  const release = Math.min(0.5, duration * 0.3);
  const releaseStart = time + duration - release;

  for (const midi of tones) {
    for (const detune of [-6, 6]) {
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, time);
      env.gain.exponentialRampToValueAtTime(PAD_TONE_PEAK, time + attack);
      env.gain.setValueAtTime(PAD_TONE_PEAK, releaseStart);
      env.gain.exponentialRampToValueAtTime(0.0001, releaseStart + release);
      env.connect(filter);

      const osc = ctx.createOscillator();
      osc.type = detune < 0 ? 'sawtooth' : 'triangle';
      osc.detune.value = detune;
      osc.frequency.setValueAtTime(midiToFreq(midi), time);
      osc.connect(env);
      osc.start(time);
      osc.stop(time + duration + 0.05);
    }
  }
}

function playArpNote(ctx: AudioContext, destination: AudioNode, midi: number, time: number, cutoffHz: number): void {
  const decay = 0.16;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cutoffHz, time);
  filter.connect(destination);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, time);
  env.gain.exponentialRampToValueAtTime(ARP_PEAK, time + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  env.connect(filter);

  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(midiToFreq(midi), time);
  osc.connect(env);
  osc.start(time);
  osc.stop(time + decay + 0.02);
}

function playPercTick(ctx: AudioContext, destination: AudioNode, buffer: AudioBuffer, time: number): void {
  const decay = 0.05;
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(3200, time);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, time);
  env.gain.exponentialRampToValueAtTime(PERC_PEAK, time + 0.002);
  env.gain.exponentialRampToValueAtTime(0.0001, time + decay);

  src.connect(filter).connect(env).connect(destination);
  src.start(time);
  src.stop(time + decay + 0.02);
}

function scheduleStep(ctx: AudioContext, graph: MusicNodes, time: number, step: number): void {
  const stepInBar = step % STEPS_PER_BAR;
  const bar = Math.floor(step / STEPS_PER_BAR);
  const chord = chordForBar(bar);
  const calm = mood === 'menu';
  const effectiveIntensity = calm ? MENU_INTENSITY : intensity;
  const stepSeconds = 60 / bpmForIntensity(effectiveIntensity) / 4;
  const barSeconds = stepSeconds * STEPS_PER_BAR;

  if (stepInBar % 4 === 0) {
    playPulse(ctx, graph.bassGain, midiToFreq(chord.bass), time, 'triangle', BASS_PEAK, stepSeconds * 3.4);
  }

  if (stepInBar === 0) {
    playPad(ctx, graph.padGain, chord.tones, time, barSeconds * 0.95, lowpassHzForIntensity(effectiveIntensity, calm) * 0.6);
  }

  if (!calm) {
    const div = arpStepDiv(effectiveIntensity);
    if (stepInBar % div === 0) {
      const toneIndex = Math.floor(step / div) % chord.tones.length;
      playArpNote(ctx, graph.arpGain, chord.tones[toneIndex]! + 12, time, lowpassHzForIntensity(effectiveIntensity, calm));
    }

    if (percActive(effectiveIntensity) && stepInBar % 2 === 1) {
      playPercTick(ctx, graph.percGain, graph.percBuffer, time);
    }
  }

  if (bossOn && !calm && stepInBar % 2 === 0) {
    const tritone = stepInBar % 4 === 0 ? chord.bass : chord.bass + 6;
    playPulse(ctx, graph.bossGain, midiToFreq(tritone), time, 'sawtooth', BOSS_PEAK, stepSeconds * 1.6);
  }
}

function tick(): void {
  const ctx = getAudioContext();
  if (!ctx || !nodes || mood === null) return;
  const graph = nodes;
  while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
    scheduleStep(ctx, graph, nextStepTime, currentStep);
    const calm = mood === 'menu';
    nextStepTime += 60 / bpmForIntensity(calm ? MENU_INTENSITY : intensity) / 4;
    currentStep = (currentStep + 1) % LOOP_STEPS;
  }
}

function ensureScheduler(ctx: AudioContext): void {
  if (timerId !== null) return;
  currentStep = 0;
  nextStepTime = ctx.currentTime + 0.05;
  timerId = setInterval(tick, LOOKAHEAD_MS) as unknown as number;
}

function updateMix(): void {
  const ctx = getAudioContext();
  if (!ctx || !nodes) return;
  const now = ctx.currentTime;
  const calm = mood === 'menu';
  const effectiveIntensity = calm ? MENU_INTENSITY : intensity;

  nodes.bassGain.gain.setTargetAtTime(BASS_LEVEL, now, MIX_RAMP_TC);
  nodes.padGain.gain.setTargetAtTime(PAD_LEVEL, now, MIX_RAMP_TC);
  nodes.arpGain.gain.setTargetAtTime(calm ? 0 : ARP_LEVEL * (0.4 + effectiveIntensity * 0.6), now, MIX_RAMP_TC);
  nodes.percGain.gain.setTargetAtTime(!calm && percActive(effectiveIntensity) ? PERC_LEVEL : 0, now, MIX_RAMP_TC);
  nodes.bossGain.gain.setTargetAtTime(bossOn && !calm ? BOSS_LEVEL : 0, now, MIX_RAMP_TC);
}

// --- file stems -------------------------------------------------------------

/** Ramp a bus to silence over `fadeMs` and release it once it is inaudible. */
function fadeOutBus(ctx: AudioContext, bus: GainNode, fadeMs: number): void {
  bus.gain.cancelScheduledValues(ctx.currentTime);
  bus.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.01, Math.max(0, fadeMs) / 3000));
  setTimeout(() => bus.disconnect(), fadeMs + 50);
}

/**
 * Fetch and decode the mood's stems once. A stem that arrives (or fails)
 * re-enters `startMusic` for the mood still playing: on success its loop joins
 * the mix, on failure the mood falls back to the synth arrangement.
 */
function loadStems(tracks: readonly MusicTrack[]): void {
  for (const track of tracks) {
    const url = AUDIO.music[track];
    if (url === undefined || stemRequested.has(track)) continue;
    stemRequested.add(track);
    void fetch(url)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((bytes) => {
        const ctx = getAudioContext();
        if (!ctx) throw new Error('no audio context');
        return ctx.decodeAudioData(bytes);
      })
      .then((buffer) => {
        stemBuffers.set(track, buffer);
        if (mood !== null) startMusic(mood);
      })
      .catch((err: unknown) => {
        stemFailed.add(track);
        console.warn(`music: stem "${track}" (${url}) unavailable, synthesising instead`, err);
        if (mood !== null) startMusic(mood);
      });
  }
}

/**
 * Per-stem target level for the current mood: the menu loop plays flat, a
 * `game-low`/`game-high` pair crossfades on intensity, a lone game stem rides
 * its level, and any stem the mood does not use is released.
 */
function updateStemMix(): void {
  const ctx = getAudioContext();
  if (!ctx || !stems) return;
  const active = mood !== null ? moodStems(mood) : [];
  const solo = active.length === 1;
  const drive = bossOn ? Math.max(intensity, STEM_BOSS_DRIVE) : intensity;
  const mix = stemCrossfade(drive);

  for (const track of [...stems.gains.keys()]) {
    if (!active.includes(track)) {
      releaseStem(ctx, track);
      continue;
    }
    let level = 1;
    if (mood === 'run') level = solo ? soloStemLevel(drive) : (track === 'game-high' ? mix.high : mix.low);
    stems.gains.get(track)!.gain.setTargetAtTime(level, ctx.currentTime, MIX_RAMP_TC);
  }
}

/** Fade a stem out and drop its source; a returning mood creates a fresh one. */
function releaseStem(ctx: AudioContext, track: MusicTrack): void {
  const graph = stems;
  if (!graph) return;
  const gain = graph.gains.get(track);
  const source = graph.sources.get(track);
  graph.gains.delete(track);
  graph.sources.delete(track);
  if (!gain || !source) return;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setTargetAtTime(0, ctx.currentTime, MIX_RAMP_TC);
  source.stop(ctx.currentTime + MIX_RAMP_TC * 4);
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };
}

/**
 * Loop every already-decoded stem of `tracks` and assert the stem bus. Stems
 * still downloading simply join later (`loadStems` re-enters here); a stem
 * already looping is left alone, so re-asserting a mood never clicks or
 * restarts a loop mid-phrase.
 */
function startStems(ctx: AudioContext, tracks: readonly MusicTrack[]): void {
  if (!stems) {
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    stems = { master, gains: new Map(), sources: new Map() };
  }
  const graph = stems;
  for (const track of tracks) {
    const buffer = stemBuffers.get(track);
    if (!buffer || graph.sources.has(track)) continue;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(graph.master);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    graph.gains.set(track, gain);
    graph.sources.set(track, source);
  }
  graph.master.gain.setTargetAtTime(isMuted() ? 0 : STEM_MASTER_GAIN, ctx.currentTime, MIX_RAMP_TC);
  updateStemMix();
}

/** Hand the mood over to the stems: stop scheduling and fade the synth bus out. */
function stopSynth(ctx: AudioContext): void {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
  const graph = nodes;
  if (!graph) return;
  nodes = null;
  fadeOutBus(ctx, graph.master, 400);
}

/** Hand the mood back to the synth: release every loop and fade the stem bus out. */
function stopStems(ctx: AudioContext): void {
  const graph = stems;
  if (!graph) return;
  stems = null;
  for (const source of graph.sources.values()) source.stop(ctx.currentTime + MIX_RAMP_TC * 4);
  fadeOutBus(ctx, graph.master, 400);
}

/**
 * Start (or crossfade into) a mood. Idempotent: calling it again with the
 * same mood is a no-op beyond re-asserting the mix; switching mood ramps the
 * mix and master gain over `MIX_RAMP_TC` (~0.4s settle), never restarting
 * the scheduler or clicking.
 *
 * Plays the mood's registered file stems when it has any (see
 * `src/data/audio.ts`) and synthesises it otherwise — the template registry is
 * empty, so the synth path is the only one that runs there.
 */
export function startMusic(newMood: MusicMood): void {
  unlockAudio();
  const ctx = getAudioContext();
  if (!ctx) return;
  ensureMuteSubscription();
  mood = newMood;

  const tracks = moodStems(newMood);
  if (tracks.length > 0) {
    loadStems(tracks);
    stopSynth(ctx);
    startStems(ctx, tracks);
    return;
  }

  stopStems(ctx);
  const graph = ensureGraph(ctx);
  ensureScheduler(ctx);
  graph.master.gain.setTargetAtTime(isMuted() ? 0 : MASTER_GAIN, ctx.currentTime, MIX_RAMP_TC);
  updateMix();
}

/**
 * 0 (barely present) to 1 (full arrangement); ignored while mood is 'menu'.
 * On file stems this is the `game-low` -> `game-high` crossfade position.
 */
export function setMusicIntensity(value: number): void {
  intensity = Math.min(1, Math.max(0, value));
  if (stems) updateStemMix();
  updateMix();
}

/**
 * Toggle an additional layer on top of the current mood/intensity mix. File
 * stems carry no separate boss loop, so there the layer drives the crossfade
 * to near-peak instead.
 */
export function setMusicLayer(layer: MusicLayer, on: boolean): void {
  if (layer === 'boss') bossOn = on;
  if (stems) updateStemMix();
  updateMix();
}

/** Fade out and tear down both engines; releases every node. */
export function stopMusic(fadeMs = 400): void {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
  mood = null;
  const ctx = getAudioContext();
  const graph = nodes;
  const stemGraph = stems;
  nodes = null;
  stems = null;
  if (!ctx) return;

  if (graph) fadeOutBus(ctx, graph.master, fadeMs);
  if (stemGraph) {
    const stopAt = ctx.currentTime + Math.max(0, fadeMs) / 1000 + 0.05;
    for (const source of stemGraph.sources.values()) source.stop(stopAt);
    fadeOutBus(ctx, stemGraph.master, fadeMs);
  }
}

