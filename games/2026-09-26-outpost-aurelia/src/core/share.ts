import { dailyDay, isDailyMode } from './daily';
import { track } from './telemetry';

/**
 * "Beat my score" sharing from the results screen. Uses the native share sheet
 * where it exists (Android/iOS browsers, installed PWAs), falls back to the
 * clipboard on desktop, and reports 'unavailable' when neither is permitted so
 * the caller can leave its button silent instead of lying.
 *
 * In daily mode the shared URL carries `?d=<day>`, which `core/daily.ts` reads
 * at import: the receiver gets the exact run the sender played.
 */
export type ShareOutcome = 'shared' | 'copied' | 'unavailable';

export async function shareResult(opts: { score: string; won: boolean }): Promise<ShareOutcome> {
  track('share');

  const title = document.title.trim().length > 0 ? document.title.trim() : 'this game';
  const url = shareUrl();
  const brag = opts.won
    ? `Cleared ${title} — ${opts.score}. Can you beat it?`
    : `Scored ${opts.score} in ${title}. Can you beat it?`;

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text: brag, url });
      return 'shared';
    } catch (err) {
      // A dismissed share sheet is a decision, not a failure — silently
      // copying instead would flash a "COPIED!" the player never asked for.
      if (err instanceof Error && err.name === 'AbortError') return 'shared';
    }
  }

  try {
    await navigator.clipboard.writeText(`${brag}\n${url}`);
    return 'copied';
  } catch {
    return 'unavailable';
  }
}

/** Canonical page URL, stripped of the query/hash this visit happened to have. */
function shareUrl(): string {
  if (typeof location === 'undefined') return '';
  const base = location.origin + location.pathname;
  return isDailyMode() ? `${base}?d=${dailyDay()}` : base;
}
