import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TvControls, TvView, TvViewSource } from '../../src/tv/controls';
import { FakeVideoProvider } from '../../src/tv/provider';
import { rateLimitMessage, TvRateLimitNotice } from '../../src/tv/rateLimitNotice';
import { TvPanel } from '../../src/ui/TvPanel';

// T-1568 (REQ-NFR-005): the server's tv_rate_limited notice becomes a visible TV panel
// message that clears after retryAfterMs.

/** Manual clock and timers. */
function clock() {
  let t = 1_000;
  const pending: { at: number; run: () => void; handle: number }[] = [];
  let next = 1;
  return {
    now: () => t,
    timers: {
      set: (run: () => void, ms: number) => {
        const handle = next++;
        pending.push({ at: t + ms, run, handle });
        return handle;
      },
      clear: (handle: unknown) => {
        const i = pending.findIndex((p) => p.handle === handle);
        if (i >= 0) pending.splice(i, 1);
      },
    },
    advance(ms: number) {
      t += ms;
      for (const p of pending.filter((p) => p.at <= t)) {
        pending.splice(pending.indexOf(p), 1);
        p.run();
      }
    },
    get pending() {
      return pending.length;
    },
  };
}

const IDLE: TvView = {
  videoId: null,
  status: 'idle',
  time: 0,
  duration: null,
  muted: true,
  error: null,
};

function panelHtml(notice: TvRateLimitNotice): string {
  const source: TvViewSource = { view: () => IDLE, errorFor: () => null };
  return renderToStaticMarkup(
    createElement(TvPanel, {
      provider: new FakeVideoProvider(),
      controls: {} as TvControls,
      source,
      notice,
      onClose: () => undefined,
    }),
  );
}

describe('TvRateLimitNotice (T-1568)', () => {
  it('shows a countdown message and clears itself after retryAfterMs', () => {
    const c = clock();
    const notice = new TvRateLimitNotice(c.now, c.timers);
    const changes = vi.fn();
    notice.subscribe(changes);
    expect(notice.message()).toBeNull();

    notice.show(4_200);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(notice.message()).toBe(rateLimitMessage(5));
    c.advance(1_500);
    expect(notice.message()).toBe('Too many TV commands, try again in 3 s.');
    c.advance(2_699);
    expect(notice.message()).toBe(rateLimitMessage(1));
    c.advance(1);
    expect(notice.message()).toBeNull();
    expect(changes).toHaveBeenCalledTimes(2); // cleared by its own timer
    expect(c.pending).toBe(0);
  });

  it('a later notice replaces the earlier block', () => {
    const c = clock();
    const notice = new TvRateLimitNotice(c.now, c.timers);
    notice.show(2_000);
    c.advance(1_000);
    notice.show(3_000);
    expect(c.pending).toBe(1);
    c.advance(2_000);
    expect(notice.message()).toBe(rateLimitMessage(1));
    c.advance(1_000);
    expect(notice.message()).toBeNull();
  });

  it('dispose cancels the timer and drops listeners', () => {
    const c = clock();
    const notice = new TvRateLimitNotice(c.now, c.timers);
    const changes = vi.fn();
    notice.subscribe(changes);
    notice.show(1_000);
    notice.dispose();
    expect(c.pending).toBe(0);
    notice.show(1_000);
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('the TV panel shows the message while blocked and not after retryAfterMs', () => {
    const c = clock();
    const notice = new TvRateLimitNotice(c.now, c.timers);
    expect(panelHtml(notice)).not.toContain('tv-rate-limited');

    notice.show(10_000);
    const html = panelHtml(notice);
    expect(html).toContain('data-testid="tv-rate-limited"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Too many TV commands, try again in 10 s.');

    c.advance(10_000);
    expect(panelHtml(notice)).not.toContain('tv-rate-limited');
  });
});
