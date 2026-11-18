import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { EMOTES, type EmoteId } from '@office/protocol';
import { color, font, hudPanel, space } from './tokens';

/** Icon and label per emote (REQ-AVATAR-004); the ids come from the protocol list. */
export const EMOTE_UI: Record<EmoteId, { icon: string; label: string }> = {
  wave: { icon: '👋', label: 'Wave' },
  dance: { icon: '💃', label: 'Dance' },
  think: { icon: '🤔', label: 'Think' },
  laugh: { icon: '😂', label: 'Laugh' },
  stretch: { icon: '🙆', label: 'Stretch' },
};

export const EMOTE_MENU_ID = 'emote-menu';

type ListProps = {
  /** Whether the current activity allows the emote (`canEmote`); others are disabled. */
  allowed(emote: EmoteId): boolean;
  onPick(emote: EmoteId): void;
  onClose(): void;
};

/** The open menu: one button per protocol emote; Escape closes it. Stateless for tests. */
export function EmoteMenuList({ allowed, onPick, onClose }: ListProps) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  return (
    <div
      id={EMOTE_MENU_ID}
      role="group"
      aria-label="Emotes"
      data-testid="emote-menu"
      onKeyDown={onKeyDown}
      style={{ display: 'flex', flexDirection: 'column', gap: space[1] }}
    >
      {EMOTES.map((id) => {
        const ok = allowed(id);
        return (
          <button
            key={id}
            type="button"
            className="ov-button"
            data-emote={id}
            disabled={!ok}
            title={ok ? undefined : 'Not available right now'}
            onClick={() => onPick(id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space[2],
              textAlign: 'left',
              fontSize: font.sm,
            }}
          >
            <span aria-hidden="true" style={{ fontSize: font.lg, lineHeight: 1 }}>
              {EMOTE_UI[id].icon}
            </span>
            {EMOTE_UI[id].label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * REQ-AVATAR-004, REQ-UI-001 (T-1222): the emote button and menu. Picking an emote sends it
 * and closes the menu; Escape closes it too. Closing hands keyboard and pointer focus back
 * to the game (`onDone`). The G key keeps sending the wave emote.
 */
export function EmoteMenu({
  allowed,
  onEmote,
  onDone,
}: {
  allowed(emote: EmoteId): boolean;
  onEmote(emote: EmoteId): void;
  onDone(): void;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    onDone();
  };
  return (
    <div
      className="ov-hud"
      style={{
        position: 'absolute',
        bottom: space[4],
        left: space[4],
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: space[2],
      }}
    >
      {open && (
        <div ref={menu} style={{ ...hudPanel, padding: space[2], minWidth: 140 }}>
          <EmoteMenuList
            allowed={allowed}
            onPick={(id) => {
              onEmote(id);
              close();
            }}
            onClose={close}
          />
        </div>
      )}
      <div
        style={{
          ...hudPanel,
          display: 'flex',
          alignItems: 'center',
          gap: space[3],
          padding: `${space[1]} ${space[3]} ${space[1]} ${space[1]}`,
          fontSize: font.xs,
          fontWeight: font.bold,
        }}
      >
        <button
          type="button"
          className="ov-button"
          aria-expanded={open}
          aria-controls={EMOTE_MENU_ID}
          onClick={() => (open ? close() : setOpen(true))}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && open) close();
          }}
        >
          <span aria-hidden="true">🙂</span> Emotes
        </button>
        <span style={{ color: color.hudTextMuted }}>G — Wave</span>
      </div>
    </div>
  );
}
