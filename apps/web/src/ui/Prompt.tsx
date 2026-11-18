import type { Prompt as P } from '../game/interaction/InteractionController';
import { color, font, hudPanel, space } from './tokens';

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
    </div>
  );
}
