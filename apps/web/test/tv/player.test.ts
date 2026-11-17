import { describe, expect, it, vi } from 'vitest';
import { FakeTvPlayer, type TvPlayer } from '../../src/tv/player';
import {
  loadYouTubeIframeApi,
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
    expect(yt.scripts).toEqual([{ src: YT_IFRAME_API_URL, async: true }]);
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
    p.setRate(1.05);
    yt.finishLoading();
    await flush();

    const [{ el, opts, api }] = yt.players as [(typeof yt.players)[number]];
    expect(yt.children).toEqual([el]); // the mount point is inside the screen container
    expect(opts.playerVars).toMatchObject({ mute: 1, autoplay: 0, controls: 0, playsinline: 1 });
    expect(api.cueVideoById).not.toHaveBeenCalled(); // queued until ready

    opts.events.onReady();
    expect(api.mute).toHaveBeenCalledOnce();
    expect(api.cueVideoById).toHaveBeenCalledWith({ videoId: 'AAAAAAAAAAA', startSeconds: 7 });
    expect(api.playVideo).toHaveBeenCalledOnce();
    expect(api.setPlaybackRate).toHaveBeenCalledWith(1.05);
    // Order is kept: cue, then play, then rate.
    const order = [api.cueVideoById, api.playVideo, api.setPlaybackRate].map(
      (f) => (f as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!,
    );
    expect(order).toEqual([...order].sort((x, y) => x - y));

    p.pause();
    p.seek(30);
    p.stop();
    p.unmute();
    expect(api.pauseVideo).toHaveBeenCalledOnce();
    expect(api.seekTo).toHaveBeenCalledWith(30, true);
    expect(api.stopVideo).toHaveBeenCalledOnce();
    expect(api.unMute).toHaveBeenCalledOnce();
    expect(p.isMuted()).toBe(false);
    expect(p.getTime()).toBe(12.5);
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

describe('tvPlayerKind', () => {
  it('selects the fake player only for VITE_TV_PLAYER=fake', () => {
    expect(tvPlayerKind({ VITE_TV_PLAYER: 'fake' })).toBe('fake');
    expect(tvPlayerKind({})).toBe('youtube');
    expect(tvPlayerKind({ VITE_TV_PLAYER: 'youtube' })).toBe('youtube');
  });
});
