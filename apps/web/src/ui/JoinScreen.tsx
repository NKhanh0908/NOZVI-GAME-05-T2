import { useState, type CSSProperties } from 'react';
import { AVATAR_IDS, normalizeOfficeCode, validateName, type AvatarId } from '@office/protocol';
import { toConnectionError, type ConnectionErrorCode } from '../net';
import { loadDraft, safeLocalStorage, saveDraft } from './identityStorage';
import { color, font, radius, shadow, space } from './tokens';

export type JoinResult = { name: string; officeCode: string; avatarId: AvatarId };
const LABEL: Record<AvatarId, string> = { men_suit: 'Suit (men)', women_suit: 'Suit (women)' };

/** Player-facing text for each failed join; the form stays editable so the user can retry. */
export const JOIN_ERROR_TEXT: Record<ConnectionErrorCode, string> = {
  room_full: 'This office is full (10 people). Try again later or use another office code.',
  unreachable: 'Cannot reach the office server. Check your connection and try again.',
  invalid_identity: 'The server rejected this name or office code. Check them and try again.',
  version_mismatch: 'This page is out of date. Reload the page and try again.',
  rate_limited: 'Too many join attempts. Wait a minute and try again.',
  unknown: 'Could not join the office. Please try again.',
};

/** `onJoin` connects to the office; it rejects with a `ConnectionError` on failure. */
export function JoinScreen({ onJoin }: { onJoin(r: JoinResult): Promise<void> }) {
  const [draft, setDraft] = useState(() => loadDraft(safeLocalStorage()));
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  /** The identity of the last join that failed on the server side; enables Retry. */
  const [failed, setFailed] = useState<JoinResult | null>(null);
  const attempt = (result: JoinResult) => {
    if (connecting) return;
    setError(null);
    setFailed(null);
    setConnecting(true);
    onJoin(result).catch((err: unknown) => {
      setConnecting(false);
      setFailed(result);
      setError(JOIN_ERROR_TEXT[toConnectionError(err).code]);
    });
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (connecting) return;
    const name = validateName(draft.name);
    const officeCode = normalizeOfficeCode(draft.officeCode);
    setFailed(null);
    if (!name) return setError('Name must be 1–20 characters, without < or >.');
    if (!officeCode) return setError('Office code must be 4–12 letters, digits or "-".');
    const result = { name, officeCode, avatarId: draft.avatarId };
    saveDraft(safeLocalStorage(), result);
    attempt(result);
  };
  return (
    <main style={page}>
      <form onSubmit={submit} data-testid="join" aria-busy={connecting} style={card}>
        <header style={{ display: 'grid', gap: space[1] }}>
          <h1 style={{ margin: 0, fontSize: font.xl, fontWeight: font.bold }}>Virtual Office</h1>
          <p style={{ margin: 0, color: color.textMuted, fontSize: font.sm }}>
            Enter your name and the office code your team shares.
          </p>
        </header>
        <label style={field}>
          Your name
          <input
            name="name"
            className="ov-input"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label style={field}>
          Office code
          <input
            name="officeCode"
            className="ov-input"
            value={draft.officeCode}
            onChange={(e) => setDraft({ ...draft, officeCode: e.target.value })}
          />
        </label>
        <fieldset
          style={{
            margin: 0,
            padding: `${space[2]} ${space[3]} ${space[3]}`,
            border: `1px solid ${color.border}`,
            borderRadius: radius.md,
            display: 'flex',
            flexWrap: 'wrap',
            gap: space[4],
          }}
        >
          <legend style={{ fontWeight: font.bold, fontSize: font.sm, padding: `0 ${space[1]}` }}>
            Avatar
          </legend>
          {AVATAR_IDS.map((id) => (
            <label key={id} style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
              <input
                type="radio"
                name="avatar"
                className="ov-radio"
                value={id}
                checked={draft.avatarId === id}
                onChange={() => setDraft({ ...draft, avatarId: id })}
              />
              {LABEL[id]}
            </label>
          ))}
        </fieldset>
        {error && (
          <p role="alert" style={{ color: color.danger, margin: 0, fontWeight: font.medium }}>
            {error}
          </p>
        )}
        {failed && !connecting && (
          <button type="button" className="ov-button-quiet" onClick={() => attempt(failed)}>
            Retry
          </button>
        )}
        {connecting && (
          <p role="status" style={{ margin: 0, color: color.textMuted }}>
            Connecting to the office…
          </p>
        )}
        <button type="submit" className="ov-button-primary" disabled={connecting}>
          Join Office
        </button>
      </form>
    </main>
  );
}

const page: CSSProperties = {
  boxSizing: 'border-box',
  height: '100%',
  overflowY: 'auto',
  padding: `12vh ${space[4]} ${space[4]}`,
  background: color.page,
};
const card: CSSProperties = {
  boxSizing: 'border-box',
  maxWidth: 400,
  margin: '0 auto',
  display: 'grid',
  gap: space[4],
  padding: space[5],
  color: color.text,
  background: color.surfaceLight,
  borderRadius: radius.lg,
  boxShadow: shadow[2],
  fontFamily: font.family,
  fontSize: font.md,
  lineHeight: font.lineHeight,
};
const field: CSSProperties = {
  display: 'grid',
  gap: space[1],
  fontWeight: font.bold,
  fontSize: font.sm,
};
