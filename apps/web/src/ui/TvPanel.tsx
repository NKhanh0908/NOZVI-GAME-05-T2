import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import type { TvControls, TvView, TvViewSource } from '../tv/controls';
import type { VideoProvider } from '../tv/provider';
import { formatTime, readUrlField, seekMax } from '../tv/panelModel';

/** How often the panel refreshes the position and seek bar (ms). */
const VIEW_POLL_MS = 250;

type Props = {
  provider: VideoProvider;
  controls: TvControls;
  source: TvViewSource;
  onClose(): void;
};

const button: CSSProperties = {
  font: '600 13px system-ui',
  color: '#fff',
  background: 'rgba(255,255,255,0.12)',
  border: '1px solid rgba(255,255,255,0.25)',
  borderRadius: 6,
  padding: '6px 10px',
  cursor: 'pointer',
};

/**
 * REQ-TV-002, REQ-TV-003: the TV mode panel. Catalog, pasted link, play / pause / seek /
 * Stop, "Click to unmute" and an always-visible Close. It only calls {@link TvControls},
 * so the same panel drives the local player now and the room later (P4.9).
 */
export function TvPanel({ provider, controls, source, onClose }: Props) {
  const [view, setView] = useState<TvView>(() => source.view());
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const seekRef = useRef<HTMLInputElement>(null);
  const catalog = provider.search('');

  useEffect(() => {
    const refresh = () => setView(source.view());
    const timer = setInterval(refresh, VIEW_POLL_MS);
    return () => clearInterval(timer);
  }, [source]);

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
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        width: 300,
        maxHeight: 'calc(100% - 32px)',
        overflowY: 'auto',
        boxSizing: 'border-box',
        color: '#fff',
        background: 'rgba(34,36,38,0.9)',
        borderRadius: 8,
        padding: 12,
        font: '13px system-ui',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 15 }}>TV</strong>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ opacity: 0.6, fontSize: 12 }}>Esc</span>
          <button type="button" style={button} onClick={onClose}>
            Close
          </button>
        </span>
      </header>

      <div data-testid="tv-now" style={{ opacity: 0.85 }}>
        {idle
          ? 'Nothing playing'
          : `${view.status === 'playing' ? 'Playing' : 'Paused'}: ${current?.title ?? view.videoId}`}
      </div>

      {view.muted && (
        <button
          type="button"
          style={{ ...button, background: '#2f6fdb' }}
          onClick={act(() => controls.unmute())}
        >
          Click to unmute
        </button>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" style={button} disabled={idle} onClick={act(() => controls.play())}>
          Play
        </button>
        <button type="button" style={button} disabled={idle} onClick={act(() => controls.pause())}>
          Pause
        </button>
        <button type="button" style={button} disabled={idle} onClick={act(() => controls.stop())}>
          Stop
        </button>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
          aria-label="Seek"
          min={0}
          max={max}
          step={1}
          disabled={idle}
          value={Math.min(max, scrub ?? view.time)}
          onChange={(e) => setScrub(Number(e.target.value))}
        />
      </label>

      <form onSubmit={submitUrl} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label htmlFor="tv-url">YouTube link</label>
        <span style={{ display: 'flex', gap: 6 }}>
          <input
            id="tv-url"
            type="text"
            value={url}
            placeholder="https://youtu.be/…"
            autoComplete="off"
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlError(null);
            }}
            style={{ flex: 1, minWidth: 0, font: '13px system-ui', padding: '5px 6px' }}
          />
          <button type="submit" style={button}>
            Play link
          </button>
        </span>
        {urlError && (
          <span role="alert" style={{ color: '#f5a3a3' }}>
            {urlError}
          </span>
        )}
      </form>

      <div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Catalog</div>
        {catalog.length === 0 ? (
          <div data-testid="tv-catalog-empty" style={{ opacity: 0.7 }}>
            No videos in the catalog. Paste a YouTube link above.
          </div>
        ) : (
          <ul aria-label="Catalog" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {catalog.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  aria-pressed={v.id === view.videoId}
                  onClick={act(() => controls.load(v.id))}
                  style={{
                    ...button,
                    width: '100%',
                    margin: '2px 0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    textAlign: 'left',
                    fontWeight: 500,
                    background: v.id === view.videoId ? 'rgba(47,111,219,0.6)' : button.background,
                  }}
                >
                  {v.thumbnail && (
                    <img
                      src={v.thumbnail}
                      alt=""
                      width={48}
                      height={27}
                      loading="lazy"
                      style={{ objectFit: 'cover', borderRadius: 3 }}
                    />
                  )}
                  <span>{v.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
