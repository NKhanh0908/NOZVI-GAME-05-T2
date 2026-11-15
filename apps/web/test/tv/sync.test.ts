import { describe, expect, it, vi } from 'vitest';
import type { TvSnapshot } from '@office/protocol';
import {
  ClockOffsetEstimator,
  DriftController,
  decide,
  expectedTime,
  onBecameVisible,
} from '../../src/tv/sync';

const T0 = 1_794_000_000_000;
const playing = (currentTime: number, updatedAt = T0): TvSnapshot => ({
  videoId: 'AAAAAAAAAAA',
  provider: 'youtube',
  status: 'playing',
  currentTime,
  updatedAt,
  controllerSessionId: 's1',
});

describe('decide (REQ-TV-006 bands)', () => {
  it.each([
    [0.4, 'none'],
    [0.5, 'nudge'],
    [1.2, 'nudge'],
    [2.0, 'nudge'],
    [3, 'seek'],
  ] as const)('drift %s s gives %s', (drift, kind) => {
    expect(decide(10, 10 + drift).kind).toBe(kind);
    expect(decide(10, 10 - drift).kind).toBe(kind);
  });
  it('slows down when ahead and speeds up when behind, for at most 2 s', () => {
    expect(decide(10, 11.2)).toEqual({ kind: 'nudge', rate: 0.95, seconds: 2 });
    expect(decide(10, 8.8)).toEqual({ kind: 'nudge', rate: 1.05, seconds: 2 });
    // 0.05 s closes in 1 s at 5 %, so a tiny drift gets a short nudge (bands patched).
    const bands = {
      ignoreBelowSeconds: 0.01,
      nudgeUpToSeconds: 2,
      nudgeRate: 0.05,
      nudgeMaxSeconds: 2,
    };
    expect(decide(10, 10.05, bands)).toMatchObject({ seconds: expect.closeTo(1, 9) });
  });
  it('seeks to the expected time', () => {
    expect(decide(42, 30)).toEqual({ kind: 'seek', time: 42 });
  });
});

describe('expectedTime and clock offset (OQ-023)', () => {
  it('advances while playing and holds while paused; idle is null', () => {
    expect(expectedTime(playing(5), T0 + 3000)).toBe(8);
    expect(expectedTime({ ...playing(5), status: 'paused' }, T0 + 3000)).toBe(5);
    expect(expectedTime({ ...playing(5), status: 'idle', videoId: null }, T0)).toBeNull();
    expect(expectedTime(playing(5), T0 - 1000)).toBe(5);
  });
  it('estimates the server offset as the tightest lower bound of recent samples', () => {
    const clock = new ClockOffsetEstimator(3);
    expect(clock.offsetMs).toBe(0);
    // Local clock is 5000 ms behind the server; deliveries take 40, 10 and 120 ms.
    clock.addSample(T0, T0 - 5000 + 40);
    clock.addSample(T0 + 1000, T0 + 1000 - 5000 + 10);
    clock.addSample(T0 + 2000, T0 + 2000 - 5000 + 120);
    expect(clock.offsetMs).toBe(4990);
    expect(clock.serverNow(T0)).toBe(T0 + 4990);
    // Old samples fall out of the window.
    clock.addSample(T0 + 3000, T0 + 3000 - 5000 + 60);
    clock.addSample(T0 + 4000, T0 + 4000 - 5000 + 60);
    expect(clock.offsetMs).toBe(4940);
  });
  it('uses the offset when computing the expected position', () => {
    const clock = new ClockOffsetEstimator();
    clock.addSample(T0, T0 - 5000);
    const ctl = new DriftController(clock);
    // Local time T0 - 5000 + 4000 is server T0 + 4000: expected 4 s; player at 4.1 s.
    expect(ctl.check(playing(0), { time: 4.1 }, T0 - 1000)).toEqual({ kind: 'none' });
    expect(ctl.check(playing(0), { time: 1 }, T0 - 1000)).toEqual({ kind: 'seek', time: 4 });
  });
});

describe('DriftController (REQ-TV-006)', () => {
  const clock = () => {
    const c = new ClockOffsetEstimator();
    c.addSample(T0, T0);
    return c;
  };

  it('starts a nudge, holds it, then ends it after its duration', () => {
    const ctl = new DriftController(clock());
    expect(ctl.check(playing(0), { time: 11.2 }, T0 + 10_000)).toEqual({
      kind: 'rate',
      rate: 0.95,
    });
    expect(ctl.nudging).toBe(true);
    expect(ctl.check(playing(0), { time: 12.1 }, T0 + 11_000)).toEqual({ kind: 'none' });
    expect(ctl.check(playing(0), { time: 13.1 }, T0 + 12_000)).toEqual({ kind: 'rate', rate: 1 });
    expect(ctl.nudging).toBe(false);
  });
  it('a hard seek interrupts a nudge', () => {
    const ctl = new DriftController(clock());
    ctl.check(playing(0), { time: 11 }, T0 + 10_000);
    expect(ctl.check(playing(0), { time: 20 }, T0 + 10_500)).toEqual({ kind: 'seek', time: 10.5 });
    expect(ctl.nudging).toBe(false);
  });
  it('paused: holds the frame and seeks only on a visible difference; a nudge ends', () => {
    const ctl = new DriftController(clock());
    const paused = { ...playing(30), status: 'paused' as const };
    expect(ctl.check(paused, { time: 30.2 }, T0 + 5000)).toEqual({ kind: 'none' });
    expect(ctl.check(paused, { time: 31 }, T0 + 5000)).toEqual({ kind: 'seek', time: 30 });
    ctl.check(playing(0), { time: 11 }, T0 + 10_000);
    expect(ctl.check(paused, { time: 30 }, T0 + 10_100)).toEqual({ kind: 'rate', rate: 1 });
  });
  it('resync decides immediately and drops a running nudge', () => {
    const ctl = new DriftController(clock());
    ctl.check(playing(0), { time: 11 }, T0 + 10_000);
    // Hidden for a minute; the player stalled at 11 s.
    expect(ctl.resync(playing(0), { time: 11 }, T0 + 70_000)).toEqual({ kind: 'seek', time: 70 });
    ctl.check(playing(0), { time: 81 }, T0 + 80_000);
    expect(ctl.resync(playing(0), { time: 80.1 }, T0 + 80_000)).toEqual({ kind: 'rate', rate: 1 });
  });
});

describe('onBecameVisible (REQ-TV-006)', () => {
  it('fires on a change to visible only, and unsubscribes', () => {
    const target = new EventTarget();
    const doc = {
      visibilityState: 'hidden' as DocumentVisibilityState,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    };
    const onVisible = vi.fn();
    const off = onBecameVisible(doc as unknown as Document, onVisible);
    target.dispatchEvent(new Event('visibilitychange'));
    expect(onVisible).not.toHaveBeenCalled();
    doc.visibilityState = 'visible';
    target.dispatchEvent(new Event('visibilitychange'));
    expect(onVisible).toHaveBeenCalledTimes(1);
    off();
    target.dispatchEvent(new Event('visibilitychange'));
    expect(onVisible).toHaveBeenCalledTimes(1);
  });
});
