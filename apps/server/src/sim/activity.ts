import {
  BALANCE,
  SeatRegistry,
  EMPTY_HAND,
  canEmote,
  emoteContinues,
  isSeated,
  nextActivity,
  nextHeld,
  officeLayout,
  parseIntent,
  type Aabb,
  type Activity,
  type Held,
  type IntentMessage,
  type Interactable,
  type OfficeLayout,
  type Vec3,
} from '@office/protocol';
import { MovementSim, stepBody, type MovementBody } from './movement';

/** The replicated fields the activity simulation reads and writes (`EmployeeState` fits). */
export type ActivityBody = MovementBody & {
  seatId: string;
  item: string;
  sips: number;
  /** REQ-AVATAR-004: running emote id, `''` when none. */
  emote: string;
};

type Bodies = { get(id: string): ActivityBody | undefined };

/** A seat socket the server can place an employee on. */
export type SeatSpot = {
  id: string;
  kind: 'desk' | 'sofa';
  position: Vec3;
  rotY: number;
  /** Where the employee stands when leaving the seat. */
  standPoint: Vec3;
  /** The interactable whose range gates a sit request. */
  target: Interactable;
};

/** Resolves every desk and sofa seat of a layout to its socket and range target. */
export function seatSpots(layout: OfficeLayout = officeLayout): ReadonlyMap<string, SeatSpot> {
  const spots = new Map<string, SeatSpot>();
  for (const ws of layout.workstations) {
    const target = layout.interactables.find(
      (i) => i.type === 'chair' && i.workstationId === ws.id,
    );
    if (!target) continue;
    const { id, position, rotY } = ws.seat;
    spots.set(id, { id, kind: 'desk', position, rotY, standPoint: ws.interactionPoint, target });
  }
  const sofa = layout.interactables.find((i) => i.type === 'sofa');
  if (sofa) {
    for (const s of layout.sofaSeats) {
      spots.set(s.id, {
        id: s.id,
        kind: 'sofa',
        position: s.position,
        rotY: s.rotY,
        standPoint: s.interactionPoint,
        target: sofa,
      });
    }
  }
  return spots;
}

/** Same distance test as `findInteractionTarget`: interaction point within range. */
export function inRange(body: { x: number; z: number }, target: Interactable): boolean {
  const [ix, , iz] = target.interactionPoint;
  return Math.hypot(ix - body.x, iz - body.z) <= target.interactionRange;
}

const DRINK_TYPES: ReadonlySet<string> = new Set(['coffee_machine', 'water_dispenser']);
/** Activities whose end is driven by a timer in `ActivitySim.timers`. */
const TIMED: ReadonlySet<string> = new Set(['drinking', 'waving', 'brewing']);

const heldOf = (body: ActivityBody): Held =>
  body.item === 'coffee' ? { item: 'coffee', sips: body.sips } : { ...EMPTY_HAND };
function setHeld(body: ActivityBody, held: Held): void {
  body.item = held.item;
  body.sips = held.sips;
}

type Pending = { afterSeq: number; intent: IntentMessage };
/** A running emote: when it ends and the activity it started from (its posture). */
type RunningEmote = { endsAt: number; started: Activity };

/**
 * REQ-NET-002, REQ-INT-002: authoritative activity and exclusive seating, free of sockets
 * and timers. Time is passed in as `nowMs`, so tests drive it with a controlled clock.
 *
 * Rules (the Phase 2 client rules, moved to the server):
 * - `sit { seatId }`: the seat must exist, the employee must be within the interaction
 *   range of the seat's chair (desk) or the sofa, `nextActivity` must allow `sit` (idle or
 *   walking), and the seat must be free in this room's `SeatRegistry`. On success the
 *   employee is placed on the socket position and rotation with `sitting` or `resting`.
 *   The facing cone the client uses to pick a prompt target is not checked: range only.
 * - `stand`: a seated employee returns to the seat's stand point with `idle`.
 * - `toggleWork`: switches `sitting` and `working` for a desk occupant only.
 * - `drink` with an empty hand: needs the coffee machine or water dispenser in range;
 *   `drinking` returns to `idle` after `BALANCE.activity.drinkSeconds`.
 * - `drink` while holding a coffee (REQ-INT-003): one sip anywhere, with the same activity
 *   and timer. The sip counts when the timer ends; the last sip clears the item.
 * - `brew` (REQ-INT-003): needs the coffee machine in range, an empty hand, idle or walking
 *   and a free machine. `brewing` lasts `BALANCE.coffee.brewSeconds`, then the employee is
 *   `idle` holding a coffee with `BALANCE.coffee.sips` sips. The machine serves one
 *   employee at a time: it is busy while its brewer is `brewing`, so a cancelled brew, a
 *   leave or a dropped connection frees it.
 * - `wave`: `waving` returns to `idle` after `BALANCE.activity.waveSeconds`.
 * - `emote { emote }` (REQ-AVATAR-004): allowed by `canEmote` (standing, or seated for all
 *   but `dance`; never while drinking, waving or brewing; a held coffee does not matter)
 *   and only `BALANCE.emote.minGapSeconds` or more after this employee's previous emote
 *   started. It sets `emote` and leaves `activity`, seat and held item alone, so the
 *   employee is in the previous activity when the emote ends. A new emote after the gap
 *   replaces a running one. It ends after `BALANCE.emote.durationSeconds[id]`, on movement
 *   input with a nonzero axis, or when the activity leaves the emote's posture
 *   (`emoteContinues`: sitting, standing up, toggling work, drinking, waving, brewing).
 * - Movement input with a nonzero axis while seated stands the employee up at the seat's
 *   stand point and frees the seat, then applies the step (walking), like the client's
 *   `onMoveIntent` followed by its movement update. A zero-axis input while seated only
 *   advances `lastSeq`; the seated pose is never moved by the collision solver.
 * - Moving while drinking, waving or brewing cancels it (activity becomes walking); a
 *   cancelled sip or brew changes nothing held.
 *
 * A rejected intent changes nothing and gets no reply.
 */
export class ActivitySim {
  readonly seats = new SeatRegistry();
  private readonly pending = new Map<string, Pending[]>();
  private readonly timers = new Map<string, number>();
  private readonly emotes = new Map<string, RunningEmote>();
  /** Start time of each employee's last accepted emote (the minimum-gap clock). */
  private readonly lastEmoteAt = new Map<string, number>();
  private readonly seatIds: ReadonlySet<string>;
  /** The employee using the coffee machine; the machine is busy while it is `brewing`. */
  private brewer: { id: string; body: ActivityBody } | null = null;

  constructor(
    private readonly spots: ReadonlyMap<string, SeatSpot> = seatSpots(),
    private readonly interactables: readonly Interactable[] = officeLayout.interactables,
    private readonly queueMax: number = BALANCE.net.intentQueueMax,
  ) {
    this.seatIds = new Set(spots.keys());
  }

  add(id: string): void {
    this.pending.set(id, []);
  }

  /** Drops a client's queued intents; its seat and timers stay (a dropped connection). */
  clearQueue(id: string): void {
    if (this.pending.has(id)) this.pending.set(id, []);
  }

  /** Forgets a client and frees its seat and the coffee machine. */
  remove(id: string): void {
    this.pending.delete(id);
    this.timers.delete(id);
    this.emotes.delete(id);
    this.lastEmoteAt.delete(id);
    this.seats.release(id);
    if (this.brewer?.id === id) this.brewer = null;
  }

  /** Ends a running emote of `id` now (movement input); the activity is left as it is. */
  endEmote(id: string, body: ActivityBody): void {
    this.emotes.delete(id);
    body.emote = '';
  }

  /** True while an employee is brewing at the coffee machine. */
  get machineBusy(): boolean {
    return this.brewer !== null && this.brewer.body.activity === 'brewing';
  }

  /** Cancels a running brew of `id` (a dropped connection): idle, empty hand, machine free. */
  cancelBrew(id: string): void {
    if (this.brewer?.id !== id) return;
    const { body } = this.brewer;
    this.brewer = null;
    if (body.activity !== 'brewing') return;
    this.timers.delete(id);
    body.activity = 'idle';
  }

  /**
   * Validates and queues a raw `intent` payload. It applies once the body's `lastSeq`
   * reaches `afterSeq` (the highest input seq accepted before the intent arrived), so an
   * intent is judged at the position the client had when it sent it.
   */
  enqueue(id: string, raw: unknown, afterSeq: number): boolean {
    const queue = this.pending.get(id);
    if (!queue) return false;
    const intent = parseIntent(raw, this.seatIds);
    if (intent === null || queue.length >= this.queueMax) return false;
    queue.push({ afterSeq, intent });
    return true;
  }

  /** Applies every queued intent whose preceding inputs have been applied. */
  drain(id: string, body: ActivityBody, nowMs: number): void {
    const queue = this.pending.get(id);
    while (queue && queue.length > 0 && queue[0]!.afterSeq <= body.lastSeq) {
      this.apply(id, body, queue.shift()!.intent, nowMs);
    }
  }

  /** Applies one intent now; returns whether it changed state. */
  apply(id: string, body: ActivityBody, intent: IntentMessage, nowMs: number): boolean {
    const activity = body.activity as Activity;
    switch (intent.type) {
      case 'sit':
        return this.sit(id, body, intent.seatId);
      case 'stand':
        return this.standUp(id, body);
      case 'toggleWork': {
        if (this.spots.get(body.seatId)?.kind !== 'desk') return false;
        return this.set(body, nextActivity(activity, { type: 'toggleWork' }));
      }
      case 'drink': {
        const holding = body.item === 'coffee';
        const near =
          holding || this.interactables.some((i) => DRINK_TYPES.has(i.type) && inRange(body, i));
        if (!near || !this.set(body, nextActivity(activity, { type: 'drink' }))) return false;
        this.timers.set(id, nowMs + BALANCE.activity.drinkSeconds * 1000);
        return true;
      }
      case 'brew': {
        const machine = this.interactables.find(
          (i) => i.type === 'coffee_machine' && inRange(body, i),
        );
        if (!machine || this.machineBusy) return false;
        const next = nextActivity(activity, { type: 'brew' }, heldOf(body).item);
        if (!this.set(body, next)) return false;
        this.brewer = { id, body };
        this.timers.set(id, nowMs + BALANCE.coffee.brewSeconds * 1000);
        return true;
      }
      case 'wave': {
        if (!this.set(body, nextActivity(activity, { type: 'wave' }))) return false;
        this.timers.set(id, nowMs + BALANCE.activity.waveSeconds * 1000);
        return true;
      }
      case 'emote': {
        if (!canEmote(activity, intent.emote)) return false;
        const last = this.lastEmoteAt.get(id);
        if (last !== undefined && nowMs - last < BALANCE.emote.minGapSeconds * 1000) return false;
        const seconds = BALANCE.emote.durationSeconds[intent.emote];
        this.emotes.set(id, { endsAt: nowMs + seconds * 1000, started: activity });
        this.lastEmoteAt.set(id, nowMs);
        body.emote = intent.emote;
        return true;
      }
    }
  }

  /** Frees the seat and puts a seated body at the seat's stand point with `idle`. */
  standUp(id: string, body: ActivityBody): boolean {
    const activity = body.activity as Activity;
    if (!isSeated(activity)) return false;
    const spot = this.spots.get(body.seatId);
    this.seats.release(id);
    if (spot) {
      body.x = spot.standPoint[0];
      body.z = spot.standPoint[2];
    }
    body.seatId = '';
    body.activity = nextActivity(activity, { type: 'stand' });
    return true;
  }

  /**
   * Ends drink, wave and brew timers whose time is up (a finished sip or brew updates the
   * held item), and drops timers of cancelled ones. Ends emotes whose time is up or whose
   * posture the activity has left.
   */
  expire(bodies: Bodies, nowMs: number): void {
    for (const [id, endsAt] of this.timers) {
      const body = bodies.get(id);
      if (!body || !TIMED.has(body.activity)) {
        this.timers.delete(id);
      } else if (nowMs >= endsAt) {
        this.timers.delete(id);
        const activity = body.activity as Activity;
        const event =
          activity === 'brewing' ? { type: 'brewDone' as const } : { type: 'actionDone' as const };
        setHeld(body, nextHeld(activity, heldOf(body), event));
        body.activity = nextActivity(activity, event);
        if (this.brewer?.id === id) this.brewer = null;
      }
    }
    if (this.brewer && !this.machineBusy) this.brewer = null;
    for (const [id, emote] of this.emotes) {
      const body = bodies.get(id);
      if (!body) {
        this.emotes.delete(id);
      } else if (
        nowMs >= emote.endsAt ||
        !emoteContinues(emote.started, body.activity as Activity)
      ) {
        this.endEmote(id, body);
      }
    }
  }

  private sit(id: string, body: ActivityBody, seatId: string): boolean {
    const spot = this.spots.get(seatId);
    if (!spot || !inRange(body, spot.target)) return false;
    const activity = body.activity as Activity;
    const seated = nextActivity(activity, { type: 'sit', kind: spot.kind });
    if (seated === activity) return false;
    if (!this.seats.claim(seatId, id)) return false;
    this.timers.delete(id);
    body.seatId = seatId;
    body.x = spot.position[0];
    body.z = spot.position[2];
    body.heading = (spot.rotY * Math.PI) / 180;
    body.activity = seated;
    return true;
  }

  private set(body: ActivityBody, next: Activity): boolean {
    if (next === body.activity) return false;
    body.activity = next;
    return true;
  }
}

/**
 * The room simulation: movement and activity per 50 ms tick. Per client, in join order:
 * ready intents, then at most one input (standing a seated body up first if it moves),
 * then intents that were waiting for that input. Drink, wave, brew and emote timers expire
 * last, and an emote whose posture changed during the tick ends there.
 * Join order therefore decides contested seats within one tick: the earlier joiner wins.
 */
export class OfficeSim {
  readonly movement: MovementSim;
  readonly activity: ActivitySim;

  constructor(movement = new MovementSim(), activity = new ActivitySim()) {
    this.movement = movement;
    this.activity = activity;
  }

  add(id: string, lastSeq = 0): void {
    this.movement.add(id, lastSeq);
    this.activity.add(id);
  }

  remove(id: string): void {
    this.movement.remove(id);
    this.activity.remove(id);
  }

  /**
   * REQ-NET-005: a dropped connection keeps the employee and its seat, but inputs and
   * intents it queued are discarded so the held avatar stands still. A running brew is
   * cancelled so the coffee machine is free for others (REQ-INT-003). Seqs above `lastSeq`
   * are accepted again after a reconnect (the client keeps counting up from its own seq).
   */
  suspend(id: string, lastSeq: number): void {
    if (this.movement.acceptedSeq(id) === null) return;
    this.movement.add(id, lastSeq);
    this.activity.clearQueue(id);
    this.activity.cancelBrew(id);
  }

  input(id: string, raw: unknown): boolean {
    return this.movement.enqueue(id, raw);
  }

  intent(id: string, raw: unknown): boolean {
    const afterSeq = this.movement.acceptedSeq(id);
    return afterSeq !== null && this.activity.enqueue(id, raw, afterSeq);
  }

  tick(bodies: Bodies, colliders: readonly Aabb[], nowMs: number): void {
    for (const id of this.movement.ids()) {
      const body = bodies.get(id);
      const input = this.movement.next(id);
      if (!body) continue;
      this.activity.drain(id, body, nowMs);
      if (input) {
        const moving = input.forward !== 0 || input.right !== 0;
        if (moving) this.activity.endEmote(id, body);
        if (isSeated(body.activity as Activity)) {
          if (moving) {
            this.activity.standUp(id, body);
            stepBody(body, input, colliders);
          } else {
            body.lastSeq = input.seq;
          }
        } else {
          stepBody(body, input, colliders);
        }
        this.activity.drain(id, body, nowMs);
      }
    }
    this.activity.expire(bodies, nowMs);
  }
}
