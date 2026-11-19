import type { Prompt as P } from '../game/interaction/InteractionController';
import { color, font, hudPanel, radius, space } from './tokens';

/** One `KEY — Action` part of a prompt, or plain text when it names no key. */
export type PromptPart = { key: string; action: string } | { text: string };

const SEPARATOR = ' · ';
const KEY_ACTION = /^(\S+) — (.+)$/;

/** Splits prompt text into parts so the key renders as a keycap (T-1156). */
export function promptParts(text: string): PromptPart[] {
  return text.split(SEPARATOR).map((part) => {
    const match = KEY_ACTION.exec(part);
    return match ? { key: match[1]!, action: match[2]! } : { text: part };
  });
}

const keycap = {
  display: 'inline-block',
  minWidth: '1.6em',
  padding: `0 ${space[1]}`,
  marginRight: space[1],
  border: `1px solid ${color.hudBorder}`,
  borderRadius: radius.sm,
  background: color.hudControl,
  color: color.hudText,
  fontFamily: font.family,
  fontSize: font.sm,
  fontWeight: font.bold,
  textAlign: 'center',
} as const;

export function Prompt({ prompt }: { prompt: P }) {
  if (!prompt) return null;
  return (
    <div
      data-testid="prompt"
      style={{
        ...hudPanel,
        position: 'absolute',
        bottom: space[6],
        left: '50%',
        transform: 'translateX(-50%)',
        padding: `${space[2]} ${space[4]}`,
        color: prompt.available ? color.hudText : color.hudDangerText,
        fontSize: font.md,
        fontWeight: font.bold,
        whiteSpace: 'nowrap',
      }}
    >
      {promptParts(prompt.text).map((part, i) => (
        <span key={i}>
          {i > 0 && SEPARATOR}
          {'key' in part ? (
            <>
              <kbd style={keycap}>{part.key}</kbd>
              {/* Keeps the text content "KEY — Action" for screen readers and tests. */}
              <span style={{ fontSize: 0 }}> — </span>
              {part.action}
            </>
          ) : (
            part.text
          )}
        </span>
      ))}
      {prompt.progress !== undefined && (
        <div
          data-testid="prompt-progress"
          role="progressbar"
          aria-label="Brewing progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(prompt.progress * 100)}
          style={{
            marginTop: space[1],
            height: space[1],
            borderRadius: radius.sm,
            background: color.hudControl,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.round(prompt.progress * 100)}%`,
              height: '100%',
              background: color.accent,
            }}
          />
        </div>
      )}
    </div>
  );
}
