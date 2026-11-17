import { describe, expect, it } from 'vitest';
import { FakeTvPlayer } from '../../src/tv/player';
import { TvBinding, type TvRoom } from '../../src/tv/TvBinding';
import {
  VideoErrorLog,
  videoError,
  videoErrorKind,
  type TvVideoError,
} from '../../src/tv/videoError';

const T0 = 1_794_000_000_000;
const ID_A = 'AAAAAAAAAAA';
const ID_B = 'BBBBBBBBBBB';

type Tv = {
  videoId?: string | null;
  provider: string;
  status: string;
  currentTime: number;
  updatedAt: number;
  controllerSessionId?: string | null;
};

/** Binding over a fake player and a fake room; `patch` applies a server state change. */
function setup() {
  const t = T0;
  let updatedAt = T0;
  const listeners = new Set<(s: { tv?: Tv }) => void>();
  const sent: unknown[] = [];
  const state: { tv: Tv } = {
    tv: { provider: 'youtube', status: 'idle', currentTime: 0, updatedAt: 0 },
  };
  const room: TvRoom = {
    sessionId: 'me',
    state,
    send: (_type, cmd) => sent.push(cmd),
    onStateChange: Object.assign(
      (cb: (s: { tv?: Tv }) => void) => {
        listeners.add(cb);
      },
      { remove: (cb: (s: { tv?: Tv }) => void) => listeners.delete(cb) },
    ),
    onMessage: () => () => undefined,
  };
  const player = new FakeTvPlayer(null, () => t);
  const binding = new TvBinding(player, {
    now: () => t,
    every: () => () => undefined,
    onRateLimited: () => undefined,
  });
  const shown: (TvVideoError | null)[] = [];
  binding.onErrorChange((e) => shown.push(e));
  binding.attach(room);
  return {
    player,
    binding,
    sent,
    shown,
    patch(next: Partial<Tv>) {
      updatedAt += 1000;
      Object.assign(state.tv, { updatedAt }, next);
      for (const l of [...listeners]) l(state);
    },
  };
}

describe('videoError (REQ-TV-009: IFrame error codes)', () => {
  it('maps every documented code; 101 and 150 are both embedding blocked', () => {
    expect(videoErrorKind(2)).toBe('invalid-id');
    expect(videoErrorKind(5)).toBe('html5');
    expect(videoErrorKind(100)).toBe('not-found');
    expect(videoErrorKind(101)).toBe('embed-blocked');
    expect(videoErrorKind(150)).toBe('embed-blocked');
    expect(videoErrorKind(7)).toBe('unknown');
    expect(videoError(ID_A, 150).detail).toBe(videoError(ID_A, 101).detail);
  });

  it('keeps the first error per video for the session', () => {
    const log = new VideoErrorLog();
    expect(log.get(ID_A)).toBeNull();
    expect(log.report(ID_A, 150).code).toBe(150);
    expect(log.report(ID_A, 5).code).toBe(150);
    expect(log.has(ID_A)).toBe(true);
    expect(log.get(ID_B)).toBeNull();
    expect(log.get(null)).toBeNull();
  });
});

describe('TvBinding per-video error state (REQ-TV-009)', () => {
  it.each([
    [2, 'invalid-id'],
    [5, 'html5'],
    [100, 'not-found'],
    [101, 'embed-blocked'],
    [150, 'embed-blocked'],
  ] as const)('code %i from the fake player shows a %s error for that video', (code, kind) => {
    const h = setup();
    h.patch({ videoId: ID_A, status: 'playing', currentTime: 0 });
    expect(h.binding.view().error).toBeNull();
    expect(h.player.state).toMatchObject({ videoId: ID_A, playing: true });

    h.player.emitError(code);
    const error = h.binding.view().error;
    expect(error).toMatchObject({ videoId: ID_A, code, kind });
    expect(h.shown).toEqual([error]);
    expect(h.binding.errorFor(ID_A)).toBe(error);
    // The local player stops; the shared state is untouched and nothing is sent.
    expect(h.player.state).toMatchObject({ videoId: null, playing: false });
    expect(h.binding.view()).toMatchObject({ videoId: ID_A, status: 'playing' });
    expect(h.sent).toEqual([]);
  });

  it('another video clears the error; the failed one is never loaded again this session', () => {
    const h = setup();
    h.patch({ videoId: ID_A, status: 'playing', currentTime: 0 });
    h.player.emitError(150);
    expect(h.binding.view().error?.videoId).toBe(ID_A);

    h.patch({ videoId: ID_B, status: 'playing', currentTime: 0 });
    expect(h.binding.view().error).toBeNull();
    expect(h.shown.at(-1)).toBeNull();
    expect(h.player.state).toMatchObject({ videoId: ID_B, playing: true });
    expect(h.binding.errorFor(ID_B)).toBeNull();

    // The room goes back to A: the error shows at once and the player does not load it.
    h.patch({ videoId: ID_A, status: 'playing', currentTime: 0 });
    expect(h.binding.view().error).toMatchObject({ videoId: ID_A, code: 150 });
    expect(h.player.state.videoId).toBeNull();
    h.patch({ status: 'paused' });
    expect(h.player.state.videoId).toBeNull();

    // Stop (idle) hides the error; the log still marks A as failed for the panel.
    h.patch({ videoId: null, status: 'idle' });
    expect(h.binding.view().error).toBeNull();
    expect(h.shown.at(-1)).toBeNull();
    expect(h.binding.errorFor(ID_A)?.kind).toBe('embed-blocked');
  });

  it('ignores an error while nothing is loaded', () => {
    const h = setup();
    h.player.emitError(100);
    expect(h.binding.view().error).toBeNull();
    expect(h.binding.errorFor(ID_A)).toBeNull();
    expect(h.shown).toEqual([]);
  });
});
