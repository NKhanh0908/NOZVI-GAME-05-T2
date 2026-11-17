import { useEffect, useState } from 'react';
import type { ConnectionError, ConnectionStatus, ReconnectState } from '../net';
import { JOIN_ERROR_TEXT } from './JoinScreen';
import { color, font, hudPanel, space } from './tokens';

/** Banner text for a state; null hides the banner. Pure, so tests need no DOM. */
export function bannerText(
  status: ConnectionStatus,
  reconnect: ReconnectState,
  now: number,
): string | null {
  switch (status) {
    case 'reconnecting': {
      if (reconnect.status !== 'reconnecting' || reconnect.retryAt === null) {
        return 'Reconnecting…';
      }
      const seconds = Math.max(0, Math.ceil((reconnect.retryAt - now) / 1000));
      return `Reconnecting… retry in ${seconds} s`;
    }
    case 'lost':
    case 'error':
      return 'Connection lost';
    case 'connecting':
      return 'Rejoining…';
    default:
      return null;
  }
}

/**
 * REQ-NET-005, REQ-NET-006: shown over the office while the connection is down. During the
 * backoff it counts down to the next attempt; once the attempts are used up (or the
 * reservation expired) it offers Rejoin, which resumes or joins afresh with the same
 * name, office code and avatar.
 */
export function ConnectionBanner({
  status,
  reconnect,
  error,
  onRejoin,
}: {
  status: ConnectionStatus;
  reconnect: ReconnectState;
  error: ConnectionError | null;
  onRejoin(): void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const counting = status === 'reconnecting';
  // Restarted on every backoff step, so a new countdown never starts from a stale clock.
  useEffect(() => {
    if (!counting) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [counting, reconnect]);
  const text = bannerText(status, reconnect, now);
  if (text === null) return null;
  const canRejoin = status === 'lost' || status === 'error';
  // After a failed Rejoin, say why (e.g. the server is still unreachable or the room is full).
  const detail = canRejoin && error ? JOIN_ERROR_TEXT[error.code] : null;
  return (
    <div
      data-testid="connection-banner"
      role={canRejoin ? 'alert' : 'status'}
      className={canRejoin ? 'ov-hud ov-alert' : 'ov-hud'}
      style={{
        ...hudPanel,
        position: 'absolute',
        top: space[4],
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: space[3],
        maxWidth: `calc(100% - ${space[6]})`,
        color: canRejoin ? color.alertText : color.hudText,
        background: canRejoin ? color.alert : color.hud,
        padding: `${space[2]} ${space[4]}`,
        fontSize: font.sm,
        fontWeight: font.bold,
      }}
    >
      <span data-testid="connection-banner-text">{text}</span>
      {detail && <span style={{ fontWeight: font.regular, fontSize: font.xs }}>{detail}</span>}
      {canRejoin && (
        <button type="button" className="ov-button" onClick={onRejoin}>
          Rejoin
        </button>
      )}
    </div>
  );
}
