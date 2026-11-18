import { BALANCE, type TvSnapshot } from '@office/protocol';

/** REQ-TV-006: what the local player should do to follow the shared TV. */
export type SyncAction =
  | { kind: 'none' }
  /** Play at this rate for `seconds`, then return to 1. */
  | { kind: 'nudge'; rate: number; seconds: number }
  | { kind: 'seek'; time: number };

/** The `BALANCE.tv` values the drift logic reads (widened so tests can vary them). */
export type DriftBands = Record<
  'ignoreBelowSeconds' | 'hardSeekAboveSeconds' | 'nudgeRate' | 'nudgeMaxSeconds',
  number
>;

/**
 * REQ-TV-006: the video position every client should show at server time `serverNowMs`
 * (epoch ms), or null when the TV is idle. A paused TV stays at its paused frame.
 */
export function expectedTime(tv: TvSnapshot, serverNowMs: number): number | null {
  if (tv.status === 'idle' || tv.videoId === null) return null;
  if (tv.status === 'paused') return tv.currentTime;
  return tv.currentTime + Math.max(0, serverNowMs - tv.updatedAt) / 1000;
}

/**
 * REQ-TV-006: drift bands. Below 0.5 s nothing happens; 0.5 s to 1 s (both inclusive)
 * plays 5 % slower when ahead or faster when behind, for long enough to close the gap but
 * at most 2 s; above 1 s seeks straight to the expected time (T-1375).
 */
export function decide(
  expected: number,
  actual: number,
  bands: DriftBands = BALANCE.tv,
): SyncAction {
  const drift = actual - expected;
  const size = Math.abs(drift);
  if (size < bands.ignoreBelowSeconds) return { kind: 'none' };
  if (size > bands.hardSeekAboveSeconds) return { kind: 'seek', time: expected };
  const rate = drift > 0 ? 1 - bands.nudgeRate : 1 + bands.nudgeRate;
  const seconds = Math.min(bands.nudgeMaxSeconds, size / bands.nudgeRate);
  return { kind: 'nudge', rate, seconds };
}

/**
 * OQ-023: estimates `server epoch ms - local ms` from `updatedAt` values and the local time
 * each one arrived. A stamp is always older than its arrival, so every sample is a lower
 * bound of the true offset; the largest recent sample is the tightest one.
 */
export class ClockOffsetEstimator {
  private readonly samples: number[] = [];

  constructor(private readonly maxSamples = 20) {}

  /** Feed only fresh stamps (an `updatedAt` that changed), with the local receive time. */
  addSample(serverStampMs: number, localReceiveMs: number): void {
    this.samples.push(serverStampMs - localReceiveMs);
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  /** Current estimate in ms; 0 before the first sample. */
  get offsetMs(): number {
    return this.samples.length === 0 ? 0 : Math.max(...this.samples);
  }

  serverNow(localNowMs: number): number {
    return localNowMs + this.offsetMs;
  }
}

/** Player position as reported by the player adapter. */
export type PlayerReading = { time: number };

/** What the binding applies to the player after a check. */
export type PlayerCommand =
  { kind: 'none' } | { kind: 'rate'; rate: number } | { kind: 'seek'; time: number };

/**
 * REQ-TV-006: turns periodic checks into player commands. A nudge holds until its time
 * runs out and then restores rate 1; during a nudge only a hard seek interrupts it.
 */
export class DriftController {
  private nudgeUntilMs: number | null = null;

  constructor(
    readonly clock: ClockOffsetEstimator,
    private readonly bands: DriftBands = BALANCE.tv,
  ) {}

  get nudging(): boolean {
    return this.nudgeUntilMs !== null;
  }

  /** One periodic check at local time `localNowMs`. */
  check(tv: TvSnapshot, reading: PlayerReading, localNowMs: number): PlayerCommand {
    const expected = expectedTime(tv, this.clock.serverNow(localNowMs));
    if (expected === null || tv.status !== 'playing') {
      return this.endNudge() ?? this.pausedCommand(expected, reading.time);
    }
    const action = decide(expected, reading.time, this.bands);
    if (action.kind === 'seek') {
      this.nudgeUntilMs = null;
      return { kind: 'seek', time: action.time };
    }
    if (this.nudgeUntilMs !== null) {
      if (localNowMs < this.nudgeUntilMs) return { kind: 'none' };
      return this.endNudge()!;
    }
    if (action.kind === 'nudge') {
      this.nudgeUntilMs = localNowMs + action.seconds * 1000;
      return { kind: 'rate', rate: action.rate };
    }
    return { kind: 'none' };
  }

  /**
   * Forces an immediate decision (tab visible again, new state): any running nudge is
   * dropped first, so the result reflects the current drift only.
   */
  resync(tv: TvSnapshot, reading: PlayerReading, localNowMs: number): PlayerCommand {
    const wasNudging = this.nudgeUntilMs !== null;
    this.nudgeUntilMs = null;
    const cmd = this.check(tv, reading, localNowMs);
    if (cmd.kind === 'none' && wasNudging) return { kind: 'rate', rate: 1 };
    return cmd;
  }

  private endNudge(): PlayerCommand | null {
    if (this.nudgeUntilMs === null) return null;
    this.nudgeUntilMs = null;
    return { kind: 'rate', rate: 1 };
  }

  /** Paused: hold the paused frame; correct only a visible difference. */
  private pausedCommand(expected: number | null, actual: number): PlayerCommand {
    if (expected === null) return { kind: 'none' };
    return Math.abs(actual - expected) >= this.bands.ignoreBelowSeconds
      ? { kind: 'seek', time: expected }
      : { kind: 'none' };
  }
}

type VisibilitySource = Pick<
  Document,
  'visibilityState' | 'addEventListener' | 'removeEventListener'
>;

/**
 * REQ-TV-006: calls `onVisible` when the page becomes visible again (a hidden tab's timers
 * are throttled, so the player may be far off). Returns an unsubscribe function.
 */
export function onBecameVisible(source: VisibilitySource, onVisible: () => void): () => void {
  const handler = () => {
    if (source.visibilityState === 'visible') onVisible();
  };
  source.addEventListener('visibilitychange', handler);
  return () => source.removeEventListener('visibilitychange', handler);
}
