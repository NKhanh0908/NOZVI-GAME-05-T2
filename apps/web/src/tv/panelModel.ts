import type { TvView } from './controls';

/** Shown under the URL field when the pasted text has no YouTube video id. */
export const INVALID_URL_MESSAGE = 'Not a YouTube link or video id.';

/** Seek bar range while the video length is unknown (seconds). */
const UNKNOWN_DURATION_RANGE_S = 600;

export type UrlFieldResult = { videoId: string } | { error: string };

/** REQ-TV-003: the URL field accepts what the provider can parse; anything else is an error. */
export function readUrlField(
  provider: { parseInput(text: string): string | null },
  text: string,
): UrlFieldResult {
  const videoId = text.trim() === '' ? null : provider.parseInput(text);
  return videoId === null ? { error: INVALID_URL_MESSAGE } : { videoId };
}

/** `m:ss`, or `h:mm:ss` from one hour; negative and non-finite values read as 0. */
export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Upper bound of the seek bar: the duration, or a range that always contains `time`. */
export function seekMax(view: Pick<TvView, 'time' | 'duration'>): number {
  if (view.duration !== null && view.duration > 0) return view.duration;
  return Math.max(UNKNOWN_DURATION_RANGE_S, Math.ceil(view.time) + 60);
}
