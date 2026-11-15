import { describe, expect, it } from 'vitest';
import type { TvCommand } from '@office/protocol';
import { TvSim, type TvBody } from '../src/sim/tv';

const ID_A = 'dQw4w9WgXcQ';
const ID_B = 'aqz-KE-bpKQ';
const T0 = 1_794_000_000_000;

function setup() {
  let now = T0;
  const tv: TvBody = {
    videoId: null,
    status: 'idle',
    currentTime: 0,
    updatedAt: 0,
    controllerSessionId: null,
  };
  const sim = new TvSim(tv, () => now);
  const advance = (seconds: number) => {
    now += seconds * 1000;
  };
  return { tv, sim, advance, now: () => now };
}

describe('TvSim (REQ-TV-004, REQ-TV-005)', () => {
  it('load starts playing at 0 and stamps time and controller', () => {
    const { tv, sim } = setup();
    expect(sim.apply('a', { type: 'load', videoId: ID_A })).toBe(true);
    expect(tv).toEqual({
      videoId: ID_A,
      status: 'playing',
      currentTime: 0,
      updatedAt: T0,
      controllerSessionId: 'a',
    });
  });

  it('pause after 3 s of play gives currentTime 3, and play resumes from there', () => {
    const { tv, sim, advance, now } = setup();
    sim.apply('a', { type: 'load', videoId: ID_A });
    advance(3);
    sim.apply('a', { type: 'pause' });
    expect(tv).toMatchObject({ status: 'paused', currentTime: 3, updatedAt: now() });
    advance(10);
    expect(sim.positionAt()).toBe(3);
    sim.apply('a', { type: 'play' });
    expect(tv).toMatchObject({ status: 'playing', currentTime: 3, updatedAt: now() });
    advance(1.5);
    expect(sim.positionAt()).toBe(4.5);
  });

  it('seek sets currentTime and keeps the status', () => {
    const { tv, sim, advance } = setup();
    sim.apply('a', { type: 'load', videoId: ID_A });
    advance(2);
    sim.apply('a', { type: 'seek', time: 42 });
    expect(tv).toMatchObject({ status: 'playing', currentTime: 42 });
    advance(1);
    expect(sim.positionAt()).toBe(43);
    sim.apply('a', { type: 'pause' });
    sim.apply('a', { type: 'seek', time: 7 });
    expect(tv).toMatchObject({ status: 'paused', currentTime: 7 });
  });

  it('stop returns to idle with videoId null', () => {
    const { tv, sim, advance } = setup();
    sim.apply('a', { type: 'load', videoId: ID_A });
    advance(5);
    sim.apply('a', { type: 'stop' });
    expect(tv).toMatchObject({ videoId: null, status: 'idle', currentTime: 0 });
    expect(sim.positionAt()).toBe(0);
  });

  it('ignores play, pause and seek while idle', () => {
    const { tv, sim } = setup();
    const before = { ...tv };
    for (const cmd of [
      { type: 'play' },
      { type: 'pause' },
      { type: 'seek', time: 3 },
    ] as TvCommand[]) {
      expect(sim.apply('a', cmd)).toBe(false);
    }
    expect(tv).toEqual(before);
  });

  it('load while playing switches video and restarts at 0', () => {
    const { tv, sim, advance } = setup();
    sim.apply('a', { type: 'load', videoId: ID_A });
    advance(20);
    sim.apply('b', { type: 'load', videoId: ID_B });
    expect(tv).toMatchObject({ videoId: ID_B, status: 'playing', currentTime: 0 });
  });

  it('applies interleaved commands from two employees in arrival order; anyone controls', () => {
    const { tv, sim, advance, now } = setup();
    sim.apply('a', { type: 'load', videoId: ID_A });
    advance(1);
    sim.apply('b', { type: 'pause' });
    expect(tv).toMatchObject({ status: 'paused', currentTime: 1, controllerSessionId: 'b' });
    advance(1);
    sim.apply('a', { type: 'seek', time: 30 });
    sim.apply('b', { type: 'play' });
    advance(2);
    sim.apply('a', { type: 'pause' });
    expect(tv).toEqual({
      videoId: ID_A,
      status: 'paused',
      currentTime: 32,
      updatedAt: now(),
      controllerSessionId: 'a',
    });
  });

  it('the controller leaving keeps playback and clears controllerSessionId', () => {
    const { tv, sim, advance } = setup();
    sim.apply('a', { type: 'load', videoId: ID_A });
    advance(4);
    sim.leave('b');
    expect(tv.controllerSessionId).toBe('a');
    sim.leave('a');
    expect(tv).toMatchObject({ videoId: ID_A, status: 'playing', controllerSessionId: null });
    expect(sim.positionAt()).toBe(4);
    sim.apply('b', { type: 'pause' });
    expect(tv).toMatchObject({ status: 'paused', currentTime: 4, controllerSessionId: 'b' });
  });
});
