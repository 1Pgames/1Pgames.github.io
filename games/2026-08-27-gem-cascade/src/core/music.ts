import { getAudioContext, isMuted, onMuteChange, unlockAudio } from './audio';

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
 * Do NOT: load audio files (this stays a zero-asset module), or schedule
 * anything from `update`/`requestAnimationFrame` — the lookahead timer is the
 * only clock. Do NOT reference `window`/`AudioContext` at module scope; the
 * context is created lazily by `core/audio.ts` on the first user gesture, so
 * importing this module in a non-browser environment (Node, tests) is safe.
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

interface MusicNodes {
  master: GainNode;
  bassGain: GainNode;
  padGain: GainNode;
  arpGain: GainNode;
  percGain: GainNode;
  bossGain: GainNode;
  percBuffer: AudioBuffer;
}

let nodes: MusicNodes | null = null;
let mood: MusicMood | null = null;
let intensity = 0.3;
let bossOn = false;
let timerId: number | null = null;
let nextStepTime = 0;
let currentStep = 0;
let muteSubscribed = false;

function ensureMuteSubscription(): void {
  if (muteSubscribed) return;
  muteSubscribed = true;
  onMuteChange((mutedNow) => {
    const ctx = getAudioContext();
    if (!ctx || !nodes) return;
    nodes.master.gain.setTargetAtTime(mutedNow || mood === null ? 0 : MASTER_GAIN, ctx.currentTime, 0.02);
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

/**
 * Start (or crossfade into) a mood. Idempotent: calling it again with the
 * same mood is a no-op beyond re-asserting the mix; switching mood ramps the
 * mix and master gain over `MIX_RAMP_TC` (~0.4s settle), never restarting
 * the scheduler or clicking.
 */
export function startMusic(newMood: MusicMood): void {
  unlockAudio();
  const ctx = getAudioContext();
  if (!ctx) return;
  ensureMuteSubscription();
  const graph = ensureGraph(ctx);
  mood = newMood;
  ensureScheduler(ctx);
  graph.master.gain.setTargetAtTime(isMuted() ? 0 : MASTER_GAIN, ctx.currentTime, MIX_RAMP_TC);
  updateMix();
}

/** 0 (barely present) to 1 (full arrangement); ignored while mood is 'menu'. */
export function setMusicIntensity(value: number): void {
  intensity = Math.min(1, Math.max(0, value));
  updateMix();
}

/** Toggle an additional layer on top of the current mood/intensity mix. */
export function setMusicLayer(layer: MusicLayer, on: boolean): void {
  if (layer === 'boss') bossOn = on;
  updateMix();
}

/** Fade out and tear down the scheduler/graph; releases every node. */
export function stopMusic(fadeMs = 400): void {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
  mood = null;
  const ctx = getAudioContext();
  const graph = nodes;
  nodes = null;
  if (!ctx || !graph) return;

  const fadeSeconds = Math.max(0, fadeMs) / 1000;
  graph.master.gain.cancelScheduledValues(ctx.currentTime);
  graph.master.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.01, fadeSeconds / 3));
  setTimeout(() => graph.master.disconnect(), fadeMs + 50);
}
