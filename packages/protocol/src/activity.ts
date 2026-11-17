import { BALANCE } from './balance';

export type Activity =
  'idle' | 'walking' | 'sitting' | 'working' | 'resting' | 'drinking' | 'waving' | 'brewing';
export type ActivityEvent =
  | { type: 'move' }
  | { type: 'stop' }
  | { type: 'sit'; kind: 'desk' | 'sofa' }
  | { type: 'toggleWork' }
  | { type: 'stand' }
  | { type: 'drink' }
  | { type: 'wave' }
  | { type: 'actionDone' }
  /** REQ-INT-003: start brewing at the coffee machine (only with an empty hand). */
  | { type: 'brew' }
  /** REQ-INT-003: the brew time is up; the employee now holds a coffee. */
  | { type: 'brewDone' };

/** REQ-INT-003: what an employee carries. `''` is an empty hand; there is no inventory. */
export const ITEMS = ['', 'coffee'] as const;
export type Item = (typeof ITEMS)[number];
/** The replicated `item` and `sips` pair; `sips` is 0 whenever `item` is empty. */
export type Held = { item: Item; sips: number };
export const EMPTY_HAND: Readonly<Held> = Object.freeze({ item: '', sips: 0 });

const SEATED: ReadonlySet<Activity> = new Set(['sitting', 'working', 'resting']);
const FREE: ReadonlySet<Activity> = new Set(['idle', 'walking']);

export const isSeated = (a: Activity): boolean => SEATED.has(a);
export const statusFor = (a: Activity): 'online' | 'working' =>
  a === 'working' ? 'working' : 'online';
/** A replicated item string as an `Item`; unknown values read as an empty hand. */
export const toItem = (v: string): Item =>
  (ITEMS as readonly string[]).includes(v) ? (v as Item) : '';

/**
 * Activity after event `e`. `item` is what the employee holds before the event: brewing
 * needs an empty hand. A `drink` with a coffee is one sip and uses the same `drinking`
 * activity and timer as a drink at the machine or dispenser; `nextHeld` counts the sip.
 * Moving cancels `drinking`, `waving` and `brewing` (activity becomes walking).
 */
export function nextActivity(a: Activity, e: ActivityEvent, item: Item = ''): Activity {
  switch (e.type) {
    case 'move':
      return isSeated(a) ? a : 'walking';
    case 'stop':
      return a === 'walking' ? 'idle' : a;
    case 'sit':
      return FREE.has(a) ? (e.kind === 'desk' ? 'sitting' : 'resting') : a;
    case 'toggleWork':
      return a === 'sitting' ? 'working' : a === 'working' ? 'sitting' : a;
    case 'stand':
      return isSeated(a) ? 'idle' : a;
    case 'drink':
      return FREE.has(a) ? 'drinking' : a;
    case 'wave':
      return FREE.has(a) ? 'waving' : a;
    case 'actionDone':
      return a === 'drinking' || a === 'waving' ? 'idle' : a;
    case 'brew':
      return FREE.has(a) && item === '' ? 'brewing' : a;
    case 'brewDone':
      return a === 'brewing' ? 'idle' : a;
  }
}

/**
 * REQ-INT-003: held item after event `e`, given activity `a` before the event. A finished
 * brew gives a coffee with `BALANCE.coffee.sips` sips; a finished sip (`actionDone` while
 * `drinking` with a coffee) takes one, and the cup is gone after the last. A cancelled
 * brew or sip changes nothing.
 */
export function nextHeld(a: Activity, held: Held, e: ActivityEvent): Held {
  if (e.type === 'brewDone' && a === 'brewing' && held.item === '') {
    return { item: 'coffee', sips: BALANCE.coffee.sips };
  }
  if (e.type === 'actionDone' && a === 'drinking' && held.item === 'coffee') {
    return held.sips > 1 ? { item: 'coffee', sips: held.sips - 1 } : { ...EMPTY_HAND };
  }
  return held;
}
