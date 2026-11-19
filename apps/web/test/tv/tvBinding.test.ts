import { describe, expect, it, vi } from 'vitest';
import {
  BALANCE,
  MSG,
  SERVER_MSG,
  type TvCommand,
  type TvRateLimitedNotice,
  type TvTimeRequest,
} from '@office/protocol';
import { FakeTvPlayer } from '../../src/tv/player';
import { TV_SYNC_INTERVAL_MS, TvBinding, type TvRoom } from '../../src/tv/TvBinding';

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

/**
 * Fake room: tests write `state.tv` and call `patch()`; sent TV commands and `tv_time`
 * requests are recorded; `notice()` and `timeReply()` deliver server messages.
 */
function fakeRoom(sessionId = 'me', tv: Partial<Tv> = {}) {
  const listeners = new Set<(s: { tv?: Tv }) => void>();
  const notices = new Set<(n: TvRateLimitedNotice) => void>();
  const timeReplies = new Set<(reply: unknown) => void>();
  const sent: TvCommand[] = [];
  const timeRequests: TvTimeRequest[] = [];
  const state: { tv: Tv; employees?: Map<string, object> } = {
    tv: { provider: 'youtube', status: 'idle', currentTime: 0, updatedAt: 0, ...tv },
  };
  const onStateChange = Object.assign(
    (cb: (s: { tv?: Tv }) => void) => {
      listeners.add(cb);
    },
    { remove: (cb: (s: { tv?: Tv }) => void) => listeners.delete(cb) },
  );
  const room: TvRoom = {
    sessionId,
    state,
    send: (type: string, payload: unknown) => {
      if (type === MSG.tvTime) timeRequests.push(payload as TvTimeRequest);
      else sent.push(payload as TvCommand);
    },
    onStateChange,
    onMessage: (type: string, cb: (payload: never) => void) => {
      const set = (type === SERVER_MSG.tvTime ? timeReplies : notices) as Set<typeof cb>;
      set.add(cb);
      return () => set.delete(cb);
    },
  };
  return {
    room,
    sent,
    timeRequests,
    timeReply(reply: unknown) {
      for (const l of [...timeReplies]) l(reply);
    },
    state,
    listeners,
    patch(next: Partial<Tv>) {
      Object.assign(state.tv, next);
      for (const l of [...listeners]) l(state);
    },
    notice(n: TvRateLimitedNotice) {
      for (const l of [...notices]) l(n);
    },
  };
}

/** One clock for the local wall time and the fake player; manual periodic timer. */
function harness(options: { offsetMs?: number } = {}) {
  let t = T0;
  const ticks: (() => void)[] = [];
  const player = new FakeTvPlayer(null, () => t);
  const visibility = new EventTarget() as EventTarget & { visibilityState: string };
  visibility.visibilityState = 'visible';
  const binding = new TvBinding(player, {
    now: () => t,
    catalogDuration: (id) => (id === ID_A ? 120 : null),
    every: (ms, run) => {
      expect(ms).toBe(TV_SYNC_INTERVAL_MS);
      ticks.push(run);
      return () => ticks.splice(ticks.indexOf(run), 1);
    },
    visibility: visibility as unknown as Document,
    onRateLimited: () => undefined,
  });
  return {
    player,
    binding,
    visibility,
    /** Server epoch ms now (local clock plus the true offset). */
    server: () => t + (options.offsetMs ?? 0),
    advance(ms: number, tick = true) {
      t += ms;
      if (tick) for (const run of [...ticks]) run();
    },
    get ticks() {
      return ticks.length;
    },
  };
}

describe('TvBinding commands (REQ-TV-004: no optimistic control)', () => {
  it('sends panel actions to the room and leaves the player untouched until state arrives', () => {
    const h = harness();
    const r = fakeRoom();
    h.binding.attach(r.room);
    // Idle: play, pause, seek and stop have nothing to act on and send nothing.
    h.binding.play();
    h.binding.pause();
    h.binding.seek(5);
    h.binding.stop();
    expect(r.sent).toEqual([]);

    h.binding.load(ID_A);
    expect(r.sent).toEqual([{ type: 'load', videoId: ID_A }]);
    expect(h.player.state.videoId).toBeNull();
    expect(h.binding.view().status).toBe('idle');

    r.patch({ videoId: ID_A, status: 'playing', currentTime: 0, updatedAt: h.server() });
    expect(h.player.state).toMatchObject({ videoId: ID_A, playing: true });
    h.binding.pause();
    h.binding.seek(-3);
    h.binding.seek(Number.NaN);
    h.binding.play();
    h.binding.stop();
    expect(r.sent.slice(1)).toEqual([
      { type: 'pause' },
      { type: 'seek', time: 0 },
      { type: 'play' },
      { type: 'stop' },
    ]);
    // Still playing: only the server state changes the player.
    expect(h.player.state.playing).toBe(true);
  });

  it('unmute is local and nothing is sent', () => {
    const h = harness();
    const r = fakeRoom();
    h.binding.attach(r.room);
    h.binding.unmute();
    expect(h.binding.view().muted).toBe(false);
    expect(r.sent).toEqual([]);
  });

  it('after a rate-limit notice drops commands until retryAfterMs has passed', () => {
    const h = harness();
    const r = fakeRoom();
    h.binding.attach(r.room);
    r.notice({ retryAfterMs: 3000 });
    h.binding.load(ID_A);
    h.advance(2999, false);
    h.binding.load(ID_A);
    expect(r.sent).toEqual([]);
    h.advance(1, false);
    h.binding.load(ID_B);
    expect(r.sent).toEqual([{ type: 'load', videoId: ID_B }]);
  });

  it('sends nothing without a room, and nothing after detach', () => {
    const h = harness();
    h.binding.load(ID_A);
    const r = fakeRoom();
    h.binding.attach(r.room);
    h.binding.detach();
    h.binding.load(ID_A);
    expect(r.sent).toEqual([]);
    expect(r.listeners.size).toBe(0);
  });
});

describe('TvBinding state to player (REQ-TV-004, REQ-TV-006)', () => {
  it('a late joiner loads the video and seeks to the computed server position', () => {
    const h = harness();
    h.advance(10_000, false);
    // The video started 10 s ago (server time); this page joins now.
    const r = fakeRoom('late', {
      videoId: ID_A,
      status: 'playing',
      currentTime: 4,
      updatedAt: h.server() - 10_000,
    });
    h.binding.attach(r.room);
    expect(h.player.state).toMatchObject({ videoId: ID_A, playing: true });
    expect(h.player.getTime()).toBeCloseTo(14, 6);
    expect(h.binding.view()).toMatchObject({ videoId: ID_A, status: 'playing', duration: 120 });
  });

  it('a late joiner to a paused TV shows the paused frame', () => {
    const h = harness();
    const r = fakeRoom('late', {
      videoId: ID_A,
      status: 'paused',
      currentTime: 33,
      updatedAt: h.server() - 60_000,
    });
    h.binding.attach(r.room);
    expect(h.player.state).toMatchObject({ videoId: ID_A, playing: false });
    expect(h.player.getTime()).toBe(33);
  });

  it('follows pause, seek, play, change video and stop', () => {
    const h = harness();
    const r = fakeRoom();
    h.binding.attach(r.room);
    r.patch({ videoId: ID_A, status: 'playing', currentTime: 0, updatedAt: h.server() });
    h.advance(3000);
    r.patch({ status: 'paused', currentTime: 3, updatedAt: h.server() });
    expect(h.player.state.playing).toBe(false);
    expect(h.player.getTime()).toBeCloseTo(3, 6);

    // A paused seek lands exactly, even a small one.
    r.patch({ currentTime: 42, updatedAt: h.server() + 1 });
    expect(h.player.getTime()).toBe(42);

    // A seek while playing is an explicit position: hard seek, not a nudge.
    r.patch({ status: 'playing', currentTime: 42, updatedAt: h.server() + 2 });
    expect(h.player.state.playing).toBe(true);
    r.patch({ currentTime: 43, updatedAt: h.server() + 3 });
    expect(h.player.getTime()).toBeCloseTo(43, 2);
    expect(h.player.state.rate).toBe(1);

    r.patch({ videoId: ID_B, currentTime: 0, updatedAt: h.server() + 4 });
    expect(h.player.state).toMatchObject({ videoId: ID_B, playing: true });
    expect(h.player.getTime()).toBeCloseTo(0, 2);

    r.patch({ videoId: null, status: 'idle', currentTime: 0, updatedAt: h.server() + 5 });
    expect(h.player.state).toMatchObject({ videoId: null, playing: false, rate: 1 });
    expect(h.binding.view()).toMatchObject({ videoId: null, status: 'idle', time: 0 });
  });

  it('ignores patches that carry no new command', () => {
    const h = harness();
    const r = fakeRoom();
    h.binding.attach(r.room);
    r.patch({ videoId: ID_A, status: 'playing', currentTime: 0, updatedAt: h.server() });
    const seek = vi.spyOn(h.player, 'seek');
    const load = vi.spyOn(h.player, 'load');
    r.patch({});
    r.patch({});
    expect(seek).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('leaves a player it did not load alone while the TV is idle', () => {
    const h = harness();
    const r = fakeRoom();
    h.binding.attach(r.room);
    h.player.load(ID_A, 0);
    h.player.play();
    h.advance(2000);
    r.patch({});
    expect(h.player.state).toMatchObject({ videoId: ID_A, playing: true });
  });
});

describe('TvBinding drift and clock (REQ-TV-006, OQ-023)', () => {
  it('checks once a second while playing: nudges a small drift, seeks a large one', () => {
    const h = harness();
    const r = fakeRoom();
    h.binding.attach(r.room);
    r.patch({ videoId: ID_A, status: 'playing', currentTime: 0, updatedAt: h.server() });
    h.advance(1000);
    expect(h.player.state.rate).toBe(1);
    // The local player falls 1 s behind (a stall).
    h.player.seek(h.player.getTime() - 1);
    h.advance(1000);
    expect(h.player.state.rate).toBeCloseTo(1.05, 9);
    // The nudge ends after its time (at most 2 s) and the rate returns to 1.
    h.advance(1000);
    h.advance(1000);
    expect(h.player.state.rate).toBe(1);
    // 5 s off: hard seek on the next check.
    h.player.seek(h.player.getTime() + 5);
    h.advance(1000);
    expect(Math.abs(h.player.getTime() - (h.binding.expected() ?? 0))).toBeLessThan(0.5);
  });

  it('resyncs at once when the tab becomes visible again', () => {
    const h = harness();
    const r = fakeRoom();
    h.binding.attach(r.room);
    r.patch({ videoId: ID_A, status: 'playing', currentTime: 0, updatedAt: h.server() });
    // Hidden tab: no timer ran for 30 s, and the player stalled at 0.
    h.advance(30_000, false);
    h.player.seek(0);
    h.visibility.visibilityState = 'hidden';
    h.visibility.dispatchEvent(new Event('visibilitychange'));
    expect(h.player.getTime()).toBe(0);
    h.visibility.visibilityState = 'visible';
    h.visibility.dispatchEvent(new Event('visibilitychange'));
    expect(h.player.getTime()).toBeCloseTo(30, 2);
  });

  it('learns the server clock offset from fresh stamps, not from the join snapshot', () => {
    // The local clock is 4 s behind the server.
    const h = harness({ offsetMs: 4000 });
    const r = fakeRoom('me', {
      videoId: ID_A,
      status: 'playing',
      currentTime: 0,
      updatedAt: h.server() - 60_000,
    });
    h.binding.attach(r.room);
    // No fresh sample yet: the local clock is taken as server time.
    expect(h.binding.clock.offsetMs).toBe(0);
    h.advance(100, false);
    r.patch({ status: 'paused', currentTime: 64, updatedAt: h.server() - 50 });
    expect(h.binding.clock.offsetMs).toBe(3950);
    r.patch({ status: 'playing', currentTime: 64, updatedAt: h.server() });
    h.advance(2000, false);
    expect(h.binding.expected()).toBeCloseTo(66, 6);
  });

  /** Answers the pending `tv_time` request: `upMs` to the server, `downMs` back. */
  function answerTime(
    h: ReturnType<typeof harness>,
    r: ReturnType<typeof fakeRoom>,
    upMs: number,
    downMs: number,
  ) {
    const { id } = r.timeRequests.at(-1)!;
    h.advance(upMs, false);
    const serverNow = h.server();
    h.advance(downMs, false);
    r.timeReply({ id, serverNow });
  }

  it.each([1500, -1500])(
    'a late joiner with a local clock %i ms off the server learns the offset on join (T-1567)',
    (skewMs) => {
      const h = harness({ offsetMs: skewMs });
      h.advance(10_000, false);
      // The video started 10 s ago by the server clock; this page joins now.
      const updatedAt = h.server() - 10_000;
      const r = fakeRoom('late', { videoId: ID_A, status: 'playing', currentTime: 4, updatedAt });
      h.binding.attach(r.room);
      // Before any sample the local clock stands in: the player is off by the skew.
      expect(h.binding.clock.offsetMs).toBe(0);
      expect(h.player.getTime()).toBeCloseTo(14 - skewMs / 1000, 6);
      expect(r.timeRequests).toEqual([{ id: 1 }]);

      // Three samples, one after the other, with uneven 30-80 ms one-way delays.
      answerTime(h, r, 30, 80);
      answerTime(h, r, 40, 30);
      answerTime(h, r, 50, 60);
      expect(r.timeRequests).toHaveLength(BALANCE.tv.clockSamplesOnJoin);
      // The tightest lower bound: the 30 ms return trip.
      expect(h.binding.clock.offsetMs).toBe(skewMs - 30);
      expect(Math.abs(h.binding.clock.offsetMs - skewMs)).toBeLessThanOrEqual(100);
      // No TV command was sent or received, yet the player follows the server clock.
      expect(r.sent).toEqual([]);
      const truth = 4 + (h.server() - updatedAt) / 1000;
      expect(Math.abs(h.binding.expected()! - truth)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(h.player.getTime() - truth)).toBeLessThanOrEqual(0.1);
      // The drift sync now agrees: no nudge or seek on the next check.
      h.advance(TV_SYNC_INTERVAL_MS);
      expect(h.player.state.rate).toBe(1);
      expect(Math.abs(h.player.getTime() - (4 + (h.server() - updatedAt) / 1000))).toBeLessThan(
        0.1,
      );
    },
  );

  it('a tv_time reply before the first snapshot sets the offset the snapshot uses', () => {
    const h = harness({ offsetMs: -1500 });
    h.advance(10_000, false);
    const r = fakeRoom('late');
    r.state.employees = new Map();
    h.binding.attach(r.room);
    answerTime(h, r, 20, 20);
    expect(h.binding.clock.offsetMs).toBe(-1520);
    r.state.employees.set('late', {});
    r.patch({ videoId: ID_A, status: 'playing', currentTime: 0, updatedAt: h.server() - 10_000 });
    expect(h.player.getTime()).toBeCloseTo(9.98, 6);
  });

  it('ignores unmatched, invalid and post-detach tv_time replies; asks again on attach', () => {
    const h = harness({ offsetMs: 2000 });
    const r = fakeRoom();
    h.binding.attach(r.room);
    r.timeReply({ id: 7, serverNow: h.server() });
    r.timeReply({ id: 1, serverNow: 'soon' });
    r.timeReply(null);
    expect(h.binding.clock.offsetMs).toBe(0);
    expect(r.timeRequests).toHaveLength(1);
    answerTime(h, r, 10, 10);
    expect(h.binding.clock.offsetMs).toBe(1990);
    // A late duplicate of an answered request changes nothing.
    r.timeReply({ id: 1, serverNow: h.server() + 5000 });
    expect(h.binding.clock.offsetMs).toBe(1990);

    h.binding.detach();
    r.timeReply({ id: 2, serverNow: h.server() + 5000 });
    expect(h.binding.clock.offsetMs).toBe(1990);
    expect(r.timeRequests).toHaveLength(2);

    const again = fakeRoom();
    h.binding.attach(again.room);
    expect(again.timeRequests).toEqual([{ id: 3 }]);
  });

  it('waits for the full state when attached before it arrived (Colyseus join order)', () => {
    const h = harness();
    h.advance(10_000, false);
    // Joined, but the full state is not decoded yet: schema defaults, no employees.
    const r = fakeRoom('late');
    r.state.employees = new Map();
    h.binding.attach(r.room);
    expect(h.player.state.videoId).toBeNull();
    // The full state arrives: the video started 10 s ago and this session is in the room.
    h.advance(30, false);
    r.state.employees.set('late', {});
    r.patch({ videoId: ID_A, status: 'playing', currentTime: 0, updatedAt: h.server() - 10_030 });
    // The old stamp is not a clock sample: the joiner seeks to 10 s, not to 0.
    expect(h.binding.clock.offsetMs).toBe(0);
    expect(h.player.state).toMatchObject({ videoId: ID_A, playing: true });
    expect(h.player.getTime()).toBeCloseTo(10.03, 6);
    expect(h.binding.expected()).toBeCloseTo(10.03, 6);
  });

  it('the controller reports the end of the video as a pause; other clients do not', () => {
    const h = harness();
    const r = fakeRoom('me');
    h.binding.attach(r.room);
    r.patch({
      videoId: ID_A,
      status: 'playing',
      currentTime: 118,
      updatedAt: h.server(),
      controllerSessionId: 'me',
    });
    h.advance(2000);
    h.player.emitEnded();
    expect(r.sent).toEqual([{ type: 'pause' }]);
    // Held at the end: the drift check does not seek back into the video meanwhile.
    const seek = vi.spyOn(h.player, 'seek');
    h.advance(3000);
    expect(seek).not.toHaveBeenCalled();

    const h2 = harness();
    const r2 = fakeRoom('other');
    h2.binding.attach(r2.room);
    r2.patch({
      videoId: ID_A,
      status: 'playing',
      currentTime: 118,
      updatedAt: h2.server(),
      controllerSessionId: 'me',
    });
    h2.advance(2000);
    h2.player.emitEnded();
    expect(r2.sent).toEqual([]);
  });

  it('with no controller (it left), any client reports the end as one pause (T-1376)', () => {
    const h = harness();
    const r = fakeRoom('other');
    h.binding.attach(r.room);
    r.patch({
      videoId: ID_A,
      status: 'playing',
      currentTime: 118,
      updatedAt: h.server(),
      controllerSessionId: null,
    });
    h.advance(2000);
    h.player.emitEnded();
    h.player.emitEnded();
    h.advance(3000);
    expect(r.sent).toEqual([{ type: 'pause' }]);
  });

  it('a client holding the end reports it once the controller leaves (T-1376)', () => {
    const h = harness();
    const r = fakeRoom('other');
    h.binding.attach(r.room);
    r.patch({
      videoId: ID_A,
      status: 'playing',
      currentTime: 118,
      updatedAt: h.server(),
      controllerSessionId: 'me',
    });
    h.advance(2000);
    h.player.emitEnded();
    expect(r.sent).toEqual([]);
    r.patch({ controllerSessionId: null });
    expect(r.sent).toEqual([{ type: 'pause' }]);
    // The paused state that follows is a new command; nothing else is sent.
    r.patch({ status: 'paused', currentTime: 120, updatedAt: h.server() });
    r.patch({ controllerSessionId: 'other' });
    expect(r.sent).toEqual([{ type: 'pause' }]);
  });

  it('dispose stops the timer and the room listeners', () => {
    const h = harness();
    const r = fakeRoom();
    h.binding.attach(r.room);
    expect(h.ticks).toBe(1);
    h.binding.dispose();
    expect(h.ticks).toBe(0);
    expect(r.listeners.size).toBe(0);
  });
});

describe('TvBinding player readiness and rate fallback (T-1405)', () => {
  it('runs no drift seeks or nudges while the pasted video is still starting', () => {
    const h = harness();
    const r = fakeRoom();
    h.binding.attach(r.room);
    // The real player reports no position for a few seconds after the cue (API load).
    let ready = false;
    vi.spyOn(h.player, 'isReady').mockImplementation(() => ready);
    const seek = vi.spyOn(h.player, 'seek');
    const setRate = vi.spyOn(h.player, 'setRate');
    const getTime = vi.spyOn(h.player, 'getTime').mockReturnValue(0);
    r.patch({ videoId: ID_A, status: 'playing', currentTime: 0, updatedAt: h.server() });
    for (let i = 0; i < 4; i++) h.advance(1000);
    expect(seek).not.toHaveBeenCalled();
    expect(setRate.mock.calls.every(([rate]) => rate === 1)).toBe(true);

    // Started 4 s behind: the next check corrects it with one hard seek.
    ready = true;
    getTime.mockRestore();
    h.player.seek(0);
    seek.mockClear();
    h.advance(1000);
    expect(seek).toHaveBeenCalledOnce();
    expect(Math.abs(h.player.getTime() - (h.binding.expected() ?? 0))).toBeLessThan(0.5);
  });

  it('a new command while the video starts still reaches the player (held there)', () => {
    const h = harness();
    const r = fakeRoom();
    h.binding.attach(r.room);
    r.patch({ videoId: ID_A, status: 'playing', currentTime: 0, updatedAt: h.server() });
    vi.spyOn(h.player, 'isReady').mockReturnValue(false);
    r.patch({ currentTime: 40, updatedAt: h.server() + 1 });
    expect(h.player.getTime()).toBeCloseTo(40, 2);
  });

  it('does not seek right after loading a new video (the cue carries the start)', () => {
    const h = harness();
    const r = fakeRoom();
    h.binding.attach(r.room);
    r.patch({ videoId: ID_A, status: 'playing', currentTime: 0, updatedAt: h.server() });
    h.advance(30_000, false);
    const seek = vi.spyOn(h.player, 'seek');
    const load = vi.spyOn(h.player, 'load');
    r.patch({ videoId: ID_B, currentTime: 0, updatedAt: h.server() });
    expect(load).toHaveBeenCalledOnce();
    expect(load.mock.calls[0]![0]).toBe(ID_B);
    expect(load.mock.calls[0]![1]).toBeCloseTo(0, 2);
    expect(seek).not.toHaveBeenCalled();
  });

  it('falls back to a seek when the player does not offer the nudge rate', () => {
    const h = harness();
    const r = fakeRoom();
    h.binding.attach(r.room);
    h.player.supportedRates = [];
    r.patch({ videoId: ID_A, status: 'playing', currentTime: 0, updatedAt: h.server() });
    h.advance(1000);
    // 1 s behind: a nudge-band drift.
    h.player.seek(h.player.getTime() - 1);
    const setRate = vi.spyOn(h.player, 'setRate');
    const seek = vi.spyOn(h.player, 'seek');
    h.advance(1000);
    expect(setRate).not.toHaveBeenCalled();
    expect(seek).toHaveBeenCalledOnce();
    expect(h.player.state.rate).toBe(1);
    expect(Math.abs(h.player.getTime() - (h.binding.expected() ?? 0))).toBeLessThan(0.5);
  });
});
