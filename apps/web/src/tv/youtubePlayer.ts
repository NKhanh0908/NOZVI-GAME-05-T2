import { Listeners, type TvPlayer } from './player';

export const YT_IFRAME_API_URL = 'https://www.youtube.com/iframe_api';
/** IFrame API `onStateChange` value for the end of a video. */
const YT_ENDED = 0;

/** The parts of a `YT.Player` the adapter uses. */
export type YtPlayer = {
  cueVideoById(args: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  stopVideo(): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number | undefined;
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

/** The document calls the loader makes. */
export type YtDocument = {
  createElement(tag: 'script'): { src: string; async: boolean };
  head: { appendChild(node: unknown): unknown };
};

const pending = new WeakMap<object, Promise<YtNamespace>>();

/**
 * Loads the IFrame API script once per window and resolves with `YT` when it is ready.
 * An earlier `onYouTubeIframeAPIReady` handler is still called.
 */
export function loadYouTubeIframeApi(win: YtWindow, doc: YtDocument): Promise<YtNamespace> {
  if (win.YT?.Player) return Promise.resolve(win.YT as YtNamespace);
  const existing = pending.get(win);
  if (existing) return existing;
  const ready = new Promise<YtNamespace>((resolve) => {
    const previous = win.onYouTubeIframeAPIReady;
    win.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(win.YT as YtNamespace);
    };
  });
  pending.set(win, ready);
  const script = doc.createElement('script');
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
 */
export class YouTubeTvPlayer implements TvPlayer {
  readonly kind = 'youtube' as const;
  private player: YtPlayer | null = null;
  private creating = false;
  private queue: Command[] = [];
  private muted = true;
  private disposed = false;
  private lastTime = 0;
  private readonly errors = new Listeners<[number]>();
  private readonly ended = new Listeners<[]>();

  constructor(
    private readonly container: HTMLElement,
    private readonly win: YtWindow = window as unknown as YtWindow,
    private readonly doc: YtDocument = document as unknown as YtDocument,
  ) {}

  load(videoId: string, startAt: number): void {
    this.ensurePlayer();
    this.run((p) => p.cueVideoById({ videoId, startSeconds: Math.max(0, startAt) }));
  }
  play(): void {
    this.run((p) => p.playVideo());
  }
  pause(): void {
    this.run((p) => p.pauseVideo());
  }
  seek(time: number): void {
    this.run((p) => p.seekTo(Math.max(0, time), true));
  }
  stop(): void {
    this.run((p) => p.stopVideo());
  }
  setRate(rate: number): void {
    this.run((p) => p.setPlaybackRate(rate));
  }
  getTime(): number {
    const t = this.player?.getCurrentTime();
    if (typeof t === 'number' && Number.isFinite(t)) this.lastTime = t;
    return this.lastTime;
  }
  mute(): void {
    this.muted = true;
    this.run((p) => p.mute());
  }
  unmute(): void {
    this.muted = false;
    this.run((p) => p.unMute());
  }
  isMuted(): boolean {
    return this.muted;
  }
  onError(listener: (code: number) => void): () => void {
    return this.errors.add(listener);
  }
  onEnded(listener: () => void): () => void {
    return this.ended.add(listener);
  }
  dispose(): void {
    this.disposed = true;
    this.queue = [];
    this.errors.clear();
    this.ended.clear();
    this.player?.destroy();
    this.player = null;
    this.container.replaceChildren();
  }

  private run(command: Command): void {
    if (this.disposed) return;
    if (this.player) command(this.player);
    else this.queue.push(command);
  }

  private ensurePlayer(): void {
    if (this.creating || this.player || this.disposed) return;
    this.creating = true;
    void loadYouTubeIframeApi(this.win, this.doc).then((YT) => {
      if (this.disposed) return;
      const mountPoint = this.container.ownerDocument.createElement('div');
      this.container.appendChild(mountPoint);
      const player = new YT.Player(mountPoint, {
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          mute: 1,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: () => {
            if (this.disposed) return;
            this.player = player;
            if (this.muted) player.mute();
            else player.unMute();
            const queued = this.queue;
            this.queue = [];
            for (const command of queued) command(player);
          },
          onError: (e) => this.errors.emit(e.data),
          onStateChange: (e) => {
            if (e.data === YT_ENDED) this.ended.emit();
          },
        },
      });
    });
  }
}

/**
 * Picks the player: the fake one when the build sets `VITE_TV_PLAYER=fake` (Playwright
 * does), the YouTube one otherwise.
 */
export function tvPlayerKind(env: { VITE_TV_PLAYER?: string | undefined }): 'youtube' | 'fake' {
  return env.VITE_TV_PLAYER === 'fake' ? 'fake' : 'youtube';
}
