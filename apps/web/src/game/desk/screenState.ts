import type { OfficeLayout } from '@office/protocol';
import type { OccupancyRoom } from '../../net';

/**
 * REQ-INT-002 (T-1155, plan phase-4.1 §3.3): what a desk's monitor shows. `off` for an empty
 * desk, `locked` while the occupant is seated but not working, `desktop` while they work.
 */
export type ScreenState = 'off' | 'locked' | 'desktop';

/** The screen state for a desk whose seat is held by an employee with `activity` (or nobody). */
export function screenStateFor(occupantActivity: string | null): ScreenState {
  if (occupantActivity === null) return 'off';
  return occupantActivity === 'working' ? 'desktop' : 'locked';
}

/** The desk lamp is lit while its desk shows the desktop. */
export const lampLit = (state: ScreenState): boolean => state === 'desktop';

/** Desk item id per workstation seat id (`ws_7_seat` -> `ws_7_desk`), from the layout. */
export function deskBySeat(layout: OfficeLayout): Map<string, string> {
  return new Map(layout.workstations.map((ws) => [ws.seat.id, `${ws.id}_desk`]));
}

/**
 * REQ-INT-002, REQ-NET-002 (T-1155): every desk's screen state, derived from the replicated
 * `seatId` and `activity` of every employee in the room, the local one included, so each
 * client shows the same screens without new network state. Desks not listed in `desks`
 * (sofa seats) are ignored; desks nobody sits at are `off`.
 */
export function deskScreenStates(
  room: OccupancyRoom,
  desks: ReadonlyMap<string, string>,
): Map<string, ScreenState> {
  const states = new Map<string, ScreenState>();
  for (const deskId of desks.values()) states.set(deskId, 'off');
  room.state?.employees?.forEach((employee) => {
    const deskId = desks.get(employee.seatId);
    if (deskId === undefined) return;
    states.set(deskId, screenStateFor(employee.activity ?? ''));
  });
  return states;
}
