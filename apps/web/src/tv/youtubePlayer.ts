import { BALANCE } from '@office/protocol';
import { Listeners, type TvPlayer } from './player';
import { defaultTvLog, type TvLog } from './tvDebugLog';

export const YT_IFRAME_API_URL = 'https://www.youtube.com/iframe_api';
/** IFrame API `onStateChange` values. */
export const YT_STATE = {
  unstarted: -1,
  ended: 0,
  playing: 1,
  paused: 2,
  buffering: 3,
  cued: 5,
} as const;
/** A seek never targets the last this-many seconds of a known duration (T-1405). */
export const SEEK_END_MARGIN_SECONDS = 0.5;
/**
 * T-1568: error code the adapter reports when the IFrame API script fails to load or times
 * out. The API never uses it, so it maps to the `unknown` video error.
 */
export const IFRAME_API_LOAD_ERROR_CODE = -1;

/** The parts of a `YT.Player` the adapter uses. */
export type YtPlayer = {
  cueVideoById(args: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  stopVideo(): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number | undefined;
  getDuration(): number | undefined;
  /** Rates the current video supports (optional so older stubs still type-check). */
  getAvailablePlaybackRates?(): number[] | undefined;
  mute(): void;
  unMute(): void;
  destroy(): void;
};

export type YtPlayerOptions = {
  width: string;
  height: string;
  playerVars: Record<string, number | string>;
  events: {
    onReady: () => void;
    onError: (e: { data: number }) => void;
    onStateChange: (e: { data: number }) => void;
  };
};

export type YtNamespace = { Player: new (el: HTMLElement, opts: YtPlayerOptions) => YtPlayer };

/** The window fields the IFrame API uses (a test can pass a plain object). */
export type YtWindow = {
  YT?: Partial<YtNamespace>;
  onYouTubeIframeAPIReady?: (() => void) | undefined;
};

/** The script element fields the loader sets (a real `HTMLScriptElement` fits). */
export type YtScript = {
  src: string;
  async: boolean;
  onerror?: ((...args: never[]) => unknown) | null;
  remove?(): void;
};

/** The document calls the loader makes. */
export type YtDocument = {
  createElement(tag: 'script'): YtScript;
  head: { appendChild(node: unknown): unknown };
};

const pending = new WeakMap<object, Promise<YtNamespace>>();

/**
 * Loads the IFrame API script once per window and resolves with `YT` when it is ready.
 * An earlier `onYouTubeIframeAPIReady` handler is still called.
 *
 * T-1568: rejects when the script fails to load (blocked, offline) or YT is not ready
 * within `timeoutMs`. The failed attempt is forgotten (script removed, ready handler
 * restored), so the next call tries again.
 */
export function loadYouTubeIframeApi(
  win: YtWindow,
  doc: YtDocument,
  timeoutMs: number = BALANCE.tvPlayer.iframeApiTimeoutMs,
): Promise<YtNamespace> {
  if (win.YT?.Player) return Promise.resolve(win.YT as YtNamespace);
  const existing = pending.get(win);
  if (existing) return existing;
  const script = doc.createElement('script');
  const ready = new Promise<YtNamespace>((resolve, reject) => {
    const previous = win.onYouTubeIframeAPIReady;
    const handler = () => {
      clearTimeout(timer);
      previous?.();
      resolve(win.YT as YtNamespace);
    };
    const fail = (reason: string) => {
      clearTimeout(timer);
      script.onerror = null;
      if (pending.get(win) === ready) pending.delete(win);
      if (win.onYouTubeIframeAPIReady === handler) win.onYouTubeIframeAPIReady = previous;
      script.remove?.();
      reject(new Error(reason));
    };
    const timer = setTimeout(() => {
      if (win.YT?.Player) handler();
      else fail(`YouTube IFrame API not ready after ${timeoutMs} ms`);
    }, timeoutMs);
    win.onYouTubeIframeAPIReady = handler;
    script.onerror = () => fail('YouTube IFrame API script failed to load');
  });
  pending.set(win, ready);
  script.src = YT_IFRAME_API_URL;
  script.async = true;
  doc.head.appendChild(script);
  return ready;
}

type Command = (p: YtPlayer) => void;

/**
 * REQ-TV-001: the real player. The IFrame API script is loaded on the first `load`, not
 * when the game starts, so a TV nobody uses makes no request to youtube.com. The player
 * fills the TvScreen container (which keeps `pointer-events: none`) and starts muted
 * (plan §6.5). Calls made before the player is ready are queued in order.
 *
 * T-1405 (IFrame error 5 on a pasted video): only cue, play, pause, stop and mute reach
 * the IFrame player until the cued video has started (its first `playing` or `paused`
 * state). Until then a seek only moves the pending position (the latest one wins and is
 * applied once when the video starts) and a rate change is held. Seeks are clamped to
 * `[0, duration - SEEK_END_MARGIN_SECONDS]`, non-finite values are dropped, and a rate
 * the video does not list in `getAvailablePlaybackRates()` is refused (`supportsRate`).
 * In DEV builds every call and event goes to the TV debug log (`tvDebugLog.ts`).
 *
 * T-1568: at most `BALANCE.tvPlayer.playerQueueMax` commands wait for the player (the oldest is
 * dropped). If the IFrame API fails to load or times out, the queue is cleared and
 * `onError` reports {@link IFRAME_API_LOAD_ERROR_CODE}; the next `load` retries.
 */
export class YouTubeTvPlayer implements TvPlayer {
  readonly kind = 'youtube' as const;
  private player: YtPlayer | null = null;
  private creating = false;
  private queue: Command[] = [];
  private muted = true;
  private disposed = false;
  private lastTime = 0;
  /** The cued video has reported `playing` or `paused` since the last load / stop. */
  private started = false;
  private pendingSeek: number | null = null;
  /**
   * True from `load()` until the player reports `cued`. YouTube answers `playVideo` sent in
   * the same tick as `cueVideoById` with error 2 (T-1612), so a `play()` in this window is
   * held in `playOnCue` and sent once the video is cued.
   */
  private awaitingCue = false;
  private playOnCue = false;
  /** Rate the binding asked for, and the rate last sent to the IFrame player. */
  private wantedRate = 1;
  private sentRate = 1;
  private rates: number[] | null = null;
  private readonly errors = new Listeners<[number]>();
  private readonly ended = new Listeners<[]>();
  private readonly log: TvLog;

  constructor(
    private readonly container: HTMLElement,
    private readonly win: YtWindow = window as unknown as YtWindow,
    private readonly doc: YtDocument = document as unknown as YtDocument,
    log: TvLog | null = defaultTvLog(),
  ) {
    this.log = log ?? (() => undefined);
  }

  load(videoId: string, startAt: number): void {
    const startSeconds = Number.isFinite(startAt) ? Math.max(0, startAt) : 0;
    this.log('load', { videoId, startAt, startSeconds });
    this.started = false;
    this.pendingSeek = null;
    this.rates = null;
    this.lastTime = startSeconds;
    this.awaitingCue = true;
    this.playOnCue = false;
    this.ensurePlayer();
    this.run('cueVideoById', { videoId, startSeconds }, (p) =>
      p.cueVideoById({ videoId, startSeconds }),
    );
  }
  play(): void {
    this.log('play');
    if (this.awaitingCue) {
      this.playOnCue = true;
      this.log('play held until cued');
      return;
    }
    this.run('playVideo', undefined, (p) => p.playVideo());
  }
  pause(): void {
    this.log('pause');
    this.playOnCue = false;
    this.run('pauseVideo', undefined, (p) => p.pauseVideo());
  }
  seek(time: number): void {
    if (!Number.isFinite(time)) {
      this.log('seek dropped (not finite)', { time });
      return;
    }
    const target = this.clampSeek(time);
    this.lastTime = target;
    if (!this.started) {
      this.pendingSeek = target;
      this.log('seek held until the video starts', { time, target });
      return;
    }
    this.log('seek', { time, target });
    this.run('seekTo', { seconds: target, allowSeekAhead: true }, (p) => p.seekTo(target, true));
  }
  stop(): void {
    this.log('stop');
    this.awaitingCue = false;
    this.playOnCue = false;
    this.started = false;
    this.pendingSeek = null;
    this.lastTime = 0;
    this.run('stopVideo', undefined, (p) => p.stopVideo());
  }
  setRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0 || !this.supportsRate(rate)) {
      this.log('setRate refused', { rate, available: this.rates });
      return;
    }
    this.wantedRate = rate;
    if (!this.started) {
      this.log('setRate held until the video starts', { rate });
      return;
    }
    this.log('setRate', { rate });
    this.sendRate();
  }
  supportsRate(rate: number): boolean {
    if (rate === 1) return true;
    const rates = this.availableRates();
    return rates !== null && rates.some((r) => Math.abs(r - rate) < 1e-6);
  }
  isReady(): boolean {
    return this.player !== null && this.started;
  }
  getTime(): number {
    if (!this.isReady()) return this.lastTime;
    const t = this.player?.getCurrentTime();
    if (typeof t === 'number' && Number.isFinite(t)) this.lastTime = t;
    return this.lastTime;
  }
  getDuration(): number | null {
    const d = this.player?.getDuration();
    return typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : null;
  }
  mute(): void {
    this.muted = true;
    this.run('mute', undefined, (p) => p.mute());
  }
  unmute(): void {
    this.muted = false;
    this.run('unMute', undefined, (p) => p.unMute());
  }
  isMuted(): boolean {
    return this.muted;
  }
  /** Commands waiting for the IFrame player (tests check the queue stays bounded). */
  queuedCommands(): number {
    return this.queue.length;
  }
  onError(listener: (code: number) => void): () => void {
    return this.errors.add(listener);
  }
  onEnded(listener: () => void): () => void {
    return this.ended.add(listener);
  }
  dispose(): void {
    this.log('dispose');
    this.disposed = true;
    this.queue = [];
    this.errors.clear();
    this.ended.clear();
    this.player?.destroy();
    this.player = null;
    this.container.replaceChildren();
  }

  /** Runs `command` now, or queues it until the player is ready; logs the IFrame call. */
  private run(name: string, args: unknown, command: Command): void {
    if (this.disposed) return;
    const call = (p: YtPlayer) => {
      this.log(`yt.${name}`, args);
      command(p);
    };
    if (this.player) call(this.player);
    else {
      this.queue.push(call);
      const over = this.queue.length - BALANCE.tvPlayer.playerQueueMax;
      if (over > 0) this.queue.splice(0, over);
    }
  }

  private clampSeek(time: number): number {
    const duration = this.getDuration();
    const max = duration === null ? Infinity : Math.max(0, duration - SEEK_END_MARGIN_SECONDS);
    return Math.min(Math.max(0, time), max);
  }

  private availableRates(): number[] | null {
    if (this.rates === null && this.player && this.started) {
      const rates = this.player.getAvailablePlaybackRates?.();
      if (Array.isArray(rates) && rates.length > 0) this.rates = rates;
    }
    return this.rates;
  }

  private sendRate(): void {
    const rate = this.wantedRate;
    if (rate === this.sentRate) return;
    this.sentRate = rate;
    this.run('setPlaybackRate', { rate }, (p) => p.setPlaybackRate(rate));
  }

  /** The cued video reached `playing` or `paused`: apply what was held back. */
  private onStarted(player: YtPlayer): void {
    this.started = true;
    this.log('video started', {
      duration: player.getDuration(),
      availablePlaybackRates: this.availableRates(),
      currentTime: player.getCurrentTime(),
    });
    if (!this.supportsRate(this.wantedRate)) this.wantedRate = 1;
    this.sendRate();
    const seek = this.pendingSeek;
    this.pendingSeek = null;
    if (seek !== null) this.seek(seek);
  }

  private ensurePlayer(): void {
    if (this.creating || this.player || this.disposed) return;
    this.creating = true;
    this.log('loading IFrame API');
    loadYouTubeIframeApi(this.win, this.doc).then(
      (YT) => this.createPlayer(YT),
      (error: unknown) => this.apiFailed(error),
    );
  }

  /** T-1568: the IFrame API did not load; report it for the loaded video and allow a retry. */
  private apiFailed(error: unknown): void {
    this.creating = false;
    if (this.disposed) return;
    this.queue = [];
    this.log('IFrame API failed', { error: String(error) });
    this.errors.emit(IFRAME_API_LOAD_ERROR_CODE);
  }

  private createPlayer(YT: YtNamespace): void {
    if (this.disposed) return;
    const ownerDoc = this.container.ownerDocument;
    const mountPoint = ownerDoc.createElement('div');
    this.container.appendChild(mountPoint);
    const playerVars: Record<string, number | string> = {
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      enablejsapi: 1,
      fs: 0,
      mute: 1,
      playsinline: 1,
      rel: 0,
    };
    // Player parameters doc: IFrame API users should always pass their domain as origin.
    const origin = ownerDoc.defaultView?.location?.origin;
    if (origin && origin !== 'null') playerVars.origin = origin;
    const rect = this.container.getBoundingClientRect?.();
    this.log('create YT.Player', {
      playerVars,
      container: { width: this.container.offsetWidth, height: this.container.offsetHeight },
      onScreen: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
    });
    const player = new YT.Player(mountPoint, {
      width: '100%',
      height: '100%',
      playerVars,
      events: {
        onReady: () => {
          this.log('onReady', { queued: this.queue.length });
          if (this.disposed) return;
          this.player = player;
          if (this.muted) player.mute();
          else player.unMute();
          const queued = this.queue;
          this.queue = [];
          for (const command of queued) command(player);
        },
        onError: (e) => {
          this.log('onError', {
            code: e.data,
            currentTime: player.getCurrentTime?.(),
            duration: player.getDuration?.(),
          });
          this.errors.emit(e.data);
        },
        onStateChange: (e) => {
          this.log('onStateChange', { state: e.data, name: stateName(e.data) });
          if (this.disposed || this.player !== player) return;
          if (e.data === YT_STATE.ended) this.ended.emit();
          if (e.data === YT_STATE.cued && this.awaitingCue) {
            this.awaitingCue = false;
            if (this.playOnCue) {
              this.playOnCue = false;
              this.log('play after cued');
              player.playVideo();
            }
          }
          const startedNow = e.data === YT_STATE.playing || e.data === YT_STATE.paused;
          if (startedNow && !this.started) this.onStarted(player);
        },
      },
    });
  }
}

function stateName(state: number): string {
  const entry = Object.entries(YT_STATE).find(([, v]) => v === state);
  return entry ? entry[0] : 'unknown';
}

/**
 * Picks the player: the fake one when the build sets `VITE_TV_PLAYER=fake` (Playwright
 * does), the YouTube one otherwise.
 */
export function tvPlayerKind(env: { VITE_TV_PLAYER?: string | undefined }): 'youtube' | 'fake' {
  return env.VITE_TV_PLAYER === 'fake' ? 'fake' : 'youtube';
}
