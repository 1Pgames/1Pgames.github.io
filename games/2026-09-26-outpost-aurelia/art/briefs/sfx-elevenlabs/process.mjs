// Step 1d SFX pipeline for Outpost Aurelia (game-art skill). Run from the game root:
//   node art/briefs/sfx-elevenlabs/process.mjs
// Input: raw/<voice>/*.mp3 (ElevenLabs text-to-sound-effects, one file per dir).
// Output: public/assets/audio/sfx/<voice>.ogg, sfx/options/<voice>-<A..C>.ogg, results.json.
// Loudness target per voice = the max momentary loudness (EBU R128 M) of that voice's
// synth fallback, rendered here from the VOICES table in src/core/audio.ts at volume 1.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const SR = 44100;
const HERE = 'art/briefs/sfx-elevenlabs';
const OUT = 'public/assets/audio/sfx';
/** Signature voices: options A..C are generated from different prompts; the key is the shipped default. */
const SIGNATURE_DEFAULT = { dusk: 'A', lander: 'A', launch: 'A' };

// ── synth reference: VOICES + prd() lifted verbatim from core/audio.ts ──
const require = createRequire(import.meta.url);
const ts = require('typescript');
const src = readFileSync('src/core/audio.ts', 'utf8');
const from = src.indexOf('function prd(');
const to = src.indexOf('} as const satisfies Record<string, Voice>;');
if (from < 0 || to < 0) throw new Error('VOICES table not found in src/core/audio.ts');
const snippet = `type Wave = OscillatorType | 'noise'; type Layer = any; ${src.slice(from, to)}}; return VOICES;`;
const VOICES = new Function(ts.transpileModule(snippet, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)();

function renderSynth(voice) {
  const len = Math.ceil(Math.max(...voice.layers.map((l) => (l.delay ?? 0) + l.attack + l.decay)) * SR) + 1;
  const out = new Float32Array(len);
  for (const l of voice.layers) {
    const s0 = Math.round((l.delay ?? 0) * SR);
    const aN = Math.max(1, Math.round(l.attack * SR));
    const total = Math.max(aN + 1, Math.round((l.attack + l.decay) * SR));
    const exp = (a, b, u) => a * (b / a) ** u;
    const env = (i) => (i < aN ? exp(0.0001, l.gain, i / aN) : exp(l.gain, 0.0001, (i - aN) / (total - aN)));
    if (l.wave === 'noise') {
      const q = l.q ?? 1;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      const c0 = l.cutoff ?? l.freq;
      const c1 = l.cutoffEnd ?? c0;
      for (let i = 0; i < total; i += 1) {
        const fc = Math.min(SR / 2 - 1, exp(c0, Math.max(40, c1), i / total));
        const w0 = (2 * Math.PI * fc) / SR;
        const alpha = Math.sin(w0) / (2 * q);
        const a0 = 1 + alpha;
        const x = Math.random() * 2 - 1;
        const y = (alpha * x - alpha * x2 + 2 * Math.cos(w0) * y1 - (1 - alpha) * y2) / a0;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        out[s0 + i] += y * env(i);
      }
      continue;
    }
    for (const cents of l.detune !== undefined ? [0, l.detune] : [0]) {
      let phase = 0;
      const k = 2 ** (cents / 1200);
      for (let i = 0; i < total; i += 1) {
        const f = (l.freqEnd !== undefined ? exp(l.freq, Math.max(20, l.freqEnd), i / total) : l.freq) * k;
        phase = (phase + f / SR) % 1;
        const w =
          l.wave === 'sine' ? Math.sin(2 * Math.PI * phase)
          : l.wave === 'square' ? (phase < 0.5 ? 1 : -1)
          : l.wave === 'sawtooth' ? 2 * phase - 1
          : 1 - 4 * Math.abs(phase - 0.5);
        out[s0 + i] += w * env(i);
      }
    }
  }
  return out;
}

// ── ffmpeg helpers ──
function ff(args, input) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { input, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${r.stderr}`);
  return r;
}
const decode = (file) => {
  const b = ff(['-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']).stdout;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
/** Max momentary loudness (LUFS) and true peak (dBTP), 0.5 s of silence padded so short files fill a 400 ms window. */
function measure(pcm) {
  const r = ff(['-v', 'verbose', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-af', 'apad=pad_dur=0.5,ebur128=peak=true:framelog=verbose', '-f', 'null', '-'], Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  const err = r.stderr.toString();
  const ms = [...err.matchAll(/ M:\s*(-?[\d.]+|-inf)/g)].map((m) => Number(m[1])).filter(Number.isFinite);
  const peak = Number(/True peak:\s*Peak:\s*(-?[\d.]+|-inf)/.exec(err)?.[1] ?? NaN);
  return { maxM: Math.max(...ms), peak };
}
const r1 = (v) => Math.round(v * 10) / 10;

function trim(pcm) {
  const th = 10 ** (-50 / 20);
  let a = 0;
  while (a < pcm.length && Math.abs(pcm[a]) <= th) a += 1;
  let b = pcm.length - 1;
  while (b > a && Math.abs(pcm[b]) <= th) b -= 1;
  const out = pcm.slice(Math.max(0, a - Math.round(0.005 * SR)), b + 1);
  const fade = Math.min(out.length, Math.round(0.02 * SR));
  for (let i = 0; i < fade; i += 1) out[out.length - fade + i] *= 1 - (i + 1) / fade;
  return out;
}

function processOne(voiceName, rawFile, outFile) {
  const raw = decode(rawFile);
  const rawM = measure(raw);
  const synthM = measure(renderSynth(VOICES[voiceName])).maxM;
  const trimmed = trim(raw);
  const pre = measure(trimmed);
  const want = synthM - pre.maxM;
  let gainDb = Math.min(want, -1 - pre.peak);
  let shipped;
  let sm;
  // Vorbis can overshoot the pre-encode true peak by ~1 dB: pull the gain down and re-encode until ≤ −1 dBTP.
  for (let pass = 0; pass < 3; pass += 1) {
    const g = 10 ** (gainDb / 20);
    const pcm = trimmed.map((v) => v * g);
    ff(['-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-c:a', 'libvorbis', '-q:a', '3', outFile], Buffer.from(pcm.buffer));
    shipped = decode(outFile);
    sm = measure(shipped);
    if (sm.peak <= -1) break;
    gainDb -= sm.peak + 1 + 0.1;
  }
  return {
    voice: voiceName,
    rawSec: Math.round((raw.length / SR) * 100) / 100,
    shippedSec: Math.round((shipped.length / SR) * 100) / 100,
    rawMaxM: r1(rawM.maxM), rawPeak: r1(rawM.peak), synthMaxM: r1(synthM),
    gainDb: r1(gainDb), capped: gainDb < want - 0.05, withheldDb: r1(want - gainDb),
    shippedMaxM: r1(sm.maxM), shippedPeak: r1(sm.peak),
    kb: r1(statSync(outFile).size / 1024),
  };
}

mkdirSync(join(OUT, 'options'), { recursive: true });
const results = [];
for (const dir of readdirSync(join(HERE, 'raw')).sort()) {
  if (dir === 'music') continue;
  const files = readdirSync(join(HERE, 'raw', dir)).filter((f) => f.endsWith('.mp3'));
  if (files.length !== 1) throw new Error(`raw/${dir}: expected one mp3, found ${files.length}`);
  const rawFile = join(HERE, 'raw', dir, files[0]);
  const [voice, opt] = dir.split('-');
  if (!(voice in VOICES)) throw new Error(`raw/${dir}: no voice "${voice}" in core/audio.ts`);
  const outFile = opt ? join(OUT, 'options', `${dir}.ogg`) : join(OUT, `${voice}.ogg`);
  const res = processOne(voice, rawFile, outFile);
  res.id = dir;
  res.file = outFile;
  if (opt && SIGNATURE_DEFAULT[voice] === opt) copyFileSync(outFile, join(OUT, `${voice}.ogg`));
  results.push(res);
  console.log(JSON.stringify(res));
}
writeFileSync(join(HERE, 'results.json'), JSON.stringify(results, null, 2) + '\n');
