import { describe, expect, it, vi } from 'vitest';
import { FakeTvPlayer } from '../../src/tv/player';
import { LocalTvControls } from '../../src/tv/controls';
import { TvMode } from '../../src/tv/TvMode';
import { INVALID_URL_MESSAGE, formatTime, readUrlField, seekMax } from '../../src/tv/panelModel';
import { FakeVideoProvider } from '../../src/tv/provider';

const clock = () => {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe('TvMode', () => {
  it('applies side effects once per change and notifies subscribers', () => {
    const apply = vi.fn();
    const mode = new TvMode(apply);
    const listener = vi.fn();
    const off = mode.subscribe(listener);
    expect(mode.isOpen).toBe(false);
    expect(mode.exit()).toBe(false); // Esc outside TV mode does nothing
    expect(apply).not.toHaveBeenCalled();

    mode.enter();
    mode.enter();
    expect(mode.isOpen).toBe(true);
    expect(mode.getSnapshot()).toBe(true);
    expect(apply.mock.calls).toEqual([[true]]);
    expect(listener).toHaveBeenCalledOnce();

    expect(mode.exit()).toBe(true);
    expect(apply.mock.calls).toEqual([[true], [false]]);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    mode.enter();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('LocalTvControls', () => {
  it('load starts playing; play, pause and seek follow TvSim and do nothing while idle', () => {
    const c = clock();
    const player = new FakeTvPlayer(null, c.now);
    const controls = new LocalTvControls(player, (id) => (id === 'AAAAAAAAAAA' ? 120 : null));
    expect(controls.view()).toEqual({
      videoId: null,
      status: 'idle',
      time: 0,
      duration: null,
      muted: true,
    });
    controls.play();
    controls.seek(10);
    expect(player.state).toMatchObject({ videoId: null, playing: false });

    controls.load('AAAAAAAAAAA');
    c.advance(2000);
    expect(controls.view()).toMatchObject({
      videoId: 'AAAAAAAAAAA',
      status: 'playing',
      duration: 120,
    });
    expect(controls.view().time).toBeCloseTo(2, 9);

    controls.pause();
    expect(controls.view().status).toBe('paused');
    controls.seek(30);
    c.advance(1000);
    expect(controls.view().time).toBe(30);
    controls.seek(-5);
    expect(controls.view().time).toBe(0);
    controls.seek(Number.NaN);
    expect(controls.view().time).toBe(0);
    controls.play();
    c.advance(1000);
    expect(controls.view()).toMatchObject({ status: 'playing' });
    expect(controls.view().time).toBeCloseTo(1, 9);

    controls.unmute();
    expect(controls.view().muted).toBe(false);
    controls.stop();
    expect(controls.view()).toEqual({
      videoId: null,
      status: 'idle',
      time: 0,
      duration: null,
      muted: false,
    });
    expect(player.state.videoId).toBeNull();
  });

  it('prefers the player duration over the catalog one', () => {
    const player = new FakeTvPlayer(null, () => 0);
    vi.spyOn(player, 'getDuration').mockReturnValue(300);
    const controls = new LocalTvControls(player, () => 120);
    controls.load('BBBBBBBBBBB');
    expect(controls.view().duration).toBe(300);
  });
});

describe('panel model', () => {
  const provider = new FakeVideoProvider();

  it('reads a pasted link or id, and rejects anything else with a message', () => {
    expect(readUrlField(provider, ' https://youtu.be/aqz-KE-bpKQ ')).toEqual({
      videoId: 'aqz-KE-bpKQ',
    });
    expect(readUrlField(provider, 'https://www.youtube.com/watch?v=eRsGyueVLvQ&t=3')).toEqual({
      videoId: 'eRsGyueVLvQ',
    });
    expect(readUrlField(provider, 'https://vimeo.com/123')).toEqual({ error: INVALID_URL_MESSAGE });
    expect(readUrlField(provider, 'not a url')).toEqual({ error: INVALID_URL_MESSAGE });
    expect(readUrlField(provider, '   ')).toEqual({ error: INVALID_URL_MESSAGE });
  });

  it('formats times as m:ss or h:mm:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5.9)).toBe('0:05');
    expect(formatTime(125)).toBe('2:05');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(-3)).toBe('0:00');
    expect(formatTime(Number.NaN)).toBe('0:00');
  });

  it('uses the duration as the seek range, or a range that contains the time', () => {
    expect(seekMax({ time: 10, duration: 120 })).toBe(120);
    expect(seekMax({ time: 10, duration: null })).toBe(600);
    expect(seekMax({ time: 900.2, duration: null })).toBe(961);
    expect(seekMax({ time: 0, duration: 0 })).toBe(600);
  });
});
