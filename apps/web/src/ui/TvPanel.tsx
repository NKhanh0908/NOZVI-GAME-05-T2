import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { TvControls, TvView, TvViewSource } from '../tv/controls';
import type { VideoProvider } from '../tv/provider';
import { formatTime, readUrlField, seekMax } from '../tv/panelModel';
import { VIDEO_ERROR_TITLE } from '../tv/videoError';
import type { TvNoticeSource } from '../tv/rateLimitNotice';
import { color, font, hudPanel, radius, space } from './tokens';

/** How often the panel refreshes the position and seek bar (ms). */
const VIEW_POLL_MS = 250;

type Props = {
  provider: VideoProvider;
  controls: TvControls;
  source: TvViewSource;
  /** T-1568: rate-limit message source; the panel shows its text while it is set. */
  notice?: TvNoticeSource;
  onClose(): void;
};

/**
 * REQ-TV-002, REQ-TV-003: the TV mode panel. Catalog, pasted link, play / pause / seek /
 * Stop, "Click to unmute" and an always-visible Close. It only calls {@link TvControls},
 * so the same panel drives the local player now and the room later (P4.9).
 */
export function TvPanel({ provider, controls, source, notice, onClose }: Props) {
  const [view, setView] = useState<TvView>(() => source.view());
  const [noticeText, setNoticeText] = useState<string | null>(() => notice?.message() ?? null);
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const seekRef = useRef<HTMLInputElement>(null);
  const catalog = provider.search('');

  useEffect(() => {
    const refresh = () => {
      setView(source.view());
      setNoticeText(notice?.message() ?? null); // the countdown follows the poll
    };
    const timer = setInterval(refresh, VIEW_POLL_MS);
    const offNotice = notice?.subscribe(() => setNoticeText(notice.message()));
    return () => {
      clearInterval(timer);
      offNotice?.();
    };
  }, [source, notice]);

  // Seek once the bar is released (native `change`), not on every `input` while dragging.
  useEffect(() => {
    const el = seekRef.current;
    if (!el) return;
    const commit = () => {
      controls.seek(Number(el.value));
      setScrub(null);
      setView(source.view());
    };
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, [controls, source]);

  const act = (run: () => void) => () => {
    run();
    setView(source.view());
  };
  const submitUrl = (e: FormEvent) => {
    e.preventDefault();
    const result = readUrlField(provider, url);
    if ('error' in result) {
      setUrlError(result.error);
      return;
    }
    if (source.errorFor(result.videoId)) {
      setUrlError(`${VIDEO_ERROR_TITLE}. Choose another video.`);
      return;
    }
    setUrlError(null);
    setUrl('');
    act(() => controls.load(result.videoId))();
  };

  const idle = view.status === 'idle';
  const current = view.videoId ? provider.getVideo(view.videoId) : null;
  const max = seekMax(view);
  return (
    <section
      aria-label="TV"
      data-testid="tv-panel"
      className="ov-hud"
      style={{
        ...hudPanel,
        position: 'absolute',
        top: space[4],
        left: space[4],
        width: 300,
        maxHeight: `calc(100% - ${space[6]})`,
        overflowY: 'auto',
        boxSizing: 'border-box',
        padding: space[3],
        fontSize: font.sm,
        display: 'flex',
        flexDirection: 'column',
        gap: space[3],
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: font.md }}>TV</strong>
        <span style={{ display: 'flex', gap: space[2], alignItems: 'center' }}>
          <span style={{ color: color.hudTextMuted, fontSize: font.xs }}>Esc</span>
          <button type="button" className="ov-button" onClick={onClose}>
            Close
          </button>
        </span>
      </header>

      <div data-testid="tv-now" style={{ color: color.hudTextMuted }}>
        {idle
          ? 'Nothing playing'
          : `${view.error ? "Can't play" : view.status === 'playing' ? 'Playing' : 'Paused'}: ${current?.title ?? view.videoId}`}
      </div>

      {noticeText && (
        <div role="status" data-testid="tv-rate-limited" style={{ color: color.hudDangerText }}>
          {noticeText}
        </div>
      )}

      {view.error && (
        <div
          role="alert"
          data-testid="tv-error"
          data-code={view.error.code}
          style={{
            background: color.hudDangerBg,
            border: `1px solid ${color.hudDangerBorder}`,
            borderRadius: radius.sm,
            padding: space[2],
            display: 'flex',
            flexDirection: 'column',
            gap: space[1],
          }}
        >
          <strong>{VIDEO_ERROR_TITLE}</strong>
          <span>{view.error.detail}</span>
          <span style={{ color: color.hudTextMuted }}>
            Choose another video from the catalog or paste a link.
          </span>
        </div>
      )}

      {view.muted && (
        <button type="button" className="ov-button-primary" onClick={act(() => controls.unmute())}>
          Click to unmute
        </button>
      )}

      <div style={{ display: 'flex', gap: space[2] }}>
        <button
          type="button"
          className="ov-button"
          disabled={idle}
          onClick={act(() => controls.play())}
        >
          Play
        </button>
        <button
          type="button"
          className="ov-button"
          disabled={idle}
          onClick={act(() => controls.pause())}
        >
          Pause
        </button>
        <button
          type="button"
          className="ov-button"
          disabled={idle}
          onClick={act(() => controls.stop())}
        >
          Stop
        </button>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: space[1] }}>
        <span style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Seek</span>
          <span data-testid="tv-time">
            {formatTime(scrub ?? view.time)} /{' '}
            {view.duration === null ? '--:--' : formatTime(view.duration)}
          </span>
        </span>
        <input
          ref={seekRef}
          type="range"
          className="ov-range"
          aria-label="Seek"
          min={0}
          max={max}
          step={1}
          disabled={idle}
          value={Math.min(max, scrub ?? view.time)}
          onChange={(e) => setScrub(Number(e.target.value))}
        />
      </label>

      <form
        onSubmit={submitUrl}
        style={{ display: 'flex', flexDirection: 'column', gap: space[1] }}
      >
        <label htmlFor="tv-url">YouTube link</label>
        <span style={{ display: 'flex', gap: space[2] }}>
          <input
            id="tv-url"
            className="ov-input"
            type="text"
            value={url}
            placeholder="https://youtu.be/…"
            autoComplete="off"
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlError(null);
            }}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button type="submit" className="ov-button">
            Play link
          </button>
        </span>
        {urlError && (
          <span role="alert" style={{ color: color.hudDangerText }}>
            {urlError}
          </span>
        )}
      </form>

      <div>
        <div style={{ fontWeight: font.bold, marginBottom: space[1] }}>Catalog</div>
        {catalog.length === 0 ? (
          <div data-testid="tv-catalog-empty" style={{ color: color.hudTextMuted }}>
            No videos in the catalog. Paste a YouTube link above.
          </div>
        ) : (
          <ul aria-label="Catalog" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {catalog.map((v) => {
              const failed = source.errorFor(v.id) !== null;
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    aria-pressed={v.id === view.videoId}
                    disabled={failed}
                    title={failed ? VIDEO_ERROR_TITLE : undefined}
                    onClick={act(() => controls.load(v.id))}
                    className="ov-button"
                    style={{
                      width: '100%',
                      margin: '2px 0',
                      display: 'flex',
                      alignItems: 'center',
                      gap: space[2],
                      textAlign: 'left',
                      fontWeight: font.medium,
                      ...(v.id === view.videoId && {
                        background: color.selected,
                        borderColor: color.accent,
                      }),
                    }}
                  >
                    {v.thumbnail && (
                      <img
                        src={v.thumbnail}
                        alt=""
                        width={48}
                        height={27}
                        loading="lazy"
                        style={{ objectFit: 'cover', borderRadius: radius.sm }}
                      />
                    )}
                    <span>{v.title}</span>
                    {failed && (
                      <span style={{ marginLeft: 'auto', fontSize: font.xs }}>Can't play</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
