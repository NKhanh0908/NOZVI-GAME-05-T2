import { nextActivity, officeLayout, type Interactable } from '@office/protocol';
import type { InteractionController, PlayerLike } from './InteractionController';

export type ActionResult = { message?: string };

/** Toast and prompt text when another employee is brewing (REQ-INT-003, T-1154). */
export const MACHINE_IN_USE = 'Machine in use';

/**
 * REQ-INT-003/004: pantry, sofa rest and cabinet feedback. Pantry actions and sofa rest are
 * sent as intents (the server runs the timers); cabinet feedback stays local.
 * - Coffee machine: `brew` with an empty hand (T-1154). The server refuses a busy machine
 *   without a reply, so a machine busy in room state is answered here with "Machine in use".
 * - Water dispenser: the single-step `drink` with an empty hand (it shows a glass).
 */
export function handleAction(
  t: Interactable,
  player: PlayerLike,
  c: InteractionController,
): ActionResult {
  const a = player.activity;
  const item = player.item ?? '';
  if (t.type === 'coffee_machine') {
    if (nextActivity(a, { type: 'brew' }, item) === a) return {};
    if (c.machineBusy()) return { message: MACHINE_IN_USE };
    c.request({ type: 'brew' });
    return {};
  }
  if (t.type === 'water_dispenser') {
    if (item === '' && nextActivity(a, { type: 'drink' }, item) !== a) {
      c.request({ type: 'drink' });
    }
    return {};
  }
  if (t.type === 'sofa') {
    for (const seat of officeLayout.sofaSeats) if (c.requestSeat(seat.id, 'sofa')) break;
    return {};
  }
  if (t.type === 'storage_cabinet') return { message: 'Cabinet opened' };
  return {};
}
