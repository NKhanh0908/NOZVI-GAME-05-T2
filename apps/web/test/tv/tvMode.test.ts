import { describe, expect, it, vi } from 'vitest';
import { TvMode } from '../../src/tv/TvMode';
import { INVALID_URL_MESSAGE, formatTime, readUrlField, seekMax } from '../../src/tv/panelModel';
import { FakeVideoProvider } from '../../src/tv/provider';

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
