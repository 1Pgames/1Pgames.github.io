/**
 * Store-preview capture — records the LIVE game canvas into
 * `games/<slug>/shots/preview.webm`, the autoplaying muted loop on the store
 * page (`build-site.mjs` picks it up automatically; release-check treats it
 * as optional). No ffmpeg, no frame stitching: the page's own MediaRecorder
 * encodes `canvas.captureStream()` in-process.
 *
 * Like `cert-driver.mjs`, this is NOT a CLI. It runs inside the `xd://browser`
 * tool's `run` sandbox, where a live puppeteer `tab` for the game and Node fs
 * access coexist. Two-phase API so the CALLER drives the game between start
 * and finish — record the §13 highlight beats (a cascade, a level-up burst, a
 * win banner), not idle menus:
 *
 *   const mod = await import(`file://<repo>/scripts/preview-capture.mjs`);
 *   await mod.startPreview({ tab });                 // begins recording
 *   ...drive ~10-15s of real gameplay with tab/page...
 *   const out = await mod.finishPreview({ tab, gameDir: '<repo>/games/<slug>' });
 *   display(out);                                    // { path, bytes, seconds }
 *
 * Or the one-call form when a driver callback is handy:
 *
 *   const out = await mod.recordPreview({ tab, gameDir, seconds: 12,
 *     drive: async () => { ...input... } });
 *
 * The recording captures the canvas' internal 720x1280 at ~30fps / 2.5Mbps —
 * a 12s clip lands around 3-4MB. A page without MediaRecorder support (never
 * the bundled Chromium) rejects with a clear error instead of writing junk.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Starts an in-page MediaRecorder over the game canvas. */
export async function startPreview({ tab, fps = 30, bitsPerSecond = 2_500_000 }) {
  const mime = await tab.evaluate(
    ({ fps, bitsPerSecond }) => {
      const canvas = document.querySelector('canvas');
      if (!canvas) throw new Error('preview: no canvas element on the page');
      if (typeof MediaRecorder === 'undefined') throw new Error('preview: MediaRecorder unsupported');
      if (window.__PREVIEW__) throw new Error('preview: a recording is already running');
      const mime =
        ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
          MediaRecorder.isTypeSupported(m),
        ) ?? '';
      const recorder = new MediaRecorder(canvas.captureStream(fps), {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: bitsPerSecond,
      });
      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.start(250);
      window.__PREVIEW__ = { recorder, chunks, startedAt: performance.now(), mime };
      return mime || 'video/webm (default)';
    },
    { fps, bitsPerSecond },
  );
  return { mime };
}

/** Stops the recorder, pulls the encoded webm out of the page, writes it. */
export async function finishPreview({ tab, gameDir, fileName = 'preview.webm' }) {
  const result = await tab.evaluate(async () => {
    const P = window.__PREVIEW__;
    if (!P) throw new Error('preview: no recording in progress (startPreview first)');
    delete window.__PREVIEW__;
    await new Promise((resolve) => {
      P.recorder.onstop = resolve;
      P.recorder.stop();
    });
    const blob = new Blob(P.chunks, P.mime ? { type: P.mime } : undefined);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Chunked btoa: String.fromCharCode over the whole buffer blows the arg
    // limit on multi-MB clips.
    let bin = '';
    const STEP = 0x8000;
    for (let i = 0; i < bytes.length; i += STEP) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
    }
    return { b64: btoa(bin), ms: performance.now() - P.startedAt };
  });

  const buf = Buffer.from(result.b64, 'base64');
  // EBML magic — anything else means the encoder produced junk, and junk on
  // the store page is worse than no preview at all.
  if (buf.length < 4 || buf.readUInt32BE(0) !== 0x1a45dfa3) {
    throw new Error(`preview: output is not a webm container (${buf.length} bytes)`);
  }
  const dir = path.join(gameDir, 'shots');
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, fileName);
  writeFileSync(out, buf);
  return { path: out, bytes: buf.length, seconds: Math.round(result.ms / 100) / 10 };
}

/** One-call form: start, let `drive` play the game (or just wait), finish. */
export async function recordPreview({ tab, gameDir, seconds = 12, fps = 30, drive }) {
  await startPreview({ tab, fps });
  const deadline = new Promise((r) => setTimeout(r, seconds * 1000));
  if (drive) await Promise.all([drive(), deadline]);
  else await deadline;
  return finishPreview({ tab, gameDir });
}
