import type { Prompt as P } from '../game/interaction/InteractionController';
import { color, font, hudPanel, radius, space } from './tokens';

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
      {prompt.text}
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
