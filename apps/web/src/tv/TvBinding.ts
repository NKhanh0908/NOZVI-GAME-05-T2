import {
  BALANCE,
  MSG,
  SERVER_MSG,
  readTv,
  type TvCommand,
  type TvRateLimitedNotice,
  type TvSnapshot,
} from '@office/protocol';
import type { TvControls, TvView, TvViewSource } from './controls';
import type { TvPlayer } from './player';
import { VideoErrorLog, type TvVideoError } from './videoError';
import {
  ClockOffsetEstimator,
  DriftController,
  expectedTime,
  onBecameVisible,
  type PlayerCommand,
} from './sync';

/** How often the drift sync checks a playing TV (ms). */
export const TV_SYNC_INTERVAL_MS = 1000;

/** The replicated `tv` fields as decoded (`readTv` normalizes them). */
type TvFields = Parameters<typeof readTv>[0];
type TvState = { tv?: TvFields; employees?: { get(id: string): unknown } } | undefined;

type StateChange<S> = ((callback: (state: S) => void) => unknown) & {
  remove(callback: (state: S) => void): void;
};

/** The part of the joined room the TV uses; tests substitute a fake. */
export type TvRoom = {
  readonly sessionId: string;
  readonly state: TvState;
  send(type: typeof MSG.tv, cmd: TvCommand): void;
  onStateChange: StateChange<TvState>;
  onMessage(
    type: typeof SERVER_MSG.tvRateLimited,
    callback: (notice: TvRateLimitedNotice) => void,
  ): () => void;
};

export type TvBindingOptions = {
  /** Video length fallback when the player has no metadata (the fake player). */
  catalogDuration?: (videoId: string) => number | null;
  /** Local wall clock in epoch ms; the server offset is estimated against it. */
  now?: () => number;
  /** Periodic timer; returns a function that stops it. */
  every?: (ms: number, run: () => void) => () => void;
  /** Source of `visibilitychange`; null in tests that do not need it. */
  visibility?: Parameters<typeof onBecameVisible>[0] | null;
  /** Called when the server refuses a command for the rate limit. */
  onRateLimited?: (notice: TvRateLimitedNotice) => void;
};

const IDLE: TvSnapshot = {
  videoId: null,
  provider: 'youtube',
  status: 'idle',
  currentTime: 0,
  updatedAt: 0,
  controllerSessionId: null,
};

/** Identity of one server command: any new command changes at least one of these. */
const commandKey = (tv: TvSnapshot) => `${tv.updatedAt}|${tv.status}|${tv.videoId ?? ''}`;

/**
 * REQ-TV-004, REQ-TV-006: binds the room `tv` state to the local player and sends the
 * panel's commands to the room. Nothing changes the player until the server state arrives
 * (no optimistic control). On every new command the player loads, plays or pauses and
 * aligns to the server position (a late joiner seeks to it); while playing, the drift sync
 * checks once a second and on `visibilitychange`. `unmute` and the panel's Close are local.
 *
 * Clock offset (OQ-023): every fresh `updatedAt` seen after the first snapshot is a sample
 * for {@link ClockOffsetEstimator}; until then the local clock is taken as server time.
 *
 * Video end (OQ-022, T-1376): the controller's client reports it as a `pause` (the server
 * stamps the end position); other clients hold the last frame until that arrives. When no
 * controller is set (it left the room), every client that reaches the end reports it; the
 * server ignores a `pause` on a paused TV, so the first report wins. A client already
 * holding the end when the controller leaves reports it then.
 *
 * Video errors (REQ-TV-009): an `onError` from the local player marks the loaded video as
 * failed for this session. The player stops, the view carries the error while the shared
 * state still names that video, and the binding never loads it again; the shared state is
 * left alone, so other clients keep playing if their player can. Another video clears it.
 *
 * Player readiness (T-1405): the drift sync runs only while `player.isReady()` (the loaded
 * video has started), so the seconds the IFrame API needs to load never turn into nudges
 * and seeks against a stale position. A nudge rate the player does not support becomes a
 * seek to the expected position (seek-only fallback, T-1374).
 */
export class TvBinding implements TvControls, TvViewSource {
  private room: TvRoom | null = null;
  private unbindRoom: () => void = () => undefined;
  private tv: TvSnapshot = IDLE;
  private key: string | null = null;
  /** Video the binding loaded into the player (null: player left alone / stopped). */
  private loaded: string | null = null;
  /** Command key at which the local player reported the end of the video. */
  private endedAt: string | null = null;
  /** Commands are not sent before this local time (server rate-limit notice). */
  private blockedUntil = 0;
  readonly clock = new ClockOffsetEstimator();
  private readonly drift = new DriftController(this.clock);
  private readonly now: () => number;
  private readonly catalogDuration: (videoId: string) => number | null;
  private readonly onRateLimited: (notice: TvRateLimitedNotice) => void;
  private readonly cleanup: (() => void)[] = [];
  private readonly errors = new VideoErrorLog();
  private readonly errorListeners = new Set<(error: TvVideoError | null) => void>();
  /** Last error passed to the listeners (identity check avoids repeat calls). */
  private shownError: TvVideoError | null = null;

  constructor(
    private readonly player: TvPlayer,
    options: TvBindingOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.catalogDuration = options.catalogDuration ?? (() => null);
    this.onRateLimited =
      options.onRateLimited ??
      ((n) =>
        console.warn(`TV command limit reached; retry in ${Math.ceil(n.retryAfterMs / 1000)} s.`));
    const every =
      options.every ??
      ((ms, run) => {
        const timer = setInterval(run, ms);
        return () => clearInterval(timer);
      });
    this.cleanup.push(every(TV_SYNC_INTERVAL_MS, () => this.tick()));
    if (options.visibility) {
      this.cleanup.push(onBecameVisible(options.visibility, () => this.resync()));
    }
    this.cleanup.push(player.onEnded(() => this.ended()));
    this.cleanup.push(player.onError((code) => this.failed(code)));
  }

  /**
   * Binds to a joined or resumed room; the first server snapshot is applied at once.
   *
   * Colyseus resolves a join (and a reconnect) before the full state arrives, so the room
   * can still hold the schema defaults here. Those are not the server's state: until the
   * state names this session's employee (the server adds it before the join reply) the
   * binding waits, so the full state that follows counts as the first snapshot. Its old
   * `updatedAt` is never taken as a clock sample, which would make a late joiner's offset
   * lag the server by the age of the last command (and seek it that far behind).
   */
  attach(room: TvRoom): void {
    this.detach();
    this.room = room;
    let first = true;
    const onPatch = (state: TvState) => {
      if (!state?.tv) return;
      if (state.employees && state.employees.get(room.sessionId) === undefined) return;
      this.receive(readTv(state.tv), !first);
      first = false;
    };
    room.onStateChange(onPatch);
    const offNotice = room.onMessage(SERVER_MSG.tvRateLimited, (notice) => {
      this.blockedUntil = this.now() + Math.max(0, notice.retryAfterMs);
      this.onRateLimited(notice);
    });
    this.unbindRoom = () => {
      room.onStateChange.remove(onPatch);
      offNotice();
    };
    onPatch(room.state);
  }

  /** Stops listening to the room; playback follows the last known state. */
  detach(): void {
    this.unbindRoom();
    this.unbindRoom = () => undefined;
    this.room = null;
  }

  dispose(): void {
    this.detach();
    for (const off of this.cleanup.splice(0)) off();
    this.errorListeners.clear();
  }

  /** Error of the video the shared state names now, or null. */
  get error(): TvVideoError | null {
    return this.tv.status === 'idle' ? null : this.errors.get(this.tv.videoId);
  }

  /** Error recorded for `videoId` in this session, or null (the panel marks failed items). */
  errorFor(videoId: string): TvVideoError | null {
    return this.errors.get(videoId);
  }

  /** Called with the current video's error whenever it changes (null clears it). */
  onErrorChange(listener: (error: TvVideoError | null) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /** The last replicated state. */
  get snapshot(): TvSnapshot {
    return this.tv;
  }

  /** Position every client should show now, or null while idle. */
  expected(): number | null {
    return expectedTime(this.tv, this.clock.serverNow(this.now()));
  }

  // --- TvControls: everything but unmute goes to the room ---

  load(videoId: string): void {
    this.send({ type: 'load', videoId });
  }
  play(): void {
    if (this.tv.status !== 'idle') this.send({ type: 'play' });
  }
  pause(): void {
    if (this.tv.status !== 'idle') this.send({ type: 'pause' });
  }
  seek(time: number): void {
    if (this.tv.status === 'idle' || !Number.isFinite(time)) return;
    this.send({ type: 'seek', time: Math.max(0, time) });
  }
  stop(): void {
    if (this.tv.status !== 'idle') this.send({ type: 'stop' });
  }
  unmute(): void {
    this.player.unmute();
  }

  view(): TvView {
    const { videoId, status } = this.tv;
    if (videoId === null || status === 'idle') {
      return {
        videoId: null,
        status: 'idle',
        time: 0,
        duration: null,
        muted: this.player.isMuted(),
        error: null,
      };
    }
    return {
      videoId,
      status,
      time: this.loaded === videoId ? this.player.getTime() : (this.expected() ?? 0),
      duration: this.player.getDuration() ?? this.catalogDuration(videoId),
      muted: this.player.isMuted(),
      error: this.error,
    };
  }

  // --- room state to player ---

  /** One decoded snapshot; `fresh` marks patches after the first one of this room. */
  private receive(tv: TvSnapshot, fresh: boolean): void {
    const key = commandKey(tv);
    if (key === this.key) {
      // Not a new command, but the controller may have left (T-1376).
      const wasControlled = this.tv.controllerSessionId !== null;
      this.tv = tv;
      if (wasControlled && tv.controllerSessionId === null && this.endedAt === key) {
        this.reportEnd();
      }
      return;
    }
    if (fresh && tv.updatedAt > 0 && tv.updatedAt !== this.tv.updatedAt) {
      this.clock.addSample(tv.updatedAt, this.now());
    }
    this.key = key;
    this.tv = tv;
    this.apply();
    this.publishError();
  }

  private apply(): void {
    const tv = this.tv;
    const player = this.player;
    if (tv.videoId === null || tv.status === 'idle') {
      if (this.loaded !== null) {
        player.stop();
        player.setRate(1);
        this.loaded = null;
      }
      this.drift.resync(tv, { time: 0 }, this.now());
      return;
    }
    if (this.errors.has(tv.videoId)) {
      // A failed video is not loaded again in this session; the screen shows the error.
      this.unload();
      return;
    }
    const expected = this.expected() ?? 0;
    const loadedNow = this.loaded !== tv.videoId;
    if (loadedNow) {
      player.setRate(1);
      player.load(tv.videoId, expected);
      this.loaded = tv.videoId;
    }
    if (tv.status === 'playing') player.play();
    else player.pause();
    // A command is an explicit position: a paused TV shows exactly the paused frame, and a
    // playing one is aligned with a hard seek beyond the ignore band. A video loaded just
    // now already starts at `expected` (T-1405: no seek right after the cue).
    const off = Math.abs(player.getTime() - expected);
    if (!loadedNow && (tv.status === 'paused' ? off > 0 : off >= BALANCE.tv.ignoreBelowSeconds)) {
      player.seek(expected);
    }
    const cmd = this.drift.resync(tv, { time: player.getTime() }, this.now());
    // T-1405: until the video has started its position is not real; only a rate reset
    // passes (the next check after the start corrects any drift).
    if (player.isReady() || (cmd.kind === 'rate' && cmd.rate === 1)) this.run(cmd);
  }

  /** Periodic drift check while playing. */
  private tick(): void {
    if (!this.isFollowing()) return;
    this.run(this.drift.check(this.tv, { time: this.player.getTime() }, this.now()));
  }

  /** The tab became visible again: correct at once (timers were throttled while hidden). */
  private resync(): void {
    if (!this.isFollowing()) return;
    this.run(this.drift.resync(this.tv, { time: this.player.getTime() }, this.now()));
  }

  private isFollowing(): boolean {
    return (
      this.tv.status !== 'idle' &&
      this.loaded !== null &&
      this.loaded === this.tv.videoId &&
      this.endedAt !== this.key &&
      this.player.isReady()
    );
  }

  private run(cmd: PlayerCommand): void {
    if (cmd.kind === 'seek') this.player.seek(cmd.time);
    else if (cmd.kind === 'rate') {
      if (this.player.supportsRate(cmd.rate)) this.player.setRate(cmd.rate);
      else {
        // T-1405 / T-1374: the player does not offer the nudge rate; fall back to a seek.
        const expected = this.expected();
        if (expected !== null) this.player.seek(expected);
      }
    }
  }

  /** The local player reported an error for the loaded video. */
  private failed(code: number): void {
    const videoId = this.loaded;
    if (videoId === null) return;
    this.errors.report(videoId, code);
    this.unload();
    this.publishError();
  }

  private unload(): void {
    if (this.loaded === null) return;
    this.player.stop();
    this.player.setRate(1);
    this.loaded = null;
  }

  private publishError(): void {
    const error = this.error;
    if (error === this.shownError) return;
    this.shownError = error;
    for (const l of [...this.errorListeners]) l(error);
  }

  /**
   * The local player reached the end: hold the frame. The controller reports it, or any
   * client while no controller is set (T-1376).
   */
  private ended(): void {
    if (this.tv.status !== 'playing' || this.loaded !== this.tv.videoId) return;
    if (this.endedAt === this.key) return;
    this.endedAt = this.key;
    this.player.setRate(1);
    this.reportEnd();
  }

  private reportEnd(): void {
    if (this.tv.status !== 'playing' || !this.room) return;
    const controller = this.tv.controllerSessionId;
    if (controller === null || controller === this.room.sessionId) this.send({ type: 'pause' });
  }

  private send(cmd: TvCommand): void {
    const room = this.room;
    if (!room || this.now() < this.blockedUntil) return;
    try {
      room.send(MSG.tv, cmd);
    } catch (error) {
      // A closed socket drops the command; the state after a rejoin is the truth.
      console.warn('TV command not sent.', error);
    }
  }
}
