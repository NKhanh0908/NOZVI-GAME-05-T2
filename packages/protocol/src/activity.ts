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

/**
 * REQ-AVATAR-004: the fixed emote list (owner, DECISIONS 2026-11-17). An `emote` intent
 * carries exactly one of these ids; there is no free text (the prototype is chat-free).
 */
export const EMOTES = ['wave', 'dance', 'think', 'laugh', 'stretch'] as const;
export type EmoteId = (typeof EMOTES)[number];
export const isEmoteId = (v: unknown): v is EmoteId =>
  typeof v === 'string' && (EMOTES as readonly string[]).includes(v);
/** A replicated `emote` string as an `EmoteId`; `''` (none) and unknown values read as `''`. */
export const toEmote = (v: string): EmoteId | '' => (isEmoteId(v) ? v : '');

/** Emotes played by a full-body clip (`Dance_Loop`), which a seated pose cannot play. */
const STANDING_ONLY_EMOTES: ReadonlySet<EmoteId> = new Set(['dance']);

/**
 * The posture an emote is bound to: `'standing'` for idle and walking, the seated activity
 * itself while seated, and null where emotes are refused (drinking, waving, brewing).
 */
export type EmotePosture = 'standing' | 'sitting' | 'working' | 'resting';
export function emotePosture(a: Activity): EmotePosture | null {
  if (FREE.has(a)) return 'standing';
  return a === 'sitting' || a === 'working' || a === 'resting' ? a : null;
}

/**
 * REQ-AVATAR-004 allowed states (DECISIONS 2026-11-17, T-1220): every emote while standing
 * (idle or walking) and every emote but `dance` while seated. Refused while drinking,
 * waving (the legacy `wave` intent) or brewing. What the employee holds does not matter:
 * an emote with a coffee in hand is allowed and leaves the cup and its sips unchanged.
 * Emotes are a layer over the activity: starting one never changes `activity`.
 */
export function canEmote(a: Activity, emote: EmoteId): boolean {
  const posture = emotePosture(a);
  return posture !== null && (posture === 'standing' || !STANDING_ONLY_EMOTES.has(emote));
}

/**
 * True while a running emote may go on after the activity went from `started` (when the
 * emote began) to `now`: the posture is the same. Any other activity change (sitting,
 * standing up, toggling work, drinking, waving, brewing) ends the emote. Movement input
 * ends it separately, because walking keeps the standing posture.
 */
export function emoteContinues(started: Activity, now: Activity): boolean {
  const posture = emotePosture(started);
  return posture !== null && posture === emotePosture(now);
}
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
