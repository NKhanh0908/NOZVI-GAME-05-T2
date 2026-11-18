/**
 * T-1405: DEV-only TV debug log. Every YouTube adapter call, IFrame API event, error code,
 * available playback rate list and duration is appended to `window.__tvLog` and printed
 * with `console.debug('[tv]', ...)`, so the owner can copy the sequence that led to a
 * player error (`copy(JSON.stringify(window.__tvLog, null, 1))` in the devtools console).
 * Production builds get no log (`import.meta.env.DEV` is false there).
 */

export type TvLogEntry = {
  /** Milliseconds since the page started (`performance.now()`), rounded. */
  t: number;
  event: string;
  data?: unknown;
};

export type TvLog = (event: string, data?: unknown) => void;

/** The window field the log writes to (a test can pass a plain object). */
export type TvLogTarget = { __tvLog?: TvLogEntry[] };

/** Oldest entries are dropped beyond this many (a drift loop logs about once a second). */
export const TV_LOG_MAX_ENTRIES = 1000;

export function createTvDebugLog(
  target: TvLogTarget,
  out: Pick<Console, 'debug'> = console,
  now: () => number = () => performance.now(),
): TvLog {
  return (event, data) => {
    const entries = (target.__tvLog ??= []);
    const entry: TvLogEntry = { t: Math.round(now()), event };
    if (data !== undefined) entry.data = data;
    entries.push(entry);
    if (entries.length > TV_LOG_MAX_ENTRIES) entries.splice(0, entries.length - TV_LOG_MAX_ENTRIES);
    if (data === undefined) out.debug('[tv]', event);
    else out.debug('[tv]', event, data);
  };
}

/** The log for this build: on in `pnpm dev` (DEV) in a browser, null otherwise. */
export function defaultTvLog(dev: boolean = import.meta.env.DEV): TvLog | null {
  if (!dev || typeof window === 'undefined') return null;
  return createTvDebugLog(window as unknown as TvLogTarget);
}
