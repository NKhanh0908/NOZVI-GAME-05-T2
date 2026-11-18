import { useSyncExternalStore } from 'react';
import type { EmployeeRoster } from './employeeRoster';
import { color, font, hudPanel, space } from './tokens';

/** Dev-only render counter read by e2e (`window.__officeListRenders`). */
function countRender(): void {
  if (!import.meta.env.DEV) return;
  const w = window as unknown as { __officeListRenders?: number };
  w.__officeListRenders = (w.__officeListRenders ?? 0) + 1;
}

/**
 * 2D panel listing every employee in the room (REQ-UI-003). Subscribed to the roster, so it
 * re-renders only when the list or a label changes, never per frame. Names render as text.
 */
export function EmployeeList({ roster }: { roster: EmployeeRoster }) {
  const entries = useSyncExternalStore(roster.subscribe, roster.getSnapshot);
  countRender();
  return (
    <section
      aria-label="Online employees"
      style={{
        ...hudPanel,
        position: 'absolute',
        top: space[4],
        right: space[4],
        minWidth: 160,
        maxWidth: 240,
        padding: `${space[2]} ${space[3]}`,
        fontSize: font.sm,
        pointerEvents: 'none',
      }}
    >
      <div style={{ fontWeight: font.bold, marginBottom: space[1] }}>Online ({entries.length})</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {entries.map((e) => (
          <li
            key={e.sessionId}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: space[3],
              padding: '2px 0',
              // Disconnected rows are muted and italic (not faded, which would break contrast).
              color: e.connected ? color.hudText : color.hudTextMuted,
              fontStyle: e.connected ? 'normal' : 'italic',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span data-testid="employee-name">
                {/* One text node for the local row: "Name (you)". */}
                {e.isLocal ? `${e.name} (you)` : e.name}
              </span>
            </span>
            <span data-testid="employee-label" style={{ color: color.hudTextMuted }}>
              {e.label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
