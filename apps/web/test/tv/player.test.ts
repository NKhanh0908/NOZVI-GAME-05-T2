import { describe, expect, it, vi } from 'vitest';
import { BALANCE } from '@office/protocol';
import { TvBinding, type TvRoom } from '../../src/tv/TvBinding';
import { videoError, type TvVideoError } from '../../src/tv/videoError';
import { FakeTvPlayer, type TvPlayer } from '../../src/tv/player';
import {
  createTvDebugLog,
  defaultTvLog,
  TV_LOG_MAX_ENTRIES,
  type TvLogEntry,
  type TvLogTarget,
} from '../../src/tv/tvDebugLog';
import {
  IFRAME_API_LOAD_ERROR_CODE,
  loadYouTubeIframeApi,
  SEEK_END_MARGIN_SECONDS,
  YT_STATE,
  tvPlayerKind,
  YT_IFRAME_API_URL,
  YouTubeTvPlayer,
  type YtPlayer,
  type YtNamespace,
  type YtPlayerOptions,
  type YtWindow,
} from '../../src/tv/youtubePlayer';

const METHODS: (keyof TvPlayer)[] = [
  'load',
  'play',
  'pause',
  'seek',
  'stop',
  'setRate',
  'getTime',
  'getDuration',
  'mute',
  'unmute',
  'isMuted',
  'onError',
  'onEnded',
  'dispose',
];

const clock = () => {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe('FakeTvPlayer', () => {
  it('implements every TvPlayer method', () => {
    const p = new FakeTvPlayer();
    for (const m of METHODS) expect(typeof p[m], m).toBe('function');
    expect(p.kind).toBe('fake');
  });

  it('getTime follows load, play, pause, seek and setRate under a controlled clock', () => {
    const c = clock();
    const p = new FakeTvPlayer(null, c.now);
    expect(p.getTime()).toBe(0);
    p.play(); // nothing loaded: no effect
    c.advance(1000);
    expect(p.getTime()).toBe(0);

    p.load('AAAAAAAAAAA', 10);
    expect(p.getTime()).toBe(10);
    c.advance(2000);
    expect(p.getTime()).toBe(10); // cued, not playing

    p.play();
    c.advance(3000);
    expect(p.getTime()).toBeCloseTo(13, 9);

    p.pause();
    c.advance(5000);
    expect(p.getTime()).toBeCloseTo(13, 9);

    p.seek(40);
    expect(p.getTime()).toBe(40);
    p.play();
    c.advance(1000);
    expect(p.getTime()).toBeCloseTo(41, 9);

    p.setRate(1.05);
    c.advance(2000);
    expect(p.getTime()).toBeCloseTo(43.1, 9);
    p.setRate(1);
    c.advance(1000);
    expect(p.getTime()).toBeCloseTo(44.1, 9);

    p.seek(-3);
    expect(p.getTime()).toBe(0);

    p.stop();
    expect(p.state).toMatchObject({ videoId: null, playing: false });
    expect(p.getTime()).toBe(0);
  });

  it('starts muted, toggles mute and reports errors and the end of a video', () => {
    const c = clock();
    const p = new FakeTvPlayer(null, c.now);
    expect(p.isMuted()).toBe(true);
    p.unmute();
    expect(p.isMuted()).toBe(false);
    p.mute();
    expect(p.isMuted()).toBe(true);

    const errors: number[] = [];
    const ended = vi.fn();
    const offError = p.onError((code) => errors.push(code));
    p.onEnded(ended);
    p.load('AAAAAAAAAAA', 0);
    p.play();
    c.advance(4000);
    p.emitError(150);
    p.emitEnded();
    expect(errors).toEqual([150]);
    expect(ended).toHaveBeenCalledOnce();
    expect(p.state.playing).toBe(false);
    expect(p.getTime()).toBeCloseTo(4, 9);

    offError();
    p.emitError(2);
    expect(errors).toEqual([150]);

    p.dispose();
    expect(p.state.disposed).toBe(true);
  });
});

describe('YouTubeTvPlayer play waits for cued (T-1612, YouTube error 2)', () => {
  async function readyPlayer() {
    const yt = stubYouTube();
    const p = new YouTubeTvPlayer(yt.container as unknown as HTMLElement, yt.win, yt.doc);
    p.load('AAAAAAAAAAA', 0);
    yt.finishLoading();
    await flush();
    const [{ opts, api }] = yt.players as [(typeof yt.players)[number]];
    opts.events.onReady();
    opts.events.onStateChange({ data: YT_STATE.cued });
    return { p, opts, api };
  }

  it('on a ready player, load then play sends playVideo only after cued, exactly once', async () => {
    const { p, opts, api } = await readyPlayer();
    (api.playVideo as ReturnType<typeof vi.fn>).mockClear();
    p.load('BBBBBBBBBBB', 3);
    p.play();
    expect(api.cueVideoById).toHaveBeenLastCalledWith({ videoId: 'BBBBBBBBBBB', startSeconds: 3 });
    expect(api.playVideo).not.toHaveBeenCalled();
    opts.events.onStateChange({ data: YT_STATE.cued });
    expect(api.playVideo).toHaveBeenCalledOnce();
    opts.events.onStateChange({ data: YT_STATE.cued });
    expect(api.playVideo).toHaveBeenCalledOnce();
  });

  it('a pause or stop before cued cancels the held play', async () => {
    const { p, opts, api } = await readyPlayer();
    (api.playVideo as ReturnType<typeof vi.fn>).mockClear();
    p.load('BBBBBBBBBBB', 0);
    p.play();
    p.pause();
    opts.events.onStateChange({ data: YT_STATE.cued });
    expect(api.playVideo).not.toHaveBeenCalled();

    p.load('CCCCCCCCCCC', 0);
    p.play();
    p.stop();
    opts.events.onStateChange({ data: YT_STATE.cued });
    expect(api.playVideo).not.toHaveBeenCalled();
  });

  // Seen in real Chrome: cueing the next video makes the old one report `paused` before the
  // new one is cued; that state used to count as the new video's start, so held seeks and
  // rates reached the iframe while the new video was still loading (IFrame error 5).
  it('a playing or paused state before the new video is cued is not its start', async () => {
    const { p, opts, api } = await readyPlayer();
    opts.events.onStateChange({ data: YT_STATE.playing });
    p.load('BBBBBBBBBBB', 0);
    p.play();
    p.seek(4);
    opts.events.onStateChange({ data: YT_STATE.paused });
    expect(p.isReady()).toBe(false);
    p.seek(5);
    expect(api.seekTo).not.toHaveBeenCalled();
    opts.events.onStateChange({ data: YT_STATE.cued });
    opts.events.onStateChange({ data: YT_STATE.buffering });
    expect(api.seekTo).not.toHaveBeenCalled();
    opts.events.onStateChange({ data: YT_STATE.playing });
    expect(p.isReady()).toBe(true);
    expect(api.seekTo).toHaveBeenCalledOnce();
    expect(api.seekTo).toHaveBeenCalledWith(5, true);
  });

  it('play after the video is cued goes straight to playVideo', async () => {
    const { p, api } = await readyPlayer();
    (api.playVideo as ReturnType<typeof vi.fn>).mockClear();
    p.play();
    expect(api.playVideo).toHaveBeenCalledOnce();
  });
});

/** Stubbed IFrame API: records players, fires onReady on demand. */
function stubYouTube() {
  const players: { el: unknown; opts: YtPlayerOptions; api: YtPlayer & Record<string, unknown> }[] =
    [];
  class Player {
    constructor(el: unknown, opts: YtPlayerOptions) {
      const api = {
        cueVideoById: vi.fn(),
        playVideo: vi.fn(),
        pauseVideo: vi.fn(),
        seekTo: vi.fn(),
        stopVideo: vi.fn(),
        setPlaybackRate: vi.fn(),
        getCurrentTime: vi.fn(() => 12.5),
        getDuration: vi.fn(() => 0),
        getAvailablePlaybackRates: vi.fn(() => [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]),
        mute: vi.fn(),
        unMute: vi.fn(),
        destroy: vi.fn(),
      };
      players.push({ el, opts, api });
      return api as unknown as Player;
    }
  }
  const scripts: { src: string; async: boolean }[] = [];
  const win: YtWindow = {};
  const doc = {
    createElement: () => {
      const s = { src: '', async: false };
      scripts.push(s);
      return s;
    },
    head: { appendChild: vi.fn() },
  };
  /** What the real script does when it has loaded. */
  const finishLoading = () => {
    win.YT = { Player: Player as unknown as YtNamespace['Player'] };
    win.onYouTubeIframeAPIReady?.();
  };
  const children: unknown[] = [];
  const container = {
    ownerDocument: { createElement: (tag: string) => ({ tag }) },
    appendChild: (c: unknown) => children.push(c),
    replaceChildren: () => children.splice(0),
  };
  return { players, scripts, win, doc, finishLoading, children, container };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('YouTubeTvPlayer', () => {
  it('loads the IFrame API script once, only when a video is first loaded', async () => {
    const yt = stubYouTube();
    const a = new YouTubeTvPlayer(yt.container as unknown as HTMLElement, yt.win, yt.doc);
    expect(yt.scripts).toHaveLength(0); // no request while the TV is unused
    a.load('AAAAAAAAAAA', 5);
    a.load('BBBBBBBBBBB', 0);
    const b = new YouTubeTvPlayer(yt.container as unknown as HTMLElement, yt.win, yt.doc);
    b.load('CCCCCCCCCCC', 0);
    void loadYouTubeIframeApi(yt.win, yt.doc);
    expect(yt.scripts).toHaveLength(1);
    expect(yt.scripts[0]).toMatchObject({ src: YT_IFRAME_API_URL, async: true });
    expect(yt.doc.head.appendChild).toHaveBeenCalledOnce();

    yt.finishLoading();
    await flush();
    expect(yt.players).toHaveLength(2);
    // Once YT exists no further script is added.
    await loadYouTubeIframeApi(yt.win, yt.doc);
    expect(yt.scripts).toHaveLength(1);
  });

  it('keeps an earlier onYouTubeIframeAPIReady handler', async () => {
    const yt = stubYouTube();
    const earlier = vi.fn();
    yt.win.onYouTubeIframeAPIReady = earlier;
    const ready = loadYouTubeIframeApi(yt.win, yt.doc);
    yt.finishLoading();
    await ready;
    expect(earlier).toHaveBeenCalledOnce();
  });

  it('mounts in the TvScreen container, starts muted and replays queued calls on ready', async () => {
    const yt = stubYouTube();
    const p = new YouTubeTvPlayer(yt.container as unknown as HTMLElement, yt.win, yt.doc);
    expect(p.kind).toBe('youtube');
    expect(p.isMuted()).toBe(true);
    p.load('AAAAAAAAAAA', 7);
    p.play();
    p.setRate(1.25); // before the video starts: refused (rates unknown)
    yt.finishLoading();
    await flush();

    const [{ el, opts, api }] = yt.players as [(typeof yt.players)[number]];
    expect(yt.children).toEqual([el]); // the mount point is inside the screen container
    expect(opts.playerVars).toMatchObject({ mute: 1, autoplay: 0, controls: 0, playsinline: 1 });
    expect(api.cueVideoById).not.toHaveBeenCalled(); // queued until ready

    opts.events.onReady();
    expect(api.mute).toHaveBeenCalledOnce();
    expect(api.cueVideoById).toHaveBeenCalledWith({ videoId: 'AAAAAAAAAAA', startSeconds: 7 });
    // T-1612: playVideo in the same tick as cueVideoById makes YouTube answer error 2,
    // so the play waits for the cued state.
    expect(api.playVideo).not.toHaveBeenCalled();
    opts.events.onStateChange({ data: YT_STATE.cued });
    expect(api.playVideo).toHaveBeenCalledOnce();
    expect(api.setPlaybackRate).not.toHaveBeenCalled();
    expect(p.isReady()).toBe(false);
    expect(p.getTime()).toBe(7); // the cued start until the video reports its position

    opts.events.onStateChange({ data: YT_STATE.playing });
    expect(p.isReady()).toBe(true);
    p.setRate(1.25);
    expect(api.setPlaybackRate).toHaveBeenCalledWith(1.25);

    p.pause();
    p.seek(30);
    expect(p.getTime()).toBe(12.5); // the IFrame player's position once started
    p.stop();
    p.unmute();
    expect(api.pauseVideo).toHaveBeenCalledOnce();
    expect(api.seekTo).toHaveBeenCalledWith(30, true);
    expect(api.stopVideo).toHaveBeenCalledOnce();
    expect(api.unMute).toHaveBeenCalledOnce();
    expect(p.isMuted()).toBe(false);
    expect(p.isReady()).toBe(false);
    expect(p.getTime()).toBe(0);
    // Duration is null until the IFrame API reports a positive length.
    expect(p.getDuration()).toBeNull();
    (api.getDuration as ReturnType<typeof vi.fn>).mockReturnValue(596.5);
    expect(p.getDuration()).toBe(596.5);
  });

  it('forwards errors and the ended state, and dispose destroys the player', async () => {
    const yt = stubYouTube();
    const p = new YouTubeTvPlayer(yt.container as unknown as HTMLElement, yt.win, yt.doc);
    const errors: number[] = [];
    const ended = vi.fn();
    p.onError((c) => errors.push(c));
    p.onEnded(ended);
    p.load('AAAAAAAAAAA', 0);
    yt.finishLoading();
    await flush();
    const [{ opts, api }] = yt.players as [(typeof yt.players)[number]];
    opts.events.onReady();
    opts.events.onError({ data: 150 });
    opts.events.onStateChange({ data: 1 }); // playing
    opts.events.onStateChange({ data: 0 }); // ended
    expect(errors).toEqual([150]);
    expect(ended).toHaveBeenCalledOnce();

    p.dispose();
    expect(api.destroy).toHaveBeenCalledOnce();
    expect(yt.children).toEqual([]);
    p.play();
    expect(api.playVideo).not.toHaveBeenCalled();
  });

  it('a player disposed before the API loads creates nothing', async () => {
    const yt = stubYouTube();
    const p = new YouTubeTvPlayer(yt.container as unknown as HTMLElement, yt.win, yt.doc);
    p.load('AAAAAAAAAAA', 0);
    p.dispose();
    yt.finishLoading();
    await flush();
    expect(yt.players).toHaveLength(0);
  });
});

describe('YouTubeTvPlayer IFrame API load failure (T-1568)', () => {
  /** Fires the `error` event of the last script the loader added. */
  const scriptError = (yt: ReturnType<typeof stubYouTube>) =>
    (yt.scripts.at(-1) as { onerror?: () => void }).onerror?.();

  it('rejects the loader on a script error and forgets the attempt', async () => {
    const yt = stubYouTube();
    const earlier = vi.fn();
    yt.win.onYouTubeIframeAPIReady = earlier;
    const loading = loadYouTubeIframeApi(yt.win, yt.doc);
    scriptError(yt);
    await expect(loading).rejects.toThrow(/failed to load/);
    expect(yt.win.onYouTubeIframeAPIReady).toBe(earlier); // handler restored
    // The next call adds a fresh script and can still succeed.
    const retry = loadYouTubeIframeApi(yt.win, yt.doc);
    expect(yt.scripts).toHaveLength(2);
    yt.finishLoading();
    await expect(retry).resolves.toBeDefined();
  });

  it('rejects the loader when YT is not ready in time', async () => {
    vi.useFakeTimers();
    try {
      const yt = stubYouTube();
      const loading = loadYouTubeIframeApi(yt.win, yt.doc);
      const result = expect(loading).rejects.toThrow(/not ready/);
      vi.advanceTimersByTime(BALANCE.tvPlayer.iframeApiTimeoutMs);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });

  it('a script error shows the unknown video error and keeps the queue bounded', async () => {
    const yt = stubYouTube();
    const p = new YouTubeTvPlayer(yt.container as unknown as HTMLElement, yt.win, yt.doc, null);
    const codes: number[] = [];
    p.onError((code) => codes.push(code));
    p.load('AAAAAAAAAAA', 0);
    for (let i = 0; i < BALANCE.tvPlayer.playerQueueMax * 3; i++) {
      p.play();
      p.pause();
    }
    expect(p.queuedCommands()).toBe(BALANCE.tvPlayer.playerQueueMax);
    scriptError(yt);
    await flush();
    expect(codes).toEqual([IFRAME_API_LOAD_ERROR_CODE]);
    expect(videoError('AAAAAAAAAAA', codes[0]!)).toMatchObject({ kind: 'unknown' });
    expect(p.queuedCommands()).toBe(0);
    expect(yt.players).toHaveLength(0);

    // The next load tries the script again and the player comes up.
    p.load('BBBBBBBBBBB', 0);
    expect(yt.scripts).toHaveLength(2);
    yt.finishLoading();
    await flush();
    expect(yt.players).toHaveLength(1);
  });

  it('the binding shows the error state for the loaded video', async () => {
    const yt = stubYouTube();
    const p = new YouTubeTvPlayer(yt.container as unknown as HTMLElement, yt.win, yt.doc, null);
    const binding = new TvBinding(p, { every: () => () => undefined, visibility: null });
    const errors: (TvVideoError | null)[] = [];
    binding.onErrorChange((e) => errors.push(e));
    const room: TvRoom = {
      sessionId: 'me',
      state: {
        tv: {
          videoId: 'AAAAAAAAAAA',
          provider: 'youtube',
          status: 'playing',
          currentTime: 0,
          updatedAt: Date.now(),
          controllerSessionId: 'me',
        },
      },
      send: vi.fn(),
      onStateChange: Object.assign(() => undefined, { remove: () => undefined }),
      onMessage: () => () => undefined,
    };
    binding.attach(room);
    expect(yt.scripts).toHaveLength(1);
    scriptError(yt);
    await flush();
    expect(binding.view().error).toMatchObject({ videoId: 'AAAAAAAAAAA', kind: 'unknown' });
    expect(errors.at(-1)).toMatchObject({ kind: 'unknown' });
    expect(p.queuedCommands()).toBeLessThanOrEqual(BALANCE.tvPlayer.playerQueueMax);
    binding.dispose();
  });
});

/** A started YouTube adapter on a stubbed API, with a recording debug log. */
async function startedPlayer(start = true) {
  const yt = stubYouTube();
  const logged: TvLogEntry[] = [];
  const log = createTvDebugLog({ __tvLog: logged }, { debug: () => undefined }, () => 0);
  const p = new YouTubeTvPlayer(yt.container as unknown as HTMLElement, yt.win, yt.doc, log);
  p.load('AAAAAAAAAAA', 0);
  yt.finishLoading();
  await flush();
  const [{ opts, api }] = yt.players as [(typeof yt.players)[number]];
  opts.events.onReady();
  if (start) {
    opts.events.onStateChange({ data: YT_STATE.cued });
    opts.events.onStateChange({ data: YT_STATE.playing });
  }
  const fn = (name: keyof YtPlayer) => api[name] as ReturnType<typeof vi.fn>;
  return { p, opts, api, fn, logged };
}

describe('YouTubeTvPlayer T-1405 guards (IFrame error 5)', () => {
  it('holds seeks and rates until the cued video starts, then applies only the latest seek', async () => {
    const yt = stubYouTube();
    const p = new YouTubeTvPlayer(yt.container as unknown as HTMLElement, yt.win, yt.doc, null);
    p.load('AAAAAAAAAAA', 0);
    p.play();
    // What the drift loop used to queue while the IFrame API loaded.
    p.seek(3);
    p.seek(4);
    p.setRate(1);
    p.seek(5);
    yt.finishLoading();
    await flush();
    const [{ opts, api }] = yt.players as [(typeof yt.players)[number]];
    opts.events.onReady();
    expect(api.cueVideoById).toHaveBeenCalledOnce();
    expect(api.seekTo).not.toHaveBeenCalled();
    expect(api.setPlaybackRate).not.toHaveBeenCalled();
    // Cued and buffering are not a start; a later seek still only moves the pending target.
    opts.events.onStateChange({ data: YT_STATE.cued });
    opts.events.onStateChange({ data: YT_STATE.buffering });
    p.seek(6);
    expect(api.seekTo).not.toHaveBeenCalled();
    expect(p.getTime()).toBe(6);

    opts.events.onStateChange({ data: YT_STATE.playing });
    expect(api.seekTo).toHaveBeenCalledOnce();
    expect(api.seekTo).toHaveBeenCalledWith(6, true);
    // Rate 1 was already the player's rate: nothing is sent.
    expect(api.setPlaybackRate).not.toHaveBeenCalled();
    // A second playing state (after a pause) does not replay anything.
    opts.events.onStateChange({ data: YT_STATE.paused });
    opts.events.onStateChange({ data: YT_STATE.playing });
    expect(api.seekTo).toHaveBeenCalledOnce();
  });

  it('a new load or stop resets readiness and drops a held seek', async () => {
    const { p, opts, fn } = await startedPlayer();
    expect(p.isReady()).toBe(true);
    p.load('BBBBBBBBBBB', 2);
    expect(p.isReady()).toBe(false);
    p.seek(9);
    p.stop();
    opts.events.onStateChange({ data: YT_STATE.playing });
    expect(fn('seekTo')).not.toHaveBeenCalled();
    expect(fn('stopVideo')).toHaveBeenCalledOnce();
  });

  it('clamps seeks to [0, duration - margin] and drops non-finite times', async () => {
    const { p, fn } = await startedPlayer();
    p.seek(-4);
    expect(fn('seekTo')).toHaveBeenLastCalledWith(0, true);
    fn('getDuration').mockReturnValue(100);
    p.seek(250);
    expect(fn('seekTo')).toHaveBeenLastCalledWith(100 - SEEK_END_MARGIN_SECONDS, true);
    p.seek(Number.NaN);
    p.seek(Infinity);
    expect(fn('seekTo')).toHaveBeenCalledTimes(2);
  });

  it('cues at a finite, non-negative start', async () => {
    const yt = stubYouTube();
    const p = new YouTubeTvPlayer(yt.container as unknown as HTMLElement, yt.win, yt.doc, null);
    p.load('AAAAAAAAAAA', Number.NaN);
    p.load('BBBBBBBBBBB', -2);
    yt.finishLoading();
    await flush();
    const [{ opts, api }] = yt.players as [(typeof yt.players)[number]];
    opts.events.onReady();
    expect(api.cueVideoById).toHaveBeenNthCalledWith(1, {
      videoId: 'AAAAAAAAAAA',
      startSeconds: 0,
    });
    expect(api.cueVideoById).toHaveBeenNthCalledWith(2, {
      videoId: 'BBBBBBBBBBB',
      startSeconds: 0,
    });
  });

  it('refuses nudge rates the video does not list (0.95 / 1.05) and sends listed ones', async () => {
    const { p, fn } = await startedPlayer();
    expect(p.supportsRate(1)).toBe(true);
    expect(p.supportsRate(1.05)).toBe(false);
    expect(p.supportsRate(0.95)).toBe(false);
    expect(p.supportsRate(1.25)).toBe(true);
    p.setRate(1.05);
    p.setRate(0.95);
    p.setRate(Number.NaN);
    p.setRate(0);
    expect(fn('setPlaybackRate')).not.toHaveBeenCalled();
    p.setRate(1.25);
    p.setRate(1.25); // unchanged: not sent again
    p.setRate(1);
    expect(fn('setPlaybackRate').mock.calls).toEqual([[1.25], [1]]);
  });

  it('accepts 1.05 when the video lists it', async () => {
    const { p, opts, fn } = await startedPlayer(false);
    fn('getAvailablePlaybackRates').mockReturnValue([0.95, 1, 1.05]);
    expect(p.supportsRate(1.05)).toBe(false); // not started: rates unknown
    p.setRate(1.05); // refused before the start
    expect(fn('setPlaybackRate')).not.toHaveBeenCalled();
    opts.events.onStateChange({ data: YT_STATE.cued });
    opts.events.onStateChange({ data: YT_STATE.playing });
    expect(p.supportsRate(1.05)).toBe(true);
    p.setRate(1.05);
    expect(fn('setPlaybackRate')).toHaveBeenCalledWith(1.05);
  });

  it('passes origin and enablejsapi', async () => {
    const yt = stubYouTube();
    const container = {
      ...yt.container,
      ownerDocument: {
        ...yt.container.ownerDocument,
        defaultView: { location: { origin: 'http://localhost:5173' } },
      },
    };
    const p = new YouTubeTvPlayer(container as unknown as HTMLElement, yt.win, yt.doc, null);
    p.load('AAAAAAAAAAA', 0);
    yt.finishLoading();
    await flush();
    const [{ opts }] = yt.players as [(typeof yt.players)[number]];
    expect(opts.playerVars).toMatchObject({ enablejsapi: 1, origin: 'http://localhost:5173' });
  });
});

describe('TV debug log (T-1405)', () => {
  it('records adapter calls, IFrame calls, state changes, rates, duration and error codes', async () => {
    const { p, opts, fn, logged } = await startedPlayer();
    fn('getDuration').mockReturnValue(212);
    p.seek(30);
    opts.events.onError({ data: 5 });
    const events = logged.map((e) => e.event);
    expect(events).toEqual(
      expect.arrayContaining([
        'load',
        'loading IFrame API',
        'create YT.Player',
        'onReady',
        'yt.cueVideoById',
        'onStateChange',
        'video started',
        'seek',
        'yt.seekTo',
        'onError',
      ]),
    );
    expect(events.indexOf('yt.cueVideoById')).toBeGreaterThan(events.indexOf('onReady'));
    expect(logged.find((e) => e.event === 'video started')?.data).toMatchObject({
      availablePlaybackRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
    });
    expect(logged.filter((e) => e.event === 'onStateChange').map((e) => e.data)).toEqual([
      { state: 5, name: 'cued' },
      { state: 1, name: 'playing' },
    ]);
    expect(logged.find((e) => e.event === 'yt.seekTo')?.data).toEqual({
      seconds: 30,
      allowSeekAhead: true,
    });
    expect(logged.find((e) => e.event === 'onError')?.data).toMatchObject({
      code: 5,
      duration: 212,
    });
  });

  it('writes to window.__tvLog and console.debug, capped, and is off outside DEV', () => {
    const target: TvLogTarget = {};
    const debug = vi.fn();
    const log = createTvDebugLog(target, { debug }, () => 12.4);
    log('play');
    log('seek', { time: 3 });
    expect(target.__tvLog).toEqual([
      { t: 12, event: 'play' },
      { t: 12, event: 'seek', data: { time: 3 } },
    ]);
    expect(debug).toHaveBeenNthCalledWith(1, '[tv]', 'play');
    expect(debug).toHaveBeenNthCalledWith(2, '[tv]', 'seek', { time: 3 });
    for (let i = 0; i < TV_LOG_MAX_ENTRIES + 5; i++) log('tick');
    expect(target.__tvLog).toHaveLength(TV_LOG_MAX_ENTRIES);
    expect(defaultTvLog(false)).toBeNull();
  });
});

describe('tvPlayerKind', () => {
  it('selects the fake player only for VITE_TV_PLAYER=fake', () => {
    expect(tvPlayerKind({ VITE_TV_PLAYER: 'fake' })).toBe('fake');
    expect(tvPlayerKind({})).toBe('youtube');
    expect(tvPlayerKind({ VITE_TV_PLAYER: 'youtube' })).toBe('youtube');
  });
});
